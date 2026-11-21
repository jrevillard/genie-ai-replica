# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The legacy chunk adapter (story 1.7): the corpus text of one legacy file.

The chunks of the legacy graph live in ``{graph_name}_SOURCE``; the text
rides the ``text`` field (V02 §4). The adapter reads them with one
bind-variable AQL — the collection name itself is bound, never interpolated
(okf-011: no caller-supplied text reaches an AQL string) — and joins the
texts into the content a read returns, honouring the caller's result budget
with ``truncated``.
"""

import asyncio
import inspect
from pathlib import Path

import pytest
from arango.aql import AQL

from capabilities.adapters.chunks import LegacyChunkAdapter


class FakeDb:
    """The real ``StandardDatabase`` surface, honest about its traps.

    AQL is reachable ONLY through ``db.aql.execute`` — the fake exposes no
    bare ``execute``, so a wrong-receiver call fails loudly here. The
    ``aql.execute`` signature mirrors the real ``AQL.execute`` parameter
    order (``query, count, batch_size, ttl, bind_vars``), so a positional
    bind dict binds to ``count`` exactly as it would against the real
    driver and the bind-var assertions go red — the fake cannot make a
    positional call look correct. ``test_the_fakes_signature_tracks_the_
    real_aql_api`` pins that agreement.
    """

    def __init__(self, rows):
        self.aql = _Aql(rows)

    @property
    def queries(self):
        return self.aql.queries


class _Aql:
    def __init__(self, rows):
        self._rows = rows
        self.queries = []

    def execute(self, query, count=False, batch_size=None, ttl=None, bind_vars=None, **_):
        self.queries.append({"query": query, "bind_vars": bind_vars})
        return self._rows


def adapter(rows):
    seen = {}

    def factory():
        seen["db"] = FakeDb(rows)
        return seen["db"]

    return LegacyChunkAdapter(db_factory=factory), seen


def test_the_fakes_signature_tracks_the_real_aql_api():
    """The fake's ``aql.execute`` must keep the real ``AQL.execute``
    parameter order — in python-arango 8.3.7 the second parameter is
    ``count`` and ``bind_vars`` is the fifth, so a positional bind dict
    binds to ``count`` against the REAL driver (the payload ships no
    ``bindVars`` at all). A fake whose shape drifts from that order would
    silently accept a positional dict as ``bind_vars`` and let the
    production defect class stay green."""
    real = list(inspect.signature(AQL.execute).parameters)[1:6]
    fake = list(inspect.signature(_Aql.execute).parameters)[1:6]
    assert fake == ["query", "count", "batch_size", "ttl", "bind_vars"]
    assert real[:1] == ["query"] and "bind_vars" in real
    assert real.index("bind_vars") > 1  # a positional 2nd arg is NOT bind_vars


def test_reads_the_graphs_source_collection_with_bound_variables():
    reader, seen = adapter([{"text": "alpha"}, {"text": "beta"}])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10))
    assert (content, truncated) == ("alpha\n\nbeta", False)
    query = seen["db"].queries[0]["query"]
    bind_vars = seen["db"].queries[0]["bind_vars"]
    assert "@collection" in query and "doc.file_id == @file_id" in query
    assert bind_vars["@collection"] == "GRAPH_SOURCE"
    assert bind_vars["file_id"] == "42"
    # no caller-supplied value is interpolated into the AQL text
    assert "42" not in query


def test_missing_or_null_text_row_is_tolerated():
    """A row whose text is absent rides the AQL answer as None, not missing:
    ``dict.get(key, default)`` would yield None and crash the join."""
    reader, _ = adapter([{"text": None}, {"text": "real"}])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10))
    assert (content, truncated) == ("\n\nreal", False)


def test_chunk_cap_sets_truncated():
    reader, _ = adapter([{"text": "a"}, {"text": "b"}, {"text": "c"}])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=2))
    assert content == "a\n\nb"
    assert truncated is True


def test_adapter_returns_uncut_content_and_reports_only_the_chunk_cap():
    reader, _ = adapter([{"text": "abcdefghij"}])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10))
    # the byte budget is the executor's single enforcement point; the
    # adapter only bounds the chunk count and reports the cap
    assert (content, truncated) == ("abcdefghij", False)


def test_no_chunks_yields_empty_content():
    reader, _ = adapter([])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10))
    assert content == ""
    assert truncated is False


def test_transport_failure_propagates():
    class ExplodingDb:
        def __init__(self):
            self.aql = _Aql([])

            def explode(*args, **kwargs):
                raise RuntimeError("arango down")

            self.aql.execute = explode

    reader = LegacyChunkAdapter(db_factory=lambda: ExplodingDb())
    with pytest.raises(RuntimeError):
        asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10))


def test_a_lazy_cursor_is_materialized():
    """python-arango's Cursor is neither sliceable nor len-able; the adapter
    consumes it as a sequence, so it must materialize the answer first."""

    class LazyDb:
        def __init__(self):
            self.aql = _Aql([])

            def lazy(*args, **kwargs):
                return iter([{"text": "a"}, {"text": "b"}])

            self.aql.execute = lazy

    reader = LegacyChunkAdapter(db_factory=lambda: LazyDb())
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10))
    assert (content, truncated) == ("a\n\nb", False)


def test_the_modules_aql_doubles_track_the_real_driver_signature():
    """Every ``execute`` double in this module carrying ``bind_vars`` must
    take it in the real driver's position — a double that takes it second
    would mask a positional bind-dict regression (see conftest helper)."""
    from conftest import assert_module_aql_fakes_faithful

    assert_module_aql_fakes_faithful(Path(__file__))
