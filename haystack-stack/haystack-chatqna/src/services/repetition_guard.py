"""Post-translation repetition guard.

Detects and truncates LLM repetition loops in translation output.
Low-resource languages (Mandinka, Wolof, Fula) cause even strong models
to degenerate into particle-repetition loops:

    "a be nyinata ka a be nyinata ka a be nyinata ka ..."

This module catches those loops AFTER the LLM returns, as a safety net
independent of frequency_penalty / presence_penalty / prompt rules.

Usage:
    from src.services.repetition_guard import guard_translation
    cleaned = guard_translation(raw_output)
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)


def _find_earliest_loop(words: list[str], max_repeats: int) -> int | None:
    """Return the word index to cut at, or None if no loop detected."""
    n = len(words)
    earliest_cut: int | None = None

    for phrase_len in range(2, min(9, n // 2 + 1)):
        i = 0
        while i + phrase_len * (max_repeats + 1) <= n:
            phrase = words[i : i + phrase_len]
            count = 1
            j = i + phrase_len
            while j + phrase_len <= n and words[j : j + phrase_len] == phrase:
                count += 1
                j += phrase_len
            if count > max_repeats:
                cut = i + phrase_len * max_repeats
                if earliest_cut is None or cut < earliest_cut:
                    earliest_cut = cut
                break
            i += 1

    return earliest_cut


def guard_translation(
    text: str,
    max_repeats: int = 2,
) -> str:
    """Truncate repetition loops in translated text.

    Scans for consecutive n-gram repetitions (2–8 word phrases). If any
    phrase repeats more than *max_repeats* times back-to-back, the text
    is truncated after the allowed repetitions.

    Parameters
    ----------
    text : str
        Raw LLM translation output.
    max_repeats : int
        Maximum allowed consecutive repetitions of the same phrase
        before truncation. Default 2 (third occurrence triggers cut).

    Returns
    -------
    str
        Cleaned text, possibly truncated. A trailing period is appended
        when truncation occurs so the output reads as a complete thought.
    """
    if not text:
        return text

    words = text.split()
    if len(words) < 8:
        return text

    cut = _find_earliest_loop(words, max_repeats)
    if cut is not None and cut < len(words):
        truncated = " ".join(words[:cut]).rstrip(" ,;:")
        if not truncated.endswith((".", "!", "?")):
            truncated += "."
        logger.warning(
            "repetition_guard: truncated output from %d to %d words "
            "(repeating phrase detected at word %d)",
            len(words),
            cut,
            cut,
        )
        return truncated

    return text


def has_repetition(text: str, max_repeats: int = 2) -> bool:
    """Quick check — does the text contain a repetition loop?"""
    if not text:
        return False
    words = text.split()
    if len(words) < 8:
        return False
    return _find_earliest_loop(words, max_repeats) is not None
