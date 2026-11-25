"""The gate on the agent-path anchor runner.

The runner's own failure modes are what it exists to catch, so they are
pinned here: a gate that passes vacuously (the venue unreachable, the
trace absent, the parent span dropped, the payload malformed) must be RED,
and it must say WHICH — never a green run over a measurement that did not
happen.

Every case drives the runner's own seams (the shipped driver and the venue
fetch), so no venue and no network are needed.
"""

from __future__ import annotations

import run_agent_anchor as runner

AGENT = "agent-service"
SPANS = ("agent.run", "agent.model_call", "agent.tool_call")


def _trace(*names: str, service: str = AGENT) -> dict:
    """A Jaeger-shaped trace: the spans, and the processes they belong to."""
    return {
        "data": [
            {
                "spans": [{"operationName": name, "processID": "p1"} for name in names],
                "processes": {"p1": {"serviceName": service}},
            }
        ]
    }


def _drive(monkeypatch, trace_payload, trace_id: str = "abc123"):
    """The runner's two seams, faked: the shipped driver and the venue."""
    monkeypatch.setattr(
        runner,
        "run_one_case_c",
        lambda case, base_url=None, deadline_ms=None: {
            "id": case["id"],
            "outcome": "answered",
            "trace_id": trace_id,
        },
    )

    def _fetch(url: str, timeout: float = 60.0):
        if isinstance(trace_payload, Exception):
            raise trace_payload
        return trace_payload

    monkeypatch.setattr(runner, "_fetch_json", _fetch)


def _run(monkeypatch, trace_payload, cases: int = 1) -> dict:
    _drive(monkeypatch, trace_payload)
    cases = [{"id": f"q{index}", "query": "q"} for index in range(cases)]
    # A poll window long enough for ONE fetch: the runner polls until the
    # trace is indexed, and a zero window would never fetch at all.
    return runner.run("http://agent", "http://traces", cases, 1000, 0.05)


def test_a_clean_run_is_green(monkeypatch):
    report = _run(monkeypatch, _trace(*SPANS))

    assert report["aggregate"]["n_missed_traces"] == 0
    assert report["aggregate"]["n_rows_missing_expected_span_names"] == 0
    assert report["per_query"][0]["trace_found"] is True
    assert report["per_query"][0]["trace_error"] is None


def test_an_unreachable_venue_is_not_a_green_run(monkeypatch):
    report = _run(monkeypatch, RuntimeError("the venue is unreachable"))

    assert report["aggregate"]["n_missed_traces"] == 1
    assert report["per_query"][0]["trace_found"] is False
    assert "the trace fetch failed" in report["per_query"][0]["trace_error"]


def test_a_missing_trace_is_not_a_green_run(monkeypatch):
    # The venue answers "no trace with that id": the trace may still be
    # indexed, so the row waits — and the run stays red.
    report = _run(monkeypatch, {"data": []})

    assert report["aggregate"]["n_missed_traces"] == 1
    assert (
        report["per_query"][0]["trace_error"] == "the venue has no trace with that id"
    )


def test_a_renamed_span_is_not_a_green_run(monkeypatch):
    # The trace landed, but the parent span was renamed: the property the
    # runner measures did not happen, and the sharper diagnosis wins.
    report = _run(
        monkeypatch, _trace("agent.run_v2", "agent.model_call", "agent.tool_call")
    )

    assert report["aggregate"]["n_rows_missing_expected_span_names"] == 1
    assert report["per_query"][0]["missing_span_names"] == ["agent.run"]
    assert report["per_query"][0]["trace_found"] is False


def test_a_dropped_parent_span_is_not_a_green_run(monkeypatch):
    # The children landed, the parent did not: a trace with spans is not a
    # trace that carries the run.
    report = _run(monkeypatch, _trace("agent.model_call", "agent.tool_call"))

    assert report["aggregate"]["n_missed_traces"] == 1
    assert report["aggregate"]["n_rows_missing_expected_span_names"] == 1


def test_a_foreign_service_does_not_satisfy_the_gate(monkeypatch):
    # A span with the right NAME, emitted by another service, is not the
    # agent's span.
    report = _run(monkeypatch, _trace(*SPANS, service="chatqna"))

    assert report["aggregate"]["n_missed_traces"] == 1
    assert report["per_query"][0]["span_names"] == []


def test_a_malformed_payload_is_recorded_not_raised(monkeypatch):
    for payload, expected in (
        ("not an object", "the trace fetch answered a non-object payload"),
        (
            {"data": "oops"},
            "the trace fetch answered a payload whose data is not a list",
        ),
        (
            {"data": ["x"]},
            "the trace fetch answered a payload whose trace is not an object",
        ),
    ):
        report = _run(monkeypatch, payload)
        assert report["per_query"][0]["trace_error"] == expected
        assert report["aggregate"]["n_missed_traces"] == 1


def test_a_non_json_body_is_recorded_not_raised(monkeypatch):
    report = _run(monkeypatch, RuntimeError("answered a non-JSON body"))

    assert "the trace fetch failed" in report["per_query"][0]["trace_error"]
    assert report["aggregate"]["n_missed_traces"] == 1


def test_every_row_is_measured(monkeypatch):
    report = _run(monkeypatch, _trace(*SPANS), cases=3)

    assert report["aggregate"]["n"] == 3
    assert len(report["per_query"]) == 3
    assert all(row["trace_found"] for row in report["per_query"])
