"""Meta WhatsApp Cloud API webhook (public by design, signature-checked)."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import PlainTextResponse

from nmb_marketplace_agent.enterprise import whatsapp as whatsapp_service

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/webhook", include_in_schema=False)
async def verify(request: Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token", "")
    challenge = request.query_params.get("hub.challenge", "")
    expected = whatsapp_service.verify_token()
    if not expected:
        raise HTTPException(503, "WHATSAPP_VERIFY_TOKEN is not set on the server")
    if mode == "subscribe" and token and token == expected:
        return PlainTextResponse(challenge or "ok")
    raise HTTPException(403, "Verification failed")


@router.post("/webhook", include_in_schema=False)
async def inbound(request: Request, background: BackgroundTasks):
    raw = await request.body()
    if not whatsapp_service.app_secret() and not whatsapp_service.unsigned_webhooks_allowed():
        raise HTTPException(503, "WHATSAPP_APP_SECRET is not set; refusing unsigned webhooks")
    if not whatsapp_service.verify_signature(raw, request.headers.get("x-hub-signature-256", "")):
        raise HTTPException(403, "Invalid signature")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(400, "Invalid JSON") from e
    background.add_task(whatsapp_service.process_payload, payload)
    return {"received": True}
