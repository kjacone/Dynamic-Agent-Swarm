"""Embedding models by "provider:name": openai (or any OpenAI-compatible server) and ollama."""
from nmb_marketplace_agent.integrations import connections
from nmb_marketplace_agent.integrations import provider_keys


def get_embeddings(model: str):
    provider, sep, name = model.partition(":")
    if not sep:  # bare model name = OpenAI, like before
        provider, name = "openai", model
    if provider == "ollama":
        from langchain_ollama import OllamaEmbeddings

        return OllamaEmbeddings(model=name, base_url=connections.get("ollama")["url"])
    if provider in ("openai", "openai-compatible"):
        from langchain_openai import OpenAIEmbeddings

        # Keys saved on the Knowledge page win over the process environment.
        base = provider_keys.get("EMBEDDINGS_BASE_URL")
        if base:
            return OpenAIEmbeddings(
                model=name, base_url=base,
                api_key=provider_keys.get("EMBEDDINGS_API_KEY") or "not-needed",
            )
        key = provider_keys.get("OPENAI_API_KEY")
        return OpenAIEmbeddings(model=name, api_key=key) if key else OpenAIEmbeddings(model=name)
    raise ValueError(f"Unsupported embedding provider: {provider}")