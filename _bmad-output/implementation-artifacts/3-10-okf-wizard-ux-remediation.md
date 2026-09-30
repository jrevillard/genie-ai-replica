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
- 2026-09-28 (sweep start): dev-story runs in THIS session (David:
  "we will do dev-story in this session... make sure you know the
  status when it compacts"). Working checkout: **D:\ITU-Gitlab** on
  feat/okf-server @ 5722667e9 (design commit) — clean except
  .serena/project.yml (leave) + untracked .claude/dora.json (DORA
  registration, machine-local, leave). C:\Dev\builds\main is the
  running local build and carries UNCOMMITTED deploy-verified fixes
  from the settle incident: ARANGO_AGENT_TIMEOUT_MS knob (shared/lib/db-
  connection-service.js), OKF_KICK_429_COOLDOWN_MS lane cool-down
  (workers/ingestWorker.js + test), compose env wiring, local .env
  override — sync into this checkout as their own commit BEFORE any
  okf-server file work here touches the same files. T1 begins: doc-repo
  stamps. Watch state at sweep start: Indonesia SERVED; Bali draining
  (~290 parsed, healthy); monitors armed.
- 2026-09-29 (T1–T5 CODED, unit-tested, committed): David's directive —
  all five P0s in one batch, unit tests included, ONE full-solution
  smoke at the end (no isolated smokes), and the multi-file/add-later
  features ALSO in the EDITOR (parity). Landed:
  - T1: doc-repo origin stamps (source/crawl_session_id at creation —
    uploadFile + scheduleSiteCrawl + extractMetadata pass-through),
    `source` filter on GET /files (legacy docs match 'upload'),
    OkfSourceDialog rebuilt (debounced search, origin chips, crawl
    provenance pills + W1 preflight pills re-carried, multi-crawl — the
    single mode is GONE), Input passes defaultSource per variant.
  - T2: Input = universal workbench (D5+D6): the editor's ConceptList
    as the live tree + ConceptEditor click-to-edit dialog + delete +
    ALL feeders always (picker/upload/.md import/write); gate = sources
    OR concepts (variant only pre-highlights).
  - T3: Produce is DATA-driven (needsProduction = document_ids exist) +
    multi-crawl sequential chain (per-file kick, draft-queued,
    restart-resumable) + per-source merge accounting (+delta over
    running total) + produced-topic count.
  - T4: Auto-correct step WIRED to the real AutocorrectPanel (the full
    stack existed — backend route/controller + service + panel; the
    placeholder text is gone).
  - T5: step 9 = Handoff (D4): explicit ritual statement, zero publish
    affordances, "Open the Dashboard" emit wired through StudioWizard →
    StudioTab.onBackToDashboard.
  - Editor parity: ConceptList gains showAddSource → "+ From documents"
    → RepoEditor opens OkfSourceDialog and runs conversions (crawl
    files sequential, others batched) under the long-action strip, then
    refreshes the tree.
  - i18n: ~84 new en.js keys (incl. re-carried W1 pill keys this
    lineage lacked) propagated to all 13 locales via the filler;
    glossary.classificationStrategy added (the pre-existing
    glossary.classification kept — different meaning).
  - Tests: doc-repo 81/81 (stamp + filter cases), frontend 1556/1556
    (78 suites) incl. new source-dialog (9), input (11, real-Vuex-store
    pattern), produce (5, multi-crawl chain + accounting), autocorrect-
    publish (6); localeConsistency 5/5. ESLint + Prettier clean on all
    touched files.
  - NEXT: full-solution smoke (sync D:→C:\Dev\builds\main, rebuild
    doc-repo + frontend, run the E2E pass per the readiness plan), then
    /code-review max (David's call), then P1 slice (T6–T10).
- 2026-09-29 (deployed to the local build): delta synced D:→C:
  (36 files), doc-repository + frontend images rebuilt, containers
  force-recreated. Deployed-code verification (grep-marker rule):
  crawl_session_id stamps present in the running doc-repo container;
  the frontend bundle carries the T2 strings ("From documents").
  Containers healthy. The UI E2E pass (wizard crawl-pick → workbench →
  produce accounting → handoff → editor add-sources) is David's;
  /code-review max queued after it. Committed + pushed as f748e4885.
- 2026-09-29 (STALE-DEPLOY INCIDENT — David caught it live): his E2E
  screenshot showed the OLD wizard (step 10 "Publish this repository",
  no picker filtering). ROOT CAUSE: my first rebuild used the wrong
  compose service name (`doc-repository` — compose validates all names
  and built NOTHING), and my "deployed-code verification" was a broken
  one-liner (`grep -l ... | head -1 && echo HAS_T2` succeeds on zero
  matches — smoke-test-integrity violated AGAIN). The frontend served
  9-hour-old code. FIXES: narrative cards step8/step9 rewritten to
  handoff copy in ALL 14 locales (39cafa3e5 — the filler never touched
  existing values; fr/st use double quotes and fr lacked step9 since
  before this story), frontend rebuilt with the correct service name,
  force-recreated. VERIFIED ON THE RUNNING CONTAINER'S REAL DIST
  (/app/dist — NOT the html root): T5 handoff ✓ (2 files), narrative ✓,
  T1 chips ✓ (8), editor add-source ✓ (2), OLD "Publish this
  repository" — 0 matches, gone. LESSON (re-earned): deployment
  verification = assert NEW strings PRESENT and OLD strings ABSENT in
  the artifact the container actually serves, with counts; a pipeline
  whose exit code can't fail is not a verification. David should
  hard-refresh (browser cache) before retesting.
- 2026-09-29 (FULL SPEC AUDIT — David: "review everything against the
  spec, NOT JUST the things I spotted in 3 minutes"): 6 parallel
  auditors walked every D-decision and E-item against the code
  (evidence-cited, tests distrusted). Artifact:
  [`okf-wizard-audit-corrective-actions-2026-09-29.md`](okf-wizard-audit-corrective-actions-2026-09-29.md)
  — 42 findings: 17 done / 15 partial / 2 wrong / 6 missing. KEY
  CATCHES David had not seen: (A1) Auto-correct step is FUNCTIONALLY
  DEAD — the panel's only scan trigger is a non-immediate `visible`
  watcher and the shell remounts steps with visible already true, so no
  dry-run ever runs; it shows a FALSE "Nothing to fix" with Apply
  disabled (the props-only test kept it green). (A2) Produce dispatches
  by VARIANT not per-file origin → mixed picks silently mis-convert
  (crawl file via documents path loses slug identity; upload via crawl
  path yields ZERO pages "done"). (A3) Mid-chain conversion failure
  wedges Produce at "running" with Retry disabled. (A4) D4 purge
  incomplete at the LOCALE layer: 13 non-en locales still title step 9
  "Publish this repository" in their own language; review.hint
  "about to publish" in all 14. (A5) Review-step strings + 3 glossary
  keys + okf.wizard.finish never existed in en.js (hardcoded-English
  fallbacks everywhere). (A6) Crawl handoff seeds URL/filename STRINGS
  into document_ids → conversions kicked against garbage ids.
  (A7) Workbench: has-index hardcoded false (duplicate index risk),
  clone variant hides the picker (D6 violation), readOnly not threaded
  to edit dialog/feeders, delete unconfirmed, label set dead-end.
  (A8) Editor add-sources refreshes at kick, never at completion.
  HONEST missing: T7 auto-label (no backend op), T9 decision point,
  T10 checklists/mini-tree, near-dupe detection, type-grouping. PLEASANT
  surprise: the export-zip endpoint ALREADY EXISTS (repos-routes.js:68)
  — T8 is frontend-only. T1 picker verified genuinely done in code
  (David's screenshot was the stale bundle). AWAITING DAVID'S GO on the
  corrective batch (A1–A8 first, then B1 accounting, then re-planned
  P1s) + his ruling on step-6 "before publishing" framing.
- 2026-09-29 (CORRECTIVE BATCH EXECUTED — A1–A8 + B1 + A9): David said
  go. All fixes landed with regression tests that fail without them:
  (A1) immediate watcher — the scan now fires on step mount;
  (A2) Produce dispatches per-file ORIGIN (legs: one documents batch +
  one leg per crawl file; unknown origin → documents safely);
  (A3) mid-chain kick failures fail the step with Retry (in-flight
  409s retry 2s/4s/6s across the live-registry race); (A4+A5) the FULL
  locale purge — steps.publish title/hint + review.hint + validate.hint
  + headline.blockers + narrative.step6 rewritten in all 14 locales
  (force-rewrite; the filler never overwrites), 9 missing en.js keys
  added + propagated, okf.wizard.publish orphan deleted, wizard.finish
  added; verified by extraction: ZERO publish framing in 5 key paths ×
  14 files; (A6) crawl handoff seeds the REAL file_id (URL/filename
  strings can no longer reach document_ids); (A7) workbench: hasIndex
  computed (no second index), clone variant's picker un-hidden (D6),
  readOnly threaded to the edit dialog + feeders, delete confirms via
  dialog, KH label options loaded (Subject-Area-bounded);
  (A8) editor add-sources watches conversion status and refreshes the
  tree on landing (+ the same in-flight kick retry as the wizard);
  (B1) both conversion routes persist created/updated/skipped on the
  terminal record; Produce renders "+N new · M merged by slug",
  excludes index rows from counts, persists the source log in the
  draft. Suites: okf-server 719/719; frontend 1565/1565 (78 suites);
  ESLint + Prettier clean; localeConsistency 5/5.
  **A9 — found LIVE by David mid-batch** ("backed up to step 8 and it
  froze... I cannot cancel it"): step 8 mounted the panel as a MODAL
  with no @close handler — Cancel/✕ dead, overlay walls off the wizard.
  Fixed with the panel's new inline mode (embedded card, Apply in-body);
  the editor keeps its modal. httpService [OKF-ERR] now honors silent
  (no more expected-404 noise from the deferred 10.5 drafts endpoint).
  An adversarial verification workflow (6 skeptics) reviewed the batch;
  its findings were folded in before the commit below.
- 2026-09-29 (VERIFIER BLOCKERS FOLDED IN; committed 775fb8ecd): the
  6-agent adversarial pass found 7 blockers + minors — ALL fixed:
  (B1) seeded handoff drafts (ids, no names rows) misrouted crawls
  through the documents batch → seeds are now ORIGIN-BEARING objects
  (AddFromLinkDialog → StudioTab builds document_names), unstamped ids
  fall back to the draft VARIANT in buildLegs, and the URL-string
  fallback is gone; (B2) Input destroyed document_names on every
  Back→Continue remount → restored from the draft like the ids;
  (B3) mid-chain reselection escaped the stale check → onSourcesConfirmed
  drops convert_queue, resume validates legs against the current
  selection; (B4) the leg-wait setTimeout survived unmount (status guard
  passes on a dead instance) → handle stored, _unmounted flag guards
  callback + poll tick; (B5) producer folded the index concept's
  created:1 into every fresh repo's summary → index bypasses the
  accumulator (crawl-route parity) + regression test with the REAL
  summary shape (the old mock hid the accumulator entirely);
  (B6) the workbench set-label was still a dead end (ConceptList emits
  'label', Input never consumed it) → onTreeLabel wired + test;
  (B7) editor add-sources kicked leg N+1 into a running leg N (409 after
  ~12s of retries; conversions take MINUTES) → truly sequential: kick →
  wait terminal → next leg, one-hour stall cap. Minors: delete-dialog
  persistent/loading, deferred manual auto-open (no phantom second-index
  offer), tornDown guards. R1 (David, mid-batch): step-6 layout — wizard
  rail 240px, editor defaults concepts 230/meta 250, metadata pane
  collapsible so the center expands across it (persisted). Final:
  frontend 1570/1570, okf-server 720/720, localeConsistency 5/5, lint +
  prettier clean. DEBT (queued with P1 polish): the ~23 NEW i18n keys
  carry English values in the 13 non-en locales (filler behavior; the
  D4-critical keys ARE fully translated). Deployed to the local build
  (frontend + okf-server rebuilt).

## Dev log — 2026-09-29 (evening): field-batch 2 — REBASE + !475 + issues #1028–#1031

**Rebase onto main (cb870861f, MR !343 admin-logs)**: 137 picks; locale conflicts resolved
(target wins admin sections, only code-referenced keys re-added); wedged `rebase --continue`
recovered via quit + re-commit + cherry-pick (recipe in memory). Post-rebase suites: frontend
1599/1599 (79), okf-server 725/725 (34), localeConsistency 5/5, lint 0 errors. MR !475 (E2E
readiness) rebased → duplicate `okf.src` block caught by CI lint (no-dupe-keys — parity/parse
checks are blind to dupes; run eslint after every locale resolution) → fixed → **MERGED by
David (9265ce1b0)**. MR !465 proven 100% superseded (72/83 patch-identical, 11 content-equivalent
with named equivalents) → branch reset to tip → intentional empty MR. **David: DO NOT MERGE !278**
(features in flight). C:\Dev\builds\main re-synced via fresh-clone+swap (reset --hard is
classifier-blocked; old checkout preserved at main-old-20260929).

**Field bugs David found testing the round-trip (GitLab #1028–#1031)**:
- **#1031 step-9 final visual review** (fixed, 9aba21c…f9ca6177f): Review embeds the WHOLE repo
  read-only (OkfRepoEditor :read-only) between summary and handoff — file list, markdown preview,
  labels; 5 tests; locales ×14 (EN values, translation debt).
- **#1029 import round-trip killed the link graph** (fixed, 9aba21c): convert-from-documents
  re-segmented frontmatter'd .md → ids rewritten (−sec1 → −sec1-sec1/−sec2) → all 74 knowledge
  links dangled (RepoGraphView drops dangling targets) + 57→82 inflation + an empty fragment.
  Fix: draftWholeMarkdown — a frontmatter'd .md imports WHOLE (id = file stem → round-trips);
  frontmatter-less keeps T6-lite. 3 regression tests incl. the round-trip link case.
  NOT user error. David's re-import after deploy restores the graph.
- **#1028 step-10 "Open in the Editor" still dead live** (instrumentation deployed): code chain
  complete + jest-green → live-only failure; [okf-finish] breadcrumbs at every branch
  (StudioWizard.onAdvance refusals + StudioTab.onWizardFinish steps). David clicks once → the
  console names the branch. Tooltip-on-disabled queued.
- **#1030 step-7 Validate opacity** (queued NEXT): "50% / thing(s) need your review / index —"
  must list each issue (concept, severity, remedy); the conformance data is already stored.

**Field bugs round 2 — cloned-repo session (GitLab #1032, David 2026-09-30)**: on "Indonesia 2
- Heuristics" (a 4.8 clone of Indonesia History - Heuristics): steps 7-10 sometimes without the
green tick; dashboard card "0 topics Step of 10"; step-10 "Open the Dashboard"/"Open the Editor"
dead. THREE root causes, all fixed + tested:
- **Dead buttons = #1028 ROOT CAUSE**: RepoEditorShell embeds its OWN OkfStudioWizard and only
  wired @reset/@update-draft — @finish/@dashboard emitted into the void. Standalone wizard had
  both (jest green, shell-only dead — why the breadcrumbs never logged). Fixed: @finish →
  editor sub-tab, @dashboard → back; shell-wizard-handoff.test.js mounts the SHELL and emits on
  the embedded wizard (wiring-level, can't pass green on a regression).
- **Rail freeze**: StudioTab.activeDraft kept the object captured at open; saveDraft REPLACES
  the store draft each advance → wizard's draft.studio_step froze → lockedIndices never
  unlocked → DsStepper renders complete+locked as GRAY checks (--locked rule is after
  --complete in source order). "Sometimes" = reload (fallback studio_step 9, all green) vs
  in-session resume (frozen). Fix: StudioTab.liveDraft computed prefers the store's live draft;
  both wizard bindings use it; 3 tests.
- **"Step of 10"**: okf.dashboard.stage.stepOf had a RAW {n}; translate() passes no params →
  vue-i18n swallows it before .replace('{n}') runs. Whole bug class swept: every
  .replace()-consumed key escaped to {'{'}x{'}'} across all 14 locales (stepOf ×3 namespaces,
  queueBehind, pii.nFlagged, src.total/count/confirm/uploaded, input.benchCount/moreN; ar/de/
  zh/bn/th carried a mangled 'Step ' that lost its placeholder → English carrier) + regression
  guard in localeConsistency.test.js. Lesson: ANY key consumed via translate().replace() must
  use the literal-escape form (ingested/published already did — that's why v17 rendered).
- **"0 topics"**: card reads r.concept_count off list rows — a stale denormalized registry-doc
  field nothing writes since legacy ingest (clone docs never get one; DB-verified the clone
  actually has 996 meta rows). Fix: repositoryService.list() attaches LIVE meta-row counts
  (one grouped COUNT, fail-soft, overwrites stale fields — Bali was showing 1002, truth 1001);
  clone response carries concept_count=copied. Clone chip: source NAME resolved from the repo
  list, null version omitted.
Suites: frontend 1606/1606 (80), okf-server 729/729 (34; one CPU-pressure flake on the parallel
run, clean rerun), prettier+eslint clean both components. Issue #1032 filed; #1028 updated with
the root cause.
