# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The charset guards on caller-supplied identifiers.

An identifier coming from a caller must pass a charset guard
before it is used: the deployed tree carries no such guard (the only one
guards graph names inside the OPEA retriever, a module the agentic path does
not use). The guard lives here, in the port.

Every guard raises ``AuthorizationError``: the refusal happens before any
resolution, so a malformed identifier and an unauthorized one are
indistinguishable from the caller's side, and neither reveals whether
anything exists.

**The patterns are the GENERAL token shape, not a platform's form** (ADR
agentic-009). A guard's charset is the only place the core could know what
an identifier looks like where it was minted — and the moment it knows, it
is wrong the day the platform changes: a guard that accepted only the
document repository's numeric ids refused every id the repository actually
mints (``<timestamp>_<uuid-prefix>``), on every document, as an
authorization failure indistinguishable from a permission refusal. What an
identifier looks like belongs to the platform that resolves it; it refuses
what it does not know. The core refuses what is UNSAFE — the characters
that would change the meaning of the URL or the query it is bound to.
"""

import re

from capabilities.contract import AuthorizationError, OperationName

_FILE_ID_PATTERN = re.compile(r"[A-Za-z0-9_\-]+")
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
    """A legacy file id: an opaque token the document repository resolves.

    The core does not know its form — the repository mints one shape
    (``<timestamp>_<uuid-prefix>``, see
    ``components/document-repository/src/utils/fileUtils.js``) and the
    ArangoDB ``_key`` is another, and neither is the core's business.
    """
    return _guard(_FILE_ID_PATTERN, value, _FILE_ID_MAX_LEN, "file_id", operation=operation)


def validate_repo_id(value: str, *, operation: OperationName) -> str:
    """An OKF repository id: okf-server's uuid token."""
    return _guard(_TOKEN_PATTERN, value, _REPO_ID_MAX_LEN, "repo_id", operation=operation)


def validate_concept_id(value: str, *, operation: OperationName) -> str:
    """An OKF concept id: the parser's POSIX path slug."""
    return _guard(_CONCEPT_ID_PATTERN, value, _CONCEPT_ID_MAX_LEN, "concept_id", operation=operation)


def validate_graph_name(value: str, *, operation: OperationName) -> str:
    """A corpus leg label: an opaque token the platform serving the leg
    resolves.

    The core does not know what that platform accepts — the label is a token
    with a safe shape and a length, and the platform's own rules belong to
    the connector that resolves it (ADR agentic-009).
    """
    return _guard(_TOKEN_PATTERN, value, _GRAPH_NAME_MAX_LEN, "graph_name", operation=operation)


def ensure_graph_name_config(value: str) -> str:
    """The graph name as a deployment-configuration value (not caller-supplied).

    Same shape, different error channel: a bad ``ARANGO_GRAPH_NAME`` is the
    operator's configuration defect, and reporting it as a caller
    authorization failure would send the operator to the wrong layer. The
    refusal names the deployment's configuration — what a corpus leg label
    may be is the core's own safety rule, not a rule the corpus database
    imposes (ADR agentic-009).
    """
    if not isinstance(value, str) or not _TOKEN_PATTERN.fullmatch(value) or len(value) > _GRAPH_NAME_MAX_LEN:
        raise ValueError(
            "invalid deployment configuration: the corpus leg label "
            f"{value!r} is not a safe token (letters, digits, underscore and hyphen; "
            f"max {_GRAPH_NAME_MAX_LEN} characters)"
        )
    return value
