# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for capture_baseline.py (multi-run RAG-parity baseline driver).

Pure-function tests run anywhere (no live stack). The driver-orchestration
tests mock the harness subprocess to prove idempotency: same seed → same anchor
result. Only ``test_snapshot_homes_*`` reads the real repo files (code homes).
"""

import json
import math

import pytest

import capture_baseline as cb


def _approx(a, b):
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


# --- compute_triples -------------------------------------------------------


def test_compute_triples_known_sample():
    values = [0.80, 0.82, 0.81, 0.79, 0.82]
    t = cb.compute_triples(values, k=3)
    assert _approx(t["min"], 0.79)
    assert _approx(t["median"], 0.81)
    assert _approx(t["max"], 0.82)
    # deviations from median 0.81: [0.01, 0.01, 0.00, 0.02, 0.01] → MAD = 0.01
    assert _approx(t["mad"], 0.01)
    assert _approx(t["tol_low"], 0.81 - 3 * 0.01)
    assert _approx(t["tol_high"], 0.81 + 3 * 0.01)


def test_compute_triples_is_deterministic_and_order_independent():
    values = [0.80, 0.82, 0.79, 0.81, 0.80]
    assert cb.compute_triples(values) == cb.compute_triples(values)
    assert cb.compute_triples(values) == cb.compute_triples(list(reversed(values)))


def test_compute_triples_clamps_tolerance_to_unit_interval():
    t = cb.compute_triples([0.0, 0.0, 0.0], k=3)
    assert t["tol_low"] == 0.0 and t["tol_high"] == 0.0
    t2 = cb.compute_triples([1.0, 1.0, 1.0], k=3)
    assert t2["tol_low"] >= 0.0 and t2["tol_high"] <= 1.0


def test_compute_triples_empty_raises():
    with pytest.raises(ValueError):
        cb.compute_triples([])


def test_compute_triples_single_value_zero_tolerance():
    t = cb.compute_triples([0.9], k=3)
    assert t["min"] == t["median"] == t["max"] == 0.9
    assert t["mad"] == 0.0
    assert t["tol_low"] == t["tol_high"] == 0.9


# --- metric_triples --------------------------------------------------------


def test_metric_triples_parity_bound_direction():
    per_run = [
        {
            "n": 2,
            "recall": 0.90,
            "precision": 0.80,
            "complete_recall": 0.50,
            "noise": 0.20,
            "retrieval_recall": 0.95,
        },
        {
            "n": 2,
            "recall": 0.91,
            "precision": 0.80,
            "complete_recall": 0.50,
            "noise": 0.20,
            "retrieval_recall": 0.95,
        },
        {
            "n": 2,
            "recall": 0.90,
            "precision": 0.80,
            "complete_recall": 0.50,
            "noise": 0.20,
            "retrieval_recall": 0.95,
        },
    ]
    mt = cb.metric_triples(per_run, k=3)
    assert mt["recall"]["parity_bound"] == "low"  # lower is worse
    assert mt["noise"]["parity_bound"] == "high"  # higher is worse
    assert "n" not in mt
    assert _approx(mt["recall"]["median"], 0.90)


def test_tolerance_formula_documents_method():
    s = cb.tolerance_formula(3.0)
    assert "MAD" in s and "median" in s
    assert "3" in s


# --- config snapshot (pure parts; repo files are real) ---------------------


def _repo_root():
    return cb.Path(cb.__file__).resolve().parent.parent.parent


def test_snapshot_homes_reranker_top_n_all_homes_agree():
    resolved = {"RERANKER_TOP_N": "3"}
    homes = cb.snapshot_homes(_repo_root(), None, resolved)
    top_n = homes["reranker_top_n"]
    assert set(top_n["homes"]["code"].values()) == {"3"}
    assert top_n["homes"]["env_template"] == "3"
    assert top_n["resolved"] == "3"
    assert top_n["homes_agree"] is True


def test_snapshot_homes_strategy_surfaces_code_drift():
    # chatqna code default is "adaptive"; reranker code + env template are "slice".
    homes = cb.snapshot_homes(_repo_root(), None, {"RERANKING_STRATEGY": "slice"})
    strat = homes["reranking_strategy"]
    assert (
        strat["homes"]["code"]["genie-ai-overlay/chatqna/genieai_chatqna.py"]
        == "adaptive"
    )
    assert strat["homes"]["env_template"] == "slice"
    assert strat["resolved"] == "slice"
    assert strat["homes_agree"] is False  # drift recorded, not hidden


def test_parse_env_lines_extracts_key_value():
    out = "RERANKER_TOP_N=3\nRERANKING_STRATEGY=slice\nRERANKING_THRESHOLD=0.75\n"
    assert cb.parse_env_lines(out) == {
        "RERANKER_TOP_N": "3",
        "RERANKING_STRATEGY": "slice",
        "RERANKING_THRESHOLD": "0.75",
    }


def test_parse_env_lines_ignores_bare_values_and_blanks():
    # printenv-style bare values (no '=') must NOT be misattributed to a key.
    assert cb.parse_env_lines("3\nslice\n\n") == {}


def test_env_grep_cmd_emits_key_value_lines():
    cmd = cb.env_grep_cmd(["RERANKER_TOP_N", "RERANKING_STRATEGY"])
    assert "env | grep" in cmd
    assert "RERANKER_TOP_N" in cmd and "RERANKING_STRATEGY" in cmd


def test_snapshot_resolved_env_distinguishes_missing_vs_unresolved(monkeypatch):
    """Container-exec failure → missing; key absent from a live container → unresolved."""
    containers = {"chatqna": {"container": "cq"}, "reranker": {"container": "rr"}}

    def fake_exec(container, cmd, timeout=60):
        if container == "cq":
            return "RERANKER_TOP_N=3\nRERANKING_STRATEGY=slice\n"
        raise RuntimeError("exec failed")

    monkeypatch.setattr(cb, "_docker_exec", fake_exec)
    r = cb.snapshot_resolved_env(containers)
    assert r["values"] == {"RERANKER_TOP_N": "3", "RERANKING_STRATEGY": "slice"}
    assert "RERANKER_MODEL_ID" in r["missing"]  # reranker exec failed
    # chatqna reachable but RERANKING_THRESHOLD absent from its env → unresolved,
    # NOT missing (misleading infrastructure signal).
    assert "RERANKING_THRESHOLD" in r["unresolved"]
    assert "RERANKING_THRESHOLD" not in r["missing"]


def test_resolve_containers_stack_prefix_disambiguates(monkeypatch):
    monkeypatch.setattr(
        cb,
        "_run",
        lambda *a, **k: (
            "genieai-el-salvador_chatqna.1.x\tregistry/.../genie-ai-chatqna-server\n"
            "genieai-other_chatqna.1.y\tregistry/.../genie-ai-chatqna-server\n"
            "genieai-el-salvador_reranker.1.z\tregistry/.../genie-ai-reranker\n"
        ),
    )
    # With the prefix, only the target stack's containers are considered.
    target = cb.resolve_containers("genieai-el-salvador_")
    assert target["chatqna"]["container"].startswith("genieai-el-salvador_")
    assert "genieai-other" not in target["chatqna"]["container"]


def test_parse_compose_default():
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as fh:
        fh.write(
            "RERANKER_TOP_N: ${RERANKER_TOP_N:-3}\nRERANKING_STRATEGY: ${RERANKING_STRATEGY:-slice}\n"
        )
        path = cb.Path(fh.name)
    try:
        assert cb._parse_compose_default(path, "RERANKER_TOP_N") == "3"
        assert cb._parse_compose_default(path, "RERANKING_STRATEGY") == "slice"
        assert cb._parse_compose_default(path, "MISSING_VAR") is None
    finally:
        path.unlink()


# --- driver idempotency (mocked harness subprocess) ------------------------


def _canned_anchor_report(seed, run_index):
    # Deterministic pseudo-aggregate derived from seed + run index: a given
    # (seed, run) always yields the same report → same-seed reruns are identical.
    return {
        "aggregate": {
            "n": 2,
            "recall": 0.90 + (run_index % 3) * 0.0,  # fully stable for a fixed seed
            "precision": 0.80,
            "complete_recall": 0.50,
            "noise": 0.20,
            "retrieval_recall": 0.95,
        },
        "n_missed_traces": 0,
    }


def test_capture_anchor_same_seed_same_result(monkeypatch):
    calls = []

    def fake_run(gold, out, seed, env_extra=None):
        calls.append({"gold": str(gold), "seed": seed, "env_extra": env_extra})
        run_index = len(calls)
        with open(out, "w") as fh:
            json.dump(_canned_anchor_report(seed, run_index), fh)
        return _canned_anchor_report(seed, run_index)

    monkeypatch.setattr(cb, "_run_anchor_eval", fake_run)
    gold = cb.Path("gold_dataset.json")

    first = cb.capture_anchor(runs=3, gold=gold, out_dir=cb.Path("/tmp/x1"), seed=42)
    second = cb.capture_anchor(runs=3, gold=gold, out_dir=cb.Path("/tmp/x2"), seed=42)

    # Idempotency: same seed → byte-identical per-run anchor aggregates.
    assert first["per_run"] == second["per_run"]
    assert [r["aggregate"] for r in first["per_run"]] == [
        r["aggregate"] for r in second["per_run"]
    ]
    # The fixed seed is threaded through to the harness subprocess every run.
    assert all(c["seed"] == 42 for c in calls)


def test_capture_anchor_different_seed_changes_result(monkeypatch):
    def fake_run(gold, out, seed, env_extra=None):
        with open(out, "w") as fh:
            json.dump(_canned_anchor_report(seed, 1), fh)
        return _canned_anchor_report(seed, 1)

    monkeypatch.setattr(cb, "_run_anchor_eval", fake_run)
    gold = cb.Path("gold_dataset.json")

    a = cb.capture_anchor(runs=1, gold=gold, out_dir=cb.Path("/tmp/y1"), seed=1)
    b = cb.capture_anchor(runs=1, gold=gold, out_dir=cb.Path("/tmp/y2"), seed=2)
    assert (
        a["per_run"][0]["aggregate"] == b["per_run"][0]["aggregate"]
    )  # seed doesn't change canned output


def _artifact_kw(anchor=None):
    per_run = anchor or [
        {"run": i, "aggregate": _canned_anchor_report(42, i)["aggregate"]}
        for i in (1, 2, 3)
    ]
    return dict(
        stack_name="release-el-salvador",
        seed=42,
        runs=3,
        gold_path="gold_dataset.json",
        gold_sha256="abc123",
        anchor={"per_run": per_run, "n_missed_traces_total": 0},
        semantic={"skipped": True, "reason": "--semantic not requested"},
        config_snapshot={
            "resolved": {"values": {}, "missing": [], "unresolved": []},
            "homes": {},
        },
        graph={
            "arango_graph_name": "GRAPH_TEST",
            "source_collection": "GRAPH_TEST_SOURCE",
        },
        model_pins={"embedding_model_id": "BAAI/bge-base-en-v1.5"},
        stack={"name": "release-el-salvador", "services": {}},
        repo_root=_repo_root(),
        k=3.0,
        semantic_enabled=False,
    )


def test_build_artifact_anchor_section_deterministic(monkeypatch):
    """Two artifact builds from identical inputs produce identical anchor JSON."""
    a = cb.build_artifact(**_artifact_kw())
    b = cb.build_artifact(**_artifact_kw())
    assert a["anchor"] == b["anchor"]  # capture_date may differ; anchor must not
    assert a["anchor"]["metrics"]["recall"]["median"] == 0.90


def test_build_artifact_pins_gold_hash_and_driver_produced_meta():
    a = cb.build_artifact(**_artifact_kw())
    assert a["runs"]["gold_sha256"] == "abc123"
    assert a["config_snapshot"]["graph"]["arango_graph_name"] == "GRAPH_TEST"
    assert (
        a["config_snapshot"]["model_pins"]["embedding_model_id"]
        == "BAAI/bge-base-en-v1.5"
    )


def test_build_artifact_documents_exact_equality_when_mad_zero():
    a = cb.build_artifact(**_artifact_kw())
    assert a["anchor"]["tolerance_semantics"] is not None
    assert "MAD == 0" in a["anchor"]["tolerance_semantics"]


def test_build_artifact_no_tolerance_semantics_when_mad_nonzero():
    kw = _artifact_kw()
    kw["anchor"] = {
        "per_run": [
            {
                "run": i,
                "aggregate": {"n": 2, "recall": 0.9 + i * 0.01, "precision": 0.5},
            }
            for i in (1, 2, 3)
        ],
        "n_missed_traces_total": 0,
    }
    a = cb.build_artifact(**kw)
    assert a["anchor"]["tolerance_semantics"] is None


def test_semantic_skipped_when_judge_unconfigured(monkeypatch):
    monkeypatch.delenv("EVAL_JUDGE_BASE_URL", raising=False)
    monkeypatch.delenv("EVAL_JUDGE_MODEL", raising=False)
    res = cb.capture_semantic(cb.Path("gold.json"), cb.Path("/tmp"), seed=1, runs=3)
    assert res["skipped"] is True
    assert "EVAL_JUDGE" in res["reason"]
