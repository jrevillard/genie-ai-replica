"""
AMINA Care — RAG Pipeline Tuner v2
====================================
Additive module that patches the live RAG pipeline with clinical-grade
retrieval improvements:

  1. Grounded prompt  — forces LLM to cite retrieved context
  2. Score threshold   — filters low-cosine docs before ranking
  3. Hybrid search     — weighted RRF merge (vector vs keyword)
  4. Top-k boost       — wider retrieval, tighter re-ranking
  5. Query-adaptive    — profiles tune retrieval per query type

Applied at startup via monkey-patch. Zero data changes required.

Mount: imported from main_with_rag_tuning.py
"""
from __future__ import annotations

import logging
import os
import re
from contextvars import ContextVar
from typing import Dict, List, Optional

from haystack import Document

_log = logging.getLogger("rag_tuner")

# ── Clinical-optimized defaults (env-overridable) ────────────────────────────

VECTOR_TOP_K      = int(os.getenv("RAG_VECTOR_TOP_K", "10"))
KEYWORD_TOP_K     = int(os.getenv("RAG_KEYWORD_TOP_K", "8"))
RANKER_TOP_K      = int(os.getenv("RAG_RANKER_TOP_K", "3"))
SCORE_THRESHOLD   = float(os.getenv("RAG_SCORE_THRESHOLD", "0.45"))
VECTOR_WEIGHT     = float(os.getenv("RAG_VECTOR_WEIGHT", "0.55"))
KEYWORD_WEIGHT    = float(os.getenv("RAG_KEYWORD_WEIGHT", "0.45"))


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1: Query-Adaptive RAG Profiles
# ═══════════════════════════════════════════════════════════════════════════════

RAG_PROFILES: Dict[str, Dict] = {
    "emergency": {
        "vector_top_k": 15,
        "keyword_top_k": 15,
        "ranker_top_k": 5,
        "score_threshold": 0.30,
        "vector_weight": 0.5,
        "keyword_weight": 0.5,
    },
    "clinical_specific": {
        "vector_top_k": 8,
        "keyword_top_k": 10,
        "ranker_top_k": 3,
        "score_threshold": 0.50,
        "vector_weight": 0.45,
        "keyword_weight": 0.55,
    },
    "diet_lifestyle": {
        "vector_top_k": 10,
        "keyword_top_k": 6,
        "ranker_top_k": 3,
        "score_threshold": 0.40,
        "vector_weight": 0.65,
        "keyword_weight": 0.35,
    },
    "ramadan_cultural": {
        "vector_top_k": 8,
        "keyword_top_k": 8,
        "ranker_top_k": 3,
        "score_threshold": 0.45,
        "vector_weight": 0.5,
        "keyword_weight": 0.5,
    },
    "medication_info": {
        "vector_top_k": 6,
        "keyword_top_k": 12,
        "ranker_top_k": 3,
        "score_threshold": 0.50,
        "vector_weight": 0.35,
        "keyword_weight": 0.65,
    },
    "default": {
        "vector_top_k": VECTOR_TOP_K,
        "keyword_top_k": KEYWORD_TOP_K,
        "ranker_top_k": RANKER_TOP_K,
        "score_threshold": SCORE_THRESHOLD,
        "vector_weight": VECTOR_WEIGHT,
        "keyword_weight": KEYWORD_WEIGHT,
    },
}

_current_profile: ContextVar[str] = ContextVar("rag_profile", default="default")

# ── Query classification patterns ──────────────────────────────────────────

_EMERGENCY_CUES = [
    "chest pain", "can't breathe", "cant breathe", "difficulty breathing",
    "severe bleeding", "unconscious", "seizure", "convulsion",
    "suicide", "kill myself", "want to die", "overdose",
    "heart attack", "stroke", "collapsed", "choking",
    "snake bite", "severe burn", "poisoning",
]

_MEDICATION_CUES = [
    "amlodipine", "metformin", "enalapril", "glibenclamide", "atenolol",
    "hydrochlorothiazide", "aspirin", "insulin", "losartan", "nifedipine",
    "medication", "medicine", "drug", "pill", "dose", "dosage",
    "side effect", "stopped taking", "ran out of", "pharmacy",
    "prescription", "refill", "taking my",
]

_CLINICAL_CUES = [
    "hba1c", "a1c", "blood sugar", "blood pressure", "bp ",
    "my bp", "my sugar", "sugar was", "sugar is", "sugar level",
    "fasting glucose", "postprandial", "systolic", "diastolic",
    "140/90", "130/80", "120/80", "180/", "/110", "/90",
    "mmol", "mg/dl",
    "bmi", "body mass", "cholesterol", "ldl", "hdl", "triglyceride",
    "screening", "diagnosis", "treatment protocol", "who pen",
    "complication", "retinopathy", "neuropathy", "nephropathy",
    "foot exam", "eye exam", "kidney function", "creatinine",
    "target bp", "bp target", "target blood",
]

_RAMADAN_CUES = [
    "ramadan", "suhoor", "sehri", "iftar",
    "fast during", "break my fast", "fasting month",
    "fasting for ramadan", "fasting during",
    "can i fast", "should i fast",
    "tarawih", "eid", "koriteh",
]

_DIET_CUES = [
    "eat", "food", "diet", "meal", "cook", "recipe",
    "benachin", "domoda", "supakanja", "moringa", "millet",
    "chere", "baobab", "tapalapa", "groundnut", "palm oil",
    "breakfast", "lunch", "dinner", "snack",
    "exercise", "walk", "physical activity", "weight loss",
    "sugar in", "salt in", "oil", "fried",
    "portion", "how much should i eat",
]


def classify_rag_profile(query: str) -> str:
    q = query.lower().strip()

    if any(cue in q for cue in _EMERGENCY_CUES):
        return "emergency"

    if any(cue in q for cue in _MEDICATION_CUES):
        return "medication_info"

    # Ramadan and diet checked before clinical because those queries
    # often contain clinical terms ("blood pressure", "sugar") but the
    # user intent is dietary/cultural, not clinical protocol lookup.
    if any(cue in q for cue in _RAMADAN_CUES):
        return "ramadan_cultural"

    if any(cue in q for cue in _DIET_CUES):
        return "diet_lifestyle"

    if any(cue in q for cue in _CLINICAL_CUES):
        return "clinical_specific"

    return "default"


def get_active_profile() -> Dict:
    name = _current_profile.get()
    return RAG_PROFILES.get(name, RAG_PROFILES["default"])


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2: Grounded Prompt Templates
# ═══════════════════════════════════════════════════════════════════════════════

GROUNDED_ASSISTANT_TEMPLATE = """You are Amina, a trained health advisor specializing in Non-Communicable Diseases for communities in The Gambia.

Your tone:
- Professional but warm. Like a community health worker who knows her field and genuinely cares.
- Clear and informative without being cold or robotic.
- Use "you" and "your" to keep it personal. Use simple language anyone can understand.
- Be direct. Give the key information first, then explain if needed.
- When relevant, mention Gambian foods and local context naturally (domoda, benachin, millet, moringa, Maggi cubes).

How to structure responses:
- For simple questions: 2-4 clear sentences. Inform, then suggest an action.
- For plans or detailed advice: Organize into short paragraphs with plain labels like "First week:", "Morning routine:", "What to eat:". No bullets, no numbered lists.
- For follow-ups: Reference what the user already told you. Build on the conversation.
- End with a brief follow-up question when appropriate.

Formatting rules:
- Never use asterisks, bold markers, hashtags, or symbols like * ** # ## ### > or backticks.
- Never use bullet points (no dashes, dots, or numbered lists at the start of lines).
- Use plain text paragraphs with labels where needed. Line breaks between sections.
- Write in a way that sounds natural when read aloud by a text-to-speech system.

CRITICAL GROUNDING RULES:
- You MUST base your answer on the Retrieved Health Context below.
- If the context contains relevant information, use it directly. Say things like "Based on the health guidelines..." or "According to the protocols..."
- If the context partially covers the question, use what is relevant and clearly state what is general knowledge vs what comes from the guidelines.
- If the context does NOT cover the question at all, say "I don't have specific guidelines on this, but based on general health knowledge..." and keep the answer brief.
- NEVER invent clinical numbers, dosages, or treatment protocols that are not in the context.
- For emergencies, immediately direct to the nearest health facility or emergency services.

Medical rules:
- Never diagnose. Say "this could indicate" or "it would be worth checking with your doctor."
- Never prescribe medication or suggest specific dosages.
- For emergencies, immediately direct to the nearest health facility or call 199.

==========================================
User Profile:
- Age: {{ user_age | default('unknown') }}
- Gender: {{ user_gender | default('unknown') }}

Retrieved Health Context:
{% for doc in documents %}
[Source {{ loop.index }}: {{ doc.meta.title | default('Health Knowledge Base') }}]
{{ doc.content }}
{% endfor %}

{% if not documents %}
No specific health context was found for this question.
{% endif %}

Message history:
{% for msg in history %}
[{{ msg.role.upper() }}]: {{ msg.content }}
{% endfor %}
==========================================
"""

GROUNDED_TRIAGE_TEMPLATE = """You are Amina, a trained health advisor handling an urgent situation.

Your tone:
- Calm, clear, and reassuring. Professional but not cold.
- Acknowledge the person's concern first, then give instructions.

How to respond:
- Start by validating what they are experiencing. One sentence.
- Give the most important action clearly: seek medical help, call emergency services, or go to the nearest health facility.
- If there is a safe immediate step they can take while waiting, explain it simply.
- Reassure them briefly. End with something like "Please do not delay getting help."
- Keep it to 3-5 sentences total. This is urgent, not a lecture.

CRITICAL GROUNDING RULES:
- Use the Retrieved Context below to inform your emergency guidance.
- If context contains relevant emergency protocols, follow them exactly.
- NEVER invent specific medication dosages or clinical thresholds not in the context.
- Always err on the side of directing to professional medical help.

Formatting rules:
- Never use asterisks, bold markers, hashtags, bullet points, numbered lists, or any formatting symbols.
- Plain conversational sentences only.

Medical rules:
- Never diagnose. Say "this could be serious" not "you are having a heart attack."
- Always direct them toward professional help.

==========================================
User Profile:
Age: {{ user_age | default('unknown') }}
Gender: {{ user_gender | default('unknown') }}

Retrieved Context:
{% for doc in documents %}
[Source {{ loop.index }}: {{ doc.meta.title | default('Health Knowledge Base') }}]
{{ doc.content }}
{% endfor %}

{% if not documents %}
No specific context found — using general emergency guidance.
{% endif %}

Message history:
{% for msg in history %}[{{ msg.role.upper() }}] {{ msg.content }}
{% endfor %}
==========================================
"""


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3: Score-Filtered Document Joiner with Weighted RRF
# ═══════════════════════════════════════════════════════════════════════════════

def weighted_rrf_merge(
    vector_docs: List[Document],
    keyword_docs: List[Document],
    vector_weight: Optional[float] = None,
    keyword_weight: Optional[float] = None,
    k: int = 60,
    score_threshold: Optional[float] = None,
) -> List[Document]:
    """
    Weighted Reciprocal Rank Fusion with query-adaptive profile support.
    Reads the active RAG profile for defaults when explicit args are None.
    """
    profile = get_active_profile()
    vw = vector_weight if vector_weight is not None else profile["vector_weight"]
    kw = keyword_weight if keyword_weight is not None else profile["keyword_weight"]
    st = score_threshold if score_threshold is not None else profile["score_threshold"]

    filtered_vector = []
    for doc in vector_docs:
        cosine_score = doc.meta.get("score", 0) if doc.meta else 0
        if cosine_score and cosine_score >= st:
            filtered_vector.append(doc)

    _log.debug(
        "Vector docs: %d total, %d after threshold %.2f (profile=%s)",
        len(vector_docs), len(filtered_vector), st, _current_profile.get(),
    )

    rrf_scores: Dict[str, float] = {}
    doc_map: Dict[str, Document] = {}

    for rank, doc in enumerate(filtered_vector):
        doc_id = doc.id or doc.content[:80]
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + vw / (k + rank + 1)
        doc_map[doc_id] = doc

    for rank, doc in enumerate(keyword_docs):
        doc_id = doc.id or doc.content[:80]
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + kw / (k + rank + 1)
        if doc_id not in doc_map:
            doc_map[doc_id] = doc

    sorted_ids = sorted(rrf_scores, key=rrf_scores.get, reverse=True)

    merged = []
    for doc_id in sorted_ids:
        doc = doc_map[doc_id]
        doc.meta = doc.meta or {}
        doc.meta["rrf_score"] = rrf_scores[doc_id]
        merged.append(doc)

    return merged


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4: Re-Ranker Query Augmentation
# ═══════════════════════════════════════════════════════════════════════════════

_RERANK_PREFIXES = {
    "emergency": "Emergency medical response for: ",
    "clinical_specific": "Clinical treatment guideline for: ",
    "medication_info": "Medication information and protocol for: ",
    "diet_lifestyle": "Dietary and lifestyle guidance for: ",
    "ramadan_cultural": "Ramadan fasting health management for: ",
}


def augment_query_for_reranking(query: str) -> str:
    profile_name = _current_profile.get()
    prefix = _RERANK_PREFIXES.get(profile_name, "")
    return prefix + query


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5: Apply all patches to live pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def apply_rag_tuning():
    """
    Patch the live chat pipeline with clinical-grade RAG improvements.
    Called once at startup. Idempotent.
    """
    try:
        from src.pipelines.chat import chat_pipeline
    except ImportError:
        _log.warning("chat_pipeline not available — RAG tuning skipped")
        return False

    patched = False

    # ── 1. Patch keyword_retriever to classify query and set profile ────
    try:
        kr = chat_pipeline.get_component("keyword_retriever")
        _original_kr_run = kr.run

        def _patched_kr_run(**kwargs):
            query = kwargs.get("query", "")
            if query:
                profile_name = classify_rag_profile(query)
                _current_profile.set(profile_name)
                profile = RAG_PROFILES[profile_name]
                kwargs["top_k"] = profile["keyword_top_k"]
                _log.debug("RAG profile: %s (keyword_top_k=%d)", profile_name, profile["keyword_top_k"])
            return _original_kr_run(**kwargs)

        kr.run = _patched_kr_run
        _log.info("Keyword retriever patched with adaptive profile selection")
        patched = True
    except Exception as e:
        _log.warning("Keyword retriever patch failed: %s", e)

    # ── 2. Patch vector_retriever to use active profile top_k ───────────
    try:
        vr = chat_pipeline.get_component("vector_retriever")
        _original_vr_run = vr.run

        def _patched_vr_run(**kwargs):
            profile = get_active_profile()
            kwargs["top_k"] = profile["vector_top_k"]
            return _original_vr_run(**kwargs)

        vr.run = _patched_vr_run
        _log.info("Vector retriever patched with adaptive top_k")
        patched = True
    except Exception as e:
        _log.warning("Vector retriever patch failed: %s", e)

    # ── 3. Patch DocumentJoiner with weighted RRF ───────────────────────
    try:
        joiner = chat_pipeline.get_component("joiner")
        _original_joiner_run = joiner.run

        def _patched_joiner_run(**kwargs):
            doc_lists = kwargs.get("documents", [])
            if not doc_lists:
                return {"documents": []}

            if len(doc_lists) >= 2:
                vector_docs = doc_lists[0] if doc_lists[0] else []
                keyword_docs = doc_lists[1] if doc_lists[1] else []
                merged = weighted_rrf_merge(vector_docs, keyword_docs)
                _log.debug("Weighted RRF: %d vector + %d keyword → %d merged",
                           len(vector_docs), len(keyword_docs), len(merged))
                return {"documents": merged}

            return _original_joiner_run(**kwargs)

        joiner.run = _patched_joiner_run
        _log.info("DocumentJoiner patched with weighted RRF (adaptive profiles)")
        patched = True
    except Exception as e:
        _log.warning("DocumentJoiner patch failed: %s", e)

    # ── 4. Patch ranker with adaptive top_k + query augmentation ────────
    #       + clinical re-ranker model swap via reranker_registry
    try:
        ranker = chat_pipeline.get_component("ranker")

        # Hot-swap model if RAG_RERANKER_MODEL is set to a non-default value
        try:
            from src.services.reranker_registry import (
                get_active_model_key, get_active_model_id,
            )
            active_key = get_active_model_key()
            if active_key != "ms-marco-mini":
                new_model_id = get_active_model_id()
                ranker.model = new_model_id
                _log.info("Re-ranker model swapped to: %s (%s)",
                          active_key, new_model_id)
                try:
                    ranker.warm_up()
                    _log.info("Re-ranker warm-up complete")
                except Exception as wu_err:
                    _log.warning("Re-ranker warm-up failed: %s", wu_err)
            else:
                _log.info("Re-ranker: keeping default ms-marco-mini")
        except ImportError:
            _log.debug("reranker_registry not available, keeping default model")

        _original_ranker_run = ranker.run

        def _patched_ranker_run(**kwargs):
            profile = get_active_profile()
            kwargs["top_k"] = profile["ranker_top_k"]
            query = kwargs.get("query", "")
            if query:
                kwargs["query"] = augment_query_for_reranking(query)
            return _original_ranker_run(**kwargs)

        ranker.run = _patched_ranker_run
        _log.info("Ranker patched with adaptive top_k + query augmentation")
        patched = True
    except Exception as e:
        _log.warning("Ranker patch failed: %s", e)

    # ── 5. Patch prompt templates with grounded versions ────────────────
    try:
        from haystack.dataclasses import ChatMessage

        grounded_assistant_msgs = [
            ChatMessage.from_system(GROUNDED_ASSISTANT_TEMPLATE),
            ChatMessage.from_user("Question: {{ query }}\n"),
        ]
        grounded_triage_msgs = [
            ChatMessage.from_system(GROUNDED_TRIAGE_TEMPLATE),
            ChatMessage.from_user("Question: {{ query }}\n"),
        ]

        builder_assistant = chat_pipeline.get_component("prompt_builder_assistant")
        builder_assistant.template = grounded_assistant_msgs
        _log.info("Prompt template patched: assistant (grounded)")

        builder_triage = chat_pipeline.get_component("prompt_builder_triage")
        builder_triage.template = grounded_triage_msgs
        _log.info("Prompt template patched: triage (grounded)")

        patched = True
    except Exception as e:
        _log.warning("Prompt template patch failed: %s", e)

    if patched:
        _log.info("RAG tuning v2 applied (adaptive profiles + grounded prompts)")
    return patched


_applied = apply_rag_tuning()
