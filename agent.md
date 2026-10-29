# NMB Marketplace Agent — working notes

Handoff file: what the project is, what has been done, what is pending. Update it as work lands.

## What the project is
A multi-tenant platform for building, running and managing LLM agents.

- **Runtime**: DeepAgents graphs served by the LangGraph server (`langgraph dev`). The graph is rebuilt per run from DB
  config (`graph_factory.make_graph`): agent model, system prompt, tools, RAG collections, subagents.
- **API** (FastAPI, `api/main.py`): admin CRUD for the dashboard (bearer `ADMIN_TOKEN`), plus a public API
  (`/v1/chat`, `/v1/feedback`, `/v1/lg/*` proxy) authenticated by per-agent API keys. The key, never the request, picks agent and tenant.
- **Data**: SQLModel (SQLite by default) for agents, tools, RAG collections, subagents, models, API keys, versions, evals, feedback.
  FAISS indexes under `data/indexes`. Training files under `data/training`.
- **Clients**: `static/embed.js` chat widget, Python/TS SDKs, and the new React dashboard.

## Design rule for this refactor
Do not rebuild what existing Docker images already do:

| Need | Use | Our code only does |
|---|---|---|
| Tracing, prompt registry, datasets/experiments, scores, cost | **Langfuse** (official docker compose) | connect, read, deep-link, push scores |
| Local inference | **Ollama** (`ollama/ollama`); optional **vLLM**, **LiteLLM** | list, pull, register, test |
| Fine-tuning | **LLaMA-Factory** (`hiyouga/llamafactory`) | build datasets, write configs, queue jobs, show progress |
| Public/custom models | existing `ModelConfig` registry (provider + base_url) | unchanged |

## Interconnection (dashboard <-> Langfuse <-> agents)
- Connection details are edited in the dashboard and saved to `data/connections.json` (chmod 600, secrets masked in the UI).
  The API and the LangGraph process both read it, so tracing starts without a restart.
- Agent `system_prompt` may be `langfuse:<name>[:label]` or `langfuse:<name>@<version>`; resolved at run time, cached 30 s, falls back safely.
- `graph_factory` tags traces with session (thread id), user, tenant, agent and version.
- Feedback (thumbs) and eval results become Langfuse scores / dataset runs, linked by looking up the trace by session id.

## Done
Files are 
Backend, new:
- `config/settings.py` (training + prompt-cache settings)
- `integrations/connections.py`, `integrations/langfuse.py`
- `observability.py` (rewritten), `prompts/render.py`, `prompts/resolver.py`
- `rag/embeddings.py` (OpenAI-compatible + Ollama), `rag/retriever.py` (+`load_store`)
- `llm/playground.py`, `training/store.py`
- routers: `system`, `observability`, `prompts`, `inference`, `training`

Backend, replacing existing files (security/bug fixes):
- `api/routes/public.py` (key decides agent; records `ThreadOwner`; JSON for embed.js, SSE on request; real token streaming)
- `api/routes/manifest.py` (was unauthenticated; now key-scoped)
- `api/main.py` (new routers, serves dashboard at `/app/`, old portal at `/legacy`)
- `api/routes/rag.py` (upload path-traversal fix, documents, reindex, retrieval query tester)
- `api/routes/tools.py` (schema + test-run endpoints)
- `api/routes/feedback.py` (pushes scores to Langfuse)

Verification so far: `py_compile` on the training store and the five new routers. Nothing has run against a live server.

## Pending
1. Backend call 2: `evals.py` (sync to Langfuse), `graph_factory.py` (Langfuse prompt refs + tracing),
   fixed imports in `scripts/seed.py`, `scripts/init_db.py`, `tests/*` (+ `ANTHROPIC_API_KEY` stub in `conftest.py`), delete root `agent.py`,
   `.env.example` (no secrets), `docker-compose.yml`, `docker/trainer/runner.py`, `docker/litellm/config.yaml`, `docker/README.md`,
   `docs/BACKEND_REVIEW.md`.
2. Dashboard (`dashboard/`, React + Vite + TS + Tailwind + shadcn-style components). Pages: Overview (service topology strip),
   Agents (+test chat), Subagents, Prompts (+multi-model playground), Tools (+test run), Knowledge (+retrieval tester),
   Models (registry, Ollama pull, inference playground), Training, Evaluations, Observability, Settings (connections, API keys, embed snippet).
3. One `tsc` + `vite build` check, two or three pure-function tests, zip, final summary.

## Known risks / things to verify
- Langfuse endpoint shapes were written from memory; check against `http://<langfuse>/api/public/openapi` for the deployed version.
- The Langfuse Python SDK call `CallbackHandler(public_key=...)` assumes the v3+ API.
- Training needs an NVIDIA GPU; it will not run on a Mac. Everything else works locally.
- LLaMA-Factory config keys and `trainer_log.jsonl` fields follow its example configs; confirm for the image version you pull.
- Secrets: the `.env` shared earlier contained live keys. They must be rotated; keep `.env` out of git and out of chats.
- Smaller findings not auto-fixed are listed in `docs/BACKEND_REVIEW.md` (cross-tenant tool ids on agents, unused JWT minting, per-process rate limiter).

## Conventions
- Python imports always use the `nmb_marketplace_agent.` prefix (scripts/tests previously did not, and broke).
- Tenant scoping: every admin route takes `tenant_id` and checks it on the row.
- Never accept `agent_id`/`tenant_id`/`configurable` from a public client.
- Dashboard talks only to the FastAPI admin API; it never holds provider keys.


##  Area	Files
- Config	settings.py, plus connections.py. Connection details are saved from the dashboard to data/connections.json, and both the API and the LangGraph process read it.
- Langfuse bridge	integrations/langfuse.py covers health, traces, daily usage, prompts and labels, datasets, run items, and scores. It also has helpers to push feedback and eval runs. observability.py was rewritten for tracing.
- Prompts	render.py renders {{vars}}. resolver.py lets an agent’s system prompt be langfuse:name:label, cached with a fallback.
- RAG	embeddings.py now supports Ollama and OpenAI-compatible servers. retriever.py gained load_store.
- Playground	llm/playground.py runs one chat against any registered or custom model.
- Training	training/store.py handles datasets in LLaMA-Factory format, jobs, loss series, logs, and cancel.
- New routers	system, observability, prompts, inference and training. Only training/store.py and these five routers have been syntax-checked with py_compile.
Pending

Backend replacements. Each of these is a full file replacement of yours.

public.py: the key’s agent is ignored today, so any key can chat with any agent. Threads aren’t recorded, so feedback always 404s. The token filter never matches, so no tokens stream. embed.js expects JSON while this route returns SSE.
manifest.py: the route is public because of a missing import, so I’ll scope it to the API key.
main.py: mount the new routers and serve the dashboard.
rag.py: fix the upload filename path traversal, and add document listing and a retrieval query tester.
tools.py: add a schema endpoint and a test-run endpoint.
feedback.py: push scores to Langfuse.
evals.py: sync runs to Langfuse datasets.
graph_factory.py: resolve Langfuse prompt refs and use the new tracing.
Broken imports in scripts/seed.py, init_db.py and the tests, plus a bogus root agent.py. The tests also need an ANTHROPIC_API_KEY stub in conftest.py.
.env.example, and docs/BACKEND_REVIEW.md listing every finding, including the smaller ones like cross-tenant tool ids and the unused JWT.

Infra.

docker-compose.yml with Ollama by default, and optional LiteLLM, vLLM and trainer profiles.
docker/trainer/runner.py, which polls the job queue and runs llamafactory-cli train.
A short README pointing at Langfuse’s official compose, which I’m not copying.

Dashboard (not started). React, Vite, TypeScript, Tailwind and shadcn-style components. Pages:

Overview with the service-topology strip
Agents, with a test chat
Subagents
Prompts, with a multi-model playground
Tools, with a test run
Knowledge, with a retrieval tester
Models: registry, Ollama pull, and an inference playground
Training
Evaluations
Observability, with traces and feedback
Settings: connections, API keys and embed snippet

Wrap-up. One build check, the zip, and the final summary.

Plan to save tokens
Write the remaining backend in two calls, with no further per-file verification.
Write the dashboard in about five calls, with one tsc and vite build pass at the end.
Skip unit tests beyond a couple of pure-function checks.
Risks I’ll flag in the summary
The Langfuse endpoint shapes are from memory, so check them against your instance’s /api/public/openapi.
Training needs an NVIDIA GPU, so it won’t run on your Mac. Everything else works locally.
None of the backend has run against a live server.