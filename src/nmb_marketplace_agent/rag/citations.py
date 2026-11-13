"""Citation capture for RAG answers.

The retrieval tool numbers the passages it returns and records them against a
per-run reference. The gateway reads them back after the run, which keeps
numbering consistent across collections and works for subagents and buffered
(non-streaming) runs.

Only display metadata is stored: a basename, an optional page and the
collection key. Filesystem paths and chunk text never leave the retrieval layer
through this table.
"""
from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config.models import Citation

SOURCE_MODES = ("off", "labels", "full")


def source_mode(limits: dict | None) -> str:
    value = str((limits or {}).get("sources", "labels")).strip().lower()
    return value if value in SOURCE_MODES else "labels"


def new_run_ref() -> str:
    return uuid.uuid4().hex


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _clean_title(value: str) -> str:
    value = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    value = re.sub(r"\s+", " ", value).strip()
    return (value or "Document")[:160]


def doc_label(doc) -> tuple[str, int | None, str]:
    """Return ``(display title, 1-based page, identity)`` for a Document.

    ``identity`` is used to deduplicate repeated retrieval of the same passage;
    it hashes the original source so the path itself is never stored.
    """
    md = getattr(doc, "metadata", None) or {}
    raw = str(md.get("source") or md.get("file_path") or md.get("file_name") or "")
    title = _clean_title(md.get("title") or (Path(raw).name if raw else "Document"))
    page = md.get("page")
    try:
        page = int(page) + 1  # PyPDFLoader pages are 0-based
    except (TypeError, ValueError):
        page = None
    identity = hashlib.sha256(f"{raw}:{page}".encode()).hexdigest()[:24]
    return title, page, identity


def format_passages(docs: list, entries: list[dict]) -> str:
    """Render numbered passages. ``[n]`` values match the recorded citations."""
    blocks = []
    for doc, entry in zip(docs, entries):
        label = f"[{entry['id']}] {entry['title']}"
        if entry.get("page"):
            label += f" (p. {entry['page']})"
        blocks.append(f"{label}\n{getattr(doc, 'page_content', '')}")
    header = "Cite these sources as [n] where you use them.\n\n"
    return header + "\n\n---\n\n".join(blocks)


def local_entries(docs: list, collection: str) -> list[dict]:
    out = []
    for i, doc in enumerate(docs, 1):
        title, page, _ = doc_label(doc)
        out.append({"id": i, "title": title, "page": page, "collection": collection})
    return out


async def record_sources(
    db: AsyncSession,
    *,
    tenant_id: str,
    thread_id: str,
    run_ref: str,
    collection: str,
    docs: list,
) -> list[dict]:
    """Persist each passage once per run and return its ``[n]`` numbering."""
    if not docs:
        return []
    if not run_ref:
        return local_entries(docs, collection)

    for _ in range(2):  # one retry if a parallel tool call wins the sequence
        existing = (
            await db.execute(select(Citation).where(Citation.run_ref == run_ref))
        ).scalars().all()
        by_source = {c.dedupe_key: c for c in existing}
        next_seq = max((c.seq for c in existing), default=0) + 1
        entries: list[dict] = []
        created: list[Citation] = []
        for doc in docs:
            title, page, identity = doc_label(doc)
            key = f"{collection}:{identity}"
            row = by_source.get(key)
            if row is None:
                row = Citation(
                    id=str(uuid.uuid4()), tenant_id=tenant_id, thread_id=thread_id or "",
                    run_ref=run_ref, seq=next_seq, collection=collection,
                    dedupe_key=key, title=title, page=page, created_at=_now_iso(),
                )
                by_source[key] = row
                created.append(row)
                next_seq += 1
            entries.append({"id": row.seq, "title": row.title, "page": row.page, "collection": collection})
        try:
            db.add_all(created)
            await db.commit()
            return entries
        except IntegrityError:
            await db.rollback()
    return local_entries(docs, collection)


async def sources_for_run(db: AsyncSession, run_ref: str, mode: str) -> list[dict]:
    """Public, display-safe sources for a finished run, filtered by visibility."""
    if not run_ref or mode == "off":
        return []
    rows = (
        await db.execute(select(Citation).where(Citation.run_ref == run_ref).order_by(Citation.seq))
    ).scalars().all()
    out = []
    for row in rows:
        item = {"id": row.seq, "title": row.title}
        if mode == "full":
            if row.page:
                item["page"] = row.page
            if row.collection:
                item["collection"] = row.collection
        out.append(item)
    return out


async def cleanup_citations(db: AsyncSession, days: int | None = None) -> int:
    """Drop citation rows past the retention window (default 7 days)."""
    days = days or int(os.environ.get("CITATION_RETENTION_DAYS", "7"))
    cutoff = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    result = await db.execute(delete(Citation).where(Citation.created_at < cutoff))
    await db.commit()
    return int(result.rowcount or 0)
