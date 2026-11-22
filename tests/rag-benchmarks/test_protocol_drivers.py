# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/drivers.py (+ run_protocol's reference/assess wiring).

All transports are fakes — no live venue, no network, no docker. The fakes
prove the contracts: config A rides the anchor subprocess pattern (and
fail-fasts on missed traces), config B ships the in-container driver and
resumes by case id, config C drives the /v1/runs seam with honest terminal
states (answered / refused / cancelled), and the gated assess command runs
the gate BEFORE any query.
"""

import base64
import json
import re
from pathlib import Path

import pytest

from protocol import drivers
from protocol import gate as gate_mod
from protocol.manifest import manifest_digest
from protocol.run_protocol import cmd_assess, cmd_reference

CORPUS = "c" * 64
SET_SHA = "a" * 64
EVALUATOR_INSTRUCTIONS = str(Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md")


# ---------------------------------------------------------------------------
# Config A
# ---------------------------------------------------------------------------


def test_config_a_runs_the_anchor_pattern_and_records_the_report(tmp_path):
    calls = []

    def fake_runner(gold, out, seed, env_extra=None):
        calls.append({"gold": str(gold), "out": str(out), "seed": seed, "env_extra": env_extra})
        out.write_text(json.dumps({"aggregate": {"recall": 0.9}, "n_missed_traces": 0}), encoding="utf-8")
        return {"aggregate": {"recall": 0.9}, "n_missed_traces": 0}

    result = drivers.run_config_a("set.json", tmp_path, seed=7, runner=fake_runner)
    assert calls[0]["seed"] == 7
    assert calls[0]["gold"].endswith("set.json")
    assert calls[0]["out"].endswith("config-a.report.json")
    assert result["report"]["aggregate"]["recall"] == 0.9
    assert Path(result["report_path"]).exists()


def test_config_a_fail_fasts_on_missed_traces(tmp_path):
    """The anchor's existing behavior, reused: a reference with missed traces
    is a zero baseline in disguise."""

    def runner_with_misses(gold, out, seed, env_extra=None):
        return {"aggregate": {"recall": 0.0}, "n_missed_traces": 3, "n_unmapped_chunk_keys": 0}

    with pytest.raises(drivers.DriverError) as failed:
        drivers.run_config_a("set.json", tmp_path, seed=7, runner=runner_with_misses)
    assert "3 trace(s)" in str(failed.value)


def test_config_a_uses_the_capture_machinery_subprocess_by_default(monkeypatch, tmp_path):
    """The default runner IS capture_baseline._run_anchor_eval — reuse, never a fork."""
    import capture_baseline

    seen = {}
    monkeypatch.setattr(
        capture_baseline,
        "_run_anchor_eval",
        lambda gold, out, seed, env_extra=None: seen.update({"seed": seed}) or {"n_missed_traces": 0},
    )
    result = drivers.run_config_a("set.json", tmp_path, seed=42)
    assert seen["seed"] == 42
    assert result["report"] == {"n_missed_traces": 0}


# ---------------------------------------------------------------------------
# Config B — fake docker-exec transport
# ---------------------------------------------------------------------------


class FakeBTransport:
    """Replays the container side: decodes the shipped payload, returns rows
    for the case ids it received (any id in `failure_ids` becomes a failure
    row — the run must continue anyway)."""

    def __init__(self, failure_ids=()):
        self.cmds: list[str] = []
        self.failure_ids = set(failure_ids)
        self.shipped_driver: bytes | None = None
        self.cases_seen: list[list[str]] = []

    def exec_cmd(self, container, cmd, timeout=600, pass_env=()):
        self.cmds.append(cmd)
        if cmd.startswith("base64 -w0"):
            rows = {}
            for case_id in self.cases_seen[-1]:
                if case_id in self.failure_ids:
                    rows[case_id] = {
                        "case_id": case_id,
                        "status": "failure",
                        "error_type": "LaneBusyError",
                        "error": "the lane is saturated",
                    }
                else:
                    rows[case_id] = {
                        "case_id": case_id,
                        "status": "ok",
                        "answer": f"answer-{case_id}",
                        "abstained": False,
                        "abstention_reason": None,
                        "source_documents": [],
                        "metadata": {},
                        "wall_ms": 12.0,
                    }
            payload = json.dumps({"cases": rows, "resolved": {"model_id": "granite-4.1-8b", "env": {"AGENT_X": "1"}}})
            return base64.b64encode(payload.encode("utf-8")).decode("ascii")
        quoted = re.findall(r"printf %s '([^']+)'", cmd)
        self.shipped_driver = base64.b64decode(quoted[0])
        cases = json.loads(base64.b64decode(quoted[1]).decode("utf-8"))["cases"]
        self.cases_seen.append([c["id"] for c in cases])
        return ""


def _b_set(tmp_path, ids):
    entries = [
        {
            "id": i,
            "query": f"q {i}",
            "language": "en",
            "case_class": "answerable",
            "access_scenario": "public",
            "provenance": "assessment",
        }
        for i in ids
    ]
    path = tmp_path / "set.json"
    path.write_text(json.dumps({"_meta": {"provenance": "assessment"}, "entries": entries}), encoding="utf-8")
    return path


def test_config_b_ships_the_driver_and_consumes_rows(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2"))
    transport = FakeBTransport()
    result = drivers.run_config_b(set_path, tmp_path / "out", transport=transport)
    # The shipped driver IS protocol/config_b_driver.py — the in-container
    # script, not a re-implementation.
    driver_source = (Path(drivers.__file__).parent / "config_b_driver.py").read_bytes()
    assert transport.shipped_driver == driver_source
    assert transport.cases_seen == [["c1", "c2"]]
    # The rows are recorded atomically with the NoAgentResult fields verbatim.
    assert result["rows"]["c1"]["answer"] == "answer-c1"
    assert "abstention_reason" in result["rows"]["c1"]
    assert result["resolved"]["model_id"] == "granite-4.1-8b"
    written = json.loads((tmp_path / "out" / "config-b.rows.json").read_text(encoding="utf-8"))
    assert written["cases"]["c2"]["status"] == "ok"


def test_config_b_driver_helpers_consume_a_result_verbatim(tmp_path, monkeypatch):
    """The in-container driver's helpers are importable WITHOUT the
    agent-service tree, and against a fake pipeline they prove the row
    contract: NoAgentResult fields verbatim on the ok row, typed failure row
    on a raised case, atomic rows file on disk. Only the contract import
    (``build_context``) touches the component tree — pydantic is in the test
    env; ``noagent`` itself stays unimported (the driver's own docstring
    contract)."""
    import asyncio
    import importlib.util

    driver_path = Path(drivers.__file__).parent / "config_b_driver.py"
    spec = importlib.util.spec_from_file_location("config_b_driver_under_test", driver_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    agent_service = Path(__file__).resolve().parents[2] / "components" / "agent-service"
    monkeypatch.syspath_prepend(str(agent_service))

    class FakeResult:
        answer = "the answer"
        abstained = False
        abstention_reason = None
        source_documents = ({"file_id": "f-1"},)
        metadata = {"query_translation_status": "passthrough_english"}

    class OkPipeline:
        async def run(self, history, context, source_language=None, target_language=None, user_context=""):
            assert history == [{"role": "user", "content": "q"}]
            assert context.user_id == "eval-config-b"
            assert context.authorized_graph_names == ()
            return FakeResult()

    class ExplodingPipeline:
        async def run(self, history, context, **_):
            raise RuntimeError("the lane is saturated")

    case = {"id": "c1", "query": "q", "language": "en"}
    ok_row = asyncio.run(module.run_case(case, OkPipeline()))
    assert ok_row["case_id"] == "c1"
    assert ok_row["status"] == "ok"
    assert ok_row["answer"] == "the answer"
    assert ok_row["source_documents"] == [{"file_id": "f-1"}]
    assert ok_row["metadata"] == {"query_translation_status": "passthrough_english"}
    assert isinstance(ok_row["wall_ms"], float)

    failure_row = asyncio.run(module.run_case(case, ExplodingPipeline()))
    assert failure_row["status"] == "failure"
    assert failure_row["error_type"] == "RuntimeError"
    assert "saturated" in failure_row["error"]

    rows_path = tmp_path / "rows.json"
    module.atomic_write_json(str(rows_path), {"cases": {"c1": ok_row}, "resolved": {"model_id": "m"}})
    assert json.loads(rows_path.read_text(encoding="utf-8"))["cases"]["c1"]["answer"] == "the answer"


def test_config_b_per_case_failure_rows_and_run_continues(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2"))
    transport = FakeBTransport(failure_ids={"c1"})
    result = drivers.run_config_b(set_path, tmp_path / "out", transport=transport)
    assert result["rows"]["c1"]["status"] == "failure"
    assert result["rows"]["c1"]["error_type"] == "LaneBusyError"
    assert result["rows"]["c2"]["status"] == "ok"


def test_config_b_resume_reruns_only_unfinished_ids(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2", "c3"))
    transport = FakeBTransport()
    first = drivers.run_config_b(set_path, tmp_path / "out", transport=transport)
    assert sorted(first["rows"]) == ["c1", "c2", "c3"]
    # Second invocation: every case has a recorded row (failure rows count as
    # finished outcomes) — nothing is re-run.
    second = drivers.run_config_b(set_path, tmp_path / "out", transport=FakeBTransport())
    assert second["pending_ids"] == []
    # And a partial rows file: only the missing ids are shipped.
    (tmp_path / "out2").mkdir()
    transport2 = FakeBTransport()
    (tmp_path / "out2" / "config-b.rows.json").write_text(
        json.dumps({"cases": {"c1": {"case_id": "c1", "status": "ok"}}}), encoding="utf-8"
    )
    drivers.run_config_b(set_path, tmp_path / "out2", transport=transport2)
    assert transport2.cases_seen == [["c2", "c3"]]


def test_config_b_batches_container_invocations(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2", "c3"))
    transport = FakeBTransport()
    drivers.run_config_b(set_path, tmp_path / "out", transport=transport, batch=2)
    assert transport.cases_seen == [["c1", "c2"], ["c3"]]
    assert sum(1 for cmd in transport.cmds if cmd.startswith("mkdir")) == 2


# ---------------------------------------------------------------------------
# Config C — fake SSE transport
# ---------------------------------------------------------------------------


class FakeRunStream:
    def __init__(self, status=200, error_body=None, events=(), fail_after=None):
        self.status = status
        self.error_body = error_body
        self._events = list(events)
        self._fail_after = fail_after
        self.closed = False

    def events(self):
        for index, event in enumerate(self._events):
            if self._fail_after is not None and index >= self._fail_after:
                raise OSError("connection reset mid-run")
            yield event

    def close(self):
        self.closed = True


class FakeCTransport:
    def __init__(self, stream):
        self.stream = stream
        self.requests: list[dict] = []

    def open_run(self, url, payload, timeout, verify_tls=False):
        self.requests.append({"url": url, "payload": payload, "timeout": timeout})
        return self.stream


def _answered_events():
    return [
        {"run_id": "r-1", "call_id": None, "seq": 0, "kind": "run_started", "payload": {"question": "q"}},
        {"run_id": "r-1", "call_id": None, "seq": 1, "kind": "text_message_content", "payload": {"text": "Hel"}},
        {"run_id": "r-1", "call_id": None, "seq": 2, "kind": "text_message_content", "payload": {"text": "lo"}},
        {"run_id": "r-1", "call_id": None, "seq": 3, "kind": "run_finished", "payload": {"outcome": "answered"}},
        {"usage_record": {"run_id": "r-1", "outcome": "answered", "model_calls": 2}},
    ]


def test_config_c_answered_case_carries_answer_and_usage_record(tmp_path):
    case = {"id": "q1", "query": "What?", "case_class": "answerable"}
    transport = FakeCTransport(FakeRunStream(events=_answered_events()))
    row = drivers.run_one_case_c(case, base_url="http://agent:8000", transport=transport)
    assert row["outcome"] == "answered"
    assert row["answer"] == "Hello"
    assert row["usage_record"]["model_calls"] == 2
    assert row["run_id"] == "r-1"
    assert transport.stream.closed is True
    # The request body is the governed RunRequestBody shape.
    sent = transport.requests[0]["payload"]
    assert sent["question"] == "What?"
    assert sent["context"]["user_id"]
    assert sent["context"]["authorized_graph_names"] == []
    assert sent["deadline_ms"] > 0


def test_config_c_cancellation_records_the_honest_terminal_state(tmp_path):
    """A cancellation case closes the stream mid-run: outcome cancelled, NO
    answer — a cancelled run has no honest answer to fabricate."""
    case = {"id": "cancel-1", "query": "Long question", "case_class": "cancellation"}
    transport = FakeCTransport(FakeRunStream(events=_answered_events()))
    row = drivers.run_one_case_c(case, base_url="http://agent:8000", transport=transport)
    assert row["outcome"] == "cancelled"
    assert "answer" not in row
    assert row["cancelled"] is True
    assert row["cancel_requested"] is True
    assert row["events_seen"] == 1
    assert transport.stream.closed is True


def test_config_c_admission_refusal_429_is_typed(tmp_path):
    case = {"id": "fail-1", "query": "q", "case_class": "failure"}
    stream = FakeRunStream(status=429, error_body={"error": "admission_refused", "message": "lane saturated"})
    row = drivers.run_one_case_c(case, base_url="http://agent:8000", transport=FakeCTransport(stream))
    assert row["outcome"] == "admission_refused"
    assert row["error"]["error"] == "admission_refused"
    assert "answer" not in row


def test_config_c_configuration_error_503_is_typed(tmp_path):
    case = {"id": "fail-2", "query": "q", "case_class": "failure"}
    stream = FakeRunStream(
        status=503,
        error_body={"error": "budget_configuration_missing", "missing_knobs": ["AGENT_RUN_MAX_STEPS"]},
    )
    row = drivers.run_one_case_c(case, base_url="http://agent:8000", transport=FakeCTransport(stream))
    assert row["outcome"] == "configuration_error"
    assert row["error"]["missing_knobs"] == ["AGENT_RUN_MAX_STEPS"]


def test_config_c_invalid_request_422_is_typed(tmp_path):
    stream = FakeRunStream(status=422, error_body={"detail": "invalid"})
    row = drivers.run_one_case_c({"id": "x", "query": "q"}, base_url="u", transport=FakeCTransport(stream))
    assert row["outcome"] == "invalid_request"


def test_config_c_stream_death_mid_run_is_recorded(tmp_path):
    """The stream died without a terminal event and without a cancellation
    point: the outcome names it — never a fabricated answer."""
    stream = FakeRunStream(events=_answered_events(), fail_after=2)
    row = drivers.run_one_case_c({"id": "x", "query": "q"}, base_url="u", transport=FakeCTransport(stream))
    assert row["outcome"] == "stream_error"
    assert "answer" not in row
    assert "reset" in row["error_text"]


def test_config_c_run_resumes_by_case_id(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2"))
    done = tmp_path / "out" / "config-c.rows.json"
    done.parent.mkdir(parents=True)
    done.write_text(json.dumps({"cases": {"c1": {"case_id": "c1", "outcome": "answered"}}}), encoding="utf-8")
    transport = FakeCTransport(FakeRunStream(events=_answered_events()))
    result = drivers.run_config_c(set_path, tmp_path / "out", base_url="http://agent:8000", transport=transport)
    assert [r["payload"]["question"] for r in transport.requests] == ["q c2"]
    assert result["rows"]["c1"]["outcome"] == "answered"
    assert result["rows"]["c2"]["outcome"] == "answered"


# ---------------------------------------------------------------------------
# run_protocol wiring — reference (never gated) and assess (gate first)
# ---------------------------------------------------------------------------


def _write_reference_and_thresholds(out_dir: Path, set_path: Path):
    from protocol.manifest import build_manifest, sha256_file

    set_sha = sha256_file(set_path)
    reference = build_manifest(
        kind="reference",
        config="A",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": CORPUS},
        sets={"assessment": {"path": "set.json", "sha256": set_sha}},
        configuration={"A": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        created_utc="2026-01-01T00:00:00+00:00",
    )
    (out_dir / "reference.manifest.json").write_text(json.dumps(reference), encoding="utf-8")
    thresholds = gate_mod.thresholds_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=set_sha,
        reference_manifest=reference,
        thresholds={"recall_min": 0.4},
    )
    (out_dir / "thresholds.json").write_text(json.dumps(thresholds), encoding="utf-8")
    return reference, thresholds


def _assess_args(tmp_path, config, **kw):
    args = dict(
        config=config,
        set_path=str(tmp_path / "set.json"),
        out_dir=str(tmp_path / "out"),
        container="agent-service",
        base_url="http://agent:8000",
        deadline_ms=600_000,
        corpus_collection="COLL",
        corpus_graph="G",
        corpus_fingerprint=CORPUS,
        compute_fingerprint=False,
        models_endpoint=None,
        resolved_env=None,
        evaluator_instructions=EVALUATOR_INSTRUCTIONS,
        stack_prefix=None,
    )
    args.update(kw)
    return type("Args", (), args)


def test_gated_run_without_reference_refuses_before_any_query(tmp_path, monkeypatch, capsys):
    """The matrix's 'refused before any query runs' row: the driver is never
    invoked, and the refusal names the missing predecessor. (The set file must
    exist — its digest is part of the lineage the gate matches.)"""
    _b_set(tmp_path, ("c1",))
    (tmp_path / "out").mkdir()
    invoked = []
    import protocol.run_protocol as rp

    monkeypatch.setattr(rp, "run_config_c", lambda *a, **k: invoked.append(k) or {})
    rc = cmd_assess(_assess_args(tmp_path, "C"))
    assert rc == 1
    assert invoked == []
    assert "reference" in capsys.readouterr().err


def test_gated_run_with_complete_lineage_runs_and_chains_the_manifest(tmp_path, monkeypatch):
    set_path = _b_set(tmp_path, ("c1",))
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    reference, thresholds = _write_reference_and_thresholds(out_dir, set_path)
    recorded = {}

    def fake_run_config_c(set_path_arg, out_dir_arg, base_url=None, deadline_ms=None):
        recorded["set"] = str(set_path_arg)
        rows_path = Path(out_dir_arg) / "config-c.rows.json"
        rows_path.write_text(
            json.dumps({"cases": {"c1": {"case_id": "c1", "outcome": "answered", "status": "ok"}}}),
            encoding="utf-8",
        )
        return {"rows": {"c1": {"case_id": "c1", "outcome": "answered", "status": "ok"}}, "resolved": {}}

    import protocol.run_protocol as rp

    monkeypatch.setattr(rp, "run_config_c", fake_run_config_c)
    rc = cmd_assess(_assess_args(tmp_path, "C"))
    assert rc == 0
    assert recorded["set"] == str(set_path)
    manifest = json.loads((out_dir / "config-c.manifest.json").read_text(encoding="utf-8"))
    assert manifest["kind"] == "gated"
    assert manifest["config"] == "C"
    assert manifest["lineage"]["reference_manifest_sha256"] == manifest_digest(reference)
    assert manifest["lineage"]["thresholds_sha256"] == manifest_digest(thresholds)
    assert manifest["pair"]["pair"] == "E02"
    assert manifest["pair"]["intentional_difference"] == "orchestration"


def test_gated_config_b_maps_to_pair_e01(tmp_path, monkeypatch):
    set_path = _b_set(tmp_path, ("c1",))
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    _write_reference_and_thresholds(out_dir, set_path)

    def fake_run_config_b(set_path_arg, out_dir_arg, container=None):
        rows_path = Path(out_dir_arg) / "config-b.rows.json"
        rows_path.write_text(
            json.dumps(
                {
                    "cases": {"c1": {"case_id": "c1", "status": "ok", "answer": "a"}},
                    "resolved": {"model_id": "granite-4.1-8b", "env": {"AGENT_X": "1"}},
                }
            ),
            encoding="utf-8",
        )
        resolved = {"model_id": "granite-4.1-8b", "env": {"AGENT_X": "1"}}
        return {"rows": {"c1": {"case_id": "c1", "status": "ok", "answer": "a"}}, "resolved": resolved}

    import protocol.run_protocol as rp

    monkeypatch.setattr(rp, "run_config_b", fake_run_config_b)
    rc = cmd_assess(_assess_args(tmp_path, "B"))
    assert rc == 0
    manifest = json.loads((out_dir / "config-b.manifest.json").read_text(encoding="utf-8"))
    assert manifest["pair"]["pair"] == "E01"
    assert manifest["pair"]["intentional_difference"] == "retrieval_backend"
    # The B run's resolved env comes from the driver's in-container record.
    assert manifest["configuration"]["B"]["resolved_env"] == {"AGENT_X": "1"}
    assert manifest["configuration"]["B"]["model_ids"] == {"llm": "granite-4.1-8b"}


def test_reference_run_is_never_gated(tmp_path, monkeypatch, capsys):
    """The A-only reference command runs without any gate check and writes a
    reference manifest."""
    set_path = _b_set(tmp_path, ("c1",))
    gate_calls = []

    def refusing_gate(**kw):
        gate_calls.append(kw)
        raise AssertionError("the gate must not run for a reference command")

    import protocol.run_protocol as rp

    monkeypatch.setattr(rp, "check_gated_run", refusing_gate)
    monkeypatch.setattr(
        rp,
        "run_config_a",
        lambda set_path_arg, out_dir, seed=None: {
            "report": {"aggregate": {"recall": 0.9}, "n_missed_traces": 0},
            "report_path": str(Path(out_dir) / "config-a.report.json"),
        },
    )
    args = type(
        "Args",
        (),
        dict(
            set_path=str(set_path),
            out_dir=str(tmp_path / "out"),
            seed=7,
            corpus_collection="COLL",
            corpus_graph="G",
            corpus_fingerprint=CORPUS,
            compute_fingerprint=False,
            models_endpoint=None,
            resolved_env=None,
            evaluator_instructions=EVALUATOR_INSTRUCTIONS,
            stack_prefix=None,
            pair="E01",
        ),
    )()
    rc = cmd_reference(args)
    assert rc == 0
    assert gate_calls == []
    manifest = json.loads((tmp_path / "out" / "reference.manifest.json").read_text(encoding="utf-8"))
    assert manifest["kind"] == "reference"
    assert "lineage" not in manifest
    assert manifest["pair"]["pair"] == "E01"
    assert "reference" in capsys.readouterr().out


def test_discover_model_ids_reads_the_serving_endpoint():
    body = {"data": [{"id": "granite-4.1-8b", "max_model_len": 65536}]}
    ids = drivers.discover_model_ids("http://vllm:8000", fetch=lambda url, timeout: body)
    assert ids == {"llm": "granite-4.1-8b"}
    with pytest.raises(drivers.DriverError):
        drivers.discover_model_ids("http://vllm:8000", fetch=lambda url, timeout: {"data": []})
