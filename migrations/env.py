import asyncio
import os

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel

import nmb_marketplace_agent.config.models  # noqa: F401
import nmb_marketplace_agent.enterprise.models  # noqa: F401

target_metadata = SQLModel.metadata


def _url() -> str:
    # 1) explicit override, 2) the app's own settings (reads .env), 3) common env names
    url = os.environ.get("ALEMBIC_DATABASE_URL")
    if not url:
        try:
            from nmb_marketplace_agent.config.settings import settings
            url = next((getattr(settings, a) for a in ("registry_database_url", "database_url", "db_url")
                        if getattr(settings, a, None)), None)
        except Exception:
            url = None
    url = url or os.environ.get("REGISTRY_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("No database URL found. Set ALEMBIC_DATABASE_URL, e.g. "
                         "ALEMBIC_DATABASE_URL=sqlite+aiosqlite:///./data/app.db")
    # make sure the async driver is used
    for old, new in (("postgresql://", "postgresql+asyncpg://"), ("sqlite:///", "sqlite+aiosqlite:///")):
        if url.startswith(old):
            url = url.replace(old, new, 1)
    return url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True,
                      render_as_batch=connection.dialect.name == "sqlite")
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url())
    async with engine.connect() as conn:
        await conn.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())