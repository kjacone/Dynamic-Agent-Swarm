"""Public marketplace catalogue.

Marketing pages and prospective customers browse packs before they have a tenant or
a login. Only static pack metadata is exposed — no tenant install state, licence
details, prompts or policy internals.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from nmb_marketplace_agent.enterprise.solutions import loader, marketplace

router = APIRouter()

CACHE = "public, max-age=300"


@router.get("/marketplace")
async def public_catalog(response: Response):
    packs = loader.list_packs()
    response.headers["Cache-Control"] = CACHE
    return {"count": len(packs), "packs": packs}


@router.get("/marketplace/{solution_id}")
async def public_pack(solution_id: str, response: Response):
    try:
        pack = marketplace.pack_detail(solution_id)
    except loader.PackError as e:
        raise HTTPException(404, str(e)) from e
    response.headers["Cache-Control"] = CACHE
    return pack
