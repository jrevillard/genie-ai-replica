# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

"""Custom application metrics for ChatQnA service.

Uses the shared tracing module's get_meter() for instrument creation.
The MeterProvider is configured by tracing.setup_tracing().
"""

from tracing import get_meter as _get_tracing_meter

# PII keys that must never appear in metric attributes
_PII_KEYS = frozenset(
    {
        "user_query",
        "llm_response",
        "session_id",
        "conversation_id",
        "user_id",
        "email",
        "document_text",
        "password",
        "token",
    }
)


def _sanitize_attributes(attrs: dict) -> dict:
    """Return a copy of *attrs* with PII keys removed."""
    return {k: v for k, v in attrs.items() if k not in _PII_KEYS}


def get_meter():
    """Return a meter instance for creating custom instruments.

    Delegates to tracing.get_meter() which uses the shared MeterProvider.
    """
    return _get_tracing_meter()


# ---------------------------------------------------------------------------
# Instruments — created once at module level
# ---------------------------------------------------------------------------

_meter = get_meter()

chat_requests_total = _meter.create_counter(
    "genie.ai/chat/request",
    description="Total chat requests",
)

chat_rag_duration_seconds = _meter.create_histogram(
    "genie.ai/chat/rag/latency",
    description="Chat RAG pipeline duration",
    unit="s",
)

__all__ = [
    "get_meter",
    "chat_requests_total",
    "chat_rag_duration_seconds",
    "_sanitize_attributes",
    "_PII_KEYS",
]
