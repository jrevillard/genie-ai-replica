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

import argparse
import json
import re
import sys
from pathlib import Path

import pytest

from protocol import drivers
from protocol.evalset import evaluation_surface
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


def _set_file(tmp_path, extra_answerable=("c1", "c2", "c3", "c4")):
    """A composition-VALID assessment set (the drivers enforce the floor on
    the data path): the requested ids are answerable public cases (`_`
    fillers carry every other required class and security scenario)."""
    entries = [_case(i, f"q {i}", "answerable") for i in extra_answerable]
    entries.append(_case("_ans-restricted", "restricted q", "answerable", access="restricted"))
    entries.append(_case("_unans", "the unanswerable question", "unanswerable"))
    entries.append(_case("_cite", "the citation question", "citation_check"))
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


def _patch_case(set_path, case_id, **fields):
    """Patch one case of a set file in place (the set file's shape is written
    in one place only)."""
    entries = json.loads(set_path.read_text(encoding="utf-8"))["entries"]
    for entry in entries:
        if entry["id"] == case_id:
            entry.update(fields)
    set_path.write_text(json.dumps({"_meta": {"provenance": "assessment"}, "entries": entries}), encoding="utf-8")
    return set_path


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
            "abstained": False,
            "wall_ms": 10.0,
            "retrieval_scope": {
                "sent_labels": {"category_labels": [], "service_labels": []},
                "case_requested_labels": [],
            },
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


def _capture_stamp(set_sha=SET_SHA, corpus=CORPUS):
    """The stamp `capture-a` writes into its rows file: the assessment-set
    digest and the corpus fingerprint the capture ran under, plus the
    protocol package's own code identity (the reuse identity a protocol
    change moves)."""
    return {
        "assessment_set_sha256": set_sha,
        "corpus_fingerprint": corpus,
        "protocol_code_sha256": drivers.current_protocol_code_sha(),
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
            "metadata": {"filter_labels": []},
            "wall_ms": 100.0,
        },
        "c2": {
            "case_id": "c2",
            "status": "ok",
            "answer": "",
            "abstained": True,
            "abstention_reason": "insufficient_evidence",
            "source_documents": [],
            "metadata": {"filter_labels": []},
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
    default_reference, default_gated = _manifests()
    reference = reference if reference is not None else default_reference
    gated = gated if gated is not None else default_gated
    captured_rows = kw.pop("captured_rows", None)
    capture_stamp = kw.pop("capture_stamp", _capture_stamp())
    args = dict(
        reference_manifest=reference,
        gated_manifest=gated,
        anchor_report=_anchor_report(),
        capture={"cases": captured_rows if captured_rows is not None else _captured_rows()},
        b_rows=_b_rows(),
        created_utc=CREATED,
    )
    args["capture"]["capture"] = capture_stamp
    args.update(kw)
    return build_e01_report(**args)


# ---------------------------------------------------------------------------
# capture-a — the fake query seam
# ---------------------------------------------------------------------------


def _seam(answers, *, statuses=None, failures=(), sources_by_id=None, filter_labels_by_id=None):
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
        metadata = {}
        if entry["id"] in (sources_by_id or {}):
            metadata["source_documents"] = sources_by_id[entry["id"]]
            metadata["citations"] = ["cit-1"]
        if entry["id"] in (filter_labels_by_id or {}):
            metadata["filter_labels"] = filter_labels_by_id[entry["id"]]
        if metadata:
            body["metadata"] = metadata
        return {
            "http_status": status,
            "body": json.dumps(body),
            "answer": answers.get(entry["id"], ""),
        }

    return seam, calls


def _security_case_ids(set_path):
    """The set's security-scenario case ids — config A never queries them."""
    from protocol.evalset import load_set

    _, entries = load_set(set_path, kind="assessment")
    return {case["id"] for case in entries if case.get("security_scenario")}


def _expected_ids(set_path):
    """The ids the capture writes: every case of the set, multi-turn cases
    expanded into their turn-indexed ids (the shared turn expansion)."""
    from protocol.evalset import load_set, turn_entries

    _, entries = load_set(set_path, kind="assessment")
    return {entry["id"] for case in entries for entry in turn_entries(case)}


def test_capture_a_records_per_case_rows_with_timing_and_turn_ids(tmp_path):
    set_path = _set_file(tmp_path, extra_answerable=("c1", "mt"))
    # The multi-turn case: two turns — the seam answers per turn id.
    _patch_case(set_path, "mt", turns=[{"query": "turn one"}, {"query": "turn two"}])

    seam, calls = _seam({"c1": "answer c1", "mt#t1": "answer t1", "mt#t2": "answer t2"})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    expected = _expected_ids(set_path)
    security = _security_case_ids(set_path)
    assert set(calls) == {cid for cid in expected if cid.split("#")[0] not in security}
    assert set(result["rows"]) == expected
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
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    assert result["rows"]["c1"]["source_documents"] == [{"document_id": "d1"}]
    assert result["rows"]["c1"]["citations"] == ["cit-1"]
    # Absent on the response → absent on the row (never invented).
    assert "source_documents" not in result["rows"]["c2"]
    assert "citations" not in result["rows"]["c2"]


def test_capture_a_http_error_and_failure_rows_record_and_run_continues(tmp_path):
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2", "c3"))
    seam, _ = _seam({"c1": "a1"}, statuses={"c2": 500}, failures=("c3",))
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
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
    drivers.run_config_a_capture(set_path, tmp_path / "out", query=first, corpus_fingerprint=CORPUS)
    security = _security_case_ids(set_path)
    assert set(first_calls) == {cid for cid in expected if cid.split("#")[0] not in security}

    # A converged resume: no seam call at all.
    converged, converged_calls = _seam({})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=converged, corpus_fingerprint=CORPUS)
    assert converged_calls == []
    assert result["pending_ids"] == []
    # The stamp is on disk — a converged resume must not leave a bare rows file.
    on_disk = json.loads((tmp_path / "out" / "config-a.captured.json").read_text(encoding="utf-8"))
    assert on_disk["capture"]["corpus_fingerprint"] == CORPUS
    assert on_disk["capture"]["assessment_set_sha256"]

    # A partial prior file: ONLY the missing ids run.
    rows_path = tmp_path / "out" / "config-a.captured.json"
    data = json.loads(rows_path.read_text(encoding="utf-8"))
    data["cases"] = {"c2": data["cases"]["c2"]}
    rows_path.write_text(json.dumps(data), encoding="utf-8")
    resumed, resumed_calls = _seam({"c1": "a1", "c3": "a3"})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=resumed, corpus_fingerprint=CORPUS)
    assert set(resumed_calls) == {cid for cid in expected if cid.split("#")[0] not in security} - {"c2"}
    assert set(result["rows"]) == expected
    assert result["rows"]["c2"]["answer"] == "a2"


def test_capture_a_default_seam_is_the_run_eval_reuse(monkeypatch):
    """The default seam imports run_eval VERBATIM — drive_query + _extract_answer,
    not a re-implementation."""
    import types

    fake_run_eval = types.ModuleType("run_eval")
    seen = {"refreshes": [], "drives": 0}

    def drive_query(entry):
        seen["entry"] = entry
        seen["drives"] += 1
        if seen["drives"] == 1:
            return 0.0, '{"response": "parsed"}', 401
        return 0.0, '{"response": "parsed"}', 200

    fake_run_eval.drive_query = drive_query
    fake_run_eval._extract_answer = lambda body: "parsed"
    fake_run_eval._maybe_refresh_token = lambda force=False: seen["refreshes"].append(force) or True
    fake_run_eval._refresh_configured = lambda: True
    monkeypatch.setitem(sys.modules, "run_eval", fake_run_eval)
    result = drivers._default_a_query({"id": "c1", "query": "q"})
    assert seen["entry"]["id"] == "c1"
    assert result == {"http_status": 200, "body": '{"response": "parsed"}', "answer": "parsed"}
    # The bearer handling mirrors the anchor's: a TTL refresh before the drive,
    # and a forced refresh + ONE re-drive on a 401.
    assert seen["refreshes"] == [False, True]
    assert seen["drives"] == 2


# ---------------------------------------------------------------------------
# e01 — the consistent-legs build
# ---------------------------------------------------------------------------


def test_the_b_and_c_legs_read_the_same_label_scope():
    """The shared coercion reaches BOTH write sides: a legacy bare-string
    ``requested_labels`` is ONE label on the leg that ships the case into the
    container AND on the leg that posts the payload — otherwise the two legs
    disagree about the scope they applied and the comparison publishes a
    difference that does not exist."""
    case = {
        "id": "c1",
        "query": "q",
        "context": {"requested_labels": "Forestry", "user_id": "u"},
    }
    # The C seam's payload.
    payload = drivers.c_payload_for_case(case, deadline_ms=1000)
    assert payload["context"]["requested_labels"] == ["Forestry"]
    # The payload the B driver receives in the container.
    ready = drivers._b_ready_case(case)
    assert ready["context"]["requested_labels"] == ["Forestry"]
    # The original case is untouched (the coercion does not mutate its input).
    assert case["context"]["requested_labels"] == "Forestry"


def test_the_b_driver_ships_the_coerced_label_scope(tmp_path):
    """The B write boundary is the one that matters: the payload the driver
    ships INTO the container must carry the coerced label list. Without it
    the in-container driver splits a bare string into characters, the B leg
    filters on characters, and the report publishes a scope difference that
    does not exist."""
    from test_protocol_drivers import FakeBTransport

    set_path = _set_file(tmp_path, extra_answerable=("c1",))
    _patch_case(set_path, "c1", context={"requested_labels": "Forestry", "user_id": "u"})

    transport = FakeBTransport()
    drivers.run_config_b(set_path, tmp_path / "out-b", transport=transport)
    shipped = [case for case in transport.shipped_cases if case["id"] == "c1"]
    assert shipped, "the case never shipped to the container"
    assert shipped[0]["context"]["requested_labels"] == ["Forestry"]


def test_the_container_reads_the_shipped_labels_as_labels(monkeypatch):
    """The other end of the same wire: the in-container driver reads the
    shipped label list as N labels. A bare string there would split into
    characters — the hazard the write boundary exists to prevent.

    The container's own contract model is the REAL one (the agent-service's
    tree is on the path, the way the driver-suite test loads it): the point
    is the driver's OWN read of the shipped payload."""
    agent_service = Path(__file__).resolve().parents[2] / "components" / "agent-service"
    monkeypatch.syspath_prepend(str(agent_service))
    from protocol import config_b_driver

    context = config_b_driver.build_context(
        {"context": {"requested_labels": ["Forestry", "Timber"], "user_id": "u"}}
    )
    # The EXACT value — a tuple() wrapper would hide an uncoerced list.
    assert context.requested_labels == ("Forestry", "Timber")
    # A bare string would be split into characters: the hazard the write
    # boundary exists to prevent.
    bare = config_b_driver.build_context({"context": {"requested_labels": "Forestry"}})
    assert bare.requested_labels == ("F", "o", "r", "e", "s", "t", "r", "y")


def test_e01_keeps_an_author_key_and_drops_the_credential_names():
    """The credential rule matches credential NAMES in every spelling: an
    author-bearing key is evidence, not a secret, and must survive — while
    the joined and camelCase auth spellings are credentials and must not.
    The rule is applied PER WORD, so a key that carries BOTH ("author_auth")
    is a credential — the author word does not veto the whole key."""
    from protocol.e01 import _is_credential_key

    assert _is_credential_key("author") is False
    assert _is_credential_key("authors") is False
    assert _is_credential_key("authorName") is False
    assert _is_credential_key("doc_authors") is False
    assert _is_credential_key("coauthor") is False
    assert _is_credential_key("auth") is True
    assert _is_credential_key("auth_token") is True
    assert _is_credential_key("authorization") is True
    assert _is_credential_key("session") is True
    # The joined and camelCase spellings name a credential too.
    assert _is_credential_key("authHeader") is True
    assert _is_credential_key("authheader") is True
    assert _is_credential_key("authValue") is True
    # A permission word that only STARTS with "author" is a credential, not
    # an author — the exemption is the author stem, nothing wider.
    assert _is_credential_key("authorisation") is True
    assert _is_credential_key("authorisation_header") is True
    assert _is_credential_key("authorizer") is True
    assert _is_credential_key("authorized") is True
    assert _is_credential_key("unauthorized") is True
    # A key that carries an author word AND an auth word is a credential.
    assert _is_credential_key("author_auth") is True
    assert _is_credential_key("author_auth_header") is True
    assert _is_credential_key("authorAuthHeader") is True

    rows = _b_rows()
    rows["c1"]["metadata"] = {
        "author": "Jane Doe",
        "doc_authors": ["Jane Doe"],
        "auth": "LEAK",
        "authHeader": "Bearer SUPERSECRET",
        "author_auth_header": "Bearer COMPOUNDLEAK",
        "authorisation": "Bearer PERMLEAK",
    }
    report = _build(b_rows=rows)
    recorded = report["per_case"]["c1"]["b"]["metadata"]
    assert recorded["author"] == "Jane Doe"
    assert recorded["doc_authors"] == ["Jane Doe"]
    assert "auth" not in recorded
    assert "authHeader" not in recorded
    assert "author_auth_header" not in recorded
    assert "authorisation" not in recorded
    assert "LEAK" not in json.dumps(report)
    assert "SUPERSECRET" not in json.dumps(report)
    assert "COMPOUNDLEAK" not in json.dumps(report)
    assert "PERMLEAK" not in json.dumps(report)


def test_the_shared_label_coercion_mirrors_the_server_rule():
    """The coercion is the ONE label rule the tree reads: a bare string is
    ONE label (the legacy shape), an empty label is no scope at all, and a
    non-string scalar is stringified. Every rule is asserted here because
    the two legs read this helper — a divergence is a scope difference that
    does not exist."""
    from protocol.evalset import as_label_list

    assert as_label_list("Forestry") == ["Forestry"]
    assert as_label_list(["Timber", "Forestry"]) == ["Timber", "Forestry"]
    # An empty label is not a scope (the server drops it too).
    assert as_label_list(["Timber", "", None]) == ["Timber"]
    # Every FALSY label is dropped (the server drops them all, not just the
    # empty ones) — a "0" label is a scope the filter can never carry.
    assert as_label_list(["Timber", 0]) == ["Timber"]
    assert as_label_list(["Timber", False]) == ["Timber"]
    # A whitespace-only label is KEPT (the wire is verbatim).
    assert as_label_list(["Timber", " "]) == ["Timber", " "]
    # An empty value is no label at all.
    assert as_label_list("") == []
    assert as_label_list([]) == []
    assert as_label_list(None) == []
    assert as_label_list(0) == []
    # Any other scalar is one label, stringified (the server's rule).
    assert as_label_list(5) == ["5"]
    # The server takes a LIST as-is and treats every other shape as one
    # scalar — a tuple is not a list there either.
    assert as_label_list(("Timber", "Forestry")) == ["('Timber', 'Forestry')"]


def test_the_label_coercion_matches_the_server_rule_it_mirrors():
    """The coercion MIRRORS the server's label rules — so the two legs cannot
    disagree about the scope they applied. The expectations are read from the
    server's own code (loaded by path, the way the fanout parity test loads
    its counterpart), not transcribed: a server-side change that this copy
    did not follow turns this red instead of drifting silently.

    Three rules, pinned against the server's own functions:
    * the SHAPE rule — ``_as_label_list`` takes a list as-is and treats every
      other truthy value as ONE scalar;
    * the FALSY drop — ``build_filter_labels`` drops the falsy labels it is
      given;
    * the service-over-category COLLAPSE — the A leg's filter is built from
      the service labels when there are any, which is why the A leg's scope
      can be narrower than the request's.

    The documented divergences, asserted rather than left implicit: the
    server's filter builder DEDUPS the labels it builds while the coercion
    keeps the request's own list (the report compares the two legs' scopes as
    sets, so the dedup carries no scope meaning), and the server's service
    branch keeps a falsy service label while the client drops it."""
    import importlib.util

    from protocol.evalset import as_label_list

    server_path = Path(__file__).resolve().parents[2] / "genie-ai-overlay" / "core" / "label_contract.py"
    spec = importlib.util.spec_from_file_location("server_label_contract", server_path)
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)

    # The shape rule, against the server's own coercion.
    for value in ["Forestry", "", [], None, 0, 5, ("Timber", "Forestry")]:
        assert as_label_list(value) == server._as_label_list(value), value
    # The falsy drop, against the server's filter builder (one category
    # field, no service labels — the branch the coercion mirrors).
    for value in [["Timber", "", None], ["Timber", 0], ["Timber", False], ["Timber", " "]]:
        assert as_label_list(value) == server.build_filter_labels({"categoryLabels": value}), value
    # The collapse the A leg applies — recorded here so a server-side change
    # to it turns this red.
    assert server.build_filter_labels({"serviceLabels": ["Svc"], "categoryLabels": ["Timber"]}) == ["Svc"]
    # The DOCUMENTED divergence: the server's service branch keeps a falsy
    # service label (so the category is eclipsed and the filter ends up
    # empty), the client drops it. Pinned here so the divergence is a fact
    # the suite watches, not a claim in a docstring.
    assert server.build_filter_labels({"serviceLabels": [0], "categoryLabels": ["Timber"]}) == []
    assert as_label_list([0]) == []
    # The documented divergence, asserted rather than left implicit.
    assert as_label_list(["Timber", "Timber"]) == ["Timber", "Timber"]
    assert server.build_filter_labels({"categoryLabels": ["Timber", "Timber"]}) == ["Timber"]


def test_the_parity_pin_runs_when_the_server_label_rule_changes():
    """The pin is only worth its place if it RUNS when the server's rule
    changes: the CI job that carries the protocol suite triggers on the
    server's label contract too. Without it the pin stays dark and the next
    server-side drift lands unnoticed."""
    import yaml

    ci_path = Path(__file__).resolve().parents[2] / ".gitlab-ci.yml"
    job = yaml.safe_load(ci_path.read_text(encoding="utf-8"))["test:rag-benchmarks"]
    changes = [
        entry
        for rule in job["rules"]
        if rule.get("if", "").startswith("$CI_PIPELINE_SOURCE")
        for entry in rule.get("changes", [])
    ]
    assert "genie-ai-overlay/core/label_contract.py" in changes


def test_e01_redacts_the_auth_and_session_keys():
    """The report's own credential markers cover the names the manifest's
    list does not carry: a row's `auth`/`session` keys never reach the
    report."""
    rows = _b_rows()
    rows["c1"]["metadata"] = {"auth": "LEAK", "session": "LEAK", "usage": {"prompt_tokens": 3}}
    report = _build(b_rows=rows)
    recorded = report["per_case"]["c1"]["b"]["metadata"]
    assert "auth" not in recorded
    assert "session" not in recorded
    assert "LEAK" not in json.dumps(report)
    # The measurement names survive (the judge needs them).
    assert recorded["usage"]["prompt_tokens"] == 3


def test_e01_reads_a_string_valued_requested_label_as_one_label():
    """A captured file written before the coercion carried the bare string;
    the report reads it as ONE label — a per-character split would publish a
    scope finding that does not exist."""
    captured = _captured_rows()
    captured["c1"]["retrieval_scope"] = {
        "sent_labels": {"category_labels": ["Forestry"], "service_labels": []},
        "case_requested_labels": "Forestry",
    }
    captured["c1"]["filter_labels"] = ["Forestry"]
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["A"]["cases_whose_requested_labels_never_became_an_effective_filter"] == []
    assert scope["A"]["cases_whose_requested_labels_were_not_sent"] == []


def test_e01_names_the_cases_without_a_measured_effective_filter():
    """A row that recorded a scope but measured no filter is named — it is
    neither a scoped case nor an unanswered one, and the comparison over it
    is partial."""
    captured = _captured_rows()
    captured["c1"]["retrieval_scope"] = {
        "sent_labels": {"category_labels": ["Timber"], "service_labels": []},
        "case_requested_labels": [],
    }
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["A"]["cases_without_a_measured_effective_filter"] == ["c1"]
    # The case is not a scoped one, and it is not a never-queried one.
    assert "c1" not in scope["A"]["effective_filter_labels_per_case"]
    assert "c1" not in scope["A"]["cases_that_never_queried"]


def test_capture_a_seeds_the_bearer_clock_before_the_first_drive(tmp_path, monkeypatch):
    """The capture mirrors the anchor's bearer bootstrap: the in-run refresh
    clock is seeded ONCE, BEFORE the first drive, and a refresh is forced
    only when no static bearer was seeded. Without the seed the capture's
    first TTL check refreshes at once and replaces a pre-minted
    service-account bearer — the A leg would then answer under a different
    identity than the reference it is compared against.

    The ANCHOR'S OWN module is bound (eval/ is on the path; the capture
    imports it verbatim): only the network seam (fetch_realm_token) and the
    docker seam (drive_query) are faked, so the TTL rule this test exercises
    is the anchor's own — an anchor-side rule change turns this red instead
    of drifting under a local copy of it."""
    import run_eval

    # Refresh is opted in (the anchor's own configuration gate, read from
    # the environment at call time).
    monkeypatch.setenv("EVAL_KC_URL", "https://kc.example/auth")
    monkeypatch.setenv("EVAL_KC_PASSWORD", "the-password")
    monkeypatch.setattr(run_eval, "_token_ts", 0.0)
    # ONE event log: the fetches and the drives, in the order they happened.
    calls: list[str] = []

    def _fake_fetch(*_):
        calls.append("fetch")
        return "realm-token"

    def _fake_drive(entry):
        calls.append("drive")
        return (0.0, '{"response": "parsed"}', 200)

    monkeypatch.setattr(run_eval, "fetch_realm_token", _fake_fetch)
    monkeypatch.setattr(run_eval, "drive_query", _fake_drive)

    set_path = _set_file(tmp_path, extra_answerable=("c1",))
    # The DEFAULT seam (no injected query) — the path that drives chatqna
    # through the anchor's own query function.
    monkeypatch.setenv("E2E_BEARER_TOKEN", "pre-minted")
    drivers.run_config_a_capture(set_path, tmp_path / "out", corpus_fingerprint=CORPUS)
    assert "drive" in calls, "no case was driven"
    # No refresh at all: the pre-minted bearer survives (the seeded clock
    # keeps every TTL check inside its window). An unseeded clock would look
    # arbitrarily old and the anchor's own rule would refresh at once.
    assert "fetch" not in calls, "a pre-minted bearer must not be replaced"

    # With no static bearer, the anchor forces ONE refresh up front — BEFORE
    # the first drive (the seed block), so the loop starts authenticated.
    monkeypatch.delenv("E2E_BEARER_TOKEN")
    calls.clear()
    drivers.run_config_a_capture(set_path, tmp_path / "out2", corpus_fingerprint=CORPUS)
    assert calls and calls[0] == "fetch", "the forced refresh did not run before the drives"
    assert calls.count("fetch") == 1, "no static bearer means ONE forced refresh"

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
    # M-3: A judged from the answer text, B mechanical fields — and BOTH sides
    # count their failed rows (a leg that produced no answer must not read as
    # zeros).
    assert dimensions["M-3"]["A"]["values"]["n_empty_answers"] == 0
    assert dimensions["M-3"]["A"]["values"]["n_ok_rows"] == 1
    assert dimensions["M-3"]["A"]["values"]["n_http_error_rows"] == 1
    assert dimensions["M-3"]["A"]["values"]["n_failure_rows"] == 1
    assert dimensions["M-3"]["A"]["values"]["n_rows_with_abstention_fact"] == 1
    assert dimensions["M-3"]["B"]["values"]["n_ok_rows"] == 2
    assert dimensions["M-3"]["B"]["values"]["n_abstained"] == 1
    assert dimensions["M-3"]["B"]["values"]["n_with_abstention_reason"] == 1
    assert dimensions["M-3"]["B"]["values"]["n_failure_rows"] == 1
    # M-4: latency stats on both sides, in the metric's own unit, with NO
    # tolerance band (the thresholds are the threshold registry's to sign).
    assert dimensions["M-4"]["A"]["values"]["median"] == 10.0
    assert dimensions["M-4"]["A"]["values"]["unit"] == "ms"
    assert dimensions["M-4"]["A"]["values"]["n_excluded_non_ok_rows"] == 2
    assert "tol_low" not in dimensions["M-4"]["A"]["values"]
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
        assert set(record) == {"a", "b", "reference_defect", "skipped"}
        assert record["skipped"] is False
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
        "skipped_cases": 0,
        # The coverage census rides the capture's stamp; a capture that
        # carries none is recorded absent, never reconstructed.
        "coverage": None,
    }


def test_e01_report_redacts_credential_named_keys_from_per_case_rows():
    rows = _b_rows()
    rows["c1"]["API_TOKEN"] = "must-not-leak"
    report = _build(b_rows=rows)
    assert "API_TOKEN" not in report["per_case"]["c1"]["b"]


def test_e01_redacts_nested_credential_named_keys_too():
    """A row's nested metadata carries credential-named keys at depth — the
    report's own redaction drops them before anything is written."""
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
    assert diff["execution_conditions"]["seed"]["value"] == 42
    assert diff["execution_conditions"]["seed"]["verified"] is False
    assert "sequential anchor pass" in diff["execution_conditions"]["A"]
    assert "batched B lanes" in diff["execution_conditions"]["B"]
    assert diff["cache_state"] == {
        "recorded": False,
        "note": "cache state is unrecorded by the harness (FR-27) — the two legs' cache conditions are uncontrolled",
    }
    assert diff["retrieval_surface_asymmetry"]["intentional_difference"] == "retrieval_backend"
    # The label scopes are named, never assumed equal.
    assert diff["retrieval_scope"]["scope_matched"] is None
    assert diff["retrieval_scope"]["A"]["labels_sent_per_case"]["c1"] == {
        "category_labels": [],
        "service_labels": [],
    }
    # The rows that issued no request are named apart; the rows that sent a
    # request but recorded no scope are scope-less, not "never queried".
    assert diff["retrieval_scope"]["A"]["cases_that_never_queried"] == []
    assert diff["retrieval_scope"]["A"]["cases_without_a_recorded_scope"] == ["c2", "c3"]
    # Without a seed the fact records as not recorded — never invented.
    unseeded = _build(reference=reference, gated=gated)
    assert unseeded["uncontrolled_differences"]["execution_conditions"]["seed"]["value"] is None


def test_e01_inputs_are_digested_and_the_report_is_reproducible_under_the_pin():
    reference, gated = _manifests()
    anchor = _anchor_report()
    captured = _captured_rows()
    b_rows = _b_rows()
    kw = dict(
        reference_manifest=reference,
        gated_manifest=gated,
        anchor_report=anchor,
        capture={"cases": captured, "capture": _capture_stamp()},
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
    assert inputs["capture_stamp"]["assessment_set_sha256"] == SET_SHA
    assert inputs["capture_stamp"]["verified"]["assessment_set_sha256"] is True
    # The corpus fingerprint is the operator's declaration — never a verified
    # fact.
    assert inputs["capture_stamp"]["verified"]["corpus_fingerprint"] is False
    # A different pin produces a different digest — the pin is part of the identity.
    assert build_e01_report(created_utc="2026-11-23T00:00:00+00:00", **kw)["digest"] != first["digest"]
    # A changed input changes the digest (the join is digest-pinned).
    moved = dict(anchor)
    moved["aggregate"] = dict(anchor["aggregate"], recall=0.9)
    moved_kw = {key: value for key, value in kw.items() if key != "anchor_report"}
    assert build_e01_report(created_utc=CREATED, anchor_report=moved, **moved_kw)["digest"] != first["digest"]


# ---------------------------------------------------------------------------
# e01 — the reference-defects ledger
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


def test_e01_refuses_a_capture_stamped_under_another_protocol_identity():
    """The capture stamp carries the protocol package's own code identity:
    a capture made before a protocol change is not current evidence for the
    join — the drivers, the set validator and the verdict layer are the
    behaviour its rows speak for. A stamp that predates the field is
    tolerated (recorded absent, never reconstructed)."""
    reference, gated = _manifests()
    stale = dict(_capture_stamp(), protocol_code_sha256="00" * 32)
    with pytest.raises(E01Refusal) as failed:
        _build(reference=reference, gated=gated, capture_stamp=stale)
    assert failed.value.reason == "protocol_code_mismatch"
    assert "protocol" in str(failed.value)

    pre_field = {
        k: v for k, v in _capture_stamp().items() if k != "protocol_code_sha256"
    }
    report = _build(reference=reference, gated=gated, capture_stamp=pre_field)
    assert report["digest"]


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
        lambda set_path_arg, out_dir, entries=None, **kwargs: original(
            set_path_arg, out_dir, entries=entries, query=seam, **kwargs
        ),
    )
    args = argparse.Namespace(
        set_path=str(set_path),
        out_dir=str(tmp_path / "out"),
        corpus_fingerprint=CORPUS,
        corpus_collection="COLL",
        compute_fingerprint=False,
    )
    assert cmd_capture_a(args) == 0
    assert (tmp_path / "out" / "config-a.captured.json").exists()


def test_capture_a_cli_refuses_an_under_composed_set(tmp_path):
    (tmp_path / "set.json").write_text(
        json.dumps({"_meta": {"provenance": "assessment"}, "entries": [_case("c1", "q", "answerable")]}),
        encoding="utf-8",
    )
    args = argparse.Namespace(
        set_path=str(tmp_path / "set.json"),
        out_dir=str(tmp_path / "out"),
        corpus_fingerprint=CORPUS,
        corpus_collection="COLL",
        compute_fingerprint=False,
    )
    assert cmd_capture_a(args) == 1


def test_e01_cli_builds_the_report_and_prints_the_digest(tmp_path, capsys):
    reference, gated = _manifests()
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "reference.manifest.json").write_text(json.dumps(reference), encoding="utf-8")
    (run_dir / "config-b.manifest.json").write_text(json.dumps(gated), encoding="utf-8")
    (run_dir / "config-a.report.json").write_text(json.dumps(_anchor_report()), encoding="utf-8")
    (run_dir / "config-a.captured.json").write_text(
        json.dumps({"cases": _captured_rows(), "capture": _capture_stamp()}), encoding="utf-8"
    )
    (run_dir / "config-b.rows.json").write_text(json.dumps({"cases": _b_rows()}), encoding="utf-8")
    out = tmp_path / "e01.report.json"
    args = argparse.Namespace(
        reference_manifest=str(run_dir / "reference.manifest.json"),
        gated_manifest=str(run_dir / "config-b.manifest.json"),
        anchor_report=str(run_dir / "config-a.report.json"),
        captured_rows=str(run_dir / "config-a.captured.json"),
        b_rows=str(run_dir / "config-b.rows.json"),
        defects=None,
        out=str(out),
        created_utc=CREATED,
        seed=None,
    )
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
    (run_dir / "config-a.captured.json").write_text(
        json.dumps({"cases": _captured_rows(), "capture": _capture_stamp()}), encoding="utf-8"
    )
    (run_dir / "config-b.rows.json").write_text(json.dumps({"cases": _b_rows()}), encoding="utf-8")
    ledger = reference_defects_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference,
        defects=[{"case_ids": ["c3"], "summary": "known A defect"}],
    )
    (run_dir / "reference.defects.json").write_text(json.dumps(ledger), encoding="utf-8")
    out = tmp_path / "e01.report.json"
    args = argparse.Namespace(
        reference_manifest=str(run_dir / "reference.manifest.json"),
        gated_manifest=str(run_dir / "config-b.manifest.json"),
        anchor_report=str(run_dir / "config-a.report.json"),
        captured_rows=str(run_dir / "config-a.captured.json"),
        b_rows=str(run_dir / "config-b.rows.json"),
        defects=str(run_dir / "reference.defects.json"),
        out=str(out),
        created_utc=CREATED,
        seed=None,
    )
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
    (run_dir / "config-a.captured.json").write_text(
        json.dumps({"cases": _captured_rows(), "capture": _capture_stamp()}), encoding="utf-8"
    )
    # config-b.rows.json deliberately absent.
    args = argparse.Namespace(
        reference_manifest=str(run_dir / "reference.manifest.json"),
        gated_manifest=str(run_dir / "config-b.manifest.json"),
        anchor_report=str(run_dir / "config-a.report.json"),
        captured_rows=str(run_dir / "config-a.captured.json"),
        b_rows=str(run_dir / "config-b.rows.json"),
        defects=None,
        out=str(tmp_path / "e01.report.json"),
        created_utc=CREATED,
        seed=None,
    )
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
        "--reference-manifest",
        "/nonexistent/reference.json",
        "--gated-manifest",
        "/nonexistent/gated.json",
        "--anchor-report",
        "/nonexistent/anchor.json",
        "--captured-rows",
        "/nonexistent/captured.json",
        "--b-rows",
        "/nonexistent/b.json",
        "--out",
        "/tmp/e01-should-not-exist.json",
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
        (run_dir / "config-a.captured.json").write_text(
            json.dumps({"cases": _captured_rows(), "capture": _capture_stamp()}), encoding="utf-8"
        )
        (run_dir / "config-b.rows.json").write_text(json.dumps({"cases": _b_rows()}), encoding="utf-8")
        argv_lineage = [
            "e01",
            "--reference-manifest",
            str(run_dir / "reference.manifest.json"),
            "--gated-manifest",
            str(run_dir / "config-b.manifest.json"),
            "--anchor-report",
            str(run_dir / "config-a.report.json"),
            "--captured-rows",
            str(run_dir / "config-a.captured.json"),
            "--b-rows",
            str(run_dir / "config-b.rows.json"),
            "--out",
            str(run_dir / "e01.report.json"),
        ]
        assert main(argv_lineage) == 1
        assert not (run_dir / "e01.report.json").exists()


# ---------------------------------------------------------------------------
# The correction round's regression tests (one per fixed finding)
# ---------------------------------------------------------------------------


def test_capture_a_skips_the_security_scenarios_and_records_them(tmp_path):
    """Config A has no agent surface — the security cases are the B/C legs'.
    The capture must not fire an injected instruction at that surface."""
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    seam, calls = _seam({"c1": "a1", "c2": "a2"})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    security_ids = {case_id for case_id in result["rows"] if case_id.startswith("_sec-")}
    assert security_ids, "the set carries security cases — the capture must record them"
    for case_id in security_ids:
        row = result["rows"][case_id]
        assert row["status"] == "skipped"
        assert "no agent surface" in row["reason"]
    # No security case was ever queried.
    assert not [case_id for case_id in calls if case_id.startswith("_sec-")]


def test_capture_a_records_chatqnas_mechanical_abstention_facts(tmp_path):
    """chatqna's own abstention facts (metadata.abstained / abstention_reason)
    are captured when the response carries them."""
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))

    def seam(entry):
        if entry["id"] == "c1":
            body = {"metadata": {"abstained": True, "abstention_reason": "no_context"}}
            return {"http_status": 200, "body": json.dumps(body), "answer": ""}
        return {"http_status": 200, "body": json.dumps({"metadata": {}}), "answer": "an answer"}

    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    assert result["rows"]["c1"]["abstained"] is True
    assert result["rows"]["c1"]["abstention_reason"] == "no_context"
    # Absent in the response → absent on the row (never invented).
    assert "abstained" not in result["rows"]["c2"]


def test_capture_a_stamps_the_set_digest_and_the_corpus(tmp_path):
    """The capture is the one leg the manifests cannot cover — it stamps the
    set digest and the corpus fingerprint it ran under."""
    import hashlib

    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    seam, _ = _seam({"c1": "a1", "c2": "a2"})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    expected = hashlib.sha256(set_path.read_bytes()).hexdigest()
    assert result["capture"]["assessment_set_sha256"] == expected
    assert result["capture"]["corpus_fingerprint"] == CORPUS
    assert result["capture"]["corpus_fingerprint_source"] == "pinned"
    # The stamp also carries the census: what the set covers, per evaluation
    # surface — every case has a resolved surface, so the arbitration's basis
    # is stated instead of inferred from a gold count.
    coverage = result["capture"]["coverage"]
    assert coverage["n_cases_with_a_resolved_surface"] == coverage["n_set_cases"]
    assert coverage["by_surface"]["retrieval"] == 5
    assert coverage["by_surface"]["outcome"] == 3
    assert coverage["by_surface"]["security"] == 7
    assert coverage["by_surface"]["restricted_access"] == 1
    assert coverage["retrieval_cases_without_gold"] == []
    # The stamp also identifies the ANCHOR's input — which of the set's cases
    # the chunk-level surface scores. A change to the surface model moves it:
    # the digest must be sensitive to WHICH cases are on the retrieval surface.
    projection = result["capture"]["anchor_projection_sha256"]
    assert re.fullmatch(r"[0-9a-f]{64}", projection)
    # The stamp also carries the PROTOCOL's own code identity — the drivers,
    # the set validator and the verdict layer are behaviour the capture
    # speaks for, and the reuse check compares the recorded digest against
    # the live package (a capture made before a protocol change is not
    # current evidence).
    assert result["capture"]["protocol_code_sha256"] == drivers.current_protocol_code_sha()
    entries = json.loads(Path(set_path).read_text(encoding="utf-8"))["entries"]
    for case in entries:
        if case["id"] == "_cite":
            case["expected_chunks"] = [{"chunk_key": "_cite-chunk-2", "content_hash": "b2c3d4e5f6071829"}]
    changed = tmp_path / "changed-set.json"
    changed.write_text(json.dumps({"_meta": {"provenance": "assessment"}, "entries": entries}), encoding="utf-8")
    other = drivers.run_config_a_capture(
        changed, tmp_path / "out-changed", query=seam, corpus_fingerprint=CORPUS
    )
    assert other["capture"]["anchor_projection_sha256"] != projection
    written = json.loads(Path(result["rows_path"]).read_text(encoding="utf-8"))
    assert written["capture"] == result["capture"]
    # Without a corpus fingerprint the capture refuses — the stamp is mandatory.
    with pytest.raises(Exception) as failed:
        drivers.run_config_a_capture(set_path, tmp_path / "out2", query=seam)
    assert "corpus" in str(failed.value).lower()


def test_e01_refuses_a_capture_stamped_over_another_set_or_corpus():
    with pytest.raises(E01Refusal) as failed:
        _build(capture_stamp=_capture_stamp(set_sha="9" * 64))
    assert failed.value.reason == "lineage_mismatch"
    assert "assessment set" in str(failed.value)
    with pytest.raises(E01Refusal) as failed:
        _build(capture_stamp=_capture_stamp(corpus="9" * 64))
    assert failed.value.reason == "lineage_mismatch"
    assert "corpus" in str(failed.value)


def test_e01_refuses_a_leg_gated_against_another_reference():
    """Two reference runs over the same corpus and set share the corpus and
    set digests but not the manifest digest — pairing A from one with B gated
    against another would apply thresholds signed for a different measurement."""
    reference, gated = _manifests()
    other_reference, _ = _manifests()
    other_reference["created_utc"] = "2026-11-22T09:00:00+00:00"
    gated["lineage"] = {"reference_manifest_sha256": manifest_digest(other_reference), "thresholds_sha256": "t" * 64}
    with pytest.raises(E01Refusal) as failed:
        _build(reference=reference, gated=gated)
    assert failed.value.reason == "lineage_mismatch"
    assert "gated against" in str(failed.value)


def test_e01_refuses_legs_that_carry_no_lineage():
    """Two manifests without a fingerprint would compare equal (None == None)
    — the report must not claim a shared corpus it never checked."""
    reference, gated = _manifests()
    reference["corpus"] = {}
    gated["corpus"] = {}
    with pytest.raises(E01Refusal) as failed:
        _build(reference=reference, gated=gated)
    assert failed.value.reason == "lineage_mismatch"
    assert "corpus fingerprint" in str(failed.value)


def test_e01_refuses_rows_of_another_leg():
    """Config C's rows carry outcome, not status — a C rows file passed as the
    B leg must refuse, never silently filter down to an empty leg."""
    c_rows = {"c1": {"case_id": "c1", "outcome": "answered", "wall_ms": 5.0}}
    with pytest.raises(E01Refusal) as failed:
        _build(b_rows=c_rows)
    assert failed.value.reason == "wrong_leg"
    assert "status" in str(failed.value)


def test_e01_refuses_a_malformed_defects_file():
    """A JSON array of defect records is not a ledger — a typed refusal, not a
    traceback."""
    with pytest.raises(E01Refusal) as failed:
        _build(defects=[{"case_ids": ["c1"]}])
    assert failed.value.reason == "defects_not_a_ledger"


def test_e01_m4_publishes_no_tolerance_band_and_keeps_the_metric_unit():
    """The capture machinery's tolerance band is clamped to [0, 1] — a
    millisecond band would come out inverted. The thresholds are 4.4's."""
    rows = _b_rows()
    rows["c1"]["wall_ms"] = 4200.0
    report = _build(b_rows=rows)
    values = report["dimensions"]["M-4"]["B"]["values"]
    assert values["max"] == 4200.0
    assert values["median"] == 2200.0
    assert values["unit"] == "ms"
    assert "tol_low" not in values and "tol_high" not in values


def test_e01_never_claims_equality_from_absence():
    """An unrecorded side is 'not recorded', never 'identical'."""
    reference, gated = _manifests()
    reference["configuration"]["A"]["prompt_digests"] = {}
    reference["configuration"]["A"]["model_ids"] = {}
    gated["lineage"]["reference_manifest_sha256"] = manifest_digest(reference)
    report = _build(reference=reference, gated=gated)
    diff = report["uncontrolled_differences"]
    assert diff["prompt_digests"]["state"] == "not_recorded"
    assert diff["prompt_digests"]["identical"] is None
    assert diff["model_ids"]["state"] == "not_recorded"
    assert diff["model_ids"]["identical"] is None


def test_e01_names_the_cases_whose_requested_labels_never_reached_the_a_query():
    """A requested label the request never carried is named — and, because
    the row measured no effective filter either, that is said apart."""
    captured = _captured_rows()
    captured["c1"]["retrieval_scope"] = {
        "sent_labels": {"category_labels": [], "service_labels": []},
        "case_requested_labels": ["Forestry"],
    }
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["scope_matched"] is None
    assert scope["A"]["cases_whose_requested_labels_were_not_sent"] == ["c1"]
    assert scope["A"]["cases_without_a_measured_effective_filter"] == ["c1"]
    assert scope["A"]["cases_whose_requested_labels_never_became_an_effective_filter"] == []


def test_e01_m5_values_are_deep_redacted():
    """The M-5 path writes its own copy of the value — a nested credential
    must not survive on THAT path either."""
    rows = _b_rows()
    rows["c1"]["metadata"] = {"usage": {"api_key": "LEAK", "prompt_tokens": 3}}
    report = _build(b_rows=rows)
    values = report["dimensions"]["M-5"]["B"]["values"]
    assert "api_key" not in values["usage"]
    assert "LEAK" not in json.dumps(report)
    # The measurement names survive (the judge needs them).
    assert values["usage"]["prompt_tokens"] == 3


def test_e01_refuses_a_capture_without_a_stamp():
    """No stamp = no provenance: the join refuses before the report is built."""
    with pytest.raises(E01Refusal) as failed:
        _build(capture_stamp=None)
    assert failed.value.reason == "missing_artifact"
    assert "stamp" in str(failed.value)


def test_e01_refuses_c_style_rows_on_the_a_leg():
    """The A leg is checked too — config C's rows (outcome, no status) never
    pass as captured A rows."""
    c_rows = {"c1": {"case_id": "c1", "outcome": "answered", "wall_ms": 5.0}}
    with pytest.raises(E01Refusal) as failed:
        _build(captured_rows=c_rows)
    assert failed.value.reason == "wrong_leg"


def test_capture_a_refuses_to_resume_into_another_set(tmp_path):
    """The rows file certifies the set it was captured over — resuming by case
    id across another set would certify set B's digest over set A's answers."""
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    set_a = _set_file(tmp_path / "a", extra_answerable=("c1", "c2"))
    set_b = _set_file(tmp_path / "b", extra_answerable=("c1", "c2", "c3"))
    seam, _ = _seam({"c1": "a1", "c2": "a2", "c3": "a3"})
    drivers.run_config_a_capture(set_a, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    with pytest.raises(Exception) as failed:
        drivers.run_config_a_capture(set_b, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    assert "another" in str(failed.value)


def test_capture_a_refuses_to_resume_into_another_corpus(tmp_path):
    """The corpus half of the resume refusal is a refusal too."""
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    seam, _ = _seam({"c1": "a1", "c2": "a2"})
    drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    with pytest.raises(Exception) as failed:
        drivers.run_config_a_capture(
            set_path, tmp_path / "out", query=seam, corpus_fingerprint="9" * 64
        )
    assert "corpus" in str(failed.value)


def test_capture_a_refuses_to_resume_into_an_unstamped_rows_file(tmp_path):
    """A rows file that carries cases but no stamp has no provenance to resume
    under — the resume refuses instead of certifying a new set's digest over
    the old set's answers."""
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    set_a = _set_file(tmp_path / "a", extra_answerable=("c1", "c2"))
    set_b = _set_file(tmp_path / "b", extra_answerable=("c1", "c2", "c3"))
    seam, _ = _seam({"c1": "a1", "c2": "a2", "c3": "a3"})
    drivers.run_config_a_capture(set_a, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    # Strip the stamp: the rows stay, the provenance does not.
    rows_path = tmp_path / "out" / "config-a.captured.json"
    data = json.loads(rows_path.read_text(encoding="utf-8"))
    data.pop("capture")
    rows_path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(Exception) as failed:
        drivers.run_config_a_capture(set_b, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    assert "stamp" in str(failed.value)


def test_capture_a_keeps_the_stamp_on_a_converged_resume(tmp_path):
    """A converged resume over a stamped rows file keeps that stamp on disk —
    the E01 join needs it to accept the capture."""
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    seam, calls = _seam({"c1": "a1", "c2": "a2"})
    first = drivers.run_config_a_capture(
        set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS
    )
    assert calls
    converged, converged_calls = _seam({})
    result = drivers.run_config_a_capture(
        set_path, tmp_path / "out", query=converged, corpus_fingerprint=CORPUS
    )
    assert converged_calls == []
    on_disk = json.loads((tmp_path / "out" / "config-a.captured.json").read_text(encoding="utf-8"))
    assert on_disk["capture"] == first["capture"]
    assert result["capture"]["corpus_fingerprint"] == CORPUS


def test_capture_a_records_the_scope_only_on_the_rows_that_queried(tmp_path):
    """The scope is what the A leg QUERIED under — a failed row queried
    nothing and records no scope."""
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))

    def seam(entry):
        if entry["id"] == "c2":
            raise OSError("transport down")
        return {"http_status": 200, "body": json.dumps({"metadata": {}}), "answer": "an answer"}

    result = drivers.run_config_a_capture(
        set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS
    )
    assert "retrieval_scope" in result["rows"]["c1"]
    assert "retrieval_scope" not in result["rows"]["c2"]
    # An http_error row DID send the request — it records the scope it sent.
    http_error_seam, _ = _seam({"c1": "a1"}, statuses={"c2": 500})
    http_result = drivers.run_config_a_capture(
        set_path, tmp_path / "out2", query=http_error_seam, corpus_fingerprint=CORPUS
    )
    assert "retrieval_scope" in http_result["rows"]["c2"]


def test_e01_redacts_the_m1_aggregate_and_the_recorded_scopes():
    """Every path the report writes goes through the redaction — the M-1
    aggregate and the recorded label scopes included."""
    anchor = _anchor_report()
    anchor["aggregate"]["api_key"] = "LEAK"
    captured = _captured_rows()
    captured["c1"]["retrieval_scope"] = {
        "sent_labels": {"category_labels": [], "service_labels": [], "client_secret": "LEAK"},
        "case_requested_labels": [],
    }
    report = _build(anchor_report=anchor, captured_rows=captured)
    assert "api_key" not in report["dimensions"]["M-1"]["A"]["values"]
    scope = report["uncontrolled_differences"]["retrieval_scope"]["A"]["labels_sent_per_case"]["c1"]
    assert "client_secret" not in scope["service_labels"]
    assert "LEAK" not in json.dumps(report)


def test_e01_keeps_the_anchors_evidence_counters():
    """The anchor's own counters are evidence, not credentials — "…_keys"
    matches the KEY marker, so the names are whitelisted explicitly."""
    anchor = _anchor_report()
    anchor["n_unmapped_chunk_keys"] = 7
    report = _build(anchor_report=anchor)
    values = report["dimensions"]["M-1"]["A"]["values"]
    assert values["n_unmapped_chunk_keys"] == 7
    assert values["n_missed_traces"] == 0


def test_e01_redacts_the_capture_stamp_it_records():
    """The capture stamp is spread into the report — it goes through the
    redaction like every other written value."""
    stamp = _capture_stamp()
    stamp["api_key"] = "LEAK"
    report = _build(capture_stamp=stamp)
    assert "api_key" not in report["inputs"]["capture_stamp"]
    assert "LEAK" not in json.dumps(report)


def test_e01_redacts_the_manifest_maps_it_copies():
    """The prompt/model maps come from the manifests — a configuration block
    is not a sanitised surface."""
    reference, gated = _manifests()
    reference["configuration"]["A"]["model_ids"]["api_key"] = "LEAK"
    gated["configuration"]["B"]["prompt_digests"]["client_secret"] = "LEAK"
    gated["lineage"]["reference_manifest_sha256"] = manifest_digest(reference)
    report = _build(reference=reference, gated=gated)
    assert "api_key" not in report["uncontrolled_differences"]["model_ids"]["A"]
    assert "client_secret" not in report["uncontrolled_differences"]["prompt_digests"]["B"]
    assert "LEAK" not in json.dumps(report)


def test_e01_names_a_failed_row_that_carries_a_scope_as_scope_less():
    """A failed row sent nothing that can be reported as a scope, but it is
    NOT a never-queried case (only a skipped row is)."""
    captured = _captured_rows()
    captured["c3"]["retrieval_scope"] = {
        "sent_labels": {"category_labels": ["Forestry"], "service_labels": []},
        "case_requested_labels": [],
    }
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]["A"]
    assert "c3" not in scope["labels_sent_per_case"]
    assert "c3" in scope["cases_without_a_recorded_scope"]
    assert "c3" not in scope["cases_that_never_queried"]


def test_e01_names_a_skipped_row_as_never_queried():
    """A skipped row issued NO request (the protocol declared the case
    inapplicable to this leg) — it is the never-queried case."""
    captured = _captured_rows()
    captured["c3"] = {"case_id": "c3", "status": "skipped", "reason": "no agent surface", "wall_ms": 0.0}
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]["A"]
    assert "c3" in scope["cases_that_never_queried"]
    assert "c3" not in scope["cases_without_a_recorded_scope"]


def test_e01_does_not_call_an_answered_case_never_queried():
    """An ok row that carries no recorded scope DID query (it has an answer) —
    it is scope-less, not never-queried."""
    captured = _captured_rows()
    captured["c1"].pop("retrieval_scope")
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]["A"]
    assert "c1" not in scope["cases_that_never_queried"]
    assert "c1" in scope["cases_without_a_recorded_scope"]


def test_capture_a_writes_the_rows_file_only_through_the_case_loop(tmp_path):
    """The stamp lands on disk WITH the first written case — the capture does
    not create the file before it has a row to write."""
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    rows_path = tmp_path / "out" / "config-a.captured.json"
    seen = []

    def seam(entry):
        seen.append(rows_path.exists())
        return {"http_status": 200, "body": json.dumps({"metadata": {}}), "answer": "an answer"}

    drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    # The file did not exist while the first case was being queried.
    assert seen[0] is False
    # It carries the stamp once the rows are written.
    on_disk = json.loads(rows_path.read_text(encoding="utf-8"))
    assert on_disk["capture"]["corpus_fingerprint"] == CORPUS


def test_e01_keeps_the_measurement_names_and_drops_the_credentials():
    """The redaction rule is a CONTRACT with the judge — asserted at the
    REPORT boundary: the declared measurement names reach the report (and a
    token count outside the allowlist), a token CREDENTIAL does not."""
    from protocol.redaction import MEASUREMENT_KEY_NAMES

    rows = _b_rows()
    metadata = {name: 1 for name in MEASUREMENT_KEY_NAMES}
    metadata["cached_tokens"] = 3
    metadata["access_token"] = "LEAK"
    rows["c1"]["metadata"] = metadata
    report = _build(b_rows=rows)
    recorded = report["per_case"]["c1"]["b"]["metadata"]
    for name in MEASUREMENT_KEY_NAMES:
        assert name in recorded, f"{name} is a declared measurement name but the report drops it"
    # A count the allowlist does not list (the rule covers the suffix).
    assert recorded["cached_tokens"] == 3
    # A credential that ends like a count is still dropped.
    assert "access_token" not in recorded
    assert "LEAK" not in json.dumps(report)


def test_e01_m5_keeps_the_token_counts_the_judge_reads():
    """The usage record's token counts (and their detail sub-dicts) are
    measurements, not credentials."""
    rows = _b_rows()
    rows["c1"]["metadata"] = {
        "usage": {
            "input_tokens": 5,
            "output_tokens": 7,
            "prompt_tokens": 5,
            "total_tokens": 12,
            "prompt_tokens_details": {"cached_tokens": 3},
        }
    }
    report = _build(b_rows=rows)
    usage = report["dimensions"]["M-5"]["B"]["values"]["usage"]
    assert usage["input_tokens"] == 5
    assert usage["output_tokens"] == 7
    assert usage["prompt_tokens_details"] == {"cached_tokens": 3}


def test_e01_compares_the_raw_maps_and_emits_the_redacted_ones():
    """The comparison runs on the recorded evidence; only the emitted copies
    are redacted — a credential-named difference must still be a difference."""
    reference, gated = _manifests()
    gated["configuration"]["B"]["model_ids"]["api_key"] = "B-KEY"
    gated["lineage"]["reference_manifest_sha256"] = manifest_digest(reference)
    report = _build(reference=reference, gated=gated)
    model_ids = report["uncontrolled_differences"]["model_ids"]
    assert model_ids["identical"] is False
    assert "api_key" not in model_ids["B"]
    assert "B-KEY" not in json.dumps(report)


def test_capture_a_records_the_effective_filter_labels(tmp_path):
    """chatqna's response metadata carries the EFFECTIVE filter it applied —
    the A side of the scope comparison. A response without it records none."""
    set_path = _set_file(tmp_path, extra_answerable=("c1", "c2"))
    seam, _ = _seam({"c1": "a1", "c2": "a2"}, filter_labels_by_id={"c1": ["Forestry"]})
    result = drivers.run_config_a_capture(set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS)
    assert result["rows"]["c1"]["filter_labels"] == ["Forestry"]
    assert "filter_labels" not in result["rows"]["c2"]


def _scoped_rows(case_id, labels):
    """One ok row on each leg, both scoped on the given effective filter."""
    captured = {
        case_id: {
            "case_id": case_id,
            "status": "ok",
            "answer": "an answer",
            "wall_ms": 10.0,
            "filter_labels": list(labels),
            "retrieval_scope": {
                "sent_labels": {"category_labels": list(labels), "service_labels": []},
                "case_requested_labels": list(labels),
            },
        }
    }
    rows = {
        case_id: {
            "case_id": case_id,
            "status": "ok",
            "answer": "an answer",
            "abstained": False,
            "wall_ms": 100.0,
            "metadata": {"filter_labels": list(labels)},
        }
    }
    return captured, rows


def test_e01_compares_the_effective_scope_of_both_legs():
    """Both lanes record the filter they ACTUALLY applied — the comparison is
    a measured fact, not a proxy."""
    captured, rows = _scoped_rows("c1", ["Forestry"])
    report = _build(captured_rows=captured, b_rows=rows)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["scope_matched"] is True
    assert scope["n_compared_cases"] == 1
    assert scope["cases_with_a_different_effective_scope"] == []
    assert scope["A"]["effective_filter_labels_per_case"]["c1"] == ["Forestry"]
    assert scope["B"]["effective_filter_labels_per_case"]["c1"] == ["Forestry"]

    # A different effective scope is named, not averaged away.
    rows["c1"]["metadata"] = {"filter_labels": ["Other"]}
    report = _build(captured_rows=captured, b_rows=rows)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["scope_matched"] is False
    assert scope["cases_with_a_different_effective_scope"] == ["c1"]


def test_e01_compares_the_effective_scopes_as_sets():
    """A scope is a SET of labels — under the default OR strategy the
    retriever filters on their union, under the AND strategy it requires all
    of them, and a repeated label is not a scope difference under either.
    chatqna dedups the filter it builds; the noagent lane applies the request
    verbatim — comparing the lists would publish a scope difference that does
    not exist."""
    captured, rows = _scoped_rows("c1", ["Forestry"])
    rows["c1"]["metadata"] = {"filter_labels": ["Forestry", "Forestry"]}
    report = _build(captured_rows=captured, b_rows=rows)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["scope_matched"] is True
    assert scope["cases_with_a_different_effective_scope"] == []
    # The recorded facts stay as they were measured.
    assert scope["A"]["effective_filter_labels_per_case"]["c1"] == ["Forestry"]
    assert scope["B"]["effective_filter_labels_per_case"]["c1"] == ["Forestry", "Forestry"]
    # The note names BOTH filter strategies — the union claim is only the
    # default, and the judge must not read it as unconditional.
    assert "under the default OR strategy" in scope["note"]
    assert "under AND it requires all of them" in scope["note"]


def test_e01_drops_a_credential_named_like_a_token_count():
    """A `_tokens` name is a count only when it carries no credential
    marker — "password_tokens" is not a count."""
    rows = _b_rows()
    rows["c1"]["metadata"] = {"password_tokens": "LEAK", "cached_tokens": 3}
    report = _build(b_rows=rows)
    recorded = report["per_case"]["c1"]["b"]["metadata"]
    assert "password_tokens" not in recorded
    assert recorded["cached_tokens"] == 3
    assert "LEAK" not in json.dumps(report)


def test_e01_records_the_missing_labels_per_label_not_per_case():
    """The two scope findings are recorded PER LABEL: one case can carry both
    — a label the request never carried AND a label the filter dropped — and
    only the labels say which is which. The case-id lists are derived from
    them."""
    captured = _captured_rows()
    captured["c1"]["retrieval_scope"] = {
        # The request carried "Zed" but never "Xan".
        "sent_labels": {"category_labels": ["Zed"], "service_labels": []},
        "case_requested_labels": ["Xan", "Zed"],
    }
    captured["c1"]["filter_labels"] = ["Other"]
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["A"]["requested_labels_not_sent"] == {"c1": ["Xan"]}
    assert scope["A"]["requested_labels_missing_from_the_effective_filter"] == {"c1": ["Xan", "Zed"]}
    # The case-id lists are the index of the per-label records.
    assert scope["A"]["cases_whose_requested_labels_were_not_sent"] == ["c1"]
    assert scope["A"]["cases_whose_requested_labels_never_became_an_effective_filter"] == ["c1"]
    # The report records the EFFECT, not a cause.
    assert "the report records the EFFECT" in scope["note"]


def test_e01_names_a_requested_label_that_never_became_a_filter():
    """The requested labels are checked against the filter that was applied —
    a requested label the filter never carried is the finding, not merely an
    empty request. The request-side fact is named beside it: the request
    carried "Timber", never the requested "Forestry"."""
    captured = _captured_rows()
    captured["c1"]["retrieval_scope"] = {
        "sent_labels": {"category_labels": ["Timber"], "service_labels": []},
        "case_requested_labels": ["Forestry"],
    }
    captured["c1"]["filter_labels"] = ["Timber"]
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["A"]["cases_whose_requested_labels_never_became_an_effective_filter"] == ["c1"]
    # The request never carried the requested label — that is the CAUSE, and
    # it is true whether or not the response measured a filter.
    assert scope["A"]["cases_whose_requested_labels_were_not_sent"] == ["c1"]


def test_e01_names_a_requested_label_the_filter_dropped_but_the_request_carried():
    """chatqna collapses a requested category into its service: the request
    carried the label, the measured filter does not. The finding is the
    filter's, not the request's."""
    captured = _captured_rows()
    captured["c1"]["retrieval_scope"] = {
        "sent_labels": {"category_labels": ["Forestry"], "service_labels": ["ForestryService"]},
        "case_requested_labels": ["Forestry"],
    }
    captured["c1"]["filter_labels"] = ["ForestryService"]
    report = _build(captured_rows=captured)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["A"]["cases_whose_requested_labels_never_became_an_effective_filter"] == ["c1"]
    assert scope["A"]["cases_whose_requested_labels_were_not_sent"] == []


def test_e01_scope_match_is_null_when_the_comparison_is_partial():
    """A leg that recorded no scope for a case leaves the comparison
    partial — the report says so instead of publishing a verdict over the
    cases it never compared."""
    captured, rows = _scoped_rows("c1", ["Forestry"])
    captured["c2"] = {
        "case_id": "c2",
        "status": "ok",
        "answer": "an answer",
        "wall_ms": 10.0,
        "filter_labels": ["Timber"],
        "retrieval_scope": {
            "sent_labels": {"category_labels": ["Timber"], "service_labels": []},
            "case_requested_labels": [],
        },
    }
    # c2 is scoped on A but not on B → the comparison is partial.
    report = _build(captured_rows=captured, b_rows=rows)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["n_compared_cases"] == 1
    assert scope["n_scoped_cases"] == {"A": 2, "B": 1}
    assert scope["scope_matched"] is None
    assert scope["B"]["cases_without_a_recorded_scope"] == []


def test_e01_scope_match_is_null_when_a_case_measured_no_filter():
    """A case that recorded a scope but measured NO effective filter leaves
    the comparison partial — the report publishes null, never a match it did
    not measure. The verdict must not read as a match over the cases
    it compared, with an unmeasured case counted in."""
    captured, rows = _scoped_rows("c1", ["Forestry"])
    # c2 is scoped on A, measured no filter, and has no B counterpart.
    captured["c2"] = {
        "case_id": "c2",
        "status": "ok",
        "answer": "an answer",
        "wall_ms": 10.0,
        "retrieval_scope": {
            "sent_labels": {"category_labels": ["Timber"], "service_labels": []},
            "case_requested_labels": [],
        },
    }
    report = _build(captured_rows=captured, b_rows=rows)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    assert scope["A"]["cases_without_a_measured_effective_filter"] == ["c2"]
    # Every scoped case was compared and the scopes agree — but one case was
    # never measured, so the verdict is null, not true.
    assert scope["n_compared_cases"] == 1
    assert scope["n_scoped_cases"] == {"A": 1, "B": 1}
    assert scope["scope_matched"] is None


def test_e01_scope_mismatch_over_a_partial_comparison_publishes_false():
    """An observed mismatch publishes false even over a partial comparison —
    the report says so in its note, and the note is asserted.

    The comparison here IS partial: c2 is scoped on the A leg only, so the
    two legs never compared every scoped case — and the observed mismatch on
    c1 still publishes false rather than null."""
    captured, rows = _scoped_rows("c1", ["Forestry"])
    rows["c1"]["metadata"] = {"filter_labels": ["Other"]}
    captured["c2"] = {
        "case_id": "c2",
        "status": "ok",
        "answer": "an answer",
        "wall_ms": 10.0,
        "filter_labels": ["Timber"],
        "retrieval_scope": {
            "sent_labels": {"category_labels": ["Timber"], "service_labels": []},
            "case_requested_labels": [],
        },
    }
    report = _build(captured_rows=captured, b_rows=rows)
    scope = report["uncontrolled_differences"]["retrieval_scope"]
    # The comparison is partial (c2 has no B counterpart) …
    assert scope["n_compared_cases"] == 1
    assert scope["n_scoped_cases"] == {"A": 2, "B": 1}
    # … and the observed mismatch still publishes false.
    assert scope["scope_matched"] is False
    assert scope["cases_with_a_different_effective_scope"] == ["c1"]
    assert "an observed mismatch publishes false even over a partial comparison" in scope["note"]


def test_capture_a_records_a_string_valued_label_as_one_label(tmp_path):
    """The legacy string shape is ONE label — splitting it into characters
    would be a silent lie about the scope."""
    set_path = _set_file(tmp_path, extra_answerable=("c1",))
    _patch_case(set_path, "c1", categoryLabels="Tomato")
    seam, _ = _seam({"c1": "a1"})
    result = drivers.run_config_a_capture(
        set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS
    )
    assert result["rows"]["c1"]["retrieval_scope"]["sent_labels"]["category_labels"] == ["Tomato"]


def test_capture_a_times_the_seam_call_only(tmp_path, monkeypatch):
    """The A leg's wall_ms covers the seam call — the same work the B leg
    times — not the row assembly around it."""

    class _Clock:
        """A monotonic clock that ADVANCES on every read (100.0, 100.25, ...).

        A clock that holds its last tick cannot tell a moved measurement from
        the right one; an advancing one makes every extra or moved read
        change the measured delta.
        """

        def __init__(self, start=100.0, step=0.25):
            self._value = start
            self._step = step

        def monotonic(self):
            value = self._value
            self._value += self._step
            return value

    set_path = _set_file(tmp_path, extra_answerable=("c1",))
    monkeypatch.setattr(drivers, "time", _Clock())
    seam, _ = _seam({"c1": "a1"})
    result = drivers.run_config_a_capture(
        set_path, tmp_path / "out", query=seam, corpus_fingerprint=CORPUS
    )
    # c1 is the first timed case: two reads (start, end) around the seam.
    assert result["rows"]["c1"]["wall_ms"] == 250.0
    # EVERY timed case measures the same two reads — a case after the first
    # is not measured differently (a moved or extra read would show here).
    timed = [row for row in result["rows"].values() if row.get("status") == "ok"]
    assert len(timed) > 1, "the fixture timed a single case — the check would be vacuous"
    assert {row["wall_ms"] for row in timed} == {250.0}


def test_e01_report_carries_the_coverage_census_the_capture_stamped():
    """The arbitration's basis is STATED, not inferred: the census says how
    many cases carry a resolved surface and on which surface each class is
    measured. A capture that carries no census is recorded absent."""
    census = {
        "n_set_cases": 16,
        "n_cases_with_a_resolved_surface": 16,
        "by_surface": {"retrieval": 6, "outcome": 3, "security": 7, "restricted_access": 0},
        "retrieval_cases_without_gold": [],
    }
    stamp = dict(_capture_stamp(), coverage=census)
    report = _build(capture_stamp=stamp)
    assert report["counts"]["coverage"] == census
    # Absent — recorded as None, never reconstructed.
    assert _build()["counts"]["coverage"] is None
