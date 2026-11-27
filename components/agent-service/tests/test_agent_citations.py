# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ``source_documents`` projection: one envelope, two consumers.

Mutation-sensitive pins: the legacy and OKF envelope variants carry exactly
the fields the frontend citation mapping reads (``translateSources`` —
document_id/name, url, score, source, concept_id, repo_id, bundle_version;
graph_name deliberately absent, the recorded delta) — asserted per variant,
so dropping or renaming a field reddens here before the frontend silently
loses it; EACH BRANCH asks ITS OWN platform for the source's name (the
document repository for a document, the OKF server for a concept) and a
source whose record did not resolve is not surfaced, on either branch (the
D1 rule); the no-agent lane re-imports the SAME function objects (the
extraction is a move, not a copy); a governed citation entry projects onto
the identical shape; the dedup keeps the first served source.
"""

import asyncio
from types import SimpleNamespace

from conftest import FakeConceptSource, FakeMetadataSource

import noagent.pipeline as noagent_pipeline
from agent.verification import RetrievalLedger, check_reference_validity
from capabilities.citations import (
    SourceRecords,
    provenance_identity,
    resolve_source_records,
    source_document_envelope,
    source_documents_from_citations,
)
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

# The OKF server's own card for one concept (the shape its port declares):
# the concept's TITLE — the name the citation card carries — its labels and
# its identity.
_CARD = {
    "repo_id": "r-1",
    "concept_id": "c-1",
    "title": "Hangar Access Notes",
    "labels": ["security"],
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
    [entry] = source_document_envelope([_legacy_hit()], records=SourceRecords(documents={"f-1": _METADATA}))
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
    assert source_document_envelope([_legacy_hit()], records=SourceRecords()) == []


def test_a_crawled_page_carries_its_own_url():
    """The deployed rule: a document the crawler ingested carries the page's
    URL; every other document carries none (the clients build the view URL
    from their own public base and the file id)."""
    crawled = {"file_name": "page.html", "author": "crawler", "source_url": "https://example.org/page"}
    [entry] = source_document_envelope([_legacy_hit()], records=SourceRecords(documents={"f-1": crawled}))
    assert entry["url"] == "https://example.org/page"


def test_the_concept_carries_the_name_its_own_platform_resolved():
    """The OKF concept's name is the card's TITLE, read from the OKF server.

    The id is not a name: a concept's id turned into a label is a value the
    core derived from a token (ADR agentic-009, F5 — closed on BOTH
    branches). The deployed path keeps the id-derived label
    (``genieai_chatqna.py:3724``); the agentic path asks the platform that
    holds the concept, and the divergence is recorded in ADR agentic-009.
    """
    [entry] = source_document_envelope([_okf_hit()], records=SourceRecords(concepts={("r-1", "c-1"): _CARD}))
    assert entry["document_name"] == "Hangar Access Notes"
    assert entry["source"] == "okf-concept"


def test_a_concept_whose_card_did_not_resolve_is_not_surfaced():
    """The D1 rule, symmetric: an unresolved NAME is as fatal as an
    unresolved identity.

    The OKF branch used to be exempt — the concept had no name to resolve,
    so the id stood in for one. It does have one: the card the OKF server
    serves. A concept the server does not serve (a restricted repository, an
    unpublished concept, the pillar down) is not a citation card, and
    contributes no score to the aggregate.
    """
    assert source_document_envelope([_okf_hit()], records=SourceRecords()) == []


def test_the_okf_variant_carries_the_frontend_fields_and_the_marker():
    [entry] = source_document_envelope([_okf_hit()], records=SourceRecords(concepts={("r-1", "c-1"): _CARD}))
    assert set(entry) == OKF_FIELDS
    assert entry["document_id"] == "c-1"
    assert entry["concept_id"] == "c-1"
    assert entry["repo_id"] == "r-1"
    assert entry["bundle_version"] == 3
    assert entry["source"] == "okf-concept"
    assert entry["url"] == ""  # a concept takes no doc-repo URL family
    assert "graph_name" not in entry


def test_optional_okf_fields_follow_the_contract_shape():
    # A version-less concept says so by OMITTING the optional key — the
    # contract's nullable fields never appear as invented values.
    [no_version] = source_document_envelope(
        [_okf_hit(bundle_version=None)],
        records=SourceRecords(concepts={("r-1", "c-1"): _CARD}),
    )
    assert "bundle_version" not in no_version
    assert no_version["source"] == "okf-concept"


def test_a_concept_without_a_repository_address_cannot_resolve():
    """No repository, no card: the address the OKF server serves a concept
    by is ``(repo_id, concept_id)``, and a concept that carries no
    repository has no address to ask for. The read is not even attempted,
    and the concept is not surfaced — the same D1 rule, one step earlier."""
    concepts = FakeConceptSource({("", "c-1"): _CARD})
    records = asyncio.run(
        resolve_source_records(
            [OkfConceptProvenance(concept_id="c-1", repo_id="", bundle_version=None)],
            document_source=FakeMetadataSource(unresolved=("f-1",)),
            concept_source=concepts,
            bearer=None,
        )
    )
    assert concepts.requested == []
    assert records.record_for(OkfConceptProvenance(concept_id="c-1", repo_id="", bundle_version=None)) is None


# ---------------------------------------------------------------------
# Each branch asks ITS OWN platform
# ---------------------------------------------------------------------


def test_each_branch_resolves_through_its_own_port():
    """A legacy document is resolved by the document repository, an OKF
    concept by the OKF server — and each read carries the caller's token,
    because the OKF server's fence decides on that token (the repository's
    fence and the publication gate live on the server's side; no
    authorization rule changes here)."""
    documents = FakeMetadataSource({"f-1": _METADATA})
    concepts = FakeConceptSource({("r-1", "c-1"): _CARD})

    records = asyncio.run(
        resolve_source_records(
            [
                LegacyFileProvenance(file_id="f-1"),
                OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3),
            ],
            document_source=documents,
            concept_source=concepts,
            bearer="the-caller-token",
        )
    )

    assert documents.requested == [("f-1", "the-caller-token")]
    assert concepts.requested == [("r-1", "c-1", "the-caller-token")]
    # Each record lands under ITS OWN address — the document repository is
    # never asked for a concept, and the OKF server never for a document.
    assert records.record_for(LegacyFileProvenance(file_id="f-1")) == _METADATA
    assert records.record_for(OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3)) == _CARD


def test_a_platform_that_answers_nothing_surfaces_nothing():
    """A source whose read failed is a source that did not resolve: the
    answer never fails on it, and the source is not surfaced."""
    records = asyncio.run(
        resolve_source_records(
            [
                LegacyFileProvenance(file_id="f-1"),
                OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3),
            ],
            document_source=FakeMetadataSource(unresolved=("f-1",)),
            concept_source=FakeConceptSource(),
            bearer=None,
        )
    )
    assert records.record_for(LegacyFileProvenance(file_id="f-1")) is None
    assert records.record_for(OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3)) is None


def test_the_projection_reads_a_provenance_in_either_shape():
    """The hits carry the contract's provenance object; the ledger carries
    the dict. The projection reads BOTH and picks the variant the same way
    in each: a dict provenance must not fall through to the legacy branch
    (where it would raise on a missing attribute) nor be deduped into one
    slot."""
    dict_hit = SimpleNamespace(
        provenance={"source": "okf-concept", "concept_id": "c-1", "repo_id": "r-1", "bundle_version": 3},
        score=0.8,
    )
    [entry] = source_document_envelope([dict_hit], records=SourceRecords(concepts={("r-1", "c-1"): _CARD}))
    assert entry["document_name"] == "Hangar Access Notes"
    assert entry["source"] == "okf-concept"
    assert entry["concept_id"] == "c-1"


def test_the_governed_lane_s_shapes_resolve_through_the_same_ports():
    """The governed path carries its provenances as DICTS (the ledger's
    shape); the no-agent lane carries the contract's objects. Both shapes
    must reach the SAME platform — the dict is not a second vocabulary, it
    is the same identity in another shape.

    A resolver that read the dict shape wrong would send a governed concept
    to the document repository (which 404s it by design) or read the wrong
    key, and every governed citation would silently disappear.
    """
    documents = FakeMetadataSource({"f-1": _METADATA})
    concepts = FakeConceptSource({("r-1", "c-1"): _CARD})

    records = asyncio.run(
        resolve_source_records(
            [
                {"file_id": "f-1"},
                {"source": "okf-concept", "concept_id": "c-1", "repo_id": "r-1", "bundle_version": 3},
            ],
            document_source=documents,
            concept_source=concepts,
            bearer="the-caller-token",
        )
    )

    assert documents.requested == [("f-1", "the-caller-token")]
    assert concepts.requested == [("r-1", "c-1", "the-caller-token")]
    assert records.record_for({"file_id": "f-1"}) == _METADATA
    assert (
        records.record_for({"source": "okf-concept", "concept_id": "c-1", "repo_id": "r-1", "bundle_version": 3})
        == _CARD
    )


def test_a_card_without_a_name_is_not_a_resolved_name():
    """The card that carries no title resolves the concept's IDENTITY, not
    its NAME — and an unresolved name is as fatal as an unresolved identity.
    """
    records = asyncio.run(
        resolve_source_records(
            [OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3)],
            document_source=FakeMetadataSource(unresolved=("f-1",)),
            concept_source=FakeConceptSource({("r-1", "c-1"): {"repo_id": "r-1", "concept_id": "c-1"}}),
            bearer=None,
        )
    )
    assert records.record_for(OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3)) is None


def test_a_document_without_a_name_is_not_a_resolved_name():
    """The legacy branch reads the rule SYMMETRICALLY: a metadata record
    that resolves the file's identity but carries no usable name did not
    resolve the NAME — and an unresolved name is as fatal as an unresolved
    identity. A citation card with an empty ``document_name`` must not
    exist.
    """
    records = asyncio.run(
        resolve_source_records(
            [LegacyFileProvenance(file_id="f-1")],
            document_source=FakeMetadataSource({"f-1": {"labels": [], "author": "user", "source_url": ""}}),
            concept_source=FakeConceptSource(),
            bearer=None,
        )
    )
    assert records.record_for(LegacyFileProvenance(file_id="f-1")) is None


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
    records = SourceRecords(documents={"f-1": _METADATA, "f-2": _METADATA}, concepts={("r-1", "c-1"): _CARD})
    envelope = source_documents_from_citations(delivered, records=records)
    # The dict path renders the SAME shapes the object path does for the
    # same sources — the frontend cannot tell which lane delivered it.
    assert (
        envelope[0] == source_document_envelope([_legacy_hit()], records=SourceRecords(documents={"f-1": _METADATA}))[0]
    )
    assert (
        envelope[1]
        == source_document_envelope([_okf_hit()], records=SourceRecords(concepts={("r-1", "c-1"): _CARD}))[0]
    )
    assert set(envelope[2]) == LEGACY_FIELDS
    assert envelope[2]["score"] is None  # an absent score is carried, never guessed


def test_every_projected_entry_carries_what_the_frontend_mapping_reads():
    # The projection pin: for EVERY variant, every field translateSources
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
        records=SourceRecords(documents={"f-1": _METADATA}, concepts={("r-1", "c-1"): _CARD}),
    )
    for entry in (legacy, concept):
        for field in ("document_id", "document_name", "url", "score"):
            assert field in entry
    assert "source" not in legacy
    assert concept["source"] == "okf-concept"
    assert concept["concept_id"] == "c-1"
    # The web variant's field coverage lives in the delivered-journey pin
    # below (test_a_web_citation_is_delivered_and_projects_the_web_variant):
    # its exact-dict equality subsumes the field set — a second, weaker
    # assertion here would be a duplicate invocation of the same contract.


# ---------------------------------------------------------------------
# The web identity: url-keyed, source-tagged — and projected (S3-plan-3)
# ---------------------------------------------------------------------


def test_the_web_provenances_identity_is_the_url_tagged_by_the_source():
    """A web entry without this branch would dedup to the legacy
    ``(None, None)`` — one web result would silently swallow every other.
    The identity is the URL, tagged by the source marker."""
    web = {"source": "web", "url": "https://example.invalid/a", "title": "Page A"}
    assert provenance_identity(web) == ("web", "https://example.invalid/a")
    other = {"source": "web", "url": "https://example.invalid/b", "title": "Page B"}
    assert provenance_identity(other) != provenance_identity(web)


def test_a_web_citation_is_delivered_and_projects_the_web_variant():
    """A web citation survives the mechanical validity check (it carries no
    ``repo_id``) and rides the delivered ``citations`` — the judge reads its
    text as evidence — AND the ``source_documents`` projection carries it:
    the boundary landed in S3-plan-3: the web entry projects with the url as
    its identity."""
    web_citation = {
        "provenance": {"source": "web", "url": "https://example.invalid/a", "title": "Page A"},
        "text": "the snippet",
        "score": 2.5,
    }
    validity = check_reference_validity([web_citation], authorized_repos=frozenset())
    assert validity.invalid == ()
    assert [entry["text"] for entry in validity.delivered] == ["the snippet"]

    envelope = source_documents_from_citations(validity.delivered, records=SourceRecords())
    assert envelope == [
        {
            "document_id": "https://example.invalid/a",
            "document_name": "Page A",
            "url": "https://example.invalid/a",
            "score": 2.5,
            "source": "web",
        }
    ]


def test_the_ledger_dedup_survives_the_projection_url_keyed_first_served():
    """The same url twice, two titles: the ledger's dedup — the
    ``(source, url)`` identity — keeps the FIRST served hit, so the
    delivered list already carries ONE citation and the projection yields
    ONE entry, url-keyed. The construction goes THROUGH the ledger: the
    ledger dedups on record, and hand-built citation lists would bypass
    that."""
    ledger = RetrievalLedger()
    ledger.record(
        "web_search",
        {
            "result": {
                "outcome": "success",
                "hits": (
                    {
                        "text": "the first served",
                        "provenance": {"source": "web", "url": "https://example.invalid/a", "title": "Page A"},
                        "score": 2.5,
                    },
                    {
                        "text": "the second served",
                        "provenance": {"source": "web", "url": "https://example.invalid/a", "title": "Page A again"},
                        "score": 1.5,
                    },
                ),
                "truncated": False,
            }
        },
    )
    validity = check_reference_validity(ledger.entries, authorized_repos=frozenset())
    assert len(validity.delivered) == 1
    assert validity.delivered[0]["text"] == "the first served"

    envelope = source_documents_from_citations(validity.delivered, records=SourceRecords())
    assert len(envelope) == 1
    assert envelope[0]["document_id"] == "https://example.invalid/a"
    assert envelope[0]["document_name"] == "Page A"


def test_a_web_score_that_is_not_a_readable_number_carries_none():
    """The ledger's one score rule applies to the web entry too: an
    unreadable score is ``None``, never guessed into a number — and a
    ``bool`` IS an ``int`` in Python, so ``True``/``False`` are unreadable
    here, not numbers. The PRODUCER applies the same rule (the ledger's
    triples never carry a bool score either)."""
    ledger = RetrievalLedger()
    ledger.record(
        "web_search",
        {
            "result": {
                "outcome": "success",
                "hits": (
                    {
                        "text": "bool score",
                        "provenance": {"source": "web", "url": "https://x/b", "title": "B"},
                        "score": True,
                    },
                    {
                        "text": "string score",
                        "provenance": {"source": "web", "url": "https://x/s", "title": "S"},
                        "score": "0.9",
                    },
                ),
                "truncated": False,
            }
        },
    )
    assert [entry["score"] for entry in ledger.entries] == [None, None]

    entries = source_documents_from_citations(
        [
            {
                "provenance": {"source": "web", "url": "https://example.invalid/a", "title": "Page A"},
                "text": "t",
                "score": True,
            },
            {
                "provenance": {"source": "web", "url": "https://example.invalid/b", "title": "Page B"},
                "text": "t",
                "score": "0.9",
            },
        ],
        records=SourceRecords(),
    )
    assert [entry["score"] for entry in entries] == [None, None]


def test_a_web_provenance_without_a_url_has_no_identity_and_projects_nothing():
    """The url IS the web identity (ADR agentic-009): a provenance without
    one has NO identity — ``None``, like a legacy source without a file id —
    so it neither dedups against anything (a constant key would let the
    first url-less hit swallow the rest) nor projects an empty row."""
    assert provenance_identity({"source": "web", "title": "no url"}) is None
    assert provenance_identity({"source": "web", "url": "https://x", "title": "t"}) == ("web", "https://x")
    # the legacy twin of the same decision, made in the SAME function
    assert provenance_identity({"file_id": "f-1"}) == (None, "f-1")
    assert provenance_identity({"title": "no id at all"}) is None

    envelope = source_document_envelope(
        [
            SimpleNamespace(
                provenance={"source": "web", "title": "no url"},
                text="t",
                score=1.0,
            ),
            SimpleNamespace(
                provenance={"source": "web", "url": "https://example.invalid/real", "title": "The real one"},
                text="t",
                score=2.0,
            ),
            SimpleNamespace(
                provenance={"source": "web", "title": "also no url"},
                text="t",
                score=3.0,
            ),
        ],
        records=SourceRecords(),
    )
    # the url-less rows are skipped outright — no empty-titled card, no
    # swallowed neighbour.
    assert [(e["document_id"], e["document_name"]) for e in envelope] == [
        ("https://example.invalid/real", "The real one")
    ]

    # the citations builder applies the same rule: a RAW citation list that
    # bypassed the ledger (this builder accepts one) projects nothing for an
    # identity-less provenance — no anonymous empty card.
    from_citations = source_documents_from_citations(
        [
            {"provenance": {"source": "web", "title": "no url"}, "text": "t", "score": 1.0},
            {
                "provenance": {"source": "web", "url": "https://example.invalid/real", "title": "The real one"},
                "text": "t",
                "score": 2.0,
            },
        ],
        records=SourceRecords(),
    )
    assert [(e["document_id"], e["document_name"]) for e in from_citations] == [
        ("https://example.invalid/real", "The real one")
    ]
