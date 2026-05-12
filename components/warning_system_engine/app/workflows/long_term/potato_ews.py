"""
LongTermPotatoEWS — deterministic seasonal potato risk engine.

For each district, reads the SEAS5 5-month outlook from `seasonal_forecasts`
and compares it against the crop profile thresholds + district baseline from
`example_crop_profile.json`.

Assessment logic per month:
  1. Map the month → overlapping potato season weeks → stage(s)
  2. Aggregate the district weekly baseline for those weeks
  3. Compare Copernicus values against:
       a. Absolute crop_rules thresholds        (copernicus_ready)
       b. Deviation from district weekly mean    (copernicus_ready)
       c. Humidity / humidity-dependent disease  (copernicus_partial if RH estimated)
  4. Classify severity tier 0–3 (max 3 for seasonal — uncertainty too high for 4)
  5. Tag each rule with support level: copernicus_ready | copernicus_partial | rag_only
  6. Store in ArangoDB `seasonal_assessments`

Tier mapping:
  0  Normal     All within tolerance
  1  Advisory   Minor deviation (temp 2-3°C above ideal mean, precip 1.5–2× normal)
  2  Warning    Significant (temp approaching/exceeding threshold, major rainfall)
  3  Severe     Clearly outside crop tolerance (temp > max, critical rainfall)
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING

from app.core.crop_profile_loader import CropProfileLoader

if TYPE_CHECKING:
    from app.core.storage import StorageLayer

logger = logging.getLogger(__name__)

_CROP   = "potato"
_TIER_LABELS = {0: "Normal", 1: "Advisory", 2: "Warning", 3: "Severe"}

# How far above the seasonal mean (°C) before raising advisory/warning
_TEMP_ADVISORY_DELTA = 2.0   # °C above baseline mean → Advisory
_TEMP_WARNING_DELTA  = 4.0   # °C above baseline mean → Warning
_PRECIP_HIGH_RATIO   = 1.5   # × baseline monthly total → Advisory
_PRECIP_CRIT_RATIO   = 2.5   # × baseline monthly total → Warning
_PRECIP_DRY_RATIO    = 0.3   # × baseline monthly total → Advisory (drought risk)


class LongTermPotatoEWS:
    """
    Evaluates 5-month seasonal potato risk for every Bangladesh district.
    Reads from `seasonal_forecasts`, writes to `seasonal_assessments`.
    """

    def __init__(
        self,
        storage: "StorageLayer",
        profile_loader: CropProfileLoader | None = None,
    ) -> None:
        self._storage = storage
        self._loader  = profile_loader or CropProfileLoader()

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def evaluate_all(self, locations: list[str] | None = None) -> dict:
        from app.integrations.copernicus.fetcher import DISTRICT_COORDS
        targets = locations or list(DISTRICT_COORDS.keys())

        evaluated = 0
        skipped   = 0
        errors    = 0

        for location in targets:
            try:
                count = self.evaluate(location)
                evaluated += count
                if count == 0:
                    skipped += 1
            except Exception as exc:
                logger.error("[LT_EWS] Failed for %s: %s", location, exc)
                errors += 1

        result = {"evaluated": evaluated, "skipped": skipped, "errors": errors}
        logger.info("[LT_EWS] evaluate_all done: %s", result)
        return result

    def evaluate(self, location: str) -> int:
        """
        Assess each forecast month for the given location.
        Returns the number of monthly assessments stored.
        """
        region = location.lower().replace(" ", "_").replace("'", "")

        # Load SEAS5 outlook from ArangoDB
        fc_doc = self._storage.get_seasonal_forecast(location)
        if not fc_doc:
            logger.debug("[LT_EWS] No seasonal forecast for %s — skipping", location)
            return 0

        outlook: list[dict] = fc_doc.get("outlook", [])
        if not outlook:
            return 0

        # Load crop rules and thresholds
        temp_thresh   = self._loader.temp_thresholds(_CROP, region)
        rain_thresh   = self._loader.rainfall_thresholds(_CROP, region)
        wind_max      = self._loader.wind_threshold(_CROP, region)
        rh_thresh     = self._loader.humidity_thresholds(_CROP, region)
        season_weeks  = set(self._loader.get_season_weeks(_CROP, region))

        stored = 0
        for month_rec in outlook:
            valid_month = month_rec.get("valid_month", "")
            if not valid_month:
                continue

            try:
                year, month = int(valid_month[:4]), int(valid_month[5:7])
            except ValueError:
                continue

            # Only assess months that overlap with the potato season
            stages = self._loader.stages_for_month(_CROP, region, year, month)
            if not stages:
                logger.debug(
                    "[LT_EWS] %s %s — outside potato season, skipping",
                    location, valid_month,
                )
                continue

            baseline = self._loader.baseline_for_month(_CROP, region, year, month)

            assessment = self._build_assessment(
                location=location,
                region=region,
                valid_month=valid_month,
                stages=stages,
                copernicus=month_rec,
                baseline=baseline,
                temp_thresh=temp_thresh,
                rain_thresh=rain_thresh,
                wind_max=wind_max,
                rh_thresh=rh_thresh,
            )

            self._storage.upsert_seasonal_assessment(assessment)
            stored += 1

            if assessment["tier"] > 0:
                logger.warning(
                    "[LT_EWS] %s %s — tier=%d (%s) stages=%s triggers=%d",
                    location, valid_month, assessment["tier"],
                    assessment["tier_label"], stages, len(assessment["triggers"]),
                )

        return stored

    # ------------------------------------------------------------------
    # Core assessment builder
    # ------------------------------------------------------------------

    def _build_assessment(
        self,
        location: str,
        region: str,
        valid_month: str,
        stages: list[str],
        copernicus: dict,
        baseline: dict,
        temp_thresh: dict,
        rain_thresh: dict,
        wind_max: float,
        rh_thresh: dict,
    ) -> dict:

        triggers:           list[str] = []
        supported_rules:    list[str] = []
        unsupported_rules:  list[str] = []
        rule_support:       dict[str, str] = {}

        mean_temp_c    = copernicus.get("mean_temp_c")
        total_precip   = copernicus.get("total_precip_mm")
        mean_wind      = copernicus.get("mean_wind_kmh")
        estimated_rh   = copernicus.get("estimated_rh_pct")

        # ── 1. Absolute temperature thresholds ───────────────────────────
        temp_max = temp_thresh["temp_max"]  # 30°C for potato
        temp_min = temp_thresh["temp_min"]  # 10°C for potato

        if mean_temp_c is not None:
            rule_support["temperature"] = "copernicus_ready"
            supported_rules.append("temperature")

            if mean_temp_c > temp_max:
                triggers.append(
                    f"Monthly mean temp {mean_temp_c:.1f}°C exceeds potato limit {temp_max:.0f}°C"
                )
            elif mean_temp_c > temp_max - 2:
                triggers.append(
                    f"Monthly mean temp {mean_temp_c:.1f}°C approaching potato heat limit {temp_max:.0f}°C"
                )
            if mean_temp_c < temp_min:
                triggers.append(
                    f"Monthly mean temp {mean_temp_c:.1f}°C below potato cold limit {temp_min:.0f}°C"
                )

            # ── 2. Deviation from district baseline ──────────────────────
            baseline_mean = baseline.get("temp_mean_c")
            if baseline_mean is not None:
                delta = mean_temp_c - baseline_mean
                if delta >= _TEMP_WARNING_DELTA:
                    triggers.append(
                        f"Temperature {delta:+.1f}°C above district potato baseline "
                        f"({mean_temp_c:.1f}°C vs normal {baseline_mean:.1f}°C)"
                    )
                elif delta >= _TEMP_ADVISORY_DELTA:
                    triggers.append(
                        f"Temperature {delta:+.1f}°C warmer than district potato baseline"
                    )
        else:
            unsupported_rules.append("temperature")
            rule_support["temperature"] = "not_evaluable_yet"

        # ── 3. Precipitation ──────────────────────────────────────────────
        if total_precip is not None:
            rule_support["precipitation"] = "copernicus_ready"
            supported_rules.append("precipitation")

            # Absolute critical threshold (rain_critical mm/day × ~30 days)
            monthly_critical = rain_thresh["rain_critical"] * 30
            monthly_medium   = rain_thresh["rain_medium"]   * 30

            if total_precip >= monthly_critical:
                triggers.append(
                    f"Critical rainfall {total_precip:.0f} mm/month "
                    f"(≥ {monthly_critical:.0f} mm — waterlogging risk)"
                )
            elif total_precip >= monthly_medium:
                triggers.append(
                    f"High rainfall {total_precip:.0f} mm/month "
                    f"(≥ {monthly_medium:.0f} mm — monitoring required)"
                )

            # Deviation from baseline
            baseline_precip = baseline.get("rainfall_mm")  # weekly mm
            if baseline_precip is not None:
                # Weekly baseline → monthly equivalent
                weeks_count  = baseline.get("week_count", 1)
                monthly_base = baseline_precip * weeks_count

                if monthly_base > 0:
                    ratio = total_precip / monthly_base
                    if ratio >= _PRECIP_CRIT_RATIO:
                        triggers.append(
                            f"Rainfall {ratio:.1f}× above seasonal baseline "
                            f"({total_precip:.0f} mm vs normal {monthly_base:.0f} mm)"
                        )
                    elif ratio >= _PRECIP_HIGH_RATIO:
                        triggers.append(
                            f"Rainfall {ratio:.1f}× above seasonal baseline"
                        )
                    elif ratio <= _PRECIP_DRY_RATIO:
                        triggers.append(
                            f"Drought risk: rainfall only {total_precip:.0f} mm "
                            f"({ratio:.0%} of seasonal baseline {monthly_base:.0f} mm)"
                        )
        else:
            unsupported_rules.append("precipitation")
            rule_support["precipitation"] = "not_evaluable_yet"

        # ── 4. Wind ───────────────────────────────────────────────────────
        if mean_wind is not None:
            rule_support["wind"] = "copernicus_ready"
            supported_rules.append("wind")
            if mean_wind > wind_max:
                triggers.append(
                    f"Mean wind {mean_wind:.0f} km/h exceeds potato limit {wind_max:.0f} km/h"
                )
        else:
            unsupported_rules.append("wind")
            rule_support["wind"] = "not_evaluable_yet"

        # ── 5. Humidity / disease risk ────────────────────────────────────
        if estimated_rh is not None:
            rule_support["humidity"] = "copernicus_partial"  # estimated from dewpoint
            supported_rules.append("humidity")
            rh_max = rh_thresh["rh_max"]
            rh_min = rh_thresh["rh_min"]
            if estimated_rh > rh_max + 10:
                triggers.append(
                    f"Estimated RH {estimated_rh:.0f}% well above potato optimum "
                    f"({rh_max:.0f}%) — late blight risk elevated"
                )
                rule_support["late_blight"] = "copernicus_partial"
            elif estimated_rh < rh_min - 10:
                triggers.append(
                    f"Estimated RH {estimated_rh:.0f}% below potato optimum ({rh_min:.0f}%)"
                )
            # Late blight: mean temp 16-20°C + high RH
            if mean_temp_c is not None and 14 <= mean_temp_c <= 22 and estimated_rh >= 85:
                triggers.append(
                    "Late blight conducive conditions: cool temperature + high humidity"
                )
                rule_support["late_blight"] = "copernicus_partial"
        else:
            unsupported_rules.append("humidity")
            rule_support["humidity"] = "not_evaluable_yet"
            rule_support["late_blight"] = "not_evaluable_yet"

        # Fog/cloudiness and soil-temp rules are not derivable from SEAS5
        unsupported_rules.extend(["fog_driven_diseases", "soil_temperature_rules"])
        rule_support["fog_driven_diseases"] = "rag_only"
        rule_support["soil_temperature_rules"] = "not_evaluable_yet"

        # ── 6. Tier classification ────────────────────────────────────────
        tier = self._classify_tier(triggers, mean_temp_c, total_precip, temp_thresh, rain_thresh)

        # ── 7. RAG query payload ──────────────────────────────────────────
        rag_payload = self._build_rag_payload(
            location, valid_month, stages, triggers, mean_temp_c, total_precip
        )

        return {
            "location":              location,
            "crop":                  _CROP,
            "target_month":          valid_month,
            "assessed_at":           datetime.now(timezone.utc).isoformat(),
            "stages":                stages,
            "tier":                  tier,
            "tier_label":            _TIER_LABELS[tier],
            "copernicus_values":     copernicus,
            "baseline_values":       baseline,
            "triggers":              triggers,
            "supported_rules":       supported_rules,
            "unsupported_rules":     unsupported_rules,
            "rule_support":          rule_support,
            "deterministic_reasoning": self._reasoning(
                tier, location, valid_month, stages, triggers
            ),
            "rag_query_payload":     rag_payload,
        }

    # ------------------------------------------------------------------
    # Tier classifier
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_tier(
        triggers: list[str],
        mean_temp: float | None,
        total_precip: float | None,
        temp_thresh: dict,
        rain_thresh: dict,
    ) -> int:
        if not triggers:
            return 0

        severe   = 0
        advisory = 0

        for t in triggers:
            tl = t.lower()
            if ("exceeds potato limit" in tl and "temp" in tl) or \
               "critical rainfall" in tl or \
               "× above seasonal baseline" in tl and "2." in tl or \
               "drought risk" in tl:
                severe += 1
            elif "approaching" in tl or "warmer than" in tl or \
                 "high rainfall" in tl or "late blight" in tl or \
                 "drought" in tl or "above" in tl:
                advisory += 1
            else:
                advisory += 1

        if severe >= 2:
            return 3
        if severe == 1:
            return 2
        if advisory >= 1:
            return 1
        return 0

    # ------------------------------------------------------------------
    # Reasoning & RAG payload
    # ------------------------------------------------------------------

    @staticmethod
    def _reasoning(
        tier: int,
        location: str,
        valid_month: str,
        stages: list[str],
        triggers: list[str],
    ) -> str:
        stage_str = " / ".join(stages) if stages else "unknown stage"
        if tier == 0:
            return (
                f"Seasonal conditions in {location} for {valid_month} "
                f"(potato stage: {stage_str}) are within acceptable ranges. "
                "No significant risk factors identified in the Copernicus outlook."
            )
        label = _TIER_LABELS[tier]
        trig_str = "; ".join(triggers[:3]) if triggers else "multiple risk factors"
        action = (
            "Immediate seasonal planning adjustments recommended."
            if tier >= 3
            else "Review crop management plan and monitor field conditions."
            if tier == 2
            else "Be aware of developing conditions and adjust inputs if needed."
        )
        return (
            f"Seasonal {label} for {location} in {valid_month} "
            f"(potato stage: {stage_str}). "
            f"Key signals: {trig_str}. {action}"
        )

    @staticmethod
    def _build_rag_payload(
        location: str,
        valid_month: str,
        stages: list[str],
        triggers: list[str],
        mean_temp: float | None,
        total_precip: float | None,
    ) -> dict:
        keywords = ["potato", location.lower()]
        for stage in stages:
            keywords.append(stage.lower())
        if mean_temp is not None and mean_temp > 28:
            keywords.extend(["heat stress", "high temperature"])
        if total_precip is not None and total_precip < 20:
            keywords.extend(["drought", "irrigation"])
        if any("blight" in t.lower() for t in triggers):
            keywords.extend(["late blight", "fungicide", "disease management"])
        if any("rainfall" in t.lower() for t in triggers):
            keywords.extend(["waterlogging", "drainage"])

        return {
            "crop":        "potato",
            "location":    location,
            "month":       valid_month,
            "stages":      stages,
            "triggers":    triggers[:5],
            "keywords":    list(dict.fromkeys(keywords)),  # deduplicate preserving order
            "query_hint":  (
                f"potato {' '.join(stages[:2])} stage management "
                f"{location} {valid_month}"
            ),
        }
