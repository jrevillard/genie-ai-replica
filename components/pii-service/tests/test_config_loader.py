# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Round 11 (!622): OKF_PII_NATIONAL_ID_PATTERNS must load fail-open-with-alarm.

The old bare ``json.loads`` at module import crash-looped the uvicorn worker
on one malformed value — and the okf-server PII client is fail-closed, so
every repo-wide scan 502'd and the publish gate blocked every repo until an
operator fixed the env by hand. These tests import a FRESH copy of the
module with hostile env values set and assert it still comes up (with the
built-in defaults) every time. The analyzer is a lazy singleton, so
re-importing the module needs no model."""

import importlib
from contextlib import contextmanager

import app as app_module

_DEFAULT_KEYS = {"LS_NATIONAL_ID", "BD_NATIONAL_ID", "GM_NATIONAL_ID"}


@contextmanager
def _module_with_env(monkeypatch, value):
    """Reload app under a hostile OKF_PII_NATIONAL_ID_PATTERNS, restore after."""
    monkeypatch.setenv("OKF_PII_NATIONAL_ID_PATTERNS", value)
    module = importlib.reload(app_module)
    try:
        yield module
    finally:
        monkeypatch.delenv("OKF_PII_NATIONAL_ID_PATTERNS", raising=False)
        importlib.reload(app_module)  # pristine module for the rest of the suite


def test_malformed_json_degrades_to_defaults(monkeypatch, capfd):
    for bad in ('{"BD": [', "not json at all", "}}{{"):
        with _module_with_env(monkeypatch, bad) as module:
            # The module IMPORTED (no crash) and kept the built-in registry…
            assert set(module.NATIONAL_ID_PATTERNS) >= _DEFAULT_KEYS
            # …and screamed about the ignored override (the alarm the operator reads).
            out = capfd.readouterr().out
            assert "CRITICAL" in out
            assert "OKF_PII_NATIONAL_ID_PATTERNS" in out


def test_non_object_json_degrades_to_defaults(monkeypatch, capfd):
    with _module_with_env(monkeypatch, '["a", "b"]') as module:
        assert set(module.NATIONAL_ID_PATTERNS) >= _DEFAULT_KEYS
        assert "CRITICAL" in capfd.readouterr().out


def test_valid_override_still_applies(monkeypatch):
    override = '{"XX_NATIONAL_ID": [{"name": "xx", "regex": "\\\\d{4}", "score": 0.4}]}'
    with _module_with_env(monkeypatch, override) as module:
        assert "XX_NATIONAL_ID" in module.NATIONAL_ID_PATTERNS
        assert module.NATIONAL_ID_PATTERNS["XX_NATIONAL_ID"][0]["name"] == "xx"
        # the built-ins survive alongside the override
        assert set(module.NATIONAL_ID_PATTERNS) >= _DEFAULT_KEYS


def test_defaults_registry_shape_is_untouched():
    # The score invariant the module's own docstring demands: every shipped
    # score >= DEFAULT_SCORE_THRESHOLD (0.35) or the recognizer never fires.
    for patterns in app_module.NATIONAL_ID_PATTERNS.values():
        for p in patterns:
            assert p["score"] >= app_module.DEFAULT_SCORE_THRESHOLD
