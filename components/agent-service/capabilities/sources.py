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
    """Resolves a legacy file id to its metadata record, or ``None``."""

    async def fetch_metadata(self, file_id: str, bearer: str | None) -> dict[str, Any] | None: ...


@runtime_checkable
class ConceptSource(Protocol):
    """Reads one concept card, or ``None`` when it does not resolve."""

    async def fetch_concept(self, repo_id: str, concept_id: str, bearer: str | None) -> dict[str, Any] | None: ...


@runtime_checkable
class ChunkReader(Protocol):
    """Reads one legacy file's chunks out of its graph's source collection."""

    async def read_chunks(self, graph_name: str, file_id: str, max_chunks: int) -> tuple[str, bool]: ...
