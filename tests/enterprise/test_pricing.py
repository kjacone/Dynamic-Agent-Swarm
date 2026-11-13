from nmb_marketplace_agent.enterprise.observability import pricing


def test_strip_provider():
    assert pricing._strip_provider("openai:gpt-4o-mini") == "gpt-4o-mini"
    assert pricing._strip_provider("ollama:llama3.1:8b") == "llama3.1"
    assert pricing._strip_provider("vllm:meta-llama/Llama-3.1-70B-Instruct") == "meta-llama/Llama-3.1-70B-Instruct"
    assert pricing._strip_provider("gpt-4o") == "gpt-4o"


def test_price_for_known_models():
    assert pricing.price_for("openai:gpt-4o-mini")["input"] == 0.15
    assert pricing.price_for("claude-3-5-sonnet")["output"] == 15.00


def test_price_for_local_models_is_zero():
    assert pricing.price_for("ollama:llama3.1:8b") == {"input": 0.0, "output": 0.0}
    assert pricing.price_for("vllm:something") == {"input": 0.0, "output": 0.0}


def test_price_for_unknown_returns_zero():
    assert pricing.price_for("nonexistent:model") == {"input": 0.0, "output": 0.0}


def test_prefix_match():
    # Dated snapshot should match the undated prefix
    assert pricing.price_for("openai:gpt-4o-2024-08-06")["input"] == 2.50


def test_usd_calculation():
    # 1000 input + 500 output on gpt-4o-mini: 1000*0.15/1M + 500*0.60/1M
    assert abs(pricing.usd("gpt-4o-mini", input_tokens=1000, output_tokens=500) - 0.00045) < 1e-9


def test_usd_with_cache():
    # gpt-4o: 1000 input, 100 cache_read, 0 output
    # 1000*2.50/1M + 100*1.25/1M = 0.0025 + 0.000125 = 0.002625
    got = pricing.usd("gpt-4o", input_tokens=1000, cache_read=100)
    assert abs(got - 0.002625) < 1e-9