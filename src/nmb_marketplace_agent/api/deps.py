from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.config.database import async_session


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session() as session:
        yield session
