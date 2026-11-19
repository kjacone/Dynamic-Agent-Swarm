"""Localisation profiles and reviewer corrections.

A profile is locale data, not code: languages, register, terminology, formats and
the phrases the reviewer wants kept or avoided. Attaching it to an agent compiles
a locale specialist subagent plus runtime rules; corrections on the same profile
become few-shot examples for that specialist.
"""
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import JSON, Column, Text
from sqlmodel import Field, SQLModel


class LocaleProfile(SQLModel, table=True):
    __tablename__ = "locale_profiles"

    id: str = Field(primary_key=True)
    name: str = Field(index=True)                     # "Kiswahili (Tanzania)"
    locale_code: str = Field(default="", index=True)  # BCP 47: sw-TZ, fr-CA, ar-AE
    languages: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    default_language: str = Field(default="")
    register_style: str = Field(default="formal")      # formal | neutral | casual
    code_switch_policy: str = Field(default="allowed")  # off | allowed | encouraged
    # Presentation. Empty values mean "leave the text alone".
    currency_code: str = Field(default="")
    currency_symbol: str = Field(default="")
    currency_position: str = Field(default="before")  # before | after
    decimal_sep: str = Field(default=".")
    thousand_sep: str = Field(default=",")
    date_format: str = Field(default="")              # e.g. DD/MM/YYYY (blank = no rewrite)
    # Terminology and tone.
    glossary: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    #   [{"source": "Savings account", "target": "Akaunti ya akiba", "keep": false}]
    replacements: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    #   [{"from": "Hello", "to": "Karibu"}] applied to output deterministically
    required_phrases: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    banned_phrases: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    # Cases used when seeding a locale eval dataset on an agent.
    sample_cases: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    #   [{"input": "hello", "expected_contains": "Karibu"}]
    # How localised input is understood.
    understanding: dict = Field(default_factory=dict, sa_column=Column(JSON))
    #   {"auto_detect": true, "languages": ["Kiswahili", "English"],
    #    "translate_to": "", "notes": ""}
    # How replies are localised.
    output: dict = Field(default_factory=dict, sa_column=Column(JSON))
    #   {"mode": "mirror|fixed|bilingual", "language": "Kiswahili",
    #    "second_language": "English", "localise_tools": true}
    # How the dialect should sound. Read by the voice line and the agent-kit
    # phone component; empty means "browser voice at the default settings".
    speech: dict = Field(default_factory=dict, sa_column=Column(JSON))
    #   {"provider": "elevenlabs", "voice_id": "", "model_id": "eleven_multilingual_v2",
    #    "stability": 0.5, "similarity": 0.75, "style": 0.0, "speed": 1.0,
    #    "greeting": "", "accents": [{"label": "Dar es Salaam", "note": ""}]}
    # Which model the locale specialist runs on, and how hard it should try.
    inference: dict = Field(default_factory=dict, sa_column=Column(JSON))
    #   {"model": "", "temperature": 0.3, "reasoning": "off|light|deep",
    #    "fallback_model": "", "notes": ""}
    # How corrections become training data.
    training: dict = Field(default_factory=dict, sa_column=Column(JSON))
    #   {"capture": false, "format": "chat|plain|preference", "verifier": "eval",
    #    "min_pairs": 20, "target_job": "", "notes": ""}
    notes: str = Field(default="", sa_column=Column(Text))
    enabled: bool = Field(default=True)
    tenant_id: str = Field(default="default", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class LocaleExample(SQLModel, table=True):
    """A reviewer correction compiled into the locale specialist's few-shot block."""

    __tablename__ = "locale_examples"

    id: str = Field(primary_key=True)
    profile_id: str = Field(index=True)
    tenant_id: str = Field(default="default", index=True)
    agent_id: Optional[str] = Field(default=None, index=True)
    input: str = Field(default="", sa_column=Column(Text))
    bad_output: Optional[str] = Field(default=None, sa_column=Column(Text))
    corrected_output: str = Field(default="", sa_column=Column(Text))
    note: str = Field(default="")
    source: str = Field(default="manual")  # manual | conversation | feedback
    feedback_id: Optional[str] = Field(default=None)
    enabled: bool = Field(default=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
