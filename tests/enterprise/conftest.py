import os

os.environ.setdefault("ADMIN_TOKEN", "test-admin-token")

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

import nmb_marketplace_agent.config.models  # noqa: F401
import nmb_marketplace_agent.enterprise.models  # noqa: F401


@pytest_asyncio.fixture
async def db(tmp_path):
    eng = create_async_engine(f"sqlite+aiosqlite:///{tmp_path/'t.db'}")
    async with eng.begin() as c:
        await c.run_sync(SQLModel.metadata.create_all)
    async with async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await eng.dispose()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("LICENSE_ENFORCE", "AUDIT_HMAC_KEY", "ALLOW_ADMIN_TOKEN_APPROVALS", "EGRESS_ALLOWED_HOSTS"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("REDACTION_KEY", "test-redaction-key")
