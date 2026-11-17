"""Human handoff: pause the bot and let staff reply in the same thread.

Rows live in the shared registry database, so the public gateway (``/v1``)
and the enterprise dashboard operate on the same queue. While a handoff is
open the gateway stores customer turns here instead of running the graph;
the widget polls for staff turns. Resolving the handoff lets the bot answer
again on the next customer message.
"""
from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config.models import Handoff, HandoffMessage
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.guardrails import PolicyEngine
from nmb_marketplace_agent.enterprise.runtime import load_policy

STATUSES = ("requested", "active", "resolved")
ACTIVE = ("requested", "active")


class HandoffError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def view(h: Handoff) -> dict:
    return {
        "id": h.id, "agent_id": h.agent_id, "thread_id": h.thread_id, "status": h.status,
        "reason": h.reason, "requested_by": h.requested_by, "user_id": h.user_id,
        "customer_id": h.customer_id, "assigned_to": h.assigned_to,
        "created_at": _iso(h.created_at), "updated_at": _iso(h.updated_at),
        "resolved_at": _iso(h.resolved_at),
    }


def message_view(m: HandoffMessage) -> dict:
    return {"id": m.id, "handoff_id": m.handoff_id, "role": m.role, "author": m.author,
            "text": m.text, "created_at": _iso(m.created_at)}


async def active_for(db: AsyncSession, thread_id: str) -> Handoff | None:
    return (await db.execute(
        select(Handoff).where(Handoff.thread_id == thread_id, Handoff.status.in_(ACTIVE))
        .order_by(Handoff.created_at.desc())
    )).scalars().first()


async def latest_for(db: AsyncSession, thread_id: str) -> Handoff | None:
    return (await db.execute(
        select(Handoff).where(Handoff.thread_id == thread_id)
        .order_by(Handoff.created_at.desc())
    )).scalars().first()


async def request(db: AsyncSession, *, tenant_id: str, agent_id: str, thread_id: str,
                  user_id: str | None, customer_id: str | None, reason: str | None,
                  actor: str, actor_type: str) -> tuple[Handoff, bool]:
    """Open a handoff (idempotent while one is already active)."""
    existing = await active_for(db, thread_id)
    if existing:
        return existing, False

    h = Handoff(id=str(uuid.uuid4()), tenant_id=tenant_id, agent_id=agent_id,
                thread_id=thread_id, status="requested", requested_by="customer",
                reason=(reason or "").strip()[:2000], user_id=user_id, customer_id=customer_id)
    db.add(h)
    await db.commit()
    await audit.record(db, tenant_id=tenant_id, actor=actor, actor_type=actor_type,
                       action="handoff.requested", resource_type="handoff", resource_id=h.id,
                       details={"thread_id": thread_id, "agent_id": agent_id,
                                "customer_id": customer_id})
    return h, True


async def messages(db: AsyncSession, handoff_id: str, limit: int = 200) -> list[HandoffMessage]:
    return list((await db.execute(
        select(HandoffMessage).where(HandoffMessage.handoff_id == handoff_id)
        .order_by(HandoffMessage.created_at, HandoffMessage.id).limit(limit)
    )).scalars().all())


async def add_message(db: AsyncSession, h: Handoff, *, role: str, author: str,
                      text: str) -> HandoffMessage:
    m = HandoffMessage(id=str(uuid.uuid4()), tenant_id=h.tenant_id, thread_id=h.thread_id,
                       handoff_id=h.id, role=role, author=author or "", text=text)
    h.updated_at = _now()
    db.add(m)
    db.add(h)
    await db.commit()
    await audit.record(db, tenant_id=h.tenant_id, actor=author or role, actor_type=role,
                       action="handoff.message", resource_type="handoff", resource_id=h.id,
                       details={"message_id": m.id, "role": role, "chars": len(text)})
    return m


_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _clean(text: str) -> str:
    return " ".join((text or "").split())


def _clip(text: str, limit: int) -> str:
    t = _clean(text)
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def _sentences(text: str, limit: int = 2) -> list[str]:
    parts = [p.strip() for p in _SENTENCE.split(_clean(text)) if p.strip()]
    out: list[str] = []
    for p in parts:
        p = _clip(p, 240)
        if p and p not in out:
            out.append(p)
        if len(out) >= limit:
            break
    return out or ([_clip(text, 240)] if _clean(text) else [])


def summarize(h: Handoff, rows: list[HandoffMessage], max_chars: int = 1200) -> dict:
    """Compress a conversation locally (no model call, no data leaves the tenant).

    The result keeps what a receiving team needs: who the customer is, why the
    handoff happened, what they asked for, what staff already replied, and the
    latest turn. Long messages are clipped to their first sentences.
    """
    msgs = [m for m in rows if _clean(m.text)]
    who = h.customer_id or h.user_id or "customer"
    header = f"Conversation summary — {who} · agent {h.agent_id} · {h.status}"
    if msgs:
        start = msgs[0].created_at.strftime("%d %b %Y %H:%M UTC")
        end = msgs[-1].created_at.strftime("%d %b %Y %H:%M UTC")
        header += f"\n{len(msgs)} message{'s' if len(msgs) != 1 else ''} · {start} → {end}"
    lines = [header]
    if h.reason:
        lines += ["", f"Why a human stepped in: {_clip(h.reason, 220)}"]
    if not msgs:
        lines += ["", "No messages in this conversation yet."]
    else:
        customer = [m for m in msgs if m.role == "customer"]
        staff = [m for m in msgs if m.role == "staff"]
        picks = []
        for m in ([customer[0]] if customer else []) + ([customer[-1]] if len(customer) > 1 else []):
            if m not in picks:
                picks.append(m)
        lines += ["", "What the customer needs:"]
        if picks:
            for m in picks:
                lines += [f"- {s}" for s in _sentences(m.text, 1)]
        else:
            lines.append("- (no customer message captured)")
        lines += ["", "What staff replied:"]
        if staff:
            for m in staff[-2:]:
                lines += [f"- {s}" for s in _sentences(m.text, 1)]
        else:
            lines.append("- No staff reply yet.")
        if staff:
            lines += ["", f"Latest turn ({msgs[-1].created_at.strftime('%d %b %H:%M UTC')}): {_clip(msgs[-1].text, 240)}"]
    lines += ["", "Locally summarised extractive summary; the full transcript stays in the tenant."]
    summary = "\n".join(lines).strip()
    if len(summary) > max_chars:
        summary = summary[: max_chars - 1].rstrip() + "…"
    before = sum(len(m.text or "") for m in msgs) + len(_clean(h.reason))
    return {
        "summary": summary,
        "method": "extractive",
        "message_count": len(msgs),
        "chars_before": before,
        "chars_after": len(summary),
        "compression": round(1 - (len(summary) / before), 3) if before else 0.0,
    }


async def screen_reply(db: AsyncSession, tenant_id: str, text: str) -> str:
    """Screen staff outbound text with the tenant's output policy.

    Staff replies are human-authored, so injection rules do not apply, but a
    bank still expects the same secret/identifier guard as bot output.
    """
    dec = PolicyEngine(await load_policy(db, tenant_id)).check_text(text, "output")
    if dec.blocked:
        raise HandoffError(dec.reasons[0] if dec.reasons else "Blocked by output policy")
    return dec.text if dec.text is not None else text


async def claim(db: AsyncSession, h: Handoff, by: str) -> Handoff:
    if h.status == "resolved":
        raise HandoffError("This conversation is already resolved")
    if h.status == "active" and h.assigned_to and h.assigned_to != by:
        raise HandoffError(f"Already assigned to {h.assigned_to}")
    h.status = "active"
    h.assigned_to = by
    h.updated_at = _now()
    db.add(h)
    await db.commit()
    await audit.record(db, tenant_id=h.tenant_id, actor=by, action="handoff.claimed",
                       resource_type="handoff", resource_id=h.id,
                       details={"thread_id": h.thread_id})
    return h


async def resolve(db: AsyncSession, h: Handoff, by: str, note: str = "") -> Handoff:
    if h.status == "resolved":
        return h
    h.status = "resolved"
    h.resolved_at = _now()
    h.updated_at = h.resolved_at
    db.add(h)
    await db.commit()
    await audit.record(db, tenant_id=h.tenant_id, actor=by, action="handoff.resolved",
                       resource_type="handoff", resource_id=h.id,
                       details={"assigned_to": h.assigned_to or "", "note_chars": len(note)})
    return h
