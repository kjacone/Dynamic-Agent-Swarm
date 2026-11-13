"""Retention, legal hold and data-subject erasure/access across every store.

The registry database is authoritative for *which* threads belong to a subject.
The LangGraph runtime owns transcripts/checkpoints, the vector stores own
embeddings, and Langfuse owns traces. Those systems cannot see each other, so a
request fans out from here and records one outcome per store.

Deletion is deliberately explicit: a retention key that is absent keeps data
forever. Erasure is blocked outright by any active legal hold that intersects
the subject, and every run is recorded in ``privacy_requests`` and the audit
chain. Langfuse processes trace deletions asynchronously (minutes), so a
``submitted`` count means the request was accepted, not that every row is gone.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Iterable

import httpx
from sqlalchemy import delete, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config.models import (
    Citation,
    Feedback,
    Handoff,
    HandoffMessage,
    RAGCollection,
    ThreadOwner,
)
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.models import (
    LegalHold,
    PrivacyRequest,
    RetentionPolicy,
    now_iso,
)

log = logging.getLogger(__name__)

RETENTION_KEYS = ("threads_days", "citations_days", "feedback_days", "handoff_days", "langfuse_days")
HOLD_SCOPES = ("tenant", "customer", "user", "thread")
MAX_DAYS = 3650
_ACTIVE_HANDOFFS = ("requested", "active")
_SUBJECT_KEYS = ("customer_id", "user_id", "thread_id")
_LF_PAGE = 100
_LF_MAX_PAGES = 50
_LF_BATCH = 1000


class PrivacyError(Exception):
    pass


# ── views ────────────────────────────────────────────────────────────
def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def hold_view(h: LegalHold) -> dict:
    return {"id": h.id, "scope": h.scope, "scope_id": h.scope_id, "reason": h.reason,
            "active": h.active, "created_by": h.created_by, "created_at": h.created_at,
            "released_by": h.released_by, "released_at": h.released_at}


def request_view(r: PrivacyRequest) -> dict:
    return {"id": r.id, "kind": r.kind, "subject_type": r.subject_type,
            "subject_id": r.subject_id, "thread_ids": r.thread_ids or [], "reason": r.reason,
            "status": r.status, "result": r.result or {}, "requested_by": r.requested_by,
            "created_at": r.created_at, "completed_at": r.completed_at}


def _cutoff_dt(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


def _cutoff_iso(days: int) -> str:
    return _cutoff_dt(days).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


# ── retention policy ─────────────────────────────────────────────────
def _validate_settings(settings: dict) -> dict:
    unknown = set(settings) - set(RETENTION_KEYS)
    if unknown:
        raise ValueError(f"Unknown retention keys: {', '.join(sorted(unknown))}")
    clean: dict[str, int | None] = {}
    for key, value in settings.items():
        if value is None:
            clean[key] = None
            continue
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{key} must be an integer number of days or null")
        if not 1 <= value <= MAX_DAYS:
            raise ValueError(f"{key} must be between 1 and {MAX_DAYS} days")
        clean[key] = value
    return clean


async def get_policy(db: AsyncSession, tenant_id: str) -> dict:
    """Effective settings. An absent key keeps data forever; an explicit null
    disables the fallback window. Citations default to CITATION_RETENTION_DAYS."""
    row = await db.get(RetentionPolicy, tenant_id)
    effective: dict[str, Any] = {k: None for k in RETENTION_KEYS}
    effective["citations_days"] = int(os.environ.get("CITATION_RETENTION_DAYS", "7"))
    configured = dict(row.settings or {}) if row else {}
    effective.update({k: v for k, v in configured.items() if k in RETENTION_KEYS})
    return {**effective, "_configured": configured,
            "_updated_by": row.updated_by if row else "",
            "_updated_at": row.updated_at if row else ""}


async def set_policy(db: AsyncSession, tenant_id: str, settings: dict, actor: str) -> dict:
    clean = _validate_settings(settings)
    row = await db.get(RetentionPolicy, tenant_id)
    if not row:
        row = RetentionPolicy(tenant_id=tenant_id)
    row.settings = {**(row.settings or {}), **clean}
    row.updated_by = actor
    row.updated_at = now_iso()
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=tenant_id, actor=actor, action="privacy.retention_updated",
                       resource_type="retention_policy", resource_id=tenant_id,
                       details={"settings": clean})
    return await get_policy(db, tenant_id)


def policy_view(p: dict) -> dict:
    return {"settings": {k: p.get(k) for k in RETENTION_KEYS},
            "configured": p.get("_configured", {}),
            "updated_by": p.get("_updated_by", ""),
            "updated_at": p.get("_updated_at", "")}


# ── legal holds ──────────────────────────────────────────────────────
@dataclass
class HoldScope:
    rows: list[LegalHold] = field(default_factory=list)
    tenant: bool = False
    users: set[str] = field(default_factory=set)
    customers: set[str] = field(default_factory=set)
    threads: set[str] = field(default_factory=set)

    def blocks(self, *, customer_id: str | None = None, user_id: str | None = None,
               thread_ids: Iterable[str | None] = ()) -> bool:
        if self.tenant:
            return True
        if customer_id and customer_id in self.customers:
            return True
        if user_id and user_id in self.users:
            return True
        return any(t and t in self.threads for t in thread_ids)


async def hold_scope(db: AsyncSession, tenant_id: str) -> HoldScope:
    rows = (await db.execute(select(LegalHold).where(
        LegalHold.tenant_id == tenant_id, LegalHold.active == True))).scalars().all()  # noqa: E712
    scope = HoldScope(rows=list(rows))
    for h in rows:
        if h.scope == "tenant":
            scope.tenant = True
        elif h.scope == "customer" and h.scope_id:
            scope.customers.add(h.scope_id)
        elif h.scope == "user" and h.scope_id:
            scope.users.add(h.scope_id)
        elif h.scope == "thread" and h.scope_id:
            scope.threads.add(h.scope_id)
    if scope.customers or scope.users:
        conds = []
        if scope.customers:
            conds.append(ThreadOwner.customer_id.in_(scope.customers))
        if scope.users:
            conds.append(ThreadOwner.user_id.in_(scope.users))
        ids = (await db.execute(select(ThreadOwner.thread_id).where(
            ThreadOwner.tenant_id == tenant_id, or_(*conds)))).scalars().all()
        scope.threads.update(ids)
    return scope


async def create_hold(db: AsyncSession, tenant_id: str, *, scope: str, scope_id: str,
                      reason: str, actor: str) -> LegalHold:
    scope_id = (scope_id or "").strip()
    if scope not in HOLD_SCOPES:
        raise ValueError(f"scope must be one of: {', '.join(HOLD_SCOPES)}")
    if scope != "tenant" and not scope_id:
        raise ValueError("scope_id is required for customer, user and thread holds")
    if not (reason or "").strip():
        raise ValueError("A legal hold needs a reason")
    existing = (await db.execute(select(LegalHold).where(
        LegalHold.tenant_id == tenant_id, LegalHold.scope == scope,
        LegalHold.scope_id == (scope_id if scope != "tenant" else ""),
        LegalHold.active == True))).scalars().first()  # noqa: E712
    if existing:
        return existing
    row = LegalHold(id=str(uuid.uuid4()), tenant_id=tenant_id, scope=scope,
                    scope_id=scope_id if scope != "tenant" else "", reason=reason.strip(),
                    created_by=actor, created_at=now_iso())
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=tenant_id, actor=actor, action="privacy.hold_created",
                       resource_type="legal_hold", resource_id=row.id,
                       details={"scope": scope, "scope_id": row.scope_id, "reason": row.reason})
    return row


async def release_hold(db: AsyncSession, tenant_id: str, hold_id: str, actor: str) -> LegalHold:
    row = await db.get(LegalHold, hold_id)
    if not row or row.tenant_id != tenant_id:
        raise PrivacyError("Legal hold not found")
    if not row.active:
        return row
    row.active = False
    row.released_by = actor
    row.released_at = now_iso()
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=tenant_id, actor=actor, action="privacy.hold_released",
                       resource_type="legal_hold", resource_id=row.id,
                       details={"scope": row.scope, "scope_id": row.scope_id})
    return row


async def list_holds(db: AsyncSession, tenant_id: str, *, active: bool | None = True) -> list[LegalHold]:
    stmt = select(LegalHold).where(LegalHold.tenant_id == tenant_id)
    if active is not None:
        stmt = stmt.where(LegalHold.active == active)  # noqa: E712
    return list((await db.execute(stmt.order_by(LegalHold.created_at.desc()))).scalars().all())


# ── LangGraph store ──────────────────────────────────────────────────
def _lg():
    from langgraph_sdk import get_client

    return get_client(url=os.environ.get("LANGGRAPH_URL", "http://127.0.0.1:2024"))


async def _delete_threads(client, thread_ids: list[str]) -> dict:
    deleted, missing, errors = [], [], []
    for tid in thread_ids:
        try:
            await client.threads.delete(tid)
            deleted.append(tid)
        except Exception as e:  # noqa: BLE001 - one bad thread must not abort the run
            msg = f"{type(e).__name__}: {e}"[:300]
            if "404" in msg or "not found" in msg.lower():
                missing.append(tid)
            else:
                errors.append({"thread_id": tid, "error": msg})
    return {"deleted": deleted, "missing": missing, "errors": errors}


# ── registry database ────────────────────────────────────────────────
async def _purge_registry(db: AsyncSession, tenant_id: str, thread_ids: list[str], *,
                          customer_id: str | None = None, user_id: str | None = None) -> dict:
    ids = list(dict.fromkeys(t for t in thread_ids if t))
    counts: dict[str, int] = {}

    hconds = []
    if ids:
        hconds.append(Handoff.thread_id.in_(ids))
    if customer_id:
        hconds.append(Handoff.customer_id == customer_id)
    if user_id:
        hconds.append(Handoff.user_id == user_id)
    handoff_ids: list[str] = []
    if hconds:
        handoff_ids = list((await db.execute(select(Handoff.id).where(
            Handoff.tenant_id == tenant_id, or_(*hconds)))).scalars().all())
    if handoff_ids:
        r = await db.execute(delete(HandoffMessage).where(
            HandoffMessage.tenant_id == tenant_id, HandoffMessage.handoff_id.in_(handoff_ids)))
        counts["handoff_messages"] = int(r.rowcount or 0)
        r = await db.execute(delete(Handoff).where(
            Handoff.tenant_id == tenant_id, Handoff.id.in_(handoff_ids)))
        counts["handoffs"] = int(r.rowcount or 0)

    fconds = []
    if ids:
        fconds.append(Feedback.thread_id.in_(ids))
    if customer_id:
        fconds.append(Feedback.customer_id == customer_id)
    if fconds:
        r = await db.execute(delete(Feedback).where(Feedback.tenant_id == tenant_id, or_(*fconds)))
        counts["feedback"] = int(r.rowcount or 0)

    if ids:
        r = await db.execute(delete(Citation).where(
            Citation.tenant_id == tenant_id, Citation.thread_id.in_(ids)))
        counts["citations"] = int(r.rowcount or 0)
        r = await db.execute(delete(ThreadOwner).where(
            ThreadOwner.tenant_id == tenant_id, ThreadOwner.thread_id.in_(ids)))
        counts["thread_owners"] = int(r.rowcount or 0)

    await db.commit()
    return counts


# ── Langfuse ─────────────────────────────────────────────────────────
def _lf_client():
    from nmb_marketplace_agent.integrations.langfuse import client

    return client()


async def _lf_rows(lf, *, session_ids: Iterable[str] = (), user_id: str | None = None,
                   tenant_tag: str | None = None, before: str | None = None,
                   max_pages: int = _LF_MAX_PAGES) -> list[dict]:
    """Trace rows matching the filters. Refuses tenant-wide windows when the
    deployment cannot attribute a trace to the tenant, rather than over-deleting."""
    rows_by_id: dict[str, dict] = {}

    async def collect(params: dict) -> None:
        page = 1
        while page <= max_pages:
            p = {"limit": _LF_PAGE, "page": page, **params}
            if before:
                p["toTimestamp"] = before
            data = await lf.traces(**p)
            rows = data.get("data") or []
            source = (data.get("meta") or {}).get("source", "")
            if tenant_tag and source == "v2/observations":
                return  # no tenant/timestamp filtering in the v4 fallback
            for r in rows:
                tid = r.get("id")
                if not tid:
                    continue
                if before and (r.get("timestamp") or r.get("createdAt") or "") >= before:
                    continue
                tags = r.get("tags") or []
                if tenant_tag and tenant_tag not in tags:
                    continue
                rows_by_id[tid] = r
            if len(rows) < _LF_PAGE or source == "v2/observations":
                return
            page += 1

    for sid in dict.fromkeys(s for s in session_ids if s):
        await collect({"sessionId": sid})
    if user_id:
        await collect({"userId": user_id})
    if tenant_tag:
        await collect({"tags": [tenant_tag]})
    return list(rows_by_id.values())


async def _lf_delete(lf, rows: list[dict]) -> dict:
    ids = [r["id"] for r in rows if r.get("id")]
    submitted, errors = 0, []
    for i in range(0, len(ids), _LF_BATCH):
        try:
            submitted += await lf.delete_traces(ids[i:i + _LF_BATCH])
        except Exception as e:  # noqa: BLE001
            errors.append(f"{type(e).__name__}: {e}"[:300])
    return {"status": "partial" if errors else "completed", "submitted": submitted, "errors": errors}


# ── Qdrant (optional; only points carrying subject fields are touched) ─
async def _qdrant_erase(tenant_id: str, *, customer_id: str | None, user_id: str | None,
                        thread_ids: list[str], url: str | None = None) -> dict:
    base = (url if url is not None else os.environ.get("QDRANT_URL", "")).rstrip("/")
    if not base:
        return {"status": "not_configured", "points": 0, "collections": 0}
    should = []
    if customer_id:
        should.append({"key": "customer_id", "match": {"value": customer_id}})
    if user_id:
        should.append({"key": "user_id", "match": {"value": user_id}})
    if thread_ids:
        should.append({"key": "thread_id", "match": {"any": list(thread_ids)}})
    if not should:
        return {"status": "completed", "points": 0, "collections": 0}

    # A subject id alone is not proof of tenant ownership: require the tenant
    # payload field as well, and refuse points that do not carry it.
    flt = {"must": [{"key": "tenant_id", "match": {"value": tenant_id}}],
           "min_should": {"conditions": should, "min_count": 1}}
    points, touched, errors = 0, 0, []
    try:
        async with httpx.AsyncClient(base_url=base, timeout=20) as c:
            listing = await c.get("/collections")
            listing.raise_for_status()
            names = [x.get("name") for x in (listing.json().get("result") or {}).get("collections", [])]
            for name in filter(None, names):
                try:
                    cnt = await c.post(f"/collections/{name}/points/count",
                                       json={"filter": flt, "exact": True})
                    cnt.raise_for_status()
                    n = int((cnt.json().get("result") or {}).get("count") or 0)
                    if not n:
                        continue
                    dele = await c.post(f"/collections/{name}/points/delete",
                                        params={"wait": "true"}, json={"filter": flt})
                    dele.raise_for_status()
                    points += n
                    touched += 1
                except Exception as e:  # noqa: BLE001
                    errors.append(f"{name}: {type(e).__name__}: {e}"[:300])
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "points": 0, "collections": 0,
                "errors": [f"{type(e).__name__}: {e}"[:300]]}
    return {"status": "partial" if errors else "completed", "points": points,
            "collections": touched, "errors": errors}


# ── FAISS (tenant knowledge indexes; only subject-tagged documents) ──
async def _faiss_erase(db: AsyncSession, tenant_id: str, *,
                       customer_id: str | None, user_id: str | None,
                       thread_ids: list[str]) -> dict:
    collections = list((await db.execute(select(RAGCollection).where(
        RAGCollection.tenant_id == tenant_id, RAGCollection.vector_store == "faiss"))).scalars().all())
    if not collections or not (customer_id or user_id or thread_ids):
        return {"status": "completed", "documents": 0, "collections": 0}

    documents, touched, errors = 0, 0, []
    for cfg in collections:
        if not cfg.index_path or not os.path.isdir(cfg.index_path):
            continue
        try:
            n = await asyncio.to_thread(_erase_faiss_collection, cfg, tenant_id,
                                        customer_id, user_id, set(thread_ids))
            if n:
                documents += n
                touched += 1
        except Exception as e:  # noqa: BLE001
            errors.append(f"{cfg.id}: {type(e).__name__}: {e}"[:300])
    return {"status": "partial" if errors else "completed", "documents": documents,
            "collections": touched, "errors": errors}


def _erase_faiss_collection(cfg, tenant_id: str, customer_id: str | None,
                            user_id: str | None, thread_ids: set[str]) -> int:
    from nmb_marketplace_agent.rag.retriever import load_store

    store = load_store(cfg.vector_store, cfg.index_path, cfg.embedding_model, tenant_id)
    matches = []
    for doc_id, doc in list(store.docstore._dict.items()):
        meta = getattr(doc, "metadata", None) or {}
        if customer_id and str(meta.get("customer_id")) == customer_id:
            matches.append(doc_id)
        elif user_id and str(meta.get("user_id")) == user_id:
            matches.append(doc_id)
        elif thread_ids and str(meta.get("thread_id")) in thread_ids:
            matches.append(doc_id)
    if matches:
        store.delete(ids=matches)
        store.save_local(cfg.index_path)
    return len(matches)


# ── erasure ──────────────────────────────────────────────────────────
async def _new_request(db: AsyncSession, tenant_id: str, *, subject_type: str, subject_id: str,
                       thread_ids: list[str], reason: str, actor: str) -> PrivacyRequest:
    row = PrivacyRequest(id=str(uuid.uuid4()), tenant_id=tenant_id, kind="erasure",
                         subject_type=subject_type, subject_id=subject_id,
                         thread_ids=thread_ids, reason=reason or "", requested_by=actor,
                         created_at=now_iso())
    db.add(row)
    await db.commit()
    return row


async def _finish_request(db: AsyncSession, row: PrivacyRequest, *, status: str, result: dict) -> None:
    row.status = status
    row.result = result
    row.completed_at = now_iso()
    db.add(row)
    await db.commit()


async def erase_subject(db: AsyncSession, tenant_id: str, *, customer_id: str | None = None,
                        user_id: str | None = None, thread_ids: list[str] | None = None,
                        reason: str = "", actor: str = "", lg_client=None,
                        langfuse=None, qdrant_url: str | None = None) -> dict:
    customer_id = (customer_id or "").strip() or None
    user_id = (user_id or "").strip() or None
    requested = list(dict.fromkeys(t for t in (thread_ids or []) if t))
    if not (customer_id or user_id or requested):
        raise PrivacyError("Provide customer_id, user_id or thread_ids")

    conds = []
    if customer_id:
        conds.append(ThreadOwner.customer_id == customer_id)
    if user_id:
        conds.append(ThreadOwner.user_id == user_id)
    if requested:
        conds.append(ThreadOwner.thread_id.in_(requested))
    owners = list((await db.execute(select(ThreadOwner).where(
        ThreadOwner.tenant_id == tenant_id, or_(*conds)))).scalars().all())
    known = [o.thread_id for o in owners]
    unknown = [t for t in requested if t not in set(known)]
    selected = list(dict.fromkeys(known))

    scope = await hold_scope(db, tenant_id)
    subject_type = "customer" if customer_id else ("user" if user_id else "thread")
    subject_id = customer_id or user_id or (selected[0] if selected else "")
    req = await _new_request(db, tenant_id, subject_type=subject_type, subject_id=subject_id,
                             thread_ids=selected or requested, reason=reason, actor=actor)
    if scope.blocks(customer_id=customer_id, user_id=user_id, thread_ids=selected or requested):
        result = {"status": "blocked", "request_id": req.id,
                  "holds": [hold_view(h) for h in scope.rows],
                  "message": "An active legal hold covers this data. Release it before erasing."}
        await _finish_request(db, req, status="blocked", result=result)
        await audit.record(db, tenant_id=tenant_id, actor=actor, action="privacy.erasure_blocked",
                           resource_type="privacy_request", resource_id=req.id,
                           outcome="denied",
                           details={"subject_type": subject_type, "subject_id": subject_id,
                                    "thread_count": len(selected)})
        return result

    lg_status: dict[str, Any]
    try:
        client = lg_client or _lg()
        lg_status = await _delete_threads(client, selected)
        lg_status = {"status": "partial" if lg_status["errors"] else "completed",
                     "deleted_threads": len(lg_status["deleted"]),
                     "missing_threads": len(lg_status["missing"]),
                     "errors": lg_status["errors"]}
    except Exception as e:  # noqa: BLE001
        lg_status = {"status": "error", "deleted_threads": 0, "errors":
                     [f"{type(e).__name__}: {e}"[:300]]}

    registry = await _purge_registry(db, tenant_id, selected, customer_id=customer_id,
                                     user_id=user_id)

    lf = _lf_client() if langfuse is None else (langfuse or None)
    if lf is None:
        lf_status = {"status": "not_configured", "submitted": 0}
    else:
        try:
            rows = await _lf_rows(lf, session_ids=selected, user_id=user_id)
            lf_status = await _lf_delete(lf, rows)
        except Exception as e:  # noqa: BLE001
            lf_status = {"status": "error", "submitted": 0,
                         "errors": [f"{type(e).__name__}: {e}"[:300]]}

    qdrant = await _qdrant_erase(tenant_id, customer_id=customer_id, user_id=user_id,
                                 thread_ids=selected, url=qdrant_url)
    faiss = await _faiss_erase(db, tenant_id, customer_id=customer_id, user_id=user_id,
                               thread_ids=selected)

    store_statuses = [lg_status["status"], "completed", lf_status["status"],
                      qdrant["status"], faiss["status"]]
    partial = any(s in ("error", "partial") for s in store_statuses)
    result = {
        "status": "partial" if partial else "completed",
        "request_id": req.id,
        "subject": {"customer_id": customer_id, "user_id": user_id,
                    "thread_ids": selected, "unknown_thread_ids": unknown},
        "stores": {"langgraph": lg_status, "registry": {"status": "completed", "deleted": registry},
                   "langfuse": lf_status, "qdrant": qdrant, "faiss": faiss},
        "note": "Langfuse trace deletion is queued and may take several minutes to complete.",
    }
    await _finish_request(db, req, status=result["status"], result=result)
    await audit.record(db, tenant_id=tenant_id, actor=actor, action="privacy.erased",
                       resource_type="privacy_request", resource_id=req.id,
                       details={"subject_type": subject_type, "subject_id": subject_id,
                                "thread_count": len(selected), "unknown_threads": len(unknown),
                                "status": result["status"], "stores": {
                                    k: v.get("status") for k, v in result["stores"].items()}})
    return result


# ── retention sweep ──────────────────────────────────────────────────
async def retention_sweep(db: AsyncSession, tenant_id: str, *, lg_client=None,
                          langfuse=None) -> dict:
    policy = await get_policy(db, tenant_id)
    scope = await hold_scope(db, tenant_id)
    summary: dict[str, Any] = {"tenant_id": tenant_id, "deleted": {}, "errors": []}

    # Citations are derived retrieval metadata.
    if policy["citations_days"]:
        cutoff = _cutoff_iso(policy["citations_days"])
        rows = list((await db.execute(select(Citation.id, Citation.thread_id).where(
            Citation.tenant_id == tenant_id, Citation.created_at < cutoff))).all())
        ids = [r.id for r in rows if not scope.blocks(thread_ids=[r.thread_id])]
        if ids:
            r = await db.execute(delete(Citation).where(Citation.id.in_(ids)))
            summary["deleted"]["citations"] = int(r.rowcount or 0)

    # Feedback rows (the comment text can contain PII).
    if policy["feedback_days"]:
        cutoff = _cutoff_dt(policy["feedback_days"])
        rows = list((await db.execute(select(Feedback).where(
            Feedback.tenant_id == tenant_id, Feedback.created_at < cutoff))).scalars().all())
        ids = [r.id for r in rows if not scope.blocks(customer_id=r.customer_id,
                                                      thread_ids=[r.thread_id])]
        if ids:
            r = await db.execute(delete(Feedback).where(Feedback.id.in_(ids)))
            summary["deleted"]["feedback"] = int(r.rowcount or 0)

    # Resolved handoff transcripts.
    if policy["handoff_days"]:
        cutoff = _cutoff_dt(policy["handoff_days"])
        rows = list((await db.execute(select(Handoff).where(
            Handoff.tenant_id == tenant_id, Handoff.status == "resolved",
            func.coalesce(Handoff.resolved_at, Handoff.created_at) < cutoff))).scalars().all())
        rows = [h for h in rows if not scope.blocks(customer_id=h.customer_id, user_id=h.user_id,
                                                    thread_ids=[h.thread_id])]
        if rows:
            ids = [h.id for h in rows]
            r = await db.execute(delete(HandoffMessage).where(
                HandoffMessage.tenant_id == tenant_id, HandoffMessage.handoff_id.in_(ids)))
            summary["deleted"]["handoff_messages"] = int(r.rowcount or 0)
            r = await db.execute(delete(Handoff).where(Handoff.id.in_(ids)))
            summary["deleted"]["handoffs"] = int(r.rowcount or 0)

    # Whole conversations: LangGraph transcript + registry rows.
    if policy["threads_days"]:
        cutoff = _cutoff_dt(policy["threads_days"])
        owners = list((await db.execute(select(ThreadOwner).where(
            ThreadOwner.tenant_id == tenant_id,
            func.coalesce(ThreadOwner.last_active_at, ThreadOwner.created_at) < cutoff))
        ).scalars().all())
        busy = set((await db.execute(select(Handoff.thread_id).where(
            Handoff.tenant_id == tenant_id, Handoff.status.in_(_ACTIVE_HANDOFFS)))).scalars().all())
        candidates = [o.thread_id for o in owners if o.thread_id not in busy
                      and not scope.blocks(customer_id=o.customer_id, user_id=o.user_id,
                                           thread_ids=[o.thread_id])]
        if candidates:
            try:
                client = lg_client or _lg()
                res = await _delete_threads(client, candidates)
                await _purge_registry(db, tenant_id, res["deleted"] + res["missing"])
                summary["deleted"]["threads"] = len(res["deleted"]) + len(res["missing"])
                if res["errors"]:
                    summary["errors"].extend(res["errors"])
            except Exception as e:  # noqa: BLE001
                summary["errors"].append(f"langgraph: {type(e).__name__}: {e}"[:300])

    # Traces: only when the deployment can attribute a trace to this tenant.
    if policy["langfuse_days"]:
        lf = _lf_client() if langfuse is None else (langfuse or None)
        if lf is None:
            summary["deleted"]["traces"] = 0
        else:
            before = _cutoff_dt(policy["langfuse_days"]).strftime("%Y-%m-%dT%H:%M:%SZ")
            try:
                rows = await _lf_rows(lf, tenant_tag=f"tenant:{tenant_id}", before=before)
                rows = [r for r in rows if not scope.blocks(
                    user_id=r.get("userId"), thread_ids=[r.get("sessionId")])]
                res = await _lf_delete(lf, rows)
                summary["deleted"]["traces"] = res["submitted"]
                if res["errors"]:
                    summary["errors"].extend(res["errors"])
            except Exception as e:  # noqa: BLE001
                summary["errors"].append(f"langfuse: {type(e).__name__}: {e}"[:300])

    await db.commit()
    if summary["deleted"] or summary["errors"]:
        await audit.record(db, tenant_id=tenant_id, actor="system", actor_type="system",
                           action="privacy.retention_swept",
                           outcome="error" if summary["errors"] else "success",
                           details={k: v for k, v in summary.items() if k != "tenant_id"})
    summary["status"] = "partial" if summary["errors"] else "completed"
    return summary


# ── subject access export ────────────────────────────────────────────
def _state_text(state: Any) -> list[dict]:
    values = (state or {}).get("values") if isinstance(state, dict) else None
    messages = (values or {}).get("messages") or []
    out = []
    for m in list(messages)[-200:]:
        if isinstance(m, dict):
            role, content = m.get("type") or m.get("role") or "", m.get("content")
        elif isinstance(m, (list, tuple)) and len(m) == 2:
            role, content = m[0], m[1]
        else:
            role, content = type(m).__name__, str(m)
        out.append({"role": str(role), "content": content if isinstance(content, (str, dict, list))
                    else str(content)})
    return out


async def export_subject(db: AsyncSession, tenant_id: str, *, customer_id: str | None = None,
                         user_id: str | None = None, include_transcript: bool = False,
                         lg_client=None) -> dict:
    customer_id = (customer_id or "").strip() or None
    user_id = (user_id or "").strip() or None
    if not (customer_id or user_id):
        raise PrivacyError("Provide customer_id or user_id")
    conds = []
    if customer_id:
        conds.append(ThreadOwner.customer_id == customer_id)
    if user_id:
        conds.append(ThreadOwner.user_id == user_id)
    owners = list((await db.execute(select(ThreadOwner).where(
        ThreadOwner.tenant_id == tenant_id, or_(*conds)))).scalars().all())
    thread_ids = [o.thread_id for o in owners]

    feedback = list((await db.execute(select(Feedback).where(
        Feedback.tenant_id == tenant_id,
        or_(Feedback.customer_id == customer_id if customer_id else False,
            Feedback.thread_id.in_(thread_ids) if thread_ids else False)))).scalars().all())
    handoffs = list((await db.execute(select(Handoff).where(
        Handoff.tenant_id == tenant_id,
        or_(Handoff.customer_id == customer_id if customer_id else False,
            Handoff.user_id == user_id if user_id else False,
            Handoff.thread_id.in_(thread_ids) if thread_ids else False)))).scalars().all())
    handoff_ids = [h.id for h in handoffs]
    messages = list((await db.execute(select(HandoffMessage).where(
        HandoffMessage.tenant_id == tenant_id,
        HandoffMessage.handoff_id.in_(handoff_ids) if handoff_ids else False))).scalars().all())
    citations = list((await db.execute(select(Citation).where(
        Citation.tenant_id == tenant_id,
        Citation.thread_id.in_(thread_ids) if thread_ids else False))).scalars().all())

    transcripts: dict[str, Any] = {}
    if include_transcript and thread_ids:
        try:
            client = lg_client or _lg()
            for tid in thread_ids[:100]:
                try:
                    transcripts[tid] = _state_text(await client.threads.get_state(tid))
                except Exception as e:  # noqa: BLE001
                    transcripts[tid] = {"error": f"{type(e).__name__}: {e}"[:300]}
        except Exception as e:  # noqa: BLE001
            transcripts = {"error": f"{type(e).__name__}: {e}"[:300]}

    await audit.record(db, tenant_id=tenant_id, actor="system", actor_type="system",
                       action="privacy.subject_exported",
                       details={"customer_id": customer_id, "user_id": user_id,
                                "threads": len(thread_ids), "transcripts": bool(include_transcript)})
    return {
        "generated_at": now_iso(),
        "subject": {"customer_id": customer_id, "user_id": user_id},
        "threads": [{"thread_id": o.thread_id, "agent_id": o.agent_id,
                     "created_at": _iso(o.created_at), "last_active_at": _iso(o.last_active_at)}
                    for o in owners],
        "feedback": [{"id": f.id, "thread_id": f.thread_id, "rating": f.rating,
                      "comment": f.comment, "user_message": f.user_message, "reply": f.reply,
                      "created_at": _iso(f.created_at)} for f in feedback],
        "handoffs": [{"id": h.id, "thread_id": h.thread_id, "status": h.status,
                      "reason": h.reason, "created_at": _iso(h.created_at),
                      "resolved_at": _iso(h.resolved_at)} for h in handoffs],
        "handoff_messages": [{"handoff_id": m.handoff_id, "role": m.role, "author": m.author,
                              "text": m.text, "created_at": _iso(m.created_at)} for m in messages],
        "citations": [{"thread_id": c.thread_id, "title": c.title, "page": c.page,
                       "collection": c.collection, "created_at": c.created_at} for c in citations],
        **({"transcripts": transcripts} if include_transcript else {}),
        "counts": {"threads": len(thread_ids), "feedback": len(feedback),
                   "handoffs": len(handoffs), "handoff_messages": len(messages),
                   "citations": len(citations), "transcripts": len(transcripts)},
    }
