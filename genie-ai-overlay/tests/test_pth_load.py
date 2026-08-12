# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Verify that the site-init hook modules import cleanly in a fresh interpreter.

Mirrors what ``build-patches/install_site_startup.sh`` does as its build-time
verification (lines 64-67): ``python3 -c 'import genie_ssl_patch'`` and
``python3 -c 'import docarray_alias_shim'``. The hooks are installed via the
``zz_genie_startup.pth`` site-init mechanism, but Python's ``site.addsitedir``
swallows import errors (prints to stderr, exit 0) — so the build-time guard
verifies each hook with a direct import that propagates failures to exit code.

This test does the same: copy each hook into a temp dir, put it on ``sys.path``
in a subprocess, and import it. A hook that raises at import time (syntax error,
missing dependency, broken patch) must fail this test.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

OVERLAY_ROOT = Path(__file__).resolve().parent.parent
HOOK_SOURCES: list[tuple[str, Path]] = [
    ("docarray_alias_shim", OVERLAY_ROOT / "build-patches" / "docarray_alias_shim.py"),
    # genie_ssl_patch.py lives in configs/ssl/ and is copied into build-patches/
    # by the Dockerfile at image build time. The dev-env source of truth is
    # configs/ssl/; fall back to build-patches/ if it was already copied there.
    ("genie_ssl_patch", OVERLAY_ROOT.parent / "configs" / "ssl" / "genie_ssl_patch.py"),
]

# Hooks whose import requires an optional runtime dependency. The authoritative
# check runs inside the Docker image (install_site_startup.sh build guard) where
# all deps are present. In dev environments without the dep, skip gracefully —
# the hook's code is still syntax-checked by ruff, and the broken-hook test
# below still verifies the failure-propagation contract.
_HOOK_DEPS: dict[str, str] = {
    "docarray_alias_shim": "docarray",
}


def _build_hook_dir(tmp_path: Path, hooks: list[tuple[str, Path]], broken: dict[str, str] | None = None) -> Path:
    """Write hook modules into *tmp_path*, return the dir.

    ``broken`` maps hook name → replacement source text (e.g. a syntax error)
    to simulate a broken hook without touching the real source files.
    """
    broken = broken or {}
    for name, src in hooks:
        if name in broken:
            (tmp_path / f"{name}.py").write_text(broken[name], encoding="utf-8")
        elif src.is_file():
            shutil.copy2(src, tmp_path / f"{name}.py")
        else:
            pytest.skip(f"hook source not found: {src}")
    return tmp_path


def _run_hook_import(hook_dir: Path, hook_name: str) -> subprocess.CompletedProcess:
    """Spawn a clean interpreter that imports *hook_name* with *hook_dir* on path."""
    code = f"import sys; sys.path.insert(0, {str(hook_dir)!r}); import {hook_name}"
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=30,
    )


@pytest.mark.parametrize("hook_name", [name for name, _ in HOOK_SOURCES])
def test_hook_imports_cleanly(tmp_path, hook_name):
    """Each hook module must import without error in a fresh interpreter."""
    # Skip hooks whose runtime deps aren't installed in the dev environment.
    dep = _HOOK_DEPS.get(hook_name)
    if dep:
        result = subprocess.run(
            [sys.executable, "-c", f"import {dep}"],
            capture_output=True,
            timeout=10,
        )
        if result.returncode != 0:
            pytest.skip(f"hook {hook_name!r} requires {dep!r} (not installed in dev env; Docker build guard covers it)")
    hook_dir = _build_hook_dir(tmp_path, HOOK_SOURCES)
    result = _run_hook_import(hook_dir, hook_name)
    assert result.returncode == 0, (
        f"hook {hook_name!r} import failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )


def test_broken_hook_fails_import(tmp_path):
    """A hook with a syntax error must cause the import to fail (non-zero exit)."""
    hook_dir = _build_hook_dir(
        tmp_path,
        HOOK_SOURCES,
        broken={"docarray_alias_shim": "def broken(\n"},  # syntax error
    )
    result = _run_hook_import(hook_dir, "docarray_alias_shim")
    assert result.returncode != 0, "hook with syntax error should have failed the import, but exit was 0"
