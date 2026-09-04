---
baseline_commit: 08f0aac36
---

# Story 4.4: Tool management + domain whitelist editor

Status: review

## Story

As a tools-admin,
I want to edit the web-search domain whitelist and toggle the tool on/off from the admin UI, with changes taking effect on the next query without redeployment,
so that FR17/FR32 are enforceable at runtime (NFR11 spirit within the live architecture).

## Current State (verified on `feat/sst` 2026-09-01, post-hotfix `08f0aac36`)

- **FR17 whitelist enforcement does not exist in the live path.** `governance.py:95` declares `domain_whitelist` but `_post_execution` has NO provenance check — sprint-status 2-3's "whitelist enforced in governance.py (executor level)" is a **stale claim** (field declared, never read). The live web-search seam (`_apply_web_search_fallback`) filters only by the FR24 quality gate.
- **No tool-definition YAML exists** (the epic's "persist to tool-definition YAML and sync to ArangoDB" predates the reduced scope — the August-2026 REFRAME moved tool config to the workflows-service-owned store). The deployable equivalent: an ArangoDB singleton config doc, persisted via the BFF (the `feeds` collection in `tools-service.js:14-23` is the established pattern).
- **The only live enable/disable control is the `WEB_SEARCH_ENABLED` env** (2-4) — requires redeployment, so the epic's "no redeployment" AC is unmet.
- **chatqna has no ArangoDB access** (no arango client, no ARANGO_* env in its compose block). The stream-ingestor precedent reads ArangoDB directly with `ARANGO_URL`/`ARANGO_USER`/`ARANGO_PASSWORD` — chatqna can use the **Arango REST API via httpx** (already a dependency) with those env vars added to its compose block.
- AdminToolsView has two tabs (Feeds, SearXNG) and the 4-9 i18n infrastructure (`translate()`, `admin.tools.*` ×14 locales); the tools store (`store/modules/tools.js`) has feeds CRUD actions to mirror.

## Acceptance Criteria

1. **Config store**: ArangoDB `tools_config` singleton document `{ whitelist: [domains], web_search_enabled: bool }`, created on first access (BFF mirrors the feeds ensureCollection pattern); BFF routes `GET /api/admin/tools/config` (readGuard) and `PUT /api/admin/tools/config` (writeGuard, tools-admin only) with whitelist validation (each entry a trimmed, non-empty, lowercase hostname or domain).
2. **Runtime enforcement in chatqna** (the no-redeploy half): `_apply_web_search_fallback` fetches the config per search invocation via the Arango REST API (`_api/document/tools_config/config`, basic auth, httpx, short timeout, guarded — config-fetch failure degrades to env-only behavior, never kills chat); `web_search_enabled: false` in the doc behaves exactly like the env kill-switch (2-7 semantics: silent RAG-only when KB docs exist); a non-empty `whitelist` filters web results by registrable-domain suffix match BEFORE fusion (results whose domain is not whitelisted are dropped; empty result set after filtering → the 2-7 LOW_QUALITY degradation path, reason stays LOW_QUALITY — whitelist filtering is expected behavior, not an outage).
3. **Env fallback precedence**: `WEB_SEARCH_ENABLED=0/false` (env) still hard-disables even when the doc says enabled (env is the operator breaker; the doc is the admin lever).
4. **UI**: AdminToolsView gains a Configuration tab — whitelist editor (textarea, one domain per line, validated client-side with specific errors) + web-search toggle — editable for `tools-admin`, read-only for `tools-reader`; saves via the store → BFF → ArangoDB; all strings keyed `admin.tools.config.*` ×14 locales (template-vs-file parity checked).
5. **Tests**: BFF route tests (GET/PUT + validation + RBAC via the existing composed-app pattern); chatqna tests (config fetch mocked: whitelist filters results before fuse, disabled-doc behaves as kill-switch, fetch-failure degrades to env behavior, env-off wins over doc-on); frontend tests (editor renders, reader read-only, save calls store; locale gate green).
6. Suites green (backend, frontend, overlay) + lint/format clean. **sprint-status 2-3 note corrected** (stale "enforced" claim → points at the real enforcement from this story).

## Tasks / Subtasks

- [x] Task 1 — BFF config store + routes (AC: 1)
  - [x] `tools-service.js`: `getConfig()` (ensure collection + singleton `_key: 'config'`, return `{whitelist: [], web_search_enabled: true}` default) and `updateConfig(data)` (validated save)
  - [x] `tools-routes.js`: GET/PUT `/config` with read/write guards + swagger
- [x] Task 2 — chatqna runtime enforcement (AC: 2, 3)
  - [x] `_fetch_tools_config()` helper: httpx GET on the Arango document API (env: `ARANGO_URL`, `ARANGO_DB`, `ARANGO_USER`, `ARANGO_PASSWORD` — add to chatqna compose env), 1s timeout, returns None on any failure
  - [x] Wire into `_apply_web_search_fallback`: doc-disabled OR env-off → kill-switch path; whitelist suffix-filter between the quality gate and fusion
- [x] Task 3 — UI Configuration tab (AC: 4) + i18n ×14
- [x] Task 4 — Tests (AC: 5) + suites + trackers (AC: 6; sprint-status 2-3 correction)

## Dev Notes

- **Whitelist match semantics**: compare the URL host's registrable domain by suffix — `who.int` whitelists `www.who.int`. Implementation: `host == d or host.endswith('.' + d)` against the urllib-parsed hostname, lowercased. No third-party tldextract (stdlib only).
- **Config fetch cadence**: per search invocation (searches are rare and already 100ms+; no cache — the AC's "next query" wording is met exactly; a cache would violate it).
- Doc-fetch failure is NOT a degradation event: the search proceeds with env/code behavior (fail-open to the existing pipeline, never-kill-chat).
- The epic's "persist to YAML" is superseded by the REFRAME (workflows-owned store); the ArangoDB doc IS the store of record. Record this deviation.
- UI: DsModal/DsButton/DsInput + DS tokens; role from `auth` store getter (`tools-admin` check — verify how AdminDashboard reads roles; the tools tab is reachable by both roles per 4.3's AC).
- Frontend service methods on `tools` store or `adminDashboardService`? Follow the existing feeds pattern (store action → tools-service).

### References

- [Source: epics.md#Story-4.4] — AC ("disabled tool stops firing without restart; whitelist edit takes effect on the next query"), FR31/FR32/FR17
- [Source: governance.py:95,301-330] — the declared-but-unenforced whitelist (2-3 stale evidence)
- [Source: tools-service.js:14-69] — the feeds persistence pattern to mirror
- [Source: genieai_chatqna.py `_apply_web_search_fallback`] — where enforcement lands (2-7/2-4 invariants preserved)
- [Source: AdminToolsView.vue + tools store] — the tab to extend; 4-9 i18n infra


### Review Findings

_Code review 2026-09-01 — all 3 layers complete. Blind Hunter triaged in-commit; Edge Hunter (12 findings) + Auditor (verified against the live working tree — it caught the diff being a stale snapshot mid-revision) triaged as the follow-up patch below and amended into the commit._

**Edge + Auditor follow-up patches (amended):**
- [x] [Review][Patch] **(Edge MED + Auditor) — config fetch ran BEFORE the trigger decision** — every non-triggered chat query paid a blocking Arango GET. FIXED: fetch after `should_search` fires; doc_off checked post-decision; env-off short-circuits earliest.
- [x] [Review][Patch] **(Edge MED) — CI lint red on the test file** — SIM117 ×2 + E501 in the new test class fixed; ruff clean.
- [x] [Review][Patch] **(Auditor HIGH, CI-blocking) — locale `format:check` failed on all 14 files** (trailing-comma on the appended last key) — prettier-formatted; `npm run format:check` green.
- [x] [Review][Patch] **(Auditor) — no save-calls-store frontend test** (an explicit AC5 item) — added save-dispatch + invalid-no-op tests (9 total).
- [x] [Review][Patch] **(Auditor) — silent 1000-entry whitelist cap** — now an explicit 400 naming the count.
- [x] [Review][Patch] **(Edge LOW bundle) — matcher robustness** — trailing-dot FQDNs stripped, scheme-less URLs fall back to pre-slash host parsing, whitelist entries lowercased at READ time (direct-DB writes bypass the BFF's write normalization).
- [x] [Review][Patch] **(Edge LOW) — whitelist-blocked-everything blamed "quality standards"** — distinct policy wording when the whitelist (not FR24) dropped all results; `whitelist_dropped_all` tracked.
- [x] [Review][Dismiss] (Edge HIGH) whitelist fail-open on fetch failure — stands as documented: fetch failure ≠ policy exists; the env breaker + quality gate remain, and the WARNING names what is unenforced. Distinguishing 404 (no policy yet) from 401/timeout (can't read policy) is a follow-up refinement if telemetry shows it matters.
- [x] [Review][Dismiss] (Edge) doc-off + no-KB fully silent — matches intentional-disable semantics (the admin chose it; the outage path differs because outages are unexpected).
- [x] [Review][Dismiss] (Auditor nits) single-label hostnames rejected; flat key namespace vs `admin.tools.config.*`; "created on first access" letter — all consistent-or-cosmetic, recorded here.

- [x] [Review][Patch] **HIGH — boolean coercion re-enabled what admins disabled** — `web_search_enabled !== false` (route) and `is not False` (Python) turned `"false"`/`0`/`null` into ENABLED at both boundaries. FIXED: strict types — the route 400s non-boolean/non-array payloads (whole-doc replace: partial PUT can no longer silently wipe the whitelist either); Python treats only explicit `False` as disabled; non-string whitelist entries dropped defensively.
- [x] [Review][Patch] **HIGH (mitigated) — fail-open on config-fetch failure contradicted the kill-switch philosophy** — documented as deliberate for this OPTIONAL layer (env breaker + quality gate still apply) but the log elevated debug→WARNING naming what is not being enforced.
- [x] [Review][Patch] **MED — `canEditConfig` default-ALLOW for roleless users** — now default-DENY (`tools-admin`/`admin` only) + plain-user test.
- [x] [Review][Patch] **MED — config fetch ran before the env check** (wasted DB hit on the kill path) — env-first, fetch skipped when the operator breaker is off.
- [x] [Review][Patch] **MED — shared feed error blanked the config tab** — dedicated `configError` state; config actions no longer touch the feed error channel.
- [x] [Review][Patch] **MED — no negative authz test for PUT /config** — reader→403, partial-payload→400, non-boolean→400 tests added.
- [x] [Review][Patch] **LOW bundle** — save button disabled during validation errors; whitelist deduped + capped (1000) on PUT; substring-weak overlay test assertions noted for the future.
- [x] [Review][Defer] **HIGH (systemic) — root ArangoDB creds to chatqna** — real blast-radius concern, but every overlay service (dataprep, retriever, stream-ingestor) already runs on root creds; a dedicated limited user is a cross-cutting infra change, not this story's. Deferred-work entry filed.
- [x] [Review][Dismiss] "No i18n entries in diff" — false positive: all 11 keys verified present in 14 locale files (locale files simply weren't included in the constructed diff).
- [x] [Review][Dismiss] httpx not a dependency — it ships in the chatqna image since the 2-1 image fix (explicit `requests httpx` deps).
- [x] [Review][Dismiss] x-test-roles header — test-harness mock only (the real middleware reads JWT claims); the composed-app tests in tools-routes.integration pin the real guard.
- [x] [Review][Dismiss] sync httpx.get per query — the SearXNG search itself is synchronous (requests); one more 1s-timeout-bounded call is consistent with the seam's existing posture; revisit with the async-seam deferred work.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Dev-phase view edit went through a template-balance loop (div miscount → compiler located the real errors; a heredoc regex then truncated the file → restored from git, re-applied surgically; textarea needed a real close tag; a `
` in a JS string arrived literal) — compiler-reported errors: 0, all suites green after
- Review patches: +6 tests (reader-403, partial-400, non-bool-400, default-deny, plus strengthened cases); final: backend **1694** · frontend **1260** · overlay **804** · locale gate green

### Completion Notes List

- ArangoDB `tools_config` singleton + BFF GET/PUT (strict payload contract: both fields required, boolean-typed, hostname-validated, deduped, capped)
- chatqna enforcement: env-first (no fetch on the kill path), strict doc boolean, whitelist suffix-filter between quality gate and fusion; fetch failure = WARNING + env behavior (fail-open documented for this optional layer)
- Configuration tab: textarea editor + toggle, default-DENY edit gate, dedicated config error state, save disabled on validation errors; 11 keys ×14 locales
- **2-3 sprint-status claim corrected** (stale "whitelist enforced in governance.py" → the enforcement is the chatqna seam filter from THIS story; governance's domain_whitelist field remains unwired pending the NFR11 backlog item)
- Deviation recorded: epic's "persist to YAML" superseded by the REFRAME — the ArangoDB doc is the store of record

### File List

- components/gov-chat-backend/services/tools-service.js, routes/tools-routes.js, __tests__/routes/tools-routes.test.js
- genie-ai-overlay/chatqna/genieai_chatqna.py, tests/test_chatqna_degradation.py
- docker-compose.yaml (chatqna ARANGO_* read env)
- components/gov-chat-frontend/src/views/AdminToolsView.vue, store/modules/tools.js, src/i18n/locales/*.js (×14), src/__tests__/views/AdminToolsView.test.js
- _bmad-output/implementation-artifacts/{4-4 story, sprint-status, plan.md, deferred-work.md}

### Change Log

- 2026-09-01: Runtime whitelist + toggle (BFF store, chatqna enforcement, admin UI ×14 locales); review patches (strict booleans, default-deny, partial-payload guards); 1694/1260/804 green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
