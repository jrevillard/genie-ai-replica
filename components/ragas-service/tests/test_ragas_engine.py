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

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
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


def test_generation_progress_calls_match_the_app_tracker_contract(monkeypatch, engine_env):
    """Every progress call the engine makes must be ACCEPTED by the app's
    tracker (app._phase_tracker -> _update). The engine grew a `calls` kwarg
    on 2026-10-21 (the always-advancing LLM-call count) and a signature
    drift here would break the job poll at runtime — a TypeError inside the
    progress callback would take the whole generation down.

    It also pins that the synthesis phase reports the count: the sample
    count only moves when a sample RESOLVES, so the call count is what
    proves the phase is alive.
    """
    import asyncio
    import inspect

    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])

    def fake_generate(self, **kwargs):
        return _testset_with(_StubTS())

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    import ragas.testset.transforms as transforms_module

    monkeypatch.setattr(transforms_module, "apply_transforms", lambda kg, transforms, run_config=None: None)
    _stub_default_distribution(monkeypatch)

    calls = []

    def progress(phase, done=None, total=None, **kwargs):
        calls.append((phase, done, total, kwargs))

    asyncio.run(
        ragas_engine.generate_testset(
            [{"page_content": "body", "metadata": {"repo_id": "r"}}],
            testset_size=2,
            progress=progress,
        )
    )
    assert calls, "the generation reported no progress at all"

    import app as app_module

    tracker = app_module._phase_tracker("job-contract")
    accepted = set(inspect.signature(tracker).parameters) - {"job_id"}
    for phase, done, total, kwargs in calls:
        assert set(kwargs) <= accepted, f"phase {phase} sends unknown kwargs {set(kwargs) - accepted}"
        # the tracker must survive the call it is handed
        tracker(phase, done, total, **kwargs)

    synthesis = [c for c in calls if c[0] == "synthesizing-questions"]
    assert synthesis, "the synthesis phase reported nothing"
    assert any("calls" in c[3] for c in synthesis), "the synthesis phase carries no call count"
    # the replay count rides the same contract (2026-10-26): a phase that
    # reports work must also report how much of it the cache answered.
    assert any("replays" in c[3] for c in synthesis), "the synthesis phase carries no replay count"


def test_the_knowledge_graph_ticker_reports_both_counts(monkeypatch, engine_env):
    """2026-10-26: the KG ticker's progress call is wrapped in a bare
    `except Exception: pass` — an unknown kwarg would be swallowed and the
    phase would report NOTHING (the frozen-progress bug of 2026-10-21)
    instead of failing loudly. This drives the ticker for real and pins
    that the call it makes carries the call count AND the replay count, and
    that the app's tracker accepts them."""

    import asyncio
    import contextlib
    import io
    import time

    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])

    def fake_generate(self, **kwargs):
        return _testset_with(_StubTS())

    monkeypatch.setattr(TestsetGenerator, "generate", fake_generate)
    import ragas.testset.transforms as transforms_module

    # the ticker only reports while a transform bar is open, and it ticks
    # once a second — the transform must therefore outlive one tick.
    def slow_transforms(kg, transforms, run_config=None):
        time.sleep(2.0)

    monkeypatch.setattr(transforms_module, "apply_transforms", slow_transforms)
    _stub_default_distribution(monkeypatch)

    ragas_engine._hook_tqdm()
    from tqdm import tqdm

    calls = []

    def progress(phase, done=None, total=None, **kwargs):
        calls.append((phase, done, total, kwargs))

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        bars = [tqdm(total=100, desc="Applying TestAggregate", disable=False)]
        bars[0].update(1)
        try:
            asyncio.run(
                ragas_engine.generate_testset(
                    [{"page_content": "body", "metadata": {"repo_id": "r"}}],
                    testset_size=2,
                    progress=progress,
                )
            )
        finally:
            for b in bars:
                b.close()

    kg = [c for c in calls if c[0] == "building-knowledge-graph"]
    assert kg, "the knowledge-graph phase reported nothing — the ticker never fired"
    assert any("calls" in c[3] for c in kg), "the KG ticker carries no call count"
    assert any("replays" in c[3] for c in kg), "the KG ticker carries no replay count"

    import app as app_module

    tracker = app_module._phase_tracker("job-kg-ticker")
    for phase, done, total, kwargs in calls:
        tracker(phase, done, total, **kwargs)  # the tracker must survive it


def test_generate_testset_caps_concept_text_for_the_kg(monkeypatch, engine_env):
    """The relationship builder joins PAIRS of node contents — a repo with
    concepts near the 200k-char corpus cap overflowed the judge's 65536-token
    window and killed the job (live bug #7). The KG input must be capped."""
    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
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

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
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


def test_build_llm_judge_override_base_gets_the_version_segment_rule(monkeypatch, engine_env):
    """Review F15 (2026-10-21): ChatOpenAI appends only /chat/completions, so a
    version-LESS override base judged against a URL missing /v1 — the ping and
    the answer legs (okf-server's shared llm-url rule) worked while every
    judge call 404'd. Same rule here: bare host gets /v1, versioned base
    (…/v1, z.ai's …/paas/v4) keeps its segment."""
    captured = {}

    class _FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    import langchain_openai as lco

    monkeypatch.setattr(lco, "ChatOpenAI", _FakeChatOpenAI)

    ragas_engine.build_llm(judge={"provider": "openai", "base_url": "http://vllm:8000", "model": "m", "api_key": "k"})
    assert captured["base_url"] == "http://vllm:8000/v1"

    captured.clear()
    zai_override = {
        "provider": "openai",
        "base_url": "https://api.z.ai/api/coding/paas/v4",
        "model": "glm-5.3",
        "api_key": "k",
    }
    ragas_engine.build_llm(judge=zai_override)
    assert captured["base_url"] == "https://api.z.ai/api/coding/paas/v4"


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


def test_legacy_cache_entries_are_replayed_only_when_asked_and_migrate(monkeypatch, tmp_path):
    """2026-10-21: the judge identity in the cache key now carries the
    ENDPOINT as well as the model, so a repointed judge can never replay
    another endpoint's answers. The price is a cold cache — and the entries
    the previous key wrote become unreachable.

    RAGAS_LLM_CACHE_LEGACY=1 is the operator's explicit acknowledgement that
    the endpoint has NOT changed: each read then falls back to the legacy key
    and MIGRATES the entry to the new key (the cache heals itself). OFF by
    default — replaying an answer from an endpoint we cannot vouch for is
    exactly the bug the new key fixed.
    """
    import json

    class _Gen:
        def __init__(self, text):
            self.text = text

    class _Res:
        def __init__(self, text):
            self.generations = [[_Gen(text)]]
            self.llm_output = None

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            return _Res("fresh")

    class _Prompt:
        def to_string(self):
            return "the same prompt text"

    cache_dir = tmp_path / "cache"
    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(cache_dir))
    monkeypatch.setenv("RAGAS_JUDGE_MODEL", "granite-test")
    monkeypatch.setenv("RAGAS_JUDGE_BASE_URL", "https://judge.example/llm/v1")
    monkeypatch.setenv("RAGAS_LLM_CACHE_LEGACY", "0")

    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)

    # Write an entry under the LEGACY key (the model alone), the way the
    # pre-2026-10-21 deployment wrote it.
    legacy_wrapper = ragas_engine._make_caching_wrapper(_FakeBase, model_tag=None)(object())
    legacy_tag = "granite-test"  # the old env-path tag: the model alone
    legacy_key = legacy_wrapper._key(_Prompt(), 1, 0.2, None, tag=legacy_tag)
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / f"{legacy_key}.json").write_text(
        json.dumps({"texts": ["legacy-answer"], "llm_output": {"model_name": "granite-test"}}),
        encoding="utf-8",
    )

    # 1. OFF (default): the legacy entry is invisible — the judge is called.
    # (A different temperature = a different key, so this call cannot
    # populate the key the legacy check below reads.)
    w = wrapper_cls(object())
    out = w.generate_text(_Prompt(), n=1, temperature=0.3)
    assert out.generations[0][0].text == "fresh"
    assert not (cache_dir / f"{legacy_key}.json.tmp").exists()

    # 2. ON: the legacy entry is replayed AND migrated to the new key.
    monkeypatch.setenv("RAGAS_LLM_CACHE_LEGACY", "1")
    w2 = wrapper_cls(object())
    out2 = w2.generate_text(_Prompt(), n=1, temperature=0.2)
    assert out2.generations[0][0].text == "legacy-answer"  # replayed, judge NOT called
    new_key = w2._key(_Prompt(), 1, 0.2, None)
    assert new_key != legacy_key
    migrated = json.loads((cache_dir / f"{new_key}.json").read_text(encoding="utf-8"))
    assert migrated["texts"] == ["legacy-answer"]  # migrated on read

    # 3. The migrated entry is a plain hit afterwards — the cache healed.
    out3 = w2.generate_text(_Prompt(), n=1, temperature=0.2)
    assert out3.generations[0][0].text == "legacy-answer"


def test_a_dropped_connection_is_retried_like_a_rate_limit(monkeypatch, tmp_path):
    """Live 2026-10-22: the El Salvador re-run died at 74 minutes — one node
    of the last transform — because z.ai's nginx closed a keep-alive
    connection mid-request ("Server disconnected without sending a
    response"). A transport failure is TRANSIENT: it must be retried with
    jitter like a 429, not end the run."""
    import asyncio

    calls = {"sync": 0, "async": 0}

    class RemoteProtocolError(Exception):
        """httpx's own class: the server closed the connection without a
        response — the exact live failure (z.ai's nginx, 2026-10-22)."""

        status_code = None

    class _Gen:
        def __init__(self, text):
            self.text = text

    class _Res:
        def __init__(self, text):
            self.generations = [[_Gen(text)]]
            self.llm_output = None

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["sync"] += 1
            if calls["sync"] < 3:
                raise RemoteProtocolError("Server disconnected without sending a response")
            return _Res("kept")

        async def agenerate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["async"] += 1
            if calls["async"] < 3:
                raise RemoteProtocolError("Server disconnected without sending a response")
            return _Res("kept-async")

    class _Prompt:
        def to_string(self):
            return "p"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("RAGAS_JUDGE_MODEL", "granite-test")
    monkeypatch.setenv("RAGAS_JUDGE_BASE_URL", "https://judge.example/llm/v1")
    monkeypatch.setenv("RAGAS_LLM_MAX_RETRIES", "5")
    monkeypatch.setattr(ragas_engine, "_backoff_seconds", lambda err, attempt: 0.0)

    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)
    w = wrapper_cls(object())

    out = w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert out.generations[0][0].text == "kept"
    assert calls["sync"] == 3  # two dropped connections, then the success

    out_async = asyncio.run(w.agenerate_text(_Prompt(), n=1, temperature=0.3))
    assert out_async.generations[0][0].text == "kept-async"
    assert calls["async"] == 3


def test_the_knowledge_graph_degrades_a_dead_node_instead_of_dying(monkeypatch, tmp_path):
    """One node's judge call must not destroy an hour of judge calls: the KG
    phase tolerates the failure (empty extraction for THAT node), counts it
    and keeps going. The evaluation phase does NOT tolerate — a judge
    failure there must fail the run, not be quietly averaged away."""
    calls = {"n": 0}

    class _Boom(Exception):
        status_code = 500

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["n"] += 1
            raise _Boom("upstream is down")

    class _Prompt:
        def to_string(self):
            return "p"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("RAGAS_LLM_MAX_RETRIES", "0")
    ragas_engine._reset_kg_failures()

    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase, tolerate_failures=True)
    tolerant = wrapper_cls(object())
    out = tolerant.generate_text(_Prompt(), n=1, temperature=0.2)
    assert out.generations[0][0].text == ""  # degraded, not fatal
    assert ragas_engine._kg_failures() == {"_Boom": 1}

    # the strict path (the evaluation phase) still fails the run
    strict = ragas_engine._make_caching_wrapper(_FakeBase)(object())
    with pytest.raises(_Boom):
        strict.generate_text(_Prompt(), n=1, temperature=0.3)
    ragas_engine._reset_kg_failures()


def test_rate_limited_judge_calls_are_retried_and_kept(monkeypatch, tmp_path):
    """Live 2026-10-21: MiniMax answered 82 of ~500 synthesis calls with
    429 Too Many Requests. The openai SDK's own retry has NO jitter, so the
    throttled batch came back as a synchronised herd, was throttled again,
    and 35 questions were DROPPED — the user received 63 of the 100
    questions they asked for, silently. The wrapper must retry a 429 (with
    jitter) and keep the question."""
    import asyncio

    calls = {"sync": 0, "async": 0}

    class _RateLimited(Exception):
        status_code = 429

    class _Gen:
        def __init__(self, text):
            self.text = text

    class _Res:
        def __init__(self, text):
            self.generations = [[_Gen(text)]]
            self.llm_output = None

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["sync"] += 1
            if calls["sync"] < 3:
                raise _RateLimited("429 Too Many Requests")
            return _Res("kept")

        async def agenerate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["async"] += 1
            if calls["async"] < 3:
                raise _RateLimited("429 Too Many Requests")
            return _Res("kept-async")

    class _Prompt:
        def to_string(self):
            return "p"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("RAGAS_JUDGE_MODEL", "granite-test")
    monkeypatch.setenv("RAGAS_JUDGE_BASE_URL", "https://judge.example/llm/v1")
    monkeypatch.setenv("RAGAS_LLM_MAX_RETRIES", "5")
    # no real sleeping in the test
    monkeypatch.setattr(ragas_engine, "_backoff_seconds", lambda err, attempt: 0.0)

    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)
    w = wrapper_cls(object())

    out = w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert out.generations[0][0].text == "kept"  # the question was KEPT
    assert calls["sync"] == 3  # two throttles, then the success

    out_async = asyncio.run(w.agenerate_text(_Prompt(), n=1, temperature=0.3))
    assert out_async.generations[0][0].text == "kept-async"
    assert calls["async"] == 3


def test_a_non_429_failure_is_not_retried(monkeypatch, tmp_path):
    """Only a rate limit is worth retrying — anything else is a real
    failure and must surface (retrying it would just burn the judge)."""

    calls = {"n": 0}

    class _Boom(Exception):
        status_code = 400

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["n"] += 1
            raise _Boom("bad request")

    class _Prompt:
        def to_string(self):
            return "p"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(ragas_engine, "_backoff_seconds", lambda err, attempt: 0.0)
    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)
    w = wrapper_cls(object())

    with pytest.raises(_Boom):
        w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert calls["n"] == 1  # NOT retried


def test_a_dropped_question_is_attributed_to_its_cause():
    """The suite must be able to say WHY a question was lost — 'rate_limited'
    is the cause an operator can act on."""

    class _RateLimited(Exception):
        status_code = 429

    class _Other(Exception):
        pass

    assert ragas_engine._classify_failure(_RateLimited("429")) == "rate_limited"
    assert ragas_engine._classify_failure(_Other("x")) == "_Other"

    ragas_engine._reset_synth_failures()
    ragas_engine._record_synth_failure("rate_limited")
    ragas_engine._record_synth_failure("rate_limited")
    assert ragas_engine._synth_failures() == {"rate_limited": 2}
    ragas_engine._reset_synth_failures()
    assert ragas_engine._synth_failures() == {}


def test_empty_completions_are_never_cached(monkeypatch, tmp_path):
    """2026-10-21 sidecar review F5: a 200 with an EMPTY body was written
    to the disk cache and replayed forever (no TTL, survives recreates) — one
    bad judge response permanently degraded every later generation with a
    correct-looking empty result. Blank text must not be cached."""
    import asyncio

    calls = {"n": 0}

    class _Gen:
        def __init__(self, text):
            self.text = text

    class _Res:
        def __init__(self, text):
            self.generations = [[_Gen(text)]]
            self.llm_output = None

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["n"] += 1
            return _Res("")

        async def agenerate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["n"] += 1
            return _Res("   ")

    class _Prompt:
        def to_string(self):
            return "the same prompt text"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)
    w = wrapper_cls(object())

    w.generate_text(_Prompt(), n=1, temperature=0.2)
    w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert calls["n"] == 2  # the empty answer was NOT cached — the judge was asked again

    asyncio.run(w.agenerate_text(_Prompt(), n=1, temperature=0.3))
    asyncio.run(w.agenerate_text(_Prompt(), n=1, temperature=0.3))
    assert calls["n"] == 4  # same for the async path


def test_cache_key_includes_the_judge_endpoint(monkeypatch, tmp_path):
    """2026-10-21 sidecar review F5: the env-path cache key carried the
    MODEL alone, so repointing RAGAS_JUDGE_BASE_URL while keeping the model
    id silently replayed the OLD endpoint's cached answers. The key must
    carry the endpoint too."""

    class _FakeBaseForTag:
        def __init__(self, *a, **k):
            pass

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("RAGAS_JUDGE_MODEL", "granite-x")

    def _key_for(base_url):
        monkeypatch.setenv("RAGAS_JUDGE_BASE_URL", base_url)
        w = ragas_engine._make_caching_wrapper(_FakeBaseForTag)(object())
        return w._model_tag

    assert _key_for("https://a.example/v1") != _key_for("https://b.example/v1")
    assert "a.example" in _key_for("https://a.example/v1")


def test_llm_call_counter_advances_with_the_work(monkeypatch, tmp_path):
    """2026-10-21 (live): the transform bar did NOT move during a 20-minute
    KG phase — the UI showed "Building the knowledge graph 0/1075" the whole
    time while the phase was demonstrably working. A progress number that
    never moves is worse than none. The judge wrapper is OURS, so it counts
    its own calls: a counter that always advances with the work."""

    calls = {"n": 0}

    class _Gen:
        def __init__(self, text):
            self.text = text

    class _Res:
        def __init__(self, text):
            self.generations = [[_Gen(text)]]
            self.llm_output = None

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["n"] += 1
            return _Res("answer")

    class _Prompt:
        def to_string(self):
            return "p"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    before = ragas_engine._llm_calls()
    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)
    w = wrapper_cls(object())
    w.generate_text(_Prompt(), n=1, temperature=0.2)
    w.generate_text(_Prompt(), n=1, temperature=0.3)
    assert ragas_engine._llm_calls() == before + 2
    assert calls["n"] == 2


def test_llm_call_counter_resets_per_phase():
    """2026-10-21: the sidecar serves many jobs in ONE interpreter — a
    process-cumulative count would jump when a new job starts, reading as
    progress that did not happen. The count is zeroed at the phase start."""
    before = ragas_engine._llm_calls()
    ragas_engine._count_llm_call(7)
    assert ragas_engine._llm_calls() == before + 7
    ragas_engine._reset_llm_calls()
    assert ragas_engine._llm_calls() == 0


def test_cache_hit_is_counted_as_a_replay_not_an_llm_call(monkeypatch, tmp_path):
    """2026-10-26 (live): the panel climbed to "673 LLM calls" while the
    remote GPU sat at 0 % — every one of those calls was answered from the
    on-disk cache. A replay is not an LLM call: it never reached the model.
    The two counts must be separate numbers."""
    hits = {"n": 0}

    class _Gen:
        def __init__(self, text):
            self.text = text

    class _Res:
        def __init__(self, text):
            self.generations = [[_Gen(text)]]
            self.llm_output = None

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            hits["n"] += 1
            return _Res("answer")

    class _Prompt:
        def to_string(self):
            return "p"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    calls_before = ragas_engine._llm_calls()
    replays_before = ragas_engine._cache_replays()
    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase)
    w = wrapper_cls(object())

    # FIRST call — a miss: the model is called.
    w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert ragas_engine._llm_calls() == calls_before + 1
    assert ragas_engine._cache_replays() == replays_before

    # SECOND call, same prompt — a HIT: the answer is on disk, the model is
    # NOT called. Counting it as an LLM call is what made a 0 % GPU look
    # like a broken benchmark.
    w.generate_text(_Prompt(), n=1, temperature=0.2)
    assert ragas_engine._llm_calls() == calls_before + 1  # unchanged
    assert ragas_engine._cache_replays() == replays_before + 1
    assert hits["n"] == 1  # the model was called ONCE


def test_the_replay_counter_resets_with_the_call_counter():
    """The replay count describes THIS phase, like the call count — a
    process-cumulative replay count reads as a jump when a new job starts."""
    ragas_engine._count_llm_call(3)
    ragas_engine._count_cache_replay(5)
    ragas_engine._reset_llm_calls()
    assert ragas_engine._llm_calls() == 0
    assert ragas_engine._cache_replays() == 0


def test_llm_call_stats_reports_both_counters():
    """The HTTP layer publishes both numbers so the panel can separate the
    calls that reached the model from the ones the cache answered."""
    ragas_engine._reset_llm_calls()
    ragas_engine._count_llm_call(2)
    ragas_engine._count_cache_replay(7)
    stats = ragas_engine.llm_call_stats()
    assert stats == {"calls": 2, "replays": 7}


def test_two_jobs_never_share_their_counters(monkeypatch, tmp_path):
    """2026-10-26 (review): the counters were process-global, so a second
    job's reset dropped the FIRST job's published number to zero
    mid-generation (the KG ticker republishes once a second) and then
    counted the second job's calls as the first's. Each job owns its
    counters."""
    calls = {"n": 0}

    class _Gen:
        def __init__(self, text):
            self.text = text

    class _Res:
        def __init__(self, text):
            self.generations = [[_Gen(text)]]
            self.llm_output = None

    class _FakeBase:
        def __init__(self, *a, **k):
            pass

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["n"] += 1
            return _Res("answer")

    class _Prompt:
        def to_string(self):
            return "p"

    monkeypatch.setenv("RAGAS_LLM_CACHE_DIR", str(tmp_path / "cache"))
    stats_a = {"calls": 0, "replays": 0}
    stats_b = {"calls": 0, "replays": 0}
    wrapper_cls = ragas_engine._make_caching_wrapper(_FakeBase, stats=stats_a)
    wrapper_cls_b = ragas_engine._make_caching_wrapper(_FakeBase, stats=stats_b)

    a = wrapper_cls(object())
    b = wrapper_cls_b(object())

    a.generate_text(_Prompt(), n=1, temperature=0.2)  # a miss -> a real call
    b.generate_text(_Prompt(), n=1, temperature=0.3)  # b's miss -> b's call
    a.generate_text(_Prompt(), n=1, temperature=0.2)  # a HIT -> a's replay

    assert stats_a == {"calls": 1, "replays": 1}
    assert stats_b == {"calls": 1, "replays": 0}
    # the model was called twice in total — once per job
    assert calls["n"] == 2


def test_a_node_that_cannot_be_parsed_does_not_kill_the_phase():
    """Live 2026-10-26: one chunk's NER answer came back as a JSON object
    where ragas's parser expects a plain string; the format-fix retry failed
    too, and the exception escaped apply_transforms and took a 137-minute
    generation with it. One node degrades; the phase continues."""
    import asyncio

    class _Boom:
        def generate_execution_plan(self, kg):
            async def boom():
                raise ValueError("Failed to parse StringIO from completion")

            return [boom()]

    ragas_engine._reset_kg_failures()
    t = ragas_engine._tolerate_node_failures(_Boom())
    coros = t.generate_execution_plan(None)

    async def _run():
        for c in coros:
            await c  # must NOT raise

    asyncio.run(_run())  # the exception is swallowed, not propagated
    failures = ragas_engine._kg_failures()
    assert failures, "the degraded node was not counted"
    assert any("_Boom" in reason for reason in failures), failures


def test_the_tolerance_wrapper_keeps_the_transforms_class():
    """ragas's apply_transforms dispatches on isinstance (Parallel,
    BaseGraphTransformation) — a proxy object would have been silently
    ignored, so the wrapper patches the INSTANCE and keeps its class."""
    from ragas.testset.transforms.extractors.llm_based import NERExtractor

    t = NERExtractor(llm=object())
    wrapped = ragas_engine._tolerate_node_failures(t)
    assert isinstance(wrapped, NERExtractor)
    assert wrapped is t


def test_progress_reader_aggregates_parallel_worker_bars(monkeypatch):
    """2026-10-21: with a 16-worker pool there is one bar PER WORKER, so
    "the newest open bar" is almost always a bar at n=0. The reader must
    SUM the counts of the workers of the same transform."""
    import contextlib
    import io

    ragas_engine._hook_tqdm()
    from tqdm import tqdm

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        bars = [tqdm(total=100, desc="Applying TestAggregate", disable=False) for _ in range(4)]
        for i, b in enumerate(bars):
            # Worker 0 is still at n=0 — the exact shape that made the UI
            # read "0/1075" while the pool was working.
            for _ in range(i):
                b.update(1)
    step = ragas_engine._current_tqdm_step()
    assert step is not None
    assert step["step"] == "Applying TestAggregate"
    # 0+1+2+3 = 6 across the four workers, against the per-bar total
    assert step["done"] == 6
    assert step["total"] == 100
    for b in bars:
        b.close()


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

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
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

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
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


def test_cancelled_generation_stops_the_kg_phase_within_one_llm_call(monkeypatch, engine_env):
    """2026-10-21 sidecar review F1 — the ZOMBIE: the KG phase runs
    apply_transforms as ONE uninterruptible thread (~200 LLM calls, no
    checkpoint between them), so a cancelled generation kept burning the
    judge for MINUTES after the user cancelled (live: the accidental
    Generate cancel left the sidecar working for 6 more minutes, and the
    okf-server poller read the job's disappearance as a sidecar restart).

    The judge wrapper now carries the cancel event, so the phase drains
    within ONE in-flight LLM call: EngineCancelled propagates out of the
    transform thread and the job lands 'cancelled'."""
    import asyncio
    import threading

    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setattr(ragas_engine, "_build_testset_transforms", lambda documents, llm, embedding_model: [])
    import ragas.testset.transforms as transforms_module

    cancel_event = threading.Event()
    calls = {"n": 0}

    class _CancellingLlm:
        """Stands in for the judge wrapper: it raises the way the real
        wrapper now does once the cancel event is set."""

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            calls["n"] += 1
            cancel_event.set()
            raise ragas_engine.EngineCancelled("cancelled by user")

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: _CancellingLlm())

    def fake_apply(kg, transforms, run_config=None):
        # The real transform loop calls the LLM repeatedly; one call that
        # raises must abort the phase.
        _CancellingLlm().generate_text("p")

    monkeypatch.setattr(transforms_module, "apply_transforms", fake_apply)
    _stub_default_distribution(monkeypatch)

    with pytest.raises(ragas_engine.EngineCancelled):
        asyncio.run(
            ragas_engine.generate_testset(
                [{"page_content": "b", "metadata": {}}], testset_size=1, cancel_event=cancel_event
            )
        )
    assert calls["n"] == 1  # ONE call — the phase stopped, it did not grind on


def test_generate_testset_cancel_beats_partial_results(monkeypatch, engine_env):
    """If the user cancels while synthesis is finishing, the job reports
    cancelled — partial samples are never shipped as a surprise result."""
    import asyncio
    import threading

    from ragas.testset import TestsetGenerator

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
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


def test_resolve_distribution_normalizes_percent_weights(monkeypatch, engine_env):
    """Live 2026-10-20: the panel's distribution inputs are 0-100 percents
    (50/25/25) and ragas's calculate_split_values does ceil(N x weight)
    with NO normalization — a 100-question run became 10,000 sample
    generations. Percent-style specs must be normalized to fractions;
    fraction-style specs pass through unchanged."""
    import ragas.testset.synthesizers as synth_mod

    class _UserSynth:
        def __init__(self, llm=None):
            self.name = "user_synth"

    for cls_name in (
        "SingleHopSpecificQuerySynthesizer",
        "MultiHopAbstractQuerySynthesizer",
        "MultiHopSpecificQuerySynthesizer",
    ):
        monkeypatch.setattr(synth_mod, cls_name, _UserSynth)

    # percent style — exactly what the panel sends for 50/25/25
    dist = ragas_engine._resolve_distribution(
        [
            {"synthesizer": "single_hop_specific", "weight": 50},
            {"synthesizer": "multi_hop_abstract", "weight": 25},
            {"synthesizer": "multi_hop_specific", "weight": 25},
        ],
        llm=object(),
    )
    assert [w for _, w in dist] == [0.5, 0.25, 0.25]
    # ragas's own split of ceil(N x w) now targets ~N, not ~100N
    import math

    splits = [math.ceil(100 * w) for _, w in dist]
    assert sum(splits) == 100

    # fraction style — unchanged
    dist2 = ragas_engine._resolve_distribution([{"synthesizer": "multi_hop_abstract", "weight": 0.7}], llm=object())
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

    import ragas as ragas_mod

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setenv("RAGAS_EVAL_BATCH_ROWS", "2")

    class _M:
        name = "faithfulness"

    class _Frame:
        def __init__(self, rows):
            self._rows = rows
            # pandas-like: the column list (the engine maps metric keys to
            # suffixed columns through it)
            self.columns = list(rows[0].keys()) if rows else []

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


def test_evaluate_reports_the_judge_that_actually_scored(monkeypatch, engine_env):
    """sidecar_reported_model (2026-10-21, live): a judge override replaces
    the env default for every scoring call, but the result's model field
    still named RAGAS_JUDGE_MODEL — a GLM-judged run was recorded under the
    granite default's name. The field must name the effective judge."""
    import asyncio

    import ragas as ragas_mod

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())

    class _M:
        name = "faithfulness"

    class _Frame:
        def __init__(self, rows):
            self._rows = rows
            self.columns = list(rows[0].keys()) if rows else []

        def iterrows(self):
            return iter(enumerate(self._rows))

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def to_pandas(self):
            return _Frame(self._rows)

    def fake_evaluate(dataset, metrics, llm, embeddings, run_config, show_progress, raise_exceptions):
        return _Result([{"user_input": s.user_input, "faithfulness": 1.0} for s in dataset.samples])

    monkeypatch.setattr(ragas_mod, "evaluate", fake_evaluate)
    monkeypatch.setattr(ragas_engine, "resolve_metrics", lambda metrics: ([_M()], []))

    samples = [{"user_input": "q", "response": "a", "reference": "r", "retrieved_contexts": ["c"]}]

    no_override = asyncio.run(ragas_engine.evaluate_samples(samples, ["faithfulness"]))
    assert no_override["model"] == "test-model"  # env default (engine_env fixture)

    glm_override = {
        "provider": "openai",
        "base_url": "https://api.z.ai/api/coding/paas/v4",
        "model": "glm-5.3",
    }
    overridden = asyncio.run(ragas_engine.evaluate_samples(samples, ["faithfulness"], judge=glm_override))
    assert overridden["model"] == "glm-5.3"


def test_evaluate_maps_parameterized_metric_columns(monkeypatch, engine_env):
    """RAGAS 0.4.3 suffixes parameterized metrics' frame columns with their
    mode — factual_correctness(mode=f1), noise_sensitivity(mode=relevant) —
    while metric.name stays the bare key. The live NCD run (2026-10-21)
    nulled every row of exactly those two metrics and they vanished from
    the results table and charts. The extraction must resolve both
    spellings."""
    import asyncio

    import ragas as ragas_mod

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())

    class _M:
        def __init__(self, name):
            self.name = name

    class _Frame:
        def __init__(self, rows):
            self._rows = rows
            self.columns = list(rows[0].keys()) if rows else []

        def iterrows(self):
            return iter(enumerate(self._rows))

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def to_pandas(self):
            return _Frame(self._rows)

    def fake_evaluate(dataset, metrics, llm, embeddings, run_config, show_progress, raise_exceptions):
        return _Result(
            [
                {
                    "user_input": s.user_input,
                    "retrieved_contexts": [],
                    "response": s.response or "",
                    "reference": s.reference or "",
                    # the parameterized spellings RAGAS 0.4.3 actually emits
                    "factual_correctness(mode=f1)": 0.83,
                    "noise_sensitivity(mode=relevant)": 0.12,
                }
                for s in dataset.samples
            ]
        )

    monkeypatch.setattr(ragas_mod, "evaluate", fake_evaluate)
    monkeypatch.setattr(
        ragas_engine, "resolve_metrics", lambda metrics: ([_M("factual_correctness"), _M("noise_sensitivity")], [])
    )

    samples = [{"user_input": "q0", "response": "a", "reference": "r", "retrieved_contexts": ["c"]}]
    out = asyncio.run(ragas_engine.evaluate_samples(samples, ["factual_correctness", "noise_sensitivity"]))
    assert out["per_query"][0]["factual_correctness"] == 0.83
    assert out["per_query"][0]["noise_sensitivity"] == 0.12
    assert out["aggregate"]["factual_correctness"] == 0.83
    assert out["aggregate"]["noise_sensitivity"] == 0.12


def test_evaluate_cancel_between_batches(monkeypatch, engine_env):
    """(Moved out of the batching test 2026-10-21.) Cancel between batches:
    the tick after the first batch flips the event and the run aborts
    honestly."""
    import asyncio
    import threading

    import ragas as ragas_mod

    monkeypatch.setattr(ragas_engine, "build_llm", lambda **kwargs: object())
    monkeypatch.setattr(ragas_engine, "build_embeddings", lambda embed=None: object())
    monkeypatch.setenv("RAGAS_EVAL_BATCH_ROWS", "2")

    class _M:
        name = "faithfulness"

    class _Frame:
        def __init__(self, rows):
            self._rows = rows
            self.columns = list(rows[0].keys()) if rows else []

        def iterrows(self):
            return iter(enumerate(self._rows))

    class _Result:
        def __init__(self, rows):
            self._rows = rows

        def to_pandas(self):
            return _Frame(self._rows)

    def fake_evaluate(dataset, metrics, llm, embeddings, run_config, show_progress, raise_exceptions):
        return _Result(
            [
                {
                    "user_input": s.user_input,
                    "retrieved_contexts": [],
                    "response": s.response or "",
                    "reference": s.reference or "",
                    "faithfulness": 1.0,
                }
                for s in dataset.samples
            ]
        )

    monkeypatch.setattr(ragas_mod, "evaluate", fake_evaluate)
    monkeypatch.setattr(ragas_engine, "resolve_metrics", lambda metrics: ([_M()], []))

    samples = [
        {"user_input": f"q{i}", "response": "a", "reference": "r", "retrieved_contexts": ["c"]} for i in range(4)
    ]

    # cancel between batches: the tick after the first batch flips the event
    ev = threading.Event()

    def progress_cancel(phase, done=None, total=None):
        if done is not None and done >= 2:
            ev.set()

    with pytest.raises(ragas_engine.EngineCancelled):
        asyncio.run(
            ragas_engine.evaluate_samples(samples[:4], ["faithfulness"], progress=progress_cancel, cancel_event=ev)
        )


# ---------------------------------------------------------------------------
# Persona-name tolerance (live 2026-10-20: MiniMax judge echoed
# 'Maya Chen (Equity research analyst)' against the registry's 'Maya Chen'
# and EVERY synthesizer dropped its questions — suite generation died with
# "no questions could be synthesized").
# ---------------------------------------------------------------------------


def _persona_list(*names):
    from ragas.testset.persona import Persona, PersonaList

    return PersonaList(personas=[Persona(name=n, role_description="role") for n in names])


def test_persona_lookup_exact_still_matches():
    ragas_engine._patch_persona_lookup()
    pl = _persona_list("Maya Chen", "Robert Liu")
    assert pl["Maya Chen"].name == "Maya Chen"


def test_persona_lookup_survives_the_live_drift_case():
    ragas_engine._patch_persona_lookup()
    pl = _persona_list("Maya Chen", "Robert Liu")
    # the exact live failure: role annotation reattached by the judge
    hit = pl["Maya Chen (Equity research analyst)"]
    assert hit.name == "Maya Chen"  # containment matched the registry entry
    # case + punctuation drift
    assert pl["maya   chen"].name == "Maya Chen"
    assert pl["ROBERT LIU"].name == "Robert Liu"


def test_persona_lookup_fuzzy_and_fallback():
    ragas_engine._patch_persona_lookup()
    pl = _persona_list("Equity Research Analyst Maya Chen", "Robert Liu")
    # token overlap >= 0.5
    assert pl["Maya Chen Equity Research"].name == "Equity Research Analyst Maya Chen"
    # nothing close: first-persona fallback beats voiding the suite
    assert pl["completely unrelated name"].name == "Equity Research Analyst Maya Chen"


def test_persona_lookup_empty_list_still_raises():
    ragas_engine._patch_persona_lookup()
    pl = _persona_list()
    with pytest.raises(KeyError):
        pl["anyone"]


def test_persona_patch_is_idempotent():
    ragas_engine._patch_persona_lookup()
    ragas_engine._patch_persona_lookup()  # second call must not re-wrap
    pl = _persona_list("Maya Chen")
    assert pl["Maya Chen (Analyst)"].name == "Maya Chen"


# --- tqdm sub-step tracking (David 2026-10-20: "the user needs more
# feedback than this") — the KG phase streams the ACTIVE transform's bar
# instead of one indeterminate flash for its whole duration. -------------


def _quiet_bar(**kwargs):
    import io

    from tqdm import std as tstd

    return tstd.tqdm(file=io.StringIO(), **kwargs)


def test_current_tqdm_step_reads_the_newest_open_bar():
    ragas_engine._hook_tqdm()
    finished = _quiet_bar(total=10, desc="Summaries")
    finished.update(5)
    finished.close()
    live = _quiet_bar(total=40, desc="Applying CustomNodeFilter")
    live.update(12)
    try:
        step = ragas_engine._current_tqdm_step()
        assert step["step"] == "Applying CustomNodeFilter"
        assert step["done"] == 12
        assert step["total"] == 40
    finally:
        live.close()
        # The registry is a module global — this test's bar must not leak
        # into the next one.
        finished.close()


def test_current_tqdm_step_none_when_all_bars_closed():
    ragas_engine._hook_tqdm()
    bar = _quiet_bar(total=4, desc="done step")
    bar.close()
    assert ragas_engine._current_tqdm_step() is None


def test_current_tqdm_step_never_leaks_nan_or_missing_desc():
    ragas_engine._hook_tqdm()
    live = _quiet_bar(total=10)  # no desc at all
    live.update(0)
    try:
        step = ragas_engine._current_tqdm_step()
        assert step is not None
        assert isinstance(step["step"], str) and step["step"]
        assert "eta_s" not in step or step["eta_s"] == step["eta_s"]
        assert "rate_s" not in step
    finally:
        live.close()


def test_the_scoring_worker_pool_is_configurable(monkeypatch):
    """2026-10-22 (live): the pool was hardcoded to 8 — the same number as
    the judge-concurrency cap, so the two ceilings could not be moved apart.
    100 rows x ~13 judge calls at 8-way concurrency measured ~5.4 min per
    row (17 rows in 92 minutes, ~8 h projected)."""
    monkeypatch.delenv("RAGAS_EVAL_MAX_WORKERS", raising=False)
    assert ragas_engine._eval_max_workers() == 8

    monkeypatch.setenv("RAGAS_EVAL_MAX_WORKERS", "24")
    assert ragas_engine._eval_max_workers() == 24

    # a nonsense value must not break the run
    monkeypatch.setenv("RAGAS_EVAL_MAX_WORKERS", "not-a-number")
    assert ragas_engine._eval_max_workers() == 8

    # and it never drops below one worker
    monkeypatch.setenv("RAGAS_EVAL_MAX_WORKERS", "0")
    assert ragas_engine._eval_max_workers() == 1


def test_the_scoring_call_timeout_is_configurable_and_bounded(monkeypatch):
    """A scoring call that exceeds the budget raises TimeoutError inside
    ragas' executor, and evaluation runs with raise_exceptions=False — so
    the metric scores NULL for that row and the run does NOT report an
    error. The budget has to be reachable from the deployment."""
    monkeypatch.delenv("RAGAS_EVAL_TIMEOUT_SECONDS", raising=False)
    assert ragas_engine._eval_timeout_seconds() == 600
    assert ragas_engine._eval_timeout_seconds(900) == 900

    monkeypatch.setenv("RAGAS_EVAL_TIMEOUT_SECONDS", "180")
    assert ragas_engine._eval_timeout_seconds() == 180
    # an explicit per-request value still wins over the environment
    assert ragas_engine._eval_timeout_seconds(900) == 900

    monkeypatch.setenv("RAGAS_EVAL_TIMEOUT_SECONDS", "not-a-number")
    assert ragas_engine._eval_timeout_seconds() == 600

    # the floor is 30 s — a zero budget would fail every call
    monkeypatch.setenv("RAGAS_EVAL_TIMEOUT_SECONDS", "0")
    assert ragas_engine._eval_timeout_seconds() == 30
