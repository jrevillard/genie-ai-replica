# OKF end-to-end cycle — UI test readiness (work list + test plan)

**Created**: 2026-09-27, post-!474 merge. **Owner**: David Forden (the
tests are his); the work list below is what stands between here and a
clean end-to-end pass in the UI.

**The cycle under test**: create (manual / documents / crawl / clone) →
import/convert → curate (labels, editing, PII) → validate → review →
hand-off → submit → approve → publish (mint + bundle) → ingest (drain +
settle) → **serving checks** → **retract** → re-cycle (submit → approve
→ publish vNext → re-ingest) → retraction of the final version.

Story keys for the work items get assigned at the next sprint-planning
pass (they are deliberately NOT invented here — the yaml syncs against
epics.md).

---

## A. Work list (what stands between here and the E2E pass)

### W1 — OkfSourceDialog preflight pills (frontend, small)

The deleted 7.7 dialog carried per-file warnings the wizard's picker now
lacks: amber **"serving free-form RAG"** (`dataprep.status` ∈ ingesting /
ingested / ingested-with-warnings) and red **"already in an OKF repo"**
(`okf_repo_id` set). Server-side guards stay the real safety; these are
the steward's early warning. Port the badge logic from git history
(`574a4c11d^`: `components/gov-chat-frontend/src/components/okf/editor/ImportDocumentsDialog.vue`).
**Blocks**: nothing (UX only) — but it prevents a confusing mid-test 409.

### W2 — ×14 locale batch (mechanical)

All Amendment A strings are EN-fallback only (`okf.steps.*`, `okf.src.*`,
`okf.glossary.*` additions). Batch them through the locale injector with
the AST duplicate-key guard, run localeConsistency locally
(`rtk proxy` from the component dir). **Blocks**: nothing for an EN test
run; blocks "zero UI inconsistencies".

### W3 — ⓘ tips for document-management + crawler dialogs (frontend, small)

InfoTip coverage exists for the editor + wizard steps; FileDetailsDialog,
UploadFilesDialog, AddFromLinkDialog and the crawler results surfaces
still lack the what/when/why-for-RAG-accuracy copy
(UX-onboarding directive). **Blocks**: nothing.

### W4 — Bundle-zip lifecycle (the substantive one — backend + frontend)

The approved 2026-09-25 plan (plans file `nifty-soaring-quokka`, rev 2),
five workstreams. **This is what makes the retract → re-ingest cycle
testable and honest**:

- WS1: hourly orphan sweep must exclude `is_bundle` zips (today's zips
  survive only because the sweep's window hasn't caught them).
- WS2: doc-repo refuses bundle deletes from non-okf-service callers
  (403 BUNDLE_PROTECTED); batch delete guard.
- WS3: zips live forever per version — remove `supersedeOldBundles`;
  `repo.bundles[]` multi-version registry; `okf_versions` rows carry
  `bundle_file_id` + `ingest_status` (WS3a/3b/3c).
- WS4: Versions menu shows each version's zip with download; "missing"
  badge for the already-lost zips; FileDetailsDialog hides Delete/Retract
  on bundles with a "managed by OKF lifecycle" badge.
- WS5: always retract-before-POST in the ingest worker (idempotent
  re-ingest of a first-failure concept — no duplicate chunks).

Without W4, a v1→v2 cycle DELETES v1's zip (history loss) and the
Versions menu cannot prove what was served when.

### W5 — Verify the retracted→re-ingest loop server-side (verify, not build)

The designed loop is: serving → retract (back to edit) → submit →
approve → publish (mints vNext) → ingest requeues everything. The worker
owns settle-unconditionally + reconcile (verified live this session;
settle is rename-based promotion — the 1.7M-edge rewrite wedge is gone).
Action: one manual dry run against a SMALL repo (5 concepts) BEFORE the
full E2E pass, so W4 lands on confirmed mechanics.

### W6 — Architecture doc links (docs, trivial)

Reference ADR-okf-040/041/042 from the architecture overview's wizard /
doc-mgmt / clone sections (they are written but unreferenced).

---

## B. E2E functional test plan (UI, full cycle)

**Preconditions**: local build running (`docker compose --profile opea up
-d` in `C:\Dev\builds\main`); admin login; a crawled doc-repo file
present; 2–3 small test documents uploaded; ONE document containing
obvious PII (name + email) to exercise the PII gate; one pre-existing
draft OKF repo (clone source). Keep every repo ≤ 20 concepts so cycles
complete in minutes.

### Phase 1 — Creation paths (4 runs)

1. **Blank canvas**: Studio → Wizard → Entry (name + KH Subject Area) →
   Choose Blank Canvas → **editor auto-opens** → write a topic → import
   2 local `.md` files → Produce shows the manual-skip note → gate open
   → Curate shows 3 topics.
   PASS: topics listed, `addedCount` matches server truth, Back/Forward
   never duplicates topics.
2. **Documents via doc-mgmt**: Document Management → select 2 docs →
   "Create OKF repository" → **lands in the wizard, selection preloaded**
   → name → Choose (Documents preselected) → Input (pills visible if a
   selected doc serves RAG) → pick classification=heuristics → Produce
   shows REAL progress → done → Curate lists the produced topics.
   PASS: no re-kick on Back→Forward; failed state offers Retry.
3. **Crawl**: wizard → Choose Website crawl → pick the crawled file →
   Produce converts per-page. PASS: progress note counts pages;
   remounting mid-run resumes polling (never jumps to Curate).
4. **Clone**: Choose Clone → picker lists ONLY non-serving repos →
   Continue → clone swaps the repo (watch the context rail) → Curate
   shows the source's topics WITH their labels and graph links.
   PASS: graph view matches the source's; PII states copied.

### Phase 2 — Curation + validation (per repo from phase 1)

5. Curate: edit a topic's body, change a label (KH-bounded options
   only), add + delete a topic, run **Fix frontmatter** (autocorrect
   proposals → apply), re-split once. PASS: saves persist across
   remount; labels never free-text.
6. Validate: health ring populated from live data; introduce a PII
   concept → flagged group appears → **embedded panel**: redact one
   occurrence, replace another, accept one → PASS: green RESOLVED list
   grows, orange shrinks, re-scan re-flags, flagged count drives the
   publish gate.

### Phase 3 — Review → hand-off → ritual (outside the wizard)

7. Review shows live state + version summary; Versions/Logs/Rename
   dialogs work; **no lifecycle buttons exist in the wizard**.
8. "Open the Editor" lands in the repo shell, Editor sub-tab active →
   submit → approve → **publish** (mints v1, bundle zip appears in
   Document Management).

### Phase 4 — Ingest → serving

9. Ingest from the editor → drain runs → serving flip. PASS: dashboard
   queue chips drain to 0; ingest status `completed` (or partial with
   failed list); RAG answer cites the repo (one live question).
10. Serving repo in the wizard = read-only summary, gate OPEN (no dead
    button); editor mutations 409-guarded.

### Phase 5 — Retract → re-cycle (the loop)

11. **Retract** (editor) → lifecycle `retracted`, content editable
    again → edit one topic → submit → approve → publish (mints **v2**;
    with W4: v1's zip still exists, Versions menu shows both) →
    re-ingest → serving v2.
    PASS: no duplicate chunks for the edited topic (WS5); old version
    graph GC'd; retract→re-ingest of the SAME version also works.
12. Delete path: attempt to delete a bundle zip from Document
    Management → blocked (W2 of the plan, once W4 lands); repo delete
    refused while serving (INGESTED_DELETE_BLOCKED), allowed after
    final retract.

### Exit criteria

All phases pass on the LOCAL build; the found defects either get fixed
in-cycle or logged with story keys; then the same plan runs once against
the cloud deployment (`.101` stack) as the acceptance pass.
