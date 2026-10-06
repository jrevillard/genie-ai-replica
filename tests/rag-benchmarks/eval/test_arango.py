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
        calls.append(req.full_url)
        return _FakeResp(pages.pop(0))

    monkeypatch.setattr(arango.urllib.request, "urlopen", fake_urlopen)
    rows = arango.cursor("FOR x IN c RETURN x")
    assert len(rows) == 1002
    assert calls[1].endswith("/_api/cursor/c1")  # PUT continuation


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
