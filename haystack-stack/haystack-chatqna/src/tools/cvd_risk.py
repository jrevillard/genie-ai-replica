"""
WHO PEN Section 2.1 — Cardiovascular Disease Risk Assessment & Management

Implements the WHO CVD risk prediction chart logic for Sub-Saharan Africa.
Risk levels: <5% (green), 5-10% (yellow), 10-20% (orange), 20-30% (red), ≥30% (deep red).
Treatment decisions are stratified by risk level per WHO HEARTS protocol.
"""

from typing import Dict, Any, List, Optional
from src.tools.base import BaseTool


class CVDRiskTool(BaseTool):
    name = "assess_cvd_risk"
    description = (
        "Assess 10-year cardiovascular disease risk using WHO PEN risk charts. "
        "Requires age, sex, smoking status, diabetes status, systolic BP, and total cholesterol. "
        "Returns risk level, color code, and treatment recommendations per WHO HEARTS protocol."
    )
    parameters = ["age", "sex", "is_smoker", "has_diabetes", "systolic_bp", "total_cholesterol"]

    # Simplified WHO CVD risk matrix for Sub-Saharan Africa (Eastern)
    # Based on WHO PEN page 19 charts — approximated for programmatic use
    # Key: (diabetes, sex, smoker) -> age_group -> sbp_group -> cholesterol_group -> risk%
    # Simplified to threshold-based rules that approximate the chart

    def _estimate_risk(
        self,
        age: int,
        sex: str,
        is_smoker: bool,
        has_diabetes: bool,
        systolic_bp: int,
        total_cholesterol: float,
    ) -> int:
        """Estimate 10-year CVD risk percentage using WHO chart approximation."""
        base_risk = 2

        # Age contribution
        if age >= 70:
            base_risk += 15
        elif age >= 65:
            base_risk += 10
        elif age >= 60:
            base_risk += 7
        elif age >= 55:
            base_risk += 5
        elif age >= 50:
            base_risk += 3
        elif age >= 45:
            base_risk += 1

        # Sex — men have higher baseline risk
        if sex.lower() in ("male", "m"):
            base_risk += 3

        # Smoking
        if is_smoker:
            base_risk += 5

        # Diabetes
        if has_diabetes:
            base_risk += 5

        # Systolic BP contribution
        if systolic_bp >= 180:
            base_risk += 10
        elif systolic_bp >= 160:
            base_risk += 7
        elif systolic_bp >= 140:
            base_risk += 4
        elif systolic_bp >= 120:
            base_risk += 1

        # Total cholesterol (mmol/L) contribution
        if total_cholesterol >= 7:
            base_risk += 5
        elif total_cholesterol >= 6:
            base_risk += 3
        elif total_cholesterol >= 5:
            base_risk += 1

        return min(base_risk, 50)  # Cap at 50%

    def _get_risk_category(self, risk_pct: int) -> Dict[str, Any]:
        if risk_pct >= 30:
            return {
                "level": "very_high",
                "color": "deep_red",
                "label": "Very High Risk (≥30%)",
                "10_year_risk": f"{risk_pct}%",
            }
        elif risk_pct >= 20:
            return {
                "level": "high",
                "color": "red",
                "label": "High Risk (20-30%)",
                "10_year_risk": f"{risk_pct}%",
            }
        elif risk_pct >= 10:
            return {
                "level": "moderate",
                "color": "orange",
                "label": "Moderate Risk (10-20%)",
                "10_year_risk": f"{risk_pct}%",
            }
        elif risk_pct >= 5:
            return {
                "level": "low_moderate",
                "color": "yellow",
                "label": "Low-Moderate Risk (5-10%)",
                "10_year_risk": f"{risk_pct}%",
            }
        else:
            return {
                "level": "low",
                "color": "green",
                "label": "Low Risk (<5%)",
                "10_year_risk": f"{risk_pct}%",
            }

    def _get_treatment_plan(self, risk_category: Dict, systolic_bp: int, has_diabetes: bool) -> Dict:
        """WHO PEN treatment recommendations stratified by risk level."""
        level = risk_category["level"]

        plan = {
            "lifestyle": [
                "Counsel on healthy diet (reduce salt <5g/day, increase fruits/vegetables)",
                "Physical activity: 30 minutes brisk walking, 5 days/week",
                "Stop tobacco use if applicable",
                "Avoid harmful use of alcohol",
            ],
            "pharmacological": [],
            "follow_up": "",
            "referral": None,
        }

        if level == "very_high":
            # >20% risk: treat BP if ≥130/80, give statin
            plan["pharmacological"] = [
                "Start antihypertensive if BP ≥130/80 mmHg (CCB or Thiazide or ACEI/ARB)",
                "Start statin therapy",
                "Low-dose aspirin (75-100mg daily) if no contraindication",
            ]
            plan["follow_up"] = "Follow-up every 3 months. Refer if no improvement in 6 months."
            if systolic_bp >= 180:
                plan["referral"] = "URGENT: BP ≥180 mmHg — refer to hospital immediately"

        elif level == "high":
            plan["pharmacological"] = [
                "Start antihypertensive if BP ≥130/80 mmHg",
                "Start statin therapy",
                "Consider low-dose aspirin",
            ]
            plan["follow_up"] = "Follow-up every 3 months."

        elif level == "moderate":
            plan["pharmacological"] = []
            if systolic_bp >= 140:
                plan["pharmacological"].append(
                    "Consider antihypertensive if persistent BP ≥140/90 mmHg"
                )
            plan["follow_up"] = "Follow-up every 3-6 months."

        elif level == "low_moderate":
            if systolic_bp >= 140:
                plan["pharmacological"].append(
                    "Consider antihypertensive if persistent BP ≥140/90 mmHg (per national policy)"
                )
            plan["follow_up"] = "Follow-up every 3 months until targets met, then every 6-9 months."

        else:  # low
            plan["follow_up"] = "Follow-up in 12 months if treatment not initiated."

        if has_diabetes:
            plan["pharmacological"].append(
                "See diabetes management protocol (WHO PEN Section 2.2)"
            )

        return plan

    # Conditions where risk charts are NOT needed (auto high-risk)
    AUTO_HIGH_RISK = [
        "established heart disease",
        "coronary heart disease",
        "myocardial infarction",
        "stroke",
        "transient ischaemic attack",
        "peripheral vascular disease",
    ]

    async def execute(
        self,
        age: int = 40,
        sex: str = "male",
        is_smoker: bool = False,
        has_diabetes: bool = False,
        systolic_bp: int = 120,
        total_cholesterol: float = 5.0,
        existing_cvd: str = None,
        **kwargs,
    ) -> Dict[str, Any]:
        # Check for auto high-risk conditions (WHO PEN page 14)
        if existing_cvd and any(
            cond in existing_cvd.lower() for cond in self.AUTO_HIGH_RISK
        ):
            return {
                "risk_category": {
                    "level": "very_high",
                    "color": "deep_red",
                    "label": "Very High Risk — Established CVD",
                    "10_year_risk": ">30%",
                },
                "auto_high_risk": True,
                "reason": f"Existing CVD: {existing_cvd}. Risk charts not needed — already high risk.",
                "treatment": {
                    "lifestyle": [
                        "Intensive lifestyle counselling",
                        "Strict dietary modification",
                        "Regular physical activity",
                        "Complete tobacco cessation",
                    ],
                    "pharmacological": [
                        "Statin therapy",
                        "Antihypertensive if BP ≥130/80",
                        "Low-dose aspirin (75-100mg daily)",
                        "Manage diabetes if present (see Section 2.2)",
                    ],
                    "follow_up": "Follow-up every 3 months. Refer to specialist if needed.",
                    "referral": None,
                },
                "parameters_used": {
                    "age": age, "sex": sex, "systolic_bp": systolic_bp,
                },
            }

        # Additional auto-high-risk: very high individual risk factors
        if systolic_bp > 170 or total_cholesterol >= 8:
            risk_pct = 35
        else:
            risk_pct = self._estimate_risk(
                age, sex, is_smoker, has_diabetes, systolic_bp, total_cholesterol
            )

        risk_category = self._get_risk_category(risk_pct)
        treatment = self._get_treatment_plan(risk_category, systolic_bp, has_diabetes)

        return {
            "risk_category": risk_category,
            "auto_high_risk": False,
            "treatment": treatment,
            "parameters_used": {
                "age": age,
                "sex": sex,
                "is_smoker": is_smoker,
                "has_diabetes": has_diabetes,
                "systolic_bp": systolic_bp,
                "total_cholesterol_mmol": total_cholesterol,
            },
            "who_pen_reference": "Section 2.1 — CVD Risk Assessment & Management",
        }
