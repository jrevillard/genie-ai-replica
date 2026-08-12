# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import subprocess
import sys
from pathlib import Path

import pytest

OVERLAY_ROOT = Path(__file__).resolve().parent.parent
LINT_SCRIPT = OVERLAY_ROOT / "build-patches" / "lint_overrides.py"


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
