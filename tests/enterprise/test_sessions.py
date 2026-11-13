import sys
import types

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from nmb_marketplace_agent.api import auth
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.api.routes import public
from nmb_marketplace_agent.config.models import ApiKey, Feedback, ThreadOwner
from nmb_marketplace_agent.enterprise.guardrails import OutputStreamGuard, PolicyEngine
from nmb_marketplace_agent.enterprise.hooks import OUTPUT_BLOCK_MESSAGE
from nmb_marketplace_agent.enterprise.models import AuditEvent
from nmb_marketplace_agent.enterprise.rbac import principal_from_token
from nmb_marketplace_agent.enterprise.sessions import decode_session, mint_session


class FakeClient:
    """Stands in for the LangGraph SDK so chat tests stay offline."""

    def __init__(self):
        self.threads = self
        self.runs = self
        self.reply = "Hello."
        self.parts: list[str] = []
        self._n = 0

    async def create(self, metadata=None):
        self._n += 1
        return {"thread_id": f"thread-{self._n}"}

    async def wait(self, **_kw):
        return {"messages": [{"type": "ai", "content": self.reply}]}

    async def stream(self, **_kw):
        for part in self.parts:
            yield types.SimpleNamespace(event="messages",
                                        data=(types.SimpleNamespace(content=part),))


@pytest.fixture
async def api(db, monkeypatch):
    secret = ApiKey(id="k1", tenant_id="t1", agent_id="a1", kind="secret",
                    prefix="sk_test", key_hash=auth.hash_key("sk_test_raw"))
    publishable = ApiKey(id="k2", tenant_id="t1", agent_id="a1", kind="publishable",
                         prefix="pk_test", key_hash=auth.hash_key("pk_test_raw"),
                         allowed_origins=["*"])
    db.add(secret)
    db.add(publishable)
    await db.commit()

    fake = FakeClient()
    monkeypatch.setitem(sys.modules, "langgraph_sdk",
                        types.SimpleNamespace(get_client=lambda url: fake))

    app = FastAPI()
    app.include_router(public.router, prefix="/v1")
    app.dependency_overrides[get_db] = lambda: db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, secret, publishable, fake


def _session(key: ApiKey, user: str = "u1", customer: str | None = None,
             scope: str = "end_user") -> str:
    token, _ = mint_session(tenant_id=key.tenant_id, agent_id=key.agent_id, key_id=key.id,
                            subject=user, customer_id=customer, scope=scope)
    return token


# ── tokens ───────────────────────────────────────────────────────────
def test_mint_and_decode_roundtrip():
    token, ttl = mint_session(tenant_id="t1", agent_id="a1", key_id="k1",
                              subject="u1", customer_id="c1", scope="end_user", ttl_s=120)
    claims = decode_session(token)
    assert ttl == 120
    assert claims["aud"] == "nmb-session"
    assert claims["iss"] == "nmb-gateway"
    assert (claims["tenant_id"], claims["agent_id"], claims["kid"]) == ("t1", "a1", "k1")
    assert claims["sub"] == "u1" and claims["customer_id"] == "c1"
    assert claims["scope"] == "end_user"


def test_ttl_is_clamped():
    _, short = mint_session(tenant_id="t1", agent_id="a1", key_id="k1", subject="u1", ttl_s=1)
    _, long = mint_session(tenant_id="t1", agent_id="a1", key_id="k1", subject="u1", ttl_s=99999)
    assert short == 60 and long == 3600


def test_session_secret_must_be_configured(monkeypatch):
    monkeypatch.delenv("NMB_SESSION_SECRET", raising=False)
    monkeypatch.delenv("NMB_JWT_SECRET", raising=False)
    with pytest.raises(HTTPException) as err:
        mint_session(tenant_id="t1", agent_id="a1", key_id="k1", subject="u1")
    assert err.value.status_code == 503


def test_admin_rbac_rejects_chat_sessions():
    token, _ = mint_session(tenant_id="t1", agent_id="a1", key_id="k1", subject="u1")
    with pytest.raises(HTTPException) as err:
        principal_from_token(f"Bearer {token}")
    assert err.value.status_code == 401
    assert "session" in err.value.detail.lower()


# ── issuance ─────────────────────────────────────────────────────────
async def test_session_endpoint_requires_user_for_secret_key(api):
    client, *_ = api
    r = await client.post("/v1/session", json={}, headers={"x-api-key": "sk_test_raw"})
    assert r.status_code == 422

    r = await client.post("/v1/session", json={"user_id": "u1", "customer_id": "c1"},
                          headers={"x-api-key": "sk_test_raw"})
    assert r.status_code == 200
    body = r.json()
    claims = decode_session(body["token"])
    assert body["scope"] == "end_user"
    assert claims["customer_id"] == "c1"


async def test_publishable_session_is_public_and_cannot_assert_customer(api):
    client, _secret, _publishable, _fake = api
    r = await client.post("/v1/session", json={"user_id": "widget-user", "customer_id": "c1"},
                          headers={"x-api-key": "pk_test_raw"})
    assert r.status_code == 200
    body = r.json()
    assert body["scope"] == "public" and body["customer_id"] is None
    assert decode_session(body["token"])["sub"] == "widget-user"


# ── chat identity + output screening ─────────────────────────────────
async def test_session_binds_thread_and_redacts_output(api, db):
    client, secret, _publishable, fake = api
    fake.reply = "Your card 4111 1111 1111 1111 is on file."

    r = await client.post("/v1/chat", json={"message": "hi"},
                          headers={"authorization": f"Bearer {_session(secret, customer='c1')}"})
    assert r.status_code == 200
    body = r.json()
    assert body["blocked"] is False
    assert "4111" not in body["reply"] and "[CREDIT_CARD:" in body["reply"]

    owner = await db.get(ThreadOwner, body["thread_id"])
    assert (owner.tenant_id, owner.agent_id, owner.user_id, owner.customer_id) == ("t1", "a1", "u1", "c1")


async def test_session_cannot_spoof_user_id(api):
    client, secret, _publishable, _fake = api
    r = await client.post("/v1/chat", json={"message": "hi", "user_id": "someone-else"},
                          headers={"authorization": f"Bearer {_session(secret)}"})
    assert r.status_code == 403


async def test_api_key_can_still_assert_a_user_and_is_audited(api, db):
    client, _secret, _publishable, _fake = api
    r = await client.post("/v1/chat", json={"message": "hi", "user_id": "sdk-user"},
                          headers={"x-api-key": "sk_test_raw"})
    assert r.status_code == 200

    owner = await db.get(ThreadOwner, r.json()["thread_id"])
    assert owner.user_id == "sdk-user" and owner.customer_id is None

    events = (await db.execute(select(AuditEvent).where(
        AuditEvent.action == "chat.identity_asserted"))).scalars().all()
    assert events and events[0].actor == "key:sk_test"


async def test_output_block_does_not_echo_secret(api):
    client, secret, _publishable, fake = api
    fake.reply = "Here is the key sk-ABCDEFGHIJKLMNOPQRSTUVWX for you."
    r = await client.post("/v1/chat", json={"message": "hi"},
                          headers={"authorization": f"Bearer {_session(secret)}"})
    assert r.status_code == 200
    body = r.json()
    assert body["blocked"] is True
    assert body["reply"] == OUTPUT_BLOCK_MESSAGE
    assert "sk-" not in body["reply"]


async def test_host_context_is_fenced_and_metered_once(api, db):
    client, secret, _publishable, fake = api
    seen: dict = {}

    async def wait(**kw):
        seen.update(kw)
        return {"messages": [{"type": "ai", "content": "ok"}]}

    fake.wait = wait
    r = await client.post("/v1/chat", json={
        "message": "where is my order?",
        "context": {"page": "orders", "filter": "open"},
        "readables": [{"description": "Orders page", "value": {"filter": "open"}}],
    }, headers={"authorization": f"Bearer {_session(secret)}"})
    assert r.status_code == 200
    content = seen["input"]["messages"][0]["content"]
    assert content.startswith("[Host application context")
    assert "- page: orders" in content and "- Orders page:" in content
    assert content.endswith("where is my order?")
    events = (await db.execute(select(AuditEvent).where(
        AuditEvent.action == "chat.request"))).scalars().all()
    assert len(events) == 1  # context is screened, not metered as a second run


def test_context_block_is_bounded():
    assert public._context_block(None, None) == ""
    many = public._context_block({f"k{i}": i for i in range(40)}, None)
    assert many.count("\n- ") == 20 and "k20" not in many
    long = public._context_block({"big": "x" * 9000}, None)
    assert len(long) <= public.MAX_CONTEXT_CHARS


async def test_feedback_is_scoped_to_session_customer(api, db):
    client, secret, _publishable, _fake = api
    chat = await client.post("/v1/chat", json={"message": "hi"},
                             headers={"authorization": f"Bearer {_session(secret, customer='c1')}"})
    thread_id = chat.json()["thread_id"]

    ok = await client.post("/v1/feedback", json={"thread_id": thread_id, "rating": "up", "comment": "good"},
                           headers={"authorization": f"Bearer {_session(secret, customer='c1')}"})
    assert ok.status_code == 200
    fb = (await db.execute(select(Feedback))).scalars().all()
    assert len(fb) == 1 and fb[0].customer_id == "c1"

    other_customer = await client.post(
        "/v1/feedback", json={"thread_id": thread_id, "rating": "up"},
        headers={"authorization": f"Bearer {_session(secret, customer='c2')}"})
    assert other_customer.status_code == 404

    anonymous = await client.post(
        "/v1/feedback", json={"thread_id": thread_id, "rating": "up"},
        headers={"authorization": f"Bearer {_session(secret, scope='public')}"})
    assert anonymous.status_code == 404


async def test_chat_sse_streams_redacted_reply(api):
    client, secret, _publishable, fake = api
    fake.parts = ["A" * 140 + ". ", "Your card 4111 1111 1111 1111 is on file. ", "B" * 140]

    r = await client.post("/v1/chat", json={"message": "hi"},
                          headers={"authorization": f"Bearer {_session(secret)}",
                                   "accept": "text/event-stream"})
    assert r.status_code == 200
    body = r.text
    assert '"type": "thread"' in body and '"type": "token"' in body and "[DONE]" in body
    assert "4111" not in body and "[CREDIT_CARD:" in body


# ── streaming guard ──────────────────────────────────────────────────
def _drain(guard: OutputStreamGuard, parts: list[str]) -> str:
    out = "".join(guard.feed(p) for p in parts)
    return out + guard.flush()


def test_stream_guard_redacts_card_split_across_tokens():
    guard = OutputStreamGuard(PolicyEngine())
    out = _drain(guard, ["A" * 140 + ". ", "Card 4111 ", "1111 1111 ", "1111. ", "B" * 130])
    assert not guard.blocked and guard.redacted
    assert "4111" not in out and "[CREDIT_CARD:" in out


def test_stream_guard_blocks_secret_split_across_tokens():
    guard = OutputStreamGuard(PolicyEngine())
    out = _drain(guard, ["A" * 140 + ". ", "key sk-", "ABCDEFGHIJKLMNOPQRSTUVWX", " end. ", "B" * 130])
    assert guard.blocked
    assert "sk-" not in out


def test_stream_guard_handles_jwt_with_internal_dots():
    guard = OutputStreamGuard(PolicyEngine())
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefgh"
    out = _drain(guard, ["A" * 140 + ". ", "token ", jwt[:12], jwt[12:], " end. ", "B" * 130])
    assert guard.blocked
    assert "eyJ" not in out


def test_stream_guard_passes_clean_text():
    guard = OutputStreamGuard(PolicyEngine())
    text = "Your balance is 120 KES. " + "No sensitive data here. " * 10
    out = _drain(guard, [text])
    assert not guard.blocked and not guard.redacted
    assert text in out
