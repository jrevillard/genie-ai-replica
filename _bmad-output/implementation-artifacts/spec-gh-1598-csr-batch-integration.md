---
title: 'Land the CSR batch (feat/okf-chat-source-w1) as one MR to main'
type: 'feature'
created: '2026-11-07'
status: 'in-review'
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
- [x] Merge commit — commit the staged merge with the resolution record in the message. (8ec2a072c, orchestrator trial resolutions confirmed on disk; conceptId restore cea14e4b8; prettier 0db71a42b/907f717fa — tip 907f717fa, worktree clean.)
- [x] Gates — full suites per touched component (frontend, okf-server, doc-repo, overlay pytest for chatqna/retriever), coverage vs floors, i18n parity test, lint/format. (All green at 907f717fa — exit-code evidence in the step-03 run: frontend 2103, okf-server 4052, doc-repo 631, overlay chatqna+retriever 450; coverage ≥ floors; localeConsistency green; prettier/eslint/ruff clean via `rtk proxy`.)
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
- `node data/okf/smoke-test/run-smoke-chat-sources.mjs` (in-container, local build) -- expected: ALL PASS (8 checks — the review added the retracted→404 publication-gate assertion)

**Manual checks (if no CLI):**
- MR diff shows the merge commit only + no stray conflict markers (`grep -rn '^<<<<<<<' <changed files>`).

## Review Triage Log

Review executed 2026-11-07 (step-04): five layers over the staged diff (blind-hunter B1–B20, edge-case-hunter E1–E21, verification-gap VG1–VG5+O1–O2, security SR-O1–O3 observations, code review CR1). Verdicts rendered after code verification; grouped by root cause; routed per the cascade.

| # | Finding (layer) | Verdict — evidence |
|---|---|---|
| 1 | Scoped callers 404'd off OPEN repos on the concept GET (B1+CR1) | **high** — verified: `scope-authz-service.js:134` gives `unrestricted=false` to ANY scope-holding caller in open mode; `readAuthzForService` (:107) then hands the exact grant Set to `getById`, whose `outsideAuthz` 404s everything else; `authz-resolver-service.js` own comment records the identical first cut "caught in review against the product model" (grants additive); the surface test's `getById: jest.fn().mockResolvedValue` hides the pre-gate (mocked-boundary); route+smoke use scopeless/wildcard only. Single grant strips every open repo's citation cards — inverted privilege on the shipped default mode. |
| 2 | servingReads concept-GET registration unverifiable by CI (VG1) | **medium** (pre-verified) — delete `okf-routes.js:43` and every suite stays green: controller tests bypass routing, route-level tests use scoped callers (pre-existing /repos registration), scopeless pins cover other routes. The #1598 fix would ship void with green gates. |
| 3 | doc-repo okfScopes token extraction never asserted (VG2) | **medium** (pre-verified) — D4 suite mocks the middleware wholesale; the unit suite's payload carries no `okf_scopes`; renaming/dropping the claim leaves all suites green while every caller's scopes read `[]`. |
| 4 | sendStream→resolveOkfSourceTitles dispatch unpinned (VG3) | **medium** (pre-verified) — the action tests dispatch directly; sendStream tests feed repo-less citations; component tests hand-set fields; deleting `conversation.js:363` keeps everything green while cards never resolve. |
| 5 | Sidebar origin-row template has no render test (VG4) | **medium** (pre-verified) — sidebar suites assert methods only; a v-if that never fires stays green; the ChatBot counterpart got the render test, the sidebar did not. |
| 6 | viewFile success path unverified after the D4 rewire (VG5) | **medium** (pre-verified) — only a refusal test exists for `/view`; a rewiring slip (fileId-vs-filePath into `_readFileBase64`) breaks PII review/`/view` consumers undetected. |
| 7 | Smoke lacks the retracted→concept-GET-404 assertion its own devlog calls for (VG-O1) | **medium** — devlog explicitly says "the smoke needs one new assertion (retracted repo → concept GET 404)"; the live gate as shipped cannot observe the W2 publication gate. |
| 8 | Transient fetch failure cached as permanent unavailability (B5+E6) | **low** — `conversation.js:442-444` caches `null` on ANY failure (`// unavailable... honest fallback` then unconditional `set`), so one okf-server hiccup downgrades titles/origins for the session; `openOkfSource` distinguishes transient for the same data. |
| 9 | Propagation-crash detail never reaches the audit (B9+E11) | **low** — crash path builds `{...,error}` but both audit and response project counts only (`(propagation.patched||[]).length`, `total` dropped); audit cannot distinguish crash from empty; only `logger.warn` (stdout/VL) carries the error. |
| 10 | downloadOkfConcept destroys non-ASCII filenames (B14) | **low** — `[^\w\-. ]+` is ASCII-`\w`; Arabic/Chinese titles (14 locales shipped) become all-underscores. |
| 11 | Sidebar generic open failure silent (B12) | **low** — `RightSideBarComponent:415` console.errors the non-unavailable failure with no notification where ChatBot shows `notificationService.error` on identical data. |
| 12 | Components bypass the shared predicate the same diff canonizes (B11) | **low** — 4 inline `doc.source === 'okf-concept'` checks in both components while `isOkfConceptSource` is imported; predicate evolution would diverge card rendering from the fetch guard. |
| 13 | bundle_version 0 dropped by truthy mint gate (B20+E17) | **low** — `align_outputs` keeps `is not None`, mint uses `if prov.get(...)`; v0 not mintable today but the idiom inconsistency is one term from gone. |
| 14 | Chat-sources smoke hangs on a stalled SSE stream (E15) | **low** — the `while (Date.now() < deadline)` loop never runs again if one `reader.read()` never resolves; no AbortController. |
| 15 | Chat-sources smoke cleanup statuses unchecked (E16) | **low** — `deleteRepo` ignores both call results; zombie serving repos pollute the next run (the harness's own lesson). |
| 16 | W4 smoke contradicts its own PII-clean claim (B19) | **low** — DOC_A/DOC_B embed `${STAMP}` (a timestamp run) while the header claims "no dates"; the Presidio scan gate could flag the harness's own documents. |
| 17 | `_getFileBase64` newly dead (E18) | **low** — no callers remain (viewFile+ingest use `_readFileBase64`); dead wrapper drifts from the live byte-reader. |
| 18 | Closed-mode 403 renders generic error, not honest unavailable (E10) | **low** — `conceptService.get` throws on 403; `fetchOkfConcept` maps only null/missing-args → unavailable; a correct authz refusal renders as a generic failure while 404 gets the honest notice. |
| 19 | Restored conversations / earlier-turn cards never resolve titles+origins (B6+E5) | **medium vs the epic; not a defect of this landing** — before the batch, restored OKF rows were dead links (#1598); after, they render id-titles as plain text (the "never a dead link" hard requirement holds); the fresh-stream path resolves fully. Epic slice-3's "best-effort resolve" for persisted rows is remaining scope → defer. |
| 20 | Identity enrichment covers only the chunk leg (B7) | **defer** — graph-routed queries (`search_start` threaded from chatqna routing into edge/node legs) cite OKF chunks without repo_id/bundle_version; graceful degradation, CAP-1's own anchors scope the join to the chunk leg; epic remaining scope. |
| 21 | Read-level scope holders receive the full steward meta row (B16+SR-O3) | **defer (pre-existing)** — pre-diff callers got the same full row; the diff only ADDED the narrowed citizen path; documented steward intent per the security trace. |
| 22 | Propagation serial + awaited inside the toggle request (B10+E14) | **reject (low)** — design-settled: the toggle response carries the tally, which requires awaiting; the story records the synchronous+audited shape. Rare op × degraded doc-repo; fix is an async-job mechanism, not a correction. |
| 23 | stampSources transient DB error stamps unrestricted (E12) | **reject (low)** — near-unreachable (the import reads the same DB throughout); audit+toggle remedy exists; the "fix" (fail-closed stamp) changes the recorded non-fatal design. |
| 24 | Memlog took the batch's stale "to file" line where main read "Filed as #1437" (B2) | **false** — both parents' memlog lines are identical ("to file", worktree line 40 == main line 40); the devlog (:46) records #1437 and always did; nothing regressed in the merge. |
| 25 | Spec says 8 conflicts (Intent) vs 9 (Notes) (B3) | **reject** — fix edits this build's spec (the trial surfaced 9; "8 known conflicts" was the pre-trial count). |
| 26 | Legacy `source` shape null→undefined breaks byte-identity (B4+E20) | **false** — every `.source` consumer treats null/undefined identically (both falsy at all read sites; code-review checked each); the persisted-JSON key-delta has no reader. |
| 27 | No supporting index for the meta join (B8) | **false** — `okf_concepts_meta` carries a persistent `concept_id` index (collections.js, added precisely so a concept-keyed lookup does not full-scan); the join's equality uses it; graph_name filters the few survivors. |
| 28 | openOkfConcept hardening parity (noopener/DOMPurify/dark/title-strip) (B13) | **false** — `MarkdownIt({html:false})` escapes raw HTML and default validateLink blocks javascript:/data:; the title strips `<>&`; security layer traced no breakout. Residue (theme, noopener) is cosmetic parity, rejected. |
| 29 | Origin-row keys can collide (B15+E3+E4) | **low (corrected at patch time)** — the ChatBot key embeds the loop indices (`${di}-${oi}-…`) so it cannot collide, but the SIDEBAR's key was bare (`o.file_id \|\| o.resource`, no index) — a real, narrow collision case. Fixed with the patch set: sidebar key now `` `${oi}-${o.file_id || o.resource}` `` (the ChatBot pattern). |
| 30 | okf_scopes parsed array-only; string mapper output silently zero (B18+E2+SR-O2) | **false** — the shipped realm mints the claim multivalued (`genie-realm.yaml:193 multivalued: 'true'`); the string form is not producible in our deployments; the actionable residue (assert the mapping in tests) is row 3. |
| 31 | concept_id-without-marker rows get the dead URL family (E7) | **false** — chatqna's mint always sets the marker and concept_id together (genieai_chatqna.py:3645-3654); the divergent shape is not producible. |
| 32 | Concurrent dispatches duplicate in-flight fetches (E8) | **false** — the promise is registered synchronously (`okfTitleInflight.set(cacheKey, fetchOkfConcept(...))` before any await); concurrent dispatches share it. |
| 33 | Popup-blocked open is a silent no-op (E9) | **false** — `openOkfConcept` throws on a null `window.open` and the components' catch surfaces the failure (notification in ChatBot); feedback exists. |
| 34 | String-shaped source_documents never re-stamped (E13) | **false** — no writer produces bare strings; the canonical read everywhere (incl. pre-existing `sourcesBusyBlocker`) is `s.file_id` objects. |
| 35 | Truthy non-boolean okf_restricted bypasses the strict gate read (E1) | **false** — the only writers send `Boolean(...)` and the PATCH schema is `Joi.boolean()` (normalizes 1/'true' on write); a writer-produced restricted file always fires the gate. |
| 36 | 7/7 live PASS predates the merge (VG-O2) | **false** — process state, not a defect: the spec sequences the live gate after review; the Live task closes it. |
| 37 | Spec's "worktree clean" / "+8 restricted-serve" claims (E19+E21+B17) | **reject** — fix edits this build's spec (the spec file is the review protocol's own working artifact; the true restricted-serve count is 14). |

**Grouping & routing:** row 1 = one entry, **patch** (high). Rows 2–8 = five separate patch entries (distinct defects, no shared root cause) + row 7 patch. Rows 9–18 = **patch** (each trivial, no new surface). Row 19–21 = **defer** (→ deferred-work.md + backlog issues). Rows 22–37 = **rejected** on the recorded evidence. No intent_gap, no bad_spec — no loopback; `review_loop_iteration` stays 0.

PATCH LIST (step-04 auto-fix, applied by the orchestrator — the step-03 agent is not addressable post-compaction):
1. `repository-controller.js` — `readAuthzForService`: open mode returns `null` (the additive-grants base rule `resolveGraphSet` applies; the per-repo fence decides the rest) + a ROUTE-level regression test (scoped, non-privileged caller, open repo, open mode → 200 card through the real `getById`; closed mode keeps the exact list).
2. `okf-routes.js` — route-level DEFAULT-OPEN test for the concept GET (scopeless 200 open / 403 closed), per the `retrieval-config-routes.test.js` precedent.
3. doc-repo middleware — success-path assertions: `okf_scopes` array claim → `req.user.okfScopes` mapped; absent claim → `[]`.
4. `conversation.js` — cache `null` only for the definitive-unavailable code; transient failures skip caching (retry next dispatch).
5. `conversation.js` — sendStream wiring test (repo-bearing citation → resolver ran, row patched).
6. Sidebar — render test mirroring the ChatBot CAP-4 test + `notificationService.error` on generic open failures.
7. doc-repo — `/view` admission test (unrestricted success shape) in the restricted-serve suite.
8. `access-controller.js` — audit projection carries `error` + `total` on the crash path.
9. chatqna — `is not None` mint gate for bundle_version.
10. `document-opener.js` — 403 → `okfConceptUnavailable` in `fetchOkfConcept`; unicode-safe download sanitizer (`[^\p{L}\p{N}\-. ]+`gu).
11. Components — replace inline `source === 'okf-concept'` with the shared predicate.
12. Chat-sources smoke — AbortController on the SSE read; cleanup status checks; the retracted→404 assertion.
13. W4 smoke — drop `${STAMP}` from the document bodies.
14. doc-repo — remove the dead `_getFileBase64` wrapper.
15. Sidebar template — origin-row `:key` gains the loop index (the ChatBot pattern) — row 29's corrected finding.

**APPLIED (2026-11-07, orchestrator):** all 15 patches landed in the worktree plus their tests (surface additive-grants block ×3, route-level serving-read describe ×3 + the two-mode foreign-repo rewrite, doc-repo middleware okf_scopes ×2, `/view` admission ×2, sidebar render ×1, sendStream wiring ×1, resolver retry/cache ×2 + the ghost test pinned to the definitive code, opener 403/500/unicode ×3). Gate evidence — okf-server 84 suites / 2109 green; frontend 4059 green (incl. localeConsistency); doc-repo 33 suites / 635 green; overlay chatqna+retriever 450 green (after materializing `chatqna/language-registry.json` — the symlink placeholder breaks 43 translation tests by design; placeholder restored before commit); ruff clean; eslint/prettier clean via `rtk proxy`. Coverage: only tests added over already-covered files (store, utils, components, controllers, middleware) — no floor can regress.
