# Quick Spec: Cleanup Legacy User Management Code

**Date:** 2026-04-06
**Scope:** Backend + Frontend — remove user management operations that conflict with Keycloak as identity source
**Story context:** Post 3.3 — discovered during code review that AC3 is violated by existing code

## Problem

GENIE.AI has backend routes and frontend components that modify user data (roles, enable/disable, email, profile) directly in ArangoDB. Since JIT provisioning overwrites these fields from Keycloak JWT on every login, any modification via GENIE.AI is silently lost.

**Data flow conflict:**
```
Admin modifies user via GENIE.AI → ArangoDB updated
User logs in → Keycloak issues JWT with original data
JIT provisioning → Overwrites ArangoDB with JWT data
Result: GENIE.AI modification is lost
```

Additionally, some operations are ineffective:
- `disabled` flag in ArangoDB is set by UserEditDialog but NOT checked by auth middleware (only `deleted` is checked)
- Keycloak handles enable/disable independently — the ArangoDB `disabled` flag is dead code

## What Changes on Every Login (JIT Provisioning)

These fields are **overwritten** by Keycloak JWT on every login:

| Field | Source | ArangoDB change via GENIE.AI is |
|---|---|---|
| `email` | JWT `email` claim | Overwritten on next login |
| `name` | JWT `name` / `preferred_username` | Overwritten on next login |
| `roles` | JWT `realm_access.roles` | Overwritten on next login |
| `active` | Always `true` on UPSERT | Overwritten on next login |
| `deleted` | Always `false` on UPSERT | Overwritten on next login |

These fields are **preserved** (not JIT-provisioned):

| Field | Example | Note |
|---|---|---|
| `personalIdentification` | fullName, dob | Custom user data |
| Custom settings | Theme, preferences | App-specific |
| `createdAt` | Timestamp | Set only on INSERT |
| `disabled` | Boolean | Custom field, NOT enforced |

## Backend Changes

### Routes to REMOVE from `user-routes.js`

| Route | Method | Reason |
|---|---|---|
| `/:userId/role` | PUT | Role managed by Keycloak. JIT overwrites on next login. |
| `/email` | PUT | Email managed by Keycloak. JIT overwrites on next login. |
| `/delete` | POST | Account deletion via Keycloak only (Story 3.6 scope). |
| `/reset-data` | POST | Reset is meaningless when JIT re-provisions from Keycloak. |
| `/admin/users/:userId/resend-verification` | POST | Email managed by Keycloak. No GENIE.AI email verification. |

### Routes to KEEP in `user-routes.js`

| Route | Method | Reason |
|---|---|---|
| `/:userId` | GET | Read user profile — useful for admin dashboard stats. |
| `/:userId` | PUT | **Modify** — but strip role/email updates. Keep only custom fields (personalIdentification, preferences). |
| `/admin/users/:userId/force-logout` | POST | Legitimate security operation — invalidate sessions. |
| `/debug-routes` | GET | Development tool — keep. |

### Route Modification: `PUT /:userId`

This route currently accepts arbitrary profile updates. After cleanup:
- **Keep**: custom fields (personalIdentification, preferences, custom data)
- **Strip**: `roles`, `email`, `name`, `disabled` — these are JIT-provisioned from Keycloak
- Add validation: reject updates to JIT-provisioned fields with clear error message

### Service Changes: `user-profile-service.js`

- Remove `updateUserRole()` method (or redirect to no-op with deprecation warning)
- Add guard in `updateUserProfile()` to reject JIT-provisioned field updates
- Remove `deleteUserProfile()` — deletion handled by Keycloak (Story 3.6)
- Remove `initiateEmailChange()` — email managed by Keycloak
- Remove `sendVerificationEmail()` — email managed by Keycloak

## Frontend Changes

### Components to REMOVE

| File | Reason |
|---|---|
| `UserEditDialog.vue` | Entire component — admin user editing via Keycloak only |

### Components to MODIFY

| File | Change |
|---|---|
| `AdminDashboard.vue` | Remove "Edit" button on user list. Remove `openUserEditDialog()` method. Remove `UserEditDialog` import. Keep read-only stats and user list. |
| `UserService.js` | Remove admin methods: `updateUserRole`, `deactivateAccount`, `reactivateAccount`, `resendVerificationEmailAdmin`, `forceUserLogout`. |
| `UserProfileService.js` | Remove `updateProfile()` role update logic. Keep profile read operations. |

### UI Change: Replace "Edit" with "Manage in Keycloak"

In `AdminDashboard.vue`, replace the "Edit" button with a link to Keycloak admin console:
```
<a href="/auth/admin/genie/users/{userId}" target="_blank">Manage in Keycloak</a>
```

This redirects admins to the Keycloak console for the specific user, keeping user management in the correct place.

## Test Impact

### Backend Tests

- `__tests__/keycloak-auth-middleware.test.js` — No changes (middleware unchanged)
- `__tests__/user-profile-service.test.js` — Remove tests for deleted methods
- No new tests needed (removed code = removed tests)

### Frontend Tests

- `src/__tests__/userService.test.js` — Remove tests for deleted admin methods
- `src/__tests__/keycloakAuthService.test.js` — No changes

### E2E Tests

- No changes needed — E2E tests use Keycloak Admin API directly
- Existing curl commands in `keycloak-admin-guide.md` remain valid

## Files Changed

| Action | File |
|---|---|
| Modified | `components/gov-chat-backend/routes/user-routes.js` |
| Modified | `components/gov-chat-backend/services/user-profile-service.js` |
| Deleted | `components/gov-chat-frontend/src/components/UserEditDialog.vue` |
| Modified | `components/gov-chat-frontend/src/components/AdminDashboard.vue` |
| Modified | `components/gov-chat-frontend/src/services/userService.js` |
| Modified | `components/gov-chat-frontend/src/services/userProfileService.js` |

## Out of Scope

- Account deletion via Keycloak (Story 3.6 — Right to Erasure)
- Self-service profile editing (users editing their own profile — defer to future story)
- Email change flow via Keycloak (Keycloak already handles this natively)
- Force logout — kept as-is (legitimate security operation)
- `admin-routes.js` — keep as-is (only contains read operations)
- `user-provisioning-service.js` — no changes (JIT provisioning is correct)
