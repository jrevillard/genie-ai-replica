"""Intent normalizer — Mandinka-to-English bridge for pipeline routing.

Takes NLP stage outputs (spellcheck, code-switch, NER, sentiment) and
produces an English-normalized query + structured intent hint that the
existing IntentClassifier, TOOL_ROUTES, and RAG pipeline consume directly.

No ML models. Deterministic mapping only. Target latency: < 2ms.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

__all__ = ["IntentNormalizer"]

logger = logging.getLogger(__name__)


# ── Vital-unit defaults ────────────────────────────────────────────────────

_VITAL_UNITS: Dict[str, str] = {
    "blood_sugar": "mg/dL",
    "blood_pressure_systolic": "mmHg",
    "blood_pressure_diastolic": "mmHg",
    "blood_pressure": "mmHg",
    "temperature": "°C",
    "heart_rate": "bpm",
    "weight": "kg",
    "bmi": "kg/m²",
    "hba1c": "%",
    "oxygen_saturation": "%",
}

# ── Emergency keywords that FORCE check_emergency ──────────────────────────

_EMERGENCY_SYMPTOMS: Set[str] = {
    "chest pain", "chest pressure", "heart attack",
    "breathing difficulty", "difficulty breathing",
    "can't breathe", "cannot breathe", "shortness of breath",
    "severe shortness of breath",
    "unconscious", "collapsed", "seizure",
    "stroke", "face drooping", "arm weakness",
    "vision loss", "sudden blindness",
    "severe bleeding", "bleeding out",
    "overdose", "poisoning", "choking",
    "blood sugar under 50", "blood sugar over 400",
}

# ── Symptom-to-tool and vital-to-tool mapping ──────────────────────────────

_VITAL_TOOL_MAP: Dict[str, str] = {
    "blood_sugar": "manage_diabetes",
    "hba1c": "manage_diabetes",
    "blood_pressure": "manage_hypertension",
    "blood_pressure_systolic": "manage_hypertension",
    "blood_pressure_diastolic": "manage_hypertension",
}

_CONDITION_KEYWORDS_TO_TOOL: Dict[str, str] = {
    "diabetes": "manage_diabetes",
    "diabetic": "manage_diabetes",
    "glucose": "manage_diabetes",
    "insulin": "manage_diabetes",
    "metformin": "manage_diabetes",
    "hypertension": "manage_hypertension",
    "high blood pressure": "manage_hypertension",
    "amlodipine": "manage_hypertension",
    "asthma": "assess_respiratory",
    "copd": "assess_respiratory",
    "wheezing": "assess_respiratory",
    "inhaler": "assess_respiratory",
}

# ── Emotional state mapping ────────────────────────────────────────────────

_SENTIMENT_TO_EMOTION: Dict[str, str] = {
    "pain": "pain",
    "fear": "fearful",
    "anxiety": "anxious",
    "anger": "frustrated",
    "sadness": "sad",
    "distress": "distressed",
    "worry": "worried",
    "neutral": "neutral",
    "positive": "positive",
    "gratitude": "grateful",
}

# ── Pain severity keywords ─────────────────────────────────────────────────

_SEVERE_PAIN_MARKERS: Set[str] = {
    "severe", "extreme", "terrible", "unbearable", "worst",
    "baa", "baa le", "juubee", "jang jang",
}

_MODERATE_PAIN_MARKERS: Set[str] = {
    "moderate", "some", "dull", "aching",
    "doomu", "doo le",
}


class IntentNormalizer:
    """Normalizes Mandinka NLP pipeline output into English for downstream routing."""

    def normalize_for_pipeline(
        self,
        text: str,
        spellcheck_output: Optional[Dict[str, Any]] = None,
        codeswitch_output: Optional[Dict[str, Any]] = None,
        ner_output: Optional[Dict[str, Any]] = None,
        sentiment_output: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build an English-normalized intent hint from NLP stage outputs.

        Parameters
        ----------
        text:
            Original user input (Mandinka / mixed).
        spellcheck_output:
            Output from ``MandinkaNormalizer.normalize()``.
        codeswitch_output:
            Output from code-switch detector (``{"language": ..., "segments": ...}``).
        ner_output:
            Output from NER extractor with ``entities`` list, each having
            ``type`` (symptom | vital | condition | medication | food | body_part)
            and ``value`` / ``numeric_value`` fields.
        sentiment_output:
            Output from sentiment analyzer (``{"sentiment": ..., "urgency": ..., ...}``).

        Returns
        -------
        dict  — structured intent hint consumable by TOOL_ROUTES / LLM router.
        """
        spellcheck_output = spellcheck_output or {}
        codeswitch_output = codeswitch_output or {}
        ner_output = ner_output or {}
        sentiment_output = sentiment_output or {}

        symptoms = self._extract_symptom_english(ner_output)
        vitals = self._extract_vitals_from_ner(ner_output)
        conditions = self._extract_medication_names(ner_output)
        medications = conditions
        foods = self._extract_food_names(ner_output)
        body_parts = self._extract_body_part_names(ner_output)

        emergency_flags = ner_output.get("emergency_flags", [])

        input_language = self._resolve_language(codeswitch_output)
        emotional_state = self._resolve_emotion(sentiment_output)
        urgency = self._resolve_urgency(sentiment_output, symptoms, vitals)
        pain_level = self._resolve_pain_level(symptoms, ner_output.get("symptoms", []), text)
        emergency = self._check_emergency(symptoms, vitals) or len(emergency_flags) > 0
        isolation = self._check_isolation(sentiment_output, text)
        medication_mentioned = len(medications) > 0
        food_mentioned = len(foods) > 0

        normalized_query = self._build_normalized_query(
            symptoms, vitals, conditions, medications, foods, body_parts,
        )

        suggested_tools = self._suggest_tools(
            symptoms=symptoms,
            vitals=vitals,
            conditions=conditions,
            emergency=emergency,
            isolation=isolation,
            medication_mentioned=medication_mentioned,
            food_mentioned=food_mentioned,
        )

        return {
            "normalized_query": normalized_query,
            "original_text": text,
            "input_language": input_language,
            "suggested_tools": suggested_tools,
            "urgency": urgency,
            "emotional_state": emotional_state,
            "pain_level": pain_level,
            "vitals_detected": vitals,
            "symptoms_english": symptoms,
            "emergency": emergency,
            "isolation": isolation,
            "medication_mentioned": medication_mentioned,
            "food_mentioned": food_mentioned,
        }

    # ── Public helper: build LLM context block ─────────────────────────────

    def build_llm_context(
        self,
        intent_hint: Dict[str, Any],
        greeting_context: Optional[str] = None,
    ) -> str:
        """Generate a context block for injection into the LLM prompt.

        Parameters
        ----------
        intent_hint:
            Output of ``normalize_for_pipeline()``.
        greeting_context:
            Optional greeting / cultural preamble from the greeting service.

        Returns
        -------
        str — multi-line context block.
        """
        lines: List[str] = []

        if greeting_context:
            lines.append(f"GREETING CONTEXT: {greeting_context}")

        lines.append(
            f"PATIENT INPUT ({intent_hint.get('input_language', 'unknown').capitalize()}): "
            f"{intent_hint.get('original_text', '')}"
        )
        lines.append(f"UNDERSTOOD AS: {intent_hint.get('normalized_query', '')}")
        lines.append(f"DETECTED LANGUAGE: {intent_hint.get('input_language', 'unknown')}")

        emotional_state = intent_hint.get("emotional_state", "neutral")
        urgency = intent_hint.get("urgency", 0.0)
        lines.append(f"EMOTIONAL STATE: {emotional_state} (urgency: {urgency})")

        pain_level = intent_hint.get("pain_level", "none")
        lines.append(f"PAIN LEVEL: {pain_level}")

        vitals = intent_hint.get("vitals_detected", {})
        if vitals:
            vitals_str = ", ".join(
                f"{k}={v}" for k, v in vitals.items()
            )
            lines.append(f"VITALS THIS TURN: {vitals_str}")
        else:
            lines.append("VITALS THIS TURN: none")

        if intent_hint.get("emergency"):
            lines.append("*** EMERGENCY DETECTED — prioritize check_emergency tool ***")

        lines.append(
            "RESPOND IN: English with Mandinka key phrases from phrase bank"
        )

        return "\n".join(lines)

    # ── Internal: entity extraction (reads MedicalNERExtractor output) ───

    @staticmethod
    def _extract_symptom_english(ner_output: Dict[str, Any]) -> List[str]:
        seen: Set[str] = set()
        results: List[str] = []
        for s in ner_output.get("symptoms", []):
            eng = s.get("english", s.get("text", "")).strip()
            if eng and eng not in seen:
                seen.add(eng)
                results.append(eng)
        return results

    @staticmethod
    def _extract_vitals_from_ner(ner_output: Dict[str, Any]) -> Dict[str, Any]:
        vitals: Dict[str, Any] = {}
        for v in ner_output.get("vitals", []):
            vtype = v.get("type", "")
            if vtype == "blood_pressure":
                vitals["blood_pressure_systolic"] = v.get("systolic")
                vitals["blood_pressure_diastolic"] = v.get("diastolic")
            elif vtype == "blood_sugar":
                vitals["blood_sugar"] = v.get("value")
            elif vtype == "temperature":
                vitals["temperature"] = v.get("value")
            elif vtype == "heart_rate":
                vitals["heart_rate"] = v.get("value")
            elif vtype == "weight":
                vitals["weight"] = v.get("value")
            elif vtype == "oxygen_saturation":
                vitals["oxygen_saturation"] = v.get("value")
        return {k: v for k, v in vitals.items() if v is not None}

    @staticmethod
    def _extract_medication_names(ner_output: Dict[str, Any]) -> List[str]:
        seen: Set[str] = set()
        results: List[str] = []
        for m in ner_output.get("medications", []):
            name = m.get("name", "").strip()
            if name and name not in seen:
                seen.add(name)
                results.append(name)
        return results

    @staticmethod
    def _extract_food_names(ner_output: Dict[str, Any]) -> List[str]:
        seen: Set[str] = set()
        results: List[str] = []
        for f in ner_output.get("foods", []):
            name = f.get("name", f.get("mandinka", "")).strip()
            if name and name not in seen:
                seen.add(name)
                results.append(name)
        return results

    @staticmethod
    def _extract_body_part_names(ner_output: Dict[str, Any]) -> List[str]:
        seen: Set[str] = set()
        results: List[str] = []
        for bp in ner_output.get("body_parts", []):
            eng = bp.get("english", bp.get("mandinka", "")).strip()
            if eng and eng not in seen:
                seen.add(eng)
                results.append(eng)
        return results

    # ── Internal: language resolution ──────────────────────────────────────

    @staticmethod
    def _resolve_language(codeswitch_output: Dict[str, Any]) -> str:
        lang = codeswitch_output.get("dominant_language", "").lower()
        if lang:
            return lang
        lang = codeswitch_output.get("language", "").lower()
        if lang:
            return lang
        segments = codeswitch_output.get("segments", [])
        if segments:
            langs = [s.get("language", "") for s in segments if s.get("language")]
            if langs:
                return langs[0].lower()
        return "unknown"

    # ── Internal: emotion / urgency / pain ─────────────────────────────────

    @staticmethod
    def _resolve_emotion(sentiment_output: Dict[str, Any]) -> str:
        state = sentiment_output.get("emotional_state", "neutral").lower()
        return _SENTIMENT_TO_EMOTION.get(state, state)

    @staticmethod
    def _resolve_urgency(
        sentiment_output: Dict[str, Any],
        symptoms: List[str],
        vitals: Dict[str, Any],
    ) -> float:
        base = float(sentiment_output.get("urgency", 0.3))

        if symptoms:
            base = max(base, 0.5)

        # Critical vital thresholds
        bs = vitals.get("blood_sugar")
        if bs is not None:
            if bs < 70 or bs > 300:
                base = max(base, 0.9)
            elif bs > 200:
                base = max(base, 0.7)

        sbp = vitals.get("blood_pressure_systolic")
        if sbp is not None:
            if sbp > 180 or sbp < 90:
                base = max(base, 0.9)
            elif sbp > 160:
                base = max(base, 0.7)

        return round(min(base, 1.0), 2)

    @staticmethod
    def _resolve_pain_level(
        symptom_english: List[str],
        raw_symptoms: List[Dict[str, Any]],
        original_text: str,
    ) -> str:
        text_lower = original_text.lower()
        all_symptom_text = " ".join(symptom_english).lower()
        combined = f"{text_lower} {all_symptom_text}"

        for sym in raw_symptoms:
            sev = sym.get("severity", "").lower()
            if sev in ("severe", "high", "critical", "emergency"):
                return "severe"
            if sev in ("moderate", "medium"):
                return "moderate"

        if any(marker in combined for marker in _SEVERE_PAIN_MARKERS):
            return "severe"
        if any(marker in combined for marker in _MODERATE_PAIN_MARKERS):
            return "moderate"
        if symptom_english:
            return "mild"
        return "none"

    # ── Internal: emergency / isolation detection ──────────────────────────

    @staticmethod
    def _check_emergency(symptoms: List[str], vitals: Dict[str, Any]) -> bool:
        symptom_text = " ".join(symptoms).lower()
        for flag in _EMERGENCY_SYMPTOMS:
            if flag in symptom_text:
                return True

        bs = vitals.get("blood_sugar")
        if bs is not None and (bs < 50 or bs > 400):
            return True

        sbp = vitals.get("blood_pressure_systolic")
        if sbp is not None and sbp > 180:
            return True

        return False

    @staticmethod
    def _check_isolation(sentiment_output: Dict[str, Any], text: str) -> bool:
        if sentiment_output.get("isolation_flag") or sentiment_output.get("isolation"):
            return True
        isolation_signals = [
            "afraid to go", "scared to go", "can't go", "won't let me",
            "no permission", "ashamed", "embarrassed", "too expensive",
            "husband says", "husband won't", "family won't",
            "not allowed", "cannot afford",
        ]
        text_lower = text.lower()
        return any(signal in text_lower for signal in isolation_signals)

    # ── Internal: normalized query construction ────────────────────────────

    @staticmethod
    def _build_normalized_query(
        symptoms: List[str],
        vitals: Dict[str, Any],
        conditions: List[str],
        medications: List[str],
        foods: List[str],
        body_parts: List[str],
    ) -> str:
        """Assemble a concise English query from extracted entities."""
        parts: List[str] = []

        if symptoms:
            joined = " with ".join(symptoms) if len(symptoms) <= 3 else ", ".join(symptoms)
            parts.append(f"Patient reports {joined}.")

        if vitals:
            vital_strs: List[str] = []
            for name, value in vitals.items():
                unit = _VITAL_UNITS.get(name, "")
                unit_suffix = f" {unit}" if unit else ""
                display_name = name.replace("_", " ")
                vital_strs.append(f"{display_name} reading is {value}{unit_suffix}")
            parts.append(". ".join(s[0].upper() + s[1:] for s in vital_strs) + ".")

        if conditions:
            parts.append(f"Known conditions: {', '.join(conditions)}.")

        if medications:
            parts.append(f"Taking: {', '.join(medications)}.")

        if foods:
            parts.append(f"Dietary mention: {', '.join(foods)}.")

        if body_parts and not symptoms:
            parts.append(f"Body area: {', '.join(body_parts)}.")

        if not parts:
            return ""

        return " ".join(parts)

    # ── Internal: tool suggestion logic ────────────────────────────────────

    @staticmethod
    def _suggest_tools(
        symptoms: List[str],
        vitals: Dict[str, Any],
        conditions: List[str],
        emergency: bool,
        isolation: bool,
        medication_mentioned: bool,
        food_mentioned: bool,
    ) -> List[str]:
        """Suggest up to 3 tools, priority-ordered.

        Priority order:
          1. check_emergency  (forced for emergency flags)
          2. assess_triage    (symptoms present)
          3. record_vitals    (vitals detected)
          4. condition-specific (manage_diabetes, manage_hypertension, etc.)
          5. get_diet_advice  (food mentioned)
          6. get_medication_info (medication mentioned)
          7. suggest_community_support (isolation detected)
        """
        selected: List[str] = []
        seen: Set[str] = set()
        max_tools = 3

        def _add(tool: str) -> None:
            if tool not in seen and len(selected) < max_tools:
                seen.add(tool)
                selected.append(tool)

        # Emergency: chest pain or breathing difficulty force check_emergency
        symptom_text = " ".join(symptoms).lower()
        force_emergency = emergency or any(
            kw in symptom_text
            for kw in ("chest pain", "chest pressure", "breathing difficulty",
                        "difficulty breathing", "can't breathe", "cannot breathe")
        )
        if force_emergency:
            _add("check_emergency")

        # Symptoms present -> triage
        if symptoms:
            _add("assess_triage")

        # Vitals detected -> record them
        if vitals:
            _add("record_vitals")

        # Condition-specific tools from vitals
        for vital_name in vitals:
            tool = _VITAL_TOOL_MAP.get(vital_name)
            if tool:
                _add(tool)

        # Condition-specific tools from named conditions
        for cond in conditions:
            cond_lower = cond.lower()
            for keyword, tool in _CONDITION_KEYWORDS_TO_TOOL.items():
                if keyword in cond_lower:
                    _add(tool)

        # Supplementary tools
        if food_mentioned:
            _add("get_diet_advice")

        if medication_mentioned:
            _add("get_medication_info")

        if isolation:
            _add("suggest_community_support")

        return selected[:max_tools]
