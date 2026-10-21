# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""OKF RAGAS sidecar — Story 8-6 (ADR-okf-043).

Stateless FastAPI service the Node okf-server calls container-to-container
on genieai_network (like pii-service): INTERNAL only, never publicly
routed. Owns the three things only Python can do faithfully —
ragas TestsetGenerator (benchmark-suite generation with reference
answers), ragas evaluate() (the metric catalog), and all xlsx
serialization in the tests/rag-benchmarks formats.

Auth: every non-health route requires X-RAGAS-Secret == RAGAS_INTERNAL_SECRET
(default: OKF_INTERNAL_SECRET — the dataprep-callback contract). Fail-closed:
unset secret rejects everything (a misconfigured deployment must not
silently open).

Models are NOT indexed to any specific model (David 2026-10-17) — the
RAGAS_JUDGE_* / RAGAS_EMBED_* env vars point at the deployment's chosen
endpoints; capability minimums live in the spec's model-requirements.md.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

import ragas_engine
import xlsx_io

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("okf-ragas-service")

app = FastAPI(title="genie-ai-ragas-service", version="1.0.0")

_DEFAULT_METRICS = ["faithfulness", "context_precision", "context_recall", "answer_relevancy"]


def _secret() -> str:
    return os.getenv("RAGAS_INTERNAL_SECRET") or os.getenv("OKF_INTERNAL_SECRET") or ""


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path in ("/health", "/ready"):
        return await call_next(request)
    expected = _secret()
    provided = request.headers.get("x-ragas-secret", "")
    if not expected or provided != expected:
        # Fail-closed: unset server secret rejects; wrong client secret rejects.
        return JSONResponse(
            status_code=503,
            content={"error": "RAGAS_UNCONFIGURED", "message": "shared secret missing or invalid"},
        )
    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    ready = ragas_engine.judge_configured()
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"ready": ready, "judge_configured": ready, "embed_configured": bool(os.getenv("RAGAS_EMBED_MODEL"))},
    )


# --- background jobs (202 + poll) ------------------------------------------
# Generation and evaluation are LONG: minutes for a small suite, hours for
# the large query sets this feature exists for (David, 2026-10-17: "if it
# needs to be done async then do it async"). Holding one HTTP connection
# open for that long breaks on proxy idle timeouts and reports nothing — so
# the two model-bound endpoints return 202 + job_id immediately and run in
# background asyncio tasks the caller polls via GET /jobs/{id}. Same shape
# as okf-server's own 202+poll contract.
#
# The registry is in-memory by design (stateless service, single uvicorn
# worker): a restart orphans running jobs and the caller's next poll 404s,
# which okf-server maps to a typed "job vanished" failure. Nothing persists.
#
# Cancellation: DELETE /jobs/{id} cancels a running job's asyncio task, so a
# caller that gives up (suite deleted, worker failed, operator aborted)
# STOPS paying the GPU — an orphaned judge run kept a box at 100% for
# ~25 minutes before this existed (2026-10-17).


JOBS: dict[str, dict] = {}
JOBS_LOCK = asyncio.Lock()
MAX_CONCURRENT_JOBS = int(os.getenv("RAGAS_MAX_CONCURRENT_JOBS") or "2")
TERMINAL_TTL_S = int(os.getenv("RAGAS_JOB_TTL_S") or "3600")


def _nan_safe(value):
    """Recursively replace NaN/Inf floats with None — starlette renders
    responses with allow_nan=False, so ONE out-of-range float anywhere in a
    job payload 500s every poll of that job and strands its result (live
    2026-10-18: a NaN metric score in a finished run's per_query did exactly
    that). The engine nulls NaNs at the source; this is the safety net."""
    if isinstance(value, float):
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    if isinstance(value, dict):
        return {k: _nan_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_nan_safe(v) for v in value]
    return value


def _snapshot(job: dict) -> dict:
    out = {k: job.get(k) for k in ("job_id", "kind", "status", "phase", "error", "started_at", "finished_at")}
    if job.get("progress"):
        prog = dict(job["progress"])
        # The elapsed clock is recomputed on EVERY read: it was stored when
        # the phase last reported, so a phase that reports nothing for
        # minutes (the persona generation inside the synthesis phase) froze
        # the clock — a frozen clock reads as a frozen job (David, live
        # 2026-10-21: "the question synthesizing stage also blocks").
        if job.get("status") == "running" and job.get("started_at"):
            prog["elapsed_s"] = round(time.time() - job["started_at"], 1)
        out["progress"] = prog
    if job.get("status") == "done":
        out["result"] = job.get("result")
    return _nan_safe(out)


async def _start_job(kind: str) -> str:
    async with JOBS_LOCK:
        # Registry hygiene: terminal jobs older than the TTL are reaped so a
        # long-lived process does not accumulate finished entries forever.
        now = time.time()
        for jid in [jid for jid, j in JOBS.items() if j.get("finished_at") and now - j["finished_at"] > TERMINAL_TTL_S]:
            del JOBS[jid]
        running = sum(1 for j in JOBS.values() if j.get("status") in ("queued", "running"))
        if running >= MAX_CONCURRENT_JOBS:
            raise HTTPException(
                status_code=503,
                detail=f"busy: {running} job(s) already running (RAGAS_MAX_CONCURRENT_JOBS={MAX_CONCURRENT_JOBS})",
            )
        job_id = uuid.uuid4().hex[:12]
        JOBS[job_id] = {
            "job_id": job_id,
            "kind": kind,
            "status": "queued",
            "phase": "",
            "started_at": now,
            # the cooperative-stop signal: engine phases and synthesizer
            # wrappers poll it, so a cancelled job stops paying the GPU
            # within one in-flight LLM batch even though the worker thread
            # cannot be interrupted mid-call
            "cancel_event": threading.Event(),
        }
    return job_id


def _phase_tracker(job_id: str):
    """Progress callback for engine jobs: phase + optional counts and, since
    2026-10-20, the active transform's own bar (step/done/total/eta/rate —
    David: "the user needs more feedback than this") and the job's elapsed
    time, so the UI can show WHAT is running and HOW LONG it has run."""

    def _update(phase: str, done=None, total=None, step=None, rate_s=None, eta_s=None, calls=None) -> None:
        job = JOBS.get(job_id)
        if job is not None and job.get("status") == "running":
            job["phase"] = phase
            prog = {"phase": phase}
            if done is not None:
                prog["done"] = done
            if total is not None:
                prog["total"] = total
            if step:
                prog["step"] = step
            if rate_s:
                prog["rate_s"] = rate_s
            if eta_s is not None:
                prog["eta_s"] = eta_s
            # The judge-call count — a progress number that ALWAYS advances
            # with the work, for when the transform bar itself does not move
            # (2026-10-21: a frozen "0/1075" for 20 minutes).
            if calls is not None:
                prog["calls"] = calls
            prog["elapsed_s"] = round(time.time() - job.get("started_at", time.time()), 1)
            job["progress"] = prog

    return _update


async def _run_job(job_id: str, coro) -> None:
    job = JOBS[job_id]
    try:
        job["status"] = "running"
        result = await coro
        job["status"] = "done"
        job["result"] = result
    except asyncio.CancelledError:
        # CancelledError is a BaseException — invisible to the except below.
        # This task IS the cancellation target, so recording and ending here
        # is correct. The engine's heavy work runs in a worker thread
        # (thread confinement — see ragas_engine) which task.cancel cannot
        # interrupt: setting the event is what actually stops the judge
        # calls; the thread drains and exits on its own.
        job["cancel_event"].set()
        job["status"] = "cancelled"
        logger.info("job %s (%s) cancelled", job_id, job.get("kind"))
    except ragas_engine.EngineCancelled as e:
        # the engine saw the cancel event mid-run (cooperative stop)
        job["status"] = "cancelled"
        logger.info("job %s (%s) cancelled mid-run (%s)", job_id, job.get("kind"), e)
    except Exception as e:  # noqa: BLE001 — the failure IS the job result
        logger.exception("job %s (%s) failed", job_id, job.get("kind"))
        job["status"] = "failed"
        job["error"] = f"{type(e).__name__}: {e}"
    except BaseException as e:  # noqa: BLE001 — a BaseException (SystemExit, a
        # library's KeyboardInterrupt) would otherwise leave the job 'running'
        # FOREVER: it counted against MAX_CONCURRENT_JOBS (a slot leak) and the
        # okf-server poller extends its liveness horizon on any non-terminal
        # status, so the poller never gave up either (2026-10-21 sidecar
        # review F4). Two of those brick the sidecar with 503 busy.
        job["status"] = "failed"
        job["error"] = f"{type(e).__name__}: {e}"
        logger.exception("job %s (%s) died on a BaseException", job_id, job.get("kind"))
    finally:
        job["finished_at"] = time.time()


def _spawn_job(job_id: str, coro) -> None:
    JOBS[job_id]["task"] = asyncio.create_task(_run_job(job_id, coro))


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        # Name the REAL causes (2026-10-21 sidecar review F3): the old
        # "sidecar restarted?" text sent every operator chasing a container
        # that had never restarted, when the real cause was the job's own
        # TTL eviction.
        raise HTTPException(
            status_code=404,
            detail="unknown job (never submitted, already evicted by the retention window, or the sidecar restarted)",
        )
    return _snapshot(job)


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a running job (or drop a terminal one from the registry)."""
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown or expired job (sidecar restarted?)")
    task = job.get("task")
    if job.get("status") in ("queued", "running") and task is not None and not task.done():
        job["cancel_event"].set()  # cooperative stop first — the thread starts draining now
        task.cancel()
        # Give the loop a moment to deliver the cancellation so the response
        # usually reflects the terminal status. Best-effort — the caller's
        # next poll is authoritative either way.
        for _ in range(30):
            if job.get("status") not in ("queued", "running"):
                break
            await asyncio.sleep(0.1)
    snapshot = _snapshot(job)
    # A CANCELLED job STAYS in the registry (2026-10-21 sidecar review F3):
    # popping it made the caller's next poll a 404 — which the caller read as
    # "the sidecar restarted" and the okf-server poller turned into a
    # "job vanished" FAILURE for a cancel that had actually worked. Terminal
    # jobs age out through the TTL reap instead.
    return snapshot


# --- generation -----------------------------------------------------------


class ModelOverride(BaseModel):
    """8-7 model configs (2026-10-19): per-request judge/embedder routing
    resolved by okf-server from its named model configurations. The api_key
    rides the INTERNAL network only (okf-server → sidecar), exactly like the
    env-resident VLLM_API_KEY always has."""

    provider: str = "openai"
    base_url: str
    model: str
    api_key: str = ""


class GenerateRequest(BaseModel):
    documents: list[dict] = Field(default_factory=list)
    testset_size: int = Field(default=20, ge=1, le=500)
    query_distribution: list[dict] | None = None
    num_personas: int = Field(default=3, ge=1, le=10)
    judge: ModelOverride | None = None
    embed: ModelOverride | None = None


@app.post("/generate-testset", status_code=202)
async def generate_testset(req: GenerateRequest):
    if not req.documents:
        raise HTTPException(status_code=400, detail="documents must not be empty")
    if not req.judge and not ragas_engine.judge_configured():
        raise HTTPException(
            status_code=503, detail="judge endpoint not configured (RAGAS_JUDGE_BASE_URL / RAGAS_JUDGE_MODEL)"
        )
    job_id = await _start_job("generate-testset")
    _spawn_job(
        job_id,
        ragas_engine.generate_testset(
            req.documents,
            req.testset_size,
            req.query_distribution,
            req.num_personas,
            progress=_phase_tracker(job_id),
            cancel_event=JOBS[job_id]["cancel_event"],
            judge=req.judge.model_dump() if req.judge else None,
            embed=req.embed.model_dump() if req.embed else None,
        ),
    )
    return {"job_id": job_id, "status": "queued", "poll": f"/jobs/{job_id}"}


# --- evaluation -----------------------------------------------------------


class EvaluateRequest(BaseModel):
    samples: list[dict]
    metrics: list[str] | None = None
    timeout_s: int = Field(default=600, ge=30, le=3600)
    judge: ModelOverride | None = None
    embed: ModelOverride | None = None


@app.post("/evaluate", status_code=202)
async def evaluate(req: EvaluateRequest):
    if not req.samples:
        raise HTTPException(status_code=400, detail="samples must not be empty")
    if not req.judge and not ragas_engine.judge_configured():
        raise HTTPException(
            status_code=503, detail="judge endpoint not configured (RAGAS_JUDGE_BASE_URL / RAGAS_JUDGE_MODEL)"
        )
    job_id = await _start_job("evaluate")
    _spawn_job(
        job_id,
        ragas_engine.evaluate_samples(
            req.samples,
            req.metrics or _DEFAULT_METRICS,
            req.timeout_s,
            progress=_phase_tracker(job_id),
            cancel_event=JOBS[job_id]["cancel_event"],
            judge=req.judge.model_dump() if req.judge else None,
            embed=req.embed.model_dump() if req.embed else None,
        ),
    )
    return {"job_id": job_id, "status": "queued", "poll": f"/jobs/{job_id}"}


# --- xlsx -----------------------------------------------------------------


class ExportSuiteRequest(BaseModel):
    name: str = ""
    entries: list[dict]


@app.post("/xlsx/export-suite")
async def export_suite(req: ExportSuiteRequest):
    try:
        data = xlsx_io.write_suite_workbook(req.name, req.entries)
    except Exception as e:  # noqa: BLE001
        logger.exception("export-suite failed")
        raise HTTPException(status_code=500, detail=f"export failed: {e}") from e
    filename = (req.name or "benchmark-suite").replace(" ", "_")[:60]
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'},
    )


@app.post("/xlsx/import-suite")
async def import_suite(request: Request):
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="empty upload")
    try:
        parsed = xlsx_io.read_suite_workbook(body)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"not a readable suite xlsx: {e}") from e
    if not parsed["entries"]:
        raise HTTPException(
            status_code=400,
            detail="no entries found (expected his Test Dataset layout: header row 1, query column populated)",
        )
    return parsed


class ExportResultsRequest(BaseModel):
    suite: dict
    runs: list[dict]


@app.post("/xlsx/export-results")
async def export_results(req: ExportResultsRequest):
    if not req.runs:
        raise HTTPException(status_code=400, detail="runs must not be empty")
    labels = [str(r.get("label") or "run")[:26] for r in req.runs]
    if len(set(labels)) != len(labels):
        raise HTTPException(status_code=400, detail="run labels must be unique (<=26 chars)")
    try:
        data = xlsx_io.write_results_workbook(req.suite, req.runs)
    except Exception as e:  # noqa: BLE001
        logger.exception("export-results failed")
        raise HTTPException(status_code=500, detail=f"export failed: {e}") from e
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="benchmark-results.xlsx"'},
    )
