"""
Community features service — the 5 pillars of AMINA's social layer.

  1. BANTABA CIRCLE    — Social accountability groups (5-8 members)
  2. YOUTH SCOUT       — Intergenerational bridge (youth monitor elders)
  3. VILLAGE SCOREBOARD — Collective health tracking per village
  4. SEASONAL RHYTHMS  — Health guidance tied to Gambian calendar
  5. HEALER BRIDGE     — Dual-path (traditional + modern) care

For the MVP demo these return realistic mock data. In production each
will be backed by ArcadeDB collections + Redis session state, and the
weekly/monthly aggregations will run as scheduled jobs.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, date
import hashlib

# ────────────────────────────────────────────────────────────────
# BANTABA CIRCLE
# ────────────────────────────────────────────────────────────────

# Mock circles keyed by circle_id. In production: ArcadeDB Circle vertices
MOCK_CIRCLES: Dict[str, Dict[str, Any]] = {
    "circle_fatou_kerewan": {
        "circle_id": "circle_fatou_kerewan",
        "name": "Fatou's Circle",
        "village": "Kerewan",
        "leader": "Fatou Jallow",
        "weekly_checkin_day": "Thursday",
        "weekly_checkin_time": "18:00",
        "members": [
            {"id": "m1", "name": "Fatou", "age": 52, "conditions": ["hypertension"], "adherence_week": 7, "adherence_target": 7},
            {"id": "m2", "name": "Awa",   "age": 48, "conditions": ["diabetes"],      "adherence_week": 6, "adherence_target": 7},
            {"id": "m3", "name": "Binta", "age": 61, "conditions": ["diabetes", "hypertension"], "adherence_week": 5, "adherence_target": 14},
            {"id": "m4", "name": "Ramatoulie", "age": 44, "conditions": ["hypertension"], "adherence_week": 7, "adherence_target": 7},
            {"id": "m5", "name": "Jainaba", "age": 55, "conditions": ["hypertension"], "adherence_week": 4, "adherence_target": 7},
            {"id": "m6", "name": "Isatou", "age": 39, "conditions": [], "adherence_week": 0, "adherence_target": 0},
        ],
        "this_week_highlight": "Awa tried less oil in her domoda and Ramatoulie walked every day",
        "streak_weeks": 3,
    },
}


def get_bantaba_circle(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Return the user's Bantaba circle. For demo, always returns Fatou's circle."""
    circle = MOCK_CIRCLES["circle_fatou_kerewan"]
    # Compute circle-level stats
    members_with_meds = [m for m in circle["members"] if m["adherence_target"] > 0]
    total_adherence = sum(m["adherence_week"] for m in members_with_meds)
    total_target = sum(m["adherence_target"] for m in members_with_meds)
    adherence_pct = round(100 * total_adherence / total_target) if total_target else 0

    # Next checkin (Thursday 18:00 of this week)
    today = datetime.now()
    days_until_thu = (3 - today.weekday()) % 7  # Monday=0...Thursday=3
    if days_until_thu == 0 and today.hour >= 19:
        days_until_thu = 7
    from datetime import timedelta
    next_checkin = (today + timedelta(days=days_until_thu)).replace(hour=18, minute=0, second=0, microsecond=0)

    return {
        **circle,
        "adherence_pct": adherence_pct,
        "members_on_track": len([m for m in members_with_meds if m["adherence_week"] >= m["adherence_target"] * 0.85]),
        "members_need_support": len([m for m in members_with_meds if m["adherence_week"] < m["adherence_target"] * 0.6]),
        "next_checkin_iso": next_checkin.isoformat(),
        "next_checkin_display": next_checkin.strftime("%a %d %b, %H:%M"),
    }


# ────────────────────────────────────────────────────────────────
# YOUTH SCOUT
# ────────────────────────────────────────────────────────────────

BADGE_LADDER = [
    {"id": "first_check", "name": "First Check", "min_checks": 1, "color": "bronze"},
    {"id": "heart_watcher", "name": "Heart Watcher", "min_checks": 5, "color": "silver"},
    {"id": "village_scout", "name": "Village Scout Leader", "min_checks": 15, "color": "gold"},
    {"id": "amina_ambassador", "name": "AMINA Ambassador", "min_checks": 40, "color": "platinum"},
]


def _current_badge(check_count: int) -> Dict[str, Any]:
    current = BADGE_LADDER[0]
    next_badge = None
    for i, b in enumerate(BADGE_LADDER):
        if check_count >= b["min_checks"]:
            current = b
            next_badge = BADGE_LADDER[i + 1] if i + 1 < len(BADGE_LADDER) else None
        else:
            next_badge = b
            break
    return {
        "current": current,
        "next": next_badge,
        "progress_to_next": (
            min(100, round(100 * (check_count - current["min_checks"]) / (next_badge["min_checks"] - current["min_checks"])))
            if next_badge else 100
        ),
    }


def get_youth_scout(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Youth scout profile — tracks elders they're monitoring."""
    check_count = 11  # demo number
    badge = _current_badge(check_count)
    return {
        "scout_id": "scout_lamin_21",
        "name": "Lamin",
        "age": 21,
        "village": "Kerewan",
        "total_checks": check_count,
        "badge": badge,
        "elders_monitored": [
            {"name": "Grandmother Aminata", "relation": "grandmother", "age": 72, "last_check": "2 days ago", "last_bp": "145/92", "flag": "yellow"},
            {"name": "Uncle Modou", "relation": "uncle", "age": 58, "last_check": "5 days ago", "last_bp": "138/88", "flag": "green"},
            {"name": "Ma Fatou", "relation": "neighbour", "age": 68, "last_check": "1 day ago", "last_bp": "152/94", "flag": "yellow"},
        ],
        "this_week_mission": {
            "title": "Check all 3 elders' BP this week",
            "progress": 2,
            "target": 3,
            "reward": "Unlocks 'Heart Watcher' progress",
        },
        "rank_in_village": 4,
        "total_scouts_in_village": 17,
    }


# ────────────────────────────────────────────────────────────────
# VILLAGE HEALTH SCOREBOARD
# ────────────────────────────────────────────────────────────────

def get_village_scoreboard(village: str = "Kerewan") -> Dict[str, Any]:
    """5-pillar village scoreboard, each 0-20, total 100."""
    # Demo scores
    pillars = [
        {"id": "screening", "name": "Screening rate", "score": 14, "max": 20,
         "detail": "58% of adults 35+ checked this month. Target: 75%."},
        {"id": "adherence", "name": "Medication adherence", "score": 16, "max": 20,
         "detail": "82% of diagnosed patients report daily medicine."},
        {"id": "diet", "name": "Dietary improvement", "score": 12, "max": 20,
         "detail": "43 healthy cooking tips tried this week across circles."},
        {"id": "youth", "name": "Youth engagement", "score": 15, "max": 20,
         "detail": "17 active scouts, 68 completed missions this month."},
        {"id": "emergency", "name": "Emergency response", "score": 13, "max": 20,
         "detail": "Avg 28 min from alert → health post. Target: under 20 min."},
    ]
    total = sum(p["score"] for p in pillars)
    return {
        "village": village,
        "region": "North Bank",
        "score": total,
        "max_score": 100,
        "regional_rank": 3,
        "regional_total": 24,
        "trend": "up",  # up / flat / down
        "delta_from_last_month": +4,
        "pillars": pillars,
        "leading_village": {"name": "Brikama", "score": 72},
        "message_to_alkallo": (
            f"Kerewan village score: {total}/100. You're #3 in North Bank Region. "
            "Brikama is at 72. Focus on screening — only 58% of elders checked this month."
        ),
    }


# ────────────────────────────────────────────────────────────────
# SEASONAL HEALTH RHYTHMS
# ────────────────────────────────────────────────────────────────

def _current_season_gambia() -> Dict[str, Any]:
    """Determine current Gambian season from month."""
    m = datetime.now().month
    # Gambia: dry season Nov-May, rainy/harvest Jun-Oct
    if m in (11, 12, 1, 2):
        return {"id": "cool_dry", "name": "Cool Dry Season", "emoji": "🌤"}
    if m in (3, 4, 5):
        return {"id": "hot_dry", "name": "Hot Dry Season", "emoji": "☀"}
    if m in (6, 7):
        return {"id": "early_rains", "name": "Early Rains", "emoji": "🌦"}
    if m in (8, 9):
        return {"id": "harvest", "name": "Harvest Season", "emoji": "🌾"}
    if m in (10,):
        return {"id": "late_rains", "name": "Late Rains", "emoji": "🌧"}
    return {"id": "cool_dry", "name": "Cool Dry Season", "emoji": "🌤"}


SEASONAL_TIPS: Dict[str, List[Dict[str, str]]] = {
    "cool_dry": [
        {"icon": "💧", "tip": "Mornings are cool — best time to walk 30 minutes before chores."},
        {"icon": "🩺", "tip": "Cool months are the easiest time to start new BP medication — no dehydration risk."},
    ],
    "hot_dry": [
        {"icon": "💧", "tip": "Drink 1 glass of water every hour. Heat dehydrates diabetics fastest."},
        {"icon": "☀", "tip": "Walk at dawn or after Maghrib — not midday. 38°C is dangerous."},
        {"icon": "👣", "tip": "Check your feet tonight if you have diabetes. Hot weather hides small cuts."},
    ],
    "early_rains": [
        {"icon": "💊", "tip": "Wrap pills in a plastic bag — humidity ruins tablets."},
        {"icon": "🦟", "tip": "Mosquitoes return — sleep under a net, malaria is harder on NCD patients."},
    ],
    "harvest": [
        {"icon": "🌾", "tip": "Farm work needs fuel — eat before the field, not just attaya and bread."},
        {"icon": "👣", "tip": "Check your feet nightly — farming wounds get infected fast with diabetes."},
        {"icon": "💧", "tip": "Carry water to the field. 1 litre for every 2 hours of work."},
    ],
    "late_rains": [
        {"icon": "🚗", "tip": "Roads flood — know your backup clinic. Bansang road cuts off often."},
        {"icon": "💊", "tip": "Get a 2-week medicine supply before the flood cuts transport."},
    ],
}


RAMADAN_TIPS = [
    {"icon": "🌙", "tip": "Take metformin at Suhoor (4:30am) WITH food, never on empty stomach."},
    {"icon": "🍽", "tip": "Break fast with dates + water. Wait 15 minutes, then the main meal."},
    {"icon": "⚠", "tip": "If sugar drops below 70 during fast, you MUST break it. Islam permits this."},
    {"icon": "🚶", "tip": "Tarawih prayers count as 45 min of gentle exercise — well done."},
]


def get_seasonal_rhythm() -> Dict[str, Any]:
    """Current seasonal guidance for the user."""
    season = _current_season_gambia()
    tips = SEASONAL_TIPS.get(season["id"], SEASONAL_TIPS["cool_dry"])
    # Deterministic pick for today
    today_seed = datetime.now().strftime("%Y-%m-%d")
    seed = int(hashlib.md5((today_seed + season["id"]).encode()).hexdigest(), 16)
    featured = tips[seed % len(tips)]

    # Detect if Ramadan is active (simplified — production uses real lunar calendar)
    is_ramadan = False  # TODO wire real calculation

    return {
        "season": season,
        "date": datetime.now().strftime("%A, %d %B"),
        "featured_tip": featured,
        "all_tips": tips,
        "is_ramadan": is_ramadan,
        "ramadan_tips": RAMADAN_TIPS if is_ramadan else [],
        "month": datetime.now().strftime("%B"),
    }


# ────────────────────────────────────────────────────────────────
# HEALER + CHW BRIDGE
# ────────────────────────────────────────────────────────────────

def get_healer_bridge(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Dual-path care status — what the user is doing across traditional + modern."""
    return {
        "user_id": user_id or "demo",
        "traditional_care": {
            "active": True,
            "practitioner": "Local marabout",
            "practices": ["Prayers for wellbeing", "Bitter leaf tea (herbal)"],
            "last_visit_days_ago": 9,
        },
        "modern_care": {
            "active": True,
            "facility": "Kerewan Health Centre",
            "chw_name": "VHW Mariama",
            "medications": ["Amlodipine 5mg daily"],
            "last_visit_days_ago": 14,
        },
        "interactions_flag": {
            "safe": True,
            "notes": "Bitter leaf tea has no known interaction with amlodipine.",
        },
        "progress": {
            "bp_start": "160/100",
            "bp_current": "135/85",
            "months_on_plan": 3,
            "message": "Both paths are working together. Your pressure has dropped 25 points in 3 months.",
        },
        "next_action": "Visit Kerewan Health Centre next week for BP check.",
        "supply": {
            "medicine": "Amlodipine",
            "days_remaining": 6,
            "where_to_refill": "Kerewan clinic — in stock, 20 dalasi / 30 tablets",
        },
    }
