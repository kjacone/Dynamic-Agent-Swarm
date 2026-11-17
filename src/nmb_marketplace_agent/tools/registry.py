"""Runtime tool materialization from DB config."""
from typing import Any

from langchain_core.tools import BaseTool

from nmb_marketplace_agent.config import database
from nmb_marketplace_agent.config.models import ToolConfig
from nmb_marketplace_agent.custom_tools.live_data import (
    country_profile,
    fx_convert,
    ip_location,
    local_weather,
    next_business_day,
    public_holidays,
)
from nmb_marketplace_agent.tools.builtin.calculator import calculator
from nmb_marketplace_agent.tools.builtin.generative_ui import (
    ui_alert,
    ui_cards,
    ui_chart,
    ui_form,
    ui_render,
    ui_stats,
    ui_status,
    ui_table,
    ui_timeline,
)
from nmb_marketplace_agent.tools.builtin.http_tool import make_http_tool
from nmb_marketplace_agent.tools.builtin.search import tavily_search

_BUILTINS: dict[str, BaseTool] = {
    "tavily_search": tavily_search,
    "calculator": calculator,
    "fx_convert": fx_convert,
    "public_holidays": public_holidays,
    "next_business_day": next_business_day,
    "country_profile": country_profile,
    "ip_location": ip_location,
    "local_weather": local_weather,
    "ui_cards": ui_cards,
    "ui_table": ui_table,
    "ui_stats": ui_stats,
    "ui_chart": ui_chart,
    "ui_timeline": ui_timeline,
    "ui_status": ui_status,
    "ui_form": ui_form,
    "ui_alert": ui_alert,
    "ui_render": ui_render,
}


async def _load_tool_cfg(tool_id: str) -> ToolConfig | None:
    async with database.async_session() as session:
        return await session.get(ToolConfig, tool_id)


def _materialize(cfg: ToolConfig) -> BaseTool:
    if cfg.type == "builtin":
        if cfg.name not in _BUILTINS:
            raise ValueError(f"Unknown builtin tool: {cfg.name}")
        return _BUILTINS[cfg.name]

    if cfg.type == "http":
        endpoint = cfg.config.get("endpoint")
        if not endpoint:
            raise ValueError(f"HTTP tool '{cfg.name}' missing endpoint")
        return make_http_tool(cfg.name, endpoint, cfg.description)

    if cfg.type == "frontend":
        from nmb_marketplace_agent.tools.builtin.frontend import make_frontend_tool
        return make_frontend_tool(cfg.name, cfg.description, cfg.config.get("parameters"))

    if cfg.type == "connector":
        connector = cfg.config.get("connector")
        operation = cfg.config.get("operation")
        if not connector or not operation:
            raise ValueError(f"Connector tool '{cfg.name}' needs config.connector and config.operation")
        from nmb_marketplace_agent.tools.builtin.connector_tool import make_connector_tool
        return make_connector_tool(cfg.name, cfg.tenant_id, connector, operation, cfg.description)

    if cfg.type == "python":
        dotted = cfg.config.get("dotted_path")
        if not dotted:
            raise ValueError(f"Python tool '{cfg.name}' missing dotted_path")
        import os
        prefixes = [x.strip() for x in os.environ.get(
            "PYTHON_TOOL_PREFIXES", "nmb_marketplace_agent.custom_tools.").split(",") if x.strip()]
        if not any(dotted.startswith(x) for x in prefixes):
            raise ValueError(f"dotted_path must start with one of {prefixes}")
        mod_path, fn_name = dotted.rsplit(".", 1)
        import importlib
        mod = importlib.import_module(mod_path)
        fn = getattr(mod, fn_name)
        return fn() if callable(fn) and not isinstance(fn, BaseTool) else fn

    raise ValueError(f"Unknown tool type: {cfg.type}")


async def resolve_tool(tool_id: str) -> BaseTool:
    cfg = await _load_tool_cfg(tool_id)
    if not cfg:
        raise ValueError(f"ToolConfig not found: {tool_id}")
    return _materialize(cfg)


async def resolve_tools(ids: list[str]) -> list[Any]:
    return [await resolve_tool(i) for i in ids]
