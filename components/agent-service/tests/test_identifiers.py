# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The charset guards on caller-supplied identifiers.

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

    @pytest.mark.parametrize("bad", ["", " 1", "1 ", "1;2", "1`2", "1'2", "1.5", "١٢٣", "a/b", "a\\b", "é"])
    def test_unsafe_characters_refused(self, bad):
        """The guard refuses what is UNSAFE — not what is merely unusual.

        A letter, a hyphen and an underscore are legal characters of an
        opaque token; a space, a quote, a backtick and a slash are not. The
        core refuses the unsafe ones and lets the platform refuse the ids
        it does not know (ADR agentic-009): a guard that encodes a
        platform's FORM refuses the corpus the day the platform changes it.
        """

        with pytest.raises(AuthorizationError):
            validate_file_id(bad, operation=OP)

    def test_refusal_carries_the_outcome_code(self):
        with pytest.raises(AuthorizationError) as excinfo:
            validate_file_id("a b", operation=OP)
        assert excinfo.value.code is OutcomeCode.AUTHORIZATION_FAILURE

    def test_the_document_repositorys_timestamped_id_passes(self):
        """The id the document repository MINTS must be readable.

        The document repository names every file ``<timestamp>_<uuid-prefix>``
        (``components/document-repository/src/utils/fileUtils.js``:
        ``${Date.now()}_${uuidv4().split('-')[0]}``) — the shape its own
        batch API's validation exists to tell apart from an ArangoDB
        ``_key`` (``fileController.js``: "semantic file_ids are timestamped
        while ArangoDB _keys are bare integers").

        A guard that accepts only bare digits therefore refuses EVERY file
        the corpus actually holds: the model reads the id out of the search
        hit, hands it to ``read_source``, and the call is refused with an
        authorization failure before any resolution — the source can never
        be read, on any document, ever.
        """

        file_id = "1795706154681_2f1d1fc5"

        assert validate_file_id(file_id, operation=OP) == file_id

    def test_an_arango_key_passes_too(self):
        """The other shape the corpus holds: the bare ArangoDB ``_key``."""

        assert validate_file_id("7200805215929729570", operation=OP) == "7200805215929729570"


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
