from sqlmodel import select

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import AgentConfig, AgentVersion

FIELDS = ["name", "model", "system_prompt", "tool_ids", "rag_collection_ids", "subagent_ids"]


def snapshot_of(a: AgentConfig) -> dict:
    return {f: getattr(a, f) for f in FIELDS}


async def published_version(agent_id: str) -> AgentVersion | None:
    async with async_session() as s:
        res = await s.execute(
            select(AgentVersion).where(AgentVersion.agent_id == agent_id, AgentVersion.published == True)  # noqa: E712
        )
        return res.scalars().first()


async def effective_config(agent: AgentConfig, use_draft: bool = False) -> tuple[dict, int | None]:
    """Live traffic uses the published snapshot; the editable draft is used when none exists."""
    if not use_draft:
        v = await published_version(agent.id)
        if v:
            return dict(v.snapshot), v.version
    return snapshot_of(agent), None
