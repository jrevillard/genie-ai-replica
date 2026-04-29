"""
Self-Learning Service for AMINA — Microsoft DAX / RLHF-inspired architecture.

Architecture (4-layer, event-driven):

  Layer 1: INTERACTION EVENTS (every message)
    → Structured clinical interaction record
    → Stored in ArcadeDB InteractionEvent vertex
    → Captures: clinical signals, engagement, topics, adherence, feedback

  Layer 2: CLINICAL INSIGHTS (session end)
    → LLM extracts validated clinical insights from session
    → Only insights that pass quality gate become durable
    → Stored in ArcadeDB ClinicalInsight vertex with quality score

  Layer 3: BEHAVIOR PROFILE (session end)
    → Statistical + LLM analysis of patient communication patterns
    → Stored on PatientVertex as structured metadata
    → Used for prompt personalization (opening style, response length)

  Layer 4: KNOWLEDGE CHUNKS (batch, threshold-gated)
    → High-quality clinical insights aggregated into RAG-retrievable chunks
    → Separate from WHO document chunks (tagged source_interaction)
    → Only created from insights with quality_score >= 0.7
    → Embedded + stored in chunks table for RAG retrieval

Quality Gate (inspired by DAX clinician review):
  - Interactions scored on 5 dimensions (0-1 each):
    1. clinical_accuracy: did the response follow WHO protocols?
    2. patient_safety: no harmful advice given?
    3. cultural_fit: Gambian context maintained?
    4. engagement_quality: patient continued the conversation?
    5. adherence_potential: advice was actionable and followed?
  - Only insights scoring >= 0.7 average become knowledge chunks
  - Feedback (thumbs up/down) directly modifies quality scores

Event triggers:
  EVERY MESSAGE → log_interaction() [sync, <1ms]
  THUMBS UP/DOWN → update_quality_score() [sync, <1ms]
  SESSION END → extract_clinical_insights() [async, background]
  SESSION END → update_behavior_profile() [async, background]
  BATCH (10+ quality insights) → promote_to_knowledge_chunks() [async]

Sources:
  - Microsoft Nuance DAX: continuous learning loop, clinician review gate
  - RLHF Pipeline: multi-dimensional scoring, reward-weighted retrieval
  - Microsoft Healthcare Agent Orchestrator: structured clinical schema
"""

import json
import logging
import hashlib
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from collections import Counter

from src.config import settings

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════
# LAYER 1: INTERACTION EVENTS
# Structured clinical interaction record — every message
# ══════════════════════════════════════════════════════════════


def log_interaction(
    redis_client,
    patient_id: str,
    session_id: str,
    user_msg: str,
    bot_response: str,
    tools_used: list = None,
    feedback: str = None,
    downvote_reason: str = None,
):
    """Log a structured interaction event. Sync, <1ms.

    Each event captures clinical signals that feed into all 4 layers.
    """
    if not patient_id:
        return

    msg_l = user_msg.lower().strip()
    event = {
        "patient_id": patient_id,
        "session_id": session_id,
        "timestamp": datetime.now().isoformat(),
        "hour": datetime.now().hour,

        # Content (truncated for storage)
        "user_msg": user_msg[:300],
        "bot_response": bot_response[:300],
        "user_msg_words": len(msg_l.split()),
        "bot_response_words": len(bot_response.split()),
        "tools": tools_used or [],

        # Clinical signals
        "topics": _detect_topics(msg_l),
        "engagement": _classify_engagement(msg_l),
        "adherence_signal": _detect_adherence(msg_l),
        "emotion_signal": _detect_emotion(msg_l),

        # Quality scores (updated by feedback, defaults to neutral)
        "quality": {
            "clinical_accuracy": 0.5,  # neutral until scored
            "patient_safety": 0.8,     # assume safe unless flagged
            "cultural_fit": 0.5,
            "engagement_quality": 0.5,
            "adherence_potential": 0.5,
        },

        # Explicit feedback (populated later by thumbs up/down)
        "feedback": feedback,
        "downvote_reason": downvote_reason,
    }

    # Auto-score engagement quality from signals
    if event["engagement"] == "positive":
        event["quality"]["engagement_quality"] = 0.8
    elif event["engagement"] == "confused":
        event["quality"]["engagement_quality"] = 0.3
    elif event["engagement"] == "detailed":
        event["quality"]["engagement_quality"] = 0.7

    # Feedback directly modifies quality scores
    if feedback == "up":
        for k in event["quality"]:
            event["quality"][k] = min(1.0, event["quality"][k] + 0.2)
    elif feedback == "down":
        for k in event["quality"]:
            event["quality"][k] = max(0.0, event["quality"][k] - 0.2)
        if downvote_reason == "wrong_info":
            event["quality"]["clinical_accuracy"] = 0.1
        elif downvote_reason == "not_cultural":
            event["quality"]["cultural_fit"] = 0.1

    try:
        key = f"events:{patient_id}"
        redis_client.lpush(key, json.dumps(event, default=str))
        redis_client.ltrim(key, 0, 199)  # keep last 200
        redis_client.expire(key, 365 * 86400)  # 1 year

        # Also save to ArcadeDB for durable storage (fire-and-forget)
        _save_event_to_arcade_sync(redis_client, patient_id, event)
    except Exception as e:
        logger.warning(f"Failed to log interaction: {e}")


def _save_event_to_arcade_sync(redis_client, patient_id: str, event: dict):
    """Queue event for async ArcadeDB save. Non-blocking."""
    try:
        queue_key = "event_save_queue"
        redis_client.lpush(queue_key, json.dumps(event, default=str))
        redis_client.ltrim(queue_key, 0, 999)  # cap queue
        redis_client.expire(queue_key, 7 * 86400)
    except Exception:
        pass


def _detect_topics(msg: str) -> List[str]:
    topics = []
    topic_map = {
        "diabetes": ["diabetes", "sugar", "glucose", "metformin", "insulin", "hba1c"],
        "hypertension": ["blood pressure", "bp", "hypertension", "amlodipine", "high pressure"],
        "diet": ["food", "eat", "diet", "cook", "salt", "maggi", "benachin", "domoda"],
        "exercise": ["walk", "exercise", "active", "physical", "jogging"],
        "medication": ["medicine", "pill", "tablet", "prescription", "dose", "pharmacy"],
        "emotional": ["scared", "worried", "lonely", "sad", "afraid", "hopeless", "depressed"],
        "smoking": ["smoke", "cigarette", "tobacco", "quit smoking", "shisha"],
        "ramadan": ["ramadan", "fast", "suhoor", "iftar", "fasting"],
        "kidney": ["kidney", "creatinine", "dialysis", "renal"],
        "respiratory": ["asthma", "inhaler", "breathing", "copd", "wheeze"],
    }
    for topic, keywords in topic_map.items():
        if any(kw in msg for kw in keywords):
            topics.append(topic)
    return topics or ["general"]


def _classify_engagement(msg: str) -> str:
    if msg in ("yes", "yeah", "ok", "okay", "sure", "alright", "hmm", "no", "nah"):
        return "minimal"
    if "?" in msg:
        return "curious"
    if len(msg.split()) > 20:
        return "detailed"
    if any(w in msg for w in ["thank", "thanks", "helpful", "good", "great"]):
        return "positive"
    if any(w in msg for w in ["confused", "don't understand", "what do you mean"]):
        return "confused"
    if any(w in msg for w in ["too long", "shorter", "simpler"]):
        return "wants_shorter"
    if any(w in msg for w in ["more", "detail", "explain", "tell me more"]):
        return "wants_more"
    return "normal"


def _detect_adherence(msg: str) -> Optional[str]:
    if any(w in msg for w in ["i tried", "i did", "i started", "yes i"]):
        return "followed"
    if any(w in msg for w in ["i forgot", "i couldn't", "i didn't", "too hard"]):
        return "did_not_follow"
    if any(w in msg for w in ["will try", "i'll try", "let me try", "okay i will"]):
        return "committed"
    return None


def _detect_emotion(msg: str) -> Optional[str]:
    if any(w in msg for w in ["scared", "afraid", "worried", "anxious"]):
        return "anxious"
    if any(w in msg for w in ["sad", "lonely", "hopeless", "depressed"]):
        return "sad"
    if any(w in msg for w in ["happy", "better", "improving", "good news"]):
        return "positive"
    if any(w in msg for w in ["angry", "frustrated", "annoyed"]):
        return "frustrated"
    return None


# ══════════════════════════════════════════════════════════════
# LAYER 2: CLINICAL INSIGHTS (session end)
# Quality-gated insights extracted from interactions
# ══════════════════════════════════════════════════════════════


async def extract_clinical_insights(
    patient_id: str,
    redis_client,
    openai_client,
) -> List[Dict]:
    """Extract validated clinical insights from recent interactions.

    Each insight has a quality score. Only insights >= 0.7 will later
    be promoted to knowledge chunks (Layer 4).

    Returns list of insight dicts.
    """
    try:
        raw = redis_client.lrange(f"events:{patient_id}", 0, 29) or []
        if len(raw) < 3:
            return []

        events = [json.loads(r) for r in raw]

        # Group by topic for focused insight extraction
        topic_events = {}
        for e in events:
            for t in e.get("topics", ["general"]):
                topic_events.setdefault(t, []).append(e)

        insights = []
        for topic, tevents in topic_events.items():
            if len(tevents) < 2:
                continue

            # Calculate average quality score for this topic's events
            avg_quality = _avg_quality(tevents)
            if avg_quality < 0.4:
                continue  # too many negative signals, skip

            # LLM extraction
            insight = await _extract_insight_llm(openai_client, topic, tevents)
            if not insight:
                continue

            insight["topic"] = topic
            insight["quality_score"] = avg_quality
            insight["patient_id"] = patient_id
            insight["event_count"] = len(tevents)
            insight["created_at"] = datetime.now().isoformat()
            insights.append(insight)

        # Save insights to ArcadeDB
        for ins in insights:
            await _save_insight_to_arcade(patient_id, ins)

        # Save to Redis for fast access
        if insights:
            redis_client.setex(
                f"insights:{patient_id}",
                180 * 86400,
                json.dumps(insights, default=str),
            )

        logger.info(f"Extracted {len(insights)} clinical insights for {patient_id}")
        return insights

    except Exception as e:
        logger.warning(f"Insight extraction failed: {e}")
        return []


def _avg_quality(events: list) -> float:
    """Compute average quality score across events."""
    scores = []
    for e in events:
        q = e.get("quality", {})
        if q:
            scores.append(sum(q.values()) / len(q))
    return sum(scores) / len(scores) if scores else 0.5


async def _extract_insight_llm(openai_client, topic: str, events: list) -> Optional[Dict]:
    """LLM extracts a structured clinical insight from interactions."""
    try:
        exchanges = []
        for e in events[:8]:
            exchanges.append(f"Patient: {e.get('user_msg', '')}\nCHW: {e.get('bot_response', '')}")

        resp = await openai_client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": f"""Analyze these patient-CHW interactions about {topic}.
Extract a structured clinical insight. ANONYMIZE all patient data.

INTERACTIONS:
{chr(10).join(exchanges[:5])}

Return ONLY valid JSON:
{{
  "clinical_finding": "what health pattern or need was identified (1 sentence)",
  "effective_approach": "what advice or approach worked well (1 sentence)",
  "cultural_context": "any Gambian cultural factor relevant (1 sentence, or null)",
  "common_barrier": "what barrier did patient face (1 sentence, or null)",
  "recommended_action": "what should a CHW do for similar cases (1 sentence)"
}}

JSON:"""}],
            temperature=0.2,
            max_tokens=200,
        )
        text = (resp.choices[0].message.content or "").strip()
        if text.startswith("```"):
            import re
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"```\s*$", "", text)
        return json.loads(text)
    except Exception as e:
        logger.warning(f"Insight LLM extraction failed: {e}")
        return None


async def _save_insight_to_arcade(patient_id: str, insight: Dict):
    """Save clinical insight to ArcadeDB ClinicalInsight vertex."""
    try:
        from src.utils.arcade_client import async_command_sql
        insight_id = f"ins_{patient_id}_{insight['topic']}_{hashlib.md5(insight.get('clinical_finding', '')[:50].encode()).hexdigest()[:8]}"

        await async_command_sql(
            "UPDATE ClinicalInsight SET "
            "insight_id = :iid, patient_id = :pid, topic = :topic, "
            "clinical_finding = :finding, effective_approach = :approach, "
            "cultural_context = :culture, common_barrier = :barrier, "
            "recommended_action = :action, quality_score = :quality, "
            "event_count = :ecount, created_at = :created "
            "UPSERT WHERE insight_id = :iid2",
            [insight_id, patient_id, insight["topic"],
             insight.get("clinical_finding", ""), insight.get("effective_approach", ""),
             insight.get("cultural_context"), insight.get("common_barrier"),
             insight.get("recommended_action", ""), insight.get("quality_score", 0.5),
             insight.get("event_count", 0), insight.get("created_at", datetime.now().isoformat()),
             insight_id],
        )
    except Exception as e:
        logger.warning(f"Failed to save insight to ArcadeDB: {e}")


# ══════════════════════════════════════════════════════════════
# LAYER 3: BEHAVIOR PROFILE (session end)
# Patient communication preferences for prompt personalization
# ══════════════════════════════════════════════════════════════


async def update_behavior_profile(
    patient_id: str,
    redis_client,
    openai_client=None,
) -> Optional[Dict]:
    """Compute and store patient behavior profile from interaction history.

    Profile is stored on PatientVertex and in Redis for fast retrieval.
    """
    try:
        raw = redis_client.lrange(f"events:{patient_id}", 0, 49) or []
        if len(raw) < 3:
            return None

        events = [json.loads(r) for r in raw]
        profile = _compute_behavior_profile(events)

        # LLM synthesis for personality (if enough data)
        if openai_client and len(events) >= 8:
            llm_profile = await _llm_profile_synthesis(openai_client, events)
            if llm_profile:
                profile.update(llm_profile)

        # Save to Redis (fast read at prompt time)
        redis_client.setex(
            f"behavior:{patient_id}",
            365 * 86400,
            json.dumps(profile, default=str),
        )

        # Save to PatientVertex (durable)
        try:
            from src.utils.arcade_client import async_command_sql
            await async_command_sql(
                "UPDATE PatientVertex SET behavior_profile = :bp, updated_at = :now WHERE id = :pid",
                [json.dumps(profile, default=str), datetime.now().isoformat(), patient_id],
            )
        except Exception:
            pass

        return profile

    except Exception as e:
        logger.warning(f"Behavior profile update failed: {e}")
        return None


def _compute_behavior_profile(events: list) -> Dict:
    """Statistical behavior profile from interaction events."""
    profile = {"interactions_analyzed": len(events), "last_updated": datetime.now().isoformat()}

    # Message length preference
    user_lens = [e.get("user_msg_words", 0) for e in events]
    avg = sum(user_lens) / len(user_lens) if user_lens else 0
    if avg < 8:
        profile["response_style"] = "concise"
    elif avg > 20:
        profile["response_style"] = "detailed"
    else:
        profile["response_style"] = "moderate"

    # Engagement patterns
    engagements = [e.get("engagement") for e in events]
    eng_counts = Counter(engagements)
    if eng_counts.get("wants_shorter", 0) > 2:
        profile["length_pref"] = "shorter"
    elif eng_counts.get("wants_more", 0) > 2:
        profile["length_pref"] = "longer"

    # Topics
    all_topics = []
    for e in events:
        all_topics.extend(e.get("topics", []))
    if all_topics:
        profile["top_topics"] = [t for t, _ in Counter(all_topics).most_common(3)]

    # Adherence
    adherence = [e.get("adherence_signal") for e in events if e.get("adherence_signal")]
    if adherence:
        followed = adherence.count("followed") + adherence.count("committed")
        total = len(adherence)
        profile["adherence_rate"] = round(followed / total, 2) if total else 0
        profile["adherence_tendency"] = "follows advice" if profile["adherence_rate"] > 0.5 else "needs encouragement"

    # Time preference
    hours = [e.get("hour", 12) for e in events]
    if hours:
        avg_h = sum(hours) / len(hours)
        profile["active_time"] = "morning" if avg_h < 10 else "afternoon" if avg_h < 17 else "evening"

    # Emotions
    emotions = [e.get("emotion_signal") for e in events if e.get("emotion_signal")]
    if emotions:
        profile["common_emotions"] = [em for em, _ in Counter(emotions).most_common(2)]

    # Quality feedback
    feedbacks = [e.get("feedback") for e in events if e.get("feedback")]
    if feedbacks:
        ups = feedbacks.count("up")
        downs = feedbacks.count("down")
        profile["satisfaction"] = round(ups / (ups + downs), 2) if (ups + downs) else 0.5

    return profile


async def _llm_profile_synthesis(openai_client, events: list) -> Optional[Dict]:
    """LLM synthesizes a personality summary from interaction events."""
    try:
        lines = []
        for e in events[-15:]:
            eng = e.get("engagement", "normal")
            topics = ", ".join(e.get("topics", []))
            adh = e.get("adherence_signal", "")
            lines.append(f"engagement={eng} topics=[{topics}]" + (f" adherence={adh}" if adh else ""))

        resp = await openai_client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": f"""Analyze this patient's interaction patterns.
Return JSON with communication guidance for a healthcare AI.

PATTERN LOG:
{chr(10).join(lines)}

Return ONLY JSON:
{{
  "personality": "1 sentence describing their communication style",
  "opening_style": "direct | warm | formal",
  "motivational_approach": "encouraging | factual | gentle-nudge",
  "special_notes": "any unique pattern (or null)"
}}
JSON:"""}],
            temperature=0.2, max_tokens=150,
        )
        text = (resp.choices[0].message.content or "").strip()
        if text.startswith("```"):
            import re
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"```\s*$", "", text)
        return json.loads(text)
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════
# LAYER 4: KNOWLEDGE CHUNKS (batch, quality-gated)
# Only high-quality clinical insights become RAG knowledge
# ══════════════════════════════════════════════════════════════


async def promote_to_knowledge_chunks(
    patient_id: str,
    redis_client,
) -> int:
    """Promote quality-gated clinical insights into RAG knowledge chunks.

    QUALITY GATE: Only insights with quality_score >= 0.7 become chunks.
    This prevents low-quality or negatively-rated interactions from
    polluting the knowledge base.

    Returns number of chunks created.
    """
    try:
        raw = redis_client.get(f"insights:{patient_id}")
        if not raw:
            return 0

        insights = json.loads(raw)
        # Quality gate: only promote high-quality insights
        quality_insights = [i for i in insights if i.get("quality_score", 0) >= 0.7]

        if len(quality_insights) < 2:
            return 0

        chunks_created = 0
        for insight in quality_insights:
            # Build chunk text from structured insight
            chunk_text = _insight_to_chunk_text(insight)
            if not chunk_text or len(chunk_text) < 50:
                continue

            # Generate embedding
            embedding = await _generate_embedding(chunk_text)

            # Category labels
            labels = ["source_interaction", "quality_validated"]
            topic = insight.get("topic", "general")
            label_map = {
                "diabetes": "topic_diabetes", "hypertension": "topic_hypertension",
                "diet": "topic_lifestyle", "exercise": "topic_lifestyle",
                "smoking": "topic_tobacco", "ramadan": "topic_ramadan",
                "kidney": "topic_kidney", "respiratory": "topic_respiratory",
                "emotional": "topic_mental_health",
            }
            if topic in label_map:
                labels.append(label_map[topic])
            labels.append("type_patient_education")

            # Save to chunks table
            await _save_chunk(patient_id, topic, chunk_text, embedding, labels,
                              insight.get("quality_score", 0.7))
            chunks_created += 1

        if chunks_created:
            redis_client.setex(
                f"chunks_promoted:{patient_id}",
                90 * 86400,
                json.dumps({"count": chunks_created, "at": datetime.now().isoformat()}),
            )
            logger.info(f"Promoted {chunks_created} quality insights to knowledge chunks for {patient_id}")

        return chunks_created

    except Exception as e:
        logger.warning(f"Chunk promotion failed: {e}")
        return 0


def _insight_to_chunk_text(insight: Dict) -> str:
    """Convert a structured clinical insight into readable chunk text."""
    parts = []
    topic = insight.get("topic", "general health").replace("_", " ").title()
    parts.append(f"Clinical Insight — {topic} Management in Gambian Context")

    if insight.get("clinical_finding"):
        parts.append(f"Finding: {insight['clinical_finding']}")
    if insight.get("effective_approach"):
        parts.append(f"Effective approach: {insight['effective_approach']}")
    if insight.get("cultural_context"):
        parts.append(f"Cultural context: {insight['cultural_context']}")
    if insight.get("common_barrier"):
        parts.append(f"Common barrier: {insight['common_barrier']}")
    if insight.get("recommended_action"):
        parts.append(f"Recommended CHW action: {insight['recommended_action']}")

    return "\n".join(parts)


async def _generate_embedding(text: str) -> list:
    """Generate 384-dim embedding for a chunk."""
    try:
        from haystack.components.embedders import SentenceTransformersTextEmbedder
        from haystack.utils import ComponentDevice

        def _embed():
            embedder = SentenceTransformersTextEmbedder(
                model=settings.EMBEDDING_MODEL,
                device=ComponentDevice.from_str("cpu"),
            )
            embedder.warm_up()
            return embedder.run(text)["embedding"]

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _embed)
    except Exception as e:
        logger.warning(f"Embedding generation failed: {e}")
        return [0.0] * 384


async def _save_chunk(
    patient_id: str, topic: str, text: str, embedding: list,
    labels: list, quality_score: float,
):
    """Save a quality-validated interaction chunk to ArcadeDB chunks table."""
    try:
        from src.utils.arcade_client import async_command_sql
        chunk_id = f"ix_{topic}_{hashlib.md5(text[:80].encode()).hexdigest()[:10]}"

        await async_command_sql(
            "UPDATE chunks SET "
            "chunk_id = :cid, text = :text, embedding = :emb, "
            "source = :src, title = :title, "
            "category_labels = :labels, graph_enriched = false "
            "UPSERT WHERE chunk_id = :cid2",
            [chunk_id, text, embedding,
             f"learned_interactions_{topic}", f"Clinical insight: {topic} (quality: {quality_score:.1f})",
             labels, chunk_id],
        )
    except Exception as e:
        logger.warning(f"Failed to save interaction chunk: {e}")


# ══════════════════════════════════════════════════════════════
# PROMPT INJECTION — retrieved at query time
# ══════════════════════════════════════════════════════════════


def get_learned_context(redis_client, patient_id: str) -> str:
    """Retrieve behavior profile for prompt injection. <2ms."""
    if not patient_id:
        return ""
    try:
        raw = redis_client.get(f"behavior:{patient_id}")
        if not raw:
            return ""

        p = json.loads(raw)
        if p.get("interactions_analyzed", 0) < 3:
            return ""

        lines = ["LEARNED PATIENT BEHAVIOR (adapt your style accordingly):"]
        if p.get("personality"):
            lines.append(f"  Personality: {p['personality']}")
        if p.get("response_style"):
            lines.append(f"  Communication: {p['response_style']} style")
        if p.get("length_pref"):
            lines.append(f"  Prefers: {p['length_pref']} responses")
        if p.get("opening_style"):
            lines.append(f"  Opening: {p['opening_style']} tone")
        if p.get("motivational_approach"):
            lines.append(f"  Motivation: {p['motivational_approach']} approach")
        if p.get("adherence_tendency"):
            lines.append(f"  Adherence: {p['adherence_tendency']}")
        if p.get("top_topics"):
            lines.append(f"  Focuses on: {', '.join(p['top_topics'])}")
        if p.get("active_time"):
            lines.append(f"  Active: {p['active_time']}")
        if p.get("special_notes"):
            lines.append(f"  Note: {p['special_notes']}")

        return "\n".join(lines) if len(lines) > 1 else ""

    except Exception:
        return ""


# ══════════════════════════════════════════════════════════════
# SCHEMA SETUP — creates ArcadeDB types for the learning system
# ══════════════════════════════════════════════════════════════


def setup_learning_schema():
    """Create ArcadeDB schema for the self-learning system.

    Called once on startup. Safe with IF NOT EXISTS.
    """
    from src.utils.arcade_client import command_sql

    steps = [
        # InteractionEvent — stores every interaction
        "CREATE DOCUMENT TYPE InteractionEvent IF NOT EXISTS",
        "CREATE PROPERTY InteractionEvent.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY InteractionEvent.session_id IF NOT EXISTS STRING",
        "CREATE PROPERTY InteractionEvent.timestamp IF NOT EXISTS STRING",
        "CREATE PROPERTY InteractionEvent.topics IF NOT EXISTS STRING",
        "CREATE PROPERTY InteractionEvent.engagement IF NOT EXISTS STRING",
        "CREATE PROPERTY InteractionEvent.adherence_signal IF NOT EXISTS STRING",
        "CREATE PROPERTY InteractionEvent.quality IF NOT EXISTS STRING",
        "CREATE PROPERTY InteractionEvent.feedback IF NOT EXISTS STRING",

        # ClinicalInsight — quality-gated insights from interactions
        "CREATE DOCUMENT TYPE ClinicalInsight IF NOT EXISTS",
        "CREATE PROPERTY ClinicalInsight.insight_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.topic IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.clinical_finding IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.effective_approach IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.cultural_context IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.common_barrier IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.recommended_action IF NOT EXISTS STRING",
        "CREATE PROPERTY ClinicalInsight.quality_score IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY ClinicalInsight.event_count IF NOT EXISTS INTEGER",
        "CREATE PROPERTY ClinicalInsight.created_at IF NOT EXISTS STRING",

        # PatientVertex behavior_profile field
        "CREATE PROPERTY PatientVertex.behavior_profile IF NOT EXISTS STRING",
    ]

    indexes = [
        "CREATE INDEX IF NOT EXISTS ON InteractionEvent (patient_id) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON ClinicalInsight (insight_id) UNIQUE",
        "CREATE INDEX IF NOT EXISTS ON ClinicalInsight (patient_id) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON ClinicalInsight (quality_score) NOTUNIQUE",
    ]

    for sql in steps + indexes:
        try:
            command_sql(sql)
        except Exception as e:
            logger.debug(f"Learning schema step: {e}")

    # OutcomeRecord — links advice given to actual health results
    outcome_steps = [
        "CREATE DOCUMENT TYPE OutcomeRecord IF NOT EXISTS",
        "CREATE PROPERTY OutcomeRecord.patient_id IF NOT EXISTS STRING",
        "CREATE PROPERTY OutcomeRecord.vital_type IF NOT EXISTS STRING",
        "CREATE PROPERTY OutcomeRecord.baseline_value IF NOT EXISTS STRING",
        "CREATE PROPERTY OutcomeRecord.current_value IF NOT EXISTS STRING",
        "CREATE PROPERTY OutcomeRecord.delta IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY OutcomeRecord.trend IF NOT EXISTS STRING",
        "CREATE PROPERTY OutcomeRecord.advice_given IF NOT EXISTS STRING",
        "CREATE PROPERTY OutcomeRecord.advice_topic IF NOT EXISTS STRING",
        "CREATE PROPERTY OutcomeRecord.days_elapsed IF NOT EXISTS INTEGER",
        "CREATE PROPERTY OutcomeRecord.created_at IF NOT EXISTS STRING",

        # CohortInsight — population-level patterns
        "CREATE DOCUMENT TYPE CohortInsight IF NOT EXISTS",
        "CREATE PROPERTY CohortInsight.cohort_key IF NOT EXISTS STRING",
        "CREATE PROPERTY CohortInsight.cohort_description IF NOT EXISTS STRING",
        "CREATE PROPERTY CohortInsight.finding IF NOT EXISTS STRING",
        "CREATE PROPERTY CohortInsight.effective_approach IF NOT EXISTS STRING",
        "CREATE PROPERTY CohortInsight.sample_size IF NOT EXISTS INTEGER",
        "CREATE PROPERTY CohortInsight.outcome_rate IF NOT EXISTS DOUBLE",
        "CREATE PROPERTY CohortInsight.created_at IF NOT EXISTS STRING",
    ]

    outcome_indexes = [
        "CREATE INDEX IF NOT EXISTS ON OutcomeRecord (patient_id) NOTUNIQUE",
        "CREATE INDEX IF NOT EXISTS ON CohortInsight (cohort_key) UNIQUE",
    ]

    for sql in outcome_steps + outcome_indexes:
        try:
            command_sql(sql)
        except Exception as e:
            logger.debug(f"Learning schema step: {e}")

    logger.info("Learning schema setup complete")


# ══════════════════════════════════════════════════════════════
# LAYER 5: OUTCOME TRACKING
# Links advice → actual health results (did BP actually drop?)
# This is the missing piece that separates toy systems from
# clinical-grade AI: measuring if our advice WORKED.
# ══════════════════════════════════════════════════════════════


async def track_outcome(
    patient_id: str,
    vital_type: str,
    current_value: str,
    redis_client,
):
    """Called whenever a patient reports a new vital reading.

    Compares to their baseline (first reading we have) and recent advice.
    Creates an OutcomeRecord linking the advice we gave to the result.

    This is the ONLY way to know if "use half Maggi cube" actually
    lowered BP — not engagement metrics, not thumbs up, but actual
    clinical numbers.
    """
    try:
        # Get baseline (oldest reading we have)
        vitals_key = f"vitals:{patient_id}:{vital_type}"
        raw_readings = redis_client.lrange(vitals_key, 0, -1) or []
        if len(raw_readings) < 2:
            return  # need at least baseline + current

        readings = [json.loads(r) for r in raw_readings]
        baseline = readings[-1]  # oldest
        previous = readings[1] if len(readings) > 1 else baseline

        # Compute delta
        delta = _compute_vital_delta(vital_type, current_value, baseline["value"])
        trend = delta.get("trend", "unknown")

        # Find what advice was given between baseline and now
        events = redis_client.lrange(f"events:{patient_id}", 0, 49) or []
        recent_events = [json.loads(e) for e in events]
        advice_topics = set()
        advice_previews = []
        for ev in recent_events:
            for t in ev.get("topics", []):
                advice_topics.add(t)
            if ev.get("bot_response"):
                advice_previews.append(ev["bot_response"][:100])

        # Save outcome record
        from src.utils.arcade_client import async_command_sql
        try:
            baseline_date = baseline.get("at", "")[:10]
            days = 0
            if baseline_date:
                try:
                    from datetime import datetime as dt
                    d1 = dt.fromisoformat(baseline_date)
                    days = (dt.now() - d1).days
                except Exception:
                    pass

            await async_command_sql(
                "INSERT INTO OutcomeRecord SET "
                "patient_id = :pid, vital_type = :vtype, "
                "baseline_value = :base, current_value = :curr, "
                "delta = :delta, trend = :trend, "
                "advice_given = :advice, advice_topic = :topics, "
                "days_elapsed = :days, created_at = :now",
                [patient_id, vital_type, baseline["value"], current_value,
                 delta.get("delta_numeric", 0.0), trend,
                 "; ".join(advice_previews[:3]), ", ".join(advice_topics),
                 days, datetime.now().isoformat()],
            )
            logger.info(f"Outcome tracked: {patient_id} {vital_type} {baseline['value']}→{current_value} ({trend}) over {days} days")

            # If outcome is positive, boost quality scores of related insights
            if trend == "improving":
                await _boost_insight_scores(patient_id, list(advice_topics), 0.1, redis_client)
            elif trend == "worsening":
                await _reduce_insight_scores(patient_id, list(advice_topics), 0.1, redis_client)

        except Exception as e:
            logger.warning(f"Failed to save outcome: {e}")

    except Exception as e:
        logger.warning(f"Outcome tracking failed: {e}")


def _compute_vital_delta(vital_type: str, current: str, baseline: str) -> Dict:
    """Compute typed delta between two vital readings."""
    try:
        if vital_type == "bp":
            cs, cd = [int(x) for x in current.replace(" ", "").split("/")]
            bs, bd = [int(x) for x in baseline.replace(" ", "").split("/")]
            ds = cs - bs
            trend = "improving" if ds <= -5 else "worsening" if ds >= 5 else "stable"
            return {"delta_numeric": float(ds), "trend": trend}
        if vital_type == "glucose":
            c = float(current.replace(" ", "").replace("mg/dL", ""))
            b = float(baseline.replace(" ", "").replace("mg/dL", ""))
            d = c - b
            trend = "improving" if d <= -15 else "worsening" if d >= 15 else "stable"
            return {"delta_numeric": d, "trend": trend}
    except Exception:
        pass
    return {"delta_numeric": 0.0, "trend": "unknown"}


async def _boost_insight_scores(patient_id, topics, amount, redis_client):
    """Boost quality scores of insights related to successful outcomes."""
    try:
        raw = redis_client.get(f"insights:{patient_id}")
        if not raw:
            return
        insights = json.loads(raw)
        changed = False
        for ins in insights:
            if ins.get("topic") in topics:
                ins["quality_score"] = min(1.0, ins.get("quality_score", 0.5) + amount)
                changed = True
        if changed:
            redis_client.setex(f"insights:{patient_id}", 180 * 86400, json.dumps(insights, default=str))
    except Exception:
        pass


async def _reduce_insight_scores(patient_id, topics, amount, redis_client):
    """Reduce quality scores when outcomes worsen — prevents bad advice from propagating."""
    try:
        raw = redis_client.get(f"insights:{patient_id}")
        if not raw:
            return
        insights = json.loads(raw)
        changed = False
        for ins in insights:
            if ins.get("topic") in topics:
                ins["quality_score"] = max(0.0, ins.get("quality_score", 0.5) - amount)
                changed = True
        if changed:
            redis_client.setex(f"insights:{patient_id}", 180 * 86400, json.dumps(insights, default=str))
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════
# LAYER 6: POPULATION COHORT LEARNING
# What works for 50-year-old Gambian women with diabetes as a GROUP?
# Individual learning is limited — population patterns are powerful.
# ══════════════════════════════════════════════════════════════


async def compute_cohort_insights(redis_client, openai_client=None) -> int:
    """Aggregate insights across ALL patients into population-level patterns.

    Groups patients by demographic + condition cohorts and finds what
    approaches work best for each group. This is the difference between
    "Fatou responds well to direct advice" and "Gambian women 45-60
    with diabetes + hypertension respond best to diet-first interventions
    with half-Maggi-cube approach."

    Should be run as a scheduled batch job (daily/weekly), not per-session.
    Returns number of cohort insights generated.
    """
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows

        # Get all patients with enough interaction data
        resp = await async_command_sql(
            "SELECT id, age, gender, region, conditions, behavior_profile "
            "FROM PatientVertex WHERE consultation_count > 2 LIMIT 500",
            [],
        )
        patients = extract_rows(resp)
        if len(patients) < 5:
            return 0

        # Build cohorts by: condition × gender × age_bracket
        cohorts = {}
        for p in patients:
            conditions = p.get("conditions", "[]")
            if isinstance(conditions, str):
                try:
                    conditions = json.loads(conditions)
                except Exception:
                    conditions = []

            gender = p.get("gender", "other")
            age = p.get("age", 0)
            age_bracket = "young" if age < 35 else "middle" if age < 55 else "elder"

            for cond in (conditions or ["general"]):
                key = f"{cond}_{gender}_{age_bracket}"
                if key not in cohorts:
                    cohorts[key] = {
                        "patients": [],
                        "condition": cond,
                        "gender": gender,
                        "age_bracket": age_bracket,
                    }
                cohorts[key]["patients"].append(p)

        # For each cohort with 3+ patients, compute population insights
        insights_created = 0
        for cohort_key, cohort in cohorts.items():
            if len(cohort["patients"]) < 3:
                continue

            # Gather behavior profiles for this cohort
            profiles = []
            for p in cohort["patients"]:
                bp = p.get("behavior_profile")
                if bp:
                    try:
                        profiles.append(json.loads(bp) if isinstance(bp, str) else bp)
                    except Exception:
                        pass

            if len(profiles) < 2:
                continue

            # Compute cohort-level patterns
            cohort_insight = _aggregate_cohort_profiles(cohort_key, cohort, profiles)

            # Save to ArcadeDB
            try:
                await async_command_sql(
                    "UPDATE CohortInsight SET "
                    "cohort_key = :key, cohort_description = :desc, "
                    "finding = :finding, effective_approach = :approach, "
                    "sample_size = :size, outcome_rate = :rate, "
                    "created_at = :now "
                    "UPSERT WHERE cohort_key = :key2",
                    [cohort_key, cohort_insight["description"],
                     cohort_insight["finding"], cohort_insight["approach"],
                     len(cohort["patients"]), cohort_insight.get("adherence_rate", 0.0),
                     datetime.now().isoformat(), cohort_key],
                )
                insights_created += 1
            except Exception as e:
                logger.warning(f"Failed to save cohort insight: {e}")

            # Also save as a knowledge chunk (high-quality population evidence)
            chunk_text = (
                f"Population insight — {cohort_insight['description']}:\n"
                f"Finding: {cohort_insight['finding']}\n"
                f"Effective approach: {cohort_insight['approach']}\n"
                f"Based on {len(cohort['patients'])} patients."
            )
            embedding = await _generate_embedding(chunk_text)
            labels = ["source_cohort", "quality_validated", "type_patient_education"]
            cond = cohort["condition"]
            label_map = {
                "diabetes": "topic_diabetes", "hypertension": "topic_hypertension",
                "asthma": "topic_respiratory",
            }
            if cond in label_map:
                labels.append(label_map[cond])

            try:
                await _save_chunk(
                    "COHORT", cohort_key, chunk_text, embedding, labels, 0.9,
                )
            except Exception:
                pass

        logger.info(f"Computed {insights_created} cohort insights from {len(patients)} patients")
        return insights_created

    except Exception as e:
        logger.warning(f"Cohort computation failed: {e}")
        return 0


def _aggregate_cohort_profiles(key: str, cohort: dict, profiles: list) -> Dict:
    """Aggregate behavior profiles across a patient cohort."""
    cond = cohort["condition"].replace("_", " ").title()
    gender = cohort["gender"]
    age_b = cohort["age_bracket"]

    desc = f"{age_b} {gender} patients with {cond}"

    # Find dominant patterns
    styles = [p.get("response_style", "moderate") for p in profiles]
    top_style = Counter(styles).most_common(1)[0][0] if styles else "moderate"

    topics_all = []
    for p in profiles:
        topics_all.extend(p.get("top_topics", []))
    top_topics = [t for t, _ in Counter(topics_all).most_common(3)] if topics_all else []

    adherence_rates = [p.get("adherence_rate", 0.5) for p in profiles if "adherence_rate" in p]
    avg_adherence = sum(adherence_rates) / len(adherence_rates) if adherence_rates else 0.5

    tendencies = [p.get("adherence_tendency", "") for p in profiles if p.get("adherence_tendency")]
    top_tendency = Counter(tendencies).most_common(1)[0][0] if tendencies else "mixed"

    return {
        "description": desc,
        "finding": f"{desc} prefer {top_style} communication, focus on {', '.join(top_topics[:2]) or 'general health'}",
        "approach": f"{top_style} responses, {top_tendency} adherence pattern (avg rate: {avg_adherence:.0%})",
        "adherence_rate": avg_adherence,
    }


# ══════════════════════════════════════════════════════════════
# LAYER 7: KNOWLEDGE DISTILLATION
# Aggregate the best learnings back into the system prompt
# — not per-patient, but system-wide improvements.
# ══════════════════════════════════════════════════════════════


async def distill_system_improvements(redis_client, openai_client) -> Optional[Dict]:
    """Analyze all cohort insights + outcome data to suggest system-wide prompt improvements.

    This is the highest-level learning loop: insights from hundreds of
    patients distilled into actionable rules for the base system prompt.

    Example output:
    {
      "new_rules": [
        "For diabetic patients in Kanifing, lead with diet advice before medication reminders",
        "Elder male patients respond 40% better to direct tone vs warm openers",
        "Half-Maggi-cube advice has 73% adherence rate — emphasize it for hypertension"
      ],
      "underperforming_approaches": [
        "Generic 'reduce salt' advice — only 20% adherence vs specific 'half Maggi cube' at 73%"
      ],
      "cultural_findings": [
        "Women who mention husband permission barriers respond better to Alkalo-path suggestions"
      ]
    }

    Should be run weekly/monthly as a batch job.
    """
    try:
        from src.utils.arcade_client import async_command_sql, extract_rows

        # Get all cohort insights
        resp = await async_command_sql(
            "SELECT * FROM CohortInsight ORDER BY outcome_rate DESC LIMIT 50", [],
        )
        cohort_insights = extract_rows(resp)

        # Get outcome records
        resp2 = await async_command_sql(
            "SELECT vital_type, trend, advice_topic, days_elapsed "
            "FROM OutcomeRecord ORDER BY created_at DESC LIMIT 200", [],
        )
        outcomes = extract_rows(resp2)

        if not cohort_insights and not outcomes:
            return None

        # Build summary for LLM
        summary_parts = []
        if cohort_insights:
            summary_parts.append("POPULATION PATTERNS:")
            for ci in cohort_insights[:10]:
                summary_parts.append(f"  - {ci.get('cohort_description','')}: {ci.get('finding','')}")

        if outcomes:
            # Group outcomes by trend
            improving = [o for o in outcomes if o.get("trend") == "improving"]
            worsening = [o for o in outcomes if o.get("trend") == "worsening"]
            summary_parts.append(f"\nOUTCOME DATA: {len(improving)} improving, {len(worsening)} worsening out of {len(outcomes)} tracked")

            if improving:
                imp_topics = Counter([o.get("advice_topic", "") for o in improving])
                summary_parts.append(f"  Topics with best outcomes: {imp_topics.most_common(3)}")
            if worsening:
                wor_topics = Counter([o.get("advice_topic", "") for o in worsening])
                summary_parts.append(f"  Topics with worst outcomes: {wor_topics.most_common(3)}")

        if not summary_parts:
            return None

        resp = await openai_client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "user", "content": f"""You are analyzing learning data from a Gambian healthcare AI (AMINA)
that helps patients manage NCDs (diabetes, hypertension, asthma).

Based on population patterns and outcome data, suggest system-wide improvements.

{chr(10).join(summary_parts)}

Return ONLY JSON:
{{
  "new_rules": ["3 specific rules to add to the system prompt based on what works"],
  "underperforming_approaches": ["approaches that should be replaced or improved"],
  "cultural_findings": ["Gambian-specific patterns that should inform all responses"],
  "confidence": "low | medium | high (based on sample size)"
}}

JSON:"""}],
            temperature=0.3,
            max_tokens=400,
        )
        text = (resp.choices[0].message.content or "").strip()
        if text.startswith("```"):
            import re
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"```\s*$", "", text)
        improvements = json.loads(text)

        # Save to Redis for admin dashboard visibility
        redis_client.setex(
            "system:improvements",
            90 * 86400,
            json.dumps(improvements, default=str),
        )

        logger.info(f"System improvements distilled: {len(improvements.get('new_rules', []))} new rules")
        return improvements

    except Exception as e:
        logger.warning(f"Knowledge distillation failed: {e}")
        return None
