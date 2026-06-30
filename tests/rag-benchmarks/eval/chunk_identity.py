# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Stable chunk identity for retrieval eval.

Chunk ``_key`` values are auto-generated UUIDs (langchain-arangodb assigns them
at insert) and churn on every re-ingestion — so a gold set keyed on ``_key``
breaks the moment the corpus is re-ingested. To survive re-ingestion, the eval
matches on a CONTENT FINGERPRINT derived from the chunk text instead.

Stable across re-ingests as long as chunking params (chunk_size/overlap) are
unchanged. A chunking-param change correctly invalidates the gold set — that is
a signal to re-baseline, not a bug.
"""

from __future__ import annotations

import hashlib
import re

_DEFAULT_PREFIX_LEN = 200
_WHITESPACE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Lowercase + collapse all whitespace to single spaces. Kills brittle whitespace diffs."""
    return _WHITESPACE.sub(" ", (text or "").strip().lower())


def content_hash(text: str, prefix_len: int = _DEFAULT_PREFIX_LEN) -> str:
    """Short stable fingerprint of a chunk's text.

    ``sha256(normalize(text)[:prefix_len])`` — first 16 hex chars. Prefix-based
    so minor boundary drift at the tail does not change the hash; normalized so
    whitespace differences do not either.
    """
    norm = normalize(text)[:prefix_len]
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]
