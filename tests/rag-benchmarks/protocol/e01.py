# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The E01 comparison report (story 4.3) — A vs B behavior preservation.

A PURE, digest-pinned join of the A reference leg's artifacts (the anchor
report + ``capture-a``'s captured answer rows) and the gated B leg's
artifacts (the B rows + its gated manifest) into per-dimension M-1..M-5
records, an uncontrolled-differences section and per-case records. Pure:
every input is passed in, the module does no IO — the CLI loads, this builds.

The report's contract:

* **Every input artifact is digested** into the ``inputs`` record; the report
  is a pure function of its inputs plus a pinned ``created_utc`` — the same
  inputs and pin produce an identical digest (the reproducibility AC). The
  digest is canonical-JSON sha256 over the report body (the embedded
  ``digest`` key is excluded from its own input — recomputable with
  :func:`e01_report_digest`).
* **M-1..M-5 are each reported for BOTH configurations with the measurement
  surface named.** A surface a config cannot provide (B has no chunk-level
  retrieval surface; A anchor rows carry no resource fields) is recorded as
  not available WITH the reason — never invented, never silently dropped.
* **Uncontrolled differences are identified from recorded evidence**: the
  prompt digests and model ids from the two manifests, the execution-condition
  facts (a sequential anchor pass vs batched B lanes), and cache state
  recorded as unrecorded-by-the-harness (FR-27).
* **The defect ledger is lineage-verified before application** (corpus
  fingerprint + set digest + reference-manifest digest); its case ids carry
  ``reference_defect`` in the per-case records; a ledger ABSENT is recorded
  as absent — A failures then stand as plain comparison results (FR-26: a
  defect is recorded knowledge, never silently a requirement B must
  reproduce).
* **Refusals are typed** (:class:`E01Refusal`) and precede any report
  building: corpus/set lineage mismatch between the legs, a config-C
  manifest on the B leg (C belongs to E02), a missing leg artifact, a
  lineage-mismatched ledger.
* **No credentials anywhere in the report.** The report applies its OWN
  credential rule (:func:`_is_credential_key`) at every depth on every path it
  writes — the per-case rows, the M-5 values, the M-1 aggregate, the recorded
  label scopes, the capture stamp and the manifests' prompt/model maps. The
  rule is deliberately narrower than the manifest's (which drops every
  marker-named key): the report keeps the measurement names the judge needs
  (``chunk_key``, the token counts) and drops the credential names explicitly.
* **No judging in code**: M-2/M-3 verdicts belong to the judge layer under
  the versioned evaluator instructions; the report carries the judgment
  inputs (answers, abstention facts, sources), never verdicts.

The ledger is NOT gated: defects are recorded knowledge that reshapes
INTERPRETATION; thresholds remain the gate. The report states which ledger
(digest) was applied, or that none was — the honest-interpretation invariant
without a second gate.
"""

from __future__ import annotations

from datetime import UTC, datetime

from . import PROTOCOL_VERSION
from . import pairs as pairs_mod
from .evalset import base_case_id
from .manifest import SECRET_KEY_MARKERS, manifest_digest, sha256_json

E01_REPORT_VERSION = "1.0.0"

E01_REPORT_ARTIFACT = "e01-report"

E01_PAIR = "E01"

REFERENCE_DEFECTS_ARTIFACT = "reference-defects"

# M-1..M-5 — the epic's enumeration, in order (retrieval quality, answer
# grounding, abstention correctness, latency, resource consumption).
M_DIMENSIONS = {
    "M-1": "retrieval_quality",
    "M-2": "answer_grounding",
    "M-3": "abstention_correctness",
    "M-4": "latency",
    "M-5": "resource_consumption",
}

HONEST_EVIDENCE_STATEMENT = (
    "E01 honest evidence: this report joins recorded runs — it computes no verdict and"
    " proves nothing beyond the conditions its two legs ran under. The retrieval backend"
    " IS the variable under test (pair E01): the measurement surfaces differ by"
    " construction (A chunk-level, B doc-level) and the report names the surface under"
    " every dimension rather than manufacturing equivalence. A negative result is"
    " recorded, not massaged."
)

FR26_ABSENT_NOTE = (
    "no reference-defects ledger was supplied: every config-A result stands as a plain"
    " comparison result (FR-26 — a known defect is recorded knowledge, never silently a"
    " requirement to reproduce)"
)

FR26_APPLIED_NOTE = (
    "the lineage-verified ledger is applied: cases marked reference_defect are recorded"
    " reference knowledge — config B's result there is read in defect context, never"
    " silently as a requirement to reproduce the defect"
)

# The per-dimension measurement-surface wording (named ONCE here so the
# report and its tests share the phrasing — a comparison that hid the
# asymmetry would manufacture false equivalence).
A_M1_SURFACE = (
    "chunk-level anchor metrics (the anchor report's aggregate over per_query:"
    " recall, precision, complete_recall, noise, retrieval_recall, recall@k, ndcg@k)"
)
B_M1_SURFACE = "doc-level source_documents (the noagent contract is doc-level)"
B_M1_CHUNK_NOTE = (
    "config B exposes no chunk-level retrieval surface — a chunk-level surface is"
    " reachable only through a noagent contract change, which this comparison does not"
    " make; the doc-level source_documents record plus the judged answer dimensions are"
    " the B side of M-1"
)
A_M2_SURFACE = "captured answers (capture-a) — judged from the answer text under the versioned evaluator instructions"
B_M2_SURFACE = "B row answers + source_documents — judged under the same versioned evaluator instructions"
A_M3_SURFACE = (
    "chatqna's mechanical abstention facts when the response carries them"
    " (metadata.abstained / metadata.abstention_reason), otherwise judged from the answer text"
)
B_M3_SURFACE = "mechanical abstention fields (abstained / abstention_reason, recorded by the noagent lane)"
A_M4_SURFACE = "capture-a per-case wall_ms (monotonic timing at the protocol layer)"
B_M4_SURFACE = "config B row wall_ms (timed in-container by the B driver)"
A_M5_SURFACE = "none recorded"
B_M5_SURFACE = "row metadata only"
A_M5_REASON = (
    "the anchor's per-query rows record retrieval keys only and the captured A rows carry"
    " no resource fields — config A provides no resource-consumption surface"
)
B_M5_REASON = (
    "config B rows carry no resource record — the usage_record counter-metric surface"
    " belongs to config C (E02), and the noagent lane records none"
)

# The metadata keys that carry a resource record (usage / resources / cost).
# A credential-named key is never one of them — the marker list decides.
# The named resource record the B lane would carry. The report reads THAT
# key — it does not sniff the row's metadata for anything that looks like a
# cost.
_RESOURCE_KEY = "usage"

# The credential-named keys the report drops, at ANY depth. The marker set is
# the manifest's, plus the names that carry the marker as a substring. This
# rule is the REPORT's own and it is deliberately narrower than the manifest's
# (which drops every marker-named key, measurement names included): the report
# records measurement fields the judge needs (``chunk_key``, the token
# counts), so it keeps those and drops the credential names explicitly. The
# two rules diverge ON PURPOSE and the report applies this one on every path
# it writes (the per-case rows, the M-5 values, the M-1 aggregate, the
# recorded label scopes, the capture stamp and the manifests' prompt/model
# maps) — it never states two different things about the same datum.
# The manifest's marker list (one spelling in the tree) plus the header name
# the manifest's list does not carry.
CREDENTIAL_MARKERS = tuple(marker.lower() for marker in SECRET_KEY_MARKERS) + ("authorization",)

MEASUREMENT_KEY_NAMES = frozenset(
    {
        "chunk_key",
        "content_hash",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "input_tokens",
        "output_tokens",
        "prompt_tokens_details",
        "completion_tokens_details",
        "token_count",
        "tokens",
        # The anchor's own evidence counters — "…_keys" matches the KEY
        # marker, and the counter is evidence, not a credential.
        "n_unmapped_chunk_keys",
    }
)


# A token COUNT is a measurement; a token CREDENTIAL is not. The suffix rule
# covers the counts the allowlist cannot enumerate (the names inside the
# usage detail sub-dicts: cached_tokens, reasoning_tokens), and the qualifier
# list keeps the credential names out of it.
_TOKEN_COUNT_SUFFIXES = ("_tokens", "_token_count")
_CREDENTIAL_QUALIFIERS = ("access", "refresh", "auth", "bearer", "api", "secret", "session", "id_token")


def _is_credential_key(key) -> bool:
    """True when the key names a credential. The measurement names are the
    explicit exceptions — they are values the judge needs, not secrets."""
    name = str(key).lower()
    if name in MEASUREMENT_KEY_NAMES:
        return False
    if name.endswith(_TOKEN_COUNT_SUFFIXES):
        if any(qualifier in name for qualifier in _CREDENTIAL_QUALIFIERS):
            return True
        # A count — but only if the name carries no OTHER credential marker
        # ("password_tokens" is not a count). The TOKEN marker itself is the
        # suffix, so it does not count here.
        return any(marker in name for marker in CREDENTIAL_MARKERS if marker != "token")
    return any(marker in name for marker in CREDENTIAL_MARKERS)


class E01Refusal(RuntimeError):
    """The E01 comparison is refused before building; ``reason`` names the offense."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


# ---------------------------------------------------------------------------
# The reference-defects ledger (FR-26) — the thresholds pattern, not the gate
# ---------------------------------------------------------------------------


def reference_defects_file(
    *,
    corpus_fingerprint: str,
    assessment_set_sha256: str,
    reference_manifest: dict,
    defects: list,
) -> dict:
    """Assemble one reference-defects ledger record (campaign-authored — the
    harness never authors defect content; ``defects`` is passed in verbatim).

    The field shape mirrors the thresholds record: the artifact kind, the
    corpus fingerprint, the assessment-set digest and the reference-manifest
    digest the defects were recorded against. Each defect entry carries its
    own ``case_ids`` (the case-level ids the defect applies to — a turn row
    inherits its case's flag).
    """
    return {
        "artifact": REFERENCE_DEFECTS_ARTIFACT,
        "corpus_fingerprint": corpus_fingerprint,
        "assessment_set_sha256": assessment_set_sha256,
        "reference_manifest_sha256": manifest_digest(reference_manifest),
        "defects": defects,
    }


def verify_defects_lineage(
    ledger: dict,
    *,
    corpus_fingerprint: str,
    assessment_set_sha256: str,
    reference_manifest_sha256: str,
) -> None:
    """Lineage-verify one ledger against THIS comparison's lineage; raise
    :class:`E01Refusal` naming the mismatch — before any report is built."""
    if not isinstance(ledger, dict):
        raise E01Refusal(
            "defects_not_a_ledger",
            f"the supplied defects file is a {type(ledger).__name__}, not a"
            f" {REFERENCE_DEFECTS_ARTIFACT!r} artifact — refusing before the report is built",
        )
    if ledger.get("artifact") != REFERENCE_DEFECTS_ARTIFACT:
        raise E01Refusal(
            "defects_not_a_ledger",
            f"the supplied defects file is {ledger.get('artifact')!r}, not a"
            f" {REFERENCE_DEFECTS_ARTIFACT!r} artifact — refusing before the report is built",
        )
    mismatched = []
    if ledger.get("corpus_fingerprint") != corpus_fingerprint:
        mismatched.append("the corpus fingerprint")
    if ledger.get("assessment_set_sha256") != assessment_set_sha256:
        mismatched.append("the assessment set digest")
    if ledger.get("reference_manifest_sha256") != reference_manifest_sha256:
        mismatched.append("the reference manifest digest")
    if mismatched:
        raise E01Refusal(
            "defects_lineage_mismatch",
            f"the reference-defects ledger does not cover this comparison:"
            f" {' and '.join(mismatched)} differ — refusing before the report is built",
        )


def _defect_case_ids(defects: list | None) -> set[str]:
    ids = set()
    for defect in defects or []:
        if isinstance(defect, dict):
            for case_id in defect.get("case_ids") or []:
                ids.add(str(case_id))
    return ids


def _is_defect_case(case_id: str, defect_ids: set[str]) -> bool:
    """A turn row (``<case>#t<n>``) inherits its case-level defect flag."""
    if case_id in defect_ids:
        return True
    base = base_case_id(case_id)
    return base != case_id and base in defect_ids


# ---------------------------------------------------------------------------
# The typed refusals — before any report is built
# ---------------------------------------------------------------------------


# The per-leg row vocabularies: config B's rows carry ``status`` (ok|failure),
# config A's captured rows carry ``status`` (ok|http_error|failure|skipped).
# Config C's rows carry ``outcome`` — a rows file of another leg is refused,
# never silently filtered down to an empty comparison leg.
ROW_STATUS_VOCABULARY = {
    "A": ("ok", "http_error", "failure", "skipped"),
    "B": ("ok", "failure"),
}


def _verify_row_vocabulary(rows: dict, config: str) -> None:
    """Refuse a rows file that does not speak the leg's vocabulary — a leg that
    never ran must never be presented as a leg that scored zero."""
    allowed = ROW_STATUS_VOCABULARY[config]
    for case_id, row in rows.items():
        if not isinstance(row, dict):
            raise E01Refusal(
                "missing_artifact",
                f"the {config}-leg row for {case_id!r} is not a mapping — refusing before the report is built",
            )
        if "status" not in row:
            raise E01Refusal(
                "wrong_leg",
                f"the {config}-leg row for {case_id!r} carries no status field — these rows are"
                " another leg's (config C rows carry outcome) — refusing before the report is built",
            )
        status = row.get("status")
        if status not in allowed:
            raise E01Refusal(
                "wrong_leg",
                f"the {config}-leg row for {case_id!r} carries status {status!r}, outside the"
                f" {config}-leg vocabulary {allowed} — refusing before the report is built",
            )


def _manifest_lineage(manifest: dict) -> tuple[str | None, str | None]:
    """The (corpus fingerprint, assessment-set digest) a manifest records —
    one derivation, used by the refusal and by the report's inputs."""
    corpus = (manifest.get("corpus") or {}).get("fingerprint")
    assessment = ((manifest.get("sets") or {}).get("assessment") or {}).get("sha256")
    return corpus, assessment


def _verify_legs(
    *,
    reference_manifest: dict,
    gated_manifest: dict,
    anchor_report: dict,
    captured_rows: dict,
    b_rows: dict,
    capture_stamp: dict | None = None,
) -> None:
    """The leg-artifact and lineage checks, in refusal order: presence, leg
    identity, lineage."""
    if not isinstance(reference_manifest, dict) or not reference_manifest:
        raise E01Refusal("missing_artifact", "the A-leg reference manifest is missing")
    if not isinstance(gated_manifest, dict) or not gated_manifest:
        raise E01Refusal("missing_artifact", "the B-leg gated manifest is missing")
    if not isinstance(anchor_report, dict) or not anchor_report:
        raise E01Refusal(
            "missing_artifact",
            "the A anchor report is missing (the reference run's config-a.report.json)",
        )
    if not isinstance(captured_rows, dict) or not captured_rows:
        raise E01Refusal(
            "missing_artifact",
            "the A captured rows are missing or carry no case rows (capture-a's config-a.captured.json)",
        )
    if not isinstance(b_rows, dict) or not b_rows:
        raise E01Refusal(
            "missing_artifact",
            "the B rows are missing or carry no case rows (the gated run's config-b.rows.json)",
        )
    ref_kind = reference_manifest.get("kind")
    ref_config = reference_manifest.get("config")
    if ref_kind != "reference" or ref_config != "A":
        raise E01Refusal(
            "wrong_leg",
            f"the A leg requires a reference config-A manifest (got kind {ref_kind!r}, config {ref_config!r})",
        )
    kind = gated_manifest.get("kind")
    config = gated_manifest.get("config")
    if config == "C":
        raise E01Refusal(
            "wrong_leg",
            f"the B leg carried a config-C manifest — config C belongs to pair"
            f" {pairs_mod.CONFIG_PAIR.get('C')}, not E01 (A vs B)",
        )
    if kind != "gated" or config != "B":
        raise E01Refusal(
            "wrong_leg",
            f"the B leg requires a gated config-B manifest (got kind {kind!r}, config {config!r})",
        )
    _verify_row_vocabulary(captured_rows, "A")
    _verify_row_vocabulary(b_rows, "B")
    ref_corpus, ref_set = _manifest_lineage(reference_manifest)
    b_corpus, b_set = _manifest_lineage(gated_manifest)
    # Lineage must be PRESENT on both sides: two manifests that carry no
    # fingerprint at all would compare equal (None == None) and the report
    # would claim a shared corpus it never checked.
    absent = []
    if not ref_corpus:
        absent.append("the A leg's corpus fingerprint")
    if not b_corpus:
        absent.append("the B leg's corpus fingerprint")
    if not ref_set:
        absent.append("the A leg's assessment set digest")
    if not b_set:
        absent.append("the B leg's assessment set digest")
    if absent:
        raise E01Refusal(
            "lineage_mismatch",
            f"the legs carry no lineage — {' and '.join(absent)} missing — refusing before the report is built",
        )
    mismatched = []
    if ref_corpus != b_corpus:
        mismatched.append(f"the corpus fingerprint (A {ref_corpus!r} vs B {b_corpus!r})")
    if ref_set != b_set:
        mismatched.append(f"the assessment set digest (A {ref_set!r} vs B {b_set!r})")
    if mismatched:
        raise E01Refusal(
            "lineage_mismatch",
            "the legs do not share a lineage — " + " and ".join(mismatched) + " — refusing before the report is built",
        )
    # The B run was gated against a reference manifest — the gate wrote that
    # pointer into the gated manifest. It must be THIS reference: two
    # reference runs over the same corpus and set share the corpus and set
    # digests but not the manifest digest, and pairing A from one with B
    # gated against another would apply thresholds signed for a different
    # measurement.
    gated_against = (gated_manifest.get("lineage") or {}).get("reference_manifest_sha256")
    reference_digest = manifest_digest(reference_manifest)
    if gated_against != reference_digest:
        raise E01Refusal(
            "lineage_mismatch",
            f"the B leg was gated against a different reference manifest ({gated_against!r} vs"
            f" {reference_digest!r}) — pass the reference the gate selected — refusing before the"
            " report is built",
        )
    # The A capture is the one leg the manifests cannot cover (it is not a
    # run): it stamps the set digest and the corpus fingerprint it ran under,
    # and a capture over another set or corpus never joins.
    if not isinstance(capture_stamp, dict) or not capture_stamp:
        raise E01Refusal(
            "missing_artifact",
            "the A capture carries no stamp (the assessment-set digest and the corpus fingerprint"
            " it ran under) — refusing before the report is built",
        )
    stamped_set = capture_stamp.get("assessment_set_sha256")
    stamped_corpus = capture_stamp.get("corpus_fingerprint")
    if stamped_set != ref_set:
        raise E01Refusal(
            "lineage_mismatch",
            f"the A capture ran over another assessment set ({stamped_set!r} vs {ref_set!r}) —"
            " refusing before the report is built",
        )
    if stamped_corpus != ref_corpus:
        raise E01Refusal(
            "lineage_mismatch",
            f"the A capture ran over another corpus ({stamped_corpus!r} vs {ref_corpus!r}) —"
            " refusing before the report is built",
        )


# ---------------------------------------------------------------------------
# The per-dimension records
# ---------------------------------------------------------------------------


def _surface_record(*, surface: str, available: bool, values=None, not_available_reason=None, notes=None) -> dict:
    record: dict = {"measurement_surface": surface, "available": available}
    if values is not None:
        record["values"] = values
    if not_available_reason is not None:
        record["not_available_reason"] = not_available_reason
    if notes:
        record["notes"] = notes
    return record


def _ok_rows(rows: dict) -> list[dict]:
    return [row for row in rows.values() if isinstance(row, dict) and row.get("status") == "ok"]


def _build_m1(anchor_report: dict, b_rows: dict) -> tuple[dict, dict]:
    aggregate = dict(anchor_report.get("aggregate") or {})
    aggregate["n_missed_traces"] = anchor_report.get("n_missed_traces", 0)
    aggregate["n_unmapped_chunk_keys"] = anchor_report.get("n_unmapped_chunk_keys", 0)
    # The anchor's aggregate is a RECORDED value like any other — the report
    # writes it through the same redaction as every other path.
    a = _surface_record(surface=A_M1_SURFACE, available=True, values=_redact_deep(aggregate))
    ok = _ok_rows(b_rows)
    with_sources = sum(1 for row in ok if row.get("source_documents"))
    b = _surface_record(
        surface=B_M1_SURFACE,
        available=True,
        values={
            "n_rows": len(ok),
            "n_rows_with_source_documents": with_sources,
            "n_rows_with_empty_source_documents": len(ok) - with_sources,
        },
        notes=[B_M1_CHUNK_NOTE],
    )
    return a, b


def _build_m2(captured_rows: dict, b_rows: dict) -> tuple[dict, dict]:
    a_ok = _ok_rows(captured_rows)
    b_ok = _ok_rows(b_rows)
    a = _surface_record(
        surface=A_M2_SURFACE,
        available=True,
        values={
            "n_ok_rows": len(a_ok),
            "n_empty_answers": sum(1 for row in a_ok if not str(row.get("answer") or "").strip()),
        },
    )
    b = _surface_record(
        surface=B_M2_SURFACE,
        available=True,
        values={
            "n_ok_rows": len(b_ok),
            "n_empty_answers": sum(1 for row in b_ok if not str(row.get("answer") or "").strip()),
            "n_rows_with_source_documents": sum(1 for row in b_ok if row.get("source_documents")),
        },
    )
    return a, b


def _build_m3(captured_rows: dict, b_rows: dict) -> tuple[dict, dict]:
    a_ok = _ok_rows(captured_rows)
    b_ok = _ok_rows(b_rows)
    a = _surface_record(
        surface=A_M3_SURFACE,
        available=True,
        values={
            "n_ok_rows": len(a_ok),
            "n_rows_with_abstention_fact": sum(1 for row in a_ok if "abstained" in row),
            "n_abstained": sum(1 for row in a_ok if row.get("abstained") is True),
            "n_with_abstention_reason": sum(1 for row in a_ok if row.get("abstention_reason")),
            "n_empty_answers": sum(1 for row in a_ok if not str(row.get("answer") or "").strip()),
            "n_skipped_rows": sum(
                1 for row in captured_rows.values() if isinstance(row, dict) and row.get("status") == "skipped"
            ),
            "n_http_error_rows": sum(
                1 for row in captured_rows.values() if isinstance(row, dict) and row.get("status") == "http_error"
            ),
            "n_failure_rows": sum(
                1 for row in captured_rows.values() if isinstance(row, dict) and row.get("status") == "failure"
            ),
        },
    )
    b = _surface_record(
        surface=B_M3_SURFACE,
        available=True,
        values={
            "n_ok_rows": len(b_ok),
            "n_abstained": sum(1 for row in b_ok if row.get("abstained") is True),
            "n_with_abstention_reason": sum(1 for row in b_ok if row.get("abstention_reason")),
            "n_not_abstained": sum(1 for row in b_ok if row.get("abstained") is False),
            "n_failure_rows": sum(
                1 for row in b_rows.values() if isinstance(row, dict) and row.get("status") == "failure"
            ),
        },
    )
    return a, b


def _latency_values(rows: dict) -> tuple[list[float], int]:
    """The ok rows' wall_ms values + the count of non-ok rows excluded from
    them (a failed case's latency is not the answer latency)."""
    walls = [
        float(row["wall_ms"])
        for row in _ok_rows(rows)
        if isinstance(row.get("wall_ms"), (int, float)) and not isinstance(row.get("wall_ms"), bool)
    ]
    excluded = sum(1 for row in rows.values() if isinstance(row, dict) and row.get("status") != "ok")
    return walls, excluded


def _latency_stats(values: list[float]) -> dict:
    """min / median / max / MAD in the metric's OWN unit (milliseconds).

    No tolerance band is published: the capture machinery's ``compute_triples``
    clamps its band to [0, 1] (it was written for normalized metrics), which
    would invert a millisecond band — and the tolerance itself is story 4.4's
    to sign, not the harness's to invent.
    """
    import capture_baseline  # local import: the capture module's median/MAD

    ordered = sorted(float(value) for value in values)
    median = capture_baseline.median(ordered)
    mad = capture_baseline.mad(ordered)
    return {
        "n": len(ordered),
        "min": ordered[0],
        "median": median,
        "max": ordered[-1],
        "mad": mad,
        "unit": "ms",
    }


def _latency_surface(rows: dict, surface: str) -> dict:
    walls, excluded = _latency_values(rows)
    if not walls:
        return _surface_record(
            surface=surface,
            available=False,
            not_available_reason="no ok rows carry wall_ms",
        )
    return _surface_record(
        surface=surface,
        available=True,
        values={**_latency_stats(walls), "n_excluded_non_ok_rows": excluded},
    )


def _build_m4(captured_rows: dict, b_rows: dict) -> tuple[dict, dict]:
    return _latency_surface(captured_rows, A_M4_SURFACE), _latency_surface(b_rows, B_M4_SURFACE)


def _build_m5(b_rows: dict) -> tuple[dict, dict]:
    """M-5 resource consumption: config A has no resource surface at all; config
    B's is read from the rows' own metadata — the report states what the data
    carries, never a claim the rows do not support."""
    a = _surface_record(surface=A_M5_SURFACE, available=False, not_available_reason=A_M5_REASON)
    recorded: dict = {}
    for row in _ok_rows(b_rows):
        metadata = row.get("metadata")
        if not isinstance(metadata, dict):
            continue
        for key, value in metadata.items():
            if str(key) != _RESOURCE_KEY:
                continue
            if _is_credential_key(key):
                continue  # a credential-named key is never a resource record
            if str(key) not in recorded:
                recorded[str(key)] = _redact_deep(value)
    if recorded:
        b = _surface_record(surface=B_M5_SURFACE, available=True, values=recorded)
    else:
        b = _surface_record(surface=B_M5_SURFACE, available=False, not_available_reason=B_M5_REASON)
    return a, b


# ---------------------------------------------------------------------------
# The uncontrolled-differences section (FR-27) — recorded evidence only
# ---------------------------------------------------------------------------


def _recorded_comparison(ref_value, b_value, note: str) -> dict:
    """A per-leg comparison that never claims equality from ABSENCE: an
    unrecorded side is 'not recorded', never 'identical' (the harness records
    no prompt digests and no model ids unless the run was given them).

    The comparison runs on the RAW maps — the recorded evidence decides
    whether the two legs recorded the same thing; only the EMITTED copies are
    redacted (the maps come from the run manifests, and a manifest's
    configuration block is not a sanitised surface)."""
    ref_recorded = bool(ref_value)
    b_recorded = bool(b_value)
    if ref_recorded and b_recorded:
        return {
            "A": _redact_deep(ref_value),
            "B": _redact_deep(b_value),
            "state": "compared",
            "identical": ref_value == b_value,
            "note": note,
        }
    return {
        "A": _redact_deep(ref_value),
        "B": _redact_deep(b_value),
        "state": "not_recorded",
        "identical": None,
        "note": note + " — at least one side recorded nothing, so no comparison is claimed",
    }


def _effective_filter_labels(row: dict) -> list | None:
    """The label filter a lane ACTUALLY applied — the A leg's response
    metadata (chatqna's effective filter labels) or the B row's metadata
    (the noagent lane's requested labels)."""
    if not isinstance(row, dict):
        return None
    labels = row.get("filter_labels")
    if labels is None:
        metadata = row.get("metadata")
        labels = metadata.get("filter_labels") if isinstance(metadata, dict) else None
    if isinstance(labels, list):
        return [str(label) for label in labels]
    return None


def _sent_label_set(sent_labels: dict) -> set[str]:
    """The labels the A leg SENT, as one set (the sent labels are recorded
    per dimension — category and service)."""
    values = []
    for key in ("category_labels", "service_labels"):
        items = sent_labels.get(key) if isinstance(sent_labels, dict) else None
        if isinstance(items, list):
            values.extend(str(item) for item in items)
    return set(values)


def _retrieval_scope_record(captured_rows: dict, b_rows: dict) -> dict:
    """The label scope EACH leg actually filtered on, and whether the two
    match.

    Both lanes record their EFFECTIVE filter labels — chatqna puts them in the
    response metadata (after its service-over-category collapse), the noagent
    lane in the row metadata. The comparison is therefore a fact, not a
    proxy; the request-side intent stays recorded beside it, because a
    REQUESTED label that never became an effective filter is itself a finding
    (FR-27).
    """
    sent: dict = {}
    a_effective: dict = {}
    b_effective: dict = {}
    differing: list = []
    never_queried: list = []
    without_scope: list = []
    b_without_scope: list = []
    for case_id, row in sorted(captured_rows.items()):
        if not isinstance(row, dict):
            without_scope.append(case_id)
            continue
        if row.get("status") == "skipped":
            # A skipped row issued NO request (the protocol declared the case
            # inapplicable to this leg) — the only case that never queried.
            never_queried.append(case_id)
            continue
        if row.get("status") not in ("ok", "http_error"):
            # The transport died — the row may never have sent the request, so
            # any scope it carries is not evidence of what was queried.
            without_scope.append(case_id)
            continue
        scope = row.get("retrieval_scope")
        if not isinstance(scope, dict):
            # The row issued a request but recorded no scope (a capture that
            # lost the field) — it is scope-less, never "never queried".
            without_scope.append(case_id)
            continue
        sent_labels = _redact_deep(scope.get("sent_labels") or {})
        requested = [str(label) for label in (scope.get("case_requested_labels") or [])]
        sent[case_id] = sent_labels
        effective = _effective_filter_labels(row)
        if effective is not None:
            a_effective[case_id] = _redact_deep(effective)
        # The REQUESTED labels against the filter that was actually applied:
        # a requested label the filter never carried is the finding (not
        # merely an empty request).
        applied = set(effective) if effective is not None else _sent_label_set(sent_labels)
        if any(label not in applied for label in requested):
            differing.append(case_id)
    for case_id, row in sorted(b_rows.items()):
        effective = _effective_filter_labels(row)
        if effective is not None:
            b_effective[case_id] = _redact_deep(effective)
        elif isinstance(row, dict) and row.get("status") in ("ok", "http_error"):
            b_without_scope.append(case_id)
    compared = sorted(set(a_effective) & set(b_effective))
    mismatched = [case_id for case_id in compared if sorted(a_effective[case_id]) != sorted(b_effective[case_id])]
    if mismatched:
        scope_matched: bool | None = False
    elif compared and len(compared) == len(a_effective) == len(b_effective):
        # Every scoped case was scoped on BOTH legs and the scopes agree.
        scope_matched = True
    else:
        # A partial comparison: the report says so instead of publishing a
        # verdict over the cases it never compared.
        scope_matched = None
    return {
        "A": {
            "effective_filter_labels_per_case": a_effective,
            "labels_sent_per_case": sent,
            "cases_whose_requested_labels_never_reached_the_A_query": differing,
            "cases_that_never_queried": never_queried,
            "cases_without_a_recorded_scope": without_scope,
        },
        "B": {
            "effective_filter_labels_per_case": b_effective,
            "labels_source": "the row metadata's filter_labels (the noagent lane's requested labels)",
            "cases_without_a_recorded_scope": b_without_scope,
        },
        "scope_matched": scope_matched,
        "n_compared_cases": len(compared),
        "n_scoped_cases": {"A": len(a_effective), "B": len(b_effective)},
        "cases_with_a_different_effective_scope": mismatched,
        "note": (
            "the comparison is the EFFECTIVE filter each lane applied (chatqna's response metadata"
            " against the noagent row metadata); null means the comparison was partial (a case"
            " scoped on one leg only) or absent — the report never claims a scope match it did not"
            " measure (FR-27)"
        ),
    }


def _uncontrolled_differences(
    reference_manifest: dict, gated_manifest: dict, seed, captured_rows: dict, b_rows: dict
) -> dict:
    ref_configuration = (reference_manifest.get("configuration") or {}).get("A") or {}
    b_configuration = (gated_manifest.get("configuration") or {}).get("B") or {}
    ref_prompts = dict(ref_configuration.get("prompt_digests") or {})
    b_prompts = dict(b_configuration.get("prompt_digests") or {})
    ref_ids = dict(ref_configuration.get("model_ids") or {})
    b_ids = dict(b_configuration.get("model_ids") or {})
    return {
        "prompt_digests": _recorded_comparison(
            ref_prompts,
            b_prompts,
            "prompt digests as recorded by each leg's run manifest — different digests are an"
            " uncontrolled (recorded) difference",
        ),
        "model_ids": _recorded_comparison(
            ref_ids,
            b_ids,
            "model service ids as resolved by each leg's run manifest",
        ),
        "execution_conditions": {
            "A": "sequential anchor pass — one whole-set run_eval.py anchor subprocess (resume via its .done sidecar)",
            "B": "batched B lanes — payload-bounded docker-exec sub-batches through the in-container config-B driver",
            "seed": {
                "value": seed,
                "source": "operator-declared via --seed" if seed is not None else "not recorded",
                "verified": False,
                "note": (
                    "the run manifests record no seed — the value is the operator's declaration,"
                    " not a fact cross-checked against the artifacts"
                ),
            },
            "manifest_created_utc": {
                "A": reference_manifest.get("created_utc"),
                "B": gated_manifest.get("created_utc"),
            },
        },
        "cache_state": {
            "recorded": False,
            "note": (
                "cache state is unrecorded by the harness (FR-27) — the two legs' cache conditions are uncontrolled"
            ),
        },
        "retrieval_scope": _retrieval_scope_record(captured_rows, b_rows),
        "retrieval_surface_asymmetry": {
            "intentional_difference": pairs_mod.PAIR_CONDITIONS[E01_PAIR]["intentional_difference"],
            "A_surface": "chunk-level (the anchor report's per-query candidate/selected keys)",
            "B_surface": "doc-level (the B row's source_documents)",
            "note": (
                "FR-27: the retrieval measurement surface is intentionally asymmetric — the comparison"
                " names the surface under M-1 and never treats the two sides as one comparable number"
            ),
        },
    }


# ---------------------------------------------------------------------------
# The per-case records + the report
# ---------------------------------------------------------------------------


def _redact_deep(value):
    """Drop every credential-named key at ANY depth.

    The manifest's redaction is top-level only — a nested credential (a row's
    ``metadata`` carrying an api key) would survive it, and the E01 report
    records whole rows. Depth-aware redaction here; the rule is the report's
    own (see :data:`MEASUREMENT_KEY_NAMES` for the measurement names it keeps).
    """
    if isinstance(value, dict):
        return {key: _redact_deep(item) for key, item in value.items() if not _is_credential_key(key)}
    if isinstance(value, list):
        return [_redact_deep(item) for item in value]
    return value


def _per_case(captured_rows: dict, b_rows: dict, defect_ids: set[str]) -> dict:
    """The judgment inputs per case — BOTH legs' rows verbatim (redacted of
    credential-named keys, at any depth), the reference-defect flag and the
    skipped marker. No verdicts."""
    per_case = {}
    for case_id in sorted(set(captured_rows) | set(b_rows)):
        a_row = captured_rows.get(case_id)
        b_row = b_rows.get(case_id)
        skipped = any(isinstance(row, dict) and row.get("status") == "skipped" for row in (a_row, b_row))
        per_case[case_id] = {
            "a": _redact_deep(a_row) if isinstance(a_row, dict) else None,
            "b": _redact_deep(b_row) if isinstance(b_row, dict) else None,
            "reference_defect": _is_defect_case(case_id, defect_ids),
            "skipped": skipped,
        }
    return per_case


def e01_report_digest(report: dict) -> str:
    """The report's digest, recomputed over the body minus the embedded
    ``digest`` key — the verifiable identity a rebuild must reproduce."""
    body = {key: value for key, value in report.items() if key != "digest"}
    return sha256_json(body)


def build_e01_report(
    *,
    reference_manifest: dict,
    gated_manifest: dict,
    anchor_report: dict,
    capture: dict,
    b_rows: dict,
    defects: dict | None = None,
    created_utc: str | None = None,
    seed: int | None = None,
) -> dict:
    """Build the E01 comparison report — a pure function of its inputs plus
    the pinned ``created_utc``.

    ``capture`` is the capture FILE's content — its ``cases`` mapping and the
    ``capture`` stamp that records the set digest and the corpus fingerprint
    it ran under. One input, so the rows and their provenance cannot be
    paired from two different captures.

    Raises :class:`E01Refusal` before any building on a missing leg artifact,
    a lineage mismatch between the legs (corpus, assessment set, the reference
    the gate selected, the capture's own stamp), a wrong-leg manifest (config
    C on the B leg), rows of another leg, or a lineage-mismatched ledger.
    ``defects`` is the LOADED ledger record (or None — recorded absent).
    ``seed`` is the operator-declared execution-condition value (``--seed``).
    """
    if not isinstance(capture, dict) or not isinstance(capture.get("cases"), dict):
        raise E01Refusal(
            "missing_artifact",
            "the A capture file carries no case rows (capture-a's config-a.captured.json) — refusing"
            " before the report is built",
        )
    captured_rows = capture["cases"]
    capture_stamp = capture.get("capture")

    # The refusals precede any report building.
    _verify_legs(
        reference_manifest=reference_manifest,
        gated_manifest=gated_manifest,
        anchor_report=anchor_report,
        captured_rows=captured_rows,
        b_rows=b_rows,
        capture_stamp=capture_stamp,
    )
    reference_digest = manifest_digest(reference_manifest)
    gated_digest = manifest_digest(gated_manifest)
    corpus_fingerprint, assessment_set_sha256 = _manifest_lineage(reference_manifest)

    defect_ids: set[str] = set()
    ledger_record = {
        "present": False,
        "sha256": None,
        "applied_case_ids": [],
        "note": FR26_ABSENT_NOTE,
    }
    if defects is not None:
        verify_defects_lineage(
            defects,
            corpus_fingerprint=corpus_fingerprint,
            assessment_set_sha256=assessment_set_sha256,
            reference_manifest_sha256=reference_digest,
        )
        defect_ids = _defect_case_ids(defects.get("defects"))
        ledger_record = {
            "present": True,
            "sha256": sha256_json(defects),
            "applied_case_ids": sorted(defect_ids),
            "note": FR26_APPLIED_NOTE,
        }

    m1_a, m1_b = _build_m1(anchor_report, b_rows)
    m2_a, m2_b = _build_m2(captured_rows, b_rows)
    m3_a, m3_b = _build_m3(captured_rows, b_rows)
    m4_a, m4_b = _build_m4(captured_rows, b_rows)
    m5_a, m5_b = _build_m5(b_rows)
    surfaces = {"M-1": (m1_a, m1_b), "M-2": (m2_a, m2_b), "M-3": (m3_a, m3_b), "M-4": (m4_a, m4_b), "M-5": (m5_a, m5_b)}
    dimensions = {
        key: {"dimension": dimension, "A": surfaces[key][0], "B": surfaces[key][1]}
        for key, dimension in M_DIMENSIONS.items()
    }
    per_case = _per_case(captured_rows, b_rows, defect_ids)
    body = {
        "artifact": E01_REPORT_ARTIFACT,
        "version": E01_REPORT_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "pair": E01_PAIR,
        "created_utc": created_utc or datetime.now(UTC).isoformat(timespec="seconds"),
        "honest_evidence": HONEST_EVIDENCE_STATEMENT,
        "inputs": {
            "reference_manifest_sha256": reference_digest,
            "gated_manifest_sha256": gated_digest,
            "anchor_report_sha256": sha256_json(anchor_report),
            "captured_rows_sha256": sha256_json(captured_rows),
            "b_rows_sha256": sha256_json(b_rows),
            "capture_stamp": {
                **_redact_deep(capture_stamp),
                "verified": {
                    "assessment_set_sha256": True,
                    "corpus_fingerprint": capture_stamp.get("corpus_fingerprint_source") == "computed",
                },
                "note": (
                    "the assessment-set digest is computed from the capture's own set file; the"
                    " corpus fingerprint is verified only when the capture MEASURED it (the"
                    " --compute-fingerprint path) — a pinned fingerprint is the operator's"
                    " declaration"
                ),
            },
            "reference_defects_sha256": ledger_record["sha256"],
            "corpus_fingerprint": corpus_fingerprint,
            "assessment_set_sha256": assessment_set_sha256,
        },
        "reference_defects": ledger_record,
        "dimensions": dimensions,
        "uncontrolled_differences": _uncontrolled_differences(
            reference_manifest, gated_manifest, seed, captured_rows, b_rows
        ),
        "per_case": per_case,
        "counts": {
            "n_cases": len(per_case),
            "a_recorded": sum(1 for record in per_case.values() if record["a"] is not None),
            "b_recorded": sum(1 for record in per_case.values() if record["b"] is not None),
            "a_missing": sum(1 for record in per_case.values() if record["a"] is None),
            "b_missing": sum(1 for record in per_case.values() if record["b"] is None),
            "reference_defect_cases": sum(1 for record in per_case.values() if record["reference_defect"]),
            "skipped_cases": sum(1 for record in per_case.values() if record["skipped"]),
        },
    }
    body["digest"] = e01_report_digest(body)
    return body
