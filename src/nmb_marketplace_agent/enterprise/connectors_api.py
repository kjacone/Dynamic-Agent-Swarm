"""Connector registry, egress policy and test calls."""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.connectors import (
    ConnectorError,
    EgressPolicy,
    build_connector,
)
from nmb_marketplace_agent.enterprise.licensing import (
    require_module,
)
from nmb_marketplace_agent.enterprise.models import (
    ConnectorConfig,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, requires

router = APIRouter()


# ── connectors ────────────────────────────────────────────────────────


def _needs_setup(cfg: dict) -> bool:
    # pack templates ship with placeholder hosts; flag them so the UI can say "finish setup"
    return ".example." in json.dumps(cfg)


@router.get("/connectors", dependencies=[Depends(require_module("connectors"))])
async def connectors(p: Principal = Depends(requires("connectors:read")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ConnectorConfig).where(ConnectorConfig.tenant_id == p.tenant_id))).scalars().all()
    return [{"name": c.name, "type": c.type, "enabled": c.enabled, "needs_setup": _needs_setup(c.config),
             "operations": list((c.config.get("operations") or {}).keys()) or c.config.get("scripts", [])} for c in rows]


async def _get_cfg(db: AsyncSession, tenant: str, name: str) -> ConnectorConfig:
    row = (await db.execute(select(ConnectorConfig).where(
        ConnectorConfig.tenant_id == tenant, ConnectorConfig.name == name))).scalars().first()
    if not row:
        raise HTTPException(404, f"Connector '{name}' not found")
    return row


@router.get("/connectors/egress", dependencies=[Depends(require_module("connectors"))])
async def connector_egress(p: Principal = Depends(requires("connectors:read"))):
    return {"egress_allowed_hosts": EgressPolicy().allowed}


@router.get("/connectors/{name}", dependencies=[Depends(require_module("connectors"))])
async def connector_get(name: str, p: Principal = Depends(requires("connectors:read")), db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)
    # config only ever holds secret *references* (env:/file:), so it is safe to return
    return {"name": c.name, "type": c.type, "enabled": c.enabled, "config": c.config, "needs_setup": _needs_setup(c.config),
            "egress_allowed_hosts": EgressPolicy().allowed}


@router.post("/connectors/{name}/enabled", dependencies=[Depends(require_module("connectors"))])
async def connector_enable(name: str, body: dict, p: Principal = Depends(requires("connectors:write")),
                           db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)
    want = bool(body.get("enabled"))
    if want and _needs_setup(c.config):
        raise HTTPException(422, "Replace the placeholder endpoint before enabling this connector")
    c.enabled = want
    db.add(c)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="connector.enabled" if want else "connector.disabled",
                       resource_type="connector", resource_id=name)
    return {"name": name, "enabled": c.enabled}


@router.delete("/connectors/{name}", dependencies=[Depends(require_module("connectors"))])
async def connector_delete(name: str, p: Principal = Depends(requires("connectors:write")), db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)
    await db.delete(c)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="connector.deleted", resource_type="connector", resource_id=name)
    return {"deleted": name}


@router.post("/connectors/{name}/test/{operation}", dependencies=[Depends(require_module("connectors"))])
async def connector_test(name: str, operation: str, params: dict | None = None,
                         p: Principal = Depends(requires("connectors:write")), db: AsyncSession = Depends(get_db)):
    c = await _get_cfg(db, p.tenant_id, name)  # works while disabled: test first, then enable
    try:
        res = await build_connector(name, c.type, c.config, EgressPolicy()).call(operation, params or {})
        ok, err = True, None
    except ConnectorError as e:
        res, ok, err = None, False, str(e)
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub, action="connector.tested", resource_type="connector",
                       resource_id=name, outcome="success" if ok else "error", details={"operation": operation, "error": err})
    return {"ok": ok, "result": res, "error": err}  # 200 either way so the UI can show the reason inline

# ── PUT /connectors/{name} ────────────────────────────────────────
# Upsert a connector definition. Inline secrets are rejected with 422; only
# env:NAME / file:/path references are accepted (see connectors.base.resolve_secret).

_SECRET_KEYS = frozenset({"secret", "password", "password_ref", "api_key", "token"})



def _reject_inline_secrets(cfg, path: str = "") -> None:
    from nmb_marketplace_agent.enterprise.connectors.base import (
        ConnectorError,
        resolve_secret,
    )

    if isinstance(cfg, dict):
        for k, v in cfg.items():
            sub = f"{path}.{k}" if path else k
            if isinstance(v, str) and k.lower() in _SECRET_KEYS:
                try:
                    resolve_secret(v)
                except ConnectorError as e:
                    raise ConnectorError(f"{sub}: {e}") from e
            elif isinstance(v, (dict, list)):
                _reject_inline_secrets(v, sub)
    elif isinstance(cfg, list):
        for i, v in enumerate(cfg):
            _reject_inline_secrets(v, f"{path}[{i}]")


def _validate_secret_refs(cfg, path: str = "") -> None:
    if isinstance(cfg, dict):
        for k, v in cfg.items():
            sub = f"{path}.{k}" if path else k
            if isinstance(v, str) and k.lower() in _SECRET_KEYS:
                if not (v.startswith("env:") or v.startswith("file:")):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"{sub}: secrets must be 'env:NAME' or 'file:/path' "
                            "references, never inline values"
                        ),
                    )
            elif isinstance(v, (dict, list)):
                _validate_secret_refs(v, sub)
    elif isinstance(cfg, list):
        for i, v in enumerate(cfg):
            _validate_secret_refs(v, f"{path}[{i}]")


class _ConnectorIn(BaseModel):
    type: str = "rest"
    config: dict = Field(default_factory=dict)
    enabled: bool | None = None


_CONNECTOR_TYPES = {"rest", "file_drop", "flat_file", "email", "rpa_bridge"}


@router.put(
    "/connectors/{name}",
    dependencies=[Depends(require_module("connectors"))],
)
async def upsert_connector(name: str, body: _ConnectorIn,
                           p: Principal = Depends(requires("connectors:write")),
                           db: AsyncSession = Depends(get_db)):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,119}", name):
        raise HTTPException(422, "Connector name must be lowercase letters, digits, '_' or '-'")
    if body.type not in _CONNECTOR_TYPES:
        raise HTTPException(422, f"Connector type must be one of: {', '.join(sorted(_CONNECTOR_TYPES))}")
    _validate_secret_refs(body.config)
    needs_setup = _needs_setup(body.config)
    row = (await db.execute(select(ConnectorConfig).where(
        ConnectorConfig.tenant_id == p.tenant_id, ConnectorConfig.name == name))).scalars().first()
    created = row is None
    if row is None:
        row = ConnectorConfig(id=f"{p.tenant_id}:{name}", tenant_id=p.tenant_id, name=name)
    want_enabled = body.enabled if body.enabled is not None else (row.enabled if not created else False)
    if want_enabled and needs_setup:
        raise HTTPException(422, "Replace the placeholder endpoint before enabling this connector")
    row.type, row.config = body.type, body.config
    row.enabled = bool(want_enabled) and not needs_setup
    db.add(row)
    await db.commit()
    await audit.record(db, tenant_id=p.tenant_id, actor=p.sub,
                       action="connector.created" if created else "connector.updated",
                       resource_type="connector", resource_id=name,
                       details={"type": row.type, "enabled": row.enabled,
                                "operations": list((body.config.get("operations") or {}).keys())})
    return {"name": row.name, "type": row.type, "enabled": row.enabled, "needs_setup": needs_setup,
            "created": created}
