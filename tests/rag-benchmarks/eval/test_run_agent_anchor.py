# Copyright (C) 2026 International Telecommunication Union (ITU)
"""
The gate on the agent-path anchor runner.

The runner's own failure modes are what it exists to catch, so they are
pinned here: a gate that passes vacuously (the venue unreachable, the
trace absent, the parent span dropped, the payload malformed) must be RED,
and it must say WHICH — never a green run over a measurement that did not
happen, and never a red whose reason points at the wrong place.

Two levels of seam:

- the RUN level (the shipped driver and the venue's answer) drives the
  verdicts — what is measured, what is counted, what the exit code says;
- the TRANSPORT level (the REAL `_fetch_json`, over a fake `urlopen`)
  drives the fetch's own failure modes — a non-JSON body, a connection
  error, a 404 ("trace not found"), a transient 5xx. These are the ones
  that used to raise out of the runner, so they are pinned against the
  real function, not a stub of it.

No venue and no network are needed.
"""

from __future__ import annotations

import io
import json
import urllib.error

import run_agent_anchor as runner

# The poll's cadence, shrunk for the suite: the runner reads the module
# constant, so a tiny interval lets a test window hold several polls.
runner.POLL_INTERVAL_S = 0.01

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


def _drive(monkeypatch, trace_payload, outcome: str = "answered", trace_id="abc123"):
    """The runner's run-level seams, faked: the shipped driver and the venue."""
    monkeypatch.setattr(
        runner,
        "run_one_case_c",
        lambda case, base_url=None, deadline_ms=None: {
            "id": case["id"],
            "outcome": outcome,
            "trace_id": trace_id,
        },
    )

    def _fetch(url: str, timeout: float = 60.0):
        if isinstance(trace_payload, Exception):
            raise trace_payload
        return trace_payload

    monkeypatch.setattr(runner, "_fetch_json", _fetch)


def _run(monkeypatch, trace_payload, cases: int = 1, outcome: str = "answered") -> dict:
    _drive(monkeypatch, trace_payload, outcome=outcome)
    cases = [{"id": f"q{index}", "query": "q"} for index in range(cases)]
    # A poll window long enough for ONE fetch: the runner polls until the
    # trace is indexed, and a zero window would never fetch at all.
    return runner.run("http://agent", "http://traces", cases, 1000, 0.05)


class _FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _http_error(code: int, body: bytes) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "http://traces/select/jaeger/api/traces/abc123",
        code,
        "boom",
        None,
        io.BytesIO(body),
    )


def _serve(monkeypatch, *, body=None, error=None):
    """The venue, over the REAL `_fetch_json`: a fake `urlopen` under it."""
    calls = []

    def fake_urlopen(request, timeout=None, context=None):
        calls.append(request)
        if error is not None:
            raise error
        return _FakeResponse(body or b"")

    monkeypatch.setattr(runner.urllib.request, "urlopen", fake_urlopen)
    return calls


def _driver_only(monkeypatch, outcome: str = "answered"):
    """The shipped driver, faked; the venue stays the real fetch."""
    monkeypatch.setattr(
        runner,
        "run_one_case_c",
        lambda case, base_url=None, deadline_ms=None: {
            "id": case["id"],
            "outcome": outcome,
            "trace_id": "abc123",
        },
    )


# --- the run-level verdicts ---------------------------------------------------


def test_a_clean_run_is_green(monkeypatch):
    report = _run(monkeypatch, _trace(*SPANS))

    assert report["aggregate"]["n_missed_traces"] == 0
    assert report["aggregate"]["n_rows_missing_expected_span_names"] == 0
    assert report["aggregate"]["n_rows_runs_not_answered"] == 0
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
    # The trace landed and the run ANSWERED, but the parent span was
    # renamed: the property the runner measures did not happen, and the
    # sharper diagnosis wins.
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


def test_a_run_that_did_not_answer_is_not_a_rename(monkeypatch):
    # The run failed on the venue: it produced no parent to rename. Reading
    # that as a contract change sends the reader to the wrong place, so
    # the two verdicts are apart.
    report = _run(monkeypatch, _trace("agent.model_call"), outcome="error")

    assert report["aggregate"]["n_rows_missing_expected_span_names"] == 0
    assert report["aggregate"]["n_rows_runs_not_answered"] == 1
    assert report["per_query"][0]["run_answered"] is False


def test_a_foreign_service_does_not_satisfy_the_gate(monkeypatch):
    # A span with the right NAME, emitted by another service, is not the
    # agent's span.
    report = _run(monkeypatch, _trace(*SPANS, service="chatqna"))

    assert report["aggregate"]["n_missed_traces"] == 1
    assert report["per_query"][0]["span_names"] == []
    assert "another service name" in report["per_query"][0]["trace_error"]


def test_a_failed_run_with_no_agent_spans_says_the_run_never_reached_the_agent(
    monkeypatch,
):
    # The same empty attribution, on a run that did NOT answer: the cause
    # must agree with the run's own verdict, not contradict it.
    report = _run(monkeypatch, _trace(*SPANS, service="chatqna"), outcome="error")

    assert "never reached the agent" in report["per_query"][0]["trace_error"]


def _trace_payload(*names: str) -> dict:
    return {
        "data": [
            {
                "spans": [{"operationName": name, "processID": "p1"} for name in names],
                "processes": {"p1": {"serviceName": AGENT}},
            }
        ]
    }


def test_a_fetched_trace_is_not_erased_and_the_poll_waits_for_the_parent(monkeypatch):
    # The venue serves the CHILDREN on the first poll, answers a transient
    # 503 on the second, and only exports the parent on the third: the
    # trace already fetched must survive the 503 (losing it would turn
    # "the run answered but the parent was late" into "the trace did not
    # land at all" — a red naming the wrong cause), AND the poll must keep
    # waiting until the parent lands (a trace that exists without
    # agent.run is a run that has not finished yet, not a rename).
    responses = [
        _trace_payload("agent.model_call"),
        _http_error(503, b"unavailable"),
        _trace_payload(*SPANS),
    ]

    def fake_urlopen(request, timeout=None, context=None):
        assert responses, "the poll fetched past the served answers"
        answer = responses.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return _FakeResponse(json.dumps(answer).encode())

    monkeypatch.setattr(runner.urllib.request, "urlopen", fake_urlopen)
    _driver_only(monkeypatch)

    report = runner.run(
        "http://agent", "http://traces", [{"id": "q1", "query": "q"}], 1000, 0.05
    )

    assert report["per_query"][0]["trace_present"] is True
    assert report["per_query"][0]["trace_found"] is True
    assert report["per_query"][0]["span_names"] == sorted(SPANS)
    assert report["aggregate"]["n_missed_traces"] == 0


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
        (
            {"data": [{}]},
            "the venue answered an empty trace for that id",
        ),
    ):
        report = _run(monkeypatch, payload)
        assert report["per_query"][0]["trace_error"] == expected
        assert report["aggregate"]["n_missed_traces"] == 1


def test_every_row_is_measured(monkeypatch):
    report = _run(monkeypatch, _trace(*SPANS), cases=3)

    assert report["aggregate"]["n"] == 3
    assert len(report["per_query"]) == 3
    assert all(row["trace_found"] for row in report["per_query"])


# --- the transport level: the REAL `_fetch_json` over a fake urlopen ----------


def test_a_non_json_body_is_recorded_not_raised(monkeypatch):
    # A venue that answers 200 with an HTML body used to raise
    # JSONDecodeError out of the runner: no report at all.
    _serve(monkeypatch, body=b"<html><body>401</body></html>")
    _driver_only(monkeypatch)

    report = runner.run(
        "http://agent", "http://traces", [{"id": "q1", "query": "q"}], 1000, 0.05
    )

    assert "answered a non-JSON body" in report["per_query"][0]["trace_error"]
    assert report["aggregate"]["n_missed_traces"] == 1


def test_a_connection_error_is_recorded_not_raised(monkeypatch):
    _serve(monkeypatch, error=urllib.error.URLError("connection refused"))
    _driver_only(monkeypatch)

    report = runner.run(
        "http://agent", "http://traces", [{"id": "q1", "query": "q"}], 1000, 0.05
    )

    assert "is unreachable" in report["per_query"][0]["trace_error"]
    assert report["aggregate"]["n_missed_traces"] == 1


def test_a_404_is_a_wait_not_a_failure(monkeypatch):
    # The Jaeger API answers 404 + a JSON body for an unknown trace id:
    # the trace is not indexed YET, so the wait continues. Without this
    # branch the poll aborts on the first fetch and the trace is never
    # awaited.
    calls = _serve(
        monkeypatch,
        error=_http_error(404, json.dumps({"data": [], "errors": []}).encode()),
    )
    _driver_only(monkeypatch)

    report = runner.run(
        "http://agent", "http://traces", [{"id": "q1", "query": "q"}], 1000, 0.05
    )

    assert (
        report["per_query"][0]["trace_error"] == "the venue has no trace with that id"
    )
    # The WAIT continued: a soft answer must not end the poll after one
    # fetch — the trace may still land inside the window. One fetch would
    # mean the soft reason aborted the wait (the would-be green row red).
    assert len(calls) >= 2


def test_a_transient_5xx_is_a_wait_not_a_failure(monkeypatch):
    # A momentary 503 must not turn a would-be green row red: the trace
    # may still land, so the wait continues.
    calls = _serve(monkeypatch, error=_http_error(503, b"unavailable"))
    _driver_only(monkeypatch)

    report = runner.run(
        "http://agent", "http://traces", [{"id": "q1", "query": "q"}], 1000, 0.05
    )

    assert "the venue is not answering" in report["per_query"][0]["trace_error"]
    # The WAIT continued: a soft answer must not end the poll after one
    # fetch — the trace may still land inside the window. One fetch would
    # mean the soft reason aborted the wait (the would-be green row red).
    assert len(calls) >= 2


# --- the exit codes ------------------------------------------------------------


def _exit_code(monkeypatch, tmp_path, trace_payload, outcome: str = "answered") -> int:
    _drive(monkeypatch, trace_payload, outcome=outcome)
    monkeypatch.setattr(
        "sys.argv",
        [
            "run_agent_anchor.py",
            "--agent-url",
            "http://agent",
            "--traces-url",
            "http://traces",
            "--cases",
            "1",
            # A poll window long enough for ONE fetch: the default (60 s)
            # would spend a minute per case in the suite.
            "--trace-timeout-s",
            "0.05",
            "--out",
            str(tmp_path / "report.json"),
        ],
    )
    return runner.main()


def test_the_exit_code_of_a_clean_run_is_zero(monkeypatch, tmp_path):
    assert _exit_code(monkeypatch, tmp_path, _trace(*SPANS)) == 0


def test_the_exit_code_of_a_missing_trace_is_three(monkeypatch, tmp_path):
    assert _exit_code(monkeypatch, tmp_path, {"data": []}) == 3


def test_the_exit_code_of_a_renamed_span_is_five(monkeypatch, tmp_path):
    assert (
        _exit_code(
            monkeypatch,
            tmp_path,
            _trace("agent.run_v2", "agent.model_call", "agent.tool_call"),
        )
        == 5
    )


def test_the_exit_code_of_a_run_that_did_not_answer_is_six(monkeypatch, tmp_path):
    # A run that failed on the venue is not a span-name problem, and its
    # exit code says so — a caller scripted on 5 would go and rename the
    # agent's spans for a venue failure.
    assert (
        _exit_code(monkeypatch, tmp_path, _trace("agent.model_call"), outcome="error")
        == 6
    )
