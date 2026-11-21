# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The citation verification pipeline (AD-7): the ledger, the mechanical
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
import json

from conftest import ScriptedLoopModel, run_budget

from agent.budget import RunBudgetMonitor
from agent.loop import ModelTurn
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


# ---------------------------------------------------------------------
# The pipeline: the mechanical outcome decides before the judge
# ---------------------------------------------------------------------


def _pipeline(monitor=None, judge_turns=(), authorized_repos=()):
    monitor = monitor if monitor is not None else RunBudgetMonitor(run_budget())
    pipeline = VerificationPipeline(
        policy=POLICY_VERDICT_MARKED,
        judge_timeout_ms=5000,
        judge_model_client=ScriptedLoopModel(judge_turns),
        monitor=monitor,
        authorized_repos=authorized_repos,
    )
    return pipeline, monitor


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
        "marking",
    }


def test_the_marking_follows_the_policy_and_the_status():
    pipeline, _ = _pipeline(judge_turns=(ModelTurn(content='{"verdict": "ungrounded"}'),))
    pipeline.record_tool_result("search_knowledge", SEARCH_SUCCESS)
    verdict = asyncio.run(pipeline.finalize("the answer"))

    assert verdict.marking_required is True  # verdict-marked AND ungrounded
    assert verdict.payload()["marking"] == {"required": True, "reason": VERDICT_UNGROUNDED}


# ---------------------------------------------------------------------
# Guard pins: the tri-state vocabulary and the strict parser's edges
# ---------------------------------------------------------------------


def test_the_tri_state_vocabulary_is_exactly_the_three_values():
    from agent import verification

    assert {verification.VERDICT_GROUNDED, verification.VERDICT_UNGROUNDED, verification.VERDICT_UNVERIFIED} == {
        "grounded",
        "ungrounded",
        "unverified",
    }


def test_json_content_types_are_tolerated_as_proper_json():
    # A hit whose score the model_dump carried as a JSON number parses back
    # through the ledger untouched.
    ledger = RetrievalLedger()
    payload = json.loads(json.dumps(_search_payload([LEGACY_HIT])))
    ledger.record("search_knowledge", payload)
    assert ledger.entries[0]["score"] == 0.9
