"""Mock sanctions + core-banking APIs for local testing.  uv run uvicorn scripts.mock_bank:app --port 9001"""
from fastapi import FastAPI, Header, HTTPException

app = FastAPI()


def _auth(a: str):
    if not a.startswith("Bearer "):
        raise HTTPException(401)


@app.post("/v1/screen")
async def screen(body: dict, authorization: str = Header("")):
    _auth(authorization)
    hit = "sanction" in str(body.get("name", "")).lower()   # name containing "sanction" triggers a hit
    return {"hit": hit, "lists_checked": ["UN", "OFAC", "EU"], "name": body.get("name")}


@app.post("/customers")
async def create_customer(body: dict, authorization: str = Header("")):
    _auth(authorization)
    return {"customer_id": "CUST-" + str(abs(hash(str(body.get("name")))))[:6], "status": "created"}