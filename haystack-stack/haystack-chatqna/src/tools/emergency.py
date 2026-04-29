from typing import Dict, Any
from src.tools.base import BaseTool


class EmergencyTool(BaseTool):
    name = "check_emergency"
    description = "Check for emergency indicators and provide emergency response"
    parameters = ["symptoms", "region"]

    EMERGENCY_PATTERNS = [
        ("chest pain", "Possible heart attack"),
        ("chest pressure", "Possible heart attack"),
        ("can't breathe", "Breathing emergency"),
        ("difficulty breathing", "Breathing emergency"),
        ("severe shortness of breath", "Breathing emergency"),
        ("vision loss", "Possible stroke or diabetic emergency"),
        ("can't see", "Possible stroke or diabetic emergency"),
        ("sudden blindness", "Possible stroke or diabetic emergency"),
        ("face drooping", "Possible stroke - FAST"),
        ("arm weakness", "Possible stroke - FAST"),
        ("speech difficulty", "Possible stroke - FAST"),
        ("can't speak", "Possible stroke - FAST"),
        ("worst headache", "Possible stroke or aneurysm"),
        ("thunderclap headache", "Possible stroke or aneurysm"),
        ("fainted", "Loss of consciousness"),
        ("unconscious", "Loss of consciousness"),
        ("passed out", "Loss of consciousness"),
        ("collapsed", "Loss of consciousness"),
        ("not breathing", "Loss of consciousness"),
        ("seizure", "Seizure emergency"),
        ("convulsion", "Seizure emergency"),
        ("bleeding heavily", "Hemorrhage"),
        ("blood won't stop", "Hemorrhage"),
        ("suicide", "Mental health crisis"),
        ("want to die", "Mental health crisis"),
        ("kill myself", "Mental health crisis"),
        ("overdose", "Poisoning emergency"),
    ]

    FACILITIES = {
        "Banjul": "EFSTH Emergency (Banjul) - Call 199",
        "Kanifing": "EFSTH Emergency (Banjul) - 15min drive - Call 199",
        "West Coast": "Brikama Health Centre or EFSTH - Call 199",
        "North Bank": "Farafenni Hospital - Call 199",
        "Central River": "Bansang Hospital - Call 199",
        "Upper River": "Basse Hospital - Call 199",
        "Lower River": "Bansang Hospital - Call 199",
    }

    async def execute(
        self,
        symptoms: str,
        region: str = "Kanifing",
        **kwargs,
    ) -> Dict[str, Any]:
        symptoms_lower = symptoms.lower()

        for pattern, condition in self.EMERGENCY_PATTERNS:
            if pattern in symptoms_lower:
                nearest = self.FACILITIES.get(region, self.FACILITIES["Kanifing"])

                immediate_actions = {
                    "Possible heart attack": "Sit upright, stay calm, chew aspirin if available. Do NOT lie flat.",
                    "Breathing emergency": "Sit upright, loosen clothing. If someone is with you, have them call 199.",
                    "Possible stroke or diabetic emergency": "Note the time symptoms started. Do NOT give food or water.",
                    "Possible stroke - FAST": "Note the time. Face drooping, Arm weakness, Speech difficulty = Time to call 199.",
                    "Loss of consciousness": "Place person on their side (recovery position). Clear airway.",
                    "Seizure emergency": "Clear area around person. Do NOT put anything in mouth. Time the seizure.",
                    "Hemorrhage": "Apply firm pressure with clean cloth. Elevate if possible.",
                    "Mental health crisis": "You are not alone. Please call 199 or go to EFSTH. Someone cares about you.",
                    "Poisoning emergency": "Do NOT induce vomiting. Bring the substance container to the hospital.",
                    "Possible stroke or aneurysm": "Keep still, do not take any medication. Call 199 immediately.",
                }

                return {
                    "is_emergency": True,
                    "condition": condition,
                    "nearest_facility": nearest,
                    "immediate_action": immediate_actions.get(condition, "Stay calm and call 199 immediately."),
                    "warning_signs": f"This may be: {condition}. Every minute counts.",
                    "emergency_number": "199",
                }

        return {
            "is_emergency": False,
            "condition": None,
            "notes": "No immediate emergency detected, but monitor symptoms closely.",
        }
