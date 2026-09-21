"""
CropShortTermEWS — deterministic short-term crop early warning system.

Reads already-ingested weather forecasts from ArangoDB, applies the crop's
thresholds from the crop profile JSON, and stores a crop-aware risk assessment.
No LLM, no external API calls, no Prithvi at this stage.

The crop module (`app.crops.<crop>`) is generated from the BAMIS calendar by
build_crop_profiles_pipeline.py, so this workflow stays crop-agnostic.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from importlib import import_module
from typing import TYPE_CHECKING, Any

from app.core.crop_profile_loader import CropProfileLoader

if TYPE_CHECKING:
    from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)

_TIER_LABELS = {0: "Normal", 1: "Advisory", 2: "Warning", 3: "Severe"}
_SEVERITY_RANK = {"advisory": 1, "warning": 2}


def _point_value(point, metric: str) -> float | None:
    if metric == "temp_mean":
        return (point.temp_min + point.temp_max) / 2.0
    value = getattr(point, metric, None)
    return float(value) if value is not None else None


def _condition_matches(point, condition: dict) -> bool:
    value = _point_value(point, condition.get("metric", ""))
    if value is None:
        return False
    operator = condition.get("operator")
    threshold = condition.get("value")
    if operator == ">":
        return value > float(threshold)
    if operator == "<":
        return value < float(threshold)
    if operator == "between":
        low, high = threshold
        return float(low) <= value <= float(high)
    return False


def _rule_matches(point, rule: dict) -> bool:
    if "all" in rule:
        return all(_condition_matches(point, condition) for condition in rule["all"])
    if "any" in rule:
        return any(_condition_matches(point, condition) for condition in rule["any"])
    return _condition_matches(point, rule)


def _condition_text(point, condition: dict) -> str:
    metric = condition["metric"]
    value = _point_value(point, metric)
    labels = {
        "rain_mm": ("Rainfall", "mm/day"),
        "wind_kmh": ("Wind", "km/h"),
        "temp_min": ("minimum temperature", "°C"),
        "temp_max": ("maximum temperature", "°C"),
        "temp_mean": ("mean temperature", "°C"),
        "humidity_min": ("minimum humidity", "%"),
        "humidity_max": ("maximum humidity", "%"),
    }
    label, unit = labels.get(metric, (metric.replace("_", " "), ""))
    operator = condition["operator"]
    threshold = condition["value"]
    if operator == "between":
        expected = f"within {threshold[0]}–{threshold[1]}{unit}"
    else:
        expected = f"{operator} {threshold}{unit}"
    return f"{label} {value:.1f}{unit} ({expected})"


def _rule_description(point, stage: str, rule: dict) -> str:
    conditions = rule.get("all") or rule.get("any") or [rule]
    joiner = " and " if "all" in rule else " or " if "any" in rule else ""
    details = joiner.join(_condition_text(point, condition) for condition in conditions)
    return f"{details} matches the BAMIS {stage} warning"


def _evaluate_stage_rules(point, stage: str, rules: list[dict]) -> list[dict]:
    """Return one highest-severity event per source warning category."""
    events: dict[str, dict] = {}
    for rule in rules:
        if not _rule_matches(point, rule):
            continue
        event = {
            "category": rule["category"],
            "severity": rule.get("severity", "warning"),
            "description": _rule_description(point, stage, rule),
        }
        previous = events.get(event["category"])
        if (
            previous is None
            or _SEVERITY_RANK[event["severity"]] > _SEVERITY_RANK[previous["severity"]]
        ):
            events[event["category"]] = event
    return list(events.values())


class CropShortTermEWS:
    """
    Evaluates short-term risk for one crop across a district.
    Reads from weather_forecasts, writes to risk_assessments (crop-keyed).
    """

    def __init__(
        self,
        storage: StorageLayer,
        crop: str,
        thresholds=None,
        profile_loader: CropProfileLoader | None = None,
    ) -> None:
        self._storage = storage
        self._crop = crop
        self._profile = import_module(f"app.crops.{crop}.profile")
        self._engine = import_module(f"app.crops.{crop}.risk_engine")
        self._thresholds = (
            thresholds or getattr(self._profile, f"load_{crop}_thresholds")()
        )
        self._profile_loader = profile_loader or CropProfileLoader()
        threshold_region = getattr(self._thresholds, "region", "")
        available_regions = self._profile_loader.regions_for_crop(crop)
        self._region = (
            threshold_region
            if self._profile_loader.get_profile(crop, threshold_region)
            else available_regions[0]
            if available_regions
            else threshold_region
        )

    @property
    def crop(self) -> str:
        return self._crop

    def evaluate(self, location: str) -> dict:
        """
        Run crop risk evaluation for a district.
        Returns the assessment dict, or {} if no forecast data is available.
        """
        om_doc, bmd_doc = self._storage.get_latest_forecast_pair(location)

        if om_doc is None and bmd_doc is None:
            logger.warning(
                "[CROP_EWS] No forecast in DB for %s — skipping (%s)",
                location,
                self._crop,
            )
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
            logger.warning(
                "[CROP_EWS] Empty forecast list for %s — skipping (%s)",
                location,
                self._crop,
            )
            return {}

        points = [
            self._engine.to_point_from_dict(day, source) for day in forecast_entries
        ]

        # Evaluate only forecast dates that belong to the crop's BAMIS season.
        warning_events: list[dict[str, Any]] = []
        disease_risks: list[str] = []
        active_stages: list[str] = []
        for point in points:
            try:
                forecast_day = date.fromisoformat(point.date)
            except ValueError:
                logger.warning(
                    "[CROP_EWS] Invalid forecast date %r for %s — skipped",
                    point.date,
                    self._crop,
                )
                continue
            stage = self._profile_loader.get_stage_for_week(
                self._crop, self._region, forecast_day.isocalendar()[1]
            )
            if not stage:
                continue
            if stage not in active_stages:
                active_stages.append(stage)
            rules = self._profile_loader.get_weather_warning_rules(
                self._crop, self._region, stage
            )
            warning_events.extend(_evaluate_stage_rules(point, stage, rules))
            disease_risks.extend(self._engine.get_disease_risks(point))

        # Keep the highest-severity result for each source warning category.
        deduplicated_events: dict[str, dict] = {}
        for event in warning_events:
            previous = deduplicated_events.get(event["category"])
            if (
                previous is None
                or _SEVERITY_RANK[event["severity"]]
                > _SEVERITY_RANK[previous["severity"]]
            ):
                deduplicated_events[event["category"]] = event
        warning_events = list(deduplicated_events.values())
        triggers = [event["description"] for event in warning_events]
        disease_risks = list(dict.fromkeys(disease_risks))

        warning_count = sum(event["severity"] == "warning" for event in warning_events)
        advisory_count = sum(
            event["severity"] == "advisory" for event in warning_events
        )
        if warning_count >= 2:
            tier = 3
        elif warning_count == 1:
            tier = 2
        elif advisory_count or disease_risks:
            tier = 1
        else:
            tier = 0
        label = _TIER_LABELS[tier]
        in_season = bool(active_stages)

        if not in_season:
            triggers = []
            disease_risks = []
            tier = 0
            label = _TIER_LABELS[tier]

        assessment = {
            "location": location,
            "crop": self._crop,
            "horizon": "short",
            "forecast_date": points[0].date,
            "assessed_at": datetime.now(timezone.utc).isoformat(),
            "tier": tier,
            "tier_label": label,
            "forecast_source": source,
            "sense_check_passed": om_doc.get("sense_check_passed") if om_doc else None,
            "fallback_used": source != "open_meteo",
            "in_season": in_season,
            "crop_stages": active_stages,
            "profile_region": self._region,
            "triggers": triggers,
            "disease_risks": disease_risks,
            "message": (
                f"{self._crop.replace('_', ' ').title()} is outside its BAMIS crop season for {location}."
                if not in_season
                else self._engine.build_push_message(
                    {
                        "location": location,
                        "forecast_date": points[0].date,
                        "tier": tier,
                        "triggers": triggers,
                        "disease_risks": disease_risks,
                    }
                )
            ),
        }

        self._storage.upsert_crop_assessment(assessment, self._crop)

        if tier > 0:
            logger.warning(
                "[CROP_EWS] %s %s — tier=%d (%s) | %s",
                self._crop,
                location,
                tier,
                label,
                "; ".join(triggers + disease_risks) or "—",
            )
        else:
            logger.debug(
                "[CROP_EWS] %s %s — Normal (no thresholds breached)",
                self._crop,
                location,
            )

        return assessment

    def should_alert(self, assessment: dict) -> bool:
        """True when tier >= 2 and no duplicate alert was sent in the last 12 h."""
        if not assessment or assessment.get("tier", 0) < 2:
            return False
        return not self._storage.was_crop_alert_sent(
            assessment["location"], self._crop, assessment["tier"], within_hours=12
        )

    def record_alert(self, assessment: dict, channel: str = "frontend_poll") -> None:
        """Record that an alert was dispatched (deduplication log)."""
        self._storage.record_crop_alert_sent(
            assessment["location"],
            self._crop,
            assessment["tier"],
            channel,
            assessment.get("forecast_date", ""),
        )
