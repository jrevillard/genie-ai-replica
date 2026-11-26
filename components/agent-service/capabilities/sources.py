# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The corpus sources the document capability reads through.

Driven ports of the hexagonal design: the three reads the executor needs from
the corpus, declared as Protocols and satisfied structurally by the adapters
in ``capabilities.adapters``. The executor names these and no adapter, so the
contract and its enforcement point import no adapter.
"""

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class DocumentMetadataSource(Protocol):
    """Resolves a legacy file id to its metadata record, or ``None``.

    The record is the document repository's own: ``file_name`` (the
    document's name), ``labels`` (its labels), ``author`` and
    ``source_url`` (the crawled page's URL, for a document the crawler
    ingested). The port declares the shape it expects from its connector —
    the core reads the fields through this declaration, never by scraping
    the repository's surface (ADR agentic-009).
    """

    async def fetch_metadata(self, file_id: str, bearer: str | None) -> dict[str, Any] | None: ...


@runtime_checkable
class ConceptSource(Protocol):
    """Reads one concept card, or ``None`` when it does not resolve."""

    async def fetch_concept(self, repo_id: str, concept_id: str, bearer: str | None) -> dict[str, Any] | None: ...


@runtime_checkable
class ChunkReader(Protocol):
    """Reads one legacy file's chunks out of its graph's source collection."""

    async def read_chunks(self, graph_name: str, file_id: str, max_chunks: int) -> tuple[str, bool]: ...
