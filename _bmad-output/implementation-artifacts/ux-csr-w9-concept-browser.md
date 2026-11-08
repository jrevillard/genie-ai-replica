# UX Design Pass — W9 Concept Tree Browser (D8)

Story: EPIC-9 / W9 (concept tree browse) of the chat-source resolution initiative.
Pass type: story-time `create-ux-design` equivalent (D8) — the in-dialog information
architecture the modal is built against. Recorded BEFORE any modal code, per the
spec's frozen ordering. The SURFACE question (modal vs inline) was already resolved
by D8 at planning time: **a separate modal dialog** — chat real estate is tight.

## 1. Information architecture — progressive ALPHABETICAL LIST, not a rendered tree

**Decision:** the dialog's left pane is a flat, title-sorted, progressively
assembled concept list. Related-concept hops render as chips under the open
concept, not as a nested tree.

**Why not a tree:**

- The index carries **author links only** (the scale-safe split — parser edges
  reach 483k rows on Bali and never enter the index). Author edges are sparse:
  ~13–16k across 6k concepts (~2–3 outgoing per concept). A tree built from
  sparse author edges renders most of the corpus as disconnected orphans — the
  visual structure would LIE about reachability.
- The acceptance criterion is "every concept in the repo is reachable by
  walking". A flat list guarantees that trivially; a sparse tree cannot.
- Progressive assembly (pages of 200 committed as they land, the
  `fetchConcepts` stale-guard pattern) renders usable content from the first
  page — a tree needs the whole edge set before its shape is meaningful.

**Structure:**

- Left pane: filter input + concept table (DsTable, hoverable rows, click to
  open) + a running count (`{n} concepts`) + a loading line (`Loading {done}
  of {total}…`) while pages are in flight. A client-side "Show more" window
  (100 rows at a time) keeps the DOM bounded on a 6k-concept repo — the full
  index is in memory, only a window renders.
- Right pane: the open concept — title, rendered markdown, related-concept
  chips (each a hop), download verb.

## 2. Mobile behaviour

- DsModal already collapses to 95% width below 480px; the dialog uses `lg`
  (800px) on desktop.
- The two-pane grid stacks into one column below 720px. The detail pane, once
  a concept is open, covers the list; a **"Back to list"** ghost button sits
  at the top of the detail pane (hidden at desktop widths by CSS, always
  present in the DOM so the affordance is testable).
- The filter row stays above the panes at every width — filtering is the
  primary navigation gesture and must survive the stack.

## 3. Entry affordance placement

- **Card grid (chat answers):** a compact "Browse repository" row rendered as
  a SIBLING of the citation card button (buttons never nest), directly under
  the card — the same slot pattern the CAP-4/W5 origin rows use. Renders only
  on **working** OKF citations (`isOkfConceptSource(d) && d.repoId && d.id`);
  a pre-CAP-1 row without repo identity gets no affordance (no dead entry).
- **Right sidebar:** the same row inside the citation card, under the origin
  rows; click emits `browse-document` to the parent, which opens the SAME
  dialog instance (one dialog, two entry points — never two implementations).
- Copy: "Browse repository" — verbs what the citizen does, names nothing
  about versions.

## 4. Current-state semantics (frozen spec requirement)

- A notice line sits at the top of the dialog body, before any content:
  "Showing what is indexed now — not necessarily the version that was
  cited." Present in all 14 locales.
- No version selector anywhere in the dialog (`bundle_version` stays
  provenance identity — no version-pinned views, per the frozen boundaries).

## 5. Per-hop behaviour and failure honesty

- Every concept open (from the list, from a chip, or the initial cited
  concept) fetches through the CAP-2 route under the caller's own scope
  (`fetchOkfConcept`), and renders client-side with the MarkdownIt +
  DOMPurify pipeline (html allowed, sanitized — the `OkfMarkdownEditor`
  recipe). No server rendering endpoint.
- A fenced/gone concept renders "This concept is not available." in the
  detail pane — never a dead link, never a generic error toast.
- A fenced/absent REPO renders "This repository cannot be browsed right
  now." as the whole dialog body — the 404 anti-enumeration refusal stays
  honest and quiet.
- Download reuses `downloadOkfConcept` (unicode-safe filename); disabled
  until a concept is open.

## 6. DS primitives

DsDialog (lg, actions → Download/Close via `action(key)`), DsTable (the
list), DsPill is reserved for future status decoration (not needed in this
slice — no status vocabulary applies to a browse index), DsSpinner (the
loading overlay + per-hop loading), DsInput (the filter), DsButton. No raw
styled elements beyond the pane layout, which is dialog-local CSS using the
DS tokens (`--space-*`, `--text-*`, `--border`, `--surface`).

## 7. Scale responsiveness

- 6k-concept repo: 32 sequential index pages (≤200 rows each), first page
  usable immediately, progress line until the walk ends; render window of
  100 rows + "Show more"; hops and list clicks are one CAP-2 fetch each.
- Reopening re-assembles from scratch (current-state semantics); closing
  keeps the last state until the next open so a mis-tap costs nothing.
