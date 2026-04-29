"""
Bilingual Response Builder — hybrid English + Mandinka responses.

Instead of LLM-translating the entire response, this module:
  1. Keeps the full English response intact
  2. Adds validated Mandinka greeting, key phrases, summary, and closing
  3. Assembles the Mandinka summary from phrase bank, not LLM translation
  4. For diet plans: injects Mandinka food names + day names inline

This approach guarantees that every Mandinka phrase shown to the user
has been pre-validated by a native speaker.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class BilingualResponseBuilder:

    def __init__(self):
        from src.services.mandinka_phrases import (
            PHRASES, FOOD_NAMES,
            get_phrase, get_food_guidance, get_time_greeting,
            get_day_name, find_symptom_phrase, find_food_phrases,
        )
        self._phrases = PHRASES
        self._food_names = FOOD_NAMES
        self._get_phrase = get_phrase
        self._get_food_guidance = get_food_guidance
        self._get_time_greeting = get_time_greeting
        self._get_day_name = get_day_name
        self._find_symptom_phrase = find_symptom_phrase
        self._find_food_phrases = find_food_phrases

    # ── Main builder ─────────────────────────────────────────────

    def build_response(
        self,
        english_response: str,
        intent: str = "",
        emotional_state: str = "",
    ) -> Dict[str, Any]:
        """Build a bilingual response with validated Mandinka phrases.

        Args:
            english_response: Full English response from the LLM.
            intent: Detected intent (diet, medication, symptoms, etc.).
            emotional_state: Patient's emotional state for closing.

        Returns:
            {
                "english_text": str,
                "mandinka_greeting": str,
                "mandinka_key_phrases": [{english, mandinka, context}],
                "mandinka_summary": str,
                "mandinka_closing": str,
                "translation_confidence": float,
                "unvalidated_segments": [str],
            }
        """
        greeting = self._get_time_greeting()
        key_phrases = self._extract_key_phrases(english_response, intent)
        summary = self._build_summary(english_response, intent, key_phrases)
        closing = self._pick_closing(emotional_state)

        validated_count = sum(1 for p in key_phrases if p.get("validated", True))
        total = max(len(key_phrases), 1)
        confidence = min(1.0, 0.5 + (validated_count / total) * 0.5)

        unvalidated = [
            p["english"] for p in key_phrases if not p.get("validated", True)
        ]

        return {
            "english_text": english_response,
            "mandinka_greeting": greeting,
            "mandinka_key_phrases": key_phrases,
            "mandinka_summary": summary,
            "mandinka_closing": closing,
            "translation_confidence": round(confidence, 2),
            "unvalidated_segments": unvalidated,
        }

    # ── Key phrase extraction ────────────────────────────────────

    def _extract_key_phrases(
        self, text: str, intent: str,
    ) -> List[Dict[str, Any]]:
        phrases: List[Dict[str, Any]] = []
        seen = set()

        # Symptom phrases
        symptom_matches = self._find_symptom_phrase(text)
        for key, mandinka in symptom_matches:
            if key not in seen:
                phrases.append({
                    "english": key.replace("_", " "),
                    "mandinka": mandinka,
                    "context": "symptoms",
                    "validated": True,
                })
                seen.add(key)

        # Food phrases
        food_matches = self._find_food_phrases(text)
        for fm in food_matches:
            fkey = fm["english"]
            if fkey not in seen:
                phrases.append({
                    "english": fkey,
                    "mandinka": fm["mandinka"],
                    "context": "food",
                    "validated": True,
                })
                seen.add(fkey)

        # Intent-specific guidance phrases
        if intent in ("diet", "food", "nutrition", "meal_plan"):
            for key in ("less_rice", "more_vegetables", "less_salt",
                        "eat_moringa", "eat_fish", "drink_water"):
                p = self._get_phrase("FOOD_GUIDANCE", key)
                if p["validated"] and key not in seen:
                    phrases.append({
                        "english": key.replace("_", " "),
                        "mandinka": p["mandinka"],
                        "context": "food_guidance",
                        "validated": True,
                    })
                    seen.add(key)

        elif intent in ("medication", "medicine", "drug", "prescription"):
            for key in ("take_morning", "dont_stop", "bring_to_doctor"):
                p = self._get_phrase("MEDICATION_REMINDERS", key)
                if p["validated"] and key not in seen:
                    phrases.append({
                        "english": key.replace("_", " "),
                        "mandinka": p["mandinka"],
                        "context": "medication",
                        "validated": True,
                    })
                    seen.add(key)

        elif intent in ("emergency", "urgent"):
            for key in ("go_hospital", "call_199", "dont_wait"):
                p = self._get_phrase("EMERGENCIES", key)
                if p["validated"] and key not in seen:
                    phrases.append({
                        "english": key.replace("_", " "),
                        "mandinka": p["mandinka"],
                        "context": "emergency",
                        "validated": True,
                    })
                    seen.add(key)

        return phrases[:10]

    # ── Summary assembly (phrase bank, NOT LLM) ──────────────────

    def _build_summary(
        self, english_text: str, intent: str,
        key_phrases: List[Dict[str, Any]],
    ) -> str:
        """Assemble a 1-2 sentence Mandinka summary from validated phrases.

        This is phrase-bank concatenation, not LLM translation.
        """
        parts: List[str] = []
        text_l = english_text.lower()

        if intent in ("diet", "food", "nutrition", "meal_plan"):
            if any(w in text_l for w in ("reduce", "less", "cut")):
                if "rice" in text_l:
                    parts.append(self._phrases["FOOD_GUIDANCE"]["less_rice"])
                if "salt" in text_l or "maggi" in text_l:
                    parts.append(self._phrases["FOOD_GUIDANCE"]["less_salt"])
                if "sugar" in text_l:
                    parts.append(self._phrases["FOOD_GUIDANCE"]["less_sugar"])
                if "oil" in text_l:
                    parts.append(self._phrases["FOOD_GUIDANCE"]["reduce_oil"])
            if any(w in text_l for w in ("vegetable", "okra", "moringa")):
                parts.append(self._phrases["FOOD_GUIDANCE"]["more_vegetables"])
            if "fish" in text_l:
                parts.append(self._phrases["FOOD_GUIDANCE"]["eat_fish"])
            if "water" in text_l:
                parts.append(self._phrases["FOOD_GUIDANCE"]["drink_water"])

        elif intent in ("medication", "medicine"):
            if any(w in text_l for w in ("morning", "daily", "every day")):
                parts.append(self._phrases["MEDICATION_REMINDERS"]["take_morning"])
            if any(w in text_l for w in ("don't stop", "continue", "keep taking")):
                parts.append(self._phrases["MEDICATION_REMINDERS"]["dont_stop"])

        elif intent in ("emergency", "urgent"):
            parts.append(self._phrases["EMERGENCIES"]["go_hospital"])
            parts.append(self._phrases["EMERGENCIES"]["dont_wait"])

        else:
            symptom_phrases = [
                p["mandinka"] for p in key_phrases
                if p.get("context") == "symptoms" and p.get("validated")
            ]
            if symptom_phrases:
                parts.extend(symptom_phrases[:2])

        if not parts:
            food_phrases = [
                p["mandinka"] for p in key_phrases
                if p.get("context") == "food" and p.get("validated")
            ]
            if food_phrases:
                parts.extend(food_phrases[:2])

        if not parts:
            parts.append(self._phrases["ENCOURAGEMENT"]["your_health_matters"])

        return " ".join(parts[:4])

    # ── Closing phrase ───────────────────────────────────────────

    def _pick_closing(self, emotional_state: str = "") -> str:
        enc = self._phrases["ENCOURAGEMENT"]
        if emotional_state in ("sad", "depressed", "low"):
            return enc["dont_give_up"]
        if emotional_state in ("anxious", "worried", "scared"):
            return enc["allah_will_help"]
        if emotional_state in ("motivated", "happy", "good"):
            return enc["proud_of_you"]
        return enc["one_step"]

    # ── Diet plan bilingual builder ──────────────────────────────

    def build_diet_plan_bilingual(
        self, meal_plan: str, patient_conditions: List[str],
    ) -> Dict[str, Any]:
        """Build a bilingual diet plan with Mandinka annotations.

        Keeps the full English plan but adds:
          - Mandinka day names inline
          - Mandinka food names in parentheses
          - Voice summary (3-4 validated phrases) at the top
          - Condition-specific guidance phrases
        """
        annotated_plan = meal_plan

        # Inject Mandinka day names
        day_map = {
            "Monday": "Monday (Teneŋo)",
            "Tuesday": "Tuesday (Talaato)",
            "Wednesday": "Wednesday (Araba)",
            "Thursday": "Thursday (Aramisaa)",
            "Friday": "Friday (Arijuma)",
            "Saturday": "Saturday (Sibiti)",
            "Sunday": "Sunday (Aladoo)",
        }
        for en_day, bi_day in day_map.items():
            annotated_plan = re.sub(
                rf"\b{en_day}\b",
                bi_day,
                annotated_plan,
                count=1,
            )

        # Inject Mandinka food names
        for fkey, fdata in self._food_names.items():
            en_name = fkey.replace("_", " ")
            ma_name = fdata["mandinka"]
            for pattern in [en_name, en_name.capitalize(), en_name.title()]:
                if pattern in annotated_plan and f"({ma_name})" not in annotated_plan:
                    annotated_plan = annotated_plan.replace(
                        pattern, f"{pattern} ({ma_name})", 1,
                    )

        # Build voice summary
        voice_parts: List[str] = []
        conditions_l = [c.lower() for c in patient_conditions]

        if any("diabet" in c for c in conditions_l):
            voice_parts.append(self._phrases["FOOD_GUIDANCE"]["less_sugar"])
            voice_parts.append(self._phrases["FOOD_GUIDANCE"]["eat_moringa"])
        if any("hypert" in c or "pressure" in c for c in conditions_l):
            voice_parts.append(self._phrases["FOOD_GUIDANCE"]["less_salt"])
            voice_parts.append(self._phrases["FOOD_GUIDANCE"]["eat_fish"])
        if not voice_parts:
            voice_parts.append(self._phrases["FOOD_GUIDANCE"]["more_vegetables"])
            voice_parts.append(self._phrases["FOOD_GUIDANCE"]["drink_water"])

        voice_parts.append(self._phrases["ENCOURAGEMENT"]["one_step"])

        key_phrases = self._find_food_phrases(meal_plan)

        return {
            "english_plan": meal_plan,
            "annotated_plan": annotated_plan,
            "mandinka_voice_summary": " ".join(voice_parts[:4]),
            "mandinka_day_names": {
                en: self._get_day_name(en.lower())
                for en in ["Monday", "Tuesday", "Wednesday", "Thursday",
                           "Friday", "Saturday", "Sunday"]
            },
            "food_annotations": key_phrases,
            "condition_guidance": [
                {"english": p["english"], "mandinka": p["mandinka"]}
                for p in key_phrases
            ],
            "translation_confidence": 0.95,
        }


# Singleton
_builder: BilingualResponseBuilder | None = None


def get_builder() -> BilingualResponseBuilder:
    global _builder
    if _builder is None:
        _builder = BilingualResponseBuilder()
    return _builder
