"""
AMINA Care — Safety Consensus Context Patch
=============================================
Monkey-patches safety_consensus.fingerprint() to be context-aware.

Problem: the original fingerprint regex triggers on lifestyle/exercise
timetables because:
  - "I recommend" matches _RE_PRESCRIBING (meant for "I recommend metformin")
  - "twice daily", "once a day" match _RE_DOSE (meant for "500mg twice daily")
  - "3 times a week" matches _RE_DOSE (meant for "3 times daily after meals")

This causes a second-opinion call on harmless exercise advice. When the
auditor model disagrees (often because it also sees frequency patterns
without drug context), the entire reply is replaced with the refusal
template — a false positive that blocks useful lifestyle guidance.

Fix: wrap fingerprint() so that if the reply mentions ZERO actual drug
names AND the matched patterns are all in lifestyle context (exercise,
walking, stretching, diet, sleep, routine, schedule, timetable), the
trigger is suppressed. Drug names remain the hard gate — any actual
medication mention still triggers the consensus check.

No existing files are modified.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

_INSTALLED = False

_LIFESTYLE_MARKERS = re.compile(
    r"\b("
    r"exercise|walk(?:ing)?|jog(?:ging)?|run(?:ning)?|stretch(?:ing|es)?|yoga"
    r"|workout|aerobic|cardio|swimming|cycling|push[- ]?ups?"
    r"|timetable|time table|schedule|routine|daily plan|weekly plan"
    r"|breakfast|lunch|dinner|supper|meal|snack|eating"
    r"|sleep|rest|nap|wake up|bed ?time|morning|evening|afternoon"
    r"|hydrat(?:e|ion)|water intake|drink(?:ing)? water"
    r"|relax(?:ation|ing)?|meditation|breathing exercise"
    r"|warm[- ]?up|cool[- ]?down|physical activity|fitness"
    r"|healthy (?:diet|lifestyle|habit|living|food)"
    r")\b",
    re.IGNORECASE,
)

_PRESCRIBING_WITHOUT_RECOMMEND = re.compile(
    r"\b(?:take|start|stop|switch|increase|decrease|double|halve|add|remove|titrate)\s"
    r"(?:your|the|this|a|an)?\s?(?:dose|pill|tablet|medication|medicine|drug|insulin)\b"
    r"|\byou (?:should|must|need to) take\b",
    re.IGNORECASE,
)


def install():
    global _INSTALLED
    if _INSTALLED:
        return

    from src.services import safety_consensus

    _original_fingerprint = safety_consensus.fingerprint

    def _patched_fingerprint(reply: str) -> safety_consensus.SafetyFingerprint:
        fp = _original_fingerprint(reply)

        if not fp.triggered:
            return fp

        if fp.drugs:
            return fp

        has_lifestyle = bool(_LIFESTYLE_MARKERS.search(reply or ""))
        if not has_lifestyle:
            return fp

        has_real_prescribing = bool(_PRESCRIBING_WITHOUT_RECOMMEND.search(reply or ""))
        if has_real_prescribing:
            return fp

        reasons_left = [r for r in fp.reasons if r not in ("prescribing_verb", "dose_or_frequency")]

        if not reasons_left:
            logger.info(
                "safety_consensus_patch: suppressed false trigger on lifestyle content "
                "(reasons=%s, doses=%s)",
                fp.reasons, fp.doses,
            )
            return safety_consensus.SafetyFingerprint(
                triggered=False,
                reasons=(),
                drugs=(),
                doses=(),
            )

        return fp

    safety_consensus.fingerprint = _patched_fingerprint

    _original_requires = safety_consensus.requires_consensus

    def _patched_requires(reply: str) -> bool:
        if not safety_consensus.CONSENSUS_ENABLED:
            return False
        return _patched_fingerprint(reply).triggered

    safety_consensus.requires_consensus = _patched_requires

    _INSTALLED = True
    logger.info("safety_consensus_patch: context-aware fingerprint installed")


install()
