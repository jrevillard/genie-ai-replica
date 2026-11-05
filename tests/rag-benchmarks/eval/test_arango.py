# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for ArangoDB cursor pagination and count assertion."""

import json
import arango


class _FakeResp:
    def __init__(self, payload):
        self._p = payload

    def read(self):
        return json.dumps(self._p).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_cursor_follows_pagination(monkeypatch):
    pages = [
        {"result": [{"key": f"k{i}"} for i in range(1000)], "hasMore": True, "id": "c1", "count": 1002},
        {"result": [{"key": "k1000"}, {"key": "k1001"}], "hasMore": False, "count": 1002},
    ]
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append((req.full_url, req.get_method(), timeout))
        return _FakeResp(pages.pop(0))

    monkeypatch.setattr(arango.urllib.request, "urlopen", fake_urlopen)
    rows = arango.cursor("FOR x IN c RETURN x")
    assert len(rows) == 1002
    assert calls[0][1] == "POST"
    assert calls[1][1] == "PUT"
    assert calls[0][2] == 30
    assert calls[1][2] == 30
    assert calls[1][0].endswith("/_api/cursor/c1")  # PUT continuation


def test_cursor_count_mismatch_raises(monkeypatch):
    p = {"result": [{"key": "k"}], "hasMore": False, "count": 5}
    monkeypatch.setattr(
        arango.urllib.request, "urlopen", lambda req, timeout=None: _FakeResp(p)
    )
    try:
        arango.cursor("FOR x IN c RETURN x")
        assert False
    except RuntimeError as e:
        assert "mismatch" in str(e)


def test_cursor_empty_progress_raises(monkeypatch):
    pages = [
        {"result": [], "hasMore": True, "id": "c1", "count": 10},
        {"result": [{"key": "k0"}], "hasMore": False, "count": 10},
    ]
    def fake_urlopen(req, timeout=None):
        return _FakeResp(pages.pop(0))
    monkeypatch.setattr(arango.urllib.request, "urlopen", fake_urlopen)
    try:
        arango.cursor("FOR x IN c RETURN x")
        assert False
    except RuntimeError as e:
        assert "no progress" in str(e)


def test_cursor_error_payload_raises(monkeypatch):
    # A failing query comes back as {"error": true, "errorNum": ...} with NO
    # `result` field. Reading `.result` off it would silently yield [] —
    # indistinguishable from an empty collection (#1079).
    p = {"error": True, "errorNum": 1203, "errorMessage": "collection or view not found: OKF_solar"}
    monkeypatch.setattr(arango.urllib.request, "urlopen", lambda req, timeout=None: _FakeResp(p))
    try:
        arango.cursor("FOR x IN c RETURN x")
        assert False
    except RuntimeError as e:
        assert "1203" in str(e)
        assert "OKF_solar" in str(e)


def test_source_chunks_quotes_hyphenated_collection(monkeypatch):
    # GRAPH_SOURCE is stack-derived (GRAPH_<stack-prefix>_SOURCE) and OKF
    # graph names carry the bundle slug — both routinely contain hyphens,
    # which AQL parses as subtraction unless the identifier is backticked.
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["body"] = json.loads(req.data.decode())
        return _FakeResp({"result": [], "hasMore": False})

    monkeypatch.setattr(arango.urllib.request, "urlopen", fake_urlopen)
    arango.source_chunks("GRAPH_genieai-el-salvador_SOURCE", "chunk_text")
    assert "FOR doc IN `GRAPH_genieai-el-salvador_SOURCE`" in captured["body"]["query"]


def test_quote_collection_raises_on_embedded_backtick():
    assert arango.quote_collection("OKF_solar-system_v1_SOURCE") == "`OKF_solar-system_v1_SOURCE`"
    try:
        arango.quote_collection("OKF_x`y_SOURCE")
        assert False
    except ValueError as e:
        assert "backtick" in str(e)
