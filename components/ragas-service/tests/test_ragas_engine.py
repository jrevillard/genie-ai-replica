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


class _StubSample:
    user_input = "what is the answer?"
    reference = "the answer"
    reference_contexts = ["ctx"]
    persona_name = "persona"
    query_style = "formal"
    query_length = "short"


class _StubTS:
    def __init__(self, sample=None):
        s = sample if sample is not None else _StubSample()
        self.eval_sample = s
        self.synthesizer_name = "stub_synth"
        self.persona_name = ""
        self.query_style = ""
        self.query_length = ""


def _testset_with(*samples):
    return type("_Testset", (), {"samples": list(samples)})()


class _StubSynth:
    """Inner synthesizer stand-in: name + optional spies on its methods."""

    name = "stub_synth"

    def __init__(self, fail_sample=False, fail_scenarios=False):
        self.fail_sample = fail_sample
        self.fail_scenarios = fail_scenarios
        self.sample_calls = 0
        self.scenario_calls = 0

    async def generate_sample(self, scenario, callbacks=None):
        self.sample_calls += 1
        if self.fail_sample:
            raise ValueError("simulated synthesis failure")
        return _StubSample()

    async def generate_scenarios(self, n, knowledge_graph, persona_list, callbacks=None):
        self.scenario_calls += 1
        if self.fail_scenarios:
            raise ValueError("simulated scenario failure")
        return [object()] * n


def _stub_default_distribution(monkeypatch, stub=None):
    """The engine builds ragas's DEFAULT distribution itself (so the default
    mix gets the _TolerantSynthesizer protection) — replace it with a stub
    so generate-path tests exercise our code, not the library's KG
    clustering on a transforms-stubbed graph."""
    import ragas.testset.synthesizers as synth_mod

    stub = stub or _StubSynth()
    monkeypatch.setattr(synth_mod, "default_query_distribution", lambda llm, kg, llm_context=None: [(stub, 1.0)])
    return stub


def test_generate_testset_passes_num_personas_to_generate(monkeypatch, engine_env):
    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0, judge=None: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())

    seen = {}

    def fake_generate(self, **kwargs):
        seen.update(kwargs)
        return _testset_with(_StubTS())

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
    _stub_default_distribution(monkeypatch)

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
    # the distribution handed to generate() is the tolerant-wrapped stub —
    # the wrapping is the bug-#9 fix (executor must never see a raise)
    dist, _w = seen["query_distribution"][0]
    assert isinstance(dist, ragas_engine._TolerantSynthesizer)
    assert dist.name == "stub_synth"
    assert out["samples"][0]["user_input"] == "what is the answer?"


def test_generate_testset_caps_concept_text_for_the_kg(monkeypatch, engine_env):
    """The relationship builder joins PAIRS of node contents — a repo with
    concepts near the 200k-char corpus cap overflowed the judge's 65536-token
    window and killed the job (live bug #7). The KG input must be capped."""
    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0, judge=None: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())

    seen = {}

    def fake_generate(self, **kwargs):
        return _testset_with(_StubTS())

    def fake_apply_transforms(kg, transforms, run_config=None):
        seen["node_lengths"] = [len(n.properties.get("page_content") or "") for n in kg.nodes]

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])
    import ragas.testset.transforms as transforms_module

    monkeypatch.setattr(transforms_module, "apply_transforms", fake_apply_transforms)
    _stub_default_distribution(monkeypatch)

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

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0, judge=None: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: _FakeEmbedder())

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

    def fake_generate(self, **kwargs):
        out["chunk_nodes"] = sum(1 for n in self.knowledge_graph.nodes if n.type.name == "CHUNK")
        return _testset_with(_StubTS())

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    _stub_default_distribution(monkeypatch)

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
    assert len(result["samples"]) == 1  # the stub's one synthesized question
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


def test_build_llm_constructs_the_real_caching_wrapper(monkeypatch, engine_env):
    """Regression (live 2026-10-18): subclassing ragas.llms.LangchainLLMWrapper
    exploded at class-definition time — that name is a DeprecationHelper shim,
    not a class ("DeprecationHelper.__init__() takes 3 positional arguments
    but 4 were given") — and every /evaluate job died. Construction against
    the REAL ragas classes must work end-to-end (no network — clients are
    created but unused)."""
    w = ragas_engine.build_llm(temperature=0.0)
    assert hasattr(w, "generate_text") and hasattr(w, "agenerate_text")
    from ragas.llms.base import BaseRagasLLM

    assert isinstance(w, BaseRagasLLM)  # set_run_config etc. keep flowing


def test_caching_wrapper_serves_hits_without_calling_the_judge(tmp_path, monkeypatch):
    """The cache exists because repeat generations re-paid the whole KG
    phase: 5 questions over 2 small repos = ~211 transform calls ≈ 8 min
    (live 2026-10-18). A hit must NOT touch the judge, and must rebuild a
    result whose .text consumers (ragas prompts) read identically."""
    import asyncio

    calls = {"sync": 0, "async": 0}

    class _FakeResult:
        def __init__(self, text):
            self.generations = [[type("G", (), {"text": text})()]]
            self.llm_output = {"model_name": "test"}

    class _FakeBase:
        def __init__(self, llm):
            self.llm = llm

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["sync"] += 1
            return _FakeResult(f"judge-sync-{calls['sync']}")

        async def agenerate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["async"] += 1
            return _FakeResult(f"judge-async-{calls['async']}")

    class _Prompt:
        def to_string(self):
            return "the same prompt text"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)
    w = wrapper_cls(object())

    r1 = w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert r1.generations[0][0].text == "judge-sync-1"  # passthrough of the real result
    r2 = w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert calls["sync"] == 1  # hit — the judge was NOT called again
    assert r2.generations[0][0].text == "judge-sync-1"  # rebuilt from cache, same text

    a1 = asyncio.run(w.agenerate_text(_Prompt(), n=1, temperature=0.2))
    assert calls["async"] == 0  # the sync call's cache serves the async path too
    assert a1.generations[0][0].text == "judge-sync-1"

    # a different temperature is a different key — judge called again
    r3 = w.generate_text(_Prompt(), n=1, temperature=0.9)
    assert calls["sync"] == 2
    assert r3.generations[0][0].text == "judge-sync-2"

    # RAGAS_LLM_CACHE=0 bypasses entirely
    monkeypatch.setenv("RAGAS_LLM_CACHE", "0")
    w_off = wrapper_cls(object())
    w_off.generate_text(_Prompt(), n=1, temperature=0.2)
    w_off.generate_text(_Prompt(), n=1, temperature=0.2)
    assert calls["sync"] == 4  # both went through


def test_tolerant_synthesizer_never_raises_to_the_executor(engine_env):
    """Regression (live 2026-10-18, bug #9): with raise_exceptions=False,
    ragas's Executor turns a raised call into np.nan (executor.py:84) and
    generate.py:610 feeds that nan to TestsetSample — pydantic rejects it
    and ONE failed question kills the whole run ("2 validation errors for
    TestsetSample ... input_value=nan"). The wrapper must convert failures
    into valid droppable results so the executor never sees an exception."""
    import asyncio
    import threading

    failing = _StubSynth(fail_sample=True, fail_scenarios=True)
    wrapped = ragas_engine._TolerantSynthesizer(failing)

    sample = asyncio.run(wrapped.generate_sample(scenario=object()))
    assert getattr(sample, "user_input", None) == ""  # valid-but-droppable, NOT a raise
    assert failing.sample_calls == 1  # the inner was really attempted

    scenarios = asyncio.run(wrapped.generate_scenarios(n=3, knowledge_graph=object(), persona_list=[]))
    assert scenarios == []  # a failed batch drops its questions, not the run
    assert wrapped.name == "stub_synth"

    # n-cap enforcement (live 2026-10-18: 391 samples submitted for a
    # 5-question suite — per-node scenario overshoot, ~30 min of GPU burn)
    overshoot = _StubSynth()

    async def many_scenarios(n, knowledge_graph, persona_list, callbacks=None):
        return [object()] * (65 * n + 1)

    overshoot.generate_scenarios = many_scenarios
    capped = ragas_engine._TolerantSynthesizer(overshoot)
    out = asyncio.run(capped.generate_scenarios(n=2, knowledge_graph=object(), persona_list=[]))
    assert len(out) == 2

    # cancellation seam: once the event is set, remaining calls return
    # instantly WITHOUT touching the judge
    cancelled_inner = _StubSynth()
    cancel_event = threading.Event()
    cancel_event.set()
    wrapped_cancelled = ragas_engine._TolerantSynthesizer(cancelled_inner, cancel_event)
    s = asyncio.run(wrapped_cancelled.generate_sample(scenario=object()))
    assert getattr(s, "user_input", None) == ""
    assert cancelled_inner.sample_calls == 0
    assert asyncio.run(wrapped_cancelled.generate_scenarios(n=5, knowledge_graph=object(), persona_list=[])) == []
    assert cancelled_inner.scenario_calls == 0


def test_generate_testset_filters_dropped_samples(monkeypatch, engine_env):
    """A partially-failing synthesis shrinks the suite instead of crashing:
    empty user_input rows (the tolerant wrapper's placeholders) are counted
    in `dropped` and never shipped."""
    import asyncio

    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0, judge=None: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])
    import ragas.testset.transforms as transforms_module

    monkeypatch.setattr(transforms_module, "apply_transforms", lambda kg, transforms, run_config=None: None)
    _stub_default_distribution(monkeypatch)

    empty = type("E", (), {"user_input": "", "reference": None, "reference_contexts": None})()
    blank = type("B", (), {"user_input": "   ", "reference": None, "reference_contexts": None})()

    def fake_generate(self, **kwargs):
        return _testset_with(_StubTS(), _StubTS(empty), _StubTS(blank))

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    out = asyncio.run(ragas_engine.generate_testset([{"page_content": "b", "metadata": {}}], testset_size=3))
    assert len(out["samples"]) == 1
    assert out["dropped"] == 2

    # the shipped count never exceeds the request, whatever the split
    # arithmetic produced (ceil can round 5 up to 6 across synthesizers)
    def fake_generate_many(self, **kwargs):
        return _testset_with(_StubTS(), _StubTS(), _StubTS())

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate_many)
    out2 = asyncio.run(ragas_engine.generate_testset([{"page_content": "b", "metadata": {}}], testset_size=2))
    assert len(out2["samples"]) == 2
    assert out2["dropped"] == 1  # the third valid sample was capped away


def test_generate_testset_all_dropped_raises_an_honest_error(monkeypatch, engine_env):
    import asyncio

    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0, judge=None: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])
    import ragas.testset.transforms as transforms_module

    monkeypatch.setattr(transforms_module, "apply_transforms", lambda kg, transforms, run_config=None: None)
    _stub_default_distribution(monkeypatch)

    empty = type("E", (), {"user_input": "", "reference": None, "reference_contexts": None})()

    def fake_generate(self, **kwargs):
        return _testset_with(_StubTS(empty), _StubTS(empty))

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    with pytest.raises(RuntimeError, match="no questions could be synthesized"):
        asyncio.run(ragas_engine.generate_testset([{"page_content": "b", "metadata": {}}], testset_size=2))


def test_generate_testset_cancel_beats_partial_results(monkeypatch, engine_env):
    """If the user cancels while synthesis is finishing, the job reports
    cancelled — partial samples are never shipped as a surprise result."""
    import asyncio
    import threading

    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0, judge=None: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])
    import ragas.testset.transforms as transforms_module

    monkeypatch.setattr(transforms_module, "apply_transforms", lambda kg, transforms, run_config=None: None)
    _stub_default_distribution(monkeypatch)

    cancel_event = threading.Event()

    def fake_generate(self, **kwargs):
        cancel_event.set()  # cancelled mid-run, after some samples exist
        return _testset_with(_StubTS())

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    with pytest.raises(ragas_engine.EngineCancelled):
        asyncio.run(
            ragas_engine.generate_testset(
                [{"page_content": "b", "metadata": {}}], testset_size=1, cancel_event=cancel_event
            )
        )


def test_resolve_distribution_wraps_both_paths(monkeypatch, engine_env):
    """Both the DEFAULT mix and user-specified synthesizers get the
    _TolerantSynthesizer protection — the default path is where the live
    bug-#9 crash ran."""
    import ragas.testset.synthesizers as synth_mod

    stub = _stub_default_distribution(monkeypatch)
    dist = ragas_engine._resolve_distribution(None, llm=object(), kg=object())
    assert isinstance(dist[0][0], ragas_engine._TolerantSynthesizer)
    assert dist[0][0]._inner is stub
    assert dist[0][1] == 1.0

    # user-specified path: stub the three classes the factory imports
    class _UserSynth:
        def __init__(self, llm=None):
            self.name = "user_synth"

    for cls_name in (
        "SingleHopSpecificQuerySynthesizer",
        "MultiHopAbstractQuerySynthesizer",
        "MultiHopSpecificQuerySynthesizer",
    ):
        monkeypatch.setattr(synth_mod, cls_name, _UserSynth)
    dist2 = ragas_engine._resolve_distribution([{"synthesizer": "multi_hop_abstract", "weight": 0.7}], llm=object())
    assert isinstance(dist2[0][0], ragas_engine._TolerantSynthesizer)
    assert dist2[0][0].name == "user_synth"
    assert dist2[0][1] == 0.7


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


def test_evaluate_batches_rows_and_reports_progress(monkeypatch, engine_env):
    """Row-batched evaluation (2026-10-18: per-phase progress bars): each
    batch produces a done/total progress tick, per_query merges across
    batches in order, and cancel between batches aborts honestly."""
    import asyncio
    import threading

    import ragas as ragas_mod

    monkeypatch.setattr(ragas_engine, "build_llm", lambda temperature=0.0, judge=None: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setenv("RAGAS_EVAL_BATCH_ROWS", "2")

    class _M:
        name = "faithfulness"

    class _Frame:
        def __init__(self, rows):
            self._rows = rows

        def iterrows(self):
            return iter(enumerate(self._rows))

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def to_pandas(self):
            return _Frame(self._rows)

    def fake_evaluate(dataset, metrics, llm, embeddings, run_config, show_progress, raise_exceptions):
        rows = [
            {
                "user_input": s.user_input,
                "retrieved_contexts": list(s.retrieved_contexts or []),
                "response": s.response or "",
                "reference": s.reference or "",
            }
            for s in dataset.samples
        ]
        return _Result(
            [
                {
                    "user_input": r["user_input"],
                    "retrieved_contexts": r["retrieved_contexts"],
                    "response": r["response"],
                    "reference": r["reference"],
                    "faithfulness": 1.0,
                }
                for r in rows
            ]
        )

    monkeypatch.setattr(ragas_mod, "evaluate", fake_evaluate)
    monkeypatch.setattr(ragas_engine, "resolve_metrics", lambda metrics: ([_M()], []))

    ticks = []

    def progress(phase, done=None, total=None):
        ticks.append((phase, done, total))

    samples = [
        {"user_input": f"q{i}", "response": "a", "reference": "r", "retrieved_contexts": ["c"]} for i in range(5)
    ]
    out = asyncio.run(ragas_engine.evaluate_samples(samples, ["faithfulness"], progress=progress))
    assert [t[1] for t in ticks] == [None, 2, 4, 5]  # phase announce, then batch boundaries 2/5 -> 4/5 -> 5/5
    assert ticks[1][2] == 5  # the first batch tick carries the row total
    assert len(out["per_query"]) == 5
    assert out["per_query"][0]["user_input"] == "q0" and out["per_query"][4]["user_input"] == "q4"
    assert out["aggregate"]["faithfulness"] == 1.0

    # cancel between batches: the tick after the first batch flips the event
    ev = threading.Event()

    def progress_cancel(phase, done=None, total=None):
        if done is not None and done >= 2:
            ev.set()

    with pytest.raises(ragas_engine.EngineCancelled):
        asyncio.run(
            ragas_engine.evaluate_samples(samples[:4], ["faithfulness"], progress=progress_cancel, cancel_event=ev)
        )
