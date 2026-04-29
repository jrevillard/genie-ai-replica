"""Post-processing for v2 translations and RAG answers.

Applied after a provider returns, before the caller sees the text.
Scope:
  - Normalize whitespace (collapse multiple spaces, keep newlines).
  - Normalize curly quotes / em-dashes to ASCII equivalents.
  - Preserve Mandinka diacritics (ŋ ñ ɛ ɔ ɲ) — do NOT fold to ASCII.
  - Strip common LLM artifacts: leading "Translation:", "Answer:",
    trailing markdown code fences, fully-quoted wrapping.

These helpers are *additive*. None of them reach into legacy code —
they live in translation_v2 and are opt-in.
"""
from __future__ import annotations

import re


_WHITESPACE_RUNS = re.compile(r"[ \t]{2,}")
_MD_FENCE = re.compile(r"```[a-zA-Z0-9_-]*\n?|\n?```", re.MULTILINE)
_LEAD_LABEL = re.compile(
    r"^\s*(?:translation|answer|response|output|result)\s*[:\-–]\s*",
    re.IGNORECASE,
)


def normalize_mandinka(text: str) -> str:
    """Whitespace + quote normalization. Preserves diacritics."""
    if not text:
        return text
    out = text.replace("\u201c", '"').replace("\u201d", '"')
    out = out.replace("\u2018", "'").replace("\u2019", "'")
    out = out.replace("\u2013", "-").replace("\u2014", "-")
    out = _WHITESPACE_RUNS.sub(" ", out)
    return out.strip()


def strip_model_artifacts(text: str) -> str:
    """Remove common prefixes/wrappers the LLM adds uninvited.

    Order matters: markdown fences are stripped first so a
    fence-wrapped "Translation: ..." payload can have *its* leading
    label stripped on the next pass.
    """
    if not text:
        return text
    out = text.strip()
    out = _MD_FENCE.sub("", out).strip()
    out = _LEAD_LABEL.sub("", out, count=1).strip()
    # Full-string wrap: "..." or '...' → strip one layer
    if len(out) >= 2 and out[0] == out[-1] and out[0] in ('"', "'"):
        out = out[1:-1].strip()
    return out


def clean_answer(text: str) -> str:
    """Convenience: strip artifacts and normalize in one call."""
    return normalize_mandinka(strip_model_artifacts(text))
