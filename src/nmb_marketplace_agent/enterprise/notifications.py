"""Approval notifications: a durable outbox plus a background dispatcher.

Delivery is edge-triggered by the workflow engine (requested, escalated,
expired, decided), never by an agent turn. Rows are written next to the
approval and retried with backoff until sent or dead-lettered, so a slow SMTP
server can never block a decision.

Outbound bodies carry only the approval title, requester, due time and a
console link. ``payload.context`` is deliberately never included, and titles
are screened by the tenant's output policy before they leave.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import smtplib
import uuid
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config import database
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.connectors.base import ConnectorError, EgressPolicy
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    Notification,
    NotificationRoute,
    now_iso,
)

log = logging.getLogger(__name__)

CHANNELS = ("webhook", "email", "whatsapp")
MAX_ATTEMPTS = max(1, int(os.environ.get("NOTIFY_MAX_ATTEMPTS", "5")))
_LABELS = {
    "approval.requested": "Approval needed",
    "approval.escalated": "Approval escalated (SLA)",
    "approval.expired": "Approval expired",
    "approval.decided": "Approval decided",
    "notification.test": "Notification test",
}


def _shift(seconds: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _env_routes(tenant_id: str, role: str) -> list[tuple[str, str]]:
    """Pilot fallback: NMB_NOTIFY_ROUTES='{"approver":["email:ops@bank","webhook:https://..."]}'."""
    raw = os.environ.get("NMB_NOTIFY_ROUTES", "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        log.warning("NMB_NOTIFY_ROUTES is not valid JSON; ignoring it")
        return []
    if isinstance(data, dict) and isinstance(data.get(tenant_id), dict):
        data = data[tenant_id]
    values = data.get(role) if isinstance(data, dict) else None
    if isinstance(values, str):
        values = [values]
    out = []
    for value in values or []:
        channel, sep, target = str(value).partition(":")
        if sep and channel in CHANNELS and target.strip():
            out.append((channel, target.strip()))
    return out


async def routes_for(db: AsyncSession, tenant_id: str, roles: list[str]) -> list[tuple[str, str]]:
    wanted = [r for r in roles if r]
    if not wanted:
        return []
    rows = (
        await db.execute(select(NotificationRoute).where(
            NotificationRoute.tenant_id == tenant_id,
            NotificationRoute.role.in_(wanted),  # type: ignore[attr-defined]
            NotificationRoute.enabled == True,  # noqa: E712
        ))
    ).scalars().all()
    out = {(r.channel, r.target) for r in rows if r.channel in CHANNELS and r.target}
    for role in wanted:
        out.update(_env_routes(tenant_id, role))
    return sorted(out)


async def _safe_title(db: AsyncSession, tenant_id: str, text: str) -> str:
    """Screen a context-rendered title before it leaves the tenant."""
    try:
        from nmb_marketplace_agent.enterprise.guardrails import PolicyEngine
        from nmb_marketplace_agent.enterprise.runtime import load_policy

        dec = PolicyEngine(await load_policy(db, tenant_id)).check_text(str(text or ""), "output")
        if dec.blocked:
            return ""
        return str(dec.text if dec.text is not None else text)[:300]
    except Exception:  # fail closed: never leak an unscreened title
        log.exception("Could not screen notification title")
        return ""


async def _message(db: AsyncSession, approval: Approval, event: str) -> tuple[str, str]:
    label = _LABELS.get(event, "Approval update")
    title = await _safe_title(db, approval.tenant_id, approval.title) or f"Approval {approval.id[:8]}"
    subject = f"[NMB] {label}: {title}"[:160]

    url = os.environ.get("NMB_APPROVALS_URL", "").strip()
    if not url:
        root = (os.environ.get("NMB_APP_URL") or os.environ.get("PUBLIC_BASE_URL") or "").strip()
        url = f"{root.rstrip('/')}/enterprise/approvals" if root else ""

    lines = [f"{label}.", "", f"Approval: {title}"]
    if approval.requester:
        lines.append(f"Requested by: {approval.requester}")
    if approval.due_at:
        lines.append(f"Due: {approval.due_at}")
    if approval.status != "pending":
        lines.append(f"Status: {approval.status}")
    lines += ["", f"Reference: {approval.id}"]
    if url:
        lines += ["", f"Open: {url}"]
    return subject, "\n".join(lines)


async def notify(db: AsyncSession, approval: Approval, event: str, roles: list[str]) -> int:
    """Queue one row per route. Idempotent: repeated events with the same target are ignored."""
    try:
        routes = await routes_for(db, approval.tenant_id, roles)
        if not routes:
            return 0
        subject, body = await _message(db, approval, event)
        created = 0
        for channel, target in routes:
            exists = (
                await db.execute(select(Notification).where(
                    Notification.tenant_id == approval.tenant_id,
                    Notification.approval_id == approval.id,
                    Notification.event == event,
                    Notification.channel == channel,
                    Notification.target == target,
                ))
            ).scalars().first()
            if exists:
                continue
            db.add(Notification(
                id=str(uuid.uuid4()), tenant_id=approval.tenant_id, event=event,
                approval_id=approval.id, channel=channel, target=target,
                subject=subject, body=body, status="pending", next_attempt_at=now_iso(),
            ))
            created += 1
        if created:
            await db.commit()
            await audit.record(db, tenant_id=approval.tenant_id, actor="notification",
                               action="notification.queued", resource_type="approval",
                               resource_id=approval.id,
                               details={"event": event, "count": created,
                                        "channels": sorted({c for c, _ in routes})})
        return created
    except IntegrityError:
        await db.rollback()
        return 0
    except Exception:
        log.exception("Could not queue %s for approval %s", event, approval.id)
        return 0


# ── delivery ─────────────────────────────────────────────────────────
def _payload(n: Notification) -> bytes:
    return json.dumps({
        "id": n.id, "event": n.event, "tenant_id": n.tenant_id,
        "approval_id": n.approval_id, "subject": n.subject, "body": n.body, "ts": now_iso(),
    }, separators=(",", ":")).encode()


async def _webhook(n: Notification) -> tuple[bool, str]:
    try:
        EgressPolicy().check(n.target)
    except ConnectorError as e:
        return False, str(e)
    payload = _payload(n)
    headers = {
        "content-type": "application/json",
        "x-nmb-event": n.event,
        "x-nmb-notification": n.id,
    }
    key = os.environ.get("NOTIFY_HMAC_KEY") or os.environ.get("AUDIT_HMAC_KEY")
    if key:
        headers["x-nmb-signature"] = "sha256=" + hmac.new(
            key.encode(), payload, hashlib.sha256
        ).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            r = await client.post(n.target, content=payload, headers=headers)
        if r.status_code >= 300:
            return False, f"HTTP {r.status_code}"
        return True, ""
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


async def _email(n: Notification) -> tuple[bool, str]:
    host = os.environ.get("NMB_SMTP_HOST", "").strip()
    if not host:
        return False, "SMTP is not configured (set NMB_SMTP_HOST)"
    port = int(os.environ.get("NMB_SMTP_PORT", "587"))
    user = os.environ.get("NMB_SMTP_USER", "").strip()
    password = os.environ.get("NMB_SMTP_PASSWORD", "")
    sender = os.environ.get("NMB_SMTP_FROM", "").strip() or user or "nmb-agent@localhost"
    starttls = os.environ.get("NMB_SMTP_STARTTLS", "true").lower() != "false"

    def send() -> None:
        msg = EmailMessage()
        msg["From"] = sender
        msg["To"] = n.target
        msg["Subject"] = n.subject
        msg.set_content(n.body)
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            if starttls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)

    try:
        await asyncio.to_thread(send)
        return True, ""
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


async def _whatsapp(n: Notification) -> tuple[bool, str]:
    from nmb_marketplace_agent.enterprise.whatsapp import deliver_outbox

    return await deliver_outbox(n)


async def _deliver(n: Notification) -> tuple[bool, str]:
    if n.channel == "webhook":
        return await _webhook(n)
    if n.channel == "email":
        return await _email(n)
    if n.channel == "whatsapp":
        return await _whatsapp(n)
    return False, f"Unsupported channel '{n.channel}'"


async def dispatch_due(limit: int = 50) -> dict[str, int]:
    """Deliver due rows; returns counts (sent / retrying / dead)."""
    out = {"sent": 0, "retrying": 0, "dead": 0}
    stamp = now_iso()
    async with database.async_session() as db:
        rows = (
            await db.execute(select(Notification).where(
                Notification.status == "pending",
                Notification.next_attempt_at <= stamp,
            ).order_by(Notification.created_at).limit(limit))
        ).scalars().all()
        for n in rows:
            ok, err = await _deliver(n)
            if ok:
                n.status, n.sent_at = "sent", now_iso()
                action, outcome = "notification.sent", "success"
                out["sent"] += 1
            else:
                n.attempts += 1
                n.last_error = (err or "delivery failed")[:300]
                if n.attempts >= MAX_ATTEMPTS:
                    n.status = "dead"
                    out["dead"] += 1
                else:
                    n.next_attempt_at = _shift(min(3600, 30 * (2 ** (n.attempts - 1))))
                    out["retrying"] += 1
                action, outcome = "notification.failed", "denied"
            db.add(n)
            await db.commit()
            try:
                await audit.record(
                    db, tenant_id=n.tenant_id, actor="notification-dispatcher",
                    action=action, resource_type="notification", resource_id=n.id,
                    outcome=outcome,
                    details={"event": n.event, "channel": n.channel, "approval_id": n.approval_id,
                             "target_sha256_16": hashlib.sha256(n.target.encode()).hexdigest()[:16],
                             "error": (n.last_error or "")[:120]},
                )
            except Exception:
                log.exception("Could not audit notification %s", n.id)
    return out


async def dispatcher_loop(interval_s: int | None = None) -> None:
    interval = interval_s or int(os.environ.get("NOTIFY_INTERVAL_S", "15"))
    while True:
        await asyncio.sleep(interval)
        try:
            await dispatch_due()
        except Exception:  # noqa: BLE001
            log.exception("Notification dispatch cycle failed")
