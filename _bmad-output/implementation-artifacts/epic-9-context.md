# Epic 9 Context: Concept tree browse (W9 / MR-9)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn a chat citation into an entry point into the knowledge base. From any cited OKF concept, the citizen opens a modal viewer that browses the ENTIRE repo's concept tree starting at that concept — every concept reachable, every concept viewable as rendered markdown — read-only, under the same scope authority as retrieval, with no steward UI. It must stay efficient at measured repo scale (6k+ concepts per repo): a lightweight paginated tree index, content fetched on demand, never the full corpus in one payload.

## Stories

- Story 9.1: Paginated tree-index route (whole repo, authz-filtered)
- Story 9.2: UX design pass + citizen-facing modal tree/browse viewer
- Story 9.3: Efficiency bounds, i18n, per-hop authz tests, Playwright + smoke harness

## Requirements & Constraints

- Every hop and every concept fetch loads through the scope-authorized concept path — per-request authz from the user bearer. Unauthorized concepts are unreachable (dedicated test) and excluded from the tree index itself.
- The tree-index payload is bounded and paginated, pinned by test at 6k-concept scale; a large repo never ships its full corpus in one payload.
- The viewer is a modal dialog per a UX design pass (create-ux-design) run at story time — not improvised.
- The entry affordance renders only on working citation cards (no dead affordance) and attaches to BOTH chat citation surfaces.
- No zip extraction anywhere in this epic (deferred with recorded guardrails).
- No new cache layer, no new mandatory env vars, no gateway change.
- Every new UI string ships in all 14 locales, key-identical; never author `okf.labErrors.*` keys (exact-21 producer pin).
- Coverage: every touched component ≥ its existing floor, no CI Statements% regression; Playwright locators use the chat-surface `data-testid` spelling (read the component first); the smoke harness is extended and live-run.
- The new route gets an OTel span per the observability rules.
- Success criteria: the walk works from any working citation; EVERY concept's markdown is reachable; per-hop authz enforced; the tree payload is bounded at scale; current-state semantics are documented in the UI copy.

## Technical Decisions

- Tree data comes from `okf_concepts_meta` plus within-repo `_LINKS_TO` edges; both `source='author'` and `source='parser'` edges are walkable.
- The tree index carries only id + title + tree shape; per-concept content (title, labels, body markdown) is fetched on demand via the concept-content route, never preloaded.
- Browse serves the repo's CURRENT indexed state. `bundle_version` stays provenance identity, not a time machine — no version-pinned views (logged assumption).
- The route mounts on the `servingReads` sub-router (the default-open structural marker — outside it, scopeless citizens 403 in open mode) and follows the concept-route pattern: user bearer only, `x-okf-internal-secret` nowhere on the path, no authz caching (the retrieval last-known-good-on-5xx pattern must not be imported), and the publication gate applies — a retracted/draft repo's tree is refused.
- No redis or any cache layer (unanimous panel decision): each fetch is a single indexed ArangoDB read; ETag/Cache-Control headers are the allowed freshness lever.
- The frontend reuses existing paradigms: DS primitives (DsDialog/DsTable/DsPill as applicable), the `okf` Vuex store, `okfRepoOps`; no new UX paradigms. A markdown-download helper already shipped in `document-opener.js` (`downloadOkfConcept`) — the download verb belongs in this viewer.
- Legacy surfaces untouched: no legacy chat-path changes; the mobile twin is out of scope (tracked separately).

## UX & Interaction Patterns

- The viewer opens in a separate MODAL dialog — chat real estate is tight (decision D8 resolved the surface question). The in-dialog information architecture (tree vs list vs progressive disclosure, mobile behaviour) is owned by the story-time UX design pass.
- The entry affordance attaches to BOTH citation surfaces (David, 2026-11-07): the related-documents grid under every chat response AND the right sidebar's per-conversation source list — they render the same citations, so the browser dialog opens from either; a card-only entry leaves the sidebar's citations without a working browse path.
- Browse starts at the cited concept and can reach the whole repo; the citizen can exit anywhere. Read-only, citizen-facing; steward tooling unchanged.
- UI copy must state the current-state semantics (browse reflects what is indexed now, not the cited version).

## Cross-Story Dependencies

- Hard ordering: EPIC-2 (concept content route) + EPIC-3 (citation cards) must land first — the tree walks the same scope-authorized concept path and enters from the working cards. Independent of EPIC-4..8; can interleave with them.
- Within the epic: the UX design pass (story 2) precedes the modal implementation; the tree-index route (story 1) is the backbone the viewer consumes; story 3 closes out with tests, i18n and the live smoke run across both.
