"""Reranker Protocol + default no-op implementation.

Real rerankers (e.g. ``bge-reranker-v2-m3`` via TEI's rerank endpoint
or a standalone service) land in Step 5. The no-op here keeps the
retrieval pipeline composable — callers always have a reranker object
to talk to, even when reranking is disabled.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from translation_v2.interfaces import Chunk


@runtime_checkable
class Reranker(Protocol):
    async def rerank(
        self, query: str, candidates: list[tuple[Chunk, float]]
    ) -> list[tuple[Chunk, float]]: ...


class NoOpReranker:
    name: str = "noop"

    async def rerank(
        self, query: str, candidates: list[tuple[Chunk, float]]
    ) -> list[tuple[Chunk, float]]:
        return list(candidates)
