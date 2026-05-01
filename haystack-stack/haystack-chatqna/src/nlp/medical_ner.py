"""
Rule-based Medical NER for Mandinka/English/mixed input.

Extracts symptoms, vitals, medications, foods, body parts, and emergency
flags using bilingual dictionaries and regex. No ML model -- pure pattern
matching. Target latency: < 10 ms per message.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Bilingual dictionaries
# ---------------------------------------------------------------------------

# Multi-word entries are checked BEFORE single-word.  Within each group
# entries are sorted longest-first at class-init time so the most specific
# pattern wins.

_MANDINKA_SYMPTOMS_MULTI: Dict[str, Dict[str, str]] = {
    "dimi ka n faa":    {"english": "unbearable pain",       "severity": "emergency"},
    "kuŋ dimi baa":     {"english": "severe headache",       "severity": "severe"},
    "ñiinoo ka jukuu":  {"english": "difficulty breathing",  "severity": "high"},
    "kankuluŋ dimi":    {"english": "chest pain",            "severity": "high"},
    "seŋolu futuyaata": {"english": "swollen feet",          "severity": "moderate"},
    "ñaa te kuurango":  {"english": "blurry vision",         "severity": "moderate"},
    "suutoo jaŋjaŋ":    {"english": "frequent urination",    "severity": "moderate"},
    "faŋ jiijaata":     {"english": "numbness",              "severity": "moderate"},
    "minoo kaŋ":        {"english": "excessive thirst",      "severity": "moderate"},
    "kono dimi":        {"english": "stomach pain",          "severity": "moderate"},
    "kuŋ dimi":         {"english": "headache",              "severity": "moderate"},
}

_MANDINKA_SYMPTOMS_SINGLE: Dict[str, Dict[str, str]] = {
    "saasaariŋo": {"english": "dizziness",  "severity": "moderate"},
    "kurango":    {"english": "fever",       "severity": "moderate"},
    "seeyaa":     {"english": "fatigue",     "severity": "moderate"},
    "buuñaa":     {"english": "vomiting",    "severity": "moderate"},
}

_ENGLISH_SYMPTOMS: Dict[str, Dict[str, str]] = {
    "short of breath": {"english": "shortness of breath", "severity": "high"},
    "chest pain":      {"english": "chest pain",          "severity": "high"},
    "can't see":       {"english": "vision loss",         "severity": "high"},
    "headache":        {"english": "headache",            "severity": "moderate"},
    "swollen":         {"english": "swelling",            "severity": "moderate"},
    "bleeding":        {"english": "bleeding",            "severity": "high"},
    "nausea":          {"english": "nausea",              "severity": "moderate"},
    "fever":           {"english": "fever",               "severity": "moderate"},
    "dizzy":           {"english": "dizziness",           "severity": "moderate"},
}

_SEVERITY_MODIFIERS: Dict[str, str] = {
    "ka n faa": "emergency",
    "dɔɔniŋ":  "mild",
    "jukuu":   "heavy/serious",
    "baa":     "severe",
}

# Body-part dictionary (Mandinka -> English)
_BODY_PARTS: Dict[str, str] = {
    "kankuluŋ": "chest",
    "kuluŋo":   "back",
    "seŋo":     "foot/leg",
    "boloo":    "hand/arm",
    "tuloo":    "ear",
    "joloo":    "blood",
    "kono":     "stomach",
    "ñiŋo":     "nose",
    "kuŋ":      "head",
    "ñaa":      "eye",
    "faŋ":      "body",
    "daa":      "mouth",
}

# BUG-020 fix: ambiguous medical terms.
# Some English organ-names double as common food words ("I ate liver
# for dinner", "kidney beans for lunch"). Any caller that extracts
# these words as symptoms / body-parts MUST gate the match through
# is_medical_context() so a culinary mention does not trip clinical
# escalation. The current _BODY_PARTS dict is Mandinka-only and is
# not affected today; this helper is exported for sibling modules
# (notification_intent.py, code_switch_detector.py) and as a safety
# net for any future English organ-name additions.
_GENERAL_SYMPTOM_WORDS = ["hurt", "hurts", "hurting", "ache", "aches", "aching",
                          "sore", "tender", "throb", "throbbing"]
AMBIGUOUS_MEDICAL_TERMS: Dict[str, Dict[str, List[str]]] = {
    "liver":  {
        "medical_contexts": ["pain", "disease", "failure", "damage", "function",
                              "problem", "test", "enzyme", "cirrhosis", "hepatitis",
                              "swollen", "enlarged"] + _GENERAL_SYMPTOM_WORDS,
        "food_contexts":    ["eat", "ate", "cook", "cooked", "dinner", "lunch",
                              "breakfast", "fry", "fried", "grill", "grilled",
                              "recipe", "benachin", "domoda", "stew", "soup",
                              "delicious", "tasty", "buy", "market", "lumo"],
    },
    "kidney": {
        "medical_contexts": ["pain", "disease", "failure", "stone", "function",
                              "infection", "dialysis", "transplant"] + _GENERAL_SYMPTOM_WORDS,
        "food_contexts":    ["eat", "ate", "cook", "cooked", "stew", "beans",
                              "dinner", "lunch", "breakfast"],
    },
    "heart":  {
        "medical_contexts": ["attack", "failure", "disease", "rate", "beat",
                              "palpitation", "pain", "murmur", "valve"] + _GENERAL_SYMPTOM_WORDS,
        "food_contexts":    ["eat", "ate", "cook", "chicken", "stew"],
    },
    "blood":  {
        "medical_contexts": ["pressure", "sugar", "test", "loss", "clot",
                              "transfusion", "count", "cell", "vessel"],
        "food_contexts":    ["sausage", "pudding"],
    },
}


def is_medical_context(word: str, surrounding_text: str) -> bool:
    """BUG-020 helper. True if `word` looks medical given the text it
    appears in. For non-ambiguous terms this is always True (the term
    has no food sense). For terms in AMBIGUOUS_MEDICAL_TERMS we count
    nearby medical-context words vs food-context words: when food wins
    we return False so the caller skips the match. When neither side
    wins we default to NOT medical -- the cost of a missed clinical
    detection is recoverable (re-prompt, follow-up question), but the
    cost of escalating "liver for dinner" damages user trust.
    """
    word_lower = (word or "").lower()
    if word_lower not in AMBIGUOUS_MEDICAL_TERMS:
        return True
    entry = AMBIGUOUS_MEDICAL_TERMS[word_lower]
    text_lower = (surrounding_text or "").lower()
    med_hits  = sum(1 for ctx in entry["medical_contexts"] if ctx in text_lower)
    food_hits = sum(1 for ctx in entry["food_contexts"]    if ctx in text_lower)
    if food_hits > med_hits:
        return False
    if med_hits > 0:
        return True
    return False


# Medications -- canonical lowercase names
_MEDICATIONS: List[str] = [
    "hydrochlorothiazide",
    "glibenclamide",
    "paracetamol",
    "amlodipine",
    "salbutamol",
    "omeprazole",
    "amoxicillin",
    "ibuprofen",
    "metformin",
    "atenolol",
    "enalapril",
    "insulin",
    "aspirin",
]

_MANDINKA_MED_TERMS: Dict[str, str] = {
    "furaŋo":  "medicine",
    "tableti": "tablet",
}

# Medication context patterns (Mandinka):
#   taking:   "n be <drug> doŋ"
#   asking:   "munne mu <drug> ti"
#   refusing: "n te <drug> doŋ"
#   out:      "<drug> banta"
_MED_CONTEXT_PATTERNS: List[Tuple[re.Pattern, str, int]] = [
    (re.compile(r"n\s+be\s+(\S+)\s+doŋ",   re.IGNORECASE), "taking",   1),
    (re.compile(r"munne\s+mu\s+(\S+)\s+ti",  re.IGNORECASE), "asking",   1),
    (re.compile(r"n\s+te\s+(\S+)\s+doŋ",    re.IGNORECASE), "refusing", 1),
    (re.compile(r"(\S+)\s+banta",            re.IGNORECASE), "out",      1),
]

# Food entities: name -> {mandinka, health_impact}
_FOODS: Dict[str, Dict[str, str]] = {
    "benachin":   {"mandinka": "benachin",   "health_impact": "high_carb_high_oil"},
    "domoda":     {"mandinka": "domoda",     "health_impact": "high_carb_groundnut"},
    "supakanja":  {"mandinka": "supakanja",  "health_impact": "low_carb_leafy"},
    "attaayaa":   {"mandinka": "attaayaa",   "health_impact": "high_sugar_caffeine"},
    "tapalapa":   {"mandinka": "tapalapa",   "health_impact": "refined_carb"},
    "moringa":    {"mandinka": "moringa",    "health_impact": "nutrient_dense"},
    "okra":       {"mandinka": "kanjaa",     "health_impact": "low_carb_fiber"},
    "kanjaa":     {"mandinka": "kanjaa",     "health_impact": "low_carb_fiber"},
    "jaxatu":     {"mandinka": "jaxatu",     "health_impact": "low_carb_vegetable"},
    "mono":       {"mandinka": "mono",       "health_impact": "fermented_grain"},
    "fura":       {"mandinka": "fura",       "health_impact": "fermented_grain"},
    "buyii":      {"mandinka": "buyii",      "health_impact": "high_carb_porridge"},
    "nyebbeh":    {"mandinka": "nyebbeh",    "health_impact": "protein_fiber"},
    "laaciiri":   {"mandinka": "laaciiri",   "health_impact": "refined_carb"},
    "fish":       {"mandinka": "jéwoo",      "health_impact": "lean_protein"},
    "jéwoo":      {"mandinka": "jéwoo",      "health_impact": "lean_protein"},
}

# Emergency keywords
_EMERGENCY_MANDINKA: List[str] = [
    "dimi ka n faa",
    "n te se ñiinoo la",
    "a buuta",
    "joloo be boola",
]

_EMERGENCY_ENGLISH: List[str] = [
    "can't breathe",
    "collapsed",
    "chest pain",
    "overdose",
    "seizure",
    "stroke",
]

# ---------------------------------------------------------------------------
# Vital-sign regexes
# ---------------------------------------------------------------------------

_RE_BP_SLASH = re.compile(r"\b(\d{2,3})\s*/\s*(\d{2,3})\b")
_RE_BP_OVER  = re.compile(r"\b(\d{2,3})\s+over\s+(\d{2,3})\b", re.IGNORECASE)
_RE_SUGAR    = re.compile(
    r"(?:sugar|glucose|sukkaroo?)\s*(?:is|be|ye)?\s*(\d{2,4})", re.IGNORECASE
)
_RE_WEIGHT   = re.compile(r"\b(\d{2,3})\s*(?:kg|kilo)\b", re.IGNORECASE)
_RE_TEMP     = re.compile(
    r"\b(\d{2,3}\.?\d?)\s*(?:°?\s*[CF]|degrees)\b", re.IGNORECASE
)


# ---------------------------------------------------------------------------
# Helper: build sorted pattern list (longest first)
# ---------------------------------------------------------------------------

def _sorted_patterns(mapping: Dict[str, Any]) -> List[Tuple[str, Any]]:
    """Return (pattern, value) pairs sorted by pattern length descending."""
    return sorted(mapping.items(), key=lambda kv: len(kv[0]), reverse=True)


# ---------------------------------------------------------------------------
# MedicalNERExtractor
# ---------------------------------------------------------------------------

class MedicalNERExtractor:
    """
    Rule-based bilingual (Mandinka / English) medical entity extractor.

    Usage::

        ner = MedicalNERExtractor()
        result = ner.extract("kuŋ dimi baa, n be metformin doŋ, 145/92")
    """

    def __init__(self) -> None:
        # Pre-sort all pattern lists once at init (not per call).
        self._mandinka_multi  = _sorted_patterns(_MANDINKA_SYMPTOMS_MULTI)
        self._mandinka_single = _sorted_patterns(_MANDINKA_SYMPTOMS_SINGLE)
        self._english_symp    = _sorted_patterns(_ENGLISH_SYMPTOMS)
        self._severity_mods   = _sorted_patterns(_SEVERITY_MODIFIERS)
        self._body_parts      = _sorted_patterns(_BODY_PARTS)
        self._foods           = _sorted_patterns(_FOODS)
        self._emergency_all   = (
            _sorted_patterns({k: k for k in _EMERGENCY_MANDINKA})
            + _sorted_patterns({k: k for k in _EMERGENCY_ENGLISH})
        )

        # Pre-compile medication regex (single pass, alternation).
        _med_alt = "|".join(re.escape(m) for m in _MEDICATIONS)
        self._re_meds = re.compile(rf"\b({_med_alt})\b", re.IGNORECASE)

        # Pre-compile Mandinka medication term regex.
        _mand_med_alt = "|".join(re.escape(t) for t in _MANDINKA_MED_TERMS)
        self._re_mandinka_meds = re.compile(
            rf"\b({_mand_med_alt})\b", re.IGNORECASE
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def extract(
        self,
        text: str,
        language_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Extract medical entities from *text*.

        Parameters
        ----------
        text : str
            Raw user message (Mandinka, English, or mixed).
        language_info : dict, optional
            Language detection metadata (unused today but reserved for
            future weighting / disambiguation).

        Returns
        -------
        dict  with keys: symptoms, vitals, medications, foods,
              body_parts, emergency_flags, entities_found.
        """
        text_lower = text.lower()

        symptoms        = self._extract_symptoms(text_lower)
        vitals          = self._extract_vitals(text, text_lower)
        medications     = self._extract_medications(text, text_lower)
        foods           = self._extract_foods(text_lower)
        body_parts      = self._extract_body_parts(text_lower)
        emergency_flags = self._extract_emergencies(text_lower)

        # Enrich symptoms with body-part cross-reference.
        bp_lookup = {bp["mandinka"] for bp in body_parts}
        bp_lookup.update(bp["english"] for bp in body_parts)
        for sym in symptoms:
            if not sym.get("body_part"):
                sym["body_part"] = self._infer_body_part(
                    sym["text"], bp_lookup
                )

        total = (
            len(symptoms)
            + len(vitals)
            + len(medications)
            + len(foods)
            + len(body_parts)
            + len(emergency_flags)
        )

        return {
            "symptoms":        symptoms,
            "vitals":          vitals,
            "medications":     medications,
            "foods":           foods,
            "body_parts":      body_parts,
            "emergency_flags": emergency_flags,
            "entities_found":  total,
        }

    # ------------------------------------------------------------------
    # Symptom extraction
    # ------------------------------------------------------------------

    def _extract_symptoms(self, text_lower: str) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        consumed: List[Tuple[int, int]] = []  # (start, end) spans

        def _already_covered(start: int, end: int) -> bool:
            return any(s <= start and end <= e for s, e in consumed)

        # --- Mandinka multi-word (longest first) ----------------------
        for pattern, info in self._mandinka_multi:
            idx = 0
            while True:
                pos = text_lower.find(pattern, idx)
                if pos == -1:
                    break
                end = pos + len(pattern)
                if not _already_covered(pos, end):
                    severity = info["severity"]
                    # Check for severity modifiers surrounding match.
                    severity = self._check_severity_modifier(
                        text_lower, pos, end, severity
                    )
                    body_part = self._body_part_from_symptom(pattern)
                    results.append({
                        "text":            pattern,
                        "english":         info["english"],
                        "severity":        severity,
                        "body_part":       body_part,
                        "source_language": "mandinka",
                    })
                    consumed.append((pos, end))
                idx = end

        # --- Mandinka single-word (longest first) ---------------------
        for pattern, info in self._mandinka_single:
            idx = 0
            while True:
                pos = text_lower.find(pattern, idx)
                if pos == -1:
                    break
                end = pos + len(pattern)
                if not _already_covered(pos, end):
                    severity = info["severity"]
                    severity = self._check_severity_modifier(
                        text_lower, pos, end, severity
                    )
                    results.append({
                        "text":            pattern,
                        "english":         info["english"],
                        "severity":        severity,
                        "body_part":       None,
                        "source_language": "mandinka",
                    })
                    consumed.append((pos, end))
                idx = end

        # --- English symptoms (longest first) -------------------------
        for pattern, info in self._english_symp:
            idx = 0
            while True:
                pos = text_lower.find(pattern, idx)
                if pos == -1:
                    break
                end = pos + len(pattern)
                if not _already_covered(pos, end):
                    results.append({
                        "text":            pattern,
                        "english":         info["english"],
                        "severity":        info["severity"],
                        "body_part":       None,
                        "source_language": "english",
                    })
                    consumed.append((pos, end))
                idx = end

        return results

    def _check_severity_modifier(
        self,
        text_lower: str,
        sym_start: int,
        sym_end: int,
        default: str,
    ) -> str:
        """Upgrade/downgrade severity if a modifier appears near the symptom."""
        window_start = max(0, sym_start - 20)
        window_end   = min(len(text_lower), sym_end + 20)
        window = text_lower[window_start:window_end]
        for mod_pattern, mod_level in self._severity_mods:
            if mod_pattern in window:
                return mod_level
        return default

    @staticmethod
    def _body_part_from_symptom(symptom_text: str) -> Optional[str]:
        """Heuristic: if the symptom text contains a body-part root, return it."""
        _map = {
            "kuŋ":      "head",
            "kono":     "stomach",
            "kankuluŋ": "chest",
            "seŋ":      "foot/leg",
            "ñaa":      "eye",
            "faŋ":      "body",
        }
        for root, english in sorted(
            _map.items(), key=lambda kv: len(kv[0]), reverse=True
        ):
            if root in symptom_text:
                return english
        return None

    def _infer_body_part(
        self, symptom_text: str, known_parts: set
    ) -> Optional[str]:
        """Try to infer a body part from either the symptom text or known set."""
        bp = self._body_part_from_symptom(symptom_text)
        if bp:
            return bp
        # English heuristics
        _eng_map = {
            "head":    "head",
            "chest":   "chest",
            "stomach": "stomach",
            "eye":     "eye",
            "vision":  "eye",
            "breath":  "chest",
        }
        for kw, part in _eng_map.items():
            if kw in symptom_text:
                return part
        return None

    # ------------------------------------------------------------------
    # Vitals extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_vitals(
        text_raw: str, text_lower: str
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []

        # Blood pressure
        for rx in (_RE_BP_SLASH, _RE_BP_OVER):
            for m in rx.finditer(text_raw):
                sys_val, dia_val = int(m.group(1)), int(m.group(2))
                # Basic sanity: systolic > diastolic, plausible range
                if 50 <= sys_val <= 300 and 30 <= dia_val <= 200 and sys_val > dia_val:
                    results.append({
                        "type":        "blood_pressure",
                        "systolic":    sys_val,
                        "diastolic":   dia_val,
                        "source_text": m.group(0),
                    })

        # Blood sugar
        for m in _RE_SUGAR.finditer(text_lower):
            val = int(m.group(1))
            if 20 <= val <= 9999:
                results.append({
                    "type":        "blood_sugar",
                    "value":       val,
                    "unit":        "mg/dL",
                    "source_text": m.group(0),
                })

        # Weight
        for m in _RE_WEIGHT.finditer(text_lower):
            val = int(m.group(1))
            if 20 <= val <= 300:
                results.append({
                    "type":        "weight",
                    "value":       val,
                    "unit":        "kg",
                    "source_text": m.group(0),
                })

        # Temperature
        for m in _RE_TEMP.finditer(text_raw):
            val = float(m.group(1))
            unit_char = m.group(0).rstrip().upper()
            unit = "F" if "F" in unit_char else "C"
            results.append({
                "type":        "temperature",
                "value":       val,
                "unit":        unit,
                "source_text": m.group(0),
            })

        return results

    # ------------------------------------------------------------------
    # Medication extraction
    # ------------------------------------------------------------------

    def _extract_medications(
        self, text_raw: str, text_lower: str
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        seen: set = set()

        # Contextual Mandinka patterns first (they embed the drug name).
        for rx, context, group_idx in _MED_CONTEXT_PATTERNS:
            for m in rx.finditer(text_raw):
                drug = m.group(group_idx).lower()
                if drug in {med.lower() for med in _MEDICATIONS}:
                    if drug not in seen:
                        results.append({
                            "name":        drug,
                            "context":     context,
                            "source_text": m.group(0),
                        })
                        seen.add(drug)

        # Plain medication mentions (no Mandinka context frame).
        for m in self._re_meds.finditer(text_raw):
            drug = m.group(1).lower()
            if drug not in seen:
                results.append({
                    "name":        drug,
                    "context":     "mentioned",
                    "source_text": m.group(0),
                })
                seen.add(drug)

        # Mandinka generic medication terms (furaŋo, tableti).
        for m in self._re_mandinka_meds.finditer(text_lower):
            term = m.group(1).lower()
            english = _MANDINKA_MED_TERMS.get(term, term)
            results.append({
                "name":        english,
                "context":     "mentioned",
                "source_text": m.group(0),
            })

        return results

    # ------------------------------------------------------------------
    # Food extraction
    # ------------------------------------------------------------------

    def _extract_foods(self, text_lower: str) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        seen: set = set()
        for pattern, info in self._foods:
            if pattern in text_lower and pattern not in seen:
                results.append({
                    "name":          pattern,
                    "mandinka":      info["mandinka"],
                    "health_impact": info["health_impact"],
                })
                seen.add(pattern)
        return results

    # ------------------------------------------------------------------
    # Body-part extraction
    # ------------------------------------------------------------------

    def _extract_body_parts(self, text_lower: str) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        seen: set = set()
        for pattern, english in self._body_parts:
            if pattern in text_lower and pattern not in seen:
                # BUG-020 guard: if the body part name (or its English
                # translation) is in AMBIGUOUS_MEDICAL_TERMS and the
                # surrounding text reads as food context, skip the match.
                ambig_word = None
                if pattern in AMBIGUOUS_MEDICAL_TERMS:
                    ambig_word = pattern
                elif english in AMBIGUOUS_MEDICAL_TERMS:
                    ambig_word = english
                if ambig_word and not is_medical_context(ambig_word, text_lower):
                    continue
                results.append({
                    "mandinka": pattern,
                    "english":  english,
                })
                seen.add(pattern)
        return results

    # ------------------------------------------------------------------
    # Emergency detection
    # ------------------------------------------------------------------

    def _extract_emergencies(self, text_lower: str) -> List[Dict[str, str]]:
        results: List[Dict[str, str]] = []
        for pattern, _ in self._emergency_all:
            if pattern in text_lower:
                lang = (
                    "mandinka" if pattern in _EMERGENCY_MANDINKA
                    else "english"
                )
                results.append({
                    "text":     pattern,
                    "language": lang,
                })
        return results
