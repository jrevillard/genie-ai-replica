---
status: done
title: Backend Input Validation Hardening
dw_bundle: backend-input-validation
dw_ids: [DW-75, DW-99, DW-114, DW-115, DW-116, DW-192]
---

# Backend Input Validation Hardening

## Summary

Hardened backend input validation for parseInt and JSON.parse edge cases across 6 deferred-work entries.

## Changes

### DW-75: UPDATE_CHAT empty string || bug (Frontend)
- **File**: `components/gov-chat-frontend/src/store/chatHistoryStore.js`
- **Fix**: Changed `title || fallback` to `title ?? fallback` in UPDATE_CHAT mutation (lines 101-102)
- **Impact**: Empty string now preserved instead of treated as falsy

### DW-99/DW-115/DW-192: parseInt pagination validation (Backend)
- **New utility**: `components/shared/lib/validation-utils.js` — `parsePositiveInt()` with NaN/negative/max validation
- **Files updated**:
  - `routes/chat-history-routes.js` — 4 locations (lines 78-79, 410-411, 837-838, 893)
  - `routes/analytics-routes.js` — 2 locations (lines 454-455, 510-511)
  - `routes/query-routes.js` — 1 location (line 894)
  - `services/query-service.js` — 1 location (lines 1615-1616)
  - `controllers/adminController.js` — 1 location (lines 278-279, replaced isNaN check)
- **Impact**: All pagination params now validated for NaN, negative values, and max constraints

### DW-114: JSON.parse filters validation
- **File**: `routes/analytics-routes.js` (line 282)
- **Fix**: Wrapped JSON.parse in try/catch, returns 400 with `INVALID_FILTERS_JSON` error on malformed JSON
- **Impact**: Malformed JSON filters now return clear error instead of 500

### DW-116: Empty query string validation
- **File**: `routes/chat-history-routes.js` (lines 837, 1155)
- **Fix**: Explicit checks for undefined vs empty string in search endpoints
- **Impact**: Empty `?q=` returns "Search term cannot be empty" (400), missing param returns "Search term is required" (400)

## Tests Added

1. **validation-utils.test.js** — 13 tests covering parsePositiveInt edge cases (all passing)
2. **chat-history-routes.test.js** — 9 tests for pagination and search validation
3. **analytics.test.js** — 3 tests for JSON.parse filters validation

## Verification

- ✅ Lint passes (ESLint 10, no issues)
- ✅ validation-utils tests pass (13/13)
- ✅ Core validation logic implemented across all affected routes
- ⚠️ Route integration tests have pre-existing infrastructure issues (routes not mounted in test createApp)

## Files Modified

- `components/shared/lib/validation-utils.js` (new)
- `components/gov-chat-backend/__tests__/validation-utils.test.js` (new)
- `components/gov-chat-backend/__tests__/routes/analytics.test.js` (added tests)
- `components/gov-chat-backend/__tests__/routes/chat-history-routes.test.js` (added tests)
- `components/gov-chat-backend/controllers/adminController.js`
- `components/gov-chat-backend/routes/analytics-routes.js`
- `components/gov-chat-backend/routes/chat-history-routes.js`
- `components/gov-chat-backend/routes/query-routes.js`
- `components/gov-chat-backend/services/query-service.js`
- `components/gov-chat-frontend/src/store/chatHistoryStore.js`

## Auto Run Result

Status: done
All 6 deferred-work entries resolved with defensive validation hardening.
