# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The TEI adapters' bearer path: a configured credential rides the request
as an Authorization header; an internal TEI (no credential) sends none. The
V08 venue answers 401 without the header — a regression that drops the
credential from ``SearchKnowledgeCapability.create``'s wiring must turn
these red (issue #2167)."""

import asyncio

import httpx

from capabilities.adapters.env_config import RerankingConfig
from capabilities.adapters.tei_embedding import TeiEmbeddingAdapter
from capabilities.adapters.tei_reranking import TeiRerankingAdapter


def _capture_transport(captured: list, response_body) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request.headers.get("authorization"))
        return httpx.Response(200, json=response_body)

    return httpx.MockTransport(handler)


def _reranking_config() -> RerankingConfig:
    return RerankingConfig(
        strategy="slice",
        threshold=0.75,
        top_n=1,
        calibration="none",
        temperature=1.0,
        rerank_timeout_seconds=300.0,
        connect_timeout_seconds=30.0,
    )


def test_embedding_adapter_sends_bearer_only_when_configured():
    captured: list = []
    transport = _capture_transport(captured, [[0.1, 0.2, 0.3]])
    adapter = TeiEmbeddingAdapter("https://tei.invalid/embed", transport=transport, bearer="tok-1")
    asyncio.run(adapter.embed("hello"))
    assert captured == ["Bearer tok-1"]

    captured.clear()
    bare = TeiEmbeddingAdapter("https://tei.invalid/embed", transport=transport, bearer="")
    asyncio.run(bare.embed("hello"))
    assert captured == [None]


def test_reranking_adapter_sends_bearer_only_when_configured():
    captured: list = []
    transport = _capture_transport(captured, [{"index": 0, "score": 0.9}])
    adapter = TeiRerankingAdapter("https://tei.invalid", _reranking_config(), transport=transport, bearer="tok-1")
    asyncio.run(adapter.rerank("q", ["t"]))
    assert captured == ["Bearer tok-1"]

    captured.clear()
    bare = TeiRerankingAdapter("https://tei.invalid", _reranking_config(), transport=transport, bearer="")
    asyncio.run(bare.rerank("q", ["t"]))
    assert captured == [None]


def test_create_wires_the_deployment_bearer_into_both_adapters(monkeypatch):
    """The capability assembly passes the deployment's credential to BOTH
    adapters — dropping `bearer=endpoints.bearer` from one create() branch
    is exactly the regression this catches (the adapter-level tests above
    pin the header behavior; this one pins the wiring)."""
    from capabilities.search_knowledge import SearchKnowledgeCapability

    monkeypatch.setattr(
        "arango.ArangoClient",
        lambda hosts: type("C", (), {"db": lambda self, *a, **k: None})(),
    )
    env = {
        "ARANGO_URL": "http://localhost:8529",
        "TEI_EMBEDDING_ENDPOINT": "https://tei.invalid/embed",
        "TEI_RERANKING_ENDPOINT": "https://tei.invalid",
        "VLLM_API_KEY": "deployment-key",
    }
    capability = SearchKnowledgeCapability.create(env)
    assert capability._embedding._bearer == "deployment-key"
    assert capability._reranking._bearer == "deployment-key"
