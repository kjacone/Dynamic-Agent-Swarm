import sys
import types

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from nmb_marketplace_agent.api import auth
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.api.routes import public
from nmb_marketplace_agent.config.models import ApiKey
from nmb_marketplace_agent.enterprise.sessions import mint_session

FRONTEND = {"type": "tool", "tool_call": {"id": "call-1", "name": "get_map_view", "args": {"zoom": 3}}}


class FakeClient:
    """LangGraph SDK stand-in that pauses on one frontend tool."""

    def __init__(self):
        self.threads = self
        self.runs = self
        self.calls: list[tuple] = []
        self.tasks = [{"interrupts": [
            {"id": "int-1", "value": FRONTEND},
            {"id": "approval-1", "value": {"action_requests": [{"name": "refund"}]}},
        ]}]

    async def create(self, metadata=None):
        return {"thread_id": "thread-1"}

    async def get_state(self, thread_id):
        return {"tasks": self.tasks}

    async def wait(self, **_kw):
        return {"messages": [{"type": "ai", "content": "ok"}]}

    async def stream(self, **kw):
        self.calls.append((kw.get("input"), kw.get("command")))
        if kw.get("command"):
            yield types.SimpleNamespace(event="messages",
                                        data=(types.SimpleNamespace(type="ai", content="Here is your map."),))
        else:
            yield types.SimpleNamespace(event="messages",
                                        data=(types.SimpleNamespace(type="ai", content="Opening the map."),))
            yield types.SimpleNamespace(event="updates", data={"__interrupt__": (
                types.SimpleNamespace(id="int-1", value=FRONTEND),)})


@pytest.fixture
async def api(db, monkeypatch):
    key = ApiKey(id="k1", tenant_id="t1", agent_id="a1", kind="publishable",
                 prefix="pk_test", key_hash=auth.hash_key("pk_test_raw"), allowed_origins=["*"])
    db.add(key)
    await db.commit()

    fake = FakeClient()
    monkeypatch.setitem(sys.modules, "langgraph_sdk",
                        types.SimpleNamespace(get_client=lambda url: fake))

    app = FastAPI()
    app.include_router(public.router, prefix="/v1")
    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, fake


def _token(user: str = "u1") -> str:
    token, _ = mint_session(tenant_id="t1", agent_id="a1", key_id="k1", subject=user, scope="public")
    return token


async def _start_turn(client: AsyncClient) -> str:
    r = await client.post("/v1/chat", json={"message": "show me the map"},
                          headers={"authorization": f"Bearer {_token()}", "accept": "text/event-stream"})
    assert r.status_code == 200
    return r.text


async def test_chat_streams_the_frontend_interrupt(api):
    client, fake = api
    body = await _start_turn(client)
    assert '"type": "thread"' in body and '"type": "interrupt"' in body
    assert "int-1" in body and "get_map_view" in body
    assert '"type": "sources"' not in body
    assert '"text": "Opening the map."' in body


async def test_resume_continues_the_paused_run(api, db):
    client, fake = api
    await _start_turn(client)

    from nmb_marketplace_agent.config.models import ThreadOwner
    owner = await db.get(ThreadOwner, "thread-1")
    assert owner is not None

    r = await client.post("/v1/chat/resume", json={
        "thread_id": "thread-1",
        "resume": {"int-1": {"call-1": {"center": [1, 2]}}},
    }, headers={"authorization": f"Bearer {_token()}", "accept": "text/event-stream"})
    assert r.status_code == 200
    assert '"text": "Here is your map."' in r.text

    assert fake.calls[-1][1] == {"resume": {"int-1": {"call-1": {"center": [1, 2]}}}}


async def test_resume_requires_a_pending_frontend_call(api):
    client, fake = api
    await _start_turn(client)
    fake.tasks = [{"interrupts": [{"id": "approval-1", "value": {"action_requests": []}}]}]

    r = await client.post("/v1/chat/resume", json={"thread_id": "thread-1", "resume": {"approval-1": {}}},
                          headers={"authorization": f"Bearer {_token()}", "accept": "text/event-stream"})
    assert r.status_code == 409


async def test_resume_is_scoped_to_the_thread_owner(api):
    client, _fake = api
    await _start_turn(client)

    r = await client.post("/v1/chat/resume", json={"thread_id": "thread-1", "resume": "x"},
                          headers={"authorization": f"Bearer {_token('someone-else')}",
                                   "accept": "text/event-stream"})
    assert r.status_code == 404
