# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Site-startup .pth auto-load contract — proves the .pth mechanism works.

Covers DW-12 (site-startup .pth hooks not verified at runtime). The
``install_site_startup.sh`` script writes a ``zz_genie_startup.pth`` into
the interpreter's site-packages with ``import`` lines that Python executes
during site initialization — BEFORE the service main script runs. A .pth
that fails to parse, a hook that raises on import, or a Dockerfile that
skips the install step would ship silently green without this gate.

This test runs in every module image that uses ``install_site_startup.sh``
(reranker, retriever, dataprep, chatqna, embedding, textgen). It has NO
dependency on real ``comps`` — it works in thin wrappers (embedding/
textgen) too.

Mechanism
---------
1. Locate ``zz_genie_startup.pth`` via ``site.getsitepackages()[0]`` (never
   hardcode site-packages paths — the script derives them the same way).
2. Parse the ``import`` lines from the .pth file.
3. Assert each named module is already present in ``sys.modules`` — proving
   the .pth auto-loaded them at site-init, not that a later manual import
   happened to succeed.
"""

from __future__ import annotations

import site
import sys
from pathlib import Path

import pytest


def _find_pth() -> Path:
    """Locate the zz_genie_startup.pth file in the interpreter's site-packages.

    Uses ``site.getsitepackages()`` (same derivation as
    ``install_site_startup.sh``) — never hardcodes
    ``/usr/local/lib/python3.11/...``. Returns the path or raises
    pytest.skip with a documented reason when the .pth is absent (image
    does not use the site-startup mechanism).
    """
    site_pkgs = site.getsitepackages()
    if not site_pkgs:
        pytest.skip("site.getsitepackages() returned empty list — cannot locate .pth")
    base = Path(site_pkgs[0])
    pth = base / "zz_genie_startup.pth"
    if not pth.is_file():
        pytest.skip(
            f"zz_genie_startup.pth not found at {pth} — this image does not "
            "use install_site_startup.sh (no site-startup hooks to verify)"
        )
    return pth


def _parse_pth_imports(pth: Path) -> list[str]:
    """Parse ``import <module>`` / ``from <module> import ...`` lines from a .pth file.

    Python's .pth mechanism executes any line starting with ``import `` or
    ``from `` as a Python statement at site-init. Other lines (e.g. path
    additions) are added to sys.path. We only care about the import lines —
    those are the hooks that must have auto-loaded.
    """
    modules: list[str] = []
    for raw in pth.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("import "):
            # `import foo` → "foo"; `import foo, bar` → ["foo", "bar"]
            parts = line[len("import ") :].split(",")
            modules.extend(p.strip() for p in parts if p.strip())
        elif line.startswith("from "):
            # `from foo import bar` → "foo" (the module name is what lands in sys.modules)
            rest = line[len("from ") :]
            mod_name = rest.split(" ", 1)[0].strip()
            if mod_name:
                modules.append(mod_name)
    return modules


def test_pth_file_exists_and_nonempty():
    """The .pth file must be present and non-empty in site-packages.

    An empty .pth is silently ignored by Python's site module — the hooks
    would not run, and the service would start without the SSL patch /
    docarray shim.
    """
    pth = _find_pth()
    assert pth.stat().st_size > 0, f"{pth} is empty — Python site-init will ignore it"


def test_pth_imports_are_loaded_in_sys_modules():
    """Every ``import`` line in the .pth must have auto-loaded into sys.modules.

    This is the core gate: the .pth mechanism is the contract, not a
    separate sitecustomize.py overwrite. If a module named in the .pth is
    NOT in sys.modules at test time, the .pth either did not run, the
    import raised (and was swallowed), or the Dockerfile skipped the
    install step.
    """
    pth = _find_pth()
    modules = _parse_pth_imports(pth)
    assert modules, f"{pth} contains no 'import' lines — no hooks to verify"

    missing = [m for m in modules if m not in sys.modules]
    assert not missing, (
        f"site-startup .pth lists {modules!r} but {missing!r} not in sys.modules "
        f"— the .pth did not auto-load them at site-init (pth at {pth}). "
        "Note: Python's site module catches and prints .pth import exceptions "
        "to stderr WITHOUT propagating them — a missing module could mean the "
        "import raised and site swallowed the exception. Check container stderr "
        "for traceback output from site-init."
    )


def test_genie_ssl_patch_is_loaded():
    """``genie_ssl_patch`` must be in sys.modules — the SSL patch is non-optional.

    Every module image that uses ``install_site_startup.sh`` installs at
    least ``genie_ssl_patch.py``. If this module is not auto-loaded, the
    service runs without the SSL context patch — a silent regression.
    """
    _find_pth()  # skip early if no .pth in this image
    assert "genie_ssl_patch" in sys.modules, (
        "genie_ssl_patch not in sys.modules — the .pth did not auto-load the SSL patch hook at site-init"
    )


def test_docarray_alias_shim_loaded_when_present():
    """``docarray_alias_shim`` must be in sys.modules when the .pth lists it.

    The shim is installed only when ``docarray_alias_shim.py`` is present
    alongside ``install_site_startup.sh`` at build time (reranker,
    retriever, dataprep, chatqna — NOT embedding/textgen thin wrappers).
    When the .pth lists it, it MUST be loaded; when the .pth does not list
    it, this test is a no-op.
    """
    pth = _find_pth()
    modules = _parse_pth_imports(pth)
    if "docarray_alias_shim" not in modules:
        pytest.skip("docarray_alias_shim not in .pth — this image does not install the shim")
    assert "docarray_alias_shim" in sys.modules, (
        "docarray_alias_shim listed in .pth but not in sys.modules — the shim did not auto-load at site-init"
    )
