# Story 3.7: Session Data Automatic Purging

Status: ready-for-dev

## Story

As a system,
I want session data to be automatically purged when it exceeds the session lifetime,
so that no manual cleanup is required and stale sessions do not consume resources.

## Acceptance Criteria

1. **Given** the application is running
   **When** a session exceeds its configured lifetime
   **Then** the session data is automatically purged — no residual data persists (FR35, NFR14)
2. **And** session lifetime is configurable via `SESSION_EXPIRATION_TIME` environment variable (in milliseconds, default 1800000 = 30 minutes), which the operator should align with Keycloak realm settings (access token lifespan, SSO session max)
3. **And** the purge happens without manual intervention or cron jobs

## Tasks / Subtasks

- [ ] **Task 1: Fix `getActiveSession()` expiration bug and add database index** (AC: #1)
  - [ ] Fix pre-existing bug: `getActiveSession()` (line 109) checks `currentTime - sessionStartTime` but ignores `lastActiveTime` — meanwhile `keepSessionAlive()` updates `lastActiveTime` and `cleanupExpiredSessions()` correctly uses it. Align `getActiveSession()` to use `lastActiveTime` (or max of `startTime`, `lastActiveTime`)
  - [ ] Add persistent ArangoDB index on `[active, startTime]` to the sessions collection — current query in `cleanupExpiredSessions()` does full collection scan on unindexed fields
  - [ ] Fix schema mismatch: existing index is on `[userId, createdAt]` but session documents use `startTime`, not `createdAt` — the existing index is unused dead weight
  - [ ] Verify `user-profile-service.js` (consumer of `sessionService.getUserSessions()`) compatibility with any session behavior changes

- [ ] **Task 2: Wire up existing `cleanupExpiredSessions()` method** (AC: #1, #3)
  - [ ] `cleanupExpiredSessions()` already exists at line 264 of `session-service.js` — it queries for expired sessions using `lastActiveTime` and ends each via `endSession()`
  - [ ] This method is currently dead code (never called anywhere in the codebase) — the task is to **wire it up**, not create it from scratch
  - [ ] Call `cleanupExpiredSessions()` from appropriate entry points: on server startup, or lazily on session access (e.g., at the start of `getOrCreateSession()`)
  - [ ] Ensure no background jobs or cron schedules — wire into existing request flow only (AC #3)
  - [ ] Handle `sessionQueries` edge collection: when a session document is deleted (not just marked inactive), orphaned `sessionQueries` edges remain — add edge cleanup in purge flow
  - [ ] Consider impact on `getSessionStats()` (line 298) which queries all sessions for analytics — document whether purging should delete permanently or mark inactive (deletion breaks analytics)

- [ ] **Task 3: Document session lifetime configuration** (AC: #2)
  - [ ] Add prominent documentation that `SESSION_EXPIRATION_TIME` is in **milliseconds** (default 1800000 = 30 min, NOT 30)
  - [ ] Document recommended alignment with Keycloak realm settings: set `SESSION_EXPIRATION_TIME` to match Keycloak's SSO session max or access token lifespan + buffer
  - [ ] Add env var documentation in `.env` template and `services/README.md`

- [ ] **Task 4: Backend tests for session purging** (AC: #1, #3)
  - [ ] Add test: `cleanupExpiredSessions()` marks expired sessions as inactive
  - [ ] Add test: `getActiveSession()` returns null after session exceeds lifetime (with `lastActiveTime`)
  - [ ] Add test: active sessions are NOT purged
  - [ ] Add test: `cleanupExpiredSessions()` cleans up `sessionQueries` edges
  - [ ] Add test: `SESSION_EXPIRATION_TIME` respects millisecond configuration
  - [ ] Add test: purge does not affect `getSessionStats()` for non-expired sessions (or document if it does)
  - [ ] **Note**: Existing test files that mock session-service (`authController.test.js`, `swagger-config.test.js`, `token-passthrough-integration.test.js`) may need mock updates if purge behavior changes

- [ ] **Task 5: Verify `session-routes.js` compatibility** (AC: #1)
  - [ ] Review `components/gov-chat-backend/routes/session-routes.js` for any session query endpoints affected by purge changes
  - [ ] Ensure route handlers don't break when sessions are purged

## Dev Notes

### What Already Exists (no changes needed)

- **Session service exists**: `components/gov-chat-backend/services/session-service.js` with `SESSION_EXPIRATION_TIME` config (default 1800000ms = 30 minutes)
- **`cleanupExpiredSessions()` method**: Already implemented at line 264 — queries expired sessions by `lastActiveTime`, ends each via `endSession()`. Currently dead code (never called anywhere).
- **`endSession()` method**: Sets `active: false` and `endTime` when session ends
- **`keepSessionAlive()` method**: Updates `lastActiveTime` to keep session alive (line 198)
- **`getSessionStats()` method**: Queries all sessions for analytics — purging by deletion would break historical analytics
- **Logout integration**: Story 3.1 already calls `sessionService.endSession()` on logout
- **Session edges**: `userSessions` edge collection links users to sessions; `sessionQueries` edge collection links sessions to queries
- **`user-profile-service.js`**: Consumer of `sessionService.getUserSessions()` and `sessionService.endSession()` (lines 835-852) — must remain compatible

### What Needs to Change (gaps identified)

#### Gap 1: `cleanupExpiredSessions()` is dead code — needs to be wired up
**File**: `components/gov-chat-backend/services/session-service.js`

**Current state**: `cleanupExpiredSessions()` exists and works correctly (uses `lastActiveTime`), but is never called. Expired sessions accumulate in the database until someone explicitly queries them.

**Problem**: Violates FR35 (no residual data) and NFR14. Database grows with stale session records. AC #3 requires no cron jobs.

**Solution**: Wire `cleanupExpiredSessions()` into existing request flow — call at the start of `getOrCreateSession()` or on server startup. This ensures cleanup happens lazily during normal operations without background jobs.

#### Gap 2: Pre-existing bug — `getActiveSession()` ignores `lastActiveTime`
**File**: `components/gov-chat-backend/services/session-service.js`, line 109

**Current state**: `getActiveSession()` checks `currentTime - sessionStartTime > sessionExpirationTime` but ignores `lastActiveTime`. Meanwhile, `keepSessionAlive()` updates `lastActiveTime`. This means a user who keeps their session alive via keepalive will have their session expire incorrectly when `getActiveSession()` is called.

**Solution**: Align `getActiveSession()` expiration logic with `cleanupExpiredSessions()` — use `lastActiveTime` (or `max(startTime, lastActiveTime)`) for expiration check.

#### Gap 3: No database index on `startTime` — performance concern
**File**: ArangoDB `sessions` collection

**Current state**: Only index is `[userId, createdAt]` (which is mismatched — see Gap 4). The `cleanupExpiredSessions()` method filters on `session.active == true` and `session.startTime < expirationTime` — both unindexed. Full collection scan on every purge.

**Solution**: Add persistent index `[active, startTime]` to sessions collection. This can be done in application startup code or via ArangoDB migration script.

#### Gap 4: Schema mismatch — existing index uses `createdAt` but documents use `startTime`
**File**: ArangoDB schema and `session-service.js`

**Current state**: Schema index is on `[userId, createdAt]` but `createSession()` stores `startTime` (not `createdAt`). The existing index is unused dead weight.

**Solution**: Remove unused `[userId, createdAt]` index. Add `[active, startTime]` index (see Gap 3).

#### Gap 5: `sessionQueries` edge collection not cleaned up on purge
**File**: `components/gov-chat-backend/services/session-service.js`, edge collection

**Current state**: Graph definition links sessions to queries via `sessionQueries` edges. When sessions are purged/deleted, orphaned edges remain in the database.

**Solution**: In purge flow, delete associated `sessionQueries` edges before deleting session document. Or: use ArangoDB edge collection with `synchronize` option.

#### Gap 6: `getSessionStats()` conflict with purging
**File**: `components/gov-chat-backend/services/session-service.js`, line 298

**Current state**: `getSessionStats()` queries all sessions including expired ones for analytics dashboards. If sessions are permanently deleted, historical analytics lose data.

**Solution**: Decision needed — should purging delete permanently or mark inactive? Permanent deletion breaks analytics. Marking inactive preserves analytics but doesn't fully purge (stale data persists). Recommend: mark inactive + periodic full delete of very old inactive sessions (e.g., older than 7 days).

### Architecture Constraints

- **FR35**: Session data must not persist beyond session lifetime
- **NFR14**: No residual session data after session ends
- **NFR3**: Access tokens stored in browser memory only — NEVER in localStorage, sessionStorage, or cookies
- **Options API only** — never use Composition API or `<script setup>`
- **CommonJS only** in backend — `require()`/`module.exports`, never ES imports
- **ES module imports** in frontend — `import`/`export` with `@/` alias
- **Per-route auth middleware** — never apply auth middleware globally
- **Error format**: `{ error: "ERROR_CODE", message: "description", details: {} }`
- **Audit log format**: `{ event, timestamp, userId: "iss#sub", issuer }`
- **AC #3**: No cron jobs or manual intervention for purging
- **ArangoDB edition**: Community Edition 3.12.4 — TTL indexes NOT available (Enterprise-only feature)
- **`SESSION_EXPIRATION_TIME`**: Environment variable in **milliseconds** (default 1800000 = 30 minutes). NOT minutes, NOT seconds.

### Key Files to Modify

| File | Change |
|------|--------|
| `components/gov-chat-backend/services/session-service.js` | Wire up `cleanupExpiredSessions()`, fix `getActiveSession()` bug, add index creation, handle edge cleanup |
| `components/gov-chat-backend/routes/session-routes.js` | Review for compatibility with purge changes |
| `components/gov-chat-backend/services/user-profile-service.js` | Verify compatibility (consumer of session service) |
| `components/gov-chat-backend/__tests__/session-service.test.js` | Add tests for purging, expiration, index |
| `components/gov-chat-backend/scripts/` | Add index creation script or startup migration (if needed) |
| `_bmad-output/implementation-artifacts/3-7-session-data-automatic-purging.md` | Document strategy and decisions |

### Files to Check (may need mock updates)

| File | Reason |
|------|--------|
| `components/gov-chat-backend/__tests__/authController.test.js` | Mocks session-service — may need updates |
| `components/gov-chat-backend/__tests__/swagger-config.test.js` | Mocks session-service — may need updates |
| `components/gov-chat-backend/__tests__/token-passthrough-integration.test.js` | Mocks session-service — may need updates |

### Testing Standards

- **Backend**: Jest, CommonJS mode, mock ArangoDB and session service
- **Test location**: `__tests__/` (backend)
- **Coverage**: Verify purge mechanism, expiration logic, edge cleanup, index usage
- **Mock user factory**: Follow existing test patterns from `keycloakAuthService.test.js`

### Session Architecture Context

- **No server-side authentication session store** — JWT validation via JWKS (stateless)
- **ArangoDB `sessions` collection** — Application-level **analytics sessions**, NOT authentication sessions. Purging has no security implications — purely data hygiene.
- **Session schema fields**: `userId`, `startTime`, `active`, `endTime`, `deviceInfo`, `ipAddress`, `lastActiveTime`
- **Session lifetime**: Configurable via `SESSION_EXPIRATION_TIME` env var (default 1800000ms = 30 minutes)
- **Session flow**: User login → session created → activity tracked via `keepSessionAlive()` → session expires on timeout or logout
- **Graph relationships**: `userSessions` edges (users↔sessions), `sessionQueries` edges (sessions↔queries)
- **Known limitation from Story 3.1**: Logout calls `sessionService.endSession()` but this is per-logout, not automatic purging of all expired sessions
- **Analytics consideration**: `getSessionStats()` uses session data for dashboards — permanent deletion breaks historical analytics

### Project Structure Notes

- Backend files at `components/gov-chat-backend/` root (no `src/` subdirectory)
- Tests: backend in `__tests__/`
- Worktree: `epic3-sessions` (branch `feature/ep3-sessions`)
- This story depends on Story 3.1 (logout) which is complete
- ArangoDB edition: Community Edition 3.12.4 (TTL indexes NOT available)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.7] — AC and FR35, NFR14 references
- [Source: _bmad-output/planning-artifacts/architecture.md] — Session & Token Management (FR12-FR17), NFR18 (session auto-purge)
- [Source: components/gov-chat-backend/services/session-service.js] — Current session implementation (lines 264: `cleanupExpiredSessions()`, 198: `keepSessionAlive()`, 298: `getSessionStats()`)
- [Source: components/gov-chat-backend/services/user-profile-service.js] — Session service consumer (lines 835-852)
- [Source: components/gov-chat-backend/routes/session-routes.js] — Session route endpoints
- [Source: _bmad-output/implementation-artifacts/3-1-user-logout-and-session-termination-across-application.md] — Logout integration (prerequisite)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
