"""WhatsApp channel: accounts, contacts, transcripts and tasks."""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise import notifications as notification_service
from nmb_marketplace_agent.enterprise import whatsapp as whatsapp_service
from nmb_marketplace_agent.enterprise.api_common import _bg, _engine, _wf_err
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    Notification,
    WhatsAppAccount,
    WhatsAppContact,
    WhatsAppMessage,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires
from nmb_marketplace_agent.enterprise.workflows.engine import (
    WorkflowError,
)
from nmb_marketplace_agent.enterprise.workflows_api import _run_view

router = APIRouter()




# ── WhatsApp channel ─────────────────────────────────────────────────
class WhatsAppAccountIn(BaseModel):
    phone_number_id: str = Field(min_length=3, max_length=64, pattern="^[0-9]+$")
    agent_id: str = Field(min_length=1, max_length=128)
    display_phone: str = Field(default="", max_length=32)
    enabled: bool = True


class WhatsAppSimulateIn(BaseModel):
    wa_id: str = Field(min_length=7, max_length=24)
    text: str = Field(min_length=1, max_length=3900)
    display_name: str = Field(default="", max_length=120)


class WhatsAppNotifyIn(BaseModel):
    wa_id: str = Field(min_length=7, max_length=24)
    text: str = Field(min_length=1, max_length=2000)
    subject: str = Field(default="[NMB] Account update", max_length=160)


class WhatsAppTaskIn(BaseModel):
    wa_id: str = Field(min_length=7, max_length=24)
    workflow_key: str = Field(min_length=1, max_length=128)
    inputs: dict[str, Any] = Field(default_factory=dict)
    wait: bool = False


def _wa_id_or_422(value: str) -> str:
    wa_id = whatsapp_service.norm_phone(value)
    if not wa_id:
        raise HTTPException(422, "Use an international phone number, digits only")
    return wa_id


@router.get("/whatsapp/config", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_config(p: Principal = Depends(requires("connectors:read")),
                          db: AsyncSession = Depends(get_db)):
    bound = (await db.execute(select(WhatsAppAccount).where(
        WhatsAppAccount.tenant_id == p.tenant_id, WhatsAppAccount.enabled == True))).scalars().all()  # noqa: E712
    return {
        "graph_configured": whatsapp_service.graph_configured(),
        "simulator": whatsapp_service.simulator_enabled(),
        "app_secret_set": bool(whatsapp_service.app_secret()),
        "verify_token_set": bool(whatsapp_service.verify_token()),
        "unsigned_webhooks_allowed": whatsapp_service.unsigned_webhooks_allowed(),
        "webhook_path": "/whatsapp/webhook",
        "bound_numbers": len(bound),
    }


@router.get("/whatsapp/accounts", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_accounts(p: Principal = Depends(requires("connectors:read")),
                            db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(WhatsAppAccount).where(
        WhatsAppAccount.tenant_id == p.tenant_id).order_by(WhatsAppAccount.created_at))).scalars().all()
    return rows


@router.post("/whatsapp/accounts", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_account_save(body: WhatsAppAccountIn, p: Principal = Depends(requires("connectors:write")),
                                db: AsyncSession = Depends(get_db)):
    from nmb_marketplace_agent.config.models import AgentConfig

    agent = await db.get(AgentConfig, body.agent_id)
    if not agent or agent.tenant_id != p.tenant_id:
        raise HTTPException(422, "Pick an agent that belongs to this tenant")
    pid = body.phone_number_id.strip()
    row = (await db.execute(select(WhatsAppAccount).where(
        WhatsAppAccount.phone_number_id == pid))).scalars().first()
    if row and row.tenant_id != p.tenant_id:
        raise HTTPException(409, "That WhatsApp number is bound to another tenant")
    if not row:
        row = WhatsAppAccount(id=str(uuid.uuid4()), tenant_id=p.tenant_id, phone_number_id=pid)
    row.agent_id = body.agent_id
    row.display_phone = body.display_phone.strip() or whatsapp_service.norm_phone(body.display_phone)
    row.enabled = body.enabled
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="whatsapp.account_saved",
                       resource_type="whatsapp_account", resource_id=row.id,
                       details={"agent_id": row.agent_id, "enabled": row.enabled})
    return row


@router.delete("/whatsapp/accounts/{account_id}", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_account_delete(account_id: str, p: Principal = Depends(requires("connectors:write")),
                                  db: AsyncSession = Depends(get_db)):
    row = await db.get(WhatsAppAccount, account_id)
    if not row or row.tenant_id != p.tenant_id:
        raise HTTPException(404, "Account not found")
    await db.delete(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="whatsapp.account_deleted",
                       resource_type="whatsapp_account", resource_id=account_id, details={})
    return {"deleted": account_id}


@router.get("/whatsapp/contacts", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_contacts(p: Principal = Depends(requires("connectors:read")),
                            db: AsyncSession = Depends(get_db)):
    contacts = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id).order_by(
        WhatsAppContact.last_seen_at.desc()).limit(200))).scalars().all()
    counts: dict[str, int] = {}
    if contacts:
        counts = dict((await db.execute(
            select(WhatsAppMessage.contact_id, func.count(WhatsAppMessage.id))
            .where(WhatsAppMessage.tenant_id == p.tenant_id)
            .group_by(WhatsAppMessage.contact_id))).all())
    return [c.model_dump() | {"message_count": int(counts.get(c.id, 0))} for c in contacts]


@router.get("/whatsapp/contacts/{wa_id}/messages", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_transcript(wa_id: str, limit: int = 100,
                              p: Principal = Depends(requires("connectors:read")),
                              db: AsyncSession = Depends(get_db)):
    wa = _wa_id_or_422(wa_id)
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id, WhatsAppContact.wa_id == wa))).scalars().first()
    if not contact:
        raise HTTPException(404, "Contact not found")
    rows = (await db.execute(select(WhatsAppMessage).where(
        WhatsAppMessage.tenant_id == p.tenant_id, WhatsAppMessage.contact_id == contact.id,
    ).order_by(WhatsAppMessage.created_at.desc()).limit(min(limit, 500)))).scalars().all()
    messages = [{"id": m.id, "direction": m.direction, "kind": m.kind, "status": m.status,
                 "body": m.body, "created_at": m.created_at, "error": m.error}
                for m in reversed(rows)]
    return {"contact": contact, "messages": messages}


@router.post("/whatsapp/simulate", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_simulate(body: WhatsAppSimulateIn, p: Principal = Depends(requires("connectors:write")),
                            db: AsyncSession = Depends(get_db)):
    """Feed an inbound WhatsApp message through the real webhook path (demo/testing)."""
    if not whatsapp_service.simulator_enabled() and not whatsapp_service.graph_configured():
        raise HTTPException(409, "WhatsApp is not configured on this deployment")
    account = await whatsapp_service.account_for_tenant(db, p.tenant_id)
    if not account:
        raise HTTPException(409, "Bind a WhatsApp number to an agent first")
    result = await whatsapp_service.handle_message(db, {
        "phone_number_id": account.phone_number_id,
        "wa_id": _wa_id_or_422(body.wa_id),
        "provider_id": f"sim:{uuid.uuid4().hex}",
        "type": "text",
        "text": body.text,
        "name": body.display_name,
    })
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id,
        WhatsAppContact.wa_id == _wa_id_or_422(body.wa_id)))).scalars().first()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="whatsapp.simulated_inbound",
                       resource_type="whatsapp", resource_id=contact.id if contact else "",
                       details={"ok": result.get("ok", False)})
    return result | {"contact_id": contact.id if contact else ""}


@router.post("/whatsapp/notify", dependencies=[Depends(require_module("connectors"))])
async def whatsapp_notify(body: WhatsAppNotifyIn, p: Principal = Depends(requires("connectors:write")),
                          db: AsyncSession = Depends(get_db)):
    """Queue a proactive update and try to deliver it immediately."""
    wa = _wa_id_or_422(body.wa_id)
    account = await whatsapp_service.account_for_tenant(db, p.tenant_id)
    if not account:
        raise HTTPException(409, "Bind a WhatsApp number to an agent first")
    contact = (await db.execute(select(WhatsAppContact).where(
        WhatsAppContact.tenant_id == p.tenant_id, WhatsAppContact.wa_id == wa))).scalars().first()
    if not contact:
        raise HTTPException(404, "This customer has not messaged this agent yet")
    nid = await whatsapp_service.queue_update(
        db, p.tenant_id, wa, body.subject.strip(), body.text.strip(),
        event="console.update", ref=f"console:{uuid.uuid4().hex[:12]}",
    )
    if not nid:
        raise HTTPException(422, "The message was blocked by the output guardrails")
    await notification_service.dispatch_due(limit=20)
    row = await db.get(Notification, nid)
    return {"id": nid, "status": row.status if row else "pending",
            "attempts": row.attempts if row else 0, "error": row.last_error if row else None}


@router.post("/whatsapp/tasks", dependencies=[Depends(require_module("workflows"))])
async def whatsapp_task(body: WhatsAppTaskIn, p: Principal = Depends(requires("workflows:run")),
                        db: AsyncSession = Depends(get_db)):
    """Start a workflow on behalf of a WhatsApp customer so completion reaches them."""
    wa = _wa_id_or_422(body.wa_id)
    account = await whatsapp_service.account_for_tenant(db, p.tenant_id)
    if not account:
        raise HTTPException(409, "Bind a WhatsApp number to an agent first")
    await whatsapp_service.contact_for(db, account, wa)
    eng = await _engine(db, p.tenant_id)
    try:
        run = await eng.start(body.workflow_key, body.inputs, whatsapp_service.user_id_for(wa),
                              run_now=body.wait)
    except WorkflowError as e:
        raise _wf_err(e) from e
    if not body.wait:
        async def _bg_run(run_id: str):
            from nmb_marketplace_agent.config.database import async_session
            async with async_session() as s:
                try:
                    await (await _engine(s, p.tenant_id)).advance(run_id)
                except Exception:  # noqa: BLE001 - failure is recorded on the run by the engine
                    pass
        t = asyncio.create_task(_bg_run(run.id))
        _bg.add(t)
        t.add_done_callback(_bg.discard)
    return _run_view(run) | {"wa_id": wa, "initiator": whatsapp_service.user_id_for(wa)}
