# SST Working Plan — you + Claude

> **This is our shared decision log.** You edit it, I read it.
> Answer a question by writing under `Your answer:`. Change your mind any time —
> edit the answer and add a line to the Session Log. I check this file at the
> start of every SST session before doing anything.

Last updated: 2026-08-31

---

## 🚀 NEW SESSION? START HERE (boot sequence for Claude)

1. Read this file top to bottom, then `sprint-status.yaml` (same directory).
2. Check MR !279 state: `GITLAB_HOST=opensource.unicc.org glab api "projects/:id/merge_requests/279" | python3 -m json.tool | grep -E "state|detailed_merge"`
3. Pick the first unchecked item in **Remaining work** that has no unanswered decision blocking it.
4. Run the BMAD loop for it:
   - `/bmad-create-story <story-id>` (creates the story file from `epics.md`)
   - `/bmad-dev-story <story-file>` (implements)
   - `/bmad-code-review` (review gate)
   - Update `sprint-status.yaml` status + append to Session Log below. **Never skip this step — a stale tracker is how we got lost.**
5. Anything ambiguous → ask in chat, record the answer here as a numbered decision.

**Standing decisions (already made, don't re-ask):** D1 ✅ done · D2 HOLD MR until BMAD stories done, then merge-commit · D3 defer triggers · D5 defer Flutter · D6 = proper BMAD (story files per story).

**⚠️ BMAD automation override (this initiative only):** the `_bmad` workflow automation (`complete.yaml` — story branches, PRD-branch MRs, issue creation) assumes the `feat/{prd_key}/prd` worktree convention, which SST deliberately does not use. **A `complete.yaml` halt is expected and correct** — do not "fix" it by creating PRD branches. Instead: write the story file, commit it together with tracker updates **directly on `feat/sst`**, push. GitLab issue creation stays deferred until the #696–#725 re-baseline (see sprint-status TRACKING NOTE).

**Next up:** story **2-7 + 2-8** (degradation notice + SSE citation contract) — `/bmad-create-story 2-7` to start. Story 4-1 is fully done through the loop (dev → review → patches → committed).

---

## Where we are (30-second version)

- **Branch `feat/sst` → MR !279** (open, target `main`, pipeline green, **awaiting approvals**)
- SST = **Server-Side Tools**: web search (SearXNG) + stream ingestor (RSS) + governance wrapper + admin UI
- **MR !279: ~47 files, 17 commits** (count grows as stories land). Tracker synced (`sprint-status.yaml`)
- **Fixed 2026-08-31:** web search was silently dead in the deployed image (chatqna Dockerfile never copied `workflows/`; the `try/except` swallowed the `ModuleNotFoundError`). Now wired: `COPY genie-ai-overlay/workflows/ /app/workflows/` + explicit `requests httpx` deps. Orphaned `tools/` dupe (1,875 lines) deleted.
- **Story 4-1 complete through the full BMAD loop** (dev → 3-layer review → 4 patches → 1670 tests green → committed). Review caught the RBAC being inert behind admin-routes' mount order — fixed with an integration test pinning it.
- **Nothing is merged yet** (D2: hold until stories done, then merge-commit).
- Score (exact recount 2026-08-31): **21 review · 5 in-progress · 11 backlog · 1 blocked** — of 38 stories across 4 epics (+1 deferred)

---

## DECISIONS NEEDED — answer these

### D1 — Delete the orphaned duplicate package before merging? 🔴 blocking-ish ✅ RESOLVED

`genie-ai-overlay/tools/` (7 files, ~1,875 lines) was a dead twin of the live
`genie-ai-overlay/workflows/tools/`. Nothing imported it, no Dockerfile copied it.

- [x] **Option A (chosen):** delete `tools/` — **DONE 2026-08-31**, together with the
  real fix it was hiding: the chatqna Dockerfile never copied `workflows/`, so web
  search silently no-oped in the deployed image. Now: `COPY genie-ai-overlay/workflows/
  /app/workflows/` + explicit `requests httpx` deps. 48 SST tests green.

`Your answer: option A — executed`

---

### D2 — Merge strategy ✅ RESOLVED, then AMENDED (same day)

- [x] **Original:** HOLD the MR until BMAD catch-up done, then merge-commit.
- [x] **Amendment (later on 2026-08-31): MERGE-ANYTIME policy.** The MR may be merged
  whenever we choose — no need to wait for remaining stories — using the staging
  mechanism below. Reason: merging to `main` never touches `feat/sst`, so it cannot
  interrupt an active story session.

**How to merge anytime (operating procedure):**
- **Whole current state:** approve + merge MR !279 as a merge commit —
  **⚠️ UNCHECK "Delete source branch"**. Branch lives on; next batch = new MR
  `feat/sst → main` (auto-shows only the delta).
- **Partial (clean cut mid-branch):** `git branch sst-stage-N <green-sha> && git push
  origin sst-stage-N` → MR `sst-stage-N → main`. Stage branches are ancestors of the
  tip → no conflicts, no rebase, remainder MRs show only what's new.
- **Never while a session works on the branch:** rebase/force-push/reset `feat/sst`,
  or delete it. Everything else is invisible to the working session.

---

### D3 — Story 2-4 (search triggers) — rebuild now or defer?

The live fusion engine has **no triggers**: it never decides *when* to search.
Web search currently only fires when explicitly asked (`/test-search`).
The low-confidence trigger (<0.70) **is implemented** inline in `genieai_chatqna.py`
(verified 2026-08-31 — the audit had missed it). Still missing: time-sensitive and
LLM-fallback triggers (salvageable from the deleted dupe's git history).

- [x] **Option A (chosen):** defer the two missing triggers to a follow-up story.
- [ ] Option B: rebuild into the live fusion.py *before* merging (adds ~1-2 sessions).

`Your answer: option A — recorded`

---

### D4 — SearXNG AGPL sign-off (OQ-SST-5) 🔴 gates production, not the MR — EXPLAINED

**The issue:** SearXNG is AGPL-3.0, a strong-copyleft license. GENIE.AI is
Apache-2.0 and public-sector/DPG oriented; the project's NFR26 permits AGPL
components **only as "unmodified, API-consumed services"**.

**Why it's probably fine here:** you run the official SearXNG image as-is and only
call its HTTP API from chatqna. No code changes, no embedding, no distribution to
end users — exactly the boundary AGPL's network clause (§13) draws. Your
`configs/searxng/settings.yml` is configuration, not source modification.

**Why sign-off still matters:** (1) the "we never modify" argument is load-bearing
under AGPL §13, so it should be written down; (2) some public-sector legal teams
ban AGPL outright regardless of usage mode; (3) DPG compliance reviewers look for
recorded license decisions.

**What recording it means concretely:** one short ADR ("SearXNG AGPL exception
under NFR26 — unmodified image, API-only, config-only changes") + name/date of
whoever owns compliance.

`Your answer (who signs off — name/role, or "write the ADR, defer signature"):`

---

### D5 — Flutter citation parity (story 2-10) — in scope for this initiative?

Vue renders citations; mobile does not. No `mobile/` changes exist in the MR.

- [x] **Option A (chosen):** defer to the mobile team / next initiative.
- [ ] Option B: keep in this initiative's backlog (it stays on the list either way — this just sets priority).

`Your answer: option A — recorded`
 
---

## Remaining work (backlog + in-progress, priority order)

Ordered by: blocks merge → blocks production → everything else.

| # | Story | Why this order |
|---|-------|----------------|
| ~~1~~ | ~~D1 cleanup~~ | ✅ DONE 2026-08-31 (dupe deleted + image wiring fixed) |
| ~~2~~ | ~~4-1 requireRole RBAC~~ | ✅ DONE through full BMAD loop 2026-08-31 (in MR !279; → `done` on merge) |
| 3 | 2-7 + 2-8 finish: degradation notice + SSE citation contract (OQ-SST-7) | User-facing correctness — **START HERE** |
| 4 | 4-9 finish: real i18n keys for AdminToolsView (14 locales, CI gate) | CI gate exists for this |
| 5 | 4-8 finish: verify role-grant half works | Admin can maybe only view |
| 6 | 2-4 finish: time-sensitive + LLM-fallback triggers (per D3) | Feature completeness |
| 7 | 1-5 OTel spans on governance phases | Observability requirement |
| 8 | 1-6 Presidio container + plumbing | PII hard-guarantee (regex today) |
| 9 | 1-1 schemas package (into live `workflows/tools/`) | Contract for 2-8/2-10 |
| 10 | 4-4, 4-6, 4-7 admin UI: whitelist editor, audit viewer, health overview | Depends on 1-3 backend (done) |
| 11 | 3-4, 3-5, 3-9, 3-11 ingestor: JSON-API polling, webhooks, DLQ, regression guard | 3-11 is the production gate (needs OQ-SST-4) |
| 12 | 2-10 Flutter parity (per D5) | Last |

Blocked elsewhere: **1-7** (needs OPEA 1.5 bump task A1 — not ours).
Deferred: 5-1 analytics dashboard.

---

## Open questions carried from the PRD (lower urgency)

- **OQ-SST-2** — port the original 17-ADR spec from `feat/server-side-tools/prd` or leave as history? *(my take: leave it — PRD §2.2 already records what was subsumed)*
- **OQ-SST-3** — confirm governance + web search are the hard blockers for #603? *(affects whether backlog items 6-9 are must-ship)*
- **OQ-SST-4** — which curated-only baseline validates feed-chunk relevance? *(blocks 3-11 only)*
- **OQ-SST-8** — tool-host boundary: shell only or more? *(blocks 1-7 only, which is already bump-gated)*

`Your answers (any, any time):`

---

## BMAD quick reference (the method this project uses)

```
planning-artifacts/          implementation-artifacts/
  prd-*.md        ─────────►    sprint-status.yaml   ← the scoreboard (now synced)
  architecture.md              stories (not used this initiative — see note)
  epics.md        ─────────►    plan.md              ← THIS FILE (decisions)
```

Full phase chain: **brief → PRD → architecture → epics → sprint plan → stories →
dev → review → retrospective.** Each phase has a slash command (e.g.
`/bmad-create-story`, `/bmad-dev-story`, `/bmad-sprint-status`).

**Where we are:** mid *dev/review* — this initiative skipped the per-story
files (work went epics → code directly). That's exactly why the tracker drifted.
**Decision D6: from here on, proper BMAD — every remaining story gets
`/bmad-create-story` → `/bmad-dev-story` → `/bmad-code-review`, in that order.**

### D6 — Process for follow-up stories ✅ RESOLVED

- [ ] Option A: lightweight — plan.md + sprint-status.yaml only.
- [x] **Option B (chosen): proper BMAD** — `/bmad-create-story` per story, then `/bmad-dev-story`.

`Your answer: option B — recorded`

---

## Session log (append-only — newest at top)

| Date | What happened |
|------|---------------|
| 2026-08-31 (8) | **D2 amended: merge-anytime policy.** MR !279 may merge whenever we choose (merge commit, never delete source branch); partial merges via ancestor stage branches (`sst-stage-N` at green commits). Hard rule while sessions run: never rewrite feat/sst history. Rationale: merging to main is invisible to the active story session. |
| 2026-08-31 (7) | Story 4-1 committed + pushed to feat/sst (independently re-verified: 1670/1670 backend tests, eslint + prettier clean). Exact tracker recount: **21 review · 5 in-progress · 11 backlog · 1 blocked of 38** (earlier "17 review" lines undercounted — 21 is grep-verified). Next: 2-7 + 2-8. |
| 2026-08-31 (6) | **Story 4-1 code review passed (3 adversarial layers) + 4 patches applied.** Review caught a real production bug my dev session missed: admin-routes (`/api/admin`, blanket `requireAdmin`) mounted before tools-routes in ROUTE_CONFIGS → the new RBAC was inert in the composed app (route tests had mounted the router standalone). Fixed: mount order swapped, trailing default-deny added to tools router, composed-app integration test w/ real middleware added (5 tests), route-test harness hardened. Backend 65 suites / 1670 tests green, lint + format clean. 2 pre-existing findings deferred to deferred-work.md (double-authenticate; admin-routes token logging). Status stays `review` → `done` when MR !279 merges. Next queued: **2-7 + 2-8**. |
| 2026-08-31 (5) | **Story 4-1 implemented (dev-story session)**: `requireRole(...)` added to keycloak-auth-middleware (fail-closed, claims-based, `requireAdmin` byte-identical); tools-routes split read guard (`tools-admin`/`tools-reader`/`admin`) + write guard (`tools-admin`/`admin`); 16 new tests (middleware unit + route RBAC incl. tools-reader 403 on writes, NFR8 read path); backend 64 suites / 1662 tests green, lint + Prettier clean. Status → **review**, changes uncommitted in working tree (user commits). Next queued: **2-7 + 2-8**, then `/bmad-code-review 4-1`. |
| 2026-08-31 (4) | Story 4-1 file created (create-story session): verified `requireRole` doesn't exist, `tools-routes.js:19` blankets requireAdmin → both epic ACs fail today; story ready-for-dev. Its complete.yaml halt declared **correct by design** (override documented above). Correction: commit 0b9b64531 contained ONLY the tools/ deletion — the Dockerfile image-wiring fix was never in it (silent git add failure). Actually landed now as a verified follow-up commit. |
| 2026-08-31 (2) | Decisions recorded: D1 executed (chatqna image wiring fixed — COPY workflows/ + explicit requests/httpx; orphaned tools/ deleted; 48 tests green), D2 hold MR until BMAD stories done then merge-commit, D3 defer remaining triggers, D5 defer Flutter, D6 proper BMAD. D4 explained (AGPL) — awaiting sign-off owner. Real MR size corrected: 50 files +6,844/−96 (earlier 167-file figure was measured against a stale local main). |
| 2026-08-31 | Audited feat/sst vs tracker; re-baselined sprint-status.yaml (17 review / 5 in-progress / 12 backlog); found orphaned `tools/` dupe (D1); created this plan; MR !279 pipeline confirmed green. |
