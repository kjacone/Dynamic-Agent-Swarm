"""Role-based access control with enterprise SSO (OIDC) support.

Principals come from (1) the legacy ADMIN_TOKEN (treated as platform_admin, so existing
deployments keep working), (2) HS256 tenant JWTs signed with NMB_JWT_SECRET, or
(3) OIDC access tokens verified against the IdP's JWKS (Entra ID, Okta, Keycloak, ...):
  OIDC_JWKS_URL, OIDC_ISSUER, OIDC_AUDIENCE, OIDC_TENANT_CLAIM (tenant_id), OIDC_ROLES_CLAIM (roles)
Roles are mapped from IdP groups, so customers manage access in their own directory.
"""
from __future__ import annotations

import hmac
import os
from dataclasses import dataclass, field

import jwt
from fastapi import Header, HTTPException

PERMISSIONS: dict[str, set[str]] = {
    "platform_admin": {"*"},
    "tenant_admin": {"agents:*", "workflows:*", "approvals:*", "solutions:*", "connectors:*", "policies:*",
                     "handoffs:*", "privacy:*", "audit:read", "usage:read", "compliance:read", "license:read"},
    "agent_builder": {"agents:*", "solutions:read", "policies:read", "connectors:read"},
    "workflow_designer": {"workflows:*", "solutions:read", "connectors:read", "policies:read"},
    "operator": {"workflows:run", "workflows:read", "approvals:read", "agents:read",
                 "handoffs:read", "handoffs:write"},
    "approver": {"approvals:read", "approvals:decide", "workflows:read"},
    "auditor": {"audit:read", "audit:export", "compliance:read", "usage:read", "workflows:read",
                "approvals:read", "policies:read", "license:read", "handoffs:read", "privacy:read"},
    "compliance_officer": {"approvals:read", "approvals:decide", "workflows:read", "audit:read",
                           "compliance:read", "privacy:*", "handoffs:read"},
    "data_protection_officer": {"privacy:*", "audit:read", "compliance:read", "handoffs:read"},
    "viewer": {"workflows:read", "agents:read", "solutions:read"},
}


# Industry approver roles carry approver permissions; the *workflow* decides who may decide what.
for _r in ["compliance_officer", "credit_officer", "underwriter", "claims_adjuster", "case_worker",
           "procurement_officer", "clinician_reviewer", "registrar", "team_lead", "finance_controller",
           *[x for x in os.environ.get("EXTRA_APPROVER_ROLES", "").split(",") if x]]:
    PERMISSIONS.setdefault(_r, set(PERMISSIONS["approver"]))


def _match(granted: set[str], need: str) -> bool:
    res = need.split(":")[0]
    return "*" in granted or need in granted or f"{res}:*" in granted


@dataclass
class Principal:
    sub: str
    tenant_id: str = "default"
    roles: set[str] = field(default_factory=set)
    auth: str = "jwt"  # admin_token | jwt | oidc

    def can(self, perm: str) -> bool:
        return any(_match(PERMISSIONS.get(r, set()), perm) for r in self.roles)

    def has_role(self, role: str) -> bool:
        return role in self.roles or "platform_admin" in self.roles


def _roles(claim) -> set[str]:
    if isinstance(claim, str):
        claim = [c.strip() for c in claim.replace(";", ",").split(",")]
    mapping = {}  # optional IdP group -> platform role: OIDC_ROLE_MAP="Bank-Approvers=approver,..."
    for pair in filter(None, os.environ.get("OIDC_ROLE_MAP", "").split(",")):
        k, _, v = pair.partition("=")
        mapping[k.strip()] = v.strip()
    return {mapping.get(c, c) for c in (claim or []) if c} & set(PERMISSIONS)


def _real_url(v: str) -> bool:
    return v.startswith("http") and not any(x in v for x in ("<", "example", "CHANGEME", "your-"))


def principal_from_token(authorization: str, x_tenant_id: str = "") -> Principal:
    raw = authorization.removeprefix("Bearer ").strip().strip('"').strip("'")
    if not raw:
        raise HTTPException(401, "Missing credentials")

    admin = os.environ.get("ADMIN_TOKEN", "").strip().strip('"').strip("'")
    if admin and hmac.compare_digest(raw, admin):
        return Principal("admin-token", x_tenant_id or "default", {"platform_admin"}, "admin_token")

    if raw.count(".") != 2:  # not a JWT, so it can only have been a wrong admin token
        raise HTTPException(401, "Invalid admin token")

    tcl, rcl = os.environ.get("OIDC_TENANT_CLAIM", "tenant_id"), os.environ.get("OIDC_ROLES_CLAIM", "roles")
    jwks = os.environ.get("OIDC_JWKS_URL", "")
    secret = os.environ.get("NMB_JWT_SECRET", "")
    try:
        if _real_url(jwks):
            key = jwt.PyJWKClient(jwks).get_signing_key_from_jwt(raw).key
            claims = jwt.decode(raw, key, algorithms=["RS256", "ES256"],
                                audience=os.environ.get("OIDC_AUDIENCE") or None,
                                issuer=os.environ.get("OIDC_ISSUER") or None)
            auth = "oidc"
        elif secret:
            claims = jwt.decode(raw, secret, algorithms=["HS256"], options={"verify_aud": False})
            auth = "jwt"
        else:
            raise HTTPException(503, "No token verification configured (set NMB_JWT_SECRET or OIDC_JWKS_URL)")
    except jwt.PyJWKClientError as e:
        raise HTTPException(503, f"SSO key endpoint unreachable: {e}") from e
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"Invalid token: {e}") from e

    if claims.get("aud") == "nmb-session":
        raise HTTPException(401, "Chat session tokens cannot be used for admin access")

    roles = _roles(claims.get(rcl) or claims.get("role"))
    tenant = claims.get(tcl) or claims.get("tenant")
    if not tenant:
        raise HTTPException(403, "Token has no tenant claim")
    return Principal(str(claims.get("sub", "unknown")), str(tenant), roles, auth)

async def current_principal(authorization: str = Header(default=""),
                            x_tenant_id: str = Header(default="")) -> Principal:
    return principal_from_token(authorization, x_tenant_id)


def requires(perm: str):
    """FastAPI dependency: ``principal: Principal = Depends(requires("audit:read"))``."""
    async def dep(authorization: str = Header(default=""), x_tenant_id: str = Header(default="")) -> Principal:
        p = principal_from_token(authorization, x_tenant_id)
        if not p.can(perm):
            raise HTTPException(403, f"Missing permission: {perm}")
        return p
    return dep
