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
  (``{"provenance": dict, "score": ...}``), already deduped first-served by
  the ledger.

RECORDED DELTA (kept from the no-agent assembly, and now the shared
contract's): the deployed legacy branch resolves
``document_name``/``url``/``categoryLabels`` from doc-repo metadata per
answer, and when that resolution FAILS the D1 rule drops the hit entirely —
no envelope entry and NO score in the confidence aggregate ("no source
surfaced, no confidence poison"). The id-derived-name shape exists only in
the deployed OKF fallback (gated on an ``OKF_``-prefixed provenance graph).
Neither the no-agent pipeline nor the governed path makes a per-answer
metadata round-trip (the capability's contract result carries identity, not
file metadata), so EVERY legacy hit is surfaced in the id-derived shape.
Widening the delta — resolving doc-repo metadata here — is a deliberate
future extension, not silently taken. The OKF entries carry the deployed
OKF-fallback shape MINUS ``graph_name`` (the contract's provenance type does
not carry it; the deployed fallback always does, and the frontend mapping
reads it tolerantly).
"""

from typing import Any

from .contract import LegacyFileProvenance, OkfConceptProvenance


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


def _legacy_entry(file_id, score) -> dict:
    """One legacy-file envelope entry: ``document_id`` and no source marker —
    the absence is what sends the frontend down the legacy branch."""
    return {
        "document_id": file_id,
        "document_name": str(file_id).replace("_", " ").strip(),
        "url": "",
        "categoryLabels": [],
        "serviceLabels": [],
        "score": score,
    }


def source_document_envelope(hits, score_calibrator=None) -> list[dict]:
    """The ``source_documents`` entries of one result, in the deployed shape.

    The no-agent lane's entry point (re-imported there verbatim). Duplicates
    are skipped (deployed M3: the same source is surfaced once, the first
    occurrence wins), while every hit's score — duplicates included — still
    feeds the confidence aggregate, which this function does NOT compute
    (the caller scores the FULL hit list). ``score_calibrator`` is the
    deployed confidence-time calibration (``RERANKER_SCORE_CALIBRATION``);
    ``None`` keeps the raw score (the default ``none`` calibration). It is
    applied at confidence time ONLY — never on the selection comparisons the
    capability already made.
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
            entry = _legacy_entry(legacy.file_id, score)
        envelope.append(entry)
    return envelope


def source_documents_from_citations(citations) -> list[dict]:
    """Project the governed path's delivered citations onto the same envelope.

    ``citations`` are the verification ledger's delivered entries —
    ``{"provenance": dict, "text": str, "score": float | None}`` — already
    deduped (first served wins) and validity-checked. The field assembly is
    the shared builder's, so a governed citation and a no-agent hit for the
    same source render identically to the frontend. A citation whose score
    the ledger could not read (a ``read_source`` entry carries none) is
    surfaced with ``None`` — the field the frontend mapping reads is
    present, and an absent score is never guessed into a number.
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
        else:
            envelope.append(_legacy_entry(provenance.get("file_id"), score))
    return envelope
