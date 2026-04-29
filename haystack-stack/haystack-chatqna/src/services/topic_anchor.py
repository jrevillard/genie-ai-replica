"""
AMINA Care — Topic Anchor
============================
Prevents conversation topic drift on ambiguous short messages.

Problem: when a patient says "sometimes" or "yes" or "okay", the LLM
has access to 6 turns of history + patient key facts (conditions,
medications, allergies). It may latch onto an old topic (like dizziness
from a previous session) instead of staying on the current conversation
topic (exercise).

Fix: extract the most recent conversation topic from the last 2 assistant
messages and inject a topic anchor into the prompt. Short/ambiguous user
messages get a hint: "The current conversation topic is [X]. Interpret
the patient's short reply in this context."

This is a prompt-level fix — no model changes needed.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

_log = logging.getLogger("topic_anchor")

_SHORT_MSG_THRESHOLD = 5  # words
_AMBIGUOUS_PATTERNS = re.compile(
    r"^(?:yes|yeah|yep|yea|ok|okay|sure|sometimes|maybe|no|nope|nah|"
    r"i think so|i guess|not sure|please|thanks|thank you|"
    r"can you|could you|help|why|how|what|really|"
    r"i see|alright|fine|good|great|hmm|hm|"
    r"i dont know|i don't know|idk|"
    r"go ahead|tell me|show me|"
    r"i dont have any plans|"
    r"more|again|continue|same|another)$",
    re.IGNORECASE,
)

_TOPIC_EXTRACTORS = [
    re.compile(r"\b(?:exercise|exercising|workout|walking|jogging|stretching|yoga|fitness|physical activity)\b", re.I),
    re.compile(r"\b(?:diet|meal|food|eating|breakfast|lunch|dinner|nutrition|cook|recipe)\b", re.I),
    re.compile(r"\b(?:medication|medicine|pill|tablet|dose|prescription|drug)\b", re.I),
    re.compile(r"\b(?:blood pressure|bp|hypertension)\b", re.I),
    re.compile(r"\b(?:blood sugar|glucose|diabetes|insulin|hba1c)\b", re.I),
    re.compile(r"\b(?:sleep|insomnia|rest|bedtime|wake up)\b", re.I),
    re.compile(r"\b(?:stress|anxiety|mental health|depression|worry|worried)\b", re.I),
    re.compile(r"\b(?:pregnancy|pregnant|antenatal|prenatal)\b", re.I),
    re.compile(r"\b(?:timetable|schedule|routine|plan|daily plan)\b", re.I),
    re.compile(r"\b(?:weight|bmi|overweight|obesity)\b", re.I),
    re.compile(r"\b(?:appointment|clinic|hospital|doctor|nurse|visit)\b", re.I),
    re.compile(r"\b(?:asthma|breathing|respiratory|cough|inhaler)\b", re.I),
    re.compile(r"\b(?:cholesterol|lipid|heart|cardiovascular)\b", re.I),
    re.compile(r"\b(?:ramadan|fasting|iftar|suhoor)\b", re.I),
    re.compile(r"\b(?:water|hydration|fluid|drink)\b", re.I),
]

_TOPIC_LABELS = {
    0: "exercise and physical activity",
    1: "diet and nutrition",
    2: "medication management",
    3: "blood pressure and hypertension",
    4: "blood sugar and diabetes",
    5: "sleep and rest",
    6: "mental health and stress",
    7: "pregnancy and antenatal care",
    8: "daily routine and scheduling",
    9: "weight management",
    10: "appointments and clinic visits",
    11: "respiratory health",
    12: "heart and cardiovascular health",
    13: "Ramadan and fasting",
    14: "hydration",
}


def _extract_topic(text: str) -> Optional[str]:
    """Extract the dominant topic from a message."""
    if not text:
        return None

    scores = {}
    for i, pattern in enumerate(_TOPIC_EXTRACTORS):
        matches = pattern.findall(text)
        if matches:
            scores[i] = len(matches)

    if not scores:
        return None

    best = max(scores, key=scores.get)
    return _TOPIC_LABELS[best]


def is_ambiguous(message: str) -> bool:
    """Check if a message is short/ambiguous enough to need anchoring."""
    msg = message.strip()
    if not msg:
        return False
    word_count = len(msg.split())
    if word_count <= _SHORT_MSG_THRESHOLD:
        return True
    if _AMBIGUOUS_PATTERNS.match(msg):
        return True
    return False


def get_topic_anchor(
    message: str,
    recent_messages: List[Any],
) -> str:
    """Generate a topic anchor instruction if the current message is ambiguous.

    Args:
        message: the current user message
        recent_messages: list of recent Message objects with .role and .content

    Returns:
        A prompt instruction string, or empty string if no anchor needed.
    """
    if not is_ambiguous(message):
        return ""

    recent_assistant = []
    recent_user = []
    for m in reversed(recent_messages or []):
        content = m.content if hasattr(m, "content") else str(m)
        role = m.role if hasattr(m, "role") else "unknown"
        if role == "assistant" and len(recent_assistant) < 2:
            recent_assistant.append(content)
        elif role == "user" and len(recent_user) < 2:
            recent_user.append(content)
        if len(recent_assistant) >= 2 and len(recent_user) >= 2:
            break

    topics = []
    for text in recent_assistant + recent_user:
        topic = _extract_topic(text)
        if topic:
            topics.append(topic)

    if not topics:
        return ""

    from collections import Counter
    topic_counts = Counter(topics)
    primary_topic = topic_counts.most_common(1)[0][0]

    _log.info(
        "topic_anchor: short message '%s' anchored to '%s'",
        message[:40], primary_topic,
    )

    return (
        f"\nCONTEXT ANCHOR: The current conversation is about {primary_topic}. "
        f"The patient's short reply \"{message}\" should be interpreted in "
        f"this context. Stay on the current topic unless the patient clearly "
        f"changes the subject. Do NOT bring up unrelated medical conditions "
        f"from the patient's history unless directly relevant to {primary_topic}.\n"
    )
