# OKF Studio — Crawler→OKF flow + Repo Editor (design spec)

Status: ready-for-dev
Branch: `feat/okf-server` (work lands here; per David's directive no merge to main until the v2.1 rebase)
Spec collected: 2026-08-27

## Goal

Fix the unwired "Create OKF repository" path in the crawler, then build the OKF repo editor in the Studio. After this lands:

1. Clicking "Add from Link" with target=OKF in the crawler dialog produces a real OKF repository (one click, no second confirmation). The full-site async flow also works (today it doesn't).
2. Clicking an OKF repo in the Studio dashboard opens an editor with two sub-tabs: **Wizard** (existing 10-step curate/publish flow) and **Editor** (new — markdown editor for index.md + per-concept source/rendered views + autocorrect).
3. Concepts are split per crawled page (default) with options for whole-crawl mega-concept or future LLM-based extraction.
4. Labels always come from the existing Knowledge Hierarchy (no free text). They sync immediately between Editor and Wizard.

---

## Part 1 — Crawler dialog

### Today (broken)

`AddFromLinkDialog.vue:34-48` has the OKF radio + crawl-mode radios + URL input. The submit button:

```js
if (this.okfTarget === 'okf_repo' && this.crawlMode === 'single_page') {
  // ... call okf/createFromCrawl → creates repo
}
if (this.okfTarget === 'okf_repo') {
  // Full-site async: dispatches legacy seed event (does NOT create repo)
}
```

Single-page works. Full-site silently does nothing on the OKF side. Single mega-concept regardless.

### Target behaviour

1. **One click creates the OKF repo** (or queues its creation for async). No second confirmation modal — the dialog itself shows a live preview of the crawl so the user knows what's about to become a repo.
2. **Full-site async**: dialog stays open, shows live crawl progress (status + pages crawled + a content preview pane). When crawl completes, the dialog shows a "Create OKF repo from these N pages?" summary with three split-mode radios (see Part 2). On confirm, the repo is created and dialog closes.
3. **Single-page**: dialog shows a 1-page preview, same three split-mode radios, "Create OKF repo" button. The full crawl is already done; the preview is a sanity check.
4. **The OKF target radio stays** — it gates the preview/split-mode UI in the dialog (freeform/document crawls skip all the preview UI).

### UI elements inside the dialog

- "Target" radio group (existing): `Freeform corpus` | `OKF repository` (unchanged)
- "Crawl Mode" radio group (existing): `Single Page` | `Full Site (Async)` (unchanged)
- **New (when target=OKF)** — "Concept split" radio group:
  - `One concept per crawled page` (default, recommended)
  - `One concept for the whole crawl` (mega-concept)
  - `Use LLM topic extraction` (greyed out with tooltip "Story 10.6 — coming soon" until that ships)
- **New** — Live preview pane (when target=OKF):
  - Crawl status header: `Crawling… 7 / 23 pages` or `Succeeded — 23 pages`
  - List of crawled pages with their URLs + content snippet (first200 chars per page)
  - "Cancel crawl" button (only shown while crawling)
  - When `status === 'Succeeded'`: shows the three split-mode radios + a primary CTA "Create OKF repository" + secondary "Back to freeform crawl"
- **New** — Post-create state: shows the new OKF repo name + "Open Studio" button (which fires the existing `okf:okf-repo-created` event + switches tab)

### Single-page fast path

For single-page crawls the preview pane can be skippable (the crawl is already done in <2s). On submit: dialog closes immediately, repo created in the background, `okf:okf-repo-created` event fires when done. The Studio opens with a "creating OKF repository…" spinner for the few seconds it takes.

---

## Part 2 — Concept split modes

All three split modes send N concepts in ONE `POST /api/okf/repos/:repo_id/ingest` call. The endpoint already accepts N concepts (`ingest-service.test.js:90`). No backend ingest change required.

### Mode A — one concept per whole crawl (mega-concept)
- 1 concept per crawl
- `concept_id`: slugified filename (e.g. `www-masaimara-travel-full-crawl`)
- `body`: the entire combined .md with the leading `## Source: <url>` stripped
- `frontmatter.sources[]`: ALL the crawled URLs in one array
- Useful only for tiny single-page crawls; rarely picked

### Mode B — one concept per crawled page (default)
- N concepts, one per page
- Split the combined .md on the `## Source: <url>` markers produced by `crawlWorker.js:211`
- For each section:
  - `concept_id`: slug of the URL path (e.g. `masaimara-travel-wildlife` from `https://masaimara.travel/wildlife`)
  - `body`: the markdown content between this `## Source:` and the next `---` or EOF
  - `frontmatter.title`: best-effort — first H1/H2 in the section, fallback to the URL path
  - `frontmatter.sources[]`: `[{kind: 'crawl', resource: <this page's url>, file_id: <doc-repo file_id>}]`
  - `frontmatter.type`: `topic` (hard-coded)
- Capped at `appConfig.crawler.maxPages` (default 1000) or a smaller OKF-specific cap if you want (50 default is sane)
- This is the recommended mode — gives you per-page granularity for retrieval + per-concept labels

### Mode C — LLM topic extraction (Story 10.6, deferred)
- Same shape as B but the boundaries come from the LLM, not the `## Source:` markers
- Greyed out in the UI until Story 10.6 ships
- The frontend slot is reserved so we don't have to redesign later

---

## Part 3 — Studio repo editor

### Layout (when a repo card is clicked in the Studio dashboard)

```
+-------------------------------------------------------------+
| Studio > <repo.name>                            [⋮ menu]    |
+-------------------------------------------------------------+
| [ Wizard ] [ Editor ] ← sub-tabs (Editor default)          |
+-------------------------------------------------------------+
| (sub-tab content)                                          |
+-------------------------------------------------------------+
```

### Editor sub-tab

Three panels (CSS grid: left rail + center + right rail):

- **Left rail — concept list**:
  - Header: "Concepts (N)" + filter input (matches title, body, URL)
  - Sort: by index_status (errors first → indexed → parsed), then by title
  - Each row: status icon + title (truncated) + URL snippet + label badge (if set)
  - Selected concept highlighted
  - Click row → loads concept into center pane
  - Bottom button: "+ Re-split from source" (opens a modal to pick A/B/C — deletes current concepts, re-ingests with the new mode; uses the cached doc-repo file_id)

- **Center pane — markdown editor**:
  - Top toolbar: [Source | Rendered] toggle (default Source), [Save] button, [Autocorrect] button, conformance badges (e.g. "0 errors · 2 warnings")
  - Source view: monospace textarea with line numbers, syntax-highlighted YAML frontmatter (first `---\n...\n---` block) + body
  - Rendered view: parsed HTML via `markdown-it` + `DOMPurify`; rendered view is read-only, shows a "Edit in source view" button to switch
  - Below the editor: file path (`concepts/<concept_id>.md` or `index.md`), last_saved_at, content_hash
  - Saving: debounced (1.5s after last keystroke) → calls `PATCH /api/okf/concepts/:concept_id` (new backend route — see Part 4). Shows "Saving…" → "Saved 2s ago" status.

- **Right rail — concept metadata + labels**:
  - Status: `index_status` with a tooltip explaining the state machine
  - Type (dropdown, sourced from a fixed enum: `topic` | `entity` | `process` | `event` | `source`)
  - Title (input)
  - Sources (list, read-only — shows the crawl provenance)
  - Label (single-select dropdown from `serviceCategories` collection — Knowledge Hierarchy)
  - Save status indicator
  - Trust tier (display only — set by mintVersion, not user-editable here)

### index.md view (when index.md is selected from the left rail)

The index.md is the bundle's root — it shows the manifest in markdown form (frontmatter + a table of contents linking to each concept). It edits the same `okf_repositories` doc + `okf_bundle_manifest` doc:

- Top frontmatter: title, bundle_version, summary stats (concept_count, link_count)
- Body: a markdown TOC table — editable, but auto-regenerated on save if the user leaves it empty
- "Regenerate TOC" button (regenerates the body from the current concept list)

### Wizard sub-tab

Existing `StudioWizard.vue` mounted with `draft.source = 'editor'` (or whatever — picked per design discussion). Sub-tab reuses the wizard verbatim. No code changes here — the wizard reads from the same store the editor writes to, so labels sync.

### Re-split from source

When the user clicks "+ Re-split from source" in the left rail:

1. Modal: pick split mode (A | B | C-disabled)
2. Confirm: "This will delete the current N concepts and re-ingest the source file. Continue?"
3. Backend call: `POST /api/okf/repos/:repo_id/resplit` `{mode}` → server deletes all `okf_concepts_meta` rows for this repo + the `OKF_<rid>_SOURCE` chunks + re-ingests using the doc-repo file linked to the repo. Returns new concept count.
4. Frontend refreshes the left rail.

Requires a new backend route — see Part 4.

### Autocorrect behaviour (frontmatter-only)

Per David's directive (Q8): frontmatter fixes only. Algorithm:

```
For each concept's frontmatter:
  if !frontmatter.type: set to 'topic', record warning
  if frontmatter.type not in [topic, entity, process, event, source]: record warning, don't change
  if !frontmatter.title: derive from first H1 in body or URL path, record info
  if frontmatter.sources is missing or empty: add empty array, record warning
  if frontmatter.status: if not in [active, draft, retired]: record warning
  body untouched
```

The [Autocorrect] button shows a preview modal listing every planned fix + every warning, then on "Apply" calls `POST /api/okf/repos/:repo_id/autocorrect` with the planned changes. Backend applies them atomically (concept-meta-service update + ingest re-record). Refreshes the editor.

Body normalization (trim whitespace, normalize headings) deferred per Q8.

---

## Part 4 — Backend contract changes (okf-server)

Three new routes (minimal, additive):

### `PATCH /api/okf/repos/:repo_id/concepts/:concept_id`

Updates a single concept's frontmatter + body. Body is the full markdown (frontmatter + body); server splits on the first `\n---\n` boundary. Persists to `okf_concepts_meta` + recomputes `content_hash` + resets `index_status='parsed'` if the body actually changed (so the worker re-indexes). Idempotent: same body → no-op + current_hash returned.

Permissions: `requireRepoScope('repo_id', 'admin')`. Authz: only the repo's admin scope or tools-admin can edit.

Returns: `{ok, concept_id, content_hash, index_status, updated_at}`. Returns 404 if concept not found, 409 if concept_id collides on a re-rename.

### `POST /api/okf/repos/:repo_id/resplit`

Body: `{mode: 'A'|'B'|'C'}`. Deletes all `okf_concepts_meta` rows for this repo + clears the `OKF_<rid>_SOURCE`/`_ENTITY`/`_HAS_SOURCE`/`_LINKS_TO` collections. Then re-ingests from the linked doc-repo file (looked up via `files.okf_repo_id`). Mode B requires the doc-repo file to be the combined .md format with `## Source:` markers (which is what the crawler always produces — works for both single-page and full-site).

Permissions: `requireRepoScope('repo_id', 'admin')`. Returns `{ok, total, parsed, created, rejected, enqueued, mode}`.

### `POST /api/okf/repos/:repo_id/autocorrect`

Body: `{dry_run?: boolean}`. Scans all `okf_concepts_meta` rows for this repo, applies the autocorrect rules (Part 3 — frontmatter only). With `dry_run: true`, returns the planned changes without applying. With `dry_run: false` (default), applies atomically (per-concept AQL UPDATE in a single transaction). Returns `{ok, changes: [{concept_id, before, after}], warnings: [{concept_id, rule, severity, message}]}`.

Permissions: `requireRepoScope('repo_id', 'admin')`.

### Wiring updates needed in okf-server

- `crawlerToOkfService.convertCrawlToOkf` already calls `POST /api/okf/repos` + `POST /api/okf/repos/:id/ingest` correctly. The new resplit route is what enables the "Re-split from source" action in the Editor.
- `repository-controller.js#createRepo` is currently strict on `createSchema` (rejects extra fields). To support `lifecycle_state: 'draft'` from the crawler path (cleaner than the current `register` default), add `.unknown(true)` to `createSchema` and forward `lifecycle_state` to `repoService.create(input, actor, { lifecycle_state })`. This is the pattern Story4.8-amend already uses for the clone flow. Tiny change.
- `concept-meta-service` needs an `updateConceptMeta(repo_id, concept_id, patch)` (or extend the existing `upsertConceptMeta` to accept a "force update if exists" flag). The PATCH route calls this.

---

## Part 5 — Frontend wiring

### Files added

- `components/gov-chat-frontend/src/components/okf/RepoEditor.vue` — the new Editor sub-tab (left rail + center pane + right rail)
- `components/gov-chat-frontend/src/components/okf/RepoWizardSubTabs.vue` — the sub-tab host (replaces the current direct mount of StudioWizard inside StudioTab)
- `components/gov-chat-frontend/src/components/okf/CrawlPreviewPane.vue` — the live preview inside the AddFromLinkDialog
- `components/gov-chat-frontend/src/components/okf/ConceptList.vue` — extracted from RepoEditor.vue for testability
- `components/gov-chat-frontend/src/components/okf/ConceptEditor.vue` — extracted from RepoEditor.vue for testability
- `components/gov-chat-frontend/src/components/ds/SourceRenderedToggle.vue` — reusable source/rendered toggle
- `components/gov-chat-frontend/src/components/okf/AutocorrectPanel.vue` — autocorrect modal
- `components/gov-chat-frontend/src/components/okf/ResplitModal.vue` — re-split modal

### Files modified

- `AddFromLinkDialog.vue` — target=OKF now opens CrawlPreviewPane; submit gated on CrawlPreviewPane's "Create" CTA
- `StudioTab.vue` — replace direct `OkfStudioWizard` mount with `RepoWizardSubTabs` (which itself contains Wizard + Editor sub-tabs)
- `store/modules/okf.js` — new actions: `patchConcept`, `resplitRepo`, `autocorrectRepo`, `setEditorSubTab`; new getters: `conceptById(repo_id, concept_id)`, `conceptsByRepo(repo_id)`
- `services/repoOkfService.js` — `patchConcept(repo_id, concept_id, body)` + `resplit(repo_id, mode)` + `autocorrect(repo_id, opts)`
- `services/crawlerToOkfService.js` — new `splitCrawlBody(rawMarkdown)` helper that produces N concepts per page (mode B). `convertCrawlToOkf` accepts `{splitMode: 'A'|'B'|'C'}` and routes accordingly.

### Tests

- `crawlerToOkfService.test.js` — new cases for `splitCrawlBody` (empty input, single page, N pages, malformed markers, very long pages)
- `RepoEditor.test.js` — mount with mocked store, assert sub-tab default = Editor; assert concept row click loads that concept into the center pane; assert source/rendered toggle; assert autocorrect shows the planned-changes modal
- `AddFromLinkDialog.test.js` — target=OKF renders CrawlPreviewPane; submit is gated on the pane's CTA
- `studio store` tests for the new actions (patchConcept, resplitRepo, autocorrectRepo)
- Backend: extend `repos-routes.test.js` with the three new routes (matrix style — 201/403/404/409)

### Smoke

- Extend `run-smoke.js` end-to-end: crawl → preview → mode B → wizard → editor → patch concept → autocorrect → resplit → mint. All R1-gated.

---

## Part 6 — Out of scope (explicit deferrals)

- Story 10.6 LLM topic extraction (UI slot reserved, route greyed out)
- Story 10.2 full autocorrect (currently a placeholder; this PR adds frontmatter-only)
- Real-time collaborative editing (single-user editor only)
- Production-grade markdown rendering with custom plugins (use `markdown-it` defaults + `DOMPurify` for safety)
- Version diff UI (existing minter produces versions; viewing diffs is a future story)
- Trust tier editing (read-only display in the right rail for now)
- Multi-language label picker (single-locale UI for now)
- Bulk concept editing (apply labels to N selected concepts)
- Markdown undo history beyond browser native
- Drag-reorder of concept list (sort by date or index_status only)
- Exporting the repo to a bundle .zip

---

## Risk + unknown

- **No assumptions about user permissions**: confirm `okf_repositories.label` write path doesn't bypass `serviceCategories` ACL. The label picker UI must only allow picking labels the user can already see in `serviceCategories`.
- **No assumptions about the wizard**: the existing `StudioWizard.vue` reads from `okf/selection` + draft state, not from `okf_concepts_meta`. The new Editor writes directly to `okf_concepts_meta`. To sync labels from Editor → Wizard, the wizard's Step4 labels step needs to repopulate from `okf_concepts_meta` after each Editor save. Will verify in implementation; may need a small wizard refactor.
- **No assumptions about the bundle manifest**: the `okf_bundle_manifest` row is currently written by the worker at ingest settle. Editing the index.md in the Editor updates the `okf_repositories` doc (frontmatter) + the manifest row. Need to confirm the manifest write path doesn't clobber Editor changes — will inspect during dev.
- **Markdown rendering safety**: any rendered HTML MUST go through DOMPurify (per existing pattern in `ConfirmDialog.vue`). Rendered view is read-only — no XSS surface via content edits because the user controls the source anyway.

---

## Acceptance criteria

1. Crawler dialog with target=OKF + Full Site produces an OKF repo (no second confirmation; one click + crawl wait + confirm in the dialog itself).
2. Mode B (default) split produces one OKF concept per crawled page, each with its own `concept_id`, `title`, `sources[0].resource`.
3. Mode A still works for tiny crawls.
4. Mode C UI slot exists, greyed out with "Story 10.6" tooltip.
5. Studio dashboard click → Editor sub-tab opens by default.
6. Editor left rail lists all concepts; clicking one loads its markdown into the center pane.
7. Source/Rendered toggle works; rendered view is read-only.
8. Autocorrect frontmatter-only runs, shows preview modal, applies atomically on confirm.
9. Re-split from source deletes + re-ingests with the chosen mode.
10. Label picker is single-select from the Knowledge Hierarchy; selecting a label writes immediately.
11. Wizard sub-tab reuses the existing 10-step flow; labels sync from Editor to Wizard on every save.
12. All tests pass + ESLint + Prettier clean.
13. Smoke extended; live-verified in `C:\Dev\builds\main`.

---

## Scope (this MR)

Per Q10 — yes to A, B, C (backend), and the defensive note:

- ✅ A — Fix the dialog (this MR)
- ✅ Studio repo editor (this MR)
- ✅ Backend contract changes (this MR)
- ✅ Defensive: NOT shipping without explicit confirmation on UI details during dev

Per Q10 — deferred (NOT in this MR):
- LLM extraction (Story 10.6)
- Real-time collaborative editing
- Bulk concept editing
- Drag-reorder
- Version diff viewer

---

## Order of work

1. Backend routes (PATCH concept, resplit, autocorrect) + tests — 1 day
2. okf-server `createRepo` lifecycle_state forwarding — 30 min
3. Frontend `splitCrawlBody` helper + `crawlerToOkfService.splitMode` param — 1 hour
4. Frontend `CrawlPreviewPane` + `AddFromLinkDialog` rewrite — 1 day
5. Frontend `RepoEditor` + `ConceptList` + `ConceptEditor` — 2 days
6. Frontend `AutocorrectPanel` + `ResplitModal` — 1 day
7. Frontend `RepoWizardSubTabs` + `StudioTab` rewrite — 1 day
8. Tests + smoke — 1 day
9. Live-verify in local build — 1 day