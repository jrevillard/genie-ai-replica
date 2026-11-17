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
