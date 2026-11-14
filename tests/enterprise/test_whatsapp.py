import hashlib
import hmac
from types import SimpleNamespace

from sqlmodel import select

from nmb_marketplace_agent.enterprise import whatsapp
from nmb_marketplace_agent.enterprise.models import (
    Notification,
    WhatsAppAccount,
    WhatsAppContact,
    WhatsAppMessage,
    WorkflowRun,
)
from nmb_marketplace_agent.enterprise.workflows.engine import WorkflowEngine

WA = "254712345678"
PID = "1234567890"


def _bind(db, tenant="t1", agent="ag1"):
    db.add(WhatsAppAccount(id="acc-1", tenant_id=tenant, agent_id=agent, phone_number_id=PID))
    return WhatsAppContact(id="c-1", tenant_id=tenant, account_id=PID, wa_id=WA,
                           user_id=whatsapp.user_id_for(WA))


def test_norm_phone_and_user_id():
    assert whatsapp.norm_phone("+254 712 345 678") == WA
    assert whatsapp.norm_phone("123") == ""
    assert whatsapp.user_id_for(WA) == f"wa:{WA}"
    assert whatsapp.wa_id_for_user(f"wa:{WA}") == WA
    assert whatsapp.wa_id_for_user("alice") == ""


def test_signature_is_fail_closed(monkeypatch):
    raw = b'{"entry":[]}'
    monkeypatch.setenv("WHATSAPP_APP_SECRET", "s3cret")
    sig = "sha256=" + hmac.new(b"s3cret", raw, hashlib.sha256).hexdigest()
    assert whatsapp.verify_signature(raw, sig)
    assert not whatsapp.verify_signature(raw, sig[:-1] + "0")

    monkeypatch.delenv("WHATSAPP_APP_SECRET")
    monkeypatch.delenv("WHATSAPP_UNSIGNED_WEBHOOKS", raising=False)
    assert not whatsapp.verify_signature(raw, "")
    monkeypatch.setenv("WHATSAPP_UNSIGNED_WEBHOOKS", "1")
    assert whatsapp.verify_signature(raw, "")


def test_parse_payload_extracts_messages_and_statuses():
    payload = {"entry": [{"changes": [{"value": {
        "metadata": {"phone_number_id": PID},
        "contacts": [{"wa_id": WA, "profile": {"name": "Wanjiku"}}],
        "messages": [{"from": WA, "id": "wamid.1", "type": "text", "text": {"body": "hello"}},
                     {"from": WA, "id": "wamid.2", "type": "interactive",
                      "interactive": {"button_reply": {"title": "Check status"}}}],
        "statuses": [{"id": "wamid.3", "status": "delivered"}],
    }}]}]}
    messages, statuses = whatsapp.parse_payload(payload)
    assert [m["text"] for m in messages] == ["hello", "Check status"]
    assert messages[0]["name"] == "Wanjiku"
    assert statuses == [{"provider_id": "wamid.3", "status": "delivered"}]


async def test_inbound_message_bridges_to_agent_and_dedupes(db, monkeypatch):
    monkeypatch.setenv("WHATSAPP_SIMULATOR", "1")
    db.add(_bind(db))
    await db.commit()

    async def fake_reply(db_, account, contact, text):
        assert text == "Hi, check my application"
        assert account.tenant_id == "t1"
        return "Your application is in review."

    monkeypatch.setattr(whatsapp, "agent_reply", fake_reply)
    msg = {"phone_number_id": PID, "wa_id": WA, "provider_id": "wamid.10",
           "type": "text", "text": "Hi, check my application", "name": "Wanjiku"}

    res = await whatsapp.handle_message(db, msg)
    assert res["ok"] and res["reply"] == "Your application is in review."

    rows = (await db.execute(select(WhatsAppMessage).order_by(WhatsAppMessage.created_at))).scalars().all()
    assert [m.direction for m in rows] == ["in", "out"]
    assert rows[1].body == "Your application is in review."
    assert rows[1].status == "sent"

    again = await whatsapp.handle_message(db, msg)
    assert again == {"ok": True, "duplicate": True, "thread_id": ""}
    assert len((await db.execute(select(WhatsAppMessage))).scalars().all()) == 2


async def test_outbox_delivers_whatsapp_via_simulator(db, monkeypatch):
    monkeypatch.setenv("WHATSAPP_SIMULATOR", "1")
    db.add(_bind(db))
    await db.commit()
    n = Notification(id="n-1", tenant_id="t1", event="approval.requested",
                     approval_id="a-1", channel="whatsapp", target=WA,
                     subject="Approval needed", body="Please review.", status="pending",
                     next_attempt_at="2000-01-01T00:00:00.000000Z")
    db.add(n)
    await db.commit()

    ok, err = await whatsapp.deliver_outbox(n, db)
    assert ok and err == ""
    sent = (await db.execute(select(WhatsAppMessage).where(
        WhatsAppMessage.direction == "out"))).scalars().all()
    assert len(sent) == 1
    assert sent[0].kind == "task"
    assert "Approval needed" in sent[0].body and "Please review." in sent[0].body
    assert sent[0].status == "sent"


async def test_queue_task_update_only_for_whatsapp_runs(db):
    db.add(_bind(db))
    await db.commit()
    run = WorkflowRun(id="run-1234567890", tenant_id="t1", workflow_key="kyc_onboarding",
                      status="completed", initiator=f"wa:{WA}",
                      state={"ctx": {"_outcome": "approved"}})
    db.add(run)
    await db.commit()

    nid = await whatsapp.queue_task_update(db, run)
    assert nid
    n = await db.get(Notification, nid)
    assert n.channel == "whatsapp" and n.target == WA
    assert n.event == "task.completed"
    assert "kyc_onboarding" in n.subject and "approved" in n.body
    assert await whatsapp.queue_task_update(db, run) is None  # unique per run+event

    other = WorkflowRun(id="run-2", tenant_id="t1", workflow_key="kyc_onboarding",
                        status="completed", initiator="alice")
    db.add(other)
    await db.commit()
    assert await whatsapp.queue_task_update(db, other) is None


async def test_engine_hook_is_gated(monkeypatch):
    db = SimpleNamespace()
    run = WorkflowRun(id="run-1", tenant_id="t1", workflow_key="kyc_onboarding",
                      status="completed", initiator=f"wa:{WA}")

    called = []

    async def tracking(db_, run_):
        called.append(run_.id)
        return "n-1"

    monkeypatch.setattr(whatsapp, "queue_task_update", tracking)

    holder = SimpleNamespace(db=db, rt=SimpleNamespace(shadow=False))
    await WorkflowEngine._notify_whatsapp(holder, run)
    assert called == ["run-1"]

    holder.rt.shadow = True
    await WorkflowEngine._notify_whatsapp(holder, run)
    assert called == ["run-1"]

    run.initiator = "alice"
    holder.rt.shadow = False
    await WorkflowEngine._notify_whatsapp(holder, run)
    assert called == ["run-1"]
