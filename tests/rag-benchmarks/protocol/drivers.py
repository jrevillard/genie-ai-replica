# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The three configuration drivers (A, B, C over one runway).

* **Config A** — the legacy fixed RAG. The driver REUSES the anchor eval
  machinery (``eval/run_eval.py anchor``) via subprocess, exactly the
  ``capture_baseline._run_anchor_eval`` pattern — never a fork. The anchor's
  own behaviors carry over: resume through its ``.done`` sidecar on a stable
  report path, atomic report writes, fail-fast on missed traces.
* **Config B** — the no-agent pipeline, INVOKED never
  re-implemented: the harness ships ``config_b_driver.py`` into the
  agent-service container over the venue's exec transport (``docker exec``,
  or ``kubectl exec`` on a Kubernetes venue — ``EVAL_EXEC_BACKEND``) and
  runs it there
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
ONLY the unfinished case ids. Multi-turn cases execute their
turns strictly in order, each turn a full run with its own caller context;
a turn's row carries the turn-indexed id ``<case_id>#t<n>`` and the turn
index.

Beside the three drivers, ``run_config_a_capture`` captures
config A's per-case ANSWERS — the answer/abstention/latency judgment inputs
the E01 comparison needs and the anchor path (trace-only, whole-set) does
not carry. It imports ``run_eval.drive_query``/``_extract_answer`` VERBATIM
and never edits them: ``harness_sha`` is the reuse identity. The reference
command (:func:`run_config_a`) stays exactly the artifact the threshold
registry consumes — the capture is a separate command, not a change to it.

STDLIB-ONLY: no new runtime dependency (the eval toolchain's constraint).
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))
# These imports sit below the sys.path insert on purpose: the eval
# toolchain's exec/JSON-IO seam and the protocol's own digest module are
# resolved only after the eval dir is importable (and the relative
# protocol siblings carry no import cycle).
from harness import (
    exec_in_container,
    write_json,
)

from .config_b_driver import default_graph as config_b_default_graph
from .evalset import (
    as_label_list,
    coverage_census,
    evaluation_surface,
    turn_entries,
)
from .manifest import (
    sha256_file,
    sha256_json,
)
from .redaction import redact_deep
from .reuse import current_protocol_code_sha

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
    """The set's entries, loaded through the evalset validator — the
    composition/provenance floor rides the data path, so a driver invoked
    outside the CLI enforces the same contract the run commands do."""
    from .evalset import SetValidationError, load_set

    try:
        _, entries = load_set(set_path, kind="assessment")
    except SetValidationError as failed:
        raise DriverError(f"{set_path} is not a valid assessment set: {failed}") from failed
    return entries


# The reason a config-A row records for a security case: config A
# is the legacy fixed RAG — no authorization executor, no steerable agent.
A_SECURITY_SKIP_REASON = (
    "config A is the legacy fixed RAG: no agent surface to authorize or steer —"
    " the security scenario executes on the pair's B/C legs"
)


def _turn_field(entry: dict) -> dict:
    """The row's turn stamp (or nothing) — ONE helper so the turn-index rows
    never drift from the turn-indexed ids."""
    if entry.get("turn") is not None:
        return {"turn": entry["turn"]}
    return {}


def security_skip_rows(entries: list[dict]) -> dict:
    """The skipped rows a config-A reference run records for a set's security
    cases — one per turn entry, keyed by the same turn-indexed ids the
    verdict layer judges (a multi-turn case skips per turn). Recorded, never
    silent and never findings."""
    rows = {}
    for case in entries:
        if not isinstance(case, dict) or not case.get("security_scenario"):
            continue
        for entry in turn_entries(case):
            row = {"case_id": entry["id"], "outcome": "skipped", "reason": A_SECURITY_SKIP_REASON}
            row.update(_turn_field(entry))
            rows[entry["id"]] = row
    return rows


def _pending_in_order(cases: list[dict], done: set[str]) -> list[dict]:
    """The per-turn entries to run, in strict turn order: a
    multi-turn case re-runs from its FIRST missing turn through the end — a
    later turn never executes before an earlier one, so a partial prior run
    re-runs the tail rather than resuming mid-sequence."""
    pending: list[dict] = []
    for case in cases:
        if not isinstance(case, dict):
            continue
        expanded = turn_entries(case) if case.get("turns") else [case]
        first_missing = next((index for index, entry in enumerate(expanded) if entry["id"] not in done), None)
        if first_missing is not None:
            pending.extend(expanded[first_missing:])
    return pending


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
    """Prior + new rows (new wins per case id) — the per-id invariant, and the
    ENVELOPE keys (``resolved``, ``capture``, …) ride along: the new value
    wins, the prior's otherwise. A new envelope key needs no new branch here.
    """
    merged = dict(prior.get("cases") or {})
    merged.update(new.get("cases") or {})
    out = {"cases": merged}
    for key in set(prior) | set(new):
        if key == "cases":
            continue
        value = new.get(key)
        out[key] = value if value is not None else prior.get(key)
    return out


# ---------------------------------------------------------------------------
# Config A — the anchor eval, subprocess reuse
# ---------------------------------------------------------------------------


def _default_a_runner(gold: Path, out: Path, seed: int, env_extra: dict | None = None) -> dict:
    """The ``capture_baseline._run_anchor_eval`` pattern: one ``run_eval.py
    anchor`` subprocess with the seed forced into ``PYTHONHASHSEED``."""
    import capture_baseline  # local import: the sibling capture module

    return capture_baseline._run_anchor_eval(gold, out, seed, env_extra)


def anchor_projection(cases: list[dict]) -> list[dict]:
    """The anchor's INPUT: the set's retrieval-surface cases.

    One function, so the projection the anchor runs on and the projection the
    capture stamps are the same projection — and its digest (see
    :func:`anchor_projection_sha256`) identifies the anchor's input in the
    artifacts. A change to the surface model moves that digest; it never
    moves silently.
    """
    return [case for case in cases if evaluation_surface(case) == "retrieval"]


def anchor_projection_sha256(projection: list[dict]) -> str:
    """The digest of the anchor's input — the projection's identity.

    The set's own digest identifies the set; this identifies WHICH of its
    cases the chunk-level surface scores. Both are recorded, so an artifact
    says what it measured, not only what it was built from. The projection is
    the argument (not the cases): the caller already holds it, and deriving
    it twice would digest two lists that can only differ by accident.
    """
    return sha256_json(projection)


def _gold_without_identity(cases: list[dict]) -> list[str]:
    """The retrieval cases whose gold the anchor cannot match.

    The anchor's own rule (``eval/run_eval.py::score_anchor``): the gold list
    is every entry's content hash, and ONLY when no entry carries one does it
    fall back to the chunk keys. An entry that carries neither identity is
    dropped under both branches — and so is an entry that carries only a
    chunk key beside hashed siblings, because the hash branch wins. Such an
    entry matches against nothing while the case counts as annotated, so the
    case is listed here (the anchor would score it against fewer gold chunks
    than the set declares).

    A gold entry that is not an object is listed too: the anchor reads
    ``c.get(...)`` on every entry, so it would die on one with an
    AttributeError instead of refusing the set. The index is the entry's
    position in the set's own list.
    """
    unmatched: list[str] = []
    for case in cases:
        chunks = case.get("expected_chunks") or []
        entries = [chunk for chunk in chunks if isinstance(chunk, dict)]
        hash_branch = any(_has_text(chunk.get("content_hash")) for chunk in entries)
        for index, chunk in enumerate(chunks):
            if not isinstance(chunk, dict):
                unmatched.append(f"{case.get('id')}#gold{index}")
                continue
            identity = chunk.get("content_hash") if hash_branch else chunk.get("chunk_key")
            if not _has_text(identity):
                unmatched.append(f"{case.get('id')}#gold{index}")
    return unmatched


def _has_text(value) -> bool:
    """True for a non-empty string — the shape check the gold identities use."""
    return isinstance(value, str) and bool(value.strip())


def run_config_a(
    set_path: str | Path,
    out_dir: str | Path,
    *,
    seed: int,
    runner=None,
    env_extra: dict | None = None,
    entries: list[dict] | None = None,
) -> dict:
    """One config-A anchor run over the set; return ``{"report", "report_path", "rows"}``.

    The runner is injected so tests drive it without a live stack; the
    default reuses the capture machinery's subprocess invocation (never a
    fork). ``entries`` — the set's already-loaded entries (the CLI validated
    the set before calling); when absent the set file is loaded here so a
    direct driver caller enforces the same contract. The report path is
    STABLE per set run — run_eval resumes from its own ``.done`` sidecar, so
    an interrupted run continues where it died. Fail-fast on missed traces
    (the anchor's existing behavior): a reference measurement with missed
    traces is a zero baseline in disguise.

    The anchor is fed the set's RETRIEVAL-SURFACE cases only (written to
    ``config-a.gold.json``) and REFUSES a set it cannot measure: a retrieval
    case with no gold, one it cannot drive as one query, or a gold entry with
    no matchable identity.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "config-a.report.json"
    runner = runner or _default_a_runner
    cases = entries if entries is not None else _load_entries(set_path)
    # The anchor is the CHUNK-LEVEL instrument: it scores passages against a
    # case's gold, so it is fed exactly the retrieval-surface cases. The other
    # surfaces are measured by the capture (answers, outcomes) and the verdict
    # layer (security); feeding them to the anchor produced vacuous rows — a
    # gold-less query scores recall 1.0 by construction and every retrieved
    # chunk as noise — and that is how cases the protocol declares
    # inapplicable to config A came to be counted as unevaluated.
    census = coverage_census(cases)
    if census["retrieval_cases_without_gold"]:
        raise DriverError(
            "the config-A anchor refuses a set whose retrieval-surface cases carry no gold"
            f" ({', '.join(census['retrieval_cases_without_gold'])}) — the anchor scores passages"
            " against gold, so an unannotated case would score vacuously (recall 1.0 by"
            " construction) and count as measured while carrying no expectation"
        )
    anchor_cases = anchor_projection(cases)
    unanchorable = [str(case.get("id")) for case in anchor_cases if case.get("turns")]
    if unanchorable:
        raise DriverError(
            "the config-A anchor refuses a retrieval case it cannot drive as ONE query"
            f" ({', '.join(unanchorable)}) — a multi-turn case's queries are its turns (the"
            " capture's rows), so the chunk-level surface measures nothing on it"
        )
    shapeless = _gold_without_identity(anchor_cases)
    if shapeless:
        raise DriverError(
            "the config-A anchor refuses gold it cannot match"
            f" ({', '.join(shapeless)}) — the anchor matches on the content hashes and only"
            " falls back to the chunk keys when no entry carries one, so an entry dropped by"
            " that rule would match against nothing while the case counts as annotated"
        )
    gold_path = out_dir / "config-a.gold.json"
    write_json(
        gold_path,
        {
            "_doc": (
                "the config-A anchor's input: the set's retrieval-surface cases, derived from"
                f" {Path(set_path).name} — the anchor scores passages, so only the cases whose"
                " surface is the chunk-level one are anchored"
            ),
            "entries": anchor_cases,
        },
        ensure_ascii=False,
    )
    report = runner(gold_path.resolve(), report_path.resolve(), seed, env_extra)
    if not isinstance(report, dict):
        raise DriverError(f"config A runner returned {type(report).__name__}, not a report dict")
    n_missed = int(report.get("n_missed_traces", 0))
    n_unmapped = int(report.get("n_unmapped_chunk_keys", 0))
    if n_missed > 0 or n_unmapped > 0:
        raise DriverError(
            f"config A run missed {n_missed} trace(s), {n_unmapped} unmapped chunk key(s) "
            "(observability off? stale traces?) — refusing to record a partial reference"
        )
    # The security cases: A has no agent surface — the skipped rows
    # record the reason so the pair's report shows an intentional difference,
    # never a silent absence.
    skip_rows = security_skip_rows(cases)
    rows_path = out_dir / "config-a.rows.json"
    write_json(
        rows_path,
        {
            "cases": skip_rows,
            # What the run covered: the census per evaluation surface, and the
            # identity of the anchor's input. The anchor report carries rows
            # for the retrieval surface only, so this is where the reader
            # learns why.
            "coverage": census,
            "anchor_projection_sha256": anchor_projection_sha256(anchor_projection(cases)),
        },
        ensure_ascii=False,
    )
    return {
        "report": report,
        "report_path": str(report_path),
        "rows": skip_rows,
        "rows_path": str(rows_path),
        "coverage": census,
    }


# ---------------------------------------------------------------------------
# Config A answer capture — the E01 judgment inputs
# ---------------------------------------------------------------------------

# The response keys the capture records when the response carries them (the
# judged dimensions' provenance inputs). Looked up in the parsed envelope's
# ``metadata`` first, then at the top level — recorded only when present,
# never invented. ``abstained``/``abstention_reason`` are chatqna's own
# mechanical abstention facts (genieai_chatqna._mark_abstention) — config A
# records them when the response carries them.
# The shape each captured key must have to be recorded — the lists are lists;
# chatqna's abstention fact is a boolean and its reason a string. ONE dict:
# the key set and the expected types can never drift apart.
_A_CAPTURE_KEY_TYPES = {
    "source_documents": list,
    "citations": list,
    "abstained": bool,
    "abstention_reason": str,
    # The EFFECTIVE filter chatqna applied (its response metadata) — the A
    # side of the scope comparison against the B lane's metadata.
    "filter_labels": list,
}


def _prepare_anchor_bearer() -> None:
    """Mirror the anchor's own bearer bootstrap (``run_eval.main``): seed the
    in-run refresh clock when the operator opted into the refresh, and force
    ONE refresh when no static bearer was seeded.

    The anchor seeds that clock inside ``main()``; the capture imports
    ``run_eval`` as a module and never runs ``main()``, so without this the
    capture's FIRST TTL check sees an elapsed time of zero and refreshes at
    once — replacing a pre-minted service-account bearer with a realm token.
    The A leg would then answer under a DIFFERENT identity than the
    reference it is compared against.
    """
    import run_eval

    if not run_eval._refresh_configured():
        return
    # The seed reads THE ANCHOR'S OWN clock (run_eval.time): the TTL check
    # reads that module's clock, and a seed taken from another module's
    # `time` silently splits the clock in two — under any module-scoped
    # clock fake the seeded elapsed time goes negative and the run never
    # refreshes.
    run_eval._token_ts = run_eval.time.time()
    if not os.getenv("E2E_BEARER_TOKEN"):
        run_eval._maybe_refresh_token(force=True)


def _default_a_query(entry: dict) -> dict:
    """The default query seam: ``run_eval.drive_query`` + ``_extract_answer``,
    imported VERBATIM and in-function (never edited, never forked —
    ``harness_sha`` is the reuse identity).

    The bearer handling mirrors the anchor's own per-entry path: a
    TTL-bounded refresh before the drive and, on a 401/403, a forced refresh
    and ONE re-drive (both gated on the anchor's own refresh configuration).
    Without it the capture would 401 where the anchor answers — the capture's
    rows would read as an A-leg behaviour regression that is really an expired
    token. ``drive_query``'s own wall-clock start is the anchor's business;
    the protocol layer times the seam call itself (monotonic)."""
    import run_eval  # local import: the eval toolchain's query driver, reused verbatim

    run_eval._maybe_refresh_token()
    _start, body, status = run_eval.drive_query(entry)
    if status in (401, 403) and run_eval._refresh_configured() and run_eval._maybe_refresh_token(force=True):
        _start, body, status = run_eval.drive_query(entry)
    return {"http_status": status, "body": body, "answer": run_eval._extract_answer(body)}


def _response_source_fields(body) -> dict:
    """The source/citation fields the response body carries, when it carries
    them — an empty or non-JSON body contributes nothing (an honest absence)."""
    if not body:
        return {}
    try:
        data = json.loads(body)
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    metadata = data.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    fields = {}
    for key, expected in _A_CAPTURE_KEY_TYPES.items():
        value = metadata[key] if key in metadata else data.get(key)
        if isinstance(value, expected):
            fields[key] = value
    return fields


def _retrieval_scope(entry: dict) -> dict:
    """The label scope the A leg queried under, and the scope the case
    requested. The two legs' scopes are NOT the same construct — chatqna
    filters on the entry's category/service labels, the B lane on the case
    context's ``requested_labels`` — so the capture records both sides of the
    difference instead of implying they match."""
    context = entry.get("context")
    context = context if isinstance(context, dict) else {}
    requested = context.get("requested_labels")
    return {
        "sent_labels": {
            "category_labels": as_label_list(entry.get("categoryLabels")),
            "service_labels": as_label_list(entry.get("serviceLabels")),
        },
        "case_requested_labels": as_label_list(requested),
    }


def _capture_one_entry(entry: dict, query) -> dict:
    """One entry through the query seam; the captured row records the honest
    per-case outcome. ``ok`` = a 2xx HTTP status with the extracted answer and
    whatever source/citation/abstention fields the response carried;
    ``http_error`` = a non-2xx/absent status (no answer is invented);
    ``failure`` = the seam itself raised (transport down, docker exec failed).
    Every row is timed monotonic at the protocol layer."""
    started = time.monotonic()
    row: dict[str, Any] = {"case_id": entry["id"]}
    try:
        result = query(entry)
        wall_ms = round((time.monotonic() - started) * 1000.0, 1)
        status = int(result.get("http_status") or 0)
        if 200 <= status < 300:
            row["status"] = "ok"
            row["http_status"] = status
            row["answer"] = str(result.get("answer") or "")
            row.update(_response_source_fields(result.get("body")))
        else:
            row["status"] = "http_error"
            row["http_status"] = status
            body = result.get("body")
            row["error"] = body[:_ERROR_PREVIEW_CHARS] if isinstance(body, str) else ""
        # The scope is what the A leg SENT — the request was issued, whatever
        # the server answered. A row whose transport died (or that was
        # skipped) sent nothing, so it records no scope.
        row["retrieval_scope"] = _retrieval_scope(entry)
    except Exception as failed:  # noqa: BLE001 — a per-case failure is a row, not a crash
        wall_ms = round((time.monotonic() - started) * 1000.0, 1)
        row["status"] = "failure"
        row["error_type"] = type(failed).__name__
        row["error"] = _error_preview(failed)
    # The wall clock covers the seam call only — the same work the B leg
    # times — so the two M-4 surfaces measure the same thing.
    row["wall_ms"] = wall_ms
    row.update(_turn_field(entry))
    return row


def run_config_a_capture(
    set_path: str | Path,
    out_dir: str | Path,
    *,
    entries: list[dict] | None = None,
    query=None,
    corpus_fingerprint: str | None = None,
    corpus_fingerprint_source: str = "pinned",
) -> dict:
    """Capture config A's per-case answers over the assessment set.

    The E01 comparison's A-side judgment inputs: per-case ``answer``,
    ``http_status``, ``wall_ms`` (monotonic-timed here — the anchor subprocess
    cannot provide per-case timing) and the response's source/citation/
    abstention fields when the response carries them. The anchor machinery is
    reused VERBATIM: the default query seam imports
    ``run_eval.drive_query``/``_extract_answer`` and never edits them, so
    ``harness_sha`` stays stable.

    ``query`` is the fakeable seam (tests inject it; anything
    ``entry -> {"http_status", "body", "answer"}``). ``entries`` — the
    already-validated set entries; absent, the set is loaded here so a direct
    caller enforces the same contract. ``corpus_fingerprint`` — the corpus
    the capture ran under; it is STAMPED into the rows file together with the
    assessment-set digest, and the E01 join refuses a capture whose stamp
    does not match the manifests (a capture over another set or corpus never
    joins). The stamp lands on disk with the first written case; a converged
    resume keeps the stamp its prior file already carries. A prior rows file
    that carries
    cases but no stamp — or a stamp over another set or corpus — REFUSES the
    resume: the rows file certifies the set it was captured over, and a resume
    by case id across another set would certify one set's digest over another
    set's answers. Rows merge into ``config-a.captured.json`` atomically after
    EVERY case; resume re-runs ONLY the missing case ids (in strict turn order
    for multi-turn cases). A per-case failure is a recorded row and the run
    CONTINUES — one broken case never loses the set. The retrieval scope is
    recorded only on the rows that actually queried.

    The venue requirement: the seam drives chatqna through
    ``run_eval.drive_query`` — the SAME call the anchor makes — and mirrors
    the anchor's own bearer path around it: the capture seeds the in-run
    refresh clock exactly as ``run_eval.main`` does (so a pre-minted static
    bearer survives, and a missing one is fetched once up front), then a
    TTL-bounded refresh before the drive and a forced refresh plus ONE
    re-drive on a 401/403, all gated on the anchor's refresh configuration.
    The anchor's three-attempt retry for
    TRANSIENT failures is not mirrored: the capture records a per-case
    failure row instead, and the report counts it. The bearer machinery lives
    under ``eval/``, which the capture must not edit — its ``harness_sha`` is
    the capture-artifact reuse identity.

    The set's SECURITY cases are not queried: config A is the legacy fixed
    RAG — no authorization executor, no steerable agent — so they are
    recorded as skipped rows with ``A_SECURITY_SKIP_REASON``, exactly like the A
    reference run's rows. Firing an injected instruction at a surface that
    cannot resist it would produce evidence the protocol declares
    inapplicable.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / "config-a.captured.json"

    if not corpus_fingerprint:
        raise DriverError(
            "the capture stamps the corpus fingerprint it ran under — pass"
            " corpus_fingerprint (the E01 join verifies it against the manifests)"
        )

    cases = entries if entries is not None else _load_entries(set_path)
    prior = _read_rows_file(rows_path)

    stamp = {
        "assessment_set_sha256": sha256_file(set_path),
        "corpus_fingerprint": corpus_fingerprint,
        # "computed" = the fingerprint was measured from the corpus content
        # hashes; "pinned" = the operator's declaration. The report says so.
        "corpus_fingerprint_source": corpus_fingerprint_source,
        # What the set covers, per evaluation surface: the capture is the
        # artifact that says which cases run on which surface, so the census
        # rides the stamp rather than being reconstructed by every reader.
        "coverage": coverage_census(cases),
        # The identity of the ANCHOR's input — which of the set's cases the
        # chunk-level surface scores. A change to the surface model moves it.
        "anchor_projection_sha256": anchor_projection_sha256(anchor_projection(cases)),
        # The PROTOCOL's own code identity: the reuse check compares the
        # recorded digest against the live package, so a capture made before
        # a protocol change is not current evidence (the drivers, the set
        # validator and the verdict layer are behaviour the capture speaks
        # for).
        "protocol_code_sha256": current_protocol_code_sha(),
    }
    # The rows file certifies the SET it was captured over: resuming by case
    # id across another set would certify set B's digest while carrying set
    # A's answers. A prior file that carries cases MUST carry the matching
    # stamp — an unstamped prior file (an older capture, a hand-edited file)
    # has no provenance to resume under, so it refuses too.
    prior_stamp = prior.get("capture") if isinstance(prior, dict) else None
    prior_cases = prior.get("cases") or {} if isinstance(prior, dict) else {}
    if prior_cases and not isinstance(prior_stamp, dict):
        raise DriverError(
            f"the capture file {rows_path} carries {len(prior_cases)} row(s) and no stamp — a"
            " capture over one set or corpus never resumes into another; use a fresh out-dir"
        )
    if isinstance(prior_stamp, dict):
        for field in ("assessment_set_sha256", "corpus_fingerprint"):
            if prior_stamp.get(field) != stamp[field]:
                raise DriverError(
                    f"the capture file {rows_path} was captured over another"
                    f" {field} ({prior_stamp.get(field)!r} vs {stamp[field]!r}) — a capture over one"
                    " set or corpus never resumes into another; use a fresh out-dir"
                )

    done = set(prior.get("cases") or {})
    skips = security_skip_rows(cases)
    pending = _pending_in_order(cases, done)

    # The stamp rides the rows file: it lands on disk with the first written
    # case, and a converged resume keeps the stamp its prior file already
    # carries (a rows file without a stamp never reaches this point — it
    # refuses above).
    prior = _merge_rows(prior, {"cases": {}, "capture": stamp})

    seam = query or _default_a_query
    if query is None:
        # The default seam drives chatqna through the anchor's own query
        # path — the bearer bootstrap belongs with it.
        _prepare_anchor_bearer()
    cases = prior.setdefault("cases", {})
    for entry in pending:
        skipped = skips.get(entry["id"])
        if skipped is not None:
            # The skip row in the CAPTURE's own vocabulary (status, not the
            # config-C outcome of the reference run's rows).
            row = {"case_id": entry["id"], "status": "skipped", "wall_ms": 0.0}
            row["reason"] = skipped.get("reason", A_SECURITY_SKIP_REASON)
            row.update(_turn_field(entry))
        else:
            row = _capture_one_entry(entry, seam)
        cases[entry["id"]] = row
        write_json(rows_path, prior, ensure_ascii=False)

    return {
        "rows": prior.get("cases") or {},
        "rows_path": str(rows_path),
        "pending_ids": [entry["id"] for entry in pending],
        "capture": stamp,
    }


# ---------------------------------------------------------------------------
# Config B — the no-agent pipeline, invoked in-container
# ---------------------------------------------------------------------------


class ContainerExecBTransport:
    """The container-exec transport (the eval toolchain's established pattern):
    every B operation is a ``sh -c`` command run inside the agent-service
    container through ``harness.exec_in_container`` — docker on a
    compose/swarm venue, ``kubectl exec`` on a Kubernetes venue (the venue
    is selected by ``EVAL_EXEC_BACKEND``, never detected)."""

    def exec_cmd(self, container: str, cmd: str, timeout: float = 600, pass_env: tuple = ()) -> str:
        return exec_in_container(container, cmd, timeout=timeout, pass_env=pass_env)


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


def _b_ready_case(case: dict) -> dict:
    """The case as the in-container driver reads it: the requested labels in
    the shared shape (a LIST of label strings).

    The driver ships STANDALONE into the container, where the protocol
    package is absent, so the coercion cannot live in it without a second
    implementation of the rule. It lives HERE — at the write boundary the
    protocol owns — so the driver reads one shape and the two legs cannot
    disagree about the scope they applied.
    """
    context = case.get("context")
    if not isinstance(context, dict) or "requested_labels" not in context:
        return case
    ready = dict(case)
    ready["context"] = {**context, "requested_labels": as_label_list(context.get("requested_labels"))}
    return ready


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

    The flow: the driver script ships at most once per invocation (zero times on a converged resume); each sub-batch of
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
    transport = transport or ContainerExecBTransport()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / "config-b.rows.json"

    cases = _load_entries(set_path)
    prior = _read_rows_file(rows_path)
    # The resumed prior is redacted at load: a legacy rows file written by
    # the pre-redaction code may still carry the raw snapshot (see the
    # write-boundary redaction below).
    if isinstance(prior.get("resolved"), dict):
        prior["resolved"] = redact_deep(prior["resolved"])
    done = set(prior.get("cases") or {})
    pending = _pending_in_order(cases, done)

    if pending:
        # Nothing pending → no container round-trip at all (a converged resume
        # succeeds with the container down, as the count-batched flow did).
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
        shipped = {"cases": [_b_ready_case(case) for case in chunk]}
        cases_b64 = _b64(json.dumps(shipped, ensure_ascii=False).encode("utf-8"))
        transport.exec_cmd(
            container,
            f"printf %s '{cases_b64}' | base64 -d > {CONTAINER_TMP}/cases.json"
            f" && python3 {CONTAINER_TMP}/config_b_driver.py"
            f" {CONTAINER_TMP}/cases.json {CONTAINER_TMP}/rows.json",
            timeout=3600,
        )
        rows_b64 = transport.exec_cmd(container, f"base64 -w0 {CONTAINER_TMP}/rows.json", timeout=60).strip()
        new_rows = json.loads(base64.b64decode(rows_b64).decode("utf-8"))
        # The driver's resolved snapshot rides verbatim and the rows file is
        # the committed artifact: credential-named keys (VLLM_API_KEY rode
        # the VLLM_ prefix into a committed campaign copy) are redacted
        # HERE, at the write boundary, by the protocol's own rule — before
        # any merge or write. The resumed prior is redacted at load for the
        # same reason (a legacy file written by the old code).
        # Accepted trade (the rule's documented safe side, applied at this
        # boundary): AGENT_AUTHORIZED_GRAPHS/REPOS are dropped too — the
        # word "authorized" carries the auth marker and the exact-match
        # keep-list does not cover it. The manifest applies the same rule to
        # every map it records, so the manifest and the rows file lose that
        # evidence alike.
        if isinstance(new_rows.get("resolved"), dict):
            new_rows["resolved"] = redact_deep(new_rows["resolved"])
        resolved = new_rows.get("resolved") or resolved
        prior = _merge_rows(prior, new_rows)
        write_json(rows_path, prior, ensure_ascii=False)

    return {
        "rows": prior.get("cases") or {},
        "resolved": resolved,
        "rows_path": str(rows_path),
        "pending_ids": [c["id"] for c in pending],
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

# The 503 error codes the seam's fail-closed assembly answers with
# (app.py: budget_configuration_missing / run_surface_unconfigured).
CONFIGURATION_ERROR_CODES = ("budget_configuration_missing", "run_surface_unconfigured")


class UrllibRunStream:
    """One open ``POST /v1/runs`` exchange over stdlib ``urllib``.

    ``status``/``error_body`` carry the non-streaming refusals (429/503/422
    answer JSON, never an event stream); ``events()`` parses the SSE
    ``data:`` frames; ``close()`` is the cancellation point — closing the
    response mid-run is the client disconnect that cancels the run server-side.

    ``trace_id`` is the trace the run is expected to land in: the driver
    PROPAGATES its own W3C traceparent, so the agent's spans join that trace
    and the caller can fetch the run's trace by identity instead of guessing
    it out of a time window. The agent's own spans carry no run id (they
    carry counters and ids only), so the propagated trace id is the only
    exact handle on "this run's spans".
    """

    def __init__(self, url: str, payload: dict, timeout: float):
        self.status = 0
        self.error_body: dict | None = None
        self._response = None
        self._url = url
        self._payload = payload
        self._timeout = timeout
        # The propagated trace id (32 hex chars) and the parent span id
        # (16 hex chars) — W3C traceparent shape.
        self.trace_id = os.urandom(16).hex()
        self.parent_span_id = os.urandom(8).hex()
        # Eval venues are self-signed by default; the context is deliberately
        # unverified (no knob — a verifying venue can wrap the transport).
        self._ctx = ssl._create_unverified_context()
        self._open()

    def _open(self) -> None:
        body = json.dumps(self._payload).encode("utf-8")
        request = urllib.request.Request(
            self._url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "traceparent": f"00-{self.trace_id}-{self.parent_span_id}-01",
            },
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

    def open_run(self, url: str, payload: dict, timeout: float) -> UrllibRunStream:
        return UrllibRunStream(url, payload, timeout)


def c_payload_for_case(case: dict, deadline_ms: int) -> dict:
    """The ``RunRequestBody`` shape: question, deadline, trusted caller context.

    The context fields come from the case's ``context`` block (the same shape
    config B's driver reads); the defaults give a public-access eval caller
    over the legacy graph — a restricted case declares its own narrower set.
    The legacy graph's name rides ``EVAL_DEFAULT_GRAPH`` (the venue's corpus
    graph; GRAPH on the campaign venue) — a case that declares NO graph set
    is that public-access caller, never an empty (refused) set.
    """
    raw = case.get("context") or {}
    # ONE home for the fallback: the shipped driver's default_graph() (the
    # driver's copy is forced by its standalone in-container contract; the
    # orchestrator side reuses it so the two legs cannot drift).
    graphs = list(raw.get("authorized_graph_names") or []) or [config_b_default_graph()]
    return {
        "question": case["query"],
        "deadline_ms": deadline_ms,
        "context": {
            "user_id": str(raw.get("user_id") or "eval-config-c"),
            "authorized_graph_names": graphs,
            # The repo→graph mapping the CallerContext contract carries — the
            # OKF read scope. A malformed entry is dropped (the context block
            # is free-form at the schema level); an entry naming a graph
            # outside the authorized set fails on the service's own validator.
            "authorized_repos": [
                {"repo_id": str(repo["repo_id"]), "graph_name": str(repo["graph_name"])}
                for repo in (raw.get("authorized_repos") or [])
                if isinstance(repo, dict) and repo.get("repo_id") and repo.get("graph_name")
            ],
            # The shared coercion (evalset.as_label_list): a bare string is
            # ONE label (the server's rule), never one character per label.
            "requested_labels": as_label_list(raw.get("requested_labels")),
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
) -> dict:
    """One case through the ``/v1/runs`` seam; the row records the honest terminal state.

    A cancellation case (``case_class == "cancellation"``) closes the stream
    after the first stream event (``run_started``): the row records
    ``cancelled`` with NO answer — a cancelled run has no honest terminal
    answer to fabricate (the seam itself emits no terminal event on
    cancellation). A 429/503/422 refusal records the typed error the seam
    returned. The usage record, when the run reached its terminal, rides the
    row (the counter-metric input).
    """
    transport = transport or UrllibCTransport()
    is_cancellation = case.get("case_class") == "cancellation"

    url = f"{base_url.rstrip('/')}/v1/runs"
    timeout_s = deadline_ms / 1000.0 + 60  # the margin over the run's own deadline
    started = time.monotonic()
    row: dict[str, Any] = {"case_id": case["id"]}
    answer_parts: list[str] = []
    run_id: str | None = None
    usage_record: dict | None = None
    source_documents: list | None = None
    citations: list | None = None
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
                elif kind == "verdict":
                    # The citation-verdict projection: its
                    # source_documents carry the delivered provenance the
                    # security verdict layer's subset check reads.
                    verdict_payload = event.get("payload") or {}
                    if isinstance(verdict_payload.get("source_documents"), list):
                        source_documents = verdict_payload["source_documents"]
                    # The retrieval TUPLE of the agent path: the delivered
                    # citations (the provenance the answer was composed
                    # from). The legacy anchor reads its tuple from a
                    # reranker span; the agent's spans carry no chunk keys,
                    # so the citations are the tuple the SSE frames carry —
                    # the agent path's own retrieval record.
                    if isinstance(verdict_payload.get("citations"), list):
                        citations = verdict_payload["citations"]
                if is_cancellation and events_seen >= 1:
                    break
            if is_cancellation and events_seen >= 1 and outcome is None:
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
    # The trace the run's spans land in (the driver propagated its own
    # traceparent) — the exact handle on the run's trace.
    if stream is not None:
        row["trace_id"] = stream.trace_id
    row["events_seen"] = events_seen
    row["wall_ms"] = round((time.monotonic() - started) * 1000.0, 1)
    # The answer surface exists ONLY on an answered terminal: a cancelled or
    # dead stream carries no answer, not even the partial text received
    # before the cut (a partial answer would fabricate a terminal state).
    if outcome == OUTCOME_ANSWERED and answer_parts:
        row["answer"] = "".join(answer_parts)
    if usage_record is not None:
        row["usage_record"] = usage_record
    if source_documents is not None:
        row["source_documents"] = source_documents
    if citations is not None:
        row["citations"] = citations
    if error_text is not None:
        row["error_text"] = error_text
    # A turn's row records its turn index — the id carries the
    # same fact, the field keeps it machine-readable without parsing.
    row.update(_turn_field(case))
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
    atomic writes, resume (only unfinished case ids are re-run). Multi-turn
    cases run their turns strictly in order, each turn its own
    run under its own context."""
    transport = transport or UrllibCTransport()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_path = out_dir / "config-c.rows.json"

    cases = _load_entries(set_path)
    prior = _read_rows_file(rows_path)
    done = set(prior.get("cases") or {})
    pending = _pending_in_order(cases, done)

    for case in pending:
        row = run_one_case_c(case, base_url=base_url, transport=transport, deadline_ms=deadline_ms)
        prior = _merge_rows(prior, {"cases": {case["id"]: row}})
        write_json(rows_path, prior, ensure_ascii=False)

    return {
        "rows": prior.get("cases") or {},
        "rows_path": str(rows_path),
        "pending_ids": [c["id"] for c in pending],
    }


# ---------------------------------------------------------------------------
# The corpus-presence resolution (the security verdicts' precondition)
# ---------------------------------------------------------------------------


def corpus_presence_for(entries: list[dict], *, file_ids_by_graph: dict[str, set[str]] | None) -> dict[tuple, bool | None] | None:
    """The corpus-presence map the security verdicts' precondition reads
    (#2155): ``(identity, declared_graphs) -> True | False | None``.

    The resolution depends on the graphs the CASE declares, so the map is
    keyed per (identity, declared-graphs) — a per-identity memo would hand a
    restricted case the public graph's verdict for the same file id (a
    vacuous pass over the empty restricted graph, exactly what the
    precondition prevents). ``file_ids_by_graph`` maps a graph name to the
    file ids its ``<graph>_SOURCE`` collection carries — the live resolver
    reads ArangoDB (:func:`eval.arango.source_file_ids`, one AQL per graph);
    tests inject.

    Per declared identity:

    * present in ANY queried declared graph → ``True``;
    * a declared graph that was NOT armed (absent from the map) was never
      queried → ``None`` (unknown, never absent — calling it absent would
      fire the precondition on a corpus that exists);
    * all declared graphs queried and none carries it → ``False``;
    * no graphs declared → ``None`` (nothing to resolve against).

    OKF identities — a bare repo id (an ``authorized_repos`` entry) or a
    ``<repo>/<concept>`` id — resolve ``None``: the SOURCE collections carry
    file ids, so the precondition refuses to call OKF content absent from a
    resolution it cannot make.
    """
    if file_ids_by_graph is None:
        return None
    from .verdicts import authorized_identities

    presence: dict[tuple, bool | None] = {}
    for case in entries:
        if not isinstance(case, dict):
            continue
        context = case.get("context") or {}
        declared = authorized_identities(context) or set()
        repo_ids = {
            str(entry["repo_id"])
            for entry in (context.get("authorized_repos") or [])
            if isinstance(entry, dict) and entry.get("repo_id")
        }
        graphs_raw = context.get("authorized_graph_names")
        graphs = tuple(sorted(str(graph) for graph in graphs_raw)) if isinstance(graphs_raw, (list, tuple)) else ()
        graph_sets = [file_ids_by_graph.get(graph) for graph in graphs]
        queried = [file_ids for file_ids in graph_sets if file_ids is not None]
        unqueried = any(file_ids is None for file_ids in graph_sets)
        for identity in declared:
            if identity in repo_ids or "/" in identity:
                # OKF identity: not resolvable against SOURCE file ids.
                presence[(identity, graphs)] = None
            elif any(identity in file_ids for file_ids in queried):
                presence[(identity, graphs)] = True
            elif unqueried or not queried:
                presence[(identity, graphs)] = None
            else:
                presence[(identity, graphs)] = False
    return presence


# ---------------------------------------------------------------------------
# Model-id discovery (the manifest's "resolved model ids read from the
# serving endpoints")
# ---------------------------------------------------------------------------


def discover_model_ids(endpoint: str, *, fetch=None, timeout: float = 30.0) -> dict:
    """Read the serving endpoint's model id (OpenAI-compatible ``/v1/models``).

    The same discovery shape the probe's client and the v06 harness use
    (override first is the caller's business; this helper reads the endpoint).
    Returns ``{"llm": "<id>"}`` — the role label is the manifest's vocabulary.
    """
    url = f"{endpoint.rstrip('/')}/v1/models"

    def _fetch(url: str, timeout: float) -> dict:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(url, timeout=timeout, context=ctx) as response:
            return json.loads(response.read().decode("utf-8"))

    body = (fetch or _fetch)(url, timeout)
    data = body.get("data") if isinstance(body, dict) else None
    entry = data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None
    if not entry or not entry.get("id"):
        raise DriverError(f"the model discovery at {url} carried no usable model entry")
    return {"llm": str(entry["id"])}
