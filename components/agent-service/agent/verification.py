# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The citation verification pipeline — mechanical reference validity + judged
grounding, one tri-state verdict.

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

* **Insufficiency and degradation — mechanical, decided before the judge.**
  The ledger also records what kind of retrieval actually ran: a SUCCESS
  outcome (successful retrieval), a ``degraded_availability`` outcome (the
  capability ran degraded — partial availability, a fallback strategy), an
  insufficiency outcome, an error envelope, or an unprepared-query answer.
  When NO successful retrieval is recorded, or ANY retrieval ran degraded,
  the response is an insufficiency response: the loop replaces the
  drafted answer text with :data:`INSUFFICIENCY_RESPONSE` and the verdict
  carries ``insufficient_evidence: {required: true, reasons: [...]}`` —
  decided by the ledger's state at finalize, never by the model's own
  claim. A degraded run cannot deliver a confident answer even with valid
  citations and a ``grounded`` judge: the mechanical decision precedes the
  judge, whose outcome is skipped, and the citations ride the payload for
  diagnostics. Retrieval that succeeded but yielded no valid citation is
  NOT an insufficiency — it stays the ``ungrounded`` claims-without-support
  path below.

* **Injection findings.** The ledger also records the taint scan's
  findings (:mod:`agent.taint` — an instruction pattern in retrieved
  content is an attempt, recorded, with the content still passing as
  data); the verdict payload projects them under ``findings``.

The mechanical outcome decides before the judge: when NO citable evidence
reached the model — an insufficiency outcome, an error envelope, a malformed
result, an empty ledger — the answer claims nothing supported, so it is
``unverified`` (the honest neutral, never the ungrounded warning); when
citable evidence existed but none of it survived the validity check (or
entries were dropped as unauthorized) the answer is claims without support
— ``ungrounded`` (an unsupported assertion with valid references still
fails grounding). Otherwise the judge decides.

The verdict is tri-state ``grounded | ungrounded | unverified`` and its
payload is the projection contract the BFF maps onto the client frames: the
metadata frame's ``grounding_status`` and derived legacy ``is_grounded``
(true iff grounded), the recorded translation mode (``"none"`` at finalize —
the verdict certifies the SOURCE-language text it evaluated; the BFF
overwrites the mode when it delivers a translation), the delivered citation
set for ``source_documents`` (projected onto the frontend envelope by
:func:`capabilities.citations.source_documents_from_citations`), the judge
outcome, the recorded injection findings, the insufficiency decision, and
the persisted marking (``marking.required`` true iff policy is
``verdict-marked`` AND the status is ``ungrounded`` — a failed verification
is never silent, an incomplete one is surfaced through the metadata
tri-state without the correction marking).

Nothing here writes a client frame: the pipeline emits through the seam
vocabulary (the ``verdict`` kind), and the BFF owns every client frame —
the projection (client ``agent_verdict``, position pinned after the last
chunk and before ``metadata``) is the frame writer's, the end-to-end
wiring is the integration slice's.
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field

import tracing
from capabilities.citations import (
    SourceRecords,
    is_concept_provenance,
    provenance_identity,
    resolve_source_records,
    source_documents_from_citations,
)

from .budget import BudgetExhausted, RunBudgetMonitor

logger = logging.getLogger(__name__)

VERDICT_GROUNDED = "grounded"
VERDICT_UNGROUNDED = "ungrounded"
VERDICT_UNVERIFIED = "unverified"

POLICY_VERDICT_MARKED = "verdict-marked"
# The deployment ships verdict-marked only. The other enum members
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

# The standard explicit insufficiency response: the delivered
# answer when the ledger's state at finalize requires insufficiency — the
# model's drafted text is discarded and replaced by this constant. The
# message is the source-language (English) text; display-language
# translation is the BFF leg's job on the same terms as any answer. SINGLE
# SOURCE: the decision site owns the message, the loop imports it.
INSUFFICIENCY_RESPONSE = "I could not find supporting evidence in the knowledge base to answer this question."

# The mechanical insufficiency reasons, derived from the ledger's recorded
# retrieval outcomes — never from the model's claim. The degraded reason is
# the capability's own outcome code (the capability layer's degradation
# signal); the no-retrieval reason is the ledger's honest statement that no
# search or read ever succeeded.
REASON_DEGRADED_RETRIEVAL = "degraded_availability"
REASON_NO_SUCCESSFUL_RETRIEVAL = "no_successful_retrieval"


class RetrievalLedger:
    """The run's evidence ledger — the record of what was actually served.

    The loop feeds every dispatched tool result here, success and error
    envelope alike. A successful ``search_knowledge`` contributes its hits
    (provenance + passage text); a successful ``read_source`` contributes
    the resolved source with its served content; an insufficiency outcome,
    an error envelope or a malformed result contributes NO citation — the
    ledger's ``entries`` stay empty, which is what makes the answer an
    insufficiency statement to the pipeline (nothing citable was served,
    so nothing was claimed and nothing can be marked). Dedup keeps the
    FIRST occurrence of an identity (the same convention the no-agent
    mapping uses).

    The ledger also records what KIND of retrieval ran, which is what the
    finalize insufficiency decision reads mechanically:

    * ``successful_retrievals`` — the dispatches that actually grew the
      citable entries (a success whose hits were all duplicates, or whose
      content was blank, contributed nothing and counts as none);
    * ``degradation_count`` — the dispatches whose result reported
      ``degraded_availability`` (partial availability, a fallback
      strategy): any one of them makes the response an insufficiency
      response, never a confident answer, citations notwithstanding;
    * ``findings`` — the taint scan's injection attempts
      (:mod:`agent.taint`), recorded, content untouched.
    """

    def __init__(self) -> None:
        self._entries: list[dict] = []
        self._seen: set[tuple] = set()
        self._successful_retrievals = 0
        self._degradation_count = 0
        self._findings: list[dict] = []

    @property
    def entries(self) -> list[dict]:
        """The ledger's citation candidates, in first-served order:
        ``{"provenance": {...}, "text": str, "score": float | None}``."""
        return list(self._entries)

    @property
    def successful_retrievals(self) -> int:
        """How many dispatches actually grew the citable entries."""
        return self._successful_retrievals

    @property
    def degradation_count(self) -> int:
        """How many dispatches reported ``degraded_availability``."""
        return self._degradation_count

    @property
    def findings(self) -> list[dict]:
        """The recorded injection attempts (the taint scan's findings)."""
        return list(self._findings)

    def record(self, name: str, payload: dict) -> None:
        """Record one dispatched tool result: its citations, or its failure.

        ``payload`` is the loop's result envelope — ``{"result": {...}}`` on
        success, ``{"error": {...}}`` when the declared error surface fired.
        Both shapes are recorded; only the retrieved texts contribute
        citation candidates (blank text cites nothing). A dispatch counts as
        a SUCCESSFUL retrieval only when it actually GREW the citable
        entries: a success that contributed nothing citable (a read whose
        content is blank, hits that are all duplicates) is retrieval that
        yielded nothing — the insufficiency decision must not mistake it for
        served evidence. ``degraded_availability`` records a degradation
        (the retrieved content still cites — a degraded result may carry
        hits).
        """
        result = payload.get("result")
        before = len(self._entries)
        for text, provenance, score in retrieved_texts(name, payload):
            if text.strip():
                self._add({"provenance": provenance, "text": text, "score": score})
        if isinstance(result, dict) and result.get("outcome") == "degraded_availability":
            self._degradation_count += 1
        if len(self._entries) > before:
            self._successful_retrievals += 1

    def record_finding(self, finding: dict) -> None:
        """Record one injection attempt (the taint scan's structured finding)."""
        self._findings.append(dict(finding))

    def _add(self, entry: dict) -> None:
        identity = provenance_identity(entry["provenance"])
        if identity in self._seen:
            return
        self._seen.add(identity)
        self._entries.append(entry)


def _hit_triples(result: dict) -> list[tuple[str, dict, float | None]]:
    """The ``(text, provenance, score)`` triples of one hits-shaped result —
    the shape BOTH retrieval sources serve (the document search's hits and
    the web search's hits): a hit without a provenance dict or with a
    non-string text contributes nothing."""
    triples = []
    for hit in result.get("hits") or []:
        provenance = hit.get("provenance") if isinstance(hit, dict) else None
        text = hit.get("text") if isinstance(hit, dict) else None
        if isinstance(provenance, dict) and isinstance(text, str):
            score = hit.get("score") if isinstance(hit.get("score"), (int, float)) else None
            triples.append((text, provenance, score))
    return triples


def retrieved_texts(name: str, payload: dict) -> list[tuple[str, dict, float | None]]:
    """The retrieved-content channel of one dispatched tool result: the
    ``(text, provenance, score)`` triples its served texts carry.

    The ONE extraction both readers share (the ledger's citation
    candidates, the taint scan's scan surface): the ``search_knowledge``
    hits' passage texts and the ``read_source`` resolved content. An error
    envelope, a malformed result, an unregistered tool name, a hit without
    a provenance dict, or a non-string text contributes nothing — the
    channel carries only what the capability actually served as text.
    """
    result = payload.get("result")
    if not isinstance(result, dict):
        return []
    if name == "search_knowledge":
        return _hit_triples(result)
    if name == "web_search":
        # The web results enter the SAME channel: the ledger's citation
        # candidates AND the taint scan's surface — one extraction, two
        # readers (the design's §4.5 identity: the ledger and the scan do
        # not drift).
        return _hit_triples(result)
    if name == "read_source":
        provenance = result.get("provenance")
        content = result.get("content")
        if isinstance(provenance, dict) and isinstance(content, str):
            return [(content, provenance, None)]
        return []
    return []


@dataclass(frozen=True)
class ReferenceValidity:
    """The outcome of the mechanical, per-citation reference-validity check:
    the delivered set — the entries that resolve — plus every dropped
    entry with its reason. No LLM, always on, cannot be disabled by
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
        if is_concept_provenance(provenance) and repo_id not in authorized_repos:
            invalid.append({"provenance": provenance, "reason": "unauthorized_repo"})
            continue
        delivered.append(entry)
    return ReferenceValidity(delivered=tuple(delivered), invalid=tuple(invalid))


@dataclass
class GroundingJudge:
    """One budgeted judged grounding call at finalize.

    The judge reuses the run's model client — the same endpoint, counted by
    the monitor as an AUXILIARY call (the shared fleet model-call budget,
    aux tallied separately) — and is bounded by the run's remaining output
    allowance plus a hard timeout. Every failure mode degrades to
    ``unverified``: timeout, budget exhaustion, malformed output, an
    exception — the judge never upgrades its own failure into ``grounded``.
    A timed-out call's server-side spend is unreportable by nature (the
    response that carries the usage never arrived), so the run's served
    totals are a lower bound after one — the same honesty rule the usage
    gap mechanism applies everywhere else.
    """

    model_client: object  # a LoopModelClient — the run's model client
    monitor: RunBudgetMonitor
    timeout_seconds: float

    async def judge(self, answer_text: str, citations: list[dict]) -> dict:
        """Run the judged check; return the judge's payload fragment
        ``{"ran": bool, "outcome": str, "verdict": str | None}``.

        The budget is claimed only when the call will actually dispatch:
        the remaining output allowance is read first — a spent token budget
        (no room for one more call) refuses the judge BEFORE it consumes a
        model-call slot, so the usage record never counts a call that never
        happened.
        """
        try:
            self.monitor.check_wall_clock()
        except BudgetExhausted as spent:
            logger.info("grounding judge skipped: %s", spent)
            return {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
        bound = self.monitor.remaining_output_tokens()
        if bound is not None and bound <= 0:
            return {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
        try:
            self.monitor.take_aux_model_call()
        except BudgetExhausted as spent:
            logger.info("grounding judge skipped: %s", spent)
            return {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
        messages = judge_messages(answer_text, citations)
        # The judge's run-path span: the outcome attribute is
        # read OFF the result after the decision ladder — the span never
        # interleaves with the branch logic, and a new early-return path
        # cannot forget the attribute.
        with tracing.with_span("agent.grounding_judge") as judge_span:
            try:
                turn = await asyncio.wait_for(
                    self.model_client.complete(messages, (), max_output_tokens=bound),
                    timeout=self.timeout_seconds,
                )
            except TimeoutError:
                logger.info("grounding judge timed out after %.3fs", self.timeout_seconds)
                # The response that carries the served usage never arrived:
                # the call's server-side spend is unreportable, so the run's
                # served totals become a lower bound.
                self.monitor.mark_usage_gap()
                result = {"ran": True, "outcome": JUDGE_OUTCOME_TIMEOUT, "verdict": None}
            except BudgetExhausted as spent:  # the bound raced the budget mid-call accounting
                logger.info("grounding judge refused: %s", spent)
                result = {"ran": False, "outcome": JUDGE_OUTCOME_BUDGET_EXHAUSTED, "verdict": None}
            else:
                verdict = parse_judge_verdict(turn.content)
                # The call was served, so its usage is accounted for whatever
                # the verdict says — an unparseable answer does not make the
                # served tokens unreportable.
                self.monitor.record_usage(turn.prompt_tokens, turn.completion_tokens)
                if verdict is None:
                    result = {"ran": True, "outcome": JUDGE_OUTCOME_ERROR, "verdict": None}
                else:
                    result = {"ran": True, "outcome": JUDGE_OUTCOME_COMPLETED, "verdict": verdict}
            judge_span.set_attribute("outcome", result["outcome"])
            return result


def judge_messages(answer_text: str, citations: list[dict]) -> list[dict]:
    """The judge's message list: a system message with the strict JSON
    contract, a user message carrying the answer and its cited passages.

    The JSON contract rides the prompt (the ``LoopModelClient`` protocol
    carries no ``response_format``); a non-conforming answer is a judge
    error, and an error is ``unverified`` — never parse-guessed into
    ``grounded``.
    """
    passages = "\n\n".join(f"[{index}] {entry['text']}" for index, entry in enumerate(citations, start=1))
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
    ``source_documents`` (projected through the shared module, so the
    delivered entries carry exactly the fields the frontend citation
    mapping reads).

    ``insufficient_evidence`` is the mechanical insufficiency decision:
    ``{"required": bool, "reasons": [...]}`` — required when the ledger
    holds no successful retrieval or any degraded one, in which case the
    loop replaces the drafted answer with the standard message before the
    text events emit. ``findings`` are the run's recorded injection
    attempts (empty on a clean run).
    """

    status: str  # VERDICT_GROUNDED | VERDICT_UNGROUNDED | VERDICT_UNVERIFIED
    policy: str
    judge: dict
    delivered_citations: list[dict] = field(default_factory=list)
    invalid_citations: list[dict] = field(default_factory=list)
    insufficient_evidence: dict = field(default_factory=lambda: {"required": False, "reasons": []})
    findings: list[dict] = field(default_factory=list)
    # What each source's OWN platform resolved: the citation card carries
    # the source's name, and a source whose record did not resolve is not
    # surfaced (the D1 rule).
    source_records: SourceRecords = field(default_factory=SourceRecords)

    @property
    def is_grounded(self) -> bool:
        return self.status == VERDICT_GROUNDED

    @property
    def insufficient_required(self) -> bool:
        """Whether finalize required the insufficiency response — the loop's
        replacement trigger, decided by the ledger, never by the model."""
        return self.insufficient_evidence.get("required") is True

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
            "insufficient_evidence": dict(self.insufficient_evidence),
            "findings": list(self.findings),
            "source_documents": source_documents_from_citations(self.delivered_citations, records=self.source_records),
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
        metadata_source,
        concept_source,
        bearer: str | None = None,
    ) -> None:
        self.policy = policy
        self.ledger = RetrievalLedger()
        self._authorized_repos = frozenset(repo.repo_id for repo in authorized_repos)
        # The document repository and the OKF server, through their OWN
        # ports, and the caller's token: the citation cards carry each
        # source's NAME, resolved per answer (the deployed path's
        # resolution), and a source that does not resolve is not surfaced
        # (the D1 rule).
        self._metadata_source = metadata_source
        self._concept_source = concept_source
        self._bearer = bearer
        self._judge = GroundingJudge(
            model_client=judge_model_client,
            monitor=monitor,
            timeout_seconds=judge_timeout_ms / 1000,
        )

    def record_tool_result(self, name: str, payload: dict) -> None:
        """Feed one dispatched tool result into the ledger (every result —
        the ledger classifies successes, degradations and error envelopes
        itself)."""
        self.ledger.record(name, payload)

    def record_finding(self, finding: dict) -> None:
        """Record one injection attempt (the loop's taint scan feeds it here)."""
        self.ledger.record_finding(finding)

    def _verdict(
        self,
        status: str,
        judge: dict,
        delivered=None,
        invalid=None,
        insufficient_evidence=None,
        source_records=None,
    ) -> Verdict:
        """One construction home for every verdict this pipeline emits.

        The policy and the recorded findings are read HERE — a verdict
        always carries the run's recorded injection attempts and the
        governing policy; a new additive verdict field is a one-site edit,
        not a sweep over construction sites. ``insufficient_evidence``
        carries the mechanical decision when one is live (the early-return
        insufficiency verdict, the defensive catch); every site past the
        early-return relies on the not-required default, because past it
        the decision is always not-required.
        """
        return Verdict(
            status=status,
            policy=self.policy,
            judge=judge,
            delivered_citations=[] if delivered is None else delivered,
            invalid_citations=[] if invalid is None else invalid,
            insufficient_evidence={"required": False, "reasons": []}
            if insufficient_evidence is None
            else insufficient_evidence,
            findings=self.ledger.findings,
            source_records=source_records if source_records is not None else SourceRecords(),
        )

    def insufficiency_decision(self) -> dict:
        """The mechanical insufficiency decision, read off the ledger.

        CHEAP and JUDGE-FREE: pure ledger reads, callable before the text
        events emit (the loop's time-to-first-chunk must not absorb the
        judge latency). ``required`` is true when NO retrieval grew the
        citable entries (the answer can claim nothing served) OR any
        retrieval ran degraded (a degraded run never delivers a confident
        answer — even with valid citations). The reasons name the
        mechanical facts; they are never the model's words.
        """
        reasons: list[str] = []
        if self.ledger.degradation_count:
            reasons.append(REASON_DEGRADED_RETRIEVAL)
        if self.ledger.successful_retrievals == 0:
            reasons.append(REASON_NO_SUCCESSFUL_RETRIEVAL)
        return {"required": bool(reasons), "reasons": reasons}

    async def finalize(self, answer_text: str) -> Verdict:
        """Verify the drafted answer; return the tri-state verdict.

        The mechanical check decides first: no citable evidence served →
        ``unverified`` (the judge skipped); citable evidence that did not
        survive the validity check → ``ungrounded`` (the judge skipped);
        otherwise the judge runs and its verdict — or its failure, which is
        ``unverified`` — decides. A defensive catch converts an unexpected
        pipeline defect into ``unverified`` too — carrying the mechanical
        insufficiency decision and the recorded findings, which are ledger
        reads a pipeline defect must not bury: verification can fail, it
        can never fabricate ``grounded``.
        """
        try:
            return await self._finalize(answer_text)
        except asyncio.CancelledError:
            raise
        except Exception as failed:  # noqa: BLE001 — verification degrades, never fabricates
            logger.warning("verification pipeline failed; verdict unverified: %s: %s", type(failed).__name__, failed)
            return self._verdict(
                VERDICT_UNVERIFIED,
                {"ran": False, "outcome": JUDGE_OUTCOME_ERROR, "verdict": None},
                insufficient_evidence=self.insufficiency_decision(),
            )

    async def _finalize(self, answer_text: str) -> Verdict:
        # The finalize's run-path span: the verification stage
        # of the trace waterfall. The decision body is UNCHANGED
        # (`_finalize_decision`, the pre-diff ladder); the span reads the
        # tri-state status off the verdict it returns — the telemetry never
        # interleaves with the branch logic.
        with tracing.with_span("agent.verify_finalize", attributes={"policy": self.policy}) as finalize_span:
            verdict = await self._finalize_decision(answer_text)
            finalize_span.set_attribute("grounding_status", verdict.status)
            return verdict

    async def _resolve_records(self) -> SourceRecords:
        """Resolve the ledger's sources' records through their OWN platform's
        port.

        A legacy document is resolved by the document repository, an OKF
        concept by the OKF server — the route that applies the repository's
        fence and the publication gate on the CALLER's own token.
        """

        provenances = [(entry.get("provenance") or {}) for entry in self.ledger.entries]
        return await resolve_source_records(
            provenances,
            document_source=self._metadata_source,
            concept_source=self._concept_source,
            bearer=self._bearer,
        )

    async def _finalize_decision(self, answer_text: str) -> Verdict:
        # The documents' names, resolved through the document repository
        # (the deployed path's per-answer resolution): the citation card
        # carries the DOCUMENT's name, and a document that did not resolve
        # is not surfaced and contributes no score (the D1 rule).
        source_records = await self._resolve_records()
        # The insufficiency decision runs FIRST — before the judge, before
        # the grounded claim is surfaced (degraded beats grounded).
        # The judge is skipped on this path: the answer it would evaluate is
        # not the delivered answer. (An empty ledger necessarily lands here:
        # entries can only grow through a dispatch that would have counted
        # as a successful retrieval, so empty entries ⇒ required.)
        insufficiency = self.insufficiency_decision()
        if insufficiency["required"]:
            # The delivered citations still ride the payload for diagnostics
            # (a degraded search may have surfaced valid passages), and the
            # mechanical validity check still classifies them — but the
            # verdict is unverified and the loop replaces the drafted text
            # with the standard insufficiency response.
            validity = check_reference_validity(self.ledger.entries, self._authorized_repos)
            return self._verdict(
                VERDICT_UNVERIFIED,
                {"ran": False, "outcome": JUDGE_OUTCOME_SKIPPED, "verdict": None},
                delivered=[dict(entry) for entry in validity.delivered],
                invalid=[dict(entry) for entry in validity.invalid],
                insufficient_evidence=insufficiency,
                source_records=source_records,
            )
        validity = check_reference_validity(self.ledger.entries, self._authorized_repos)
        delivered = [dict(entry) for entry in validity.delivered]
        if not delivered or validity.invalid:
            # Citable evidence existed but none of it survived the mechanical
            # check (or entries were dropped as unauthorized): an unsupported
            # assertion — not grounded, mechanically, before any judge runs.
            return self._verdict(
                VERDICT_UNGROUNDED,
                {"ran": False, "outcome": JUDGE_OUTCOME_SKIPPED, "verdict": None},
                delivered=delivered,
                invalid=[dict(entry) for entry in validity.invalid],
                source_records=source_records,
            )
        judge_result = await self._judge.judge(answer_text, delivered)
        if judge_result["outcome"] != JUDGE_OUTCOME_COMPLETED:
            return self._verdict(VERDICT_UNVERIFIED, judge_result, delivered=delivered, source_records=source_records)
        return self._verdict(judge_result["verdict"], judge_result, delivered=delivered, source_records=source_records)
