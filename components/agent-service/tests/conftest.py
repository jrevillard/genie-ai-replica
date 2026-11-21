# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Shared test doubles for the adapter suites.

The whole transport surface the HTTP adapters use: one GET, one tuple back.
Imported by the adapter test suites so a change to the fake's surface — say,
recording headers — lands once for every adapter.

The preparation suites share their own doubles here too: the async POST
transport seam (``PreparationFakeTransport``), the model-entry helper, the
V02 locale samples and the detector-seeding fixture — one home, so a
surface or policy change lands once.
"""

import asyncio
from pathlib import Path

import pytest
from langdetect import DetectorFactory

from agent.budget import RunBudget
from agent.orchestrator import OrchestratorConfig
from capabilities.adapters.http import TransportError
from capabilities.contract import OperationBudget, ReadSourceResult, SearchKnowledgeResult


class FakeTransport:
    def __init__(self, status=200, body=None, error=None):
        self.status = status
        self.body = body if body is not None else {}
        self.error = error
        self.calls = []

    def get_json(self, url, bearer, timeout_s):
        self.calls.append({"url": url, "bearer": bearer, "timeout_s": timeout_s})
        if self.error is not None:
            raise TransportError(str(self.error))
        return self.status, self.body


class PreparationFakeTransport:
    """The preparation transport seam: canned (status, body) per URL prefix,
    recorded calls WITH their headers (the bearer contracts are asserted on
    the recorded headers, not taken on faith)."""

    def __init__(self, responses=None, error=None):
        self.responses = responses or {}
        self.error = error
        self.calls = []

    def _answer(self, url, headers=None, payload=None):
        self.calls.append({"url": url, "headers": headers, "payload": payload})
        if self.error is not None:
            raise self.error
        for prefix, answer in self.responses.items():
            if url.startswith(prefix):
                status, body = answer
                if callable(body) and payload is not None:
                    body = body(payload)
                return status, body
        raise AssertionError(f"no canned answer for {url}")

    async def get_json(self, url, headers, timeout_s):
        return self._answer(url, headers)

    async def post_json(self, url, headers, payload, timeout_s):
        return self._answer(url, headers, payload)


def preparation_model_entry(max_model_len=8192, model_id="test-model"):
    """A canned ``/v1/models`` answer shaped the way vLLM serves it."""
    return (
        200,
        {"data": [{"id": model_id, "max_model_len": max_model_len}]},
    )


# The vendored registry's path, resolved once for the suites that point a
# registry at it (the reader-contract and parity suites compute their own
# backend-source path locally).
VENDORED_REGISTRY_PATH = str(Path(__file__).resolve().parents[1] / "preparation" / "language-registry.json")


# The V02 §5.6 sample family (shape reference, not exact wording — the
# detector is non-deterministic and the model sampled).
FRENCH_SAMPLE = (
    "Bonjour, comment la ville de Geneve gere-t-elle les services de "
    "transport public pour les habitants et les visiteurs ?"
)
ARABIC_SAMPLE = "كيف تدير مدينة دبي خدمات النقل العام للسكان والزوار خلال موسم الصيف؟"


@pytest.fixture
def seeded_langdetect():
    """Deterministic detection for the suites that exercise it; production
    stays unseeded (the AST check in the detection suite pins that)."""
    DetectorFactory.seed = 0
    yield


def assert_module_aql_fakes_faithful(module_path: Path) -> None:
    """Every test double named ``execute`` that carries a ``bind_vars``
    parameter must take it where the real driver defines it.

    python-arango's ``AQL.execute`` signature is ``(query, count,
    batch_size, ttl, bind_vars, ...)``: a positional bind dict binds to
    ``count`` and the payload ships no ``bindVars`` at all. A double whose
    second parameter is ``bind_vars`` would accept that same positional
    dict as bind-vars — the exact production defect class the chunk-adapter
    fix closed (a positional call looked correct in tests and broke on the
    first real read) — and stay green. The real signature itself is
    anchored: a driver release that reorders these parameters reddens every
    suite that calls this helper, forcing a re-check of both sides.
    """
    import ast
    import inspect

    from arango.aql import AQL

    real = list(inspect.signature(AQL.execute).parameters)[1:6]
    assert real == ["query", "count", "batch_size", "ttl", "bind_vars"], (
        "the pinned driver's AQL.execute parameter order changed — re-check "
        "every fake aql double against the new signature before proceeding"
    )
    unfaithful = []
    for node in ast.walk(ast.parse(module_path.read_text(encoding="utf-8"))):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "execute":
            args = [a.arg for a in node.args.args]
            if args and args[0] in ("self", "cls"):
                args = args[1:]
            if "bind_vars" not in args:
                continue  # not an AQL double carrying bind vars
            if args[:5] != ["query", "count", "batch_size", "ttl", "bind_vars"]:
                unfaithful.append(f"line {node.lineno}: {args}")
    assert not unfaithful, (
        f"fake aql.execute double(s) would mask a positional bind_vars regression: {'; '.join(unfaithful)}"
    )


def assert_no_positional_aql_execute(package_dir: Path) -> None:
    """Every production ``.aql.execute`` call must pass bind vars by keyword.

    python-arango's ``AQL.execute`` binds its second positional parameter to
    ``count`` (the payload then ships no ``bindVars`` at all), so a
    positional bind dict is a server-side rejection on the first real read.
    The sweep covers both call shapes the component uses: the direct
    ``db.aql.execute(query, bind_vars={...})`` and the ``asyncio.to_thread``
    form, where the bound method rides as an argument and the query is the
    next positional.
    """
    import ast

    offenders = []
    for py in sorted(package_dir.rglob("*.py")):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if (
                isinstance(func, ast.Attribute)
                and func.attr == "execute"
                and isinstance(func.value, ast.Attribute)
                and func.value.attr == "aql"
                and len(node.args) >= 2
            ):
                offenders.append(f"{py.name}:{node.lineno} (direct call)")
            for idx, arg in enumerate(node.args):
                if (
                    isinstance(arg, ast.Attribute)
                    and arg.attr == "execute"
                    and isinstance(arg.value, ast.Attribute)
                    and arg.value.attr == "aql"
                    and len(node.args) - (idx + 1) >= 2
                ):
                    offenders.append(f"{py.name}:{node.lineno} (to_thread form)")
    assert not offenders, (
        "positional bind dict to aql.execute would bind to the driver's count "
        f"parameter (bind_vars must be passed by keyword): {'; '.join(offenders)}"
    )


# -----------------------------------------------------------------------
# The agent loop / probe doubles: the same one-home rule — a
# surface change to the scripted model or the fake port lands once for the
# loop and probe suites together.
# -----------------------------------------------------------------------


class AgentFakePort:
    """The ``DocumentCapabilityPort`` double: canned results, recorded calls.

    An exception instance as a canned result makes the port raise it, so a
    suite can drive the port's raised carriers; any other value (``None``
    included) is returned as-is.
    """

    def __init__(self, search_result: SearchKnowledgeResult | None = None, read_result: ReadSourceResult | None = None):
        self.search_result = search_result
        self.read_result = read_result
        self.search_calls: list[dict] = []
        self.read_calls: list[dict] = []

    async def search_knowledge(self, context, request, budget) -> SearchKnowledgeResult:
        self.search_calls.append({"context": context, "request": request, "budget": budget})
        if isinstance(self.search_result, Exception):
            raise self.search_result
        return self.search_result

    async def read_source(self, context, request, budget) -> ReadSourceResult:
        self.read_calls.append({"context": context, "request": request, "budget": budget})
        if isinstance(self.read_result, Exception):
            raise self.read_result
        return self.read_result


class ScriptedLoopModel:
    """The ``LoopModelClient`` double: canned turns in order, recorded requests.

    Each request is recorded with a copy of the message list and the
    ``max_output_tokens`` bound the loop handed it, so a suite can assert
    what the loop fed the model without the live list mutating under it.
    """

    def __init__(self, turns):
        self._turns = list(turns)
        self.requests: list[dict] = []

    async def complete(self, messages, tool_definitions, *, max_output_tokens):
        self.requests.append(
            {
                "messages": [dict(message) for message in messages],
                "tool_definitions": tool_definitions,
                "max_output_tokens": max_output_tokens,
            }
        )
        if not self._turns:
            raise AssertionError("the scripted model ran out of turns")
        return self._turns.pop(0)


# -----------------------------------------------------------------------
# The cancellation doubles: one home for the hang shape and the
# fire-when-running helper, so a change to the recording convention lands
# once for the cancellation, loop and probe suites together.
# -----------------------------------------------------------------------


def hang_until_cancelled(recorder: dict):
    """A coroutine that hangs until cancelled and records that the
    cancellation REACHED it (it was cancelled, not abandoned)."""

    async def work():
        recorder["started"] = True
        try:
            await asyncio.Event().wait()  # forever
        except asyncio.CancelledError:
            recorder["cancelled_in_flight"] = True
            raise

    return work()


class HangingLoopModel:
    """A ``LoopModelClient`` double whose completion hangs until cancelled."""

    def __init__(self, recorder: dict):
        self._recorder = recorder

    async def complete(self, messages, tool_definitions, *, max_output_tokens):
        await hang_until_cancelled(self._recorder)  # never returns


def cancel_when_started(recorder: dict, token, key: str = "started"):
    """A coroutine that fires the token once the recorded work has started;
    hand it to ``create_task``."""

    async def fire():
        while key not in recorder:
            await asyncio.sleep(0)
        token.cancel()

    return fire()


# -----------------------------------------------------------------------
# The canned-result builders: one home for the scripted search → read →
# answer shapes the loop and probe suites drive over ``AgentFakePort``.
# -----------------------------------------------------------------------


def canned_search_result(*, hits=None, outcome=None, concept=False):
    """A successful search by default; ``concept=True`` swaps the hit's
    provenance to an OKF concept."""
    from capabilities.contract import (
        LegacyFileProvenance,
        OkfConceptProvenance,
        OutcomeCode,
        QueryPreparationStatus,
        SearchHit,
    )

    if hits is None:
        provenance = (
            OkfConceptProvenance(concept_id="c-1", repo_id="r-1", bundle_version=3)
            if concept
            else LegacyFileProvenance(file_id="f-1")
        )
        hits = (SearchHit(provenance=provenance, text="the passage", score=0.9),)
    return SearchKnowledgeResult(
        outcome=outcome or OutcomeCode.SUCCESS,
        hits=hits,
        query_preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH,
    )


def canned_read_result(content="the content"):
    from capabilities.contract import LegacyFileProvenance, OutcomeCode

    return ReadSourceResult(
        outcome=OutcomeCode.SUCCESS,
        provenance=LegacyFileProvenance(file_id="f-1"),
        content=content,
    )


def multihop_turns(answer="the answer"):
    """The probe's script: search → read_source → final answer."""
    from agent.loop import ModelTurn, ToolCallRequest

    return (
        ModelTurn(tool_calls=(ToolCallRequest(call_id="call-1", name="search_knowledge", arguments={"query": "q"}),)),
        ModelTurn(
            tool_calls=(
                ToolCallRequest(call_id="call-2", name="read_source", arguments={"target": {"file_id": "f-1"}}),
            )
        ),
        ModelTurn(content=answer),
    )


# -----------------------------------------------------------------------
# The run-budget builders: one home for the default smoke numbers the
# loop / orchestrator / run-surface suites share — a suite overrides
# exactly the dimension its test pins.
# -----------------------------------------------------------------------

REQUIRED_KNOBS = (
    "AGENT_RUN_MAX_STEPS",
    "AGENT_RUN_MAX_MODEL_CALLS",
    "AGENT_RUN_MAX_TOOL_CALLS",
    "AGENT_RUN_MAX_TOTAL_TOKENS",
    "AGENT_RUN_MAX_EVIDENCE_BYTES",
    "AGENT_RUN_MAX_WALL_CLOCK_SECONDS",
    "AGENT_TOOL_TIMEOUT_MS",
    "AGENT_TOOL_MAX_RESULTS",
    "AGENT_TOOL_MAX_RESULT_BYTES",
)
"""The REQUIRED run-budget knobs the orchestrator reads fail-closed — one
home for the suites that pin the fail-closed surface."""


def run_budget(**overrides) -> RunBudget:
    """The default run budget of the loop/orchestrator suites."""
    values = {
        "max_steps": 6,
        "max_model_calls": 6,
        "max_tool_calls": 6,
        "max_total_tokens": 10000,
        "max_evidence_bytes": 1000000,
        "wall_clock_seconds": 30.0,
    }
    return RunBudget(**{**values, **overrides})


def orchestrator_config(**overrides) -> OrchestratorConfig:
    """The default orchestrator config of the orchestrator/run-surface suites."""
    values = dict(
        max_steps=6,
        max_model_calls=6,
        max_tool_calls=6,
        max_total_tokens=10000,
        max_evidence_bytes=1000000,
        wall_clock_ceiling_seconds=30.0,
        operation_budget=OperationBudget(timeout_ms=1000, max_results=8, max_result_bytes=65536),
        system_prompt="the system prompt",
    )
    return OrchestratorConfig(**{**values, **overrides})


def fake_port() -> AgentFakePort:
    """The canned port: one successful search and one successful read."""
    return AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
