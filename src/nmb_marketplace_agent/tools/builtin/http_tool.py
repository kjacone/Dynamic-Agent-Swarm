import ipaddress
import os
import re
import socket
from urllib.parse import urlparse

import httpx
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

HOST_REF = re.compile(r"\{host\.([A-Za-z][A-Za-z0-9_.-]{0,63})\}")


def check_endpoint(endpoint: str) -> None:
    """Reject non-http(s), private/loopback targets, and hosts outside HTTP_TOOL_ALLOWED_HOSTS."""
    u = urlparse(endpoint)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("Endpoint must be an http(s) URL")
    allowed = [h.strip().lower() for h in os.environ.get("HTTP_TOOL_ALLOWED_HOSTS", "").split(",") if h.strip()]
    if allowed and u.hostname.lower() not in allowed:
        raise ValueError(f"Host {u.hostname} is not in HTTP_TOOL_ALLOWED_HOSTS")
    if os.environ.get("HTTP_TOOL_ALLOW_PRIVATE") == "1":
        return
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80))
    except socket.gaierror:
        raise ValueError(f"Cannot resolve {u.hostname}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError("Private/internal addresses are blocked (set HTTP_TOOL_ALLOW_PRIVATE=1 to allow)")


def _resolve(value: str, host: dict, missing: list[str]) -> str:
    def sub(m: re.Match) -> str:
        key = m.group(1)
        if key not in host:
            missing.append(key)
            return ""
        return str(host[key])
    return HOST_REF.sub(sub, value)


def make_http_tool(name: str, endpoint: str, description: str = "",
                   headers: dict | None = None):
    """POST {query} to a fixed endpoint.

    Header values may reference wrapper config with ``{host.KEY}``, so a page can
    pass an end-user token per request instead of baking credentials into the tool.
    """
    check_endpoint(endpoint)
    templates = {str(k): str(v) for k, v in (headers or {}).items()}

    @tool(name)
    def http_tool(query: str, config: RunnableConfig) -> str:
        """Call a remote HTTP endpoint."""
        try:
            check_endpoint(endpoint)  # re-check at call time
            host = ((config or {}).get("configurable") or {}).get("host_config") or {}
            missing: list[str] = []
            send_headers = {k: _resolve(v, host, missing) for k, v in templates.items()}
            if missing:
                return f"HTTP tool error: missing wrapper config {', '.join(sorted(set(missing)))}"
            resp = httpx.post(endpoint, json={"query": query}, headers=send_headers,
                              timeout=30, follow_redirects=False)
            resp.raise_for_status()
            return resp.text[:20000]
        except Exception as e:
            return f"HTTP tool error: {e}"

    http_tool.description = description or f"HTTP tool: {endpoint}"
    return http_tool
