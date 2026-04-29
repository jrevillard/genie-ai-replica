"""
Summary Backfill + Fallback Patch
==================================
Two-part fix for missing consultation summaries:

1. BACKFILL (startup): Finds ConsultationRecords with NULL/empty summaries
   and generates extractive summaries from message content — no LLM needed.

2. FALLBACK (forward): Monkey-patches MemoryManager._generate_summary to
   fall back to extractive summarisation when the LLM call fails (e.g.
   free-tier quota exhausted).

Side-effect import — loads on startup via main_with_rag_tuning.py.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

_log = logging.getLogger("src.services.summary_backfill")


def _extractive_summary(messages: list[dict]) -> str:
    """Build a 1-2 sentence summary from raw messages — no LLM call."""
    user_msgs = []
    asst_msgs = []
    for m in (messages or []):
        role = m.get("role", "")
        text = (m.get("content") or "").strip()
        if not text:
            continue
        if role == "user":
            user_msgs.append(text)
        elif role == "assistant":
            asst_msgs.append(text)

    if not user_msgs and not asst_msgs:
        return "Brief consultation — no details recorded."

    chief = user_msgs[0] if user_msgs else ""
    chief_short = chief[:120].rstrip(".") + ("…" if len(chief) > 120 else "")

    triage_kw = None
    for msg in asst_msgs:
        low = msg.lower()
        if any(w in low for w in ("emergency", "immediately", "right away", "call 199")):
            triage_kw = "emergency"
            break
        if any(w in low for w in ("should see a doctor", "recommend visiting", "go to the clinic")):
            triage_kw = "referral"
            break

    advice_snippet = ""
    for msg in reversed(asst_msgs):
        sentences = re.split(r'(?<=[.!?])\s+', msg.strip())
        for s in sentences:
            low = s.lower()
            if any(w in low for w in (
                "recommend", "should", "try to", "make sure", "important",
                "eat", "drink", "take", "avoid", "reduce", "monitor",
            )):
                advice_snippet = s[:100].rstrip(".") + ("…" if len(s) > 100 else "")
                break
        if advice_snippet:
            break

    parts = []
    if chief_short:
        parts.append(f"Patient asked about: {chief_short}.")
    if triage_kw == "emergency":
        parts.append("Flagged as emergency — urgent care advised.")
    elif triage_kw == "referral":
        parts.append("Clinic referral recommended.")
    if advice_snippet:
        parts.append(advice_snippet + ".")

    summary = " ".join(parts).strip()
    if not summary:
        n = len(user_msgs) + len(asst_msgs)
        summary = f"Consultation with {n} messages."
    return summary[:300]


async def _backfill_missing_summaries():
    """Find records with NULL summaries and fill them from message content."""
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows

        resp = await async_command_sql(
            "SELECT id, messages, triage_level FROM ConsultationRecord "
            "WHERE summary IS NULL OR summary = '' "
            "ORDER BY started_at DESC LIMIT 200",
        )
        rows = extract_rows(resp)
        if not rows:
            _log.info("No consultation records need summary backfill")
            return

        _log.info("Backfilling summaries for %d consultation records", len(rows))
        filled = 0
        for row in rows:
            cid = row.get("id", "")
            raw = row.get("messages", "[]")
            msgs = json.loads(raw) if isinstance(raw, str) else (raw or [])
            summary = _extractive_summary(msgs)
            if not summary:
                continue
            try:
                await async_command_sql(
                    "UPDATE ConsultationRecord SET summary = :summary WHERE id = :cid",
                    {"summary": summary, "cid": cid},
                )
                filled += 1
            except Exception as e:
                _log.warning("Failed to backfill summary for %s: %s", cid, e)

        _log.info("Backfilled %d / %d consultation summaries", filled, len(rows))

    except Exception as e:
        _log.warning("Summary backfill failed (non-fatal): %s", e)


def _patch_generate_summary():
    """Monkey-patch MemoryManager._generate_summary to fall back to
    extractive summarisation when the LLM call fails."""
    try:
        from src.agent.memory_manager import MemoryManager

        _original = MemoryManager._generate_summary

        async def _with_fallback(self, consultation):
            try:
                result = await _original(self, consultation)
                if result and result.strip():
                    return result
            except Exception:
                pass

            msgs = consultation.messages if hasattr(consultation, "messages") else []
            if isinstance(msgs, str):
                msgs = json.loads(msgs)
            return _extractive_summary(msgs)

        MemoryManager._generate_summary = _with_fallback
        _log.info("Patched _generate_summary with extractive fallback")
    except Exception as e:
        _log.warning("Failed to patch _generate_summary: %s", e)


_patch_generate_summary()

asyncio.get_event_loop().call_soon(
    lambda: asyncio.ensure_future(_backfill_missing_summaries())
)
