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
* ``protocol_code_sha256`` against the protocol package's own code identity
  (``current_protocol_code_sha``) — compared whenever the artifact records
  it (the protocol's capture stamps do) or the caller arms the check: the
  drivers, the set validator and the verdict layer are behaviour the
  artifact speaks for;
* ``runs.gold_sha256`` against the current gold dataset's digest;
* ``stack.name`` against the expected stack identity (when the caller names
  one).

Every mismatch is reported with the field, the artifact's value and the
current value; the artifact is refused. There is NO override flag — a
mismatched artifact is not current evidence, whatever the operator prefers;
re-capture is the remedy (the capture machinery exists for exactly that).
"""

from __future__ import annotations

import hashlib
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


def current_protocol_code_sha() -> str:
    """The protocol package's own code identity — sha256 over its ``.py``
    files (sorted, name then bytes, the same recipe the harness identity
    uses).

    The harness identity covers the ``eval/`` scripts only, so a change to
    the PROTOCOL's behaviour — the drivers, the set validator, the surface
    model, the verdict layer — was invisible to the reuse check: an old
    capture artifact stayed "suitable" after the code it speaks for had
    changed. This digest moves with the package, and the suitability check
    compares it like ``harness_sha``.
    """
    digest = hashlib.sha256()
    for path in sorted(Path(__file__).resolve().parent.glob("*.py")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def current_gold_sha256(gold_path: str | Path) -> str:
    """The live gold identity — :func:`capture_baseline.file_sha256`."""
    import capture_baseline  # local import: the sibling capture module

    return capture_baseline.file_sha256(Path(gold_path))


def check_capture_artifact(
    artifact: dict,
    *,
    harness_sha: str | None = None,
    protocol_code_sha256: str | None = None,
    gold_sha256: str | None = None,
    expected_stack: str | None = None,
) -> dict:
    """The suitability report over one capture artifact.

    ``harness_sha`` / ``gold_sha256`` default to the live identities (the
    callers that already hold the digests may pass them — tests do; the CLI
    computes them). ``protocol_code_sha256`` ARMS the protocol-identity
    comparison with an expected value; left as ``None``, the comparison runs
    only against artifacts that record the field themselves (live-expected).
    Returns::

        {
          "suitable": bool,
          "mismatches": [
            {"field": "harness_sha", "artifact_value": "...", "current_value": "..."},
            ...
          ],
        }

    ``suitable`` is true only with ZERO mismatches. A missing ``harness_sha``
    in the artifact is itself a mismatch (an artifact that does not record
    its harness identity cannot prove suitability). The protocol identity is
    compared whenever the artifact records it or the caller arms it — the
    node-side baseline artifacts cannot record it (the eval node rsyncs
    ``eval/`` only), so those stay refused only under an armed check.
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

    # The protocol-package identity: an artifact that RECORDS it is always
    # compared (live when the caller passes no expected value) — the drivers,
    # the set validator and the verdict layer are behaviour the artifact
    # speaks for, and the protocol's capture stamps record the digest since
    # it existed. An artifact that predates the field is only refused when
    # the caller ARMS the check by passing an expected value: the node-side
    # baseline artifacts cannot record it (the eval node rsyncs eval/ only),
    # so an unarmed check must not refuse them.
    artifact_protocol_sha = artifact.get("protocol_code_sha256")
    if artifact_protocol_sha is not None or protocol_code_sha256 is not None:
        if protocol_code_sha256 is None:
            protocol_code_sha256 = current_protocol_code_sha()
        if artifact_protocol_sha != protocol_code_sha256:
            mismatches.append(
                {
                    "field": "protocol_code_sha256",
                    "artifact_value": artifact_protocol_sha,
                    "current_value": protocol_code_sha256,
                    "note": (
                        "the artifact was captured under a different protocol-package identity"
                        if artifact_protocol_sha is not None
                        else "the artifact does not record the protocol-package identity"
                    ),
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
