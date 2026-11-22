# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The execution-version record (FR-17) — what the run-start handshake carries.

One run is attributable to four versions: the IMPLEMENTATION that served it,
the MODEL it called, the PROMPT it was governed by and the CONFIGURATION it
was bounded by. :func:`build_execution_version_record` assembles that record
from an :class:`~agent.orchestrator.OrchestratorConfig` and the resolved
model identity; the orchestrator emits it on the ``run_started`` seam event
and the BFF persists it into the ``queries`` doc AT START (AD-11) — so a
cancelled, timed-out or crashed run keeps its versions the same way a
completed one does.

The record carries IDS AND FINGERPRINTS ONLY. The prompt axis is a hash over
the EFFECTIVE prompt (the two-tier override hashes the same way as the
shipped template — the hash is the identity, the ``version`` field names
which template the hash covers); the configuration axis hashes the resolved
non-secret knob values and carries them alongside so a deployment's bounds
are readable without re-deriving them. The builder's inputs are audited for
this: numbers, the policy name, the prompt (hashed, never carried), a model
id and its resolution source — a bearer token, an API key, a question or an
answer text has no path into the record.

The fingerprints are deliberately SHORT (12 hex): they identify, they do not
attest — recovering the exact prompt/config bytes is a deployment-side
lookup, not a brute-force target.
"""

import hashlib
import json

from .prompt import PRODUCTION_SYSTEM_PROMPT

IMPLEMENTATION_VERSION = "0.1.0"
"""The agent-service implementation version — the single source, imported by
``app.py``'s FastAPI ``version`` and stamped on every record."""

PROMPT_VERSION = "prod-1"
"""The version name of the shipped production prompt template
(:data:`agent.prompt.PRODUCTION_SYSTEM_PROMPT`). A deployment override is
NOT this template; its record says ``override`` and identifies the text by
its hash alone."""

PROMPT_OVERRIDE_VERSION = "override"

MODEL_SOURCE_OVERRIDE = "override"
MODEL_SOURCE_DISCOVERED = "discovered"
MODEL_SOURCE_UNRESOLVED = "unresolved"

_FINGERPRINT_LENGTH = 12

_NOTE_LIMIT = 200


def short_sha256(text: str) -> str:
    """The short fingerprint of one UTF-8 text — the prompt/config identity."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:_FINGERPRINT_LENGTH]


def configuration_values(config) -> dict:
    """The resolved, non-secret knob values of an ``OrchestratorConfig``.

    The fail-closed budget resolution, verbatim: numbers and the policy
    name. ``system_prompt`` is deliberately absent — the prompt is the
    record's own axis (hashed), and carrying the text here would defeat the
    hash-only rule. Every field is a deployment knob, none is a credential.
    """
    return {
        "max_steps": config.max_steps,
        "max_model_calls": config.max_model_calls,
        "max_tool_calls": config.max_tool_calls,
        "max_total_tokens": config.max_total_tokens,
        "max_evidence_bytes": config.max_evidence_bytes,
        "wall_clock_ceiling_seconds": config.wall_clock_ceiling_seconds,
        "operation_budget": {
            "timeout_ms": config.operation_budget.timeout_ms,
            "max_results": config.operation_budget.max_results,
            "max_result_bytes": config.operation_budget.max_result_bytes,
        },
        "verdict_policy": config.verdict_policy,
        "judge_timeout_ms": config.judge_timeout_ms,
    }


def configuration_fingerprint(values: dict) -> str:
    """The short hash over the canonical JSON of the resolved values — the
    same bytes on every service that resolves the same knobs."""
    canonical = json.dumps(values, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return short_sha256(canonical)


def degraded_execution_version_record(note: str) -> dict:
    """The total fallback: a VALID record of the usual shape, minted without
    touching the config (no hashing, no attribute reads) — the shape a run
    can always carry, even when the normal build path threw. The note rides
    the model axis (clamped like any other)."""
    return {
        "implementation": {"version": IMPLEMENTATION_VERSION},
        "model": {"id": None, "source": MODEL_SOURCE_UNRESOLVED, "note": str(note)[:_NOTE_LIMIT]},
        "prompt": {"version": "unknown", "sha256": "unknown"},
        "configuration": {"sha256": "unknown", "values": {}},
    }


def build_execution_version_record(
    *,
    config,
    model_id: str | None = None,
    model_source: str = MODEL_SOURCE_UNRESOLVED,
    model_note: str | None = None,
) -> dict:
    """Assemble the FR-17 record: implementation, model, prompt, configuration.

    ``config`` is the run's resolved :class:`~agent.orchestrator.OrchestratorConfig`
    (its ``system_prompt`` decides the prompt axis: the shipped template
    names :data:`PROMPT_VERSION`, any override names ``override`` — both are
    identified by the hash of the EFFECTIVE text). ``model_id`` /
    ``model_source`` / ``model_note`` carry the resolved model identity (see
    ``agent.probe.ProbeModelClient.model_identity`` — override, discovery,
    or the fail-soft unresolved entry the I/O matrix requires).
    """
    effective_prompt = config.system_prompt
    prompt_version = PROMPT_VERSION if effective_prompt == PRODUCTION_SYSTEM_PROMPT else PROMPT_OVERRIDE_VERSION
    values = configuration_values(config)
    model: dict = {"id": model_id, "source": model_source}
    if model_note:
        model["note"] = str(model_note)[:_NOTE_LIMIT]
    return {
        "implementation": {"version": IMPLEMENTATION_VERSION},
        "model": model,
        "prompt": {"version": prompt_version, "sha256": short_sha256(effective_prompt)},
        "configuration": {"sha256": configuration_fingerprint(values), "values": values},
    }
