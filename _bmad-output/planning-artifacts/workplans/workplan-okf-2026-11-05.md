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

> **NOT A CSR WAVE — the concept-document ceiling (curation half).** It ships on
> its own branch (`feat/okf-concept-ceiling`, MR !788, issue **#1576**), because
> it is the *ceiling initiative's* curation half and not a slice of the
> chat-source remediation. Its story file is named
> `_bmad-output/implementation-artifacts/csr-w7-concept-ceiling-story.md` — that
> file's **own "W7" label is NOT this workplan's W7** (retract-retention D3
> reversal, above, still not started). The deferred curator-initiated split is
> **#1577**; the ceiling-vs-document-budget drift found while documenting it is
> **#1588**.

## Phase T — triage-scheduled items (slots per the rulings)

| When | Item | Ruling |
|---|---|---|
| First CSR-adjacent slot after Phase U | **#995** retrieval-mode card | Backend done on main (GET+PUT /retrieval-config, audited); card is frontend-only, must name the EFFECTIVE posture + serving-graph count + preview before apply. Ruled "right after CSR W4" — W4 is done |
| After W6 | **#948** ingestion aggregation Studio panel | Read-only aggregation; ruled "behind CSR W4–W6" |
| With W9 / tail of C | **#914** threat model + bounded sanitizer + injection eval rows | Narrow re-scope; "behind CSR waves" |
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
