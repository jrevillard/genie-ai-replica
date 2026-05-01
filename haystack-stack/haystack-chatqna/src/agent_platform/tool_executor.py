"""
AMINA Agent Platform v1 — bounded tool executor.

Runs ONLY policy-approved calls. Per-call timeout enforced. All
exceptions caught and converted to ToolResult(ok=False).

Concurrency: up to 3 approved calls run in parallel via asyncio.gather.

NEVER mutates patient records, NEVER calls external side-effecting
endpoints. The only execution path is via the read-only adapters in
adapters.py.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import List, Tuple

from src.agent_platform.adapters import get_adapter
from src.agent_platform.config import PLANNER_HARD_LIMITS
from src.agent_platform.models import (
    AgenticRequest,
    AgenticToolCall,
    PolicyDecision,
    ToolResult,
)
from src.agent_platform.tool_registry import get_registry

logger = logging.getLogger("agent_platform.executor")


class ToolExecutor:
    def __init__(self):
        self._tool_timeout_ms = int(PLANNER_HARD_LIMITS["tool_timeout_ms"])

    async def execute_approved(
        self,
        request: AgenticRequest,
        approved_pairs: List[Tuple[AgenticToolCall, PolicyDecision]],
    ) -> List[ToolResult]:
        """
        Run every approved (call, decision) in parallel. Decisions whose
        `allowed` is False MUST be filtered before this method is called.
        """
        if not approved_pairs:
            return []
        tasks = [self._run_one(request, c, d) for (c, d) in approved_pairs]
        # BUG-014 fix: return_exceptions=True so one tool's unexpected
        # failure does not nuke the whole batch. _run_one already
        # converts known failure modes (timeout, adapter error) to a
        # ToolResult; this catches anything that escapes that try/except.
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)
        results: List[ToolResult] = []
        for (call, _decision), r in zip(approved_pairs, raw_results):
            if isinstance(r, BaseException):
                logger.exception(
                    "[executor] tool=%s escaped _run_one: %s",
                    call.tool_name, r,
                )
                results.append(ToolResult(
                    call_id=call.call_id,
                    tool_name=call.tool_name,
                    ok=False,
                    error_code="tool_exception",
                    safe_summary=f"Tool {call.tool_name} encountered an error and was skipped.",
                ))
            else:
                results.append(r)
        return results

    async def _run_one(
        self,
        request: AgenticRequest,
        call: AgenticToolCall,
        decision: PolicyDecision,
    ) -> ToolResult:
        started = time.perf_counter()
        if not decision.allowed:
            return ToolResult(
                call_id=call.call_id, tool_name=call.tool_name,
                ok=False, error_code="not_approved",
                safe_summary="not approved by policy",
            )

        registry = get_registry()
        if not registry.has(call.tool_name):
            return ToolResult(
                call_id=call.call_id, tool_name=call.tool_name,
                ok=False, error_code="not_in_registry",
                safe_summary="tool not registered",
            )

        spec = registry.get(call.tool_name)
        adapter = get_adapter(spec.adapter_name)
        if adapter is None:
            return ToolResult(
                call_id=call.call_id, tool_name=call.tool_name,
                ok=False, error_code="not_implemented",
                safe_summary="adapter not implemented yet",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )

        timeout = spec.timeout_ms or self._tool_timeout_ms
        try:
            result = await asyncio.wait_for(
                adapter(decision.redacted_arguments, request),
                timeout=timeout / 1000.0,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "[executor] tool=%s timed out after %dms", call.tool_name, timeout,
            )
            return ToolResult(
                call_id=call.call_id, tool_name=call.tool_name,
                ok=False, error_code="timeout",
                safe_summary="tool timed out",
                latency_ms=timeout,
            )
        except Exception as e:
            logger.exception("[executor] tool=%s raised: %s", call.tool_name, e)
            return ToolResult(
                call_id=call.call_id, tool_name=call.tool_name,
                ok=False, error_code=e.__class__.__name__,
                safe_summary="tool execution failed",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )

        latency = int((time.perf_counter() - started) * 1000)
        return ToolResult(
            call_id=call.call_id,
            tool_name=call.tool_name,
            ok=bool(result.get("ok", False)),
            data=dict(result.get("data") or {}),
            error_code=result.get("error_code"),
            safe_summary=str(result.get("safe_summary", "")),
            latency_ms=latency,
        )


_EXECUTOR = ToolExecutor()


def get_executor() -> ToolExecutor:
    return _EXECUTOR
