"""A canned chat model for demos and offline pilots.

`sample:<label>` resolves to this model. It streams short deterministic replies
and, when exactly one of the marketplace browser tools is relevant to the
buyer's words, asks for that tool so the real graph still pauses, the host page
runs the handler and the run resumes — no external LLM required.
"""
import json
from typing import Any, Iterator

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

# Tool name -> (keyword test, args). Kept to the marketplace pack's five browser
# tools; any other agent still gets plain canned text.
_STOPWORDS = {
    "show", "me", "the", "a", "an", "of", "all", "please", "i", "want", "to", "see",
    "any", "some", "items", "item", "products", "product", "cheapest", "cheaper",
    "cheap", "under", "below", "less", "than", "for", "my", "your", "do", "you", "have",
}


def _query(text: str) -> str:
    words = [w.strip(".,!?()") for w in text.lower().split()]
    keep = [w for w in words if w and w not in _STOPWORDS and not w.replace(",", "").isdigit()]
    return " ".join(keep)[:80]


def _price(text: str) -> float | None:
    import re

    m = re.search(r"(?:under|below|less than)\s*(?:tzs|ksh|usd|\$)?\s*([\d,]+)", text)
    return float(m.group(1).replace(",", "")) if m else None


def _search_args(text: str) -> dict:
    args: dict[str, Any] = {}
    query = _query(text)
    if query:
        args["query"] = query
    price = _price(text)
    if price:
        args["max_price"] = price
    return args


def _filter_args(text: str) -> dict:
    if "fashion" in text:
        args: dict[str, Any] = {"category": "fashion & apparel"}
    elif "electronic" in text or "phone" in text:
        args = {"category": "electronics"}
    else:
        args = _search_args(text)
    price = _price(text)
    if price:
        args["max_price"] = price
    return args


_TOOL_ARGS: dict[str, Any] = {
    "show_products": _search_args,
    "set_filter": _filter_args,
    "show_order": lambda q: {"order_id": _order_id(q)},
    "navigate": lambda q: {"target": "stores" if ("store" in q or "branch" in q) else "catalogue"},
    "add_to_cart": lambda q: {"product_id": "349", "name": "Sucre Rollex Grande", "quantity": 1},
}

_TOOL_HINTS = (
    ("show_order", ("order", "delivery", "shipment", "track")),
    ("add_to_cart", ("add", "cart", "basket")),
    ("navigate", ("store", "branch", "location", "navigate", "where are you", "take me")),
    ("set_filter", ("filter", "only", "fashion")),
    ("show_products", ("product", "phone", "laptop", "price", "cheap", "show", "catalogue", "catalog", "under")),
)

_REPLIES = {
    "show_products": "Here are the matches from the catalogue. Tap a card for the full record — tell me if you want one added to your cart.",
    "show_order": "I've pulled up that order. It is in transit with our courier and the estimated delivery window is shown on the card.",
    "add_to_cart": "Done — the item is in your cart. You can review it on this page before checking out.",
    "navigate": "I've moved the page to that section for you.",
    "set_filter": "I've updated the catalogue view on this page. Tell me if you want to refine it further.",
}


def _text(message) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    parts = [p.get("text", "") for p in content if isinstance(p, dict)]
    return " ".join(p for p in parts if p)


def _order_id(text: str) -> str:
    for word in text.replace("?", " ").split():
        token = word.strip(".,!()")
        if token.upper().startswith("ORD-"):
            return token.upper()
    return "ORD-100245"


def _tool_names(tools: list | None) -> list[str]:
    names: list[str] = []
    for tool in tools or []:
        if isinstance(tool, str):
            name = tool
        elif isinstance(tool, dict):
            spec = tool.get("function") if isinstance(tool.get("function"), dict) else tool
            name = spec.get("name")
        else:
            name = getattr(tool, "name", None)
        if name:
            names.append(str(name))
    return names


def _choose_tool(text: str, names: list[str]) -> tuple[str, dict] | None:
    low = text.lower()
    for name, hints in _TOOL_HINTS:
        if name in names and any(h in low for h in hints):
            return name, _TOOL_ARGS[name](low)
    return None


class SampleChatModel(BaseChatModel):
    """Streams canned text; emits a browser tool call when one is clearly asked for."""

    label: str = "sample"

    @property
    def _llm_type(self) -> str:
        return "nmb-sample"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        return self.bind(tools=list(tools), tool_choice=tool_choice, **kwargs)

    def _answer(self, messages: list, tools: list | None) -> AIMessage:
        tool_msgs = [m for m in messages if isinstance(m, ToolMessage)]
        human = next((m for m in reversed(messages) if isinstance(m, HumanMessage)), None)
        human_text = _text(human) if human else ""

        # A tool result is the newest message: summarise it and finish the run.
        if tool_msgs and (human is None or messages.index(tool_msgs[-1]) > messages.index(human)):
            name = str(getattr(tool_msgs[-1], "name", ""))
            return AIMessage(content=_REPLIES.get(name, "That's done. Anything else I can help with?"))

        low = human_text.lower()
        if tools:
            picked = _choose_tool(human_text, _tool_names(tools))
            if picked:
                name, args = picked
                return AIMessage(
                    content="",
                    tool_calls=[{"name": name, "args": args, "id": f"call_sample_{abs(hash((name, human_text))) % 10**8}", "type": "tool_call"}],
                )

        if any(w in low for w in ("hello", "hi", "hey")):
            return AIMessage(content="Hello! I can show products, check an order, open a page section or add something to your cart.")
        if "return" in low or "refund" in low:
            return AIMessage(content="Returns are accepted within 14 days for unused items with the receipt, and refunds go back to the original payment method.")
        return AIMessage(content="I can help with the catalogue, an order, this page's sections and your cart. What would you like to do?")

    def _generate(
        self,
        messages: list,
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=self._answer(messages, kwargs.get("tools")))])

    def _stream(
        self,
        messages: list,
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        msg = self._answer(messages, kwargs.get("tools"))
        if msg.tool_calls:
            yield ChatGenerationChunk(message=AIMessageChunk(
                content="",
                tool_call_chunks=[{
                    "name": msg.tool_calls[0]["name"],
                    "args": json.dumps(msg.tool_calls[0]["args"]),
                    "id": msg.tool_calls[0]["id"],
                    "index": 0,
                }],
            ))
            return
        text = msg.content if isinstance(msg.content, str) else ""
        for i in range(0, len(text), 28):
            yield ChatGenerationChunk(message=AIMessageChunk(content=text[i:i + 28]))
