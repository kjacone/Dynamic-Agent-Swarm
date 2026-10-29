# NMB Marketplace Agent — Dashboard

React + Vite + TypeScript + Tailwind + shadcn-style components.
Talks only to the FastAPI admin API. Never holds provider keys.

## Run

```bash
cp .env.example .env   # optional; defaults to http://localhost:8000
npm install
npm run dev            # http://localhost:5173

## Status

All 11 tabs are implemented: Overview, Agents, Subagents, Prompts, Tools,
Knowledge, Models, Training, Evaluations, Observability, Settings.

Remaining polish (post-MVP, tracked in `docs/BACKEND_REVIEW.md`):

- PATCH endpoint for model editing (currently edit = delete + re-register).
- Stream tool/subagent events from `/v1/chat` (currently only token frames).
- Sparkline hover/zoom on the training loss chart.