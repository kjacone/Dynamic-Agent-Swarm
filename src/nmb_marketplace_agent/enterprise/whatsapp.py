"""WhatsApp channel: a customer starts the chat in WhatsApp, the same agent answers.

Inbound: Meta WhatsApp Cloud API webhook -> agent turn (the same gateway code path
as the web widget) -> reply back on WhatsApp. Outbound: task-completion updates
and approval notifications go through the durable notification outbox on the
``whatsapp`` channel.

Credentials are read from env by name only: ``WHATSAPP_ACCESS_TOKEN``,
``WHATSAPP_PHONE_NUMBER_ID``, ``WHATSAPP_VERIFY_TOKEN``, ``WHATSAPP_APP_SECRET``.
When the Graph credentials are absent the channel runs in simulator mode so the
demo console can show the exact transcript without calling Meta.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from dataclasses import dataclass

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.models import (
    Notification,
    WhatsAppAccount,
    WhatsAppContact,
    WhatsAppMessage,
    now_iso,
)

log = logging.getLogger(__name__)

USER_PREFIX = "wa:"
MAX_BODY = 3900
_PHONE = re.compile(r"^\+?\d{7,20}$")


def norm_phone(value: str | None) -> str:
    """Digits-only WhatsApp id (Meta uses the number without '+')."""
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if _PHONE.match(digits) else ""


def user_id_for(wa_id: str) -> str:
    return f"{USER_PREFIX}{wa_id}"


def wa_id_for_user(user_id: str) -> str:
    return user_id[len(USER_PREFIX):] if str(user_id or "").startswith(USER_PREFIX) else ""


def graph_version() -> str:
    return os.environ.get("WHATSAPP_GRAPH_VERSION", "v21.0").strip() or "v21.0"


def access_token() -> str:
    return os.environ.get("WHATSAPP_ACCESS_TOKEN", "").strip()


def default_phone_number_id() -> str:
    return os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()


def graph_configured() -> bool:
    return bool(access_token() and default_phone_number_id())


def simulator_enabled() -> bool:
    flag = os.environ.get("WHATSAPP_SIMULATOR", "").strip().lower()
    if flag:
        return flag in ("1", "true", "yes", "on")
    return os.environ.get("ENV", "dev").strip().lower() not in ("production", "prod")


def verify_token() -> str:
    return os.environ.get("WHATSAPP_VERIFY_TOKEN", "").strip()


def app_secret() -> str:
    return os.environ.get("WHATSAPP_APP_SECRET", "").strip()


def unsigned_webhooks_allowed() -> bool:
    return os.environ.get("WHATSAPP_UNSIGNED_WEBHOOKS", "").strip().lower() in ("1", "true", "yes", "on")


def verify_signature(raw: bytes, header: str) -> bool:
    """Meta signs the raw body with the app secret (X-Hub-Signature-256)."""
    secret = app_secret()
    if not secret:
        return unsigned_webhooks_allowed()
    expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, (header or "").strip())


# ── account + contact resolution ─────────────────────────────────────
@dataclass
class BoundAccount:
    tenant_id: str
    agent_id: str
    phone_number_id: str
    display_phone: str = ""


def env_account() -> BoundAccount | None:
    tenant = os.environ.get("WHATSAPP_TENANT_ID", "").strip()
    agent = os.environ.get("WHATSAPP_AGENT_ID", "").strip()
    if not (tenant and agent):
        return None
    return BoundAccount(tenant, agent, default_phone_number_id(), os.environ.get("WHATSAPP_DISPLAY_PHONE", ""))


async def account_for(db: AsyncSession, phone_number_id: str) -> BoundAccount | None:
    pid = (phone_number_id or "").strip()
    if pid:
        row = (await db.execute(select(WhatsAppAccount).where(
            WhatsAppAccount.phone_number_id == pid, WhatsAppAccount.enabled == True))).scalars().first()  # noqa: E712
        if row:
            return BoundAccount(row.tenant_id, row.agent_id, row.phone_number_id, row.display_phone)
    fallback = env_account()
    if not fallback:
        return None
    if fallback.phone_number_id and pid and fallback.phone_number_id != pid:
        return None  # a number that is not ours
    return BoundAccount(fallback.tenant_id, fallback.agent_id, pid or fallback.phone_number_id,
                        fallback.display_phone)


async def account_for_tenant(db: AsyncSession, tenant_id: str) -> BoundAccount | None:
    row = (await db.execute(select(WhatsAppAccount).where(
        WhatsAppAccount.tenant_id == tenant_id, WhatsAppAccount.enabled == True).order_by(  # noqa: E712
        WhatsAppAccount.created_at))).scalars().first()
    if row:
        return BoundAccount(row.tenant_id, row.agent_id, row.phone_number_id, row.display_phone)
    fallback = env_account()
    return fallback if fallback and fallback.tenant_id == tenant_id else None


async def contact_for(db: AsyncSession, account: BoundAccount, wa_id: str,
                      display_name: str = "") -> WhatsAppContact:
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == account.tenant_id, WhatsAppContact.wa_id == wa_id))).scalars().first()
    if contact:
        contact.last_seen_at = now_iso()
        if display_name:
            contact.display_name = display_name[:120]
        db.add(contact)
        await db.commit()
        return contact
    contact = WhatsAppContact(
        id=str(uuid.uuid4()), tenant_id=account.tenant_id, account_id=account.phone_number_id,
        wa_id=wa_id, user_id=user_id_for(wa_id), display_name=display_name[:120], last_seen_at=now_iso(),
    )
    db.add(contact)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        contact = (await db.execute(select(WhatsAppContact).where(
            WhatsAppContact.tenant_id == account.tenant_id, WhatsAppContact.wa_id == wa_id))).scalars().one()
    return contact


# ── agent bridge ─────────────────────────────────────────────────────
async def agent_reply(db: AsyncSession, account: BoundAccount, contact: WhatsAppContact, text: str) -> str:
    """Run one agent turn through the normal gateway path and return the reply."""
    from starlette.requests import Request

    from nmb_marketplace_agent.api.auth import ChatPrincipal
    from nmb_marketplace_agent.api.routes.public import ChatRequest, chat

    principal = ChatPrincipal(
        tenant_id=account.tenant_id, agent_id=account.agent_id,
        user_id=contact.user_id, auth="session", scope="end_user",
        actor=f"whatsapp:{contact.wa_id}", actor_type="channel",
    )
    request = Request({"type": "http", "method": "POST", "path": "/v1/chat",
                       "headers": [], "query_string": b""})
    result = await chat(ChatRequest(message=text, thread_id=contact.thread_id or None),
                        request, principal, db)
    thread_id = str(result.get("thread_id") or "")
    if thread_id and thread_id != contact.thread_id:
        contact.thread_id = thread_id
        db.add(contact)
        await db.commit()
    reply = str(result.get("reply") or "")
    if reply:
        return reply
    if result.get("handoff"):
        return ""  # staff own the thread now; the bot stays quiet
    if result.get("blocked"):
        return "I can't help with that request here. Please rephrase it or ask to speak to a colleague."
    # Interactive/generative-UI turns pause for a frontend tool the WhatsApp
    # surface cannot render, so fall back to a text prompt.
    return "I can help with that here in text — interactive cards aren't available on WhatsApp. Could you tell me a little more about what you need?"


# ── sending ──────────────────────────────────────────────────────────
def _record(db: AsyncSession, account: BoundAccount, contact: WhatsAppContact | None, wa_id: str,
            body: str, kind: str, provider_id: str, status: str, error: str | None = None) -> WhatsAppMessage:
    row = WhatsAppMessage(
        id=str(uuid.uuid4()), tenant_id=account.tenant_id,
        contact_id=contact.id if contact else "", wa_id=wa_id, direction="out", kind=kind,
        provider_id=provider_id or f"local:{uuid.uuid4()}", status=status,
        body=(body or "")[:MAX_BODY], error=(error or None),
    )
    db.add(row)
    return row


async def send_text(db: AsyncSession, account: BoundAccount, wa_id: str, text: str, *,
                    contact: WhatsAppContact | None = None, kind: str = "text") -> tuple[bool, str]:
    """Send one text message. Simulator mode records the message without calling Meta."""
    body = (text or "").strip()[:MAX_BODY]
    if not body:
        return False, "empty message"
    wa_id = norm_phone(wa_id) or wa_id
    token = access_token()
    if token and account.phone_number_id:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    f"https://graph.facebook.com/{graph_version()}/{account.phone_number_id}/messages",
                    headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
                    json={"messaging_product": "whatsapp", "recipient_type": "individual",
                          "to": wa_id, "type": "text",
                          "text": {"preview_url": False, "body": body}},
                )
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if r.status_code >= 300:
                err = json.dumps(data.get("error") or {"status": r.status_code})[:300]
                row = _record(db, account, contact, wa_id, body, kind, "", "failed", err)
                db.add(row)
                await db.commit()
                return False, err
            provider_id = str(((data.get("messages") or [{}])[0]).get("id") or "")
            row = _record(db, account, contact, wa_id, body, kind, provider_id, "sent")
            db.add(row)
            await db.commit()
            return True, ""
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"[:300]
            row = _record(db, account, contact, wa_id, body, kind, "", "failed", err)
            db.add(row)
            await db.commit()
            return False, err
    if simulator_enabled():
        row = _record(db, account, contact, wa_id, body, kind, f"sim:{uuid.uuid4().hex}", "sent")
        db.add(row)
        await db.commit()
        return True, ""
    return False, "WhatsApp is not configured (set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID)"


async def deliver_outbox(n: Notification, db: AsyncSession | None = None) -> tuple[bool, str]:
    """Notification dispatcher target for channel='whatsapp'."""
    if db is None:
        async with async_session() as own:
            return await deliver_outbox(n, own)
    account = await account_for_tenant(db, n.tenant_id)
    if not account:
        return False, "No WhatsApp number is bound to this tenant"
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == n.tenant_id,
        WhatsAppContact.wa_id == (norm_phone(n.target) or n.target),
    ))).scalars().first()
    body = n.body if not n.subject else f"{n.subject}\n\n{n.body}"
    return await send_text(db, account, n.target, body, contact=contact, kind="task")


# ── notification queue helpers ───────────────────────────────────────
async def _screen(db: AsyncSession, tenant_id: str, text: str) -> str:
    try:
        from nmb_marketplace_agent.enterprise.guardrails import PolicyEngine
        from nmb_marketplace_agent.enterprise.runtime import load_policy

        dec = PolicyEngine(await load_policy(db, tenant_id)).check_text(str(text or ""), "output")
        if dec.blocked:
            return ""
        return str(dec.text if dec.text is not None else text)[:MAX_BODY]
    except Exception:  # fail closed
        log.exception("Could not screen WhatsApp notification text")
        return ""


async def queue_update(db: AsyncSession, tenant_id: str, wa_id: str, subject: str, body: str,
                       *, event: str, ref: str) -> str | None:
    """Queue one WhatsApp outbox row. Returns the row id, or None when deduped."""
    wa_id = norm_phone(wa_id) or wa_id
    if not wa_id:
        return None
    screened = await _screen(db, tenant_id, body)
    if not screened:
        return None
    row = Notification(
        id=str(uuid.uuid4()), tenant_id=tenant_id, event=event, approval_id=ref,
        channel="whatsapp", target=wa_id, subject=subject[:160], body=screened,
        status="pending", next_attempt_at=now_iso(),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return None
    try:
        await audit.record(db, tenant_id=tenant_id, actor="whatsapp", action="notification.queued",
                           resource_type="whatsapp", resource_id=ref,
                           details={"event": event, "target_suffix": wa_id[-4:]})
    except Exception:  # noqa: BLE001
        log.exception("Could not audit WhatsApp notification")
    return row.id


async def queue_task_update(db: AsyncSession, run) -> str | None:
    """A workflow run that belongs to a WhatsApp customer finished: tell them."""
    wa_id = wa_id_for_user(getattr(run, "initiator", ""))
    if not wa_id:
        return None
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == run.tenant_id, WhatsAppContact.wa_id == wa_id))).scalars().first()
    if not contact:
        return None
    outcome = "completed" if run.status == "completed" else (
        "cancelled" if run.status == "cancelled" else "failed")
    label = {"completed": "Task completed", "cancelled": "Task cancelled", "failed": "Task failed"}[outcome]
    ctx_outcome = ""
    try:
        ctx_outcome = str(((run.state or {}).get("ctx") or {}).get("_outcome") or "")
    except Exception:  # noqa: BLE001
        ctx_outcome = ""
    body = (
        f"{label}: {run.workflow_key}.\n"
        + (f"Outcome: {ctx_outcome}.\n" if ctx_outcome else "")
        + f"Reference: {run.id[:8]}\n\n"
        + "Reply here if you need anything else."
    )
    return await queue_update(db, run.tenant_id, wa_id,
                              subject=f"[NMB] {label}: {run.workflow_key}"[:160], body=body,
                              event=f"task.{outcome}", ref=run.id)


# ── webhook payload handling ─────────────────────────────────────────
def parse_payload(payload: dict) -> tuple[list[dict], list[dict]]:
    """Extract (messages, statuses) from a Meta webhook body."""
    messages: list[dict] = []
    statuses: list[dict] = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = (change or {}).get("value") or {}
            metadata = value.get("metadata") or {}
            pid = str(metadata.get("phone_number_id") or "")
            names = {str(c.get("wa_id")): str((c.get("profile") or {}).get("name") or "")
                     for c in (value.get("contacts") or []) if isinstance(c, dict)}
            for m in value.get("messages") or []:
                if not isinstance(m, dict):
                    continue
                messages.append({
                    "phone_number_id": pid,
                    "wa_id": norm_phone(m.get("from")),
                    "provider_id": str(m.get("id") or ""),
                    "type": str(m.get("type") or ""),
                    "text": str(((m.get("text") or {}).get("body")) or
                                ((m.get("button") or {}).get("text")) or
                                ((m.get("interactive") or {}).get("button_reply", {}).get("title")) or ""),
                    "name": names.get(str(m.get("from")), ""),
                })
            for s in value.get("statuses") or []:
                if isinstance(s, dict):
                    statuses.append({"provider_id": str(s.get("id") or ""),
                                     "status": str(s.get("status") or "")})
    return messages, statuses


async def apply_statuses(db: AsyncSession, statuses: list[dict]) -> None:
    for s in statuses:
        if not s["provider_id"]:
            continue
        row = (await db.execute(select(WhatsAppMessage).where(
            WhatsAppMessage.provider_id == s["provider_id"]))).scalars().first()
        if row and s["status"] in ("sent", "delivered", "read", "failed"):
            row.status = s["status"]
            db.add(row)
    await db.commit()


async def handle_message(db: AsyncSession, msg: dict) -> dict:
    """Process one inbound message. Returns a small result dict (reply, thread, status)."""
    wa_id, pid = msg.get("wa_id", ""), msg.get("provider_id", "")
    if not wa_id:
        return {"ok": False, "reason": "no sender"}
    account = await account_for(db, msg.get("phone_number_id", ""))
    if not account or not account.agent_id:
        return {"ok": False, "reason": "no WhatsApp account is bound to this number"}
    contact = await contact_for(db, account, wa_id, msg.get("name", ""))
    thread_id = contact.thread_id  # capture before any rollback expires the row
    text = (msg.get("text") or "").strip()
    if not text:
        if msg.get("type") and msg.get("type") != "text":
            await send_text(db, account, wa_id,
                            "I can read written messages here — please type your question.",
                            contact=contact)
        return {"ok": False, "reason": "no text content", "thread_id": thread_id}
    inbound = WhatsAppMessage(
        id=str(uuid.uuid4()), tenant_id=account.tenant_id, contact_id=contact.id, wa_id=wa_id,
        direction="in", kind="text", provider_id=pid or f"local:{uuid.uuid4()}",
        status="received", body=text[:MAX_BODY],
    )
    db.add(inbound)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"ok": True, "duplicate": True, "thread_id": thread_id}
    try:
        reply = await agent_reply(db, account, contact, text)
    except Exception as e:  # noqa: BLE001
        log.exception("WhatsApp agent turn failed")
        reply = "Sorry — something went wrong on our side. Please try again in a moment."
        await send_text(db, account, wa_id, reply, contact=contact)
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"[:200], "thread_id": thread_id}
    if reply:
        await send_text(db, account, wa_id, reply, contact=contact)
    return {"ok": True, "reply": reply, "thread_id": contact.thread_id or thread_id,
            "tenant_id": account.tenant_id}


async def process_payload(payload: dict) -> None:
    """Background webhook worker: always responds 200 first, then processes."""
    messages, statuses = parse_payload(payload)
    if not messages and not statuses:
        return
    try:
        async with async_session() as db:
            if statuses:
                await apply_statuses(db, statuses)
            for msg in messages:
                await handle_message(db, msg)
    except Exception:  # noqa: BLE001
        log.exception("WhatsApp webhook processing failed")
