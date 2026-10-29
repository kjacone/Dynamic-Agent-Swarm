"""Prompt templating shared by the playground and tests. Langfuse-style {{variable}} placeholders."""
import json
import re
from typing import Any

_VAR = re.compile(r"\{\{\s*([\w.\-]+)\s*\}\}")


def variables_of(prompt: Any) -> list[str]:
    text = prompt if isinstance(prompt, str) else json.dumps(prompt)
    seen: list[str] = []
    for m in _VAR.findall(text):
        if m not in seen:
            seen.append(m)
    return seen


def render(text: str, values: dict[str, str]) -> str:
    """Unknown variables are left as-is so mistakes are visible in the output."""
    return _VAR.sub(lambda m: str(values.get(m.group(1), m.group(0))), text)


def render_messages(prompt: Any, values: dict[str, str], user_input: str | None = None) -> list[dict]:
    """Text prompt -> system message (+ optional user input). Chat prompt -> rendered message list."""
    if isinstance(prompt, str):
        text = render(prompt, values)
        if user_input:
            return [{"role": "system", "content": text}, {"role": "user", "content": user_input}]
        return [{"role": "user", "content": text}]
    out = []
    for m in prompt:
        role = m.get("role", "user")
        out.append({"role": "assistant" if role in ("ai", "assistant") else role,
                    "content": render(str(m.get("content", "")), values)})
    if user_input:
        out.append({"role": "user", "content": user_input})
    return out