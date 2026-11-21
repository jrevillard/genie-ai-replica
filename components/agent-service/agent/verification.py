# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The citation verification pipeline — mechanical reference validity + judged
grounding, one tri-state verdict (AD-7).

Two checks, one pipeline, in a fixed order:

* **Reference validity — inline, mechanical, no LLM, always on.** An
  *emitted citation* is one provenance entry in the run's evidence ledger: a
  source whose structured identity and passage text were served to the model
  through a successful tool result in THIS run. The ledger is the only
  source of citations — nothing invented, nothing from an error envelope —
  and the per-citation check verifies each entry mechanically: the identity
  is well-formed and, when it carries a ``repo_id``, that repository is in
  the caller's authorized set. A failing entry is dropped from the delivered
  set and recorded; the verdict can then not be ``grounded``. No policy
  value disables this check.
* **Grounding — one budgeted judged call at finalize.** The judge reads the
  answer text plus the delivered citations' passages and returns a strict
  JSON verdict. It claims the shared model-call budget through the monitor
  (``take_aux_model_call``, tallied as auxiliary) and is hard-bounded by a
  required timeout knob. Absence, timeout, budget exhaustion and malformed
  output all yield ``unverified`` — never ``grounded``.

The mechanical outcome decides before the judge: no retrieval at all means
the answer is an insufficiency statement that claims nothing — ``unverified``
(the honest neutral, never the ungrounded warning); retrieval happened but
the delivered set is empty or carried invalid entries means claims without
support — ``ungrounded`` (FR-10: an unsupported assertion with valid
references still fails grounding). Otherwise the judge decides.

The verdict is tri-state ``grounded | ungrounded | unverified`` and its
payload is the projection contract the BFF maps onto the client frames: the
metadata frame's ``grounding_status`` and derived legacy ``is_grounded``
(true iff grounded), the recorded translation mode (``"none"`` at finalize —
the verdict certifies the SOURCE-language text it evaluated; the BFF
overwrites the mode when it delivers a translation), the delivered citation
set for ``source_documents``, the judge outcome, and the persisted marking
(``marking.required`` true iff policy is ``verdict-marked`` AND the status
is ``ungrounded`` — a failed verification is never silent, an incomplete one
is surfaced through the metadata tri-state without the correction marking).

Nothing here writes a client frame: the pipeline emits through the seam
vocabulary (the ``verdict`` kind), and the BFF owns every client frame —
the projection (client ``agent_verdict``, position pinned after the last
chunk and before ``metadata``) is the frame writer's (story 2.4), the
end-to-end wiring is the integration slice (story 2.5).
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field

from .budget import BudgetExhausted, RunBudgetMonitor

logger = logging.getLogger(__name__)

VERDICT_GROUNDED = "grounded"
VERDICT_UNGROUNDED = "ungrounded"
VERDICT_UNVERIFIED = "unverified"

POLICY_VERDICT_MARKED = "verdict-marked"
# Iteration 1 ships verdict-marked only (AD-7). The other enum members
# (verdict-silent, hold-until-verified) are named by the architecture but
# are NOT implemented: a deployment asking for one is refused at the config
# load, naming the knob — silently degrading to another policy would lie
# about what the deployment got. Changing policy = versioned additive SSE
# event + re-measured evaluation, never per-request switching.
IMPLEMENTED_POLICIES = frozenset({POLICY_VERDICT_MARKED})

VERDICT_POLICY_KNOB = "AGENT_VERDICT_POLICY"
JUDGE_TIMEOUT_KNOB = "AGENT_VERDICT_JUDGE_TIMEOUT_MS"

# The recorded translation mode at finalize: the verdict certifies the
# source-language text; no translation has been applied when it is emitted.
TRANSLATION_MODE_NONE = "none"

JUDGE_OUTCOME_COMPLETED = "completed"
JUDGE_OUTCOME_SKIPPED = "skipped"
JUDGE_OUTCOME_TIMEOUT = "timeout"
JUDGE_OUTCOME_BUDGET_EXHAUSTED = "budget_exhausted"
JUDGE_OUTCOME_ERROR = "error"

_JSON_OBJECT_RE = re.compile(r"\s*\{.*\}\s*", re.DOTALL)


def citation_identity(provenance: dict) -> tuple:
    """The stable identity key of one provenance dict — the no-agent
    dedup's convention: ``(repo_id, concept_id)`` for an OKF concept,
    ``(None, file_id)`` for a legacy file."""
    if provenance.get("source") == "okf-concept":
        return (provenance.get("repo_id"), provenance.get("concept_id"))
    return (None, provenance.get("file_id"))


class RetrievalLedger:
    """The run's evidence ledger — the record of what was actually served.

    The loop feeds every dispatched tool result here, success and error
    envelope alike. A successful ``search_knowledge`` contributes its hits
    (provenance + passage text); a successful ``read_source`` contributes
    the resolved source with its served content; an insufficiency outcome or
    an error envelope contributes NO citation — only the fact that
    retrieval was attempted. Dedup keeps the FIRST occurrence of an
    identity (the same convention the no-agent mapping uses).
    """

    def __init__(self) -> None:
        self._entries: list[dict] = []
        self._seen: set[tuple] = set()
        self._retrieval_attempted = False

    @property
    def retrieval_attempted(self) -> bool:
        """True when any search or read reached a result — success,
        insufficiency or error. An answer produced with no retrieval at all
        is an insufficiency statement, not an unsupported claim."""
        return self._retrieval_attempted

    @property
    def entries(self) -> list[dict]:
        """The ledger's citation candidates, in first-served order:
        ``{"provenance": {...}, "text": str, "score": float | None}``."""
        return list(self._entries)

    def record(self, name: str, payload: dict) -> None:
        """Record one dispatched tool result: its citations, or its failure.

        ``payload`` is the loop's result envelope — ``{"result": {...}}`` on
        success, ``{"error": {...}}`` when the declared error surface fired.
        Both shapes are recorded; only the success shapes contribute
        citation candidates.
        """
        if name in ("search_knowledge", "read_source"):
            self._retrieval_attempted = True
        result = payload.get("result")
        if not isinstance(result, dict):
            return  # an error envelope: attempted, cites nothing
        if name == "search_knowledge":
            for hit in result.get("hits") or []:
                self._add_hit(hit)
        elif name == "read_source":
            provenance = result.get("provenance")
            content = result.get("content")
            if isinstance(provenance, dict) and isinstance(content, str) and content.strip():
                self._add({"provenance": provenance, "text": content, "score": None})

    def _add_hit(self, hit: dict) -> None:
        provenance = hit.get("provenance")
        text = hit.get("text")
        if not isinstance(provenance, dict) or not isinstance(text, str) or not text.strip():
            return
        score = hit.get("score") if isinstance(hit.get("score"), (int, float)) else None
        self._add({"provenance": provenance, "text": text, "score": score})

    def _add(self, entry: dict) -> None:
        identity = citation_identity(entry["provenance"])
        if identity in self._seen:
            return
        self._seen.add(identity)
        self._entries.append(entry)


@dataclass(frozen=True)
class ReferenceValidity:
    """The outcome of the mechanical, per-citation reference-validity check
    (AD-7): the delivered set — the entries that resolve — plus every
    dropped entry with its reason. No LLM, always on, cannot be disabled by
    policy."""

    delivered: tuple[dict, ...]
    invalid: tuple[dict, ...]  # {"provenance": {...}, "reason": str}


def check_reference_validity(entries: list[dict], authorized_repos: frozenset[str]) -> ReferenceValidity:
    """The mechanical, per-citation check over the ledger's candidates.

    An entry fails when it carries a ``repo_id`` outside the caller's
    authorized repositories (``unauthorized_repo``). Defense in depth: the
    executor already filters at dispatch; the check makes the invariant
    enforced on every emitted citation instead of assumed — a failing entry
    is dropped from the delivered set and recorded, and the verdict can
    then not be ``grounded``.
    """
    delivered: list[dict] = []
    invalid: list[dict] = []
    for entry in entries:
        provenance = entry["provenance"]
        repo_id = provenance.get("repo_id")
        if provenance.get("source") == "okf-concept" and repo_id not in authorized_repos:
            invalid.append({"provenance": provenance, "reason": "unauthorized_repo"})
            continue
        delivered.append(entry)
    return ReferenceValidity(delivered=tuple(delivered), invalid=tuple(invalid))


@dataclass
class GroundingJudge:
    """One budgeted judged grounding call at finalize (AD-7).

    The judge reuses the run's model client — the same endpoint, counted by
    the monitor as an AUXILIARY call (the shared fleet model-call budget,
    aux tallied separately) — and is bounded by the run's remaining output
    allowance plus a hard timeout. Every failure mode degrades to
    ``unverified``: timeout, budget exhaustion, malformed output, an
    exception — the judge never upgrades its own failure into ``grounded``.
    """

    model_client: object  # a LoopModelClient — the run's model client
    monitor: RunBudgetMonitor
    timeout_seconds: float

    async def judge(self, answer_text: str, citations: list[dict]) -> dict:
        """Run the judged check; return the judge's payload fragment
        ``{"ran": bool, "outcome": str, "verdict": str | None}``."""
        try:
            self.monitor.check_wall_clock()
            self.monitor.take_aux_model_call()
        except BudgetExhausted as spent:
            logger.info("grounding judge skipped: %s", spent)
            return {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
        bound = self.monitor.remaining_output_tokens()
        if bound is not None and bound <= 0:
            return {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
        messages = judge_messages(answer_text, citations)
        try:
            turn = await asyncio.wait_for(
                self.model_client.complete(messages, (), max_output_tokens=bound),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            logger.info("grounding judge timed out after %.3fs", self.timeout_seconds)
            return {"ran": True, "outcome": JUDGE_OUTCOME_TIMEOUT, "verdict": None}
        except BudgetExhausted as spent:  # the bound raced the budget mid-call accounting
            logger.info("grounding judge refused: %s", spent)
            return {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
        verdict = parse_judge_verdict(turn.content)
        if verdict is None:
            return {"ran": True, "outcome": JUDGE_OUTCOME_ERROR, "verdict": None}
        self.monitor.record_usage(turn.prompt_tokens, turn.completion_tokens)
        return {"ran": True, "outcome": JUDGE_OUTCOME_COMPLETED, "verdict": verdict}


def judge_messages(answer_text: str, citations: list[dict]) -> list[dict]:
    """The judge's message list: a system message with the strict JSON
    contract, a user message carrying the answer and its cited passages.

    The JSON contract rides the prompt (the ``LoopModelClient`` protocol
    carries no ``response_format``); a non-conforming answer is a judge
    error, and an error is ``unverified`` — never parse-guessed into
    ``grounded``.
    """
    passages = "\n\n".join(
        f"[{index}] {entry['text']}" for index, entry in enumerate(citations, start=1)
    )
    system = (
        "You are an answer-grounding judge. You receive an assistant answer and the passages "
        "its citations resolve to. Decide whether every factual assertion of the answer is "
        "supported by those passages. Answer with ONLY a JSON object: "
        '{"verdict": "grounded"} when every assertion is supported by the passages, '
        '{"verdict": "ungrounded"} when any assertion is unsupported or contradicted. '
        "No other keys, no prose."
    )
    user = f"ANSWER:\n{answer_text}\n\nCITED PASSAGES:\n{passages if passages.strip() else '(none)'}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def parse_judge_verdict(content: object) -> str | None:
    """Extract the judge's verdict from its reply — strictly.

    Accepts only a JSON object of exactly one key whose ``verdict`` is
    exactly ``grounded`` or ``ungrounded``; anything else (prose, fenced
    JSON, extra keys, unknown values) is ``None`` — a judge error, and an
    error is ``unverified``.
    """
    if not isinstance(content, str) or not content.strip():
        return None
    match = _JSON_OBJECT_RE.fullmatch(content.strip())
    if match is None:
        return None
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict) or set(parsed) != {"verdict"}:
        return None
    verdict = parsed.get("verdict")
    if verdict in (VERDICT_GROUNDED, VERDICT_UNGROUNDED):
        return verdict
    return None


@dataclass
class Verdict:
    """The tri-state verdict and its projection payload.

    ``status`` is the single source of truth: ``is_grounded`` is DERIVED
    (true iff ``grounded`` — the legacy boolean rides the metadata frame for
    the clients that predate the tri-state), ``marking.required`` is derived
    from the policy and the status, and the payload dict is what the BFF
    projects — verbatim onto the metadata fields, the citation set onto
    ``source_documents``.
    """

    status: str  # VERDICT_GROUNDED | VERDICT_UNGROUNDED | VERDICT_UNVERIFIED
    policy: str
    judge: dict
    delivered_citations: list[dict] = field(default_factory=list)
    invalid_citations: list[dict] = field(default_factory=list)

    @property
    def is_grounded(self) -> bool:
        return self.status == VERDICT_GROUNDED

    @property
    def marking_required(self) -> bool:
        return self.policy == POLICY_VERDICT_MARKED and self.status == VERDICT_UNGROUNDED

    def payload(self) -> dict:
        """The projection contract — one dict the BFF reads verbatim."""
        return {
            "grounding_status": self.status,
            "is_grounded": self.is_grounded,
            "translation_mode": TRANSLATION_MODE_NONE,
            "policy": self.policy,
            "judge": dict(self.judge),
            "citations": list(self.delivered_citations),
            "invalid_citations": list(self.invalid_citations),
            "marking": {"required": self.marking_required, "reason": self.status if self.marking_required else None},
        }


class VerificationPipeline:
    """The per-run pipeline: ledger → mechanical validity → judged grounding.

    Built per run by the request orchestrator (it owns the monitor and the
    model client the judge reuses); the loop feeds it every dispatched tool
    result and calls :meth:`finalize` once, at finalize, with the drafted
    answer text. The pipeline is total: ``finalize`` never raises (a
    ``CancelledError`` from the judge's in-flight call propagates — a
    cancelled run has no verdict), every other failure degrades to
    ``unverified``.
    """

    def __init__(
        self,
        *,
        policy: str,
        judge_timeout_ms: int,
        judge_model_client: object,
        monitor: RunBudgetMonitor,
        authorized_repos: tuple,
    ) -> None:
        self.policy = policy
        self.ledger = RetrievalLedger()
        self._authorized_repos = frozenset(repo.repo_id for repo in authorized_repos)
        self._judge = GroundingJudge(
            model_client=judge_model_client,
            monitor=monitor,
            timeout_seconds=judge_timeout_ms / 1000,
        )

    def record_tool_result(self, name: str, payload: dict) -> None:
        """Feed one dispatched tool result into the ledger (every result —
        the ledger classifies successes and error envelopes itself)."""
        self.ledger.record(name, payload)

    async def finalize(self, answer_text: str) -> Verdict:
        """Verify the drafted answer; return the tri-state verdict.

        The mechanical check decides first (no retrieval → ``unverified``,
        nothing validly citable → ``ungrounded``, judge skipped); otherwise
        the judge runs and its verdict — or its failure, which is
        ``unverified`` — decides. A defensive catch converts an unexpected
        pipeline defect into ``unverified`` too: verification can fail, it
        can never fabricate ``grounded``.
        """
        try:
            return await self._finalize(answer_text)
        except asyncio.CancelledError:
            raise
        except Exception as failed:  # noqa: BLE001 — verification degrades, never fabricates
            logger.warning("verification pipeline failed; verdict unverified: %s: %s", type(failed).__name__, failed)
            return Verdict(
                status=VERDICT_UNVERIFIED,
                policy=self.policy,
                judge={"ran": False, "outcome": JUDGE_OUTCOME_ERROR, "verdict": None},
            )

    async def _finalize(self, answer_text: str) -> Verdict:
        if not self.ledger.retrieval_attempted:
            # An answer produced with no retrieval at all is an
            # insufficiency statement: it claims nothing, so there is
            # nothing to ground and nothing to mark.
            return Verdict(
                status=VERDICT_UNVERIFIED,
                policy=self.policy,
                judge={"ran": False, "outcome": JUDGE_OUTCOME_SKIPPED, "verdict": None},
            )
        validity = check_reference_validity(self.ledger.entries, self._authorized_repos)
        if not validity.delivered or validity.invalid:
            # Claims without support (nothing citable survived) or an
            # emitted citation that failed the mechanical check: FR-10 —
            # not grounded, mechanically, before any judge runs.
            return Verdict(
                status=VERDICT_UNGROUNDED,
                policy=self.policy,
                judge={"ran": False, "outcome": JUDGE_OUTCOME_SKIPPED, "verdict": None},
                delivered_citations=[dict(entry) for entry in validity.delivered],
                invalid_citations=[dict(entry) for entry in validity.invalid],
            )
        judge_result = await self._judge.judge(answer_text, [dict(entry) for entry in validity.delivered])
        if judge_result["outcome"] != JUDGE_OUTCOME_COMPLETED:
            return Verdict(
                status=VERDICT_UNVERIFIED,
                policy=self.policy,
                judge=judge_result,
                delivered_citations=[dict(entry) for entry in validity.delivered],
            )
        return Verdict(
            status=judge_result["verdict"],
            policy=self.policy,
            judge=judge_result,
            delivered_citations=[dict(entry) for entry in validity.delivered],
        )
