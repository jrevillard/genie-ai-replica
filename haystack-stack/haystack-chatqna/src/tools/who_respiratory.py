"""
WHO PEN Section 2.3 — Chronic Respiratory Diseases

Differential diagnosis: Asthma vs COPD based on history.
Asthma: stepwise treatment (salbutamol → beclometasone → higher dose → theophylline → prednisolone).
COPD: salbutamol → theophylline → ipratropium. Exacerbation management.
"""

from typing import Dict, Any, List
from src.tools.base import BaseTool


class WHORespiratoryTool(BaseTool):
    name = "assess_respiratory"
    description = (
        "WHO PEN respiratory disease assessment. Differentiates asthma vs COPD, "
        "determines treatment step, manages exacerbations per WHO PEN Section 2.3."
    )
    parameters = ["symptoms", "pefr_improvement", "severity"]

    ASTHMA_INDICATORS = [
        "symptoms since childhood",
        "history of hayfever", "history of eczema", "allergies",
        "intermittent symptoms", "asymptomatic periods",
        "worse at night", "worse early morning",
        "triggered by exercise", "triggered by weather", "triggered by stress",
        "responds to salbutamol",
    ]

    COPD_INDICATORS = [
        "heavy smoking", "20 cigarettes",
        "burning fossil fuels", "occupational dust",
        "started after 40", "middle age",
        "worsened slowly", "long period",
        "daily cough", "frequent cough", "sputum",
        "persistent symptoms", "little day-to-day variation",
    ]

    ASTHMA_STEPS = [
        {"step": 1, "treatment": "Inhaled salbutamol as needed (prn)", "for": "Mild intermittent"},
        {"step": 2, "treatment": "Salbutamol prn + low-dose inhaled beclometasone 100µg twice daily", "for": "Mild persistent"},
        {"step": 3, "treatment": "Salbutamol prn + higher-dose beclometasone 200-400µg twice daily", "for": "Moderate persistent"},
        {"step": 4, "treatment": "Step 3 + low-dose oral theophylline", "for": "Moderate-severe"},
        {"step": 5, "treatment": "Step 4 + oral prednisolone (lowest dose, usually <10mg daily)", "for": "Severe. Refer to specialist."},
    ]

    def _differential(self, symptoms: str) -> Dict:
        s = symptoms.lower()
        asthma_score = sum(1 for ind in self.ASTHMA_INDICATORS if ind in s)
        copd_score = sum(1 for ind in self.COPD_INDICATORS if ind in s)

        if asthma_score > copd_score:
            return {"likely": "asthma", "confidence": "moderate", "asthma_indicators": asthma_score, "copd_indicators": copd_score}
        elif copd_score > asthma_score:
            return {"likely": "copd", "confidence": "moderate", "asthma_indicators": asthma_score, "copd_indicators": copd_score}
        return {"likely": "uncertain", "confidence": "low", "note": "Measure PEFR before and after salbutamol. ≥20% improvement suggests asthma."}

    def _asthma_control_check(self) -> Dict:
        return {
            "controlled_when": [
                "Daytime symptoms ≤2 times/week",
                "Salbutamol use ≤2 times/week",
                "Night symptoms <2 times/month",
                "No or minimal limitation of daily activities",
                "No severe exacerbation within a month",
                "PEFR >80% predicted (if available)",
            ],
            "review_frequency": "Every 3-6 months, more often if not controlled",
        }

    def _exacerbation_management(self, severity: str) -> Dict:
        if severity == "very_severe":
            return {
                "severity": "VERY SEVERE",
                "signs": "Altered consciousness, exhaustion, arrhythmia, cyanosis, SpO2 <92%",
                "treatment": [
                    "Prednisolone 30-40mg for 5 days (adults), 1mg/kg for 3 days (children)",
                    "Salbutamol high-dose via MDI+spacer (4 puffs every 20 min for 1 hour) or nebulizer",
                    "Oxygen if available (target SpO2 >90%)",
                    "REFER to hospital immediately",
                ],
            }
        return {
            "severity": "SEVERE",
            "signs": "PEFR 33-50%, RR >25, HR ≥110, can't complete sentences",
            "treatment": [
                "Prednisolone 30-40mg for 5 days",
                "Salbutamol high-dose via MDI+spacer or nebulizer",
                "Oxygen if available",
                "Reassess at intervals. If not responding, increase salbutamol frequency or add nebulized ipratropium.",
            ],
        }

    async def execute(
        self,
        symptoms: str = "",
        pefr_improvement: float = None,
        severity: str = None,
        current_step: int = None,
        is_exacerbation: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        result = {"who_pen_reference": "Section 2.3 — Chronic Respiratory Diseases"}

        # Exacerbation management takes priority
        if is_exacerbation:
            sev = severity if severity in ("severe", "very_severe") else "severe"
            result["exacerbation"] = self._exacerbation_management(sev)
            return result

        # Differential diagnosis
        if symptoms:
            result["differential"] = self._differential(symptoms)

        # PEFR-based diagnosis (page 32)
        if pefr_improvement is not None:
            if pefr_improvement >= 20:
                result["pefr_diagnosis"] = {"likely": "asthma", "pefr_improvement": f"{pefr_improvement}%", "note": "≥20% improvement after salbutamol confirms asthma"}
            else:
                result["pefr_diagnosis"] = {"likely": "copd", "pefr_improvement": f"{pefr_improvement}%", "note": "<20% improvement suggests COPD"}

        # Treatment
        likely = result.get("differential", {}).get("likely") or result.get("pefr_diagnosis", {}).get("likely")

        if likely == "asthma":
            step = current_step if current_step and 1 <= current_step <= 5 else 1
            result["treatment"] = {
                "current_step": self.ASTHMA_STEPS[step - 1],
                "all_steps": self.ASTHMA_STEPS,
                "control_criteria": self._asthma_control_check(),
                "prevention": [
                    "Avoid cigarette smoke and known triggers",
                    "Avoid dusty and smoke-filled rooms",
                    "Avoid drugs like NSAIDs and beta-blockers",
                    "Regular physical activity and exercises",
                ],
                "refer_when": ["Asthma poorly controlled", "Diagnosis uncertain", "Regular oral prednisolone needed"],
            }
        elif likely == "copd":
            result["treatment"] = {
                "step_1": "Inhaled salbutamol, 2 puffs as needed, up to 4 times daily",
                "step_2": "If still symptomatic, add low-dose oral theophylline",
                "step_3": "If available, ipratropium inhaler can replace or add to salbutamol",
                "critical": [
                    "STOP SMOKING — most important intervention",
                    "Avoid indoor air pollution (cooking with wood/carbon in enclosed spaces)",
                    "Keep cooking area well ventilated",
                    "Avoid occupational dust exposure",
                ],
                "exacerbation": "Antibiotics for all exacerbations with evidence of infection. For severe: prednisolone 30-40mg for 7 days.",
            }

        return result
