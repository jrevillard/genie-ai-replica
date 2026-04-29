"""Notification Intent Detector — NLP-based decision for when to show
the 'Stay in Touch' notification preferences modal.

Replaces the naive heuristic (4 messages OR goodbye keyword) with a
multi-layer intent analysis that only triggers when the conversation
topic genuinely warrants follow-up notifications.

Decision layers:
  1. Quick reject  — emergency, already asked, too few exchanges
  2. Explicit intent — user directly asks about reminders
  3. Topic analysis — chronic conditions, care plans, medication
  4. Tool signals   — care_plan, vitals, diet tools used
  5. Engagement     — depth and quality of conversation
  6. Anti-signals   — quick Q&A, frustration, mid-flow
  7. Timing         — natural pause point detection

Score >= 0.5 → suggest notifications
Score <  0.5 → skip

Wired into AminaAgent.process_message via monkey-patch at import time.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

__all__ = ["NotificationIntentDetector", "get_detector"]

logger = logging.getLogger(__name__)


# ====================================================================
# PATTERN DEFINITIONS
# ====================================================================

_EXPLICIT_INTENT_RE = re.compile(
    r"\b(?:"
    r"remind\s+me|set\s+(?:a\s+)?reminder|notification|"
    r"follow[\s-]?up|alert\s+me|don'?t\s+forget|"
    r"how\s+will\s+I\s+(?:know|remember)|"
    r"send\s+me|notify\s+me|"
    r"whatsapp|telegram|sms|text\s+me|"
    r"keep\s+me\s+(?:updated|informed|posted)|"
    r"check\s+(?:on|in\s+with)\s+me"
    r")\b",
    re.IGNORECASE,
)

_CHRONIC_CONDITION_RE = re.compile(
    r"\b(?:"
    r"diabet(?:es|ic)|hypertension|high\s+blood\s+pressure|"
    r"bp|hba1c|blood\s+sugar|glucose|insulin|"
    r"chronic|ongoing|long[\s-]?term|"
    r"asthma|heart\s+(?:disease|failure|condition)|"
    r"kidney|renal|epilepsy|hiv|sickle\s+cell|"
    r"arthritis|thyroid|anemia|anaemia|"
    r"sukari-kuurango|joloo\s+buntango"
    r")\b",
    re.IGNORECASE,
)

_CARE_PLAN_RE = re.compile(
    r"\b(?:"
    r"care\s+plan|diet\s+plan|meal\s+plan|exercise\s+plan|"
    r"treatment\s+plan|management\s+plan|"
    r"weekly\s+(?:plan|schedule|routine)|"
    r"daily\s+(?:plan|schedule|routine)|"
    r"medication\s+(?:schedule|routine|plan)|"
    r"laahidu|taama-taama\s+laahidu"
    r")\b",
    re.IGNORECASE,
)

_MEDICATION_RE = re.compile(
    r"\b(?:"
    r"metformin|amlodipine|glibenclamide|insulin|"
    r"lisinopril|losartan|atenolol|nifedipine|enalapril|"
    r"hydrochlorothiazide|"
    r"take\s+(?:your\s+)?(?:medicine|medication|pills?|tablets?|drugs?)|"
    r"dose|dosage|prescription|refill|"
    r"furango\s+dong|furango\s+domo"
    r")\b",
    re.IGNORECASE,
)

_APPOINTMENT_RE = re.compile(
    r"\b(?:"
    r"appointment|check[\s-]?up|visit\s+(?:the\s+)?(?:doctor|clinic|hospital)|"
    r"next\s+visit|come\s+back|return\s+(?:to|visit)|"
    r"schedule|book|follow[\s-]?up\s+(?:visit|appointment)|"
    r"dokitaroo\s+nininkaa|ospitaali\s+taa"
    r")\b",
    re.IGNORECASE,
)

_CAREGIVER_RE = re.compile(
    r"\b(?:"
    r"caregiver|care\s+giver|taking\s+care\s+of|"
    r"my\s+(?:mother|father|parent|child|husband|wife|patient)|"
    r"monitor(?:ing)?\s+(?:his|her|their|the\s+patient)|"
    r"vitals?\s+(?:check|record|track)"
    r")\b",
    re.IGNORECASE,
)

_FRUSTRATION_RE = re.compile(
    r"\b(?:"
    r"this\s+(?:doesn'?t|does\s+not)\s+(?:work|help)|"
    r"wrong\s+(?:answer|information|advice)|"
    r"useless|terrible|awful|horrible|"
    r"stop\s+(?:asking|showing|bothering)|"
    r"leave\s+me\s+alone|go\s+away|"
    r"I\s+(?:don'?t|do\s+not)\s+(?:want|need|care)|"
    r"not\s+helpful|waste\s+of\s+time"
    r")\b",
    re.IGNORECASE,
)

_QUICK_QUERY_RE = re.compile(
    r"\b(?:"
    r"what\s+is|what'?s|define|meaning\s+of|"
    r"how\s+(?:much|many|long|far)|"
    r"is\s+it\s+(?:true|normal|okay|safe)|"
    r"can\s+(?:I|you)|where\s+(?:is|can)|"
    r"tell\s+me\s+about"
    r")\b",
    re.IGNORECASE,
)

_GENUINE_GOODBYE_RE = re.compile(
    r"^\s*(?:"
    r"(?:ok(?:ay)?[\s,]*)?(?:goodbye|bye[\s-]?bye|bye)\s*[.!]?\s*$|"
    r"that'?s\s+all\s+(?:I\s+need(?:ed)?|for\s+(?:now|today))\s*[.!]?\s*$|"
    r"nothing\s+(?:else|more)\s*[.!]?\s*$|"
    r"I'?m\s+(?:done|good|fine)\s*(?:now|for\s+now|thanks?)?\s*[.!]?\s*$"
    r")",
    re.IGNORECASE,
)

_TOOLS_HIGH_SIGNAL = frozenset({
    "generate_care_plan", "get_diet_advice", "diet", "meal_plan",
    "check_vitals", "record_vitals", "vitals_trend",
    "schedule_followup", "set_reminder",
    "medication_check", "drug_interaction",
    "caregiver_summary", "patient_summary",
})

_TOOLS_MEDIUM_SIGNAL = frozenset({
    "symptom_check", "triage", "health_assessment",
    "search_knowledge", "clinical_guidelines",
})


# ====================================================================
# DETECTOR CLASS
# ====================================================================

class NotificationIntentDetector:
    """Multi-layer NLP analysis to decide if notification preferences
    modal should be shown."""

    THRESHOLD = 0.5

    def should_suggest(
        self,
        user_messages: List[str],
        agent_response: str,
        tools_used: List[str],
        followup: Optional[Any],
        latest_message: str,
        triage_level: Optional[str] = None,
        already_asked: bool = False,
        user_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Analyze conversation and return notification suggestion decision.

        Returns:
            {"suggest": bool, "reason": str, "score": float, "signals": [...]}
        """
        signals: List[str] = []
        score = 0.0

        # ── Layer 1: Quick Reject ────────────────────────────────────
        if already_asked:
            return self._result(False, 0.0, "already_asked_this_session", [])

        if triage_level == "EMERGENCY":
            return self._result(False, 0.0, "emergency_active", [])

        # ── Layer 2: Explicit Intent (checked before msg count) ──────
        if _EXPLICIT_INTENT_RE.search(latest_message):
            return self._result(True, 1.0, "explicit_reminder_request", ["explicit_intent"])

        for msg in user_messages[-3:]:
            if _EXPLICIT_INTENT_RE.search(msg):
                return self._result(True, 0.9, "recent_explicit_request", ["explicit_intent"])

        meaningful = [m for m in user_messages if len(m.strip()) > 10]
        if len(meaningful) < 3:
            return self._result(False, 0.0, "too_few_exchanges", [])

        # ── Layer 3: Topic Analysis ──────────────────────────────────
        all_text = " ".join(user_messages) + " " + agent_response

        if _CHRONIC_CONDITION_RE.search(all_text):
            score += 0.35
            signals.append("chronic_condition")

        if _CARE_PLAN_RE.search(all_text):
            score += 0.25
            signals.append("care_plan_discussed")

        if _MEDICATION_RE.search(all_text):
            score += 0.2
            signals.append("medication_discussed")

        if _APPOINTMENT_RE.search(all_text):
            score += 0.15
            signals.append("appointment_discussed")

        if _CAREGIVER_RE.search(all_text):
            score += 0.15
            signals.append("caregiver_context")

        # ── Layer 4: Tool Signals ────────────────────────────────────
        tools_set = set(t.lower() if isinstance(t, str) else "" for t in tools_used)

        high_tools = tools_set & _TOOLS_HIGH_SIGNAL
        if high_tools:
            score += 0.3
            signals.append(f"high_signal_tools:{','.join(high_tools)}")

        medium_tools = tools_set & _TOOLS_MEDIUM_SIGNAL
        if medium_tools and not high_tools:
            score += 0.1
            signals.append(f"medium_signal_tools:{','.join(medium_tools)}")

        if followup:
            score += 0.25
            signals.append("followup_scheduled")

        # ── Layer 5: Engagement ──────────────────────────────────────
        if len(meaningful) >= 6:
            score += 0.1
            signals.append("deep_conversation")

        if user_role in ("caregiver", "vhw", "alkalo"):
            score += 0.1
            signals.append(f"elevated_role:{user_role}")

        # ── Layer 6: Anti-Signals ────────────────────────────────────
        if _FRUSTRATION_RE.search(latest_message):
            score -= 0.5
            signals.append("frustration_detected")

        if len(meaningful) <= 3 and _QUICK_QUERY_RE.search(user_messages[0] if user_messages else ""):
            score -= 0.3
            signals.append("quick_query_pattern")

        # ── Layer 7: Timing ──────────────────────────────────────────
        is_goodbye = bool(_GENUINE_GOODBYE_RE.search(latest_message))
        is_acknowledgment = bool(re.search(
            r"^\s*(?:ok(?:ay)?|got\s+it|understood|I\s+(?:will|'ll)|alright|sure|noted)",
            latest_message, re.IGNORECASE,
        ))
        has_substance = score >= 0.3

        if is_goodbye and has_substance:
            score += 0.1
            signals.append("natural_goodbye")
        elif is_acknowledgment and has_substance:
            signals.append("user_acknowledged")
        elif not is_goodbye and score < 0.6:
            score -= 0.05
            signals.append("mid_conversation")

        # ── Decision ─────────────────────────────────────────────────
        suggest = score >= self.THRESHOLD
        reason = ", ".join(signals[:3]) if signals else "no_signals"

        return self._result(suggest, round(score, 2), reason, signals)

    @staticmethod
    def _result(
        suggest: bool, score: float, reason: str, signals: List[str],
    ) -> Dict[str, Any]:
        return {
            "suggest": suggest,
            "score": score,
            "reason": reason,
            "signals": signals,
        }


# ====================================================================
# SINGLETON
# ====================================================================

_instance: Optional[NotificationIntentDetector] = None


def get_detector() -> NotificationIntentDetector:
    global _instance
    if _instance is None:
        _instance = NotificationIntentDetector()
    return _instance


# ====================================================================
# MONKEY-PATCH: Override AminaAgent.process_message
# ====================================================================

def _install_patch():
    """Wrap AminaAgent.process_message to replace the naive notification
    heuristic with NLP-based intent detection."""

    try:
        from src.agent.amina_agent import AminaAgent
    except ImportError:
        logger.warning("notification_intent: AminaAgent not importable")
        return

    _original = AminaAgent.process_message
    if getattr(_original, "_notification_intent_patched", False):
        return

    async def _patched_process_message(self, message, session_id, **kwargs):
        result = await _original(self, message, session_id, **kwargs)

        try:
            memory = self.get_or_create_session(session_id)
            detector = get_detector()

            user_msgs = [m.content for m in memory.messages if m.role == "user"]

            decision = detector.should_suggest(
                user_messages=user_msgs,
                agent_response=result.get("response", ""),
                tools_used=result.get("tools_used", []),
                followup=result.get("followup"),
                latest_message=message,
                triage_level=getattr(memory.patient_context, "triage_level", None),
                already_asked=memory.notifications_asked,
                user_role=getattr(memory, "user_role", None),
            )

            original_decision = result.get("suggest_notifications", False)

            if original_decision and not decision["suggest"]:
                result["suggest_notifications"] = False
                memory.notifications_asked = False
                logger.info(
                    "NOTIF_INTENT: suppressed (score=%.2f, reason=%s)",
                    decision["score"], decision["reason"],
                )
            elif not original_decision and decision["suggest"]:
                result["suggest_notifications"] = True
                memory.notifications_asked = True
                logger.info(
                    "NOTIF_INTENT: activated (score=%.2f, reason=%s, signals=%s)",
                    decision["score"], decision["reason"],
                    decision["signals"][:3],
                )
            elif decision["suggest"]:
                logger.info(
                    "NOTIF_INTENT: confirmed (score=%.2f, reason=%s)",
                    decision["score"], decision["reason"],
                )

        except Exception as exc:
            logger.warning("notification_intent patch failed (non-fatal): %s", exc)

        return result

    _patched_process_message._notification_intent_patched = True
    AminaAgent.process_message = _patched_process_message
    logger.info("notification_intent: AminaAgent.process_message patched")


try:
    _install_patch()
except Exception as exc:
    logger.warning("notification_intent: install failed: %s", exc)
