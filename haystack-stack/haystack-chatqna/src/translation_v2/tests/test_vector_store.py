"""Tests for InMemoryVectorStore."""
from __future__ import annotations

import pytest

from translation_v2.interfaces import Chunk
from translation_v2.rag.vector_store import InMemoryVectorStore, VectorStore


def _chunk(text: str, doc_id: str = "d", page: int = 0) -> Chunk:
    return Chunk(text=text, doc_id=doc_id, page=page, metadata={"start_char": 0})


class TestAdd:
    @pytest.mark.asyncio
    async def test_empty_add_is_noop(self):
        vs = InMemoryVectorStore()
        await vs.add([], [])
        assert len(vs) == 0

    @pytest.mark.asyncio
    async def test_add_stores(self):
        vs = InMemoryVectorStore()
        await vs.add([_chunk("a"), _chunk("b")], [[1.0, 0.0], [0.0, 1.0]])
        assert len(vs) == 2

    @pytest.mark.asyncio
    async def test_mismatched_length_raises(self):
        vs = InMemoryVectorStore()
        with pytest.raises(ValueError):
            await vs.add([_chunk("a")], [[1.0], [2.0]])

    @pytest.mark.asyncio
    async def test_dim_mismatch_on_second_add_raises(self):
        vs = InMemoryVectorStore()
        await vs.add([_chunk("a")], [[1.0, 0.0]])
        with pytest.raises(ValueError):
            await vs.add([_chunk("b")], [[1.0, 0.0, 0.0]])


class TestSearch:
    @pytest.mark.asyncio
    async def test_empty_store_returns_empty(self):
        vs = InMemoryVectorStore()
        assert await vs.search([1.0, 0.0]) == []

    @pytest.mark.asyncio
    async def test_orthogonal_vectors_rank_correctly(self):
        vs = InMemoryVectorStore()
        await vs.add(
            [_chunk("x-axis"), _chunk("y-axis"), _chunk("z-axis")],
            [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        )
        results = await vs.search([1.0, 0.0, 0.0], k=3)
        # Top match should be x-axis (exact match), then tied ys and zs
        assert results[0][0].text == "x-axis"
        assert results[0][1] == pytest.approx(1.0)

    @pytest.mark.asyncio
    async def test_k_limits_results(self):
        vs = InMemoryVectorStore()
        await vs.add(
            [_chunk(f"c{i}") for i in range(5)],
            [[float(i), 0.0] for i in range(1, 6)],
        )
        results = await vs.search([1.0, 0.0], k=3)
        assert len(results) == 3

    @pytest.mark.asyncio
    async def test_doc_id_filter(self):
        vs = InMemoryVectorStore()
        await vs.add(
            [_chunk("a", doc_id="X"), _chunk("b", doc_id="Y"), _chunk("c", doc_id="X")],
            [[1, 0, 0], [1, 0, 0], [1, 0, 0]],
        )
        results = await vs.search([1.0, 0.0, 0.0], k=10, doc_id="X")
        assert {ch.text for (ch, _s) in results} == {"a", "c"}

    @pytest.mark.asyncio
    async def test_similarity_magnitude_invariant(self):
        # Cosine similarity ignores magnitude
        vs = InMemoryVectorStore()
        await vs.add([_chunk("a")], [[1.0, 0.0]])
        r_short = await vs.search([1.0, 0.0], k=1)
        r_long = await vs.search([1000.0, 0.0], k=1)
        assert r_short[0][1] == pytest.approx(r_long[0][1])

    @pytest.mark.asyncio
    async def test_query_dim_mismatch_raises(self):
        vs = InMemoryVectorStore()
        await vs.add([_chunk("a")], [[1.0, 0.0]])
        with pytest.raises(ValueError):
            await vs.search([1.0, 0.0, 0.0])


class TestProtocolConformance:
    def test_in_memory_satisfies_protocol(self):
        assert isinstance(InMemoryVectorStore(), VectorStore)
