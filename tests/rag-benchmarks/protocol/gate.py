# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The partial-order gate (A-only first, then thresholds, then B/C).

The measurement order is the protocol's load-bearing invariant:

1. A-only reference runs — ALWAYS allowed, never gated (this module is not
   even invoked for config A);
2. thresholds signed against the measured reference (the threshold
   registry signs; this module verifies only);
3. the first gated B/C assessment run.

A gated B/C run requires, for the SAME corpus fingerprint and assessment-set
digest:

* a reference manifest for that corpus + set (produced by an A-only run), and
* a signed thresholds file referencing that exact reference manifest.

The gate refuses BEFORE any query runs, naming the missing predecessor — a
warning would let a campaign drift into comparing candidates against nothing.
The refusal is typed (:class:`GateRefusal`) with a machine-readable ``reason``:

* ``missing_reference`` — no reference manifest matches the corpus + set;
* ``missing_thresholds`` — the reference exists but no thresholds file does;
* ``thresholds_not_signed`` — a thresholds file matches the lineage but was
  not signed;
* ``thresholds_lineage_mismatch`` — thresholds exist but reference a
  different manifest, corpus or set.

The gate verifies presence, integrity and lineage. It never reads the
thresholds' numbers and never invents defaults — the numbers are the
threshold registry's decision.
"""

from __future__ import annotations

import json
from pathlib import Path

from .manifest import manifest_digest

REFERENCE_MANIFEST_ARTIFACT = "run-manifest"
REFERENCE_KIND = "reference"
THRESHOLDS_ARTIFACT = "evaluation-thresholds"


class GateRefusal(RuntimeError):
    """The gated run is refused; ``reason`` names the missing predecessor."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


def load_json_file(path: Path):
    """Parse one JSON file; return None when unreadable or not a dict."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def is_reference_manifest(data: dict) -> bool:
    return data.get("artifact") == REFERENCE_MANIFEST_ARTIFACT and data.get("kind") == REFERENCE_KIND


def is_thresholds_file(data: dict) -> bool:
    return data.get("artifact") == THRESHOLDS_ARTIFACT


def thresholds_file(
    *,
    corpus_fingerprint: str,
    assessment_set_sha256: str,
    reference_manifest: dict,
    thresholds: dict,
    signed: bool = True,
) -> dict:
    """Assemble one thresholds record (the consumer contract the threshold
    registry signs).

    The harness never authors thresholds content — ``thresholds`` is passed in
    verbatim by the signing step. ``signed=False`` produces the unsigned
    shape the gate refuses.
    """
    return {
        "artifact": THRESHOLDS_ARTIFACT,
        "signed": bool(signed),
        "corpus_fingerprint": corpus_fingerprint,
        "assessment_set_sha256": assessment_set_sha256,
        "reference_manifest_sha256": manifest_digest(reference_manifest),
        "thresholds": thresholds,
    }


def check_gated_run(
    *,
    run_dir: str | Path,
    corpus_fingerprint: str,
    assessment_set_sha256: str,
    config: str,
) -> dict:
    """The partial-order gate for a gated B/C run.

    Scans ``run_dir`` for reference manifests and thresholds files; on
    success returns the lineage dict the gated manifest embeds
    (``{"reference_manifest_sha256", "thresholds_sha256"}``); otherwise raises
    :class:`GateRefusal` naming the missing predecessor.
    """
    run_dir = Path(run_dir)
    candidates: list[dict] = []
    thresholds_files: list[dict] = []
    # ONE scan of the out-dir: every JSON file read and parsed once, routed by
    # its artifact kind (the reference scan and the thresholds scan share it).
    for path in sorted(run_dir.glob("*.json")):
        data = load_json_file(path)
        if not data:
            continue
        if is_reference_manifest(data):
            corpus = data.get("corpus") or {}
            sets = data.get("sets") or {}
            assessment = sets.get("assessment") or {}
            if corpus.get("fingerprint") == corpus_fingerprint and assessment.get("sha256") == assessment_set_sha256:
                candidates.append(data)
        elif is_thresholds_file(data):
            thresholds_files.append(data)

    if not candidates:
        raise GateRefusal(
            "missing_reference",
            f"gated run refused (config {config}): no reference manifest for corpus fingerprint"
            f" {corpus_fingerprint} + assessment set digest {assessment_set_sha256}. Run the"
            " A-only reference measurement first (`run_protocol.py reference`).",
        )

    # Newest reference wins on a tie (more than one matching reference is not
    # an error — a re-measured reference supersedes the earlier one); the
    # thresholds must reference the one the gate selects.
    candidates.sort(key=lambda m: m.get("created_utc") or "", reverse=True)
    reference = candidates[0]
    reference_digest = manifest_digest(reference)

    matching_thresholds = []
    seen_unsigned = False
    seen_other_lineage = False
    for data in thresholds_files:
        if not data.get("signed"):
            seen_unsigned = True
            continue
        if (
            data.get("reference_manifest_sha256") == reference_digest
            and data.get("corpus_fingerprint") == corpus_fingerprint
            and data.get("assessment_set_sha256") == assessment_set_sha256
        ):
            matching_thresholds.append(data)
        else:
            seen_other_lineage = True

    if not matching_thresholds:
        if seen_unsigned or seen_other_lineage:
            reasons = []
            if seen_unsigned:
                reasons.append("an unsigned thresholds file")
            if seen_other_lineage:
                reasons.append("a thresholds file referencing a different reference/corpus/set")
            raise GateRefusal(
                "thresholds_lineage_mismatch" if seen_other_lineage else "thresholds_not_signed",
                f"gated run refused (config {config}): the reference for corpus {corpus_fingerprint}"
                f" exists, but thresholds lineage does not verify — {' and '.join(reasons)}."
                " Thresholds are signed by story 4.4 after the reference is measured; the harness"
                " verifies and refuses otherwise.",
            )
        raise GateRefusal(
            "missing_thresholds",
            f"gated run refused (config {config}): reference manifest {reference_digest[:12]} covers"
            f" corpus {corpus_fingerprint}, but no signed thresholds file references it. Thresholds"
            " are signed after the reference is measured (story 4.4); the harness refuses to gate"
            " on an unsigned predecessor.",
        )

    thresholds = matching_thresholds[0]
    return {
        "reference_manifest_sha256": reference_digest,
        "thresholds_sha256": manifest_digest(thresholds),
    }
