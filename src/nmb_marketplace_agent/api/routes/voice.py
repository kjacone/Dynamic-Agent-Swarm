"""ElevenLabs voice bridge.

One key, three consumers: the Localisation lab previews a dialect's voice, the
Voice line speaks replies in that dialect, and the agent-kit phone component
uses the same endpoints for real-time calls and turn-by-turn recording. The key
comes from the dashboard key store first, then the environment; it never reaches
the browser.
"""
from __future__ import annotations

import secrets
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.integrations import provider_keys
from nmb_marketplace_agent.locale.models import LocaleProfile

router = APIRouter()
# The one-time play URL is opened by an <audio> element, which cannot send the
# admin token; it is mounted without the admin dependency in api/main.py.
play_router = APIRouter()

KEY_ENV = "ELEVENLABS_API_KEY"
VOICE_ENV = "ELEVENLABS_VOICE_ID"
API_BASE = "https://api.elevenlabs.io/v1"

MODELS: tuple[dict[str, Any], ...] = (
    {"id": "eleven_multilingual_v2", "label": "Multilingual v2",
     "detail": "Best quality; 29 languages, including Swahili. Default for customer calls."},
    {"id": "eleven_turbo_v2_5", "label": "Turbo v2.5",
     "detail": "Fast and cheap; 32 languages. Good for high call volumes."},
    {"id": "eleven_flash_v2_5", "label": "Flash v2.5",
     "detail": "Lowest latency (~75 ms models); 32 languages. Good for live interruptions."},
    {"id": "eleven_v3", "label": "v3 (alpha)",
     "detail": "Most expressive; 70+ languages. Check plan access before using in production."},
)

DEFAULTS = {"model_id": "eleven_multilingual_v2", "stability": 0.5, "similarity": 0.75,
            "style": 0.0, "speed": 1.0}

# Voices change rarely; avoid a provider round-trip on every page load.
_CACHE: dict[str, Any] = {"voices": None, "at": 0.0, "key_tail": ""}
_CACHE_TTL = 600

# Streamed playback needs a GET URL an <audio> element can open, but the
# dashboard token must not travel in a URL. A one-time ticket is minted over
# the authenticated POST and burned when the audio element opens it.
_TICKETS: dict[str, dict] = {}
_TICKET_TTL = 90.0

CLONE_MAX_FILES = 3
CLONE_MAX_BYTES = 10 * 1024 * 1024
CLONE_TYPES = ("audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4",
               "audio/x-m4a", "audio/webm", "audio/ogg")


def _key() -> str | None:
    return provider_keys.get(KEY_ENV)


def _require_key() -> str:
    key = _key()
    if not key:
        raise HTTPException(
            424, "No ElevenLabs key saved yet. Add one under Localisation → Voice "
                 "(or set ELEVENLABS_API_KEY on the server).")
    return key


async def _call(path: str, *, method: str = "GET", json: dict | None = None,
                files: dict | None = None, data: dict | None = None,
                params: dict | None = None, timeout: float = 40) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.request(method, f"{API_BASE}{path}",
                                       headers={"xi-api-key": _require_key()},
                                       json=json, files=files, data=data, params=params)
    except httpx.TimeoutException:
        raise HTTPException(504, "ElevenLabs did not answer in time; try again.")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"ElevenLabs is unreachable ({type(e).__name__}).")
    if res.status_code >= 400:
        detail = res.text.strip()[:300] or res.reason_phrase
        code = 401 if res.status_code == 401 else 400 if res.status_code < 500 else 502
        hint = " The saved key may be invalid or out of credits." if res.status_code == 401 else ""
        raise HTTPException(code, f"ElevenLabs answered HTTP {res.status_code}: {detail}{hint}")
    return res


def _voice_view(raw: dict) -> dict:
    labels = raw.get("labels") if isinstance(raw.get("labels"), dict) else {}
    return {
        "voice_id": raw.get("voice_id", ""),
        "name": raw.get("name", ""),
        "category": raw.get("category", ""),
        "gender": labels.get("gender", ""),
        "accent": labels.get("accent", ""),
        "language": labels.get("language", ""),
        "description": labels.get("description", ""),
        "preview_url": raw.get("preview_url") or "",
    }


def _shared_view(raw: dict) -> dict:
    labels = raw.get("labels") if isinstance(raw.get("labels"), dict) else {}
    return {
        "voice_id": raw.get("voice_id", ""),
        "public_owner_id": raw.get("public_owner_id", ""),
        "name": raw.get("name", ""),
        "category": raw.get("category", "professional"),
        "gender": raw.get("gender") or labels.get("gender", ""),
        "accent": raw.get("accent") or labels.get("accent", ""),
        "age": raw.get("age") or labels.get("age", ""),
        "use_case": raw.get("use_case") or labels.get("use_case", ""),
        "language": raw.get("language") or labels.get("language", ""),
        "description": (raw.get("description") or labels.get("description", ""))[:220],
        "preview_url": raw.get("preview_url") or "",
    }


async def _voices(refresh: bool = False) -> list[dict]:
    key = _require_key()
    fresh = (_CACHE["voices"] is not None and not refresh
             and _CACHE["key_tail"] == key[-6:] and time.time() - _CACHE["at"] < _CACHE_TTL)
    if fresh:
        return _CACHE["voices"]
    res = await _call("/voices")
    raw = res.json().get("voices") or []
    voices = sorted((_voice_view(v) for v in raw if isinstance(v, dict)),
                    key=lambda v: (v["category"] == "premade", v["name"].lower()))
    _CACHE.update({"voices": voices, "at": time.time(), "key_tail": key[-6:]})
    return voices


def _settings(body: dict, speech: dict) -> dict:
    def num(name: str) -> float:
        value = body.get(name)
        if value is None:
            value = speech.get(name)
        try:
            return float(DEFAULTS[name] if value is None else value)
        except (TypeError, ValueError):
            return float(DEFAULTS[name])

    return {
        "stability": num("stability"),
        "similarity_boost": num("similarity"),
        "style": num("style"),
        "speed": num("speed"),
        "use_speaker_boost": True,
    }


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    profile_id: str | None = None
    voice_id: str | None = None
    model_id: str | None = None
    stability: float | None = None
    similarity: float | None = None
    style: float | None = None
    speed: float | None = None


async def _speech_profile(db: AsyncSession, profile_id: str | None) -> dict:
    if not profile_id:
        return {}
    profile = await db.get(LocaleProfile, profile_id)
    if profile is None:
        raise HTTPException(404, "Unknown locale profile")
    return profile.speech if isinstance(profile.speech, dict) else {}


@router.get("/status")
async def voice_status():
    """Key source, plan usage and cache state. Safe to poll; never returns the key."""
    configured = bool(_key())
    out: dict[str, Any] = {
        "provider": "elevenlabs",
        "configured": configured,
        "source": provider_keys.source(KEY_ENV),
        "models": [dict(m) for m in MODELS],
        "defaults": dict(DEFAULTS),
        "default_voice_id": (provider_keys.get(VOICE_ENV) or "") if configured else "",
        "voices_cached": len(_CACHE["voices"] or []),
        "checked": False,
        "subscription": None,
        "detail": "" if configured else "Save an ElevenLabs key to enable voice.",
    }
    if not configured:
        return out
    try:
        res = await _call("/user/subscription", timeout=6)
        sub = res.json()
        used, limit = sub.get("character_count"), sub.get("character_limit")
        out.update({
            "checked": True,
            "subscription": {
                "tier": sub.get("tier", ""),
                "status": sub.get("status", ""),
                "characters_used": used,
                "character_limit": limit,
                "characters_left": (limit - used) if isinstance(used, int) and isinstance(limit, int) else None,
            },
            "detail": f"{sub.get('tier', 'plan')} · {used}/{limit} characters used"
                      if used is not None else "Connected",
        })
    except HTTPException as e:
        out["detail"] = str(e.detail)
    return out


@router.get("/voices")
async def list_voices(refresh: bool = False):
    return {"voices": await _voices(refresh), "models": [dict(m) for m in MODELS],
            "defaults": dict(DEFAULTS)}


@router.get("/library")
async def voice_library(search: str = "", page: int = 0, page_size: int = 24,
                        category: str = "", gender: str = "", accent: str = ""):
    """Browse the shared ElevenLabs voice library (10,000+ voices)."""
    params: dict[str, Any] = {"page": max(0, page), "page_size": min(max(1, page_size), 50)}
    for name, value in (("search", search), ("category", category),
                        ("gender", gender), ("accent", accent)):
        if value.strip():
            params[name] = value.strip()
    res = await _call("/shared-voices", params=params, timeout=30)
    body = res.json()
    raw = body.get("voices") or []
    voices = [_shared_view(v) for v in raw if isinstance(v, dict) and v.get("voice_id")]
    return {"voices": voices, "page": params["page"], "has_more": bool(body.get("has_more")),
            "total": body.get("total_count") if isinstance(body.get("total_count"), int) else None,
            "search": search.strip()}


@router.post("/library/add")
async def add_shared_voice(body: dict):
    """Copy a shared library voice into the workspace so TTS can use it."""
    public_owner_id = str(body.get("public_owner_id") or "").strip()
    voice_id = str(body.get("voice_id") or "").strip()
    if not public_owner_id or not voice_id:
        raise HTTPException(400, "Choose a voice from the library first.")
    name = str(body.get("name") or "").strip()
    payload = {"new_name": name} if name else {}
    res = await _call(f"/voices/add/{public_owner_id}/{voice_id}", method="POST", json=payload)
    added = (res.json() or {}).get("voice_id") or voice_id
    _CACHE["voices"] = None
    return {"voice_id": added, "name": name or voice_id, "source_voice_id": voice_id}


@router.post("/clone")
async def clone_voice(name: str = Form(...), description: str = Form(""),
                      consent: bool = Form(False),
                      files: list[UploadFile] = File(...)):
    """Instant voice cloning from short recordings (ElevenLabs /voices/add)."""
    clean = name.strip()
    if not clean:
        raise HTTPException(400, "Give the cloned voice a name.")
    if len(clean) > 120:
        raise HTTPException(400, "Keep the voice name under 120 characters.")
    if not consent:
        raise HTTPException(400, "Confirm that you have the speaker's consent to clone this voice.")
    if not files:
        raise HTTPException(400, "Add at least one short recording (10 seconds is enough).")
    if len(files) > CLONE_MAX_FILES:
        raise HTTPException(400, f"Use at most {CLONE_MAX_FILES} sample files.")
    multipart: list[tuple[str, tuple[str, bytes, str]]] = []
    total = 0
    for item in files:
        blob = await item.read()
        if not blob:
            raise HTTPException(400, f"{item.filename or 'A sample'} is empty.")
        total += len(blob)
        ctype = (item.content_type or "").lower()
        fname = item.filename or "sample.mp3"
        suffix = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
        if ctype not in CLONE_TYPES and suffix not in ("mp3", "wav", "m4a", "mp4", "webm", "ogg"):
            raise HTTPException(400, f"{fname} is not audio. Upload MP3, WAV, M4A, WebM or OGG.")
        multipart.append(("files", (fname, blob, ctype or "audio/mpeg")))
    if total > CLONE_MAX_BYTES:
        raise HTTPException(413, "Keep the samples under 10 MB in total.")
    res = await _call("/voices/add", method="POST", files=multipart,
                      data={"name": clean, "description": description.strip()[:500]}, timeout=120)
    new_id = (res.json() or {}).get("voice_id") or ""
    if not new_id:
        raise HTTPException(502, "ElevenLabs accepted the samples but returned no voice.")
    _CACHE["voices"] = None
    return {"voice_id": new_id, "name": clean,
            "detail": "Cloned. Assign it to a dialect so calls speak in it."}


async def _resolve(body: TtsIn, speech: dict) -> tuple[str, str, dict]:
    voice_id = (body.voice_id or speech.get("voice_id")
                or provider_keys.get(VOICE_ENV) or "")
    if not voice_id:
        voices = await _voices()
        voice_id = voices[0]["voice_id"] if voices else ""
    if not voice_id:
        raise HTTPException(400, "No voice is set. Pick one in Localisation → Voice "
                                 "or pass a voice_id.")
    model_id = body.model_id or speech.get("model_id") or DEFAULTS["model_id"]
    payload = {"text": body.text, "model_id": model_id,
               "voice_settings": _settings(body.model_dump(), speech)}
    return voice_id, model_id, payload


@router.post("/tts")
async def text_to_speech(body: TtsIn, db: AsyncSession = Depends(get_db)):
    """Whole-file synthesis. Kept for callers that need a blob (datasets, proxies)."""
    speech = await _speech_profile(db, body.profile_id)
    voice_id, model_id, payload = await _resolve(body, speech)
    res = await _call(f"/text-to-speech/{voice_id}", method="POST", json=payload)
    return Response(content=res.content, media_type=res.headers.get("content-type", "audio/mpeg"),
                    headers={"X-Voice-Id": voice_id, "X-Model-Id": model_id,
                             "Cache-Control": "no-store"})


def _prune_tickets() -> None:
    now = time.time()
    for token in [k for k, v in _TICKETS.items() if v["exp"] < now]:
        _TICKETS.pop(token, None)


@router.post("/tts/ticket")
async def tts_ticket(body: TtsIn, db: AsyncSession = Depends(get_db)):
    """Mint a one-time, short-lived URL that streams audio while it is generated.

    An <audio> element cannot send an Authorization header, so the authenticated
    POST resolves the voice and settings here; the ticket only carries the result.
    """
    speech = await _speech_profile(db, body.profile_id)
    voice_id, model_id, payload = await _resolve(body, speech)
    _prune_tickets()
    token = secrets.token_urlsafe(24)
    _TICKETS[token] = {"payload": payload, "voice_id": voice_id, "model_id": model_id,
                       "exp": time.time() + _TICKET_TTL}
    return {"url": f"/voice/tts/play?ticket={token}", "voice_id": voice_id,
            "model_id": model_id, "expires_in": int(_TICKET_TTL),
            "characters": len(body.text)}


@play_router.get("/tts/play")
async def play_tts(ticket: str):
    """Stream the synthesis, passing provider chunks through as they arrive."""
    _prune_tickets()
    item = _TICKETS.pop(ticket, None)
    if item is None or item["exp"] < time.time():
        raise HTTPException(410, "This playback link expired. Press play again.")
    key = _require_key()
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=120.0))
    try:
        request = client.build_request(
            "POST", f"{API_BASE}/text-to-speech/{item['voice_id']}/stream",
            headers={"xi-api-key": key, "Accept": "audio/mpeg"},
            params={"output_format": "mp3_44100_128"}, json=item["payload"])
        upstream = await client.send(request, stream=True)
    except httpx.TimeoutException:
        await client.aclose()
        raise HTTPException(504, "ElevenLabs did not answer in time; try again.")
    except httpx.HTTPError as e:
        await client.aclose()
        raise HTTPException(502, f"ElevenLabs is unreachable ({type(e).__name__}).")
    if upstream.status_code >= 400:
        detail = (await upstream.aread())[:300].decode("utf-8", "replace").strip()
        await upstream.aclose()
        await client.aclose()
        code = 401 if upstream.status_code == 401 else 400 if upstream.status_code < 500 else 502
        hint = " The saved key may be invalid or out of credits." if upstream.status_code == 401 else ""
        raise HTTPException(code, f"ElevenLabs answered HTTP {upstream.status_code}: "
                                  f"{detail or upstream.reason_phrase}{hint}")

    async def chunks():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        chunks(),
        media_type=upstream.headers.get("content-type", "audio/mpeg"),
        headers={"X-Voice-Id": item["voice_id"], "X-Model-Id": item["model_id"],
                 "X-Stream": "elevenlabs", "Cache-Control": "no-store"})


@router.post("/stt")
async def speech_to_text(file: UploadFile = File(...), model_id: str = Form("scribe_v1"),
                         language_code: str = Form("")):
    """Turn-by-turn recording: one audio blob in, a transcript with a language back.

    The agent-kit phone component uses this to collect call audio for datasets.
    """
    audio = await file.read()
    if not audio:
        raise HTTPException(400, "The recording is empty.")
    if len(audio) > 25 * 1024 * 1024:
        raise HTTPException(413, "Keep a single recording under 25 MB (≈ 15 minutes).")
    data = {"model_id": model_id, "tag_audio_events": "false"}
    if language_code.strip():
        data["language_code"] = language_code.strip()
    res = await _call("/speech-to-text", method="POST", data=data,
                      files={"file": (file.filename or "turn.webm",
                                      audio, file.content_type or "audio/webm")})
    body = res.json()
    return {"text": (body.get("text") or "").strip(),
            "language_code": body.get("language_code") or "",
            "language_probability": body.get("language_probability"),
            "model_id": model_id}
