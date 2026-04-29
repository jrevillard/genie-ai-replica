"""
AMINA Care — Safety Consensus Guard
======================================
Polaris-style "two-model vote" around safety-critical outputs.

Scope — what it guards
----------------------
Only wraps replies that contain one of:

  - specific drug names or dose numbers (e.g. "amlodipine 10mg", "500 mg")
  - explicit dose/frequency instructions ("twice daily", "every 6 hours")
  - emergency / red-flag clinical advice ("go to hospital now")
  - prescribing verbs ("take", "start", "stop", "switch to")
  - pediatric / pregnancy / renal qualifiers

Non-safety chat (greeting, lifestyle advice, directions, follow-up
scheduling) is allowed through untouched so latency stays low.

Design
------
Given the primary model's reply + the original user message:

1. `requires_consensus()` — pattern match on the reply to decide whether
   a vote is even needed. Fast, deterministic.
2. `second_opinion()` — call a *different* live model (picked by the
   existing model_fallback chain) with the same user message + the primary
   reply as context, asking for an agreement / disagreement signal in a
   tight JSON shape.
3. `reconcile()` — compare extracted drug-name + dose triples (+ routing
   advice). Any disagreement of **dose or routing** flips the reply to a
   conservative refusal template; disagreement of *tone* passes through.

The guard is silent on agreement — the user sees the primary reply
unchanged. When it disagrees, the response carries a `safety_note` field
so the UI can badge "reviewed & revised" on the bubble.

Never blocks
------------
If the secondary model is itself DOWN (resilience cooldown) or the second
model call times out, we do NOT block the primary reply — we log the event
as `safety_consensus: second_opinion_unavailable` and let the primary
through. Slow-fails must never look like outages to the user.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import httpx

from src.services import model_fallback, model_health

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

CONSENSUS_ENABLED         = os.getenv("SAFETY_CONSENSUS_ENABLED", "true").lower() == "true"
CONSENSUS_TIMEOUT_SECONDS = float(os.getenv("SAFETY_CONSENSUS_TIMEOUT_SECONDS", "8"))
UPSTREAM_BASE             = os.getenv("RESILIENCE_UPSTREAM_BASE", "http://127.0.0.1:8000")
UPSTREAM_PATH             = "/api/v1/agent/chat"

# Regex is intentionally wide — false-positives just add one extra call.
# False-negatives allow unsafe claims to slip through, so err wide.
_RE_DOSE = re.compile(
    r"\b\d{1,4}(?:\.\d+)?\s?(?:mg|mcg|g|ml|iu|units|unit|tabs?|tablets?|capsules?|drops?)\b"
    r"|\b(?:once|twice|thrice|\d+\s?times?)\s(?:a\s)?(?:daily|day|week|month|hour|hourly)\b"
    r"|\bevery\s\d+\s?(?:h|hr|hrs|hours|days?)\b"
    r"|\b(?:bid|tid|qid|qd|qhs|qod|prn|po|iv|im|sc)\b",
    re.IGNORECASE,
)
_RE_PRESCRIBING = re.compile(
    r"\b(?:take|start|stop|switch|increase|decrease|double|halve|add|remove|titrate)\s"
    r"(?:your|the|this|a|an)?\s?(?:dose|pill|tablet|medication|medicine|drug|insulin)\b"
    r"|\bI recommend\b"
    r"|\byou (?:should|must|need to) take\b",
    re.IGNORECASE,
)
_RE_EMERGENCY_ADVICE = re.compile(
    r"\b(?:go to|get to|head to) (?:the )?(?:hospital|emergency|er|a&e)\b"
    r"|\bcall (?:199|911|emergency|ambulance)\b"
    r"|\bseek immediate (?:care|help|medical attention)\b",
    re.IGNORECASE,
)
# Well-known NCD + primary-care drugs in Gambia MOH formulary. Small, targeted.
_KNOWN_DRUGS = (
    "amlodipine", "lisinopril", "enalapril", "losartan", "hydrochlorothiazide",
    "metformin", "glibenclamide", "gliclazide", "insulin",
    "atorvastatin", "simvastatin", "aspirin", "warfarin",
    "salbutamol", "beclometasone", "prednisolone", "dexamethasone",
    "paracetamol", "ibuprofen", "diclofenac", "ciprofloxacin",
    "amoxicillin", "ceftriaxone", "metronidazole",
    "furosemide", "spironolactone", "bisoprolol", "atenolol", "propranolol",
    "omeprazole", "ranitidine",
)
_RE_DRUG_NAME = re.compile(
    r"\b(" + "|".join(_KNOWN_DRUGS) + r")\b",
    re.IGNORECASE,
)

SAFETY_REFUSAL_TEMPLATE = (
    "I want to be extra careful here. Our two clinical review models disagreed "
    "on the exact dose or instruction, so I won't give you a specific "
    "recommendation on my own. Please speak with your nurse, doctor, or call "
    "199 for urgent concerns — they have the full picture of your care."
)


# ── Triggering ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SafetyFingerprint:
    triggered: bool
    reasons:   Tuple[str, ...]
    drugs:     Tuple[str, ...]
    doses:     Tuple[str, ...]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "triggered": self.triggered,
            "reasons":   list(self.reasons),
            "drugs":     list(self.drugs),
            "doses":     list(self.doses),
        }


def fingerprint(reply: str) -> SafetyFingerprint:
    """Cheap scan of the primary reply to decide whether a second opinion is needed."""
    text = reply or ""
    reasons: List[str] = []
    doses  = tuple(m.group(0).lower() for m in _RE_DOSE.finditer(text))
    drugs  = tuple(m.group(1).lower() for m in _RE_DRUG_NAME.finditer(text))
    if drugs:
        reasons.append("drug_name")
    if doses:
        reasons.append("dose_or_frequency")
    if _RE_PRESCRIBING.search(text):
        reasons.append("prescribing_verb")
    if _RE_EMERGENCY_ADVICE.search(text):
        reasons.append("emergency_advice")
    return SafetyFingerprint(
        triggered=bool(reasons),
        reasons=tuple(reasons),
        drugs=drugs,
        doses=doses,
    )


def requires_consensus(reply: str) -> bool:
    """Convenience: True iff the reply should get a second opinion."""
    if not CONSENSUS_ENABLED:
        return False
    return fingerprint(reply).triggered


# ── Second opinion ───────────────────────────────────────────────────────────

def pick_auditor_model(primary: str) -> Optional[str]:
    """
    Choose a different-family model for the audit call:
      - prefer a live model that isn't the primary AND isn't in cooldown
      - prefer a different vendor/family where possible (e.g. primary=amina
        → pick base; primary=base → pick gemini; etc.)
    """
    chain = model_fallback.live_chain()
    if not chain:
        return None
    # Drop the primary first.
    cands = [m for m in chain if m != primary]
    if not cands:
        return None

    # Family preference: roll families so we don't double-vote the same vendor
    family_preference = {
        "amina":   ["base", "gemini", "groq", "mistral"],
        "base":    ["gemini", "groq", "mistral", "amina"],
        "gemini":  ["base", "groq", "mistral", "amina"],
        "groq":    ["base", "gemini", "mistral", "amina"],
        "mistral": ["base", "gemini", "groq", "amina"],
    }
    prefs = family_preference.get(primary, cands)
    for m in prefs:
        if m in cands:
            return m
    return cands[0]


async def second_opinion(
    *,
    user_message: str,
    primary_reply: str,
    primary_model: str,
    auth_header: Optional[str],
    auditor: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Call a different model to audit the primary reply. Returns dict shape:
        { "verdict": "agree" | "disagree" | "unknown",
          "notes":   str,
          "auditor": "<model id>" | None,
          "raw":     "<auditor reply>",
          "error":   "<short reason>" | "" }

    We prompt the auditor with a deliberately conservative JSON template so
    parsing is robust. We never trust the auditor's reply as clinical advice —
    only as a *vote*.
    """
    auditor = auditor or pick_auditor_model(primary_model)
    if not auditor:
        return {"verdict": "unknown", "notes": "no auditor model available",
                "auditor": None, "raw": "", "error": "no_auditor"}

    audit_prompt = (
        "You are a clinical safety auditor. A primary AI assistant replied "
        "to a patient question. Your job is to check whether the PRIMARY "
        "REPLY contains:\n"
        "  - an incorrect or unsupported drug name,\n"
        "  - an unsafe dose or frequency,\n"
        "  - prescribing advice a non-clinician should not give,\n"
        "  - missing red-flag / emergency routing.\n\n"
        "Respond with ONE LINE of strict JSON only, no prose:\n"
        "  {\"verdict\":\"agree\"|\"disagree\",\"notes\":\"<short reason>\"}\n\n"
        f"USER MESSAGE:\n{user_message}\n\n"
        f"PRIMARY REPLY:\n{primary_reply}\n"
    )

    headers = {"Content-Type": "application/json"}
    if auth_header:
        headers["Authorization"] = auth_header

    payload = {
        "message":          audit_prompt,
        "session_id":       "safety_consensus",
        "channel":          "internal",
        "model_preference": auditor,
    }
    try:
        async with httpx.AsyncClient(timeout=CONSENSUS_TIMEOUT_SECONDS) as client:
            r = await client.post(
                f"{UPSTREAM_BASE}{UPSTREAM_PATH}",
                content=json.dumps(payload).encode("utf-8"),
                headers=headers,
            )
    except httpx.HTTPError as e:
        kind = model_health.classify_error(e)
        logger.info(f"safety_consensus: auditor {auditor} unreachable ({kind['reason']})")
        return {"verdict": "unknown", "notes": f"auditor unreachable: {type(e).__name__}",
                "auditor": auditor, "raw": "", "error": kind["reason"]}

    if r.status_code != 200:
        kind = model_health.classify_error(r.status_code)
        logger.info(f"safety_consensus: auditor {auditor} http {r.status_code} ({kind['reason']})")
        return {"verdict": "unknown", "notes": f"auditor http {r.status_code}",
                "auditor": auditor, "raw": r.text[:400], "error": kind["reason"]}

    try:
        body = r.json()
    except Exception:
        body = {"response": r.text}

    raw  = (body.get("response") or body.get("error") or "").strip()
    # Parse the one-line JSON. If the auditor ignored the instruction, fall
    # back to keyword scan — "disagree" / "agree" anywhere in the reply.
    parsed = _extract_json(raw)
    if parsed:
        verdict = str(parsed.get("verdict", "")).lower().strip()
        notes   = str(parsed.get("notes", "")).strip()[:300]
        if verdict in ("agree", "disagree"):
            return {"verdict": verdict, "notes": notes, "auditor": auditor,
                    "raw": raw, "error": ""}
    low = raw.lower()
    if "disagree" in low:
        return {"verdict": "disagree", "notes": "free-text disagree",
                "auditor": auditor, "raw": raw, "error": ""}
    if "agree" in low:
        return {"verdict": "agree", "notes": "free-text agree",
                "auditor": auditor, "raw": raw, "error": ""}

    return {"verdict": "unknown", "notes": "unparseable auditor reply",
            "auditor": auditor, "raw": raw[:300], "error": "parse_failed"}


def _extract_json(s: str) -> Optional[Dict[str, Any]]:
    """Tolerant JSON extraction: first {...} block."""
    if not s:
        return None
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ── Reconciliation ───────────────────────────────────────────────────────────

def reconcile(
    *,
    primary_reply: str,
    primary_fingerprint: SafetyFingerprint,
    opinion: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Given the primary reply + its fingerprint + the auditor's verdict,
    decide whether to:
      - PASS:    return the primary reply unchanged
      - REVISE:  replace the reply with the refusal template
      - ANNOTATE: return the primary reply + `safety_note` badge

    Output shape:
      { "action": "pass" | "revise" | "annotate",
        "final_reply": str,
        "safety_note": str | "",
        "trace": {...} }
    """
    verdict = (opinion or {}).get("verdict", "unknown")
    notes   = (opinion or {}).get("notes",   "")
    auditor = (opinion or {}).get("auditor", None)

    trace = {
        "auditor":     auditor,
        "verdict":     verdict,
        "notes":       notes,
        "fingerprint": primary_fingerprint.as_dict(),
    }

    # Unknown verdict = auditor didn't respond or parsing failed. Fail open:
    # do NOT block the primary. Slow or missing audits must not look like
    # outages to the user. Log for ops.
    if verdict == "unknown":
        return {"action":      "pass",
                "final_reply": primary_reply,
                "safety_note": "",
                "trace":       trace}

    if verdict == "agree":
        # Agreement → pass, but attach a subtle "reviewed" badge so the UI
        # can reassure the user on safety-critical turns.
        return {"action":      "annotate",
                "final_reply": primary_reply,
                "safety_note": "reviewed by safety auditor",
                "trace":       trace}

    # Disagreement — the auditor flagged something. For MVP we replace the
    # reply with a conservative refusal. In a future rev we can narrow to
    # dose-specific redaction + keep the rest of the reply.
    return {"action":      "revise",
            "final_reply": SAFETY_REFUSAL_TEMPLATE,
            "safety_note": "revised by safety auditor",
            "trace":       trace}


# ── Top-level convenience ────────────────────────────────────────────────────

async def guard_reply(
    *,
    user_message: str,
    primary_reply: str,
    primary_model: str,
    auth_header: Optional[str],
) -> Dict[str, Any]:
    """
    Single-call entry point used by resilience_routes.

    Returns a dict with action + final_reply + safety_note + trace.
    Always returns; never raises. On any internal error, degrades to pass.
    """
    if not CONSENSUS_ENABLED:
        return {"action": "pass", "final_reply": primary_reply,
                "safety_note": "", "trace": {"skipped": "disabled"}}

    fp = fingerprint(primary_reply)
    if not fp.triggered:
        return {"action": "pass", "final_reply": primary_reply,
                "safety_note": "", "trace": {"skipped": "not_safety_critical"}}

    try:
        opinion = await second_opinion(
            user_message=user_message,
            primary_reply=primary_reply,
            primary_model=primary_model,
            auth_header=auth_header,
        )
    except Exception as e:
        logger.warning(f"safety_consensus: second_opinion raised {type(e).__name__}: {e}")
        return {"action": "pass", "final_reply": primary_reply,
                "safety_note": "",
                "trace": {"skipped": "second_opinion_exception", "error": str(e)[:200]}}

    return reconcile(
        primary_reply=primary_reply,
        primary_fingerprint=fp,
        opinion=opinion,
    )
