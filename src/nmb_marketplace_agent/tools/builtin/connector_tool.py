"""Run an enabled tenant connector from an agent (or subagent) tool call."""
from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from sqlmodel import select


class ConnectorCall(BaseModel):
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="Connector parameters, e.g. {\"query\": {\"limit\": 5}} or {\"body\": {...}}",
    )


def make_connector_tool(name: str, tenant_id: str, connector: str, operation: str,
                        description: str = "") -> StructuredTool:
    async def call(params: dict[str, Any] | str = {}) -> str:
        if isinstance(params, str):
            try:
                params = json.loads(params) if params.strip() else {}
            except json.JSONDecodeError:
                return f"Connector tool error: params must be a JSON object, got {params[:200]!r}"
        if not isinstance(params, dict):
            return "Connector tool error: params must be a JSON object"

        from nmb_marketplace_agent.config.database import async_session
        from nmb_marketplace_agent.enterprise.connectors import (
            ConnectorError,
            EgressPolicy,
            build_connector,
        )
        from nmb_marketplace_agent.enterprise.models import ConnectorConfig

        async with async_session() as db:
            row = (await db.execute(select(ConnectorConfig).where(
                ConnectorConfig.tenant_id == tenant_id,
                ConnectorConfig.name == connector,
            ))).scalars().first()
        if not row:
            return f"Connector tool error: connector '{connector}' is not configured for this tenant"
        if not row.enabled:
            return f"Connector tool error: connector '{connector}' is disabled"
        ops = list((row.config.get("operations") or {}).keys()) or list(row.config.get("scripts") or [])
        if operation not in ops:
            return f"Connector tool error: '{operation}' is not exposed; use one of {', '.join(ops) or 'none'}"
        try:
            result = await build_connector(row.name, row.type, row.config, EgressPolicy()).call(operation, params)
        except ConnectorError as e:
            return f"Connector tool error: {e}"
        return json.dumps(result, ensure_ascii=False, default=str)[:20000]

    return StructuredTool.from_function(
        coroutine=call,
        name=name,
        description=description or f"Call the '{connector}' connector operation '{operation}'.",
        args_schema=ConnectorCall,
    )
