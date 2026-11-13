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
from nmb_marketplace_agent.enterprise.api import (
    HandoffReplyIn,
    HandoffResolveIn,
    handoff_claim,
    handoff_reply,
    handoff_resolve,
)
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
