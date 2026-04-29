"""Singleton construction for the v2 Router.

Kept separate from the FastAPI route module so imports at app startup
don't pull in heavy dependencies; tests can override the singleton via
`set_v2_router_for_testing`.

Constructs the Router using:
  - Glossary seed CSV at translation_v2/data/glossary_seed.csv
  - Providers listed in flags.V2_PRIMARY_PROVIDER / V2_FALLBACK_PROVIDER
  - NLLBProvider for the "local" slot (PII routing target)
  - v2 TranslationMemory with the shared Redis client
"""
from __future__ import annotations

import logging
from pathlib import Path

from translation_v2 import flags
from translation_v2.glossary import Glossary
from translation_v2.pii import PIIDetector
from translation_v2.prompts import build_system_prompt
from translation_v2.router import Router
from translation_v2.tm import TranslationMemory

logger = logging.getLogger(__name__)

_router_singleton: Router | None = None


def _make_system_prompt_fn(glossary: Glossary):
    snippet = glossary.prompt_snippet() if len(glossary) > 0 else ""

    def fn(source: str, target: str) -> str:
        return build_system_prompt(source, target, snippet)

    return fn


def _load_glossary() -> Glossary:
    glossary = Glossary()
    seed = Path(__file__).resolve().parents[1] / "data" / "glossary_seed.csv"
    try:
        glossary.load(seed)
    except Exception as e:  # very defensive — CSV parse error shouldn't kill startup
        logger.warning("Glossary seed load failed (non-fatal): %s", e)
    return glossary


def _build_providers(prompt_fn) -> dict:
    """Instantiate each provider. Unavailable providers are skipped (with a warning)."""
    from translation_v2.providers.gemma import GemmaProvider
    from translation_v2.providers.nllb import NLLBProvider
    from translation_v2.providers.openai import OpenAIProvider

    providers = {}
    for name, factory in (
        ("openai", lambda: OpenAIProvider.from_env(system_prompt_fn=prompt_fn)),
        ("gemma", lambda: GemmaProvider.from_env(system_prompt_fn=prompt_fn)),
        ("nllb", lambda: NLLBProvider()),
    ):
        try:
            providers[name] = factory()
        except Exception as e:
            logger.warning("v2 provider %r unavailable at startup: %s", name, e)
    return providers


def get_v2_router() -> Router:
    global _router_singleton
    if _router_singleton is not None:
        return _router_singleton

    glossary = _load_glossary()
    prompt_fn = _make_system_prompt_fn(glossary)
    providers = _build_providers(prompt_fn)

    primary_name = flags.V2_PRIMARY_PROVIDER
    fallback_name = flags.V2_FALLBACK_PROVIDER

    if primary_name not in providers:
        raise RuntimeError(
            f"V2_PRIMARY_PROVIDER={primary_name!r} is not available. "
            f"Loaded: {list(providers)}. Check env vars / dependencies."
        )

    primary = providers[primary_name]
    fallback = providers.get(fallback_name) if fallback_name != primary_name else None
    local = providers.get("nllb")

    tm = TranslationMemory()  # lazy Redis; shares memory_manager

    _router_singleton = Router(
        primary=primary,
        fallback=fallback,
        local=local,
        tm=tm,
        pii_detector=PIIDetector(),
        glossary=glossary,
    )
    logger.info(
        "v2 Router initialised: primary=%s fallback=%s local=%s flags=%s",
        primary.name,
        fallback.name if fallback else None,
        local.name if local else None,
        flags.snapshot(),
    )
    return _router_singleton


def set_v2_router_for_testing(router: Router | None) -> None:
    """Override / reset the singleton. Tests only — no production caller."""
    global _router_singleton
    _router_singleton = router


def reset_v2_router() -> None:
    set_v2_router_for_testing(None)


# ─────────────────────────────────────────────────────────────────────
# Step 5 — RAG pipeline singletons
# ─────────────────────────────────────────────────────────────────────
_vector_store_singleton = None
_retriever_singleton = None
_ingest_pipeline_singleton = None
_pdf_query_pipeline_singleton = None


def get_vector_store():
    global _vector_store_singleton
    if _vector_store_singleton is None:
        from translation_v2.rag.vector_store import InMemoryVectorStore
        _vector_store_singleton = InMemoryVectorStore()
    return _vector_store_singleton


def _build_embedder_for_rag():
    from translation_v2.rag.embedder import TEIEmbedder
    return TEIEmbedder()


def get_hybrid_retriever():
    global _retriever_singleton
    if _retriever_singleton is None:
        from translation_v2.rag.retrieve import HybridRetriever
        _retriever_singleton = HybridRetriever(
            vector_store=get_vector_store(),
            embedder=_build_embedder_for_rag(),
        )
        # Warm-index over anything already in the store (usually empty at boot).
        _retriever_singleton.index_corpus(get_vector_store().all_chunks())
    return _retriever_singleton


def get_ingest_pipeline():
    global _ingest_pipeline_singleton
    if _ingest_pipeline_singleton is None:
        from translation_v2.rag.chunker import LayoutAwareChunker
        from translation_v2.rag.ingest import IngestPipeline
        _ingest_pipeline_singleton = IngestPipeline(
            embedder=_build_embedder_for_rag(),
            vector_store=get_vector_store(),
            chunker=LayoutAwareChunker(),
        )
    return _ingest_pipeline_singleton


def _build_llm_generator_for_rag():
    from openai import AsyncOpenAI
    from src.config import settings
    from translation_v2.rag.llm_generator import LLMGenerator

    client = AsyncOpenAI(
        api_key=getattr(settings, "OPENAI_API_KEY", None),
        base_url=getattr(settings, "OPENAI_BASE_URL", None),
    )
    model = getattr(settings, "OPENAI_MODEL", "gpt-4o-mini")
    return LLMGenerator(client=client, model=model, max_tokens=800)


def _build_default_qe():
    from translation_v2.qe import (
        CompositeQE,
        HeuristicConfig,
        HeuristicQE,
        RepetitionHeuristicQE,
    )

    # Seed preserved terms from the glossary's do-not-translate rows
    preserved: list[str] = []
    try:
        preserved = _load_glossary().terms_to_preserve()
    except Exception:
        pass
    heuristic = HeuristicQE(
        HeuristicConfig(preserved_terms=preserved, threshold=0.6)
    )
    # Always run the repetition detector — catches degenerate
    # particle-loop output from small LLMs on low-resource langs.
    repetition = RepetitionHeuristicQE()
    return CompositeQE(
        [heuristic, repetition], threshold=flags.V2_RAG_QE_THRESHOLD
    )


def get_pdf_query_pipeline():
    global _pdf_query_pipeline_singleton
    if _pdf_query_pipeline_singleton is None:
        from translation_v2.post_process import clean_answer
        from translation_v2.rag.generate import AnswerStrategy, PDFQueryPipeline

        try:
            strategy = AnswerStrategy(flags.V2_RAG_DEFAULT_STRATEGY)
        except ValueError:
            logger.warning(
                "V2_RAG_DEFAULT_STRATEGY=%r is not a valid strategy; falling back to answer_then_translate",
                flags.V2_RAG_DEFAULT_STRATEGY,
            )
            strategy = AnswerStrategy.ANSWER_THEN_TRANSLATE

        _pdf_query_pipeline_singleton = PDFQueryPipeline(
            retriever=get_hybrid_retriever(),
            generator=_build_llm_generator_for_rag(),
            translator=get_v2_router(),
            qe=_build_default_qe(),
            post_process=clean_answer,
            default_strategy=strategy,
        )
    return _pdf_query_pipeline_singleton


def set_pdf_query_pipeline_for_testing(pipeline) -> None:
    global _pdf_query_pipeline_singleton
    _pdf_query_pipeline_singleton = pipeline


def set_ingest_pipeline_for_testing(pipeline) -> None:
    global _ingest_pipeline_singleton
    _ingest_pipeline_singleton = pipeline


def set_vector_store_for_testing(store) -> None:
    global _vector_store_singleton, _retriever_singleton
    _vector_store_singleton = store
    _retriever_singleton = None  # force rebuild against the new store


def set_hybrid_retriever_for_testing(retriever) -> None:
    global _retriever_singleton
    _retriever_singleton = retriever


def reset_rag_singletons() -> None:
    global _vector_store_singleton, _retriever_singleton
    global _ingest_pipeline_singleton, _pdf_query_pipeline_singleton
    _vector_store_singleton = None
    _retriever_singleton = None
    _ingest_pipeline_singleton = None
    _pdf_query_pipeline_singleton = None
