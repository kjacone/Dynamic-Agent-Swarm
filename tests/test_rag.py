import pytest

from nmb_marketplace_agent.rag.retriever import make_retriever


def test_missing_tenant_raises():
    with pytest.raises(ValueError):
        make_retriever("faiss", "nope", "openai:text-embedding-3-small", 4, "")