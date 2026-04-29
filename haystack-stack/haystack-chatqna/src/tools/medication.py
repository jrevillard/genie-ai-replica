from typing import Dict, Any, Optional
from src.tools.base import BaseTool


class MedicationTool(BaseTool):
    name = "get_medication_info"
    description = "Get medication information, schedules, and Ramadan-adjusted timing"
    parameters = ["medication_name", "is_ramadan"]

    MEDICATIONS = {
        "metformin": {
            "name": "Metformin",
            "use": "Type 2 Diabetes - helps control blood sugar",
            "common_doses": ["500mg", "850mg", "1000mg"],
            "timing": "With meals to reduce stomach upset",
            "frequency": "Usually twice daily (morning and evening)",
            "ramadan_timing": "Take with Suhoor and Iftar",
            "side_effects": ["Stomach upset", "Diarrhea", "Nausea - usually improves over time"],
            "warnings": ["Take with food", "Stay hydrated", "Report any unusual fatigue"],
            "local_name": "Sugar tablet",
        },
        "amlodipine": {
            "name": "Amlodipine",
            "use": "High Blood Pressure - relaxes blood vessels",
            "common_doses": ["5mg", "10mg"],
            "timing": "Same time each day",
            "frequency": "Once daily",
            "ramadan_timing": "Can take at Iftar (doesn't need food)",
            "side_effects": ["Ankle swelling", "Dizziness", "Flushing"],
            "warnings": ["Don't stop suddenly", "Report severe swelling"],
            "local_name": "BP tablet",
        },
        "lisinopril": {
            "name": "Lisinopril",
            "use": "High Blood Pressure & Heart Protection - especially for diabetics",
            "common_doses": ["5mg", "10mg", "20mg"],
            "timing": "Same time each day, usually morning",
            "frequency": "Once daily",
            "ramadan_timing": "Take at Suhoor",
            "side_effects": ["Dry cough", "Dizziness", "Headache"],
            "warnings": ["Watch for swelling of face/lips", "May cause dry cough"],
            "local_name": "Heart/BP tablet",
        },
        "hydrochlorothiazide": {
            "name": "Hydrochlorothiazide (HCTZ)",
            "use": "High Blood Pressure - removes excess water",
            "common_doses": ["12.5mg", "25mg"],
            "timing": "Morning - causes urination",
            "frequency": "Once daily",
            "ramadan_timing": "Take at Suhoor (will cause urination during fast)",
            "side_effects": ["Frequent urination", "Dizziness", "Low potassium"],
            "warnings": ["Take in morning", "Eat potassium-rich foods (bananas, oranges)"],
            "local_name": "Water tablet",
        },
        "glibenclamide": {
            "name": "Glibenclamide",
            "use": "Type 2 Diabetes - helps pancreas release insulin",
            "common_doses": ["2.5mg", "5mg"],
            "timing": "Before meals",
            "frequency": "Once or twice daily",
            "ramadan_timing": "CAUTION during Ramadan - high hypo risk. Take at Iftar only.",
            "side_effects": ["Low blood sugar (hypoglycemia)", "Weight gain"],
            "warnings": ["ALWAYS eat after taking", "Carry sugar for emergencies"],
            "local_name": "Strong sugar tablet",
        },
        "aspirin": {
            "name": "Aspirin (low dose)",
            "use": "Heart Protection - prevents blood clots",
            "common_doses": ["75mg", "100mg"],
            "timing": "With food to protect stomach",
            "frequency": "Once daily",
            "ramadan_timing": "Take at Iftar with food",
            "side_effects": ["Stomach upset", "Easy bruising"],
            "warnings": ["Take with food", "Report black stools or unusual bleeding"],
            "local_name": "Blood thinning tablet",
        },
        "atorvastatin": {
            "name": "Atorvastatin",
            "use": "High Cholesterol - reduces heart disease risk",
            "common_doses": ["10mg", "20mg", "40mg"],
            "timing": "Evening (cholesterol made at night)",
            "frequency": "Once daily",
            "ramadan_timing": "Take at Iftar",
            "side_effects": ["Muscle pain", "Stomach upset"],
            "warnings": ["Report muscle pain or weakness"],
            "local_name": "Cholesterol tablet",
        },
    }

    async def execute(
        self,
        medication_name: str = None,
        is_ramadan: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        if medication_name:
            med_key = medication_name.lower().replace(" ", "")
            if med_key in self.MEDICATIONS:
                med = self.MEDICATIONS[med_key]
                result = {**med}
                if is_ramadan:
                    result["current_timing"] = med["ramadan_timing"]
                    result["ramadan_mode"] = True
                else:
                    result["current_timing"] = f"{med['timing']} - {med['frequency']}"
                    result["ramadan_mode"] = False
                return result
            else:
                return {
                    "error": f"Medication '{medication_name}' not found in database",
                    "available": list(self.MEDICATIONS.keys()),
                    "suggestion": "Please ask your healthcare provider about this medication",
                }

        return {
            "medications": [
                {"name": m["name"], "use": m["use"], "local_name": m["local_name"]}
                for m in self.MEDICATIONS.values()
            ]
        }
