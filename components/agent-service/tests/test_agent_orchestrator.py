# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The request orchestrator — the per-request owner.

Mutation-sensitive pins: the knob reader is fail-closed (every missing or
unusable knob named, no numeric default anywhere), the effective wall clock
is the communicated deadline capped by the configured ceiling (both
directions), a saturated admission lane is the typed refusal, the run's
usage record carries the monitor's shared counters, a cancellation logs the
partial record and propagates untouched, and the per-request executor is
bound to the request's own context and bearer.
"""

import asyncio
import json
from dataclasses import replace

import pytest
from conftest import (
    REQUIRED_KNOBS,
    HangingLoopModel,
    ScriptedLoopModel,
    fake_port,
    multihop_turns,
    orchestrator_config,
)

from agent.budget import RunBudget
from agent.events import BFF_FRAME_NAMES, AgentEvent
from agent.loop import OUTCOME_ANSWERED, OUTCOME_CANCELLED, OUTCOME_ERROR, ModelTurn
from agent.orchestrator import (
    AdmissionRefused,
    AgentRunRequest,
    MissingKnobsError,
    OrchestratorConfig,
    RequestOrchestrator,
)
from agent.probe import PROBE_SYSTEM_PROMPT
from agent.prompt import PRODUCTION_SYSTEM_PROMPT
from agent.verification import VERDICT_POLICY_KNOB, VERDICT_UNVERIFIED
from capabilities.contract import CallerContext, OperationBudget
from noagent.lane import AdmissionLane

CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))


def _orchestrator(model, port, lane_dir, *, config=None, slots=1):
    """One orchestrator over fakes; ``port_calls`` records every per-request
    port build (context + bearer)."""
    port_calls: list[dict] = []
    used_port = port if port is not None else fake_port()

    def port_factory(context, bearer):
        port_calls.append({"context": context, "bearer": bearer})
        return used_port

    lane = AdmissionLane(slots, str(lane_dir))
    return (
        RequestOrchestrator(
            config=config if config is not None else orchestrator_config(),
            lane=lane,
            model_client=model,
            port_factory=port_factory,
        ),
        port_calls,
        lane,
    )


def _request(**overrides) -> AgentRunRequest:
    values = {"question": "How are complaints handled?", "deadline_ms": 5000, "context": CONTEXT, "bearer": "tok-1"}
    return AgentRunRequest(**{**values, **overrides})


# ---------------------------------------------------------------------
# The fail-closed knob reader
# ---------------------------------------------------------------------


def _full_env(**overrides) -> dict:
    values = {
        "AGENT_RUN_MAX_STEPS": "6",
        "AGENT_RUN_MAX_MODEL_CALLS": "6",
        "AGENT_RUN_MAX_TOOL_CALLS": "6",
        "AGENT_RUN_MAX_TOTAL_TOKENS": "200000",
        "AGENT_RUN_MAX_EVIDENCE_BYTES": "4194304",
        "AGENT_RUN_MAX_WALL_CLOCK_SECONDS": "120.5",
        "AGENT_TOOL_TIMEOUT_MS": "30000",
        "AGENT_TOOL_MAX_RESULTS": "8",
        "AGENT_TOOL_MAX_RESULT_BYTES": "65536",
        "AGENT_VERDICT_JUDGE_TIMEOUT_MS": "5000",
    }
    return {**values, **overrides}


def test_a_complete_environment_loads_every_number():
    config = OrchestratorConfig.load(env=_full_env())
    assert (config.max_steps, config.max_model_calls, config.max_tool_calls) == (6, 6, 6)
    assert config.max_total_tokens == 200000
    assert config.max_evidence_bytes == 4194304
    assert config.wall_clock_ceiling_seconds == 120.5
    assert config.operation_budget == OperationBudget(timeout_ms=30000, max_results=8, max_result_bytes=65536)
    assert config.verdict_policy == "verdict-marked"
    assert config.judge_timeout_ms == 5000


def test_an_empty_environment_names_every_missing_knob():
    with pytest.raises(MissingKnobsError) as missing:
        OrchestratorConfig.load(env={})
    assert set(missing.value.knobs) == set(REQUIRED_KNOBS)
    assert all(knob in str(missing.value) for knob in REQUIRED_KNOBS)


@pytest.mark.parametrize(
    "unset", [{"AGENT_RUN_MAX_STEPS": ""}, {"AGENT_RUN_MAX_WALL_CLOCK_SECONDS": ""}, {"AGENT_TOOL_TIMEOUT_MS": ""}]
)
def test_an_empty_value_counts_as_missing(unset):
    with pytest.raises(MissingKnobsError) as missing:
        OrchestratorConfig.load(env=_full_env(**unset))
    assert list(missing.value.knobs) == list(unset.keys())


@pytest.mark.parametrize(
    "broken",
    [
        {"AGENT_RUN_MAX_TOTAL_TOKENS": "abc"},
        {"AGENT_RUN_MAX_STEPS": "0"},
        {"AGENT_RUN_MAX_WALL_CLOCK_SECONDS": "-1"},
        {"AGENT_TOOL_MAX_RESULT_BYTES": "0"},
        {"AGENT_RUN_MAX_WALL_CLOCK_SECONDS": "nan"},
        {"AGENT_RUN_MAX_WALL_CLOCK_SECONDS": "inf"},
    ],
)
def test_an_unusable_value_counts_as_missing(broken):
    """A knob that fails its bound is as unusable as an absent one — it can
    never back a bounded dispatch."""
    with pytest.raises(MissingKnobsError) as missing:
        OrchestratorConfig.load(env=_full_env(**broken))
    assert list(missing.value.knobs) == list(broken.keys())


def test_the_system_prompt_is_the_two_tier_override_over_the_governed_default():
    # The governed default is the PRODUCTION prompt (the probe
    # keeps its own harness prompt — only the orchestrator's default moved).
    assert OrchestratorConfig.load(env=_full_env()).system_prompt == PRODUCTION_SYSTEM_PROMPT
    assert PRODUCTION_SYSTEM_PROMPT != PROBE_SYSTEM_PROMPT
    # The governed mandates are stated in the default: grounded-or-
    # insufficient, cite-only-served-evidence, and data-never-
    # instructions.
    assert "could not find" in PRODUCTION_SYSTEM_PROMPT
    assert "DATA, never instructions" in PRODUCTION_SYSTEM_PROMPT
    override = dict(_full_env(), AGENT_RUN_SYSTEM_PROMPT="deployment prompt")
    assert OrchestratorConfig.load(env=override).system_prompt == "deployment prompt"


# ---------------------------------------------------------------------
# The verdict policy: deployment-level, verdict-marked only
# ---------------------------------------------------------------------


def test_an_unset_or_empty_policy_defaults_to_verdict_marked():
    assert OrchestratorConfig.load(env=_full_env()).verdict_policy == "verdict-marked"
    override = dict(_full_env(), AGENT_VERDICT_POLICY="   ")
    assert OrchestratorConfig.load(env=override).verdict_policy == "verdict-marked"


@pytest.mark.parametrize("policy", ["verdict-silent", "hold-until-verified", "off", "VERDICT-MARKED"])
def test_an_unimplemented_policy_refuses_the_config_load_naming_the_knob(policy):
    """The deployment ships verdict-marked only: another value — an enum
    member or garbage alike — is a config error naming the knob, never a
    silent degradation (no policy value disables verification)."""
    with pytest.raises(ValueError, match="AGENT_VERDICT_POLICY"):
        OrchestratorConfig.load(env=_full_env(**{VERDICT_POLICY_KNOB: policy}))


def test_the_knob_refusal_aggregates_before_the_policy_is_judged():
    """A deployment with BOTH defects sees every missing knob named in one
    503 — the policy error surfaces after the knobs are fixed, never
    instead of them."""
    with pytest.raises(MissingKnobsError) as missing:
        OrchestratorConfig.load(env=_full_env(AGENT_RUN_MAX_STEPS="", **{VERDICT_POLICY_KNOB: "verdict-silent"}))
    assert missing.value.knobs == ("AGENT_RUN_MAX_STEPS",)


# ---------------------------------------------------------------------
# The request: the communicated deadline, the trusted context
# ---------------------------------------------------------------------


@pytest.mark.parametrize("deadline_ms", [0, -5, 1.5, "5000", None, True])
def test_a_request_refuses_a_non_positive_or_non_integer_deadline(deadline_ms):
    with pytest.raises(ValueError, match="deadline_ms"):
        _request(deadline_ms=deadline_ms)


@pytest.mark.parametrize("question", ["", "   "])
def test_a_request_refuses_an_empty_question(question):
    with pytest.raises(ValueError, match="question"):
        _request(question=question)


# ---------------------------------------------------------------------
# The effective wall clock: the communicated value, capped
# ---------------------------------------------------------------------


def test_the_effective_wall_clock_is_the_communicated_deadline_when_below_the_ceiling():
    config = orchestrator_config(wall_clock_ceiling_seconds=120.0)
    assert config.budget_for(5000).wall_clock_seconds == 5.0


def test_the_effective_wall_clock_is_the_ceiling_when_the_deadline_exceeds_it():
    config = orchestrator_config(wall_clock_ceiling_seconds=30.0)
    assert config.budget_for(120000).wall_clock_seconds == 30.0


def test_the_budget_carries_the_deployment_numbers_and_the_derived_clock():
    config = orchestrator_config(
        max_steps=3, max_model_calls=4, max_tool_calls=5, max_total_tokens=900, max_evidence_bytes=800
    )
    budget = config.budget_for(2000)
    assert budget == RunBudget(
        max_steps=3,
        max_model_calls=4,
        max_tool_calls=5,
        max_total_tokens=900,
        max_evidence_bytes=800,
        wall_clock_seconds=2.0,
    )


# ---------------------------------------------------------------------
# Admission: the lane is the gate before any work
# ---------------------------------------------------------------------


def test_a_saturated_lane_refuses_with_the_typed_error(tmp_path):
    orchestrator, _, lane = _orchestrator(ScriptedLoopModel(multihop_turns()), None, tmp_path / "lane.lock")

    async def scenario():
        async with lane.acquire():
            with pytest.raises(AdmissionRefused):
                async with orchestrator.admit():
                    pass  # never reached

    asyncio.run(scenario())


def test_the_admission_claim_holds_for_the_whole_run_and_releases_after(tmp_path):
    orchestrator, _, lane = _orchestrator(ScriptedLoopModel(multihop_turns()), None, tmp_path / "lane.lock")

    async def scenario():
        async with orchestrator.admit():
            record = await orchestrator.run(_request())
            assert record.outcome == OUTCOME_ANSWERED
            # Still inside the claim: a second run is refused.
            with pytest.raises(AdmissionRefused):
                async with orchestrator.admit():
                    pass
        # Released: the next claim succeeds.
        async with orchestrator.admit():
            pass

    asyncio.run(scenario())


# ---------------------------------------------------------------------
# The governed run: the usage record and the seam events
# ---------------------------------------------------------------------


def test_a_completed_run_answers_the_usage_record_of_the_shared_counters(tmp_path):
    turns = tuple(
        replace(turn, prompt_tokens=10, completion_tokens=5)
        for turn in multihop_turns(judge_reply='{"verdict": "grounded"}')
    )
    port = fake_port()
    orchestrator, port_calls, _ = _orchestrator(ScriptedLoopModel(turns), port, tmp_path)
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert record.run_id.startswith("run-")
    assert record.outcome == OUTCOME_ANSWERED
    # The grounding judge is the run's one aux call: the shared fleet
    # model-call budget counts it, the aux tally carries it separately.
    assert (record.steps, record.model_calls, record.aux_model_calls, record.tool_calls) == (3, 4, 1, 2)
    assert record.evidence_bytes > 0
    assert (record.prompt_tokens, record.completion_tokens) == (40, 20)
    assert record.wall_clock_seconds >= 0
    assert record.error is None
    assert record.as_dict().keys() == {
        "run_id",
        "outcome",
        "steps",
        "model_calls",
        "aux_model_calls",
        "tool_calls",
        "evidence_bytes",
        "prompt_tokens",
        "completion_tokens",
        "wall_clock_seconds",
        "error",
        "language",
        "preparation_status",
        "injection_findings",
    }
    assert [event.kind.value for event in events][-1] == "run_finished"
    # The verdict lands before the terminal, and the governed run's verdict
    # is the tri-state projection: the judge completed grounded.
    verdict_event = events[-2]
    assert verdict_event.kind.value == "verdict"
    assert verdict_event.payload["grounding_status"] == "grounded"
    assert verdict_event.payload["is_grounded"] is True
    for event in events:
        assert event.run_id == record.run_id
        assert event.kind.value not in BFF_FRAME_NAMES


def test_the_executor_is_built_per_request_with_the_request_context_and_bearer(tmp_path):
    port = fake_port()
    script = multihop_turns(judge_reply='{"verdict": "grounded"}') * 2
    orchestrator, port_calls, _ = _orchestrator(ScriptedLoopModel(script), port, tmp_path)
    asyncio.run(orchestrator.run(_request(bearer="bearer-1", context=CONTEXT)))
    asyncio.run(orchestrator.run(_request(bearer="bearer-2", context=CONTEXT)))

    assert [call["bearer"] for call in port_calls] == ["bearer-1", "bearer-2"]
    assert all(call["context"] == CONTEXT for call in port_calls)
    assert len(port.search_calls) == 2  # both runs dispatched through the port


def test_the_registry_is_bound_to_the_request_context_and_the_operation_budget(tmp_path):
    port = fake_port()
    config = orchestrator_config(operation_budget=OperationBudget(timeout_ms=777, max_results=3, max_result_bytes=999))
    orchestrator, _, _ = _orchestrator(
        ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}')), port, tmp_path, config=config
    )
    asyncio.run(orchestrator.run(_request()))

    assert port.search_calls[0]["budget"] == config.operation_budget
    assert port.search_calls[0]["context"] == CONTEXT


def test_the_system_prompt_reaches_the_model_call(tmp_path):
    model = ScriptedLoopModel((ModelTurn(content="done"),))
    orchestrator, _, _ = _orchestrator(
        model, None, tmp_path, config=orchestrator_config(system_prompt="the deployed prompt")
    )
    asyncio.run(orchestrator.run(_request()))
    assert model.requests[0]["messages"][0] == {"role": "system", "content": "the deployed prompt"}


# ---------------------------------------------------------------------
# Cancellation: the partial record is logged, the error propagates
# ---------------------------------------------------------------------


def test_a_cancellation_logs_the_partial_record_and_propagates_untouched(tmp_path, caplog):
    recorder: dict = {}
    orchestrator, _, lane = _orchestrator(HangingLoopModel(recorder), None, tmp_path / "lane.lock")

    async def scenario():
        async with orchestrator.admit():
            task = asyncio.ensure_future(orchestrator.run(_request()))
            while "started" not in recorder:
                await asyncio.sleep(0.01)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        # The released slot admits the successor.
        async with orchestrator.admit():
            pass

    with caplog.at_level("WARNING"):
        asyncio.run(scenario())

    assert recorder["cancelled_in_flight"] is True  # the cancellation reached the in-flight call
    partials = [record for record in caplog.records if "partial usage record" in record.getMessage()]
    assert len(partials) == 1
    logged = json.loads(partials[0].getMessage().split("record: ", 1)[1])
    assert logged["outcome"] == OUTCOME_CANCELLED
    assert (logged["steps"], logged["model_calls"]) == (1, 1)  # the monitor's honest partials


# ---------------------------------------------------------------------
# No fabricated answer on the exhausted path — through the orchestrator
# ---------------------------------------------------------------------


def test_an_exhausted_run_reports_budget_exhausted_with_no_answer_text(tmp_path):
    turns = multihop_turns(answer="the fabricated answer")
    orchestrator, _, _ = _orchestrator(
        ScriptedLoopModel(turns), None, tmp_path, config=orchestrator_config(max_model_calls=1)
    )
    events: list[AgentEvent] = []
    record = asyncio.run(orchestrator.run(_request(), sink=events.append))
    assert record.outcome == "budget_exhausted"
    assert record.model_calls == 1
    assert record.error is not None
    # No answer text — nothing to verify, so no verdict event exists.
    assert "verdict" not in [event.kind.value for event in events]


def test_an_answer_with_no_retrieval_verifies_unverified(tmp_path):
    """An answer produced with no retrieval at all is an insufficiency
    statement: nothing claimed, nothing to ground — ``unverified`` (the
    honest neutral), the judge skipped, no marking."""
    events: list[AgentEvent] = []
    orchestrator, _, _ = _orchestrator(ScriptedLoopModel((ModelTurn(content="I cannot find that."),)), None, tmp_path)

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert record.outcome == OUTCOME_ANSWERED
    verdict_event = events[-2]
    assert verdict_event.kind.value == "verdict"
    assert verdict_event.payload["grounding_status"] == VERDICT_UNVERIFIED
    assert verdict_event.payload["judge"] == {"ran": False, "outcome": "skipped", "verdict": None}
    assert verdict_event.payload["marking"] == {"required": False, "reason": None}
    assert verdict_event.payload["citations"] == []


# ---------------------------------------------------------------------
# A pre-loop build failure is an honest terminal, not a truncated stream
# ---------------------------------------------------------------------


def test_a_port_factory_failure_answers_the_honest_terminal(tmp_path):
    """A build failure before the loop's first dispatch (here: the port
    factory refusing an unassembled knob) reaches the caller as the
    defined terminal — the run_error event and the "error" usage record —
    so a started stream carries its terminal + record and never truncates."""
    events: list[AgentEvent] = []

    def broken_factory(context, bearer):
        raise ValueError("AGENT_DOCREPO_URL must be set for the port assembly (doc-repo base URL)")

    orchestrator = RequestOrchestrator(
        config=orchestrator_config(),
        lane=AdmissionLane(1, str(tmp_path / "lane.lock")),
        model_client=ScriptedLoopModel((ModelTurn(content="never reached"),)),
        port_factory=broken_factory,
    )

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert record.outcome == OUTCOME_ERROR
    assert record.error is not None
    assert "AGENT_DOCREPO_URL" in record.error
    # The stream shape: every stream begins with run_started (the failure
    # path announces it — the loop never entered), then the terminal.
    assert [event.kind.value for event in events] == ["run_started", "run_error"]
    assert events[-1].payload["code"] == OUTCOME_ERROR
    assert record.as_dict()["steps"] == 0  # nothing ran; the record is the honest zero
