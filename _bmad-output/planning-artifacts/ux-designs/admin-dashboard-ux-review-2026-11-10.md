# Admin Dashboard — UX & Thematic Alignment Review (2026-11-10)

**Scope:** the whole Admin Dashboard — the shell and every tab, the OKF Studio (wizard, editor, all dialogs/panels), analytics, query inspector, shared dialogs. ~101 components walked by five independent review passes (wizard journey, editor+dialogs, shell+analytics, cross-cutting DS/i18n/patterns, theme/token alignment), then deduplicated.
**David's weighting:** thematic/color alignment is the headline; navigation is broadly fine but every inconsistency gets documented and addressed. File:line cites are anchors, verified by two independent spot-checks (the stock chart palette, the dead event wiring).
**Status:** findings + plan. Committed in MR T1 (this MR carries the review; each subsequent wave's MR carries its own row updates).

---

## 0. Decisions (David, 2026-11-10 — the interview)

| Decision | Verdict |
|---|---|
| Wave order | **T1 (charts) then H1 (lying defaults)**; the rest follow the doc's order |
| Analytics placement | **Stays at /analytics, outside admin — SETTLED, not a finding** ("review the Admin Dashboard, not the analytics dialog"). Dead components (AnalyticsComponent, AnalyticsDashboard, root UsageTrendChart) are still removed |
| Tables standard | **DsTable for new/simple tables + opportunistic migration** of hand-rolled ones when next touched; complex domain tables stay exempt |
| Missing real data | **"The view is in place for a reason — implement the services to serve the surfaces."** H1 is service remediation first: diagnose why each backing service fails to deliver (overview health, DB stats, analytics time-series, log search), fix the service; honest empty/error fallbacks only where genuinely no data exists |
| Visual vocabulary | **Align admin via the DsCard extension points** (frost border, hoverable) — the gated layer's selectors stay untouched |
| Chart palette | **Brand-derived categorical ramp** from --brand + the four status tokens (semantic series keep status colors) |
| Testing Lab | **Single shell-owned instance** (divergent-state bug + double-fetch killed) and wire the dead `request-unpublish` in the same MR |
| New DS primitives | **All four**: DsBanner, DsCheckbox, DsRadio, DsFileInput |
| MR structure | **One clearly defined MR per wave** — each with its own branch, E2E/capture verification per the Visual Fidelity rules, coverage non-decreasing, pipeline green + fresh mergeability before any ready-report |

**The MR map:**
1. **MR T1** — chart/theme tokenization (the bridge ramp + 4 chart sites + Apex var() verification), dead analytics code removal, global-layer leaks (green hover, dead :deep block).
2. **MR H1** — service remediation for the fabricating surfaces (per the decision above) + honest fallbacks.
3. **MR T2** — shell pattern collapse (4 card families → DsCard, 3 status vocabularies → DsStatusTag/DsPill, hand-rolled modal → DsModal, admin×DsCard visual alignment).
4. **MR H2** — destructive-action consistency + the four new DS primitives + toast adoption in the editor.
5. **MR H3** — TestingLab single-instance + wire, wizard flow fixes (draft loss, poll horizon, OkfSourceDialog, friendlyError/raw-error pass).
6. **MR P1** — i18n tail (RenameRepoDialog, MAU/CAU, hardcoded fallbacks), radii → tokens, dead code sweep.

---

## 1. Executive verdict — three systemic truths

1. **The design system is sound; the surfaces don't leverage it.** The token vocabulary (two axes: light/dark/system **plus** per-deployment brand flavours — `--brand` recolors every derived accent across six deployment configs) is complete and live. The 21 DS primitives are **clean — zero hardcoded colors** — so anything built on them re-skins perfectly. The failures are all *outside* the primitives: **every chart in the product ships the stock ECharts palette** (`useChartTheme.js:57` — `#5470c6/#91cc75/#fac858…`), ignoring `--brand`, the status tokens, and every deployment flavour. That is the "new color themes not leveraged" symptom, precisely.
2. **The dashboard lies to the admin by default.** The overview boots on fabricated metrics (fake red "External API" outage, invented 92% storage, hardcoded 42.3 GB database), the security tab answers a **failed scan** with "Your system appears to be secure", the analytics time-series substitutes **`Math.random()` data** on API failure, and VictoriaLogs outages render as "no logs matched". These are correctness defects wearing a UX costume — an admin makes operational decisions off invented numbers.
3. **A silent-failure class spans the OKF editor.** The Vuex `okf.error` state is written by 15+ actions and rendered by **nobody**; bulk destructive failures report only inside a collapsible rail that hides them; the house toast service exists (`notificationService`, ~40 shell callsites) with **zero** adoption in the editor; `DsStateDisplay type="error"` is the established pattern with **zero** OKF-editor-panel uses. Outcomes there are invisible.

The workhorse surfaces are genuinely solid — documents, hierarchy, query inspector have real guards, refusal strips, and empty states. Long operations in the editor mostly poll with honest progress. The foundation to build the alignment on is good.

---

## 2. The theme system as found (the headline)

### The vocabulary (public/config/theme-variables.css, applied via ThemeManager)

- **Axis 1 — mode:** `light | dark | system`, `data-theme` on html+body (ThemeManager.js:92-177, App.vue:3).
- **Axis 2 — brand:** `--brand` set at runtime from the deployment config (config-loader.js:156), every accent derived via relative OKLch (`--accent`, `--accent-hover`, `--accent-muted`, `--accent-fg`, `--accent-secondary`). Six deployment flavours exist (original, huduma, huduma-dark-blue, huduma-magenta, huduma-red, naat), including per-deployment semantic-status overrides.
- Full families: surfaces/ink, navbar, status (+bg variants), overlay/tooltip, forms, buttons, typography (scale+fonts), spacing, radii, shadows, breakpoints. A test guard (`designTokens.test.js`) already verifies `var(--x)` references resolve.

### The alignment matrix

| Cluster | Tokenized? | Violation class |
|---|---|---|
| DS primitives (21) | **clean** — 0 hardcoded colors | two `!important` (ds/Progress.vue:115, ds/Modal.vue:236) |
| AdminDashboard shell | **fully** (345 var / 0 hex) | **pattern reinvention**: 4 private card families, own modal, own tables, 3 status vocabularies (styles :4276-4482, :4652-4716) |
| OKF studio + editor | yes (imports DS; var-fallbacks only) | 31 px-radius literals in 18 files; the graph canvas is the model citizen (RepoGraphView.vue:459-474 resolves tokens for canvas — **the in-repo pattern to copy**) |
| Analytics + charts | shell yes; **charts no** | series palettes hardcoded in 4 places (§3.1); dead generation keeps a third old palette alive |
| Query inspector | **best-aligned surface** (DS throughout, 0 hex) | the template the rest should match |
| Shared dialogs | yes (59/47/40 var, 0 hex) | FileDetailsDialog's preview iframe = hardcoded light island in dark mode (:1335-1345) |
| genie-visual-effects.css | token-derived, gated layer | **zero admin usage** — the admin dashboard is a visually different world from the chat dashboard (no entrance motion, no frost borders, no card tints) |

### The chart problem — one emblem, four sites, one fix

- `useChartTheme.js:57` — the shared bridge ships the **stock ECharts default palette** as its token payload; textColor/grid come from var() but series colors ignore everything.
- `charts/CategoryDistributionChart.vue:562` — duplicates the stock palette inline.
- `charts/UsageTrendChart.vue:320-325, 790-795` — a private 5-color D3 palette + hand-rolled CSS legend swatches + `isDarkMode` branching instead of tokens.
- `charts/SatisfactionGauge.vue:352-377` + `SatisfactionHeatmap.vue:304-316` — status colors hardcoded "to match var(--success)"; a deployment that overrides semantic colors disagrees with every DsStatusTag on the page.

**The fix is one change family:** resolve `--brand` + the four status tokens to concrete colors inside the bridge (the RepoGraphView `token()+toCanvasColor` pattern) and derive a categorical ramp — every chart re-skins in light, dark, and all six flavours at once. Plus: verify whether `TopQueriesChart.vue:431`'s `'var(--accent)'` series color actually renders (charts-apex-overrides.css:1-9 says Apex ignores CSS vars — one of the two claims is wrong); delete SatisfactionHeatmap's dead `:deep([data-theme='dark'])` block (:484-501); replace the literal green hover in theme-components.css:229 with `--accent-muted`.

### The Apex var() answer (mechanism read, 2026-11-10 — pre-verified for this MR)

The installed ApexCharts bundle applies series colors as **SVG presentation attributes** (SVG.js `.attr()` — 137 call sites); the only `.style.fill` in the whole bundle is for dataLabels. `var()` is **invalid inside SVG presentation attributes** (css-variables-1: presentation attributes use the legacy grammar; a `var()` reference is dropped at parse). Even if it parsed, Apex runs every color through `shadeColor()` string math for gradients. So `charts-apex-overrides.css`'s claim is right — and **`TopQueriesChart.vue:431` is a latent bug on main today**: its `var(--accent)` series color can never resolve, the chart is unthemed in every theme. T1 fixes it with the bridge. The browser probe (computed `fill` before/after) still runs as this MR's opening evidence per the Visual Fidelity rules — measured, not assumed.

---

## 3. Findings — deduplicated, severity-ranked

### HIGH — the admin is misled or blocked

| # | Finding | Anchor | Fix |
|---|---|---|---|
| H1 | Overview boots on fabricated metrics (uptime 99.98, 245ms, errorRate 0.05, red 92% storage bar, fake service statuses) that persist on fetch failure | AdminDashboard.vue:1817-1855, 2602-2610 | service remediation first (§0); honest fallbacks |
| H2 | Security tab renders "No Vulnerabilities Found / system appears secure" after a FAILED fetch (all-zero state installed in catch) | AdminDashboard.vue:2805-2816, 3148-3157, 1384-1396 | DsStateDisplay type=error on fetch failure — the failed scan must never read as a clean bill |
| H3 | Database tab shows hardcoded "42.3 GB / 128 tables"; stats-fetch failure swallowed | AdminDashboard.vue:1827-1830, 2843-2854 | service + honest fallback |
| H4 | UnifiedAnalytics substitutes **random** data on time-series failure; gauge shows fabricated 0.00%/Target 85% + invented history | UnifiedAnalytics.vue:698-713, 584; SatisfactionGauge.vue:156-172 | service + error/empty states, never filler |
| H5 | VictoriaLogs outage renders as "no logs matched" (searchError set but never rendered; 503 → empty results) | LogSearchDialog.vue:433-441, 215-217 | render the error state when searchError is set |
| H6 | Logs tab "Latest Search Results" panel is dead — dialog emits `search-completed`, shell listens `@search-results` (verified both sides) | LogSearchDialog.vue:432,438 vs AdminDashboard.vue:848 | rename one side |
| H7 | Produce step's conversion poll swallows all errors with no timeout horizon — wedged server parks the user forever with frozen bars | steps/Produce.vue:804-806 | max-follow horizon + "still running server-side" message (the Validate rescan deadline pattern) |
| H8 | `okf/setError` written by 15+ store actions, rendered by NO component — zip imports die silently, card sits in Import lane with no failure chip | StudioTab.vue:575-586; store/modules/okf.js:359 | render the store error (DsBanner) or a drain-style failure chip |
| H9 | TestingLab "Unpublish to review" emits `request-unpublish`; no host listens — a visible button that does nothing | TestingLabDialog.vue:2070-2082, 3312-3315; hosts wire only @close/@changed | wire it in both hosts or hide the action |
| H10 | With the metadata rail collapsed (localStorage-persisted), ALL bulk destructive failures (bulk PII, delete, re-ingest) render nowhere and read as success | RepoEditor.vue:315, 1179, 978-999 | rail-independent status line / long-action strip |
| H11 | **Chart palettes ignore the entire theme system** (§2) — identical stock-colored charts in every mode and every deployment flavour | useChartTheme.js:57 + 3 more sites | tokenize the bridge (RepoGraphView pattern) — THIS MR (T1) |

### MED — confusion, inconsistency, missing states

**Destructive-action consistency** (the biggest single cluster):
- Retract (takes serving content offline) fires unconfirmed in BOTH hosts — StudioDashboard.vue:830-847, RepoEditorShell.vue:498-532 (Publish alone gets a dialog; Ingest also unconfirmed).
- ConfirmDialog supports a danger variant nobody passes — batch delete confirms render primary blue (AdminDashboard.vue:2366-2382; same class: ResplitModal.vue:90-95 primary-variant confirm for destructive re-split).
- Access revoke/restrict (cuts off potentially hundreds of users) applies instantly, notice only after (AccessPanel.vue:393-409, 527-560).
- Delete/Unpublish/Bulk dialogs have no busy-guard — double-click double-fires, Esc closes mid-delete (StudioDashboard.vue:534-545, 888-893; bulk-publish :319-358).
- `window.confirm` for config delete + `window.prompt` ×2 for "Add question" (ModelConfigPanel.vue:658; RagasPanel.vue:2240-2243 — cancelling the second loses the first answer); OkfSourceDialog rolls its own confirm() (:373).
- Validate's near-duplicate Delete confirms nowhere (Validate.vue:136-143) while Input's identical action does (Input.vue:173-187).
- VersionsDialog's "Create new version" publishes while bypassing the PII review gate entirely (VersionsDialog.vue:170-185).
- ConceptList ingest-failcard renders clickable-looking source links inside a `pointer-events: none` card (ConceptList.vue:308-317, 776).

**Silent failures & state gaps:**
- Editor never toasts: notificationService adopted shell-wide (~40 sites), zero in okf/editor — save/import outcomes silent (cross-cutting sweep 4b).
- ConceptEditor autosave failure never re-armed until next keystroke; reported as tiny toolbar text (ConceptEditor.vue:718-723).
- AddConceptModal awaits createConcept without try/finally — a throw bricks Create/Cancel forever (AddConceptModal.vue:124-146).
- DsStateDisplay type=error exists but NO okf editor panel uses it; every panel invents its own error class (cross-cutting sweep 4c).
- QueryInspector detail failure swaps the whole panel to the LIST's error message, losing context (QueryInspector.vue:93-107); list filters reset on Back while rows stay filtered (:150-158).
- FrontmatterPanel "Refresh suggestions" silently discards unsaved manual edits (FrontmatterPanel.vue:390-400).
- ConceptEditor Close discards typed frontmatter edits unconfirmed (:1116-1121).
- Wizard: friendlyError recognizes 2 of N refusal codes; CONCEPT_TOO_LARGE-class collapses to "retry" (Produce.vue:482-501 — use Input's serverMessage pattern :644-649); raw `error.message` rendered in 4 Validate sites (:189-193, :665-668, :775, :978); citation-wire failures styled `var(--success)` — failures in green (Validate.vue:775, 1209-1211).
- Entry: half-created repo dead-end sends the user to the dashboard mid-wizard, dropping the draft (Entry.vue:137-141); "Back to dashboard" discards the pre-create draft with no confirm (StudioWizard.vue:79-81, 410-415); Choose clone failure leaves draft.repo_id pointing at a deleted repo (Choose.vue:181-185); create-dialog close unguarded mid-create (StudioTab.vue:74); OkfSourceDialog Cancel doesn't resync selectedIds — dialog state diverges from the summary (OkfSourceDialog.vue:201, 249-256); multi-file upload sequential, generic failure hides partial success, retry duplicates uploads (:344-372).
- Publish checklist's "Labels assigned" tag goes green off concepts-exist, not labels — asserts something never checked (Publish.vue:266).

**Structure & performance:**
- TestingLabDialog mounted TWICE (shell + RepoEditor), each embedding a full RagasPanel — double-fetches, divergent suite state (RepoEditorShell.vue:174-179 + RepoEditor.vue:182-188); plus three-level dialog stacking (TestingLab → RagasPanel → guide/delete DsDialogs, with a fourth confirm inside DsTabs) — flatten.
- Title keystroke pause fires a concept PATCH + FULL repo refetch per pause (RepoEditor.vue:1044-1066) — coalesce.
- One shared isLoading drives the full-screen overlay for BACKGROUND loads — the whole dashboard locks behind a spinner on every tab visit (AdminDashboard.vue:1612-1620, 2570-2611); the security panel blanks on unrelated ops (:887, 2787-2820 — use dedicated flags).
- Per-repo routing tags keyed on string hardcode `=== 'index'` instead of the row's is_index flag (ConceptEditor.vue:596, 1204).
- DsTable ×6 vs **31 hand-rolled tables** — split-brain; decision recorded (§0): DsTable for new/simple + opportunistic migration.
- ConfirmDialog vs ModalDialog — two overlapping confirmation wrappers alive; keep ConfirmDialog, retire ModalDialog.
- Three analytics surfaces, one live: only UnifiedAnalytics is routed; AnalyticsComponent + AnalyticsDashboard are dead code with sample data inside — DELETE (this MR, T1).
- Run Diagnostics opens a modal that renders no diagnostics content (AdminDashboard.vue:2829-2834, OperationResultsModal.vue:18-78).
- Repo card = `<button>` containing `<input type=checkbox>` — invalid HTML (StudioDashboard.vue:46-63).

### LOW — polish & consistency (documented, addressed in sweeps)

- **i18n:** RenameRepoDialog fully hardcoded English despite importing translateMixin (title/labels/buttons/409 text, RenameRepoDialog.vue:2-16, 70-73); `admin.monthlyActiveUsers` doubles as MAU on overview and CAU on users tab — split keys (AdminDashboard.vue:47-49 vs 1418); translate() called with an object as 2nd arg in 4 files (locale option silently ignored); hardcoded English center labels/tooltips in CategoryDistributionChart (:624-813); hardcoded fallbacks ('Delete failed', 'Export failed', 'Acknowledgement failed', 'Action failed', FileDetailsDialog's three) — route through translate(); aria-label literals ×2 + ConfirmDialog English defaults; dev note "(note: always English…)" shipped as fallback text (AdminDashboard.vue:133-138).
- **DS compliance tail:** ~60 raw form controls led by RagasPanel (26), ModelConfigPanel (13), ConceptList (9), TestingLabDialog (8), FileDetailsDialog, AdminDashboard checkboxes; no DsCheckbox/DsRadio/DsFileInput primitive exists (6+ files need one); 31 px radii in 18 files → --radius-*; 9× inline `style="grid-column: span 2"` on tab cards → a class; 3 hand-rolled selectable-card/chip rows → extract one primitive; two `!important` in ds primitives → --ds-* escape hatches; DsPill variant="warn" doesn't exist (VersionsDialog.vue:77,87 — unstyled badges).
- **Missing primitives:** DsAlert/DsBanner (improvised in 10+ places across all walkers), DsCheckbox/DsRadio/DsFileInput.
- **Hand-rolled modal shells without ESC/focus-trap/scroll-lock:** LogSearchDialog, OperationResultsModal, UploadFilesDialog (backdrop click discards in-progress searches/uploads); OkfSourceDialog hand-rolls its overlay too (:20-21).
- Dead code: logs-tab ensureMessageColumnExists DOM-hack (LogSearchDialog.vue:362-381); orphaned legacy CSS .modal/.btn-save (AdminDashboard.vue:4652-4716); console.debug breadcrumbs (StudioTab :447-466, StudioWizard :347-370, Entry :133-136); `this.logs` fetched-but-never-rendered.
- Flow polish: concept-classification select renders with no bundle staged (StudioTab.vue:156-176); LabelOnboard failure lacks Retry; Entry.refreshDomainOptions unguarded; search bar expert-only while Basic stewards get no repo search (StudioDashboard.vue:22-34); health score 0 = no-data indistinguishable from sick (:1044-1049); "View All Results" just reopens the dialog; Export success gives no feedback; AccessPanel errors can scroll out of view; LogsDialog audit table unpaged; Ragas suite-row delete unconfirmed vs suite/run deletes confirmed; Narrative dismissal global instead of per-admin; PiiReviewSummary re-fetches all concepts per publish-dialog open.
- Heatmap no-data renders as type=error (SatisfactionHeatmap.vue:285-288 — siblings do it right).

---

## 4. Navigation & IA (documented per David — mostly clean, four items)

The tab rack, unsaved-change guard, per-tab loading, and studio hand-off are all sound. Four documented items:

1. **No analytics tab in the admin shell** — SETTLED by David (§0): analytics stays at /analytics; not a finding. The dead components still get removed (this MR).
2. **Documents|Artifacts switch is a DsButton pair, not DsTabs** — deliberately mirrors StudioTab's switch; sanction it as THE second-level pattern in the frontend CLAUDE.md so a third variant never appears.
3. **Three status vocabularies coexist in the shell** (.status-good/.badge-good/.log-error families) — collapse onto DsStatusTag/DsPill tones (theme-components.css:400-434 already defines them) — T2's MR.
4. **Models tab renders for non-admins with an access note** — fine as-is; keep the note honest when OKF parks.

---

## 5. The alignment plan (phased; each phase = one MR)

**T1 — make the charts themed (this MR):**
Tokenize `useChartTheme.getCssVarStrings()` (resolve --brand + status tokens; derive a categorical ramp); point CategoryDistributionChart, SatisfactionGauge, SatisfactionHeatmap, UsageTrendChart, TopQueriesChart at it; delete UsageTrendChart's hand-rolled isDarkMode branches; delete the dead analytics generation (AnalyticsComponent, AnalyticsDashboard, root UsageTrendChart); replace the literal green hover (theme-components.css:229) with --accent-muted; delete SatisfactionHeatmap's dead `:deep([data-theme='dark'])` block; upgrade charts-apex-overrides.css's header with the mechanism fact.

**H1 — stop the lying defaults (service remediation):**
Diagnose and fix why each backing service fails to serve its view (overview health, DB stats, analytics time-series, log search 503 path, security metrics); honest fallbacks where genuinely no data exists; wire the dead search-results panel.

**T2 — collapse the shell's private pattern families:**
4 card families → DsCard variants; 3 status vocabularies → DsStatusTag/DsPill; hand-rolled modal → DsModal; admin visual alignment via the DsCard extension points (frost border, hoverable) per §0.

**H2 — destructive-action consistency + editor feedback:**
danger variant wired through ConfirmDialog; Retract/Ingest/access-revoke confirms naming consequences; busy-guards on all confirm dialogs; eradicate window.confirm/prompt; toast adoption in okf/editor; DsStateDisplay in editor panels; DsBanner + DsCheckbox/DsRadio/DsFileInput primitives created and the improvisations migrated; DsPill warn→warning fix.

**H3 — wizard flow + editor smoothness:**
Draft-loss protections (confirm-before-exit / sessionStorage), half-created-repo in-wizard continue, OkfSourceDialog selectedIds resync + per-file upload outcomes, friendlyError→serverMessage, raw-error translation pass, Validate green-failures fix, TestingLab single-instance + dialog-stack flatten + the void button wired, Title-pause coalescing, is_index keying, QueryInspector filter/detail state.

**P1 — i18n + polish sweep:**
RenameRepoDialog translation, key split MAU/CAU, object-arg translate() calls, hardcoded fallbacks, chart chrome strings, px radii → --radius-*, inline-style tab cards → class, chip/card extraction, dead code (legacy CSS, DOM hack, console.debug, unrendered fetch).

---

## Appendix — method & cross-validation

Five independent passes: (1) wizard journey Entry→Publish; (2) editor + 20 dialogs/panels; (3) shell tab-map + analytics/inspector/logs; (4) cross-cutting DS/i18n/pattern sweeps with usage counts; (5) theme/token alignment matrix. Cross-validation was high: the DsAlert gap, RenameRepoDialog, the dead analytics generation, and the chart palettes were each found by 2-3 independent passes; the highest-consequence claims (stock palette at useChartTheme.js:57; emit/listen mismatch search-completed vs @search-results; Apex's presentation-attribute color injection) were verified directly against the source before publication.
