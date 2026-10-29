# Dynamic AI Agent

A self-hostable, multi-tenant platform for configuring, publishing, running, and evaluating LLM agents. Includes an admin dashboard, a FastAPI gateway, a Python SDK, an embeddable chat widget, and `agent-kit` React components.

## Features

- **Agents:** Configure models, prompts, tools, RAG collections, and subagents.
- **Versioning:** Publish immutable versions and roll back when needed.
- **Chat API:** JSON and server-sent events (SSE), protected by API keys.
- **Knowledge:** Upload TXT, Markdown, and PDF documents; retrieve via a vector store (Qdrant in the compose topology).
- **Evaluation:** Run datasets against draft or published agents; optionally sync results to Langfuse.
- **Observability:** Trace agent runs with Langfuse (OpenTelemetry export, no callback wiring required).
- **Fine-tuning:** Optional LLaMA-Factory training jobs.
- **Integrations:** Python SDK, `embed.js`, and CopilotKit-style React components.
- **Models:** Ollama, Anthropic, OpenAI, Google, vLLM, and LiteLLM.
- **Two runtimes:**
  - **Local dev:** `langgraph dev` (free, no keys, hot-reload) for fast iteration.
  - **Production:** Aegra (open-source, self-hosted, no license key) for durable threads/runs, Redis-backed workers, and Postgres checkpoints.

## Architecture

There are two supported topologies. They share the same Python package (`nmb_marketplace_agent`) but differ in which runtime executes agent graphs.

### Local dev (single developer, `uv` + `langgraph dev`)

```text
dashboard (Vite :5173) ──▶ admin/gateway API (:8000) ──▶ langgraph dev (:2024)
                               │
                               ├──▶ Ollama (host :11434) [optional]
                               └──▶ Langfuse (host :3000) [optional]
```

- **Admin/Gateway:** FastAPI (`:8000`) — `nmb_marketplace_agent.api.main:app`.
- **Runtime:** `langgraph dev` (`:2024` by default).
- **Dashboard:** React + Vite (`:5173`).
- **Storage:** Postgres `registry-db` (`:5433` on host, running in the compose topology) holds agents/tools/prompts; checkpoints live with the runtime.
- **Optional:** Ollama, Langfuse, LiteLLM, vLLM, trainer.

### Docker Compose (production-shaped, `Aegra`)

See `services.txt` (app stack) and the Langfuse compose file (observability stack). Bring them up together so container DNS resolves across both — see "Troubleshooting" below.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ your host                                                            │
│                                                                      │
│ dashboard :8080 ──▶ nginx (static dashboard)                         │
│                                                                      │
│ admin-api :8000 ──▶ FastAPI (registry CRUD, eval, gateway)           │
│                                                                      │ 
│ agent-server :2026 ──▶ Aegra (:2026) — worker pool ────-─────────────┐ 
│                                                                      │ 
│  ├── aegra-postgres (:5434)                                          │ 
│  ├── aegra-redis                                                     │ 
│  └── qdrant (:6333)                                                  │ 
│                                                                      │ 
│ registry-db (:5433) ◀────────────────────────────────────────────────┘ 
│                                                                      │
│ Langfuse (compose file #2)                                           │
│ langfuse-web :3000 ◀── OTEL traces                                   │
│ langfuse postgres :5432 (127.0.0.1)                                  │
│ clickhouse :8123/:9000 (127.0.0.1)                                   │
│ minio :9090 (host), :9091 console (127.0.0.1)                        │
│                                                                      │
│ Ollama (host process, port 11434)                                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Components (compose):**

- **`agent-server` (`:2026`)** — Aegra. Runs agent graphs, holds threads/runs/checkpoints in `aegra-postgres`, uses `aegra-redis` as the job queue + SSE broker, and exports traces to Langfuse via OTEL.
- **`admin-api` (`:8000`)** — FastAPI. CRUD over the registry (agents, subagents, tools, prompts, versions) plus the Langfuse evaluate-and-redirect endpoint. What the dashboard talks to.
- **`dashboard` (`:8080`)** — nginx serving the built dashboard.
- **`aegra-postgres` (`:5434`)** — Aegra's own state. **`pgvector/pgvector:pg18`; the data volume mounts `/var/lib/postgresql`, not `/var/lib/postgresql/data` — that is correct for PG 18 and must not be "normalised" to the PG 17 layout.**
- **`registry-db` (`:5433`)** — the platform's own data (agents/tools/prompts). Separate from Aegra's Postgres and Langfuse's Postgres on purpose — three tools, three schemas, no upgrade can touch another's data.
- **`aegra-redis`** — internal only, not published on the host.
- **`qdrant` (`:6333`)** — vector store for RAG.
- **Langfuse stack** (separate compose file) — observability UI at `:3000`, its own Postgres/ClickHouse/MinIO/Redis, all bound to `127.0.0.1` except web (and MinIO on `:9090` for the S3 endpoint).

## Requirements

- **Python** 3.11+ (3.12 recommended; the Dockerfiles use 3.12).
- **Node.js** 18+ (20+ recommended) for the dashboard and `agent-kit` example.
- **`uv`** — https://docs.astral.sh/uv/
- **Docker** with BuildKit (the Dockerfiles use cache mounts) for the compose path.
- **A model provider.** Ollama can run everything locally; cloud providers (OpenAI, Anthropic, Google) are optional.

## Quick start — local dev

```bash
# 1. Install backend dependencies and pin the lockfile.
#    (uv.lock is required by the Docker builds — commit it.)
uv lock
uv sync

# 2. Configure environment.
cp .env.example .env
# Set ADMIN_TOKEN and NMB_JWT_SECRET. Add provider keys if needed.

# 3. Start Ollama (optional).
docker compose -f docker/docker-compose.yml up -d ollama
docker exec nmb-ollama ollama pull llama3.2

# 4. Initialize and seed the local database.
uv run python scripts/init_db.py
uv run python scripts/seed.py

# Terminal 1 — LangGraph dev runtime (:2024)
uv run langgraph dev

# Terminal 2 — Admin / Gateway API (:8000)
uv run uvicorn nmb_marketplace_agent.api.main:app --reload --port 8000

# Terminal 3 — Dashboard (:5173)
cd dashboard && npm install && npm run dev

# Terminal 4 — Example customer using agent-kit (:3000)
cd agent-kit/example && npm install && npm run dev
```

- Dashboard: http://localhost:5173
- Gateway/admin API: http://localhost:8000
- LangGraph dev: http://localhost:2024

agent-kit example: http://localhost:3000 (conflicts with Langfuse-web if you also run compose — run one or the other)

## Quick start — Docker Compose
Prerequisite: uv.lock committed, and aegra present in pyproject.toml (see "Project setup additions" below).

```bash
# Build & run the app stack + Langfuse in ONE compose invocation so the
# two projects share a network and `http://langfuse-web:3000` resolves
# from `agent-server` and `admin-api`.
docker compose \
  -f services.txt \
  -f observability/docker-compose.langfuse.yml \
  up -d --build

# Or bring up only the app stack (Aegra OTEL export to Langfuse will fail
# silently — see Troubleshooting):
docker compose -f services.txt up -d --build
```

### Ports after up

| Service | URL |
| --- | --- |
| Dashboard | http://localhost:8080 |
| Admin API | http://localhost:8000 |
| Aegra runtime | http://localhost:2026 |
| Langfuse | http://localhost:3000 |
| Qdrant | http://localhost:6333 |
| Registry DB | localhost:5433 (postgres:16) |
| Aegra DB | localhost:5434 (pgvector/pg18) |
| MinIO S3 endpoint | http://localhost:9090 |

Ollama is not containerized. It runs on the host at `:11434` and is reached from containers via `host.docker.internal` (Docker Desktop resolves this automatically). On Linux, `services.txt` adds `extra_hosts: host.docker.internal:host-gateway`, which requires Docker 20.10+ and Ollama listening on `0.0.0.0` — see Troubleshooting.

### Which Dockerfile when

There are three:

- `Dockerfile` — dev runtime, `langgraph dev` on `:8123`. Only used if you explicitly build with `--target langgraph-dev`. Not used by the default Compose path.
- `Dockerfile.aegra` — production runtime, Aegra on `:2026`. This is what `docker-compose.yml` builds for the `agent-server` service; its default/final stage is `aegra`.
- `Dockerfile.admin-api` — FastAPI on `:8000`. Built for the `admin-api` service.

All three use `uv + pyproject.toml` with `uv sync --frozen` and require `uv.lock` to be committed.

## First chat

1. Register a model in the dashboard under Models.
2. Create or edit an agent and select its model, tools, and knowledge collections.
3. Publish the agent.
4. Create a publishable API key under Settings and save it securely; the raw key is shown only once.

Send a chat request:

```bash
curl -X POST http://localhost:8000/v1/chat \
  -H "Authorization: Bearer pk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!"}'
```

Use `Accept: text/event-stream` to request SSE streaming.

> Note: In the Compose topology, chat may route through `admin-api` on `:8000` and be proxied to `agent-server` on `:2026`, or it may have moved directly to `:2026`. Confirm against `nmb_marketplace_agent/api/main.py` before shipping client code. The URL above matches the historical gateway path.

### Client integrations

#### Python SDK

Use `NmbAgent` from `nmb_marketplace_agent.client` in gateway mode with the gateway URL and publishable API key. It emits `thread`, `token`, `done`, and `error` events.

#### Embed widget

```html
<script src="http://localhost:8000/embed.js"
        data-key="pk_YOUR_KEY"
        data-api="http://localhost:8000"
        data-title="Support"></script>
```

#### React (agent-kit)

The `agent-kit/` package provides `LangGraphKitProvider`, chat components, hooks, frontend tool handling, and readable application state. See `agent-kit/example/my-app/` for an example.

### Useful endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Admin/gateway health (used by Compose healthcheck) |
| `GET /openapi.json` | API schema |
| `/agents` | Admin agent management |
| `/models` | Model registry |
| `/rag` | Knowledge collections |
| `/evals` | Evaluation datasets and runs |
| `/keys` | API key management |
| `POST /v1/chat` | Public chat (JSON or SSE) |
| `POST /v1/feedback` | Submit chat feedback |
| `GET /agents/{id}/manifest` | Agent manifest |
| `GET :2026/health` | Aegra runtime health |

Admin endpoints require `Authorization: Bearer $ADMIN_TOKEN`. Public endpoints require a publishable or secret API key. API keys are tenant-scoped; never expose secret keys or commit `.env`.

### Environment variables

Copy `.env.example` to `.env` (local dev) and/or set them in the Compose files. The most load-bearing ones are below:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | required | Bearer token for admin endpoints. Set a strong value. |
| `NMB_JWT_SECRET` | required | Signing key for tenant JWTs. Set a strong value. |
| `DATABASE_URL` | `postgresql://aegra:aegra@aegra-postgres:5432/aegra` | Aegra state (threads, runs, checkpoints). Distinct from registry DB on purpose — do not repoint to registry-db. |
| `REGISTRY_DATABASE_URL` | `postgresql://postgres:postgres@registry-db:5432/agentic_platform` | Platform data (agents/tools/prompts). |
| `REDIS_URL` | `redis://aegra-redis:6379/0` | Aegra worker queue + SSE broker. |
| `REDIS_BROKER_ENABLED` | `"true"` | Enables the Redis-backed queue. |
| `WORKER_COUNT` | `3` | Number of Aegra workers. |
| `N_JOBS_PER_WORKER` | `10` | Concurrency per worker. |
| `AUTH_TYPE` | `noop` | Aegra auth mode. Do not leave `noop` on anything internet-facing. |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Local Ollama endpoint. Override if Ollama runs at a fixed LAN IP. |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embedding model. |
| `DEFAULT_MODEL` | `ollama:llama3.1:8b` | Fallback model when an agent does not set one. |
| `QDRANT_URL` | `http://qdrant:6333` | Vector store. |
| `OPENAI_API_KEY / OPENAI_BASE_URL` | empty | Optional. Only required if an agent's model uses the `openai:` prefix. |
| `ANTHROPIC_API_KEY` | empty | Optional. Only required for `anthropic:` prefix. |
| `OTEL_TARGETS` | `LANGFUSE` | OTEL export target(s) for Aegra traces. |
| `LANGFUSE_BASE_URL / LANGFUSE_HOST` | `http://langfuse-web:3000` | Must match the Langfuse Compose hostname, or use `http://host.docker.internal:3000` if the projects are on separate networks. |
| `LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY` | empty | Must match the Langfuse bootstrap keys (`LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `..._SECRET_KEY`) in the Langfuse Compose file. Mismatch = every trace gets 401. |

Langfuse itself has ~80 environment variables, all documented inline in the Compose file (`# CHANGEME` marks values you must supply). The ones that matter most for integration are the `LANGFUSE_*_KEY` pairs above and `LANGFUSE_INIT_PROJECT_*` / `LANGFUSE_INIT_USER_*` when you want automatic project + user bootstrap.

### Project setup additions (one-time)

These are not yet in the tree but are required for the Compose path to work:

- `uv.lock` — commit it. All three Dockerfiles run `uv sync --frozen`, which hard-fails without it. Run `uv lock` once locally and commit.
- `aegra` in `pyproject.toml` — the Aegra stage `CMD` is `aegra serve`. Add `"aegra"` to `[project].dependencies` and re-lock.
- `.dockerignore` — `COPY . .` currently bakes `.env`, `.venv`, `data/`, `node_modules/`, and `.git` into every image. Minimum contents:

```gitignore
gitignore
.env
.env.*
!.env.example
.venv/
**/__pycache__/
**/*.pyc
.git/
node_modules/
**/node_modules/
data/
dashboard/dist/
**/*.log
.pytest_cache/
```

Note: this also removes `.env` from the `langgraph-dev` stage, and `langgraph.json` declares `"env": ".env"`. Feed environment variables via the Compose `environment` block (as `agent-server` already does) or change the key in `langgraph.json`.

- `.env.example` — if it does not exist, add one mirroring the table above with placeholder values.
- Extra Postgres for `admin-api` — if `admin_api/api` uses SQLAlchemy async with `asyncpg` (or sync with `psycopg`), enable the optional dependency: `uv sync --frozen --no-dev --extra postgres` in `Dockerfile.admin-api`.
- `/health` on `admin-api` — the Compose `depends_on` for the dashboard can only gate on `condition: service_healthy` once `admin-api` has a healthcheck; add one that hits `/health`.

### Tests and builds

```bash
# Backend
uv lock --check                   # lockfile is in sync with pyproject.toml
uv run pytest tests/ -q
uv run python -m compileall src scripts tests

# Dashboard
cd dashboard && npm run build     # produces dashboard/dist — mount that, not the source root

# Images
docker build --target langgraph-dev -t app:dev -f Dockerfile .
docker build --target aegra         -t app:aegra -f Dockerfile.aegra .
docker build                         -t app:admin -f Dockerfile.admin-api .
```

### Data and configuration

The storage layer changed with the Compose topology. SQLite and FAISS are the old local-only layout and are no longer authoritative when you run Compose:

- Registry data (agents, subagents, tools, prompt versions): `registry-db` Postgres. Schema is created on first container start from `./backend/db/schema.sql`.
- Aegra state (threads, runs, checkpoints): `aegra-postgres` (pgvector/pg18).
- Queue + SSE broker: `aegra-redis`.
- Vector store: `qdrant_data` volume.
- Langfuse data: its own Postgres, ClickHouse, MinIO, and Redis — never share these with the app.

Local-dev legacy (still used by `uv run langgraph dev` / SQLite path):

- `data/app.db`
- `data/docs/`
- `data/indexes/`
- `data/training/`
- `data/connections.json`

Back up the relevant Docker volumes (`aegra_postgres_data`, `registry_db_data`, `qdrant_data`, plus the Langfuse volumes) to preserve state. Do not commit `.env`, DB files, credentials, or runtime data.

### Operational notes

Port map on the host:

- `3000` — Langfuse web
- `5432` — Langfuse Postgres
- `5433` — registry-db
- `5434` — aegra-postgres
- `6333` — Qdrant
- `8000` — admin-api
- `8080` — dashboard
- `2026` — Aegra
- `8123` — langgraph-dev (only if built)
- `9090` — MinIO S3
- `9091` — MinIO console
- `11434` — Ollama (host process)

Network isolation: everything is bound to `127.0.0.1` except Langfuse web (`:3000`) and MinIO's S3 endpoint (`:9090`), which are internal-only by design. If you expose the platform, front it with a reverse proxy and do not publish `registry-db`, `aegra-postgres`, or ClickHouse on `0.0.0.0`.

Two Compose files must share a network. If you run them separately, `http://langfuse-web:3000` will not resolve inside `agent-server` or `admin-api`. Either bring them up in one invocation (recommended), declare an external network in both files, or point `LANGFUSE_BASE_URL` / `LANGFUSE_HOST` at `http://host.docker.internal:3000`.

### Troubleshooting

- `agent-server` is up but Langfuse is empty. Almost always one of: (a) `LANGFUSE_BASE_URL` / `LANGFUSE_HOST` cannot reach `langfuse-web`; (b) `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` do not match the Langfuse bootstrap keys; (c) `OTEL_TARGETS` is not `LANGFUSE`. Check `docker compose logs agent-server | grep -i otel`.
- `ModuleNotFoundError: aegra in agent-server` — `aegra` is not in `pyproject.toml`. Add it and rebuild (run `uv lock` first).
- `uv sync --frozen` fails with `lockfile missing` — commit `uv.lock`.
- Aegra data volume looks empty after `up` — verify `aegra-postgres` still mounts `/var/lib/postgresql` (PG 18 layout). Changing it to `/var/lib/postgresql/data` will break the volume initialization.
- `ModuleNotFoundError: asyncpg / psycopg in admin-api` — SQLAlchemy driver missing; add `--extra postgres` to the build's `uv sync` and make sure `[project.optional-dependencies].postgres` contains the correct driver for the URL prefix used in `main.py`.
- Ollama unreachable from containers on Linux — host Ollama must listen on `0.0.0.0:11434` (`OLLAMA_HOST=0.0.0.0` in its unit/environment), and `host.docker.internal` must be resolvable (`services.txt` handles this via `extra_hosts: host.docker.internal:host-gateway`).
- Dashboard shows a blank page / 404 on JS assets — nginx is serving the Vite source root. Mount `dashboard/dist` (built with `npm run build`), not `./dashboard`.
- Cold-start `agent-server` flaps unhealthy — `start_period: 20s` is tight for 3 workers + Redis + Postgres + first-boot migrations; raise it to `60s` if you see flapping.

### Security and limitations

- Tenant and agent access is derived from API keys; request-supplied tenant/agent IDs must match.
- Publishable keys can be restricted by allowed origins and rate limits.
- Configure a strong `ADMIN_TOKEN` and `NMB_JWT_SECRET` in production.
- `AUTH_TYPE: noop` on Aegra is a local-only setting — do not ship it to anything reachable.
- Default `postgres:postgres` / `aegra:aegra` credentials in the Compose files are local-only; replace them via env vars before exposing.
- The current in-memory rate limiter is per process and is not suitable for coordinated multi-worker limits.
- Review `docs/BACKEND_REVIEW.md` before production deployment, especially JWT verification, FAISS deserialization, and other tracked security findings.
- Database schema changes are not automatically migrated by `create_all`; use a migration tool for production changes.
- The Langfuse Compose file ships `# CHANGEME` placeholders — treat any that remain in a running deployment as a security incident.

