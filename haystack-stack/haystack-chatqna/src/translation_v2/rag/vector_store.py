"""Vector store Protocol + in-memory cosine implementation.

The in-memory store is for tests and the CLI. Production retrieval
flows through ArcadeDB / Arango adapters — legacy code for that
already lives at
``src/services/agent_tools/arcade_vector_retriever.py`` and is
separate from this Protocol. Wiring a matching v2 adapter is a Step
5/6 concern.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from translation_v2.interfaces import Chunk


@runtime_checkable
class VectorStore(Protocol):
    async def add(
        self, chunks: list[Chunk], embeddings: list[list[float]]
    ) -> None: ...

    async def search(
        self,
        query_embedding: list[float],
        k: int = 10,
        doc_id: str | None = None,
    ) -> list[tuple[Chunk, float]]: ...


class InMemoryVectorStore:
    """Dense cosine similarity over stored chunks.

    Not suitable for large corpora (every query is a full-matrix dot
    product). Good enough for unit tests and dev-time ad-hoc runs.
    """

    def __init__(self) -> None:
        self._chunks: list[Chunk] = []
        self._embeddings: np.ndarray = np.empty((0, 0), dtype=float)

    def __len__(self) -> int:
        return len(self._chunks)

    def all_chunks(self) -> list[Chunk]:
        """Snapshot of every stored chunk. Callers must not mutate."""
        return list(self._chunks)

    async def add(
        self, chunks: list[Chunk], embeddings: list[list[float]]
    ) -> None:
        if not chunks:
            return
        if len(chunks) != len(embeddings):
            raise ValueError(
                f"chunks/embeddings length mismatch: {len(chunks)} vs {len(embeddings)}"
            )
        new_emb = np.asarray(embeddings, dtype=float)
        if new_emb.ndim != 2:
            raise ValueError(f"embeddings must be 2D, got shape {new_emb.shape}")
        if self._embeddings.size == 0:
            self._embeddings = new_emb
        else:
            if self._embeddings.shape[1] != new_emb.shape[1]:
                raise ValueError(
                    f"embedding dimension mismatch: "
                    f"store={self._embeddings.shape[1]} new={new_emb.shape[1]}"
                )
            self._embeddings = np.vstack([self._embeddings, new_emb])
        self._chunks.extend(chunks)

    async def search(
        self,
        query_embedding: list[float],
        k: int = 10,
        doc_id: str | None = None,
    ) -> list[tuple[Chunk, float]]:
        if not self._chunks:
            return []
        q = np.asarray(query_embedding, dtype=float)
        if q.ndim != 1:
            raise ValueError(f"query_embedding must be 1D, got shape {q.shape}")
        if q.shape[0] != self._embeddings.shape[1]:
            raise ValueError(
                f"query dim {q.shape[0]} != store dim {self._embeddings.shape[1]}"
            )
        eps = 1e-12
        q_norm = q / (np.linalg.norm(q) + eps)
        store_norms = self._embeddings / (
            np.linalg.norm(self._embeddings, axis=1, keepdims=True) + eps
        )
        sims = store_norms @ q_norm
        order = np.argsort(-sims)
        out: list[tuple[Chunk, float]] = []
        for idx in order:
            ch = self._chunks[int(idx)]
            if doc_id is not None and ch.doc_id != doc_id:
                continue
            out.append((ch, float(sims[int(idx)])))
            if len(out) >= k:
                break
        return out
