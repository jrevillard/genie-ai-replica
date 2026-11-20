# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The document capability contract — the port between the agent loop and the corpus.

This module is the *port* of the hexagonal design: it declares the semantics of the
two agent-facing document operations, `search_knowledge` and `read_source`, and
performs no I/O. The adapters (ArangoDB, TEI, okf-server, document-repository)
implement the protocol declared here; the agent loop consumes it.

What the contract fixes, and why:

* **The caller context is trusted and server-assembled.** It carries the user id,
  the authorized graph set, the authorized repositories and the request's
  narrowing labels. The operation inputs carry none of it, so a model-generated
  argument cannot widen the search and cannot change the request's narrowing:
  the scope and the narrowing belong to the context, and what the model
  contributes is the query itself.
* **Authorization precedes resolution.** A target outside the authorized set is
  refused without revealing whether it exists: the refusal must not become an
  existence oracle. The HTTP mapping of that refusal is not the port's business
  (see the 403-vs-404 decision record for the serving API).
* **The error taxonomy is four distinct codes.** Authorization failure and
  transient failure are raised; insufficient evidence and degraded availability
  are *answer types* — a successful call that reports what it could not find.
  No code is ever reported as another, and no code may fall back to a wider
  corpus than the caller was authorized for.
* **Provenance follows the stable-id conventions.** A legacy corpus source is a
  `file_id` and carries no source marker; an OKF concept carries its concept id,
  repository id and bundle version, and is marked `okf-concept`. The two are
  separate types, so a source can never grow the other one's identity.
* **Limits are declared, not valued.** Every operation declares what a timeout,
  a result-size budget and a cancellation mean for it. The numbers come from the
  orchestrator's budget; the thresholds themselves are a deployment decision.

The contract *declares* these obligations; the executor *enforces* them. The
re-validation of every target against the authorized set, and the refusal of a
target that is outside it, belong to the authorization executor — a contract
type cannot enforce them, and this module says so rather than pretending.
"""

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = "1.0"

_VERSION_PATTERN = re.compile(r"[0-9]+\.[0-9]+")


class OperationName(StrEnum):
    """The agent-facing document operations."""

    SEARCH_KNOWLEDGE = "search_knowledge"
    READ_SOURCE = "read_source"


class OutcomeCode(StrEnum):
    """The outcome taxonomy. Every operation reports exactly one of these.

    The four failure codes are mutually exclusive and are never reported as one
    another: an authorization failure is not a transient failure, and an
    insufficiency is not a degradation.
    """

    SUCCESS = "success"
    AUTHORIZATION_FAILURE = "authorization_failure"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    DEGRADED_AVAILABILITY = "degraded_availability"
    TRANSIENT_FAILURE = "transient_failure"


class OutcomeCarrier(StrEnum):
    """How an outcome reaches the caller."""

    RESULT = "result"
    EXCEPTION = "exception"


class FallbackPolicy(StrEnum):
    """What a failure may fall back to."""

    NEVER = "never"
    WITHIN_AUTHORIZED_SET = "within_authorized_set"


@dataclass(frozen=True)
class OutcomePolicy:
    """The semantics of one outcome code.

    `carrier` decides where the code is reported: a result field or a raised
    error. `retryable` says whether repeating the operation can change the
    outcome. `fallback` bounds what a failure may degrade into — a failure never
    falls back to something wider than the caller was authorized for.
    """

    code: OutcomeCode
    carrier: OutcomeCarrier
    retryable: bool
    fallback: FallbackPolicy


OUTCOME_POLICIES: dict[OutcomeCode, OutcomePolicy] = {
    OutcomeCode.SUCCESS: OutcomePolicy(
        code=OutcomeCode.SUCCESS,
        carrier=OutcomeCarrier.RESULT,
        retryable=False,
        fallback=FallbackPolicy.NEVER,
    ),
    OutcomeCode.AUTHORIZATION_FAILURE: OutcomePolicy(
        code=OutcomeCode.AUTHORIZATION_FAILURE,
        carrier=OutcomeCarrier.EXCEPTION,
        retryable=False,
        fallback=FallbackPolicy.NEVER,
    ),
    OutcomeCode.INSUFFICIENT_EVIDENCE: OutcomePolicy(
        code=OutcomeCode.INSUFFICIENT_EVIDENCE,
        carrier=OutcomeCarrier.RESULT,
        retryable=False,
        fallback=FallbackPolicy.NEVER,
    ),
    OutcomeCode.DEGRADED_AVAILABILITY: OutcomePolicy(
        code=OutcomeCode.DEGRADED_AVAILABILITY,
        carrier=OutcomeCarrier.RESULT,
        retryable=True,
        fallback=FallbackPolicy.WITHIN_AUTHORIZED_SET,
    ),
    OutcomeCode.TRANSIENT_FAILURE: OutcomePolicy(
        code=OutcomeCode.TRANSIENT_FAILURE,
        carrier=OutcomeCarrier.EXCEPTION,
        retryable=True,
        fallback=FallbackPolicy.WITHIN_AUTHORIZED_SET,
    ),
}


class CapabilityError(Exception):
    """Base class for the outcomes that are raised rather than reported.

    Each subclass's `code` is its class attribute: the carrier table
    (`OUTCOME_POLICIES`) and the raised type agree by construction.
    """

    code: OutcomeCode = OutcomeCode.TRANSIENT_FAILURE

    def __init__(self, message: str, *, operation: OperationName | None = None) -> None:
        super().__init__(message)
        self.operation = operation


class AuthorizationError(CapabilityError):
    """The caller is not authorized for the requested scope or target.

    Raised before any resolution, so the refusal reveals nothing about the
    target's existence. It is never retried and never falls back to a wider
    scope.
    """

    code = OutcomeCode.AUTHORIZATION_FAILURE


class TransientError(CapabilityError):
    """A dependency failed transiently; no usable result was produced."""

    code = OutcomeCode.TRANSIENT_FAILURE


class AuthorizedRepo(BaseModel):
    """A repository the caller may read, with the graph that serves it.

    The repository id is paired with its serving graph name because that
    mapping is resolved server-side, per caller, and never derivable from the
    repository id alone.
    """

    model_config = ConfigDict(extra="forbid")

    repo_id: str
    graph_name: str


class CallerContext(BaseModel):
    """The trusted caller context — assembled server-side, never by the model.

    `authorized_graph_names` is the set the port may query: enforcement by
    construction means the port queries this set and nothing else.
    `authorized_repos` carries the repository-to-graph mapping the port needs
    to resolve a repository id inside that set — every entry must name a graph
    of that set, so the mapping cannot widen the scope it resolves into.
    `requested_labels` is the request's own narrowing. It is context-only:
    a model argument contributes the query and nothing else, so it cannot
    widen the search and cannot change what the request asked for.
    """

    model_config = ConfigDict(extra="forbid")

    user_id: str
    authorized_graph_names: tuple[str, ...]
    authorized_repos: tuple[AuthorizedRepo, ...] = ()
    requested_labels: tuple[str, ...] = ()

    @model_validator(mode="after")
    def _the_mapping_stays_inside_the_authorized_set(self) -> "CallerContext":
        repo_ids = [repo.repo_id for repo in self.authorized_repos]
        if len(set(repo_ids)) != len(repo_ids):
            raise ValueError("a repository id may appear once in the authorized repositories")
        outside = sorted(
            repo.graph_name for repo in self.authorized_repos if repo.graph_name not in self.authorized_graph_names
        )
        if outside:
            raise ValueError(f"an authorized repository may not name a graph outside the authorized set: {outside}")
        return self


class QueryPreparationStatus(StrEnum):
    """How the query was prepared for retrieval.

    The vocabulary is the one the deployed query path records; the contract
    keeps it so the port can report the preparation without inventing a
    parallel one.
    """

    TRANSLATED = "translated"
    PASSTHROUGH_ENGLISH = "passthrough_english"
    PASSTHROUGH_UNKNOWN_LANGUAGE = "passthrough_unknown_language"
    FALLBACK_TIMEOUT = "fallback_timeout"
    FALLBACK_ERROR = "fallback_error"

    @property
    def is_prepared(self) -> bool:
        """Whether this status means the query is English and ready to retrieve."""
        return self in PreparedStatus.__args__


PreparedStatus = Literal[
    QueryPreparationStatus.TRANSLATED,
    QueryPreparationStatus.PASSTHROUGH_ENGLISH,
]
"""The preparation statuses that mean the query is ready to retrieve."""


class PreparedQuery(BaseModel):
    """A query prepared for retrieval: English, ready to embed.

    The port requires a prepared query — a query whose preparation could not be
    established is refused here, before the operation runs. The refusal is a
    validation failure, not one of the outcome codes.
    """

    model_config = ConfigDict(extra="forbid")

    text: str
    preparation_status: QueryPreparationStatus

    @model_validator(mode="after")
    def _require_prepared(self) -> "PreparedQuery":
        if not self.preparation_status.is_prepared:
            raise ValueError(
                f"query preparation status {self.preparation_status.value!r} is not prepared; "
                "the port requires a prepared (English) query"
            )
        return self


class LegacyFileProvenance(BaseModel):
    """Provenance of a legacy corpus source: the document repository's file id.

    A legacy source carries no source marker — the absence is what tells it
    apart from an OKF concept.
    """

    model_config = ConfigDict(extra="forbid")

    file_id: str


class OkfConceptProvenance(BaseModel):
    """Provenance of an OKF concept: the identity of the published concept.

    `bundle_version` is required but nullable: the identity join may not have
    resolved it, and the producer must then say so explicitly rather than
    leaving the field out or inventing a version.
    """

    model_config = ConfigDict(extra="forbid")

    source: Literal["okf-concept"] = "okf-concept"
    concept_id: str
    repo_id: str
    bundle_version: int | None


Provenance = LegacyFileProvenance | OkfConceptProvenance


class LegacyFileRef(BaseModel):
    """A legacy corpus target, identified by its file id."""

    model_config = ConfigDict(extra="forbid")

    file_id: str


class OkfConceptRef(BaseModel):
    """An OKF concept target.

    Both ids are required: the repository id is part of the identity, and
    naming the repository is what keeps a concept id that several
    repositories share unambiguous.
    """

    model_config = ConfigDict(extra="forbid")

    repo_id: str
    concept_id: str


SourceRef = LegacyFileRef | OkfConceptRef


class SearchKnowledgeInput(BaseModel):
    """The `search_knowledge` arguments.

    The narrowing the caller asked for travels in the caller context, not here:
    this model carries what the model asked for, and nothing that could widen
    the search.
    """

    model_config = ConfigDict(extra="forbid")

    query: PreparedQuery


class SearchHit(BaseModel):
    """One retrieved passage and the source it came from."""

    model_config = ConfigDict(extra="forbid")

    provenance: Provenance
    text: str
    score: float


ResultOutcome = Literal[
    OutcomeCode.SUCCESS,
    OutcomeCode.INSUFFICIENT_EVIDENCE,
    OutcomeCode.DEGRADED_AVAILABILITY,
]


class SearchKnowledgeResult(BaseModel):
    """The `search_knowledge` result.

    `outcome` reports which of the answer types this is. An empty hit list is
    an insufficiency, never a success — the two mean different things to the
    loop and must not be merged.
    """

    model_config = ConfigDict(extra="forbid")

    outcome: ResultOutcome
    hits: tuple[SearchHit, ...] = ()
    truncated: bool = False
    query_preparation_status: PreparedStatus

    @model_validator(mode="after")
    def _the_outcome_matches_the_hits(self) -> "SearchKnowledgeResult":
        if self.outcome == OutcomeCode.SUCCESS and not self.hits:
            raise ValueError("a successful search must carry at least one hit; an empty result is an insufficiency")
        if self.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE and self.hits:
            raise ValueError("an insufficiency carries no hit; a partial result is a degradation")
        return self


class ReadSourceInput(BaseModel):
    """The `read_source` arguments: the target to read."""

    model_config = ConfigDict(extra="forbid")

    target: SourceRef


class ReadSourceResult(BaseModel):
    """The `read_source` result.

    A successful read carries the resolved provenance and the content. An
    absent provenance is what tells the caller that the target did not resolve:
    the answer is an insufficiency, and the source must not be cited.
    """

    model_config = ConfigDict(extra="forbid")

    outcome: ResultOutcome
    provenance: Provenance | None = None
    content: str | None = None
    truncated: bool = False

    @model_validator(mode="after")
    def _the_outcome_matches_the_source(self) -> "ReadSourceResult":
        if self.outcome == OutcomeCode.SUCCESS:
            if self.provenance is None:
                raise ValueError("a successful read must carry the resolved provenance")
            if self.content is None:
                raise ValueError("a successful read must carry the content")
        if self.outcome == OutcomeCode.INSUFFICIENT_EVIDENCE and (self.provenance is not None or self.content):
            raise ValueError("an insufficiency carries no source; a source that resolved is a success")
        return self


class LimitScope(StrEnum):
    """What a limit covers.

    The values are prefixed so that they cannot collide with another
    vocabulary's values: every enum here is a string enum, so a shared value
    would make a limit scope compare equal to an outcome code.
    """

    OPERATION = "scope_operation"
    RESULT = "scope_result"


class LimitBreach(StrEnum):
    """What the caller observes when a limit binds.

    `cancelled` is deliberately not an outcome code: a cancelled operation is
    neither a failure nor an insufficiency, and the cancellation signal
    propagates back to the caller unchanged.
    """

    TRANSIENT_FAILURE = "breach_transient_failure"
    TRUNCATE_AND_FLAG = "breach_truncate_and_flag"
    CANCELLED = "breach_cancelled"


class LimitDeclaration(BaseModel):
    """One operation's semantics for one limit.

    Frozen: a declaration is a fact about an operation, and two operations
    must never share a mutable one.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    scope: LimitScope
    breach: LimitBreach


class OperationBudget(BaseModel):
    """The budget an operation runs under.

    The values come from the orchestrator that owns the request's deadline;
    the thresholds themselves are a deployment decision, not the contract's.
    """

    model_config = ConfigDict(extra="forbid")

    timeout_ms: int = Field(gt=0)
    max_results: int = Field(gt=0)
    max_result_bytes: int = Field(gt=0)


@dataclass(frozen=True)
class OperationSpec:
    """What one operation declares: its types, its outcomes and its limits."""

    name: OperationName
    version: str
    input_type: type[BaseModel]
    result_type: type[BaseModel]
    outcome_codes: tuple[OutcomeCode, ...]
    timeout: LimitDeclaration
    result_size: LimitDeclaration
    cancellation: LimitDeclaration


def _spec(name: OperationName, input_type: type[BaseModel], result_type: type[BaseModel]) -> OperationSpec:
    """Build one operation's spec: every operation declares the same outcome
    vocabulary and the same limit semantics, and gets its own limit
    declarations — two operations never share a declaration instance."""

    return OperationSpec(
        name=name,
        version=CONTRACT_VERSION,
        input_type=input_type,
        result_type=result_type,
        outcome_codes=(
            OutcomeCode.SUCCESS,
            OutcomeCode.INSUFFICIENT_EVIDENCE,
            OutcomeCode.DEGRADED_AVAILABILITY,
            OutcomeCode.AUTHORIZATION_FAILURE,
            OutcomeCode.TRANSIENT_FAILURE,
        ),
        timeout=LimitDeclaration(scope=LimitScope.OPERATION, breach=LimitBreach.TRANSIENT_FAILURE),
        result_size=LimitDeclaration(scope=LimitScope.RESULT, breach=LimitBreach.TRUNCATE_AND_FLAG),
        cancellation=LimitDeclaration(scope=LimitScope.OPERATION, breach=LimitBreach.CANCELLED),
    )


OPERATION_SPECS: dict[OperationName, OperationSpec] = {
    OperationName.SEARCH_KNOWLEDGE: _spec(OperationName.SEARCH_KNOWLEDGE, SearchKnowledgeInput, SearchKnowledgeResult),
    OperationName.READ_SOURCE: _spec(OperationName.READ_SOURCE, ReadSourceInput, ReadSourceResult),
}


class DocumentCapabilityPort(Protocol):
    """The port the agent loop talks to.

    The two implementations are the contract's seam: the executor that
    enforces the caller context's authorized set, and the adapters that reach
    the corpus. The budget travels with the call because the orchestrator owns
    the deadline, not the operation.
    """

    async def search_knowledge(
        self,
        context: CallerContext,
        request: SearchKnowledgeInput,
        budget: OperationBudget,
    ) -> SearchKnowledgeResult:
        """Search the authorized corpus and report what was found."""
        ...

    async def read_source(
        self,
        context: CallerContext,
        request: ReadSourceInput,
        budget: OperationBudget,
    ) -> ReadSourceResult:
        """Read one authorized source and report it with its provenance."""
        ...


@dataclass(frozen=True)
class CompatibilityRules:
    """The contract's versioning rules.

    Every model refuses the fields it does not know, so a new field is
    rejected by an older consumer rather than ignored: adding a field is a
    major change. The vocabularies are closed for the same reason — the
    outcome codes, the provenance and source-ref variants, the preparation
    statuses and the limit scope and breach vocabulary — so extending one is a
    major change too. A minor version may only add a new operation.

    Anything that removes a field, changes a meaning, or changes the carrier,
    retry rule or fallback rule of an outcome code is a major change as well.
    Outcome codes are stable identifiers: a code is never reused for a
    different meaning, so a caller that switches on it stays correct.
    """

    current_version: str
    additive: tuple[str, ...]
    breaking: tuple[str, ...]
    error_codes_stable: bool
    unknown_major_incompatible: bool


COMPATIBILITY = CompatibilityRules(
    current_version=CONTRACT_VERSION,
    additive=("a new operation",),
    breaking=(
        "removing or renaming a field",
        "changing the meaning of an existing field",
        "adding a field — every model refuses the ones it does not know, so a new field is rejected, not ignored",
        "adding an outcome code — the result vocabulary is closed",
        "adding a provenance variant or a source-ref variant — those unions are closed",
        "adding a preparation status — the input carries the whole enum",
        "adding a limit scope or a limit breach — the limit vocabulary is closed",
        "changing the carrier, the retry rule or the fallback rule of an outcome code",
        "changing the carrier or the semantics of a limit declaration",
        "changing the identity a provenance variant carries",
    ),
    error_codes_stable=True,
    unknown_major_incompatible=True,
)


def _parse_version(version: str) -> tuple[int, int] | None:
    """Parse a `major.minor` contract version, or None when it is malformed."""
    if not _VERSION_PATTERN.fullmatch(version):
        return None
    major, minor = version.split(".")
    return int(major), int(minor)


def is_compatible(consumer_version: str, provider_version: str) -> bool:
    """Whether a consumer built against `consumer_version` accepts `provider_version`.

    A provider is compatible when its major version is the consumer's and its
    minor version is not below the consumer's: a minor bump only adds, so the
    newer provider still answers everything the consumer asks for. A different
    major version is never compatible, and a malformed version is never
    compatible.
    """
    consumer = _parse_version(consumer_version)
    provider = _parse_version(provider_version)
    if consumer is None or provider is None:
        return False
    consumer_major, consumer_minor = consumer
    provider_major, provider_minor = provider
    if provider_major != consumer_major:
        return False
    return provider_minor >= consumer_minor
