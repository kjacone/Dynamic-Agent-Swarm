"""Human handoff queue: transcripts, replies, summaries and forwarding."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    Handoff,
    HandoffMessage,
)
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise import handoff as handoff_service
from nmb_marketplace_agent.enterprise.connectors import (
    ConnectorError,
    EgressPolicy,
    build_connector,
)
from nmb_marketplace_agent.enterprise.connectors_api import _get_cfg
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    AuditEvent,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires

router = APIRouter()




# ── human handoff queue ───────────────────────────────────────────────
class HandoffReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class HandoffResolveIn(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.get("/handoffs", dependencies=[Depends(require_module("approvals"))])
async def handoffs_list(status: str | None = None, limit: int = 200,
                        p: Principal = Depends(requires("handoffs:read")),
                        db: AsyncSession = Depends(get_db)):
    q = select(Handoff).where(Handoff.tenant_id == p.tenant_id)
    if status:
        q = q.where(Handoff.status == status)
    rows = (await db.execute(q.order_by(Handoff.created_at.desc()).limit(min(limit, 500)))).scalars().all()

    ids = [h.id for h in rows]
    counts: dict[str, int] = {}
    forwards: dict[str, int] = {}
    if ids:
        counts = dict((await db.execute(
            select(HandoffMessage.handoff_id, func.count(HandoffMessage.id))
            .where(HandoffMessage.handoff_id.in_(ids)).group_by(HandoffMessage.handoff_id)
        )).all())
        for ev in (await db.execute(
            select(AuditEvent).where(AuditEvent.tenant_id == p.tenant_id,
                                     AuditEvent.action == "handoff.forwarded",
                                     AuditEvent.resource_id.in_(ids))
        )).scalars().all():
            forwards[ev.resource_id] = forwards.get(ev.resource_id, 0) + 1
    return [handoff_service.view(h) | {"message_count": int(counts.get(h.id, 0)),
                                       "forward_count": forwards.get(h.id, 0)} for h in rows]


def _forward_view(ev: AuditEvent) -> dict:
    d = ev.details or {}
    return {
        "ts": ev.ts, "actor": ev.actor, "outcome": ev.outcome,
        "channel": d.get("channel") or "connector",
        "connector": d.get("connector", ""), "operation": d.get("operation", ""),
        "recipient": d.get("recipient", ""), "subject": d.get("subject", ""),
        "messages": d.get("messages"), "compressed": bool(d.get("compressed")),
        "summary_chars": d.get("summary_chars"),
    }


def _mask_recipient(value: str) -> str:
    """Audit details are PII-redacted; keep a recognisable hint without the address."""
    value = (value or "").strip()
    if "@" in value:
        local, domain = value.split("@", 1)
        return f"{local[:1]}***@{domain}" if local else f"***@{domain}"
    return value[:2] + "…" if len(value) > 2 else value


@router.get("/handoffs/{handoff_id}", dependencies=[Depends(require_module("approvals"))])
async def handoff_detail(handoff_id: str, p: Principal = Depends(requires("handoffs:read")),
                         db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    rows = await handoff_service.messages(db, h.id)
    events = await audit.query(db, p.tenant_id, action="handoff.forwarded", resource_id=h.id, limit=200)
    return handoff_service.view(h) | {
        "messages": [handoff_service.message_view(m) for m in rows],
        "forwards": [_forward_view(ev) for ev in reversed(events)],
    }


@router.post("/handoffs/{handoff_id}/claim", dependencies=[Depends(require_module("approvals"))])
async def handoff_claim(handoff_id: str, p: Principal = Depends(requires("handoffs:write")),
                        db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    try:
        await handoff_service.claim(db, h, p.sub)
    except handoff_service.HandoffError as e:
        raise HTTPException(409, str(e)) from e
    return handoff_service.view(h)


@router.post("/handoffs/{handoff_id}/reply", dependencies=[Depends(require_module("approvals"))])
async def handoff_reply(handoff_id: str, body: HandoffReplyIn,
                        p: Principal = Depends(requires("handoffs:write")),
                        db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    if h.status != "active":
        raise HTTPException(409, "Claim the conversation before replying")
    if h.assigned_to and h.assigned_to != p.sub and not p.has_role("tenant_admin"):
        raise HTTPException(403, f"Conversation is assigned to {h.assigned_to}")
    try:
        text = await handoff_service.screen_reply(db, p.tenant_id, body.text)
    except handoff_service.HandoffError as e:
        raise HTTPException(422, str(e)) from e
    m = await handoff_service.add_message(db, h, role="staff", author=p.sub, text=text)
    return {"handoff": handoff_service.view(h), "message": handoff_service.message_view(m)}


@router.post("/handoffs/{handoff_id}/resolve", dependencies=[Depends(require_module("approvals"))])
async def handoff_resolve(handoff_id: str, body: HandoffResolveIn,
                          p: Principal = Depends(requires("handoffs:write")),
                          db: AsyncSession = Depends(get_db)):
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    if h.assigned_to and h.assigned_to != p.sub and not p.has_role("tenant_admin"):
        raise HTTPException(403, f"Conversation is assigned to {h.assigned_to}")
    await handoff_service.resolve(db, h, p.sub, body.note)
    return handoff_service.view(h)


class HandoffSummaryIn(BaseModel):
    max_chars: int = Field(default=1200, ge=200, le=4000)


@router.post("/handoffs/{handoff_id}/summary", dependencies=[Depends(require_module("approvals"))])
async def handoff_summary(handoff_id: str, body: HandoffSummaryIn = HandoffSummaryIn(),
                          p: Principal = Depends(requires("handoffs:read")),
                          db: AsyncSession = Depends(get_db)):
    """Compress the conversation before it is shared; generated locally, never sent to a model."""
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")
    rows = await handoff_service.messages(db, h.id)
    return handoff_service.summarize(h, rows, max_chars=body.max_chars)


class HandoffForwardIn(BaseModel):
    channel: Literal["connector", "email", "copy"] = "connector"
    connector: str = Field(default="", max_length=120)
    operation: str = Field(default="", max_length=120)
    subject: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)
    recipient: str = Field(default="", max_length=320)
    summary: str = Field(default="", max_length=8000)
    compress: bool = False


def _handoff_transcript(h: Handoff, rows: list[HandoffMessage]) -> tuple[str, list[dict[str, str]]]:
    header = [f"Conversation {h.id}", f"Status: {h.status}", f"Agent: {h.agent_id}", f"Thread: {h.thread_id}"]
    if h.customer_id:
        header.append(f"Customer: {h.customer_id}")
    if h.user_id:
        header.append(f"User: {h.user_id}")
    if h.reason:
        header.append(f"Reason: {h.reason}")
    messages = [{"role": m.role, "author": m.author, "text": m.text,
                 "created_at": m.created_at.isoformat()} for m in rows]
    lines = header + [""] + [
        f"[{m['created_at']}] {'Staff' if m['role'] == 'staff' else 'Customer'}"
        f"{' (' + m['author'] + ')' if m['author'] else ''}: {m['text']}"
        for m in messages
    ]
    return "\n".join(lines), messages


@router.post("/handoffs/{handoff_id}/forward", dependencies=[Depends(require_module("approvals"))])
async def handoff_forward(handoff_id: str, body: HandoffForwardIn,
                          p: Principal = Depends(requires("handoffs:write")),
                          db: AsyncSession = Depends(get_db)):
    """Share the conversation with another channel: a CRM via a connector, an email draft, or the clipboard.

    Every channel is recorded on the conversation so the queue can show it was already shared.
    """
    h = await db.get(Handoff, handoff_id)
    if not h or h.tenant_id != p.tenant_id:
        raise HTTPException(404, "Handoff not found")

    rows = await handoff_service.messages(db, h.id)
    subject = body.subject.strip() or f"Conversation {h.id[:8]} — {h.customer_id or h.user_id or 'customer'}"
    compressed = bool(body.compress and body.summary.strip())
    summary = body.summary.strip() if compressed else ""

    if body.channel in ("email", "copy"):
        if body.channel == "email" and not body.recipient.strip():
            raise HTTPException(422, "An email recipient is required")
        await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="handoff.forwarded",
                           resource_type="handoff", resource_id=h.id,
                           details={"channel": body.channel,
                                    "recipient": _mask_recipient(body.recipient),
                                    "subject": subject, "messages": len(rows),
                                    "compressed": compressed,
                                    "summary_chars": len(summary) if compressed else None})
        return {"ok": True, "channel": body.channel, "connector": "", "operation": "",
                "subject": subject, "recipient": body.recipient.strip(), "result": None}

    if not p.can("connectors:write"):
        raise HTTPException(403, "Missing permission: connectors:write")
    if not body.connector:
        raise HTTPException(422, "A connector is required for the connector channel")
    cfg = await _get_cfg(db, p.tenant_id, body.connector)
    if not cfg.enabled:
        raise HTTPException(409, f"Connector '{cfg.name}' is disabled")
    ops = list((cfg.config.get("operations") or {}).keys()) or list(cfg.config.get("scripts") or [])
    if not ops:
        raise HTTPException(422, f"Connector '{cfg.name}' exposes nothing to forward to")
    if body.operation:
        if body.operation not in ops:
            raise HTTPException(422, f"Operation must be one of: {', '.join(ops)}")
        operation = body.operation
    else:
        operation = next((o for o in ops if any(k in o.lower() for k in
                          ("create", "ticket", "case", "lead", "log", "conversation", "forward", "note"))), ops[0])

    transcript, messages = _handoff_transcript(h, rows)
    payload = {
        "handoff_id": h.id, "thread_id": h.thread_id, "agent_id": h.agent_id,
        "customer_id": h.customer_id or "", "user_id": h.user_id or "",
        "status": h.status, "subject": subject, "note": body.note,
        "transcript": summary or transcript, "messages": messages,
        "compressed": compressed, "summary": summary,
    }
    try:
        result = await build_connector(cfg.name, cfg.type, cfg.config, EgressPolicy()).call(
            operation,
            {"body": payload, "handoff_id": h.id, "thread_id": h.thread_id,
             "customer_id": h.customer_id or "", "subject": subject},
        )
    except ConnectorError as e:
        await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="handoff.forwarded",
                           resource_type="handoff", resource_id=h.id, outcome="error",
                           details={"channel": "connector", "connector": cfg.name, "operation": operation,
                                    "error": str(e), "compressed": compressed})
        raise HTTPException(502, f"{cfg.name}.{operation} failed: {e}") from e

    ok = not (isinstance(result, dict) and result.get("ok") is False)
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="handoff.forwarded",
                       resource_type="handoff", resource_id=h.id,
                       outcome="success" if ok else "error",
                       details={"channel": "connector", "connector": cfg.name, "operation": operation,
                                "subject": subject, "messages": len(messages),
                                "compressed": compressed,
                                "summary_chars": len(summary) if compressed else None})
    return {"ok": ok, "channel": "connector", "connector": cfg.name, "operation": operation,
            "subject": subject, "recipient": "", "result": result}
