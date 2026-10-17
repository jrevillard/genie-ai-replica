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

import logging
import os

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


# --- generation -----------------------------------------------------------


class GenerateRequest(BaseModel):
    documents: list[dict] = Field(default_factory=list)
    testset_size: int = Field(default=20, ge=1, le=500)
    query_distribution: list[dict] | None = None
    num_personas: int = Field(default=3, ge=1, le=10)


@app.post("/generate-testset")
async def generate_testset(req: GenerateRequest):
    if not req.documents:
        raise HTTPException(status_code=400, detail="documents must not be empty")
    if not ragas_engine.judge_configured():
        raise HTTPException(
            status_code=503, detail="judge endpoint not configured (RAGAS_JUDGE_BASE_URL / RAGAS_JUDGE_MODEL)"
        )
    try:
        return await ragas_engine.generate_testset(
            req.documents, req.testset_size, req.query_distribution, req.num_personas
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 — surface as 502 with the cause
        logger.exception("generate-testset failed")
        raise HTTPException(status_code=502, detail=f"generation failed: {e}") from e


# --- evaluation -----------------------------------------------------------


class EvaluateRequest(BaseModel):
    samples: list[dict]
    metrics: list[str] | None = None
    timeout_s: int = Field(default=600, ge=30, le=3600)


@app.post("/evaluate")
async def evaluate(req: EvaluateRequest):
    if not req.samples:
        raise HTTPException(status_code=400, detail="samples must not be empty")
    if not ragas_engine.judge_configured():
        raise HTTPException(
            status_code=503, detail="judge endpoint not configured (RAGAS_JUDGE_BASE_URL / RAGAS_JUDGE_MODEL)"
        )
    try:
        return await ragas_engine.evaluate_samples(req.samples, req.metrics or _DEFAULT_METRICS, req.timeout_s)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("evaluate failed")
        raise HTTPException(status_code=502, detail=f"evaluation failed: {e}") from e


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
