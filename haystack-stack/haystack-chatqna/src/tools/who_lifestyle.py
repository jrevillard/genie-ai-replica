"""
WHO PEN Section 2.5 — Healthy Lifestyle Counselling
WHO PEN Section 2.6 — Self-Care

Covers: diet, physical activity, tobacco cessation (5 As), alcohol, treatment adherence.
"""

from typing import Dict, Any
from src.tools.base import BaseTool


class WHOLifestyleTool(BaseTool):
    name = "counsel_lifestyle"
    description = (
        "WHO PEN healthy lifestyle counselling and self-care guidance. "
        "Covers diet, exercise, tobacco cessation (5 As protocol), alcohol, and treatment adherence. "
        "Adapts advice to Gambian context with local food examples."
    )
    parameters = ["topic", "conditions"]

    async def execute(
        self,
        topic: str = "general",
        conditions: list = None,
        is_tobacco_user: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        conditions = conditions or []
        result = {"who_pen_reference": "Section 2.5 — Healthy Lifestyle Counselling & Section 2.6 — Self-Care"}

        t = topic.lower()

        if t in ("diet", "nutrition", "food", "general"):
            result["diet"] = {
                "salt": {
                    "guideline": "Restrict to less than 5g (1 teaspoon) per day",
                    "gambian_tips": [
                        "Use only 1 Maggi cube per pot instead of 2-3",
                        "Cook with natural spices: garlic, ginger, netetu (locust beans)",
                        "Reduce salted/dried fish (ketiakh) — eat fresh fish instead",
                        "Don't add salt at the table",
                    ],
                },
                "fruits_vegetables": {
                    "guideline": "5 servings (400-500g) per day",
                    "gambian_tips": [
                        "Eat supakanja (okra stew) regularly — high in fiber",
                        "Add more vegetables to benachin — carrots, cabbage, bitter tomato",
                        "Eat seasonal fruits: mango, papaya, orange, baobab (bouye)",
                        "1 serving = 1 orange, apple, mango, banana or 3 tbsp cooked vegetables",
                    ],
                },
                "fats": {
                    "guideline": "Limit fatty meat, dairy fat, cooking oil (<2 tablespoons/day)",
                    "gambian_tips": [
                        "Reduce palm oil — use just enough to coat the pot",
                        "Choose fish over fatty meats most days",
                        "Eat domoda (groundnut stew) in smaller portions — good protein but high fat",
                        "Avoid fried street foods — choose boiled or baked",
                    ],
                },
                "fish": "Eat fish at least 3 times per week (tuna, mackerel, local ocean fish)",
                "grains": "Choose chere (millet porridge) or nyebbeh (black-eyed peas) over white rice when possible",
            }

        if t in ("exercise", "physical_activity", "activity", "general"):
            result["physical_activity"] = {
                "guideline": "At least 30 minutes of moderate activity (brisk walking), 5 days/week",
                "gambian_tips": [
                    "Walk briskly in the morning or evening when cool",
                    "Walking to the market counts as exercise",
                    "Avoid sitting for long periods — stand and stretch regularly",
                    "For heart patients: gentle walking, stop if chest pain or dizziness",
                ],
                "weight": "Control body weight — reduce high-calorie food + adequate physical activity",
            }

        if t in ("tobacco", "smoking", "general") or is_tobacco_user:
            result["tobacco_cessation_5as"] = {
                "1_ask": "Do you use tobacco? (smoking or smokeless)",
                "2_advise": (
                    "Advise to quit in clear, strong, personalized manner: "
                    "'Tobacco increases risk of heart attack, stroke, lung cancer and respiratory diseases. "
                    "Quitting is the single most important thing you can do for your health.'"
                ),
                "3_assess": "Are you willing to make a quit attempt now?",
                "4_assist_if_yes": {
                    "plan": [
                        "Set a quit date",
                        "Inform family and friends — ask for support",
                        "Remove cigarettes/tobacco from home",
                        "Remove objects that prompt smoking",
                        "Arrange follow-up visit",
                    ],
                },
                "4_assist_if_no": {
                    "action": "Promote motivation to quit. Provide information on health hazards.",
                },
                "5_arrange": {
                    "follow_up": "Second visit within the same month, then monthly for 4 months",
                    "if_relapsed": "More intensive follow-up and family support",
                    "if_success": "Congratulate and reinforce",
                },
            }

        if t in ("alcohol", "general"):
            result["alcohol"] = {
                "guideline": "Alcohol abstinence should be reinforced",
                "do_not_use_when": [
                    "Driving or operating machinery",
                    "Pregnant or breastfeeding",
                    "Taking medications that interact with alcohol",
                    "Medical conditions made worse by alcohol",
                    "Difficulty controlling drinking",
                ],
                "note": "People should NOT be advised to start drinking for health reasons",
            }

        if t in ("adherence", "medication", "treatment", "general"):
            result["treatment_adherence"] = {
                "teach_patient": [
                    "How to take medication at home",
                    "Difference between long-term control meds and quick-relief meds",
                    "The reason for prescribing each medication",
                ],
                "show": "Appropriate dose and how many times per day",
                "check_understanding": "Before patient leaves health centre",
                "emphasize": [
                    "Keep adequate supply of medication",
                    "Take medication regularly even if no symptoms",
                    "Never stop medication suddenly without consulting health worker",
                ],
            }

        # Self-care by condition (WHO PEN Section 2.6)
        if t in ("self_care", "general"):
            result["self_care"] = {}
            if "hypertension" in [c.lower() for c in conditions]:
                result["self_care"]["hypertension"] = "Self-measurement of BP is recommended if affordable"
            if "diabetes" in [c.lower() for c in conditions]:
                result["self_care"]["diabetes"] = "Self-monitoring of blood glucose for patients on insulin, based on individual need"
            if "asthma" in [c.lower() for c in conditions] or "copd" in [c.lower() for c in conditions]:
                result["self_care"]["respiratory"] = "Self-monitoring and self-adjustment of inhaler dosage per agreed action plan with health professional"
            if not result["self_care"]:
                result["self_care"]["general"] = "All NCD patients can perform some level of self-care. Identify opportunities at each visit."

        return result
