"""
AMINA Care — Topic Anchor Patch
==================================
Monkey-patches safety_contract.get_preemptive_constraints to also inject
a topic anchor when the user message is short/ambiguous.

The topic anchor tells the LLM: "The current conversation is about X.
Interpret the patient's short reply in this context." This prevents
the model from drifting to old patient history topics when the patient
sends "sometimes", "yes", "okay", etc.

Injection point: get_preemptive_constraints() output flows into _safety_part
in the user prompt (amina_agent.py line ~1947), so the anchor appears
right before "Patient says:" — exactly where the LLM needs it.

No existing files are modified.
"""
from __future__ import annotations

import logging

_log = logging.getLogger("topic_anchor_patch")

_INSTALLED = False

_session_messages_cache = {}


def install():
    global _INSTALLED
    if _INSTALLED:
        return

    try:
        from src.services.topic_anchor import get_topic_anchor, is_ambiguous
    except ImportError as e:
        _log.warning("topic_anchor_patch: topic_anchor not available: %s", e)
        return

    try:
        from src.services import safety_contract

        _original_constraints = safety_contract.get_preemptive_constraints

        def _patched_constraints(
            user_message,
            patient_context=None,
            intent_extraction=None,
        ):
            base = _original_constraints(user_message, patient_context, intent_extraction)

            if not is_ambiguous(user_message):
                return base

            messages = _session_messages_cache.get("_current", [])
            anchor = get_topic_anchor(user_message, messages)

            if anchor:
                return (base + "\n" + anchor) if base else anchor

            return base

        safety_contract.get_preemptive_constraints = _patched_constraints
        _log.info("topic_anchor_patch: get_preemptive_constraints wrapped")

    except Exception as e:
        _log.warning("topic_anchor_patch: failed to patch safety_contract: %s", e)
        return

    try:
        from src.agent.amina_agent import AminaAgent

        _original_process = AminaAgent.process_message

        async def _patched_process(self, *args, **kwargs):
            message = args[0] if args else kwargs.get("message", "")
            session_id = args[1] if len(args) > 1 else kwargs.get("session_id", "")

            if is_ambiguous(message) and session_id:
                try:
                    memory = self.get_or_create_session(session_id)
                    _session_messages_cache["_current"] = list(memory.messages)
                except Exception:
                    pass

            try:
                return await _original_process(self, *args, **kwargs)
            finally:
                _session_messages_cache.pop("_current", None)

        AminaAgent.process_message = _patched_process
        _log.info("topic_anchor_patch: process_message wrapped for session context")

    except Exception as e:
        _log.warning("topic_anchor_patch: process_message wrap failed (anchor still works via safety_contract): %s", e)

    _INSTALLED = True
    _log.info("topic_anchor_patch: installed")


install()
