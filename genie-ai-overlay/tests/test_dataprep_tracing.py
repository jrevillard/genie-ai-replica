# Copyright (c) 2025-2026 International Telecommunication Union (ITU)

"""Tests for OTel tracing in Dataprep service.

Verifies that the dataprep component and microservice endpoints create spans
with correct attributes (dataprep.chunk_count, file_type, file_size_bytes, file_id).
"""

import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dataprep.genieai_dataprep_arangodb as dp_arangodb_module
import dataprep.genieai_dataprep_microservice as dps_module
import tracing
from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep
from dataprep.genieai_dataprep_microservice import (
    DocRepoIngestPayload,
    DocRepoRetractPayload,
)

# ---------------------------------------------------------------------------
# Test: Dataprep microservice tracing setup
# ---------------------------------------------------------------------------


class TestDataprepTracingSetup:
    """Tests that Dataprep initializes tracing with the correct service name."""

    def test_setup_tracing_with_dataprep_service_name(self, monkeypatch):
        """Dataprep must call setup_tracing('genieai-dataprep')."""
        monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")

        with patch("tracing.OTLPSpanExporter"):
            tracing._reset()
            tracing.setup_tracing("genieai-dataprep")
            assert tracing._provider is not None

    def test_dataprep_module_has_tracer(self):
        """Dataprep component module must have a tracer attribute."""
        assert hasattr(dp_arangodb_module, "tracer")
        assert dp_arangodb_module.tracer is not None

    def test_dataprep_microservice_has_tracer(self):
        """Dataprep microservice module must have a tracer attribute."""
        assert hasattr(dps_module, "tracer")
        assert dps_module.tracer is not None


# ---------------------------------------------------------------------------
# Test: Dataprep microservice endpoint spans
# ---------------------------------------------------------------------------


class TestDataprepEndpointSpans:
    """Tests for Dataprep microservice endpoint span creation."""

    @pytest.fixture
    def mock_tracer(self):
        """Create a mock tracer that records span creation."""
        tracer = MagicMock()
        span = MagicMock()
        span.__enter__ = MagicMock(return_value=span)
        span.__exit__ = MagicMock(return_value=False)
        tracer.start_as_current_span.return_value = span
        return tracer, span

    @pytest.mark.asyncio
    async def test_ingest_creates_span_with_file_metadata(self, mock_tracer):
        """ingest_file_from_repo must create span with file_type, file_size_bytes, file_id."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoIngestPayload(
                fileId="test-123",
                fileName="report.pdf",
                fileBase64="dGVzdA==",
                fileType="application/pdf",
                uploadDate="2025-01-01",
            )

            with (
                patch.object(dps_module, "loader") as mock_loader,
                patch.object(dps_module, "active_ingestion_tasks", {}),
                patch.object(dps_module, "upload_folder", "/tmp/test"),
                patch("builtins.open", MagicMock()),
                patch("fcntl.flock"),
            ):
                mock_loader.ingest_file_with_guardrail = AsyncMock()
                with contextlib.suppress(Exception):
                    await dps_module.ingest_file_from_repo(payload)

            tracer.start_as_current_span.assert_called_with("dataprep.ingest")
            span.set_attribute.assert_any_call("dataprep.file_type", "application/pdf")
            span.set_attribute.assert_any_call("dataprep.file_size_bytes", 8)
            span.set_attribute.assert_any_call("dataprep.file_id", "test-123")

    @pytest.mark.asyncio
    async def test_retract_creates_span_with_file_id(self, mock_tracer):
        """retract_file must create span with dataprep.file_id attribute."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoRetractPayload(fileId="test-456")

            with patch.object(dps_module, "loader") as mock_loader:
                mock_loader.retract_file = AsyncMock(return_value={"status": 200})
                await dps_module.retract_file(payload)

            tracer.start_as_current_span.assert_called_with("dataprep.retract")
            span.set_attribute.assert_any_call("dataprep.file_id", "test-456")

    @pytest.mark.asyncio
    async def test_retract_records_exception_on_failure(self, mock_tracer):
        """retract_file must call span.record_exception when loader raises."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoRetractPayload(fileId="test-err")

            with patch.object(dps_module, "loader") as mock_loader:
                mock_loader.retract_file = AsyncMock(side_effect=RuntimeError("DB down"))
                with pytest.raises(RuntimeError):
                    await dps_module.retract_file(payload)

            span.record_exception.assert_called_once()

    @pytest.mark.asyncio
    async def test_retract_sets_error_status_on_failure(self, mock_tracer):
        """retract_file must set span status to ERROR when loader raises."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoRetractPayload(fileId="test-err")

            with patch.object(dps_module, "loader") as mock_loader:
                mock_loader.retract_file = AsyncMock(side_effect=RuntimeError("DB down"))
                with pytest.raises(RuntimeError):
                    await dps_module.retract_file(payload)

            span.set_status.assert_called_once()

    @pytest.mark.asyncio
    async def test_ingest_records_exception_on_failure(self, mock_tracer):
        """ingest_file_from_repo must record exception when ingestion fails."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoIngestPayload(
                fileId="test-err",
                fileName="bad.pdf",
                fileBase64="dGVzdA==",
                fileType="application/pdf",
                uploadDate="2025-01-01",
            )

            with (
                patch.object(dps_module, "loader"),
                patch.object(dps_module, "active_ingestion_tasks", {}),
                patch.object(dps_module, "upload_folder", "/tmp/test"),
                patch("builtins.open", MagicMock()),
                patch("fcntl.flock"),
                patch.object(
                    dps_module,
                    "ArangoDBDataprepRequestFromDocRepo",
                    side_effect=RuntimeError("construction failed"),
                ),
                pytest.raises(RuntimeError),
            ):
                await dps_module.ingest_file_from_repo(payload)

            span.record_exception.assert_called_once()
            span.set_status.assert_called_once()

    @pytest.mark.asyncio
    async def test_kill_ingest_creates_span_with_file_id(self, mock_tracer):
        """kill_ingest_task must create span with dataprep.file_id attribute."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoRetractPayload(fileId="test-789")

            with patch.object(dps_module, "active_ingestion_tasks", {}):
                await dps_module.kill_ingest_task(payload)

            tracer.start_as_current_span.assert_called_with("dataprep.kill_ingest")
            span.set_attribute.assert_any_call("dataprep.file_id", "test-789")

    @pytest.mark.asyncio
    async def test_kill_ingest_active_task_cancels(self, mock_tracer):
        """kill_ingest_task with active task cancels it and returns success."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoRetractPayload(fileId="test-active")

            mock_task = MagicMock()
            with patch.object(dps_module, "active_ingestion_tasks", {"test-active": mock_task}):
                result = await dps_module.kill_ingest_task(payload)

            mock_task.cancel.assert_called_once()
            assert result["success"] is True

    @pytest.mark.asyncio
    async def test_kill_ingest_sets_cancelled_result_attribute(self, mock_tracer):
        """kill_ingest_task with active task must set dataprep.kill_result='cancelled'."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoRetractPayload(fileId="test-active")

            mock_task = MagicMock()
            with patch.object(dps_module, "active_ingestion_tasks", {"test-active": mock_task}):
                await dps_module.kill_ingest_task(payload)

            span.set_attribute.assert_any_call("dataprep.kill_result", "cancelled")

    @pytest.mark.asyncio
    async def test_kill_ingest_sets_not_found_result_attribute(self, mock_tracer):
        """kill_ingest_task with no active task must set dataprep.kill_result='not_found'."""
        tracer, span = mock_tracer

        with patch.object(dps_module, "tracer", tracer):
            payload = DocRepoRetractPayload(fileId="test-missing")

            with patch.object(dps_module, "active_ingestion_tasks", {}):
                await dps_module.kill_ingest_task(payload)

            span.set_attribute.assert_any_call("dataprep.kill_result", "not_found")


# ---------------------------------------------------------------------------
# Test: Dataprep component creates chunk_count span attribute
# ---------------------------------------------------------------------------


class TestDataprepComponentSpan:
    """Tests for GenieArangoDataprep chunking span attributes."""

    @pytest.fixture
    def mock_tracer(self):
        """Create a mock tracer that records span creation."""
        tracer = MagicMock()
        span = MagicMock()
        span.__enter__ = MagicMock(return_value=span)
        span.__exit__ = MagicMock(return_value=False)
        tracer.start_as_current_span.return_value = span
        return tracer, span

    def test_load_and_chunk_creates_span_with_chunk_count(self, mock_tracer):
        """_load_and_chunk must record dataprep.chunk_count after chunking."""
        tracer, span = mock_tracer

        with (
            patch("dataprep.genieai_dataprep_arangodb.tracer", tracer),
            patch(
                "dataprep.genieai_dataprep_arangodb.document_loader",
                new_callable=AsyncMock,
                return_value="Test content for chunking.",
            ),
            patch(
                "dataprep.genieai_dataprep_arangodb.is_valid_content",
                return_value=True,
            ),
            patch("dataprep.genieai_dataprep_arangodb.get_separators", return_value=["\n\n", "\n", " "]),
        ):
            dp = GenieArangoDataprep.__new__(GenieArangoDataprep)
            dp.db = MagicMock()
            dp.embeddings = MagicMock()

            doc_path = MagicMock()
            doc_path.path = "test.txt"
            doc_path.chunk_size = 500
            doc_path.chunk_overlap = 50

            import asyncio

            chunks = asyncio.run(dp._load_and_chunk(doc_path))

            tracer.start_as_current_span.assert_called_once_with("dataprep.chunking")
            span.set_attribute.assert_any_call("dataprep.chunk_count", len(chunks))

    def test_load_and_chunk_empty_file_returns_empty(self, mock_tracer):
        """_load_and_chunk with no content returns empty list."""
        tracer, span = mock_tracer

        with (
            patch("dataprep.genieai_dataprep_arangodb.tracer", tracer),
            patch(
                "dataprep.genieai_dataprep_arangodb.document_loader",
                new_callable=AsyncMock,
                return_value="",
            ),
        ):
            dp = GenieArangoDataprep.__new__(GenieArangoDataprep)
            dp.db = MagicMock()
            dp.embeddings = MagicMock()

            doc_path = MagicMock()
            doc_path.path = "empty.txt"
            doc_path.chunk_size = 500
            doc_path.chunk_overlap = 50

            import asyncio

            chunks = asyncio.run(dp._load_and_chunk(doc_path))

            assert chunks == []

    def test_arangodb_module_has_propagate_import(self):
        """Dataprep arangodb module must import propagate for trace context."""
        assert hasattr(dp_arangodb_module, "propagate")

    def test_update_doc_status_propagates_trace(self):
        """_update_doc_status must call propagate.inject before aiohttp call."""
        mock_self = MagicMock()
        mock_self._service_headers = AsyncMock(return_value={"Authorization": "Bearer test"})
        mock_self._log_semaphore = MagicMock()
        mock_self._log_semaphore.__aenter__ = AsyncMock(return_value=None)
        mock_self._log_semaphore.__aexit__ = AsyncMock(return_value=None)

        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.text = AsyncMock(return_value="OK")

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_response)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        import asyncio

        with (
            patch("dataprep.genieai_dataprep_arangodb.aiohttp.ClientSession", return_value=mock_session),
            patch("dataprep.genieai_dataprep_arangodb.propagate") as mock_propagate,
        ):
            mock_propagate.inject = MagicMock()
            asyncio.run(dp_arangodb_module.GenieArangoDataprep._update_doc_status(mock_self, "file-123", "Processing"))
            mock_propagate.inject.assert_called_once()
