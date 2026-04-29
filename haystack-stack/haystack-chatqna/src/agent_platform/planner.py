"""
AMINA Agent Platform v1 — bounded planner.

The planner produces an AgenticPlan (intent + 0-N tool calls). It does
NOT execute tools — execution is the executor's job, gated by policy.

V1 strategy:
  1. Heuristic FIRST. Always available, deterministic, fast (~µs).
  2. LLM planner ONLY if heuristic returns no match AND we have an LLM
     client. The LLM is asked for strict JSON; bad JSON falls back to
     a no-tool plan with reason="invalid_planner_output".
  3. Hard cap of AMINA_AGENTIC_MAX_TOOL_CALLS regardless of source.

Emergency keywords short-circuit to route="emergency_bypass" with zero
tools — the existing emergency handler in AminaAgent owns that flow.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import List, Optional, Tuple

from src.agent_platform import config as _ap_config
from src.agent_platform.config import PLANNER_HARD_LIMITS
from src.agent_platform.models import (
    AgenticPlan,
    AgenticRequest,
    AgenticToolCall,
)
from src.agent_platform.tool_registry import get_registry

logger = logging.getLogger("agent_platform.planner")

_MAX_CALLS = int(PLANNER_HARD_LIMITS["max_tool_calls_per_turn"])
_PLANNER_TIMEOUT_S = int(PLANNER_HARD_LIMITS["planner_timeout_ms"]) / 1000.0


# ── Heuristic routes (keyword → ordered tool list) ────────────────
_HEURISTIC_ROUTES: List[Tuple[Tuple[str, ...], List[str]]] = [
    (("blood pressure", "my bp", "systolic", "diastolic", "bp reading", "hypertension"),
        ["get_recent_vitals", "retrieve_who_protocol"]),
    (("blood sugar", "my sugar", "glucose", "diabetes", "diabetic", "hba1c"),
        ["get_recent_vitals", "retrieve_who_protocol"]),
    (("medicine", "medication", "metformin", "amlodipine", "drug", "pill", "dose"),
        ["get_medications", "retrieve_ncd_knowledge"]),
    (("care plan", "my plan", "treatment plan"),
        ["get_care_plan"]),
    (("appointment", "follow-up", "follow up", "next visit", "check-up", "check up"),
        ["get_followups"]),
    (("diet", "what should i eat", "food", "benachin", "domoda", "attaya", "cook"),
        ["get_diet_advice", "retrieve_ncd_knowledge"]),
    (("ramadan", "fasting", "suhoor", "iftar"),
        ["check_ramadan", "retrieve_who_protocol"]),
    (("clinic", "hospital", "health centre", "health center", "nearest", "facility"),
        ["find_facility"]),
    (("cvd risk", "heart risk", "cardiovascular risk"),
        ["calculate_cvd_risk", "get_recent_vitals"]),
    (("asthma", "copd", "wheez", "inhaler"),
        ["retrieve_who_protocol"]),
    (("triage", "should i go to clinic", "is this serious"),
        ["assess_triage"]),
]

_EMERGENCY_KEYWORDS = (
    "chest pain", "can't breathe", "cannot breathe", "trouble breathing",
    "stroke", "severe bleeding", "passed out", "unconscious", "seizure",
    "suicide", "kill myself", "want to die",
)


# ── Heuristic planner ─────────────────────────────────────────────
def _heuristic_plan(request: AgenticRequest) -> Optional[AgenticPlan]:
    text = (request.message or "").lower()

    # Emergency short-circuit
    if request.is_emergency or any(k in text for k in _EMERGENCY_KEYWORDS):
        return AgenticPlan(
            intent="emergency",
            confidence=0.99,
            route="emergency_bypass",
            tool_calls=[],
            reason="emergency_keyword_or_flag",
        )

    # Keyword routes
    for keys, tools in _HEURISTIC_ROUTES:
        if any(k in text for k in keys):
            calls = [
                AgenticToolCall(tool_name=t, reason=f"matched_keyword:{keys[0]}")
                for t in tools[:_MAX_CALLS]
            ]
            return AgenticPlan(
                intent="heuristic_match",
                confidence=0.85,
                route="normal",
                tool_calls=calls,
                reason=f"heuristic:{keys[0]}",
            )

    return None


# ── LLM planner (optional) ────────────────────────────────────────
_PLANNER_SYS = """You are a clinical tool planner for AMINA, a Gambian community health assistant.

Given the patient message and a list of tools, choose 0-{max_tools} tool calls
that would help answer. Output STRICT JSON only.

RULES:
- Use ONLY tools listed below.
- Return at most {max_tools} tool calls.
- For greetings / small talk: return zero tools.
- For emergencies: return zero tools (a separate handler takes over).
- For general medical questions answerable from background knowledge: zero tools.
- Tool arguments must NOT include patient_id, phone, conditions, or medications;
  the backend injects those automatically.

Available tools:
{tool_list}

Output schema (JSON only, no prose, no markdown fences):
{{"intent":"<short_label>","tool_calls":[{{"tool":"<name>","arguments":{{}},"reason":"<why>"}}]}}
"""


async def _llm_plan(
    request: AgenticRequest,
    tool_schemas: List[dict],
) -> Optional[AgenticPlan]:
    """
    Optional. Returns None on any failure — caller falls back to
    heuristic-only no-tool plan.
    """
    try:
        from src.agent.amina_agent import get_agent
        agent = get_agent()
    except Exception:
        return None

    client = None
    model = None
    # Prefer Groq (free, fast) for the planner if available.
    for pref in ("groq", "gemini", "base"):
        c = getattr(agent, f"{pref}_client", None) if pref != "base" else getattr(agent, "openai_client", None)
        if c is None:
            continue
        client = c
        model = (
            getattr(agent, f"{pref}_model_name", None)
            if pref != "base" else getattr(agent, "openai_model_name", None)
        )
        break
    if client is None or not model:
        return None

    tool_list_str = "\n".join(
        f"  - {s['name']}: {s['description']}" for s in tool_schemas
    )
    prompt = _PLANNER_SYS.format(max_tools=_MAX_CALLS, tool_list=tool_list_str)

    # ── Phase-2 native function-calling attempt (default OFF) ──────
    # If AMINA_AGENTIC_NATIVE_TOOLS=true AND the active client looks
    # like an OpenAI/Groq/Gemini one, try the provider's native tools
    # API. ANY exception falls through to the existing JSON-string
    # path below. Only V1_ALLOWED_RISKS schemas are exposed (the
    # registry already filtered them upstream).
    if _ap_config.AMINA_AGENTIC_NATIVE_TOOLS:
        native_plan = await _try_native_tool_call(
            client, model, prompt, request, tool_schemas,
        )
        if native_plan is not None:
            return native_plan
        # else fall through to existing JSON-string planner

    try:
        import asyncio
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user",   "content": request.message or ""},
                ],
                temperature=0.0,
                max_tokens=300,
            ),
            timeout=_PLANNER_TIMEOUT_S,
        )
    except Exception as e:
        logger.warning("[planner] LLM planner failed: %s", e.__class__.__name__)
        return None

    try:
        text = (resp.choices[0].message.content or "").strip()
        # Strip markdown code-fence if present
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        data = json.loads(text)
    except Exception:
        logger.warning("[planner] LLM returned invalid JSON")
        return AgenticPlan(
            intent="invalid_planner_output",
            confidence=0.0,
            route="normal",
            tool_calls=[],
            reason="invalid_planner_output",
        )

    # Build the plan, capping at _MAX_CALLS
    raw_calls = data.get("tool_calls") or []
    if not isinstance(raw_calls, list):
        raw_calls = []
    calls: List[AgenticToolCall] = []
    registry = get_registry()
    for raw in raw_calls[:_MAX_CALLS]:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("tool") or "").strip()
        if not name or not registry.has(name):
            continue
        calls.append(AgenticToolCall(
            tool_name=name,
            arguments=raw.get("arguments") or {},
            reason=str(raw.get("reason") or "")[:80],
        ))
    return AgenticPlan(
        intent=str(data.get("intent") or "llm_match")[:32],
        confidence=0.7,
        route="normal",
        tool_calls=calls,
        reason="llm_planner",
    )


# ── Phase-2 native tool-call helper (additive; default disabled) ──
async def _try_native_tool_call(
    client, model, prompt, request: AgenticRequest,
    tool_schemas: List[dict],
) -> Optional[AgenticPlan]:
    """
    Attempt the provider-native tool-calling path. Returns an
    AgenticPlan on success, or None on ANY failure (so the caller
    falls back to the v1 JSON-string parser).

    Notes:
      - We import native_tools lazily to keep the v1 path import-clean
        when AMINA_AGENTIC_NATIVE_TOOLS=false.
      - Schemas passed in are already V1_ALLOWED_RISKS-filtered with
        injected fields stripped (see registry.get_schemas_for_llm).
      - All decisions are STILL re-checked by the policy gate
        downstream — this function only proposes.
    """
    try:
        from src.agent_platform import native_tools as _nt
    except Exception:
        return None

    fmt = _nt.detect_format(client, _ap_config.AMINA_AGENTIC_NATIVE_FORMAT)
    if fmt == _nt.NATIVE_UNSUPPORTED:
        # Distinguish a bad explicit override from an unknown class so
        # operators can tell misconfig from new-provider gaps in trace.
        override = (_ap_config.AMINA_AGENTIC_NATIVE_FORMAT or "").strip().lower()
        if override and override not in ("", "auto", "openai", "gemini"):
            logger.info("[planner] native format override unrecognised: %r", override)
        return None
    payload, kwarg_name = _nt.build_native_tools_payload(tool_schemas, fmt)
    if payload is None or kwarg_name is None:
        return None
    if not payload:
        # Empty payload = registry has no read-only tools for this
        # role/mode. Don't waste a roundtrip; let the v1 path fall
        # through to its no-tool fallback plan.
        return None

    try:
        import asyncio
        # OpenAI-compatible path uses chat.completions.create. Gemini
        # SDK clients also expose a `chat.completions.create`-style
        # surface in newer versions; if a particular Gemini client
        # uses generate_content instead, the call below raises and we
        # fall back. That is by design — we never partial-apply.
        kwargs = {
            "model":       model,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user",   "content": request.message or ""},
            ],
            "temperature": 0.0,
            "max_tokens":  300,
            kwarg_name:    payload,
        }
        # tool_choice="auto" is the default for OpenAI-style and
        # explicitly opts the provider into native function calling.
        if fmt == "openai":
            kwargs["tool_choice"] = "auto"
        resp = await asyncio.wait_for(
            client.chat.completions.create(**kwargs),
            timeout=_PLANNER_TIMEOUT_S,
        )
    except Exception as e:
        logger.warning(
            "[planner] native tool-call failed (fmt=%s, err=%s); falling back",
            fmt, e.__class__.__name__,
        )
        return None

    registry = get_registry()
    calls = _nt.parse_native_tool_calls(
        resp, fmt, registry_has=registry.has, max_calls=_MAX_CALLS,
    )
    return AgenticPlan(
        intent=f"native_{fmt}",
        confidence=0.75,
        route="normal",
        tool_calls=calls,
        reason=f"native_{fmt}_tool_call",
    )


# ── Public planner entrypoint ─────────────────────────────────────
async def plan(
    request: AgenticRequest,
    tool_schemas: List[dict],
) -> AgenticPlan:
    started = time.perf_counter()

    # 1. Heuristic first
    h = _heuristic_plan(request)
    if h is not None:
        h.planner_latency_ms = (time.perf_counter() - started) * 1000.0
        return h

    # 2. LLM optional
    llm = await _llm_plan(request, tool_schemas)
    if llm is not None:
        llm.planner_latency_ms = (time.perf_counter() - started) * 1000.0
        return llm

    # 3. No-tool fallback
    return AgenticPlan(
        intent="no_match",
        confidence=0.0,
        route="normal",
        tool_calls=[],
        reason="no_heuristic_no_llm",
        planner_latency_ms=(time.perf_counter() - started) * 1000.0,
    )
