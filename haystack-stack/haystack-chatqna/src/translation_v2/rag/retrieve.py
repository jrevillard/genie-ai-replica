"""Hybrid retrieval — BM25 (sparse) + dense + RRF fusion + reranker.

The Reciprocal Rank Fusion formula (Cormack 2009):

    score(doc) = sum over rankings of 1 / (rrf_k + rank_in_that_list)

RRF is rank-based, not score-based — it does not require BM25 and
dense scores to be comparable (they are not), which is exactly why
it's the right fusion method here.

Build order:
    retriever = HybridRetriever(vector_store, embedder)
    retriever.index_corpus(chunks)       # builds BM25 once
    results = await retriever.retrieve(query, k=5)

The BM25 index is in-memory and lives on the retriever instance. When
a vector store adapter provides native BM25 (ArcadeDB does, via FTS),
this class will be replaced with a thin client — the Protocol contract
stays the same.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import numpy as np
from rank_bm25 import BM25Okapi

from translation_v2.interfaces import Chunk
from translation_v2.rag.reranker import NoOpReranker

logger = logging.getLogger(__name__)


# Tokenizer preserves Mandinka diacritics so "kuuraŋo" ≠ "kuurano"
_TOKEN_RE = re.compile(r"[a-zA-Z\u014b\u00f1\u025b\u0254\u0272']+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def _chunk_key(chunk: Chunk) -> tuple:
    meta_start = None
    if chunk.metadata:
        meta_start = chunk.metadata.get("start_char")
    return (chunk.doc_id, chunk.page, meta_start, chunk.text[:50])


class HybridRetriever:
    def __init__(
        self,
        vector_store: Any,
        embedder: Any,
        reranker: Any | None = None,
        rrf_k: int = 60,
    ) -> None:
        self._vs = vector_store
        self._embedder = embedder
        self._reranker = reranker or NoOpReranker()
        self._rrf_k = rrf_k
        self._bm25: BM25Okapi | None = None
        self._bm25_chunks: list[Chunk] = []

    def index_corpus(self, chunks: list[Chunk]) -> None:
        self._bm25_chunks = list(chunks)
        tokenized = [_tokenize(c.text) for c in self._bm25_chunks]
        self._bm25 = BM25Okapi(tokenized) if tokenized else None

    async def retrieve(
        self,
        query: str,
        k: int = 5,
        dense_k: int = 30,
        sparse_k: int = 30,
    ) -> list[tuple[Chunk, float]]:
        dense = await self._dense(query, dense_k)
        sparse = self._sparse(query, sparse_k)
        fused = self._rrf_fuse(dense, sparse)
        top = fused[:k]
        return await self._reranker.rerank(query, top)

    async def _dense(self, query: str, k: int) -> list[tuple[Chunk, float]]:
        vecs = await self._embedder.embed([query])
        if not vecs:
            return []
        return await self._vs.search(vecs[0], k=k)

    def _sparse(self, query: str, k: int) -> list[tuple[Chunk, float]]:
        if self._bm25 is None or not self._bm25_chunks:
            return []
        tokens = _tokenize(query)
        if not tokens:
            return []
        scores = self._bm25.get_scores(tokens)
        order = np.argsort(-scores)
        out: list[tuple[Chunk, float]] = []
        for idx in order[:k]:
            s = float(scores[idx])
            if s <= 0:
                break  # remaining candidates score 0 — not informative
            out.append((self._bm25_chunks[int(idx)], s))
        return out

    def _rrf_fuse(
        self,
        dense: list[tuple[Chunk, float]],
        sparse: list[tuple[Chunk, float]],
    ) -> list[tuple[Chunk, float]]:
        combined: dict[tuple, tuple[Chunk, float]] = {}

        def _add(ranked: list[tuple[Chunk, float]]) -> None:
            for rank, (chunk, _score) in enumerate(ranked, start=1):
                key = _chunk_key(chunk)
                contribution = 1.0 / (self._rrf_k + rank)
                if key in combined:
                    existing_chunk, existing_score = combined[key]
                    combined[key] = (existing_chunk, existing_score + contribution)
                else:
                    combined[key] = (chunk, contribution)

        _add(dense)
        _add(sparse)

        return sorted(combined.values(), key=lambda pair: -pair[1])
