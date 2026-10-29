from langchain_core.tools import BaseTool, tool

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import RAGCollection
from nmb_marketplace_agent.rag.retriever import make_retriever


async def resolve_retriever_tool(rag_id: str, tenant_id: str) -> BaseTool:
    async with async_session() as session:
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

    @tool(f"search_{cfg.name}")
    def rag_search(query: str) -> str:
        """Search the selected document collection."""
        docs = retriever.invoke(query)
        if not docs:
            return "No relevant documents found."
        return "\n\n---\n\n".join(d.page_content for d in docs)

    return rag_search
