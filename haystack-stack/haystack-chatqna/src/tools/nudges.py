"""
One-Spoon Swap — culturally respectful micro-actions.

SELECTION LOGIC (explicit, explainable):

  1. WEEKDAY decides the FOCUS AREA (a 7-day rhythm so nothing repeats
     too often, and the patient learns to expect a theme each day).

       Monday    → Food swap
       Tuesday   → Movement swap
       Wednesday → Hydration / rest
       Thursday  → Medication adherence
       Friday    → Family & community
       Saturday  → Self-monitoring
       Sunday    → Mindfulness

  2. The patient's PRIMARY CONDITION filters the pool:
       diabetes / hypertension / heart_disease / general.

  3. The final pick is DETERMINISTIC for (date, patient_conditions) —
     the same patient sees the same nudge all day, but it changes at
     midnight. Two patients with the same condition see the same one.

The selection rationale is returned to the client so the UI can show
"Tuesday — Movement Focus" and the patient understands *why*.
"""

from typing import Dict, Any, List, Optional
from datetime import datetime
import hashlib

from src.tools.base import BaseTool


# FOCUS rotation by day of week (Monday = 0)
FOCUS_BY_WEEKDAY = {
    0: ("food", "Food swap — small plate changes"),
    1: ("movement", "Movement swap — gentle daily motion"),
    2: ("hydration", "Hydration & rest — water and recovery"),
    3: ("medication", "Medication adherence — take on time"),
    4: ("family", "Family & community — shared wellness"),
    5: ("monitoring", "Self-monitoring — know your numbers"),
    6: ("mindfulness", "Mindfulness — quiet time for your body"),
}


class LifestyleNudgesTool(BaseTool):
    name = "get_lifestyle_nudge"
    description = "Get a One-Spoon Swap micro-action chosen by today's focus area and the patient's condition"
    parameters = ["conditions"]

    # Each nudge is tagged with focus + applicable condition pools.
    # "general" means it fits anyone.
    NUDGES = [
        # ── FOOD ────────────────────────────────────────────────────────
        {"focus": "food", "for": ["hypertension"],
         "title": "The One-Spoon Swap",
         "action": "Use one less Maggi cube (or half a cube) in your benachin or domoda this week.",
         "why": "Less salt lets your heart rest. BP can drop within days."},
        {"focus": "food", "for": ["hypertension", "heart_disease"],
         "title": "The Half-Oil Swap",
         "action": "Use half the palm oil you normally use when cooking domoda or supakanja.",
         "why": "Less oil, same flavour — add more onion and garlic instead."},
        {"focus": "food", "for": ["diabetes"],
         "title": "The Half-Rice Swap",
         "action": "Fill half your plate with vegetables (okra, jaxatu, leafy greens), half with rice.",
         "why": "Vegetables slow down how fast sugar enters your blood."},
        {"focus": "food", "for": ["diabetes"],
         "title": "The Fruit-for-Biscuit Swap",
         "action": "When you want a snack, eat fruit (orange, papaya, mango) instead of biscuits.",
         "why": "Fruit has natural sugar with fibre — much kinder than biscuit sugar."},
        {"focus": "food", "for": ["heart_disease"],
         "title": "The Fish-for-Meat Swap",
         "action": "Replace one meat meal this week with fish (bonga, yaboy, ladyfish).",
         "why": "Fish oil protects your heart — and it's cheaper than beef."},
        {"focus": "food", "for": ["general"],
         "title": "The Vegetable Swap",
         "action": "Add one extra handful of vegetables to your dinner today.",
         "why": "More vegetables = more vitamins = better long-term health."},

        # ── MOVEMENT ────────────────────────────────────────────────────
        {"focus": "movement", "for": ["diabetes"],
         "title": "The After-Meal Walk",
         "action": "Walk slowly for 10 minutes around your compound after one meal today.",
         "why": "A short walk after eating helps your body use the sugar you just ate."},
        {"focus": "movement", "for": ["hypertension", "general"],
         "title": "The Compound Loop",
         "action": "Walk around your compound 3 times today at a comfortable pace.",
         "why": "Regular gentle walking lowers BP naturally over weeks."},
        {"focus": "movement", "for": ["heart_disease"],
         "title": "The Gentle Walk",
         "action": "Walk slowly for 15 minutes — around your compound or to the nearest shop.",
         "why": "Gentle movement strengthens your heart muscle safely."},
        {"focus": "movement", "for": ["general"],
         "title": "The Stretch Swap",
         "action": "Stretch your arms and back slowly for 2 minutes before you sleep tonight.",
         "why": "Gentle stretching relaxes your body and helps sleep come easier."},

        # ── HYDRATION / REST ────────────────────────────────────────────
        {"focus": "hydration", "for": ["general", "diabetes", "hypertension", "heart_disease"],
         "title": "The Water-First Swap",
         "action": "Drink one glass of water BEFORE each meal today.",
         "why": "Water fills you up, supports your BP, and helps your body work well."},
        {"focus": "hydration", "for": ["hypertension"],
         "title": "The Banana Swap",
         "action": "Eat one banana or orange today — potassium balances salt.",
         "why": "Potassium is your BP's best friend. Cheap and powerful."},
        {"focus": "hydration", "for": ["general"],
         "title": "The Morning-Water Swap",
         "action": "Drink one glass of water first thing when you wake up.",
         "why": "Your body has been without water for hours. Start the day hydrated."},
        {"focus": "hydration", "for": ["diabetes"],
         "title": "The Sugar-Drink Swap",
         "action": "Replace one cup of sweet attaya with plain water or unsweetened bissap.",
         "why": "One less sugary drink gives your blood sugar a real break."},

        # ── MEDICATION ──────────────────────────────────────────────────
        {"focus": "medication", "for": ["general", "diabetes", "hypertension", "heart_disease"],
         "title": "The Reminder Swap",
         "action": "Set one alarm (or ask a family member) for your medication today.",
         "why": "One reminder = one less missed dose. Missed doses cost your health."},
        {"focus": "medication", "for": ["general", "diabetes", "hypertension", "heart_disease"],
         "title": "The Bedside Swap",
         "action": "Keep your medicine next to where you sleep or eat — somewhere you'll see it.",
         "why": "If you see it, you remember. Out of sight is out of mind."},
        {"focus": "medication", "for": ["general"],
         "title": "The Pharmacy-Check Swap",
         "action": "Count your tablets today — do you have enough for the next week?",
         "why": "Running out on a Sunday is the most common reason people miss doses."},

        # ── FAMILY & COMMUNITY ──────────────────────────────────────────
        {"focus": "family", "for": ["general", "diabetes", "hypertension", "heart_disease"],
         "title": "The Family Walk",
         "action": "Take a 10-minute walk with a family member today.",
         "why": "Health is a communal journey — walking together keeps everyone stronger."},
        {"focus": "family", "for": ["general"],
         "title": "The Shared Meal Swap",
         "action": "Cook one meal with less salt today — the whole family benefits.",
         "why": "Better habits start in the kitchen. Your family grows healthy with you."},
        {"focus": "family", "for": ["general"],
         "title": "The Tell-One-Person Swap",
         "action": "Share one thing you learned about your health with someone you trust.",
         "why": "Talking about wellness removes shame and builds support."},

        # ── SELF-MONITORING ─────────────────────────────────────────────
        {"focus": "monitoring", "for": ["diabetes"],
         "title": "The Morning Sugar Check",
         "action": "If you have a glucose meter, check your sugar once before breakfast this week.",
         "why": "Even one reading helps you and your nurse understand your pattern."},
        {"focus": "monitoring", "for": ["hypertension"],
         "title": "The BP Check Swap",
         "action": "If you can, check your BP at the pharmacy or health post this week.",
         "why": "Numbers tell you if your treatment is working."},
        {"focus": "monitoring", "for": ["general", "heart_disease"],
         "title": "The How-Do-I-Feel Check",
         "action": "Pause once today and notice how your body feels. Any new aches? Tiredness?",
         "why": "You are your body's first doctor. Notice what changes."},

        # ── MINDFULNESS ─────────────────────────────────────────────────
        {"focus": "mindfulness", "for": ["hypertension", "heart_disease"],
         "title": "The 10-Minute Rest",
         "action": "Sit quietly for 10 minutes today — no phone, no talking. Just breathing.",
         "why": "Stress raises BP. A little quiet time each day helps."},
        {"focus": "mindfulness", "for": ["general"],
         "title": "The Sleep Swap",
         "action": "Go to bed 30 minutes earlier tonight.",
         "why": "Good sleep is medicine your body makes for free."},
        {"focus": "mindfulness", "for": ["general", "diabetes", "hypertension"],
         "title": "The Breathing Swap",
         "action": "Breathe slowly — in for 4 counts, out for 6 counts — 5 times today.",
         "why": "Slow breathing calms your heart and lowers your stress."},
    ]

    async def execute(
        self,
        conditions: Optional[List[str]] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        # ── Step 1: figure out patient's condition pool ─────────────
        patient_pools = set()
        if conditions:
            for c in conditions:
                cl = (c or "").lower()
                if "diabetes" in cl or "dm" in cl:
                    patient_pools.add("diabetes")
                elif "hypertens" in cl or "bp" in cl or "blood pressure" in cl:
                    patient_pools.add("hypertension")
                elif "heart" in cl or "cvd" in cl or "cardiac" in cl:
                    patient_pools.add("heart_disease")
        # "general" is always in the pool — anyone can benefit
        patient_pools.add("general")

        # ── Step 2: pick today's focus from day-of-week ─────────────
        now = datetime.now()
        weekday = now.weekday()
        focus, focus_label = FOCUS_BY_WEEKDAY[weekday]

        # ── Step 3: filter nudges by (focus, condition pool) ────────
        candidates = [
            n for n in self.NUDGES
            if n["focus"] == focus
            and any(tag in patient_pools for tag in n["for"])
        ]
        if not candidates:
            # Fallback: any nudge for this focus
            candidates = [n for n in self.NUDGES if n["focus"] == focus]
        if not candidates:
            # Ultimate fallback: first nudge in list
            candidates = [self.NUDGES[0]]

        # ── Step 4: deterministic pick for (date, patient) ──────────
        seed_input = now.strftime("%Y-%m-%d") + "|" + "|".join(sorted(patient_pools))
        seed = int(hashlib.md5(seed_input.encode()).hexdigest(), 16)
        nudge = candidates[seed % len(candidates)]

        # Which condition bucket actually matched, for UI display
        matched_condition = next(
            (tag for tag in nudge["for"] if tag in patient_pools and tag != "general"),
            "general",
        )

        return {
            "date": now.strftime("%Y-%m-%d"),
            "weekday": now.strftime("%A"),
            "focus": focus,
            "focus_label": focus_label,
            "matched_condition": matched_condition,
            "patient_pools": sorted(patient_pools),
            "title": nudge["title"],
            "action": nudge["action"],
            "why": nudge["why"],
            "selection_reason": (
                f"{now.strftime('%A')}s are {focus} days. "
                f"Matched to your {matched_condition} context."
            ),
            "philosophy": "One small swap this week. One more next week. That is how wellness grows.",
        }
