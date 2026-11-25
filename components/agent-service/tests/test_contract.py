# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The document capability contract: the semantics it declares, asserted.

Every assertion here is a contract obligation. A test that cannot fail is a
test that proves nothing, so each one states the behaviour it pins.
"""

import dataclasses
import inspect
import typing

import pytest
from pydantic import BaseModel, ValidationError

from capabilities import contract
from capabilities.contract import (
    AuthorizationError,
    AuthorizedRepo,
    CallerContext,
    CapabilityError,
    LegacyFileProvenance,
    LegacyFileRef,
    OkfConceptProvenance,
    OkfConceptRef,
    OperationBudget,
    OperationName,
    OutcomeCarrier,
    OutcomeCode,
    PreparedQuery,
    QueryPreparationStatus,
    ReadSourceInput,
    ReadSourceResult,
    SearchHit,
    SearchKnowledgeInput,
    SearchKnowledgeResult,
    TransientError,
    is_compatible,
)

LEGACY_FILE_ID = "5f2c9a1e4b7d8c0a1b2c3d4e5f60718"
OKF_CONCEPT_ID = "concept-42"
OKF_REPO_ID = "repo-7"
OKF_GRAPH_NAME = "OKF_energy-policy_v3"


def a_caller_context() -> CallerContext:
    return CallerContext(
        user_id="user-1",
        authorized_graph_names=("GRAPH", OKF_GRAPH_NAME),
        authorized_repos=(AuthorizedRepo(repo_id=OKF_REPO_ID, graph_name=OKF_GRAPH_NAME),),
        requested_labels=("theme:energy",),
    )


def a_prepared_query() -> PreparedQuery:
    return PreparedQuery(text="How is the energy policy applied?", preparation_status=QueryPreparationStatus.TRANSLATED)


def a_legacy_hit() -> SearchHit:
    return SearchHit(provenance=LegacyFileProvenance(file_id=LEGACY_FILE_ID), text="a passage", score=0.42)


def an_okf_provenance() -> OkfConceptProvenance:
    return OkfConceptProvenance(concept_id=OKF_CONCEPT_ID, repo_id=OKF_REPO_ID, bundle_version=3)


def an_okf_hit() -> SearchHit:
    return SearchHit(
        provenance=an_okf_provenance(),
        text="a passage",
        score=0.71,
    )


# --- the operations -------------------------------------------------------


def test_the_contract_declares_exactly_the_two_document_operations():
    assert set(contract.OPERATION_SPECS) == {OperationName.SEARCH_KNOWLEDGE, OperationName.READ_SOURCE}


@pytest.mark.parametrize("name", list(OperationName))
def test_every_operation_declares_its_types_outcomes_and_limits(name):
    spec = contract.OPERATION_SPECS[name]

    assert spec.name == name
    assert spec.version == contract.CONTRACT_VERSION
    assert spec.input_type is not None and spec.result_type is not None
    assert spec.outcome_codes
    assert spec.timeout.scope is contract.LimitScope.OPERATION
    assert spec.result_size.scope is contract.LimitScope.RESULT
    assert spec.cancellation.scope is contract.LimitScope.OPERATION


def test_the_timeout_breach_is_transient_and_the_size_breach_is_flagged():
    for spec in contract.OPERATION_SPECS.values():
        assert spec.timeout.breach is contract.LimitBreach.TRANSIENT_FAILURE
        assert spec.result_size.breach is contract.LimitBreach.TRUNCATE_AND_FLAG
        assert spec.cancellation.breach is contract.LimitBreach.CANCELLED


def test_cancellation_is_not_one_of_the_outcome_codes():
    """A cancelled operation is neither a failure nor an insufficiency."""
    assert "cancelled" not in {code.value for code in OutcomeCode}


# --- the error taxonomy ----------------------------------------------------


def test_the_taxonomy_distinguishes_the_four_failure_codes():
    failure_codes = {
        OutcomeCode.AUTHORIZATION_FAILURE,
        OutcomeCode.INSUFFICIENT_EVIDENCE,
        OutcomeCode.DEGRADED_AVAILABILITY,
        OutcomeCode.TRANSIENT_FAILURE,
    }

    assert failure_codes == set(contract.OUTCOME_POLICIES) - {OutcomeCode.SUCCESS}


def test_every_outcome_code_has_exactly_one_carrier():
    for code, policy in contract.OUTCOME_POLICIES.items():
        assert policy.code == code
        assert policy.carrier in set(OutcomeCarrier)


def test_no_outcome_code_is_both_raisable_and_reportable():
    carriers = {code: policy.carrier for code, policy in contract.OUTCOME_POLICIES.items()}

    assert carriers[OutcomeCode.AUTHORIZATION_FAILURE] is OutcomeCarrier.EXCEPTION
    assert carriers[OutcomeCode.TRANSIENT_FAILURE] is OutcomeCarrier.EXCEPTION
    assert carriers[OutcomeCode.INSUFFICIENT_EVIDENCE] is OutcomeCarrier.RESULT
    assert carriers[OutcomeCode.DEGRADED_AVAILABILITY] is OutcomeCarrier.RESULT


def test_a_failure_never_falls_back_more_permissively():
    policies = contract.OUTCOME_POLICIES

    assert policies[OutcomeCode.AUTHORIZATION_FAILURE].fallback is contract.FallbackPolicy.NEVER
    assert policies[OutcomeCode.INSUFFICIENT_EVIDENCE].fallback is contract.FallbackPolicy.NEVER
    assert policies[OutcomeCode.DEGRADED_AVAILABILITY].fallback is contract.FallbackPolicy.WITHIN_AUTHORIZED_SET
    assert policies[OutcomeCode.TRANSIENT_FAILURE].fallback is contract.FallbackPolicy.WITHIN_AUTHORIZED_SET


def test_the_raised_failures_carry_their_own_code():
    authorization = AuthorizationError("not authorized", operation=OperationName.READ_SOURCE)
    transient = TransientError("upstream is down", operation=OperationName.SEARCH_KNOWLEDGE)

    assert isinstance(authorization, CapabilityError)
    assert authorization.code is OutcomeCode.AUTHORIZATION_FAILURE
    assert authorization.operation is OperationName.READ_SOURCE
    assert transient.code is OutcomeCode.TRANSIENT_FAILURE
    assert transient.operation is OperationName.SEARCH_KNOWLEDGE


def test_an_authorization_failure_is_not_retryable_and_a_transient_one_is():
    policies = contract.OUTCOME_POLICIES

    assert policies[OutcomeCode.AUTHORIZATION_FAILURE].retryable is False
    assert policies[OutcomeCode.TRANSIENT_FAILURE].retryable is True


# --- provenance ------------------------------------------------------------


def test_a_legacy_source_carries_the_file_id_and_no_source_marker():
    provenance = LegacyFileProvenance(file_id=LEGACY_FILE_ID)

    assert provenance.file_id == LEGACY_FILE_ID
    assert not hasattr(provenance, "source")


def test_an_okf_source_carries_the_concept_identity_and_the_source_marker():
    provenance = an_okf_provenance()

    assert provenance.source == "okf-concept"
    assert provenance.concept_id == OKF_CONCEPT_ID
    assert provenance.repo_id == OKF_REPO_ID
    assert provenance.bundle_version == 3


def test_the_bundle_version_must_be_stated_even_when_it_is_unknown():
    with pytest.raises(ValidationError):
        OkfConceptProvenance(concept_id=OKF_CONCEPT_ID, repo_id=OKF_REPO_ID)

    unresolved = OkfConceptProvenance(concept_id=OKF_CONCEPT_ID, repo_id=OKF_REPO_ID, bundle_version=None)
    assert unresolved.bundle_version is None


def test_a_mixed_identity_validates_against_neither_source_type():
    with pytest.raises(ValidationError):
        LegacyFileProvenance(file_id=LEGACY_FILE_ID, concept_id=OKF_CONCEPT_ID)

    with pytest.raises(ValidationError):
        OkfConceptProvenance(
            concept_id=OKF_CONCEPT_ID,
            repo_id=OKF_REPO_ID,
            bundle_version=3,
            file_id=LEGACY_FILE_ID,
        )


def test_a_provenance_carries_no_extra_field():
    with pytest.raises(ValidationError):
        LegacyFileProvenance(file_id=LEGACY_FILE_ID, chunk_key="chunk-1")


# --- the trusted caller context --------------------------------------------


def test_the_caller_context_carries_the_authorized_set_and_the_repo_mapping():
    context = a_caller_context()

    assert context.user_id == "user-1"
    assert OKF_GRAPH_NAME in context.authorized_graph_names
    assert context.authorized_repos[0].repo_id == OKF_REPO_ID
    assert context.authorized_repos[0].graph_name == OKF_GRAPH_NAME


def test_the_caller_context_rejects_an_unknown_field():
    with pytest.raises(ValidationError):
        CallerContext(user_id="user-1", authorized_graph_names=(), role="admin")


# --- the inputs ------------------------------------------------------------


@pytest.mark.parametrize(
    ("model", "expected_fields"),
    [
        (SearchKnowledgeInput, {"query"}),
        (PreparedQuery, {"text", "preparation_status"}),
        (ReadSourceInput, {"target"}),
        (LegacyFileRef, {"file_id"}),
        (OkfConceptRef, {"repo_id", "concept_id"}),
    ],
)
def test_no_input_carries_a_field_that_could_widen_access(model, expected_fields):
    """The narrowing travels in the caller context; an input may only ask.

    A target may name what it wants to read — the executor checks it against
    the caller's authorized set. What no input may carry is a scope: a graph
    set, an authorized repository list, an ACL or a caller identity.
    """
    assert set(model.model_fields) == expected_fields

    forbidden = ("graph", "scope", "acl", "user", "tenant", "authorized", "label", "permission")
    for name in model.model_fields:
        assert not any(word in name.lower() for word in forbidden), name


def test_the_search_input_takes_a_prepared_query():
    request = SearchKnowledgeInput(query=a_prepared_query())

    assert request.query.text == "How is the energy policy applied?"


def test_a_query_that_is_not_prepared_is_refused_before_the_operation_runs():
    for status in (
        QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE,
        QueryPreparationStatus.FALLBACK_TIMEOUT,
        QueryPreparationStatus.FALLBACK_ERROR,
    ):
        with pytest.raises(ValidationError):
            PreparedQuery(text="une question", preparation_status=status)


def test_a_prepared_query_is_accepted_for_every_prepared_status():
    for status in (QueryPreparationStatus.TRANSLATED, QueryPreparationStatus.PASSTHROUGH_ENGLISH):
        assert PreparedQuery(text="a question", preparation_status=status).preparation_status is status


def test_the_read_target_names_the_repository_with_the_concept():
    target = OkfConceptRef(repo_id=OKF_REPO_ID, concept_id=OKF_CONCEPT_ID)

    assert ReadSourceInput(target=target).target.repo_id == OKF_REPO_ID
    assert ReadSourceInput(target=LegacyFileRef(file_id=LEGACY_FILE_ID)).target.file_id == LEGACY_FILE_ID


# --- the results -----------------------------------------------------------


def test_a_successful_search_carries_at_least_one_hit():
    result = SearchKnowledgeResult(
        outcome=OutcomeCode.SUCCESS,
        hits=(a_legacy_hit(), an_okf_hit()),
        query_preparation_status=QueryPreparationStatus.TRANSLATED,
    )

    assert len(result.hits) == 2


def test_an_empty_search_is_an_insufficiency_and_not_a_success():
    with pytest.raises(ValidationError):
        SearchKnowledgeResult(
            outcome=OutcomeCode.SUCCESS,
            hits=(),
            query_preparation_status=QueryPreparationStatus.TRANSLATED,
        )

    empty = SearchKnowledgeResult(
        outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
        hits=(),
        query_preparation_status=QueryPreparationStatus.TRANSLATED,
    )
    assert empty.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE


def test_a_degraded_search_may_report_partial_hits_and_the_truncation():
    result = SearchKnowledgeResult(
        outcome=OutcomeCode.DEGRADED_AVAILABILITY,
        hits=(a_legacy_hit(),),
        truncated=True,
        query_preparation_status=QueryPreparationStatus.TRANSLATED,
    )

    assert result.truncated is True
    assert len(result.hits) == 1


def test_the_search_result_reports_the_preparation_status():
    result = SearchKnowledgeResult(
        outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
        query_preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH,
    )

    assert result.query_preparation_status is QueryPreparationStatus.PASSTHROUGH_ENGLISH


def test_a_successful_read_carries_the_provenance_and_the_content():
    result = ReadSourceResult(
        outcome=OutcomeCode.SUCCESS,
        provenance=an_okf_provenance(),
        content="the concept body",
    )

    assert result.provenance.concept_id == OKF_CONCEPT_ID
    assert result.content == "the concept body"


def test_a_successful_read_without_a_source_is_refused():
    with pytest.raises(ValidationError):
        ReadSourceResult(outcome=OutcomeCode.SUCCESS, content="the concept body")


def test_a_successful_read_without_content_is_refused():
    with pytest.raises(ValidationError):
        ReadSourceResult(outcome=OutcomeCode.SUCCESS, provenance=an_okf_provenance())


def test_a_read_of_a_target_that_does_not_resolve_is_an_insufficiency_without_provenance():
    result = ReadSourceResult(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE)

    assert result.outcome is OutcomeCode.INSUFFICIENT_EVIDENCE
    assert result.provenance is None
    assert result.content is None


# --- the budget and the port ------------------------------------------------


def test_a_budget_carries_positive_limits():
    budget = OperationBudget(timeout_ms=5000, max_results=3, max_result_bytes=65536)

    assert budget.timeout_ms == 5000


@pytest.mark.parametrize(
    "field",
    ["timeout_ms", "max_results", "max_result_bytes"],
)
def test_a_budget_refuses_a_non_positive_limit(field):
    values = {"timeout_ms": 5000, "max_results": 3, "max_result_bytes": 65536}
    values[field] = 0

    with pytest.raises(ValidationError):
        OperationBudget(**values)


def test_the_port_declares_both_operations_with_the_context_and_the_budget():
    for method_name in ("search_knowledge", "read_source"):
        method = getattr(contract.DocumentCapabilityPort, method_name)
        parameters = list(inspect.signature(method).parameters)

        if method_name == "search_knowledge":
            # The optional per-call abstention sink is part of the DECLARED
            # protocol: the executor threads it into the inner port call, so
            # a port conforming to the declared signature must accept it —
            # a 3-args-only port raises TypeError the moment a caller
            # supplies a sink.
            assert parameters == ["self", "context", "request", "budget", "abstention_sink"]
        else:
            assert parameters == ["self", "context", "request", "budget"]
        assert inspect.iscoroutinefunction(method)


# --- versioning -------------------------------------------------------------


def test_the_same_major_version_is_compatible():
    assert is_compatible("1.0", "1.0") is True
    assert is_compatible("1.0", "1.3") is True
    assert is_compatible("1.2", "1.9") is True


def test_a_different_major_version_is_not_compatible():
    assert is_compatible("1.0", "2.0") is False
    assert is_compatible("2.0", "1.0") is False


def test_an_older_minor_version_is_not_compatible():
    """A minor bump only adds, so an older provider lacks what the consumer expects."""
    assert is_compatible("1.2", "1.0") is False


def test_the_rules_state_that_outcome_codes_are_stable():
    assert contract.COMPATIBILITY.error_codes_stable is True
    assert contract.COMPATIBILITY.unknown_major_incompatible is True
    assert contract.COMPATIBILITY.current_version == contract.CONTRACT_VERSION


def test_removing_a_field_or_changing_a_carrier_is_declared_breaking():
    breaking = " ".join(contract.COMPATIBILITY.breaking)

    assert "removing or renaming a field" in breaking
    assert "carrier" in breaking


# --- the invariants the review pinned ---------------------------------------


def test_an_authorized_repository_may_not_name_a_graph_outside_the_set():
    """The mapping resolves inside the authorized set — never past it."""
    with pytest.raises(ValidationError):
        CallerContext(
            user_id="user-1",
            authorized_graph_names=("GRAPH",),
            authorized_repos=(AuthorizedRepo(repo_id=OKF_REPO_ID, graph_name="SOME_OTHER_GRAPH"),),
        )


def test_a_repository_id_may_appear_once():
    with pytest.raises(ValidationError):
        CallerContext(
            user_id="user-1",
            authorized_graph_names=("GRAPH", OKF_GRAPH_NAME),
            authorized_repos=(
                AuthorizedRepo(repo_id=OKF_REPO_ID, graph_name=OKF_GRAPH_NAME),
                AuthorizedRepo(repo_id=OKF_REPO_ID, graph_name="GRAPH"),
            ),
        )


def test_no_two_vocabularies_share_a_value():
    """Every enum here is a string enum: a shared value would make a limit
    breach compare equal to an outcome code."""
    vocabularies = {
        "outcome": set(OutcomeCode),
        "carrier": set(contract.OutcomeCarrier),
        "fallback": set(contract.FallbackPolicy),
        "limit scope": set(contract.LimitScope),
        "limit breach": set(contract.LimitBreach),
    }
    seen: dict[str, str] = {}
    for name, members in vocabularies.items():
        for member in members:
            assert member.value not in seen, f"{name}.{member.name} shares its value with {seen.get(member.value)}"
            seen[member.value] = f"{name}.{member.name}"


def test_an_insufficiency_carries_no_hit():
    with pytest.raises(ValidationError):
        SearchKnowledgeResult(
            outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
            hits=(a_legacy_hit(),),
            query_preparation_status=QueryPreparationStatus.TRANSLATED,
        )


def test_an_insufficiency_carries_no_source():
    with pytest.raises(ValidationError):
        ReadSourceResult(
            outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
            provenance=an_okf_provenance(),
            content="the concept body",
        )


def test_the_result_reports_a_prepared_status_only():
    with pytest.raises(ValidationError):
        SearchKnowledgeResult(
            outcome=OutcomeCode.INSUFFICIENT_EVIDENCE,
            query_preparation_status=QueryPreparationStatus.FALLBACK_ERROR,
        )


def test_a_new_outcome_code_is_a_breaking_change():
    """The result vocabulary is closed, so a new code is not additive."""
    additive = " ".join(contract.COMPATIBILITY.additive)
    breaking = " ".join(contract.COMPATIBILITY.breaking)

    assert "outcome code" not in additive
    assert "outcome code" in breaking


def test_each_operation_declares_its_own_limits():
    search = contract.OPERATION_SPECS[OperationName.SEARCH_KNOWLEDGE]
    read = contract.OPERATION_SPECS[OperationName.READ_SOURCE]

    assert search.timeout is not read.timeout
    assert search.result_size is not read.result_size
    assert search.cancellation is not read.cancellation


def test_a_limit_declaration_cannot_be_mutated():
    declaration = contract.OPERATION_SPECS[OperationName.SEARCH_KNOWLEDGE].timeout

    with pytest.raises(ValidationError):
        declaration.breach = contract.LimitBreach.CANCELLED


def test_an_operation_spec_is_hashable_and_frozen():
    assert len({contract.OPERATION_SPECS[name] for name in OperationName}) == 2

    spec = contract.OPERATION_SPECS[OperationName.SEARCH_KNOWLEDGE]
    with pytest.raises(dataclasses.FrozenInstanceError):
        spec.version = "9.9"


def test_the_error_classes_carry_their_code_on_the_class():
    assert AuthorizationError.code is OutcomeCode.AUTHORIZATION_FAILURE
    assert TransientError.code is OutcomeCode.TRANSIENT_FAILURE


@pytest.mark.parametrize("version", ["+1.0", " 1.0", "1.-1", "1.0.0", "1", "one.zero", ""])
def test_a_malformed_version_is_never_compatible(version):
    assert is_compatible(version, "1.0") is False
    assert is_compatible("1.0", version) is False


def test_a_new_field_is_a_breaking_change():
    """Every model refuses the fields it does not know, so an added field is
    rejected by an older consumer — not ignored."""
    additive = " ".join(contract.COMPATIBILITY.additive)
    breaking = " ".join(contract.COMPATIBILITY.breaking)

    assert "field" not in additive
    assert "adding a field" in breaking


def test_a_unicode_digit_version_is_not_a_version():
    assert is_compatible("١.٠", "1.0") is False
    assert is_compatible("1.0", "１.０") is False


def test_the_prepared_statuses_are_the_recorded_ones():
    """The prepared vocabulary is the recorded one, and it is declared once.

    The result type's literal is the only declaration: the membership test the
    input validator uses reads that same literal, so the two cannot drift.
    """
    assert set(contract.PreparedStatus.__args__) == {
        QueryPreparationStatus.TRANSLATED,
        QueryPreparationStatus.PASSTHROUGH_ENGLISH,
    }
    for status in QueryPreparationStatus:
        assert status.is_prepared is (status in set(contract.PreparedStatus.__args__))


def test_every_model_refuses_the_fields_it_does_not_know():
    """The compatibility rules rest on this: an older consumer rejects a
    newer provider's extra field rather than ignoring it."""
    models = [
        obj
        for obj in vars(contract).values()
        if isinstance(obj, type) and issubclass(obj, BaseModel) and obj is not BaseModel
    ]

    assert models
    for model in models:
        assert model.model_config.get("extra") == "forbid", model.__name__


def test_the_closed_vocabularies_are_the_declared_ones():
    """A closed vocabulary may only grow with a version bump, so its members
    are pinned: adding one is a deliberate act, not an edit."""
    assert set(typing.get_args(contract.Provenance)) == {LegacyFileProvenance, OkfConceptProvenance}
    assert set(typing.get_args(contract.SourceRef)) == {LegacyFileRef, OkfConceptRef}
    assert set(contract.LimitScope) == {contract.LimitScope.OPERATION, contract.LimitScope.RESULT}
    assert set(contract.LimitBreach) == {
        contract.LimitBreach.TRANSIENT_FAILURE,
        contract.LimitBreach.TRUNCATE_AND_FLAG,
        contract.LimitBreach.CANCELLED,
    }
    assert set(QueryPreparationStatus) == {
        QueryPreparationStatus.TRANSLATED,
        QueryPreparationStatus.PASSTHROUGH_ENGLISH,
        QueryPreparationStatus.PASSTHROUGH_UNKNOWN_LANGUAGE,
        QueryPreparationStatus.FALLBACK_TIMEOUT,
        QueryPreparationStatus.FALLBACK_ERROR,
    }
    assert set(OutcomeCode) == {
        OutcomeCode.SUCCESS,
        OutcomeCode.AUTHORIZATION_FAILURE,
        OutcomeCode.INSUFFICIENT_EVIDENCE,
        OutcomeCode.DEGRADED_AVAILABILITY,
        OutcomeCode.TRANSIENT_FAILURE,
    }
    assert set(contract.OUTCOME_POLICIES) == set(OutcomeCode)


def test_the_result_vocabulary_names_the_reported_codes():
    """A result may only carry a code the policy table reports in a result: a
    raised code in the literal would make the carrier contract unenforceable by
    the types while the policy table still said otherwise."""
    reported = {
        code for code, policy in contract.OUTCOME_POLICIES.items() if policy.carrier is contract.OutcomeCarrier.RESULT
    }

    assert set(contract.ResultOutcome.__args__) == reported
    assert set(contract.ResultOutcome.__args__) == {
        OutcomeCode.SUCCESS,
        OutcomeCode.INSUFFICIENT_EVIDENCE,
        OutcomeCode.DEGRADED_AVAILABILITY,
    }


def test_every_closed_vocabulary_is_declared_breaking():
    """The breaking list is the machine-readable half of the rules: a closed
    vocabulary missing from it is a silent gap between the prose and the data."""
    breaking = " ".join(contract.COMPATIBILITY.breaking)

    assert "adding a field" in breaking
    assert "adding an outcome code" in breaking
    assert "adding a provenance variant or a source-ref variant" in breaking
    assert "adding a preparation status" in breaking
    assert "adding a limit scope or a limit breach" in breaking


def test_every_semantic_change_is_declared_breaking():
    """The non-vocabulary breaking clauses are pinned the same way: a semantic
    change whose clause went missing would silently demote a major change to
    an unannounced one."""
    breaking = " ".join(contract.COMPATIBILITY.breaking)

    assert "changing the meaning of an existing field" in breaking
    assert "changing the carrier, the retry rule or the fallback rule of an outcome code" in breaking
    assert "changing the carrier or the semantics of a limit declaration" in breaking
    assert "changing the identity a provenance variant carries" in breaking
