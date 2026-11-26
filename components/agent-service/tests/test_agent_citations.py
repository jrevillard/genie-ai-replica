# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ``source_documents`` projection: one envelope, two consumers.

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


# The document repository's own record for one document (the shape the port
# declares): the document's name, its labels, its author and the URL of a
# crawled page.
_METADATA = {
    "file_name": "XR-7 Controller Reference.md",
    "labels": ["manual", "controller"],
    "author": "user",
    "source_url": "",
}


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
    """The card carries the DOCUMENT's name, resolved through the port.

    The name is the document's, never the id's: an id turned into a display
    name is a value the core derived from a token (ADR agentic-009, F5).
    """
    [entry] = source_document_envelope([_legacy_hit()], metadata={"f-1": _METADATA})
    assert set(entry) == LEGACY_FIELDS
    assert entry["document_id"] == "f-1"
    assert entry["document_name"] == "XR-7 Controller Reference.md"
    assert entry["url"] == ""
    assert entry["categoryLabels"] == ["manual", "controller"]
    assert entry["serviceLabels"] == []
    assert entry["score"] == 0.9
    assert "source" not in entry  # the absence IS the legacy branch's signal
    assert "graph_name" not in entry  # the recorded delta: the contract provenance carries none


def test_a_legacy_source_whose_metadata_did_not_resolve_is_not_surfaced():
    """The D1 rule: no source surfaced, no confidence poison.

    A deleted document (or a document repository that is down) must not
    become a citation card — and must not contribute its score to the
    aggregate.
    """
    assert source_document_envelope([_legacy_hit()], metadata={}) == []
    assert source_document_envelope([_legacy_hit()], metadata={"f-1": None}) == []


def test_a_crawled_page_carries_its_own_url():
    """The deployed rule: a document the crawler ingested carries the page's
    URL; every other document carries none (the clients build the view URL
    from their own public base and the file id)."""
    crawled = {"file_name": "page.html", "author": "crawler", "source_url": "https://example.org/page"}
    [entry] = source_document_envelope([_legacy_hit()], metadata={"f-1": crawled})
    assert entry["url"] == "https://example.org/page"


def test_the_okf_fallback_keeps_the_id_derived_name():
    """An OKF concept's id resolves in the OKF server, NOT in the document
    repository: the deployed path surfaces it from its own provenance, with
    the id-derived name."""
    [entry] = source_document_envelope([_okf_hit()], metadata={})
    assert entry["document_name"] == "c-1"
    assert entry["source"] == "okf-concept"


def test_the_okf_variant_carries_the_frontend_fields_and_the_marker():
    [entry] = source_document_envelope([_okf_hit()], metadata={})
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
        ],
        metadata={},
    )
    assert "repo_id" not in no_repo
    assert "bundle_version" not in no_repo
    assert no_repo["source"] == "okf-concept"


# ---------------------------------------------------------------------
# The extraction is a move: the no-agent lane re-imports the same objects
# ---------------------------------------------------------------------


def test_the_no_agent_lane_reimports_the_moved_projection():
    # The lane imports the projection (the name it serves) from the shared
    # module — a move, not a copy: one function object, one behavior home.
    assert noagent_pipeline.source_document_envelope is source_document_envelope


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
    envelope = source_documents_from_citations(delivered, metadata={"f-1": _METADATA, "f-2": _METADATA})
    # The dict path renders the SAME shapes the object path does for the
    # same sources — the frontend cannot tell which lane delivered it.
    assert envelope[0] == source_document_envelope([_legacy_hit()], metadata={"f-1": _METADATA})[0]
    assert envelope[1] == source_document_envelope([_okf_hit()], metadata={})[0]
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
        ],
        metadata={"f-1": _METADATA},
    )
    for entry in (legacy, concept):
        for field in ("document_id", "document_name", "url", "score"):
            assert field in entry
    assert "source" not in legacy
    assert concept["source"] == "okf-concept"
    assert concept["concept_id"] == "c-1"
