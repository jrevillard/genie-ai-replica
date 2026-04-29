from typing import Dict, Any, List
from src.tools.base import BaseTool
from src.models.enums import TriageLevel


class TriageTool(BaseTool):
    name = "assess_triage"
    description = "Assess symptoms and determine appropriate triage level (SELF_CARE, CHW_VISIT, FACILITY, or EMERGENCY)"
    parameters = ["symptoms", "conditions", "medications"]

    RED_FLAGS = [
        "chest pain", "chest pressure", "heart attack",
        "can't breathe", "difficulty breathing", "shortness of breath",
        "can't see", "vision loss", "blurred vision suddenly",
        "severe headache", "worst headache", "thunderclap headache",
        "confusion", "disoriented", "can't speak",
        "fainting", "fainted", "unconscious", "passed out",
        "blood sugar over 400", "blood sugar under 50",
        "bp over 180", "severe high blood pressure",
        "stroke", "face drooping", "arm weakness",
        "seizure", "convulsion",
        "bleeding heavily", "won't stop bleeding",
        "severe pain", "unbearable pain",
    ]

    MODERATE_FLAGS = [
        "fever", "temperature",
        "vomiting", "can't keep food down",
        "diarrhea", "loose stool",
        "swelling", "edema",
        "dizziness", "lightheaded",
        "numbness", "tingling",
        "blood in urine", "blood in stool",
        "missed medication", "out of medication",
        "blood sugar over 250", "blood sugar under 70",
        "bp over 160",
    ]

    async def execute(
        self,
        symptoms: str,
        conditions: List[str] = None,
        medications: List[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        symptoms_lower = symptoms.lower()
        conditions = conditions or []
        medications = medications or []

        # Check for red flags - EMERGENCY
        for flag in self.RED_FLAGS:
            if flag in symptoms_lower:
                return {
                    "level": TriageLevel.EMERGENCY,
                    "reasoning": f"Red flag detected: '{flag}' requires immediate medical attention",
                    "immediate_action": "Call 199 or go to nearest emergency facility immediately",
                    "warning_signs": "Do not wait - this could be life-threatening",
                    "matched_flag": flag,
                }

        # Check moderate flags - FACILITY or CHW
        for flag in self.MODERATE_FLAGS:
            if flag in symptoms_lower:
                if any(c.lower() in ["diabetes", "hypertension", "heart disease"] for c in conditions):
                    return {
                        "level": TriageLevel.FACILITY,
                        "reasoning": f"Moderate symptom '{flag}' with existing condition requires facility visit",
                        "immediate_action": "Visit your health center within 24 hours",
                        "warning_signs": "If symptoms worsen, go to emergency immediately",
                        "matched_flag": flag,
                    }
                else:
                    return {
                        "level": TriageLevel.CHW_VISIT,
                        "reasoning": f"Symptom '{flag}' should be assessed by Community Health Worker",
                        "immediate_action": "Contact your CHW for a visit within 24-48 hours",
                        "warning_signs": "If symptoms worsen, visit health center",
                        "matched_flag": flag,
                    }

        # Default to self-care for minor symptoms
        return {
            "level": TriageLevel.SELF_CARE,
            "reasoning": "Symptoms appear manageable with self-care and monitoring",
            "immediate_action": "Rest, stay hydrated, and monitor symptoms",
            "warning_signs": "If symptoms persist more than 3 days or worsen, contact CHW",
            "matched_flag": None,
        }
