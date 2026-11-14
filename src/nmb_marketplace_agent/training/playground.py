"""CPU training playground.

A genuinely trained next-token model — a bigram log-softmax layer optimised
with gradient descent in pure Python. It is the same loop a GPU fine-tune
runs (examples -> loss -> gradient update -> better predictions), just with
a few hundred parameters instead of a few billion.
"""
from __future__ import annotations

import math
import random
import re
import time
from collections import Counter, defaultdict

DEFAULT_CORPUS = """\
Karibu NMB! How can I help you today?
Your account balance is available in the mobile app.
Savings accounts earn interest every month.
You can open a branch account with your national ID.
Loan applications are reviewed within three working days.
Mobile money transfers are instant and secure.
Your card can be replaced at any branch.
Statements can be downloaded from the app.
Please keep your PIN private and never share it.
Visit any branch for help with your account.
Your loan repayment is due at the end of the month.
Thank you for banking with NMB."""

DEFAULTS = {"epochs": 40, "learning_rate": 1.0, "temperature": 0.8, "prefix": "your"}

MAX_LINES = 80
MAX_VOCAB = 300
MAX_CORPUS_CHARS = 20_000

_TOKEN = re.compile(r"[a-zA-Zà-ÿÀ-Ÿ']+|[0-9][0-9.,]*|[.!?]")
_BOS, _EOS, _UNK = "<s>", "<e>", "<unk>"


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def _softmax(row: list[float], temperature: float) -> list[float]:
    scale = max(temperature, 0.05)
    m = max(row) / scale
    exps = [math.exp(v / scale - m) for v in row]
    total = sum(exps)
    return [e / total for e in exps]


def _loss(weights, pairs: Counter, n_pairs: int) -> float:
    total = 0.0
    for (i, j), count in pairs.items():
        probs = _softmax(weights[i], 1.0)
        total -= count * math.log(max(probs[j], 1e-12))
    return total / n_pairs


def _sample(rng: random.Random, probs: list[float]) -> int:
    r = rng.random()
    acc = 0.0
    for i, p in enumerate(probs):
        acc += p
        if r <= acc:
            return i
    return len(probs) - 1


def _join(tokens: list[str]) -> str:
    text = " ".join(tokens)
    for punct in ".,!?":
        text = text.replace(f" {punct}", punct)
    return text[:1].upper() + text[1:] if text else ""


def _generate(weights, vocab, prefix_ids, temperature: float, seed: int, length: int = 14) -> str:
    rng = random.Random(seed)
    out: list[str] = []
    bos, eos, unk = vocab.index(_BOS), vocab.index(_EOS), vocab.index(_UNK)
    cur = prefix_ids[0] if prefix_ids else bos
    for _ in range(length):
        nxt = _sample(rng, _softmax(weights[cur], temperature))
        if nxt == eos:
            break
        if nxt not in (bos, unk):
            out.append(vocab[nxt])
        cur = nxt
    return _join(out) or "…"


def _predictions(weights, vocab, context: int, temperature: float, k: int = 5) -> list[dict]:
    probs = _softmax(weights[context], temperature)
    hidden = {vocab.index(_BOS), vocab.index(_EOS), vocab.index(_UNK)}
    ranked = sorted((i for i in range(len(vocab)) if i not in hidden), key=lambda i: probs[i], reverse=True)[:k]
    return [{"token": vocab[i], "p": round(probs[i], 4)} for i in ranked]


def train(
    corpus: str,
    epochs: int = DEFAULTS["epochs"],
    learning_rate: float = DEFAULTS["learning_rate"],
    temperature: float = DEFAULTS["temperature"],
    prefix: str = DEFAULTS["prefix"],
) -> dict:
    started = time.perf_counter()
    if len(corpus) > MAX_CORPUS_CHARS:
        raise ValueError(f"corpus is limited to {MAX_CORPUS_CHARS} characters")
    lines = [tokenize(line)[:120] for line in corpus.splitlines()]
    lines = [line for line in lines if line][:MAX_LINES]
    if not lines:
        raise ValueError("add at least one line of example text")

    epochs = max(1, min(int(epochs), 80))
    learning_rate = max(0.01, min(float(learning_rate), 5.0))
    temperature = max(0.1, min(float(temperature), 2.0))
    prefix_tokens = tokenize(prefix)[:8]

    flat = [token for line in lines for token in line]
    freq = Counter(flat)
    keeps = {tok for tok, _ in freq.most_common(MAX_VOCAB - 3)}
    vocab = [_BOS, _EOS, _UNK] + sorted(keeps - {_BOS, _EOS, _UNK})
    index = {tok: i for i, tok in enumerate(vocab)}

    def idx(token: str) -> int:
        return index.get(token, index[_UNK])

    pairs: Counter = Counter()
    for line in lines:
        ids = [index[_BOS]] + [idx(t) for t in line] + [index[_EOS]]
        pairs.update(zip(ids, ids[1:]))
    n_pairs = sum(pairs.values())

    contexts: dict[int, dict[int, int]] = defaultdict(dict)
    for (i, j), count in pairs.items():
        contexts[i][j] = contexts[i].get(j, 0) + count

    rng = random.Random(1234)
    size = len(vocab)
    weights = [[rng.gauss(0.0, 0.05) for _ in range(size)] for _ in range(size)]
    before_weights = [row[:] for row in weights]

    loss_series = [{"step": 0, "loss": round(_loss(weights, pairs, n_pairs), 4)}]
    for step in range(1, epochs + 1):
        for context, row_counts in contexts.items():
            total = sum(row_counts.values())
            probs = _softmax(weights[context], 1.0)
            row = weights[context]
            for nxt, count in row_counts.items():
                row[nxt] -= learning_rate * (probs[nxt] - count / total)
        loss_series.append({"step": step, "loss": round(_loss(weights, pairs, n_pairs), 4)})

    prefix_ids = [idx(t) for t in prefix_tokens]
    context = prefix_ids[-1] if prefix_ids else index[_BOS]
    seed = 4242

    return {
        "vocab_size": size,
        "parameters": size * size,
        "sentences": len(lines),
        "tokens": len(flat),
        "steps": epochs,
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
        "loss_series": loss_series,
        "final_loss": loss_series[-1]["loss"],
        "prefix": " ".join(prefix_tokens) or "(start)",
        "before": {
            "generation": _generate(before_weights, vocab, prefix_ids, temperature, seed),
            "predictions": _predictions(before_weights, vocab, context, temperature),
        },
        "after": {
            "generation": _generate(weights, vocab, prefix_ids, temperature, seed),
            "predictions": _predictions(weights, vocab, context, temperature),
        },
    }
