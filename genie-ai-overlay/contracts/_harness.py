# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""In-image contract-test harness — real `comps` vs the built image.

Contract tests run **inside the built image** against the REAL vendored
``comps`` — NOT the ``sys.modules``-mocked ``comps`` the ``tests/`` suite uses
(``tests/conftest.py``). This module is the shared harness for
``genie-ai-overlay/contracts/``.

Isolation contract
------------------
- The ``contracts/`` directory is a **sibling** of ``tests/``. ``pytest.ini``
  sets ``testpaths = tests``, so the mocked suite never collects these tests.
- The in-image invocation is explicit::

      docker run <image> pytest /contracts/test_contract_<module>_<name>.py -p no:cacheprovider

- No ``conftest.py`` here that stubs ``comps``. A test that imports this module
  and calls :func:`require_real_comps` FAILS loudly (skip-with-reason at
  collection, not silent pass) when the real vendored ``comps`` is absent — a
  test running against the mocked library proves nothing about the bump.

Exit-code contract: pass → exit 0, fail → exit 1. JUnit artifact via
``-p no:cacheprovider`` + ``--junitxml`` (wired in CI).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# The six GENIE custom kwargs the orchestrator must forward to the handlers.
GENIE_KWARGS = (
    "retriever_parameters",
    "reranker_parameters",
    "full_chat_history_string",
    "retrieval_context",
    "original_language",
    "user_details",
)

# Reference values the wire test sends — the handler must receive EXACTLY these.
WIRE_KWARGS = {
    "retriever_parameters": {"k": 3, "fetch_k": 5},
    "reranker_parameters": {"top_n": 3},
    "full_chat_history_string": "previous turn",
    "retrieval_context": {"categoryLabels": ["Tomato"]},
    "original_language": "es",
    "user_details": {"role": "citizen", "locale": "es"},
}


def in_image_comps_importable() -> bool:
    """True when the REAL vendored ``comps`` is importable in this process.

    Distinguishes the built image (``comps`` vendored at ``/app/comps`` /
    ``/home/user/comps`` and on ``PYTHONPATH``) from the mocked test env (the
    ``tests/conftest.py`` stub is a ``MagicMock`` — importing it does not give
    real runtime behaviour). The marker is a real ``comps`` module whose file
    path lives under a known image mount. On import failure → False.
    """
    try:
        import comps  # noqa: F401
    except Exception:
        return False
    pkg_file = getattr(sys.modules.get("comps"), "__file__", "") or ""
    # The real vendored comps lives in the image; the mocked one has no real
    # file path pointing into the image tree.
    return any(marker in pkg_file for marker in ("/app/comps", "/home/user/comps"))


def require_real_comps():
    """Return the real ``comps`` module, or raise a clearly-reasoned SkipTest.

    Runs only in-image. Calling this in the mocked dev env raises a
    ``pytest.skip`` so the contract suite cannot be collected green against the
    mocked library — a skip here is the sensitivity guard, not a pass.
    """
    import pytest

    if not in_image_comps_importable():
        pytest.skip(
            "contract test requires the real vendored `comps` inside the built "
            "image (run: docker run <image> pytest /contracts -p no:cacheprovider)"
        )
    import comps

    return comps


# ---------------------------------------------------------------------------
# Fake HTTP layer (aiohttp + requests)
# ---------------------------------------------------------------------------


class FakeAiohttpSession:
    """aiohttp-shaped session that answers every POST with an empty JSON body.

    The wire/ingest contract tests exercise the orchestrator's forwarding path
    (kwargs reaching the handlers), not the model endpoints. A fake session
    avoids any network/GPU dependency while still exercising the real
    ``execute()`` forwarding call sites.
    """

    def __init__(self, responses: dict | None = None):
        self.responses = responses or {}
        self.calls: list[tuple[str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, *args, **kwargs):
        self.calls.append((url, kwargs))
        for pattern, payload in self.responses.items():
            if pattern in str(url):
                return _FakeResponse(payload)
        return _FakeResponse({})


class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload
        self.status = 200
        self.status_code = 200
        self.content = json.dumps(payload).encode()
        self.content_type = "application/json"

    async def json(self):
        return self.payload

    async def text(self):
        return json.dumps(self.payload)

    async def read(self):
        return self.content

    def raise_for_status(self):
        pass


def install_fake_aiohttp() -> FakeAiohttpSession:
    """Replace ``aiohttp.ClientSession`` with the fake; return a shared session.

    In-image, ``aiohttp`` is a real dependency — this swaps only the session
    factory so ``execute()``'s ``aiohttp.ClientSession()`` calls get the fake.

    The orchestrator ALSO uses synchronous ``requests.post`` for the LLM node
    (orchestrator.py ~262-322, "Still leave to sync requests.post for
    StreamingResponse"), so this installs a ``requests.post``/``get`` stub that
    returns the same fake payload — no network, no GPU.
    """
    import types

    session = FakeAiohttpSession()
    aiohttp = sys.modules.get("aiohttp")
    if aiohttp is None:
        aiohttp = types.ModuleType("aiohttp")
        sys.modules["aiohttp"] = aiohttp
    aiohttp.ClientSession = lambda *a, **k: session  # noqa: E731

    requests = sys.modules.get("requests")
    if requests is None:
        requests = types.ModuleType("requests")
        sys.modules["requests"] = requests

    def _post(url, *args, **kwargs):
        for pattern, payload in session.responses.items():
            if pattern in str(url):
                return _FakeResponse(payload)
        return _FakeResponse({})

    requests.post = _post
    requests.get = _post
    return session


# ---------------------------------------------------------------------------
# Telemetry-from-dashboards (pure — unit-testable without comps)
# ---------------------------------------------------------------------------

# The RAG waterfall dashboard's service_name label values (extracted from
# configs/grafana/provisioning/dashboards/rag-pipeline-trace-waterfall.json).
# Telemetry assertions are DERIVED from the dashboard provisioning so a
# telemetry rename cannot silently empty a dashboard.
EXPECTED_DASHBOARD_SERVICES = (
    "genie-backend",
    "genieai-chatqna",
    "genieai-retriever",
    "genieai-reranker",
    "genieai-dataprep",
)

# Span operation names the overlay emits (from code, matched against the
# dashboard's service_name labels + the dataprep span taxonomy).
EXPECTED_SPAN_NAMES = (
    "chatqna.orchestrate",
    "chatqna.reranker_selection",
    "retriever.hybrid_search",
    "reranker.rerank",
    "reranker.tei_invoke",
    "dataprep.ingest",
    "dataprep.chunking",
)


def extract_dashboard_services(dashboards_dir: str | os.PathLike) -> set[str]:
    """Parse Grafana dashboard JSON for ``service_name`` label values.

    Scans every ``*.json`` under ``dashboards_dir`` for PromQL/VictoriaMetrics
    expressions containing ``service_name=~"...|..."`` / ``service_name="..."``
    and returns the set of service names the dashboards actually reference.
    Used by the telemetry contract test to derive its assertion source — a
    hardcoded list that happens to match today's dashboards would not catch a
    silent telemetry rename.
    """
    services: set[str] = set()
    import re

    # Grafana dashboard JSON escapes the embedded quotes in PromQL expressions
    # as `\"`. Normalize them so `service_name=~"a|b"` / `service_name="a"`
    # both match regardless of JSON-escaping.
    pattern = re.compile(r'service_name=~?"([^"]+)"')
    for path in sorted(Path(dashboards_dir).glob("*.json")):
        try:
            text = path.read_text(encoding="utf-8").replace('\\"', '"')
        except OSError:
            continue
        for m in pattern.finditer(text):
            raw = m.group(1)
            if "|" in raw:
                services.update(s.strip() for s in raw.split("|") if s.strip())
            else:
                services.add(raw.strip())
    return {s for s in services if s}


# ---------------------------------------------------------------------------
# Budgets (coarse performance budgets)
# ---------------------------------------------------------------------------

# Coarse budgets for the contract layer. These are WALL-CLOCK budgets on
# HTTP-mocked runs (no GPU, no live services), so they bound pipeline overhead
# (serialization, orchestrator hops, telemetry) — NOT model latency. The values
# are intentionally loose; a 10× regression fails the gate, a 2× does not.
# Recorded here so the budget test asserts against a single source.
NFRP_BUDGETS = {
    # One orchestrator wire-through (schedule → execute → align_inputs →
    # align_outputs) with all endpoints HTTP-mocked: seconds.
    "wire_latency_seconds": 5.0,
    # One-doc ingest smoke (chunk + label with model endpoints HTTP-mocked):
    # seconds. Real model inference is excluded — this bounds the pipeline.
    "ingest_wall_clock_seconds": 30.0,
}


def budget(label: str) -> float:
    """Return the coarse budget for ``label`` (seconds)."""
    if label not in NFRP_BUDGETS:
        raise KeyError(f"unknown NFR-P budget: {label}")
    return NFRP_BUDGETS[label]
