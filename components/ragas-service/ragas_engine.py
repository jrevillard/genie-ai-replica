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


async def generate_testset(
    documents: list[dict],
    testset_size: int,
    query_distribution: list[dict] | None = None,
    num_personas: int = 3,
) -> dict:
    """Generate benchmark-suite samples from concept documents.

    documents: [{page_content, metadata}] — concept bodies with repo/concept
    metadata. Multi-repo input feeds ONE knowledge graph so multi-hop
    synthesizers cross repo boundaries. query_distribution (optional)
    overrides the default synthesizer mix, as [{synthesizer, weight}].
    """
    from langchain_core.documents import Document as LCDocument
    from ragas.run_config import RunConfig
    from ragas.testset import TestsetGenerator
    from ragas.testset.graph import KnowledgeGraph, Node, NodeType
    from ragas.testset.transforms import apply_transforms, default_transforms

    llm = build_llm(temperature=0.3)  # generation benefits from mild creativity
    embeddings = build_embeddings()
    if embeddings is None:
        raise RuntimeError("RAGAS_EMBED_MODEL is required for testset generation (KG transforms embed)")

    docs = [
        LCDocument(page_content=str(d.get("page_content") or ""), metadata=dict(d.get("metadata") or {}))
        for d in documents
    ]
    generator = TestsetGenerator(llm=llm, embedding_model=embeddings)

    # generate_with_langchain_docs() (ragas 0.4.3) does NOT accept
    # num_personas — only generate() does. Replicate the wrapper's own
    # body (verified against its source: default transforms → DOCUMENT
    # nodes → apply_transforms → generate) so the persona count rides
    # through, per the user-settable-dimensions contract.
    transforms = default_transforms(documents=docs, llm=llm, embedding_model=embeddings)
    nodes = [
        Node(
            type=NodeType.DOCUMENT,
            properties={"page_content": doc.page_content, "document_metadata": doc.metadata},
        )
        for doc in docs
    ]
    kg = KnowledgeGraph(nodes=nodes)
    apply_transforms(kg, transforms, run_config=RunConfig())
    generator.knowledge_graph = kg

    dist = _resolve_distribution(query_distribution, llm)
    testset = generator.generate(
        testset_size=int(testset_size),
        query_distribution=dist,
        num_personas=int(num_personas),
        raise_exceptions=False,
    )

    samples = []
    for ts in testset.samples:
        s = ts.eval_sample
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
    return {
        "samples": samples,
        "generator": {"model": os.getenv("RAGAS_JUDGE_MODEL"), "embed_model": os.getenv("RAGAS_EMBED_MODEL")},
    }


def _resolve_distribution(query_distribution: list[dict] | None, llm):
    """Map [{synthesizer, weight}] specs to a ragas QueryDistribution.

    synthesizer is one of single_hop_specific | multi_hop_abstract |
    multi_hop_specific (the ragas testset synthesizers). The judge llm is
    injected into each instance — a bare cls() triggers ragas's default
    OpenAI() client, which raises without OPENAI_API_KEY (sovereign
    deployments must never need one).
    """
    if not query_distribution:
        return None
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
        out.append((cls(llm=llm), weight))
    return out


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------


async def evaluate_samples(samples: list[dict], metrics: list[str] | None, timeout_s: int = 600) -> dict:
    """Score samples with the selected metrics. Sample keys are his exact
    mapping (user_input / retrieved_contexts / response / reference) plus
    reference_contexts for the context-metrics that consume them."""
    from ragas import EvaluationDataset, evaluate
    from ragas.run_config import RunConfig

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
    result = evaluate(
        dataset=dataset,
        metrics=metric_instances,
        llm=llm,
        embeddings=embeddings,
        run_config=RunConfig(timeout=int(timeout_s), max_workers=8),
        show_progress=False,
        raise_exceptions=False,
    )

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
