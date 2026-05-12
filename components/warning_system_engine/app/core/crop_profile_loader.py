"""
CropProfileLoader — reads example_crop_profile.json and provides typed
accessors for the long-term assessment pipeline.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "example_crop_profile.json"


class CropProfileLoader:
    def __init__(self, path: Path = _DEFAULT_PATH) -> None:
        with open(path) as f:
            self._profiles: dict = json.load(f)

    # ------------------------------------------------------------------
    # Profile accessors
    # ------------------------------------------------------------------

    def get_profile(self, crop: str, region: str) -> dict:
        return self._profiles.get(f"{crop}_{region}".lower(), {})

    def get_crop_rules(self, crop: str, region: str) -> dict:
        return self.get_profile(crop, region).get("crop_rules", {})

    def get_weekly_calendar(self, crop: str, region: str) -> list[dict]:
        return self.get_profile(crop, region).get("weekly_calendar", [])

    def get_growth_stages(self, crop: str, region: str) -> list[dict]:
        return self.get_profile(crop, region).get("growth_stages", [])

    def get_derived_thresholds(self, crop: str, region: str) -> dict:
        return self.get_profile(crop, region).get("derived_thresholds", {})

    def get_season_span(self, crop: str, region: str) -> dict:
        return self.get_profile(crop, region).get("season_span", {})

    def get_disease_risks(self, crop: str, region: str) -> list[dict]:
        return self.get_profile(crop, region).get("disease_risks", [])

    # ------------------------------------------------------------------
    # Week-level lookups
    # ------------------------------------------------------------------

    def get_stage_for_week(self, crop: str, region: str, week: int) -> Optional[str]:
        for entry in self.get_weekly_calendar(crop, region):
            if entry.get("week") == week:
                return entry.get("stage")
        return None

    def get_weekly_baseline(self, crop: str, region: str, week: int) -> Optional[dict]:
        for entry in self.get_weekly_calendar(crop, region):
            if entry.get("week") == week:
                return entry
        return None

    def get_season_weeks(self, crop: str, region: str) -> list[int]:
        return self.get_season_span(crop, region).get("weeks", [])

    # ------------------------------------------------------------------
    # Month-level helpers
    # ------------------------------------------------------------------

    def weeks_in_month(self, year: int, month: int) -> list[int]:
        """ISO week numbers that overlap with a given calendar month."""
        seen: set[int] = set()
        d = date(year, month, 1)
        while d.month == month:
            seen.add(d.isocalendar()[1])
            d += timedelta(days=1)
        return sorted(seen)

    def stages_for_month(
        self, crop: str, region: str, year: int, month: int
    ) -> list[str]:
        """Distinct stage names that potato is in during a calendar month."""
        season_weeks = set(self.get_season_weeks(crop, region))
        stages: list[str] = []
        for week in self.weeks_in_month(year, month):
            if week in season_weeks:
                stage = self.get_stage_for_week(crop, region, week)
                if stage and stage not in stages:
                    stages.append(stage)
        return stages

    def baseline_for_month(
        self, crop: str, region: str, year: int, month: int
    ) -> dict:
        """
        Average weekly baseline values (temp, rainfall, RH) for all potato
        weeks that fall inside a calendar month.
        Returns empty dict if the month is outside the potato season.
        """
        season_weeks = set(self.get_season_weeks(crop, region))
        entries: list[dict] = []
        for week in self.weeks_in_month(year, month):
            if week in season_weeks:
                b = self.get_weekly_baseline(crop, region, week)
                if b:
                    entries.append(b)

        if not entries:
            return {}

        keys = ("temp_min_c", "temp_max_c", "temp_mean_c", "rainfall_mm",
                "rh_max_pct", "rh_min_pct")
        result: dict = {"week_count": len(entries), "weeks_in_season": [e["week"] for e in entries]}
        for k in keys:
            vals = [e[k] for e in entries if e.get(k) is not None]
            if vals:
                result[k] = round(sum(vals) / len(vals), 2)
        return result

    # ------------------------------------------------------------------
    # Threshold helpers (derived from crop_rules)
    # ------------------------------------------------------------------

    def temp_thresholds(self, crop: str, region: str) -> dict:
        rules = self.get_crop_rules(crop, region)
        return {
            "temp_min": float(rules.get("temperature_min", {}).get("min", 7)),
            "temp_max": float(rules.get("temperature_max", {}).get("max", 30)),
        }

    def rainfall_thresholds(self, crop: str, region: str) -> dict:
        rules = self.get_crop_rules(crop, region)
        rain_rules = rules.get("rainfall_daily", [])
        medium   = next((r["min"] for r in rain_rules if r["severity"] == "medium"),   25)
        critical = next((r["min"] for r in rain_rules if r["severity"] == "critical"), 100)
        return {"rain_medium": float(medium), "rain_critical": float(critical)}

    def wind_threshold(self, crop: str, region: str) -> float:
        rules = self.get_crop_rules(crop, region)
        return float(rules.get("wind_speed_kmh", {}).get("max", 30))

    def humidity_thresholds(self, crop: str, region: str) -> dict:
        rules = self.get_crop_rules(crop, region)
        h = rules.get("humidity", {})
        return {"rh_min": float(h.get("min", 65)), "rh_max": float(h.get("max", 80))}
