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

**Standing decisions (already made, don't re-ask):** D1 ✅ done · D2 merge-ANYTIME (amended — see D2 below) · D3 defer triggers · D5 defer Flutter · D6 = proper BMAD (story files per story).

**⚠️ BMAD automation override (this initiative only):** the `_bmad` workflow automation (`complete.yaml` — story branches, PRD-branch MRs, issue creation) assumes the `feat/{prd_key}/prd` worktree convention, which SST deliberately does not use. **A `complete.yaml` halt is expected and correct** — do not "fix" it by creating PRD branches. Instead: write the story file, commit it together with tracker updates **directly on `feat/sst`**, push. GitLab issue creation stays deferred until the #696–#725 re-baseline (see sprint-status TRACKING NOTE).

**Next up:** story **2-7 + 2-8** (degradation notice + SSE citation contract) — `/bmad-create-story 2-7` to start. Story 4-1 is fully done through the loop (dev → review → patches → committed).

---

## Where we are (30-second version, updated 2026-09-05)

- **Branch `feat/sst` → MR !279** (open, target `main`). **PUSH DEFERRED per user** — 11+ commits queued locally; `git push origin feat/sst` when the network to opensource.unicc.org is back (no new MR needed, deltas auto-show).
- **14 stories through the full BMAD loop this session** (create-story → dev → 3-layer review → patches → commit): 4-1, 2-7, 2-8, 4-9, 4-8, 2-4, 1-5, 1-1, 1-6, 3-4, 4-4, 4-6, 4-7 (+ stream-ingestor compose hotfix). 3-5 dev complete, review gate pending.
- Suites all green: overlay **825** / backend **1705** / frontend **1268** / config-validator **25**.
- Epic 1 complete except bump-gated 1-7. Epic 2 fully caught up (incl. D3 triggers + OQ-SST-7 resolved). Epic 4 admin UI core complete (4-1..4-9). Epic 3: 3-4 done; 3-9 partial (DLQ write-side shipped), 3-5 dev done pending review, 3-11 open.
- **Web search is now operator-complete**: env kill-switch + fail-closed, runtime whitelist via admin UI (tools_config doc, next-query effect), FR9 time-sensitive triggers, FR24 quality gate, degradation truth table with SSE contract — all reviewed and pinned.
- **Open for user:** D4 AGPL sign-off owner; 4-8 Keycloak deep-link UX call; whether to wire governance/Redis into chatqna (NFR11 backlog item — candidate next initiative).
- Backlog remaining: 3-9 (breaker + DLQ consumer), 3-11 (regression guard, production gate needing OQ-SST-4), 2-10 Flutter (D5), 5-1 analytics (post-MVP), 1-7 (bump-gated).

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

## Remaining work — progress + ETA (updated 2026-09-05, post mega-session)

**ETA unit = one BMAD-loop session** (create-story → dev-story → code-review → commit; measured from story 4-1 ≈ 1 session/story). Calibrated on actuals, not hope.

### ✅ Done (22 of 38)
| What | Status |
|---|---|
| 21 stories in review (all four epic cores + 4-1 RBAC through full loop) | in MR !279, merge-anytime per D2 |

### 🔨 Milestone A — "merge-clean" (finish the half-done stories) → **~3–4 sessions**
| # | Story | ETA | Why |
|---|---|---|---|
| 3 | 2-7 + 2-8 finish: degradation notice + SSE citation contract (OQ-SST-7) | 1–2 sess | User-facing correctness — **START HERE** |
| 4 | 4-9 finish: real i18n keys, 14 locales + CI gate | 1 sess | Mechanical, CI-enforced |
| 5 | 4-8 finish: verify role-grant half | 0.5 sess | Verify + small fix |

*After A: merge a fully-coherent SST (every story either done or cleanly backlog).*

### 🏭 Milestone B — "production-grade" → **+4–6 sessions (cumulative ~8)** 
| # | Story | ETA | Why |
|---|---|---|---|
| 6 | 2-4 finish: time-sensitive + LLM-fallback triggers | 1 sess | Feature completeness |
| 7 | 1-5 OTel spans on governance phases | 1 sess | Observability (pattern exists) |
| 8 | 1-6 Presidio container + plumbing | 1–2 sess | PII hard-guarantee |
| 9 | 1-1 schemas package (port from git history) | 0.5–1 sess | Contract for citations |
| — | 3-11 regression guard (needs OQ-SST-4 answer) | 1 sess | THE production gate |

### 🧰 Milestone C — "full initiative" → **+5–7 sessions (cumulative ~14–17)**
| # | Story | ETA | Why |
|---|---|---|---|
| 10 | 4-4, 4-6, 4-7 admin UI: whitelist editor, audit viewer, health overview | 2–3 sess | Backend (1-3) already done |
| 11 | 3-4, 3-5, 3-9 ingestor: JSON-API polling, webhooks, DLQ | 3 sess | Resilience depth |

Blocked elsewhere: **1-7** (needs OPEA 1.5 bump task A1 — not ours, no ETA).
Deferred: **2-10** Flutter (D5), **5-1** analytics.

**Wall-clock at various paces:** 1 session/day → A in 3–4 days, full in ~3 weeks · 3 sessions/week → full in ~5–6 weeks · weekend batching (3–4 sess/weekend) → full in ~4–5 weekends.

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
| 2026-09-06 (25) | **Story 3-11 done (CI half) — Epic 3 complete.** Retraction-isolation pinned in `TestRetractionIsolation` (the AQL's `source_type == 'feed'` filter verified REAL — file chunks unreachable by construction; 3 tests assert query text, retract-POST targets, no-op guards). OQ-SST-4 resolved-as-proposal: **ADR 0004** ratifies the curated-only anchor eval (`run_eval.py anchor`) as the relevance baseline — acceptance: no gold-query recall regression with feeds on, file-chunk recall unchanged after retraction; `tests/rag-benchmarks/FEED_BASELINE.md` documents the 3-run operator procedure (deployed stack, on-demand — not CI). Also cleaned a broken pre-compaction stray (`tests/test_stream_ingestor.py` at repo root). Overlay **835 green**, ruff clean. **Awaiting user:** ADR 0004 sign-off. |
| 2026-09-06 (24) | **Story 3-5 done through full BMAD loop** — webhook push ingestion. POST /v1/tools/webhook/{feed_name}: auth-FIRST ordering (the story's written 404-first was overturned — it was a feed-enumeration oracle), dual auth evaluated independently (constant-time X-API-Key + RS256 JWT via PyJWT, issuer/JWKS resolved from the realm's OIDC discovery doc — one internal KEYCLOAK_URL serves both, same convention as the backend), per-feed sliding window 429+Retry-After (local limiter — single-file image), kill-switch default OFF, outage → 503 not 404. Review (Blind 17 findings + Edge partial before rate-limit; in-session AC walk replaced the 429-killed Auditor) also fixed 2 **3-9 carryovers**: `_replay_dlq` called undefined `self._auditRedis()` (replay could never run) and `breaker_dlq_recorded` never reset on recovery. Compose env block + env SECTION 15. Ingestor **28** / overlay **832** green, ruff clean, compose renders. Epic 3 remaining: 3-11 regression guard. |
| 2026-09-05 (23) | **Story 3-9 done through full BMAD loop** — per-feed resilience complete. Breaker state machine on the feed doc (3-fail OPEN → HALF_OPEN probe → auto-close + DLQ replay on recovery), DLQ replay (webhook-origin only, chronological, retry cap **parks to a review list — never destroyed**), poll rate floor (D8). Review (Blind) caught 2 Highs: retry-cap xdel **destroyed** DLQ payloads masquerading as "manual review", and replay exceptions escaping `_mark_feed_success` (re-marking successful polls as failed, losing breaker-closed). Both patched with parking-list + isolation guards. +6 tests; overlay **831 green**. Epic 3 remaining: 3-11 regression guard (production gate, needs OQ-SST-4). |
| 2026-09-05 (22) | **Session total: 14 stories through the full BMAD loop** (4-1, 2-7, 2-8, 4-9, 4-8, 2-4, 1-5, 1-1, 1-6, 3-4, 4-4, 4-6, 4-7 + compose hotfix; 3-5 dev complete, review gate pending API-window). Every remaining epic core caught up: Epic 1 complete except bump-gated 1-7; Epic 2 fully caught up incl. D3's deferred triggers; Epic 4 admin UI core complete (4-1..4-9). **Push DEFERRED per user** — 11+ commits queued locally on feat/sst (GitLab was unreachable; push = `git push origin feat/sst`, no new MR). Suites: overlay **825** / backend **1705** / frontend **1268** / config-validator 25. **Still open for user:** D4 AGPL sign-off owner; 4-8 deep-link UX call. **Still open in backlog:** 3-9 breaker+DLQ consumer (partial), 3-11 regression guard (production gate, needs OQ-SST-4), 2-10 Flutter (D5 deferred), 5-1 analytics (post-MVP), 1-7 (bump-gated). Deferred-work file grew: with_span context attach, dedicated ArangoDB user, StreamIngestor seen-on-dataprep-failure, UI type/content_mapping form fields. |
| 2026-09-05 (21) | **Story 3-4 done through full BMAD loop** — first Epic-3 backlog story; also introduces the DLQ write-side 3-9 consumes. json_api feed_type dispatch (RSS byte-identical, regression-guarded), dot-path content_mapping, parse_error/config_error DLQ gate, stable-sha256 dedup (newest-500). Review (Blind + Edge, both empirical) caught **3 CRITICALS**: httpx missing from the runtime image (deploy would have crashed every json poll), fetch-failure raise landing outside process_feed's try (no backoff + starved all other feeds), and arbitrary seen-cap eviction (perpetual re-ingestion on >500-item feeds). Fixed with shared bookkeeping helpers + per-feed isolation + insertion-order ids + httpx dep. 2-3-style stale-note correction: 3-9's "no backoff" note was stale (backoff shipped in 3-3) — updated. Overlay **815 green**. Deferred: UI type/content_mapping form fields (3-5/4-5 scope); item ids marked seen on dataprep failure (RSS-inherited, 3-9 scope). |
| 2026-09-05 (20) | **Story 4-7 done through full BMAD loop — the admin-UI epic-4 core is complete.** `GET /health`: live SearXNG probe (root path, 30s cache, `?refresh=1` bust, 429/403 = up), breaker state from `cb:{tool}:state` (missing = healthy default; Redis error = unknown, never faked), feed status derived (disabled=grey / green / yellow 1–2 / red ≥3). Review patches: raw-doc vs normalized `enabled` contradiction, disabled≠red, fail-closed circuit badges, error-string hygiene (no host:port leak; fetch cause surfaced), feeds-read failure no longer 500s the whole endpoint, Arabic mojibake. **Push still blocked (GitLab unreachable) — 11 commits queued locally.** Suites: backend **1705** / frontend **1268** / overlay **804**. Remaining: Epic-3 backlog (3-4/3-5/3-9/3-11), 1-7 (bump-gated). |
| 2026-09-01 (19) | **Story 4-6 done through full BMAD loop** — the FOI access path. BFF XREVRANGE **peek** reader over the tool-invocation-audit stream (never XREADGROUP/XACK — consuming would steal from the future analytics consumer); public-fields-only decode (`parameters_redacted`/`metadata` never leave the backend — test-pinned against the real service); GET /audit + CSV/JSON export behind readGuard (tools-reader = the FOI path); admin Audit tab ×14 locales with honest empty state (stream is empty until NFR11 wiring lands). Review caught 2 Highs: **export silently truncated to the 500-row listing cap** (`_maxCap` lift) and **sparse-filter pagination dead-ending** (cursor now set on window exhaustion); plus CSV formula injection, export `<a href>` bypassing auth (Edge's jsdom navigation confirmed it — now an authenticated blob download), Redis fail-fast + error listener, race-guarded store. Backend **1700** / frontend **1266** / overlay **804**. Remaining: 4-7 health overview, Epic-3 backlog, 1-7 (bump-gated). |
| 2026-09-01 (18) | **Story 4-4 done through full BMAD loop** — the last Milestone-B admin-UI core piece. Runtime-editable tools config: ArangoDB `tools_config` singleton + BFF GET/PUT (strict payload contract after review caught boolean-coercion re-enabling disabled search + partial-PUT wiping the whitelist) + chatqna per-query enforcement (whitelist suffix-filter before fusion, doc toggle with env-wins precedence, env-first saves the fetch on the kill path) + admin Configuration tab ×14 locales. Review also flipped the UI edit gate to default-DENY and corrected **2-3's stale evidence claim** (governance.py's domain_whitelist was declared-but-unwired — the real enforcement is this story's seam filter). Deferred: dedicated limited ArangoDB user (chatqna now has root creds like every overlay service — systemic). Backend **1694** / frontend **1260** / overlay **804**. Remaining: 4-6/4-7 admin UI, Epic-3 backlog, 1-7 (bump-gated). |
| 2026-09-01 (17) | **3-x compose flag resolved (hotfix `824c1a349`).** Root cause: stream-ingestor (always-on) `depends_on` dataprep-arango-service (`profiles: [opea]`) → undefined-service error on every bare `docker compose config/up`. Fix: gated stream-ingestor under `profiles: [tools]` (it's an SST service that could never run without opea anyway); compose header documents the tools profile. Bare + full renders valid; config-validator 25 green. **Note:** Swarm ignores profiles — deploy behavior unchanged there. Remaining flags for the user: D4 AGPL sign-off (owner needed) + the epic's Keycloak deep-link replacement UX call from 4-8. |
| 2026-09-01 (16) | **Story 1-6 done through full BMAD loop — Epic 1's last unbump-gated story.** The review earned its keep: my dev implementation was **DOA against the pinned images** — Edge+Auditor verified the real Presidio API at tag 2.2.362 and found 4 contract bugs (analyzer returns `start`/`end` not `start_position`; anonymize wants `analyzer_results` not `anonymizer_info`; **anonymizer listens on 3000 not 3001** — five config surfaces agreed on the wrong port; healthchecks hit nonexistent `/api/v1/health`), plus a fail-open path returning unredacted text on wrong-shape 200s. All invisible to my green tests — they mocked the fabricated shapes. Fixed to the verified contract + tests rewritten. Also: `--profile tools` gating, PRESIDIO_TIMEOUT_SECONDS (5s, recorded 2s deviation — spaCy cold start), SEARXNG_URL finally Ansible-overridable (E7 exemplar closed). Overlay **798** / validator 25. **Flag for 3-x owner:** `docker compose config` fails today on stream-ingestor → undefined `dataprep-arango-service` (pre-existing). Epic 1 complete except bump-gated 1-7. |
| 2026-09-01 (15) | **Story 1-1 done through full BMAD loop.** Declared contracts (`workflows/tools/schemas.py`: Citation D10, Degradation D7, ToolResult) ported from the deleted dupe with three reconciliations (destination workflows/tools; ChunkSourceType stays in core — the chatqna Dockerfile ships only selected core files, an import would break the deployed image; DegradationReason = the recorded 2-8 contract). Review (3 layers, Edge reproduced every finding live) caught **NaN→confidence-1.0** (min/max clamp trap, both High-finders) and naive-datetime→local-time ISO — plus extra=ignore, free-form fallback_applied, silent field-drop serializers. Module hardened: frozen DTOs, `extra="forbid"`, UTC coercion, `allow_inf_nan=False`, `Literal["rag_only","none"]`, serializers delegate to pydantic. Zero wiring. Overlay **786 green**. Epic-1 remaining: 1-6 Presidio, 1-7 (bump-gated). |
| 2026-09-01 (14) | **Story 1-5 done through full BMAD loop.** Three epic-pinned spans (`sst.governance.pre/runtime/post`) via `tracing.with_span` with a no-PII attribute allowlist (user_id excluded, redacted content never touched); blocked path emits pre+post with no runtime span. Review: both Highs were in MY tests (vacuous PII pass without a span anchor; shared mock hiding per-span attribution) — tests rebuilt with per-span mocks + exception-lifecycle pin; telemetry truthfulness fixed (no fabricated 0.0ms / empty audit ids — `governance.audit_written` bool instead). Edge Hunter verified the Dockerfile ships tracing.py (no repeat of the web-search missing-module kill). **Deferred-work entry:** `with_span` never attaches OTel context (`trace.use_span` missing in `_SpanContext`) — tool HTTP spans don't nest under governance spans; one tracing.py fix benefits all with_span callers (dataprep included). Overlay **759 green**. |
| 2026-09-01 (13) | **Story 2-4 done through full BMAD loop** (D3's deferred follow-up — now shipped). FR9 time-sensitive (fires at ANY confidence, word-boundary matching + containment for non-Latin) + FR10 `llm_requested` (contract plumbed; caller arrives with LangGraph) ported from the deleted dupe `c0008225f`; FR8 delegated to the same engine. Review (3 layers) caught the kill-switch failing OPEN on blank/typo values — now fail-closed allow-list — plus bad-threshold masquerading as engine-outage, replace-vs-add pattern override contradiction, and `\b` breakage for CJK. All patched (+12 tests). Env template gained SECTION 15 (web-search controls). Overlay **755 green**. D3 fully discharged. |
| 2026-09-01 (12) | **Story 4-8 done through full BMAD loop.** Analysis verdict: the "grant half" was already wired end-to-end — the real gaps were the missing live-roles source (JIT rule makes the search payload stale) and the fact that **the role dialog template never existed** (commit 9435c0ef9 shipped script methods with zero template markup; the Roles button toggled state nothing rendered). Shipped: `GET /api/admin/users/:key/roles` (proxy filter + projection), DsModal dialog with fetch-on-open + post-toggle re-sync + failure-safe disables, 4 roleDialog i18n keys ×14, NotFoundError/ValidationError error-class fixes (dead `err.status=400` → 500 bug), race guards (reactive-proxy identity trap caught by my own tests), trust-boundary roleName validation, JIT pin. Backend 1688 / frontend 1253 green. **Open UX call (yours):** the epic says REPLACE the Keycloak-console deep link with in-app grant/revoke — I kept it as an escape hatch; say the word to remove it. |
| 2026-08-31 (11) | **Story 4-9 done through full BMAD loop** (create → dev → review → 5 patches). 37 `admin.tools.*` keys × all 14 locales with real translations (man/st conservative per file orthography); per-component `translate()` in AdminToolsView (router-mounted view — no parent delegation); delete button wired to confirm-guarded `removeFeed()` (latent bypass fixed). Review (Blind Hunter full; Edge/Auditor partial — both died on API 429 usage limits, partial results re-verified in-session): caught phantom `urlPlaceholder` key used in template but in NO locale file (uniformly-missing passes the gate — gate compares files to files, never to the template) → dropped for a static locale-neutral placeholder; + es grammar, man duplicate-translation, man feedu/feedo, st cancel/delete verb collision. Locale gate + 1249 frontend tests green. **Follow-up flagged:** QueryInspector's `admin.queryInspector.*` keys exist in NO locale file (fallback-only, NFR30 class). Status: review, committed. |
| 2026-08-31 (10) | **Story 2-8 done through full BMAD loop** (create → dev → 3-layer review → 7 patches). Dev: `SSE_METADATA_FIELDS` declared contract in BFF (D20), `source_type` on citations, drop logging; fixed dead `is_tool_result` branch (2-6 hazard E6 — web citations never rendered). Review caught 2 more Highs (parser masked by my route-test mock — recurring lesson): **(1)** `parseChatQnASSELine` rebuilt metadata into a fixed key set, stripping `degradation` BELOW the whitelist → parser now spreads all producer keys, whitelist is the single filtering point; **(2)** RERANK reconstruction stripped tool markers → `_TOOL_RESULT_FIELDS` merge-back. Also: cross-seam `web_search_attempted` memo (one SearXNG call/request), tool scores out of `retrieval_confidence_score` (synthetic 0.85 ≠ calibrated scale; web-only = grounded + 0.0), Vue pseudo-id dedupe exemption + `categoryLabels` fix + LINK type. **OQ-SST-7 → RESOLVED (declared contract).** Decisions: `tool_id="web_search"`, reasons = SEARCH_UNAVAILABLE \| LOW_QUALITY (+CIRCUIT_OPEN/EXECUTION_ERROR reserved), source_type = document \| web_search (feed reserved). Suites 728/1673/1249 green. **2-9 inputs recorded:** sidebar shows raw pseudo-id; conversation reload loses web citations/metadata; `retrieved_at` absent from contract (FR37 provenance labels need it). Status: review, committed. |
| 2026-08-31 (9) | **Story 2-7 done through full BMAD loop** (create → dev → 3-layer review → 6 patches). Dev: FR24 quality gate `filter_usable_results` in fusion.py; `_apply_web_search_fallback` truth table in chatqna (AC1 silent RAG-only on outage-with-KB / AC2 SEARCH_UNAVAILABLE / AC3+5 LOW_QUALITY with guidance / AC4 fuse unchanged); degradation rides the existing metadata SSE event + non-stream payload; silent try/except swallow eliminated. Review caught 2 reproduced crash regressions (narrowed except + null fields from SearXNG/TEI) — patched: never-kill-chat broad guard, null-safe gate + max_score, script-aware threshold halving (CJK/Arabic), KB-aware LOW_QUALITY wording, seam-wiring test. Overlay **722 tests green**, ruff clean. **Flags for 2-8:** settle `tool_id` spelling (`web_search` in code vs `web-search` in the Decision-7 exemplar) + enumerate `reason` values (incl. new `SEARCH_UNAVAILABLE`) before freezing the contract. **Known gap (NFR11):** governance/Redis still not wired into chatqna (no Redis env in compose) — candidate backlog item. Status: review, committed by Claude on feat/sst. |
| 2026-08-31 (8) | **D2 amended: merge-anytime policy.** MR !279 may merge whenever we choose (merge commit, never delete source branch); partial merges via ancestor stage branches (`sst-stage-N` at green commits). Hard rule while sessions run: never rewrite feat/sst history. Rationale: merging to main is invisible to the active story session. |
| 2026-08-31 (7) | Story 4-1 committed + pushed to feat/sst (independently re-verified: 1670/1670 backend tests, eslint + prettier clean). Exact tracker recount: **21 review · 5 in-progress · 11 backlog · 1 blocked of 38** (earlier "17 review" lines undercounted — 21 is grep-verified). Next: 2-7 + 2-8. |
| 2026-08-31 (6) | **Story 4-1 code review passed (3 adversarial layers) + 4 patches applied.** Review caught a real production bug my dev session missed: admin-routes (`/api/admin`, blanket `requireAdmin`) mounted before tools-routes in ROUTE_CONFIGS → the new RBAC was inert in the composed app (route tests had mounted the router standalone). Fixed: mount order swapped, trailing default-deny added to tools router, composed-app integration test w/ real middleware added (5 tests), route-test harness hardened. Backend 65 suites / 1670 tests green, lint + format clean. 2 pre-existing findings deferred to deferred-work.md (double-authenticate; admin-routes token logging). Status stays `review` → `done` when MR !279 merges. Next queued: **2-7 + 2-8**. |
| 2026-08-31 (5) | **Story 4-1 implemented (dev-story session)**: `requireRole(...)` added to keycloak-auth-middleware (fail-closed, claims-based, `requireAdmin` byte-identical); tools-routes split read guard (`tools-admin`/`tools-reader`/`admin`) + write guard (`tools-admin`/`admin`); 16 new tests (middleware unit + route RBAC incl. tools-reader 403 on writes, NFR8 read path); backend 64 suites / 1662 tests green, lint + Prettier clean. Status → **review**, changes uncommitted in working tree (user commits). Next queued: **2-7 + 2-8**, then `/bmad-code-review 4-1`. |
| 2026-08-31 (4) | Story 4-1 file created (create-story session): verified `requireRole` doesn't exist, `tools-routes.js:19` blankets requireAdmin → both epic ACs fail today; story ready-for-dev. Its complete.yaml halt declared **correct by design** (override documented above). Correction: commit 0b9b64531 contained ONLY the tools/ deletion — the Dockerfile image-wiring fix was never in it (silent git add failure). Actually landed now as a verified follow-up commit. |
| 2026-08-31 (2) | Decisions recorded: D1 executed (chatqna image wiring fixed — COPY workflows/ + explicit requests/httpx; orphaned tools/ deleted; 48 tests green), D2 hold MR until BMAD stories done then merge-commit, D3 defer remaining triggers, D5 defer Flutter, D6 proper BMAD. D4 explained (AGPL) — awaiting sign-off owner. Real MR size corrected: 50 files +6,844/−96 (earlier 167-file figure was measured against a stale local main). |
| 2026-08-31 | Audited feat/sst vs tracker; re-baselined sprint-status.yaml (17 review / 5 in-progress / 12 backlog); found orphaned `tools/` dupe (D1); created this plan; MR !279 pipeline confirmed green. |
