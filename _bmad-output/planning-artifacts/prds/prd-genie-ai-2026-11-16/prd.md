---
title: PRD — Agentic Foundations (OPEA-free)
status: draft
created: 2026-11-16
updated: 2026-11-16
prd_key: agentic-foundations
initiative: agentic-foundations
framing_issue: "1729"
---

# PRD — Agentic Foundations (OPEA-free)

## 1. Executive summary

GENIE.AI answers questions today through a fixed RAG pipeline built on OPEA
microservices. This initiative adds an **agentic document-QA capability** — an
agent that searches, inspects evidence and refines its search within configured
limits, and returns a source-grounded answer or explicitly reports insufficient
evidence — as the first foundation of a broader product direction: **agentic
flexibility serving government administrative workflows, with potential
AI-driven orchestration later**.

Two operator decisions (2026-11-16) frame everything below:

1. **The agentic path is OPEA-free from the first iteration.** No `comps`
   imports, no calls to OPEA-built services, no OPEA build-time downloads —
   anywhere in the agentic request path.
2. **OPEA exit for the existing RAG stack is deferred** to a separate later
   initiative. The legacy path keeps running unchanged; nothing here retires
   or replaces it.

The driver is the product roadmap, not OPEA: the agentic capability is wanted
for its own value. OPEA's announced archival (team information from Intel)
makes the OPEA-free constraint prudent, and this initiative must not add new
OPEA coupling that would make the deferred exit harder.

**Scope of this PRD:** the first iteration — foundations plus the governed
document-QA use case (SC-01). The broader workflow/orchestration vision is
stated for direction; it is not delivered here.

## 2. Vision and strategic context

**Long-term direction.** Public administrations use GENIE for increasingly
dynamic work: questions that need iterative lookup, procedures that need
more-or-less dynamic workflows, eventually orchestrated multi-step processes
with AI involvement in the orchestration itself. The platform must therefore
grow from a fixed retrieval pipeline into a governed agentic system that
administrations can extend without the vendor of each component dictating the
architecture.

**This initiative's place.** It lays the foundations: a GENIE-owned document
capability contract with an OPEA-free implementation, one governed agent over
it, activation/rollback alongside the legacy RAG path, and the evaluation
infrastructure to prove the new path is at least as trustworthy. Iteration 2+
topics — workflow engine, multi-agent, AI orchestration — build on these
foundations and are explicitly non-goals here (see §4). The first iteration
must not close the door to them: contracts stay decoupled from any single
runtime, and the runtime decision (D03) weighs evolution capability — but no
orchestrator groundwork is delivered in this scope.

**Sources.** Framing and decision tracking: issue #1729. State-of-the-art
research (S1 deep-recon): `research/technical-opea-free-agentic-document-qa-architectu-2026-11-16/`
(digest: `research-extract.md` in this run folder).

## 3. Context and users

GENIE.AI is an Apache-2.0 sovereign generative-AI framework for the public
sector, deployed as web (Vue) and mobile (Flutter) chat surfaces backed by
Keycloak authn, a Node.js BFF, and an OPEA-based RAG pipeline over ArangoDB,
vLLM and TEI.

| Actor | Role in iteration 1 |
|---|---|
| End user (public-sector) | Asks questions in the existing chat surfaces; receives source-grounded answers with citations, or an explicit insufficient-evidence response. |
| Administrator / operator | Enables the agentic path per deployment, monitors executions through the existing observability stack, rolls back to the legacy path. |
| GENIE engineering | Owns the document capability contract and its OPEA-free implementation; runs the evaluation protocol. |

**No pilot deployment or user cohort is designated yet** (team information,
2026-11-16). Evaluation therefore runs against an agreed fixed RAG reference
(§9), not a live pilot; pilot scope is decision D05.

**[ASSUMPTION]** The agentic path inherits the existing chat surfaces,
multilingual behavior (including streaming translation when enabled) and error
contracts, plus one deliberate versioned extension: the activity-line SSE
events (FR-30). Any further incompatibility with an agent loop is versioned
explicitly (FR-14) rather than absorbed silently.

## 4. Scope — iteration 1

### 4.1 In scope

- One agent and a small approved set of document operations (SC-01: governed
  document question answering).
- A GENIE-owned document capability contract and its first **OPEA-free**
  implementation (direct ArangoDB + TEI/vLLM use, or new code — not calls to
  ChatQnA or the OPEA retriever).
- Existing knowledge sources and their authorization rules, unchanged.
- Traceable citations and explicit failure/insufficiency handling.
- Server-controlled execution limits and cancellation.
- Compatibility with the selected existing chat and streaming contracts.
- Controlled session and audit persistence (read-only use case).
- Deployment-level activation alongside the legacy RAG path, with rehearsed
  rollback.
- A minimal user-visible **agent activity line** (e.g. "searching…",
  "reading source X") streamed during agent execution — see FR-30. The
  full rich display (expandable tool calls, Telegram-style, incl. model
  reasoning) is an iteration-2 evolution, not delivered here.
- The evaluation infrastructure for E01/E02 (§9).

**Query-class note (research §1/§3):** the literature positions agentic
behaviour as earning its cost on multi-hop and ambiguous queries, with
single-shot retrieval remaining the correct path for single-document lookup.
For GENIE these benefits are **hypotheses pending E02** (measured on our
corpora and query mix), not findings. The activation flag (FR-15) is
deployment-level in iteration 1; whether some requests stay on the fixed
path within an agentic deployment is an evaluation outcome (E02 may justify
retaining a fixed path for some requests — framing §10), not a predetermined
architecture.

### 4.2 Out of scope (non-goals for iteration 1)

- Autonomous changes to authoritative knowledge stores or business systems.
- General shell execution, arbitrary database queries, agent-driven plugin
  installation.
- Multi-agent orchestration; workflow engine; visual workflow designer.
- Long-running transactional workflows.
- Simultaneous changes to storage technology, embedding models or chunking
  strategy.
- **Any use of OPEA components in the agentic request path** (definition in
  §5).
- OPEA replacement/retirement for the legacy RAG stack (separate later
  initiative).

These exclusions require scope review before iteration 2; they are not
assertions about permanent product limits.

## 5. Definition — "OPEA component"

For this initiative: the `comps` library and every GENIE overlay service built
on it (ChatQnA; embedding, reranker, retriever and dataprep wrappers),
including their build-time repository downloads.

**Not** OPEA components: vLLM, TEI, ArangoDB, Redis and GENIE's own Node.js
services — compose defines them independently of the OPEA wrappers (F05).

The constraint binds the NEW agentic path only; it does not require touching
the existing stack. **R12 discipline:** a capability may only be described as
"OPEA-free" for its explicitly validated scope (FR-22).

## 5b. Glossary

Core nouns, used consistently; drift here is where downstream extraction
breaks (rubric finding M-1).

| Term | Meaning in this PRD |
|---|---|
| **Document capability contract** | The GENIE-owned, agent-facing API defining document operations (input/result/provenance/error semantics, limits, versioning). Working names `search_knowledge`, `read_source` are placeholders, not schemas. |
| **Document capability boundary** | The logical separation between the agent and knowledge access, realized by the contract. Not necessarily a microservice (D01 decides placement). |
| **Agentic path** | The new request path: agent loop over the contract's operations. OPEA-free by constraint (FR-20). |
| **Legacy path** | The existing OPEA-backed fixed RAG pipeline serving current chat traffic, unchanged throughout this initiative. |
| **Agent** | One model-directed loop executing approved document operations within server-side bounds (SC-01). Not a persona, not multi-agent. |
| **Runtime** | The software layer implementing the agent loop (custom loop, framework, or SDK-driven runtime — D03). |
| **Reference validity** | A citation resolves to an authorized, actually-retrieved source (mechanically checkable). |
| **Grounding** | The cited passage supports the associated claim (distinct from reference validity; FR-10). |
| **Rollout record** | Per-stage artifact: consumers, versions, procedures, in-flight treatment, rollback triggers + responsible operator, rehearsal evidence (FR-16). |
| **OPEA component** | Defined in §5: `comps` + overlay services built on it + their build-time downloads. |
| **Activation** | Deployment-level switch routing requests to the agentic path (FR-15). |

## 6. Feature groups and functional requirements

IDs are stable. Working names (`search_knowledge`, `read_source`) are not
accepted API schemas — schema design is downstream (D01, V02, V05).

### FG-1 — GENIE document capability boundary

The agent depends on a GENIE-owned document capability contract. The contract
is a logical boundary, not necessarily a new microservice; its placement is
decision D01 (investigate existing OKF, document-repository and backend
responsibilities first; reuse existing authorities rather than introducing a
second authorization or knowledge-governance layer).

- **FR-1** The document capability contract defines input, result, provenance
  and error semantics for every agent-facing operation.
- **FR-2** The contract accepts a trusted caller context and requested search
  restrictions; model-generated arguments must never widen access (with
  FR-12).
- **FR-3** Results carry stable source identifiers and sufficient provenance
  for authorized citation resolution (with FR-13).
- **FR-4** The contract defines cancellation, timeout and result-size limits
  for every operation.
- **FR-5** The contract states compatibility and versioning rules for its
  operations.
- **FR-6** The first implementation of the contract is OPEA-free: direct use
  of ArangoDB, TEI/vLLM endpoints and GENIE's own services, or newly written
  code. Calling ChatQnA, the OPEA retriever or any other OPEA-built service
  is not an acceptable implementation. *(Supersedes the 10-November option to
  delegate to existing OPEA services.)*
- **FR-7** Agent-facing document contracts expose no OPEA-specific
  representations.
- **FR-8** Before the contract is accepted, the query-path behaviour of the
  OPEA retriever/embedding pipeline is recorded (query semantics, filtering,
  reranking order) so the OPEA-free path preserves required behaviour
  deliberately, not accidentally (verification V02; see §10).

### FG-2 — Governed document-QA agent (SC-01)

- **FR-9** The agent may search knowledge, inspect evidence and refine its
  search within configured, server-side limits — one agent, approved document
  operations only.
- **FR-10** The agent returns either a source-grounded answer with traceable
  citations or an explicit insufficient-evidence response. Two acceptance
  criteria are defined separately: **reference validity** (every citation
  resolves to an authorized, actually-retrieved source — checkable
  mechanically against structured tool results with stable source
  identifiers) and **grounding** (the cited passage supports the associated
  claim — an unsupported assertion citing a genuine source fails grounding
  even though its references are valid). Prompt-level citation instructions
  alone are not accepted as enforcement (research REC-5 — adding them made
  invention *worse* in the literature). The PRD also requires an explicit
  **release policy**: what content may be streamed to the user before
  verification completes (the existing SSE route forwards text chunks ahead
  of final metadata, so a post-release verification failure cannot unsend
  text), and the user-visible outcome when verification fails — including
  partial and translated responses. The enforcement mechanism is an
  architecture decision.
- **FR-11** Agent execution is bounded server-side on every dimension — step
  cap, wall-clock time, per-run token budget, model/tool-call count and
  evidence volume — because no framework supplies complete bounds (REC-3).
  Counting semantics are defined: retries, parallel tool invocations and
  auxiliary model calls (e.g. translation, classification) all count against
  the budgets, and the wall-clock deadline applies end-to-end per request.
  Cancellation propagates from client disconnect through the loop to the
  model call, and is tested (with FR-16). Numeric thresholds remain
  post-baseline (§8).
- **FR-12** Authorization follows the per-request intersection model (REC-4,
  converged pattern): effective permissions = user ∩ task over the
  registered toolset; the user is the actor (impersonation semantics —
  neither party gains permissions); enforcement lives in the tool executor
  with per-request identity; the approved public/restricted knowledge
  distinction is preserved, and authorization errors never trigger a more
  permissive fallback. Degraded modes obey the same honesty rule as the
  happy path: an availability fallback must never silently conceal
  inadequate evidence — when retrieval runs degraded (partial availability,
  fallback strategy), insufficiency is reported as insufficiency, never
  returned as a confident answer (framing §11).
- **FR-13** Evidence surfaced to the user resolves to authorized, stable
  citations, rendered through the existing RAG citation components (no new
  frontend citation surface in iteration 1).

### FG-3 — Chat integration, activation and rollback

- **FR-14** The agentic path is compatible with the existing client API
  as inventoried by V05, including streaming (SSE), translation and error
  behaviors. Any approved change
  is explicitly versioned. Internal agent events adopt the AG-UI event
  taxonomy as a pattern (run lifecycle, text deltas, tool-call lifecycle,
  state) — not as a dependency — mapped onto the existing SSE contract
  (REC-7).
- **FR-15** Activation is independently controllable per deployment
  (configuration flag), alongside the unchanged legacy RAG path. Granularity
  per user/tenant is a deliberate non-goal of iteration 1.
- **FR-16** Rollback (agentic ↔ legacy routing) is demonstrated for every
  delivered stage. Rollback treatment is defined for **in-flight requests**
  (completion vs interruption), **partial responses** already streamed, and
  **persisted conversations** created by the agentic path — including
  format/version compatibility with the legacy path and whether any agent
  session state is reused after rollback. Acceptance scenario required: an
  agentic conversation is started, agentic routing is disabled, and that
  conversation is continued on the legacy path without data loss or
  corruption. Every stage rollout is recorded in a **rollout record**
  identifying: selected consumers and capabilities, artifact/configuration
  versions, activation and rollback procedures, in-flight treatment,
  **rollback triggers and the responsible operator** (a named person who
  pulls the trigger when a trigger condition fires — "rollback is possible"
  is not accountability), and rehearsal evidence (framing §11). Session and
  audit persistence are in scope (§4.1), so "no data changes" claims are
  limited to authoritative knowledge stores; future data-changing stages
  would require explicit recovery procedures. Aligned with V08.


- **FR-30** The user sees a minimal **activity line** while the agent works:
  tool-call lifecycle events (started/completed, operation name — not raw
  model reasoning) carried as **new, explicitly versioned SSE event types**
  (the first concrete instance of D04's preservation-vs-versioning
  decision), shaped from the AG-UI tool-call lifecycle taxonomy (FR-14).
  Frontend rendering is minimal: a status line, no expandable tool detail.
  The events degrade gracefully — clients that ignore them behave exactly
  as today.
### FG-4 — Governance, audit and compliance

- **FR-17** Every agent execution records implementation, model, prompt and
  configuration versions sufficient to investigate that execution, without
  logging credentials or unnecessary sensitive content.
- **FR-18** Agent executions are observable through the existing stack (OTel
  traces, VictoriaLogs/VictoriaTraces, Grafana dashboards). No dedicated
  admin UI in iteration 1.
- **FR-19** Licensing evidence comes in two mandatory tiers: **V07a —
  pre-adoption** (licence verification for the exact package versions of any
  dependency before it is adopted — gates D03; NOASSERTION/unread licence
  text counts as **unverified**, never as an incompatibility finding) and
  **V07b — pre-release** (complete licence and redistribution assessment
  incl. transitive/optional dependencies, images, binaries, models; required
  notices preserved and project disclosures updated).
- **FR-20** The agentic request path contains no `comps` imports, no OPEA
  service calls and no OPEA build-time downloads — enforced from the first
  delivered stage, verified by build/CI checks where feasible.
- **FR-21** The agentic path adds no new OPEA coupling that makes the
  deferred OPEA exit harder. Verified by the same build/CI dependency
  audit as FR-20 (no `comps`/OPEA imports or downloads in agentic-path
  packages), plus an explicit check at each stage gate's review.
- **FR-22** A capability is described as "OPEA-free" only for its explicitly
  validated scope.
- **FR-28** Authorization acceptance covers **retained data**, not only
  live calls: evidence retained across turns, session state and
  audit/tracing records have defined ownership and access rules (fed by
  V04). Tested: cross-user and cross-session identifier attempts, narrower
  task scopes, and permission changes that occur **between turns before
  retained evidence is reused**. Historical visibility of earlier answers
  after a source is revoked is an explicit product-policy decision
  (recorded, not defaulted).
- **FR-29** Structural decisions of this initiative are recorded as decision
  records (ADRs) with the framing §12 discipline: the traceability chain
  `use case → requirement → decision → investigation/story → merge request →
  validation evidence → released version` is maintained; each record carries
  status (Proposed/Accepted/Rejected/Superseded), date, owner, reviewers,
  problem/constraints/alternatives, decision + evidence, consequences and
  replacement costs, reconsideration triggers, and links; superseded
  records are preserved with links to successors; existing ADRs are
  status-checked before reliance (e.g. okf-034 is still `Proposed` and must
  not be treated as accepted); each document has one canonical home and is
  linked, not duplicated.

### FG-5 — Evaluation infrastructure

- **FR-23** The evaluation protocol runs two experiments over three
  configurations: **A** = legacy fixed RAG; **B** = a fixed (non-agentic)
  pipeline over the new OPEA-free capabilities; **C** = the agent over
  those same new capabilities. **E01 compares A/B** (did the OPEA-free
  path preserve required behaviour?) — the retrieval backend is the
  variable under test, so A and B deliberately differ there. **E02
  compares B/C** (does agentic behaviour provide useful gains within
  acceptable limits?) — B and C share the same retrieval backend, so an
  E02 delta is attributable to the agent, not to the retrieval migration.
  Held fixed within each pair: corpus, evaluation set, execution
  conditions, and the model services to the extent each configuration can
  use them; intentional prompt/orchestration differences are recorded.
- **FR-24** Every evaluation run versions its corpus, cases, configurations,
  models, prompts and evaluator instructions; evaluation cases used to tune
  the implementation are kept separate from the assessment set. The
  evaluation set's composition is fixed explicitly: **answerable and
  unanswerable questions, citation checks, representative languages** (the
  product is multilingual; translation is a compatibility surface per
  FR-14), **restricted/public access scenarios, failure and cancellation
  cases** (framing §10).
- **FR-25** Authorization scenarios are part of the evaluation set; no
  unauthorized disclosure is accepted. Passing them is evidence for tested
  conditions, not proof of impossibility. The evaluation set also includes
  **hostile instructions embedded in retrieved documents and tool outputs**
  (prompt-injection scenarios): the agent must not follow instructions
  originating from retrieved content, and a document that attempts to steer
  the agent counts as a finding.
- **FR-26** Known defects in the reference are recorded and never silently
  become requirements to reproduce.
- **FR-27** The evaluation reports retrieval quality, answer grounding,
  abstention, latency and resource consumption separately, and identifies
  uncontrolled differences (prompts, cache state, concurrency).

## 7. Non-functional requirements (cross-cutting)

| ID | Requirement |
|----|-------------|
| NFR-1 (Security) | Trusted-service authorization on every operation (FR-12); no raw AQL to agents (ADR okf-011); provenance preserved end-to-end. |
| NFR-2 (Sovereignty/licensing) | Apache-2.0-compatible selections only (V07 assessment before any release using the artifacts). Sovereignty is gated on **defaults, not capabilities**: every runtime/dependency is audited for default telemetry, default cloud export and licence posture before adoption (research §5.2 — the field's documented failure mode is a default, e.g. OpenAI Agents SDK exporting traces to OpenAI cloud keyed on the same credential as a self-hosted baseURL). Any runtime under developer-preview status carries an explicit operational-risk acceptance. |
| NFR-3 (Coexistence) | The legacy OPEA RAG path serves existing traffic unchanged throughout; the agentic path is additive. A **legacy non-regression criterion under concurrent agentic load** is part of the S4 gate (per-run bounds do not by themselves prevent many bounded runs from saturating shared vLLM/TEI); the expected saturation/admission behaviour of the agentic path is defined. E02 measures resource consumption; thresholds post-baseline per §8. |
| NFR-4 (Operability) | Rollback rehearsed per stage (V08); deployment-level activation (FR-15); observability through the existing stack (FR-18). |
| NFR-5 (Compatibility) | Existing client API/SSE/error contracts inventoried and regression-covered before the S3 compatibility gate (V05). |
| NFR-6 (CI) | Executable CI/integration coverage and runner availability confirmed; checks needing a separate environment are identified (V09 — repo E2E execution is suspended per ADR 0001; the local E2E run is the current baseline). |
| NFR-7 (Reversibility) | Choices reversible where practical; no second authorization or knowledge-governance layer; no generic multi-engine platform built merely to claim future flexibility — the design minimizes direct coupling and documents replacement costs instead. Required now for every candidate: documented dependency boundaries and replacement scope, with measured or estimated swap cost. The runner-up runtime and swap duration are **hypotheses until runtime/placement evidence exists** (a scoped spike demonstrates them; the research's ≤1-day pydantic-ai estimate assumes same-Python placement, which Node-vs-Python (OQ-6) may invalidate) — decided after D03/placement, consistent with not building a second engine merely to demonstrate flexibility. |

## 8. Success metrics and counter-metrics

**Posture (confirmed by operator, 2026-11-16): structural gates plus measured
dimensions; numerical thresholds are set after measuring the reference and
before assessing the candidate. Absence of agreed thresholds blocks promotion
to the corresponding release stage — it is not hidden behind defaults.**

Gate structure (per stage):

- **S3 exit:** contract, authorization and compatibility checks pass; V02/V04/V05
  evidence recorded.
- **S4 exit:** E01 shows no unacceptable regression vs the fixed-RAG reference
  on every measured dimension; E02 shows agentic gains within accepted
  limits; bounded execution and rollback demonstrated (V06/V08).

Measured dimensions (reported separately, FR-27):

| ID | Dimension |
|----|-----------|
| M-1 | Retrieval quality |
| M-2 | Answer grounding |
| M-3 | Abstention correctness |
| M-4 | Latency |
| M-5 | Resource consumption |

Counter-metrics:

- **CM-1** Cost and latency per agentic request vs the RAG reference
  (agentic loops can be expensive; the delta must be visible, not averaged
  away).
- **CM-2** Excessive abstention rate (answers avoided for questions the
  reference answers correctly).
- **CM-3** Rate of executions hitting execution limits or cancellation
  (FR-11) — a quality signal, not just a safety one.

## 9. Delivery staging

| Stage | Deliverable | Exit evidence |
|-------|-------------|---------------|
| S0 — Frame | Framing document reviewed (issue #1729, rescoped 2026-11-16) | Blocking ambiguities assigned — done |
| S1 — Research | Deep-recon: sovereign source-grounded agentic document-QA architecture; candidate runtimes (incl. DSH) assessed | Research report with cited sources — done (2026-11-16) |
| S2 — Plan | This PRD + architecture + **light UX spec** (activity line — the chat surface changes minimally; operator decision 2026-11-16) | PRD, architecture and UX spec accepted |
| S3 — Boundary | Document capability contract + its OPEA-free implementation | Contract, authorization and compatibility checks |
| S4 — Agent | SC-01 on the selected runtime | E01/E02 against the agreed reference; bounded execution and rollback demonstrated |

Deferred to the separate OPEA-exit initiative: progressive OPEA replacement,
complete OPEA retirement, full dependency inventory, data-transition and
ingestion-writer strategy, backend-comparison evaluation. Intel's archival
scope/timing informs that initiative's schedule, not this one's.

## 10. Open decisions and verification backlog

Decisions (document-local IDs; not allocated ADR numbers). Each is resolved
through the verification item that feeds it:

| ID | Decision | Status | Fed by |
|----|----------|--------|--------|
| D01 | Ownership/placement of the document capability boundary | Open | V02, V04 |
| D02 | OPEA-free agentic path coexisting with unchanged legacy OPEA RAG | Proposed (operator direction 2026-11-16) | V03, NFR-3 |
| D03 | First agent runtime | Open — operator named DSH preferred investigation candidate (2026-11-10); S1 research (amended AM-1/AM-2) screening pick: custom minimal loop (provisional, unimplemented), pydantic-ai runner-up, DSH unassessed on its actual SDK-subprocess integration mode. **Full candidate state, corrected revisit trigger and required evidence: addendum §D.** Decision at S4 entry from V06 + V07a | S1 research + amendments, SC-01 experiment, V06, V07 |
| D04 | Preservation vs versioning of document/client contracts | Open | V05 |
| D05 | Release gates and pilot scope | Open | Baseline measurement, validation infrastructure (V09) |

Verification backlog (roles, not yet named assignees):

| ID | Investigation | Required before | Role |
|----|---------------|-----------------|------|
| V02 | Record what the OPEA retriever/embedding path contributes to query results (semantics, filtering, reranking); distinguish query from ingestion paths. Input: the OPEA contract-test suite (F06) documents retrieval/filtering/reranking/ingestion/telemetry checks | S3 design | Technical lead |
| V03 | Record deployed versions, image digests, models, configurations, topology; reconcile with source baseline | Representative baseline | Operations |
| V04 | Map effective authorization, provenance and ownership across existing services, incl. OKF amendments | Contract acceptance | Architecture + security reviewers |
| V05 | Inventory actual API/SSE/error contracts and current regression coverage | S3 compatibility gate | Backend/frontend + QA |
| V06 | Test selected runtime integration with GENIE's model endpoint, approved tools, isolation, cancellation, telemetry | S4 runtime decision | Agent integration owner |
| V07a | Pre-adoption licence verification for the exact versions of any dependency being adopted (NOASSERTION/unread = unverified, not incompatible) | D03 close / any dependency adoption | Licensing reviewer |
| V07b | Full licence and redistribution assessment for selected artifacts incl. transitive/optional dependencies, notices, disclosures | Pilot/release using them | Licensing reviewer |
| V08 | Rehearse routing rollback (agentic ↔ legacy) | S4 rollout | Operations + QA |
| V09 | Confirm executable CI/integration coverage and runner availability; identify checks needing a separate environment | Release-gate acceptance | CI + QA owners |

## 11. Risks

| Risk | Mitigation |
|------|-----------|
| DSH (or any selected runtime) is developer-preview software | V06 integration test + explicit operational-risk acceptance (NFR-2); runtime contract stays decoupled (NFR-7) so replacement is documented, not blocked |
| OPEA-free path silently diverges from required RAG behaviour | V02 recorded behaviour; E01 regression gate (§8) |
| No pilot user/cohort defined | Evaluation vs agreed fixed reference; D05 names pilot scope before rollout decisions |
| Repo E2E execution suspended (ADR 0001) | V09 maps which gates rely on the local E2E baseline; release gates may not silently assume unavailable CI |
| vLLM tool-calling is the operational minefield (parser family per model, strict schemas, first-call FSM-compile latency, tool-delta streaming unverified per parser) | Binding prerequisites pinned against the deployed vLLM version (REC-6) — architecture doc owns the mechanism; PRD holds the constraint |
| Shared model-service contention (agent loops vs chat traffic) | E02 measures resource consumption; execution limits (FR-11) bound it |
| Scope creep toward workflow/orchestration | Non-goals (§4.2) enforced at PRD review; iteration 2 scope is a separate decision |

## 12. Assumptions

- **[ASSUMPTION]** Existing chat surfaces render agent answers with the
  current citation components without frontend work (FR-13).
- **[ASSUMPTION]** Multilingual behavior (incl. streaming translation when
  enabled) carries over to the agentic path (FR-14); incompatibilities are
  versioned changes, not silent absorption.
- **[ASSUMPTION]** Controlled session/audit persistence (read-only) needs no
  new persistence layer — existing stores suffice for iteration 1.
- **[ASSUMPTION]** A deployment-level activation flag (FR-15) suffices for
  safe rollout; per-user granularity can be added later without contract
  change.

## 13. Open questions

1. Which deployment hosts the first end-to-end validation of the agentic path
   (no pilot designated — D05)?
2. ~~Does the chat surface change?~~ **Resolved 2026-11-16 (operator):**
   yes, minimally — an agent activity line (FR-30); full rich display
   (expandable tool calls, reasoning) deferred to iteration 2. Light UX
   spec required at S2.
3. Contract placement (D01): new service, extension of an existing one
   (backend BFF? document-repository? OKF?), or library? Architecture doc
   decides from V02/V04 evidence.
4. Runtime (D03): custom loop vs pydantic-ai vs DSH-via-SDK-subprocess —
   decided at S4 entry from the amended S1 research (incl. the AM-1 DSH
   subprocess-mode operational assessment) + V06 + V07a.
5. Where do agreed evaluation thresholds live once measured (D05), and who
   signs the E01/E02 gate?
6. Node vs Python placement of the agent loop — no public evidence either
   way (research OQ-6); an architecture-doc decision from team constraints.
7. S1 research freshness: the compatibility/version-class claims (vLLM
   tool-calling, framework versions) re-check 2026-12-01 — D03 must not be
   closed on a research snapshot older than that.
