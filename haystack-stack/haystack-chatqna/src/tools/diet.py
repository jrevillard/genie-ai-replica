from typing import Dict, Any, Optional
from src.tools.base import BaseTool


class DietTool(BaseTool):
    name = "get_diet_advice"
    description = "Get culturally-appropriate Gambian dietary advice for NCD management"
    parameters = ["condition", "concern"]

    GAMBIAN_FOODS = {
        "benachin": {
            "name": "Benachin (Jollof Rice)",
            "description": "One-pot rice with fish/meat and vegetables",
            "healthy_tips": [
                "Reduce palm oil by half - use just enough to coat the pot",
                "Add more vegetables (carrots, cabbage, bitter tomato)",
                "Use less rice, more fish and vegetables",
                "Choose fish over fatty meats",
            ],
            "portion": "1 cup rice portion (size of your fist)",
        },
        "domoda": {
            "name": "Domoda (Groundnut Stew)",
            "description": "Groundnut (peanut) stew with meat/fish",
            "healthy_tips": [
                "Good protein from groundnuts, but limit portion due to fat",
                "Add vegetables like okra, eggplant",
                "Choose lean meat or fish",
                "Eat with small portion of rice",
            ],
            "portion": "1/2 cup stew with 1 cup rice",
        },
        "supakanja": {
            "name": "Supakanja (Okra Stew)",
            "description": "Okra and leafy green stew",
            "healthy_tips": [
                "Excellent choice! Okra helps control blood sugar",
                "Rich in fiber and vitamins",
                "Reduce palm oil amount",
                "Very good for diabetics and heart health",
            ],
            "portion": "Generous portion encouraged",
        },
        "chere": {
            "name": "Chereh (Millet/Sorghum Porridge)",
            "description": "Traditional millet or sorghum porridge",
            "healthy_tips": [
                "Better than white rice for blood sugar",
                "High in fiber - keeps you full longer",
                "Don't add too much sugar",
                "Add groundnuts for protein",
            ],
            "portion": "1-2 cups",
        },
        "nyebbeh": {
            "name": "Nyebbeh (Black-eyed Peas)",
            "description": "Black-eyed peas cooked with rice or alone",
            "healthy_tips": [
                "Excellent! High protein, low cost",
                "Great for blood sugar control",
                "Good source of fiber",
                "Affordable alternative to meat",
            ],
            "portion": "1 cup - can eat more",
        },
    }

    CONDITION_ADVICE = {
        "diabetes": {
            "foods_encouraged": [
                "Supakanja (okra stew) - helps blood sugar",
                "Nyebbeh (black-eyed peas) - high fiber, low sugar spike",
                "Chere (millet porridge) - better than white rice",
                "Fish - lean protein",
                "Leafy greens (moringa, cassava leaves)",
                "Bitter tomato (jakhato)",
            ],
            "foods_limited": [
                "White rice - reduce portion, mix with beans",
                "Sweet drinks - avoid completely",
                "White bread - choose brown bread when possible",
                "Ripe mango, banana - limit to small portions",
            ],
            "general_tips": [
                "Eat smaller portions, more frequently",
                "Always combine carbohydrates with protein or vegetables",
                "Don't skip meals - causes blood sugar swings",
                "Drink water, not sweet drinks or sodas",
            ],
        },
        "hypertension": {
            "foods_encouraged": [
                "Fresh fruits (oranges, papaya, watermelon)",
                "Vegetables - especially leafy greens",
                "Fish - especially small ocean fish",
                "Nyebbeh and other beans",
                "Baobab fruit (bouye) - high in potassium",
            ],
            "foods_limited": [
                "Salt - cook with less, don't add at table",
                "Maggi cubes - very high in salt, use herbs instead",
                "Salted fish (ketiakh) - eat only occasionally",
                "Palm oil - reduce amount",
                "Smoked meats",
            ],
            "general_tips": [
                "REDUCE SALT - biggest change you can make",
                "Use natural spices: garlic, ginger, locust beans (netetu)",
                "Limit Maggi cubes to 1 per pot",
                "Eat more fruits and vegetables for potassium",
            ],
        },
        "heart_disease": {
            "foods_encouraged": [
                "Fish - especially 2-3 times per week",
                "Groundnuts (in moderation - good fats)",
                "Vegetables and fruits",
                "Whole grains (millet, sorghum)",
                "Beans and lentils",
            ],
            "foods_limited": [
                "Fatty meats - choose lean cuts",
                "Excessive palm oil",
                "Fried foods - bake or boil instead",
                "Salt and Maggi",
                "Sweet drinks and alcohol",
            ],
            "general_tips": [
                "Choose fish over meat most days",
                "Reduce cooking oil - use less than usual",
                "Eat plenty of vegetables with each meal",
                "Avoid fried street foods",
            ],
        },
    }

    async def execute(
        self,
        condition: str = "general",
        concern: str = None,
        food: str = None,
        **kwargs,
    ) -> Dict[str, Any]:
        result = {}

        # Specific food advice
        if food:
            food_key = food.lower().replace(" ", "")
            if food_key in self.GAMBIAN_FOODS:
                result["food_advice"] = self.GAMBIAN_FOODS[food_key]

        # Condition-specific advice
        condition_lower = condition.lower() if condition else "general"

        condition_map = {
            "diabetes": "diabetes",
            "diabetic": "diabetes",
            "sugar": "diabetes",
            "type 2": "diabetes",
            "hypertension": "hypertension",
            "high blood pressure": "hypertension",
            "bp": "hypertension",
            "heart": "heart_disease",
            "cardiac": "heart_disease",
            "cardiovascular": "heart_disease",
        }

        advice_key = condition_map.get(condition_lower, None)
        if advice_key and advice_key in self.CONDITION_ADVICE:
            result["condition_advice"] = self.CONDITION_ADVICE[advice_key]
            result["condition"] = advice_key
        else:
            result["general_advice"] = {
                "tips": [
                    "Eat more vegetables with every meal",
                    "Choose fish over fatty meat",
                    "Reduce palm oil - use less than usual",
                    "Limit salt and Maggi cubes",
                    "Drink water instead of sweet drinks",
                    "Eat fruits as snacks instead of biscuits",
                ]
            }

        result["local_foods"] = list(self.GAMBIAN_FOODS.keys())

        return result
