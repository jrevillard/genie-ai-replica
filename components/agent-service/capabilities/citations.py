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

THE NAME IS THE DOCUMENT'S, NOT THE ID'S. A legacy source carries the name
the document repository resolved for it — resolved through the port, per
answer, exactly as the deployed path does. The core never derives a value
from an identifier (ADR agentic-009, F5), so the id-derived name is gone from
the legacy branch: it survives only in the OKF fallback, where the id is all
the platform offers (an OKF concept's id resolves in the OKF server, not in
the document repository, so the document repository would 404 it BY DESIGN).

THE D1 RULE. A legacy source whose metadata does NOT resolve is NOT
surfaced and contributes NO score to the confidence aggregate ("no source
surfaced, no confidence poison") — the deployed rule, kept here: a deleted
document, or a document repository that is down, must not become a citation
card. :func:`source_is_surfaceed` is the ONE place that rule lives, so the
projection and the aggregate can never disagree about it.
"""

import asyncio
import logging
from typing import Any

from .contract import LegacyFileProvenance, OkfConceptProvenance
from .sources import DocumentMetadataSource

logger = logging.getLogger(__name__)


def source_is_surfaceed(provenance, metadata: dict[str, dict]) -> bool:
    """Can this source be surfaced?

    An OKF concept always can: its id resolves in the OKF server, not in the
    document repository, so the document repository would answer 404 BY
    DESIGN — the deployed path surfaces it from its own provenance, with the
    id-derived name.

    A legacy document only when its metadata RESOLVED: the D1 rule — no
    source surfaced, no confidence poison. A source that did not resolve
    contributes no score to the aggregate either.

    ``provenance`` is the contract's provenance object (the no-agent lane's
    hits) or the ledger's provenance dict (the governed path's citations):
    the two lanes carry the same identity in two shapes, and this function
    reads both — so the projection and the aggregate apply ONE rule.
    """

    if isinstance(provenance, dict):
        if provenance.get("source") == "okf-concept":
            return True
        file_id = provenance.get("file_id")
    elif isinstance(provenance, OkfConceptProvenance):
        return True
    else:
        file_id = getattr(provenance, "file_id", None)
    return metadata.get(file_id) is not None


async def resolve_source_metadata(file_ids, source: DocumentMetadataSource, bearer: str | None) -> dict[str, dict]:
    """Resolve the metadata of every legacy file id through the document
    repository.

    The result maps a file id to the record the repository resolved. An id
    that did NOT resolve is ABSENT from the map — the D1 rule's evidence: a
    source without a resolved record is not surfaced.

    A resolution that FAILED (a deleted document, a repository that is down)
    is a resolution that did not happen: it never fails the answer, and the
    source it belonged to is not surfaced.
    """

    async def _one(file_id: str) -> dict | None:
        try:
            return await source.fetch_metadata(file_id, bearer)
        except Exception as failure:  # noqa: BLE001 — a failed lookup is an unresolved source
            logger.warning("source metadata did not resolve: the source is not surfaced (%s)", type(failure).__name__)
            return None

    unique = list(dict.fromkeys(file_ids))
    records = await asyncio.gather(*(_one(file_id) for file_id in unique))
    return {file_id: record for file_id, record in zip(unique, records, strict=True) if record}


def hit_identity(hit) -> tuple[str, str] | None:
    """The dedup identity of one hit's source: ``(repo_id, concept_id)`` for
    an OKF concept, ``(None, file_id)`` for a legacy file. Deployed keys the
    duplicate-skip on the flat ``file_id`` alone (an OKF chunk's ``file_id``
    IS its ``concept_id``), so a legacy ``file_id`` colliding with an OKF
    ``concept_id`` — or one ``concept_id`` in two repositories — dedups in
    the deployed path but not here; the pair identity is the stricter,
    namespace-safe variant, and the collision is theoretical (E01's corpus
    is legacy-only)."""
    provenance = hit.provenance
    if isinstance(provenance, OkfConceptProvenance):
        return (provenance.repo_id, provenance.concept_id)
    if isinstance(provenance, LegacyFileProvenance):
        return (None, provenance.file_id)
    return None


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


def _okf_entry(concept_id, repo_id, bundle_version, score) -> dict:
    """One OKF-concept envelope entry: the deployed fallback shape (the
    id-derived name, no URL — the concept has no doc-repo file to link)."""
    entry: dict[str, Any] = {
        "document_id": concept_id,
        "document_name": str(concept_id).replace("_", " ").strip(),
        "url": "",
        "categoryLabels": [],
        "serviceLabels": [],
        "score": score,
        "concept_id": concept_id,
        "source": "okf-concept",
    }
    if repo_id:
        entry["repo_id"] = repo_id
    if bundle_version is not None:
        entry["bundle_version"] = bundle_version
    return entry


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


def source_document_envelope(hits, score_calibrator=None, *, metadata: dict[str, dict]) -> list[dict]:
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

    ``metadata`` maps a legacy file id to the record the document repository
    resolved for it (the port's own shape). A legacy hit whose id is ABSENT
    from the map did not resolve: it is not surfaced — the D1 rule.
    """

    envelope: list[dict] = []
    seen: set[tuple[str, str] | None] = set()
    for hit in hits:
        provenance = hit.provenance
        identity = hit_identity(hit)
        if identity in seen:
            continue
        seen.add(identity)
        score = score_calibrator(hit.score) if score_calibrator is not None else hit.score
        if isinstance(provenance, OkfConceptProvenance):
            entry = _okf_entry(provenance.concept_id, provenance.repo_id, provenance.bundle_version, score)
        else:
            legacy: LegacyFileProvenance = provenance
            if not source_is_surfaceed(provenance, metadata):
                # The D1 rule: a source whose metadata did not resolve is not
                # surfaced (and contributes no score to the aggregate).
                continue
            entry = _legacy_entry(legacy.file_id, score, metadata[legacy.file_id])
        envelope.append(entry)
    return envelope


def source_documents_from_citations(citations, *, metadata: dict[str, dict]) -> list[dict]:
    """Project the governed path's delivered citations onto the same envelope.

    ``citations`` are the verification ledger's delivered entries —
    ``{"provenance": dict, "text": str, "score": float | None}`` — already
    deduped (first served wins) and validity-checked. The field assembly is
    the shared builder's, so a governed citation and a no-agent hit for the
    same source render identically to the frontend. A citation whose score
    the ledger could not read (a ``read_source`` entry carries none) is
    surfaced with ``None`` — the field the frontend mapping reads is
    present, and an absent score is never guessed into a number.

    ``metadata`` maps a legacy file id to the record the document repository
    resolved for it. A citation whose legacy id is ABSENT from the map did
    not resolve: it is not surfaced — the D1 rule.
    """

    envelope: list[dict] = []
    for citation in citations:
        provenance = citation["provenance"]
        score = citation.get("score")
        if provenance.get("source") == "okf-concept":
            envelope.append(
                _okf_entry(
                    provenance.get("concept_id"), provenance.get("repo_id"), provenance.get("bundle_version"), score
                )
            )
            continue
        if not source_is_surfaceed(provenance, metadata):
            continue
        file_id = provenance.get("file_id")
        envelope.append(_legacy_entry(file_id, score, metadata[file_id]))
    return envelope
