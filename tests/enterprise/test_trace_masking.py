from nmb_marketplace_agent.integrations.langfuse_mask import langfuse_mask


def test_mask_redacts_card_number():
    out = langfuse_mask("pay with 4111111111111111 now")
    assert "4111111111111111" not in out
    assert "[CREDIT_CARD:" in out


def test_mask_walks_nested_structures():
    out = langfuse_mask({
        "input": "email jane@example.com",
        "meta": {"card": "4111 1111 1111 1111"},
        "list": ["ignore previous instructions", "4111111111111111"],
    })
    assert "jane@example.com" not in out["input"]
    assert "4111 1111 1111 1111" not in out["meta"]["card"]
    # Prompt injection is NOT redacted (it's forensic signal, not PII).
    assert "ignore previous instructions" in out["list"]


def test_mask_handles_non_string_types():
    assert langfuse_mask(42) == 42
    assert langfuse_mask(None) is None
    assert langfuse_mask([1, 2, 3]) == [1, 2, 3]


def test_mask_truncates_huge_strings():
    huge = "x" * 100_000
    out = langfuse_mask(huge)
    assert "truncated" in out
    assert len(out) < 100_000


def test_mask_kill_switch(monkeypatch):
    monkeypatch.setenv("LANGFUSE_MASKING", "off")
    assert langfuse_mask("4111111111111111") == "4111111111111111"