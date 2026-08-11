# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for the contract harness pure logic (runs in the dev venv).

These test the parts of ``_harness.py`` that are importable WITHOUT the real
vendored ``comps`` — the in-image sensitivity guard, the dashboard-derived
telemetry extraction, the aiohttp fake, and the budget table. They are the
locally-runnable core of the contract suite; the in-image integration tests
(``test_contract_*.py``) run inside the built image.

NOTE: these tests import ``_harness`` directly. They must NOT import the
``tests/`` conftest mocking layer — ``pytest.ini`` ``testpaths = tests`` keeps
the mocked suite from collecting this directory, and these tests do not touch
``comps``.
"""

import json

import _harness

# --- in-image guard (sensitivity: no green-on-green) -----------------------


def test_in_image_comps_importable_false_in_dev_env():
    # Dev-env assertion: the real vendored comps is NOT importable locally
    # (tests/conftest mocks it, /app/comps does not exist). The guard must be
    # False so require_real_comps() skips rather than green-passes. In-image the
    # real comps IS importable — this dev-only test then skips.
    import pytest

    if _harness.in_image_comps_importable():
        pytest.skip("dev-env assertion — real comps is present (in-image)")
    assert _harness.in_image_comps_importable() is False


def test_require_real_comps_skips_in_dev_env():
    # require_real_comps() must NOT silently pass in the mocked env — a skip is
    # the sensitivity guard. In-image it returns the real comps, so this
    # dev-only assertion skips.
    import pytest

    if _harness.in_image_comps_importable():
        pytest.skip("dev-env assertion — real comps is present (in-image)")
    with pytest.raises(pytest.skip.Exception):
        # pytest.skip raises Skipped (a pytest-internal BaseException subclass).
        _harness.require_real_comps()


# --- telemetry-from-dashboards ---------------------------------------


def test_extract_dashboard_services_parses_expr(tmp_path):
    d = tmp_path / "dash.json"
    d.write_text(
        json.dumps(
            {
                "panels": [
                    {
                        "targets": [
                            {
                                "expr": (
                                    "sum(rate(http_server_duration_milliseconds_count{service_name=~"
                                    '"genie-backend|genieai-chatqna|genieai-retriever|genieai-reranker"}[5m])) '
                                    "by (service_name)"
                                )
                            }
                        ]
                    },
                    {
                        "targets": [
                            {
                                "expr": (
                                    "sum(rate(http_server_duration_milliseconds_count{service_name="
                                    '"genieai-dataprep"}[5m])) '
                                    "by (service_name)"
                                ),  # noqa: E501
                            }
                        ]
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    services = _harness.extract_dashboard_services(tmp_path)
    assert services == {
        "genie-backend",
        "genieai-chatqna",
        "genieai-retriever",
        "genieai-reranker",
        "genieai-dataprep",
    }


def test_extract_dashboard_services_empty_when_no_refs(tmp_path):
    d = tmp_path / "dash.json"
    d.write_text(json.dumps({"panels": []}), encoding="utf-8")
    assert _harness.extract_dashboard_services(tmp_path) == set()


def test_extract_dashboard_services_skips_missing_file(tmp_path):
    # No dashboards at all → empty set, no crash.
    assert _harness.extract_dashboard_services(tmp_path) == set()


def test_expected_dashboard_services_match_real_dashboard():
    # Guard against drift: the expected set must be a subset of what the actual
    # provisioned dashboards reference. The dashboards live in the REPO (not the
    # built image) — skip when they are absent (in-image run). The repo root is
    # probed upward from this file (contracts → genie-ai-overlay → repo); in the
    # image /contracts has no repo above it, so the probe resolves and the
    # dashboards dir is absent → skip.
    from pathlib import Path

    import pytest

    # Probe upward from this file (contracts → genie-ai-overlay → repo). In the
    # image (/contracts) the probe cannot reach a repo → dashboards absent → skip.
    root = Path(__file__).resolve()
    repo_root = None
    for parent in (root.parent, *root.parents):
        if (parent / "configs/grafana/provisioning/dashboards").is_dir():
            repo_root = parent
            break
    if repo_root is None:
        pytest.skip("repo dashboards not found (in-image run)")
    dashboards = repo_root / "configs/grafana/provisioning/dashboards"
    real = _harness.extract_dashboard_services(dashboards)
    for svc in _harness.EXPECTED_DASHBOARD_SERVICES:
        assert svc in real, (
            f"expected dashboard service {svc} not found in {dashboards} — telemetry assertion source drifted"
        )


# --- budgets ---------------------------------------------------------


def test_budget_known_label():
    assert _harness.budget("wire_latency_seconds") > 0
    assert _harness.budget("ingest_wall_clock_seconds") > 0


def test_budget_unknown_label_raises():
    import pytest

    with pytest.raises(KeyError):
        _harness.budget("nope")


def test_budgets_are_positive():
    for label, value in _harness.NFRP_BUDGETS.items():
        assert value > 0, label


# --- fake aiohttp ---------------------------------------------------------


def test_fake_session_post_returns_fake_response():
    import asyncio

    session = _harness.FakeAiohttpSession()
    resp = asyncio.run(session.post("http://fake/v1/chat/completions", json={}))
    assert resp.status == 200
    assert asyncio.run(resp.json()) == {}


def test_fake_session_records_calls():
    import asyncio

    session = _harness.FakeAiohttpSession()
    asyncio.run(session.post("http://fake/v1/retrieval", json={"input": "x"}))
    assert session.calls and "retrieval" in session.calls[0][0]


def test_fake_session_returns_matched_payload():
    import asyncio

    session = _harness.FakeAiohttpSession({"/v1/retrieval": {"docs": ["a"]}})
    resp = asyncio.run(session.post("http://fake/v1/retrieval", json={}))
    assert asyncio.run(resp.json()) == {"docs": ["a"]}


def test_genie_kwargs_invariant():
    # The 6 GENIE kwargs + exact wire values are the forwarding contract.
    assert len(_harness.GENIE_KWARGS) == 6
    assert set(_harness.WIRE_KWARGS) == set(_harness.GENIE_KWARGS)
