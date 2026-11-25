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
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as failed:
        body = failed.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{url} answered {failed.code}: {body[:200]}") from failed


def _trace_by_id(traces_url: str, trace_id: str) -> dict:
    """The trace with that id, or an empty dict when the venue does not have it."""
    base = traces_url.rstrip("/")
    if "/select/jaeger" in base:
        base = base.split("/select/jaeger")[0]
    url = f"{base}/select/jaeger/api/traces/{trace_id}"
    try:
        payload = _fetch_json(url)
    except (RuntimeError, urllib.error.URLError, OSError) as failed:
        return {"error": str(failed)[:200]}
    traces = payload.get("data") or []
    if not traces:
        return {}
    return traces[0]


def _span_names(trace: dict) -> list[str]:
    return [span.get("operationName") for span in (trace.get("spans") or [])]


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
        if trace_id:
            # The trace lands asynchronously (the collector batches it), so
            # the fetch polls until the deadline — the same shape as the
            # legacy anchor's trace fetch.
            deadline = time.time() + trace_timeout_s
            while time.time() < deadline:
                trace = _trace_by_id(traces_url, trace_id)
                if trace:
                    break
                time.sleep(2.0)
        names = _span_names(trace) if trace else []
        row["trace_found"] = bool(trace)
        row["span_names"] = sorted(set(names))
        row["services"] = sorted(_services(trace)) if trace else []
        row["agent_run_span"] = "agent.run" in names
        row["tool_call_spans"] = names.count("agent.tool_call")
        row["model_call_spans"] = names.count("agent.model_call")
        rows.append(row)
        print(
            f"[{case['id']}] outcome={row.get('outcome')} trace_found={row['trace_found']} "
            f"spans={row['span_names']}",
            file=sys.stderr,
        )
    missed = sum(1 for r in rows if not r.get("trace_found"))
    report = {
        "aggregate": {
            "n": len(rows),
            "n_missed_traces": missed,
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
    # The acceptance: no run may miss its trace on a clean run.
    return 0 if aggregate["n_missed_traces"] == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
