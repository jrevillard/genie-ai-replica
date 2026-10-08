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

## Open questions (for David sign-off before code) — DECIDED 2026-10-08

### Q1. Edit surface — Markdown YAML view only

The curator edits the per-repo tags directly in the YAML
frontmatter block at the top of the OKF repo's `index.md`,
in the existing Source / Raw markdown view of the editor's
center pane. Same surface they already use for every other
concept's frontmatter. No new component, no structured form
projection, no dual-surface reconciliation.

**Why this is the right answer**: the structured form was the
option that created the original Story 1.6 confusion (two
surfaces to keep in sync — form vs YAML). The YAML is
already the canonical surface for every other concept's
frontmatter; making the per-repo tags another field in the
same block keeps the mental model to one concept.

The wizard's Curate step renders the index.md body in
Source view by default, with the existing "Refresh
suggestions" CTA at the top. The CTA writes the proposed
set INTO the YAML block; the curator edits the block in
raw YAML and saves (the debounced PATCH writes through to
`okf_repositories.frontmatter`).

### Q2. Missing YAML block — On-demand, only when the curator clicks Refresh

When the wizard's "Refresh suggestions" CTA runs on a
repo whose `index.md` has no `frontmatter:` block, the
suggest handler inserts one (empty) AND populates it with
the proposed set in one save. The block only exists for
repos that have used the suggest flow at least once. No
unsolicited edits to old repos.

**Why**: a repo that has never used suggest has no
per-repo frontmatter — fine, the publish gate fails
`FRONTMATTER_REQUIRED` and the curator is told to use
suggest. The block's first appearance is the suggest
response, which makes the block a meaningful authoring
artifact, not boilerplate. Repos whose frontmatter was
created by the old `okf_repo_frontmatter` collection
get the block via the migration script (one-shot,
idempotent).

### Q3. Retriever hot-path read — Lazy embed on first read, cache forever

The retriever reads `okf_repositories.frontmatter` on
every routing decision (one doc per carrier repo, no
joins, no separate collection to maintain). On the first
read for a given repo, it embeds the unique tag values
via the existing TEI client (one call, returns N vectors
in one batch). The vectors are cached in-process keyed
by the value string (so a sibling repo with the same
tag reuses the vector). Net cost: ~1ms per repo per
process restart, replacing the precomputed summary
row's savings. Steady-state: zero tag-embed cost.

**Why this is the right answer**: tag values are
re-used across sibling repos (a Google-related tag
appears in multiple Google-adjacent repos). The string-
keyed cache means the second repo to use a tag pays
zero embed cost. The cold-start 1-2s is acceptable —
the first routing decision is the only one that pays.

### Q4. Approval model — Per-row `approved_at` (unchanged from Story 1.6)

Each tag in `okf_repositories.frontmatter` carries an
`approved_at` timestamp (per-row). The publish gate
checks: at least 3 topic + at least 1 forbidden + every
row approved. The YAML block in index.md renders
unapproved rows in a parallel `_unapproved_frontmatter:`
block (YAML keys prefixed with `_` are conventionally
ignored by parsers, but a comment-based representation
is also valid; the migration handles either).

**Why this is the right answer**: per-row approval
preserves the partial-approval option (a curator who
wants to keep one LLM-suggested tag out of the
routing decision can decline to approve just that
row). The publish gate is unchanged from Story 1.6
(≥3 topic + ≥1 forbidden + every row approved) — only
the storage location moves. The migration script
preserves any existing `approved_at` from the old
`okf_repo_frontmatter` collection rows so the operator
workflow on `.102` is not disrupted.

### Q5. (resolved by Q1) The new `<FrontmatterPanel>` component is removed entirely

Q1 chose markdown YAML view only, so the structured
form projection is out of scope. The
`<FrontmatterPanel>` component, the frontmatter
controller, the dedicated `/api/okf/repos/:id/frontmatter`
GET/PATCH endpoints, the `okf_repo_frontmatter` collection,
and the `okf_repositories_frontmatter_summary` collection
are all removed by Story 1.7. The retriever's
`_load_frontmatter_summaries` /
`_score_repo_by_frontmatter` /
`_select_repos_by_frontmatter` functions are
rewritten to read `okf_repositories.frontmatter` (the
field on the existing repo doc) and to embed lazily
on first use.

The selection-based tag-authoring UX (the
deferred-work entry from earlier today) becomes
natural after this refactor: the curator selects text
in a concept body (center pane, where the markdown
already renders), a "Add as topic tag" CTA appends
to the index.md's `frontmatter.topic` list via the
existing write-through. That UX is a separate
story that DEPENDS on Story 1.7 being done first.

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

## Dev-log 2026-10-08 (live session on feat/okf-server, local build C:\Dev\builds\main)

This session shipped a chain of fixes + one directive change that
SUPERSEDES parts of the Q1/Q5 resolution above. Recorded here so the
story stays the source of truth.

### Directive change: the FrontmatterPanel chip UI is RESTORED (supersedes Q5)

Q5 above resolved "FrontmatterPanel removed entirely; YAML center
pane is the only tag surface." David reversed this live
(2026-10-08): "the previous UX was great... it is just that it saved
to a 2nd overlay frontmatter structure which was not necessary."
The panel is back, mounted in BOTH the wizard Curate step AND the
editor right rail (always visible on every concept — the editor must
perform ALL wizard operations). Only the storage target changed:
the two-write path (index concept PATCH + repo doc PATCH via
`okf.js:saveFrontmatter`).

### Approval UX dropped (supersedes Q4's per-row approved_at)

David: "the approve button is not needed as the tags should be saved
to the frontmatter which will be editable by the user." Existence in
the frontmatter = approved. `approved_at`/`_approved` are no longer
produced by the client; the publish gate (lifecycle-service.js) now
checks only ≥3 topic + ≥1 forbidden. Refresh suggestions REPLACES
the local view (curator re-adds what they want).

### Story 1.7a — vectorized head on publish (NEW)

`buildVectorizedHead(repoId, fm, opts)` in frontmatter-service.js:
embeds every tag via the shared TEI service, per-field weighted
averages (topic 1.0 / entity 0.7 / keyword 0.5 / summary 0.5 /
scope 0.3; forbidden computed but excluded from the head average),
single bundle-level vector + human-readable head text stored on
`okf_repositories.head` (additive: {text, vector, per_field, dim,
model, version, computed_at, computed_by}). Called from BOTH publish
branches (supplied + auto-suggest), best-effort (TEI outage never
blocks publish). The retriever does NOT read `head` yet — wiring it
into routing is the follow-up (see the head-tester feature request,
below).

### Concept dialog renders the per-repo fields as form rows

The per-concept frontmatter dialog decomposes the `frontmatter:`
sub-block into labeled rows (Topic/Entity/Forbidden/Keyword as one
textarea each — one tag per line; Scope/Summary as inputs). No
per-field Add buttons; the textarea IS the control ("users should
not have to modify raw markdown for this"). Save does the same
two-write as the chip panel. `frontmatter` is a reserved extras key.

### Bug chain fixed (live on the local build)

1. **Save failed** — `saveFrontmatter` did `(await
   import('frontmatterService')).default` but the module is
   named-exports-only → `patchFrontmatter` threw before any HTTP.
2. **Dialog rows rendered empty** — `PER_REPO_FIELDS` is a
   module const, invisible to the template; exposed via a
   `perRepoFields()` computed (same pattern as `fmKinds()`).
3. **en.js duplicate `frontmatter:` key** — two literals in one
   object; the second shadowed the first at runtime + failed
   lint:frontend (no-dupe-keys). Merged.
4. **Publish 409 on every publish** — the gate's AQL was
   `RETURN r.frontmatter, r.name` (invalid multi-return AQL);
   fixed to `RETURN r.frontmatter`. Repro'd live on repo
   "NCD Information" (f043215b, 46 concepts).
5. **Layout** — wizard 70vh bounded, step area scrolls internally,
   footer pinned; Step 9 Review embeds the editor compact
   (metadata rail collapsed, 260px file rail).
6. **lint:frontend warnings** (max-warnings 0): v-html false
   positive documented (DOMPurify runs in the chunked renderer),
   Stepper computed/methods order, panel attribute order.

### Commits (feat/okf-server)

9eba9d7e, f5176dd3, 8169193a, 81f7f45b, f3a4bfc6, d7c88a43,
8aa0035d, eeac48e5, 408b8086 — all pushed; local build
C:\Dev\builds\main fast-forwarded to match (verified
byte-identical; canonical D:\ITU-Gitlab is the source of truth).

### Next (the feature request this story feeds into)

Head-tester: view the stored head + vector set; test routing
selection with keywords/queries; LLM-generated test suites +
analytics; publish → test → revert-to-review → re-tag → republish
cycle until accuracy is good, THEN ingest. Design in progress
(2026-10-08).
