"""Embedding models by "provider:name": openai (or any OpenAI-compatible server) and ollama."""
import os

from nmb_marketplace_agent.integrations import connections


def get_embeddings(model: str):
    provider, sep, name = model.partition(":")
    if not sep:  # bare model name = OpenAI, like before
        provider, name = "openai", model
    if provider == "ollama":
        from langchain_ollama import OllamaEmbeddings

        return OllamaEmbeddings(model=name, base_url=connections.get("ollama")["url"])
    if provider in ("openai", "openai-compatible"):
        from langchain_openai import OpenAIEmbeddings

        base = os.environ.get("EMBEDDINGS_BASE_URL")
        if base:
            return OpenAIEmbeddings(model=name, base_url=base, api_key=os.environ.get("EMBEDDINGS_API_KEY", "not-needed"))
        return OpenAIEmbeddings(model=name)
    raise ValueError(f"Unsupported embedding provider: {provider}")