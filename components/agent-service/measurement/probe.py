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
the run surface (``app.py``). Live entry::

    python -m measurement.probe

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

from agent.budget import RunBudget, RunBudgetMonitor
from agent.cancellation import CancellationToken
from agent.events import EventEmitter
from agent.loop import (
    OUTCOME_ANSWERED,
    OUTCOME_CANCELLED,
    AgentLoop,
)

# The registered toolset is a production surface, not a probe artifact — it
# lives in :mod:`agent.toolset`; the probe re-imports the builder, and the
# name stays importable from here for the probe harness and its suites.
from agent.toolset import document_toolset
from assembly import build_stateless_adapters
from capabilities.adapters.httpx import HttpxTransport
from capabilities.adapters.vllm import VllmModelClient
from capabilities.contract import AuthorizedRepo, CallerContext, DocumentCapabilityPort, OperationBudget
from capabilities.model import (
    LoopModelClient,
)
from noagent.config import NoAgentConfig

logger = logging.getLogger(__name__)

# The one-call output-budget arithmetic — the deployed estimate the answer
# translator runs over the same endpoint family (``noagent.pipeline``):
# the prompt is estimated at 4 chars/token (+20 offset), the room is the
# window minus that estimate minus 128 safety tokens, and a ``max_tokens``
# larger than the room would make vLLM reject the call outright
# ("prompt + max_tokens exceeds the context window"). Matched values, one
# comment home each — the translation leg owns the translation-shaped
# copies, this client the generation-shaped one.

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


@dataclass(frozen=True)
class ProbeConfig:
    """The probe's env knobs — the port assembly's side.

    The model leg travels with the client that reads it
    (``capabilities.adapters.vllm.VllmModelConfig``); what stays here is
    what the probe's own assembly reads: the authorized graphs and repos,
    and the caller's bearer. The corpus endpoints are the assembly's
    business — the host reads them from the environment.
    """

    authorized_graphs: str
    authorized_repos: str
    user_bearer: str | None

    @classmethod
    def load(cls, env=None) -> "ProbeConfig":
        source = os.environ if env is None else env
        return cls(
            authorized_graphs=str(source.get("AGENT_AUTHORIZED_GRAPHS", "")),
            authorized_repos=str(source.get("AGENT_AUTHORIZED_REPOS", "")),
            user_bearer=source.get("AGENT_PROBE_BEARER"),
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
    adapters = build_stateless_adapters(env)
    return adapters.bind_executor(context, config.user_bearer), context


def _main() -> int:
    """The live smoke entry: one question, one evidence record, printed as JSON."""
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = ProbeConfig.load()
    model_config = NoAgentConfig.load().model_config()
    port, context = build_port(config)
    transport = HttpxTransport(model_config.tls_verify)
    model_client = VllmModelClient(model_config, transport)
    evidence = asyncio.run(run_probe(port=port, context=context, model_client=model_client))
    print(json.dumps(evidence.as_dict(), indent=2))
    return 0 if evidence.outcome == OUTCOME_ANSWERED else 1


if __name__ == "__main__":
    raise SystemExit(_main())
