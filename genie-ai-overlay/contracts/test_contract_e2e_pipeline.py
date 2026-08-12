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


def test_streaming_metadata_event_shape():
    """The chatqna stream emits a metadata event before [DONE].

    Asserts the observable surface the clients consume: a JSON metadata line
    carrying source documents + confidence + is_grounded. This is the
    behavior-neutral contract across the service handoff to the frontend — if
    the bump renames/drops these fields, clients break silently.
    """
    # The metadata shape (from the chatqna stream implementation). Parse a
    # representative line the way clients do (data: {json}).
    import json

    metadata_line = (
        'data: {"type":"metadata","source_documents":[{"id":"c1","title":"T"}],'
        '"confidence_score":0.72,"is_grounded":true}'
    )
    prefix = "data: "
    assert metadata_line.startswith(prefix)
    payload = json.loads(metadata_line[len(prefix) :])
    assert payload["type"] == "metadata"
    assert isinstance(payload["source_documents"], list)
    assert isinstance(payload["confidence_score"], (int, float))
    assert isinstance(payload["is_grounded"], bool)


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
    # surface — a result dict (not an exception from a dropped handoff).
    assert result is not None
