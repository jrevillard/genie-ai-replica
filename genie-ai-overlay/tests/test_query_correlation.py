# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for genie.query_id correlation carried in OTel baggage.

The Node backend injects the id before calling chatqna; the Python services read
it back and stamp it on their spans. Absent baggage must leave the attribute
UNSET -- never empty, never "undefined", never a placeholder -- so "no
correlation id" stays distinguishable from "empty id".
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from opentelemetry import baggage
from opentelemetry import context as otel_context
from pydantic import BaseModel

import chatqna.genieai_chatqna as chatqna_module
import reranker.genieai_tei_reranker as reranker_module
import retriever.genieai_retriever_arangodb as retriever_module
from core.span_attrs import QUERY_ID_KEY, query_id_from_baggage
from reranker.genieai_tei_reranker import GenieTEIReranking
from tests.test_chatqna import (
    _fake_parms,
    _patched_chat_request,
    create_chatqna_service,
    create_mock_chat_request_data,
    create_mock_request,
)


def _attach_baggage(entries):
    """Attach an OTel context carrying ``entries`` and return its detach token.

    ``baggage.set_baggage(key, value)`` sets ONE entry and returns the new
    ``Context``; attaching it is ``opentelemetry.context.attach``, not a method
    on the context itself. There is no "baggage name" argument.
    """
    ctx = None
    for key, value in entries.items():
        ctx = baggage.set_baggage(key, value, context=ctx)
    return otel_context.attach(ctx if ctx is not None else otel_context.get_current())


def _emit_outcome_span():
    """Call the real stream-outcome emitter with the argument shape production uses."""
    chatqna_module._emit_stream_outcome_span(
        parent_context=None,
        retrieval_confidence=0.5,
        self_confidence=None,
        is_grounded=True,
        sentinel_present=False,
        abstained=False,
    )


def _run_handle_request():
    """Drive the real ``handle_request`` far enough to emit chatqna.orchestrate.

    The emission site is inside that function's ``with`` block, so a test that
    called a helper instead would stay green with the site deleted -- which is
    how this span family went unstamped in the first place. The request is
    served by the ``reranker_input_too_long`` branch: the megaservice raises a
    typed marker, chatqna returns an abstention, and the orchestrate span opens
    and closes normally on the way.
    """

    async def _raise_marker(*_args, **_kwargs):
        raise chatqna_module._RerankerInputTooLongError("TEI rejected input")

    svc = create_chatqna_service()
    svc.user_profile_client = MagicMock()
    svc.user_profile_client.get_user_profile = AsyncMock(return_value={})
    svc.megaservice.schedule = _raise_marker

    req = create_mock_request(
        data=create_mock_chat_request_data(messages=[{"role": "user", "content": "what is X?"}]),
        headers={"Authorization": "Bearer dummy.jwt.token"},
    )
    with (
        patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "test-user"})),
        patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms),
        patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms),
        _patched_chat_request(stream=False),
    ):
        asyncio.run(svc.handle_request(req))


class TestQueryIdFromBaggage:
    def test_returns_none_without_baggage(self):
        assert query_id_from_baggage() is None

    def test_returns_value_when_present(self):
        token = _attach_baggage({QUERY_ID_KEY: "abc123"})
        try:
            assert query_id_from_baggage() == "abc123"
        finally:
            otel_context.detach(token)

    def test_absent_key_returns_none(self):
        token = _attach_baggage({"other.key": "abc"})
        try:
            assert query_id_from_baggage() is None
        finally:
            otel_context.detach(token)


class TestChatqnaStamping:
    def test_carries_the_query_id(self, captured_spans):
        token = _attach_baggage({QUERY_ID_KEY: "query-key-1"})
        try:
            chatqna_module._emit_reranker_selection_span(["k1"], ["k1"], [0.9])
        finally:
            otel_context.detach(token)
        (span,) = captured_spans("chatqna.reranker_selection")
        assert span.attributes[QUERY_ID_KEY] == "query-key-1"

    def test_omits_the_query_id_without_baggage(self, captured_spans):
        chatqna_module._emit_reranker_selection_span(["k1"], ["k1"], [0.9])
        (span,) = captured_spans("chatqna.reranker_selection")
        assert QUERY_ID_KEY not in span.attributes

    def test_stream_outcome_carries_the_query_id(self, captured_spans):
        token = _attach_baggage({QUERY_ID_KEY: "query-key-4"})
        try:
            _emit_outcome_span()
        finally:
            otel_context.detach(token)
        (span,) = captured_spans("chatqna.stream_outcome")
        assert span.attributes[QUERY_ID_KEY] == "query-key-4"

    def test_stream_outcome_omits_the_query_id_without_baggage(self, captured_spans):
        _emit_outcome_span()
        (span,) = captured_spans("chatqna.stream_outcome")
        assert QUERY_ID_KEY not in span.attributes

    def test_orchestrate_carries_the_query_id(self, captured_spans):
        token = _attach_baggage({QUERY_ID_KEY: "query-key-2"})
        try:
            _run_handle_request()
        finally:
            otel_context.detach(token)
        (span,) = captured_spans("chatqna.orchestrate")
        assert span.attributes[QUERY_ID_KEY] == "query-key-2"

    def test_orchestrate_omits_the_query_id_without_baggage(self, captured_spans):
        _run_handle_request()
        (span,) = captured_spans("chatqna.orchestrate")
        assert QUERY_ID_KEY not in span.attributes


# ---------------------------------------------------------------------------
# Retriever
# ---------------------------------------------------------------------------
#
# These two tests drive the REAL ``GenieaiArangoRetriever.invoke``. A test that
# only called a helper would stay green if the emission site were deleted from
# invoke, which is the defect class this whole change exists to prevent.
#
# Two adaptations from the plan's sketch were required, both verified against
# the source rather than guessed:
#
#   * the class is ``GenieaiArangoRetriever(name, description, config=None)`` —
#     not ``ArangoDB(host=..., port=...)``, and ``_initialize_client`` /
#     ``_initialize_llm`` must be patched out or construction opens a real
#     ArangoDB connection;
#   * there is no ``self.search`` to stub. The run instead stops at the first
#     ArangoDB call invoke makes, ``self.db.has_graph(...)``, whose False return
#     is a normal ``return []`` — so the span still finishes cleanly through
#     the ``finally: span.end()`` at the end of invoke and no exception path is
#     involved.
#
# The request object is a real pydantic model carrying the fields invoke reads.
# It cannot be ``comps.cores.proto.genieai_api_protocol.RetrievalRequestArangoDB``
# because conftest replaces the ``comps.cores.proto`` package with a MagicMock: the
# attribute imports fine, it resolves to a MagicMock, and a MagicMock is not a
# usable type to construct a request from.


class _RetrievalRequest(BaseModel):
    text: str
    k: int = 3
    embedding: list | None = None
    graph_name: str = "GRAPH"
    search_start: str = "chunk"
    search_mode: str = "vector"
    num_centroids: int = 1
    context: dict | None = None


@pytest.fixture
def retriever_span():
    """Return a callable that invokes the real retriever once.

    It is a callable, not a value, on purpose: the attribute is read at span
    open time, so the invocation has to happen INSIDE whatever baggage context
    the caller has attached. A fixture that invoked eagerly would always run
    before the test body attaches anything.
    """
    with (
        patch.object(retriever_module.GenieaiArangoRetriever, "_initialize_client"),
        patch.object(retriever_module.GenieaiArangoRetriever, "_initialize_llm"),
    ):
        service = retriever_module.GenieaiArangoRetriever(name="t", description="d")
    db = MagicMock()
    db.has_graph.return_value = False
    service.db = db

    def _run():
        return asyncio.run(service.invoke(_RetrievalRequest(text="q")))

    return _run


class TestRetrieverStamping:
    def test_carries_the_query_id(self, retriever_span, captured_spans):
        token = _attach_baggage({QUERY_ID_KEY: "query-key-9"})
        try:
            retriever_span()
        finally:
            otel_context.detach(token)
        (span,) = captured_spans("retriever.hybrid_search")
        assert span.attributes[QUERY_ID_KEY] == "query-key-9"

    def test_omits_the_query_id_without_baggage(self, retriever_span, captured_spans):
        retriever_span()
        (span,) = captured_spans("retriever.hybrid_search")
        assert QUERY_ID_KEY not in span.attributes


# ---------------------------------------------------------------------------
# Reranker
# ---------------------------------------------------------------------------
#
# Same rule as the retriever: drive the real GenieTEIReranking.invoke so deleting
# the emission site turns this red. Only the outbound TEI HTTP call is stubbed.


class TestRerankerStamping:
    """``SearchedDoc`` is a MagicMock in conftest, which makes ``isinstance``
    raise inside invoke. Swap it for a real type for the duration of the call,
    exactly as tests/test_reranker_tracing.py does."""

    @pytest.fixture(autouse=True)
    def _real_searched_doc(self):
        real = type("SearchedDoc", (), {})
        original = reranker_module.SearchedDoc
        reranker_module.SearchedDoc = real
        yield real
        reranker_module.SearchedDoc = original

    def _make_input(self):
        data = MagicMock(spec=["retrieved_docs", "initial_query"])
        data.retrieved_docs = [MagicMock(text="doc1"), MagicMock(text="doc2")]
        data.initial_query = "test query"
        data.model_dump = MagicMock(
            return_value={"reranking_strategy": "slice", "reranking_threshold": 0.75, "top_n": 3}
        )
        data.__class__ = reranker_module.SearchedDoc
        return data

    def _invoke(self):
        response = AsyncMock()
        response.json = AsyncMock(return_value=[{"index": 0, "score": 0.95}, {"index": 1, "score": 0.8}])
        response.status = 200
        response.__aenter__ = AsyncMock(return_value=response)
        response.__aexit__ = AsyncMock(return_value=False)
        session = AsyncMock()
        session.post = MagicMock(return_value=response)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch.object(reranker_module.aiohttp, "ClientSession", return_value=session):
            reranker = GenieTEIReranking.__new__(GenieTEIReranking)
            reranker.base_url = "http://tei-reranker:80"
            asyncio.run(reranker.invoke(self._make_input()))

    def test_carries_the_query_id(self, captured_spans):
        token = _attach_baggage({QUERY_ID_KEY: "query-key-3"})
        try:
            self._invoke()
        finally:
            otel_context.detach(token)
        (span,) = captured_spans("reranker.tei_invoke")
        assert span.attributes[QUERY_ID_KEY] == "query-key-3"

    def test_omits_the_query_id_without_baggage(self, captured_spans):
        self._invoke()
        (span,) = captured_spans("reranker.tei_invoke")
        assert QUERY_ID_KEY not in span.attributes
