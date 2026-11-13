import hashlib
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import (
    AgentConfig,
    AgentVersion,
    EvalDataset,
    EvalRun,
    RAGCollection,
    SubAgentConfig,
    ToolConfig,
)
from nmb_marketplace_agent.config.versioning import snapshot_of
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.models import InstalledSolution
from nmb_marketplace_agent.prompts.resolver import is_ref, resolve_with_provenance


async def _check_refs(db, tenant_id, *, tool_ids=None, rag_ids=None, sub_ids=None):
    for tid in tool_ids or []:
        t = await db.get(ToolConfig, tid)
        if not t or t.tenant_id != tenant_id:
            raise HTTPException(400, f"Tool {tid} not found for this tenant")
    for rid in rag_ids or []:
        r = await db.get(RAGCollection, rid)
        if not r or r.tenant_id != tenant_id:
            raise HTTPException(400, f"RAG collection {rid} not found for this tenant")
    for sid in sub_ids or []:
        s = await db.get(SubAgentConfig, sid)
        if not s or s.tenant_id != tenant_id:
            raise HTTPException(400, f"Subagent {sid} not found for this tenant")


router = APIRouter()


class AgentCreate(BaseModel):
    name: str
    model: str = "ollama:llama3.1:8b"
    system_prompt: str = ""
    tool_ids: list[str] = []
    rag_collection_ids: list[str] = []
    subagent_ids: list[str] = []
    tenant_id: str = "default"


class AgentPatch(BaseModel):
    name: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    tool_ids: list[str] | None = None
    rag_collection_ids: list[str] | None = None
    subagent_ids: list[str] | None = None


@router.post("")
async def create_agent(body: AgentCreate, db: AsyncSession = Depends(get_db)):
    agent = AgentConfig(id=str(uuid.uuid4()), **body.model_dump())
    await _check_refs(db, body.tenant_id,
                      tool_ids=body.tool_ids,
                      rag_ids=body.rag_collection_ids,
                      sub_ids=body.subagent_ids)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.get("")
async def list_agents(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(AgentConfig).where(AgentConfig.tenant_id == tenant_id))
    return res.scalars().all()


@router.get("/{agent_id}")
async def get_agent(agent_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentConfig, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agent not found")
    return agent


@router.patch("/{agent_id}")
async def patch_agent(agent_id: str, body: AgentPatch, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentConfig, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agent not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(agent, k, v)
    if body.tool_ids is not None:
        await _check_refs(db, tenant_id, tool_ids=body.tool_ids)
    if body.rag_collection_ids is not None:
        await _check_refs(db, tenant_id, rag_ids=body.rag_collection_ids)
    if body.subagent_ids is not None:
        await _check_refs(db, tenant_id, sub_ids=body.subagent_ids)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    agent = await db.get(AgentConfig, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise HTTPException(404, "Agent not found")
    await db.delete(agent)
    await db.commit()
    return {"ok": True}


async def _conformance_block(db: AsyncSession, agent: AgentConfig) -> dict | None:
    """Supervisor conformance gate. Broken runners (error set) are non-blocking."""
    rows = (await db.execute(
        select(InstalledSolution).where(InstalledSolution.tenant_id == agent.tenant_id)
    )).scalars().all()
    inst = next(
        (i for i in rows if (i.created or {}).get("supervisor") == agent.id),
        None,
    )
    if not inst:
        return None
    conf = (inst.created or {}).get("conformance")
    if not conf:
        return None
    if conf.get("error"):
        return None

    cases = conf.get("cases", [])
    real_failures = [c for c in cases if not c.get("passed") and not c.get("error")]
    errored = [c for c in cases if c.get("error")]
    if not real_failures:
        return None

    return {
        "solution": inst.solution_id,
        "passed": conf.get("passed", 0),
        "total": conf.get("total", 0),
        "failed": real_failures,
        "errored": errored,
    }


async def _eval_block(db: AsyncSession, agent: AgentConfig) -> dict | None:
    """Publish gate: refuse to publish if the latest draft eval fails its threshold.

    Returns None (non-blocking) when:
      - the agent is not part of an installed solution, or
      - no EvalDataset targets this agent (pack didn't ship an eval for it).

    Threshold comes from `InstalledSolution.parameters.publish_gate_min_pass_rate`
    (set at install from the pack's `parameters` block, tunable via install overrides).
    Orchestration is additionally gated when the run has orchestration data and
    `publish_gate_min_orchestration_rate` is set.
    """
    rows = (await db.execute(
        select(InstalledSolution).where(InstalledSolution.tenant_id == agent.tenant_id)
    )).scalars().all()
    owned: list[tuple[InstalledSolution, dict]] = []
    for i in rows:
        created = i.created or {}
        agents_map = created.get("agents") or {}
        members = set(agents_map.values())
        if created.get("supervisor"):
            members.add(created["supervisor"])
        if agent.id in members:
            owned.append((i, created))
    if not owned:
        return None

    ds_list = (await db.execute(
        select(EvalDataset).where(
            EvalDataset.agent_id == agent.id,
            EvalDataset.tenant_id == agent.tenant_id,
        )
    )).scalars().all()
    if not ds_list:
        return None

    inst, _created = owned[0]
    params = inst.parameters or {}
    threshold = float(params.get("publish_gate_min_pass_rate", 0.7))
    min_orch = params.get("publish_gate_min_orchestration_rate")

    latest = (await db.execute(
        select(EvalRun)
        .where(
            EvalRun.agent_id == agent.id,
            EvalRun.target == "draft",
            EvalRun.status == "done",
        )
        .order_by(EvalRun.created_at.desc())
        .limit(1)
    )).scalars().first()

    if not latest:
        return {
            "solution": inst.solution_id,
            "reason": "no_eval_run",
            "message": "No draft eval run yet — run the eval set in Evaluations before publishing.",
            "threshold": threshold,
        }

    summary = latest.summary or {}
    pass_rate = summary.get("pass_rate")
    orch_rate = summary.get("orchestration_rate")

    failures: list[dict] = []
    if pass_rate is None or pass_rate < threshold:
        failures.append({
            "dimension": "answer",
            "pass_rate": pass_rate,
            "threshold": threshold,
        })
    if min_orch is not None and orch_rate is not None:
        try:
            min_orch_f = float(min_orch)
        except (TypeError, ValueError):
            min_orch_f = None
        if min_orch_f is not None and orch_rate < min_orch_f:
            failures.append({
                "dimension": "orchestration",
                "pass_rate": orch_rate,
                "threshold": min_orch_f,
            })

    if not failures:
        return None

    return {
        "solution": inst.solution_id,
        "eval_run_id": latest.id,
        "created_at": latest.created_at,
        "pass_rate": pass_rate,
        "threshold": threshold,
        "orchestration_rate": orch_rate,
        "failures": failures,
    }


async def _capture_provenance(agent: AgentConfig) -> dict:
    """What exactly is being published: prompt source, model, KB, delegates.

    Langfuse already versions prompts; this records which version the publish
    snapshotted so rollback and audit can answer 'what was live on date X' without
    a re-lookup against a registry that may have changed.
    """
    prompt = agent.system_prompt or ""
    if is_ref(prompt):
        text, meta = await resolve_with_provenance(prompt, "")
        prompt_prov = {**meta, "hash": hashlib.sha256(text.encode()).hexdigest()[:16]}
    else:
        prompt_prov = {
            "kind": "inline",
            "hash": hashlib.sha256(prompt.encode()).hexdigest()[:16],
        }

    return {
        "captured_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "prompt": prompt_prov,
        "model": {"ref": agent.model},
        "rag_collection_ids": list(agent.rag_collection_ids or []),
        "subagent_ids": list(agent.subagent_ids or []),
    }


@router.post("/{agent_id}/publish")
async def publish_agent(
    agent_id: str,
    body: dict = Body(default={}),
    db: AsyncSession = Depends(get_db),
):
    agent = await db.get(AgentConfig, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    note = str(body.get("note") or "")
    override_reason = str(body.get("override_reason") or "").strip()

    # ── gate 1: conformance ─────────────────────────────────────────
    conf_block = await _conformance_block(db, agent)
    if conf_block and not override_reason:
        raise HTTPException(409, detail={
            "error": "conformance_failed",
            "detail": conf_block,
            "hint": "Pass override_reason to publish anyway; the override is audited.",
        })

    # ── gate 2: eval ────────────────────────────────────────────────
    eval_block = await _eval_block(db, agent)
    if eval_block and not override_reason:
        raise HTTPException(409, detail={
            "error": "eval_failed",
            "detail": eval_block,
            "hint": "Pass override_reason to publish anyway; the override is audited.",
        })

    # ── snapshot + provenance ───────────────────────────────────────
    last = (await db.execute(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version.desc())
        .limit(1)
    )).scalars().first()
    next_version = (last.version + 1) if last else 1

    await db.execute(
        update(AgentVersion)
        .where(AgentVersion.agent_id == agent_id, AgentVersion.published == True)  # noqa: E712
        .values(published=False)
    )

    snapshot = snapshot_of(agent)
    snapshot["provenance"] = await _capture_provenance(agent)

    row = AgentVersion(
        id=str(uuid.uuid4()),
        agent_id=agent_id,
        tenant_id=agent.tenant_id,
        version=next_version,
        snapshot=snapshot,
        note=note,
        published=True,
    )
    db.add(row)
    await db.commit()

    # ── audit ───────────────────────────────────────────────────────
    details: dict = {"version": next_version, "note": note,
                     "provenance": snapshot["provenance"]}
    action = "agent.published"
    if conf_block and override_reason:
        action = "agent.published_with_conformance_override"
        details["conformance_override_reason"] = override_reason
        details["failed_conformance_cases"] = [c["id"] for c in conf_block["failed"]]
    if eval_block and override_reason:
        action = "agent.published_with_eval_override"
        details["eval_override_reason"] = override_reason
        details["eval"] = {
            "pass_rate": eval_block.get("pass_rate"),
            "threshold": eval_block.get("threshold"),
            "failures": eval_block.get("failures"),
        }
    await audit.record(
        db,
        tenant_id=agent.tenant_id,
        actor=body.get("actor") or "publisher",
        action=action,
        resource_type="agent",
        resource_id=agent_id,
        details=details,
    )

    return {
        "agent_id": agent_id,
        "version": next_version,
        "published": True,
        "conformance": (
            {"passed": conf_block["passed"], "total": conf_block["total"], "override": True}
            if conf_block and override_reason else None
        ),
        "eval": (
            {
                "pass_rate": eval_block.get("pass_rate"),
                "threshold": eval_block.get("threshold"),
                "failures": eval_block.get("failures"),
                "override": True,
            }
            if eval_block and override_reason else None
        ),
        "provenance": snapshot["provenance"],
    }