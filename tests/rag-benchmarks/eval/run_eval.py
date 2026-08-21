#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Retrieval eval driver. Two modes, one collection path.

Both modes drive gold queries through chatqna via docker exec (internal service,
NO OIDC — faithful label-filtered retrieval) and pull the selection from the
chatqna.reranker_selection span in VictoriaTraces.

The span emits ``chunk_key`` (the ArangoDB ``_key``), recovered by the retriever
via per-chunk metadata that survives the langchain retriever->chatqna handoff
(langchain mangles ``Document.id`` to a UUID; ``_key`` is carried in
``metadata["chunk_key"]`` and re-read by chatqna's ``text_to_chunk_key`` map).
Matching stays CONTENT-BASED: gold ``expected_chunks[].content_hash`` (sha256 of
normalized text) is the identity, and each span ``_key`` is converted to its
content fingerprint via a ``_key -> content_hash`` map built from the SOURCE
collection — so the gold SURVIVES a corpus re-ingest (same chunk text -> same
hash). Only a chunking-param change (which alters chunk text) invalidates it:
a signal to re-baseline, not a bug.

  --mode anchor       Deterministic: match selected/candidate content hashes
                      against gold. Reproducible, no LLM. recall/precision/
                      complete_recall/noise/retrieval_recall. The report keeps
                      the raw span ``_key``s in ``selected``/``candidates`` and
                      adds the content-hash projections in ``*_hashes``.

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
# Defaults are placeholders — set these for your deployment. CHATQNA_CONTAINER
# has a dynamic Swarm replica suffix, so resolve it live:
#   export CHATQNA_CONTAINER=$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)
# VICTORIATRACES_SVC = <stack>_victoriatraces (hyphenated swarm service name).
# See tests/rag-benchmarks/CLAUDE.md for the full run recipe.
CHATQNA_CONTAINER = os.getenv("CHATQNA_CONTAINER", "chatqna-xeon-backend-server")
VICTORIATRACES_SVC = os.getenv("VICTORIATRACES_SVC", "victoriatraces")
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


def _extract_selection(
    raw: str, start_s: float
) -> tuple[list[str], list[str], list[dict]]:
    """Return (candidate_keys, selected_keys, adaptive_breakdown) for THIS query's trace.

    The keys are ArangoDB ``_key``s (what the reranker_selection span emits);
    they are projected to content hashes later in score_anchor.

    Picks the newest reranker_selection span at/after the query start. Coerces
    JSON-stringified array attrs (VictoriaTraces does this) via _as_list.

    Also harvests ``rag.adaptive_breakdown`` (a JSON-stringified array of
    per-candidate utility/cost terms) from the matching ``reranker.tei_invoke``
    span, so the eval report carries the full adaptive breakdown for offline
    recalibration of CONTEXT_DECAY_FACTOR and the confusion formula.
    """
    data = json.loads(raw or "{}")
    query_start_us = start_s * 1e6
    best = None  # (startTime, candidates, selected)
    breakdown_best_st = -1
    breakdown: list[dict] = []
    for tr in data.get("data", []):
        for sp in tr.get("spans", []):
            op = sp.get("operationName", "")
            st = sp.get("startTime", 0)
            if st < query_start_us - 5_000_000:  # >5s before query — older trace
                continue
            tags = {t["key"]: t.get("value") for t in sp.get("tags", [])}
            if "reranker_selection" in op:
                c = _as_list(tags.get("rag.candidate_chunk_keys"))
                s = _as_list(tags.get("rag.selected_chunk_keys"))
                if best is None or st > best[0]:
                    best = (st, c, s)
            elif op == "reranker.tei_invoke" and "rag.adaptive_breakdown" in tags:
                # newest tei_invoke span carrying a breakdown wins
                if st > breakdown_best_st:
                    breakdown_best_st = st
                    raw_b = tags.get("rag.adaptive_breakdown")
                    try:
                        breakdown = (
                            json.loads(raw_b) if isinstance(raw_b, str) else raw_b or []
                        )
                    except json.JSONDecodeError:
                        breakdown = []
    if best is None:
        return [], [], breakdown
    return best[1], best[2], breakdown


def fetch_selection(start_s: float) -> tuple[list[str], list[str], list[dict]]:
    """Poll VictoriaTraces until the trace is indexed or TRACE_FETCH_TIMEOUT.

    Generous window (1h back/1min forward) — VT's tight-window time filter has
    quirky boundary semantics; the trace is disambiguated by startTime in
    _extract_selection. Indexing lag on a busy VT node can exceed a minute.

    Returns ``(candidates, selected, adaptive_breakdown)``.
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
        candidates, selected, breakdown = _extract_selection(raw, start_s)
        if candidates or selected:
            return candidates, selected, breakdown
        if time.time() >= deadline:
            return [], [], breakdown


def build_hash_to_text() -> dict[str, str]:
    """Return {_key: full_text} from ArangoDB (dump-tuples mode only).

    The reranker_selection span emits ``_key`` (NOT content_hash), so the
    semantic-path context lookup must key on ``_key``. The older content_hash
    keying produced empty contexts once the span switched to ``_key``.
    """
    rows = cursor(
        f"FOR doc IN {GRAPH_SOURCE} RETURN {{key: doc._key, text: doc.{TEXT_FIELD}}}"
    )
    return {r["key"]: r["text"] for r in rows if r.get("text")}


def build_key_to_content_hash() -> dict[str, str]:
    """Return {_key: content_hash} from ArangoDB (anchor mode).

    The reranker_selection span emits the ArangoDB ``_key``, but the gold is
    content-hash-keyed (content-based identity survives re-ingest). Map each
    span ``_key`` to its content fingerprint so matching stays content-based.
    ``content_hash`` is computed Python-side (sha256 of normalized text) — it is
    NOT stored in ArangoDB — so fetch the text and hash it here.
    """
    rows = cursor(
        f"FOR doc IN {GRAPH_SOURCE} RETURN {{key: doc._key, text: doc.{TEXT_FIELD}}}"
    )
    return {r["key"]: content_hash(r["text"]) for r in rows if r.get("text")}


def score_anchor(
    entry,
    cand_keys,
    sel_keys,
    trace_found: bool,
    adaptive_breakdown=None,
    key_to_hash: dict[str, str] | None = None,
) -> dict:
    gold = [c.get("content_hash") for c in entry.get("expected_chunks", [])]
    gold = [g for g in gold if g] or [
        c.get("chunk_key") for c in entry.get("expected_chunks", [])
    ]
    # Project the span's _keys to content hashes for scoring; keep the raw _keys
    # in "gold"/"selected"/"candidates" (the calibrator + CLAUDE.md schema read
    # those as _keys); the content-hash projections live in the *_hashes fields.
    sel = (
        [key_to_hash[h] for h in sel_keys if h in key_to_hash]
        if key_to_hash is not None
        else sel_keys
    )
    cand = (
        [key_to_hash[h] for h in cand_keys if h in key_to_hash]
        if key_to_hash is not None
        else cand_keys
    )
    gold_keys = [
        c.get("chunk_key")
        for c in entry.get("expected_chunks", [])
        if c.get("chunk_key")
    ]
    row = {
        "id": entry["id"],
        "query": entry["query"],
        "trace_found": trace_found,
        "gold": gold_keys,  # raw _keys — calibrator-compatible, matches CLAUDE.md schema
        "selected": sel_keys,  # raw _keys as emitted by the span
        "candidates": cand_keys,
        "gold_hashes": gold,  # content hashes used for scoring
        "selected_hashes": sel,
        "candidate_hashes": cand,
        "adaptive_breakdown": adaptive_breakdown or [],
    }
    if trace_found:
        row.update(
            recall=metrics.recall(gold, sel),
            precision=metrics.precision(gold, sel),
            complete_recall=metrics.complete_recall(gold, sel),
            noise=metrics.noise(gold, sel),
        )
        if cand:
            row["retrieval_recall"] = metrics.retrieval_recall(gold, cand)
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
    key_to_hash = build_key_to_content_hash() if mode == "anchor" else {}

    tuples, rows, missed, unmapped = [], [], 0, 0
    for entry in entries:
        start, body = drive_query(entry)
        answer = _extract_answer(body)
        cand_keys, sel_keys, adaptive_breakdown = fetch_selection(start)
        trace_found = bool(cand_keys or sel_keys)
        if mode == "anchor":
            # A span _key with no content-hash mapping (wrong/empty GRAPH_SOURCE,
            # stale trace) would silently score as a miss — surface the count so
            # the capture driver can refuse a false zero baseline. An EMPTY map
            # (falsy) makes every key unmapped — exactly the failure to catch.
            unmapped += sum(1 for k in sel_keys + cand_keys if k not in key_to_hash)
        if not trace_found:
            missed += 1
            print(
                f"[{entry['id']}] WARNING: no reranker_selection span — trace missed "
                "(not scored). Check observability / bump TRACE_FETCH_TIMEOUT.",
                file=sys.stderr,
            )
        else:
            print(
                f"[{entry['id']}] selected={len(sel_keys)} candidates={len(cand_keys)}",
                file=sys.stderr,
            )
        if mode == "dump-tuples":
            tuples.append(make_tuple(entry, sel_keys, hash_to_text, answer))
        else:
            rows.append(
                score_anchor(
                    entry,
                    cand_keys,
                    sel_keys,
                    trace_found,
                    adaptive_breakdown,
                    key_to_hash,
                )
            )

    if mode == "dump-tuples":
        with open(out_path, "w") as fh:
            json.dump(tuples, fh, ensure_ascii=False, indent=2)
        print(f"\nWrote {len(tuples)} eval tuples → {out_path}", file=sys.stderr)
        print("Feed to: run_ragas_eval.py eval_tuples.json", file=sys.stderr)
    else:
        scored = [r for r in rows if r.get("trace_found")]
        agg = metrics.aggregate(scored)
        report = {
            "per_query": rows,
            "aggregate": agg,
            "n_missed_traces": missed,
            "n_unmapped_chunk_keys": unmapped,
        }
        with open(out_path, "w") as fh:
            json.dump(report, fh, indent=2)
        print(f"\n=== AGGREGATE (n={agg['n']}, missed={missed}) ===", file=sys.stderr)
        for k in (
            "recall",
            "precision",
            "complete_recall",
            "noise",
            "retrieval_recall",
        ):
            if k in agg:
                print(f"  {k:20s} {agg[k]:.3f}", file=sys.stderr)
        if missed:
            print(
                f"  {missed} trace(s) missed and excluded — see per_query[].trace_found",
                file=sys.stderr,
            )
        print(f"\nReport → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    mode = (
        sys.argv[1]
        if len(sys.argv) > 1 and sys.argv[1] in ("anchor", "dump-tuples")
        else "anchor"
    )
    gold = sys.argv[2] if len(sys.argv) > 2 else "gold_dataset.json"
    default_out = "eval_tuples.json" if mode == "dump-tuples" else "eval_report.json"
    out = sys.argv[3] if len(sys.argv) > 3 else default_out
    main(mode, gold, out)
