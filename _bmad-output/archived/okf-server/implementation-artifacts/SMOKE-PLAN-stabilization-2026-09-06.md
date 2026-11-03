# Stabilization Smoke Plan — 2026-09-06

**Executor:** David (manual UI + import steps)
**Coordinator:** me (prep gates P1–P4, API harness, fix verification)
**Scope (David-confirmed):** full stabilization set — editor rework, delete
idempotency + double-fire guard, glossary i18n pass, re-import of the SAME two
inputs. Acceptance of this plan = current scope complete → course correction starts.
**Protocol (David-confirmed):** run the full stage, collect every FAIL with repro
steps, batch-fix, delta re-run of failed steps only.

---

## Stage 1 — runs on the current build

### Preconditions (coordinator + 15 — NOT David; I announce "Stage 1 ready")

- **P1** okf-server container rebuilt with 947248c33 (delete idempotency live).
  Roll check: marker string `registry entry already gone (racing delete)` present
  in the running container.
- **P2** Frontend served with 28d95820b (editor rework). DONE — six markers verified.
- **P3** API harness green: R1–R9 plus new cases — live double-DELETE (no 500),
  title cleanliness (no `http`, no slug artifacts), link-density floor on the
  alphabet fixture.
- **P4** `.env` gates unchanged from the last import run
  (`OKF_IMPORT_CONCURRENCY=4`, PII lanes ×4).

---

### A. Editor rework — ConceptEditor (~15 min)

Open any draft repo → open a concept in the editor.

| # | Step | Expected |
|---|------|----------|
| A1 | Look at the Frontmatter bar | Parsed fields visible at a glance (type, title, labels) — not blank |
| A2 | Expand the Frontmatter bar | Per-field edit form opens; fields pre-filled from the concept |
| A3 | Edit a label + save | Validation runs; valid save persists — reload the concept, change still there |
| A4 | Enter an invalid value (e.g. clear a required field) | Validation error shown in plain language; no silent accept |
| A5 | Source mode: use the toolbar (bold, heading, list, link) | Markdown syntax inserted at the cursor each time |
| A6 | Switch modes: Preview / Split / Source only | Preview renders the markdown; Split shows source + render side-by-side; Source is editable text |
| A7 | Hover the ⓘ icons on domain terms (Frontmatter, etc.) | Plain-language explanation appears |
| A8 | Open the graph view, then close and REOPEN the repo | Graph renders both times (no blank pane) |
| A9 | Start editing concept 1, switch to concept 2 mid-edit | No stale-state clobber: concept 2 shows concept 2's content |

### B. Delete idempotency (~5 min) — needs P1

The two broken repos from the last round (wikipedia + alphabet) are the targets —
this also clears the way for C/D.

| # | Step | Expected |
|---|------|----------|
| B1 | Delete the first old repo (single confirm click) | Success (no 500); repo leaves the dashboard |
| B2 | Delete the second repo — click the confirm button RAPIDLY 2–3× | Still no 500; repo deleted exactly once; dashboard consistent |
| B3 | Refresh the dashboard after both deletes | No ghost cards; lane counts correct |

### C. Re-import — wikipedia crawl (~60–75 min wall clock)

Kick off as before: crawler → "Create OKF repository" from the crawl
(file `en-wikipedia-org-full-crawl`, the 114 MB source), Subject Area selected at
kickoff, classification = **Heuristics**.

> **Duration expectation (NOT a FAIL):** ~55–75 min. Import is PII-scan-bound at
> current lanes (~2× faster than the original 2 h). "Hours" = FAIL; "about an
> hour" = PASS. The dashboard shows live progress (building state), not a frozen
> card.

| # | Step | Expected |
|---|------|----------|
| C1 | Subject Area selector at kickoff | Selector present; required (no silent "General") |
| C2 | Watch progress during conversion | Human stages visible (fetch → build → check → organise); card tracks to completion |
| C3 | On completion, open the repo | Concepts present; NO ghost "11-hour" card afterwards |

### D. Re-import — alphabet zip bundle (~10 min)

Import the same "alphabet inc okf v0.2" zip via the Studio create dialog,
Subject Area + classification selected.

| # | Step | Expected |
|---|------|----------|
| D1 | Import completes | Minutes, not hours; success report shown |
| D2 | Open the repo | Concept count matches the bundle; no silent drops of `.md` entries |

### E. Post-import verification — BOTH repos (~15 min)

| # | Step | Expected |
|---|------|----------|
| E1 | Concept titles in the list | Clean titles — no `http`, no underscore/slug fragments |
| E2 | Graph view (wikipedia) | Clusters with visible edges BETWEEN topic nodes — not a single line of isolates |
| E3 | Graph header/link count | Materially higher than the broken run's 83 links |
| E4 | Graph view (alphabet) | The bundle's declared links resolve — concepts interlink, incl. links from `index.md` |
| E5 | Concept types | Mix of types (topic/entity/...), not everything forced to one type |
| E6 | Labels | Label options bounded to the repo's Subject Area (KH L2); no cross-domain junk |
| E7 | Open any concept → editor | Frontmatter shows the born links[]; graph projection matches |

---

## Stage 2 — delta pass (after 15's remaining queue lands)

Short pass, only these steps, plus any Stage-1 FAIL re-runs:

| # | Step | Expected |
|---|------|----------|
| S1 | Domain terms across dashboard / wizard / editor | ⓘ tips present on the glossary terms; copy reads as plain language |
| S2 | Switch UI locale (e.g. de or fr) on a wizard step | The formerly-owed picker/frontmatter keys render translated (spot 2–3 keys); no raw key slugs |
| S3 | Delete a throwaway repo; watch the confirm dialog | Dialog locks while pending (button disabled/spinner) — double-click does nothing |
| S4 | Crawler kickoff UI | Plain-language guidance visible (what a crawl does, what happens next); no bare jargon-only fields |

---

## FAIL log (append below; repro steps + screenshot/console for each)

**Stage 1 verdict: REJECT — 2026-09-07 (David, interview). A1–A9 + B1–B3 PASS.**
C/D/E FAILs registered in full (with evidence + root causes) at
`_bmad-output/implementation-artifacts/stage1-defect-registry-2026-09-07.md`:
D-A index flag lost on bundle roots (flat/tree broken) · D-B "LLM assisted" is a
silent no-op — no labels, no GPU (THE headline; auto KH-L2 labeling = David's top
priority) · D-C retract keeps the graph (Kenya v4 orphan in DB) · D-D descriptions
absent · D-E every crawl page typed 'topic' · D-F only 4 fm fields editable ·
D-G activity log lacks method/decisions · D-I first alphabet-LLM import failed
(tracing) · D-K wikipedia cross-link density 7.4% of concepts (See-also pruning
suspect). Re-test gates listed in the registry §Re-test.

## Acceptance

- Stage 1: all A/B/C/D/E steps PASS (duration expectations respected per C).
- Stage 2: S1–S4 PASS + any delta re-runs PASS.
- Result recorded here → current scope declared complete → BMAD course
  correction (import-scope gap analysis) starts immediately after.