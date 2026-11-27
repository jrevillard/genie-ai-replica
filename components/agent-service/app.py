# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""GENIE.AI agent service - internal-only HTTP surface.

The run surface: ``POST /v1/runs`` serves the
SEAM stream (the envelope ``{run_id, call_id, seq, kind, payload}`` over
SSE, plus its own terminal usage record) — never a client frame name; the
BFF parses this stream and writes every client frame.

The defined admission behavior: the run is admitted through the flock slot
pool BEFORE any stream byte exists — a saturated lane answers ``429`` (JSON
naming the saturation, ``Retry-After`` set), unconfigured budget knobs
answer ``503`` naming every missing knob (fail-closed: no run starts
unbounded), and a malformed request answers ``422``. Cancellation is the
loop's existing contract: a client disconnect cancels the run's task, the
cancellation reaches the in-flight model call, no terminal event is
emitted, and the lane slot releases on every exit path.

The assembly is lazy and per-process: the stateless adapters, the model
client and the lane are built once on the first run request (the budget
knobs are REQUIRED and fail closed there); the authorization executor is
built per request from the request's trusted caller context.
"""

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import fastapi
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from agent.cancellation import cancel_and_join
from agent.events import AgentEvent, EventKind
from agent.orchestrator import (
    AdmissionRefused,
    AgentRunRequest,
    MissingKnobsError,
    OrchestratorConfig,
    RequestOrchestrator,
    build_preparer_factory,
)
from agent.sources import DocumentToolSource
from agent.version_record import IMPLEMENTATION_VERSION
from assembly import build_stateless_adapters
from capabilities.adapters.httpx import HttpxTransport
from capabilities.adapters.vllm import VllmModelClient
from capabilities.contract import CallerContext
from lane import AdmissionLane
from noagent.config import NoAgentConfig
from tool_catalog import DeclaredSource, budget_overrides, build_tool_source_factory, load_catalog
from tracing import setup_tracing

SERVICE_NAME = "agent-service"

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)

# Traces and metrics go to the collector only when observability is enabled
# (the same single gate the OPEA tier uses).
setup_tracing(SERVICE_NAME)

# The saturation hint the 429 carries: a refused caller may retry after one
# second — the slots turn over with the runs they bound, and the honest
# signal is "busy now", not a queue.
RETRY_AFTER_SECONDS = "1"

_TERMINAL_EVENT_KINDS = frozenset({EventKind.RUN_FINISHED, EventKind.RUN_ERROR})


class RunRequestBody(BaseModel):
    """One run request's body: the question, the agent-phase deadline
    (a REMAINING duration in milliseconds — the orchestrator caps it with
    the deployment ceiling), the trusted caller context the BFF assembled,
    and the optional UI locale the answer is displayed in (the orchestrator
    records it on the usage record; the BFF's translation leg translates
    on the same terms as any answer). No budget value rides the request:
    budgets are server configuration."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)
    deadline_ms: int = Field(gt=0)
    context: CallerContext
    bearer: str | None = None
    language: str | None = Field(default=None, max_length=32)

    @field_validator("question")
    @classmethod
    def _question_is_answerable_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("the question must carry text")
        return value

    @field_validator("language")
    @classmethod
    def _language_is_a_locale_code_or_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


def _build_orchestrator(env=None) -> RequestOrchestrator:
    """The per-process run assembly: the expensive, stateless parts built
    once (adapters, model client, lane, preparation wiring, orchestrator),
    the authorization executor built per request by the port factory.

    :class:`MissingKnobsError` names every required budget knob that is
    missing or unusable; an assembly ``ValueError`` names the knob the
    port-assembly read refused.
    """
    # The environment mapping, normalized once: every read below (the
    # budget knobs, the port assembly, the catalog's path) reads THIS.
    env = os.environ if env is None else env
    # The budget knobs first: they are the fail-closed surface, read
    # before anything else is wired.
    orchestrator_config = OrchestratorConfig.load(env)
    noagent = NoAgentConfig.load(env)
    model_config = noagent.model_config()
    adapters = build_stateless_adapters(env)
    # The tool catalog: the deployment file that decides what a run may
    # call. Read at assembly, fail-closed: a missing file, an unreadable
    # file or a duplicate exposed name is a ValueError, and the run
    # surface answers the honest 503 naming it. An ENTRY this deployment
    # cannot serve costs the ENTRY, not the service — the tool is absent,
    # and the catalog's other tools keep working. The knob is a PATH (the
    # deployment's file lives wherever the deployment mounts it).
    catalog_path = str(env.get("AGENT_TOOL_CATALOG_PATH", "")).strip()
    if not catalog_path:
        raise ValueError("AGENT_TOOL_CATALOG_PATH is not set: the run surface declares no tool without a catalog")
    catalog = load_catalog(
        catalog_path,
        served_names={DocumentToolSource.source_id: DocumentToolSource.served_tool_names},
        ceiling=orchestrator_config.operation_budget,
    )
    transport = HttpxTransport(model_config.tls_verify)
    model_client = VllmModelClient(model_config, transport)
    lane = AdmissionLane.from_config(noagent)
    # The preparation wiring (the preparation module): one per-run
    # preparer over the run's budget monitor; the discovery caches are
    # process-wide.
    preparer_factory = build_preparer_factory(transport, env=env)

    def port_factory(context: CallerContext, bearer: str | None):
        # Per request: one executor binds ONE trusted context to the
        # shared stateless adapters — the executor is the enforcement
        # point, and its context is the request's.
        return adapters.bind_executor(context, bearer)

    # The declared sources: what this deployment runs, and how each is
    # built. The core composes nothing — it asks this factory per
    # request for the pairs to register.
    declared_sources = (
        DeclaredSource(
            source_id=DocumentToolSource.source_id,
            served_tool_names=DocumentToolSource.served_tool_names,
            build=lambda bundle: DocumentToolSource(
                port_factory,
                bundle.operation_budget,
                budgets=budget_overrides(catalog),
                preparer=bundle.preparer,
                on_preparation_status=bundle.on_preparation_status,
                abstention_sink=bundle.abstention_sink,
            ),
        ),
    )
    tool_source_factory = build_tool_source_factory(catalog=catalog, declared_sources=declared_sources)

    return RequestOrchestrator(
        config=orchestrator_config,
        lane=lane,
        model_client=model_client,
        tool_source_factory=tool_source_factory,
        preparer_factory=preparer_factory,
        metadata_source=adapters.docrepo,
        concept_source=adapters.okf,
    )


_RUNTIME: RequestOrchestrator | None = None


def _runtime() -> RequestOrchestrator:
    """The lazy per-process orchestrator: built on the first run request, so
    the infra-only surface (/health, /ready) never needs the budget knobs."""
    global _RUNTIME
    if _RUNTIME is None:
        _RUNTIME = _build_orchestrator()
    return _RUNTIME


@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    # The flag is logged, not enforced here: the deployment gate is the
    # Compose `deploy.replicas` value (one flag for the whole stack).
    # The run surface carries its own fail-closed reads.
    logger.info(
        "agent service started (AGENT_ENABLED=%s)",
        os.getenv("AGENT_ENABLED", "0"),
    )
    yield


# The app is built from the MODULE attribute, not from a name bound at import
# time: the OpenTelemetry instrumentation replaces `fastapi.FastAPI` when
# setup_tracing() runs, so an app built from the pre-instrumentation binding
# would carry no OTel middleware and would emit no request span at all.
app = fastapi.FastAPI(
    title="GENIE.AI agent service",
    # The single source is the version record's IMPLEMENTATION_VERSION — the
    # same number the run-start handshake stamps on every execution record.
    version=IMPLEMENTATION_VERSION,
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict:
    """Liveness - the process is up and serving."""
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> dict:
    """Readiness - the service can serve. No dependency to be ready for yet."""
    return {"status": "ready", "agent_enabled": os.getenv("AGENT_ENABLED", "0") == "1"}


def _sse_frame(event: AgentEvent) -> str:
    """One seam event as an SSE data frame — the envelope verbatim."""
    return f"data: {event.model_dump_json()}\n\n"


def _usage_frame(record) -> str:
    """The terminal usage record as the stream's own last data frame."""
    return f"data: {json.dumps({'usage_record': record.as_dict()})}\n\n"


async def _run_stream(orchestrator: RequestOrchestrator, request: AgentRunRequest, admit_ctx) -> AsyncIterator[str]:
    """The SEAM stream: every envelope event as it is emitted, then the
    terminal usage record.

    The run executes in its own task so the events can stream while the
    loop works. On every exit path the admission claim releases (the
    ``finally``); a cancellation of THIS generator — the client disconnect —
    cancels the run task, the cancellation reaches the in-flight model
    call through the loop's cancellation hooks, no terminal event is
    emitted, and the ``CancelledError`` propagates untouched.
    """
    events: asyncio.Queue[AgentEvent] = asyncio.Queue()
    run_task = asyncio.ensure_future(orchestrator.run(request, sink=events.put_nowait))
    getter = asyncio.ensure_future(events.get())
    try:
        while True:
            done, _ = await asyncio.wait({run_task, getter}, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                event = getter.result()
                yield _sse_frame(event)
                if event.kind in _TERMINAL_EVENT_KINDS:
                    break
                getter = asyncio.ensure_future(events.get())
            else:
                # The run ended without streaming its terminal event: drain
                # whatever it emitted, then let the run's own ending answer
                # (a cancelled run answers CancelledError — no terminal
                # event, no usage record; a defective run answers its
                # exception).
                getter.cancel()
                while not events.empty():
                    yield _sse_frame(events.get_nowait())
                break
        record = await run_task
        yield _usage_frame(record)
    finally:
        # The admission claim covers the run's whole teardown: the slot is
        # released only once the cancelled run has finished unwinding —
        # freeing it earlier would admit the successor run while the dying
        # run's work is still in flight.
        await cancel_and_join(run_task)
        # The getter future: cancelled here too, or a client disconnect
        # mid-stream (GeneratorExit at the yield while a re-armed getter
        # still awaits the queue) leaves the pending task on the loop
        # forever — one leaked waiter per disconnect, unbounded on the
        # one-replica service. On a done getter (the normal terminal path)
        # the cancel is a no-op.
        getter.cancel()
        await admit_ctx.__aexit__(None, None, None)


@app.post("/v1/runs")
async def runs(body: RunRequestBody):
    """One governed agent run: the SEAM stream over SSE + the terminal
    usage record.

    Admission precedes every stream byte: the claim is taken HERE, so a
    saturated lane answers ``429`` before any stage runs, and unconfigured
    budget knobs answer ``503`` naming the knobs — no run starts unbounded.
    """
    try:
        runtime = _runtime()
    except MissingKnobsError as missing:
        logger.warning("run refused: %s", missing)
        return JSONResponse(
            {
                "error": "budget_configuration_missing",
                "message": str(missing),
                "missing_knobs": list(missing.knobs),
            },
            status_code=503,
        )
    except ValueError as unconfigured:
        # The port assembly's own fail-closed reads (the doc-repo /
        # okf-server base URLs, the TEI endpoints the search capability
        # requires) — every assembly defect in this component raises
        # ValueError with the knob named. Same honest 503, a distinct code.
        logger.warning("run refused: %s", unconfigured)
        return JSONResponse(
            {"error": "run_surface_unconfigured", "message": str(unconfigured)},
            status_code=503,
        )
    admit_ctx = runtime.admit()
    try:
        await admit_ctx.__aenter__()
    except AdmissionRefused as refused:
        logger.info("run refused at the admission lane: %s", refused)
        return JSONResponse(
            {"error": "admission_refused", "message": str(refused)},
            status_code=429,
            headers={"Retry-After": RETRY_AFTER_SECONDS},
        )
    try:
        request = AgentRunRequest(
            question=body.question,
            deadline_ms=body.deadline_ms,
            context=body.context,
            bearer=body.bearer,
            language=body.language,
        )
        return StreamingResponse(
            _run_stream(runtime, request, admit_ctx),
            media_type="text/event-stream",
        )
    except BaseException:
        # Between the claim and the stream start no generator owns the
        # release yet — a failure here (request assembly, response
        # construction) must release the slot itself, never leak it.
        await admit_ctx.__aexit__(None, None, None)
        raise
