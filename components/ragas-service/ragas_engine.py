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
            n = self._effective_n(kwargs.pop("n", None), self.n)
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
            n = self._effective_n(kwargs.pop("n", None), self.n)
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


def build_llm(temperature: float = 0.0):
    """Wrap the judge endpoint as a ragas LLM. Deferred-imported so /health
    never pays the langchain import cost and tests can stub this module."""
    import httpx
    from langchain_openai import ChatOpenAI
    from ragas.llms import LangchainLLMWrapper

    base = _judge_base_url()
    if not base or not os.getenv("RAGAS_JUDGE_MODEL"):
        raise RuntimeError("judge endpoint not configured (RAGAS_JUDGE_BASE_URL / RAGAS_JUDGE_MODEL)")

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
    if max_tokens > 0:
        kwargs["max_tokens"] = max_tokens
    fanout_cls = _make_fanout_class(ChatOpenAI)
    inner = fanout_cls(
        base_url=base,
        api_key=os.getenv("RAGAS_JUDGE_API_KEY") or "sk-no-key",
        model=os.getenv("RAGAS_JUDGE_MODEL"),
        temperature=temperature,
        http_client=sync_client,
        http_async_client=async_client,
        timeout=300,
        **kwargs,
    )
    return LangchainLLMWrapper(inner)


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


def build_embeddings():
    """Wrap the embedder endpoint. Returns None when unconfigured —
    answer_relevancy is then dropped from the wanted metrics with a loud
    warning (his documented pitfall: silent drop).

    RAGAS_EMBED_API selects the dialect: 'tei' (default — POSTs
    {RAGAS_EMBED_BASE_URL}/embed with {inputs, truncate}, the project's
    TEI-behind-nginx contract) or 'openai' (any OpenAI-compatible
    embeddings endpoint, e.g. LiteLLM — uses /embeddings)."""
    from ragas.embeddings import LangchainEmbeddingsWrapper

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

    def __init__(self, inner, cancel_event: threading.Event | None = None):
        self._inner = inner
        self._cancel = cancel_event

    @property
    def name(self):
        return self._inner.name

    def _cancelled(self) -> bool:
        return self._cancel is not None and self._cancel.is_set()

    async def generate_scenarios(self, n, knowledge_graph, persona_list, callbacks=None):
        if self._cancelled():
            return []
        try:
            return await self._inner.generate_scenarios(
                n=n, knowledge_graph=knowledge_graph, persona_list=persona_list, callbacks=callbacks
            )
        except Exception as e:  # noqa: BLE001 — dropping this batch IS the recovery
            logger.warning("scenario generation failed for %s (dropping its questions): %s", self.name, e)
            return []

    async def generate_sample(self, scenario, callbacks=None):
        if self._cancelled():
            return _empty_sample()
        try:
            return await self._inner.generate_sample(scenario=scenario, callbacks=callbacks)
        except Exception as e:  # noqa: BLE001 — dropping this question IS the recovery
            logger.warning("sample synthesis failed for %s (dropping question): %s", self.name, e)
            return _empty_sample()


async def generate_testset(
    documents: list[dict],
    testset_size: int,
    query_distribution: list[dict] | None = None,
    num_personas: int = 3,
    progress=None,
    cancel_event: threading.Event | None = None,
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
    """
    from langchain_core.documents import Document as LCDocument
    from ragas.run_config import RunConfig
    from ragas.testset import TestsetGenerator
    from ragas.testset.graph import KnowledgeGraph, Node, NodeType
    from ragas.testset.transforms import apply_transforms

    llm = build_llm(temperature=0.3)  # generation benefits from mild creativity
    embeddings = build_embeddings()
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
    await asyncio.to_thread(apply_transforms, kg, transforms, run_config=RunConfig())
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
    dist = _resolve_distribution(query_distribution, llm, kg=kg, cancel_event=cancel_event)
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
        return [(_TolerantSynthesizer(s, cancel_event), w) for s, w in base]
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
        out.append((_TolerantSynthesizer(cls(llm=llm), cancel_event), weight))
    return out


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------


async def evaluate_samples(
    samples: list[dict], metrics: list[str] | None, timeout_s: int = 600, progress=None, cancel_event=None
) -> dict:
    """Score samples with the selected metrics. Sample keys are his exact
    mapping (user_input / retrieved_contexts / response / reference) plus
    reference_contexts for the context-metrics that consume them.
    progress (optional): callback str -> None for the job registry.
    cancel_event (optional): checked when evaluate() returns — a cancelled
    run reports cancelled rather than shipping scores the user abandoned."""
    from ragas import EvaluationDataset, evaluate
    from ragas.run_config import RunConfig

    if progress:
        progress("scoring")
    metric_instances, dropped = resolve_metrics(metrics)
    if not metric_instances:
        raise RuntimeError("no metrics available (embedder unconfigured and only embedding metrics requested?)")

    llm = build_llm(temperature=0.0)
    embeddings = build_embeddings()

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

    dataset = EvaluationDataset.from_list(rows)
    # Same thread confinement as generation (2026-10-18): evaluate() drives
    # ragas's Executor, whose nest_asyncio reentrancy on the uvicorn loop
    # corrupts it; in a worker thread it takes the plain asyncio.run path.
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
    _check_cancel(cancel_event)

    per_query = []
    frame = result.to_pandas()
    metric_names = [m.name for m in metric_instances]
    for _, row in frame.iterrows():
        item = {
            "user_input": row.get("user_input"),
            "retrieved_contexts": list(row.get("retrieved_contexts") or []),
            "response": row.get("response"),
            "reference": row.get("reference"),
        }
        all_nan = True
        for name in metric_names:
            v = row.get(name)
            try:
                f = float(v) if v is not None else None
            except (TypeError, ValueError):
                f = None
            item[name] = f
            if f is not None and f == f:
                all_nan = False
        item["ragas_nan"] = "ALL_NAN" if all_nan else ""
        per_query.append(item)

    aggregate = {}
    for name in metric_names:
        vals = [p[name] for p in per_query if p.get(name) is not None and p[name] == p[name]]
        aggregate[name] = (sum(vals) / len(vals)) if vals else None
    return {
        "aggregate": aggregate,
        "per_query": per_query,
        "model": os.getenv("RAGAS_JUDGE_MODEL"),
        "n": len(per_query),
        "dropped": dropped,
    }
