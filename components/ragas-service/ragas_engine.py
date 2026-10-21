# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""ragas engine for the OKF RAGAS sidecar (Story 8-6, ADR-okf-043).

Model wiring follows the validated pattern of tests/rag-benchmarks'
run_ragas_eval.py: LangchainLLMWrapper/LangchainEmbeddingsWrapper over an
OpenAI-compatible client pointed at the deployment's local endpoints
(RAGAS_JUDGE_* / RAGAS_EMBED_*). NO feature is indexed on a specific
model (David 2026-10-17) — the minimums live in the spec's
model-requirements.md companion; these env vars only say WHERE.

The fanout ChatOpenAI reproduces his _FanoutChatOpenAI behavior: some
local judge chains reject n>1 (and langchain-openai silently collapses
them, killing answer_relevancy's strictness signal), so n>1 requests fan
into n parallel single-n calls whose generations are merged.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import weakref
from concurrent.futures import ThreadPoolExecutor
from typing import Any

logger = logging.getLogger("okf-ragas-service")

# ragas (<0.5) eagerly imports langchain_community.chat_models.vertexai,
# removed in langchain-community 0.4.x. Stub it when absent so the import
# chain survives — the same fix his run_ragas_eval.py applies at startup.
try:  # pragma: no cover - depends on installed versions
    from langchain_community.chat_models import vertexai  # noqa: F401
except ImportError:
    import sys as _sys
    import types as _types

    _vertexai = _types.ModuleType("langchain_community.chat_models.vertexai")

    class _ChatVertexAI:  # noqa: N801 — mirrors the removed class name
        pass

    _vertexai.ChatVertexAI = _ChatVertexAI
    _sys.modules["langchain_community.chat_models.vertexai"] = _vertexai

# --------------------------------------------------------------------------
# Config (env — compose supplies deployment defaults; see stack.md)
# --------------------------------------------------------------------------


def _judge_base_url() -> str:
    return (os.getenv("RAGAS_JUDGE_BASE_URL") or "").rstrip("/")


def judge_configured() -> bool:
    return bool(_judge_base_url() and os.getenv("RAGAS_JUDGE_MODEL"))


def _doc_char_cap() -> int:
    """Per-concept KG-input cap in chars (0 = disabled). 'auto' derives from
    the judge's context window so the transform prompts — including the
    pair-joining relationship builder — always fit."""
    raw = (os.getenv("RAGAS_DOC_CHAR_CAP") or "auto").strip().lower()
    if raw in ("0", "off", "none", "disabled"):
        return 0
    if raw not in ("auto", ""):
        try:
            return max(0, int(raw))
        except ValueError as e:
            raise ValueError(f"RAGAS_DOC_CHAR_CAP must be a char count, 'auto', or 0 — got {raw!r}") from e
    window = int(os.getenv("RAGAS_JUDGE_CONTEXT_TOKENS") or "65536")
    overhead = int(os.getenv("RAGAS_PROMPT_OVERHEAD_TOKENS") or "2048")
    reserve = int(os.getenv("RAGAS_OUTPUT_RESERVE_TOKENS") or "1024")
    pair_safe_tokens = max(512, (window - overhead - reserve) // 2)
    ceiling = int(os.getenv("RAGAS_DOC_CHAR_MAX") or "48000")
    return min(pair_safe_tokens * 4, ceiling)


# --------------------------------------------------------------------------
# Model wiring
# --------------------------------------------------------------------------

_PERSONA_LOOKUP_PATCHED = False


def _patch_persona_lookup():
    """Tolerant persona-name matching for ragas's PersonaList (live 2026-10-20).

    ragas 0.4.3's PersonaList.__getitem__ matches the judge's returned
    persona name by EXACT string. Frontier judges echo the name with the
    role annotation reattached — 'Maya Chen (Equity research analyst)' vs
    the registry's 'Maya Chen' — and every synthesizer then drops its
    questions ("No persona found with name …"), which surfaces as
    "no questions could be synthesized" with ZERO candidates dropped.
    The patch matches exact, then casefolded/punctuation-insensitive, then
    containment, then best token-overlap (>= 0.5), then falls back to the
    first persona rather than nuking the whole suite — each non-exact hit
    logs a warning so the drift stays visible.
    """
    global _PERSONA_LOOKUP_PATCHED
    if _PERSONA_LOOKUP_PATCHED:
        return
    import re

    from ragas.testset.persona import PersonaList

    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()

    def tolerant_getitem(self, key):
        for p in self.personas:
            if p.name == key:
                return p
        nk = _norm(key)
        for p in self.personas:
            if _norm(p.name) == nk:
                logger.warning("persona name matched case/punctuation-insensitively: %r", key)
                return p
        for p in self.personas:
            a, b = _norm(p.name), nk
            if a and b and (a in b or b in a):
                logger.warning("persona name matched by containment: %r -> %r", key, p.name)
                return p
        best, best_score = None, 0.0
        kw = set(nk.split())
        for p in self.personas:
            tw = set(_norm(p.name).split())
            if not tw or not kw:
                continue
            score = len(tw & kw) / len(tw | kw)
            if score > best_score:
                best, best_score = p, score
        if best is not None and best_score >= 0.5:
            logger.warning("persona name fuzzy-matched (score %.2f): %r -> %r", best_score, key, best.name)
            return best
        if self.personas:
            # A stylistic persona must never void the whole suite; the
            # synthesis prompt still carries the requested name.
            logger.warning("persona name %r unmatched — falling back to first persona", key)
            return self.personas[0]
        raise KeyError(f"No persona found with name '{key}'")

    PersonaList.__getitem__ = tolerant_getitem
    _PERSONA_LOOKUP_PATCHED = True


def _make_fanout_class(ChatOpenAI):  # noqa: N802 — mirrors his validated subclass
    """_FanoutChatOpenAI, ported from tests/rag-benchmarks/eval/run_ragas_eval.py.

    Simulates n>1 by fanning out into n parallel single-n requests and
    merging the generations — because some local judge chains reject n>1
    and langchain-openai silently collapses to n=1, which kills ragas's
    answer_relevancy strictness signal. The n=1 override rides the
    per-call kwargs ({**self._default_params, **kwargs} — kwargs win), so
    no self.n mutation, no locks. Generations nesting is normalized for
    both langchain-core <1.x (nested per input) and 1.x (flat).
    """
    from copy import deepcopy

    class _FanoutChatOpenAI(ChatOpenAI):
        @staticmethod
        def _effective_n(kwargs_n, self_n):
            n = kwargs_n if kwargs_n is not None else self_n
            try:
                return max(1, int(n)) if n is not None else 1
            except (TypeError, ValueError):
                return 1

        @staticmethod
        def _merge_results(results):
            from langchain_core.outputs import ChatResult

            if not results:
                return ChatResult(generations=[])

            def _gens_for_input(r) -> list:
                g = list(r.generations)
                if len(g) == 1 and isinstance(g[0], (list, tuple)):
                    g = list(g[0])
                return g

            merged = [gen for r in results for gen in _gens_for_input(r)]
            merged_output: dict = {}
            seen_keys: set = set()
            for r in results:
                info = getattr(r, "llm_output", None)
                if not info:
                    continue
                for k, v in info.items():
                    if k in seen_keys:
                        prev = merged_output[k]
                        both_num = isinstance(prev, (int, float)) and isinstance(v, (int, float))
                        if both_num and not isinstance(prev, bool) and not isinstance(v, bool):
                            merged_output[k] = prev + v
                    else:
                        merged_output[k] = v
                        seen_keys.add(k)
            out = ChatResult(generations=merged)
            if merged_output:
                out.llm_output = merged_output
            return out

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            n = self._effective_n(kwargs.pop("n", None), getattr(self, "n", 1))
            if n <= 1:
                return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
            per_call = {**kwargs, "n": 1}

            def _one():
                return super(_FanoutChatOpenAI, self)._generate(
                    deepcopy(messages), stop=stop, run_manager=run_manager, **per_call
                )

            with ThreadPoolExecutor(max_workers=n) as ex:
                results = list(ex.map(lambda _: _one(), range(n)))
            return self._merge_results(results)

        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            n = self._effective_n(kwargs.pop("n", None), getattr(self, "n", 1))
            if n <= 1:
                return await super()._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)
            per_call = {**kwargs, "n": 1}

            async def _one():
                return await super(_FanoutChatOpenAI, self)._agenerate(
                    deepcopy(messages), stop=stop, run_manager=run_manager, **per_call
                )

            results = await asyncio.gather(*(_one() for _ in range(n)))
            return self._merge_results(results)

    return _FanoutChatOpenAI


def _make_caching_wrapper(LangchainLLMWrapper, model_tag=None):  # noqa: N802 — factory, like _make_fanout_class
    """Disk-backed response cache around the judge client (2026-10-18).

    Live cost anatomy of a 5-question generation over two SMALL repos (21
    concepts in the KG): ~211 transform LLM calls + ~20 synthesis calls at
    ~2s each ≈ 8 minutes — the question count is irrelevant, the corpus is
    everything, and every repeat generation re-pays the whole KG phase. The
    remote judge's slowest calls (20-30s long summaries) pace each wave, so
    client concurrency (RunConfig max_workers=16) is already saturated —
    the only lever that shortens a re-run is NOT MAKING THE CALLS.

    Key = sha256(model | prompt | n | temperature | stop | max_tokens).
    model_tag (8-7 model configs, 2026-10-19): the EFFECTIVE judge identity
    — with judge overrides the env var would collide runs from different
    models onto each other's cached answers; the env case keeps the exact
    historical tag so existing caches stay valid.
    Hit → rebuild an LLMResult carrying ChatGeneration(text, AIMessage) —
    consumers reading .text or .message both work. Cache lives under
    RAGAS_LLM_CACHE_DIR (default /tmp/ragas-llm-cache — survives job
    churn, cleared on container recreate); RAGAS_LLM_CACHE=0 disables.
    """

    class _CachingLlmWrapper(LangchainLLMWrapper):
        def __init__(self, llm):
            super().__init__(llm)
            self._model_tag = model_tag if model_tag is not None else os.getenv("RAGAS_JUDGE_MODEL")
            self._cache_dir = os.getenv("RAGAS_LLM_CACHE_DIR") or "/tmp/ragas-llm-cache"
            self._enabled = (os.getenv("RAGAS_LLM_CACHE") or "1").strip().lower() not in ("0", "off", "false", "no")

        def _cache_enabled(self) -> bool:
            return self._enabled

        def _key(self, prompt, n, temperature, stop) -> str:
            import hashlib
            import json

            payload = json.dumps(
                [
                    self._model_tag,
                    os.getenv("RAGAS_JUDGE_MAX_TOKENS") or "0",
                    prompt.to_string(),
                    n,
                    temperature,
                    stop or None,
                ],
                default=str,
            )
            return hashlib.sha256(payload.encode("utf-8")).hexdigest()

        def _load(self, key):
            import json

            if not self._cache_enabled():
                return None
            try:
                with open(os.path.join(self._cache_dir, f"{key}.json"), encoding="utf-8") as fh:
                    entry = json.load(fh)
                return entry.get("texts"), entry.get("llm_output")
            except (OSError, ValueError):
                return None

        def _save(self, key, texts, llm_output):
            import json

            if not self._cache_enabled():
                return
            try:
                os.makedirs(self._cache_dir, exist_ok=True)
                tmp = os.path.join(self._cache_dir, f"{key}.json.tmp")
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump({"texts": texts, "llm_output": llm_output}, fh, default=str)
                os.replace(tmp, os.path.join(self._cache_dir, f"{key}.json"))
            except OSError:
                pass  # cache is best-effort — never fail a job over it

        @staticmethod
        def _rebuild(texts, llm_output):
            from langchain_core.messages import AIMessage
            from langchain_core.outputs import ChatGeneration, LLMResult

            gens = [[ChatGeneration(text=t, message=AIMessage(content=t)) for t in texts]]
            return LLMResult(generations=gens, llm_output=llm_output or {})

        @staticmethod
        def _extract(result):
            try:
                texts = [g.text for g in result.generations[0]]
            except (IndexError, AttributeError):
                return None
            try:
                llm_output = result.llm_output or None
            except AttributeError:
                llm_output = None
            return texts, llm_output

        def generate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            key = self._key(prompt, n, temperature, stop)
            hit = self._load(key)
            if hit is not None:
                return self._rebuild(*hit)
            result = super().generate_text(prompt, n=n, temperature=temperature, stop=stop, callbacks=callbacks)
            extracted = self._extract(result)
            if extracted is not None:
                self._save(key, *extracted)
            return result

        async def agenerate_text(self, prompt, n=1, temperature=0.01, stop=None, callbacks=None):
            key = self._key(prompt, n, temperature, stop)
            hit = self._load(key)
            if hit is not None:
                return self._rebuild(*hit)
            result = await super().agenerate_text(prompt, n=n, temperature=temperature, stop=stop, callbacks=callbacks)
            extracted = self._extract(result)
            if extracted is not None:
                self._save(key, *extracted)
            return result

    return _CachingLlmWrapper


def build_llm(temperature: float = 0.0, judge: dict | None = None):
    """Wrap the judge endpoint as a ragas LLM. Deferred-imported so /health
    never pays the langchain import cost and tests can stub this module.

    judge (8-7 model configs, 2026-10-19): optional per-request override
    {provider, base_url, model, api_key} resolved by okf-server — an
    explicit run pick or the deployment's active model configuration.
    provider 'openai' covers every OpenAI-compatible surface (OpenAI
    direct, a LiteLLM gateway, vLLM, Gemini-compat, Ollama); 'anthropic'
    is the native Messages API via langchain-anthropic (lazy import —
    optional dependency, honest error when absent). Without an override
    the env contract (RAGAS_JUDGE_*) applies unchanged."""
    import httpx
    from langchain_openai import ChatOpenAI

    # ragas.llms.LangchainLLMWrapper is a DeprecationHelper SHIM, not a
    # class — subclassing it explodes at class-definition time (live
    # 2026-10-18: "DeprecationHelper.__init__() takes 3 positional arguments
    # but 4 were given", killing every /evaluate job). Import the REAL class
    # from its module.
    from ragas.llms.base import LangchainLLMWrapper

    provider = "openai"
    if judge:
        provider = str(judge.get("provider") or "openai").lower()
        base = str(judge.get("base_url") or "").rstrip("/")
        model = judge.get("model")
        api_key = judge.get("api_key") or "sk-no-key"
        if not base or not model:
            raise RuntimeError("judge override incomplete — base_url and model are required")
        model_tag = f"{provider}:{base}:{model}"
    else:
        base = _judge_base_url()
        model = os.getenv("RAGAS_JUDGE_MODEL")
        api_key = os.getenv("RAGAS_JUDGE_API_KEY") or "sk-no-key"
        if not base or not model:
            raise RuntimeError("judge endpoint not configured (RAGAS_JUDGE_BASE_URL / RAGAS_JUDGE_MODEL)")
        model_tag = None  # env tag — keeps the existing disk cache valid

    if provider == "anthropic":
        try:
            from langchain_anthropic import ChatAnthropic
        except ImportError as e:
            raise RuntimeError(
                "anthropic judging needs langchain-anthropic in the ragas-service image "
                "(pip install langchain-anthropic) — or point the config at a LiteLLM gateway"
            ) from e
        cls = ChatAnthropic
        # The SDK appends its own /v1 paths; accept the base with or without
        # the /v1 the config UI may have stored.
        base = base.removesuffix("/v1")
    else:
        cls = ChatOpenAI

    # Sovereign vLLM fronts nginx with a self-signed cert — bypass SSL
    # verify on BOTH sync and async clients (ragas uses the async path
    # internally; a verify-only-sync client fails with CERTIFICATE_VERIFY_
    # FAILED -> OpenAIConnectionError). 300s request timeout: long local
    # judge calls can take 60-120s; the httpx default (5s read) killed
    # 12/360 jobs in the harness's 2026-10-07 run.
    sync_client = httpx.Client(verify=False, timeout=300)
    async_client = httpx.AsyncClient(verify=False, timeout=300)
    kwargs: dict[str, Any] = {}
    max_tokens = int(os.getenv("RAGAS_JUDGE_MAX_TOKENS") or "0")
    if max_tokens <= 0 and provider == "anthropic":
        max_tokens = 4096  # the Anthropic API REQUIRES max_tokens — no default
    if max_tokens > 0:
        kwargs["max_tokens"] = max_tokens
    fanout_cls = _make_fanout_class(cls)
    inner = fanout_cls(
        base_url=base,
        api_key=api_key,
        model=model,
        temperature=temperature,
        http_client=sync_client,
        http_async_client=async_client,
        timeout=300,
        **kwargs,
    )
    return _make_caching_wrapper(LangchainLLMWrapper, model_tag)(inner)


class _TeiEmbeddings:
    """TEI-native embeddings for the langchain Embeddings interface.

    The project's sovereign deployments front TEI through nginx at `/embed`
    (the same contract okf-server's teiEmbed uses) — NOT the OpenAI-
    compatible /v1/embeddings route, which those nginxes do not expose
    (live-verified 2026-10-17: 404 on /v1/embeddings, 200 on /embed).
    """

    def __init__(self, url: str, api_key: str, model: str):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.model = model

    def _post(self, texts: list[str]) -> list[list[float]]:
        import httpx

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        resp = httpx.post(
            f"{self.url}/embed",
            json={"inputs": texts, "truncate": True},
            headers=headers,
            verify=False,
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._post(list(texts))

    def embed_query(self, text: str) -> list[float]:
        return self._post([text])[0]

    # ragas runs its KG transforms and metric chains under asyncio and calls
    # the aembed_* surface — a duck-typed class without these dies with
    # "'_TeiEmbeddings' object has no attribute 'aembed_documents'" (live
    # bug #6, 2026-10-17). Offload the sync httpx call to a worker thread.
    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(self._post, list(texts))

    async def aembed_query(self, text: str) -> list[float]:
        return (await asyncio.to_thread(self._post, [text]))[0]


def build_embeddings(embed: dict | None = None):
    """Wrap the embedder endpoint. Returns None when unconfigured —
    answer_relevancy is then dropped from the wanted metrics with a loud
    warning (his documented pitfall: silent drop).

    RAGAS_EMBED_API selects the dialect: 'tei' (default — POSTs
    {RAGAS_EMBED_BASE_URL}/embed with {inputs, truncate}, the project's
    TEI-behind-nginx contract) or 'openai' (any OpenAI-compatible
    embeddings endpoint, e.g. LiteLLM — uses /embeddings).

    embed (8-7 model configs, 2026-10-19): optional per-request override
    {base_url, model, api_key} against an OpenAI-compatible embeddings
    surface (Anthropic serves none — a config with that provider cannot
    embed; keep the env TEI embedder, which is what the sovereign stack
    uses anyway)."""
    from ragas.embeddings import LangchainEmbeddingsWrapper

    if embed:
        base = str(embed.get("base_url") or "").rstrip("/")
        model = embed.get("model")
        if not base or not model:
            raise RuntimeError("embed override incomplete — base_url and model are required")
        from langchain_openai import OpenAIEmbeddings

        return LangchainEmbeddingsWrapper(
            OpenAIEmbeddings(model=model, api_key=embed.get("api_key") or "sk-no-key", base_url=base)
        )

    model = os.getenv("RAGAS_EMBED_MODEL")
    if not model:
        return None
    base = (os.getenv("RAGAS_EMBED_BASE_URL") or _judge_base_url()).rstrip("/")
    api_key = os.getenv("RAGAS_EMBED_API_KEY") or os.getenv("RAGAS_JUDGE_API_KEY") or ""
    dialect = (os.getenv("RAGAS_EMBED_API") or "tei").lower()
    if dialect == "openai":
        from langchain_openai import OpenAIEmbeddings

        return LangchainEmbeddingsWrapper(OpenAIEmbeddings(model=model, api_key=api_key or "sk-no-key", base_url=base))
    return LangchainEmbeddingsWrapper(_TeiEmbeddings(base, api_key, model))


# --------------------------------------------------------------------------
# Metric registry — the full single-turn RAG catalog (David 2026-10-17).
# Keys are the report column names; the four default keys match his
# ragas_report.json exactly so any consumer of his report reads ours.
# --------------------------------------------------------------------------


def metric_registry() -> dict[str, Any]:
    from ragas.metrics import (
        AnswerCorrectness,
        ContextEntityRecall,
        FactualCorrectness,
        Faithfulness,
        LLMContextPrecisionWithoutReference,
        LLMContextPrecisionWithReference,
        LLMContextRecall,
        NoiseSensitivity,
        ResponseRelevancy,
        SemanticSimilarity,
    )

    def named(key: str, metric: Any) -> Any:
        metric.name = key
        return metric

    return {
        "faithfulness": named("faithfulness", Faithfulness()),
        "context_precision": named("context_precision", LLMContextPrecisionWithReference()),
        "context_recall": named("context_recall", LLMContextRecall()),
        "answer_relevancy": named("answer_relevancy", ResponseRelevancy()),
        "context_utilization": named("context_utilization", LLMContextPrecisionWithoutReference()),
        "context_entities_recall": named("context_entities_recall", ContextEntityRecall()),
        "factual_correctness": named("factual_correctness", FactualCorrectness()),
        "answer_correctness": named("answer_correctness", AnswerCorrectness()),
        "answer_similarity": named("answer_similarity", SemanticSimilarity()),
        "noise_sensitivity": named("noise_sensitivity", NoiseSensitivity()),
    }


#: metrics that need an embedding model (dropped with a warning when the
#: embedder is unconfigured — never silently)
_EMBEDDING_METRICS = {"answer_relevancy", "answer_correctness", "answer_similarity"}

#: metrics that consume reference_contexts (our reference_passages)
_REFERENCE_CONTEXT_METRICS: set[str] = set()  # reserved: non-LLM context metrics


def resolve_metrics(wanted: list[str] | None) -> tuple[list[Any], list[str]]:
    """Map requested keys to metric instances. Unknown keys raise. Returns
    (metrics, dropped) — dropped names the metrics removed because the
    embedder is not configured."""
    reg = metric_registry()
    keys = list(wanted) if wanted else list(_DEFAULT_METRICS_TUPLE)
    unknown = [k for k in keys if k not in reg]
    if unknown:
        raise ValueError(f"unknown metrics: {', '.join(unknown)}; available: {', '.join(sorted(reg))}")
    dropped: list[str] = []
    if build_embeddings() is None:
        dropped = [k for k in keys if k in _EMBEDDING_METRICS]
        if dropped:
            logger.warning("RAGAS_EMBED_MODEL unset — dropping embedding-dependent metrics: %s", ", ".join(dropped))
        keys = [k for k in keys if k not in _EMBEDDING_METRICS]
    return [reg[k] for k in keys], dropped


_DEFAULT_METRICS_TUPLE = ("faithfulness", "context_precision", "context_recall", "answer_relevancy")


# --------------------------------------------------------------------------
# Testset generation
# --------------------------------------------------------------------------


def _make_headlines_seeder():
    """Build the transform that back-fills node.properties['headlines'] = [].

    Live bug (2026-10-18): ragas 0.4.3's default long-doc chain pairs
    HeadlinesExtractor — which only sets 'headlines' on DOCUMENT nodes over
    500 tokens (testset/transforms/default.py:68-72, 87-89,
    filter_doc_with_num_tokens) — with HeadlineSplitter, which hard-requires
    the property on EVERY node and checks it before its own min_tokens
    early-return (testset/transforms/splitters/headline.py:63-68:
    ValueError "'headlines' property not found in this node"). One concept
    at or under 500 tokens therefore killed the whole suite build. Extractor
    LLM failures would also leave the property unset, but those surface
    loudly at the extractor step itself (run_async_tasks re-raises the first
    task exception, async_utils.py:226-228) — the silent gap is the filter
    mismatch, so the seeder runs unfiltered over every node.

    Seeding [] preserves the splitter's own no-headlines semantics: the
    headline loop no-ops, the whole text stays a single chunk, and the node
    is returned unsplit (headline.py:70-81).

    Implemented as a Transform subclass, not a bare callable, because
    apply_transforms accepts only BaseGraphTransformation / Parallel in its
    sequence — anything else hits "Invalid transforms type"
    (testset/transforms/engine.py:68-89). The interface mirrors the base
    class (testset/transforms/base.py:32-117): async transform(kg) plus
    generate_execution_plan(kg) returning coroutines that mutate the graph.
    """
    from dataclasses import dataclass

    from ragas.testset.transforms import BaseGraphTransformation

    @dataclass
    class _HeadlinesSeeder(BaseGraphTransformation):
        async def transform(self, kg):
            for node in kg.nodes:
                if node.get_property("headlines") is None:
                    node.add_property("headlines", [])

        def generate_execution_plan(self, kg):
            async def apply_seed():
                await self.transform(kg)

            return [apply_seed()]

    return _HeadlinesSeeder()


def _build_testset_transforms(documents, llm, embedding_model):
    """Explicit mirror of ragas 0.4.3 default_transforms()
    (.venv/Lib/site-packages/ragas/testset/transforms/default.py:34-167)
    with ONE change: a headlines-seeding step (_make_headlines_seeder)
    spliced between HeadlinesExtractor and HeadlineSplitter.

    Built explicitly rather than taken from default_transforms() so the
    sequence is visible, assertable, and safely insertable — the parity
    test in tests/test_ragas_engine.py pins it against the library default
    so a ragas upgrade that reorders the defaults fails loudly instead of
    drifting silently. Both branch bodies and the token-bin choice are
    replicated verbatim from default.py (line refs inline).
    """
    from ragas.testset.graph import NodeType
    from ragas.testset.transforms import (
        CosineSimilarityBuilder,
        CustomNodeFilter,
        EmbeddingExtractor,
        HeadlinesExtractor,
        HeadlineSplitter,
        OverlapScoreBuilder,
        Parallel,
        SummaryExtractor,
    )
    from ragas.testset.transforms.extractors.llm_based import NERExtractor, ThemesExtractor
    from ragas.utils import num_tokens_from_string

    def filter_doc_with_num_tokens(node, min_num_tokens=500):
        return (
            node.type == NodeType.DOCUMENT and num_tokens_from_string(node.properties["page_content"]) > min_num_tokens
        )

    def filter_docs(node):
        return node.type == NodeType.DOCUMENT

    def filter_chunks(node):
        return node.type == NodeType.CHUNK

    # token-length bins pick the branch (default.py:80-82, 86, 131, 162-165)
    bin_ranges = [(0, 100), (101, 500), (501, float("inf"))]
    counts = [num_tokens_from_string(doc.page_content) for doc in documents]
    bins = {f"{start}-{end}": 0 for start, end in bin_ranges}
    for num in counts:
        for start, end in bin_ranges:
            if start <= num <= end:
                bins[f"{start}-{end}"] += 1
                break
    fractions = {k: v / len(documents) for k, v in bins.items()}

    if fractions["501-inf"] >= 0.25:
        # long-doc branch (default.py:86-130) + seeder after HeadlinesExtractor
        return [
            HeadlinesExtractor(llm=llm, filter_nodes=filter_doc_with_num_tokens),
            _make_headlines_seeder(),
            HeadlineSplitter(min_tokens=500),
            SummaryExtractor(llm=llm, filter_nodes=filter_doc_with_num_tokens),
            CustomNodeFilter(llm=llm, filter_nodes=filter_chunks),
            Parallel(
                EmbeddingExtractor(
                    embedding_model=embedding_model,
                    property_name="summary_embedding",
                    embed_property_name="summary",
                    filter_nodes=filter_doc_with_num_tokens,
                ),
                ThemesExtractor(llm=llm, filter_nodes=filter_chunks),
                NERExtractor(llm=llm, filter_nodes=filter_chunks),
            ),
            Parallel(
                CosineSimilarityBuilder(
                    property_name="summary_embedding",
                    new_property_name="summary_similarity",
                    threshold=0.7,
                    filter_nodes=filter_doc_with_num_tokens,
                ),
                OverlapScoreBuilder(threshold=0.01, filter_nodes=filter_chunks),
            ),
        ]
    if fractions["101-500"] >= 0.25:
        # medium-doc branch (default.py:131-161) — verbatim, no splitter here
        return [
            SummaryExtractor(llm=llm, filter_nodes=lambda node: filter_doc_with_num_tokens(node, 100)),
            CustomNodeFilter(llm=llm),
            Parallel(
                EmbeddingExtractor(
                    embedding_model=embedding_model,
                    property_name="summary_embedding",
                    embed_property_name="summary",
                    filter_nodes=lambda node: filter_doc_with_num_tokens(node, 100),
                ),
                ThemesExtractor(llm=llm, filter_nodes=filter_docs),
                NERExtractor(llm=llm),
            ),
            Parallel(
                CosineSimilarityBuilder(
                    property_name="summary_embedding",
                    new_property_name="summary_similarity",
                    threshold=0.5,
                    filter_nodes=lambda node: filter_doc_with_num_tokens(node, 100),
                ),
                OverlapScoreBuilder(threshold=0.01),
            ),
        ]
    raise ValueError("Documents appears to be too short (ie 100 tokens or less). Please provide longer documents.")


class EngineCancelled(Exception):
    """Raised when a cancel_event fires mid-run; the app layer maps this to
    the job's 'cancelled' status (a user stop is not a failure)."""


def _check_cancel(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise EngineCancelled("cancelled")


def _empty_sample():
    """Minimal VALID sample (all fields optional on SingleTurnSample) — the
    droppable placeholder a failed synthesis returns."""
    from ragas.dataset_schema import SingleTurnSample

    return SingleTurnSample(user_input="")


# --- tqdm sub-step tracking (David 2026-10-20: "the user needs more
# feedback than this") -------------------------------------------------------
# ragas's transforms report their own progress as tqdm bars ("Applying
# CustomNodeFilter: 337/1075 …"); the KG phase otherwise shows the user ONE
# indeterminate bar for its whole (longest) duration. Hook tqdm so the
# ACTIVE transform's bar is readable live. Transforms run sequentially, so
# the newest not-yet-closed bar is the current step. Registry is weakref'd
# and bounded — a long-lived process cannot accumulate.
_TQDM_HOOKED = False
_TQDM_BARS: list = []  # [weakref(bar)] — newest last


def _hook_tqdm() -> None:
    global _TQDM_HOOKED
    if _TQDM_HOOKED:
        return
    _TQDM_HOOKED = True
    try:
        from tqdm import std as _tstd
    except ImportError:
        return
    _orig_init = _tstd.tqdm.__init__
    _orig_close = _tstd.tqdm.close

    def _init(self, *args, **kwargs):
        _orig_init(self, *args, **kwargs)
        try:
            self._genie_open = True
            _TQDM_BARS.append(weakref.ref(self))
            del _TQDM_BARS[:-64]
        except Exception:  # noqa: BLE001 — tracking may never break tqdm
            pass

    def _close(self, *args, **kwargs):
        try:
            self._genie_open = False
        except Exception:  # noqa: BLE001
            pass
        return _orig_close(self, *args, **kwargs)

    _tstd.tqdm.__init__ = _init
    _tstd.tqdm.close = _close


def _current_tqdm_step() -> dict | None:
    """The active transform's bar as {step, done, total, eta_s, rate_s}."""
    for ref in reversed(_TQDM_BARS):
        bar = ref()
        if bar is None or not getattr(bar, "_genie_open", False):
            continue
        fd = getattr(bar, "format_dict", None) or {}
        out = {"step": str(getattr(bar, "desc", "") or "working").strip()}
        total = fd.get("total")
        if total:
            out["done"] = fd.get("n", getattr(bar, "n", 0))
            out["total"] = total
        eta = fd.get("eta")
        if isinstance(eta, (int, float)) and eta == eta and 0 <= eta < 10**7:
            out["eta_s"] = eta
        rate = fd.get("rate")
        if isinstance(rate, (int, float)) and rate == rate and rate > 0:
            out["rate_s"] = rate
        return out
    return None


class _TolerantSynthesizer:
    """Proxy that keeps one failed question from killing the whole run.

    ragas 0.4.3's Executor (executor.py:84) turns a failed call into np.nan
    when raise_exceptions=False; generate.py:610 then feeds that nan to
    TestsetSample and pydantic rejects it — one bad question destroys the
    ENTIRE generation (live 2026-10-18: "2 validation errors for
    TestsetSample ... input_value=nan"). A failed scenario call is equally
    lethal: iterating a nan raises TypeError. This proxy converts failures
    into valid-but-droppable results — [] for a scenario batch, an empty
    SingleTurnSample per question — which extraction filters out, so the
    run completes with the questions that DID synthesize. It is also the
    cancellation seam: once cancel_event is set, every remaining call
    short-circuits without touching the judge, so a cancelled run drains
    within one in-flight LLM batch instead of grinding the GPU to the end.
    """

    def __init__(self, inner, cancel_event: threading.Event | None = None, on_sample=None):
        self._inner = inner
        self._cancel = cancel_event
        self._on_sample = on_sample  # callable(done_so_far) — synthesis progress

    @property
    def name(self):
        return self._inner.name

    def _cancelled(self) -> bool:
        return self._cancel is not None and self._cancel.is_set()

    async def generate_scenarios(self, n, knowledge_graph, persona_list, callbacks=None):
        if self._cancelled():
            return []
        try:
            scenarios = await self._inner.generate_scenarios(
                n=n, knowledge_graph=knowledge_graph, persona_list=persona_list, callbacks=callbacks
            )
        except Exception as e:  # noqa: BLE001 — dropping this batch IS the recovery
            logger.warning("scenario generation failed for %s (dropping its questions): %s", self.name, e)
            return []
        # Enforce the n cap HERE (live 2026-10-18: a 5-question suite over 65
        # chunk nodes submitted 391 samples — 6×65+1, the per-node scenario
        # builders ignoring the requested count — turning ~30s of synthesis
        # into ~30 min at ~4.7s/call). generate() only ever consumes
        # scenarios; the surplus was pure GPU burn.
        if len(scenarios) > n:
            logger.warning(
                "ragas %s returned %d scenarios for n=%d — truncating (per-node overshoot bug)",
                self.name,
                len(scenarios),
                n,
            )
            scenarios = scenarios[:n]
        return scenarios

    async def generate_sample(self, scenario, callbacks=None):
        try:
            if self._cancelled():
                return _empty_sample()
            try:
                return await self._inner.generate_sample(scenario=scenario, callbacks=callbacks)
            except Exception as e:  # noqa: BLE001 — dropping this question IS the recovery
                logger.warning("sample synthesis failed for %s (dropping question): %s", self.name, e)
                return _empty_sample()
        finally:
            if self._on_sample is not None:
                try:
                    self._on_sample()
                except Exception:  # noqa: BLE001 — progress reporting can never fail a job
                    pass


async def generate_testset(
    documents: list[dict],
    testset_size: int,
    query_distribution: list[dict] | None = None,
    num_personas: int = 3,
    progress=None,
    cancel_event: threading.Event | None = None,
    judge: dict | None = None,
    embed: dict | None = None,
) -> dict:
    """Generate benchmark-suite samples from concept documents.

    documents: [{page_content, metadata}] — concept bodies with repo/concept
    metadata. Multi-repo input feeds ONE knowledge graph so multi-hop
    synthesizers cross repo boundaries. query_distribution (optional)
    overrides the default synthesizer mix, as [{synthesizer, weight}].
    progress (optional): callback str -> None, called at phase boundaries so
    the app layer's job registry can expose coarse progress to pollers.
    cancel_event (optional): set by the app layer on DELETE; checked at
    phase boundaries and inside the synthesizer wrappers (see
    _TolerantSynthesizer).
    judge / embed (8-7 model configs): optional per-request model overrides
    resolved by okf-server (build_llm / build_embeddings carry the shapes).
    """
    _patch_persona_lookup()

    from langchain_core.documents import Document as LCDocument
    from ragas.run_config import RunConfig
    from ragas.testset import TestsetGenerator
    from ragas.testset.graph import KnowledgeGraph, Node, NodeType
    from ragas.testset.transforms import apply_transforms

    llm = build_llm(temperature=0.3, judge=judge)  # generation benefits from mild creativity
    embeddings = build_embeddings(embed=embed)
    if embeddings is None:
        raise RuntimeError("RAGAS_EMBED_MODEL is required for testset generation (KG transforms embed)")

    # Per-concept cap on the text fed into the knowledge graph. The KG
    # transforms (summaries, themes, entities, relationships) don't need the
    # full body — and the relationship builder joins PAIRS of node contents,
    # so two near-the-cap concepts overflow the judge's context window and
    # kill the whole job with a 400 (live finding: one prompt hit 65537
    # tokens against a 65536 window, 2026-10-17).
    #
    # Sizing sticks to the SELECTED model's window (David, 2026-10-18):
    # 'auto' (default) derives the cap from RAGAS_JUDGE_CONTEXT_TOKENS —
    # (window − overhead − output reserve) ÷ 2 for the pair-join, × 4
    # chars/token — then clamps to RAGAS_DOC_CHAR_MAX so huge windows don't
    # explode runtime. An explicit RAGAS_DOC_CHAR_CAP number wins; <=0
    # disables. Same discipline as DATAPREP_CONTEXTUAL_DOC_BUDGET.
    doc_cap = _doc_char_cap()
    if doc_cap > 0:

        def _cap(text: str) -> str:
            return text if len(text) <= doc_cap else text[:doc_cap]

    else:

        def _cap(text: str) -> str:  # cap disabled
            return text

    docs = [
        LCDocument(page_content=_cap(str(d.get("page_content") or "")), metadata=dict(d.get("metadata") or {}))
        for d in documents
    ]
    generator = TestsetGenerator(llm=llm, embedding_model=embeddings)

    # Thread confinement (live 2026-10-18): ragas's Executor re-enters
    # whatever loop is running via nest_asyncio (executor.py:214
    # apply_nest_asyncio). Driven on the uvicorn loop, that reentrancy
    # corrupted the loop's ready-deque ("IndexError: pop from an empty
    # deque"), killed the server process, restarted the container and
    # vanished every in-flight job. In a plain worker thread no loop is
    # running, so ragas's run() takes the plain asyncio.run path — a
    # private ephemeral loop, no patching, no shared state (async_utils.run).
    # The same confinement keeps the uvicorn loop free for health checks.
    if progress:
        progress("building-knowledge-graph")
    transforms = _build_testset_transforms(documents=docs, llm=llm, embedding_model=embeddings)
    nodes = [
        Node(
            type=NodeType.DOCUMENT,
            properties={"page_content": doc.page_content, "document_metadata": doc.metadata},
        )
        for doc in docs
    ]
    kg = KnowledgeGraph(nodes=nodes)
    # Sub-step streaming: the KG phase is the longest and previously showed
    # one indeterminate bar while ragas internally churned through extract →
    # summaries → node filter → relationships, each with its own tqdm bar.
    # A 1 Hz ticker reads the ACTIVE bar (see _hook_tqdm) and feeds the
    # job's progress {step, done, total, eta_s} — the UI renders counts and
    # a real ETA instead of a flashing bar.
    kg_stop = threading.Event()

    def _kg_ticker():
        while not kg_stop.wait(1.0):
            try:
                step = _current_tqdm_step()
            except Exception:  # noqa: BLE001 — progress may never fail a job
                step = None
            if step and progress is not None:
                try:
                    progress(
                        "building-knowledge-graph",
                        step.get("done"),
                        step.get("total"),
                        step=step.get("step"),
                        rate_s=step.get("rate_s"),
                        eta_s=step.get("eta_s"),
                    )
                except Exception:  # noqa: BLE001
                    pass

    _hook_tqdm()
    ticker = threading.Thread(target=_kg_ticker, daemon=True, name="kg-progress")
    ticker.start()
    try:
        await asyncio.to_thread(apply_transforms, kg, transforms, run_config=RunConfig())
    finally:
        kg_stop.set()
        ticker.join(timeout=2)
    _check_cancel(cancel_event)
    generator.knowledge_graph = kg

    # generate_with_langchain_docs() (ragas 0.4.3) does NOT accept
    # num_personas — only generate() does. Replicate the wrapper's own
    # body (verified against its source: default transforms → DOCUMENT
    # nodes → apply_transforms → generate) so the persona count rides
    # through, per the user-settable-dimensions contract. The transforms
    # come from our explicit mirror of the 0.4.3 defaults (see
    # _build_testset_transforms) — the library's own list crashes on
    # docs the HeadlinesExtractor filter skips (live 2026-10-18).
    if progress:
        progress("synthesizing-questions")
    # Synthesis progress: count every resolved sample (wrapper finally-hook)
    # against the split arithmetic's expected total — ceil(N × weight) per
    # synthesizer, the same calculate_split_values ragas applies.
    synth_done = [0]

    def _bump():
        synth_done[0] += 1
        if progress is not None:
            progress("synthesizing-questions", synth_done[0], None)

    dist = _resolve_distribution(query_distribution, llm, kg=kg, cancel_event=cancel_event, on_sample=_bump)
    if progress is not None and dist:
        # ceil per entry (import-free): the bar's total is the expected count
        expected = sum(-(-round(int(testset_size) * w) // 1) or 1 for _, w in dist)
        progress("synthesizing-questions", synth_done[0], max(expected, int(testset_size)))
    testset = await asyncio.to_thread(
        generator.generate,
        testset_size=int(testset_size),
        query_distribution=dist,
        num_personas=int(num_personas),
        raise_exceptions=False,
    )
    _check_cancel(cancel_event)

    samples = []
    dropped = 0
    for ts in testset.samples:
        s = ts.eval_sample
        if not str(getattr(s, "user_input", None) or "").strip():
            # a failed/cancelled synthesis (see _TolerantSynthesizer) —
            # count it, never ship it
            dropped += 1
            continue
        samples.append(
            {
                "user_input": getattr(s, "user_input", None) or "",
                "reference": getattr(s, "reference", None) or "",
                "reference_contexts": list(getattr(s, "reference_contexts", None) or []),
                "persona_name": getattr(ts, "persona_name", None) or getattr(s, "persona_name", None) or "",
                "query_style": getattr(s, "query_style", None) or getattr(ts, "query_style", None) or "",
                "query_length": getattr(s, "query_length", None) or getattr(ts, "query_length", None) or "",
                "synthesizer_name": getattr(ts, "synthesizer_name", None) or "",
            }
        )
    _check_cancel(cancel_event)  # a cancel beats partial results — the user asked to stop
    # The split arithmetic can ceil ABOVE the request (3 synthesizers ×
    # ceil(N/3) ≥ N) and the wrapper truncation bounds per-synthesizer, not
    # the total — the user asked for N questions, ship N (2026-10-18: a
    # 5-question request displayed 200 entries after the overshoot bug).
    if len(samples) > int(testset_size):
        dropped += len(samples) - int(testset_size)
        samples = samples[: int(testset_size)]
    if not samples:
        raise RuntimeError(
            f"no questions could be synthesized ({dropped} candidate(s) dropped — every synthesis "
            "failed); see ragas-service logs for per-question failures (judge output quality / window fit)"
        )
    return {
        "samples": samples,
        "dropped": dropped,
        "generator": {"model": os.getenv("RAGAS_JUDGE_MODEL"), "embed_model": os.getenv("RAGAS_EMBED_MODEL")},
    }


def _resolve_distribution(
    query_distribution: list[dict] | None,
    llm,
    kg=None,
    cancel_event: threading.Event | None = None,
    on_sample=None,
):
    """Map [{synthesizer, weight}] specs to a ragas QueryDistribution.

    synthesizer is one of single_hop_specific | multi_hop_abstract |
    multi_hop_specific (the ragas testset synthesizers). The judge llm is
    injected into each instance — a bare cls() triggers ragas's default
    OpenAI() client, which raises without OPENAI_API_KEY (sovereign
    deployments must never need one).

    Every synthesizer is wrapped in _TolerantSynthesizer (2026-10-18): with
    ragas 0.4.3 + raise_exceptions=False a single failed sample becomes
    np.nan (executor.py:84) and pydantic then rejects the whole Testset —
    wrappers convert failures to droppable results instead. When no user
    distribution is given and the KG is available, the DEFAULT distribution
    is built here (same call generate() would make) so the default mix gets
    the same protection.
    """
    if not query_distribution:
        if kg is None:
            return None  # no KG to filter against — let generate() build its own
        from ragas.testset.synthesizers import default_query_distribution

        base = default_query_distribution(llm, kg)
        return [(_TolerantSynthesizer(s, cancel_event, on_sample), w) for s, w in base]
    from ragas.testset.synthesizers import (
        MultiHopAbstractQuerySynthesizer,
        MultiHopSpecificQuerySynthesizer,
        SingleHopSpecificQuerySynthesizer,
    )

    factory = {
        "single_hop_specific": SingleHopSpecificQuerySynthesizer,
        "multi_hop_abstract": MultiHopAbstractQuerySynthesizer,
        "multi_hop_specific": MultiHopSpecificQuerySynthesizer,
    }
    out = []
    for spec in query_distribution:
        key = str(spec.get("synthesizer") or "").strip()
        weight = float(spec.get("weight") or 0)
        cls = factory.get(key)
        if cls is None or weight <= 0:
            raise ValueError(
                f"bad query_distribution entry {spec}; synthesizer must be one of {sorted(factory)} with weight > 0"
            )
        out.append((_TolerantSynthesizer(cls(llm=llm), cancel_event, on_sample), weight))
    # Normalize PERCENT-style weights (live 2026-10-20: the panel's inputs
    # are 0-100 — 50/25/25 — and ragas's calculate_split_values does
    # ceil(N x weight) with NO normalization, so a 100-question run with
    # those weights generated 10,000 samples, 100x the requested suite).
    # Fraction-style distributions (sum <= 1) pass through unchanged.
    total = sum(w for _, w in out)
    if total > 1.0 + 1e-9:
        out = [(s, w / total) for s, w in out]
    return out


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------


async def evaluate_samples(
    samples: list[dict],
    metrics: list[str] | None,
    timeout_s: int = 600,
    progress=None,
    cancel_event=None,
    judge: dict | None = None,
    embed: dict | None = None,
) -> dict:
    """Score samples with the selected metrics. Sample keys are his exact
    mapping (user_input / retrieved_contexts / response / reference) plus
    reference_contexts for the context-metrics that consume them.
    progress (optional): callback(phase, done=None, total=None) for the job
    registry — rows-done/rows-total is reported between evaluation batches.
    cancel_event (optional): checked between batches — a cancelled run
    reports cancelled rather than shipping scores the user abandoned.
    judge / embed (8-7 model configs): optional per-request model overrides
    resolved by okf-server (build_llm / build_embeddings carry the shapes)."""
    from ragas import EvaluationDataset, evaluate
    from ragas.run_config import RunConfig

    if progress:
        progress("scoring")
    metric_instances, dropped = resolve_metrics(metrics)
    if not metric_instances:
        raise RuntimeError("no metrics available (embedder unconfigured and only embedding metrics requested?)")

    llm = build_llm(temperature=0.0, judge=judge)
    embeddings = build_embeddings(embed=embed)

    rows = []
    for s in samples:
        row: dict[str, Any] = {
            "user_input": str(s.get("user_input") or ""),
            "retrieved_contexts": [str(c) for c in s.get("retrieved_contexts") or []],
            "response": str(s.get("response") or ""),
            "reference": str(s.get("reference") or ""),
        }
        if s.get("reference_contexts"):
            row["reference_contexts"] = [str(c) for c in s.get("reference_contexts")]
        rows.append(row)

    # Row-batched evaluation (2026-10-18, David: "progress bars per phase so
    # the user knows exactly what is happening"): one evaluate() per batch
    # gives an honest rows-done/rows-total signal between batches — the
    # judge calls dominate, so batch boundaries cost nothing measurable.
    # Default 1 (2026-10-19, David: "the scoring progress bar jumps 10 at a
    # time — it needs to jump 1 or 2 at a time"): per-row batches make the
    # bar tick per question and sharpen cancel response, at no measurable
    # cost for the same reason. Raise RAGAS_EVAL_BATCH_ROWS to coarsen.
    batch_rows = max(1, int(os.getenv("RAGAS_EVAL_BATCH_ROWS") or "1"))
    metric_names = [m.name for m in metric_instances]
    per_query: list[dict[str, Any]] = []
    total = len(rows)
    for offset in range(0, total, batch_rows):
        _check_cancel(cancel_event)
        chunk = rows[offset : offset + batch_rows]
        dataset = EvaluationDataset.from_list(chunk)
        # Same thread confinement as generation (2026-10-18): evaluate()
        # drives ragas's Executor, whose nest_asyncio reentrancy on the
        # uvicorn loop corrupts it; in a worker thread it takes the plain
        # asyncio.run path.
        result = await asyncio.to_thread(
            evaluate,
            dataset=dataset,
            metrics=metric_instances,
            llm=llm,
            embeddings=embeddings,
            run_config=RunConfig(timeout=int(timeout_s), max_workers=8),
            show_progress=False,
            raise_exceptions=False,
        )
        if progress is not None:
            progress("scoring", min(offset + len(chunk), total), total)
        frame = result.to_pandas()
        # RAGAS 0.4.3 names parameterized metrics' DataFrame columns with
        # their parameters — factual_correctness(mode=f1),
        # noise_sensitivity(mode=relevant) — while metric.name (and our
        # request/response vocabulary) stays the bare key. Reading the bare
        # key missed the column and nulled EVERY row of exactly those two
        # (live NCD run 2026-10-21: 79/79 rows null, both metrics invisible
        # in the results table and charts while scoring fine — the metric
        # computes 0.83 called directly). Map each requested key to its frame
        # column by prefix so both spellings resolve.
        colmap: dict[str, str] = {}
        for col in frame.columns:
            colmap.setdefault(str(col).split("(", 1)[0], str(col))
        for _, row in frame.iterrows():
            item = {
                "user_input": row.get("user_input"),
                "retrieved_contexts": list(row.get("retrieved_contexts") or []),
                "response": row.get("response"),
                "reference": row.get("reference"),
            }
            all_nan = True
            for name in metric_names:
                v = row.get(colmap.get(name, name))
                try:
                    f = float(v) if v is not None else None
                except (TypeError, ValueError):
                    f = None
                if f is not None and f != f:
                    # NaN is not JSON-compliant — null it (live 2026-10-18:
                    # a NaN metric 500'd every job poll and stranded the
                    # finished run behind starlette's allow_nan=False)
                    f = None
                item[name] = f
                if f is not None:
                    all_nan = False
            item["ragas_nan"] = "ALL_NAN" if all_nan else ""
            per_query.append(item)
    _check_cancel(cancel_event)

    aggregate = {}
    for name in metric_names:
        vals = [p[name] for p in per_query if p.get(name) is not None and p[name] == p[name]]
        aggregate[name] = (sum(vals) / len(vals)) if vals else None
    # Report the judge that ACTUALLY scored the run: a judge override (8-7
    # model configs) replaces the env default for every call, but this field
    # still reported RAGAS_JUDGE_MODEL — a live GLM-judged run was recorded
    # with the granite default's name (2026-10-21).
    effective_model = str(judge.get("model")) if judge and judge.get("model") else os.getenv("RAGAS_JUDGE_MODEL")
    return {
        "aggregate": aggregate,
        "per_query": per_query,
        "model": effective_model,
        "n": len(per_query),
        "dropped": dropped,
    }
