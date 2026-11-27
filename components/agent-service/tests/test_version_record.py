# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The execution-version record: the builder's fields
and hash stability, the no-secrets invariant, the override prompt hashed,
the model identity resolved fail-soft, and the run-start handshake — the
record riding ``run_started`` on the loop path, the governed path and the
pre-loop failure path alike."""

import asyncio
import json
import re

from conftest import (
    SHIPPED_CATALOG,
    FakeConceptSource,
    FakeMetadataSource,
    ScriptedLoopModel,
    _governed_loop,
    fake_port,
    multihop_turns,
    orchestrator_config,
)

from agent.events import AgentEvent
from agent.orchestrator import AgentRunRequest, RequestOrchestrator
from agent.prompt import PRODUCTION_SYSTEM_PROMPT
from agent.sources import DocumentToolSource
from agent.version_record import (
    IMPLEMENTATION_VERSION,
    PROMPT_OVERRIDE_VERSION,
    PROMPT_VERSION,
    build_execution_version_record,
    configuration_fingerprint,
    configuration_values,
    short_sha256,
)
from capabilities.adapters.vllm import VllmModelClient, VllmTransientError
from capabilities.model import ModelTurn
from lane import AdmissionLane
from noagent.config import NoAgentConfig
from tool_catalog import DeclaredSource, build_tool_source_factory, load_catalog

# ---------------------------------------------------------------------
# The builder: fields, hash stability, the no-secrets invariant
# ---------------------------------------------------------------------


RUNTIME_ID = "custom-loop"


def _record_for(config=None, **overrides):
    return build_execution_version_record(config=config or orchestrator_config(), runtime_id=RUNTIME_ID, **overrides)


def test_the_record_carries_the_five_version_axes():
    record = _record_for(model_id="m-1", model_source="discovered")
    assert set(record) == {"implementation", "model", "prompt", "configuration", "runtime"}
    assert record["implementation"] == {"version": IMPLEMENTATION_VERSION}
    assert record["model"] == {"id": "m-1", "source": "discovered"}
    assert set(record["prompt"]) == {"version", "sha256"}
    assert set(record["configuration"]) == {"sha256", "values"}
    # The runtime that drove the run is an axis of its own: a run is
    # attributable to the runtime that served it, like to the model it called.
    assert record["runtime"] == {"id": RUNTIME_ID}


def test_the_prompt_axis_is_the_hash_of_the_effective_prompt():
    config = orchestrator_config(system_prompt="the deployed prompt")
    record = _record_for(config=config)
    assert record["prompt"] == {"version": PROMPT_OVERRIDE_VERSION, "sha256": short_sha256("the deployed prompt")}
    # An override is NOT the shipped template's version name.
    assert record["prompt"]["version"] != PROMPT_VERSION


def test_the_shipped_prompt_names_the_prod_version():
    config = orchestrator_config(system_prompt=PRODUCTION_SYSTEM_PROMPT)
    record = _record_for(config=config)
    assert record["prompt"]["version"] == PROMPT_VERSION
    assert record["prompt"]["sha256"] == short_sha256(PRODUCTION_SYSTEM_PROMPT)


def test_the_prompt_body_never_enters_the_record_only_its_hash():
    prompt = "the full prompt text with instructions"
    record = _record_for(config=orchestrator_config(system_prompt=prompt))
    serialized = json.dumps(record)
    assert prompt not in serialized
    assert short_sha256(prompt) in serialized


def test_the_configuration_fingerprint_is_stable_across_equal_configs():
    values = configuration_values(orchestrator_config(max_steps=6))
    again = configuration_values(orchestrator_config(max_steps=6))
    assert configuration_fingerprint(values) == configuration_fingerprint(again)
    # A different knob resolves to a different fingerprint.
    other = configuration_values(orchestrator_config(max_steps=7))
    assert configuration_fingerprint(values) != configuration_fingerprint(other)


def test_the_configuration_values_carry_the_resolved_knobs_and_nothing_secret():
    config = orchestrator_config(max_total_tokens=4242)
    values = configuration_values(config)
    assert values["max_steps"] == 6
    assert values["max_total_tokens"] == 4242
    assert values["operation_budget"] == {"timeout_ms": 1000, "max_results": 8, "max_result_bytes": 65536}
    assert values["verdict_policy"] == "verdict-marked"
    # The prompt text is the record's own axis (hashed) — never carried here.
    assert "system_prompt" not in values
    # No secret-shaped key anywhere in the values tree (the one legitimate
    # 'tokens' occurrence is the budget knob's own name — excluded).
    serialized = json.dumps(values)
    for marker in ("bearer", "secret", "api_key", "password", "authorization"):
        assert marker not in serialized.lower()
    assert not re.search(r"(?<!total_)tokens?", serialized.lower())


def test_the_record_hash_is_reproducible_byte_for_byte():
    first = _record_for(config=orchestrator_config(), model_id="m", model_source="override")
    second = _record_for(config=orchestrator_config(), model_id="m", model_source="override")
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_an_unresolved_model_carries_the_truncated_note():
    note = "x" * 500
    record = _record_for(model_id=None, model_source="unresolved", model_note=note)
    assert record["model"]["id"] is None
    assert record["model"]["source"] == "unresolved"
    assert len(record["model"]["note"]) == 200


def test_no_note_rides_when_the_resolution_was_clean():
    record = _record_for(model_id="m-1", model_source="override", model_note=None)
    assert "note" not in record["model"]


# ---------------------------------------------------------------------
# The model identity: fail-soft on the client
# ---------------------------------------------------------------------


def _probe_client(env_overrides=None, transport=None) -> VllmModelClient:
    values = {"VLLM_LLM_ENDPOINT": "http://endpoint.invalid", "VLLM_LLM_MODEL_ID": ""}
    config = NoAgentConfig.load(env={**values, **(env_overrides or {})}).model_config()
    return VllmModelClient(config, transport=transport)


def test_the_override_identity_skips_the_probe():
    client = _probe_client({"VLLM_LLM_MODEL_ID": "override-model"})
    identity = asyncio.run(client.model_identity())
    assert identity == ("override-model", "override", None)


def test_a_discovery_failure_degrades_to_the_unresolved_identity():
    class _BrokenTransport:
        def get_json(self, url, bearer, timeout_s):
            raise VllmTransientError("the model discovery failed: transport down")

    client = _probe_client(transport=_BrokenTransport())
    model_id, source, note = asyncio.run(client.model_identity())
    assert model_id is None
    assert source == "unresolved"
    assert "transport down" in note


def test_a_discovered_identity_names_the_served_model():
    from conftest import PreparationFakeTransport, preparation_model_entry

    transport = PreparationFakeTransport(responses={"http://endpoint.invalid/v1/models": preparation_model_entry()})
    client = _probe_client(transport=transport)
    model_id, source, note = asyncio.run(client.model_identity())
    assert (model_id, source, note) == ("test-model", "discovered", None)


# ---------------------------------------------------------------------
# The handshake: the record rides run_started
# ---------------------------------------------------------------------


def test_the_loop_emits_the_record_on_run_started_when_it_carries_one():
    record = _record_for()
    model = ScriptedLoopModel((ModelTurn(content="done"),))
    loop, collector, _monitor, _verifier = _governed_loop(model, fake_port(), execution_versions=record)

    asyncio.run(loop.run("the question"))

    started = collector[0]
    assert started.kind.value == "run_started"
    assert started.payload["question"] == "the question"
    assert started.payload["execution_versions"] == record


def test_the_loop_without_a_record_keeps_the_probe_payload_shape():
    model = ScriptedLoopModel((ModelTurn(content="done"),))
    loop, collector, _monitor, _verifier = _governed_loop(model, fake_port())

    asyncio.run(loop.run("the question"))

    assert collector[0].payload == {"question": "the question"}


class _IdentityModel(ScriptedLoopModel):
    """A scripted model that ALSO exposes the fail-soft identity source the
    real client carries."""

    def __init__(self, turns, identity):
        super().__init__(turns)
        self._identity = identity

    async def model_identity(self):
        return self._identity


def _orchestrator_with(model, port, tmp_path):
    catalog = load_catalog(
        SHIPPED_CATALOG,
        served_names={DocumentToolSource.source_id: DocumentToolSource.served_tool_names},
        ceiling=orchestrator_config().operation_budget,
    )
    return RequestOrchestrator(
        config=orchestrator_config(),
        lane=AdmissionLane(1, str(tmp_path / "lane.lock")),
        model_client=model,
        tool_source_factory=build_tool_source_factory(
            catalog=catalog,
            declared_sources=(
                DeclaredSource(
                    source_id=DocumentToolSource.source_id,
                    served_tool_names=DocumentToolSource.served_tool_names,
                    build=lambda bundle: DocumentToolSource(
                        lambda context, bearer: port,
                        bundle.operation_budget,
                        preparer=bundle.preparer,
                        on_preparation_status=bundle.on_preparation_status,
                        abstention_sink=bundle.abstention_sink,
                    ),
                ),
            ),
        ),
        metadata_source=FakeMetadataSource(),
        concept_source=FakeConceptSource(),
    )


def _request(**overrides):
    from capabilities.contract import CallerContext

    context = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))
    values = {"question": "q", "deadline_ms": 5000, "context": context, "bearer": None}
    return AgentRunRequest(**{**values, **overrides})


def test_the_governed_run_emits_the_record_with_the_resolved_model_identity(tmp_path):
    model = _IdentityModel(multihop_turns(judge_reply='{"verdict": "grounded"}'), ("served-model", "discovered", None))
    orchestrator = _orchestrator_with(model, fake_port(), tmp_path)
    events: list[AgentEvent] = []

    asyncio.run(orchestrator.run(_request(), sink=events.append))

    started = events[0]
    assert started.kind.value == "run_started"
    # The emitted record is the FAIL-SOFT-BUILT one (the orchestrator builds
    # it from the client's identity), carried verbatim.
    assert started.payload["execution_versions"]["model"] == {"id": "served-model", "source": "discovered"}
    assert started.payload["execution_versions"]["implementation"] == {"version": IMPLEMENTATION_VERSION}


def test_a_model_client_without_an_identity_resolves_to_the_unresolved_entry(tmp_path):
    model = ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}'))
    orchestrator = _orchestrator_with(model, fake_port(), tmp_path)
    events: list[AgentEvent] = []

    asyncio.run(orchestrator.run(_request(), sink=events.append))

    model_axis = events[0].payload["execution_versions"]["model"]
    assert model_axis["id"] is None
    assert model_axis["source"] == "unresolved"
    assert "no identity" in model_axis["note"]


def test_a_failing_identity_source_degrades_and_the_run_proceeds(tmp_path):
    class _ExplodingIdentity(ScriptedLoopModel):
        async def model_identity(self):
            raise RuntimeError("identity probe exploded")

    orchestrator = _orchestrator_with(
        _ExplodingIdentity(multihop_turns(judge_reply='{"verdict": "grounded"}')), fake_port(), tmp_path
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    model_axis = events[0].payload["execution_versions"]["model"]
    assert model_axis["source"] == "unresolved"
    assert "identity probe exploded" in model_axis["note"]
    # Fail-soft BY CONTRACT: the run itself proceeds to its answered terminal.
    assert record.outcome == "answered"


def test_the_pre_loop_failure_path_emits_the_record(tmp_path):
    """The build-failure path announces run_started itself — the record
    rides THAT emission too, so even a run that never entered the loop is
    attributable at start."""

    def broken_factory(bundle):
        raise ValueError("AGENT_DOCREPO_URL must be set for the port assembly (doc-repo base URL)")

    orchestrator = RequestOrchestrator(
        config=orchestrator_config(),
        lane=AdmissionLane(1, str(tmp_path / "lane.lock")),
        model_client=ScriptedLoopModel((ModelTurn(content="never reached"),)),
        tool_source_factory=broken_factory,
        metadata_source=FakeMetadataSource(),
        concept_source=FakeConceptSource(),
    )
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert [event.kind.value for event in events] == ["run_started", "run_error"]
    assert record.outcome == "error"
    started = events[0]
    assert started.payload["question"] == "q"
    assert started.payload["execution_versions"]["implementation"] == {"version": IMPLEMENTATION_VERSION}
    # A build failure happens before any model identity: the unresolved entry.
    assert started.payload["execution_versions"]["model"]["source"] == "unresolved"


def test_replace_keeps_the_record_out_of_the_usage_record(tmp_path):
    """The record rides the START event only — the terminal usage record's
    key set is untouched (no new doc shapes beyond the additive
    block the BFF assembles)."""
    model = ScriptedLoopModel(multihop_turns(judge_reply='{"verdict": "grounded"}'))
    orchestrator = _orchestrator_with(model, fake_port(), tmp_path)
    events: list[AgentEvent] = []

    record = asyncio.run(orchestrator.run(_request(), sink=events.append))

    assert "execution_versions" not in record.as_dict()
