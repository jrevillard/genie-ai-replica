# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for run_eval.py's content-hash scoring path.

score_anchor is the crux of the content-based identity change: the span emits
ArangoDB ``_key``s, but the gold matches on ``content_hash``. These tests lock
the ``_key -> content_hash`` projection so a regression there cannot silently
produce a false zero (or mixed-namespace) baseline.
"""

import run_eval


def _entry(content_hash="abc123", chunk_key="key1"):
    return {
        "id": "q1",
        "query": "What is the question?",
        "expected_chunks": [{"chunk_key": chunk_key, "content_hash": content_hash}],
    }


def test_score_anchor_projects_keys_to_content_hashes():
    entry = _entry("abc123")
    key_to_hash = {"key1": "abc123", "key2": "def456", "key3": "ghi789"}
    row = run_eval.score_anchor(
        entry,
        cand_keys=["key1", "key2"],
        sel_keys=["key1", "key3"],
        trace_found=True,
        key_to_hash=key_to_hash,
    )
    # raw _keys stay in the report (calibrator + CLAUDE.md schema read these)
    assert row["gold"] == ["key1"]
    assert row["selected"] == ["key1", "key3"]
    assert row["candidates"] == ["key1", "key2"]
    # scoring uses the content-hash projections — never a mixed namespace
    assert row["gold_hashes"] == ["abc123"]
    assert row["selected_hashes"] == ["abc123", "ghi789"]
    assert row["candidate_hashes"] == ["abc123", "def456"]
    assert row["recall"] == 1.0
    assert row["precision"] == 0.5  # 1 of 2 selected is gold
    assert row["retrieval_recall"] == 1.0


def test_score_anchor_drops_unmapped_keys():
    entry = _entry("abc123")
    key_to_hash = {"key1": "abc123"}
    row = run_eval.score_anchor(
        entry,
        cand_keys=["key1", "unmapped1"],
        sel_keys=["unmapped1"],
        trace_found=True,
        key_to_hash=key_to_hash,
    )
    # unmapped span keys are dropped from the hash projection (never scored)
    assert row["selected"] == ["unmapped1"]  # raw key preserved for the report
    assert row["selected_hashes"] == []
    assert row["recall"] == 0.0
    assert row["precision"] == 0.0
    # key1 still maps to a gold candidate → retrieval_recall is computable
    assert row["retrieval_recall"] == 1.0


def test_score_anchor_empty_map_produces_no_scoring_signal():
    entry = _entry("abc123")
    row = run_eval.score_anchor(
        entry,
        cand_keys=["key1"],
        sel_keys=["key1"],
        trace_found=True,
        key_to_hash={},  # empty map = wrong GRAPH_SOURCE → every key unmapped
    )
    assert row["selected_hashes"] == []
    assert row["candidate_hashes"] == []
    assert row["recall"] == 0.0
    assert "retrieval_recall" not in row  # no hash-projected candidates at all
