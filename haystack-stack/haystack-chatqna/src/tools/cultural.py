from typing import Dict, Any
from src.tools.base import BaseTool
from datetime import datetime


class CulturalTool(BaseTool):
    name = "get_cultural_greeting"
    description = "Get culturally appropriate Mandinka/Gambian greeting based on time of day"
    parameters = []

    GREETINGS = {
        "morning": {
            "greeting": "Isama jang!",
            "english": "Good morning!",
            "followup": "I be di?",
            "followup_english": "How are you?",
            "period": "morning (before 12pm)",
        },
        "afternoon": {
            "greeting": "Itilii jang!",
            "english": "Good afternoon!",
            "followup": "I be di?",
            "followup_english": "How are you?",
            "period": "afternoon (12pm-5pm)",
        },
        "evening": {
            "greeting": "Iwulaara jang!",
            "english": "Good evening!",
            "followup": "I be di?",
            "followup_english": "How are you?",
            "period": "evening (after 5pm)",
        },
    }

    COMMON_PHRASES = {
        "thank_you": "Abaraka!",
        "how_are_you": "I be di?",
        "im_fine": "Jam rekk",
        "god_willing": "Insha'Allah",
        "praise_god": "Alhamdulillah",
        "peace_be_upon_you": "Assalamu Alaikum",
        "mother": "Mba",
        "father": "Mfa",
        "take_care": "I kana domoroo!",
        "get_well": "Allah mu i yandi",
    }

    def _get_time_period(self) -> str:
        hour = datetime.now().hour
        if hour < 12:
            return "morning"
        elif hour < 17:
            return "afternoon"
        else:
            return "evening"

    async def execute(self, **kwargs) -> Dict[str, Any]:
        period = self._get_time_period()
        greeting_data = self.GREETINGS[period]

        return {
            "greeting": f"{greeting_data['greeting']} {greeting_data['followup']}",
            "english": f"{greeting_data['english']} {greeting_data['followup_english']}",
            "period": greeting_data["period"],
            "common_phrases": self.COMMON_PHRASES,
        }
