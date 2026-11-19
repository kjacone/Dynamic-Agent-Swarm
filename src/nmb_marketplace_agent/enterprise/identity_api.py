"""Identity: who the caller is."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from nmb_marketplace_agent.enterprise.licensing import (
    current_license,
)
from nmb_marketplace_agent.enterprise.rbac import Principal, current_principal

router = APIRouter()




# ── identity (drives role-aware dashboard) ───────────────────────────
@router.get("/me")
async def me(p: Principal = Depends(current_principal)):
    from nmb_marketplace_agent.enterprise.rbac import PERMISSIONS
    perms = sorted({x for r in p.roles for x in PERMISSIONS.get(r, set())})
    return {"sub": p.sub, "tenant_id": p.tenant_id, "roles": sorted(p.roles), "auth": p.auth, "permissions": perms,
            "license": {"edition": current_license().edition, "state": current_license().state,
                        "modules": sorted(current_license().modules)}}
