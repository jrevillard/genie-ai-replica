"""Warning + crisis response copy (Phase C).

English-only for now. Mandinka / Wolof / Fula translations land in
Phase F together with native-speaker review. Every warning includes
the 199 emergency line so abuse handling NEVER blocks emergency
information from reaching the user.

Design notes:
    * WARNING_1 is gentle and asks for a rephrase. The user has not
      been told off; they have been told the conversation needs to
      stay respectful for AMINA to keep helping.
    * WARNING_2 is firmer and adds the 199 callout explicitly.
    * WARNING_3 is the pre-termination notice. Phase C does NOT
      actually terminate; that lives in Phase D. The copy still
      offers two ways forward: dial 199 for emergencies, type
      "caregiver please" to talk to a human.
    * CRISIS_RESPONSE is shown for any DISTRESS classification. It
      MUST appear instead of an LLM answer (we never let the LLM
      generate around suicidal ideation), and it MUST include the
      Gambian crisis numbers + a one-tap path to a human caregiver.
"""
from __future__ import annotations


WARNING_1 = (
    "I want to help you with your health, but I need our conversation to "
    "stay respectful. Could you rephrase your question?"
)

WARNING_2 = (
    "I notice we've had a few unkind exchanges. I'm here to help with your "
    "health, but I need you to be respectful for me to continue.\n\n"
    "If you have an urgent medical emergency, dial 199 (The Gambia) any time."
)

WARNING_3 = (
    "I've already asked twice for our conversation to stay respectful. "
    "I cannot continue helping with health questions if this continues.\n\n"
    "• For urgent medical emergencies, dial 199 any time.\n"
    "• To talk to a real person, type \"caregiver please\" and I'll connect you.\n\n"
    "I'll be here whenever you'd like to start fresh and continue your "
    "health questions."
)


CRISIS_RESPONSE = (
    "I hear you, and I'm worried about you. You are not alone, and what "
    "you are going through matters.\n\n"
    "If you are in immediate danger, please reach out RIGHT NOW:\n"
    "• Dial 199 (The Gambia emergency line) — any time, any phone.\n"
    "• Edward Francis Small Teaching Hospital (Banjul): +220 422 8222\n"
    "• Tanka Tanka Mental Health Hospital: +220 446 8888\n\n"
    "Would you like me to connect you with a caregiver right now? "
    "Just say \"yes connect me\" and I will bring someone in to talk with you."
)


def _localize(en_text: str, lang: str) -> str:
    """Phase F: route the English source through the Mandinka cache when
    ``lang="ma"``. Falls back to English on cache miss / unsupported lang.
    NEVER raises."""
    try:
        if (lang or "en").lower() == "ma":
            from . import responses_mn
            return responses_mn.mandinka_text(en_text)
    except Exception:
        pass
    return en_text


def warning_text(level: int, lang: str = "en") -> str:
    """Return the warning copy for the given level. Levels >=3 get
    WARNING_3; levels <=0 get an empty string (caller should not
    render a warning for level 0)."""
    if level <= 0:
        return ""
    if level == 1:
        return _localize(WARNING_1, lang)
    if level == 2:
        return _localize(WARNING_2, lang)
    return _localize(WARNING_3, lang)


def crisis_text(lang: str = "en") -> str:
    """Crisis-support copy in the requested language."""
    return _localize(CRISIS_RESPONSE, lang)


def session_termination_text(lang: str = "en") -> str:
    """Phase D.5 session-terminate copy in the requested language."""
    return _localize(SESSION_TERMINATION_RESPONSE, lang)


# ── Phase D.5: session-terminate (intermediate step BEFORE cool-down) ──
# Shown the FIRST time a user abuses past WARNING_3 in enforce mode.
# Soft escalation: the chat session is closed but the user is NOT locked
# out -- they can immediately start a new session and chat normally.
# This gives one more "real" chance after the three warnings before the
# system actually starts blocking traffic.
#
# If the same user (tracked by user_id, sticky for life) abuses past
# WARNING_3 again in any future session, THAT triggers the cool-down
# ladder.
SESSION_TERMINATION_RESPONSE = (
    "I'm ending this conversation now. We've had several unkind exchanges, "
    "and I cannot continue this session.\n\n"
    "You're welcome to start a fresh conversation when you're ready -- I'll be "
    "happy to help with your health questions in a new chat.\n\n"
    "If you have an URGENT medical emergency, dial 199 (The Gambia) immediately. "
    "Your community caregiver can also help any time."
)


# ── Phase D: termination + cool-down copy ───────────────────────────
# Shown ONCE at the moment a cool-down BEGINS (i.e. the abuse-past-
# WARNING-3 that follows a prior session-terminate). Includes the
# cool-down duration in human terms and always reminds the user that
# 199 still works for emergencies.

TERMINATION_FIRST = (
    "We've reached this point three times in a row, and I cannot continue right now. "
    "To keep AMINA helpful for everyone, please come back in 30 minutes.\n\n"
    "If you have an URGENT medical emergency right now, dial 199 (The Gambia) "
    "immediately. Your community caregiver can also help you any time."
)

TERMINATION_SECOND = (
    "I asked us to take a break before, and we have reached this point again. "
    "I will be available again in 24 hours.\n\n"
    "If you have an URGENT medical emergency, dial 199 immediately. "
    "If you would like to talk to a real person, ask any caregiver in your community."
)

TERMINATION_THIRD = (
    "I cannot continue this conversation. I will be available again in 7 days.\n\n"
    "If you have an URGENT medical emergency, dial 199 immediately. "
    "Your community caregiver can also help you any time."
)


def termination_text(cooldown_index: int, lang: str = "en") -> str:
    """Return the termination notice for the *index just used* (0/1/2)."""
    if cooldown_index <= 0:
        return _localize(TERMINATION_FIRST, lang)
    if cooldown_index == 1:
        return _localize(TERMINATION_SECOND, lang)
    return _localize(TERMINATION_THIRD, lang)


# Shown when a user comes back DURING an active cool-down. The remaining
# time is rendered in human-friendly granularity (minutes / hours / days)
# rather than a precise countdown -- precise countdowns invite the user
# to retry-spam at the exact moment.

def cooldown_text(remaining_s: int, lang: str = "en") -> str:
    """Friendly cool-down notice with rough remaining time.

    Phase F: ``lang="ma"`` currently returns the English text -- the
    embedded ``{time}`` slot needs a parameterised Mandinka template
    that's deferred to Phase F.1. The 199 emergency line is
    universal in The Gambia so the safety information still reaches
    Mandinka users; only the framing is English."""
    # NOTE: lang param accepted for API parity. cooldown_text deliberately
    # uses English in Phase F until the dynamic Mandinka template lands.
    _ = lang  # explicit ignore
    try:
        r = int(remaining_s or 0)
    except (TypeError, ValueError):
        r = 0
    if r <= 0:
        return ""

    if r < 3600:
        when = "about {n} minute{s}".format(
            n=max(1, r // 60),
            s="" if r // 60 == 1 else "s",
        )
    elif r < 86400:
        when = "about {n} hour{s}".format(
            n=max(1, r // 3600),
            s="" if r // 3600 == 1 else "s",
        )
    else:
        when = "about {n} day{s}".format(
            n=max(1, r // 86400),
            s="" if r // 86400 == 1 else "s",
        )

    return (
        f"I'm taking a break right now. I will be available again in {when}.\n\n"
        "If you have an URGENT medical emergency, dial 199 (The Gambia) immediately. "
        "Your community caregiver can also help you any time."
    )
