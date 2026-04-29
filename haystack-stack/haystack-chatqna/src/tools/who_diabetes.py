"""
WHO PEN Section 2.2 — Diabetes Management Protocol

Implements the WHO PEN Type 2 diabetes treatment flowchart:
  Lifestyle → Metformin → Gliclazide → Insulin referral
Includes diagnosis criteria, treatment escalation, complication screening, and acute management.
"""

from typing import Dict, Any, List, Optional
from src.tools.base import BaseTool


class WHODiabetesTool(BaseTool):
    name = "manage_diabetes"
    description = (
        "WHO PEN diabetes management protocol. Diagnose diabetes from glucose/HbA1c values, "
        "determine treatment step (lifestyle, metformin, gliclazide, insulin referral), "
        "screen for complications, and manage acute hypo/hyperglycemia."
    )
    parameters = ["fasting_glucose", "random_glucose", "hba1c", "current_treatment", "symptoms"]

    # WHO PEN Diagnosis thresholds (page 21)
    DIAGNOSIS = {
        "fpg_mmol": 7.0,       # ≥7.0 mmol/L
        "fpg_mgdl": 126,       # ≥126 mg/dL
        "rpg_mmol": 11.1,      # ≥11.1 mmol/L
        "rpg_mgdl": 200,       # ≥200 mg/dL
        "hba1c_pct": 6.5,      # ≥6.5%
        "hba1c_mmol": 48,      # ≥48 mmol/mol
    }

    # Treatment goal
    GOAL_HBA1C = 7.0        # <7% generally
    GOAL_FPG_MGDL = 126     # <126 mg/dL
    GOAL_FPG_MMOL = 7.0     # <7.0 mmol/L

    # Acute thresholds
    SEVERE_HYPO_MGDL = 50    # <50 mg/dL
    SEVERE_HYPER_MGDL = 325  # >325 mg/dL (18 mmol/L)

    def _normalize_glucose(self, value: float, unit: str = "mg/dL") -> Dict:
        """Convert glucose to both units."""
        if unit == "mmol/L":
            return {"mmol": value, "mgdl": round(value * 18, 1)}
        return {"mgdl": value, "mmol": round(value / 18, 2)}

    def _diagnose(self, fpg: float = None, rpg: float = None, hba1c: float = None) -> Dict:
        """Apply WHO PEN diagnostic criteria."""
        is_diabetic = False
        criteria_met = []

        if fpg and fpg >= self.DIAGNOSIS["fpg_mgdl"]:
            is_diabetic = True
            criteria_met.append(f"FPG {fpg} mg/dL ≥ 126 mg/dL")
        if rpg and rpg >= self.DIAGNOSIS["rpg_mgdl"]:
            is_diabetic = True
            criteria_met.append(f"RPG {rpg} mg/dL ≥ 200 mg/dL")
        if hba1c and hba1c >= self.DIAGNOSIS["hba1c_pct"]:
            is_diabetic = True
            criteria_met.append(f"HbA1c {hba1c}% ≥ 6.5%")

        return {
            "is_diabetic": is_diabetic,
            "criteria_met": criteria_met,
        }

    def _determine_treatment_step(
        self, fpg: float, rpg: float, current_treatment: str, hba1c: float = None
    ) -> Dict:
        """WHO PEN treatment flowchart (pages 23-24)."""
        glucose = fpg or rpg or 0

        # Check for severe hyperglycemia requiring referral
        if glucose >= self.SEVERE_HYPER_MGDL:
            return {
                "step": "urgent_referral",
                "action": "FPG/RPG > 325 mg/dL (18 mmol/L). Test urine ketones.",
                "ketones_2plus": "REFER to higher level of care immediately",
                "ketones_less_2": "Begin gliclazide 80mg 2x daily. Reassess in 3-5 days.",
                "urgency": "high",
            }

        current = (current_treatment or "").lower()

        # Step 1: No treatment — lifestyle only
        if current in ("", "none", "lifestyle"):
            at_goal = fpg and fpg < self.GOAL_FPG_MGDL
            if at_goal:
                return {
                    "step": "lifestyle",
                    "action": "Continue diet and physical activity counselling",
                    "reassess": "3 months",
                    "at_goal": True,
                }
            return {
                "step": "start_metformin",
                "action": "Goal not achieved with lifestyle alone. START METFORMIN 500mg 1x daily.",
                "counselling": "Continue diet, physical activity, and adherence counselling at all visits",
                "reassess": "3 months",
                "at_goal": False,
            }

        # Step 2: On metformin
        if "metformin" in current and "gliclazide" not in current:
            at_goal = fpg and fpg < self.GOAL_FPG_MGDL
            if at_goal:
                return {
                    "step": "continue_metformin",
                    "action": "Goal achieved. Continue current metformin dose.",
                    "reassess": "3 months",
                    "at_goal": True,
                }

            if "1000" in current or "2x" in current:
                # Already at max metformin, add gliclazide
                return {
                    "step": "add_gliclazide",
                    "action": "Goal not achieved on max metformin. ADD gliclazide 80mg 1x daily.",
                    "counselling": "Counsel on hypoglycemia at all subsequent visits",
                    "reassess": "3 months",
                    "at_goal": False,
                }
            else:
                return {
                    "step": "increase_metformin",
                    "action": "Goal not achieved. Increase metformin to 1000mg 1x daily, then 1000mg 2x daily.",
                    "reassess": "3 months",
                    "at_goal": False,
                }

        # Step 3: On metformin + gliclazide
        if "gliclazide" in current:
            at_goal = fpg and fpg < self.GOAL_FPG_MGDL
            if at_goal:
                return {
                    "step": "continue_combination",
                    "action": "Goal achieved. Continue metformin + gliclazide.",
                    "reassess": "3 months",
                    "at_goal": True,
                }
            return {
                "step": "refer_for_insulin",
                "action": (
                    "Goal not achieved despite adherence to metformin + gliclazide, "
                    "healthy diet and physical activity. "
                    "REFER to higher-level health care facility for starting insulin."
                ),
                "alternative": (
                    "If more affordable than insulin, DPP-4 inhibitors, SGLT2 inhibitors, "
                    "or pioglitazone can be used before insulin."
                ),
                "urgency": "moderate",
                "at_goal": False,
            }

        # Default
        return {
            "step": "assess",
            "action": "Assess current treatment and glucose levels to determine next step.",
            "reassess": "3 months",
        }

    def _screen_complications(self) -> Dict:
        """WHO PEN chronic complications screening (page 25)."""
        return {
            "screening_schedule": [
                {"test": "Blood pressure", "frequency": "Every scheduled visit", "action": "Review medication per hypertension protocol"},
                {"test": "Dilated-pupil retinal exam", "frequency": "At diagnosis, then every 2 years", "action": "REFER to ophthalmologist if indicated"},
                {"test": "Foot examination", "frequency": "Every visit", "action": "Check for ulcers, pulses, sensation. REFER if ulcer present"},
                {"test": "Proteinuria test", "frequency": "Annually", "action": "REFER if positive"},
                {"test": "Amputation risk assessment", "frequency": "Annually", "action": "Monofilament test, foot pulses. REFER if abnormal"},
            ],
        }

    def _manage_acute(self, glucose: float) -> Optional[Dict]:
        """WHO PEN acute complication management (page 25)."""
        if glucose <= self.SEVERE_HYPO_MGDL:
            return {
                "type": "SEVERE HYPOGLYCEMIA",
                "urgency": "EMERGENCY",
                "actions": [
                    "If CONSCIOUS: give a sugar-sweetened drink",
                    "If UNCONSCIOUS: give 20-50ml of 50% glucose (dextrose) IV over 1-3 minutes",
                    "Monitor blood sugar every 15 minutes until stable",
                ],
            }
        if glucose >= self.SEVERE_HYPER_MGDL:
            return {
                "type": "SEVERE HYPERGLYCEMIA",
                "urgency": "URGENT",
                "actions": [
                    "Test urine ketones",
                    "If ketones ≥2+: REFER to hospital",
                    "Set up IV drip 0.9% NaCl — 1 litre in 2 hours, continue 1 litre every 4 hours",
                    "REFER to hospital",
                ],
            }
        return None

    async def execute(
        self,
        fasting_glucose: float = None,
        random_glucose: float = None,
        hba1c: float = None,
        current_treatment: str = None,
        symptoms: str = None,
        screen_complications: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        result = {
            "who_pen_reference": "Section 2.2 — Diabetes Management",
        }

        # Check for acute emergency first
        glucose = fasting_glucose or random_glucose
        if glucose:
            acute = self._manage_acute(glucose)
            if acute:
                result["acute_management"] = acute
                return result

        # Diagnosis
        if fasting_glucose or random_glucose or hba1c:
            diagnosis = self._diagnose(fasting_glucose, random_glucose, hba1c)
            result["diagnosis"] = diagnosis

            if diagnosis["is_diabetic"]:
                result["diagnosis"]["message"] = (
                    "Diabetes confirmed based on: " + "; ".join(diagnosis["criteria_met"])
                )
            else:
                result["diagnosis"]["message"] = (
                    "Diabetes NOT confirmed on current values. "
                    "Retest if symptomatic or at high risk."
                )

        # Treatment step
        if glucose and current_treatment is not None:
            result["treatment"] = self._determine_treatment_step(
                fasting_glucose, random_glucose, current_treatment, hba1c
            )

        # Lifestyle counselling (always)
        result["lifestyle"] = {
            "diet": "Healthy diet to achieve/maintain normal body weight",
            "activity": "Regular physical activity — 30 min/day, 5 days/week",
            "tobacco": "Advise on avoidance of tobacco use",
            "alcohol": "Advise against harmful use of alcohol",
        }

        # Complication screening
        if screen_complications:
            result["complications_screening"] = self._screen_complications()

        # Treatment goals
        result["goals"] = {
            "hba1c": "<7% (or <8% for patients with frequent hypoglycemia/limited life expectancy)",
            "fpg": "<7.0 mmol/L (<126 mg/dL)",
            "bp": "<130/80 mmHg (for patients with diabetes)",
            "notes": "Statins recommended for all Type 2 diabetes patients >40 years",
        }

        # Follow-up
        result["follow_up"] = {
            "frequency": "Every 3 months until controlled, then every 6 months",
            "monitoring": "HbA1c (preferred) or FPG at each visit",
            "refer_if": [
                "Goal not achieved in 3 months",
                "Urine ketones ≥2+",
                "No improvement after pharmacological intervention + lifestyle",
            ],
        }

        return result
