"""Image and video generation options.

Nothing is stored: a generation returns one media payload inline (base64 data
URL), or a four-frame storyboard for the sample video. Providers are live when
their key is present; otherwise the console offers the sample preview, clearly
labelled, so the flow can be demonstrated end to end.
"""
from __future__ import annotations

import base64
import html
import textwrap
import time
from typing import Any

import httpx

from nmb_marketplace_agent.integrations import provider_keys
from nmb_marketplace_agent.training import store

IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"]
VIDEO_DURATIONS = [4, 6, 8]
HF_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell"
HF_VIDEO_MODEL = "Lightricks/LTX-Video"

PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "sample",
        "name": "Sample preview",
        "kinds": ["image", "video"],
        "env": [],
        "model": "placeholder",
        "about": "No model call — shows the exact layout with a labelled placeholder. Always available.",
    },
    {
        "id": "openai",
        "name": "OpenAI Images",
        "kinds": ["image"],
        "env": ["OPENAI_API_KEY"],
        "model": "gpt-image-1",
        "about": "High-quality text-to-image through the OpenAI Images API.",
    },
    {
        "id": "huggingface",
        "name": "Hugging Face Inference",
        "kinds": ["image", "video"],
        "env": ["HF_TOKEN"],
        "model": HF_IMAGE_MODEL,
        "about": "Open models (FLUX for images, LTX-Video for video) served by Hugging Face.",
    },
]


def _has(name: str) -> bool:
    return bool(provider_keys.get(name))


def _configured(prov: dict[str, Any]) -> bool:
    return prov["id"] == "sample" or all(_has(e) for e in prov["env"])


def options() -> dict[str, Any]:
    def shape(prov: dict[str, Any]) -> dict[str, Any]:
        ready = _configured(prov)
        return {
            "id": prov["id"], "name": prov["name"], "model": prov["model"], "about": prov["about"],
            "configured": ready,
            "needs": list(prov["env"]),
            "note": "Live" if ready and prov["id"] != "sample" else (
                "Sample — no model call" if prov["id"] == "sample" else f"Set {', '.join(prov['env'])} in API keys"),
        }
    return {
        "image": [shape(p) for p in PROVIDERS if "image" in p["kinds"]],
        "video": [shape(p) for p in PROVIDERS if "video" in p["kinds"]],
        "sizes": IMAGE_SIZES,
        "durations": VIDEO_DURATIONS,
    }


async def generate(body: dict[str, Any]) -> dict[str, Any]:
    kind = str(body.get("kind") or "image").lower()
    if kind not in ("image", "video"):
        raise store.TrainingError("kind must be image or video")
    provider = str(body.get("provider") or "sample").lower()
    prov = next((p for p in PROVIDERS if p["id"] == provider), None)
    if not prov or kind not in prov["kinds"]:
        raise store.TrainingError(f"Provider '{provider}' cannot generate {kind}s.")
    prompt = str(body.get("prompt") or "").strip()
    if len(prompt) < 3:
        raise store.TrainingError("Describe what to generate (at least 3 characters).")
    if len(prompt) > 1000:
        raise store.TrainingError("Keep the prompt under 1000 characters.")
    size = str(body.get("size") or IMAGE_SIZES[0])
    if size not in IMAGE_SIZES:
        raise store.TrainingError(f"size must be one of {IMAGE_SIZES}")
    duration = int(body.get("duration") or VIDEO_DURATIONS[0])
    if duration not in VIDEO_DURATIONS:
        raise store.TrainingError(f"duration must be one of {VIDEO_DURATIONS}")
    if provider != "sample" and not _configured(prov):
        raise store.TrainingError(f"{prov['name']} is not configured — set {', '.join(prov['env'])} in API keys, or use the sample preview.")

    started = time.monotonic()
    if provider == "sample":
        result = _sample(kind, prompt, size, duration)
    elif provider == "openai":
        result = await _openai_image(prompt, size)
    else:
        result = await _hf(kind, prompt, size, duration)
    result.update({"kind": kind, "prompt": prompt, "elapsed_ms": int((time.monotonic() - started) * 1000)})
    return result


async def _openai_image(prompt: str, size: str) -> dict[str, Any]:
    key = provider_keys.get("OPENAI_API_KEY") or ""
    async with httpx.AsyncClient(timeout=120, trust_env=False) as client:
        res = await client.post(
            "https://api.openai.com/v1/images/generations",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": "gpt-image-1", "prompt": prompt, "size": size, "n": 1},
        )
    if res.status_code >= 400:
        raise store.TrainingError(f"OpenAI returned HTTP {res.status_code}: {_provider_message(res)}")
    try:
        item = (res.json().get("data") or [{}])[0]
    except ValueError as e:
        raise store.TrainingError("OpenAI returned an unreadable payload.") from e
    if item.get("b64_json"):
        uri = "data:image/png;base64," + item["b64_json"]
    elif item.get("url"):
        uri = str(item["url"])
    else:
        raise store.TrainingError("OpenAI returned no image.")
    return {"provider": "openai", "model": "gpt-image-1", "mime": "image/png",
            "data_url": uri, "frames": [], "sample": False,
            "note": "Generated by OpenAI gpt-image-1."}


async def _hf(kind: str, prompt: str, size: str, duration: int) -> dict[str, Any]:
    token = provider_keys.get("HF_TOKEN") or ""
    model = HF_IMAGE_MODEL if kind == "image" else HF_VIDEO_MODEL
    width, height = (int(x) for x in size.split("x"))
    params: dict[str, Any] = {"width": width, "height": height} if kind == "image" else {"num_frames": max(49, duration * 12)}
    async with httpx.AsyncClient(timeout=240, follow_redirects=True, trust_env=False) as client:
        res = await client.post(f"https://api-inference.huggingface.co/models/{model}",
                                headers={"Authorization": f"Bearer {token}", "Accept": "*/*"},
                                json={"inputs": prompt, "parameters": params})
    if res.status_code >= 400:
        raise store.TrainingError(
            f"Hugging Face returned HTTP {res.status_code} for {model}: {_provider_message(res)}"
        )
    mime = (res.headers.get("content-type") or ("image/png" if kind == "image" else "video/mp4")).split(";")[0]
    if not mime.startswith(("image/", "video/")):
        raise store.TrainingError("Hugging Face returned a non-media response — this model may be unavailable on Inference.")
    encoded = base64.b64encode(res.content).decode()
    return {"provider": "huggingface", "model": model, "mime": mime,
            "data_url": f"data:{mime};base64,{encoded}", "frames": [], "sample": False,
            "note": f"Generated by {model} on Hugging Face Inference."}


def _provider_message(res: httpx.Response) -> str:
    try:
        payload = res.json()
        if isinstance(payload, dict):
            return str(payload.get("error") or payload.get("message") or payload)[:300]
        return str(payload)[:300]
    except ValueError:
        return (res.text or res.reason_phrase)[:300]


def _sample(kind: str, prompt: str, size: str, duration: int) -> dict[str, Any]:
    if kind == "image":
        svg = _svg(prompt, size, "SAMPLE PREVIEW")
        return {"provider": "sample", "model": "placeholder", "mime": "image/svg+xml",
                "data_url": _data_url(svg), "frames": [], "sample": True,
                "note": "Sample preview — connect OpenAI or Hugging Face for a real image."}
    frames = [_data_url(_svg(prompt, "1024x1024", f"SAMPLE FRAME {i + 1}/4", i, duration)) for i in range(4)]
    return {"provider": "sample", "model": "placeholder", "mime": "image/svg+xml",
            "data_url": frames[0], "frames": frames, "sample": True,
            "note": f"Sample {duration}s storyboard (4 stills) — add HF_TOKEN in API keys for a real video."}


def _data_url(svg: str) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _svg(prompt: str, size: str, badge: str, frame: int = 0, duration: int = 4) -> str:
    width, height = (int(x) for x in size.split("x"))
    palettes = [
        ("#4338ca", "#0ea5e9", "#f59e0b"),
        ("#0f766e", "#6366f1", "#f472b6"),
        ("#7c2d12", "#db2777", "#22d3ee"),
        ("#1e3a8a", "#16a34a", "#eab308"),
    ]
    a, b, c = palettes[frame % len(palettes)]
    lines = textwrap.wrap(prompt, 34)[:6] or ["—"]
    text = "\n".join(
        f'<text x="64" y="{height - 250 + i * 40}" font-family="ui-sans-serif, system-ui" '
        f'font-size="30" fill="rgba(255,255,255,0.92)">{html.escape(line)}</text>'
        for i, line in enumerate(lines)
    )
    progress = (frame + 1) / 4
    bar = (
        f'<rect x="64" y="{height - 90}" width="{width - 128}" height="8" rx="4" fill="rgba(255,255,255,0.22)"/>'
        f'<rect x="64" y="{height - 90}" width="{(width - 128) * progress:.0f}" height="8" rx="4" fill="rgba(255,255,255,0.9)"/>'
    ) if frame or duration else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{a}"/><stop offset="0.55" stop-color="{b}"/><stop offset="1" stop-color="{c}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.28" r="0.75">
      <stop offset="0" stop-color="rgba(255,255,255,0.38)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <circle cx="{width * 0.78:.0f}" cy="{height * 0.26:.0f}" r="{width * 0.16:.0f}" fill="rgba(255,255,255,0.18)"/>
  <rect x="64" y="64" rx="18" width="{8 + len(badge) * 17}" height="48" fill="rgba(15,23,42,0.5)"/>
  <text x="82" y="96" font-family="ui-monospace, monospace" font-size="20" letter-spacing="2" fill="#fff">{html.escape(badge)}</text>
  {text}
  {bar}
</svg>"""
