# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""GENIE.AI Server-Side Tools (SST) — shared implementation package.

This package is COPY'd into **both** the chatqna image and the workflows tool-host
image (architecture Decision 26), the same way ``core/`` and ``tracing.py`` already
are. That resolves the PRD's apparent contradiction between FR47 (web search runs
inline in ``genieai_chatqna.py``) and §5 (web search is a LangGraph tool in
``workflows/tools/``): one implementation, two call sites, no extra network hop
inside the 2-second P95 budget (NFR1).

Modules:
    schemas           Declared Pydantic contracts (Citation, Degradation, ToolResult).
    pii               PIIRedactor ABC + regex/Presidio/HTTP implementations (Decision 5).
    redis_primitives  Sliding-window rate limiter, circuit breaker, audit stream (Decisions 2, 8).
    governance        The three-phase governance pipeline (Decision 16).
    searxng_client    Pluggable search backend, SearXNG default (FR16, FR18).
    fusion            Search triggers, result fusion, context budget (FR8-FR10, FR19, FR20, FR24).

See ``_bmad-output/planning-artifacts/architecture.md`` for the binding decisions.
"""
