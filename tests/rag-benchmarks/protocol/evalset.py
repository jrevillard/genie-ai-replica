# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Evaluation-set schema + composition validator.

A set file extends the existing gold schema
(``eval/gold_dataset.example.json``: ``id``, ``query``, ``categoryLabels``,
``serviceLabels``, ``language``, ``reference_answer``, ``expected_chunks``)
with the protocol fields every case carries:

* ``case_class`` — one of the composition classes (below);
* ``access_scenario`` — ``public`` or ``restricted`` (the access axis the
  schema makes explicit);
* ``provenance`` — the SET the case was authored for: ``assessment`` or
  ``tuning``. This is the separation mechanism: a case copied from a
  tuning set into an assessment file keeps its ``provenance`` and is refused —
  the check reads the case's own provenance field, never the directory it
  happens to sit in;
* ``expectations`` — optional per-class expectations dict (e.g.
  ``{"expect_abstained": true}`` for an unanswerable case, ``{"require_citation":
  true}`` for a citation check). Free-form; the driver layer reads it;
* ``script`` — optional ``latin`` / ``non-latin`` override; when absent the
  validator derives the script from the query text's Unicode blocks;
* ``security_scenario`` — optional security vocabulary: one of
  the four authorization conditions (``restricted_repo``, ``cross_user_id``,
  ``narrowed_scope``, ``permission_change``) or either injection vector
  (``injection_document``, ``injection_tool_output``). An ASSESSMENT set must
  carry and count every one of them;
* ``turns`` — optional multi-turn execution shape: a non-empty list of
  per-turn objects (``query``, optional ``context``), one per turn in strict
  execution order. When ``turns`` is present the turn list IS the case's
  queries (the case-level ``query`` is then not required). A turn's row
  carries the turn-indexed id ``<case_id>#t<n>``.

Set files carry a ``_meta`` block with the set-level ``provenance`` (must
agree with every case's) and optional ``minimums`` overrides of the composition
floor.

Composition (ASSESSMENT sets): every class must be present and countable —
answerable, unanswerable, citation_check, representative_language (including
at least one NON-LATIN case), plus the access axis (public AND restricted) and
the failure and cancellation classes. A missing class fails validation NAMING
the class and its required minimum; a complete set passes.

Evaluation surfaces — which surface measures which case: the gold
(``expected_chunks``) is consumed by ONE surface only, the chunk-level
retrieval surface; every other surface is judged from what the run RECORDED.
The surfaces and their consequences are documented in
``tests/rag-benchmarks/CLAUDE.md``; the rules live in
:func:`evaluation_surface` and :func:`coverage_census`.

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

# The composition classes an ASSESSMENT set must carry.
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

# The security vocabulary a case's optional ``security_scenario`` field draws
# from: the four authorization conditions, then the two
# injection vectors. Security scenarios execute only on configs B and C (the
# surfaces with an authorization executor and a steerable agent); a config-A
# reference run records them as skipped rows.
AUTHORIZATION_SCENARIOS = (
    "restricted_repo",
    "cross_user_id",
    "narrowed_scope",
    "permission_change",
)
INJECTION_SCENARIOS = ("injection_document", "injection_tool_output")
SECURITY_SCENARIOS = AUTHORIZATION_SCENARIOS + INJECTION_SCENARIOS

# The per-scenario minimums for an ASSESSMENT set (each of the four
# authorization conditions and both injection vectors present and countable).
# Extends the same ``_meta.minimums`` override mechanism as the composition
# classes: an operator may raise them, never lower them below 1 — presence is
# the invariant.
DEFAULT_SECURITY_MINIMUMS = {scenario: 1 for scenario in SECURITY_SCENARIOS}

# The evaluation surface a case is measured on. The chunk-level RETRIEVAL
# surface is the only consumer of ``expected_chunks``: the protocol's gold
# identity is the chunk's content hash, and the config-A anchor is the only
# instrument that scores passages. The other three surfaces are judged from
# what the run RECORDED — the answer, its outcome, the retrieved document ids
# — so a case on one of them carries no gold BY DESIGN, and a case on the
# retrieval surface without gold is measured by NOTHING (the anchor driver
# refuses it — see :func:`evaluation_surface` and :func:`coverage_census`).
SURFACES = ("retrieval", "outcome", "security", "restricted_access", "unknown")

# The classes measured on the chunk-level retrieval surface.
RETRIEVAL_CLASSES = ("answerable", "citation_check", "representative_language")

# The classes judged from the recorded OUTCOME (abstention, typed failure,
# cancellation) — never from passages. DERIVED from the composition classes,
# so a new class lands on exactly one of the two surfaces.
OUTCOME_CLASSES = tuple(
    case_class for case_class in COMPOSITION_CLASSES if case_class not in RETRIEVAL_CLASSES
)

# The outcome-surface model in ONE place (#2156): each outcome class pairs
# with exactly the expectation key the verdict layer reads for its non-answer
# outcome. The class vocabulary decides the SURFACE; this pairing decides
# WHICH outcome is the expected one — and the validator refuses a case whose
# class and expectations disagree, so the surface rule and the verdict
# layer's predicates cannot drift apart inside a validated set.
# ``expect_denied`` is NOT in this table: it is the SECURITY surface's
# expectation (an authorization case wants the refusal), not an outcome
# class's.
OUTCOME_CLASS_EXPECTATIONS = {
    "unanswerable": "expect_abstained",
    "failure": "expect_typed_failure",
    "cancellation": "expect_cancelled",
}

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
    the query text's Unicode blocks. A multi-turn case's queries live in its
    turns — the judgment reads them (any non-Latin turn makes the case
    non-Latin)."""
    script = case.get("script")
    if script == "non-latin":
        return True
    if script == "latin":
        return False
    turns = case.get("turns")
    if turns:
        return any(isinstance(turn, dict) and case_is_non_latin(turn) for turn in turns)
    return has_non_latin_text(str(case.get("query", "")))


def as_label_list(value) -> list[str]:
    """The label shape a request carries: a LIST of labels, or a bare STRING
    that is ONE label; an EMPTY value is no label at all.

    The server's own rule (chatqna's ``core.label_contract``): a string is
    one label (the legacy shape) and an empty label is not a scope. A string
    split into characters would be a silent lie about the scope.

    Mirrors the server's SHAPE rule: ``_as_label_list`` takes a LIST as-is
    and treats every other truthy value as ONE scalar. The FALSY labels
    (``""``, ``None``, ``0``, ``False``) are dropped by THIS function's own
    loop — the server drops them later, in ``build_filter_labels``, and only
    for the labels it builds. A whitespace-only label is KEPT (the wire is
    verbatim). The server's filter builder additionally DEDUPS the labels it
    builds; this coercion keeps the request's own list, and the report
    compares the two legs' scopes as sets — so the dedup carries no scope
    meaning.

    ONE documented divergence, on the SERVICE field: the server takes its
    service branch on any service label that is not ``None`` and not ``""``
    — a falsy ``0`` keeps the branch and ECLIPSES the declared category, so
    the server's filter ends up EMPTY (the retriever runs unfiltered). This
    coercion drops the falsy service label, so the protocol's record of the
    scope differs from the server's. The report compares the legs' EFFECTIVE
    filters (what each leg really applied), so the difference surfaces as a
    scope difference rather than as a silent claim.
    """
    if not value:
        return []
    items = value if isinstance(value, list) else [value]
    labels = []
    for item in items:
        # A falsy element is not a label (the server drops it too).
        if not item:
            continue
        labels.append(item if isinstance(item, str) else str(item))
    return labels


def base_case_id(case_id: str) -> str:
    """The case id behind a turn-indexed row id (``<case_id>#t<n>``) — the
    grammar :func:`turn_entries` owns, parsed in one place."""
    return str(case_id).split("#", 1)[0]


def turn_entries(case: dict) -> list[dict]:
    """The case's per-turn execution entries — ONE expansion, shared by the
    drivers and the verdict layer so the row ids and the verdict ids can never
    drift.

    A single-turn case yields the case itself; a multi-turn case yields one
    entry per turn: the turn-indexed id ``<case_id>#t<n>`` (1-based, in the
    turns' declared order), the turn's own ``query``/``context`` overriding the
    case-level ones, the 1-based ``turn`` index recorded on the entry (the
    driver copies it into the row), and the ``turns`` block itself dropped.
    """
    turns = case.get("turns")
    if not turns:
        return [case]
    entries = []
    for index, turn in enumerate(turns, start=1):
        entry = {key: value for key, value in case.items() if key != "turns"}
        if isinstance(turn, dict):
            entry.update(turn)
        entry["id"] = f"{case.get('id')}#t{index}"
        entry["turn"] = index
        entries.append(entry)
    return entries


def evaluation_surface(case: dict) -> str:
    """The surface this case is measured on — the ONE place that decides it.

    * ``security`` — the case carries a ``security_scenario``: the protocol
      runs security scenarios on the pair's B/C legs only (the surfaces with
      an authorization executor and a steerable agent), and the verdict layer
      judges them from the retrieved document ids, never from passages.
    * ``outcome`` — the case's class asserts an outcome (abstention, typed
      failure, cancellation): judged from the recorded outcome.
    * ``restricted_access`` — the case's sources live in a restricted graph:
      config A has no authorization surface (it is the legacy fixed RAG), so
      the case is an authorization case and is measured on the B/C legs'
      document-level surface. It is also a MECHANICAL exclusion: the anchor's
      key→hash map covers the public source collection only, so a restricted
      chunk can never map — anchoring such a case would fail the run on
      unmapped chunk keys instead of measuring anything.
    * ``retrieval`` — a retrieval-class case with public access and no
      security scenario: the chunk-level surface, the only one that consumes
      ``expected_chunks``.
    * ``unknown`` — a malformed case (its class is not one of the six); the
      validator already names that offense.
    """
    if case.get("security_scenario"):
        return "security"
    case_class = case.get("case_class")
    if case_class in OUTCOME_CLASSES:
        return "outcome"
    if case_class in RETRIEVAL_CLASSES:
        return "restricted_access" if case.get("access_scenario") == "restricted" else "retrieval"
    return "unknown"


def coverage_census(entries: list[dict]) -> dict:
    """What the set covers, per evaluation surface.

    A SET-level statement, not a run-level one: ``n_set_cases`` counts the
    set's CASES (a multi-turn case is one case; its turns are rows), and
    ``n_cases_with_a_resolved_surface`` counts the cases whose surface is
    RESOLVED — a retrieval case without gold has no resolved surface (it is
    measured by nothing), every other case is resolved by construction. It
    says NOTHING about how many cases a run answered: the rows file carries
    that (answered / skipped), and the two numbers must not be read as one.

    For a set the anchor can measure, every case has a resolved surface — the
    invariant the anchor driver enforces.
    """
    by_surface = {surface: 0 for surface in SURFACES}
    unresolved: list[str] = []
    for case in entries:
        if not isinstance(case, dict):
            continue
        surface = evaluation_surface(case)
        by_surface[surface] = by_surface.get(surface, 0) + 1
        if surface == "retrieval" and not case.get("expected_chunks"):
            unresolved.append(str(case.get("id")))
    n_cases = sum(by_surface.values())
    return {
        "n_set_cases": n_cases,
        "n_cases_with_a_resolved_surface": n_cases - len(unresolved),
        "by_surface": by_surface,
        "retrieval_cases_without_gold": unresolved,
    }


def _validate_case(index: int, case: dict, errors: list[str]) -> None:
    """One case's schema: the fields every case carries, whatever the set kind."""
    if not isinstance(case, dict):
        errors.append(f"entry {index} is not an object")
        return
    label = case.get("id") or f"<entry {index}>"
    if not case.get("id") or not isinstance(case.get("id"), str):
        errors.append(f"entry {index} carries no string id")
    turns = case.get("turns")
    if turns is not None:
        if not isinstance(turns, list) or not turns:
            errors.append(f"case {label}: turns, when present, must be a non-empty list of per-turn objects")
        else:
            for turn_index, turn in enumerate(turns, start=1):
                if not isinstance(turn, dict):
                    errors.append(f"case {label}: turn {turn_index} is not an object")
                    continue
                if not str(turn.get("query", "")).strip():
                    errors.append(f"case {label}: turn {turn_index} must carry query text")
                if turn.get("context") is not None and not isinstance(turn.get("context"), dict):
                    errors.append(f"case {label}: turn {turn_index} context, when present, must be an object")
    elif not str(case.get("query", "")).strip():
        # A multi-turn case's queries live in its turns; a single-turn case
        # carries the case-level query.
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
        return
    # The outcome-surface pairing: an outcome-class case carrying an outcome
    # expectation that is not ITS class's is a contradiction — the surface
    # says 'judged from the recorded outcome' while the expectation names a
    # different outcome (or the security surface's denial). Refused here, so
    # the surface model and the verdict layer's predicates cannot drift.
    if case.get("case_class") in OUTCOME_CLASS_EXPECTATIONS and expectations:
        expected_key = OUTCOME_CLASS_EXPECTATIONS[case.get("case_class")]
        outcome_keys = set(OUTCOME_CLASS_EXPECTATIONS.values()) | {"expect_denied"}
        carried = sorted(key for key in expectations if key in outcome_keys)
        wrong = [key for key in carried if key != expected_key]
        if wrong:
            errors.append(
                f"case {label}: class {case.get('case_class')!r} pairs with {expected_key!r} but carries"
                f" {', '.join(wrong)} — an outcome expectation that names another outcome"
                " (or the security surface's denial); the surface and the verdict layer"
                " would read the case differently"
            )
    if case.get("script") is not None and case.get("script") not in ("latin", "non-latin"):
        errors.append(f"case {label}: script, when present, must be 'latin' or 'non-latin'")
    if case.get("security_scenario") is not None and case.get("security_scenario") not in SECURITY_SCENARIOS:
        errors.append(
            f"case {label}: security_scenario must be one of {', '.join(SECURITY_SCENARIOS)}"
            f" (got {case.get('security_scenario')!r})"
        )


def _validate_composition(
    entries: list[dict],
    set_provenance: str,
    minimums_override: dict | None,
    errors: list[str],
) -> None:
    """The ASSESSMENT composition floor + the tuning/assessment separation."""
    class_minimums = dict(DEFAULT_COMPOSITION_MINIMUMS)
    access_minimums = dict(DEFAULT_ACCESS_MINIMUMS)
    security_minimums = dict(DEFAULT_SECURITY_MINIMUMS)
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
        elif key in security_minimums:
            security_minimums[key] = numeric
        elif key == "non_latin":
            non_latin_minimum = numeric
        else:
            errors.append(f"_meta.minimums: unknown composition key {key!r}")

    counts: dict[str, int] = {c: 0 for c in COMPOSITION_CLASSES}
    access_counts: dict[str, int] = {a: 0 for a in ACCESS_SCENARIOS}
    security_counts: dict[str, int] = {s: 0 for s in SECURITY_SCENARIOS}
    for case in entries:
        if not isinstance(case, dict):
            continue
        case_class = case.get("case_class")
        if case_class in counts:
            counts[case_class] += 1
        if case.get("access_scenario") in access_counts:
            access_counts[case["access_scenario"]] += 1
        if case.get("security_scenario") in security_counts:
            security_counts[case["security_scenario"]] += 1

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

    # The security floor: each of the four authorization
    # conditions and both injection vectors present and countable — a set
    # missing one fails naming it.
    for scenario, minimum in security_minimums.items():
        if security_counts.get(scenario, 0) < minimum:
            errors.append(
                f"composition: security scenario {scenario!r} is missing or under-counted"
                f" ({security_counts.get(scenario, 0)} present, {minimum} required)"
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
        # The separation, by provenance — ONE call site for both
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
