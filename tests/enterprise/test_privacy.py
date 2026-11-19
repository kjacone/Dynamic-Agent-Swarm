import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from nmb_marketplace_agent.config.models import (
    Citation,
    Feedback,
    Handoff,
    HandoffMessage,
    ThreadOwner,
)
from nmb_marketplace_agent.enterprise import privacy
from nmb_marketplace_agent.enterprise import privacy_api as eapi
from nmb_marketplace_agent.enterprise.models import LegalHold, PrivacyRequest
from nmb_marketplace_agent.enterprise.rbac import Principal

T = "t1"


def _old(days: int = 10) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


def _old_iso(days: int = 10) -> str:
    return _old(days).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class FakeThreads:
    def __init__(self):
        self.deleted: list[str] = []
        self.state = {"values": {"messages": [
            {"type": "human", "content": "my limit"},
            {"type": "ai", "content": "Let me check."},
        ]}}

    async def delete(self, thread_id):
        self.deleted.append(thread_id)

    async def get_state(self, thread_id):
        return self.state


class FakeLG:
    def __init__(self):
        self.threads = FakeThreads()


class FakeLF:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.deleted: list[str] = []
        self.calls: list[dict] = []

    async def traces(self, **params):
        self.calls.append(params)
        out = []
        for r in self.rows:
            if params.get("sessionId") and r.get("sessionId") != params["sessionId"]:
                continue
            if params.get("userId") and r.get("userId") != params["userId"]:
                continue
            tags = params.get("tags")
            if tags and not set(tags).issubset(set(r.get("tags") or [])):
                continue
            out.append(r)
        return {"data": out, "meta": {}}

    async def delete_traces(self, ids):
        self.deleted.extend(ids)
        return len(ids)


async def _owner(db, thread, *, user="u1", customer=None, active=None):
    db.add(ThreadOwner(thread_id=thread, tenant_id=T, agent_id="a1", user_id=user,
                       customer_id=customer, last_active_at=active))
    await db.commit()


# ── retention policy ─────────────────────────────────────────────────
async def test_policy_defaults_validation_and_persistence(db):
    p = await privacy.get_policy(db, T)
    assert p["threads_days"] is None
    assert p["citations_days"] == 7  # deployment default preserved

    with pytest.raises(ValueError):
        await privacy.set_policy(db, T, {"threads_days": 0}, "admin")
    with pytest.raises(ValueError):
        await privacy.set_policy(db, T, {"nonsense": 3}, "admin")

    p = await privacy.set_policy(db, T, {"threads_days": 30, "citations_days": None}, "admin")
    assert p["threads_days"] == 30 and p["citations_days"] is None
    view = privacy.policy_view(p)
    assert view["settings"]["threads_days"] == 30
    assert view["configured"]["citations_days"] is None
    assert view["updated_by"] == "admin"


# ── legal holds ──────────────────────────────────────────────────────
async def test_customer_hold_expands_to_threads_and_blocks_erasure(db):
    await _owner(db, "th-1", customer="c1")
    hold = await privacy.create_hold(db, T, scope="customer", scope_id="c1",
                                     reason="litigation", actor="dpo")
    again = await privacy.create_hold(db, T, scope="customer", scope_id="c1",
                                      reason="duplicate", actor="dpo")
    assert again.id == hold.id and len(await privacy.list_holds(db, T)) == 1

    scope = await privacy.hold_scope(db, T)
    assert scope.blocks(customer_id="c1", thread_ids=["th-1"])

    lg = FakeLG()
    result = await privacy.erase_subject(db, T, customer_id="c1", reason="request",
                                         actor="dpo", lg_client=lg, langfuse=False, qdrant_url="")
    assert result["status"] == "blocked"
    assert lg.threads.deleted == []
    assert await db.get(ThreadOwner, "th-1") is not None

    req = await db.get(PrivacyRequest, result["request_id"])
    assert req.status == "blocked"

    await privacy.release_hold(db, T, hold.id, "dpo")
    assert not (await privacy.hold_scope(db, T)).blocks(customer_id="c1")


# ── erasure across stores ────────────────────────────────────────────
async def test_erasure_removes_registry_runtime_and_traces(db):
    await _owner(db, "th-1", user="u1", customer="c1")
    await _owner(db, "th-2", user="u2", customer="c2")
    h = Handoff(id="h1", tenant_id=T, agent_id="a1", thread_id="th-1", status="resolved",
                reason="help", user_id="u1", customer_id="c1")
    db.add(h)
    db.add(HandoffMessage(id="m1", tenant_id=T, thread_id="th-1", handoff_id="h1",
                          role="customer", author="u1", text="private"))
    db.add(Feedback(id="f1", tenant_id=T, agent_id="a1", thread_id="th-1", customer_id="c1",
                    rating="down", comment="bad"))
    db.add(Citation(id="c1", tenant_id=T, thread_id="th-1", run_ref="r1", seq=1,
                    title="doc", created_at=_old_iso()))
    await db.commit()

    lg = FakeLG()
    lf = FakeLF([
        {"id": "tr-1", "sessionId": "th-1", "userId": "u1", "tags": ["tenant:t1"]},
        {"id": "tr-2", "sessionId": "th-2", "userId": "u2", "tags": ["tenant:t1"]},
    ])
    result = await privacy.erase_subject(db, T, customer_id="c1", reason="Art.17", actor="dpo",
                                         lg_client=lg, langfuse=lf, qdrant_url="")

    assert result["status"] == "completed"
    assert lg.threads.deleted == ["th-1"]
    assert lf.deleted == ["tr-1"]
    assert result["stores"]["qdrant"]["status"] == "not_configured"
    assert result["stores"]["faiss"]["documents"] == 0

    assert await db.get(ThreadOwner, "th-1") is None
    assert await db.get(ThreadOwner, "th-2") is not None
    assert await db.get(Handoff, "h1") is None
    assert await db.get(HandoffMessage, "m1") is None
    assert await db.get(Feedback, "f1") is None
    assert await db.get(Citation, "c1") is None

    req = await db.get(PrivacyRequest, result["request_id"])
    assert req.status == "completed" and req.subject_id == "c1"


async def test_erasure_reports_runtime_failures_as_partial(db):
    await _owner(db, "th-1")

    class BrokenLG:
        class threads:
            @staticmethod
            async def delete(_tid):
                raise RuntimeError("runtime down")

    result = await privacy.erase_subject(db, T, user_id="u1", actor="dpo",
                                         lg_client=BrokenLG, langfuse=False, qdrant_url="")
    assert result["status"] == "partial"
    assert result["stores"]["langgraph"]["status"] == "partial"
    assert result["stores"]["langgraph"]["deleted_threads"] == 0
    assert result["stores"]["langgraph"]["errors"]


# ── retention sweep ──────────────────────────────────────────────────
async def test_retention_sweep_skips_active_handoffs_and_holds(db):
    await _owner(db, "old", user="u-old", customer="c-old", active=_old(10))
    await _owner(db, "busy", user="u-busy", active=_old(10))
    await _owner(db, "held", user="u-held", customer="c-held", active=_old(10))
    await _owner(db, "recent", user="u-new", customer="c-new", active=datetime.now(UTC))
    db.add(Handoff(id="hb", tenant_id=T, agent_id="a1", thread_id="busy", status="requested"))
    db.add(Feedback(id="f-old", tenant_id=T, agent_id="a1", thread_id="old", customer_id="c-old",
                    rating="up", comment="old", created_at=_old(10)))
    db.add(Feedback(id="f-held", tenant_id=T, agent_id="a1", thread_id="held", customer_id="c-held",
                    rating="up", comment="held", created_at=_old(10)))
    db.add(Citation(id="cit-old", tenant_id=T, thread_id="old", run_ref="r1", seq=1,
                    created_at=_old_iso(10)))
    db.add(Handoff(id="h-done", tenant_id=T, agent_id="a1", thread_id="old", status="resolved",
                   resolved_at=_old(10)))
    db.add(HandoffMessage(id="hm", tenant_id=T, thread_id="old", handoff_id="h-done",
                          role="staff", author="op", text="old chat"))
    await db.commit()

    hold = await privacy.create_hold(db, T, scope="customer", scope_id="c-held",
                                     reason="litigation", actor="dpo")
    await privacy.set_policy(db, T, {"threads_days": 1, "feedback_days": 1,
                                     "citations_days": 1, "handoff_days": 1,
                                     "langfuse_days": 1}, "admin")

    lg = FakeLG()
    lf = FakeLF([
        {"id": "tr-old", "sessionId": "old", "tags": ["tenant:t1"], "timestamp": _old_iso(10)},
        {"id": "tr-held", "sessionId": "held", "tags": ["tenant:t1"], "timestamp": _old_iso(10)},
        {"id": "tr-new", "sessionId": "recent", "tags": ["tenant:t1"], "timestamp": _old_iso(0)},
    ])
    summary = await privacy.retention_sweep(db, T, lg_client=lg, langfuse=lf)

    assert summary["status"] == "completed"
    assert sorted(lg.threads.deleted) == ["old"]
    assert lf.deleted == ["tr-old"]
    assert summary["deleted"]["threads"] == 1
    assert summary["deleted"]["feedback"] == 1
    assert summary["deleted"]["handoffs"] == 1
    assert summary["deleted"]["citations"] == 1

    assert await db.get(ThreadOwner, "old") is None
    assert await db.get(ThreadOwner, "busy") is not None
    assert await db.get(ThreadOwner, "held") is not None
    assert await db.get(ThreadOwner, "recent") is not None
    assert await db.get(Feedback, "f-held") is not None
    assert await db.get(Feedback, "f-old") is None
    assert await db.get(Handoff, "h-done") is None
    assert await db.get(HandoffMessage, "hm") is None

    await privacy.release_hold(db, T, hold.id, "dpo")


async def test_langfuse_retention_refuses_unattributable_traces(db):
    """If Langfuse only serves the v4 observations view, no tenant tag exists, so nothing is deleted."""

    class V4LF(FakeLF):
        async def traces(self, **params):
            return {"data": [{"id": "tr-x", "timestamp": _old_iso(10)}],
                    "meta": {"source": "v2/observations"}}

    await privacy.set_policy(db, T, {"langfuse_days": 1}, "admin")
    lf = V4LF()
    summary = await privacy.retention_sweep(db, T, lg_client=FakeLG(), langfuse=lf)
    assert lf.deleted == []
    assert summary["deleted"]["traces"] == 0


# ── Qdrant adapter ───────────────────────────────────────────────────
async def test_qdrant_erasure_is_tenant_scoped_and_counts_matches(db, monkeypatch):
    calls: list[tuple[str, dict]] = []

    class Resp:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class FakeQdrant:
        def __init__(self, **_kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def get(self, path):
            return Resp({"result": {"collections": [{"name": "loan_docs"}]}})

        async def post(self, path, **kw):
            calls.append((path, kw))
            if path.endswith("/count"):
                return Resp({"result": {"count": 3}})
            return Resp({"result": {"status": "completed"}})

    monkeypatch.setattr(privacy.httpx, "AsyncClient", FakeQdrant)
    out = await privacy._qdrant_erase("t1", customer_id="c1", user_id=None,
                                      thread_ids=["th-1"], url="http://qdrant:6333")
    assert out == {"status": "completed", "points": 3, "collections": 1, "errors": []}

    count_path, count_kw = calls[0]
    assert count_path == "/collections/loan_docs/points/count"
    flt = count_kw["json"]["filter"]
    assert flt["must"] == [{"key": "tenant_id", "match": {"value": "t1"}}]
    assert flt["min_should"]["min_count"] == 1
    assert {c["key"] for c in flt["min_should"]["conditions"]} == {"customer_id", "thread_id"}
    assert calls[1][0] == "/collections/loan_docs/points/delete"
    assert calls[1][1]["params"] == {"wait": "true"}


# ── subject access ───────────────────────────────────────────────────
async def test_subject_export_includes_registry_and_optional_transcript(db):
    await _owner(db, "th-1", user="u1", customer="c1")
    db.add(Feedback(id="f1", tenant_id=T, agent_id="a1", thread_id="th-1", customer_id="c1",
                    rating="up", comment="thanks"))
    h = Handoff(id="h1", tenant_id=T, agent_id="a1", thread_id="th-1", status="resolved",
                user_id="u1", customer_id="c1")
    db.add(h)
    db.add(HandoffMessage(id="m1", tenant_id=T, thread_id="th-1", handoff_id="h1",
                          role="staff", author="op", text="hello"))
    db.add(Citation(id="ci1", tenant_id=T, thread_id="th-1", run_ref="r1", seq=1, title="rate table"))
    await db.commit()

    data = await privacy.export_subject(db, T, customer_id="c1", include_transcript=True,
                                        lg_client=FakeLG())
    assert data["counts"] == {"threads": 1, "feedback": 1, "handoffs": 1,
                              "handoff_messages": 1, "citations": 1, "transcripts": 1}
    assert data["transcripts"]["th-1"][0]["role"] == "human"
    assert data["feedback"][0]["comment"] == "thanks"
    assert await db.get(LegalHold, str(uuid.uuid4())) is None  # no accidental row


# ── API surface ──────────────────────────────────────────────────────
async def test_api_retention_hold_and_blocked_erasure(db, monkeypatch):
    monkeypatch.setattr(privacy, "_lg", lambda: FakeLG())
    p = Principal("dpo", T, {"data_protection_officer"})

    out = await eapi.put_retention(eapi._RetentionIn(settings={"threads_days": 90}), p, db)
    assert out["settings"]["threads_days"] == 90

    hold = await eapi.post_hold(eapi._HoldIn(scope="tenant", reason="court order"), p, db)
    assert hold["hold"]["scope"] == "tenant"

    await _owner(db, "th-1", customer="c1")
    with pytest.raises(HTTPException) as exc:
        await eapi.erase_subject(eapi._EraseIn(customer_id="c1"), p, db)
    assert exc.value.status_code == 409
    assert exc.value.detail["status"] == "blocked"

    reqs = await eapi.list_privacy_requests(50, p, db)
    assert reqs["requests"][0]["status"] == "blocked"

    released = await eapi.release_legal_hold(hold["hold"]["id"], p, db)
    assert released["hold"]["active"] is False
    assert (await eapi.get_retention(p, db))["settings"]["threads_days"] == 90
