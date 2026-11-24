# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Capture-artifact suitability checks (reuse is checked, never blind).

The existing capture machinery (``capture_baseline.py``) produces committed
baseline artifacts carrying ``harness_sha`` (sha256 over the pinned eval
scripts) and ``runs.gold_sha256``. Reusing such an artifact as if it were
current evidence — after an eval script changed, after the gold set changed,
on a different stack — is the blind reuse this module refuses.

Before any baseline/capture artifact is consumed, this module verifies:

* ``harness_sha`` against the CURRENT harness identity (computed live from
  the same pinned file set ``capture_baseline.harness_sha`` hashes);
* ``runs.gold_sha256`` against the current gold dataset's digest;
* ``stack.name`` against the expected stack identity (when the caller names
  one).

Every mismatch is reported with the field, the artifact's value and the
current value; the artifact is refused. There is NO override flag — a
mismatched artifact is not current evidence, whatever the operator prefers;
re-capture is the remedy (the capture machinery exists for exactly that).
"""

from __future__ import annotations

import sys
from pathlib import Path

# The reuse checks live beside the capture machinery they verify against.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def current_harness_sha() -> str:
    """The live harness identity — :func:`capture_baseline.harness_sha`.

    The lazy import keeps the protocol package importable without re-running
    capture_baseline's module-level work twice and documents the reuse: the
    identity is THE same function the artifact recorded, never a second
    implementation that could drift.
    """
    import capture_baseline  # local import: the sibling capture module

    return capture_baseline.harness_sha()


def current_gold_sha256(gold_path: str | Path) -> str:
    """The live gold identity — :func:`capture_baseline.file_sha256`."""
    import capture_baseline  # local import: the sibling capture module

    return capture_baseline.file_sha256(Path(gold_path))


def check_capture_artifact(
    artifact: dict,
    *,
    harness_sha: str | None = None,
    gold_sha256: str | None = None,
    expected_stack: str | None = None,
) -> dict:
    """The suitability report over one capture artifact.

    ``harness_sha`` / ``gold_sha256`` default to the live identities (the
    callers that already hold the digests may pass them — tests do; the CLI
    computes them). Returns::

        {
          "suitable": bool,
          "mismatches": [
            {"field": "harness_sha", "artifact_value": "...", "current_value": "..."},
            ...
          ],
        }

    ``suitable`` is true only with ZERO mismatches. A missing field in the
    artifact is itself a mismatch (an artifact that does not record its
    harness identity cannot prove suitability).
    """
    mismatches: list[dict] = []

    if harness_sha is None:
        harness_sha = current_harness_sha()
    artifact_harness_sha = artifact.get("harness_sha")
    if artifact_harness_sha != harness_sha:
        mismatches.append(
            {
                "field": "harness_sha",
                "artifact_value": artifact_harness_sha,
                "current_value": harness_sha,
                "note": "the artifact was captured under a different eval-harness identity",
            }
        )

    artifact_gold = (artifact.get("runs") or {}).get("gold_sha256")
    if gold_sha256 is None:
        gold_path = (artifact.get("runs") or {}).get("gold_dataset")
        if not gold_path:
            raise ValueError(
                "gold_sha256 not given and the artifact records no gold_dataset path to hash — pass --gold explicitly"
            )
        try:
            gold_sha256 = current_gold_sha256(gold_path)
        except OSError:
            # The recorded gold is missing/unreadable on THIS machine (e.g. the
            # artifact names a swarm-node path): a mismatch row naming the path
            # problem — never a crash, never a silent pass.
            mismatches.append(
                {
                    "field": "runs.gold_sha256",
                    "artifact_value": artifact_gold,
                    "current_value": None,
                    "note": f"the recorded gold dataset is missing or unreadable: {gold_path}",
                }
            )
    if gold_sha256 is not None and artifact_gold != gold_sha256:
        mismatches.append(
            {
                "field": "runs.gold_sha256",
                "artifact_value": artifact_gold,
                "current_value": gold_sha256,
                "note": "the gold dataset changed since the artifact was captured",
            }
        )

    if expected_stack is not None:
        artifact_stack = (artifact.get("stack") or {}).get("name")
        if artifact_stack != expected_stack:
            mismatches.append(
                {
                    "field": "stack.name",
                    "artifact_value": artifact_stack,
                    "current_value": expected_stack,
                    "note": "the artifact was captured on a different stack",
                }
            )

    return {"suitable": not mismatches, "mismatches": mismatches}


class ReuseRefusal(RuntimeError):
    """The capture artifact is refused for reuse; the message carries the
    suitability report."""

    def __init__(self, report: dict):
        self.report = report
        names = ", ".join(m["field"] for m in report.get("mismatches", []))
        super().__init__(
            f"reuse refused — the capture artifact is not current evidence "
            f"(mismatched: {names or 'no fields?'}); re-capture the baseline, there is no override"
        )
