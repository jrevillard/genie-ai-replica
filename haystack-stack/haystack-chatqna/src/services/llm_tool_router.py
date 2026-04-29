"""
LLM Tool Router — Transformation 2.

Replaces keyword-only tool routing with an LLM-based router for messages
where keyword matching is ambiguous or misses context. The keyword
fast-path from TOOL_ROUTES still handles the ~60% of messages with
clear keyword signals. For the rest, a small fast LLM call decides
which tools to invoke, with optional multi-step agentic loop.

Gate: settings.USE_LLM_TOOL_ROUTER (default false).
When false, tool routing is pure keyword-match (existing _route_tools).

Architecture:
  1. Keyword fast-path tries first (same TOOL_ROUTES as today)
  2. If confident match → use it (no LLM call)
  3. If no match OR message is complex → LLM router decides
  4. LLM router can request sequential execution (agentic loop)
  5. Max 3 tools per round, max 2 agentic rounds
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from src.config import settings

logger = logging.getLogger(__name__)

_ENABLED = settings.USE_LLM_TOOL_ROUTER


# ── Tool catalog for the LLM router ─────────────────────────────────────
# Compact descriptions the router LLM can reason over.

TOOL_CATALOG = """Available tools (pick 1-3, or "none"):
- record_vitals: Record a blood pressure or glucose reading the user just shared. Use when user gives a number like "140/90" or "sugar was 180".
- manage_diabetes: Get diabetes management guidance (WHO PEN protocol). Use for diabetes questions, glucose concerns, metformin, insulin, HbA1c.
- manage_hypertension: Get hypertension management guidance (WHO PEN protocol). Use for blood pressure concerns, amlodipine, salt reduction.
- assess_respiratory: Assess asthma or COPD. Use for wheezing, inhaler questions, breathing difficulty, chronic cough.
- screen_cancer: Cancer screening guidance. Use for lumps, abnormal bleeding, non-healing wounds, cervical screening.
- get_medication_info: Look up medication details (side effects, interactions, timing). Use when user mentions a specific drug or says "doctor gave me pills".
- get_diet_advice: Culturally appropriate dietary advice for Gambian patients. Use for food, nutrition, or diet questions.
- find_facility: Find nearest health facility. Use when user needs a clinic, hospital, or referral.
- generate_care_plan: Create a structured care plan. Use when user asks for their plan or treatment plan.
- check_ramadan: Ramadan-specific medication and fasting guidance. Use when user mentions Ramadan, fasting, suhoor, iftar.
- assess_cvd_risk: Cardiovascular risk assessment (WHO/ISH charts). Use for heart attack risk, stroke risk questions.
- counsel_lifestyle: Lifestyle counseling (smoking cessation, exercise, weight). Use for quit smoking, tobacco, exercise questions.
- get_lifestyle_nudge: Daily lifestyle tip or nudge. Use when user asks for daily tips or "what should I do today".
- assess_triage: Triage symptoms to determine urgency level. Use when user describes pain, symptoms, or feeling unwell.
- suggest_community_support: Suggest community support paths (CHW, Alkallo, elder). Use when user faces barriers: fear, shame, cost, permission, family resistance.
- search_knowledge: Search WHO/health knowledge base for evidence. Use when health tools fire for supplementary evidence, or when no specific tool matches a health question."""


# ── Confidence heuristic for keyword matches ─────────────────────────────

def _keyword_confidence(message: str, matched_tools: List[str]) -> str:
    """Decide if keyword matches are confident enough to skip the LLM router.
    Returns 'high', 'medium', or 'low'."""
    msg = message.lower()
    word_count = len(msg.split())

    # Affirmatives — always high confidence (no tools)
    if msg.strip() in {
        "yes", "yeah", "yea", "yep", "ok", "okay", "sure", "alright",
        "right", "hmm", "mhm", "true", "correct", "fine", "good",
        "no", "nah", "nope", "not really",
    }:
        return "high"

    # Chitchat — always high confidence (no tools or search_knowledge only)
    if any(g in msg for g in [
        "hi", "hello", "hey", "good morning", "good afternoon",
        "good evening", "thanks", "thank you", "bye", "how are you",
    ]):
        return "high"

    if not matched_tools:
        if word_count <= 4:
            return "high"  # Short non-health message, no tools is correct
        return "low"  # Longer message with no match — LLM should decide

    # Single clear match on short message — high confidence
    if len(matched_tools) == 1 and word_count <= 8:
        return "high"

    # Multiple tools matched — the message is complex, LLM should reason
    if len(matched_tools) >= 3:
        return "low"

    # Long message with tool match — medium (keyword may have caught
    # a word out of context)
    if word_count > 15:
        return "medium"

    # Pronouns suggesting third-party context that keywords miss
    third_party_cues = ["my mother", "my father", "my child", "my husband",
                        "my wife", "my grandmother", "my son", "my daughter",
                        "she ", "he ", "her ", "him ", "they "]
    if any(cue in msg for cue in third_party_cues):
        return "medium"

    return "high"


# ── LLM router prompt ───────────────────────────────────────────────────

_ROUTER_PROMPT = """You are a tool router for AMINA, a Gambian healthcare agent. Your job is to decide which tools to call for a patient message.

{tool_catalog}

PATIENT MESSAGE: "{message}"

PATIENT CONTEXT:
- Name: {patient_name}
- Conditions: {conditions}
- Medications: {medications}

{dialogue_state_section}

KEYWORD SUGGESTIONS (from fast-path, may be wrong): {keyword_suggestions}

ROUTING RULES:
1. Pick 1-3 tools that are relevant. If none are relevant, return "none".
2. If the message is chitchat, a greeting, or an affirmative ("yes", "ok") → return "none".
3. If a health tool fires, ALSO include "search_knowledge" for supplementary evidence.
4. If the right answer requires checking one thing before deciding the next step, set requires_sequential=true and explain the dependency in reasoning.
5. Think about WHO the patient is (self vs. carer asking about someone else) — this affects which tools are relevant.
6. Don't over-tool. A simple "how are you" needs zero tools. A complex multi-symptom message might need 2-3.

Return ONLY valid JSON:
{{"tools": ["tool_name_1", "tool_name_2"], "requires_sequential": false, "reasoning": "one sentence why"}}

JSON:"""


# ── Model call ───────────────────────────────────────────────────────────

async def _call_router_model(prompt: str) -> Optional[Dict[str, Any]]:
    """Call a fast model for tool routing. Fallback: Gemini → Groq → GPT-4o-mini."""
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
                max_tokens=200,
            )
            text = (completion.choices[0].message.content or "").strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"```\s*$", "", text)
            result = json.loads(text)
            logger.debug(f"llm_tool_router: routed via {provider}/{model}")
            return result
        except Exception as e:
            logger.warning(f"llm_tool_router: {provider} call failed: {e}")
            continue

    logger.error("llm_tool_router: all model providers failed")
    return None


# ── Public API ───────────────────────────────────────────────────────────

# Valid tool names (used to filter LLM hallucinations)
_VALID_TOOLS = {
    "record_vitals", "manage_diabetes", "manage_hypertension",
    "assess_respiratory", "screen_cancer", "get_medication_info",
    "get_diet_advice", "find_facility", "generate_care_plan",
    "check_ramadan", "assess_cvd_risk", "counsel_lifestyle",
    "get_lifestyle_nudge", "assess_triage", "suggest_community_support",
    "search_knowledge",
}

# Health tools that benefit from supplementary RAG
_HEALTH_TOOLS = {
    "manage_diabetes", "manage_hypertension", "assess_respiratory",
    "screen_cancer", "counsel_lifestyle", "assess_cvd_risk",
    "get_diet_advice", "get_medication_info", "assess_triage",
}


async def route_tools_llm(
    message: str,
    keyword_matches: List[str],
    patient_context: Any,
    dialogue_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """LLM-based tool routing. Returns:
    {
        "tools": ["tool_1", "tool_2"],
        "requires_sequential": False,
        "reasoning": "...",
        "source": "keyword" | "llm" | "llm_fallback_keyword",
    }

    When the flag is off, this function is never called (gate is in
    amina_agent.py). But it also gates internally for safety.
    """
    if not _ENABLED:
        return {
            "tools": keyword_matches[:3],
            "requires_sequential": False,
            "reasoning": "flag off",
            "source": "keyword",
        }

    # Step 1: Check if keyword matches are confident enough
    confidence = _keyword_confidence(message, keyword_matches)

    if confidence == "high":
        logger.debug(f"llm_tool_router: keyword confidence high, using fast-path: {keyword_matches}")
        return {
            "tools": keyword_matches[:3],
            "requires_sequential": False,
            "reasoning": "keyword fast-path (high confidence)",
            "source": "keyword",
        }

    # Step 2: Build LLM prompt
    pc = patient_context
    conditions = ", ".join(pc.conditions) if hasattr(pc, "conditions") and pc.conditions else "none known"
    medications = ", ".join(
        m.get("name", str(m)) if isinstance(m, dict) else str(m)
        for m in (pc.medications or [])
    ) if hasattr(pc, "medications") and pc.medications else "none known"
    patient_name = getattr(pc, "name", "") or "unknown"

    ds_section = ""
    if dialogue_state:
        ds_parts = []
        if dialogue_state.get("active_topic"):
            ds_parts.append(f"Active topic: {dialogue_state['active_topic']}")
        if dialogue_state.get("subject") == "other_person":
            ds_parts.append(f"Subject: {dialogue_state.get('subject_description', 'someone else')}")
        if dialogue_state.get("current_register") and dialogue_state["current_register"] != "calm":
            ds_parts.append(f"Emotional register: {dialogue_state['current_register']}")
        if dialogue_state.get("open_questions"):
            relevant = [q for q in dialogue_state["open_questions"] if q.get("still_relevant")]
            if relevant:
                ds_parts.append(f"Open question from AMINA: {relevant[0].get('question', '')}")
        if ds_parts:
            ds_section = "DIALOGUE STATE:\n" + "\n".join(ds_parts)

    prompt = _ROUTER_PROMPT.format(
        tool_catalog=TOOL_CATALOG,
        message=message[:400],
        patient_name=patient_name,
        conditions=conditions,
        medications=medications,
        dialogue_state_section=ds_section or "DIALOGUE STATE: (not available)",
        keyword_suggestions=", ".join(keyword_matches) if keyword_matches else "none",
    )

    # Step 3: Call LLM
    result = await _call_router_model(prompt)

    if not result or "tools" not in result:
        # LLM failed — fall back to keyword matches
        logger.warning("llm_tool_router: LLM returned no result, falling back to keywords")
        return {
            "tools": keyword_matches[:3],
            "requires_sequential": False,
            "reasoning": "LLM router failed, keyword fallback",
            "source": "llm_fallback_keyword",
        }

    # Step 4: Validate and sanitise LLM output
    raw_tools = result.get("tools", [])

    # Handle "none" string
    if raw_tools == "none" or raw_tools == ["none"]:
        raw_tools = []

    # Filter to valid tool names only (prevent hallucinated tools)
    tools = [t for t in raw_tools if t in _VALID_TOOLS]

    # If health tools selected, ensure search_knowledge is included
    has_health = any(t in _HEALTH_TOOLS for t in tools)
    if has_health and "search_knowledge" not in tools and len(message.split()) > 5:
        tools.append("search_knowledge")

    tools = tools[:3]  # Cap at 3

    requires_sequential = bool(result.get("requires_sequential", False))
    reasoning = result.get("reasoning", "")

    logger.info(
        f"llm_tool_router: {len(tools)} tools via LLM "
        f"(confidence={confidence}, keyword_had={len(keyword_matches)}): "
        f"{tools} seq={requires_sequential}"
    )

    return {
        "tools": tools,
        "requires_sequential": requires_sequential,
        "reasoning": reasoning,
        "source": "llm",
    }


_REROUTE_PROMPT = """You are a tool router for AMINA. After executing a tool, decide if the remaining plan is still correct.

PATIENT MESSAGE: "{message}"
TOOLS ALREADY EXECUTED: {executed}
RESULTS SO FAR:
{observations_text}

REMAINING PLANNED TOOLS: {remaining}

Based on what we learned, should we:
1. CONTINUE with the remaining tools as planned
2. CHANGE the remaining tools (add/remove/reorder)
3. STOP — we have enough information

{tool_catalog}

Return ONLY valid JSON:
{{"action": "continue|change|stop", "tools": ["tool_1"], "reasoning": "one sentence"}}

JSON:"""


async def _reroute_after_observation(
    message: str,
    observations: List[Dict[str, Any]],
    remaining_tools: List[str],
    patient_context: Any,
) -> Optional[List[str]]:
    """Re-evaluate remaining tools based on observations so far.

    Returns:
      - None: continue with existing plan (no change)
      - []: stop, no more tools needed
      - ["tool_a", "tool_b"]: new tool list to execute
    """
    if not observations or not remaining_tools:
        return None

    obs_text = "\n".join(
        f"  {o['tool']}: {str(o.get('result', ''))[:200]}"
        for o in observations
    )
    executed = [o["tool"] for o in observations]

    prompt = _REROUTE_PROMPT.format(
        message=message[:300],
        executed=", ".join(executed),
        observations_text=obs_text,
        remaining=", ".join(remaining_tools),
        tool_catalog=TOOL_CATALOG,
    )

    result = await _call_router_model(prompt)
    if not result:
        return None

    action = result.get("action", "continue")

    if action == "continue":
        return None

    if action == "stop":
        logger.info(f"llm_tool_router: reroute decided to STOP — {result.get('reasoning', '')}")
        return []

    if action == "change":
        new_tools = [t for t in result.get("tools", []) if t in _VALID_TOOLS]
        # Don't re-run tools we already executed
        new_tools = [t for t in new_tools if t not in executed]
        new_tools = new_tools[:3]
        return new_tools

    return None


async def execute_agentic_loop(
    orchestrator,
    tools_to_run: List[str],
    build_params_fn,
    message: str,
    patient_context: Any,
    requires_sequential: bool,
    max_rounds: int = 2,
) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Execute tools, optionally in an agentic loop.

    When requires_sequential is False, all tools run in parallel (same as
    current behavior). When True, tools run one at a time, and after each
    result the router can decide if more tools are needed.

    Returns (tools_used, observations).
    """
    tools_used = []
    observations = []

    if not tools_to_run:
        return tools_used, observations

    if not requires_sequential:
        # Parallel execution — identical to current behavior
        tool_tasks = []
        for tool_name in tools_to_run:
            params = build_params_fn(tool_name, message, patient_context)
            tool_tasks.append(orchestrator.execute_tool(tool_name, **params))

        results = await asyncio.gather(*tool_tasks, return_exceptions=True)
        for tool_name, result in zip(tools_to_run, results):
            tools_used.append(tool_name)
            if isinstance(result, Exception):
                observations.append({"tool": tool_name, "result": f"error: {result}"})
            else:
                observations.append({
                    "tool": tool_name,
                    "result": result.get("result") if result.get("success") else result.get("error"),
                })
        return tools_used, observations

    # Sequential agentic loop
    remaining_tools = list(tools_to_run)
    round_num = 0

    while remaining_tools and round_num < max_rounds:
        round_num += 1
        tool_name = remaining_tools.pop(0)

        params = build_params_fn(tool_name, message, patient_context)
        try:
            result = await orchestrator.execute_tool(tool_name, **params)
            tools_used.append(tool_name)
            obs = {
                "tool": tool_name,
                "result": result.get("result") if result.get("success") else result.get("error"),
            }
            observations.append(obs)
        except Exception as e:
            tools_used.append(tool_name)
            observations.append({"tool": tool_name, "result": f"error: {e}"})

        # After each sequential tool, re-evaluate remaining tools based
        # on what we learned (Gap 4 enhancement: agentic re-routing).
        if remaining_tools:
            rerouted = await _reroute_after_observation(
                message=message,
                observations=observations,
                remaining_tools=remaining_tools,
                patient_context=patient_context,
            )
            if rerouted is not None:
                remaining_tools = rerouted
                logger.info(
                    f"llm_tool_router: re-routed after round {round_num}, "
                    f"new remaining: {remaining_tools}"
                )
            else:
                logger.debug(
                    f"llm_tool_router: agentic round {round_num}, "
                    f"continuing with: {remaining_tools}"
                )

    # Execute any leftover tools in parallel (bounded by max_rounds)
    if remaining_tools:
        tool_tasks = []
        for tool_name in remaining_tools:
            params = build_params_fn(tool_name, message, patient_context)
            tool_tasks.append(orchestrator.execute_tool(tool_name, **params))

        results = await asyncio.gather(*tool_tasks, return_exceptions=True)
        for tool_name, result in zip(remaining_tools, results):
            tools_used.append(tool_name)
            if isinstance(result, Exception):
                observations.append({"tool": tool_name, "result": f"error: {result}"})
            else:
                observations.append({
                    "tool": tool_name,
                    "result": result.get("result") if result.get("success") else result.get("error"),
                })

    return tools_used, observations
