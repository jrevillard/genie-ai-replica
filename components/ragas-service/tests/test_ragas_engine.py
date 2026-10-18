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

# Import the engine FIRST: applying its langchain_community.vertexai stub is
# what makes `import ragas` succeed at all on this stack (ragas <0.5 eagerly
# imports the module that langchain-community 0.4.x removed). Importing it
# here also lets this file run standalone, not only after test_app.py has
# imported app -> ragas_engine.
import ragas_engine  # noqa: E402 — must precede the ragas import below

pytest.importorskip("ragas", reason="ragas stack not installed")


@pytest.fixture()
def engine_env(monkeypatch):
    monkeypatch.setenv("RAGAS_JUDGE_BASE_URL", "http://localhost:1/v1")
    monkeypatch.setenv("RAGAS_JUDGE_MODEL", "test-model")
    monkeypatch.setenv("RAGAS_EMBED_MODEL", "test-embed")


def test_generate_testset_passes_num_personas_to_generate(monkeypatch, engine_env):
    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda: object())

    seen = {}

    class _Testset:
        samples = []

    def fake_generate(self, **kwargs):
        seen.update(kwargs)
        return _Testset()

    def fake_apply_transforms(kg, transforms, run_config=None):
        seen["kg_nodes"] = len(kg.nodes)
        seen["node_lengths"] = [len(n.properties.get("page_content") or "") for n in kg.nodes]

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    # generate_testset builds its transform list via the engine's own
    # _build_testset_transforms (an explicit mirror of ragas 0.4.3
    # default_transforms) — stub it here; the sequence itself is pinned by
    # test_transform_sequence_matches_ragas_default_plus_seeder.
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])
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


def test_generate_testset_caps_concept_text_for_the_kg(monkeypatch, engine_env):
    """The relationship builder joins PAIRS of node contents — a repo with
    concepts near the 200k-char corpus cap overflowed the judge's 65536-token
    window and killed the job (live bug #7). The KG input must be capped."""
    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda: object())

    seen = {}

    class _Testset:
        samples = []

    def fake_generate(self, **kwargs):
        return _Testset()

    def fake_apply_transforms(kg, transforms, run_config=None):
        seen["node_lengths"] = [len(n.properties.get("page_content") or "") for n in kg.nodes]

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])
    import ragas.testset.transforms as transforms_module

    monkeypatch.setattr(transforms_module, "apply_transforms", fake_apply_transforms)

    import asyncio

    # auto (default) on the 65536-token local window: pair-safe derivation
    # (65536-2048-1024)/2 * 4 = 124928 chars, clamped by the 48000 ceiling
    asyncio.run(
        ragas_engine.generate_testset(
            [
                {"page_content": "x" * 500000, "metadata": {"repo_id": "r"}},
                {"page_content": "y" * 10000, "metadata": {"repo_id": "r"}},
            ],
            testset_size=2,
        )
    )
    assert seen["node_lengths"] == [48000, 10000]  # capped, not passed through

    # a small judge window SHRINKS the cap below the ceiling (8192-token model)
    monkeypatch.setenv("RAGAS_JUDGE_CONTEXT_TOKENS", "8192")
    asyncio.run(
        ragas_engine.generate_testset(
            [{"page_content": "z" * 50000, "metadata": {"repo_id": "r"}}],
            testset_size=1,
        )
    )
    assert seen["node_lengths"] == [10240]  # (8192-3072)/2 * 4

    # an explicit cap number wins over the derivation
    monkeypatch.delenv("RAGAS_JUDGE_CONTEXT_TOKENS")
    monkeypatch.setenv("RAGAS_DOC_CHAR_CAP", "12000")
    asyncio.run(
        ragas_engine.generate_testset(
            [{"page_content": "w" * 50000, "metadata": {"repo_id": "r"}}],
            testset_size=1,
        )
    )
    assert seen["node_lengths"] == [12000]

    # 0/off disables the cap (operator escape hatch)
    monkeypatch.setenv("RAGAS_DOC_CHAR_CAP", "0")
    asyncio.run(
        ragas_engine.generate_testset(
            [{"page_content": "v" * 50000, "metadata": {"repo_id": "r"}}],
            testset_size=1,
        )
    )
    assert seen["node_lengths"] == [50000]


def test_generate_testset_seeds_missing_headlines_before_splitter(monkeypatch, engine_env):
    """Regression (live 2026-10-18): ragas 0.4.3's default long-doc chain sets
    'headlines' only on DOCUMENT nodes over 500 tokens, but HeadlineSplitter
    hard-requires it on EVERY node — one shorter concept killed the whole
    suite generation with ValueError: 'headlines' property not found in this
    node'. The engine's explicit chain seeds headlines=[] where missing; []
    is the splitter's own keep-whole semantic, so real splitting still
    happens for docs whose headlines were extracted."""
    import asyncio

    from ragas.testset import TestsetGenerator
    from ragas.testset.transforms import HeadlineSplitter
    from ragas.testset.transforms import filters as tr_filters
    from ragas.testset.transforms.default import default_transforms
    from ragas.testset.transforms.extractors import llm_based as xtract

    class _FakeEmbedder:
        async def embed_text(self, _text):
            return [0.1, 0.2]

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda: _FakeEmbedder())

    # Stub every LLM touchpoint in the chain (prompts are patched at the
    # CLASS level — each extractor instance builds its own prompt object).
    async def fake_headlines(self, llm, data, **kwargs):
        return xtract.Headlines(headlines=["MIDSECTION"])

    async def fake_summary(self, llm, data, **kwargs):
        return xtract.StringIO(text="summary text")

    async def fake_themes(self, llm, data, **kwargs):
        return xtract.ThemesAndConcepts(output=["theme"])

    async def fake_ner(self, llm, data, **kwargs):
        return xtract.NEROutput(entities=["entity"])

    async def fake_score(self, data, llm, **kwargs):
        return tr_filters.QuestionPotentialOutput(score=5)  # 5 > min_score -> node kept

    monkeypatch.setattr(xtract.HeadlinesExtractorPrompt, "generate", fake_headlines)
    monkeypatch.setattr(xtract.SummaryExtractorPrompt, "generate", fake_summary)
    monkeypatch.setattr(xtract.ThemesAndConceptsExtractorPrompt, "generate", fake_themes)
    monkeypatch.setattr(xtract.NERPrompt, "generate", fake_ner)
    monkeypatch.setattr(tr_filters.QuestionPotentialPrompt, "generate", fake_score)

    # Record what the splitter is handed — every node must carry headlines.
    seen_by_splitter = []
    real_split = HeadlineSplitter.split

    async def recording_split(self, node):
        seen_by_splitter.append(node.get_property("headlines"))
        return await real_split(self, node)

    monkeypatch.setattr(HeadlineSplitter, "split", recording_split)

    out = {}

    class _Testset:
        samples = []

    def fake_generate(self, **kwargs):
        out["chunk_nodes"] = sum(1 for n in self.knowledge_graph.nodes if n.type.name == "CHUNK")
        return _Testset()

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)

    # mixed lengths: ~1200-token doc containing the mocked headline (both
    # halves clear the splitter's 500-token min, so it splits into 2 chunks),
    # ~700-token doc whose text lacks that headline (kept whole), and a
    # 16-token concept the extractor's >500-token filter skips entirely — the
    # node class that crashed the live run.
    documents = [
        {"page_content": ("concept " * 600) + "MIDSECTION " + ("detail " * 600), "metadata": {"repo_id": "r"}},
        {"page_content": "gamma " * 700, "metadata": {"repo_id": "r"}},
        {"page_content": "tiny word here " * 5, "metadata": {"repo_id": "r"}},
    ]

    result = asyncio.run(ragas_engine.generate_testset(documents, testset_size=2))
    assert result["samples"] == []
    # the splitter saw all 3 DOCUMENT nodes, each carrying headlines — the
    # short one via the seeded []
    assert len(seen_by_splitter) == 3
    assert all(h is not None for h in seen_by_splitter)
    assert seen_by_splitter.count([]) == 1  # exactly the short doc was seeded
    # real splitting still worked: the first doc produced 2 CHUNK nodes and
    # the pipeline ran through the whole chain to generation
    assert out["chunk_nodes"] == 2

    # Control — the library's own default list (the pre-fix code path) still
    # crashes on the same input: the live bug this fix removes.
    with monkeypatch.context() as m:
        m.setattr(
            ragas_engine,
            "_build_testset_transforms",
            lambda documents, llm, embedding_model: default_transforms(
                documents=documents, llm=llm, embedding_model=embedding_model
            ),
        )
        with pytest.raises(ValueError, match="'headlines' property not found"):
            asyncio.run(ragas_engine.generate_testset(documents, testset_size=2))


def test_transform_sequence_matches_ragas_default_plus_seeder():
    """The explicit chain must be exactly ragas 0.4.3 default_transforms()
    with ONE insertion (the headlines seeder, long-doc branch only). If a
    ragas upgrade reorders or renames the defaults, this fails loudly
    instead of our mirror drifting silently out of sync with the library."""
    from langchain_core.documents import Document as LCDocument
    from ragas.testset.transforms.default import default_transforms

    def describe(transforms):
        out = []
        for t in transforms:
            if type(t).__name__ == "Parallel":
                out.append(("Parallel", [type(x).__name__ for x in t.transformations]))
            else:
                out.append(type(t).__name__)
        return out

    def build(docs):
        return ragas_engine._build_testset_transforms(documents=docs, llm=object(), embedding_model=object())

    long_docs = [LCDocument(page_content="word " * 600) for _ in range(4)]  # 601 tokens each
    medium_docs = [LCDocument(page_content="gamma " * 300) for _ in range(4)]  # 301 tokens each
    short_docs = [LCDocument(page_content="tiny word here " * 5) for _ in range(4)]  # 16 tokens each

    expected_long = [
        "HeadlinesExtractor",
        "_HeadlinesSeeder",
        "HeadlineSplitter",
        "SummaryExtractor",
        "CustomNodeFilter",
        ("Parallel", ["EmbeddingExtractor", "ThemesExtractor", "NERExtractor"]),
        ("Parallel", ["CosineSimilarityBuilder", "OverlapScoreBuilder"]),
    ]
    mine = build(long_docs)
    assert describe(mine) == expected_long
    # parity with the library default: identical once the seeder is removed
    assert describe(default_transforms(documents=long_docs, llm=object(), embedding_model=object())) == [
        step for step in expected_long if step != "_HeadlinesSeeder"
    ]
    assert mine[2].min_tokens == 500  # default.py:90
    assert mine[6].transformations[0].threshold == 0.7  # default.py:112

    expected_medium = [
        "SummaryExtractor",
        "CustomNodeFilter",
        ("Parallel", ["EmbeddingExtractor", "ThemesExtractor", "NERExtractor"]),
        ("Parallel", ["CosineSimilarityBuilder", "OverlapScoreBuilder"]),
    ]
    assert describe(build(medium_docs)) == expected_medium
    assert (
        describe(default_transforms(documents=medium_docs, llm=object(), embedding_model=object())) == expected_medium
    )
    assert build(medium_docs)[3].transformations[0].threshold == 0.5  # default.py:146

    # all-short input: the same hard refusal as the library default (default.py:162-165)
    with pytest.raises(ValueError, match="too short"):
        build(short_docs)
    with pytest.raises(ValueError, match="too short"):
        default_transforms(documents=short_docs, llm=object(), embedding_model=object())


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
