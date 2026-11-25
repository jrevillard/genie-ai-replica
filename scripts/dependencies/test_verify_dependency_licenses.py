#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for the offline licence gate (verify()).

The gate's contract is a set of typed FAIL branches: every way the evidence
can disagree with the pinned tree is reported by name, never as a bare
"something is wrong". Each test drives verify() over a temp evidence file
that trips exactly one branch and asserts the gate's own words for it, so a
branch that stops reporting (or reports the wrong reason) is a red test and
not a silently weaker audit.
"""

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).with_name("verify-dependency-licenses.py")


def _load_script():
    # The script's file name carries a hyphen and is not importable by name.
    spec = importlib.util.spec_from_file_location("verify_dependency_licenses", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verify_module = _load_script()


def _row(name="httpx", version="0.28.1", **overrides):
    """One evidence row that passes every branch of the gate."""
    row = {
        "name": name,
        "version": version,
        "license": "MIT",
        "license_source": "pypi:license_expression (https://pypi.org/pypi/httpx/0.28.1/json)",
        "verified": True,
        "status": "stable",
        "risk_acceptance": None,
        "defaults": {"telemetry": "none", "cloud_export": "none"},
    }
    row.update(overrides)
    return row


def _requirements(tmp_path, pins=(("httpx", "0.28.1"),)):
    path = tmp_path / "requirements.txt"
    path.write_text("".join(f"{name}=={version}\n" for name, version in pins), encoding="utf-8")
    return path


def _evidence(tmp_path, packages):
    path = tmp_path / "evidence.json"
    path.write_text(json.dumps({"packages": packages}), encoding="utf-8")
    return path


def _run_gate(requirements, evidence, capsys):
    """Run verify() once and return (exit code, FAIL lines, full output)."""
    code = verify_module.verify([str(requirements)], str(evidence))
    out = capsys.readouterr().out
    problems = [line[len("FAIL ") :] for line in out.splitlines() if line.startswith("FAIL ")]
    return code, problems, out


def test_the_gate_passes_on_a_complete_evidence_file(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1")])

    code, problems, out = _run_gate(requirements, evidence, capsys)
    assert code == 0
    assert problems == []
    assert "OK 1 pinned package(s): licence verified, defaults audit recorded." in out


# A row that cannot be matched to a pin is skipped, not crashed on: the gate
# names its position in the evidence file so the broken row is findable.
UNNAMED_ROWS = [
    {"version": "9.9.9"},
    {"name": 42, "version": "9.9.9"},
    {"name": "   ", "version": "9.9.9"},
]


@pytest.mark.parametrize("unnamed", UNNAMED_ROWS, ids=["no-name-key", "non-string-name", "blank-name"])
def test_a_row_without_a_usable_name_is_reported_by_its_position(tmp_path, capsys, unnamed):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1"), unnamed])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    expected = (
        "packages[1]: an evidence row carries no usable 'name' - the row "
        f"cannot be matched against any pin ({json.dumps(unnamed)[:80]})"
    )
    assert problems == [expected]


def test_a_duplicate_evidence_row_is_reported(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1"), _row("httpx", "0.28.1")])

    code, problems, out = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == ["httpx: a duplicate evidence row - the last one read wins"]
    assert "1 problem(s): the pre-adoption checklist is NOT satisfied." in out


def test_a_pin_without_an_evidence_row_is_reported(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == ["httpx==0.28.1: no evidence row - the pin was added without an audit"]


def test_a_version_the_evidence_does_not_audit_is_reported(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.27.0")])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == ["httpx: the evidence audits 0.27.0 but the tree pins 0.28.1"]


@pytest.mark.parametrize("licence", ["NOASSERTION", ""], ids=["noassertion", "empty"])
def test_an_unverified_licence_blocks(tmp_path, capsys, licence):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1", license=licence)])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == [f"httpx==0.28.1: licence is '{licence or 'empty'}' - unverified, it blocks"]


def test_a_licence_without_a_recorded_source_is_reported(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1", license_source="")])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == ["httpx==0.28.1: no licence source recorded"]


def test_a_defaults_audit_gap_is_reported_per_field(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1", defaults={})])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == [
        "httpx==0.28.1: the defaults audit has no 'telemetry' verdict",
        "httpx==0.28.1: the defaults audit has no 'cloud_export' verdict",
    ]


def test_a_row_without_a_release_channel_is_reported(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1", status="")])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == ["httpx==0.28.1: the release channel ('status') is not recorded"]


def test_a_non_stable_release_without_a_risk_acceptance_is_reported(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1", status="beta")])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == [
        "httpx==0.28.1: 'beta' is not a stable release - it needs an explicit operational-risk acceptance"
    ]


def test_a_non_stable_release_with_a_risk_acceptance_passes(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1", status="beta", risk_acceptance="accepted: reviewed")])

    code, problems, out = _run_gate(requirements, evidence, capsys)
    assert code == 0
    assert problems == []
    assert "FAIL" not in out


def test_a_row_for_a_package_the_tree_no_longer_pins_is_reported(tmp_path, capsys):
    requirements = _requirements(tmp_path)
    evidence = _evidence(tmp_path, [_row("httpx", "0.28.1"), _row("requests", "2.0.0")])

    code, problems, _ = _run_gate(requirements, evidence, capsys)
    assert code == 1
    assert problems == ["requests: an evidence row for a package the tree no longer pins"]
