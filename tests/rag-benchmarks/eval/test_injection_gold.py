# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""#914 (c): the injection eval gold file holds schema + family coverage.

Runs offline (no corpus, no stack): validates gold_dataset.injection.json
against the gold schema the drivers consume, and asserts every injection
FAMILY in the okf fixture corpus (data/okf/injection-eval/fixtures.json —
the same corpus the okf-server unit suite table-drives) is represented by
at least one eval row, so the benchmark rows cannot silently fall behind
the sanitizer's pattern list.

Run: python3 -m pytest tests/rag-benchmarks/eval/test_injection_gold.py -q
"""

import json
from pathlib import Path

import pytest

EVAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVAL_DIR.parents[2]
GOLD_PATH = EVAL_DIR / "gold_dataset.injection.json"
FIXTURES_PATH = REPO_ROOT / "data" / "okf" / "injection-eval" / "fixtures.json"


@pytest.fixture(scope="module")
def gold():
    return json.loads(GOLD_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def fixtures():
    return json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


def test_gold_schema_matches_the_driver_contract(gold):
    # run_eval.py / run_ragas_eval.py consume entries[] with these fields;
    # categoryLabels MUST be a LIST (the string form silently deadens the
    # filter — the pitfall the eval CLAUDE.md logs).
    assert isinstance(gold.get("entries"), list) and gold["entries"], "entries[] required"
    for e in gold["entries"]:
        assert e.get("id"), "every entry needs an id"
        assert e.get("query"), "every entry needs a query"
        assert isinstance(e.get("categoryLabels", []), list), "categoryLabels must be a list"
        assert isinstance(e.get("expected_chunks", []), list)
        # RAGAS-path rows carry the expected outcome in the reference answer.
        assert e.get("reference_answer"), "injection rows encode the expected behavior in reference_answer"


def test_every_injection_family_is_represented(gold, fixtures):
    # The scan families the SANITIZER knows (fixture corpus rows + summary
    # rows are prose/token/invisible samples of the same families).
    corpus_families = {row["family"] for row in fixtures["rows"] if row.get("family")}
    assert corpus_families, "the fixture corpus must declare families"
    # Every family has at least one eval row id carrying its family tag.
    row_ids = {e["id"] for e in gold["entries"]}
    for family in corpus_families:
        tag = "inj-" + family.replace("_", "-")
        assert any(rid.startswith(tag) for rid in row_ids), (
            f"no eval row covers fixture family {family} (expected an id starting '{tag}-')"
        )


def test_a_clean_control_row_exists(gold):
    # The control row guards against a paranoid posture that refuses
    # legitimate content — the eval's honest baseline.
    assert any(e.get("difficulty") == "control" for e in gold["entries"])


def test_sanitizer_pattern_version_is_pinned(fixtures):
    # The gold file pins the corpus it was authored against; a pattern-list
    # bump that forgets the benchmark rows fails here, not in a live eval.
    assert fixtures.get("version"), "fixture corpus must carry a version"
