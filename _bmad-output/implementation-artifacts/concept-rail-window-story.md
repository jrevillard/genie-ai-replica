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

## Security workflow (standing)

Focused /security-review BEFORE changes (result: no new inputs, no new sinks —
the diff is client-side render slicing over already-fetched store data; no new
deps, no new i18n strings); full-diff review after implementation paired with
/code-review (high), then /simplify, then verification-before-completion.

## Ship checklist

- CHANGELOG bullet under Unreleased → Changed (perf, okf-editor).
- BMAD: this story rides the MR at `_bmad-output/implementation-artifacts/`.
- GitLab: #2189 `in-progress` at branch cut; MR body carries `Closes #2189`;
  squash merge (hard rule).
- Deploy to the local build + re-run concept-window e2e with the re-armed
  ≤ 5 s warm-open assertion BEFORE merge.
