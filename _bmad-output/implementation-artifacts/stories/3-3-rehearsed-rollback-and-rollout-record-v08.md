---
title: 'Story 3.3 — Rehearsed rollback and rollout record (V08)'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c411b5f085f0aaba779da00fa404a6f2f4c54448'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/agent-budget-deadline-pairs.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1974 acceptance criteria, operator-authored">

## Intent

**Problem:** Stories 3.1/3.2 delivered the routing flag and rollback continuity, but "rollback is possible" is still hope, not accountability: no stage rollout is RECORDED anywhere (no canonical home, no per-stage record naming the responsible operator), the V08 routing-rollback rehearsal has never been run against a real deployment (the BFF-upstream-timeout/agent-deadline pair from `docs/agent-budget-deadline-pairs.md` was only ever validated at unit level), and the stage-gate instrument (`docs/baselines/s3-exit-checklist.md`) lists the OPEA-free structural gate but never states the FR-21 review check explicitly.

**Approach:** Establish the rollout-record canonical home in the repo (`docs/rollouts/`): an index defining the one-record-per-stage rule and carrying the record template; the V08 rehearsal runbook as a re-runnable procedure; and the FIRST filled record for the stage rehearsed here. Execute the V08 rehearsal against the shared k3s dev stack with dedicated rehearsal deployments (own backend + agent-service pods carrying the current umbrella code, wired to the stack's shared legacy services), covering: routing agentic↔legacy in both directions, in-flight treatment at switch time, and the BFF-upstream-timeout/agent-deadline pair validated from the DEPLOYED values. Record the rehearsal evidence in the rollout record. Make the FR-21 check an explicit item of the stage-gate instrument (and run it now for this stage). The venue's known model-leg gap (#2052: no tool-calling flags on the GPU endpoint) is recorded in the evidence per FR-26 — the rehearsal proves ROUTING, pair and rollback mechanics; agent answer quality is #2052's acceptance, not this story's.

**Acceptance criteria (issue #1974, the contract):**

- Given a delivered stage, when it rolls out, then the rollout record names: selected consumers and capabilities, artifact/config versions, activation and rollback procedures, in-flight treatment, rollback triggers with a named responsible operator, and rehearsal evidence.
- And the V08 rehearsal covers routing rollback agentic↔legacy including the BFF-upstream-timeout/agent-deadline pair validation.
- And each stage-gate review explicitly checks FR-21: no new OPEA coupling was added that makes the deferred exit harder.
- And the rehearsal is re-run per stage; the record lives in the repo (canonical home, one record per stage).

## Boundaries & Constraints

**Always:**

- The record structure follows FR-16 verbatim: every record names selected consumers and capabilities, artifact/configuration versions, activation and rollback procedures, in-flight treatment, rollback triggers with a named responsible operator, and rehearsal evidence.
- The named responsible operator is the initiative owner (`jrevillard`, the PRD's `owner` field) — recorded, not defaulted silently; the record states the name explicitly.
- The rehearsal runs against the shared k3s dev stack with DEDICATED rehearsal deployments: own pod names (`v08-rehearsal-*`), images built from this branch's HEAD (`pending-{sha}` tags via a `FORCE_IMAGE_REBUILD=true` pipeline), wired to the stack's shared legacy services (chatqna, retriever, embedding, reranker, translation, ArangoDB, Keycloak). The shared stack's own workloads, env and Flux baseline are NEVER mutated; the rehearsal backend carries the `genieai.io/component=backend` label so the component NetworkPolicies admit its traffic.
- Test data is dedicated and cleaned: a dedicated Keycloak rehearsal user, a dedicated conversation, rehearsal queries docs — all deleted and verified gone after the run.
- ROPC is temporarily enabled on the shared realm's app client to mint the rehearsal token and REVERTED immediately after, with the revert verified (the documented SERVER-TESTING procedure).
- The pair validation reads the DEPLOYED pods' effective values (backend `AGENT_UPSTREAM_TIMEOUT_MS` resolved value, agent-side budget knobs) and checks the invariant against the derivation constants in `agent-frame-writer.js` (`TRANSLATION_RESERVE_MS`, `FINALIZATION_MARGIN_MS`, `DEADLINE_FLOOR_MS`).
- The venue's model-leg gap (#2052) is recorded in the rehearsal evidence with the issue reference — known defects are recorded, never silently become requirements to reproduce (FR-26).
- The FR-21 check is explicit in the stage-gate instrument and is EXECUTED for this stage against the current tree (the `tests/config-validator` OPEA-free gate green + the audit scope named in the evidence).

**Never:**

- No production code changes: no backend/agent-service/frontend source edits, no chart changes, no compose changes, no CI changes. The story's product is records, runbook, gate instrument and executed rehearsal evidence.
- No mutation of the shared stack's declared baseline: no edits to shared Deployments/env, no chart value changes, no Flux state changes; cleanup restores the pre-rehearsal state exactly (nothing of the rehearsal remains).
- No multi-GB image pulls or new cluster namespaces; two Deployments + one Service in the existing `genieai` namespace, within the node's measured headroom (41% CPU / 33% mem at investigation).
- No live rehearsal of a full agent ANSWER: the GPU endpoint's tool-calling gap (#2052, operator-owned venue remediation) makes it unrunnable; the rehearsal routes to the real agent service and records the honest outcome.

## I/O & Edge-Case Matrix

| Scenario                      | Input / State                                                                                                                    | Expected Output / Behavior                                                                                                                                                                                                                                                           | Error Handling                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Agentic direction (flag on)   | `AGENT_ENABLED=1` on the rehearsal backend; question via `POST /api/queries/stream`                                              | request routes to the rehearsal agent service (real orchestrator, real seam stream); queries doc minted with agent metadata; the run's honest outcome recorded (answer, insufficiency or run_error at the model leg per #2052)                                                       | model-leg failure is recorded as venue evidence, not a rehearsal failure              |
| Rollback direction (flag off) | `AGENT_ENABLED=0` rollout restart (the documented switch semantic: a rollback is a process restart); SAME conversation continued | new turn answered via legacy chatqna; history renders via the legacy read path; queries docs same shape (3.2 contracts live)                                                                                                                                                         | N/A                                                                                   |
| Re-activation direction       | `AGENT_ENABLED=1` restart again; next turn                                                                                       | routes to the agent leg again (agentic↔legacy proven both directions)                                                                                                                                                                                                                | N/A                                                                                   |
| In-flight at switch           | stream started, backend pod restarted mid-stream                                                                                 | documented treatment observed and recorded: rolling restart → in-flight completes on its resolved path inside the shutdown window; hard stop → connection close → the 3.2 disconnect treatment (partial-save marker or honest unanswered doc)                                        | whichever variant occurs is recorded with timestamps                                  |
| Pair validation               | deployed pod env of BOTH rehearsal pods                                                                                          | `AGENT_UPSTREAM_TIMEOUT_MS` (effective, reserve-absorbed) ≥ communicated `deadline_ms` + translation reserve + finalization margin; `deadline_ms = timeout − reserves` by the derivation; agent ceiling `min(AGENT_RUN_MAX_WALL_CLOCK_SECONDS, deadline_ms/1000)` stated with values | mismatch aborts the rehearsal (a broken pair is a stage-gate blocker, not a footnote) |
| FR-21 gate check              | current tree + `tests/config-validator` OPEA-free gate                                                                           | gate green; the audit scope (agent-path packages) named in the record; the stage-gate instrument carries the explicit FR-21 item                                                                                                                                                     | any new OPEA coupling blocks the gate                                                 |

</frozen-after-approval>

## Code Map

- `components/gov-chat-backend/services/agent-routing.js` — the flag (`AGENT_ENABLED`, module-load frozen, single-read invariant :20; `agentServiceUrl()` :44) — the switch semantic the rehearsal exercises (flag change = pod restart).
- `components/gov-chat-backend/services/agent-frame-writer.js` — the pair constants (:40-43: `DEFAULT_UPSTREAM_TIMEOUT_MS=3600000`, `TRANSLATION_RESERVE_MS=30000`, `FINALIZATION_MARGIN_MS=5000`, `DEADLINE_FLOOR_MS=1000`), `resolveUpstreamTimeoutMs()` (reserve absorption + warning) and `deriveDeadlineMs()` (:47-87) — the arithmetic the deployed pair validation checks.
- `docs/agent-budget-deadline-pairs.md` — the pair contract (story 2.3, "consumed by V08"): two-level budget ownership, the knob table, the `min()` rule. The rehearsal validates the DEPLOYED values against it.
- `docs/baselines/s3-exit-checklist.md` — the stage-gate instrument pattern (evidence-or-open-check rule); its CI-gates table lists the OPEA-free structural gate without naming FR-21 — this story makes the FR-21 review check explicit.
- `tests/config-validator/__tests__/opea-free-gate.test.js` + `scripts/ci/agent-path-packages.json` — the FR-20/21 dependency audit the FR-21 gate check executes.
- `docs/baselines/v03-deployed-baseline-2026-11-19.md` + `v06-runtime-verification-2026-11-21.md` — version/digest/venue context the record's artifact-versions section cites; V06 records the #2052 tool-calling gap.
- `docs/adr/agentic-003-in-flight-treatment-and-rollback-continuity.md` — the in-flight treatment policy the rehearsal observes (rolling-restart completion window; hard stop → disconnect treatment; honest unanswered doc).
- `components/agent-service/` env surface — budget knobs (fail-closed, REQUIRED: `AGENT_RUN_MAX_*`, `AGENT_TOOL_*`, `AGENT_LANE_*`), model endpoints (`VLLM_ENDPOINT`, `VLLM_API_KEY`, `VLLM_LLM_MODEL_ID`, `VLLM_TRANSLATION_*`, `TEI_EMBEDDING_ENDPOINT`, `TEI_RERANKING_ENDPOINT`), `ARANGO_*`, `OPEA_SSL_SKIP_VERIFY` — the rehearsal deployment's env contract.
- Venue facts (verified live at planning): shared k3s `genieai` namespace; shared backend runs `genie-ai-backend:main` (PRE-agentic code — routing cannot be rehearsed on it, dedicated deployment required); GPU LLM endpoint `https://ai.assembly.govstack.global:444/llm`, model `ibm-granite/granite-4.1-8b`; secrets `vllm-api-key`, `arango-root-secret`, `keycloak-admin-credentials` present; NetworkPolicies select `genieai.io/component` labels — chatqna ingress admits only `component=backend` sources on 8888; node headroom 41% CPU / 33% mem; `tmp/genie-ai-agent-server` newest image is story-2.2-era (`mr-1003-*`) — STALE vs 2.3/2.5/2.10, so fresh images are built from this branch via a `FORCE_IMAGE_REBUILD=true` pipeline (`pending-{sha}` tags; `.build_template` tag logic).
- NEW `docs/rollouts/README.md` — canonical home: the one-record-per-stage rule, the record template (FR-16 fields), the V08 re-run rule, the explicit FR-21 stage-gate item.
- NEW `docs/rollouts/v08-rehearsal-runbook.md` — the re-runnable rehearsal procedure (preflight, pair validation, both routing directions, in-flight switch, evidence capture, cleanup).
- NEW `docs/rollouts/<stage>-rollout.md` — the first filled record (consumers, versions, procedures, in-flight treatment, triggers + named operator, rehearsal evidence).
- `CHANGELOG.md` — `[Unreleased]` entry for the rollout-record home + rehearsal evidence.

## Tasks & Acceptance

**Execution:**

- [x] `docs/rollouts/README.md` — canonical home: index, one-record-per-stage rule, record template (every FR-16 field), FR-21 as an explicit stage-gate review item, V08 re-run rule
- [x] `docs/rollouts/v08-rehearsal-runbook.md` — the deterministic, re-runnable rehearsal procedure with exact commands (preflight, pair validation from deployed env, agentic direction, rollback direction, re-activation, in-flight switch, evidence capture, cleanup + revert verification)
- [x] Rehearsal execution — fresh images built from this branch (tag pipeline 18964 after the FORCE pipeline proved unable to build the agent image — see Implementation Notes), dedicated `v08-rehearsal-backend`/`v08-rehearsal-agent` deployments in `genieai`, dedicated Keycloak user + temporary ROPC (reverted + verified), the five rehearsal phases run and their output captured
- [x] FR-21 gate check executed — `tests/config-validator` OPEA-free gate green on this tree (674 passed, 0 failed), audit scope named, explicit FR-21 item added to the stage-gate instrument (`docs/baselines/s3-exit-checklist.md` gains the explicit review-check row; future gates inherit it from the canonical home)
- [x] `docs/rollouts/v08-rollout.md` — the filled record: consumers and capabilities, artifact/config versions (image digests, model ids, flag values, knob values), activation and rollback procedures (the exact commands), in-flight treatment (observed), rollback triggers with the named responsible operator, rehearsal evidence (transcript excerpts + verdicts + the #2052 venue note)
- [x] `CHANGELOG.md` — `[Unreleased]` entry
- [x] `_bmad-output/implementation-artifacts/stories/3-3-rehearsed-rollback-and-rollout-record-v08.md` + `sprint-status.yaml` — story to `in-review`/row `review` per the sync rule — BMAD bookkeeping

**Acceptance Criteria:**

- Given the canonical home and template, when a stage rolls out, then its record carries every FR-16 field including the named responsible operator and rehearsal evidence — the record structure is in the repo, one record per stage.
- Given the executed V08 rehearsal, when its evidence is read, then routing rollback agentic↔legacy is demonstrated on a real deployment and the BFF-upstream-timeout/agent-deadline pair is validated from the deployed values — with the venue's model-leg gap recorded, not hidden.
- Given the stage-gate instrument, when any stage-gate review runs, then FR-21 is an explicit check item, executed for this stage against the current tree.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- 2026-11-22 (planning): the shared stack's backend image predates the routing code (`genie-ai-backend:main` — the agentic stories live on the umbrella branch, not main), and the newest `tmp/genie-ai-agent-server` image is story-2.2-era — both too old to rehearse with. Fresh images come from a `FORCE_IMAGE_REBUILD=true` pipeline on this branch (`.build_template` emits `pending-{sha}` tags on non-MR pipelines; the FORCE rule precedes the source filters, so a plain branch pipeline builds).
- 2026-11-22 (planning): the rehearsal backend must carry `genieai.io/component=backend` (the component NetworkPolicies select sources by that label — chatqna's ingress admits only `component=backend` pods on 8888). The label brings ingress rules toward my pod too, which is harmless: only the rehearsal itself calls it, through a port-forward.
- 2026-11-22 (planning): ROPC minting follows SERVER-TESTING.md exactly — temporary enable on the app client, token, immediate revert, revert verified. The rehearsal user is dedicated test data, deleted after the run.
- 2026-11-22 (execution, deviation): the planning note's FORCE pipeline does NOT build the agent image — `build:agent-service` (Epic 1 job) carries only tag/MR/default/release rules, no `FORCE_IMAGE_REBUILD` rule, so pipeline 18961/18962 built `build:backend` and never `build:agent-service`. The workflow also blocks plain-branch and API-sourced pipelines (workflow:rules), and both build jobs are `when: never` on `web`. Resolution: a rehearsal TAG on the branch HEAD (`v08-rehearsal-2b7f72aef`) — both jobs carry `if: $CI_COMMIT_TAG`, so one pipeline (18963) builds BOTH images under the same `pending-2b7f72aef` content tag; no code change, no CI file change. The transient pipeline schedule used to attempt the API trigger was created and deleted; both dud pipelines canceled. Runbook Phase 0 records the tag-pipeline mechanism.
- 2026-11-22 (execution, venue correction): the agent pod is labeled `genieai.io/component=agent` — NO NetworkPolicy selects that label (all 14 policies select other component values), so its 8010 ingress from the rehearsal backend stays open and its egress (GPU 444, Arango 8529, doc-repo) is unrestricted. The planning note's concern (a `component=backend` label would close 8010 ingress — the backend netpol admits ingress only on port 3000) is why the agent pod takes a different label.
- 2026-11-22 (execution, venue correction): Keycloak on this venue serves plain HTTP on 8080 under the `/auth` context path (the runbook's first-draft `https://localhost:18080/realms/...` shape 404s); SERVER-TESTING's master-token recipe works with `http://localhost:18080/auth/...`. The runbook carries the corrected shape.
- 2026-11-22 (execution, outcome): the five rehearsal phases all ran and their evidence is recorded in `docs/rollouts/v08-rollout.md`. Pair invariant HOLDS with equality from the deployed values (3600000 = 3565000 + 30000 + 5000; agent ceiling `min(240, 3565)` = 240 s). Agentic↔legacy proven BOTH directions on the same session; re-activation routes back; the in-flight stream under a mid-stream `rollout restart` COMPLETED inside the shutdown window (89 chunks + metadata + done, doc `isAnswered:true`, no `answer_interrupted`) — ADR agentic-003's rolling-restart variant, observed with timestamps. The model-leg 400 (#2052) is recorded as venue evidence per FR-26; answer quality stays #2052's acceptance.
- 2026-11-22 (execution, FINDING — needs a follow-up story): the shipped BFF→agent wire contract is broken on a real deployment. `agentServiceUrl()` returns the bare configured URL and `agent-frame-writer.js` POSTs it bare (pinned by `agent-frame-writer.test.js` with a mocked axios), while the agent service serves `POST /v1/runs` (pinned by its own suite) — both suites green, the hop never joined live until now; the deployed pair 404'd at `POST /`. Rehearsal worked around it at deployment level (path in the env value). A code fix (helper appends the run path, or agent root alias) is REQUIRED before any real k8s/compose activation of the flag — it is a production-code change, out of this story's no-code boundary.
- 2026-11-22 (execution, FINDING — operator item for the chart): the component NetworkPolicy egress list has no agent-port row (8010 absent) and this k3s REJECTS denied flows; the venue's netpol also rejects pod→ClusterIP egress. The rehearsal ran with a deployment-level workaround (agent on 8080 + headless Service); flat compose topologies are unaffected. Chart adoption (`feat/k8s-migration` is read-only) must add the agent egress row.
- 2026-11-22 (execution, cleanup): everything of the rehearsal is verified gone — deployments/services deleted, Keycloak user deleted (0 remaining), ROPC `false` verified, 9 rehearsal docs deleted to 0, port-forwards killed, transient pipeline schedule deleted. The two rehearsal TAGS remain on the remote (pre-receive hook declines tag deletion — protected patterns), recorded in the record's cleanup section; their registry `pending-*` tags age out under the registry cleanup policy.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

- R1 (global round 1, /code-review medium — MIS-TARGETED DIFF, recorded as-is): the reviewer diffed the umbrella branch against main (the whole program's planning artifacts) instead of this branch against its base c411b5f08. All seven findings verified REAL (spot-checked: `epics.md:130` vs the Epic 2 covered list, `FR-19a`/`FR-19b` at `epics.md:649/669`, `prd.md:10` sources_of_truth, `sprint-status.yaml` NOKEY + MM-DD-YYYY dates) but PRE-EXISTING umbrella-branch items — none is introduced by this MR's diff: R1-5/R1-6 sit in sprint-status.yaml (one of the seven changed files) on template lines that predate it (the MR rewrote only `last_updated`'s VALUE, preserving the pre-existing MM-DD-YYYY format), and the other five target files this story never touched. Route: defer (all seven, deferred-work.md). The finding about the archival-commit rule (R1-7) is surfaced to the orchestrator in the worker report. A correctly-targeted global (the MR !1023 diff) follows as round 2.
- R1-1 (epics.md:158 Epic 2 covered list omits FR-19 vs the coverage map) — real, nit, pre-existing — defer.
- R1-2 (epics.md:649/669 invents FR-19a/FR-19b sub-ids undefined anywhere) — real, nit, pre-existing — defer.
- R1-3 (routing prd.md sources_of_truth lacks epics/sprint_status pointers) — real, nit, pre-existing — defer.
- R1-4 (living PRD OQ-3 still open while D01 acted) — real, nit, pre-existing — defer.
- R1-5 (sprint-status.yaml project_key: NOKEY template placeholder) — real, nit, pre-existing (line predates this diff) — defer.
- R1-6 (sprint-status.yaml MM-DD-YYYY dates vs ISO everywhere else) — real, nit, pre-existing — defer.
- R1-7 (admin-logs archival commit cc4238fcc landed on the feature branch, violating POST-PRD-ARCHIVAL's "archive on main") — real, nit, pre-existing history — defer; operator/orchestrator remedy (cherry-pick to main), surfaced in the worker report.

- R2 (global round 2, /code-review medium on the MR !1023 diff — the correctly-targeted round): 8 findings on the runbook/record, all verified real against the files.
- R2-1 (runbook:467 cleanup deletes svc/v08-rehearsal-agent but Phase 2 creates v08-rehearsal-agent-hl) — verified real (grep: 174 vs 467) — important — patch (the -hl name).
- R2-2 (runbook:473 cleanup DELETEs users/$UID — read-only shell builtin, never assigned; user survives, the length check then fails every re-run) — verified real — important — patch (REHEARSAL_USER_ID assignment + use).
- R2-3 (runbook:252 kubectl rollout status with TWO resources errors — kubectl takes exactly one) — verified real — important — patch (two sequential invocations).
- R2-4 (runbook:80 tag shape v08-rehearsal-* is the protected v* class AND contradicts the record: the working tag was rehearsal-v08-2b7f72aef, deletion declined by the pre-receive hook, promise "deleted after superseded" false) — verified real (record §2 + cleanup section) — important — patch (recorded shape rehearsal-v08-*, deletion promise replaced by the recorded hook reality).
- R2-5 (runbook:440 phase 5e lists only two outcomes; the observed rehearsal is the third — completed in-window, isAnswered true, no marker) — verified real — nit — patch (third variant added).
- R2-6 (runbook:286 the printed pair rule is an identity; the abort can never fire) — verified real — nit — patch (state the checks that can fail: absorption warning, ceiling-vs-deadline binding, constants match).
- R2-7 (runbook:109 preflight abort threshold not enforced; pod-health count unconsumed) — verified real — nit — patch (explicit awk threshold + abort on unhealthy count).
- R2-8 (sprint-status last_updated rewritten in the legacy MM-DD-YYYY format; migrate to ISO while touching) — real, nit, convention already deferred as R1-6 — reject the migration here (a one-field half-migration of a file-wide convention adds inconsistency, fixes nothing this story owns; R1-6's defer owns the convention change).

## Verification

**Commands:**

- The rehearsal phases (runbook) — expected: pair invariant holds on deployed values; agentic direction routes to the agent service; rollback direction serves the continuation via chatqna; re-activation routes back; in-flight switch matches the documented treatment; all captured in the record.
- `cd tests/config-validator && npm test` — expected: green (the OPEA-free gate over the agent-path packages, FR-21's audit scope)
- `ls docs/rollouts/` — expected: README (home+template), the runbook, one filled record
- Cleanup verification — expected: `kubectl -n genieai get deploy,svc | grep v08-rehearsal` empty; rehearsal Keycloak user gone; ROPC flag reverted (client JSON reads `directAccessGrantsEnabled: false`); rehearsal ArangoDB docs deleted
