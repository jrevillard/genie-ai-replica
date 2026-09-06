#!/usr/bin/env python3
"""
inspect_retrieval.py — Show chunks retrieved for the last (or a given) query.

Connects directly to ArangoDB + TEI to reproduce the full retrieval pipeline
(vector search → BM25 rerank) and display every chunk with all scores and metadata.

Usage:
    python scripts/inspect_retrieval.py                        # replay last logged query
    python scripts/inspect_retrieval.py "my query text"        # run a custom query
    python scripts/inspect_retrieval.py --full "my query text" # no text truncation
    python scripts/inspect_retrieval.py --k 10 "my query text" # limit to top-k chunks

Requires: requests, python-arango  (pip install requests python-arango)
"""

import sys
import re
import json
import subprocess
import argparse

try:
    import requests
    from arango import ArangoClient
except ImportError:
    sys.exit(
        "Missing dependencies.\n"
        "Run:  pip install requests python-arango"
    )

# ── Connection config — overridable via env vars ────────────────────────────────
import os as _os
ARANGO_URL      = _os.getenv("INSPECT_ARANGO_URL",  "http://localhost:8529")
ARANGO_USER     = _os.getenv("ARANGO_USERNAME",     "root")
ARANGO_PASSWORD = _os.getenv("ARANGO_PASSWORD",     "test")
ARANGO_DB       = _os.getenv("ARANGO_DB_NAME",      "genie-ai")
GRAPH_NAME      = _os.getenv("ARANGO_GRAPH_NAME",   "GRAPH_TEST")
COLLECTION      = f"{GRAPH_NAME}_SOURCE"

TEI_URL         = _os.getenv("INSPECT_TEI_URL",     "http://localhost:7000")
EMBED_URL       = _os.getenv("INSPECT_EMBED_URL",   "http://localhost:6000/v1/embeddings")
RETRIEVER_CONT  = _os.getenv("RETRIEVER_CONTAINER", "genie-ai-retriever-arango")

# ── Retrieval parameters ────────────────────────────────────────────────────────
DEFAULT_K               = 20
DEFAULT_SCORE_THRESHOLD = 0.35
CHUNK_PREVIEW           = 400   # chars; --full disables


# ─────────────────────────────────────────────────────────────────────────────
# Step 0: resolve query
# ─────────────────────────────────────────────────────────────────────────────

def get_last_query_from_logs() -> str:
    """Extract the last query text from the retriever container logs."""
    try:
        result = subprocess.run(
            ["docker", "logs", "--tail", "3000", RETRIEVER_CONT],
            capture_output=True, text=True, timeout=20
        )
        log_text = result.stdout + result.stderr
    except Exception as e:
        sys.exit(f"Could not read Docker logs: {e}")

    pattern = r"Retriever Input Dict:.*?['\"]text['\"]\s*:\s*['\"](.+?)['\"]"
    matches = re.findall(pattern, log_text)

    if not matches:
        sys.exit(
            "No queries found in retriever logs.\n"
            "Send a chat message first, or pass your query as an argument:\n"
            f"  python {sys.argv[0]} \"your question here\""
        )

    query = matches[-1]
    print(f"\n{'─'*70}")
    print(f"  Last query from logs: \"{query}\"")
    print(f"{'─'*70}\n")
    return query


# ─────────────────────────────────────────────────────────────────────────────
# Step 1: embed the query
# ─────────────────────────────────────────────────────────────────────────────

def embed_query(query: str) -> list:
    """Get embedding vector. Tries TEI directly, falls back to OPEA wrapper."""
    # TEI /embed endpoint (list of strings → list of vectors)
    try:
        resp = requests.post(
            f"{TEI_URL}/embed",
            json={"inputs": query},
            timeout=30
        )
        resp.raise_for_status()
        data = resp.json()
        # TEI returns [[float, ...]]
        if isinstance(data, list) and data and isinstance(data[0], list):
            return data[0]
        if isinstance(data, list) and data and isinstance(data[0], float):
            return data
    except Exception:
        pass

    # Fallback: OPEA embedding wrapper
    try:
        resp = requests.post(EMBED_URL, json={"input": query}, timeout=30)
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]
    except Exception as e:
        sys.exit(f"Failed to get embedding from both TEI and OPEA wrapper: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 2: vector search in ArangoDB
# ─────────────────────────────────────────────────────────────────────────────

def vector_search(db, query_embedding: list, k: int, threshold: float) -> list:
    """
    Cosine similarity search over GRAPH_TEST_SOURCE.
    Returns list of dicts: {text, score, labels, headings, page_numbers, file_path, file_id, chunk_index}
    """
    aql = f"""
        FOR doc IN {COLLECTION}
            FILTER doc.embedding != null AND LENGTH(doc.embedding) > 0
            LET score = COSINE_SIMILARITY(doc.embedding, @query_embedding)
            FILTER score >= @threshold
            SORT score DESC
            LIMIT @k
            RETURN {{
                text:          doc.text,
                score:         score,
                labels:        doc.chunk_labels,
                headings:      doc.headings,
                page_numbers:  doc.page_numbers,
                file_path:     doc.file_path,
                file_id:       doc.file_id,
                chunk_index:   doc.chunk_index
            }}
    """
    try:
        cursor = db.aql.execute(
            aql,
            bind_vars={
                "query_embedding": query_embedding,
                "threshold":       threshold,
                "k":               k,
            }
        )
        return list(cursor)
    except Exception as e:
        sys.exit(f"AQL vector search failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 3: BM25 rerank (mirrors genieai_retriever_arangodb.py)
# ─────────────────────────────────────────────────────────────────────────────

def bm25_rerank(query: str, results: list) -> list:
    """Add bm25_score and combined_score, then sort by combined_score desc."""
    if len(results) <= 1:
        for r in results:
            r["bm25_score"]     = None
            r["combined_score"] = r["score"]
        return results

    try:
        from rank_bm25 import BM25Okapi
    except ImportError:
        print("  [warn] rank_bm25 not installed — skipping BM25 rerank. pip install rank-bm25")
        for r in results:
            r["bm25_score"]     = None
            r["combined_score"] = r["score"]
        return results

    tokenize = lambda text: re.findall(r"\b\w+\b", text.lower())
    corpus    = [r["text"] or "" for r in results]
    bm25      = BM25Okapi([tokenize(d) for d in corpus])
    scores    = bm25.get_scores(tokenize(query))

    bm25_max  = max(scores) if max(scores) > 0 else 1.0
    norm      = [s / bm25_max for s in scores]

    for i, r in enumerate(results):
        r["bm25_score"]     = norm[i]
        r["combined_score"] = r["score"] + norm[i]

    results.sort(key=lambda r: r["combined_score"], reverse=True)
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Display
# ─────────────────────────────────────────────────────────────────────────────

def fmt(val, decimals=4) -> str:
    if val is None:
        return "  n/a  "
    return f"{float(val):.{decimals}f}"


def print_chunk(rank: int, r: dict, full: bool):
    text     = r.get("text") or ""
    labels   = r.get("labels") or []
    headings = r.get("headings") or []
    pages    = r.get("page_numbers") or []
    fpath    = r.get("file_path") or ""
    fid      = r.get("file_id") or ""
    cidx     = r.get("chunk_index", "?")

    print(f"\n{'━'*70}")
    print(
        f"  CHUNK #{rank:<3}  "
        f"combined={fmt(r.get('combined_score'))}  "
        f"vector={fmt(r.get('score'))}  "
        f"bm25={fmt(r.get('bm25_score'))}"
    )
    print(f"{'━'*70}")

    if headings:
        print(f"  Headings   : {' > '.join(headings)}")
    if pages:
        print(f"  Pages      : {pages}")
    if labels:
        print(f"  Labels     : {labels}")
    if fpath or fid:
        print(f"  File       : {fpath}  (id={fid}, chunk #{cidx})")

    print(f"\n  {'─'*66}")
    body = text if (full or len(text) <= CHUNK_PREVIEW) else text[:CHUNK_PREVIEW] + f"… [+{len(text)-CHUNK_PREVIEW} chars]"
    for line in body.splitlines():
        print(f"  {line}")
    print()


def print_summary(query: str, results: list):
    print(f"\n{'═'*70}")
    print(f"  {len(results)} chunks for: \"{query}\"")
    print(f"{'═'*70}")
    print(f"  {'#':<4} {'Combined':>10} {'Vector':>10} {'BM25':>10}  Labels")
    print(f"  {'─'*68}")
    for i, r in enumerate(results, 1):
        labels_str = (", ".join(r.get("labels") or []))[:32] or "(none)"
        print(
            f"  {i:<4} "
            f"{fmt(r.get('combined_score')):>10} "
            f"{fmt(r.get('score')):>10} "
            f"{fmt(r.get('bm25_score')):>10}  "
            f"{labels_str}"
        )
    print()


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("query", nargs="?", default=None,
                        help="Query text. Omit to replay the last logged query.")
    parser.add_argument("--full", action="store_true",
                        help="Print full chunk text without truncation.")
    parser.add_argument("--k", type=int, default=DEFAULT_K,
                        help=f"Max chunks to retrieve (default: {DEFAULT_K}).")
    parser.add_argument("--threshold", type=float, default=DEFAULT_SCORE_THRESHOLD,
                        help=f"Min cosine score (default: {DEFAULT_SCORE_THRESHOLD}).")
    args = parser.parse_args()

    query = args.query or get_last_query_from_logs()

    # Connect to ArangoDB
    print("[1/4] Connecting to ArangoDB …")
    try:
        client = ArangoClient(hosts=ARANGO_URL)
        db = client.db(ARANGO_DB, username=ARANGO_USER, password=ARANGO_PASSWORD)
        count = db.collection(COLLECTION).count()
        print(f"      {COLLECTION}: {count:,} documents")
    except Exception as e:
        sys.exit(f"ArangoDB connection failed: {e}")

    print("[2/4] Embedding query …")
    embedding = embed_query(query)
    print(f"      Vector dimension: {len(embedding)}")

    print(f"[3/4] Running vector search (k={args.k}, threshold={args.threshold}) …")
    results = vector_search(db, embedding, args.k, args.threshold)
    print(f"      {len(results)} chunk(s) above threshold")

    if not results:
        print(
            "\n  No chunks returned.\n"
            f"  Try:  python {sys.argv[0]} --threshold 0.2 \"{query}\"\n"
            "  Or send another message through the app to trigger a retrieval."
        )
        return

    print("[4/4] BM25 reranking …")
    results = bm25_rerank(query, results)

    for i, r in enumerate(results, 1):
        print_chunk(i, r, full=args.full)

    print_summary(query, results)


if __name__ == "__main__":
    main()
