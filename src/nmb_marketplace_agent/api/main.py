import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from nmb_marketplace_agent.api.auth import require_admin, verify_api_key
from nmb_marketplace_agent.api.routes import (
    agents,
    catalog,
    evals,
    feedback,
    inference,
    keys,
    lg_proxy,
    locale,
    manifest,
    models,
    prompts,
    public,
    rag,
    runs,
    subagents,
    system,
    token,
    tools,
    training,
    versions,
)
from nmb_marketplace_agent.api.routes import (
    observability as observability_routes,
)
from nmb_marketplace_agent.config.database import init_db
from nmb_marketplace_agent.enterprise import models as _enterprise_models  # noqa: F401 (register tables)
from nmb_marketplace_agent.enterprise.api import router as enterprise_router
from nmb_marketplace_agent.enterprise.api import sweeper_loop
from nmb_marketplace_agent.enterprise.notifications import dispatcher_loop

PKG_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = PKG_DIR / "static"

admin = [Depends(require_admin)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    from nmb_marketplace_agent.crypto import preflight as crypto_preflight

    crypto_preflight()  # fail closed in NMB_ENCRYPTION_REQUIRED mode
    await init_db()
    sweeper = asyncio.create_task(sweeper_loop()) if os.environ.get("ENTERPRISE_SWEEPER", "on") == "on" else None
    notifier = asyncio.create_task(dispatcher_loop()) if os.environ.get("ENTERPRISE_NOTIFY", "on") == "on" else None
    yield
    if sweeper:
        sweeper.cancel()
    if notifier:
        notifier.cancel()


app = FastAPI(title="NMB Marketplace Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Restrict in production: CORS_ORIGINS="https://app.bank.co,https://admin.bank.co"
    allow_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ── Admin-protected CRUD ─────────────────────────────────────────────
for mod, prefix in [
    (agents, "/agents"),
    (tools, "/tools"),
    (rag, "/rag"),
    (subagents, "/subagents"),
    (runs, "/runs"),
    (models, "/models"),
    (keys, "/keys"),
    (locale, "/locale"),
    (versions, "/agents"),
    (evals, "/evals"),
    (feedback, "/feedback"),
    (token, "/v1/token"),
    (inference, "/inference"),
    (observability_routes, "/observability"),
    (prompts, "/prompts"),
    (system, "/system"),
    (training, "/training"),
]:
    app.include_router(
        mod.router,
        prefix=prefix,
        tags=[prefix.strip("/")],
        dependencies=admin,
    )


# ── Enterprise layer (RBAC/SSO-protected; license-gated per module) ──
app.include_router(enterprise_router, prefix="/enterprise", tags=["enterprise"])


# ── Public (API-key / embed) endpoints ───────────────────────────────
app.include_router(manifest.router, prefix="/agents",
                   tags=["manifest"], dependencies=[Depends(verify_api_key)])
app.include_router(public.router, prefix="/v1", tags=["public"])
app.include_router(catalog.router, prefix="/v1", tags=["public"])
app.include_router(lg_proxy.config_router, prefix="/v1", tags=["public"])
app.include_router(lg_proxy.router, prefix="/v1/lg", tags=["langgraph-proxy"])


# ── Static assets ────────────────────────────────────────────────────
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _serve(filename: str, media_type: str | None = None):
    path = STATIC_DIR / filename
    if not path.exists():
        return JSONResponse(
            {"detail": f"{filename} not installed — put it in {STATIC_DIR}"},
            status_code=404,
        )
    return FileResponse(path, media_type=media_type)


@app.get("/", include_in_schema=False)
async def root():
    return _serve("index.html")


@app.get("/app", include_in_schema=False)
async def legacy_app():
    """Legacy single-file dashboard, kept at /app while the React dashboard lives separately."""
    return _serve("index.html")


@app.get("/demo", include_in_schema=False)
async def demo():
    return _serve("demo.html")


@app.get("/marketplace", include_in_schema=False)
async def marketplace_page():
    """Anonymous catalogue: prospective customers browse packs before signing in."""
    return _serve("marketplace.html")


@app.get("/widget-demo", include_in_schema=False)
async def widget_demo():
    """A simulated client site that embeds the chat widget."""
    return _serve("widget-demo.html")


@app.get("/widget-tools-demo", include_in_schema=False)
async def widget_tools_demo():
    """A client site where the widget runs a page tool (set_filter) and resumes."""
    return _serve("widget-tools-demo.html")


@app.get("/embed.js", include_in_schema=False)
async def embed_js():
    return _serve("embed.js", media_type="application/javascript")


@app.get("/auth/check", dependencies=admin)
async def auth_check():
    return {"ok": True}


@app.get("/health")
async def health():
    return {"status": "ok"}