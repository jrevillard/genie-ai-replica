# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

OVERLAY_ROOT = Path(__file__).resolve().parent.parent
LINT_SCRIPT = OVERLAY_ROOT / "build-patches" / "lint_overrides.py"


def _load_lint():
    """Load lint_overrides.py as a module so tests can point MANIFEST at a tmp file."""
    spec = importlib.util.spec_from_file_location("lint_overrides", LINT_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def lint(tmp_path):
    """Fresh lint module with MANIFEST redirected to a temp file."""
    mod = _load_lint()
    mod.MANIFEST = tmp_path / "OVERRIDES.yaml"
    return mod


def test_manifest_lints_clean():
    """The OVERRIDES.yaml override-audit manifest must lint clean."""
    if not LINT_SCRIPT.exists():
        pytest.fail("build-patches/lint_overrides.py not present — override-audit lint must be enforced")
    result = subprocess.run(
        [sys.executable, str(LINT_SCRIPT)],
        capture_output=True,
        text=True,
        cwd=str(OVERLAY_ROOT),
    )
    assert result.returncode == 0, f"lint_overrides failed:\n{result.stdout}\n{result.stderr}"


@pytest.mark.parametrize(
    "manifest_text",
    [
        # invalid disposition
        "overrides:\n- override: a.b\n  disposition: bogus\n  owner: x\n  ticket: t\n",
        # entry with no matching source marker
        "overrides:\n- override: a.b\n  disposition: still-needed\n  owner: x\n  ticket: t\n",
        # duplicate override id across entries
        "overrides:\n"
        "- override: a.b\n  disposition: still-needed\n  owner: x\n  ticket: t\n"
        "- override: a.b\n  disposition: still-needed\n  owner: x\n  ticket: t\n",
        # duplicate key within a single entry
        "overrides:\n- override: a.b\n  disposition: still-needed\n  owner: x\n  owner: y\n  ticket: t\n",
        # missing required key
        "overrides:\n- override: a.b\n  disposition: still-needed\n  owner: x\n",
        # unparsed line
        "overrides:\n  broken line\n",
        # empty manifest
        "overrides:\n",
    ],
)
def test_manifest_violations_exit_nonzero(lint, manifest_text):
    """A malformed or unrecorded manifest must fail the lint (exit != 0)."""
    lint.MANIFEST.write_text(manifest_text, encoding="utf-8")
    assert lint.validate() != 0


def test_marker_disposition_disagreement(lint, monkeypatch):
    """A manifest entry whose disposition disagrees with its source marker must fail."""
    monkeypatch.setattr(lint, "scan_markers", lambda: {"a.b": {"still-needed"}})
    lint.MANIFEST.write_text(
        "overrides:\n- override: a.b\n  disposition: re-graft-to-new-API\n  owner: x\n  ticket: t\n",
        encoding="utf-8",
    )
    assert lint.validate() != 0


def test_orphan_marker_fails_lint(lint, monkeypatch):
    """A source marker with no manifest entry must fail the lint (reverse-direction check)."""
    # scan_markers returns two markers; manifest only has one → orphan must fail.
    monkeypatch.setattr(
        lint,
        "scan_markers",
        lambda: {"a.b": {"still-needed"}, "orphan.x": {"still-needed"}},
    )
    lint.MANIFEST.write_text(
        "overrides:\n- override: a.b\n  disposition: still-needed\n  owner: x\n  ticket: t\n",
        encoding="utf-8",
    )
    assert lint.validate() != 0


def test_module_layer_marker_is_scanned(lint, tmp_path, monkeypatch):
    """Markers in reranker/*.py and contracts/*.py must be included in the scan."""
    # Create a mini overlay tree with a marker in contracts/
    overlay = tmp_path / "overlay"
    contracts_dir = overlay / "contracts"
    contracts_dir.mkdir(parents=True)
    (contracts_dir / "_harness.py").write_text(
        "# OVERRIDE contracts._harness.import_docarray | disposition: re-graft-to-new-API\n",
        encoding="utf-8",
    )
    # Point the lint module at the temp overlay
    monkeypatch.setattr(lint, "OVERLAY_ROOT", overlay)
    markers = lint.scan_markers()
    assert "contracts._harness.import_docarray" in markers
    assert "re-graft-to-new-API" in markers["contracts._harness.import_docarray"]
