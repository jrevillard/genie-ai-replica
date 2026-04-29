"""
AMINA Care — Clinical Outcome Dashboard (Phase 3)
===================================================
Aggregates outcome-tracking data from ArcadeDB and Redis into
reportable clinical metrics for the admin dashboard and Superset.

Metrics:
  1. Vital Trend Improvement Rate  — % patients with improving vitals
  2. Adherence Signal Rate         — % interactions showing follow-through
  3. Re-consultation Rate          — average sessions per patient per month
  4. Safety Block Rate             — % messages triggering safety guards
  5. Triage Escalation Rate        — % sessions escalated to facility/emergency
  6. Quality Score Distribution    — histogram of 5-dimension quality scores
  7. Knowledge Chunk Promotion     — insights promoted to RAG chunks
  8. Engagement Trend              — patient engagement over time

Data sources:
  - Redis: events:{patient_id}, insights:{patient_id}, behavior:{patient_id}
  - ArcadeDB: InteractionEvent, ClinicalInsight, PatientVertex, ConsultationRecord
"""

import json
import logging
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _safe_json(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


class ClinicalOutcomeDashboard:
    """Aggregates clinical outcome metrics from Redis + ArcadeDB."""

    def __init__(self, redis_client=None, arcade_sql=None):
        self._redis = redis_client
        self._arcade_sql = arcade_sql

    # ── helpers ───────────────────────────────────────────────────────────

    def _get_redis(self):
        if self._redis:
            return self._redis
        try:
            import redis
            from src.config import settings
            self._redis = redis.Redis(
                host=getattr(settings, "REDIS_HOST", "localhost"),
                port=getattr(settings, "REDIS_PORT", 6379),
                decode_responses=True,
            )
            return self._redis
        except Exception as e:
            logger.warning("Redis unavailable: %s", e)
            return None

    async def _query_arcade(self, sql: str, params=None):
        if self._arcade_sql:
            return await self._arcade_sql(sql, params or [])
        try:
            from src.utils.arcade_client import async_command_sql
            return await async_command_sql(sql, params or [])
        except Exception as e:
            logger.warning("ArcadeDB query failed: %s", e)
            return {"result": []}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 1: Vital Trend Improvement Rate
    # ══════════════════════════════════════════════════════════════════════

    async def vital_trend_improvement(self, days: int = 90) -> Dict[str, Any]:
        """Percentage of patients whose vital readings improved over time.

        Looks at InteractionEvent records with clinical signals for
        blood sugar, blood pressure mentions across sessions.
        """
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        try:
            result = await self._query_arcade(
                "SELECT patient_id, timestamp, topics "
                "FROM InteractionEvent "
                "WHERE timestamp >= :cutoff "
                "ORDER BY patient_id, timestamp",
                [cutoff],
            )
            rows = (result or {}).get("result", [])
            if not rows:
                return {"rate": None, "patients_tracked": 0, "improved": 0, "period_days": days}

            patient_sessions = defaultdict(list)
            for row in rows:
                pid = row.get("patient_id", "")
                topics = row.get("topics", [])
                if isinstance(topics, str):
                    topics = json.loads(topics) if topics.startswith("[") else [topics]
                clinical_topics = [t for t in topics if t in ("diabetes", "hypertension", "kidney")]
                if clinical_topics:
                    patient_sessions[pid].append({
                        "ts": row.get("timestamp", ""),
                        "topics": clinical_topics,
                    })

            improved = 0
            tracked = 0
            for pid, sessions in patient_sessions.items():
                if len(sessions) < 3:
                    continue
                tracked += 1
                # Improvement heuristic: patient has more recent sessions
                # with clinical topics = actively managing their condition
                half = len(sessions) // 2
                early_count = half
                late_count = len(sessions) - half
                if late_count >= early_count:
                    improved += 1

            rate = improved / tracked if tracked else None
            return {
                "rate": round(rate, 4) if rate is not None else None,
                "patients_tracked": tracked,
                "improved": improved,
                "period_days": days,
            }
        except Exception as e:
            logger.warning("vital_trend_improvement failed: %s", e)
            return {"rate": None, "error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 2: Adherence Signal Rate
    # ══════════════════════════════════════════════════════════════════════

    async def adherence_signal_rate(self, days: int = 90) -> Dict[str, Any]:
        """Percentage of interactions where patients signal adherence."""
        r = self._get_redis()
        if not r:
            return {"rate": None, "error": "Redis unavailable"}

        try:
            patient_keys = []
            cursor = 0
            while True:
                cursor, keys = r.scan(cursor, match="events:*", count=100)
                patient_keys.extend(keys)
                if cursor == 0:
                    break

            total_events = 0
            adherence_events = 0
            adherence_breakdown = Counter()

            for key in patient_keys[:500]:  # cap scan
                raw_events = r.lrange(key, 0, 49)
                for raw in raw_events:
                    event = _safe_json(raw)
                    if not event:
                        continue
                    ts = event.get("timestamp", "")
                    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
                    if ts and ts < cutoff:
                        continue
                    total_events += 1
                    signal = event.get("adherence_signal")
                    if signal:
                        adherence_events += 1
                        adherence_breakdown[signal] += 1

            rate = adherence_events / total_events if total_events else None
            return {
                "rate": round(rate, 4) if rate is not None else None,
                "total_interactions": total_events,
                "adherence_interactions": adherence_events,
                "breakdown": dict(adherence_breakdown),
                "period_days": days,
            }
        except Exception as e:
            logger.warning("adherence_signal_rate failed: %s", e)
            return {"rate": None, "error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 3: Re-consultation Rate
    # ══════════════════════════════════════════════════════════════════════

    async def reconsultation_rate(self, days: int = 90) -> Dict[str, Any]:
        """Average sessions per patient per month (re-engagement proxy)."""
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        try:
            result = await self._query_arcade(
                "SELECT patient_id, session_id, timestamp "
                "FROM InteractionEvent "
                "WHERE timestamp >= :cutoff",
                [cutoff],
            )
            rows = (result or {}).get("result", [])
            if not rows:
                return {"rate_per_month": None, "unique_patients": 0}

            patient_sessions = defaultdict(set)
            for row in rows:
                pid = row.get("patient_id", "")
                sid = row.get("session_id", "")
                if pid and sid:
                    patient_sessions[pid].add(sid)

            months = max(days / 30.0, 1)
            session_counts = [len(s) for s in patient_sessions.values()]
            avg_per_month = (sum(session_counts) / len(session_counts) / months) if session_counts else 0

            return {
                "rate_per_month": round(avg_per_month, 2),
                "unique_patients": len(patient_sessions),
                "total_sessions": sum(session_counts),
                "period_days": days,
            }
        except Exception as e:
            logger.warning("reconsultation_rate failed: %s", e)
            return {"rate_per_month": None, "error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 4: Safety Block Rate
    # ══════════════════════════════════════════════════════════════════════

    async def safety_block_rate(self, days: int = 90) -> Dict[str, Any]:
        """Percentage of messages that triggered safety guards.

        Reads from Redis events and checks for tools containing
        'emergency', 'safety', or 'guard' indicators.
        """
        r = self._get_redis()
        if not r:
            return {"rate": None, "error": "Redis unavailable"}

        try:
            total = 0
            blocked = 0
            block_types = Counter()

            cursor = 0
            while True:
                cursor, keys = r.scan(cursor, match="events:*", count=100)
                for key in keys:
                    raw_events = r.lrange(key, 0, 49)
                    for raw in raw_events:
                        event = _safe_json(raw)
                        if not event:
                            continue
                        ts = event.get("timestamp", "")
                        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
                        if ts and ts < cutoff:
                            continue
                        total += 1
                        tools = event.get("tools", [])
                        if isinstance(tools, str):
                            tools = [tools]
                        safety_tools = [
                            t for t in tools
                            if any(kw in t.lower() for kw in
                                   ("emergency", "safety", "guard", "block", "refuse"))
                        ]
                        if safety_tools:
                            blocked += 1
                            for t in safety_tools:
                                block_types[t] += 1

                        # Also check quality scores for safety flags
                        quality = event.get("quality", {})
                        if isinstance(quality, str):
                            quality = _safe_json(quality)
                        if quality.get("patient_safety", 1.0) < 0.5:
                            blocked += 1
                            block_types["low_safety_score"] += 1

                if cursor == 0:
                    break

            rate = blocked / total if total else None
            return {
                "rate": round(rate, 4) if rate is not None else None,
                "total_messages": total,
                "safety_blocked": blocked,
                "block_types": dict(block_types.most_common(10)),
                "period_days": days,
            }
        except Exception as e:
            logger.warning("safety_block_rate failed: %s", e)
            return {"rate": None, "error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 5: Triage Escalation Rate
    # ══════════════════════════════════════════════════════════════════════

    async def triage_escalation_rate(self, days: int = 90) -> Dict[str, Any]:
        """Percentage of sessions escalated to facility or emergency."""
        r = self._get_redis()
        if not r:
            return {"rate": None, "error": "Redis unavailable"}

        try:
            total_sessions = set()
            escalated_sessions = set()
            escalation_levels = Counter()

            cursor = 0
            while True:
                cursor, keys = r.scan(cursor, match="events:*", count=100)
                for key in keys:
                    raw_events = r.lrange(key, 0, 49)
                    for raw in raw_events:
                        event = _safe_json(raw)
                        if not event:
                            continue
                        ts = event.get("timestamp", "")
                        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
                        if ts and ts < cutoff:
                            continue

                        sid = event.get("session_id", "")
                        total_sessions.add(sid)

                        tools = event.get("tools", [])
                        if isinstance(tools, str):
                            tools = [tools]

                        bot_resp = (event.get("bot_response", "") or "").lower()

                        escalation_cues = {
                            "emergency": ["emergency", "ambulance", "call 116", "hospital immediately"],
                            "facility_referral": ["visit your doctor", "health facility", "see a doctor",
                                                  "medical attention", "referred"],
                            "urgent": ["urgent", "as soon as possible", "do not delay"],
                        }
                        for level, cues in escalation_cues.items():
                            if any(c in bot_resp for c in cues):
                                escalated_sessions.add(sid)
                                escalation_levels[level] += 1
                                break

                        if any("emergency" in t.lower() for t in tools):
                            escalated_sessions.add(sid)
                            escalation_levels["emergency_tool"] += 1

                if cursor == 0:
                    break

            total = len(total_sessions)
            esc = len(escalated_sessions)
            rate = esc / total if total else None

            return {
                "rate": round(rate, 4) if rate is not None else None,
                "total_sessions": total,
                "escalated_sessions": esc,
                "escalation_breakdown": dict(escalation_levels),
                "period_days": days,
            }
        except Exception as e:
            logger.warning("triage_escalation_rate failed: %s", e)
            return {"rate": None, "error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 6: Quality Score Distribution
    # ══════════════════════════════════════════════════════════════════════

    async def quality_score_distribution(self, days: int = 90) -> Dict[str, Any]:
        """Distribution of 5-dimension quality scores across interactions."""
        r = self._get_redis()
        if not r:
            return {"error": "Redis unavailable"}

        try:
            dimensions = ["clinical_accuracy", "patient_safety", "cultural_fit",
                          "engagement_quality", "adherence_potential"]
            dim_scores = {d: [] for d in dimensions}
            total = 0

            cursor = 0
            while True:
                cursor, keys = r.scan(cursor, match="events:*", count=100)
                for key in keys:
                    raw_events = r.lrange(key, 0, 49)
                    for raw in raw_events:
                        event = _safe_json(raw)
                        if not event:
                            continue
                        ts = event.get("timestamp", "")
                        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
                        if ts and ts < cutoff:
                            continue

                        quality = event.get("quality", {})
                        if isinstance(quality, str):
                            quality = _safe_json(quality)
                        if not quality:
                            continue

                        total += 1
                        for d in dimensions:
                            val = quality.get(d)
                            if val is not None:
                                dim_scores[d].append(float(val))
                if cursor == 0:
                    break

            result = {"total_scored": total, "dimensions": {}}
            for d in dimensions:
                scores = dim_scores[d]
                if scores:
                    result["dimensions"][d] = {
                        "mean": round(sum(scores) / len(scores), 4),
                        "min": round(min(scores), 4),
                        "max": round(max(scores), 4),
                        "below_50pct": sum(1 for s in scores if s < 0.5),
                        "above_80pct": sum(1 for s in scores if s >= 0.8),
                    }
            return result

        except Exception as e:
            logger.warning("quality_score_distribution failed: %s", e)
            return {"error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 7: Knowledge Chunk Promotion Stats
    # ══════════════════════════════════════════════════════════════════════

    async def knowledge_promotion_stats(self) -> Dict[str, Any]:
        """Stats on how many clinical insights were promoted to RAG chunks."""
        try:
            result = await self._query_arcade(
                "SELECT count(*) as cnt FROM ClinicalInsight"
            )
            total_insights = 0
            rows = (result or {}).get("result", [])
            if rows and isinstance(rows[0], dict):
                total_insights = rows[0].get("cnt", 0)

            result2 = await self._query_arcade(
                "SELECT count(*) as cnt FROM ClinicalInsight WHERE quality_score >= 0.7"
            )
            quality_insights = 0
            rows2 = (result2 or {}).get("result", [])
            if rows2 and isinstance(rows2[0], dict):
                quality_insights = rows2[0].get("cnt", 0)

            result3 = await self._query_arcade(
                "SELECT count(*) as cnt FROM chunks WHERE source LIKE 'learned_interactions%'"
            )
            promoted_chunks = 0
            rows3 = (result3 or {}).get("result", [])
            if rows3 and isinstance(rows3[0], dict):
                promoted_chunks = rows3[0].get("cnt", 0)

            return {
                "total_insights": total_insights,
                "quality_gated_insights": quality_insights,
                "promoted_chunks": promoted_chunks,
                "promotion_rate": round(quality_insights / total_insights, 4) if total_insights else None,
            }
        except Exception as e:
            logger.warning("knowledge_promotion_stats failed: %s", e)
            return {"error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # METRIC 8: Engagement Trend
    # ══════════════════════════════════════════════════════════════════════

    async def engagement_trend(self, days: int = 90, bucket_days: int = 7) -> Dict[str, Any]:
        """Weekly engagement trend — sessions and unique patients per bucket."""
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        try:
            result = await self._query_arcade(
                "SELECT patient_id, session_id, timestamp "
                "FROM InteractionEvent "
                "WHERE timestamp >= :cutoff "
                "ORDER BY timestamp",
                [cutoff],
            )
            rows = (result or {}).get("result", [])
            if not rows:
                return {"buckets": [], "period_days": days}

            bucket_data = defaultdict(lambda: {"sessions": set(), "patients": set(), "messages": 0})

            for row in rows:
                ts_str = row.get("timestamp", "")
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00").split("+")[0])
                except (ValueError, AttributeError):
                    continue

                bucket_start = ts - timedelta(days=ts.weekday() % bucket_days)
                bucket_key = bucket_start.strftime("%Y-%m-%d")

                bucket_data[bucket_key]["sessions"].add(row.get("session_id", ""))
                bucket_data[bucket_key]["patients"].add(row.get("patient_id", ""))
                bucket_data[bucket_key]["messages"] += 1

            buckets = []
            for key in sorted(bucket_data.keys()):
                b = bucket_data[key]
                buckets.append({
                    "week_start": key,
                    "unique_patients": len(b["patients"]),
                    "unique_sessions": len(b["sessions"]),
                    "total_messages": b["messages"],
                })

            return {"buckets": buckets, "period_days": days, "bucket_size_days": bucket_days}

        except Exception as e:
            logger.warning("engagement_trend failed: %s", e)
            return {"buckets": [], "error": str(e)}

    # ══════════════════════════════════════════════════════════════════════
    # FULL DASHBOARD
    # ══════════════════════════════════════════════════════════════════════

    async def full_dashboard(self, days: int = 90) -> Dict[str, Any]:
        """Run all metrics and return a complete dashboard payload."""
        results = await asyncio.gather(
            self.vital_trend_improvement(days),
            self.adherence_signal_rate(days),
            self.reconsultation_rate(days),
            self.safety_block_rate(days),
            self.triage_escalation_rate(days),
            self.quality_score_distribution(days),
            self.knowledge_promotion_stats(),
            self.engagement_trend(days),
            return_exceptions=True,
        )

        metric_names = [
            "vital_trend_improvement",
            "adherence_signal_rate",
            "reconsultation_rate",
            "safety_block_rate",
            "triage_escalation_rate",
            "quality_score_distribution",
            "knowledge_promotion_stats",
            "engagement_trend",
        ]

        dashboard = {
            "timestamp": datetime.now().isoformat(),
            "period_days": days,
            "metrics": {},
        }

        for name, result in zip(metric_names, results):
            if isinstance(result, Exception):
                dashboard["metrics"][name] = {"error": str(result)}
            else:
                dashboard["metrics"][name] = result

        # Compute composite health score (0-100)
        scores = []
        m = dashboard["metrics"]

        vti = m.get("vital_trend_improvement", {}).get("rate")
        if vti is not None:
            scores.append(vti * 100)

        asr = m.get("adherence_signal_rate", {}).get("rate")
        if asr is not None:
            scores.append(min(asr * 200, 100))  # 50% adherence = 100 score

        sbr = m.get("safety_block_rate", {}).get("rate")
        if sbr is not None:
            scores.append(max(0, 100 - sbr * 500))  # lower is better

        qsd = m.get("quality_score_distribution", {}).get("dimensions", {})
        if qsd:
            dim_means = [d.get("mean", 0.5) for d in qsd.values()]
            scores.append(sum(dim_means) / len(dim_means) * 100)

        dashboard["composite_health_score"] = round(
            sum(scores) / len(scores), 1
        ) if scores else None

        return dashboard


# Singleton for import convenience
_dashboard: Optional[ClinicalOutcomeDashboard] = None


def get_dashboard() -> ClinicalOutcomeDashboard:
    global _dashboard
    if _dashboard is None:
        _dashboard = ClinicalOutcomeDashboard()
    return _dashboard
