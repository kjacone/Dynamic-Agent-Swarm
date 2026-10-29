from pathlib import Path

from langchain_community.vectorstores import FAISS

from nmb_marketplace_agent.rag.embeddings import get_embeddings
from nmb_marketplace_agent.rag.loader import load_documents


def build_index(source_dir: str, out_path: str, embedding_model: str) -> int:
    docs = load_documents(source_dir)
    if not docs:
        raise ValueError(f"No documents found in {source_dir}")
    store = FAISS.from_documents(docs, get_embeddings(embedding_model))
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    store.save_local(out_path)
    return len(docs)
