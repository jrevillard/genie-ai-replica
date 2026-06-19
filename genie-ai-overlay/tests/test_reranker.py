# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

"""Tests for GenieTEIReranking — score validation, top-K constraints, and
strategy dispatch.

Covers slice, threshold, knee_threshold, and unknown-strategy fallback, plus
TEI service call payload, edge cases, output types, and environment variable
defaults.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from reranker.genieai_tei_reranker import GenieTEIReranking

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Real types for isinstance() checks — SearchedDoc/RerankingRequest/ChatCompletionRequest
# are MagicMock in the conftest, which causes TypeError with isinstance().
_RealSearchedDoc = type("SearchedDoc", (), {})
_RealRerankingRequest = type("RerankingRequest", (), {})
_RealChatCompletionRequest = type("ChatCompletionRequest", (), {})


class _RealRerankingResponseData:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class _RealRerankingResponse:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


@pytest.fixture(autouse=True)
def patch_reranker_types():
    """Patch isinstance-dependent types and return types in the reranker module."""
    import reranker.genieai_tei_reranker as mod

    original_sd = mod.SearchedDoc
    original_rr = mod.RerankingRequest
    original_ccr = mod.ChatCompletionRequest
    original_rrd = mod.RerankingResponseData
    original_rrs = mod.RerankingResponse
    mod.SearchedDoc = _RealSearchedDoc
    mod.RerankingRequest = _RealRerankingRequest
    mod.ChatCompletionRequest = _RealChatCompletionRequest
    mod.RerankingResponseData = _RealRerankingResponseData
    mod.RerankingResponse = _RealRerankingResponse
    yield
    mod.SearchedDoc = original_sd
    mod.RerankingRequest = original_rr
    mod.ChatCompletionRequest = original_ccr
    mod.RerankingResponseData = original_rrd
    mod.RerankingResponse = original_rrs


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def create_reranker(base_url="http://localhost:80"):
    """Create a GenieTEIReranking instance bypassing __init__."""
    reranker = GenieTEIReranking.__new__(GenieTEIReranking)
    reranker.base_url = base_url
    return reranker


def create_mock_searched_doc(
    texts=None,
    initial_query="test query",
    reranking_strategy=None,
    reranking_threshold=None,
    top_n=None,
):
    """Create a mock input object matching invoke() expectations."""
    doc = MagicMock()
    doc.__class__ = _RealSearchedDoc
    doc.initial_query = initial_query
    doc.input = initial_query
    doc.retrieved_docs = []
    if texts is None:
        texts = ["doc1 text", "doc2 text", "doc3 text"]
    for text in texts:
        mock_doc = MagicMock()
        mock_doc.text = text
        doc.retrieved_docs.append(mock_doc)

    dump = {}
    if reranking_strategy is not None:
        dump["reranking_strategy"] = reranking_strategy
    if reranking_threshold is not None:
        dump["reranking_threshold"] = reranking_threshold
    if top_n is not None:
        dump["top_n"] = top_n
    doc.model_dump = MagicMock(return_value=dump)
    doc.top_n = top_n
    return doc


def create_tei_rerank_response(scores=None):
    """Return a list of dicts simulating TEI /rerank response.

    TEI returns results sorted by score (descending), with original indices.
    """
    if scores is None:
        scores = [0.95, 0.82, 0.61]
    return [{"index": i, "score": s} for i, s in enumerate(scores)]


def create_mock_aiohttp_session(response_data):
    """Create mock aiohttp session returning specific TEI rerank responses."""
    mock_resp = AsyncMock()
    mock_resp.json = AsyncMock(return_value=response_data)
    mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_resp.__aexit__ = AsyncMock(return_value=False)

    mock_session = MagicMock()
    mock_session.post = MagicMock(return_value=mock_resp)
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    return mock_session


# ---------------------------------------------------------------------------
# Test: Slice strategy — top-K enforcement (AC #2, #5)
# ---------------------------------------------------------------------------


class TestSliceStrategy:
    """Tests for the 'slice' reranking strategy."""

    @pytest.mark.asyncio
    async def test_slice_top_n_1_returns_single_result(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="slice",
            top_n=1,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 1
        assert result.reranked_docs[0].score == 0.95

    @pytest.mark.asyncio
    async def test_slice_top_n_3_returns_three_of_five(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.88, 0.82, 0.61, 0.45])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c", "d", "e"],
            reranking_strategy="slice",
            top_n=3,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 3

    @pytest.mark.asyncio
    async def test_slice_top_n_greater_than_docs_returns_all(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82])
        input_doc = create_mock_searched_doc(
            texts=["a", "b"],
            reranking_strategy="slice",
            top_n=10,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 2

    @pytest.mark.asyncio
    async def test_slice_uses_env_default_when_top_n_not_in_input(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82])
        input_doc = create_mock_searched_doc(
            texts=["a", "b"],
            reranking_strategy="slice",
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with (
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
            patch("reranker.genieai_tei_reranker.RERANKER_TOP_N", 2),
        ):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 2

    @pytest.mark.asyncio
    async def test_slice_preserves_original_text_and_tei_score(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82])
        input_doc = create_mock_searched_doc(
            texts=["first doc", "second doc"],
            reranking_strategy="slice",
            top_n=2,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        texts = [doc.text for doc in result.reranked_docs]
        scores = [doc.score for doc in result.reranked_docs]
        assert texts == ["first doc", "second doc"]
        assert scores == [0.95, 0.82]

    @pytest.mark.asyncio
    async def test_slice_with_nonsequential_indices_maps_correctly(self):
        """TEI returns results with shuffled indices — code must map back to original docs."""
        reranker = create_reranker()
        # TEI sorted by score: doc2 (0.95) > doc0 (0.82) > doc1 (0.61)
        tei_response = [{"index": 2, "score": 0.95}, {"index": 0, "score": 0.82}, {"index": 1, "score": 0.61}]
        input_doc = create_mock_searched_doc(
            texts=["doc zero", "doc one", "doc two"],
            reranking_strategy="slice",
            top_n=2,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 2
        assert result.reranked_docs[0].text == "doc two"
        assert result.reranked_docs[0].score == 0.95
        assert result.reranked_docs[1].text == "doc zero"
        assert result.reranked_docs[1].score == 0.82

    @pytest.mark.asyncio
    async def test_slice_top_n_zero_defaults_to_one(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="slice",
            top_n=0,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 1


# ---------------------------------------------------------------------------
# Test: Threshold strategy — score boundary validation (AC #1, #5)
# ---------------------------------------------------------------------------


class TestThresholdStrategy:
    """Tests for the 'threshold' reranking strategy."""

    @pytest.mark.asyncio
    async def test_tei_returns_fewer_results_than_input_docs(self):
        """TEI may return a subset — code should handle missing results gracefully."""
        reranker = create_reranker()
        # 5 docs sent, TEI returns only 3
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c", "d", "e"],
            reranking_strategy="slice",
            top_n=5,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 3

    @pytest.mark.asyncio
    async def test_threshold_returns_only_above(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.80, 0.60])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="threshold",
            reranking_threshold=0.75,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        scores = [doc.score for doc in result.reranked_docs]
        assert all(s >= 0.75 for s in scores)
        assert len(result.reranked_docs) == 2

    @pytest.mark.asyncio
    async def test_threshold_all_above_returns_all(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.90, 0.85])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="threshold",
            reranking_threshold=0.75,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 3

    @pytest.mark.asyncio
    async def test_threshold_includes_score_equal_to_threshold(self):
        """Score exactly at threshold should be included (>= comparison)."""
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.75, 0.60])
        input_doc = create_mock_searched_doc(
            texts=["a", "b"],
            reranking_strategy="threshold",
            reranking_threshold=0.75,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 1
        assert result.reranked_docs[0].score == 0.75

    @pytest.mark.asyncio
    async def test_threshold_all_below_returns_empty(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.50, 0.40, 0.30])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="threshold",
            reranking_threshold=0.75,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 0

    @pytest.mark.asyncio
    async def test_threshold_mixed_scores(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.60, 0.85, 0.40])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c", "d"],
            reranking_strategy="threshold",
            reranking_threshold=0.75,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 2
        for doc in result.reranked_docs:
            assert doc.score >= 0.75

    @pytest.mark.asyncio
    async def test_threshold_uses_env_default(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.80, 0.60])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="threshold",
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with (
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
            patch("reranker.genieai_tei_reranker.RERANKING_THRESHOLD", 0.80),
        ):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 2
        assert result.reranked_docs[0].score >= 0.80


# ---------------------------------------------------------------------------
# Test: Knee-threshold strategy — KneeLocator integration (AC #5)
# ---------------------------------------------------------------------------


class TestKneeThresholdStrategy:
    """Tests for the 'knee_threshold' reranking strategy."""

    @pytest.mark.asyncio
    async def test_knee_threshold_calls_knee_locator_with_correct_params(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="knee_threshold",
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        mock_knee = MagicMock()
        mock_knee.knee = 1

        with (
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
            patch("reranker.genieai_tei_reranker.KneeLocator", return_value=mock_knee) as mock_kl,
        ):
            await reranker.invoke(input_doc)

        mock_kl.assert_called_once()
        assert mock_kl.call_args.kwargs["curve"] == "convex"
        assert mock_kl.call_args.kwargs["direction"] == "decreasing"

    @pytest.mark.asyncio
    async def test_knee_found_returns_docs_up_to_cutoff(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61, 0.30])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c", "d"],
            reranking_strategy="knee_threshold",
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        mock_knee = MagicMock()
        mock_knee.knee = 2  # cutoff = knee + 1 = 3

        with (
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
            patch("reranker.genieai_tei_reranker.KneeLocator", return_value=mock_knee),
        ):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 3

    @pytest.mark.asyncio
    async def test_knee_none_returns_all_documents(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="knee_threshold",
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        mock_knee = MagicMock()
        mock_knee.knee = None

        with (
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
            patch("reranker.genieai_tei_reranker.KneeLocator", return_value=mock_knee),
        ):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 3

    @pytest.mark.asyncio
    async def test_kneed_mock_configured_in_conftest(self):
        import kneed

        assert hasattr(kneed, "KneeLocator")


# ---------------------------------------------------------------------------
# Test: Unknown strategy fallback (AC #5)
# ---------------------------------------------------------------------------


class TestUnknownStrategy:
    """Tests for unknown strategy fallback behavior."""

    @pytest.mark.asyncio
    async def test_unknown_strategy_falls_back_to_slice_with_input_top_n(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c"],
            reranking_strategy="nonexistent",
            top_n=2,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 2

    @pytest.mark.asyncio
    async def test_unknown_strategy_logs_warning(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82])
        input_doc = create_mock_searched_doc(
            texts=["a", "b"],
            reranking_strategy="bogus_strategy",
            top_n=1,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with (
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
            patch("reranker.genieai_tei_reranker.logger") as mock_logger,
        ):
            await reranker.invoke(input_doc)

        mock_logger.warning.assert_called_once()
        call_args = mock_logger.warning.call_args[0][0]
        assert "bogus_strategy" in call_args


# ---------------------------------------------------------------------------
# Test: TEI service call payload (AC #3)
# ---------------------------------------------------------------------------


class TestTeiServiceCall:
    """Tests verifying the TEI /rerank endpoint is called correctly."""

    @pytest.mark.asyncio
    async def test_post_called_with_rerank_url(self):
        reranker = create_reranker(base_url="http://tei-host:80")
        tei_response = create_tei_rerank_response([0.95])
        input_doc = create_mock_searched_doc(
            texts=["a"],
            reranking_strategy="slice",
            top_n=1,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            await reranker.invoke(input_doc)

        mock_session.post.assert_called_once()
        call_url = mock_session.post.call_args[0][0]
        assert call_url == "http://tei-host:80/rerank"

    @pytest.mark.asyncio
    async def test_payload_contains_query_and_texts(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95])
        input_doc = create_mock_searched_doc(
            texts=["doc text 1", "doc text 2"],
            initial_query="my search query",
            reranking_strategy="slice",
            top_n=1,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            await reranker.invoke(input_doc)

        call_kwargs = mock_session.post.call_args[1]
        payload = call_kwargs.get("json", {})
        assert "query" in payload
        assert "texts" in payload

    @pytest.mark.asyncio
    async def test_texts_contains_document_strings(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82])
        input_doc = create_mock_searched_doc(
            texts=["alpha text", "beta text"],
            reranking_strategy="slice",
            top_n=2,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            await reranker.invoke(input_doc)

        payload = mock_session.post.call_args[1]["json"]
        assert payload["texts"] == ["alpha text", "beta text"]

    @pytest.mark.asyncio
    async def test_query_comes_from_initial_query(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95])
        input_doc = create_mock_searched_doc(
            texts=["a"],
            initial_query="what is AI?",
            reranking_strategy="slice",
            top_n=1,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            await reranker.invoke(input_doc)

        payload = mock_session.post.call_args[1]["json"]
        assert payload["query"] == "what is AI?"


# ---------------------------------------------------------------------------
# Test: Edge cases — empty/no-docs (AC #1)
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Tests for empty and null edge cases."""

    @pytest.mark.asyncio
    async def test_empty_retrieved_docs_returns_empty_results(self):
        reranker = create_reranker()
        input_doc = create_mock_searched_doc(texts=[], reranking_strategy="slice", top_n=1)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession") as mock_cs:
            result = await reranker.invoke(input_doc)

        mock_cs.assert_not_called()
        assert len(result.reranked_docs) == 0

    @pytest.mark.asyncio
    async def test_none_retrieved_docs_returns_empty_results(self):
        reranker = create_reranker()
        input_doc = create_mock_searched_doc(texts=[], reranking_strategy="slice", top_n=1)
        input_doc.retrieved_docs = None

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession") as mock_cs:
            result = await reranker.invoke(input_doc)

        mock_cs.assert_not_called()
        assert len(result.reranked_docs) == 0


# ---------------------------------------------------------------------------
# Test: Output types for different input types (AC #5)
# ---------------------------------------------------------------------------


class TestOutputTypes:
    """Tests verifying correct return types for different input types."""

    @pytest.mark.asyncio
    async def test_searched_doc_input_returns_reranking_response(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95])
        input_doc = create_mock_searched_doc(
            texts=["a"],
            reranking_strategy="slice",
            top_n=1,
        )
        input_doc.__class__ = _RealSearchedDoc
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert hasattr(result, "reranked_docs")

    @pytest.mark.asyncio
    async def test_reranking_request_input_returns_reranking_response(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95])
        input_doc = create_mock_searched_doc(
            texts=["a"],
            reranking_strategy="slice",
            top_n=1,
        )
        input_doc.__class__ = _RealRerankingRequest
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert hasattr(result, "reranked_docs")

    @pytest.mark.asyncio
    async def test_chat_completion_input_returns_modified_input(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95])
        input_doc = create_mock_searched_doc(
            texts=["a"],
            reranking_strategy="slice",
            top_n=1,
        )
        input_doc.__class__ = _RealChatCompletionRequest
        mock_session = create_mock_aiohttp_session(tei_response)

        with patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session):
            result = await reranker.invoke(input_doc)

        assert result is input_doc
        assert hasattr(result, "reranked_docs")
        assert hasattr(result, "documents")


# ---------------------------------------------------------------------------
# Test: Environment variable defaults (AC #1-5)
# ---------------------------------------------------------------------------


class TestEnvDefaults:
    """Tests verifying environment variable defaults and override behavior."""

    def test_reranking_strategy_default(self):
        import reranker.genieai_tei_reranker as mod

        assert mod.RERANKING_STRATEGY == "slice"

    def test_reranking_threshold_default(self):
        import reranker.genieai_tei_reranker as mod

        assert mod.RERANKING_THRESHOLD == 0.75

    def test_reranker_top_n_default(self):
        import reranker.genieai_tei_reranker as mod

        assert mod.RERANKER_TOP_N == 1

    @pytest.mark.asyncio
    async def test_input_overrides_take_precedence(self):
        reranker = create_reranker()
        tei_response = create_tei_rerank_response([0.95, 0.82, 0.61, 0.50])
        input_doc = create_mock_searched_doc(
            texts=["a", "b", "c", "d"],
            reranking_strategy="threshold",
            reranking_threshold=0.60,
        )
        mock_session = create_mock_aiohttp_session(tei_response)

        with (
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
            patch("reranker.genieai_tei_reranker.RERANKING_THRESHOLD", 0.90),
        ):
            result = await reranker.invoke(input_doc)

        assert len(result.reranked_docs) == 3
