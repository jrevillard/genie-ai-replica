#!/usr/bin/env python3
"""The agent-path anchor: every run's TRACE, fetched by identity.

The legacy anchor (`run_eval.py anchor`) measures the retrieval TUPLE the
reranker selected, out of a `reranker_selection` span. The agent path emits
no such span: the agent's spans carry counters and ids only, and its
citations are FILE-level (`provenance.file_id`), so the chunk-level tuple the
legacy anchor scores is not derivable from what the agent emits today (the
design and the deferral: `anchor-mode-adaptation-design.md`).

What IS derivable, and is what this runner measures, is the other half of
the anchor: **the trace**. Every run must land in VictoriaTraces as an
`agent.run` span with its per-model-call and per-tool-call children — the
property the campaign's acceptance names (`n_missed_traces` must be 0 on a
clean run).

The identity is exact, not a time-window guess: the shipped config-C driver
PROPAGATES its own W3C traceparent, so the run's spans join that trace and
the runner fetches it by id (`/select/jaeger/api/traces/{trace_id}`). The
agent's spans carry no run id, so this propagated trace id is the only exact
handle on "this run's spans".

Usage:
    python3 run_agent_anchor.py --agent-url http://127.0.0.1:18010 \
        --traces-url http://127.0.0.1:10428 [--cases 5] [--out report.json]

The runner reuses the shipped driver (`protocol/drivers.py::run_one_case_c`)
and the shipped agent's own questions when no case file is given — it
measures the TRACE property, not a gold-scored retrieval property.

Exit codes (the contract a caller scripts against):
    0  every run's trace landed and carried the expected span names
    3  a run's trace did not land at all (the venue answered no trace)
    5  a run's trace landed but an expected span name is missing — a
       rename on the agent side, or a dropped parent span

The agent also emits `agent.grounding_judge` and `agent.verify_finalize`;
they are NOT required per row (a run that answers without a citation
emits no grounding judge), so they are observed and reported, not pinned.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from protocol.drivers import run_one_case_c

# The agent's span names — ONE place names them (the span-name config the
# adaptation calls for). The agent service reports them as its own span
# names; a rename on the agent side must break HERE, not silently.
AGENT_SPAN_NAMES = ("agent.run", "agent.model_call", "agent.tool_call")
AGENT_SERVICE_NAME = "agent-service"

# The questions the runner drives when no case file is given. Each one makes
# the agent SEARCH (the corpus question), so the run carries the tool-call
# children the trace property is about.
DEFAULT_QUESTIONS = (
    "What is the capital of France?",
    "Name one GENIE.AI service.",
    "What does the GENIE.AI knowledge base serve?",
)


def _fetch_json(url: str, timeout: float = 60.0):
    ctx = None
    if url.startswith("https://"):
        import ssl

        ctx = ssl._create_unverified_context()
    request = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ctx) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as failed:
        body = failed.read().decode("utf-8", errors="replace")
        if failed.code == 404:
            # The Jaeger API answers 404 + a JSON body for an unknown
            # trace id ("trace not found"): the trace is not indexed
            # (yet), which is a WAIT, not a failure. The payload is
            # returned so the caller reads "no trace with that id".
            try:
                return json.loads(body)
            except ValueError:
                return {}
        raise RuntimeError(f"{url} answered {failed.code}: {body[:200]}") from failed
    except (urllib.error.URLError, OSError) as failed:
        raise RuntimeError(f"{url} is unreachable: {str(failed)[:200]}") from failed
    try:
        return json.loads(body)
    except ValueError as failed:
        # A venue that answers 200 with a non-JSON body (an auth page,
        # an HTML error) must land on the row's reason — never kill the
        # runner, and never read as a found trace.
        raise RuntimeError(f"{url} answered a non-JSON body: {body[:120]}") from failed


def _trace_by_id(traces_url: str, trace_id: str) -> tuple[dict, str]:
    """The trace with that id, and the reason there is none.

    The reason is NOT a sentinel inside the payload: a truthy error dict
    would read as "the trace was found" on a venue with no trace pipeline
    at all — the exact failure the anchor exists to catch. The trace and
    the reason are separate return values.
    """
    base = traces_url.rstrip("/")
    if "/select/jaeger" in base:
        base = base.split("/select/jaeger")[0]
    url = f"{base}/select/jaeger/api/traces/{trace_id}"
    try:
        payload = _fetch_json(url)
    except (RuntimeError, urllib.error.URLError, OSError) as failed:
        return {}, f"the trace fetch failed: {str(failed)[:200]}"
    if not isinstance(payload, dict):
        return {}, "the trace fetch answered a non-object payload"
    traces = payload.get("data")
    if traces is None:
        traces = []
    if not isinstance(traces, list):
        return {}, "the trace fetch answered a payload whose data is not a list"
    if not traces:
        return {}, "the venue has no trace with that id"
    trace = traces[0]
    if not isinstance(trace, dict):
        return {}, "the trace fetch answered a payload whose trace is not an object"
    return trace, ""


def _span_names(trace: dict, service: str = AGENT_SERVICE_NAME) -> list[str]:
    """The agent's span names — its OWN service's spans only.

    A foreign service's span with the right name would otherwise satisfy
    the gate, and a span without a name would break the sort below.
    """
    processes = trace.get("processes") or {}
    names: list[str] = []
    for span in trace.get("spans") or []:
        if not isinstance(span, dict):
            continue
        if service:
            process = processes.get(span.get("processID")) or {}
            if process.get("serviceName") != service:
                continue
        name = span.get("operationName")
        if name:
            names.append(name)
    return names


def _services(trace: dict) -> set[str]:
    processes = trace.get("processes") or {}
    return {
        (processes.get(span.get("processID")) or {}).get("serviceName", "?")
        for span in (trace.get("spans") or [])
    }


def run(
    agent_url: str,
    traces_url: str,
    cases: list[dict],
    deadline_ms: int,
    trace_timeout_s: float,
) -> dict:
    rows: list[dict] = []
    for case in cases:
        started = time.time()
        row = run_one_case_c(case, base_url=agent_url, deadline_ms=deadline_ms)
        row["wall_s"] = round(time.time() - started, 1)
        trace_id = row.get("trace_id")
        row["trace_id"] = trace_id
        trace: dict = {}
        reason = "no trace id on the row"
        if trace_id:
            # The trace lands asynchronously (the collector batches it), so
            # the fetch polls until the deadline — the same shape as the
            # legacy anchor's trace fetch. A HARD failure (the venue is
            # unreachable, the body is not JSON) ends the wait at once:
            # polling a broken venue for the whole window only delays the
            # red. "no trace with that id" keeps the wait: the trace may
            # still be indexed.
            deadline = time.time() + trace_timeout_s
            while time.time() < deadline:
                trace, reason = _trace_by_id(traces_url, trace_id)
                if trace or reason.startswith("the trace fetch failed"):
                    break
                time.sleep(2.0)
        trace_present = bool(trace)
        names = _span_names(trace) if trace_present else []
        observed = set(names)
        # The trace FOUND is the design's wording: the trace exists AND
        # carries the `agent.run` parent. A trace whose parent was dropped
        # is not a found trace — the property the runner measures did not
        # land, whatever the children say.
        row["trace_present"] = trace_present
        row["trace_found"] = "agent.run" in observed
        row["trace_error"] = reason or None
        row["span_names"] = sorted(observed)
        row["services"] = sorted(_services(trace)) if trace_present else []
        row["agent_run_span"] = "agent.run" in observed
        row["tool_call_spans"] = names.count("agent.tool_call")
        row["model_call_spans"] = names.count("agent.model_call")
        # The span-name config is ENFORCED: a rename on the agent side must
        # break the gate, not be reported as a green run.
        missing = [name for name in AGENT_SPAN_NAMES if name not in observed]
        row["missing_span_names"] = missing
        rows.append(row)
        print(
            f"[{case['id']}] outcome={row.get('outcome')} trace_found={row['trace_found']} "
            f"spans={row['span_names']}"
            + (f" missing={missing}" if missing else "")
            + (f" ({reason})" if reason else ""),
            file=sys.stderr,
        )
    # n_missed_traces = the runs whose trace did not land: no trace with
    # that id, or a trace without the `agent.run` parent. Both are the
    # property the campaign's acceptance names, so both count.
    missed = sum(1 for r in rows if not r.get("trace_found"))
    # A trace that landed but lost a span name is a RENAME (or a dropped
    # span), not a missing trace: it is counted apart, and it is the
    # sharper diagnosis, so it wins the exit code.
    renamed = sum(
        1 for r in rows if r.get("trace_present") and r.get("missing_span_names")
    )
    report = {
        "aggregate": {
            "n": len(rows),
            "n_missed_traces": missed,
            "n_rows_missing_expected_span_names": renamed,
            "n_answered": sum(1 for r in rows if r.get("outcome") == "answered"),
            "n_tool_calls": sum(r.get("tool_call_spans") or 0 for r in rows),
            "agent_service_name": AGENT_SERVICE_NAME,
            "agent_span_names": list(AGENT_SPAN_NAMES),
        },
        "per_query": rows,
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent-url", required=True, help="the agent-service base url")
    parser.add_argument(
        "--traces-url", required=True, help="the VictoriaTraces base url"
    )
    parser.add_argument(
        "--cases", type=int, default=3, help="how many default questions to drive"
    )
    parser.add_argument(
        "--case-file", default="", help="a JSON file with a list of cases"
    )
    parser.add_argument("--deadline-ms", type=int, default=120_000)
    parser.add_argument("--trace-timeout-s", type=float, default=60.0)
    parser.add_argument("--out", default="agent_anchor_report.json")
    args = parser.parse_args()

    if args.case_file:
        cases = json.loads(Path(args.case_file).read_text())
        if isinstance(cases, dict):
            cases = cases.get("entries") or cases.get("cases") or []
    else:
        cases = [
            {"id": f"q{index + 1}", "query": question}
            for index, question in enumerate(DEFAULT_QUESTIONS[: args.cases])
        ]

    report = run(
        args.agent_url,
        args.traces_url,
        cases,
        args.deadline_ms,
        args.trace_timeout_s,
    )
    Path(args.out).write_text(json.dumps(report, indent=2, ensure_ascii=False))
    aggregate = report["aggregate"]
    print(json.dumps(aggregate, indent=2), file=sys.stderr)
    print(f"wrote {args.out}", file=sys.stderr)
    # The acceptance: no run may miss its trace on a clean run, and the
    # agent's span names must be the ones this runner names — a rename on
    # the agent side is a change of the contract, not a green run. A trace
    # that landed with a wrong span name is the sharper diagnosis, so it
    # is reported FIRST (the numbers are in the report either way).
    if aggregate["n_rows_missing_expected_span_names"]:
        return 5
    if aggregate["n_missed_traces"]:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
