# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The request orchestrator — the per-request owner of the governed run (AD-6).

One instance of this class answers one HTTP run request end to end:

* **admission** — the run passes through the flock slot pool
  (:class:`noagent.lane.AdmissionLane`) BEFORE any work; a saturated lane is
  a typed :class:`AdmissionRefused` the surface maps to the defined 429,
  never a queue. The pool is the slot FILES, so the run surface's lane and
  the no-agent pipeline's lane are one pool under the one-replica
  deployment contract (compose ``replicas`` gates it 0/1).
* **the budget** — built per run from the deployment's REQUIRED numbers and
  the request's communicated deadline: the effective wall clock is the
  communicated value capped by the configured ceiling, never wider. The
  knob numbers are read fail-closed at load: a missing or unusable knob
  raises :class:`MissingKnobsError` naming EVERY knob that failed — no run
  starts unbounded, and no numeric default exists anywhere in the
  enforcement path.
* **the run** — the seam loop with the monitor/token/emitter built here, so
  a cancellation leaves the monitor's partial counts readable (the
  ``CancelledError`` is logged with the partial usage record and
  re-raised untouched — a cancelled run has no honest terminal state).
* **the terminal usage record** — the shared counters the BFF's residual
  budget (translation) consumes: outcome, call counts (aux tallied
  separately), evidence bytes, served token usage, wall clock.

The orchestrator is transport-free: it holds the lane, the config, the
model client and a port FACTORY (the surface builds the stateless adapters
once and the executor per request), so the same class serves the run
surface and the tests unchanged.
"""

import asyncio
import json
import logging
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass

from capabilities.contract import CallerContext, OperationBudget
from noagent.lane import AdmissionLane, LaneBusyError

from .budget import RunBudget, RunBudgetMonitor
from .cancellation import CancellationToken
from .events import EventEmitter, EventSink
from .loop import OUTCOME_CANCELLED, AgentLoop, LoopModelClient, RunResult
from .probe import PROBE_SYSTEM_PROMPT, document_toolset

logger = logging.getLogger(__name__)


class MissingKnobsError(RuntimeError):
    """The deployment's budget configuration is incomplete; the run is refused.

    ``knobs`` names EVERY knob that is unset, empty, non-numeric or not
    positive — the caller (the run surface) answers with the 503 that
    names them, and no run starts with an unbounded dimension. There is no
    default to fall into anywhere in the enforcement path: the absence of
    a number is a deployment defect, and the refusal is how it surfaces.
    """

    def __init__(self, knobs: tuple[str, ...]) -> None:
        super().__init__(
            "the run budget configuration is incomplete — refusing to start an unbounded run; "
            f"set every required knob: {', '.join(knobs)}"
        )
        self.knobs = knobs


class AdmissionRefused(RuntimeError):
    """Every lane slot is held; the run is refused before any work starts.

    The typed carrier of the lane's saturation refusal: the run surface
    maps it to the defined admission behavior (the 429 with ``Retry-After``
    naming the saturation, sent before any stream byte).
    """


def _required_positive_int(source, name: str, failed: list[str]) -> int | None:
    """Read one REQUIRED integer knob; name it in ``failed`` when unset,
    empty, non-numeric or below 1 — a knob that fails its bound is as
    unusable as a knob that is absent."""
    raw = source.get(name)
    if raw is None or str(raw).strip() == "":
        failed.append(name)
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        failed.append(name)
        return None
    if value < 1:
        failed.append(name)
        return None
    return value


def _required_positive_float(source, name: str, failed: list[str]) -> float | None:
    """The float twin of :func:`_required_positive_int` (strictly > 0)."""
    raw = source.get(name)
    if raw is None or str(raw).strip() == "":
        failed.append(name)
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        failed.append(name)
        return None
    if value <= 0:
        failed.append(name)
        return None
    return value


@dataclass(frozen=True)
class OrchestratorConfig:
    """The deployment's budget numbers, read fail-closed from the environment.

    ``wall_clock_ceiling_seconds`` caps every request's communicated
    deadline: a request may ask for less, never for more than the
    deployment put a ceiling on. ``operation_budget`` is the per-tool bound
    the port's contract carries (timeout, result count, result bytes — all
    required by the contract, sourced here). ``system_prompt`` is the
    deployed two-tier override (``AGENT_RUN_SYSTEM_PROMPT``), defaulting to
    the probe's governed text.
    """

    max_steps: int
    max_model_calls: int
    max_tool_calls: int
    max_total_tokens: int
    max_evidence_bytes: int
    wall_clock_ceiling_seconds: float
    operation_budget: OperationBudget
    system_prompt: str

    @classmethod
    def load(cls, env=None) -> "OrchestratorConfig":
        """Read every REQUIRED knob; :class:`MissingKnobsError` names all of
        them when any is missing or unusable (fail-closed — the reader
        never falls into a number)."""
        source = os.environ if env is None else env
        failed: list[str] = []
        max_steps = _required_positive_int(source, "AGENT_RUN_MAX_STEPS", failed)
        max_model_calls = _required_positive_int(source, "AGENT_RUN_MAX_MODEL_CALLS", failed)
        max_tool_calls = _required_positive_int(source, "AGENT_RUN_MAX_TOOL_CALLS", failed)
        max_total_tokens = _required_positive_int(source, "AGENT_RUN_MAX_TOTAL_TOKENS", failed)
        max_evidence_bytes = _required_positive_int(source, "AGENT_RUN_MAX_EVIDENCE_BYTES", failed)
        wall_clock_ceiling_seconds = _required_positive_float(source, "AGENT_RUN_MAX_WALL_CLOCK_SECONDS", failed)
        tool_timeout_ms = _required_positive_int(source, "AGENT_TOOL_TIMEOUT_MS", failed)
        tool_max_results = _required_positive_int(source, "AGENT_TOOL_MAX_RESULTS", failed)
        tool_max_result_bytes = _required_positive_int(source, "AGENT_TOOL_MAX_RESULT_BYTES", failed)
        if failed:
            raise MissingKnobsError(tuple(failed))
        return cls(
            max_steps=max_steps,
            max_model_calls=max_model_calls,
            max_tool_calls=max_tool_calls,
            max_total_tokens=max_total_tokens,
            max_evidence_bytes=max_evidence_bytes,
            wall_clock_ceiling_seconds=wall_clock_ceiling_seconds,
            operation_budget=OperationBudget(
                timeout_ms=tool_timeout_ms, max_results=tool_max_results, max_result_bytes=tool_max_result_bytes
            ),
            system_prompt=str(source.get("AGENT_RUN_SYSTEM_PROMPT", "")).strip() or PROBE_SYSTEM_PROMPT,
        )

    def budget_for(self, deadline_ms: int) -> RunBudget:
        """The per-run budget: the communicated deadline (a REMAINING
        duration — clock-skew-free) capped by the configured ceiling."""
        wall_clock_seconds = min(self.wall_clock_ceiling_seconds, deadline_ms / 1000)
        return RunBudget(
            max_steps=self.max_steps,
            max_model_calls=self.max_model_calls,
            max_tool_calls=self.max_tool_calls,
            max_total_tokens=self.max_total_tokens,
            max_evidence_bytes=self.max_evidence_bytes,
            wall_clock_seconds=wall_clock_seconds,
        )


@dataclass(frozen=True)
class AgentRunRequest:
    """One governed run request: the question, its agent-phase deadline and
    the trusted caller context (assembled server-side by the BFF — never by
    the model), plus the caller bearer the port forwards only to the
    services that validate their own callers."""

    question: str
    deadline_ms: int
    context: CallerContext
    bearer: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.question, str) or not self.question.strip():
            raise ValueError("a run request carries a non-empty question")
        if not isinstance(self.deadline_ms, int) or isinstance(self.deadline_ms, bool) or self.deadline_ms <= 0:
            raise ValueError(f"deadline_ms must be a positive integer, got {self.deadline_ms!r}")


@dataclass(frozen=True)
class RunUsageRecord:
    """The terminal usage record of one run — the shared counters.

    This is the state the BFF's residual-budget contract consumes
    (translation plans against the remaining token/call allowance); a
    cancelled run never produces one (the partial counts ride the evidence
    log line instead), and no answer text rides it — the record carries
    what the run SPENT, never what it claimed.
    """

    run_id: str
    outcome: str
    steps: int
    model_calls: int
    aux_model_calls: int
    tool_calls: int
    evidence_bytes: int
    prompt_tokens: int | None
    completion_tokens: int | None
    wall_clock_seconds: float
    error: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


class RequestOrchestrator:
    """The per-request owner: admission → budget → seam loop → usage record.

    One instance is the run surface's long-lived wiring (lane + config +
    model client + port factory); each :meth:`run` is one request's
    governed execution. The lane claim is the caller's to hold (see
    :meth:`admit`), because the surface must answer saturation BEFORE any
    stream byte exists.
    """

    def __init__(
        self,
        config: OrchestratorConfig,
        lane: AdmissionLane,
        model_client: LoopModelClient,
        port_factory,
    ) -> None:
        self._config = config
        self._lane = lane
        self._model_client = model_client
        self._port_factory = port_factory

    @property
    def config(self) -> OrchestratorConfig:
        return self._config

    @asynccontextmanager
    async def admit(self) -> AsyncIterator[None]:
        """Hold one admission-lane slot for the duration of the block.

        The claim must wrap the WHOLE run (every stage inside it — the same
        discipline the no-agent pipeline's lane acquire carries), so the
        slot releases on every exit path: return, error and cancellation
        alike. Saturation raises the typed :class:`AdmissionRefused` before
        the block is entered.
        """
        try:
            async with self._lane.acquire():
                yield
        except LaneBusyError as busy:
            raise AdmissionRefused(str(busy)) from busy

    async def run(self, request: AgentRunRequest, sink: EventSink | None = None) -> RunUsageRecord:
        """One governed run to its terminal usage record; cancellation propagates.

        The monitor, token and emitter are built HERE, so a cancellation
        leaves the monitor's partial counts readable: the ``CancelledError``
        is logged with the partial record (the evidence a cancelled run
        keeps) and re-raised untouched — no terminal event, no fabricated
        terminal state, exactly the loop's existing contract.
        """
        run_id = f"run-{uuid.uuid4().hex}"
        monitor = RunBudgetMonitor(self._config.budget_for(request.deadline_ms))
        token = CancellationToken()
        emitter = EventEmitter(run_id=run_id, sink=sink)
        registry = document_toolset(
            self._port_factory(request.context, request.bearer), request.context, self._config.operation_budget
        )
        loop = AgentLoop(
            model=self._model_client,
            registry=registry,
            monitor=monitor,
            token=token,
            emitter=emitter,
            system_prompt=self._config.system_prompt,
        )
        try:
            result: RunResult = await loop.run(request.question)
        except asyncio.CancelledError:
            logger.warning(
                "agent run cancelled mid-flight; the partial usage record: %s",
                json.dumps(self._record(run_id, OUTCOME_CANCELLED, monitor, error=None).as_dict()),
            )
            raise
        return self._record(run_id, result.outcome, monitor, error=result.error)

    def _record(self, run_id: str, outcome: str, monitor: RunBudgetMonitor, *, error: str | None) -> RunUsageRecord:
        """The usage record: the monitor IS the source of every counter."""
        return RunUsageRecord(
            run_id=run_id,
            outcome=outcome,
            steps=monitor.steps,
            model_calls=monitor.model_calls,
            aux_model_calls=monitor.aux_model_calls,
            tool_calls=monitor.tool_calls,
            evidence_bytes=monitor.evidence_bytes,
            prompt_tokens=monitor.prompt_tokens,
            completion_tokens=monitor.completion_tokens,
            wall_clock_seconds=monitor.elapsed_seconds,
            error=error,
        )
