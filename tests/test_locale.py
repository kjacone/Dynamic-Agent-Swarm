from types import SimpleNamespace

from nmb_marketplace_agent.locale.compiler import compile_rules, compile_specialist, format_reply
from nmb_marketplace_agent.locale.middleware import LocaleMiddleware
from nmb_marketplace_agent.locale.service import generated_subagent_id


def _profile(**over):
    base = dict(
        name="Test Locale", locale_code="xx-XX", languages=["Testish", "English"],
        default_language="Testish", register_style="formal", code_switch_policy="allowed",
        currency_code="TST", currency_symbol="Ŧ", currency_position="after",
        decimal_sep=".", thousand_sep=",", date_format="DD/MM/YYYY",
        glossary=[], replacements=[], required_phrases=[], banned_phrases=[],
        sample_cases=[], notes="", enabled=True,
    )
    base.update(over)
    return SimpleNamespace(**base)


def _example(i, q, a):
    return SimpleNamespace(input=q, corrected_output=a, bad_output=None, enabled=True)


def test_format_reply_is_noop_without_profile():
    assert format_reply("Hello TZS 1000", None) == "Hello TZS 1000"


def test_format_reply_replacements_run_in_order():
    p = _profile(replacements=[{"from": "Hello", "to": "Karibu"}, {"from": "Karibu!", "to": "Karibu!!"}])
    assert format_reply("Hello! World", p) == "Karibu!! World"


def test_format_reply_currency_after_with_separators():
    p = _profile()
    assert format_reply("Total: TST 1500000.50 today", p) == "Total: 1,500,000.50 Ŧ today"


def test_format_reply_currency_before_with_swapped_separators():
    p = _profile(currency_code="EUR", currency_symbol="€", currency_position="before",
                 thousand_sep=" ", decimal_sep=",")
    assert format_reply("It costs EUR 1234.50", p) == "It costs € 1 234,50"


def test_format_reply_iso_dates_use_profile_layout():
    assert format_reply("On 2026-11-14", _profile()) == "On 14/11/2026"
    assert format_reply("On 2026-11-14", _profile(date_format="YYYY/MM/DD")) == "On 2026/11/14"


def test_format_reply_leaves_unclaimed_amounts_alone():
    assert format_reply("Bei ni sh 1,500,000.", _profile()) == "Bei ni sh 1,500,000."


def test_compile_rules_is_fully_data_driven():
    p = _profile(
        glossary=[{"source": "Loan", "target": "Mkopo"}, {"source": "NMB", "keep": True}],
        required_phrases=["Welcome"], banned_phrases=["Hi there"],
        notes="Formal register.", date_format="DD/MM/YYYY",
    )
    rules = compile_rules(p, [_example(1, "salio?", "Salio lako ni sawa.")])
    assert "Write replies in Testish." in rules
    assert "- Loan → Mkopo" in rules
    assert "NMB: keep “NMB” untranslated." in rules
    assert "Always include: Welcome." in rules
    assert "Never use: Hi there." in rules
    assert "1,500,000 Ŧ" in rules  # money example uses the profile's separators
    assert "Q: salio?" in rules and "A: Salio lako ni sawa." in rules


def test_compile_specialist_names_and_embeds_rules():
    spec = compile_specialist(_profile(), [])
    assert spec["name"] == "Locale Specialist · Test Locale"
    assert "Testish" in spec["description"]
    assert "LOCALE PROFILE" in spec["system_prompt"]


class _FakeRequest:
    def __init__(self, prompt):
        self.system_prompt = prompt

    def override(self, **kwargs):
        return kwargs["system_message"].content


def test_middleware_appends_rules_to_existing_prompt():
    mw = LocaleMiddleware(_profile(), [])
    out = mw._apply(_FakeRequest("BASE PROMPT"))
    assert "BASE PROMPT" in out and out.index("BASE PROMPT") < out.index("LOCALE PROFILE")


def test_middleware_uses_rules_alone_without_system_prompt():
    out = LocaleMiddleware(_profile(), [])._apply(_FakeRequest(None))
    assert out.startswith("LOCALE PROFILE")


def test_generated_subagent_id_is_deterministic_and_agent_scoped():
    a = generated_subagent_id("t", "p", "a1")
    assert a == generated_subagent_id("t", "p", "a1")
    assert a != generated_subagent_id("t", "p", "a2")
    assert a != generated_subagent_id("t2", "p", "a1")
