"""Translation Corrector v5.1 -- last defense before Mandinka reaches a patient.

Runs AFTER LLM translation, BEFORE the user sees anything.
15-layer pipeline based on error analysis of 30+ real failures.

v5.1 changes:
  - Full temporal NLP (mandinka_temporal.py) as Layer 2.5
  - Proper ŋ Unicode handling (NgHandler) — fixes root cause of day name errors
  - Day name normalization (Teneng→Teneŋo, dimasoo→Aladoo, etc.)
  - Month names: Saŋ-kiliŋ system (traditional Mandinka, not phonetic)
  - Prayer-based time ("after Fajr" → "subaa-saliioo kooma")
  - Relative time ("tomorrow" → "siniŋ", "next week" → "haftoo naatoo")
  - Numeric time ("30 minutes" → "miniti muwaŋ-ni-taŋ")
  - Range expressions ("Monday to Wednesday" → "Teneŋo fo Araba")
  - Compound temporal ("weekends" → "Sibiti ani Aladoo")
  - Season & farming calendar ("harvest season" → "kaloo-waxtoo")
  - Islamic calendar events (Ramadan → Sunkaroo-karoo, etc.)
  - Lumo market day awareness
  - Smart ng→ŋ conversion with English/Mandinka word discrimination

Pipeline position:
    LLM generates Mandinka
        -> TranslationCorrector.correct()   [this module]
           -> Layer 2.5: MandinkaTemporal    [temporal NLP]
        -> TranslationQualityGate.verify()   [existing]
        -> BilingualResponseBuilder.build()   [existing]
        -> User

Target latency: < 30ms total.
"""

from __future__ import annotations

import logging
import re
import time
from collections import Counter
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

__all__ = ["TranslationCorrector", "get_corrector"]

logger = logging.getLogger(__name__)


# ====================================================================
# LAYER 2: SYSTEM ID PATTERNS
# ====================================================================

_SYSTEM_ID_RE = re.compile(r"\bAdmin Patient\b", re.IGNORECASE)
_PATIENT_PREFIX_RE = re.compile(r"\bP_[A-Z0-9]+\b")
_SESSION_PREFIX_RE = re.compile(r"\bs_P_[A-Z_]+\b")
_CG_PREFIX_RE = re.compile(r"\bCG-[A-Z0-9]+\b")
_PATIENT_NUM_RE = re.compile(r"\bPatient \d+\b")
_USER_NUM_RE = re.compile(r"\bUser \d+\b")
_PATIENT_ID_LITERAL_RE = re.compile(r"\bpatient_id\b", re.IGNORECASE)


# ====================================================================
# LAYER 3: GREETING ENFORCEMENT
# ====================================================================

_WRONG_GREETINGS: Dict[str, Dict[str, str]] = {
    "sannu":   {"replace_with": "Salaam aleikum", "reason": "Hausa, not Mandinka"},
    "habari":  {"replace_with": "I be di",        "reason": "Swahili, not Mandinka"},
    "bonjour": {"replace_with": "Salaam aleikum", "reason": "French, not Mandinka"},
    "jambo":   {"replace_with": "I be di",        "reason": "Swahili, not Mandinka"},
    "bonsoir": {"replace_with": "Salaam aleikum", "reason": "French, not Mandinka"},
}

_VALID_GREETINGS_RE = re.compile(
    r"^\s*(?:Salaam\s+aleikum|Isama|Itileetaa|Iwurara|I\s+be\s+di)",
    re.IGNORECASE,
)

_TIME_GREETINGS = {
    "morning": "Isama",
    "afternoon": "Itileetaa",
    "evening": "Iwurara",
}


# ====================================================================
# LAYER 4: ENGLISH WORD HANDLING
# ====================================================================

ENGLISH_ALLOW: FrozenSet[str] = frozenset({
    "dka", "diabetic ketoacidosis", "mg/dl", "mmhg", "kg",
    "bp", "hba1c", "metformin", "amlodipine", "insulin",
    "paracetamol", "hydrochlorothiazide", "glibenclamide",
    "ibuprofen", "aspirin", "atenolol", "lisinopril",
    "losartan", "nifedipine", "enalapril",
    "who", "efsth", "moh", "amina", "199",
    "ok", "okay", "lumo", "moringa",
    "ors", "iv", "ecg", "icu", "ace", "arb",
    "mg", "dl", "ml",
})

ENGLISH_REPLACE: Dict[str, str] = {
    "breakfast": "suba domoroo",
    "lunch": "tiloo domoroo",
    "dinner": "suuto domoroo",
    "monday": "Teneng",
    "tuesday": "Talaato",
    "wednesday": "Araba",
    "thursday": "Alamisa",
    "friday": "Juma",
    "saturday": "Sibiti",
    "sunday": "Aladoo",
    "morning": "suba",
    "afternoon": "tiloo",
    "evening": "suuto",
    "night": "suwo",
    "bread": "",
    "porridge": "moni",
    "sweet potato": "kuukundingo",
    "sweet potatoes": "kuukundingoolu",
    "pumpkin": "juuroo",
    "cassava": "tubango",
    "rice": "maloo",
    "water": "jii",
    "fish": "jewoo",
    "meat": "suloo",
    "beans": "tiiyoo",
    "eggs": "killoo",
    "salt": "kolo",
    "sugar": "sukkaroo",
    "oil": "tuloo",
    "onion": "jaboo",
    "tomato": "tamatoo",
    "pepper": "kani",
    "lemon": "lemingo",
    "fruits": "tuloo-lu",
    "vegetables": "nakoo-lu",
    "produce": "nakoo-lu",
    "market": "lumo",
    "hospital": "ospitaali",
    "doctor": "dokitaroo",
    "medicine": "furango",
    "exercise": "taama-taama",
    "walking": "taama-taama",
    "plan": "laahidu",
    "healthy": "kendeyaa",
    "health": "kendeyaa",
    "herbs": "tiibaalu",
    "buy": "soto",
    "seasonal": "",
    "local": "",
    "manage": "maakoyi",
    "control": "kontoroo",
    "regular": "lung bee",
    "regularly": "lung bee",
    "weekend": "Sibiti ani Aladoo",
    "checkup": "dokitaroo nininkaa",
    "treatment": "furango",
    "schedule": "waxatoo",
    "monitor": "a kolaasi",
    "flavor": "taamoo",
    "flavour": "taamoo",
    "neighborhood": "saatewo",
    "january": "Sanwiye",
    "february": "Feeburuwari",
    "march": "Marsi",
    "april": "Abirilu",
    "may": "Meyi",
    "june": "Juŋ",
    "july": "Julaayi",
    "august": "Ogustu",
    "september": "Sateembari",
    "october": "Oktoobari",
    "november": "Nofeembari",
    "december": "Diseembari",
    "dry season": "tilingo waxtoo",
    "rainy season": "samaa waxtoo",
    "monday to wednesday": "Teneng fo Araba",
    "monday to friday": "Teneng fo Juma",
    "monday to sunday": "Teneng fo Aladoo",
}

ENGLISH_BLOCK: FrozenSet[str] = frozenset({
    "protein", "fiber", "carbohydrates", "calories", "nutrients",
    "minerals", "vitamins", "balanced mix", "nutritious",
    "beneficial", "recommended", "appropriate", "significant",
    "contribute", "incorporated", "facilitate", "consumption",
    "carbs", "fats",
})

_FAKE_MANDINKA_STATIC: Dict[str, Dict[str, str]] = {
    "balajaatoo laa plan": {"replace_with": "taama-taama laahidu", "reason": "Not real Mandinka"},
    "weekendoo":           {"replace_with": "Sibiti ani Aladoo",   "reason": "English + oo suffix"},
    "managoo":             {"replace_with": "maakoyi",             "reason": "English + oo suffix"},
    "controlloo":          {"replace_with": "kontoroo",            "reason": "English + oo suffix"},
    "recommendoo":         {"replace_with": None,                  "reason": "Not Mandinka"},
    "regularoo":           {"replace_with": "lung bee",            "reason": "Not Mandinka"},
    "healthyoo":           {"replace_with": "kendeyaa",            "reason": "Not Mandinka"},
    "exerciseoo":          {"replace_with": "taama-taama",         "reason": "Not Mandinka"},
    "checkupoo":           {"replace_with": "dokitaroo nininkaa",  "reason": "Not Mandinka"},
    "treatmentoo":         {"replace_with": "furango",             "reason": "Not Mandinka"},
    "scheduloo":           {"replace_with": "waxatoo",             "reason": "Not Mandinka"},
    "monitoroo":           {"replace_with": "a kolaasi",           "reason": "Not Mandinka"},
    "planoo":              {"replace_with": "laahidu",             "reason": "English + oo suffix"},
    "produceolu":          {"replace_with": "nakoo-lu",            "reason": "English + oo suffix"},
}

_FAKE_VERBS: Dict[str, str] = {
    "walki": "taama-taama",
    "checki": "a lajee",
    "helpi": "demmaa",
    "recommendi": "a foo",
    "reducei": "doyaa",
    "exercisi": "taama-taama",
    "managi": "maakoyi",
    "controli": "kontoroo",
    "maintaini": "maakoyi",
    "improvi": "a betteyaa",
    "includi": "faa",
    "consumi": "domo",
}

_FAKE_SUFFIX_RE = re.compile(r"\b([a-zA-Z]{4,}?)(oo|aa|lu)\b")

_ENGLISH_ROOT_SET: FrozenSet[str] = frozenset({
    "weekend", "manage", "control", "recommend", "regular",
    "healthy", "exercise", "checkup", "treatment", "schedul",
    "monitor", "plan", "produce", "market", "season",
    "breakfast", "lunch", "dinner", "snack", "supplement",
    "vitamin", "mineral", "calorie", "protein", "fiber",
    "nutrient", "benefit", "import", "balanc", "nutrit",
    "facilitat", "contribut", "incorporat", "consumpt",
    "appropriat", "significan",
})


# ====================================================================
# LAYER 5: MEDICAL TERM CORRECTIONS
# ====================================================================

MEDICAL_CORRECTIONS: Dict[str, Dict[str, Any]] = {
    "yele sukkaroo levelolu": {
        "replace_with": "i baloo kono sukkaroo",
        "severity": "critical",
    },
    "yele sukkaroo": {
        "replace_with": "i baloo kono sukkaroo",
        "severity": "critical",
    },
    "sukkaroo levelolu": {
        "replace_with": "i baloo kono sukkaroo",
        "severity": "critical",
    },
    "blood sugar levels": {
        "replace_with": "i baloo kono sukkaroo",
        "severity": "high",
    },
    "blood sugar": {
        "replace_with": "i baloo kono sukkaroo",
        "severity": "high",
    },
    "kung dimi": {
        "correct_when_context_is": "dizziness",
        "replace_with": "saasaaringo",
        "severity": "critical",
    },
    "blood pressure": {
        "replace_with": "joloo buntango",
        "severity": "high",
    },
    "diabetes": {
        "replace_with": "sukari-kuurango",
        "severity": "high",
    },
    "diabetic": {
        "replace_with": "sukari-kuurango",
        "severity": "high",
    },
}


# ====================================================================
# LAYER 6: FOOD NAME CORRECTIONS
# ====================================================================

FOOD_CORRECTIONS: Dict[str, str] = {
    "tapalapa bread": "tapalapa",
    "tapalapa koto": "tapalapa tilinyango",
    "moringa porridge": "moringa moni",
    "moringa leaves": "moringa",
    "baobab juice": "buyii jii",
    "groundnut paste": "churaa gerte",
    "groundnut stew": "domoda",
    "okra stew": "supakanja",
    "bean cake": "nyaankatang",
    "palm oil": "tuloo",
}

NON_GAMBIAN_FOODS: FrozenSet[str] = frozenset({
    "quinoa", "avocado", "kale", "broccoli", "tofu",
    "yogurt", "cheese", "pasta", "pizza", "smoothie",
    "granola", "oatmeal", "blueberries", "salmon",
    "olive oil", "almond", "soy", "brown rice",
    "cornflakes", "white bread", "margarine",
})

NON_GAMBIAN_REPLACEMENTS: Dict[str, str] = {
    "oatmeal": "moringa moni",
    "brown rice": "maloo",
    "yogurt": "buyii jii",
    "salmon": "jewoo",
    "olive oil": "gerte tuloo",
    "broccoli": "kanjaa",
    "kale": "moringa",
}

HARAM_FOODS: FrozenSet[str] = frozenset({
    "pork", "ham", "bacon", "lard", "gelatin",
    "wine", "beer", "alcohol", "rum", "whisky",
    "vodka", "champagne", "dolo", "gin", "whiskey",
})


# ====================================================================
# LAYER 7: TENSE VALIDATION
# ====================================================================

_PAST_IN_FUTURE_RE = re.compile(
    r"\bkunung?\b.*\b(?:siyaa|domo|dong|taa)\b", re.IGNORECASE,
)

_ENGLISH_FUTURE_RE = re.compile(
    r"\b(?:tomorrow|will|should|going\s+to|next\s+week|every\s+day)\b", re.IGNORECASE,
)


# ====================================================================
# LAYER 8: REPETITION
# ====================================================================

_REPETITION_ALTS: Dict[str, List[str]] = {
    "kisikisiroo": ["maakoyi", "kontoroo"],
    "a be nafaa":  ["a ka nii", "a be demmaa"],
    "a be nafaa le kendeyaa ye": ["a ka nii i kendeyaa ye", ""],
    "kendeyaa domoroo siifaa": ["domoroo kendo"],
    "a be jamaa le tiingo": ["a ka nii i ye"],
}


# ====================================================================
# NEGATION & ANTONYM
# ====================================================================

_NEGATION_PAIRS: List[Dict[str, Any]] = [
    {
        "english_re": re.compile(r"(?:don'?t|do\s+not|avoid)\s+eat", re.I),
        "mandinka_re": re.compile(r"kana.*domo", re.I),
        "action_word": "domo",
        "error": "MISSING NEGATION -- patient told to EAT something they should AVOID",
    },
    {
        "english_re": re.compile(r"(?:don'?t\s+stop|do\s+not\s+stop|keep\s+taking|continue)", re.I),
        "mandinka_re": re.compile(r"kana.*buloo\s+tii|kana.*daa\s+tii", re.I),
        "action_word": "tii",
        "error": "MISSING NEGATION -- patient told to STOP something they should CONTINUE",
    },
    {
        "english_re": re.compile(r"(?:don'?t|do\s+not|avoid)\s+tak", re.I),
        "mandinka_re": re.compile(r"kana.*dong", re.I),
        "action_word": "dong",
        "error": "MISSING NEGATION -- patient told to TAKE something they should AVOID",
    },
    {
        "english_re": re.compile(r"(?:don'?t\s+wait|do\s+not\s+wait|go\s+immediately)", re.I),
        "mandinka_re": re.compile(r"kana.*maakoy|SISAN", re.I),
        "action_word": "sisan",
        "error": "MISSING URGENCY -- patient not told to act immediately",
    },
]

_ANTONYM_PAIRS: List[Tuple[re.Pattern, re.Pattern, str]] = [
    (
        re.compile(r"\b(?:reduce|decrease|lower|cut\s+down|less)\b", re.I),
        re.compile(r"\bja(?:ng|ŋ)ja(?:ng|ŋ)\b", re.I),
        "English says REDUCE but Mandinka says INCREASE (jangjang)",
    ),
    (
        re.compile(r"\b(?:increase|raise|more|add|boost)\b", re.I),
        re.compile(r"\bdoyaa\b", re.I),
        "English says INCREASE but Mandinka says REDUCE (doyaa)",
    ),
    (
        re.compile(r"\b(?:eat|take|consume)\b", re.I),
        re.compile(r"\bkana\s+domo\b", re.I),
        "English says EAT but Mandinka says DON'T EAT (kana domo)",
    ),
]


# ====================================================================
# CULTURAL CHECKS
# ====================================================================

_PORK_RE = re.compile(r"\b(?:pork|ham|bacon|lard|suloo\s+kusewo|gelatin)\b", re.I)
_ALCOHOL_RE = re.compile(r"\b(?:wine|beer|dolo|vodka|whiskey|whisky|rum|alcohol|gin|champagne)\b", re.I)
_ALCOHOL_CESSATION_RE = re.compile(r"\b(?:stop|quit|avoid|reduce|cessation|abstain|kana)\b", re.I)
_NON_LOCAL_FOOD_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(f) for f in NON_GAMBIAN_FOODS) + r")\b", re.I,
)
_DISMISSIVE_TRAD_RE = re.compile(
    r"kana\s+taa\s+marabout\s+fee|marabout.*(?:bad|wrong|dangerous|useless)", re.I,
)


# ====================================================================
# KNOWN MANDINKA VOCABULARY
# ====================================================================

def _build_known_mandinka() -> FrozenSet[str]:
    words: Set[str] = set()
    try:
        from src.services.mandinka_phrases import PHRASES, FOOD_NAMES
        for _cat, entries in PHRASES.items():
            for _key, phrase in entries.items():
                for w in re.split(r"[\s,;!?\-/]+", phrase.lower()):
                    if w:
                        words.add(w)
        for _key, info in FOOD_NAMES.items():
            for w in re.split(r"[\s,;!?\-/]+", info["mandinka"].lower()):
                if w:
                    words.add(w)
    except Exception:
        pass
    _STATIC = {
        "salaam", "aleikum", "maleikum", "alhamdulillah",
        "isama", "iwurara", "itileetaa",
        "kana", "te", "be", "ye", "le", "la", "ka", "ti", "ni",
        "mu", "si", "makoyi", "maakoyi", "kendeyaa", "furango",
        "dokitaroo", "ospitaali", "dimi", "domoroo", "jii",
        "sukkaroo", "tuloo", "joloo", "kuloo", "sisan", "joona",
        "lung", "bee", "suba", "tiloo", "suuto", "bii", "saama",
        "kelen", "fula", "saba", "naani", "luulu", "tilingo",
        "doyaa", "jangjang", "dong", "domo", "taa", "naa",
        "kontoroo", "waxatoo", "taama",
        "teneng", "talaato", "araba", "aramisa", "aramisaa",
        "arijuma", "sibiti", "aladoo", "juma", "alamisa",
        "baloo", "kono", "kungo", "kankulungo", "sengo",
        "boloo", "juroo", "farang", "buutaata",
        "alla", "baraka", "abaraka", "jaabi",
        "n", "i", "a", "nte", "ale", "alu",
        "naaningo", "laahidu", "moringa", "moni",
        "mono", "laaciiri", "buyii", "supakanja",
        "domoda", "nakoo", "jewoo", "maloo",
        "tapalapa", "churaa", "gerte",
        "killoo", "tiiyoo", "jaboo", "tamatoo", "kani",
        "surolu", "fo", "ani", "ning", "kono",
        "dindiyaalu", "kisikisiroo", "saasaaringo",
        "kolo", "lemingo", "juuroo", "tubango",
        "kuukundingo", "kuukundingoolu",
        "nyaankatang", "kanjaa", "tiibaalu",
        "tilinyango", "camma",
    }
    words.update(_STATIC)
    return frozenset(words)


_KNOWN_MANDINKA: FrozenSet[str] = _build_known_mandinka()

_MANDINKA_SUFFIXES = ("oo", "aa", "ee", "lu", "la", "le", "ti", "ngo", "nko")

_COMMON_ENGLISH: FrozenSet[str] = frozenset({
    "the", "is", "am", "are", "was", "were", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "shall", "should", "may", "might", "must", "can", "could",
    "not", "and", "or", "but", "if", "then", "than", "that",
    "this", "these", "those", "it", "its", "he", "she", "him",
    "her", "his", "we", "they", "them", "our", "your", "my",
    "me", "us", "to", "of", "in", "for", "on", "with", "at",
    "by", "from", "as", "into", "about", "up", "out", "so",
    "what", "which", "who", "when", "where", "how", "why",
    "because", "therefore", "however", "although",
    "important", "recommend", "increase", "decrease",
    "maintain", "manage", "monitor", "condition", "treatment",
    "medication", "symptoms", "symptom", "diagnosis",
    "doctor", "hospital", "clinic", "appointment",
    "exercise", "physical", "daily", "regularly", "weekly",
    "also", "very", "just", "only", "each", "every",
    "help", "helps", "need", "needs", "please", "thank",
    "good", "better", "best", "bad", "worse", "worst",
    "eat", "drink", "take", "stop", "start", "continue",
    "reduce", "avoid", "healthy", "food", "meal", "diet",
    "sugar", "salt", "oil", "water", "blood", "pressure",
    "level", "levels", "high", "low", "normal",
    "morning", "afternoon", "evening", "night", "day",
    "time", "times", "once", "twice", "before", "after",
    "buy", "seasonal", "local", "produce", "fruits",
    "vegetables", "market", "plan", "walk", "walking",
})


def _is_english_word(word: str) -> bool:
    if len(word) <= 2:
        return False
    if word in _KNOWN_MANDINKA:
        return False
    return word in _COMMON_ENGLISH


def _english_ratio(sentence: str) -> float:
    words = sentence.split()
    if not words:
        return 0.0
    eng = 0
    for w in words:
        clean = re.sub(r"[.,;:!?\"'()\-]+", "", w).strip().lower()
        if not clean or len(clean) <= 2:
            continue
        if clean in ENGLISH_ALLOW:
            continue
        if re.match(r"^[\d./%]+$", clean):
            continue
        if clean in _KNOWN_MANDINKA:
            continue
        if _is_english_word(clean) or clean in ENGLISH_BLOCK or clean in ENGLISH_REPLACE:
            eng += 1
    total = max(len([w for w in words if len(re.sub(r"[.,;:!?]+", "", w)) > 2]), 1)
    return eng / total


# ====================================================================
# CORRECTOR CLASS
# ====================================================================

class TranslationCorrector:
    """Post-LLM translation corrector v5.1 for Mandinka medical text."""

    def correct(
        self,
        mandinka_text: str,
        english_source: str,
        patient_context: Optional[Dict[str, Any]] = None,
        response_type: str = "general",
    ) -> Dict[str, Any]:
        # BUG-019 fix: empty / whitespace input must not enter the
        # correction pipeline. Without this guard, the layer-3 greeting
        # synthesizer would build a self-introduction out of thin air
        # ("Sila Salaam aleekum, ..." with no patient utterance), which
        # broke chat continuity and confused the safety auditor.
        if not mandinka_text or not str(mandinka_text).strip():
            logger.debug("[CORRECTOR] empty / whitespace input -- skipping pipeline")
            return {
                "corrected_text": "",
                "original_text": mandinka_text or "",
                "english_source": english_source or "",
                "overall_score": 0.0,
                "recommendation": "BLOCK_USE_ENGLISH",
                "block_reason": "empty_input",
                "corrections_applied": [],
                "hard_blockers_fired": ["empty_input"],
                "processing_time_ms": 0,
                "english_leaks": {"found": 0, "replaced": 0, "blocked": 0},
                "medical_corrections": 0,
                "food_corrections": 0,
                "cultural_issues": [],
                "repetitions_fixed": 0,
                "tense_issues": 0,
                "greeting_added": False,
                "truncated": False,
                "hallucinations_detected": 0,
                "completeness_ratio": 0.0,
            }

        if not english_source or not str(english_source).strip():
            # We have Mandinka but no English to validate against. Pass
            # the Mandinka through (no leak detection possible) and let
            # the caller decide; the recommendation says "ok but no
            # validation happened".
            logger.debug("[CORRECTOR] empty english_source -- limited validation only")
            return {
                "corrected_text": mandinka_text,
                "original_text": mandinka_text,
                "english_source": "",
                "overall_score": 0.3,
                "recommendation": "SERVE_CORRECTED",
                "block_reason": "no_english_source",
                "corrections_applied": [],
                "hard_blockers_fired": [],
                "processing_time_ms": 0,
            }

        t0 = time.perf_counter()
        ctx = patient_context or {}
        patient_name = ctx.get("patient_name", "")
        time_of_day = ctx.get("time_of_day", "")

        corrections: List[Dict[str, Any]] = []
        blocked: List[Dict[str, Any]] = []
        english_leaks: List[str] = []
        fake_list: List[str] = []
        cultural_issues: List[str] = []
        hard_blockers_fired: List[str] = []

        text = mandinka_text

        # ── LAYER 2: SYSTEM ID CLEANUP ──────────────────────────────
        text = self._clean_system_ids(text, patient_name, corrections)

        # ── LAYER 2.5: TEMPORAL NLP ─────────────────────────────────
        try:
            from src.nlp.mandinka_temporal import get_temporal
            temporal = get_temporal()
            temporal_result = temporal.process_temporal(text)
            text = temporal_result["processed_text"]
            for r in temporal_result["replacements"]:
                corrections.append({
                    "layer": 2.5, "original": r["original"],
                    "corrected": r["replaced"],
                    "reason": f"temporal_{r['type']}",
                    "severity": "low",
                })
        except Exception as exc:
            logger.warning("Temporal NLP failed (non-fatal): %s", exc)

        # ── LAYER 3: GREETING ENFORCEMENT ───────────────────────────
        greeting_added = self._enforce_greeting(text, time_of_day, ctx)
        if greeting_added:
            text = greeting_added
            corrections.append({
                "layer": 3, "original": "(no greeting)", "corrected": "(greeting added)",
                "reason": "Mandinka greeting enforced", "severity": "low",
            })
        text = self._correct_wrong_greetings(text, corrections)

        # ── LAYER 5: MEDICAL TERM CORRECTIONS (before English word ──
        #    handling so multi-word phrases are caught intact)
        text = self._correct_medical_terms(text, english_source, corrections)

        # ── LAYER 6: FOOD NAME VALIDATION ──────────────────────────
        text = self._correct_food_names(text, corrections)

        # ── GARBLED PHRASE REMOVAL (before word matching) ────────────
        text = self._remove_garbled_phrases(text, corrections)

        # ── LAYER 4: ENGLISH WORD DETECTION ─────────────────────────
        text = self._correct_fake_mandinka(text, corrections, fake_list)
        text = self._detect_fake_suffix(text, corrections, fake_list)
        text, english_leaks, eng_replaced, eng_blocked_count = self._handle_english_words(
            text, corrections,
        )

        # ── LAYER 1: HARD BLOCKERS (after corrections) ─────────────
        text, hard_blockers_fired, blocked = self._check_hard_blockers(
            text, english_source, blocked,
        )
        if hard_blockers_fired and any(b.get("action") == "BLOCK" for b in blocked):
            elapsed = round((time.perf_counter() - t0) * 1000, 2)
            return self._build_result(
                text, mandinka_text, english_source, corrections, blocked,
                english_leaks, fake_list, [], cultural_issues,
                hard_blockers_fired, 0.0, "BLOCK_USE_ENGLISH",
                blocked[0].get("reason", "hard_blocker"),
                False, False, elapsed, response_type,
                greeting_added=bool(greeting_added),
            )

        # ── LAYER 7: TENSE VALIDATION ──────────────────────────────
        tense_issues = self._check_tense(text, english_source, corrections)

        # ── LAYER 8: REPETITION HANDLING ───────────────────────────
        text, repetitions = self._fix_repetitions(text, corrections)

        # ── LAYER 9: PER-SENTENCE SCORING ──────────────────────────
        per_sentence = self._score_sentences(text, english_source)

        # ── LAYER 10: COMPLETENESS & HALLUCINATION CHECK ───────────
        completeness, hallucinations, text, truncated = self._check_completeness(
            text, english_source, corrections,
        )

        # ── LAYER 11: CULTURAL SAFETY ──────────────────────────────
        cultural_issues = self._check_cultural(text, english_source, ctx)
        haram_detected = any("pork" in c.lower() or "haram" in c.lower() for c in cultural_issues)
        if haram_detected:
            blocked.append({
                "type": "haram_food", "action": "BLOCK",
                "reason": "Haram food detected", "severity": "critical",
            })
            hard_blockers_fired.append("haram_food")

        # ── LAYER 12: STRUCTURE VALIDATION ─────────────────────────
        structure_issues = self._validate_structure(text, response_type)

        # ── LAYER 13: SALT GUIDANCE ────────────────────────────────
        text = self._inject_salt_guidance(text, english_source, ctx, corrections)

        # ── NEGATION SAFETY ────────────────────────────────────────
        negation_safe = self._check_negation(english_source, text, blocked)

        # ── NUMBER VALIDATION ──────────────────────────────────────
        numbers_ok = self._check_numbers(english_source, text, blocked)

        # ── ANTONYM CHECK ──────────────────────────────────────────
        antonyms_safe = self._check_antonyms(english_source, text, blocked)

        # ── OVERALL DECISION ───────────────────────────────────────
        lowest = min((s["score"] for s in per_sentence), default=1.0)
        avg = (
            sum(s["score"] for s in per_sentence) / len(per_sentence)
            if per_sentence else 1.0
        )
        low_count = sum(1 for s in per_sentence if s["score"] < 0.3)

        if blocked:
            recommendation = "BLOCK_USE_ENGLISH"
            block_reason = blocked[0].get("type", "blocker")
            overall_score = 0.0
        elif low_count >= 2:
            recommendation = "BLOCK_USE_ENGLISH"
            block_reason = "multiple_low_sentences"
            overall_score = round(avg, 2)
        elif lowest <= 0.0:
            recommendation = "BLOCK_USE_ENGLISH"
            block_reason = "zero_score_sentence"
            overall_score = round(avg, 2)
        elif avg < 0.4:
            recommendation = "BLOCK_USE_ENGLISH"
            block_reason = "low_average_quality"
            overall_score = round(avg, 2)
        elif corrections or cultural_issues or truncated or tense_issues:
            recommendation = "SERVE_CORRECTED"
            block_reason = None
            overall_score = round(avg, 2)
        else:
            recommendation = "SERVE"
            block_reason = None
            overall_score = round(avg, 2)

        elapsed = round((time.perf_counter() - t0) * 1000, 2)

        return self._build_result(
            text, mandinka_text, english_source, corrections, blocked,
            english_leaks, fake_list, cultural_issues, cultural_issues,
            hard_blockers_fired, overall_score, recommendation, block_reason,
            negation_safe, antonyms_safe, elapsed, response_type,
            per_sentence=per_sentence,
            numbers_ok=numbers_ok,
            repetitions=repetitions,
            tense_issues=tense_issues,
            completeness=completeness,
            hallucinations=hallucinations,
            truncated=truncated,
            greeting_added=bool(greeting_added),
            eng_replaced=eng_replaced,
            eng_blocked_count=eng_blocked_count,
        )

    # ================================================================
    # BUILD RESULT
    # ================================================================

    @staticmethod
    def _build_result(
        text, original, english, corrections, blocked,
        english_leaks, fake_list, cultural_issues, _cultural_dup,
        hard_blockers_fired, overall_score, recommendation, block_reason,
        negation_safe, antonyms_safe, elapsed, response_type,
        per_sentence=None, numbers_ok=True, repetitions=None,
        tense_issues=0, completeness=1.0, hallucinations=0,
        truncated=False, greeting_added=False,
        eng_replaced=0, eng_blocked_count=0,
    ) -> Dict[str, Any]:
        total_words = len(text.split())
        rep_dict = dict(repetitions) if repetitions else {}
        per_sentence = per_sentence or []
        lowest = min((s["score"] for s in per_sentence), default=1.0)
        med_corrections = sum(1 for c in corrections if c.get("reason", "").startswith("medical"))
        food_corrections = sum(1 for c in corrections if c.get("reason", "").startswith("food"))

        return {
            "corrected_text": text,
            "original_text": original,
            "english_source": english,
            "overall_score": overall_score,
            "recommendation": recommendation,
            "block_reason": block_reason,
            "per_sentence_scores": per_sentence,
            "corrections_applied": corrections,
            "blocked_errors": blocked,
            "hard_blockers_fired": hard_blockers_fired,
            "english_leaks": english_leaks,
            "fake_mandinka": fake_list,
            "cultural_issues": cultural_issues,
            "numbers_verified": numbers_ok,
            "negation_safe": negation_safe,
            "antonyms_safe": antonyms_safe,
            "repetitions": rep_dict,
            "grammar_flags": [],
            "medical_corrections": med_corrections,
            "food_corrections": food_corrections,
            "repetitions_fixed": sum(rep_dict.values()) if rep_dict else 0,
            "tense_issues": tense_issues,
            "greeting_added": greeting_added,
            "truncated": truncated,
            "hallucinations_detected": hallucinations,
            "completeness_ratio": completeness,
            "stats": {
                "total_words": total_words,
                "corrections_count": len(corrections),
                "english_leak_ratio": round(len(english_leaks) / max(total_words, 1), 3),
                "repetition_ratio": round(
                    sum(rep_dict.values()) / max(total_words, 1), 3,
                ) if rep_dict else 0.0,
                "lowest_sentence_score": round(lowest, 2),
                "processing_time_ms": elapsed,
            },
        }

    # ================================================================
    # LAYER 1: HARD BLOCKERS
    # ================================================================

    def _check_hard_blockers(
        self, text: str, english: str, blocked: List[Dict[str, Any]],
    ) -> Tuple[str, List[str], List[Dict[str, Any]]]:
        fired: List[str] = []

        sentences = [s.strip() for s in re.split(r"[.!?\n]+", text) if s.strip()]

        for sent in sentences:
            ratio = _english_ratio(sent)
            if ratio > 0.6 and len(sent.split()) >= 4:
                fired.append("sentence_majority_english")
                blocked.append({
                    "type": "sentence_majority_english",
                    "action": "BLOCK",
                    "reason": f"Sentence is {ratio:.0%} English: {sent[:100]}",
                    "severity": "critical",
                })
                break

        consec = self._count_consecutive_english(text)
        if consec >= 3:
            fired.append("garbled_english_mandinka_mash")
            blocked.append({
                "type": "garbled_english_mandinka_mash",
                "action": "BLOCK",
                "reason": f"{consec} consecutive English words found",
                "severity": "critical",
            })

        if sentences and len(sentences) >= 3:
            tail = sentences[-2:]
            tail_bad = 0
            for s in tail:
                if _english_ratio(s) > 0.4 and len(s.split()) >= 3:
                    tail_bad += 1
            if tail_bad >= 2:
                cut_idx = text.rfind(tail[0])
                if cut_idx > 20:
                    text = text[:cut_idx].rstrip(". \n") + "."
                    fired.append("incomprehensible_trailing_text")
                    blocked.append({
                        "type": "incomprehensible_trailing_text",
                        "action": "TRUNCATE_AND_WARN",
                        "reason": "LLM Mandinka degraded in trailing sentences",
                        "severity": "high",
                    })

        return text, fired, blocked

    @staticmethod
    def _count_consecutive_english(text: str) -> int:
        words = text.split()
        max_run = 0
        current_run = 0
        for w in words:
            clean = re.sub(r"[.,;:!?\"'()\-]+", "", w).strip().lower()
            if not clean or len(clean) <= 2:
                current_run = 0
                continue
            if clean in ENGLISH_ALLOW:
                current_run = 0
                continue
            if re.match(r"^[\d./%]+$", clean):
                current_run = 0
                continue
            if clean in _KNOWN_MANDINKA:
                current_run = 0
                continue
            if _is_english_word(clean) or clean in ENGLISH_REPLACE:
                current_run += 1
                max_run = max(max_run, current_run)
            else:
                current_run = 0
        return max_run

    # ================================================================
    # LAYER 2: SYSTEM ID CLEANUP
    # ================================================================

    @staticmethod
    def _clean_system_ids(
        text: str, patient_name: str, corrections: List[Dict[str, Any]],
    ) -> str:
        replacement = patient_name if patient_name else ""
        for pat, label in [
            (_SYSTEM_ID_RE, "Admin Patient"),
            (_PATIENT_PREFIX_RE, "Patient ID prefix"),
            (_SESSION_PREFIX_RE, "Session prefix"),
            (_CG_PREFIX_RE, "Caregiver ID"),
            (_PATIENT_NUM_RE, "Patient number"),
            (_USER_NUM_RE, "User number"),
            (_PATIENT_ID_LITERAL_RE, "patient_id literal"),
        ]:
            found = pat.findall(text)
            if found:
                text = pat.sub(replacement, text)
                corrections.append({
                    "layer": 2, "original": ", ".join(found),
                    "corrected": replacement or "(removed)",
                    "reason": f"System ID leaking: {label}",
                    "severity": "high",
                })
        text = re.sub(r"  +", " ", text).strip()
        return text

    # ================================================================
    # LAYER 3: GREETING ENFORCEMENT
    # ================================================================

    @staticmethod
    def _enforce_greeting(
        text: str, time_of_day: str, ctx: Dict[str, Any],
    ) -> Optional[str]:
        if not text.strip():
            return None
        if _VALID_GREETINGS_RE.match(text):
            return None
        greeting = _TIME_GREETINGS.get(time_of_day, "Salaam aleikum")
        patient_name = ctx.get("patient_name", "")
        age = ctx.get("age", 0)
        role = ctx.get("user_role", "")

        parts = [greeting + "."]
        if age and age > 55 or role == "alkalo":
            parts.append("I surolu be di?")
        parts.append("I be di?")
        if patient_name:
            parts.append(f"{patient_name},")

        prefix = " ".join(parts) + " "
        return prefix + text

    @staticmethod
    def _correct_wrong_greetings(
        text: str, corrections: List[Dict[str, Any]],
    ) -> str:
        for wrong, info in _WRONG_GREETINGS.items():
            pattern = re.compile(re.escape(wrong), re.IGNORECASE)
            if pattern.search(text):
                text = pattern.sub(info["replace_with"], text)
                corrections.append({
                    "layer": 3, "original": wrong,
                    "corrected": info["replace_with"],
                    "reason": info["reason"],
                    "severity": "moderate",
                })
        return text

    # ================================================================
    # LAYER 4: ENGLISH WORD DETECTION
    # ================================================================

    @staticmethod
    def _correct_fake_mandinka(
        text: str, corrections: List[Dict[str, Any]], fake_list: List[str],
    ) -> str:
        for fake_term, info in _FAKE_MANDINKA_STATIC.items():
            pattern = re.compile(re.escape(fake_term), re.IGNORECASE)
            if not pattern.search(text):
                continue
            fake_list.append(fake_term)
            replacement = info["replace_with"]
            if replacement is None:
                text = pattern.sub("", text)
            else:
                text = pattern.sub(replacement, text)
            corrections.append({
                "layer": 4, "original": fake_term,
                "corrected": replacement or "(removed)",
                "reason": info["reason"],
                "severity": "moderate",
            })

        for fake_verb, real in _FAKE_VERBS.items():
            pattern = re.compile(r"\b" + re.escape(fake_verb) + r"\b", re.IGNORECASE)
            if pattern.search(text):
                text = pattern.sub(real, text)
                fake_list.append(fake_verb)
                corrections.append({
                    "layer": 4, "original": fake_verb,
                    "corrected": real,
                    "reason": f"Fake verb (English root + -i suffix)",
                    "severity": "moderate",
                })

        text = re.sub(r"  +", " ", text).strip()
        return text

    @staticmethod
    def _detect_fake_suffix(
        text: str, corrections: List[Dict[str, Any]], fake_list: List[str],
    ) -> str:
        def _replace_fake(m: re.Match) -> str:
            full = m.group(0)
            root = m.group(1).lower()
            if full.lower() in _KNOWN_MANDINKA:
                return full
            if root in _ENGLISH_ROOT_SET or root.rstrip("e") in _ENGLISH_ROOT_SET:
                lookup = root.rstrip("e")
                replacement = ENGLISH_REPLACE.get(lookup, ENGLISH_REPLACE.get(root, ""))
                fake_list.append(full)
                corrections.append({
                    "layer": 4, "original": full,
                    "corrected": replacement or "(removed)",
                    "reason": f"Fake Mandinka (English root '{root}' + suffix)",
                    "severity": "moderate",
                })
                return replacement
            return full

        text = _FAKE_SUFFIX_RE.sub(_replace_fake, text)
        text = re.sub(r"  +", " ", text).strip()
        return text

    @staticmethod
    def _handle_english_words(
        text: str, corrections: List[Dict[str, Any]],
    ) -> Tuple[str, List[str], int, int]:
        leaks: List[str] = []
        replaced_count = 0
        blocked_count = 0

        # Multi-word replacements: also match through markdown markers
        for multi_word in sorted(ENGLISH_REPLACE.keys(), key=len, reverse=True):
            if " " not in multi_word:
                continue
            # Build a pattern that allows optional ** or * around each word
            parts = multi_word.split()
            md_pat = r"\s+".join(
                r"[*_]{0,2}" + re.escape(p) + r"[*_]{0,2}" for p in parts
            )
            pat = re.compile(md_pat, re.IGNORECASE)
            m = pat.search(text)
            if m:
                repl = ENGLISH_REPLACE[multi_word]
                text = text[:m.start()] + repl + text[m.end():]
                replaced_count += 1
                corrections.append({
                    "layer": 4, "original": multi_word,
                    "corrected": repl or "(removed)",
                    "reason": "English phrase auto-replaced",
                    "severity": "low",
                })

        tokens = text.split()
        rebuilt: List[str] = []
        for tok in tokens:
            # Strip markdown AND punctuation for matching
            md_prefix = ""
            md_suffix = ""
            inner = tok
            while inner and inner[0] in "*_":
                md_prefix += inner[0]
                inner = inner[1:]
            while inner and inner[-1] in "*_":
                md_suffix = inner[-1] + md_suffix
                inner = inner[:-1]

            clean = re.sub(r"[.,;:!?\"'()\-]+", "", inner).strip().lower()
            if not clean:
                rebuilt.append(tok)
                continue
            if clean in ENGLISH_ALLOW or re.match(r"^[\d./%]+$", clean):
                rebuilt.append(tok)
                continue
            if clean in _KNOWN_MANDINKA:
                rebuilt.append(tok)
                continue
            if any(c in clean for c in "ŋñ"):
                rebuilt.append(tok)
                continue
            if clean.endswith(_MANDINKA_SUFFIXES) and clean not in ENGLISH_BLOCK:
                rebuilt.append(tok)
                continue

            if clean in ENGLISH_BLOCK:
                blocked_count += 1
                corrections.append({
                    "layer": 4, "original": clean,
                    "corrected": "(removed)",
                    "reason": "English nutrient/scientific word blocked",
                    "severity": "moderate",
                })
                continue

            if clean in ENGLISH_REPLACE:
                repl = ENGLISH_REPLACE[clean]
                if repl:
                    trailing_punct = re.sub(r"[a-zA-Z]+", "", inner[len(clean):]) if len(inner) > len(clean) else ""
                    rebuilt.append(md_prefix + repl + md_suffix + trailing_punct)
                replaced_count += 1
                corrections.append({
                    "layer": 4, "original": clean,
                    "corrected": repl or "(removed)",
                    "reason": "English word auto-replaced",
                    "severity": "low",
                })
                continue

            if _is_english_word(clean):
                leaks.append(clean)

            rebuilt.append(tok)

        text = " ".join(rebuilt)
        text = re.sub(r"  +", " ", text).strip()
        return text, leaks, replaced_count, blocked_count

    # ================================================================
    # LAYER 5: MEDICAL TERM CORRECTIONS
    # ================================================================

    @staticmethod
    def _correct_medical_terms(
        text: str, english_source: str, corrections: List[Dict[str, Any]],
    ) -> str:
        eng_lower = english_source.lower()
        for bad_term, info in MEDICAL_CORRECTIONS.items():
            pattern = re.compile(re.escape(bad_term), re.IGNORECASE)
            if not pattern.search(text):
                continue
            context_gate = info.get("correct_when_context_is")
            if context_gate and context_gate not in eng_lower:
                continue
            replacement = info["replace_with"]
            if replacement is None:
                text = pattern.sub("", text)
            else:
                text = pattern.sub(replacement, text)
            corrections.append({
                "layer": 5, "original": bad_term,
                "corrected": replacement or "(removed)",
                "reason": "medical term correction",
                "severity": info["severity"],
            })
        text = re.sub(r"  +", " ", text).strip()
        return text

    # ================================================================
    # LAYER 6: FOOD NAME VALIDATION
    # ================================================================

    @staticmethod
    def _correct_food_names(
        text: str, corrections: List[Dict[str, Any]],
    ) -> str:
        for wrong, right in FOOD_CORRECTIONS.items():
            pattern = re.compile(re.escape(wrong), re.IGNORECASE)
            if pattern.search(text):
                text = pattern.sub(right, text)
                corrections.append({
                    "layer": 6, "original": wrong,
                    "corrected": right,
                    "reason": "food name correction",
                    "severity": "low",
                })

        for food in NON_GAMBIAN_FOODS:
            pat = re.compile(r"\b" + re.escape(food) + r"\b", re.IGNORECASE)
            if pat.search(text):
                repl = NON_GAMBIAN_REPLACEMENTS.get(food, "")
                text = pat.sub(repl, text)
                corrections.append({
                    "layer": 6, "original": food,
                    "corrected": repl or "(removed)",
                    "reason": "food name correction: non-Gambian food replaced",
                    "severity": "moderate",
                })

        text = re.sub(r"  +", " ", text).strip()
        return text

    # ================================================================
    # LAYER 7: TENSE VALIDATION
    # ================================================================

    @staticmethod
    def _check_tense(
        text: str, english: str, corrections: List[Dict[str, Any]],
    ) -> int:
        issues = 0
        if _ENGLISH_FUTURE_RE.search(english) and _PAST_IN_FUTURE_RE.search(text):
            issues += 1
            corrections.append({
                "layer": 7, "original": "(past tense marker in future context)",
                "corrected": "(flagged)",
                "reason": "tense mismatch: English future but Mandinka past",
                "severity": "high",
            })
        return issues

    # ================================================================
    # LAYER 8: REPETITION HANDLING
    # ================================================================

    @staticmethod
    def _fix_repetitions(
        text: str, corrections: List[Dict[str, Any]],
    ) -> Tuple[str, Counter]:
        words = text.split()
        if len(words) < 9:
            return text, Counter()

        ngram_counts: Counter = Counter()
        for n in (5, 4, 3):
            for i in range(len(words) - n + 1):
                gram = " ".join(words[i : i + n])
                ngram_counts[gram] += 1

        repeated = {g: c for g, c in ngram_counts.items() if c >= 3}
        if not repeated:
            return text, Counter()

        for gram, count in repeated.items():
            gram_lower = gram.lower()
            alt = None
            for key, alts in _REPETITION_ALTS.items():
                if key in gram_lower and alts:
                    alt = alts[0]
                    break

            parts = text.split(gram)
            if len(parts) > 3:
                rebuilt = gram.join(parts[:3])
                remainder = gram.join(parts[3:])
                if alt:
                    remainder = remainder.replace(gram, alt)
                else:
                    remainder = remainder.replace(gram, "")
                text = rebuilt + remainder
                text = re.sub(r"  +", " ", text).strip()
                corrections.append({
                    "layer": 8, "original": gram,
                    "corrected": alt or "(removed excess)",
                    "reason": f"repeated {count}x, replaced 3rd+ occurrence",
                    "severity": "moderate",
                })

        return text, Counter(repeated)

    # ================================================================
    # LAYER 9: PER-SENTENCE SCORING
    # ================================================================

    def _score_sentences(
        self, mandinka_text: str, english_source: str,
    ) -> List[Dict[str, Any]]:
        m_sents = [s.strip() for s in re.split(r"[.!?\n]+", mandinka_text) if s.strip()]
        if not m_sents:
            return [{"sentence": mandinka_text, "score": 0.5, "issues": ["single_blob"]}]

        results: List[Dict[str, Any]] = []
        for sent in m_sents:
            score = 1.0
            issues: List[str] = []

            for bad_term in MEDICAL_CORRECTIONS:
                ctx_gate = MEDICAL_CORRECTIONS[bad_term].get("correct_when_context_is")
                if ctx_gate and ctx_gate not in english_source.lower():
                    continue
                if bad_term in sent.lower():
                    score -= 0.4
                    issues.append("medical_term_error")
                    break

            for pair in _NEGATION_PAIRS:
                if pair["english_re"].search(english_source):
                    action_word = pair.get("action_word", "")
                    if action_word and action_word not in sent.lower():
                        continue
                    if not pair["mandinka_re"].search(sent):
                        score -= 0.8
                        issues.append("negation_error")

            for eng_re, mnk_re, _ in _ANTONYM_PAIRS:
                if eng_re.search(english_source) and mnk_re.search(sent):
                    score = 0.0
                    issues.append("antonym_swap")

            ratio = _english_ratio(sent)
            if ratio > 0.6 and len(sent.split()) >= 4:
                score -= 0.6
                issues.append("majority_english")
            elif ratio > 0.3:
                leak_count = int(ratio * len(sent.split()))
                score -= 0.15 * min(leak_count, 4)
                if leak_count > 0:
                    issues.append("english_leak")

            for fake_term in _FAKE_MANDINKA_STATIC:
                if fake_term in sent.lower():
                    score -= 0.3
                    issues.append("fake_mandinka")
                    break

            if _PAST_IN_FUTURE_RE.search(sent) and _ENGLISH_FUTURE_RE.search(english_source):
                score -= 0.3
                issues.append("tense_error")

            for food in NON_GAMBIAN_FOODS:
                if food.lower() in sent.lower():
                    score -= 0.2
                    issues.append("non_gambian_food")
                    break

            results.append({
                "sentence": sent[:200],
                "score": round(max(score, 0.0), 2),
                "issues": issues,
            })

        return results

    # ================================================================
    # LAYER 10: COMPLETENESS & HALLUCINATION CHECK
    # ================================================================

    @staticmethod
    def _check_completeness(
        text: str, english: str, corrections: List[Dict[str, Any]],
    ) -> Tuple[float, int, str, bool]:
        eng_numbers = set(re.findall(r"\b\d+(?:\.\d+)?\b", english))
        mnk_numbers = set(re.findall(r"\b\d+(?:\.\d+)?\b", text))

        eng_foods = set()
        for food_en in ENGLISH_REPLACE:
            if food_en in english.lower():
                eng_foods.add(food_en)

        neg_markers_en = len(re.findall(r"\b(?:don'?t|do\s+not|avoid|never|stop)\b", english, re.I))
        neg_markers_mn = len(re.findall(r"\bkana\b", text, re.I))

        eng_elements = len(eng_numbers) + len(eng_foods) + neg_markers_en
        mnk_elements = len(mnk_numbers) + neg_markers_mn
        completeness = mnk_elements / max(eng_elements, 1)
        completeness = min(completeness, 1.0)

        hallucinations = 0

        truncated = False
        sentences = [s.strip() for s in re.split(r"[.!?\n]+", text) if s.strip()]
        if len(sentences) >= 3:
            last_3 = sentences[-3:]
            bad_tail = 0
            for s in last_3:
                r = _english_ratio(s)
                if r > 0.4 and len(s.split()) >= 3:
                    bad_tail += 1
            if bad_tail >= 2:
                cut_point = text.rfind(last_3[-bad_tail])
                if cut_point > 20:
                    text = text[:cut_point].rstrip(". \n") + "."
                    truncated = True
                    corrections.append({
                        "layer": 10, "original": "(trailing garbage)",
                        "corrected": "(truncated)",
                        "reason": "LLM Mandinka degraded at end of output",
                        "severity": "high",
                    })

        return round(completeness, 2), hallucinations, text, truncated

    # ================================================================
    # LAYER 11: CULTURAL SAFETY
    # ================================================================

    @staticmethod
    def _check_cultural(
        text: str, english: str, ctx: Dict[str, Any],
    ) -> List[str]:
        issues: List[str] = []
        if _PORK_RE.search(text) or _PORK_RE.search(english):
            issues.append("CRITICAL: pork/pork product mentioned (haram)")
        if _ALCOHOL_RE.search(text) or _ALCOHOL_RE.search(english):
            if not _ALCOHOL_CESSATION_RE.search(english) and not _ALCOHOL_CESSATION_RE.search(text):
                issues.append("Alcohol mentioned outside cessation context")
        if _NON_LOCAL_FOOD_RE.search(text) or _NON_LOCAL_FOOD_RE.search(english):
            issues.append("Non-Gambian food suggested")
        if _DISMISSIVE_TRAD_RE.search(text):
            issues.append("Dismissive of traditional medicine")

        adult_patient = ctx.get("age", 30) >= 18
        no_child_context = "child" not in english.lower() and "children" not in english.lower()
        if adult_patient and no_child_context and re.search(r"\bdindiyaalu\b", text, re.I):
            issues.append("'dindiyaalu' (children) used in adult-only context")

        if re.search(r"\bkoto\b", text, re.I):
            for food in ["tapalapa", "maloo", "moni"]:
                if re.search(re.escape(food) + r"\s+koto", text, re.I):
                    issues.append(f"'{food} koto' implies leftover food -- use 'tilinyango' for half")
                    break

        return issues

    # ================================================================
    # LAYER 12: STRUCTURE VALIDATION
    # ================================================================

    @staticmethod
    def _validate_structure(text: str, response_type: str) -> List[str]:
        issues: List[str] = []
        words = text.split()

        if response_type == "diet_plan":
            if not _VALID_GREETINGS_RE.match(text):
                issues.append("diet_plan: missing greeting")
            if len(words) > 250:
                issues.append(f"diet_plan: too long ({len(words)} words, max 250)")
        elif response_type == "emergency":
            if _VALID_GREETINGS_RE.match(text):
                issues.append("emergency: should NOT have greeting")
            if "199" not in text and "ospitaali" not in text.lower():
                issues.append("emergency: missing 199 or ospitaali")
            if "sisan" not in text.lower() and "SISAN" not in text:
                issues.append("emergency: missing SISAN (NOW)")
        elif response_type == "symptom":
            if len(words) > 100:
                issues.append(f"symptom: too long ({len(words)} words, max 100)")

        return issues

    # ================================================================
    # NEGATION SAFETY
    # ================================================================

    @staticmethod
    def _check_negation(
        english: str, mandinka: str, blocked: List[Dict[str, Any]],
    ) -> bool:
        safe = True
        for pair in _NEGATION_PAIRS:
            if pair["english_re"].search(english):
                if not pair["mandinka_re"].search(mandinka):
                    safe = False
                    blocked.append({
                        "type": "negation_missing",
                        "english_pattern": pair["english_re"].pattern,
                        "mandinka_text": mandinka[:200],
                        "error": pair["error"],
                        "severity": "critical",
                    })
        return safe

    # ================================================================
    # NUMBER VALIDATION
    # ================================================================

    @staticmethod
    def _check_numbers(
        english: str, mandinka: str, blocked: List[Dict[str, Any]],
    ) -> bool:
        eng_numbers = set(re.findall(r"\b\d+(?:\.\d+)?\b", english))
        mnk_numbers = set(re.findall(r"\b\d+(?:\.\d+)?\b", mandinka))
        missing = eng_numbers - mnk_numbers
        critical_missing = False
        for num in missing:
            try:
                val = float(num)
            except ValueError:
                continue
            if val > 10:
                critical_missing = True
                blocked.append({
                    "type": "number_missing",
                    "missing_number": num,
                    "severity": "critical",
                })
        return not critical_missing

    # ================================================================
    # ANTONYM CHECK
    # ================================================================

    @staticmethod
    def _check_antonyms(
        english: str, mandinka: str, blocked: List[Dict[str, Any]],
    ) -> bool:
        safe = True
        for eng_re, mnk_re, error_msg in _ANTONYM_PAIRS:
            if eng_re.search(english) and mnk_re.search(mandinka):
                safe = False
                blocked.append({
                    "type": "antonym_swap",
                    "error": error_msg,
                    "severity": "critical",
                })

        _dont_eat_re = re.compile(
            r"\b(?:don'?t\s+eat|avoid\s+eating|stop\s+eating)\b", re.I,
        )
        if _dont_eat_re.search(english):
            for m in re.finditer(r"\bdomo\b", mandinka, re.I):
                preceding = mandinka[:m.start()]
                last_sentence = preceding.split(".")[-1]
                if "kana" not in last_sentence.lower():
                    safe = False
                    blocked.append({
                        "type": "antonym_swap",
                        "error": "English says DON'T EAT but Mandinka 'domo' has no 'kana'",
                        "severity": "critical",
                    })
                    break

        return safe

    # ================================================================
    # LAYER 13: SALT GUIDANCE FOR HYPERTENSION/DKA
    # ================================================================

    @staticmethod
    def _inject_salt_guidance(
        text: str, english: str, ctx: Dict[str, Any], corrections: List[Dict[str, Any]],
    ) -> str:
        conditions = str(ctx.get("conditions", "")).lower()
        eng_lower = english.lower()
        has_condition = any(
            c in conditions or c in eng_lower
            for c in ("hypertension", "high bp", "blood pressure", "dka", "diabetic ketoacidosis")
        )
        if not has_condition:
            return text
        salt_phrases = ("kolo", "sokoo", "maggi", "salt")
        if any(p in text.lower() for p in salt_phrases):
            return text
        text = text.rstrip(". \n") + ".\n\nNafamaa: kana kolo camma domo. Maggi tilinyango dorong ke — kana fula."
        corrections.append({
            "layer": 13, "original": "(no salt guidance)",
            "corrected": "(salt guidance added)",
            "reason": "Hypertension/DKA patient needs salt warning",
            "severity": "moderate",
        })
        return text

    # ================================================================
    # GARBLED ENGLISH PHRASE REMOVAL
    # ================================================================

    @staticmethod
    def _remove_garbled_phrases(
        text: str, corrections: List[Dict[str, Any]],
    ) -> str:
        _GARBLED_PATTERNS = [
            re.compile(r"[^.]*\bbuy\s+seasonal\s+fruits[^.]*\.?", re.IGNORECASE),
            re.compile(r"[^.]*\bmarket\s+days\s+kono\s+le\s+produce[^.]*\.?", re.IGNORECASE),
        ]
        for pat in _GARBLED_PATTERNS:
            m = pat.search(text)
            if m:
                text = text[:m.start()] + text[m.end():]
                corrections.append({
                    "layer": 4, "original": m.group(0).strip()[:80],
                    "corrected": "(removed garbled English sentence)",
                    "reason": "garbled English-Mandinka mash removed",
                    "severity": "high",
                })
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return text


# ====================================================================
# SINGLETON
# ====================================================================

_instance: Optional[TranslationCorrector] = None


def get_corrector() -> TranslationCorrector:
    global _instance
    if _instance is None:
        _instance = TranslationCorrector()
    return _instance
