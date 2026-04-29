"""
AMINA Care — Clinical Re-Ranker Registry (Phase 1)
====================================================
A/B testing infrastructure for re-ranker models. Supports hot-swapping
the re-ranker via env var RAG_RERANKER_MODEL without code changes.

Models:
  ms-marco-mini   — current default, fast but clinically naive
  bge-reranker-v2 — multilingual, best zero-shot base for fine-tuning
  ms-marco-large  — larger ms-marco, moderate latency
  jina-reranker   — multilingual with long-context support
  amina-clinical  — fine-tuned on WHO PEN + AMINA feedback (Phase 3)

Usage:
  from src.services.reranker_registry import get_reranker, get_active_model_key

  ranker = get_reranker()           # returns Haystack component
  key = get_active_model_key()      # returns model key string
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional

_log = logging.getLogger("reranker_registry")

# ═══════════════════════════════════════════════════════════════════════════════
# MODEL REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

RERANKER_MODELS: Dict[str, Dict[str, Any]] = {
    "ms-marco-mini": {
        "model": "cross-encoder/ms-marco-MiniLM-L-6-v2",
        "type": "cross-encoder",
        "latency_ms": 15,
        "clinical_score": None,
        "description": "General web-search re-ranker (current default)",
    },
    "bge-reranker-v2": {
        "model": "BAAI/bge-reranker-v2-m3",
        "type": "cross-encoder",
        "latency_ms": 100,
        "clinical_score": None,
        "description": "Multilingual re-ranker, best base for clinical fine-tuning",
    },
    "ms-marco-large": {
        "model": "cross-encoder/ms-marco-MiniLM-L-12-v2",
        "type": "cross-encoder",
        "latency_ms": 40,
        "clinical_score": None,
        "description": "Larger ms-marco variant with better accuracy",
    },
    "jina-reranker": {
        "model": "jinaai/jina-reranker-v2-base-multilingual",
        "type": "cross-encoder",
        "latency_ms": 50,
        "clinical_score": None,
        "description": "Multilingual with long-context support",
    },
    "amina-clinical": {
        "model": "models/amina-reranker",
        "type": "cross-encoder",
        "latency_ms": None,
        "clinical_score": None,
        "description": "Fine-tuned on WHO PEN + AMINA feedback data",
    },
}

DEFAULT_MODEL_KEY = "ms-marco-mini"

# ═══════════════════════════════════════════════════════════════════════════════
# MODEL SELECTION
# ═══════════════════════════════════════════════════════════════════════════════


def get_active_model_key() -> str:
    """Return the active re-ranker model key from env or default."""
    key = os.getenv("RAG_RERANKER_MODEL", DEFAULT_MODEL_KEY).strip()
    if key not in RERANKER_MODELS:
        _log.warning(
            "Unknown reranker model '%s', falling back to '%s'. "
            "Available: %s",
            key, DEFAULT_MODEL_KEY, ", ".join(RERANKER_MODELS.keys()),
        )
        return DEFAULT_MODEL_KEY
    return key


def get_active_model_id() -> str:
    """Return the HuggingFace model ID for the active re-ranker."""
    key = get_active_model_key()
    return RERANKER_MODELS[key]["model"]


def get_model_info(key: Optional[str] = None) -> Dict[str, Any]:
    """Return metadata for a model (or the active model)."""
    key = key or get_active_model_key()
    return RERANKER_MODELS.get(key, RERANKER_MODELS[DEFAULT_MODEL_KEY])


# ═══════════════════════════════════════════════════════════════════════════════
# HAYSTACK COMPONENT FACTORY
# ═══════════════════════════════════════════════════════════════════════════════

_cached_ranker = None
_cached_key = None


def get_reranker(force_key: Optional[str] = None):
    """Create or return a cached Haystack SentenceTransformersSimilarityRanker.

    The ranker is cached — calling get_reranker() multiple times returns
    the same instance unless force_key changes the model.
    """
    global _cached_ranker, _cached_key

    key = force_key or get_active_model_key()
    if _cached_ranker is not None and _cached_key == key:
        return _cached_ranker

    model_id = RERANKER_MODELS[key]["model"]
    _log.info("Loading re-ranker: %s (%s)", key, model_id)

    try:
        from haystack.components.rankers import TransformersSimilarityRanker
        ranker_cls = TransformersSimilarityRanker
    except ImportError:
        from haystack.components.rankers import SentenceTransformersSimilarityRanker
        ranker_cls = SentenceTransformersSimilarityRanker

    from haystack.utils import ComponentDevice

    t0 = time.monotonic()
    ranker = ranker_cls(
        model=model_id,
        top_k=3,
        device=ComponentDevice.from_str("cpu"),
    )

    try:
        ranker.warm_up()
        elapsed = (time.monotonic() - t0) * 1000
        _log.info("Re-ranker '%s' loaded in %.0fms", key, elapsed)
    except Exception as e:
        _log.warning("Re-ranker '%s' warm-up failed: %s", key, e)

    _cached_ranker = ranker
    _cached_key = key
    return ranker


# ═══════════════════════════════════════════════════════════════════════════════
# A/B TESTING SUPPORT
# ═══════════════════════════════════════════════════════════════════════════════


def score_with_model(
    model_key: str,
    query: str,
    documents: list,
) -> list:
    """Score documents with a specific re-ranker model (for A/B eval).

    Returns list of (doc, score) tuples sorted by score descending.
    """
    from haystack import Document as HDoc

    info = get_model_info(model_key)
    model_id = info["model"]

    try:
        from sentence_transformers import CrossEncoder
        ce = CrossEncoder(model_id)
    except ImportError:
        _log.warning("sentence-transformers not available for A/B scoring")
        return [(d, 0.0) for d in documents]

    pairs = [(query, d.content if hasattr(d, "content") else str(d)) for d in documents]
    scores = ce.predict(pairs)

    scored = list(zip(documents, scores))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def compare_models(
    query: str,
    documents: list,
    model_keys: list = None,
) -> Dict[str, list]:
    """Compare multiple re-ranker models on the same query+documents.

    Returns dict of model_key → [(doc, score), ...] sorted by score.
    """
    if model_keys is None:
        model_keys = [k for k in RERANKER_MODELS if k != "amina-clinical"]

    results = {}
    for key in model_keys:
        try:
            t0 = time.monotonic()
            scored = score_with_model(key, query, documents)
            elapsed = (time.monotonic() - t0) * 1000
            results[key] = {
                "scores": scored,
                "latency_ms": round(elapsed, 1),
            }
        except Exception as e:
            _log.warning("Model %s failed: %s", key, e)
            results[key] = {"scores": [], "error": str(e)}

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# REGISTRY INFO
# ═══════════════════════════════════════════════════════════════════════════════


def list_models() -> Dict[str, Dict]:
    """Return all registered re-ranker models with metadata."""
    active = get_active_model_key()
    out = {}
    for key, info in RERANKER_MODELS.items():
        out[key] = {**info, "active": key == active}
    return out


def update_clinical_score(model_key: str, score: float):
    """Update the clinical_score for a model after evaluation."""
    if model_key in RERANKER_MODELS:
        RERANKER_MODELS[model_key]["clinical_score"] = round(score, 4)
        _log.info("Updated clinical score for %s: %.4f", model_key, score)
