import sys
import types

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from langchain_core.documents import Document
from sqlmodel import select

from nmb_marketplace_agent.api import auth
from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.api.routes import public
from nmb_marketplace_agent.config.models import AgentConfig, ApiKey, Citation, RAGCollection
from nmb_marketplace_agent.enterprise.guardrails import PolicyEngine, guard_tools
from nmb_marketplace_agent.rag import registry as rag_registry
from nmb_marketplace_agent.rag.citations import (
    doc_label,
    format_passages,
    local_entries,
    record_sources,
    source_mode,
    sources_for_run,
)


def _doc(name: str, page: int | None = 0, text: str = "policy text") -> Document:
    md = {"source": f"/srv/private/{name}"}
    if page is not None:
        md["page"] = page
    return Document(page_content=text, metadata=md)


# ── formatting ───────────────────────────────────────────────────────
def test_doc_label_strips_paths_and_uses_one_based_pages():
    title, page, identity = doc_label(_doc("Policy.pdf", page=4))
    assert title == "Policy.pdf"
    assert page == 5  # PyPDFLoader is 0-based
    assert identity and "/srv/private" not in identity

    entries = local_entries([_doc("Policy.pdf", page=4)], "kyc")
    out = format_passages([_doc("Policy.pdf", page=4)], entries)
    assert "[1] Policy.pdf (p. 5)" in out
    assert "/srv/private" not in out
    assert "Cite these sources as [n]" in out


def test_source_mode_defaults_and_rejects_unknown():
    assert source_mode({}) == "labels"
    assert source_mode({"sources": "OFF"}) == "off"
    assert source_mode({"sources": "full"}) == "full"
    assert source_mode({"sources": "everything"}) == "labels"


def test_agent_limits_validation():
    from nmb_marketplace_agent.api.routes.agents import _check_limits

    assert _check_limits({"sources": "OFF"}) == {"sources": "off"}
    with pytest.raises(HTTPException) as err:
        _check_limits({"sources": "everything"})
    assert err.value.status_code == 422


# ── recording ────────────────────────────────────────────────────────
async def test_record_sources_numbers_across_calls_and_dedupes(db):
    a, b = _doc("A.pdf", page=0), _doc("B.pdf", page=1)
    first = await record_sources(db, tenant_id="t", thread_id="th", run_ref="R1",
                                 collection="kyc", docs=[a])
    second = await record_sources(db, tenant_id="t", thread_id="th", run_ref="R1",
                                  collection="kyc", docs=[b, a])
    assert [x["id"] for x in first] == [1]
    assert [x["id"] for x in second] == [2, 1]  # B is new, A is reused
    rows = (await db.execute(select(Citation).where(Citation.run_ref == "R1"))).scalars().all()
    assert len(rows) == 2

    # A different run starts numbering again and never sees R1's sources.
    other = await record_sources(db, tenant_id="t", thread_id="th", run_ref="R2",
                                 collection="kyc", docs=[a])
    assert other[0]["id"] == 1
    assert [s["id"] for s in await sources_for_run(db, "R1", "labels")] == [1, 2]


async def test_sources_for_run_visibility_modes(db):
    await record_sources(db, tenant_id="t", thread_id="th", run_ref="R3",
                         collection="kyc", docs=[_doc("Policy.pdf", page=2)])
    assert await sources_for_run(db, "R3", "off") == []
    assert await sources_for_run(db, "R3", "labels") == [{"id": 1, "title": "Policy.pdf"}]
    assert await sources_for_run(db, "R3", "full") == [
        {"id": 1, "title": "Policy.pdf", "page": 3, "collection": "kyc"}
    ]


async def test_rag_tool_numbers_and_records_through_guard(db, monkeypatch):
    db.add(RAGCollection(id="r1", name="kyc", tenant_id="t", status="ready"))
    await db.commit()

    class Retriever:
        def invoke(self, query):
            return [_doc("Policy.pdf", page=0)]

    monkeypatch.setattr(rag_registry, "make_retriever", lambda *a, **k: Retriever())
    tool = await rag_registry.resolve_retriever_tool("r1", "t")
    guarded = guard_tools([tool], PolicyEngine(), tenant_id="t")[0]

    out = await guarded.ainvoke(
        {"query": "aml"},
        config={"configurable": {"citation_run_id": "R9", "thread_id": "th"}},
    )
    assert "[1] Policy.pdf (p. 1)" in out
    rows = (await db.execute(select(Citation).where(Citation.run_ref == "R9"))).scalars().all()
    assert len(rows) == 1 and rows[0].title == "Policy.pdf"


# ── gateway ──────────────────────────────────────────────────────────
class FakeClient:
    def __init__(self):
        self.threads = self
        self.runs = self
        self.reply = "Hello."
        self._n = 0

    async def create(self, metadata=None):
        self._n += 1
        return {"thread_id": f"thread-{self._n}"}

    async def wait(self, **_kw):
        return {"messages": [{"type": "ai", "content": self.reply}]}

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
    monkeypatch.setattr(public, "new_run_ref", lambda: "R1")

    app = FastAPI()
    app.include_router(public.router, prefix="/v1")
    app.dependency_overrides[get_db] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, fake


async def _seed(db):
    await record_sources(db, tenant_id="t1", thread_id="th", run_ref="R1",
                         collection="kyc", docs=[_doc("Policy.pdf", page=4)])


async def _mode(db, value: str):
    agent = await db.get(AgentConfig, "a1")
    agent.limits = {"sources": value}
    db.add(agent)
    await db.commit()


async def test_chat_json_returns_sources(api, db):
    client, _fake = api
    await _seed(db)

    r = await client.post("/v1/chat", json={"message": "hi"}, headers={"x-api-key": "sk_test_raw"})
    assert r.status_code == 200
    assert r.json()["sources"] == [{"id": 1, "title": "Policy.pdf"}]

    await _mode(db, "full")
    r = await client.post("/v1/chat", json={"message": "hi"}, headers={"x-api-key": "sk_test_raw"})
    assert r.json()["sources"] == [
        {"id": 1, "title": "Policy.pdf", "page": 5, "collection": "kyc"}
    ]

    await _mode(db, "off")
    r = await client.post("/v1/chat", json={"message": "hi"}, headers={"x-api-key": "sk_test_raw"})
    assert r.json()["sources"] == []


async def test_chat_sse_emits_sources(api, db):
    client, _fake = api
    await _seed(db)

    r = await client.post("/v1/chat", json={"message": "hi"},
                          headers={"x-api-key": "sk_test_raw", "accept": "text/event-stream"})
    assert r.status_code == 200
    assert '"type": "sources"' in r.text
    assert "Policy.pdf" in r.text
    assert r.text.rstrip().endswith("[DONE]")


async def test_blocked_reply_does_not_leak_sources(api, db):
    client, fake = api
    await _seed(db)
    fake.reply = "Here is the key sk-ABCDEFGHIJKLMNOPQRSTUVWX for you."

    r = await client.post("/v1/chat", json={"message": "hi"}, headers={"x-api-key": "sk_test_raw"})
    assert r.status_code == 200
    body = r.json()
    assert body["blocked"] is True
    assert body["sources"] == []
