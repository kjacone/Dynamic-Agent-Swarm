# from langchain_community.vectorstores import FAISS
# from langchain_core.retrievers import BaseRetriever

# from nmb_marketplace_agent.rag.embeddings import get_embeddings


# def make_retriever(
#     vector_store: str,
#     index_path: str,
#     embedding_model: str,
#     top_k: int,
#     tenant_id: str,
# ) -> BaseRetriever:
#     if not tenant_id:
#         raise ValueError("tenant_id is required to build a retriever")

#     if vector_store == "faiss":
#         store = FAISS.load_local(
#             index_path,
#             get_embeddings(embedding_model),
#             allow_dangerous_deserialization=True,
#         )
#         return store.as_retriever(search_kwargs={"k": top_k})

#     raise ValueError(f"Unsupported vector_store: {vector_store}")


from langchain_community.vectorstores import FAISS
from langchain_core.retrievers import BaseRetriever

from nmb_marketplace_agent.rag.embeddings import get_embeddings


def load_store(vector_store: str, index_path: str, embedding_model: str, tenant_id: str) -> FAISS:
    if not tenant_id:
        raise ValueError("tenant_id is required to load an index")
    if vector_store != "faiss":
        raise ValueError(f"Unsupported vector_store: {vector_store}")
    # Indexes are written by this service only, so unpickling them is safe.
    return FAISS.load_local(index_path, get_embeddings(embedding_model), allow_dangerous_deserialization=True)


def make_retriever(vector_store: str, index_path: str, embedding_model: str, top_k: int, tenant_id: str) -> BaseRetriever:
    return load_store(vector_store, index_path, embedding_model, tenant_id).as_retriever(search_kwargs={"k": top_k})