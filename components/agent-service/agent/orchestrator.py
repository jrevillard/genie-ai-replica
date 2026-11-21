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
  The per-request wiring also builds the preparation entry (the
  preparation module) over the run's monitor — every query the model
  writes is prepared (detected, translated to English) under the aux
  model-call budget before it reaches the port.
* **the terminal usage record** — the shared counters the BFF's residual
  budget (translation) consumes: outcome, call counts (aux tallied
  separately), evidence bytes, served token usage, wall clock — plus the
  request's display language, the preparation status and the taint scan's
  finding count.

The orchestrator is transport-free: it holds the lane, the config, the
model client, a port FACTORY (the surface builds the stateless adapters
once and the executor per request) and a preparer FACTORY (one preparation
entry per run, sharing the process-wide discovery caches), so the same
class serves the run surface and the tests unchanged.
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
from noagent.config import required_positive_float, required_positive_int
from noagent.lane import AdmissionLane, LaneBusyError
from preparation.config import PreparationConfig
from preparation.prepare import QueryPreparer
from preparation.registry import LanguageRegistry
from preparation.translation import HttpxTransport, ModelEndpointCache, TranslationClient

from .budget import RunBudget, RunBudgetMonitor
from .cancellation import CancellationToken
from .events import EventEmitter, EventKind, EventSink
from .loop import MESSAGE_TRUNCATION, OUTCOME_CANCELLED, OUTCOME_ERROR, AgentLoop, LoopModelClient, RunResult
from .prompt import PRODUCTION_SYSTEM_PROMPT
from .toolset import document_toolset
from .verification import (
    IMPLEMENTED_POLICIES,
    JUDGE_TIMEOUT_KNOB,
    POLICY_VERDICT_MARKED,
    VERDICT_POLICY_KNOB,
    VerificationPipeline,
)

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


@dataclass(frozen=True)
class OrchestratorConfig:
    """The deployment's budget numbers, read fail-closed from the environment.

    ``wall_clock_ceiling_seconds`` caps every request's communicated
    deadline: a request may ask for less, never for more than the
    deployment put a ceiling on. ``operation_budget`` is the per-tool bound
    the port's contract carries (timeout, result count, result bytes — all
    required by the contract, sourced here). ``system_prompt`` is the
    deployed two-tier override (``AGENT_RUN_SYSTEM_PROMPT``), defaulting to
    the governed production prompt (:data:`agent.prompt.PRODUCTION_SYSTEM_PROMPT`
    — grounded-or-insufficient, cite-only-served-evidence, AD-13
    data-never-instructions). ``verdict_policy`` is the citation
    verification release policy (``AGENT_VERDICT_POLICY``, default
    ``verdict-marked`` — iteration 1 implements only that value; an
    unusable value refuses the config load naming the knob). There is no
    policy value that disables verification — the pipeline runs on every
    governed run. ``judge_timeout_ms`` (``AGENT_VERDICT_JUDGE_TIMEOUT_MS``)
    is the grounding judge's REQUIRED hard bound: missing or unusable is a
    missing knob like any other.
    """

    max_steps: int
    max_model_calls: int
    max_tool_calls: int
    max_total_tokens: int
    max_evidence_bytes: int
    wall_clock_ceiling_seconds: float
    operation_budget: OperationBudget
    system_prompt: str
    verdict_policy: str
    judge_timeout_ms: int

    @classmethod
    def load(cls, env=None) -> "OrchestratorConfig":
        """Read every REQUIRED knob; :class:`MissingKnobsError` names all of
        them when any is missing or unusable (fail-closed — the reader
        never falls into a number). The release policy is validated against
        the implemented set before the run: an unimplemented value raises
        ``ValueError`` naming the knob, the value and the not-implemented
        reason — the run surface answers 503 (``run_surface_unconfigured``)."""
        source = os.environ if env is None else env
        failed: list[str] = []
        max_steps = required_positive_int(source, "AGENT_RUN_MAX_STEPS", failed)
        max_model_calls = required_positive_int(source, "AGENT_RUN_MAX_MODEL_CALLS", failed)
        max_tool_calls = required_positive_int(source, "AGENT_RUN_MAX_TOOL_CALLS", failed)
        max_total_tokens = required_positive_int(source, "AGENT_RUN_MAX_TOTAL_TOKENS", failed)
        max_evidence_bytes = required_positive_int(source, "AGENT_RUN_MAX_EVIDENCE_BYTES", failed)
        wall_clock_ceiling_seconds = required_positive_float(source, "AGENT_RUN_MAX_WALL_CLOCK_SECONDS", failed)
        tool_timeout_ms = required_positive_int(source, "AGENT_TOOL_TIMEOUT_MS", failed)
        tool_max_results = required_positive_int(source, "AGENT_TOOL_MAX_RESULTS", failed)
        tool_max_result_bytes = required_positive_int(source, "AGENT_TOOL_MAX_RESULT_BYTES", failed)
        judge_timeout_ms = required_positive_int(source, JUDGE_TIMEOUT_KNOB, failed)
        if failed:
            # The knob refusal aggregates FIRST: a deployment with several
            # defects sees every missing knob named in one 503, not one at
            # a time.
            raise MissingKnobsError(tuple(failed))
        verdict_policy = str(source.get(VERDICT_POLICY_KNOB, "")).strip() or POLICY_VERDICT_MARKED
        if verdict_policy not in IMPLEMENTED_POLICIES:
            raise ValueError(
                f"{VERDICT_POLICY_KNOB}={verdict_policy!r} is not implemented in iteration 1 "
                f"(implemented: {', '.join(sorted(IMPLEMENTED_POLICIES))}) — verification runs on every "
                "governed run; no policy value disables it"
            )
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
            system_prompt=str(source.get("AGENT_RUN_SYSTEM_PROMPT", "")).strip() or PRODUCTION_SYSTEM_PROMPT,
            verdict_policy=verdict_policy,
            judge_timeout_ms=judge_timeout_ms,
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
    services that validate their own callers. ``language`` is the UI locale
    the caller asked the answer in (optional): the orchestrator does not
    answer in it — the BFF's translation leg does — and records it on the
    usage record so the leg's pairing needs nothing outside the record."""

    question: str
    deadline_ms: int
    context: CallerContext
    bearer: str | None = None
    language: str | None = None

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

    The additive fields carry the per-request facts the integration slice
    records: ``language`` — the requested display language, riding the same
    record the translation leg plans against; ``preparation_status`` — the
    FIRST search query's preparation status (the initial query's, in the
    contract's preparation vocabulary; ``None`` when no query was prepared);
    ``injection_findings`` — how many injection attempts the run's taint
    scan recorded (AD-13: an attempt is a counted finding, the content
    still passed as data).
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
    language: str | None = None
    preparation_status: str | None = None
    injection_findings: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


class BudgetedTranslationClient(TranslationClient):
    """The preparation translator under the run's fleet model-call budget.

    One subclass, one override: every translation dispatch claims one
    AUXILIARY model call from the run's monitor BEFORE it goes out (the
    check-then-count discipline — an exhausted budget refuses the dispatch,
    and the refusal propagates into the loop's honest
    ``budget_exhausted`` terminal). The claim is what makes preparation
    bounded: translation is plumbing, tallied separately from the loop's
    own calls, and it can never outrun the fleet budget. The claim precedes the
    dispatch's internal gates, so a too-long refusal also counts one aux
    call — the conservative direction (the record never undercounts); and
    a run that a too-long refusal errored records the count without ever
    being paired with a translation plan. The served token usage of a
    translation call is not reportable through this seam (the preparation
    module returns text only), so the totals are untouched — a lower
    bound stays a lower bound, nothing is guessed.
    """

    def __init__(self, config: PreparationConfig, registry, monitor: RunBudgetMonitor, transport=None, cache=None):
        super().__init__(config, registry, transport=transport, cache=cache)
        self._budget_monitor = monitor

    async def translate_prompt(self, prompt: str, translategemma: bool, model_id: str | None) -> str:
        self._budget_monitor.take_aux_model_call()
        return await super().translate_prompt(prompt, translategemma, model_id)


def build_preparer_factory(env=None):
    """The per-run preparer factory the orchestrator wires.

    The expensive, stateless parts (the config, the language registry, the
    HTTP transport and the TTL-cached endpoint discovery) are built ONCE
    per process and shared by every run; each run gets its OWN
    :class:`QueryPreparer` over a translator bound to ITS monitor, so the
    budget claims land on the right run even with runs interleaved on one
    event loop (the claim fires synchronously inside the translation
    dispatch — no monitor swap can race it).
    """
    config = PreparationConfig.load(env)
    registry = LanguageRegistry(config.registry_path)
    transport = HttpxTransport(config.tls_verify)
    cache = ModelEndpointCache(
        config.translation_endpoint, transport, config.probe_timeout_seconds, config.detect_ttl_seconds
    )

    def factory(monitor: RunBudgetMonitor, language: str | None = None):
        translator = BudgetedTranslationClient(config, registry, monitor, transport=transport, cache=cache)
        preparer = QueryPreparer(config, registry, translator)
        if language is None:
            return preparer
        return _LanguageBoundPreparer(preparer, language)

    return factory


class _LanguageBoundPreparer:
    """The run's preparer view with the request's locale bound as the
    DEFAULT ``source_language`` hint (the named language beats detection in
    the preparation module — the deployed semantics). The caller's own
    hint, when one arrives, still wins."""

    def __init__(self, inner, default_language: str) -> None:
        self._inner = inner
        self._default_language = default_language

    async def prepare(self, text, source_language=None):
        return await self._inner.prepare(text, source_language or self._default_language)


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
        preparer_factory=None,
    ) -> None:
        self._config = config
        self._lane = lane
        self._model_client = model_client
        self._port_factory = port_factory
        # The preparation wiring (the preparation module, consumed per
        # query): a factory building ONE preparer per run over the run's
        # monitor. ``None`` keeps the probe-shaped toolset (no preparation
        # leg) — the tests' and the probe's path; the governed surface
        # always wires one.
        self._preparer_factory = preparer_factory

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
        # The preparation statuses land here, through the toolset's callback:
        # the FIRST one is the initial query's — the record carries it.
        preparation_statuses: list[str] = []
        try:
            # The per-request assembly is INSIDE the try: a build failure
            # (a port-factory refusal, a registry defect) must reach the
            # caller as the honest terminal — the RUN_ERROR event and the
            # "error" usage record — never as an exception past the stream
            # that already started. The loop's own failures never get here:
            # the loop catches its Exceptions internally and returns them
            # as its result.
            preparer = self._preparer_factory(monitor, request.language) if self._preparer_factory is not None else None
            registry = document_toolset(
                self._port_factory(request.context, request.bearer),
                request.context,
                self._config.operation_budget,
                preparer=preparer,
                on_preparation_status=preparation_statuses.append,
            )
            verifier = VerificationPipeline(
                policy=self._config.verdict_policy,
                judge_timeout_ms=self._config.judge_timeout_ms,
                judge_model_client=self._model_client,
                monitor=monitor,
                authorized_repos=request.context.authorized_repos,
            )
            loop = AgentLoop(
                model=self._model_client,
                registry=registry,
                monitor=monitor,
                token=token,
                emitter=emitter,
                system_prompt=self._config.system_prompt,
                verifier=verifier,
            )
            result: RunResult = await loop.run(request.question)
        except asyncio.CancelledError:
            logger.warning(
                "agent run cancelled mid-flight; the partial usage record: %s",
                json.dumps(
                    self._record(
                        run_id,
                        OUTCOME_CANCELLED,
                        monitor,
                        error=None,
                        request=request,
                        preparation_statuses=preparation_statuses,
                    ).as_dict()
                ),
            )
            raise
        except Exception as failed:  # noqa: BLE001 — a pre-loop build failure still gets its terminal
            message = f"{type(failed).__name__}: {str(failed)[:MESSAGE_TRUNCATION]}"
            logger.warning("agent run failed before its first dispatch: %s", message)
            # The loop announces run_started when it enters; a build failure
            # happens after the run began, and every stream must begin with
            # run_started — so the failure path announces it here.
            emitter.emit(EventKind.RUN_STARTED, {"question": request.question})
            emitter.emit(EventKind.RUN_ERROR, {"code": OUTCOME_ERROR, "message": message})
            return self._record(
                run_id,
                OUTCOME_ERROR,
                monitor,
                error=message,
                request=request,
                preparation_statuses=preparation_statuses,
            )
        return self._record(
            run_id,
            result.outcome,
            monitor,
            error=result.error,
            request=request,
            preparation_statuses=preparation_statuses,
        )

    def _record(
        self,
        run_id: str,
        outcome: str,
        monitor: RunBudgetMonitor,
        *,
        error: str | None,
        request: AgentRunRequest,
        preparation_statuses: list[str],
    ) -> RunUsageRecord:
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
            language=request.language,
            preparation_status=preparation_statuses[0] if preparation_statuses else None,
            injection_findings=monitor.injection_findings,
        )
