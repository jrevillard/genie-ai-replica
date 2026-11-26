# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The citation verification pipeline: the ledger, the mechanical
reference validity, the budgeted grounding judge, the tri-state verdict.

Mutation-sensitive pins: the ledger cites only successful tool results (an
error envelope or an insufficiency cites nothing, but marks the attempt),
dedup keeps the first served identity; the reference-validity check drops an
unauthorized repo and records it; the mechanical outcome decides BEFORE the
judge (no retrieval → unverified; nothing validly citable → ungrounded,
judge skipped); every judge failure mode (timeout, budget, malformed,
exception) yields ``unverified`` — never ``grounded``; the payload is the
projection contract verbatim (``grounding_status``, derived ``is_grounded``,
recorded ``translation_mode``, the delivered set, the marking).
"""

import asyncio
import time

import pytest
from conftest import FakeConceptSource, FakeMetadataSource, ScriptedLoopModel, run_budget

from agent.budget import RunBudgetMonitor
from agent.verification import (
    JUDGE_OUTCOME_BUDGET_EXHAUSTED,
    JUDGE_OUTCOME_COMPLETED,
    JUDGE_OUTCOME_ERROR,
    JUDGE_OUTCOME_SKIPPED,
    JUDGE_OUTCOME_TIMEOUT,
    POLICY_VERDICT_MARKED,
    TRANSLATION_MODE_NONE,
    VERDICT_GROUNDED,
    VERDICT_UNGROUNDED,
    VERDICT_UNVERIFIED,
    GroundingJudge,
    RetrievalLedger,
    VerificationPipeline,
    check_reference_validity,
    citation_identity,
    parse_judge_verdict,
)
from capabilities.model import ModelTurn

LEGACY_HIT = {
    "provenance": {"file_id": "f-1"},
    "text": "the grievance passage",
    "score": 0.9,
}
OKF_HIT = {
    "provenance": {"source": "okf-concept", "concept_id": "c-1", "repo_id": "r-1", "bundle_version": 3},
    "text": "the concept passage",
    "score": 0.8,
}
SEARCH_SUCCESS = {"result": {"outcome": "success", "hits": [LEGACY_HIT], "truncated": False}}
SEARCH_INSUFFICIENT = {"result": {"outcome": "insufficient_evidence", "hits": [], "truncated": False}}
READ_SUCCESS = {"result": {"outcome": "success", "provenance": {"file_id": "f-1"}, "content": "the full text"}}
SEARCH_ERROR = {"error": {"code": "authorization_refused", "operation": "search_knowledge", "message": "no"}}


def _search_payload(hits):
    return {"result": {"outcome": "success", "hits": hits, "truncated": False}}


# ---------------------------------------------------------------------
# The evidence ledger: citations come only from successful results
# ---------------------------------------------------------------------


def test_the_ledger_cites_success_results_only():
    ledger = RetrievalLedger()
    ledger.record("search_knowledge", _search_payload([LEGACY_HIT]))
    ledger.record("read_source", READ_SUCCESS)

    assert ledger.entries == [
        {"provenance": {"file_id": "f-1"}, "text": "the grievance passage", "score": 0.9}
    ]  # the read dedups to the same identity — first served wins


def test_the_ledger_records_an_error_envelope_as_citing_nothing():
    ledger = RetrievalLedger()
    ledger.record("search_knowledge", SEARCH_ERROR)

    assert ledger.entries == []


def test_an_insufficiency_result_cites_nothing():
    ledger = RetrievalLedger()
    ledger.record("search_knowledge", SEARCH_INSUFFICIENT)

    assert ledger.entries == []


def test_the_ledger_ignores_unregistered_tool_names_and_malformed_hits():
    ledger = RetrievalLedger()
    ledger.record("registry_admin", {"result": {"anything": True}})
    ledger.record("search_knowledge", _search_payload([{"provenance": {"file_id": "f-1"}}]))  # no text
    ledger.record("search_knowledge", _search_payload([{"text": "no identity"}]))

    assert ledger.entries == []


def test_a_success_that_contributed_no_citable_entry_is_not_a_successful_retrieval():
    """The insufficiency decision reads what the ledger HOLDS, not what the
    outcome string claimed: a read whose content is empty/whitespace cites
    nothing, so counting it as served evidence would let the drafted text
    ship instead of the insufficiency response."""
    ledger = RetrievalLedger()
    ledger.record("read_source", {"result": {"outcome": "success", "provenance": {"file_id": "f-1"}, "content": "   "}})
    ledger.record("read_source", {"result": {"outcome": "success", "provenance": {"file_id": "f-1"}, "content": None}})

    assert ledger.entries == []
    assert ledger.successful_retrievals == 0

    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content="never asked"),))
    pipeline.record_tool_result(
        "read_source", {"result": {"outcome": "success", "provenance": {"file_id": "f-1"}, "content": "   "}}
    )
    verdict = asyncio.run(pipeline.finalize("a drafted confident answer"))

    assert verdict.insufficient_required is True
    assert verdict.insufficient_evidence["reasons"] == ["no_successful_retrieval"]


def test_all_duplicate_hits_do_not_count_as_a_successful_retrieval():
    ledger = RetrievalLedger()
    ledger.record("search_knowledge", _search_payload([LEGACY_HIT]))
    ledger.record("search_knowledge", _search_payload([dict(LEGACY_HIT, text="duplicate of the first")]))

    assert ledger.successful_retrievals == 1  # only the dispatch that grew the ledger


def test_the_ledger_dedups_by_the_stable_identity():
    ledger = RetrievalLedger()
    ledger.record("search_knowledge", _search_payload([OKF_HIT, dict(OKF_HIT, text="the same concept again")]))

    assert [citation_identity(entry["provenance"]) for entry in ledger.entries] == [("r-1", "c-1")]


def test_a_read_without_resolved_provenance_cites_nothing():
    ledger = RetrievalLedger()
    ledger.record("read_source", {"result": {"outcome": "success", "provenance": None, "content": None}})

    assert ledger.entries == []


# ---------------------------------------------------------------------
# Reference validity: mechanical, per citation, no LLM
# ---------------------------------------------------------------------


def test_a_legacy_citation_is_delivered_when_it_resolves():
    validity = check_reference_validity([LEGACY_HIT], frozenset())
    assert validity.invalid == () and len(validity.delivered) == 1


def test_an_okf_citation_outside_the_authorized_repos_is_dropped_and_recorded():
    validity = check_reference_validity([OKF_HIT], frozenset({"other-repo"}))

    assert validity.delivered == ()
    assert validity.invalid == ({"provenance": OKF_HIT["provenance"], "reason": "unauthorized_repo"},)


def test_an_okf_citation_inside_the_authorized_repos_is_delivered():
    validity = check_reference_validity([OKF_HIT], frozenset({"r-1"}))
    assert validity.invalid == () and len(validity.delivered) == 1


# ---------------------------------------------------------------------
# The judge: strict JSON, every failure mode degrades to unverified
# ---------------------------------------------------------------------


def test_the_judge_parses_only_the_strict_verdict_object():
    assert parse_judge_verdict('{"verdict": "grounded"}') == VERDICT_GROUNDED
    assert parse_judge_verdict('{"verdict": "ungrounded"}') == VERDICT_UNGROUNDED
    assert parse_judge_verdict('{"verdict": "unverified"}') is None  # not a judge answer
    assert parse_judge_verdict('{"verdict": "grounded", "extra": 1}') is None  # extra keys: a judge error
    assert parse_judge_verdict("grounded") is None
    assert parse_judge_verdict('```json\n{"verdict": "grounded"}\n```') is None  # fenced: a judge error
    assert parse_judge_verdict("") is None
    assert parse_judge_verdict(None) is None


def test_the_judge_call_rides_the_aux_budget_and_the_remaining_bound():
    monitor = RunBudgetMonitor(run_budget(max_total_tokens=5000))
    judge_model = ScriptedLoopModel(
        (ModelTurn(content='{"verdict": "grounded"}', prompt_tokens=7, completion_tokens=3),)
    )
    judge = GroundingJudge(model_client=judge_model, monitor=monitor, timeout_seconds=5.0)
    result = asyncio.run(judge.judge("the answer", [LEGACY_HIT]))

    assert result == {"ran": True, "outcome": JUDGE_OUTCOME_COMPLETED, "verdict": VERDICT_GROUNDED}
    assert (monitor.model_calls, monitor.aux_model_calls) == (1, 1)  # the fleet budget, aux-tallied
    assert (monitor.prompt_tokens, monitor.completion_tokens) == (7, 3)  # served usage recorded
    request = judge_model.requests[0]
    assert request["max_output_tokens"] == 5000  # the remaining allowance rides the call
    assert request["tool_definitions"] == ()  # the judge calls no tools
    assert request["messages"][1]["content"].startswith("ANSWER:")  # the answer rides the user message


def test_a_spent_model_call_budget_skips_the_judge_as_budget_exhausted():
    monitor = RunBudgetMonitor(run_budget(max_model_calls=1))
    monitor.take_model_call()  # the loop spent the fleet budget
    judge_model = ScriptedLoopModel(())
    judge = GroundingJudge(model_client=judge_model, monitor=monitor, timeout_seconds=5.0)
    result = asyncio.run(judge.judge("the answer", [LEGACY_HIT]))

    assert result == {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
    assert judge_model.requests == []  # no call left the budget


def test_a_spent_token_budget_refuses_the_judge_before_it_claims_a_model_call():
    """No room for one more call: the judge is refused BEFORE the aux slot
    is consumed — the usage record never counts a call that never happened."""
    monitor = RunBudgetMonitor(run_budget(max_total_tokens=100))
    monitor.record_usage(60, 40)  # the token budget is spent exactly
    judge_model = ScriptedLoopModel(())
    judge = GroundingJudge(model_client=judge_model, monitor=monitor, timeout_seconds=5.0)
    result = asyncio.run(judge.judge("the answer", [LEGACY_HIT]))

    assert result == {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
    assert (monitor.model_calls, monitor.aux_model_calls) == (0, 0)  # nothing was claimed
    assert judge_model.requests == []


def test_a_judge_timeout_yields_timeout_never_a_verdict():
    class HangingJudgeModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            await asyncio.Event().wait()  # forever

    judge = GroundingJudge(
        model_client=HangingJudgeModel(), monitor=RunBudgetMonitor(run_budget()), timeout_seconds=0.01
    )
    result = asyncio.run(judge.judge("the answer", [LEGACY_HIT]))

    assert result == {"ran": True, "outcome": JUDGE_OUTCOME_TIMEOUT, "verdict": None}


def test_a_judge_timeout_marks_the_run_usage_gap():
    """The response that carries the judge's served usage never arrived:
    the run's served totals must be reported as a lower bound, or the
    residual budget downstream would compute a remaining allowance that
    includes the tokens the timed-out call spent."""

    class HangingJudgeModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            await asyncio.Event().wait()  # forever

    monitor = RunBudgetMonitor(run_budget(max_total_tokens=5000))
    monitor.record_usage(100, 50)
    assert monitor.remaining_output_tokens() == 4850  # exact before the timeout
    judge = GroundingJudge(model_client=HangingJudgeModel(), monitor=monitor, timeout_seconds=0.01)
    asyncio.run(judge.judge("the answer", [LEGACY_HIT]))
    assert monitor.remaining_output_tokens() is None  # a bound cannot say what remains


def test_a_judge_error_still_records_the_served_usage():
    """An unparseable verdict is a judge failure, not unreportable usage:
    the call was served, so its tokens are accounted for."""
    judge_model = ScriptedLoopModel((ModelTurn(content="not a verdict", prompt_tokens=5, completion_tokens=2),))
    monitor = RunBudgetMonitor(run_budget())
    judge = GroundingJudge(model_client=judge_model, monitor=monitor, timeout_seconds=5.0)
    result = asyncio.run(judge.judge("the answer", [LEGACY_HIT]))
    assert result == {"ran": True, "outcome": JUDGE_OUTCOME_ERROR, "verdict": None}
    assert (monitor.prompt_tokens, monitor.completion_tokens) == (5, 2)


# ---------------------------------------------------------------------
# The pipeline: the mechanical outcome decides before the judge
# ---------------------------------------------------------------------


def _pipeline(monitor=None, judge_turns=(), authorized_repos=(), metadata_source=None, concept_source=None):
    monitor = monitor if monitor is not None else RunBudgetMonitor(run_budget())
    pipeline = VerificationPipeline(
        policy=POLICY_VERDICT_MARKED,
        judge_timeout_ms=5000,
        judge_model_client=ScriptedLoopModel(judge_turns),
        monitor=monitor,
        authorized_repos=authorized_repos,
        metadata_source=metadata_source if metadata_source is not None else FakeMetadataSource(),
        concept_source=concept_source if concept_source is not None else FakeConceptSource(),
    )
    return pipeline, monitor


def test_a_source_whose_metadata_did_not_resolve_is_not_surfaced():
    """The D1 rule, in the governed path: no source surfaced, no confidence
    poison.

    The delivered citations still ride the payload (the evidence is a fact),
    but the CITATION CARD of a document that did not resolve does not: a
    deleted document (or a document repository that is down) must not become
    a source the reader sees.
    """
    pipeline, _monitor = _pipeline(
        judge_turns=(ModelTurn(content='{"verdict": "grounded"}'),),
        metadata_source=FakeMetadataSource(unresolved=("f-1",)),
        concept_source=FakeConceptSource(),
    )
    pipeline.record_tool_result(
        "search_knowledge",
        {
            "result": {
                "outcome": "success",
                "hits": [{"provenance": {"file_id": "f-1"}, "text": "the passage", "score": 0.9}],
                "truncated": False,
            }
        },
    )

    verdict = asyncio.run(pipeline.finalize("an answer"))

    assert verdict.payload()["source_documents"] == []
    # The evidence itself is untouched: the ledger still holds the entry.
    assert verdict.payload()["citations"][0]["provenance"] == {"file_id": "f-1"}


def test_no_retrieval_at_all_verifies_unverified_with_the_judge_skipped():
    pipeline, monitor = _pipeline(judge_turns=(ModelTurn(content="never asked"),))
    verdict = asyncio.run(pipeline.finalize("an answer with nothing behind it"))

    assert verdict.status == VERDICT_UNVERIFIED
    assert verdict.payload()["judge"] == {"ran": False, "outcome": JUDGE_OUTCOME_SKIPPED, "verdict": None}
    assert monitor.aux_model_calls == 0  # the judge never consumed the fleet budget
    assert verdict.payload()["marking"] == {"required": False, "reason": None}


def test_an_insufficiency_outcome_verifies_unverified_never_marked_ungrounded():
    """The recorded distinct abstention (every search returned
    insufficiency): the answer claims nothing, so it is ``unverified`` with
    no marking — never the ungrounded correction."""
    pipeline, monitor = _pipeline(judge_turns=(ModelTurn(content="never asked"),))
    pipeline.record_tool_result("search_knowledge", SEARCH_INSUFFICIENT)
    verdict = asyncio.run(pipeline.finalize("the corpus does not contain this"))

    assert verdict.status == VERDICT_UNVERIFIED
    payload = verdict.payload()
    assert payload["judge"]["outcome"] == JUDGE_OUTCOME_SKIPPED
    assert payload["marking"] == {"required": False, "reason": None}
    assert monitor.aux_model_calls == 0


def test_an_error_envelope_verifies_unverified_never_marked_ungrounded():
    """A retrieval attempt that failed (here: authorization refused) surfaced
    nothing citable — the honest answer over it is ``unverified``, not an
    ungrounded marking on a claim that was never made."""
    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content="never asked"),))
    pipeline.record_tool_result("search_knowledge", SEARCH_ERROR)
    verdict = asyncio.run(pipeline.finalize("I could not retrieve the documents"))

    assert verdict.status == VERDICT_UNVERIFIED
    assert verdict.payload()["marking"] == {"required": False, "reason": None}


def test_retrieval_with_nothing_validly_citable_is_ungrounded_before_the_judge():
    pipeline, monitor = _pipeline(
        judge_turns=(ModelTurn(content="never asked"),),
        authorized_repos=(),  # r-1 not authorized
    )
    pipeline.record_tool_result("search_knowledge", _search_payload([OKF_HIT]))
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_UNGROUNDED
    assert verdict.payload()["judge"]["outcome"] == JUDGE_OUTCOME_SKIPPED
    assert verdict.payload()["invalid_citations"] == [
        {"provenance": OKF_HIT["provenance"], "reason": "unauthorized_repo"}
    ]
    assert verdict.payload()["marking"] == {"required": True, "reason": VERDICT_UNGROUNDED}
    assert monitor.aux_model_calls == 0


def test_a_grounded_judge_verdict_grounds_the_answer():
    pipeline, monitor = _pipeline(judge_turns=(ModelTurn(content='{"verdict": "grounded"}'),))
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_GROUNDED
    payload = verdict.payload()
    assert payload["grounding_status"] == VERDICT_GROUNDED
    assert payload["is_grounded"] is True
    assert payload["translation_mode"] == TRANSLATION_MODE_NONE
    assert payload["policy"] == POLICY_VERDICT_MARKED
    assert payload["judge"] == {"ran": True, "outcome": JUDGE_OUTCOME_COMPLETED, "verdict": VERDICT_GROUNDED}
    assert payload["citations"] == [{"provenance": {"file_id": "f-1"}, "text": "the grievance passage", "score": 0.9}]
    assert payload["invalid_citations"] == []
    assert payload["marking"] == {"required": False, "reason": None}
    assert monitor.aux_model_calls == 1


def test_an_unsupported_judge_verdict_ungrounds_and_marks():
    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content='{"verdict": "ungrounded"}'),))
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_UNGROUNDED
    payload = verdict.payload()
    assert payload["is_grounded"] is False
    assert payload["marking"] == {"required": True, "reason": VERDICT_UNGROUNDED}


def test_a_malformed_judge_reply_verifies_unverified():
    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content="I am sure it is grounded."),))
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_UNVERIFIED
    payload = verdict.payload()
    assert payload["judge"]["outcome"] == JUDGE_OUTCOME_ERROR
    assert payload["is_grounded"] is False  # derived from the tri-state, not the judge's prose
    assert payload["marking"] == {"required": False, "reason": None}


def test_a_judge_exception_verifies_unverified_never_raises():
    class ExplodingJudgeModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            raise RuntimeError("the endpoint is gone")

    monitor = RunBudgetMonitor(run_budget())
    pipeline = VerificationPipeline(
        policy=POLICY_VERDICT_MARKED,
        judge_timeout_ms=5000,
        judge_model_client=ExplodingJudgeModel(),
        monitor=monitor,
        authorized_repos=(),
        metadata_source=FakeMetadataSource(),
        concept_source=FakeConceptSource(),
    )
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_UNVERIFIED
    assert verdict.payload()["judge"]["outcome"] == JUDGE_OUTCOME_ERROR


def test_the_delivered_set_dedups_search_and_read_to_one_citation():
    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content='{"verdict": "grounded"}'),))
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    pipeline.record_tool_result("read_source", READ_SUCCESS)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert len(verdict.payload()["citations"]) == 1


# ---------------------------------------------------------------------
# The projection contract: one dict, read verbatim
# ---------------------------------------------------------------------


def test_the_payload_is_the_projection_contract_verbatim():
    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content='{"verdict": "grounded"}'),))
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    payload = asyncio.run(pipeline.finalize("the answer")).payload()

    assert set(payload) == {
        "grounding_status",
        "is_grounded",
        "translation_mode",
        "policy",
        "judge",
        "citations",
        "invalid_citations",
        "insufficient_evidence",
        "findings",
        "source_documents",
        "marking",
    }
    # The additive fields: the insufficiency decision is explicit
    # (required false on a normal run, empty findings, and the delivered
    # citations projected onto the frontend envelope).
    assert payload["insufficient_evidence"] == {"required": False, "reasons": []}
    assert payload["findings"] == []
    assert payload["source_documents"] == [
        {
            "document_id": "f-1",
            # The DOCUMENT's name, as the document repository resolved it —
            # never the id (ADR agentic-009, F5).
            "document_name": "f-1 resolved.md",
            "url": "",
            "categoryLabels": [],
            "serviceLabels": [],
            "score": 0.9,
        }
    ]
    # The tri-state vocabulary is CLOSED — exactly these three values, the
    # only statuses the payload's grounding_status can ever carry.
    from agent import verification

    assert {verification.VERDICT_GROUNDED, verification.VERDICT_UNGROUNDED, verification.VERDICT_UNVERIFIED} == {
        "grounded",
        "ungrounded",
        "unverified",
    }


def test_the_marking_follows_the_policy_and_the_status():
    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content='{"verdict": "ungrounded"}'),))
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.marking_required is True  # verdict-marked AND ungrounded
    assert verdict.payload()["marking"] == {"required": True, "reason": VERDICT_UNGROUNDED}


# ---------------------------------------------------------------------
# Coverage pins: the wiring the G1/FIX reviews' mutations could hide
# ---------------------------------------------------------------------


def test_the_authorized_repos_normalization_binds_the_caller_context_shape():
    """The governed wiring hands the pipeline the CallerContext's
    ``authorized_repos: tuple[AuthorizedRepo, ...]`` — the normalization to
    repo-id strings is the only line connecting that shape to the mechanical
    check (an AuthorizedRepo is unhashable, so a frozenset over the raw
    tuples would crash the check per request)."""
    from capabilities.contract import AuthorizedRepo

    pipeline, _ = _pipeline(
        judge_turns=(ModelTurn(content='{"verdict": "grounded"}'),),
        authorized_repos=(AuthorizedRepo(repo_id="r-1", graph_name="G"),),
    )
    pipeline.record_tool_result("search_knowledge", _search_payload([OKF_HIT]))
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_GROUNDED
    assert verdict.payload()["invalid_citations"] == []
    assert verdict.payload()["citations"][0]["provenance"]["concept_id"] == "c-1"


def test_a_mixed_ledger_ungrounds_mechanically_and_keeps_the_valid_entry():
    """A valid reference alongside one that fails the mechanical check: the
    answer is ``ungrounded`` BEFORE any judge runs (the invalid half of the
    decision), the valid entry still rides the delivered set, and the
    dropped one is recorded."""
    pipeline, monitor = _pipeline(judge_turns=(ModelTurn(content="never asked"),), authorized_repos=frozenset())
    pipeline.record_tool_result("search_knowledge", _search_payload([LEGACY_HIT, OKF_HIT]))
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_UNGROUNDED
    payload = verdict.payload()
    assert payload["judge"]["outcome"] == JUDGE_OUTCOME_SKIPPED
    assert monitor.aux_model_calls == 0
    assert payload["citations"] == [{"provenance": {"file_id": "f-1"}, "text": "the grievance passage", "score": 0.9}]
    assert payload["invalid_citations"] == [{"provenance": OKF_HIT["provenance"], "reason": "unauthorized_repo"}]


def test_a_wall_clock_spent_run_refuses_the_judge_before_it_claims_a_slot():
    """The wall-clock guard runs before the budget claim: a run whose clock
    is spent refuses the judge with nothing counted — removing the guard
    would let a judged call run past the deadline within its own timeout
    and still report a verdict."""
    monitor = RunBudgetMonitor(run_budget(wall_clock_seconds=0.001))
    time.sleep(0.01)  # the run's clock is spent before finalize
    judge_model = ScriptedLoopModel(())
    judge = GroundingJudge(model_client=judge_model, monitor=monitor, timeout_seconds=5.0)
    result = asyncio.run(judge.judge("the answer", [LEGACY_HIT]))

    assert result == {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
    assert (monitor.model_calls, monitor.aux_model_calls) == (0, 0)
    assert judge_model.requests == []


def test_the_pipeline_converts_the_judge_timeout_knob_to_seconds():
    """``AGENT_VERDICT_JUDGE_TIMEOUT_MS`` is milliseconds: a 1 ms bound
    returns the timeout outcome near-instantly against a judge that would
    hang forever. A ms/s unit confusion (the bound read as seconds — an
    effectively unbounded judge) never answers inside the test's own
    0.5 s wait_for and reddens the suite."""

    class _HangingJudgeModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            await asyncio.Event().wait()  # forever

    pipeline = VerificationPipeline(
        policy=POLICY_VERDICT_MARKED,
        judge_timeout_ms=1,
        judge_model_client=_HangingJudgeModel(),
        monitor=RunBudgetMonitor(run_budget()),
        authorized_repos=(),
        metadata_source=FakeMetadataSource(),
        concept_source=FakeConceptSource(),
    )
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)

    async def scenario():
        return await asyncio.wait_for(pipeline.finalize("the answer"), timeout=0.5)

    verdict = asyncio.run(scenario())

    assert verdict.status == VERDICT_UNVERIFIED
    assert verdict.payload()["judge"]["outcome"] == JUDGE_OUTCOME_TIMEOUT


def test_a_cancelled_judge_propagates_the_cancellation_never_a_verdict():
    """The documented contract: a cancelled run has no verdict — the
    CancelledError out of the judged call propagates untouched through
    finalize (a defensive catch that swallowed it would emit an unverified
    verdict AFTER the cancellation, and reddens here)."""

    class _CancellingJudgeModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            raise asyncio.CancelledError

    pipeline = VerificationPipeline(
        policy=POLICY_VERDICT_MARKED,
        judge_timeout_ms=5000,
        judge_model_client=_CancellingJudgeModel(),
        monitor=RunBudgetMonitor(run_budget()),
        authorized_repos=(),
        metadata_source=FakeMetadataSource(),
        concept_source=FakeConceptSource(),
    )
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(pipeline.finalize("the answer"))


def test_a_pipeline_defect_keeps_the_mechanical_decision_and_the_findings(monkeypatch):
    """The defensive catch must not bury the ledger's mechanical facts: over
    a degraded ledger with a recorded finding, an internal defect still
    yields the insufficiency decision and the finding — never a bare
    unverified verdict that would let a drafted answer ship unaudited."""
    from agent import verification as verification_module

    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content="never asked"),))
    pipeline.record_tool_result(
        "search_knowledge",
        {"result": {"outcome": "degraded_availability", "hits": [dict(LEGACY_HIT, text="t")], "truncated": False}},
    )
    pipeline.record_finding(
        {
            "tool": "search_knowledge",
            "markers": ["role_reassignment"],
            "source": "search_hit",
            "identity": [None, "f-1"],
        }
    )

    def _defect(entries, authorized_repos):
        raise RuntimeError("the validity check exploded")

    monkeypatch.setattr(verification_module, "check_reference_validity", _defect)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.status == VERDICT_UNVERIFIED  # degrades, never fabricates grounded
    assert verdict.insufficient_required is True
    assert verdict.insufficient_evidence["reasons"] == ["degraded_availability"]
    assert verdict.payload()["findings"] == [
        {
            "tool": "search_knowledge",
            "markers": ["role_reassignment"],
            "source": "search_hit",
            "identity": [None, "f-1"],
        }
    ]
