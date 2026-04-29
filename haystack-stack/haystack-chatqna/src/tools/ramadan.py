from typing import Dict, Any, List
from src.tools.base import BaseTool
from datetime import datetime, date


class RamadanTool(BaseTool):
    name = "check_ramadan"
    description = "Check if it is currently Ramadan and provide fasting-safe medication and health guidance"
    parameters = ["medications"]

    # Approximate Ramadan dates (Hijri calendar shifts ~11 days/year)
    # Updated annually — these cover 2024-2030
    RAMADAN_DATES = {
        2024: (date(2024, 3, 11), date(2024, 4, 9)),
        2025: (date(2025, 2, 28), date(2025, 3, 30)),
        2026: (date(2026, 2, 17), date(2026, 3, 19)),
        2027: (date(2027, 2, 7), date(2027, 3, 8)),
        2028: (date(2028, 1, 27), date(2028, 2, 25)),
        2029: (date(2029, 1, 15), date(2029, 2, 13)),
        2030: (date(2030, 1, 5), date(2030, 2, 3)),
    }

    # Medications with special Ramadan guidance
    RAMADAN_MED_GUIDANCE = {
        "metformin": {
            "safe_to_fast": True,
            "adjustment": "Take with Suhoor (pre-dawn meal) and Iftar (sunset). Skip midday dose if any.",
            "risk": "Low risk of hypoglycemia. Stay hydrated at Iftar.",
        },
        "glibenclamide": {
            "safe_to_fast": False,
            "adjustment": "HIGH RISK during fasting. Take ONLY at Iftar. Skip Suhoor dose. Monitor sugar closely.",
            "risk": "HIGH risk of hypoglycemia during fasting. Break fast immediately if dizzy/shaky.",
        },
        "amlodipine": {
            "safe_to_fast": True,
            "adjustment": "Take at Iftar. Once daily — no change needed.",
            "risk": "Low risk. May cause slight dizziness during fasting.",
        },
        "lisinopril": {
            "safe_to_fast": True,
            "adjustment": "Take at Suhoor with water.",
            "risk": "Low risk. May lower BP slightly more during fasting.",
        },
        "hydrochlorothiazide": {
            "safe_to_fast": True,
            "adjustment": "Take at Suhoor. Will cause urination during fasting — may cause dehydration.",
            "risk": "Medium risk of dehydration. Drink extra water at Suhoor and Iftar.",
        },
        "aspirin": {
            "safe_to_fast": True,
            "adjustment": "Take at Iftar with food to protect stomach.",
            "risk": "Low risk.",
        },
        "atorvastatin": {
            "safe_to_fast": True,
            "adjustment": "Take at Iftar. Works best in evening anyway.",
            "risk": "Low risk.",
        },
        "insulin": {
            "safe_to_fast": False,
            "adjustment": "CONSULT DOCTOR before fasting. May need dose adjustment. Long-acting at Iftar, skip daytime rapid.",
            "risk": "HIGH risk of hypoglycemia. Must monitor sugar frequently. Break fast if sugar <70.",
        },
    }

    FASTING_TIPS = [
        "Drink plenty of water between Iftar and Suhoor (aim for 8 glasses)",
        "Eat Suhoor as late as possible — don't skip it",
        "Break fast with dates and water, then a balanced meal",
        "Avoid very salty foods at Iftar — they increase thirst",
        "Avoid heavy, oily foods — they can spike blood sugar",
        "If you feel dizzy, very weak, or shaky during fasting — BREAK YOUR FAST. Islam permits this for health.",
        "Check blood sugar at least twice: before Suhoor and 2 hours after Iftar",
    ]

    BREAK_FAST_SIGNS = [
        "Blood sugar below 70 mg/dL — eat sugar immediately",
        "Blood sugar above 300 mg/dL — drink water, take medication",
        "Severe dizziness or fainting — break fast, rest, seek help",
        "Chest pain or difficulty breathing — break fast and call 199",
        "Signs of dehydration: very dark urine, confusion, rapid heartbeat",
    ]

    def is_ramadan(self, check_date: date = None) -> bool:
        check_date = check_date or date.today()
        year = check_date.year
        if year in self.RAMADAN_DATES:
            start, end = self.RAMADAN_DATES[year]
            return start <= check_date <= end
        return False

    def days_until_ramadan(self, check_date: date = None) -> int:
        check_date = check_date or date.today()
        year = check_date.year
        for y in (year, year + 1):
            if y in self.RAMADAN_DATES:
                start, _ = self.RAMADAN_DATES[y]
                if start > check_date:
                    return (start - check_date).days
        return -1

    async def execute(
        self,
        medications: List[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        medications = medications or []
        today = date.today()
        currently_ramadan = self.is_ramadan(today)
        days_to_ramadan = self.days_until_ramadan(today)

        result = {
            "is_ramadan": currently_ramadan,
            "days_until_ramadan": days_to_ramadan if not currently_ramadan else 0,
            "medication_guidance": [],
            "fasting_tips": self.FASTING_TIPS if currently_ramadan else [],
            "break_fast_signs": self.BREAK_FAST_SIGNS if currently_ramadan else [],
            "any_high_risk": False,
        }

        # Add Ramadan dates for this year
        year = today.year
        if year in self.RAMADAN_DATES:
            start, end = self.RAMADAN_DATES[year]
            result["ramadan_start"] = start.isoformat()
            result["ramadan_end"] = end.isoformat()

        # Assess each medication for Ramadan safety
        for med_name in medications:
            med_key = med_name.lower().replace(" ", "")
            if med_key in self.RAMADAN_MED_GUIDANCE:
                guidance = self.RAMADAN_MED_GUIDANCE[med_key]
                result["medication_guidance"].append({
                    "medication": med_name,
                    **guidance,
                })
                if not guidance["safe_to_fast"]:
                    result["any_high_risk"] = True
            else:
                result["medication_guidance"].append({
                    "medication": med_name,
                    "safe_to_fast": None,
                    "adjustment": "Please consult your doctor about this medication during Ramadan",
                    "risk": "Unknown — ask your healthcare provider",
                })

        # Pre-Ramadan advisory (2 weeks before)
        if not currently_ramadan and 0 < days_to_ramadan <= 14:
            result["pre_ramadan_advisory"] = (
                f"Ramadan begins in {days_to_ramadan} days. "
                "Please visit your health centre to discuss your medication schedule during fasting. "
                "This is especially important if you take diabetes or blood pressure medication."
            )

        return result
