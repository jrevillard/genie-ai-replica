# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Engine tests against the REAL ragas 0.4.3 (the venv pins it): the
generate path's call shape (num_personas must reach generate() — the
live-caught drift) and the metric registry's column-name contract.

Network-free: the ragas collaborators are monkeypatched at their modules;
build_llm/build_embeddings are stubbed in ragas_engine.
"""

from __future__ import annotations

import pytest

pytest.importorskip("ragas", reason="ragas stack not installed")


@pytest.fixture()
def engine_env(monkeypatch):
    monkeypatch.setenv("RAGAS_JUDGE_BASE_URL", "http://localhost:1/v1")
    monkeypatch.setenv("RAGAS_JUDGE_MODEL", "test-model")
    monkeypatch.setenv("RAGAS_EMBED_MODEL", "test-embed")


def test_generate_testset_passes_num_personas_to_generate(monkeypatch, engine_env):
    from ragas.testset import TestsetGenerator
    from ragas.testset import transforms as tr

    import ragas_engine

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda: object())

    seen = {}

    class _Testset:
        samples = []

    def fake_generate(self, **kwargs):
        seen.update(kwargs)
        return _Testset()

    def fake_default_transforms(**_kwargs):
        return object()

    def fake_apply_transforms(kg, transforms, run_config=None):
        seen["kg_nodes"] = len(kg.nodes)

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    monkeypatch.setattr(tr, "default_transforms", fake_default_transforms)
    # ragas_engine imports apply_transforms INSIDE the function — patch the
    # module it resolves from.
    import ragas.testset.transforms as transforms_module

    monkeypatch.setattr(transforms_module, "apply_transforms", fake_apply_transforms)

    import asyncio

    out = asyncio.run(
        ragas_engine.generate_testset(
            [{"page_content": "body", "metadata": {"repo_id": "r"}}],
            testset_size=5,
            num_personas=7,
        )
    )
    assert seen["num_personas"] == 7
    assert seen["testset_size"] == 5
    assert seen["kg_nodes"] == 1  # one DOCUMENT node per concept
    assert out["samples"] == []


def test_metric_registry_names_are_the_report_columns(engine_env):
    import ragas_engine

    reg = ragas_engine.metric_registry()
    assert set(reg) == {
        "faithfulness",
        "context_precision",
        "context_recall",
        "answer_relevancy",
        "context_utilization",
        "context_entities_recall",
        "factual_correctness",
        "answer_correctness",
        "answer_similarity",
        "noise_sensitivity",
    }
    for key, metric in reg.items():
        assert metric.name == key  # report columns keyed exactly


def test_resolve_metrics_drops_embedding_metrics_without_embedder(monkeypatch, engine_env):
    import ragas_engine

    monkeypatch.delenv("RAGAS_EMBED_MODEL")
    metrics, dropped = ragas_engine.resolve_metrics(["faithfulness", "answer_relevancy", "answer_similarity"])
    assert [m.name for m in metrics] == ["faithfulness"]
    assert set(dropped) == {"answer_relevancy", "answer_similarity"}


def test_resolve_metrics_rejects_unknown(engine_env):
    import ragas_engine

    with pytest.raises(ValueError, match="unknown metrics"):
        ragas_engine.resolve_metrics(["not_a_metric"])


def test_build_embeddings_defaults_to_the_tei_dialect(monkeypatch, engine_env):
    import ragas_engine

    emb = ragas_engine.build_embeddings()
    inner = getattr(emb, "embeddings", None) or getattr(emb, "langchain_embeddings", emb)
    assert isinstance(inner, ragas_engine._TeiEmbeddings)


def test_tei_embeddings_posts_the_native_contract(monkeypatch, engine_env):
    import ragas_engine

    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return [[0.1, 0.2], [0.3, 0.4]]

    def fake_post(url, json=None, headers=None, verify=None, timeout=None):
        captured.update({"url": url, "json": json, "headers": headers})
        return _Resp()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)
    tei = ragas_engine._TeiEmbeddings("http://tei:80/", "tok", "bge")
    vecs = tei.embed_documents(["a", "b"])
    assert vecs == [[0.1, 0.2], [0.3, 0.4]]
    assert captured["url"] == "http://tei:80/embed"
    assert captured["json"] == {"inputs": ["a", "b"], "truncate": True}
    assert captured["headers"]["Authorization"] == "Bearer tok"
    assert tei.embed_query("q") == [0.1, 0.2]

    # ragas's async paths (KG transforms, metric chains) call aembed_* —
    # the class must expose them (live bug #6).
    import asyncio

    assert asyncio.run(tei.aembed_documents(["a"])) == [[0.1, 0.2], [0.3, 0.4]]
    assert asyncio.run(tei.aembed_query("q")) == [0.1, 0.2]


def test_build_embeddings_openai_dialect(monkeypatch, engine_env):
    import ragas_engine

    monkeypatch.setenv("RAGAS_EMBED_API", "openai")
    emb = ragas_engine.build_embeddings()
    inner = getattr(emb, "embeddings", None) or getattr(emb, "langchain_embeddings", emb)
    assert type(inner).__name__ == "OpenAIEmbeddings"
