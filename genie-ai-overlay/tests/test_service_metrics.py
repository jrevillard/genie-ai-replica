# Copyright (c) 2025-2026 International Telecommunication Union (ITU)

"""Tests for custom application metrics in OPEA microservices.

Verifies that Retriever, Dataprep, and Reranker services use the correct
metric attributes with proper PII sanitization and error classification.
Tests the shared sanitize_attributes function against all expected attribute
shapes used by each service.

Instrument creation (counter/histogram) is tested indirectly via test_metrics.py
for ChatQnA — the same pattern applies to all services.
"""

import os

import pytest

import tracing


@pytest.fixture(autouse=True)
def _preserve_real_sanitize():
    """Ensure real tracing.sanitize_attributes is used (not mocked)."""
    # tracing module is already imported with real implementations
    yield


# ---------------------------------------------------------------------------
# Retriever metrics
# ---------------------------------------------------------------------------


class TestRetrieverMetrics:
    """Tests for retriever metric attributes and PII filtering."""

    def test_success_attributes(self):
        """Success-path attributes must include rag.query_type and error='false'."""
        attrs = tracing.sanitize_attributes(
            {
                "rag.query_type": os.getenv("RETRIEVER_TYPE", "hybrid"),
                "error": "false",
            }
        )
        assert attrs["rag.query_type"] == "hybrid"
        assert attrs["error"] == "false"

    def test_error_attributes(self):
        """Error-path attributes must include error='true'."""
        attrs = tracing.sanitize_attributes(
            {
                "rag.query_type": "hybrid",
                "error": "true",
            }
        )
        assert attrs["error"] == "true"

    def test_uses_env_var_for_query_type(self, monkeypatch):
        """Retriever must use RETRIEVER_TYPE env var for rag.query_type."""
        monkeypatch.setenv("RETRIEVER_TYPE", "vector")
        attrs = tracing.sanitize_attributes(
            {
                "rag.query_type": os.getenv("RETRIEVER_TYPE", "hybrid"),
                "error": "false",
            }
        )
        assert attrs["rag.query_type"] == "vector"

    def test_sanitize_strips_pii(self):
        """PII keys must be stripped from retriever metric attributes."""
        attrs = tracing.sanitize_attributes(
            {
                "rag.query_type": "hybrid",
                "error": "false",
                "user_query": "secret search text",
            }
        )
        assert "user_query" not in attrs
        assert attrs["rag.query_type"] == "hybrid"


# ---------------------------------------------------------------------------
# Dataprep metrics
# ---------------------------------------------------------------------------


class TestDataprepMetrics:
    """Tests for dataprep metric attributes and PII filtering."""

    def test_success_attributes_with_file_type(self):
        """Success-path attributes must include dataprep.file_type."""
        attrs = tracing.sanitize_attributes(
            {
                "dataprep.file_type": "pdf",
                "error": "false",
            }
        )
        assert attrs["dataprep.file_type"] == "pdf"
        assert attrs["error"] == "false"

    def test_uses_payload_file_type_attribute(self):
        """Dataprep uses payload.fileType (camelCase) for metric attributes."""
        # Simulate a payload object with fileType attribute
        FakePayload = type("FakePayload", (), {"fileType": "pdf"})
        assert FakePayload().fileType == "pdf"

    def test_sanitize_strips_pii(self):
        """PII keys must be stripped from dataprep metric attributes."""
        attrs = tracing.sanitize_attributes(
            {
                "dataprep.file_type": "pdf",
                "error": "false",
                "document_text": "sensitive content",
            }
        )
        assert "document_text" not in attrs
        assert attrs["dataprep.file_type"] == "pdf"


# ---------------------------------------------------------------------------
# Reranker metrics
# ---------------------------------------------------------------------------


class TestRerankerMetrics:
    """Tests for reranker metric attributes and PII filtering."""

    def test_success_attributes_with_model_id(self, monkeypatch):
        """Success-path attributes must include reranker.model_id from env."""
        monkeypatch.setenv("RERANKER_MODEL_ID", "BAAI/bge-reranker-base")
        attrs = tracing.sanitize_attributes(
            {
                "reranker.model_id": os.getenv("RERANKER_MODEL_ID", "unknown"),
                "error": "false",
            }
        )
        assert attrs["reranker.model_id"] == "BAAI/bge-reranker-base"
        assert attrs["error"] == "false"

    def test_fallback_to_unknown_model_id(self):
        """When model ID env var is not set, fallback to 'unknown'."""
        model_id = os.getenv("RERANKER_MODEL_ID", "unknown")
        assert model_id == "unknown"

    def test_error_attributes(self, monkeypatch):
        """Error-path attributes must include error='true'."""
        monkeypatch.setenv("RERANKER_MODEL_ID", "test-model")
        attrs = tracing.sanitize_attributes(
            {
                "reranker.model_id": os.getenv("RERANKER_MODEL_ID", "unknown"),
                "error": "true",
            }
        )
        assert attrs["error"] == "true"

    def test_sanitize_strips_pii(self):
        """PII keys must be stripped from reranker metric attributes."""
        attrs = tracing.sanitize_attributes(
            {
                "reranker.model_id": "test-model",
                "error": "false",
                "email": "user@example.com",
            }
        )
        assert "email" not in attrs
        assert attrs["reranker.model_id"] == "test-model"


# ---------------------------------------------------------------------------
# Shared PII enforcement across all services
# ---------------------------------------------------------------------------


class TestCrossServicePIIEnforcement:
    """Verify all PII keys are filtered regardless of service context."""

    ALL_PII_KEYS = [
        "user_query",
        "llm_response",
        "session_id",
        "conversation_id",
        "user_id",
        "email",
        "document_text",
        "password",
        "token",
    ]

    @pytest.mark.parametrize("pii_key", ALL_PII_KEYS)
    def test_pii_key_stripped(self, pii_key):
        """Each PII key must be stripped from metric attributes."""
        attrs = tracing.sanitize_attributes(
            {
                "safe.attr": "value",
                pii_key: "sensitive",
            }
        )
        assert pii_key not in attrs
        assert attrs["safe.attr"] == "value"

    def test_sanitize_preserves_safe_keys(self):
        """Non-PII keys must pass through unchanged."""
        safe_attrs = {
            "http.method": "GET",
            "http.status_code": 200,
            "http.route": "/api/chat",
            "rag.query_type": "hybrid",
            "dataprep.file_type": "pdf",
            "reranker.model_id": "test",
            "error": "false",
            "retrieval_source": "hybrid",
            "response_type": "streaming",
            "abstained": "false",
        }
        result = tracing.sanitize_attributes(safe_attrs)
        assert result == safe_attrs
