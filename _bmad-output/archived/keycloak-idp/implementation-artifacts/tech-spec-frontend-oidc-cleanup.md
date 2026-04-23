---
title: 'Frontend OIDC Cleanup'
slug: 'frontend-oidc-cleanup'
created: '2026-04-14'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Vue 3 (Options API)', 'Node.js/Express', 'Keycloak OIDC']
files_to_modify:
  - 'components/gov-chat-frontend/src/components/SettingsComponent.vue'
  - 'components/gov-chat-frontend/src/components/AdminDashboard.vue'
  - 'components/gov-chat-frontend/src/services/userService.js'
  - 'components/gov-chat-frontend/src/services/userProfileService.js'
  - 'components/gov-chat-backend/routes/user-routes.js'
  - 'components/gov-chat-backend/services/user-profile-service.js'
  - 'components/gov-chat-frontend/src/App.vue'
  - 'components/gov-chat-frontend/src/components/NavBarComponent.vue'
  - 'components/gov-chat-frontend/src/components/FileDetailsDialog.vue'
  - 'components/gov-chat-frontend/src/components/RightSideBarComponent.vue'
  - 'components/gov-chat-frontend/src/components/UserProfileComponent.vue'
  - 'components/gov-chat-frontend/src/components/ChatFolders.vue'
  - 'components/gov-chat-frontend/src/store/chatHistoryStore.js'
  - 'components/gov-chat-frontend/src/store/modules/auth.js'
  - 'components/gov-chat-frontend/src/i18n/locales/en.js'
code_patterns:
  - 'localStorage-based auth (dead) vs OIDC in-memory tokens (active)'
  - 'JIT provisioning overwrites ArangoDB from JWT on every request'
  - 'Admin endpoints proxy to Keycloak Admin API via service account'
test_patterns:
  - 'Jest with jsdom (frontend), Jest CommonJS (backend)'
  - 'Test files: __tests__/userService.test.js (dead), keycloak-*.test.js (active)'
---

# Tech-Spec: Frontend OIDC Cleanup

**Created:** 2026-04-14

## Overview

### Problem Statement

The migration to Keycloak OIDC left account management interfaces (email change, account deletion) in the GENIE frontend that are broken (passwords collected but never sent to the backend) and inconsistent with the OIDC model (JIT provisioning overwrites changes on next login, especially for federated users like Google). Additionally, a comprehensive scan revealed significant dead code across both frontend and backend from the pre-Keycloak authentication system.

### Solution

Remove identity management actions from the GENIE frontend and replace them with functional links to Keycloak consoles (Account Console for users, Admin Console for admins). Remove all dead code identified by the comprehensive sweep. Fix broken localStorage-based auth patterns. Keep GENIE-specific features (Reset User Data, admin stats, user search/pagination, analytics sessions).

### Scope

**In Scope:**
- **User Settings**: remove Account Management section (email edit + delete account + modals), add "Manage my account →" button linking to Keycloak Account Console
- **User Settings**: keep Reset User Data (GENIE-specific, not identity-related)
- **Admin Dashboard**: remove UserEditDialog (enable/disable, roles, force logout), replace Edit + Keycloak buttons with a single "Manage →" button
- **Admin Dashboard**: keep user table read-only, stats, search/pagination
- **Backend**: remove `PUT /api/users/email`, `POST /api/users/delete`, `POST /api/admin/users/:userId/force-logout`, admin roles/disable branches in `PUT /api/users/:userId`
- **Backend**: remove dead services and methods (email-service.js, dead user-profile-service methods)
- **Frontend**: delete dead files, remove dead service methods, fix broken localStorage patterns
- **i18n**: clean up dead translation keys across 14 locale files
- **Scripts**: remove dead migration/setup scripts
- **Tests**: remove tests for deleted code

**Out of Scope:**
- Keycloak theme modifications
- OIDC authentication flow modifications
- Keycloak iframe embedding
- Role management or security policy changes
- ArangoDB dead field cleanup in existing documents (data migration)

## Context for Development

### Codebase Patterns

- Vue 3 Options API (not Composition API, not `<script setup>`)
- Backend CommonJS (`require`/`module.exports`, no ES imports)
- Translations: `translate('key', 'default')` (not `$t()`)
- API calls: via `httpService.js` (frontend) and `keycloak-proxy-service.js` (backend)
- JIT provisioning: every authenticated request updates ArangoDB from the JWT
- OIDC config: `oidcConfig.authority` available in frontend (contains `{keycloakUrl}/realms/{realm}`)
- **Broken pattern**: many frontend components read auth state from `localStorage.getItem('user')` which is no longer populated by Keycloak OIDC — tokens are in-memory only

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `components/gov-chat-frontend/src/components/SettingsComponent.vue` | Account Management section to remove/modify |
| `components/gov-chat-frontend/src/components/AdminDashboard.vue` | Users tab + existing Keycloak button |
| `components/gov-chat-frontend/src/services/userService.js` | 14+ dead methods to remove |
| `components/gov-chat-frontend/src/services/userProfileService.js` | 2 dead methods to remove |
| `components/gov-chat-backend/routes/user-routes.js` | 3 dead endpoints + 2 dead branches to remove |
| `components/gov-chat-backend/services/user-profile-service.js` | 4 dead methods + 1 partially dead method |
| `components/gov-chat-backend/services/email-service.js` | Entire file dead — delete |

### Technical Decisions

- **URLs derived from `oidcConfig.authority`**: zero backend endpoint, zero env var
  - Account Console URL: `${oidcConfig.authority}/account/`
  - Admin Console URL: existing `keycloakAdminUrl` computed (already in AdminDashboard)
- **No Keycloak mention in user interface**: functional labels only ("Manage my account", "Manage")
- **Keycloak theme aligned with GENIE**: transparent transition for users
- **New browser tab** (`target="_blank"`) for external links
- **session-service.js stays**: it manages analytics sessions, not auth sessions
- **keycloak-proxy-service.js stays**: still used by active self-service profile update endpoint

## Implementation Plan

### Tasks

**Phase ordering matters**: dereference first, then remove methods, then fix localStorage, then delete files, then cleanup. This prevents build errors at each step.

#### Phase 1: Dereference and Modify Active Components

##### 1a. Modify SettingsComponent.vue
- Remove Account Management section (lines 129-182)
- Remove email confirmation modal (lines 185-240)
- Remove delete account modal (lines 245-285)
- Remove dead password CSS classes
- Remove dead data properties: `isEditingEmail`, `emailError`, `newEmail`, `isEmailUpdating`, `showEmailConfirmModal`, `emailChangePassword`, `emailChangeError`, `showDeleteAccountModal`, `deleteAccountPassword`, `deleteAccountReason`, `deleteAccountError`
- Remove dead methods: `toggleEmailEdit`, `prepareEmailChange`, `confirmEmailChange`, `cancelEmailChange`, `confirmDeleteAccount`, `handleDeleteAccountConfirm`, `handleDeleteAccountCancel`, `processAccountDeletion`, `cancelAccountDeletion`
- Add "Manage my account →" button linking to `${oidcConfig.authority}/account/`
- Keep Reset User Data section and logic

##### 1b. Modify AdminDashboard.vue
- Remove `UserEditDialog` import and component registration
- Remove `showUserEditDialog`, `selectedUserId` data properties
- Remove `openUserEditDialog()`, `handleUserUpdated()` methods
- Remove `<UserEditDialog>` component usage (lines 1504-1509)
- Replace "Edit" + "Keycloak" buttons with single "Manage →" button per user
- Remove tooltip referencing `admin.manageInKeycloak` i18n key (no Keycloak mention in UI)
- Remove button text "Keycloak" — replace with functional "Manage" label
- Keep user table, stats, search/pagination, other tabs

#### Phase 2: Remove Dead Backend Endpoints and Methods

##### 2a. Remove Dead Backend Endpoints (`user-routes.js`)

| # | Endpoint/Branch | Action |
|---|-----------------|--------|
| 1 | `PUT /email` (lines 188-223) | Delete |
| 2 | `POST /delete` (lines 394-412) | Delete |
| 3 | `POST /admin/users/:userId/force-logout` (lines 618-661) | Delete |
| 4 | Admin roles branch in `PUT /:userId` (lines 498-509) | Delete |
| 5 | Admin disable branch in `PUT /:userId` (lines 511-522) | Delete |
| 6 | Swagger User schema dead fields (lines 19-44) | Clean up |

##### 2b. Remove Dead Backend Methods (`user-profile-service.js`)

| # | Method | Lines | Confidence |
|---|--------|-------|------------|
| 1 | `sendVerificationEmail()` | 877-912 | CERTAIN |
| 2 | `deleteUserAccountPermanently()` | 641-698 | CERTAIN |
| 3 | `isEmailAvailable()` | 506-535 | CERTAIN |
| 4 | `isUsernameAvailable()` | 538-568 | CERTAIN |
| 5 | `forceUserLogout()` — token invalidation logic only (lines 753-807) | Partially dead — keep analytics session ending (809-845) | LIKELY |
| 6 | `resetUserData()` — dead field preservation (encPassword, loginName, accessToken, emailVerified) | Partially dead — method stays but clean up preserved fields | LIKELY |

**Dependency note (F3)**: `resetUserData()` calls `refreshUserData()` (which is marked for deletion in Phase 4a). Since `resetUserData()` must be kept (AC3), the dev agent must either: (a) keep `refreshUserData()` but rewrite it to use Vuex store instead of dead localStorage, or (b) inline its logic into `resetUserData()` using the Vuex store. Verify the actual call before implementing.

#### Phase 3: Fix Broken localStorage Patterns (8 call sites)

These components read from `localStorage.getItem('user')` which returns null in the Keycloak OIDC world. Tokens are in-memory only.

**Replacement pattern**: the Vuex store `store/modules/auth.js` is the source of truth for OIDC user state. The dev agent should use the store's getters/actions to obtain user info and auth tokens instead of localStorage.

| # | Component | Line | Issue |
|---|-----------|------|-------|
| 1 | `NavBarComponent.vue` | 526 | `getCurrentUserFromStorage()` always returns null |
| 2 | `AdminDashboard.vue` | 2625 | `getCurrentUser()` always returns null |
| 3 | `FileDetailsDialog.vue` | 957 | `accessToken` always null — downloads fail |
| 4 | `SettingsComponent.vue` | 639, 674 | Falls through to API call (acceptable but inefficient) |
| 5 | `RightSideBarComponent.vue` | 283 | `getAuthToken()` returns null |
| 6 | `UserProfileComponent.vue` | 931 | `getCurrentUserId()` returns empty string |
| 7 | `ChatFolders.vue` | 686 | `loadCurrentUser()` falls through to API call |
| 8 | `chatHistoryStore.js` | 208 | `moveChat()` returns null for userId |

Also: `App.vue` line 315 — `window.location.href = '/login'` should be `window.location.href = '/'`
Also: `store/modules/auth.js` line 179 — `localStorage.removeItem('auth_token')` references dead key
Also: `SettingsComponent.vue` line 642 and `ChatFolders.vue` line 688 — `getCurrentUserInfo()` falls back to dead localStorage

**Important**: verify each component individually — some may already have API fallback logic that partially works. The fix should use the Vuex store as primary source, with API calls as fallback if needed.

#### Phase 4: Remove Dead Frontend Service Methods

##### 4a. Remove Dead Methods (`userService.js`)

Delete the following methods (all have zero production callers):

| # | Method | Confidence |
|---|--------|------------|
| 1 | `verifyEmail()` | CERTAIN |
| 2 | `resendVerificationEmail()` | CERTAIN |
| 3 | `updateEmail()` | CERTAIN |
| 4 | `deleteAccount()` | CERTAIN |
| 5 | `validatePasswordStrength()` | CERTAIN |
| 6 | `doPasswordsMatch()` | CERTAIN |
| 7 | `verifyUserEmail()` | CERTAIN |
| 8 | `getAllUsers()` | CERTAIN |
| 9 | `getUserProfile()` | CERTAIN |
| 10 | `forceUserLogout()` | CERTAIN |
| 11 | `uploadAvatar()` | CERTAIN |
| 12 | `deleteAvatar()` | CERTAIN |
| 13 | `getActivityLog()` | CERTAIN |
| 14 | `getAccountStatus()` | CERTAIN |
| 15 | `updateAccountSettings()` | CERTAIN |
| 16 | `fetchCurrentUser()` | CERTAIN |
| 17 | `getCurrentUser()` — broken (reads dead localStorage) | CERTAIN |
| 18 | `isAuthenticated()` — broken (reads dead localStorage) | CERTAIN |
| 19 | `setUserData()` / `clearUserData()` — broken (writes dead localStorage) | CERTAIN |
| 20 | `getCurrentUserInfo()` — broken (falls back to dead localStorage) | CERTAIN |
| 21 | `refreshUserData()` — broken (stores to dead localStorage) | CERTAIN |
| 22 | `logout()` — broken (reads dead localStorage for token) | LIKELY |

##### 4b. Remove Dead Methods (`userProfileService.js`)

| # | Method | Confidence |
|---|--------|------------|
| 1 | `searchUsers()` | CERTAIN |
| 2 | `createProfile()` | CERTAIN |

**Note**: after deleting 22 methods from `userService.js`, verify what remains. The dev agent should check each remaining method has production callers before keeping it. If only a few methods remain, consider whether the service file is still needed or if its remaining methods should be moved to another service.

#### Phase 5: Delete Dead Files (11 files)

All imports/references to these files have been removed in Phase 1.

| # | File | Confidence |
|---|------|------------|
| 1 | `frontend/src/components/RegistrationSuccessScreen.vue` | CERTAIN |
| 2 | `frontend/src/components/OldUserProfileComponent.vue` | CERTAIN |
| 3 | `frontend/src/components/UserProfileContainer.vue` | CERTAIN |
| 4 | `frontend/src/components/PersonalIdentificationTab.vue` | CERTAIN |
| 5 | `frontend/src/components/UserEditDialog.vue` | CERTAIN |
| 6 | `frontend/src/i18n/login-messages.js` | CERTAIN |
| 7 | `frontend/src/services/api.js` | CERTAIN |
| 8 | `frontend/src/__tests__/userService.test.js` | CERTAIN |
| 9 | `backend/services/email-service.js` | CERTAIN |
| 10 | `backend/services/api.js` | CERTAIN |
| 11 | `backend/scripts/old-schema-scripts/` (entire directory) | CERTAIN |

#### Phase 6: Clean Up Dead i18n Keys (14 locale files)

Delete these key groups from all locale files:

| Key Group | Description | Confidence |
|-----------|-------------|------------|
| `passwordResetConfirm.*` | Password reset confirmation page | CERTAIN |
| `passwordReset.*` | Password reset request page | CERTAIN |
| `register.*` | Registration form | CERTAIN |
| `login.*` | Login form | CERTAIN |
| `admin.userEdit.*` | Admin user edit dialog | CERTAIN |
| `settings.*` (email/password keys) | confirmEmailChange, pleaseEnterPassword, enterPasswordConfirm, currentPasswordPlaceholder, incorrectPassword, confirmChange, changingEmailTo, will, logOutSystem, sendVerificationLink, requireVerification, checkNewEmailVerification, unableToVerifyEmail, emailAlreadyInUse, failedToUpdateEmail | LIKELY |
| `passwordResetInitiated` | Top-level key (not under `settings.*`) — verify actual location in `en.js` before removing | LIKELY |

#### Phase 7: Clean Up Swagger/API Docs

- Remove dead User schema fields in `user-routes.js` (lines 19-44): `emailVerified`, `role` enum
- Remove dead User schema fields in `index.js` (lines 221-246): `loginName`, `accessToken`
- Remove dead route references in `routes/README.md`

### Acceptance Criteria

- [ ] AC1: User Settings shows "Manage my account →" button that opens Keycloak Account Console in new browser tab
- [ ] AC2: User Settings shows no email edit, delete account, or password-related UI
- [ ] AC3: User Settings still shows Reset User Data functionality
- [ ] AC4: Admin Dashboard shows user table with single "Manage →" button per user
- [ ] AC5: Admin Dashboard has no UserEditDialog, no enable/disable toggles, no role assignment
- [ ] AC6: No dead Vue components exist in `src/components/` (RegistrationSuccessScreen, OldUserProfileComponent, UserProfileContainer, PersonalIdentificationTab, UserEditDialog)
- [ ] AC7: No dead service files exist (`email-service.js`, `api.js` frontend/backend)
- [ ] AC8: No dead backend endpoints exist (`PUT /email`, `POST /delete`, `POST /admin/users/:userId/force-logout`)
- [ ] AC9: No frontend component reads from `localStorage.getItem('user')` for auth state
- [ ] AC10: No i18n keys reference dead auth flows (`login.*`, `register.*`, `passwordReset.*`, `admin.userEdit.*`)
- [ ] AC11: No test files test deleted code
- [ ] AC12: `PUT /api/users/:userId` only handles self-service profile update (no admin branches)
- [ ] AC13: Backend `npm run lint` passes with no errors
- [ ] AC14: Frontend `npm run lint` passes with no errors
- [ ] AC15: No Keycloak mention in user-facing UI text
- [ ] AC16: Given authenticated user on Admin Dashboard, when clicking "Manage" on a user, then Keycloak Admin Console opens in new tab for that user
- [ ] AC17: Given authenticated user, when downloading a file from FileDetailsDialog, then download succeeds (validates localStorage fix)

## Additional Context

### Dependencies

- Keycloak theme already aligned with GENIE (no frontend theming work needed)
- `oidcConfig.authority` already available in frontend via OIDC config

### Testing Strategy

- Manual testing: verify Settings page shows "Manage my account" button and opens correct URL
- Manual testing: verify Admin Dashboard user table shows "Manage" button per user
- Manual testing: verify Reset User Data still works in Settings
- `npm run lint` in both frontend and backend to catch broken imports
- Backend tests: existing `keycloak-*.test.js` files remain valid (they test active code)
- No new tests needed — this is a cleanup task removing dead code

### Notes

- The "Keycloak" button already exists in AdminDashboard (line 1428) — serves as reference for the pattern
- The `keycloakAdminUrl` computed in AdminDashboard already derives the URL from `window.location.origin` and `oidcConfig.authority`
- Force logout (`POST /api/admin/users/:userId/force-logout`) only touches Redis, not Keycloak — security hole. Removed entirely; admins use Keycloak Admin Console "Logout all sessions" instead.
- `session-service.js` is NOT dead — it manages analytics sessions, not auth sessions. Keep it.
- `auth-routes.js` and `authController.js` are already clean — only `GET /auth/me` and `POST /auth/logout` remain, both active.
- `keycloak-proxy-service.js` stays — still used by active self-service profile update endpoint (`PUT /:userId`)
- ArangoDB dead collections (`verificationTokens`, `passwordResetTokens`) — document but do not drop (data retention concern). Dead fields in existing user documents — document but do not migrate.
- `scripts/old-schema-scripts/` contains 20+ obsolete migration/setup scripts — safe to delete entirely.
- The localStorage auth pattern is broken in 8+ components — these need careful fixing, not just deletion, since some have fallback API calls that partially work.
- **Commit strategy**: use one commit per phase or per logical group. This is a large cleanup spanning 14+ files — a single commit would be unreadable for review. Suggested commit groups: (1) Settings + Admin UI changes, (2) Backend endpoint/method removal, (3) Frontend service cleanup, (4) localStorage fixes, (5) Dead file deletion, (6) i18n + docs cleanup.
- **localStorage replacement pattern**: the Vuex store `store/modules/auth.js` is the source of truth for OIDC user state. Components should use store getters/actions instead of `localStorage.getItem('user')`. The dev agent must verify each component individually as some may have working API fallback logic.
