---
baseline_commit: c9750800f
---

# Story 4.7: Health overview

Status: review

## Story

As a tools-admin,
I want a green/yellow/red health status per tool and per feed with error summaries,
so that I can see at a glance whether SearXNG or a feed is degraded without leaving the admin surface (FR33, FR45, NFR15).

## Current State (verified on `feat/sst` 2026-09-05, post-4-6 `c9750800f`)

- **Per-tool health**: the Epic-1 circuit breaker state lives in Redis under `cb:{tool_name}:state` (`redis_primitives.py:44-57`: `closed`/`open`/`half_open`) — **but nothing writes those keys yet** (governance is unwired, NFR11 backlog). A missing key = breaker never tripped = healthy-by-default. The BFF reading `cb:web_search:state` via GET is cheap and becomes truthful the moment governance wiring lands.
- **SearXNG reachability (the epic AC's "a stopped SearXNG shows red for web search")**: the backend already talks to SearXNG in `/test-search` (`tools-routes.js:82`, `GET {SEARXNG_URL}/search?q=...&format=json`). A lightweight probe (`GET {SEARXNG_URL}/health` or a 1-result search) can be checked live per overview request.
- **Per-feed health**: the `feeds` collection already carries `enabled`, `failures` (consecutive failure count), `last_polled` (epoch) — written by the ingestor (3-3). Green/yellow/red can be DERIVED: enabled+failures=0 → green; failures>0 → yellow (with the count); disabled → grey/red per epic wording (FR45: per-feed health with error summaries). `last_polled` staleness is display data, not a status input (poll intervals are per-feed and unknown to the BFF).
- **BFF Redis access exists** (4-6's `_auditRedis()` — ioredis, fail-fast) and ArangoDB feeds access (`getFeeds()`).
- AdminToolsView has four tabs; the Audit tab's table/filter/pattern and the i18n infra are the templates.

## Acceptance Criteria

1. **BFF**: `GET /api/admin/tools/health` (readGuard) returns:
   ```
   { success, data: {
       tools: [{ tool_id: "web_search", circuit_state: "closed|open|half_open|unknown",
                 reachable: true|false|null, error: string|null }],
       feeds: [{ id, title, enabled, failures, last_polled, status: "green|yellow|red" }]
   } }
   ```
   - `tools[]`: one row per known tool (web_search; the list grows with governance wiring). `circuit_state` = Redis GET `cb:{tool_id}:state` (missing → `"closed"` — never-tripped is healthy-by-default; use `"unknown"` only if Redis itself errors). `reachable` = live SearXNG probe result (true/false; `null` when the probe is skipped/disabled). `error` = probe/breaker error summary.
2. **SearXNG probe**: server-side `GET {SEARXNG_URL}/search?q=health&format=json` with a **2s timeout**; 200 → reachable; any failure → unreachable + the error string. Never throws to the caller — a failed probe is data, not an error response.
3. **Feed status derivation** (documented in code): `!enabled` → `red`; `failures === 0` → `green`; `failures >= 3` → `red`; else `yellow` (NFR15: one feed failing doesn't affect others — statuses are computed per-feed, no shared state).
4. **UI**: a Health tab in AdminToolsView — Tools section (name, circuit badge, reachable badge, error summary) + Feeds section (title, status badge, failures, last-polled time, enabled). Refresh button; auto-load on tab switch (mirror the Audit tab's lazy-load pattern). Read-only.
5. All strings `admin.tools.health*` ×14 locales (template-vs-file parity; `format:check` green); status colors via DsStatusTag variants (success/warning/danger) — DS tokens, no hardcoded colors.
6. **Tests**: BFF (SearXNG 200 → reachable true; SearXNG down → reachable false + error string, route still 200; breaker key present → state surfaced; missing key → closed; feed status derivation for each threshold; plain-user 403); frontend (tab renders, badges wire to statuses, refresh dispatches); locale gate; all suites + lint/format clean.

## Tasks / Subtasks

- [x] Task 1 — BFF health service (AC: 1, 2, 3)
  - [x] `tools-service.js`: `getToolsHealth()` — probe SearXNG (httpx equivalent: the backend uses native `fetch` in tools-routes; use `fetch` with AbortSignal.timeout(2000) in the service or route — follow the test-search precedent), read `cb:web_search:state` via the 4-6 Redis client (GET, missing → closed, Redis error → "unknown"), read feeds via the existing `getFeeds()`, derive per-feed status
  - [x] Cache the SearXNG probe result for ~30s in-memory (the overview may be refreshed often; a probe per request per user is wasteful — timestamp+result in a module variable)
- [x] Task 2 — Route (AC: 1) + swagger
- [x] Task 3 — UI Health tab (AC: 4) + i18n ×14 (AC: 5)
- [x] Task 4 — Tests (AC: 6) + suites + trackers

## Dev Notes

- **The epic AC is testable today** (a stopped SearXNG → red for web search): the probe does not depend on governance wiring. The breaker state is future-truthful (healthy default until the pipeline writes keys) — document both in the story record.
- SearXNG probe path: the searxng container serves `/health` per 1-6's healthcheck pattern — but that was for presidio. SearXNG's own healthcheck in compose uses `curl -f http://localhost:8080/` (root). **Probe `{SEARXNG_URL}/`** (root, 200 = up) — matches the deployed healthcheck's assumption. Search endpoint would also work but costs engine queries.
- `getFeeds()` already exists — reuse; do not add a second feed-read path.
- The `tools[]` list: hardcode `["web_search"]` with a comment (the tool registry arrives with governance wiring); keep the shape extensible.
- Frontend: DsStatusTag variants map directly (green→success, yellow→warning, red→danger, grey/disabled→pending); table idioms from the Audit tab; `translate()` per-component.

### Testing standards

- Backend: mock `fetch` for the probe (200/500/timeout); mock the Redis GET (key present/missing/error); use the existing tools-routes composed-app harness; feed rows via `toolsService.getFeeds` mock.
- Frontend: mirror the Audit-tab tests (render, dispatch, badge mapping).

### References

- [Source: epics.md#Story-4.7] — "Green/yellow/red per tool and per feed with error summaries, from the Epic 1 breaker state and Epic 3 per-feed health"; AC "a stopped SearXNG shows red for web search and leaves feeds green"
- [Source: redis_primitives.py:44-57, 29-34] — breaker key layout + CircuitState values
- [Source: tools-service.js getFeeds] — failures/last_polled/enabled per feed
- [Source: docker-compose.yaml searxng healthcheck] — root-path probe precedent
- [Source: AdminToolsView Audit tab (4-6)] — lazy-load + table + i18n patterns
- [Source: PRD FR33/FR45/NFR15] — health overview, per-feed health + error summaries, isolation


### Review Findings

_Code review 2026-09-05 — Blind Hunter complete (1 High / 7 Med / 6 Low); single-layer review per the established pattern. All substantive findings patched and amended into the commit._

- [x] [Review][Patch] **HIGH — `deriveFeedStatus` received the raw doc while the row displayed the normalized `enabled`** — a feed with no `enabled` field showed `enabled: true` + `status: red` in one row. FIXED: normalize once, derive from the normalized value.
- [x] [Review][Patch] **MED — disabled feeds rendered red/danger** — admin-intentional off was a permanent false alarm. FIXED: `deriveFeedStatus` returns `'disabled'`; UI maps it to the neutral `pending` variant (grey).
- [x] [Review][Patch] **MED — `circuitVariant` failed OPEN** — any unrecognized state string rendered green. FIXED: fail-CLOSED (only exact `'closed'` is green; unknown = warning/investigate + test pinning `'OPEN'` → warning).
- [x] [Review][Patch] **MED — Refresh couldn't bypass the 30s probe cache** — FIXED: `?refresh=1` route param → `bustProbeCache()`; the UI Refresh button sends it.
- [x] [Review][Patch] **MED — raw `err.message` leaked internal topology** (Redis host:port to the browser; Node fetch's useless "fetch failed" hiding the real cause) — FIXED: Redis errors say "Breaker state unavailable (Redis)"; SearXNG probe surfaces `err.cause.code` (the actual DNS/refused reason).
- [x] [Review][Patch] **MED — `getFeeds()` rejection 500'd the whole endpoint** — feeds-read failure now degrades to `feeds_error` on a 200 (tools section survives; banner shown).
- [x] [Review][Patch] **MED — Arabic mojibake** — `'آlass استقصاء'` (Latin "lass" glued into Arabic) → `'آخر استقصاء'`.
- [x] [Review][Patch] **MED — nav click vs watcher/`formatAuditTime` reuse** — verified the watcher exists and `formatAuditTime` is epoch-seconds (unit-consistent with `last_polled`); both findings were misreadings, dismissed without change.
- [x] [Review][Patch] **LOW bundle** — probe cache keyed per tool (poisoning trap for the next tool); 429/403 from SearXNG count as UP (limiter ≠ outage); tests now restore `global.fetch`/cache state; test expectation for `unknown` updated to the fail-closed warning.
- [x] [Review][Dismiss] Cumulative `failures` counter without reset — the counter is the ingestor's (3-3) data; the health view reports it faithfully. Reset semantics belong to the ingestor story that owns the counter.
- [x] [Review][Dismiss] Refresh button still shows during validation — cosmetic; no click-path bug.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Dev: backend 1700 / frontend 1268 / overlay 804 green
- Review patches: feeds-read failure guard, refresh cache-bust, probe cause surfacing, per-tool cache, disabled state, fail-closed badges, Arabic fix; final: backend **1705** / frontend **1268**, ruff/ESLint/Prettier clean
- Two heredoc patch assertions failed against prettier-formatted text (recurring) — recovered via Edit tool each time

### Completion Notes List

- `GET /api/admin/tools/health` (readGuard): per-tool rows (circuit state from `cb:{tool}:state`, missing = healthy default; live SearXNG probe with 30s cache + `?refresh=1` bust; cause-aware error strings that never leak internal topology) + per-feed rows with derived status
- Feed status: `disabled` (grey, intentional) / `green` (0 failures) / `yellow` (1–2) / `red` (≥3) — NFR15 per-feed isolation
- Epic AC testable today: a stopped SearXNG shows red for web search (probe is live now); feeds stay green (per-feed isolation); breaker keys become truthful when governance wiring lands (NFR11 backlog)
- 18 keys ×14 locales; 5 backend tests + 2 frontend tests for this story

### File List

- components/gov-chat-backend/services/tools-service.js (getToolsHealth, probe+cache, deriveFeedStatus)
- components/gov-chat-backend/routes/tools-routes.js (GET /health + refresh param)
- components/gov-chat-backend/__tests__/routes/tools-routes.test.js (+5 tests)
- components/gov-chat-frontend/src/views/AdminToolsView.vue (Health tab), store/modules/tools.js (fetchHealth), src/__tests__/views/AdminToolsView.test.js (+2 tests)
- components/gov-chat-frontend/src/i18n/locales/*.js (18 keys ×14)
- _bmad-output/implementation-artifacts/{4-7 story, sprint-status, plan.md}

### Change Log

- 2026-09-05: Health overview (SearXNG live probe + breaker state + feed derivation); review patches (normalization, disabled state, fail-closed badges, cache bust, error hygiene, Arabic mojibake); 1705/1268/804 green → status review## Debug Log References

### Completion Notes List

### File List

### Change Log
