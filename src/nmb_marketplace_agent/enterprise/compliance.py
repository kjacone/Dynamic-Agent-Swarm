"""Compliance readiness: map platform capabilities to framework controls, run live posture checks,
and export an evidence bundle for auditors.

This reports what the *platform* supports and how this *deployment* is configured. It does not
certify anything: certification (SOC 2 report, ISO 27001, PCI DSS AoC...) belongs to the vendor
organisation and the customer's own environment.
"""
from __future__ import annotations

import os
from typing import Any

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.enterprise import audit
from nmb_marketplace_agent.enterprise.licensing import current_license
from nmb_marketplace_agent.enterprise.metering import quota_status, summarize
from nmb_marketplace_agent.enterprise.models import (
    Approval,
    InstalledSolution,
    PolicySet,
    WorkflowRun,
)

# capability id -> (description, status). "roadmap" = not built yet; reported honestly.
CAPABILITIES: dict[str, tuple[str, str]] = {
    "audit_trail": ("Hash-chained, tamper-evident audit log with signed checkpoints and export", "available"),
    "access_control": ("Role-based access control, least privilege, per-tenant scoping", "available"),
    "sso": ("OIDC single sign-on with IdP group -> role mapping", "available"),
    "data_minimisation": ("PII/secret detection and redaction before models, logs and outputs", "available"),
    "segregation_of_duties": ("Maker-checker approvals, N-of-M, SLA escalation", "available"),
    "secrets_by_reference": ("Connector secrets as env/file references; no inline credentials", "available"),
    "egress_control": ("Outbound allow-list; cloud metadata endpoints blocked", "available"),
    "tenant_isolation": ("Tenant-scoped data, keys and threads", "available"),
    "ai_oversight": ("Human-in-the-loop for high-risk tool calls and decisions; eval datasets", "available"),
    "offline_licensing": ("Air-gap-capable signed licensing", "available"),
    "data_retention": ("Per-tenant retention windows with legal hold across threads, traces and derived data", "available"),
    "subject_rights": ("Data-subject access export and erasure across LangGraph, registry, vector stores and Langfuse", "available"),
    "encryption_at_rest_kms": ("Envelope encryption with customer-managed keys (BYOK)", "roadmap"),
}

FRAMEWORKS: dict[str, dict[str, Any]] = {
    "SOC2": {"name": "SOC 2 (Trust Services Criteria)", "controls": [
        {"id": "CC6.1", "title": "Logical access controls", "caps": ["access_control", "sso", "tenant_isolation"]},
        {"id": "CC6.6", "title": "Boundary protection / egress", "caps": ["egress_control"]},
        {"id": "CC7.2", "title": "Monitoring and anomaly detection", "caps": ["audit_trail", "data_minimisation"]},
        {"id": "CC8.1", "title": "Change management and approvals", "caps": ["segregation_of_duties", "audit_trail"]},
        {"id": "C1.1", "title": "Confidential information protection", "caps": ["data_minimisation", "secrets_by_reference"]}]},
    "ISO27001": {"name": "ISO/IEC 27001:2022 Annex A", "controls": [
        {"id": "A.5.15", "title": "Access control", "caps": ["access_control", "sso"]},
        {"id": "A.5.3", "title": "Segregation of duties", "caps": ["segregation_of_duties"]},
        {"id": "A.8.15", "title": "Logging", "caps": ["audit_trail"]},
        {"id": "A.8.12", "title": "Data leakage prevention", "caps": ["data_minimisation", "egress_control"]},
        {"id": "A.8.24", "title": "Use of cryptography", "caps": ["encryption_at_rest_kms"]}]},
    "GDPR": {"name": "GDPR / Kenya Data Protection Act", "controls": [
        {"id": "Art.5(1)(c)", "title": "Data minimisation", "caps": ["data_minimisation"]},
        {"id": "Art.22", "title": "Human oversight of automated decisions", "caps": ["ai_oversight", "segregation_of_duties"]},
        {"id": "Art.30", "title": "Records of processing", "caps": ["audit_trail"]},
        {"id": "Art.15/17", "title": "Access and erasure rights", "caps": ["subject_rights"]},
        {"id": "Art.5(1)(e)", "title": "Storage limitation", "caps": ["data_retention"]}]},
    "PCI-DSS": {"name": "PCI DSS v4.0 (scope reduction)", "controls": [
        {"id": "3.4", "title": "Mask/withhold PAN", "caps": ["data_minimisation"]},
        {"id": "7.2", "title": "Least-privilege access", "caps": ["access_control"]},
        {"id": "10.2", "title": "Audit logs", "caps": ["audit_trail"]}]},
    "HIPAA": {"name": "HIPAA Security Rule", "controls": [
        {"id": "164.312(b)", "title": "Audit controls", "caps": ["audit_trail"]},
        {"id": "164.312(a)", "title": "Access control", "caps": ["access_control", "sso"]},
        {"id": "164.312(e)", "title": "Transmission security / egress", "caps": ["egress_control"]}]},
    "NIST-800-53": {"name": "NIST SP 800-53 (selected)", "controls": [
        {"id": "AC-5", "title": "Separation of duties", "caps": ["segregation_of_duties"]},
        {"id": "AU-10", "title": "Non-repudiation", "caps": ["audit_trail"]},
        {"id": "SC-7", "title": "Boundary protection", "caps": ["egress_control"]}]},
}


def _chk(id_, title, ok: bool | None, detail="", fix="") -> dict:
    return {"id": id_, "title": title, "status": "warn" if ok is None else ("pass" if ok else "fail"),
            "detail": detail, "remediation": fix if not ok else ""}


async def posture_checks(db: AsyncSession | None, tenant_id: str) -> list[dict]:
    env = os.environ.get
    dsn = f"{env('DATABASE_URL', '')} {env('REGISTRY_DATABASE_URL', '')}"
    out = [
        _chk("admin-token-strength", "Admin token is strong", len(env("ADMIN_TOKEN", "")) >= 32,
             "ADMIN_TOKEN length", "Use >= 32 random characters; prefer SSO and named accounts."),
        _chk("jwt-secret", "JWT secret configured", len(env("NMB_JWT_SECRET", "")) >= 32, fix="Set NMB_JWT_SECRET (>=32 chars)."),
        _chk("runtime-auth", "Agent runtime authentication enabled", env("AUTH_TYPE", "noop") != "noop",
             f"AUTH_TYPE={env('AUTH_TYPE', 'noop')}", "Set AUTH_TYPE to a real mode; 'noop' is local-only."),
        _chk("cors", "CORS restricted", env("CORS_ORIGINS", "*") != "*", fix="Set CORS_ORIGINS to your front-end origins."),
        _chk("default-db-creds", "No default database credentials", not any(x in dsn for x in ("postgres:postgres@", "aegra:aegra@")),
             fix="Replace default Postgres credentials."),
        _chk("audit-hmac", "Audit chain is keyed (HMAC)", bool(env("AUDIT_HMAC_KEY")),
             fix="Set AUDIT_HMAC_KEY so database admins cannot forge a valid chain."),
        _chk("redaction-key", "Redaction key is not the dev default", bool(env("REDACTION_KEY")), fix="Set REDACTION_KEY."),
        _chk("egress-allowlist", "Egress allow-list configured", bool(env("EGRESS_ALLOWED_HOSTS")),
             fix="Set EGRESS_ALLOWED_HOSTS to approved API hosts."),
        _chk("sso", "Enterprise SSO configured", bool(env("OIDC_JWKS_URL")), fix="Configure OIDC_* to use the customer IdP."),
        _chk("admin-token-approvals", "Shared admin token cannot approve", env("ALLOW_ADMIN_TOKEN_APPROVALS", "false") != "true"),
    ]
    lic = current_license()
    out.append(_chk("license", "License valid", lic.state in ("valid", "unenforced"), f"state={lic.state}, edition={lic.edition}",
                    "Renew or install a license."))
    if db is not None:
        v = await audit.verify_chain(db, tenant_id)
        out.append(_chk("audit-chain", "Audit chain verifies", v.ok, f"{v.checked} events checked" + ("" if v.ok else f"; {v.reason} at seq {v.first_bad_seq}"),
                        "Investigate immediately: possible tampering."))
        n = (await db.execute(select(func.count()).select_from(PolicySet).where(PolicySet.tenant_id == tenant_id, PolicySet.active == True))).scalar() or 0  # noqa: E712
        out.append(_chk("policy-installed", "Guardrail policy installed for tenant", n > 0,
                        f"{n} active policy set(s)", "Install a solution pack or PUT /enterprise/policies/{name}."))
    return out


def _cap_available(cap: str, checks: dict[str, dict], lic) -> bool:
    if CAPABILITIES[cap][1] != "available":
        return False
    mod = {"audit_trail": "audit", "data_minimisation": "guardrails", "segregation_of_duties": "approvals",
           "egress_control": "connectors", "sso": "sso"}.get(cap)
    return lic.has_module(mod) if mod else True


async def readiness(db: AsyncSession | None, tenant_id: str, frameworks: list[str] | None = None) -> dict:
    lic, checks = current_license(), await posture_checks(db, tenant_id)
    by_id = {c["id"]: c for c in checks}
    fw_out = {}
    for fid, fw in FRAMEWORKS.items():
        if frameworks and fid not in frameworks:
            continue
        rows, supported = [], 0
        for c in fw["controls"]:
            caps = {k: _cap_available(k, by_id, lic) for k in c["caps"]}
            ok = all(caps.values())
            supported += ok
            rows.append({**c, "supported": ok, "gaps": [k for k, v in caps.items() if not v],
                         "roadmap": [k for k in c["caps"] if CAPABILITIES[k][1] == "roadmap"]})
        fw_out[fid] = {"name": fw["name"], "controls": rows,
                       "coverage_pct": round(100 * supported / len(fw["controls"]), 1)}
    passed = sum(c["status"] == "pass" for c in checks)
    return {"tenant_id": tenant_id, "posture": {"checks": checks, "score_pct": round(100 * passed / len(checks), 1)},
            "frameworks": fw_out,
            "disclaimer": "Indicates platform capability mapping and deployment configuration only; it is not a certification."}


async def evidence_bundle(db: AsyncSession, tenant_id: str) -> dict:
    ready = await readiness(db, tenant_id)
    appr = (await db.execute(select(Approval.status, func.count()).where(Approval.tenant_id == tenant_id)
                             .group_by(Approval.status))).all()
    runs = (await db.execute(select(WorkflowRun.status, func.count()).where(WorkflowRun.tenant_id == tenant_id)
                             .group_by(WorkflowRun.status))).all()
    pol = (await db.execute(select(PolicySet).where(PolicySet.tenant_id == tenant_id))).scalars().all()
    sol = (await db.execute(select(InstalledSolution).where(InstalledSolution.tenant_id == tenant_id))).scalars().all()
    return {
        "tenant_id": tenant_id, "license": current_license().as_dict(),
        "readiness": ready, "audit_checkpoint": await audit.checkpoint(db, tenant_id),
        "audit_verification": (await audit.verify_chain(db, tenant_id)).as_dict(),
        "approvals_by_status": dict(appr), "workflow_runs_by_status": dict(runs),
        "policies": [{"name": p.name, "version": p.version, "rules": len(p.spec.get("rules", [])),
                      "tool_rules": len(p.spec.get("tool_rules", [])), "updated_at": p.updated_at} for p in pol],
        "solutions": [{"id": s.solution_id, "version": s.version, "installed_at": s.installed_at} for s in sol],
        "usage": await summarize(db, tenant_id), "quotas": await quota_status(db, tenant_id),
    }
