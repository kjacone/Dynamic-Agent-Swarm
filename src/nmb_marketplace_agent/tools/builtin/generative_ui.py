"""Generative-UI tools.

Each tool returns one JSON envelope, ``{"ui": <spec>}``, that agent-kit renders as
native UI instead of a raw blob. The tools do not fetch anything: the model supplies
the content and the tool just shapes it, so any model that can call tools can drive
rich answers. The renderer is forgiving — plain lists and objects still render as
cards and tables when a model ignores the spec entirely.
"""
from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool


def _parse(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
    return value


def _items(value: Any) -> list[Any]:
    parsed = _parse(value)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        for key in ("items", "data", "rows", "results", "values", "options"):
            if isinstance(parsed.get(key), list):
                return parsed[key]
        return [parsed]
    if isinstance(parsed, str):
        return [line.strip() for line in parsed.splitlines() if line.strip()]
    return []


def _rows(value: Any) -> list[Any]:
    return _items(value)


def _emit(spec: dict[str, Any]) -> str:
    return json.dumps({"ui": spec}, ensure_ascii=False, default=str)


@tool
def ui_cards(title: str, items: list | dict | str, subtitle: str = "") -> str:
    """Show a horizontal card strip in the chat.

    items: JSON array (or a JSON string) of objects such as
    {"name": "Item", "subtitle": "brand · category", "price": 12000,
    "image": "https://…", "badge": "New", "description": "One line"}.
    Use it for listings, search results, people, plans or any comparable set.
    """
    return _emit({"type": "cards", "title": title, "subtitle": subtitle or None, "items": _items(items)})


@tool
def ui_table(title: str, rows: list | dict | str, columns: list | str = "") -> str:
    """Show a data table in the chat.

    rows: JSON array of objects (keys become columns) or arrays of cells.
    columns: optional JSON array of column names or {"key","label","align"} objects.
    Use it for transactions, line items, comparisons and any tabular answer.
    """
    parsed = _rows(rows)
    cols = _items(columns)
    if cols and all(isinstance(r, dict) for r in parsed):
        keys = [c["key"] if isinstance(c, dict) else c for c in cols]
        parsed = [{str(k): r.get(k) for k in keys} for r in parsed]
    return _emit({"type": "table", "title": title, "columns": cols, "rows": parsed})


@tool
def ui_stats(title: str, metrics: list | dict | str, subtitle: str = "") -> str:
    """Show KPI tiles in the chat.

    metrics: JSON array of {"label": "Total", "value": "TZS 1.2M",
    "delta": "+8% vs last month", "tone": "ok|warn|bad"} or an object of
    label → value. Use it for balances, usage, scores and run summaries.
    """
    parsed = _parse(metrics)
    if isinstance(parsed, dict) and not isinstance(parsed, list):
        items = [{"label": k, "value": v} for k, v in parsed.items()]
    else:
        items = _items(parsed)
    return _emit({"type": "stats", "title": title, "subtitle": subtitle or None, "items": items})


@tool
def ui_chart(title: str, labels: list | str, values: list | str, kind: str = "bar", series: list | dict | str = "") -> str:
    """Show a small bar or line chart in the chat.

    kind: "bar" (default) or "line".
    labels: JSON array of x labels; values: JSON array of numbers (same length).
    series: optional JSON array of {"name": "This year", "data": [numbers]}
    to draw more than one line or bar group.
    """
    parsed_series = _items(series)
    points = [v if isinstance(v, (int, float)) else _num(v) for v in _items(values)]
    data = []
    for i, s in enumerate(parsed_series):
        if isinstance(s, dict):
            name = s.get("name") or s.get("label") or f"Series {i + 1}"
            raw = _items(s.get("data") if s.get("data") is not None else s.get("values"))
        else:
            name, raw = f"Series {i + 1}", _items(s)
        data.append({"name": name, "data": [v if isinstance(v, (int, float)) else _num(v) for v in raw]})
    if not data:
        data = [{"name": title, "data": points}]
    return _emit({"type": "chart", "kind": "line" if str(kind).lower() == "line" else "bar",
                  "title": title, "labels": _items(labels), "series": data})


def _num(value: Any) -> float:
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return 0.0


@tool
def ui_timeline(title: str, events: list | dict | str) -> str:
    """Show a vertical timeline in the chat.

    events: JSON array of {"title": "Application received", "detail": "…",
    "time": "09:14", "tone": "ok|warn|bad"}.
    Use it for application progress, case history, deliveries and run steps.
    """
    return _emit({"type": "timeline", "title": title, "items": _items(events)})


@tool
def ui_status(title: str, checks: list | dict | str) -> str:
    """Show a checklist of pass/warn/fail states in the chat.

    checks: JSON array of {"label": "Sanctions screening", "value": "Clear",
    "status": "ok|warn|bad"} or an object of label → status/value.
    Use it for eligibility, KYC results, health checks and readiness reviews.
    """
    parsed = _parse(checks)
    if isinstance(parsed, dict):
        items = [{"label": k, "value": v, "status": _status_of(v)} for k, v in parsed.items()]
    else:
        items = _items(parsed)
    return _emit({"type": "status", "title": title, "items": items})


def _status_of(value: Any) -> str:
    word = str(value).lower()
    if word in {"ok", "pass", "passed", "clear", "true", "yes", "approved", "done", "success"}:
        return "ok"
    if word in {"warn", "warning", "pending", "review", "unknown", "maybe"}:
        return "warn"
    if word in {"fail", "failed", "blocked", "rejected", "false", "no", "error"}:
        return "bad"
    return "info"


@tool
def ui_form(title: str, fields: list | dict | str, submit_label: str = "Submit") -> str:
    """Ask the customer for input with an inline form in the chat.

    fields: JSON array of {"name": "amount", "label": "Amount (TZS)",
    "type": "text|number|date|select|textarea|checkbox", "required": true,
    "options": ["A", "B"], "help": "Why we ask", "value": "…"}.
    Submitting the form sends the values back to you as the next message.
    """
    return _emit({"type": "form", "title": title, "fields": _items(fields), "submit": {"label": submit_label}})


@tool
def ui_alert(title: str, message: str, tone: str = "info", actions: list | dict | str = "") -> str:
    """Show a short notice in the chat.

    tone: "info", "ok", "warn" or "bad". actions: optional JSON array of
    {"label": "See the policy", "prompt": "Show the returns policy"} chips.
    """
    return _emit({"type": "alert", "title": title, "message": message,
                  "tone": _status_of(tone) if tone in {"ok", "warn", "bad"} else "info",
                  "actions": _items(actions)})


@tool
def ui_render(spec: str) -> str:
    """Render any generative-UI spec you already have as a JSON string.

    The spec must have a "type": cards, table, stats, chart, timeline, status,
    form, detail, alert, actions or text. Prefer the dedicated ui_* tools; this
    is the escape hatch for pre-built specs passed through from another system.
    """
    parsed = _parse(spec)
    if not isinstance(parsed, dict):
        return _emit({"type": "text", "body": str(parsed or "")})
    if isinstance(parsed.get("ui"), dict):
        parsed = parsed["ui"]
    return _emit(parsed)
