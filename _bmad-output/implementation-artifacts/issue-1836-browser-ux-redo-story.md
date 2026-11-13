# Issue #1836 — the OKF repository browser fails the UX standard: redo it

**Status:** IN PROGRESS (2026-11-14) — story written before code; verification results land at the end of this file.
**Order:** David, 2026-11-14, verbatim requirements (issue #1836):
the left list MUST use the same tree view as the OKF editor and the OKF
wizard; the browser MUST have back and forward buttons (it is a browser);
the rendered markdown must stay in view while the user clicks and scrolls
the tree; the global color scheme the other OKF components wear.
**Branch:** `feat/issue-1836-browser-ux`, cut from `origin/main` (`532a23755`).
**Supersedes:** the W9 UX pass's IA decision ("progressive alphabetical LIST
— author edges are sparse; the flat list is what makes every concept
reachable") is REVERSED by David's order. Recorded in the W9 spec's change
log.

---

## What exists (recon-verified, file:line)

### The browser (the thing being redone)
`components/gov-chat-frontend/src/components/okf/ConceptBrowserDialog.vue`
— one shared dialog instance owned by `ChatBotComponent.vue:564` for BOTH
chat surfaces (card grid + sidebar relay). Two panes: LEFT is a **flat
DsTable** (rows = concepts, row-click selects, Show-more window of 100);
RIGHT is the detail pane — and it is `v-if="selectedConceptId"`
(line 85): **it vanishes entirely when nothing is selected**. Store slice
`okf/browser` (`src/store/modules/okf.js:69-76`), stale-guard generation
counter (166-170), first-page fetch of 200 + sequential extend, per-hop
load via `documentOpener.fetchOkfConcept` with race guards. **No history
state exists** — `backToList` (dialog 330-334) is the only navigation
affordance. i18n namespace `chatbot.okfBrowser.*` (en.js:1379-1394).

### The tree view to reuse (editor + wizard's own)
`components/gov-chat-frontend/src/components/okf/editor/ConceptList.vue`
(`OkfConceptList`) — the single shared component BOTH the editor
(`RepoEditor.vue:17-34`) and the wizard (`steps/Input.vue:52-63`) mount.
Two-level tree: the `is_index` row becomes the root; every other row is a
child; ONE `expanded` boolean on the root twistie; status dots from
`index_status`; per-row test hook `okf-concept-row-<concept_id>`; client-side
filter over title/id/path/source; props `{concepts, selectedId, loading,
labelOptions, loadProgress, readOnly, showAddSource}`, emits
`select/resplit/add/delete/label/pii-bulk/open-source/add-source/reingest`
(348-361). CSS is BEM `okf-cl__*` on DS tokens (543-822).

### The living-intelligence layer
`src/styles/genie-visual-effects.css` — additive layer gated on
`html[data-visual='on'] .genie-living-intelligence`; all colours derived
via `color-mix()` from DS tokens. DsModal forwards `$attrs` onto the
teleported backdrop (`ds/Modal.vue:3,45` — the Teleport fallthrough fix),
so the dialog's gate class lands on `.ds-modal-backdrop`. The GENERIC
dialog recipe already applies to every gated dialog
(genie-visual-effects.css:1019-1022 — frost border + 5% gradient on
`.ds-modal`); the lab panes show the PANE recipe (1024-1033 — 4% gradient
panes, `--font-display` headers). **No `.okf-browser__*` rules exist yet.**
Scoped styles inside the dialog CANNOT match post-teleport — themed rules
key on the backdrop selector.

### The backend tree API (what the tree will eat)
`GET /okf/repos/:repo_id/concept-tree` (okf-routes.js:53) →
`getConceptTree` (repository-controller.js:1324-1343; restricted fence +
`isServingRepo` publication gate; steward keeps the editor contract) →
`conceptMetaService.listConceptTree` (concept-meta-service.js:558-615):
pages of 200 (clamp 1..500), alphabetical `SORT m.title, m.concept_id`,
ONE batched author-edge join, rows `{concept_id, title, links}` —
**no `is_index`, no `index_status`**. The graph name is the edge writer's
own (`edge-service.graphNameForRepo`); no drained graph → `links: []`.

### Tests that pin current behaviour (all must move WITH the change)
- `src/__tests__/components/okf/concept-browser-dialog.test.js` — notice,
  unavailable arm, count, Show-more windowing, filter, row-click dispatch,
  hop chips, DOMPurify, arms, back-to-list, download.
- `src/__tests__/store/modules/okf-browser.test.js` — slice contract,
  stale guards, race guards (15 tests).
- `src/__tests__/services/conceptService.test.js` — getConceptTree URL/opts.
- `src/__tests__/components/ChatBotComponent.test.js:6300-6435` — host
  wiring (ONE dialog, visible flags, browse-document relay) — unaffected by
  internal redesign.
- Backend `__tests__/concept-tree.test.js` — payload shape pins.
- Smoke `data/okf/smoke-test/run-smoke-chat-sources.mjs:289-346` — browse
  leg (pagination walk + row contract + one per-hop fetch + fences).

---

## Design decisions

### D1 — The tree is the EDITOR'S tree, faithfully (David: "the same tree view")
Reuse `OkfConceptList` itself — not a lookalike. The browser mounts it
`read-only` (no editor verbs: no resplit/delete/label/pii-bulk/add — the
browser is a reader), fed from the browser slice; `@select` drives the
existing `okf/browserLoadConcept` path. Hierarchy = the editor's own shape:
the `is_index` row is the root, all other concepts its children; repos
without an index row degrade to the component's own flat childless list —
exactly what the editor does in that case. Reachability is preserved for
every concept (children are ALL concepts, not only linked ones — the W9
sparse-edges concern stays answered); the author links keep their browse
role in the content pane's related-concept chips, now ALSO traversable via
history.

### D2 — The server payload gains the root signal (additive)
`listConceptTree`'s RETURN projection gains `is_index` + `index_status`
(one AQL line each — both fields already live on `okf_concepts_meta`; the
editor's tree needs the first, status dots use the second). Nothing else
about the page contract changes: same `{total, offset, limit, concepts}`,
same pagination, same author-edge join, same clamps, same fences. Payload
growth is two short booleans/strings per row — the bound stays.

### D3 — Back/forward = a real history stack in the slice
New slice state beside `selectedConceptId`: `history[]` (concept ids, most
recent last) + `historyIndex`. New mutations: `browserVisit` (append,
truncating any forward tail — the browser-history semantic), `browserBack`,
`browserForward` (move the index; the ACTION layer dispatches the hop load
for the resulting id with the existing same-repo/race guards). Buttons live
in the detail-pane header: back/forward DsButtons, disabled at the ends.
`openConceptBrowser` seeds the history with `startConceptId`. Back-to-list
STAYS (mobile stacking needs it) but no longer clears history — re-selecting
continues the same session.

### D4 — The content pane persists (the `v-if` bug)
The detail pane becomes always-rendered with four arms INSIDE it:
empty ("Select a concept from the tree" hint), loading (spinner inside the
pane — the pane never unmounts, never reflows the tree), markdown,
concept-unavailable. Per-entry scroll position rides the history entry
(stored on visit, restored on back/forward) so returning to a concept
lands where the user left it. Desktop keeps tree+content side by side —
clicking/scrolling the tree never touches the content pane; the mobile
(≤720px) stacking keeps back-to-list.

### D5 — The layer rules the browser is missing
The generic dialog recipe already covers the shell. This wave adds the
pane-level treatment under the X2 precedent, keyed on the backdrop:
`html[data-visual='on'] .ds-modal-backdrop.genie-living-intelligence
.okf-browser__pane` (the 4% gradient) + the pane header in
`--font-display` + the tree pane vs content pane distinction. Everything
derived via `color-mix()` from DS tokens; the layer stays additive (the
app must be identical with `data-visual='off'`); scoped dialog styles stay
token-only.

### D6 — Filter and count move to the tree component's own filter
`OkfConceptList` ships a client-side filter; the dialog's separate
DsInput filter + count label are redundant once the tree is the list. The
dialog keeps the count line (computed from the slice) but the filter UI is
the component's — one filter, not two. (If the component's filter input is
not prop-gated, the dialog passes pre-filtered rows and keeps its own
input — decided at implementation by reading ConceptList.vue's template;
either way ONE filter affordance reaches the user.)

### D7 — i18n and testids
New keys under `chatbot.okfBrowser.*`: `back`, `forward`, `selectHint`;
`backToList` stays (mobile). All 14 locales, deep-key-identical
(`localeConsistency` green), inserted verbatim (no template literals —
the bulk-i18n rule). New data-test-ids: `okf-browser-back`,
`okf-browser-forward`, `okf-browser-select-hint`; every existing
`okf-browser-*` testid survives (the rename-sweep rule — nothing is
renamed, only added; `okf-browser-table` retires WITH its tests when the
DsTable leaves, no orphan ids).

---

## Implementation order

1. **Backend payload (D2)** — `listConceptTree` RETURN + `concept-tree.test.js`
   shape pins + smoke browse-leg row contract.
2. **Slice history (D3)** — state + mutations + action guards;
   `okf-browser.test.js` pins the new contract (visit/back/forward/truncate,
   stale + race guards carry over).
3. **Dialog redo (D1/D4/D6/D7)** — OkfConceptList mount, always-rendered
   pane, back/forward, scroll restore; dialog tests rewritten for the new
   arms (Show-more → the component's own lazy pattern stays driven by the
   SAME dispatches — `okf/browserExtendConceptTree` contract unchanged).
4. **Layer rules (D5)** — genie-visual-effects.css pane treatment.
5. **i18n ×14** — codemod, verbatim strings.
6. **Suites** — frontend (dialog, store, service, host wiring,
   localeConsistency), okf-server (concept-tree), lint via
   `rtk proxy npx eslint` + pinned prettier.
7. **Deploy to the local build BEFORE merge** (frontend + okf-server
   images, marker-grep in containers) + live smoke browse leg + browser
   verify: tree renders, back/forward walks, pane persists, layer on/off
   identical layout.
8. **MR** — `Closes #1836`; workplan section (already in this branch)
   rides along.

## Out of scope
No backend route/fence changes; no editor/wizard behaviour changes
(OkfConceptList gains at most an opt-in prop if integration demands it —
flagged first per the shared-file rule); no new crawl/ingest behaviour.
