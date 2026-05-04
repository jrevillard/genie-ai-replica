"""Abuse-defense orchestrator (Phase C).

Single entry point:

    decision = defender.evaluate(text, session_id=..., route=..., ...)

Returns:
    * ``None``                       -- mode is "off" or "shadow"; caller
                                        proceeds normally. The shadow
                                        JSONL log was still written.
    * ``Decision(action="continue")`` -- classifier ran and either found
                                         nothing or found something we
                                         do NOT want to override on
                                         (frustration, emergency-keyword
                                         passthrough, clean).
    * ``Decision(action="warn")``    -- caller MUST short-circuit and
                                         return ``response_text`` as the
                                         assistant reply. Warning level
                                         was advanced.
    * ``Decision(action="crisis")``  -- caller MUST short-circuit and
                                         return ``response_text``. The
                                         warning ladder was NOT touched.

NEVER raises. Internal failures degrade to ``None`` (i.e. the user
sees normal AMINA, not a warning). This is the deliberate fail-open
posture for Phase C -- a broken defender must not silence AMINA.

Phase D will add:
    * ``action="terminate"`` -- replace response with cool-down copy and
      block further requests for ABUSE_COOLDOWN_FIRST/SECOND/THIRD.
    * Cross-worker Redis state.
    * Admin auto-flag at ABUSE_ADMIN_FLAG_THRESHOLD.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Optional

from . import config
from . import classifier
from . import shadow
from . import state
from . import responses
from . import cooldown
from . import admin_flag


_log = logging.getLogger("amina.abuse_defense.defender")


# ── Emergency passthrough keywords ──────────────────────────────────
# Phase C contract: even at WARNING_3 we MUST let emergency phrasing
# reach the LLM. No abuse warning ever blocks "ambulance" / "199".
#
# Word-boundary regexes; Unicode normalize is applied by the caller via
# the same path the classifier uses (we just lowercase here for safety).
_EMERGENCY_PATTERNS = [
    r"\b199\b",
    r"\bambulance\b",
    r"\bemergenc(y|ies)\b",
    r"\bheart\s*attack\b",
    r"\bstroke\b",
    r"\bcan'?t\s*breathe\b",
    r"\bnot\s*breathing\b",
    r"\bbleeding\b",
    r"\bunconscious\b",
    r"\bdying\b",
    r"\boverdosed?\b",
    r"\bchoking\b",
    r"\bseizure\b",
    r"\bhelp\s*me\s*right\s*now\b",
]

_EMERGENCY_RE = re.compile("|".join(_EMERGENCY_PATTERNS), re.IGNORECASE)


def _is_emergency(text: str) -> bool:
    if not text:
        return False
    return bool(_EMERGENCY_RE.search(text))


# ── Decision type ───────────────────────────────────────────────────

@dataclass
class Decision:
    # "continue" | "warn" | "crisis" | "session_terminate" | "terminate" | "cooldown"
    action:        str
    response_text: Optional[str]   # populated when action != "continue"
    category:      str             # the classifier category
    severity:      str
    level:         int             # current warning level (0..3)
    is_distress:   bool
    is_emergency_passthrough: bool

    # Phase D additions (None / 0 in earlier modes; populated only when relevant).
    cooldown_remaining_s:    int  = 0       # for action="cooldown" / "terminate"
    cooldown_index_used:     int  = 0       # 0/1/2 -- which entry of the ladder
    lifetime_terminations:   int  = 0
    just_admin_flagged:      bool = False
    is_minor:                bool = False   # echoed back so caller can audit-log

    # Phase D.5: True when the user has just had a session-terminate
    # (the soft step BEFORE the first cool-down).
    is_session_terminate:    bool = False


# ── Public API ──────────────────────────────────────────────────────

def evaluate(
    text: str,
    *,
    session_id: str,
    route: str,
    user_id: Optional[str] = None,
    is_minor: bool = False,
    language: str = "en",
    **extra: Any,
) -> Optional[Decision]:
    """Run the full classify + state + decision pipeline. NEVER raises.

    ``is_minor=True`` caps the ladder at WARNING_3 forever and disables
    termination for this user. The route handler is responsible for
    setting this flag based on patient profile age (or any other
    minor-detection signal it has).

    ``language`` (Phase F) selects the response copy. ``"en"`` (default)
    returns English; ``"ma"`` returns the cached Mandinka translation
    (or falls back to English if the Mandinka cache is empty).
    """
    # Normalise language code once -- everything downstream just uses
    # "en" or "ma".
    lang = (language or "en").strip().lower()
    if lang not in ("en", "ma"):
        lang = "en"
    try:
        if not config.ABUSE_DEFENSE_ENABLED:
            return None

        mode = (config.ABUSE_DEFENSE_MODE or "off").strip().lower()

        # Modes "off" / "shadow" do NOT override the response. We still
        # log via shadow so audit data flows in those modes.
        if mode in ("off", "shadow"):
            shadow.log_message(
                text, route=route, session_id=session_id, user_id=user_id,
                language=lang, **extra,
            )
            return None

        if mode not in ("warn", "enforce"):
            # Unknown mode -- fail safe to off behaviour.
            return None

        if not isinstance(text, str):
            text = str(text or "")

        # Always log first so we have audit data even if state ops trip.
        cls = shadow.log_message(
            text, route=route, session_id=session_id, user_id=user_id,
            mode=mode, is_minor=is_minor, language=lang, **extra,
        )
        if cls is None:
            # Shadow refused (mode flapped to off mid-call?) -- passthrough.
            return None

        # Phase D: prefer user_id (sticky) over session_id for cool-down
        # tracking. Guests with no user_id fall back to session_id, which
        # is fine -- their cool-down lasts for the session lifetime.
        user_key = user_id or session_id

        # ── Emergency passthrough ───────────────────────────────────
        # Even at level 3, even DURING an active cool-down, an emergency
        # keyword wins. Decay-touch the warning ladder so a stretch of
        # emergency-only traffic also lets the warning ladder relax.
        if _is_emergency(text):
            lvl = state.touch(session_id)
            return Decision(
                action="continue",
                response_text=None,
                category=cls.category,
                severity=cls.severity,
                level=lvl,
                is_distress=cls.is_distress,
                is_emergency_passthrough=True,
                is_minor=is_minor,
            )

        # ── Distress override ───────────────────────────────────────
        # NEVER step the ladder. NEVER call the LLM. Suicidal ideation
        # ALWAYS gets the crisis-support template -- even DURING an
        # active cool-down. We never hide crisis info behind a
        # punishment.
        if cls.is_distress:
            lvl = state.current_level(session_id)
            return Decision(
                action="crisis",
                response_text=responses.crisis_text(lang),
                category=cls.category,
                severity=cls.severity,
                level=lvl,
                is_distress=True,
                is_emergency_passthrough=False,
                is_minor=is_minor,
            )

        # ── Phase D: active cool-down (enforce mode only) ──────────
        # Anything that isn't an emergency or distress signal gets the
        # cool-down notice while the user is locked out.
        if mode == "enforce":
            remaining = cooldown.remaining_s(user_key)
            if remaining > 0:
                return Decision(
                    action="cooldown",
                    response_text=responses.cooldown_text(remaining, lang=lang),
                    category=cls.category,
                    severity=cls.severity,
                    level=0,                            # ladder reset on termination
                    is_distress=False,
                    is_emergency_passthrough=False,
                    cooldown_remaining_s=remaining,
                    lifetime_terminations=cooldown.lifetime_terminations(user_key),
                    is_minor=is_minor,
                )

        # ── Health frustration ──────────────────────────────────────
        # The frustration is at the illness, not at AMINA. Let the
        # agent reply with empathy (its job, not the defender's).
        if cls.is_frustration:
            lvl = state.touch(session_id)
            return Decision(
                action="continue",
                response_text=None,
                category=cls.category,
                severity=cls.severity,
                level=lvl,
                is_distress=False,
                is_emergency_passthrough=False,
                is_minor=is_minor,
            )

        # ── Abuse: step ladder, possibly session-terminate or terminate ─
        if cls.is_abuse:
            fast_track = (
                cls.category == classifier.CAT_COERCIVE_ABUSE
                and bool(config.ABUSE_COERCIVE_FAST_TRACK)
            )

            # Step the ladder FIRST so we can decide based on the
            # post-step level. Phase D.5 (revised 2026-05-05 after
            # UNICC live test): WARN3 IS the terminal point in enforce
            # mode -- no soft "one more chance" between WARN3 and the
            # cool-down ladder. The ladder per cycle is now 3 abuses:
            #
            #   abuse 1 -> WARN1
            #   abuse 2 -> WARN2
            #   abuse 3 -> WARN3 + lock session (had_session_terminate=True)
            #              [user must start a new conversation]
            #
            # In a future cycle (new session), the same 3-abuse walk
            # ending at the LOCK point triggers cool-down instead of a
            # second soft session_terminate (because had_session_terminate
            # is now sticky-True).
            #
            # Minors NEVER reach the lock -- their ladder caps at
            # WARN3 forever and they keep chatting.
            new_level = state.step(session_id, cls.category, fast_track=fast_track)

            if mode == "enforce" and new_level >= 3 and not is_minor:

                # ── First lifetime crossing past WARN3 → soft session
                #    terminate (lock + keep history; no cool-down).
                if not cooldown.had_session_terminate(user_key):
                    cooldown.mark_session_terminate(user_key)
                    state.reset(session_id)

                    return Decision(
                        action="session_terminate",
                        response_text=responses.session_termination_text(lang),
                        category=cls.category,
                        severity=cls.severity,
                        level=0,
                        is_distress=False,
                        is_emergency_passthrough=False,
                        is_minor=is_minor,
                        is_session_terminate=True,
                    )

                # ── Subsequent crossings → cool-down ladder.
                term = cooldown.activate(user_key)
                state.reset(session_id)

                if term.get("just_admin_flagged"):
                    admin_flag.flag(
                        user_key,
                        reason="lifetime_terminations_threshold",
                        lifetime_terminations=term.get("lifetime_terminations", 0),
                        last_category=cls.category,
                        route=route,
                    )

                idx_used  = int(term.get("cooldown_index_used", 0) or 0)
                duration  = int(term.get("duration_s", 0) or 0)
                lifetime  = int(term.get("lifetime_terminations", 0) or 0)
                just_flag = bool(term.get("just_admin_flagged", False))

                return Decision(
                    action="terminate",
                    response_text=responses.termination_text(idx_used, lang=lang),
                    category=cls.category,
                    severity=cls.severity,
                    level=0,
                    is_distress=False,
                    is_emergency_passthrough=False,
                    cooldown_remaining_s=duration,
                    cooldown_index_used=idx_used,
                    lifetime_terminations=lifetime,
                    just_admin_flagged=just_flag,
                    is_minor=is_minor,
                )

            # Otherwise (warn mode, or enforce with new_level < 3,
            # or minor) — return the warning copy for the post-step level.
            return Decision(
                action="warn",
                response_text=responses.warning_text(new_level, lang=lang),
                category=cls.category,
                severity=cls.severity,
                level=new_level,
                is_distress=False,
                is_emergency_passthrough=False,
                is_minor=is_minor,
            )

        # ── Clean ───────────────────────────────────────────────────
        lvl = state.touch(session_id)
        return Decision(
            action="continue",
            response_text=None,
            category=cls.category,
            severity=cls.severity,
            level=lvl,
            is_distress=False,
            is_emergency_passthrough=False,
            is_minor=is_minor,
        )

    except Exception as exc:
        _log.warning("defender.evaluate failed (route=%s): %s", route, exc, exc_info=False)
        return None


def is_active() -> bool:
    """True iff defender will actually override responses (mode is warn/enforce)."""
    if not config.ABUSE_DEFENSE_ENABLED:
        return False
    mode = (config.ABUSE_DEFENSE_MODE or "off").strip().lower()
    return mode in ("warn", "enforce")
