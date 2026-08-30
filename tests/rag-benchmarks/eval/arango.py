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


def cursor(aql: str, bind_vars: dict | None = None) -> list:
    """Run an AQL query; return the result rows."""
    url = f"{ARANGO_URL.rstrip('/')}/_db/{urllib.parse.quote(ARANGO_DB)}/_api/cursor"
    auth = base64.b64encode(f"{ARANGO_USER}:{ARANGO_PASSWORD}".encode()).decode()
    body = json.dumps({"query": aql, "bindVars": bind_vars or {}}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp).get("result", [])
