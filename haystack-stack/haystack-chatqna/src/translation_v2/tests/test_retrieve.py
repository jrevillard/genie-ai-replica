"""Tests for hybrid retrieval: BM25, dense, RRF fusion, reranker."""
from __future__ import annotations

import pytest

from translation_v2.interfaces import Chunk
from translation_v2.rag.reranker import NoOpReranker, Reranker
from translation_v2.rag.retrieve import HybridRetriever, _tokenize
from translation_v2.rag.vector_store import InMemoryVectorStore


def _chunk(text: str, doc_id: str = "d", page: int = 0) -> Chunk:
    return Chunk(text=text, doc_id=doc_id, page=page, metadata={"start_char": 0})


class TestTokenize:
    def test_preserves_mandinka_diacritics(self):
        assert _tokenize("Ŋ be kuuraŋo") == ["ŋ", "be", "kuuraŋo"]

    def test_lowercases(self):
        assert _tokenize("Hello World") == ["hello", "world"]

    def test_empty_input(self):
        assert _tokenize("") == []

    def test_punctuation_split(self):
        assert _tokenize("one, two. three!") == ["one", "two", "three"]


class TestSparseOnly:
    @pytest.mark.asyncio
    async def test_bm25_ranks_by_token_overlap(self, fake_embedder):
        vs = InMemoryVectorStore()
        chunks = [
            _chunk("Hello doctor, how are you today."),
            _chunk("Blood pressure and sugar monitoring."),
            _chunk("This has nothing relevant at all."),
        ]
        embs = await fake_embedder.embed([c.text for c in chunks])
        await vs.add(chunks, embs)

        r = HybridRetriever(vector_store=vs, embedder=fake_embedder)
        r.index_corpus(chunks)
        sparse = r._sparse("blood pressure", k=5)
        assert sparse
        assert sparse[0][0].text == "Blood pressure and sugar monitoring."

    @pytest.mark.asyncio
    async def test_empty_index_returns_empty(self, fake_embedder):
        vs = InMemoryVectorStore()
        r = HybridRetriever(vector_store=vs, embedder=fake_embedder)
        r.index_corpus([])
        assert r._sparse("anything", k=5) == []

    @pytest.mark.asyncio
    async def test_unrelated_query_returns_nothing(self, fake_embedder):
        chunks = [_chunk("alpha beta gamma")]
        r = HybridRetriever(vector_store=InMemoryVectorStore(), embedder=fake_embedder)
        r.index_corpus(chunks)
        # Zero-token overlap → all BM25 scores are 0, retriever drops them
        assert r._sparse("xyzzy", k=5) == []


class TestDenseOnly:
    @pytest.mark.asyncio
    async def test_dense_uses_embedder_and_store(self):
        # Construct a store where one chunk matches the query vector exactly.
        vs = InMemoryVectorStore()
        await vs.add(
            [_chunk("target"), _chunk("other")],
            [[1.0, 0.0], [0.0, 1.0]],
        )

        class OneShotEmbedder:
            async def embed(self, texts):
                # Always return the x-axis vector (matches 'target')
                return [[1.0, 0.0] for _ in texts]

        r = HybridRetriever(vector_store=vs, embedder=OneShotEmbedder())
        results = await r._dense("any query", k=5)
        assert results[0][0].text == "target"


class TestRRFFusion:
    @pytest.mark.asyncio
    async def test_fusion_combines_ranks(self, fake_embedder):
        r = HybridRetriever(vector_store=InMemoryVectorStore(), embedder=fake_embedder, rrf_k=60)
        c1, c2, c3 = _chunk("c1"), _chunk("c2"), _chunk("c3")
        dense = [(c1, 0.9), (c2, 0.5)]         # c1=rank1, c2=rank2
        sparse = [(c2, 5.0), (c3, 3.0)]        # c2=rank1, c3=rank2
        fused = r._rrf_fuse(dense, sparse)
        # c2 appears in both lists → should have the highest fused score
        assert fused[0][0].text == "c2"

    @pytest.mark.asyncio
    async def test_fusion_preserves_unique_items(self, fake_embedder):
        r = HybridRetriever(vector_store=InMemoryVectorStore(), embedder=fake_embedder)
        c1, c2 = _chunk("only-dense"), _chunk("only-sparse")
        fused = r._rrf_fuse([(c1, 1.0)], [(c2, 1.0)])
        texts = {ch.text for (ch, _s) in fused}
        assert texts == {"only-dense", "only-sparse"}


class TestEndToEndRetrieve:
    @pytest.mark.asyncio
    async def test_retrieve_returns_top_k(self, fake_embedder):
        vs = InMemoryVectorStore()
        chunks = [
            _chunk(f"chunk {i} about topic {i}", doc_id="d", page=i)
            for i in range(10)
        ]
        embs = await fake_embedder.embed([c.text for c in chunks])
        await vs.add(chunks, embs)

        r = HybridRetriever(vector_store=vs, embedder=fake_embedder)
        r.index_corpus(chunks)
        results = await r.retrieve("topic 3", k=5)
        assert len(results) <= 5
        # Results are (chunk, score) tuples in descending fused score
        scores = [s for (_c, s) in results]
        assert scores == sorted(scores, reverse=True)

    @pytest.mark.asyncio
    async def test_retrieve_with_reranker(self, fake_embedder):
        class ReverseReranker:
            name = "reverse"

            async def rerank(self, query, candidates):
                return list(reversed(candidates))

        assert isinstance(ReverseReranker(), Reranker)

        vs = InMemoryVectorStore()
        chunks = [_chunk("a"), _chunk("b"), _chunk("c")]
        embs = await fake_embedder.embed([c.text for c in chunks])
        await vs.add(chunks, embs)

        r = HybridRetriever(
            vector_store=vs, embedder=fake_embedder, reranker=ReverseReranker()
        )
        r.index_corpus(chunks)
        results = await r.retrieve("a b c", k=3)
        assert len(results) == 3


class TestNoOpReranker:
    @pytest.mark.asyncio
    async def test_passthrough(self):
        r = NoOpReranker()
        payload = [(_chunk("x"), 0.5), (_chunk("y"), 0.3)]
        out = await r.rerank("q", payload)
        assert out == payload
