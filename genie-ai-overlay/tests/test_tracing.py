# Copyright (c) 2025-2026 International Telecommunication Union (ITU)

from unittest.mock import MagicMock, patch

import pytest

import tracing


@pytest.fixture(autouse=True)
def _reset_tracing(monkeypatch):
    """Reset tracing module state before each test."""
    monkeypatch.setenv("ENABLE_OBSERVABILITY", "1")
    tracing._reset()
    yield
    tracing._reset()


# ---------------------------------------------------------------------------
# Tests for the shared OTel tracing module
# ---------------------------------------------------------------------------


class TestSetupTracing:
    """Tests for tracing.setup_tracing()."""

    def test_configures_exporter_with_v1_traces_suffix(self, monkeypatch):
        """OTLPSpanExporter must receive the full URL including /v1/traces."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
        with patch.object(tracing, "OTLPSpanExporter") as mock_exporter:
            tracing.setup_tracing("genieai-retriever")
            mock_exporter.assert_called_once_with(endpoint="http://otel-collector:4318/v1/traces")

    def test_skips_setup_when_endpoint_not_set(self, monkeypatch):
        """When OTEL_EXPORTER_OTLP_ENDPOINT is not set, setup_tracing() returns early (no-op)."""
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
        with patch.object(tracing, "OTLPSpanExporter") as mock_exporter:
            tracing.setup_tracing("test-service")
            mock_exporter.assert_not_called()

    def test_skips_setup_when_observability_disabled(self, monkeypatch):
        """When ENABLE_OBSERVABILITY is not '1', setup_tracing() returns early (no-op).

        This is the primary gate: even if OTEL_EXPORTER_OTLP_ENDPOINT is set,
        the SDK must not initialize when observability is disabled because the
        Collector container is not deployed, causing DNS resolution errors.
        """
        monkeypatch.setenv("ENABLE_OBSERVABILITY", "0")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
        with patch.object(tracing, "OTLPSpanExporter") as mock_exporter:
            tracing.setup_tracing("test-service")
            mock_exporter.assert_not_called()

    def test_skips_setup_when_observability_unset(self, monkeypatch):
        """When ENABLE_OBSERVABILITY is not set at all, setup_tracing() returns early."""
        monkeypatch.delenv("ENABLE_OBSERVABILITY", raising=False)
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
        with patch.object(tracing, "OTLPSpanExporter") as mock_exporter:
            tracing.setup_tracing("test-service")
            mock_exporter.assert_not_called()

    def test_registers_shutdown_via_atexit(self, monkeypatch):
        """setup_tracing() must register shutdown handler via atexit."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        with patch.object(tracing, "atexit") as mock_atexit:
            tracing.setup_tracing("test-service")
            mock_atexit.register.assert_called_with(tracing.shutdown)

    def test_creates_span_processor_with_exporter(self, monkeypatch):
        """BatchSpanProcessor must be created wrapping the exporter."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        mock_exporter = MagicMock()
        with (
            patch.object(tracing, "OTLPSpanExporter", return_value=mock_exporter),
            patch.object(tracing, "BatchSpanProcessor", autospec=True) as mock_processor,
        ):
            tracing.setup_tracing("test-service")
            mock_processor.assert_called_once_with(mock_exporter)

    def test_stores_provider_as_module_global(self, monkeypatch):
        """setup_tracing() must store the TracerProvider in _provider."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")
        assert tracing._provider is not None


class TestGetTracer:
    """Tests for tracing.get_tracer()."""

    def test_returns_tracer_after_setup(self, monkeypatch):
        """get_tracer() must return a tracer after setup_tracing()."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")
        tracer = tracing.get_tracer("test-module")
        assert tracer is not None

    def test_returns_non_none_before_setup(self):
        """get_tracer() must return a non-None tracer even before setup_tracing()."""
        tracer = tracing.get_tracer("test-module")
        assert tracer is not None


class TestShutdown:
    """Tests for tracing.shutdown()."""

    def test_calls_force_flush_and_shutdown(self, monkeypatch):
        """shutdown() must call force_flush then shutdown on the provider."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")

        mock_provider = MagicMock()
        tracing._provider = mock_provider
        tracing.shutdown()

        mock_provider.force_flush.assert_called_once_with(30_000)
        mock_provider.shutdown.assert_called_once()

    def test_handles_missing_provider_gracefully(self):
        """shutdown() must not raise if no provider was configured."""
        tracing.shutdown()  # Should not raise

    def test_sets_provider_to_none(self, monkeypatch):
        """shutdown() must set _provider to None after cleanup."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")
        tracing.shutdown()
        assert tracing._provider is None


class TestResourceAttributes:
    """Tests for resource attribute configuration."""

    def test_includes_service_name_version_environment(self, monkeypatch):
        """Resource must include service.name, service.version, deployment.environment."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        monkeypatch.setenv("NODE_ENV", "production")

        with (
            patch.object(tracing, "OTLPSpanExporter"),
            patch.object(tracing, "TracerProvider", autospec=True) as mock_tp,
        ):
            tracing.setup_tracing("genieai-chatqna")

            call_kwargs = mock_tp.call_args
            resource = call_kwargs[1]["resource"]
            attrs = resource.attributes
            assert attrs["service.name"] == "genieai-chatqna"
            assert attrs["deployment.environment"] == "production"
            assert "service.version" in attrs

    def test_custom_service_version(self, monkeypatch):
        """SERVICE_VERSION env var overrides default version."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        monkeypatch.setenv("SERVICE_VERSION", "2.5.0")

        with (
            patch.object(tracing, "OTLPSpanExporter"),
            patch.object(tracing, "TracerProvider", autospec=True) as mock_tp,
        ):
            tracing.setup_tracing("genieai-chatqna")

            resource = mock_tp.call_args[1]["resource"]
            assert resource.attributes["service.version"] == "2.5.0"


class TestSigtermHandler:
    """Tests for _sigterm_handler."""

    def test_calls_shutdown_and_exits(self, monkeypatch):
        """_sigterm_handler must call shutdown() then sys.exit(0)."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        with (
            patch.object(tracing, "OTLPSpanExporter"),
        ):
            tracing.setup_tracing("test-service")

        with patch.object(tracing, "shutdown") as mock_shutdown:
            with pytest.raises(SystemExit) as exc_info:
                tracing._sigterm_handler(None, None)
            mock_shutdown.assert_called_once()
            assert exc_info.value.code == 0


# ---------------------------------------------------------------------------
# Metrics instrumentation (Task 2)
# ---------------------------------------------------------------------------


class TestMeterProvider:
    """Tests for MeterProvider setup in setup_tracing()."""

    def test_configures_metric_exporter_with_v1_metrics_suffix(self, monkeypatch):
        """OTLPMetricExporter must receive the full URL including /v1/metrics."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
        with patch.object(tracing, "OTLPMetricExporter") as mock_exporter:
            tracing.setup_tracing("test-service")
            mock_exporter.assert_called_once_with(endpoint="http://otel-collector:4318/v1/metrics")

    def test_creates_periodic_metric_reader(self, monkeypatch):
        """PeriodicExportingMetricReader must be created with the exporter."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        mock_exporter = MagicMock()
        mock_reader_instance = MagicMock()
        mock_reader_instance._instrument_class_temporality = {}
        mock_reader_instance._instrument_aggregation = {}
        with (
            patch.object(tracing, "OTLPMetricExporter", return_value=mock_exporter),
            patch.object(
                tracing, "PeriodicExportingMetricReader", return_value=mock_reader_instance
            ) as mock_reader_cls,
        ):
            tracing.setup_tracing("test-service")
            mock_reader_cls.assert_called_once()
            call_kwargs = mock_reader_cls.call_args[1]
            assert call_kwargs["exporter"] is mock_exporter
            assert "export_interval_millis" in call_kwargs

    def test_stores_meter_provider_as_module_global(self, monkeypatch):
        """setup_tracing() must store the MeterProvider in _meter_provider."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")
        assert tracing._meter_provider is not None

    def test_skips_metrics_when_endpoint_not_set(self, monkeypatch):
        """When OTEL_EXPORTER_OTLP_ENDPOINT is unset, no MeterProvider is created."""
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
        tracing.setup_tracing("test-service")
        assert tracing._meter_provider is None


class TestGetMeter:
    """Tests for tracing.get_meter()."""

    def test_returns_meter_after_setup(self, monkeypatch):
        """get_meter() must return a non-None meter after setup_tracing()."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")
        meter = tracing.get_meter()
        assert meter is not None

    def test_returns_non_none_before_setup(self):
        """get_meter() must return a non-None meter even before setup_tracing()."""
        meter = tracing.get_meter()
        assert meter is not None


class TestMeterShutdown:
    """Tests for meter provider shutdown in shutdown()."""

    def test_shutdown_flushes_and_stops_meter_provider(self, monkeypatch):
        """shutdown() must also flush and stop the MeterProvider."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")

        mock_meter_provider = MagicMock()
        tracing._meter_provider = mock_meter_provider
        tracing.shutdown()

        mock_meter_provider.force_flush.assert_called_once()
        mock_meter_provider.shutdown.assert_called_once()

    def test_shutdown_sets_meter_provider_to_none(self, monkeypatch):
        """shutdown() must set _meter_provider to None."""
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
        tracing.setup_tracing("test-service")
        tracing.shutdown()
        assert tracing._meter_provider is None
