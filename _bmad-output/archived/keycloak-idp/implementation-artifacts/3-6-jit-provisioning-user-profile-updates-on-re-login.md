# Story 3.6: JIT Provisioning — User Profile Updates on Re-login

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a backend system,
I want to update the ArangoDB user profile when a returning user authenticates with changed attributes,
So that the local user record stays in sync with the identity provider.

## Acceptance Criteria

1. **AC1 — Profile fields updated on re-login:**
   **Given** a user with an existing ArangoDB record authenticates via Keycloak
   **When** the token contains updated attributes (e.g. changed email, new roles)
   **Then** the ArangoDB record is updated with the new values via atomic UPSERT (FR18)
   **And** the composite key `{iss}#{sub}` remains unchanged — it is immutable
   **And** the update is atomic — no partial writes or race conditions

2. **AC2 — Soft-deleted user re-activated on re-login:**
   **Given** a user whose ArangoDB record has `deleted: true` (previously soft-deleted)
   **When** the user successfully authenticates via Keycloak (admin has re-enabled them in Keycloak)
   **Then** the ArangoDB record is re-activated: `deleted` set to `false`, `deletedAt` set to `null`
   **And** the profile fields (email, name, roles) are updated from JWT claims
   **And** the user can access the application normally
   **Note** This requires the admin to first re-enable the user in Keycloak — only then can the user log in and trigger re-activation

3. **AC3 — Custom fields preserved during JIT update:**
   **Given** a user with existing custom fields in ArangoDB (e.g. `personalIdentification`, `theme`, notification preferences)
   **When** the user re-authenticates and JIT provisioning updates their profile
   **Then** custom fields are NOT overwritten — only JIT-managed fields (email, name, roles) are updated
   **And** `createdAt` is preserved — it remains the original creation timestamp

4. **AC4 — Logging differentiated by action:**
   **Given** a user authenticates successfully
   **When** JIT provisioning runs
   **Then** the system logs "User provisioned" for new users
   **And** "User profile updated" for existing users with changed fields
   **And** "User re-activated" for previously soft-deleted users being restored

5. **AC5 — All tests pass:**
   **Given** the implementation is complete
   **When** the full test suite is run
   **Then** all tests pass with no failures

## Tasks / Subtasks

- [x] Task 1: Add soft-deleted user re-activation logic to `provisionUser()`
  - [x] 1.1 In `user-provisioning-service.js`, when soft-deleted user is detected, check if Keycloak still considers them active (token is valid — already verified by middleware)
  - [x] 1.2 If user is soft-deleted but has a valid token, re-activate: set `deleted: false`, set `deletedAt: null`, update JIT fields, set `updatedAt`
  - [x] 1.3 Log "User re-activated" event when a soft-deleted user is restored
  - [x] 1.4 Keep the permanent block for truly deleted Keycloak users (middleware rejects expired/invalid tokens before provisioning runs)

- [x] Task 2: Verify existing UPSERT preserves custom fields
  - [x] 2.1 Confirm the current ArangoDB UPSERT uses `UPDATE` (not `REPLACE`) — this preserves fields not in the update document
  - [x] 2.2 Verify `createdAt` is NOT included in the update document (only in insert document)
  - [x] 2.3 If any issues found, fix them
  - [x] 2.4 Add test verifying custom fields (e.g. `personalIdentification`, `theme`) survive UPSERT unchanged

- [x] Task 3: Update tests for new re-activation behavior
  - [x] 3.1 Add test: soft-deleted user with valid token gets re-activated (provisionUser returns user with `deleted: false`)
  - [x] 3.2 Add test: re-activated user has JIT fields updated from JWT claims
  - [x] 3.3 Add test: re-activated user has `deletedAt` set to `null`
  - [x] 3.4 Replace existing "should return null for soft-deleted user" test with a test verifying soft-deleted user is re-activated with `deleted: false` and `deletedAt: null`
  - [x] 3.5 Add test: verify "User re-activated" log message is emitted

- [x] Task 4: Verify all existing tests still pass
  - [x] 4.1 Run full backend test suite
  - [x] 4.2 Update `keycloak-auth-middleware.test.js` — soft-deleted users are no longer permanently blocked (middleware 403 check on `user.deleted` still works, but `provisionUser` no longer returns null for re-activated users)
  - [x] 4.3 Fix any other tests broken by the behavioral change

## Dev Notes

### Worktree Assignment

- **Worktree:** `epic3-keycloak`
- **Branch:** `feature/epic3-keycloak` (current)
- **Parallel with:** 3-1, 3-2 (epic3-sessions worktree — no file overlap)
- **After:** 3-5 (done — Keycloak Admin API proxy)
- **Before:** 3-7 (Right to erasure — depends on this story's re-activation logic)

### Key Insight: Existing JIT Provisioning Already Works

The core JIT upsert logic in `user-provisioning-service.js` already implements most of what this story requires:

- **Atomic UPSERT** with `INSERT ... UPDATE ... IN users` — preserves custom fields (UPDATE, not REPLACE)
- **Mutable field sync** — `email`, `name`, `roles` updated from JWT on every login
- **`createdAt` preservation** — only in INSERT doc, not UPDATE doc
- **Differentiated logging** — "User provisioned" vs "User profile updated"

**The real gap** is the soft-deleted user handling. Currently, `provisionUser()` returns `null` for any user with `deleted: true`, permanently blocking them. This story adds re-activation logic so that if an admin re-enables a user in Keycloak, the user can log back in and their ArangoDB record is restored.

### Re-activation Flow

```
User was soft-deleted (deleted: true)
  → Admin re-enables user in Keycloak
  → User logs in with valid Keycloak token
  → Middleware verifies token (passes — Keycloak says user is active)
  → provisionUser() detects deleted: true
  → NEW: Instead of returning null, re-activate the user
  → Set deleted: false, set deletedAt: null, update JIT fields
  → User gains access to the application
```

**Security consideration:** The middleware already validates the token via JWKS before calling `provisionUser()`. If the user is truly deleted/disabled in Keycloak, the token will be invalid and the middleware will reject it before provisioning runs. So by the time `provisionUser()` is called, we know Keycloak considers the user active.

**PII anonymization edge case (Story 3-7):** If a soft-deleted user was also anonymized (PII fields cleared) by Story 3-7's erasure flow, re-activation will restore `email` and `name` from the JWT claims, but custom fields (e.g. `personalIdentification`) will remain empty — this is expected behavior. The re-activation UPSERT only updates JIT-managed fields.

### Files to Modify

| File | Change |
|------|--------|
| `components/gov-chat-backend/services/user-provisioning-service.js` | Add re-activation logic in `provisionUser()` (integrated into existing UPSERT) |
| `components/gov-chat-backend/__tests__/user-provisioning-service.test.js` | Add tests for re-activation, update existing soft-delete test |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | Update tests for soft-deleted user no longer permanently blocked |

### Files to Read (Context)

| File | Why |
|------|-----|
| `components/gov-chat-backend/services/user-provisioning-service.js` | Current JIT provisioning — primary file to modify |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Understand provisioning call flow and error handling |
| `components/gov-chat-backend/__tests__/user-provisioning-service.test.js` | Existing tests to extend and update |
| `components/gov-chat-backend/test-fixtures/mockJwtPayload.js` | JWT fixture for test data |
| `components/gov-chat-backend/services/keycloak-proxy-service.js` | Reference for Keycloak API patterns (from Story 3-5) |

### Technical Constraints

- **CommonJS only** — `require()`/`module.exports`, never ES imports
- **ArangoDB UPSERT** — must use `UPDATE` (not `REPLACE`) to preserve custom fields
- **Atomic operations** — re-activation and JIT update must be atomic (single query or transaction)
- **Logging** — use `{ logger }` from `../shared-lib`, never `console.log`
- **Error format** — `{ error, message, details }` for HTTP responses
- **Test framework** — Jest, CommonJS mode, `describe()`/`it()`/`expect()`

### Cross-Story Dependencies

- **Story 3-5** (done) — `keycloak-proxy-service.js` provides admin operations; this story builds on the JIT layer
- **Story 3-7** (next) — Right to erasure depends on the re-activation logic established here
- **Story 3-2** (done) — Session invalidation marks users as deleted; this story provides the reverse path

### References

- [Source: components/gov-chat-backend/services/user-provisioning-service.js] — Current JIT provisioning implementation
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — Auth middleware calling provisioning
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision D1] — ArangoDB users collection schema
- [Source: _bmad-output/planning-artifacts/prd.md#FR18] — JIT provisioning requirement
- [Source: _bmad-output/implementation-artifacts/3-5-keycloak-admin-api-proxy-user-management.md] — Previous story for patterns

## Dev Agent Record

### Agent Model Used

glm-5-turbo (Claude Code)

### Debug Log References

None — no issues encountered during implementation.

### Completion Notes List

- Re-activation logic added to `provisionUser()`: soft-deleted users with valid Keycloak tokens are now re-activated via the UPSERT `updateDoc` (adds `deleted: false`, `deletedAt: null`)
- Existing UPSERT confirmed to use `UPDATE` (not `REPLACE`) — custom fields preserved automatically
- `createdAt` confirmed NOT in `updateDoc` — preserved for existing users
- "User re-activated" log message added, differentiated from "User provisioned" and "User profile updated"
- Middleware `user === null` check retained as defense-in-depth (though `provisionUser()` no longer returns null)
- Replaced old "return null for soft-deleted user" test with 3 re-activation tests
- Added custom field preservation test (personalIdentification, theme, notificationPreferences)
- Added re-activated user test in middleware test suite
- Removed duplicate "defense-in-depth" test from middleware suite
- Full test suite: 198 tests passing, 0 failures
- Code review fixes applied: removed dead `user === null` middleware check, cleaned up empty logging branch, added updateDoc assertions to custom fields test, documented sprint-status.yaml in File List

### File List

| File | Action | Description |
|------|--------|-------------|
| `components/gov-chat-backend/services/user-provisioning-service.js` | Modified | Added re-activation logic in `provisionUser()` |
| `components/gov-chat-backend/__tests__/user-provisioning-service.test.js` | Modified | Replaced soft-delete test with 3 re-activation tests, added custom fields test |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | Modified | Replaced null provisioning test, added re-activated user test, removed duplicate |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Modified | Removed dead `user === null` check (provisionUser never returns null) |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Modified | Updated story status: ready-for-dev → in-progress → review |

## Change Log

- 2026-04-06: Story 3.6 implementation complete — JIT provisioning re-activates soft-deleted users on re-login with valid Keycloak token
- 2026-04-07: Code review — fixed 4 issues: removed dead `user === null` middleware check, cleaned empty logging branch, strengthened custom fields test assertions, documented sprint-status.yaml in File List
