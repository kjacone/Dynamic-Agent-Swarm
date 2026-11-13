"""Data-protection + policy engine: PII/secret detection, prompt-injection heuristics,
tenant policies (allow/log/redact/require_approval/block) and a LangChain tool guard.

Detection is deliberately heuristic and local (no data leaves the deployment). It is a
defence-in-depth layer, not a substitute for DLP products where those are mandated.
"""
from __future__ import annotations

import fnmatch
import hashlib
import hmac
import os
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

from nmb_marketplace_agent.enterprise.expr import ExprError, safe_eval

# ── PII / secret detection ────────────────────────────────────────────
def _luhn(s: str) -> bool:
    d = [int(c) for c in s if c.isdigit()]
    if not 13 <= len(d) <= 19:
        return False
    tot = 0
    for i, x in enumerate(reversed(d)):
        if i % 2:
            x *= 2
            x -= 9 if x > 9 else 0
        tot += x
    return tot % 10 == 0


def _iban(s: str) -> bool:
    s = s.replace(" ", "").upper()
    if not 15 <= len(s) <= 34:
        return False
    r = s[4:] + s[:4]
    return int("".join(str(int(c, 36)) for c in r)) % 97 == 1


# kind -> (regex, validator|None, severity, capture-group)
_PATTERNS: dict[str, tuple[re.Pattern, Callable[[str], bool] | None, str, int]] = {
    "secret": (re.compile(r"\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{36}|"
                          r"eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})\b"), None, "critical", 0),
    "credit_card": (re.compile(r"\b(?:\d[ -]?){13,19}\b"), _luhn, "high", 0),
    "iban": (re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b"), _iban, "high", 0),
    "us_ssn": (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), None, "high", 0),
    "tax_id": (re.compile(r"\b[AP]\d{9}[A-Z]\b"), None, "high", 0),  # e.g. Kenya KRA PIN
    "national_id": (re.compile(r"(?i)\b(?:national\s*id|id\s*(?:no|number)|passport(?:\s*no)?)\b[:\s#.]*([A-Z0-9]{6,12})\b"),
                    None, "high", 1),
    "email": (re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"), None, "medium", 0),
    "phone": (re.compile(r"(?<![\w+])(?:\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3}[\s-]?\d{3,4}|0[17]\d{8})(?!\w)"),
              None, "medium", 0),
}
_SEV = {"medium": 1, "high": 2, "critical": 3}


@dataclass
class Finding:
    kind: str
    start: int
    end: int
    severity: str
    score: float = 1.0

    def as_dict(self) -> dict:
        return {"kind": self.kind, "start": self.start, "end": self.end,
                "severity": self.severity, "score": self.score}


def scan_pii(text: str) -> list[Finding]:
    found: list[Finding] = []
    for kind, (rx, check, sev, grp) in _PATTERNS.items():
        for m in rx.finditer(text):
            val = m.group(grp)
            if check and not check(val):
                continue
            found.append(Finding(kind, m.start(grp), m.end(grp), sev))
    # resolve overlaps: higher severity, then longer span wins
    found.sort(key=lambda f: (-_SEV[f.severity], -(f.end - f.start), f.start))
    kept: list[Finding] = []
    for f in found:
        if not any(f.start < k.end and k.start < f.end for k in kept):
            kept.append(f)
    return sorted(kept, key=lambda f: f.start)


_INJECTION = [
    (re.compile(r"(?i)ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts?)"), 0.9),
    (re.compile(r"(?i)disregard\s+.{0,40}(?:instructions|rules|guidelines|policy)"), 0.8),
    (re.compile(r"(?i)(?:reveal|print|show|repeat|leak)\s+.{0,30}(?:system\s+prompt|instructions|api\s*key|secret|password)"), 0.8),
    (re.compile(r"(?i)you\s+are\s+now\s+(?:a|an|in)\b"), 0.5),
    (re.compile(r"(?i)\b(?:developer|dan|jailbreak|god)\s+mode\b"), 0.7),
    (re.compile(r"(?i)act\s+as\s+.{0,40}without\s+(?:any\s+)?(?:restrictions|limits|filters)"), 0.8),
    (re.compile(r"(?i)<\s*/?\s*(?:system|assistant)\s*>|\[\s*system\s*\]"), 0.6),
    (re.compile(r"(?i)forward\s+(?:all|this|the)\s+.{0,40}\bto\s+\S+@\S+"), 0.6),  # data-exfil instruction
]


def scan_injection(text: str) -> Finding | None:
    score, first = 0.0, None
    for rx, w in _INJECTION:
        m = rx.search(text)
        if m:
            first = first or m
            score = 1 - (1 - score) * (1 - w)  # noisy-OR
    return Finding("prompt_injection", first.start(), first.end(), "high", round(score, 2)) if first else None


# ── Redaction ─────────────────────────────────────────────────────────
def _token(kind: str, value: str) -> str:
    key = os.environ.get("REDACTION_KEY", "dev-redaction-key").encode()
    return f"[{kind.upper()}:{hmac.new(key, value.encode(), hashlib.sha256).hexdigest()[:6]}]"


def redact(text: str, findings: list[Finding] | None = None, vault: dict[str, str] | None = None) -> str:
    """Replace findings with deterministic tokens (same value -> same token, so downstream
    logic can still correlate). Pass ``vault`` to keep a token->value map for re-hydration."""
    findings = scan_pii(text) if findings is None else [f for f in findings if f.kind != "prompt_injection"]
    out, last = [], 0
    for f in sorted(findings, key=lambda x: x.start):
        if f.start < last:
            continue
        val = text[f.start:f.end]
        tok = _token(f.kind, val)
        if vault is not None:
            vault[tok] = val
        out += [text[last:f.start], tok]
        last = f.end
    out.append(text[last:])
    return "".join(out)


def rehydrate(text: str, vault: dict[str, str]) -> str:
    for tok, val in vault.items():
        text = text.replace(tok, val)
    return text


def redact_obj(obj: Any) -> Any:
    """Redact PII in any JSON-like structure (used for audit details and logs)."""
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, list):
        return [redact_obj(o) for o in obj]
    if isinstance(obj, dict):
        return {k: redact_obj(v) for k, v in obj.items()}
    return obj


# ── Policy model ──────────────────────────────────────────────────────
Action = Literal["allow", "log", "redact", "require_approval", "block"]
_ORDER = {"allow": 0, "log": 1, "redact": 2, "require_approval": 3, "block": 4}
Direction = Literal["input", "output", "tool_args", "tool_result", "document"]


class Rule(BaseModel):
    id: str
    description: str = ""
    applies_to: list[Direction] = Field(default_factory=lambda: ["input", "output", "tool_args", "tool_result", "document"])
    kinds: list[str] = Field(default_factory=list)  # pii kinds and/or "prompt_injection"
    min_score: float = 0.5
    action: Action = "log"
    message: str = ""


class ToolRule(BaseModel):
    tool: str  # fnmatch glob
    action: Action = "require_approval"
    when: str | None = None  # safe expression over `args`, e.g. "args.amount > 10000"
    message: str = ""


class Policy(BaseModel):
    name: str = "default"
    version: int = 1
    rules: list[Rule] = Field(default_factory=list)
    tool_rules: list[ToolRule] = Field(default_factory=list)
    max_input_chars: int = 50_000


# Opinionated baseline for regulated customers; solution packs layer on top of it.
DEFAULT_POLICY = Policy(
    name="regulated-baseline",
    rules=[
        Rule(id="block-injection-input", kinds=["prompt_injection"], applies_to=["input", "document", "tool_result"],
             min_score=0.8, action="block", message="Possible prompt-injection attempt."),
        Rule(id="block-secrets-out", kinds=["secret"], applies_to=["output", "tool_args", "tool_result"],
             action="block", message="Credentials must never leave the platform."),
        Rule(id="redact-card-and-ids-out", kinds=["credit_card", "iban", "us_ssn", "tax_id", "national_id"],
             applies_to=["output"], action="redact"),
        Rule(id="redact-card-in", kinds=["credit_card"], applies_to=["input", "document"], action="redact",
             message="Card numbers are never sent to a model (PCI DSS scope reduction)."),
        Rule(id="redact-ids-in-documents", kinds=["credit_card", "iban", "us_ssn", "tax_id", "national_id"],
             applies_to=["document"], action="redact",
             message="Identifiers in retrieved documents are masked before they reach a model."),
        Rule(id="log-contact-pii", kinds=["email", "phone"], action="log"),
    ],
)


@dataclass
class Decision:
    action: Action = "allow"
    text: str | None = None
    findings: list[Finding] = field(default_factory=list)
    rule_ids: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    @property
    def blocked(self) -> bool:
        return self.action == "block"

    def as_dict(self) -> dict:
        return {"action": self.action, "rule_ids": self.rule_ids, "reasons": self.reasons,
                "findings": [f.as_dict() for f in self.findings]}


class PolicyEngine:
    def __init__(self, policy: Policy | dict | None = None):
        self.policy = Policy.model_validate(policy) if isinstance(policy, dict) else (policy or DEFAULT_POLICY)

    def check_text(self, text: str, direction: Direction, vault: dict[str, str] | None = None) -> Decision:
        d = Decision(text=text)
        if len(text) > self.policy.max_input_chars and direction in ("input", "document"):
            return Decision("block", None, [], ["max-length"], ["Input exceeds the permitted size."])
        pii = scan_pii(text)
        inj = scan_injection(text)
        to_redact: list[Finding] = []
        for r in self.policy.rules:
            if direction not in r.applies_to:
                continue
            hits = [f for f in pii if f.kind in r.kinds]
            if inj and "prompt_injection" in r.kinds and inj.score >= r.min_score:
                hits.append(inj)
            if not hits:
                continue
            d.findings += hits
            d.rule_ids.append(r.id)
            d.reasons.append(r.message or r.description or f"{r.id}: {', '.join(sorted({h.kind for h in hits}))}")
            if r.action == "redact":
                to_redact += hits
            if _ORDER[r.action] > _ORDER[d.action]:
                d.action = r.action
        if to_redact and d.action != "block":
            d.text = redact(text, to_redact, vault)
        if d.action == "block":
            d.text = None
        return d

    def check_tool_call(self, name: str, args: dict) -> Decision:
        d = Decision(text=None)
        for r in self.policy.tool_rules:
            if not fnmatch.fnmatch(name, r.tool):
                continue
            try:
                hit = True if not r.when else bool(safe_eval(r.when, {"args": args, "tool": name}))
            except ExprError:
                hit = True  # fail closed on a malformed policy
            if hit:
                d.rule_ids.append(f"tool:{r.tool}")
                d.reasons.append(r.message or f"Policy requires {r.action} for {name}")
                if _ORDER[r.action] > _ORDER[d.action]:
                    d.action = r.action
        # also scan the serialized arguments for secrets / injected content
        scan = self.check_text(str(args), "tool_args")
        if _ORDER[scan.action] > _ORDER[d.action] and scan.action in ("block", "require_approval"):
            d.action = scan.action
        d.rule_ids += scan.rule_ids
        d.reasons += scan.reasons
        d.findings += scan.findings
        return d


class OutputStreamGuard:
    """Apply output policy to a token stream without leaking a split pattern.

    Model tokens are not aligned to policy patterns: a card number or key can be
    split across chunks. The guard therefore only emits up to a sentence boundary
    that is at least ``holdback`` characters behind the buffer end, so a match
    always completes inside one screened chunk. ``flush`` screens the remainder.
    """

    def __init__(self, engine: PolicyEngine, holdback: int = 128):
        self.engine = engine
        self.holdback = holdback
        self.buffer = ""
        self.blocked = False
        self.redacted = False
        self.decision: Decision | None = None
        self._boundary = -1

    def feed(self, text: str) -> str:
        if self.blocked or not text:
            return ""
        start = len(self.buffer)
        self.buffer += text
        self._remember_boundaries(start)
        limit = len(self.buffer) - self.holdback
        if self._boundary < 0 or self._boundary > limit:
            return ""
        cut, self._boundary = self._boundary, -1
        return self._emit(cut)

    def flush(self) -> str:
        if self.blocked:
            return ""
        self._boundary = -1
        return self._emit(len(self.buffer))

    def _remember_boundaries(self, start: int) -> None:
        # A dot only ends a sentence when whitespace follows; that keeps dots
        # inside JWTs, emails, URLs and decimals from becoming unsafe cut points.
        for i in range(max(0, start - 1), max(0, len(self.buffer) - 1)):
            ch = self.buffer[i]
            if ch == "\n" or (ch in ".!?" and self.buffer[i + 1].isspace()):
                self._boundary = i + 1

    def _emit(self, cut: int) -> str:
        if cut <= 0:
            return ""
        chunk, self.buffer = self.buffer[:cut], self.buffer[cut:]
        dec = self.engine.check_text(chunk, "output")
        self.decision = dec
        if dec.blocked:
            self.blocked = True
            self.buffer = ""
            return ""
        if dec.text is not None and dec.text != chunk:
            self.redacted = True
        return dec.text if dec.text is not None else chunk


# ── LangChain/LangGraph integration ───────────────────────────────────
def guard_tools(tools: list, engine: PolicyEngine, *, tenant_id: str, agent_id: str = "",
                on_event: Callable[[str, dict], None] | None = None) -> list:
    """Wrap tools so every call is policy-checked. ``require_approval`` pauses the graph with a
    LangGraph ``interrupt`` using the HITL request shape agent-kit's HitlReview already renders;
    ``block`` returns a refusal message to the model instead of executing.
    """
    from langchain_core.tools import StructuredTool

    def emit(kind: str, payload: dict):
        if on_event:
            try:
                on_event(kind, {"tenant_id": tenant_id, "agent_id": agent_id, **payload})
            except Exception:  # never let telemetry break a run
                pass

    def make(tool):
        def _gate(args: dict):
            dec = engine.check_tool_call(tool.name, args)
            if dec.action == "block":
                emit("tool.blocked", {"tool": tool.name, **dec.as_dict()})
                return None, f"Blocked by policy: {'; '.join(dec.reasons) or 'not permitted'}"
            if dec.action == "require_approval":
                from langgraph.types import interrupt
                emit("tool.approval_requested", {"tool": tool.name, **dec.as_dict()})
                resp = interrupt({
                    "action_requests": [{"name": tool.name, "args": args,
                                         "description": "; ".join(dec.reasons) or "Approval required"}],
                    "review_configs": [{"action_name": tool.name, "allowed_decisions": ["approve", "edit", "reject"]}],
                })
                decision = (resp.get("decisions") or [{}])[0] if isinstance(resp, dict) else {}
                kind = decision.get("type")
                if kind == "reject":
                    emit("tool.rejected", {"tool": tool.name})
                    return None, f"Rejected by reviewer: {decision.get('message', '')}".strip()
                if kind == "edit":
                    args = decision["edited_action"]["args"]
                emit("tool.approved", {"tool": tool.name})
            return args, None

        # RAG retrievers declare `policy_direction: document` in metadata so retrieved
        # chunks get the stricter document rules; everything else is screened as tool output.
        direction = "document" if (getattr(tool, "metadata", None) or {}).get("policy_direction") == "document" else "tool_result"
        withheld = object()

        def _post(result):
            holder: dict = {"dec": None, "redacted": False}

            def walk(value):
                if isinstance(value, str):
                    dec = engine.check_text(value, direction)
                    if dec.findings or dec.action != "allow":
                        holder["dec"] = holder["dec"] or dec
                    if dec.blocked:
                        return withheld
                    out = dec.text if dec.text is not None else value
                    if out != value:
                        holder["redacted"] = True
                    return out
                if isinstance(value, list):
                    out = []
                    for item in value:
                        v = walk(item)
                        if v is withheld:
                            return withheld
                        out.append(v)
                    return out
                if isinstance(value, dict):
                    out = {}
                    for k, item in value.items():
                        v = walk(item)
                        if v is withheld:
                            return withheld
                        out[k] = v
                    return out
                return value

            screened = walk(result)
            dec = holder["dec"]
            if screened is withheld:
                emit("tool.result_blocked", {"tool": tool.name, **(dec.as_dict() if dec else {})})
                return "Tool result withheld by policy."
            if holder["redacted"] and dec is not None:
                emit("tool.result_redacted", {"tool": tool.name, **dec.as_dict()})
            return screened

        def sync(**kw):
            args, refusal = _gate(kw)
            if refusal:
                return refusal
            emit("tool.call", {"tool": tool.name})
            # Retrieval tools are async (they do network + DB work); the agent
            # runtime always takes the async path, but keep sync callers working.
            if getattr(tool, "func", None) is None and getattr(tool, "coroutine", None) is not None:
                import asyncio
                try:
                    asyncio.get_running_loop()
                except RuntimeError:
                    return _post(asyncio.run(tool.ainvoke(args)))
                raise RuntimeError(f"Tool '{tool.name}' is async; await it instead of calling invoke()")
            return _post(tool.invoke(args))

        async def asyn(**kw):
            args, refusal = _gate(kw)
            if refusal:
                return refusal
            emit("tool.call", {"tool": tool.name})
            return _post(await tool.ainvoke(args))

        return StructuredTool(name=tool.name, description=tool.description,
                              args_schema=getattr(tool, "args_schema", None), func=sync, coroutine=asyn)

    return [make(t) if hasattr(t, "invoke") else t for t in tools]
