"""Encrypt LangGraph checkpoint blobs at rest.

Checkpoint channel values (chat messages, tool payloads, interrupts) are
serialized by the checkpointer's serde before they hit `checkpoint_blobs` /
`checkpoint_writes`. Aegra builds its `AsyncPostgresSaver` with the default
plain serde, so `install()` swaps in LangGraph's own `EncryptedSerializer`
backed by `KeyRingCipher` — the same key ring used by
`nmb_marketplace_agent.crypto` (AES-256-GCM, `enc:v1:<key_id>:` blobs).

Aegra initializes the database before loading graph modules, so wrapping the
live saver from our graph factory covers every graph in the process before the
first request. Blobs written before encryption was enabled keep loading
(EncryptedSerializer passes through types without a `+cipher` suffix); run
``python -m nmb_marketplace_agent.checkpoint_store rewrap`` to seal them.

Rotation uses the same lazy model as the rest of the app: writes move to the
current key immediately, old blobs stay readable while their key remains in
NMB_ENCRYPTION_KEYS_OLD, and `rewrap` migrates them.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from langgraph.checkpoint.serde.base import CipherProtocol, SerializerProtocol
from langgraph.checkpoint.serde.encrypted import EncryptedSerializer
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

from nmb_marketplace_agent import crypto

log = logging.getLogger(__name__)

AAD = "langgraph.checkpoint"
CIPHER_PREFIX = "v1."


class KeyRingCipher(CipherProtocol):
    """AES-GCM over the app key ring; cipher name carries the key id for rotation."""

    def encrypt(self, plaintext: bytes) -> tuple[str, bytes]:
        ring = crypto.keyring()
        if not ring.primary:
            raise crypto.EncryptionKeyMissing("No encryption key configured; set NMB_ENCRYPTION_KEY")
        return CIPHER_PREFIX + ring.primary_id, crypto.encrypt_bytes(plaintext, aad=AAD)

    def decrypt(self, ciphername: str, ciphertext: bytes) -> bytes:
        if not ciphername.startswith(CIPHER_PREFIX):
            raise crypto.DecryptionError(f"Unsupported checkpoint cipher: {ciphername}")
        key_id = ciphername[len(CIPHER_PREFIX):]
        header = crypto.PREFIX.encode()
        if not ciphertext.startswith(header):
            raise crypto.DecryptionError("Sealed checkpoint blob has no cipher header")
        embedded = ciphertext[len(header):].split(b":", 1)[0].decode(errors="replace")
        if embedded != key_id:  # key id lives in both the type tag and the blob
            raise crypto.DecryptionError("Checkpoint cipher name does not match its key id")
        return crypto.decrypt_bytes(bytes(ciphertext), aad=AAD)


def _inner_serde(saver: Any) -> SerializerProtocol:
    serde = getattr(saver, "serde", None)
    if serde is None or isinstance(serde, EncryptedSerializer):
        return JsonPlusSerializer()
    return serde


def install(saver: Any | None = None) -> bool:
    """Wrap a checkpointer's serde once. Returns True when a saver is encrypting."""
    if saver is None:
        saver = _aegra_saver()
    if saver is None:
        return False
    if isinstance(getattr(saver, "serde", None), EncryptedSerializer):
        return True
    ring = crypto.keyring()
    if not ring.primary:
        if ring.required:
            raise crypto.EncryptionKeyMissing(
                "NMB_ENCRYPTION_REQUIRED is on but NMB_ENCRYPTION_KEY is not set"
            )
        log.warning("Checkpoint encryption is OFF: set NMB_ENCRYPTION_KEY to seal thread state")
        return False
    saver.serde = EncryptedSerializer(KeyRingCipher(), _inner_serde(saver))
    log.info("LangGraph checkpoint encryption enabled (%s, key %s)",
             type(saver).__name__, ring.primary_id)
    return True


def _aegra_saver() -> Any | None:
    try:
        from aegra_api.core.database import db_manager
    except Exception:  # Aegra not installed (local langgraph dev, tests)
        return None
    return getattr(db_manager, "_checkpointer", None)


def install_checkpoint_encryption() -> bool:
    """Called from graph factories; no-op when the process has no Aegra checkpointer."""
    try:
        return install()
    except crypto.EncryptionKeyMissing:
        raise  # required mode must fail the run, not write plaintext state
    except Exception as e:  # never take graph building down over an install hiccup
        log.warning("Could not enable checkpoint encryption: %s", e)
        return False


# ── existing rows: status / rewrap ──────────────────────────────────
BLOB_TABLES = (
    ("checkpoint_blobs",
     ("thread_id", "checkpoint_ns", "channel", "version")),
    ("checkpoint_writes",
     ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "task_path", "idx")),
)


def _dsn(explicit: str | None = None) -> str:
    if explicit:
        return explicit
    url = os.environ.get("AEGRA_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""
    if url.startswith("postgres"):
        return url.replace("postgresql+asyncpg://", "postgresql://").replace(
            "postgresql+psycopg://", "postgresql://")
    user = os.environ.get("POSTGRES_USER", "postgres")
    password = os.environ.get("POSTGRES_PASSWORD", "postgres")
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ.get("POSTGRES_DB", "aegra")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def _connect(dsn: str | None):
    import psycopg

    return psycopg.connect(_dsn(dsn), autocommit=True)


def status(dsn: str | None = None) -> dict:
    out: dict[str, dict[str, int]] = {}
    with _connect(dsn) as conn, conn.cursor() as cur:
        for table, _keys in BLOB_TABLES:
            cur.execute(
                f"SELECT COUNT(*) FILTER (WHERE type LIKE '%+%') AS sealed, "  # noqa: S608
                f"COUNT(*) FILTER (WHERE type = 'empty') AS empty, "
                f"COUNT(*) FILTER (WHERE type NOT LIKE '%+%' AND type <> 'empty') AS plaintext "
                f"FROM {table}"
            )
            sealed, empty, plaintext = cur.fetchone()
            out[table] = {"sealed": sealed, "plaintext": plaintext, "empty": empty}
    return out


def _parse_type(type_: str) -> tuple[str, str | None]:
    typ, sep, ciphername = type_.partition("+")
    return typ, (ciphername if sep else None)


def _rewrap_row(type_: str, blob: bytes | None, *, force: bool = False) -> tuple[str, bytes] | None:
    """Return the sealed (type, blob) for one stored row, or None to leave it."""
    ring = crypto.keyring()
    if not ring.primary:
        raise crypto.EncryptionKeyMissing("No current key configured; set NMB_ENCRYPTION_KEY")
    if type_ == "empty" or blob is None:
        return None
    typ, ciphername = _parse_type(type_)
    if ciphername is not None:
        if not ciphername.startswith(CIPHER_PREFIX):
            raise crypto.DecryptionError(f"Unsupported checkpoint cipher: {ciphername}")
        if not force and ciphername == CIPHER_PREFIX + ring.primary_id:
            return None
        plain = KeyRingCipher().decrypt(ciphername, bytes(blob))
    else:
        plain = bytes(blob)  # legacy plaintext row
    new_cipher, new_blob = KeyRingCipher().encrypt(plain)
    return f"{typ}+{new_cipher}", new_blob


def rewrap(dsn: str | None = None, force: bool = False) -> dict[str, dict[str, int]]:
    """Seal plaintext checkpoint blobs (and move old keys to the current key)."""
    summary: dict[str, dict[str, int]] = {}
    with _connect(dsn) as conn, conn.cursor() as cur:
        for table, keys in BLOB_TABLES:
            counts = {"scanned": 0, "written": 0, "failed": 0}
            where = " AND ".join(f"{k} = %s" for k in keys)
            cur.execute(f"SELECT {', '.join(keys)}, type, blob FROM {table} WHERE blob IS NOT NULL")  # noqa: S608
            for row in cur.fetchall():
                *key_vals, type_, blob = row
                counts["scanned"] += 1
                try:
                    update = _rewrap_row(type_, blob, force=force)
                except Exception as e:
                    counts["failed"] += 1
                    log.warning("Could not rewrap %s %s: %s", table, key_vals, e)
                    continue
                if update is None:
                    continue
                new_type, new_blob = update
                cur.execute(
                    f"UPDATE {table} SET type = %s, blob = %s WHERE {where}",  # noqa: S608
                    [new_type, new_blob, *key_vals],
                )
                counts["written"] += 1
            summary[table] = counts
    return summary


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json

    parser = argparse.ArgumentParser(prog="python -m nmb_marketplace_agent.checkpoint_store")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name, help_text in (("status", "Sealed vs plaintext checkpoint blobs"),
                            ("rewrap", "Encrypt plaintext blobs / move to the current key")):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("--dsn", help="Postgres DSN (defaults to AEGRA_DATABASE_URL / DATABASE_URL / POSTGRES_*)")
        if name == "rewrap":
            p.add_argument("--force", action="store_true", help="Rewrite blobs already on the current key")
    args = parser.parse_args(argv)

    if args.cmd == "status":
        print(json.dumps(status(args.dsn), indent=2))
    else:
        print(json.dumps(rewrap(args.dsn, force=args.force), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
