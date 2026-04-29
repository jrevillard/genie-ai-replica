"""Tests for the observability helpers."""
from __future__ import annotations

import json
import logging

import pytest

from translation_v2.observability import TokenCounter, log_event, timed


class TestLogEvent:
    def test_emits_valid_json(self, caplog):
        caplog.set_level(logging.INFO, logger="translation_v2.observability")
        log_event("test_event", provider="openai", target="ma")

        records = [r for r in caplog.records if r.name == "translation_v2.observability"]
        assert len(records) == 1
        payload = json.loads(records[0].getMessage())
        assert payload["event"] == "test_event"
        assert payload["provider"] == "openai"
        assert payload["target"] == "ma"
        assert "ts" in payload

    def test_serializes_non_json_values(self, caplog):
        caplog.set_level(logging.INFO, logger="translation_v2.observability")
        # Path is not directly JSON-serializable — must not crash
        from pathlib import Path
        log_event("paths", path=Path("/tmp/x"))
        records = [r for r in caplog.records if r.name == "translation_v2.observability"]
        assert len(records) == 1


class TestTokenCounter:
    def test_empty_text_zero_tokens(self):
        assert TokenCounter.estimate("") == 0

    def test_english_rough_quarter_chars(self):
        # "hello world" — 11 chars → ~2 tokens
        assert TokenCounter.estimate("hello world", "en") == 2

    def test_mandinka_denser(self):
        text = "Ŋ be kuuraŋo"
        en = TokenCounter.estimate(text, "en")
        ma = TokenCounter.estimate(text, "ma")
        # Mandinka uses more tokens per char (ratio 3 vs 4)
        assert ma >= en

    def test_accumulates(self):
        c = TokenCounter()
        c.add("hello world", "Ŋ be fo", "ma")
        c.add("more", "domaa", "ma")
        totals = c.totals()
        assert totals["prompt_tokens"] > 0
        assert totals["completion_tokens"] > 0

    def test_reset(self):
        c = TokenCounter()
        c.add("hello", "fo", "ma")
        c.reset()
        assert c.totals() == {"prompt_tokens": 0, "completion_tokens": 0}


class TestTimed:
    def test_logs_ok_on_success(self, caplog):
        caplog.set_level(logging.INFO, logger="translation_v2.observability")
        with timed("work", provider="openai"):
            pass
        records = [r for r in caplog.records if r.name == "translation_v2.observability"]
        payload = json.loads(records[-1].getMessage())
        assert payload["event"] == "work"
        assert payload["status"] == "ok"
        assert payload["provider"] == "openai"
        assert "duration_ms" in payload

    def test_logs_error_and_reraises(self, caplog):
        caplog.set_level(logging.INFO, logger="translation_v2.observability")
        with pytest.raises(ValueError):
            with timed("work"):
                raise ValueError("boom")

        records = [r for r in caplog.records if r.name == "translation_v2.observability"]
        payload = json.loads(records[-1].getMessage())
        assert payload["status"] == "error"
        assert payload["error"] == "ValueError"
        assert "boom" in payload["error_message"]
