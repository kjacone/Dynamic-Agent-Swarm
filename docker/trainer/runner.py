#!/usr/bin/env python3
"""LLaMA-Factory training runner.

Polls <TRAINING_ROOT>/queue/*.json for jobs created by the NMB dashboard,
runs them one at a time via ``llamafactory-cli train config.yaml``, and writes
status back into <TRAINING_ROOT>/runs/<job>/.

Contract with ``src/nmb_marketplace_agent/training/store.py``:

  queue/<job>.json             {"id": "<job_id>"}
  runs/<job>/config.yaml       LLaMA-Factory YAML        (written by the app)
  runs/<job>/status.json       job dict, mutable         (written by app + this runner)
  runs/<job>/train.log         human-readable log        (written by this runner)
  runs/<job>/output/           LLaMA-Factory output dir; when plot_loss=True
                                it contains trainer_log.jsonl (read by the app)
  runs/<job>/cancel            marker file → request cancellation
  runner.json                  {"ts": <unix time>} heartbeat (< 30s fresh = alive)

The runner never parses trainer_log.jsonl itself; LLaMA-Factory produces it
because ``make_config()`` sets ``plot_loss: True``.
"""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(os.environ.get("TRAINING_ROOT", "/data/training"))
POLL_SECONDS = 2.0
HEARTBEAT_SECONDS = 5.0
TERM_TIMEOUT = 15  # seconds to wait after SIGTERM before SIGKILL


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(path)


def write_heartbeat() -> None:
    try:
        write_json(ROOT / "runner.json", {"ts": time.time()})
    except OSError:
        pass


def update_status(job_dir: Path, **fields) -> dict:
    status = read_json(job_dir / "status.json") or {}
    status.update(fields)
    write_json(job_dir / "status.json", status)
    return status


def pop_next_job() -> str | None:
    queue = ROOT / "queue"
    queue.mkdir(parents=True, exist_ok=True)
    for f in sorted(queue.glob("*.json")):
        data = read_json(f)
        f.unlink(missing_ok=True)
        if data and data.get("id"):
            return str(data["id"])
    return None


def recover_orphans() -> None:
    """A runner restart leaves no worker for any job stuck in 'running'."""
    runs = ROOT / "runs"
    if not runs.exists():
        return
    for d in runs.iterdir():
        if not d.is_dir():
            continue
        status = read_json(d / "status.json") or {}
        if status.get("status") == "running":
            status["status"] = "failed"
            status["error"] = "runner restarted while job was running"
            status["finished_at"] = time.time()
            try:
                write_json(d / "status.json", status)
                log(f"recovered orphaned job {d.name}")
            except OSError:
                pass


def run_job(job_id: str) -> None:
    job_dir = ROOT / "runs" / job_id
    if not (job_dir / "config.yaml").exists():
        log(f"job {job_id}: missing config.yaml, skipping")
        return

    log(f"job {job_id}: starting")
    update_status(job_dir, status="running", started_at=time.time())

    log_path = job_dir / "train.log"
    cancel_flag = job_dir / "cancel"
    cancel_flag.unlink(missing_ok=True)

    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    with open(log_path, "ab") as logf:
        proc = subprocess.Popen(
            ["llamafactory-cli", "train", str(job_dir / "config.yaml")],
            stdout=logf,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=str(job_dir),
            start_new_session=True,  # own process group so we can kill children
        )

        try:
            while proc.poll() is None:
                write_heartbeat()
                if cancel_flag.exists():
                    log(f"job {job_id}: cancel requested")
                    _terminate(proc)
                    update_status(
                        job_dir,
                        status="cancelled",
                        finished_at=time.time(),
                    )
                    cancel_flag.unlink(missing_ok=True)
                    return
                time.sleep(POLL_SECONDS)
        except BaseException:
            _terminate(proc)
            raise

        rc = proc.returncode

    status = "completed" if rc == 0 else "failed"
    extra = {"status": status, "exit_code": rc, "finished_at": time.time()}
    if rc != 0:
        extra["error"] = f"llamafactory-cli exited with code {rc}"
    update_status(job_dir, **extra)
    log(f"job {job_id}: {status} (exit={rc})")


def _terminate(proc: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=TERM_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()


def main() -> int:
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "queue").mkdir(exist_ok=True)
    (ROOT / "runs").mkdir(exist_ok=True)
    (ROOT / "datasets").mkdir(exist_ok=True)
    recover_orphans()
    log(f"runner up (root={ROOT})")
    while True:
        write_heartbeat()
        job_id = pop_next_job()
        if job_id:
            try:
                run_job(job_id)
            except Exception as e:
                log(f"job {job_id} crashed: {type(e).__name__}: {e}")
                try:
                    update_status(
                        ROOT / "runs" / job_id,
                        status="failed",
                        error=f"{type(e).__name__}: {e}"[:400],
                        finished_at=time.time(),
                    )
                except OSError:
                    pass
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)