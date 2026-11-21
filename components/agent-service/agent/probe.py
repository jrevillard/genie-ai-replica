# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The bounded smoke probe — the pre-decision evidence producer (story 2.1, AD-5).

SMOKE, not production: the provisional custom minimal loop runs on the seam
with a small toolset (``search_knowledge`` + ``read_source`` over the story
1.5 port) and ONE multi-hop question, and the run leaves one comparable
evidence record — runtime id, toolset, question id, outcome, step/model/tool
call counts, wall clock, token usage as served. Story 2.2 points the other
D03 candidates at the same probe shape, and V06 compares the records.

Every number here is a smoke bound, never a threshold decision: the probe
budget values exist so a runaway model call cannot burn a GPU node during a
smoke run. The real budgets are post-baseline (PRD §8) and belong to the
request orchestrator (story 2.3).

The model client mirrors the component's recorded conventions
(``noagent.generation``: non-streaming, the fixed sampling params,
``/v1/models`` discovery with the ``VLLM_LLM_MODEL_ID`` override) but stays
probe-local — the production client belongs to the selected runtime's story.

The probe runs IN-PROCESS; there is no HTTP surface for the agent loop
(request orchestration/admission is story 2.3, the BFF stream contract is
story 2.4). Live entry::

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
import os
import uuid
from dataclasses import asdict, dataclass

from pydantic import TypeAdapter

from capabilities.adapters.chunks import LegacyChunkAdapter
from capabilities.adapters.docrepo import DocRepoAdapter
from capabilities.adapters.okf import OkfAdapter
from capabilities.contract import (
    CallerContext,
    DocumentCapabilityPort,
    OperationBudget,
    PreparedQuery,
    QueryPreparationStatus,
    ReadSourceInput,
    SearchKnowledgeInput,
    SourceRef,
)
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

RUNTIME_ID = "custom-minimal-loop"
"""The provisional candidate's runtime id — the field V06 compares on."""

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

# The smoke bounds: enough steps for search → read → answer plus model
# retries, enough wall clock for several 180 s model calls — and nothing
# more. A probe that hits one of these stops honestly with its evidence.
PROBE_RUN_BUDGET = RunBudget(max_steps=8, max_model_calls=8, max_tool_calls=8, wall_clock_seconds=600.0)

# The per-tool-call smoke bound (the port's OperationBudget: the executor
# truncates results to these limits — result size is a declared limit with
# truncate-and-flag semantics, not a hint).
PROBE_OPERATION_BUDGET = OperationBudget(timeout_ms=120000, max_results=8, max_result_bytes=65536)


@dataclass(frozen=True)
class ProbeEvidence:
    """One probe run's comparable record — the fields V06 compares.

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
    as the loop's :class:`RunResult`.
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
    try:
        result = await loop.run(question)
    except asyncio.CancelledError:
        return ProbeEvidence(
            runtime_id=RUNTIME_ID,
            toolset=TOOLSET,
            question_id=question_id,
            outcome=OUTCOME_CANCELLED,
            steps=monitor.steps,
            model_calls=monitor.model_calls,
            tool_calls=monitor.tool_calls,
            wall_clock_seconds=monitor.elapsed_seconds,
            prompt_tokens=None,
            completion_tokens=None,
        )
    return ProbeEvidence(
        runtime_id=RUNTIME_ID,
        toolset=TOOLSET,
        question_id=question_id,
        outcome=result.outcome,
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
    registry: ToolRegistry | None = None,
) -> ToolRegistry:
    """The probe's small toolset: search + read, executors bound to the port.

    The executors adapt the model-generated JSON arguments into the
    contract's input types — a ``PreparedQuery`` with
    ``passthrough_english`` (the probe question is English by
    construction, so no preparation call is needed) and a ``SourceRef`` —
    and carry the fixed ``CallerContext``. The narrowing travels in the
    context, never in the arguments, so nothing the model contributes can
    widen the scope (AD-4); the port stays the only corpus access. An
    argument the contract refuses (a missing query, a malformed target)
    raises ``ValidationError``, which the loop feeds back as the
    structured tool result.
    """
    registry = registry if registry is not None else ToolRegistry()
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
    """The probe's env knobs — the model leg plus the live-port assembly."""

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

    @classmethod
    def load(cls, env=None) -> "ProbeConfig":
        source = os.environ if env is None else env
        endpoint = str(source.get("VLLM_LLM_ENDPOINT", "") or source.get("VLLM_ENDPOINT", ""))
        endpoint = endpoint or (
            f"http://{source.get('LLM_SERVER_HOST_IP', '0.0.0.0')}:{source.get('LLM_SERVER_PORT', '80')}"
        )
        return cls(
            generation_endpoint=endpoint,
            model_id_override=str(source.get("VLLM_LLM_MODEL_ID", "")),
            bearer=source.get("OPENAI_API_KEY"),
            probe_bearer=source.get("VLLM_API_KEY"),
            tls_verify=str(source.get("OPEA_SSL_SKIP_VERIFY", "")) != "1",
            llm_timeout_seconds=float(source.get("MODEL_LLM_TIMEOUT_SECONDS", 180.0)),
            probe_timeout_seconds=float(source.get("MODEL_PROBE_TIMEOUT_SECONDS", 10.0)),
            docrepo_url=str(source.get("AGENT_DOCREPO_URL", "")),
            okf_url=str(source.get("AGENT_OKF_URL", "")),
            authorized_graphs=str(source.get("AGENT_AUTHORIZED_GRAPHS", "")),
            authorized_repos=str(source.get("AGENT_AUTHORIZED_REPOS", "")),
            user_bearer=source.get("AGENT_PROBE_BEARER"),
        )


class ProbeTransientError(RuntimeError):
    """The model endpoint failed transiently or answered a shape the probe
    cannot read; the run fails instead of fabricating. ``CancelledError``
    never becomes one — it propagates untouched."""


class ProbeModelClient:
    """The probe-local OpenAI-compatible model client (a ``LoopModelClient``).

    Mirrors the recorded generation conventions — non-streaming, the fixed
    sampling params, model discovery from ``/v1/models`` with the
    ``VLLM_LLM_MODEL_ID`` override — over the injected transport (the same
    seam ``PreparationFakeTransport`` answers in tests). One process, one
    run: the discovered model id is resolved once.
    """

    def __init__(self, config: ProbeConfig, transport=None):
        self._config = config
        self._transport = transport if transport is not None else HttpxTransport(config.tls_verify)
        self._model_id: str | None = None

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
        return self._model_id

    async def complete(self, messages: list[dict], tool_definitions: tuple[dict, ...]) -> ModelTurn:
        """One non-streaming tool-calling completion, or a typed failure."""
        model_id = await self._resolve_model_id()
        payload = {
            "model": model_id,
            "messages": messages,
            "tools": list(tool_definitions),
            "tool_choice": "auto",
            "temperature": 0.01,
            "top_p": 0.95,
            "frequency_penalty": 0.0,
            "stream": False,
        }
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
        choices = body.get("choices") or []
        choice = choices[0] if choices and isinstance(choices[0], dict) else None
        if choice is None:
            raise ProbeTransientError("the generation response carries no choice")
        message = choice.get("message") or {}
        content = message.get("content")
        return ModelTurn(
            content=content if isinstance(content, str) else None,
            tool_calls=self._parse_tool_calls(message.get("tool_calls")),
            finish_reason=choice.get("finish_reason"),
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
            requests.append(
                ToolCallRequest(
                    call_id=str(entry.get("id") or ""),
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


def build_port(config: ProbeConfig, env=None) -> tuple[DocumentCapabilityPort, CallerContext]:
    """Assemble the real port and its caller context from the environment.

    The search capability wires itself from the recorded knobs (a missing
    TEI endpoint is its own boot error); doc-repo and okf-server need their
    base URLs; the authorized graph set is the probe caller's scope. The
    executor enforces that set — this is the same authorization path a
    request takes, with the probe as the caller.
    """
    from capabilities.adapters.env_config import ArangoConfig
    from capabilities.executor import AuthorizedExecutor
    from capabilities.search_knowledge import SearchKnowledgeCapability

    if not config.docrepo_url:
        raise ValueError("AGENT_DOCREPO_URL must be set for a live probe (doc-repo base URL)")
    if not config.okf_url:
        raise ValueError("AGENT_OKF_URL must be set for a live probe (okf-server base URL)")
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

    from capabilities.contract import AuthorizedRepo

    context = CallerContext(
        user_id="probe-smoke",
        authorized_graph_names=graphs,
        authorized_repos=tuple(AuthorizedRepo(repo_id=repo_id, graph_name=graph_name) for repo_id, graph_name in repos),
    )
    arango_config = ArangoConfig.load(env)
    search = SearchKnowledgeCapability.create(env)

    import arango

    client = arango.ArangoClient(hosts=arango_config.url)

    def db_factory():
        return client.db(
            arango_config.database,
            username=arango_config.username,
            password=arango_config.password,
        )

    executor = AuthorizedExecutor(
        context,
        bearer=config.user_bearer,
        legacy_graph_name=arango_config.graph_name,
        docrepo=DocRepoAdapter(config.docrepo_url),
        okf=OkfAdapter(config.okf_url),
        chunks=LegacyChunkAdapter(db_factory),
        search_port=search,
    )
    return executor, context


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
