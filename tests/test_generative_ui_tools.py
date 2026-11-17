import json

from nmb_marketplace_agent.enterprise.solutions.loader import BUILTIN_TOOLS
from nmb_marketplace_agent.tools.builtin.generative_ui import (
    ui_alert,
    ui_cards,
    ui_chart,
    ui_form,
    ui_render,
    ui_stats,
    ui_status,
    ui_table,
    ui_timeline,
)
from nmb_marketplace_agent.tools.registry import _BUILTINS

UI_TOOLS = ["ui_cards", "ui_table", "ui_stats", "ui_chart", "ui_timeline", "ui_status", "ui_form", "ui_alert", "ui_render"]


def spec(result: str) -> dict:
    payload = json.loads(result)
    assert set(payload) == {"ui"}
    assert isinstance(payload["ui"].get("type"), str)
    return payload["ui"]


def test_generative_tools_are_registered():
    for name in UI_TOOLS:
        assert name in _BUILTINS
        assert name in BUILTIN_TOOLS


def test_cards_accept_objects_and_json_strings():
    direct = spec(ui_cards.invoke({"title": "Plans", "items": [{"name": "Basic"}], "subtitle": "3 tiers"}))
    assert direct["type"] == "cards" and direct["items"][0]["name"] == "Basic"
    assert direct["subtitle"] == "3 tiers"

    encoded = spec(ui_cards.invoke({"title": "Plans", "items": '[{"name": "Pro"}]'}))
    assert encoded["items"] == [{"name": "Pro"}]


def test_table_derives_columns_from_rows():
    data = spec(ui_table.invoke({"title": "Rows", "rows": '[{"account": "A-1", "balance": 12000}]'}))
    assert data["type"] == "table" and data["rows"][0]["account"] == "A-1"


def test_stats_accepts_a_label_to_value_map():
    data = spec(ui_stats.invoke({"title": "Today", "metrics": {"Tickets": 34, "Reopened": 2}}))
    assert data["items"] == [{"label": "Tickets", "value": 34}, {"label": "Reopened", "value": 2}]


def test_chart_normalises_values_and_series():
    bars = spec(ui_chart.invoke({"title": "Volume", "labels": '["Mon","Tue"]', "values": "[12,18]"}))
    assert bars["kind"] == "bar" and bars["series"][0]["data"] == [12, 18]

    lines = spec(ui_chart.invoke({"title": "Volume", "kind": "line", "labels": ["Mon", "Tue"],
                                  "values": "", "series": '[{"name":"A","data":[1,2]},{"name":"B","data":[2,1]}]'}))
    assert lines["kind"] == "line" and [s["name"] for s in lines["series"]] == ["A", "B"]


def test_status_infers_tone_from_the_value():
    data = spec(ui_status.invoke({"title": "Checks", "checks": {"Sanctions": "clear", "ID": "fail"}}))
    tones = {i["label"]: i["status"] for i in data["items"]}
    assert tones == {"Sanctions": "ok", "ID": "bad"}


def test_timeline_form_and_alert_shapes():
    assert spec(ui_timeline.invoke({"title": "Case", "events": '[{"title": "Received"}]'}))["items"][0]["title"] == "Received"
    form = spec(ui_form.invoke({"title": "Details", "fields": '[{"name": "amount","label": "Amount"}]', "submit_label": "Send"}))
    assert form["submit"] == {"label": "Send"}
    assert spec(ui_alert.invoke({"title": "Heads up", "message": "Policy changed", "tone": "warn"}))["tone"] == "warn"


def test_render_is_the_escape_hatch_for_ready_made_specs():
    data = spec(ui_render.invoke({"spec": '{"ui":{"type":"actions","items":["Yes","No"]}}'}))
    assert data["type"] == "actions" and data["items"] == ["Yes", "No"]
    assert spec(ui_render.invoke({"spec": "plain text"}))["body"] == "plain text"
