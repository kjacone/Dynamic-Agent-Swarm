"""Compile locale data into prompts and normalise user-visible output.

Two consumers share one profile:

* ``compile_rules`` / ``compile_specialist`` produce the runtime instruction block
  injected by ``LocaleMiddleware`` and the system prompt of the generated
  "Locale Specialist" subagent.
* ``format_reply`` is the deterministic pass applied to the final text: explicit
  phrase replacements, currency presentation and date layout. It runs after output
  policy screening, so redactions are never undone.

Nothing here is English/Swahili specific: languages, terms, formats and review
examples all come from the profile row.
"""
from __future__ import annotations

import re
from typing import Any

MAX_GLOSSARY = 60
MAX_EXAMPLES = 20


def _g(profile: Any, name: str, default=""):
    value = getattr(profile, name, default)
    return default if value is None else value


def _currency_tokens(profile) -> list[str]:
    tokens = {_g(profile, "currency_code").strip(), _g(profile, "currency_symbol").strip()}
    return sorted((t for t in tokens if t), key=len, reverse=True)


def _money_example(profile) -> str:
    sym = _g(profile, "currency_symbol") or _g(profile, "currency_code")
    sep = _g(profile, "thousand_sep", ",")
    amount = f"1{sep}500{sep}000"
    if _g(profile, "currency_position") == "after":
        return f"{amount} {sym}".strip()
    return f"{sym} {amount}".strip()


def compile_rules(profile, examples: list[Any] | None = None) -> str:
    """The locale instruction block injected on every model call."""
    name = _g(profile, "name") or _g(profile, "locale_code") or "locale"
    code = _g(profile, "locale_code")
    languages = [str(x) for x in (_g(profile, "languages", []) or []) if str(x).strip()]
    default = _g(profile, "default_language") or (languages[0] if languages else "")

    understanding = _g(profile, "understanding", {}) or {}
    if not isinstance(understanding, dict):
        understanding = {}
    output = _g(profile, "output", {}) or {}
    if not isinstance(output, dict):
        output = {}

    lines = [f"LOCALE PROFILE — {name}" + (f" ({code})" if code else "") + "."]
    lines.append("Apply this profile to every user-visible sentence, including tool explanations.")
    if default and not output:
        lines.append(f"Write replies in {default}.")
    if languages:
        lines.append("The user may write in any of: " + ", ".join(languages) + ".")

    # Understanding localised input.
    input_langs = [str(x) for x in (understanding.get("languages") or []) if str(x).strip()] or languages
    if understanding.get("auto_detect"):
        hint = f" ({', '.join(input_langs)})" if input_langs else ""
        lines.append(
            f"Localised input: detect which language each message is written in{hint}, "
            "including messages that mix languages or use local spelling. Answer the request as written."
        )
        lines.append("If the customer switches language mid-conversation, follow the new language.")
    translate_to = str(understanding.get("translate_to") or "").strip()
    if translate_to:
        lines.append(
            f"Understand localised input by reading it as {translate_to} internally; "
            "never mention translating or repeat the interpretation."
        )
    input_notes = str(understanding.get("notes") or "").strip()
    if input_notes:
        lines.append("Input notes: " + input_notes[:400])

    # Localised output.
    if output:
        mode = str(output.get("mode") or "mirror").lower()
        lang = str(output.get("language") or "").strip() or default
        if mode == "fixed" and lang:
            lines.append(
                f"Reply language: always write the final answer in {lang}, "
                "even when the customer writes in another language."
            )
        elif mode == "bilingual" and lang:
            second = str(output.get("second_language") or "").strip()
            if not second:
                others = [x for x in languages if x.lower() != lang.lower()]
                second = others[0] if others else ("English" if lang.lower() != "english" else "")
            lines.append(
                f"Reply language: write the answer in {lang}"
                + (f", then repeat the same answer briefly in {second}." if second else ".")
            )
        else:
            lines.append("Reply language: mirror the language and mix of the customer's latest message.")
        if output.get("localise_tools"):
            lines.append(
                "Localise tool results the customer sees (names, statuses, categories) while keeping "
                "identifiers, amounts and codes exactly as returned."
            )

    policy = (_g(profile, "code_switch_policy") or "allowed").lower()
    fixed_output = str(output.get("mode") or "").lower() == "fixed"
    if not fixed_output:  # with a fixed reply language, the directive above governs
        if policy == "off":
            lines.append("Do not mix languages; keep the reply entirely in the primary language.")
        elif policy == "encouraged":
            lines.append("Natural code-switching is welcome where the audience uses it; keep it consistent.")
        else:
            lines.append("Mirror the user's language mix; do not switch languages on your own.")
    formality = (_g(profile, "register_style") or "formal").lower()
    lines.append({
        "casual": "Tone: casual and friendly.",
        "neutral": "Tone: neutral and clear.",
    }.get(formality, "Tone: formal and respectful."))

    tokens = _currency_tokens(profile)
    if tokens:
        position = _g(profile, "currency_position") or "before"
        where = "after the amount" if position == "after" else "before the amount"
        lines.append(
            f"Money: always use {_g(profile, 'currency_code') or tokens[0]} "
            f"with the symbol {('“' + _g(profile, 'currency_symbol') + '”') if _g(profile, 'currency_symbol') else '(code only)'} "
            f"{where}, for example {_money_example(profile)}. "
            f"Thousands separator “{_g(profile, 'thousand_sep', ',')}”, "
            f"decimal separator “{_g(profile, 'decimal_sep', '.')}”. Never convert the amount."
        )
    date_format = _g(profile, "date_format")
    if date_format:
        lines.append(f"Dates: write as {date_format}.")

    glossary = [x for x in (_g(profile, "glossary", []) or []) if isinstance(x, dict) and x.get("source")]
    if glossary:
        lines.append("Terminology (use the target term; text marked keep stays as written):")
        for item in glossary[:MAX_GLOSSARY]:
            src = str(item.get("source", ""))
            tgt = str(item.get("target", ""))
            if item.get("keep"):
                lines.append(f"- {src}: keep “{src}” untranslated.")
            elif tgt:
                lines.append(f"- {src} → {tgt}")
    required = [str(x) for x in (_g(profile, "required_phrases", []) or []) if str(x).strip()]
    if required:
        lines.append("Always include: " + "; ".join(required[:20]) + ".")
    banned = [str(x) for x in (_g(profile, "banned_phrases", []) or []) if str(x).strip()]
    if banned:
        lines.append("Never use: " + "; ".join(banned[:20]) + ".")

    speech = _g(profile, "speech", {}) or {}
    if isinstance(speech, dict):
        delivery = str(speech.get("delivery") or "").strip()
        if delivery:
            lines.append(f"Spoken delivery (phone and voice channels): {delivery[:400]}")
        greeting = str(speech.get("greeting") or "").strip()
        if greeting:
            lines.append(f"Open a voice call with: {greeting[:300]}")

    notes = _g(profile, "notes").strip()
    if notes:
        lines.append("Reviewer notes: " + notes[:800])

    pairs = [e for e in (examples or []) if _g(e, "input").strip() and _g(e, "corrected_output").strip()]
    if pairs:
        lines.append("Reviewed answers — follow their wording and tone:")
        for ex in pairs[-MAX_EXAMPLES:]:
            lines.append(f"Q: {_g(ex, 'input').strip()[:500]}")
            lines.append(f"A: {_g(ex, 'corrected_output').strip()[:800]}")
    return "\n".join(lines)


def compile_specialist(profile, examples: list[Any] | None = None) -> dict[str, str]:
    """Name, description and system prompt for the generated subagent."""
    name = _g(profile, "name") or _g(profile, "locale_code") or "Locale"
    code = _g(profile, "locale_code")
    default = _g(profile, "default_language")
    description = (
        f"Localises replies for {name}" + (f" ({code})" if code else "") +
        (f"; writes in {default}" if default else "") +
        ". Delegate when the answer needs translation, terminology from the glossary, "
        "or local currency and date conventions. Return only the localised answer."
    )
    prompt = (
        f"You are the localisation specialist for {name}.\n"
        "Localise the text you are given without adding new facts, changing amounts, or "
        "renaming products. Apply the terminology and presentation rules below. If a term "
        "is missing from the glossary and its translation is uncertain, keep the source term.\n\n"
        + compile_rules(profile, examples)
    )
    return {"name": f"Locale Specialist · {name}", "description": description,
            "system_prompt": prompt}


def _format_amount(raw: str, decimal_sep: str, thousand_sep: str) -> str:
    cleaned = raw.replace("\u00a0", "").replace(" ", "")
    frac = ""
    if "." in cleaned:
        int_part, frac = cleaned.rsplit(".", 1)
    else:
        int_part = cleaned
    digits = "".join(ch for ch in int_part if ch.isdigit())
    if not digits:
        return raw
    groups: list[str] = []
    while len(digits) > 3:
        groups.insert(0, digits[-3:])
        digits = digits[:-3]
    groups.insert(0, digits)
    out = thousand_sep.join(groups)
    return f"{out}{decimal_sep}{frac}" if frac else out


def format_reply(text: str, profile) -> str:
    """Deterministic output normalisation. Unknown/blank rules are no-ops."""
    if not text or profile is None:
        return text

    for rule in _g(profile, "replacements", []) or []:
        if not isinstance(rule, dict):
            continue
        src, dst = str(rule.get("from", "")), str(rule.get("to", ""))
        if src and src in text:
            text = text.replace(src, dst)

    tokens = _currency_tokens(profile)
    if tokens:
        symbol = _g(profile, "currency_symbol") or _g(profile, "currency_code")
        position = _g(profile, "currency_position") or "before"
        decimal_sep = _g(profile, "decimal_sep", ".") or "."
        thousand_sep = _g(profile, "thousand_sep", ",") or ","
        pattern = re.compile(
            r"(?<![\w])(" + "|".join(re.escape(t) for t in tokens) + r")\s?"
            r"(\d[\d.,\u00a0]*\d|\d)(?![\w])",
            re.IGNORECASE,
        )

        def money(m: re.Match) -> str:
            amount = _format_amount(m.group(2), decimal_sep, thousand_sep)
            return f"{amount} {symbol}".strip() if position == "after" else f"{symbol} {amount}".strip()

        text = pattern.sub(money, text)

    date_format = _g(profile, "date_format").strip()
    if date_format:
        fmt = date_format.upper()

        def date(m: re.Match) -> str:
            y, mo, d = m.group(1), m.group(2), m.group(3)
            return fmt.replace("YYYY", y).replace("MM", mo).replace("DD", d).replace("YY", y)

        text = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", date, text)
    return text
