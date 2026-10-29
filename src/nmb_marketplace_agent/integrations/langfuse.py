"""Thin async client for the Langfuse public API (self-hosted or cloud).

Only what the dashboard needs: health, traces, usage metrics, prompt management,
datasets/experiments and scores. Verify paths against http://<langfuse>/api/public/openapi
for the version you run.
"""
import asyncio
import logging
from typing import Any
from urllib.parse import quote

import httpx

from nmb_marketplace_agent.integrations import connections

log = logging.getLogger(__name__)


class LangfuseError(Exception):
    pass


def _clean(params: dict) -> dict:
    return {k: v for k, v in params.items() if v not in (None, "")}


class LangfuseAPI:
    def __init__(self, host: str, public_key: str, secret_key: str, public_url: str | None = None,
                 transport: httpx.AsyncBaseTransport | None = None):
        self.host = host.rstrip("/")
        self.public_url = (public_url or host).rstrip("/")
        self._auth = (public_key, secret_key)
        self._transport = transport
        self._project_id: str | None = None

    async def _req(self, method: str, path: str, *, params: dict | None = None, json: Any = None,
                   auth: bool = True) -> Any:
        try:
            async with httpx.AsyncClient(base_url=self.host, timeout=20, transport=self._transport,
                                         auth=self._auth if auth else None) as c:
                r = await c.request(method, path, params=params, json=json)
        except httpx.HTTPError as e:
            raise LangfuseError(f"Cannot reach Langfuse at {self.host}: {type(e).__name__}") from e
        if r.status_code >= 400:
            raise LangfuseError(f"Langfuse {r.status_code}: {r.text[:300]}")
        return r.json() if r.content else None

    # ---- health & links ----
    async def health(self) -> dict:
        return await self._req("GET", "/api/public/health", auth=False)

    async def check_auth(self) -> None:
        """Raises if the key pair is wrong."""
        await self._req("GET", "/api/public/projects")

    async def project_id(self) -> str | None:
        if self._project_id is None:
            try:
                data = await self._req("GET", "/api/public/projects")
                self._project_id = (data.get("data") or [{}])[0].get("id") or ""
            except LangfuseError:
                self._project_id = ""
        return self._project_id or None

    async def console_url(self, kind: str, ident: str = "") -> str:
        pid = await self.project_id()
        tail = f"/{kind}/{quote(ident, safe='')}" if ident else f"/{kind}"
        if pid:
            return f"{self.public_url}/project/{pid}{tail}"
        return f"{self.public_url}/trace/{ident}" if kind == "traces" and ident else self.public_url

    # ---- observability ----
    async def traces(self, **params: Any) -> dict:
        return await self._req("GET", "/api/public/traces", params=_clean(params))

    async def trace(self, trace_id: str) -> dict:
        return await self._req("GET", f"/api/public/traces/{quote(trace_id, safe='')}")

    async def daily_metrics(self, **params: Any) -> dict:
        return await self._req("GET", "/api/public/metrics/daily", params=_clean(params))

    # ---- prompts ----
    async def prompts(self, **params: Any) -> dict:
        return await self._req("GET", "/api/public/v2/prompts", params={"limit": 100, **_clean(params)})

    async def prompt(self, name: str, label: str | None = None, version: int | None = None) -> dict:
        params: dict[str, Any] = {}
        if version is not None:
            params["version"] = version
        elif label:
            params["label"] = label
        return await self._req("GET", f"/api/public/v2/prompts/{quote(name, safe='')}", params=params)

    async def create_prompt(self, name: str, type_: str, prompt: Any, labels: list[str] | None = None,
                            config: dict | None = None, commit_message: str | None = None) -> dict:
        body = {"name": name, "type": type_, "prompt": prompt, "labels": labels or [],
                "config": config or {}, "commitMessage": commit_message}
        return await self._req("POST", "/api/public/v2/prompts", json=body)

    async def set_labels(self, name: str, version: int, labels: list[str]) -> dict:
        return await self._req("PATCH", f"/api/public/v2/prompts/{quote(name, safe='')}/versions/{version}",
                               json={"newLabels": labels})

    # ---- datasets / experiments / scores ----
    async def ensure_dataset(self, name: str, description: str = "") -> dict:
        return await self._req("POST", "/api/public/v2/datasets", json={"name": name, "description": description})

    async def upsert_item(self, dataset: str, item_id: str, input_: Any, expected: Any = None,
                          metadata: dict | None = None) -> dict:
        return await self._req("POST", "/api/public/dataset-items", json={
            "datasetName": dataset, "id": item_id, "input": input_,
            "expectedOutput": expected, "metadata": metadata or {}})

    async def run_item(self, run_name: str, item_id: str, trace_id: str, metadata: dict | None = None) -> dict:
        return await self._req("POST", "/api/public/dataset-run-items", json={
            "runName": run_name, "datasetItemId": item_id, "traceId": trace_id, "metadata": metadata or {}})

    async def score(self, trace_id: str, name: str, value: float, comment: str | None = None) -> dict:
        return await self._req("POST", "/api/public/scores", json={
            "traceId": trace_id, "name": name, "value": value, "comment": comment, "dataType": "NUMERIC"})

    async def find_trace_by_session(self, session_id: str, tries: int = 6, delay: float = 2.0) -> str | None:
        """Traces are ingested asynchronously, so retry for a few seconds."""
        for i in range(tries):
            try:
                rows = (await self.traces(sessionId=session_id, limit=1)).get("data") or []
                if rows:
                    return rows[0]["id"]
            except LangfuseError:
                pass
            if i < tries - 1:
                await asyncio.sleep(delay)
        return None


def client() -> LangfuseAPI | None:
    c = connections.get("langfuse")
    if not (c.get("host") and c.get("public_key") and c.get("secret_key")):
        return None
    return LangfuseAPI(c["host"], c["public_key"], c["secret_key"], c.get("public_url"))


# ---- helpers used by feedback and evals ----
async def push_feedback(thread_id: str, rating: str, comment: str | None) -> None:
    lf = client()
    if not lf or not thread_id:
        return
    try:
        trace_id = await lf.find_trace_by_session(thread_id)
        if trace_id:
            await lf.score(trace_id, "user-feedback", 1.0 if rating == "up" else 0.0, comment)
    except Exception:
        log.exception("Could not push feedback to Langfuse")


async def push_eval_run(dataset_name: str, run_name: str, items: list[dict]) -> str:
    """items: {case_id, input, expected, thread_id, score, reason}. Returns a status string."""
    lf = client()
    if not lf:
        return "langfuse not connected"
    try:
        await lf.ensure_dataset(dataset_name, "Synced from the NMB dashboard")
        sem = asyncio.Semaphore(4)

        async def one(it: dict) -> bool:
            async with sem:
                await lf.upsert_item(dataset_name, it["case_id"], it["input"], it.get("expected"))
                if not it.get("thread_id"):
                    return False
                trace_id = await lf.find_trace_by_session(it["thread_id"])
                if not trace_id:
                    return False
                await lf.run_item(run_name, it["case_id"], trace_id)
                if it.get("score") is not None:
                    await lf.score(trace_id, "eval", float(it["score"]), it.get("reason"))
                return True

        linked = sum(await asyncio.gather(*[one(i) for i in items]))
        return f"synced {linked}/{len(items)} cases"
    except Exception as e:  # never fail the eval because Langfuse is down
        log.exception("Langfuse eval sync failed")
        return f"sync failed: {e}"[:200]