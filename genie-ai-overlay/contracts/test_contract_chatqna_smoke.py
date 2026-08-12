# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""ChatQnA in-image contract — v1.3-on-3.11 import + symbol shape.

Covers DW-28 (chatqna v1.3-on-3.11 import not verified). The chatqna
Dockerfile pins ``OPEA_VERSION="v1.3"`` on a ``python:3.11-slim`` base —
a v1.3 symbol rename or a 3.11-incompatible dependency would surface only
at service startup, after the image has already shipped.

This test imports ``ChatQnA.genieai_chatqna`` (the module the Dockerfile
COPYs to ``/app/ChatQnA/genieai_chatqna.py``) and verifies the v1.3 comps
symbols it depends on (``ServiceType``, ``MicroService``,
``ServiceOrchestrator``) are importable and have expected attributes.
Import-only — does NOT start the uvicorn server.
"""

from __future__ import annotations

import importlib
import sys

import _harness


def test_chatqna_module_importable():
    """The ``ChatQnA.genieai_chatqna`` module imports cleanly inside the image.

    The Dockerfile COPYs the GENIE overlay module to
    ``/app/ChatQnA/genieai_chatqna.py``. A top-level import error (missing
    system lib, v1.3 symbol rename, 3.11 incompatibility) surfaces here
    before the service starts.
    """
    _harness.require_real_comps()
    # The chatqna Dockerfile sets WORKDIR /app and COPYs the module to
    # /app/ChatQnA/genieai_chatqna.py. The /app dir is on PYTHONPATH in
    # the image. Import as a dotted path to exercise the package layout.
    try:
        mod = importlib.import_module("ChatQnA.genieai_chatqna")
    except Exception as exc:
        raise AssertionError(
            "ChatQnA.genieai_chatqna not importable — the canonical path "
            "(/app/ChatQnA/genieai_chatqna.py via PYTHONPATH=/app) failed. "
            f"Exception: {type(exc).__name__}: {exc}. "
            f"sys.path sample: {sys.path[:5]}"
        ) from exc
    assert mod is not None


def test_v13_comps_symbols_present():
    """The v1.3 comps symbols chatqna depends on are importable and shaped correctly.

    ``genieai_chatqna.py:33`` imports ``ServiceType``, ``MicroService``,
    ``ServiceOrchestrator``, ``ServiceRoleType``, ``MegaServiceEndpoint``
    from ``comps``. A v1.3 → v1.5 bump that renames any of these would
    break the chatqna module — this test catches it at contract time.
    """
    comps = _harness.require_real_comps()

    # ServiceType — enum-like, must have chat/reranker/retriever values
    assert hasattr(comps, "ServiceType"), "comps.ServiceType missing"
    st = comps.ServiceType
    for attr in ("EMBEDDING", "RETRIEVER", "RERANK", "LLM"):
        assert hasattr(st, attr), f"ServiceType.{attr} missing (v1.3 symbol)"

    # MicroService — class, constructor takes name/service_type/endpoint
    assert hasattr(comps, "MicroService"), "comps.MicroService missing"
    assert callable(comps.MicroService)

    # ServiceOrchestrator — class, manages the DAG of MicroServices
    assert hasattr(comps, "ServiceOrchestrator"), "comps.ServiceOrchestrator missing"
    assert callable(comps.ServiceOrchestrator)

    # MegaServiceEndpoint — enum for the gateway endpoint paths
    assert hasattr(comps, "MegaServiceEndpoint"), "comps.MegaServiceEndpoint missing"


def test_chatqna_docarray_symbols_importable():
    """The docarray symbols chatqna imports are resolvable under the shim.

    ``genieai_chatqna.py:34`` imports ``LLMParams``, ``RerankerParms``,
    ``RetrieverParms`` from ``comps.cores.proto.docarray``. Under the shim,
    these must resolve to the real docarray-backed classes, not the
    vendored stub.
    """
    _harness.require_real_comps()
    for attr in ("LLMParams", "RerankerParms", "RetrieverParms"):
        cls = _harness.import_docarray(attr)
        assert cls is not None, f"docarray shim: {attr} is None"
