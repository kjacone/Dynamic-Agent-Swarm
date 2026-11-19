"""Model training. Datasets are built here; jobs run in the LLaMA-Factory trainer container."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from nmb_marketplace_agent.api.deps import get_db
from nmb_marketplace_agent.config.models import Feedback
from nmb_marketplace_agent.training import colab, media, playground, providers, sources, store

router = APIRouter()


def _guard(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except store.TrainingError as e:
        raise HTTPException(400, str(e))


async def _await_guard(fn, *a, **kw):
    try:
        return await fn(*a, **kw)
    except store.TrainingError as e:
        raise HTTPException(400, str(e))


class DatasetIn(BaseModel):
    name: str
    source: str = "rows"          # rows | feedback
    rows: list[dict] = []
    agent_id: str | None = None   # feedback only
    tenant_id: str = "default"


@router.get("/datasets")
async def datasets():
    return store.list_datasets()


@router.post("/datasets")
async def create_dataset(body: DatasetIn, db: AsyncSession = Depends(get_db)):
    rows = body.rows
    if body.source == "feedback":
        q = select(Feedback).where(Feedback.tenant_id == body.tenant_id, Feedback.rating == "up")
        if body.agent_id:
            q = q.where(Feedback.agent_id == body.agent_id)
        fb = (await db.execute(q)).scalars().all()
        rows = [{"instruction": f.user_message, "output": f.reply} for f in fb if f.user_message and f.reply]
    elif body.source != "rows":
        raise HTTPException(400, "source must be rows or feedback")
    return _guard(store.write_dataset, body.name, rows)


@router.get("/datasets/{name}/download")
async def download_dataset(name: str):
    path = _guard(store.dataset_path, name)
    return FileResponse(path, media_type="application/json", filename=f"{name}.json")


@router.delete("/datasets/{name}")
async def delete_dataset(name: str):
    return _guard(store.delete_dataset, name)


@router.get("/jobs")
async def jobs():
    return {"runner_online": store.runner_alive(), "jobs": store.list_jobs()}


@router.post("/jobs")
async def create_job(body: dict):
    return _guard(store.create_job, body)


@router.get("/jobs/{job_id}")
async def job(job_id: str):
    return _guard(store.job_detail, job_id)


@router.get("/jobs/{job_id}/log")
async def job_log(job_id: str, lines: int = 200):
    return {"log": _guard(store.log_tail, job_id, min(lines, 2000))}


@router.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str):
    _guard(store.cancel, job_id)
    return {"ok": True}


class PlaygroundIn(BaseModel):
    corpus: str
    epochs: int = playground.DEFAULTS["epochs"]
    learning_rate: float = playground.DEFAULTS["learning_rate"]
    temperature: float = playground.DEFAULTS["temperature"]
    prefix: str = playground.DEFAULTS["prefix"]


@router.get("/playground")
async def playground_defaults():
    return {"corpus": playground.DEFAULT_CORPUS, "defaults": playground.DEFAULTS}


@router.post("/playground/train")
async def playground_train(body: PlaygroundIn):
    try:
        return playground.train(
            body.corpus,
            epochs=body.epochs,
            learning_rate=body.learning_rate,
            temperature=body.temperature,
            prefix=body.prefix,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


class ColabIn(BaseModel):
    mode: str = colab.DEFAULTS["mode"]
    dataset: str
    base_model: str = colab.DEFAULTS["base_model"]
    epochs: float = colab.DEFAULTS["epochs"]
    learning_rate: float = colab.DEFAULTS["learning_rate"]
    batch_size: int = colab.DEFAULTS["batch_size"]
    grad_accum: int = colab.DEFAULTS["grad_accum"]
    max_seq_length: int = colab.DEFAULTS["max_seq_length"]
    prompt: str = ""


@router.get("/colab")
async def colab_info():
    return {"modes": list(colab.MODES), "defaults": colab.DEFAULTS}


@router.post("/colab")
async def colab_notebook(body: ColabIn):
    """Build a .ipynb the client runs on Colab's free GPU tier. Nothing trains here."""
    notebook, filename = _guard(colab.build, body.model_dump())
    return Response(
        notebook,
        media_type="application/x-ipynb+json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── dataset sources (search, preview, import) ───────────────────────
class SourceImportIn(BaseModel):
    source: str
    dataset: str
    name: str
    instruction_field: str = ""
    output_field: str = ""
    limit: int = 500
    config: str = ""
    split: str = ""


@router.get("/dataset-sources")
async def dataset_sources():
    return sources.catalog()


@router.get("/dataset-sources/{source_id}/search")
async def dataset_source_search(source_id: str, q: str = "", limit: int = 10):
    return await _await_guard(sources.search, source_id, q, limit)


@router.get("/dataset-sources/{source_id}/preview")
async def dataset_source_preview(source_id: str, dataset: str, sample: int = 8):
    return await _await_guard(sources.preview, source_id, dataset, sample)


@router.post("/dataset-sources/import")
async def dataset_source_import(body: SourceImportIn):
    return await _await_guard(sources.import_dataset, body.model_dump())


# ── providers and media generation ──────────────────────────────────
@router.get("/providers")
async def training_providers():
    return providers.list_providers()


@router.get("/providers/{provider_id}/check")
async def training_provider_check(provider_id: str):
    return await _await_guard(providers.check, provider_id)


@router.get("/media/options")
async def media_options():
    return media.options()


class MediaIn(BaseModel):
    kind: str = "image"
    provider: str = "sample"
    prompt: str
    size: str = media.IMAGE_SIZES[0]
    duration: int = media.VIDEO_DURATIONS[0]


@router.post("/media/generate")
async def media_generate(body: MediaIn):
    return await _await_guard(media.generate, body.model_dump())