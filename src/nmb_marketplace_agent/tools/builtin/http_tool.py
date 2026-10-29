import ipaddress
import os
import socket
from urllib.parse import urlparse

import httpx
from langchain_core.tools import tool


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


def make_http_tool(name: str, endpoint: str, description: str = ""):
    check_endpoint(endpoint)

    @tool(name)
    def http_tool(query: str) -> str:
        """Call a remote HTTP endpoint."""
        try:
            check_endpoint(endpoint)  # re-check at call time
            resp = httpx.post(endpoint, json={"query": query}, timeout=30, follow_redirects=False)
            resp.raise_for_status()
            return resp.text[:20000]
        except Exception as e:
            return f"HTTP tool error: {e}"

    http_tool.description = description or f"HTTP tool: {endpoint}"
    return http_tool
