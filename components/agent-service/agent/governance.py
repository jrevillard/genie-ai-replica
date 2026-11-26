# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The core's governed run — the one place a runtime is driven.

The port (:mod:`agent.runtime`) says what a runtime may do. This module is
what the core does with it: the handshake, the runtime call, the delivered
text, the verdict, the terminal — and the honest failures.

Every event of a governed run is emitted HERE or by the dispatcher. The
runtime emits none. That is the point of the seam: a second runtime plugs
onto the port and inherits the whole vocabulary, the whole verdict and the
whole failure policy, instead of re-implementing them.

The failures are the core's policy, and they are honest:

* the runtime's exceptions become the terminal event they deserve — the
  registry's refusal of an unregistered name is an ``error``, an exhausted
  budget is ``budget_exhausted``, and neither ever fabricates an answer;
* ``CancelledError`` propagates untouched. A cancelled run has no honest
  terminal state, so it gets no terminal event — and the caller (the
  orchestrator) records the partial counters.
"""

import asyncio
import logging
from dataclasses import replace

import tracing

from .budget import BudgetExhausted
from .events import MESSAGE_TRUNCATION, EventKind, run_started_payload
from .registry import UnregisteredToolError
from .runtime import (
    OUTCOME_ANSWERED,
    OUTCOME_BUDGET_EXHAUSTED,
    OUTCOME_CANCELLED,
    OUTCOME_ERROR,
    RunInputs,
    RunResult,
    RuntimeDriver,
)
from .verification import INSUFFICIENCY_RESPONSE, VerificationPipeline

logger = logging.getLogger(__name__)

# The core's outcome vocabulary — the ONLY outcomes the seam's terminals
# carry (ADR-005: the vocabulary is closed and seam-owned). A runtime's own
# string never reaches the wire as a code.
_CORE_OUTCOMES = frozenset({OUTCOME_ERROR, OUTCOME_BUDGET_EXHAUSTED})


async def governed_run(
    runtime: RuntimeDriver,
    inputs: RunInputs,
    *,
    verifier: VerificationPipeline | None = None,
    execution_versions: dict | None = None,
) -> RunResult:
    """Drive one runtime to its terminal, with the governance around it.

    ``verifier`` is the run's citation verification pipeline — ``None``
    keeps the probe-shaped run (the smoke harness measures the runtime, not
    the verdict). ``execution_versions`` is the record the handshake
    carries; ``None`` keeps the probe-shaped ``{"question"}`` payload.

    The order on the wire is pinned: ``run_started`` → the tool events →
    ``text_message_started``, ``text_message_content``,
    ``text_message_finished`` → ``verdict`` → ``run_finished``.

    EVERY path out of this function ends with a terminal event — the
    runtime's failure, the delivery's failure, the refusal, the exhausted
    budget: the core owns the terminal, so a runtime that breaks its side
    of the port still gets an honest ending (and the caller keeps its
    usage record).
    """

    # The run-path span uses the ACTIVATING helper deliberately: the
    # per-model-call and per-tool-call children the runtime opens (and the
    # verification/judge spans below) are opened with ``tracing.with_span``,
    # which parents them to the ACTIVE span — the activation is what makes
    # ``agent.run`` their parent, and what the outbound model / doc-repo
    # hops inherit for traceparent propagation. Attributes are counters/ids
    # only (the record and the events carry the facts).
    with tracing.background_span("agent.run"):
        try:
            # The handshake is INSIDE the try: a sink that refuses it must
            # not take the run's ending away from the caller — the failure
            # becomes the honest terminal (and the result still carries the
            # outcome).
            inputs.emitter.emit(EventKind.RUN_STARTED, run_started_payload(inputs.question, execution_versions))
            result = await runtime.run(inputs)

            if result.outcome == OUTCOME_CANCELLED:
                # A cancelled run has NO honest terminal state: the
                # cancellation propagates untouched (the wire contract — the
                # BFF's own teardown finalizes the turn). ``CancelledError``
                # is a BaseException, so it crosses the ``except Exception``
                # below untouched.
                raise asyncio.CancelledError()

            if result.outcome != OUTCOME_ANSWERED:
                # The runtime reported the failure itself (a protocol anomaly
                # it detected); the core owns the terminal — and the code it
                # writes is the CORE's outcome, never the runtime's string.
                message = result.error or "the run failed"
                if result.outcome not in _CORE_OUTCOMES:
                    message = f"{message}; the runtime reported the outcome {result.outcome!r}"
                return _fail(inputs, result.outcome, message)

            text = result.final_text
            if not isinstance(text, str) or not text.strip():
                # An answered run with no text is a protocol anomaly: the
                # core does NOT emit a null chunk (no BFF consumer accepts
                # one) — the run ends with the honest terminal instead.
                return _fail(inputs, OUTCOME_ERROR, "the runtime delivered no answer text")

            # The CHEAP mechanical insufficiency decision (pure ledger reads, no
            # judge) — its verdict owns the delivered text, so when the ledger's
            # state requires the insufficiency response (no retrieval that grew
            # the citations, or a degraded one), the drafted text is discarded
            # and the standard explicit message is what streams.
            # Time-to-first-chunk never absorbs the judge latency.
            if verifier is not None and verifier.insufficiency_decision()["required"]:
                text = INSUFFICIENCY_RESPONSE
            inputs.emitter.emit(EventKind.TEXT_MESSAGE_STARTED, {"role": "assistant"})
            inputs.emitter.emit(EventKind.TEXT_MESSAGE_CONTENT, {"text": text})
            inputs.emitter.emit(EventKind.TEXT_MESSAGE_FINISHED, {})
            if verifier is not None:
                # The validity check and the judged grounding over the EMITTED
                # text — the verdict event lands after the last text event and
                # before the terminal, exactly the pinned position. The
                # finalize is the pipeline's own budgeted scope: its failures
                # degrade to unverified inside it, never into the run's
                # terminal state.
                verdict = await verifier.finalize(text)
                inputs.emitter.emit(EventKind.VERDICT, verdict.payload())
            inputs.emitter.emit(EventKind.RUN_FINISHED, {"outcome": OUTCOME_ANSWERED})
            # The run's record carries the DELIVERED text — the runtime returned
            # its draft, and the delivery is the core's decision (the
            # insufficiency rule may replace it). A consumer that reads the
            # record must read what the user received.
            return replace(result, final_text=text)
        except UnregisteredToolError as refused:
            # The registry refused before any resolution; the run ends
            # honestly with the refusal — no tool result is invented.
            return _fail(inputs, OUTCOME_ERROR, str(refused))
        except BudgetExhausted as exhausted:
            return _fail(inputs, OUTCOME_BUDGET_EXHAUSTED, str(exhausted))
        except Exception as failed:  # noqa: BLE001 — a failed run still gets its terminal event
            logger.warning("agent run failed: %s: %s", type(failed).__name__, str(failed)[:MESSAGE_TRUNCATION])
            return _fail(inputs, OUTCOME_ERROR, f"{type(failed).__name__}: {str(failed)[:MESSAGE_TRUNCATION]}")


def _emit_terminal(inputs: RunInputs, kind: EventKind, payload: dict) -> None:
    """Emit the run's terminal event — and survive a sink that refuses it.

    The terminal is the run's last word. A sink that raises while it is
    written has nowhere left to deliver it to, but the RESULT must still
    come back: the caller (the probe, the orchestrator) records it, and the
    run must not die with a traceback that loses the evidence record. The
    refusal is logged; the outcome travels on the result.
    """

    try:
        inputs.emitter.emit(kind, payload)
    except Exception as broken:  # noqa: BLE001 — the sink is the failing part
        logger.warning(
            "the event sink refused the %s event: %s: %s",
            kind.value,
            type(broken).__name__,
            str(broken)[:MESSAGE_TRUNCATION],
        )


def _fail(inputs: RunInputs, outcome: str, message: str) -> RunResult:
    """End the run honestly: the terminal ``run_error``, no answer text.

    The code written on the wire is the CORE's outcome — a runtime's own
    outcome string is never a code (the vocabulary is closed and
    seam-owned), so an outcome the core does not accept degrades to
    ``error``.
    """

    code = outcome if outcome in _CORE_OUTCOMES else OUTCOME_ERROR
    truncated = message[:MESSAGE_TRUNCATION]
    _emit_terminal(inputs, EventKind.RUN_ERROR, {"code": code, "message": truncated})
    monitor = inputs.monitor
    return RunResult(
        outcome=code,
        final_text=None,
        steps=monitor.steps,
        model_calls=monitor.model_calls,
        aux_model_calls=monitor.aux_model_calls,
        tool_calls=monitor.tool_calls,
        evidence_bytes=monitor.evidence_bytes,
        wall_clock_seconds=monitor.elapsed_seconds,
        prompt_tokens=monitor.prompt_tokens,
        completion_tokens=monitor.completion_tokens,
        error=truncated,
    )
