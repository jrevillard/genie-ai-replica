# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ported prompt surface.

The prompt-byte contract is enforced against the DEPLOYED module directly
(`test_prompt_strings_match_the_deployed_source` — the source-inspection
guard; the deployed line wrapping may differ, the words may not); the tests
below pin the ASSEMBLY: the EN prefix, the three-section template, the
document rendering, the abstention injection, and the truncation guard
(oldest dropped, a non-fitting segment stops the walk, documents never
truncated).
"""

import asyncio
import dataclasses
from pathlib import Path

from noagent.config import NoAgentConfig
from noagent.prompt import (
    DEFAULT_ABSTENTION_INSTRUCTIONS,
    DEFAULT_SYSTEM_PROMPT,
    EN_ONLY_PREFIX,
    HISTORY_SEPARATOR,
    abstention_instructions,
    answer_reserve,
    build_user_content,
    render_knowledge_section,
    system_prompt,
    truncate_history,
)

DEPLOYED_CHATQNA = Path(__file__).resolve().parents[3] / "genie-ai-overlay" / "chatqna" / "genieai_chatqna.py"


def _config(**overrides) -> NoAgentConfig:
    base = NoAgentConfig.load(env={})
    return dataclasses.replace(base, **overrides)


def _counting(tokens_per_text: dict[str, int]):
    """A deterministic counter: tokens per exact text, 1 for anything else."""

    async def count(text: str) -> int:
        return tokens_per_text.get(text, 1)

    return count


# ---------------------------------------------------------------------
# The system prompt and the EN hard-prefix
# ---------------------------------------------------------------------


def test_system_prompt_default_and_override():
    assert system_prompt(_config(), None) == DEFAULT_SYSTEM_PROMPT
    assert system_prompt(_config(system_prompt_override="Custom."), None) == "Custom."


def test_prompt_strings_match_the_deployed_source():
    """The prompt-byte contract, enforced at the strongest boundary: config
    B is a behavioral-equivalence instrument, so its three deployed strings
    must EQUAL the deployed chatqna module's own string constants. The
    deployed module's adjacent literals fold at parse time, so an AST walk
    over its constant strings yields the real values — exact equality, any
    word-level edit on either side redds, an identifier refactor does not."""
    import ast

    tree = ast.parse(DEPLOYED_CHATQNA.read_text())
    deployed_strings = {
        node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }
    for name, text in (
        ("DEFAULT_SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT),
        ("DEFAULT_ABSTENTION_INSTRUCTIONS", DEFAULT_ABSTENTION_INSTRUCTIONS),
        ("EN_ONLY_PREFIX", EN_ONLY_PREFIX),
    ):
        assert text in deployed_strings, f"{name} diverges from the deployed chatqna source"


def test_english_history_prepends_the_mandatory_english_prefix():
    assert system_prompt(_config(), "EN") == EN_ONLY_PREFIX + DEFAULT_SYSTEM_PROMPT
    # The deployed compare is EXACT on the canonical upper-case code: the
    # preparation module emits upper-case codes, and "en" is not one.
    assert system_prompt(_config(), "en") == DEFAULT_SYSTEM_PROMPT
    # A non-English or unresolved language gets NO prefix.
    assert system_prompt(_config(), "FR") == DEFAULT_SYSTEM_PROMPT
    assert system_prompt(_config(), None) == DEFAULT_SYSTEM_PROMPT


# ---------------------------------------------------------------------
# The user template and the knowledge-base section
# ---------------------------------------------------------------------


def test_user_template_is_the_three_section_shape():
    content = build_user_content("user ctx", "USER: hi", "q")
    assert content == (
        "\n\nUSER INFORMATION:\nuser ctx"
        "\n\nCHAT HISTORY:\nUSER: hi"
        "\n\nCONTENT FROM THE KNOWLEDGE BASE:\nSearch query: \nq"
    )


def test_documents_render_as_retrieved_document_blocks():
    section = render_knowledge_section("What is X?", ["doc one", "doc two"], None)
    assert section == "What is X?\n[Retrieved Document]: doc one\n[Retrieved Document]: doc two"


def test_no_documents_injects_the_abstention_instructions_into_the_user_turn():
    section = render_knowledge_section("What is X?", [], DEFAULT_ABSTENTION_INSTRUCTIONS)
    assert section == "What is X?" + DEFAULT_ABSTENTION_INSTRUCTIONS
    # Guardrail off: an empty document list appends nothing.
    assert render_knowledge_section("What is X?", [], None) == "What is X?"


def test_abstention_instructions_follow_the_enforce_flag_and_overrides():
    assert abstention_instructions(_config()) == DEFAULT_ABSTENTION_INSTRUCTIONS
    assert abstention_instructions(_config(enforce_abstention=False)) is None
    assert abstention_instructions(_config(abstention_instructions_override="Custom.")) == "Custom."


# ---------------------------------------------------------------------
# The history-truncation guard
# ---------------------------------------------------------------------


def _guard(history, knowledge, counter, window=1000, answer=200, system_tokens=None, system_text=DEFAULT_SYSTEM_PROMPT):
    """The guard takes the system prompt's token count PRECOMPUTED (the
    deployed `_count_static_tokens` memo — the pipeline pays the count once
    per system text, not once per turn); the helper derives it from the
    same counter the segments use unless the test pins a number."""
    if system_tokens is None:

        async def _count():
            return await counter(system_text)

        system_tokens = asyncio.run(_count())
    return truncate_history(
        history,
        system_tokens=system_tokens,
        knowledge_base_section=knowledge,
        user_context="",
        answer_tokens=answer,
        window_tokens=window,
        count_tokens=counter,
    )


def test_fitting_prompt_is_returned_untouched():
    counter = _counting({})
    history, kept, dropped = asyncio.run(_guard("a" + HISTORY_SEPARATOR + "b", "kb", counter))
    assert (history, kept, dropped) == ("a" + HISTORY_SEPARATOR + "b", 0, 0)


def test_over_window_drops_the_oldest_segments_first():
    """A compositional counter (1 token per 10 chars): system ≈ 68 tokens,
    docs small, the OLDEST segment large and the NEWEST small. Guard window:
    400 − 68 − 50 − skeleton(8) − 200 = 74 history tokens — the newest (10)
    fits, the oldest (100) does not."""
    history = "x" * 1000 + HISTORY_SEPARATOR + "y" * 100

    async def count(text: str) -> int:
        return max(1, len(text) // 10)

    truncated, kept, dropped = asyncio.run(_guard(history, "kb", count, window=400, answer=50))
    assert truncated == "y" * 100
    assert (kept, dropped) == (1, 1)


def test_a_non_fitting_segment_stops_the_walk_older_ones_are_never_revisited():
    """The deployed `break`: once a segment does not fit, the walk stops —
    an older tiny segment is dropped even though it would fit."""
    history = "tiny" + HISTORY_SEPARATOR + "big" * 1000

    async def count(text: str) -> int:
        return max(1, len(text) // 10)

    # 500 − 68 (system) − 0 (answer) − 8 (skeleton) − 200 = 224 history
    # tokens; the newest segment (300 tokens) does not fit → stop.
    truncated, kept, dropped = asyncio.run(_guard(history, "kb", count, window=500, answer=0))
    assert truncated == ""
    assert (kept, dropped) == (0, 2)


def test_documents_are_never_truncated_by_the_guard():
    """The documents ride the knowledge-base section — the skeleton — and a
    guard run leaves them whole: only the history is re-budgeted. The
    rebuilt prompt after truncation still carries the FULL document blocks."""
    docs = "\n[Retrieved Document]: " + "d" * 5000
    history = "seg-old" + HISTORY_SEPARATOR + "seg-new"

    async def count(text: str) -> int:
        return max(1, len(text) // 10)

    # The huge docs put the prompt over the window; the guard drops the
    # whole history to make room and never touches the section.
    truncated, kept, dropped = asyncio.run(_guard(history, docs, count, window=700, answer=0))
    assert dropped == 2
    rebuilt = build_user_content("", truncated, docs)
    assert rebuilt.count(docs) == 1  # the section is verbatim, never cut


def test_answer_reserve_defaults_to_the_deployed_3896():
    assert answer_reserve(_config()) == 3896
    assert answer_reserve(_config(answer_tokens=512)) == 512
