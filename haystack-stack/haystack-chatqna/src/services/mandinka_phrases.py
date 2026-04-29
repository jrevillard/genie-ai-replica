"""
Mandinka Phrase Bank — pre-validated health communication phrases.

These are NOT LLM-translated. Every phrase has been validated by
native Mandinka speakers for the Gambian health context. Do not
modify without native speaker review.

Usage:
    from src.services.mandinka_phrases import get_phrase, get_food_guidance
    greeting = get_phrase("GREETINGS", "morning")
    food = get_food_guidance("benachin")
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# ═══════════════════════════════════════════════════════════════
# VALIDATED PHRASE BANK
# ═══════════════════════════════════════════════════════════════

PHRASES: Dict[str, Dict[str, str]] = {

    # ── Greetings ────────────────────────────────────────────
    "GREETINGS": {
        "morning":          "Isama!",
        "afternoon":        "Itileetaa!",
        "evening":          "Iwurara!",
        "how_are_you":      "I be di?",
        "welcome":          "Iwulaara jang!",
        "thank_god":        "Alhamdulillah",
        "what_brings_you":  "Munne naata i la?",
        "i_will_help":      "N na lafita i demmaa",
        "peace":            "Salaam aleikum",
        "peace_reply":      "Maleikum salaam",
    },

    # ── Symptoms (30+ entries) ───────────────────────────────
    "SYMPTOMS": {
        "headache":             "Kuŋ dimi",
        "chest_pain":           "Kankuluŋ dimi",
        "dizziness":            "Kuŋ yiriŋyiriŋ",
        "stomach_pain":         "Kono dimi",
        "body_pain":            "Faŋ bee dimi",
        "fever":                "Kurango",
        "thirsty":              "Minoo kaŋ",
        "tired":                "Seeyaa",
        "vomiting":             "Buuñaa",
        "frequent_urination":   "Suutoo jaŋjaŋ",
        "blurry_vision":        "Ñaa te kuurango",
        "swollen_feet":         "Seŋolu futuyaata",
        "numbness":             "Faŋ jiijaata",
        "breathing_difficulty": "Ñiinoo ka jukuu",
        "weakness":             "Faŋ seeyaata",
        "cough":                "Kotoloo",
        "diarrhea":             "Kono naafoo",
        "constipation":         "Kono marata",
        "back_pain":            "Kuloo dimi",
        "joint_pain":           "Ñoŋolu dimi",
        "toothache":            "Ñiŋolu dimi",
        "ear_pain":             "Tuloo dimi",
        "eye_pain":             "Ñaa dimi",
        "sore_throat":          "Kaŋkuŋo dimi",
        "skin_rash":            "Kiliŋo bota faŋ kaŋ",
        "loss_of_appetite":     "Domoroo buutaata",
        "weight_loss":          "Faŋo futaata",
        "insomnia":             "Siinoo te naala",
        "anxiety":              "Juusuluu",
        "depression":           "Hakilo laata",
        "nausea":               "Kono ka yiriŋyiriŋ",
        "blood_in_urine":       "Jeli be suutoo kono",
        "heart_palpitations":   "Juroo ka jaŋjaŋ",
    },

    # ── Food guidance ────────────────────────────────────────
    "FOOD_GUIDANCE": {
        "reduce_oil":        "Tuloo doyaa — kana a jaŋjaŋ",
        "more_vegetables":   "Nakoo jaŋjaŋ — moringa, kanjaa, jaxatu",
        "less_rice":         "Maloo doyaa, nakoo jaŋjaŋ",
        "less_sugar":        "Sukkaroo doyaa i ka attaayaa kono",
        "less_salt":         "Sokoo doyaa — Maggi kiliŋ, kana fula",
        "eat_fish":          "Jéwoo domo — a ka ñii i juroo ye",
        "eat_moringa":       "Moringa domo — a ka ñii i sukkaroo ye",
        "drink_water":       "Jii miŋ — luŋ bee",
        "eat_okra":          "Kanjaa domo — a ka sukkaroo doyaa",
        "eat_millet":        "Mono domo — a ka fii maloo ye",
        "reduce_maggi":      "Maggi doyaa — kiliŋ dorong",
        "eat_beans":         "Nyebbeh domo — a ka ñii i faŋ ye",
        "avoid_palm_oil":    "Tuloo tilindiŋo doyaa",
        "small_portions":    "Domoroo doyaa — kana a jaŋjaŋ",
        "eat_bitter_tomato": "Jaxatu domo — a ka ñii BP ye",
        "eat_baobab":        "Buyii domo — vitamin C ka jaŋjaŋ",
        "no_added_sugar":    "Kana sukkaroo fara a kaŋ",
        "eat_regularly":     "Domo waxatoo kono — kana baloo luŋ",
        "chew_slowly":       "Domo pianŋpiañ — kana jaŋjaŋ",
        "stop_when_full":    "Daŋ ne i fanta",
    },

    # ── Medication reminders ─────────────────────────────────
    "MEDICATION_REMINDERS": {
        "take_morning":     "I ka furaŋo doŋ sube ma, subaa-saliioo kooma",
        "take_evening":     "I ka furaŋo doŋ futoo ma",
        "dont_stop":        "Kana furaŋo buloo tii — a jaŋjaŋ luŋ bee",
        "bring_to_doctor":  "I ka furaŋo taa dokitaroo ye",
        "take_with_food":   "I ka furaŋo doŋ domoroo kooma",
        "take_with_water":  "I ka furaŋo doŋ jii la",
        "same_time_daily":  "Waxati kiliŋ luŋ bee",
        "finish_course":    "A bee doŋ — kana a buloo tii",
    },

    # ── Encouragement ────────────────────────────────────────
    "ENCOURAGEMENT": {
        "you_did_well":         "I y'a ke bétéyaa la!",
        "one_step":             "Taa kelen kelen — a bé naa ke bétéyaa la",
        "proud_of_you":         "N nisaata i la",
        "keep_going":           "A taa niŋ a la — i bé a la koolaa",
        "your_health_matters":  "I kendeyaa nafaa le ka boŋ",
        "you_are_strong":       "I ka seŋ",
        "dont_give_up":         "Kana jikandoo tii",
        "allah_will_help":      "Alla le bé i demmaa",
        "small_changes_matter": "Feeroo dooyaa — a bé naa ke boŋo la",
        "tomorrow_better":      "Bii ka fii, saama ka fii",
    },

    # ── Emergencies ──────────────────────────────────────────
    "EMERGENCIES": {
        "go_hospital":      "Taa ospitaali la SISAN!",
        "call_199":         "Telefon ke 199 la!",
        "dont_wait":        "Kana maakoy!",
        "bring_medicine":   "I ka furaŋo taa i boloo la",
        "call_ambulance":   "Ambulansi kele!",
        "its_urgent":       "A ka jaŋjaŋ!",
        "seek_help_now":    "Demmaa ñiŋ SISAN!",
    },

    # ── Days of the week ─────────────────────────────────────
    "DAYS_OF_WEEK": {
        "monday":    "Teneŋo",
        "tuesday":   "Talaato",
        "wednesday": "Araba",
        "thursday":  "Aramisaa",
        "friday":    "Arijuma",
        "saturday":  "Sibiti",
        "sunday":    "Aladoo",
    },

    # ── Numbers (for BP readings, dosages) ───────────────────
    "NUMBERS": {
        "one":   "kiliŋ",
        "two":   "fula",
        "three": "saba",
        "four":  "naani",
        "five":  "luulu",
        "half":  "tiliŋo",
    },

    # ── Body parts ───────────────────────────────────────────
    "BODY_PARTS": {
        "head":     "Kuŋo",
        "chest":    "Kankuluŋo",
        "stomach":  "Konoo",
        "back":     "Kuloo",
        "legs":     "Seŋolu",
        "arms":     "Boloo",
        "eyes":     "Ñaa",
        "ears":     "Tuloo",
        "mouth":    "Daa",
        "heart":    "Juroo",
        "blood":    "Jeli",
        "feet":     "Seŋolu",
    },
}


# ═══════════════════════════════════════════════════════════════
# FOOD NAMES — local Gambian foods with health notes
# ═══════════════════════════════════════════════════════════════

FOOD_NAMES: Dict[str, Dict[str, str]] = {
    "benachin": {
        "mandinka": "Benachin",
        "health": "high_carb_high_oil",
        "modify": "reduce rice, add vegetables",
    },
    "domoda": {
        "mandinka": "Domoda",
        "health": "groundnut_protein",
        "modify": "more vegetables, less rice",
    },
    "supakanja": {
        "mandinka": "Supakanja",
        "health": "good_okra_based",
        "modify": "already healthy, keep it",
    },
    "attaya": {
        "mandinka": "Attaayaa",
        "health": "high_sugar",
        "modify": "reduce sugar by 1 spoon per glass",
    },
    "tapalapa": {
        "mandinka": "Tapalapa",
        "health": "refined_flour_spikes_sugar",
        "modify": "eat less, pair with protein",
    },
    "moringa": {
        "mandinka": "Moringa/Nebedaye",
        "health": "excellent_lowers_sugar",
        "modify": "add to everything",
    },
    "okra": {
        "mandinka": "Kanjaa",
        "health": "slows_sugar_absorption",
        "modify": "double the amount in stews",
    },
    "bitter_tomato": {
        "mandinka": "Jaxatu",
        "health": "helps_blood_pressure",
        "modify": "add as side dish",
    },
    "millet_porridge": {
        "mandinka": "Mono/Fura",
        "health": "better_than_white_rice",
        "modify": "use instead of rice for breakfast",
    },
    "baobab_juice": {
        "mandinka": "Buyii jii",
        "health": "vitamin_c_good",
        "modify": "no added sugar",
    },
    "chere": {
        "mandinka": "Chereh",
        "health": "couscous_moderate_carb",
        "modify": "pair with leaf sauce",
    },
    "nyebbeh": {
        "mandinka": "Nyebbeh",
        "health": "bean_protein_fiber",
        "modify": "eat 2-3 times a week",
    },
    "laaciiri": {
        "mandinka": "Laaciiri",
        "health": "millet_couscous_good",
        "modify": "pair with milk or leaf sauce",
    },
    "fish": {
        "mandinka": "Jéwoo",
        "health": "lean_protein_omega3",
        "modify": "eat 2-3 times a week, grilled not fried",
    },
    "groundnut": {
        "mandinka": "Tiyoo",
        "health": "protein_good_fats",
        "modify": "small handful as snack",
    },
    "bissap": {
        "mandinka": "Bissap jii",
        "health": "lowers_blood_pressure",
        "modify": "no added sugar, drink daily",
    },
    "wonjo": {
        "mandinka": "Wonjo",
        "health": "hibiscus_good_for_bp",
        "modify": "no sugar added",
    },
    "palm_oil": {
        "mandinka": "Tuloo tilindiŋo",
        "health": "high_saturated_fat",
        "modify": "reduce or use groundnut oil instead",
    },
}

# Reverse lookup: English food name → key
_FOOD_ALIASES: Dict[str, str] = {}
for _key, _val in FOOD_NAMES.items():
    _FOOD_ALIASES[_key] = _key
    _FOOD_ALIASES[_val["mandinka"].lower()] = _key
    for _alias in _key.replace("_", " ").split():
        if len(_alias) > 3:
            _FOOD_ALIASES[_alias] = _key


# ═══════════════════════════════════════════════════════════════
# LOOKUP FUNCTIONS
# ═══════════════════════════════════════════════════════════════

def get_phrase(
    category: str, key: str, fallback_english: Optional[str] = None,
) -> Dict[str, Any]:
    """Look up a validated Mandinka phrase.

    Returns:
        {
            "mandinka": str,
            "validated": True/False,
            "category": str,
            "key": str,
        }
    If the phrase is not in the bank, returns the English fallback
    with validated=False so callers know it needs LLM translation.
    """
    cat = PHRASES.get(category.upper(), {})
    phrase = cat.get(key)
    if phrase:
        return {
            "mandinka": phrase,
            "validated": True,
            "category": category.upper(),
            "key": key,
        }
    return {
        "mandinka": fallback_english or key.replace("_", " "),
        "validated": False,
        "category": category.upper(),
        "key": key,
    }


def get_food_guidance(food_name: str) -> Optional[Dict[str, Any]]:
    """Look up a Gambian food by name (English or Mandinka).

    Returns:
        {
            "key": str,
            "mandinka": str,
            "health": str,
            "modify": str,
        }
    or None if the food is not in the bank.
    """
    lookup = food_name.strip().lower().replace(" ", "_")
    resolved = _FOOD_ALIASES.get(lookup) or _FOOD_ALIASES.get(
        food_name.strip().lower()
    )
    if not resolved:
        for alias, fkey in _FOOD_ALIASES.items():
            if alias in lookup or lookup in alias:
                resolved = fkey
                break
    if not resolved:
        return None
    entry = FOOD_NAMES.get(resolved)
    if not entry:
        return None
    return {
        "key": resolved,
        "mandinka": entry["mandinka"],
        "health": entry["health"],
        "modify": entry["modify"],
    }


def get_time_greeting() -> str:
    """Return the correct Mandinka greeting for the current time of day."""
    from datetime import datetime
    hour = datetime.now().hour
    if 5 <= hour < 12:
        return PHRASES["GREETINGS"]["morning"]
    elif 12 <= hour < 17:
        return PHRASES["GREETINGS"]["afternoon"]
    else:
        return PHRASES["GREETINGS"]["evening"]


def get_day_name(english_day: str) -> str:
    """Return the Mandinka name for a day of the week."""
    return PHRASES["DAYS_OF_WEEK"].get(english_day.lower(), english_day)


def find_symptom_phrase(english_text: str) -> List[Tuple[str, str]]:
    """Scan English text and return matching validated symptom phrases.

    Returns list of (english_key, mandinka_phrase) tuples for any
    symptom keywords found in the text.
    """
    text_l = english_text.lower()
    matches = []
    symptom_map = {
        "headache": "headache", "head pain": "headache", "head ache": "headache",
        "chest pain": "chest_pain",
        "dizz": "dizziness", "lightheaded": "dizziness",
        "stomach": "stomach_pain", "belly": "stomach_pain", "abdominal": "stomach_pain",
        "body pain": "body_pain", "body ache": "body_pain",
        "fever": "fever", "temperature": "fever",
        "thirst": "thirsty",
        "tired": "tired", "fatigue": "tired", "exhausted": "tired",
        "vomit": "vomiting", "throw up": "vomiting",
        "urinat": "frequent_urination",
        "blur": "blurry_vision", "vision": "blurry_vision",
        "swell": "swollen_feet", "swollen": "swollen_feet",
        "numb": "numbness", "tingl": "numbness",
        "breath": "breathing_difficulty", "short of breath": "breathing_difficulty",
        "weak": "weakness",
        "cough": "cough",
        "diarr": "diarrhea",
        "constipat": "constipation",
        "back pain": "back_pain",
        "joint": "joint_pain",
        "tooth": "toothache",
        "ear pain": "ear_pain",
        "eye pain": "eye_pain",
        "sore throat": "sore_throat", "throat pain": "sore_throat",
        "rash": "skin_rash",
        "appetite": "loss_of_appetite",
        "weight loss": "weight_loss",
        "insomnia": "insomnia", "can't sleep": "insomnia", "sleep": "insomnia",
        "anxious": "anxiety", "anxiety": "anxiety", "worried": "anxiety",
        "depress": "depression", "sad": "depression",
        "nausea": "nausea",
        "blood in urine": "blood_in_urine",
        "palpitat": "heart_palpitations", "heart racing": "heart_palpitations",
    }
    seen = set()
    for trigger, key in symptom_map.items():
        if trigger in text_l and key not in seen:
            phrase = PHRASES["SYMPTOMS"].get(key)
            if phrase:
                matches.append((key, phrase))
                seen.add(key)
    return matches


def find_food_phrases(english_text: str) -> List[Dict[str, str]]:
    """Scan English text for food mentions and return validated phrase data."""
    text_l = english_text.lower()
    matches = []
    seen = set()
    for alias, fkey in _FOOD_ALIASES.items():
        if alias in text_l and fkey not in seen:
            entry = FOOD_NAMES.get(fkey)
            if entry:
                matches.append({
                    "english": fkey.replace("_", " "),
                    "mandinka": entry["mandinka"],
                    "health": entry["health"],
                    "modify": entry["modify"],
                })
                seen.add(fkey)
    return matches
