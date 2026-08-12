# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# OVERRIDE build-patches.docarray_alias_shim | disposition: re-graft-to-new-API | reason: sys.modules pin replaces the vendored rename hack | test: contracts/_harness.py::import_docarray  # noqa: E501

"""docarray_alias_shim.py — stop the vendored ``comps/cores/proto/docarray.py``
from shadowing the real ``docarray`` PyPI package.

The retriever, reranker and dataprep images put ``*/comps/cores/proto`` on
``PYTHONPATH`` so that ``from api_protocol import *`` resolves. That directory
contains a vendored ``docarray.py`` shim whose own ``from docarray import BaseDoc``
self-imports (the vendored module shadows the real package because PYTHONPATH
precedes site-packages).

This module is imported via ``zz_genie_startup.pth`` during site initialization,
before the service main script runs. It temporarily removes any ``*/cores/proto``
entry from ``sys.path``, imports the real ``docarray`` package, pins it in
``sys.modules``, then restores the path. Every later ``from docarray import ...``
finds the pinned real module — no vendored file is mutated.
"""

import sys

_PROTO_SUFFIX = "/cores/proto"

# Temporarily remove any ``*/cores/proto`` entry so the real ``docarray``
# package (site-packages) resolves instead of the vendored shim, then restore
# the exact original sys.path ordering afterwards (position preservation keeps
# every other module's resolution unchanged — survives any vendor layout).
_original_path = list(sys.path)
sys.path[:] = [entry for entry in _original_path if not entry.rstrip("/").endswith(_PROTO_SUFFIX)]
try:
    import docarray  # noqa: F401

    # Defensive guard: if the pin failed and the vendored ``cores/proto`` shim is
    # still shadowing the real package, fail loudly at site-init instead of
    # silently persisting the collision for the whole process. Explicit check,
    # not an ``assert``: ``assert`` is stripped under ``python -O``, and the
    # fail-loudly guarantee must hold regardless of interpreter flags.
    if "cores/proto" in (getattr(docarray, "__file__", "") or ""):
        raise RuntimeError("docarray shim: imported module still resolves under comps/cores/proto — pin failed")
finally:
    sys.path[:] = _original_path
