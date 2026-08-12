# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for ``build-patches/docarray_alias_shim.py``.

The shim runs at site-init (via ``zz_genie_startup.pth``) to stop a vendored
``comps/cores/proto/docarray.py`` from shadowing the real ``docarray`` PyPI
package. It temporarily removes any ``*/cores/proto`` entry from ``sys.path``,
imports the real package, pins it in ``sys.modules``, then restores the path.

This test reproduces that layout in a temp dir and executes the shim's module
code in a fresh subprocess, so the test process's ``sys.modules`` is never
polluted. The real ``docarray`` package is deliberately NOT required: a small
stand-in package on a non-proto path plays the role of the site-packages
install, which keeps the test hermetic (docarray is not an overlay test dep).
"""

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

OVERLAY_ROOT = Path(__file__).resolve().parent.parent
SHIM = OVERLAY_ROOT / "build-patches" / "docarray_alias_shim.py"

_REAL_PKG_SOURCE = "BaseDoc = object\n"  # stand-in for the real docarray package


@pytest.fixture
def vendored_layout(tmp_path: Path):
    """Build a simulated image layout.

    Returns a dict with the vendored ``*/comps/cores/proto`` dir (containing a
    ``docarray.py`` that imports from the package of the same name — exactly the
    self-shadowing collision the shim must break) and a stand-in site-packages
    dir containing the "real" ``docarray`` package.
    """
    proto = tmp_path / "comps" / "cores" / "proto"
    proto.mkdir(parents=True)
    (proto / "docarray.py").write_text("from docarray import BaseDoc\n", encoding="utf-8")

    site = tmp_path / "site-packages"
    (site / "docarray").mkdir(parents=True)
    (site / "docarray" / "__init__.py").write_text(_REAL_PKG_SOURCE, encoding="utf-8")
    return {"proto": proto, "site": site}


def _run_shim_in_subprocess(proto: Path, site: Path, cwd: Path) -> subprocess.CompletedProcess:
    """Execute the real shim module code in a fresh interpreter.

    The subprocess reproduces the image layout (vendored proto dir first on
    ``sys.path``), records the original path, runs the shim's module-level code
    exactly as ``zz_genie_startup.pth`` would, then asserts the pin + restore.
    """
    script_path = cwd / "run_shim.py"
    script_path.write_text(
        textwrap.dedent(
            """\
            import importlib
            import importlib.util
            import os
            import sys

            proto, site, shim = sys.argv[1:4]

            # Reproduce the image layout: the vendored proto dir precedes the
            # real package's location, so `docarray` resolves to the stub.
            sys.path[:] = [proto, site]
            original_path = list(sys.path)

            # Execute the shim's module-level logic exactly as zz_genie_startup.pth
            # would on import.
            shim_source = open(shim, encoding="utf-8").read()
            exec(compile(shim_source, shim, "exec"), {})

            # 1. The real package is pinned in sys.modules, not the vendored stub.
            import docarray

            shim_file = getattr(docarray, "__file__", "") or ""
            assert "cores/proto" not in shim_file, f"shim did not pin the real package: {shim_file}"
            assert os.path.realpath(shim_file).startswith(os.path.realpath(site))

            # 2. Import the vendored stub by file path; its `from docarray import
            #    BaseDoc` must resolve to the pinned real package.
            vendored_path = os.path.join(proto, "docarray.py")
            spec = importlib.util.spec_from_file_location("vendored_docarray", vendored_path)
            vendored = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(vendored)
            assert vendored.BaseDoc is docarray.BaseDoc

            # 3. sys.path is restored to its exact original order.
            assert sys.path == original_path, f"sys.path not restored: {sys.path!r} != {original_path!r}"

            print("SHIM OK")
            """
        ),
        encoding="utf-8",
    )
    return subprocess.run(
        [sys.executable, str(script_path), str(proto), str(site), str(SHIM)],
        capture_output=True,
        text=True,
        cwd=str(cwd),
    )


def test_shim_pins_real_package_and_restores_path(vendored_layout):
    """The shim must pin the real package and restore sys.path exactly."""
    result = _run_shim_in_subprocess(
        proto=vendored_layout["proto"],
        site=vendored_layout["site"],
        cwd=vendored_layout["proto"].parent.parent,
    )
    assert result.returncode == 0, f"shim subprocess failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
    assert "SHIM OK" in result.stdout


def test_shim_self_shadow_without_pin_is_red(vendored_layout):
    """Without the shim, the vendored stub self-imports and BaseDoc is unreachable.

    This proves the shim is load-bearing: on a bare image the vendored stub
    either self-shadows or raises a circular import. Both are the red state the
    shim must eliminate.
    """
    proto = vendored_layout["proto"]
    site = vendored_layout["site"]
    script = textwrap.dedent(
        """\
        import sys

        proto, site = sys.argv[1:3]
        sys.path[:] = [proto, site]

        # Importing `docarray` without the shim resolves to the vendored stub.
        # Its own `from docarray import BaseDoc` either raises a circular-import
        # error (partially-initialized self-import) or self-shadows. Both are
        # the red state the shim must eliminate.
        try:
            import docarray
        except ImportError as exc:
            print("RED:", type(exc).__name__)
        else:
            assert "cores/proto" in (getattr(docarray, "__file__", "") or ""), "expected the vendored stub"
            print("RED: self-shadow")
        """
    )
    script_path = proto.parent.parent / "run_red.py"
    script_path.write_text(script, encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(script_path), str(proto), str(site)],
        capture_output=True,
        text=True,
        cwd=str(proto.parent.parent),
    )
    assert result.returncode == 0, f"red-state subprocess failed:\nstdout: {result.stdout}\nstderr: {result.stderr}"
    assert "RED:" in result.stdout
