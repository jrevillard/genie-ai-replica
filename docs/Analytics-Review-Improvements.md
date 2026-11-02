# Analytics Feature — Review & Improvement Plan

**Date:** 2026-06-16  
**Status:** Review complete, improvements pending  
**Deployment:** `docker-compose-t4.yaml`

---

## Current Architecture

```
User (NavBar button) → UnifiedAnalytics.vue → analyticsService.js (frontend)
  → httpService.get('/api/analytics/...') → Nginx → Kong → Backend (port 3000)
    → analytics-routes.js → analyticsController.js → analytics-service.js → ArangoDB
```

### Key Files

| Layer | File |
|-------|------|
| Frontend button | `components/gov-chat-frontend/src/components/NavBarComponent.vue` |
| Frontend modal | `components/gov-chat-frontend/src/components/UnifiedAnalytics.vue` |
| Frontend service | `components/gov-chat-frontend/src/services/analyticsService.js` |
| Backend routes | `components/gov-chat-backend/routes/analytics-routes.js` |
| Backend controller | `components/gov-chat-backend/controllers/analyticsController.js` |
| Backend service | `components/gov-chat-backend/services/analytics-service.js` |
| Kong config | `api-gateway-solution/new-config/kong_config.json` (analytics-route) |
| Nginx proxy | `api-gateway-solution/nginx/conf/default.conf` (`/api/` → kong:8000) |

### Data Collections (ArangoDB)

- `analytics` — stores `type: 'query'` and `type: 'feedback'` records (written by `recordQuery` / `recordFeedback`)
- `queries` — the actual query documents (used by time series and satisfaction endpoints)
- `events` — user interaction events (tracked via `trackEvent`)

---

## Bug Fixed (2026-06-16)

**Parameter mismatch in satisfaction gauge and heatmap endpoints.**

The controller was passing `(startDate, endDate, locale)` to service methods that expect `(period, selectedDate, locale)`. The fix infers the `period` from date range duration and passes `endDate` as the anchor date.

File: `controllers/analyticsController.js` — methods `getSatisfactionGauge` and `getSatisfactionHeatmap`.

---

## Suggested Improvements

### Priority 1 — Reliability & Security

#### 1.1 Remove hardcoded fallback values
- **Problem:** The controller returns fake values (`2.8s`, `1000 queries`, `85%` satisfaction) when no data is found. The service generates fake sample data as fallback. This masks real issues and makes production debugging harder.
- **Fix:** Return `0` or `null` with a clear `"noData": true` flag. Let the frontend show an appropriate "No data available" state.
- **Files:** `analyticsController.js` (getMetric defaults), `analytics-service.js` (generateSampleDashboardData, generateSampleTimeSeriesData)

#### 1.2 Add backend role authorization
- **Problem:** The NavBar disables the analytics button for non-manager roles, but the API only requires authentication. Any authenticated user can call `/api/analytics/dashboard` directly via curl or dev tools.
- **Fix:** Add a role-check middleware to analytics routes that requires `manager`, `ai engineer`, or `admin` role.
- **Files:** `analytics-routes.js` (add middleware after `authMiddleware.authenticate`)

#### 1.3 Consolidate data source (queries vs analytics collections)
- **Problem:** `getTimeSeriesData` queries the `queries` collection, while `getDashboardAnalytics` queries the `analytics` collection. If `recordQuery()` fails silently, the dashboard numbers diverge from the time series chart.
- **Fix:** Either query `queries` directly everywhere (single source of truth) or ensure `analytics` is always in sync. A rebuild/resync mechanism would help.
- **Files:** `analytics-service.js`

---

### Priority 2 — Performance

#### 2.1 Cache expensive AQL queries with Redis
- **Problem:** `loadAnalytics()` in the frontend fires ~8-10 concurrent API calls. Each triggers complex AQL queries across the full `analytics`/`queries` collections. As data grows, this will saturate the DB.
- **Fix:** Use `redis-cache` (already in docker-compose) to cache analytics results with a 60-120s TTL. Cache key = `analytics:{endpoint}:{period}:{date}:{locale}`.
- **Files:** `analytics-service.js` (add cache layer around each method)

#### 2.2 Debounce frontend API calls
- **Problem:** Changing the period selector immediately calls `loadAnalytics()`. Rapid toggling creates redundant requests.
- **Fix:** Add a 300ms debounce to `loadAnalytics()` in `UnifiedAnalytics.vue`.
- **Files:** `UnifiedAnalytics.vue` (loadAnalytics method)

#### 2.3 Consider pre-aggregated analytics summaries
- **Problem:** Every dashboard load re-aggregates raw data. With thousands of queries, this becomes slow.
- **Fix:** Run a periodic job (cron or backend interval) that writes daily/weekly/monthly summaries to an `analytics_summaries` collection. Dashboard reads from summaries instead of scanning raw records.
- **Files:** New file `services/analytics-aggregation-service.js`, add to backend startup

---

### Priority 3 — API Design

#### 3.1 Pass `period` explicitly from frontend
- **Problem:** The controller currently infers period from date range duration (added in the bug fix). This introduces rounding ambiguity.
- **Fix:** The frontend already knows the period — pass it as a query parameter (`?period=monthly&startDate=...&endDate=...`). The service methods already accept it.
- **Files:** `analyticsService.js` (frontend — add `period` param to gauge/heatmap calls), `analyticsController.js` (read `req.query.period` directly)

#### 3.2 Unify API response structure
- **Problem:** Different endpoints return different shapes. `/dashboard` returns nested objects, `/metric/:metric` returns `{ metric, value }`, `/timeseries/:type` returns arrays. Makes error handling inconsistent.
- **Fix:** Wrap all responses in a standard envelope: `{ success: true, data: {...}, meta: { period, startDate, endDate } }`.
- **Files:** All analytics routes/controller methods

---

### Priority 4 — Code Quality

#### 4.1 Remove production console.log statements
- **Problem:** NavBar computed properties log user data on every render. UnifiedAnalytics logs theme debugging info. These leak sensitive data in production.
- **Fix:** Remove or gate behind `process.env.NODE_ENV === 'development'`.
- **Files:** `NavBarComponent.vue` (isAdmin, isManagerOrAbove computed), `UnifiedAnalytics.vue` (logComputedStyles, created hook)

#### 4.2 Add error boundaries per chart section
- **Problem:** If one API call fails (e.g., satisfaction gauge), the entire dashboard shows a single error message. Other sections that loaded successfully are hidden.
- **Fix:** Load each section independently with its own loading/error state. Show partial results when possible.
- **Files:** `UnifiedAnalytics.vue` (refactor loadAnalytics into independent section loaders)

#### 4.3 Decouple analytics recording from query pipeline
- **Problem:** `recordQuery()` is called synchronously during query processing. If ArangoDB is slow, it adds latency to user-facing responses.
- **Fix:** Fire-and-forget pattern or queue to Redis and process async via a worker.
- **Files:** `query-service.js` (recordQuery call), potentially new worker file

---

## Implementation Order (Recommended)

| Phase | Items | Effort |
|-------|-------|--------|
| Phase 1 | 1.1, 1.2, 4.1 | ~2-3 hours |
| Phase 2 | 3.1, 2.2, 4.2 | ~3-4 hours |
| Phase 3 | 2.1, 1.3 | ~4-6 hours |
| Phase 4 | 2.3, 3.2, 4.3 | ~6-8 hours |

---

## Notes

- No additional Docker service is needed for analytics — everything runs inside the existing `backend` container
- The `queries` and `analytics` collections in ArangoDB are the data backbone
- Redis (`redis-cache`) is available for caching but currently only used for translation caching
- Access control is enforced only at the UI layer (NavBar role check) — backend is open to any authenticated user
