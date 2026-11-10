"""Adapters for systems without modern APIs (the 'long tail' that blocks enterprise AI)."""
from __future__ import annotations

import asyncio
import csv
import email
import imaplib
import io
import os
import shutil
import uuid
from email.header import decode_header
from pathlib import Path
from typing import Any

from nmb_marketplace_agent.enterprise.connectors.base import Connector, ConnectorError, resolve_secret


def _safe(root: Path, name: str) -> Path:
    p = (root / name).resolve()
    if root.resolve() not in p.parents and p != root.resolve():
        raise ConnectorError("Path escapes the configured directory")
    return p


class FileDropConnector(Connector):
    """Watch a landing folder (mounted SFTP/NFS/SMB share). ops: list, read, archive.
    config: inbox, archive (dirs), pattern, max_bytes"""
    type = "file_drop"

    async def call(self, operation: str, params: dict[str, Any]) -> Any:
        inbox, arch = Path(self.config["inbox"]), Path(self.config.get("archive", self.config["inbox"] + "/.processed"))
        if operation == "list":
            return {"files": sorted(p.name for p in inbox.glob(self.config.get("pattern", "*")) if p.is_file())}
        p = _safe(inbox, params["file"])
        if operation == "read":
            if p.stat().st_size > int(self.config.get("max_bytes", 25_000_000)):
                raise ConnectorError("File exceeds max_bytes")
            return {"file": p.name, "text": p.read_text(errors="replace")} if params.get("as_text", True) else \
                   {"file": p.name, "size": p.stat().st_size}
        if operation == "archive":
            arch.mkdir(parents=True, exist_ok=True)
            shutil.move(str(p), str(arch / f"{uuid.uuid4().hex[:8]}_{p.name}"))
            return {"archived": p.name}
        raise ConnectorError(f"Unknown operation {operation}")


class FlatFileConnector(Connector):
    """Parse mainframe/core-banking extracts into canonical JSON.
    config: layout{kind: fixed|csv, delimiter, fields:[{name,start,end,type,format?}]}"""
    type = "flat_file"

    @staticmethod
    def _cast(v: str, t: str):
        v = v.strip()
        if t == "int":
            return int(v or 0)
        return v

    async def call(self, operation: str, params: dict[str, Any]) -> Any:
        if operation != "parse":
            raise ConnectorError("flat_file supports: parse")
        lay, text = self.config["layout"], params["text"]
        rows: list[dict] = []
        if lay.get("kind", "fixed") == "csv":
            rows = [dict(r) for r in csv.DictReader(io.StringIO(text), delimiter=lay.get("delimiter", ","))]
        else:
            for line in text.splitlines():
                if not line.strip():
                    continue
                rec = {}
                for f in lay["fields"]:
                    raw = line[f["start"]:f["end"]]
                    if f.get("type") == "decimal":
                        rec[f["name"]] = int(raw.strip() or 0) / (10 ** int(f.get("scale", 2)))
                    else:
                        rec[f["name"]] = self._cast(raw, f.get("type", "str"))
                rows.append(rec)
        return {"count": len(rows), "records": rows[: int(params.get("limit", 10_000))]}


class EmailConnector(Connector):
    """Ingest mail (approvals-by-email, claims sent to a shared inbox). ops: fetch_unseen.
    config: host, port, user, password_ref, folder, allowed_senders"""
    type = "email"

    def _fetch(self, limit: int) -> list[dict]:
        c = self.config
        out = []
        with imaplib.IMAP4_SSL(c["host"], int(c.get("port", 993))) as m:
            m.login(c["user"], resolve_secret(c["password_ref"]) or "")
            m.select(c.get("folder", "INBOX"))
            _, data = m.search(None, "UNSEEN")
            for num in data[0].split()[:limit]:
                _, msg_data = m.fetch(num, "(RFC822)")
                msg = email.message_from_bytes(msg_data[0][1])
                sender = email.utils.parseaddr(msg.get("From", ""))[1].lower()
                allowed = [s.lower() for s in c.get("allowed_senders", [])]
                if allowed and sender not in allowed and not any(sender.endswith("@" + d.lstrip("@")) for d in allowed if "@" not in d[1:]):
                    continue  # ignore unknown senders: email is an untrusted channel
                subj = "".join(t.decode(e or "utf8") if isinstance(t, bytes) else t for t, e in decode_header(msg.get("Subject", "")))
                body, atts = "", []
                for part in msg.walk():
                    if part.get_content_type() == "text/plain" and not part.get_filename():
                        body += part.get_payload(decode=True).decode(part.get_content_charset() or "utf8", "replace")
                    elif part.get_filename():
                        atts.append({"filename": part.get_filename(), "content_type": part.get_content_type(),
                                     "size": len(part.get_payload(decode=True) or b"")})
                out.append({"from": sender, "subject": subj, "body": body[:20000], "attachments": atts})
        return out

    async def call(self, operation: str, params: dict[str, Any]) -> Any:
        if operation != "fetch_unseen":
            raise ConnectorError("email supports: fetch_unseen")
        return {"messages": await asyncio.to_thread(self._fetch, int(params.get("limit", 20)))}


class RpaBridgeConnector(Connector):
    """Bridge to an on-prem automation worker that drives a legacy UI (mainframe terminal, thick client).
    The worker polls ``/jobs/next`` and posts results; the platform only enqueues and awaits.
    config: base_url, auth, poll_s, timeout_s, scripts[allowed script names]"""
    type = "rpa_bridge"

    async def call(self, operation: str, params: dict[str, Any]) -> Any:
        from nmb_marketplace_agent.enterprise.connectors.rest import RestConnector
        if operation not in self.config.get("scripts", []):
            raise ConnectorError(f"Script '{operation}' is not allow-listed for this bridge")
        rest = RestConnector(self.name, {**self.config, "operations": {
            "enqueue": {"method": "POST", "path": "/jobs"}, "status": {"method": "GET", "path": "/jobs/{job_id}"}}},
            self.egress)
        job = await rest.call("enqueue", {"body": {"script": operation, "params": params}})
        waited, poll = 0.0, float(self.config.get("poll_s", 2))
        while waited < float(self.config.get("timeout_s", 120)):
            st = await rest.call("status", {"job_id": job["job_id"]})
            if st.get("state") in ("done", "failed"):
                if st["state"] == "failed":
                    raise ConnectorError(f"RPA job failed: {st.get('error', '')}")
                return st.get("result", {})
            await asyncio.sleep(poll)
            waited += poll
        raise ConnectorError("RPA job timed out")
