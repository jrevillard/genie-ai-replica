# MR !388 Follow-ups — Triage & Action Plan

**Source**: MR !388 (`feat(agri): replace fake/stale external data APIs with free verified sources`) — squash-merged into `release/el-salvador` on 2026-09-21 before blockers were fixed.

**Purpose**: Track the 11 HIGH + 14 MEDIUM + 10 LOW items remaining after the 8 BLOCKER fixes landed (commits `4a99f3b3f` → `a7b9e75e5` on `release/el-salvador`). Pattern follows `cve-triage-2026q3.md`.

**Status legend**: `open` = not started · `in-progress` = work begun · `done` = merged · `wontfix` = consciously dropped

**Owner column** is intentionally `tbd` for every item — assign during sprint planning.

---

## ✅ Already fixed (8 BLOCKERS + HIGH-1) — for reference

| ID  | Commit    | Summary                                                              |
|-----|-----------|----------------------------------------------------------------------|
| B-1 | 4a99f3b3f | Delete `mobile/.../android/app/build.gradle.kts` (Gradle forbids both + debug-keystore vuln) |
| B-2 | 4a99f3b3f | (bundled with B-1; kts hardcoded `signingConfig = ...debug` for release) |
| B-3 | c961482d3 | Mobile i18n: backfill `market:` + `charts:` blocks in 12 non-en/es locales (English fallback per project policy) |
| B-4 | 1a2211352 | Web i18n: backfill 6 orphan chatbot keys across 14 locales with translations (no EN fallback) |
| B-5 | 1a2211352 | Rewrite `audit-agri-i18n.js` to loop all 14 locales; fix `analytics.error.loading` → `analytics.errors.loading` typo |
| B-6 | 3d249fbef + a7b9e75e5 | `AgriService` singleton zombie-proof: `_initPromise` mutex + clear instance on partial failure |
| B-7 | cc6cb2e94 | Scheduler atomic single-flight via `Map<adapterId, Promise>` (replaces Set + boolean TOCTOU) |
| B-8 | 6f5d34863 | Re-drop 11 dead vllm/embedding override lines in `itu_rtx_el_salvador/vars.yml` (regression of `f8b0ffa13`) |
| H-1 | 4e1407c41 | Correct false "AI prompts inject meta.coverage + caveats verbatim" claim in `agri/CLAUDE.md` + `agri/README.md`; envelope is UI-only today |

---

## 🔴 HIGH — 11 items remaining

| ID   | Area            | Item                                                                                                                          | Status |
|------|-----------------|-------------------------------------------------------------------------------------------------------------------------------|--------|
| H-2  | docs/agri       | `services/agri/AGENTS.md` is a 1-line stub (`CLAUDE.md` plain text, no link) — replace with `[CLAUDE.md](CLAUDE.md)` or delete + drop dead pointer | open |
| H-3  | tests           | `services/agri/cache.js` (3-tier Redis → Arango → seed) has **zero coverage**. Add `__tests__/services/agri/cache.test.js` with Redis hit/miss/TTL/seed-fallback cases | open |
| H-4  | tests           | `services/agri/scheduler.js` single-flight untested. Add `__tests__/services/agri/scheduler.test.js` proving two concurrent `runAdapter(id)` calls collapse to one upstream fetch | open |
| H-5  | tests           | 11/20 adapters untested (frankfurter, inaturalist, ornl-modis, wb-cpi, wfp-gtm, wfp-nic, all rss-*). Add fixture-based parse/normalize tests | open |
| H-6  | tests           | `genie-ai-overlay/chatqna/keycloak_token_validator.py` (KC_ALLOWED_CLIENT_IDS widening — defense-in-depth) has zero tests. Add pytest cases: valid/expired/wrong-azp/JWKS cache hit/refresh | open |
| H-7  | backend         | `/api/agri/*` has no `rateLimit` middleware (other routers do). Single auth'd user can DoS Arango during cold-start cache miss | open |
| H-8  | ops             | `agri_fetch_log` collection grows unbounded (~650 rows/day). Add TTL index (`expireAfter: 90d`) or periodic sweep | open |
| H-9  | backend         | GDELT `backoffUntil` is module-level (per-process), not distributed. Replica B keeps hammering after replica A's 429. Persist to Redis (NX + 2h expiry) | open |
| H-10 | ops             | `scripts/export-agri-seeds.js` writes to prod Arango with no `NODE_ENV` / `--confirm` guard. Typo from dev workstation can overwrite `agri_cache` live. Add guard + redact `ARANGO_PASSWORD` from error paths | open |
| H-11 | backend         | `AGRI_PREFETCH_ON_START=1` default in `env` Section 15 → backend `test:backend` triggers live upstream prefetch on first init. Default to `0` or set in `test:backend` CI job | open |
| H-12 | backend         | `frankfurter.js` adapter is dead — writes `FX:EUR:USD` daily, no endpoint surfaces it. Delete + drop registry row (per `feedback_no_dead_code`) | open |

---

## 🟡 MEDIUM — 14 items remaining

| ID   | Area          | Item                                                                                                                          | Status |
|------|---------------|-------------------------------------------------------------------------------------------------------------------------------|--------|
| M-1  | backend       | TOCTOU on scheduler single-flight propagates to inflight Promise map when Redis recovers mid-flight                                    | open |
| M-2  | backend       | `agricache.set()` overwrites during `rebuildAllEndpoints` if fresh build empty but Redis LKG good — race can serve "pending" after TTL | open |
| M-3  | backend       | `CSV parseCsvObjects` silently drops extra columns + rows shorter than header. `zip.extractEntry` doesn't bounds-check `dataStart + compressedSize` (zip64 unsafe). `inaturalist.js` URL-encodes `|` as `%7C` — iNaturalist multi-taxon needs raw `|` | open |
| M-4  | backend       | Hardcoded `"2023–2025"` gap caveat + `singleMarket('San Salvador')` in `agri-service.js:1014-1015` become stale when WFP-SLV backfills/reopens. Derive from actual data (`max(date) - min(date)` per series) | open |
| M-5  | backend       | `UNIT_FACTORS` table in `agri-service.js:986-998` incomplete (no QUINTAL→KG, KG→MT, inverses). Current category-ordering workaround fails if reordered | open |
| M-6  | frontend      | `agriApiService.js` + `agri_api_service.dart` bump `v1 → v2` cache schema silently; old LKG keys orphaned on upgrade. Add migration (`localStorage.removeItem('agri-lkg:v1:...')` / `prefs.remove(...)`) | open |
| M-7  | mobile        | CSV export button disappears in multi-series chart path (`market_price_chart.dart:388-410` wrapped in `if (!_hasFullSeries)`). Lift out + write union-of-dates layout | open |
| M-8  | mobile        | Late-flip locale does not re-fetch chart envelope (`market_price_chart.dart _onLanguageChange()`). Series names stale until reopen | open |
| M-9  | mobile        | `agri_caveat_banner.dart` renders raw caveat codes (REGIONAL_DATA) when mobile locales don't carry `mobile_charts.caveats.codes.*`. Add translations for 14 locales | open |
| M-10 | deploy        | `cloud_deploy/vars.yml` `gpu_node_host: 10.0.0.110` is the same GPU as el-salvador. Two swarm stacks on one GPU = vLLM port-444 contention | open |
| M-11 | deploy        | Stale header comments in `cloud_deploy/vars.yml:5` + `inventory/cloud_deploy.ini:3` still reference removed `ai.assembly.govstack.global` public DNS | open |
| M-12 | tests         | `agri-routes.test.js` uses `express() + createAgriRouter()` instead of project's `createApp({ services: { agriService } })` pattern (13/15 other route tests use createApp). Skips keycloak + rate-limit + helmet coverage | open |
| M-13 | frontend      | `MarketPriceChart.vue axisFor` produces `NaN`/`-Infinity` when unit group has all-null values. Guard with `Number.isFinite(minVal) && Number.isFinite(maxVal)` | open |
| M-14 | docs           | `services/agri/CLAUDE.md` (98 lines) + `README.md` (141 lines) overlap on "what is the harness" content | open |

---

## 🟢 LOW — 10 items remaining

| ID   | Area     | Item                                                                                                                          | Status |
|------|----------|-------------------------------------------------------------------------------------------------------------------------------|--------|
| L-1  | backend  | `docKey` uses SHA-1 (collision risk = overwrite only, no security issue). Switch to SHA-256                                              | open |
| L-2  | backend  | `registry.js` re-reads `fs.readdirSync` on every `enabledAdapters()` call. Memoize at module load                                          | open |
| L-3  | backend  | `_wfp-factory.js` exposes `commodities` option never used by any variant (`opts.commodities && !opts.commodities.includes(...)` short-circuits). Drop the option | open |
| L-4  | backend  | `buildEnvelope.meta.nextRefresh` documented but never set by any caller (dead parameter). Compute + set or drop from schema                | open |
| L-5  | frontend | `CACHE_SCHEMA_VERSION` is a string magic value in both `agriApiService.js:18` + `agri_api_service.dart:14`. Use shared const                  | open |
| L-6  | frontend | `agri-i18n.js` hard-codes Spanish-only `FULL_NAMES_ES`; fr/pt users see English series names + caveat labels. Add fr/pt dictionaries    | open |
| L-7  | frontend | `markers.strokeColors` not re-refreshed on theme change → flicker on dark-mode toggle                                            | open |
| L-8  | frontend | Audit script uses `new Function('module','exports', src)` — fragile if locale file uses ESM `import` or top-level `await`              | open |
| L-9  | deploy   | `inventory/cloud_deploy.ini` `[gpu_nodes]` intentionally empty — confusing for operators copy-pasting. Rename or add placeholder comment | open |
| L-10 | mobile   | `PestAlertChart.test.js` uses only `wrapper.vm.*` assertions (73 occurrences). Project rule `feedback_test_finders_use_keys` doesn't apply (no DOM finders) but tests are brittle to internal rename | open |

---

## Operational follow-up (separate from code)

**O-1** — `release/el-salvador` deployed stack (10.0.0.102) may have chunks ingested with `bge-base-en-v1.5` (768-dim) before the `f8b0ffa13` cleanup. With `all.yml:152` now defaulting to `bge-large-en-v1.5` (1024-dim) + the override removed in B-8, new queries will mismatch stored chunks → retriever returns `[]`. **Re-ingest required before production deploy** of the current `release/el-salvador` tip.

---

## Cluster grouping (for sprint planning)

Not hard-coded — only a suggestion to bundle related items into single PRs:

| Cluster         | Items                          | Suggested MR title                                  |
|-----------------|--------------------------------|-----------------------------------------------------|
| Tests: cache    | H-3                            | Add `services/agri/cache.js` test coverage          |
| Tests: scheduler| H-4                            | Add `services/agri/scheduler.js` single-flight tests |
| Tests: adapters | H-5                            | Add parse/normalize tests for 11 untested adapters  |
| Tests: auth     | H-6                            | Add tests for `keycloak_token_validator.py`        |
| Backend hardening | H-7, H-9, H-11              | Rate-limit + distributed GDELT backoff + safe prefetch defaults |
| Backend cleanup | H-12, L-2, L-3, L-4            | Remove dead frankfurter + memoize registry + drop unused options |
| Ops             | H-8, H-10                      | `agri_fetch_log` TTL + `export-agri-seeds.js` guard |
| Deploy          | M-10, M-11, L-9                | cloud_deploy GPU contention + stale comments        |
| i18n            | M-6, M-9, L-6                  | Cache schema migration + caveat codes + ag-i18n fr/pt |
| Mobile UI       | M-7, M-8, L-10                 | CSV export + locale refetch + PestAlertChart testid |
| Docs            | H-2, M-14, L-1                 | AGENTS.md stub + CLAUDE.md/README dedup + SHA-256 |

---

## Reviewer-cited low-impact items (informational)

These were raised by reviewers but don't represent functional defects. Listed for completeness; not blocking.

- **Reviewer note** (frontend-mobile): `axisFor` Y-axis formula in `MarketPriceChart.vue:315` is `Math.ceil((maxVal + range * 0.05) / 10) * 10` (5% of range), while the mobile equivalent `series_chart_core.dart:169` is `maxVal * 1.2` (20% of max) and FAQ claims 20%. Web and mobile render different chart vertical ranges from the same data. **Captured in M-13** (NaN/Infinity guard) but the divergence itself is a separate spec mismatch — not blocking.
- **Reviewer note** (backend): `agricache` Redis del on release failure path is fire-and-forget (`.catch(() => {})`). If Redis is down at release, the stale `agri:lock:<id>` key holds for the lock TTL — second replica waits up to `cadenceMs(adapter) + 10 min`. Captured in H-9 (distributed backoff fix) but not the lock cleanup specifically.

---

## How to use this doc

1. **Sprint planning**: pull HIGH items into the next sprint, sized by cluster.
2. **MR description template**: link to this doc when opening a fix MR (e.g., `Refs: docs/security/mr388-followups.md#h-3`).
3. **Status updates**: change `open` → `in-progress` → `done` when work lands. Add the commit SHA in the row.
4. **Operational handoff (O-1)**: hand to ops team for re-ingestion plan before next production deploy.

---

**Created**: 2026-09-21, after MR !388 BLOCKER fixes landed (commits `4a99f3b3f` → `a7b9e75e5`).
**Author**: Jerome Revillard.
**Reference**: `/tmp/mr388-final-review.md` (full review report with reasoning + evidence).