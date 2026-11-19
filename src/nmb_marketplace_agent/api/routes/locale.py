"""Localisation profiles: CRUD, reviewer corrections, attach/detach, preview.

A profile is pure data; nothing here is language-specific. Attaching compiles it
into a ``Locale Specialist`` subagent plus a runtime middleware rule block, so the
same endpoints serve any language pair or register.
"""
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import AgentConfig
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.locale import service
from nmb_marketplace_agent.locale.compiler import (
    compile_rules,
    compile_specialist,
    format_reply,
)
from nmb_marketplace_agent.locale.models import LocaleExample, LocaleProfile

router = APIRouter()


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    tenant_id: str = "default"
    locale_code: str = ""
    languages: list[str] = []
    default_language: str = ""
    register_style: Literal["formal", "neutral", "casual"] = "formal"
    code_switch_policy: Literal["off", "allowed", "encouraged"] = "allowed"
    currency_code: str = ""
    currency_symbol: str = ""
    currency_position: Literal["before", "after"] = "before"
    decimal_sep: str = "."
    thousand_sep: str = ","
    date_format: str = ""
    glossary: list[dict] = []
    replacements: list[dict] = []
    required_phrases: list[str] = []
    banned_phrases: list[str] = []
    sample_cases: list[dict] = []
    understanding: dict = {}
    output: dict = {}
    speech: dict = {}
    inference: dict = {}
    training: dict = {}
    notes: str = ""
    enabled: bool = True


class ProfilePatch(BaseModel):
    name: str | None = None
    locale_code: str | None = None
    languages: list[str] | None = None
    default_language: str | None = None
    register_style: Literal["formal", "neutral", "casual"] | None = None
    code_switch_policy: Literal["off", "allowed", "encouraged"] | None = None
    currency_code: str | None = None
    currency_symbol: str | None = None
    currency_position: Literal["before", "after"] | None = None
    decimal_sep: str | None = None
    thousand_sep: str | None = None
    date_format: str | None = None
    glossary: list[dict] | None = None
    replacements: list[dict] | None = None
    required_phrases: list[str] | None = None
    banned_phrases: list[str] | None = None
    sample_cases: list[dict] | None = None
    understanding: dict | None = None
    output: dict | None = None
    speech: dict | None = None
    inference: dict | None = None
    training: dict | None = None
    notes: str | None = None
    enabled: bool | None = None


class ExampleIn(BaseModel):
    input: str = Field(min_length=1)
    corrected_output: str = Field(min_length=1)
    bad_output: str | None = None
    note: str = ""
    agent_id: str | None = None
    source: Literal["manual", "conversation", "feedback"] = "manual"
    feedback_id: str | None = None
    enabled: bool = True


class ExamplePatch(BaseModel):
    input: str | None = None
    corrected_output: str | None = None
    bad_output: str | None = None
    note: str | None = None
    enabled: bool | None = None


class AgentRef(BaseModel):
    agent_id: str


class PreviewIn(BaseModel):
    text: str | None = None
    language: str | None = None


async def _profile(db: AsyncSession, profile_id: str) -> LocaleProfile:
    row = await db.get(LocaleProfile, profile_id)
    if row is None:
        raise HTTPException(404, "Unknown locale profile")
    return row


async def _agent(db: AsyncSession, agent_id: str, tenant_id: str) -> AgentConfig:
    row = await db.get(AgentConfig, agent_id)
    if row is None or row.tenant_id != tenant_id:
        raise HTTPException(404, "Unknown agent")
    return row


async def _attached_agents(db: AsyncSession, profile: LocaleProfile) -> list[AgentConfig]:
    return list((await db.execute(
        select(AgentConfig).where(
            AgentConfig.tenant_id == profile.tenant_id,
            AgentConfig.locale_profile_id == profile.id,
        )
    )).scalars().all())


async def _recompile(db: AsyncSession, profile: LocaleProfile) -> int:
    """Refresh the generated specialist after a profile or example edit."""
    agents = await _attached_agents(db, profile)
    for agent in agents:
        await service.attach(db, profile, agent, actor="profile-edit")
    return len(agents)


def _view(profile: LocaleProfile, examples: list[LocaleExample],
          agents: list[AgentConfig]) -> dict:
    return {
        "profile": profile.model_dump(),
        "examples": [e.model_dump() for e in examples],
        "agents": [{"id": a.id, "name": a.name, "model": a.model} for a in agents],
    }


@router.get("/profiles")
async def list_profiles(tenant_id: str = "default", db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(LocaleProfile).where(LocaleProfile.tenant_id == tenant_id)
        .order_by(LocaleProfile.created_at.desc())
    )).scalars().all()
    out = []
    for p in rows:
        agents = await _attached_agents(db, p)
        out.append({**p.model_dump(), "attached_agents": len(agents),
                    "attached_to": [a.id for a in agents]})
    return out


@router.post("/profiles", status_code=201)
async def create_profile(body: ProfileIn, db: AsyncSession = Depends(get_db)):
    now = datetime.now(UTC)
    row = LocaleProfile(id=str(uuid.uuid4()), created_at=now, updated_at=now,
                        **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await audit.record(db, tenant_id=row.tenant_id, actor="admin-token", actor_type="api_key",
                       action="locale.profile_created", resource_type="locale_profile",
                       resource_id=row.id, details={"name": row.name, "code": row.locale_code})
    return row


@router.get("/profiles/{profile_id}")
async def get_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    examples = await service.load_examples(db, profile.id)
    return _view(profile, examples, await _attached_agents(db, profile))


@router.patch("/profiles/{profile_id}")
async def patch_profile(profile_id: str, body: ProfilePatch, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    changed = body.model_dump(exclude_unset=True)
    for field, value in changed.items():
        setattr(profile, field, value)
    profile.updated_at = datetime.now(UTC)
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    recompiled = await _recompile(db, profile) if changed else 0
    await audit.record(db, tenant_id=profile.tenant_id, actor="admin-token", actor_type="api_key",
                       action="locale.profile_updated", resource_type="locale_profile",
                       resource_id=profile.id, details={"fields": sorted(changed),
                                                        "agents_refreshed": recompiled})
    return {**profile.model_dump(), "agents_refreshed": recompiled}


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    detached = await service.detach_everywhere(db, profile)
    for row in (await db.execute(
            select(LocaleExample).where(LocaleExample.profile_id == profile.id))).scalars().all():
        await db.delete(row)
    await db.delete(profile)
    await db.commit()
    await audit.record(db, tenant_id=profile.tenant_id, actor="admin-token", actor_type="api_key",
                       action="locale.profile_deleted", resource_type="locale_profile",
                       resource_id=profile.id, details={"name": profile.name,
                                                        "agents_detached": detached})
    return {"deleted": profile.id, "agents_detached": detached}


# ── Reviewer corrections (few-shot) ──────────────────────────────────

@router.get("/profiles/{profile_id}/examples")
async def list_examples(profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    return [e.model_dump() for e in await service.load_examples(db, profile.id)]


@router.post("/profiles/{profile_id}/examples", status_code=201)
async def create_example(profile_id: str, body: ExampleIn, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    row = LocaleExample(id=str(uuid.uuid4()), profile_id=profile.id,
                        tenant_id=profile.tenant_id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    refreshed = await _recompile(db, profile)
    await audit.record(db, tenant_id=profile.tenant_id, actor="admin-token", actor_type="api_key",
                       action="locale.example_created", resource_type="locale_profile",
                       resource_id=profile.id, details={"example_id": row.id,
                                                        "agents_refreshed": refreshed})
    return {**row.model_dump(), "agents_refreshed": refreshed}


@router.patch("/examples/{example_id}")
async def patch_example(example_id: str, body: ExamplePatch, db: AsyncSession = Depends(get_db)):
    row = await db.get(LocaleExample, example_id)
    if row is None:
        raise HTTPException(404, "Unknown correction")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    profile = await _profile(db, row.profile_id)
    refreshed = await _recompile(db, profile)
    return {**row.model_dump(), "agents_refreshed": refreshed}


@router.delete("/examples/{example_id}")
async def delete_example(example_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(LocaleExample, example_id)
    if row is None:
        raise HTTPException(404, "Unknown correction")
    profile = await _profile(db, row.profile_id)
    await db.delete(row)
    await db.commit()
    refreshed = await _recompile(db, profile)
    return {"deleted": example_id, "agents_refreshed": refreshed}


# ── Agent lifecycle ──────────────────────────────────────────────────

@router.post("/profiles/{profile_id}/attach")
async def attach_profile(profile_id: str, body: AgentRef, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    agent = await _agent(db, body.agent_id, profile.tenant_id)
    try:
        return await service.attach(db, profile, agent)
    except ValueError as e:
        raise HTTPException(409, str(e))


@router.post("/profiles/{profile_id}/detach")
async def detach_profile(profile_id: str, body: AgentRef, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    agent = await _agent(db, body.agent_id, profile.tenant_id)
    return await service.detach(db, profile, agent)


@router.post("/profiles/{profile_id}/preview")
async def preview_profile(profile_id: str, body: PreviewIn, db: AsyncSession = Depends(get_db)):
    """Show exactly what the model is told and how a sample reply is rewritten."""
    profile = await _profile(db, profile_id)
    examples = await service.load_examples(db, profile.id)
    sample = body.text
    if not sample and profile.sample_cases:
        first = profile.sample_cases[0]
        if isinstance(first, dict):
            sample = first.get("expected_contains") or first.get("input")
    out = {
        "specialist": compile_specialist(profile, examples),
        "rules": compile_rules(profile, examples),
        "formatted": format_reply(sample, profile) if sample else None,
    }
    if body.language:
        out["rules"] += f"\n\nThis turn's user language: {body.language}"
    return out


# ── Training pack: corrections become a fine-tune dataset ────────────

def _pack_rows(profile: LocaleProfile, examples: list[LocaleExample]) -> list[dict]:
    """One row per reviewed pair, in the shape the chosen fine-tune format wants."""
    training = profile.training if isinstance(profile.training, dict) else {}
    fmt = training.get("format") if training.get("format") in {"chat", "plain", "preference"} else "chat"
    pairs: list[dict] = []
    for ex in examples:
        if ex.input and ex.corrected_output:
            pairs.append({"input": ex.input, "good": ex.corrected_output,
                          "bad": ex.bad_output or "", "source": ex.source})
    for case in getattr(profile, "sample_cases", None) or []:
        if not isinstance(case, dict) or not case.get("input"):
            continue
        good = case.get("output") or case.get("expected_contains") or ""
        if good:
            pairs.append({"input": str(case["input"]), "good": str(good),
                          "bad": "", "source": "sample"})
    rows: list[dict] = []
    for pair in pairs:
        if fmt == "preference":
            if not pair["bad"]:
                continue
            rows.append({"prompt": pair["input"], "chosen": pair["good"],
                         "rejected": pair["bad"]})
        elif fmt == "plain":
            rows.append({"prompt": pair["input"], "completion": pair["good"]})
        else:
            rows.append({"messages": [
                {"role": "user", "content": pair["input"]},
                {"role": "assistant", "content": pair["good"]},
            ]})
    return rows


@router.get("/profiles/{profile_id}/training-pack")
async def training_pack(profile_id: str, db: AsyncSession = Depends(get_db)):
    """The dataset the dashboard previews before sending it to Training."""
    profile = await _profile(db, profile_id)
    examples = await service.load_examples(db, profile.id)
    training = profile.training if isinstance(profile.training, dict) else {}
    rows = _pack_rows(profile, examples)
    minimum = training.get("min_pairs") if isinstance(training.get("min_pairs"), int) else 20
    return {
        "profile_id": profile.id,
        "name": profile.name,
        "locale_code": profile.locale_code,
        "language": profile.default_language or (profile.languages or [""])[0],
        "format": training.get("format", "chat"),
        "capture": bool(training.get("capture")),
        "target_job": training.get("target_job", ""),
        "count": len(rows),
        "min_pairs": minimum,
        "ready": len(rows) >= minimum,
        "rows": rows[:200],
    }


@router.get("/profiles/{profile_id}/training-pack.ndjson")
async def download_training_pack(profile_id: str, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    examples = await service.load_examples(db, profile.id)
    rows = _pack_rows(profile, examples)
    body = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    slug = re.sub(r"[^a-z0-9]+", "-", (profile.locale_code or profile.name).lower()).strip("-")
    return Response(content=body + ("\n" if body else ""), media_type="application/x-ndjson",
                    headers={"Content-Disposition":
                             f'attachment; filename="locale-{slug or "training"}.jsonl"'})


@router.post("/profiles/{profile_id}/seed-eval")
async def seed_eval(profile_id: str, body: AgentRef, db: AsyncSession = Depends(get_db)):
    profile = await _profile(db, profile_id)
    agent = await _agent(db, body.agent_id, profile.tenant_id)
    try:
        return await service.seed_eval(db, profile, agent)
    except ValueError as e:
        raise HTTPException(422, str(e))
