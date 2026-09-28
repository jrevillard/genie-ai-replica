# Story 3.10 — OKF Wizard UX Remediation

| | |
|---|---|
| **Epic** | Epic 3 — OKF Studio (Vue admin UI) |
| **Status** | planned (implementation sweep starts 2026-09-28) |
| **Design source** | [`okf-wizard-ux-review-2026-09-28.md`](okf-wizard-ux-review-2026-09-28.md) (rev 3 FINAL — decisions D1–D8 locked via multiple-choice rounds with David) |
| **Trigger** | David's field report 2026-09-28: "the wizard is quite unusable in its current form" |
| **Priority** | P0 sweep first; blocks David's practical-usage E2E pass (readiness doc W8) |

## Problem (field report, 2026-09-28)

1. **Source picker unusable for crawls** — no search (backend `GET
   /files?search=` exists, never wired), no way to tell crawl files from
   uploads (doc-repo records no origin), no scoping to the crawl that
   just ran; the user re-picks from the entire repository dump 50 at a
   time.
2. **Blank canvas dead-ends after first save** — the Input step shows a
   COUNT ("N topics so far"): no file list, no index, no add button, no
   way to edit a saved concept a second time. The full workbench exists
   two steps later in Curate (embedded OkfRepoEditor) but the authoring
   step never reuses it.
3. **Step 7 Auto-correct ships placeholder text** ("lands in Story
   10.2") — a visibly dead step.
4. **Directive:** review the whole wizard for non-expert practical use;
   every step carries all prior data and edits; focus on creating,
   editing, curating the repo's files; maximum automation.
5. **Constraint (permanent):** publishing is OUT of the wizard —
   submit → approve → publish live only in the dashboard and the editor.

## Design decisions (D1–D8 — binding, full rationale in the design doc)

| # | Decision |
|---|---|
| D1 | Crawl files tagged `source=crawl` + `crawl_session_id` + `crawl_seed_url` at creation; `source` filter param beside `search` on `GET /files` |
| D2 | Multi-crawl merge: exact-slug auto-merge silently; near-duplicate titles flagged in per-source merge accounting; resolved in Curate; no LLM at conversion |
| D3 | Crawl stays fully independent; the decision "free-form GRAPH ingest vs build OKF repo" lives ONLY in the crawler results dialog; user builds OKF from 1+ crawl files; wizard receives a pre-seeded draft |
| D4 | Step 9 → **Handoff** (repo summary + "publish happens on dashboard/editor"); zero publish affordances, permanently |
| D5 | Light workbench + focused edit dialog at Input; full three-pane editor stays in Curate |
| D6 | ALL source feeders always visible at Input once the repo exists (crawl files · upload any format · import .md · type new); the Entry variant only pre-highlights and shapes initial seeding |
| D7 | Auto-label: KH L2 labeler auto-runs over unlabeled topics on Labels-step entry (progress shown, preview refreshes) |
| D8 | Outside-curation round-trip: export concepts as .md zip (concept_id names, frontmatter, INDEX) + re-import updates in place; tree shows what changed |

## Task breakdown

### P0 sweep (this story's core)

- **T1 — Tagged source picker** (D1, D3): origin+session+seed-URL stamp
  at file creation (crawler + upload paths); `source` filter param on
  `GET /files`; OkfSourceDialog: debounced search, filter chips
  (All|Crawls|Uploads|Links), per-row provenance badges, crawl-session
  grouping; crawl variant multi-select with session grouping; draft
  pre-seeding from the crawler results handoff (session file ids).
- **T2 — Universal workbench** (D5, D6): Input step 2 = concept tree
  (grouped, searchable, index pinned, provenance + updated-at per row)
  + all feeders always + add/edit dialog (ConceptEditor in a modal) +
  delete/retitle. No count-only states anywhere.
- **T3 — Merge accounting** (D2): Produce kicks per-file conversion
  (sequential, repo-scoped, F5-idempotent); per-source accounting list
  (topics produced · auto-merged · near-dupes flagged); near-dupes
  surface in Curate.
- **T4 — Auto-correct wire-or-remove** (placeholder today): embed the
  editor's AutocorrectPanel if the 10.2 backend supports it; otherwise
  remove the step from the stepper until it does.
- **T5 — Step 9 → Handoff** (D4): summary (topics, labels, PII,
  validation) + dashboard/editor handoff buttons; publishRepo()
  already removed — strip the last publish semantics + rename.

### P1 follow-ups (same story, next slices)

- **T6** — formatted-file import (PDF/HTML/DOCX) through the docling→
  producer pipeline, splitting into 1+ concepts with per-topic
  provenance; entries from both the documents picker and the workbench.
- **T7** — auto-label on Labels-step entry (D7) + backend op
  "label unlabeled concepts".
- **T8** — round-trip export zip + re-import-as-update (D8) + backend
  export endpoint.
- **T9** — crawler-results decision point UI (D3) + draft handoff.
- **T10** — readiness checklists (Curate E5.1, Validate E6.1, Review
  E8.1) + context-rail mini-tree (E10.1) + produced-topic preview
  (E3.2).

### P2 polish

- E0.1 rename link · E1.1 card hints · E3.3 conversion warnings ·
  E4.2 unlabeled count · E5.2 arrival flash · E5.3 near-dupe markers ·
  E6.2 validation summary · E10.2 narrative what/when/why pass.

## Backend dependencies (all small, additive)

1. Origin/session/seed-URL stamp + `source` filter (T1).
2. Crawler→wizard handoff payload — session file ids (T1/T9).
3. Auto-label-unlabeled op (T7).
4. Conversion accounting view — per-source status aggregation (T3);
   conversion endpoint unchanged.
5. Repo export zip endpoint (T8).

## Acceptance criteria

1. A non-expert can: crawl (in the crawler, hours, tagged) → decide at
   the crawler results → wizard opens pre-seeded → add any source type
   at any time → watch per-source conversion with merged-topic
   accounting → curate one tree → validate → review → hand off to the
   dashboard ritual. **Publishing never appears in the wizard.**
2. Every saved concept is visible in the tree and re-editable from
   Input; no step shows a bare count where content exists.
3. The source picker offers search + origin filters + provenance badges;
   crawl sessions group and pre-select.
4. Step 7 is either functional or absent — no placeholder text ships.
5. All prior-step data and edits remain visible in every later step
   (draft write-back + the tree).
6. i18n: every new string lands in all 14 locales (fill-missing-locale-
   keys pipeline); DS primitives + tokens only (UI-must-use-DS rule).
7. **Smoke harness extended** for every new surface (smoke-per-story
   rule) and re-run live until green.

## Test strategy

- Frontend jest: OkfSourceDialog (search/chips/badges/multi-crawl),
  Input workbench (tree/add/edit/feeders), Produce accounting, Handoff
  step, wizard step list.
- Backend jest (okf-server + document-repository): stamps, `source`
  filter, auto-label op, export zip, accounting aggregation.
- Live smoke on the local build after each task; David's practical-usage
  E2E pass is the story's done-gate.

## Out of scope

- Server-side drafts collection (10.5, still deferred).
- LLM-assisted merge detection at conversion (rejected in D2).
- Any publish/ritual affordance inside the wizard (D4 — permanent).

## Dev log

- 2026-09-28: story created from the rev-3 design review; decisions
  D1–D8 locked with David (multiple-choice rounds); P0 sweep queued.
