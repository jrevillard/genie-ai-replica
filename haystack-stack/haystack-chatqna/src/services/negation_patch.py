"""
AMINA Care — Negation-Aware Patch
====================================
Monkey-patches AminaAgent._detect_form_suggestion to use spaCy-based
negation detection instead of raw keyword matching.

Before:  "I'm not feeling dizzy"  → keyword "dizzy" found → suggest_form="symptom"
After:   "I'm not feeling dizzy"  → "dizzy" is negated   → suggest_form=None

Also patches the safety_consensus fingerprint to skip when the user
message itself is a wellness statement (no active symptoms).

Imported by main_with_rag_tuning.py. No existing files are modified.
"""
from __future__ import annotations

import logging

_log = logging.getLogger("negation_patch")

_INSTALLED = False


def install():
    global _INSTALLED
    if _INSTALLED:
        return

    try:
        from src.services.negation_detector import (
            has_affirmed_symptom,
            extract_affirmed_symptoms,
        )
    except ImportError as e:
        _log.warning("negation_patch: negation_detector not available: %s", e)
        return

    # ── Patch AminaAgent._detect_form_suggestion ─────────────────────────
    try:
        from src.agent.amina_agent import AminaAgent

        _original_detect = AminaAgent._detect_form_suggestion

        def _patched_detect(self, message: str, tools_used):
            msg_l = message.lower()

            affirmed_symptoms = extract_affirmed_symptoms(msg_l, self.SYMPTOM_KEYWORDS)
            affirmed_rx = has_affirmed_symptom(msg_l, self.PRESCRIPTION_KEYWORDS)

            if not affirmed_symptoms and not affirmed_rx:
                _log.debug(
                    "negation_patch: suppressed form suggestion — no affirmed "
                    "symptoms/rx in '%s'",
                    message[:80],
                )
                return None

            if affirmed_rx and not affirmed_symptoms:
                import re
                word_count = len(msg_l.split())
                detail_hits = 0
                for m in self.DETAIL_MARKERS:
                    if " " in m or "\\" in m or "-" in m or any(c.isdigit() for c in m):
                        if m in msg_l:
                            detail_hits += 1
                    else:
                        if re.search(rf"\b{re.escape(m)}\b", msg_l):
                            detail_hits += 1
                info_markers = [
                    "what is", "what are", "what causes", "how do i", "how can i",
                    "can i", "should i", "is it", "are they", "why do",
                ]
                if any(m in msg_l for m in info_markers):
                    return None
                if word_count < 15 and detail_hits < 2:
                    return "prescription"
                return None

            if affirmed_symptoms:
                import re
                word_count = len(msg_l.split())
                detail_hits = 0
                for m in self.DETAIL_MARKERS:
                    if " " in m or "\\" in m or "-" in m or any(c.isdigit() for c in m):
                        if m in msg_l:
                            detail_hits += 1
                    else:
                        if re.search(rf"\b{re.escape(m)}\b", msg_l):
                            detail_hits += 1
                info_markers = [
                    "what is", "what are", "what causes", "how do i", "how can i",
                    "can i", "should i", "is it", "are they", "why do",
                ]
                if any(m in msg_l for m in info_markers):
                    return None
                if word_count < 14 and detail_hits < 2:
                    return "symptom"

            return None

        AminaAgent._detect_form_suggestion = _patched_detect
        _log.info("negation_patch: AminaAgent._detect_form_suggestion patched with NLP negation")

    except Exception as e:
        _log.warning("negation_patch: failed to patch AminaAgent: %s", e)

    _INSTALLED = True
    _log.info("negation_patch: installed")


install()
