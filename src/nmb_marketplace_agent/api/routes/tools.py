import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import ToolConfig

router = APIRouter()


class ToolCreate(BaseModel):
    name: str
    type: str = "builtin"
    description: str = ""
    config: dict = {}
    tenant_id: str = "default"


@router.post("")
async def create_tool(body: ToolCreate, db: AsyncSession = Depends(get_db)):
    if body.type == "python":
        import os
        d = (body.config or {}).get("dotted_path", "")
        pre = [x.strip() for x in os.environ.get("PYTHON_TOOL_PREFIXES", "nmb_marketplace_agent.custom_tools.").split(",") if x.strip()]
        if not any(d.startswith(x) for x in pre):
            raise HTTPException(400, f"dotted_path must start with one of {pre}")
    if body.type == "http":
        from nmb_marketplace_agent.tools.builtin.http_tool import check_endpoint
        try:
            check_endpoint((body.config or {}).get("endpoint", ""))
        except ValueError as e:
            raise HTTPException(400, str(e))
    if body.type == "frontend":
        params = (body.config or {}).get("parameters")
        if params is not None and not isinstance(params, dict):
            raise HTTPException(400, "config.parameters must be a JSON schema object")
    if body.type == "connector":
        from nmb_marketplace_agent.enterprise.models import ConnectorConfig

        cfg = body.config or {}
        name, operation = cfg.get("connector"), cfg.get("operation")
        if not name or not operation:
            raise HTTPException(400, "Connector tools need config.connector and config.operation")
        row = (await db.execute(select(ConnectorConfig).where(
            ConnectorConfig.tenant_id == body.tenant_id, ConnectorConfig.name == name))).scalars().first()
        if not row:
            raise HTTPException(400, f"Connector {name} not found for this tenant")
        ops = list((row.config.get("operations") or {}).keys()) or list(row.config.get("scripts") or [])
        if operation not in ops:
            raise HTTPException(400, f"Operation must be one of: {', '.join(ops) or 'none'}")
    tool = ToolConfig(id=str(uuid.uuid4()), **body.model_dump())
    db.add(tool)
    await db.commit()
    await db.refresh(tool)
    return tool


@router.get("")
async def list_tools(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ToolConfig).where(ToolConfig.tenant_id == tenant_id))
    return res.scalars().all()


@router.delete("/{tool_id}")
async def delete_tool(tool_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    tool = await db.get(ToolConfig, tool_id)
    if not tool or tool.tenant_id != tenant_id:  # tenant-scoped
        raise HTTPException(404, "Tool not found")
    await db.delete(tool)
    await db.commit()
    return {"ok": True}


class ToolTest(BaseModel):
    input: str | None = None
    kwargs: dict = {}


@router.post("/{tool_id}/test")
async def test_tool(tool_id: str, body: ToolTest, tenant_id: str = "default",
                    db: AsyncSession = Depends(get_db)):
    tool = await db.get(ToolConfig, tool_id)
    if not tool or tool.tenant_id != tenant_id:
        raise HTTPException(404, "Tool not found")
    if tool.type == "frontend":
        raise HTTPException(400, "Frontend tools run in the host page; try them from the widget")
    from nmb_marketplace_agent.tools.registry import resolve_tool
    try:
        t = await resolve_tool(tool_id)
        if tool.type == "connector":
            raw = body.kwargs if body.kwargs else body.input
            if isinstance(raw, str) and raw.strip().startswith("{"):
                import json

                try:
                    raw = json.loads(raw)
                except json.JSONDecodeError:
                    raise HTTPException(400, "Connector tool input must be a JSON object")
            params = raw if isinstance(raw, dict) else ({"query": raw} if raw else {})
            result = await t.ainvoke({"params": params})
        else:
            arg: object = body.kwargs if body.kwargs else (body.input or "")
            if isinstance(arg, str) and arg.strip().startswith("{"):
                import json

                try:
                    parsed = json.loads(arg)
                except json.JSONDecodeError:
                    parsed = None
                names = set(getattr(t, "args", None) or {})
                if isinstance(parsed, dict) and names and set(parsed) <= names:
                    arg = parsed
            result = await t.ainvoke(arg)
        return {"ok": True, "result": str(result)[:4000]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}"[:400])