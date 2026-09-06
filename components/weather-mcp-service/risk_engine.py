"""
RiskEngine — stateless Tier 0–4 weather risk classifier.

Design:
  - No database access — takes UnifiedForecast, returns RiskAssessment
  - Tier thresholds align with WMO colour-coded alert levels
  - IPC risk escalation: multi-hazard events bump the tier by +1 (capped at 4)
  - Multi-day patterns (heatwave sequences, drought runs) are detected separately

Tier table:
  0  Normal     All parameters within seasonal norms
  1  Advisory   Rain ≥50mm/day  |  Heat ≥38°C  |  Wind ≥62km/h
  2  Warning    Rain ≥100mm/day |  Heat ≥40°C  |  Wind ≥88km/h  | heatwave (3+ days)
  3  Severe     Rain ≥200mm/day |  Heat ≥43°C  |  Wind ≥118km/h | two simultaneous T2+
  4  Emergency  Multi-hazard catastrophic combination
"""
from datetime import datetime, timezone

from models import (
    DayForecast,
    RiskAssessment,
    TIER_LABELS,
    UnifiedForecast,
)

# ---------------------------------------------------------------------------
# Threshold constants  (all values are "≥" unless noted)
# ---------------------------------------------------------------------------
_T = {
    # Precipitation  (mm / day)
    "rain_1": 50.0,
    "rain_2": 100.0,
    "rain_3": 200.0,
    # Temperature  (°C, daily maximum)
    "heat_1": 38.0,
    "heat_2": 40.0,
    "heat_3": 43.0,
    # Wind speed  (km/h, daily maximum gust)
    "wind_1": 62.0,   # Beaufort 8 – gale
    "wind_2": 88.0,   # Beaufort 10 – cyclone approach
    "wind_3": 118.0,  # Beaufort 12 – hurricane force
    # Pattern windows
    "heatwave_days": 3,    # ≥ heat_2 for this many consecutive days
    "drought_days": 14,    # < 1 mm/day for this many consecutive days
}


class RiskEngine:
    """
    Stateless Tier 0–4 classifier.

    Usage:
        engine = RiskEngine()
        assessment = engine.classify(unified_forecast)
    """

    def classify(self, forecast: UnifiedForecast) -> RiskAssessment:
        """
        Evaluate the forecast window and return a RiskAssessment.
        The tier is set by the worst single day or the worst multi-day pattern,
        whichever is higher.
        """
        day_tier = 0
        day_triggers: list[str] = []
        worst_day: DayForecast | None = None

        for day in forecast.forecast:
            t, triggers = self._score_day(day)
            if t > day_tier:
                day_tier = t
                day_triggers = triggers
                worst_day = day

        pattern_tier, pattern_triggers = self._score_patterns(forecast.forecast)

        if pattern_tier > day_tier:
            final_tier = pattern_tier
            final_triggers = pattern_triggers
            worst_day = worst_day  # keep worst single day for raw_forecast
        else:
            final_tier = day_tier
            final_triggers = day_triggers

        final_tier = min(final_tier, 4)

        return RiskAssessment(
            location=forecast.location,
            assessed_at=datetime.now(timezone.utc).isoformat(),
            horizon=forecast.horizon,
            tier=final_tier,
            tier_label=TIER_LABELS[final_tier],
            triggers=final_triggers,
            reasoning=self._reasoning(final_tier, final_triggers, forecast.location, worst_day),
            forecast_source=forecast.source,
            raw_forecast=worst_day.model_dump() if worst_day else {},
        )

    # ------------------------------------------------------------------
    # Single-day scoring
    # ------------------------------------------------------------------

    def _score_day(self, day: DayForecast) -> tuple[int, list[str]]:
        tier = 0
        triggers: list[str] = []

        rain  = day.precipitation.value
        max_t = day.temperature.max
        wind  = day.wind.speed

        # Precipitation
        if rain >= _T["rain_3"]:
            tier = max(tier, 3)
            triggers.append(f"Extreme rainfall {rain:.0f} mm/day (≥200 mm — severe flood risk)")
        elif rain >= _T["rain_2"]:
            tier = max(tier, 2)
            triggers.append(f"Heavy rainfall {rain:.0f} mm/day (≥100 mm — warning)")
        elif rain >= _T["rain_1"]:
            tier = max(tier, 1)
            triggers.append(f"Significant rainfall {rain:.0f} mm/day (≥50 mm — advisory)")

        # Temperature
        if max_t >= _T["heat_3"]:
            tier = max(tier, 3)
            triggers.append(f"Life-threatening heat {max_t:.1f}°C (≥43°C)")
        elif max_t >= _T["heat_2"]:
            tier = max(tier, 2)
            triggers.append(f"Heatwave temperature {max_t:.1f}°C (≥40°C — warning)")
        elif max_t >= _T["heat_1"]:
            tier = max(tier, 1)
            triggers.append(f"Heat discomfort {max_t:.1f}°C (≥38°C — advisory)")

        # Wind
        if wind >= _T["wind_3"]:
            tier = max(tier, 3)
            triggers.append(f"Hurricane-force wind {wind:.0f} km/h (≥118 km/h)")
        elif wind >= _T["wind_2"]:
            tier = max(tier, 2)
            triggers.append(f"Cyclone-strength wind {wind:.0f} km/h (≥88 km/h — warning)")
        elif wind >= _T["wind_1"]:
            tier = max(tier, 1)
            triggers.append(f"Gale-force wind {wind:.0f} km/h (≥62 km/h — advisory)")

        # Explicit cyclone flag set by the data source
        if day.extreme_flags.cyclone_risk:
            tier = max(tier, 3)
            if not any("cyclone" in t.lower() for t in triggers):
                triggers.append("Cyclone risk flag set by source data")

        # IPC multi-hazard escalation: ≥2 independent Tier-2+ triggers → +1 tier
        if tier >= 2 and len(triggers) >= 2:
            tier = min(tier + 1, 4)
            triggers.append("Multi-hazard escalation (IPC combined risk +1 tier)")

        return tier, triggers

    # ------------------------------------------------------------------
    # Multi-day pattern scoring
    # ------------------------------------------------------------------

    def _score_patterns(self, days: list[DayForecast]) -> tuple[int, list[str]]:
        tier = 0
        triggers: list[str] = []

        # Heatwave: N consecutive days ≥ heat_2
        hot_run = 0
        for day in days:
            if day.temperature.max >= _T["heat_2"]:
                hot_run += 1
                if hot_run >= _T["heatwave_days"] and tier < 2:
                    tier = 2
                    triggers.append(
                        f"Heatwave: {hot_run} consecutive days ≥{_T['heat_2']:.0f}°C"
                    )
            else:
                hot_run = 0

        # Drought indicator: N consecutive days < 1 mm
        dry_run = 0
        for day in days:
            if day.precipitation.value < 1.0:
                dry_run += 1
                if dry_run >= _T["drought_days"] and tier < 1:
                    tier = 1
                    triggers.append(
                        f"Drought indicator: {dry_run} consecutive dry days (<1 mm/day)"
                    )
            else:
                dry_run = 0

        return tier, triggers

    # ------------------------------------------------------------------
    # Reasoning text
    # ------------------------------------------------------------------

    @staticmethod
    def _reasoning(
        tier: int,
        triggers: list[str],
        location: str,
        worst_day: DayForecast | None,
    ) -> str:
        if tier == 0:
            return (
                f"Weather conditions in {location} are within normal seasonal ranges. "
                "No hazard indicators detected in the forecast window."
            )

        label = TIER_LABELS[tier]
        date_str = f" on {worst_day.date}" if worst_day else ""
        trigger_str = "; ".join(triggers) if triggers else "elevated risk indicators"
        action = (
            "Immediate protective action recommended."
            if tier >= 3
            else "Take precautions and monitor official advisories."
            if tier == 2
            else "Be aware and monitor conditions."
        )

        return (
            f"Risk level {tier} ({label}) detected for {location}{date_str}. "
            f"Key triggers: {trigger_str}. {action}"
        )
