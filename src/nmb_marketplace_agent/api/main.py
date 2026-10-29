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
    evals,
    feedback,
    inference,
    keys,
    lg_proxy,
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

PKG_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = PKG_DIR / "static"

admin = [Depends(require_admin)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="NMB Marketplace Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


# ── Public (API-key / embed) endpoints ───────────────────────────────
app.include_router(manifest.router, prefix="/agents",
                   tags=["manifest"], dependencies=[Depends(verify_api_key)])
app.include_router(public.router, prefix="/v1", tags=["public"])
app.include_router(feedback.public_router, prefix="/v1", tags=["public"])
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


@app.get("/embed.js", include_in_schema=False)
async def embed_js():
    return _serve("embed.js", media_type="application/javascript")


@app.get("/auth/check", dependencies=admin)
async def auth_check():
    return {"ok": True}


@app.get("/health")
async def health():
    return {"status": "ok"}