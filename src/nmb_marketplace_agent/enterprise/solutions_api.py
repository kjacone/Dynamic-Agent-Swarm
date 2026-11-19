"""Solution marketplace and pack installs."""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise.api_common import _bg, _engine, _wf_err
from nmb_marketplace_agent.enterprise.licensing import (
    current_license,
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    InstalledSolution,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires
from nmb_marketplace_agent.enterprise.solutions import loader as packs
from nmb_marketplace_agent.enterprise.solutions import marketplace
from nmb_marketplace_agent.enterprise.workflows.engine import (
    WorkflowError,
)
from nmb_marketplace_agent.enterprise.workflows_api import _run_view

router = APIRouter()




# ── marketplace ───────────────────────────────────────────────────────
@router.get("/marketplace", dependencies=[Depends(require_module("solutions"))])
async def marketplace_catalog(p: Principal = Depends(requires("solutions:read")),
                              db: AsyncSession = Depends(get_db)):
    return await marketplace.catalog(db, p.tenant_id, current_license())


@router.get("/marketplace/{solution_id}", dependencies=[Depends(require_module("solutions"))])
async def marketplace_pack(solution_id: str,
                           p: Principal = Depends(requires("solutions:read")),
                           db: AsyncSession = Depends(get_db)):
    try:
        return await marketplace.detail(db, p.tenant_id, solution_id, current_license())
    except packs.PackError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/marketplace/{solution_id}/upgrade",
             dependencies=[Depends(require_module("solutions"))])
async def marketplace_upgrade(solution_id: str,
                              p: Principal = Depends(requires("solutions:write")),
                              db: AsyncSession = Depends(get_db)):
    inst = await db.get(InstalledSolution, f"{p.tenant_id}:{solution_id}")
    if not inst:
        raise HTTPException(404, "Install the solution first.")
    try:
        pack = packs.load_pack(solution_id)
    except packs.PackError as e:
        raise HTTPException(404, str(e)) from e

    from_version, before = inst.version, dict(inst.parameters)
    latest = pack.get("version", "1.0.0")
    if not marketplace.upgrade_available(latest, from_version):
        raise HTTPException(
            409,
            f"Installed v{from_version} is already current (catalog v{latest}).",
        )
    if not current_license().has_solution(solution_id):
        raise HTTPException(402, f"Solution '{solution_id}' is not included in your license")

    try:
        new = await packs.install_solution(db, p.tenant_id, solution_id, p.sub)
    except (packs.PackError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from e
    return {
        "solution": solution_id,
        "from_version": from_version,
        "to_version": new.version,
        "parameters": new.parameters,
        "parameter_changes": marketplace.parameter_changes(
            before, pack.get("parameters") or {},
        ),
        "created": new.created,
    }


class RollbackRequest(BaseModel):
    version: str | None = None


@router.post("/marketplace/{solution_id}/rollback",
             dependencies=[Depends(require_module("solutions"))])
async def marketplace_rollback(solution_id: str, body: RollbackRequest | None = None,
                               p: Principal = Depends(requires("solutions:write")),
                               db: AsyncSession = Depends(get_db)):
    inst = await db.get(InstalledSolution, f"{p.tenant_id}:{solution_id}")
    if not inst:
        raise HTTPException(404, "Install the solution first.")
    if not current_license().has_solution(solution_id):
        raise HTTPException(402, f"Solution '{solution_id}' is not included in your license")
    try:
        applied, from_version = await packs.rollback_solution(
            db, p.tenant_id, solution_id, p.sub, body.version if body else None,
        )
    except packs.NothingToRollBack as e:
        raise HTTPException(409, str(e)) from e
    except (packs.PackError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from e
    return {
        "solution": solution_id,
        "from_version": from_version,
        "to_version": applied.version,
        "parameters": applied.parameters,
        "created": applied.created,
    }


# ── solutions ─────────────────────────────────────────────────────────
@router.get("/solutions", dependencies=[Depends(require_module("solutions"))])
async def solutions(p: Principal = Depends(requires("solutions:read")),
                    db: AsyncSession = Depends(get_db)):
    return (await marketplace.catalog(db, p.tenant_id, current_license()))["packs"]


class InstallRequest(BaseModel):
    parameters: dict[str, Any] = Field(default_factory=dict)


@router.post("/solutions/{solution_id}/install", dependencies=[Depends(require_module("solutions"))])
async def solution_install(solution_id: str, body: InstallRequest, p: Principal = Depends(requires("solutions:write")),
                           db: AsyncSession = Depends(get_db)):
    try:
        inst = await packs.install_solution(db, p.tenant_id, solution_id, p.sub, body.parameters)
    except (packs.PackError, WorkflowError) as e:
        raise HTTPException(422, str(e)) from e
    return {"solution": solution_id, "version": inst.version, "created": inst.created, "parameters": inst.parameters}

@router.post("/solutions/{solution_id}/samples/{case_id}/run",
             dependencies=[Depends(require_module("solutions"))])
async def run_sample(solution_id: str, case_id: str,
                     p: Principal = Depends(requires("workflows:run")),
                     db: AsyncSession = Depends(get_db)):
    pack = packs.load_pack(solution_id)
    case = next(
        (c for c in (pack.get("samples") or {}).get("cases", []) if c["id"] == case_id),
        None,
    )
    if not case:
        raise HTTPException(404, f"Sample case '{case_id}' not found in '{solution_id}'")

    eng = await _engine(db, p.tenant_id)
    try:
        run = await eng.start(case["workflow"], case["inputs"],
                              f"sample:{p.sub}", run_now=False)
    except WorkflowError as e:
        raise _wf_err(e) from e

    t = asyncio.create_task(_advance_in_background(run.id, p.tenant_id))
    _bg.add(t)
    t.add_done_callback(_bg.discard)

    return _run_view(run) | {"expect": case.get("expect")}

async def _advance_in_background(run_id: str, tenant: str):
    from nmb_marketplace_agent.config.database import async_session
    async with async_session() as s:
        try:
            await (await _engine(s, tenant)).advance(run_id)
        except Exception:  # noqa: BLE001 — the engine records failures on the run
            pass

@router.get("/solutions/{solution_id}/embed",
            dependencies=[Depends(require_module("solutions"))])
async def solution_embed(solution_id: str, request: Request,
                         p: Principal = Depends(requires("solutions:read")),
                         db: AsyncSession = Depends(get_db)):
    pack = packs.load_pack(solution_id)
    w = pack.get("widget")
    if pack.get("delivery", "workflow") == "workflow":
        raise HTTPException(409, "This solution is back-office only; there is no widget to embed.")
    if not w:
        raise HTTPException(409, "This solution does not declare a widget.")
    inst = await db.get(InstalledSolution, f"{p.tenant_id}:{solution_id}")
    if not inst:
        raise HTTPException(404, "Install the solution first.")
    supervisor_id = (inst.created or {}).get("supervisor")
    if not supervisor_id:
        raise HTTPException(409, "Install the solution with a supervisor to embed the widget.")

    base = str(request.base_url).rstrip("/")
    return {
        "agent_id": supervisor_id,
        "widget": w,
        "script": (
            f'<script src="{base}/embed.js" '
            f'data-key="pk_YOUR_PUBLISHABLE_KEY" '
            f'data-api="{base}" '
            f'data-title="{w.get("title", "")}"></script>'
        ),
        "steps": [
            "Publish the supervisor agent (Agents → Versions → Publish).",
            "Create a publishable key in Settings, restricted to your site's origin.",
            "Paste the script tag, or use the agent-kit React provider for frontend tools.",
        ],
    }
