# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/evalset.py — the set schema + composition validator.

The committed sample sets are the validator's fixtures: the assessment sample
must validate (it demonstrates every class) and the tuning sample must
separate. Every mutation test starts from the valid sample and breaks exactly
one thing.
"""

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

from protocol import evalset as es
from protocol.run_protocol import cmd_validate_set

PROTOCOL_DIR = Path(__file__).resolve().parent / "protocol"
ASSESSMENT_SAMPLE = PROTOCOL_DIR / "sets" / "assessment.sample.json"
TUNING_SAMPLE = PROTOCOL_DIR / "sets" / "tuning.sample.json"


@pytest.fixture()
def assessment_data():
    return json.loads(ASSESSMENT_SAMPLE.read_text(encoding="utf-8"))


def test_assessment_sample_validates():
    """The sample set demonstrates every composition class — the validator must pass it."""
    _, entries = es.load_set(ASSESSMENT_SAMPLE, "assessment")
    classes = {c["case_class"] for c in entries}
    assert classes == set(es.COMPOSITION_CLASSES)
    assert {c["access_scenario"] for c in entries} == set(es.ACCESS_SCENARIOS)
    scenarios = {c["security_scenario"] for c in entries if c.get("security_scenario")}
    assert scenarios == set(es.SECURITY_SCENARIOS)


# --- Security vocabulary + minimums -------------------------------------------


def test_unknown_security_scenario_value_is_a_typed_error(assessment_data):
    assessment_data["entries"][0]["security_scenario"] = "not-a-scenario"
    errors = es.validate_set(assessment_data, "assessment")
    assert any("security_scenario" in e and "not-a-scenario" in e for e in errors)


def test_tuning_set_is_security_composition_free(assessment_data):
    """A tuning set is composition-free — a single security case validates."""
    data = json.loads(TUNING_SAMPLE.read_text(encoding="utf-8"))
    data["entries"][0]["security_scenario"] = "injection_document"
    assert es.validate_set(data, "tuning") == []


def test_security_scenario_case_with_context_object_validates():
    data = {
        "_meta": {"provenance": "tuning"},
        "entries": [
            {
                "id": "x",
                "query": "q",
                "language": "en",
                "access_scenario": "public",
                "case_class": "answerable",
                "provenance": "tuning",
                "security_scenario": "restricted_repo",
                "context": {"user_id": "u", "authorized_source_ids": ["d-1"]},
            }
        ],
    }
    assert es.validate_set(data, "tuning") == []


# --- Multi-turn shape ---------------------------------------------------------


def test_multiturn_case_validates_and_query_is_then_optional():
    data = {
        "_meta": {"provenance": "tuning"},
        "entries": [
            {
                "id": "mt",
                "case_class": "answerable",
                "provenance": "tuning",
                "language": "en",
                "access_scenario": "public",
                "turns": [
                    {"query": "turn one", "context": {"user_id": "u"}},
                    {"query": "turn two"},
                ],
            }
        ],
    }
    assert es.validate_set(data, "tuning") == []


def test_multiturn_shape_errors_are_typed():
    data = {
        "_meta": {"provenance": "tuning"},
        "entries": [
            {"id": "not-a-list", "case_class": "answerable", "provenance": "tuning", "language": "en", "turns": "nope"},
            {
                "id": "empty",
                "case_class": "answerable",
                "provenance": "tuning",
                "language": "en",
                "turns": [],
            },
            {
                "id": "no-query",
                "case_class": "answerable",
                "provenance": "tuning",
                "language": "en",
                "turns": [{"context": {}}, "not an object", {"query": "  "}],
            },
            {
                "id": "bad-context",
                "case_class": "answerable",
                "provenance": "tuning",
                "language": "en",
                "turns": [{"query": "q", "context": ["not", "an", "object"]}],
            },
        ],
    }
    joined = "; ".join(es.validate_set(data, "tuning"))
    assert "turns, when present, must be a non-empty list" in joined
    assert "turn 1 must carry query text" in joined
    assert "turn 2 is not an object" in joined
    assert "turn 1 context, when present, must be an object" in joined
    assert not any("query must carry text" in e for e in es.validate_set(data, "tuning"))


def test_single_turn_case_still_requires_query():
    data = {
        "_meta": {"provenance": "tuning"},
        "entries": [{"id": "x", "case_class": "answerable", "provenance": "tuning"}],
    }
    assert any("query must carry text" in e for e in es.validate_set(data, "tuning"))


def test_turn_entries_expands_with_indexed_ids_and_drops_the_block():
    case = {
        "id": "p1",
        "query": "unused",
        "security_scenario": "permission_change",
        "turns": [
            {"query": "t1", "context": {"authorized_source_ids": ["a"]}},
            {"query": "t2", "context": {"authorized_source_ids": ["b"]}},
        ],
    }
    entries = es.turn_entries(case)
    assert [e["id"] for e in entries] == ["p1#t1", "p1#t2"]
    assert [e["turn"] for e in entries] == [1, 2]
    assert [e["query"] for e in entries] == ["t1", "t2"]
    assert entries[0]["context"] == {"authorized_source_ids": ["a"]}
    assert entries[0]["security_scenario"] == "permission_change"  # case fields carry over
    assert all("turns" not in e for e in entries)
    assert es.turn_entries({"id": "s1", "query": "q"}) == [{"id": "s1", "query": "q"}]


def test_tuning_sample_validates_and_separates():
    _, entries = es.load_set(TUNING_SAMPLE, "tuning")
    assert all(c["provenance"] == "tuning" for c in entries)


def test_missing_class_fails_naming_class_and_minimum(assessment_data):
    assessment_data["entries"] = [c for c in assessment_data["entries"] if c["case_class"] != "cancellation"]
    with pytest.raises(es.SetValidationError) as failed:
        es.validate_set_or_raise(assessment_data, "assessment")
    joined = "; ".join(failed.value.errors)
    assert "cancellation" in joined
    assert "1 required" in joined


def test_missing_non_latin_case_fails_naming_the_requirement(assessment_data):
    for case in assessment_data["entries"]:
        if case["case_class"] == "representative_language":
            case["script"] = "latin"
            case["query"] = "Where do I hand in the agricultural support form?"
    errors = es.validate_set(assessment_data, "assessment")
    non_latin_errors = [e for e in errors if "non-Latin" in e]
    assert non_latin_errors, errors
    assert "1 non-Latin" in non_latin_errors[0]


def test_tuning_case_in_assessment_set_refused_by_provenance():
    """A tuning-provenance case inside the assessment FILE is refused — the
    separation reads the case's provenance field, not the directory."""
    data = json.loads(ASSESSMENT_SAMPLE.read_text(encoding="utf-8"))
    tuning_case = json.loads(TUNING_SAMPLE.read_text(encoding="utf-8"))["entries"][0]
    data["entries"].append(tuning_case)
    with pytest.raises(es.SetValidationError) as failed:
        es.validate_set_or_raise(data, "assessment")
    joined = "; ".join(failed.value.errors)
    assert "sample-tune-1" in joined
    assert "separation" in joined
    assert "'tuning'" in joined


def test_assessment_case_in_tuning_set_refused_symmetrically(assessment_data):
    data = json.loads(TUNING_SAMPLE.read_text(encoding="utf-8"))
    data["entries"].append(copy.deepcopy(assessment_data["entries"][0]))
    errors = es.validate_set(data, "tuning")
    assert any("separation" in e and "sample-ans-pub-1" in e for e in errors)


def test_case_provenance_must_agree_with_set_provenance(assessment_data):
    assessment_data["entries"][0]["provenance"] = "tuning"
    errors = es.validate_set(assessment_data, "assessment")
    assert any("sample-ans-pub-1" in e and "separation" in e for e in errors)


def test_meta_provenance_disagrees_with_requested_kind(assessment_data):
    errors = es.validate_set(assessment_data, "tuning")
    assert any("_meta.provenance" in e for e in errors)


def test_schema_errors_name_the_case():
    data = {
        "_meta": {"provenance": "tuning"},
        "entries": [
            {"id": "x", "query": "q", "case_class": "not-a-class", "provenance": "tuning"},
            {"id": "x", "query": "q", "case_class": "answerable", "provenance": "tuning"},
            {"query": "no id", "case_class": "answerable", "provenance": "tuning"},
        ],
    }
    errors = es.validate_set(data, "tuning")
    joined = "; ".join(errors)
    assert "access_scenario" in joined
    assert "appears more than once" in joined
    assert "no string id" in joined


def test_non_object_entry_produces_the_typed_error():
    """A string entry must yield 'entry N is not an object', not AttributeError."""
    data = {"_meta": {"provenance": "tuning"}, "entries": ["oops", {"id": "ok"}]}
    errors = es.validate_set(data, "tuning")
    assert "entry 0 is not an object" in "; ".join(errors)


def test_non_numeric_minimums_value_is_a_typed_error(assessment_data):
    assessment_data["_meta"]["minimums"] = {"answerable": "two"}
    errors = es.validate_set(assessment_data, "assessment")
    joined = "; ".join(errors)
    assert "answerable" in joined
    assert "'two'" in joined


def test_minimums_override_can_raise_never_lower(assessment_data):
    assessment_data["_meta"]["minimums"] = {"answerable": 11}
    errors = es.validate_set(assessment_data, "assessment")
    assert any("answerable" in e and "11 required" in e for e in errors)
    assessment_data["_meta"]["minimums"] = {"answerable": 0}
    errors = es.validate_set(assessment_data, "assessment")
    assert not any("answerable" in e and "0 required" in e for e in errors)


def test_unknown_minimums_key_is_reported(assessment_data):
    assessment_data["_meta"]["minimums"] = {"nonsense": 3}
    errors = es.validate_set(assessment_data, "assessment")
    assert any("nonsense" in e for e in errors)


def test_empty_or_missing_entries_is_invalid():
    assert es.validate_set({"_meta": {"provenance": "assessment"}, "entries": []}, "assessment")
    assert es.validate_set({"_meta": {"provenance": "assessment"}}, "assessment")


def test_missing_meta_block_is_invalid():
    errors = es.validate_set({"entries": [{"id": "x"}]}, None)
    assert any("_meta" in e for e in errors)


def test_has_non_latin_text_by_unicode_block():
    assert es.has_non_latin_text("Как подать заявление")
    assert es.has_non_latin_text("申请提交")  # CJK
    assert not es.has_non_latin_text("Where do I hand in the form?")
    assert not es.has_non_latin_text("")


def test_case_is_non_latin_explicit_script_override_wins():
    assert es.case_is_non_latin({"query": "plain", "script": "non-latin"})
    assert not es.case_is_non_latin({"query": "Как", "script": "latin"})
    assert es.case_is_non_latin({"query": "Как"})
    assert not es.case_is_non_latin({"query": "plain"})


# --- CLI: validate-set ------------------------------------------------------


def test_cli_validate_set_ok_on_sample(capsys):
    rc = cmd_validate_set(type("Args", (), {"set_path": str(ASSESSMENT_SAMPLE), "kind": "assessment"}))
    assert rc == 0
    assert "OK" in capsys.readouterr().out


def test_cli_validate_set_names_errors_and_exits_nonzero(tmp_path, capsys):
    data = json.loads(ASSESSMENT_SAMPLE.read_text(encoding="utf-8"))
    data["entries"] = [c for c in data["entries"] if c["case_class"] != "cancellation"]
    broken = tmp_path / "broken.json"
    broken.write_text(json.dumps(data), encoding="utf-8")
    rc = cmd_validate_set(type("Args", (), {"set_path": str(broken), "kind": "assessment"}))
    assert rc == 1
    err = capsys.readouterr().err
    assert "INVALID" in err
    assert "cancellation" in err


def test_cli_validate_set_via_subprocess():
    """The driver-side entry stays importable as a plain script (stdlib-only)."""
    result = subprocess.run(
        [sys.executable, str(PROTOCOL_DIR / "run_protocol.py"), "validate-set", str(TUNING_SAMPLE), "--kind", "tuning"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout


def test_multiturn_nonlatin_case_is_detected_from_its_turns():
    """A multi-turn case's queries live in its turns — the non-Latin judgment
    reads them, so a turns-only non-Latin case satisfies the composition
    floor (no confusing 'missing non-Latin' error)."""
    case = {
        "id": "mt-lang",
        "case_class": "representative_language",
        "provenance": "tuning",
        "language": "ar",
        "access_scenario": "public",
        "turns": [
            {"query": "ما هي الخدمات المتاحة؟", "context": {"user_id": "u"}},
            {"query": "أجب بالعربية فقط"},
        ],
    }
    assert es.case_is_non_latin(case)
    data = {"_meta": {"provenance": "tuning"}, "entries": [case]}
    assert es.validate_set(data, "tuning") == []


# ---------------------------------------------------------------------------
# Evaluation surfaces — which surface measures which case
# ---------------------------------------------------------------------------


def test_evaluation_surface_names_the_surface_per_case_shape():
    """ONE place decides the surface: a security scenario executes on the
    pair's B/C legs, an outcome class is judged from the recorded outcome, a
    restricted-access case's passages are unreachable on config A, and the
    rest are the chunk-level retrieval surface — the only one that consumes
    gold."""
    assert es.evaluation_surface({"security_scenario": "restricted_repo", "case_class": "answerable"}) == "security"
    assert es.evaluation_surface({"case_class": "unanswerable"}) == "outcome"
    assert es.evaluation_surface({"case_class": "failure"}) == "outcome"
    assert es.evaluation_surface({"case_class": "cancellation"}) == "outcome"
    assert (
        es.evaluation_surface({"case_class": "answerable", "access_scenario": "restricted"}) == "restricted_access"
    )
    assert es.evaluation_surface({"case_class": "answerable", "access_scenario": "public"}) == "retrieval"
    assert es.evaluation_surface({"case_class": "citation_check", "access_scenario": "public"}) == "retrieval"
    assert (
        es.evaluation_surface({"case_class": "representative_language", "access_scenario": "public"}) == "retrieval"
    )
    assert es.evaluation_surface({"case_class": "not-a-class"}) == "unknown"


def test_security_scenario_wins_over_the_class_it_carries():
    """A security case is an answerable case too — the security surface decides
    it, or the case would be anchored on a surface the protocol declares
    inapplicable to config A."""
    case = {
        "case_class": "answerable",
        "access_scenario": "public",
        "security_scenario": "injection_document",
    }
    assert es.evaluation_surface(case) == "security"


def test_coverage_census_counts_every_case_on_its_surface(assessment_data):
    """The census is the set's coverage statement: every case lands on exactly
    one surface, and a valid set has a resolved surface for all of them."""
    census = es.coverage_census(assessment_data["entries"])
    assert census["n_set_cases"] == 20
    assert census["n_cases_with_a_resolved_surface"] == census["n_set_cases"]
    assert census["retrieval_cases_without_gold"] == []
    assert census["by_surface"]["retrieval"] == 8
    assert census["by_surface"]["restricted_access"] == 2
    assert census["by_surface"]["outcome"] == 3
    assert census["by_surface"]["security"] == 7
    assert sum(census["by_surface"].values()) == census["n_set_cases"]


def test_coverage_census_names_a_retrieval_case_without_gold(assessment_data):
    """A retrieval case without gold is measured by nothing — the census says
    so, and the case drops out of the evaluable count."""
    data = copy.deepcopy(assessment_data)
    for case in data["entries"]:
        if case["id"] == "sample-ans-pub-1":
            case["expected_chunks"] = []
    census = es.coverage_census(data["entries"])
    assert census["retrieval_cases_without_gold"] == ["sample-ans-pub-1"]
    assert census["n_cases_with_a_resolved_surface"] == census["n_set_cases"] - 1


def test_the_two_class_partitions_cover_the_composition_classes():
    """The retrieval classes and the outcome classes partition the composition
    classes — a new class lands on exactly one surface, never silently on
    "unknown"."""
    assert set(es.RETRIEVAL_CLASSES) | set(es.OUTCOME_CLASSES) == set(es.COMPOSITION_CLASSES)
    assert not set(es.RETRIEVAL_CLASSES) & set(es.OUTCOME_CLASSES)


# ---------------------------------------------------------------------------
# The outcome-surface expectations — ONE pairing (#2156 item 1)
# ---------------------------------------------------------------------------


def test_outcome_classes_pair_with_one_expectation_key_each():
    """The outcome surface's model lives in ONE place: each outcome class
    pairs with exactly the expectation key the verdict layer reads for its
    non-answer outcome — the class vocabulary decides the surface, this
    pairing decides which outcome is the expected one, and a second copy of
    the pairing elsewhere can drift."""
    assert es.OUTCOME_CLASS_EXPECTATIONS == {
        "unanswerable": "expect_abstained",
        "failure": "expect_typed_failure",
        "cancellation": "expect_cancelled",
    }


def test_validator_refuses_a_contradicting_outcome_expectation():
    """A case whose class pairs with one outcome expectation but carries
    another is refused at the set boundary — the surface says 'judged from
    the recorded outcome' while the expectation names a different outcome,
    and the two layers would read it differently."""
    data = json.loads((Path(es.__file__).parent / "sets" / "assessment.sample.json").read_text(encoding="utf-8"))
    for case in data["entries"]:
        if case.get("case_class") == "unanswerable":
            case["expectations"] = {"expect_cancelled": True}
    with pytest.raises(es.SetValidationError) as failed:
        es.validate_set_or_raise(data, "assessment")
    joined = "; ".join(failed.value.errors)
    assert "expect_cancelled" in joined
    assert "unanswerable" in joined


def test_validator_refuses_a_denial_expectation_on_an_outcome_case():
    """expect_denied is the SECURITY surface's expectation (an authorization
    case wants the refusal) — an outcome-class case carrying it claims a
    surface its class does not name."""
    data = json.loads((Path(es.__file__).parent / "sets" / "assessment.sample.json").read_text(encoding="utf-8"))
    for case in data["entries"]:
        if case.get("case_class") == "cancellation":
            case["expectations"] = {"expect_denied": True}
    with pytest.raises(es.SetValidationError) as failed:
        es.validate_set_or_raise(data, "assessment")
    assert any("expect_denied" in e for e in failed.value.errors)


# ---------------------------------------------------------------------------
# The post-signature classes (multi_hop, ambiguous) — issue #2146 blocker 3
# ---------------------------------------------------------------------------

SIGNED_REFERENCE_SET = (
    Path(__file__).resolve().parent.parent.parent
    / "_bmad-output"
    / "implementation-artifacts"
    / "e01-final-reference-2026-11-24"
    / "assessment-set.json"
)


def test_multi_hop_and_ambiguous_are_valid_case_classes():
    """The PRD §4.1 classes are first-class vocabulary: a case whose class is
    multi_hop or ambiguous validates — the extension blocker 3 asks for, so a
    set can carry the classes the gains layer reports per class."""
    base = {
        "id": "x",
        "query": "q",
        "language": "en",
        "access_scenario": "public",
        "provenance": "tuning",
    }
    for case_class in ("multi_hop", "ambiguous"):
        data = {"_meta": {"provenance": "tuning"}, "entries": [{**base, "case_class": case_class}]}
        assert es.validate_set(data, "tuning") == []


def test_new_classes_land_on_the_retrieval_surface():
    """Each new class lands on exactly ONE surface: both are gold-carrying
    retrieval classes — a multi-hop query joins facts across documents, an
    ambiguous query spans the interpretations' sources — so the anchor
    measures them. (The partition's totality is owned by
    test_the_two_class_partitions_cover_the_composition_classes.)"""
    assert es.evaluation_surface({"case_class": "multi_hop", "access_scenario": "public"}) == "retrieval"
    assert es.evaluation_surface({"case_class": "multi_hop", "access_scenario": "restricted"}) == "restricted_access"
    assert es.evaluation_surface({"case_class": "ambiguous", "access_scenario": "public"}) == "retrieval"


def test_the_new_classes_carry_an_optional_floor(assessment_data):
    """The post-signature classes default to minimum 0: a floor of 1 would
    retroactively refuse every pre-extension set — including the signed FINAL
    A reference set whose digest the signed thresholds bind to — at every
    driver's re-validation. A set that wants them REQUIRED raises them
    through _meta.minimums (the candidate set does); the re-signature on a
    digest carrying the classes is the operator's later step (#2146)."""
    data = assessment_data
    data["_meta"]["minimums"] = {"multi_hop": 4, "ambiguous": 4}
    errors = es.validate_set(data, "assessment")
    assert any("multi_hop" in e and "4 required" in e for e in errors)
    assert any("ambiguous" in e and "4 required" in e for e in errors)
    for case_class, n in (("multi_hop", 2), ("ambiguous", 2)):
        for i in range(n):
            data["entries"].append(
                {
                    "id": f"added-{case_class}-{i}",
                    "query": "q",
                    "language": "en",
                    "reference_answer": "",
                    "expected_chunks": [{"chunk_key": "k", "content_hash": "h", "preview": "p"}],
                    "case_class": case_class,
                    "access_scenario": "public",
                    "provenance": "assessment",
                }
            )
    assert es.validate_set(data, "assessment") == []


def test_an_explicit_zero_stays_optional_for_the_post_signature_classes(assessment_data):
    """{multi_hop: 0} states the optional floor explicitly — it never
    becomes a required floor of 1: the clamp's 'never lower below 1' guards
    a REQUIRED class's presence, and these classes' presence invariant is
    the default 0."""
    data = assessment_data
    data["_meta"]["minimums"] = {"multi_hop": 0, "ambiguous": 0}
    data["entries"] = [
        case for case in data["entries"] if case.get("case_class") not in ("multi_hop", "ambiguous")
    ]
    assert es.validate_set(data, "assessment") == []


def test_an_explicit_zero_on_a_required_class_still_floors_to_one(assessment_data):
    """The 'never lower below 1' invariant is untouched for the required
    classes: a zero override on a class whose default is >= 1 floors to the
    presence invariant, never to an optional class."""
    data = assessment_data
    data["_meta"]["minimums"] = {"cancellation": 0}
    data["entries"] = [case for case in data["entries"] if case.get("case_class") != "cancellation"]
    errors = es.validate_set(data, "assessment")
    assert any("cancellation" in e and "1 required" in e for e in errors)


def test_signed_reference_set_still_validates_under_the_extended_floor():
    """The FINAL A reference set — the digest the signed thresholds bind to —
    keeps validating under the extended vocabulary: the semantic half of
    'the signed set digest must not be touched'."""
    _, entries = es.load_set(SIGNED_REFERENCE_SET, "assessment")
    assert len(entries) == 67
    assert not any(c.get("case_class") in ("multi_hop", "ambiguous") for c in entries)
