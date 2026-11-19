"""External places a training job or its base model can live.

Cards report one of two states — ready, or the exact environment variables
that unlock it — so the console can explain what each provider is for instead
of showing a dead button.
"""
from __future__ import annotations

from typing import Any

import httpx

from nmb_marketplace_agent.integrations import provider_keys
from nmb_marketplace_agent.training import store

TIMEOUT = 15.0

PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "colab",
        "name": "Google Colab",
        "kind": "Free GPU notebook",
        "url": "https://colab.research.google.com/",
        "summary": "Run the exported LoRA notebook on a free T4 GPU under the client's Google account.",
        "env": [],
        "optional": True,
        "action": "colab",
        "steps": [
            "Open the Colab tab and pick a dataset",
            "Download the notebook",
            "Colab → File → Upload notebook",
            "Runtime → T4 GPU → Run all",
        ],
    },
    {
        "id": "kaggle",
        "name": "Kaggle",
        "kind": "GPU notebooks + dataset hub",
        "url": "https://www.kaggle.com/",
        "summary": "Free GPU/TPU sessions and a large dataset hub. The same LoRA notebook imports as a Kaggle notebook.",
        "env": ["KAGGLE_USERNAME", "KAGGLE_KEY"],
        "optional": True,
        "action": "notebook",
        "steps": [
            "Download the LoRA notebook from the Colab tab",
            "kaggle.com → Create → Notebook → File → Import notebook",
            "Settings → Accelerator → GPU T4 x2",
            "Run all — the dataset is embedded in the notebook",
        ],
    },
    {
        "id": "huggingface",
        "name": "Hugging Face",
        "kind": "Model + dataset hub",
        "url": "https://huggingface.co/",
        "summary": "Base models to fine-tune and LoRA adapters to share. Search Hub datasets in the Sources tab.",
        "env": ["HF_TOKEN"],
        "optional": True,
        "action": "sources",
        "steps": [
            "Search datasets in Sources",
            "Preview and import the rows",
            "Pick a Hub base model in Jobs",
            "Add HF_TOKEN in API keys to use private or gated repos",
        ],
    },
    {
        "id": "cerebras",
        "name": "Cerebras",
        "kind": "Fast cloud inference",
        "url": "https://cloud.cerebras.ai/",
        "summary": "Hosted Llama/Qwen inference at very high speed — no GPU to provision. Inference only; fine-tunes still run on Colab, Kaggle or the trainer.",
        "env": ["CEREBRAS_API_KEY"],
        "optional": False,
        "action": "check",
        "steps": [
            "Create a key at cloud.cerebras.ai",
            "Add CEREBRAS_API_KEY in API keys",
            "Press Check connection",
        ],
    },
]


def _state(prov: dict[str, Any]) -> dict[str, str]:
    envs = prov.get("env") or []
    if not envs or (prov.get("optional") and not all(provider_keys.get(e) for e in envs)):
        return {"state": "ready", "label": "Ready", "detail": "Links and notebooks need no key." if not envs
                else f"Usable now; set {', '.join(envs)} for the full integration."}
    if all(provider_keys.get(e) for e in envs):
        return {"state": "ready", "label": "Connected", "detail": f"Using {', '.join(envs)}."}
    return {"state": "needs_key", "label": "Key needed",
            "detail": f"Add {', '.join(envs)} in API keys (Providers tab) or .env."}


def list_providers() -> dict[str, Any]:
    items = []
    for prov in PROVIDERS:
        item = {k: v for k, v in prov.items() if k not in ("env", "optional")}
        item["connection"] = _state(prov)
        item["needs"] = list(prov.get("env") or [])
        items.append(item)
    return {"providers": items}


async def check(provider_id: str) -> dict[str, Any]:
    if provider_id == "cerebras":
        key = provider_keys.get("CEREBRAS_API_KEY")
        if not key:
            raise store.TrainingError(
                "CEREBRAS_API_KEY is not set — add it in API keys (Providers tab) or .env.")
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False) as client:
                res = await client.get("https://api.cerebras.ai/v1/models",
                                       headers={"Authorization": f"Bearer {key}"})
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise store.TrainingError("Could not reach api.cerebras.ai.") from e
        if res.status_code in (401, 403):
            raise store.TrainingError("Cerebras rejected the key — create a new one at cloud.cerebras.ai.")
        if res.status_code != 200:
            raise store.TrainingError(f"Cerebras returned HTTP {res.status_code}.")
        try:
            models = [m.get("id") for m in res.json().get("data", []) if m.get("id")]
        except ValueError:
            models = []
        return {"state": "connected", "label": "Connected",
                "detail": f"{len(models)} models available.", "models": models[:12]}
    return {"state": "ready", "label": "Ready", "detail": "This provider needs no connection check."}
