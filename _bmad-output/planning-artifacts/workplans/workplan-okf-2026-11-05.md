# Unified OKF workplan — 2026-11-05

Adapted after the PRD-issue triage (see memory `project_okf-prd-issue-triage-2026-11-05`)
and David's two priority UX directions (this session). Three streams, one execution
order. Sources of truth stay where they live: the CSR waves in
`_bmad-output/specs/spec-okf-chat-source-resolution/remediation-plan.md` (waves) +
the PRD; the triage rulings on the GitLab issues themselves; this file only pins
the ORDER and the cross-stream slots.

## Streams

| Stream | Branch | Tracker | Scope |
|---|---|---|---|
| **U — Admin-Dashboard UX pass** (PRIORITY) | `feat/admin-dashboard-ux` (cut from origin/main — independent of the unmerged CSR code) | UX-1 + UX-2 issues (below), folding #947 + #1510 + #932 | See Phase U |
| **C — CSR waves resume** | `feat/okf-chat-source-w1` (pushed through `b2d4700aa`; W1–W5 done) | #1409 umbrella, !720 planning MR (awaiting David's review/merge order) | W6–W9 per the remediation plan |
| **T — Triage-scheduled items** | slot into U/C per their rulings | the 12 open `prd::okf-server` issues | See Phase T |

## Phase U — Admin-Dashboard UX pass (FIRST)

> **STATUS 2026-11-05 (end of day): UX-1..UX-4 DONE on `feat/admin-dashboard-ux`
> (commits 2170bd1, 6ac3712, a904b68, 4f0e852); UX-5 instrumentation landed, the
> leg optimization is gated on live `[okf-lab-timing]` numbers per the ruling.
> Security review: no findings on every slice. Frontend 129 suites / 3739 tests
> green at 88.84% coverage (baseline 88.78% held+raised); okf-server 82 suites /
> 1990 tests green. MR + Phase C resume follow.**

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

## Phase C — CSR waves resume (after Phase U)

- **W6 — artifacts view** — now lands INTO the new theme (the double-restyling
  risk avoided by the ordering).
- **W7 — retract-retention D3 reversal.**
- **W8 — log purge + gate downgrade, SCOPE GREW per the #925 split ruling:**
  the delete flow also captures a **`deletion_reason`** (#925). The TTL sweep
  half stays parked pending the D3 revisit — out of scope here.
- **W9 — concept tree browse** (carries the D8 `create-ux-design` pass at story
  time).

## Phase T — triage-scheduled items (slots per the rulings)

| When | Item | Ruling |
|---|---|---|
| First CSR-adjacent slot after Phase U | **#995** retrieval-mode card | Backend done on main (GET+PUT /retrieval-config, audited); card is frontend-only, must name the EFFECTIVE posture + serving-graph count + preview before apply. Ruled "right after CSR W4" — W4 is done |
| After W6 | **#948** ingestion aggregation Studio panel | Read-only aggregation; ruled "behind CSR W4–W6" |
| With W9 / tail of C | **#914** threat model + bounded sanitizer + injection eval rows | Narrow re-scope; "behind CSR waves" |
| Not scheduled | **#909** air-gap/retention sweep | Parked; trigger = a sovereignty/air-gapped deployment contract |
| On child closure | Umbrellas **#889 #904 #956 #960** | Close when the last child closes (David) |

> **#995 STATUS 2026-11-05: CODE COMPLETE, awaiting review + MR.**
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

> **W6 STATUS 2026-11-06: CODE COMPLETE, awaiting review + MR.**
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
> Verified: frontend suite 134 suites / 3901 tests green; coverage lines
> **89.02 %** vs the measured main baseline **88.97 %** (statements 88.99 vs
> 88.92, branches 76.13 vs 76.00, functions 67.32 vs 67.14) — the
> must-not-decrease bar is met on every metric, measured on this machine by
> stashing the wave and re-running. The smoke harness gained the W6 phase
> (the artifacts view's data source: the bundle is listed by `is_bundle=true`
> and does NOT appear in the document list) and the Playwright spec
> (`tests/e2e/okf/artifacts-view.spec.js`, injected payloads) drives the view
> in a browser. LIVE verification rides the tree sync (David's one-time-reset
> call).

## Standing rules that carry over

- `feedback_approved-plan-is-not-execution-authority`: the plan is adapted on
  David's direction; implementation starts on his go.
- Issue label protocol (`.claude/rules/ISSUE-LABELS.md`): one `status::*` label
  at a time; `Closes #iid` in MR bodies only.
- No main merges without David; smoke harness extended + live-run per story when
  the build-tree sync blocker clears (still David's one-time-reset call).
