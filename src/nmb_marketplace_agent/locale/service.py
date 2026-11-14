"""Attach/detach a locale profile on an agent and seed its eval dataset.

Attachment compiles the profile into a normal subagent row plus an agent column,
so the existing graph builder and version snapshots need no special cases.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.config.models import (
    AgentConfig,
    EvalCase,
    EvalDataset,
    SubAgentConfig,
)
from nmb_marketplace_agent.config.versioning import effective_config
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.locale.compiler import compile_specialist
from nmb_marketplace_agent.locale.models import LocaleExample, LocaleProfile


def generated_subagent_id(tenant_id: str, profile_id: str, agent_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"nmb-locale:{tenant_id}:{profile_id}:{agent_id}"))


async def load_profile(db: AsyncSession, profile_id: str | None,
                       tenant_id: str = "default") -> LocaleProfile | None:
    if not profile_id:
        return None
    row = await db.get(LocaleProfile, profile_id)
    if not row or row.tenant_id != tenant_id:
        return None
    return row


async def load_examples(db: AsyncSession, profile_id: str) -> list[LocaleExample]:
    rows = (await db.execute(
        select(LocaleExample)
        .where(LocaleExample.profile_id == profile_id, LocaleExample.enabled == True)  # noqa: E712
        .order_by(LocaleExample.created_at)
    )).scalars().all()
    return list(rows)


async def locale_for_agent(db: AsyncSession, agent: AgentConfig | None,
                           use_draft: bool = False) -> tuple[LocaleProfile | None, list[LocaleExample]]:
    if not agent:
        return None, []
    cfg, _ = await effective_config(agent, use_draft)
    profile = await load_profile(db, cfg.get("locale_profile_id"), agent.tenant_id)
    if not profile or not profile.enabled:
        return None, []
    return profile, await load_examples(db, profile.id)


async def attach(db: AsyncSession, profile: LocaleProfile, agent: AgentConfig,
                 actor: str = "admin-token") -> dict:
    if profile.tenant_id != agent.tenant_id:
        raise ValueError("Profile and agent belong to different tenants")
    if not profile.enabled:
        raise ValueError("Profile is disabled")
    examples = await load_examples(db, profile.id)
    spec = compile_specialist(profile, examples)
    sub_id = generated_subagent_id(agent.tenant_id, profile.id, agent.id)

    row = await db.get(SubAgentConfig, sub_id)
    if row is None:
        row = SubAgentConfig(id=sub_id, tenant_id=agent.tenant_id)
    row.name = spec["name"]
    row.description = spec["description"]
    row.system_prompt = spec["system_prompt"]
    row.mode = "sync"
    db.add(row)

    agent.locale_profile_id = profile.id
    ids = [i for i in (agent.subagent_ids or []) if i != sub_id]
    agent.subagent_ids = ids + [sub_id]
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    await audit.record(
        db, tenant_id=agent.tenant_id, actor=actor, actor_type="api_key",
        action="locale.attached", resource_type="agent", resource_id=agent.id,
        details={"profile_id": profile.id, "profile": profile.name, "subagent_id": sub_id,
                 "examples": len(examples)},
    )
    return {"agent_id": agent.id, "profile_id": profile.id, "subagent_id": sub_id,
            "subagent_ids": list(agent.subagent_ids), "examples": len(examples)}


async def detach(db: AsyncSession, profile: LocaleProfile, agent: AgentConfig,
                 actor: str = "admin-token") -> dict:
    sub_id = generated_subagent_id(agent.tenant_id, profile.id, agent.id)
    agent.subagent_ids = [i for i in (agent.subagent_ids or []) if i != sub_id]
    if agent.locale_profile_id == profile.id:
        agent.locale_profile_id = None
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    row = await db.get(SubAgentConfig, sub_id)
    if row is not None:
        await db.delete(row)
        await db.commit()

    await audit.record(
        db, tenant_id=agent.tenant_id, actor=actor, actor_type="api_key",
        action="locale.detached", resource_type="agent", resource_id=agent.id,
        details={"profile_id": profile.id, "profile": profile.name, "subagent_id": sub_id},
    )
    return {"agent_id": agent.id, "profile_id": profile.id, "subagent_id": sub_id,
            "subagent_ids": list(agent.subagent_ids)}


async def detach_everywhere(db: AsyncSession, profile: LocaleProfile) -> int:
    rows = (await db.execute(
        select(AgentConfig).where(
            AgentConfig.tenant_id == profile.tenant_id,
            AgentConfig.locale_profile_id == profile.id,
        )
    )).scalars().all()
    for agent in rows:
        await detach(db, profile, agent, actor="profile-delete")
    return len(rows)


async def seed_eval(db: AsyncSession, profile: LocaleProfile, agent: AgentConfig) -> dict:
    cases = [c for c in (profile.sample_cases or []) if isinstance(c, dict) and c.get("input")]
    if not cases:
        raise ValueError("Profile has no sample_cases to seed")
    ds = EvalDataset(
        id=str(uuid.uuid4()),
        name=f"Locale · {profile.name}",
        agent_id=agent.id,
        tenant_id=agent.tenant_id,
    )
    db.add(ds)
    for case in cases:
        db.add(EvalCase(
            id=str(uuid.uuid4()),
            dataset_id=ds.id,
            input=str(case["input"]),
            expected_contains=str(case.get("expected_contains") or "") or None,
            criteria=(str(case["criteria"]) if case.get("criteria") else None),
        ))
    await db.commit()
    await db.refresh(ds)
    await audit.record(
        db, tenant_id=agent.tenant_id, actor="admin-token", actor_type="api_key",
        action="locale.eval_seeded", resource_type="agent", resource_id=agent.id,
        details={"profile_id": profile.id, "dataset_id": ds.id, "cases": len(cases)},
    )
    return {"dataset_id": ds.id, "agent_id": agent.id, "cases": len(cases)}
