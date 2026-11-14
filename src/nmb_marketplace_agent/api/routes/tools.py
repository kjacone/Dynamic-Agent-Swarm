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
        arg = body.kwargs if body.kwargs else (body.input or "")
        result = await t.ainvoke(arg)
        return {"ok": True, "result": str(result)[:4000]}
    except Exception as e:
        raise HTTPException(502, f"{type(e).__name__}: {e}"[:400])