"""Solution packs: industry configuration on top of one platform.

A pack (YAML) bundles agents, prompts, workflows, policies, connector templates, evaluation
datasets and KPIs. Installing a pack into a tenant is idempotent and parameterised
(``${param}``), so "banking KYC" vs "insurance claims" is configuration, not a code fork.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config.models import AgentConfig, EvalCase, EvalDataset, ToolConfig
from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.guardrails import DEFAULT_POLICY, Policy
from nmb_marketplace_agent.enterprise.licensing import current_license
from nmb_marketplace_agent.enterprise.models import ConnectorConfig, InstalledSolution, PolicySet, now_iso
from nmb_marketplace_agent.enterprise.workflows.engine import Runtime, WorkflowEngine

PACK_DIR = Path(__file__).parent / "packs"
_NS = uuid.UUID("6f1c2f0e-7d1a-4d57-9b0e-3c4f5a6b7c8d")
_VAR = re.compile(r"\$\{(\w+)\}")
BUILTIN_TOOLS = {"calculator", "tavily_search"}


class PackError(Exception):
    pass


def _path(solution_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9\-]+", solution_id):
        raise PackError("Invalid solution id")
    return PACK_DIR / f"{solution_id}.yaml"


def load_pack(solution_id: str) -> dict:
    p = _path(solution_id)
    if not p.exists():
        raise PackError(f"Unknown solution '{solution_id}'")
    return yaml.safe_load(p.read_text())


def list_packs() -> list[dict]:
    out = []
    for p in sorted(PACK_DIR.glob("*.yaml")):
        d = yaml.safe_load(p.read_text())
        out.append({"id": d["id"], "name": d["name"], "industry": d["industry"], "version": d.get("version", "1.0.0"),
                    "summary": d.get("summary", ""), "priority": d.get("priority", "later"),
                    "agents": len(d.get("agents", [])), "workflows": len(d.get("workflows", [])),
                    "frameworks": d.get("compliance_frameworks", []), "kpis": [k["name"] for k in d.get("kpis", [])],
                    "parameters": d.get("parameters", {})})
    return out


def _subst(obj: Any, params: dict) -> Any:
    if isinstance(obj, str):
        m = _VAR.fullmatch(obj.strip())
        if m:
            return params.get(m.group(1), obj)
        return _VAR.sub(lambda mm: str(params.get(mm.group(1), mm.group(0))), obj)
    if isinstance(obj, list):
        return [_subst(o, params) for o in obj]
    if isinstance(obj, dict):
        return {k: _subst(v, params) for k, v in obj.items()}
    return obj


def agent_id(tenant_id: str, solution_id: str, key: str) -> str:
    return str(uuid.uuid5(_NS, f"{tenant_id}/{solution_id}/{key}"))


async def install_solution(db: AsyncSession, tenant_id: str, solution_id: str, actor: str,
                           overrides: dict | None = None) -> InstalledSolution:
    if not current_license().has_solution(solution_id):
        raise PackError(f"Solution '{solution_id}' is not included in your license")
    pack = load_pack(solution_id)
    declared = pack.get("parameters", {})
    params = {k: v.get("default") for k, v in declared.items()}
    params.setdefault("model", settings.main_model)
    prev = await db.get(InstalledSolution, f"{tenant_id}:{solution_id}")
    if prev:  # re-install = upgrade: keep the customer's earlier tuning unless overridden
        params.update({k: v for k, v in prev.parameters.items() if k in params})
    for k, v in (overrides or {}).items():
        if k not in declared and k != "model":
            raise PackError(f"Unknown parameter '{k}'")
        params[k] = v
    pack = _subst(pack, params)
    created: dict[str, Any] = {"agents": {}, "workflows": [], "connectors": [], "tools": {}}

    # tools (builtins only; HTTP/Python tools are tenant-specific and added by connectors)
    tool_ids: dict[str, str] = {}
    for name in sorted({t for a in pack.get("agents", []) for t in a.get("tools", [])}):
        if name not in BUILTIN_TOOLS:
            continue
        tid = str(uuid.uuid5(_NS, f"{tenant_id}/tool/{name}"))
        if not await db.get(ToolConfig, tid):
            db.add(ToolConfig(id=tid, name=name, type="builtin", description=name, tenant_id=tenant_id))
        tool_ids[name] = tid
    created["tools"] = tool_ids

    # agents (idempotent upsert -> re-install = upgrade)
    for a in pack.get("agents", []):
        aid = agent_id(tenant_id, solution_id, a["key"])
        row = await db.get(AgentConfig, aid) or AgentConfig(id=aid, tenant_id=tenant_id, name="")
        row.name, row.model, row.system_prompt = f"{pack['name']} · {a['name']}", a.get("model") or params["model"], a["system_prompt"].strip()
        row.tool_ids = [tool_ids[t] for t in a.get("tools", []) if t in tool_ids]
        db.add(row)
        created["agents"][a["key"]] = aid
    await db.commit()

    # workflows
    engine = WorkflowEngine(db, Runtime(agent_runner=_unused), tenant_id)
    for wf in pack.get("workflows", []):
        wf = _bind_agents(wf, created["agents"])
        d = await engine.save_definition(wf, actor)
        created["workflows"].append({"key": d.key, "version": d.version})

    # policy = regulated baseline + pack rules
    pol = pack.get("policy") or {}
    merged = Policy(name=f"{solution_id}", rules=[*DEFAULT_POLICY.rules, *[r for r in pol.get("rules", [])]],
                    tool_rules=pol.get("tool_rules", []))
    ps_id = f"{tenant_id}:{solution_id}"
    ps = await db.get(PolicySet, ps_id) or PolicySet(id=ps_id, tenant_id=tenant_id, name=solution_id, version=0)
    ps.spec, ps.version, ps.updated_at = merged.model_dump(), (ps.version or 0) + 1, now_iso()
    db.add(ps)

    # connector templates (disabled until the customer supplies endpoints/secrets)
    for c in pack.get("connectors", []):
        cid = str(uuid.uuid5(_NS, f"{tenant_id}/{solution_id}/conn/{c['name']}"))
        if not await db.get(ConnectorConfig, cid):
            db.add(ConnectorConfig(id=cid, tenant_id=tenant_id, name=c["name"], type=c["type"],
                                   config=c.get("config", {}), enabled=False))
        created["connectors"].append(c["name"])

    # evaluation datasets (reuses the platform's eval runner)
    for ds in pack.get("evals", []):
        did = str(uuid.uuid5(_NS, f"{tenant_id}/{solution_id}/eval/{ds['name']}"))
        if not await db.get(EvalDataset, did):
            db.add(EvalDataset(id=did, name=ds["name"], agent_id=created["agents"][ds["agent"]], tenant_id=tenant_id))
            for i, c in enumerate(ds.get("cases", [])):
                db.add(EvalCase(id=str(uuid.uuid5(_NS, f"{did}/{i}")), dataset_id=did, input=c["input"],
                                expected_contains=c.get("expected_contains"), criteria=c.get("criteria")))
    created["kpis"] = pack.get("kpis", [])

    inst_id = f"{tenant_id}:{solution_id}"
    inst = await db.get(InstalledSolution, inst_id) or InstalledSolution(id=inst_id, tenant_id=tenant_id, solution_id=solution_id)
    inst.version, inst.parameters, inst.created, inst.installed_by, inst.installed_at = (
        pack.get("version", "1.0.0"), params, created, actor, now_iso())
    db.add(inst)
    await db.commit()
    await audit.record(db, tenant_id=tenant_id, actor=actor, action="solution.installed", resource_type="solution",
                       resource_id=solution_id, details={"version": inst.version, "parameters": params})
    return inst


def _bind_agents(wf: dict, agents: dict[str, str]) -> dict:
    def walk(o):
        if isinstance(o, dict):
            return {k: (agents[v[1:]] if k == "agent" and isinstance(v, str) and v.startswith("@") else walk(v)) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(x) for x in o]
        return o
    return walk(wf)


async def _unused(*_a, **_k):  # pragma: no cover
    raise RuntimeError("definition-only engine")


async def installed(db: AsyncSession, tenant_id: str) -> list[InstalledSolution]:
    return list((await db.execute(select(InstalledSolution).where(InstalledSolution.tenant_id == tenant_id))).scalars().all())
