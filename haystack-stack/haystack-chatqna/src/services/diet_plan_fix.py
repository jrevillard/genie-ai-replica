"""
Diet Plan Fix — patches the conversational pacer to produce concise,
non-repetitive meal plans with Mandinka food annotations.

Problems fixed:
  1. "to help manage your blood sugar levels" repeated after every meal
  2. 500+ word plans when 300 is optimal for comprehension + SMS/voice
  3. No Mandinka food names inline
  4. No concise intro/closing structure

Monkey-patches `build_pacing_instruction` for the structured_plan
turn type to use the improved template.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


_IMPROVED_PLAN_TEMPLATE = """STRUCTURED PLAN REQUEST — generate a concise weekly meal plan.

STRUCTURE (follow EXACTLY):

1. INTRO (1 short paragraph, 2-3 sentences max):
   State the key dietary changes for this patient's condition.
   Name the 3-4 most helpful Gambian foods. No medical jargon.
   Example: "This plan uses moringa (Nebedaye), okra (Kanjaa), and bitter tomato (Jaxatu) to help your blood sugar. Less rice, more vegetables, less Maggi."

2. DAILY MEALS (one block per day, simple format):
   **Monday (Teneŋo)**
   - Morning: Moringa porridge (Mono) with half tapalapa
   - Midday: Benachin with double okra (Kanjaa), less rice
   - Evening: Supakanja with chere (Chereh)

   RULES for meals:
   - Put the Mandinka food name in parentheses after EACH food item
   - Use ONLY these Gambian foods: moringa/Nebedaye, benachin, domoda, supakanja, chere/Chereh, mbahal, nyebbeh, tapalapa, baobab juice/Buyii jii, bissap, mono/fura, laaciiri, jaxatu, kanjaa, nyaankataŋ, churaa gerté, tia durango, jéwoo (fish)
   - Vary meals across days — never repeat the same dish two days in a row
   - Include seasonal notes where relevant: moringa year-round, okra rainy season (Jun-Oct)
   - DO NOT explain why each food helps after every meal. Say it ONCE in the intro.
   - DO NOT write "to help manage your blood sugar levels" or similar after meals
   - Keep each day to 3-4 lines maximum

3. CLOSING (2-3 sentences max):
   "Start with Monday (Teneŋo). If it feels manageable, continue to Tuesday (Talaato). One day at a time. Tell me how it goes tomorrow."
   Add one tip about lumo market shopping if relevant.

HARD LIMITS:
- Maximum 280 words total
- Maximum 25 sentences
- No health explanations per meal — explain once in intro
- No sign-offs, no "remember to", no "it's important to"
- No repeated justifications
"""


def _install_patch():
    """Patch build_pacing_instruction for structured_plan turn type."""

    try:
        from src.services import conversational_pacer as pacer
    except ImportError:
        logger.warning("diet_plan_fix: conversational_pacer not importable")
        return

    _original = pacer.build_pacing_instruction
    if getattr(_original, "_diet_plan_patched", False):
        return

    def _patched_build(
        turn_type, current_topic=None, queue_depth=0, patient_name="",
    ):
        if turn_type != "structured_plan":
            return _original(turn_type, current_topic, queue_depth, patient_name)

        template = _IMPROVED_PLAN_TEMPLATE
        if patient_name:
            template += f"\n- Address the patient as '{patient_name}'."

        return template

    _patched_build._diet_plan_patched = True
    pacer.build_pacing_instruction = _patched_build
    logger.info("diet_plan_fix: structured_plan template patched")


try:
    _install_patch()
except Exception as exc:
    logger.warning("diet_plan_fix: install failed: %s", exc)
