# Story 1.7 — Frontmatter lives in the repo doc + index.md (architectural correction)

> **Status: DRAFT — David 2026-10-08 architectural correction to Story 1.6.**
> Story 1.6 stored per-repo tags in a dedicated `okf_repo_frontmatter`
> ArangoDB collection (one row per tag, with per-row vector). David
> called out at the live-validation review that this creates TWO
> disconnected frontmatter surfaces (the new collection + the
> existing per-concept markdown frontmatter on `index.md` and every
> concept file). The curator expected tags to live IN the index.md
> frontmatter — the natural authoring surface, visible in the
> editor's center pane. The spec was wrong on the storage shape.
> This doc supersedes §1 + §1a of
> `spec-1-6-frontmatter-routing-publish-gate.md` and defines the
> corrected architecture.

## The user-facing experience (David 2026-10-08: "the user should be able to modify the tags in the existing frontmatter editor both in the wizard and the OKF editor")

The curator sees **one** frontmatter, in **one** place — the YAML
frontmatter block at the top of the OKF repo's `index.md`. They
edit it the same way they edit the rest of the index.md content:
in the existing markdown editor, both in the wizard and the OKF
Studio editor. The "existing frontmatter editor" is the markdown
center-pane they already use for every other concept's
frontmatter; the per-repo tags just live in the same place.

### In the OKF Studio editor (right rail + center pane)

Today (Story 1.6): the right rail has a per-concept meta pane
(type / title / label / status) AND a `<FrontmatterPanel>`
component for per-repo tags. The center pane renders the
currently-selected concept's body in Source / Rendered toggle.

After Story 1.7: the right rail keeps the per-concept meta
pane (unchanged). The `<FrontmatterPanel>` is gone — the
per-repo tags now live in the **index.md's YAML frontmatter
block** in the center pane, alongside the existing per-concept
markdown frontmatter. The curator opens the index concept in
the tree, sees its markdown body in the center pane, and
edits the `frontmatter:` block directly:

```yaml
---
type: index
title: Alphabet Annual Reports
labels: [corporate, financial, regulatory]
links: []
frontmatter:
  topic: [google-services, alphabet-investment, financial-reporting, regulatory-governance]
  entity: [alphabet-inc, google, deepmind, cloud, calico, ...]
  scope: regulatory
  forbidden: [consumer-products, hardware, marketing, advertising, retail, education]
  summary: This repository covers Alphabet's financial and governance disclosures across the Google services portfolio.
  keyword: [10-q, segment-revenue, antitrust]
---
```

The structured form in the right rail (per-concept meta:
type / title / KH label) is unchanged. The curator can also
get a **structured view of the per-repo frontmatter** — the
right rail shows a "Per-repo frontmatter" card BELOW the
per-concept meta when the index concept is selected, rendered
as the same DS form components the wizard Curate step uses.
This card is **read-only by default, editable on click** — the
underlying markdown is the source of truth, the card is a
structured projection of the YAML. Save writes back to the
YAML, which debounces a PATCH to the repo doc.

### In the wizard (Curate step)

Today (Story 1.6): the Curate step embeds the full editor
plus a `<FrontmatterPanel>` Tags sub-card at the top.

After Story 1.7: the Curate step renders the index.md
markdown body (Source view by default, with the existing
"Refresh suggestions" CTA at the top). The curator can edit
the `frontmatter:` block directly. The publish step's
`frontmatterOk` gate reads the repo doc's `frontmatter` field
on save — same as today's gate, just sourcing from a
different field. The wizard's gate doesn't care WHERE the
curator authored the change (markdown view vs structured
form); it cares that the repo doc has the field set.

### Why this is much cleaner

1. **One concept**. There is exactly one "frontmatter" — the
   YAML block at the top of the markdown body. The curator
   already knows this concept from authoring every concept
   file. The per-repo tags are just another field in the
   same block.
2. **One editor surface**. The existing markdown center
   pane is the editing surface. No new component, no new
   tab, no new key concept to learn. The structured form
   in the right rail is a convenience projection of the
   same data, not a parallel surface.
3. **One storage**. `okf_repositories.frontmatter` (new
   doc field) is the canonical store. The index.md YAML
   block is the curator-facing projection. Two writes per
   save, atomic transaction. No dedicated collection to
   keep in sync, no denormalized cache to rebuild.
4. **One place to look when the curator asks "where did
   my tags go?"** — open the index.md in the editor and
   read the YAML. Done.
5. **The selection-based tag-authoring UX (the
   deferred-work entry from earlier today) becomes
   natural**: the curator selects text in a concept
   body (center pane, where the markdown already renders),
   a "Add as topic tag" CTA appends to the index.md's
   `frontmatter.topic` list via the existing write-through.
   One interaction, one place to see the result.

## Why

## Why

- **Authoring**. The curator's primary authoring surface for an OKF
  repo is the index.md markdown file (it exists for every repo by
  design — see `conceptService.createRepo`). The existing per-concept
  markdown frontmatter on every concept file is the curator's metadata
  authoring surface. Storing the per-repo tag set in a SEPARATE
  ArangoDB collection created a third authoring surface the curator
  had to learn, and the new FrontmatterPanel UI was a wrapper around
  that surface. The editor's "Edit index.md" view never showed the
  tags because index.md didn't have them.
- **Disambiguation**. Two "frontmatters" — per-concept (markdown on
  each concept file) and per-repo (the new ArangoDB collection) — is
  the wrong mental model. The per-repo tag set IS just another field
  in the per-repo frontmatter, which lives where the curator expects
  it: in the markdown frontmatter of the repo's index.md.
- **Migration cost is bounded**. Story 1.6 was only deployed on the
  local build as of 2026-10-08 (no `okf_repo_frontmatter` rows in
  the cloud's published repos yet). The migration script
  `scripts/republish-with-tags.js` ran locally once, on one repo,
  producing ~28 rows. The migration to the new design is a
  one-shot lift-and-merge of those rows into the index.md markdown
  frontmatter, then a drop of the two old collections. Reversible
  if a regression shows up.

## New design

### Storage

The per-repo tag set lives in TWO places that stay in sync via
write-through:

1. **`okf_repositories.frontmatter`** (new field on the existing
   repo doc — additive, no schema migration needed beyond a default).
   Shape:
   ```json
   "frontmatter": {
     "topic":    ["google-services", "alphabet-investment", ...],
     "entity":   ["alphabet-inc", "google-services", "deepmind", ...],
     "scope":    "<single word or empty string>",
     "forbidden": ["consumer-products", "hardware", "marketing", ...],
     "summary":  "<1-2 sentence user-perspective summary>",
     "keyword":  ["<short phrase>", ...],
     "version":  <int; bumped on retract+recurate>,
     "updated_at": "<ISO8601>",
     "updated_by": "llm:<model_version>" | "curator:<user_id>"
   }
   ```
   This is the **canonical storage** — the retriever reads from
   here, the operator migration script writes here, the
   publish-gate check reads here.

2. **The `index.md` markdown frontmatter** of the same repo. The
   YAML frontmatter at the top of `index.md` carries a structured
   block:
   ```yaml
   ---
   type: index
   title: <repo title>
   labels: [<KH labels>]
   links: [<link list>]
   frontmatter:
     topic: [...]
     entity: [...]
     scope: ...
     forbidden: [...]
     summary: ...
     keyword: [...]
   ---
   ```
   This is the **curator-facing storage** — the editor's center pane
   renders it, the curator edits it in markdown form if they want.
   The two stay in sync via write-through on every save: a PATCH to
   the API updates BOTH the repo doc field AND the index.md
   markdown frontmatter, atomically (Arango transaction).

### Read paths

- **Retriever hot path** (`genieai_retriever_arangodb.py`):
  `FOR r IN okf_repositories FILTER r._key IN <carrier_graphs>
  RETURN r.frontmatter` — one row per carrier repo, no joins, no
  per-tag lookups. The retriever embeds the tag values lazily on
  the first query for a repo (one TEI call per unique value, cached
  in memory keyed by value-string). Net effect: the retriever's
  hot path loses the 1-2ms that the precomputed summary row saved
  (it now does the TEI call once on first read), but gains
  architectural simplicity — no denormalized cache to keep in sync.
- **Curator UI** (the existing `ConceptEditor.vue` / `RepoEditor.vue`
  center pane): reads the markdown frontmatter of the currently
  selected concept (or index.md if the index is selected). The
  per-repo tags are visible in the index.md's frontmatter block.
  No separate panel.
- **Wizard Curate step**: the new `<FrontmatterPanel>` is REMOVED.
  The Curate step becomes a read-only preview of the index.md
  frontmatter's `frontmatter:` block, with one CTA ("Refresh
  suggestions") that calls POST `/api/okf/repos/:id/frontmatter/suggest`
  to populate the block. The curator then saves index.md to persist.

### Write paths

- **POST `/api/okf/repos/:id/frontmatter/suggest`** (unchanged
  contract — reads concept-meta, calls vLLM, returns the suggested
  set). The curator's UI then renders the suggestion IN the
  index.md frontmatter block, in markdown form. The curator
  edits the block if needed.
- **PATCH `/api/okf/repos/:id`** (the existing repo doc PATCH,
  already supports a `frontmatter` field via `validators/repository-validator.js`):
  the editor's center-pane save debounces a PATCH with the new
  index.md body. The controller's existing PATCH handler updates
  the repo doc's `frontmatter` field AND the index.md file in a
  single Arango transaction. The lifecycle `publish:` hook
  re-validates the new frontmatter block (per the spec's
  FRONTMATTER_REQUIRED gate) and re-embeds the tag values.
- **The dedicated `okf_repo_frontmatter` + `okf_repositories_frontmatter_summary`
  collections are DROPPED** (renamed to `_deprecated` for one
  release, then `DROP COLLECTION` in the migration script).

### Publish gate

The hard publish gate (≥3 topic, ≥1 forbidden, all approved)
now reads `okf_repositories.frontmatter` instead of querying the
old collection. The validation moves to a single doc field read
in the lifecycle `publish:` hook. No new endpoint, no new auth
gate.

### Operator migration

- **`scripts/republish-with-tags.js`**: still exists, but its job
  changes. It now writes to `okf_repositories.frontmatter` and to
  the index.md markdown frontmatter, in one AQL+FS write
  transaction. The lift-and-merge of any existing
  `okf_repo_frontmatter` rows is automatic on the first run after
  the deploy (the script reads the old collection, populates the
  new fields, drops the old rows).
- **One-shot migration on deploy**: `scripts/migrate-frontmatter-to-repo-doc.js`
  (new, ~50 lines). Reads every row in `okf_repo_frontmatter` and
  `okf_repositories_frontmatter_summary`, lifts them into
  `okf_repositories.frontmatter` on the matching repo doc, then
  drops the two old collections. Idempotent (re-running on an
  already-migrated DB is a no-op).

### Removed

- `components/okf-server/services/frontmatter-service.js` →
  the `okf_repo_frontmatter` + `okf_repositories_frontmatter_summary`
  collection constants, the `getFrontmatter` /
  `getFrontmatterSummary` / `embedAllTags` / `publishFrontmatter`
  functions that read/write those collections. The `suggestTags` +
  `validateFrontmatter` functions STAY (they're the LLM prompt +
  consistency check; the suggested set still goes into the
  per-repo frontmatter via the existing repo-doc PATCH).
- `components/okf-server/routes/okf-routes.js` →
  `GET /api/okf/repos/:id/frontmatter`,
  `PATCH /api/okf/repos/:id/frontmatter`,
  `POST /api/okf/repos/:id/frontmatter/suggest` (or these get
  re-pointed: the GET/PATCH move to the existing repo PATCH; the
  POST stays as a thin shim around the service's `suggestTags`).
- `components/okf-server/controllers/frontmatter-controller.js` →
  removed (its routes are gone).
- `components/gov-chat-frontend/src/components/okf/FrontmatterPanel.vue` →
  removed. The wizard's Curate step renders the index.md markdown
  directly. The editor's right meta pane shows the per-concept
  metadata only (the per-repo frontmatter is in the center pane
  where the curator expects it).
- `components/okf-server/scripts/republish-with-tags.js` →
  rewrites its data targets but stays in the repo (still useful
  for the operator workflow).
- The retriever's `_load_frontmatter_summaries`,
  `_score_repo_by_frontmatter`, `_select_repos_by_frontmatter`
  functions in `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`
  → rewritten to read `okf_repositories.frontmatter` instead of the
  old collection.

### Spec delta vs spec-1-6

- §1 ("New collection: `okf_repo_frontmatter`") → DELETED.
- §1a ("Denormalized hot-path cache: `okf_repositories_frontmatter_summary`")
  → DELETED.
- §3.1.1 ("`publishFrontmatter` writes to `okf_repo_frontmatter` +
  `okf_repositories_frontmatter_summary`") → REPLACED by: writes to
  `okf_repositories.frontmatter` + the index.md markdown frontmatter.
- §3.1.2 (UI surfaces) → REPLACED by: the editor's center pane IS
  the surface. The wizard's Curate step shows a read-only preview of
  the index.md frontmatter's `frontmatter:` block.
- §11 (migration) → REPLACED by the one-shot lift-and-merge.

## Open questions (for David sign-off before code)

1. **Markdown vs structured editing** — when the curator wants to
   edit the per-repo tags, do they (a) edit the YAML frontmatter
   in the index.md raw markdown view, or (b) see a structured
   form (DS components) that writes through to the YAML on save?
   The current editor has a "Source" / "Rendered" toggle in the
   center pane — option (b) means the existing structured meta
   panel absorbs the per-repo frontmatter; option (a) means the
   curator uses the markdown view. The recommendation is (a) +
   the structured form: the YAML is the source of truth, but the
   editor also renders a structured form (using the existing
   DsFormGroup patterns) that debounces a write-through to the
   YAML on every change. Best of both.
2. **Index.md exists for every repo, but the wizard's auto-create
   path may not always emit a `frontmatter:` block** in the YAML
   it generates. The migration needs to check: if `index.md` has
   no `frontmatter:` block, ADD it (with empty arrays) so the
   editor's center pane has a stable place to render the form.
3. **Retriever hot-path cost**. The precomputed summary row saved
   ~1ms per carrier graph on the embedding step. Reading
   `okf_repositories.frontmatter` and embedding tag values
   lazily on first query adds the same ~1ms once per repo per
   process lifetime (cached in memory). Net cost: 1ms per repo
   per restart. Acceptable; documented in the spec.
4. **The `FRONTMATTER_REQUIRED` publish gate's error message**.
   Today the lifecycle service's message says "repo frontmatter
   not set". The new design means the check reads a doc field —
   the message should be the same or clearer.
5. **The new `<FrontmatterPanel>` component on the editor's
   right rail** is being removed entirely. The per-repo tags
   move to the center pane (where index.md is rendered). The
   right rail keeps only the per-concept meta (type / title /
   label / index status / trust tier). The selection-based
   tag-authoring UX from the deferred-work entry (the curator
   selects text in a concept body and turns it into a tag)
   becomes natural here: the selection lives in the center
   pane, the action targets the index.md's `frontmatter.topic`
   list. That's a separate story after this refactor.

## Out of scope

- The `OKF_SEARCH_STYLE` env var and the three routing modes
  (`hybrid` / `frontmatter_tags` / `vector_probe`) are unchanged.
  Only the storage shape of the frontmatter changes; the
  routing pipeline's job (use tags when the active style is
  `frontmatter_tags` or `hybrid`, skip when `vector_probe`)
  is the same.
- The LLM suggest path (concept-meta → vLLM → proposed set)
  is unchanged in this story. Only the storage target of
  the proposed set changes (from `okf_repo_frontmatter` rows
  to `okf_repositories.frontmatter` doc field + index.md
  markdown).
- The selection-based tag-authoring UX (deferred-work entry
  "Selection-based tag authoring") stays deferred to a
  separate story that depends on this one.
