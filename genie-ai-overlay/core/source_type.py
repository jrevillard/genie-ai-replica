# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Shared SourceType enum for chunk metadata across SST and OKF pillars.

This enum discriminates chunk provenance in the shared ArangoDB chunks
collection. SST declares the initial values; OKF extends additively.

Decision 3 (SST PRD): feed-sourced chunks share the existing chunks graph
vertex collection with a ``source_type`` discriminator — no parallel corpus.

Cross-pillar: OQ-SST-6 resolved — SST lands first, OKF extends.
"""

from enum import Enum


class SourceType(str, Enum):
    """Discriminator for chunk provenance in the shared ArangoDB chunks collection.

    Values:
        FILE: Chunks ingested from uploaded documents (default for existing chunks).
        FEED: Chunks ingested from RSS/Atom/JSON-API/webhook feeds (SST §3.2).
        WEB_SEARCH: Results from SearXNG web search (SST §3.1, transient — not persisted).
    """

    FILE = "file"
    FEED = "feed"
    WEB_SEARCH = "web_search"
    # OKF will add: OKF = "okf" (additive, non-breaking)
