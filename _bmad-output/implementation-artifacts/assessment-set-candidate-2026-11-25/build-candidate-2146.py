#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Build the CANDIDATE multi-hop/ambiguous assessment set (#2146 blocker 3).

DERIVATION, not authoring: the signed FINAL A reference set's 67 cases are
copied BYTE-IDENTICAL (the measurement instrument the signed thresholds
digest-pins is never rewritten), and the four new-class cases (2 multi_hop,
2 ambiguous) are appended with verbatim committed-fixture gold — the #2145
rule enforced by tests/rag-benchmarks/test_assessment_candidate_set.py.

The output's digest MOVES by addition only (the expected, documented
outcome); re-signing a digest that carries the new classes is the
operator's later step. The signed source file is only ever READ.

Usage: build-candidate-2146.py [output-path]
  (default output: assessment-set.json beside this script — the committed
  artifact; the provenance gate runs the script against a temp path and
  byte-compares it, so the committed file must stay this script's output)
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIGNED_SET = (
    HERE.parent
    / "e01-final-reference-2026-11-24"
    / "assessment-set.json"
)

CATALOGUE_DOC = "e01-sec-doc-catalogue-e01.md"
SERVICEREQUEST_DOC = "e01-sec-doc-servicerequest-e01.md"


def chunk(source_doc: str, preview: str) -> dict:
    """The Phase-1 gold shape: verbatim preview + source doc, no identity —
    the content hashes are venue-resolved by the Phase-2 match pass, exactly
    like the graded e01g-* cases."""
    return {"preview": preview, "source_doc": source_doc}


NEW_CASES = [
    {
        "id": "e01-mh-desk",
        "query": (
            "Where does an applicant follow up on a service request, and what"
            " does the catalogue say about the desk that handles new"
            " registrations?"
        ),
        "categoryLabels": [],
        "serviceLabels": [],
        "language": "en",
        "reference_answer": (
            "Follow-up happens at the citizen desk by quoting the request"
            " number; the catalogue places the citizen desk on the ground"
            " floor handling new registrations."
        ),
        "expected_chunks": [
            chunk(
                SERVICEREQUEST_DOC,
                "Applicants follow up on a service request by quoting the"
                " request number at the citizen desk; the desk reads the same"
                " status bulletin published here and cannot accelerate a"
                " review that is still in progress.",
            ),
            chunk(
                CATALOGUE_DOC,
                "The catalogue closes with the registration desks: the citizen"
                " desk on the ground floor handles new registrations, the"
                " business desk on the first floor handles commercial filings,"
                " and both publish their opening hours in the yearly service"
                " calendar.",
            ),
        ],
        "case_class": "multi_hop",
        "access_scenario": "public",
        "provenance": "assessment",
        "expectations": {"require_citation": True},
    },
    {
        "id": "e01-mh-permit",
        "query": (
            "Which office reviews service request SR-2026-0871, and which"
            " catalogue desk handles commercial filings?"
        ),
        "categoryLabels": [],
        "serviceLabels": [],
        "language": "en",
        "reference_answer": (
            "SR-2026-0871 is under review by the permits office; the business"
            " desk on the first floor handles commercial filings."
        ),
        "expected_chunks": [
            chunk(
                SERVICEREQUEST_DOC,
                "Service request SR-2026-0871 is under review by the permits"
                " office; its status changed from received to under review on"
                " 3 November 2026.",
            ),
            chunk(
                CATALOGUE_DOC,
                "The catalogue closes with the registration desks: the citizen"
                " desk on the ground floor handles new registrations, the"
                " business desk on the first floor handles commercial filings,"
                " and both publish their opening hours in the yearly service"
                " calendar.",
            ),
        ],
        "case_class": "multi_hop",
        "access_scenario": "public",
        "provenance": "assessment",
        "expectations": {"require_citation": True},
    },
    {
        "id": "e01-amb-permit-time",
        "query": "How long does a permit take to be decided?",
        "categoryLabels": [],
        "serviceLabels": [],
        "language": "en",
        "reference_answer": (
            "It depends on the permit type: dredging permits are decided"
            " within thirty days, building permits within sixty days."
        ),
        "expected_chunks": [
            chunk(
                CATALOGUE_DOC,
                "The catalogue lists the permits the municipality issues."
                " Dredging permits are decided within thirty days of a"
                " complete application, and the fee schedule for dredging"
                " permits was last revised in 2025.",
            ),
            chunk(
                CATALOGUE_DOC,
                "Building permits require the site plan annex and are decided"
                " within sixty days.",
            ),
        ],
        "case_class": "ambiguous",
        "access_scenario": "public",
        "provenance": "assessment",
    },
    {
        "id": "e01-amb-request-status",
        "query": "What is the status of the service request?",
        "categoryLabels": [],
        "serviceLabels": [],
        "language": "en",
        "reference_answer": (
            "The bulletin lists three: SR-2026-0871 is under review by the"
            " permits office, SR-2026-0852 was completed on 28 October 2026,"
            " and SR-2026-0903 waits for the applicant's site-access consent."
        ),
        "expected_chunks": [
            chunk(
                SERVICEREQUEST_DOC,
                "Service request SR-2026-0871 is under review by the permits"
                " office; its status changed from received to under review on"
                " 3 November 2026.",
            ),
            chunk(
                SERVICEREQUEST_DOC,
                "Service request SR-2026-0852 was completed on 28 October"
                " 2026 and the completion notice was mailed to the applicant.",
            ),
            chunk(
                SERVICEREQUEST_DOC,
                "Service request SR-2026-0903 waits for the applicant's"
                " site-access consent and cannot be scheduled before it"
                " arrives.",
            ),
        ],
        "case_class": "ambiguous",
        "access_scenario": "public",
        "provenance": "assessment",
    },
]


def main() -> None:
    signed = json.loads(SIGNED_SET.read_text(encoding="utf-8"))
    candidate = {
        "_doc": (
            "CANDIDATE assessment set for the multi-hop/ambiguous classes"
            " (issue #2146 blocker 3, 2026-11-25) — a PROPOSAL artifact, never"
            " signed. It extends the signed FINAL A reference set (67 cases,"
            " digest cb371f1a67d7d2e6d2ee22200bd45d546d8595745984f638b157568bf1461812)"
            " by ADDITION only: every signed case survives byte-identical (the"
            " measurement instrument the signed thresholds digest-pins), and"
            " the four new-class cases (e01-mh-desk, e01-mh-permit,"
            " e01-amb-permit-time, e01-amb-request-status) carry verbatim"
            " committed-fixture gold in the Phase-1 shape (preview +"
            " source_doc, no identity) — the content hashes are"
            " venue-resolved by the Phase-2 pass, exactly like the graded"
            " e01g-* cases. The new classes are REQUIRED here through"
            " _meta.minimums (the default floor carries them at 0 so every"
            " pre-extension set stays valid). The PRD §4.1 benefit is"
            " positioned on multi-hop and ambiguous queries; the E02 gains"
            " layer reports these classes per class once a signed set carries"
            " them. Re-signing this set's own digest is the operator's later"
            " step."
        ),
        "_meta": {
            "provenance": "assessment",
            "status": "candidate",
            "minimums": {"multi_hop": 2, "ambiguous": 2},
        },
        "entries": signed["entries"] + NEW_CASES,
        "match_run": signed["match_run"],
    }
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "assessment-set.json"
    out.write_text(json.dumps(candidate, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(candidate['entries'])} cases)")


if __name__ == "__main__":
    main()
