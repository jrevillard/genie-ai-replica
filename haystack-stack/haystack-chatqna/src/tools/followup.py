from typing import Dict, Any, Optional
from src.tools.base import BaseTool
from datetime import datetime, timedelta


class FollowupTool(BaseTool):
    name = "schedule_followup"
    description = "Schedule follow-up check-in based on triage level and condition"
    parameters = ["triage_level", "condition"]

    FOLLOWUP_SCHEDULE = {
        "EMERGENCY": {
            "interval_hours": 2,
            "message": "I will check on you in 2 hours. If you haven't reached the hospital, please call 199 NOW.",
            "priority": "critical",
        },
        "FACILITY": {
            "interval_hours": 24,
            "message": "I will check on you tomorrow. Please visit the health center today.",
            "priority": "high",
        },
        "CHW_VISIT": {
            "interval_hours": 48,
            "message": "I will check on you in 2 days. Your CHW should visit you soon.",
            "priority": "medium",
        },
        "SELF_CARE": {
            "interval_hours": 72,
            "message": "I will check on you in 3 days to see how you're doing.",
            "priority": "low",
        },
    }

    CONDITION_REMINDERS = {
        "diabetes": [
            "Remember to check your blood sugar regularly",
            "Take your medications as scheduled",
            "Watch what you eat - choose foods that don't spike sugar",
            "Stay hydrated - drink plenty of water",
        ],
        "hypertension": [
            "Monitor your blood pressure if you can",
            "Take your BP medications at the same time each day",
            "Reduce salt in your cooking",
            "Try to walk for 30 minutes daily",
        ],
        "heart_disease": [
            "Take all medications as prescribed",
            "Report any chest pain or shortness of breath immediately",
            "Avoid heavy physical exertion",
            "Eat heart-healthy foods - more fish, less fatty meat",
        ],
        "general": [
            "Rest well and stay hydrated",
            "Take your medications as prescribed",
            "Eat nutritious foods",
            "Contact us if symptoms change or worsen",
        ],
    }

    async def execute(
        self,
        triage_level: str = "SELF_CARE",
        condition: str = "general",
        **kwargs,
    ) -> Dict[str, Any]:
        schedule = self.FOLLOWUP_SCHEDULE.get(
            triage_level.upper(),
            self.FOLLOWUP_SCHEDULE["SELF_CARE"],
        )

        next_checkin = datetime.now() + timedelta(hours=schedule["interval_hours"])

        # Avoid very early morning and late evening scheduling
        # (Users can mention prayer times themselves if they observe them,
        # and we will respect those preferences then.)
        hour = next_checkin.hour
        if hour < 7:
            next_checkin = next_checkin.replace(hour=9, minute=0)
        elif hour >= 21:
            next_checkin = (next_checkin + timedelta(days=1)).replace(hour=9, minute=0)

        condition_key = condition.lower() if condition else "general"
        reminders = self.CONDITION_REMINDERS.get(
            condition_key,
            self.CONDITION_REMINDERS["general"],
        )

        return {
            "next_checkin": next_checkin.strftime("%Y-%m-%d %H:%M"),
            "interval_hours": schedule["interval_hours"],
            "message": schedule["message"],
            "priority": schedule["priority"],
            "reminders": reminders,
            "triage_level": triage_level,
            "condition": condition,
        }
