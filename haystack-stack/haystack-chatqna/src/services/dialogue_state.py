"""
Dialogue State Tracker — Transformation 1.

Maintains a persistent DialogueState per conversation, updated after each
turn by a small LLM call. Injected into prompt assembly so the model has
continuity of thought across turns (active topic, open questions,
commitments, emotional register, who-is-the-patient).

Gate: settings.USE_DIALOGUE_STATE_TRACKER (default false).
When false, every public function is a no-op.

Storage: Redis for hot reads, ArcadeDB snapshots every 10 turns for
durability. Same pattern as the 3-tier memory system.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from src.config import settings

logger = logging.getLogger(__name__)

# ── Feature gate ─────────────────────────────────────────────────────────
_ENABLED = settings.USE_DIALOGUE_STATE_TRACKER

# Redis key patterns
_STATE_KEY = "dialogue_state:{sid}"
_LOCK_KEY = "dialogue_state:{sid}:lock"
_LOCK_TTL = 30  # seconds
_SNAPSHOT_INTERVAL = 10  # turns between ArcadeDB snapshots


# ── Data classes (plain dicts — no Pydantic dependency) ──────────────────

def _empty_state(conversation_id: str) -> Dict[str, Any]:
    """Return a fresh DialogueState as a plain dict."""
    return {
        "conversation_id": conversation_id,
        "updated_at": datetime.now().isoformat(),
        "turn_count": 0,

        "active_topic": None,
        "topic_started_at_turn": None,

        "subject": "self",
        "subject_description": None,

        "open_questions": [],
        "commitments": [],
        "pending_decisions": [],

        "emotional_arc": [],
        "current_register": "calm",

        "active_flow": None,
        "active_flow_step": None,

        "last_turn_shape": None,
        "last_turn_ended_with_question": False,

        "deferred_topics": [],
        "notes": None,
    }


# ── Redis helpers ────────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    return _redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        decode_responses=True,
    )


def _acquire_lock(r, conversation_id: str) -> bool:
    key = _LOCK_KEY.format(sid=conversation_id)
    return bool(r.set(key, "1", nx=True, ex=_LOCK_TTL))


def _release_lock(r, conversation_id: str):
    key = _LOCK_KEY.format(sid=conversation_id)
    r.delete(key)


# ── Public API ───────────────────────────────────────────────────────────

async def load_state(conversation_id: str) -> Optional[Dict[str, Any]]:
    """Load DialogueState from Redis. Returns None if flag is off or no
    state exists yet."""
    if not _ENABLED:
        return None
    try:
        r = _get_redis()
        raw = r.get(_STATE_KEY.format(sid=conversation_id))
        if raw:
            return json.loads(raw)
        return None
    except Exception as e:
        logger.warning(f"dialogue_state: load failed for {conversation_id}: {e}")
        return None


def save_state(conversation_id: str, state: Dict[str, Any]) -> bool:
    """Persist DialogueState to Redis. Returns success."""
    if not _ENABLED:
        return False
    try:
        r = _get_redis()
        state["updated_at"] = datetime.now().isoformat()
        r.set(_STATE_KEY.format(sid=conversation_id), json.dumps(state, default=str))
        return True
    except Exception as e:
        logger.warning(f"dialogue_state: save failed for {conversation_id}: {e}")
        return False


async def render_state_for_prompt(state: Optional[Dict[str, Any]]) -> str:
    """Render DialogueState as a compact text block for prompt injection.
    Returns empty string if flag is off or state is None.
    Target: ~150 tokens max."""
    if not _ENABLED or not state:
        return ""

    parts = []

    # Subject
    subj = state.get("subject", "self")
    subj_desc = state.get("subject_description")
    if subj == "other_person" and subj_desc:
        parts.append(f"Subject: {subj_desc}")
    elif subj == "general":
        parts.append("Subject: general health question (not about a specific person)")

    # Active topic
    topic = state.get("active_topic")
    turn_started = state.get("topic_started_at_turn")
    if topic:
        since = f" (since turn {turn_started})" if turn_started else ""
        parts.append(f"Active topic: {topic}{since}")

    # Emotional register
    register = state.get("current_register", "calm")
    arc = state.get("emotional_arc", [])
    if arc and len(arc) >= 2:
        recent = [m.get("register", "calm") for m in arc[-2:]]
        parts.append(f"Register: {' → '.join(recent)}")
    elif register != "calm":
        parts.append(f"Register: {register}")

    # Open questions
    open_qs = [q for q in state.get("open_questions", []) if q.get("still_relevant", True)]
    for q in open_qs[:2]:
        turn = q.get("asked_at_turn", "?")
        parts.append(f"Open question: {q.get('question', '?')} (asked turn {turn}, unanswered)")

    # Commitments
    for c in state.get("commitments", [])[-2:]:
        parts.append(f"Commitment: {c.get('commitment', '?')} (turn {c.get('made_at_turn', '?')})")

    # Pending decisions
    for d in state.get("pending_decisions", [])[:2]:
        parts.append(f"Pending: {d}")

    # Last turn shape
    last_shape = state.get("last_turn_shape")
    ended_q = state.get("last_turn_ended_with_question", False)
    if last_shape:
        suffix = "; you're likely about to answer" if ended_q else ""
        parts.append(f"Last turn: AMINA gave {last_shape}{suffix}")

    # Deferred topics
    for dt in state.get("deferred_topics", [])[:2]:
        parts.append(f"Deferred: {dt}")

    # Notes
    notes = state.get("notes")
    if notes:
        parts.append(f"Notes: {notes[:400]}")

    if not parts:
        return ""

    return "[Dialogue State — what we both know right now]\n" + "\n".join(parts)


# ── Update prompt ────────────────────────────────────────────────────────

_STATE_UPDATE_PROMPT = """You are a dialogue state analyst for AMINA, a Gambian healthcare agent.

Given the CURRENT STATE of a conversation and the LATEST EXCHANGE (user message + AMINA response), update the state. You are not generating a response — you are maintaining a structured representation of where this conversation is right now.

CURRENT STATE:
{current_state}

LATEST USER MESSAGE:
"{user_message}"

AMINA RESPONSE:
"{assistant_response}"

TOOLS THAT FIRED: {tools_used}
TRIAGE LEVEL: {triage_level}

UPDATE RULES:
1. CARRY FORWARD state that hasn't changed. Don't re-derive from scratch.
2. ACTIVE TOPIC: only change if the user genuinely shifted subjects. A follow-up question about the same topic is NOT a topic change.
3. SUBJECT: "self" if user is talking about their own health. "other_person" if talking about someone else (mother, child, husband, elder). "general" if asking general health info. Include a short description for "other_person".
4. OPEN QUESTIONS: if AMINA asked a question and the user answered it, mark still_relevant=false. If AMINA asked a new question, add it. Keep max 3.
5. COMMITMENTS: if the user said they'll do something ("I'll check tonight", "I will go tomorrow"), add it. Keep max 3.
6. PENDING DECISIONS: unresolved choices the user faces ("whether to go to clinic", "whether to tell husband"). Keep max 3.
7. EMOTIONAL ARC: add one entry for this turn. Don't thrash — if nothing changed emotionally, repeat the previous register. Registers: calm, worried, scared, confused, frustrated, hopeful, resigned.
8. LAST TURN SHAPE: what did AMINA's response primarily do? Options: greeting, question, advice, emergency, empathy, information, closing.
9. LAST TURN ENDED WITH QUESTION: did AMINA's response end with a question to the user?
10. DEFERRED TOPICS: things noticed but not yet addressed. Remove if addressed. Keep max 3.
11. NOTES: one sentence max, model-authored observation about the conversation dynamic. What would a good CHW notice?
12. INCREMENT turn_count by 1.

Return ONLY valid JSON matching the schema. No prose. No markdown fences.

JSON:"""


_BOOTSTRAP_PROMPT = """You are a dialogue state analyst for AMINA, a Gambian healthcare agent.

Given a conversation history, construct the INITIAL dialogue state. This conversation is already in progress — derive the state from what has been said.

CONVERSATION:
{transcript}

Construct a dialogue state with these fields:
- conversation_id: "{conversation_id}"
- turn_count: {turn_count} (number of user messages)
- active_topic: what is the current topic? (null if unclear)
- topic_started_at_turn: which turn did this topic start?
- subject: "self", "other_person", or "general"
- subject_description: if other_person, who? (e.g., "speaker's mother, ~70, diabetic")
- open_questions: list of {{question, asked_at_turn, still_relevant}} — things AMINA asked that haven't been answered
- commitments: list of {{commitment, made_at_turn, kind}} — things the user said they'd do. kind: "action", "followup", or "visit"
- pending_decisions: list of unresolved choices
- emotional_arc: list of {{turn, register}} for each turn. Registers: calm, worried, scared, confused, frustrated, hopeful, resigned
- current_register: the register right now
- active_flow: null unless a multi-step flow is in progress
- active_flow_step: null
- last_turn_shape: what did AMINA's last response do? (greeting/question/advice/emergency/empathy/information/closing)
- last_turn_ended_with_question: bool
- deferred_topics: things noticed but not yet addressed (max 3)
- notes: one sentence, what would a good CHW notice about this conversation?
- updated_at: current timestamp

Return ONLY valid JSON. No prose. No markdown fences.

JSON:"""


# ── Model call helpers ───────────────────────────────────────────────────

async def _call_update_model(prompt: str) -> Optional[Dict[str, Any]]:
    """Call a fast model for state update. Fallback: Gemini → Groq → GPT-4o-mini."""
    from openai import AsyncOpenAI
    import re

    clients = []

    # Gemini Flash Lite (fastest, free tier generous)
    if settings.GOOGLE_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GOOGLE_API_KEY, base_url=settings.GEMINI_BASE_URL),
            "gemini-2.0-flash-lite",
            "gemini",
        ))

    # Groq (fast, free tier)
    if settings.GROQ_API_KEY:
        clients.append((
            AsyncOpenAI(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL),
            settings.GROQ_MODEL,
            "groq",
        ))

    # GPT-4o-mini (reliable fallback)
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
                temperature=0.1,
                max_tokens=600,
            )
            text = (completion.choices[0].message.content or "").strip()
            # Strip markdown fences if present
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"```\s*$", "", text)
            result = json.loads(text)
            logger.debug(f"dialogue_state: update via {provider}/{model}")
            return result
        except Exception as e:
            logger.warning(f"dialogue_state: {provider} call failed: {e}")
            continue

    logger.error("dialogue_state: all model providers failed for state update")
    return None


# ── Core update logic ────────────────────────────────────────────────────

async def update_state_async(
    conversation_id: str,
    user_message: str,
    assistant_response: str,
    tools_used: List[str],
    triage_level: Optional[str],
) -> None:
    """Update DialogueState after a response is sent. Fire-and-forget.
    Called via asyncio.create_task — never blocks the response path."""
    if not _ENABLED:
        return

    try:
        r = _get_redis()
        if not _acquire_lock(r, conversation_id):
            logger.debug(f"dialogue_state: lock contention for {conversation_id}, skipping")
            return

        try:
            # Load or bootstrap
            raw = r.get(_STATE_KEY.format(sid=conversation_id))
            if raw:
                current_state = json.loads(raw)
            else:
                current_state = await _bootstrap_state(conversation_id, r)

            # Build update prompt
            prompt = _STATE_UPDATE_PROMPT.format(
                current_state=json.dumps(current_state, indent=2, default=str),
                user_message=user_message[:500],
                assistant_response=assistant_response[:500],
                tools_used=", ".join(tools_used) if tools_used else "none",
                triage_level=triage_level or "none",
            )

            updated = await _call_update_model(prompt)
            if not updated:
                return

            # Preserve conversation_id (model might omit it)
            updated["conversation_id"] = conversation_id
            updated["updated_at"] = datetime.now().isoformat()

            # Validate turn_count monotonically increases
            prev_count = current_state.get("turn_count", 0)
            new_count = updated.get("turn_count", prev_count + 1)
            if new_count <= prev_count:
                updated["turn_count"] = prev_count + 1

            # Cap list lengths
            updated["open_questions"] = (updated.get("open_questions") or [])[:3]
            updated["commitments"] = (updated.get("commitments") or [])[:3]
            updated["pending_decisions"] = (updated.get("pending_decisions") or [])[:3]
            updated["deferred_topics"] = (updated.get("deferred_topics") or [])[:3]
            updated["emotional_arc"] = (updated.get("emotional_arc") or [])[-5:]

            # Validate register
            valid_registers = {"calm", "worried", "scared", "confused", "frustrated", "hopeful", "resigned"}
            if updated.get("current_register") not in valid_registers:
                updated["current_register"] = current_state.get("current_register", "calm")

            # Validate last_turn_shape
            valid_shapes = {"greeting", "question", "advice", "emergency", "empathy", "information", "closing", None}
            if updated.get("last_turn_shape") not in valid_shapes:
                updated["last_turn_shape"] = None

            # Truncate notes
            if updated.get("notes"):
                updated["notes"] = updated["notes"][:400]

            # Save to Redis
            r.set(
                _STATE_KEY.format(sid=conversation_id),
                json.dumps(updated, default=str),
            )

            # ArcadeDB snapshot every N turns
            turn = updated.get("turn_count", 0)
            if turn > 0 and turn % _SNAPSHOT_INTERVAL == 0:
                asyncio.create_task(_snapshot_to_arcadedb(conversation_id, updated))

            logger.info(
                f"dialogue_state: updated {conversation_id} "
                f"turn={turn} topic={updated.get('active_topic')} "
                f"register={updated.get('current_register')}"
            )

        finally:
            _release_lock(r, conversation_id)

    except Exception as e:
        logger.warning(f"dialogue_state: update failed for {conversation_id}: {e}")


async def _bootstrap_state(
    conversation_id: str,
    r,
) -> Dict[str, Any]:
    """Construct initial state from the last 10 messages in Redis.
    Called lazily on first turn that reads state in an existing conversation."""
    try:
        raw_session = r.get(f"session:{conversation_id}")
        if not raw_session:
            return _empty_state(conversation_id)

        session = json.loads(raw_session)
        messages = session.get("messages", [])

        if not messages:
            return _empty_state(conversation_id)

        # Build transcript from last 10 messages
        recent = messages[-10:]
        transcript_parts = []
        for m in recent:
            role = m.get("role", "unknown").upper()
            content = m.get("content", "")[:300]
            transcript_parts.append(f"{role}: {content}")
        transcript = "\n".join(transcript_parts)

        user_count = sum(1 for m in messages if m.get("role") == "user")

        prompt = _BOOTSTRAP_PROMPT.format(
            transcript=transcript,
            conversation_id=conversation_id,
            turn_count=user_count,
        )

        result = await _call_update_model(prompt)
        if result:
            result["conversation_id"] = conversation_id
            result["updated_at"] = datetime.now().isoformat()
            # Save bootstrapped state
            r.set(
                _STATE_KEY.format(sid=conversation_id),
                json.dumps(result, default=str),
            )
            logger.info(f"dialogue_state: bootstrapped state for {conversation_id} from {len(recent)} messages")
            return result

    except Exception as e:
        logger.warning(f"dialogue_state: bootstrap failed for {conversation_id}: {e}")

    return _empty_state(conversation_id)


# ── ArcadeDB snapshot ────────────────────────────────────────────────────

async def _snapshot_to_arcadedb(
    conversation_id: str,
    state: Dict[str, Any],
) -> None:
    """Write a DialogueStateSnapshot to ArcadeDB for durability."""
    try:
        from src.utils.arcade_client import async_command_sql

        snapshot_id = f"ds_{uuid.uuid4().hex[:12]}"
        safe_state = json.dumps(state, default=str).replace("'", "''")
        turn = state.get("turn_count", 0)

        sql = (
            f"INSERT INTO DialogueStateSnapshot SET "
            f"id = '{snapshot_id}', "
            f"session_id = '{conversation_id}', "
            f"turn_count = {turn}, "
            f"state_json = '{safe_state}', "
            f"created_at = '{datetime.now().isoformat()}'"
        )
        await async_command_sql(sql)
        logger.info(f"dialogue_state: snapshot {snapshot_id} saved to ArcadeDB for {conversation_id}")
    except Exception as e:
        logger.warning(f"dialogue_state: ArcadeDB snapshot failed (non-fatal): {e}")
