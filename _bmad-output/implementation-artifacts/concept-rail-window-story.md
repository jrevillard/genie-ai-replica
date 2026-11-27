# Story — #2189: the concept rail renders a window, not the collection

**Initiative context.** The OKF Studio editor's file rail (ConceptList.vue) v-for'd
EVERY concept of the open repository. On the 10,001-concept test repo that is a
10k-row DOM; the #2188 windowed crawl commits the array ~7 times per load
(one `setConcepts` per wave), and every commit re-diffused the full list — the
measured 2026-11-26 wall on a warm, network-fast open (crawl: **1.1 s** for all
32 pages) was still **~32–80 s** of pure rendering. David's live ruling moved the
issue's ≤ 5 s wall-clock acceptance from #2188 to THIS story.

## Design (settled, kept minimal)

Progressive windowed prefix — not a virtual-scroller library, not top+bottom
offsets:

- `RENDER_CHUNK = 120` — rows added per scroll extension.
- `FULL_RENDER_LIMIT = 300` — collections at or under the limit render exactly
  as before (no slices, no spacer): the common repo's DOM is byte-identical to
  the pre-#2189 component. This is the blast-radius fence.
- `virtualList` computed picks the mode: `'children'` (index parent's children
  sliced), `'top'` (flat list sliced), or `'full'` (untouched tree).
- `visibleTree` is the only template-facing change; the children v-for renders
  the pre-sliced `node.children`.
- A tail spacer `<li>` (height = unrendered rows × `AVG_ROW_HEIGHT = 36`) keeps
  the scrollbar honest.
- `onListScroll` on the scroll container extends the window when the viewport
  bottom comes within `EXTEND_LEAD = 600` px of the rendered height; the
  `$nextTick` re-check keeps filling after a deep jump (End key / fling) —
  extension swaps rendered rows for spacer height so `scrollHeight` never
  changes and the browser emits no follow-up scroll event.
- The filter watcher re-windows (`renderedCount = RENDER_CHUNK`) so a small
  result always renders fully; a `totalCount` watcher clamps when the
  collection shrinks under a wide window.

## Non-goals / fences

- No new dependencies; no virtual-scroller lib (permissive-OSS policy would
  apply, but the hand-rolled window is ~40 lines and the list is a two-level
  tree — a lib buys nothing here).
- The PII bulk bar, labels, fail-card, split affordance, selection semantics:
  untouched — rows render through the same handlers.
- No `scrollIntoView` added; the component does not steal scroll.
- The wizard's workbench mounts the same component and inherits the windowing
  (intended — the wizard sees the same large repos).

## Acceptance

1. A 10,001-concept collection mounts O(viewport) rows, not 10,001 (unit:
   < 300 rows mounted), with the tail spacer present.
2. A second full-array commit (a #2188 wave commit) does NOT grow the rendered
   count — the re-diffusion cost the measured wall is gone.
3. Scrolling near the rendered bottom extends the window (unit: extension
   within one chunk, still far from full render).
4. A 150-concept repo renders fully — no spacer, DOM indistinguishable from
   today (preservation anchor).
5. The filter's (small) result renders fully with no spacer.
6. Selection still emits from a rendered row (preservation anchor).
7. **The amended acceptance David ruled onto #2188 re-arms HERE**: live on the
   local build, open a 10k-class repo warm — wall clock ≤ 5 s, first rows
   paint within ~0.5 s, asserted in the concept-window e2e spec.

## Test plan (TDD — the suite was RED before the implementation)

Six pins in `ConceptList.test.js` (the mount tests are order-independent and
each asserts its own contract): the four behaviors above plus the two
preservation anchors. The DsInput stub carries the real v-model contract
(`props: ['modelValue']` + emits `update:modelValue`) — a bare input stub
swallows `setValue` and the component never sees the filter.

## Review round 1 (code-review high — 6 findings, all dispositioned)

1. **e2e spec breaks + the ≤ 5 s assertion missing** — FIXED. The spec's
   row-count contract moved to the windowed one (`expectWindowedRail`:
   O(viewport) rendered + the spacer covering the collection via
   `scrollHeight` bounds), the ≤ 5 s warm-open acceptance is ASSERTED, and
   the deep-jump-fill is proven live (scroll to the bottom → the prefix
   renders through).
2. **Extension dead in 2 of 3 mounts** — VERIFIED true and FIXED. The wizard
   bench and the concept browser scroll AROUND the rail (their own panes
   scroll; the rail's ul never overflows), so a capture-phase document
   scroll listener keys on the spacer's viewport position
   (`extendFromAncestor`, re-check-chained like the ul path). It stands
   down when the ul itself overflows (the editor mount owns extension) and
   is covered by two jsdom pins (pinned rects, as with pinned scrollTop).
3. **Filter watcher kept the deep scroll position** — FIXED: the watcher
   resets `scrollTop = 0`; the stale offset would otherwise clamp against
   the shrunken content and cascade the window back open per keystroke.
   (jsdom cannot reproduce the clamp cascade honestly — live-verified.)
4. **Collapsed rail churns hidden rows** — FIXED: `canGrow()` refuses
   extension while the children are collapsed (each extension would shrink
   the spacer and render nothing visible). Pinned.
5. **Hardcoded 36 px row estimate** — FIXED: one real row read after mount
   (`measureRowHeight`) drives the spacer and the extension lead; the
   constant is only the no-layout fallback, so the scrollbar stays honest
   when the DS spacing tokens move.
6. **Repo-size contradiction in the shipped claims** — FIXED: the bullet
   says 6,352 (the live-measured repo), matching the component/test
   comments and the #2188 story amendment.

Plus one transition bug found while pinning finding 2: a FULLY-rendered
collection growing past the limit (the browser dialog's Show-more page, a
re-crawl on a small repo) previously snapped the window to 120 and made
rows vanish mid-session — the window now carries over, bounded at the
limit. Pinned.

Security review: empty findings list (client-side render slicing; the one
`:style` binding is structurally numeric). jsdom limitation recorded: the
filter-scroll reset cannot be unit-pinned (no layout, no clamp cascade) —
verified live on the local build instead.

## /simplify round (4 agents; applied, deferred, or dispositioned)

APPLIED:
- The two extension paths collapse into one `extend(trigger, chunk)`
  skeleton (gate → grow → recheck); the chunk DOUBLES per chained hop so a
  deep jump fills in ~7 hops instead of ~52 (each hop re-diffs every
  rendered row). Per-chain argument, never instance state.
- `onDocumentScroll` runs `canGrow()` (cheap reactive flags) before any
  DOM geometry read.
- The capture listener's lifetime is bound to `truncated` (a watcher adds/
  removes it) — full-mode mounts, the common repo, carry nothing on the
  document.
- The unreachable defensive clamps in `tailHeight`/`visibleTree` dropped
  (`renderedCount` is invariantly ≥ RENDER_CHUNK; the spacer renders only
  under `truncated`).
- The redundant `_railDead` re-check in the ul path's re-chain dropped
  (`canGrow` is the single gate).
- Test-file polish: the component import hoisted to module scope; the
  geometry pinning deduped into `pinListGeometry`.

DISPOSITIONED (kept as written):
- `hideFailCard` on the document path: deliberate, not drift — the card is
  viewport-FIXED, so any scroll that moves content under the pointer must
  dismiss it (the wizard/dialog mounts previously let it linger).
- The `totalCount` carry-over seed (the `_prevListFull` watcher): the
  modeling alternative (full mode AS a window) would make every collection
  growth jump the window to 300 unprompted — the seed buys the dialog's
  Show-more UX, pinned by test.

DEFERRED → issue #2204: `decorate()` WeakMap memoization (needs a
mutation-path audit first — stale decorated rows on in-place edits), the
`filtered()` haystack cache, the fenced host-CSS bound that would collapse
the two extension paths into one, and the IntersectionObserver polish.

## Issue #2204 — addressed IN this work plan (David's hard rule, 2026-11-27:
an issue filed mid-plan gets added to the plan and completed, not parked)

DELIVERED IN THIS MR (TDD: the reference-stability pin watched RED first):

- **`decorate()` memoized in a `DECORATED` WeakMap** keyed on row identity —
  #2188's wave commits reuse the same row objects, so an already-loaded row
  never pays the spread + `sources.find` twice (~70k redundant spreads per
  10k open), and Vue's keyed diff gets a reference-stable v-for. The flat
  branch's wrapper spread is cached the same way (`FLAT_WRAPPERS`).
  **Mutation-path audit (the safety gate), 2026-11-27:** every okf concept
  mutation either refetches the whole list (`applyLabel`+`fetchConcepts`,
  `reingestFailed`+`fetchConcepts`, PII rescan paths, RepoEditor's
  add/delete/split flows) or replaces the row immutably (`patchConcept`
  spreads a new row at okf.js:1122). A repo-wide grep for in-place row
  field writes (`row.title =` & co) hits ONLY conversation.js — a different
  domain. No in-place mutation of okf concept rows exists in src, so row
  identity implies freshness; the maps are WeakMaps and die with their keys.
  jsdom confirms the win: the 10k mount test dropped ~590 ms → ~280 ms.
- **`filtered()` haystack cached in a `HAYSTACKS` WeakMap** — a keystroke
  no longer rebuilds 10k lowercase haystacks; it runs `includes` over the
  cached strings.

DISPOSITIONED (design decisions recorded here, not open work): the
component-owned height bound (would change the wizard's scroll UX; host
CSS is fenced and the change is David's to sanction), and the
IntersectionObserver sentinel (jsdom-opaque — the scroll+rect shape is
what makes the extension unit-testable). Issue #2204 is scoped to this
resolution and closes with this MR.

## Security workflow (standing)

Focused /security-review BEFORE changes (result: no new inputs, no new sinks —
the diff is client-side render slicing over already-fetched store data; no new
deps, no new i18n strings); full-diff review after implementation paired with
/code-review (high), then /simplify, then verification-before-completion.

## Found mid-wave: the graph's edge scan (fixed in !1107, 888a34f)

The re-armed warm-open e2e still measured a **37.5 s settle** with the rail
windowed. Probes: per-request timings (every request ends by ~5.5 s),
PerformanceObserver long tasks (ONE **43,854 ms** task), a CDP CPU
profile (frames = Vue reactivity + the OKF chunk's edge builder), a DOM
census (300 rows, no canvas - the graph's lazy build worked). Attribution:
**RepoGraphView's edges() computed ran a concepts.find PER LINK**
(O(links x concepts) through reactive proxies), and the HIDDEN pane still
renders its own template (edges.length in the toolbar), so the computed
re-ran on every crawl commit - the full-collection pass alone held the
main thread from ~4 s to ~48 s. The rail's fix exposed it: first rows
paint at ~0.4 s, then the scan ate the thread.

Fix (one line): the index-target check reads the byId map it already
builds - O(1), the same answer (under !showHub the nodes filter already
excludes index rows, so the dangling-link guard drops every index-target
edge before the branch can fire). Contract owned by the existing graph
pin (hub hidden -> TOC edge suppressed; toggle -> restored). Attribution
proven by removal: with the line changed, the warm open settles at
**3,472 ms** (was ~52 s) and the deep jump renders through 6,352 of
6,352. This section missed !1107's squash (written post-commit); it rides
the next code MR per the docs-merge rule.

## Ship checklist

- CHANGELOG bullet under Unreleased → Changed (perf, okf-editor).
- BMAD: this story rides the MR at `_bmad-output/implementation-artifacts/`.
- GitLab: #2189 `in-progress` at branch cut; MR body carries `Closes #2189`;
  squash merge (hard rule).
- Deploy to the local build + re-run concept-window e2e with the re-armed
  ≤ 5 s warm-open assertion BEFORE merge.
- SHIPPED: !1107, squash 0039b8c22, 2026-11-27 - warm open 3,472 ms,
  3/3 e2e, #2189 + #2204 closed.
