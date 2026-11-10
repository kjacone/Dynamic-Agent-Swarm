"""Connector framework: one interface for modern APIs *and* legacy systems.

Types shipped: ``rest`` (any HTTP API, mTLS/bearer/basic/api-key), ``file_drop`` (SFTP/NFS/
share folders and batch files), ``flat_file`` (fixed-width/CSV mainframe & core-banking
extracts mapped to canonical JSON), ``email`` (IMAP inbox ingestion), ``rpa_bridge``
(job queue to an on-prem RPA/screen-automation worker for systems with no API at all).
Secrets are always references (``env:NAME`` / ``file:/path``); egress is allow-listed.
"""
from __future__ import annotations

import ipaddress
import os
from abc import ABC, abstractmethod
from typing import Any
from urllib.parse import urlparse


class ConnectorError(RuntimeError):
    pass


def resolve_secret(ref: str | None) -> str | None:
    if not ref:
        return None
    if ref.startswith("env:"):
        v = os.environ.get(ref[4:])
        if v is None:
            raise ConnectorError(f"Secret {ref} is not set")
        return v
    if ref.startswith("file:"):  # Kubernetes/Docker secrets
        with open(ref[5:]) as f:
            return f.read().strip()
    raise ConnectorError("Secrets must be 'env:NAME' or 'file:/path' references, never inline values")


_METADATA = {ipaddress.ip_address("169.254.169.254"), ipaddress.ip_address("fd00:ec2::254")}


class EgressPolicy:
    """Outbound allow-list. Empty list = nothing allowed (secure by default). Cloud-metadata
    endpoints are always blocked, even if listed. Set EGRESS_ALLOWED_HOSTS="api.bank.co,*.core.local"."""

    def __init__(self, allowed_hosts: list[str] | None = None):
        env = [h.strip() for h in os.environ.get("EGRESS_ALLOWED_HOSTS", "").split(",") if h.strip()]
        self.allowed = allowed_hosts if allowed_hosts is not None else env

    def check(self, url: str) -> None:
        host = (urlparse(url).hostname or "").lower()
        if not host:
            raise ConnectorError("URL has no host")
        try:
            if ipaddress.ip_address(host) in _METADATA:
                raise ConnectorError("Cloud metadata endpoints are blocked")
        except ValueError:
            pass
        import fnmatch
        if not any(fnmatch.fnmatch(host, pat.lower()) for pat in self.allowed):
            raise ConnectorError(f"Host '{host}' is not in the egress allow-list")


class Connector(ABC):
    type: str = ""

    def __init__(self, name: str, config: dict[str, Any], egress: EgressPolicy | None = None):
        self.name, self.config, self.egress = name, config, egress or EgressPolicy()

    @abstractmethod
    async def call(self, operation: str, params: dict[str, Any]) -> Any: ...

    async def health(self) -> dict:
        return {"ok": True}


def build_connector(name: str, type_: str, config: dict, egress: EgressPolicy | None = None) -> Connector:
    from nmb_marketplace_agent.enterprise.connectors import legacy, rest
    table = {"rest": rest.RestConnector, "file_drop": legacy.FileDropConnector, "flat_file": legacy.FlatFileConnector,
             "email": legacy.EmailConnector, "rpa_bridge": legacy.RpaBridgeConnector}
    if type_ not in table:
        raise ConnectorError(f"Unknown connector type '{type_}'")
    return table[type_](name, config, egress)
