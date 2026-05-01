"""Stage 8 -- Telemetry.

v3.5: structured JSON line via the standard Python logger.
v4.2: same JSON line PLUS fire-and-forget persistence to ArcadeDB
``TranslationMetric`` vertex so the scorecard pipeline can graph
regressions over time. Safe fields ONLY: no PHI, no patient
identifiers, no free-text translation content. The session id is
hashed before logging.

ArcadeDB persistence is gated by ``V4_TELEMETRY_ARCADEDB`` and is
strictly fire-and-forget -- if the database is down or the schema
hasn't been bootstrapped yet, the telemetry call still succeeds; we
just lose that one row.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from collections import deque
from typing import Any, Deque, Dict, Iterable, Optional

from . import config

logger = logging.getLogger("amina.translation_v4.telemetry")


# ── ArcadeDB persistence (v4.2) ──────────────────────────────────────

# Schema is created on first use (idempotent). We separate type
# creation from property creation because some ArcadeDB versions
# return non-2xx for "type already exists" but accept individual
# property statements; running them one at a time is robust.
_SCHEMA_TYPE_SQL = "CREATE VERTEX TYPE TranslationMetric IF NOT EXISTS"

_SCHEMA_PROPERTY_SQLS: tuple = (
    "CREATE PROPERTY TranslationMetric.trace_id                       IF NOT EXISTS STRING",
    "CREATE PROPERTY TranslationMetric.session_hash                   IF NOT EXISTS LONG",
    "CREATE PROPERTY TranslationMetric.timestamp                      IF NOT EXISTS STRING",
    "CREATE PROPERTY TranslationMetric.sentence_count                 IF NOT EXISTS INTEGER",
    "CREATE PROPERTY TranslationMetric.engines_used                   IF NOT EXISTS STRING",
    "CREATE PROPERTY TranslationMetric.phrasebank_count               IF NOT EXISTS INTEGER",
    "CREATE PROPERTY TranslationMetric.nllb_count                     IF NOT EXISTS INTEGER",
    "CREATE PROPERTY TranslationMetric.llm_count                      IF NOT EXISTS INTEGER",
    "CREATE PROPERTY TranslationMetric.semantic_fidelity              IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY TranslationMetric.fluency                        IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY TranslationMetric.clinical_safety                IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY TranslationMetric.cultural_fit                   IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY TranslationMetric.overall_score                  IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY TranslationMetric.back_translation_method        IF NOT EXISTS STRING",
    "CREATE PROPERTY TranslationMetric.back_translation_confidence    IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY TranslationMetric.serve_decision                 IF NOT EXISTS STRING",
    "CREATE PROPERTY TranslationMetric.mandinka_ratio                 IF NOT EXISTS DOUBLE",
    "CREATE PROPERTY TranslationMetric.total_latency_ms               IF NOT EXISTS INTEGER",
    "CREATE PROPERTY TranslationMetric.nllb_available                 IF NOT EXISTS BOOLEAN",
)


# Module-level latch -- bootstrap_schema only ever runs once per process,
# even if multiple telemetry instances are constructed.
_SCHEMA_BOOTSTRAPPED = False


class ArcadeDBTelemetryStore:
    """Persists TranslationMetric vertices for the scorecard pipeline.

    Strict fire-and-forget. Bootstrapping the schema or persisting a
    row never raises out of this class -- failures are logged at
    DEBUG and the call returns. Telemetry must never block a user
    response.
    """

    async def bootstrap_schema(self) -> bool:
        """Create the vertex type + properties idempotently. Returns
        True on success, False on any error (callers can decide whether
        to retry on the next telemetry call)."""
        global _SCHEMA_BOOTSTRAPPED
        if _SCHEMA_BOOTSTRAPPED:
            return True
        try:
            from src.utils.arcade_client import async_command_sql
        except Exception as e:
            logger.debug("v4.2.telemetry: arcade_client unavailable (%s)", e)
            return False
        try:
            await async_command_sql(_SCHEMA_TYPE_SQL)
            for stmt in _SCHEMA_PROPERTY_SQLS:
                try:
                    await async_command_sql(stmt)
                except Exception as e:
                    # Property may already exist; ArcadeDB versions vary
                    # on whether IF NOT EXISTS is honoured for property
                    # statements, so we tolerate per-property failure.
                    logger.debug("v4.2.telemetry: schema stmt skipped (%s)", e)
            _SCHEMA_BOOTSTRAPPED = True
            logger.info("v4.2.telemetry: TranslationMetric schema ready")
            return True
        except Exception as e:
            logger.warning("v4.2.telemetry: schema bootstrap failed (%s: %s)", type(e).__name__, e)
            return False

    async def persist(self, record: Dict[str, Any]) -> None:
        """Insert one TranslationMetric vertex. Errors are swallowed."""
        try:
            from src.utils.arcade_client import async_command_sql
        except Exception:
            return
        # Lazy schema bootstrap -- guarantees we don't INSERT before
        # the type exists, but only pays the cost once per process.
        if not _SCHEMA_BOOTSTRAPPED:
            ok = await self.bootstrap_schema()
            if not ok:
                return

        # Strip down to the safe field set the schema declares. Any
        # unexpected key in `record` is silently dropped.
        safe = {
            "trace_id":                     str(record.get("trace_id") or "")[:64],
            "session_hash":                 int(record.get("session_hash") or 0),
            "timestamp":                    str(record.get("timestamp") or ""),
            "sentence_count":               int(record.get("sentence_count") or 0),
            "engines_used":                 str(record.get("engine_selection_summary") or ""),
            "phrasebank_count":             int((record.get("engine_selection") or {}).get("phrasebank") or 0),
            "nllb_count":                   int((record.get("engine_selection") or {}).get("nllb") or 0),
            "llm_count":                    int((record.get("engine_selection") or {}).get("llm") or 0),
            "semantic_fidelity":            float((record.get("quality_scores") or {}).get("semantic_fidelity") or 0.0),
            "fluency":                      float((record.get("quality_scores") or {}).get("fluency") or 0.0),
            "clinical_safety":              float((record.get("quality_scores") or {}).get("clinical_safety") or 0.0),
            "cultural_fit":                 float((record.get("quality_scores") or {}).get("cultural_fit") or 0.0),
            "overall_score":                float((record.get("quality_scores") or {}).get("overall") or 0.0),
            "back_translation_method":      str(record.get("back_translation_method") or "")[:64],
            "back_translation_confidence":  float(record.get("back_translation_confidence") or 0.0),
            "serve_decision":               str(record.get("serve_decision") or "")[:32],
            "mandinka_ratio":               float(record.get("mandinka_ratio") or 0.0),
            "total_latency_ms":             int(record.get("total_latency_ms") or 0),
            "nllb_available":               bool(record.get("nllb_available") or False),
        }
        sets = ", ".join(f"{k} = :{k}" for k in safe.keys())
        sql = f"CREATE VERTEX TranslationMetric SET {sets}"
        try:
            await async_command_sql(sql, safe)
        except Exception as e:
            logger.debug("v4.2.telemetry: persist failed (%s: %s)", type(e).__name__, e)


def _session_hash(session_id: Optional[str]) -> int:
    if not session_id:
        return 0
    h = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:8]
    return int(h, 16)


def _bucket(items: Iterable[Dict[str, Any]], key: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for it in items or []:
        k = str(it.get(key) or "unknown")
        out[k] = out.get(k, 0) + 1
    return out


# In-process ring of recent overall scores -- enough to detect a
# regression without a database. v4.2 will read from ArcadeDB.
_RECENT_SCORES: Deque[float] = deque(maxlen=100)
_RECENT_CLINICAL: Deque[float] = deque(maxlen=100)


def reset_for_test() -> None:
    """Drains the in-process score rings. Called only by the eval harness."""
    _RECENT_SCORES.clear()
    _RECENT_CLINICAL.clear()


class TranslationTelemetry:
    """Stage 8 entry point."""

    def __init__(self) -> None:
        # Lazily constructed -- the store object itself is cheap, but
        # keeping it lazy means tests that don't exercise telemetry
        # don't need to import arcade_client.
        self._arcade_store: Optional["ArcadeDBTelemetryStore"] = None

    def _get_arcade_store(self) -> Optional["ArcadeDBTelemetryStore"]:
        if not config.V4_TELEMETRY_ARCADEDB:
            return None
        if self._arcade_store is None:
            self._arcade_store = ArcadeDBTelemetryStore()
        return self._arcade_store

    def log_translation(
        self,
        *,
        session_id: Optional[str],
        engine_results: Iterable[Dict[str, Any]],
        scored: Dict[str, Any],
        back_translation: Optional[Dict[str, Any]],
        corrector_result: Optional[Dict[str, Any]],
        router_result: Dict[str, Any],
        total_latency_ms: int,
        stage_latencies: Dict[str, int],
    ) -> None:
        if not config.V4_TELEMETRY_ENABLED:
            return

        engine_counts = _bucket(engine_results, "selected")

        record: Dict[str, Any] = {
            "event":                    "translation_v4",
            "timestamp":                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "session_hash":             _session_hash(session_id),
            "input_language":           "english",
            "output_language":          "mandinka",
            "sentence_count":           len((scored or {}).get("per_sentence_scores", [])),
            "engine_selection":         engine_counts,
            "quality_scores": {
                "semantic_fidelity":    (scored or {}).get("semantic_fidelity", 0.0),
                "fluency":              (scored or {}).get("fluency", 0.0),
                "clinical_safety":      (scored or {}).get("clinical_safety", 0.0),
                "cultural_fit":         (scored or {}).get("cultural_fit", 0.0),
                "overall":              (scored or {}).get("overall", 0.0),
            },
            "back_translation_confidence":  float((back_translation or {}).get("confidence") or 0.0),
            "back_translation_recommendation": (back_translation or {}).get("recommendation"),
            "corrector_corrections":    int((corrector_result or {}).get("corrections_count") or 0),
            "corrector_critical":       int((corrector_result or {}).get("critical_corrections") or 0),
            "serve_decision":           (router_result or {}).get("overall_decision"),
            "mandinka_ratio":           (router_result or {}).get("mandinka_ratio", 0.0),
            "total_latency_ms":         int(total_latency_ms or 0),
            "stage_latencies":          stage_latencies or {},
        }

        # Update the in-process ring; flag low quality at WARNING and
        # blocked outputs at ERROR so log aggregators bucket them.
        overall = float(record["quality_scores"]["overall"])
        clinical = float(record["quality_scores"]["clinical_safety"])
        _RECENT_SCORES.append(overall)
        _RECENT_CLINICAL.append(clinical)

        line = json.dumps(record, default=str, separators=(",", ":"))
        if record["serve_decision"] == "SERVE_ENGLISH" and overall < 0.4:
            logger.error(line)
        elif overall < 0.6:
            logger.warning(line)
        else:
            logger.info(line)

        # v4.2: ArcadeDB persistence. Strict fire-and-forget; any
        # failure is logged at DEBUG and never blocks the response.
        store = self._get_arcade_store()
        if store is not None:
            arcade_record = dict(record)
            arcade_record["trace_id"] = uuid.uuid4().hex[:12]
            arcade_record["engine_selection_summary"] = ",".join(
                f"{k}={v}" for k, v in (engine_counts or {}).items()
            )
            arcade_record["back_translation_method"] = (back_translation or {}).get("engine_used_back")
            arcade_record["nllb_available"] = (
                bool(arcade_record["engine_selection"].get("nllb"))
                or (back_translation or {}).get("engine_used_back") == "nllb_cross_model"
            )
            try:
                # Schedule the write on the running loop so we return
                # immediately to the caller.
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(store.persist(arcade_record))
                else:
                    # No active loop (e.g., synchronous test harness):
                    # skip rather than spin a fresh loop just for telemetry.
                    logger.debug("v4.2.telemetry: no running loop; skipping arcade persist")
            except Exception as e:
                logger.debug("v4.2.telemetry: schedule failed (%s: %s)", type(e).__name__, e)

    def check_regression(self) -> Dict[str, Any]:
        """Compare the rolling 100-call windows against v3.5 floors:
        * overall average drops below 0.70           -> WARNING
        * clinical_safety average drops below 0.80   -> CRITICAL
        Returns a dict so the caller can act (alert / page) without
        parsing log lines.
        """
        if not _RECENT_SCORES:
            return {"sample_size": 0, "level": "OK", "overall_avg": 0.0, "clinical_avg": 0.0}
        n = len(_RECENT_SCORES)
        overall_avg = sum(_RECENT_SCORES) / n
        clinical_avg = sum(_RECENT_CLINICAL) / max(1, len(_RECENT_CLINICAL))
        level = "OK"
        if clinical_avg < 0.80:
            level = "CRITICAL"
            logger.critical(
                "v4.telemetry: clinical_safety_avg=%.3f below floor 0.80 (n=%d)",
                clinical_avg, n,
            )
        elif overall_avg < 0.70:
            level = "WARNING"
            logger.warning(
                "v4.telemetry: overall_avg=%.3f below floor 0.70 (n=%d)",
                overall_avg, n,
            )
        return {
            "sample_size":      n,
            "level":            level,
            "overall_avg":      round(overall_avg, 3),
            "clinical_avg":     round(clinical_avg, 3),
        }
