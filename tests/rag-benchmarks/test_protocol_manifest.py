# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/manifest.py — the run-manifest builder.

Every run's manifest records corpus fingerprint, set digests, resolved
configuration, model ids, prompt digests and the evaluator-instructions
digest, with no credentials anywhere in the record.
"""

import json
from pathlib import Path

import pytest

from protocol import manifest as mf
from protocol import pairs as pairs_mod

EVALUATOR_INSTRUCTIONS = Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md"


def _corpus(fingerprint="f" * 64):
    return {"source_collection": "GRAPH_TEST_SOURCE", "arango_graph_name": "GRAPH_TEST", "fingerprint": fingerprint}


def _sets(set_sha="a" * 64):
    return {"assessment": {"path": "sets/assessment.json", "sha256": set_sha}}


def _configuration(**overrides):
    entry = {
        "resolved_env": {"RERANKER_TOP_N": "3", "RERANKING_STRATEGY": "slice"},
        "model_ids": {"llm": "granite-4.1-8b"},
        "prompt_digests": {"system": "d" * 64},
    }
    entry.update(overrides)
    return {"A": entry}


def _build_reference(**kw):
    args = dict(
        kind="reference",
        config="A",
        corpus=_corpus(),
        sets=_sets(),
        configuration=_configuration(),
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        created_utc="2026-11-22T00:00:00+00:00",
    )
    args.update(kw)
    return mf.build_manifest(**args)


def test_reference_manifest_carries_every_version_record():
    m = _build_reference()
    assert m["artifact"] == "run-manifest"
    assert m["kind"] == "reference"
    assert m["config"] == "A"
    assert m["corpus"]["fingerprint"] == "f" * 64
    assert m["sets"]["assessment"]["sha256"] == "a" * 64
    assert m["configuration"]["A"]["model_ids"] == {"llm": "granite-4.1-8b"}
    assert m["configuration"]["A"]["prompt_digests"] == {"system": "d" * 64}
    assert m["evaluator_instructions"]["sha256"] == mf.sha256_file(EVALUATOR_INSTRUCTIONS)


def test_manifest_is_deterministic_for_identical_inputs():
    assert _build_reference() == _build_reference()


def test_gated_manifest_requires_lineage():
    with pytest.raises(mf.ManifestError) as failed:
        _build_reference(kind="gated", config="B")
    assert "lineage" in str(failed.value)


def test_reference_manifest_refuses_a_lineage():
    with pytest.raises(mf.ManifestError):
        _build_reference(lineage={"reference_manifest_sha256": "x", "thresholds_sha256": "y"})


def test_gated_manifest_chains_lineage():
    lineage = {"reference_manifest_sha256": "r" * 64, "thresholds_sha256": "t" * 64}
    m = _build_reference(kind="gated", config="C", lineage=lineage)
    assert m["lineage"] == lineage
    assert m["kind"] == "gated"


def test_unknown_kind_and_config_refused():
    with pytest.raises(mf.ManifestError):
        _build_reference(kind="other")
    with pytest.raises(mf.ManifestError):
        _build_reference(config="D")


def test_credentials_never_reach_the_record():
    """Every credential-named env key is dropped before recording."""
    configuration = _configuration(
        resolved_env={
            "RERANKER_TOP_N": "3",
            "KEYCLOAK_ADMIN_PASSWORD": "hunter2",
            "VLLM_API_KEY": "sk-secret",
            "E2E_BEARER_TOKEN": "tok",
            "ARANGO_PASSWORD": "pw",
            "KC_OKF_ACCESS_CLIENT_SECRET": "s",
        }
    )
    m = _build_reference(configuration=configuration)
    recorded = m["configuration"]["A"]["resolved_env"]
    assert recorded == {"RERANKER_TOP_N": "3"}
    joined = json.dumps(m)
    for secret in ("hunter2", "sk-secret", "tok", "pw"):
        assert secret not in joined


def test_non_secret_keys_survive_redaction():
    assert mf.redact({"RETRIES": "3", "graph_name": "G"}) == {"RETRIES": "3", "graph_name": "G"}


def test_fingerprint_corpus_deterministic_and_order_insensitive():
    a = mf.fingerprint_corpus("COLL", ["h1", "h2", "h3"])
    b = mf.fingerprint_corpus("COLL", ["h3", "h1", "h2"])
    assert a == b
    assert a != mf.fingerprint_corpus("COLL", ["h1", "h2"])
    assert a != mf.fingerprint_corpus("OTHER", ["h1", "h2", "h3"])


def test_sha256_json_is_canonical():
    assert mf.sha256_json({"a": 1, "b": 2}) == mf.sha256_json({"b": 2, "a": 1})
    assert mf.sha256_json({"a": 1}) != mf.sha256_json({"a": 2})


def test_manifest_digest_stable_and_discriminating():
    assert mf.manifest_digest(_build_reference()) == mf.manifest_digest(_build_reference())
    assert mf.manifest_digest(_build_reference()) != mf.manifest_digest(_build_reference(corpus=_corpus("e" * 64)))


def test_manifest_stamps_the_pair_conditions():
    m = _build_reference(pair="E01")
    assert m["pair"] == pairs_mod.PAIR_CONDITIONS["E01"]


# --- pairs.py — the shipped pair conditions, checkable against run manifests


def test_pair_conditions_record_held_fixed_and_differences():
    e01 = pairs_mod.pair_conditions("E01")
    assert e01["compares"] == ["A", "B"]
    assert e01["held_fixed"] == ["corpus", "evaluation_set", "execution_conditions", "model_services"]
    assert e01["intentional_difference"] == "retrieval_backend"
    e02 = pairs_mod.pair_conditions("E02")
    assert e02["compares"] == ["B", "C"]
    assert e02["held_fixed"] == ["retrieval_backend", "preparation", "admission_policy"]
    assert e02["intentional_difference"] == "orchestration"


def test_pair_conditions_returns_a_copy():
    stamped = pairs_mod.pair_conditions("E01")
    stamped["held_fixed"] = []
    assert pairs_mod.PAIR_CONDITIONS["E01"]["held_fixed"] != []


def test_pair_conditions_copy_is_deep():
    """A DEEP copy: mutating a returned NESTED list must not touch the
    shipped manifest (a shallow copy shares the lists)."""
    stamped = pairs_mod.pair_conditions("E01")
    stamped["held_fixed"].append("tampered")
    stamped["compares"].clear()
    shipped = pairs_mod.PAIR_CONDITIONS["E01"]
    assert shipped["held_fixed"] == ["corpus", "evaluation_set", "execution_conditions", "model_services"]
    assert shipped["compares"] == ["A", "B"]


def test_check_run_against_pair_accepts_a_correctly_stamped_manifest():
    m = _build_reference(pair="E01")
    assert pairs_mod.check_run_against_pair(m) == []


def test_check_run_against_pair_names_a_missing_stamp():
    m = _build_reference()
    errors = pairs_mod.check_run_against_pair(m)
    assert errors and "no pair stamp" in errors[0] and "E01" in errors[0]


def test_check_run_against_pair_names_a_wrong_pair_for_the_config():
    m = _build_reference(
        config="C", kind="gated", lineage={"reference_manifest_sha256": "r", "thresholds_sha256": "t"}, pair="E01"
    )
    errors = pairs_mod.check_run_against_pair(m)
    assert errors and "E02" in errors[0]


def test_check_run_against_pair_detects_mutated_conditions():
    m = _build_reference(pair="E01")
    m["pair"]["held_fixed"] = ["corpus"]
    errors = pairs_mod.check_run_against_pair(m)
    assert any("held_fixed" in e for e in errors)


def test_unknown_pair_refused():
    with pytest.raises(pairs_mod.PairError):
        pairs_mod.pair_conditions("E03")
