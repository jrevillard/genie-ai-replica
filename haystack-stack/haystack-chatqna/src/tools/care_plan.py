from typing import Dict, Any, List, Optional
from src.tools.base import BaseTool
from datetime import datetime
import uuid


class CarePlanTool(BaseTool):
    name = "generate_care_plan"
    description = "Generate or update a personalized NCD care plan for a patient based on their conditions, medications, and context"
    parameters = ["patient_id", "conditions", "medications", "region"]

    # Evidence-based care plan templates for common NCDs in The Gambia
    CARE_TEMPLATES = {
        "diabetes": {
            "monitoring": [
                {"task": "Check blood sugar", "frequency": "Daily (morning fasting)", "notes": "Target: 70-130 mg/dL fasting"},
                {"task": "Check feet for sores/cuts", "frequency": "Daily", "notes": "Diabetes can reduce feeling in feet"},
                {"task": "Blood pressure check", "frequency": "Weekly", "notes": "Diabetes increases heart risk"},
                {"task": "Eye check", "frequency": "Every 6 months", "notes": "Visit Sheikh Zayed Eye Centre"},
            ],
            "diet": [
                "Eat supakanja (okra stew) regularly - helps blood sugar",
                "Replace white rice with chere (millet) when possible",
                "Eat nyebbeh (black-eyed peas) for protein - affordable and filling",
                "Avoid sweet drinks - drink water or baobab juice (unsweetened)",
                "Eat smaller portions, 3 meals + 2 small snacks",
            ],
            "exercise": [
                {"task": "Walk for 30 minutes", "frequency": "5 days/week", "notes": "Morning or evening when cool"},
            ],
            "warning_signs": [
                "Blood sugar above 250 or below 70 - contact CHW",
                "Blood sugar above 400 or below 50 - GO TO HOSPITAL",
                "Blurred vision, numbness in feet, wounds that won't heal - visit health centre",
                "Feeling very thirsty, urinating very often - check blood sugar",
            ],
            "goals": [
                "Keep fasting blood sugar between 70-130 mg/dL",
                "Take medications every day as scheduled",
                "Walk 30 minutes at least 5 days a week",
                "Eat more vegetables with every meal",
            ],
        },
        "hypertension": {
            "monitoring": [
                {"task": "Check blood pressure", "frequency": "Daily if available, or weekly at HC", "notes": "Target: below 140/90"},
                {"task": "Check weight", "frequency": "Weekly", "notes": "Weight loss helps lower BP"},
                {"task": "Record any headaches/dizziness", "frequency": "When they occur", "notes": "These may signal uncontrolled BP"},
            ],
            "diet": [
                "REDUCE SALT - biggest single change you can make",
                "Use only 1 Maggi cube per pot instead of 2-3",
                "Cook with garlic, ginger, netetu (locust beans) instead of salt",
                "Eat more fruits: oranges, papaya, baobab (bouye) - high in potassium",
                "Reduce salted/dried fish (ketiakh) - eat fresh fish instead",
                "Avoid alcohol completely",
            ],
            "exercise": [
                {"task": "Walk briskly for 30 minutes", "frequency": "Daily", "notes": "Helps lower blood pressure naturally"},
                {"task": "Avoid heavy lifting", "frequency": "Always", "notes": "Can spike blood pressure"},
            ],
            "warning_signs": [
                "BP above 160/100 - see health centre within 24 hours",
                "BP above 180/120 - EMERGENCY - go to hospital NOW",
                "Severe headache with vision changes - EMERGENCY",
                "Chest pain or shortness of breath - call 199 immediately",
            ],
            "goals": [
                "Keep BP below 140/90 mmHg",
                "Take BP medication at the same time every day",
                "Reduce salt intake significantly",
                "Walk every day for at least 30 minutes",
            ],
        },
        "heart_disease": {
            "monitoring": [
                {"task": "Check blood pressure", "frequency": "Daily", "notes": "Target: below 130/80"},
                {"task": "Monitor for chest pain or shortness of breath", "frequency": "Always", "notes": "Call 199 if severe"},
                {"task": "Weigh yourself", "frequency": "Daily morning", "notes": "Sudden weight gain may mean fluid retention"},
            ],
            "diet": [
                "Eat fish 2-3 times per week - good for heart",
                "Use less palm oil - switch to groundnut oil in small amounts",
                "Eat lots of vegetables with every meal",
                "Avoid fried foods - boil, steam, or bake instead",
                "Limit salt and Maggi cubes",
            ],
            "exercise": [
                {"task": "Gentle walking", "frequency": "Daily, 20-30 minutes", "notes": "Stop if chest pain or dizziness"},
            ],
            "warning_signs": [
                "ANY chest pain or pressure - call 199 IMMEDIATELY",
                "Shortness of breath at rest - EMERGENCY",
                "Swelling in legs/ankles getting worse - see doctor",
                "Sudden weight gain (>2kg in a day) - contact health centre",
                "Feeling faint or very dizzy - sit down, call for help",
            ],
            "goals": [
                "Take ALL heart medications exactly as prescribed",
                "Keep BP below 130/80 mmHg",
                "Report any chest discomfort immediately",
                "Maintain healthy weight",
            ],
        },
    }

    async def execute(
        self,
        patient_id: str = None,
        conditions: List[str] = None,
        medications: List[str] = None,
        region: str = "Kanifing",
        **kwargs,
    ) -> Dict[str, Any]:
        conditions = conditions or []
        medications = medications or []

        plan = {
            "plan_id": f"CP{uuid.uuid4().hex[:8].upper()}",
            "patient_id": patient_id,
            "created_at": datetime.now().isoformat(),
            "conditions": conditions,
            "monitoring": [],
            "diet": [],
            "exercise": [],
            "warning_signs": [],
            "goals": [],
            "medications_schedule": [],
            "followup": [],
        }

        # Build plan from condition templates
        seen_diet = set()
        for condition in conditions:
            cond_key = condition.lower().replace(" ", "_")
            # Map common names
            cond_map = {
                "diabetes": "diabetes", "diabetic": "diabetes", "type_2": "diabetes",
                "hypertension": "hypertension", "high_blood_pressure": "hypertension",
                "heart_disease": "heart_disease", "cardiac": "heart_disease",
            }
            template_key = cond_map.get(cond_key)
            if template_key and template_key in self.CARE_TEMPLATES:
                template = self.CARE_TEMPLATES[template_key]
                plan["monitoring"].extend(template["monitoring"])
                plan["exercise"].extend(template["exercise"])
                plan["warning_signs"].extend(template["warning_signs"])
                plan["goals"].extend(template["goals"])
                for tip in template["diet"]:
                    if tip not in seen_diet:
                        plan["diet"].append(tip)
                        seen_diet.add(tip)

        # Add medication reminders
        from src.tools.medication import MedicationTool
        med_tool = MedicationTool()
        for med_name in medications:
            med_key = med_name.lower().replace(" ", "")
            if med_key in med_tool.MEDICATIONS:
                med = med_tool.MEDICATIONS[med_key]
                plan["medications_schedule"].append({
                    "name": med["name"],
                    "local_name": med["local_name"],
                    "timing": med["timing"],
                    "frequency": med["frequency"],
                    "warnings": med["warnings"],
                })

        # Add follow-up schedule
        plan["followup"] = [
            {"task": "CHW home visit", "frequency": "Every 2 weeks"},
            {"task": "Health centre check-up", "frequency": "Monthly"},
            {"task": "Amina check-in call/SMS", "frequency": "Weekly"},
        ]

        # Default for unknown conditions
        if not plan["goals"]:
            plan["goals"] = [
                "Take medications as prescribed",
                "Eat more vegetables, less salt and oil",
                "Walk for 30 minutes daily",
                "Visit health centre if symptoms worsen",
            ]

        return plan
