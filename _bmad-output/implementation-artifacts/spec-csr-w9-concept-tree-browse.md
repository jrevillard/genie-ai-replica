---
title: 'W9 — concept tree browse: paginated tree index + citizen modal viewer'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b2bcbb5918ddd6b4ed0aae0bbbe149714adebecb'
context:
  - '_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A chat citation is a dead end — the citizen can read one concept but cannot walk the repository it came from, so the knowledge base stays invisible behind a single card (#1410-family; EPIC-9/W9 of the chat-source initiative).

**Approach:** Add a paginated, authz-gated tree-index endpoint (id + title + author links per concept) on the serving-read surface, and a citizen-facing modal browser — entered from a "browse" affordance on working citation cards in BOTH chat surfaces — that opens at the cited concept and fetches each concept's rendered markdown on demand through the existing CAP-2 route. A story-time UX design pass (D8) owns the in-dialog information architecture before the modal is built.

## Boundaries & Constraints

**Always:**
- Every hop authorizes: the index is refused for fenced repos (same 404 anti-enumeration envelope + publication gate as the concept route), and every per-concept content fetch goes through the CAP-2 route's per-request authz.
- The index payload stays bounded: offset/limit pagination reusing the `listConceptsMeta` contract; the index carries only `concept_id`, `title`, and outgoing **author** links; parser-derived links are reached per-concept on demand, never in the index.
- The story-time `create-ux-design` pass runs BEFORE the modal is built; the dialog uses DS primitives (DsDialog/DsTable/DsPill); the entry affordance renders only on working OKF citations, in BOTH surfaces (card grid + right sidebar).
- New UI strings ship in all 14 locales, key-identical; UI copy states current-state semantics (browse shows what is indexed NOW, not the cited version).
- The new route gets an OTel span; all touched components keep their coverage floors; Playwright handles use the component's own `data-testid`/`data-test-id` spelling.

**Never:**
- No zip extraction, no version-pinned views (`bundle_version` stays provenance identity), no new cache layer or env var, no gateway change, no steward tooling changes, no legacy chat-path changes, mobile untouched.
- No full-corpus payloads (the whole 6k-concept index must never ship in one response); no traversal of raw parser edges (483k rows on Bali) for the index.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Browse entry | working OKF citation card, either surface | browse affordance renders; opens the modal at the cited concept | no affordance on non-OKF/legacy cards |
| Tree index page | `?limit=200&offset=400` on a 6k repo | `{total, offset, limit, concepts:[{concept_id,title,links}]}` ≤ bound | out-of-range offset → empty page, total still true |
| Fenced repo index | non-granted caller + restricted repo | 404 anti-enumeration, identical envelope to the concept route | no audit row (lifecycle traffic) |
| Non-serving repo index | draft/retracted repo | publication-gate refusal (same predicate as the concept GET) | N/A |
| Per-hop fetch | concept content in the viewer | CAP-2 GET renders markdown client-side (sanitized) | fenced/gone → honest unavailable, never a dead link |
| Scale bound | quran-core-en (6352 concepts) | full index assembles in ≤ 32 pages of 200; no payload exceeds the bound | test-pinned |

</frozen-after-approval>

## Code Map

- `components/okf-server/services/concept-meta-service.js` — reuse `listConceptsMeta`'s offset/limit contract (:455) and KEEP projection (:463); ADD a paginated tree query joining per-concept author edges (`_LINKS_TO`, `source=='author'`, entity-key join via the safeKey scheme).
- `components/okf-server/services/edge-service.js` — edge shapes: author edges carry `from_concept_id`/`to_concept_id`/`source:'author'` (:92 writer); graph naming via `graph-lifecycle-service.js` `versionedGraphName` (:77) / `graphNameForRepo` (edge-service :38) — never invent `OKF_${repo_id}`.
- `components/okf-server/routes/okf-routes.js` — mount the tree index on the `servingReads` sub-router (the default-open structural marker, same as the concept GET at :43).
- `components/okf-server/controllers/repository-controller.js` — new `getConceptTree` handler composing the SAME fence: `readAuthzForService` (additive, open mode → null) + `assertRepoReadableByCaller` + publication gate; OTel span.
- `components/gov-chat-frontend/src/components/ds/` — DsDialog (preferred wrapper, actions→`action(key)`), DsTable, DsPill; house modal pattern: `components/okf/editor/LogsDialog.vue`.
- `components/gov-chat-frontend/src/utils/document-opener.js` — reuse `fetchOkfConcept` (:40) / `openOkfConcept` (:71) / `downloadOkfConcept`; the viewer renders markdown client-side via the `OkfMarkdownEditor.vue` MarkdownIt+DOMPurify pipeline (:478) — no server rendering endpoint exists or is wanted.
- `components/gov-chat-frontend/src/components/ChatBotComponent.vue` + `RightSideBarComponent.vue` — the origin-row/card blocks (:207 / :59) where the browse affordance attaches; shared predicate `isOkfConceptSource`.
- `components/gov-chat-frontend/src/store/modules/okf.js` — reuse `fetchConcepts`' pagination guards (:794) as the pattern for progressive index assembly.

## Tasks & Acceptance

**Execution:**
- [x] UX design pass FIRST — run `bmad-ux` (D8) for the modal viewer's information architecture (tree vs progressive list, mobile behaviour, entry-affordance placement); record the design doc before any modal code. *(Recorded at `_bmad-output/implementation-artifacts/ux-csr-w9-concept-browser.md` — the dispatch had no bmad-ux agent skill, so the D8 IA decisions were authored and recorded directly per the epic's frame: progressive alphabetical LIST (author edges are sparse; the flat list is what makes every concept reachable), two panes desktop / stacked with Back-to-list on narrow, sibling-row affordances in both surfaces, current-state notice.)*
- [x] `components/okf-server/services/concept-meta-service.js` — paginated tree query (concepts + author links per page) + unit tests (shape, bound, empty repo, links join).
- [x] `components/okf-server/controllers/repository-controller.js` + `routes/okf-routes.js` — `getConceptTree` handler + servingReads mount; fence/publication composition tests (surface + route-level DEFAULT-OPEN, per the CAP-2 precedents).
- [x] Scale test — quran-scale (6k) fixture pinning the page bound and total-corpus-never-in-one-payload. *(32 pages of 200 pinned in `concept-tree.test.js`, plus a smoke-leg pagination walk.)*
- [x] `components/gov-chat-frontend/src/components/okf/ConceptBrowserDialog.vue` (new) — DsDialog viewer per the UX pass: progressive tree/list, per-hop markdown fetch via CAP-2, download verb, current-state copy.
- [x] `ChatBotComponent.vue` + `RightSideBarComponent.vue` — browse affordance on working OKF citations in both surfaces; render tests mirroring the CAP-4 precedents.
- [x] `store/modules/okf.js` — browser state + paginated assembly with stale-guards; `services/conceptService.js` — `getConceptTree` API call.
- [x] i18n keys ×14 locales (`localeConsistency` green); never `okf.labErrors.*`.
- [x] Extend `data/okf/smoke-test/run-smoke-chat-sources.mjs` — a browse-leg check (index pages + one per-hop fetch on the live stack) + live run ALL PASS. *(Script extended + syntax-checked; the live proof ran as the scoped W9 probe below — see Spec Change Log: the full smoke's chat leg needs the local build synced to this branch, which is the operator's tooling-gated step.)*

**Acceptance Criteria:**
- Given a working OKF citation, when the citizen clicks browse from either surface, then the modal opens at that concept and every concept in the repo is reachable by walking, each hop loading authorized markdown.
- Given a restricted repo, when a non-granted caller requests the index or any hop, then refusal is identical to the concept route (404, no content, no dead affordances).
- Given the 6k-concept repo, when the index is fully assembled, then no single response exceeded the page bound (test-pinned), and the viewer stays responsive.
- Given a legacy/non-OKF citation, then no browse affordance renders anywhere.

## Implementation Notes

- The tree index derives the graph name from the EDGE WRITER's own authority (`edge-service.graphNameForRepo`, now exported) — reader and writer can never disagree about which `_LINKS_TO` holds the author edges. A repo whose graph was never drained (steward on a draft) degrades to `links: []` — the walk stays content-complete through the list.
- The AQL joins on the edge's plain `from_concept_id` field (the writer stores it on every edge) filtered by `source == 'author'` — the parser-edge set (483k rows on Bali) is never scanned.
- The frontend assembles the index through the `fetchConcepts` stale-guard pattern (generation counter + repo-identity backstop; pages of 200, sequential, per-page commits); the dialog renders a 100-row window with "Show more" so a 6k index stays in memory, not in the DOM.
- Per-hop content rides `fetchOkfConcept` (the shared OKF_CONCEPT_UNAVAILABLE mapping — 403/404/gone all land in the honest unavailable arm) and renders via the `OkfMarkdownEditor` MarkdownIt+DOMPurify recipe (html allowed, sanitized, html profile).
- One dialog instance lives in `ChatBotComponent` and serves BOTH entry surfaces; the sidebar only emits `browse-document`.

## Spec Change Log

- 2026-11-08 (implementation): the story-time `bmad-ux` agent skill was not available in this dispatch — the D8 information-architecture pass was authored and recorded directly as `_bmad-output/implementation-artifacts/ux-csr-w9-concept-browser.md` (per the epic's D8 frame: modal surface already resolved at planning; list-vs-tree, mobile behaviour and affordance placement decided there before any modal code). The `getConceptTree` API call went to `conceptService.js` (the spec allowed either home).
- 2026-11-08 (verification): the committed smoke's chat leg requires the local build synced to this branch (the running `main` containers predate the route). The live proof ran as a scoped W9 probe against the running stack — writes through Kong (the container's PII sidecar + drain), every W9 READ leg against the worktree server on :3002 serving the same database: **7/7 PASS** (paginated scopeless walk 3 pages of ≤1, per-hop CAP-2 fetch, publication gate on retract, restricted fence on index + hop, wildcard admin read, cleanup). The extended smoke script is syntax-checked and ready for the post-sync live run.
- 2026-11-08 (review r0): three-layer review (blind-hunter 18 findings, edge-case 5, verification-gap 2+2) — every claim verified against code before verdict. 9 patched (commit c52c7bd: hop-race guard, close cancels the walk, silent expected-refusal lookups, canBrowseSource + isServingRepo single definitions, bare `.exists()`, filtered count, real ChatBot composition tests, one test rename), 2 deferred (#1643 epic-context parser-edge line, #1644 st-locale noun mix), 11 refuted on evidence (house idioms, test-pinned invariants, instrument artifacts). No intent_gap, no bad_spec — no loopback. Suites re-run green after patches: okf-server 2130/2130, frontend 4099/4099.
- 2026-11-08 (live gate): local build synced to the branch (sync tooling `--merge-prefer-target`, rebuild `frontend okf-server`), Kong restarted after the recreate (stale upstream IP), then the FULL smoke: **12 passed, 0 failed** — including [2.5] the paginated walk (2 pages of ≤1, never one payload), the RESTRICTED-tree 404 fence, the per-hop CAP-2 fetch, and [3.5] the retracted-tree publication-gate 404. verify-local-build.sh 47 pass / 0 fail after the rebuild.

## Review Triage Log

- 2026-11-08 (review r0 — layers: blind-hunter 18, edge-case 5, verification-gap 2+2; every claim verified at the cited location):
- ChatBot W9 tests never exercise the real composition (no okf module in the wrapper store, direct method calls, `browserVisible`/`:visible`/`@browse-document` unpinned — a rename keeps suites green while the modal never opens) — **medium → patch** (verification-gap, pre-verified).
- The only AQL-executing check (the extended smoke leg) has not run against a synced stack — **routed to the live gate** (the story's declared post-sync verification; runs after patches land).
- `browserLoadConcept` has no same-repo sequence guard: two rapid hops can commit out of order, pane shows the earlier click's concept — **low → patch** (one-line STALE guard; blind-hunter + edge-case concordant).
- `closeConceptBrowser` leaves an in-flight walk fetching into the hidden slice — **low → patch** (bump `browserTreeGeneration` on close; edge-case + blind-hunter concordant).
- `get()`/`getConceptTree()` let the httpService interceptor toast every expected refusal (404/403/501 are probe-style handled outcomes for all callers; httpService.js ~:257 documents `{ silent: true }` for exactly this) — **medium → patch** (fenced browse pops a raw toast beside the honest notice; reachable via the stale-citation path).
- `canBrowseSource` duplicated with identical body in ChatBot + RightSideBar — **low → patch** (export from `utils/okfCitation.js` beside `isOkfConceptSource`).
- The publication predicate is inlined in `getConcept` + `getConceptTree` and nothing pins their equality — **low → patch** (module-local `isServingRepo` helper; behavior identical).
- `countLabel` shows the unfiltered count while a filter is active — **low → patch** (count filtered rows when filtering; no new i18n key).
- `exists()` try/catch swallows transient DB faults as "no graph" — **low → patch** (house precedent calls `.exists()` bare — graph-lifecycle-service.js:153-164; absent collections return false, real faults surface as 500).
- ChatBot affordance test never clicks the rendered button (`@click` wiring unpinned) — **low → patch, grouped with the composition gap** (same root cause; the click test rides the real-store composition test).
- `okf-browser.test.js` "out-of-range offset" test name overstates (it exercises the short-page break) — **low → patch rider** (rename).
- `epic-9-context.md` still says author+parser edges both walkable; spec+code narrowed to author-only — **low → defer** (fix edits an agent-context file; the narrowing is recorded in the approved spec's Design Notes).
- st locale mixes 'maikutlo'/'kgopolo' for concept in one dialog — **low → defer** (needs native Sesotho review; guessing morphology violates the verbatim-i18n rule).
- No Playwright spec added — **false** — the landed CSR batch touched zero tests/e2e files; the wave pattern is jest suites + the extended live smoke; the frozen spec operationalized the epic line as locator discipline + smoke leg.
- `common.close` key absent — **false** — house idiom: 7 shipped components use `translate('common.close', 'Close')`; the key never existed; the fallback IS the mechanism.
- Smoke "omits the restricted hop" — **false** — the hop route IS the CAP-2 concept GET; its restricted fence is pinned by the pre-existing smoke [2] leg; the change-log 7/7 describes the scoped probe faithfully.
- Tree route lacks the /repos twin registration — **false** — servingReads mounts before the strict gates and shadows (the CAP-2 comment documents the twin as deliberate shadow redundancy); scoped callers reach the handler in both modes; route-level admission is test-pinned.
- No test pins the OTel span — **false** — zero span-pinning tests exist in the okf-server suite (house pattern: pass-through tracing mocks); the constraint "gets a span" is delivered in code.
- Sidebar `$t` lacks the fallback its twin has — **false** — key presence is pinned by the localeConsistency deep-identity test; the divergence cannot manifest through any shipped path.
- Empty Review Triage Log heading — **false** — rows land with this entry.
- Walk re-queries `total` per page — **false** — negligible at measured scale (~6k meta rows, indexed filter); the stateless per-page count is what keeps `total` honest mid-walk.
- `browserVisible` lacks the dialog's state fallback — **false** — a host store without the okf module cannot dispatch the open action either; the mismatch scenario is unreachable in any host that can open the dialog.
- Raw transport errors rendered untranslated — **low → reject** — rare (transport failure), honest-by-specificity, and the fix crosses the i18n ×14 surface for a string nobody sees in normal operation.
- Markdown recipe omits the editor's hljs/taskLists — **low → reject** — the edge layer itself ruled it cosmetic; pulling hljs into the chat bundle for a browse modal is a cost tradeoff, and code blocks are rare in concepts.
- Mid-walk re-ingest dup/skip (stateless offset over a mutable corpus) — **low → reject** — inherent to the frozen pagination contract (listConceptsMeta's), rare, display-only, self-healing on reopen; the safe fix (dedupe + raw-consumed offset counter) carries a walk-loop hazard disproportionate to the artifact.

## Design Notes

- The index carries author links ONLY; parser-derived structure is reached per-concept on demand (the meta row's `links[]` rides the CAP-2 fetch). This is the scale-safe split: author edges are ~13–16k per large repo; raw edge collections reach 483k (Bali) — the index must never join those.
- Page size: default 200, clamp 1..500 — identical to `listConceptsMeta`; the client assembles progressively (the `fetchConcepts` stale-guard pattern).

## Verification

**Commands (all run 2026-11-08 in the worktree):**
- `cd components/okf-server && npx jest` -- **PASS: 85 suites / 2130 tests**, incl. the new tree-index fence/bound suites
- `cd components/gov-chat-frontend && npx jest` -- **PASS: 145 suites / 4095 tests**, incl. dialog/affordance render tests + localeConsistency (10/10)
- `rtk proxy npx prettier --check` + `eslint` on every touched file INCLUDING `.vue` -- **clean** (both components; the one designTokens offender found mid-run — `--surface-variant` — was fixed)
- Coverage: frontend `--coverage` overall statements **89.28%** (baseline 88.21% — up; global floors 65/30/30/65 pass); the new dialog 97.61%, the store slice + controller + service fully exercised by their suites
- Live: scoped W9 probe **7/7 PASS** (see Spec Change Log) against the running local build; `node --check` on the extended smoke script passes. `OKF_SMOKE_KEYCLOAK_URL=https://localhost/auth node data/okf/smoke-test/run-smoke-chat-sources.mjs` remains the post-sync live run (needs the local build rebuilt from this branch)
- NOTE (host quirk, not a repo issue): jest run from a worktree under `.claude/` needs `--testMatch "**/__tests__/**/*.test.js"` on this Windows host (micromatch reads the `\.` of `.claude` in the absolute testMatch glob as an escaped dot). CI (Linux) is unaffected.

**Manual checks (if no CLI):**
- From a chat citation in both surfaces, walk a repo's tree in the modal; confirm copy states current-state semantics; confirm no affordance on legacy cards.
