#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Retrieval eval driver. Two modes, one collection path.

Both modes drive gold queries through chatqna via docker exec (internal service,
NO OIDC — faithful label-filtered retrieval) and pull the selection from the
chatqna.reranker_selection span in VictoriaTraces.

The span emits CONTENT HASHES (not ``_key`` — langchain mangles ``_key`` during
the retriever->chatqna handoff, so content is the only stable identity). These
match gold_dataset.json expected content_hashes directly.

  --mode anchor       Deterministic: match selected/candidate hashes against
                      gold. Reproducible, no LLM. recall/precision/
                      complete_recall/noise/retrieval_recall. Survives
                      re-ingestion (content-based).

  --mode dump-tuples  Collect (question, contexts, answer, reference_answer)
                      per query → eval_tuples.json. Feed to run_ragas_eval.py
                      (an external LLM judge) for semantic faithfulness/

Run twice (once per reranker config, redeploy between) + diff reports for an A/B.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import metrics
from arango import cursor
from chunk_identity import content_hash

# --- stack config (env-overridable) -----------------------------------------
CHATQNA_CONTAINER = os.getenv("CHATQNA_CONTAINER", "genieai_el-salvador_chatqna")
VICTORIATRACES_SVC = os.getenv("VICTORIATRACES_SVC", "genieai_el-salvador_victoriatraces")
CHATQNA_URL = os.getenv("CHATQNA_URL", "http://localhost:8888/v1/chatqna")
CHATQNA_SERVICE_NAME = os.getenv("CHATQNA_SERVICE_NAME", "genieai-chatqna")
GRAPH_SOURCE = os.getenv("GRAPH_SOURCE", "GRAPH_TEST_SOURCE")
TEXT_FIELD = os.getenv("ARANGO_TEXT_FIELD", "text")
TRACE_FLUSH_WAIT = float(os.getenv("TRACE_FLUSH_WAIT", "5"))
TRACE_FETCH_TIMEOUT = float(os.getenv("TRACE_FETCH_TIMEOUT", "120"))


def _docker_exec(container: str, cmd: str, timeout: float = 120) -> str:
    result = subprocess.run(
        ["docker", "exec", container, "sh", "-c", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"docker exec failed: {result.stderr.strip()[:300]}")
    return result.stdout


def _as_list(v) -> list:
    """VictoriaTraces serializes span array attributes as JSON STRINGS — coerce."""
    if isinstance(v, list):
        return v
    if isinstance(v, str) and v:
        try:
            r = json.loads(v)
            return r if isinstance(r, list) else []
        except json.JSONDecodeError:
            return []
    return []


def drive_query(entry: dict) -> tuple[float, str]:
    """POST the gold query to chatqna. Returns (start_time, response_body)."""
    payload = {
        "messages": [{"role": "user", "content": entry["query"]}],
        "context": {
            "categoryLabels": entry.get("categoryLabels", []),
            "serviceLabels": entry.get("serviceLabels", []),
            "language": entry.get("language", "en"),
        },
        "stream": False,
    }
    payload_json = json.dumps(payload).replace("'", "'\\''")
    start = time.time()
    cmd = f"curl -s -m 120 -X POST {CHATQNA_URL} -H 'Content-Type: application/json' -d '{payload_json}'"
    body = _docker_exec(CHATQNA_CONTAINER, cmd, timeout=150)
    return start, body


def _extract_answer(body: str) -> str:
    if not body:
        return ""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return body.strip()
    if isinstance(data, dict):
        for key in ("text", "answer", "generated_text"):
            if data.get(key):
                return data[key]
        md = data.get("metadata") or {}
        if isinstance(md, dict) and md.get("answer"):
            return md["answer"]
        return json.dumps(data)
    return str(data)


def _extract_selection(raw: str, start_s: float) -> tuple[list[str], list[str]]:
    """Return (candidate_hashes, selected_hashes) for THIS query's trace.

    Picks the newest reranker_selection span at/after the query start. Coerces
    JSON-stringified array attrs (VictoriaTraces does this) via _as_list.
    """
    data = json.loads(raw or "{}")
    query_start_us = start_s * 1e6
    best = None  # (startTime, candidates, selected)
    for tr in data.get("data", []):
        for sp in tr.get("spans", []):
            if "reranker_selection" not in sp.get("operationName", ""):
                continue
            st = sp.get("startTime", 0)
            if st < query_start_us - 5_000_000:  # >5s before query — older trace
                continue
            tags = {t["key"]: t.get("value") for t in sp.get("tags", [])}
            c = _as_list(tags.get("rag.candidate_chunk_keys"))
            s = _as_list(tags.get("rag.selected_chunk_keys"))
            if best is None or st > best[0]:
                best = (st, c, s)
    if best is None:
        return [], []
    return best[1], best[2]


def fetch_selection(start_s: float) -> tuple[list[str], list[str]]:
    """Poll VictoriaTraces until the trace is indexed or TRACE_FETCH_TIMEOUT.

    Generous window (1h back/1min forward) — VT's tight-window time filter has
    quirky boundary semantics; the trace is disambiguated by startTime in
    _extract_selection. Indexing lag on a busy VT node can exceed a minute.
    """
    deadline = time.time() + TRACE_FETCH_TIMEOUT
    while True:
        time.sleep(TRACE_FLUSH_WAIT)
        start_us = int((start_s - 3600) * 1e6)
        end_us = int((time.time() + 60) * 1e6)
        url = (
            f"http://{VICTORIATRACES_SVC}:10428/select/jaeger/api/traces"
            f"?service={CHATQNA_SERVICE_NAME}"
            f"&start={start_us}&end={end_us}&limit=50"
        )
        raw = _docker_exec(CHATQNA_CONTAINER, f"curl -s '{url}'", timeout=60)
        candidates, selected = _extract_selection(raw, start_s)
        if candidates or selected:
            return candidates, selected
        if time.time() >= deadline:
            return [], []


def build_hash_to_text() -> dict[str, str]:
    """Return {content_hash: full_text} from ArangoDB (dump-tuples mode only)."""
    # content_hash is Python-side (AQL has no such UDF), so fetch text + hash here.
    texts = cursor(f"FOR doc IN {GRAPH_SOURCE} RETURN doc.{TEXT_FIELD}")
    return {content_hash(t): t for t in texts if t}


def score_anchor(entry, cand_hashes, sel_hashes, trace_found: bool) -> dict:
    gold = [c["chunk_key"] for c in entry.get("expected_chunks", [])]
    row = {
        "id": entry["id"],
        "query": entry["query"],
        "trace_found": trace_found,
        "gold": gold,
        "selected": sel_hashes,
        "candidates": cand_hashes,
    }
    if trace_found:
        row.update(
            recall=metrics.recall(gold, sel_hashes),
            precision=metrics.precision(gold, sel_hashes),
            complete_recall=metrics.complete_recall(gold, sel_hashes),
            noise=metrics.noise(gold, sel_hashes),
        )
        if cand_hashes:
            row["retrieval_recall"] = metrics.retrieval_recall(gold, cand_hashes)
    return row


def make_tuple(entry, sel_hashes, hash_to_text, answer) -> dict:
    contexts = [hash_to_text[h] for h in sel_hashes if h in hash_to_text]
    return {
        "id": entry["id"],
        "question": entry["query"],
        "contexts": contexts,
        "answer": answer,
        "reference_answer": entry.get("reference_answer", ""),
    }


def main(mode: str, gold_path: str, out_path: str) -> None:
    with open(gold_path) as fh:
        gold = json.load(fh)
    entries = gold["entries"]
    hash_to_text = build_hash_to_text() if mode == "dump-tuples" else {}

    tuples, rows, missed = [], [], 0
    for entry in entries:
        start, body = drive_query(entry)
        answer = _extract_answer(body)
        cand_hashes, sel_hashes = fetch_selection(start)
        trace_found = bool(cand_hashes or sel_hashes)
        if not trace_found:
            missed += 1
            print(
                f"[{entry['id']}] WARNING: no reranker_selection span — trace missed "
                "(not scored). Check observability / bump TRACE_FETCH_TIMEOUT.",
                file=sys.stderr,
            )
        else:
            print(f"[{entry['id']}] selected={len(sel_hashes)} candidates={len(cand_hashes)}", file=sys.stderr)
        if mode == "dump-tuples":
            tuples.append(make_tuple(entry, sel_hashes, hash_to_text, answer))
        else:
            rows.append(score_anchor(entry, cand_hashes, sel_hashes, trace_found))

    if mode == "dump-tuples":
        with open(out_path, "w") as fh:
            json.dump(tuples, fh, ensure_ascii=False, indent=2)
        print(f"\nWrote {len(tuples)} eval tuples → {out_path}", file=sys.stderr)
        print("Feed to: run_ragas_eval.py eval_tuples.json", file=sys.stderr)
    else:
        scored = [r for r in rows if r.get("trace_found")]
        agg = metrics.aggregate(scored)
        report = {"per_query": rows, "aggregate": agg, "n_missed_traces": missed}
        with open(out_path, "w") as fh:
            json.dump(report, fh, indent=2)
        print(f"\n=== AGGREGATE (n={agg['n']}, missed={missed}) ===", file=sys.stderr)
        for k in ("recall", "precision", "complete_recall", "noise", "retrieval_recall"):
            if k in agg:
                print(f"  {k:20s} {agg[k]:.3f}", file=sys.stderr)
        if missed:
            print(f"  {missed} trace(s) missed and excluded — see per_query[].trace_found", file=sys.stderr)
        print(f"\nReport → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ("anchor", "dump-tuples") else "anchor"
    gold = sys.argv[2] if len(sys.argv) > 2 else "gold_dataset.json"
    default_out = "eval_tuples.json" if mode == "dump-tuples" else "eval_report.json"
    out = sys.argv[3] if len(sys.argv) > 3 else default_out
    main(mode, gold, out)
