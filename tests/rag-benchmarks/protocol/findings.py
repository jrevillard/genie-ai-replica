# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The findings report builder — no silent pass.

One report rides every run (reference or gated) in the run out-dir, beside
the rows and the manifest, and records:

* the **honest-evidence statement** in the header — passing is evidence
  for the tested conditions, never proof of impossibility;
* the **per-case verdicts** (:mod:`verdicts` output) — EVERY case appears,
  security or not, so a security case cannot vanish from the evidence;
* the **findings list** — every finding with its evidence (the offending
  source identity, the injection count, the divergent answers), machine
  readable;
* the **counts** — per-verdict and per-kind tallies;
* the **intentional differences** — for a config-A reference run over a
  security-bearing set, the security cases' skipped verdicts are recorded as
  the pair's intentional difference (A is the legacy fixed RAG: no executor
  to authorize with and no steerable agent — the security scenarios execute
  on the B/C legs).

The report is a versioned artifact like the manifest: it digests with the
same canonical-JSON sha256 the manifests use (:func:`report_digest`), so a
verdict set is comparable only under the same code + set + rows identities.
No new persistence: the report is a file in the run out-dir.
"""

from __future__ import annotations

from datetime import UTC, datetime

from . import verdicts as verdicts_mod
from .drivers import A_SECURITY_SKIP_REASON
from .manifest import sha256_json

FINDINGS_REPORT_VERSION = "1.0.0"

FINDINGS_REPORT_ARTIFACT = "findings-report"

HONEST_EVIDENCE_STATEMENT = (
    "FR-25 honest evidence: a passing verdict is evidence for the conditions this set"
    " tested, never proof of impossibility. Every steering attempt is a finding"
    " regardless of outcome, and every finding is recorded below — a silent pass does"
    " not exist. Findings are counter-evidence to be investigated, never averaged away."
)

# The intentional-difference record a config-A reference run over a
# security-bearing set carries (the pair manifest's vocabulary: the difference
# is recorded, never absorbed silently). The reason DERIVES from the drivers'
# skip-row reason — the rows and the difference record state the same skip
# from one source of the prose, never paraphrases that can drift.
A_SECURITY_SKIP_DIFFERENCE = {
    "pair": "E01",
    "difference": "security_scenarios_skipped_on_A",
    "reason": f"{A_SECURITY_SKIP_REASON} (the findings report records them as skipped verdicts)",
}


def report_digest(report: dict) -> str:
    """The digest a verdict set or comparison references — the same
    canonical-JSON sha256 the manifests use."""
    return sha256_json(report)


def _intentional_differences(config: str, verdict_records: list[dict]) -> list[dict]:
    if config != "A":
        return []
    skipped = sorted(
        record["case_id"]
        for record in verdict_records
        if record.get("security_scenario") and record["verdict"] == verdicts_mod.VERDICT_SKIPPED
    )
    if not skipped:
        return []
    return [{**A_SECURITY_SKIP_DIFFERENCE, "cases": skipped}]


def _corpus_presence_record(verdicts_result: dict) -> dict:
    """The corpus-presence precondition's state in the report (#2155): an
    UNCHECKED precondition is recorded absent with the arm named — the
    vacuous pass an unseeded restricted graph produces must stay visible as
    a possibility the report knows about, never a silence."""
    counts = (verdicts_result.get("counts") or {}).get("verdicts") or {}
    checked = bool(verdicts_result.get("corpus_presence_checked"))
    if checked:
        note = (
            "the corpus-presence precondition ran: an authorization case whose declared sources"
            " hold no chunks in the named graphs is corpus_absent, never a pass"
        )
    else:
        note = (
            "the corpus-presence precondition was not armed (--security-graphs unset): an"
            " unseeded restricted graph would pass the authorization classes vacuously — arm"
            " it on a venue the corpus campaign (#2148) has seeded"
        )
    return {"checked": checked, "n_corpus_absent": counts.get(verdicts_mod.VERDICT_CORPUS_ABSENT, 0), "note": note}


def build_findings_report(*, config: str, verdicts_result: dict, created_utc: str | None = None) -> dict:
    """Assemble the findings report from :func:`verdicts.build_verdicts` output.

    ``config`` is the run's configuration letter (A/B/C) — it decides the
    intentional-differences record. ``created_utc`` is injectable for tests;
    it defaults to now (UTC ISO, the manifest convention).
    """
    verdict_records = verdicts_result.get("verdicts") or []
    return {
        "artifact": FINDINGS_REPORT_ARTIFACT,
        "version": FINDINGS_REPORT_VERSION,
        "verdicts_version": verdicts_mod.VERDICTS_VERSION,
        "config": config,
        "created_utc": created_utc or datetime.now(UTC).isoformat(timespec="seconds"),
        "honest_evidence": HONEST_EVIDENCE_STATEMENT,
        "verdicts": verdict_records,
        "findings": verdicts_result.get("findings") or [],
        "counts": verdicts_result.get("counts") or {},
        "corpus_presence": _corpus_presence_record(verdicts_result),
        "intentional_differences": _intentional_differences(config, verdict_records),
    }
