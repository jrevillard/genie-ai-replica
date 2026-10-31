# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Contract test — the module Python imports IS the patched orchestrator copy.

The off-loop patch (``build-patches/comps_llm_stream_offloop_patch.py``)
rewrites ``/home/user/comps/cores/mega/orchestrator.py`` at image build and
that path's primacy rests on one assumption: that ``import comps`` at runtime
resolves to the patched copy (PYTHONPATH puts ``/home/user`` ahead of the
editable-install path). The patcher's own post-write re-read verifies the file
IT wrote, not the module Python actually imports — if the layering ever shifts
(a ``pip install`` re-materializing the package, a base-image reorganization),
the image builds green and serves queries from the UNPATCHED copy, with the
event loop pinned exactly as before.

This test closes that layer: it imports the real module the way the service
does and asserts the patch is in the SOURCE PYTHON LOADS — parsed, so even a
docstring containing the helper's text cannot satisfy it. The patch-shape
constants come from the patcher module itself (kept in the image at
``/app/build-patches/``), so there is one definition of the shape. It follows
the sibling precedent (``test_contract_http_budget.py``: importlib +
getsource against the real vendored comps). In the dev venv there is no
vendored comps, so the ``comps`` fixture skips — the assertion is real only in
the in-image contract lane (``contract:chatqna-server``), which is the venue
that matters.
"""

import ast
import importlib.util
import inspect
from pathlib import Path

PATCHER_PATH = Path("/app/build-patches/comps_llm_stream_offloop_patch.py")


def _load_patcher():
    """The patcher module from the image's stable /app path, or skip.

    Only the chatqna image ships it — the contracts/ README's other in-image
    venues (retriever, dataprep) carry real comps but not this file, and the
    suite must skip there, not die on FileNotFoundError.
    """
    import pytest

    if not PATCHER_PATH.is_file():
        pytest.skip("the off-loop patcher is not in this image (chatqna-only)")
    spec = importlib.util.spec_from_file_location("comps_llm_stream_offloop_patch", PATCHER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_imported_orchestrator_is_the_patched_copy(comps):
    """The patch lives in the source Python loads, not just in the file on disk."""
    patcher = _load_patcher()
    module = importlib.import_module("comps.cores.mega.orchestrator")
    source = inspect.getsource(module)
    tree = ast.parse(source)

    live_helper = any(isinstance(node, ast.AsyncFunctionDef) and node.name == "_llm_post_offloop" for node in tree.body)
    assert live_helper, (
        "the orchestrator module Python imports carries no live _llm_post_offloop helper — the "
        "build-time patch either did not run or patched a copy Python does not import; the "
        "streaming LLM POST is back on the event loop and /health will stop answering during queries"
    )
    assert source.count(patcher.WRAPPED_SITE) == 2, (
        "expected exactly 2 wrapped streaming call sites in the imported orchestrator"
    )
    line_shaped_unpatched = any(line.lstrip(" \t").startswith(patcher.UNPATCHED_SITE) for line in source.split("\n"))
    assert not line_shaped_unpatched, (
        "a streaming call site is still calling requests.post directly in the imported module — "
        "the event loop would stay pinned for the duration of the LLM first-headers wait"
    )
    assert source.count("res = requests.post(") == 2, (
        "the two sync generator call sites must stay untouched — they already run off-loop in "
        "StreamingResponse's threadpool and cannot await"
    )
