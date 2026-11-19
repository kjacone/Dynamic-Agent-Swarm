"""Public dataset hubs, with an explicit connection state for each source.

The console explains every source the same way — what it contains, whether it
is reachable without a key, and what the next step is. Hugging Face, OpenML and
UCI can be searched, previewed and imported into a local training dataset.
Kaggle search is public; downloads need Kaggle API credentials. The rest are
browse-only because they have no public search API (or the corpus is too large
to copy through this console).
"""
from __future__ import annotations

import csv
import io
import re
from typing import Any
from urllib.parse import quote

import httpx

from nmb_marketplace_agent.integrations import provider_keys
from nmb_marketplace_agent.training import store

TIMEOUT = 25.0
MAX_DOWNLOAD = 8 * 1024 * 1024
MAX_FIELD_CHARS = 4000
MODALITIES = ("text", "image", "audio", "video", "tabular")

SOURCES: list[dict[str, Any]] = [
    {
        "id": "huggingface",
        "name": "Hugging Face",
        "about": "The largest open dataset hub: instruction sets, image, video and audio corpora. Public datasets need no key.",
        "modalities": ["text", "image", "audio", "video"],
        "url": "https://huggingface.co/datasets",
        "env": ["HF_TOKEN"],
        "optional_auth": True,
        "searchable": True,
        "previewable": True,
        "importable": True,
        "examples": ["alpaca", "squad", "medical", "swahili", "audio", "image captions"],
        "how": [
            "Search the Hub here",
            "Preview the first rows",
            "Pick the instruction and output columns",
            "Save it as a local dataset",
        ],
    },
    {
        "id": "kaggle",
        "name": "Kaggle",
        "about": "Community datasets with public metadata search. Downloads use the Kaggle API or the website.",
        "modalities": ["text", "tabular", "image", "audio"],
        "url": "https://www.kaggle.com/datasets",
        "env": ["KAGGLE_USERNAME", "KAGGLE_KEY"],
        "optional_auth": True,
        "open_detail": "Public search works now; add KAGGLE_USERNAME and KAGGLE_KEY in API keys to enable API downloads.",
        "searchable": True,
        "previewable": False,
        "importable": False,
        "examples": ["customer churn", "sentiment", "swahili", "x-rays"],
        "how": [
            "Search public datasets here (no key)",
            "Open the dataset page",
            "Download the CSV there",
            "Upload it as a dataset — or set Kaggle credentials for API pulls",
        ],
    },
    {
        "id": "openml",
        "name": "OpenML",
        "about": "Thousands of curated, citable tabular datasets in ARFF format, with quality metadata.",
        "modalities": ["tabular", "text"],
        "url": "https://www.openml.org/search?type=data",
        "env": [],
        "searchable": True,
        "previewable": True,
        "importable": True,
        "examples": ["iris", "titanic", "adult", "credit-g"],
        "how": [
            "Search by dataset name",
            "Preview attributes and rows",
            "Map two attributes to instruction and output",
            "Import up to 1,000 rows",
        ],
    },
    {
        "id": "uci",
        "name": "UCI ML Repository",
        "about": "The classic academic benchmark collection. Popular sets are listed here with direct CSV import.",
        "modalities": ["tabular"],
        "url": "https://archive.ics.uci.edu/datasets",
        "env": [],
        "searchable": True,
        "previewable": True,
        "importable": True,
        "examples": ["iris", "adult", "wine", "phishing", "dropout"],
        "how": [
            "Search the curated classics",
            "Preview the CSV",
            "Map columns to instruction and output",
            "Import up to 1,000 rows",
        ],
    },
    {
        "id": "google_dataset_search",
        "name": "Google Dataset Search",
        "about": "Search engine across thousands of public data catalogs — an index, not a host.",
        "modalities": ["text", "tabular", "image", "audio", "video"],
        "url": "https://datasetsearch.research.google.com/",
        "browse": True,
        "browse_note": "Opens the search engine. Find a dataset, then upload its file here.",
        "searchable": False,
        "previewable": False,
        "importable": False,
        "examples": [],
        "how": ["Open Dataset Search", "Find the dataset and its licence", "Download the file", "Upload it in Datasets"],
    },
    {
        "id": "common_crawl",
        "name": "Common Crawl",
        "about": "A petabyte-scale monthly crawl of the web (WARC). Best mined with a pipeline, not bulk-imported.",
        "modalities": ["text"],
        "url": "https://commoncrawl.org/get-started",
        "browse": True,
        "browse_note": "Open the getting-started guide; crawl archives stay on Common Crawl's S3.",
        "searchable": False,
        "previewable": False,
        "importable": False,
        "examples": [],
        "how": ["Read the crawl overview", "Pick a WARC index range", "Extract text with a script", "Upload the curated rows here"],
    },
    {
        "id": "roboflow",
        "name": "Roboflow Universe",
        "about": "200k+ computer-vision datasets with annotations (detection, segmentation, classification).",
        "modalities": ["image", "video"],
        "url": "https://universe.roboflow.com/",
        "env": ["ROBOFLOW_API_KEY"],
        "searchable": True,
        "previewable": False,
        "importable": False,
        "examples": ["helmet", "defect", "ppe", "vehicles"],
        "how": ["Add ROBOFLOW_API_KEY in API keys", "Search Universe here", "Export in your format on Roboflow", "Train from the Vision tab"],
    },
    {
        "id": "common_voice",
        "name": "Mozilla Common Voice",
        "about": "Crowdsourced, CC0 speech in 130+ languages — the standard open voice corpus.",
        "modalities": ["audio"],
        "url": "https://commonvoice.mozilla.org/en/datasets",
        "browse": True,
        "browse_note": "Downloads need the Mozilla agreement; mirrors on Hugging Face are searchable here.",
        "searchable": False,
        "previewable": False,
        "importable": False,
        "examples": [],
        "how": ["Open Common Voice datasets", "Accept the licence and pick languages", "Download the clips + transcripts", "Use Hugging Face search for a ready mirror"],
    },
    {
        "id": "openslr",
        "name": "OpenSLR",
        "about": "Open speech corpora (LibriSpeech, AISHELL, THCHS-30, …) as direct tarballs for ASR/TTS.",
        "modalities": ["audio"],
        "url": "https://www.openslr.org/resources.php",
        "browse": True,
        "browse_note": "Open the resource list; each corpus downloads as a tarball.",
        "searchable": False,
        "previewable": False,
        "importable": False,
        "examples": [],
        "how": ["Open the resource list", "Pick a corpus (e.g. 12 LibriSpeech)", "Download the tarball", "Transcribe/curate rows and upload"],
        "links": [
            {"label": "12 · LibriSpeech (ASR)", "url": "https://www.openslr.org/12/"},
            {"label": "13 · LJSpeech (TTS)", "url": "https://www.openslr.org/13/"},
            {"label": "18 · THCHS-30 (zh)", "url": "https://www.openslr.org/18/"},
            {"label": "33 · AISHELL-1 (zh)", "url": "https://www.openslr.org/33/"},
            {"label": "51 · TED-LIUM 3", "url": "https://www.openslr.org/51/"},
            {"label": "60 · LibriTTS", "url": "https://www.openslr.org/60/"},
            {"label": "93 · AISHELL-3 (multi-speaker TTS)", "url": "https://www.openslr.org/93/"},
        ],
    },
]

# Curated UCI classics. Their API has no search endpoint; each id was checked
# against /api/dataset and resolves to a direct data.csv.
UCI_CATALOG = [
    {"id": "53", "title": "Iris", "tags": "flowers classification biology", "instances": 150, "features": 4},
    {"id": "2", "title": "Adult (Census Income)", "tags": "income census fairness tabular", "instances": 48842, "features": 14},
    {"id": "17", "title": "Breast Cancer Wisconsin (Diagnostic)", "tags": "cancer medical classification", "instances": 569, "features": 30},
    {"id": "109", "title": "Wine", "tags": "chemistry classification", "instances": 178, "features": 13},
    {"id": "45", "title": "Heart Disease", "tags": "medical cardiology classification", "instances": 920, "features": 13},
    {"id": "602", "title": "Dry Bean", "tags": "agriculture seeds classification", "instances": 13611, "features": 16},
    {"id": "697", "title": "Students' Dropout and Academic Success", "tags": "education dropout", "instances": 4424, "features": 36},
    {"id": "967", "title": "PhiUSIIL Phishing URL", "tags": "security phishing urls", "instances": 235795, "features": 53},
]


def _has(*names: str) -> bool:
    return all(provider_keys.get(n) for n in names)


def _hf_headers() -> dict[str, str]:
    token = provider_keys.get("HF_TOKEN") or ""
    return {"Authorization": f"Bearer {token}"} if token else {}


def _source(source_id: str) -> dict[str, Any]:
    for s in SOURCES:
        if s["id"] == source_id:
            return s
    raise store.TrainingError(f"Unknown dataset source: {source_id}")


def _status(src: dict[str, Any]) -> dict[str, str]:
    envs = src.get("env") or []
    if src.get("browse"):
        return {"state": "browse", "label": "Browse only", "detail": src["browse_note"]}
    if not envs:
        return {"state": "connected", "label": "Connected", "detail": "Public API — no key needed."}
    if _has(*envs):
        return {"state": "connected", "label": "Connected", "detail": f"Using {', '.join(envs)}."}
    if src.get("optional_auth"):
        detail = src.get("open_detail") or f"Public access; set {envs[0]} for gated or private datasets."
        return {"state": "connected", "label": "Connected", "detail": detail}
    return {"state": "needs_key", "label": "API key needed", "detail": f"Add {' and '.join(envs)} in API keys to unlock it."}


def catalog() -> dict[str, Any]:
    items = []
    for src in SOURCES:
        item = {k: v for k, v in src.items() if k not in ("env", "optional_auth")}
        item["connection"] = _status(src)
        item["needs"] = list(src.get("env") or [])
        items.append(item)
    return {"sources": items, "modalities": list(MODALITIES)}


# ── HTTP helpers (module-level so tests can stub them) ───────────────
async def _get(url: str, *, params: dict | None = None, headers: dict | None = None,
               auth: tuple[str, str] | None = None, timeout: float = TIMEOUT) -> httpx.Response:
    async with httpx.AsyncClient(follow_redirects=True, trust_env=False) as client:
        res = await client.get(url, params=params, headers=headers, auth=auth, timeout=timeout)
    res.raise_for_status()
    return res


def _fail(name: str, err: Exception) -> store.TrainingError:
    if isinstance(err, httpx.HTTPStatusError):
        return store.TrainingError(f"{name} returned HTTP {err.response.status_code} for this request.")
    if isinstance(err, (httpx.ConnectError, httpx.TimeoutException)):
        return store.TrainingError(f"Could not reach {name} — check the network and try again.")
    if isinstance(err, store.TrainingError):
        return err
    return store.TrainingError(f"{name}: {err}")


def _one_line(value: Any, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def _meta(pairs: list[tuple[str, Any]]) -> list[dict[str, str]]:
    return [{"label": k, "value": str(v)} for k, v in pairs if v not in (None, "", 0)]


# ── search ──────────────────────────────────────────────────────────
async def search(source_id: str, query: str, limit: int = 10) -> dict[str, Any]:
    src = _source(source_id)
    limit = min(max(int(limit), 1), 25)
    query = (query or "").strip()
    if not src["searchable"]:
        raise store.TrainingError(f"{src['name']} has no public search API — open the site instead.")
    if not query and source_id not in ("uci",):
        raise store.TrainingError("Type a name to search.")
    try:
        if source_id == "huggingface":
            results, note = await _search_hf(query, limit)
        elif source_id == "kaggle":
            results, note = await _search_kaggle(query, limit)
        elif source_id == "openml":
            results, note = await _search_openml(query, limit)
        elif source_id == "uci":
            results, note = _search_uci(query, limit)
        elif source_id == "roboflow":
            results, note = await _search_roboflow(query, limit)
        else:
            results, note = [], ""
    except store.TrainingError:
        raise
    except Exception as e:  # noqa: BLE001 - translated into a readable error
        raise _fail(src["name"], e) from e
    return {"source": source_id, "query": query, "note": note, "results": results}


async def _search_hf(query: str, limit: int) -> tuple[list[dict], str]:
    res = await _get(
        "https://huggingface.co/api/datasets",
        params={"search": query, "limit": limit, "sort": "downloads", "direction": -1},
        headers=_hf_headers(),
    )
    out = []
    for d in res.json():
        tags = d.get("tags") or []
        mods = sorted({t.split(":", 1)[1] for t in tags if t.startswith("modality:")})
        out.append({
            "id": str(d.get("id")),
            "title": str(d.get("id")),
            "description": _one_line(d.get("description")),
            "url": f"https://huggingface.co/datasets/{d.get('id')}",
            "meta": _meta([("Downloads", d.get("downloads")), ("Likes", d.get("likes")),
                           ("Modalities", ", ".join(mods) or None)]),
            "flag": "Gated" if d.get("gated") else "",
        })
    return out, "Public Hub search — preview and import work on ungated datasets."


def _kaggle_auth() -> tuple[str, str] | None:
    if _has("KAGGLE_USERNAME", "KAGGLE_KEY"):
        return (provider_keys.get("KAGGLE_USERNAME") or "", provider_keys.get("KAGGLE_KEY") or "")
    return None


async def _search_kaggle(query: str, limit: int) -> tuple[list[dict], str]:
    res = await _get(
        "https://www.kaggle.com/api/v1/datasets/list",
        params={"search": query, "pageSize": limit},
        auth=_kaggle_auth(),
    )
    out = []
    for d in res.json() or []:
        size = d.get("totalBytesNullable")
        out.append({
            "id": str(d.get("refNullable") or d.get("urlNullable") or d.get("titleNullable")),
            "title": str(d.get("titleNullable") or "—"),
            "description": _one_line(d.get("subtitleNullable")),
            "url": str(d.get("urlNullable") or "https://www.kaggle.com/datasets"),
            "meta": _meta([
                ("Owner", d.get("ownerNameNullable")),
                ("Size", f"{size / 1e6:.1f} MB" if isinstance(size, (int, float)) and size else None),
                ("License", d.get("licenseNameNullable")),
            ]),
            "flag": "",
        })
    note = "Public metadata search. Download files on Kaggle or with KAGGLE_USERNAME + KAGGLE_KEY in API keys."
    return out[:limit], note


async def _search_openml(query: str, limit: int) -> tuple[list[dict], str]:
    note = "OpenML matches exact dataset names; a name like 'iris' is the quickest route."
    try:
        res = await _get(f"https://www.openml.org/api/v1/json/data/list/data_name/{quote(query)}/limit/{limit}")
        datasets = ((res.json().get("data") or {}).get("dataset")) or []
    except httpx.HTTPStatusError:
        datasets = []
    if not datasets:
        res = await _get("https://www.openml.org/api/v1/json/data/list/limit/100")
        listed = ((res.json().get("data") or {}).get("dataset")) or []
        q = query.lower()
        datasets = [d for d in listed if q in str(d.get("name", "")).lower()][:limit]
        note = "Exact-name search had no hit, so this is a match from the first 100 datasets."
    out = []
    for d in datasets:
        quality = {q["name"]: q["value"] for q in d.get("quality", [])}
        out.append({
            "id": str(d.get("did")),
            "title": f"{d.get('name')} (v{d.get('version', 1)})",
            "description": "",
            "url": f"https://www.openml.org/d/{d.get('did')}",
            "meta": _meta([("Instances", quality.get("NumberOfInstances")),
                           ("Features", quality.get("NumberOfFeatures")), ("Format", "ARFF")]),
            "flag": "",
        })
    return out, note


def _search_uci(query: str, limit: int) -> tuple[list[dict], str]:
    q = (query or "").lower()
    hits = [d for d in UCI_CATALOG if not q or q in d["title"].lower() or q in d["tags"]]
    out = [{
        "id": d["id"],
        "title": d["title"],
        "description": d["tags"],
        "url": f"https://archive.ics.uci.edu/dataset/{d['id']}",
        "meta": _meta([("Instances", d["instances"]), ("Features", d["features"]), ("Format", "CSV")]),
        "flag": "",
    } for d in hits[:limit]]
    return out, "Curated classics with direct CSV import. The full UCI catalogue is on archive.ics.uci.edu."


async def _search_roboflow(query: str, limit: int) -> tuple[list[dict], str]:
    if not _has("ROBOFLOW_API_KEY"):
        raise store.TrainingError("Roboflow search needs ROBOFLOW_API_KEY — add it in API keys.")
    res = await _get("https://api.roboflow.com/search",
                     params={"query": query, "type": "dataset", "limit": limit,
                             "api_key": provider_keys.get("ROBOFLOW_API_KEY") or ""})
    payload = res.json() or {}
    raw = payload.get("results") or payload.get("data") or []
    out = []
    for d in raw if isinstance(raw, list) else []:
        name = d.get("name") or d.get("title") or d.get("id") or "—"
        out.append({
            "id": str(d.get("id") or name),
            "title": str(name),
            "description": _one_line(d.get("description")),
            "url": str(d.get("url") or d.get("webUrl") or "https://universe.roboflow.com/"),
            "meta": _meta([("Images", d.get("images")), ("Workspace", d.get("workspace"))]),
            "flag": "",
        })
    return out[:limit], "Exports stay on Roboflow; this console trains text models, so image sets are for reference."


# ── preview ─────────────────────────────────────────────────────────
async def preview(source_id: str, dataset: str, sample: int = 8) -> dict[str, Any]:
    src = _source(source_id)
    sample = min(max(int(sample), 1), 25)
    if not src["previewable"]:
        raise store.TrainingError(f"{src['name']} previews happen on its own site.")
    try:
        if source_id == "huggingface":
            fields, rows, meta, note = await _hf_rows(dataset, "", "", sample)
        elif source_id == "openml":
            fields, rows, meta, note = await _openml_rows(dataset, sample)
        elif source_id == "uci":
            fields, rows, meta, note = await _uci_rows(dataset, sample)
        else:
            raise store.TrainingError(f"{src['name']} does not support preview here.")
    except store.TrainingError:
        raise
    except Exception as e:  # noqa: BLE001
        raise _fail(src["name"], e) from e
    return {
        "source": source_id, "dataset": dataset, "fields": fields, "rows": rows,
        "total": meta.get("total"), "detail": meta.get("detail", ""), "note": note,
        "suggested": _suggest(fields),
    }


async def _hf_rows(dataset: str, config: str, split: str, limit: int):
    dataset = dataset.strip()
    if not re.match(r"^[\w.\-]+/[\w.\-]+$", dataset):
        raise store.TrainingError("Use a Hub id like 'tatsu-lab/alpaca'.")
    if not config or not split:
        res = await _get("https://datasets-server.huggingface.co/splits",
                         params={"dataset": dataset}, headers=_hf_headers())
        splits = res.json().get("splits") or []
        if not splits:
            raise store.TrainingError("No previewable split for this dataset (it may be gated or script-only).")
        config, split = splits[0]["config"], splits[0]["split"]
    fields: list[str] = []
    rows: list[dict[str, str]] = []
    offset = 0
    while len(rows) < limit:
        length = min(100, limit - len(rows))
        res = await _get("https://datasets-server.huggingface.co/rows",
                         params={"dataset": dataset, "config": config, "split": split,
                                 "offset": offset, "length": length},
                         headers=_hf_headers())
        payload = res.json()
        batch = payload.get("rows") or []
        if not batch:
            break
        fields = [f.get("name", f"col{i}") for i, f in enumerate(payload.get("features") or [])] or fields
        rows += [{k: _stringify(v) for k, v in (item.get("row") or {}).items()} for item in batch]
        offset += len(batch)
        if len(batch) < length:
            break
    if not rows:
        raise store.TrainingError("The dataset server returned no rows.")
    return fields or list(rows[0]), rows, {"detail": f"{config} / {split}"}, "First rows served by datasets-server."


async def _openml_rows(dataset: str, limit: int):
    did = str(dataset).strip()
    if not did.isdigit():
        raise store.TrainingError("OpenML needs the numeric dataset id shown in search results.")
    res = await _get(f"https://www.openml.org/data/v1/download/{did}", timeout=60)
    if len(res.content) > MAX_DOWNLOAD:
        raise store.TrainingError(f"This dataset is larger than {MAX_DOWNLOAD // (1024 * 1024)} MB; download it from OpenML and upload the file.")
    fields, rows = _parse_arff(res.text)
    if not rows:
        raise store.TrainingError("Could not parse rows from the ARFF file.")
    return fields, rows[:limit], {"detail": f"{len(rows)} rows"}, f"ARFF dataset did={did}, parsed locally."


async def _uci_rows(dataset: str, limit: int):
    did = str(dataset).strip()
    if not did.isdigit():
        raise store.TrainingError("UCI needs the numeric dataset id shown in search results.")
    meta_res = await _get("https://archive.ics.uci.edu/api/dataset", params={"id": did}, timeout=30)
    meta = (meta_res.json() or {}).get("data") or {}
    data_url = meta.get("data_url")
    if not data_url:
        raise store.TrainingError("This UCI entry has no direct CSV — open the dataset page instead.")
    res = await _get(data_url, timeout=60)
    if len(res.content) > MAX_DOWNLOAD:
        raise store.TrainingError(f"This CSV is larger than {MAX_DOWNLOAD // (1024 * 1024)} MB; download it from UCI and upload the file.")
    reader = csv.DictReader(io.StringIO(res.text))
    fields = reader.fieldnames or []
    rows = [{k: _stringify(v) for k, v in row.items() if k} for row in reader]
    if not rows:
        raise store.TrainingError("The UCI CSV had no data rows.")
    detail = f"{meta.get('name') or did} · {meta.get('num_instances') or len(rows)} instances"
    return fields, rows[:limit], {"detail": detail, "total": meta.get("num_instances")}, "Direct CSV from archive.ics.uci.edu."


def _suggest(fields: list[str]) -> dict[str, str]:
    low = {f.lower().strip(): f for f in fields if f}
    def pick(*names):
        return next((low[n] for n in names if n in low), "")
    return {
        "instruction": pick("instruction", "question", "prompt", "text", "sentence", "title"),
        "output": pick("output", "answer", "response", "label", "class", "target", "caption"),
    }


# ── import ──────────────────────────────────────────────────────────
async def import_dataset(body: dict[str, Any]) -> dict[str, Any]:
    source_id = str(body.get("source") or "")
    src = _source(source_id)
    if not src["importable"]:
        raise store.TrainingError(f"{src['name']} imports go through its website — download the file, then upload it in Datasets.")
    dataset = str(body.get("dataset") or "").strip()
    name = str(body.get("name") or "").strip()
    limit = int(min(max(int(body.get("limit") or 500), 1), 1000))
    try:
        if source_id == "huggingface":
            fields, rows, _, _ = await _hf_rows(dataset, str(body.get("config") or ""),
                                                str(body.get("split") or ""), limit)
        elif source_id == "openml":
            fields, rows, _, _ = await _openml_rows(dataset, limit)
        elif source_id == "uci":
            fields, rows, _, _ = await _uci_rows(dataset, limit)
        else:
            raise store.TrainingError(f"{src['name']} cannot be imported here.")
    except store.TrainingError:
        raise
    except Exception as e:  # noqa: BLE001
        raise _fail(src["name"], e) from e

    guesses = _suggest(fields)
    instruction = str(body.get("instruction_field") or guesses["instruction"] or "")
    output = str(body.get("output_field") or guesses["output"] or "")
    if instruction not in fields or output not in fields:
        raise store.TrainingError(f"Pick two of the available columns: {', '.join(fields)}")
    if instruction == output:
        raise store.TrainingError("Instruction and output must be different columns.")
    clean = []
    for row in rows:
        i = str(row.get(instruction, "")).strip()
        o = str(row.get(output, "")).strip()
        if i and o:
            clean.append({"instruction": i[:MAX_FIELD_CHARS], "input": "", "output": o[:MAX_FIELD_CHARS]})
    if not clean:
        raise store.TrainingError("No row had both columns filled — choose different columns.")
    saved = store.write_dataset(name, clean)
    return {
        "name": saved["name"], "rows": saved["rows"], "fetched": len(rows),
        "skipped": len(rows) - len(clean), "source": source_id,
        "dataset": dataset, "fields": {"instruction": instruction, "output": output},
    }


# ── helpers ─────────────────────────────────────────────────────────
def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        text = repr(value)
    else:
        text = str(value)
    return text[:MAX_FIELD_CHARS]


_ARFF_ATTR = re.compile(r"^@attribute\s+(?:'((?:[^'\\]|\\.)*)'|\"([^\"]*)\"|(\S+))", re.I)


def _parse_arff(text: str) -> tuple[list[str], list[dict[str, str]]]:
    fields: list[str] = []
    rows: list[dict[str, str]] = []
    in_data = False
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("%"):
            continue
        if s.lower().startswith("@attribute"):
            m = _ARFF_ATTR.match(s)
            name = next((g for g in m.groups() if g), "") if m else ""
            fields.append(name or f"col{len(fields)}")
        elif s.lower().startswith("@data"):
            in_data = True
        elif in_data:
            cells = _split_arff_row(s)
            if len(cells) < len(fields):
                cells += [""] * (len(fields) - len(cells))
            rows.append({k: _stringify(v) for k, v in zip(fields, cells)})
    return fields, rows


def _split_arff_row(line: str) -> list[str]:
    cells: list[str] = []
    cur: list[str] = []
    quote: str | None = None
    for ch in line:
        if quote:
            if ch == quote:
                quote = None
            else:
                cur.append(ch)
        elif ch in ("'", '"'):
            quote = ch
        elif ch == ",":
            cells.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    cells.append("".join(cur).strip())
    return cells
