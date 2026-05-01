"""v3.5 / v4.2 pipeline orchestrator.

Stages run in sequence: 1 -> 2 -> (3 inline in 2 when NLLB wins) ->
4 -> 5 -> 6 -> 7 -> 8.

In v3.5 Stage 3 (Bambara adapter) was a no-op; in v4.2 it runs INSIDE
Stage 2's NLLB engine helper so the selected translation is already
Mandinka by the time Stage 2 returns. Pipeline.py does not need a
separate stage call -- it just records whether the NLLB path was
chosen for any sentence so telemetry can attribute latency.

Latency budget: < 3.0 s typical with NLLB sidecar healthy.
    Stage 1 simplifier   ~50 ms
    Stage 2 multi-engine ~300 ms (NLLB ~200 + LLM ~600, run in parallel)
    Stage 3 adapter      ~30 ms (only when NLLB selected)
    Stage 4 back-trans   ~300 ms (NLLB cross-model) | ~600 ms (LLM)
    Stage 5 scorer       ~20 ms
    Stage 6 corrector    ~28 ms
    Stage 7 router       ~5 ms
    Stage 8 telemetry    ~5 ms async (off-path; never blocks)
    Total best case (all phrasebank):       ~750 ms
    Total NLLB+adapter+NLLB-back path:      ~1.5 s
    Total LLM-only path (v3.5 fallback):    ~1.7-3.5 s

v4.2.1 Fix 3 -- batched + pipelined Stage 2/Stage 4. Sentences are
split into chunks of ``_BATCH_SIZE``. Each chunk runs Stage 2 in one
batched call (one LLM round-trip + parallel NLLB) and immediately
spawns a Stage 4 back-translation as ``asyncio.create_task`` so the
NEXT chunk's Stage 2 overlaps the PREVIOUS chunk's Stage 4. For
single-batch documents this is functionally identical to the old
sequential flow.

If we exceed ``V4_MAX_LATENCY_MS``, the next call skips back-
translation and logs WARNING. The user is never blocked: any
unhandled exception falls through to the next stage; worst case
("everything failed") returns None and the v1 path runs unchanged.

When ``AMINA_TRANSLATION_V4_ENABLED`` is False, ``translate`` returns
``None`` immediately. The integration layer treats that as "use v1".
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

from . import config
from .stage1_simplifier import ClinicalSimplifier
from .stage2_multi_engine import MultiEngineTranslator
from .stage4_back_translator import BackTranslationVerifier
from .stage5_quality_scorer import TranslationQualityScorer
from .stage6_clinical_gate import ClinicalSafetyGate
from .stage7_sentence_router import SentenceRouter
from .stage8_telemetry import TranslationTelemetry

logger = logging.getLogger(__name__)


# Process-wide singleton -- no point recreating stage objects per call.
_PIPELINE: "Optional[TranslationV4Pipeline]" = None
# Soft latency-budget bypass: when the previous call exceeded the
# budget, the next call skips back-translation. Resets on a clean run.
_SKIP_BACK_TRANSLATION_NEXT_CALL = False

# v4.2.1 Fix 3 -- chunk size for the pipelined Stage 2 / Stage 4 flow.
# Must match (or be a multiple of) stage2's _BATCH_SIZE so we don't
# split the LLM batch across two pipeline iterations.
_BATCH_SIZE = 10

# v4.2.1 -- log a WARNING when total pipeline latency exceeds this.
# The hard budget (V4_MAX_LATENCY_MS, default 3500ms) is per-call and
# triggers back-translation skip on the NEXT call; this softer signal
# is for documents long enough that a single call is allowed to run
# for many seconds. 15s is the validation target for a 30-sentence
# document.
_LATENCY_WARN_MS = 15_000


# ── Recommendation merging across batches ─────────────────────────────
# Higher rank = worse outcome; merging picks the worst across batches.
_RECOMMENDATION_RANK = {
    "HIGH_CONFIDENCE":      0,
    "MEDIUM_CONFIDENCE":    1,
    "LOW_CONFIDENCE":       2,
    "SKIPPED":              3,
    "SKIPPED_LATENCY":      3,
    "BLOCK":                4,
}


def _merge_bt_results(parts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Combine per-batch back-translation results into one document-level
    result for Stage 5/6 to consume. Picks the WORST recommendation,
    AND-merges entity preservation flags, averages similarity, and
    extends critical divergences. Returns None when no parts exist."""
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]

    # Concatenate back-translated text in batch order.
    back_chunks = [p.get("back_translated_english") for p in parts if p.get("back_translated_english")]
    back_concat = " ".join(c for c in back_chunks if c) or None

    # Average similarity weighted equally per batch.
    sims = [float(p.get("semantic_similarity") or 0.0) for p in parts]
    avg_sim = round(sum(sims) / len(sims), 3) if sims else 0.0

    # AND-merge entities. Default missing flags to True (no evidence of
    # divergence) so a SKIPPED batch doesn't drag down the document.
    keys = ("numbers", "negations", "food_names")
    merged_ent = {k: True for k in keys}
    for p in parts:
        ent = p.get("entities_preserved") or {}
        for k in keys:
            merged_ent[k] = bool(merged_ent[k]) and bool(ent.get(k, True))

    # Extend critical divergences across batches.
    critical: List[Dict[str, Any]] = []
    for p in parts:
        critical.extend(p.get("critical_divergences") or [])

    # Pick worst recommendation; ties resolve to the first occurrence.
    worst = parts[0]
    worst_rank = _RECOMMENDATION_RANK.get(str(parts[0].get("recommendation", "")), 0)
    for p in parts[1:]:
        r = _RECOMMENDATION_RANK.get(str(p.get("recommendation", "")), 0)
        if r > worst_rank:
            worst = p
            worst_rank = r

    # Min confidence -- failsafe. A single bad batch should not be
    # masked by averaging.
    confidences = [float(p.get("confidence") or 0.0) for p in parts]
    min_conf = round(min(confidences), 3) if confidences else 0.0

    # Forward / back engine attribution: pick from first batch that
    # actually ran (skip SKIPPED placeholders).
    fwd = "n/a"
    back_eng = "n/a"
    for p in parts:
        if p.get("recommendation") not in ("SKIPPED", "SKIPPED_LATENCY"):
            fwd = p.get("engine_used_forward") or fwd
            back_eng = p.get("engine_used_back") or back_eng
            break
    if fwd == "n/a" and parts:
        fwd = parts[0].get("engine_used_forward") or "n/a"
        back_eng = parts[0].get("engine_used_back") or "n/a"

    return {
        "back_translated_english":  back_concat,
        "semantic_similarity":      avg_sim,
        "entities_preserved":       merged_ent,
        "critical_divergences":     critical,
        "confidence":               min_conf,
        "recommendation":           worst.get("recommendation", "SKIPPED"),
        "engine_used_forward":      fwd,
        "engine_used_back":         back_eng,
        "batches":                  len(parts),
    }


def get_pipeline() -> "TranslationV4Pipeline":
    global _PIPELINE
    if _PIPELINE is None:
        _PIPELINE = TranslationV4Pipeline()
    return _PIPELINE


class TranslationV4Pipeline:

    def __init__(self) -> None:
        self.simplifier = ClinicalSimplifier()
        self.multi_engine = MultiEngineTranslator()
        self.back_translator = BackTranslationVerifier()
        self.scorer = TranslationQualityScorer()
        self.gate = ClinicalSafetyGate()
        self.router = SentenceRouter()
        self.telemetry = TranslationTelemetry()

    async def translate(
        self,
        english_text: str,
        patient_context: Optional[Dict[str, Any]] = None,
        *,
        session_id: Optional[str] = None,
        response_type: str = "general",
    ) -> Optional[Dict[str, Any]]:
        """Run the v3.5 pipeline. Returns None when the flag is off.

        On success returns a dict with at minimum:
            ``assembled_output``, ``overall_decision``, ``mandinka_ratio``,
            ``quality_scores``, ``stage_latencies``, ``total_latency_ms``.
        """
        if not config.AMINA_TRANSLATION_V4_ENABLED:
            return None

        global _SKIP_BACK_TRANSLATION_NEXT_CALL
        skip_back_this_call = _SKIP_BACK_TRANSLATION_NEXT_CALL
        # Reset the flag now -- if THIS call exceeds budget we set it
        # again at the end so the NEXT call skips.
        _SKIP_BACK_TRANSLATION_NEXT_CALL = False

        start = time.perf_counter()
        stage_latencies: Dict[str, int] = {}
        # Defaults so a partial pipeline still produces a sane record.
        simplified = {"simplified": english_text or "", "sentences": []}
        engine_results: list = []
        bt_result: Optional[Dict[str, Any]] = None
        gate_result: Optional[Dict[str, Any]] = None
        scored: Dict[str, Any] = {}
        router_result: Dict[str, Any] = {}

        # ── Stage 1: simplify ───────────────────────────────────────
        try:
            t = time.perf_counter()
            simplified = self.simplifier.simplify(english_text or "")
            stage_latencies["simplifier"] = int((time.perf_counter() - t) * 1000)
        except Exception as e:
            logger.warning("v4.pipeline: simplifier failed (%s: %s)", type(e).__name__, e)

        sentences_in = [s["simplified"] for s in (simplified.get("sentences") or []) if s.get("simplified")]
        if not sentences_in:
            sentences_in = [simplified.get("simplified") or (english_text or "")]

        # ── Stage 2 + Stage 4: batched, pipelined ───────────────────
        # v4.2.1 Fix 3: split the document into chunks of _BATCH_SIZE.
        # For each chunk we run Stage 2 (one batched LLM + parallel
        # NLLB) and immediately spawn the chunk's Stage 4 back-trans
        # as an asyncio task. The NEXT chunk's Stage 2 then overlaps
        # the PREVIOUS chunk's Stage 4. For single-chunk documents
        # this collapses to the old sequential flow.
        bt_parts: List[Dict[str, Any]] = []
        bt_tasks: List[Optional[asyncio.Task]] = []
        bt_chunk_meta: List[Dict[str, Any]] = []  # forward_engine + chunk_index per task

        # Pre-build chunks of input sentences.
        chunks: List[List[str]] = [
            sentences_in[i:i + _BATCH_SIZE] for i in range(0, len(sentences_in), _BATCH_SIZE)
        ] or [sentences_in]

        try:
            t_stage2 = time.perf_counter()
            for chunk in chunks:
                # Stage 2 for this chunk -- batched per-engine internally.
                try:
                    chunk_results = await self.multi_engine.translate_all(chunk, patient_context or {})
                except Exception as e:
                    logger.warning(
                        "v4.pipeline: multi-engine chunk failed (%s: %s)",
                        type(e).__name__, e,
                    )
                    chunk_results = []
                engine_results.extend(chunk_results)

                # Compose chunk-level Mandinka and English-source segments
                # for the back-translation task. We back-translate per
                # chunk so Stage 4 can run concurrently with the NEXT
                # chunk's Stage 2.
                chunk_mandinka = " ".join(
                    r.get("selected_translation", "") for r in chunk_results
                    if r.get("selected_translation")
                ).strip()
                chunk_simplified_en = " ".join(s for s in chunk if s).strip()

                if skip_back_this_call:
                    # Synthesize a SKIPPED placeholder so the merge step
                    # still has a slot for this chunk; no task to await.
                    bt_parts.append({
                        "back_translated_english":  None,
                        "semantic_similarity":      0.0,
                        "entities_preserved":       {"numbers": True, "negations": True, "food_names": True},
                        "critical_divergences":     [],
                        "confidence":               0.5,
                        "recommendation":           "SKIPPED_LATENCY",
                        "engine_used_forward":      "n/a",
                        "engine_used_back":         "skipped_budget",
                    })
                    bt_tasks.append(None)
                    bt_chunk_meta.append({"forward": "skipped"})
                    continue

                forward_engine = (
                    "phrasebank" if (chunk_results and all(r.get("selected") == "phrasebank" for r in chunk_results))
                    else "llm_v1"
                )
                # Spawn Stage 4 for this chunk as a background task --
                # the NEXT iteration's Stage 2 starts immediately.
                task = asyncio.create_task(
                    self.back_translator.verify(
                        original_simplified_english=chunk_simplified_en,
                        mandinka_translation=chunk_mandinka,
                        forward_engine=forward_engine,
                    )
                )
                bt_tasks.append(task)
                bt_chunk_meta.append({"forward": forward_engine})
                # Pre-allocate a slot in bt_parts that we'll fill in
                # after awaiting the task below; using None as a sentinel.
                bt_parts.append(None)  # type: ignore[arg-type]
            stage_latencies["multi_engine"] = int((time.perf_counter() - t_stage2) * 1000)
        except Exception as e:
            logger.warning("v4.pipeline: multi-engine pipelined loop failed (%s: %s)", type(e).__name__, e)

        # Single Mandinka string for the corrector and downstream stages.
        joined_mandinka = " ".join(
            r.get("selected_translation", "") for r in engine_results if r.get("selected_translation")
        ).strip()

        # ── Await Stage 4 tasks ─────────────────────────────────────
        try:
            t_bt = time.perf_counter()
            pending_indices = [i for i, t in enumerate(bt_tasks) if t is not None]
            if pending_indices:
                gathered = await asyncio.gather(
                    *[bt_tasks[i] for i in pending_indices],
                    return_exceptions=True,
                )
                for slot, res in zip(pending_indices, gathered):
                    if isinstance(res, BaseException):
                        logger.warning(
                            "v4.pipeline: back-translation chunk %d failed (%s: %s)",
                            slot, type(res).__name__, res,
                        )
                        bt_parts[slot] = {
                            "back_translated_english":  None,
                            "semantic_similarity":      0.0,
                            "entities_preserved":       {"numbers": False, "negations": False, "food_names": False},
                            "critical_divergences":     [{"type": "back_translate_error", "detail": str(res)[:120]}],
                            "confidence":               0.0,
                            "recommendation":           "BLOCK",
                            "engine_used_forward":      bt_chunk_meta[slot].get("forward", "n/a"),
                            "engine_used_back":         "error",
                        }
                    else:
                        bt_parts[slot] = res  # type: ignore[assignment]
            # Drop any None left in bt_parts (shouldn't happen, but
            # guard against pre-allocated slots that never got filled).
            bt_parts_clean: List[Dict[str, Any]] = [p for p in bt_parts if p is not None]
            bt_result = _merge_bt_results(bt_parts_clean)
            stage_latencies["back_translation"] = int((time.perf_counter() - t_bt) * 1000)
        except Exception as e:
            logger.warning("v4.pipeline: back-translation merge failed (%s: %s)", type(e).__name__, e)

        # ── Stage 6: clinical gate (corrector wrapper) ──────────────
        try:
            t = time.perf_counter()
            gate_result = self.gate.gate(
                mandinka_text=joined_mandinka,
                english_source=simplified.get("simplified") or (english_text or ""),
                patient_context=patient_context or {},
                response_type=response_type,
            )
            stage_latencies["corrector"] = int((time.perf_counter() - t) * 1000)
            # If the corrector rewrote the text, prefer the corrected
            # version downstream.
            if gate_result and gate_result.get("corrected_text"):
                joined_mandinka = gate_result["corrected_text"]
        except Exception as e:
            logger.warning("v4.pipeline: clinical gate failed (%s: %s)", type(e).__name__, e)

        # ── Stage 5: quality score ──────────────────────────────────
        try:
            t = time.perf_counter()
            scored = self.scorer.score(
                engine_results=engine_results,
                back_translation_result=bt_result,
                corrector_result=gate_result,
            )
            stage_latencies["scorer"] = int((time.perf_counter() - t) * 1000)
        except Exception as e:
            logger.warning("v4.pipeline: scorer failed (%s: %s)", type(e).__name__, e)
            scored = {}

        # Apply Stage 6's confidence adjustment to the overall score.
        if gate_result and scored.get("overall") is not None:
            adj = float(gate_result.get("confidence_adjustment") or 0.0)
            if adj:
                scored["overall"] = round(max(0.0, min(1.0, float(scored["overall"]) + adj)), 3)

        # ── Stage 7: route per-sentence ─────────────────────────────
        try:
            t = time.perf_counter()
            router_result = self.router.route(
                scored=scored,
                engine_results=engine_results,
                clinical_safety=float((scored or {}).get("clinical_safety") or 0.0),
            )
            stage_latencies["router"] = int((time.perf_counter() - t) * 1000)
        except Exception as e:
            logger.warning("v4.pipeline: router failed (%s: %s)", type(e).__name__, e)
            router_result = {
                "sentences":            [],
                "overall_decision":     "SERVE_ENGLISH",
                "mandinka_ratio":       0.0,
                "assembly_strategy":    "fallback_english",
                "assembled_output":     english_text or "",
            }

        # ── Stage 8: telemetry (off-path, never raises) ─────────────
        total_latency = int((time.perf_counter() - start) * 1000)
        try:
            t = time.perf_counter()
            self.telemetry.log_translation(
                session_id=session_id,
                engine_results=engine_results,
                scored=scored,
                back_translation=bt_result,
                corrector_result=gate_result,
                router_result=router_result,
                total_latency_ms=total_latency,
                stage_latencies=stage_latencies,
            )
            stage_latencies["telemetry"] = int((time.perf_counter() - t) * 1000)
        except Exception as e:
            logger.warning("v4.pipeline: telemetry failed (%s: %s)", type(e).__name__, e)

        # If we blew the budget, set the bypass flag for the next call.
        if total_latency > config.V4_MAX_LATENCY_MS:
            _SKIP_BACK_TRANSLATION_NEXT_CALL = True
            logger.warning(
                "v4.pipeline: latency %dms > budget %dms; skipping back-translation on next call",
                total_latency, config.V4_MAX_LATENCY_MS,
            )
        # v4.2.1 -- soft warn on long-document budgets too. The hard
        # budget above is per-call; this signal is for documents large
        # enough that we expect multiple seconds, but anything beyond
        # _LATENCY_WARN_MS suggests the batched/pipelined path isn't
        # actually overlapping (e.g. NLLB sidecar down + sequential
        # LLM fallback) and is worth flagging for ops.
        if total_latency > _LATENCY_WARN_MS:
            logger.warning(
                "v4.pipeline: total latency %dms exceeds soft threshold %dms (sentences=%d, batches=%d)",
                total_latency, _LATENCY_WARN_MS,
                len(sentences_in), len(chunks) if 'chunks' in locals() else 1,
            )

        # v4.2: any sentence routed through NLLB also went through the
        # Bambara adapter (Stage 3 ran inline in Stage 2). Surface that
        # fact for diagnostics + telemetry attribution.
        nllb_invoked = any(r.get("selected") == "nllb" for r in engine_results)

        return {
            "assembled_output":     router_result.get("assembled_output", english_text or ""),
            "overall_decision":     router_result.get("overall_decision", "SERVE_ENGLISH"),
            "mandinka_ratio":       router_result.get("mandinka_ratio", 0.0),
            "per_sentence":         router_result.get("sentences", []),
            "quality_scores":       {k: scored.get(k) for k in ("overall", "clinical_safety", "semantic_fidelity", "fluency", "cultural_fit") if k in (scored or {})},
            "back_translation":     bt_result,
            "engine_selection":     [r.get("selected") for r in engine_results],
            "nllb_invoked":         nllb_invoked,
            "stage3_invoked":       nllb_invoked,  # Stage 3 only fires when NLLB wins
            "simplified_english":   simplified.get("simplified"),
            "stage_latencies":      stage_latencies,
            "total_latency_ms":     total_latency,
        }
