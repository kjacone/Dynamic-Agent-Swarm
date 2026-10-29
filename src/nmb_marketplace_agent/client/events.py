"""Normalised event union — same keys as the TypeScript SDK."""
from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class AgentEvent:
    type: Literal[
        "thread",
        "message",
        "token",
        "tool_start",
        "tool_end",
        "subagent_start",
        "subagent_token",
        "subagent_end",
        "interrupt",
        "state",
        "done",
        "error",
    ]
    data: dict[str, Any]

    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)
