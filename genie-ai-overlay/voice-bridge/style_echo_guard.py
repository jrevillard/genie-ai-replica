# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Drop lines in which the assistant repeats its style setting.

The voice bridge gives the model the Topic Module's style setting as a system
message ("Style preferences for your reply ...", "- Tone: ...", "- Length: ...",
built by _build_personality_prompt in genieai_voice_bridge.py). The model
sometimes reads these lines out before its answer. They are removed here, in
plain code, before a reply is spoken, shown or kept in the call history.

A line is a repeat when it starts with the label of a line of the style
setting: the text before its first "(" or ":". The labels are taken from the
setting itself, so they follow its wording.
"""

import re

# Sentences end at . ! ? … followed by whitespace, or at a line break. The
# separators are kept so the reply's formatting survives.
_SENTENCE_SPLIT = re.compile(r"((?<=[.!?…])\s+|\n+)")
# List markers, quotes and markdown at the start of a line ("- ", "**", "2. ").
_LEAD = re.compile(r"^[\s\"'“”>*_#•\-–—]*(?:\d+[.)]\s*)?[\s*_]*")
_SPACES = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _SPACES.sub(" ", _LEAD.sub("", text or "").replace("**", "")).strip().lower()


def echo_labels(setting: str) -> tuple:
    """The label at the start of each line of a style setting.

    The label is the text before the line's first "(" or ":"; a ":" is kept, so
    "Tone:" matches and "Tone of voice" does not.
    """
    labels = []
    for line in (setting or "").splitlines():
        norm = _normalize(line)
        cut = min((i for i in (norm.find("("), norm.find(":")) if i >= 0), default=-1)
        if cut <= 0:
            continue
        label = norm[: cut + 1] if norm[cut] == ":" else norm[:cut].rstrip()
        if label and label not in labels:
            labels.append(label)
    return tuple(labels)


def is_echo(sentence: str, labels: tuple) -> bool:
    """True when the sentence starts with one of the labels."""
    norm = _normalize(sentence)
    return bool(norm) and any(norm.startswith(label) for label in labels)


def strip_echo(text: str, labels: tuple) -> str:
    """Remove each sentence or line that repeats the style setting.

    A text without such a sentence is returned unchanged.
    """
    if not text or not labels:
        return text
    parts = _SENTENCE_SPLIT.split(text)
    if not any(is_echo(s, labels) for s in parts[0::2]):
        return text
    out = []
    skip_separator = False
    for i, part in enumerate(parts):
        if i % 2 == 1:
            if not skip_separator:
                out.append(part)
            skip_separator = False
            continue
        if is_echo(part, labels):
            # Drop the line and the separator after it.
            skip_separator = True
            continue
        out.append(part)
    return "".join(out).strip()
