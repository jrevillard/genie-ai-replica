# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ported bounds: budget derivation, flatten, trim, refusal, extraction.

The budget numbers here are MUTATION SENSITIVE by design: the derived
budget is asserted at its exact recorded value (11520 for the discovered
8192-token window), the refusal at its exact threshold (+20 overhead), so
a changed constant or formula turns the suite red instead of silently
moving the deployment's bounds.
"""

import dataclasses

import pytest

from preparation.bounds import (
    USER_MSG_PATTERN,
    all_messages_blank,
    derived_char_budget,
    extract_query,
    flatten_history,
    is_blank_message_content,
    refuse_oversized_query,
    select_history_within_budget,
)
from preparation.config import PreparationConfig
from preparation.translation import TranslationInputTooLongError


def _config(**overrides) -> PreparationConfig:
    return dataclasses.replace(PreparationConfig.load(env={}), **overrides)


class TestBudgetDerivation:
    def test_the_recorded_window_derives_the_recorded_budget(self):
        """Window 8192 → (8192 − 512) // 2 × 3 = 11520 characters, as recorded."""
        assert derived_char_budget(8192, _config()) == 11520

    def test_an_unknown_window_falls_back_to_the_configured_budget(self):
        assert derived_char_budget(None, _config()) == 2000

    def test_an_explicit_max_translation_chars_lowers_the_derivation_only(self):
        config = _config(max_translation_chars=5000, max_translation_chars_cap=5000)
        assert derived_char_budget(8192, config) == 5000
        # The cap never RAISES the derived budget.
        assert derived_char_budget(3000, config) == (3000 - 512) // 2 * 3

    def test_an_unset_default_caps_nothing(self):
        assert derived_char_budget(8192, _config()) == 11520

    def test_the_budget_never_drops_below_one(self):
        assert derived_char_budget(513, _config()) == 1
        assert derived_char_budget(0, _config()) == 2000

    def test_the_formula_reads_the_config_constants(self):
        """Mutation sensitivity: the derivation consumes the config's own
        constants, so a drifted constant moves the budget."""
        config = _config(prompt_overhead_tokens=600, chars_per_token=4)
        assert derived_char_budget(8192, config) == (8192 - 600) // 2 * 4


class TestFlatten:
    def test_the_role_tagged_recipe(self):
        blob = flatten_history(
            [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi there"},
            ]
        )
        assert blob == "USER: hello |<-MSG->| ASSISTANT: hi there"

    def test_a_missing_role_flattens_as_unknown_and_missing_content_as_empty(self):
        blob = flatten_history([{"content": "orphan"}])
        assert blob == "UNKNOWN: orphan"
        assert flatten_history([{"role": "user"}]) == "USER: "

    def test_the_pattern_reads_the_flatten_back(self):
        blob = flatten_history(
            [
                {"role": "user", "content": "first question"},
                {"role": "assistant", "content": "answer"},
                {"role": "user", "content": "second question"},
            ]
        )
        assert USER_MSG_PATTERN.findall(blob) == ["first question", "second question"]


class TestBlankGuards:
    def test_blank_content(self):
        assert is_blank_message_content("")
        assert is_blank_message_content("   \n\t")
        assert not is_blank_message_content("hello")
        # A multimodal part list always carries its own parts.
        assert not is_blank_message_content([{"type": "text"}])
        assert not is_blank_message_content(None)

    def test_all_messages_blank_includes_the_empty_list(self):
        """Deployed semantics: the guard is a bare all(...) — an EMPTY list
        reads all-blank, which is what keeps an established-English empty
        history off the healthy passthrough label."""
        assert all_messages_blank([])
        assert all_messages_blank([{"role": "user", "content": "   "}])
        assert all_messages_blank([{"role": "user"}])
        assert not all_messages_blank([{"role": "user", "content": "hi"}])
        assert not all_messages_blank([{"role": "user", "content": ""}, {"role": "user", "content": "hi"}])


class TestSingleMessageRefusal:
    def test_an_oversized_query_is_refused(self):
        config = _config()
        budget = 200
        # len + overhead (20) > budget → refusal.
        with pytest.raises(TranslationInputTooLongError) as excinfo:
            refuse_oversized_query("x" * 181, budget, config.msg_overhead_chars)
        assert "181 characters" in str(excinfo.value)

    def test_a_query_at_the_budget_passes(self):
        # len 180 + 20 == 200 → exactly at the budget, no refusal.
        refuse_oversized_query("x" * 180, 200, _config().msg_overhead_chars)

    def test_the_refusal_threshold_is_mutation_sensitive(self):
        config = _config(msg_overhead_chars=20)
        with pytest.raises(TranslationInputTooLongError):
            refuse_oversized_query("x" * 181, 200, config.msg_overhead_chars)
        # Moving the overhead constant moves the threshold, not the rule.
        with pytest.raises(TranslationInputTooLongError):
            refuse_oversized_query("x" * 191, 200, 10)
        refuse_oversized_query("x" * 190, 200, 10)


class TestListTrim:
    def test_newest_turns_are_kept_and_oldest_dropped(self):
        history = [
            {"role": "user", "content": "A" * 100},
            {"role": "user", "content": "B" * 100},
            {"role": "user", "content": "C" * 100},
        ]
        kept = select_history_within_budget(history, 240, "translation", 20)
        # 100 + 20 per message: two messages fit in 240, the oldest drops.
        assert [m["content"] for m in kept] == ["B" * 100, "C" * 100]

    def test_the_newest_message_alone_over_budget_keeps_its_tail(self):
        history = [
            {"role": "user", "content": "old"},
            {"role": "user", "content": "HEAD" + "x" * 300},
        ]
        kept = select_history_within_budget(history, 200, "translation", 20)
        assert len(kept) == 1
        assert kept[0]["content"] == "x" * 180
        assert kept[0]["role"] == "user"

    def test_translation_and_passthrough_keep_the_same_turns(self):
        """The retriever must see the same turns whichever language the query
        is written in, as recorded."""
        history = [
            {"role": "user", "content": "A" * 90},
            {"role": "assistant", "content": "B" * 90},
            {"role": "user", "content": "C" * 90},
            {"role": "user", "content": "D" * 90},
        ]
        as_translation = select_history_within_budget(history, 250, "translation", 20)
        as_passthrough = select_history_within_budget(history, 250, "passthrough", 20)
        assert as_translation == as_passthrough

    def test_kept_dicts_are_shared_but_the_truncated_newest_is_a_copy(self):
        first = {"role": "user", "content": "A" * 10}
        newest = {"role": "user", "content": "B" * 500, "meta": "kept"}
        kept = select_history_within_budget([first, newest], 100, "translation", 20)
        # The newest alone overflows the whole budget: only its tail is kept.
        assert len(kept) == 1
        assert kept[0] is not newest  # the truncated newest is a copy
        assert kept[0]["meta"] == "kept"  # the copy carries the other keys
        assert kept[0]["content"] == "B" * 80
        assert newest["content"] == "B" * 500  # the input is never mutated

    def test_a_mid_size_history_shares_the_kept_dicts(self):
        first = {"role": "user", "content": "A" * 10}
        newest = {"role": "user", "content": "B" * 10}
        kept = select_history_within_budget([first, newest], 100, "translation", 20)
        assert kept[0] is first  # shared, never copied
        assert kept[1] is newest

    def test_a_message_with_no_content_key_counts_as_empty(self):
        history = [{"role": "user"}, {"role": "user", "content": "B" * 50}]
        kept = select_history_within_budget(history, 200, "translation", 20)
        assert len(kept) == 2


class TestQueryExtraction:
    def test_the_last_user_segment_wins(self):
        blob = "USER: first |<-MSG->| ASSISTANT: answer |<-MSG->| USER: final question"
        assert extract_query(blob) == "final question"

    def test_a_multiline_segment_is_kept_whole(self):
        blob = "USER: line one\nline two |<-MSG->| ASSISTANT: a"
        assert extract_query(blob) == "line one\nline two"

    def test_a_blob_without_the_marker_falls_back_whole(self):
        assert extract_query("just a plain string") == "just a plain string"

    def test_a_whitespace_last_segment_falls_back_whole(self):
        blob = "USER:    |<-MSG->| ASSISTANT: tail"
        assert extract_query(blob) == blob
