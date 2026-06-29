# Copyright (c) 2025-2026 International Telecommunication Union (ITU)

"""Tests for OTel tracing in Reranker microservice and component.

Verifies setup_tracing call, manual span creation, and span attributes
for the reranking() endpoint and GenieTEIReranking.invoke().
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import reranker.genieai_reranking_microservice as rms_module
import reranker.genieai_tei_reranker as rtc_module
import tracing
from reranker.genieai_tei_reranker import GenieTEIReranking

# Real type for isinstance() checks — SearchedDoc is MagicMock in conftest
_RealSearchedDoc = type("SearchedDoc", (), {})


# ---------------------------------------------------------------------------
# Test: Reranker microservice tracing setup
# ---------------------------------------------------------------------------


class TestRerankerTracingSetup:
    """Tests that Reranker initializes tracing with the correct service name."""

    def test_setup_tracing_with_reranker_service_name(self, monkeypatch):
        """Reranker must call setup_tracing('genieai-reranker')."""
        monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")

        with patch("tracing.OTLPSpanExporter"):
            tracing._reset()
            tracing.setup_tracing("genieai-reranker")
            assert tracing._provider is not None

    def test_reranker_component_has_tracer(self):
        """Reranker component module must have a tracer attribute."""
        assert hasattr(rtc_module, "tracer")
        assert rtc_module.tracer is not None

    def test_reranker_microservice_has_tracer(self):
        """Reranker microservice module must have a tracer attribute."""
        assert hasattr(rms_module, "tracer")
        assert rms_module.tracer is not None


# ---------------------------------------------------------------------------
# Test: reranking() endpoint creates span with correct attributes
# ---------------------------------------------------------------------------


class TestRerankingEndpointSpan:
    """Tests for reranking() endpoint manual span attributes."""

    @pytest.fixture
    def mock_tracer(self):
        tracer = MagicMock()
        span = MagicMock()
        span.__enter__ = MagicMock(return_value=span)
        span.__exit__ = MagicMock(return_value=False)
        tracer.start_as_current_span.return_value = span
        return tracer, span

    @pytest.mark.asyncio
    async def test_reranking_creates_span_with_strategy(self, mock_tracer):
        """reranking() must create span with reranker.strategy attribute."""
        tracer, span = mock_tracer

        with patch.object(rms_module, "tracer", tracer):
            mock_response = MagicMock()
            mock_response.reranked_docs = [MagicMock()]
            rms_module.loader.invoke = AsyncMock(return_value=mock_response)

            input_data = MagicMock()
            input_data.retrieved_docs = [MagicMock()]
            input_data.model_dump = MagicMock(return_value={})

            await rms_module.reranking(input_data)

            tracer.start_as_current_span.assert_called_with("reranker.rerank")
            span.set_attribute.assert_any_call("reranker.strategy", "adaptive")

    @pytest.mark.asyncio
    async def test_reranking_records_input_and_output_doc_counts(self, mock_tracer):
        """reranking() must record input and output doc counts."""
        tracer, span = mock_tracer

        with patch.object(rms_module, "tracer", tracer):
            mock_response = MagicMock()
            mock_response.reranked_docs = [MagicMock(), MagicMock()]
            rms_module.loader.invoke = AsyncMock(return_value=mock_response)

            input_data = MagicMock()
            input_data.retrieved_docs = [MagicMock(), MagicMock(), MagicMock()]
            input_data.model_dump = MagicMock(return_value={})

            await rms_module.reranking(input_data)

            span.set_attribute.assert_any_call("reranker.input_doc_count", 3)
            span.set_attribute.assert_any_call("reranker.output_doc_count", 2)

    @pytest.mark.asyncio
    async def test_reranking_records_exception_on_failure(self, mock_tracer):
        """reranking() must call span.record_exception when loader raises."""
        tracer, span = mock_tracer

        with patch.object(rms_module, "tracer", tracer):
            rms_module.loader.invoke = AsyncMock(side_effect=RuntimeError("TEI down"))

            input_data = MagicMock()
            input_data.retrieved_docs = [MagicMock()]
            input_data.model_dump = MagicMock(return_value={})

            with pytest.raises(RuntimeError):
                await rms_module.reranking(input_data)

            span.record_exception.assert_called_once()

    @pytest.mark.asyncio
    async def test_reranking_sets_error_status_on_failure(self, mock_tracer):
        """reranking() must set span status to ERROR when loader raises."""
        tracer, span = mock_tracer

        with patch.object(rms_module, "tracer", tracer):
            rms_module.loader.invoke = AsyncMock(side_effect=RuntimeError("TEI down"))

            input_data = MagicMock()
            input_data.retrieved_docs = [MagicMock()]
            input_data.model_dump = MagicMock(return_value={})

            with pytest.raises(RuntimeError):
                await rms_module.reranking(input_data)

            span.set_status.assert_called_once()

    @pytest.mark.asyncio
    async def test_reranking_with_no_docs_records_zero_count(self, mock_tracer):
        """reranking() with no retrieved docs must record input_doc_count=0."""
        tracer, span = mock_tracer

        with patch.object(rms_module, "tracer", tracer):
            mock_response = MagicMock()
            mock_response.reranked_docs = []
            rms_module.loader.invoke = AsyncMock(return_value=mock_response)

            input_data = MagicMock()
            input_data.retrieved_docs = None
            input_data.model_dump = MagicMock(return_value={})

            await rms_module.reranking(input_data)

            span.set_attribute.assert_any_call("reranker.input_doc_count", 0)
            span.set_attribute.assert_any_call("reranker.output_doc_count", 0)


# ---------------------------------------------------------------------------
# Test: GenieTEIReranking.invoke creates span with correct attributes
# ---------------------------------------------------------------------------


class TestRerankerComponentSpan:
    """Tests for GenieTEIReranking.invoke() span attributes."""

    @pytest.fixture
    def mock_tracer(self):
        tracer = MagicMock()
        span = MagicMock()
        span.__enter__ = MagicMock(return_value=span)
        span.__exit__ = MagicMock(return_value=False)
        tracer.start_as_current_span.return_value = span
        return tracer, span

    @pytest.fixture(autouse=True)
    def patch_searched_doc(self):
        """Patch SearchedDoc with a real type so isinstance() works."""
        original_sd = rtc_module.SearchedDoc
        rtc_module.SearchedDoc = _RealSearchedDoc
        yield
        rtc_module.SearchedDoc = original_sd

    def _make_input(self, docs=None, strategy="slice", threshold=0.75, top_n=3):
        """Create a mock input for invoke()."""
        input_data = MagicMock(spec=["retrieved_docs", "initial_query"])
        input_data.retrieved_docs = docs or [MagicMock(text="doc1"), MagicMock(text="doc2")]
        input_data.initial_query = "test query"
        input_data.top_n = top_n
        input_dict = {"reranking_strategy": strategy, "reranking_threshold": threshold, "top_n": top_n}
        input_data.model_dump = MagicMock(return_value=input_dict)
        input_data.__class__ = _RealSearchedDoc
        return input_data

    def _make_session(self, scores=None):
        """Create a mock aiohttp session returning TEI rerank responses."""
        if scores is None:
            scores = [0.95, 0.8]
        response_data = [{"index": i, "score": s} for i, s in enumerate(scores)]

        mock_response = AsyncMock()
        mock_response.json = AsyncMock(return_value=response_data)
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.post = MagicMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        return mock_session

    @pytest.mark.asyncio
    async def test_invoke_creates_span_with_all_attributes(self, mock_tracer):
        """invoke() must set strategy, top_n, score_threshold, model_id, and doc counts."""
        tracer, span = mock_tracer

        with (
            patch.object(rtc_module, "tracer", tracer),
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=self._make_session()),
        ):
            reranker = GenieTEIReranking.__new__(GenieTEIReranking)
            reranker.base_url = "http://tei-reranker:80"
            await reranker.invoke(self._make_input())

            tracer.start_as_current_span.assert_called_once_with("reranker.tei_invoke")
            span.set_attribute.assert_any_call("reranker.strategy", "slice")
            span.set_attribute.assert_any_call("reranker.top_n", 3)
            span.set_attribute.assert_any_call("reranker.score_threshold", 0.75)
            span.set_attribute.assert_any_call("reranker.input_doc_count", 2)
            span.set_attribute.assert_any_call("reranker.output_doc_count", 2)

    @pytest.mark.asyncio
    async def test_invoke_sets_model_id_from_env(self, mock_tracer, monkeypatch):
        """invoke() must set reranker.model_id from RERANKER_MODEL_ID env var."""
        tracer, span = mock_tracer
        monkeypatch.setenv("RERANKER_MODEL_ID", "BAAI/bge-reranker-v2-m3")

        with (
            patch.object(rtc_module, "tracer", tracer),
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=self._make_session()),
        ):
            reranker = GenieTEIReranking.__new__(GenieTEIReranking)
            reranker.base_url = "http://tei-reranker:80"
            await reranker.invoke(self._make_input())

            span.set_attribute.assert_any_call("reranker.model_id", "BAAI/bge-reranker-v2-m3")

    @pytest.mark.asyncio
    async def test_invoke_propagates_trace_context(self, mock_tracer):
        """invoke() must inject traceparent headers into TEI aiohttp call."""
        tracer, span = mock_tracer

        with (
            patch.object(rtc_module, "tracer", tracer),
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=self._make_session()),
            patch("reranker.genieai_tei_reranker.propagate") as mock_propagate,
        ):
            mock_propagate.inject = MagicMock()
            reranker = GenieTEIReranking.__new__(GenieTEIReranking)
            reranker.base_url = "http://tei-reranker:80"
            await reranker.invoke(self._make_input())

            mock_propagate.inject.assert_called_once()

    @pytest.mark.asyncio
    async def test_invoke_records_exception_on_tei_failure(self, mock_tracer):
        """invoke() must record exception and set error status when TEI call fails."""
        tracer, span = mock_tracer

        mock_session = AsyncMock()
        mock_session.post = MagicMock(side_effect=ConnectionError("TEI unreachable"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with (
            patch.object(rtc_module, "tracer", tracer),
            patch("reranker.genieai_tei_reranker.aiohttp.ClientSession", return_value=mock_session),
        ):
            reranker = GenieTEIReranking.__new__(GenieTEIReranking)
            reranker.base_url = "http://tei-reranker:80"

            with pytest.raises(ConnectionError):
                await reranker.invoke(self._make_input())

            span.record_exception.assert_called_once()
            span.set_status.assert_called_once()
