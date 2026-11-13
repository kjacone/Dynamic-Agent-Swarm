from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from nmb_marketplace_agent.enterprise.observability.cost_tracker import CostTracker


def _gen(model, inp, out, cache_read=0, cache_creation=0):
    msg = AIMessage(
        content="",
        usage_metadata={
            "input_tokens": inp,
            "output_tokens": out,
            "total_tokens": inp + out,          # ← required by UsageMetadata
            "input_token_details": {
                "cache_read": cache_read,
                "cache_creation": cache_creation,
            },
        },
        response_metadata={"model_name": model},
    )
    return LLMResult(generations=[[ChatGeneration(message=msg)]])


def test_accumulates_across_models():
    t = CostTracker(tenant_id="t", run_id="r", step_id="s")
    t.on_llm_end(_gen("ollama:qwen2.5:7b", 100, 20))
    t.on_llm_end(_gen("ollama:qwen2.5:7b", 50, 10))
    t.on_llm_end(_gen("ollama:llama3.1:8b", 200, 40, cache_read=80))
    assert t._totals["ollama:qwen2.5:7b"]["input"] == 150
    assert t._totals["ollama:qwen2.5:7b"]["output"] == 30
    assert t._totals["ollama:qwen2.5:7b"]["calls"] == 2
    assert t._totals["ollama:llama3.1:8b"]["input"] == 200
    assert t._totals["ollama:llama3.1:8b"]["cache_read"] == 80
    assert t._totals["ollama:llama3.1:8b"]["calls"] == 1


def test_missing_metadata_is_ignored():
    t = CostTracker(tenant_id="t", run_id="r", step_id="s")
    t.on_llm_end(LLMResult(generations=[]))
    t.on_llm_end(
        LLMResult(generations=[[ChatGeneration(message=AIMessage(content=""))]])
    )
    assert dict(t._totals) == {}


def test_exception_in_handler_is_swallowed():
    t = CostTracker(tenant_id="t", run_id="r", step_id="s")

    class _Bad:
        def __getattr__(self, _):
            raise RuntimeError("boom")

    t.on_llm_end(_Bad())
    t.on_llm_end(_gen("m", 1, 1))
    assert t._totals["m"]["calls"] == 1