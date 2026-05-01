"""Stage 4 -- Back-translation verification.

Round-trips Mandinka through the LLM back to English and compares
against the simplified source. Catches meaning drift that quality
scores alone miss (negation flips, dropped numbers, swapped foods).

v3.5 limitation: same provider for forward and back; we mitigate by
using a different temperature.
TODO: v4.2 -- use NLLB for back-translation to eliminate same-model
circularity.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from . import config

logger = logging.getLogger(__name__)


# Negation tokens we care about preserving across the round-trip.
# English + Mandinka, lowercase. "kana" is the Mandinka prohibitive.
_NEGATION_TOKENS = re.compile(
    r"\b(?:not|don't|do not|never|avoid|stop|kana|maŋ|te)\b",
    re.IGNORECASE,
)
_NUMBER_TOKEN = re.compile(r"\b\d+(?:[.,]\d+)?\b")


def _negation_count(text: str) -> int:
    return len(_NEGATION_TOKENS.findall(text or ""))


def _numbers_in(text: str) -> List[str]:
    return _NUMBER_TOKEN.findall(text or "")


def _semantic_similarity_fallback(a: str, b: str) -> float:
    """Heuristic similarity used when sentence-transformer model is
    unavailable. Token Jaccard with stopword removal -- crude, but
    monotonic and bounded in [0, 1] so the threshold logic still works.

    Production use of v4.2 should plug in the real all-MiniLM-L6-v2
    embeddings already loaded for RAG (see TODO below).
    """
    stop = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "to", "of", "in", "on", "for", "with", "and", "or", "but", "your",
        "you", "i", "we", "it", "this", "that",
    }
    def toks(t: str) -> set:
        return {w.lower() for w in re.findall(r"[A-Za-z]+", t or "") if w.lower() not in stop}
    sa, sb = toks(a), toks(b)
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return round(inter / union, 3) if union else 0.0


def _semantic_similarity(a: str, b: str) -> float:
    """Try the real sentence-embedding model first; fall back to
    Jaccard if it isn't available. The model is the same MiniLM the
    RAG layer already loads, so when v4 runs alongside RAG this is
    free; in isolated unit tests the fallback path keeps the pipeline
    deterministic and dependency-free.

    TODO: v4.2 -- pin to the canonical RAG embedder so similarity
    scores match between this stage and the retrieval gate.
    """
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        import numpy as np  # type: ignore
        model = _get_cached_model()
        if model is None:
            return _semantic_similarity_fallback(a, b)
        emb = model.encode([a or "", b or ""], normalize_embeddings=True)
        sim = float(np.dot(emb[0], emb[1]))
        return round(max(0.0, min(1.0, sim)), 3)
    except Exception:
        return _semantic_similarity_fallback(a, b)


_CACHED_MODEL = None


def _get_cached_model():
    """Reuse one MiniLM instance per process. Returns None when the
    library is not installed -- pipeline degrades to Jaccard fallback."""
    global _CACHED_MODEL
    if _CACHED_MODEL is not None:
        return _CACHED_MODEL
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        _CACHED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
    except Exception as e:
        logger.debug("v4.stage4: sentence-transformers not loaded (%s)", e)
        _CACHED_MODEL = None
    return _CACHED_MODEL


class BackTranslationVerifier:
    """Mandinka -> English round-trip.

    v3.5: same LLM, raised temperature -- partial circularity break.
    v4.2: NLLB sidecar Bambara->English when forward engine was the LLM,
    and LLM at temperature=0 when forward engine was NLLB. Either path
    crosses model families, which is the actual fix for circularity.
    Falls back to the v3.5 temp-shift path automatically when NLLB is
    unavailable.
    """

    def __init__(self) -> None:
        # NLLB engine is shared with Stage 2 via lazy module-level
        # singleton; we look it up on first use to keep imports cheap.
        self._nllb_engine = None

    def _get_nllb_engine(self):
        if self._nllb_engine is not None:
            return self._nllb_engine if self._nllb_engine is not False else None
        try:
            from .engines.nllb_engine import NLLBEngine
            self._nllb_engine = NLLBEngine()
        except Exception as e:
            logger.debug("v4.2.stage4: NLLB engine unavailable (%s)", e)
            self._nllb_engine = False
            return None
        return self._nllb_engine

    async def _try_nllb_back(self, mandinka_text: str) -> Optional[str]:
        """Bambara is ~65% lexically overlapping with Mandinka, so NLLB
        ``bam_Latn -> eng_Latn`` reads Mandinka well enough to catch
        negation flips and dropped numbers even though some content
        words come back transliterated. Returns None on any failure
        path so the caller can fall through to LLM."""
        engine = self._get_nllb_engine()
        if engine is None:
            return None
        if not await engine.is_available():
            return None
        try:
            result = await engine.translate_bambara_to_english(mandinka_text)
            text = result.get("english_text") or ""
            return text.strip() or None
        except Exception as e:
            logger.debug("v4.2.stage4: NLLB back-translate failed: %s", e)
            return None

    async def _llm_back_translate(self, mandinka_text: str, temperature: float = 0.3) -> str:
        """Round-trip via the existing v1 translator. Falls back to the
        no-temperature signature when ``Translator.translate`` does not
        accept ``temperature`` -- v1's public surface does not expose
        the knob today; v4.2 will plumb it through in a follow-up."""
        try:
            from src.services.translator import get_translator
            translator = get_translator()
        except Exception as e:
            logger.warning("v4.2.stage4: translator unavailable (%s)", e)
            return ""
        try:
            try:
                return await translator.translate(
                    mandinka_text,
                    source="ma",
                    target="en",
                    temperature=temperature,  # type: ignore[arg-type]
                )
            except TypeError:
                return await translator.translate(mandinka_text, "ma", "en")
        except Exception as e:
            logger.warning("v4.2.stage4: LLM back-translate failed (%s: %s)", type(e).__name__, e)
            return ""

    async def verify(
        self,
        original_simplified_english: str,
        mandinka_translation: str,
        forward_engine: str,
        food_names: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        # Phrasebank output is native-validated; back-translation is a
        # waste of an LLM call. Stage 2 sets forward_engine="phrasebank"
        # only on auto-win (coverage >= threshold).
        if forward_engine == "phrasebank":
            return {
                "back_translated_english":  None,
                "semantic_similarity":      1.0,
                "entities_preserved":       {"numbers": True, "negations": True, "food_names": True},
                "critical_divergences":     [],
                "confidence":               0.95,
                "recommendation":           "HIGH_CONFIDENCE",
                "engine_used_forward":      forward_engine,
                "engine_used_back":         "skipped_phrasebank",
            }

        if not config.V4_BACK_TRANSLATION_ENABLED or not mandinka_translation.strip():
            return {
                "back_translated_english":  None,
                "semantic_similarity":      0.0,
                "entities_preserved":       {"numbers": False, "negations": False, "food_names": False},
                "critical_divergences":     [],
                "confidence":               0.0,
                "recommendation":           "SKIPPED",
                "engine_used_forward":      forward_engine,
                "engine_used_back":         "disabled",
            }

        # v4.2 cross-model path: when forward engine was the LLM and the
        # NLLB sidecar is healthy, use NLLB Bambara->English for the
        # back-leg. That eliminates the same-model circularity that
        # makes the v3.5 LLM round-trip score itself too generously.
        # When forward engine was NLLB, do the inverse (LLM at temp=0).
        # When NLLB is unavailable we fall back to v3.5 behaviour
        # (same LLM, raised temperature).
        back_text: str = ""
        engine_used_back = "unset"
        try:
            if (
                forward_engine in ("llm", "llm_v1")
                and config.V4_BACK_TRANSLATION_PREFER_NLLB
            ):
                nllb_back = await self._try_nllb_back(mandinka_translation)
                if nllb_back is not None:
                    back_text = nllb_back
                    engine_used_back = "nllb_cross_model"
            elif forward_engine in ("nllb", "nllb_bambara_bridge"):
                # Forward was NLLB -- use the LLM at temperature=0 for the
                # back leg to break circularity in the other direction.
                back_text = await self._llm_back_translate(mandinka_translation, temperature=0.0)
                engine_used_back = "llm_cross_model_temp_zero"

            if not back_text:
                # Fallback (also v3.5 behaviour): same LLM, raised temperature.
                back_text = await self._llm_back_translate(
                    mandinka_translation,
                    temperature=config.V4_BACK_TRANSLATION_TEMPERATURE,
                )
                if engine_used_back == "unset":
                    engine_used_back = "llm_temp_shift_fallback"
        except Exception as e:
            logger.warning("v4.stage4: back-translation failed (%s: %s)", type(e).__name__, e)
            return {
                "back_translated_english":  None,
                "semantic_similarity":      0.0,
                "entities_preserved":       {"numbers": False, "negations": False, "food_names": False},
                "critical_divergences":     [{"type": "back_translate_error", "detail": str(e)[:120]}],
                "confidence":               0.0,
                "recommendation":           "BLOCK",
                "engine_used_forward":      forward_engine,
                "engine_used_back":         "error",
            }

        sim = _semantic_similarity(original_simplified_english, back_text or "")

        original_negs = _negation_count(original_simplified_english)
        back_negs = _negation_count(back_text or "")
        original_nums = sorted(_numbers_in(original_simplified_english))
        back_nums = sorted(_numbers_in(back_text or ""))
        food_set = {f.lower() for f in (food_names or [])}
        food_preserved = (
            all(f in (back_text or "").lower() for f in food_set)
            if food_set else True
        )

        critical: List[Dict[str, str]] = []
        if original_negs != back_negs:
            critical.append({
                "type":             "negation_count_mismatch",
                "original_count":   str(original_negs),
                "back_count":       str(back_negs),
                "severity":         "critical",
            })
        if original_nums != back_nums:
            critical.append({
                "type":         "number_set_mismatch",
                "original":     ",".join(original_nums) or "none",
                "back":         ",".join(back_nums) or "none",
                "severity":     "critical",
            })
        if food_set and not food_preserved:
            critical.append({
                "type":     "food_name_dropped",
                "missing":  ",".join(sorted(food_set - {f for f in food_set if f in (back_text or "").lower()})),
                "severity": "high",
            })

        # Recommendation logic: any critical negation/number divergence
        # blocks regardless of similarity. Otherwise, slot by similarity.
        if any(c.get("type") in ("negation_count_mismatch", "number_set_mismatch") for c in critical):
            recommendation = "BLOCK"
            confidence = 0.0
        elif sim >= 0.85:
            recommendation = "HIGH_CONFIDENCE"
            confidence = sim
        elif sim >= 0.70:
            recommendation = "MEDIUM_CONFIDENCE"
            confidence = sim
        elif sim >= 0.50:
            recommendation = "LOW_CONFIDENCE"
            confidence = sim
        else:
            recommendation = "BLOCK"
            confidence = sim

        return {
            "back_translated_english":  back_text,
            "semantic_similarity":      sim,
            "entities_preserved": {
                "numbers":      original_nums == back_nums,
                "negations":    original_negs == back_negs,
                "food_names":   food_preserved,
            },
            "critical_divergences":     critical,
            "confidence":               confidence,
            "recommendation":           recommendation,
            "engine_used_forward":      forward_engine,
            "engine_used_back":         engine_used_back,
        }
