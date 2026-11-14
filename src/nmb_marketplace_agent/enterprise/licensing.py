"""Offline-verifiable commercial licensing.

A license is an Ed25519-signed JWT issued by the vendor (``scripts/issue_license.py``) and
verified with the public key baked into the build (``LICENSE_PUBLIC_KEY``). No phone-home:
this works in air-gapped bank and government networks. Claims drive the commercial model:
  customer, edition, modules[], solutions[], max_tenants, max_seats, deployment (saas|dedicated|
  on_prem|air_gapped), quotas{agent_runs, workflow_runs, tokens, documents}/month, exp, grace_days.
Design principle: an expired license never blocks access to the customer's own audit data.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import jwt
from fastapi import HTTPException

ALL_MODULES = ["core", "audit", "guardrails", "workflows", "approvals", "connectors",
               "solutions", "compliance", "sso"]
COMMUNITY = {"core", "audit", "guardrails"}
ALWAYS_ON = {"audit"}  # never lock customers out of evidence
EDITIONS = ["community", "professional", "enterprise", "sovereign"]

# What the console shows in the licence plan editor; ids match licence modules.
FEATURE_CATALOG = [
    {"id": "core", "label": "Agent platform", "description": "Agents, subagents, tools, knowledge, models and the training playground."},
    {"id": "audit", "label": "Audit trail", "description": "Hash-chained, verifiable audit trail. Always included."},
    {"id": "guardrails", "label": "Guardrails", "description": "PII screening, prompt-injection shield and tenant policy enforcement."},
    {"id": "workflows", "label": "Workflows", "description": "Deterministic multi-step workflows with shadow replay and rules."},
    {"id": "approvals", "label": "Approvals & notifications", "description": "Human approvals, escalation and notification routes."},
    {"id": "connectors", "label": "Connectors", "description": "Bank system connectors with egress policy and test calls."},
    {"id": "solutions", "label": "Solutions marketplace", "description": "Industry packs, install, upgrade and rollback."},
    {"id": "compliance", "label": "Compliance", "description": "ISO 27001 / SOC 2 / DPPA readiness and evidence export."},
    {"id": "sso", "label": "SSO & RBAC", "description": "OIDC single sign-on with role-based access control."},
]


@dataclass
class License:
    customer: str = "community"
    edition: str = "community"  # community | professional | enterprise | sovereign
    modules: set[str] = field(default_factory=lambda: set(COMMUNITY))
    solutions: set[str] = field(default_factory=set)
    max_tenants: int = 1
    max_seats: int = 5
    deployment: str = "dedicated"
    quotas: dict[str, float] = field(default_factory=dict)
    exp: int | None = None
    grace_days: int = 30
    state: str = "valid"  # valid | grace | expired | invalid | unenforced

    def has_module(self, m: str) -> bool:
        if m in ALWAYS_ON or self.state == "unenforced":
            return True
        return self.state in ("valid", "grace") and (m in self.modules or "*" in self.modules)

    def has_solution(self, s: str) -> bool:
        return self.state == "unenforced" or (self.has_module("solutions") and ("*" in self.solutions or s in self.solutions))

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["modules"], d["solutions"] = sorted(self.modules), sorted(self.solutions)
        return d


def issue_license(private_key_pem: bytes, *, customer: str, edition: str = "enterprise",
                  modules: list[str] | None = None, solutions: list[str] | None = None,
                  max_tenants: int = 1, max_seats: int = 100, deployment: str = "on_prem",
                  quotas: dict | None = None, days: int = 365, grace_days: int = 30) -> str:
    now = int(time.time())
    return jwt.encode({"iss": "agent-platform-vendor", "sub": customer, "iat": now, "exp": now + days * 86400,
                       "edition": edition, "modules": modules or ALL_MODULES, "solutions": solutions or ["*"],
                       "max_tenants": max_tenants, "max_seats": max_seats, "deployment": deployment,
                       "quotas": quotas or {}, "grace_days": grace_days},
                      private_key_pem, algorithm="EdDSA")


def load_license(token: str | None = None, public_key_pem: str | None = None) -> License:
    if os.environ.get("LICENSE_ENFORCE", "false").lower() not in ("1", "true", "yes"):
        return License("development", "development", set(ALL_MODULES), {"*"}, 999, 999, "dedicated", {}, None, 0, "unenforced")
    token = token or os.environ.get("LICENSE_KEY") or (
        Path(p).read_text().strip() if (p := os.environ.get("LICENSE_FILE", "")) and Path(p).exists() else "")
    pub = public_key_pem or os.environ.get("LICENSE_PUBLIC_KEY", "")
    if not token or not pub:
        return License()  # community
    try:
        c = jwt.decode(token, pub, algorithms=["EdDSA"], options={"verify_exp": False})
    except jwt.PyJWTError:
        return License(state="invalid")
    lic = License(c.get("sub", ""), c.get("edition", "enterprise"), set(c.get("modules", [])), set(c.get("solutions", [])),
                  int(c.get("max_tenants", 1)), int(c.get("max_seats", 5)), c.get("deployment", "on_prem"),
                  c.get("quotas", {}), c.get("exp"), int(c.get("grace_days", 30)))
    now = time.time()
    if lic.exp and now > lic.exp:
        lic.state = "grace" if now <= lic.exp + lic.grace_days * 86400 else "expired"
    return lic


_cached: License | None = None


def current_license(refresh: bool = False) -> License:
    global _cached
    if _cached is None or refresh:
        _cached = load_license()
    return _cached


def require_module(module: str):
    """FastAPI dependency enforcing a license entitlement (HTTP 402 when absent)."""
    async def dep():
        lic = current_license()
        if not lic.has_module(module):
            raise HTTPException(402, f"Module '{module}' is not included in your license ({lic.edition}, {lic.state}).")
    return dep
