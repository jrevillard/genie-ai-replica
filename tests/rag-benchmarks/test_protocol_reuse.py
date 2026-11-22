# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/reuse.py — capture-artifact suitability checks.

A capture artifact is consumable only when its ``harness_sha``, ``gold_sha256``
and stack identity match the current code and set; every mismatch is named in
the refusal report; there is no override.
"""

import hashlib
import json
from pathlib import Path

from protocol import reuse
from protocol.run_protocol import cmd_check_reuse

HARNESS_SHA = "1b" * 32
GOLD_SHA = "cd" * 32


def _artifact(**overrides):
    artifact = {
        "artifact": "rag-baseline",
        "version": "1.0.0",
        "harness_sha": HARNESS_SHA,
        "stack": {"name": "release-el-salvador", "services": {}},
        "runs": {"gold_dataset": "gold_dataset.json", "gold_sha256": GOLD_SHA},
    }
    artifact.update(overrides)
    return artifact


def _check(artifact, **kw):
    args = dict(harness_sha=HARNESS_SHA, gold_sha256=GOLD_SHA)
    args.update(kw)
    return reuse.check_capture_artifact(artifact, **args)


def test_matching_artifact_is_suitable():
    report = _check(_artifact(), expected_stack="release-el-salvador")
    assert report["suitable"] is True
    assert report["mismatches"] == []


def test_stale_harness_sha_is_named():
    report = _check(_artifact(harness_sha="00" * 32))
    assert report["suitable"] is False
    (mismatch,) = report["mismatches"]
    assert mismatch["field"] == "harness_sha"
    assert mismatch["artifact_value"] == "00" * 32
    assert mismatch["current_value"] == HARNESS_SHA


def test_changed_gold_is_named():
    report = _check(_artifact(runs={"gold_dataset": "gold_dataset.json", "gold_sha256": "11" * 32}))
    (mismatch,) = report["mismatches"]
    assert mismatch["field"] == "runs.gold_sha256"


def test_missing_gold_digest_is_a_mismatch():
    report = _check(_artifact(runs={"gold_dataset": "gold_dataset.json"}))
    assert report["suitable"] is False
    assert report["mismatches"][0]["field"] == "runs.gold_sha256"


def test_missing_harness_identity_is_a_mismatch():
    artifact = _artifact()
    del artifact["harness_sha"]
    report = _check(artifact)
    assert report["mismatches"][0]["field"] == "harness_sha"


def test_stack_mismatch_is_named_when_expected_stack_given():
    report = _check(_artifact(), expected_stack="other-stack")
    (mismatch,) = report["mismatches"]
    assert mismatch["field"] == "stack.name"
    assert mismatch["artifact_value"] == "release-el-salvador"
    assert mismatch["current_value"] == "other-stack"


def test_every_mismatch_is_reported_at_once():
    report = _check(
        _artifact(harness_sha="00" * 32, runs={"gold_dataset": "g", "gold_sha256": "11" * 32}),
        expected_stack="other",
    )
    assert report["suitable"] is False
    assert {m["field"] for m in report["mismatches"]} == {"harness_sha", "runs.gold_sha256", "stack.name"}


def test_current_harness_sha_is_the_capture_machinerys_identity():
    """The live identity comes from capture_baseline.harness_sha — never a
    second implementation that could drift."""
    import capture_baseline

    assert reuse.current_harness_sha() == capture_baseline.harness_sha()


def test_gold_sha_derived_from_the_artifacts_recorded_path(tmp_path):
    gold = tmp_path / "gold.json"
    gold.write_text('{"entries": []}', encoding="utf-8")
    artifact = _artifact(runs={"gold_dataset": str(gold), "gold_sha256": "11" * 32})
    report = reuse.check_capture_artifact(artifact, harness_sha=HARNESS_SHA)
    (mismatch,) = report["mismatches"]
    # The derived current value is the file's REAL digest, computed here
    # independently of the reuse helper (a helper-side hash bug cannot
    # self-confirm).
    assert mismatch["current_value"] == hashlib.sha256(gold.read_bytes()).hexdigest()


def test_missing_recorded_gold_is_a_mismatch_row_not_a_crash(tmp_path):
    """The artifact names a gold path that does not exist HERE (e.g. a
    swarm-node path): the report names the path problem as a mismatch — no
    FileNotFoundError, no silent pass."""
    artifact = _artifact(runs={"gold_dataset": str(tmp_path / "nope.json"), "gold_sha256": "11" * 32})
    report = reuse.check_capture_artifact(artifact, harness_sha=HARNESS_SHA)
    assert report["suitable"] is False
    (mismatch,) = report["mismatches"]
    assert mismatch["field"] == "runs.gold_sha256"
    assert mismatch["artifact_value"] == "11" * 32
    assert mismatch["current_value"] is None
    assert "missing or unreadable" in mismatch["note"]
    assert "nope.json" in mismatch["note"]


# --- CLI: check-reuse -------------------------------------------------------


def _write_artifact(tmp_path: Path, artifact: dict) -> Path:
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(artifact), encoding="utf-8")
    return path


def _write_gold(tmp_path: Path) -> Path:
    gold = tmp_path / "gold.json"
    gold.write_text('{"entries": []}', encoding="utf-8")
    return gold


def _cli_args(artifact_path, **kw):
    args = dict(artifact=str(artifact_path), gold=None, harness_sha=None, stack=None)
    args.update(kw)
    return type("Args", (), args)


def test_cli_check_reuse_zero_on_match(tmp_path):
    gold = _write_gold(tmp_path)
    from protocol.manifest import sha256_file

    path = _write_artifact(tmp_path, _artifact(runs={"gold_dataset": "gold.json", "gold_sha256": sha256_file(gold)}))
    rc = cmd_check_reuse(_cli_args(path, harness_sha=HARNESS_SHA, gold=str(gold)))
    assert rc == 0


def test_cli_check_reuse_nonzero_on_mismatch_and_names_fields(tmp_path, capsys):
    gold = _write_gold(tmp_path)
    path = _write_artifact(tmp_path, _artifact(harness_sha="00" * 32))
    rc = cmd_check_reuse(_cli_args(path, harness_sha=HARNESS_SHA, gold=str(gold), stack="s"))
    assert rc == 1
    out = capsys.readouterr()
    assert "harness_sha" in out.out
    assert "REFUSED" in out.err


def test_cli_check_reuse_without_explicit_digests_uses_the_live_harness_sha(tmp_path, capsys):
    """No --harness-sha flag: the CLI computes the live identity and the
    artifact recorded under it verifies."""
    from protocol.manifest import sha256_file

    gold = _write_gold(tmp_path)
    artifact = _artifact(harness_sha=reuse.current_harness_sha())
    artifact["runs"] = {"gold_dataset": str(gold), "gold_sha256": sha256_file(gold)}
    path = _write_artifact(tmp_path, artifact)
    rc = cmd_check_reuse(_cli_args(path, gold=str(gold)))
    assert rc == 0
    assert "SUITABLE" in capsys.readouterr().out


def test_cli_check_reuse_survives_a_missing_recorded_gold(tmp_path, capsys):
    """check-reuse with NO --gold against an artifact whose recorded gold path
    does not exist: the mismatch report is printed and the CLI exits nonzero —
    no crash."""
    artifact = _artifact(runs={"gold_dataset": str(tmp_path / "nope.json"), "gold_sha256": "11" * 32})
    path = _write_artifact(tmp_path, artifact)
    rc = cmd_check_reuse(_cli_args(path))
    assert rc == 1
    out = capsys.readouterr()
    assert "missing or unreadable" in out.out
    assert "REFUSED" in out.err
