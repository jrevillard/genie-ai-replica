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


def main(out_path: str = "chunks_registry.json") -> None:
    # Fetch FULL text — content_hash is full-text (not prefix), so we need the
    # whole chunk to compute the same hash the chatqna span emits.
    rows = cursor(
        f"""
        FOR doc IN {GRAPH_SOURCE}
            SORT doc._key
            RETURN {{
                "key": doc._key,
                "text": doc.{TEXT_FIELD},
                "labels": doc.chunk_labels || []
            }}
        """
    )
    if not rows and TEXT_FIELD != _FALLBACK_TEXT_FIELD:
        # Legacy deployments (CONTEXTUAL_RETRIEVAL_ENABLED=false) store the
        # chunk body under `text` instead of `chunk_text` — retry once with
        # the legacy field so the operator does not need to set
        # ARANGO_TEXT_FIELD explicitly.
        sys.stderr.write(
            "WARNING: empty on chunk_text — set ARANGO_TEXT_FIELD=text for "
            "CONTEXTUAL_RETRIEVAL_ENABLED=false deployments\n"
        )
        rows = cursor(
            f"""
            FOR doc IN {GRAPH_SOURCE}
                SORT doc._key
                RETURN {{
                    "key": doc._key,
                    "text": doc.{_FALLBACK_TEXT_FIELD},
                    "labels": doc.chunk_labels || []
                }}
            """
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
    with open(out_path, "w") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {len(out)} chunks → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "chunks_registry.json")
