# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The tool dispatcher — the core's, not the runtime's.

The dispatcher is the one path from a model's tool call to the corpus: the
budget and token checks, the ``tool_call_started`` event, the execution
through the registry, the declared errors mapped to data, the
evidence-ledger feed, the injection scan and the ``tool_call_finished``
event.

It belongs to the core because the rules it enforces belong to the core: a
runtime that dispatched tools itself would have to re-implement the budget
check, the evidence feed and the injection scan — and a runtime that
forgot one of them would be a hole, not a runtime.

**The dispatcher never steers a run by raising.** A tool's declared error
(an authorization refusal, a transient failure) and a model-argument
validation error are DATA for the model, not run failures: they flow back
as the structured tool result, and the model reacts to them. The registry's
refusal of an unregistered name is the one exception — it is a refusal to
dispatch at all, and it ends the run (the orchestrator's honest terminal),
never a message the model may talk its way past.
"""

import logging

from pydantic import ValidationError

import tracing
from capabilities.contract import CapabilityError
from capabilities.model import ToolCallRequest

from .budget import RunBudgetMonitor
from .cancellation import CancellationToken, run_cancellable
from .events import MESSAGE_TRUNCATION, EventEmitter, EventKind
from .registry import ToolRegistry
from .taint import scan_tool_result
from .verification import VerificationPipeline

logger = logging.getLogger(__name__)


class ToolDispatcher:
    """One run's tool dispatch — the authorization surface's execution path.

    The registry is the authorization surface (it refuses an unregistered
    name before any resolution); the monitor and the token are the run's
    bounds; the emitter is the seam's voice; the verifier is the evidence
    ledger the results feed. The dispatcher holds the run's machinery
    together so a runtime only has to say WHICH tool to call.
    """

    def __init__(
        self,
        registry: ToolRegistry,
        monitor: RunBudgetMonitor,
        token: CancellationToken,
        emitter: EventEmitter,
        verifier: VerificationPipeline | None = None,
    ) -> None:
        self._registry = registry
        self._monitor = monitor
        self._token = token
        self._emitter = emitter
        self._verifier = verifier

    async def dispatch(self, request: ToolCallRequest) -> dict:
        """One tool call: budget and token checks, lifecycle events, registry dispatch.

        The checks precede the ``tool_call_started`` event, so a refused
        dispatch (budget spent, run cancelled) never announces a tool call
        that will not run. The registry refuses an unregistered name (that
        refusal propagates — it ends the run); a port error or an invalid
        argument flows back to the model as the structured tool result. Both
        paths emit the ``tool_call_finished`` event that reports what
        actually happened.
        """
        self._monitor.check_wall_clock()
        self._token.raise_if_cancelled()
        self._monitor.check_evidence_volume()
        self._monitor.take_tool_call()
        self._emitter.emit(
            EventKind.TOOL_CALL_STARTED,
            {"name": request.name, "arguments": request.arguments},
            call_id=request.call_id,
        )
        with tracing.with_span(
            "agent.tool_call", attributes={"call_id": request.call_id, "tool": request.name}
        ) as tool_span:
            result_payload = await self._execute(request)
            # The declared-error surface flows back as data (see _execute):
            # the span records THAT fact, never the payload text.
            tool_span.set_attribute("errored", "error" in result_payload)
        if self._verifier is not None:
            # Every dispatched result reaches the verification ledger —
            # success shapes contribute their citations, error envelopes
            # record the attempt (the ledger classifies both itself).
            self._verifier.record_tool_result(request.name, result_payload)
            # The taint scan: retrieved content is data, never
            # instructions. An instruction pattern in a retrieved text is a
            # recorded finding — ledger, verdict payload and usage record —
            # and the content STILL passes as data: the same payload feeds
            # the model's role-tool message either way, no behavior change
            # from content.
            findings = scan_tool_result(request.name, result_payload)
            for finding in findings:
                self._verifier.record_finding(finding)
            if findings:
                self._monitor.record_injection_findings(len(findings))
        self._emitter.emit(EventKind.TOOL_CALL_FINISHED, result_payload, call_id=request.call_id)
        return result_payload

    async def _execute(self, request: ToolCallRequest) -> dict:
        """Run the executor through the registry; map the declared error surface to data."""
        try:
            result = await run_cancellable(self._token, self._registry.dispatch(request.name, request.arguments))
        except (CapabilityError, ValidationError) as failed:
            # The contract's declared errors (and the argument validation a
            # model can violate) are data for the model, not run failures:
            # the dispatcher never fabricates a successful result for them,
            # and never converts one into an instruction.
            if isinstance(failed, CapabilityError):
                code, operation = failed.code.value, failed.operation.value if failed.operation else None
            else:
                code, operation = "invalid_arguments", None
            detail = {"code": code, "operation": operation, "message": str(failed)[:MESSAGE_TRUNCATION]}
            logger.info(
                "tool %s reported %s: %s",
                request.name,
                detail["code"],
                detail["message"],
            )
            return {"error": detail}
        return {"result": result}
