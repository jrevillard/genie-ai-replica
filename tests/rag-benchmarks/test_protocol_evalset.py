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


# --- Security vocabulary + minimums (story 4.2) ------------------------------


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


# --- Multi-turn shape (story 4.2) --------------------------------------------


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
