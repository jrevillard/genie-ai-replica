"""Regression: after T2b there is no OTel SDK LoggerProvider in Python
services. The single emit path is python logging -> stdout -> fluentd
driver -> OTel collector -> VL (collector redacts PII in T1).
"""

from pathlib import Path

OVERLAY = Path(__file__).resolve().parent.parent
TRACING = OVERLAY / "tracing.py"


def test_no_otlp_log_exporter_in_tracing():
    src = TRACING.read_text()
    assert "OTLPLogExporter" not in src
    assert "LoggerProvider" not in src
    assert "set_logger_provider" not in src
    assert "OTEL_LOGS_ENABLED" not in src


def test_no_tracing_pii_module():
    assert not (OVERLAY / "tracing_pii.py").exists()
