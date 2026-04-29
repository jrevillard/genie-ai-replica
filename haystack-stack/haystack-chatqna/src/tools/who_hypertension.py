"""
WHO PEN Section 2.1 — Hypertension Management Protocol

Diagnosis: SBP ≥140 and/or DBP ≥90 on two visits on different days.
Treatment: Lifestyle + 4 classes of antihypertensives (ACEI, ARB, CCB, Thiazide).
Goal: <140/90 (or <130/80 for diabetes/high CVD risk).
"""

from typing import Dict, Any
from src.tools.base import BaseTool


class WHOHypertensionTool(BaseTool):
    name = "manage_hypertension"
    description = (
        "WHO PEN hypertension management protocol. Classify BP, determine treatment "
        "(lifestyle vs pharmacological), select drug class, and set follow-up per WHO HEARTS."
    )
    parameters = ["systolic_bp", "diastolic_bp", "has_diabetes", "cvd_risk_level", "current_meds"]

    DRUG_CLASSES = {
        "acei": {"name": "ACE Inhibitor (e.g. Enalapril)", "notes": "Good for diabetes/kidney. Watch for dry cough."},
        "arb": {"name": "ARB (e.g. Losartan)", "notes": "Alternative if ACEI cough. Good for diabetes."},
        "ccb": {"name": "Calcium Channel Blocker (e.g. Amlodipine)", "notes": "Good first-line. May cause ankle swelling."},
        "thiazide": {"name": "Thiazide Diuretic (e.g. Hydrochlorothiazide)", "notes": "Low cost. Monitor potassium. Take in morning."},
    }

    def _classify_bp(self, sbp: int, dbp: int) -> Dict:
        if sbp >= 180 or dbp >= 120:
            return {"stage": "hypertensive_crisis", "label": "Hypertensive Crisis", "urgency": "EMERGENCY"}
        if sbp >= 160 or dbp >= 100:
            return {"stage": "stage_2", "label": "Stage 2 Hypertension"}
        if sbp >= 140 or dbp >= 90:
            return {"stage": "stage_1", "label": "Stage 1 Hypertension"}
        if sbp >= 130 or dbp >= 80:
            return {"stage": "elevated", "label": "Elevated BP"}
        return {"stage": "normal", "label": "Normal BP"}

    async def execute(
        self,
        systolic_bp: int = 120,
        diastolic_bp: int = 80,
        has_diabetes: bool = False,
        cvd_risk_level: str = None,
        current_meds: str = None,
        **kwargs,
    ) -> Dict[str, Any]:
        classification = self._classify_bp(systolic_bp, diastolic_bp)
        target = "<130/80 mmHg" if has_diabetes else "<140/90 mmHg"

        result = {
            "bp_reading": f"{systolic_bp}/{diastolic_bp} mmHg",
            "classification": classification,
            "target": target,
            "who_pen_reference": "Section 2.1 — Hypertension Management",
        }

        # Emergency
        if classification["stage"] == "hypertensive_crisis":
            result["action"] = {
                "urgency": "EMERGENCY",
                "immediate": "REFER to hospital immediately",
                "while_waiting": "Keep patient calm and seated. Do NOT give sublingual nifedipine.",
            }
            return result

        # Treatment plan
        stage = classification["stage"]
        lifestyle = [
            "Reduce salt intake to <5g/day (1 teaspoon). Limit Maggi cubes.",
            "Eat more fruits and vegetables (5 servings/day)",
            "Physical activity: 30 min brisk walking, 5+ days/week",
            "Maintain healthy weight",
            "Stop tobacco use",
            "Limit alcohol",
        ]

        if stage == "normal":
            result["action"] = {"treatment": "No treatment needed", "lifestyle": lifestyle, "follow_up": "Recheck annually"}
        elif stage == "elevated":
            needs_meds = has_diabetes or (cvd_risk_level in ("high", "very_high"))
            if needs_meds:
                result["action"] = {
                    "treatment": "Start pharmacological treatment (diabetes or high CVD risk)",
                    "first_line": [self.DRUG_CLASSES["acei"], self.DRUG_CLASSES["ccb"]],
                    "lifestyle": lifestyle,
                    "follow_up": "Reassess in 4 weeks",
                }
            else:
                result["action"] = {"treatment": "Lifestyle modification only", "lifestyle": lifestyle, "follow_up": "Reassess in 3 months"}
        elif stage == "stage_1":
            result["action"] = {
                "treatment": "Start single antihypertensive drug + lifestyle",
                "first_line": [self.DRUG_CLASSES["ccb"], self.DRUG_CLASSES["thiazide"]],
                "alternative": [self.DRUG_CLASSES["acei"], self.DRUG_CLASSES["arb"]],
                "note": "For diabetes patients, prefer ACEI or ARB",
                "lifestyle": lifestyle,
                "follow_up": "Reassess in 4 weeks. If not at target, increase dose or add second drug.",
            }
        elif stage == "stage_2":
            result["action"] = {
                "treatment": "Start combination therapy (2 drugs) + lifestyle",
                "recommended": "CCB + ACEI (or CCB + Thiazide)",
                "drugs": [self.DRUG_CLASSES["ccb"], self.DRUG_CLASSES["acei"]],
                "lifestyle": lifestyle,
                "follow_up": "Reassess in 2-4 weeks. If not at target, add third drug or refer.",
            }

        # Note on current medications
        if current_meds:
            result["current_medications"] = current_meds
            result["note"] = "Review current medications. Proper treatment usually requires combination of 2-3 drugs."

        return result
