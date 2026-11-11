# Unified OKF workplan — 2026-11-05

Adapted after the PRD-issue triage (the rulings live on the GitLab issues — **#1409**
is the umbrella, the `prd::okf-server` issues carry the per-issue rulings) and
David's two priority UX directions (this session). Three streams, one execution
order. Sources of truth stay where they live: the CSR waves in
`_bmad-output/specs/spec-okf-chat-source-resolution/remediation-plan.md` (waves) +
the PRD; the triage rulings on the GitLab issues themselves; this file only pins
the ORDER and the cross-stream slots.

## Streams

| Stream | Branch | Tracker | Scope |
|---|---|---|---|
| **U — Admin-Dashboard UX pass** (PRIORITY) | `feat/admin-dashboard-ux` (cut from origin/main — independent of the unmerged CSR code) — **MERGED to main 2026-11-05** (MR **!770**; rebase merge → `bc1989f8a`; the branch is back on origin as the readable form of the work). **Continuation waves 2026-11-10**: T1 chart theming **MERGED** (!842 → `7f22a1310`); H1 honest states **this MR** — see *Phase U continuation* below | UX-1 + UX-2 issues (below), folding #947 + #1510 + #932, plus the T1/H1 waves | See Phase U |
| **C — CSR waves resume** | **COMPLETE — every wave merged.** The batch that held W1–W5 landed as ONE squash MR (merge commit `b2bcbb591`, the squash `f1d82e246` carrying CAP-1/2/3 citations, W4/D4 restricted serve, W5 origins, 2026-11-09); W6 !780, #1634 !803, W7 !804, W8 !805, W9 !808 followed; the old `feat/okf-chat-source-w1` branch was verified superseded by content and deleted locally (archive tag `archive/2026-11-09/feat-okf-chat-source-w1`) | #1409 umbrella (all child waves done — ready for David's close), !720 planning MR **MERGED to main 2026-11-06** (`b4cc40dbe`) | W6–W9 per the remediation plan — **all landed** |
| **T — Triage-scheduled items** | slot into U/C per their rulings | the 12 open `prd::okf-server` issues | See Phase T |

## Phase U — Admin-Dashboard UX pass (FIRST)

> **STATUS 2026-11-05 (end of day): UX-1..UX-4 DONE on `feat/admin-dashboard-ux`
> (commits 2170bd1, 6ac3712, a904b68, 4f0e852); UX-5 instrumentation landed, the
> leg optimization is gated on live `[okf-lab-timing]` numbers per the ruling.
> Security review: no findings on every slice. Frontend 129 suites / 3739 tests
> green at 88.84% coverage (baseline 88.78% held+raised); okf-server 82 suites /
> 1990 tests green. MR + Phase C resume follow.**
>
> **UPDATED 2026-11-06: the MR followed — !770 was opened and MERGED to main on
> 2026-11-05** (a rebase merge, so main carries the work as `bc1989f8a` and the
> branch's own commits are not ancestors of main — the shape, not the content, is
> what differs). The branch was removed from origin after the merge and has
> been put back, so the plan's named branch exists again and the UX work is
> readable in its eight focused commits. UX-5's leg optimization still waits on
> the live `[okf-lab-timing]` numbers.**

1. **UX-1 — Tab-rack consolidation.** Remove the left nav rail (`.sidebar`, whose
   sections mirror the tab rack 1:1); ship its icons into the main tab rack
   (`.tabs-card`). Every tab keeps its responsive layout (mostly present — verify
   per tab at narrow widths). Playwright admin handles (`data-test-id`) preserved;
   the admin suite is the feature guard.
2. **UX-2 — Living Intelligence theme sweep.** The theme system changed after the
   dashboard was built (Jerome's Living Intelligence package, `74482d4fe` — runtime
   `theme-variables.css`, genie-visual assets, App.vue + sidebarLayout rework).
   Apply it to AdminDashboard.vue (202K monolith — all tabs inline) + the
   QueryInspector trio + every dialog the dashboard hosts. **WITHOUT BREAKING ANY
   FEATURES** — the Jest admin suite + Playwright admin surface prove it.
3. **UX-3 — the folded Validate-step items** (David confirmed the fold):
   - #1510 — Validate Dismiss button writes `p.dismissed`, nothing reads it:
     remove the button (i18n ×14) OR wire dismissal persistence — decided at
     build time per the issue's own ruling.
   - #932 — marker-first affordance: "labels stale — re-ingest to apply" in
     the Testing Lab / frontmatter surfaces (the ruling's step 1); the
     partial-relabel mode stays evidence-gated (RAGAS) and respects the
     drain-freeze rule (the issue's ruling, unchanged).
   - #947 — Domain Templates (NOT a Validate surface — the earlier workplan
     draft mislabeled it): folded into this pass CONDITIONALLY per the
     triage ruling ("the UX-onboarding pass confirms the repeated-setup
     pain first; templates are built inside it if confirmed"). The pass
     performs the assessment and records it on the issue; templates are
     built only on confirmed pain.
4. **UX-4 — progress bars for the four long-running Studio operations on
   LARGE repositories** (David, 2026-11-05: "must include progress bars like
   all other longer running curation operations"). The reference pattern
   already exists — `AutocorrectPanel.vue`'s Apply Fixes (chunked apply, 4
   lanes, live `DsProgress` + Stop; David's 2026-11-02 directive) — the other
   three come up to its standard:
   - **Refresh suggestions** — `FrontmatterPanel.vue:315-363` (used by BOTH the
     wizard Curate step and the editor's right pane): one synchronous
     `suggestFrontmatter(repoId)` call with only a boolean "Curating…" flag.
     The server sweeps the whole corpus through the LLM — minutes on a large
     repo. Remediation: detached-job + poll (the topic-links run-record
     pattern) or chunked apply, plus a `DsProgress`.
   - **Accept All (repo bulk PII)** — `RepoEditor.vue:1116-1145` →
     `bulkPiiAction` → server `repoBulkPii` iterates EVERY flagged concept in
     one request with only `piiBulkBusy` + a strip label. Remediation:
     chunked/detached with a processed-of-total `DsProgress` (the backend
     knows the flagged total up front). Respect the drain-freeze 409 contract.
   - **Cross-link topics** — `Validate.vue:952-1000`: polling exists and
     already reports `batches_done`/`batches_total` (a text note) — it needs
     the BAR, not new machinery. Add the `DsProgress` bound to those counts.
   - **Apply Fixes** — `AutocorrectPanel.vue` is the pattern source, not a
     patient; verify its wizard embedding matches the editor's.
5. **UX-5 — Testing Lab ±tag apply is too slow (David, 2026-11-05)** — in the
   Suites & Analytics tab, applying the head-tag changes "Explain failures" /
   the advisor recommends (+tag / −tag chips, then Apply) takes far too long.
   **The current UI stays — David likes it; it is just slow.** The cause shape:
   `onAdvisorApply` (`TestingLabDialog.vue:2493+`) holds ONE busy token over a
   serialized save → `headRebuild` (one embed call per tag field) → suite
   re-run leg — the click blocks on minutes of embed + re-run before anything
   settles; the same pattern backs `onTeachTag`/`onTeachAllTags` (:2368-2405).
   Remediation direction: optimistic chip state at click, the fast two-write
   save confirmed immediately, rebuild + re-run demoted to a detached
   background activity with per-step progress (save ✓ → rebuilding head… →
   re-running suite…; the suite run already has a poll), re-using the
   suiteEpoch/stale-answer guards. At story time: instrument first (which leg
   eats the wall clock — no guessing), then optimize that leg; the UI mods are
   the fallback, not the default.
   **DISPOSITION 2026-11-09 (David, unprompted): "the testing lab starts up
   fast now"** — the OPEN half is resolved (no repro; !810 shipped the timing
   instrumentation and the open legs measured 4–44 ms locally all along). The
   ±tag APPLY half is not yet re-measured by David: one repro with the browser
   console open names the slow leg on the `[okf-lab-timing]` channel, or his
   next clean Apply closes the item as no-repro. Not blocking any work — the
   instrumentation is shipped and the ruling (measurement first) stands.

### Phase U continuation — the admin-UX waves after !770 (David's "go", 2026-11-10)

Two further waves inside David's standing fence (**only AdminDashboard.vue, its
tabs and the dialogs its features launch — never UnifiedAnalytics or the chart
components as surfaces**; shared files consumed by non-admin surfaces get
flagged before touching):

| Wave | What | Status |
|---|---|---|
| **T1 — chart theming** | the five analytics charts consume resolved DS tokens (light/dark correct across theme switches; no ApexCharts hardcoded palette) | **MERGED to main** (MR **!842**, merge commit `7f22a1310`, David's merge train 2026-11-10). BMAD bookkeeping rides the H1 MR per the no-standalone-docs-MR rule |
| **H1 — the dashboard stops lying** | fabricated boot defaults removed (99.98% uptime, 245 ms, 1,247 MAU, 42.3 GB DB, "2 days ago" scan stamp, hardcoded service statuses) → null-until-measured + tri-state cards (DsStateDisplay error+Retry / Measuring… / real data); swallowed failures surfaced (loadSystemHealth resets every surface, loadDatabaseStats treats figure-less payloads as failures, loadSecurityDetails rethrows instead of returning a fabricated clean bill, runSecurityScan no longer stamps "Just now" over a failed refresh, LogSearchDialog reports its own failure via a second emit argument); 9 new i18n keys × 14 locales | **MERGED to main** (MR **!845**, David's merge train, `a96ba311d`, squash `9d5ea0805`). Branch `feat/admin-ux-h1-honest-services`, 4 commits — three review rounds + a 4-agent simplify pass. Deployed to the local build PRE-merge; David's visual review exposed two backend bugs the honest render had been masking — **#1761** (Database tab "NaN GB") and **#1762** (Backup 500 at corpus scale), fixed in this MR |
| **H2 — the two Database-tab bugs the honest render exposed** | #1761: `admin-dashboard-service.getDatabaseStats` misread the driver's `collection.figures()` shape (the total summed to NaN → `"NaN GB"`); the shared `readCollectionUsage` decodes the REAL shape (verified against ArangoDB 3.12 + arangojs 8.8.1 — count TOP-level, sizes under `figures.figures`), missing → 0, garbage throws naming the collection; human-formatted via the shared `formatSize`. #1762: `database-operations-service.backupDatabase` stringified each collection's ENTIRE array (and loaded it whole) — a 46,938-doc collection crossed V8's string cap and 500'd after 34s; now streams in bounded chunks (256 docs / 1 MiB) through a backpressure-aware write, removes the partial file on mid-backup failure, never destroys a completed backup, and the twin admin backup endpoint got the same port | **MERGED to main** (MR **!846**, David's merge train, 2026-11-11 ~03:17). Branch `feat/admin-ux-db-fixes`, three commits (fixes / review round / simplify round). Deployed to the local build pre-merge; David's first live backup streamed ~700k docs until **ArangoDB itself died** — **#1788** tracks the database death (workload-vs-environment watch plan), the backup's honest-failure behavior worked exactly as built |
| **T2a — the state-shell collapse** | the admin dashboard's repeated state leaf became ONE component: `components/admin/AdminStatePanel.vue` (DsStateDisplay + optional secondary Retry button). Six hand-rolled shells collapsed — the four error+Retry cards (health, usage, db-stats, security), the hierarchy-translations error, and the three "Measuring…" fallbacks; the ad-hoc `.measuring-note` CSS is retired (DsStateDisplay renders the state with tokens). Every `data-test-id` handle preserved (health-error/retry, usage-error/retry, db-stats-error/retry, security-error/retry, security-loading, hierarchy-translations-*). Visual delta (deliberate, for David's review): Measuring… now renders as the DS state message (centered, muted-soft) instead of the small inline note | **this MR** (`feat/admin-ux-t2-state-shells`) |

Diagnosis worth keeping — amended by the merge review: the H1 review found the
**backend delivery already honest** (`/admin/system-health` nulls on VL outage by
design, `/admin/security-metrics` serves the real scan store; every review finding
was a frontend boot-lie or a swallowed failure) — but honest DELIVERY still
carried a dishonest VALUE: a driver-shape misread produced `"NaN GB"` inside a
valid 200, masked since forever by the fabricated tile. Lesson for the next
waves: honest rendering surfaces upstream garbage; shape guards don't validate
values. The dead `lastScan` key (the loader writes `lastSecurityScan`) was fixed
in passing. **Out of fence, flagged:** H4 (UnifiedAnalytics renders random demo
data) — David ruled the charts untouchable; the wave that fixes H4 must be
scoped explicitly.

## Phase C — CSR waves resume (after Phase U)

- **W6 — artifacts view** — **MERGED to main 2026-11-06** (MR !780, via merge
  train 228; it landed INTO the new theme, so the double-restyling risk was
  avoided by the ordering). Issue #1557 closed by the merge.
- **BEFORE W7 — markdown editor defaults RENDERED (#1634, David 2026-11-07)** —
  **MERGED to main 2026-11-07** (MR **!803**, merge commit `fecd04949`; #1634 closed by
  the merge). The Studio concept editor (`ConceptEditor.vue`) opens on RENDERED and the
  wizard's "+ Write a concept" modal (`AddConceptModal.vue`) on preview; raw markdown
  stays one click away (Source / Split unchanged); the frontmatter dialog keeps its
  contextual source switch.
- **W7 — retract-retention D3 reversal** — **MERGED to main 2026-11-07** (MR **!804**,
  merge commit `90e053183`): the sweep is mark-only for EVERYTHING — bundle zips marked
  `Retracted` with a retract_date (Versions dialog downloads survive; the live-repo guard and its
  skip list went away with the delete — a bundle is stamped per-repo by construction),
  sources untouched (already mark-only), repo DELETE still the hard purge, the
  file-header directive records the reversal. (Not the concept-document ceiling slice —
  see the note below this list.)
- **W8 — log purge + gate downgrade, SCOPE GREW per the #925 split ruling:**
  the delete flow also captures a **`deletion_reason`** (#925). The TTL sweep
  half stays parked pending the D3 revisit — out of scope here.
  **MERGED to main 2026-11-07** (MR **!805**, merge commit `569a4f8ee`): the delete purges the
  repo's concept-keyed `ingestion_log` rows (1:1-safe — a concept id another
  live repo holds keeps its rows), the SOURCES_NOT_RETRACTED gate skips a
  hand-deleted source (404) with a visible warn instead of blocking forever,
  and the delete flow carries the steward's reason onto the audit row
  (trimmed, 500-char cap) + response. Retract purges NOTHING (D3 coherence —
  a divergence from EPIC-8's "delete/retract" wording, deliberate: the
  versions W7 retains carry their history).
- **W9 — concept tree browse** — **MERGED to main 2026-11-08** (MR **!808**,
  David, merge commit `f1765fc17`; #1645 closed by the merge, `status::done`):
  the paginated serving-read tree index (`GET /okf/repos/:id/concept-tree`,
  offset/limit, author links only, the CAP-2 fence composition) + the citizen
  `ConceptBrowserDialog` entered from BOTH citation surfaces (the D8 pass
  recorded in `ux-csr-w9-concept-browser.md`); three-layer review patched
  (`c52c7bd`, 9 findings fixed, 2 deferred #1643/#1644) and the full live
  smoke **12/12** with the new [2.5] browse leg.
  **Post-merge amendment (David's live-testing directives) MERGED to main
  2026-11-08** (MR **!809**, merge commit `525cbb9e6`): LAZY LOADING — the dialog opens with only the
  first tree page (200) + the focus document, further pages on demand; and
  the large-repo read path — one batched edges scan per page (the correlated
  join measured >300 s/page live) + lazy persistent indexes that heal
  pre-index repos. #1646 filed separately (links die ~20 min idle — token
  refresh bypass on the raw-fetch open paths; needs the operator repro).

> **NOT A CSR WAVE — the concept-document ceiling (curation half).** It shipped on
> its own branch (`feat/okf-concept-ceiling`, MR **!788**, issue **#1576**) and is
> **MERGED to main 2026-11-06** (David, merge commit `83d7d04bd`; issue #1576
> closed by the merge, `status::done`). It was a separate branch because it is
> the *ceiling initiative's* curation half and not a slice of the chat-source
> remediation. Its story file is
> named `_bmad-output/implementation-artifacts/csr-w7-concept-ceiling-story.md` —
> that file's **own "W7" label is NOT this workplan's W7** (the retract-retention D3
> reversal, above, merged 2026-11-07 as !804). The deferred curator-initiated split is
> **#1577**; the ceiling-vs-document-budget drift found while documenting it is
> **#1588**.

## Phase T — triage-scheduled items (slots per the rulings)

| When | Item | Ruling |
|---|---|---|
| First CSR-adjacent slot after Phase U | **#995** retrieval-mode card | Backend done on main (GET+PUT /retrieval-config, audited); card is frontend-only, must name the EFFECTIVE posture + serving-graph count + preview before apply. Ruled "right after CSR W4" — W4 is done |
| **MERGED 2026-11-08** (MR **!811**, merge commit `43af9e8e4`; issue #948 closed by the merge, `status::done`) | **#948** ingestion aggregation Studio panel | Read-only aggregation; ruled "behind CSR W4–W6". Shipped: `GET /okf/repos/conformance-debt` (default-deny ACL composition identical to the repo list, page loop with a truncated marker, pii occurrences discriminator — the `LENGTH(d.pii_findings || [])` object-trap counted scanned-clean concepts as debt, 3–161 phantom rows on 5 real repos) and the Studio `ConformanceDebtPanel` (worst-first lexicographic sort, per-row test handles, empty-vs-failure states). Smoke 17/17 live |
| **MERGED 2026-11-09** (MR **!816**, merge commit `bbd5bba5d`; David ran the manual smoke on the local build — WARN + `injection_flagged=1` live — before adding it to the merge train; #914 `status::done`) | **#914** threat model + bounded sanitizer + injection eval rows | Narrow re-scope; "behind CSR waves". Shipped: the FIXED versioned injection pattern list (`2026-11-09.1`) — invisible channels stripped whole, delimiter-impersonation neutralized, imperative-prose families FLAGGED never stripped; the verdict scans the RAW assembled prompt (scanning sanitized parts is blind); flagged verdicts land on the row (`curation.injection_flagged`), a pass counter, and WARN logs; the steward-visible body is never rewritten. `docs/security/producer-threat-model.md` (B1–B4) + `data/okf/injection-eval/fixtures.json` (13 rows) + a RAGAS-path gold file + schema tests. Story: `_bmad-output/implementation-artifacts/t-914-producer-hardening-story.md` |
| **MERGED 2026-11-06 — the guard half** (MR **!791**, merge commit `700c2c8de`; issue #1594 closed); the open/download half with the CSR batch | **#1594** OKF citations 404 on the doc-repo metadata lookup in `okf_only` mode | Generic work → **Path 1** (local compose validation, MR to main). Severity low (the fetch failure is caught; badges degrade) but it fires on **every** OKF-citing query and makes the `okf_only` posture look broken in devtools. **AMENDED 2026-11-06 (David, after reading the code): the fix is a FRONTEND GUARD — no backend change.** chatqna already emits the OKF shape (`source: "okf-concept"`, `document_name`, `concept_id` — `genieai_chatqna.py:3636-3659`) and the backend relays `source_documents` verbatim (`query-service.js:466`), so the marker reaches the frontend; the frontend drops it in `translateSources` and then fetches doc-repo for **every** citation. The fix: carry the marker through `translateSources`, skip the doc-repo metadata fetch for an OKF citation, render its badge from the citation's own payload (both the answer card and the sidebar — they list the same citations). **SECOND PASS 2026-11-06: the CSR branch `origin/okf-chat-source-w1` ALREADY carries this guard** — CAP-3 (`402296433a`), live-verified (W1–W3 smoke 7/7) and running in the local build; that batch also carries the retriever identity, the concept route, the async title resolution and the open/download flow, and it is deliberately held back as one batch (the devlog's "Not done yet"). So the guard half landed AHEAD of the batch as **!791** — its own Path-1 MR, so `main` stops the 404 while the batch waits for a merge decision. The batch's CAP-3 supersedes it (one hunk conflicts, `translateSources`; the batch's side wins) and the badge fix is additive, because CAP-3 leaves the badge on the extension fallback (`HADI`). The instance stays on `okf_only` |
| With the CSR batch (CSR EPIC-3's slice) | **#1598** an OKF citation still has no working open/download target in `main` | The card offers a dead affordance: the click opens a repository document, and an OKF concept is not one (404 → "Could not open the document"). The working target is **CSR EPIC-2's concept route + EPIC-3's card branch** — BOTH already implemented and live-verified on `origin/okf-chat-source-w1` (CAP-2 `897926dad8`, CAP-3 `402296433a`; the W1–W3 smoke 7/7). `main` cannot point the click at a route that does not exist, so this closes when the batch lands |
| **MERGED 2026-11-06** (MR **!800**, merge commit `5fc59bf02`; issue #1596 closed by the merge, `status::done`) | **#1596** the OKF smoke harnesses purge by NAME, across every domain | The ceiling slice's new harness listed every repository and deleted the ones whose NAME matched, without matching the domain — so a user repository carrying that name in another domain was soft-deleted when an operator ran it. The fix is one term in the match (`it.domain !== DOMAIN`), applied to both harnesses carrying the pattern (`run-smoke-ceiling.js`, `run-smoke-lifecycle.js`). Live-verified on the local build: a cross-domain decoy (`smoke-ceiling` in `not-smoke`) SURVIVES a harness run, a same-domain decoy is still purged, ceiling harness 20/20. The lifecycle harness's v2-supersede section fails IDENTICALLY with and without the patch — a pre-existing server regression filed as **#1630** (publish-from-retracted refused while the error's own allowed-list names `publish`) |
| **MERGED 2026-11-07** (MR **!802**, merge commit `65ace0719`; issue #1630 closed by the merge, `status::done`) | **#1630** OKF lifecycle: publishing v2 after retract is refused — the INVALID_TRANSITION message contradicts its own allowed-list | Found 2026-11-06 live-verifying the #1596 harness fix; the opening "self-contradiction" framing was corrected on the issue (note 5): the state machine is WORKING AS DESIGNED — the 2026-09-11 Kenya ruling makes a retracted repo's ONLY exit `submit` (re-entry: submit → review → approve → publish, minting v{N+1}), and publish-from-retracted is the escape hatch the ruling removed. The real defects, both fixed on this MR: **`details.allowed` violated its documented contract** (the 2026-09-04 wizard directive says the field carries valid ACTIONS; it carried the refused action's from-STATES — from `retracted` it answered ["approve","publish"] where only ["submit"] is valid) — now the valid next actions, message says "valid next actions: …"; and **the lifecycle smoke harness predated the 09-11 ruling** (it attempted the removed escape hatch three times) — re-anchored: the refusals pinned as contract, the retract window makes a real BODY edit (the publish gate fingerprints content_hash), the D-C rebuild proof runs through the designed loop. Server state machine unchanged. Live on the local build: `run-smoke-lifecycle.js` **ALL PASS** end-to-end (v2 supersede with per-version bundle retention, v3 re-entry, zero-write gate, cleanup). Suite 2065 green, coverage above main on every metric, security review 0 HIGH/MEDIUM. Also carried the #1603/#1596 workplan rows (folded forward per the no-standalone-docs-MR ruling) |
| **MERGED 2026-11-08** (MR **!810**, merge commit `32882f1a5`; issue #1647 closed by the merge, `status::done`); the residual metrics-read cost filed as **#1648** | **#1647** the Testing Lab opens with no feedback on a large repo — needs a spinner | David's live-testing item, filed 2026-11-08: launching the Lab on a large repo shows a long silent pause at open. Investigation: every lab ACTION already carries busy feedback; the OPEN fires three loads (runs / RAGAS suites / frontmatter history) with no affordance; all five open-time endpoints measured 4–44 ms on the local build for BOTH large repos (Bali 1112, Quran 6352) — the pause is deployment- or payload-specific, locally unreproducible. Shipped: the dialog opens INSTANTLY under its built-in `:loading` overlay until the three open loads settle (250 ms anti-flicker floor, latest-open-wins), and each open leg names itself on the `[okf-lab-timing]` console channel (`lab-open-runs` / `lab-open-ragas` / `lab-open-fm-history` / whole-open `lab-open`) — the UX-5 ruling applies verbatim: David's next repro NAMES the slow leg; the optimization follows the measurement. Ride-along: `getRepoMetrics` + `countByIndexStatus` ensure the `okf_concepts_meta(repo_id)` persistent index (the W9 lazy-index helper, reused) — the metrics read measured 858 ms first → 379 ms warm on Bali (was 0.43–0.88 s steady, 4.3 s cold); the residual is the aggregation AQL's full-doc materialization, filed as #1648 |
| **MERGED 2026-11-06** (MR **!799**, merge commit `545b8fa4d`; issue #1603 closed by the merge, `status::done`) | **#1603** the wizard's import failure discards the server's reason | Found by the local sweep 2026-11-06, after !788 landed: the wizard's import caught the server's refusal and rendered the generic "Import failed — check the files and retry." — advice that cannot work for a named refusal (an identical retry fails identically). The editor was fixed for exactly this reason in !788; the wizard's half was not. Shipped: the catch surfaces the server's message when the failure carries a named code AND an explanation (`err.data.error` + `err.data.message`), generic fallback otherwise, plus a status+code log line. Two new test cases pin both branches (named refusal verbatim; code-without-message generic). Security review 0 HIGH/MEDIUM; CI coverage identical to main's on every metric. This MR also carries the two !794 documentation commits (folded forward when !794 was closed per the no-standalone-docs-MR ruling) |
| **MERGED 2026-11-09** (MR **!812**, merge commit `22e19712f`; issue #1650 closed by the merge, `status::done`) | **#1650** the publish no-op guard is blind to PII acceptance — a retracted repo cannot re-enter serving | Found 2026-11-09, David live: he retracted El Salvador over PII conformance, re-scanned and accepted all 50 findings, and publish was refused `PUBLISH_NO_CHANGES` ("nothing has changed"). Root cause (static trace; the live publish attempt on his repo was correctly refused by the guard): the fp:1 fingerprint hashed ONLY `{concept_id, content_hash}` — the body sha256 — so EVERYTHING the publish gates certify but the body cannot see was invisible: `pii_state`, `pii_resolutions`, frontmatter-only repairs. After retract, publish is the ONLY exit back to serving, and the refusal's own advice ("retract and publish again") was the trap — retracting changes nothing. Shipped (David ruled "go A+B+C"): **A** the fingerprint becomes fp:2 — per-concept lines carry `concept_id:content_hash:pii_state:conformance-code:severity-signature:pii_hits_summary`; the prefix mismatch with every v1 manifest IS the one-time migration (the first post-upgrade publish mints N+1 honestly, because fp:2 certifies MORE). **B** the refusal names a workable remedy ("correcting PII via scan-and-accept also counts") and states the retract fact. **C** the debt panel's Issues cell becomes a viewer — it reads the repo's `/validation` report in a dialog (severity pill, concept, code, message, remedy; error shown INSIDE the dialog; `@click.stop` so the row still opens the repo). Live-proven on the local build before merge: El Salvador v3/approve stored bare-hex vs live `fp:2:` → the publish mints v4; smoke 17/17; coverage 88.54 > !811's 88.53 |
| **MERGED 2026-11-09** (MR **!813**, merge commit `cae85db69`; issue #1651 closed by the merge, `status::done`) | **#1651** the 50 SOURCE_MISSING_RESOURCE issues are unfixable in wizard Step 8 — a false "Nothing to fix" | Found 2026-11-09, David live, chasing the same El Salvador issues !811's panel now surfaces: all 50 remaining issues are `SOURCE_MISSING_RESOURCE`, every one on the bundle-root `index` concept whose sources entries (written by the document-import index writer) carry `{kind, file_id}` with NO resource — and the provenance field is the same array. Step 7's remedy says "Run Autocorrect (Step 8)"; Step 8's planner could not derive a fill (no provenance resource, no sibling) and declined SILENTLY (`if (!fill) return s` — the warning its own comment promised was never implemented), so the sheet answered **"Nothing to fix — all frontmatter already conforms"** on a repo with 50 open issues. Shipped: **born-right** — the document-import/crawl/single-file import writers stamp `resource: ${documentRepository.url}/api/files/${file_id}` (the producer-service baseResource shape the sibling concepts already carry); **repair** — the planner gains a most-precise own-file_id fill tier (entry's file_id → provenance → sibling; the sibling tier misattributes multi-source concepts, which is why file_id outranks it); **no silent decline** — still-unfillable entries surface as `SOURCE_UNFIXABLE` warnings on the sheet. Live-proven on the local build before merge: the read-only dry-run on El Salvador proposed exactly one change (`index` sources), all 50 entries filled from their own file_ids, zero warnings, 585 other concepts untouched; CI coverage 87.52 > main's 87.5 (like-for-like on the `test:okf-server` job) |
| **MERGED 2026-11-10** (MR **!833**, merge commit `f2ef3ff19`; issue #1568 closed by the merge, `status::done`; David clicked MWPS after the rebase — the tree verified identical to the branch head) | **#1568** the OKF smoke harness is RED on main — the graph-name expectation is stale and the drain is never armed | The `run-smoke.js` harness predated two product evolutions: the slug-based graph names (the registry's `graph_name` field is only the legacy `OKF_{repo_id}` anchor — resolving through `workingGraphName(repo)` is the single authority) and the WS5/lifecycle drain arming (`rag_drain_active` has exactly one writer — the lifecycle `ingest` transition, which requires PUBLISHED). Shipped: the graph name comes from `workingGraphName` on BOTH repos + the clone (the registry-stamp trap was live-caught: the anchor made the author-edge AQL miss the real `OKF_<slug>_vN_LINKS_TO`); the happy repo walks the REAL lifecycle (`markRepoPiiScanned` → bulk PII ACCEPT (the clean bundle's LOCATION hits trip the publish gate — the steward's scan→review→accept flow) → submit → approve → publish (this mints v1 — the explicit `mintVersion` call is gone) → ingest (arms the drain) → drain); the SAD repo is publish-gate-refused BY DESIGN (`bad_concept`), so its drain-dependent asserts moved to the happy repo and its bundle's terminal state is honestly `Pending`; the clone walks the same lifecycle (a clone is born draft — its rows are worker-invisible until published); serving-state cleanup walks retract→delete (`INGESTED_DELETE_BLOCKED`); drain-timeout messages name the real precondition; the header phase list matches the asserts. Live-proven on the local build (see the MR description for the four-run convergence). Carries the accumulated post-merge BMAD bookkeeping (W6–W9/#914/#1650/#1651 rows + the W9 artifacts) per the no-standalone-docs-MR ruling |
| **ON MR — T1 of the admin-UX waves** (MR **!842**, branch `feat/admin-ux-t1-chart-theming`, 2026-11-10, rebased onto main before creation; the review + all wave decisions live in `_bmad-output/planning-artifacts/ux-designs/admin-dashboard-ux-review-2026-11-10.md`, committed in this MR) | **Admin-UX T1 — make the charts themed** (the review's headline: "the new color themes are not leveraged") | Five-walker review finding: the token system is complete (light/dark/system × per-deployment `--brand` flavours) and the 21 DS primitives are clean — but every chart ships the stock ApexCharts palette (the app's ONLY chart library — verified: sole chart dep, sole chart import in `main.js`; the "ECharts" framing in earlier commit messages was corrected before push) and the bridge's `var(--x)` reference strings NEVER resolved (ApexCharts applies config colors as SVG presentation attributes via SVG.js `.attr()` — verified in the installed bundle: 137 `.attr()` sites, one `.style.fill` for dataLabels — and var() is invalid inside presentation attributes per css-variables-1). Shipped (David's decisions: brand-derived ramp; single TestingLab/flow fixes ride later waves): `utils/chartColors.js` — token resolution through a hidden probe element (sentinel-guarded: an unparseable expression reads back as the sentinel → pure-math fallback with oklch→sRGB normalization at one boundary), brand-derived categorical ramp via relative-OKLch/color-mix expressions the browser evaluates (no hand-written color math on the primary path), satisfaction scale derived from the status tokens; the bridge gains `getResolvedTheme()` and `getCssVarStrings()` becomes a resolved alias (RagasPanel still consumes it); all five live charts migrated (CategoryDistribution stock palette → ramp; SatisfactionGauge hardcoded status hexes → the shared band builder; SatisfactionHeatmap dual hex scales + dead `:deep([data-theme='dark'])` block (leading-attribute `:deep` can never match) → the same shared dimmed bands + no-data flipped to an EMPTY state (was type=error) with fetch failures no longer overwritable into "No data available"; UsageTrendChart private 5-color D3 palette + hand-rolled CSS legend swatches → ramp entries 0/2 (hue separation) + inline swatch colors AND shapes; TopQueriesChart's `colors: ['var(--accent)']` — the latent unthemed-on-main bug — → the resolved accent); the dead analytics generation deleted (AnalyticsComponent, AnalyticsDashboard, components/UsageTrendChart — zero importers, kept a third pre-OKLch palette alive); the dead `ApexCharts.defaults` block in main.js removed (nothing in the installed bundle reads it); the global-layer green hover (theme-components.css rgba(76,175,80)) → color-mix on --accent with a plain-var fallback; charts-apex-overrides.css header upgraded from a vague claim to the verified mechanism. Verification per the standing process: /code-review (high) round 1 — 9/10 fixed, and its own new tests exposed `gaugeBandColors` consumed property-style (every band index undefined since T1); /simplify (four parallel reviewers) — one band builder shared by gauge+heatmap, heatmap error/noData split, dead `getGaugeColor` removed, double theme-resolution collapsed; /code-review round 2 — 7/9 fixed and its evidence pass CORRECTED round-1 F2: the shared band pick is **[0,2,3,4]** — the pre-T1 surface's own semantics (70-80 flat warning, 80-90 green) — round 1's [0,1,2,4] had repainted the good band warning-orange; declined-with-reason items filed as **#1733** (per-chart style-injection consolidation + dark-track-rule retirement behind the Visual Fidelity loop; evidence-gated resolution memoization). Tests: chartColors.test.js (37 cases: oklch pins incl. the sRGB primaries at their published OKLch values, no-echo contract, fallback pins, ramp-shortfall regression, band projection + degradation) + useChartTheme.test.js + reworked gauge band tests; full suite 148/148 suites, 4151 tests green after the rebase |
| Not scheduled | **#909** air-gap/retention sweep | Parked; trigger = a sovereignty/air-gapped deployment contract |
| On child closure | Umbrellas **#889 #904 #956 #960** | Close when the last child closes (David) |

> **#995 STATUS 2026-11-05: MERGED to main (MR !775, merge commit `d63370445`), issue closed.**
> The card (`components/gov-chat-frontend/src/components/okf/RetrievalCard.vue`)
> is mounted in `StudioTab` above the repository kanban. It names the
> EFFECTIVE posture (the server's read-model, never a local guess), the
> engagement gate, the serving-graph count and the per-repo serving list, and
> it names the `okf_only` + zero-serving foot-gun in the operator's own
> language. Read-only for every curator; the mode selector + the fan-out caps
> + the change history are `tools-admin` only (the SAME realm role the PUT
> route enforces server-side).
>
> Two backend additions came with it, both needed by the card:
> `GET /api/okf/retrieval-config/audit` (tools-admin only — the governance
> trail, which lives under the `_system` pseudo-repo and is therefore
> unreachable through the per-repo logs route) and the read-model now carries
> the validator's `limits`/`modes` so the card never keeps its own copy of
> the bounds.
>
> The write is a before→after confirmation, then a PATCH of the CHANGED
> fields only, then a re-read from the GET — the card never renders its own
> optimistic guess as truth.
>
> **Two defects were found by David in the local build and fixed before the
> merge** (both are the same class of error — a mock that did not mirror the
> producer):
> 1. **The controls never rendered.** The card read the user through
>    `mapGetters('auth', ['currentUser'])`, but the auth module declares NO
>    `namespaced: true` — its getters live at the STORE ROOT. The namespaced
>    lookup resolved to `undefined`, so `canEdit` was always false and the
>    mode selector, the caps, Save/Revert and the change history were absent
>    while the posture itself rendered fine. The suite missed it because its
>    store mock NAMESPACED the auth module; the mock now mirrors the real
>    store and a test pins that the namespaced path is `undefined`.
> 2. **One untranslated locale leaf.** `sw`'s `okf.retrieval.mode.legacy` was
>    still the English string ("Legacy") — the CI guard only flags leaves of
>    ≥25 characters. Fixed to "Zamani"; the other five values identical to
>    English are legitimate cognates (de "Revision"/"Hybrid", fr
>    "Source"/"Mode", id "Mode").
>
> **Correction to the card's own premise:** the OKF Studio lives INSIDE the
> Admin Dashboard, whose backend routes are gated on the `admin` realm role —
> so a normal user never reaches the card. The split the role gate can
> actually express is **admin vs tools-admin**, not curator vs admin. The
> card's comments and this plan now say so.
>
> Verified in a real browser against the local build (Playwright + the repo's
> own `loginViaUI`): controls render for a tools-admin; a limit change PUTs
> exactly the changed field; the card re-reads the server's truth; the
> revision bumps; the audit row is written; an emptied or out-of-bounds input
> blocks Save with the bounds hint; the mode round-trip works. David then ran
> the same smoke test by hand and it checked out.

> **W6 STATUS 2026-11-06: CODE COMPLETE + LIVE-VERIFIED — MR !780, awaiting review.**
> Issue **#1557** (wave-level, part of this #1409 umbrella).
> The artifacts view (`components/gov-chat-frontend/src/components/okf/ArtifactsView.vue`)
> is the second view of the admin dashboard's Document Management tab
> (Documents | Artifacts). The default list now fetches `is_bundle: false`, so
> the OKF bundle zips LEAVE it; the artifacts view fetches `is_bundle: true`
> and lists them with their provenance (`repo@version`), their state, a
> download and — when the repository resolves — a link into the OKF Studio.
>
> The lie it removes: the bundles sat in the document list unlabeled, and the
> batch Delete counted a Pending bundle as deletable (only ingested/ingesting
> are status-blocked) — so the UI offered a delete the server refuses with
> `403 BUNDLE_PROTECTED`. The affordance is DROPPED, not made to work: a
> privileged write path would build on the rule W7 is about to reverse.
>
> The state vocabulary is SHARED (`src/utils/documentStatus.js`) between the
> document list and the artifacts view, so the two surfaces cannot disagree
> about what "Ingested" means — pinned by a cross-surface invariant test
> (en + fr). `FileDetailsDialog.vue` is deliberately NOT wired to it: its
> mapper takes a DISPLAY string (crawl arms included) and answers with a
> different default — sharing the module with it would change existing
> renderings, which is out of scope for this wave.
>
> Verified: frontend suite **137 suites / 3946 tests** green; coverage lines
> **89.05 %** vs the measured main baseline **88.97 %** (statements 89.01 vs
> 88.92, branches 76.16 vs 76.00, functions 67.40 vs 67.14) — the
> must-not-decrease bar is met on every metric, measured on this machine by
> stashing the wave and re-running. **Re-measured against the CURRENT main**
> after the branch merged `origin/main` (which moved the baseline): the wave
> **89.09 %** lines / **89.04 %** statements / **76.28 %** branches /
> **67.49 %** functions vs main's **89.02 %** / **88.98 %** / **76.12 %** /
> **67.23 %** — above on all four. The smoke harness gained the W6 phase
> (the artifacts view's data source: the bundle is listed by `is_bundle=true`
> and does NOT appear in the document list) and the Playwright spec
> (`tests/e2e/okf/artifacts-view.spec.js`, injected payloads) drives the view
> in a browser.
>
> **LIVE: GREEN on the local build (2026-11-06).** The spec passes **5/5**
> against the running stack. The live data contract, measured against the
> running document repository: `is_bundle=true` → **24 artifacts** (16 with a
> version, **8 without** — a third of the live set has no version, so the
> honest "unknown version" is the common case, not a corner; all 24 carry a
> `repo_id`), `is_bundle=false` → the documents, and **no bundle leaks into
> the document list**. The tree was synced with the tooling
> (`--merge-prefer-target`: the tree's HEAD is a local merge of a branch
> upstream has since merged in its own shape, so it cannot fast-forward — the
> tooling merges the target on top and verifies every conflicted file against
> it; nothing was reset, the tree's own CSR work is intact), the images were
> rebuilt, the containers recreated, `verify-local-build.sh` 46 pass / 0 fail.
> Two local-build findings that were NOT the wave's: the e2e fixtures did not
> exist in the local realm (every Playwright spec failed at login — Keycloak's
> own log says `user_not_found`; the tooling gained
> `provision-e2e-fixtures.sh`) and the recreated document-repository image
> needed the one-shot `document-repository-init` chown for `/app/uploads`
> (`EACCES` on upload). The two red CI jobs on MR !780 are the registry's
> half-published `@playwright/test@1.65.0` (**#1561** — main is red on the
> same job) and a timing flake in the okf-server RAGAS suite tests (passes
> locally 121/121, in a component this wave does not touch). **Both are GREEN
> on the re-run after the merge.**
>
> **Re-verified after the merge (2026-11-06): GREEN.** The branch merged
> `origin/main` (three new main commits — the keycloak silent-renew fix, the
> draft-contract fix, the #995 record); the tree was re-synced to the merged
> head, `frontend` / `okf-server` / `chatqna` / `retriever` rebuilt and
> recreated, `verify-local-build.sh` 46 pass / 0 fail, and the spec re-run
> against the merged stack. The re-run found ONE defect — the spec's first
> assertion read the captured `is_bundle` filters right after the view became
> VISIBLE, while the view fires its read from `mounted()`, so the capture
> could land a tick later. The read was never in doubt (the provenance test
> asserts a row whose text comes only from the `is_bundle=true` payload); the
> ASSERTION raced it. Fixed with an explicit bounded wait
> (`expect.poll`, 15 s) — an implicit race is what makes an E2E suite flaky.
>
> **Merged with `origin/main` a SECOND time** (the #991 crawl-worker fix —
> the only conflict was the CHANGELOG, whose two sides added DISTINCT
> entries to the same list, so the resolution is the union). Coverage
> re-measured: identical (89.09 / 89.04 / 76.28 / 67.49) — main's two new
> commits touch NO frontend file, so the baseline could not have moved.
>
> **The smoke harness's W6 phase, re-run LIVE: PASS** (three assertions —
> the bundle is listed by `is_bundle=true`, it does NOT appear in the
> document list, and it carries its `repo_id`). The REST of the harness run
> is red on `main` — the wave's harness diff is purely additive (54 lines,
> one block) and every failing assertion is byte-identical to `origin/main`,
> proved by a control run with main's own copy of the file. The causes are
> the harness's own staleness (it expects the pre-slug graph name, and it
> never performs the `ingest` lifecycle transition that is the only writer of
> `rag_drain_active` — the worker's claim filter). Filed as **#1568**.
>
> **Security review, re-run on the MERGED result** (a merge can drop a
> guard): **no HIGH/MEDIUM finding**. The wave adds ZERO server-side
> changes — the whole diff is frontend + i18n + tests + a CI comment + the
> smoke script — so no server rule could have been added, removed or
> weakened. The WS2 bundle guard is single-sourced and **fails closed**
> (`503 BUNDLE_GUARD_UNAVAILABLE`); the client's `is_bundle: false` filter is
> a HIDE, not a grant; the new `?repo=` deep link is server-gated on every
> read (404 anti-enumeration) and every write (`requireRepoScope('admin')`).
> The `npm audit` sweep found the wave added **no** dependency — the 6 HIGH
> advisories are `vue-i18n` 9.14.5 and the `webpack-dev-server` dev chain,
> both **unreachable** here (`srcdoc` appears nowhere in the frontend
> source, `escapeParameter` is never called, and the house `translateMixin`
> does a raw message lookup). `9.14.5` is the last 9.x release, so the fix
> exists only in the 11.x major → filed as **#1566**, not bumped here (a
> vue-i18n 9 → 11 migration touches every locale file and every call site
> and cannot ride along on a feature MR).

## Standing rules that carry over

- `feedback_approved-plan-is-not-execution-authority`: the plan is adapted on
  David's direction; implementation starts on his go.
- Issue label protocol (`.claude/rules/ISSUE-LABELS.md`): one `status::*` label
  at a time; `Closes #iid` in MR bodies only.
- No main merges without David; smoke harness extended + live-run per story when
  the build-tree sync blocker clears (still David's one-time-reset call).
