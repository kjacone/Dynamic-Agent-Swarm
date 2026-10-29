# Docker dependencies for NMB Marketplace Agent

This directory holds the containerized dependencies. The FastAPI app and the
LangGraph server run **on the host** — none of these containers run your
application code. They provide models, a proxy, and the fine-tuning runner.

| Service | Image | Default? | GPU? | Purpose |
|---|---|---|---|---|
| `ollama` | `ollama/ollama` | yes | no | Local inference; the default "provider" |
| `litellm` | `ghcr.io/berriai/litellm` | no | no | Uniform OpenAI-compatible proxy over Anthropic / OpenAI / Google / Ollama / vLLM |
| `vllm` | `vllm/vllm-openai` | no | yes | Local inference, faster than Ollama on GPU |
| `trainer` | `hiyouga/llamafactory` | no | yes | Runs fine-tuning jobs from the dashboard |

Langfuse is **not** bundled here. Use its official compose (see below).

---

## Quick start — local inference with Ollama

```bash
docker compose up -d ollama
docker exec nmb-ollama ollama pull llama3.2
```


## Profiles

** Only what you need starts: **

```bash
docker compose up -d                                   # ollama
docker compose --profile litellm up -d                 # + LiteLLM
docker compose --profile vllm up -d                    # + vLLM
docker compose --profile training up -d                # + trainer
docker compose --profile litellm --profile vllm up -d  # combination
```

** Stop everything: **

```bash
docker compose --profile "*" down
```