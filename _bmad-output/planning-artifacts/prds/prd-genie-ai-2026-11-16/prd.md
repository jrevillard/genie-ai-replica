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
contracts. If any of these prove incompatible with an agent loop, the change
is versioned explicitly (FR-14) rather than absorbed silently.

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
- The evaluation infrastructure for E01/E02 (§9).

**Query-class note (research §1/§3):** agentic behaviour earns its cost on
multi-hop and ambiguous queries; single-shot retrieval remains the correct
path for single-document lookup. The activation flag (FR-15) is
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
  citations or an explicit insufficient-evidence response. Citation
  enforcement is mechanical, not rhetorical: every citation is verified
  against structured tool results carrying stable source identifiers, with a
  refusal path; prompt-level citation instructions alone are not accepted as
  enforcement (research REC-5 — adding them made invention *worse* in the
  literature).
- **FR-11** Agent execution is bounded server-side on every dimension — step
  cap, wall-clock time, per-run token budget, model/tool-call count and
  evidence volume — because no framework supplies complete bounds (REC-3).
  Cancellation propagates from client disconnect through the loop to the
  model call, and is tested (with FR-16).
- **FR-12** Authorization follows the per-request intersection model (REC-4,
  converged pattern): effective permissions = user ∩ task over the
  registered toolset; the user is the actor (impersonation semantics —
  neither party gains permissions); enforcement lives in the tool executor
  with per-request identity; the approved public/restricted knowledge
  distinction is preserved, and authorization errors never trigger a more
  permissive fallback.
- **FR-13** Evidence surfaced to the user resolves to authorized, stable
  citations, rendered through the existing RAG citation components (no new
  frontend citation surface in iteration 1).

### FG-3 — Chat integration, activation and rollback

- **FR-14** The agentic path is compatible with the selected existing client
  API, streaming (SSE), translation and error behaviors. Any approved change
  is explicitly versioned. Internal agent events adopt the AG-UI event
  taxonomy as a pattern (run lifecycle, text deltas, tool-call lifecycle,
  state) — not as a dependency — mapped onto the existing SSE contract
  (REC-7).
- **FR-15** Activation is independently controllable per deployment
  (configuration flag), alongside the unchanged legacy RAG path. Granularity
  per user/tenant is a deliberate non-goal of iteration 1.
- **FR-16** Rollback (agentic ↔ legacy routing) is demonstrated for every
  delivered stage; data-changing stages (none in iteration 1's read-only
  scope) would require explicit recovery procedures.

### FG-4 — Governance, audit and compliance

- **FR-17** Every agent execution records implementation, model, prompt and
  configuration versions sufficient to investigate that execution, without
  logging credentials or unnecessary sensitive content.
- **FR-18** Agent executions are observable through the existing stack (OTel
  traces, VictoriaLogs/VictoriaTraces, Grafana dashboards). No dedicated
  admin UI in iteration 1.
- **FR-19** Licences are validated for selected package versions, plugins,
  images, binaries and models (including transitive and optional
  dependencies); required notices are preserved and project disclosures
  updated (verification V07).
- **FR-20** The agentic request path contains no `comps` imports, no OPEA
  service calls and no OPEA build-time downloads — enforced from the first
  delivered stage, verified by build/CI checks where feasible.
- **FR-21** The agentic path adds no new OPEA coupling that makes the
  deferred OPEA exit harder.
- **FR-22** A capability is described as "OPEA-free" only for its explicitly
  validated scope.

### FG-5 — Evaluation infrastructure

- **FR-23** The evaluation protocol runs two experiments separately:
  **E01** fixed-RAG reference vs the new OPEA-free document capability
  boundary (did the OPEA-free path preserve required behaviour?); **E02**
  fixed-RAG reference vs the agent over equivalent capabilities (does agentic
  behaviour provide useful gains within acceptable limits?).
- **FR-24** Every evaluation run versions its corpus, cases, configurations,
  models, prompts and evaluator instructions; evaluation cases used to tune
  the implementation are kept separate from the assessment set.
- **FR-25** Authorization scenarios are part of the evaluation set; no
  unauthorized disclosure is accepted. Passing them is evidence for tested
  conditions, not proof of impossibility.
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
| NFR-3 (Coexistence) | The legacy OPEA RAG path serves existing traffic unchanged throughout; the agentic path is additive. Resource contention on shared model services is measured (E02 reports it), not assumed away. |
| NFR-4 (Operability) | Rollback rehearsed per stage (V08); deployment-level activation (FR-15); observability through the existing stack (FR-18). |
| NFR-5 (Compatibility) | Existing client API/SSE/error contracts inventoried and regression-covered before the S3 compatibility gate (V05). |
| NFR-6 (CI) | Executable CI/integration coverage and runner availability confirmed; checks needing a separate environment are identified (V09 — repo E2E execution is suspended per ADR 0001; the local E2E run is the current baseline). |
| NFR-7 (Reversibility) | Choices reversible where practical; no second authorization or knowledge-governance layer; no generic multi-engine platform built merely to claim future flexibility — the design minimizes direct coupling and documents replacement costs instead. The runner-up runtime (pydantic-ai per the S1 research) is kept as designated fallback with a ≤1-day swap-in exit test (REC-2). |

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

Measured dimensions (reported separately, FR-27): retrieval quality, answer
grounding, abstention correctness, latency, resource consumption.

Counter-metrics:

- Cost and latency per agentic request vs the RAG reference (agentic loops
  can be expensive; the delta must be visible, not averaged away).
- Excessive abstention rate (answers avoided for questions the reference
  answers correctly).
- Rate of executions hitting execution limits or cancellation (FR-11) — a
  quality signal, not just a safety one.

## 9. Delivery staging

| Stage | Deliverable | Exit evidence |
|-------|-------------|---------------|
| S0 — Frame | Framing document reviewed (issue #1729, rescoped 2026-11-16) | Blocking ambiguities assigned — done |
| S1 — Research | Deep-recon: sovereign source-grounded agentic document-QA architecture; candidate runtimes (incl. DSH) assessed | Research report with cited sources — done (2026-11-16) |
| S2 — Plan | This PRD + architecture (+ UX only if the chat surface changes) | PRD and architecture accepted |
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
| D03 | First agent runtime | Open. Operator named DSH the preferred **investigation** candidate (2026-11-10 framing); the S1 research (2026-11-16) ranks DSH **last** of five — "do not adopt as a dependency" (3-month-old developer preview, no security audit, workstation not embeddable; revisit trigger: stable non-preview release + embeddable server mode + security audit; borrow its `ToolDefinition` split as a pattern). Research pick: **custom minimal tool-calling loop** (REC-1), **pydantic-ai** designated runner-up (REC-2). Decision at S4 entry from V06/V07 | S1 research, SC-01 experiment, V06, V07 |
| D04 | Preservation vs versioning of document/client contracts | Open | V05 |
| D05 | Release gates and pilot scope | Open | Baseline measurement, validation infrastructure (V09) |

Verification backlog (roles, not yet named assignees):

| ID | Investigation | Required before | Role |
|----|---------------|-----------------|------|
| V02 | Record what the OPEA retriever/embedding path contributes to query results (semantics, filtering, reranking); distinguish query from ingestion paths | S3 design | Technical lead |
| V03 | Record deployed versions, image digests, models, configurations, topology; reconcile with source baseline | Representative baseline | Operations |
| V04 | Map effective authorization, provenance and ownership across existing services, incl. OKF amendments | Contract acceptance | Architecture + security reviewers |
| V05 | Inventory actual API/SSE/error contracts and current regression coverage | S3 compatibility gate | Backend/frontend + QA |
| V06 | Test selected runtime integration with GENIE's model endpoint, approved tools, isolation, cancellation, telemetry | S4 runtime decision | Agent integration owner |
| V07 | Licence and redistribution assessment for selected artifacts incl. transitive/optional dependencies | Pilot/release using them | Licensing reviewer |
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
2. Does the chat surface change at all (tooltip/affordance showing "agentic"
   mode), or is the path invisible to the user? → decides whether UX
   artifacts are needed at S2.
3. Contract placement (D01): new service, extension of an existing one
   (backend BFF? document-repository? OKF?), or library? Architecture doc
   decides from V02/V04 evidence.
4. Runtime (D03): DSH vs alternatives — decided at S4 entry from S1 research
   + V06/V07.
5. Where do agreed evaluation thresholds live once measured (D05), and who
   signs the E01/E02 gate?
6. Node vs Python placement of the agent loop — no public evidence either
   way (research OQ-6); an architecture-doc decision from team constraints.
7. S1 research freshness: the compatibility/version-class claims (vLLM
   tool-calling, framework versions) re-check 2026-12-01 — D03 must not be
   closed on a research snapshot older than that.
