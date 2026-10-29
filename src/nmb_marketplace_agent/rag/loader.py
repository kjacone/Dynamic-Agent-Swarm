from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


def load_documents(source_dir: str):
    docs = []
    for p in Path(source_dir).rglob("*"):
        if p.is_dir():
            continue
        try:
            if p.suffix.lower() in {".txt", ".md"}:
                docs += TextLoader(str(p), encoding="utf-8").load()
            elif p.suffix.lower() == ".pdf":
                docs += PyPDFLoader(str(p)).load()
        except Exception as e:
            print(f"[rag.loader] skipping {p}: {e}")
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=120)
    return splitter.split_documents(docs)
