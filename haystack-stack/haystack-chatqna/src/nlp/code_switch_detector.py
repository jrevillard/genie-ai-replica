"""
Code-switch detector for Gambian multilingual text.
Identifies Mandinka, English, Wolof, and Fula segments in mixed-language input.
Target latency: < 3ms per message via pure dictionary lookup.
"""

from __future__ import annotations

import re
from typing import Any


MANDINKA_MARKERS: frozenset[str] = frozenset({
    # Pronouns
    "n", "i", "a", "ale", "alu", "ilu", "wo", "ate", "nte", "ite",
    "abe", "molu", "ŋ", "nle", "ile",

    # Verbs — core
    "be", "ye", "te", "naata", "taa", "ke", "domo", "miŋ", "doŋ",
    "sotoo", "maakoyi", "foola", "ñininkaa", "laa", "bali", "soto",
    "loŋ", "naa", "tara", "siyo", "jee", "moyi", "niyi", "diyaa",
    "koyi", "faa", "lafita", "buka", "keta", "muta", "tamba",
    "kumandi", "daani", "kañoo", "laara", "siita", "bori",
    "feŋ", "seyi", "banko", "laata", "sii", "safee", "jang",
    "jaŋ", "jeloo", "kalamutaa", "kumakanda", "daa",

    # Verb auxiliaries / aspect
    "si", "mu", "ka", "kata", "ñanta", "banta", "taata",
    "nanta", "sita", "yeta", "maŋ",

    # Nouns — body / health / daily life
    "kuŋ", "kono", "joloo", "furaŋo", "domoroo", "jii", "maloo",
    "dokitaroo", "ospitaali", "kendeyaa", "kuuraŋo", "sukkaroo",
    "baloo", "bala", "ñoo", "ñee", "tulo", "daa", "kuloo",
    "bulo", "sinkiro", "sinkiroo", "buuroo", "saatee", "dunia",
    "sanji", "tiliŋo", "suutoo", "wulaaroo", "koridaa",
    "kiliyaamoo", "dimi", "faroo", "jatoo", "teeroo",
    "tiloo", "karoo", "nyaamoo", "bantabaa", "kafoo",
    "alaakoo", "naafoo", "jamaano", "luuloo", "bantoo",
    "kewo", "musoo", "diŋo", "diŋolu", "musakeba",

    # Nouns — food / agriculture
    "maaloo", "kemo", "tuloo", "jamboo", "kolloo", "tiyoo",
    "saloo", "buntulaa", "suturoo", "suŋkutoo",

    # Connectors / postpositions
    "le", "la", "ti", "ni", "fo", "ani", "ye", "kaŋ", "ma",
    "lu", "loo", "too", "tee", "bulu", "koto", "daa", "saŋ",
    "kamma", "baake",

    # Particles / adverbs / intensifiers
    "dorong", "jaŋjaŋ", "doyaa", "camma", "baa", "kiliŋ",
    "fula", "saba", "naani", "luulu", "wooro", "woorowula",
    "seyi", "kononto", "taaŋ", "keme", "wuli",
    "haani", "haa", "baŋ", "nene", "ñaatoŋ", "ko",

    # Greetings / social
    "salaam", "kayira", "summo", "iwulaara", "isama", "iwurara",
    "tanante", "mbee", "kontaŋ", "ñaadii", "heera",
    "alaabaaroo", "abaraka", "jaarama",

    # Negation
    "kana", "man",

    # Question words
    "munne", "jumaa", "minte", "fee", "munle", "munna",
    "mintoo", "ñaadiila",

    # Demonstratives / determiners
    "niŋ", "meŋ", "naŋ", "jeŋ", "ñiŋ", "teŋ", "waŋ",
    "noŋ", "beeŋ", "wo", "doolu", "doo",

    # Time expressions
    "bilayi", "kunuŋ", "saama", "niiŋ", "teng", "waati",
    "londi", "saayiŋ", "kabiriŋ", "suutoo",

    # Medical / health vocabulary
    "baarakee", "juloo", "kurantee", "futoo", "kibaaroo",
    "safaaroo", "furaŋolu", "kendoo", "dinkee",
})

ENGLISH_MARKERS: frozenset[str] = frozenset({
    # Standard stopwords
    "the", "is", "am", "are", "was", "were", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "shall", "should", "may", "might", "must", "can", "could",
    "not", "no", "yes", "and", "or", "but", "if", "then",
    "than", "that", "this", "these", "those", "it", "its",
    "he", "she", "him", "her", "his", "we", "they", "them",
    "our", "your", "my", "me", "us", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about",
    "up", "out", "so", "what", "which", "who", "when", "where",
    "how", "why", "an", "each", "every", "all", "any", "few",
    "more", "most", "some", "such", "very", "just", "because",
    "before", "after", "during", "between", "through",
    "here", "there", "again", "once", "also", "too",
    "only", "same", "other", "new", "old", "much",

    # Medical terms
    "pain", "fever", "headache", "cough", "cold", "flu",
    "malaria", "diarrhea", "vomiting", "nausea", "rash",
    "infection", "pregnant", "pregnancy", "delivery",
    "blood", "urine", "stool", "test", "result", "clinic",
    "nurse", "treatment", "medication", "dose", "tablet",
    "injection", "vaccine", "immunization", "checkup",
    "referral", "emergency", "ambulance", "surgery",
    "diagnosis", "symptom", "chronic", "acute",
    "hypertension", "anemia", "hiv", "tb", "tuberculosis",
    "cholera", "typhoid", "asthma", "allergy",
    "dizzy", "dizziness", "swelling", "bleeding", "fatigue",
    "appetite", "weight", "breathing", "chest",
    "abdomen", "stomach", "kidney", "liver", "heart",
    "lungs", "brain", "skin", "bone", "muscle",
    "prenatal", "postnatal", "antenatal", "breastfeeding",
    "nutrition", "dehydration", "oral", "rehydration",
    "supplement", "vitamin", "iron", "folate", "zinc",
    "antibiotic", "antimalarial", "paracetamol", "ibuprofen",
    "contraception", "family", "planning", "counseling",
    "screening", "laboratory", "pharmacy", "prescription",
    "insurance", "appointment", "consultation",
    "feeling", "better", "worse", "sick", "healthy",
    "normal", "abnormal", "positive", "negative",
})

SHARED_BORROWED: frozenset[str] = frozenset({
    "okay", "ok", "doctor", "hospital", "medicine", "sugar",
    "pressure", "diabetes", "phone", "radio", "number",
    "time", "police", "school", "market", "money", "bank",
    "motor", "car", "bus", "rice", "tea", "coffee",
    "government", "president", "minister", "office",
    "computer", "internet", "football", "video",
})

WOLOF_MARKERS: frozenset[str] = frozenset({
    "naka", "def", "jamm", "rek", "rekk", "degg", "baal",
    "waaw", "deedeet", "ndax", "lii", "loolu", "nit",
    "jigeen", "goor", "xale", "doom", "yaay", "baay",
    "sa", "sama", "sunu", "seen", "ci", "ak", "bu",
    "nanga", "dafa", "mungi", "dinaa", "benn", "juroom",
    "naar", "nett", "neent", "fukk", "teemeer", "junni",
    "waa", "keur", "ker", "toubab", "ndank", "yalla",
    "inshallah", "yow", "man", "moom", "nun", "leen",
})

WOLOF_PHRASES: frozenset[str] = frozenset({
    "waa keur", "ndank ndank", "naka nga def",
    "jamm nga am", "na nga def",
})

FULA_MARKERS: frozenset[str] = frozenset({
    "jam", "tan", "tana", "wala", "ko", "mi", "mo",
    "en", "be", "haa", "nde", "ndi", "ngal", "ngol",
    "dum", "nii", "fof", "sago", "alla", "innde",
    "debbo", "gorko", "cukalel", "baaba", "yumma",
    "nyaamde", "yarde", "helde", "jaabde", "waade",
    "yiide", "humpude", "wallude", "hollide", "seedee",
    "cellal", "nyaw", "safaara", "lewru", "naange",
    "ndiyam", "kosam", "nyiiri", "mburu", "liidi",
    "teddungal", "jaraama", "useko", "acca", "onnhon",
    "baawo", "yeeso", "les", "dow", "nder",
})

FULA_PHRASES: frozenset[str] = frozenset({
    "no mbaddaa", "tana wala", "jam tan", "jam waali",
    "a jaraama", "on jaraama", "no mbaaltaa",
})

_AMBIGUOUS_SINGLE_CHAR: frozenset[str] = frozenset({
    "i", "a",
})

MANDINKA_MEDICAL_COMPOUNDS: list[str] = [
    "kuŋ dimi", "kono dimi", "jii bula", "furaŋo domo",
    "kendeyaa kee", "dimi baa", "sinkiro dimi", "joloo dimi",
    "bulo dimi", "kuloo dimi", "tulo dimi", "ñoo dimi",
    "daa dimi", "faro dimi", "kurantee taa",
]

ENGLISH_MEDICAL_TERMS: frozenset[str] = frozenset({
    "pain", "fever", "headache", "cough", "cold", "flu",
    "malaria", "diarrhea", "vomiting", "nausea", "rash",
    "infection", "pregnant", "pregnancy", "blood", "urine",
    "test", "clinic", "nurse", "treatment", "medication",
    "injection", "vaccine", "checkup", "referral", "emergency",
    "diagnosis", "symptom", "hypertension", "anemia",
    "dizzy", "dizziness", "swelling", "bleeding", "fatigue",
    "breathing", "chest", "stomach", "kidney", "liver",
    "heart", "asthma", "allergy", "diabetes", "cholera",
    "typhoid", "tuberculosis", "dehydration", "malnutrition",
})

_MANDINKA_CHAR_RE = re.compile(r"[ŋñɲ]")
_DOUBLE_VOWEL_RE = re.compile(r"(aa|ee|ii|oo|uu)")


class CodeSwitchDetector:

    __slots__ = ()

    def detect(self, text: str) -> dict[str, Any]:
        if not text or not text.strip():
            return self._empty_result()

        lower = text.lower().strip()

        found_mandinka_medical: list[str] = []
        for compound in MANDINKA_MEDICAL_COMPOUNDS:
            if compound in lower:
                found_mandinka_medical.append(compound)

        found_english_medical: list[str] = []

        phrase_wolof = sum(1 for p in WOLOF_PHRASES if p in lower)
        phrase_fula = sum(1 for p in FULA_PHRASES if p in lower)

        tokens = lower.split()
        if not tokens:
            return self._empty_result()

        scored: list[tuple[str, str]] = []
        wolof_count = 0
        fula_count = 0
        mandinka_count = 0
        english_count = 0
        shared_count = 0

        for token in tokens:
            clean = token.strip(".,;:!?\"'()-")
            if not clean:
                scored.append((token, "unknown"))
                continue

            if clean in SHARED_BORROWED:
                scored.append((token, "shared"))
                shared_count += 1
                continue

            if clean in WOLOF_MARKERS:
                scored.append((token, "wolof"))
                wolof_count += 1
                continue

            if clean in FULA_MARKERS:
                scored.append((token, "fula"))
                fula_count += 1
                continue

            if clean in MANDINKA_MARKERS:
                if clean in _AMBIGUOUS_SINGLE_CHAR:
                    scored.append((token, "shared"))
                    shared_count += 1
                else:
                    scored.append((token, "mandinka"))
                    mandinka_count += 1
                continue

            if clean in ENGLISH_MARKERS:
                scored.append((token, "english"))
                english_count += 1
                if clean in ENGLISH_MEDICAL_TERMS:
                    found_english_medical.append(clean)
                continue

            if _MANDINKA_CHAR_RE.search(clean) or _DOUBLE_VOWEL_RE.search(clean):
                scored.append((token, "mandinka"))
                mandinka_count += 1
                continue

            scored.append((token, "unknown"))

        wolof_score = wolof_count + phrase_wolof * 2
        fula_score = fula_count + phrase_fula * 2

        override_lang: str | None = None
        if wolof_score > mandinka_count and wolof_score > fula_score:
            override_lang = "wolof"
        elif fula_score > mandinka_count and fula_score > wolof_score:
            override_lang = "fula"

        if override_lang:
            remapped: list[tuple[str, str]] = []
            for tok, lang in scored:
                if lang == "mandinka":
                    remapped.append((tok, override_lang))
                else:
                    remapped.append((tok, lang))
            scored = remapped

        segments = self._build_segments(scored)

        total = len(tokens)
        effective_mandinka = sum(
            1 for _, lang in scored if lang == "mandinka"
        )
        effective_english = sum(
            1 for _, lang in scored if lang == "english"
        )

        if total > 0:
            mandinka_ratio = round(effective_mandinka / total, 3)
        else:
            mandinka_ratio = 0.0

        if mandinka_ratio > 0.7:
            dominant = "mandinka"
        elif mandinka_ratio < 0.3:
            if override_lang and not effective_english:
                dominant = override_lang
            else:
                dominant = "english"
        else:
            dominant = "mixed"

        if override_lang and dominant in ("english", "mixed"):
            override_count = sum(1 for _, lang in scored if lang == override_lang)
            if override_count / total > 0.5:
                dominant = override_lang

        lang_set = {lang for _, lang in scored if lang not in ("unknown", "shared")}
        code_switch_count = 0
        prev_lang = None
        for _, lang in scored:
            if lang in ("unknown", "shared"):
                continue
            if prev_lang and lang != prev_lang:
                code_switch_count += 1
            prev_lang = lang

        is_code_switched = len(lang_set) > 1

        return {
            "dominant_language": dominant,
            "mandinka_ratio": mandinka_ratio,
            "segments": segments,
            "is_code_switched": is_code_switched,
            "code_switch_count": code_switch_count,
            "medical_terms": {
                "mandinka": found_mandinka_medical,
                "english": found_english_medical,
            },
        }

    def _build_segments(
        self, scored: list[tuple[str, str]]
    ) -> list[dict[str, Any]]:
        if not scored:
            return []

        segments: list[dict[str, Any]] = []
        current_lang = scored[0][1]
        current_tokens: list[str] = [scored[0][0]]

        for token, lang in scored[1:]:
            effective = lang
            if lang in ("unknown", "shared"):
                effective = current_lang

            if effective == current_lang:
                current_tokens.append(token)
            else:
                segments.append({
                    "text": " ".join(current_tokens),
                    "language": current_lang,
                    "tokens": len(current_tokens),
                })
                current_lang = effective
                current_tokens = [token]

        segments.append({
            "text": " ".join(current_tokens),
            "language": current_lang,
            "tokens": len(current_tokens),
        })

        return segments

    @staticmethod
    def _empty_result() -> dict[str, Any]:
        return {
            "dominant_language": "unknown",
            "mandinka_ratio": 0.0,
            "segments": [],
            "is_code_switched": False,
            "code_switch_count": 0,
            "medical_terms": {"mandinka": [], "english": []},
        }
