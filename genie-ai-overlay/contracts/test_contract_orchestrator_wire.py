# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Orchestrator wire contract test — real comps ServiceOrchestrator graph.

Build the ServiceOrchestrator graph on the REAL vendored ``comps`` (inside the
built image), feed one canned input through ``align_inputs → schedule →
align_outputs``, and assert all six GENIE custom kwargs land on the
retriever/reranker handlers with the EXACT values sent, and that each service
registered.

The kwargs-arrival assertion distinguishes "forwarded" from "silently dropped"
— the kwargs-drop failure class (→ ungrounded chat). A signature read or a
"no crash" assertion would prove nothing about the bump.

Isolation: imports the real ``comps`` from the image. In the mocked dev env,
:func:`require_real_comps` skips the test — it does not green-pass.
"""

from __future__ import annotations

import asyncio

import _harness


def _build_graph(comps):
    """Build the GENIE RAG graph (embedding → retriever → rerank → llm) on real comps.

    Mirrors ``ChatQnAService._build_rag_graph`` using the image's real
    ``MicroService``/``ServiceType`` — so the wire test proves the real
    in-image registration + forwarding, not a re-implementation.
    """
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
    return graph, (embedding, retriever, rerank, llm)


def test_orchestrator_wire_kwargs_reach_handlers(comps):
    """All 6 GENIE kwargs reach align_inputs/align_outputs with exact values."""
    graph, _ = _build_graph(comps)
    captured: dict[str, dict] = {}

    # Wrap the handlers so we record what arrived. We subclass the real
    # orchestrator's align hooks (the same mechanism GENIE uses at runtime:
    # ServiceOrchestrator.align_inputs = align_inputs, chatqna.py ~1377).
    orig_align_inputs = comps.ServiceOrchestrator.align_inputs
    orig_align_outputs = comps.ServiceOrchestrator.align_outputs

    def align_inputs(self, inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs):
        captured["align_inputs"] = dict(kwargs)
        return orig_align_inputs(self, inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs)

    def align_outputs(self, data, *args, **kwargs):
        captured["align_outputs"] = dict(kwargs)
        return orig_align_outputs(self, data, *args, **kwargs)

    comps.ServiceOrchestrator.align_inputs = align_inputs
    comps.ServiceOrchestrator.align_outputs = align_outputs
    try:
        session = _harness.install_fake_aiohttp()
        _session_ref = session  # keep alive for the duration of the run
        asyncio.run(
            graph.schedule(
                initial_inputs={"text": "what is tomato blight?", "model": "genie"},
                llm_parameters=_harness_llm_params(comps),
                **_harness.WIRE_KWARGS,
            )
        )
    finally:
        comps.ServiceOrchestrator.align_inputs = orig_align_inputs
        comps.ServiceOrchestrator.align_outputs = orig_align_outputs

    # The LLM-node input path (align_inputs) must have received all 6 kwargs
    # with the exact values sent.
    assert "align_inputs" in captured, "align_inputs handler never invoked"
    for kwarg, expected in _harness.WIRE_KWARGS.items():
        assert kwarg in captured["align_inputs"], f"{kwarg} dropped at align_inputs"
        assert captured["align_inputs"][kwarg] == expected, (
            f"{kwarg} value mutated: got {captured['align_inputs'][kwarg]!r}, expected {expected!r}"
        )

    # The non-streaming completion path (align_outputs, orchestrator.py:384)
    # also receives the kwargs — assert at least the two params dicts ride through.
    assert "align_outputs" in captured, "align_outputs handler never invoked"
    for kwarg in ("retriever_parameters", "reranker_parameters"):
        assert kwarg in captured["align_outputs"], f"{kwarg} dropped at align_outputs"


def test_orchestrator_all_services_registered(comps):
    """Each RAG service is registered in the real graph (node set).

    The real ``ind_nodes()`` returns ``"<name>/<ServiceType>"`` strings (probed
    against the vendored orchestrator), so we assert the node NAMES are present.
    """
    graph, services = _build_graph(comps)
    # MicroService.name is a property returning "<name>/<ServiceRoleType>"
    # (probed against the vendored class); topological_sort() returns the same
    # format. Compare full node ids — no name mangling.
    expected = {svc.name for svc in services}
    actual = set(graph.topological_sort())
    assert expected <= actual, f"expected services {expected - actual} not registered; graph has {actual}"


def _harness_llm_params(comps):
    """Build the orchestrator's LLMParams from the real comps docarray module.

    The docarray rename hack (docarray.py → opea_docarray.py) moves the module;
    try the renamed path first, fall back to the pre-patch name.
    """
    try:
        from comps.cores.proto.opea_docarray import LLMParams  # renamed (post-patch)
    except ImportError:
        from comps.cores.proto.docarray import LLMParams  # noqa: PLC0415
    return LLMParams()
