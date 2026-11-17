"""Assemble a self-contained Google Colab notebook for the training datasets.

Colab's free tier includes a T4 GPU, so a client can trial a LoRA fine-tune, or
chat with the base model, without us provisioning a trainer. The notebook embeds
the dataset and runs under the client's own Google account, so it leaves this
deployment: only export data that is safe to hand over. This module only builds
JSON; it never trains or calls an LLM.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from nmb_marketplace_agent.training import store

DEFAULTS = {
    "mode": "train",
    "base_model": "Qwen/Qwen2.5-0.5B-Instruct",
    "epochs": 3,
    "learning_rate": 0.0002,
    "batch_size": 1,
    "grad_accum": 8,
    "max_seq_length": 1024,
    "prompt": "",
}
MODES = ("train", "infer")
MODEL = re.compile(r"^[\w.\-/]{1,200}$")
PINNED = (
    'transformers==4.46.3', 'trl==0.12.2', 'peft==0.13.2',
    'datasets==3.1.0', 'accelerate==1.1.1',
)


def _bounded(value, lo: float, hi: float, name: str) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise store.TrainingError(f"{name} must be a number")
    if not lo <= f <= hi:
        raise store.TrainingError(f"{name} must be between {lo} and {hi}")
    return f


def config(body: dict) -> dict:
    mode = str(body.get("mode") or DEFAULTS["mode"]).strip().lower()
    if mode not in MODES:
        raise store.TrainingError(f"mode must be one of {list(MODES)}")
    dataset = str(body.get("dataset") or "").strip()
    path: Path = store.dataset_path(dataset)  # validates name and existence
    base = str(body.get("base_model") or DEFAULTS["base_model"]).strip()
    if not MODEL.match(base) or ".." in base:
        raise store.TrainingError("Base model must be a Hugging Face id like Qwen/Qwen2.5-0.5B-Instruct.")
    return {
        "mode": mode,
        "dataset": dataset,
        "rows": len(json.loads(path.read_text())),
        "base_model": base,
        "epochs": _bounded(body.get("epochs", DEFAULTS["epochs"]), 0.1, 20, "epochs"),
        "learning_rate": _bounded(body.get("learning_rate", DEFAULTS["learning_rate"]), 1e-7, 1e-2, "learning_rate"),
        "batch_size": int(_bounded(body.get("batch_size", DEFAULTS["batch_size"]), 1, 16, "batch_size")),
        "grad_accum": int(_bounded(body.get("grad_accum", DEFAULTS["grad_accum"]), 1, 64, "grad_accum")),
        "max_seq_length": int(_bounded(body.get("max_seq_length", DEFAULTS["max_seq_length"]), 128, 4096, "max_seq_length")),
        "prompt": str(body.get("prompt") or "").strip()[:2000],
    }


def _lines(source: str) -> list[str]:
    return source.splitlines(keepends=True)


def _cell(kind: str, source: str, index: int) -> dict:
    cell = {
        "cell_type": kind,
        "id": f"cell-{index}",
        "metadata": {},
        "source": _lines(source.strip("\n") + "\n"),
    }
    if kind == "code":
        cell["execution_count"] = None
        cell["outputs"] = []
    return cell


def _literal(value) -> str:
    """embed a value as a Python literal (ASCII-only, safe inside a notebook cell)"""
    return json.dumps(value, ensure_ascii=True)


def _intro(cfg: dict) -> str:
    heading = "Fine-tune on a free Colab GPU" if cfg["mode"] == "train" else "Try the base model on a free Colab GPU"
    extra = (
        "\nAfter training the notebook compares the base model with the tuned adapter on the\n"
        "same prompt and offers the adapter as a zip download."
        if cfg["mode"] == "train"
        else "\nThis inference-only notebook skips training so you can hear the base model first."
    )
    return f"""# {heading}

Dataset **{cfg['dataset']}** — {cfg['rows']} rows · base model `{cfg['base_model']}`

The free Colab tier includes an NVIDIA T4. A small instruct model (0.5B–1.5B
parameters) fine-tunes on it in minutes, which is enough to hear the difference on
your own examples.

## Before you run

- **The data leaves this deployment.** This notebook embeds the dataset and runs in
  *your* Google account; upload it only if the rows are safe to share that way.
  Synthetic or already-approved content is fine.
- Gated models (Llama, Gemma) need a Hugging Face token first:
  `from huggingface_hub import login; login()` in a new cell, then run all.
- Colab free GPU sessions are time-limited and subject to availability; a long run
  can be interrupted. Nothing is charged to you.
- This is a trial path. The console's trainer remains the production route for
  larger models and audited runs.{extra}

## Steps

1. Download this notebook from the console.
2. Go to <https://colab.research.google.com> → **File → Upload notebook**.
3. **Runtime → Change runtime type → T4 GPU → Save.**
4. **Runtime → Run all.** The first cell installs packages (~2 minutes).

```text
mode      : {cfg['mode']}
epochs    : {cfg['epochs']:g}
lr        : {cfg['learning_rate']:g}
batch     : {cfg['batch_size']} x grad accum {cfg['grad_accum']}
max length: {cfg['max_seq_length']}
```
"""


def _setup_cell() -> str:
    pins = " ".join(f'"{p}"' for p in PINNED)
    return f"""# 1. Install the training stack (first run only, ~2 minutes).
# If Colab asks you to restart the runtime, restart and run all again.
%pip install -q {pins}
"""


def _data_cell(rows: list[dict]) -> str:
    return f"""# 2. The same rows the console builds its datasets from.
DATA = {_literal(rows)}
print(f"{{len(DATA)}} training rows loaded")
"""


def _model_cell(cfg: dict) -> str:
    return f"""# 3. Load the base model in fp16.
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = {_literal(cfg['base_model'])}
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.float16, device_map="auto")
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token
print("Device:", model.device)
"""


def _train_cell(cfg: dict) -> str:
    return f"""# 4. LoRA fine-tune. Only the adapter is trained; the base weights stay frozen.
from datasets import Dataset
from peft import LoraConfig
from trl import SFTConfig, SFTTrainer

def to_text(row):
    prompt = row["instruction"] + (("\\n\\n" + row["input"]) if row.get("input") else "")
    messages = [
        {{"role": "user", "content": prompt}},
        {{"role": "assistant", "content": row["output"]}},
    ]
    try:
        text = tokenizer.apply_chat_template(messages, tokenize=False)
    except ValueError:  # base models without a chat template
        text = f"### Instruction:\\n{{prompt}}\\n\\n### Response:\\n{{row['output']}}" + tokenizer.eos_token
    return {{"text": text}}

train_ds = Dataset.from_list(DATA).map(to_text)

trainer = SFTTrainer(
    model=model,
    train_dataset=train_ds,
    peft_config=LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM", target_modules="all-linear",
    ),
    args=SFTConfig(
        output_dir="./lora-out",
        per_device_train_batch_size={cfg['batch_size']},
        gradient_accumulation_steps={cfg['grad_accum']},
        learning_rate={cfg['learning_rate']},
        num_train_epochs={cfg['epochs']:g},
        max_seq_length={cfg['max_seq_length']},
        logging_steps=5,
        save_strategy="epoch",
        fp16=torch.cuda.is_available(),
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        report_to="none",
    ),
)
trainer.train()
trainer.save_model("./lora-out")
tokenizer.save_pretrained("./lora-out")
print("Adapter saved to ./lora-out")
"""


def _reply_def() -> str:
    return """def reply(model, prompt, max_new_tokens=200):
    messages = [{"role": "user", "content": prompt}]
    try:
        ids = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt"
        )
    except ValueError:  # base models without a chat template
        ids = tokenizer("### Instruction:\\n" + prompt + "\\n\\n### Response:\\n",
                        return_tensors="pt").input_ids
    ids = ids.to(model.device)
    with torch.no_grad():
        out = model.generate(ids, max_new_tokens=max_new_tokens, do_sample=False)
    return tokenizer.decode(out[0][ids.shape[-1]:], skip_special_tokens=True).strip()
"""


def _compare_cell(cfg: dict, rows: list[dict]) -> str:
    default_prompt = cfg["prompt"] or str((rows[0] or {}).get("instruction") or "")
    return f"""# 5. Compare the base model with the tuned adapter on one prompt.
import gc
import torch
from peft import PeftModel

PROMPT = {_literal(default_prompt)}

{_reply_def()}

for _name in ("trainer", "model"):  # safe to re-run this cell
    globals().pop(_name, None)
gc.collect()
torch.cuda.empty_cache()
base = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.float16, device_map="auto")
tuned = PeftModel.from_pretrained(base, "./lora-out")
tuned.eval()

print("PROMPT:", PROMPT)
print("\\n--- base model ---\\n", reply(base, PROMPT))
print("\\n--- fine-tuned ---\\n", reply(tuned, PROMPT))
"""


def _export_cell() -> str:
    return """# 6. Download the adapter folder to keep it after the session ends.
!zip -rq lora-adapter.zip lora-out
try:
    from google.colab import files
    files.download("lora-adapter.zip")
except ImportError:
    print("Not running in Colab - grab lora-adapter.zip from the file browser.")
"""


def _infer_cell(cfg: dict, rows: list[dict]) -> str:
    prompt = cfg["prompt"] or str((rows[0] or {}).get("instruction") or "")
    return f"""# 4. Ask the base model the same kind of questions as your dataset.
import torch

PROMPT = {_literal(prompt)}

{_reply_def()}

print("PROMPT:", PROMPT)
print(reply(model, PROMPT))
print("\\nEdit PROMPT above and re-run this cell to try another question.")
"""


def _outro(cfg: dict) -> str:
    if cfg["mode"] == "infer":
        return """## Next

Change `PROMPT` and re-run the last cell. When the answers look right, re-download
this notebook in **Fine-tune (LoRA)** mode to tune the model on your dataset and
compare the two side by side.
"""
    return """## What you just did

This is a real LoRA fine-tune: the training loop, loss and adapter are the same as
the GPU trainer, just on a free T4 with a small model. Expect the adapter to pick up
style and phrasing from the examples; it does not add new facts.

**Next:** download `lora-adapter.zip` to keep it, or re-run with more epochs / rows.
Uploading an adapter back into the console is not supported yet — this path is for
evaluation, not deployment.
"""


def build(body: dict) -> tuple[str, str]:
    """Return (notebook json, filename). Never runs training."""
    cfg = config(body)
    rows = json.loads(store.dataset_path(cfg["dataset"]).read_text())
    cells: list[dict] = []
    kinds = (
        [("markdown", _intro(cfg)), ("code", _setup_cell()), ("code", _data_cell(rows)), ("code", _model_cell(cfg))]
        + ([("code", _train_cell(cfg)), ("code", _compare_cell(cfg, rows)), ("markdown", _outro(cfg)), ("code", _export_cell())]
           if cfg["mode"] == "train" else
           [("code", _infer_cell(cfg, rows)), ("markdown", _outro(cfg))])
    )
    for i, (kind, source) in enumerate(kinds):
        cells.append(_cell(kind, source, i))
    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "colab": {"provenance": [], "gpuType": "T4"},
            "nmb": {"dataset": cfg["dataset"], "mode": cfg["mode"]},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return json.dumps(notebook, indent=1), f"colab-{cfg['dataset']}-{cfg['mode']}.ipynb"
