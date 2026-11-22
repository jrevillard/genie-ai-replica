# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Evaluation-set schema + composition validator (FR-24, story 4.1).

A set file extends the existing gold schema
(``eval/gold_dataset.example.json``: ``id``, ``query``, ``categoryLabels``,
``serviceLabels``, ``language``, ``reference_answer``, ``expected_chunks``)
with the protocol fields every case carries:

* ``case_class`` — one of the composition classes (below);
* ``access_scenario`` — ``public`` or ``restricted`` (the access axis FR-24
  makes explicit);
* ``provenance`` — the SET the case was authored for: ``assessment`` or
  ``tuning``. This is the separation mechanism (FR-24): a case copied from a
  tuning set into an assessment file keeps its ``provenance`` and is refused —
  the check reads the case's own provenance field, never the directory it
  happens to sit in;
* ``expectations`` — optional per-class expectations dict (e.g.
  ``{"expect_abstained": true}`` for an unanswerable case, ``{"require_citation":
  true}`` for a citation check). Free-form; the driver layer reads it;
* ``script`` — optional ``latin`` / ``non-latin`` override; when absent the
  validator derives the script from the query text's Unicode blocks.

Set files carry a ``_meta`` block with the set-level ``provenance`` (must
agree with every case's) and optional ``minimums`` overrides of the composition
floor.

Composition (ASSESSMENT sets): every class must be present and countable —
answerable, unanswerable, citation_check, representative_language (including
at least one NON-LATIN case), plus the access axis (public AND restricted) and
the failure and cancellation classes. A missing class fails validation NAMING
the class and its required minimum; a complete set passes.

TUNING sets are composition-free (they exist to tune, not to assess) but keep
the schema and the provenance symmetry: a tuning set refuses an
assessment-provenance case.

The committed sample sets under ``sets/`` demonstrate every class and are the
validator's CI fixtures — they are NOT deployment case content.
"""

from __future__ import annotations

import json
from pathlib import Path

PROVENANCES = ("assessment", "tuning")

# The composition classes an ASSESSMENT set must carry (FR-24).
COMPOSITION_CLASSES = (
    "answerable",
    "unanswerable",
    "citation_check",
    "representative_language",
    "failure",
    "cancellation",
)

# The access scenarios an ASSESSMENT set must cover.
ACCESS_SCENARIOS = ("public", "restricted")

# The per-class minimums for an ASSESSMENT set (a set missing a class fails
# naming the class and this minimum). Overridable per set via ``_meta.minimums``
# (an operator may raise them, never lower them below 1 — presence is the
# invariant).
DEFAULT_COMPOSITION_MINIMUMS = {
    "answerable": 2,
    "unanswerable": 1,
    "citation_check": 1,
    "representative_language": 2,
    "failure": 1,
    "cancellation": 1,
}

DEFAULT_ACCESS_MINIMUMS = {"public": 1, "restricted": 1}

# The minimum of non-Latin cases inside the representative_language class.
DEFAULT_NON_LATIN_MINIMUM = 1

# Unicode blocks a NON-Latin script case must draw from. Latin (including the
# extensions) ends at U+024F; everything this protocol treats as non-Latin
# lives in the listed ranges. The list is deliberately explicit — a case in an
# unlisted script derives as Latin and the validator says so, rather than
# guessing.
NON_LATIN_RANGES: tuple[tuple[int, int], ...] = (
    (0x0370, 0x03FF),  # Greek
    (0x0400, 0x04FF),  # Cyrillic
    (0x0590, 0x05FF),  # Hebrew
    (0x0600, 0x06FF),  # Arabic
    (0x0900, 0x097F),  # Devanagari
    (0x0E00, 0x0E7F),  # Thai
    (0x3040, 0x30FF),  # Hiragana + Katakana
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0xAC00, 0xD7AF),  # Hangul syllables
)


class SetValidationError(ValueError):
    """The set file is not a valid evaluation set.

    ``errors`` carries every offense found — one human-readable sentence per
    offense, naming the class, the minimum or the offending case id, so the
    operator fixes the set in one pass instead of one run per error.
    """

    def __init__(self, errors: list[str]):
        self.errors = errors
        joined = "; ".join(errors)
        super().__init__(f"evaluation set invalid ({len(errors)} error(s)): {joined}")


def has_non_latin_text(text: str) -> bool:
    """True when ``text`` carries at least one character from a non-Latin block."""
    for ch in text or "":
        code = ord(ch)
        for low, high in NON_LATIN_RANGES:
            if low <= code <= high:
                return True
    return False


def case_is_non_latin(case: dict) -> bool:
    """The case's script judgment: the explicit ``script`` override first, then
    the query text's Unicode blocks."""
    script = case.get("script")
    if script == "non-latin":
        return True
    if script == "latin":
        return False
    return has_non_latin_text(str(case.get("query", "")))


def _validate_case(index: int, case: dict, errors: list[str]) -> None:
    """One case's schema: the fields every case carries, whatever the set kind."""
    if not isinstance(case, dict):
        errors.append(f"entry {index} is not an object")
        return
    label = case.get("id") or f"<entry {index}>"
    if not case.get("id") or not isinstance(case.get("id"), str):
        errors.append(f"entry {index} carries no string id")
    if not str(case.get("query", "")).strip():
        errors.append(f"case {label}: query must carry text")
    if not str(case.get("language", "")).strip():
        errors.append(f"case {label}: language is required (representative-language axis)")
    if case.get("case_class") not in COMPOSITION_CLASSES:
        errors.append(
            f"case {label}: case_class must be one of {', '.join(COMPOSITION_CLASSES)} (got {case.get('case_class')!r})"
        )
    if case.get("access_scenario") not in ACCESS_SCENARIOS:
        errors.append(
            f"case {label}: access_scenario must be one of {', '.join(ACCESS_SCENARIOS)}"
            f" (got {case.get('access_scenario')!r})"
        )
    if case.get("provenance") not in PROVENANCES:
        errors.append(
            f"case {label}: provenance must be one of {', '.join(PROVENANCES)}"
            f" (got {case.get('provenance')!r}) — the tuning/assessment separation reads this field"
        )
    expectations = case.get("expectations")
    if expectations is not None and not isinstance(expectations, dict):
        errors.append(f"case {label}: expectations, when present, must be an object")
    if case.get("script") is not None and case.get("script") not in ("latin", "non-latin"):
        errors.append(f"case {label}: script, when present, must be 'latin' or 'non-latin'")


def _validate_composition(
    entries: list[dict],
    set_provenance: str,
    minimums_override: dict | None,
    errors: list[str],
) -> None:
    """The ASSESSMENT composition floor + the tuning/assessment separation."""
    class_minimums = dict(DEFAULT_COMPOSITION_MINIMUMS)
    access_minimums = dict(DEFAULT_ACCESS_MINIMUMS)
    non_latin_minimum = DEFAULT_NON_LATIN_MINIMUM
    for key, value in (minimums_override or {}).items():
        try:
            numeric = max(1, int(value))
        except (TypeError, ValueError):
            errors.append(f"_meta.minimums: {key!r} must be a number (got {value!r})")
            continue
        if key in class_minimums:
            class_minimums[key] = numeric
        elif key in access_minimums:
            access_minimums[key] = numeric
        elif key == "non_latin":
            non_latin_minimum = numeric
        else:
            errors.append(f"_meta.minimums: unknown composition key {key!r}")

    counts: dict[str, int] = {c: 0 for c in COMPOSITION_CLASSES}
    access_counts: dict[str, int] = {a: 0 for a in ACCESS_SCENARIOS}
    for case in entries:
        if not isinstance(case, dict):
            continue
        case_class = case.get("case_class")
        if case_class in counts:
            counts[case_class] += 1
        if case.get("access_scenario") in access_counts:
            access_counts[case["access_scenario"]] += 1

    for case_class, minimum in class_minimums.items():
        if counts.get(case_class, 0) < minimum:
            errors.append(
                f"composition: class {case_class!r} is missing or under-counted"
                f" ({counts.get(case_class, 0)} present, {minimum} required)"
            )

    non_latin = sum(
        1
        for c in entries
        if isinstance(c, dict) and c.get("case_class") == "representative_language" and case_is_non_latin(c)
    )
    if non_latin < non_latin_minimum:
        errors.append(
            "composition: representative_language must include at least"
            f" {non_latin_minimum} non-Latin case(s) ({non_latin} present)"
        )

    for scenario, minimum in access_minimums.items():
        if access_counts.get(scenario, 0) < minimum:
            errors.append(
                f"composition: access scenario {scenario!r} is missing or under-counted"
                f" ({access_counts.get(scenario, 0)} present, {minimum} required)"
            )


def _validate_separation(entries: list[dict], set_provenance: str, errors: list[str]) -> None:
    """Every case's provenance must match the set's namespace — the check is
    the same for assessment and tuning sets (symmetric, provenance-based)."""
    for case in entries:
        if not isinstance(case, dict):
            continue
        case_provenance = case.get("provenance")
        if case_provenance and case_provenance != set_provenance:
            errors.append(
                f"separation: case {case.get('id')!r} carries provenance"
                f" {case_provenance!r} but the set is {set_provenance!r}"
                " — a case sourced from the other namespace is refused"
            )


def validate_set(data: dict, kind: str | None = None) -> list[str]:
    """Validate one parsed set file; return the error list (empty = valid).

    ``kind`` (``assessment`` / ``tuning``) overrides the set's own
    ``_meta.provenance`` for the composition decision; when None the
    set-level provenance decides. The set-level provenance must agree with
    every case's own provenance field either way.
    """
    errors: list[str] = []
    meta = data.get("_meta")
    if not isinstance(meta, dict):
        errors.append("_meta block is required (it carries the set provenance)")
        meta = {}
    set_provenance = kind or meta.get("provenance")
    if set_provenance not in PROVENANCES:
        errors.append(f"set provenance must be one of {', '.join(PROVENANCES)} (got {set_provenance!r})")
        set_provenance = None
    if kind and meta.get("provenance") and meta["provenance"] != kind:
        errors.append(f"_meta.provenance {meta['provenance']!r} disagrees with the requested kind {kind!r}")

    entries = data.get("entries")
    if not isinstance(entries, list) or not entries:
        errors.append("entries must be a non-empty list")
        entries = []
    seen_ids: set[str] = set()
    for index, case in enumerate(entries):
        _validate_case(index, case, errors)
        case_id = case.get("id") if isinstance(case, dict) else None
        if isinstance(case_id, str):
            if case_id in seen_ids:
                errors.append(f"case id {case_id!r} appears more than once")
            seen_ids.add(case_id)

    if set_provenance == "assessment":
        _validate_composition(entries, set_provenance, meta.get("minimums"), errors)
    if set_provenance:
        # The separation (FR-24), by provenance — ONE call site for both
        # provenances: the mismatch is a schema-level offense, never a
        # composition one, and no composition refactor can lose the check.
        _validate_separation(entries, set_provenance, errors)

    return errors


def validate_set_or_raise(data: dict, kind: str | None = None) -> list[dict]:
    """Validate and return the entries; raise :class:`SetValidationError` otherwise."""
    errors = validate_set(data, kind)
    if errors:
        raise SetValidationError(errors)
    return data.get("entries", [])


def load_set(path: str | Path, kind: str | None = None) -> tuple[dict, list[dict]]:
    """Load + validate a set file; return ``(data, entries)`` or raise."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data, validate_set_or_raise(data, kind)
