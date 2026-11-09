from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    main_model: str = "ollama:qwen2.5-coder:7b"
    embedding_model: str = "openai:text-embedding-3-small"
    database_url: str = "sqlite+aiosqlite:///./data/app.db"
    vector_store_root: str = "data/indexes"
    rag_default_top_k: int = 4
    async_researcher_url: str | None = None

    # Where model training files live (shared with the trainer container)
    training_root: str = "data/training"
    # The same folder as seen from inside the trainer container
    training_container_root: str = "/data/training"
    # Seconds a resolved Langfuse prompt is cached by the agent runtime
    prompt_cache_ttl: int = 30


settings = Settings()