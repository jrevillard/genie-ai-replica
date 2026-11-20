# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The charset guards on caller-supplied identifiers (story 1.7).

AD-3 requires that an identifier coming from a caller passes a charset guard
before it is used; the V04 map (§2.4) records that no such guard exists
anywhere in the tree today — the only one guards graph names inside the OPEA
retriever, a module the agentic path does not use. The guard lives here, in
the port.

Every guard raises ``AuthorizationError``: the refusal happens before any
resolution, so a malformed identifier and an unauthorized one are
indistinguishable from the caller's side, and neither reveals whether
anything exists. The patterns mirror the shapes the platforms themselves
produce — the document repository's numeric file ids, okf-server's uuid
repository ids and POSIX-path concept slugs, and the retriever's
ArangoDB-safe graph names (#501: only characters ArangoDB itself accepts may
reach a backticked AQL identifier).
"""

import re

from capabilities.contract import AuthorizationError, OperationName

_FILE_ID_PATTERN = re.compile(r"[0-9]+")
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_\-]+")
_CONCEPT_ID_PATTERN = re.compile(r"[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)*")

_FILE_ID_MAX_LEN = 64
_REPO_ID_MAX_LEN = 64
_CONCEPT_ID_MAX_LEN = 256
_GRAPH_NAME_MAX_LEN = 128


def _guard(pattern: re.Pattern[str], value: str, max_len: int, what: str, *, operation: OperationName) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value) or len(value) > max_len:
        raise AuthorizationError(f"identifier refused by the charset guard: {what}", operation=operation)
    return value


def validate_file_id(value: str, *, operation: OperationName) -> str:
    """A legacy file id: the document repository's numeric id."""
    return _guard(_FILE_ID_PATTERN, value, _FILE_ID_MAX_LEN, "file_id", operation=operation)


def validate_repo_id(value: str, *, operation: OperationName) -> str:
    """An OKF repository id: okf-server's uuid token."""
    return _guard(_TOKEN_PATTERN, value, _REPO_ID_MAX_LEN, "repo_id", operation=operation)


def validate_concept_id(value: str, *, operation: OperationName) -> str:
    """An OKF concept id: the parser's POSIX path slug."""
    return _guard(_CONCEPT_ID_PATTERN, value, _CONCEPT_ID_MAX_LEN, "concept_id", operation=operation)


def validate_graph_name(value: str, *, operation: OperationName) -> str:
    """A graph name: the only characters ArangoDB accepts in an identifier."""
    return _guard(_TOKEN_PATTERN, value, _GRAPH_NAME_MAX_LEN, "graph_name", operation=operation)


def ensure_graph_name_config(value: str) -> str:
    """The graph name as a deployment-configuration value (not caller-supplied).

    Same charset, different error channel: a bad ``ARANGO_GRAPH_NAME`` is the
    operator's configuration defect, and reporting it as a caller
    authorization failure would send the operator to the wrong layer.
    """
    if not isinstance(value, str) or not _TOKEN_PATTERN.fullmatch(value) or len(value) > _GRAPH_NAME_MAX_LEN:
        raise ValueError(
            "invalid deployment configuration: graph name "
            f"{value!r} is not an ArangoDB-safe identifier (expected [A-Za-z0-9_-], max {_GRAPH_NAME_MAX_LEN})"
        )
    return value
