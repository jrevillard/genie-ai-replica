# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ``source_documents`` projection — the citation envelope.

One module owns the shape the frontend citation components consume: the
deployed envelope the no-agent lane assembles today, extracted here so the
governed answer path projects its delivered citations into EXACTLY the same
variants — a legacy corpus source carries ``document_id`` (the ``file_id``)
and no source marker; an OKF concept carries the
``concept_id``/``repo_id``/``bundle_version`` trio and
``source: 'okf-concept'``. Without the marker the frontend takes the legacy
branch and builds a doc-repo URL for a concept that has none.

Two consumers, one builder per provenance variant:

* :func:`source_document_envelope` — the no-agent lane's entry, over
  capability hits (objects with ``provenance``/``score`` attributes). The
  no-agent lane re-imports this function; its output is byte-identical to
  the pre-extraction behavior (the existing suites stay green unmodified).
* :func:`source_documents_from_citations` — the governed path's entry, over
  the verification ledger's delivered citation entries
  (``{"provenance": dict, "text": str, "score": ...}``), already deduped first-served by
  the ledger.

A THIRD source rides the ledger AND this module's projection: a web result
enters the evidence ledger (the taint scan and the grounding judge read it)
and its identity is the ``(source, url)`` tuple above. Its citation variant
(``source: 'web'``, rendered on web and mobile) projects through
:func:`_web_entry` — the web provenance is SELF-CONTAINED (url and title
travel with it, nothing resolves; the provenance IS the metadata), so
``record_for`` and ``resolve_source_records`` still resolve NOTHING for a
web provenance (no platform holds a web source's record) and the projection
reads the provenance itself, in a branch placed BEFORE the D1 check.

THE NAME IS THE PLATFORM'S, NOT THE ID'S. Every source carries the name ITS
OWN platform resolved for it: a legacy document carries the name the document
repository resolved for it (resolved through the port, per answer, exactly as
the deployed path does), an OKF concept carries the title the OKF server served
on its card. The core never derives a value from an identifier (ADR
agentic-009, F5): the id-derived name is gone from BOTH branches — the
exception the deployed path keeps (`genieai_chatqna.py:3724` surfaces the id
as the label) is recorded as a divergence, not inherited.

THE D1 RULE. A source whose record does NOT resolve is NOT surfaced and
contributes NO score to the confidence aggregate ("no source surfaced, no
confidence poison") — the deployed rule, kept here: a deleted document, a
document repository that is down, a concept the repository's fence refuses,
must not become a citation card. The rule is SYMMETRIC: each branch asks its
own platform, and an unresolved name is as fatal as an unresolved identity.
:meth:`SourceRecords.record_for` is the one place the rule's TEST lives —
it returns the record a source's own platform resolved, and ``None`` when it
resolved none — and :func:`surfaced_hits` is the one place the rule's
FILTER lives: the aggregate consumes exactly the list that helper selected,
so the projection and the aggregate can never disagree about it.
"""

import asyncio
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .contract import OKF_CONCEPT_SOURCE, WEB_SEARCH_SOURCE, OkfConceptProvenance
from .sources import ConceptSource, DocumentMetadataSource

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SourceRecords:
    """What the platforms resolved for the sources of ONE answer.

    A legacy document's record comes from the document repository, keyed by
    the file id; an OKF concept's card comes from the OKF server, keyed by the
    ``(repo_id, concept_id)`` address the card is served at. Each branch
    asked its OWN platform — the core derives nothing from an id (ADR
    agentic-009, F5) — and a source whose record did NOT resolve is ABSENT
    from its map: the D1 rule's evidence.
    """

    documents: Mapping[str, dict] = field(default_factory=dict)
    concepts: Mapping[tuple[str, str], dict] = field(default_factory=dict)

    def record_for(self, provenance) -> dict | None:
        """The record this source's own platform resolved — ``None`` when it
        did not resolve (the D1 rule).

        ``provenance`` is the contract's provenance object (the no-agent
        lane's hits) or the ledger's provenance dict (the governed path's
        citations): the two lanes carry the same identity in two shapes, and
        this method reads both — so the projection and the aggregate apply
        ONE rule.
        """

        if is_concept_provenance(provenance):
            return self.concepts.get(_concept_address(provenance))
        file_id = _legacy_file_id(provenance)
        if file_id is None:
            return None
        return self.documents.get(file_id)


def is_concept_provenance(provenance) -> bool:
    """Is this provenance an OKF concept's?

    The marker is the port's own vocabulary (``source``/``repo_id``/
    ``concept_id``), the counterparty's data model — naming it in a PORT is
    the port's job: the core CONSUMES the port's shape, it does not invent
    one, and it never learns a platform's identifier FORM.

    Public because the discrimination is the PORT's rule and the ledger
    asks it too: a reader that decides the branch in two modules is a
    reader that can disagree with itself.
    """

    if isinstance(provenance, dict):
        return provenance.get("source") == OKF_CONCEPT_SOURCE
    return isinstance(provenance, OkfConceptProvenance)


def _is_web_provenance(provenance) -> bool:
    """Is this provenance a web result's?

    The marker is the port's own vocabulary (``source``/``url``), the
    counterparty's data model — naming it in a PORT is the port's job:
    the core CONSUMES the port's shape, it does not invent one.

    Named, and not spelled inline at the call site: the discrimination
    is a rule with a name and a reason, and a rule spelled twice is a
    rule that can disagree with itself.
    """

    return isinstance(provenance, dict) and provenance.get("source") == WEB_SEARCH_SOURCE


def _concept_address(provenance) -> tuple[str, str]:
    """The ``(repo_id, concept_id)`` address a concept's card is served at."""

    if isinstance(provenance, dict):
        return (str(provenance.get("repo_id") or ""), str(provenance.get("concept_id") or ""))
    return (str(provenance.repo_id or ""), str(provenance.concept_id or ""))


def _legacy_file_id(provenance) -> str | None:
    """The document repository's file id — the legacy source's address."""

    if isinstance(provenance, dict):
        return provenance.get("file_id")
    return getattr(provenance, "file_id", None)


def _concept_version(provenance) -> int | None:
    """The bundle version a concept's card was served at — ``None`` when the
    identity join did not resolve one (the contract's nullable field)."""

    if isinstance(provenance, dict):
        return provenance.get("bundle_version")
    return getattr(provenance, "bundle_version", None)


def surfaced_hits(hits, records: SourceRecords) -> tuple:
    """The hits whose source's own platform resolved a record — the D1
    rule's filter, in ONE place.

    The confidence aggregate and the citation projection must select the
    SAME sources: a filter spelled twice is two filters that can drift, and
    the drift is the confidence poison the rule exists to keep out. Both
    consumers call this.
    """

    return tuple(hit for hit in hits if records.record_for(hit.provenance) is not None)


async def resolve_source_records(
    provenances, *, document_source: DocumentMetadataSource, concept_source: ConceptSource, bearer: str | None
) -> SourceRecords:
    """Resolve every source's record through its OWN platform's port.

    A legacy document is resolved by the document repository; an OKF concept
    by the OKF server — the route that applies the repository's fence and the
    publication gate on the CALLER's own token, so a restricted or draft
    repository stays unreachable from the citation list. No authorization
    rule changes here: the server decides, on the token the caller carries.

    A record that did NOT resolve is ABSENT from the result — a deleted
    document, a repository that is down, a concept the fence refuses, a card
    without a name. The source is not surfaced and contributes no score.
    """

    file_ids: list[str] = []
    addresses: list[tuple[str, str]] = []
    for provenance in provenances:
        if is_concept_provenance(provenance):
            addresses.append(_concept_address(provenance))
            continue
        file_id = _legacy_file_id(provenance)
        if file_id:
            file_ids.append(file_id)
        # a web provenance resolves nothing — its projection reads the
        # provenance itself
    documents, concepts = await asyncio.gather(
        _resolve_documents(file_ids, document_source, bearer),
        _resolve_concepts(addresses, concept_source, bearer),
    )
    return SourceRecords(documents=documents, concepts=concepts)


async def _resolve_documents(file_ids, source: DocumentMetadataSource, bearer: str | None) -> dict[str, dict]:
    """Resolve the metadata of every legacy file id through the document
    repository.

    A resolution that FAILED (a deleted document, a repository that is down)
    is a resolution that did not happen: it never fails the answer, and the
    source it belonged to is not surfaced. The rule reads SYMMETRICALLY to
    the concepts' branch: a record that carries no usable name resolved the
    file's identity, not its NAME — and an unresolved name is as fatal as an
    unresolved identity, here as on the concept cards.
    """

    async def _one(file_id: str) -> dict | None:
        try:
            record = await source.fetch_metadata(file_id, bearer)
        except Exception as failure:  # noqa: BLE001 — a failed lookup is an unresolved source
            logger.warning("source metadata did not resolve: the source is not surfaced (%s)", type(failure).__name__)
            return None
        if not isinstance(record, dict) or not str(record.get("file_name") or "").strip():
            return None
        return record

    unique = list(dict.fromkeys(file_ids))
    records = await asyncio.gather(*(_one(file_id) for file_id in unique))
    return {file_id: record for file_id, record in zip(unique, records, strict=True) if record}


async def _resolve_concepts(addresses, source: ConceptSource, bearer: str | None) -> dict[tuple[str, str], dict]:
    """Resolve every concept's card through the OKF server.

    A card that did NOT resolve — 403 (the repository's fence), 404 (the
    concept is not published), a transport failure — is a card that does not
    exist: the concept is not surfaced. A card WITHOUT a name is the same
    case: an unresolved name is as fatal as an unresolved identity (the D1
    rule applies to the name too).
    """

    async def _one(address: tuple[str, str]) -> dict | None:
        repo_id, concept_id = address
        if not repo_id:
            # No repository address, no card to read: the concept cannot
            # resolve, and a concept that cannot resolve is not surfaced.
            return None
        try:
            card = await source.fetch_concept(repo_id, concept_id, bearer)
        except Exception as failure:  # noqa: BLE001 — a failed lookup is an unresolved source
            logger.warning("concept card did not resolve: the source is not surfaced (%s)", type(failure).__name__)
            return None
        if not isinstance(card, dict) or not str(card.get("title") or "").strip():
            return None
        return card

    unique = list(dict.fromkeys(addresses))
    cards = await asyncio.gather(*(_one(address) for address in unique))
    return {address: card for address, card in zip(unique, cards, strict=True) if card}


def provenance_identity(provenance) -> tuple:
    """The identity tuple of one provenance — the port's own convention.

    ``(repo_id, concept_id)`` for an OKF concept, ``(None, file_id)`` for a
    legacy file, ``(source, url)`` for a web result (url-keyed, tagged by
    the marker — without the branch every web entry would dedup to the
    legacy ``(None, None)`` and one result would swallow the rest). The
    reader is shape-agnostic: the contract's object and the ledger's dict
    carry the same identity in two shapes, and ONE reader reads both — so
    the dedup key of the no-agent lane and the dedup key of the governed
    ledger cannot drift apart.
    """

    if is_concept_provenance(provenance):
        return _concept_address(provenance)
    if _is_web_provenance(provenance):
        return (WEB_SEARCH_SOURCE, str(provenance.get("url") or ""))
    return (None, _legacy_file_id(provenance))


def hit_identity(hit) -> tuple[str, str] | None:
    """The dedup identity of one hit's source: ``(repo_id, concept_id)`` for
    an OKF concept, ``(None, file_id)`` for a legacy file. Deployed keys the
    duplicate-skip on the flat ``file_id`` alone (an OKF chunk's ``file_id``
    IS its ``concept_id``), so a legacy ``file_id`` colliding with an OKF
    ``concept_id`` — or one ``concept_id`` in two repositories — dedups in
    the deployed path but not here; the pair identity is the stricter,
    namespace-safe variant, and the collision is theoretical (E01's corpus
    is legacy-only)."""
    identity = provenance_identity(hit.provenance)
    if identity == (None, None):
        # A legacy source with no file id has NO identity — the dedup key
        # would be a constant, and every such source would collide with
        # every other.
        return None
    return identity


def _crawled_url(record: dict) -> str:
    """The document's own URL — the crawled page's, and only that.

    The deployed rule: a document the crawler ingested (the author is the
    crawler and the name ends with ``.html``) carries the page's URL; every
    other document carries none, because the clients build the view URL from
    their own public base and the file id.
    """

    if record.get("author") == "crawler" and str(record.get("file_name") or "").endswith(".html"):
        return str(record.get("source_url") or "")
    return ""


def _okf_entry(concept_id, repo_id, bundle_version, score, card: dict) -> dict:
    """One OKF-concept envelope entry: the concept's OWN name, read from the
    card its platform served (no URL — the concept has no document file to
    link)."""
    entry: dict[str, Any] = {
        "document_id": concept_id,
        "document_name": str(card.get("title") or "").strip(),
        "url": "",
        "categoryLabels": [],
        "serviceLabels": [],
        "score": score,
        "concept_id": concept_id,
        "source": OKF_CONCEPT_SOURCE,
    }
    if repo_id:
        entry["repo_id"] = repo_id
    if bundle_version is not None:
        entry["bundle_version"] = bundle_version
    return entry


def _web_entry(provenance, score=None) -> dict:
    """The projected row of a web result. The provenance is SELF-CONTAINED —
    url and title travel with it, nothing resolves — so the row reads the
    provenance directly: the url is both the click target and the stable
    identity (``provenance_identity``'s web branch returns ``(source, url)``),
    the title names the card, and the score follows the ledger's one rule
    (an unreadable score is ``None``, never guessed into a number). The raw
    engine score is carried UNCALIBRATED — the score calibrator normalises
    corpus-retrieval scores, and a web relevance score is a different scale."""
    url = str(provenance.get("url") or "")
    title = str(provenance.get("title") or "").strip() or url
    readable = isinstance(score, (int, float))
    return {
        "document_id": url,
        "document_name": title,
        "url": url,
        "score": score if readable else None,
        "source": WEB_SEARCH_SOURCE,
    }


def _legacy_entry(file_id, score, record: dict) -> dict:
    """One legacy-file envelope entry: the document's NAME and labels, as the
    document repository resolved them.

    The name is the document's, never the id's: an id turned into a display
    name is a value the core derived from a token (ADR agentic-009, F5).
    """

    labels = record.get("labels")
    return {
        "document_id": file_id,
        "document_name": str(record.get("file_name") or ""),
        "url": _crawled_url(record),
        "categoryLabels": labels if isinstance(labels, list) else ([labels] if labels else []),
        "serviceLabels": [],
        "score": score,
    }


def source_document_envelope(hits, score_calibrator=None, *, records: SourceRecords) -> list[dict]:
    """The ``source_documents`` entries of one result, in the deployed shape.

    The no-agent lane's entry point (re-imported there verbatim). Duplicates
    are skipped (deployed M3: the same source is surfaced once, the first
    occurrence wins), while every hit's score — duplicates included — still
    feeds the confidence aggregate, which this function does NOT compute
    (the caller scores the SURFACED hits). ``score_calibrator`` is the
    deployed confidence-time calibration (``RERANKER_SCORE_CALIBRATION``);
    ``None`` keeps the raw score (the default ``none`` calibration). It is
    applied at confidence time ONLY — never on the selection comparisons the
    capability already made.

    ``records`` carries what each source's OWN platform resolved. A hit whose
    record is ABSENT from it did not resolve: it is not surfaced — the D1
    rule, the same rule for both branches.
    """

    envelope: list[dict] = []
    seen: set[tuple[str, str] | None] = set()
    for hit in hits:
        provenance = hit.provenance
        identity = hit_identity(hit)
        if identity in seen:
            continue
        seen.add(identity)
        if _is_web_provenance(provenance):
            # The web variant projects from the SELF-CONTAINED provenance,
            # before the D1 check — no platform resolves a web record — and
            # before the calibrator: a web relevance score is a different
            # scale, carried raw (uncalibrated).
            envelope.append(_web_entry(provenance, hit.score))
            continue
        score = score_calibrator(hit.score) if score_calibrator is not None else hit.score
        record = records.record_for(provenance)
        if record is None:
            # The D1 rule: a source whose record did not resolve is not
            # surfaced (and contributes no score to the aggregate).
            continue
        if is_concept_provenance(provenance):
            # The shape-agnostic read: a provenance reaches this projection
            # in either shape (the contract's object, the ledger's dict),
            # and the variant is decided the same way in both.
            repo_id, concept_id = _concept_address(provenance)
            entry = _okf_entry(concept_id, repo_id, _concept_version(provenance), score, record)
        else:
            entry = _legacy_entry(_legacy_file_id(provenance), score, record)
        envelope.append(entry)
    return envelope


def source_documents_from_citations(citations, *, records: SourceRecords) -> list[dict]:
    """Project the governed path's delivered citations onto the same envelope.

    ``citations`` are the verification ledger's delivered entries —
    ``{"provenance": dict, "text": str, "score": float | None}`` — already
    deduped (first served wins) and validity-checked. The field assembly is
    the shared builder's, so a governed citation and a no-agent hit for the
    same source render identically to the frontend. A citation whose score
    the ledger could not read (a ``read_source`` entry carries none) is
    surfaced with ``None`` — the field the frontend mapping reads is
    present, and an absent score is never guessed into a number.

    ``records`` carries what each source's OWN platform resolved. A citation
    whose record is ABSENT from it did not resolve: it is not surfaced — the
    D1 rule.
    """

    envelope: list[dict] = []
    for citation in citations:
        provenance = citation["provenance"]
        score = citation.get("score")
        if _is_web_provenance(provenance):
            # The web variant projects from the SELF-CONTAINED provenance,
            # before the D1 check — no platform resolves a web record. This
            # builder has no dedup and no calibrator: the ledger dedups
            # first-served upstream, and a web score is carried raw.
            envelope.append(_web_entry(provenance, score))
            continue
        record = records.record_for(provenance)
        if record is None:
            continue
        if is_concept_provenance(provenance):
            envelope.append(
                _okf_entry(
                    provenance.get("concept_id"),
                    provenance.get("repo_id"),
                    provenance.get("bundle_version"),
                    score,
                    record,
                )
            )
            continue
        envelope.append(_legacy_entry(provenance.get("file_id"), score, record))
    return envelope
