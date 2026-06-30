# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for chunk content identity (pure functions, no env deps)."""

import chunk_identity as ci


def test_normalize_collapses_whitespace_and_lowercases():
    assert ci.normalize("  Hello   WORLD\n") == "hello world"


def test_content_hash_is_deterministic():
    assert ci.content_hash("same text") == ci.content_hash("same text")


def test_content_hash_whitespace_insensitive():
    # re-ingestion may shift whitespace; the fingerprint must not change
    assert ci.content_hash("the quick brown fox") == ci.content_hash("the   quick\tbrown\nfox")


def test_content_hash_is_prefix_based():
    # only the first prefix_len chars matter — tail drift must not change the hash
    base = "x" * 300
    variant = base + "different tail beyond the prefix window"
    assert ci.content_hash(base) == ci.content_hash(variant)


def test_content_hash_distinguishes_different_chunks():
    assert ci.content_hash("chunk about cucumbers") != ci.content_hash("chunk about subsidies")


def test_content_hash_handles_empty_and_none():
    # must not raise; empty/None collapse to the same fingerprint
    assert ci.content_hash("") == ci.content_hash(None)


def test_content_hash_short_hex():
    # 16 hex chars — compact enough for span/fixture storage
    h = ci.content_hash("anything")
    assert len(h) == 16
    int(h, 16)  # parses as hex
