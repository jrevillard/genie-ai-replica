#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Dump every chunk _key + content_hash + preview from ArangoDB for gold annotation.

Run on a swarm node (or via SSH + base64 pattern, see
.claude/rules/DEBUGGING-TRACING.md §5). Produces chunks_registry.json:

    [{"key": "<uuid>", "content_hash": "a1b2...", "preview": "First 200 chars...",
      "labels": [...]}, ...]

Browse this file to pick the ``content_hash`` values for each query's expected
chunks in gold_dataset.json. The hash (not the ``_key``) is what the eval
matches on — it survives re-ingestion (UUIDs churn, content doesn't).
"""

from __future__ import annotations

import json
import os
import sys

from arango import cursor
from chunk_identity import content_hash

GRAPH_SOURCE = os.getenv("GRAPH_SOURCE", "GRAPH_TEST_SOURCE")
TEXT_FIELD = os.getenv("ARANGO_TEXT_FIELD", "chunk_text")
_FALLBACK_TEXT_FIELD = "text"


def _query_rows(text_field: str) -> list[dict]:
    """Run the dump AQL projecting the given text field. Returns one row per
    chunk in the source collection (always one row per doc — a missing field
    surfaces as ``text: None``, NOT as a missing row)."""
    return cursor(
        f"""
        FOR doc IN {GRAPH_SOURCE}
            SORT doc._key
            RETURN {{
                "key": doc._key,
                "text": doc.{text_field},
                "labels": doc.chunk_labels || []
            }}
        """
    )


def main(out_path: str = "chunks_registry.json") -> None:
    # Fetch FULL text — content_hash is full-text (not prefix), so we need the
    # whole chunk to compute the same hash the chatqna span emits.
    rows = _query_rows(TEXT_FIELD)
    # Row-level fallback (vs. the old collection-level check): the old
    # `if not rows` guard never fired because the AQL above always returns
    # one row per document — missing-field docs came back as ``text: null``
    # and the rows list was non-empty. Every row's content_hash then
    # collapsed to the empty-string hash and the gold set went silent-zero.
    # Detect the symptom per-row: if EVERY row's text is null/empty the
    # field name is wrong (legacy ``text`` vs current ``chunk_text``).
    if rows and not any((r.get("text") or "") for r in rows):
        if TEXT_FIELD != _FALLBACK_TEXT_FIELD:
            sys.stderr.write(
                "WARNING: primary field "
                f"{TEXT_FIELD!r} returned all-null/empty rows — retrying with "
                f"legacy field {_FALLBACK_TEXT_FIELD!r}. For "
                "CONTEXTUAL_RETRIEVAL_ENABLED=false deployments, set "
                "ARANGO_TEXT_FIELD=text explicitly to skip this probe.\n"
            )
            rows = _query_rows(_FALLBACK_TEXT_FIELD)
    null_text_count = sum(1 for r in rows if not (r.get("text") or ""))
    if null_text_count:
        sys.stderr.write(
            f"WARNING: {null_text_count}/{len(rows)} rows have null/empty text; "
            "their content_hash collapses to the empty-string fingerprint and "
            "they will be silently-zeroed in the gold set. Check the field "
            "name (ARANGO_TEXT_FIELD) and the corpus ingestion log.\n"
        )
    out = [
        {
            "key": r["key"],
            "content_hash": content_hash(r.get("text", "")),
            "preview": (r.get("text") or "")[:200],
            "labels": r.get("labels", []),
        }
        for r in rows
    ]
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {len(out)} chunks → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "chunks_registry.json")
