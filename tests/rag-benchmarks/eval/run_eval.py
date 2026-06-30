#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Retrieval eval driver. Two modes, one collection path.

Both modes drive gold queries through chatqna via docker exec (internal service,
NO OIDC — faithful label-filtered retrieval) and pull the selection from the
chatqna.reranker_selection span in VictoriaTraces.

  --mode anchor       Deterministic: match selected/candidate chunk CONTENT
                      HASHES against gold_dataset.json expected_chunks.
                      Reproducible, no LLM. recall/precision/complete_recall/noise.
                      Survives re-ingestion (matches on content, not UUID _key).

  --mode dump-tuples  Collect (question, contexts, answer, reference_answer) per
                      query → eval_tuples.json. Feed to run_ragas_eval.py (an
                      external LLM judge) for semantic faithfulness/relevancy.

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
CHATQNA_SERVICE_NAME = os.getenv("CHATQNA_SERVICE_NAME", "GENIE.AI_CHATQNA")
GRAPH_SOURCE = os.getenv("GRAPH_SOURCE", "genieai_graph_SOURCE")
TEXT_FIELD = os.getenv("ARANGO_TEXT_FIELD", "text")
TRACE_FLUSH_WAIT = float(os.getenv("TRACE_FLUSH_WAIT", "3"))
TRACE_LOOKUP_SPAN_S = float(os.getenv("TRACE_LOOKUP_SPAN_S", "20"))


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


def drive_query(entry: dict) -> tuple[float, str]:
    """POST the gold query to chatqna. Returns (start_time, response_body)."""
    payload = {
        "messages": [{"role": "user", "content": entry["query"]}],
        "context": {
            "categoryLabel": entry.get("categoryLabel", ""),
            "serviceLabels": entry.get("serviceLabels", []),
            "language": entry.get("language", "en"),
        },
        "stream": False,
    }
    payload_json = json.dumps(payload).replace("'", "'\\''")
    start = time.time()
    cmd = (
        f"curl -s -m {int(TRACE_LOOKUP_SPAN_S * 3)} "
        f"-X POST {CHATQNA_URL} -H 'Content-Type: application/json' -d '{payload_json}'"
    )
    body = _docker_exec(CHATQNA_CONTAINER, cmd, timeout=TRACE_LOOKUP_SPAN_S * 4)
    return start, body


def _extract_answer(body: str) -> str:
    """Best-effort answer text from a chatqna sync response."""
    if not body:
        return ""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return body.strip()
    # OPEA sync response shapes seen in the wild.
    if isinstance(data, dict):
        for key in ("text", "answer", "generated_text"):
            if data.get(key):
                return data[key]
        return json.dumps(data)
    return str(data)


def fetch_selection(start_s: float) -> tuple[list[str], list[str]]:
    """Find candidate/selected chunk _keys from the reranker_selection span."""
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
    candidates, selected = [], []
    for tr in data.get("data", []):
        for sp in tr.get("spans", []):
            tags = {t["key"]: t.get("value") for t in sp.get("tags", [])}
            c = tags.get("rag.candidate_chunk_ids")
            s = tags.get("rag.selected_chunk_ids")
            if isinstance(c, list):
                candidates = c
            if isinstance(s, list):
                selected = s
    return candidates, selected


def build_key_maps(need_text: bool = False) -> tuple[dict[str, str], dict[str, str]]:
    """Return ({_key: content_hash}, {_key: full_text}) from ArangoDB.

    ``key_to_text`` holds full chunk text for every chunk — only build it when
    actually needed (dump-tuples mode), to avoid pulling the whole corpus into
    memory for an anchor-only run.
    """
    rows = cursor(
        f"""
        FOR doc IN {GRAPH_SOURCE}
            RETURN {{"key": doc._key, "text": doc.{TEXT_FIELD}}}
        """
    )
    key_to_hash = {r["key"]: content_hash(r.get("text", "")) for r in rows}
    key_to_text = {r["key"]: r.get("text", "") for r in rows} if need_text else {}
    return key_to_hash, key_to_text


def score_anchor(entry, selected_keys, candidate_keys, key_to_hash, trace_found: bool) -> dict:
    gold = [c["content_hash"] for c in entry.get("expected_chunks", [])]
    selected = [key_to_hash[k] for k in selected_keys if k in key_to_hash]
    candidates = [key_to_hash[k] for k in candidate_keys if k in key_to_hash]
    row = {
        "id": entry["id"],
        "query": entry["query"],
        "trace_found": trace_found,
        "gold": gold,
        "selected": selected,
        "candidates": candidates,
    }
    if trace_found:
        # Only score when we actually saw a selection span — otherwise selected=[]
        # would falsely read as total recall failure (or vacuous 1.0 on empty gold).
        row.update(
            recall=metrics.recall(gold, selected),
            precision=metrics.precision(gold, selected),
            complete_recall=metrics.complete_recall(gold, selected),
            noise=metrics.noise(gold, selected),
        )
        if candidates:
            row["retrieval_recall"] = metrics.retrieval_recall(gold, candidates)
    return row


def make_tuple(entry, selected_keys, key_to_text, answer) -> dict:
    contexts = [key_to_text[k] for k in selected_keys if k in key_to_text]
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
    key_to_hash, key_to_text = build_key_maps(need_text=(mode == "dump-tuples"))

    tuples, rows, missed = [], [], 0
    for entry in entries:
        start, body = drive_query(entry)
        answer = _extract_answer(body)
        candidate_keys, selected_keys = fetch_selection(start)
        trace_found = bool(candidate_keys or selected_keys)
        if not trace_found:
            missed += 1
            print(
                f"[{entry['id']}] WARNING: no reranker_selection span in window — "
                "trace missed (not scored). Check observability / bump TRACE_FLUSH_WAIT.",
                file=sys.stderr,
            )
        else:
            print(f"[{entry['id']}] selected={len(selected_keys)} candidates={len(candidate_keys)}", file=sys.stderr)
        if mode == "dump-tuples":
            tuples.append(make_tuple(entry, selected_keys, key_to_text, answer))
        else:  # anchor
            rows.append(score_anchor(entry, selected_keys, candidate_keys, key_to_hash, trace_found))

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
    out = sys.argv[3] if len(sys.argv) > 3 else ("eval_tuples.json" if mode == "dump-tuples" else "eval_report.json")
    main(mode, gold, out)
