import pytest
from httpx import ASGITransport, AsyncClient

from nmb_marketplace_agent.api.routes import catalog


@pytest.fixture
async def anon():
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(catalog.router, prefix="/v1")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


TENANT_KEYS = ("installed", "entitled", "installed_version", "installed_at", "license", "parameter_changes")


async def test_public_catalog_needs_no_credentials(anon):
    r = await anon.get("/v1/marketplace")
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "public, max-age=300"
    body = r.json()
    assert body["count"] == len(body["packs"]) >= 8
    pack = next(p for p in body["packs"] if p["id"] == "gov-document-workflows")
    assert {"name", "industry", "version", "summary", "delivery", "assets"} <= set(pack)
    for k in TENANT_KEYS:
        assert k not in pack


async def test_public_pack_detail_hides_prompts_and_install_state(anon):
    r = await anon.get("/v1/marketplace/gov-document-workflows")
    assert r.status_code == 200, r.text
    assert r.headers["cache-control"] == "public, max-age=300"
    body = r.json()
    assert body["supervisor"]["key"] and body["agents"] and body["workflows"]
    assert "system_prompt" not in r.text and "You are" not in r.text
    for k in TENANT_KEYS + ("upgrade_history", "rollback_versions"):
        assert k not in body


async def test_public_pack_detail_404(anon):
    assert (await anon.get("/v1/marketplace/does-not-exist")).status_code == 404


def test_marketplace_page_is_wired():
    from nmb_marketplace_agent.api import main

    assert (main.STATIC_DIR / "marketplace.html").exists()
    assert any(getattr(r, "path", "") == "/marketplace" for r in main.app.routes)
