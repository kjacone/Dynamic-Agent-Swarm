# Dynamic AI Agent

A self-hostable, multi-tenant platform for building, running, governing and auditing LLM agents and automated business workflows. It includes an admin dashboard, a FastAPI gateway, a Python SDK, an embeddable chat widget, `agent-kit` React components, and an enterprise layer for regulated industries.

## Features

**Agent platform**
- **Agents:** models, prompts, tools, RAG collections, subagents. Publish immutable versions and roll back.
- **Chat API:** JSON or SSE, protected by tenant-scoped API keys.
- **Knowledge:** upload TXT, Markdown and PDF; retrieve from Qdrant.
- **Evaluation and tracing:** run datasets against draft or published agents; Langfuse via OpenTelemetry.
- **Models:** Ollama, Anthropic, OpenAI, Google, vLLM, LiteLLM. Optional LLaMA-Factory fine-tuning.
- **Runtimes:** `langgraph dev` for local work; Aegra (Redis workers, Postgres checkpoints) for production.

**Enterprise layer** (`src/nmb_marketplace_agent/enterprise/`, served at `/enterprise/*`)

| Capability | What it gives you |
| --- | --- |
| Audit trail | Hash-chained, tamper-evident log; optional HMAC key; signed checkpoints; JSONL export |
| Access control | RBAC, OIDC SSO (Entra, Okta, Keycloak), IdP group to role mapping |
| Guardrails | PII and secret redaction, prompt-injection blocking, per-tool policies, human review on risky tool calls |
| Workflows | Durable engine: agent, tool, connector, approval, condition and parallel steps; retries; safe expressions |
| Approvals | Maker-checker, N-of-M approvers, veto on reject, SLA escalation and expiry |
| Connectors | REST (mTLS), file drop, fixed-width/CSV, IMAP, RPA bridge; egress allow-list; secrets by reference only |
| Solution packs | Banking KYC, insurance claims, telecom service, government documents, healthcare, NGO procurement, corporate automation, education |
| Licensing and metering | Offline Ed25519 licences (modules, solutions, tenants, seats, quotas); usage metering with CSV export |
| Compliance | Control mapping (SOC 2, ISO 27001, GDPR/Kenya DPA, PCI DSS, HIPAA, NIST), live posture checks, evidence bundle. Not a certification. |

Design notes: [docs/ENTERPRISE_PLATFORM.md](docs/ENTERPRISE_PLATFORM.md).

## Architecture

```text
dashboard ──▶ admin/gateway API (FastAPI :8000) ──▶ agent runtime (langgraph dev :2024 | Aegra :2026)
                 │                                      ├── aegra-postgres, aegra-redis
                 ├── registry-db (Postgres)             └── OTEL ──▶ Langfuse
                 ├── qdrant (vectors)
                 └── Ollama / cloud model providers
```

- **admin-api (`:8000`):** registry CRUD, evaluation, public chat gateway, `/enterprise/*`.
- **Runtime:** executes agent graphs; every tool call passes through the enterprise guard.
- **registry-db:** agents, tools, prompts and the enterprise tables. Kept separate from Aegra's and Langfuse's Postgres so no upgrade touches another's data.
- **aegra-postgres:** `pgvector/pgvector:pg18`. Its volume mounts `/var/lib/postgresql` (the PG 18 layout), not `/var/lib/postgresql/data`. Do not change it.
- **Langfuse:** separate compose file with its own Postgres, ClickHouse, MinIO and Redis.

## Requirements

Python 3.11+ (3.12 recommended), Node 18+, [`uv`](https://docs.astral.sh/uv/), Docker with BuildKit, and a model provider (Ollama runs everything locally).

## Quick start (local dev)

```bash
uv lock && uv sync
cp .env.example .env        # set ADMIN_TOKEN and NMB_JWT_SECRET (see Configuration)

uv run python scripts/init_db.py
uv run python scripts/seed.py

uv run langgraph dev                                          # terminal 1: runtime :2024
uv run uvicorn nmb_marketplace_agent.api.main:app --reload    # terminal 2: API :8000
cd dashboard && npm install && npm run dev                    # terminal 3: dashboard :5173
```

Optional Ollama: `docker compose -f docker/docker-compose.yml up -d ollama && docker exec nmb-ollama ollama pull llama3.2`.

## Quick start (Docker Compose)

Needs a committed `uv.lock`, `aegra` in `pyproject.toml` dependencies, and a `.dockerignore` that excludes `.env`, `.venv`, `data/`, `node_modules/` and `.git`.

```bash
# One invocation so both projects share a network and `langfuse-web` resolves
docker compose -f services.txt -f observability/docker-compose.langfuse.yml up -d --build
docker compose exec admin-api alembic upgrade head
```

| Service | URL |
| --- | --- |
| Dashboard | http://localhost:8080 |
| Admin API | http://localhost:8000 |
| Aegra runtime | http://localhost:2026 |
| Langfuse | http://localhost:3000 |
| Qdrant | http://localhost:6333 |
| registry-db / aegra-db | localhost:5433 / localhost:5434 |
| MinIO S3 / console | localhost:9090 / localhost:9091 |

Ollama runs on the host (`:11434`) and is reached through `host.docker.internal`. On Linux it must listen on `0.0.0.0`.

## First chat

1. Register a model (Models), create an agent, and publish it.
2. Create a publishable API key (Settings). The raw key is shown once.

```bash
curl -X POST http://localhost:8000/v1/chat \
  -H "Authorization: Bearer pk_YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"message":"Hello!"}'          # add Accept: text/event-stream for SSE
```

**Clients:** Python SDK `NmbAgent` (`nmb_marketplace_agent.client`); embed widget
`<script src="http://localhost:8000/embed.js" data-key="pk_..." data-api="http://localhost:8000"></script>`;
React via `agent-kit/` (`LangGraphKitProvider`, see `agent-kit/example/`).

## Enterprise quick start

```bash
# 1. Secrets (keep out of git)
cat >> .env <<EOF
AUDIT_HMAC_KEY=$(openssl rand -hex 32)
REDACTION_KEY=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)
EOF

# 2. Create the enterprise tables
ALEMBIC_DATABASE_URL=<async db url> uv run alembic upgrade head

# 3. Mint a named user token (admin token can view approvals but cannot decide them)
uv run python scripts/mint_token.py officer1@bank.co acme-bank compliance_officer

# 4. End-to-end demo: install KYC pack, high-risk case, two approvers, audit verify, tamper detection
uv run python scripts/demo_kyc.py
```

The demo runs in-process on a temporary SQLite database. The LLM and bank systems are scripted, so it needs no model or network.

### Dashboard screens

Sign in with `ADMIN_TOKEN` or a named SSO/tenant JWT. Named users are bound to their token's tenant and see only what their roles allow.

| Section | Screens |
| --- | --- |
| Build | Overview, Agents, Subagents, Prompts, Tools, Knowledge, Models, Training, Evaluations, Observability, Settings |
| Operate and govern | Approvals, Workflows, Solutions, Connectors, Audit trail, Governance |

### Roles

`platform_admin`, `tenant_admin`, `agent_builder`, `workflow_designer`, `operator`, `approver`, `auditor`, `viewer`, plus industry approver roles (`compliance_officer`, `claims_adjuster`, `underwriter`, `case_worker`, `procurement_officer`, `clinician_reviewer`, `registrar`, `team_lead`, `finance_controller`). Add more with `EXTRA_APPROVER_ROLES`.

### Solution packs

Packs are YAML in `enterprise/solutions/packs/`. Installing one creates agents, versioned workflows, policies, disabled connector templates and evaluation sets for the tenant. It is parameterised and idempotent; re-installing upgrades in place and keeps earlier settings.

```bash
curl -X POST localhost:8000/enterprise/solutions/banking-kyc/install \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"parameters":{"edd_threshold":60,"model":"ollama:llama3.1:8b"}}'
```

Packs are starting templates. Have each customer's compliance team review prompts, thresholds and wording. Workflows expect agents to return JSON; weaker models may need stricter prompts or `retries`.

### Licensing

```bash
uv run python scripts/issue_license.py keygen > keys.pem          # once; keep the private key offline
uv run python scripts/issue_license.py issue --key license_private.pem --customer "Acme Bank" \
  --modules workflows,approvals,connectors,solutions,compliance,sso --solutions banking-kyc \
  --tenants 2 --seats 150 --deployment air_gapped --quota agent_runs=500000 --days 365
```

Set `LICENSE_ENFORCE=true`, `LICENSE_PUBLIC_KEY` and the customer's `LICENSE_KEY` in production. With enforcement off (the default) everything is unlocked for development. An expired licence never blocks access to the customer's own audit data.

## Configuration

Set in `.env` (local) or the compose files.

| Variable | Purpose |
| --- | --- |
| `ADMIN_TOKEN` | Admin bearer token. At least 32 random characters. |
| `NMB_JWT_SECRET` | Signs and verifies tenant JWTs. |
| `DATABASE_URL` | Aegra state (threads, runs, checkpoints). Do not point at registry-db. |
| `REGISTRY_DATABASE_URL` | Platform data. |
| `REDIS_URL`, `REDIS_BROKER_ENABLED`, `WORKER_COUNT`, `N_JOBS_PER_WORKER` | Aegra queue and workers. |
| `AUTH_TYPE` | Aegra auth. Never leave `noop` on anything reachable. |
| `OLLAMA_BASE_URL`, `EMBEDDING_MODEL`, `DEFAULT_MODEL` | Local models. |
| `QDRANT_URL` | Vector store. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Only for those providers. |
| `OTEL_TARGETS`, `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Tracing. Keys must match Langfuse's bootstrap keys or traces get 401. |

**Enterprise**

| Variable | Purpose |
| --- | --- |
| `AUDIT_HMAC_KEY` | Keys the audit chain so a database admin cannot forge it. |
| `REDACTION_KEY` | Keys deterministic redaction tokens. |
| `CORS_ORIGINS` | Comma-separated front-end origins (default `*`; restrict in production). |
| `EGRESS_ALLOWED_HOSTS` | Hosts connectors may call (default: none). |
| `OIDC_JWKS_URL`, `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_TENANT_CLAIM`, `OIDC_ROLES_CLAIM`, `OIDC_ROLE_MAP` | Enterprise SSO and group-to-role mapping. |
| `LICENSE_ENFORCE`, `LICENSE_PUBLIC_KEY`, `LICENSE_KEY` / `LICENSE_FILE` | Licensing. |
| `WEBHOOK_SECRET` | HMAC for `POST /enterprise/hooks/{tenant}/{workflow}`. |
| `ALLOW_ADMIN_TOKEN_APPROVALS` | Keep `false`. Shared credentials should not approve. |
| `ENTERPRISE_GUARDRAILS`, `ENTERPRISE_SWEEPER`, `ENTERPRISE_SWEEP_INTERVAL_S`, `QUOTA_HARD_STOP` | Feature toggles and SLA sweep interval. |
| `AUTO_CREATE_TABLES`, `ALEMBIC_DATABASE_URL` | Schema management (see Database migrations). |

## Database migrations

`create_all` is fine for local dev. For production use Alembic.

```bash
ALEMBIC_DATABASE_URL=postgresql+asyncpg://user:pass@host/db uv run alembic upgrade head
```

Set `AUTO_CREATE_TABLES=false` in production and run the upgrade as a deploy step. On Postgres the migration also makes `audit_events` append-only at the database level. Existing databases: run `alembic stamp` for the baseline first (the migration skips tables that already exist).

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Health check |
| `/agents`, `/models`, `/rag`, `/evals`, `/keys` | Admin APIs (need `ADMIN_TOKEN`) |
| `POST /v1/chat`, `POST /v1/feedback` | Public chat and feedback (API key) |
| `GET /agents/{id}/manifest` | Agent manifest |
| `/enterprise/me`, `/license`, `/usage` | Identity, licence, metering |
| `/enterprise/audit`, `/audit/verify`, `/audit/checkpoint`, `/audit/export` | Audit trail |
| `/enterprise/workflows`, `/runs`, `/approvals` | Workflows and approvals |
| `/enterprise/solutions`, `/connectors`, `/policies` | Packs, connectors, guardrails |
| `/enterprise/compliance/readiness`, `/capabilities`, `/evidence` | Compliance |

## Tests and builds

```bash
uv lock --check && uv run pytest tests/ -q
uv run pytest tests/enterprise -q            # enterprise layer only
cd dashboard && npm run build                # serve dashboard/dist, not the source root
docker build --target aegra -t app:aegra -f Dockerfile.aegra .
docker build -t app:admin -f Dockerfile.admin-api .
```

`Dockerfile` (dev, `langgraph dev`) is only used with `--target langgraph-dev`. All Dockerfiles run `uv sync --frozen` and need `uv.lock` committed.

## Troubleshooting

- **No traces in Langfuse:** check `LANGFUSE_BASE_URL` reachability, that the key pair matches the bootstrap keys, and `OTEL_TARGETS=LANGFUSE`. Both compose files must be started in one invocation (or share an external network). Check `docker compose logs agent-server | grep -i otel`.
- **`ModuleNotFoundError: aegra`:** add it to `pyproject.toml`, run `uv lock`, rebuild.
- **`uv sync --frozen` fails:** commit `uv.lock`.
- **`asyncpg` / `aiosqlite` missing:** `uv add asyncpg` (Postgres) or `uv add aiosqlite` (SQLite).
- **Alembic cannot find the URL:** set `ALEMBIC_DATABASE_URL`.
- **Approve buttons disabled:** you are signed in with the shared admin token. Use a named user token.
- **Workflow fails at a parse step:** the model returned non-JSON. Use a stronger model, tighten the pack prompt, or add `retries`.
- **Connector calls refused:** add the host to `EGRESS_ALLOWED_HOSTS`.
- **Ollama unreachable on Linux:** run Ollama with `OLLAMA_HOST=0.0.0.0`.
- **Blank dashboard or 404 assets:** nginx must serve `dashboard/dist`.
- **`agent-server` flaps unhealthy at start:** raise `start_period` to `60s`.
- **Port 3000 clash:** the `agent-kit` example and Langfuse both use it; run one.

## Security and data

- Tenant and agent access derive from API keys or token claims; request-supplied IDs must match.
- Publishable keys can be limited by origin and rate. The current rate limiter is per process; use Redis for multi-worker limits.
- Replace `postgres:postgres` / `aegra:aegra` defaults and every Langfuse `# CHANGEME` before exposing anything. A remaining placeholder in a running deployment is a security incident.
- Bind internal services (`registry-db`, `aegra-postgres`, ClickHouse) to `127.0.0.1` and put a reverse proxy in front of anything public.
- Back up `registry_db_data`, `aegra_postgres_data`, `qdrant_data` and the Langfuse volumes. Never commit `.env`, database files or runtime data.
- Review `docs/BACKEND_REVIEW.md` before production, especially JWT verification and FAISS deserialization.

**Not built yet:** data retention and legal hold, subject access and erasure across all stores, customer-managed encryption keys, Redis rate limiting, Helm packaging. `/enterprise/compliance/capabilities` reports these honestly.