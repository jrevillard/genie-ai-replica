# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The three configuration drivers (story 4.1 — A, B, C over one runway).

* **Config A** — the legacy fixed RAG. The driver REUSES the anchor eval
  machinery (``eval/run_eval.py anchor``) via subprocess, exactly the
  ``capture_baseline._run_anchor_eval`` pattern — never a fork. The anchor's
  own behaviors carry over: resume through its ``.done`` sidecar on a stable
  report path, atomic report writes, fail-fast on missed traces.
* **Config B** — the story-1.9 no-agent pipeline, INVOKED never
  re-implemented: the harness ships ``config_b_driver.py`` into the
  agent-service container over the docker-exec transport and runs it there
  (where ``noagent.pipeline`` and the serving network position live); the
  driver consumes ``NoAgentResult`` unchanged. In tests the transport is a
  fake — the same calls, no docker.
* **Config C** — the governed agent seam: a ``POST /v1/runs`` SSE client
  (stdlib ``urllib`` — the driver process has no httpx). Admission refusals
  (429 ``admission_refused``), typed configuration errors (503), invalid
  requests (422) and mid-run stream death all record their honest outcomes;
  a cancellation case closes the stream after its first events and records
  ``cancelled`` — never a fabricated answer.

Every driver: per-case rows, atomic writes (``harness.write_json``), and
resume — an interrupted run keeps its completed rows on disk and re-runs
ONLY the unfinished case ids.

STDLIB-ONLY: no new runtime dependency (the eval toolchain's constraint).
"""

from __future__ import annotations

import base64
import http.client
import json
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))
from harness import write_json  # noqa: E402 — the eval toolchain's atomic JSON IO

# The temp dir the harness writes the B driver + its payload into, inside the
# agent-service container.
CONTAINER_TMP = "/tmp/genie-protocol"

# The container the agent-service serving image runs under (compose service
# `agent-service`; overridden per venue via --container).
DEFAULT_AGENT_CONTAINER = "agent-service"

# Cases per container invocation for config B (one docker exec per batch —
# a whole-set batch on a large set would outlive a single exec timeout).
DEFAULT_B_BATCH = 25

_ERROR_PREVIEW_CHARS = 300


class DriverError(RuntimeError):
    """A driver-level failure that is not a per-case outcome (e.g. the config-A
    anchor missed traces — the existing fail-fast behavior, reused)."""


def _error_preview(failed: BaseException) -> str:
    return f"{type(failed).__name__}: {str(failed)[:_ERROR_PREVIEW_CHARS]}"


def _load_entries(set_path: str | Path) -> list[dict]:
    data = json.loads(Path(set_path).read_text(encoding="utf-8"))
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise DriverError(f"{set_path} carries no entries list — run `validate-set` first")
    return entries


def _read_rows_file(rows_path: Path) -> dict:
    """The prior rows file ({"cases": {id: row}, "resolved": {...}}); a
    missing or unparseable file is a fresh start (the resume contract)."""
    if not rows_path.exists():
        return {"cases": {}}
    try:
        data = json.loads(rows_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"cases": {}}
    if not isinstance(data, dict) or not isinstance(data.get("cases"), dict):
        return {"cases": {}}
    return data


def _merge_rows(prior: dict, new: dict) -> dict:
    """Prior + new rows (new wins per case id) — the per-id invariant."""
    merged = dict(prior.get("cases") or {})
    merged.update(new.get("cases") or {})
    out = {"cases": merged}
    resolved = new.get("resolved") or prior.get("resolved")
    if resolved is not None:
        out["resolved"] = resolved
    return out


# ---------------------------------------------------------------------------
# Config A — the anchor eval, subprocess reuse
# ---------------------------------------------------------------------------


def _default_a_runner(gold: Path, out: Path, seed: int, env_extra: dict | None = None) -> dict:
    """The ``capture_baseline._run_anchor_eval`` pattern: one ``run_eval.py
    anchor`` subprocess with the seed forced into ``PYTHONHASHSEED``."""
    import capture_baseline  # local import: the sibling capture module

    return capture_baseline._run_anchor_eval(gold, out, seed, env_extra)


def run_config_a(
    set_path: str | Path,
    out_dir: str | Path,
    *,
    seed: int,
    runner=None,
    env_extra: dict | None = None,
) -> dict:
    """One config-A anchor run over the set; return ``{"report", "report_path"}``.

    The runner is injected so tests drive it without a live stack; the
    default reuses the capture machinery's subprocess invocation (never a
    fork). The report path is STABLE per set run — run_eval resumes from its
    own ``.done`` sidecar, so an interrupted run continues where it died.
    Fail-fast on missed traces (the anchor's existing behavior): a reference
    measurement with missed traces is a zero baseline in disguise.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "config-a.report.json"
    runner = runner or _default_a_runner
    report = runner(Path(set_path).resolve(), report_path.resolve(), seed, env_extra)
    if not isinstance(report, dict):
        raise DriverError(f"config A runner returned {type(report).__name__}, not a report dict")
    n_missed = int(report.get("n_missed_traces", 0))
    n_unmapped = int(report.get("n_unmapped_chunk_keys", 0))
    if n_missed > 0 or n_unmapped > 0:
        raise DriverError(
            f"config A run missed {n_missed} trace(s), {n_unmapped} unmapped chunk key(s) "
            "(observability off? stale traces?) — refusing to record a partial reference"
        )
    return {"report": report, "report_path": str(report_path)}


# ---------------------------------------------------------------------------
# Config B — the no-agent pipeline, invoked in-container
# ---------------------------------------------------------------------------


class DockerExecBTransport:
    """The docker-exec transport (the eval toolchain's established pattern):
    every B operation is a ``sh -c`` command run inside the agent-service
    container through ``harness.docker_exec``."""

    def exec_cmd(self, container: str, cmd: str, timeout: float = 600, pass_env: tuple = ()) -> str:
        from harness import docker_exec

        return docker_exec(container, cmd, timeout=timeout, pass_env=pass_env)


def _b64(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


# The byte bound for ONE shipped cases payload. The payload rides the argv of
# a single ``sh -c`` argument, and the kernel caps one argument at
# MAX_ARG_STRLEN (128 KiB) with E2BIG — a realistic set (hundreds of cases
# with queries, reference answers, expectations) blows past it. 64 KiB keeps
# every ship comfortably under the cap.
CASES_PAYLOAD_BOUND_BYTES = 64 * 1024


def _split_by_bytes(cases: list[dict], bound: int, max_count: int):
    """Split pending cases into payload-BYTE-bounded sub-batches (``bound``),
    with ``max_count`` as the case-count ceiling. A single case larger than
    the bound still ships alone — refusing it would hide the case; the exec
    stays under the cap only because one case's payload is bounded by the
    entry schema, not by this splitter."""
    chunk: list[dict] = []
    size = 0
    for case in cases:
        case_size = len(json.dumps(case, ensure_ascii=False).encode("utf-8")) + 1
        if chunk and (size + case_size > bound or len(chunk) >= max_count):
            yield chunk
            chunk, size = [], 0
        chunk.append(case)
        size += case_size
    if chunk:
        yield chunk


def run_config_b(
    set_path: str | Path,
    out_dir: str | Path,
    *,
    container: str = DEFAULT_AGENT_CONTAINER,
    transport=None,
    batch: int = DEFAULT_B_BATCH,
    payload_bound: int = CASES_PAYLOAD_BOUND_BYTES,
) -> dict:
    """Run the assessment set through config B inside the agent-service container.

    The flow: the driver script ships ONCE per invocation; each sub-batch of
    pending cases ships its payload in its OWN exec call (base64 through
    ``printf | base64 -d`` — no stdin, no docker cp) with the driver run in
    the same call, and the rows file read back (base64). Sub-batches are
    bounded by payload BYTES (``payload_bound``) with ``batch`` as the
    case-count ceiling, so no single argv approaches the kernel's
    MAX_ARG_STRLEN cap. Rows merge into the stable rows file atomically;
    resume sends ONLY the unfinished case ids (a case with a recorded row —
    including a failure row — is finished).

    ``transport`` is the seam the tests fake: anything with
    ``exec_cmd(container, cmd, timeout, pass_env) -> str``.
    """
    transport = transport or DockerExecBTransport()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / "config-b.rows.json"

    cases = _load_entries(set_path)
    prior = _read_rows_file(rows_path)
    done = set(prior.get("cases") or {})
    pending = [c for c in cases if c.get("id") not in done]

    script_path = Path(__file__).resolve().parent / "config_b_driver.py"
    script_b64 = _b64(script_path.read_bytes())
    transport.exec_cmd(
        container,
        f"mkdir -p {CONTAINER_TMP} && printf %s '{script_b64}' | base64 -d > {CONTAINER_TMP}/config_b_driver.py",
        timeout=120,
    )

    resolved = prior.get("resolved")
    batch = max(1, int(batch))
    payload_bound = max(1, int(payload_bound))
    for chunk in _split_by_bytes(pending, payload_bound, batch):
        cases_b64 = _b64(json.dumps({"cases": chunk}, ensure_ascii=False).encode("utf-8"))
        transport.exec_cmd(
            container,
            f"printf %s '{cases_b64}' | base64 -d > {CONTAINER_TMP}/cases.json"
            f" && python3 {CONTAINER_TMP}/config_b_driver.py"
            f" {CONTAINER_TMP}/cases.json {CONTAINER_TMP}/rows.json",
            timeout=3600,
        )
        rows_b64 = transport.exec_cmd(container, f"base64 -w0 {CONTAINER_TMP}/rows.json", timeout=60).strip()
        new_rows = json.loads(base64.b64decode(rows_b64).decode("utf-8"))
        resolved = new_rows.get("resolved") or resolved
        prior = _merge_rows(prior, new_rows)
        write_json(rows_path, prior, ensure_ascii=False)

    return {
        "rows": prior.get("cases") or {},
        "resolved": resolved,
        "rows_path": str(rows_path),
        "pending_ids": [c["id"] for c in pending],
        "done_ids": sorted(done),
    }


# ---------------------------------------------------------------------------
# Config C — the governed /v1/runs SSE seam
# ---------------------------------------------------------------------------

# Outcome vocabulary (honest terminal states, one per shape the seam can
# produce):
OUTCOME_ANSWERED = "answered"
OUTCOME_ERROR = "error"
OUTCOME_ADMISSION_REFUSED = "admission_refused"
OUTCOME_CONFIGURATION_ERROR = "configuration_error"
OUTCOME_INVALID_REQUEST = "invalid_request"
OUTCOME_HTTP_ERROR = "http_error"
OUTCOME_CANCELLED = "cancelled"
OUTCOME_STREAM_ERROR = "stream_error"

# The default cancellation point for a cancellation case: after the first
# stream event (run_started) — mid-run by construction on a real venue.
DEFAULT_CANCEL_AFTER_EVENTS = 1

# The 503 error codes the seam's fail-closed assembly answers with
# (app.py: budget_configuration_missing / run_surface_unconfigured).
CONFIGURATION_ERROR_CODES = ("budget_configuration_missing", "run_surface_unconfigured")


class UrllibRunStream:
    """One open ``POST /v1/runs`` exchange over stdlib ``urllib``.

    ``status``/``error_body`` carry the non-streaming refusals (429/503/422
    answer JSON, never an event stream); ``events()`` parses the SSE
    ``data:`` frames; ``close()`` is the cancellation point — closing the
    response mid-run is the client disconnect that cancels the run server-side.
    """

    def __init__(self, url: str, payload: dict, timeout: float, verify_tls: bool = False):
        self.status = 0
        self.error_body: dict | None = None
        self._response = None
        self._url = url
        self._payload = payload
        self._timeout = timeout
        self._ctx = None if verify_tls else ssl._create_unverified_context()
        self._open()

    def _open(self) -> None:
        body = json.dumps(self._payload).encode("utf-8")
        request = urllib.request.Request(
            self._url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            self._response = urllib.request.urlopen(request, timeout=self._timeout, context=self._ctx)
            self.status = self._response.status
        except urllib.error.HTTPError as failed:
            self.status = failed.code
            raw = failed.read()
            try:
                self.error_body = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self.error_body = {"raw": raw.decode("utf-8", errors="replace")[:_ERROR_PREVIEW_CHARS]}

    def events(self):
        """The parsed SSE ``data:`` payloads (JSON dicts), in arrival order.

        Iterating a 4xx stream yields nothing — the refusal was not a stream.
        """
        if self._response is None or self.status >= 400:
            return
        for raw_line in self._response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            payload_text = line[len("data:") :].strip()
            if not payload_text or payload_text == "[DONE]":
                continue
            yield json.loads(payload_text)

    def close(self) -> None:
        """Tear the connection down — the cancellation point for a mid-run close."""
        if self._response is not None:
            try:
                self._response.close()
            finally:
                self._response = None


class UrllibCTransport:
    """The stdlib transport: one ``UrllibRunStream`` per run request."""

    def open_run(self, url: str, payload: dict, timeout: float, verify_tls: bool = False) -> UrllibRunStream:
        return UrllibRunStream(url, payload, timeout, verify_tls=verify_tls)


def c_payload_for_case(case: dict, deadline_ms: int) -> dict:
    """The ``RunRequestBody`` shape: question, deadline, trusted caller context.

    The context fields come from the case's ``context`` block (the same shape
    config B's driver reads); the defaults give a public-access eval caller
    over the legacy graph — a restricted case declares its own narrower set.
    """
    raw = case.get("context") or {}
    return {
        "question": case["query"],
        "deadline_ms": deadline_ms,
        "context": {
            "user_id": str(raw.get("user_id") or "eval-config-c"),
            "authorized_graph_names": list(raw.get("authorized_graph_names") or []),
            "requested_labels": list(raw.get("requested_labels") or []),
        },
    }


def _outcome_for_http(status: int, body: dict) -> str:
    """The typed refusal classification. A 503 is configuration_error ONLY
    when the body names one of the seam's own error codes — a bare 503 (a
    proxy or an infra wall answering HTML) is NOT the seam's typed error and
    records as http_error."""
    error = str(body.get("error") or "")
    if status == 429 or error == "admission_refused":
        return OUTCOME_ADMISSION_REFUSED
    if error in CONFIGURATION_ERROR_CODES:
        return OUTCOME_CONFIGURATION_ERROR
    if status == 422:
        return OUTCOME_INVALID_REQUEST
    return OUTCOME_HTTP_ERROR


def run_one_case_c(
    case: dict,
    *,
    base_url: str,
    transport=None,
    deadline_ms: int = 600_000,
    timeout_margin_s: float = 60.0,
    cancel_after_events: int | None = None,
) -> dict:
    """One case through the ``/v1/runs`` seam; the row records the honest terminal state.

    A cancellation case (``case_class == "cancellation"``) closes the stream
    after ``cancel_after_events`` events: the row records ``cancelled`` with
    NO answer — a cancelled run has no honest terminal answer to fabricate
    (the seam itself emits no terminal event on cancellation). A 429/503/422
    refusal records the typed error the seam returned. The usage record, when
    the run reached its terminal, rides the row (the counter-metric input).
    """
    transport = transport or UrllibCTransport()
    is_cancellation = case.get("case_class") == "cancellation"
    if cancel_after_events is None:
        cancel_after_events = DEFAULT_CANCEL_AFTER_EVENTS

    url = f"{base_url.rstrip('/')}/v1/runs"
    timeout_s = deadline_ms / 1000.0 + timeout_margin_s
    started = time.monotonic()
    row: dict[str, Any] = {"case_id": case["id"], "status": "ok"}
    answer_parts: list[str] = []
    run_id: str | None = None
    usage_record: dict | None = None
    outcome: str | None = None
    error_text: str | None = None
    events_seen = 0
    stream = None
    try:
        # The open is INSIDE the try: a venue-down transport failure (URLError,
        # socket timeout) is a typed stream_error row for THIS case — the run
        # continues, it never dies untyped.
        stream = transport.open_run(url, c_payload_for_case(case, deadline_ms), timeout_s)
        if stream.status >= 400:
            body = stream.error_body or {}
            outcome = _outcome_for_http(stream.status, body)
            error_text = body.get("error") or f"the seam answered {stream.status}"
            row["error"] = body
        else:
            for event in stream.events():
                events_seen += 1
                kind = event.get("kind")
                run_id = event.get("run_id") or run_id
                if kind == "text_message_content":
                    text = (event.get("payload") or {}).get("text")
                    if isinstance(text, str):
                        answer_parts.append(text)
                elif kind == "run_finished":
                    outcome = OUTCOME_ANSWERED
                elif kind == "run_error":
                    payload = event.get("payload") or {}
                    outcome = OUTCOME_ERROR
                    error_text = str(payload.get("code") or "run_error")
                    if payload.get("message"):
                        error_text = f"{error_text}: {payload['message']}"
                elif "usage_record" in event:
                    usage_record = event["usage_record"]
                if is_cancellation and events_seen >= cancel_after_events:
                    break
            if is_cancellation and events_seen >= cancel_after_events and outcome is None:
                outcome = OUTCOME_CANCELLED
            if outcome is None:
                # The stream closed without a terminal event and without the
                # cancellation point: a stream death — recorded honestly.
                outcome = OUTCOME_STREAM_ERROR
                error_text = error_text or "the stream closed without a terminal event"
    except (
        json.JSONDecodeError,
        http.client.HTTPException,
        OSError,
        ValueError,
    ) as failed:
        # Transport death mid-open or mid-stream (IncompleteRead subclasses
        # HTTPException, not OSError — it is caught explicitly).
        if outcome is None:
            outcome = OUTCOME_STREAM_ERROR
            error_text = _error_preview(failed)
    finally:
        if stream is not None:
            stream.close()
    row["outcome"] = outcome
    row["run_id"] = run_id
    row["events_seen"] = events_seen
    row["wall_ms"] = round((time.monotonic() - started) * 1000.0, 1)
    # The answer surface exists ONLY on an answered terminal: a cancelled or
    # dead stream carries no answer, not even the partial text received
    # before the cut (a partial answer would fabricate a terminal state).
    if outcome == OUTCOME_ANSWERED and answer_parts:
        row["answer"] = "".join(answer_parts)
    if usage_record is not None:
        row["usage_record"] = usage_record
    if error_text is not None:
        row["error_text"] = error_text
    if is_cancellation:
        row["cancel_requested"] = True
        row["cancelled"] = outcome == OUTCOME_CANCELLED
    return row


def run_config_c(
    set_path: str | Path,
    out_dir: str | Path,
    *,
    base_url: str,
    transport=None,
    deadline_ms: int = 600_000,
) -> dict:
    """Run the assessment set through config C's governed seam; per-case rows,
    atomic writes, resume (only unfinished case ids are re-run)."""
    transport = transport or UrllibCTransport()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / "config-c.rows.json"

    cases = _load_entries(set_path)
    prior = _read_rows_file(rows_path)
    done = set(prior.get("cases") or {})
    pending = [c for c in cases if c.get("id") not in done]

    for case in pending:
        row = run_one_case_c(case, base_url=base_url, transport=transport, deadline_ms=deadline_ms)
        prior = _merge_rows(prior, {"cases": {case["id"]: row}})
        write_json(rows_path, prior, ensure_ascii=False)

    return {
        "rows": prior.get("cases") or {},
        "rows_path": str(rows_path),
        "pending_ids": [c["id"] for c in pending],
        "done_ids": sorted(done),
    }


# ---------------------------------------------------------------------------
# Model-id discovery (the manifest's "resolved model ids read from the
# serving endpoints")
# ---------------------------------------------------------------------------


def discover_model_ids(endpoint: str, *, fetch=None, timeout: float = 30.0, verify_tls: bool = False) -> dict:
    """Read the serving endpoint's model id (OpenAI-compatible ``/v1/models``).

    The same discovery shape the probe's client and the v06 harness use
    (override first is the caller's business; this helper reads the endpoint).
    Returns ``{"llm": "<id>"}`` — the role label is the manifest's vocabulary.
    """
    url = f"{endpoint.rstrip('/')}/v1/models"

    def _fetch(url: str, timeout: float) -> dict:
        ctx = None if verify_tls else ssl._create_unverified_context()
        with urllib.request.urlopen(url, timeout=timeout, context=ctx) as response:
            return json.loads(response.read().decode("utf-8"))

    body = (fetch or _fetch)(url, timeout)
    data = body.get("data") if isinstance(body, dict) else None
    entry = data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None
    if not entry or not entry.get("id"):
        raise DriverError(f"the model discovery at {url} carried no usable model entry")
    return {"llm": str(entry["id"])}
