# Copyright (C) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""K.1 pipeline-settings reader (core/pipeline_settings.py) — pins the spec's
reader I/O matrix: mtime cache hit/no-re-parse, change -> re-read,
missing -> defaults + one WARN, invalid JSON -> defaults + WARN, partial file
deep-merged over defaults, env-var path override, repo-seed default path.
"""

import json
import logging
import os

import pytest

from core import pipeline_settings as ps

ENV_VAR = "TEST_PIPELINE_SETTINGS_CONFIG"
DEFAULTS = {
    "version": 0,
    "generation": {"temperature": 0.1, "maxTokens": 512},
    "retriever": {"k": 20},
}


@pytest.fixture(autouse=True)
def _isolated_cache_and_env(monkeypatch, tmp_path):
    ps._cache.clear()
    monkeypatch.setenv(ENV_VAR, str(tmp_path / "settings.json"))
    yield
    ps._cache.clear()


def _write(path, doc):
    path.write_text(json.dumps(doc), encoding="utf-8")


def test_cache_hit_no_reparse(tmp_path):
    path = tmp_path / "settings.json"
    _write(path, {"generation": {"temperature": 0.7}})

    first = ps.load_settings(ENV_VAR, DEFAULTS)
    # Per-request callability: repeated calls are cheap — same cached object
    # (a re-parse would build a fresh dict).
    for _ in range(3):
        assert ps.load_settings(ENV_VAR, DEFAULTS) is first
    assert first["generation"]["temperature"] == 0.7


def test_edited_file_reread_without_restart(tmp_path):
    path = tmp_path / "settings.json"
    _write(path, {"generation": {"temperature": 0.7}})
    assert ps.load_settings(ENV_VAR, DEFAULTS)["generation"]["temperature"] == 0.7

    # Different content length -> different stat signature -> next request re-reads.
    _write(path, {"generation": {"temperature": 0.42}})
    assert ps.load_settings(ENV_VAR, DEFAULTS)["generation"]["temperature"] == 0.42


def test_missing_file_defaults_and_single_warn(tmp_path, caplog):
    # ENV_VAR (autouse fixture) points at a file that does not exist.
    with caplog.at_level(logging.WARNING, logger="core.pipeline_settings"):
        first = ps.load_settings(ENV_VAR, DEFAULTS)
        second = ps.load_settings(ENV_VAR, DEFAULTS)

    assert first is DEFAULTS  # coded/env defaults, chat proceeds
    assert second is DEFAULTS
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warns) == 1  # once per state change, not per request
    assert str(tmp_path / "settings.json") in warns[0].getMessage()


def test_invalid_json_defaults_and_warn(tmp_path, caplog):
    path = tmp_path / "settings.json"
    path.write_text("{not json", encoding="utf-8")

    with caplog.at_level(logging.WARNING, logger="core.pipeline_settings"):
        result = ps.load_settings(ENV_VAR, DEFAULTS)

    assert result is DEFAULTS  # never silent, never a crashed chat
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warns) == 1
    assert str(path) in warns[0].getMessage()


def test_partial_file_merged_over_defaults(tmp_path):
    path = tmp_path / "settings.json"
    _write(path, {"generation": {"temperature": 0.9}})
    merged = ps.load_settings(ENV_VAR, DEFAULTS)

    assert merged["generation"]["temperature"] == 0.9  # file wins
    assert merged["generation"]["maxTokens"] == 512  # missing key = default
    assert merged["retriever"] == {"k": 20}  # missing block = default block
    assert merged["version"] == 0


def test_env_var_path_override(tmp_path, monkeypatch):
    path_a = tmp_path / "a.json"
    path_b = tmp_path / "b.json"
    _write(path_a, {"retriever": {"k": 1}})
    _write(path_b, {"retriever": {"k": 2}})

    monkeypatch.setenv(ENV_VAR, str(path_a))
    assert ps.load_settings(ENV_VAR, DEFAULTS)["retriever"]["k"] == 1
    monkeypatch.setenv(ENV_VAR, str(path_b))
    ps._cache.clear()
    assert ps.load_settings(ENV_VAR, DEFAULTS)["retriever"]["k"] == 2


def test_repo_seed_default_path(monkeypatch):
    # No env override: a known var falls back to its committed repo seed
    # (local dev/tests), which is the envelope-only K.1 seed.
    monkeypatch.delenv("RAG_TUNING_CONFIG", raising=False)
    merged = ps.load_settings("RAG_TUNING_CONFIG", {"version": 0, "rag": True})

    assert merged["version"] == 1  # from the committed seed
    assert merged["rag"] is True  # default supplies the rest


def test_top_level_array_defaults_and_single_warn(tmp_path, caplog):
    path = tmp_path / "settings.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")

    with caplog.at_level(logging.WARNING, logger="core.pipeline_settings"):
        first = ps.load_settings(ENV_VAR, DEFAULTS)
        ps.load_settings(ENV_VAR, DEFAULTS)

    assert first is DEFAULTS
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warns) == 1
    assert str(path) in warns[0].getMessage()


def test_deeply_nested_json_defaults_and_warn(tmp_path, caplog):
    # ~2000 nesting levels: json.loads raises RecursionError, which must be
    # caught (defaults + WARN), never escape into the request path.
    path = tmp_path / "settings.json"
    path.write_text('{"n":' * 2000 + "{}" + "}" * 2000, encoding="utf-8")

    with caplog.at_level(logging.WARNING, logger="core.pipeline_settings"):
        result = ps.load_settings(ENV_VAR, DEFAULTS)

    assert result is DEFAULTS
    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warns) == 1
    assert str(path) in warns[0].getMessage()


def test_same_size_rename_swap_reread(tmp_path):
    # The Node writer swaps atomically (temp + rename): new inode, possibly
    # same byte length. A same-size value flip must still re-read (the stat
    # signature carries st_ino for exactly this case).
    path = tmp_path / "settings.json"
    path.write_text('{"generation": {"temperature": 0.75}}', encoding="utf-8")
    assert ps.load_settings(ENV_VAR, DEFAULTS)["generation"]["temperature"] == 0.75

    tmp = tmp_path / ".settings.json.tmp"
    tmp.write_text('{"generation": {"temperature": 0.80}}', encoding="utf-8")
    os.replace(tmp, path)

    assert ps.load_settings(ENV_VAR, DEFAULTS)["generation"]["temperature"] == 0.80
