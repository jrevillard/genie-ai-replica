# OKF Wizard UX plan — rev 3 FINAL (design decisions locked)

**Date:** 2026-09-28 · **Status:** reviewed, corrected by David (rev 2),
design decisions decided via multiple-choice rounds (rev 3). Ready for
sprint planning → implementation.

## Decisions ledger (David, 2026-09-28 — binding)

| # | Decision | Choice |
|---|---|---|
| D1 | Crawl tagging | `source=crawl` + **crawl_session id + seed URL** — picker groups "Crawl of naat.digital (47 pages)"; handoff pre-selects exactly one session |
| D2 | Multi-crawl merge policy | **Exact-slug auto-merge silently** (same page crawled twice = no dupes); near-duplicate titles flagged in the merge accounting, resolved in Curate; no LLM at conversion |
| D3 | Crawl decision point | **Crawler results dialog ONLY.** Crawl is fully independent infrastructure; THE USER decides to build an OKF repo from 1+ crawl files. No wizard coupling, no dashboard banner |
| D4 | Step 9 | **Repurpose as Handoff** — publishing is OUT of the wizard permanently (submit → approve → publish live only in dashboard + editor) |
| D5 | Workbench depth | **Light workbench + edit dialog** at Input (concept tree + add/import/delete + focused edit dialog); the full three-pane editor stays in Curate |
| D6 | Add-content model | **ALL feeders always visible** at step 2 once the repo exists — crawl files · upload any format · import .md · type new. The Entry variant only pre-highlights a feeder and shapes initial seeding. "Once it is an OKF repo there is NOTHING to stop us from adding files from any source type" |
| D7 | Auto-label timing | **Auto-run on Labels-step entry** — KH L2 labeler over unlabeled topics with progress, then preview; steward adjusts in Curate |
| D8 | Outside-curation round-trip | **Zip of .md** (concept_id filenames, frontmatter intact, INDEX listing the tree) + re-import updates in place; workbench shows what changed |

**Design thesis:** the wizard is a staging bench for one living thing —
the repo's concept tree. Sources are feeders (crawl sessions, documents
of any format, markdown, hand-typing); the tree is visible everywhere;
curation happens in the editor's real components; the wizard hands off
to the dashboard ritual. Publishing never appears in the wizard.

---

## Step-by-step plan

### Step 0 — Entry (name + subject area)
Sound. E0.1 (P2): link the rename note to the actual rename action.

### Step 1 — Choose workflow
- **E1.1 (P1):** "best when…" one-liners per card.
- **E1.2 (P1):** the crawl card is an ENTRY POINT, not a crawler:
  "Crawl your site in the Document Repository first (it can take hours),
  then come here and pick the pages" + deep-link to the crawler.
- **E1.3 (P1, D3): the crawler results dialog gains the decision point:**
  after a crawl, "N pages crawled → [Ingest into free-form GRAPH
  (1-by-1, as today)] | [Build an OKF repository from N files]" — the
  OKF path opens the wizard with the draft pre-seeded (source=crawl,
  document_ids = the session's files). One file remains possible
  (today's file-details path keeps working); N is now equally native.

### Step 2 — Input: the universal workbench (D6)
**The variant model dissolves after creation.** The repo's source choice
seeds INITIAL content; from then on Input shows everything:

- **E2.1 (P0): the concept TREE** (D5): grouped by type, index pinned,
  searchable; each row: title, type, label chips, provenance (which
  source file/URL produced it), updated-at. Click → **edit dialog**
  (ConceptEditor in a focused modal — D5: full editor stays in Curate).
- **E2.2 (P0): ALL FEEDERS, ALWAYS (D6):**
  - *Crawl files* — tagged picker (D1: session+seed-URL grouping,
    search, filter chips All|Crawls|Uploads|Links, badges); select 1+N.
  - *Upload* — any format from this computer (formatted files route to
    conversion per E2.6; .md lands directly).
  - *Import .md* — as today (idempotent upsert, F13 slug dedupe).
  - *Type new* — AddConceptModal (title/type/markdown).
- **E2.3 (P0): SEARCH + PROVENANCE in the source picker** — debounced
  `GET /files?search=` (supported, never wired) + origin stamps +
  `source` filter param (backend dep #1).
- **E2.4 (P0): initial-seeding gate respects the variant** (crawl needs
  ≥1 crawl file, documents ≥1 source, manual ≥1 concept, clone free) —
  but the gate governs only FIRST advance; the feeders never lock.
- **E2.5 (P1, D8): round-trip** — "Export concepts (.md zip)" and
  re-import = update-in-place; the tree marks externally-touched files.
- **E2.6 (P1): formatted files SPLIT** — PDF/HTML/DOCX go through the
  docling→producer pipeline and land as 1+ concepts with per-topic
  provenance ("from report.pdf · pages 12–18"). Never one blob per file.

### Step 3 — Produce: conversion with merge accounting
- **E3.1 (P0, D2): per-source conversion, merged topics, visible
  accounting.** Kick the existing per-file conversion per selected
  source (sequential, each repo-scoped + F5-idempotent). Accounting per
  source: "crawl-session-a → 14 topics (2 auto-merged by slug) ·
  report.pdf → 9 topics (3 near-dupes flagged)". Near-dupes surface in
  Curate for resolution. Progress = per-source list, not one bar.
- **E3.2 (P1): produced-topic preview** after conversion (N topics +
  names + provenance; jump to Curate).
- **E3.3 (P2): conversion warnings inline.**

### Step 4 — Labels: auto-run (D7)
- **E4.1 (P1): entering the step auto-runs the KH L2 labeler over
  unlabeled topics** (progress shown; preview refreshes; converted
  topics already labeled stay). Adjust in Curate.
- **E4.2 (P2): explicit unlabeled count + jump.**

### Step 5 — Curate: the refinement surface
Full editor (as today). E5.1 (P1) readiness checklist (topics ·
unlabeled · PII pending · structural warnings, click-to-fix); E5.2 (P2)
flash newly produced topics on arrival; E5.3 (P2) near-dupe resolution
markers for merged crawls (from D2).

### Step 6 — Validate
E6.1 (P1) beyond PII: empty bodies, missing frontmatter, dead internal
links (list + jump-to-fix). E6.2 (P2) pass/fail summary first.

### Step 7 — Auto-correct
**E7.1 (P0): wire the existing AutocorrectPanel or REMOVE the step** —
placeholder text shipped today reads as broken.

### Step 8 — Review
E8.1 (P1): consolidated readiness checklist + one deep-link: "submit →
approve → publish happens on the dashboard and editor". E8.2 (P2):
versions/logs/rename stay.

### Step 9 — Handoff (D4)
**E9.0 (P0):** summary (topics, labels, PII, validation) + the explicit
statement that publishing happens via the dashboard/editor ritual.
Buttons: "Open the Dashboard" · "Open the Editor". Zero publish
affordances, permanently.

### Cross-cutting
E10.1 (P1) context-rail mini-tree (the tree, always visible, click
through to workbench/Curate). E10.2 (P2) narrative what/when/why +
best-RAG-results copy. E10.3 (P2) wizard as the repo's home — reopening
lands with the tree current.

---

## Backend dependencies (small, additive)

1. **Origin + session + seed-URL stamp** at file creation
   (`source`, `crawl_session_id`, `crawl_seed_url`) + `source` filter
   param on `GET /files` (D1, E2.3).
2. **Crawl→OKF handoff** — the crawler results dialog exposes the
   session's file ids to the wizard draft (D3, E1.3); data exists at
   the crawler.
3. **Auto-label unlabeled concepts** op (D7, E4.1).
4. **Conversion accounting view** — per-source conversion status in one
   place (E3.1); the conversion endpoint itself is unchanged
   (per-file kick, repo-scoped).
5. **Repo export zip** endpoint (D8, E2.5) — reads existing concepts;
   re-import reuses /import upsert.

## Priority order

| # | Enhancement | Priority |
|---|---|---|
| 1 | Universal workbench: tree + all feeders + search/provenance (E2.1–2.4) | **P0** |
| 2 | Merge accounting per D2 (E3.1) | **P0** |
| 3 | Auto-correct wire-or-remove (E7.1) | **P0** |
| 4 | Step 9 → Handoff (E9.0) | **P0** |
| 5 | Crawl tagging + decision point in crawler dialog (E1.3 + deps 1–2) | P1 |
| 6 | Formatted-split import (E2.6) + auto-label (E4.1) + round-trip (E2.5) | P1 |
| 7 | Checklists (E5.1, E6.1, E8.1) + preview (E3.2) + mini-tree (E10.1) | P1 |
| 8 | Polish set (E0.1, E1.1–2, E3.3, E4.2, E5.2–3, E6.2, E8.2, E10.2–3) | P2 |

**Acceptance:** a non-expert crawls (independent, hours, tagged) →
decides at the crawler results → wizard pre-seeded → adds ANY source
type at ANY time → watches per-source conversion with merged-topic
accounting → curates one tree → validates → reviews → hands off to the
dashboard ritual. Publishing never appears in the wizard. Every step
shows all prior data and edits through the tree.
