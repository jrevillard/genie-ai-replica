"""
PotatoShortTermEWS — deterministic short-term potato early warning system.

Reads already-ingested weather forecasts from ArangoDB, applies potato-specific
thresholds from the crop profile JSON, and stores a crop-aware risk assessment.
No LLM, no external API calls, no Prithvi at this stage.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.crops.potato.profile import PotatoThresholds, load_potato_thresholds
from app.crops.potato.risk_engine import (
    DailyForecastPoint,
    to_point_from_dict,
    evaluate_potato_day,
    detect_late_blight,
    classify_tier,
    build_push_message,
)
from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)

_CROP = "potato"

# Category keywords used to deduplicate triggers from multiple forecast days.
# The first keyword that matches determines the category bucket.
_TRIGGER_CATEGORIES = ["max temperature", "min temperature", "humidity", "critical rainfall", "high rainfall", "wind"]


def _dedup_by_category(triggers: list[str]) -> list[str]:
    """
    Keep at most one trigger per category (the first encountered, which is the
    earlier/more-imminent day). Prevents the same breach on two consecutive
    days from doubling the severe count and inflating the tier.
    """
    seen: set[str] = set()
    result: list[str] = []
    for trig in triggers:
        lower = trig.lower()
        bucket = next((cat for cat in _TRIGGER_CATEGORIES if cat in lower), lower[:30])
        if bucket not in seen:
            seen.add(bucket)
            result.append(trig)
    return result


class PotatoShortTermEWS:
    """
    Evaluates short-term potato risk for a district.
    Reads from weather_forecasts, writes to risk_assessments (crop-keyed).
    """

    def __init__(
        self,
        storage: StorageLayer,
        thresholds: PotatoThresholds | None = None,
    ) -> None:
        self._storage = storage
        self._thresholds = thresholds or load_potato_thresholds()

    def evaluate(self, location: str) -> dict:
        """
        Run potato risk evaluation for a district.
        Returns the assessment dict, or {} if no forecast data is available.
        """
        om_doc, bmd_doc = self._storage.get_latest_forecast_pair(location)

        if om_doc is None and bmd_doc is None:
            logger.warning("[POTATO_EWS] No forecast in DB for %s — skipping", location)
            return {}

        # Respect the sense_check result already stored by the ingestion pipeline.
        # OM is used when it passed (or when no BMD reference was available).
        # BMD is used when sense_check failed or OM is missing.
        if om_doc is not None and om_doc.get("sense_check_passed") is not False:
            source_doc = om_doc
        elif bmd_doc is not None:
            source_doc = bmd_doc
        else:
            source_doc = om_doc  # last resort: use OM even if check inconclusive

        source = source_doc.get("source", "open_meteo")
        forecast_entries = source_doc.get("forecast", [])[:2]  # today + tomorrow

        if not forecast_entries:
            logger.warning("[POTATO_EWS] Empty forecast list for %s — skipping", location)
            return {}

        points: list[DailyForecastPoint] = [
            to_point_from_dict(day, source) for day in forecast_entries
        ]

        # Evaluate thresholds across both forecast days
        triggers: list[str] = []
        disease_risks: list[str] = []
        for point in points:
            triggers.extend(evaluate_potato_day(point, self._thresholds))
            blight = detect_late_blight(point)
            if blight:
                disease_risks.append(blight)

        # Deduplicate by category — keep the worst value per trigger type
        # (e.g. heat breach on day 1 and day 2 counts as one severe trigger)
        triggers = _dedup_by_category(triggers)
        disease_risks = list(dict.fromkeys(disease_risks))

        tier, label = classify_tier(triggers + disease_risks, flood_confirmed=False)

        assessment = {
            "location": location,
            "crop": _CROP,
            "horizon": "short",
            "forecast_date": points[0].date,
            "assessed_at": datetime.now(timezone.utc).isoformat(),
            "tier": tier,
            "tier_label": label,
            "forecast_source": source,
            "sense_check_passed": om_doc.get("sense_check_passed") if om_doc else None,
            "fallback_used": source != "open_meteo",
            "triggers": triggers,
            "disease_risks": disease_risks,
            "message": build_push_message({
                "location": location,
                "forecast_date": points[0].date,
                "tier": tier,
                "triggers": triggers,
                "disease_risks": disease_risks,
            }),
        }

        self._storage.upsert_crop_assessment(assessment, _CROP)

        if tier > 0:
            logger.warning(
                "[POTATO_EWS] %s — tier=%d (%s) | %s",
                location, tier, label,
                "; ".join(triggers + disease_risks) or "—",
            )
        else:
            logger.debug("[POTATO_EWS] %s — Normal (no thresholds breached)", location)

        return assessment

    def should_alert(self, assessment: dict) -> bool:
        """True when tier >= 2 and no duplicate alert was sent in the last 12 h."""
        if not assessment or assessment.get("tier", 0) < 2:
            return False
        return not self._storage.was_crop_alert_sent(
            assessment["location"], _CROP, assessment["tier"], within_hours=12
        )

    def record_alert(self, assessment: dict) -> None:
        """Record that an alert was dispatched (deduplication log)."""
        self._storage.record_crop_alert_sent(
            assessment["location"],
            _CROP,
            assessment["tier"],
            "frontend_poll",
            assessment.get("forecast_date", ""),
        )
