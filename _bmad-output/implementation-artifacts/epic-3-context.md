# Epic 3 Context: Safe activation and rollback (S4b)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Operators can enable the agentic path per deployment with one flag, can roll back to the legacy path at any point — with agentic conversations continuing correctly afterward, no data loss — and hold a rollout record that names the responsible rollback operator with rehearsal evidence. The flag mechanism itself is born in Epic 1 (the service is switchable from day one); this epic owns the operational choreography: proving both request paths route through one shared helper, the rollback scenario, and the per-stage rehearsals. Coexistence (the agentic path additive over an unchanged legacy path) is the deployment contract this epic makes operationally safe.

## Stories

- Story 3.1: One flag, both paths, provably
- Story 3.2: Rollback continuity
- Story 3.3: Rehearsed rollback and rollout record (V08)

## Requirements & Constraints

- **Activation is deployment-level, legacy runs alongside.** One configuration flag switches the agentic path independently per deployment; the legacy RAG path serves unchanged in the same stack. Per-user/tenant granularity is a deliberate iteration-1 non-goal (deferred; contract-stable later).
- **Flag off means exactly today.** With the flag off, every request behaves exactly as it does now — the legacy path is untouched, nothing agentic is reachable. This is the coexistence contract underpinning the whole initiative.
- **Rollback is demonstrated for every delivered stage.** Treatment must be defined for: in-flight requests at switch time (completion vs interruption — whichever is documented, it is tested), partial responses already streamed (handled honestly), and persisted conversations created by the agentic path (format/version compatibility with the legacy path, and whether any agent session state is reused — there is none to reuse: session state stays in-request).
- **The acceptance scenario is end-user-visible:** an agentic conversation is started, agentic routing is disabled, and that conversation continues on the legacy path — history renders, citations re-resolve through the stable-id conventions (including the `okf-concept` variant), new turns answer via the legacy pipeline, no loss or corruption.
- **"Rollback is possible" is accountability, not hope.** Every stage rollout record names: selected consumers and capabilities, artifact/configuration versions, activation and rollback procedures, in-flight treatment, rollback triggers with a **named responsible operator** (the person who pulls the trigger when a trigger fires), and rehearsal evidence.
- **No new OPEA coupling at any stage gate.** Each stage-gate review explicitly verifies the agentic path added nothing that makes the deferred OPEA exit harder — the same dependency audit as the OPEA-free gate, plus the explicit review check.
- **"No data changes" is scoped.** Session and audit persistence exist by design; the claim covers authoritative knowledge stores only. Any future stage that changes data shapes requires an explicit recovery procedure in its record.

## Technical Decisions

- **One flag, one routing helper, both entries (AD-9).** The flag follows the `OKF_ENABLED` pattern: compose replicas plus BFF routing. The streaming entry (`initStreamQuery`, `POST /api/queries/stream`) and the non-streaming entry (`createQuery`, `POST /api/queries`) are genuinely separate code paths; the flag branch lives in ONE shared routing helper both call, with a test asserting the two entries cannot disagree. Literal per-entrypoint edits are the half-activated deployment this decision exists to prevent.
- **The BFF leg is test-enforced, not grep-enforced.** The CI dependency gate cannot see the BFF runtime call graph, so the agentic branch's never-targets-chatqna/OPEA-URL guarantee is carried by the routing-helper test (the "AD-1 BFF-leg test").
- **Same-shaped persistence makes rollback free.** The agentic path mints a `queries`-collection document per turn with the same shape as legacy — persistence, analytics, saved-conversation citations and rollback continuity all work without data migrations. The legacy path requires no agent-specific state.
- **The timeout pair is a rehearsal input.** The BFF's upstream timeout on the agent leg must be ≥ the agent-phase deadline plus margin; the pair is documented by the Epic 2 orchestrator work and validated in the V08 rehearsal.
- **V08 rehearsal, re-run per stage.** Routing rollback agentic↔legacy is rehearsed (operations + QA) for every delivered stage, including the BFF-timeout/agent-deadline pair validation; the rehearsal evidence lands in the rollout record. Records live in the repo — canonical home, one record per stage.
- **Venue note.** The compose venue is governed here. The k3s umbrella chart is operator-owned (read-only migration branch): its adoption must carry the same flag semantics.

## Cross-Story Dependencies

- **Story 3.1 depends on Epic 1's story 1.3** (the deployable agent-service the flag gates). The routing helper itself is built by Epic 2's story 2.4 (BFF frame writer); 3.1 proves the two paths cannot disagree and owns the operational flag choreography.
- **Story 3.2 depends on 3.1 and all of Epic 2:** the rollback scenario exercises the agentic artifacts Epic 2 delivered (queries docs, saved messages, citations with the stable-id conventions, in-flight streams with budgets/cancellation).
- **Story 3.3 depends on 3.2** and re-runs per stage; its stage-gate FR-21 check recurs for every later stage too.
- **Downstream:** Epic 4's S4 exit evidence bundle requires this epic's rollback demo; the evaluation harness invokes the same flag to select configurations.
