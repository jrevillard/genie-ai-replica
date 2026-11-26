# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ports the search capability reads the corpus through.

The retrieval side of the hexagonal design: the embedding, the reranking and
the per-leg retrieval driver, declared as Protocols and satisfied structurally
by the adapters in ``capabilities.adapters``. The capability names these and
no adapter, so the code that DECIDES never builds the connector that REACHES
the corpus (ADR agentic-009, F2): the host injects the connector the
capability drives, and the capability asks the factory for the retriever that
serves one corpus leg.

The shapes the ports exchange are declared HERE, not in the adapters: a port
owns the shape it exchanges, so the adapter that fills it and the capability
that reads it agree on one definition. A connector's own class is its
business; the shape that crosses the boundary is the port's.
"""

from dataclasses import dataclass, field
from typing import Protocol, TypedDict, runtime_checkable


class RerankerInputTooLongError(Exception):
    """The reranker refused the input as too long.

    The recorded outcome is an ABSTENTION (``reranker_input_too_long``), not
    a failure: the caller maps this type onto an insufficiency answer. The
    port owns the vocabulary of the failure it declares — the class the
    adapter raises and the class the capability catches are ONE class,
    declared by the port that stands between them.
    """


@dataclass(frozen=True)
class EmbeddedQuery:
    """The prefixed query, its embedding, and the raw text the BM25 leg needs."""

    raw_text: str
    prefixed_text: str
    embedding: list[float]


@dataclass(frozen=True)
class ScoredCandidate:
    """One candidate text with its reranker score, in selection order.

    ``position`` is the candidate's index in the text list the adapter was
    called with — the reranker reports indices into that list, and the
    selection keeps them so the caller can address its own candidate list
    positionally.
    """

    text: str
    score: float
    position: int


@dataclass(frozen=True)
class RerankOutcome:
    """The selection result, with the empty-selection outcome kept distinct.

    ``selection`` carries the selected candidates in score-descending order,
    each with its POSITION in the input text list
    (``ScoredCandidate.position``) so the caller maps selections back to
    enriched candidates even when several candidates share a text.
    ``selected_nothing`` distinguishes a reranker that selected nothing from
    a non-selection outcome (an input-too-long abstention raises
    ``RerankerInputTooLongError`` instead; transport and protocol failures
    raise, and the caller turns them into a transient failure).
    """

    selection: tuple[ScoredCandidate, ...]

    @property
    def selected_nothing(self) -> bool:
        return not self.selection


@dataclass
class RetrievedChunk:
    """One retrieval candidate as the corpus serves it.

    ``chunk_labels`` mirrors what the recorded channels carry: the BM25 leg
    returns the chunk's labels (the view indexes them); the dense leg's
    results carry NO labels (the recorded empty-metadata quirk), which is
    why a label filter drops every dense result — the post-filter sees
    ``None`` where a filter is active.
    """

    key: str
    text: str
    score: float
    chunk_labels: list | None = None
    file_ids: list = field(default_factory=list)
    repo_id: str | None = None
    bundle_version: int | None = None
    graph_name: str | None = None
    # The chunk's stored vector, carried only by the dense leg (the BM25 view
    # does not return it). Feeds the adaptive selection's validity check
    # exactly as the deployed propagation chain does.
    embedding: list | None = None


class RetrievedCandidate(TypedDict):
    """One fused candidate: the chunk, and the score the fusion gave it.

    The dict is the recorded shape of the fusion's output — the port keeps
    it because it IS the contract the capability reads.
    """

    doc: RetrievedChunk
    score: float


@runtime_checkable
class EmbeddingSource(Protocol):
    """Turns a prepared query into the vector the corpus is searched with."""

    async def embed(self, text: str) -> EmbeddedQuery: ...


@runtime_checkable
class RerankingSource(Protocol):
    """Ranks the retrieved passages against the query."""

    def calibrate(self, score: float) -> float: ...

    async def rerank(
        self,
        query: str,
        texts: list[str],
        chunk_embeddings: list | None = None,
        query_embedding: list | None = None,
    ) -> RerankOutcome: ...


@runtime_checkable
class LegRetriever(Protocol):
    """The retrieval driver that serves ONE corpus leg.

    The leg label is opaque to the capability: the retriever resolves it to
    the collection, the view and the identifiers its platform uses (ADR
    agentic-009, F3). The degradation flags are the recorded partial
    unavailability the capability reports as a degraded answer.
    """

    @property
    def bm25_degraded(self) -> bool: ...

    @property
    def cap1_degraded(self) -> bool: ...

    async def fused_candidates(
        self, embedding: list[float], raw_query: str, labels_to_filter: list
    ) -> list[RetrievedCandidate]: ...


@runtime_checkable
class LegRetrieverFactory(Protocol):
    """Hands the capability the retriever that serves one corpus leg.

    The factory is the HOST's: it is the side that knows which connector
    serves which leg, and the capability asks it per leg.
    """

    def for_leg(self, leg: str) -> LegRetriever: ...
