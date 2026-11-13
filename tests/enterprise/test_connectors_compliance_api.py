import jwt
import pytest
from httpx import ASGITransport, AsyncClient

from nmb_marketplace_agent.enterprise import compliance
from nmb_marketplace_agent.enterprise.connectors import (
    ConnectorError,
    EgressPolicy,
    build_connector,
)
from nmb_marketplace_agent.enterprise.connectors.base import resolve_secret


# ── connectors ───────────────────────────────────────────────────────
def test_egress_allowlist_default_deny_and_metadata_block():
    e = EgressPolicy([])
    with pytest.raises(ConnectorError):
        e.check("https://api.bank.co/x")
    ok = EgressPolicy(["*.bank.co", "169.254.169.254"])
    ok.check("https://api.bank.co/x")
    with pytest.raises(ConnectorError, match="metadata"):
        ok.check("http://169.254.169.254/latest/meta-data")
    with pytest.raises(ConnectorError):
        ok.check("https://evil.com")


def test_secrets_must_be_references(monkeypatch):
    monkeypatch.setenv("TOK", "abc")
    assert resolve_secret("env:TOK") == "abc"
    with pytest.raises(ConnectorError):
        resolve_secret("plaintext-secret")


async def test_flat_file_fixed_width_to_json():
    c = build_connector("core", "flat_file", {"layout": {"kind": "fixed", "fields": [
        {"name": "acct", "start": 0, "end": 8}, {"name": "balance", "start": 8, "end": 17, "type": "decimal", "scale": 2}]}})
    r = await c.call("parse", {"text": "00012345000125050\n00099999000000100\n"})
    assert r["count"] == 2 and r["records"][0] == {"acct": "00012345", "balance": 1250.5}


async def test_file_drop_and_path_traversal(tmp_path):
    inbox = tmp_path / "in"
    inbox.mkdir()
    (inbox / "a.txt").write_text("hello")
    (tmp_path / "secret.txt").write_text("nope")
    c = build_connector("drop", "file_drop", {"inbox": str(inbox), "archive": str(tmp_path / "done")})
    assert (await c.call("list", {}))["files"] == ["a.txt"]
    assert (await c.call("read", {"file": "a.txt"}))["text"] == "hello"
    with pytest.raises(ConnectorError):
        await c.call("read", {"file": "../secret.txt"})
    await c.call("archive", {"file": "a.txt"})
    assert (await c.call("list", {}))["files"] == []


async def test_rest_connector_enforces_egress_and_ops():
    c = build_connector("x", "rest", {"base_url": "https://api.bank.co", "operations": {"get": {"method": "GET", "path": "/a"}}},
                        EgressPolicy([]))
    with pytest.raises(ConnectorError, match="allow-list"):
        await c.call("get", {})
    with pytest.raises(ConnectorError, match="not defined"):
        await c.call("nope", {})


async def test_rpa_bridge_only_runs_allowlisted_scripts():
    c = build_connector("rpa", "rpa_bridge", {"base_url": "https://rpa.local", "scripts": ["lookup_account"]}, EgressPolicy(["rpa.local"]))
    with pytest.raises(ConnectorError, match="allow-listed"):
        await c.call("delete_everything", {})


# ── compliance ───────────────────────────────────────────────────────
async def test_readiness_is_honest_about_gaps(db, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "short")
    r = await compliance.readiness(db, "t")
    checks = {c["id"]: c for c in r["posture"]["checks"]}
    assert checks["admin-token-strength"]["status"] == "fail" and checks["admin-token-strength"]["remediation"]
    assert checks["audit-chain"]["status"] == "pass"
    gdpr = {c["id"]: c for c in r["frameworks"]["GDPR"]["controls"]}
    assert gdpr["Art.15/17"]["supported"] is True and gdpr["Art.15/17"]["roadmap"] == []
    assert gdpr["Art.5(1)(e)"]["supported"] is True
    assert gdpr["Art.5(1)(c)"]["supported"] is True
    iso = {c["id"]: c for c in r["frameworks"]["ISO27001"]["controls"]}
    assert iso["A.8.24"]["supported"] is False and iso["A.8.24"]["roadmap"] == ["encryption_at_rest_kms"]
    assert "not a certification" in r["disclaimer"]


# ── API (RBAC + license gating + audit) ──────────────────────────────
@pytest.fixture
async def client(db, monkeypatch, tmp_path):
    from fastapi import FastAPI

    from nmb_marketplace_agent.api.deps import get_db
    from nmb_marketplace_agent.enterprise import api as eapi
    from nmb_marketplace_agent.enterprise.solutions import loader
    from nmb_marketplace_agent.enterprise.workflows import Runtime

    monkeypatch.setenv("NMB_JWT_SECRET", "s" * 32)
    # Pack installs in these API tests must not call an embedding or model provider.
    monkeypatch.setattr(loader, "build_index", lambda *a, **k: 1)
    monkeypatch.setattr(loader, "DOCS_ROOT", tmp_path / "docs")

    async def _no_conformance(*_a, **_k):
        return []

    monkeypatch.setattr(loader.conformance, "run_conformance", _no_conformance)
    app = FastAPI()
    app.include_router(eapi.router, prefix="/enterprise")
    app.dependency_overrides[get_db] = lambda: db

    async def fake_runtime(_db, tenant):
        async def agent(aid, prompt, ctx):
            return '{"complete": true, "missing": [], "summary": "ok"}'
        async def nosleep(_):
            return None
        return Runtime(agent_runner=agent, sleep=nosleep)
    monkeypatch.setattr(eapi, "build_runtime", fake_runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


def tok(sub, *roles, tenant="gov"):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub, "tenant_id": tenant, "roles": list(roles)}, "s" * 32, algorithm="HS256")}


ADMIN = {"Authorization": "Bearer test-admin-token", "X-Tenant-Id": "gov"}


async def test_api_end_to_end_permit_flow(client):
    assert (await client.get("/enterprise/solutions", headers=tok("a", "tenant_admin"))).status_code == 200
    r = await client.post("/enterprise/solutions/gov-document-workflows/install", json={"parameters": {"review_sla_hours": 24}},
                          headers=tok("admin1", "tenant_admin"))
    assert r.status_code == 200, r.text
    run = (await client.post("/enterprise/workflows/permit_application/runs", headers=tok("clerk", "operator"),
                             json={"inputs": {"application_text": "form", "service": "Trade licence"}})).json()
    assert run["status"] == "waiting_approval"

    pend = (await client.get("/enterprise/approvals", headers=tok("cw", "case_worker"))).json()
    assert len(pend) == 1
    aid = pend[0]["id"]
    # viewers / wrong roles cannot decide; admin token is refused (shared credential)
    assert (await client.post(f"/enterprise/approvals/{aid}/decide", json={"decision": "approve"}, headers=tok("v", "viewer"))).status_code == 403
    assert (await client.post(f"/enterprise/approvals/{aid}/decide", json={"decision": "approve"}, headers=ADMIN)).status_code == 403
    ok = await client.post(f"/enterprise/approvals/{aid}/decide", json={"decision": "approve", "comment": "ok"}, headers=tok("officer", "case_worker"))
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    final = (await client.get(f"/enterprise/runs/{run['id']}", headers=tok("a", "viewer"))).json()
    assert final["status"] == "completed" and final["outcome"] == "granted"

    # auditor sees the whole story and the chain verifies; operators cannot read audit
    assert (await client.get("/enterprise/audit/verify", headers=tok("aud", "auditor"))).json()["ok"] is True
    actions = {e["action"] for e in (await client.get("/enterprise/audit?limit=500", headers=tok("aud", "auditor"))).json()}
    assert {"solution.installed", "workflow.run.started", "approval.requested", "approval.approve", "workflow.run.completed"} <= actions
    assert (await client.get("/enterprise/audit", headers=tok("clerk", "operator"))).status_code == 403
    exp = await client.get("/enterprise/audit/export", headers=tok("aud", "auditor"))
    assert exp.status_code == 200 and exp.text.count("\n") >= 5

    # tenant isolation: another tenant sees nothing
    other = await client.get("/enterprise/runs", headers=tok("x", "tenant_admin", tenant="other"))
    assert other.json() == []
    usage = (await client.get("/enterprise/usage", headers=tok("aud", "auditor"))).json()["usage"]
    assert usage["workflow_runs"] == 1 and usage["approvals"] == 1


async def test_sample_case_run_endpoint(client):
    await client.post("/enterprise/solutions/gov-document-workflows/install", json={},
                      headers=tok("a", "tenant_admin"))
    r = await client.post("/enterprise/solutions/gov-document-workflows/samples/complete-permit/run",
                          headers=tok("clerk", "operator"))
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["workflow"] == "permit_application"
    assert run["expect"] == "waiting_approval"
    missing = await client.post("/enterprise/solutions/gov-document-workflows/samples/nope/run",
                                headers=tok("clerk", "operator"))
    assert missing.status_code == 404


async def test_embed_snippet_for_widget_solution(client):
    r = await client.post("/enterprise/solutions/telco-service-ops/install", json={},
                          headers=tok("a", "tenant_admin"))
    assert r.status_code == 200, r.text
    embed = await client.get("/enterprise/solutions/telco-service-ops/embed",
                             headers=tok("a", "tenant_admin"))
    assert embed.status_code == 200, embed.text
    body = embed.json()
    assert "<script src=" in body["script"] and "pk_" in body["script"]
    assert body["widget"]["title"] == "NMB Service Assistant"
    assert body["agent_id"]

    backoffice = await client.get("/enterprise/solutions/gov-document-workflows/embed",
                                  headers=tok("a", "tenant_admin"))
    assert backoffice.status_code == 409


async def test_api_policy_test_and_connector_secret_rule(client):
    r = await client.post("/enterprise/policies/test", json={"text": "my card 4111111111111111", "direction": "input"},
                          headers=tok("a", "tenant_admin"))
    assert r.json()["action"] == "redact" and "4111111111111111" not in r.json()["text"]
    bad = await client.put("/enterprise/connectors/core", json={"type": "rest", "config": {"auth": {"secret": "hunter2"}}},
                           headers=tok("a", "tenant_admin"))
    assert bad.status_code == 422
    good = await client.put("/enterprise/connectors/core", json={"type": "rest", "config": {"auth": {"secret": "env:CORE"}}},
                            headers=tok("a", "tenant_admin"))
    assert good.status_code == 200


async def test_api_requires_auth(client):
    assert (await client.get("/enterprise/license")).status_code == 401
    assert (await client.get("/enterprise/license", headers=tok("v", "viewer"))).status_code == 403


async def test_api_me_and_workflow_spec(client):
    me = (await client.get("/enterprise/me", headers=tok("jo", "auditor", "approver"))).json()
    assert me["sub"] == "jo" and me["tenant_id"] == "gov" and "audit:read" in me["permissions"] and me["auth"] == "jwt"
    assert (await client.get("/enterprise/me", headers=ADMIN)).json()["permissions"] == ["*"]
    await client.post("/enterprise/solutions/gov-document-workflows/install", json={}, headers=tok("a", "tenant_admin"))
    spec = (await client.get("/enterprise/workflows/permit_application", headers=tok("a", "viewer"))).json()
    assert spec["key"] == "permit_application" and spec["steps"][0]["id"] == "check"
    assert (await client.get("/enterprise/workflows/nope", headers=tok("a", "viewer"))).status_code == 404
