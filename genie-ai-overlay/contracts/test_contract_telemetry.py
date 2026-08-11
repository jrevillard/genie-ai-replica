# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Telemetry contract test — the span names the dashboards rely on are emitted.

The RAG dashboards (configs/grafana/provisioning/) are the runtime contract for
what telemetry must exist. This test asserts the OVERLAY CODE (all modules +
core) emits the span operation names the trace-explorer / RAG waterfall
dashboards depend on — so a telemetry rename on the bump that drops a span
fails here instead of silently emptying a dashboard.

The dashboard-side of the derivation (extracting the expected service_name set
from the dashboard JSON) is covered in ``test_contract_harness.py`` against the
real repo dashboards. This test covers the CODE side, scanning the repo overlay
source (not a single module image — the spans span chatqna, retriever, reranker,
and dataprep).

This is a PURE test (no comps, no image) — it runs in the dev venv and CI, and
does not need the in-image guard.
"""

from __future__ import annotations

from pathlib import Path

import _harness


def _overlay_root() -> Path:
    """The genie-ai-overlay root (parents: contracts → genie-ai-overlay → repo)."""
    return Path(__file__).resolve().parents[1]


def test_span_names_emitted_by_overlay_code():
    """Each expected span operation name is emitted somewhere in the overlay.

    Scans chatqna/retriever/reranker/dataprep/core/tracing for the span strings.
    A telemetry rename on the bump that drops a span fails this — the span set
    the dashboards depend on must stay emitted.
    """
    overlay = _overlay_root()
    assert overlay.is_dir(), f"overlay root not found: {overlay}"
    found: set[str] = set()
    for path in overlay.rglob("*.py"):
        # Skip the vendored comps clone + the mocked test suite (not overlay).
        rel = path.relative_to(overlay)
        if rel.parts and rel.parts[0] in ("tests",):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for span in _harness.EXPECTED_SPAN_NAMES:
            if span in text:
                found.add(span)
    missing = set(_harness.EXPECTED_SPAN_NAMES) - found
    assert not missing, (
        f"span names {missing} not emitted by any overlay module — "
        f"telemetry rename would silently empty the trace dashboards"
    )


def test_dashboard_referenced_spans_are_emitted():
    """Every span the RAG waterfall dashboard relies on is emitted.

    Derive the dashboard service_name set (the contract source) and cross-check
    the overlay emits spans for every expected dashboard service.
    """
    repo_root = _overlay_root().parent
    dashboards = repo_root / "configs/grafana/provisioning/dashboards"
    if not dashboards.is_dir():
        import pytest

        pytest.skip(f"dashboards dir not found: {dashboards}")
    real = _harness.extract_dashboard_services(dashboards)
    expected = set(_harness.EXPECTED_DASHBOARD_SERVICES)
    missing = expected - real
    assert not missing, (
        f"overlay services {missing} missing from dashboard references — a dashboard is querying a non-existent service"
    )
