from __future__ import annotations

import asyncio
from typing import Any

import httpx

from nmb_marketplace_agent.enterprise.connectors.base import (
    Connector,
    ConnectorError,
    resolve_secret,
)


class RestConnector(Connector):
    """config: base_url, auth{type: none|bearer|basic|api_key, secret|user/password_ref, header},
    operations{name: {method, path, query?, body?}}, timeout_s, retries, mtls{cert, key, ca}"""
    type = "rest"

    def _auth(self) -> tuple[dict, httpx.Auth | None]:
        a = self.config.get("auth") or {}
        kind = a.get("type", "none")
        if kind == "bearer":
            return {"Authorization": f"Bearer {resolve_secret(a.get('secret'))}"}, None
        if kind == "api_key":
            return {a.get("header", "X-API-Key"): resolve_secret(a.get("secret")) or ""}, None
        if kind == "basic":
            return {}, httpx.BasicAuth(a.get("user", ""), resolve_secret(a.get("password_ref")) or "")
        return {}, None

    async def call(self, operation: str, params: dict[str, Any]) -> Any:
        ops = self.config.get("operations", {})
        if operation not in ops:
            raise ConnectorError(f"Operation '{operation}' is not defined on connector '{self.name}'")
        op = ops[operation]
        path = op.get("path", "").format(**{k: v for k, v in params.items() if isinstance(v, (str, int))})
        url = self.config["base_url"].rstrip("/") + "/" + path.lstrip("/")
        self.egress.check(url)
        headers, auth = self._auth()
        m = self.config.get("mtls") or {}
        verify: Any = m.get("ca", True)
        cert = (m["cert"], m["key"]) if m.get("cert") else None
        last: Exception | None = None
        for attempt in range(int(self.config.get("retries", 2)) + 1):
            try:
                # Ambient HTTP(S)_PROXY env must not re-route egress; the allow-list decides.
                async with httpx.AsyncClient(timeout=self.config.get("timeout_s", 20), verify=verify, cert=cert,
                                             follow_redirects=False, trust_env=False) as c:
                    r = await c.request(op.get("method", "GET"), url, headers=headers, auth=auth,
                                        params=params.get("query") or op.get("query"),
                                        json=params.get("body", op.get("body")))
                if r.status_code >= 500:
                    raise ConnectorError(f"{self.name}.{operation} -> HTTP {r.status_code}")
                if r.status_code >= 400:
                    return {"ok": False, "status": r.status_code, "error": r.text[:500]}
                return r.json() if "json" in r.headers.get("content-type", "") else {"ok": True, "text": r.text[:20000]}
            except (httpx.HTTPError, httpx.InvalidURL, ConnectorError) as e:
                last = e
                await asyncio.sleep(0.5 * 2 ** attempt)
        raise ConnectorError(f"{self.name}.{operation} failed: {last}")
