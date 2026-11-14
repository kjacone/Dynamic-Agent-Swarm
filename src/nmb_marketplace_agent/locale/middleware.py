"""Runtime locale middleware: adds the profile rules to every model call."""
from __future__ import annotations

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage

from nmb_marketplace_agent.locale.compiler import compile_rules


class LocaleMiddleware(AgentMiddleware):
    """Injects the compiled locale block after the agent's own system prompt.

    The middleware is built per graph from the agent's attached profile, so
    attaching or detaching a profile takes effect on the next graph build.
    """

    def __init__(self, profile, examples: list | None = None) -> None:
        super().__init__()
        self.rules = compile_rules(profile, examples)

    def _apply(self, request):
        base = request.system_prompt or ""
        content = (base.rstrip() + "\n\n" + self.rules).strip() if base else self.rules
        return request.override(system_message=SystemMessage(content=content))

    def wrap_model_call(self, request, handler):
        return handler(self._apply(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._apply(request))
