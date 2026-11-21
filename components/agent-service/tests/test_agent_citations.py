# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ``source_documents`` projection (FR-13): one envelope, two consumers.

Mutation-sensitive pins: the legacy and OKF envelope variants carry exactly
the fields the frontend citation mapping reads (``translateSources`` —
document_id/name, url, score, source, concept_id, repo_id, bundle_version;
graph_name deliberately absent, the recorded delta) — asserted per variant,
so dropping or renaming a field reddens here before the frontend silently
loses it; the no-agent lane re-imports the SAME function objects (the
extraction is a move, not a copy); a governed citation entry projects onto
the identical shape; the dedup keeps the first served source.
"""

import noagent.pipeline as noagent_pipeline
from capabilities.citations import source_document_envelope, source_documents_from_citations
from capabilities.contract import LegacyFileProvenance, OkfConceptProvenance, SearchHit

# The fields the frontend store mapping reads per variant
# (components/gov-chat-frontend/src/store/modules/conversation.js,
# ``translateSources``) — the projection pin's consumer contract.
LEGACY_FIELDS = {"document_id", "document_name", "url", "categoryLabels", "serviceLabels", "score"}
OKF_FIELDS = LEGACY_FIELDS | {"concept_id", "source", "repo_id", "bundle_version"}


def _legacy_hit(file_id="f-1", score=0.9):
    return SearchHit(provenance=LegacyFileProvenance(file_id=file_id), text="the passage", score=score)


def _okf_hit(concept_id="c-1", repo_id="r-1", bundle_version=3, score=0.8):
    return SearchHit(
        provenance=OkfConceptProvenance(concept_id=concept_id, repo_id=repo_id, bundle_version=bundle_version),
        text="the concept passage",
        score=score,
    )


# ---------------------------------------------------------------------
# The envelope variants, pinned per field
# ---------------------------------------------------------------------


def test_the_legacy_variant_carries_the_frontend_fields_and_no_source_marker():
    [entry] = source_document_envelope([_legacy_hit()])
    assert set(entry) == LEGACY_FIELDS
    assert entry["document_id"] == "f-1"
    assert entry["document_name"] == "f-1"  # the id-derived name (no metadata round-trip)
    assert entry["url"] == ""
    assert entry["score"] == 0.9
    assert "source" not in entry  # the absence IS the legacy branch's signal
    assert "graph_name" not in entry  # the recorded delta: the contract provenance carries none


def test_the_okf_variant_carries_the_frontend_fields_and_the_marker():
    [entry] = source_document_envelope([_okf_hit()])
    assert set(entry) == OKF_FIELDS
    assert entry["document_id"] == "c-1"
    assert entry["concept_id"] == "c-1"
    assert entry["repo_id"] == "r-1"
    assert entry["bundle_version"] == 3
    assert entry["source"] == "okf-concept"
    assert entry["url"] == ""  # a concept takes no doc-repo URL family
    assert "graph_name" not in entry


def test_optional_okf_fields_follow_the_contract_shape():
    # A repo-less or version-less concept says so by OMITTING the optional
    # key — the contract's nullable fields never appear as invented values.
    [no_repo] = source_document_envelope(
        [
            SearchHit(
                provenance=OkfConceptProvenance(concept_id="c-1", repo_id="", bundle_version=None), text="t", score=0.1
            )
        ]
    )
    assert "repo_id" not in no_repo
    assert "bundle_version" not in no_repo
    assert no_repo["source"] == "okf-concept"


def test_the_dedup_keeps_the_first_served_source():
    envelope = source_document_envelope([_legacy_hit(), _legacy_hit(file_id="f-1", score=0.5), _okf_hit()])
    assert [entry["document_id"] for entry in envelope] == ["f-1", "c-1"]
    assert envelope[0]["score"] == 0.9  # first occurrence wins, its score rides


def test_the_score_calibrator_applies_at_confidence_time_only():
    envelope = source_document_envelope([_legacy_hit(score=2.0)], score_calibrator=lambda score: score / 10)
    assert envelope[0]["score"] == 0.2
    assert source_document_envelope([_legacy_hit(score=2.0)])[0]["score"] == 2.0


# ---------------------------------------------------------------------
# The extraction is a move: the no-agent lane re-imports the same objects
# ---------------------------------------------------------------------


def test_the_no_agent_lane_reimports_the_moved_projection():
    # The lane imports the projection (the name it serves) from the shared
    # module — a move, not a copy: one function object, one behavior home.
    assert noagent_pipeline.source_document_envelope is source_document_envelope


def test_the_object_path_output_is_byte_identical_to_the_pre_move_shape():
    envelope = source_document_envelope([_legacy_hit(), _okf_hit()])
    assert envelope == [
        {
            "document_id": "f-1",
            "document_name": "f-1",
            "url": "",
            "categoryLabels": [],
            "serviceLabels": [],
            "score": 0.9,
        },
        {
            "document_id": "c-1",
            "document_name": "c-1",
            "url": "",
            "categoryLabels": [],
            "serviceLabels": [],
            "score": 0.8,
            "concept_id": "c-1",
            "source": "okf-concept",
            "repo_id": "r-1",
            "bundle_version": 3,
        },
    ]


# ---------------------------------------------------------------------
# The governed path's projection: ledger entries → the same envelope
# ---------------------------------------------------------------------


def test_ledger_entries_project_onto_the_identical_variants():
    delivered = [
        {"provenance": {"file_id": "f-1"}, "text": "the grievance passage", "score": 0.9},
        {
            "provenance": {"source": "okf-concept", "concept_id": "c-1", "repo_id": "r-1", "bundle_version": 3},
            "text": "the concept passage",
            "score": 0.8,
        },
        {"provenance": {"file_id": "f-2"}, "text": "a read source", "score": None},  # a read carries no score
    ]
    envelope = source_documents_from_citations(delivered)
    # The dict path renders the SAME shapes the object path does for the
    # same sources — the frontend cannot tell which lane delivered it.
    assert envelope[0] == source_document_envelope([_legacy_hit()])[0]
    assert envelope[1] == source_document_envelope([_okf_hit()])[0]
    assert set(envelope[2]) == LEGACY_FIELDS
    assert envelope[2]["score"] is None  # an absent score is carried, never guessed


def test_every_projected_entry_carries_what_the_frontend_mapping_reads():
    # The projection pin: for BOTH variants, every field translateSources
    # reads is present (its absence would silently change the rendered
    # citation), and the concept marker exists only on the concept variant.
    legacy, concept = source_documents_from_citations(
        [
            {"provenance": {"file_id": "f-1"}, "text": "t", "score": 0.9},
            {
                "provenance": {"source": "okf-concept", "concept_id": "c-1", "repo_id": "r-1", "bundle_version": 3},
                "text": "t",
                "score": 0.8,
            },
        ]
    )
    for entry in (legacy, concept):
        for field in ("document_id", "document_name", "url", "score"):
            assert field in entry
    assert "source" not in legacy
    assert concept["source"] == "okf-concept"
    assert concept["concept_id"] == "c-1"
