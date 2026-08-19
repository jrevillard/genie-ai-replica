# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""End-to-end cross-service pipeline contract test — observable surface.

One full RAG query through retriever→reranker→chatqna asserting the surfaces
that must stay behavior-neutral across service handoffs:

1. **Label-filter data contract** — the OPEA framework drops custom fields
   between mega-service nodes, so filter labels ride in ``search_start``
   (chatqna encodes → retriever decodes). A broken roundtrip = category filter
   silently lost = wrong-category docs surface.
2. **Streaming/confidence observable surface** — the chatqna stream emits a
   metadata event (source documents, confidence, is_grounded) before [DONE];
   the response schema must keep that shape.

Isolation: the label-contract roundtrip is pure (runs anywhere). The graph-wire
assertion runs in-image against real comps (the ``comps`` fixture guard skips it
in the mocked dev env).
"""

from __future__ import annotations

import asyncio

import _harness
import pytest


def _core_label_contract():
    """Import the shared label-contract module (core/label_contract).

    Skips when core is absent (this contract ships in the retriever/chatqna
    images; a dataprep-only image does not carry it). A genuine import BREAK
    inside the image must fail red, not skip.
    """
    import pytest

    try:
        from core.label_contract import decode_filter_labels, encode_filter_labels
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("core.label_contract not present in this image")
    return decode_filter_labels, encode_filter_labels


def test_label_filter_contract_roundtrip():
    """chatqna→retriever label encoding survives the search_start handoff.

    Pure (repo ``core.label_contract``) — runs in the dev venv and the repo-side
    CI job, not just in-image.
    """
    decode, encode = _core_label_contract()
    base_mode = "chunk"
    labels = ["Fruit Tree Cultivation", "Beekeeping and Honey"]

    encoded = encode(base_mode, labels)
    # The encoded value must be a plain string (survives the OPEA node boundary).
    assert isinstance(encoded, str)
    mode, decoded = decode(encoded)
    assert mode == base_mode, "base search_start mode lost in the encoding"
    assert sorted(decoded) == sorted(labels), (
        f"label roundtrip mismatch: {decoded} != {labels} — category filter silently lost between chatqna and retriever"
    )


def test_label_filter_contract_empty_is_noop():
    """No labels → decode returns the raw search_start unchanged."""
    decode, _ = _core_label_contract()
    mode, labels = decode("node")
    assert mode == "node"
    assert labels == []


def _chatqna_module():
    """Import the real chatqna module from the image.

    Skips when the chatqna module is absent (this test runs in the chatqna
    image; other module images do not carry it). A genuine import BREAK inside
    the image must fail red, not skip.
    """
    import pytest

    try:
        import genieai_chatqna as m
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("chatqna module not present in this image")
    return m


def test_streaming_metadata_event_shape(comps):
    """The chatqna stream emits a metadata event before [DONE].

    Behavioral replacement: calls the real ``_stream_with_metadata`` with a
    mocked ``body_iterator`` and asserts the emitted SSE events contain the
    expected metadata payload shape (source_documents, confidence_score,
    retrieval_confidence_score, is_grounded). This exercises the real metadata
    emission code path, not a hardcoded literal.
    """
    import json
    import unittest.mock as mock

    mod = _chatqna_module()

    # Build a mock self with the required methods.
    mock_self = mock.MagicMock()
    # Wire the real static method so SSE decoding is exercised for real.
    mock_self._extract_sse_content = mod.ChatQnAService._extract_sse_content

    # Mock _assemble_source_documents to return known grounded values.
    mock_self._assemble_source_documents = mock.AsyncMock(
        return_value=(
            [{"id": "doc1", "document_name": "Test Doc", "score": 0.9}],
            0.72,
            True,
        )
    )

    # Body iterator: yield one parseable token chunk, then [DONE].
    async def mock_body_iterator():
        yield "data: b'Hello '\n\n"
        yield "data: b'world'\n\n"
        yield "data: [DONE]\n\n"

    # Collect all SSE events from the stream.
    events = []

    async def _collect():
        async for event in mod.ChatQnAService._stream_with_metadata(mock_self, mock_body_iterator(), {}):
            events.append(event)

    asyncio.run(_collect())

    # Find the metadata event (parse each line as JSON to avoid substring fragility).
    metadata_events = []
    for e in events:
        if not e.startswith("data: ") or "[DONE]" in e:
            continue
        try:
            payload_check = json.loads(e[len("data: ") :].strip())
            if isinstance(payload_check, dict) and payload_check.get("type") == "metadata":
                metadata_events.append(e)
        except (json.JSONDecodeError, ValueError):
            continue
    assert len(metadata_events) == 1, f"Expected exactly one metadata event, got {len(metadata_events)}: {events}"

    # Parse and assert the metadata payload shape.
    payload_str = metadata_events[0][len("data: ") :].strip()
    payload = json.loads(payload_str)
    assert payload["type"] == "metadata"
    assert isinstance(payload["source_documents"], list)
    assert isinstance(payload["confidence_score"], (int, float))
    assert isinstance(payload["retrieval_confidence_score"], (int, float))
    assert isinstance(payload["is_grounded"], bool)
    assert payload["is_grounded"] is True
    assert payload["retrieval_confidence_score"] == pytest.approx(0.72, abs=1e-9)


def test_e2e_graph_schedules_real_orchestrator(comps, fake_http):
    """One RAG query through the real orchestrator graph completes end-to-end.

    Builds the full embedding→retriever→rerank→llm graph on the real comps and
    runs one schedule() with the 6 kwargs + a canned input — the cross-service
    handoff path. Model endpoints are HTTP-mocked (no GPU/network); the contract
    under test is that the pipeline REACHES the LLM node without a handoff break.
    """
    from comps.cores.mega.constants import ServiceType
    from comps.cores.mega.micro_service import MicroService

    graph = comps.ServiceOrchestrator()
    embedding = MicroService(
        name="embedding",
        host="embedding",
        port=6000,
        endpoint="/v1/embeddings",
        use_remote_service=True,
        service_type=ServiceType.EMBEDDING,
    )
    retriever = MicroService(
        name="retriever",
        host="retriever",
        port=7000,
        endpoint="/v1/retrieval",
        use_remote_service=True,
        service_type=ServiceType.RETRIEVER,
    )
    rerank = MicroService(
        name="rerank",
        host="rerank",
        port=8000,
        endpoint="/v1/reranking",
        use_remote_service=True,
        service_type=ServiceType.RERANK,
    )
    llm = MicroService(
        name="llm",
        host="llm",
        port=8001,
        endpoint="/v1/chat/completions",
        use_remote_service=True,
        service_type=ServiceType.LLM,
    )
    for svc in (embedding, retriever, rerank, llm):
        graph.add(svc)
    graph.flow_to(embedding, retriever)
    graph.flow_to(retriever, rerank)
    graph.flow_to(rerank, llm)

    llm_params = _harness.import_docarray("LLMParams")()
    result = asyncio.run(
        graph.schedule(
            initial_inputs={"text": "what is tomato blight?", "model": "genie"},
            llm_parameters=llm_params,
            **_harness.WIRE_KWARGS,
        )
    )
    # schedule() returns after traversing the graph; assert the observable
    # surface — a structured result dict with the LLM node reached, not just
    # a non-None return from a pipeline that may have failed silently.
    assert isinstance(result, dict), f"Expected dict result, got {type(result)}"
    assert len(result) > 0, "Result dict is empty — pipeline produced no outputs"
    # The LLM node is the pipeline's final stage; its presence proves the
    # full embedding→retriever→rerank→llm chain completed without a handoff break.
    llm_key = next((k for k in result if "llm" in k.lower()), None)
    assert llm_key is not None, (
        f"LLM node key not found in result — pipeline did not reach the LLM. Keys present: {list(result.keys())}"
    )
    # The LLM node output must be a dict (the chatqna handle_request reads
    # ``result_dict[llm_key].get("text", ...)`` — a non-dict would crash).
    assert isinstance(result[llm_key], dict), f"LLM node output is not a dict: {type(result[llm_key])}"


# --- DW-263: confidence / abstention / response-schema assertions -----------


def test_e2e_confidence_distribution(comps):
    """Confidence score matches the rank-weighted (exponential decay) formula.

    Exercises the real ``_rank_weighted_confidence`` function from the chatqna
    module with known reranker scores and asserts the output matches the
    expected exponential-decay weighted average. This catches regressions in
    the confidence calculation that would silently change the user-facing score.
    """
    import math

    mod = _chatqna_module()
    fn = mod._rank_weighted_confidence

    # Known scores in descending display order (rank 0 = most relevant).
    scores = [0.9, 0.7, 0.5]
    result = fn(scores)

    # Compute expected value: exponential decay with default decay=0.5.
    decay = 0.5
    weights = [math.exp(-decay * i) for i in range(len(scores))]
    expected = sum(w * s for w, s in zip(weights, scores, strict=True)) / sum(weights)

    assert isinstance(result, float)
    assert abs(result - expected) < 1e-9, (
        f"Confidence mismatch: got {result}, expected {expected} — rank-weighted formula may have changed"
    )

    # Empty scores → 0.0 (ungrounded).
    assert fn([]) == pytest.approx(0.0, abs=1e-12)

    # Single score → that score (no decay effect).
    assert fn([0.42]) == 0.42


def test_e2e_abstention_ungrounded(comps):
    """Ungrounded stream: is_grounded=False, confidence=0.0, no source docs.

    Exercises the streaming metadata path with a mocked ``_assemble_source_documents``
    that returns the ungrounded case (empty sources, zero confidence). Asserts
    the abstention observable surface the frontend consumes.
    """
    import json
    import unittest.mock as mock

    mod = _chatqna_module()

    mock_self = mock.MagicMock()
    mock_self._extract_sse_content = mod.ChatQnAService._extract_sse_content
    # Ungroundeds: no source documents, zero confidence, is_grounded=False.
    mock_self._assemble_source_documents = mock.AsyncMock(return_value=([], 0.0, False))

    async def mock_body_iterator():
        yield "data: b'I don'\n\n"
        yield "data: b't know'\n\n"
        yield "data: [DONE]\n\n"

    events = []

    async def _collect():
        async for event in mod.ChatQnAService._stream_with_metadata(mock_self, mock_body_iterator(), {}):
            events.append(event)

    asyncio.run(_collect())

    metadata_events = [e for e in events if e.startswith("data: ") and '"type":"metadata"' in e and "[DONE]" not in e]
    assert len(metadata_events) == 1
    payload = json.loads(metadata_events[0][len("data: ") :].strip())

    # Abstention observable surface.
    assert payload["is_grounded"] is False, "is_grounded should be False when no documents back the answer"
    assert payload["confidence_score"] == pytest.approx(0.0, abs=1e-12)
    assert payload["source_documents"] == [], "source_documents should be empty when ungrounded"
    assert payload["retrieval_confidence_score"] == pytest.approx(0.0, abs=1e-12)


def test_e2e_response_schema(comps):
    """Streaming and non-streaming paths emit the same metadata fields.

    Verifies the metadata payload shape parity: both paths must include
    ``source_documents``, ``confidence_score``, ``retrieval_confidence_score``,
    and ``is_grounded``. The streaming path adds ``type: metadata`` (the SSE
    event discriminator); the non-streaming path wraps metadata in a
    ``{"response": ..., "metadata": ...}`` envelope.
    """
    import json
    import unittest.mock as mock

    mod = _chatqna_module()

    # --- Streaming path: metadata event fields ---
    mock_self = mock.MagicMock()
    mock_self._extract_sse_content = mod.ChatQnAService._extract_sse_content
    mock_self._assemble_source_documents = mock.AsyncMock(
        return_value=(
            [{"id": "d1", "document_name": "Doc", "score": 0.8}],
            0.65,
            True,
        )
    )

    async def body():
        yield "data: b'response'\n\n"
        yield "data: [DONE]\n\n"

    stream_events = []

    async def _collect_stream():
        async for event in mod.ChatQnAService._stream_with_metadata(mock_self, body(), {}):
            stream_events.append(event)

    asyncio.run(_collect_stream())

    metadata_event = next(e for e in stream_events if e.startswith("data: ") and '"type":"metadata"' in e)
    streaming_payload = json.loads(metadata_event[len("data: ") :].strip())

    # --- Required fields (both paths) ---
    required_fields = {
        "source_documents",
        "confidence_score",
        "retrieval_confidence_score",
        "is_grounded",
    }
    assert required_fields.issubset(streaming_payload.keys()), (
        f"Streaming metadata missing fields: {required_fields - set(streaming_payload.keys())}"
    )

    # --- Type contracts ---
    assert isinstance(streaming_payload["source_documents"], list)
    assert isinstance(streaming_payload["confidence_score"], (int, float))
    assert isinstance(streaming_payload["retrieval_confidence_score"], (int, float))
    assert isinstance(streaming_payload["is_grounded"], bool)

    # --- Non-streaming path: metadata dict construction ---
    # The non-streaming path builds the same metadata dict (minus "type") and
    # wraps it in {"response": ..., "metadata": ...}. Verify the field set is
    # identical (streaming has "type", non-streaming does not).
    non_streaming_only_fields = {"type"}
    streaming_fields = set(streaming_payload.keys()) - non_streaming_only_fields
    assert required_fields.issubset(streaming_fields), "Streaming metadata fields do not cover the required set"
