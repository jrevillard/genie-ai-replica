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

import pytest

from capabilities.adapters.chunks import LegacyChunkAdapter


class FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def execute(self, query, bind_vars):
        self.queries.append({"query": query, "bind_vars": bind_vars})
        return self.rows


def adapter(rows):
    return LegacyChunkAdapter(db_factory=lambda: FakeDb(rows))


def test_reads_the_graphs_source_collection_with_bound_variables():
    reader = adapter([{"text": "alpha"}, {"text": "beta"}])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10, max_bytes=10_000))
    assert (content, truncated) == ("alpha\n\nbeta", False)
    query = reader._db.queries[0]["query"]  # the fake records what ran
    bind_vars = reader._db.queries[0]["bind_vars"]
    assert "@collection" in query and "doc.file_id == @file_id" in query
    assert bind_vars["@collection"] == "GRAPH_SOURCE"
    assert bind_vars["file_id"] == "42"
    # no caller-supplied value is interpolated into the AQL text
    assert "42" not in query


def test_chunk_cap_sets_truncated():
    reader = adapter([{"text": "a"}, {"text": "b"}, {"text": "c"}])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=2, max_bytes=10_000))
    assert content == "a\n\nb"
    assert truncated is True


def test_byte_budget_truncates():
    reader = adapter([{"text": "abcdefghij"}])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10, max_bytes=4))
    assert content == "abcd"
    assert truncated is True


def test_no_chunks_yields_empty_content():
    reader = adapter([])
    content, truncated = asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10, max_bytes=100))
    assert content == ""
    assert truncated is False


def test_transport_failure_propagates():
    class ExplodingDb:
        def execute(self, query, bind_vars):
            raise RuntimeError("arango down")

    reader = LegacyChunkAdapter(db_factory=lambda: ExplodingDb())
    with pytest.raises(RuntimeError):
        asyncio.run(reader.read_chunks("GRAPH", "42", max_chunks=10, max_bytes=100))
