# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""NFR-P coarse budget contract tests — wire latency + ingest wall-clock.

Coarse WALL-CLOCK budgets on HTTP-mocked runs (no GPU, no live services). They
bound pipeline overhead (serialization, orchestrator hops, telemetry), NOT model
latency. A 10× regression fails the gate; a 2× does not — the budgets are loose
by design so the gate catches real regressions, not noise.

The wire budget reuses the orchestrator wire-through (same graph as the wire
test, timing the full schedule → execute → align path). The ingest budget is
the one-doc chunker run (same as the ingest smoke, timing the chunker).

Isolation: runs in-image against real comps (the wire budget needs the real
orchestrator). In the mocked dev env the wire-budget test skips via the
``comps`` fixture; the budget-table assertions run anywhere.
"""

from __future__ import annotations

import asyncio
import time

import _harness


def _build_graph(comps):
    from comps.cores.mega.constants import ServiceType
    from comps.cores.mega.micro_service import MicroService

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
    graph = comps.ServiceOrchestrator()
    for svc in (embedding, retriever, rerank, llm):
        graph.add(svc)
    graph.flow_to(embedding, retriever)
    graph.flow_to(retriever, rerank)
    graph.flow_to(rerank, llm)
    return graph


def _llm_params():
    """Build the orchestrator's LLMParams from the post-rename docarray module."""
    return _harness.import_docarray("LLMParams")()


def _dataprep_instance(monkeypatch):
    import pytest

    try:
        import comps.dataprep.src.integrations.genieai_dataprep_arangodb as m
        from comps.dataprep.src.integrations.genieai_dataprep_arangodb import (
            GenieArangoDataprep,
        )
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("dataprep module not present in this image")

    # Production extraction method; monkeypatch auto-restores it after the test.
    monkeypatch.setattr(m, "CONTENT_EXTRACTION_METHOD", "docling")
    return GenieArangoDataprep.__new__(GenieArangoDataprep)


def test_wire_latency_within_budget(comps, fake_http):
    """One orchestrator wire-through completes within the coarse latency budget."""
    graph = _build_graph(comps)
    budget = _harness.budget("wire_latency_seconds")
    start = time.monotonic()
    asyncio.run(
        asyncio.wait_for(
            graph.schedule(
                initial_inputs={"text": "hello", "model": "m"},
                llm_parameters=_llm_params(),
                **_harness.WIRE_KWARGS,
            ),
            timeout=budget,
        )
    )
    elapsed = time.monotonic() - start
    assert elapsed <= budget, f"wire-through took {elapsed:.2f}s, budget {budget}s"


def test_ingest_wall_clock_within_budget(comps, tmp_path, monkeypatch):
    """One-doc chunking (real docling) completes within the coarse ingest budget."""
    doc_file = tmp_path / "tomato.md"
    doc_file.write_text(
        "# Tomato Blight\n\nTomato blight is a fungal disease.\n\n## Symptoms\n"
        "Dark lesions appear.\n\n## Prevention\nCrop rotation helps.\n",
        encoding="utf-8",
    )
    doc_path = _harness.import_docarray("DocPath")(
        path=str(doc_file),
        chunk_size=1500,
        chunk_overlap=100,
        process_table=False,
        table_strategy="fast",
    )
    dataprep = _dataprep_instance(monkeypatch)
    budget = _harness.budget("ingest_wall_clock_seconds")
    start = time.monotonic()
    chunks = asyncio.run(asyncio.wait_for(dataprep._load_and_chunk(doc_path), timeout=budget))
    elapsed = time.monotonic() - start
    assert chunks, "chunker returned no chunks"
    assert elapsed <= budget, f"one-doc ingest took {elapsed:.2f}s, budget {budget}s"


def test_budget_table_present():
    """The budget table is defined and positive (pure — runs in dev venv)."""
    for label, value in _harness.NFRP_BUDGETS.items():
        assert value > 0, label
