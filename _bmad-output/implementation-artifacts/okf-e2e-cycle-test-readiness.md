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

### W8 — Wizard UX remediation (plan FINAL — rev 3, decisions locked)

Full per-step plan at `okf-wizard-ux-review-2026-09-28.md` (rev 3):
8 binding design decisions (D1–D8) via multiple-choice rounds — tagged
crawl sessions (tag+session+seed-URL), exact-slug auto-merge with
near-dupe flags, crawl decision point in the CRAWLER dialog only (crawl
stays fully independent), step 9 = Handoff (publish OUT of the wizard
permanently), light workbench + edit dialog, ALL source feeders always
visible once the repo exists, auto-label on Labels-step entry, zip
round-trip for outside curation. 5 P0s, small additive backend deps
(stamps+filter, handoff payload, auto-label op, accounting view, export
zip). **Blocks**: David's practical-usage E2E pass.

### W6 — Architecture doc links (docs, trivial)

Reference ADR-okf-040/041/042 from the architecture overview's wizard /
doc-mgmt / clone sections (they are written but unreferenced).

### W7 — Settle durability hardening (David, 2026-09-28: "these ingestion
jobs must be resumable, idempotent and survivable")

Incident anatomy (Indonesia 2026-09-28, 08:27–08:44 UTC): a legacy-era
settle chains rename → HAS_SOURCE rewrite (99 s) → LINKS_TO rewrite
(99 s) → final flip. Two infra events (arangod restart, okf-server
restart) landed inside that chain. What the code got RIGHT: every step
is idempotent (stale-endpoint-filtered rewrite — verified 0 stale rows
of 2.33M after recovery; rename skips completed parts), the lease CAS
lets a later attempt take over, and the startup reconcile re-fires
settle. The chain RESUMED correctly. Three real defects remain:

1. **Retry timing**: a failed/lost settle waits for the HOURLY sweep
   (`DEFAULT_SWEEP_INTERVAL_MS=3600000`). Fix: reconcile on its own
   short timer (e.g. 5 min) or exponential backoff after a settle
   failure — an empty-queue draining repo is one cheap indexed AQL.
2. **No timeout on settle-step awaits**: the 08:32 freeze held the lease
   for 70+ min with no error and no release (await on a dead socket
   post-arango-restart never rejected). Fix: wrap each settle step in a
   timeout; on timeout → release lease → backoff retry.
3. **Concurrent-settle collision**: restarting okf-server mid-settle
   orphans the server-side UPDATE; the new process's startup reconcile
   races it → 10 s key-lock timeout → the loser treats it as failure
   (benign — the orphan completes — but the loser should backoff-retry
   in minutes, not an hour). Falls out of fix 1.

Deploy note (until 1–3 land): **never restart okf-server or arangod
while a settle is in flight** (`settle_claimed_at` set + `ingested_graph`
null on a draining repo) — the recovery works but wastes up to an hour.

**Implemented in the local build 2026-09-28 (pending sync/commit):**
two of the incident's root causes were fixed in code, live-verified on
the Indonesia settle:

- `components/shared/lib/db-connection-service.js` — Arango agent socket
  timeout is env-configurable (`ARANGO_AGENT_TIMEOUT_MS`, default
  120000 UNCHANGED). The hardcoded 120s aborted the idempotent no-op
  rewrite scans (~99s quiet, >120s under load); the execute wrapper's
  retry then write-write conflicted with its OWN orphaned server-side
  attempt (Bali 2026-09, Indonesia ×2 today). Local `.env` sets 600000.
- `components/okf-server/workers/ingestWorker.js` — 429 lane cool-down
  (`OKF_KICK_429_COOLDOWN_MS`, default 15000): dataprep slot-busy used
  to hot-loop the whole queue at ~1 claim/sec (434 rows bouncing while
  one slot was held for hours during the vLLM outage) — continuous load
  that itself pushed the settle scans past the socket timeout. Rows
  never park (existing contract kept + test extended); only the lane
  pauses. `docker-compose.yaml` wires both vars with unchanged defaults.

Unsticking a wedged settle WITHOUT a restart (used live): the worker
module exports `_reconcileArmedRepos()` — run it inside the container
(`docker exec -w /app main-okf-server-1 node -e "require('./workers/
ingestWorker')._reconcileArmedRepos().then(r=>console.log(r))"`). It is
the same designed reconcile (CAS lease, idempotent), equivalent to a
second replica; no hand-written state edits.

Ops gap (this incident): `docker logs main-okf-server-1` returns ZERO
lines with the fluentd log driver — dual logging is not capturing on
this Docker Desktop, so container stdout is invisible whenever
VictoriaLogs is unreachable. Incident response ran blind through the
log-rotation layer; VictoriaLogs queries via `docker exec … curl
victorialogs:9428` were the only channel. Fix: make the fluentd driver
conditional on the observability profile (local dev keeps json-file) or
verify/repair dual logging on Desktop. Story keys assigned at sprint
planning.

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
