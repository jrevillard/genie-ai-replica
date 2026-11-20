# Mobile OKF Concept-Tree Browser (#1939) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile app can browse an OKF repository's indexed concepts — the three citizen routes in the generated Dart client (drift-gate pinned), a browser screen on DS tokens, a temporary drawer entry, live-validated on an emulator against the local build.

**Architecture:** Extend the OpenAPI spec builder to include okf-server's three annotated citizen routes; regenerate `openapi_client/`; wrap the generated `OkfApi` in a riverpod state container with the web W9 browser's semantics (stale-guarded progressive pages, arms mapping, visit history); render with `flutter_markdown` (no HTML).

**Tech Stack:** Flutter 3.41.7 / Dart, flutter_riverpod, flutter_markdown 0.7.7, flutter_appauth (existing), swagger-jsdoc + openapi-generator-cli (existing, version-pinned).

**Spec:** `docs/superpowers/specs/2026-11-17-mobile-okf-concept-browser-design.md` (travels with this plan; executors read both).

## Global Constraints

- HARD FENCE: zero Admin Dashboard functionality — the three citizen routes only; no steward fields in any Dart model.
- NEVER hand-edit `openapi_client/` — it is generated; the spec + annotations are the source.
- DS tokens only (`AppTokens`, `Ds*` primitives) — no raw colors/literals.
- i18n: all 14 locale maps in `lib/i18n/locales/*.dart`; strings verbatim; port the web's `chatbot.okfBrowser.*` values where the wording matches.
- The legacy RAG pipeline's wire contract is untouched; no query request/response shape changes.
- Determinism: regenerations are byte-identical (the env-pinned envelope; on Windows use WSL or the pinned-JAR shim recipe — spec §Windows regeneration recipe). Run the `--check` equivalent before pushing.
- 404 anti-enumeration survives the client: no retry-on-404, no fenced/absent distinction.
- Standing: coverage must not increase→decrease rules, verbose structured logging, smoke harness extension per story, `/code-review` + `/simplify` before review, monitor CI after every push.

## Review Focus

1. **Out-of-range offset** — `concept-tree?offset=` past `total` answers an empty page with true `total`: the screen must disable Show-more (not hang, not duplicate rows). Test: Task 3's `extends at the boundary` case.
2. **Superseded loads** — rapid repo switch or Show-more taps: an older response must never commit over a newer run. Test: Task 3's stale-guard case.
3. **Arm confusion** — 403/404/501 → the unavailable arm; 401 → rethrown to the app auth flow; anything else → the error arm. A wrong mapping masks a fixable auth failure as "cannot be browsed". Test: Task 3's arms-mapping cases.
4. **Malformed/empty concept body + repeated links** — a body of `''` renders the empty pane (no crash); duplicate `links[]` entries dedupe to one chip. Test: Task 4's chip-dedupe + empty-body cases.
5. **Download of an empty body** — honest no-op, no crash, no zero-byte file. Test: Task 4's download-guard case.

---

### Task 1: Annotate the three citizen routes + extend the spec builder

**Files:**
- Modify: `components/okf-server/routes/okf-routes.js` (annotations above the three routes on the `servingReads` sub-router, :43/:53/:63)
- Modify: `scripts/build-openapi-spec.js:34` (the `apis:` glob gains the okf-server routes file)
- Test: `scripts/__tests__/openapi-okf-surface.test.js` (new)

**Interfaces:**
- Produces: spec paths `GET /api/okf/repos/{repo_id}/concept-tree`, `GET /api/okf/repos/{repo_id}/concepts/{concept_id}`, `GET /api/okf/concepts/resolve-repo` — all tagged `OKF`; schemas `ConceptTreePage`, `ConceptCard`, `ResolveRepoResponse`. Task 2's regen consumes these; Task 3 consumes the generated models.

- [ ] **Step 1: Write the failing spec test**

```js
// scripts/__tests__/openapi-okf-surface.test.js
process.env.API_URL = 'https://api-url-pin.example';
process.env.KEYCLOAK_URL = 'https://keycloak-pin.example';
process.env.KEYCLOAK_REALM = 'pin-realm';
const { buildSpec } = require('../build-openapi-spec');

test('the citizen OKF surface is in the spec with citizen-only schemas', () => {
  const spec = buildSpec();
  const p = spec.paths;
  expect(Object.keys(p)).toContain('/api/okf/repos/{repo_id}/concept-tree');
  expect(Object.keys(p)).toContain('/api/okf/repos/{repo_id}/concepts/{concept_id}');
  expect(Object.keys(p)).toContain('/api/okf/concepts/resolve-repo');
  const card = p['/api/okf/repos/{repo_id}/concepts/{concept_id}'].get.responses['200'].content['application/json'].schema;
  const cardProps = Object.keys(card.properties);
  expect(cardProps).toEqual(expect.arrayContaining(['repo_id', 'concept_id', 'graph_name', 'bundle_version', 'title', 'labels', 'summary', 'body', 'links', 'sources']));
  expect(cardProps).not.toContain('max_doc_chars'); // the fence: no steward fields
  const tree = p['/api/okf/repos/{repo_id}/concept-tree'].get.responses['200'].content['application/json'].schema;
  expect(Object.keys(tree.properties)).toEqual(expect.arrayContaining(['total', 'offset', 'limit', 'concepts']));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd components/gov-chat-backend && npx jest ../../scripts/__tests__/openapi-okf-surface.test.js` (resolution walks up; or the repo-root jest config the CI drift gate uses)
Expected: FAIL — the paths are absent.

- [ ] **Step 3: Annotate the three routes**

swagger-jsdoc blocks above each route handler in `okf-routes.js`, matching the backend's `@oas` style; response schemas inline (`type: object`, `properties:`) with EXACTLY the citizen shapes: tree `{total, offset, limit, concepts:[{concept_id,title,is_index,index_status,links:[string]}]}`; card `{repo_id, concept_id, graph_name, bundle_version, title, labels:[string], summary, body, links:[string], sources:[{kind,file_id,file_name,resource,missing}]}` (nullable file_id/resource per CAP-4); resolve `{repo_id, bundle_version}`. Errors documented: `404 {error: REPO_NOT_FOUND|CONCEPT_NOT_FOUND}`, `400 {error: CONCEPT_ID_REQUIRED}` on resolve. Tag `OKF` on all three. security: bearerAuth omitted (allowScopelessWhenOpen) — document `OKF_SCOPE_MODE` in the route description.

- [ ] **Step 4: Extend the builder's apis list**

`scripts/build-openapi-spec.js:34`: `apis: [path.join(BACKEND_DIR, 'routes', '*.js'), path.join(ROOT, 'components', 'okf-server', 'routes', 'okf-routes.js')]` — and verify the swagger-jsdoc `define` options the builder passes resolve for the second file (same `require` scope).

- [ ] **Step 5: Run the spec test to verify it passes**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/okf-server/routes/okf-routes.js scripts/build-openapi-spec.js scripts/__tests__/openapi-okf-surface.test.js
git commit -m "feat(okf): the three citizen routes enter the OpenAPI spec - annotated, drift-gate bound"
```

### Task 2: Regenerate the Dart client + wire the provider

**Files:**
- Generated (commit verbatim): `mobile/genie_ai_mobile/openapi_client/**` (regenerated — OkfApi + `ConceptTreePage`/`ConceptCard`/`ResolveRepoResponse` models appear)
- Modify: `mobile/genie_ai_mobile/lib/providers/api_providers.dart` (an `okfApiProvider` beside the existing API providers)

**Interfaces:**
- Consumes: Task 1's spec.
- Produces: `okfApiProvider` exposing the generated `OkfApi` on the shared `AuthInterceptor` client; the generated model classes `ConceptTreePage`, `ConceptCard`, `ResolveRepoResponse` for Tasks 3–5.

- [ ] **Step 1: Regenerate** (WSL or the pinned-JAR shim; the spec travels via the script's extraction): `./scripts/generate-api-client.sh` — Expected: the generated output includes `lib/api/okf_api.dart` and the three models; the array-file patch applied.
- [ ] **Step 2: Verify drift-gate equivalence**: run the script's `--check` mode (or the shim's equivalent) — Expected: exit 0 (committed artifacts == regenerated).
- [ ] **Step 3: Wire `okfApiProvider`** in `api_providers.dart`, exactly the pattern of the existing providers (same shared http client).
- [ ] **Step 4: Analyze**: `flutter analyze` — Expected: no new issues.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): the generated client carries the citizen OKF surface"`

### Task 3: Browser state container (repository + riverpod notifier)

**Files:**
- Create: `mobile/genie_ai_mobile/lib/okf/concept_browser_repository.dart`
- Create: `mobile/genie_ai_mobile/lib/okf/concept_browser_controller.dart`
- Test: `mobile/genie_ai_mobile/test/okf/concept_browser_controller_test.dart`

**Interfaces:**
- Consumes: `okfApiProvider` (Task 2); models `ConceptTreePage`, `ConceptCard`.
- Produces: `ConceptBrowserState` (freezed-free plain class: `repoId, rows, total, loading, extending, treeComplete, unavailable, error, selected, selectedLoading, selectedUnavailable, history, historyIndex`), `ConceptBrowserController extends Notifier<ConceptBrowserState>` with methods `open(repoId)`, `extend()`, `select(conceptId)`, `goBack()`, `goForward()`, `backToList()`, `close()`. Page size 200; stale-guard keyed on repoId + a generation counter; arms: status 403/404/501 → `unavailable=true`, 401 → rethrow, else → `error`.

- [ ] **Step 1: Write the failing controller tests** (flutter_test; a `ProviderContainer` over a mocked repository): first-page load commits rows + `treeComplete` when `rows < 200`; extend at the boundary (offset past total) leaves state unchanged and disables extending; a superseded page (slow first repo, fast second) never commits the older run; arms mapping 403/404/501/401/500; `select` sets `selected` + appends history truncating the forward tail; repeat-tap no-op; boundary back/forward no-op; `backToList` clears selection, keeps history.
- [ ] **Step 2: Run to verify FAIL** — `flutter test test/okf/concept_browser_controller_test.dart`
- [ ] **Step 3: Implement the repository** (thin: generated `OkfApi` calls + status extraction) **and the controller** (the semantics above; verbose `log` lines on state transitions).
- [ ] **Step 4: Run to verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): the concept-browser state container - stale-guarded pages, arms mapping, visit history"`

### Task 4: The browser screen widget

**Files:**
- Create: `mobile/genie_ai_mobile/lib/okf/concept_browser_screen.dart`
- Test: `mobile/genie_ai_mobile/test/okf/concept_browser_screen_test.dart`

**Interfaces:**
- Consumes: `ConceptBrowserController` + `ConceptBrowserState` (Task 3); `AppTokens` + `Ds*` primitives; `MarkdownBody` (flutter_markdown, defaults — no HTML extension).
- Produces: `ConceptBrowserScreen(repoId)` — a Scaffold: the tree list (index rows bold per `is_index`, status dot per `index_status`), Show-more button per `treeComplete/extending`, the detail pane (title, history ◀/▶, back-to-list, markdown body, related-concept chips deduped from `links[]`), download (writes `selected.body` to a local `.md`; disabled until selected; empty body → no-op notice), and the arms (spinner / select-hint / concept-unavailable / repo-unavailable / error).

- [ ] **Step 1: Write the failing widget tests** (pump with `ProviderScope` overrides + the mocked repository): spinner arm; select-hint arm; a loaded tree renders rows + Show-more; tapping a row shows the markdown title+body; duplicate `links[]` render ONE chip; chip tap is a forward visit (history grows); back/forward buttons enable per history boundaries; 403/404 render the repo-unavailable arm (never a toast); empty-body download is an honest no-op.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement the screen** — one widget file, private row/chip/pane sub-widgets inside it; every color/spacing through `AppTokens`; verbose logs on user-driven transitions.
- [ ] **Step 4: Run to verify PASS** + `flutter analyze` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): the OKF concept-tree browser screen"`

### Task 5: Navigation + temp drawer entry + i18n ×14

**Files:**
- Modify: `mobile/genie_ai_mobile/lib/main.dart` (route `'/okf/browse'`; drawer item under the existing endDrawer list)
- Modify: `mobile/genie_ai_mobile/lib/i18n/locales/*.dart` (all 14)
- Test: `mobile/genie_ai_mobile/test/okf/browse_entry_test.dart`

**Interfaces:**
- Consumes: `ConceptBrowserScreen(repoId)` (Task 4).
- Produces: route `'/okf/browse'` taking `repoId` as an argument object; drawer entry "Browse repository" opening a DsModal with a `DsInput` (typed repo id) that pushes the route; i18n keys `okfBrowser.title, okfBrowser.showMore, okfBrowser.back, okfBrowser.forward, okfBrowser.backToList, okfBrowser.selectHint, okfBrowser.conceptUnavailable, okfBrowser.unavailable, okfBrowser.download, okfBrowser.downloadEmpty, okfBrowser.currentNotice, okfBrowser.drawerEntry, okfBrowser.drawerPrompt` — en values as the web's W9 wording; the other 13 ported from the web locales' matching `chatbot.okfBrowser.*` values verbatim.

- [ ] **Step 1: Write the failing entry test** — the drawer carries the entry; tapping opens the prompt; a blank id stays; a typed id pushes the route with the id.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** route + drawer item + prompt modal + the 14 locale entries.
- [ ] **Step 4: Run to verify PASS** + all-locale parse check (each `*.dart` locale map imports clean).
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): the temp drawer entry into the browser + okfBrowser i18n x14"`

### Task 6: Smoke leg, CHANGELOG, emulator validation, gates

**Files:**
- Modify: `data/okf/smoke-test/run-smoke-ceiling.js` OR Create: `data/okf/smoke-test/run-smoke-mobile-contract.js` (builder's call, standing smoke rules apply)
- Modify: `CHANGELOG.md`
- Test: the smoke run itself.

**Interfaces:**
- Consumes: Task 1's routes live on the local build.

- [ ] **Step 1: Write the smoke leg** — extending the existing harness pattern (admin-token provisioning precedent): provision → publish → ingest a small repo, then assert AS A CITIZEN the three contracts: tree paging (`limit=2` over 3 concepts: first page 2 rows + `total` 3, second page 1 row, out-of-range offset empty), the card's citizen shape (steward field absent), resolve-repo positive + 404 arm. Clean up.
- [ ] **Step 2: Run the leg against the local build** — Expected: SMOKE OK.
- [ ] **Step 3: Emulator validation (STANDING GATE — every delivered mobile feature is live-validated)** — launch the Android emulator (`flutter emulators` / `emulator -list-avds`, create if none), build+install the dev flavor (`flutter run --flavor dev` or the project's documented run), point it at the LOCAL BUILD's host-reachable edge (Android: `http://10.0.2.2:<published port>` — the exact port verified against `docker ps` for the Kong/http listener; the dev flavor's insecure allowance covers the local TLS shape), log in, open the drawer entry, type the smoke leg's repo id, and walk: tree loads progressively → select a concept → markdown renders → chips navigate → back/forward → download lands a file. Capture the emulator state as the validation evidence.
- [ ] **Step 4: Coverage + analyze gates** — `flutter test --coverage` (coverage does not decrease vs `origin/main`'s mobile baseline), `flutter analyze` clean, `flutter test` full suite green.
- [ ] **Step 5: CHANGELOG entry** under `[Unreleased]`/Added — the browser, the fence sentence, the modes sentence.
- [ ] **Step 6: Commit + push; monitor CI to green** (the drift gate re-verifies the committed client).

---

## Wave 2 — chat citation parity (#1937/#1938, ruled 2026-11-19)

David's live-validation directive: the mobile app must reach functional parity with the
Vue 3 app on four features — (1) the knowledge hierarchy loads under a valid session;
(2) query responses surface their related OKF repositories in a bar under the response
AND in the right sidebar; (3) referenced repositories are browsable like the Vue app;
(4) a cited concept document opens when clicked. The raw chatqna citation shape is:
`{document_id, document_name, url, categoryLabels, serviceLabels, score, [concept_id],
[source: 'okf-concept'], [graph_name], [repo_id], [bundle_version], [text]}` (genieai_chatqna.py
CAP-1 block). The web contract lives in `components/gov-chat-frontend/src/utils/okfCitation.js`
(isOkfConceptSource / canBrowseSource / okfConceptBadge — ONE predicate for both surfaces)
and ChatBotComponent.vue `openSourceDocument` (external URL → open; OKF concept → concept
markdown; pre-CAP-1/restricted → honest notice, never a dead link).

### Task 7: The citation model + predicates

**Files:**
- Create: `mobile/genie_ai_mobile/lib/okf/okf_citation.dart`
- Test: `mobile/genie_ai_mobile/test/okf/okf_citation_test.dart`

**Interfaces:**
- Produces: `isOkfConceptSource(Map doc)` (source == 'okf-concept' OR conceptId/concept_id
  present — accepts RAW snake_case and mapped camelCase, same as the web predicate);
  `canBrowseSource(Map doc)` (okf-concept AND repoId/repo_id AND id/concept_id present);
  `sourceBadge(Map doc)` ({label, tone}: OKF/accent for concepts, extension-derived for
  documents); `sourceTitle(Map)` (document_name ?? document_id); `citationRepoId(Map)` /
  `citationConceptId(Map)` (shape-tolerant getters). ONE definition consumed by BOTH
  surfaces (chat bar + sidebar) — they must not drift (web r0 rule).

- [ ] Step 1: failing tests — okf marker; concept_id fallback; repo-only row not okf; canBrowse positive/negative (no repo_id, no concept_id); badge OKF vs ".pdf" vs extensionless doc; both shapes.
- [ ] Step 2: verify FAIL. Step 3: implement. Step 4: verify PASS + analyze clean.
- [ ] Step 5: Commit `feat(mobile): the okf citation predicates - one definition for both chat surfaces`

### Task 8: The related-sources bar under each assistant response

**Files:**
- Modify: `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart` (render bar per assistant message with non-empty `sources`)
- Create: `mobile/genie_ai_mobile/lib/components/chat/answer_sources_bar.dart`
- Modify: `mobile/genie_ai_mobile/lib/i18n/locales/*.dart` (14 locales, chatbot.sourcesBar*)
- Test: `mobile/genie_ai_mobile/test/okf/answer_sources_bar_test.dart`

**Interfaces:**
- Consumes: Task 7 predicates; `Navigator.push` to `'/okf/browse'` (Task 5 route) with
  repoId (+ conceptId argument for deep-open, Task 10); `url_launcher` for external http(s)
  urls; honest unavailable notice otherwise.
- Produces: `AnswerSourcesBar(sources, onOpen)` — collapsed by default, toggle label
  "Related sources (N)", rows: badge + document_name (+size when present), tap → route by
  predicate. chatbot_component passes `msg['sources']`.

- [ ] Steps: failing widget tests (hidden when no sources; toggle reveals rows; OKF badge; canBrowse row navigates with repoId; external url row calls launcher; neither → notice) → FAIL → implement (+i18n en verbatim, 13 ported) → PASS + analyze → Commit `feat(mobile): the related-sources bar under each answer`

### Task 9: Right sidebar related-sources rows (real entries replace the typed-id placeholder)

**Files:**
- Modify: `mobile/genie_ai_mobile/lib/components/chat/right_sidebar_component.dart`
- Modify: `mobile/genie_ai_mobile/lib/i18n/locales/*.dart`
- Test: `mobile/genie_ai_mobile/test/okf/sidebar_sources_test.dart`

**Interfaces:**
- Consumes: Task 7 predicates; the active answer's sources (the same accumulatedDocs the
  chat already builds); ConceptBrowserScreen route.
- Produces: a "Related sources" section listing rows per canBrowseSource + okf-only rows
  with repo identity; each row a Browse button (W9 wording) pushing the browser route.
  The typed-repo-id drawer entry STAYS (fallback), the section is the wired path.

- [ ] Steps: failing tests (rows render from sources; browse pushes repoId; non-browsable rows render plain without a button; empty sources → section absent) → FAIL → implement → PASS → Commit `feat(mobile): the sidebar related-sources rows`

### Task 10: Deep-open a cited concept (initialConceptId)

**Files:**
- Modify: `mobile/genie_ai_mobile/lib/okf/concept_browser_screen.dart` (optional `initialConceptId`)
- Modify: `mobile/genie_ai_mobile/lib/okf/concept_browser_controller.dart` (open-with-select)
- Test: `mobile/genie_ai_mobile/test/okf/concept_browser_deep_open_test.dart`

**Interfaces:**
- Produces: `ConceptBrowserScreen(repoId, {initialConceptId})` — after the first page
  loads, if initialConceptId is set, controller.select it once (row may or may not be on
  page one; select by id works regardless — the concept fetch is by id).

- [ ] Steps: failing controller/screen test (screen opens with initialConceptId → detail pane shows that concept without a manual tap) → FAIL → implement → PASS → Commit `feat(mobile): deep-open a cited concept in the browser`

### Task 11: Wave gates — smoke leg extension, CHANGELOG, coverage, push, MR

- [ ] Extend `data/okf/smoke-test/run-smoke-mobile-contract.js` with the citation contract: seed a repo whose concept carries okf citation fields; assert a chat answer surfaces the okf-concept source row with repo_id + concept_id (assembler contract the mobile bars depend on). Run live: SMOKE OK.
- [ ] Revert the two SESSION OVERRIDE edits (e2e_config clientId/scheme, build.gradle appAuth scheme) — flagged; cloud clients own those values. Keep the toolchain bumps (needed to build).
- [ ] `flutter test --coverage` (no decrease), `flutter analyze` clean, full suite green; CHANGELOG Added entry; commit; push; monitor CI; MR.

---

## Wave 2 LIVE STATUS (2026-11-19 22:00)

- Task 7 COMMITTED 6082f8c (15 tests). Tasks 8-10 COMMITTED a2bd1a9 (bar, sidebar CAP-3 routing,
  deep-open initialConceptId, i18n x14). sources-resolution fix COMMITTED 5bb282b (non-streaming
  path read metadata.sources only; backend sends source_documents — bar rendered nothing on live
  queries; ONE resolution feeds bar + sidebar). Race fix COMMITTED de8c0f4 (#2019 shared
  in-flight future; 77/77 auth suite).
- LIVE-VERIFIED on the emulator (David's NASA query): bar renders "Related sources (3)" with OKF
  badges; rows expand; sidebar carries the doc row.
- BLOCKED UPSTREAM: the emitted okf-concept rows carry graph_name but NO repo_id → canBrowseSource
  false → deep-open refuses (honest notice) = EXACT web parity (web canBrowseSource needs repo_id
  too). Root cause filed #2020: CAP-1 enrichment (retriever 1941-1975) does not fire on the hybrid
  fan-out path; chunk metadata HAS repo_id ([ADAPTIVE] logs), okf_concepts_meta HAS the mapping.
- PRE-EXISTING test failures (proven: reproduce with my changes reverted — HEAD's own sidebar
  file fails identically): browse_entry_test (2 tests) + concept_browser_screen_test "tapping a
  row" — flutter-test ink-sparkle shader decode failure on this machine (framework-level).
- Two SESSION OVERRIDE edits stay uncommitted (e2e_config clientId/scheme → dev; build.gradle
  appAuth scheme → dev) — the local realm provisions genie-mobile-dev only; revert at MR time.
  Toolchain bumps (gradle 8.14.3/AGP 8.11.1/Kotlin 2.2.20, gradle.properties, wrapper, settings)
  uncommitted — needed to build; ride the MR.
- NEXT: (a) Task 11 gates — smoke leg, coverage no-decrease, CHANGELOG, flutter clean to retry the
  two shader-flaky tests, push, MR; (b) #2020 retriever MR (backend, separate worktree off main) —
  the browse blocker; (c) #2018 profile rebuild storm — needs a live repro with enlarged logcat
  (logcat -G 4M): irregular rebuild bursts rebuild all 12 sections (~40 TextFields logged per
  rebuild); zero "Save button pressed" lines captured — repro required.

## Wave 2 LIVE STATUS (2026-11-20 08:20) — David's contradiction resolved

- David's Vue screenshot (23:27, Naugle query, Browse buttons WORKING) disproved the #2020
  upstream theory. Backend-log comparison (trace ids 0e40…, 3b98…, 05d3…): BOTH runs routed
  OKF_solar-system_v1; the retriever attached repo_id f9e08ce2 to the Naugle chunks in BOTH
  (legs=1 mobile w/ sticky carrier, legs=2 Vue w/ kenya+solar). #2020 CORRECTED (note posted) and
  CLOSED as invalid.
- TRUE root cause of the 22:41 mobile non-browse: the OLD APK (pre-5bb282b). Tonight's replay on
  the rebuilt APK: "Related sources (2)", OKF badges, tap → browsable=true repo=f9e08ce2 → browser
  opens, 144 tree rows load, deep-select fires.
- NEW defect found + FIXED (spec lie): okf-routes.js declared ConceptCard.links items as strings;
  the server serves author-link OBJECTS {to_concept_id,label} (legacy {target}) → the generated
  Dart client threw _Map<String,dynamic>≠String mid-render (the browser error screen). Fix: spec →
  ConceptCardLink {to_concept_id,target,label}; client regen (jar shim, diff = exactly the field);
  chips read to_concept_id??target with .md/concepts/ strip + label fallback (web contract).
  Tests: concept_card_contract_test (3, RED→GREEN), screen chip tests (label/target/self-link).
- #2019 half two FIXED: the interceptor's swallow-everything catch now logs
  INTERCEPTOR_REFRESH_THROWN with the cause (the 23:37 dead-session hang had ZERO AuthNotifier
  logs — the cause vanished). TDD RED→GREEN; auth suite 147/147.
- #2022 FILED (David's call): retrieval abstains on carrier-less sessions — a fresh-session Naugle
  query = zero rows, reranker_selected_nothing, fan-out 14 legs of all-graph noise; sticky sessions
  retrieve fine. Backend retrieval-quality work, later MR.
- REMAINING for Task 11: smoke leg, coverage, CHANGELOG, flutter clean retry of the 3 shader-flaky
  tests (browse_entry ×2 + screen "tapping a row"), revert SESSION OVERRIDEs, push, MR.
