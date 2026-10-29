from datetime import UTC, datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Column, Text
from sqlmodel import Field, SQLModel


class ToolConfig(SQLModel, table=True):
    __tablename__ = "tools"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    type: str = Field(default="builtin")
    description: str = Field(default="")
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    tenant_id: str = Field(default="default", index=True)


class RAGCollection(SQLModel, table=True):
    __tablename__ = "rag_collections"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    vector_store: str = Field(default="faiss")
    embedding_model: str = Field(default="openai:text-embedding-3-small")
    index_path: str = Field(default="")
    top_k: int = Field(default=4)
    status: str = Field(default="empty")
    tenant_id: str = Field(default="default", index=True)


class SubAgentConfig(SQLModel, table=True):
    __tablename__ = "subagents"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    description: str = Field(default="")
    system_prompt: str = Field(default="", sa_column=Column(Text))
    mode: str = Field(default="sync")
    tool_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    rag_collection_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    model: Optional[str] = Field(default=None)
    graph_id: Optional[str] = Field(default=None)
    url: Optional[str] = Field(default=None)
    tenant_id: str = Field(default="default", index=True)


class AgentConfig(SQLModel, table=True):
    __tablename__ = "agents"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    model: str = Field(default="anthropic:claude-sonnet-4-5-20250929")
    system_prompt: str = Field(default="", sa_column=Column(Text))
    tool_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    rag_collection_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    subagent_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    tenant_id: str = Field(default="default", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ModelConfig(SQLModel, table=True):
    __tablename__ = "models"
    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    provider: str = Field(default="openai")  # anthropic | openai | google_genai | ollama
    model_name: str = Field(default="")
    base_url: Optional[str] = Field(default=None)
    api_key_env: Optional[str] = Field(default=None)  # env var NAME, never the key
    params: dict = Field(default_factory=dict, sa_column=Column(JSON))
    tenant_id: str = Field(default="default", index=True)


class ApiKey(SQLModel, table=True):
    __tablename__ = "api_keys"
    id: str = Field(primary_key=True)
    name: str = Field(default="")
    tenant_id: str = Field(default="default", index=True)
    agent_id: str = Field(index=True)
    kind: str = Field(default="publishable")  # publishable | secret
    prefix: str = Field(default="")
    key_hash: str = Field(index=True)
    allowed_origins: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    rate_limit_per_min: int = Field(default=60)
    revoked: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AgentVersion(SQLModel, table=True):
    """Immutable snapshot of an agent's config. The `published` one serves live traffic."""
    __tablename__ = "agent_versions"
    id: str = Field(primary_key=True)
    agent_id: str = Field(index=True)
    tenant_id: str = Field(default="default", index=True)
    version: int = Field(default=1)
    snapshot: dict = Field(default_factory=dict, sa_column=Column(JSON))
    note: str = Field(default="")
    published: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EvalDataset(SQLModel, table=True):
    __tablename__ = "eval_datasets"
    id: str = Field(primary_key=True)
    name: str = Field(default="")
    agent_id: str = Field(index=True)
    tenant_id: str = Field(default="default", index=True)


class EvalCase(SQLModel, table=True):
    __tablename__ = "eval_cases"
    id: str = Field(primary_key=True)
    dataset_id: str = Field(index=True)
    input: str = Field(default="", sa_column=Column(Text))
    expected_contains: Optional[str] = Field(default=None)
    criteria: Optional[str] = Field(default=None, sa_column=Column(Text))


class EvalRun(SQLModel, table=True):
    __tablename__ = "eval_runs"
    id: str = Field(primary_key=True)
    dataset_id: str = Field(index=True)
    agent_id: str = Field(index=True)
    tenant_id: str = Field(default="default", index=True)
    target: str = Field(default="published")  # draft | published
    agent_version: Optional[int] = Field(default=None)
    status: str = Field(default="running")
    results: list = Field(default_factory=list, sa_column=Column(JSON))
    summary: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Feedback(SQLModel, table=True):
    __tablename__ = "feedback"
    id: str = Field(primary_key=True)
    tenant_id: str = Field(default="default", index=True)
    agent_id: str = Field(index=True)
    thread_id: str = Field(default="")
    rating: str = Field(default="up")
    comment: Optional[str] = Field(default=None)
    user_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    reply: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ThreadOwner(SQLModel, table=True):
    """Maps a chat thread to the agent/tenant/user that owns it.

    Written when a thread is first created (see lg_proxy / runs), read by
    feedback.py to authorise feedback submissions.
    """
    __tablename__ = "thread_owners"
    thread_id: str = Field(primary_key=True)
    tenant_id: str = Field(default="default", index=True)
    agent_id: str = Field(index=True)
    user_id: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))