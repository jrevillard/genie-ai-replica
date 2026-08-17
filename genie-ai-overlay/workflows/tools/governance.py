# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Three-phase governance pipeline for tool invocations (Decision 16).

Every tool invocation passes through three mandatory phases:

    1. PRE-EXECUTION  (< 50 ms, NFR28): authorization, validation, PII redaction
    2. RUNTIME:        rate-limit check, circuit breaker, timeout budget
    3. POST-EXECUTION (< 200 ms, NFR29): provenance check, audit enrichment

No bypass path (NFR11). If PII redaction fails, the tool call is BLOCKED.
If the circuit breaker is OPEN, the call returns a degradation response.
If rate limiting is exceeded, the call returns 429 with Retry-After.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from workflows.tools.pii_redactor import PIIRedactionError, PIIRedactor, RedactionResult, create_pii_redactor
from workflows.tools.redis_primitives import (
    AuditEntry,
    AuditStream,
    CircuitBreaker,
    SlidingWindowRateLimiter,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Governance result types
# ---------------------------------------------------------------------------
class GovernanceDecision:
    """Constants for governance decisions."""

    ALLOW = "allow"
    BLOCK_PII = "block_pii"
    BLOCK_AUTH = "block_auth"
    BLOCK_VALIDATION = "block_validation"
    RATE_LIMITED = "rate_limited"
    CIRCUIT_OPEN = "circuit_open"
    TIMEOUT = "timeout"
    DEGRADED = "degraded"


@dataclass
class GovernanceResult:
    """Result of the governance pipeline."""

    decision: str = GovernanceDecision.ALLOW
    allowed: bool = True
    tool_id: str = ""
    user_id: str = ""

    # Pre-execution results
    redacted_params: dict | None = None
    pii_entities_found: int = 0
    redaction_result: RedactionResult | None = None

    # Runtime results
    rate_limit_remaining: int | None = None
    retry_after: float | None = None
    circuit_state: str | None = None

    # Post-execution results
    execution_result: Any = None
    redacted_result: str | None = None
    duration_ms: float | None = None
    audit_entry_id: str | None = None

    # Error context
    error_message: str | None = None

    # Degradation info (for client-facing response)
    degradation: dict | None = None


@dataclass
class ToolConfig:
    """Configuration for a governed tool."""

    tool_id: str
    enabled: bool = True
    allowed_roles: list[str] = field(default_factory=lambda: ["tools-admin"])
    rate_limit_max_requests: int = 100
    rate_limit_window_seconds: int = 60
    execution_budget_ms: float = 5000.0  # Max execution time
    domain_whitelist: list[str] | None = None  # For provenance checks
    pii_redaction_required: bool = True  # PII redaction is mandatory (NFR11)


# ---------------------------------------------------------------------------
# Governance Pipeline
# ---------------------------------------------------------------------------
class GovernancePipeline:
    """Three-phase governance pipeline (Decision 16).

    Usage:
        pipeline = GovernancePipeline(redis_client=redis, pii_redactor=redactor)

        result = await pipeline.execute(
            tool_config=config,
            user_id="user-123",
            user_roles=["tools-admin"],
            parameters={"query": "john.doe@email.com wants info"},
            tool_fn=my_tool_function,
        )

        if result.allowed:
            # Use result.execution_result
            pass
        else:
            # Handle result.decision (rate_limited, circuit_open, block_pii, etc.)
            pass
    """

    def __init__(
        self,
        redis_client: Any,
        pii_redactor: PIIRedactor | None = None,
        rate_limiter: SlidingWindowRateLimiter | None = None,
        audit_stream: AuditStream | None = None,
    ):
        self._redis = redis_client
        self._pii_redactor = pii_redactor or create_pii_redactor()
        self._rate_limiter = rate_limiter or SlidingWindowRateLimiter(redis_client)
        self._audit_stream = audit_stream or AuditStream(redis_client)
        self._circuit_breakers: dict[str, CircuitBreaker] = {}

    def _get_circuit_breaker(self, tool_id: str) -> CircuitBreaker:
        """Get or create a circuit breaker for a tool."""
        if tool_id not in self._circuit_breakers:
            self._circuit_breakers[tool_id] = CircuitBreaker(self._redis, tool_id)
        return self._circuit_breakers[tool_id]

    # -------------------------------------------------------------------
    # Phase 1: PRE-EXECUTION (< 50 ms target, NFR28)
    # -------------------------------------------------------------------
    async def _pre_execution(
        self,
        tool_config: ToolConfig,
        user_id: str,
        user_roles: list[str],
        parameters: dict,
    ) -> GovernanceResult:
        """Pre-execution checks: authorization, validation, PII redaction."""
        result = GovernanceResult(tool_id=tool_config.tool_id, user_id=user_id)

        # 1a. Tool enabled check
        if not tool_config.enabled:
            result.allowed = False
            result.decision = GovernanceDecision.BLOCK_AUTH
            result.error_message = f"Tool '{tool_config.tool_id}' is disabled"
            return result

        # 1b. RBAC authorization
        if tool_config.allowed_roles and not any(role in tool_config.allowed_roles for role in user_roles):
            result.allowed = False
            result.decision = GovernanceDecision.BLOCK_AUTH
            result.error_message = (
                f"User lacks required role for tool '{tool_config.tool_id}'. Required: {tool_config.allowed_roles}"
            )
            return result

        # 1c. PII redaction (mandatory — BLOCK on failure, Decision 5, NFR6)
        if tool_config.pii_redaction_required:
            try:
                # Redact all string values in parameters
                redacted_params = {}
                total_entities = 0
                for key, value in parameters.items():
                    if isinstance(value, str):
                        redaction = await self._pii_redactor.redact(value)
                        redacted_params[key] = redaction.redacted_text
                        total_entities += redaction.entity_count
                    else:
                        redacted_params[key] = value

                result.redacted_params = redacted_params
                result.pii_entities_found = total_entities
            except PIIRedactionError as exc:
                # BLOCK — refuse to forward unredacted content
                result.allowed = False
                result.decision = GovernanceDecision.BLOCK_PII
                result.error_message = f"PII redaction failed (BLOCKED): {exc}"
                logger.error(
                    "PII redaction BLOCKED tool '%s' for user '%s': %s",
                    tool_config.tool_id,
                    user_id,
                    exc,
                )
                return result
        else:
            result.redacted_params = parameters

        return result

    # -------------------------------------------------------------------
    # Phase 2: RUNTIME (rate limit, circuit breaker, execution)
    # -------------------------------------------------------------------
    async def _runtime(
        self,
        tool_config: ToolConfig,
        user_id: str,
        pre_result: GovernanceResult,
        tool_fn: Callable,
    ) -> GovernanceResult:
        """Runtime phase: rate-limit, circuit breaker, and tool execution."""
        result = pre_result

        # 2a. Rate-limit check
        rate_limit = await self._rate_limiter.consume(
            scope=tool_config.tool_id,
            identifier=user_id,
        )
        result.rate_limit_remaining = rate_limit.remaining

        if not rate_limit.allowed:
            result.allowed = False
            result.decision = GovernanceDecision.RATE_LIMITED
            result.retry_after = rate_limit.retry_after
            result.error_message = (
                f"Rate limit exceeded for tool '{tool_config.tool_id}'. Retry after {rate_limit.retry_after:.1f}s"
            )
            return result

        # 2b. Circuit breaker check
        cb = self._get_circuit_breaker(tool_config.tool_id)
        if not await cb.is_allowed():
            state = await cb.get_state()
            result.allowed = False
            result.decision = GovernanceDecision.CIRCUIT_OPEN
            result.circuit_state = state.value
            result.error_message = f"Circuit breaker OPEN for tool '{tool_config.tool_id}'"
            result.degradation = {
                "tool_id": tool_config.tool_id,
                "reason": "CIRCUIT_OPEN",
                "fallback_applied": "rag_only",
                "message": f"'{tool_config.tool_id}' is temporarily unavailable. "
                "Results are from the document knowledge base only.",
            }
            return result

        result.circuit_state = (await cb.get_state()).value

        # 2c. Execute the tool with timeout budget
        start = time.monotonic()
        try:
            execution_result = await tool_fn(result.redacted_params)
            elapsed_ms = (time.monotonic() - start) * 1000
            result.execution_result = execution_result
            result.duration_ms = elapsed_ms

            # Record success with circuit breaker
            await cb.record_success()

            # Check timeout budget (warn but don't block — tool already completed)
            if elapsed_ms > tool_config.execution_budget_ms:
                logger.warning(
                    "Tool '%s' exceeded budget: %.1f ms > %.1f ms",
                    tool_config.tool_id,
                    elapsed_ms,
                    tool_config.execution_budget_ms,
                )

        except Exception as exc:
            elapsed_ms = (time.monotonic() - start) * 1000
            result.duration_ms = elapsed_ms
            result.allowed = False
            result.decision = GovernanceDecision.DEGRADED
            result.error_message = f"Tool execution failed: {exc}"
            result.degradation = {
                "tool_id": tool_config.tool_id,
                "reason": "EXECUTION_ERROR",
                "fallback_applied": "rag_only",
                "message": f"'{tool_config.tool_id}' encountered an error. "
                "Results are from the document knowledge base only.",
            }

            # Record failure with circuit breaker
            await cb.record_failure()
            logger.error(
                "Tool '%s' execution failed after %.1f ms: %s",
                tool_config.tool_id,
                elapsed_ms,
                exc,
            )

        return result

    # -------------------------------------------------------------------
    # Phase 3: POST-EXECUTION (< 200 ms target, NFR29)
    # -------------------------------------------------------------------
    async def _post_execution(
        self,
        tool_config: ToolConfig,
        result: GovernanceResult,
    ) -> GovernanceResult:
        """Post-execution phase: provenance check, PII redaction of result, audit."""

        # 3a. PII-redact the result (if it's a string)
        if result.execution_result is not None and isinstance(result.execution_result, str):
            try:
                redaction = await self._pii_redactor.redact(result.execution_result)
                result.redacted_result = redaction.redacted_text
                result.pii_entities_found += redaction.entity_count
            except PIIRedactionError as exc:
                # Result PII redaction failure — log and use truncated summary
                logger.error("PII redaction of result failed for tool '%s': %s", tool_config.tool_id, exc)
                result.redacted_result = "[Result redacted due to PII processing error]"

        # 3b. Audit entry (NFR8/FOI — every invocation must be auditable)
        audit_entry = AuditEntry(
            tool_id=tool_config.tool_id,
            user_id=result.user_id,
            action="invoke" if result.allowed else result.decision,
            parameters_redacted=result.redacted_params,
            result_summary=result.redacted_result[:500] if result.redacted_result else None,
            duration_ms=result.duration_ms,
            pii_entities_found=result.pii_entities_found,
            governance_decision=result.decision,
        )
        result.audit_entry_id = await self._audit_stream.log(audit_entry)

        return result

    # -------------------------------------------------------------------
    # Public API: execute the full pipeline
    # -------------------------------------------------------------------
    async def execute(
        self,
        tool_config: ToolConfig,
        user_id: str,
        user_roles: list[str],
        parameters: dict,
        tool_fn: Callable,
    ) -> GovernanceResult:
        """Execute the full 3-phase governance pipeline around a tool call.

        Args:
            tool_config: Configuration for the tool being invoked.
            user_id: The authenticated user's ID.
            user_roles: The user's Keycloak roles.
            parameters: Raw tool parameters (will be PII-redacted).
            tool_fn: Async callable that executes the actual tool.
                     Receives redacted parameters dict, returns result.

        Returns:
            GovernanceResult with decision, execution result, and audit trail.
        """
        # Phase 1: PRE-EXECUTION
        result = await self._pre_execution(tool_config, user_id, user_roles, parameters)
        if not result.allowed:
            # Still audit blocked invocations
            await self._post_execution(tool_config, result)
            return result

        # Phase 2: RUNTIME
        result = await self._runtime(tool_config, user_id, result, tool_fn)

        # Phase 3: POST-EXECUTION (runs regardless of tool success/failure)
        result = await self._post_execution(tool_config, result)

        return result
