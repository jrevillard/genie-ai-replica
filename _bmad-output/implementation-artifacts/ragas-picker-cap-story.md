# Story — #2200: the RAGAS repo picker renders the whole catalogue

**Evidence (2026-11-26, 33+ repos):** the Benchmarks tab showed 25 checkboxes,
no more; the OPEN repository could be missing from them entirely while
`selectedRepoIds` still carried its id invisibly. Three causes: the hard
`.slice(0, 25)` in `loadRepoChoices()`; seed-before-load with no reconcile;
`repoOkfService.list()` sending no cursor — the store held only the first
server page (default 50), so past 50 repos the drops happened upstream of
the panel.

## Delivered (TDD — five pins watched RED first)

- **`repoOkfService.list()` follows `next_cursor`** with a hard cap
  (LIST_PAGE_CAP = 20 pages × 50/page = 1000 repos). Hitting the cap
  `console.warn`s (verbose-logging rule — never a silent drop). The legacy
  bare-array body still terminates in one request; the `{items}` unwrap
  (dashboard regression) is preserved. ONE production caller (the store's
  `fetchRepos`) — every consumer now sees the full catalogue. The pattern
  mirrors the okf-server conformance controller's bounded loop.
- **The cap is gone from `loadRepoChoices()`** — every fetched repo renders.
- **The current repo is always present**: injected at the TOP of
  `repoChoices` when the store list omits it (the template's 'current'
  pill + disabled checkbox already handle the rest), and the seeded
  selection is RE-ASSERTED after the load resolves — the mounted() seed
  runs before the await, so a mid-load clear cannot strand the mandatory
  selection.
- **The picker list is scroll-bound** (max-height 180px + overflow-y) —
  the visible delta of rendering 33+ checkboxes in the same space.

## Acceptance

- 31 rows render from a 30-row store + current repo (pin), including the
  injected current repo badged 'current' at the top when the store omits
  it (pin).
- The selection re-asserts after load (pin).
- The service follows the cursor across pages (pin), single-pages when
  there is no cursor (pin), caps + warns (pin), and terminates on the
  legacy array (pin).
- >50 repos: the cursor-following service IS the proof — the panel renders
  whatever the store holds, and the store now holds every page. Live check
  on the venue (33 repos, 1 page) rides the smoke pass; the 2-page shape is
  pinned at the service boundary.

## Non-goals / fences

- The picker's existing filter (current + HEAD clones when a repo is open;
  everything when not) is the panel's design — untouched.
- No virtualization: the issue virtualizes "past a few hundred"; the
  scroll bound plus the 2,000-repo service cap (20 pages x limit=100)
  keeps this MR minimal. If a venue ever approaches the cap the service
  warns and the cap is the visible place to revisit.
- okf-server: untouched — the endpoint already pages and the conformance
  controller already models the bounded loop.

## Review round (/code-review high — 6 findings) + security (empty)

SECURITY: empty findings list (the cursor is encodeURIComponent-ed into a
fixed-endpoint query VALUE — no host/protocol/path control; the injected
current-repo object renders through escaped interpolation; the loop is
bounded regardless of server output).

ADOPTED (three pins added, watched red first):
- A mid-loop page failure used to discard every page already fetched
  (re-creating the missing-repos symptom silently): pages in hand now
  resolve with a warn — only a FIRST-page failure throws into the
  caller's error path.
- Every page now sends limit=100 (the conformance controller's pattern):
  half the round-trips, the cap ceiling 2,000 repos.
- The cap warn fired on an exact-multiple boundary (the server sets
  next_cursor on every FULL page): the loop now probes ONE more page —
  a real truncation warns, a boundary does not, and the probe's page
  rides along.

DISPOSITIONED:
- The sibling's truncated flag (getConformanceDebt returns one): the cap
  here is a runaway guard for a state no venue approaches (2,000 repos),
  the warn is the signal, and a flag would ripple the return shape
  through the store and every list consumer for an unreachable state.
- The post-load re-assert 'defends a state nothing creates': the ISSUE'S
  OWN fix shape names the reconcile explicitly ('re-assert its selection
  AFTER the list load resolves') — the pin proves David's acceptance.
- The raw 180px max-height: height BOUNDS in this component family are
  raw by precedent (640px rail, 340px access panel, 60vh dialog); the
  padding rides the scale (var(--space-xs)).

Test-infra note: setup.js installs a file-lifetime jest.fn for
console.warn — spyOn on it leaks history across tests; the cursor
describe asserts on the shared mock with mockClear per test.

## Ship checklist

- BMAD: this story rides the MR; the #2189 story's "Found mid-wave" section
  (graph edge scan) rides ALONG — it missed the previous squash (written
  post-commit) and its durable copies are main's commit message + MR body.
- CHANGELOG bullet under Unreleased → Fixed.
- GitLab: #2200 in-progress at branch cut; MR body `Closes #2200`; squash
  merge. Review rounds per the standing workflow.
