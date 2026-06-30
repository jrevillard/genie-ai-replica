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

GRAPH_SOURCE = os.getenv("GRAPH_SOURCE", "genieai_graph_SOURCE")
TEXT_FIELD = os.getenv("ARANGO_TEXT_FIELD", "text")
# Fetch enough head to compute the content_hash (prefix-based) + a readable preview.
FETCH_LEN = 250


def main(out_path: str = "chunks_registry.json") -> None:
    rows = cursor(
        f"""
        FOR doc IN {GRAPH_SOURCE}
            SORT doc._key
            RETURN {{
                "key": doc._key,
                "text_head": SUBSTRING(doc.{TEXT_FIELD}, 0, {FETCH_LEN}),
                "labels": doc.chunk_labels || []
            }}
        """
    )
    out = [
        {
            "key": r["key"],
            "content_hash": content_hash(r.get("text_head", "")),
            "preview": (r.get("text_head") or "")[:200],
            "labels": r.get("labels", []),
        }
        for r in rows
    ]
    with open(out_path, "w") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {len(out)} chunks → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "chunks_registry.json")
