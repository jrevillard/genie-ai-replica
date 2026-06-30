#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Reranker-selection eval: drive gold queries, measure recall / precision.

Flow (per gold entry):
  1. POST {messages, context, stream:false} to chatqna via docker exec (NO OIDC —
     internal service, faithful label-filtered retrieval, see README).
  2. Pull the resulting trace from VictoriaTraces by service + time window
     (robust — does not rely on traceparent in response headers).
  3. Extract rag.candidate_chunk_ids / rag.selected_chunk_ids from the
     chatqna.reranker_selection span.
  4. Match against gold_chunk_keys → recall / precision / complete-recall / noise.

Run twice for an A/B: once per reranker config (redeploy between runs), save each
report, then diff. See README.md.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import metrics

# --- stack config (env-overridable) -----------------------------------------
CHATQNA_CONTAINER = os.getenv("CHATQNA_CONTAINER", "genieai_el-salvador_chatqna")
VICTORIATRACES_SVC = os.getenv("VICTORIATRACES_SVC", "genieai_el-salvador_victoriatraces")
CHATQNA_URL = os.getenv("CHATQNA_URL", "http://localhost:8888/v1/chatqna")
CHATQNA_SERVICE_NAME = os.getenv("CHATQNA_SERVICE_NAME", "GENIE.AI_CHATQNA")
TRACE_FLUSH_WAIT = float(os.getenv("TRACE_FLUSH_WAIT", "3"))
TRACE_LOOKUP_SPAN_S = float(os.getenv("TRACE_LOOKUP_SPAN_S", "20"))


def _docker_exec(container: str, cmd: str, timeout: float = 120) -> str:
    """Run `docker exec <container> sh -c '<cmd>'` and return stdout."""
    result = subprocess.run(
        ["docker", "exec", container, "sh", "-c", cmd],
        capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"docker exec failed: {result.stderr.strip()[:300]}")
    return result.stdout


def drive_query(entry: dict) -> float:
    """POST the gold query to chatqna. Returns request start time (epoch s)."""
    payload = {
        "messages": [{"role": "user", "content": entry["query"]}],
        "context": {
            "categoryLabel": entry.get("categoryLabel", ""),
            "serviceLabels": entry.get("serviceLabels", []),
            "language": entry.get("language", "en"),
        },
        "stream": False,
    }
    # JSON payload without single quotes (so it survives the sh -c '...' wrapper).
    payload_json = json.dumps(payload).replace("'", "'\\''")
    start = time.time()
    cmd = (
        f"curl -s -o /dev/null -m {int(TRACE_LOOKUP_SPAN_S * 3)} "
        f"-X POST {CHATQNA_URL} -H 'Content-Type: application/json' -d '{payload_json}'"
    )
    _docker_exec(CHATQNA_CONTAINER, cmd, timeout=TRACE_LOOKUP_SPAN_S * 4)
    return start


def fetch_selection(start_s: float) -> tuple[list[str], list[str]]:
    """Find the chatqna.reranker_selection span emitted during [start, start+span].

    Returns (candidate_chunk_ids, selected_chunk_ids).
    """
    end_s = start_s + TRACE_LOOKUP_SPAN_S
    start_us, end_us = int(start_s * 1e6), int(end_s * 1e6)
    url = (
        f"http://{VICTORIATRACES_SVC}:10428/select/jaeger/api/traces"
        f"?service={CHATQNA_SERVICE_NAME}"
        f"&operation=chatqna.reranker_selection"
        f"&start={start_us}&end={end_us}"
    )
    time.sleep(TRACE_FLUSH_WAIT)  # spans flush at span end
    raw = _docker_exec(CHATQNA_CONTAINER, f"curl -s '{url}'", timeout=60)
    data = json.loads(raw or "{}")
    traces = data.get("data", [])
    if not traces:
        return [], []

    # Collect selection attrs from every matching span in the window.
    candidates, selected = [], []
    for tr in traces:
        for sp in tr.get("spans", []):
            tags = {t["key"]: t.get("value") for t in sp.get("tags", [])}
            c = tags.get("rag.candidate_chunk_ids")
            s = tags.get("rag.selected_chunk_ids")
            if isinstance(c, list):
                candidates = c
            if isinstance(s, list):
                selected = s
    return candidates, selected


def main(gold_path: str, out_path: str) -> None:
    with open(gold_path) as fh:
        gold = json.load(fh)
    entries = gold["entries"]

    rows = []
    for entry in entries:
        start = drive_query(entry)
        candidates, selected = fetch_selection(start)
        gold_keys = entry["gold_chunk_keys"]
        row = {
            "id": entry["id"],
            "query": entry["query"],
            "gold": gold_keys,
            "candidates": candidates,
            "selected": selected,
            "recall": metrics.recall(gold_keys, selected),
            "precision": metrics.precision(gold_keys, selected),
            "complete_recall": metrics.complete_recall(gold_keys, selected),
            "noise": metrics.noise(gold_keys, selected),
        }
        if candidates:
            row["retrieval_recall"] = metrics.retrieval_recall(gold_keys, candidates)
        rows.append(row)
        print(
            f"[{entry['id']}] recall={row['recall']:.2f} precision={row['precision']:.2f} "
            f"complete={row['complete_recall']:.0f} noise={row['noise']:.2f} "
            f"(selected {len(selected)}/{len(candidates) if candidates else '?'})",
            file=sys.stderr,
        )

    agg = metrics.aggregate(rows)
    report = {"per_query": rows, "aggregate": agg}
    with open(out_path, "w") as fh:
        json.dump(report, fh, indent=2)
    print(f"\n=== AGGREGATE (n={agg['n']}) ===", file=sys.stderr)
    for k in ("recall", "precision", "complete_recall", "noise", "retrieval_recall"):
        if k in agg:
            print(f"  {k:20s} {agg[k]:.3f}", file=sys.stderr)
    print(f"\nReport → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    gold = sys.argv[1] if len(sys.argv) > 1 else "gold_dataset.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "eval_report.json"
    main(gold, out)
