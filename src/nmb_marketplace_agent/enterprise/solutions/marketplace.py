"""Marketplace catalog: what a tenant can install, and what they already run.

``loader`` owns pack files and installation. This module only reads them, so the
catalog stays cheap and can be served on every dashboard load.
"""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.enterprise.licensing import License, current_license
from nmb_marketplace_agent.enterprise.models import InstalledSolution, SolutionSnapshot
from nmb_marketplace_agent.enterprise.solutions import loader

_VERSION = re.compile(r"\d+")


def version_key(version: str | None) -> tuple[int, ...]:
    """'1.10.0' → (1, 10, 0); missing/garbage sorts below any real version."""
    parts = tuple(int(p) for p in _VERSION.findall(str(version or ""))[:4])
    return parts or (0,)


def parameter_changes(installed: dict, declared: dict) -> dict[str, list[str]]:
    """What an upgrade will change: explicit overrides, new pack params, dropped ones."""
    changed = sorted(
        k for k in declared
        if k in installed and installed[k] != declared[k].get("default")
    )
    added = sorted(k for k in declared if k not in installed)
    removed = sorted(k for k in installed if k not in declared and k != "model")
    return {"changed": changed, "added": added, "removed": removed}


def upgrade_available(pack_version: str, installed_version: str | None) -> bool:
    return bool(installed_version) and version_key(pack_version) > version_key(installed_version)


def _state(
    pack: dict, inst: InstalledSolution | None, entitled: bool,
    snapshots: list[SolutionSnapshot] | None = None,
) -> dict[str, Any]:
    changes = {"changed": [], "added": [], "removed": []}
    if inst:
        changes = parameter_changes(inst.parameters or {}, pack.get("parameters") or {})
    return {
        "installed": inst is not None,
        "entitled": entitled,
        "installed_version": inst.version if inst else None,
        "installed_at": inst.installed_at if inst else None,
        "installed_by": inst.installed_by if inst else None,
        "upgrade_available": bool(
            inst and upgrade_available(pack.get("version", "1.0.0"), inst.version)
        ),
        "parameter_changes": changes,
        "upgraded_at": (inst.created or {}).get("upgraded_at") if inst else None,
        "upgrade_history": (inst.created or {}).get("upgrades", []) if inst else [],
        "rollback_versions": [
            {"version": s.version, "created_at": s.created_at, "created_by": s.created_by}
            for s in (snapshots or [])
            if inst and s.version != inst.version
        ],
        # install_solution stores the conformance run on the install record.
        "conformance": (inst.created or {}).get("conformance") if inst else None,
    }


async def _installed_map(db: AsyncSession, tenant_id: str) -> dict[str, InstalledSolution]:
    rows = (await db.execute(
        select(InstalledSolution).where(InstalledSolution.tenant_id == tenant_id)
    )).scalars().all()
    return {r.solution_id: r for r in rows}


def _license_view(lic: License) -> dict[str, Any]:
    return {
        "customer": lic.customer,
        "edition": lic.edition,
        "state": lic.state,
        "entitled_solutions": sorted(lic.solutions),
        "expires_at": lic.exp,
    }


async def catalog(
    db: AsyncSession, tenant_id: str, lic: License | None = None,
) -> dict[str, Any]:
    lic = lic or current_license()
    installed = await _installed_map(db, tenant_id)
    snaps: dict[str, list[SolutionSnapshot]] = {}
    for s in (await db.execute(
        select(SolutionSnapshot)
        .where(SolutionSnapshot.tenant_id == tenant_id)
        .order_by(SolutionSnapshot.created_at.desc())
    )).scalars().all():
        snaps.setdefault(s.solution_id, []).append(s)
    packs: list[dict] = []
    for summary in loader.list_packs():
        inst = installed.get(summary["id"])
        packs.append(summary | _state(
            summary, inst, lic.has_solution(summary["id"]), snaps.get(summary["id"]),
        ))
    return {
        "license": _license_view(lic),
        "counts": {
            "total": len(packs),
            "installed": sum(1 for p in packs if p["installed"]),
            "upgrades": sum(1 for p in packs if p["upgrade_available"]),
            "entitled": sum(1 for p in packs if p["entitled"]),
        },
        "packs": packs,
    }


def pack_detail(solution_id: str) -> dict[str, Any]:
    """Everything a sales/demo page needs, without prompts or policy internals."""
    pack = loader.load_pack(solution_id)
    sup = pack.get("supervisor")
    return {
        "id": pack["id"],
        "name": pack["name"],
        "industry": pack["industry"],
        "version": pack.get("version", "1.0.0"),
        "summary": pack.get("summary", ""),
        "priority": pack.get("priority", "later"),
        "delivery": pack.get("delivery", "workflow"),
        "audience": pack.get("audience", []),
        "frameworks": pack.get("compliance_frameworks", []),
        "kpis": pack.get("kpis", []),
        "parameters": pack.get("parameters", {}),
        "models": pack.get("models", []),
        "widget": pack.get("widget"),
        "samples": [
            {"id": c["id"], "title": c["title"], "expect": c.get("expect")}
            for c in (pack.get("samples") or {}).get("cases", [])
        ],
        "agents": [
            {"key": a["key"], "name": a["name"], "tools": a.get("tools", [])}
            for a in pack.get("agents", [])
        ],
        "supervisor": (
            {
                "key": sup["key"],
                "name": sup["name"],
                "delegates": sup.get("delegates", []),
                "limits": sup.get("limits", {}),
            }
            if sup else None
        ),
        "workflows": [
            {"key": w["key"], "name": w.get("name", w["key"]), "description": w.get("description")}
            for w in pack.get("workflows", [])
        ],
        "knowledge": [
            {
                "collection": k["collection"],
                "description": k.get("description"),
                "documents": len(k.get("documents", [])),
                "attach_to": k.get("attach_to", []),
            }
            for k in pack.get("knowledge", [])
        ],
        "connectors": [{"name": c["name"], "type": c["type"]} for c in pack.get("connectors", [])],
        "evals": [
            {"name": e["name"], "agent": e.get("agent"), "cases": len(e.get("cases", []))}
            for e in pack.get("evals", [])
        ],
        "training": [
            {"name": t.get("name"), "task": t.get("task"), "rows": loader._safe_line_count(
                pack["id"], t.get("file", ""))}
            for t in pack.get("training", [])
        ],
        "policy": {
            "rules": len((pack.get("policy") or {}).get("rules", [])),
            "tool_rules": len((pack.get("policy") or {}).get("tool_rules", [])),
        },
    }


async def detail(
    db: AsyncSession, tenant_id: str, solution_id: str, lic: License | None = None,
) -> dict[str, Any]:
    lic = lic or current_license()
    inst = await db.get(InstalledSolution, f"{tenant_id}:{solution_id}")
    pack = pack_detail(solution_id)
    snaps = await loader.snapshots(db, tenant_id, solution_id)
    return pack | _state(pack, inst, lic.has_solution(solution_id), snaps)
