"""Bridge polish — post-translation medical-lexicon substitution.

======================================================================
Stage 8 of the EN -> Mandinka refactor. Strictly additive: the module
is a no-op unless USE_V2_BRIDGE_POLISH is explicitly enabled.
======================================================================

Context
-------
Observed translator output (diabetes/DKA education, Apr 2026) uses
authentic Mandinka phonology, greetings, and function words but leaks
nearly every medical content word as raw English: "diabetes",
"symptoms", "nausea", "vomiting", "hospital", "monitor", "hydrated",
"blood glucose", etc. The LLM honors the glossary prompt snippet only
loosely; post-translation substitution catches the residue.

What this does
--------------
1. Apply the glossary's English -> Mandinka word-boundary substitution
   on already-translated text (the same pass NLLB gets today, extended
   to LLM output).
2. Handle common morphology (trailing 's' plural, '-ing' gerund) so
   "symptoms", "breathing", "drinking", "helping" all resolve even
   when the CSV only has the base form.
3. Safety net: never touch preserved terms (do-not-translate rows)
   and never rewrite tokens shorter than 3 characters (avoids
   clobbering Mandinka particles that happen to spell-collide with
   short English words).

What this deliberately does NOT do
----------------------------------
- Does NOT call the LLM a second time.
- Does NOT attempt grammar correction, inflection, or tone-marking.
  Those require a proper morphological analyzer.
- Does NOT translate numerals, units, or proper nouns.
- Does NOT modify text when source and target are the same language.

Activation
----------
Set ``USE_V2_BRIDGE_POLISH=true`` in the environment. The Router
checks the flag per request and applies the polish only when both the
flag and a glossary are present. Disabling the flag reverts to
pre-bridge output in zero keystrokes.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from translation_v2.glossary import Glossary

logger = logging.getLogger(__name__)


# Morphological variants we synthesize at pattern-build time. If the
# glossary has "symptom", we also match "symptoms". If it has "breath",
# we also match "breathing". Keep this list short and conservative —
# over-matching corrupts legitimate Mandinka tokens.
_PLURAL_SUFFIXES = ("s", "es")
_GERUND_SUFFIXES = ("ing",)

# Do not substitute any English token shorter than this, even when it
# appears in the glossary. Many Mandinka particles (ko, la, ye, mu, be)
# collide with 2-3 letter English words.
_MIN_TOKEN_LEN = 3


def _build_variants(en_term: str) -> list[str]:
    """Return case-insensitive surface forms for one glossary entry.

    Includes the base form plus conservative morphological variants.
    Multi-word entries are returned as-is (no variant generation).
    """
    base = en_term.strip()
    if not base:
        return []

    # Multi-word entries (e.g. "blood pressure", "health post") only
    # match their exact surface form; generating variants risks bad
    # cross-term overlaps.
    if " " in base:
        return [base]

    lower = base.lower()
    variants = {lower}

    # Plural: "symptom" -> "symptoms". Skip if already ends in 's' to
    # avoid producing "symptomss".
    if not lower.endswith("s") and len(lower) >= _MIN_TOKEN_LEN:
        for s in _PLURAL_SUFFIXES:
            variants.add(lower + s)

    # Gerund: "breath" -> "breathing", "drink" -> "drinking".
    # Only generate if the base is a plausible verb stem (alphabetic).
    if lower.isalpha() and len(lower) >= _MIN_TOKEN_LEN:
        for g in _GERUND_SUFFIXES:
            variants.add(lower + g)
            # "drinking" requires doubling the consonant; cover common
            # single-syllable verb forms we know about ("drink", "run",
            # "swim"). Conservative: only double when last char is a
            # single consonant and second-to-last is a single vowel.
            if (
                len(lower) >= 3
                and lower[-1] not in "aeiou"
                and lower[-2] in "aeiou"
                and lower[-3] not in "aeiou"
            ):
                variants.add(lower + lower[-1] + g)

    return sorted(variants, key=len, reverse=True)  # longest first


def polish_mandinka(text: str, glossary: "Glossary") -> str:
    """Apply glossary-driven medical lexicon substitution to output.

    Parameters
    ----------
    text : str
        Already-translated Mandinka text (typically LLM output).
    glossary : Glossary
        Loaded glossary instance — entries with empty mnk_term or
        do_not_translate=True are skipped.

    Returns
    -------
    str
        Polished text with known English medical terms replaced by
        their Mandinka equivalents. Idempotent — running twice yields
        the same result.

    Notes
    -----
    This is synchronous and deliberately cheap (<1ms for typical
    chat turns). It is safe to call in the request hot path.
    """
    if not text or not glossary or len(glossary) == 0:
        return text

    out = text
    substitutions = 0

    for entry in glossary.entries():
        if entry.do_not_translate:
            continue
        if not entry.mnk or not entry.en:
            continue
        if len(entry.en) < _MIN_TOKEN_LEN and " " not in entry.en:
            continue

        variants = _build_variants(entry.en)
        for variant in variants:
            # Word-boundary match, case-insensitive. \b works on ASCII
            # word chars; Mandinka extended characters (ɔ ɛ ŋ) count as
            # non-word, which is what we want at substitution boundaries.
            pattern = r"\b" + re.escape(variant) + r"\b"
            new_out, count = re.subn(pattern, entry.mnk, out, flags=re.IGNORECASE)
            if count:
                substitutions += count
                out = new_out

    if substitutions:
        logger.debug(
            "bridge_polish: %d substitution(s) applied (len %d -> %d)",
            substitutions,
            len(text),
            len(out),
        )

    return out


def should_polish(source: str, target: str) -> bool:
    """True if bridge polish should run for this source/target pair.

    Currently limited to English -> Mandinka; other language pairs
    would need their own glossary file and are out of scope here.
    """
    s = (source or "").lower()
    t = (target or "").lower()
    if s == t:
        return False
    return s in ("en", "eng") and t in ("ma", "mnk")
