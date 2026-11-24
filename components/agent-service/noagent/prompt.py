# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ported prompt surface — deployed chatqna's prompt, verbatim.

Every string here is the deployed module's own text, copied byte for byte
(``genieai_chatqna.py``: the system default :1922-1941, the abstention
instructions :1955-1963, the EN hard-prefix :2643-2649, the user template
:587-595, the document rendering :3121-3123, the abstention injection
:2992-2998 + :3113-3119, the history truncation :2689-2749). Config B is a
behavioral-equivalence instrument: a prompt edit here is a behavior change
and must be recorded, never slipped in.

The assembly, as deployed:

* the system message is the configured system prompt (the
  ``CHATQNA_SYSTEM_PROMPT`` override or the default) with the EN-only
  hard-prefix PREPENDED when the conversation's language is English;
* the user message is the three-section template — USER INFORMATION, CHAT
  HISTORY, CONTENT FROM THE KNOWLEDGE BASE — and the knowledge-base section
  carries the retrieval query plus EITHER the retrieved documents rendered
  as ``\\n[Retrieved Document]: {text}`` blocks OR, when there are none and
  abstention is enforced, the abstention instructions appended to the query;
* the history-truncation guard runs over the assembled prompt: when the
  prompt plus the answer reserve exceeds the window minus the 200-token
  buffer, the OLDEST history segments are dropped (a segment that does not
  fit stops the walk — newer segments are never revisited) and the user
  content is rebuilt from the same template. The retrieved documents live
  in the skeleton, never in the history, and are never truncated.
"""

import logging

from capabilities.search_knowledge import (
    RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT as RERANKER_INPUT_TOO_LONG_ABSTENTION_TEXT,
)

from .config import DEFAULT_MAX_ANSWER_TOKENS, WINDOW_BUFFER_TOKENS, NoAgentConfig
from .generation import window_fits

logger = logging.getLogger(__name__)

# Deployed _CHATQNA_SYSTEM_DEFAULT — verbatim.
DEFAULT_SYSTEM_PROMPT = """You are a friendly and polite information assistant.

Your task is to answer the user's latest question using only the content provided from the knowledge base.

**Instructions:**
- Do not invent or assume information
- If the answer is not in the provided content, inform the user that the information is unavailable
- Use the user's name, gender, age, preferences, and chat history to tailor and personalise your responses
- Keep answers informative but concise; provide detailed explanations
  only when necessary or explicitly requested

In line with the above instructions, generate a reply to the user's latest
message in the chat history based on the relevant content provided."""

# Deployed _DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS — verbatim.
DEFAULT_ABSTENTION_INSTRUCTIONS = (
    "\n[No Relevant Documents Found] The knowledge base search did not "
    "return any high-confidence documents. You may still generate a "
    "response, but begin by clearly stating that you do not have sufficient "
    "information from verified source documents and that your response is "
    "based on general AI training data rather than the knowledge base.\n"
)

# Deployed EN hard-prefix — verbatim (prepended to the system prompt).
EN_ONLY_PREFIX = (
    "\n\nMANDATORY: You MUST respond ONLY in English. "
    "Do NOT respond in Spanish or any other language. "
    "All responses must be in English regardless of the "
    "content language.\n\n"
)

# The history segment separator (deployed: the BFF joins the conversation's
# turns with it before the history reaches chatqna).
HISTORY_SEPARATOR = " |<-MSG->| "


def system_prompt(config: NoAgentConfig, history_language: str | None) -> str:
    """The system message: the override or the default, EN-prefixed when the
    history language is English (deployed: ``original_language == "EN"``
    prepends the mandatory-English instruction)."""
    base = config.system_prompt_override or DEFAULT_SYSTEM_PROMPT
    if history_language and history_language.strip() == "EN":
        return EN_ONLY_PREFIX + base
    return base


def abstention_instructions(config: NoAgentConfig) -> str | None:
    """The instruction text to inject, or None when abstention is off.

    The same predicate drives the injection and the ``abstained`` flag: a
    deployment that turned the guardrail off answers instead of abstaining
    and carries no abstention flag (deployed ``_abstention_enforced``).
    """
    if not config.enforce_abstention:
        return None
    return config.abstention_instructions_override or DEFAULT_ABSTENTION_INSTRUCTIONS


def build_user_content(user_context: str, history: str, knowledge_base_section: str) -> str:
    """The three-section user template — deployed ``_build_user_content``,
    verbatim. One source for the assembled prompt, the truncation budget's
    skeleton and the post-truncation rebuild, so the measured budget always
    matches what is finally sent."""
    return (
        f"\n\nUSER INFORMATION:\n{user_context}"
        f"\n\nCHAT HISTORY:\n{history}"
        f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\nSearch query: \n{knowledge_base_section}"
    )


def render_knowledge_section(query: str, documents: list[str], instructions: str | None) -> str:
    """The knowledge-base section: the query plus the documents rendered as
    deployed ``\\n[Retrieved Document]: {text}`` blocks — or the abstention
    instructions appended to the query when no documents came back and
    abstention is enforced (deployed :2992-2998 + :3113-3119: BOTH no-
    document paths hand the LLM the instructions appended to the query
    text; with the guardrail off, an empty document list appends nothing)."""
    if not documents:
        if instructions is not None:
            return query + instructions
        return query
    return query + "".join(f"\n[Retrieved Document]: {doc}" for doc in documents)


async def truncate_history(
    history: str,
    *,
    system_tokens: int,
    knowledge_base_section: str,
    user_context: str,
    answer_tokens: int,
    window_tokens: int,
    count_tokens,
) -> tuple[str, int, int]:
    """The deployed history-truncation guard (:2689-2749).

    When the assembled prompt plus the answer reserve exceeds the window
    minus the buffer, the history is re-budgeted to
    ``window − system − answer − skeleton − buffer`` tokens and rebuilt from
    its NEWEST segments; a segment that does not fit stops the walk (the
    deployed ``break``: older segments are never revisited even when tiny).
    Returns ``(history, kept, dropped)`` — the joined truncated history and
    the kept/dropped segment counts, so the caller can log the guard's
    outcome the way the deployed span attributes do.

    The documents and the query ride the knowledge-base section — part of
    the skeleton, never the budgeted part: retrieved documents are never
    truncated. ``system_tokens`` arrives precomputed: the system prompt is
    per-process invariant (override-or-default, at most two values), and the
    deployed path memoizes exactly this count (``_count_static_tokens``),
    so paying a ``/tokenize`` round trip for it every turn would be a
    regression the deployed code does not have. ``count_tokens`` is an
    async callable text→int (the generation endpoint's real tokenizer —
    :class:`noagent.generation.TokenCounter`); the numbers are its business,
    the drop policy is this function's and is the recorded behavior.
    """
    skeleton = build_user_content(user_context, "", knowledge_base_section)
    full_prompt_tokens = system_tokens + await count_tokens(
        build_user_content(user_context, history, knowledge_base_section)
    )
    if window_fits(full_prompt_tokens, answer_tokens, window_tokens):
        return history, 0, 0

    skeleton_tokens = await count_tokens(skeleton)
    max_history_tokens = window_tokens - system_tokens - answer_tokens - skeleton_tokens - WINDOW_BUFFER_TOKENS
    segments = history.split(HISTORY_SEPARATOR) if history else []
    truncated: list[str] = []
    current = 0
    for segment in reversed(segments):
        segment_tokens = await count_tokens(segment)
        if current + segment_tokens > max_history_tokens:
            break
        truncated.insert(0, segment)  # Maintain order
        current += segment_tokens
    dropped = len(segments) - len(truncated)
    if dropped:
        logger.warning(
            "Chat history truncated to fit the LLM context window: "
            "window_tokens=%s answer_budget_tokens=%s max_history_tokens=%s "
            "kept_segments=%s dropped_segments=%s",
            window_tokens,
            answer_tokens,
            max_history_tokens,
            len(truncated),
            dropped,
        )
    return HISTORY_SEPARATOR.join(truncated), len(truncated), dropped


def answer_reserve(config: NoAgentConfig) -> int:
    """The answer-token reserve the guard plans against: the configured
    ``max_tokens`` when one is set, else the deployed 3896 default. The
    generation request carries ``max_tokens`` only when configured — the
    reserve is the guard's planning number either way (deployed
    ``_resolve_answer_budget_tokens``)."""
    return config.answer_tokens if config.answer_tokens > 0 else DEFAULT_MAX_ANSWER_TOKENS
