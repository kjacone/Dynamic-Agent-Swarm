import jwt
import pytest
import yaml
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from nmb_marketplace_agent.enterprise.licensing import License
from nmb_marketplace_agent.enterprise.models import AuditEvent, SolutionSnapshot
from nmb_marketplace_agent.enterprise.solutions import loader, marketplace


@pytest.fixture
async def client(db, monkeypatch, tmp_path):
    from fastapi import FastAPI

    from nmb_marketplace_agent.api.deps import get_db
    from nmb_marketplace_agent.enterprise import api as eapi
    from nmb_marketplace_agent.enterprise import api_common
    from nmb_marketplace_agent.enterprise.solutions import loader
    from nmb_marketplace_agent.enterprise.workflows import Runtime

    monkeypatch.setenv("NMB_JWT_SECRET", "s" * 32)
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
    monkeypatch.setattr(api_common, "build_runtime", fake_runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


def tok(sub, *roles, tenant="gov"):
    return {"Authorization": "Bearer " + jwt.encode(
        {"sub": sub, "tenant_id": tenant, "roles": list(roles)}, "s" * 32, algorithm="HS256")}


def test_version_ordering():
    assert marketplace.version_key("1.10.0") > marketplace.version_key("1.9.9")
    assert marketplace.version_key(None) == (0,)
    assert not marketplace.upgrade_available("1.0.0", "1.0.0")
    assert marketplace.upgrade_available("1.1.0", "1.0.9")


async def test_catalog_lists_packs_with_license_and_counts(client):
    r = await client.get("/enterprise/marketplace", headers=tok("v", "viewer"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["license"]["state"] == "unenforced"
    assert body["counts"]["total"] == len(body["packs"]) >= 8
    assert body["counts"]["installed"] == 0 and body["counts"]["upgrades"] == 0
    pack = next(p for p in body["packs"] if p["id"] == "gov-document-workflows")
    assert pack["installed"] is False and pack["entitled"] is True
    assert pack["upgrade_available"] is False and pack["installed_at"] is None

    # The old list endpoint keeps its shape and gains the catalog fields.
    old = await client.get("/enterprise/solutions", headers=tok("v", "viewer"))
    assert old.status_code == 200 and isinstance(old.json(), list)
    assert {"upgrade_available", "parameter_changes"} <= set(old.json()[0])


async def test_catalog_respects_license_entitlements(client, monkeypatch):
    from nmb_marketplace_agent.enterprise import solutions_api

    limited = License(customer="bank", edition="professional", modules={"solutions"},
                      solutions={"gov-document-workflows"}, state="valid")
    monkeypatch.setattr(solutions_api, "current_license", lambda *a, **k: limited)
    body = (await client.get("/enterprise/marketplace", headers=tok("v", "viewer"))).json()
    ent = {p["id"]: p["entitled"] for p in body["packs"]}
    assert ent["gov-document-workflows"] is True and ent["telco-service-ops"] is False
    assert body["counts"]["entitled"] == 1
    assert body["license"]["edition"] == "professional"


async def test_pack_detail_omits_prompts(client):
    r = await client.get("/enterprise/marketplace/gov-document-workflows", headers=tok("v", "viewer"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["supervisor"]["key"] and body["agents"] and body["workflows"]
    assert "system_prompt" not in r.text and "You are" not in r.text
    assert (await client.get("/enterprise/marketplace/nope", headers=tok("v", "viewer"))).status_code == 404


async def test_install_marks_catalog_and_upgrade_is_a_noop(client):
    assert (await client.post("/enterprise/solutions/gov-document-workflows/install", json={},
                              headers=tok("a", "tenant_admin"))).status_code == 200
    body = (await client.get("/enterprise/marketplace", headers=tok("v", "viewer"))).json()
    pack = next(p for p in body["packs"] if p["id"] == "gov-document-workflows")
    assert pack["installed"] is True and pack["installed_version"] == pack["version"]
    assert pack["upgrade_available"] is False
    assert body["counts"]["installed"] == 1

    same = await client.post("/enterprise/marketplace/gov-document-workflows/upgrade",
                             headers=tok("a", "tenant_admin"))
    assert same.status_code == 409


async def test_upgrade_applies_newer_pack_and_keeps_settings(client, db):
    installed = await client.post("/enterprise/solutions/gov-document-workflows/install",
                                  json={"parameters": {"review_sla_hours": 24}},
                                  headers=tok("a", "tenant_admin"))
    assert installed.status_code == 200, installed.text

    from nmb_marketplace_agent.enterprise.models import InstalledSolution
    row = await db.get(InstalledSolution, "gov:gov-document-workflows")
    original_at = row.installed_at
    row.version = "0.9.0"
    db.add(row)
    await db.commit()

    body = (await client.get("/enterprise/marketplace", headers=tok("v", "viewer"))).json()
    pack = next(p for p in body["packs"] if p["id"] == "gov-document-workflows")
    assert pack["upgrade_available"] is True and body["counts"]["upgrades"] == 1
    assert "review_sla_hours" in pack["parameter_changes"]["changed"]

    up = await client.post("/enterprise/marketplace/gov-document-workflows/upgrade",
                           headers=tok("a", "tenant_admin"))
    assert up.status_code == 200, up.text
    assert up.json()["from_version"] == "0.9.0" and up.json()["to_version"] == pack["version"]
    assert up.json()["parameters"]["review_sla_hours"] == 24

    await db.refresh(row)
    assert row.installed_at == original_at and row.version == pack["version"]
    assert row.created.get("upgraded_at")
    assert row.created["upgrades"][-1]["from_version"] == "0.9.0"

    events = (await db.execute(select(AuditEvent).where(
        AuditEvent.action == "solution.upgraded"))).scalars().all()
    assert events and events[0].details["from_version"] == "0.9.0"

    after = (await client.get("/enterprise/marketplace", headers=tok("v", "viewer"))).json()
    assert after["counts"]["upgrades"] == 0
    upgraded = next(p for p in after["packs"] if p["id"] == "gov-document-workflows")
    assert upgraded["upgrade_history"][-1]["to_version"] == pack["version"]
    assert upgraded["parameter_changes"]["changed"] == ["review_sla_hours"]


async def test_upgrade_requires_an_install(client):
    r = await client.post("/enterprise/marketplace/telco-service-ops/upgrade",
                          headers=tok("a", "tenant_admin"))
    assert r.status_code == 404
    # viewers cannot upgrade
    await client.post("/enterprise/solutions/gov-document-workflows/install", json={},
                      headers=tok("a", "tenant_admin"))
    v = await client.post("/enterprise/marketplace/gov-document-workflows/upgrade",
                          headers=tok("v", "viewer"))
    assert v.status_code == 403


async def test_snapshots_enable_rollback(client, db, monkeypatch, tmp_path):
    pack_dir = tmp_path / "packs"
    pack_dir.mkdir()
    src = yaml.safe_load((loader.PACK_DIR / "gov-document-workflows.yaml").read_text())

    def write(version: str) -> None:
        (pack_dir / "gov-document-workflows.yaml").write_text(
            yaml.safe_dump({**src, "version": version}))

    write("1.0.0")
    monkeypatch.setattr(loader, "PACK_DIR", pack_dir)

    assert (await client.post("/enterprise/solutions/gov-document-workflows/install",
                              json={"parameters": {"review_sla_hours": 24}},
                              headers=tok("a", "tenant_admin"))).status_code == 200
    assert (await client.post("/enterprise/marketplace/gov-document-workflows/upgrade",
                              headers=tok("a", "tenant_admin"))).status_code == 409

    write("1.1.0")
    up = await client.post("/enterprise/marketplace/gov-document-workflows/upgrade",
                           headers=tok("a", "tenant_admin"))
    assert up.status_code == 200, up.text

    snaps = (await db.execute(select(SolutionSnapshot))).scalars().all()
    assert {s.version for s in snaps} == {"1.0.0", "1.1.0"}
    assert all(s.pack["version"] == s.version for s in snaps)

    body = (await client.get("/enterprise/marketplace", headers=tok("v", "viewer"))).json()
    pack = next(p for p in body["packs"] if p["id"] == "gov-document-workflows")
    assert pack["installed_version"] == "1.1.0"
    assert [v["version"] for v in pack["rollback_versions"]] == ["1.0.0"]

    assert (await client.post("/enterprise/marketplace/gov-document-workflows/rollback",
                              headers=tok("v", "viewer"))).status_code == 403

    back = await client.post("/enterprise/marketplace/gov-document-workflows/rollback",
                             headers=tok("a", "tenant_admin"))
    assert back.status_code == 200, back.text
    assert back.json()["from_version"] == "1.1.0" and back.json()["to_version"] == "1.0.0"
    assert back.json()["parameters"]["review_sla_hours"] == 24

    events = (await db.execute(select(AuditEvent).where(
        AuditEvent.action == "solution.rolled_back"))).scalars().all()
    assert events and events[0].details["from_version"] == "1.1.0"

    after = (await client.get("/enterprise/marketplace", headers=tok("v", "viewer"))).json()
    pack = next(p for p in after["packs"] if p["id"] == "gov-document-workflows")
    assert pack["installed_version"] == "1.0.0" and pack["upgrade_available"] is True
    assert [v["version"] for v in pack["rollback_versions"]] == ["1.1.0"]

    missing = await client.post("/enterprise/marketplace/gov-document-workflows/rollback",
                                json={"version": "9.9.9"}, headers=tok("a", "tenant_admin"))
    assert missing.status_code == 409
