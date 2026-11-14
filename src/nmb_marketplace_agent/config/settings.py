from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    main_model: str = "ollama:llama3.1:8b"
    embedding_model: str = "openai:text-embedding-3-small"
    # NMB_DATABASE_URL wins when set: in the Aegra container DATABASE_URL is the
    # server's own store, so the platform registry needs a separate name.
    database_url: str = Field(
        default="sqlite+aiosqlite:///./data/app.db",
        validation_alias=AliasChoices("NMB_DATABASE_URL", "DATABASE_URL"),
    )
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