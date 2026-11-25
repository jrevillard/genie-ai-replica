# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The ported language detection (deployed ``chatqna:4578-4672``).

Three decisions are ported, and one is deliberately NOT:

* the detection input is the LAST USER message when nothing usable is named —
  the whole string in the single-message shape, the last ``role == "user"``
  entry in the list shape;
* the detected code is UPPERCASE (``"FR"``, ``"EN"``, ``"ZH-CN"``) and it
  becomes the HISTORY language whether or not the translation models cover
  it: the history still has to be normalized to English for the English-only
  embedding space, so even a code the map does not key (``zh-cn``) names the
  source;
* a detection crash is "no detection" — it never raises to the caller;
* the deployed ``is_supported`` gate is NOT ported: it steers only the
  ANSWER language, which stays BFF-owned. Preparation records no answer
  language and runs no answer fallback.

langdetect runs UNSEEDED in production (deployed parity — the detector is
non-deterministic; the record states that a re-run may produce a different
detected code). Tests seed ``DetectorFactory`` for stability.

The BFF's refused-language case cannot reach this module: the BFF answers
HTTP 400 ``UNSUPPORTED_LANGUAGE`` before the agent path sees the request
A named code the registry does not know therefore behaves here
as "nothing named" — detection runs — which is the same trigger the deployed
refusal produces; no separate refused branch is built.
"""

import logging

from langdetect import detect

logger = logging.getLogger(__name__)

# The longest a caller-supplied language may be (deployed MAX_LANGUAGE_LENGTH,
# applied in the same order as the backend: trim, then cut, then lowercase).
MAX_LANGUAGE_LENGTH = 32


def last_user_content(history: list | str) -> str:
    """The text detection reads: the whole string, or the last user message.

    Deployed rule: a plain-string history is detected as a whole; a message
    list is scanned NEWEST first for the first entry whose role is ``user``.
    A message with no content key contributes an empty string.
    """
    if isinstance(history, str):
        return history
    for message in reversed(history):
        if message.get("role") == "user":
            return message.get("content", "")
    return ""


def detect_language(history: list | str) -> str | None:
    """The detected language, upper case, or None when nothing was detected.

    langdetect runs only when there is content to detect on (deployed: the
    call is guarded by the truthiness of the last user content). ANY crash is
    "no detection": the deployed handler logs a warning and falls to the
    answer-side EN fallback, and the history side then has no detected code —
    the caller classifies that as ``passthrough_unknown_language``. This
    module never lets a detector crash reach the caller.
    """
    text = last_user_content(history)
    if not text:
        return None
    try:
        detected = detect(text)
    except Exception as e:
        logger.warning(f"Language detection failed: {e}")
        return None
    return detected.upper() if detected else None


def resolve_named_language(raw_language, language_codes: dict) -> str | None:
    """The code a named caller language resolves to, upper case, or None.

    The value is trimmed, then cut to :data:`MAX_LANGUAGE_LENGTH`, then
    lower-cased — the trim comes FIRST so a language the caller padded with
    spaces still names itself (a language cut before it is trimmed is a
    language that disappears). ``"auto"`` is a request to detect, not a
    language; a code the map does not know is not accepted here (the BFF has
    already refused it — see the module docstring).
    """
    if not isinstance(raw_language, str):
        return None
    candidate = raw_language.strip()[:MAX_LANGUAGE_LENGTH].lower()
    if not candidate or candidate == "auto":
        return None
    if candidate not in language_codes:
        return None
    return candidate.upper()
