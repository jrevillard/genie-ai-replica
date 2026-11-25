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
from protocol.evalset import evaluation_surface
from protocol.manifest import manifest_digest, sha256_json
from protocol.run_protocol import cmd_assess, cmd_reference

CORPUS = "c" * 64
EVALUATOR_INSTRUCTIONS = str(Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md")


# ---------------------------------------------------------------------------
# Config A
# ---------------------------------------------------------------------------


def _a_set_file(tmp_path):
    """A real (composition-valid) set file for the config-A tests — the A
    driver reads the set to record the security cases' skipped rows."""
    sample = Path(__file__).resolve().parent / "protocol" / "sets" / "assessment.sample.json"
    path = tmp_path / "set.json"
    path.write_text(sample.read_text(encoding="utf-8"), encoding="utf-8")
    return path


def test_config_a_runs_the_anchor_pattern_and_records_the_report(tmp_path):
    calls = []
    set_path = _a_set_file(tmp_path)

    def fake_runner(gold, out, seed, env_extra=None):
        calls.append({"gold": str(gold), "out": str(out), "seed": seed, "env_extra": env_extra})
        out.write_text(json.dumps({"aggregate": {"recall": 0.9}, "n_missed_traces": 0}), encoding="utf-8")
        return {"aggregate": {"recall": 0.9}, "n_missed_traces": 0}

    result = drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=fake_runner)
    assert calls[0]["seed"] == 7
    # The anchor is fed the DERIVED gold file: the set's retrieval-surface
    # cases only — the anchor scores passages, and a gold-less case would
    # score vacuously.
    assert calls[0]["gold"].endswith("config-a.gold.json")
    assert calls[0]["out"].endswith("config-a.report.json")
    anchored = json.loads(Path(calls[0]["gold"]).read_text(encoding="utf-8"))["entries"]
    assert {case["id"] for case in anchored} == {
        "sample-ans-pub-1",
        "sample-cite-pub-1",
        "sample-lang-ru-1",
        "sample-lang-es-1",
    }
    assert result["report"]["aggregate"]["recall"] == 0.9
    assert Path(result["report_path"]).exists()


def _refusing_runner(gold, out, seed, env_extra=None):  # pragma: no cover — the run must not happen
    """The runner a refusal test installs: the anchor must NOT run on a set it
    cannot measure, so reaching it fails the test."""
    raise AssertionError("the anchor must not run on an unmeasurable set")


def _sample_set_with(tmp_path, case_id, mutate):
    """The CI sample set with ONE case mutated — the setup the anchor's
    refusal tests share."""
    set_path = _a_set_file(tmp_path)
    data = json.loads(set_path.read_text(encoding="utf-8"))
    for case in data["entries"]:
        if case["id"] == case_id:
            mutate(case)
    set_path.write_text(json.dumps(data), encoding="utf-8")
    return set_path


def test_config_a_refuses_a_set_whose_retrieval_cases_carry_no_gold(tmp_path):
    """A retrieval case without gold is measured by nothing: the anchor would
    score it vacuously (recall 1.0 by construction) and count it as measured
    while carrying no expectation. The driver refuses instead."""
    def drop_gold(case):
        case["expected_chunks"] = []

    set_path = _sample_set_with(tmp_path, "sample-ans-pub-1", drop_gold)

    with pytest.raises(drivers.DriverError) as failed:
        drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=_refusing_runner)
    assert "carry no gold" in str(failed.value)
    assert "sample-ans-pub-1" in str(failed.value)


def test_config_a_refuses_a_retrieval_case_the_anchor_cannot_drive_as_one_query(tmp_path):
    """A multi-turn case's queries are its turns — the capture drives them. The
    anchor drives one query per case, so a retrieval case it cannot drive that
    way is measured by nothing."""
    def turns_only(case):
        case.pop("query")
        case["turns"] = [{"query": "first turn"}, {"query": "second turn"}]

    set_path = _sample_set_with(tmp_path, "sample-ans-pub-1", turns_only)

    with pytest.raises(drivers.DriverError) as failed:
        drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=_refusing_runner)
    assert "ONE query" in str(failed.value)
    assert "sample-ans-pub-1" in str(failed.value)


def test_config_a_refuses_a_gold_entry_the_anchor_cannot_match(tmp_path):
    """The anchor's gold rule: the content hashes, and only when no entry
    carries one does it fall back to the chunk keys. So an entry that carries
    only a chunk key BESIDE hashed siblings is dropped — it matches against
    nothing while the case counts as annotated."""
    def mixed_identities(case):
        case["expected_chunks"] = [
            {"chunk_key": "sample-ans-pub-1-chunk-1", "content_hash": "a1b2c3d4e5f60718"},
            {"chunk_key": "sample-ans-pub-1-chunk-2"},
        ]

    set_path = _sample_set_with(tmp_path, "sample-ans-pub-1", mixed_identities)

    with pytest.raises(drivers.DriverError) as failed:
        drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=_refusing_runner)
    assert "cannot match" in str(failed.value)
    assert "sample-ans-pub-1#gold1" in str(failed.value)


def test_config_a_refuses_a_gold_entry_with_no_identity(tmp_path):
    """The anchor matches a gold chunk on its content hash (or its chunk key).
    An entry with neither matches against nothing, and the case would drop out
    of the aggregate without a word."""
    def preview_only(case):
        case["expected_chunks"] = [{"preview": "the quarterly service report is submitted…"}]

    set_path = _sample_set_with(tmp_path, "sample-ans-pub-1", preview_only)

    with pytest.raises(drivers.DriverError) as failed:
        drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=_refusing_runner)
    assert "cannot match" in str(failed.value)
    assert "sample-ans-pub-1#gold0" in str(failed.value)


def test_config_a_refuses_a_gold_entry_that_is_not_an_object(tmp_path):
    """The anchor reads ``c.get(...)`` on every gold entry, so an entry that is
    not an object would kill it with an AttributeError instead of a refusal.
    The refusal names the entry by its position in the set's own list."""
    def bare_string(case):
        case["expected_chunks"] = [
            {"chunk_key": "sample-ans-pub-1-chunk-1", "content_hash": "a1b2c3d4e5f60718"},
            "a bare string where a gold object belongs",
        ]

    set_path = _sample_set_with(tmp_path, "sample-ans-pub-1", bare_string)

    with pytest.raises(drivers.DriverError) as failed:
        drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=_refusing_runner)
    assert "cannot match" in str(failed.value)
    assert "sample-ans-pub-1#gold1" in str(failed.value)


def test_config_a_records_the_identity_of_the_anchor_input(tmp_path):
    """The set's digest identifies the set; the projection's digest identifies
    WHICH of its cases the chunk-level surface scores. Both are recorded, so
    an artifact says what it measured."""
    set_path = _a_set_file(tmp_path)
    calls = []

    def runner(gold, out, seed, env_extra=None):
        calls.append(gold)
        out.write_text(json.dumps({"aggregate": {}, "n_missed_traces": 0}), encoding="utf-8")
        return {"aggregate": {}, "n_missed_traces": 0}

    result = drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=runner)
    rows = json.loads(Path(result["rows_path"]).read_text(encoding="utf-8"))
    # The recorded identity is the digest of the file the anchor ACTUALLY read.
    anchored = json.loads(Path(calls[0]).read_text(encoding="utf-8"))["entries"]
    assert rows["anchor_projection_sha256"] == sha256_json(anchored)
    # The anchored cases are the retrieval-surface ones, and the census agrees.
    assert {case["id"] for case in anchored} == {
        "sample-ans-pub-1",
        "sample-cite-pub-1",
        "sample-lang-ru-1",
        "sample-lang-es-1",
    }
    assert rows["coverage"]["by_surface"]["retrieval"] == len(anchored)


def test_config_a_fail_fasts_on_missed_traces(tmp_path):
    """The anchor's existing behavior, reused: a reference with missed traces
    is a zero baseline in disguise."""
    set_path = _a_set_file(tmp_path)

    def runner_with_misses(gold, out, seed, env_extra=None):
        return {"aggregate": {"recall": 0.0}, "n_missed_traces": 3, "n_unmapped_chunk_keys": 0}

    with pytest.raises(drivers.DriverError) as failed:
        drivers.run_config_a(set_path, tmp_path / "out", seed=7, runner=runner_with_misses)
    assert "3 trace(s)" in str(failed.value)


def test_config_a_uses_the_capture_machinery_subprocess_by_default(monkeypatch, tmp_path):
    """The default runner IS capture_baseline._run_anchor_eval — reuse, never a fork."""
    import capture_baseline

    set_path = _a_set_file(tmp_path)
    seen = {}
    monkeypatch.setattr(
        capture_baseline,
        "_run_anchor_eval",
        lambda gold, out, seed, env_extra=None: seen.update({"seed": seed}) or {"n_missed_traces": 0},
    )
    result = drivers.run_config_a(set_path, tmp_path / "out", seed=42)
    assert seen["seed"] == 42
    assert result["report"] == {"n_missed_traces": 0}


# ---------------------------------------------------------------------------
# Config B — fake docker-exec transport
# ---------------------------------------------------------------------------


class FakeBTransport:
    """Replays the container side: decodes the shipped payload, returns rows
    for the case ids it received (any id in `failure_ids` becomes a failure
    row — the run must continue anyway; a shipped per-turn entry's ``turn``
    index rides the row like the real driver writes it)."""

    def __init__(self, failure_ids=(), resolved_env=None):
        self.cmds: list[str] = []
        self.failure_ids = set(failure_ids)
        self.shipped_driver: bytes | None = None
        self.cases_seen: list[list[str]] = []
        self.shipped_cases: list[dict] = []
        self.resolved_env = resolved_env or {"AGENT_X": "1"}

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
            turn_by_id = {case["id"]: case.get("turn") for case in self.shipped_cases}
            for case_id, turn in turn_by_id.items():
                if case_id in rows and turn is not None:
                    rows[case_id]["turn"] = turn
            payload = json.dumps({"cases": rows, "resolved": {"model_id": "granite-4.1-8b", "env": self.resolved_env}})
            return base64.b64encode(payload.encode("utf-8")).decode("ascii")
        quoted = re.findall(r"printf %s '([^']+)'", cmd)
        if "python3" in cmd:
            # The cases ship + the driver runs in this call.
            cases = json.loads(base64.b64decode(quoted[0]).decode("utf-8"))["cases"]
            self.cases_seen.append([c["id"] for c in cases])
            self.shipped_cases.extend(cases)
        else:
            # The driver script ships alone in this call.
            self.shipped_driver = base64.b64decode(quoted[0])
        return ""


def _case(id_, query, case_class, access="public", **extra):
    case = {
        "id": id_,
        "query": query,
        "categoryLabels": [],
        "serviceLabels": [],
        "language": "en",
        "reference_answer": "",
        "expected_chunks": [],
        "case_class": case_class,
        "access_scenario": access,
        "provenance": "assessment",
        **extra,
    }
    # A retrieval-surface case carries gold: the chunk-level surface is the
    # only one that consumes it, and the anchor driver refuses a set whose
    # retrieval cases carry none.
    if "expected_chunks" not in extra and evaluation_surface(case) == "retrieval":
        case["expected_chunks"] = [{"chunk_key": f"{id_}-chunk-1", "content_hash": "a1b2c3d4e5f60718"}]
    return case


def _b_set(tmp_path, ids):
    """A composition-VALID assessment set: the requested ids are the
    answerable public cases; `_`-prefixed filler cases carry every other
    required class AND every required security scenario (the drivers enforce
    the floor on the data path, so a driver-test set must be a real one). The
    enumerating assertions filter the `_` fillers out."""
    entries = [_case(i, f"q {i}", "answerable") for i in ids]
    entries.append(_case("_ans-restricted", "restricted q", "answerable", access="restricted"))
    while sum(1 for e in entries if e["case_class"] == "answerable") < 2:
        entries.append(_case("_ans-pad", "padding q", "answerable"))
    entries.append(
        _case("_unans", "the unanswerable question", "unanswerable", expectations={"expect_abstained": True})
    )
    entries.append(_case("_cite", "the citation question", "citation_check", expectations={"require_citation": True}))
    entries.append(_case("_lang-ru", "Как подать заявление?", "representative_language", script="non-latin"))
    entries.append(_case("_lang-es", "¿Dónde se presenta?", "representative_language"))
    entries.append(_case("_fail", "the failure question", "failure"))
    entries.append(_case("_cancel", "the cancellation question", "cancellation"))
    entries.append(
        _case(
            "_sec-restricted",
            "the restricted-repo question",
            "answerable",
            access="restricted",
            security_scenario="restricted_repo",
        )
    )
    entries.append(_case("_sec-xuser-a", "the cross-user question", "answerable", security_scenario="cross_user_id"))
    entries.append(_case("_sec-xuser-b", "the cross-user question", "answerable", security_scenario="cross_user_id"))
    entries.append(
        _case("_sec-narrow", "the narrowed-scope question", "answerable", security_scenario="narrowed_scope")
    )
    entries.append(
        _case(
            "_sec-perm",
            "the permission-change question",
            "answerable",
            access="restricted",
            security_scenario="permission_change",
            turns=[{"query": "turn one"}, {"query": "turn two"}],
        )
    )
    entries.append(
        _case("_sec-inj-doc", "the injection question", "answerable", security_scenario="injection_document")
    )
    entries.append(
        _case("_sec-inj-tool", "the tool-injection question", "answerable", security_scenario="injection_tool_output")
    )
    path = tmp_path / "set.json"
    path.write_text(json.dumps({"_meta": {"provenance": "assessment"}, "entries": entries}), encoding="utf-8")
    return path


def _main_ids(cases_seen):
    """The non-filler case ids a transport observed (fillers carry `_`),
    filler-only batches dropped."""
    return [batch for batch in ([i for i in one_batch if not i.startswith("_")] for one_batch in cases_seen) if batch]


def test_config_b_ships_the_driver_and_consumes_rows(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2"))
    transport = FakeBTransport()
    result = drivers.run_config_b(set_path, tmp_path / "out", transport=transport)
    # The shipped driver IS protocol/config_b_driver.py — the in-container
    # script, not a re-implementation.
    driver_source = (Path(drivers.__file__).parent / "config_b_driver.py").read_bytes()
    assert transport.shipped_driver == driver_source
    assert _main_ids(transport.cases_seen) == [["c1", "c2"]]
    # The rows are recorded atomically with the NoAgentResult fields verbatim.
    assert result["rows"]["c1"]["answer"] == "answer-c1"
    assert "abstention_reason" in result["rows"]["c1"]
    assert result["resolved"]["model_id"] == "granite-4.1-8b"
    written = json.loads((tmp_path / "out" / "config-b.rows.json").read_text(encoding="utf-8"))
    assert written["cases"]["c2"]["status"] == "ok"


def test_config_b_redacts_credential_named_keys_at_the_rows_write(tmp_path):
    """The container's resolved snapshot rides verbatim, but the rows file
    is the committed artifact: a credential-named key captured by the
    prefix list (VLLM_API_KEY rode VLLM_ into the #2167 campaign's
    committed copy) is redacted at the write boundary — dropped, not
    stored — while configuration keys survive."""
    set_path = _b_set(tmp_path, ("c1",))
    transport = FakeBTransport(resolved_env={"AGENT_X": "1", "VLLM_API_KEY": "raw-venue-key"})
    result = drivers.run_config_b(set_path, tmp_path / "out", transport=transport)
    assert result["resolved"]["env"]["AGENT_X"] == "1"
    assert "VLLM_API_KEY" not in result["resolved"]["env"]
    written = json.loads((tmp_path / "out" / "config-b.rows.json").read_text(encoding="utf-8"))
    assert "VLLM_API_KEY" not in written["resolved"]["env"]
    assert written["resolved"]["env"]["AGENT_X"] == "1"


def test_config_b_resume_redacts_a_legacy_rows_snapshot_at_load(tmp_path):
    """A rows file written by the pre-redaction code carries the raw
    snapshot. The CONVERGED resume is the discriminating path: every set
    entry is already done, so the container loop never runs (pinned by
    transport.cmds == []) and the returned snapshot IS the loaded prior —
    only the load-boundary redaction guards it. Code that redacts only at
    the write boundary fails here: the merge-replace never fires, the raw
    key rides the return. (With pending cases the re-written artifact is
    covered by the merge-replace of the new redacted snapshot; the earlier
    redact test pins that side.)"""
    set_path = _b_set(tmp_path, ("c1",))
    out = tmp_path / "out"
    out.mkdir()
    entries = json.loads(set_path.read_text(encoding="utf-8"))["entries"]
    entry_ids = [
        e["id"]
        for entry in entries
        for e in (drivers.turn_entries(entry) if entry.get("turns") else [entry])
    ]
    legacy = {
        "cases": {
            cid: {"case_id": cid, "status": "ok", "answer": "a", "abstained": False} for cid in entry_ids
        },
        "resolved": {"model_id": "granite-4.1-8b", "env": {"VLLM_API_KEY": "raw-venue-key"}},
    }
    (out / "config-b.rows.json").write_text(json.dumps(legacy), encoding="utf-8")
    transport = FakeBTransport()
    result = drivers.run_config_b(set_path, out, transport=transport)
    assert transport.cmds == []  # the converged premise, enforced not assumed
    assert "VLLM_API_KEY" not in result["resolved"]["env"]


def test_config_b_driver_helpers_consume_a_result_verbatim(tmp_path, monkeypatch):
    """The in-container driver's helpers are importable WITHOUT the
    agent-service tree, and against a fake pipeline they prove the row
    contract: NoAgentResult fields verbatim on the ok row, typed failure row
    on a raised case, atomic rows file on disk. Only the contract import
    (``build_context``) touches the component tree — pydantic is in the test
    env; ``noagent`` itself stays unimported (the driver's own docstring
    contract)."""
    # The graph fallback reads the ambient env — pin the default shape.
    monkeypatch.delenv("EVAL_DEFAULT_GRAPH", raising=False)
    import asyncio
    module = _load_driver("under_test")

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
            assert context.authorized_graph_names == ("GRAPH",)
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
    assert [i for i in sorted(first["rows"]) if not i.startswith("_")] == ["c1", "c2", "c3"]
    # Second invocation: every case has a recorded row (failure rows count as
    # finished outcomes) — nothing is re-run and NO container round-trip happens.
    converged = FakeBTransport()
    second = drivers.run_config_b(set_path, tmp_path / "out", transport=converged)
    assert second["pending_ids"] == []
    assert converged.cmds == []
    # And a partial rows file: only the missing ids are shipped.
    (tmp_path / "out2").mkdir()
    transport2 = FakeBTransport()
    (tmp_path / "out2" / "config-b.rows.json").write_text(
        json.dumps({"cases": {"c1": {"case_id": "c1", "status": "ok"}}}), encoding="utf-8"
    )
    drivers.run_config_b(set_path, tmp_path / "out2", transport=transport2)
    assert _main_ids(transport2.cases_seen) == [["c2", "c3"]]


def test_config_b_batches_container_invocations(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2", "c3"))
    transport = FakeBTransport()
    drivers.run_config_b(set_path, tmp_path / "out", transport=transport, batch=2)
    assert _main_ids(transport.cases_seen) == [["c1", "c2"], ["c3"]]
    # The driver script ships ONCE; each sub-batch ships its own cases exec —
    # one python3 exec per batch (the set's 10 cases at a 2-case ceiling = 5).
    n_entries = len(json.loads(set_path.read_text(encoding="utf-8"))["entries"])
    assert sum(1 for cmd in transport.cmds if cmd.startswith("mkdir")) == 1
    assert sum(1 for cmd in transport.cmds if "python3" in cmd) == -(-n_entries // 2)


def test_config_b_splits_the_payload_by_bytes_before_the_argv_cap(tmp_path):
    """One exec argv carries one sh -c argument — the kernel caps it at
    MAX_ARG_STRLEN (128 KiB), so payloads are byte-bounded: fat cases split
    even below the case-count ceiling."""
    fat = ("c1", "c2", "c3")
    set_path = _b_set(tmp_path, fat)
    data = json.loads(set_path.read_text(encoding="utf-8"))
    for entry in data["entries"]:
        if entry["id"] in fat:
            entry["query"] = "x" * 200
    set_path.write_text(json.dumps(data), encoding="utf-8")
    transport = FakeBTransport()
    result = drivers.run_config_b(set_path, tmp_path / "out", transport=transport, payload_bound=300)
    # Each fat case's payload exceeds the bound alone → one case per exec
    # (the filler cases are small and batch among themselves).
    assert _main_ids(transport.cases_seen) == [["c1"], ["c2"], ["c3"]]
    assert [i for i in sorted(result["rows"]) if not i.startswith("_")] == ["c1", "c2", "c3"]


# ---------------------------------------------------------------------------
# Multi-turn execution
# ---------------------------------------------------------------------------


def _multiturn_set(tmp_path):
    """A `_b_set` floor set plus one REAL two-turn permission-change case the
    multi-turn tests observe shipping (the `_sec-perm` filler stays in the set
    for the floor and is `_`-filtered out of the enumerating assertions)."""
    set_path = _b_set(tmp_path, ())
    data = json.loads(set_path.read_text(encoding="utf-8"))
    data["entries"].append(
        {
            "id": "perm-1",
            "case_class": "answerable",
            "access_scenario": "restricted",
            "provenance": "assessment",
            "language": "en",
            "security_scenario": "permission_change",
            "turns": [
                {"query": "summarize wide", "context": {"user_id": "u", "authorized_source_ids": ["doc-1", "doc-2"]}},
                {"query": "answer narrower", "context": {"user_id": "u", "authorized_source_ids": ["doc-1"]}},
            ],
        }
    )
    set_path.write_text(json.dumps(data), encoding="utf-8")
    return set_path


def test_config_b_multiturn_ships_turn_entries_in_order(tmp_path):
    """The harness expands a multi-turn case into per-turn entries with
    turn-indexed ids; the shipped payload carries each turn's own context and
    the rows come back keyed `case#t{n}` with the turn index recorded."""
    set_path = _multiturn_set(tmp_path)
    transport = FakeBTransport()
    result = drivers.run_config_b(set_path, tmp_path / "out", transport=transport)
    shipped = [case_id for batch in transport.cases_seen for case_id in batch if case_id.startswith("perm")]
    assert shipped == ["perm-1#t1", "perm-1#t2"]
    # The rows carry the turn index and the per-turn ids.
    assert result["rows"]["perm-1#t1"]["turn"] == 1
    assert result["rows"]["perm-1#t2"]["turn"] == 2


def test_config_b_multiturn_resume_reruns_from_the_first_missing_turn(tmp_path):
    """Strict turn order on resume: a turn-2-only prior row is stale — the
    run restarts the case at turn 1 and re-runs the tail."""
    set_path = _multiturn_set(tmp_path)
    out = tmp_path / "out"
    out.mkdir()
    (out / "config-b.rows.json").write_text(
        json.dumps({"cases": {"perm-1#t2": {"case_id": "perm-1#t2", "status": "ok"}}}),
        encoding="utf-8",
    )
    transport = FakeBTransport()
    result = drivers.run_config_b(set_path, out, transport=transport)
    shipped = [case_id for batch in transport.cases_seen for case_id in batch if case_id.startswith("perm")]
    assert shipped == ["perm-1#t1", "perm-1#t2"]
    assert result["rows"]["perm-1#t1"]["status"] == "ok"


def test_config_c_multiturn_runs_sequential_per_turn_contexts(tmp_path):
    """Each turn is a separate /v1/runs request under its own context, in
    order; the rows carry the turn-indexed ids and the turn index."""
    set_path = _multiturn_set(tmp_path)
    transport = FakeCTransport(FakeRunStream(events=_answered_events()))
    result = drivers.run_config_c(set_path, tmp_path / "out", base_url="http://agent:8000", transport=transport)
    questions = [r["payload"]["question"] for r in transport.requests]
    assert questions.count("summarize wide") == 1
    assert questions.count("answer narrower") == 1
    assert questions.index("summarize wide") < questions.index("answer narrower")
    assert result["rows"]["perm-1#t1"]["turn"] == 1
    assert result["rows"]["perm-1#t2"]["turn"] == 2
    assert result["rows"]["perm-1#t2"]["outcome"] == "answered"


def test_config_c_captures_the_verdict_source_documents(tmp_path):
    """The citation-verdict projection's source_documents ride the row — the
    security verdict layer's subset-check input on config C."""
    events = _answered_events() + [
        {
            "run_id": "r-1",
            "call_id": None,
            "seq": 4,
            "kind": "verdict",
            "payload": {"source_documents": [{"document_id": "doc-1", "score": 0.9}], "grounding_status": "grounded"},
        }
    ]
    row = drivers.run_one_case_c(
        {"id": "v1", "query": "q", "case_class": "answerable"},
        base_url="http://agent:8000",
        transport=FakeCTransport(FakeRunStream(events=events)),
    )
    assert row["source_documents"] == [{"document_id": "doc-1", "score": 0.9}]


def test_config_a_writes_skipped_rows_for_security_cases(tmp_path):
    """Config A has no agent surface: the security cases (per turn for a
    multi-turn case) record skipped rows with the reason."""
    from protocol.evalset import turn_entries

    set_path = _multiturn_set(tmp_path)
    # Add one single-turn injection case so both shapes are covered.
    data = json.loads(set_path.read_text(encoding="utf-8"))
    data["entries"].append(
        _case("inj-1", "the injection question", "answerable", security_scenario="injection_document")
    )
    set_path.write_text(json.dumps(data), encoding="utf-8")

    def runner(gold, out, seed, env_extra=None):
        out.write_text(json.dumps({"aggregate": {}, "n_missed_traces": 0}), encoding="utf-8")
        return {"aggregate": {}, "n_missed_traces": 0}

    result = drivers.run_config_a(set_path, tmp_path / "out", seed=0, runner=runner)
    rows = result["rows"]
    expected = sorted(
        entry["id"]
        for case in data["entries"]
        if case.get("security_scenario")
        for entry in turn_entries(case)
    )
    assert sorted(rows) == expected
    assert all(row["outcome"] == "skipped" for row in rows.values())
    assert all("no agent surface" in row["reason"] for row in rows.values())
    assert rows["perm-1#t1"]["turn"] == 1
    assert (tmp_path / "out" / "config-a.rows.json").exists()


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
        # The trace the run's spans land in — the real stream propagates its
        # own traceparent and exposes the id (the agent's spans carry no run
        # id, so the propagated trace id is the only exact handle).
        self.trace_id = "f" * 32

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


def test_config_c_answered_case_carries_answer_and_usage_record(tmp_path, monkeypatch):
    monkeypatch.delenv("EVAL_DEFAULT_GRAPH", raising=False)
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
    assert sent["context"]["authorized_graph_names"] == ["GRAPH"]
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


def test_config_c_incomplete_read_is_a_typed_stream_error(tmp_path):
    """``http.client.IncompleteRead`` subclasses HTTPException, NOT OSError —
    it must still land in the typed stream_error row."""
    import http.client

    class IncompleteStream(FakeRunStream):
        def events(self):
            yield self._events[0]
            raise http.client.IncompleteRead(b"partial chunk")

    stream = IncompleteStream(events=_answered_events())
    row = drivers.run_one_case_c({"id": "x", "query": "q"}, base_url="u", transport=FakeCTransport(stream))
    assert row["outcome"] == "stream_error"
    assert "answer" not in row
    assert "IncompleteRead" in row["error_text"]
    assert stream.closed is True


class VenueDownTransport:
    """open_run raises — the venue is unreachable (URLError/socket timeout)."""

    def __init__(self):
        self.open_attempts = 0

    def open_run(self, url, payload, timeout, verify_tls=False):
        self.open_attempts += 1
        raise OSError("connection refused (venue down)")


def test_config_c_venue_down_is_a_typed_row_and_the_run_continues(tmp_path):
    """The open sits INSIDE the per-case try: a venue-down transport failure
    records a typed stream_error row for that case; the assessment run
    continues with the remaining cases — it never dies untyped."""
    from protocol.evalset import turn_entries

    set_path = _b_set(tmp_path, ("c1", "c2"))
    transport = VenueDownTransport()
    result = drivers.run_config_c(set_path, tmp_path / "out", base_url="http://agent:8000", transport=transport)
    n_entries = sum(len(turn_entries(case)) for case in json.loads(set_path.read_text(encoding="utf-8"))["entries"])
    assert transport.open_attempts == n_entries
    assert result["rows"]["c1"]["outcome"] == "stream_error"
    assert result["rows"]["c2"]["outcome"] == "stream_error"
    assert "venue down" in result["rows"]["c1"]["error_text"]


def test_config_c_bare_503_without_the_typed_code_is_http_error(tmp_path):
    """A proxy/infra 503 whose body is not the seam's typed error is NOT a
    configuration_error — it records as http_error."""
    stream = FakeRunStream(status=503, error_body={"raw": "<html>Service Unavailable</html>"})
    row = drivers.run_one_case_c({"id": "x", "query": "q"}, base_url="u", transport=FakeCTransport(stream))
    assert row["outcome"] == "http_error"


def test_config_c_run_resumes_by_case_id(tmp_path):
    set_path = _b_set(tmp_path, ("c1", "c2"))
    done = tmp_path / "out" / "config-c.rows.json"
    done.parent.mkdir(parents=True)
    done.write_text(json.dumps({"cases": {"c1": {"case_id": "c1", "outcome": "answered"}}}), encoding="utf-8")
    transport = FakeCTransport(FakeRunStream(events=_answered_events()))
    result = drivers.run_config_c(set_path, tmp_path / "out", base_url="http://agent:8000", transport=transport)
    assert [r["payload"]["question"] for r in transport.requests if r["payload"]["question"].startswith("q ")] == [
        "q c2"
    ]
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


def _composed_set(tmp_path) -> Path:
    """A composition-VALID set at the path _assess_args names — the CLI
    commands enforce the composition floor before hashing/running, so the
    assess/reference wiring tests need the committed sample's shape."""
    sample = Path(__file__).resolve().parent / "protocol" / "sets" / "assessment.sample.json"
    path = tmp_path / "set.json"
    path.write_text(sample.read_text(encoding="utf-8"), encoding="utf-8")
    return path


def test_assess_refuses_an_under_composed_set_before_the_gate(tmp_path, monkeypatch, capsys):
    """The composition floor is enforced where runs happen: an under-composed
    set refuses with the typed errors BEFORE the gate is even consulted."""
    (tmp_path / "set.json").write_text(
        json.dumps(
            {
                "_meta": {"provenance": "assessment"},
                "entries": [_case("c1", "q", "answerable")],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "out").mkdir()
    import protocol.run_protocol as rp

    monkeypatch.setattr(
        rp,
        "check_gated_run",
        lambda **kw: (_ for _ in ()).throw(AssertionError("the gate must not run on an invalid set")),
    )
    rc = cmd_assess(_assess_args(tmp_path, "C"))
    assert rc == 1
    err = capsys.readouterr().err
    assert "cancellation" in err or "separation" in err


def test_gated_run_without_reference_refuses_before_any_query(tmp_path, monkeypatch, capsys):
    """The matrix's 'refused before any query runs' row: the driver is never
    invoked, and the refusal names the missing predecessor. (The set file must
    exist AND be composition-valid — its digest is part of the lineage the
    gate matches.)"""
    _composed_set(tmp_path)
    (tmp_path / "out").mkdir()
    invoked = []
    import protocol.run_protocol as rp

    monkeypatch.setattr(rp, "run_config_c", lambda *a, **k: invoked.append(k) or {})
    rc = cmd_assess(_assess_args(tmp_path, "C"))
    assert rc == 1
    assert invoked == []
    assert "reference" in capsys.readouterr().err


def test_gated_run_with_complete_lineage_runs_and_chains_the_manifest(tmp_path, monkeypatch):
    set_path = _composed_set(tmp_path)
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


def test_gated_config_b_maps_to_pair_e01(tmp_path, monkeypatch, capsys):
    set_path = _composed_set(tmp_path)
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    _write_reference_and_thresholds(out_dir, set_path)

    def fake_run_config_b(set_path_arg, out_dir_arg, container=None):
        rows_path = Path(out_dir_arg) / "config-b.rows.json"
        rows = {
            # status-based rows (config B): the ok row must not count, the
            # failure row must — the summary reads status when outcome is absent.
            "c1": {"case_id": "c1", "status": "ok", "answer": "a"},
            "c2": {"case_id": "c2", "status": "failure", "error_type": "LaneBusyError"},
        }
        rows_path.write_text(
            json.dumps({"cases": rows, "resolved": {"model_id": "granite-4.1-8b", "env": {"AGENT_X": "1"}}}),
            encoding="utf-8",
        )
        resolved = {"model_id": "granite-4.1-8b", "env": {"AGENT_X": "1"}}
        return {"rows": rows, "resolved": resolved}

    import protocol.run_protocol as rp

    monkeypatch.setattr(rp, "run_config_b", fake_run_config_b)
    rc = cmd_assess(_assess_args(tmp_path, "B"))
    assert rc == 0
    assert "1 non-answered outcome(s)" in capsys.readouterr().out
    manifest = json.loads((out_dir / "config-b.manifest.json").read_text(encoding="utf-8"))
    assert manifest["pair"]["pair"] == "E01"
    assert manifest["pair"]["intentional_difference"] == "retrieval_backend"
    # The B run's resolved env comes from the driver's in-container record.
    assert manifest["configuration"]["B"]["resolved_env"] == {"AGENT_X": "1"}
    assert manifest["configuration"]["B"]["model_ids"] == {"llm": "granite-4.1-8b"}


def test_reference_run_is_never_gated(tmp_path, monkeypatch, capsys):
    """The A-only reference command runs without any gate check and writes a
    reference manifest."""
    set_path = _composed_set(tmp_path)
    gate_calls = []

    def refusing_gate(**kw):
        gate_calls.append(kw)
        raise AssertionError("the gate must not run for a reference command")

    import protocol.run_protocol as rp

    monkeypatch.setattr(rp, "check_gated_run", refusing_gate)
    monkeypatch.setattr(
        rp,
        "run_config_a",
        lambda set_path_arg, out_dir, seed=None, runner=None, env_extra=None, entries=None: {
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


# ---------------------------------------------------------------------------
# authorized_repos forwarding (global-review round 1)
# ---------------------------------------------------------------------------


def test_c_payload_forwards_authorized_repos():
    """The C payload carries the repo→graph mapping — the OKF read scope the
    CallerContext contract field exists for."""
    case = {
        "id": "c1",
        "query": "q",
        "context": {
            "user_id": "u",
            "authorized_graph_names": ["G"],
            "authorized_repos": [{"repo_id": "repo-a", "graph_name": "G"}],
        },
    }
    payload = drivers.c_payload_for_case(case, deadline_ms=1000)
    assert payload["context"]["authorized_repos"] == [{"repo_id": "repo-a", "graph_name": "G"}]


def test_c_payload_drops_malformed_repo_entries():
    """A malformed authorized_repos entry is dropped (the context block is
    free-form at the schema level); well-formed entries survive."""
    case = {
        "id": "c1",
        "query": "q",
        "context": {
            "authorized_repos": [{"repo_id": "x"}, "junk", {"repo_id": "r", "graph_name": "G"}],
        },
    }
    payload = drivers.c_payload_for_case(case, deadline_ms=1000)
    assert payload["context"]["authorized_repos"] == [{"repo_id": "r", "graph_name": "G"}]


# ---------------------------------------------------------------------
# The venue-gap fixes this campaign shipped (issue #2167) — the graph-less
# case's default graph and the generation client's model-id spellings.
# ---------------------------------------------------------------------


def _load_driver(unique_name: str):
    """Load the shipped in-container driver by path (its file name carries
    dashes; the unique module name keeps repeated loads independent)."""
    import importlib.util

    driver_path = Path(drivers.__file__).parent / "config_b_driver.py"
    spec = importlib.util.spec_from_file_location(unique_name, driver_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_graph_reads_the_eval_env(monkeypatch):
    """The public-access default graph's NAME rides ``EVAL_DEFAULT_GRAPH``
    (the venue's legacy graph; GRAPH on the campaign venue) — unset falls
    back to GRAPH."""
    module = _load_driver("default_graph")
    monkeypatch.delenv("EVAL_DEFAULT_GRAPH", raising=False)
    assert module.default_graph() == "GRAPH"
    monkeypatch.setenv("EVAL_DEFAULT_GRAPH", "GRAPH_VENUE")
    assert module.default_graph() == "GRAPH_VENUE"


def test_b_context_uses_the_env_graph_for_a_graphless_case(monkeypatch):
    """A case declaring no graph set assembles the env-named default (never
    an empty set — the capability refuses one); a declared set survives."""
    module = _load_driver("ctx_graph")
    # build_context imports the CallerContext contract — the component tree
    # rides sys.path (the same seam the driver-exec tests use).
    agent_service = Path(__file__).resolve().parents[2] / "components" / "agent-service"
    monkeypatch.syspath_prepend(str(agent_service))
    monkeypatch.setenv("EVAL_DEFAULT_GRAPH", "GRAPH_VENUE")
    graphless = module.build_context({"id": "c1", "query": "q"})
    assert graphless.authorized_graph_names == ("GRAPH_VENUE",)
    declared = module.build_context(
        {"id": "c2", "query": "q", "context": {"authorized_graph_names": ["RESTRICTED"]}}
    )
    assert declared.authorized_graph_names == ("RESTRICTED",)


def test_c_payload_uses_the_env_graph_for_a_graphless_case(monkeypatch):
    """The C driver's payload carries the same default — one setting, both
    legs."""
    monkeypatch.setenv("EVAL_DEFAULT_GRAPH", "GRAPH_VENUE")
    payload = drivers.c_payload_for_case({"id": "c1", "query": "q"}, deadline_ms=1000)
    assert payload["context"]["authorized_graph_names"] == ["GRAPH_VENUE"]


def test_resolve_model_id_reads_both_client_spellings():
    """The deployed generation client reads its model id ASYNC (a bound
    coroutine method); a property-shaped client returns the value directly.
    A client with neither carries no id — None, never a crash (the bug that
    JSON-encoded a bound method into the resolved-env snapshot and killed
    the B leg's rows write)."""
    module = _load_driver("model_id")

    class AsyncClient:
        async def model_id(self):
            return "granite-4.1-8b"

    class PropertyClient:
        model_id = "granite-4.1-8b"

    class NoIdClient:
        pass

    assert module.resolve_model_id(AsyncClient()) == "granite-4.1-8b"
    assert module.resolve_model_id(PropertyClient()) == "granite-4.1-8b"
    assert module.resolve_model_id(NoIdClient()) is None
    assert module.resolve_model_id(None) is None


def test_the_c_run_propagates_its_own_traceparent():
    """The run's spans join the driver's trace — the exact handle on them.

    The agent's spans carry no run id (counters and ids only), so the
    propagated W3C trace id is the only exact way to fetch "this run's
    trace". Without it, a trace fetch could only guess out of a time
    window.
    """
    import urllib.request

    captured = {}

    class _FakeResponse:
        status = 200

        def read(self):
            return b""

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def __iter__(self):
            return iter(())

    def _fake_urlopen(request, timeout=None, context=None):
        captured["headers"] = dict(request.headers)
        captured["url"] = request.full_url
        return _FakeResponse()

    original = urllib.request.urlopen
    urllib.request.urlopen = _fake_urlopen
    try:
        stream = drivers.UrllibRunStream("http://agent/v1/runs", {"q": 1}, 5.0)
    finally:
        urllib.request.urlopen = original

    traceparent = captured["headers"].get("traceparent") or captured["headers"].get("Traceparent")
    assert traceparent, "the run request carries no traceparent"
    assert traceparent.startswith(f"00-{stream.trace_id}-")
    assert len(stream.trace_id) == 32
    assert len(stream.parent_span_id) == 16


def test_the_c_row_records_the_trace_id():
    """The row carries the trace its spans land in."""
    stream = FakeRunStream(events=[])
    row = drivers.run_one_case_c({"id": "x", "query": "q"}, base_url="u", transport=FakeCTransport(stream))
    assert row["trace_id"] == stream.trace_id
