"""
Structured Compaction — Gap 6 Bridge.

Replaces summary-based compaction with extract-and-update. Instead of
compressing old messages into a 300-word prose summary (which leaks
clinical specifics), this service extracts structured facts into a
persistent PatientClinicalState and discards raw messages.

    Lossless for facts → conditions, meds, vitals, family, commitments
    Lossy for chitchat → greetings, pleasantries, verbose reasoning

The model reads from structured state, not from a prose summary.
This means context window usage scales with clinical complexity
(bounded), not conversation length (unbounded).

Gate: settings.USE_STRUCTURED_COMPACTION (default false).
When false, the existing context_compactor.py summarizer runs unchanged.

Architecture:
  1. On compaction trigger, extract structured facts from old turns
  2. Merge with existing PatientClinicalState (upsert semantics)
  3. Save state to Redis (hot reads) + ArcadeDB (durability)
  4. Discard raw messages (same as current compactor)
  5. On prompt assembly, render state as compact structured block
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = settings.USE_STRUCTURED_COMPACTION

_STATE_KEY = "clinical_state:{pid}"
_STATE_TTL = 86400 * 30  # 30 days


# ── PatientClinicalState schema ────────────────────────────────────────

def _empty_state(patient_id: str) -> Dict[str, Any]:
    return {
        "patient_id": patient_id,
        "conditions": [],
        "medications": [],
        "vitals_history": [],
        "allergies": [],
        "family_context": {},
        "preferences": {},
        "commitments": [],
        "key_clinical_facts": [],
        "emotional_patterns": [],
        "last_updated_turn": 0,
        "extraction_count": 0,
        "updated_at": datetime.now().isoformat(),
    }


# ── Redis helpers ──────────────────────────────────────────────────────

def _get_redis():
    import redis
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=0,
        decode_responses=True,
    )


async def load_clinical_state(patient_id: str) -> Dict[str, Any]:
    """Load the clinical state for a patient from Redis."""
    if not _ENABLED or not patient_id:
        return _empty_state(patient_id or "")

    try:
        r = _get_redis()
        raw = r.get(_STATE_KEY.format(pid=patient_id))
        if raw:
            return json.loads(raw)
    except Exception as e:
        logger.debug(f"structured_compactor: load failed: {e}")

    return _empty_state(patient_id)


async def save_clinical_state(patient_id: str, state: Dict[str, Any]) -> None:
    """Save clinical state to Redis with TTL."""
    if not _ENABLED or not patient_id:
        return

    try:
        state["updated_at"] = datetime.now().isoformat()
        r = _get_redis()
        r.set(
            _STATE_KEY.format(pid=patient_id),
            json.dumps(state, default=str),
            ex=_STATE_TTL,
        )
    except Exception as e:
        logger.warning(f"structured_compactor: save failed: {e}")


# ── LLM extraction prompt ─────────────────────────────────────────────

_EXTRACTION_PROMPT = """You are a clinical fact extractor for AMINA Care, a Gambian community health programme.

Extract ALL clinical facts from this patient-CHW conversation transcript into structured JSON.

EXISTING STATE (merge with, don't overwrite unless corrected):
{existing_state}

CONVERSATION TRANSCRIPT:
{transcript}

Extract into this exact JSON structure:
{{
  "conditions": [
    {{"name": "diabetes type 2", "status": "active", "since": "mentioned turn 3", "details": "on metformin"}}
  ],
  "medications": [
    {{"name": "metformin", "dose": "500mg", "frequency": "twice daily", "status": "active", "notes": "patient says causes nausea"}}
  ],
  "vitals": [
    {{"type": "bp", "value": "140/90", "when": "this conversation", "context": "taken at home"}}
  ],
  "allergies": ["penicillin"],
  "family_context": {{
    "mother": {{"conditions": ["diabetes"], "concern_level": "high", "notes": "patient is primary carer"}}
  }},
  "preferences": {{
    "language": "mandinka",
    "preferred_facility": "Bansang Hospital",
    "diet_restrictions": "low salt"
  }},
  "commitments": [
    {{"what": "check mother's feet daily", "when": "agreed this conversation", "status": "active"}}
  ],
  "key_facts": [
    "patient is pregnant",
    "family history of stroke",
    "works as market trader (lumo)"
  ],
  "emotional_patterns": [
    "anxious about mother's glucose trends",
    "resistant to insulin — fears needles"
  ]
}}

RULES:
1. MERGE with existing state — don't drop facts from prior extractions
2. If patient corrects a fact ("no, I stopped metformin"), UPDATE it (status: "discontinued")
3. Vitals: keep the most recent 5 readings per type
4. Commitments: mark old ones as "completed" or "expired" if conversation shows resolution
5. Key facts: only truly important clinical context. Not "patient said hello."
6. Be conservative: only extract facts clearly stated, not inferred

Return ONLY the JSON object, no prose."""


# ── Model call ─────────────────────────────────────────────────────────

async def _call_extraction_model(prompt: str) -> Optional[Dict[str, Any]]:
    """Call a fast model for fact extraction. Gemini → Groq → GPT-4o-mini."""
    from openai import AsyncOpenAI

    clients = []

    if settings.GOOGLE_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GOOGLE_API_KEY, base_url=settings.GEMINI_BASE_URL),
            "gemini-2.0-flash-lite",
            "gemini",
        ))

    if settings.GROQ_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL),
            settings.GROQ_MODEL,
            "groq",
        ))

    if settings.OPENAI_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL),
            "gpt-4o-mini",
            "openai",
        ))

    for client, model, provider in clients:
        try:
            completion = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=800,
            )
            text = (completion.choices[0].message.content or "").strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"```\s*$", "", text)
            result = json.loads(text)
            logger.debug(f"structured_compactor: extracted via {provider}/{model}")
            return result
        except Exception as e:
            logger.warning(f"structured_compactor: {provider} call failed: {e}")
            continue

    logger.error("structured_compactor: all model providers failed")
    return None


# ── Merge logic ────────────────────────────────────────────────────────

def _merge_list_by_name(
    existing: List[Dict[str, Any]],
    new: List[Dict[str, Any]],
    key: str = "name",
    max_items: int = 20,
) -> List[Dict[str, Any]]:
    """Merge two lists of dicts by a key field. New entries update existing ones."""
    by_key = {}
    for item in existing:
        if isinstance(item, dict) and key in item:
            by_key[item[key].lower()] = item
    for item in new:
        if isinstance(item, dict) and key in item:
            k = item[key].lower()
            if k in by_key:
                by_key[k].update(item)
            else:
                by_key[k] = item
    return list(by_key.values())[:max_items]


def _merge_vitals(
    existing: List[Dict[str, Any]],
    new: List[Dict[str, Any]],
    max_per_type: int = 5,
) -> List[Dict[str, Any]]:
    """Merge vitals, keeping most recent N per type."""
    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for v in existing + new:
        if isinstance(v, dict):
            t = v.get("type", "unknown")
            by_type.setdefault(t, []).append(v)

    result = []
    for readings in by_type.values():
        result.extend(readings[-max_per_type:])
    return result


def _merge_states(
    existing: Dict[str, Any],
    extracted: Dict[str, Any],
) -> Dict[str, Any]:
    """Merge extracted facts into existing state."""
    merged = dict(existing)

    merged["conditions"] = _merge_list_by_name(
        existing.get("conditions", []),
        extracted.get("conditions", []),
    )
    merged["medications"] = _merge_list_by_name(
        existing.get("medications", []),
        extracted.get("medications", []),
    )
    merged["vitals_history"] = _merge_vitals(
        existing.get("vitals_history", []),
        extracted.get("vitals", []),
    )

    # Allergies: union
    existing_allergies = set(a.lower() for a in existing.get("allergies", []) if isinstance(a, str))
    new_allergies = set(a.lower() for a in extracted.get("allergies", []) if isinstance(a, str))
    merged["allergies"] = sorted(existing_allergies | new_allergies)

    # Family context: deep merge
    fc = dict(existing.get("family_context", {}))
    for person, info in extracted.get("family_context", {}).items():
        if person in fc and isinstance(fc[person], dict) and isinstance(info, dict):
            fc[person].update(info)
        else:
            fc[person] = info
    merged["family_context"] = fc

    # Preferences: update
    prefs = dict(existing.get("preferences", {}))
    prefs.update(extracted.get("preferences", {}))
    merged["preferences"] = prefs

    # Commitments: merge by "what" field
    merged["commitments"] = _merge_list_by_name(
        existing.get("commitments", []),
        extracted.get("commitments", []),
        key="what",
        max_items=10,
    )

    # Key facts: union (deduplicated, capped)
    existing_facts = set(existing.get("key_clinical_facts", []))
    new_facts = set(extracted.get("key_facts", []))
    merged["key_clinical_facts"] = sorted(existing_facts | new_facts)[:15]

    # Emotional patterns: append recent, cap at 5
    existing_emo = existing.get("emotional_patterns", [])
    new_emo = extracted.get("emotional_patterns", [])
    merged["emotional_patterns"] = (existing_emo + new_emo)[-5:]

    merged["extraction_count"] = existing.get("extraction_count", 0) + 1
    merged["updated_at"] = datetime.now().isoformat()

    return merged


# ── Public API ─────────────────────────────────────────────────────────

async def extract_and_update(
    patient_id: str,
    session_id: str,
    messages: List[Any],
    patient_name: str = "",
    turn_count: int = 0,
) -> Optional[Dict[str, Any]]:
    """Extract structured facts from messages and update clinical state.

    Called by the compaction trigger instead of the text summarizer.
    Returns the updated state, or None on failure.

    When flag is off, returns None (caller falls back to text summary).
    """
    if not _ENABLED:
        return None

    if not messages or len(messages) < 4:
        return None

    # Format transcript
    lines = []
    pname = patient_name or "Patient"
    for m in messages:
        role = getattr(m, "role", None) or (m.get("role") if isinstance(m, dict) else "user")
        content = getattr(m, "content", None) or (m.get("content", "") if isinstance(m, dict) else "")
        content = (content or "").strip()
        if not content:
            continue
        label = pname if role == "user" else "AMINA"
        lines.append(f"{label}: {content[:500]}")

    transcript = "\n".join(lines[-30:])  # Cap at 30 turns
    if not transcript:
        return None

    existing = await load_clinical_state(patient_id)

    existing_json = json.dumps({
        k: v for k, v in existing.items()
        if k not in ("patient_id", "extraction_count", "updated_at", "last_updated_turn")
    }, default=str, indent=1)

    prompt = _EXTRACTION_PROMPT.format(
        existing_state=existing_json[:2000],
        transcript=transcript[:4000],
    )

    extracted = await _call_extraction_model(prompt)
    if not extracted:
        logger.warning(f"structured_compactor: extraction failed for {patient_id}")
        return None

    merged = _merge_states(existing, extracted)
    merged["patient_id"] = patient_id
    merged["last_updated_turn"] = turn_count

    await save_clinical_state(patient_id, merged)

    # Snapshot to ArcadeDB
    try:
        await _snapshot_to_arcadedb(patient_id, session_id, merged)
    except Exception as e:
        logger.debug(f"structured_compactor: ArcadeDB snapshot non-fatal: {e}")

    logger.info(
        f"structured_compactor: updated state for {patient_id} — "
        f"{len(merged.get('conditions', []))} conditions, "
        f"{len(merged.get('medications', []))} meds, "
        f"{len(merged.get('vitals_history', []))} vitals"
    )

    return merged


async def _snapshot_to_arcadedb(
    patient_id: str,
    session_id: str,
    state: Dict[str, Any],
) -> None:
    """Save a clinical state snapshot to ArcadeDB for durability."""
    from src.utils.arcade_client import command_sql

    snap_id = f"cs_{patient_id}_{state.get('extraction_count', 0)}"
    state_json = json.dumps(state, default=str).replace("'", "''")

    sql = (
        f"MERGE INTO ClinicalStateSnapshot "
        f"SET id = '{snap_id}', "
        f"patient_id = '{patient_id}', "
        f"session_id = '{session_id}', "
        f"state_json = '{state_json}', "
        f"extraction_count = {state.get('extraction_count', 0)}, "
        f"created_at = '{datetime.now().isoformat()}' "
        f"UPSERT WHERE id = '{snap_id}'"
    )
    command_sql(sql)


def render_state_for_prompt(state: Dict[str, Any]) -> str:
    """Render clinical state as a compact prompt block.

    Returns empty string when flag is off or state is empty.
    Designed to replace the prose summary in the system prompt.
    """
    if not _ENABLED:
        return ""

    if not state or not state.get("patient_id"):
        return ""

    has_content = any([
        state.get("conditions"),
        state.get("medications"),
        state.get("vitals_history"),
        state.get("key_clinical_facts"),
        state.get("commitments"),
    ])
    if not has_content:
        return ""

    parts = ["[Clinical State — extracted from prior conversations]"]

    # Conditions
    conditions = state.get("conditions", [])
    if conditions:
        cond_strs = []
        for c in conditions[:5]:
            if isinstance(c, dict):
                name = c.get("name", "?")
                status = c.get("status", "active")
                detail = c.get("details", "")
                s = f"{name} ({status})"
                if detail:
                    s += f" — {detail}"
                cond_strs.append(s)
            else:
                cond_strs.append(str(c))
        parts.append(f"Conditions: {'; '.join(cond_strs)}")

    # Medications
    medications = state.get("medications", [])
    if medications:
        med_strs = []
        for m in medications[:5]:
            if isinstance(m, dict):
                name = m.get("name", "?")
                dose = m.get("dose", "")
                freq = m.get("frequency", "")
                status = m.get("status", "active")
                s = name
                if dose:
                    s += f" {dose}"
                if freq:
                    s += f" {freq}"
                if status != "active":
                    s += f" [{status}]"
                med_strs.append(s)
            else:
                med_strs.append(str(m))
        parts.append(f"Medications: {'; '.join(med_strs)}")

    # Recent vitals
    vitals = state.get("vitals_history", [])
    if vitals:
        recent = vitals[-3:]
        vital_strs = [
            f"{v.get('type', '?')}: {v.get('value', '?')}"
            for v in recent if isinstance(v, dict)
        ]
        if vital_strs:
            parts.append(f"Recent vitals: {', '.join(vital_strs)}")

    # Allergies
    allergies = state.get("allergies", [])
    if allergies:
        parts.append(f"Allergies: {', '.join(allergies[:5])}")

    # Family context
    family = state.get("family_context", {})
    if family:
        fc_strs = []
        for person, info in list(family.items())[:3]:
            if isinstance(info, dict):
                conds = info.get("conditions", [])
                notes = info.get("notes", "")
                s = f"{person}"
                if conds:
                    s += f" ({', '.join(conds[:2])})"
                if notes:
                    s += f" — {notes}"
                fc_strs.append(s)
        if fc_strs:
            parts.append(f"Family: {'; '.join(fc_strs)}")

    # Active commitments
    commitments = [c for c in state.get("commitments", [])
                   if isinstance(c, dict) and c.get("status") == "active"]
    if commitments:
        comm_strs = [c.get("what", "?") for c in commitments[:3]]
        parts.append(f"Active commitments: {'; '.join(comm_strs)}")

    # Key facts
    facts = state.get("key_clinical_facts", [])
    if facts:
        parts.append(f"Key facts: {'; '.join(facts[:5])}")

    return "\n".join(parts)
