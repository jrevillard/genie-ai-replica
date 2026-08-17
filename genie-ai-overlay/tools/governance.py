# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""The governance pipeline — Decision 16, SST's non-negotiable sovereignty layer.

Every tool invocation traverses this pipeline. There is **no bypass path** (NFR11):
the only way to reach a tool backend is through :meth:`GovernancePipeline.guard`,
and the enforcement is structural, not conventional — ``guard`` owns the call.

Three phases, three budgets, three OTel spans (Decision 16, NFR28/NFR29/NFR31):

    PRE      < 50 ms, in-process    authorize → validate params → redact PII (BLOCK)
    RUNTIME  per-tool budget        rate limit → breaker state → timeout
    POST     200 ms, async          provenance check → audit enrichment

**Why this is a library, not a service (Decision 19).** NFR28 budgets the pre-execution
phase at under 50 ms, inside NFR1's 2-second end-to-end web-search budget which also
has to absorb the mandatory redaction call. A service hop per phase does not fit. If
this ever becomes a service, NFR1 and NFR28 both need renegotiating.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from urllib.parse import urlparse

from tools.pii import PIIRedactionError, PIIRedactor, build_redactor
from tools.redis_primitives import AuditStream, CircuitBreaker, RateLimiter, get_redis_client
from tools.schemas import DegradationReason, GovernanceOutcome, GovernanceStatus, ToolResult

try:
    from tracing import with_span
except ImportError:  # pragma: no cover - only when tracing.py is absent

    class _NullSpan:
        def set_attribute(self, *_a, **_k):
            pass

    class _NullCtx:
        def __enter__(self):
            return _NullSpan()

        def __exit__(self, *_a):
            return False

    def with_span(*_a, **_k):
        return _NullCtx()


logger = logging.getLogger(__name__)


class ToolDenied(Exception):
    """Governance refused the invocation. Carries the outcome for degradation rendering."""

    def __init__(self, outcome: GovernanceOutcome) -> None:
        super().__init__(outcome.detail or f"Tool {outcome.tool_id} denied")
        self.outcome = outcome


@dataclass
class ToolPolicy:
    """Per-tool governance configuration.

    Defaults are the PRD's stated values, so a tool with no explicit policy is still
    governed. ``enabled=False`` and an empty ``allowed_roles`` are both hard stops —
    FR11 requires that a disabled or unauthorized tool cannot fire from the rule-based
    *or* the LLM-driven path, and since both paths call :meth:`guard`, that holds.
    """

    tool_id: str
    enabled: bool = True
    allowed_roles: tuple[str, ...] = ()
    rate_limit: int = 60
    rate_window_seconds: float = 60.0
    execution_budget_ms: int = 5_000
    failure_threshold: int = 3
    recovery_seconds: float = 60.0
    domain_whitelist: tuple[str, ...] = ()
    required_params: tuple[str, ...] = ()

    def authorizes(self, roles: tuple[str, ...] | list[str] | None) -> bool:
        """True when the caller's roles permit this tool.

        An empty ``allowed_roles`` means "no role restriction" — the tool is open to
        any authenticated caller. It does not mean "deny everyone", because most tools
        (web search) are not privileged operations.
        """
        if not self.allowed_roles:
            return True
        return bool(set(self.allowed_roles) & set(roles or ()))


@dataclass
class GovernanceContext:
    """Caller identity and request scope for one invocation."""

    user_id: str = "anonymous"
    roles: tuple[str, ...] = ()
    correlation_id: str = field(default_factory=lambda: uuid.uuid4().hex)


class GovernancePipeline:
    """The single insertion point wrapping every tool call (Decision 16, FR50).

    Construct once per process via :func:`build_pipeline` and reuse — it holds the
    Redis client and the redactor, both of which are expensive to build per request.
    """

    def __init__(self, redactor: PIIRedactor, redis_client=None) -> None:
        self._redactor = redactor
        self._redis = redis_client
        self._limiter = RateLimiter(redis_client)
        self._audit = AuditStream(redis_client)
        self._breakers: dict[str, CircuitBreaker] = {}

    def _breaker(self, policy: ToolPolicy) -> CircuitBreaker:
        """Return the per-tool breaker, creating it on first use.

        Cached per tool id so breaker state is not reset by rebuilding the object;
        the state itself lives in Redis, but the cache avoids churn.
        """
        if policy.tool_id not in self._breakers:
            self._breakers[policy.tool_id] = CircuitBreaker(
                self._redis,
                name=policy.tool_id,
                failure_threshold=policy.failure_threshold,
                recovery_seconds=policy.recovery_seconds,
            )
        return self._breakers[policy.tool_id]

    # ───────────────────────────── PRE (< 50 ms, NFR28) ─────────────────────────────

    async def pre_execute(self, policy: ToolPolicy, params: dict, ctx: GovernanceContext) -> GovernanceOutcome:
        """Authorize, validate, and redact. Returns DENIED rather than raising.

        Redaction failure is DENIED, never pass-through (Decision 5, NFR6). This is the
        one place in SST where an infrastructure error must stop the request: a
        redactor that fails open looks like protection while providing none.
        """
        with with_span(
            "sst.governance.pre",
            attributes={"sst.tool_id": policy.tool_id, "sst.correlation_id": ctx.correlation_id},
        ) as span:

            def denied(reason: DegradationReason, detail: str) -> GovernanceOutcome:
                span.set_attribute("sst.governance.decision", "denied")
                span.set_attribute("sst.governance.reason", reason.value)
                return GovernanceOutcome(
                    status=GovernanceStatus.DENIED,
                    tool_id=policy.tool_id,
                    correlation_id=ctx.correlation_id,
                    reason=reason,
                    detail=detail,
                )

            # 1. Tool authorization (FR11) — disabled or unauthorized cannot fire.
            if not policy.enabled:
                return denied(DegradationReason.DENIED, f"Tool {policy.tool_id} is disabled.")
            if not policy.authorizes(ctx.roles):
                return denied(DegradationReason.DENIED, f"Not authorized to use {policy.tool_id}.")

            # 2. Parameter validation — missing or blank required params.
            missing = [p for p in policy.required_params if not str(params.get(p, "")).strip()]
            if missing:
                return denied(DegradationReason.DENIED, f"Missing required parameter(s): {', '.join(missing)}.")

            # 3. PII redaction (mandatory guardrail, FR12) — BLOCK on failure.
            try:
                redacted = await self._redactor.redact_params(params)
            except PIIRedactionError as exc:
                logger.error("PII redaction failed for %s; BLOCKING (NFR6): %s", policy.tool_id, exc)
                return denied(
                    DegradationReason.DENIED, "Request blocked: content could not be checked for personal data."
                )

            span.set_attribute("sst.governance.decision", "allowed")
            return GovernanceOutcome(
                status=GovernanceStatus.ALLOWED,
                tool_id=policy.tool_id,
                correlation_id=ctx.correlation_id,
                redacted_params=redacted,
            )

    # ───────────────────────────── RUNTIME ─────────────────────────────

    async def runtime_check(self, policy: ToolPolicy, ctx: GovernanceContext) -> GovernanceOutcome:
        """Rate limit and breaker state, checked before the backend is touched."""
        with with_span(
            "sst.governance.runtime",
            attributes={"sst.tool_id": policy.tool_id, "sst.correlation_id": ctx.correlation_id},
        ) as span:
            allowed, count = await self._limiter.check(
                f"{policy.tool_id}:user:{ctx.user_id}", policy.rate_limit, policy.rate_window_seconds
            )
            span.set_attribute("sst.rate_limit.count", count)
            if not allowed:
                span.set_attribute("sst.governance.reason", "RATE_LIMITED")
                return GovernanceOutcome(
                    status=GovernanceStatus.DENIED,
                    tool_id=policy.tool_id,
                    correlation_id=ctx.correlation_id,
                    reason=DegradationReason.DENIED,
                    detail="Rate limit exceeded for this tool.",
                )

            breaker_allowed, state = await self._breaker(policy).allow()
            span.set_attribute("sst.breaker.state", state.value)
            if not breaker_allowed:
                return GovernanceOutcome(
                    status=GovernanceStatus.DENIED,
                    tool_id=policy.tool_id,
                    correlation_id=ctx.correlation_id,
                    reason=DegradationReason.CIRCUIT_OPEN,
                    detail=f"{policy.tool_id} is temporarily unavailable.",
                )

            return GovernanceOutcome(
                status=GovernanceStatus.ALLOWED, tool_id=policy.tool_id, correlation_id=ctx.correlation_id
            )

    # ───────────────────────────── POST (200 ms, NFR29) ─────────────────────────────

    async def post_execute(
        self,
        policy: ToolPolicy,
        results: list[ToolResult],
        ctx: GovernanceContext,
        redacted_params: dict | None = None,
        status: str = "success",
    ) -> list[ToolResult]:
        """Provenance-filter the results and write the audit record.

        Returns the results that survive the domain whitelist. The filter runs **here**,
        in the pipeline, not inside the search backend — NFR11 requires it be enforced
        at the executor level so it cannot be bypassed by reconfiguring the backend.
        """
        with with_span(
            "sst.governance.post",
            attributes={"sst.tool_id": policy.tool_id, "sst.correlation_id": ctx.correlation_id},
        ) as span:
            kept = filter_by_domain(results, policy.domain_whitelist)
            span.set_attribute("sst.results.returned", len(results))
            span.set_attribute("sst.results.kept", len(kept))

            await self._audit.append(
                tool_id=policy.tool_id,
                user_id=ctx.user_id,
                correlation_id=ctx.correlation_id,
                status=status,
                redacted_params=redacted_params,
                result_summary=f"{len(kept)}/{len(results)} results kept after provenance filter",
                governance_decisions={"domain_filtered": len(results) - len(kept)},
            )
            return kept

    async def audit_denial(self, outcome: GovernanceOutcome, ctx: GovernanceContext) -> None:
        """Audit a denied invocation.

        NFR7 says *every* invocation is audit-logged — denials included. A denial that
        left no trace would hide exactly the events an auditor cares about most.
        """
        await self._audit.append(
            tool_id=outcome.tool_id,
            user_id=ctx.user_id,
            correlation_id=ctx.correlation_id,
            status="denied",
            result_summary=outcome.detail,
            governance_decisions={"reason": outcome.reason.value if outcome.reason else "DENIED"},
        )

    # ───────────────────────────── The only entry point ─────────────────────────────

    async def guard(self, policy: ToolPolicy, params: dict, ctx: GovernanceContext, invoke) -> list[ToolResult]:
        """Run *invoke* through all three phases. **The only way to call a tool.**

        Args:
            policy: Per-tool governance configuration.
            params: Raw tool parameters — redacted before *invoke* sees them.
            ctx: Caller identity and correlation id.
            invoke: ``async (redacted_params) -> list[ToolResult]``.

        Returns:
            The governed, provenance-filtered results.

        Raises:
            ToolDenied: any phase refused. The caller renders
                ``exc.outcome.to_degradation()`` and continues without this tool —
                never fabricates around it (NFR12).

        Because ``invoke`` is a parameter rather than something the caller runs itself,
        there is no code path that reaches a backend without traversing the pipeline
        (NFR11). That structural property is what the no-bypass test asserts.
        """
        pre = await self.pre_execute(policy, params, ctx)
        if not pre.allowed:
            await self.audit_denial(pre, ctx)
            raise ToolDenied(pre)

        runtime = await self.runtime_check(policy, ctx)
        if not runtime.allowed:
            await self.audit_denial(runtime, ctx)
            raise ToolDenied(runtime)

        breaker = self._breaker(policy)
        try:
            results = await asyncio.wait_for(
                invoke(pre.redacted_params or {}), timeout=policy.execution_budget_ms / 1000
            )
        except asyncio.TimeoutError:
            await breaker.record_failure()
            outcome = GovernanceOutcome(
                status=GovernanceStatus.DENIED,
                tool_id=policy.tool_id,
                correlation_id=ctx.correlation_id,
                reason=DegradationReason.TIMEOUT,
                detail=f"{policy.tool_id} exceeded its {policy.execution_budget_ms} ms budget.",
            )
            await self.audit_denial(outcome, ctx)
            raise ToolDenied(outcome) from None
        except Exception as exc:
            await breaker.record_failure()
            logger.warning("Tool %s failed: %s", policy.tool_id, exc)
            outcome = GovernanceOutcome(
                status=GovernanceStatus.DENIED,
                tool_id=policy.tool_id,
                correlation_id=ctx.correlation_id,
                reason=DegradationReason.BACKEND_ERROR,
                detail=f"{policy.tool_id} returned an error.",
            )
            await self.audit_denial(outcome, ctx)
            raise ToolDenied(outcome) from exc

        await breaker.record_success()
        return await self.post_execute(policy, results, ctx, redacted_params=pre.redacted_params)


def filter_by_domain(results: list[ToolResult], whitelist: tuple[str, ...] | list[str]) -> list[ToolResult]:
    """Keep only results whose host is on *whitelist* (FR17, NFR11).

    An empty whitelist means no domain restriction. Matching is on the registrable
    host and any subdomain of it, so ``gov.ke`` admits ``nairobi.gov.ke``.

    Also drops results whose URL is unparseable or non-HTTP, which doubles as the
    URL-validity check NFR16 requires — an unreachable or malformed URL must never
    reach a citation.
    """
    if not whitelist:
        return [r for r in results if _is_valid_http_url(r.url)]
    allowed = {d.lower().lstrip(".") for d in whitelist if d}
    kept = []
    for result in results:
        if not _is_valid_http_url(result.url):
            continue
        host = (urlparse(result.url).hostname or "").lower()
        if any(host == d or host.endswith(f".{d}") for d in allowed):
            kept.append(result)
    return kept


def _is_valid_http_url(url: str) -> bool:
    """True for a well-formed http(s) URL with a host (NFR16)."""
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.hostname)
    except Exception:
        return False


_pipeline: GovernancePipeline | None = None


async def build_pipeline(force: bool = False) -> GovernancePipeline:
    """Return the process-wide pipeline, constructing it on first call.

    Cached because the Redis connection and the Presidio engine are both expensive to
    build per request and the 50 ms PRE budget (NFR28) does not accommodate either.
    Pass ``force=True`` in tests to rebuild.
    """
    global _pipeline
    if _pipeline is None or force:
        _pipeline = GovernancePipeline(
            redactor=build_redactor(os.getenv("PII_REDACTOR_IMPL", "regex")),
            redis_client=await get_redis_client(),
        )
    return _pipeline
