# Copyright (C) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Runtime-editable pipeline settings — the K.1 file-registry reader.

Ported from Vladimir Daigele's file-registry mechanism on ``main``
(``llm-registry-service.js`` @ ``3b547456``; ``rag-tuning-service.js`` @
``845b8ae6`` -> ``54ab1459``), adapted to this stack's Python readers.
The second attribution site is
``_bmad-output/implementation-artifacts/spec-k1-settings-foundation.md``.

Precedence law (B3 SSOT): the on-box file is the source of truth once
seeded; the env var names the file (SEED path) only. A missing or invalid
file degrades LOUDLY — one WARN per file-state change, then the caller's
documented defaults — never silent, never a crashed chat (plan.md:21).

Usage (K.2/K.3 call sites, per request — no restart needed)::

    from core.pipeline_settings import load_settings

    temperature = load_settings(
        "LLM_SETTINGS_CONFIG", _DEFAULTS
    )["generation"]["temperature"]

The returned dict is cached per resolved path behind an mtime/size
signature: unchanged file = cached object, no re-parse; edited file =
re-read on the next call. Treat it as read-only.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]

# env-var name -> repo-relative SEED default (local dev/tests only; in
# containers compose always sets the env var, so this map is never consulted).
_DEFAULT_SEEDS = {
    "LLM_SETTINGS_CONFIG": _REPO_ROOT / "configs" / "pipeline" / "llm-settings.seed.json",
    "RAG_TUNING_CONFIG": _REPO_ROOT / "configs" / "pipeline" / "rag-tuning.seed.json",
}

# resolved path -> (stat signature, merged settings or None for a bad state).
# None signature means "file missing" — a stable state, so the WARN fires once
# per state change instead of per request.
_cache: dict[str, tuple[str | None, dict | None]] = {}


def _resolve_path(env_var: str) -> Path:
    override = os.getenv(env_var)
    if override:
        return Path(override)
    # Unknown var name with no env override: a path that never exists, so the
    # caller gets the loud warn + defaults rather than a crash.
    return _DEFAULT_SEEDS.get(env_var) or _REPO_ROOT / "configs" / "pipeline" / "settings.json"


def _signature(path: Path) -> str | None:
    try:
        st = path.stat()
    except OSError:
        return None
    # st_ino: the Node writer swaps files by rename (new inode) — mtime+size
    # alone can miss a same-size edit inside mtime granularity.
    return f"{st.st_mtime_ns}:{st.st_size}:{st.st_ino}"


def _deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_settings(env_var: str, defaults: dict) -> dict:
    """Return the settings named by ``env_var``: file values deep-merged over
    ``defaults`` (a partial file is legal — missing keys fall back).

    Synchronous, stdlib-only, safe to call per request.
    """
    path = _resolve_path(env_var)
    key = str(path)
    sig = _signature(path)
    entry = _cache.get(key)

    # Cache hit: same file state as last call (valid OR invalid — a cached
    # bad state returns defaults without re-parsing or re-warning).
    if sig is not None and entry is not None and entry[0] == sig:
        return entry[1] if entry[1] is not None else defaults

    if sig is None:
        if entry is None or entry[0] is not None:
            logger.warning(
                "pipeline settings file %s missing; using defaults", path
            )
        _cache[key] = (None, None)
        return defaults

    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict):
            raise ValueError("top-level JSON is not an object")
    except (OSError, ValueError, RecursionError) as exc:
        if entry is None or entry[0] != sig:
            logger.warning(
                "pipeline settings file %s unreadable (%s); using defaults", path, exc
            )
        _cache[key] = (sig, None)
        return defaults

    merged = _deep_merge(defaults, doc)
    _cache[key] = (sig, merged)
    return merged
