# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ported bounds of the preparation pipeline, as the record measures them.

Everything here is ported from the deployed module
(``genieai_chatqna.py:821-968``, ``:1321-1322``): the character-budget
derivation from the discovered translation window, the history flatten, the
newest-first trim, the single-message refusal, and the ``USER:`` query
extraction. The two recorded shapes carry DIFFERENT bounds and both are
ported:

* a history that arrives as ONE STRING over the character budget is
  REFUSED — the typed :class:`TranslationInputTooLongError`, raised BEFORE
  the language map is consulted (the refusal must not depend on the
  registry's health);
* a history that arrives as a MESSAGE LIST (the deployed BFF shape) is
  never refused at the character budget: the oldest turns are dropped
  newest-first and the newest message's tail is truncated to the budget, so
  the retriever sees the same kept turns whichever language the query is
  written in. The TRANSLATION WINDOW can still overflow, and that refuses
  (the translation seam raises it).
"""

import logging
import re

from .config import PreparationConfig
from .translation import TranslationInputTooLongError

logger = logging.getLogger(__name__)

# The last-user-message extraction over the flattened history blob (deployed
# USER_MSG_PATTERN, :1321-1322). The extraction runs on the TRANSLATED blob:
# the query is the last user turn of the English-normalized history, never of
# the source text.
USER_MSG_PATTERN = re.compile(r"USER:\s*(.*?)(?:\s*\|<-MSG->\||$)", re.DOTALL)


def derived_char_budget(window: int | None, config: PreparationConfig) -> int:
    """The character budget for history forwarded to the translation model.

    Derived from the discovered translation-model window so that the prompt
    plus the completion (an input-sized translation) fit inside it:
    ``(window − prompt-overhead) // 2 × chars-per-token``. A deployer-set
    ``MAX_TRANSLATION_CHARS`` only LOWERS the derived budget (the
    dense-script mitigation — CJK runs ~1 token/char, not 3), and the same
    configured value is the FALLBACK when the window is unknown. The budget
    never drops below 1.
    """
    if not window:
        return max(config.max_translation_chars, 1)
    budget = (window - config.prompt_overhead_tokens) // 2 * config.chars_per_token
    if config.max_translation_chars_cap > 0:
        budget = min(budget, config.max_translation_chars_cap)
    return max(budget, 1)


def flatten_history(history: list) -> str:
    """Flatten the chat history into the role-tagged string every consumer
    shares: the translation prompt (and its untranslated fallback), and the
    passthrough flatten when the history is already in English. One recipe,
    so a translated and a passthrough history for the same messages differ
    only in the words, never in the format. A message with no role key
    flattens as ``UNKNOWN:`` and a message with no content key flattens as
    an empty content."""
    parts = []
    for message in history:
        role = message.get("role", "unknown").upper()
        content = message.get("content", "")
        parts.append(f"{role}: {content}")
    return " |<-MSG->| ".join(parts)


def is_blank_message_content(content: object) -> bool:
    """True when a message's content is blank text.

    A content value is only blank when it is a string with nothing but
    whitespace; a non-string (a multimodal part list) always carries its own
    parts and is never treated as blank (and never handed to string
    methods).
    """
    return isinstance(content, str) and not content.strip()


def all_messages_blank(messages: list) -> bool:
    """Whether EVERY message in the list carries blank content.

    Deployed semantics — the guard is a bare ``all(...)`` over the kept
    messages, so an EMPTY list reads all-blank. That is load-bearing on the
    passthrough path (an established-English empty history must not report
    the healthy passthrough label); the translation path catches emptiness
    before this guard (its own early return).
    """
    return all(is_blank_message_content(message.get("content", "")) for message in messages)


def refuse_oversized_query(history: str, max_chars: int, overhead: int) -> None:
    """Refuse a single-message query over the translation character budget.

    One check for both language paths: the budget decides the single-message
    contract, not the language the query is written in — an oversized query
    is refused whatever it says, instead of passing whole in English and
    failing later at the embedder with a less actionable error. The caller
    runs the check BEFORE the language map is consulted, so the refusal
    cannot depend on the registry's health.

    ``overhead`` is the per-message allowance the budget charges
    (``config.msg_overhead_chars`` — the deployed
    ``TRANSLATION_MSG_OVERHEAD_CHARS``: the flattened history carries
    "USER: " prefixes and the " |<-MSG->| " separator the char count does
    not).

    Raises:
        TranslationInputTooLongError: the query plus its overhead does not
        fit the budget.
    """
    if len(history) + overhead > max_chars:
        raise TranslationInputTooLongError(
            f"the query is {len(history)} characters, over the {max_chars}-character translation budget"
        )


def select_history_within_budget(history: list, max_translation_chars: int, path: str, overhead: int) -> list:
    """The messages of ``history`` that fit the character budget.

    One rule, two callers: the translator (which forwards the history to
    the translation model) and the passthrough (which flattens an already
    English history in place). The retriever must see the same turns
    whichever language the query is written in, so both keep the same
    messages — the newest first, so an overflowing conversation loses its
    oldest turns and keeps its recent ones. A newest message that alone
    exceeds the whole budget keeps its tail, truncated to the budget, so
    the retrieval query carries the end of the turn instead of an empty
    string. Only that message's dict is copied; the other kept messages
    are the request's own dicts, which the callers never mutate.

    ``path`` names the caller in the log line; ``overhead`` is the
    per-message allowance the budget charges (``config.msg_overhead_chars``).
    """
    current_chars = 0
    messages_to_process = []
    newest_truncated = False
    for message in reversed(history):
        # .get, not [:]: request validation permits a message with no
        # content key, and a malformed message must not crash the
        # turn — it counts as empty, exactly as the flatten below
        # reads it.
        message_chars = len(message.get("content", ""))
        if current_chars + message_chars + overhead > max_translation_chars:
            if not messages_to_process:
                tail_chars = max_translation_chars - overhead
                content = message.get("content", "")[-tail_chars:] if tail_chars > 0 else ""
                messages_to_process.append({**message, "content": content})
                newest_truncated = True
            break
        messages_to_process.append(message)
        current_chars += message_chars + overhead
    messages_to_process.reverse()
    dropped_messages = len(history) - len(messages_to_process)
    if dropped_messages:
        logger.warning(
            "Chat history truncated (path=%s): budget_chars=%s kept_messages=%s dropped_messages=%s",
            path,
            max_translation_chars,
            len(messages_to_process),
            dropped_messages,
        )
    if newest_truncated:
        logger.warning(
            "Newest history message exceeds the translation budget (path=%s, budget_chars=%s); "
            "keeping its last %s characters.",
            path,
            max_translation_chars,
            len(messages_to_process[-1].get("content", "")),
        )
    return messages_to_process


def extract_query(blob: str) -> str:
    """The last ``USER:`` segment of the flattened history, or the whole blob.

    The regex-based extraction mirrors the deployed one (:4786-4795): the
    last match wins, and a blob whose marker is absent (or whose last user
    segment is only whitespace) falls back to the whole blob (less accurate
    for retrieval but safe).
    """
    user_messages = USER_MSG_PATTERN.findall(blob)
    if user_messages:
        query = user_messages[-1].strip()
        if query:
            return query
    return blob
