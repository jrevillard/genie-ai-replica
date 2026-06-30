#!/usr/bin/env python3
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Dump every chunk _key + text preview from ArangoDB for gold annotation.

Run on a swarm node (or via SSH + base64 pattern, see
.claude/rules/DEBUGGING-TRACING.md §5). Produces chunks_registry.json:

    [{"key": "chunk_123", "preview": "First 200 chars...", "labels": [...]}, ...]

Browse this file to pick the gold_chunk_keys for each query in gold_dataset.json.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import urllib.parse
import urllib.request

GRAPH_SOURCE = os.getenv("GRAPH_SOURCE", "genieai_graph_SOURCE")
ARANGO_URL = os.getenv("ARANGO_URL", "http://localhost:8529")
ARANGO_DB = os.getenv("ARANGO_DB", "genieai")
ARANGO_USER = os.getenv("ARANGO_USER", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "")
TEXT_FIELD = os.getenv("ARANGO_TEXT_FIELD", "text")
PREVIEW_LEN = 200


def _cursor(aql: str, bind_vars: dict | None = None) -> list:
    url = f"{ARANGO_URL.rstrip('/')}/_db/{urllib.parse.quote(ARANGO_DB)}/_api/cursor"
    auth = base64.b64encode(f"{ARANGO_USER}:{ARANGO_PASSWORD}".encode()).decode()
    body = json.dumps({"query": aql, "bindVars": bind_vars or {}}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp).get("result", [])


def main(out_path: str = "chunks_registry.json") -> None:
    rows = _cursor(
        f"""
        FOR doc IN {GRAPH_SOURCE}
            SORT doc._key
            RETURN {{
                "key": doc._key,
                "preview": SUBSTRING(doc.{TEXT_FIELD}, 0, {PREVIEW_LEN}),
                "labels": doc.chunk_labels || []
            }}
        """
    )
    with open(out_path, "w") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {len(rows)} chunks → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "chunks_registry.json")
