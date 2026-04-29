"""
Caregiver AMINA — Intelligence Pipeline
========================================

Architecture:

  CAREGIVER MESSAGE
       │
       ▼
  [0] PATIENT RESOLVER  (fuzzy name match → DB lookup)
       Extract patient name from the caregiver's free-text message.
       Fuzzy-match against all patients linked to this caregiver.
       Resolve to the correct patient_id — even if the caregiver
       typed a nickname, first name only, or switched patients mid-chat.
       │
       ▼
  [1] CONTEXT BUILDER
       Load resolved patient's data: profile + consultations + behavior.
       │
       ▼
  [2] INFO STATE EXTRACTOR  (fast LLM call)
       Analyse the conversation so far.
       For each clinical dimension, determine: unknown / partial / known.
       │
       ▼
  [3] DECISION ENGINE  (deterministic)
       covered_count >= 4  →  REPORT
       else                →  QUESTION
       report in history   →  FOLLOW-UP
       │
       ┌────────────┴──────────────┐──────────────┐
       ▼                           ▼               ▼
  [4a] QUESTION GENERATOR   [4b] REPORT     [4c] FOLLOW-UP
       Highest-priority gap       Full clinical      Concise Q&A
       → one focused question     briefing           with full context

Clinical dimensions tracked:
  • medication_adherence   — taking prescriptions regularly?
  • current_symptoms       — new or worsening symptoms?
  • behavioral_changes     — sleep, appetite, mood, activity?
  • recent_events          — missed appointments, illness, stress?
  • caregiver_concern      — specific worry / focus area?
  • functional_status      — managing daily activities?

Redis keys:
  cg_conv:{caregiver_id}:{patient_id}  → conversation history (TTL 24 h)
"""

from __future__ import annotations

import json
import logging
from typing import Optional, List, Dict, Any

import redis as redis_lib
from openai import AsyncOpenAI

from src.config import settings
from src.services.clinical_pipeline import enrich_patient_context, generate_soap_report
from src.services.citation_service import find_citations, citations_to_dict

logger = logging.getLogger(__name__)

# ── Clinical dimensions (ordered by priority) ────────────────────────────────

DIMENSIONS = [
    "medication_adherence",
    "current_symptoms",
    "caregiver_concern",
    "behavioral_changes",
    "recent_events",
    "functional_status",
]

# Dimension → human-readable label for question generation
DIM_LABELS = {
    "medication_adherence": "medication adherence (is the patient taking their prescriptions regularly?)",
    "current_symptoms":     "current symptoms or changes in wellbeing (pain, fatigue, shortness of breath, etc.)",
    "caregiver_concern":    "the caregiver's specific concern or priority for this check-in",
    "behavioral_changes":   "recent behavioural changes (sleep, appetite, mood, activity level)",
    "recent_events":        "recent events that might affect health (missed appointments, illness, stress, travel)",
    "functional_status":    "how the patient is managing daily activities and independence",
}

# Minimum dimensions that must be at least 'partial' before generating the report
REPORT_THRESHOLD = 4


# ── Redis helpers ─────────────────────────────────────────────────────────────

_redis_client: Optional[redis_lib.Redis] = None


def _get_redis() -> redis_lib.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.Redis(
            host=settings.REDIS_HOST, port=settings.REDIS_PORT, decode_responses=True,
        )
    return _redis_client


CONV_TTL  = 86_400
# Raised from 24 → 500 so caregiver conversations run indefinitely. The
# context_compactor (Redis-backed rolling summary) handles the prompt-size
# side, so a high hard cap only bounds Redis payload size, not prompt length.
MAX_TURNS = 500

# Per-model char budget for the context_compactor. Matches the patient-chat
# table in amina_agent.py so both flows behave identically. Values are in
# chars (4:1 char:token rule for Mistral tokenizer).
_CG_MODEL_BUDGETS: Dict[str, int] = {
    "amina":   20_000,
    "groq":    10_000,
    "mistral": 10_000,
    "gemini":  22_000,
    "base":    18_000,
}


def _conv_key(cg: str, pid: str) -> str:
    return f"cg_conv:{cg}:{pid}"


def _load_history(cg: str, pid: str) -> List[Dict]:
    try:
        raw = _get_redis().get(_conv_key(cg, pid))
        return json.loads(raw) if raw else []
    except Exception:
        return []


def _save_history(cg: str, pid: str, history: List[Dict]) -> None:
    try:
        _get_redis().setex(_conv_key(cg, pid), CONV_TTL, json.dumps(history[-MAX_TURNS:]))
    except Exception:
        pass


def clear_history(caregiver_id: str, patient_id: str) -> None:
    try:
        _get_redis().delete(_conv_key(caregiver_id, patient_id))
    except Exception:
        pass


# ── [0] PATIENT RESOLVER ─────────────────────────────────────────────────────

def _name_tokens(name: str) -> List[str]:
    """Return lowercase name parts longer than 2 characters."""
    return [p.lower() for p in name.split() if len(p) > 2]


def _fuzzy_match_patient(message: str, patients: List[Dict]) -> Optional[Dict]:
    """
    Score each patient by how many of their name tokens appear in the message.
    Returns the best match if score > 0, else None.
    """
    msg_lower = message.lower()
    best_score = 0
    best_patient = None

    for p in patients:
        name = p.get("name", "")
        tokens = _name_tokens(name)
        score = sum(1 for t in tokens if t in msg_lower)
        if score > best_score:
            best_score = score
            best_patient = p

    return best_patient if best_score > 0 else None


def _resolve_patient(
    message: str,
    caregiver_id: str,
    default_patient_id: str,
) -> Dict[str, Any]:
    """
    Step 0: Resolve which patient the caregiver is asking about.

    1. Load all active patients for this caregiver from the DB.
    2. Fuzzy-match their names against the caregiver's message.
    3. Return the resolved patient dict + a `switched` flag.

    Falls back to default_patient_id if no name is detected.
    """
    from src.repositories.caregiver_repo import CaregiverRepository
    try:
        repo = CaregiverRepository()
        patients = repo.get_patients_for_caregiver(caregiver_id)
    except Exception as e:
        logger.warning(f"caregiver_amina: patient list load failed: {e}")
        return {"id": default_patient_id, "name": "", "switched": False}

    if not patients:
        return {"id": default_patient_id, "name": "", "switched": False}

    matched = _fuzzy_match_patient(message, patients)
    if matched:
        resolved_id = matched.get("id", default_patient_id)
        switched = resolved_id != default_patient_id
        return {"id": resolved_id, "name": matched.get("name", ""), "switched": switched}

    # No name detected → stay on the currently selected patient
    # Find name of default patient for logging
    default_name = next((p.get("name", "") for p in patients if p.get("id") == default_patient_id), "")
    return {"id": default_patient_id, "name": default_name, "switched": False}


# ── Patient data loader ───────────────────────────────────────────────────────

def _parse_list(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return [raw] if raw else []
    return []


async def _load_patient_data(patient_id: str) -> Dict[str, Any]:
    from src.utils.arcade_client import async_command_sql, extract_rows

    profile: Dict = {}
    try:
        resp = await async_command_sql(
            "SELECT name, age, gender, region, conditions, medications, "
            "allergies, last_bp, last_glucose, key_facts "
            "FROM PatientVertex WHERE id = :pid LIMIT 1",
            {"pid": patient_id},
        )
        rows = extract_rows(resp)
        if rows:
            profile = rows[0]
            for f in ("conditions", "medications", "allergies", "key_facts"):
                profile[f] = _parse_list(profile.get(f, []))
    except Exception as e:
        logger.warning(f"caregiver_amina: profile failed [{patient_id}]: {e}")

    consultations: List[Dict] = []
    try:
        resp = await async_command_sql(
            "SELECT started_at, triage_level, summary, symptoms_reported, recommendations "
            "FROM ConsultationRecord WHERE patient_id = :pid "
            "ORDER BY started_at DESC LIMIT 10",
            {"pid": patient_id},
        )
        rows = extract_rows(resp)
        for row in rows:
            for f in ("symptoms_reported", "recommendations"):
                row[f] = _parse_list(row.get(f, []))
        consultations = rows
    except Exception as e:
        logger.warning(f"caregiver_amina: consultations failed [{patient_id}]: {e}")

    behavior: Dict = {}
    try:
        raw = _get_redis().get(f"behavior:{patient_id}")
        if raw:
            behavior = json.loads(raw)
    except Exception:
        pass

    return {"profile": profile, "consultations": consultations, "behavior": behavior}


# ── Patient context block ─────────────────────────────────────────────────────

def _build_patient_block(patient_data: Dict) -> str:
    p        = patient_data["profile"]
    consults = patient_data["consultations"]
    behavior = patient_data["behavior"]

    name       = p.get("name", "the patient")
    age        = p.get("age", "")
    gender     = p.get("gender", "")
    region     = p.get("region", "")
    conditions = p.get("conditions", [])
    meds       = p.get("medications", [])
    allergies  = p.get("allergies", [])
    last_bp    = p.get("last_bp", "")
    last_glu   = p.get("last_glucose", "")
    key_facts  = p.get("key_facts", [])

    med_names = [m.get("name", str(m)) if isinstance(m, dict) else str(m) for m in meds]

    lines = [f"PATIENT: {name}"]
    demo = ", ".join(x for x in [f"{age}y" if age else "", gender, region] if x)
    if demo:        lines.append(f"  Demographics  : {demo}")
    if conditions:  lines.append(f"  Conditions    : {', '.join(conditions)}")
    if med_names:   lines.append(f"  Medications   : {', '.join(med_names)}")
    if allergies:   lines.append(f"  Allergies     : {', '.join(allergies)}")
    if last_bp or last_glu:
        lines.append(f"  Last vitals   : BP={last_bp or 'N/A'}  Glucose={last_glu or 'N/A'}")
    if key_facts:
        lines.append("  Key facts     :")
        for f in key_facts[:5]:
            lines.append(f"    • {f}")

    bparts = []
    if behavior.get("engagement_pattern"):
        bparts.append(f"engagement={behavior['engagement_pattern']}")
    if behavior.get("medication_adherence_signal"):
        bparts.append(f"adherence={behavior['medication_adherence_signal']}")
    if bparts:
        lines.append(f"  Behavior      : {', '.join(bparts)}")

    triage_counts: Dict[str, int] = {}
    consult_lines: List[str] = []
    for c in consults:
        date   = (c.get("started_at") or "")[:10]
        triage = c.get("triage_level") or "—"
        summ   = c.get("summary") or "No summary."
        syms   = c.get("symptoms_reported", [])[:4]
        recs   = c.get("recommendations", [])[:2]
        triage_counts[triage] = triage_counts.get(triage, 0) + 1
        line = f"  [{date}] {triage} — {summ}"
        if syms: line += f"\n    Symptoms: {', '.join(syms)}"
        if recs:  line += f"\n    Advice given: {'; '.join(recs)}"
        consult_lines.append(line)

    if triage_counts:
        lines.append(
            "  Triage summary: " + ", ".join(f"{k}×{v}" for k, v in sorted(triage_counts.items()))
        )
    lines.append("\nCONSULTATION HISTORY (most recent first):")
    lines.extend(consult_lines if consult_lines else ["  No consultation records found."])
    return "\n".join(lines)


# ── [2] INFO STATE EXTRACTOR ──────────────────────────────────────────────────

_INFO_STATE_SYSTEM = """You are a clinical information analyst.

You will be given:
1. A patient's database record (profile + consultation history).
2. A conversation between a caregiver and AMINA.

Your task: for each clinical dimension below, determine how much information
has been gathered from the caregiver's messages in the conversation.

Dimensions:
- medication_adherence   : Is the patient taking their prescriptions regularly?
- current_symptoms       : Any new or worsening symptoms right now?
- caregiver_concern      : What specifically is the caregiver worried about?
- behavioral_changes     : Changes in sleep, appetite, mood, or activity?
- recent_events          : Missed appointments, illness, stress, or other events?
- functional_status      : How is the patient managing daily life / independence?

For each dimension output one of:
  "unknown"  — caregiver has not addressed this at all
  "partial"  — caregiver mentioned something but it is vague or incomplete
  "known"    — caregiver has given a clear, usable answer

Also output:
  "gaps"              : list of dimension names that are still "unknown"
  "covered_count"     : number of dimensions that are "partial" or "known"
  "ready_for_report"  : true if covered_count >= 4, else false
  "summary_of_known"  : 1-2 sentence summary of what the caregiver has shared so far

Respond ONLY with a valid JSON object. No extra text."""


async def _extract_info_state(
    patient_block: str,
    history: List[Dict],
    client: AsyncOpenAI,
    model_name: str = "",
) -> Dict[str, Any]:
    """
    Fast LLM call: analyse conversation history and return the information state.
    Falls back to a safe default (all unknown, no report) on any error.
    """
    if not history:
        return {
            "medication_adherence": "unknown",
            "current_symptoms":     "unknown",
            "caregiver_concern":    "unknown",
            "behavioral_changes":   "unknown",
            "recent_events":        "unknown",
            "functional_status":    "unknown",
            "gaps":                 DIMENSIONS[:],
            "covered_count":        0,
            "ready_for_report":     False,
            "summary_of_known":     "",
        }

    conv_text = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in history[-16:]
    )
    user_msg = f"PATIENT DATABASE RECORD:\n{patient_block}\n\nCONVERSATION:\n{conv_text}"

    try:
        resp = await client.chat.completions.create(
            model=model_name or settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": _INFO_STATE_SYSTEM},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.1,
            max_tokens=400,
        )
        state = json.loads(resp.choices[0].message.content)
        # Normalise
        state.setdefault("gaps", [d for d in DIMENSIONS if state.get(d) == "unknown"])
        state.setdefault("covered_count", sum(
            1 for d in DIMENSIONS if state.get(d) in ("partial", "known")
        ))
        state.setdefault("ready_for_report", state["covered_count"] >= REPORT_THRESHOLD)
        state.setdefault("summary_of_known", "")
        return state
    except Exception as e:
        logger.warning(f"caregiver_amina: info-state extraction failed: {e}")
        return {
            "medication_adherence": "unknown",
            "current_symptoms":     "unknown",
            "caregiver_concern":    "unknown",
            "behavioral_changes":   "unknown",
            "recent_events":        "unknown",
            "functional_status":    "unknown",
            "gaps":                 DIMENSIONS[:],
            "covered_count":        0,
            "ready_for_report":     False,
            "summary_of_known":     "",
        }


# ── [3] DECISION ENGINE ───────────────────────────────────────────────────────

# Direct-answer keywords — questions that should get an immediate response,
# not a counter-question from the clinical interview flow.
_DIRECT_ANSWER_PATTERNS = [
    "what is", "what are", "what does", "what should", "what can",
    "how is", "how's", "hows", "how are", "how do", "how does", "how to",
    "how can", "how should", "how much", "how many",
    "why is", "why does", "why should", "why are",
    "tell me", "explain", "describe", "give me", "list",
    "is it", "can i", "can he", "can she", "should i", "should he", "should she",
    "is he", "is she", "is the patient", "is my",
    "when should", "when to", "when is",
    "help me", "advise", "recommend", "suggest",
    "what about", "tips", "advice",
    "update on", "status of", "any update", "any change",
]

_DIRECT_ANSWER_CONTAINS = [
    "doing", "feeling", "okay", "ok?", "alright", "better", "worse",
    "how's", "hows",
]


def _is_direct_question(message: str) -> bool:
    lower = message.lower().strip()
    if any(lower.startswith(p) for p in _DIRECT_ANSWER_PATTERNS):
        return True
    if any(kw in lower for kw in _DIRECT_ANSWER_CONTAINS):
        return True
    return False


def _decide_action(info_state: Dict, history: List[Dict], message: str = "") -> str:
    """
    Returns "question", "report", "followup", or "content_gen".

    Intent priority (highest first):
      1. Content generation request  → "content_gen"
      2. Report already generated    → "followup"
      3. Direct question (how/what)  → "followup" (answer immediately)
      4. Enough dimensions covered   → "report"
      5. 8+ caregiver turns          → "report"
      6. Default                     → "question" (interview continues)
    """
    # 1. Content generation — overrides everything
    if message and _is_content_generation_request(message):
        return "content_gen"

    # 1b. Content correction/continuation — if the last AMINA response was long
    # structured content and the user is providing a correction or refinement
    if message and history:
        _last_assistant = None
        for m in reversed(history):
            if m.get("role") == "assistant":
                _last_assistant = m.get("content", "")
                break
        if _last_assistant and len(_last_assistant) > 500:
            lower = message.lower()
            _correction_cues = ["not for", "not about", "for general", "for public",
                                "for the community", "more general", "make it",
                                "change it", "redo", "rewrite", "try again",
                                "instead", "rather", "different"]
            if any(cue in lower for cue in _correction_cues):
                return "content_gen"

    # 2. Already generated a report → follow-up mode
    for msg in history:
        if msg.get("role") == "assistant" and "Clinical Briefing" in msg.get("content", ""):
            return "followup"

    # 3. Direct question — caregiver is asking something specific, answer it
    if message and _is_direct_question(message):
        return "followup"

    caregiver_turns = sum(1 for m in history if m["role"] == "user")
    if info_state.get("ready_for_report") or caregiver_turns >= 8:
        return "report"
    return "question"


# ── [4a] QUESTION GENERATOR ───────────────────────────────────────────────────

async def _generate_question(
    caregiver_name: str,
    patient_name: str,
    patient_block: str,
    info_state: Dict,
    history: List[Dict],
    message: str,
    client: AsyncOpenAI,
    literacy_modifier: str = "",
    model_name: str = "",
) -> str:
    gaps = info_state.get("gaps", [])
    known_summary = info_state.get("summary_of_known", "")

    gap_descriptions = "\n".join(
        f"  - {DIM_LABELS[g]}" for g in gaps if g in DIM_LABELS
    )
    if not gap_descriptions:
        gap_descriptions = "  - Any other relevant observations you think I should know."

    literacy_note = f"\nCOMMUNICATION STYLE: {literacy_modifier}" if literacy_modifier else ""

    system = f"""You are AMINA, a WHO-aligned clinical AI conducting a structured patient intake with {caregiver_name} about their patient {patient_name}.
{literacy_note}
{patient_block}

WHAT YOU ALREADY KNOW (from the caregiver so far):
{known_summary or 'Nothing gathered yet.'}

WHAT YOU STILL NEED TO KNOW:
{gap_descriptions}

YOUR TASK:
Ask ONE focused, empathetic question to gather the most critical missing information.
- Prioritise the highest-risk gap — medication adherence and symptoms come first.
- Ask naturally, like a senior clinician talking to a colleague — warm but precise.
- Acknowledge what the caregiver already shared before asking for more.
- Keep it short (1-3 sentences).
- NEVER repeat a question already in the conversation.
- Do NOT give clinical advice yet — gather information first."""

    msgs = [{"role": "system", "content": system}]
    msgs.extend(history[-12:])
    msgs.append({"role": "user", "content": message})

    resp = await client.chat.completions.create(
        model=model_name or settings.OPENAI_MODEL,
        messages=msgs,
        temperature=0.4,
        max_tokens=400,
    )
    return resp.choices[0].message.content


# ── [4b] REPORT GENERATOR ─────────────────────────────────────────────────────

async def _generate_report(
    caregiver_name: str,
    patient_name: str,
    patient_block: str,
    info_state: Dict,
    history: List[Dict],
    message: str,
    client: AsyncOpenAI,
    model_name: str = "",
) -> str:
    known_summary = info_state.get("summary_of_known", "")

    # Extract all caregiver-stated information from history
    caregiver_statements = "\n".join(
        f"  Caregiver said: {m['content']}"
        for m in history
        if m["role"] == "user"
    )

    system = f"""You are AMINA, a WHO-aligned clinical intelligence system generating an evidence-based briefing for {caregiver_name} about their patient {patient_name}.

You meet the same standard of rigour as Hippocratic AI and Microsoft Healthcare AI: every claim is grounded in data, red flags are called out directly, and recommendations follow WHO PEN / Gambian clinical protocols.

{patient_block}

INFORMATION GATHERED FROM CAREGIVER DURING THIS INTERVIEW:
{caregiver_statements or 'See conversation history.'}

BRIEF SUMMARY OF WHAT IS KNOWN:
{known_summary or 'See conversation history.'}

YOUR TASK:
Generate a comprehensive, publication-quality clinical briefing that synthesises:
  (a) The patient's historical data from the database above.
  (b) The caregiver's current observations from this conversation.
  (c) Any WHO PEN guidelines or standard-of-care protocols relevant to this patient's conditions.

Use this exact structure — write each section in full, never abbreviate:

**Clinical Briefing — {patient_name}**

**Current Status**
3-4 sentences: overall clinical trajectory, risk stratification, and whether the patient is stable/improving/deteriorating. Reference specific data points.

**Key Concerns**
Bullet list: the most significant clinical issues. Name red flags directly and explain why they matter. Cross-reference with WHO PEN thresholds where applicable.

**Medication Status**
Current regimen, adherence assessment from caregiver input, drug interaction risks, and whether dosage review is needed.

**Symptom Trends**
Patterns across consultations + current symptoms. Note any progression, new presentations, or resolved issues.

**Behavioural & Lifestyle Signals**
Sleep, appetite, mood, activity, social determinants. Flag anything that could affect treatment outcomes.

**Recommended Actions**
Numbered list: 5-7 concrete, specific, prioritised steps. For each action specify WHO should do it, WHAT exactly, and WHEN (timeline). Include both immediate and follow-up actions.

**When to Escalate**
Specific red-flag criteria that warrant immediate facility referral (call 199 or go to EFSTH/nearest health centre).

---
End with one line inviting follow-up questions.

QUALITY STANDARDS:
- Ground every point in actual patient data — never fabricate.
- Be clinically direct — do not soften serious concerns.
- Reference specific vitals, lab values, or dates when available.
- Recommendations must be actionable by a community health worker in The Gambia."""

    msgs = [{"role": "system", "content": system}]
    msgs.extend(history[-16:])
    msgs.append({"role": "user", "content": message})

    resp = await client.chat.completions.create(
        model=model_name or settings.OPENAI_MODEL,
        messages=msgs,
        temperature=0.3,
        max_tokens=2000,
    )
    return resp.choices[0].message.content


# ── [4c] CONTENT GENERATION PIPELINE ─────────────────────────────────────────
#
# Two-turn flow:
#   Turn 1 → AMINA asks clarifying questions (audience, format, scope)
#   Turn 2 → AMINA generates complete content using GPT-4o-mini
#            (always GPT-4o-mini, even when LoRA is selected — LoRA can't
#             do long-form generation within its 4K context window)
#
# Redis key: cg_content_pending:{caregiver_id}:{patient_id}
# TTL: 600s (10 minutes to provide details)

_CONTENT_PENDING_TTL = 600

_CONTENT_FORMAT_KEYWORDS = [
    "speech", "essay", "letter", "document", "presentation",
    "talk", "lecture", "handout", "pamphlet", "brochure",
    "poster", "article", "care plan", "health talk",
    "report", "protocol", "guideline",
]

_CONTENT_ACTION_KEYWORDS = [
    "write", "generate", "draft", "compose", "prepare",
    "create", "make", "produce", "develop", "outline",
]

_CONTENT_SINGLE_TRIGGERS = [
    "write a", "write an", "write me",
    "generate a", "generate an", "generate me",
    "draft a", "draft an", "draft me",
    "compose a", "compose an",
    "prepare a", "prepare an",
    "create a", "create an",
    "make a", "make an", "make me",
    "give me a speech", "give me an essay", "give me a letter",
    "give me a presentation", "give me a report",
    "give me a plan", "give me a guideline",
    "gimme a", "gimme an",
    "can you write", "can you generate", "can you draft",
    "can you make", "can you create", "can you prepare",
    "i need a speech", "i need an essay", "i need a letter",
    "i need a presentation", "i need a report",
    "speech on", "speech about", "essay on", "essay about",
    "talk on", "talk about", "lecture on", "lecture about",
]


def _is_content_generation_request(message: str) -> bool:
    lower = message.lower()
    if any(trigger in lower for trigger in _CONTENT_SINGLE_TRIGGERS):
        return True
    has_action = any(kw in lower for kw in _CONTENT_ACTION_KEYWORDS)
    has_format = any(kw in lower for kw in _CONTENT_FORMAT_KEYWORDS)
    if has_action and has_format:
        return True
    format_hits = sum(1 for kw in _CONTENT_FORMAT_KEYWORDS if kw in lower)
    return format_hits >= 2


def _content_pending_key(cg: str, pid: str) -> str:
    return f"cg_content_pending:{cg}:{pid}"


def _get_content_pending(cg: str, pid: str) -> Optional[Dict]:
    try:
        raw = _get_redis().get(_content_pending_key(cg, pid))
        return json.loads(raw) if raw else None
    except Exception:
        return None


def _set_content_pending(cg: str, pid: str, state: Dict) -> None:
    try:
        _get_redis().setex(
            _content_pending_key(cg, pid), _CONTENT_PENDING_TTL, json.dumps(state),
        )
    except Exception:
        pass


def _clear_content_pending(cg: str, pid: str) -> None:
    try:
        _get_redis().delete(_content_pending_key(cg, pid))
    except Exception:
        pass


def _detect_content_scope(message: str) -> str:
    """Determine if the request is patient-specific or general."""
    lower = message.lower()
    general_cues = [
        "general", "public", "community", "everyone", "people",
        "audience", "event", "awareness", "education", "campaign",
        "village", "town", "school", "church", "mosque",
    ]
    if any(cue in lower for cue in general_cues):
        return "general"
    return "patient_specific"


def _extract_content_format(message: str) -> str:
    """Extract the content format from the message."""
    lower = message.lower()
    format_map = [
        ("speech", "speech"), ("talk", "health talk"), ("lecture", "lecture"),
        ("essay", "essay"), ("letter", "letter"), ("presentation", "presentation"),
        ("care plan", "care plan"), ("health talk", "health talk"),
        ("handout", "handout"), ("pamphlet", "pamphlet"), ("brochure", "brochure"),
        ("poster", "poster"), ("article", "article"), ("guideline", "guideline"),
        ("protocol", "protocol"), ("report", "report"), ("document", "document"),
        ("plan", "plan"), ("summary", "summary"),
    ]
    for keyword, label in format_map:
        if keyword in lower:
            return label
    return "document"


def _extract_content_topic(message: str) -> str:
    """Extract the health topic from the message."""
    lower = message.lower()
    topics = [
        "diabetes", "hypertension", "blood pressure", "malaria", "hiv",
        "nutrition", "maternal", "child health", "immunization", "vaccination",
        "mental health", "tuberculosis", "cholera", "diarrhea", "pneumonia",
        "anemia", "sickle cell", "asthma", "epilepsy", "cancer",
        "family planning", "reproductive health", "breastfeeding",
        "hand washing", "hygiene", "sanitation", "water", "covid",
        "medication", "adherence", "diet", "exercise", "lifestyle",
    ]
    found = [t for t in topics if t in lower]
    return ", ".join(found) if found else ""


_NCD_TOPICS = [
    {"key": "diabetes",          "label": "Diabetes (Type 1 & 2)"},
    {"key": "hypertension",      "label": "Hypertension"},
    {"key": "cardiovascular",    "label": "Cardiovascular Disease"},
    {"key": "asthma",            "label": "Asthma / COPD"},
    {"key": "sickle_cell",       "label": "Sickle Cell Disease"},
    {"key": "epilepsy",          "label": "Epilepsy"},
    {"key": "mental_health",     "label": "Mental Health"},
    {"key": "kidney",            "label": "Kidney Disease"},
    {"key": "cancer",            "label": "Cancer"},
    {"key": "malaria",           "label": "Malaria"},
    {"key": "hiv",               "label": "HIV / AIDS"},
    {"key": "tuberculosis",      "label": "Tuberculosis"},
    {"key": "maternal_health",   "label": "Maternal & Child Health"},
    {"key": "nutrition",         "label": "Nutrition & Malnutrition"},
    {"key": "family_planning",   "label": "Family Planning"},
]

_FORMAT_OPTIONS = [
    {"key": "speech",        "label": "Speech / Health Talk"},
    {"key": "essay",         "label": "Essay / Article"},
    {"key": "care_plan",     "label": "Care Plan"},
    {"key": "presentation",  "label": "Presentation"},
    {"key": "letter",        "label": "Letter"},
    {"key": "guideline",     "label": "Guideline / Protocol"},
    {"key": "handout",       "label": "Handout / Pamphlet"},
    {"key": "poster",        "label": "Poster"},
]

_LENGTH_OPTIONS = [
    {"key": "brief",          "label": "Brief (5-minute talk)"},
    {"key": "standard",       "label": "Standard (15-minute presentation)"},
    {"key": "comprehensive",  "label": "Comprehensive (full document)"},
]

_SCOPE_OPTIONS = [
    {"key": "patient_specific", "label": "For this patient"},
    {"key": "general",          "label": "General / Public audience"},
]


def handle_content_gen_flow(
    message: str,
    caregiver_id: str,
    caregiver_name: str,
    patient_id: str,
    patient_name: str,
    history: List[Dict],
) -> Optional[Dict]:
    """
    Two-turn content generation flow.

    Turn 1: Detect intent → return form config (frontend renders interactive form)
    Turn 2: Caregiver submits form → return None (let the generator handle it)

    Returns:
        dict with response + content_form config if Turn 1
        None if Turn 2 or not applicable
    """
    pending = _get_content_pending(caregiver_id, patient_id)

    # ── Turn 2: form submitted or text follow-up ─────────────────────────────
    if pending and pending.get("stage") == "awaiting_details":
        lower = message.lower().strip()
        if lower in ("cancel", "nevermind", "never mind", "no", "stop", "forget it"):
            _clear_content_pending(caregiver_id, patient_id)
            return {"response": "No problem! How else can I help you?", "pending": None}

        # Parse structured form submission: [Content Request] Format: X | Scope: Y | ...
        if message.startswith("[Content Request]"):
            parts_str = message.replace("[Content Request]", "").strip()
            for part in parts_str.split("|"):
                part = part.strip()
                if part.lower().startswith("format:"):
                    pending["format"] = part.split(":", 1)[1].strip().lower()
                elif part.lower().startswith("scope:"):
                    scope_val = part.split(":", 1)[1].strip().lower()
                    pending["scope"] = "patient_specific" if "patient" in scope_val else "general"
                elif part.lower().startswith("topics:"):
                    pending["topic"] = part.split(":", 1)[1].strip()
                elif part.lower().startswith("length:"):
                    pending["length"] = part.split(":", 1)[1].strip().lower()
                elif part.lower().startswith("notes:"):
                    pending["caregiver_details"] = part.split(":", 1)[1].strip()

        pending["caregiver_details"] = pending.get("caregiver_details") or message
        pending["stage"] = "ready_to_generate"
        if not pending.get("scope") or pending["scope"] == "unknown":
            pending["scope"] = _detect_content_scope(message)
        _set_content_pending(caregiver_id, patient_id, pending)
        return None

    # ── Turn 1: new content gen request → return form config ─────────────────
    if not _is_content_generation_request(message):
        return None

    content_format = _extract_content_format(message)
    topic = _extract_content_topic(message)
    scope = _detect_content_scope(message)

    pending_state = {
        "stage": "awaiting_details",
        "format": content_format,
        "topic": topic,
        "scope": scope,
        "original_request": message,
    }
    _set_content_pending(caregiver_id, patient_id, pending_state)

    # Return form config for the frontend
    return {
        "response": f"I'll help you create that! Please fill in the details below.",
        "content_form": {
            "detected_format": content_format,
            "detected_topic":  topic,
            "detected_scope":  scope,
            "patient_name":    patient_name,
            "format_options":  _FORMAT_OPTIONS,
            "scope_options":   _SCOPE_OPTIONS,
            "length_options":  _LENGTH_OPTIONS,
            "ncd_topics":      _NCD_TOPICS,
        },
        "pending": pending_state,
    }


async def _generate_content(
    caregiver_name: str,
    patient_name: str,
    patient_block: str,
    history: List[Dict],
    message: str,
    pending: Optional[Dict] = None,
) -> str:
    """
    Generate long-form health content using GPT-4o-mini.

    ALWAYS uses GPT-4o-mini regardless of model_preference because:
    - LoRA has 4K context → can't generate speeches/essays
    - Groq/Mistral have lower quality for long-form content
    - GPT-4o-mini has 128K context and excellent instruction-following

    This is the ONLY function that generates content (speeches, essays, etc.)
    """
    # Build context from pending state if available
    scope = "general"
    content_format = "document"
    topic = ""
    caregiver_details = ""
    original_request = message

    length = "standard"

    if pending:
        scope = pending.get("scope", "general")
        content_format = pending.get("format", "document")
        topic = pending.get("topic", "")
        caregiver_details = pending.get("caregiver_details", "")
        original_request = pending.get("original_request", message)
        length = pending.get("length", "standard")

    length_guide = {
        "brief": "Keep it concise — suitable for a 5-minute talk or 1–2 pages.",
        "standard": "Standard length — suitable for a 15-minute presentation or 3–5 pages.",
        "comprehensive": "Comprehensive and thorough — suitable for a full session or 8+ pages.",
    }.get(length, "")

    # Choose whether to include patient data
    patient_context = ""
    if scope == "patient_specific":
        patient_context = f"""
PATIENT DATA (use this to ground content in real clinical data):
{patient_block}
"""
    else:
        patient_context = f"""
NOTE: This is a GENERAL / PUBLIC content request. Do NOT reference the specific patient ({patient_name}) by name.
Write for a general audience using evidence-based health education.
"""

    system = f"""You are AMINA, a WHO-aligned clinical AI assistant meeting the gold standard of healthcare AI (Hippocratic AI / Microsoft Healthcare AI level).

{caregiver_name} has asked you to create a **{content_format}**{f' on **{topic}**' if topic else ''}.
Scope: **{scope.replace('_', ' ').upper()}**
{f'Length: {length_guide}' if length_guide else ''}
{patient_context}
{f'CAREGIVER SPECIFICATIONS: {caregiver_details}' if caregiver_details else ''}

QUALITY STANDARDS — you MUST meet ALL of these:

1. **COMPLETE DOCUMENT** — Generate the FULL, publication-ready content. Never truncate, summarize, or abbreviate. If it's a speech, write every sentence. If it's an essay, write every paragraph.

2. **PROFESSIONAL STRUCTURE** — Use this structure:
   - **Title** (bold, compelling)
   - **Opening** (engaging hook appropriate to the format)
   - **Body sections** with **bold headings**, numbered points, bullet lists
   - **Key messages** clearly highlighted
   - **Closing** with call to action

3. **EVIDENCE-BASED** — Ground every claim in:
   - WHO PEN (Package of Essential NCD Interventions) guidelines
   - WHO AFRO regional guidelines for sub-Saharan Africa
   - Gambian National Health Policy and Standard Treatment Guidelines
   - Current clinical evidence and established medical consensus

4. **CULTURALLY GROUNDED** — Reference:
   - Gambian food examples (benachin, domoda, supakanja, moringa, bissap)
   - Local health infrastructure (EFSTH, regional health centres, CHWs, VHWs)
   - Realistic community scenarios for The Gambia
   - Local units and measurements

5. **ACTIONABLE** — Every section must include specific, practical steps that:
   - A community health worker can implement
   - A patient/community member can follow at home
   - Include specific numbers (e.g., "walk 30 minutes daily", "less than 5g salt per day")

6. **FORMAT-APPROPRIATE** —
   - Speech: conversational tone, rhetorical questions, audience engagement cues
   - Essay: formal structure, thesis statement, evidence paragraphs
   - Care plan: SMART goals, timeline, responsible parties
   - Presentation: slide-ready bullet points, key statistics
   - Health talk: interactive elements, Q&A prompts, demonstrations

Write the COMPLETE content now. Every word, every section, every detail."""

    # Always use GPT-4o-mini for content generation
    content_client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
    )

    msgs = [{"role": "system", "content": system}]
    # Include recent conversation for context
    for m in history[-8:]:
        msgs.append({"role": m["role"], "content": m["content"][:500]})
    msgs.append({"role": "user", "content": message})

    resp = await content_client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=msgs,
        temperature=0.4,
        max_tokens=4000,
    )
    response_text = resp.choices[0].message.content or ""

    # Auto-continue if truncated
    if getattr(resp.choices[0], "finish_reason", None) == "length" and response_text:
        try:
            cont_msgs = list(msgs) + [
                {"role": "assistant", "content": response_text},
                {"role": "user", "content": "Continue from exactly where you left off. Do not repeat any content already written."},
            ]
            cont_resp = await content_client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=cont_msgs,
                temperature=0.4,
                max_tokens=3000,
            )
            cont_text = (cont_resp.choices[0].message.content or "").strip()
            if cont_text:
                response_text = response_text.rstrip() + "\n\n" + cont_text
        except Exception as e:
            logger.warning(f"caregiver_amina: content continuation failed: {e}")

    return response_text


# ── [4d] FOLLOW-UP HANDLER ──────────────────────────────────────────────────

async def _generate_followup(
    caregiver_name: str,
    patient_name: str,
    patient_block: str,
    history: List[Dict],
    message: str,
    client: AsyncOpenAI,
    model_name: str = "",
) -> str:
    system = f"""You are AMINA, a WHO-aligned clinical intelligence system answering {caregiver_name}'s question about {patient_name}.

{patient_block}

Answer the caregiver's question directly using full clinical context — the patient database data above + everything gathered in this conversation.

RESPONSE STANDARDS:
- **Answer the actual question asked** — read the caregiver's message carefully and respond to their specific intent.
- Write in natural flowing paragraphs — like a knowledgeable senior colleague chatting.
- Do NOT use numbered lists, bullet points, or bold markdown headers unless the caregiver explicitly asks for structured/formatted output.
- Ground every claim in patient data or WHO/clinical guidelines — never fabricate.
- Be clinically precise — reference specific vitals, lab values, medications, and dates when relevant.
- Follow WHO PEN guidelines and Gambian health protocols where applicable.
- Be concise — match the depth and length to what was actually asked. A simple question gets a simple answer.
- Do NOT ask clarifying questions unless genuinely unable to answer.
- Do NOT regenerate a full report unless explicitly asked."""
    max_tok = 1500

    msgs = [{"role": "system", "content": system}]
    msgs.extend(history[-16:])
    msgs.append({"role": "user", "content": message})

    resp = await client.chat.completions.create(
        model=model_name or settings.OPENAI_MODEL,
        messages=msgs,
        temperature=0.35,
        max_tokens=max_tok,
    )
    return resp.choices[0].message.content or ""


# ── LoRA caregiver response (uses full pipeline; LoRA generates final answer) ──

async def _lora_caregiver_response(
    caregiver_name: str,
    patient_name: str,
    patient_block: str,
    history: List[Dict],
    message: str,
    client: AsyncOpenAI,
    model_name: str = "",
    action: str = "followup",
    info_state: Optional[Dict] = None,
) -> str:
    """
    LoRA-powered caregiver response with 3-layer enhancement pipeline.

    Layer 0: LoRA generates a raw draft (compressed context for 4K window)
    Layer 1: Output cleanup — strip garbage chars (####, repeated tokens)
    Layer 2: Quality gate — detect bad output, auto-escalate to GPT-4o-mini
    Layer 3: Refinement — GPT-4o-mini enhances LoRA's draft into gold-standard

    Content generation (speeches, essays) is handled by _generate_content()
    and never reaches this function.
    """
    import re as _re

    patient_summary = patient_block[:1000]

    # ── Build LoRA system prompt (compact — fits 4K window) ──────────────
    if action == "question" and info_state:
        gaps = info_state.get("gaps", [])
        gap_text = ", ".join(DIM_LABELS.get(g, g) for g in gaps[:3])
        lora_system = (
            f"You are AMINA, a Gambian CHW AI assistant helping caregiver {caregiver_name} "
            f"about patient {patient_name}.\n\n{patient_summary}\n\n"
            f"GAPS TO FILL: {gap_text}\n\n"
            "Ask ONE warm, focused question about the most critical gap. "
            "Be empathetic but precise. 2-3 sentences max."
        )
    elif action == "report":
        cg_says = "\n".join(m["content"][:150] for m in history if m["role"] == "user")[-600:]
        lora_system = (
            f"You are AMINA, a clinical AI for caregiver {caregiver_name} "
            f"about {patient_name}.\n\n{patient_summary}\n\n"
            f"CAREGIVER SAID:\n{cg_says}\n\n"
            "Write a clinical briefing covering: current status, key concerns, "
            "medication, symptoms, recommended actions, when to escalate."
        )
    else:
        lora_system = (
            f"You are AMINA, a WHO-aligned CHW AI assistant for caregiver {caregiver_name} "
            f"about patient {patient_name}.\n\n{patient_summary}\n\n"
            "IMPORTANT: You are the CAREGIVER'S assistant. Read their message carefully.\n"
            "- Answer their ACTUAL question directly and conversationally.\n"
            "- Write in natural flowing paragraphs like a senior colleague.\n"
            "- Do NOT use numbered lists, bullet points, or bold headers unless asked.\n"
            "- Reference patient data when relevant.\n"
            "- For emergencies: call 199 or go to EFSTH."
        )

    lora_msgs: List[Dict] = [{"role": "system", "content": lora_system}]
    for m in history[-4:]:
        lora_msgs.append({"role": m["role"], "content": m["content"][:400]})
    lora_msgs.append({"role": "user", "content": message[:500]})

    max_tok = 1000 if action == "report" else 600

    # ── Layer 0: LoRA raw generation ─────────────────────────────────────
    try:
        resp = await client.chat.completions.create(
            model=model_name or settings.AMINA_MODEL_NAME,
            messages=lora_msgs,
            temperature=0.35,
            max_tokens=max_tok,
        )
        raw_text = resp.choices[0].message.content or ""
    except Exception as e:
        logger.warning(f"caregiver_amina: LoRA call failed, escalating: {e}")
        raw_text = ""

    # ── Layer 1: Output cleanup ──────────────────────────────────────────
    # Strip garbage: ####, repeated chars, trailing noise
    cleaned = raw_text
    cleaned = _re.sub(r'[#]{4,}', '', cleaned)
    cleaned = _re.sub(r'[*]{4,}', '', cleaned)
    cleaned = _re.sub(r'[=]{4,}', '', cleaned)
    cleaned = _re.sub(r'[-]{6,}', '---', cleaned)
    cleaned = _re.sub(r'\.{4,}', '...', cleaned)
    # Strip repeated single chars (e.g. "aaaa" or "    " runs)
    cleaned = _re.sub(r'(.)\1{10,}', r'\1\1\1', cleaned)
    cleaned = cleaned.strip()

    # ── Layer 2: Quality gate ────────────────────────────────────────────
    needs_escalation = False
    escalation_reason = ""

    if not cleaned or len(cleaned) < 30:
        needs_escalation = True
        escalation_reason = "empty_or_too_short"
    elif len(cleaned) < 80 and action in ("report", "followup"):
        needs_escalation = True
        escalation_reason = "too_short_for_action"
    elif cleaned.count('#') > 20 or cleaned.count('*') > 30:
        needs_escalation = True
        escalation_reason = "garbage_characters"
    elif not cleaned[-1] in '.!?"\')' and len(cleaned) > 100:
        # Likely truncated mid-sentence
        last_sentence_end = max(cleaned.rfind('.'), cleaned.rfind('!'), cleaned.rfind('?'))
        if last_sentence_end > 0:
            cleaned = cleaned[:last_sentence_end + 1]
        else:
            needs_escalation = True
            escalation_reason = "truncated"

    if needs_escalation:
        logger.info(f"caregiver_amina: LoRA quality gate FAILED ({escalation_reason}), escalating to GPT-4o-mini")
        # Full escalation — GPT-4o-mini generates from scratch
        return await _gpt4o_caregiver_fallback(
            caregiver_name, patient_name, patient_block,
            history, message, action, info_state,
        )

    # ── Layer 3: GPT-4o-mini refinement ──────────────────────────────────
    # Take LoRA's draft and enhance it: add structure, formatting,
    # WHO references, clinical depth. This is fast (~500ms) and cheap.
    try:
        refine_client = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
        )

        if action == "question":
            return cleaned

        if action == "report":
            refine_system = (
                "You are a medical writing enhancer. You will receive a DRAFT clinical response "
                "from a community health AI (AMINA) and the caregiver's original question.\n\n"
                "Your job: ENHANCE the draft into a gold-standard clinical briefing.\n\n"
                "RULES:\n"
                "- PRESERVE the clinical content and intent of the draft\n"
                "- ADD proper markdown formatting: **bold headers**, bullet points, numbered lists\n"
                "- ADD specific WHO PEN guideline references where applicable\n"
                "- ADD actionable next steps if missing\n"
                "- EXPAND points that are too brief — add clinical detail\n"
                "- FIX any medical inaccuracies\n"
                "- Use Gambian health context (EFSTH, health centres, local foods)\n"
                "- Keep the warm, professional tone of a senior CHW\n"
                "- Do NOT fabricate patient data not in the draft\n"
                "- Output the ENHANCED response only, no meta-commentary"
            )
            refine_user = (
                f"CAREGIVER'S QUESTION: {message}\n\n"
                f"PATIENT CONTEXT:\n{patient_summary}\n\n"
                f"AMINA'S DRAFT RESPONSE:\n{cleaned}\n\n"
                "Enhance this into a structured, comprehensive clinical report."
            )
        else:
            refine_system = (
                "You are a medical response enhancer. You will receive a DRAFT response "
                "from a community health AI (AMINA) and the caregiver's original question.\n\n"
                "Your job: Polish the draft into a natural, conversational clinical response.\n\n"
                "RULES:\n"
                "- PRESERVE the clinical content and intent of the draft\n"
                "- Write in natural flowing paragraphs — like a knowledgeable colleague chatting\n"
                "- Do NOT add numbered lists, bullet points, or bold markdown headers\n"
                "- Do NOT turn a simple answer into a formal report\n"
                "- Keep it concise — match the complexity to the question asked\n"
                "- FIX any medical inaccuracies\n"
                "- Use Gambian health context naturally (EFSTH, local foods)\n"
                "- Warm, professional tone — not clinical-report tone\n"
                "- Do NOT fabricate patient data not in the draft\n"
                "- Output the ENHANCED response only, no meta-commentary"
            )
            refine_user = (
                f"CAREGIVER'S QUESTION: {message}\n\n"
                f"PATIENT CONTEXT:\n{patient_summary}\n\n"
                f"AMINA'S DRAFT RESPONSE:\n{cleaned}\n\n"
                "Polish this into a clear, conversational response. Keep it natural — "
                "no numbered lists or bold headers unless the caregiver asked for structured output."
            )

        refine_msgs = [
            {"role": "system", "content": refine_system},
            {"role": "user", "content": refine_user},
        ]

        refine_resp = await refine_client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=refine_msgs,
            temperature=0.3,
            max_tokens=1500,
        )
        refined = (refine_resp.choices[0].message.content or "").strip()
        if refined and len(refined) > len(cleaned) * 0.5:
            logger.info(f"caregiver_amina: LoRA refined ({len(cleaned)} → {len(refined)} chars)")
            return refined
        return cleaned
    except Exception as e:
        logger.warning(f"caregiver_amina: refinement failed, using cleaned LoRA: {e}")
        return cleaned


async def _gpt4o_caregiver_fallback(
    caregiver_name: str,
    patient_name: str,
    patient_block: str,
    history: List[Dict],
    message: str,
    action: str = "followup",
    info_state: Optional[Dict] = None,
) -> str:
    """
    Full GPT-4o-mini fallback when LoRA output fails the quality gate.
    Generates the complete response from scratch with gold-standard prompts.
    """
    fallback_client = AsyncOpenAI(
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
    )

    if action == "question" and info_state:
        gaps = info_state.get("gaps", [])
        gap_text = ", ".join(DIM_LABELS.get(g, g) for g in gaps[:3])
        system = (
            f"You are AMINA, a WHO-aligned clinical AI conducting a structured patient intake "
            f"with caregiver {caregiver_name} about patient {patient_name}.\n\n"
            f"{patient_block}\n\n"
            f"INFORMATION GAPS: {gap_text}\n\n"
            "Ask ONE focused, empathetic question about the most critical gap. "
            "Acknowledge what the caregiver already shared. Be warm but precise. 2-3 sentences."
        )
        max_tok = 300
    elif action == "report":
        cg_says = "\n".join(m["content"][:300] for m in history if m["role"] == "user")[-1200:]
        system = (
            f"You are AMINA, a WHO-aligned clinical AI generating a briefing for {caregiver_name} "
            f"about {patient_name}.\n\n{patient_block}\n\n"
            f"CAREGIVER OBSERVATIONS:\n{cg_says}\n\n"
            "Generate a comprehensive clinical briefing:\n"
            f"**Clinical Briefing — {patient_name}**\n\n"
            "**Current Status** — 3-4 sentences: trajectory, risk, stable/worsening\n"
            "**Key Concerns** — bullet list with red flags and WHO PEN thresholds\n"
            "**Medication Status** — regimen, adherence, interactions\n"
            "**Symptom Trends** — patterns, new presentations\n"
            "**Recommended Actions** — numbered, 5-7 steps (WHO/WHAT/WHEN)\n"
            "**When to Escalate** — red-flag criteria → call 199 / EFSTH\n\n"
            "Ground every point in data. Be clinically direct."
        )
        max_tok = 2000
    else:
        system = (
            f"You are AMINA, a WHO-aligned clinical AI assistant for caregiver {caregiver_name} "
            f"about patient {patient_name}.\n\n{patient_block}\n\n"
            "IMPORTANT: You are the CAREGIVER'S intelligent assistant. Read their message "
            "carefully and respond to their ACTUAL intent.\n\n"
            "RESPONSE STYLE:\n"
            "- Answer the specific question asked directly and conversationally\n"
            "- Write in natural flowing paragraphs — like a knowledgeable senior colleague\n"
            "- Do NOT use numbered lists, bullet points, or bold markdown headers\n"
            "- Reference specific patient data (vitals, meds, conditions) naturally\n"
            "- Follow WHO PEN guidelines and Gambian health protocols\n"
            "- Be concise — match the depth to what was asked\n"
            "- Emergencies → call 199 or refer to EFSTH"
        )
        max_tok = 1500

    msgs = [{"role": "system", "content": system}]
    msgs.extend(history[-12:])
    msgs.append({"role": "user", "content": message})

    resp = await fallback_client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=msgs,
        temperature=0.35,
        max_tokens=max_tok,
    )
    return resp.choices[0].message.content or ""


# ── Main entrypoint ───────────────────────────────────────────────────────────

async def caregiver_amina_chat(
    message: str,
    caregiver_id: str,
    caregiver_name: str,
    patient_id: str,
    session_id: Optional[str] = None,
    model_preference: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Intelligence pipeline for caregiver ↔ AMINA chat.

    Steps:
      1. Load patient DB data.
      2. Extract information state from conversation history (fast LLM).
      3. Decide: question / report / follow-up (deterministic).
      4. Generate the appropriate response (focused LLM call).

    Returns: {"response": str, "action": str, "session_id": str}
    """
    # ── Select LLM client based on model_preference ───────────────────────────
    _pref = (model_preference or "base").lower()
    if _pref == "gemini" and settings.GOOGLE_API_KEY:
        client = AsyncOpenAI(api_key=settings.GOOGLE_API_KEY, base_url=settings.GEMINI_BASE_URL)
        _model_name = settings.GEMINI_MODEL
    elif _pref == "groq" and settings.GROQ_API_KEY:
        client = AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)
        _model_name = settings.GROQ_MODEL
    elif _pref == "mistral" and settings.MISTRAL_API_KEY:
        client = AsyncOpenAI(api_key=settings.MISTRAL_API_KEY, base_url=settings.MISTRAL_BASE_URL)
        _model_name = settings.MISTRAL_MODEL
    elif _pref == "amina" and settings.AMINA_MODEL_URL:
        client = AsyncOpenAI(api_key="not-needed", base_url=settings.AMINA_MODEL_URL)
        _model_name = settings.AMINA_MODEL_NAME
    else:
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL)
        _model_name = settings.OPENAI_MODEL
    logger.info(f"caregiver_amina: using model={_model_name} (pref={_pref})")

    # Step 0 — Resolve which patient the caregiver is asking about
    resolved = _resolve_patient(message, caregiver_id, patient_id or "")
    resolved_pid  = resolved["id"]
    resolved_name = resolved["name"]
    switched      = resolved["switched"]

    if not resolved_pid:
        return {
            "response":            "Please select a patient before asking AMINA.",
            "action":              "no_patient",
            "session_id":          session_id or f"cg_{caregiver_id}",
            "resolved_patient_id": None,
            "switched_patient":    False,
        }

    logger.info(
        f"caregiver_amina: resolved patient={resolved_pid} "
        f"name={resolved_name!r} switched={switched}"
    )

    # When switching patients, start a fresh conversation thread
    if switched:
        clear_history(caregiver_id, resolved_pid)

    sid     = session_id or f"cg_{caregiver_id}_{resolved_pid}"
    history = _load_history(caregiver_id, resolved_pid)

    # ── Alert intent detection (pre-pipeline) ──────────────────────────────────
    # If the caregiver wants to send an alert, handle it in-chat without going
    # through the full clinical intelligence pipeline.
    try:
        from src.services.caregiver_alert_chat import detect_alert_intent, handle_alert_flow, _get_pending
        _has_pending_alert = _get_pending(caregiver_id, resolved_pid) is not None
        if detect_alert_intent(message) or _has_pending_alert:
            # Need patient name for the alert confirmation message
            _alert_patient_data = await _load_patient_data(resolved_pid)
            _alert_patient_name = _alert_patient_data["profile"].get("name", resolved_name or "the patient")
            alert_response, alert_complete = handle_alert_flow(
                message=message,
                caregiver_id=caregiver_id,
                caregiver_name=caregiver_name,
                patient_id=resolved_pid,
                patient_name=_alert_patient_name,
            )
            if alert_response is not None:
                # Save to conversation history so the alert flow is visible
                history.append({"role": "user",      "content": message})
                history.append({"role": "assistant", "content": alert_response})
                _save_history(caregiver_id, resolved_pid, history)
                return {
                    "response":              alert_response,
                    "action":                "alert_sent" if alert_complete else "alert_gathering",
                    "session_id":            sid,
                    "resolved_patient_id":   resolved_pid,
                    "resolved_patient_name": _alert_patient_name,
                    "switched_patient":      switched,
                    "citations":             [],
                }
    except Exception as _alert_err:
        logger.warning(f"caregiver_amina: alert flow failed (falling through): {_alert_err}")

    # ── Content generation 2-turn flow (pre-pipeline) ────────────────────────
    # Turn 1: detect intent → ask clarifying questions (audience, format, scope)
    # Turn 2: caregiver provides details → generate with GPT-4o-mini
    try:
        _has_content_pending = _get_content_pending(caregiver_id, resolved_pid) is not None
        if _is_content_generation_request(message) or _has_content_pending:
            _cg_patient_data = await _load_patient_data(resolved_pid)
            _cg_patient_name = _cg_patient_data["profile"].get("name", resolved_name or "the patient")
            _cg_result = handle_content_gen_flow(
                message=message,
                caregiver_id=caregiver_id,
                caregiver_name=caregiver_name,
                patient_id=resolved_pid,
                patient_name=_cg_patient_name,
                history=history,
            )
            if _cg_result is not None:
                # Turn 1 — AMINA returns form config for frontend
                _cg_response = _cg_result["response"]
                history.append({"role": "user",      "content": message})
                history.append({"role": "assistant", "content": _cg_response})
                _save_history(caregiver_id, resolved_pid, history)
                _has_form = "content_form" in _cg_result
                return {
                    "response":              _cg_response,
                    "action":                "content_form" if _has_form else "content_clarifying",
                    "content_form":          _cg_result.get("content_form"),
                    "session_id":            sid,
                    "resolved_patient_id":   resolved_pid,
                    "resolved_patient_name": _cg_patient_name,
                    "switched_patient":      switched,
                    "citations":             [],
                }
            # _cg_result is None → Turn 2: pending is "ready_to_generate"
            # Fall through — the pending state will be picked up in Step 4
    except Exception as _cg_err:
        logger.warning(f"caregiver_amina: content gen flow failed (falling through): {_cg_err}")

    # Step 1 — Load patient data + build context block
    patient_data  = await _load_patient_data(resolved_pid)
    patient_name  = patient_data["profile"].get("name", resolved_name or "the patient")
    patient_block = _build_patient_block(patient_data)

    # Prepend any pinned compact summary from the rolling context_compactor.
    # The summary is keyed by session_id and preserves clinical facts from
    # turns older than the ~4-turn verbatim tail. This is what lets caregiver
    # conversations run past the old 24-turn cap without losing continuity.
    try:
        from src.services.context_compactor import get_summary_for_session
        _pinned_cg_summary = await get_summary_for_session(sid)
        if _pinned_cg_summary:
            patient_block = (
                "[Prior conversation summary — facts from earlier turns]\n"
                f"{_pinned_cg_summary[:800]}\n\n"
                + patient_block
            )
    except Exception as _e:
        logger.debug(f"caregiver_amina: summary prepend failed (non-fatal): {_e}")

    # Load caregiver profile for Tier 2 literacy adaptor
    caregiver_data: Dict[str, Any] = {}
    try:
        from src.repositories.caregiver_repo import CaregiverRepository
        repo = CaregiverRepository()
        cg_profile = repo.get_by_id(caregiver_id)
        if cg_profile:
            caregiver_data = cg_profile
    except Exception:
        pass  # Non-fatal; SDOH will default to lay literacy

    # Step 1b — Golden-standard enrichment (Tier 0 + Tier 1 + Tier 2, zero LLM calls)
    caregiver_statements = [m["content"] for m in history if m["role"] == "user"]
    caregiver_statements.append(message)  # include current message
    try:
        enriched = enrich_patient_context(
            patient_id          = resolved_pid,
            patient_data        = patient_data,
            caregiver_statements= caregiver_statements,
            caregiver_data      = caregiver_data,
            patient_name        = patient_name,
        )
        logger.info(
            f"caregiver_amina: enrichment done — urgency={enriched.urgency_score}/10 "
            f"escalation={enriched.escalation.level} "
            f"flags={len(enriched.clinical_flags)} "
            f"cri={getattr(enriched.predictive_risk, 'cri', 'N/A')} "
            f"sdoh={getattr(enriched.sdoh_score, 'sdoh_label', 'N/A')}"
        )
    except Exception as e:
        logger.warning(f"caregiver_amina: enrichment failed (continuing): {e}")
        enriched = None

    # Emergency bypass: urgency >= 8 → skip interview, generate report immediately
    if enriched and enriched.urgency_score >= 8:
        logger.info(f"caregiver_amina: emergency bypass (urgency={enriched.urgency_score})")
        action = "report"
        info_state = {
            "medication_adherence": "unknown",
            "current_symptoms":     "unknown",
            "caregiver_concern":    "unknown",
            "behavioral_changes":   "unknown",
            "recent_events":        "unknown",
            "functional_status":    "unknown",
            "gaps":                 [],
            "covered_count":        6,
            "ready_for_report":     True,
            "summary_of_known":     "Emergency bypass — high urgency score triggered immediate report.",
        }
    else:
        # Step 2 — Extract information state (fast LLM call)
        # LoRA can't do JSON extraction — always use GPT-4o-mini for this step
        if _pref == "amina":
            _extract_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL)
            info_state = await _extract_info_state(patient_block, history, _extract_client, model_name=settings.OPENAI_MODEL)
        else:
            info_state = await _extract_info_state(patient_block, history, client, model_name=_model_name)
        logger.info(
            f"caregiver_amina: patient={resolved_pid} "
            f"covered={info_state['covered_count']}/6 "
            f"ready={info_state['ready_for_report']}"
        )
        # Step 3 — Decide action (now intent-aware)
        action = _decide_action(info_state, history, message=message)

    # Tier 2 — derive literacy modifier for AMINA system prompts
    literacy_modifier = ""
    if enriched and enriched.sdoh_score:
        literacy_modifier = enriched.sdoh_score.literacy.system_prompt_modifier

    # Tier 1 — CRI proactive alert prefix (prepend to first question if CRI >= 65)
    proactive_prefix = ""
    if (
        enriched
        and enriched.predictive_risk
        and enriched.predictive_risk.cri >= 65
        and not history  # only on the very first turn
    ):
        proactive_prefix = enriched.predictive_risk.proactive_message + "\n\n"

    # Step 4 — Generate response
    # Check for pending content gen state (Turn 2 of the 2-turn flow)
    _content_pending = _get_content_pending(caregiver_id, resolved_pid)
    logger.info(f"caregiver_amina: action={action} pref={_pref} content_pending={_content_pending is not None}")
    try:
        if action == "content_gen" or (_content_pending and _content_pending.get("stage") == "ready_to_generate"):
            # ── Content generation: ALWAYS uses GPT-4o-mini ─────────────────
            # LoRA has a 4K context window and can't generate long content.
            # GPT-4o-mini handles speeches, essays, plans, etc. for ALL models.
            response_text = await _generate_content(
                caregiver_name, patient_name, patient_block,
                history, message,
                pending=_content_pending,
            )
            _clear_content_pending(caregiver_id, resolved_pid)
        elif _pref == "amina" and action in ("question", "report"):
            # ── LoRA handles structured clinical tasks (questions, reports) ──
            response_text = await _lora_caregiver_response(
                caregiver_name, patient_name, patient_block,
                history, message, client,
                model_name=_model_name,
                action=action,
                info_state=info_state,
            )
            if proactive_prefix:
                response_text = proactive_prefix + response_text
        elif _pref == "amina" and action == "followup":
            # ── Conversational followups use core GPT-4o-mini layer ──────────
            # LoRA's 4K window + formatting tendencies produce poor casual
            # responses; the regular followup handler gives natural output.
            _core_client = AsyncOpenAI(
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL,
            )
            response_text = await _generate_followup(
                caregiver_name, patient_name, patient_block,
                history, message, _core_client,
                model_name=settings.OPENAI_MODEL,
            )
        elif action == "question":
            response_text = await _generate_question(
                caregiver_name, patient_name, patient_block,
                info_state, history, message, client,
                literacy_modifier=literacy_modifier,
                model_name=_model_name,
            )
            if proactive_prefix:
                response_text = proactive_prefix + response_text
        elif action == "report":
            if enriched is not None:
                response_text = await generate_soap_report(
                    caregiver_name   = caregiver_name,
                    patient_name     = patient_name,
                    patient_block    = patient_block,
                    enriched         = enriched,
                    caregiver_statements = caregiver_statements,
                    history          = history,
                    message          = message,
                    client           = client,
                    model            = _model_name,
                    info_state       = info_state,
                )
            else:
                response_text = await _generate_report(
                    caregiver_name, patient_name, patient_block,
                    info_state, history, message, client,
                    model_name=_model_name,
                )
        else:  # followup
            response_text = await _generate_followup(
                caregiver_name, patient_name, patient_block,
                history, message, client,
                model_name=_model_name,
            )
    except Exception as e:
        logger.error(f"caregiver_amina: generator failed ({action}): {e}")
        response_text = "I'm having trouble right now. Please try again in a moment."

    # Persist conversation history (keyed to the RESOLVED patient)
    history.append({"role": "user",      "content": message})
    history.append({"role": "assistant", "content": response_text})
    _save_history(caregiver_id, resolved_pid, history)

    # Schedule a background rolling-summary compaction if the running
    # history is approaching this model's char budget. Non-blocking —
    # the caregiver never waits for compaction; the next turn reads the
    # pinned summary back from Redis via get_summary_for_session().
    try:
        from src.services.context_compactor import maybe_schedule_compaction
        _cg_budget = _CG_MODEL_BUDGETS.get(_pref, _CG_MODEL_BUDGETS["base"])
        maybe_schedule_compaction(
            session_id   = sid,
            messages     = history,
            char_budget  = _cg_budget,
            patient_name = patient_name,
        )
    except Exception as _e:
        logger.debug(f"caregiver_amina: compactor schedule failed (non-fatal): {_e}")

    # ── Tier 4 — Generate / refresh care plan on every report ────────────────
    if enriched and action == "report":
        try:
            from src.services.care_protocol_engine import generate_and_store_plan
            generate_and_store_plan(
                patient_id   = resolved_pid,
                patient_name = patient_name,
                caregiver_id = caregiver_id,
                enriched     = enriched,
                redis_client = _get_redis(),
            )
            logger.info(f"caregiver_amina: care plan generated for {resolved_pid}")
        except Exception as _e:
            logger.warning(f"caregiver_amina: care plan generation failed: {_e}")

    # ── Tier 5 — Record activity event ───────────────────────────────────────
    try:
        from src.services.burnout_monitor import record_activity, ACTIVITY_SOAP_NOTE, ACTIVITY_CHAT
        _act = ACTIVITY_SOAP_NOTE if action == "report" else ACTIVITY_CHAT
        record_activity(caregiver_id, _act, _get_redis())
    except Exception:
        pass

    # ── Tier 6 — Record CRI snapshot ─────────────────────────────────────────
    if enriched and enriched.predictive_risk:
        try:
            from src.services.outcome_tracker import record_cri_snapshot
            record_cri_snapshot(
                patient_id   = resolved_pid,
                cri          = enriched.predictive_risk.cri,
                redis_client = _get_redis(),
                enriched_ctx = enriched,
            )
        except Exception as _e:
            logger.warning(f"caregiver_amina: CRI snapshot failed: {_e}")

    # Citations — only for reports and follow-ups (not mid-interview questions)
    try:
        if action in ("report", "followup", "content_gen"):
            citations = find_citations(response_text, max_citations=3)
            citation_list = citations_to_dict(citations)
        else:
            citation_list = []
    except Exception:
        citation_list = []

    # Build enrichment summary for API response
    enrichment_data: Dict[str, Any] = {}
    if enriched:
        # Tier 1 — CRI data
        cri_data: Dict[str, Any] = {}
        if enriched.predictive_risk:
            pr = enriched.predictive_risk
            cri_data = {
                "cri":              pr.cri,
                "cri_label":        pr.cri_label,
                "escalation_prob":  pr.escalation_prob,
                "adherence_decay":  pr.adherence_decay,
                "warnings":         pr.warnings[:3],
                "proactive_message": pr.proactive_message,
                "vital_forecasts": [
                    {
                        "vital":           vf.vital,
                        "current":         vf.current,
                        "projected_7d":    vf.projected_7d,
                        "slope_per_day":   vf.slope_per_day,
                        "breaches_target": vf.breaches_target,
                        "warning":         vf.warning,
                    }
                    for vf in pr.vital_forecasts[:4]
                ],
            }

        # Tier 2 — SDOH data
        sdoh_data: Dict[str, Any] = {}
        if enriched.sdoh_score:
            sd = enriched.sdoh_score
            sdoh_data = {
                "sdoh_label":           sd.sdoh_label,
                "overall_sdoh_score":   sd.overall_sdoh_score,
                "access_label":         sd.accessibility.access_label,
                "nearest_facility":     sd.accessibility.nearest_facility,
                "travel_minutes":       sd.accessibility.travel_minutes_current,
                "seasonal_risks":       sd.seasonal.active_risks,
                "support_level":        sd.family_support.support_level,
                "literacy_level":       sd.literacy.literacy_level,
                "sdoh_flags":           sd.sdoh_flags,
                "sdoh_recommendations": sd.sdoh_recommendations[:3],
                "escalation_pathway":   sd.escalation_pathway,
            }

        enrichment_data = {
            "urgency_score":      enriched.urgency_score,
            "escalation_level":   enriched.escalation.level,
            "escalation_message": enriched.escalation.message,
            "clinical_flags":     enriched.clinical_flags[:8],  # cap for response size
            "care_tasks": [
                {
                    "priority":    t.priority,
                    "category":    t.category,
                    "action":      t.action,
                    "timeframe":   t.timeframe,
                    "responsible": t.responsible,
                }
                for t in enriched.care_tasks[:5]
            ],
            "soap_note": {
                "subjective": enriched.soap_note.subjective,
                "objective":  enriched.soap_note.objective,
                "assessment": enriched.soap_note.assessment,
                "plan":       enriched.soap_note.plan,
            } if enriched.soap_note.assessment else None,
            **cri_data,
            "sdoh": sdoh_data if sdoh_data else None,
        }

    return {
        "response":            response_text,
        "action":              action,
        "session_id":          sid,
        "resolved_patient_id": resolved_pid,
        "resolved_patient_name": patient_name,
        "switched_patient":    switched,
        "citations":           citation_list,
        **enrichment_data,
    }
