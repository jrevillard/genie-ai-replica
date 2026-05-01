"""Stage 2 -- Multi-engine translation.

v3.5 had two engines (phrasebank + LLM). v4.2 adds a third:
  * Engine A: PhraseBankEngine (in this file)
  * Engine B: LLMEngine (in this file, wraps v1 translator)
  * Engine C: NLLBEngine (in engines/nllb_engine.py, sidecar HTTP)

The v3.5 fast-path is preserved unchanged: when phrasebank coverage
is at or above ``V4_PHRASEBANK_COVERAGE_THRESHOLD``, that engine wins
without firing any other call -- saving the LLM round-trip AND the
NLLB round-trip.

When coverage is lower we fire NLLB and LLM concurrently and pick
whichever returned a usable translation with the highest confidence.
The Bambara-to-Mandinka adapter (Stage 3) runs INLINE inside the
NLLB engine helper so the selected translation is always Mandinka
by the time it leaves Stage 2 -- the pipeline.py orchestrator does
not need to know whether NLLB was used to assemble the result.

Selection priority when all three return non-empty:
    1. phrasebank      -- if confidence >= NLLB and >= LLM
    2. NLLB+adapter    -- otherwise highest confidence wins
    3. LLM

v4.2.1 latency optimizations (Fix 2 + Fix 5):
  * Sentence-level in-memory cache (SHA-256 keyed); only stores
    results with confidence >= 0.70 so we never serve a low-quality
    translation back out of cache.
  * Batched LLM and NLLB calls: ``translate_all()`` groups up to
    ``_BATCH_SIZE`` sentences and fires one LLM batch (numbered
    prompt) plus parallel NLLB calls per batch instead of one round
    trip per sentence. Per-sentence selection logic is preserved.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from . import config

logger = logging.getLogger(__name__)


# v4.2 lazy holders. Loading these at module import time would bring
# in aiohttp / manding_transfer even when the v4 flag is off, so we
# defer to first call.
_NLLB_ENGINE = None
_BAMBARA_ADAPTER = None

# v4.2.1 Fix 2 -- batch size for LLM/NLLB grouping. 10 keeps a single
# LLM prompt under the model's max_tokens budget for typical clinical
# sentences, and 10 concurrent NLLB HTTP calls comfortably fit under
# the sidecar's worker pool without queueing.
_BATCH_SIZE = 10

# v4.2.1 Fix 5 -- process-wide sentence cache. Key is SHA-256 of the
# raw English sentence; value is the full ``translate_sentence`` result
# dict. Only entries with selected_confidence >= _CACHE_MIN_CONFIDENCE
# are stored, so we never serve a low-quality translation from cache.
# In-memory; cleared on container restart.
# TODO(v4.3): replace with Redis-backed cache so warm hits survive
# restarts and propagate across replicas.
_SENTENCE_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_MIN_CONFIDENCE = 0.70


def _cache_key(sentence: str) -> str:
    return hashlib.sha256((sentence or "").strip().encode("utf-8")).hexdigest()


def _cache_get(sentence: str) -> Optional[Dict[str, Any]]:
    if not sentence or not sentence.strip():
        return None
    hit = _SENTENCE_CACHE.get(_cache_key(sentence))
    if hit is None:
        return None
    # Return a shallow copy so callers can stamp method/latency without
    # mutating the cached entry.
    out = dict(hit)
    out["method"] = "sentence_cache"
    out["sentence"] = sentence
    return out


def _cache_put(sentence: str, result: Dict[str, Any]) -> None:
    if not sentence or not sentence.strip():
        return
    try:
        if float(result.get("selected_confidence", 0.0)) < _CACHE_MIN_CONFIDENCE:
            return
    except (TypeError, ValueError):
        return
    # Store a stable subset -- engine_results contains per-call latencies
    # we don't want to replay, so we strip those before caching.
    _SENTENCE_CACHE[_cache_key(sentence)] = {
        "selected":             result.get("selected"),
        "selected_translation": result.get("selected_translation"),
        "selected_confidence":  result.get("selected_confidence"),
        "selection_reason":     result.get("selection_reason"),
        "engine_results":       result.get("engine_results"),
    }


def _get_nllb_engine():
    global _NLLB_ENGINE
    if _NLLB_ENGINE is None:
        try:
            from .engines.nllb_engine import NLLBEngine
            _NLLB_ENGINE = NLLBEngine()
        except Exception as e:
            logger.debug("v4.2.stage2: NLLB engine unavailable (%s)", e)
            _NLLB_ENGINE = False
    return _NLLB_ENGINE if _NLLB_ENGINE is not False else None


def _get_bambara_adapter():
    global _BAMBARA_ADAPTER
    if _BAMBARA_ADAPTER is None:
        try:
            from .stage3_bambara_adapter import BambaraMandinkaAdapter
            _BAMBARA_ADAPTER = BambaraMandinkaAdapter()
        except Exception as e:
            logger.debug("v4.2.stage2: Bambara adapter unavailable (%s)", e)
            _BAMBARA_ADAPTER = False
    return _BAMBARA_ADAPTER if _BAMBARA_ADAPTER is not False else None


# ── Phrasebank engine ────────────────────────────────────────────────

class PhraseBankEngine:
    """Assemble Mandinka from the validated phrase bank.

    Assembly is greedy longest-first: we try to match the longest
    English phrase available so we do not accidentally translate
    "blood pressure" word-by-word when "blood_pressure" is a single
    bank entry.

    This engine has zero LLM cost and ~0 ms latency. When coverage is
    high it is the right answer; when coverage is low, defer to LLM.
    """

    def __init__(self) -> None:
        # Lazy-loaded so importing this module never imports the bank
        # if v4 is disabled.
        self._english_to_mandinka: Optional[Dict[str, str]] = None

    def _load_bank(self) -> Dict[str, str]:
        if self._english_to_mandinka is not None:
            return self._english_to_mandinka
        try:
            from src.services.mandinka_phrases import PHRASES
        except Exception as e:
            logger.warning("v4.stage2: phrase bank unavailable (%s)", e)
            self._english_to_mandinka = {}
            return self._english_to_mandinka

        # Flatten { CATEGORY: { english_key: mandinka } } into a single
        # english-key -> mandinka map. The english_key uses underscores
        # in the bank ("blood_sugar"), so we accept both forms when
        # matching ("blood sugar" or "blood_sugar").
        flat: Dict[str, str] = {}
        for cat in PHRASES.values():
            if not isinstance(cat, dict):
                continue
            for en_key, ma_text in cat.items():
                if not isinstance(en_key, str) or not isinstance(ma_text, str):
                    continue
                flat[en_key.lower()] = ma_text
                flat[en_key.replace("_", " ").lower()] = ma_text
        self._english_to_mandinka = flat
        return flat

    def translate(self, sentence: str) -> Dict[str, Any]:
        bank = self._load_bank()
        if not bank or not sentence.strip():
            return {
                "translation": "",
                "coverage": 0.0,
                "matched_phrases": [],
                "unmatched_words": sentence.split(),
                "confidence": 0.0,
                "method": "assembly",
            }

        # Greedy longest-first match. We sort the bank keys once per
        # sentence; for a few hundred entries this is fine.
        keys_by_length = sorted(bank.keys(), key=len, reverse=True)
        text_lower = " " + sentence.lower() + " "
        consumed: List[bool] = [False] * len(text_lower)

        matched_phrases: List[Dict[str, str]] = []
        out_pieces: List[str] = []

        # We walk left-to-right, snapping onto the first key that
        # matches at this cursor and isn't already consumed.
        i = 0
        while i < len(text_lower):
            ch = text_lower[i]
            if consumed[i] or not ch.isalnum():
                if ch.strip():
                    out_pieces.append(ch)
                i += 1
                continue
            best_key: Optional[str] = None
            for key in keys_by_length:
                key_l = " " + key + " "  # word-boundary by spaces around the key
                # Test against window starting one char back so the
                # leading space matches.
                start = max(0, i - 1)
                end = start + len(key_l)
                if text_lower[start:end] == key_l and not any(consumed[start:end]):
                    best_key = key
                    break
            if best_key is not None:
                key_l = " " + best_key + " "
                start = max(0, i - 1)
                end = start + len(key_l)
                for j in range(start + 1, end - 1):
                    consumed[j] = True
                matched_phrases.append({"en": best_key, "ma": bank[best_key]})
                out_pieces.append(bank[best_key])
                # Skip past the matched span (minus the trailing space
                # so we don't gobble the next token's leading boundary).
                i = end - 1
            else:
                # Take the current word as unmatched, advance to next space.
                j = i
                while j < len(text_lower) and not text_lower[j].isspace():
                    j += 1
                out_pieces.append(text_lower[i:j])
                i = j

        # Coverage = fraction of word-tokens that were matched.
        original_words = re.findall(r"[A-Za-z']+", sentence.lower())
        unmatched_words: List[str] = []
        for w in original_words:
            if not any(w in mp["en"] for mp in matched_phrases):
                unmatched_words.append(w)
        total = max(1, len(original_words))
        coverage = max(0.0, 1.0 - (len(unmatched_words) / total))

        translation = re.sub(r"\s+", " ", "".join(out_pieces)).strip()
        return {
            "translation":      translation,
            "coverage":         round(coverage, 3),
            "matched_phrases":  matched_phrases,
            "unmatched_words":  unmatched_words,
            "confidence":       round(coverage * 0.95 if matched_phrases else 0.0, 3),
            "method":           "assembly",
        }


# ── LLM engine (delegates to v1 translator) ──────────────────────────

class LLMEngine:
    """Wraps the existing v1 translator. No changes to translator.py.

    This class is intentionally thin: it exists so Stage 2 can call
    the v1 path through a stable interface that v4.2 can later swap
    out for a different engine without touching translator.py.
    """

    async def translate(self, sentence: str) -> Dict[str, Any]:
        if not sentence.strip():
            return {"translation": "", "confidence": 0.0, "method": "llm_v1"}
        try:
            from src.services.translator import get_translator
            translated = await get_translator().translate(sentence, "en", "ma")
        except Exception as e:
            logger.warning("v4.stage2: LLM translate failed (%s: %s)", type(e).__name__, e)
            return {"translation": sentence, "confidence": 0.0, "method": "llm_v1", "error": str(e)[:120]}
        # Confidence is unknown without a quality probe; we default to
        # 0.65 (mid-range) and let Stage 5 score the actual output.
        return {
            "translation":  translated,
            "confidence":   0.65,
            "method":       "llm_v1",
        }

    async def translate_batch(self, sentences: List[str]) -> List[Dict[str, Any]]:
        """v4.2.1 Fix 2 -- one LLM call for up to ``_BATCH_SIZE`` sentences.

        Delegates to ``Translator.translate_batch`` which already builds
        a numbered prompt and parses numbered output. Empty sentences
        get a synthetic empty result so the returned list aligns 1:1
        with the input -- caller can index by position.
        """
        if not sentences:
            return []
        results: List[Dict[str, Any]] = [
            {"translation": "", "confidence": 0.0, "method": "llm_v1"}
            for _ in sentences
        ]
        # Build the keyed dict only for non-empty sentences so we don't
        # waste a slot in the LLM prompt on whitespace.
        keyed: Dict[str, str] = {}
        for idx, s in enumerate(sentences):
            if s and s.strip():
                keyed[str(idx)] = s

        if not keyed:
            return results

        try:
            from src.services.translator import get_translator
            translated = await get_translator().translate_batch(keyed, "en", "ma")
        except Exception as e:
            logger.warning(
                "v4.2.stage2: LLM translate_batch failed (%s: %s); falling back to per-sentence",
                type(e).__name__, e,
            )
            # Fall back to per-sentence translate so a single bad batch
            # doesn't blank out the whole document. Runs sequentially --
            # this branch is the unhappy path, so we accept the latency.
            for idx, s in enumerate(sentences):
                if not (s and s.strip()):
                    continue
                results[idx] = await self.translate(s)
            return results

        for idx_str, out in (translated or {}).items():
            try:
                idx = int(idx_str)
            except (TypeError, ValueError):
                continue
            if 0 <= idx < len(results):
                results[idx] = {
                    "translation":  out or "",
                    "confidence":   0.65 if (out or "").strip() else 0.0,
                    "method":       "llm_v1_batch",
                }
        return results


# ── Orchestrator ─────────────────────────────────────────────────────

class MultiEngineTranslator:
    """Run available engines and pick best per sentence."""

    def __init__(self) -> None:
        self.phrasebank = PhraseBankEngine()
        self.llm = LLMEngine()

    async def translate_sentence(self, sentence: str, context: Optional[dict] = None) -> Dict[str, Any]:
        t0 = time.perf_counter()

        # v4.2.1 Fix 5 -- cache check before any engine runs. We only
        # cache results with confidence >= _CACHE_MIN_CONFIDENCE so a
        # hit is implicitly "good enough to serve".
        cached = _cache_get(sentence)
        if cached is not None:
            return {
                "sentence":             sentence,
                "engine_results":       cached.get("engine_results") or {},
                "selected":             cached.get("selected"),
                "selected_translation": cached.get("selected_translation"),
                "selected_confidence":  cached.get("selected_confidence"),
                "selection_reason":     "sentence_cache_hit",
                "method":               "sentence_cache",
                "latency_ms":           int((time.perf_counter() - t0) * 1000),
            }

        engine_results: Dict[str, Any] = {}

        # Engine A: phrasebank (always free, always first).
        pb = self.phrasebank.translate(sentence)
        engine_results["phrasebank"] = pb

        # Auto-win when coverage is high. v3.5 fast-path -- preserved.
        if pb["coverage"] >= config.V4_PHRASEBANK_COVERAGE_THRESHOLD:
            return {
                "sentence":             sentence,
                "engine_results":       engine_results,
                "selected":             "phrasebank",
                "selected_translation": pb["translation"],
                "selected_confidence":  pb["confidence"],
                "selection_reason":     f"phrase_bank_coverage>={config.V4_PHRASEBANK_COVERAGE_THRESHOLD:.2f}",
                "latency_ms":           int((time.perf_counter() - t0) * 1000),
            }

        # v4.2: race NLLB and LLM. Phrasebank's partial result is also
        # in the running for selection. NLLB is only fired when the
        # sidecar reports healthy; otherwise we degrade to v3.5 (LLM
        # only) without paying the connection-error timeout.
        nllb_engine = _get_nllb_engine() if config.NLLB_ENABLED else None
        adapter = _get_bambara_adapter() if config.BAMBARA_ADAPTER_ENABLED else None

        nllb_task: Optional[asyncio.Task] = None
        if nllb_engine is not None:
            try:
                if await nllb_engine.is_available():
                    nllb_task = asyncio.create_task(self._run_nllb(nllb_engine, adapter, sentence))
            except Exception as e:
                logger.debug("v4.2.stage2: NLLB availability probe failed (%s)", e)

        llm_task = asyncio.create_task(self.llm.translate(sentence))

        # Wait for whichever engines we fired. ``return_exceptions=True``
        # keeps one failure from sinking the other engine.
        pending = [t for t in (nllb_task, llm_task) if t is not None]
        gathered = await asyncio.gather(*pending, return_exceptions=True)

        nllb_result: Optional[Dict[str, Any]] = None
        llm_result: Optional[Dict[str, Any]] = None
        for task, result in zip(pending, gathered):
            if isinstance(result, BaseException):
                logger.warning("v4.2.stage2: engine task raised: %s", result)
                continue
            if task is nllb_task:
                nllb_result = result
                engine_results["nllb"] = result
            elif task is llm_task:
                llm_result = result
                engine_results["llm"] = result

        # Selection: highest confidence wins. Phrasebank's partial
        # output is allowed to win when its confidence beats both
        # network engines (the bank is native-validated).
        candidates: List[tuple] = []
        if pb.get("translation") and pb.get("confidence", 0.0) > 0:
            candidates.append(("phrasebank", pb["translation"], float(pb["confidence"])))
        if nllb_result and nllb_result.get("translation"):
            candidates.append(("nllb", nllb_result["translation"], float(nllb_result.get("confidence", 0.0))))
        if llm_result and llm_result.get("translation"):
            candidates.append(("llm", llm_result["translation"], float(llm_result.get("confidence", 0.0))))

        if candidates:
            candidates.sort(key=lambda c: c[2], reverse=True)
            selected, translation, confidence = candidates[0]
            reason = f"highest_confidence={confidence:.2f}"
        else:
            # All engines empty/failed -- pass the original through so
            # the corrector / scorer downstream see something to work
            # with rather than an empty string.
            selected = "fallback_passthrough"
            translation = sentence
            confidence = 0.0
            reason = "all_engines_returned_empty"

        result = {
            "sentence":             sentence,
            "engine_results":       engine_results,
            "selected":             selected,
            "selected_translation": translation,
            "selected_confidence":  confidence,
            "selection_reason":     reason,
            "latency_ms":           int((time.perf_counter() - t0) * 1000),
        }
        # v4.2.1 Fix 5 -- cache only when the result is high-confidence.
        _cache_put(sentence, result)
        return result

    async def _run_nllb(
        self,
        nllb_engine,
        adapter,
        sentence: str,
    ) -> Dict[str, Any]:
        """Engine C: English -> NLLB -> Bambara -> adapter -> Mandinka.

        Confidence is the minimum of the NLLB confidence and the
        adapter confidence -- so a great Bambara translation that the
        adapter could not convert (e.g., Bambara word with no Mandinka
        equivalent) does not get a falsely high score.
        """
        nllb_out = await nllb_engine.translate_to_bambara(sentence)
        bambara = nllb_out.get("bambara_text") or ""
        if not bambara.strip():
            return {
                "translation":          None,
                "confidence":           0.0,
                "method":               "nllb_bambara_bridge",
                "bambara_intermediate": None,
                "latency_ms":           int(nllb_out.get("latency_ms", 0)),
                "error":                nllb_out.get("error"),
            }

        # Stage 3: Bambara -> Mandinka adaptation. Skipped (passthrough)
        # when BAMBARA_ADAPTER_ENABLED is off or the adapter is unavailable;
        # in that case we serve raw Bambara at reduced confidence.
        if adapter is not None:
            adapted = await adapter.adapt(bambara)
        else:
            adapted = {
                "mandinka_text":        bambara,
                "adaptations_applied":  0,
                "method":               "adapter_disabled",
                "confidence":           0.45,
                "latency_ms":           0,
            }
        confidence = min(
            float(nllb_out.get("confidence", 0.0)),
            float(adapted.get("confidence", 0.0)),
        )
        return {
            "translation":          adapted.get("mandinka_text"),
            "confidence":           round(confidence, 3),
            "method":               "nllb_bambara_bridge",
            "bambara_intermediate": bambara,
            "adapter_method":       adapted.get("method"),
            "adapter_substitutions": adapted.get("adaptations_applied", 0),
            "latency_ms":           int(nllb_out.get("latency_ms", 0)) + int(adapted.get("latency_ms", 0)),
        }

    async def translate_all(
        self,
        simplified_sentences: List[str],
        context: Optional[dict] = None,
    ) -> List[Dict[str, Any]]:
        """Translate every simplified sentence and preserve input order.

        v4.2.1 Fix 2 batches sentences in groups of ``_BATCH_SIZE``:
          * Cache hits are returned without firing any engine.
          * Phrasebank runs synchronously per sentence; sentences whose
            coverage clears the auto-win threshold short-circuit and
            never invoke LLM or NLLB.
          * For the remaining sentences we fire ONE LLM batch call and
            ``asyncio.gather`` of NLLB calls in parallel, then run the
            same per-sentence selection logic the single-sentence path
            uses.
        """
        if not simplified_sentences:
            return []

        # Pre-allocate so we can write results back in order.
        results: List[Optional[Dict[str, Any]]] = [None] * len(simplified_sentences)

        # ── Pass 1: cache lookup ────────────────────────────────────
        uncached_idx: List[int] = []
        for i, sentence in enumerate(simplified_sentences):
            cached = _cache_get(sentence) if (sentence and sentence.strip()) else None
            if cached is not None:
                results[i] = {
                    "sentence":             sentence,
                    "engine_results":       cached.get("engine_results") or {},
                    "selected":             cached.get("selected"),
                    "selected_translation": cached.get("selected_translation"),
                    "selected_confidence":  cached.get("selected_confidence"),
                    "selection_reason":     "sentence_cache_hit",
                    "method":               "sentence_cache",
                    "latency_ms":           0,
                }
            else:
                uncached_idx.append(i)

        if not uncached_idx:
            return [r for r in results if r is not None]

        # ── Pass 2: batch the uncached sentences ────────────────────
        for chunk_start in range(0, len(uncached_idx), _BATCH_SIZE):
            chunk_idx = uncached_idx[chunk_start:chunk_start + _BATCH_SIZE]
            await self._translate_batch(simplified_sentences, chunk_idx, results)

        # Defensive: any slot that somehow stayed None falls back to the
        # input string with zero confidence so callers see something.
        for i, sentence in enumerate(simplified_sentences):
            if results[i] is None:
                results[i] = {
                    "sentence":             sentence,
                    "engine_results":       {},
                    "selected":             "fallback_passthrough",
                    "selected_translation": sentence,
                    "selected_confidence":  0.0,
                    "selection_reason":     "missing_batch_slot",
                    "latency_ms":           0,
                }
        return [r for r in results]  # type: ignore[return-value]

    async def _translate_batch(
        self,
        all_sentences: List[str],
        chunk_idx: List[int],
        results: List[Optional[Dict[str, Any]]],
    ) -> None:
        """Translate one batch of up to ``_BATCH_SIZE`` sentences and
        write results back into ``results`` at the input indices.

        Phrasebank runs first per sentence: any sentence whose coverage
        clears ``V4_PHRASEBANK_COVERAGE_THRESHOLD`` is finalised inline
        and excluded from the LLM/NLLB batch. Whatever's left fires LLM
        batch + per-sentence NLLB tasks concurrently via ``asyncio.gather``.
        """
        if not chunk_idx:
            return

        t_batch_start = time.perf_counter()

        # Stage A -- phrasebank per sentence (synchronous, no I/O).
        # Build a parallel structure tracking per-sentence state:
        #   pb_results[i]  -- phrasebank dict
        #   needs_engine[i] -- True iff we still need LLM/NLLB for this sentence
        pb_results: Dict[int, Dict[str, Any]] = {}
        needs_engine: List[int] = []
        for i in chunk_idx:
            sentence = all_sentences[i]
            pb = self.phrasebank.translate(sentence)
            pb_results[i] = pb
            if pb.get("coverage", 0.0) >= config.V4_PHRASEBANK_COVERAGE_THRESHOLD:
                # Auto-win -- finalise immediately, no engine call.
                result = {
                    "sentence":             sentence,
                    "engine_results":       {"phrasebank": pb},
                    "selected":             "phrasebank",
                    "selected_translation": pb["translation"],
                    "selected_confidence":  pb["confidence"],
                    "selection_reason":     f"phrase_bank_coverage>={config.V4_PHRASEBANK_COVERAGE_THRESHOLD:.2f}",
                    "latency_ms":           0,
                }
                results[i] = result
                _cache_put(sentence, result)
            else:
                needs_engine.append(i)

        if not needs_engine:
            return

        # Stage B -- fire LLM batch + per-sentence NLLB tasks concurrently.
        engine_sentences: List[str] = [all_sentences[i] for i in needs_engine]

        nllb_engine = _get_nllb_engine() if config.NLLB_ENABLED else None
        adapter = _get_bambara_adapter() if config.BAMBARA_ADAPTER_ENABLED else None

        nllb_available = False
        if nllb_engine is not None:
            try:
                nllb_available = await nllb_engine.is_available()
            except Exception as e:
                logger.debug("v4.2.stage2: NLLB availability probe failed (%s)", e)
                nllb_available = False

        # Launch tasks: one batched LLM call, plus per-sentence NLLB
        # tasks (NLLB has no batch endpoint, but ``asyncio.gather`` over
        # ten HTTP calls runs effectively concurrently).
        llm_task = asyncio.create_task(self.llm.translate_batch(engine_sentences))
        nllb_tasks: List[Optional[asyncio.Task]] = []
        if nllb_available and nllb_engine is not None:
            for s in engine_sentences:
                nllb_tasks.append(
                    asyncio.create_task(self._run_nllb(nllb_engine, adapter, s))
                )
        else:
            nllb_tasks = [None] * len(engine_sentences)

        # Await everything -- ``return_exceptions=True`` keeps one bad
        # call from sinking the rest of the batch.
        gather_targets = [llm_task] + [t for t in nllb_tasks if t is not None]
        gathered = await asyncio.gather(*gather_targets, return_exceptions=True)

        llm_results_or_err = gathered[0]
        if isinstance(llm_results_or_err, BaseException):
            logger.warning("v4.2.stage2: LLM batch task raised: %s", llm_results_or_err)
            llm_results: List[Dict[str, Any]] = [
                {"translation": "", "confidence": 0.0, "method": "llm_v1_batch", "error": str(llm_results_or_err)[:120]}
                for _ in engine_sentences
            ]
        else:
            llm_results = llm_results_or_err  # type: ignore[assignment]

        # Re-thread NLLB results back to their sentence positions.
        nllb_results: List[Optional[Dict[str, Any]]] = [None] * len(engine_sentences)
        gather_cursor = 1  # gathered[0] is the LLM task
        for pos, t in enumerate(nllb_tasks):
            if t is None:
                continue
            res = gathered[gather_cursor]
            gather_cursor += 1
            if isinstance(res, BaseException):
                logger.warning("v4.2.stage2: NLLB task raised: %s", res)
                continue
            nllb_results[pos] = res  # type: ignore[assignment]

        # Stage C -- per-sentence selection.
        for pos, sent_idx in enumerate(needs_engine):
            sentence = all_sentences[sent_idx]
            pb = pb_results[sent_idx]
            llm_r = llm_results[pos] if pos < len(llm_results) else None
            nllb_r = nllb_results[pos]

            engine_results: Dict[str, Any] = {"phrasebank": pb}
            candidates: List[Tuple[str, str, float]] = []
            if pb.get("translation") and pb.get("confidence", 0.0) > 0:
                candidates.append(("phrasebank", pb["translation"], float(pb["confidence"])))
            if nllb_r and nllb_r.get("translation"):
                engine_results["nllb"] = nllb_r
                candidates.append(("nllb", nllb_r["translation"], float(nllb_r.get("confidence", 0.0))))
            if llm_r and llm_r.get("translation"):
                engine_results["llm"] = llm_r
                candidates.append(("llm", llm_r["translation"], float(llm_r.get("confidence", 0.0))))

            if candidates:
                candidates.sort(key=lambda c: c[2], reverse=True)
                selected, translation, confidence = candidates[0]
                reason = f"highest_confidence={confidence:.2f}"
            else:
                selected = "fallback_passthrough"
                translation = sentence
                confidence = 0.0
                reason = "all_engines_returned_empty"

            result = {
                "sentence":             sentence,
                "engine_results":       engine_results,
                "selected":             selected,
                "selected_translation": translation,
                "selected_confidence":  confidence,
                "selection_reason":     reason,
                "latency_ms":           int((time.perf_counter() - t_batch_start) * 1000),
            }
            results[sent_idx] = result
            _cache_put(sentence, result)
