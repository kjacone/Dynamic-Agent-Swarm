import sys
import types

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from nmb_marketplace_agent.api import auth
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.api.routes import public
from nmb_marketplace_agent.config.models import AgentConfig, AgentVersion, ApiKey, ThreadOwner
from nmb_marketplace_agent.enterprise.sessions import decode_session, mint_session


class FakeClient:
    """Stands in for the LangGraph SDK so chat tests stay offline."""

    def __init__(self):
        self.threads = self
        self.runs = self
        self.calls: list[dict] = []
        self._n = 0

    async def create(self, metadata=None):
        self._n += 1
        return {"thread_id": f"thread-{self._n}"}

    async def wait(self, **kw):
        self.calls.append(kw)
        return {"messages": [{"type": "ai", "content": "Hello."}]}


@pytest.fixture
async def api(db, monkeypatch):
    db.add(AgentConfig(id="a1", name="Default assistant", tenant_id="t1"))
    db.add(AgentConfig(id="a2", name="Billing assistant", tenant_id="t1"))
    db.add(AgentConfig(id="a3", name="Draft assistant", tenant_id="t1"))
    db.add(AgentConfig(id="a4", name="Other tenant", tenant_id="t2"))
    db.add(AgentVersion(id="v2", agent_id="a2", tenant_id="t1", version=1, published=True))
    db.add(AgentVersion(id="v4", agent_id="a4", tenant_id="t2", version=1, published=True))
    db.add(ApiKey(id="k1", tenant_id="t1", agent_id="a1", kind="secret",
                  prefix="sk_test", key_hash=auth.hash_key("sk_test_raw")))
    db.add(ApiKey(id="k2", tenant_id="t1", agent_id="a1", kind="publishable",
                  prefix="pk_test", key_hash=auth.hash_key("pk_test_raw"),
                  allowed_origins=["*"]))
    await db.commit()

    fake = FakeClient()
    monkeypatch.setitem(sys.modules, "langgraph_sdk",
                        types.SimpleNamespace(get_client=lambda url: fake))

    app = FastAPI()
    app.include_router(public.router, prefix="/v1")
    app.dependency_overrides[get_db] = lambda: db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, fake


def _session(agent_id: str = "a1", user: str = "u1") -> str:
    token, _ = mint_session(tenant_id="t1", agent_id=agent_id, key_id="k1",
                            subject=user, scope="end_user")
    return token


PK = {"x-api-key": "pk_test_raw"}
SK = {"x-api-key": "sk_test_raw"}


# ── discovery ───────────────────────────────────────────────────────
async def test_agents_lists_the_keys_own_and_published_agents(api):
    client, _fake = api
    r = await client.get("/v1/agents", headers=PK)
    assert r.status_code == 200
    body = r.json()
    assert body["default_agent_id"] == "a1"
    assert [a["id"] for a in body["agents"]] == ["a1", "a2"]
    assert body["agents"][0]["default"] is True
    assert body["agents"][1] == {"id": "a2", "name": "Billing assistant", "default": False}


async def test_agents_requires_a_key(api):
    client, _fake = api
    r = await client.get("/v1/agents")
    assert r.status_code == 401


# ── sessions ────────────────────────────────────────────────────────
async def test_session_can_target_a_listed_agent(api):
    client, _fake = api
    r = await client.post("/v1/session", json={"user_id": "u1", "agent_id": "a2"}, headers=PK)
    assert r.status_code == 200
    body = r.json()
    assert body["agent_id"] == "a2"
    assert decode_session(body["token"])["agent_id"] == "a2"


async def test_session_rejects_an_agent_outside_the_list(api):
    client, _fake = api
    r = await client.post("/v1/session", json={"user_id": "u1", "agent_id": "a3"}, headers=PK)
    assert r.status_code == 403


async def test_session_defaults_to_the_keys_agent(api):
    client, _fake = api
    r = await client.post("/v1/session", json={"user_id": "u1"}, headers=PK)
    assert r.status_code == 200
    assert r.json()["agent_id"] == "a1"


# ── chat ────────────────────────────────────────────────────────────
async def test_chat_with_a_raw_key_can_pick_a_listed_agent(api, db):
    client, fake = api
    r = await client.post("/v1/chat", json={"message": "hi", "agent_id": "a2"}, headers=SK)
    assert r.status_code == 200
    owner = await db.get(ThreadOwner, r.json()["thread_id"])
    assert owner.agent_id == "a2"
    assert fake.calls[0]["config"]["configurable"]["agent_id"] == "a2"


async def test_chat_rejects_an_agent_outside_the_list(api):
    client, _fake = api
    r = await client.post("/v1/chat", json={"message": "hi", "agent_id": "a3"}, headers=SK)
    assert r.status_code == 403


async def test_session_chats_with_the_agent_it_was_minted_for(api, db):
    client, fake = api
    r = await client.post("/v1/chat", json={"message": "hi"},
                          headers={"authorization": f"Bearer {_session('a2')}"})
    assert r.status_code == 200
    owner = await db.get(ThreadOwner, r.json()["thread_id"])
    assert owner.agent_id == "a2"
    assert fake.calls[0]["config"]["configurable"]["agent_id"] == "a2"


async def test_session_cannot_switch_agent_in_the_body(api):
    client, _fake = api
    r = await client.post("/v1/chat", json={"message": "hi", "agent_id": "a2"},
                          headers={"authorization": f"Bearer {_session('a1')}"})
    assert r.status_code == 403
