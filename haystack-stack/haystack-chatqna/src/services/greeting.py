"""
Greeting Service — Culturally-Aligned Conversational Entry for Rural Gambia

Implements the 7-layer greeting protocol:
  1. Universal "Salaam aleikum" opener (95% Muslim, ethnically neutral)
  2. 5-ethnic language detection (Mandinka, Wolof, Fula, Jola, English)
  3. Time-aware modifiers (Fajr/Dhuhr/Asr/Maghrib/Isha + Jummah + Lumo)
  4. Seasonal/religious modifiers (Ramadan, Eid, rainy/harvest/dry)
  5. Trust tier progression (Stranger → Acquaintance → Companion → Family)
  6. 8-category intention classification (keyword-based, zero LLM)
  7. Text-based mood/social signal detection

All operations are < 10ms — no LLM calls, pure Python + dict lookups.
"""

from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import re


# ═══════════════════════════════════════════════════════════════════
# LAYER 1 & 2: ETHNIC LANGUAGE DETECTION
# ═══════════════════════════════════════════════════════════════════

# Keyword markers for each Gambian ethnic language. Weighted: stronger
# markers (distinctive to that language) count more.

_MANDINKA_MARKERS = {
    # Strong (distinctive to Mandinka)
    "strong": [
        "isama", "itileetaa", "itilii", "iwulaara", "iwurara",
        "kayira dorong", "kayira doron", "n be kayira", "i be di",
        "summo lay", "summolay", "koriŋo", "koringo", "surolu",
        "munne naata", "n tomu", "abaraka", "ibaarake",
        "i mbe", "saraabu", "kuurango", "kuuraŋo", "dookuwo",
        "alkallo", "alkalo", "bantaba", "ñaamaa", "nyaamaa",
        "tooroo be", "nna lafita", "ibbi jay",
    ],
    # Weak (could collide with other languages)
    "weak": [
        "jang", "jaŋ", "mba", "mfa", "jusu", "suu", "banko",
        "tiloo", "suutoo", "mennu", "fanaa",
    ],
}

_WOLOF_MARKERS = {
    "strong": [
        "naka nga def", "naka waa", "ana sa yaram", "mang fi rek",
        "jamm rek", "jam rek", "waa keur", "jerejef", "baax na",
        "lan ngay", "noo tudd", "yalla", "yaa ngi", "waaw",
        "deedet", "ba beneen", "soo gisee",
    ],
    "weak": ["def", "keur", "jamm", "jam", "rek"],
}

_FULA_MARKERS = {  # Fula/Pulaar
    "strong": [
        "no mbad-daa", "no mbaddaa", "tana wala", "ko ɓe fof",
        "jam tan", "jaraama", "yeeso", "mi yidi", "on njaaraama",
        "eɗen", "sehil", "mbaɗ-mi", "ɓeynguure",
    ],
    "weak": ["jam", "tan", "mi"],
}

_JOLA_MARKERS = {
    "strong": [
        "kasumay", "kasumay kaep", "kasumai", "kumakel",
        "emitey", "karambenor", "bubaj", "nyambalai",
    ],
    "weak": ["kaep", "kas"],
}

# Universal Islamic greeting responses (all Muslims, any ethnic group)
_SALAAM_RESPONSE_MARKERS = [
    "wa aleikum", "waaleikum", "wa alaikum", "waalekum",
    "alekum salaam", "alaikum salam",
]


def detect_ethnic_language(text: str) -> Dict[str, Any]:
    """Classify user's response into one of 5 languages.

    Returns:
      {
        "language": "mandinka" | "wolof" | "fula" | "jola" | "english",
        "confidence": "high" | "medium" | "low",
        "score": float 0-1,
        "markers": List[str],
        "responded_to_salaam": bool,  # did they say "Wa aleikum salaam"?
      }

    Never raises. Returns english+low as safe default.
    """
    if not text or not text.strip():
        return {
            "language": "english", "confidence": "low", "score": 0.0,
            "markers": [], "responded_to_salaam": False,
        }
    tl = text.lower()

    # Islamic greeting response is a strong universal signal
    responded_to_salaam = any(m in tl for m in _SALAAM_RESPONSE_MARKERS)

    # Score each language
    scores: Dict[str, float] = {"mandinka": 0.0, "wolof": 0.0, "fula": 0.0, "jola": 0.0}
    matched_markers: Dict[str, List[str]] = {"mandinka": [], "wolof": [], "fula": [], "jola": []}

    for lang, markers in [
        ("mandinka", _MANDINKA_MARKERS), ("wolof", _WOLOF_MARKERS),
        ("fula", _FULA_MARKERS), ("jola", _JOLA_MARKERS),
    ]:
        for m in markers["strong"]:
            if m in tl:
                scores[lang] += 2.0
                matched_markers[lang].append(m)
        for m in markers["weak"]:
            if re.search(rf"\b{re.escape(m)}\b", tl):
                scores[lang] += 0.5
                matched_markers[lang].append(m)

    # Pick highest-scoring language
    best_lang, best_score = max(scores.items(), key=lambda kv: kv[1])

    # Need at least 1.0 score to claim a non-English detection
    if best_score < 1.0:
        return {
            "language": "english", "confidence": "low", "score": 0.0,
            "markers": [], "responded_to_salaam": responded_to_salaam,
        }

    if best_score >= 3.0:
        confidence = "high"
    elif best_score >= 2.0:
        confidence = "medium"
    else:
        confidence = "low"

    # Normalize score to 0-1 for display
    normalized = min(1.0, best_score / 5.0)

    return {
        "language": best_lang,
        "confidence": confidence,
        "score": round(normalized, 3),
        "markers": matched_markers[best_lang][:5],
        "responded_to_salaam": responded_to_salaam,
    }


# ═══════════════════════════════════════════════════════════════════
# LAYER 5: TIME-AWARE GREETING MODIFIERS
# ═══════════════════════════════════════════════════════════════════

def get_time_context(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Return the current time-of-day greeting context.

    Categories: fajr, morning, noon, afternoon, evening, night, late_night
    Plus: day_of_week, is_friday, is_lumo_day, hour_period
    """
    if now is None:
        now = datetime.now()
    h = now.hour

    if 5 <= h < 7:
        period = "fajr"          # Just after Fajr prayer
        mandinka = "Isama!"
        english = "Good morning"
        tone_note = "Fresh morning, before daily work begins"
    elif 7 <= h < 12:
        period = "morning"
        mandinka = "Isama!"
        english = "Good morning"
        tone_note = "Active morning — farming, chores, market"
    elif 12 <= h < 14:
        period = "noon"
        mandinka = "Itileetaa!"
        english = "Good afternoon"
        tone_note = "Dhuhr prayer time, lunch, sun is strong"
    elif 14 <= h < 17:
        period = "afternoon"
        mandinka = "Itileetaa!"
        english = "Good afternoon"
        tone_note = "Afternoon work or rest"
    elif 17 <= h < 20:
        period = "evening"
        mandinka = "Iwurara!"
        english = "Good evening"
        tone_note = "Attaya time, socializing, Maghrib prayer"
    elif 20 <= h < 22:
        period = "night"
        mandinka = "Iwurara!"
        english = "Good evening"
        tone_note = "After Isha prayer, winding down"
    else:  # 22-5
        period = "late_night"
        mandinka = "Salaam aleikum."
        english = "Peace be upon you"
        tone_note = "Unusual hour — likely urgent"

    day_name = now.strftime("%A")
    is_friday = day_name == "Friday"
    # Gambian lumo (weekly market) varies by village — assume Mon/Wed/Sat common
    is_lumo_day = day_name in ("Monday", "Wednesday", "Saturday")

    return {
        "period": period,
        "mandinka_greeting": mandinka,
        "english_greeting": english,
        "tone_note": tone_note,
        "day_of_week": day_name,
        "is_friday": is_friday,
        "is_lumo_day": is_lumo_day,
        "hour": h,
        "is_urgent_hour": period == "late_night",
    }


def get_seasonal_context(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Gambian seasonal + religious calendar context."""
    if now is None:
        now = datetime.now()
    m = now.month
    if m in (11, 12, 1, 2):
        season = "cool_dry"; emoji = "🌤"; notes = "Cool mornings, ideal exercise time"
    elif m in (3, 4, 5):
        season = "hot_dry"; emoji = "☀"; notes = "Heat management, dehydration risk"
    elif m in (6, 7):
        season = "early_rains"; emoji = "🌦"; notes = "Humidity, medicine storage"
    elif m in (8, 9):
        season = "harvest"; emoji = "🌾"; notes = "Farm work, diabetic foot care"
    else:  # m == 10
        season = "late_rains"; emoji = "🌧"; notes = "Flooded roads, medicine supply"

    return {
        "season": season, "emoji": emoji, "notes": notes,
        "is_ramadan": False,  # TODO: real lunar calendar
    }


# ═══════════════════════════════════════════════════════════════════
# LAYER 6: TRUST TIER PROGRESSION
# ═══════════════════════════════════════════════════════════════════

def get_trust_tier(
    interaction_count: int,
    days_since_first_call: int,
    days_since_last_call: int,
) -> Dict[str, Any]:
    """Determine relationship stage based on interaction history.

    Tiers:
      - stranger    (first contact or days_since_first_call < 7)
      - acquaintance (week 2-4, interaction_count >= 2)
      - companion    (month 2-3, interaction_count >= 10)
      - family       (month 4+, interaction_count >= 20)
    """
    if interaction_count == 0 or days_since_first_call < 7:
        tier = "stranger"
        greeting_style = "Full introduction. Formal, respectful, patient. No assumptions."
    elif days_since_first_call < 30 or interaction_count < 10:
        tier = "acquaintance"
        greeting_style = "Use their name. Remember their family. Reference previous conversations."
    elif days_since_first_call < 120 or interaction_count < 20:
        tier = "companion"
        greeting_style = "Warmer. Say 'I was thinking about you'. Reference health journey."
    else:
        tier = "family"
        greeting_style = "Ask about specific family members by name. Reference shared history. Can be playful."

    # "Returning after absence" overlay
    is_returning = days_since_last_call >= 14 and interaction_count >= 2

    return {
        "tier": tier,
        "interaction_count": interaction_count,
        "days_active": days_since_first_call,
        "days_since_last_call": days_since_last_call,
        "is_returning_user": is_returning,
        "greeting_style": greeting_style,
    }


# ═══════════════════════════════════════════════════════════════════
# LAYER 4: 8-CATEGORY INTENTION CLASSIFICATION
# ═══════════════════════════════════════════════════════════════════

# Keywords that signal each intention category. Order matters — most
# specific/urgent first.

_EMERGENCY_KEYWORDS = [
    "help", "emergency", "urgent", "collapsed", "unconscious", "dying",
    "can't breathe", "cant breathe", "bleeding", "heart attack", "stroke",
    "seizure", "overdose", "chest pain", "sos",
]

_PAIN_DISTRESS_KEYWORDS = [
    "pain", "hurt", "hurting", "ache", "aching", "tooroo",
    "very sick", "so sick", "feel terrible", "feel awful",
    "can't sleep", "cant sleep", "fever", "vomiting",
]

_WORRIED_ABOUT_OTHER_KEYWORDS = [
    "my mother", "my father", "my husband", "my wife", "my child",
    "my grandmother", "my grandfather", "my sister", "my brother",
    "my son", "my daughter", "my aunt", "my uncle", "my elder",
]

_SEEKING_INFO_KEYWORDS = [
    "what is", "what are", "what causes", "how does", "tell me about",
    "i heard", "someone told me", "is it true", "can you explain",
    "what should i know", "how do i know",
]

_LONELY_SOCIAL_KEYWORDS = [
    "just wanted to talk", "nobody to", "alone", "lonely", "no one",
    "bored", "miss you", "how are you amina", "amina how",
    "wanted to chat",
]

_FIRST_TIME_KEYWORDS = [
    "is this amina", "first time", "how does this work", "who are you",
    "someone told me about", "what can you do", "are you a real",
]

_ROUTINE_CHECKIN_KEYWORDS = [
    "my regular", "check in", "weekly check", "my readings",
    "my bp today", "my sugar today", "just checking", "routine",
]


def classify_intention(message: str) -> Dict[str, Any]:
    """Classify user message into one of 8 intention categories.

    Returns: {
      "intention": "EMERGENCY" | "IN_PAIN" | "WORRIED_ABOUT_OTHER" |
                   "SEEKING_INFO" | "LONELY" | "FIRST_TIME" |
                   "ROUTINE_CHECKIN" | "HEALTH_GENERAL",
      "confidence": "high" | "medium" | "low",
      "markers": List[str],
    }
    """
    if not message:
        return {"intention": "HEALTH_GENERAL", "confidence": "low", "markers": []}
    msg_l = message.lower()

    def _match(patterns):
        hits = [p for p in patterns if p in msg_l]
        return hits

    # Priority order — matches most specific/urgent first:
    # EMERGENCY > IN_PAIN > FIRST_TIME > WORRIED_ABOUT_OTHER > SEEKING_INFO > LONELY > ROUTINE > HEALTH
    # FIRST_TIME must come BEFORE SEEKING_INFO because "someone told me about amina"
    # contains both patterns but is really a first-time user.
    emerg = _match(_EMERGENCY_KEYWORDS)
    if emerg:
        return {"intention": "EMERGENCY", "confidence": "high", "markers": emerg[:3]}

    pain = _match(_PAIN_DISTRESS_KEYWORDS)
    if pain and len(pain) >= 1:
        return {"intention": "IN_PAIN", "confidence": "high", "markers": pain[:3]}

    first_time = _match(_FIRST_TIME_KEYWORDS)
    if first_time:
        return {"intention": "FIRST_TIME", "confidence": "high", "markers": first_time[:3]}

    worried = _match(_WORRIED_ABOUT_OTHER_KEYWORDS)
    if worried:
        return {"intention": "WORRIED_ABOUT_OTHER", "confidence": "high", "markers": worried[:3]}

    info = _match(_SEEKING_INFO_KEYWORDS)
    if info:
        return {"intention": "SEEKING_INFO", "confidence": "medium", "markers": info[:3]}

    lonely = _match(_LONELY_SOCIAL_KEYWORDS)
    if lonely:
        return {"intention": "LONELY", "confidence": "medium", "markers": lonely[:3]}

    routine = _match(_ROUTINE_CHECKIN_KEYWORDS)
    if routine:
        return {"intention": "ROUTINE_CHECKIN", "confidence": "medium", "markers": routine[:3]}

    return {"intention": "HEALTH_GENERAL", "confidence": "low", "markers": []}


# ═══════════════════════════════════════════════════════════════════
# LAYER 7: TEXT-BASED MOOD / SOCIAL SIGNALS
# ═══════════════════════════════════════════════════════════════════

def analyze_text_signals(message: str, hour: int) -> Dict[str, Any]:
    """Flags based on HOW the user is typing, not WHAT they said.

    Returns a dict of boolean/string flags the agent can use for tone.
    """
    if not message:
        return {}

    msg = message.strip()
    words = msg.split()
    flags: Dict[str, Any] = {}

    # Short one-word reply → shy, first-time, or low-literate
    if len(words) == 1:
        flags["short_reply"] = True

    # Very long extended greeting → elder wanting social connection
    if len(words) > 25 and any(g in msg.lower() for g in ["good", "how are", "how is", "family"]):
        flags["extended_greeting"] = True

    # Many typos / phonetic spelling heuristic — hard to detect reliably;
    # rough proxy: lots of repeated characters or broken spacing
    if re.search(r"(.)\1{3,}", msg) or msg.count("  ") > 2:
        flags["low_literacy_hint"] = True

    # Unusual hour = concern
    if hour >= 22 or hour < 5:
        flags["unusual_hour"] = True

    # All caps = shouting / urgency
    if msg == msg.upper() and len(msg) > 5:
        flags["shouting"] = True

    # Flat "fine" / "ok" when we expected more — tone mismatch
    if msg.lower().strip(" .!?") in {"fine", "ok", "okay", "kayira dorong", "jam tan", "jamm rek"}:
        flags["flat_response"] = True

    # Scout mode — child/youth answering for elder
    if any(w in msg.lower() for w in ["for my grandmother", "for my grandfather", "for my elder", "my grandma", "my grandpa"]):
        flags["scout_mode"] = True

    # Privacy cue — whispering via text ("please don't tell", "between us")
    if any(p in msg.lower() for p in ["don't tell", "dont tell", "between us", "privately", "secret"]):
        flags["privacy_needed"] = True

    return flags


# ═══════════════════════════════════════════════════════════════════
# ORCHESTRATOR: full greeting context in one call
# ═══════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════
# 4-TURN GREETING RITUAL STATE MACHINE
# ═══════════════════════════════════════════════════════════════════
#
# This runs ONLY on voice/sms/whatsapp channels where the cultural
# ritual is expected. Web users skip it entirely.
#
# Phases:
#   0  salaam_sent      → waiting for "wa aleikum salaam"
#   1  language_chosen  → detected language, ask "I be di?" / "Naka nga def?"
#   2  family_greeted   → ask about household "Summo lay?"
#   3  health_ready     → handoff to normal agent flow
#
# Emergency escape: if turn-1 message contains health/emergency keywords,
# SKIP straight to phase 3. No ritual for urgent users.

_RITUAL_CHANNELS = {"voice", "sms", "whatsapp"}

# Keywords that bypass the ritual — urgent health content
_RITUAL_BYPASS_KEYWORDS = [
    "pain", "help", "emergency", "urgent", "hurts", "sick", "bleeding",
    "chest", "breathe", "fainted", "collapsed", "199", "sos",
    # Direct health questions also bypass
    "my bp", "my sugar", "my blood", "i have", "i feel", "my medicine",
]


# Localised templates per ritual phase × language
# Keys: phase → language → phrase
_RITUAL_TEMPLATES = {
    # Phase 1: after user responds to "Salaam aleikum"
    "phase_1_howareyou": {
        "mandinka": "I be di?",
        "wolof": "Naka nga def?",
        "fula": "No mbad-daa?",
        "jola": "Kasumay?",
        "english": "How are you today?",
    },
    # Phase 2: after "I'm fine" — ask about household
    "phase_2_household": {
        "mandinka": "Alhamdulillah. Summo lay?",
        "wolof": "Jaarama. Naka waa keur gi?",
        "fula": "Jaraama. Ko ɓe fof?",
        "jola": "Kasumay. Bubaj?",
        "english": "Good to hear. How is your household?",
    },
    # Phase 3: after household reply — ready for health
    "phase_3_openhealth": {
        "mandinka": "Alhamdulillah. Munne naata i la?",
        "wolof": "Alhamdulillah. Lan ngay gaaru?",
        "fula": "Jaraama. Ko addi maa?",
        "jola": "Kasumay. Kumakel?",
        "english": "Thank God. What brings you today?",
    },
}


def should_bypass_ritual(message: str) -> bool:
    """Check if the user's opening message has urgent health content."""
    if not message:
        return False
    msg_l = message.lower()
    return any(k in msg_l for k in _RITUAL_BYPASS_KEYWORDS)


def get_ritual_response(
    phase: int,
    detected_language: str = "mandinka",
) -> Optional[str]:
    """Return the templated ritual phrase for the given phase, or None
    if phase >= 3 (ritual complete, hand off to agent).
    """
    if phase < 0 or phase >= 3:
        return None
    key = f"phase_{phase + 1}_" + [
        "howareyou", "household", "openhealth"
    ][phase] if phase < 2 else "phase_3_openhealth"
    # Actually rebuild properly:
    phase_keys = ["phase_1_howareyou", "phase_2_household", "phase_3_openhealth"]
    tpl = _RITUAL_TEMPLATES.get(phase_keys[phase], {})
    return tpl.get(detected_language, tpl.get("english", ""))


def is_ritual_channel(channel: str) -> bool:
    return (channel or "").lower() in _RITUAL_CHANNELS


def build_greeting_context(
    message: str,
    interaction_count: int = 0,
    days_since_first_call: int = 0,
    days_since_last_call: int = 0,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """One call → all greeting/intention/context signals.

    Used by the agent to (a) select the right tone and (b) inject
    cultural context into the LLM response prompt WITHOUT adding
    an LLM call.
    """
    now = now or datetime.now()
    time_ctx = get_time_context(now)
    season_ctx = get_seasonal_context(now)
    ethnic = detect_ethnic_language(message)
    trust = get_trust_tier(interaction_count, days_since_first_call, days_since_last_call)
    intention = classify_intention(message)
    signals = analyze_text_signals(message, time_ctx["hour"])

    # Special day override
    special_day = None
    if time_ctx["is_friday"]:
        special_day = {"name": "Jummah", "modifier": "Jumaa Mubarak! May your prayers be accepted."}
    elif time_ctx["is_lumo_day"]:
        special_day = {"name": "Lumo (market day)", "modifier": "Today is lumo day. At the market, remember: moringa leaves and bitter tomato for your heart."}

    return {
        "time": time_ctx,
        "season": season_ctx,
        "special_day": special_day,
        "ethnic_language": ethnic,
        "trust": trust,
        "intention": intention,
        "signals": signals,
    }
