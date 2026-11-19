import json

import pytest

from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.training import media, providers, sources, store

ENV_KEYS = ("HF_TOKEN", "KAGGLE_USERNAME", "KAGGLE_KEY", "ROBOFLOW_API_KEY",
            "CEREBRAS_API_KEY", "OPENAI_API_KEY")


class Resp:
    """Minimal stand-in for httpx.Response."""

    def __init__(self, payload=None, text="", content=b"", status=200, headers=None):
        self._payload = payload
        self.text = text
        self.content = content or text.encode()
        self.status_code = status
        self.headers = headers or {}
        self.reason_phrase = ""

    def json(self):
        if self._payload is None:
            raise ValueError("no json payload")
        return self._payload


@pytest.fixture(autouse=True)
def _root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "training_root", str(tmp_path / "training"))
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


# ── catalog ─────────────────────────────────────────────────────────
def test_catalog_explains_every_source():
    cat = sources.catalog()
    by_id = {s["id"]: s for s in cat["sources"]}
    assert set(by_id) == {
        "huggingface", "kaggle", "openml", "uci", "google_dataset_search",
        "common_crawl", "roboflow", "common_voice", "openslr",
    }
    for src in cat["sources"]:
        assert src["url"].startswith("https://")
        assert src["about"] and src["how"] and len(src["how"]) >= 3
        assert src["connection"]["state"] in ("connected", "needs_key", "browse")
        assert "env" not in src
    assert "audio" in cat["modalities"]


def test_connection_states_follow_keys():
    by_id = {s["id"]: s for s in sources.catalog()["sources"]}
    assert by_id["huggingface"]["connection"]["state"] == "connected"
    assert by_id["huggingface"]["needs"] == ["HF_TOKEN"]
    assert by_id["openml"]["connection"]["state"] == "connected"
    assert by_id["openml"]["needs"] == []
    # Kaggle search is public, so it reads as connected with a hint, not a wall.
    assert by_id["kaggle"]["connection"]["state"] == "connected"
    assert "KAGGLE_USERNAME" in by_id["kaggle"]["connection"]["detail"]
    assert by_id["roboflow"]["connection"]["state"] == "needs_key"
    assert by_id["common_voice"]["connection"]["state"] == "browse"
    assert by_id["openslr"]["connection"]["state"] == "browse"


def test_openslr_links_and_key_state(monkeypatch):
    src = next(s for s in sources.SOURCES if s["id"] == "openslr")
    assert any("LibriSpeech" in link["label"] for link in src["links"])

    monkeypatch.setenv("KAGGLE_USERNAME", "demo")
    monkeypatch.setenv("KAGGLE_KEY", "secret")
    kaggle = next(s for s in sources.catalog()["sources"] if s["id"] == "kaggle")
    assert kaggle["connection"]["detail"] == "Using KAGGLE_USERNAME, KAGGLE_KEY."


def test_unknown_source_is_rejected():
    with pytest.raises(store.TrainingError):
        sources._source("nowhere")


# ── search ──────────────────────────────────────────────────────────
async def test_hf_search_normalises_results(monkeypatch):
    payload = [
        {"id": "tatsu-lab/alpaca", "description": "An instruction set.\nWith 52k rows.",
         "downloads": 1200, "likes": 30, "tags": ["modality:text"], "gated": False},
        {"id": "private/set", "downloads": 0, "gated": True},
    ]

    async def fake_get(url, **kw):
        assert "huggingface.co/api/datasets" in url
        return Resp(payload=payload)

    monkeypatch.setattr(sources, "_get", fake_get)
    out = await sources.search("huggingface", "alpaca", limit=5)
    assert out["source"] == "huggingface"
    first, second = out["results"]
    assert first["id"] == "tatsu-lab/alpaca"
    assert first["url"] == "https://huggingface.co/datasets/tatsu-lab/alpaca"
    assert "\n" not in first["description"]
    assert {"label": "Modalities", "value": "text"} in first["meta"]
    assert second["flag"] == "Gated"


async def test_kaggle_search_is_sliced_to_limit(monkeypatch):
    rows = [{"refNullable": f"owner/set-{i}", "titleNullable": f"Set {i}",
             "urlNullable": f"https://kaggle.com/datasets/owner/set-{i}",
             "totalBytesNullable": 2_500_000} for i in range(20)]

    async def fake_get(url, **kw):
        return Resp(payload=rows)

    monkeypatch.setattr(sources, "_get", fake_get)
    out = await sources.search("kaggle", "churn", limit=2)
    assert len(out["results"]) == 2
    assert {"label": "Size", "value": "2.5 MB"} in out["results"][0]["meta"]


async def test_uci_search_uses_curated_catalog():
    out = await sources.search("uci", "cancer", limit=5)
    assert [r["id"] for r in out["results"]] == ["17"]
    everything = await sources.search("uci", "", limit=3)
    assert len(everything["results"]) == 3


async def test_roboflow_search_needs_a_key():
    with pytest.raises(store.TrainingError, match="ROBOFLOW_API_KEY"):
        await sources.search("roboflow", "helmet")


async def test_browse_only_source_cannot_search():
    with pytest.raises(store.TrainingError, match="no public search"):
        await sources.search("common_crawl", "news")


# ── previews ────────────────────────────────────────────────────────
async def test_hf_preview_suggests_columns(monkeypatch):
    async def fake_get(url, **kw):
        if url.endswith("/splits"):
            return Resp(payload={"splits": [{"config": "default", "split": "train"}]})
        assert kw["params"]["config"] == "default"
        return Resp(payload={
            "features": [{"name": "instruction"}, {"name": "output"}],
            "rows": [{"row": {"instruction": "Do you deliver?", "output": "Yes."}}],
        })

    monkeypatch.setattr(sources, "_get", fake_get)
    out = await sources.preview("huggingface", "tatsu-lab/alpaca", sample=4)
    assert out["fields"] == ["instruction", "output"]
    assert out["rows"] == [{"instruction": "Do you deliver?", "output": "Yes."}]
    assert out["suggested"] == {"instruction": "instruction", "output": "output"}
    assert out["detail"] == "default / train"


async def test_hf_preview_rejects_a_bare_name():
    with pytest.raises(store.TrainingError, match="Hub id"):
        await sources.preview("huggingface", "alpaca")


async def test_uci_preview_reads_the_csv(monkeypatch):
    async def fake_get(url, **kw):
        if "api/dataset" in url:
            return Resp(payload={"data": {"name": "Iris", "num_instances": 150,
                                          "data_url": "https://archive.ics.uci.edu/x/iris.csv"}})
        return Resp(text="sepal_length,species\n5.1,setosa\n6.2,virginica\n")

    monkeypatch.setattr(sources, "_get", fake_get)
    out = await sources.preview("uci", "53", sample=10)
    assert out["fields"] == ["sepal_length", "species"]
    assert out["rows"][1] == {"sepal_length": "6.2", "species": "virginica"}
    assert out["total"] == 150
    assert out["suggested"]["output"] == ""

    with pytest.raises(store.TrainingError, match="numeric dataset id"):
        await sources.preview("uci", "iris")


# ── import ──────────────────────────────────────────────────────────
HF_ROWS = [
    {"row": {"instruction": "Refund?", "output": "Within 7 days."}},
    {"row": {"instruction": "Delivery?", "output": ""}},
    {"row": {"instruction": "Hours?", "output": "8 to 5."}},
]


async def test_hf_import_writes_a_dataset(monkeypatch):
    async def fake_get(url, **kw):
        if url.endswith("/splits"):
            return Resp(payload={"splits": [{"config": "default", "split": "train"}]})
        return Resp(payload={
            "features": [{"name": "instruction"}, {"name": "output"}],
            "rows": HF_ROWS,
        })

    monkeypatch.setattr(sources, "_get", fake_get)
    out = await sources.import_dataset({
        "source": "huggingface", "dataset": "tatsu-lab/alpaca",
        "name": "alpaca-small", "limit": 10,
    })
    assert out["rows"] == 2 and out["fetched"] == 3 and out["skipped"] == 1
    assert out["fields"] == {"instruction": "instruction", "output": "output"}
    saved = json.loads(store.dataset_path("alpaca-small").read_text())
    assert saved == [
        {"instruction": "Refund?", "input": "", "output": "Within 7 days."},
        {"instruction": "Hours?", "input": "", "output": "8 to 5."},
    ]


async def test_import_explains_bad_column_choices(monkeypatch):
    async def fake_get(url, **kw):
        if url.endswith("/splits"):
            return Resp(payload={"splits": [{"config": "default", "split": "train"}]})
        return Resp(payload={"features": [{"name": "instruction"}, {"name": "output"}], "rows": HF_ROWS})

    monkeypatch.setattr(sources, "_get", fake_get)
    base = {"source": "huggingface", "dataset": "tatsu-lab/alpaca", "name": "x"}
    with pytest.raises(store.TrainingError, match="available columns"):
        await sources.import_dataset({**base, "instruction_field": "question"})
    with pytest.raises(store.TrainingError, match="must be different"):
        await sources.import_dataset({**base, "instruction_field": "output", "output_field": "output"})


async def test_import_rejects_sources_and_empty_rows(monkeypatch):
    with pytest.raises(store.TrainingError, match="through its website"):
        await sources.import_dataset({"source": "kaggle", "dataset": "x", "name": "x"})

    async def empty_get(url, **kw):
        if url.endswith("/splits"):
            return Resp(payload={"splits": [{"config": "default", "split": "train"}]})
        return Resp(payload={"features": [{"name": "instruction"}, {"name": "output"}],
                             "rows": [{"row": {"instruction": "", "output": ""}}]})

    monkeypatch.setattr(sources, "_get", empty_get)
    with pytest.raises(store.TrainingError, match="No row had both columns"):
        await sources.import_dataset({"source": "huggingface", "dataset": "a/b", "name": "x"})


async def test_openml_import_parses_arff(monkeypatch):
    arff = """@RELATION demo
@ATTRIBUTE question STRING
@ATTRIBUTE 'answer' STRING
@DATA
'What time do you open?','We open at 8, every day'
'Where are you?','Mwanza branch'
"""

    async def fake_get(url, **kw):
        assert "/data/v1/download/61" in url
        return Resp(text=arff)

    monkeypatch.setattr(sources, "_get", fake_get)
    out = await sources.import_dataset({
        "source": "openml", "dataset": "61", "name": "openml-demo",
        "instruction_field": "question", "output_field": "answer",
    })
    assert out["rows"] == 2
    saved = json.loads(store.dataset_path("openml-demo").read_text())
    assert saved[0]["output"] == "We open at 8, every day"


# ── ARFF helpers ────────────────────────────────────────────────────
def test_arff_parser_handles_quotes_and_short_rows():
    fields, rows = sources._parse_arff(
        "% comment\n@RELATION demo\n@ATTRIBUTE question STRING\n"
        "@ATTRIBUTE 'answer' STRING\n@DATA\n"
        "'Hello, there','Hi'\nlonely\n"
    )
    assert fields == ["question", "answer"]
    assert rows == [
        {"question": "Hello, there", "answer": "Hi"},
        {"question": "lonely", "answer": ""},
    ]


# ── providers ───────────────────────────────────────────────────────
def test_provider_list_states():
    items = {p["id"]: p for p in providers.list_providers()["providers"]}
    assert set(items) == {"colab", "kaggle", "huggingface", "cerebras"}
    assert items["colab"]["connection"]["state"] == "ready"
    assert items["kaggle"]["connection"]["state"] == "ready"
    assert items["cerebras"]["connection"]["state"] == "needs_key"
    assert items["cerebras"]["needs"] == ["CEREBRAS_API_KEY"]
    for prov in items.values():
        assert prov["steps"] and prov["url"].startswith("https://")


async def test_cerebras_check_needs_a_key():
    with pytest.raises(store.TrainingError, match="CEREBRAS_API_KEY"):
        await providers.check("cerebras")
    ready = await providers.check("colab")
    assert ready["state"] == "ready"


async def test_cerebras_check_lists_models(monkeypatch):
    monkeypatch.setenv("CEREBRAS_API_KEY", "ck-test")

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            assert headers["Authorization"] == "Bearer ck-test"
            return Resp(payload={"data": [{"id": "llama3.1-8b"}, {"id": "qwen-3-32b"}, {}]})

    monkeypatch.setattr(providers.httpx, "AsyncClient", Client)
    out = await providers.check("cerebras")
    assert out["state"] == "connected"
    assert out["models"] == ["llama3.1-8b", "qwen-3-32b"]


async def test_cerebras_check_maps_rejection(monkeypatch):
    monkeypatch.setenv("CEREBRAS_API_KEY", "wrong")

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            return Resp(status=403)

    monkeypatch.setattr(providers.httpx, "AsyncClient", Client)
    with pytest.raises(store.TrainingError, match="rejected the key"):
        await providers.check("cerebras")


# ── media options ───────────────────────────────────────────────────
def test_media_options_mark_what_is_configured():
    opts = media.options()
    image = {p["id"]: p for p in opts["image"]}
    video = {p["id"]: p for p in opts["video"]}
    assert set(image) == {"sample", "openai", "huggingface"}
    assert set(video) == {"sample", "huggingface"}
    assert image["sample"]["configured"] and image["sample"]["note"] == "Sample — no model call"
    assert not image["openai"]["configured"]
    assert image["openai"]["note"] == "Set OPENAI_API_KEY in API keys"
    assert opts["sizes"] == media.IMAGE_SIZES
    assert opts["durations"] == media.VIDEO_DURATIONS


def test_media_options_go_live_with_a_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    opts = media.options()
    openai = next(p for p in opts["image"] if p["id"] == "openai")
    assert openai["configured"] and openai["note"] == "Live"


# ── media generation ────────────────────────────────────────────────
async def test_sample_image_is_a_labelled_svg():
    out = await media.generate({"kind": "image", "provider": "sample",
                                "prompt": "A red bicycle", "size": "1536x1024"})
    assert out["sample"] is True and out["frames"] == []
    assert out["mime"] == "image/svg+xml"
    assert out["data_url"].startswith("data:image/svg+xml;base64,")
    svg = media.base64.b64decode(out["data_url"].split(",", 1)[1]).decode()
    assert "width=\"1536\"" in svg and "A red bicycle" in svg
    assert "SAMPLE PREVIEW" in svg


async def test_sample_video_is_a_four_frame_storyboard():
    out = await media.generate({"kind": "video", "provider": "sample",
                                "prompt": "Market at sunrise", "duration": 6})
    assert out["sample"] is True
    assert len(out["frames"]) == 4
    assert out["data_url"] == out["frames"][0]
    assert "6s storyboard" in out["note"]


async def test_unconfigured_provider_is_explained():
    with pytest.raises(store.TrainingError, match="not configured — set OPENAI_API_KEY"):
        await media.generate({"kind": "image", "provider": "openai", "prompt": "A logo"})


async def test_media_validation():
    with pytest.raises(store.TrainingError, match="kind must be"):
        await media.generate({"kind": "audio", "prompt": "A logo"})
    with pytest.raises(store.TrainingError, match="cannot generate videos"):
        await media.generate({"kind": "video", "provider": "openai", "prompt": "A logo"})
    with pytest.raises(store.TrainingError, match="at least 3"):
        await media.generate({"kind": "image", "prompt": "hi"})
    with pytest.raises(store.TrainingError, match="size must be"):
        await media.generate({"kind": "image", "prompt": "A logo", "size": "10x10"})
    with pytest.raises(store.TrainingError, match="duration must be"):
        await media.generate({"kind": "video", "prompt": "A logo", "duration": 5})


async def test_openai_generation_returns_a_data_url(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None):
            assert json["model"] == "gpt-image-1"
            return Resp(payload={"data": [{"b64_json": "aGk="}]})

    monkeypatch.setattr(media.httpx, "AsyncClient", Client)
    out = await media.generate({"kind": "image", "provider": "openai", "prompt": "A logo"})
    assert out["sample"] is False and out["provider"] == "openai"
    assert out["data_url"] == "data:image/png;base64,aGk="


async def test_hf_rejects_a_non_media_reply(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "hf-test")

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None):
            return Resp(text='{"error":"loading"}', headers={"content-type": "application/json"})

    monkeypatch.setattr(media.httpx, "AsyncClient", Client)
    with pytest.raises(store.TrainingError, match="non-media response"):
        await media.generate({"kind": "image", "provider": "huggingface", "prompt": "A logo"})
