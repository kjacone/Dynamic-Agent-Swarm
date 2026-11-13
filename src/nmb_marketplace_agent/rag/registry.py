import asyncio
import logging

from langchain_core.runnables import ensure_config
from langchain_core.tools import BaseTool, tool

from nmb_marketplace_agent.config import database
from nmb_marketplace_agent.config.models import RAGCollection
from nmb_marketplace_agent.rag.citations import (
    format_passages,
    local_entries,
    record_sources,
)
from nmb_marketplace_agent.rag.retriever import make_retriever

log = logging.getLogger(__name__)


async def resolve_retriever_tool(rag_id: str, tenant_id: str) -> BaseTool:
    async with database.async_session() as session:
        cfg = await session.get(RAGCollection, rag_id)
    if not cfg:
        raise ValueError(f"RAGCollection not found: {rag_id}")
    if cfg.tenant_id != tenant_id:
        raise ValueError(f"Tenant mismatch for RAGCollection {rag_id}")
    if cfg.status != "ready":
        raise ValueError(f"RAGCollection {rag_id} not ready (status={cfg.status})")

    retriever = make_retriever(
        cfg.vector_store, cfg.index_path, cfg.embedding_model, cfg.top_k, tenant_id
    )
    collection = cfg.name or rag_id

    @tool(f"search_{cfg.name}")
    async def rag_search(query: str) -> str:
        """Search the selected document collection. Cite passages as [n]."""
        docs = await asyncio.to_thread(retriever.invoke, query)
        if not docs:
            return "No relevant documents found."

        run_ref, thread_id = "", ""
        try:
            cfgurable = (ensure_config() or {}).get("configurable") or {}
            run_ref = str(cfgurable.get("citation_run_id") or "")
            thread_id = str(cfgurable.get("thread_id") or "")
            async with database.async_session() as session:
                entries = await record_sources(
                    session, tenant_id=tenant_id, thread_id=thread_id,
                    run_ref=run_ref, collection=collection, docs=docs,
                )
        except Exception:  # retrieval must still work if citation capture fails
            log.exception("Citation capture failed for collection %s", rag_id)
            entries = local_entries(docs, collection)
        return format_passages(docs, entries)

    rag_search.metadata = {**(rag_search.metadata or {}), "policy_direction": "document"}
    return rag_search
