# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/e01.py (+ capture-a and the e01 CLI wiring).

Every I/O matrix row through fakes — no live venue, no network: the capture's
query seam is a fake (the default imports run_eval verbatim; the seam
contract is what the fakes exercise), the manifests are synthetic, the rows
are fixture rows (no deployment case content). Proven here:

* capture-a records per-case answers/http_status/wall_ms/turn rows, keeps
  going on a per-case failure, resumes by missing id only, and writes its
  rows file atomically;
* the e01 report reports M-1..M-5 for BOTH configs with the surface named,
  digests every input, reproduces byte-identically under a pinned
  created_utc, applies a lineage-verified defect ledger (or records its
  absence), and refuses — before building — on a lineage mismatch, a
  config-C manifest on the B leg, a missing leg artifact or a
  lineage-mismatched ledger.
"""

import json
from pathlib import Path

import pytest
from protocol import drivers
from protocol.e01 import (
    E01Refusal,
    build_e01_report,
    e01_report_digest,
    reference_defects_file,
)
from protocol.manifest import build_manifest, manifest_digest, sha256_json
from protocol.run_protocol import cmd_capture_a, cmd_e01

CORPUS = "c" * 64
SET_SHA = "a" * 64
EVALUATOR_INSTRUCTIONS = str(Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md")
CREATED = "2026-11-22T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Fixtures — a composition-valid set, synthetic manifests, fixture rows
# ---------------------------------------------------------------------------


def _case(id_, query, case_class, access="public", **extra):
    return {
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


def _set_file(tmp_path, extra_answerable=("c1", "c2", "c3", "c4")):
    """A composition-VALID assessment set (the drivers enforce the floor on
    the data path): the requested ids are answerable public cases (`_`
    fillers carry every other required class and security scenario)."""
    entries = [_case(i, f"q {i}", "answerable") for i in extra_answerable]
    entries.append(_case("_ans-restricted", "restricted q", "answerable", access="restricted"))
    while sum(1 for e in entries if e["case_class"] == "answerable") < 2:
        entries.append(_case("_ans-pad", "padding q", "answerable"))
    entries.append(_case("_unans", "the unanswerable question", "unanswerable"))
    entries.append(_case("_cite", "the citation question", "citation_check"))
    entries.append(
        _case("_lang-ru", "Как подать заявление?", "representative_language", script="non-latin")
    )
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


def _manifests():
    """The synthetic leg manifests: a reference config-A manifest and a gated
    config-B manifest sharing corpus + set, with DIFFERENT prompt digests and
    model ids (the uncontrolled-difference evidence)."""
    reference = build_manifest(
        kind="reference",
        config="A",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": CORPUS},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": SET_SHA}},
        configuration={
            "A": {
                "resolved_env": {"CHATQNA_CONTAINER": "x"},
                "model_ids": {"llm": "legacy-model-a"},
                "prompt_digests": {"system": "digest-a"},
            }
        },
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        pair="E01",
        created_utc=CREATED,
    )
    gated = build_manifest(
        kind="gated",
        config="B",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": CORPUS},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": SET_SHA}},
        configuration={
            "B": {
                "resolved_env": {"AGENT_X": "1"},
                "model_ids": {"llm": "granite-4.1-8b"},
                "prompt_digests": {"system": "digest-b"},
            }
        },
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        lineage={"reference_manifest_sha256": manifest_digest(reference), "thresholds_sha256": "t" * 64},
        pair="E01",
        created_utc=CREATED,
    )
    return reference, gated


def _anchor_report():
    return {
        "per_query": [{"id": "c1", "recall": 1.0}, {"id": "c2", "recall": 0.0}],
        "aggregate": {"n": 2, "recall": 0.5, "precision": 0.6, "ndcg_at_10": 0.4},
        "n_missed_traces": 0,
        "n_unmapped_chunk_keys": 0,
    }


def _captured_rows():
    return {
        "c1": {
            "case_id": "c1",
            "status": "ok",
            "http_status": 200,
            "answer": "the answer",
            "source_documents": [{"document_id": "d1"}],
            "wall_ms": 10.0,
        },
        "c2": {"case_id": "c2", "status": "http_error", "http_status": 500, "error": "boom", "wall_ms": 20.0},
        "c3": {
            "case_id": "c3",
            "status": "failure",
            "error_type": "HarnessError",
            "error": "docker down",
            "wall_ms": 30.0,
        },
    }


def _b_rows():
    return {
        "c1": {
            "case_id": "c1",
            "status": "ok",
            "answer": "the answer",
            "abstained": False,
            "abstention_reason": None,
            "source_documents": [{"document_id": "d1"}],
            "metadata": {},
            "wall_ms": 100.0,
        },
        "c2": {
            "case_id": "c2",
            "status": "ok",
            "answer": "",
            "abstained": True,
            "abstention_reason": "insufficient_evidence",
            "source_documents": [],
            "metadata": {},
            "wall_ms": 200.0,
        },
        "c3": {
            "case_id": "c3",
            "status": "failure",
            "error_type": "LaneBusyError",
            "error": "lane busy",
            "wall_ms": 1.0,
        },
    }


def _build(reference=None, gated=None, **kw):
    reference = reference if reference is not None else _manifests()[0]
    gated = gated if gated is not None else _manifests()[1]
    args = dict(
        reference_manifest=reference,
        gated_manifest=gated,
        anchor_report=_anchor_report(),
        captured_rows=_captured_rows(),
        b_rows=_b_rows(),
        created_utc=CREATED,
    )
    args.update(kw)
    return build_e01_report(**args)


# ---------------------------------------------------------------------------
# capture-a — the fake query seam
# ---------------------------------------------------------------------------


def _seam(answers, *, statuses=None, failures=(), sources_by_id=None):
    """The fake seam (the contract the default wraps run_eval into):
    ``entry -> {"http_status", "body", "answer"}``; an id in ``failures``
    raises (the transport-death shape)."""
    calls = []

    def seam(entry):
        calls.append(entry["id"])
        if entry["id"] in failures:
            raise OSError("docker exec failed: transport down")
        status = (statuses or {}).get(entry["id"], 200)
        body = {"response": answers.get(entry["id"], "")}
        if entry["id"] in (sources_by_id or {}):
            body["metadata"] = {"source_documents": sources_by_id[entry["id"]], "citations": ["cit-1"]}
        return {
            "http_status": status,
            "body": json.dumps(body),
            "answer": answers.get(entry["id"], ""),
        }

    return seam, calls


def _expected_ids(set_path):
    """The ids the capture writes: every case of the set, multi-turn cases
    expanded into their turn-indexed ids (the shared turn expansion)."""
    from protocol.evalset import load_set, turn_entries

    _, entries = load_set(set_path, kind="assessment")
    return {entry["id"] for case in entries for entry in turn_entries(case)}


def test_capture_a_records_per_case_rows_with_timing_and_turn_ids(tmp_path):
    set_path = _set_file(tmp_path, extra_answerable=("c1", "mt"))
    # The multi-turn case: two turns — the seam answers per turn id.
    entries = json.loads(set_path.read_text(encoding="utf-8"))["entries"]
    for entry in entries:
        if entry["id"] == "mt":
            entry["turns"] = [{"query": "turn one"}, {"query": "turn two"}]
    set_path.write_text(json.dumps({"_meta": {"provenance": "assessment"}, "entries": entries}), encoding="utf-8")

    seam, calls = _seam({"c1": "answer c1", "mt#t1": "answer t1", "mt#t2": "answer t2"})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam)
    expected = _expected_ids(set_path)
    assert set(calls) == expected
    row = result["rows"]["c1"]
    assert row["status"] == "ok"
    assert row["http_status"] == 200
    assert row["answer"] == "answer c1"
    assert isinstance(row["wall_ms"], float)
    t1 = result["rows"]["mt#t1"]
    assert t1["turn"] == 1
    assert t1["answer"] == "answer t1"
    # The rows file is written atomically to the stable path.
    written = json.loads(Path(result["rows_path"]).read_text(encoding="utf-8"))
    assert set(written["cases"]) == expected


def test_capture_a_records_source_fields_only_when_the_response_carries_them(tmp_path):
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    seam, _ = _seam(
        {"c1": "a1", "c2": "a2"},
        sources_by_id={"c1": [{"document_id": "d1"}]},
    )
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam)
    assert result["rows"]["c1"]["source_documents"] == [{"document_id": "d1"}]
    assert result["rows"]["c1"]["citations"] == ["cit-1"]
    # Absent on the response → absent on the row (never invented).
    assert "source_documents" not in result["rows"]["c2"]
    assert "citations" not in result["rows"]["c2"]


def test_capture_a_http_error_and_failure_rows_record_and_run_continues(tmp_path):
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2", "c3"))
    seam, _ = _seam({"c1": "a1"}, statuses={"c2": 500}, failures=("c3",))
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam)
    rows = result["rows"]
    expected = _expected_ids(set_path)
    assert set(rows) == expected
    assert rows["c2"]["status"] == "http_error"
    assert rows["c2"]["http_status"] == 500
    assert "answer" not in rows["c2"]
    assert rows["c3"]["status"] == "failure"
    assert rows["c3"]["error_type"] == "OSError"
    assert "wall_ms" in rows["c3"]


def test_capture_a_resume_re_runs_only_the_missing_ids(tmp_path):
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2", "c3"))
    expected = _expected_ids(set_path)
    first, first_calls = _seam({"c1": "a1", "c2": "a2", "c3": "a3"})
    drivers.run_config_a_capture(set_path, tmp_path / "out", query=first)
    assert set(first_calls) == expected

    # A converged resume: no seam call at all.
    converged, converged_calls = _seam({})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=converged)
    assert converged_calls == []
    assert result["pending_ids"] == []

    # A partial prior file: ONLY the missing ids run.
    rows_path = tmp_path / "out" / "config-a.captured.json"
    data = json.loads(rows_path.read_text(encoding="utf-8"))
    data["cases"] = {"c2": data["cases"]["c2"]}
    rows_path.write_text(json.dumps(data), encoding="utf-8")
    resumed, resumed_calls = _seam({"c1": "a1", "c3": "a3"})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=resumed)
    assert set(resumed_calls) == expected - {"c2"}
    assert set(result["rows"]) == expected
    assert result["rows"]["c2"]["answer"] == "a2"


def test_capture_a_default_seam_is_the_run_eval_reuse(monkeypatch):
    """The default seam imports run_eval VERBATIM — drive_query + _extract_answer,
    not a re-implementation."""
    import sys
    import types

    fake_run_eval = types.ModuleType("run_eval")
    seen = {}

    def drive_query(entry):
        seen["entry"] = entry
        return 0.0, '{"response": "parsed"}', 200

    fake_run_eval.drive_query = drive_query
    fake_run_eval._extract_answer = lambda body: "parsed"
    monkeypatch.setitem(sys.modules, "run_eval", fake_run_eval)
    result = drivers._default_a_query({"id": "c1", "query": "q"})
    assert seen["entry"]["id"] == "c1"
    assert result == {"http_status": 200, "body": '{"response": "parsed"}', "answer": "parsed"}


# ---------------------------------------------------------------------------
# e01 — the consistent-legs build
# ---------------------------------------------------------------------------


def test_e01_reports_all_five_dimensions_for_both_configs_with_named_surfaces():
    report = _build()
    assert report["artifact"] == "e01-report"
    dimensions = report["dimensions"]
    assert set(dimensions) == {"M-1", "M-2", "M-3", "M-4", "M-5"}
    assert [dimensions[key]["dimension"] for key in ("M-1", "M-2", "M-3", "M-4", "M-5")] == [
        "retrieval_quality",
        "answer_grounding",
        "abstention_correctness",
        "latency",
        "resource_consumption",
    ]
    for key in dimensions:
        for config in ("A", "B"):
            record = dimensions[key][config]
            assert record["measurement_surface"], f"{key}/{config} carries no surface"
    # M-1: A chunk-level (the anchor aggregate), B doc-level with the
    # chunk-level absence named — never silently dropped.
    assert dimensions["M-1"]["A"]["values"]["recall"] == 0.5
    assert dimensions["M-1"]["A"]["values"]["n_missed_traces"] == 0
    assert dimensions["M-1"]["B"]["available"] is True
    assert dimensions["M-1"]["B"]["values"]["n_rows_with_source_documents"] == 1
    assert dimensions["M-1"]["B"]["values"]["n_rows_with_empty_source_documents"] == 1
    assert any("chunk-level" in note for note in dimensions["M-1"]["B"]["notes"])
    # M-3: A judged from the answer text, B mechanical fields.
    assert dimensions["M-3"]["A"]["values"]["n_empty_answers"] == 0
    assert dimensions["M-3"]["B"]["values"]["n_abstained"] == 1
    assert dimensions["M-3"]["B"]["values"]["n_with_abstention_reason"] == 1
    # M-4: latency triples on both sides (compute_triples), non-ok rows excluded.
    assert dimensions["M-4"]["A"]["values"]["median"] == 10.0
    assert dimensions["M-4"]["A"]["values"]["n_excluded_non_ok_rows"] == 2
    assert dimensions["M-4"]["B"]["values"]["median"] == 150.0
    assert dimensions["M-4"]["B"]["values"]["n_excluded_non_ok_rows"] == 1
    # M-5: no surface on either leg — recorded not available WITH the reason.
    assert dimensions["M-5"]["A"]["available"] is False
    assert dimensions["M-5"]["A"]["not_available_reason"]
    assert dimensions["M-5"]["B"]["available"] is False
    assert dimensions["M-5"]["B"]["not_available_reason"]


def test_e01_per_case_records_carry_judgment_inputs_and_never_verdicts():
    report = _build()
    per_case = report["per_case"]
    assert set(per_case) == {"c1", "c2", "c3"}
    assert per_case["c1"]["a"]["answer"] == "the answer"
    assert per_case["c1"]["b"]["abstained"] is False
    assert per_case["c2"]["b"]["abstention_reason"] == "insufficient_evidence"
    assert per_case["c3"]["a"]["status"] == "failure"
    # No verdict anywhere in the per-case records — the report carries the
    # judgment INPUTS only.
    for record in per_case.values():
        assert set(record) == {"a", "b", "reference_defect"}
        for row in (record["a"], record["b"]):
            assert row is None or not any(key == "verdict" for key in row)
    counts = report["counts"]
    assert counts == {
        "n_cases": 3,
        "a_recorded": 3,
        "b_recorded": 3,
        "a_missing": 0,
        "b_missing": 0,
        "reference_defect_cases": 0,
    }


def test_e01_report_redacts_credential_named_keys_from_per_case_rows():
    rows = _b_rows()
    rows["c1"]["API_TOKEN"] = "must-not-leak"
    report = _build(b_rows=rows)
    assert "API_TOKEN" not in report["per_case"]["c1"]["b"]


def test_e01_redacts_nested_credential_named_keys_too():
    """The manifest's redaction is top-level only — a row's nested metadata
    would carry a credential straight into the report."""
    rows = _b_rows()
    rows["c1"]["metadata"] = {"api_key": "must-not-leak", "nested": {"client_secret": "must-not-leak-either"}}
    report = _build(b_rows=rows)
    metadata = report["per_case"]["c1"]["b"]["metadata"]
    assert "api_key" not in metadata
    assert "client_secret" not in metadata["nested"]
    assert "must-not-leak" not in json.dumps(report)


def test_e01_m5_reports_the_resource_record_the_b_rows_carry():
    """M-5 for config B is read from the rows — no resource record in the data
    means no surface, never a claim the rows do not support."""
    rows = _b_rows()
    report = _build(b_rows=rows)
    assert report["dimensions"]["M-5"]["B"]["available"] is False
    assert report["dimensions"]["M-5"]["B"]["not_available_reason"]

    rows["c1"]["metadata"] = {"usage": {"prompt_tokens": 12}}
    report = _build(b_rows=rows)
    assert report["dimensions"]["M-5"]["B"]["available"] is True
    assert report["dimensions"]["M-5"]["B"]["values"]["usage"] == {"prompt_tokens": 12}


def test_e01_uncontrolled_differences_identified_from_recorded_evidence():
    reference, gated = _manifests()
    report = _build(reference=reference, gated=gated, seed=42)
    diff = report["uncontrolled_differences"]
    assert diff["prompt_digests"]["A"] == {"system": "digest-a"}
    assert diff["prompt_digests"]["B"] == {"system": "digest-b"}
    assert diff["prompt_digests"]["identical"] is False
    assert diff["model_ids"]["identical"] is False
    assert diff["model_ids"]["A"] == {"llm": "legacy-model-a"}
    assert diff["execution_conditions"]["seed"] == 42
    assert "sequential anchor pass" in diff["execution_conditions"]["A"]
    assert "batched B lanes" in diff["execution_conditions"]["B"]
    assert diff["cache_state"] == {
        "recorded": False,
        "note": "cache state is unrecorded by the harness (FR-27) — the two legs' cache conditions are uncontrolled",
    }
    assert diff["retrieval_surface_asymmetry"]["intentional_difference"] == "retrieval_backend"
    # Without a seed the fact records as not recorded — never invented.
    unseeded = _build(reference=reference, gated=gated)
    assert unseeded["uncontrolled_differences"]["execution_conditions"]["seed"] == "not recorded"


def test_e01_inputs_are_digested_and_the_report_is_reproducible_under_the_pin():
    reference, gated = _manifests()
    anchor = _anchor_report()
    captured = _captured_rows()
    b_rows = _b_rows()
    kw = dict(
        reference_manifest=reference,
        gated_manifest=gated,
        anchor_report=anchor,
        captured_rows=captured,
        b_rows=b_rows,
    )
    first = build_e01_report(created_utc=CREATED, **kw)
    second = build_e01_report(created_utc=CREATED, **kw)
    assert first == second
    assert first["digest"] == second["digest"]
    assert first["digest"] == e01_report_digest(first)
    inputs = first["inputs"]
    assert inputs["reference_manifest_sha256"] == manifest_digest(reference)
    assert inputs["gated_manifest_sha256"] == manifest_digest(gated)
    assert inputs["anchor_report_sha256"] == sha256_json(anchor)
    assert inputs["captured_rows_sha256"] == sha256_json(captured)
    assert inputs["b_rows_sha256"] == sha256_json(b_rows)
    assert inputs["corpus_fingerprint"] == CORPUS
    assert inputs["assessment_set_sha256"] == SET_SHA
    assert inputs["reference_defects_sha256"] is None
    # A different pin produces a different digest — the pin is part of the identity.
    assert build_e01_report(created_utc="2026-11-23T00:00:00+00:00", **kw)["digest"] != first["digest"]
    # A changed input changes the digest (the join is digest-pinned).
    moved = dict(anchor)
    moved["aggregate"] = dict(anchor["aggregate"], recall=0.9)
    moved_kw = {key: value for key, value in kw.items() if key != "anchor_report"}
    assert build_e01_report(created_utc=CREATED, anchor_report=moved, **moved_kw)["digest"] != first["digest"]


# ---------------------------------------------------------------------------
# e01 — the reference-defects ledger (FR-26)
# ---------------------------------------------------------------------------


def test_reference_defects_file_mirrors_the_lineage_field_shape():
    reference, _ = _manifests()
    ledger = reference_defects_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference,
        defects=[{"case_ids": ["c2"], "summary": "known anchor defect: the trace fetch times out"}],
    )
    assert ledger["artifact"] == "reference-defects"
    assert ledger["corpus_fingerprint"] == CORPUS
    assert ledger["assessment_set_sha256"] == SET_SHA
    assert ledger["reference_manifest_sha256"] == manifest_digest(reference)
    assert ledger["defects"][0]["case_ids"] == ["c2"]


def test_e01_records_an_absent_ledger_and_a_failures_stand_as_plain_results():
    report = _build()
    assert report["reference_defects"]["present"] is False
    assert report["reference_defects"]["sha256"] is None
    assert "FR-26" in report["reference_defects"]["note"]
    # The A failure row is a plain comparison result — no defect flag invented.
    assert all(record["reference_defect"] is False for record in report["per_case"].values())
    assert report["counts"]["reference_defect_cases"] == 0


def test_e01_applies_a_lineage_verified_ledger_and_flags_the_cases():
    reference, gated = _manifests()
    ledger = reference_defects_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference,
        defects=[{"case_ids": ["c3"], "summary": "known A defect on c3"}],
    )
    report = _build(reference=reference, gated=gated, defects=ledger)
    assert report["reference_defects"]["present"] is True
    assert report["reference_defects"]["sha256"] == sha256_json(ledger)
    assert report["reference_defects"]["applied_case_ids"] == ["c3"]
    assert report["per_case"]["c3"]["reference_defect"] is True
    assert report["per_case"]["c1"]["reference_defect"] is False
    assert report["counts"]["reference_defect_cases"] == 1
    assert report["inputs"]["reference_defects_sha256"] == sha256_json(ledger)


def test_e01_defect_flag_inherits_to_turn_rows():
    reference, gated = _manifests()
    ledger = reference_defects_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference,
        defects=[{"case_ids": ["mt"], "summary": "known A defect on the multi-turn case"}],
    )
    captured = {**_captured_rows(), "mt#t1": {"case_id": "mt#t1", "status": "ok", "answer": "", "wall_ms": 5.0}}
    report = _build(reference=reference, gated=gated, captured_rows=captured, defects=ledger)
    assert report["per_case"]["mt#t1"]["reference_defect"] is True


# ---------------------------------------------------------------------------
# e01 — the typed refusals, before any building
# ---------------------------------------------------------------------------


def test_e01_refuses_a_lineage_mismatch_naming_the_field():
    reference, gated = _manifests()
    other_corpus = build_manifest(
        kind="gated",
        config="B",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": "9" * 64},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": SET_SHA}},
        configuration={"B": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        lineage={"reference_manifest_sha256": manifest_digest(reference), "thresholds_sha256": "t" * 64},
        pair="E01",
        created_utc=CREATED,
    )
    with pytest.raises(E01Refusal) as failed:
        _build(reference=reference, gated=other_corpus)
    assert failed.value.reason == "lineage_mismatch"
    assert "corpus fingerprint" in str(failed.value)

    other_set = build_manifest(
        kind="gated",
        config="B",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": CORPUS},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": "b" * 64}},
        configuration={"B": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        lineage={"reference_manifest_sha256": manifest_digest(reference), "thresholds_sha256": "t" * 64},
        pair="E01",
        created_utc=CREATED,
    )
    with pytest.raises(E01Refusal) as failed:
        _build(reference=reference, gated=other_set)
    assert failed.value.reason == "lineage_mismatch"
    assert "assessment set digest" in str(failed.value)


def test_e01_refuses_a_config_c_manifest_on_the_b_leg():
    reference, _ = _manifests()
    config_c = build_manifest(
        kind="gated",
        config="C",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": CORPUS},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": SET_SHA}},
        configuration={"C": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        lineage={"reference_manifest_sha256": manifest_digest(reference), "thresholds_sha256": "t" * 64},
        pair="E02",
        created_utc=CREATED,
    )
    with pytest.raises(E01Refusal) as failed:
        _build(reference=reference, gated=config_c)
    assert failed.value.reason == "wrong_leg"
    assert "E02" in str(failed.value)


def test_e01_refuses_a_non_gated_manifest_on_the_b_leg():
    reference, _ = _manifests()
    with pytest.raises(E01Refusal) as failed:
        _build(gated=reference)  # a reference manifest where the gated B manifest belongs
    assert failed.value.reason == "wrong_leg"


def test_e01_refuses_a_missing_leg_artifact_naming_it():
    reference, gated = _manifests()
    cases = [
        ("reference_manifest", {}),
        ("gated_manifest", {}),
        ("anchor_report", {}),
        ("captured_rows", {}),
        ("b_rows", {}),
    ]
    for field, value in cases:
        kw = {field: value}
        with pytest.raises(E01Refusal) as failed:
            _build(**kw)
        assert failed.value.reason == "missing_artifact"
        assert field.split("_")[0] in str(failed.value)


def test_e01_refuses_a_lineage_mismatched_ledger_before_building():
    reference, gated = _manifests()
    other_reference, _ = _manifests()
    # A ledger recorded against a DIFFERENT reference manifest (different digest).
    ledger = reference_defects_file(
        corpus_fingerprint="9" * 64,
        assessment_set_sha256=SET_SHA,
        reference_manifest=other_reference,
        defects=[{"case_ids": ["c3"], "summary": "defect against some other corpus"}],
    )
    with pytest.raises(E01Refusal) as failed:
        _build(reference=reference, gated=gated, defects=ledger)
    assert failed.value.reason == "defects_lineage_mismatch"
    assert "corpus fingerprint" in str(failed.value)


def test_e01_refuses_a_file_that_is_not_a_ledger():
    with pytest.raises(E01Refusal) as failed:
        _build(defects={"artifact": "evaluation-thresholds"})
    assert failed.value.reason == "defects_not_a_ledger"


# ---------------------------------------------------------------------------
# The CLI wiring
# ---------------------------------------------------------------------------


def test_capture_a_cli_writes_the_rows_file(tmp_path, monkeypatch):
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    seam, _ = _seam({"c1": "a1", "c2": "a2"})
    import protocol.run_protocol as rp

    original = rp.run_config_a_capture
    monkeypatch.setattr(
        rp,
        "run_config_a_capture",
        lambda set_path_arg, out_dir, entries=None: original(set_path_arg, out_dir, entries=entries, query=seam),
    )
    args = type("Args", (), {"set_path": str(set_path), "out_dir": str(tmp_path / "out")})()
    assert cmd_capture_a(args) == 0
    assert (tmp_path / "out" / "config-a.captured.json").exists()


def test_capture_a_cli_refuses_an_under_composed_set(tmp_path):
    (tmp_path / "set.json").write_text(
        json.dumps({"_meta": {"provenance": "assessment"}, "entries": [_case("c1", "q", "answerable")]}),
        encoding="utf-8",
    )
    args = type("Args", (), {"set_path": str(tmp_path / "set.json"), "out_dir": str(tmp_path / "out")})()
    assert cmd_capture_a(args) == 1


def test_e01_cli_builds_the_report_and_prints_the_digest(tmp_path, capsys):
    reference, gated = _manifests()
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "reference.manifest.json").write_text(json.dumps(reference), encoding="utf-8")
    (run_dir / "config-b.manifest.json").write_text(json.dumps(gated), encoding="utf-8")
    (run_dir / "config-a.report.json").write_text(json.dumps(_anchor_report()), encoding="utf-8")
    (run_dir / "config-a.captured.json").write_text(json.dumps({"cases": _captured_rows()}), encoding="utf-8")
    (run_dir / "config-b.rows.json").write_text(json.dumps({"cases": _b_rows()}), encoding="utf-8")
    out = tmp_path / "e01.report.json"
    args = type(
        "Args",
        (),
        {
            "reference_manifest": str(run_dir / "reference.manifest.json"),
            "gated_manifest": str(run_dir / "config-b.manifest.json"),
            "anchor_report": str(run_dir / "config-a.report.json"),
            "captured_rows": str(run_dir / "config-a.captured.json"),
            "b_rows": str(run_dir / "config-b.rows.json"),
            "defects": None,
            "out": str(out),
            "created_utc": CREATED,
            "seed": None,
        },
    )()
    assert cmd_e01(args) == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["artifact"] == "e01-report"
    assert set(report["dimensions"]) == {"M-1", "M-2", "M-3", "M-4", "M-5"}
    assert report["digest"] == e01_report_digest(report)
    stdout = capsys.readouterr().out
    assert report["digest"][:12] in stdout
    # A rebuild under the same pin reproduces the file byte-identically.
    assert cmd_e01(args) == 0
    assert out.read_text(encoding="utf-8") == json.dumps(report, indent=2, ensure_ascii=False)


def test_e01_cli_passes_the_ledger_through(tmp_path):
    reference, gated = _manifests()
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "reference.manifest.json").write_text(json.dumps(reference), encoding="utf-8")
    (run_dir / "config-b.manifest.json").write_text(json.dumps(gated), encoding="utf-8")
    (run_dir / "config-a.report.json").write_text(json.dumps(_anchor_report()), encoding="utf-8")
    (run_dir / "config-a.captured.json").write_text(json.dumps({"cases": _captured_rows()}), encoding="utf-8")
    (run_dir / "config-b.rows.json").write_text(json.dumps({"cases": _b_rows()}), encoding="utf-8")
    ledger = reference_defects_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference,
        defects=[{"case_ids": ["c3"], "summary": "known A defect"}],
    )
    (run_dir / "reference.defects.json").write_text(json.dumps(ledger), encoding="utf-8")
    out = tmp_path / "e01.report.json"
    args = type(
        "Args",
        (),
        {
            "reference_manifest": str(run_dir / "reference.manifest.json"),
            "gated_manifest": str(run_dir / "config-b.manifest.json"),
            "anchor_report": str(run_dir / "config-a.report.json"),
            "captured_rows": str(run_dir / "config-a.captured.json"),
            "b_rows": str(run_dir / "config-b.rows.json"),
            "defects": str(run_dir / "reference.defects.json"),
            "out": str(out),
            "created_utc": CREATED,
            "seed": None,
        },
    )()
    assert cmd_e01(args) == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["reference_defects"]["present"] is True
    assert report["per_case"]["c3"]["reference_defect"] is True


def test_e01_cli_refuses_a_missing_leg_artifact_naming_it(tmp_path, capsys):
    reference, gated = _manifests()
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "reference.manifest.json").write_text(json.dumps(reference), encoding="utf-8")
    (run_dir / "config-b.manifest.json").write_text(json.dumps(gated), encoding="utf-8")
    (run_dir / "config-a.report.json").write_text(json.dumps(_anchor_report()), encoding="utf-8")
    (run_dir / "config-a.captured.json").write_text(json.dumps({"cases": _captured_rows()}), encoding="utf-8")
    # config-b.rows.json deliberately absent.
    args = type(
        "Args",
        (),
        {
            "reference_manifest": str(run_dir / "reference.manifest.json"),
            "gated_manifest": str(run_dir / "config-b.manifest.json"),
            "anchor_report": str(run_dir / "config-a.report.json"),
            "captured_rows": str(run_dir / "config-a.captured.json"),
            "b_rows": str(run_dir / "config-b.rows.json"),
            "defects": None,
            "out": str(tmp_path / "e01.report.json"),
            "created_utc": CREATED,
            "seed": None,
        },
    )()
    assert cmd_e01(args) == 1
    assert "B rows" in capsys.readouterr().err
    assert not (tmp_path / "e01.report.json").exists()


def test_e01_cli_refuses_a_lineage_mismatch_through_the_main_gate():
    """main() maps E01Refusal to the typed refusal exit (1), like the other
    protocol refusals."""
    from protocol.run_protocol import main

    reference, gated = _manifests()
    # The gated manifest carries a different corpus fingerprint → refusal.
    other = build_manifest(
        kind="gated",
        config="B",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": "9" * 64},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": SET_SHA}},
        configuration={"B": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        lineage={"reference_manifest_sha256": manifest_digest(reference), "thresholds_sha256": "t" * 64},
        pair="E01",
        created_utc=CREATED,
    )
    argv = [
        "e01",
        "--reference-manifest", "/nonexistent/reference.json",
        "--gated-manifest", "/nonexistent/gated.json",
        "--anchor-report", "/nonexistent/anchor.json",
        "--captured-rows", "/nonexistent/captured.json",
        "--b-rows", "/nonexistent/b.json",
        "--out", "/tmp/e01-should-not-exist.json",
    ]
    assert main(argv) == 1  # the missing files refuse before anything builds
    # And the typed refusal from the BUILDER also maps to exit 1 (unreadable
    # files refuse in the CLI; the lineage mismatch surfaces through build).
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp)
        (run_dir / "reference.manifest.json").write_text(json.dumps(reference), encoding="utf-8")
        (run_dir / "config-b.manifest.json").write_text(json.dumps(other), encoding="utf-8")
        (run_dir / "config-a.report.json").write_text(json.dumps(_anchor_report()), encoding="utf-8")
        (run_dir / "config-a.captured.json").write_text(json.dumps({"cases": _captured_rows()}), encoding="utf-8")
        (run_dir / "config-b.rows.json").write_text(json.dumps({"cases": _b_rows()}), encoding="utf-8")
        argv_lineage = [
            "e01",
            "--reference-manifest", str(run_dir / "reference.manifest.json"),
            "--gated-manifest", str(run_dir / "config-b.manifest.json"),
            "--anchor-report", str(run_dir / "config-a.report.json"),
            "--captured-rows", str(run_dir / "config-a.captured.json"),
            "--b-rows", str(run_dir / "config-b.rows.json"),
            "--out", str(run_dir / "e01.report.json"),
        ]
        assert main(argv_lineage) == 1
        assert not (run_dir / "e01.report.json").exists()
