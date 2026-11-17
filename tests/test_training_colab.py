import json

import pytest

from nmb_marketplace_agent.config.settings import settings
from nmb_marketplace_agent.training import colab, store

ROWS = [
    {"instruction": "Do you deliver to Dodoma?", "output": "Yes — delivery takes two working days."},
    {"instruction": "How do I return an item?", "output": "Open the order and choose Return within 7 days."},
]


@pytest.fixture(autouse=True)
def _training_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "training_root", str(tmp_path / "training"))
    store.write_dataset("demo-set", ROWS)


def _build(**over):
    body = {"mode": "train", "dataset": "demo-set", "base_model": "Qwen/Qwen2.5-0.5B-Instruct",
            "epochs": 2, "learning_rate": 0.0001, "batch_size": 1, "grad_accum": 4,
            "max_seq_length": 512, "prompt": "Do you deliver to Arusha?"}
    body.update(over)
    text, filename = colab.build(body)
    return json.loads(text), filename


def _code(nb):
    return ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]


def _compile(source: str, name: str) -> None:
    # Notebook magics (%pip) are kernel syntax, not Python; drop those lines.
    python = "\n".join(line for line in source.splitlines() if not line.lstrip().startswith(("%", "!")))
    compile(python, name, "exec")


def test_train_notebook_is_valid_and_compiles():
    nb, filename = _build()
    assert nb["nbformat"] == 4 and nb["cells"]
    assert filename == "colab-demo-set-train.ipynb"
    ids = [c["id"] for c in nb["cells"]]
    assert len(ids) == len(set(ids))
    for cell in nb["cells"]:
        assert cell["cell_type"] in ("markdown", "code")
        if cell["cell_type"] == "code":
            _compile("".join(cell["source"]), cell["id"])  # every code cell parses
    code = _code(nb)
    joined = "\n".join(code)
    assert "DATA = [" in code[1]
    assert '"Do you deliver to Dodoma?"' in code[1]
    assert "SFTTrainer" in joined and "LoraConfig" in joined
    assert "num_train_epochs=2" in joined and "max_seq_length=512" in joined
    assert 'PROMPT = "Do you deliver to Arusha?"' in joined
    assert '"Qwen/Qwen2.5-0.5B-Instruct"' in joined


def test_infer_notebook_skips_training():
    nb, filename = _build(mode="infer", epochs=5)
    assert filename == "colab-demo-set-infer.ipynb"
    joined = "\n".join(_code(nb))
    assert "SFTTrainer" not in joined and "num_train_epochs" not in joined
    for cell in nb["cells"]:
        if cell["cell_type"] == "code":
            _compile("".join(cell["source"]), cell["id"])
    assert "Do you deliver to Arusha?" in joined


def test_bad_input_is_rejected():
    with pytest.raises(store.TrainingError):
        _build(mode="serve")
    with pytest.raises(store.TrainingError):
        _build(dataset="missing")
    with pytest.raises(store.TrainingError):
        _build(base_model="../../etc/passwd")
    with pytest.raises(store.TrainingError):
        _build(epochs=0)


def test_embedded_rows_are_python_literals_not_code():
    nb, _ = _build()
    data_cell = _code(nb)[1]
    ns: dict = {}
    exec(compile(data_cell, "data", "exec"), ns)
    assert ns["DATA"] == [{"instruction": r["instruction"], "input": "", "output": r["output"]} for r in ROWS]
