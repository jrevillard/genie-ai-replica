# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Shared ArangoDB cursor for the eval scripts (config via env)."""

from __future__ import annotations

import base64
import json
import os
import urllib.parse
import urllib.request

ARANGO_URL = os.getenv("ARANGO_URL", "http://localhost:8529")
ARANGO_DB = os.getenv("ARANGO_DB", "genieai")
ARANGO_USER = os.getenv("ARANGO_USER", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "")


def cursor(
    aql: str,
    bind_vars: dict | None = None,
    *,
    url: str | None = None,
    db: str | None = None,
    user: str | None = None,
    password: str | None = None,
    batch_size: int = 1000,
    timeout: float = 30,
) -> list:
    """Run an AQL query; return ALL rows (follows cursor pagination).

    Raises RuntimeError when the accumulated row count diverges from the
    server-reported `count` — a truncated read must never pass silently
    (the corpus crosses one batch at ~1080 chunks under overlap=300).
    """
    base = (url or ARANGO_URL).rstrip("/")
    database = db or ARANGO_DB
    auth = base64.b64encode(
        f"{user or ARANGO_USER}:{password or ARANGO_PASSWORD}".encode()
    ).decode()
    cursor_url = f"{base}/_db/{urllib.parse.quote(database)}/_api/cursor"
    body: dict = {
        "query": aql,
        "bindVars": bind_vars or {},
        "batchSize": batch_size,
        "count": True,
    }
    rows: list = []
    expected: int | None = None
    last_cid: str | None = None  # outstanding cursor id; DELETE on exit (finding 9)
    last_has_more = False
    try:
        for _ in range(10_000):
            req = urllib.request.Request(
                cursor_url,
                data=json.dumps(body).encode(),
                headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
                method="POST" if expected is None else "PUT",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.load(resp)
            prev_len = len(rows)
            if expected is None:
                expected = payload.get("count")
            rows.extend(payload.get("result", []))
            if payload.get("hasMore") and payload.get("result") is not None and len(rows) == prev_len:
                raise RuntimeError("Arango cursor made no progress (hasMore with empty result)")
            cid = payload.get("id")
            last_cid = cid
            last_has_more = bool(payload.get("hasMore"))
            if not last_has_more or not cid:
                break
            cursor_url = f"{base}/_db/{urllib.parse.quote(database)}/_api/cursor/{urllib.parse.quote(cid)}"
            body = {}  # PUT continuation takes an empty body
        else:
            raise RuntimeError("Arango cursor pagination exceeded 10000 iterations")
        if expected is not None and len(rows) != expected:
            raise RuntimeError(
                f"Arango cursor count mismatch: got {len(rows)} rows, server count {expected}"
            )
        return rows
    finally:
        # Best-effort cursor release — Arango holds cursors in memory until TTL
        # or explicit DELETE. Only DELETE if the last response said hasMore
        # (a naturally-finished cursor was already closed by Arango). Swallow
        # any error on the cleanup itself.
        if last_cid and last_has_more:
            try:
                del_url = f"{base}/_db/{urllib.parse.quote(database)}/_api/cursor/{urllib.parse.quote(last_cid)}"
                del_req = urllib.request.Request(
                    del_url,
                    headers={"Authorization": f"Basic {auth}"},
                    method="DELETE",
                )
                urllib.request.urlopen(del_req, timeout=5).read()
            except Exception:  # noqa: BLE001
                pass


def source_chunks(
    graph_source: str, text_field: str, conn: dict | None = None
) -> list[dict]:
    """All {key, text} rows from the SOURCE collection via the paginated cursor.

    ``conn`` overrides the default connection (keys: ``url``, ``db``, ``user``,
    ``password``); absent keys fall back to the module-level env defaults.
    Returns ``[{"key": "<_key>", "text": "<chunk text>"}, ...]``. The pair
    of dump-tuples / anchor maps in ``run_eval`` are derived from this single
    AQL — text is fetched ONCE and projected per-mode.
    """
    return cursor(
        f"FOR doc IN {graph_source} RETURN {{key: doc._key, text: doc.{text_field}}}",
        **(conn or {}),
    )
