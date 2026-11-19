import sys
import types

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from nmb_marketplace_agent.api import auth
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.api.routes import public
from nmb_marketplace_agent.config.models import (
    AgentConfig,
    ApiKey,
    Handoff,
    HandoffMessage,
    ThreadOwner,
)
from nmb_marketplace_agent.enterprise import handoff as hs
from nmb_marketplace_agent.enterprise import handoffs_api as enterprise_api
from nmb_marketplace_agent.enterprise.handoffs_api import (
    HandoffForwardIn,
    HandoffReplyIn,
    HandoffResolveIn,
    HandoffSummaryIn,
    handoff_claim,
    handoff_detail,
    handoff_forward,
    handoff_reply,
    handoff_resolve,
    handoff_summary,
)
from nmb_marketplace_agent.enterprise.models import ConnectorConfig
from nmb_marketplace_agent.enterprise.rbac import Principal


async def _owner(db, thread="th-1", user="u-1", customer=None, tenant="t1", agent="a1"):
    db.add(ThreadOwner(thread_id=thread, tenant_id=tenant, agent_id=agent,
                       user_id=user, customer_id=customer))
    await db.commit()


async def _request(db, thread="th-1"):
    return await hs.request(
        db, tenant_id="t1", agent_id="a1", thread_id=thread, user_id="u-1",
        customer_id=None, reason="I need a person", actor="session:u-1", actor_type="user")


# ── service ──────────────────────────────────────────────────────────
async def test_request_is_idempotent_while_active(db):
    h1, created = await _request(db)
    assert created and h1.status == "requested"
    assert h1.requested_by == "customer" and h1.reason == "I need a person"

    h2, created2 = await _request(db)
    assert not created2 and h2.id == h1.id
    assert (await hs.active_for(db, "th-1")).id == h1.id


async def test_resolved_handoff_keeps_history_and_allows_a_new_one(db):
    h, _ = await _request(db)
    await hs.resolve(db, h, "op-1")
    assert await hs.active_for(db, "th-1") is None

    h2, created = await _request(db)
    assert created and h2.id != h.id
    assert (await hs.latest_for(db, "th-1")).id == h2.id


async def test_claim_conflict_and_resolve(db):
    h, _ = await _request(db)
    await hs.claim(db, h, "op-1")
    assert h.status == "active" and h.assigned_to == "op-1"

    with pytest.raises(hs.HandoffError):
        await hs.claim(db, h, "op-2")

    await hs.resolve(db, h, "op-1")
    assert h.status == "resolved" and h.resolved_at
    with pytest.raises(hs.HandoffError):
        await hs.claim(db, h, "op-2")


async def test_staff_replies_are_screened_like_bot_output(db):
    with pytest.raises(hs.HandoffError):
        await hs.screen_reply(db, "t1", "here is the key sk-ABCDEFGHIJKLMNOPQRSTUVWX")
    assert await hs.screen_reply(db, "t1", "We have raised your limit.") == "We have raised your limit."


# ── share: compression + forwarding ──────────────────────────────────
async def _conversation(db):
    await _owner(db)
    h, _ = await _request(db)
    await hs.add_message(db, h, role="customer", author="u-1",
                         text="My salary was not credited on 1 November and I am now short on rent. "
                              "I have called the branch twice and both times I was told to wait. "
                              "The transfer reference is NMB-4471 and it left my employer on 31 October. "
                              "My account ending 0042 shows the credit from October but nothing since. "
                              "Please can someone check whether the payment is stuck in the clearing queue, "
                              "because my landlord needs the money by Friday and I cannot make another trip "
                              "to the branch during working hours. I also sent an email on Monday with the "
                              "payslip attached but have not received any reply yet.")
    await hs.add_message(db, h, role="staff", author="op-1",
                         text="I can see the transfer is still pending at the clearing house.")
    return h


async def test_summary_is_local_extractive_and_keeps_the_essentials(db):
    h = await _conversation(db)
    rows = await hs.messages(db, h.id)
    out = hs.summarize(h, rows)

    assert out["method"] == "extractive" and out["message_count"] == 2
    text = out["summary"]
    assert "Conversation summary" in text
    assert "Why a human stepped in: I need a person" in text
    assert "What the customer needs:" in text and "salary was not credited" in text
    assert "What staff replied:" in text and "clearing house" in text
    assert out["chars_after"] == len(text) and 0 < out["compression"] < 1
    assert out["chars_before"] > out["chars_after"]


async def test_summary_endpoint_respects_the_limit_and_tenant(db):
    h = await _conversation(db)
    op = Principal("op-1", "t1", {"operator"}, "jwt")
    out = await handoff_summary(h.id, HandoffSummaryIn(max_chars=400), op, db)
    assert out["method"] == "extractive" and len(out["summary"]) <= 400

    other = Principal("op-2", "t2", {"operator"}, "jwt")
    with pytest.raises(HTTPException) as err:
        await handoff_summary(h.id, HandoffSummaryIn(), other, db)
    assert err.value.status_code == 404


async def test_forward_to_email_and_copy_is_recorded_on_the_conversation(db):
    h = await _conversation(db)
    admin = Principal("admin-1", "t1", {"tenant_admin"}, "jwt")

    with pytest.raises(HTTPException) as err:
        await handoff_forward(h.id, HandoffForwardIn(channel="email"), admin, db)
    assert err.value.status_code == 422

    out = await handoff_forward(h.id, HandoffForwardIn(
        channel="email", recipient="ops@bank.example", subject="Duplicate debit",
        compress=True, summary="Duplicate debit; salary transfer NMB-4471 still pending."), admin, db)
    assert out["ok"] and out["channel"] == "email" and out["recipient"] == "ops@bank.example"

    out = await handoff_forward(h.id, HandoffForwardIn(channel="copy", subject="Copied export"), admin, db)
    assert out["ok"] and out["channel"] == "copy"

    detail = await handoff_detail(h.id, admin, db)
    assert [f["channel"] for f in detail["forwards"]] == ["copy", "email"]  # newest first
    email = detail["forwards"][1]
    assert email["recipient"] == "o***@bank.example"  # masked hint, address stays out of the audit chain
    assert email["compressed"] is True
    assert email["summary_chars"] == len("Duplicate debit; salary transfer NMB-4471 still pending.")
    assert email["messages"] == 2


# ── gateway ──────────────────────────────────────────────────────────
class FakeClient:
    def __init__(self):
        self.threads = self
        self.runs = self
        self.wait_calls = 0
        self._n = 0

    async def create(self, metadata=None):
        self._n += 1
        return {"thread_id": f"thread-{self._n}"}

    async def wait(self, **_kw):
        self.wait_calls += 1
        return {"messages": [{"type": "ai", "content": "Hello again."}]}

    async def stream(self, **_kw):
        for _ in ():
            yield None


@pytest.fixture
async def api(db, monkeypatch):
    db.add(ApiKey(id="k1", tenant_id="t1", agent_id="a1", kind="secret",
                  prefix="sk_test", key_hash=auth.hash_key("sk_test_raw")))
    db.add(AgentConfig(id="a1", name="a", tenant_id="t1"))
    await db.commit()

    fake = FakeClient()
    monkeypatch.setitem(sys.modules, "langgraph_sdk",
                        types.SimpleNamespace(get_client=lambda url: fake))

    app = FastAPI()
    app.include_router(public.router, prefix="/v1")
    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, fake


H = {"x-api-key": "sk_test_raw"}


async def test_request_requires_thread_ownership(api, db):
    client, _ = api
    await _owner(db)

    r = await client.post("/v1/handoff", json={"thread_id": "th-1", "user_id": "u-1"}, headers=H)
    assert r.status_code == 200
    assert r.json()["created"] is True and r.json()["handoff"]["status"] == "requested"

    r = await client.post("/v1/handoff", json={"thread_id": "th-1", "user_id": "u-1"}, headers=H)
    assert r.json()["created"] is False

    r = await client.post("/v1/handoff", json={"thread_id": "missing", "user_id": "u-1"}, headers=H)
    assert r.status_code == 404

    r = await client.post("/v1/handoff", json={"thread_id": "th-1", "user_id": "someone-else"}, headers=H)
    assert r.status_code == 404


async def test_chat_pauses_the_bot_and_stores_the_customer_turn(api, db):
    client, fake = api
    await _owner(db)
    await _request(db)

    r = await client.post("/v1/chat", json={"message": "hello?", "thread_id": "th-1", "user_id": "u-1"}, headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == "" and body["handoff"]["status"] == "requested"
    assert body["message_id"]
    assert fake.wait_calls == 0

    rows = (await db.execute(select(HandoffMessage))).scalars().all()
    assert len(rows) == 1 and rows[0].role == "customer" and rows[0].text == "hello?"


async def test_chat_sse_emits_handoff_instead_of_tokens(api, db):
    client, fake = api
    await _owner(db)
    await _request(db)

    r = await client.post("/v1/chat", json={"message": "anyone there?", "thread_id": "th-1", "user_id": "u-1"},
                          headers={**H, "accept": "text/event-stream"})
    assert r.status_code == 200
    assert '"type": "handoff"' in r.text
    assert '"type": "token"' not in r.text
    assert r.text.rstrip().endswith("[DONE]")
    assert fake.wait_calls == 0


async def test_poll_returns_staff_replies_and_resolution_resumes_the_bot(api, db):
    client, fake = api
    await _owner(db)
    h, _ = await _request(db)
    await hs.claim(db, h, "op-1")
    await hs.add_message(db, h, role="staff", author="op-1", text="Hi, this is Amina from the bank.")

    r = await client.get("/v1/handoff/th-1?user_id=u-1", headers=H)
    assert r.status_code == 200
    data = r.json()
    assert data["handoff"]["status"] == "active"
    assert [m["role"] for m in data["messages"]] == ["staff"]
    assert data["messages"][0]["text"].startswith("Hi, this is Amina")

    r = await client.get("/v1/handoff/th-1?user_id=someone-else", headers=H)
    assert r.status_code == 404

    await hs.resolve(db, h, "op-1")
    r = await client.get("/v1/handoff/th-1?user_id=u-1", headers=H)
    assert r.json()["handoff"]["status"] == "resolved"

    r = await client.post("/v1/chat", json={"message": "thanks", "thread_id": "th-1", "user_id": "u-1"}, headers=H)
    assert r.status_code == 200
    assert r.json()["reply"] == "Hello again."
    assert fake.wait_calls == 1


# ── staff API ────────────────────────────────────────────────────────
async def test_staff_claim_reply_resolve(db):
    await _owner(db)
    h, _ = await _request(db)
    op = Principal("op-1", "t1", {"operator"}, "jwt")

    with pytest.raises(HTTPException) as err:
        await handoff_reply(h.id, HandoffReplyIn(text="too early"), op, db)
    assert err.value.status_code == 409

    await handoff_claim(h.id, op, db)
    out = await handoff_reply(h.id, HandoffReplyIn(text="Hello from the bank."), op, db)
    assert out["message"]["role"] == "staff" and out["message"]["author"] == "op-1"

    stranger = Principal("op-2", "t1", {"operator"}, "jwt")
    with pytest.raises(HTTPException) as err:
        await handoff_reply(h.id, HandoffReplyIn(text="hijack"), stranger, db)
    assert err.value.status_code == 403

    await handoff_resolve(h.id, HandoffResolveIn(note="done"), op, db)
    assert (await db.get(Handoff, h.id)).status == "resolved"


async def test_forward_sends_transcript_through_connector(db, monkeypatch):
    await _owner(db)
    h, _ = await _request(db)
    await hs.add_message(db, h, role="staff", author="op-1", text="Hello from the bank.")
    db.add(ConnectorConfig(id="t1:crm", tenant_id="t1", name="crm", type="rest", enabled=True,
                           config={"operations": {"create_case": {"method": "POST", "path": "/cases"}}}))
    await db.commit()

    seen: dict = {}

    class Stub:
        async def call(self, operation, params):
            seen["operation"] = operation
            seen["params"] = params
            return {"ok": True, "id": "case-1"}

    monkeypatch.setattr(enterprise_api, "build_connector", lambda *a, **k: Stub())
    admin = Principal("admin-1", "t1", {"tenant_admin"}, "jwt")
    out = await handoff_forward(h.id, HandoffForwardIn(connector="crm", subject="Duplicate debit"), admin, db)

    assert out["ok"] and out["operation"] == "create_case" and out["connector"] == "crm"
    body = seen["params"]["body"]
    assert body["subject"] == "Duplicate debit"
    assert body["handoff_id"] == h.id
    assert "Hello from the bank." in body["transcript"]

    with pytest.raises(HTTPException) as err:
        await handoff_forward(h.id, HandoffForwardIn(connector="crm", operation="nope"), admin, db)
    assert err.value.status_code == 422
