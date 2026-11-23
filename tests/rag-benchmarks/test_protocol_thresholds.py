# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/thresholds.py (+ the thresholds CLI wiring).

Every registry/promotion row of the story's matrix through fixtures — temp
registries, fake reference manifests, no live venue:

* the shipped registry loads, reports every measured dimension (M-1..M-5) as
  EXPLICITLY absent with its reason, and BLOCKS the promotion — no value is
  defaulted and no threshold is invented;
* the gate sign-off owner is exposed, and a missing or unsigned sign-off
  blocks promotion exactly like an absent threshold;
* an incomplete registry, a malformed one, an unknown dimension and a registry
  without an owner are refused with a typed reason;
* a blocked registry produces NO signed artifact (the report records the
  blocking reasons), and a complete one derives a gate-compatible signed
  thresholds file the partial-order gate accepts.
"""

import argparse
import copy
import json
import sys
from pathlib import Path

import pytest
import yaml

from protocol import gate
from protocol import thresholds as thresholds_mod
from protocol.manifest import build_manifest, manifest_digest, sha256_json
from protocol.run_protocol import cmd_thresholds, main

REGISTRY = Path(__file__).resolve().parent / "protocol" / "thresholds.yaml"
EVALUATOR_INSTRUCTIONS = Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md"
CORPUS = "c" * 64
SET_SHA = "a" * 64
CREATED = "2026-11-23T00:00:00+00:00"
OWNER = "jrevillard (ITU)"


# ---------------------------------------------------------------------------
# Fixtures — the shipped registry + synthetic registries and manifests
# ---------------------------------------------------------------------------


def _dimension(code: str, *, status: str, value, absent_reason: str | None = None) -> dict:
    """One fixture dimension entry: the shape the registry contract asks for,
    written once."""
    return {
        "dimension": thresholds_mod.M_DIMENSIONS[code],
        "surface": "the fixture measurement surface",
        "status": status,
        "value": value,
        "absent_reason": absent_reason,
        "rationale": "the fixture rationale",
        "agreement_date": None if status == thresholds_mod.STATUS_ABSENT else "2026-11-23",
    }


def _agreed_dimension(code: str, value) -> dict:
    return _dimension(code, status=thresholds_mod.STATUS_AGREED, value=value)


def _registry(*, signed: bool = True, owner: str = OWNER, absent: tuple = ()) -> dict:
    """A synthetic registry: every dimension agreed, unless it is named in
    ``absent`` (then it carries an explicit absence with its reason)."""
    dimensions = {
        code: _agreed_dimension(code, 0.5) for code in thresholds_mod.MEASURED_DIMENSIONS
    }
    for code in absent:
        dimensions[code] = _dimension(
            code,
            status=thresholds_mod.STATUS_ABSENT,
            value=None,
            absent_reason="the fixture reason: the measured reference is pending",
        )
    return {
        "registry_version": "1.0.0",
        "artifact": thresholds_mod.THRESHOLD_REGISTRY_ARTIFACT,
        "description": "the fixture registry",
        "sign_off": {
            "owner": owner,
            "signed": signed,
            "agreed_on": "2026-11-23",
            "signed_on": "2026-11-23" if signed else None,
            "note": "the fixture note",
        },
        "dimensions": dimensions,
    }


def _write_registry(tmp_path, registry: dict, name: str = "registry.yaml") -> Path:
    path = tmp_path / name
    path.write_text(yaml.safe_dump(registry, sort_keys=False), encoding="utf-8")
    return path


def _reference_manifest() -> dict:
    return build_manifest(
        kind="reference",
        config="A",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": CORPUS},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": SET_SHA}},
        configuration={"A": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        created_utc=CREATED,
    )


def _write_reference(tmp_path, manifest: dict) -> Path:
    path = tmp_path / "reference.manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def _args(registry: Path, **overrides) -> argparse.Namespace:
    args = argparse.Namespace(
        registry=str(registry),
        reference_manifest=None,
        out=None,
        report=None,
        created_utc=CREATED,
    )
    for key, value in overrides.items():
        setattr(args, key, value)
    return args


# ---------------------------------------------------------------------------
# The shipped registry — every dimension absent, the promotion blocked
# ---------------------------------------------------------------------------


def test_the_shipped_registry_loads_and_reports_every_dimension_absent():
    registry = thresholds_mod.load_registry(REGISTRY)
    decision = thresholds_mod.promotion_decision(registry)
    assert decision["promotion"] == "blocked"
    assert set(decision["dimensions"]) == set(thresholds_mod.MEASURED_DIMENSIONS)
    for code in thresholds_mod.MEASURED_DIMENSIONS:
        record = decision["dimensions"][code]
        assert record["status"] == thresholds_mod.STATUS_ABSENT
        assert record["value"] is None
        assert record["absent_reason"]
        blocking = [
            reason
            for reason in decision["blocking_reasons"]
            if reason["code"] == thresholds_mod.BLOCK_DIMENSION_ABSENT and reason["dimension"] == code
        ]
        assert blocking, f"{code} does not block the promotion"


def test_the_shipped_registry_invents_no_threshold_value():
    registry = thresholds_mod.load_registry(REGISTRY)
    for code in thresholds_mod.MEASURED_DIMENSIONS:
        assert registry["dimensions"][code]["value"] is None


def test_the_shipped_registry_exposes_the_sign_off_owner():
    registry = thresholds_mod.load_registry(REGISTRY)
    decision = thresholds_mod.promotion_decision(registry)
    assert decision["sign_off"]["owner"] == OWNER
    report = thresholds_mod.build_thresholds_report(registry, created_utc=CREATED)
    assert report["sign_off"]["owner"] == OWNER


def test_the_report_digest_is_reproducible_under_a_pinned_created_utc():
    registry = thresholds_mod.load_registry(REGISTRY)
    first = thresholds_mod.build_thresholds_report(registry, created_utc=CREATED)
    second = thresholds_mod.build_thresholds_report(registry, created_utc=CREATED)
    assert first["digest"] == second["digest"]
    assert first["digest"] == thresholds_mod.thresholds_report_digest(first)


def test_the_registry_loader_imports_yaml_lazily():
    """The package stays stdlib-only: the loader pulls PyYAML in when it
    reads a registry, never at import time."""
    assert not hasattr(thresholds_mod, "yaml")


def test_the_loader_refuses_a_typed_reason_without_pyyaml(monkeypatch):
    """The lazy-import contract's refusal half: a node without PyYAML gets the
    typed ``registry_unavailable`` refusal, never an ImportError crash — every
    other command keeps working on that node."""
    monkeypatch.setitem(sys.modules, "yaml", None)
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.load_registry(REGISTRY)
    assert failed.value.reason == "registry_unavailable"


# ---------------------------------------------------------------------------
# The sign-off — an unsigned or a missing owner blocks promotion
# ---------------------------------------------------------------------------


def test_an_unsigned_sign_off_blocks_the_promotion_naming_the_owner():
    decision = thresholds_mod.promotion_decision(_registry(signed=False))
    assert decision["promotion"] == "blocked"
    blocking = [
        reason
        for reason in decision["blocking_reasons"]
        if reason["code"] == thresholds_mod.BLOCK_SIGNOFF_UNSIGNED
    ]
    assert blocking
    assert OWNER in blocking[0]["message"]


def test_a_missing_sign_off_owner_is_refused():
    registry = _registry(owner="")
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "sign_off_missing"
    assert "owner" in str(failed.value)


def test_a_missing_sign_off_header_is_refused():
    registry = _registry()
    del registry["sign_off"]
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "sign_off_missing"


# ---------------------------------------------------------------------------
# The strict registry shape — the refusals
# ---------------------------------------------------------------------------


def test_a_registry_without_the_m3_entry_is_refused():
    registry = _registry()
    del registry["dimensions"]["M-3"]
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "registry_incomplete"
    assert "M-3" in str(failed.value)


def test_a_registry_with_an_unknown_dimension_is_refused():
    registry = _registry()
    registry["dimensions"]["M-9"] = _agreed_dimension("M-1", 0.1)
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "registry_unknown_dimension"
    assert "M-9" in str(failed.value)


def test_a_malformed_registry_is_refused_naming_the_file(tmp_path):
    path = tmp_path / "broken.yaml"
    path.write_text("dimensions: [unclosed\n", encoding="utf-8")
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.load_registry(path)
    assert failed.value.reason == "registry_malformed"
    assert str(path) in str(failed.value)


def test_an_unreadable_registry_is_refused_naming_the_file(tmp_path):
    path = tmp_path / "absent.yaml"
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.load_registry(path)
    assert failed.value.reason == "registry_unreadable"
    assert str(path) in str(failed.value)


def test_an_absence_without_its_reason_is_refused():
    registry = _registry(absent=("M-2",))
    registry["dimensions"]["M-2"]["absent_reason"] = None
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "registry_invalid_entry"
    assert "M-2" in str(failed.value)


def test_an_absence_carrying_a_value_is_refused():
    registry = _registry()
    registry["dimensions"]["M-2"] = {
        "dimension": "answer_grounding",
        "surface": "the fixture measurement surface",
        "status": thresholds_mod.STATUS_ABSENT,
        "value": 0.9,
        "absent_reason": "the fixture reason",
        "rationale": "the fixture rationale",
        "agreement_date": None,
    }
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "registry_invalid_entry"


def test_an_agreed_dimension_without_its_value_is_refused():
    registry = _registry()
    registry["dimensions"]["M-4"]["value"] = None
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "registry_invalid_entry"


def test_a_registry_without_the_date_fields_validates_without_injecting_keys():
    """The optional date keys are rewritten ONLY when present: validating a
    registry that omits them injects no key, mutates nothing, and the report's
    content digest equals sha256_json of the untouched dict."""
    registry = _registry(absent=tuple(thresholds_mod.MEASURED_DIMENSIONS))
    del registry["sign_off"]["agreed_on"]
    del registry["sign_off"]["signed_on"]
    for entry in registry["dimensions"].values():
        del entry["agreement_date"]
    before = copy.deepcopy(registry)
    assert thresholds_mod.validate_registry(registry) is registry
    assert registry == before
    report = thresholds_mod.build_thresholds_report(registry, created_utc=CREATED)
    assert report["registry"]["sha256"] == sha256_json(registry)


def test_a_quoted_signed_value_is_refused():
    """A quoted YAML ``signed: "false"`` is a string, not a boolean — it must
    never read as signed."""
    registry = _registry()
    registry["sign_off"]["signed"] = "false"
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "sign_off_invalid"


def test_an_unsupported_registry_version_is_refused():
    registry = _registry()
    registry["registry_version"] = "9.9.9"
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "registry_version_unsupported"
    assert thresholds_mod.THRESHOLD_REGISTRY_VERSION in str(failed.value)


def test_a_relabelled_dimension_is_refused():
    """An entry never relabels its dimension — the signed artifact would
    disagree with the report that reads it."""
    registry = _registry()
    registry["dimensions"]["M-1"]["dimension"] = "LATENCY"
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.validate_registry(registry, source="the fixture registry")
    assert failed.value.reason == "registry_invalid_entry"
    assert "retrieval_quality" in str(failed.value)


def test_an_unquoted_date_scalar_is_normalized_to_its_iso_string(tmp_path):
    """PyYAML resolves an unquoted ``2026-12-01`` to a datetime.date — the
    known date fields read as the ISO string the contract asks for."""
    text = "\n".join(
        [
            "registry_version: \"1.0.0\"",
            "artifact: \"evaluation-threshold-registry\"",
            "sign_off:",
            "  owner: \"jrevillard (ITU)\"",
            "  signed: true",
            "  agreed_on: 2026-12-01",
            "  signed_on: 2026-12-02",
            "dimensions:",
        ]
        + [
            f"""  {code}:
    dimension: "{name}"
    surface: "the fixture surface"
    status: agreed
    value: 0.5
    absent_reason: null
    rationale: "the fixture rationale"
    agreement_date: 2026-12-01"""
            for code, name in thresholds_mod.M_DIMENSIONS.items()
        ]
    )
    path = tmp_path / "dates.yaml"
    path.write_text(text, encoding="utf-8")
    registry = thresholds_mod.load_registry(path)
    assert registry["sign_off"]["agreed_on"] == "2026-12-01"
    assert registry["dimensions"]["M-1"]["agreement_date"] == "2026-12-01"
    # the report digests the registry — a date object would crash the digest
    report = thresholds_mod.build_thresholds_report(registry, created_utc=CREATED)
    assert report["digest"]


def test_an_unserializable_value_outside_the_date_fields_is_refused(tmp_path):
    """A date in a field the normalization does not cover is refused, naming
    the remedy (quote the scalar) — it never crashes a downstream digest."""
    text = "\n".join(
        [
            "registry_version: \"1.0.0\"",
            "artifact: \"evaluation-threshold-registry\"",
            "notes: 2026-12-01",
            "sign_off:",
            "  owner: \"jrevillard (ITU)\"",
            "  signed: true",
            "dimensions:",
        ]
        + [
            f"""  {code}:
    dimension: "{name}"
    surface: "the fixture surface"
    status: absent
    value: null
    absent_reason: "the fixture reason"
    rationale: "the fixture rationale"
    agreement_date: null"""
            for code, name in thresholds_mod.M_DIMENSIONS.items()
        ]
    )
    path = tmp_path / "dates.yaml"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.load_registry(path)
    assert failed.value.reason == "registry_malformed"
    assert "quote" in str(failed.value)


def test_promotion_decision_validates_the_registry_first():
    """A registry the loader would refuse never reaches a decision — a library
    caller cannot read ``allowed`` off one."""
    registry = _registry()
    del registry["dimensions"]["M-3"]
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.promotion_decision(registry)
    assert failed.value.reason == "registry_incomplete"


def test_the_report_carries_no_path_in_its_digested_body():
    """The digest covers the registry's CONTENT, never the caller's path
    spelling — the report is reproducible across path spellings."""
    registry = thresholds_mod.load_registry(REGISTRY)
    report = thresholds_mod.build_thresholds_report(registry, created_utc=CREATED)
    assert "path" not in report["registry"]


# ---------------------------------------------------------------------------
# Signing — a blocked registry produces NO signed artifact
# ---------------------------------------------------------------------------


def test_signing_a_blocked_registry_produces_no_artifact_and_records_the_reasons(tmp_path):
    registry = _registry(signed=False, absent=("M-1",))
    path = _write_registry(tmp_path, registry)
    out = tmp_path / "thresholds.json"
    report_path = tmp_path / "report.json"
    assert cmd_thresholds(_args(path, out=str(out), report=str(report_path))) == 1
    assert not out.exists()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["promotion"] == "blocked"
    assert report["derived_thresholds"] is None
    assert report["sign_off"]["owner"] == OWNER
    codes = {reason["code"] for reason in report["blocking_reasons"]}
    assert thresholds_mod.BLOCK_DIMENSION_ABSENT in codes
    assert thresholds_mod.BLOCK_SIGNOFF_UNSIGNED in codes


def test_an_absent_dimension_blocks_the_promotion_even_with_a_signed_sign_off(tmp_path):
    registry = _registry(signed=True, absent=("M-5",))
    path = _write_registry(tmp_path, registry)
    out = tmp_path / "thresholds.json"
    report_path = tmp_path / "report.json"
    assert cmd_thresholds(_args(path, out=str(out), report=str(report_path))) == 1
    assert not out.exists()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["promotion"] == "blocked"
    assert report["dimensions"]["M-5"]["status"] == thresholds_mod.STATUS_ABSENT
    assert report["dimensions"]["M-5"]["absent_reason"]


def test_signing_a_complete_registry_derives_a_gate_compatible_artifact(tmp_path):
    registry = _registry()
    path = _write_registry(tmp_path, registry)
    reference = _reference_manifest()
    reference_path = _write_reference(tmp_path, reference)
    out = tmp_path / "thresholds.json"
    assert (
        cmd_thresholds(
            _args(path, reference_manifest=str(reference_path), out=str(out))
        )
        == 0
    )
    artifact = json.loads(out.read_text(encoding="utf-8"))
    assert gate.is_thresholds_file(artifact)
    assert artifact["signed"] is True
    assert artifact["corpus_fingerprint"] == CORPUS
    assert artifact["assessment_set_sha256"] == SET_SHA
    assert artifact["reference_manifest_sha256"] == manifest_digest(reference)
    assert set(artifact["thresholds"]) == set(thresholds_mod.MEASURED_DIMENSIONS)
    assert artifact["thresholds"]["M-1"]["value"] == 0.5
    assert artifact["sign_off"]["owner"] == OWNER


def test_the_derived_artifact_satisfies_the_partial_order_gate(tmp_path):
    """The derived artifact is what the gate finds: the gate verifies the
    lineage the artifact carries."""
    registry = _registry()
    path = _write_registry(tmp_path, registry)
    reference = _reference_manifest()
    reference_path = _write_reference(tmp_path, reference)
    out = tmp_path / "thresholds.json"
    assert (
        cmd_thresholds(
            _args(path, reference_manifest=str(reference_path), out=str(out))
        )
        == 0
    )
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "reference.manifest.json").write_text(json.dumps(reference), encoding="utf-8")
    (run_dir / "thresholds.json").write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
    lineage = gate.check_gated_run(
        run_dir=run_dir,
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        config="B",
    )
    assert lineage["reference_manifest_sha256"] == manifest_digest(reference)


def test_the_derivation_refuses_a_blocked_registry():
    registry = _registry(signed=False)
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.derive_thresholds_artifact(
            registry, reference_manifest=_reference_manifest()
        )
    assert failed.value.reason == "promotion_blocked"


def test_the_derivation_refuses_a_reference_without_a_lineage():
    registry = _registry()
    with pytest.raises(thresholds_mod.ThresholdsRefusal) as failed:
        thresholds_mod.derive_thresholds_artifact(registry, reference_manifest={})
    assert failed.value.reason == "missing_reference"


# ---------------------------------------------------------------------------
# The CLI
# ---------------------------------------------------------------------------


def test_the_cli_exits_1_on_the_shipped_registry(tmp_path, capsys):
    assert main(["thresholds", "--registry", str(REGISTRY)]) == 1
    printed = capsys.readouterr()
    assert "BLOCKED" in printed.out
    assert "M-1" in printed.out
    assert OWNER in printed.out


def test_the_cli_exits_1_on_a_malformed_registry(tmp_path, capsys):
    path = tmp_path / "broken.yaml"
    path.write_text("dimensions: [unclosed\n", encoding="utf-8")
    assert main(["thresholds", "--registry", str(path)]) == 1
    assert "REFUSED" in capsys.readouterr().err


def test_the_cli_exits_0_on_a_complete_registry(tmp_path, capsys):
    path = _write_registry(tmp_path, _registry())
    reference_path = _write_reference(tmp_path, _reference_manifest())
    out = tmp_path / "thresholds.json"
    assert (
        main(
            [
                "thresholds",
                "--registry",
                str(path),
                "--reference-manifest",
                str(reference_path),
                "--out",
                str(out),
            ]
        )
        == 0
    )
    assert out.exists()
    assert "ALLOWED" in capsys.readouterr().out


def test_the_cli_exits_2_on_a_missing_reference_manifest(tmp_path, capsys):
    """A missing required argument is a usage error (2), not a refusal (1)."""
    path = _write_registry(tmp_path, _registry())
    out = tmp_path / "thresholds.json"
    assert main(["thresholds", "--registry", str(path), "--out", str(out)]) == 2
    assert "usage" in capsys.readouterr().err
    assert not out.exists()
