#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Config B driver — executed INSIDE the agent-service environment.

The harness ships this file into the agent-service container (via the
docker-exec transport, see ``drivers.run_config_b``) and runs it there, where
``noagent.pipeline`` and the component's dependency set are importable and
the vLLM/TEI/doc-repo network position is the serving position. The driver is
the caller story 1.9 defined — it NEVER re-implements noagent behavior:

* it imports ``noagent.pipeline`` (:class:`NoAgentPipeline`,
  :class:`NoAgentResult`) and consumes the result's fields verbatim;
* it assembles the pipeline through the same knobs config C's seam reads
  (``NoAgentConfig.load`` for the lane, ``OrchestratorConfig.load`` for the
  operation budget — the shared admission/budget policy is what makes the
  E02 attribution honest, AD-10);
* one case = one ``pipeline.run`` pass, admitted through the lane like every
  other request mode.

I/O (positional argv, matching the eval toolchain's convention)::

    python3 config_b_driver.py cases.json rows.json

``cases.json`` — ``{"cases": [{"id", "query", "language", "context": {...}}, ...]}``
``rows.json``  — ``{"cases": {case_id: row}, "resolved": {...}}`` written
ATOMICALLY (tmp + ``os.replace``) after EVERY case, so a mid-run kill leaves
the completed rows on disk and the harness's resume re-runs only the
unfinished case ids.

A row carries the ``NoAgentResult`` fields unchanged (answer, abstained,
abstention_reason, source_documents, metadata) plus the wall time. A per-case
failure (lane busy, transport refused, any exception) becomes a typed failure
row and the run CONTINUES — one broken case never loses the set.

The module-level helpers (row assembly, atomic write, argument shaping) are
importable WITHOUT the agent-service tree — the protocol suite exercises them
against a fake pipeline — while the imports of ``noagent.pipeline`` and the
assembly stay inside :func:`build_pipeline`, executed only in-container.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

# The component root inside the serving image (the Dockerfile's WORKDIR).
AGENT_SERVICE_HOME = os.environ.get("AGENT_SERVICE_HOME", "/app")

# The resolved-env keys the driver records in ``resolved`` — the noagent /
# port knobs (NOT the credentials; the recorder redacts by name elsewhere,
# and these keys are configuration, never secrets).
RESOLVED_ENV_PREFIXES = ("AGENT_", "NOAGENT_", "RERANKER_", "EMBEDDING_", "VLLM_")

_ERROR_PREVIEW_CHARS = 300


def atomic_write_json(path: str, obj) -> None:
    """tmp + ``os.replace`` — a crash never leaves a half-written rows file."""
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        finally:
            raise


def build_context(case: dict):
    """The case's trusted caller context (the shape ``RunRequestBody.context``
    carries on the C seam — the same fields, so B and C run under the same
    authorization shape)."""
    from capabilities.contract import CallerContext

    raw = case.get("context") or {}
    return CallerContext(
        user_id=str(raw.get("user_id") or "eval-config-b"),
        authorized_graph_names=tuple(raw.get("authorized_graph_names") or ()),
        requested_labels=tuple(raw.get("requested_labels") or ()),
    )


def build_history(case: dict) -> list[dict]:
    """The case's history: one user turn (the eval toolchain's drive_query shape)."""
    return [{"role": "user", "content": case["query"]}]


def row_from_result(case: dict, result, wall_ms: float) -> dict:
    """Consume the ``NoAgentResult`` unchanged — the row carries its fields
    verbatim (the contract this driver exists to keep: zero noagent behavior
    duplicated in the harness)."""
    return {
        "case_id": case["id"],
        "status": "ok",
        "answer": result.answer,
        "abstained": bool(result.abstained),
        "abstention_reason": result.abstention_reason,
        "source_documents": list(result.source_documents),
        "metadata": dict(result.metadata),
        "wall_ms": round(wall_ms, 1),
    }


def row_from_failure(case: dict, failed: BaseException, wall_ms: float) -> dict:
    """The typed per-case failure row (run continues — the set is not lost)."""
    return {
        "case_id": case["id"],
        "status": "failure",
        "error_type": type(failed).__name__,
        "error": str(failed)[:_ERROR_PREVIEW_CHARS],
        "wall_ms": round(wall_ms, 1),
    }


async def run_case(case: dict, pipeline) -> dict:
    """One case through the pipeline: timed, result-consumed, failure-typed."""
    started = time.monotonic()
    try:
        context = build_context(case)
        history = build_history(case)
        result = await pipeline.run(
            history,
            context,
            target_language=case.get("language") or None,
        )
        wall_ms = (time.monotonic() - started) * 1000.0
        return row_from_result(case, result, wall_ms)
    except Exception as failed:  # noqa: BLE001 — a per-case failure is a row, not a crash
        wall_ms = (time.monotonic() - started) * 1000.0
        return row_from_failure(case, failed, wall_ms)


def run_cases(cases: list[dict], pipeline) -> dict:
    """Every case, one run each (serial — the lane bounds concurrency and the
    eval measures quality, not throughput)."""
    rows = {}
    for case in cases:
        rows[case["id"]] = asyncio.run(run_case(case, pipeline))
    return rows


def build_pipeline():
    """The in-container assembly — the ONLY place the agent-service imports happen.

    The pipeline is story 1.9's, assembled from the deployment's own knobs:
    the lane from ``NoAgentConfig.load`` (the same ``AdmissionLane.from_config``
    the C seam builds), the budget from ``OrchestratorConfig.load`` (the same
    fail-closed read — the shared admission/budget policy of E02), and the
    capability via ``SearchKnowledgeCapability.create`` — the SAME capability
    object the governed run's port assembly wires (called directly by the
    no-agent pipeline, whose own authorized-set check refuses an empty set
    and validates graph names, per story 1.9).
    """
    sys.path.insert(0, AGENT_SERVICE_HOME)
    from agent.orchestrator import OrchestratorConfig
    from capabilities.search_knowledge import SearchKnowledgeCapability
    from noagent.config import NoAgentConfig
    from noagent.pipeline import NoAgentPipeline

    env = dict(os.environ)
    orchestrator_config = OrchestratorConfig.load(env)
    noagent_config = NoAgentConfig.load(env)
    capability = SearchKnowledgeCapability.create(env)
    budget = orchestrator_config.operation_budget

    pipeline = NoAgentPipeline.create(noagent_config, capability, budget, env)
    generation = getattr(pipeline, "_generation", None)
    model_id = getattr(generation, "model_id", None)
    return pipeline, model_id


def resolved_snapshot(model_id) -> dict:
    """The resolved-config record the rows file carries back to the harness
    (feeds the run manifest's configuration snapshot; credential-named keys
    are redacted before any manifest records it)."""
    resolved = {}
    for key, value in sorted(os.environ.items()):
        if key.startswith(RESOLVED_ENV_PREFIXES):
            resolved[key] = value
    return {"model_id": model_id, "env": resolved}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 2:
        print("usage: config_b_driver.py <cases.json> <rows.json>", file=sys.stderr)
        return 2
    cases_path, rows_path = argv
    with open(cases_path, encoding="utf-8") as fh:
        payload = json.load(fh)
    cases = payload.get("cases") or []

    pipeline, model_id = build_pipeline()
    rows = run_cases(cases, pipeline)

    atomic_write_json(rows_path, {"cases": rows, "resolved": resolved_snapshot(model_id)})
    print(f"config B rows → {rows_path} ({len(rows)} case(s))", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
