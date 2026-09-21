"""Regression tests for BAMIS calendar-aware short-term crop warnings."""

from __future__ import annotations

import unittest

from app.workflows.short_term.crop_ews import CropShortTermEWS


class FakeStorage:
    def __init__(self, forecast: list[dict]) -> None:
        self.forecast = forecast
        self.saved: dict | None = None

    def get_latest_forecast_pair(self, _location: str):
        return (
            {
                "source": "open_meteo",
                "sense_check_passed": True,
                "forecast": self.forecast,
            },
            None,
        )

    def upsert_crop_assessment(self, assessment: dict, _crop: str) -> str:
        self.saved = assessment
        return "saved"

    def was_crop_alert_sent(self, *_args, **_kwargs) -> bool:
        return False


def forecast_day(
    day: str,
    *,
    temp_min: float = 25.2,
    temp_max: float = 31.1,
    humidity_min: float = 70.0,
    humidity_max: float = 96.0,
    rain: float = 7.8,
    wind: float = 10.0,
) -> dict:
    return {
        "date": day,
        "temperature": {"min": temp_min, "max": temp_max},
        "humidity": humidity_max,
        "humidity_min": humidity_min,
        "precipitation": {"value": rain},
        "wind": {"speed": wind},
    }


class CropCalendarWarningTests(unittest.TestCase):
    def evaluate(self, crop: str, days: list[dict]) -> dict:
        storage = FakeStorage(days)
        result = CropShortTermEWS(storage, crop).evaluate("Sapahar")
        self.assertEqual(storage.saved, result)
        return result

    def test_mango_is_normal_outside_its_bamis_season(self):
        result = self.evaluate(
            "mango",
            [forecast_day("2026-09-20"), forecast_day("2026-09-21")],
        )

        self.assertFalse(result["in_season"])
        self.assertEqual(result["profile_region"], "rajshahi")
        self.assertEqual(result["tier"], 0)
        self.assertEqual(result["triggers"], [])
        self.assertFalse(
            CropShortTermEWS(FakeStorage([]), "mango").should_alert(result)
        )

    def test_normal_harvesting_weather_does_not_warn_for_eggplant(self):
        result = self.evaluate(
            "eggplant",
            [forecast_day("2026-09-20"), forecast_day("2026-09-21")],
        )

        self.assertTrue(result["in_season"])
        self.assertEqual(result["crop_stages"], ["Harvesting"])
        self.assertEqual(result["tier"], 0)
        self.assertEqual(result["triggers"], [])

    def test_eggplant_early_stage_rain_uses_advisory_then_warning(self):
        advisory = self.evaluate(
            "eggplant",
            [forecast_day("2026-05-01", rain=7.8, humidity_max=90.0)],
        )
        warning = self.evaluate(
            "eggplant",
            [forecast_day("2026-05-01", rain=12.0, humidity_max=90.0)],
        )

        self.assertEqual(advisory["tier"], 1)
        self.assertEqual(warning["tier"], 2)
        self.assertIn("Rainfall 12.0mm/day", warning["triggers"][0])

    def test_mango_compound_rules_apply_during_pea_stage(self):
        result = self.evaluate(
            "mango",
            [
                forecast_day(
                    "2026-03-04",
                    temp_min=17.0,
                    temp_max=29.0,
                    humidity_min=40.0,
                    humidity_max=91.0,
                    rain=4.0,
                    wind=21.0,
                )
            ],
        )

        self.assertEqual(result["crop_stages"], ["Pea Stage"])
        self.assertEqual(result["tier"], 3)
        self.assertEqual(len(result["triggers"]), 4)

    def test_rice_aman_flowering_uses_source_rain_threshold(self):
        normal = self.evaluate(
            "rice_aman",
            [forecast_day("2026-09-18", rain=7.8, humidity_max=96.0)],
        )
        result = self.evaluate(
            "rice_aman",
            [forecast_day("2026-09-18", rain=55.0, humidity_max=90.0)],
        )

        self.assertLess(normal["tier"], 2)
        self.assertEqual(result["crop_stages"], ["Flowering"])
        self.assertEqual(result["tier"], 2)
        self.assertTrue(any("50.0mm/day" in trigger for trigger in result["triggers"]))


if __name__ == "__main__":
    unittest.main()
