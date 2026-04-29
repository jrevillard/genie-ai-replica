from typing import Dict, Any, Optional
from src.tools.base import BaseTool
import json
import os


class ReferralTool(BaseTool):
    name = "find_facility"
    description = "Find appropriate health facility based on region and care level needed"
    parameters = ["region", "care_level", "specialty"]

    def __init__(self):
        self.facilities = self._load_facilities()

    def _load_facilities(self) -> Dict:
        facilities_path = os.path.join(os.path.dirname(__file__), "../../data/facilities.json")
        if os.path.exists(facilities_path):
            with open(facilities_path, "r") as f:
                return json.load(f)

        return {
            "primary": {
                "Banjul": ["Banjul Health Centre", "EFSTH Outpatient Clinic"],
                "Kanifing": ["Serrekunda Health Centre", "Faji Kunda HC", "Bakoteh HC", "Kotu HC"],
                "West Coast": ["Brikama Health Centre", "Gunjur HC", "Sanyang HC", "Kartong HC"],
                "North Bank": ["Essau Health Centre", "Kerewan HC", "Farafenni HC"],
                "Lower River": ["Soma Health Centre", "Mansakonko HC", "Kwinella HC"],
                "Central River": ["Bansang Hospital", "Janjanbureh HC", "Kuntaur HC"],
                "Upper River": ["Basse Health Centre", "Fatoto HC", "Sabi HC"],
            },
            "secondary": {
                "Greater Banjul": ["EFSTH (Edward Francis Small Teaching Hospital)"],
                "North Bank": ["Farafenni Hospital"],
                "Central River": ["Bansang Hospital"],
                "Upper River": ["Basse Hospital"],
            },
            "specialist": {
                "diabetes": "EFSTH Diabetes Clinic",
                "eye": "Sheikh Zayed Regional Eye Care Centre",
                "cardiac": "EFSTH Cardiology Unit",
                "renal": "EFSTH Renal Unit",
            },
            "emergency": {
                "number": "199",
                "main": "EFSTH Emergency Department",
            },
        }

    async def execute(
        self,
        region: str = "Kanifing",
        care_level: str = "primary",
        specialty: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        result = {
            "region": region,
            "care_level": care_level,
            "facilities": [],
            "emergency_number": "199",
        }

        # Specialist referral
        if specialty and specialty.lower() in self.facilities.get("specialist", {}):
            result["facilities"] = [self.facilities["specialist"][specialty.lower()]]
            result["care_level"] = "specialist"
            result["notes"] = f"Specialist referral for {specialty}. Call ahead for appointment."
            return result

        # Emergency
        if care_level.upper() == "EMERGENCY":
            result["facilities"] = [self.facilities["emergency"]["main"]]
            result["emergency_number"] = self.facilities["emergency"]["number"]
            result["notes"] = "EMERGENCY: Call 199 or go directly to facility"
            return result

        # Primary care
        if care_level.lower() == "primary":
            primary = self.facilities.get("primary", {})
            result["facilities"] = primary.get(region, primary.get("Kanifing", []))
            result["notes"] = "Visit during clinic hours (8am-4pm). Bring any medications you're taking."

        # Secondary care
        elif care_level.lower() in ["secondary", "facility"]:
            secondary = self.facilities.get("secondary", {})
            region_map = {
                "Banjul": "Greater Banjul",
                "Kanifing": "Greater Banjul",
                "West Coast": "Greater Banjul",
                "North Bank": "North Bank",
                "Lower River": "Central River",
                "Central River": "Central River",
                "Upper River": "Upper River",
            }
            mapped_region = region_map.get(region, "Greater Banjul")
            result["facilities"] = secondary.get(mapped_region, secondary.get("Greater Banjul", []))
            result["notes"] = "Hospital visit recommended. Bring referral letter if available."

        if not result["facilities"]:
            result["facilities"] = ["EFSTH (Edward Francis Small Teaching Hospital)"]
            result["notes"] = "Default referral to main hospital."

        return result
