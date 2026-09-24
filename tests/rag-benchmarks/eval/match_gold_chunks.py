#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Fill ``content_hash`` + ``chunk_key`` on a ``gold_dataset.json`` from ArangoDB.

After the corpus is ingested and the gold dataset has ``preview`` text on each
``expected_chunks[]`` entry, this script:

1. Dumps every chunk from the source collection (``_key``, full text).
2. Normalises chunk text + each preview with the SAME normaliser as
   ``chunk_identity.normalize`` (whitespace-collapsed, lowercased) — so the
   preview is the SAME string the chunker produced (modulo punctuation the
   benchmark author dropped) only when it really matches.
3. For each preview, finds every chunk that holds the preview:
   - whole preview is a substring of chunk text (chunk spans the whole
     passage);
   - any 40-char window of the preview sits inside the chunk text (chunk
     holds a slice of the passage — the chunker split the verbatim preview
     across multiple chunks).
   All matching chunks become gold; both halves of a split preview are valid
   gold. Each matched chunk is recorded with its ``_key`` and ``content_hash``.
   If nothing matches, the preview is marked ``match_unresolved``.

Why substring instead of full equality? The benchmark author often paraphrases,
truncates, or strips line breaks from the source passage. Normalisation makes
those collapses invisible, and substring-with-normalisation catches the vast
majority of real matches. Window-based matching additionally handles passages
that span more than one chunk.

Run AFTER the corpus is ingested (chunk _keys exist only post-ingest). Pairs
with ``xlsx_to_gold.py``.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

# Reuse the exact same normaliser the eval uses — drift here silently breaks
# the gold set.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from chunk_identity import content_hash, normalize

_WHITESPACE = re.compile(r"\s+")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--gold-dataset",
        required=True,
        type=Path,
        help="Input gold_dataset.json (will be overwritten in place unless --output is given)",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Write to a new path instead of overwriting the input",
    )
    p.add_argument(
        "--arango-url",
        default=os.getenv("ARANGO_URL", "http://localhost:8529"),
        help="ArangoDB base URL (default: $ARANGO_URL or http://localhost:8529)",
    )
    p.add_argument(
        "--arango-db",
        default=os.getenv("ARANGO_DB", "genieai"),
        help="ArangoDB database name (default: $ARANGO_DB or genieai)",
    )
    p.add_argument(
        "--arango-user",
        default=os.getenv("ARANGO_USER", "root"),
        help="ArangoDB user (default: $ARANGO_USER or root)",
    )
    p.add_argument(
        "--arango-password",
        default=os.getenv("ARANGO_PASSWORD", ""),
        help="ArangoDB password (default: $ARANGO_PASSWORD). Prefer env var to keep this off the CLI.",
    )
    p.add_argument(
        "--graph-source",
        default=os.getenv("GRAPH_SOURCE", "GRAPH_TEST_SOURCE"),
        help="Source collection holding the chunks (default: $GRAPH_SOURCE or GRAPH_TEST_SOURCE). "
        "Override per corpus: e.g. GENIEAI_EL_SALVADOR_SOURCE.",
    )
    p.add_argument(
        "--chunk-text-field",
        default="chunk_text",
        help="Document field carrying the chunk text (default: chunk_text). Match your ingestion schema.",
    )
    p.add_argument(
        "--min-preview-len",
        type=int,
        default=20,
        help="Skip matching previews shorter than this many chars (too noisy; default: %(default)s)",
    )
    p.add_argument(
        "--mode",
        choices=["in-place", "in-place-new", "report-only"],
        default="in-place",
        help="in-place=mutate input JSON and overwrite; in-place-new=write to --output; report-only=print summary, no write (default: %(default)s)",
    )
    return p.parse_args()


def arango_query(
    url: str, db: str, user: str, password: str, aql: str
) -> list[dict[str, Any]]:
    """Run a cursor query and return all rows. Uses Basic auth; ignores TLS (matches .102 self-signed)."""
    endpoint = f"{url.rstrip('/')}/_db/{urllib.parse.quote(db)}/_api/cursor"
    body = json.dumps({"query": aql, "batchSize": 1000}).encode()
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.load(resp)
    if result.get("error"):
        raise RuntimeError(f"AQL error: {result['error']}")
    return result.get("result", [])


def load_chunks(args: argparse.Namespace) -> list[dict[str, Any]]:
    """Dump (key, text) for every document in the source collection."""
    aql = (
        f"FOR doc IN {args.graph_source} "
        f"RETURN {{ key: doc._key, text: doc.{args.chunk_text_field} }}"
    )
    return arango_query(
        args.arango_url, args.arango_db, args.arango_user, args.arango_password, aql
    )


def find_matches(preview: str, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return chunks that contain (or are contained in) the normalised preview.

    Two acceptance paths:
      - Whole preview is a substring of chunk text (chunk spans the whole passage).
      - Any sufficiently long window of the preview sits inside the chunk text
        (chunk holds part of the passage — chunker split the verbatim preview
        across multiple chunks). Both halves are valid gold.
    """
    norm_preview = normalize(preview)
    if not norm_preview:
        return []
    out: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    WIN = 40  # chars; matches the strict-substring mode granularity
    STEP = 20
    for c in chunks:
        norm_text = normalize(c.get("text") or "")
        if not norm_text:
            continue
        if norm_preview in norm_text or norm_text in norm_preview:
            if c["key"] not in seen_keys:
                seen_keys.add(c["key"])
                out.append(c)
            continue
        for off in range(0, max(1, len(norm_preview) - WIN + 1), STEP):
            window = norm_preview[off : off + WIN]
            if len(window) < 12:
                continue
            if window in norm_text:
                if c["key"] not in seen_keys:
                    seen_keys.add(c["key"])
                    out.append(c)
                break
    return out


def main() -> int:
    args = parse_args()
    if not args.gold_dataset.is_file():
        sys.stderr.write(f"ERROR: gold dataset not found: {args.gold_dataset}\n")
        return 2

    payload = json.loads(args.gold_dataset.read_text())
    entries: list[dict[str, Any]] = payload.get("entries", [])
    if not entries:
        sys.stderr.write("ERROR: gold dataset has no entries\n")
        return 2

    sys.stderr.write(
        f"[match] dumping chunks from {args.graph_source!r} on {args.arango_url} ...\n"
    )
    chunks = load_chunks(args)
    sys.stderr.write(f"[match] {len(chunks)} chunks loaded\n")

    stats = {
        "resolved": 0,
        "split_passages": 0,
        "unresolved": 0,
        "skipped_short": 0,
        "total_previews": 0,
    }
    for entry in entries:
        expected = entry.get("expected_chunks", [])
        if not expected:
            continue
        new_expected: list[dict[str, Any]] = []
        for ec_idx, ec in enumerate(expected):
            preview = (ec.get("preview") or "").strip()
            stats["total_previews"] += 1
            if len(preview) < args.min_preview_len:
                stats["skipped_short"] += 1
                new_expected.append(ec)
                continue
            matches = find_matches(preview, chunks)
            if matches:
                # Multi-match = chunker split the verbatim preview across N chunks.
                # All N chunks share a passage_id so the eval can enforce passage-level
                # recall (a passage counts only when ALL its chunks are retrieved).
                passage_id = f"{entry.get('id', 'q')}-p{ec_idx}"
                for idx, m in enumerate(matches):
                    new_expected.append(
                        {
                            **ec,
                            "chunk_key": m["key"],
                            "content_hash": content_hash(m["text"]),
                            "match_status": "resolved_split" if idx > 0 else "resolved",
                            "passage_id": passage_id,
                        }
                    )
                stats["resolved"] += len(matches)
                if len(matches) > 1:
                    stats["split_passages"] += 1
            else:
                new_expected.append({**ec, "match_status": "unresolved"})
                stats["unresolved"] += 1
        entry["expected_chunks"] = new_expected

    payload["match_run"] = {
        "ran_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "graph_source": args.graph_source,
        "stats": stats,
    }

    if args.mode == "report-only":
        sys.stderr.write(f"[report] {json.dumps(stats)}\n")
        return 0

    out_path = args.output or args.gold_dataset
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    sys.stderr.write(
        f"[match] resolved={stats['resolved']} split_passages={stats['split_passages']} "
        f"unresolved={stats['unresolved']} skipped_short={stats['skipped_short']} "
        f"total_previews={stats['total_previews']} -> {out_path}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
