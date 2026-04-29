"""
AMINA Agent Platform v1 — runtime entrypoint.

Single public method:
    await runtime.maybe_run_agentic_prepass(request) -> AgenticPrepassResult

Runtime modes:
    OFF     -> returns AgenticPrepassResult(enabled=False)
    SHADOW  -> planner + policy run; trace recorded; original response unchanged
    ASSIST  -> planner + policy + executor run; context_block populated
    STRICT  -> v1 placeholder; behaves like assist with NO writes (which v1
              already enforces via V1_ALLOWED_RISKS)

On ANY exception:
    if AMINA_AGENTIC_FAIL_OPEN=true -> return enabled=False with error
    else                           -> raise
"""
from __future__ import annotations

import logging
import time
from typing import List

# Read config attributes lazily off the module so test-time mutation
# (`config.AMINA_AGENTIC_MODE = ...`) is observed by the runtime.
from src.agent_platform import config as _ap_config
from src.agent_platform.config import AgentMode
from src.agent_platform.models import (
    AgenticPlan,
    AgenticPrepassResult,
    AgenticRequest,
    AgenticToolCall,
    AgentTrace,
    PolicyDecision,
    ToolResult,
)
from src.agent_platform.planner import plan as planner_plan
from src.agent_platform.tool_executor import get_executor
from src.agent_platform.tool_policy import get_policy_gate
from src.agent_platform.tool_registry import get_registry
from src.agent_platform.tracing import emit as trace_emit
from src.agent_platform.tracing import hash_id

logger = logging.getLogger("agent_platform.runtime")


class AgentPlatformRuntime:
    def __init__(self):
        self._registry = get_registry()
        self._policy   = get_policy_gate()
        self._executor = get_executor()

    async def maybe_run_agentic_prepass(
        self, request: AgenticRequest,
    ) -> AgenticPrepassResult:
        mode = _ap_config.AMINA_AGENTIC_MODE
        if mode == AgentMode.OFF:
            return AgenticPrepassResult(enabled=False, mode="off")

        # Hard mode-allow gate — even if AMINA_AGENTIC_MODE=assist, only
        # allow it for Advanced (or whatever the operator listed).
        # Recommended staged rollout starts with modes_allowed=advanced.
        req_mode = (request.mode or "").lower()
        modes_allowed = _ap_config.AMINA_AGENTIC_MODES_ALLOWED
        if req_mode and modes_allowed and req_mode not in modes_allowed:
            return AgenticPrepassResult(enabled=False, mode=mode.value,
                                         error="mode_not_allowed_by_config")

        try:
            return await self._run(request, mode)
        except Exception as e:
            logger.exception("[runtime] uncaught: %s", e)
            if _ap_config.AMINA_AGENTIC_FAIL_OPEN:
                return AgenticPrepassResult(enabled=False, mode=mode.value,
                                             error=f"runtime_error:{e.__class__.__name__}")
            raise

    # ────────────────────────────────────────────────────────────
    async def _run(
        self, request: AgenticRequest, mode: AgentMode,
    ) -> AgenticPrepassResult:
        started = time.perf_counter()
        trace = AgentTrace(
            session_hash=hash_id(request.session_id),
            mode=request.mode or "",
            agentic_mode=mode.value,
            channel=request.channel or "",
            domain_hint=request.domain_hint or "",
        )
        # Phase-3: snapshot config-time intent into the trace so an
        # operator reading a single trace line can answer "was native
        # tools meant to be on for this turn?" without re-checking env.
        trace.native_tools_enabled    = bool(_ap_config.AMINA_AGENTIC_NATIVE_TOOLS)
        trace.native_format_requested = _ap_config.AMINA_AGENTIC_NATIVE_FORMAT or ""

        # 1. Plan
        schemas = self._registry.get_schemas_for_llm(
            mode=request.mode or "basic",
            role=request.role or "patient",
        )
        trace.tool_schema_count = len(schemas)
        plan: AgenticPlan = await planner_plan(request, schemas)
        trace.planner_used = True
        trace.plan_intent  = plan.intent
        # Phase-3: classify the planner path based on the resulting
        # plan's reason string. The planner sets these reason strings
        # as a contract; runtime maps them to a stable label.
        reason = (plan.reason or "").lower()
        if reason.startswith("heuristic"):
            trace.planner_path = "heuristic"
        elif reason.startswith("native_"):
            trace.planner_path = "json_native"
            trace.native_attempted = True
            # native_<fmt>_tool_call -> capture detected fmt
            try:
                trace.native_format_detected = reason.split("_")[1]
            except Exception:
                trace.native_format_detected = ""
        elif reason in ("llm_planner", "invalid_planner_output"):
            trace.planner_path = "json_string"
        elif reason == "no_heuristic_no_llm":
            trace.planner_path = "fallback"
        else:
            trace.planner_path = "unknown"
        trace.tool_call_count_requested = len(plan.tool_calls)

        # Emergency bypass: don't run any tools — original handler owns it.
        if plan.route == "emergency_bypass":
            trace.safety_flags.append("emergency_bypass")
            trace.latency_ms = (time.perf_counter() - started) * 1000.0
            trace_emit(trace)
            return AgenticPrepassResult(
                enabled=True, mode=mode.value, trace_id=trace.trace_id, plan=plan,
            )

        # 2. Policy gate
        decisions: List[PolicyDecision] = self._policy.evaluate_plan(
            request, plan.tool_calls,
        )
        trace.tool_decisions = [
            {"tool_name": d.tool_name, "allowed": d.allowed, "reason": d.reason,
             "risk": d.risk}
            for d in decisions
        ]

        approved_pairs: List[tuple] = []
        denied: List[PolicyDecision] = []
        for call, decision in zip(plan.tool_calls, decisions):
            if decision.allowed:
                approved_pairs.append((call, decision))
            else:
                denied.append(decision)
        # Phase-3: surface allowed/denied counts + machine-readable
        # deny reasons (not human-readable text; the existing reason
        # field is already a stable token like "auth_required").
        trace.tool_call_count_allowed = len(approved_pairs)
        trace.tool_call_count_denied  = len(denied)
        trace.denied_reasons          = [d.reason for d in denied if d.reason]

        # 3. Execution decision
        results: List[ToolResult] = []
        if mode == AgentMode.SHADOW:
            # Don't execute. Trace decisions only.
            trace.tool_results = []
        else:
            # ASSIST / STRICT — execute approved (read-only by registry)
            results = await self._executor.execute_approved(request, approved_pairs)
            trace.tool_results = [
                {"tool_name": r.tool_name, "ok": r.ok,
                 "latency_ms": r.latency_ms, "error_code": r.error_code}
                for r in results
            ]

        # 4. Build context block (only for assist/strict, only if any ok results)
        context_block = ""
        if mode in (AgentMode.ASSIST, AgentMode.STRICT) and results:
            ok_results = [r for r in results if r.ok and r.safe_summary]
            if ok_results:
                lines = ["[AMINA_AGENTIC_CONTEXT]"]
                for r in ok_results:
                    lines.append(f"- source: {r.tool_name}")
                    lines.append(f"  summary: {r.safe_summary[:240]}")
                lines.append("[/AMINA_AGENTIC_CONTEXT]")
                context_block = "\n".join(lines)

        trace.latency_ms = (time.perf_counter() - started) * 1000.0
        trace_emit(trace)

        return AgenticPrepassResult(
            enabled=True,
            mode=mode.value,
            trace_id=trace.trace_id,
            plan=plan,
            approved_tool_results=results,
            denied_tool_calls=denied,
            context_block=context_block,
        )


# Singleton
_RUNTIME = AgentPlatformRuntime()


def get_runtime() -> AgentPlatformRuntime:
    return _RUNTIME
