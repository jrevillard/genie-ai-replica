# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The bounded smoke probe — the pre-decision evidence producer.

SMOKE, not production: the provisional custom minimal loop runs on the seam
with a small toolset (``search_knowledge`` + ``read_source`` over the
document capability port) and ONE multi-hop question, and the run leaves one
comparable evidence record — runtime id, toolset, question id, outcome,
step/model/tool call counts, wall clock, token usage as served. The other
runtime candidates run the same probe shape, and the runtime decision
compares the records.

Every number here is a smoke bound, never a threshold decision: the probe
budget values exist so a runaway model call cannot burn a GPU node during a
smoke run. The real budgets are a deployment decision, owned by the
request orchestrator.

The model client mirrors the component's recorded conventions
(``noagent.generation``: non-streaming, the fixed sampling params,
``/v1/models`` discovery with the ``VLLM_LLM_MODEL_ID`` override) and is
SHARED with the run surface: the request orchestrator reuses the same
client class and the same port assembly (one model client, one port
assembly), so a governed run and the probe measure the same endpoint and
payload rules. The production client still belongs to whichever runtime
the decision selects.

The probe itself runs IN-PROCESS; the HTTP surface for governed runs is
the run surface (``app.py``, story 2.3). Live entry::

    python -m agent.probe

which assembles the real port from the environment (the knobs the adapters
already read, plus ``AGENT_DOCREPO_URL``, ``AGENT_OKF_URL``,
``AGENT_AUTHORIZED_GRAPHS``, optional ``AGENT_AUTHORIZED_REPOS`` as
``repo_id:graph_name`` pairs and ``AGENT_PROBE_BEARER``) and runs the
question against ``VLLM_ENDPOINT``.
"""

import asyncio
import json
import logging
import math
import os
import uuid
from dataclasses import asdict, dataclass

from pydantic import TypeAdapter

from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.env_config import ArangoConfig
from capabilities.adapters.okf import OkfAdapter
from capabilities.contract import (
    AuthorizedRepo,
    CallerContext,
    DocumentCapabilityPort,
    OperationBudget,
    PreparedQuery,
    QueryPreparationStatus,
    ReadSourceInput,
    SearchKnowledgeInput,
    SourceRef,
)
from capabilities.executor import AuthorizedExecutor
from capabilities.search_knowledge import SearchKnowledgeCapability
from noagent.config import NoAgentConfig
from noagent.generation import RECORDED_SAMPLING_PARAMS, chat_choice, chat_choice_content, resolve_window_tokens
from preparation.translation import HttpxTransport

from .budget import RunBudget, RunBudgetMonitor
from .cancellation import CancellationToken
from .events import EventEmitter
from .loop import (
    OUTCOME_ANSWERED,
    OUTCOME_CANCELLED,
    AgentLoop,
    LoopModelClient,
    ModelTurn,
    ToolCallRequest,
)
from .registry import ToolDefinition, ToolRegistry

logger = logging.getLogger(__name__)

# The one-call output-budget arithmetic — the deployed estimate the answer
# translator runs over the same endpoint family (``noagent.pipeline``):
# the prompt is estimated at 4 chars/token (+20 offset), the room is the
# window minus that estimate minus 128 safety tokens, and a ``max_tokens``
# larger than the room would make vLLM reject the call outright
# ("prompt + max_tokens exceeds the context window"). Matched values, one
# comment home each — the translation leg owns the translation-shaped
# copies, this client the generation-shaped one.
MODEL_CHARS_PER_TOKEN_ESTIMATE = 4
MODEL_PROMPT_OFFSET_TOKENS = 20
MODEL_INPUT_SAFETY_TOKENS = 128

RUNTIME_ID = "custom-minimal-loop"
"""The provisional candidate's runtime id — the field the runtime decision compares on."""

QUESTION_ID = "probe-multihop-001"
TOOLSET = ("search_knowledge", "read_source")

PROBE_SYSTEM_PROMPT = (
    "You answer questions about the user's authorized document corpus using the provided tools. "
    "Search the corpus first; read a source before you rely on it. Answer in English. "
    "If the corpus does not contain the answer, say so explicitly instead of inventing one."
)

PROBE_QUESTION = (
    "What do the knowledge-base documents say about the documented process for handling user "
    "complaints, and which source document defines that process?"
)

# The smoke bounds: enough steps for search → read → answer, enough wall
# clock for several 180 s model calls — and nothing more. The token and
# evidence bounds derive from the same arithmetic (8 model calls inside the
# 65536-token window cannot legitimately spend more than 8 × 65536 tokens;
# 8 tool results at the 64 KiB truncation bound cannot exceed 8 × 65536
# bytes). No retry exists: a transient model failure ends the run, which
# stops honestly with its evidence like any other bound.
PROBE_RUN_BUDGET = RunBudget(
    max_steps=8,
    max_model_calls=8,
    max_tool_calls=8,
    max_total_tokens=524288,
    max_evidence_bytes=524288,
    wall_clock_seconds=600.0,
)

# The per-tool-call smoke bound (the port's OperationBudget: the executor
# truncates results to these limits — result size is a declared limit with
# truncate-and-flag semantics, not a hint).
PROBE_OPERATION_BUDGET = OperationBudget(timeout_ms=120000, max_results=8, max_result_bytes=65536)


@dataclass(frozen=True)
class ProbeEvidence:
    """One probe run's comparable record — the fields the runtime decision compares.

    A cancelled run still produces its record: the partial counts and the
    wall clock come from the run's budget monitor, and the outcome says
    ``cancelled`` honestly (the loop itself emits no terminal event for a
    cancellation).
    """

    runtime_id: str
    toolset: tuple[str, ...]
    question_id: str
    outcome: str
    steps: int
    model_calls: int
    tool_calls: int
    wall_clock_seconds: float
    prompt_tokens: int | None
    completion_tokens: int | None
    error: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


async def run_probe(
    *,
    port: DocumentCapabilityPort,
    context: CallerContext,
    model_client: LoopModelClient,
    question: str = PROBE_QUESTION,
    question_id: str = QUESTION_ID,
    run_budget: RunBudget = PROBE_RUN_BUDGET,
    operation_budget: OperationBudget = PROBE_OPERATION_BUDGET,
    token: CancellationToken | None = None,
) -> ProbeEvidence:
    """Run the one multi-hop question on the seam; return the evidence record.

    ``CancelledError`` is caught HERE, at the harness boundary, to record
    the cancellation — inside the loop it propagated untouched, and no
    terminal event was emitted for it. Every other terminal outcome arrives
    as the loop's :class:`RunResult`. The probe carries NO verification
    pipeline (the loop's ``verifier`` stays ``None``): the smoke harness
    measures the loop, not the citation verdict — the governed run surface
    is the one that always verifies.
    """
    monitor = RunBudgetMonitor(run_budget)
    token = token if token is not None else CancellationToken()
    registry = document_toolset(port, context, operation_budget)
    emitter = EventEmitter(run_id=f"probe-{uuid.uuid4().hex}")
    loop = AgentLoop(
        model=model_client,
        registry=registry,
        monitor=monitor,
        token=token,
        emitter=emitter,
        system_prompt=PROBE_SYSTEM_PROMPT,
    )

    def _record(
        outcome: str,
        *,
        steps: int,
        model_calls: int,
        tool_calls: int,
        wall_clock_seconds: float,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        error: str | None = None,
    ) -> ProbeEvidence:
        """One evidence record: the run identity is the probe's, the counts are the run's."""
        return ProbeEvidence(
            runtime_id=RUNTIME_ID,
            toolset=TOOLSET,
            question_id=question_id,
            outcome=outcome,
            steps=steps,
            model_calls=model_calls,
            tool_calls=tool_calls,
            wall_clock_seconds=wall_clock_seconds,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            error=error,
        )

    try:
        result = await loop.run(question)
    except asyncio.CancelledError:
        # The loop's RunResult never exists on this path; the monitor's
        # partial counts are the honest record.
        return _record(
            OUTCOME_CANCELLED,
            steps=monitor.steps,
            model_calls=monitor.model_calls,
            tool_calls=monitor.tool_calls,
            wall_clock_seconds=monitor.elapsed_seconds,
            prompt_tokens=None,
            completion_tokens=None,
        )
    return _record(
        result.outcome,
        steps=result.steps,
        model_calls=result.model_calls,
        tool_calls=result.tool_calls,
        wall_clock_seconds=result.wall_clock_seconds,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        error=result.error,
    )


def document_toolset(
    port: DocumentCapabilityPort,
    context: CallerContext,
    operation_budget: OperationBudget,
) -> ToolRegistry:
    """The probe's small toolset: search + read, executors bound to the port.

    The executors adapt the model-generated JSON arguments into the
    contract's input types — a ``PreparedQuery`` with
    ``passthrough_english`` (the probe question is English by
    construction, so no preparation call is needed) and a ``SourceRef`` —
    and carry the fixed ``CallerContext``. The narrowing travels in the
    context, never in the arguments, so nothing the model contributes can
    widen the scope; the port stays the only corpus access. An
    argument the contract refuses (a missing query, a malformed target)
    raises ``ValidationError``, which the loop feeds back as the
    structured tool result.
    """
    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="search_knowledge",
            description=(
                "Search the authorized knowledge corpus. Returns ranked passages with their provenance, "
                "or an explicit insufficient-evidence outcome."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The English search query."},
                },
                "required": ["query"],
            },
        ),
        _make_search_executor(port, context, operation_budget),
    )
    registry.register(
        ToolDefinition(
            name="read_source",
            description=(
                "Read one source the search results pointed at. A legacy document is addressed by its "
                'file_id ("target": {"file_id": ...}); an OKF concept by repo_id and concept_id '
                '("target": {"repo_id": ..., "concept_id": ...}).'
            ),
            parameters={
                "type": "object",
                "properties": {
                    "target": {
                        "type": "object",
                        "description": 'Either {"file_id": ...} or {"repo_id": ..., "concept_id": ...}.',
                    },
                },
                "required": ["target"],
            },
        ),
        _make_read_executor(port, context, operation_budget),
    )
    return registry


def _make_search_executor(port: DocumentCapabilityPort, context: CallerContext, budget: OperationBudget):
    async def execute(arguments: dict) -> dict:
        query = PreparedQuery(
            text=arguments.get("query"), preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH
        )
        result = await port.search_knowledge(context, SearchKnowledgeInput(query=query), budget)
        return result.model_dump(mode="json")

    return execute


def _make_read_executor(port: DocumentCapabilityPort, context: CallerContext, budget: OperationBudget):
    _source_ref = TypeAdapter(SourceRef)

    async def execute(arguments: dict) -> dict:
        target = _source_ref.validate_python(arguments.get("target"))
        result = await port.read_source(context, ReadSourceInput(target=target), budget)
        return result.model_dump(mode="json")

    return execute


@dataclass(frozen=True)
class ProbeConfig:
    """The probe's env knobs — the model leg plus the live-port assembly.

    The window tiers (``window_override_tokens`` / ``fallback_window_tokens``)
    ride along because the model client caps the per-call output bound to
    what one call can serve against the window the endpoint serves.
    """

    generation_endpoint: str
    model_id_override: str
    bearer: str | None
    probe_bearer: str | None
    tls_verify: bool
    llm_timeout_seconds: float
    probe_timeout_seconds: float
    docrepo_url: str
    okf_url: str
    authorized_graphs: str
    authorized_repos: str
    user_bearer: str | None
    window_override_tokens: int
    fallback_window_tokens: int

    @classmethod
    def load(cls, env=None) -> "ProbeConfig":
        # The model-leg knobs are the deployed generation config's, read
        # through ITS loader (NoAgentConfig): the endpoint resolution rule,
        # the model-id override, the discovery bearer and TLS posture, the
        # tolerant timeout reads and the window tiers have one home, so the
        # probe measures the same endpoint and payload rules the deployment
        # serves.
        noagent = NoAgentConfig.load(env)
        source = os.environ if env is None else env
        return cls(
            generation_endpoint=noagent.generation_endpoint,
            model_id_override=noagent.model_id_override,
            # The generation leg diverges from the recorded bearer on
            # purpose: NoAgentConfig.bearer is OPENAI_API_KEY only, but an
            # in-process probe run inherits the operator's shell, not the
            # compose mapping that fills OPENAI_API_KEY FROM VLLM_API_KEY —
            # the canonical venue carries only the GPU-node key.
            bearer=source.get("OPENAI_API_KEY") or source.get("VLLM_API_KEY"),
            probe_bearer=noagent.probe_bearer,
            tls_verify=noagent.tls_verify,
            llm_timeout_seconds=noagent.llm_timeout_seconds,
            probe_timeout_seconds=noagent.probe_timeout_seconds,
            docrepo_url=str(source.get("AGENT_DOCREPO_URL", "")),
            okf_url=str(source.get("AGENT_OKF_URL", "")),
            authorized_graphs=str(source.get("AGENT_AUTHORIZED_GRAPHS", "")),
            authorized_repos=str(source.get("AGENT_AUTHORIZED_REPOS", "")),
            user_bearer=source.get("AGENT_PROBE_BEARER"),
            window_override_tokens=noagent.window_override_tokens,
            fallback_window_tokens=noagent.fallback_window_tokens,
        )


class ProbeTransientError(RuntimeError):
    """The model endpoint failed transiently or answered a shape the probe
    cannot read; the run fails instead of fabricating. ``CancelledError``
    never becomes one — it propagates untouched."""


class ProbeModelClient:
    """The OpenAI-compatible model client (a ``LoopModelClient``), shared by
    the probe and the run surface.

    Mirrors the recorded generation conventions — non-streaming, the fixed
    sampling params, model discovery from ``/v1/models`` with the
    ``VLLM_LLM_MODEL_ID`` override — over the injected transport (the same
    seam ``PreparationFakeTransport`` answers in tests). One client per
    process; the discovered model id is resolved once.
    """

    def __init__(self, config: ProbeConfig, transport=None):
        self._config = config
        self._transport = transport if transport is not None else HttpxTransport(config.tls_verify)
        self._model_id: str | None = None
        self._discovered_window: int | None = None
        self._window: int | None = None

    async def _resolve_model_id(self) -> str:
        if self._config.model_id_override:
            return self._config.model_id_override
        if self._model_id is None:
            url = f"{self._config.generation_endpoint}/v1/models"
            headers = {"Authorization": f"Bearer {self._config.probe_bearer}"} if self._config.probe_bearer else {}
            try:
                status, body = await self._transport.get_json(url, headers, self._config.probe_timeout_seconds)
            except Exception as e:  # noqa: BLE001 — every discovery failure is transient
                raise ProbeTransientError(f"the model discovery failed: {type(e).__name__}: {str(e)[:200]}") from e
            if status >= 400:
                raise ProbeTransientError(f"the model discovery answered {status}: {str(body)[:200]}")
            data = body.get("data") if isinstance(body, dict) else None
            entry = data[0] if data and isinstance(data[0], dict) else None
            if not entry or not entry.get("id"):
                raise ProbeTransientError("the model discovery carried no model id")
            self._model_id = str(entry["id"])
            # The same probe serves the window the one-call cap is anchored
            # on; a garbage or absent value falls to the configured tier.
            discovered = entry.get("max_model_len")
            if isinstance(discovered, int) and discovered > 0:
                self._discovered_window = discovered
        return self._model_id

    async def _window_tokens(self) -> int:
        """The window one call must fit — the deployed three tiers of
        :func:`noagent.generation.resolve_window_tokens`, resolved once per
        client like the model id; the probed tier is this client's own
        single-discovery capture."""
        if self._window is None:
            await self._resolve_model_id()  # idempotent; runs the probe when no override
            self._window = resolve_window_tokens(self._config, self._discovered_window)
        return self._window

    async def complete(
        self, messages: list[dict], tool_definitions: tuple[dict, ...], *, max_output_tokens: int | None
    ) -> ModelTurn:
        """One non-streaming tool-calling completion, or a typed failure.

        ``max_output_tokens`` rides the request as ``max_tokens`` when the
        caller has a bound to state — omitted otherwise (the deployed
        only-when-configured rule). The bound is capped to what ONE call
        can serve: the run-level allowance may exceed the endpoint's
        window, and a ``max_tokens`` beyond the window makes vLLM reject
        the call outright — so the bound sent is the smaller of the
        allowance and the window room. An oversized prompt (room <= 0)
        omits the field and fails honestly on its own.
        """
        model_id = await self._resolve_model_id()
        payload = {
            "model": model_id,
            "messages": messages,
            **RECORDED_SAMPLING_PARAMS,
        }
        if tool_definitions:
            # Tool-shaped only when there are tools to declare: an empty
            # `tools: []` is not portable across OpenAI-compatible
            # endpoints (several validators reject it with 400), and the
            # aux callers (the grounding judge) legitimately speak without
            # a toolset.
            payload["tools"] = list(tool_definitions)
            payload["tool_choice"] = "auto"
        if max_output_tokens is not None:
            window = await self._window_tokens()
            input_tokens = math.ceil(
                (len(json.dumps(messages)) + MODEL_PROMPT_OFFSET_TOKENS) / MODEL_CHARS_PER_TOKEN_ESTIMATE
            )
            room = window - input_tokens - MODEL_INPUT_SAFETY_TOKENS
            if room > 0:
                payload["max_tokens"] = min(max_output_tokens, room)
        url = f"{self._config.generation_endpoint}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self._config.bearer}"} if self._config.bearer else {}
        try:
            status, body = await self._transport.post_json(url, headers, payload, self._config.llm_timeout_seconds)
        except Exception as e:  # noqa: BLE001 — every transport failure is transient
            raise ProbeTransientError(f"the generation call failed: {type(e).__name__}: {str(e)[:200]}") from e
        if status >= 400:
            raise ProbeTransientError(f"the generation endpoint answered {status}: {str(body)[:200]}")
        if not isinstance(body, dict):
            raise ProbeTransientError(f"the generation endpoint answered a {type(body).__name__}, not an object")
        choice, finish_reason = chat_choice(body)
        if choice is None:
            raise ProbeTransientError("the generation response carries no choice")
        message = choice.get("message") or {}
        content = chat_choice_content(choice)
        return ModelTurn(
            content=content if isinstance(content, str) else None,
            tool_calls=self._parse_tool_calls(message.get("tool_calls")),
            finish_reason=finish_reason,
            prompt_tokens=self._usage_field(body, "prompt_tokens"),
            completion_tokens=self._usage_field(body, "completion_tokens"),
        )

    @staticmethod
    def _parse_tool_calls(raw) -> tuple[ToolCallRequest, ...]:
        if not raw:
            return ()
        if not isinstance(raw, list):
            raise ProbeTransientError("the generation response carries malformed tool calls")
        requests = []
        for entry in raw:
            if not isinstance(entry, dict) or not isinstance(entry.get("function"), dict):
                raise ProbeTransientError("the generation response carries malformed tool calls")
            function = entry["function"]
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except (TypeError, ValueError) as error:
                raise ProbeTransientError(f"the tool-call arguments are not valid JSON: {error}") from error
            if not isinstance(arguments, dict):
                raise ProbeTransientError("the tool-call arguments are not a JSON object")
            # An absent id is a response-shape defect, not a tolerable one:
            # the loop echoes the id back as tool_call_id on the follow-up
            # request, and a strict OpenAI-compatible server (vLLM validates
            # tool-call ids) would reject the shared-empty-id turn. Failing
            # the probe here names the defect instead of disguising it.
            if not entry.get("id"):
                raise ProbeTransientError("a tool call carries no id; the endpoint's response shape is malformed")
            requests.append(
                ToolCallRequest(
                    call_id=str(entry["id"]),
                    name=str(function.get("name") or ""),
                    arguments=arguments,
                )
            )
        return tuple(requests)

    @staticmethod
    def _usage_field(body: dict, name: str) -> int | None:
        usage = body.get("usage")
        if isinstance(usage, dict) and isinstance(usage.get(name), int):
            return usage[name]
        return None


@dataclass(frozen=True)
class StatelessAdapters:
    """The stateless half of the port assembly: the read adapters and the
    inner search port, built ONCE per process and shared by every request
    (the executor that binds a caller context to them is per request)."""

    docrepo: DocRepoAdapter
    okf: OkfAdapter
    chunks: LegacyChunkAdapter
    search_port: DocumentCapabilityPort
    legacy_graph_name: str

    def bind_executor(self, context: CallerContext, bearer: str | None) -> AuthorizedExecutor:
        """The per-request executor: one trusted context bound to the five
        shared fields — the ONE place the binding lives (the probe's live
        entry and the run surface's port factory both call it)."""
        return AuthorizedExecutor(
            context,
            bearer=bearer,
            legacy_graph_name=self.legacy_graph_name,
            docrepo=self.docrepo,
            okf=self.okf,
            chunks=self.chunks,
            search_port=self.search_port,
        )


def build_stateless_adapters(config: ProbeConfig, env=None) -> StatelessAdapters:
    """Assemble the stateless adapters from the environment.

    The search capability wires itself from the recorded knobs (a missing
    TEI endpoint is its own boot error); doc-repo and okf-server need their
    base URLs. Shared by the probe and the run surface — one port
    assembly, so a governed run reads the same corpus the probe measures.
    """
    if not config.docrepo_url:
        raise ValueError("AGENT_DOCREPO_URL must be set for the port assembly (doc-repo base URL)")
    if not config.okf_url:
        raise ValueError("AGENT_OKF_URL must be set for the port assembly (okf-server base URL)")
    arango_config = ArangoConfig.load(env)
    search = SearchKnowledgeCapability.create(env)

    # The ArangoDB driver stays a call-time import: it is the one heavy
    # dependency only a live assembly needs, and keeping it off the module
    # import path keeps importing the seam (loop/budget/events consumers)
    # free of it.
    import arango

    client = arango.ArangoClient(hosts=arango_config.url)

    def db_factory():
        return client.db(
            arango_config.database,
            username=arango_config.username,
            password=arango_config.password,
        )

    return StatelessAdapters(
        docrepo=DocRepoAdapter(config.docrepo_url),
        okf=OkfAdapter(config.okf_url),
        chunks=LegacyChunkAdapter(db_factory),
        search_port=search,
        legacy_graph_name=arango_config.graph_name,
    )


def build_port(config: ProbeConfig, env=None) -> tuple[DocumentCapabilityPort, CallerContext]:
    """Assemble the real port and its caller context from the environment.

    The authorized graph set is the probe caller's scope; the executor
    enforces that set — this is the same authorization path a request
    takes, with the probe as the caller.
    """
    graphs = tuple(graph.strip() for graph in config.authorized_graphs.split(",") if graph.strip())
    if not graphs:
        raise ValueError(
            "AGENT_AUTHORIZED_GRAPHS must be set for a live probe "
            "(comma-separated graph names the probe caller may read)"
        )
    repos = []
    for pair in config.authorized_repos.split(","):
        pair = pair.strip()
        if not pair:
            continue
        repo_id, _, graph_name = pair.partition(":")
        if not repo_id or not graph_name:
            raise ValueError(f"AGENT_AUTHORIZED_REPOS entries are repo_id:graph_name pairs, got {pair!r}")
        repos.append((repo_id, graph_name))

    context = CallerContext(
        user_id="probe-smoke",
        authorized_graph_names=graphs,
        authorized_repos=tuple(AuthorizedRepo(repo_id=repo_id, graph_name=graph_name) for repo_id, graph_name in repos),
    )
    adapters = build_stateless_adapters(config, env)
    return adapters.bind_executor(context, config.user_bearer), context


def _main() -> int:
    """The live smoke entry: one question, one evidence record, printed as JSON."""
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = ProbeConfig.load()
    port, context = build_port(config)
    model_client = ProbeModelClient(config)
    evidence = asyncio.run(run_probe(port=port, context=context, model_client=model_client))
    print(json.dumps(evidence.as_dict(), indent=2))
    return 0 if evidence.outcome == OUTCOME_ANSWERED else 1


if __name__ == "__main__":
    raise SystemExit(_main())
