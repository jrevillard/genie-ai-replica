---
title: 'Land the CSR batch (feat/okf-chat-source-w1) as one MR to main'
type: 'feature'
created: '2026-11-07'
status: 'in-progress'
baseline_commit: '569a4f8ee9d6b86db18a18fbc2506444cef93f6b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/prds/prd-okf-chat-source-resolution-2026-11-04/epics.md'
  - '_bmad-output/specs/spec-okf-chat-source-resolution/remediation-plan.md'
  - '_bmad-output/implementation-artifacts/csr-w1-w3-chat-sources-devlog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The completed chat-source-resolution engineering (CAP-1/2/3 retriever identity + concept route + citation card, W4 restricted-serve, W5 origin links — 28 commits, live-verified W1–W3 smoke 7/7) sits unmerged on `feat/okf-chat-source-w1`, so `main` still 404s when a citizen opens an OKF citation (#1598) and the PRD's FRs are unmet in the shipped branch.

**Approach:** Merge the batch into a fresh `feat/csr-batch-to-main` (off origin/main) as ONE merge commit — resolving the 8 known conflicts per the recorded rulings — then run the full gate set (suites, coverage, lint, i18n parity, smoke harness live, security + code review) and open one MR to main. David merges.

## Boundaries & Constraints

**Always:**
- The batch's 28 commits land with their history intact (merge commit, no rebase of the source branch, no force-push to `feat/okf-chat-source-w1`).
- !791's shipped fixes stay functional in the merged result (the OKF badge via `okfCitation.js`, the `answer-sources-list` test handle, the shared fetch-guard predicate) — the batch supersedes structure, !791's fixes are additive.
- W8's deletion_reason (this week's main) is untouched by the resolution of `repository-controller.js` — both sides' behaviors compose (ceiling field on the steward path, card projection for citizens).
- Every gate green before the MR is offered: frontend + okf-server + doc-repo + overlay suites, coverage ≥ floors, i18n ×14 parity, ruff/eslint/prettier, `run-smoke-chat-sources.mjs` live ALL PASS.

**Never:**
- No new feature work inside the merge (conflict resolutions compose existing behavior only).
- No cherry-picking pieces of the batch (David's 2026-11-07 ruling: one MR).
- No merge to main by the agent — GO handover only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| OKF citation card | query citing a concept | title-first card, OKF badge, Open/Download work via okf-server; origin rows (W5) under the card | concept route 404s identically for fenced/missing |
| Legacy document citation | pre-batch persisted conversation | byte-identical shape; doc-repo metadata fetch as before; graftOkfIdentity re-hydration | fetch failure degrades to extension badge |
| Restricted concept | citizen + restricted repo | serving-read verdict (publish+ingested) gates; card projection (no steward fields) | shared 404 envelope, no audit row |
| Deleted source doc | repository whose source file is gone | W8 gate skip (main) unaffected by batch | non-404 still fails closed |

</frozen-after-approval>

## Code Map

- `.claude/worktrees/csr-batch` (branch `feat/csr-batch-to-main`) — the merge work site; merge staged uncommitted, 0 open conflicts.
- `components/gov-chat-frontend/src/components/ChatBotComponent.vue` — RESOLVED: batch's template-fragment card + origins (W5), main's `answer-sources-list` handle restored; union import (batch openers + `okfCitation.js`).
- `components/gov-chat-frontend/src/components/RightSideBarComponent.vue` — RESOLVED: same union import.
- `components/gov-chat-frontend/src/store/modules/conversation.js` — RESOLVED: batch `translateSources` shape (source field at :275 carries the marker; MD type); fetch guard uses the SHARED `isOkfConceptSource` predicate; batch title resolver dispatch retained.
- `components/okf-server/controllers/repository-controller.js` — RESOLVED (pending commit): steward gets full meta + `max_doc_chars` (ceiling), citizen gets `projectConceptCard` — composition of both sides.
- `genie-ai-overlay/tests/test_retriever.py` — RESOLVED: import-list union (`ARANGO_TRAVERSAL_QUERY` + `OKF_CONCEPTS_META_COLLECTION`).
- `_bmad-output/prds/...` + `.memlog.md` — RESOLVED: HEAD for epics/prd (W8 grew to 3 stories; #1439 the real mobile issue), batch superset for memlog, ours for workplan (main's copy supersedes the pre-U snapshot).
- `components/okf-server/services/concept-meta-service.js`, `lifecycle-service.js`, `producer-service.js`, `routes/okf-routes.js`, `document-repository` middleware/controller, `chatqna`/`retriever` py — batch-only changes, merged clean.
- `data/okf/smoke-test/run-smoke-chat-sources.mjs` — the live gate harness (W1–W3, 7 checks).

## Tasks & Acceptance

**Execution:**
- [ ] Merge commit — commit the staged merge with the resolution record in the message.
- [ ] Gates — full suites per touched component (frontend, okf-server, doc-repo, overlay pytest for chatqna/retriever), coverage vs floors, i18n parity test, lint/format.
- [ ] Security review + code review — subagent pass over the merge diff vs origin/main (conflict compositions esp.).
- [ ] Live — sync the local build, run `run-smoke-chat-sources.mjs` expecting ALL PASS (7/7) against the merged stack.
- [ ] MR — one MR to main, body: closes #1598 (verify #1409/#1410/#1411/#1437/#1439/#1514 states individually), resolution record, gate evidence. GO handover.

**Acceptance Criteria:**
- Given the merged stack on the local build, when a query cites an OKF concept, then the card renders title-first with the OKF badge and smoke exits ALL PASS.
- Given main's !791 badge/fixture, when the merged frontend suite runs, then no regression (badge assertions + `answer-sources-list` handle intact).
- Given the staged MR, when CI runs, then all stages green and coverage ≥ each touched component's floor.

## Implementation Notes

- Trial merge surfaced exactly 9 conflicts (5 code files, 4 docs); all resolved in-place, staged, uncommitted.
- Batch docs corrections folded in: `#1439` (batch had typoed `#1441`), story totals back to HEAD's 23 (W8 = 3 slices).
- WORKFLOW SCOPING (orchestrator, 2026-11-07): the merge is ALREADY STAGED in the worktree (all conflicts resolved — see Code Map); the implementing agent's first task is to COMMIT it. The bmad-build step-03 rule forbids push/remote ops during implementation: the **MR task runs AFTER review** (step-04), driven by the orchestrator — the implementing agent does NOT create the MR and does NOT push. The security-review and code-review tasks likewise run at step-04 on the committed diff; the implementing agent runs the test/lint/live gates only.

## Verification

**Commands:**
- `cd components/gov-chat-frontend && npx jest` -- expected: all green incl. conversation/ChatBot/RightSideBar suites
- `cd components/okf-server && npx jest` -- expected: all green
- `cd components/document-repository && npm test` -- expected: 600+ green (+8 restricted-serve)
- `cd genie-ai-overlay && pytest tests/test_chatqna.py tests/test_retriever.py` -- expected: green
- `node data/okf/smoke-test/run-smoke-chat-sources.mjs` (in-container, local build) -- expected: 7/7 ALL PASS

**Manual checks (if no CLI):**
- MR diff shows the merge commit only + no stray conflict markers (`grep -rn '^<<<<<<<' <changed files>`).
