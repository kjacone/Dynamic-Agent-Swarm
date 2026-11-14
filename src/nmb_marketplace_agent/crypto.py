"""Field-level encryption at rest (AES-256-GCM) for PII columns.

Ciphertext is stored inline as ``enc:v1:<key_id>:<base64url(nonce||ct)>`` so the
column type stays TEXT and no schema change is needed. Rows written before a
key was configured stay readable (plaintext passthrough); run
``python -m nmb_marketplace_agent.crypto reencrypt`` to seal them.

Key material is read from the environment only — never the database:
  NMB_ENCRYPTION_KEY        current key: base64 (32 bytes), 64-char hex, or
                            ``b64:``/``hex:`` prefixed
  NMB_ENCRYPTION_KEY_FILE   file containing the current key (wins over the env var)
  NMB_ENCRYPTION_KEYS_OLD   comma-separated decrypt-only keys (rotation)
  NMB_ENCRYPTION_REQUIRED   "true" to fail closed when no key is configured
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
from dataclasses import dataclass, field

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

log = logging.getLogger(__name__)

PREFIX = "enc:v1:"
_BYTES_PREFIX = PREFIX.encode()
_NONCE_BYTES = 12
_KEY_BYTES = 32


class EncryptionKeyMissing(RuntimeError):
    """A value needs a key but none is configured (or required mode is off)."""


class DecryptionError(RuntimeError):
    """Ciphertext could not be opened — wrong key, wrong column, or corruption."""


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _parse_key(text: str, source: str) -> bytes:
    raw = text.strip()
    if raw.startswith("b64:"):
        raw = raw[4:]
    elif raw.startswith("hex:"):
        try:
            key = bytes.fromhex(raw[4:])
        except ValueError as e:
            raise ValueError(f"{source}: not valid hex") from e
        return _checked(key, source)
    if len(raw) == _KEY_BYTES * 2:
        try:
            return _checked(bytes.fromhex(raw), source)
        except ValueError:
            pass
    try:
        key = _b64d(raw)
    except (ValueError, TypeError):
        key = raw.encode()
    return _checked(key, source)


def _checked(key: bytes, source: str) -> bytes:
    if len(key) != _KEY_BYTES:
        raise ValueError(
            f"{source}: encryption keys must be {_KEY_BYTES} bytes "
            "(generate one with `python -m nmb_marketplace_agent.crypto generate`)"
        )
    return key


def _key_id(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()[:8]


@dataclass
class KeyRing:
    primary: bytes | None = None
    keys: dict[str, bytes] = field(default_factory=dict)  # key_id -> key
    required: bool = False

    @property
    def primary_id(self) -> str | None:
        return _key_id(self.primary) if self.primary else None

    def encrypt(self, plaintext: str, *, aad: str) -> str:
        if not self.primary:
            if self.required:
                raise EncryptionKeyMissing(
                    "NMB_ENCRYPTION_REQUIRED is on but no encryption key is configured"
                )
            return plaintext
        nonce = secrets.token_bytes(_NONCE_BYTES)
        ct = AESGCM(self.primary).encrypt(nonce, plaintext.encode(), aad.encode())
        return f"{PREFIX}{self.primary_id}:{_b64e(nonce + ct)}"

    def decrypt(self, payload: str, *, aad: str) -> str:
        if not payload.startswith(PREFIX):
            return payload  # legacy plaintext row
        try:
            _, _, key_id, blob = payload.split(":", 3)
        except ValueError as e:
            raise DecryptionError("Malformed encrypted value") from e
        key = self.keys.get(key_id)
        if not key:
            raise EncryptionKeyMissing(
                f"Value is encrypted with key {key_id} but no matching key is "
                "configured (set NMB_ENCRYPTION_KEY or add it to NMB_ENCRYPTION_KEYS_OLD)"
            )
        raw = _b64d(blob)
        try:
            return AESGCM(key).decrypt(raw[:_NONCE_BYTES], raw[_NONCE_BYTES:], aad.encode()).decode()
        except InvalidTag as e:
            raise DecryptionError(
                f"Cannot decrypt {aad!r} value (key {key_id}): wrong key or tampered row"
            ) from e

    def encrypt_bytes(self, plaintext: bytes, *, aad: str) -> bytes:
        if not self.primary:
            if self.required:
                raise EncryptionKeyMissing(
                    "NMB_ENCRYPTION_REQUIRED is on but no encryption key is configured"
                )
            return plaintext
        nonce = secrets.token_bytes(_NONCE_BYTES)
        ct = AESGCM(self.primary).encrypt(nonce, plaintext, aad.encode())
        return _BYTES_PREFIX + self.primary_id.encode() + b":" + nonce + ct

    def decrypt_bytes(self, payload: bytes, *, aad: str) -> bytes:
        if not payload.startswith(_BYTES_PREFIX):
            return payload  # legacy plaintext blob
        key_id, sep, raw = payload[len(_BYTES_PREFIX):].partition(b":")
        if not sep:
            raise DecryptionError("Malformed encrypted blob")
        key = self.keys.get(key_id.decode())
        if not key:
            raise EncryptionKeyMissing(
                f"Blob is encrypted with key {key_id.decode()} but no matching key is "
                "configured (set NMB_ENCRYPTION_KEY or add it to NMB_ENCRYPTION_KEYS_OLD)"
            )
        try:
            return AESGCM(key).decrypt(raw[:_NONCE_BYTES], raw[_NONCE_BYTES:], aad.encode())
        except InvalidTag as e:
            raise DecryptionError(
                f"Cannot decrypt {aad!r} blob (key {key_id.decode()}): wrong key or tampered row"
            ) from e


def _load_keyring() -> KeyRing:
    ring = KeyRing(required=os.environ.get("NMB_ENCRYPTION_REQUIRED", "").lower() == "true")
    current: str | None = None
    key_file = os.environ.get("NMB_ENCRYPTION_KEY_FILE")
    if key_file:
        try:
            with open(key_file, encoding="utf-8") as f:
                current = f.read()
        except OSError as e:
            raise ValueError(f"NMB_ENCRYPTION_KEY_FILE: {e}") from e
    else:
        current = os.environ.get("NMB_ENCRYPTION_KEY")
    if current and current.strip():
        ring.primary = _parse_key(current, "NMB_ENCRYPTION_KEY")
        ring.keys[ring.primary_id] = ring.primary
    for i, old in enumerate(filter(None, (os.environ.get("NMB_ENCRYPTION_KEYS_OLD") or "").split(","))):
        key = _parse_key(old, f"NMB_ENCRYPTION_KEYS_OLD[{i}]")
        ring.keys[_key_id(key)] = key
    return ring


_ring: KeyRing | None = None


def keyring() -> KeyRing:
    global _ring
    if _ring is None:
        _ring = _load_keyring()
    return _ring


def reset_keyring() -> None:
    """Drop the cached keyring (tests / key rotation without a restart)."""
    global _ring
    _ring = None


def preflight() -> None:
    """Called at startup: fail fast in required mode, warn in dev."""
    ring = keyring()
    if ring.primary:
        log.info("Field encryption enabled (key %s, %d key(s) in ring)",
                 ring.primary_id, len(ring.keys))
    elif ring.required:
        raise EncryptionKeyMissing(
            "NMB_ENCRYPTION_REQUIRED is on but NMB_ENCRYPTION_KEY is not set"
        )
    else:
        log.warning("Field encryption is OFF: set NMB_ENCRYPTION_KEY to encrypt PII at rest")


def encrypt(plaintext: str, *, aad: str) -> str:
    return keyring().encrypt(plaintext, aad=aad)


def decrypt(payload: str, *, aad: str) -> str:
    return keyring().decrypt(payload, aad=aad)


def encrypt_bytes(plaintext: bytes, *, aad: str) -> bytes:
    return keyring().encrypt_bytes(plaintext, aad=aad)


def decrypt_bytes(payload: bytes, *, aad: str) -> bytes:
    return keyring().decrypt_bytes(payload, aad=aad)


class EncryptedText(TypeDecorator):
    """Transparently encrypt a TEXT column; ``aad`` binds it to its column name."""

    impl = Text
    cache_ok = True

    def __init__(self, *, aad: str):
        self.aad = aad
        super().__init__()

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encrypt(str(value), aad=self.aad)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return decrypt(str(value), aad=self.aad)


# ── rotation / backfill ──────────────────────────────────────────────
TARGETS = (
    ("handoff_messages", "text"),
    ("handoffs", "reason"),
    ("notifications", "body"),
)


def generate_key() -> str:
    return _b64e(secrets.token_bytes(_KEY_BYTES))


def _is_primary(payload: str, ring: KeyRing) -> bool:
    return payload.startswith(PREFIX) and payload.split(":", 3)[2] == ring.primary_id


async def _reencrypt(force: bool = False) -> dict[str, dict[str, int]]:
    from sqlalchemy import text as sql

    from nmb_marketplace_agent.config.database import async_session

    ring = keyring()
    if not ring.primary:
        raise EncryptionKeyMissing("No current key configured; set NMB_ENCRYPTION_KEY")

    summary: dict[str, dict[str, int]] = {}
    async with async_session() as db:
        for table, column in TARGETS:
            counts = {"scanned": 0, "written": 0}
            aad = f"{table}.{column}"
            rows = (await db.execute(
                sql(f"SELECT id, {column} AS v FROM {table}")  # noqa: S608 - fixed identifiers
            )).all()
            for row in rows:
                counts["scanned"] += 1
                value = row.v
                if not value or value == "":
                    continue
                if not force and isinstance(value, str) and _is_primary(value, ring):
                    continue
                plain = decrypt(value, aad=aad) if isinstance(value, str) and value.startswith(PREFIX) else value
                new = encrypt(plain, aad=aad)
                if new != value:
                    await db.execute(
                        sql(f"UPDATE {table} SET {column}=:v WHERE id=:id"),  # noqa: S608
                        {"v": new, "id": row.id},
                    )
                    counts["written"] += 1
            summary[table] = counts
            await db.commit()
    return summary


async def _status() -> dict:
    from sqlalchemy import text as sql

    from nmb_marketplace_agent.config.database import async_session

    ring = keyring()
    out: dict = {"primary_key_id": ring.primary_id, "keys_in_ring": sorted(ring.keys), "tables": {}}
    async with async_session() as db:
        for table, column in TARGETS:
            row = (await db.execute(
                sql(f"SELECT COUNT(*) AS total, "  # noqa: S608
                    f"SUM(CASE WHEN {column} LIKE 'enc:v1:%' THEN 1 ELSE 0 END) AS sealed, "
                    f"SUM(CASE WHEN {column} IS NOT NULL AND {column} != '' "
                    f"AND {column} NOT LIKE 'enc:v1:%' THEN 1 ELSE 0 END) AS plaintext "
                    f"FROM {table}")
            )).one()
            out["tables"][table] = {"total": row.total, "sealed": row.sealed or 0, "plaintext": row.plaintext or 0}
    return out


def main(argv: list[str] | None = None) -> int:
    import argparse
    import asyncio
    import json

    parser = argparse.ArgumentParser(prog="python -m nmb_marketplace_agent.crypto")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("generate", help="Print a new base64 key")
    sub.add_parser("status", help="Show key ids and which rows are sealed")
    r = sub.add_parser("reencrypt", help="Seal plaintext rows / move to the current key")
    r.add_argument("--force", action="store_true", help="Rewrite rows already sealed with the current key")
    args = parser.parse_args(argv)

    if args.cmd == "generate":
        print(generate_key())
        return 0
    if args.cmd == "status":
        print(json.dumps(asyncio.run(_status()), indent=2))
        return 0
    summary = asyncio.run(_reencrypt(force=args.force))
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
