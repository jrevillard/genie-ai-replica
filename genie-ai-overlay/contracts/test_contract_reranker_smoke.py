# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Reranker in-image contract — shim pin + entry-point importability.

Covers DW-8 (reranker has zero CI jobs that import code inside the built
image) and DW-13 (reranker entry-point import not verified).

The reranker module imports ``comps.cores.proto.docarray`` under the shim
pin (:func:`_harness.import_docarray`). This test asserts the shim holds
(``real docarray is not the vendored stub``) and that the entry-point
module path the Dockerfile CMD targets (``comps.rerankings.src.
integrations.genieai_tei_reranker``) is importable — a shim failure or a
vendored path rename would ship silently green without this gate.
"""

from __future__ import annotations

import importlib

import _harness


def test_reranker_docarray_shim_holds():
    """The reranker's ``comps.cores.proto.docarray`` import resolves under the shim.

    ``import_docarray`` asserts the real ``docarray`` package is pinned in
    ``sys.modules`` and is distinct from the vendored stub — a bare image
    without the shim fails here with a documented message, not a raw
    ImportError.
    """
    _harness.require_real_comps()
    # The reranker imports these symbols from comps.cores.proto.docarray
    # (genieai_reranking_microservice.py:38). If the shim is not in effect,
    # import_docarray fails the test with a documented message.
    for attr in ("LLMParamsDoc", "RerankedDoc", "SearchedDoc", "SearchedMultimodalDoc"):
        cls = _harness.import_docarray(attr)
        assert cls is not None, f"docarray shim: {attr} is None"


def test_reranker_entrypoint_importable():
    """The GENIE TEI reranker integration module is importable inside the image.

    The Dockerfile CMD targets ``comps/rerankings/src/
    opea_reranking_microservice.py``, which imports
    ``comps.rerankings.src.integrations.genieai_tei_reranker``. A rename or
    missing file in the vendored tree would surface as an ImportError at
    service startup — this test catches it at contract time.
    """
    _harness.require_real_comps()
    mod = importlib.import_module("comps.rerankings.src.integrations.genieai_tei_reranker")
    assert hasattr(mod, "GenieTEIReranking"), "genieai_tei_reranker module missing GenieTEIReranking class"


def test_reranker_microservice_module_importable():
    """The top-level reranker microservice module is importable (import-only, no bind).

    Catches top-level import errors (missing system libs, comps symbol
    renames) without starting the uvicorn server. The module registers the
    microservice on import, but does not bind a port.
    """
    _harness.require_real_comps()
    mod = importlib.import_module("comps.rerankings.src.opea_reranking_microservice")
    assert mod is not None
