# W6 — OKF artifacts view (EPIC-6 / CAP-5 / FR-005)

**Status:** IMPLEMENTED (2026-11-06) — unit-verified, security-reviewed, coverage-verified;
awaiting the local-build sync for the LIVE pass. GitHub issue **#1557**, MR pending.
**Sources:** PRD `prd-okf-chat-source-resolution-2026-11-04` FR-005 + NFR-004/005/006;
SPEC `spec-okf-chat-source-resolution` CAP-5; `epics.md` EPIC-6; remediation-plan W6 row;
wave order from `workplan-okf-2026-11-05.md` Phase C.
**Branch:** **`feat/okf-artifacts-view`, cut from `origin/main`** — NOT the CSR
batch branch. Reasons, all verified this session:
- The workplan's own ordering rule: *"W6 — artifacts view — now lands INTO the
  new theme (the double-restyling risk avoided by the ordering)"*. Phase U
  (the tab-rack consolidation + theme sweep) is **merged on main**; the CSR
  branch predates it — its `AdminDashboard.vue` is the PRE-UX-1 file with the
  sidebar (69 insertions / 217 deletions behind main's).
- W1–W5 never touched `AdminDashboard.vue` (their frontend diff is
  `ChatBotComponent.vue`, `RightSideBarComponent.vue`, the conversation store,
  `document-opener.js`, the 14 locales and 4 test files) — so building W6 on
  main does not collide with the batch, and the batch's later rebase onto
  main will not conflict on the admin surface.
- W6 has **no dependency on W1–W5** (the epic's own line: *"Dependencies:
  none (independent, UI-heavy)"*), and the epics design one wave = one MR
  slice.
- The PRD/spec artifacts are not on main yet (they ride MR !720, still
  awaiting David's review) — this story file records the requirements it
  implements, so the wave is not blocked on the docs MR.

---

## The map that shaped the design (measured, 2026-11-05)

| Fact | Where |
|---|---|
| There is exactly ONE document-list surface: the admin dashboard's `documents` tab | `AdminDashboard.vue:440` (the tab block) |
| Its fetch sends NO `is_bundle` — so bundles are in it today | `AdminDashboard.vue:3889-3899` → `documentFileService.getFiles(params)` → `GET /files?page&limit&search` |
| The list is a hand-rolled `<table class="data-table">`, NOT `DsTable` | `AdminDashboard.vue:440` |
| The bundle delete affordance: the **batch** "Delete Selected" button | `AdminDashboard.vue:531-564` |
| `deletableSelection` = selected ∧ loaded ∧ NOT status-blocked — a bundle is NOT status-blocked unless it is ingested | `AdminDashboard.vue:2174-2186` |
| ⇒ **a Pending bundle IS deletable in the UI and 403s server-side** — the lie, exactly as the epic names it | `fileController.js:830-847` |
| The details dialog is already honest: Delete is hidden for bundles (`v-if="!isBundle"`) and `mainAction()` returns `{}` | `FileDetailsDialog.vue:554, 808-813` |
| …but its bundle badge key `details.bundleBadge` is **missing from all 14 locales** → the English fallback renders everywhere | `FileDetailsDialog.vue:24-27` |
| The state vocabulary: `dataprep.status` stored CAPITALISED ('Pending'), the frontend map keyed lower-case → the lookup MUST lowercase | `AdminDashboard.vue:3419-3426`, `fileService.js:671` |
| `killed` has no frontend mapping today | `fileController.js:156` |
| The deep-link consumer: `applyRouteQuery` handles `?tab=` and `?tab=documents&file=` (one-shot scrub) | `AdminDashboard.vue:3788-3812` |
| **No `?tab=studio&repo=` exists** — repos open in-process via `okf/openEditor` | `src/store/modules/okf.js:733-751` |
| The `okf` store carries `reposById` (repo_id → repo) and `laneFor` keeps the RETRACTED lane | `src/store/modules/okf.js:38, 96-115` |
| `fetchRepos({stage:'all'})` fills `reposById` | `src/store/modules/okf.js:491-501` |
| The version manifest carries `bundle_file_id` + `bundle_file_name` — the repo→artifact link data | `version-service.js:490` |
| `DsTable` EXISTS (`components/ds/Table.vue`) — columns/rows/rowKey/loading/emptyText + `th-<key>`/`cell-<key>`/`empty` slots, emits `sort` + `rowClick` | `components/ds/Table.vue:69-84` |
| `DsPill` has NO `warn` variant — `VersionsDialog.vue:64,74` uses one (latent defect, unstyled pills) | `components/ds/Pill.vue:8` |
| Playwright handles in this surface use `data-test-id`; the document ROWS have **no handle** (the helper locates them by CSS class — a pre-existing violation of `tests/e2e/CLAUDE.md:52-67`) | `tests/e2e/helpers/documents.js:73,142` |

**Live data (local build, `files` collection):** 287 files, 25 bundles
(22 `Ingested`, 2 `Retracted`, 1 `Pending`), 263 non-bundles. **8 of the 25
bundles carry `bundle_version: null`** and the version manifests cover only
the recent mints — so the artifact's OWN `bundle_version` is the only
reliable version source, and for a third of the live artifacts there is
none.


---

## The gap (measured, not assumed)

**Live measurement, local build, `files` collection (2026-11-05): 287 files, of
which 25 carry `is_bundle: true` and 263 do not.** The default document list
fetches `GET /api/files` with NO `is_bundle` filter, so every bundle row is
already in it — machine artifacts wearing the costume of documents. The
counts: 22 `Ingested`, 2 `Retracted`, **1 `Pending`** (`probe.md`,
repo `00000000-0000-0000-0000-000000000001`, version 1).

**The lie.** The WS2 guard (`components/document-repository/src/controllers/fileController.js:92-131`)
makes bundle zips deletable ONLY by the `okf-service` account; every other
caller gets `403 BUNDLE_PROTECTED` (`fileController.js:830-847`, and the
multi-delete twin at `:909-961`). The document list renders a Delete action on
every row it knows how to delete — so a bundle row offers Delete and the
server refuses it. "Deletable in the UI but 403s" is exactly the
CAP-5 success clause: *"the Pending-bundle deletable-but-403 lie is
resolved"*.

**What the backend already gives us (verified this session):**

| Fact | Where |
|---|---|
| `is_bundle` is an accepted, boolean-validated query param | `fileController.js:165` (`Joi.boolean().optional()`) |
| `is_bundle === true` filters bundles in; `=== false` excludes them AND keeps legacy rows (`is_bundle == null`) | `components/document-repository/src/services/fileService.js:693-697` |
| The bundle doc carries `repo_id`, `bundle_version`, `graph_name`, `file_name`, `dataprep.status` | live rows, `files` collection |
| Bundle zips are minted per publish version, `is_bundle` defaulted `false` for ordinary uploads | `fileController.js:1441-1608` (`is_bundle: Joi.boolean().default(false)`) |
| The file-header directive on WS2 exists to keep bundles alive | `fileController.js:92-101` |

**So the backend is DONE for this wave** — the epic says so ("doc-repo
`getFiles` already supports `is_bundle` (frontend param change + view)"). W6
is a frontend wave with one frontend-visible backend truth: the 403.

---

## The shape (what ships)

### 1 — Bundles leave the default document list

The default list fetch gains `is_bundle=false`. **Zero backend change.** The
filter keeps legacy rows (`is_bundle == null` — every document uploaded before
the stamp existed), so the default list keeps its 263 rows and loses its 25.

### 2 — A labeled ARTIFACTS view

A second view inside Document Management (Documents | Artifacts), listing
bundles only. Each row carries:

- a **`repo@version` provenance pill** — the repo's NAME resolved from the
  `okf` store by `repo_id`, and the version from the doc's `bundle_version`;
- a **state pill** — the doc's `dataprep.status`;
- **truthful actions** (below).

**The null-version case is real, not theoretical:** of the 25 live bundles,
**8 carry `bundle_version: null`** (the `-production-ready` / `-llm` zips).
The pill must degrade honestly — it must NOT parse the version out of
`graph_name` (the banned pattern, and `_v<N>` in a graph name is ambiguous
when the repo name itself contains an underscore) and must NOT invent one.
Absent version → the pill names the repository and says the version is
unknown.

**The unknown-repo case is real too:** the artifacts list is not scoped to
live repos — a `Retracted` bundle's repo may be gone entirely. When
`repo_id` does not resolve in the `okf` store, the pill falls back to the
repo id and the repository link does not render (no dead link — the
no-dead-affordance rule).

### 3 — The state vocabulary

`dataprep.status` is stored **capitalised** ('Pending', 'Ingested',
'Retracted') while the query param is lower-case — the service compares
`LOWER(...) == LOWER(@status)` (`fileService.js:671`). The frontend must
match **case-insensitively** or every pill renders blank. The full stored
vocabulary (from `getFilesSchema`, `fileController.js:156`): `pending`,
`ingesting`, `ingested`, `ingested with warnings`, `ingestion error`,
`retracted`, `killed`.

### 4 — Truthful per-state actions

| State | Download | Open repository | Delete |
|---|---|---|---|
| Pending | ✅ | ✅ (if the repo resolves) | ❌ **never** |
| Ingesting | ✅ | ✅ | ❌ |
| Ingested | ✅ | ✅ | ❌ |
| Ingested with warnings | ✅ | ✅ (+ a warning pill) | ❌ |
| Ingestion error | ✅ | ✅ | ❌ |
| Retracted | ✅ | ✅ (if the repo resolves) | ❌ |
| no status (never processed) | ✅ | ✅ | ❌ |

**Decision — the Pending-bundle lie is resolved by DROPPING the affordance,
not by making bundles deletable.** The epic offers both ("either make it
deletable via okf-service or drop the affordance"). Dropping it:
- is truthful immediately, with no privileged write path;
- contradicts nothing — WS2's rule is that bundles are owned by the OKF
  lifecycle, and **W7 is about reversing D3's deletion semantics anyway**
  (retract currently hard-deletes bundle zips; W7 stops that). Making
  Pending bundles deletable now would build on the rule W7 is about to
  reverse.
- costs one affordance, not an endpoint.

A **delete** on any bundle row must be impossible to render — that is the
acceptance criterion, not a nicety.

### 5 — Bidirectional navigation

- **artifact → repo**: the repository link deep-links into the OKF Studio's
  repo view, using the existing `?tab=…&file=` pattern.
- **repo → artifact**: from the repository's surface (the VersionsDialog /
  version list) to the artifact for that version.

Both directions degrade honestly: an unresolvable target renders plain text,
never a dead link (the CAP-3 rule, applied here).

### 6 — i18n × 14, DS primitives only, Playwright handles

New strings in all 14 locales, deep-key identical (`localeConsistency`).
`DsTable` / `DsDialog` / `DsPill` only. Handles use the **admin surface's
`data-test-id` spelling** (the chat surface's `data-testid` is a different
convention — read the component before writing the locator).

---

## Story slices (the epic's, with this wave's decisions folded in)

**Slice 1 — filter + view.** Default list carries `is_bundle=false`; the
artifacts view lists bundles with `repo@version` + state pills; the null
version and unknown repo degrade honestly; zero unlabeled bundle rows remain
in the default list.

**Slice 2 — truthful actions.** Per-state action set as tabled above; the
Pending-bundle 403 lie resolved by dropping Delete; the repository deep link
from an artifact row.

**Slice 3 — navigation + i18n.** artifact ↔ repo both directions; i18n × 14;
Playwright handles on the admin spelling.

---

## Acceptance criteria (FR-005 + the wave's NFRs)

- [ ] Zero unlabeled bundle rows in the default document list
- [ ] Artifact ↔ repo navigation works both directions
- [ ] Pending bundles get a truthful action (no affordance that 403s)
- [ ] DS primitives only (`DsTable`/`DsDialog`/`DsPill`); `?tab=…&file=` deep-link pattern reused
- [ ] No-regression inventory (remediation plan) re-checked per wave
- [ ] Playwright suite green; renamed locators swept
- [ ] Legacy document handling: zero behavior change outside `is_bundle` rows and RESTRICTED-source refusals
- [ ] Per-component `jest --coverage`: every touched component ≥ its existing floor (backend 35 / frontend 65 / doc-repo 55); CI Statements% does not regress (frontend baseline **88.97**, 3764/3764)
- [ ] Smoke harness extension per story, live-verified
- [ ] config-validator untouched or green (NFR-006 — no new env var is planned)

---

## Verification plan

**Unit (this session):** the default list's request carries `is_bundle=false`;
the artifacts view renders one row per bundle with the right pills; the
null-version bundle renders an honest "version unknown" pill; the
unknown-repo bundle renders no repository link; a bundle row NEVER renders a
delete control (for every state, including Pending); the state pill
matches case-insensitively; the repository link carries the deep-link
params; the reverse link lands on the artifact.

**Live (local build, after the tree sync):** the default Documents list shows
263 rows and zero bundle rows; the Artifacts view shows the 25 live bundles
with their pills; the `Pending` bundle row has no Delete; a repository link
opens the Studio at the right repo; the reverse link opens the artifact.

**The live batch is a tree-sync gate** (David's (b) decision, 2026-11-05):
W1–W5 ship unit-verified and live-verify in one pass when the build tree
syncs. W6 rides the same batch — the harness extension ships with it, and
the live run happens at the sync.

---

## Open decisions for the wave (recorded, not silently taken)

1. **The artifacts view's placement** — a Documents | Artifacts switch inside
   the admin's Document Management tab (the epic's wording: the view lives in
   Document Management and deep-links INTO the Studio). **TAKEN: the switch
   inside Document Management.**
2. **The repository name source** — the `okf` store's repo list, matched by
   `repo_id`. If the store only carries live repos, a Retracted bundle's repo
   will not resolve and the row degrades to the repo id (acceptable — the
   version is what identifies the artifact). **TAKEN: the okf store.** The
   store's list endpoint answers its FIRST page (the server caps the page at
   50) and the frontend follows no cursor — a KNOWN LIMIT, inherited from
   `repoOkfService.list` and shared with the Studio's own repository list.
   Documented in the component; the degradation is honest (the raw repo id).
3. **Whether the reverse link (repo → artifact) lands in the VersionsDialog**
   or in the Studio's repo view. Whichever it is, it must reach the artifact
   for a SPECIFIC version. **TAKEN: the VersionsDialog** — it is the surface
   that already lists the versions, and it carries the bundle file id.

---

## Implementation record (2026-11-06)

### What shipped

| Piece | Where |
|---|---|
| The artifacts view | `components/gov-chat-frontend/src/components/okf/ArtifactsView.vue` (NEW) |
| The shared status vocabulary | `components/gov-chat-frontend/src/utils/documentStatus.js` (NEW) |
| The authenticated download | `src/utils/fileDownload.js` (NEW) + `documentFileService.downloadFile()` (NEW) |
| The dashboard wiring | `AdminDashboard.vue` — the `is_bundle: false` list, the Documents\|Artifacts switch, the bundle delete refusal, the `?tab=studio&repo=` and `?tab=documents&view=artifacts` deep links |
| The reverse link | `okf/editor/VersionsDialog.vue` — "View artifact" |
| i18n × 14 | `okf.artifacts.*` (title, lead, empty, loadFailed, downloadFailed, column.{artifact,repository,state,actions}, openRepo, unknownVersion), `admin.documents.{viewDocuments,viewArtifacts,deleteRefuseBundle,deleteRefuseMixed,artifactsParked}`, `details.bundleBadge`, `okf.versions.viewArtifact` |
| The browser spec | `tests/e2e/okf/artifacts-view.spec.js` (NEW — injected payloads) |
| The smoke phase | `data/okf/smoke-test/run-smoke.js` — criterion 17: the artifacts view's data source |

### The three defects the reviews found (all fixed in the wave)

1. **The download 401'd.** The bundle download was a plain `<a href>` — but
   doc-repo's download route sits behind `authenticateToken` and is not on
   the public-path list, and the SPA keeps its token in memory
   (`storeAuthStateInCookie: false`), so a browser navigation sends no
   Authorization header. **Verified live against the running stack:
   `GET /api/files/<id>/download` without a bearer answers 401
   TOKEN_INVALID.** Both surfaces (the new artifacts view AND the pre-existing
   WS4 Versions-dialog link) now download through the authenticated client and
   hand the blob to the browser (`saveBlob`).
2. **Two i18n key paths did not exist.** The parked-artifacts notice read
   `admin.documents.parked` (the catalogue ships `admin.documents.artifactsParked`)
   and the artifacts pager read `admin.previous/next/showing/of` (the catalogue
   ships them under `admin.userManagementSection.*`). Both rendered the English
   fallback in all 14 locales. Fixed — and the DOCUMENT LIST's own pager had
   the same wrong keys, so it was English-only too: fixed in the same pass.
3. **`okf.artifacts.column.state` was missing from all 14 locales** — the State
   header rendered the English fallback. Added, each locale taking its OWN
   existing word for the status column.

### The verification (measured, not asserted)

- **Frontend suite:** 135 suites / 3912 tests green.
- **Coverage (this machine, the wave vs the main baseline measured by
  stashing the wave and re-running):** lines **89.05 %** vs **88.97 %**,
  statements 89.01 vs 88.92, branches 76.16 vs 76.00, functions 67.40 vs
  67.14 — the must-not-decrease bar is met on every metric.
- **Security review:** no HIGH/MEDIUM finding introduced. The change set adds
  no endpoint, no server-side rule and no sink; the one genuinely new
  primitive (the `?tab=studio&repo=` deep link) is guarded server-side by two
  fail-closed layers with anti-enumeration 404s (the reviewer verified both).
  The one real weakness the review surfaced — doc-repo enforces NO OKF scope
  model, so any authenticated user can list and download the bundles of a
  restricted repository — is **pre-existing** (the same list already returned
  them before the wave) and is filed as **#1558**.
- **Code review (high):** nine findings, all dispositioned — seven fixed in the
  wave (the two download sites, the two i18n key paths, the missing column
  leaf, the unreachable `ensureRepos` catch → the action's RESULT is now
  checked, the pager keys), one re-scoped (the `bundleSelection` refusal
  branch stays as the stated RULE — the primary guard is the list filter — and
  its comment now says so), one documented (the 50-repository list limit).
- **Live:** pending the tree sync — the manual smoke plan is in the MR body.

### The decisions the wave took beyond the story

- **The switch is always rendered** (not OKF-flag-gated): it is the surface's
  own control and the way back from the artifacts pane, and a parked
  deployment gets an explanation instead of a switch that leads nowhere. The
  artifacts PANE is gated (`v-else-if="okfEnabled"`) and explains itself.
- **No delete affordance anywhere** — dropped, not made to work. A privileged
  write path would build on the rule W7 is about to reverse.
- **`FileDetailsDialog` is deliberately NOT wired to the shared vocabulary:**
  its mapper takes a DISPLAY string (the crawl arms included) and answers with
  a different default ('pending', not 'info'; 'killed' → 'error'). Sharing the
  module with it would change existing renderings — out of scope for this wave.
- **The e2e spec lives in `tests/e2e/okf/`** (out of the CI invocation): the
  CI deployment runs the OKF pillar PARKED, so the surface does not render
  there. The CI comment now states that reason (the old one — "until MR2
  lands" — was stale).
