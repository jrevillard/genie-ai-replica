"""Mandinka Temporal NLP v5.1 — comprehensive temporal expression handler.

Handles days, months, seasons, time of day, prayer times, Islamic calendar,
farming calendar, relative time, numeric durations, and the critical ng/ŋ
character normalization that causes most LLM day-name errors.

13-step pipeline, wired into TranslationCorrector as Layer 2.5.
Target latency: < 15ms.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

__all__ = ["MandinkaTemporal", "NgHandler", "get_temporal"]

logger = logging.getLogger(__name__)


# ====================================================================
# SECTION 10: NG CHARACTER HANDLER
# ====================================================================

class NgHandler:
    """Smart ŋ (eng) character normalization.

    LLMs output 'ng' instead of 'ŋ' in Mandinka words. This handler
    converts contextually: Mandinka words get ŋ, English words keep ng.
    """

    TRUNCATION_FIXES: Dict[str, str] = {
        "teneng": "Teneŋo",
        "Teneng": "Teneŋo",
        "TENENG": "Teneŋo",
        "tenengoo": "Teneŋo",
        "tenengo": "Teneŋo",
        "teningo": "Teneŋo",
        "tenenko": "Teneŋo",
        "tilinyang": "tiliyaŋo",
        "tilinyango": "tiliyaŋo",
        "furang": "furaŋo",
        "furango": "furaŋo",
        "luung": "luŋo",
        "lungo": "luŋo",
        "saang": "saŋo",
        "sango": "saŋo",
        "kankulung": "kankuluŋ",
        "sengo": "seŋo",
        "dorong": "doriŋ",
        "kilingang": "kiliyaŋ",
    }

    MANDINKA_NG_WORDS: FrozenSet[str] = frozenset({
        "teneŋo", "tiliyaŋo", "luŋo", "luŋolu",
        "saŋo", "furaŋo", "kankuluŋ", "seŋo",
        "seŋolu", "doriŋ", "kiliyaŋ",
        "baŋ", "laŋ", "jaŋjaŋ", "doyaa",
        "saŋ", "taŋ", "kiliŋ",
        "saŋ-kiliŋ", "saŋ-fula", "saŋ-saba",
        "saŋ-naani", "saŋ-luulu", "saŋ-wooro",
        "saŋ-worowula", "saŋ-seyi", "saŋ-kononto",
        "saŋ-taŋ", "saŋ-taŋ-ni-kiliŋ",
        "saŋ-taŋ-ni-fula",
        "muwaŋ", "muwaŋ-ni-taŋ",
        "muwaŋ-ni-luulu", "muwaŋ-fula-ni-luulu",
        "muwaŋ-saba",
        "tiliŋ-waxtoo", "saŋ-waxtoo",
        "sansaŋ-waxtoo", "kaloo-waxtoo",
    })

    ENGLISH_NG_WORDS: FrozenSet[str] = frozenset({
        "morning", "evening", "cooking", "walking", "drinking",
        "eating", "sleeping", "feeling", "during", "managing",
        "long", "strong", "along", "among", "king", "ring",
        "nursing", "during", "living", "working", "taking",
        "making", "coming", "going", "looking", "nothing",
        "something", "anything", "everything", "sing", "bring",
        "spring", "string", "thing", "young", "lung", "hang",
        "bang", "gang", "rang", "sang", "wrong",
        "moringa", "mango", "tango", "bingo", "lingo", "flamingo",
    })

    _MANDINKA_ENDINGS = ("ngo", "nga", "ngi", "ngolu", "ngoo")

    def normalize_ng(self, text: str) -> Tuple[str, int]:
        """Convert ng→ŋ in Mandinka words, keep ng in English words.

        Returns (normalized_text, fix_count).
        """
        tokens = text.split()
        fixes = 0
        result = []

        for tok in tokens:
            md_pre, inner, md_suf = _strip_markdown(tok)
            punct_suf = ""
            while inner and inner[-1] in ".,;:!?\"')":
                punct_suf = inner[-1] + punct_suf
                inner = inner[:-1]

            lower = inner.lower()

            if "ng" not in lower or "ŋ" in lower:
                result.append(tok)
                continue

            if lower in self.ENGLISH_NG_WORDS:
                result.append(tok)
                continue

            converted = inner.replace("ng", "ŋ").replace("Ng", "Ŋ").replace("NG", "Ŋ")
            converted_lower = converted.lower()

            if converted_lower in self.MANDINKA_NG_WORDS:
                result.append(md_pre + converted + punct_suf + md_suf)
                fixes += 1
                continue

            if any(lower.endswith(e) for e in self._MANDINKA_ENDINGS):
                result.append(md_pre + converted + punct_suf + md_suf)
                fixes += 1
                continue

            result.append(tok)

        return " ".join(result), fixes

    def fix_truncated_mandinka_words(self, text: str) -> Tuple[str, int]:
        """Fix truncated Mandinka words like Teneng→Teneŋo."""
        fixes = 0
        for wrong, correct in self.TRUNCATION_FIXES.items():
            pat = re.compile(r"\b" + re.escape(wrong) + r"\b", re.IGNORECASE)
            if pat.search(text):
                text = pat.sub(correct, text)
                fixes += 1
        return text, fixes


# ====================================================================
# SECTION 1-9, 11: MAIN TEMPORAL CLASS
# ====================================================================

class MandinkaTemporal:
    """Full temporal NLP pipeline for Mandinka text."""

    # ── SECTION 1: DAY NAMES ───────────────────────────────────────

    DAYS_ENGLISH_TO_MANDINKA: Dict[str, str] = {
        "monday": "Teneŋo",
        "tuesday": "Talaato",
        "wednesday": "Araba",
        "thursday": "Alamisa",
        "friday": "Juma",
        "saturday": "Sibiti",
        "sunday": "Aladoo",
        "mon": "Teneŋo",
        "tue": "Talaato",
        "tues": "Talaato",
        "wed": "Araba",
        "thu": "Alamisa",
        "thur": "Alamisa",
        "thurs": "Alamisa",
        "fri": "Juma",
        "sat": "Sibiti",
        "sun": "Aladoo",
    }

    DAYS_MANDINKA_NORMALIZE: Dict[str, str] = {
        "teneng": "Teneŋo",
        "tenengoo": "Teneŋo",
        "tenengo": "Teneŋo",
        "teneno": "Teneŋo",
        "teneŋ": "Teneŋo",
        "tenenko": "Teneŋo",
        "teningo": "Teneŋo",
        "talata": "Talaato",
        "talaata": "Talaato",
        "talato": "Talaato",
        "arabo": "Araba",
        "arabaa": "Araba",
        "aramisaa": "Alamisa",
        "aramisa": "Alamisa",
        "alamisaa": "Alamisa",
        "alamissa": "Alamisa",
        "jumaa": "Juma",
        "arijuma": "Juma",
        "jummah": "Juma",
        "jumaah": "Juma",
        "sibitii": "Sibiti",
        "sibite": "Sibiti",
        "alaadoo": "Aladoo",
        "alahad": "Aladoo",
        "dimasoo": "Aladoo",
        "dimaasoo": "Aladoo",
        "lahadi": "Aladoo",
    }

    # ── SECTION 2: MONTH NAMES ─────────────────────────────────────

    MONTHS_ENGLISH_TO_MANDINKA: Dict[str, str] = {
        "january": "Saŋ-kiliŋ",
        "february": "Saŋ-fula",
        "march": "Saŋ-saba",
        "april": "Saŋ-naani",
        "may": "Saŋ-luulu",
        "june": "Saŋ-wooro",
        "july": "Saŋ-worowula",
        "august": "Saŋ-seyi",
        "september": "Saŋ-kononto",
        "october": "Saŋ-taŋ",
        "november": "Saŋ-taŋ-ni-kiliŋ",
        "december": "Saŋ-taŋ-ni-fula",
        "jan": "Saŋ-kiliŋ",
        "feb": "Saŋ-fula",
        "mar": "Saŋ-saba",
        "apr": "Saŋ-naani",
        "jun": "Saŋ-wooro",
        "jul": "Saŋ-worowula",
        "aug": "Saŋ-seyi",
        "sep": "Saŋ-kononto",
        "oct": "Saŋ-taŋ",
        "nov": "Saŋ-taŋ-ni-kiliŋ",
        "dec": "Saŋ-taŋ-ni-fula",
    }

    ISLAMIC_MONTHS: Dict[str, str] = {
        "muharram": "Muharram",
        "safar": "Safar",
        "rabi ul-awwal": "Gammo-kari",
        "ramadan": "Sunkaroo-karoo",
        "shawwal": "Koriteh-kari",
        "dhul hijjah": "Tobaski-kari",
    }

    # ── SECTION 3: SEASONS ─────────────────────────────────────────

    SEASONS: Dict[str, Dict[str, Any]] = {
        "rainy season": {
            "mandinka": "saŋ-waxtoo",
            "health_context": "malaria peak, flooding, medication storage risk",
        },
        "wet season": {"mandinka": "saŋ-waxtoo"},
        "rains": {"mandinka": "saŋ-waxtoo"},
        "dry season": {
            "mandinka": "tiliŋ-waxtoo",
            "health_context": "heat stroke risk, dehydration, dust/respiratory",
        },
        "harmattan": {"mandinka": "tiliŋ-waxtoo"},
        "planting season": {"mandinka": "sansaŋ-waxtoo"},
        "sowing": {"mandinka": "sansaŋ-waxtoo"},
        "growing season": {"mandinka": "koo-waxtoo"},
        "harvest season": {
            "mandinka": "kaloo-waxtoo",
            "health_context": "heavy labor, diabetic foot injury risk",
        },
        "harvest time": {"mandinka": "kaloo-waxtoo"},
    }

    # ── SECTION 4: TIME OF DAY ─────────────────────────────────────

    TIME_OF_DAY: Dict[str, str] = {
        "this morning": "bii suba",
        "every morning": "suba bee",
        "morning": "suba",
        "afternoon": "tiloo-tiloo",
        "evening": "suuto",
        "tonight": "bii suwo",
        "night": "suwo",
        "midnight": "suwo-tiliŋo",
        "dawn": "subaa-daadaa",
        "sunrise": "tileelo boorta",
        "sunset": "tileelo jiita",
        "after fajr": "subaa-saliioo kooma",
        "before fajr": "subaa-saliioo ñaa",
        "after dhuhr": "salii-fuloo kooma",
        "before dhuhr": "salii-fuloo ñaa",
        "after asr": "salii-saboo kooma",
        "after maghrib": "futiroo kooma",
        "after isha": "salii-naaniioo kooma",
        "before maghrib": "futiroo ñaa",
        "during prayer": "saliioo waxtoo le",
        "attaya time": "attaayaa waxtoo",
        "bantaba time": "bantabaa waxtoo",
        "lumo time": "lumo waxtoo",
        "market day": "lumo luŋo",
        "cooking time": "domoroo-tiyoo waxtoo",
    }

    # ── SECTION 5: RELATIVE TIME ───────────────────────────────────

    RELATIVE_TIME: Dict[str, str] = {
        "day before yesterday": "arjunaŋ",
        "day after tomorrow": "arjunaŋ",
        "yesterday": "kunoŋ",
        "last week": "haftoo temboo",
        "last month": "karoo temboo",
        "last year": "saŋ temboo",
        "2 days ago": "luŋ fula tembta",
        "3 days ago": "luŋ saba tembta",
        "a few days ago": "luŋ daani tembta",
        "today": "bii",
        "now": "sisan",
        "right now": "sisan-sisan",
        "this week": "bii haftoo",
        "this month": "bii karoo",
        "tomorrow": "siniŋ",
        "next week": "haftoo naatoo",
        "next month": "karoo naatoo",
        "in 2 days": "luŋ fula kono",
        "in 3 days": "luŋ saba kono",
        "in a week": "haftoo kiliŋ kono",
        "for 1 week": "haftoo kiliŋ kono",
        "for 2 weeks": "haftoo fula kono",
        "for 1 month": "karoo kiliŋ kono",
        "every day": "luŋ bee",
        "every week": "haftoo bee",
        "every month": "karoo bee",
        "daily": "luŋ bee",
        "weekly": "haftoo bee",
        "twice a day": "siiyaa fula luŋ kono",
        "three times a day": "siiyaa saba luŋ kono",
        "once a week": "siiyaa kiliŋ haftoo kono",
    }

    # ── SECTION 6: NUMERIC TIME ────────────────────────────────────

    MANDINKA_NUMBERS: Dict[int, str] = {
        1: "kiliŋ", 2: "fula", 3: "saba", 4: "naani",
        5: "luulu", 6: "wooro", 7: "worowula", 8: "seyi",
        9: "kononto", 10: "taŋ",
        11: "taŋ-ni-kiliŋ", 12: "taŋ-ni-fula",
        13: "taŋ-ni-saba", 14: "taŋ-ni-naani",
        15: "taŋ-ni-luulu", 20: "muwaŋ",
        25: "muwaŋ-ni-luulu", 30: "muwaŋ-ni-taŋ",
        45: "muwaŋ-fula-ni-luulu",
        60: "muwaŋ-saba",
    }

    TIME_UNITS: Dict[str, str] = {
        "minutes": "miniti",
        "minute": "miniti",
        "hours": "waxtoo",
        "hour": "waxtoo",
        "days": "luŋolu",
        "day": "luŋo",
        "weeks": "haftoolu",
        "week": "haftoo",
        "months": "karoolu",
        "month": "karoo",
        "years": "saŋolu",
        "year": "saŋo",
    }

    # ── SECTION 7: RELIGIOUS EVENTS ────────────────────────────────

    RELIGIOUS_EVENTS: Dict[str, Dict[str, Any]] = {
        "ramadan": {
            "mandinka": "Sunkaroo-karoo",
            "related": {
                "suhoor": "suuroo",
                "iftar": "futiroo",
                "tarawih": "tarawiioo",
                "eid al-fitr": "Koriteh",
                "fasting": "sunkaroo",
                "break the fast": "futiri",
            },
        },
        "eid al-adha": {"mandinka": "Tobaski"},
        "eid ul-adha": {"mandinka": "Tobaski"},
        "tobaski": {"mandinka": "Tobaski"},
        "eid al-fitr": {"mandinka": "Koriteh"},
        "eid ul-fitr": {"mandinka": "Koriteh"},
        "koriteh": {"mandinka": "Koriteh"},
        "mawlid": {"mandinka": "Gammo"},
        "maulid": {"mandinka": "Gammo"},
        "milad un-nabi": {"mandinka": "Gammo"},
        "gammo": {"mandinka": "Gammo"},
    }

    # ── SECTION 8: LUMO SCHEDULE ───────────────────────────────────

    LUMO_SCHEDULE: Dict[str, Dict[str, str]] = {
        "brikama": {"day": "Juma", "english_day": "Friday"},
        "serekunda": {"day": "Luŋ bee", "english_day": "Daily"},
        "farafenni": {"day": "Aladoo", "english_day": "Sunday"},
        "basse": {"day": "Talaato", "english_day": "Tuesday"},
        "bansang": {"day": "Sibiti", "english_day": "Saturday"},
        "kerewan": {"day": "Araba", "english_day": "Wednesday"},
        "soma": {"day": "Teneŋo", "english_day": "Monday"},
    }

    # ── SECTION 9: COMPOUND TEMPORAL ───────────────────────────────

    COMPOUND_TEMPORAL: Dict[str, str] = {
        "every monday and wednesday": "Teneŋo bee ani Araba bee",
        "every tuesday and thursday": "Talaato bee ani Alamisa bee",
        "weekdays": "Teneŋo fo Juma",
        "weekends": "Sibiti ani Aladoo",
        "the weekend": "Sibiti ani Aladoo",
        "all week": "haftoo bee kono",
        "year-round": "saŋo bee kono",
        "all year": "saŋo bee kono",
        "24 hours": "waxtoo muwaŋ-ni-naani",
    }

    # ── RANGE CONNECTOR ────────────────────────────────────────────

    RANGE_CONNECTOR_MANDINKA = "fo"

    # ================================================================

    def __init__(self) -> None:
        self.ng_handler = NgHandler()
        self._compile_patterns()

    def _compile_patterns(self) -> None:
        """Pre-compile regex patterns for performance."""

        # Day name patterns (longest first to avoid partial matches)
        self._day_en_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.DAYS_ENGLISH_TO_MANDINKA, key=len, reverse=True):
            pat = re.compile(
                r"(?P<pre>[*_]{0,2})\b" + re.escape(eng) + r"\b(?P<post>[*_]{0,2})",
                re.IGNORECASE,
            )
            self._day_en_patterns.append((pat, self.DAYS_ENGLISH_TO_MANDINKA[eng]))

        # Day normalization patterns
        self._day_norm_patterns: List[Tuple[re.Pattern, str]] = []
        for wrong in sorted(self.DAYS_MANDINKA_NORMALIZE, key=len, reverse=True):
            pat = re.compile(
                r"\b" + re.escape(wrong) + r"\b", re.IGNORECASE,
            )
            self._day_norm_patterns.append((pat, self.DAYS_MANDINKA_NORMALIZE[wrong]))

        # Month patterns (longest first)
        self._month_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.MONTHS_ENGLISH_TO_MANDINKA, key=len, reverse=True):
            pat = re.compile(
                r"(?P<pre>[*_]{0,2})\b" + re.escape(eng) + r"\b(?P<post>[*_]{0,2})",
                re.IGNORECASE,
            )
            self._month_patterns.append((pat, self.MONTHS_ENGLISH_TO_MANDINKA[eng]))

        # Islamic month patterns
        self._islamic_month_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.ISLAMIC_MONTHS, key=len, reverse=True):
            pat = re.compile(
                r"\b" + re.escape(eng) + r"\b", re.IGNORECASE,
            )
            self._islamic_month_patterns.append((pat, self.ISLAMIC_MONTHS[eng]))

        # Time of day (longest first)
        self._time_of_day_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.TIME_OF_DAY, key=len, reverse=True):
            pat = re.compile(
                r"\b" + re.escape(eng) + r"\b", re.IGNORECASE,
            )
            self._time_of_day_patterns.append((pat, self.TIME_OF_DAY[eng]))

        # Relative time (longest first)
        self._relative_time_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.RELATIVE_TIME, key=len, reverse=True):
            pat = re.compile(
                r"\b" + re.escape(eng) + r"\b", re.IGNORECASE,
            )
            self._relative_time_patterns.append((pat, self.RELATIVE_TIME[eng]))

        # Compound temporal (longest first)
        self._compound_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.COMPOUND_TEMPORAL, key=len, reverse=True):
            pat = re.compile(
                r"\b" + re.escape(eng) + r"\b", re.IGNORECASE,
            )
            self._compound_patterns.append((pat, self.COMPOUND_TEMPORAL[eng]))

        # Season patterns (longest first)
        self._season_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.SEASONS, key=len, reverse=True):
            pat = re.compile(
                r"\b" + re.escape(eng) + r"\b", re.IGNORECASE,
            )
            self._season_patterns.append((pat, self.SEASONS[eng]["mandinka"]))

        # Religious event patterns (longest first, include related terms)
        self._religious_patterns: List[Tuple[re.Pattern, str]] = []
        for eng in sorted(self.RELIGIOUS_EVENTS, key=len, reverse=True):
            pat = re.compile(
                r"\b" + re.escape(eng) + r"\b", re.IGNORECASE,
            )
            self._religious_patterns.append((pat, self.RELIGIOUS_EVENTS[eng]["mandinka"]))
            related = self.RELIGIOUS_EVENTS[eng].get("related", {})
            for rel_eng in sorted(related, key=len, reverse=True):
                rp = re.compile(r"\b" + re.escape(rel_eng) + r"\b", re.IGNORECASE)
                self._religious_patterns.append((rp, related[rel_eng]))

        # Numeric time: "N minute(s)/hour(s)/etc."
        units_alt = "|".join(re.escape(u) for u in sorted(self.TIME_UNITS, key=len, reverse=True))
        self._numeric_time_re = re.compile(
            r"\b(\d{1,3})\s+(" + units_alt + r")\b", re.IGNORECASE,
        )

        # Ordinal suffix stripper: "25th", "1st", "2nd", "3rd"
        self._ordinal_re = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)\b", re.IGNORECASE)

        # Range patterns: "X to/through/until Y"
        self._range_connector_re = re.compile(
            r"\b(?:to|through|until)\b", re.IGNORECASE,
        )
        self._from_re = re.compile(r"\bfrom\s+", re.IGNORECASE)

        # All known temporal English terms for range detection
        self._all_temporal_english: Set[str] = set()
        self._all_temporal_english.update(self.DAYS_ENGLISH_TO_MANDINKA.keys())
        self._all_temporal_english.update(self.MONTHS_ENGLISH_TO_MANDINKA.keys())
        self._all_temporal_english.update(k for k in self.TIME_OF_DAY if " " not in k)

    # ================================================================
    # SECTION 11: MAIN PROCESSING PIPELINE
    # ================================================================

    def process_temporal(
        self, text: str, language_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Full 13-step temporal NLP pipeline.

        Returns dict with processed_text, replacements, entities, stats.
        """
        t0 = time.perf_counter()
        replacements: List[Dict[str, str]] = []
        entities: List[Dict[str, Any]] = []
        ng_fixes = 0

        # Step 1: ŋ normalization
        text, nf = self.ng_handler.normalize_ng(text)
        ng_fixes += nf

        # Step 2: Fix truncated Mandinka words
        text, tf = self.ng_handler.fix_truncated_mandinka_words(text)
        ng_fixes += tf

        # Step 3: Normalize misspelled Mandinka day names
        text, r = self._normalize_day_spellings(text)
        replacements.extend(r)

        # Step 4: Replace English day names (longest match first)
        text, r, e = self._replace_english_days(text)
        replacements.extend(r)
        entities.extend(e)

        # Step 5: Replace English month names
        text, r, e = self._replace_english_months(text)
        replacements.extend(r)
        entities.extend(e)

        # Step 6: Replace time-of-day expressions
        text, r = self._replace_time_of_day(text)
        replacements.extend(r)

        # Step 7: Replace relative time expressions
        text, r = self._replace_relative_time(text)
        replacements.extend(r)

        # Step 8: Convert numeric time ("30 minutes" → Mandinka)
        text, r = self._convert_numeric_time(text)
        replacements.extend(r)

        # Step 9: Replace range expressions ("X to Y" → "X fo Y")
        text, r, e = self._replace_ranges(text)
        replacements.extend(r)
        entities.extend(e)

        # Step 10: Replace compound temporal ("weekends" etc.)
        text, r = self._replace_compounds(text)
        replacements.extend(r)

        # Step 11: Replace season names
        text, r = self._replace_seasons(text)
        replacements.extend(r)

        # Step 12: Replace religious events
        text, r = self._replace_religious(text)
        replacements.extend(r)

        # Step 13: Final ŋ verification pass
        text, nf2 = self.ng_handler.normalize_ng(text)
        ng_fixes += nf2

        # Clean up double spaces
        text = re.sub(r"  +", " ", text).strip()

        elapsed = round((time.perf_counter() - t0) * 1000, 2)

        return {
            "processed_text": text,
            "replacements": replacements,
            "temporal_entities_found": entities,
            "ng_fixes_applied": ng_fixes,
            "processing_time_ms": elapsed,
        }

    # ================================================================
    # PIPELINE STEP METHODS
    # ================================================================

    def _normalize_day_spellings(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]]]:
        """Step 3: Normalize misspelled Mandinka day names to canonical form."""
        reps = []
        for pat, correct in self._day_norm_patterns:
            m = pat.search(text)
            if m:
                original = m.group(0)
                text = pat.sub(correct, text)
                reps.append({
                    "original": original, "replaced": correct,
                    "type": "day_normalize",
                })
        return text, reps

    def _replace_english_days(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]], List[Dict[str, Any]]]:
        """Step 4: Replace English day names → Mandinka."""
        reps = []
        entities = []
        for pat, mandinka in self._day_en_patterns:
            m = pat.search(text)
            while m:
                original = m.group(0)
                pre = m.group("pre")
                post = m.group("post")
                replacement = pre + mandinka + post
                text = text[:m.start()] + replacement + text[m.end():]
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "day_name",
                })
                entities.append({
                    "text": mandinka, "type": "day_name",
                    "english": original.strip("*_"),
                })
                m = pat.search(text, m.start() + len(replacement))
        return text, reps, entities

    def _replace_english_months(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]], List[Dict[str, Any]]]:
        """Step 5: Replace English month names → Mandinka."""
        reps = []
        entities = []

        # Islamic months first (longer names)
        for pat, mandinka in self._islamic_month_patterns:
            m = pat.search(text)
            if m:
                original = m.group(0)
                text = pat.sub(mandinka, text)
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "islamic_month",
                })
                entities.append({
                    "text": mandinka, "type": "islamic_month",
                    "english": original,
                })

        # Western months
        for pat, mandinka in self._month_patterns:
            m = pat.search(text)
            while m:
                original = m.group(0)
                pre = m.group("pre")
                post = m.group("post")
                replacement = pre + mandinka + post
                text = text[:m.start()] + replacement + text[m.end():]
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "month_name",
                })
                entities.append({
                    "text": mandinka, "type": "month_name",
                    "english": original.strip("*_"),
                })
                m = pat.search(text, m.start() + len(replacement))
        return text, reps, entities

    def _replace_time_of_day(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]]]:
        """Step 6: Replace time-of-day expressions."""
        reps = []
        for pat, mandinka in self._time_of_day_patterns:
            m = pat.search(text)
            if m:
                original = m.group(0)
                text = pat.sub(mandinka, text)
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "time_of_day",
                })
        return text, reps

    def _replace_relative_time(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]]]:
        """Step 7: Replace relative time expressions."""
        reps = []
        for pat, mandinka in self._relative_time_patterns:
            m = pat.search(text)
            if m:
                original = m.group(0)
                text = pat.sub(mandinka, text)
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "relative_time",
                })
        return text, reps

    def _convert_numeric_time(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]]]:
        """Step 8: Convert 'N unit' → Mandinka ('miniti muwaŋ-ni-taŋ')."""
        reps = []

        # Strip ordinal suffixes first: "25th" → "25"
        text = self._ordinal_re.sub(r"\1", text)

        def _replace_numeric(m: re.Match) -> str:
            num_str = m.group(1)
            unit_eng = m.group(2).lower()
            num = int(num_str)
            unit_mandinka = self.TIME_UNITS.get(unit_eng, unit_eng)

            num_mandinka = self.MANDINKA_NUMBERS.get(num)
            if num_mandinka:
                result = f"{unit_mandinka} {num_mandinka}"
            else:
                result = f"{unit_mandinka} {num_str}"

            reps.append({
                "original": m.group(0), "replaced": result,
                "type": "numeric_time",
            })
            return result

        text = self._numeric_time_re.sub(_replace_numeric, text)
        return text, reps

    def _replace_ranges(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]], List[Dict[str, Any]]]:
        """Step 9: Replace 'X to Y' range expressions → 'X fo Y'.

        Detects patterns like 'Monday to Wednesday' or
        'from morning to evening' and converts both temporal
        terms plus the connector.
        """
        reps = []
        entities = []

        # Strip "from" prefix in "from X to Y"
        text = self._from_re.sub("", text)

        # Build a combined lookup of all temporal terms (already converted)
        all_mandinka_days = set(self.DAYS_ENGLISH_TO_MANDINKA.values())
        all_mandinka_months = set(self.MONTHS_ENGLISH_TO_MANDINKA.values())
        all_mandinka_time = set(self.TIME_OF_DAY.values())
        all_mandinka = all_mandinka_days | all_mandinka_months | all_mandinka_time

        # Match "MandinkaTerm to/through/until MandinkaTerm"
        mandinka_terms_alt = "|".join(
            re.escape(t) for t in sorted(all_mandinka, key=len, reverse=True)
        )
        if mandinka_terms_alt:
            range_pat = re.compile(
                r"(" + mandinka_terms_alt + r")\s+(?:to|through|until)\s+("
                + mandinka_terms_alt + r")",
                re.IGNORECASE,
            )
            m = range_pat.search(text)
            while m:
                original = m.group(0)
                left = m.group(1)
                right = m.group(2)
                replacement = f"{left} fo {right}"
                text = text[:m.start()] + replacement + text[m.end():]
                reps.append({
                    "original": original, "replaced": replacement,
                    "type": "range_expression",
                })
                entities.append({
                    "text": replacement, "type": "temporal_range",
                    "english": original,
                })
                m = range_pat.search(text, m.start() + len(replacement))

        return text, reps, entities

    def _replace_compounds(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]]]:
        """Step 10: Replace compound temporal expressions."""
        reps = []
        for pat, mandinka in self._compound_patterns:
            m = pat.search(text)
            if m:
                original = m.group(0)
                text = pat.sub(mandinka, text)
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "compound_temporal",
                })
        return text, reps

    def _replace_seasons(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]]]:
        """Step 11: Replace season names."""
        reps = []
        for pat, mandinka in self._season_patterns:
            m = pat.search(text)
            if m:
                original = m.group(0)
                text = pat.sub(mandinka, text)
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "season",
                })
        return text, reps

    def _replace_religious(
        self, text: str,
    ) -> Tuple[str, List[Dict[str, str]]]:
        """Step 12: Replace religious events and related terms."""
        reps = []
        for pat, mandinka in self._religious_patterns:
            m = pat.search(text)
            if m:
                original = m.group(0)
                text = pat.sub(mandinka, text)
                reps.append({
                    "original": original, "replaced": mandinka,
                    "type": "religious_event",
                })
        return text, reps

    # ================================================================
    # UTILITY
    # ================================================================

    def get_lumo_day(self, patient_village: str) -> Optional[Dict[str, str]]:
        """Return lumo day for a patient's area."""
        key = patient_village.lower().strip()
        return self.LUMO_SCHEDULE.get(key)

    def number_to_mandinka(self, n: int) -> str:
        """Convert integer to Mandinka number word, or keep Arabic."""
        return self.MANDINKA_NUMBERS.get(n, str(n))


# ====================================================================
# HELPER: strip markdown wrapping from a token
# ====================================================================

def _strip_markdown(tok: str) -> Tuple[str, str, str]:
    """Return (markdown_prefix, inner_word, markdown_suffix)."""
    pre = ""
    suf = ""
    inner = tok
    while inner and inner[0] in "*_":
        pre += inner[0]
        inner = inner[1:]
    while inner and inner[-1] in "*_":
        suf = inner[-1] + suf
        inner = inner[:-1]
    return pre, inner, suf


# ====================================================================
# SINGLETON
# ====================================================================

_instance: Optional[MandinkaTemporal] = None


def get_temporal() -> MandinkaTemporal:
    global _instance
    if _instance is None:
        _instance = MandinkaTemporal()
    return _instance
