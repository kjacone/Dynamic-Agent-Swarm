"""Tamper-evident audit trail.

Each event embeds the hash of the previous event for the tenant (a hash chain). If
``AUDIT_HMAC_KEY`` is set the hash is an HMAC, so even a DBA who can edit rows cannot
recompute a valid chain. ``checkpoint`` produces a signed head you can ship to WORM/object
storage or a SIEM so truncation is detectable too. PII in ``details`` is redacted by default.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import uuid
from dataclasses import dataclass
from typing import AsyncIterator

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.enterprise.guardrails import redact_obj
from nmb_marketplace_agent.enterprise.models import AuditEvent, now_iso

GENESIS = "0" * 64
_locks: dict[str, asyncio.Lock] = {}


def _canon(d: dict) -> str:
    return json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _digest(payload: str) -> str:
    key = os.environ.get("AUDIT_HMAC_KEY")
    if key:
        return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hashlib.sha256(payload.encode()).hexdigest()


def _body(e: AuditEvent | dict) -> dict:
    g = (lambda k: e[k]) if isinstance(e, dict) else (lambda k: getattr(e, k))
    return {k: g(k) for k in ("id", "tenant_id", "seq", "ts", "actor", "actor_type", "action",
                              "resource_type", "resource_id", "outcome", "details", "prev_hash")}


async def record(db: AsyncSession, *, tenant_id: str, actor: str, action: str,
                 resource_type: str = "", resource_id: str = "", outcome: str = "success",
                 details: dict | None = None, actor_type: str = "user", redact: bool = True) -> AuditEvent:
    lock = _locks.setdefault(tenant_id, asyncio.Lock())
    async with lock:
        for _ in range(5):
            last = (await db.execute(select(AuditEvent).where(AuditEvent.tenant_id == tenant_id)
                                     .order_by(AuditEvent.seq.desc()).limit(1))).scalars().first()
            ev = AuditEvent(
                id=str(uuid.uuid4()), tenant_id=tenant_id, seq=(last.seq + 1) if last else 1, ts=now_iso(),
                actor=actor, actor_type=actor_type, action=action, resource_type=resource_type,
                resource_id=str(resource_id), outcome=outcome,
                details=redact_obj(details or {}) if redact else (details or {}),
                prev_hash=last.hash if last else GENESIS, hash="")
            ev.hash = _digest(_canon(_body(ev)))
            db.add(ev)
            try:
                await db.commit()
                return ev
            except IntegrityError:  # another process won the sequence number; retry
                await db.rollback()
        raise RuntimeError("Could not append audit event (sequence contention)")


@dataclass
class VerifyResult:
    ok: bool
    checked: int
    first_bad_seq: int | None = None
    reason: str = ""

    def as_dict(self) -> dict:
        return self.__dict__.copy()


async def verify_chain(db: AsyncSession, tenant_id: str, page: int = 1000) -> VerifyResult:
    prev, checked, expect_seq = GENESIS, 0, 1
    while True:
        rows = (await db.execute(select(AuditEvent).where(AuditEvent.tenant_id == tenant_id,
                                                          AuditEvent.seq >= expect_seq)
                                 .order_by(AuditEvent.seq).limit(page))).scalars().all()
        if not rows:
            return VerifyResult(True, checked)
        for e in rows:
            if e.seq != expect_seq:
                return VerifyResult(False, checked, expect_seq, "missing event (sequence gap)")
            if e.prev_hash != prev:
                return VerifyResult(False, checked, e.seq, "broken link to previous event")
            if _digest(_canon(_body(e))) != e.hash:
                return VerifyResult(False, checked, e.seq, "event content does not match its hash")
            prev, checked, expect_seq = e.hash, checked + 1, expect_seq + 1


async def checkpoint(db: AsyncSession, tenant_id: str) -> dict:
    """Signed head of the chain. Store it outside the database to detect tail truncation."""
    last = (await db.execute(select(AuditEvent).where(AuditEvent.tenant_id == tenant_id)
                             .order_by(AuditEvent.seq.desc()).limit(1))).scalars().first()
    head = {"tenant_id": tenant_id, "seq": last.seq if last else 0,
            "hash": last.hash if last else GENESIS, "ts": now_iso()}
    head["sig"] = _digest(_canon(head))
    return head


async def query(db: AsyncSession, tenant_id: str, *, action: str | None = None, actor: str | None = None,
                resource_id: str | None = None, since_seq: int = 0, limit: int = 200) -> list[AuditEvent]:
    q = select(AuditEvent).where(AuditEvent.tenant_id == tenant_id, AuditEvent.seq > since_seq)
    if action:
        q = q.where(AuditEvent.action.like(action.replace("*", "%")))
    if actor:
        q = q.where(AuditEvent.actor == actor)
    if resource_id:
        q = q.where(AuditEvent.resource_id == resource_id)
    return list((await db.execute(q.order_by(AuditEvent.seq).limit(min(limit, 5000)))).scalars().all())


async def export_jsonl(db: AsyncSession, tenant_id: str, since_seq: int = 0) -> AsyncIterator[str]:
    """Stream the chain as JSONL for SIEM / regulator hand-over (verifiable offline)."""
    cursor = since_seq
    while True:
        rows = await query(db, tenant_id, since_seq=cursor, limit=1000)
        if not rows:
            return
        for e in rows:
            yield json.dumps({**_body(e), "hash": e.hash}, default=str) + "\n"
        cursor = rows[-1].seq
