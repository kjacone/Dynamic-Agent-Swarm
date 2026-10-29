import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import RAGCollection
from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.rag.indexer import build_index

router = APIRouter()

DOCS_ROOT = Path("data/docs")


class RAGCreate(BaseModel):
    name: str
    embedding_model: str = settings.embedding_model
    top_k: int = settings.rag_default_top_k
    tenant_id: str = "default"


class RAGQuery(BaseModel):
    query: str
    top_k: int | None = None


def _index_path(tenant_id: str, rag_id: str) -> str:
    return str(Path(settings.vector_store_root) / tenant_id / rag_id)


def _safe_name(filename: str) -> str:
    """Strip directories so an upload can never escape the collection's docs folder."""
    name = Path(filename or "upload").name
    return name or "upload"


def _within(base: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


async def _ingest(rag_id: str, source_dir: str, index_path: str, embedding_model: str):
    from nmb_marketplace_agent.config.database import async_session
    async with async_session() as session:
        col = await session.get(RAGCollection, rag_id)
        if not col:
            return
        try:
            build_index(source_dir, index_path, embedding_model)
            col.status = "ready"
        except Exception:
            col.status = "error"
        session.add(col)
        await session.commit()


@router.post("")
async def create_collection(body: RAGCreate, db: AsyncSession = Depends(get_db)):
    rid = str(uuid.uuid4())
    col = RAGCollection(
        id=rid,
        name=body.name,
        embedding_model=body.embedding_model,
        top_k=body.top_k,
        tenant_id=body.tenant_id,
        index_path=_index_path(body.tenant_id, rid),
        status="empty",
    )
    db.add(col)
    await db.commit()
    await db.refresh(col)
    return col


@router.get("")
async def list_collections(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(RAGCollection).where(RAGCollection.tenant_id == tenant_id))
    return res.scalars().all()


@router.post("/{rag_id}/upload")
async def upload_docs(
    rag_id: str,
    files: list[UploadFile],
    background: BackgroundTasks,
    tenant_id: str = "default",
    db: AsyncSession = Depends(get_db),
):
    col = await db.get(RAGCollection, rag_id)
    if not col or col.tenant_id != tenant_id:
        raise HTTPException(404, "Collection not found")

    tenant_docs = DOCS_ROOT / col.tenant_id / rag_id
    tenant_docs.mkdir(parents=True, exist_ok=True)

    for f in files:
        dest = tenant_docs / _safe_name(f.filename)
        # Defence in depth: ensure we stayed inside the collection's docs folder.
        if not _within(tenant_docs, dest):
            raise HTTPException(400, "Invalid filename")
        dest.write_bytes(await f.read())

    col.status = "ingesting"
    db.add(col)
    await db.commit()

    background.add_task(
        _ingest, rag_id, str(tenant_docs), col.index_path, col.embedding_model
    )
    return {"status": "ingesting", "collection_id": rag_id}


@router.post("/{rag_id}/query")
async def query_collection(
    rag_id: str,
    body: RAGQuery,
    tenant_id: str = "default",
    db: AsyncSession = Depends(get_db),
):
    col = await db.get(RAGCollection, rag_id)
    if not col or col.tenant_id != tenant_id:
        raise HTTPException(404, "Collection not found")
    if col.status != "ready":
        raise HTTPException(400, f"Collection not ready (status={col.status})")
    if not body.query.strip():
        raise HTTPException(400, "Empty query")
    try:
        from nmb_marketplace_agent.rag.retriever import make_retriever
        retriever = make_retriever(
            col.vector_store, col.index_path, col.embedding_model,
            body.top_k or col.top_k, tenant_id,
        )
        docs = await retriever.ainvoke(body.query)
        return {
            "results": [
                {"content": d.page_content, "metadata": d.metadata or {}}
                for d in docs
            ]
        }
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}"[:400])


@router.delete("/{rag_id}")
async def delete_collection(rag_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    import shutil

    col = await db.get(RAGCollection, rag_id)
    if not col or col.tenant_id != tenant_id:
        raise HTTPException(404, "Collection not found")

    # Only remove directories we created and that live under the configured roots.
    docs = DOCS_ROOT / col.tenant_id / rag_id
    if docs.exists() and _within(DOCS_ROOT, docs):
        shutil.rmtree(docs, ignore_errors=True)

    index_root = Path(settings.vector_store_root)
    idx = Path(col.index_path) if col.index_path else None
    if idx and idx.exists() and _within(index_root, idx) and idx != index_root:
        shutil.rmtree(idx, ignore_errors=True)

    await db.delete(col)
    await db.commit()
    return {"ok": True}