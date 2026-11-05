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
   - #947 — Validate-step review-surface pass (its ruling: folded into the
     standing UX-onboarding pass; this pass IS that pass's first slice).
   - #1510 — Validate Dismiss button writes `p.dismissed`, nothing reads it:
     remove the button (i18n ×14) OR wire dismissal persistence — decided at
     build time per the issue's own ruling.
   - #932 — marker-first affordance: "labels stale — re-ingest to apply" on
     concepts; partial-relabel mode only on RAGAS evidence; respects the
     drain-freeze rule (the issue's ruling, unchanged).
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

## Standing rules that carry over

- `feedback_approved-plan-is-not-execution-authority`: the plan is adapted on
  David's direction; implementation starts on his go.
- Issue label protocol (`.claude/rules/ISSUE-LABELS.md`): one `status::*` label
  at a time; `Closes #iid` in MR bodies only.
- No main merges without David; smoke harness extended + live-run per story when
  the build-tree sync blocker clears (still David's one-time-reset call).
