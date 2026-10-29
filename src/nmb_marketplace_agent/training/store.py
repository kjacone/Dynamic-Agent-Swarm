"""File-based training datasets and jobs, shared with the trainer container (LLaMA-Factory).

data/training/
  datasets/<name>.json + dataset_info.json   alpaca-format datasets LLaMA-Factory can read
  queue/<job>.json                           picked up by docker/trainer/runner.py
  runs/<job>/{config.yaml,status.json,train.log,output/}
  runner.json                                heartbeat written by the runner
"""
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

import yaml

from nmb_marketplace_agent.config.settings import settings

NAME = re.compile(r"^[A-Za-z0-9][\w\-]{0,63}$")
JOB_ID = re.compile(r"^\d+-[0-9a-f]{6}$")
MODEL = re.compile(r"^[\w.\-/]{1,200}$")
TEMPLATES = {"default", "qwen", "llama3", "mistral", "gemma", "phi", "chatml"}


class TrainingError(ValueError):
    pass


def root() -> Path:
    r = Path(settings.training_root)
    for d in ("datasets", "queue", "runs"):
        (r / d).mkdir(parents=True, exist_ok=True)
    return r


# ---------- datasets ----------
def write_dataset(name: str, rows: list[dict]) -> dict:
    if not NAME.match(name):
        raise TrainingError("Dataset name may use letters, digits, - and _ (max 64).")
    clean = []
    for r in rows:
        instruction = str(r.get("instruction", "")).strip()
        output = str(r.get("output", "")).strip()
        if instruction and output:
            clean.append({"instruction": instruction, "input": str(r.get("input", "")), "output": output})
    if not clean:
        raise TrainingError("No usable rows: each row needs an instruction and an output.")
    d = root() / "datasets"
    (d / f"{name}.json").write_text(json.dumps(clean, ensure_ascii=False, indent=1))
    info_path = d / "dataset_info.json"
    info = json.loads(info_path.read_text()) if info_path.exists() else {}
    info[name] = {"file_name": f"{name}.json"}
    info_path.write_text(json.dumps(info, indent=1))
    return {"name": name, "rows": len(clean)}


def list_datasets() -> list[dict]:
    out = []
    for f in sorted((root() / "datasets").glob("*.json")):
        if f.name == "dataset_info.json":
            continue
        try:
            n = len(json.loads(f.read_text()))
        except ValueError:
            n = 0
        out.append({"name": f.stem, "rows": n, "updated_at": f.stat().st_mtime})
    return out


# ---------- jobs ----------
def make_config(job: dict) -> dict:
    """LLaMA-Factory SFT + LoRA config. Paths are as seen inside the trainer container."""
    p = job["params"]
    croot = settings.training_container_root.rstrip("/")
    return {
        "model_name_or_path": p["base_model"],
        "stage": "sft",
        "do_train": True,
        "finetuning_type": "lora",
        "lora_target": "all",
        "dataset": p["dataset"],
        "dataset_dir": f"{croot}/datasets",
        "template": p["template"],
        "cutoff_len": p["cutoff_len"],
        "overwrite_cache": True,
        "output_dir": f"{croot}/runs/{job['id']}/output",
        "logging_steps": 5,
        "save_steps": 200,
        "plot_loss": True,
        "overwrite_output_dir": True,
        "per_device_train_batch_size": p["batch_size"],
        "gradient_accumulation_steps": p["grad_accum"],
        "learning_rate": p["learning_rate"],
        "num_train_epochs": p["epochs"],
        "lr_scheduler_type": "cosine",
        "warmup_ratio": 0.1,
        "bf16": True,
    }


def _bounded(v: Any, lo: float, hi: float, name: str) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise TrainingError(f"{name} must be a number")
    if not lo <= f <= hi:
        raise TrainingError(f"{name} must be between {lo} and {hi}")
    return f


def create_job(body: dict) -> dict:
    name = str(body.get("name") or "").strip() or "run"
    if not NAME.match(name):
        raise TrainingError("Job name may use letters, digits, - and _.")
    dataset = str(body.get("dataset", ""))
    if dataset not in {d["name"] for d in list_datasets()}:
        raise TrainingError(f"Unknown dataset: {dataset}")
    base = str(body.get("base_model", "")).strip()
    if not MODEL.match(base) or ".." in base:
        raise TrainingError("Base model must be a Hugging Face id like Qwen/Qwen2.5-1.5B-Instruct.")
    template = str(body.get("template", "default"))
    if template not in TEMPLATES:
        raise TrainingError(f"Template must be one of {sorted(TEMPLATES)}")
    job = {
        "id": f"{int(time.time())}-{uuid.uuid4().hex[:6]}",
        "name": name,
        "status": "queued",
        "created_at": time.time(),
        "params": {
            "dataset": dataset, "base_model": base, "template": template,
            "epochs": _bounded(body.get("epochs", 3), 0.1, 50, "epochs"),
            "learning_rate": _bounded(body.get("learning_rate", 1e-4), 1e-7, 1e-2, "learning_rate"),
            "batch_size": int(_bounded(body.get("batch_size", 1), 1, 64, "batch_size")),
            "grad_accum": int(_bounded(body.get("grad_accum", 8), 1, 256, "grad_accum")),
            "cutoff_len": int(_bounded(body.get("cutoff_len", 2048), 128, 32768, "cutoff_len")),
        },
    }
    run = root() / "runs" / job["id"]
    run.mkdir(parents=True)
    (run / "config.yaml").write_text(yaml.safe_dump(make_config(job), sort_keys=False))
    (run / "status.json").write_text(json.dumps(job))
    (root() / "queue" / f"{job['id']}.json").write_text(json.dumps({"id": job["id"]}))
    return job


def _series(path: Path, max_points: int = 200) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    step = max(1, len(rows) // max_points)
    out = rows[::step]
    # Always include the final sample so the chart ends at the last step.
    # Compare indices rather than object identity — identity happens to work
    # for JSON-decoded dicts today but is fragile.
    if rows and (len(rows) - 1) % step != 0:
        out.append(rows[-1])
    return out

def job_detail(job_id: str) -> dict:
    if not JOB_ID.match(job_id):
        raise TrainingError("Unknown job")
    run = root() / "runs" / job_id
    sp = run / "status.json"
    if not sp.exists():
        raise TrainingError("Unknown job")
    job = json.loads(sp.read_text())
    series = _series(run / "output" / "trainer_log.jsonl")
    last = series[-1] if series else {}
    job["progress"] = {
        "step": last.get("current_steps"), "total": last.get("total_steps"),
        "percentage": last.get("percentage"), "loss": last.get("loss"), "epoch": last.get("epoch"),
    }
    job["loss_series"] = [{"step": r.get("current_steps"), "loss": r.get("loss")}
                          for r in series if r.get("loss") is not None]
    return job


def list_jobs() -> list[dict]:
    out = []
    for d in (root() / "runs").iterdir():
        try:
            j = job_detail(d.name)
        except (TrainingError, ValueError):
            continue
        j.pop("loss_series", None)
        out.append(j)
    return sorted(out, key=lambda j: j.get("created_at", 0), reverse=True)


def log_tail(job_id: str, lines: int = 200) -> str:
    job_detail(job_id)  # validates the id
    p = root() / "runs" / job_id / "train.log"
    return "\n".join(p.read_text(errors="replace").splitlines()[-lines:]) if p.exists() else ""


def cancel(job_id: str) -> None:
    job_detail(job_id)
    (root() / "runs" / job_id / "cancel").write_text("1")


def runner_alive() -> bool:
    try:
        return time.time() - json.loads((root() / "runner.json").read_text())["ts"] < 30
    except (OSError, ValueError, KeyError):
        return False