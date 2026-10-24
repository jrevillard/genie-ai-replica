# Decomposing MR !278 — the `feat/okf-server` → `main` merge train

**Status:** plan approved 2026-10-24 (David) — decomposition: YES; the two
non-merge exclusions below: APPROVED.
**Branch:** `feat/okf-server` (draft MR !278, open since 2026-08-07).
**Hard rule preserved:** !278 itself is NEVER merged. It closes empty (with an
exclusion note) once the train has landed. See
`feedback-never-merge-okf-server-to-main`.

---

## 1. Why decompose — the measured shape of !278

| Measure | Value |
|---|---|
| Commits | 577 |
| Files changed | 1033 (**+241k / −5k**) |
| Added / modified / deleted | **877 / ~122 / 34** (deleted = `.claude/skills` moves only) |
| `main` ⊂ branch | **YES — 0 commits on main not on the branch** (strict superset) |

The headline 241k is inflated. Composition:

| Bucket | Files | Lines | Merge risk |
|---|---:|---:|---|
| Process artifacts (`.claude/skills`, `_bmad-output`, `.serena`) | ~465 | ~49k | none (excluded) |
| Dev-local data/scripts (`data/`, root cloud scripts) | ~48 | ~6k | none (excluded) |
| `okf-server/package-lock.json` | 1 | ~10k | none |
| 14 locale files | 14 | ~30k | low (whole-file snapshot) |
| **MR1 product mass** (backend + overlay + infra) | ~259 | **~92k** | ~60 shared files genuinely modified |
| **MR2 frontend** | 171 | **~81k** | ~15 shared src files modified |
| **MR3 docs/site/scripts** | ~88 | **~12k** | docs/site mostly additive |

The *true* shared-file modification surface — the only thing that can disrupt
main — is roughly **75–90 files**. Everything else is new code on new paths,
and `OKF_ENABLED` already defaults to **0** with compose `replicas: 0`
(docker-compose.yaml:917-1043; the flag carries a literal *"merge prep
2026-10-21"* comment at :661). The disruptive act — flipping the flag — is a
**deployment decision, not a merge decision**, and stays out of this train.

## 2. Ground rules for the whole train

1. **Snapshot, never replay.** Each MR is built by taking the *branch tip's
   final state* of a path subset (`git checkout origin/feat/okf-server --
   <paths>` onto a fresh branch off `origin/main`). Nobody replays the 577
   commits; the history is evolutionary (49 `fix(ragas)` commits alone) and is
   not a review unit. The final tree state is.
2. **The superset discipline.** The branch must stay a strict superset of main
   for the whole train. After EVERY train MR merges into main, immediately
   merge `main` back into `feat/okf-server` (the daily-sync discipline already
   in place). This is what makes later MRs conflict-free.
3. **Dark until flipped.** Every MR lands with `OKF_ENABLED=0` semantics. No
   MR flips any default. Reviewers verify "main behaves identically" per MR.
4. **One merge at a time, CI-gated.** Sequential MRs; each must have a green
   pipeline on its own branch before merging (feedback_never_merge_without_ci),
   then be rebased/merged cleanly with auto-merge armed
   (feedback-mr-readiness-automerge) — never left open past the session
   (feedback-no-mr-left-open).
5. **Build each MR from the tip at build time.** Work continues on
   `feat/okf-server` during the train; an MR takes whatever its paths look
   like when that MR is built. Only constraint: don't build MR *n+1* before
   MR *n* has merged and main has been absorbed back into the branch.

## 3. The two approved NON-MERGES (David, 2026-10-24)

These paths are committed on `feat/okf-server` and **never flow to main**.
They stay branch-local forever (the branch remains the OKF dev trunk).

### N1 — agent/process artifacts (~465 files, ~49k lines)
```
.claude/skills/            # 371 files — BMAD skill tree
_bmad-output/              # 89 files — specs, stories, retros, this plan
.serena/
```
Rationale: process tooling for the OKF dev team, not product. If the org later
wants BMAD shared, that is one trivial additive MR — decided separately.

### N2 — dev-local data & root helper scripts (~48 files, ~6k lines)
```
data/                      # smoke fixtures, session findings, country test bundles
                           # ⚠ includes data/okf/smoke-test/editor-smoke-tokens.json (minted tokens)
ssh-cloud.sh  deploy-cloud.sh  deploy-cloud-frontend.sh
redeploy-stack.sh  redeploy-cloud-full.sh  check-logs.sh
```
Rationale: machine-local deployment scaffolding and test-session residue
(including token-bearing files — these must NOT reach a public main). Anything
later judged genuinely reusable gets relocated under `scripts/okf-*` first and
travels in a follow-up MR.

**Consequence for !278 close-out:** "everything flowed" is *everything except
N1+N2*. The close comment lists these exclusions explicitly.

---

## 4. MR1 — dark foundation (backend + AI layer + infra)

**Goal:** the entire OKF server-side world exists on main, dark, at
`replicas: 0`. Biggest MR of the train (~259 files, ~92k lines) but ~75% new
files — reviewed as *new code*, not as conflicts.

**Pathspec (verbatim, for the build command in §7):**
```
components/okf-server        components/pii-service
components/ragas-service     components/shared
components/document-repository
components/gov-chat-backend
genie-ai-overlay
deploy/  configs/  api-gateway-solution/  tests/
docker-compose.yaml  env  env.*  .gitlab-ci.yml  .gitignore
typings/  CLAUDE.md  CHANGELOG.md
```

**Contents by area:**
- `components/okf-server` (~127 files: 44 services, 64 tests, controllers,
  routes, middleware, scripts) — the repository/concept/publish/import/PII/
  RAG-routing/RAGAS services. Additive.
- `components/pii-service` (11) + `components/ragas-service` (10) — additive
  sidecars.
- `components/shared/lib` (7) — shared-lib additions; the one piece main's
  existing services also link against. Reviewer attention: API additions only,
  no behavior change to existing exports.
- `components/document-repository` (21 modified) + `components/gov-chat-backend`
  (6 modified) — **genuine shared-surface modifications**. Reviewer attention:
  crawl→OKF hooks and auth-passthrough must be no-ops with `OKF_ENABLED=0`.
- `genie-ai-overlay` (29: dataprep 5, retriever 4, core 3, chatqna 1, tests 13,
  contracts 1, build-patches 1) — the fan-out/carrier plumbing + leak fix.
- Infra: `deploy/ansible` (5), `configs/` incl. keycloak (2), gateway (2+),
  `tests/config-validator` (3), compose/env/CI — all additive or flag-gated.

**⚠ Coordination with issue !1106 (usage-frame leak):** Jerome ports the
chatqna fix to main + release/el-salvador independently. Whichever lands
FIRST wins; when building MR1, diff `genie-ai-overlay/chatqna/` between the MR
branch and main and expect it empty-or-tiny. If Jerome's port already merged,
MR1's snapshot of that file may even be a no-op — fine. Never re-apply the
branch's version blindly over a diverged main file; reconcile consciously.

**CI gate:** full pipeline — lint, all four Jest suites, pytest, Ruff,
config-validator (env parity compose↔ansible), build of the three new images,
Trivy scan. **Expected main behavior: identical** (all replicas 0; nginx
routes exist but upstreams idle).

**Verification before merge:**
1. Pipeline green on the MR branch.
2. `docker compose config` parses with default env (no OKF vars set).
3. Grep no new default-on env: `OKF_ENABLED` still `:-0` in compose.
4. Diff chatqna/dataprep/retriever vs main — only intended hunks.

**Rollback:** revert the merge commit — additive reverts cleanly.

## 5. MR2 — frontend, still dark (~171 files, ~81k lines)

**Goal:** the complete OKF Studio/editor UI exists on main behind
`VUE_APP_OKF_ENABLED=0`. No user sees anything.

**Pathspec:**
```
components/gov-chat-frontend
```
(143 src files incl. the whole `okf/` component tree, 25 scripts, plus tests
and the 14 locale files — the locale additions are ~30k lines of the 81k.)

**Shared-surface files inside (reviewer attention, ~15 files):** DS primitives
(`Dialog.vue`, `Modal.vue`, `Combobox.vue`, `InfoTip.vue`, `HealthRing.vue`),
`AdminDashboard.vue`, `AddFromLinkDialog.vue`, `FileDetailsDialog.vue`,
`UploadFilesDialog.vue`, `charts-apex-overrides.css`, router/store entries,
locale files. Every one must be a no-op when the flag is off (menu hidden,
routes unreachable, keys unused).

**CI gate:** frontend Jest (all OKF component tests, `localeConsistency`
deep-key parity across 14 locales), lint, image build.

**Verification:** build the frontend with `VUE_APP_OKF_ENABLED=0`; the OKF
entry points are absent from the rendered app; with `=1` locally, the full
Studio renders against a running MR1 stack.

**Rollback:** revert; the flag makes main-side blast radius ~zero anyway.

## 6. MR3 — docs, site, tooling, flip-ready (~88 files, ~12k lines)

**Goal:** everything a deployer needs to understand and (later) enable what
just landed dark, plus the repo-resident diagnostics tooling.

**Pathspec:**
```
docs/  site/  scripts/
```

**Notes:**
- `site/` publishes to GitLab Pages **on merge to main** (pages job is
  main-only, no MR build-check — run `hugo` locally first per
  `.claude/rules/SITE-LOCAL-DEV.md`). Docs must describe the feature as
  **available but disabled by default** — no "coming soon", no flipped
  screenshots without saying the flag is off.
- CHANGELOG `[Unreleased]` entry was carried by MR1; if the flip timing is
  known by MR3, title the entry there.
- `scripts/okf-routing-lab/` diagnostics travel here; prune session-local
  one-offs before committing (the plan's author prunes at build time).
- **Flip runbook section** (the deliverable that "completes" the train):
  how an operator enables OKF per environment — `OKF_ENABLED=1` in `.env`
  (compose) or `okf_enabled: "1"` in `group_vars` (Ansible), which services
  come up, what to verify (Studio reachable, crawl→import→publish→chat path,
  RAGAS panel). **The flip itself remains a per-deployment decision** — for
  el-salvador it needs the `okf_enabled "1"` group_vars change already
  tracked in memory (`project-okf-flag-el-salvador`).

**CI gate:** pipeline green; `hugo` build verified locally pre-push.

## 7. Build mechanics — exact commands (per MR)

Run in the main working copy (`D:\ITU-Gitlab`), on `feat/okf-server`, tree
clean, `origin` fetched:

```bash
# 0. Preflight (every MR)
git fetch origin
git rev-list --count origin/feat/okf-server..origin/main   # MUST be 0 (superset holds)

# 1. Fresh branch off main
git checkout -b merge-train/mr1-foundation origin/main

# 2. Snapshot the branch tip's state of this MR's paths (stages everything)
git checkout origin/feat/okf-server -- \
  components/okf-server components/pii-service components/ragas-service \
  components/shared components/document-repository components/gov-chat-backend \
  genie-ai-overlay deploy configs api-gateway-solution tests \
  docker-compose.yaml env .gitlab-ci.yml .gitignore typings CLAUDE.md CHANGELOG.md
#   (MR2: components/gov-chat-frontend — MR3: docs site scripts)

# 3. Sanity: the staged diff vs main is exactly this MR's path set
git diff --cached --stat | tail -3
git diff --cached --name-only | grep -vE '^(components/okf-server|…)'   # expect empty

# 4. Commit (no Co-Authored-By — grep the message), push, open MR to main
git commit -m "feat(okf): MR1/4 — OKF foundation, dark (OKF_ENABLED=0) …"
git push origin merge-train/mr1-foundation -u
# glab MR → main; verify pipeline; rebase + arm auto-merge; monitor to green; merge.

# 5. AFTER merge — restore the superset (NON-NEGOTIABLE, every MR):
git checkout feat/okf-server
git merge origin/main          # should be trivial: main content == subset of branch
git push origin feat/okf-server
```

Commit-message convention: `feat(okf): MRn/4 — <area>, dark behind OKF_ENABLED=0`.
Each MR body links this plan file and lists its pathspec verbatim.

## 8. Sequencing & close-out

```
MR1 foundation ──► main ──► absorb main into branch
   └─ MR2 frontend ──► main ──► absorb
        └─ MR3 docs+flip-runbook ──► main ──► absorb
             └─ CLOSE !278 (never merge it):
                comment: "Content landed via the decomposition train
                (merge-train/mr1..mr3, plan: _bmad-output/planning-artifacts/
                okf-decompose-mr278-plan-2026-10-24.md). Intentionally NOT
                merged: .claude/skills + _bmad-output + .serena (process
                artifacts) and data/ + root cloud scripts (dev-local)."
```

Strictly sequential: MR2's frontend routes reference services that only exist
after MR1; MR3's docs describe both. No parallel merges.

**After the train:** `feat/okf-server` remains the OKF dev trunk, now
(main + N1 + N2 + any in-flight work). New OKF work continues there and
reaches main via normal small MRs — the umbrella era ends.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Review bottleneck on MR1's 92k lines | It is ~75% new files in three new components; assign per-area reviewers (okf-server / overlay / infra); the shared-file surface is ~60 files and gets named-reviewer attention |
| `release/el-salvador` rebase onto a main that now carries OKF dark | Safe by construction: flag default 0; el-salvador's next rebase is a no-op behaviorally. The flip there is its own tracked decision |
| Double-fix drift with Jerome's !1106 port | §4 coordination note: reconcile the chatqna file consciously at MR1 build time |
| Branch diverges from main mid-train (superset broken) | §2 rule 2: absorb main into the branch after every merge; preflight check in §7 step 0 |
| Reviewer merges an MR with a red/skipped pipeline | §2 rule 4: CI green on the MR branch is the merge gate; arm auto-merge only when green |
| Hugo publishes docs for a dormant feature | MR3 wording rule: "available, disabled by default" |
| Revert pressure after a bad merge | Each MR reverts independently (additive-dominated); the flag is the global kill-switch regardless |

## 10. Open decisions (not blocking the train)

1. Does the org want BMAD skills shared on main? (Default: no — N1 stays out.)
2. Which `scripts/okf-routing-lab/*` tools are keeper-grade for main? (Pruned
   at MR3 build time; anything cut stays on the branch.)
3. Timing of the first real flip (el-salvador vs cloud vs a fresh pilot).
