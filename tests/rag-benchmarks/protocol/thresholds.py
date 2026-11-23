# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The threshold registry and the promotion decision (story 4.4).

The registry (``thresholds.yaml``, beside this module) is the SINGLE home of
the threshold decision (PRD OQ-5): one entry per measured dimension
(M-1..M-5), each either an agreed value or an EXPLICIT absence with its
reason. This module is the machinery that enforces PRD §8:

* **absence blocks promotion.** A dimension without an agreed value is never
  reported as satisfied, never substituted with a default, never counted as a
  pass. The promotion decision names it as a blocking reason.
* **a missing or unsigned sign-off blocks promotion exactly like an absent
  threshold.** The sign-off owner is recorded in the registry header and
  exposed in the report.
* **the gate-compatible thresholds artifact is DERIVED** from the registry
  (registry content + the reference lineage), never authored independently —
  two homes for one decision would drift, and the gate would verify a lineage
  while the numbers came from somewhere else.

The refusals are typed (:class:`ThresholdsRefusal`) and carry a machine
readable ``reason``: an unreadable registry, a malformed one, an incomplete
one (a measured dimension with no entry), an unknown dimension, a malformed
entry, a missing sign-off owner, a missing reference manifest, a blocked
promotion.

PyYAML is imported LAZILY (inside the loader): the protocol package stays
importable — and stdlib-only — on a venue node without it, and every other
command keeps working there.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from . import PROTOCOL_VERSION
from .e01 import M_DIMENSIONS
from .gate import thresholds_file
from .manifest import manifest_digest, sha256_json

THRESHOLD_REGISTRY_VERSION = "1.0.0"
THRESHOLD_REGISTRY_ARTIFACT = "evaluation-threshold-registry"
THRESHOLD_REPORT_VERSION = "1.0.0"
THRESHOLD_REPORT_ARTIFACT = "threshold-registry-report"

# The measured dimensions the registry carries an entry for — the epic's
# enumeration, reused from the E01 report so the two surfaces name the same
# dimensions. One entry per dimension: never a missing entry, never an
# implicit default.
MEASURED_DIMENSIONS = tuple(M_DIMENSIONS)

# The per-entry status vocabulary: an agreed value or an explicit absence.
STATUS_AGREED = "agreed"
STATUS_ABSENT = "absent"

# The blocking-reason codes the promotion decision reports.
BLOCK_DIMENSION_ABSENT = "dimension_absent"
BLOCK_SIGNOFF_UNSIGNED = "sign_off_unsigned"
BLOCK_SIGNOFF_MISSING = "sign_off_missing"

HONEST_EVIDENCE_STATEMENT = (
    "Threshold registry honest evidence: this record states which measured dimensions"
    " carry an agreed threshold and which carry an EXPLICIT absence. An absent dimension"
    " is never reported as satisfied and never defaulted to a value — it blocks"
    " promotion, because a default would silently manufacture a pass. The agreed values"
    " are bound to the measured reference they were agreed against (PRD §8)."
)


class ThresholdsRefusal(RuntimeError):
    """The threshold decision is refused; ``reason`` names the offense."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


# ---------------------------------------------------------------------------
# The loader — strict shape, lazy PyYAML
# ---------------------------------------------------------------------------


def _yaml_module():
    """The YAML parser, imported lazily: the package stays stdlib-only."""
    try:
        import yaml  # local import: no eager third-party import in the package
    except ImportError as missing:  # pragma: no cover — the CI job installs PyYAML
        raise ThresholdsRefusal(
            "registry_unavailable",
            f"PyYAML is not installed on this node ({missing}) — the threshold registry"
            " is a YAML file; install pyyaml to read it",
        ) from missing
    return yaml


def _is_text(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def load_registry(path: str | Path) -> dict:
    """Read, parse and validate one threshold registry file.

    Raises :class:`ThresholdsRefusal` naming the file on an unreadable or
    malformed registry, on an incomplete one (a measured dimension with no
    entry) and on a missing sign-off owner.
    """
    path = Path(path)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as failed:
        raise ThresholdsRefusal(
            "registry_unreadable",
            f"the threshold registry {path} could not be read: {failed}",
        ) from failed
    yaml = _yaml_module()
    try:
        registry = yaml.safe_load(raw)
    except yaml.YAMLError as failed:
        raise ThresholdsRefusal(
            "registry_malformed",
            f"the threshold registry {path} is not parsable YAML: {failed}",
        ) from failed
    validate_registry(registry, source=str(path))
    return registry


def validate_registry(registry, *, source: str = "the registry") -> dict:
    """Validate the registry's strict shape; return it, or refuse.

    The shape: the registry artifact, a version, a sign-off header carrying an
    owner, and exactly one entry per measured dimension — each entry naming the
    surface it applies to, the rationale, and EITHER an agreed value (with its
    agreement date) OR an explicit absence (with its reason and no value).
    """
    if not isinstance(registry, dict):
        raise ThresholdsRefusal(
            "registry_malformed",
            f"{source} is a {type(registry).__name__}, not a mapping — refusing before the"
            " thresholds are read",
        )
    if registry.get("artifact") != THRESHOLD_REGISTRY_ARTIFACT:
        raise ThresholdsRefusal(
            "registry_malformed",
            f"{source} declares artifact {registry.get('artifact')!r}, not"
            f" {THRESHOLD_REGISTRY_ARTIFACT!r} — refusing before the thresholds are read",
        )
    if not _is_text(registry.get("registry_version")):
        raise ThresholdsRefusal(
            "registry_malformed",
            f"{source} carries no registry_version — the registry is versioned, never anonymous",
        )
    sign_off = registry.get("sign_off")
    if not isinstance(sign_off, dict):
        raise ThresholdsRefusal(
            "sign_off_missing",
            f"{source} carries no sign-off header — the gate sign-off owner is recorded in the"
            " registry header; a registry without one blocks promotion",
        )
    if not _is_text(sign_off.get("owner")):
        raise ThresholdsRefusal(
            "sign_off_missing",
            f"{source} carries a sign-off header without an owner — the gate sign-off owner is"
            " recorded in the registry header; a missing owner blocks promotion",
        )
    dimensions = registry.get("dimensions")
    if not isinstance(dimensions, dict):
        raise ThresholdsRefusal(
            "registry_malformed",
            f"{source} carries no dimensions mapping — the registry holds one entry per"
            " measured dimension",
        )
    missing = [code for code in MEASURED_DIMENSIONS if code not in dimensions]
    if missing:
        raise ThresholdsRefusal(
            "registry_incomplete",
            f"{source} carries no entry for {', '.join(missing)} — the registry is incomplete:"
            " every measured dimension carries an entry (an agreed value or an explicit absence)",
        )
    unknown = sorted(str(code) for code in dimensions if str(code) not in MEASURED_DIMENSIONS)
    if unknown:
        raise ThresholdsRefusal(
            "registry_unknown_dimension",
            f"{source} carries entries for {', '.join(unknown)}, which are not measured"
            f" dimensions ({', '.join(MEASURED_DIMENSIONS)}) — refusing before the thresholds"
            " are read",
        )
    for code in MEASURED_DIMENSIONS:
        _validate_entry(dimensions[code], code=code, source=source)
    return registry


def _validate_entry(entry, *, code: str, source: str) -> None:
    """One dimension entry: the surface, the rationale and EITHER an agreed
    value (with its agreement date) OR an explicit absence (with its reason
    and no value)."""
    if not isinstance(entry, dict):
        raise ThresholdsRefusal(
            "registry_invalid_entry",
            f"{source} carries a {code} entry that is a {type(entry).__name__}, not a mapping",
        )
    status = entry.get("status")
    if status not in (STATUS_AGREED, STATUS_ABSENT):
        raise ThresholdsRefusal(
            "registry_invalid_entry",
            f"{source} carries a {code} entry with status {status!r} — the vocabulary is"
            f" {STATUS_AGREED!r} or {STATUS_ABSENT!r}",
        )
    if not _is_text(entry.get("surface")):
        raise ThresholdsRefusal(
            "registry_invalid_entry",
            f"{source} carries a {code} entry with no surface — a threshold names the surface"
            " it applies to",
        )
    if not _is_text(entry.get("rationale")):
        raise ThresholdsRefusal(
            "registry_invalid_entry",
            f"{source} carries a {code} entry with no rationale — a threshold records why it"
            " holds the number it holds",
        )
    if status == STATUS_AGREED:
        if entry.get("value") is None:
            raise ThresholdsRefusal(
                "registry_invalid_entry",
                f"{source} carries a {code} entry with status {STATUS_AGREED!r} and no value —"
                " an agreed dimension states the agreed value",
            )
        if not _is_text(entry.get("agreement_date")):
            raise ThresholdsRefusal(
                "registry_invalid_entry",
                f"{source} carries a {code} entry with status {STATUS_AGREED!r} and no"
                " agreement_date — an agreed dimension records when it was agreed",
            )
        if _is_text(entry.get("absent_reason")):
            raise ThresholdsRefusal(
                "registry_invalid_entry",
                f"{source} carries a {code} entry that is both agreed and absent — an entry is"
                " one or the other",
            )
    else:
        if not _is_text(entry.get("absent_reason")):
            raise ThresholdsRefusal(
                "registry_invalid_entry",
                f"{source} carries a {code} entry with status {STATUS_ABSENT!r} and no"
                " absent_reason — an absence is explicit and carries its reason",
            )
        if entry.get("value") is not None:
            raise ThresholdsRefusal(
                "registry_invalid_entry",
                f"{source} carries a {code} entry that is absent AND carries a value — the"
                " absent_reason is the record; the value is never invented",
            )


# ---------------------------------------------------------------------------
# The promotion decision — absence blocks, it never defaults
# ---------------------------------------------------------------------------


def _sign_off_record(registry: dict) -> dict:
    sign_off = registry.get("sign_off") or {}
    return {
        "owner": sign_off.get("owner"),
        "signed": bool(sign_off.get("signed")),
        "agreed_on": sign_off.get("agreed_on"),
        "signed_on": sign_off.get("signed_on"),
        "note": sign_off.get("note"),
    }


def _dimension_record(code: str, entry: dict) -> dict:
    """One dimension's report record — its status, its value or its absence
    (with the reason), the surface, the rationale and the agreement date."""
    return {
        "dimension": entry.get("dimension") or M_DIMENSIONS.get(code),
        "status": entry.get("status"),
        "value": entry.get("value"),
        "absent_reason": entry.get("absent_reason"),
        "surface": entry.get("surface"),
        "rationale": entry.get("rationale"),
        "agreement_date": entry.get("agreement_date"),
    }


def promotion_decision(registry: dict) -> dict:
    """The promotion decision over one registry.

    Promotion is ALLOWED only when every measured dimension carries an agreed
    value AND the sign-off is signed by a named owner. Every other state is a
    blocking reason, named one by one — an absent dimension is never reported
    as satisfied and no value is ever substituted for it.
    """
    dimensions = registry.get("dimensions") or {}
    sign_off = _sign_off_record(registry)
    blocking: list[dict] = []
    records: dict[str, dict] = {}
    for code in MEASURED_DIMENSIONS:
        entry = dimensions.get(code)
        if not isinstance(entry, dict):
            blocking.append(
                {
                    "code": BLOCK_DIMENSION_ABSENT,
                    "dimension": code,
                    "message": (
                        f"{code} ({M_DIMENSIONS.get(code)}) has no entry in the registry — an"
                        " absent dimension blocks promotion and is never reported as satisfied"
                    ),
                }
            )
            continue
        records[code] = _dimension_record(code, entry)
        if entry.get("status") != STATUS_AGREED or entry.get("value") is None:
            reason = entry.get("absent_reason") or "no agreed value is recorded"
            blocking.append(
                {
                    "code": BLOCK_DIMENSION_ABSENT,
                    "dimension": code,
                    "message": (
                        f"{code} ({M_DIMENSIONS.get(code)}) has no agreed threshold — {reason} —"
                        " an absent dimension blocks promotion and is never defaulted"
                    ),
                }
            )
    if not sign_off.get("owner"):
        blocking.append(
            {
                "code": BLOCK_SIGNOFF_MISSING,
                "dimension": None,
                "message": "the threshold sign-off names no owner — a missing sign-off blocks"
                " promotion exactly like an absent threshold",
            }
        )
    elif not sign_off.get("signed"):
        blocking.append(
            {
                "code": BLOCK_SIGNOFF_UNSIGNED,
                "dimension": None,
                "message": (
                    f"the threshold sign-off is unsigned (owner: {sign_off['owner']}) — an"
                    " unsigned sign-off blocks promotion exactly like an absent threshold"
                ),
            }
        )
    return {
        "promotion": "allowed" if not blocking else "blocked",
        "sign_off": sign_off,
        "dimensions": records,
        "blocking_reasons": blocking,
    }


# ---------------------------------------------------------------------------
# The derived gate-compatible thresholds artifact
# ---------------------------------------------------------------------------


def _manifest_lineage(reference_manifest: dict) -> tuple[str | None, str | None]:
    corpus = (reference_manifest.get("corpus") or {}).get("fingerprint")
    assessment = ((reference_manifest.get("sets") or {}).get("assessment") or {}).get("sha256")
    return corpus, assessment


def derive_thresholds_artifact(
    registry: dict,
    *,
    reference_manifest: dict,
    corpus_fingerprint: str | None = None,
    assessment_set_sha256: str | None = None,
) -> dict:
    """Derive the gate-compatible thresholds artifact FROM the registry.

    The artifact carries the registry's agreed values bound to the reference
    lineage — the gate verifies its presence, integrity and lineage, never its
    numbers. It is derived, never authored: a second home for the same
    decision would drift, and the gate would verify a lineage while the
    numbers came from somewhere else.

    Refuses when the promotion decision is blocked (an incomplete registry
    produces NO signed artifact) and when the reference manifest carries no
    lineage to bind the thresholds to.
    """
    decision = promotion_decision(registry)
    if decision["promotion"] != "allowed":
        reasons = "; ".join(reason["message"] for reason in decision["blocking_reasons"])
        raise ThresholdsRefusal(
            "promotion_blocked",
            f"no signed thresholds artifact is produced: {reasons}",
        )
    if not isinstance(reference_manifest, dict) or not reference_manifest:
        raise ThresholdsRefusal(
            "missing_reference",
            "the thresholds are bound to a measured reference — no reference manifest was"
            " supplied, so no signed artifact is produced",
        )
    manifest_corpus, manifest_set = _manifest_lineage(reference_manifest)
    corpus = corpus_fingerprint or manifest_corpus
    assessment = assessment_set_sha256 or manifest_set
    if not corpus or not assessment:
        absent = []
        if not corpus:
            absent.append("the corpus fingerprint")
        if not assessment:
            absent.append("the assessment set digest")
        raise ThresholdsRefusal(
            "missing_lineage",
            f"the reference manifest carries no {' and '.join(absent)} — the thresholds are"
            " bound to the measured reference, so no signed artifact is produced",
        )
    dimensions = registry.get("dimensions") or {}
    thresholds = {}
    for code in MEASURED_DIMENSIONS:
        entry = dimensions.get(code)
        entry = entry if isinstance(entry, dict) else {}
        thresholds[code] = {
            "value": entry.get("value"),
            "dimension": entry.get("dimension") or M_DIMENSIONS.get(code),
            "surface": entry.get("surface"),
            "rationale": entry.get("rationale"),
            "agreement_date": entry.get("agreement_date"),
        }
    artifact = thresholds_file(
        corpus_fingerprint=corpus,
        assessment_set_sha256=assessment,
        reference_manifest=reference_manifest,
        thresholds=thresholds,
        signed=True,
    )
    artifact["sign_off"] = {
        "owner": decision["sign_off"].get("owner"),
        "signed_on": decision["sign_off"].get("signed_on"),
    }
    artifact["registry_sha256"] = sha256_json(registry)
    return artifact


# ---------------------------------------------------------------------------
# The report — the registry's decision, exposed
# ---------------------------------------------------------------------------


def thresholds_report_digest(report: dict) -> str:
    """The report's digest, recomputed over the body minus the embedded
    ``digest`` key — the verifiable identity a rebuild must reproduce."""
    body = {key: value for key, value in report.items() if key != "digest"}
    return sha256_json(body)


def build_thresholds_report(
    registry: dict,
    *,
    created_utc: str | None = None,
    derived: dict | None = None,
    registry_path: str | None = None,
) -> dict:
    """Build the threshold report — the promotion decision, the sign-off owner
    and every dimension's agreed value or explicit absence.

    A pure function of the registry plus the pinned ``created_utc``: the same
    registry and pin digest identically.
    """
    decision = promotion_decision(registry)
    body = {
        "artifact": THRESHOLD_REPORT_ARTIFACT,
        "version": THRESHOLD_REPORT_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "created_utc": created_utc or datetime.now(UTC).isoformat(timespec="seconds"),
        "honest_evidence": HONEST_EVIDENCE_STATEMENT,
        "registry": {
            "artifact": registry.get("artifact"),
            "version": registry.get("registry_version"),
            "path": registry_path,
            "sha256": sha256_json(registry),
        },
        "sign_off": decision["sign_off"],
        "promotion": decision["promotion"],
        "blocking_reasons": decision["blocking_reasons"],
        "dimensions": decision["dimensions"],
        "derived_thresholds": derived,
        "derived_thresholds_sha256": sha256_json(derived) if derived is not None else None,
    }
    body["digest"] = thresholds_report_digest(body)
    return body


def registry_sha256(registry: dict) -> str:
    """The registry's content digest — the identity a decision is bound to."""
    return sha256_json(registry)


def reference_manifest_digest(reference_manifest: dict) -> str:
    """The digest a derived thresholds artifact references."""
    return manifest_digest(reference_manifest)
