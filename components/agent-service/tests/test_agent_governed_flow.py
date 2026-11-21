# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The governed answer path's mechanical decision, end to end on the loop.

Mutation-sensitive pins: a run whose ledger holds no successful retrieval
delivers the STANDARD insufficiency message (the model's drafted text is
discarded — it never rides the stream); a run with ANY degraded retrieval
delivers the same response with the degradation reason, even when valid
citations exist and the scripted judge would call it grounded (FR-12:
degraded beats grounded); retrieval that happened but yielded no valid
citation stays the ungrounded path (claims without support, marked) — NOT
an insufficiency; the verdict lands after the last text event and before
the terminal in every case, and the event order on the seam is unchanged.
"""

import asyncio

from conftest import (
    AgentFakePort,
    ScriptedLoopModel,
    canned_read_result,
    canned_search_result,
    multihop_turns,
    run_budget,
)

from agent.budget import RunBudgetMonitor
from agent.cancellation import CancellationToken
from agent.events import EventEmitter
from agent.loop import OUTCOME_ANSWERED, AgentLoop, ModelTurn
from agent.probe import PROBE_OPERATION_BUDGET
from agent.toolset import document_toolset
from agent.verification import (
    INSUFFICIENCY_RESPONSE,
    REASON_DEGRADED_RETRIEVAL,
    REASON_NO_SUCCESSFUL_RETRIEVAL,
    VERDICT_UNGROUNDED,
    VERDICT_UNVERIFIED,
    VerificationPipeline,
)
from capabilities.contract import (
    AuthorizedRepo,
    CallerContext,
    LegacyFileProvenance,
    OkfConceptProvenance,
    OutcomeCode,
    QueryPreparationStatus,
    ReadSourceResult,
    SearchHit,
    SearchKnowledgeResult,
)

CONTEXT = CallerContext(user_id="u-1", authorized_graph_names=("GRAPH",))

HOSTILE_DRAFT = "The complaint process definitely takes exactly seven days."


def _insufficient_read():
    """A read that resolved nothing — the scripted read call answers the
    contract's own insufficiency (no success recorded, nothing cited)."""
    return ReadSourceResult(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE)


def _governed_loop(model, port, judge_reply='{"verdict": "grounded"}'):
    collector: list = []
    monitor = RunBudgetMonitor(run_budget())
    verifier = VerificationPipeline(
        policy="verdict-marked",
        judge_timeout_ms=5000,
        judge_model_client=ScriptedLoopModel((ModelTurn(content=judge_reply),)),
        monitor=monitor,
        authorized_repos=(AuthorizedRepo(repo_id="r-1", graph_name="G"),),
    )
    loop = AgentLoop(
        model=model,
        registry=document_toolset(port, CONTEXT, PROBE_OPERATION_BUDGET),
        monitor=monitor,
        token=CancellationToken(),
        emitter=EventEmitter(run_id="run-1", sink=collector.append),
        system_prompt="the production prompt",
        verifier=verifier,
    )
    return loop, collector, monitor


def _script(answer=HOSTILE_DRAFT):
    # The loop model's script: search → read → final answer. The judge is a
    # SEPARATE script (the verifier's own model client).
    return ScriptedLoopModel(multihop_turns(answer=answer))


def _kinds(collector):
    return [event.kind.value for event in collector]


def _verdict_payload(collector):
    return next(event.payload for event in collector if event.kind.value == "verdict")


# ---------------------------------------------------------------------
# No successful retrieval → the standard insufficiency response
# ---------------------------------------------------------------------


def test_no_retrieval_run_delivers_the_standard_message_not_the_draft():
    port = AgentFakePort(
        search_result=canned_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()),
        read_result=_insufficient_read(),
    )
    loop, collector, _ = _governed_loop(_script(), port)

    result = asyncio.run(loop.run("How are complaints handled?"))

    assert result.outcome == OUTCOME_ANSWERED
    # The drafted text is discarded: the delivered answer IS the standard
    # explicit insufficiency message.
    assert result.final_text == INSUFFICIENCY_RESPONSE
    content = [event.payload["text"] for event in collector if event.kind.value == "text_message_content"]
    assert content == [INSUFFICIENCY_RESPONSE]
    assert HOSTILE_DRAFT not in [event.payload.get("text", "") for event in collector]
    verdict = _verdict_payload(collector)
    assert verdict["grounding_status"] == VERDICT_UNVERIFIED
    assert verdict["insufficient_evidence"] == {
        "required": True,
        "reasons": [REASON_NO_SUCCESSFUL_RETRIEVAL],
    }
    assert verdict["judge"] == {"ran": False, "outcome": "skipped", "verdict": None}
    # Insufficiency is a successful answer type: unverified, never marked.
    assert verdict["marking"] == {"required": False, "reason": None}


def test_every_search_insufficient_and_errors_yields_the_no_retrieval_reason():
    port = AgentFakePort(
        search_result=canned_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()),
        read_result=_insufficient_read(),
    )
    loop, collector, _ = _governed_loop(_script(answer="I found everything you need."), port)

    result = asyncio.run(loop.run("q"))

    assert result.final_text == INSUFFICIENCY_RESPONSE
    assert _verdict_payload(collector)["insufficient_evidence"]["reasons"] == [REASON_NO_SUCCESSFUL_RETRIEVAL]


# ---------------------------------------------------------------------
# Degraded retrieval → insufficiency, even with citations and a grounded judge
# ---------------------------------------------------------------------


def _degraded_search():
    return SearchKnowledgeResult(
        outcome=OutcomeCode.DEGRADED_AVAILABILITY,
        hits=(SearchHit(provenance=LegacyFileProvenance(file_id="f-1"), text="the passage", score=0.9),),
        query_preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH,
    )


def test_a_degraded_run_reports_insufficiency_with_citations_carried_for_diagnostics():
    port = AgentFakePort(search_result=_degraded_search(), read_result=_insufficient_read())
    loop, collector, _ = _governed_loop(_script(), port)

    result = asyncio.run(loop.run("How are complaints handled?"))

    assert result.outcome == OUTCOME_ANSWERED
    # Never a confident answer, citations notwithstanding.
    assert result.final_text == INSUFFICIENCY_RESPONSE
    verdict = _verdict_payload(collector)
    assert verdict["insufficient_evidence"]["required"] is True
    # The degraded search's citations GREW the ledger, so the degradation
    # reason alone carries the decision (the no-success reason names a fact
    # that no longer holds).
    assert verdict["insufficient_evidence"]["reasons"] == [REASON_DEGRADED_RETRIEVAL]
    assert verdict["grounding_status"] == VERDICT_UNVERIFIED
    # The judge never ran (the answer it would evaluate is not delivered).
    assert verdict["judge"]["outcome"] == "skipped"
    # The valid citations ride for diagnostics, projected onto the
    # frontend envelope.
    assert verdict["citations"][0]["provenance"] == {"file_id": "f-1"}
    assert verdict["source_documents"][0]["document_id"] == "f-1"
    assert verdict["marking"] == {"required": False, "reason": None}


def test_the_ledger_reads_the_degraded_outcome_from_the_wire_shape():
    # The ledger classifies the RESULT envelope the executor serves (the
    # dumped model dict), not the pydantic type: the outcome string is what
    # counts. A dumped degraded result is exactly what the tool returns.
    payload = {
        "result": {
            "outcome": "degraded_availability",
            "hits": [{"provenance": {"file_id": "f-1"}, "text": "t", "score": 0.9}],
            "truncated": False,
        }
    }
    verifier = VerificationPipeline(
        policy="verdict-marked",
        judge_timeout_ms=5000,
        judge_model_client=ScriptedLoopModel(()),
        monitor=RunBudgetMonitor(run_budget()),
        authorized_repos=(),
    )
    verifier.record_tool_result("search_knowledge", payload)

    verdict = asyncio.run(verifier.finalize("the answer"))

    assert verdict.insufficient_required is True
    # The degraded result's hits grew the ledger: the degradation reason
    # alone carries the decision.
    assert verdict.insufficient_evidence["reasons"] == [REASON_DEGRADED_RETRIEVAL]


# ---------------------------------------------------------------------
# Successful-but-invalid retrieval stays the ungrounded path
# ---------------------------------------------------------------------


def test_retrieval_that_yielded_no_valid_citation_stays_ungrounded_never_insufficient():
    # A successful search served an OKF concept from a repo OUTSIDE the
    # authorized set: retrieval happened, nothing valid survived.
    port = AgentFakePort(
        search_result=SearchKnowledgeResult(
            outcome=OutcomeCode.SUCCESS,
            hits=(
                SearchHit(
                    provenance=OkfConceptProvenance(concept_id="c-9", repo_id="other-repo", bundle_version=1),
                    text="t",
                    score=0.9,
                ),
            ),
            query_preparation_status=QueryPreparationStatus.PASSTHROUGH_ENGLISH,
        ),
        read_result=_insufficient_read(),
    )
    loop, collector, _ = _governed_loop(_script(), port)

    result = asyncio.run(loop.run("q"))

    # NOT the insufficiency response: the drafted claim ships and is MARKED.
    assert result.final_text == HOSTILE_DRAFT
    verdict = _verdict_payload(collector)
    assert verdict["grounding_status"] == VERDICT_UNGROUNDED
    assert verdict["insufficient_evidence"] == {"required": False, "reasons": []}
    assert verdict["marking"] == {"required": True, "reason": VERDICT_UNGROUNDED}


def test_a_successful_run_delivers_the_draft_with_no_insufficiency():
    port = AgentFakePort(search_result=canned_search_result(), read_result=canned_read_result())
    loop, collector, _ = _governed_loop(_script(answer="The grievance process takes thirty days."), port)

    result = asyncio.run(loop.run("How are complaints handled?"))

    assert result.final_text == "The grievance process takes thirty days."
    verdict = _verdict_payload(collector)
    assert verdict["insufficient_evidence"] == {"required": False, "reasons": []}
    assert verdict["grounding_status"] == "grounded"


# ---------------------------------------------------------------------
# The seam order is unchanged in every case
# ---------------------------------------------------------------------


def test_the_event_order_is_unchanged_on_the_insufficiency_path():
    port = AgentFakePort(
        search_result=canned_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()),
        read_result=_insufficient_read(),
    )
    loop, collector, _ = _governed_loop(_script(), port)
    asyncio.run(loop.run("q"))
    kinds = _kinds(collector)
    assert kinds == [
        "run_started",
        "tool_call_started",
        "tool_call_finished",
        "tool_call_started",
        "tool_call_finished",
        "text_message_started",
        "text_message_content",
        "text_message_finished",
        "verdict",
        "run_finished",
    ]
    assert kinds[kinds.index("verdict") - 1] == "text_message_finished"
    assert kinds[kinds.index("verdict") + 1] == "run_finished"


def test_the_insufficiency_decision_never_waits_for_the_judge():
    """The cheap mechanical decision runs BEFORE the text events: on an
    insufficiency ledger a judge that would hang forever cannot delay the
    first chunk — and the finalize that follows skips the judge anyway (the
    decision it recomputes is required), so the run completes."""

    class HangingJudgeModel:
        async def complete(self, messages, tool_definitions, *, max_output_tokens):
            await asyncio.Event().wait()  # forever

    port = AgentFakePort(
        search_result=canned_search_result(outcome=OutcomeCode.INSUFFICIENT_EVIDENCE, hits=()),
        read_result=_insufficient_read(),
    )
    collector: list = []
    monitor = RunBudgetMonitor(run_budget())
    verifier = VerificationPipeline(
        policy="verdict-marked",
        judge_timeout_ms=5000,
        judge_model_client=HangingJudgeModel(),
        monitor=monitor,
        authorized_repos=(AuthorizedRepo(repo_id="r-1", graph_name="G"),),
    )
    loop = AgentLoop(
        model=_script(),
        registry=document_toolset(port, CONTEXT, PROBE_OPERATION_BUDGET),
        monitor=monitor,
        token=CancellationToken(),
        emitter=EventEmitter(run_id="run-1", sink=collector.append),
        system_prompt="the production prompt",
        verifier=verifier,
    )

    result = asyncio.run(asyncio.wait_for(loop.run("q"), timeout=5))

    assert result.final_text == INSUFFICIENCY_RESPONSE
    verdict = _verdict_payload(collector)
    assert verdict["judge"] == {"ran": False, "outcome": "skipped", "verdict": None}
    assert verdict["insufficient_evidence"]["required"] is True


def test_the_standard_message_is_a_module_level_constant_in_the_decision_site():
    # Single source: the loop imports the message the pipeline's decision
    # site owns — a second text would drift from the verdict's contract.
    import agent.loop as loop_module
    import agent.verification as verification_module

    assert loop_module.INSUFFICIENCY_RESPONSE is verification_module.INSUFFICIENCY_RESPONSE
    assert INSUFFICIENCY_RESPONSE.strip()
