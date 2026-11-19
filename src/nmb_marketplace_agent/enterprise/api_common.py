"""Helpers shared by the enterprise routers."""
from __future__ import annotations

import asyncio

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.enterprise.runtime import build_runtime
from nmb_marketplace_agent.enterprise.workflows.engine import WorkflowEngine

_bg: set[asyncio.Task] = set()


async def _engine(db: AsyncSession, tenant: str) -> WorkflowEngine:
    return WorkflowEngine(db, await build_runtime(db, tenant), tenant)


def _wf_err(e: Exception) -> HTTPException:
    return HTTPException(422, str(e))
