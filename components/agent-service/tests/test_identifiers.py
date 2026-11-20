# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The charset guards on caller-supplied identifiers (story 1.7).

Every guard refuses with ``AuthorizationError`` before any resolution: a
malformed identifier and an unauthorized one are indistinguishable from the
caller's side, and neither ever reaches a URL or an AQL string.
"""

import pytest

from capabilities.contract import AuthorizationError, OperationName, OutcomeCode
from capabilities.identifiers import (
    validate_concept_id,
    validate_file_id,
    validate_graph_name,
    validate_repo_id,
)

OP = OperationName.READ_SOURCE


class TestLegacyFileId:
    def test_numeric_id_passes(self):
        assert validate_file_id("12345", operation=OP) == "12345"

    def test_letters_refused(self):
        with pytest.raises(AuthorizationError):
            validate_file_id("abc123", operation=OP)

    @pytest.mark.parametrize("bad", ["", " 1", "1 ", "1;2", "1`2", "1'2", "-1", "1.5", "١٢٣"])
    def test_non_digits_refused(self, bad):
        with pytest.raises(AuthorizationError):
            validate_file_id(bad, operation=OP)

    def test_refusal_carries_the_outcome_code(self):
        with pytest.raises(AuthorizationError) as excinfo:
            validate_file_id("abc", operation=OP)
        assert excinfo.value.code is OutcomeCode.AUTHORIZATION_FAILURE


class TestRepoId:
    def test_uuid_passes(self):
        rid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
        assert validate_repo_id(rid, operation=OP) == rid

    def test_plain_token_passes(self):
        assert validate_repo_id("repo_1", operation=OP) == "repo_1"

    @pytest.mark.parametrize("bad", ["", "a b", "a;b", "a`b", "a'b", 'a"b', "a/b", "a\\b", "é"])
    def test_metacharacters_refused(self, bad):
        with pytest.raises(AuthorizationError):
            validate_repo_id(bad, operation=OP)


class TestConceptId:
    def test_path_slug_passes(self):
        assert validate_concept_id("entities/google_services", operation=OP) == "entities/google_services"

    def test_single_segment_passes(self):
        assert validate_concept_id("getting-started", operation=OP) == "getting-started"

    @pytest.mark.parametrize(
        "bad",
        [
            "",
            "a b",
            "a;b",
            "a`b",
            "a'b",
            "a\\b",
            "/leadingslash",
            "trailing/",
            "a//b",
            "a/../b",
            "..",
            ".md",
            "a.md",
            "é",
        ],
    )
    def test_non_slug_refused(self, bad):
        with pytest.raises(AuthorizationError):
            validate_concept_id(bad, operation=OP)

    def test_overlong_refused(self):
        with pytest.raises(AuthorizationError):
            validate_concept_id("a" * 300, operation=OP)


class TestGraphName:
    def test_plain_name_passes(self):
        assert validate_graph_name("GRAPH", operation=OP) == "GRAPH"

    def test_versioned_name_passes(self):
        assert validate_graph_name("OKF_my-slug_v2", operation=OP) == "OKF_my-slug_v2"

    @pytest.mark.parametrize("bad", ["", "a b", "a`b", "a;b", "a/b", "a'b", 'a"b', "a\\b"])
    def test_metacharacters_refused(self, bad):
        with pytest.raises(AuthorizationError):
            validate_graph_name(bad, operation=OP)
