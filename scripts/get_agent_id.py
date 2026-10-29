import asyncio

from sqlmodel import select

from nmb_marketplace_agent.config.database import async_session
from nmb_marketplace_agent.config.models import AgentConfig


async def main() -> str:
    async with async_session() as s:
        a = (await s.execute(select(AgentConfig))).scalars().first()
        return a.id if a else ""

print(asyncio.run(main()))
