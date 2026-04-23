---
title: 'Keycloak Admin API Proxy for User Management'
slug: 'keycloak-admin-api-proxy-user-management'
created: '2026-04-06'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
story: '3-5'
tech_stack: ['Node.js/Express (CommonJS)', 'Vue 3 (Options API)', 'ArangoDB 3.12+', 'Keycloak 26.x', 'Jest']
files_to_modify:
  - 'config/keycloak/genie-realm.yaml'
  - 'env'
  - 'docker-compose.yaml'
  - 'components/gov-chat-backend/services/keycloak-proxy-service.js (NEW)'
  - 'components/gov-chat-backend/__tests__/keycloak-proxy-service.test.js (NEW)'
  - 'components/gov-chat-backend/routes/user-routes.js'
  - 'components/gov-chat-backend/services/user-profile-service.js'
  - 'components/gov-chat-frontend/src/components/AdminDashboard.vue'
  - 'components/gov-chat-frontend/src/components/UserEditDialog.vue (verify compat)'
  - 'components/gov-chat-frontend/src/components/UserProfileComponent.vue (verify compat)'
  - 'components/gov-chat-frontend/src/services/userService.js (verify compat)'
  - 'components/gov-chat-frontend/src/services/userProfileService.js (verify compat)'
  - 'components/gov-chat-backend/__tests__/keycloak-proxy-service.test.js (NEW)'
code_patterns:
  - 'CommonJS modules (require/module.exports) — never ES imports in backend'
  - 'Vue 3 Options API — never Composition API or script setup'
  - 'Per-route auth middleware (keycloakAuthMiddleware.authenticate / requireAdmin)'
  - 'Controller→Service pattern: routes handle HTTP, services contain business logic'
  - 'Inline admin check: req.user.roles.includes("admin")'
  - 'JIT provisioning: user-provisioning-service.js UPSERTs from JWT on each login'
  - 'No existing Keycloak service account pattern in codebase'
test_patterns:
  - 'Jest for both backend and frontend'
  - 'Backend tests mock shared-lib (logger, dbService), arangojs (aql)'
  - 'Frontend tests mock httpService, localStorage'
  - 'Test files in __tests__/ (backend) and src/__tests__/ (frontend)'
---

# Tech-Spec: Keycloak Admin API Proxy for User Management

**Created:** 2026-04-06
**Story:** 3-5

## Overview

### Problem Statement

GENIE.AI has backend routes and frontend components that allow administrators to modify user data (roles, enable/disable, email, profile) directly in ArangoDB. Since JIT provisioning overwrites these fields from Keycloak JWT on every login, any modification via GENIE.AI is silently lost or creates inconsistencies between Keycloak (source of truth for auth) and ArangoDB.

Additionally, the `disabled` flag set by `UserEditDialog.vue` is stored in ArangoDB but is NOT checked by the auth middleware (only `deleted` is checked), making it completely ineffective.

### Solution

Rewrite backend admin user management routes to proxy to Keycloak Admin API instead of modifying ArangoDB directly. Keep existing frontend UI components (UserEditDialog, AdminDashboard, UserProfileComponent) — they continue to call the same GENIE.AI backend endpoints, but those endpoints now forward operations to Keycloak. For self-service profile editing, JIT-provisioned fields (email, name, username, roles) are forwarded to Keycloak; custom fields (personalIdentification, settings, notifications) continue to be stored in ArangoDB directly.

### Scope

**In Scope:**
- Create `genie-proxy-client` service account in `config/keycloak/genie-realm.yaml` with restricted permissions
- Create backend Keycloak Admin API integration service (`keycloak-proxy-service.js`) with two auth modes
- Rewrite `PUT /:userId` — `roles` branch → Keycloak role mapping API, `disabled` branch → Keycloak user update API, self-service branch → split JIT/custom
- Remove `PUT /:userId/role` (dead route, no frontend caller)
- Rewrite `PUT /email` to proxy to Keycloak email update API (via service account)
- Rewrite `POST /delete` to proxy to Keycloak user deletion API (via service account) + set `deleted: true` on ArangoDB record (defense-in-depth)
- Remove `POST /reset-data` (meaningless when JIT re-provisions from Keycloak)
- Remove `POST /admin/users/:userId/resend-verification` (email managed by Keycloak)
- Add "Manage in Keycloak" link in AdminDashboard for admin convenience
- Clean up dead frontend methods and affected tests
- Update Swagger/OpenAPI annotations for rewritten and removed routes
- Keep all existing frontend UI components (UserEditDialog, AdminDashboard, UserProfileComponent, UserProfileContainer)

**Out of Scope:**
- Force logout route (`POST /admin/users/:userId/force-logout`) — kept as-is (defense-in-depth)
- `GET /api/users/:userId/context` — kept (OPEA read-only endpoint)
- `admin-routes.js` — no changes (only contains read operations)
- Account deletion via Keycloak with ArangoDB data cleanup (Story 3-7 — Right to Erasure)
- Admin dashboard read-only stats (user count, activity metrics)
- Keycloak session revocation (Keycloak manages its own sessions)

## Context for Development

### Codebase Patterns

- **CommonJS modules** (`require()`/`module.exports`) — never ES imports in backend
- **Vue 3 Options API** — never Composition API or `<script setup>`
- **Route structure**: Each domain has its own file in `routes/` exporting `express.Router()`
- **Auth middleware**: Per-route via `keycloakAuthMiddleware.authenticate` — never global
- **JIT provisioning**: `user-provisioning-service.js` UPSERTs user on each login from JWT claims
- **Admin middleware**: `keycloakAuthMiddleware.requireAdmin` for admin-only routes
- **Frontend services**: Domain-specific in `src/services/`, called via `httpService.js`

### JIT-Overwritten Fields (Keycloak is source of truth)

These fields are overwritten from JWT on every login — any GENIE.AI modification is lost:

| Field | JWT Source | GENIE.AI modification → |
|---|---|---|
| `email` | `decodedToken.email` | Lost on next login |
| `name` | `decodedToken.name` or `preferred_username` | Lost on next login |
| `roles` | `decodedToken.realm_access.roles` | Lost on next login |
| `active` | Always set to `true` on UPSERT | Lost on next login |
| `deleted` | Always set to `false` on UPSERT | Lost on next login |
| `updatedAt` | Set to `new Date().toISOString()` | Lost on next login |

### Preserved Fields (NOT JIT-provisioned, safe to modify)

| Field | Example | Note |
|---|---|---|
| `personalIdentification` | `{fullName, dob}` | Custom user data |
| Custom preferences | Theme, language | App-specific settings |
| `createdAt` | Timestamp | Set only on INSERT |

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `components/gov-chat-backend/routes/user-routes.js` | Backend user routes — rewrite to proxy to Keycloak |
| `components/gov-chat-backend/services/user-profile-service.js` | Backend user service — remove JIT field writes |
| `components/gov-chat-backend/services/keycloak-proxy-service.js` | **NEW** — Keycloak Admin API proxy service |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Auth middleware — reference only (no changes) |
| `components/gov-chat-backend/services/user-provisioning-service.js` | JIT provisioning — reference only (no changes) |
| `config/keycloak/genie-realm.yaml` | Keycloak realm config — add `genie-proxy-client` |
| `env` | Environment template — add `KEYCLOAK_PROXY_CLIENT_ID` + `KEYCLOAK_PROXY_CLIENT_SECRET` |
| `docker-compose.yaml` | Backend service env — pass proxy client vars |
| `components/gov-chat-frontend/src/components/UserEditDialog.vue` | Frontend admin dialog — keep, verify compatibility |
| `components/gov-chat-frontend/src/components/AdminDashboard.vue` | Frontend admin dashboard — add "Manage in Keycloak" link |
| `components/gov-chat-frontend/src/components/UserProfileComponent.vue` | Frontend self-service profile — verify compatibility |
| `components/gov-chat-frontend/src/components/UserProfileContainer.vue` | Frontend profile container — verify compatibility |
| `components/gov-chat-frontend/src/services/userService.js` | Frontend user service — verify compatibility |
| `components/gov-chat-frontend/src/services/userProfileService.js` | Frontend profile service — verify compatibility |

### Investigation Findings

#### Backend Route Details (`user-routes.js`)

| Route | Line | Middleware | Auth Context | Service Method | Action |
|---|---|---|---|---|---|
| `PUT /:userId` | 670 | authenticate | Self + admin (dual) | `updateUserProfile()` or `users.update()` | **Rewrite** — split: `roles`→KC, `disabled`→KC, JIT→KC, custom→Arango |
| `PUT /:userId/role` | 826 | authenticate (inline admin check) | Admin | `users.update()` | **Remove** — dead route, no frontend caller |
| `PUT /email` | 188 | authenticate | Self (with password) | `users.update()` | **Rewrite** → KC user update API |
| `POST /delete` | 563 | authenticate | Self (with password) | `deleteUserAccountPermanently()` | **Rewrite** → KC user delete API |
| `POST /reset-data` | 460 | authenticate | Self | `resetUserData()` | **Remove** |
| `POST /admin/.../resend-verification` | 930 | authenticate (inline admin check) | Admin | `sendVerificationEmail()` | **Remove** |
| `POST /admin/.../force-logout` | 1030 | authenticate + requireAdmin | Admin | `forceUserLogout()` | **Keep** |
| `GET /:userId` | 369 | authenticate | Self | `getUserProfile()` | **Keep** |
| `GET /:userId/context` | 405 | X-Service-Token | Service | `getUserProfile()` + `buildUserContext()` | **Keep** |
| `GET /debug-routes` | 111 | None | Public | N/A | **Keep** |

**Critical note on `PUT /:userId` (line 670):** This route is dual-purpose — it handles BOTH profile updates (multipart/form-data) AND role/enable-disable updates. The current code checks `req.body.role` (singular string) but UserEditDialog sends `req.body.roles` (array, line 476). Similarly, the code checks nothing for enable/disable but UserEditDialog sends `req.body.disabled` (inverse boolean, line 480). The route must be updated to detect the actual payload shapes the frontend sends: `roles` (array) for role changes, `disabled` (boolean) for enable/disable.

**Admin role check pattern:** Some routes use inline `req.user.roles.includes('admin')` instead of `requireAdmin` middleware. The proxy routes should use `requireAdmin` middleware consistently.

#### Backend Service Methods (`user-profile-service.js`)

| Method | Line | ArangoDB Write | Action |
|---|---|---|---|
| `updateUserProfile(userId, profileData, files)` | 47 | Yes — `this.users.update()` | **Modify** — strip JIT fields, delegate to KC |
| `deleteUserAccountPermanently(userId)` | 669 | Yes — `this.users.remove()` | **Remove** — KC proxy handles deletion |
| `resetUserData(userId)` | 603 | Yes — `this.users.replace()` | **Remove** — route removed |
| `forceUserLogout(userId, adminId)` | 732 | Yes — token invalidation | **Keep** — defense-in-depth |
| `initiateEmailChange(userId, newEmail)` | 218 | Yes — `this.users.update()` | **Remove** — KC handles email |
| `sendVerificationEmail(user)` | 903 | Yes — `verificationTokens` | **Remove** — route removed |
| `getUserProfile(userId)` | 123 | No (read) | **Keep** |
| `searchUsers(criteria, limit, offset)` | 448 | No (read) | **Keep** |
| `isEmailAvailable(email)` | 539 | No (read) | **Keep** |
| `isUsernameAvailable(username)` | 571 | No (read) | **Keep** |

#### Frontend Component Details

**UserEditDialog.vue:**
- Calls `userProfileService.updateProfile(userId, updateData)` at line 491 — sends `{roles: ['admin'], disabled: false}` (roles is **array**, disabled is **inverse boolean**)
- Calls `userService.resendVerificationEmailAdmin(userId)` at line 564 — route being removed
- Calls `userService.forceUserLogout(userId)` at line 613 — route being kept
- Emits `user-updated` event on save (line 513), verification (line 580), logout (line 628)
- **Impact:** The `resendVerificationEmailAdmin` call needs to be removed from the dialog. The `updateProfile` call will transparently go through the KC proxy — backend now detects `roles` (array) and `disabled` (inverse boolean) from this payload. The `forceUserLogout` call stays.

**AdminDashboard.vue:**
- Import at line 2383, registered at line 2397
- Edit button at lines 2231-2238, `openUserEditDialog()` at lines 3592-3598
- `handleUserUpdated()` at lines 3601-3617 — refreshes stats, shows notification
- `showUserEditDialog: false, selectedUserId: null` at lines 2568-2569
- **Impact:** Add "Manage in Keycloak" link. Remove `resendVerificationEmailAdmin` call from UserEditDialog.

**UserProfileComponent.vue:**
- 8 tabs of custom fields (personalIdentification, civil registration, address, etc.)
- `confirmSave()` at lines 864-959 calls `userProfileService.updateProfile(this.currentUserId, profileData)`
- **No role update logic** — this component is purely for custom profile data
- **Impact:** Minimal — the `updateProfile` call goes to `PUT /:userId` which will be rewritten. Custom fields still go to ArangoDB. JIT fields (if any were editable) go to KC. Since all tabs are custom fields, this component may not need changes.

**userService.js admin methods:**
- `updateUserRole(userId, updateData)` line 476 → `PUT /users/:userId` — NOT used by UserEditDialog (dead code)
- `deactivateAccount(reason)` line 294 → `POST /users/deactivate` — **no backend route found**, likely dead code
- `reactivateAccount()` line 310 → `POST /users/reactivate` — **no backend route found**, likely dead code
- `resendVerificationEmailAdmin(userId)` line 587 → route being removed
- `forceUserLogout(userId)` line 570 → route being kept
- **Impact:** `deactivateAccount`/`reactivateAccount` may be dead code — verify before removing.

#### Keycloak Realm Config (`genie-realm.yaml`)

- `genie-app` client: **public** (line 31), `serviceAccountsEnabled: false`
- **No existing confidential client with service account** — need to establish the pattern
- Default admin user: `admin` with `admin` + `user` roles (lines 15-27)
- Realm roles: `admin`, `user` (lines 8-12)
- **Need to add:** `genie-proxy-client` as confidential client with service account enabled

#### Environment & Docker Configuration

- Backend currently receives: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_ADDITIONAL_REALMS`, `NODE_TLS_REJECT_UNAUTHORIZED`
- Backend does **NOT** currently receive `KEYCLOAK_ADMIN_USERNAME`/`KEYCLOAK_ADMIN_PASSWORD` — those go to Keycloak container only
- **Need to add to docker-compose.yaml backend environment:** `KEYCLOAK_PROXY_CLIENT_ID`, `KEYCLOAK_PROXY_CLIENT_SECRET`
- **Need to add to env template:** `KEYCLOAK_PROXY_CLIENT_ID=genie-proxy-client`, `KEYCLOAK_PROXY_CLIENT_SECRET=` (required secret)

### Security Architecture

**Two authentication modes for Keycloak API calls:**

```
GENIE.AI frontend
  │
  ▼
GENIE.AI backend (keycloak-auth-middleware)
  │
  ├── ADMIN ROUTES (requireAdmin middleware)
  │   └── keycloak-proxy-service.js
  │       └── Service account: genie-proxy-client (client credentials grant)
  │           Permissions: manage-users, view-users, manage-roles, query-users ONLY
  │           CANNOT: modify realm settings, clients, events, export/import
  │
  └── SELF-SERVICE ROUTES (authenticated user)
      └── User's own JWT token (passthrough to Keycloak Account API)
          Keycloak enforces: user can only modify their own profile
```

**Key security principle:** GENIE.AI backend never uses Keycloak superadmin credentials (`KEYCLOAK_ADMIN_USERNAME`/`KEYCLOAK_ADMIN_PASSWORD`) at runtime. Those are used exclusively by `keycloak-config-cli` at container startup to initialize the realm. All runtime API operations use the restricted `genie-proxy-client` service account.

**GENIE.AI admin ≠ Keycloak admin:** A GENIE.AI admin (`admin` role in JWT) can manage users via the proxy, but has no ability to modify realm configuration, client settings, or other sensitive Keycloak resources. The service account's fine-grained permissions enforce this boundary at the Keycloak level.

### Technical Decisions

- **TD1**: Backend proxies to Keycloak Admin API — frontend keeps calling GENIE.AI backend; backend forwards admin operations to Keycloak via restricted service account. Frontend never calls Keycloak directly.
- **TD2**: Two authentication modes in `keycloak-proxy-service.js` — (1) **Admin context**: service account `genie-proxy-client` with restricted permissions for admin-only routes; (2) **Self-service context**: user's own JWT token passthrough for profile updates (Keycloak enforces self-only access).
- **TD3**: New `keycloak-proxy-client` service account in `genie-realm.yaml` — confidential client with service account enabled, fine-grained permissions: `manage-users`, `view-users`, `manage-roles`, `query-users` only. Cannot modify realm config, clients, or other admin functions.
- **TD4**: Split `PUT /:userId` (self-service) — JIT-provisioned fields (email, name) → Keycloak Account API via user's own token; custom fields (personalIdentification, settings, notifications) → ArangoDB. Self-context enforced (user can only modify own profile).
- **TD5**: Token caching with lazy refresh — cache service account token, on 401 re-authenticate and retry. More resilient than fixed TTL.
- **TD6**: Keep `POST /admin/users/:userId/force-logout` — defense-in-depth, documented that it doesn't revoke Keycloak sessions
- **TD7**: Keep `GET /api/users/:userId/context` — used by OPEA services (read-only, X-Service-Token auth)
- **TD8**: Add "Manage in Keycloak" link in AdminDashboard — convenience fallback to Keycloak admin console
- **TD9**: Remove `POST /admin/users/:userId/resend-verification` — email managed by Keycloak
- **TD10**: Remove `POST /reset-data` — reset is meaningless when JIT re-provisions from Keycloak
- **TD11**: Frontend UI components unchanged — UserEditDialog, AdminDashboard, UserProfileComponent keep their current UI; only backend response handling may need minor updates

## Implementation Plan

### Tasks

- [ ] Task 1: Create `genie-proxy-client` service account in Keycloak config
  - [ ] 1.1 Add `genie-proxy-client` definition to `config/keycloak/genie-realm.yaml` — confidential client, service account enabled, `serviceAccountsEnabled: true`, standard + client_credentials flows
  - [ ] 1.2 Assign fine-grained permissions: `manage-users`, `view-users`, `manage-roles`, `query-users` (via Keycloak authorization services or realm roles)
  - [ ] 1.3 Add `KEYCLOAK_PROXY_CLIENT_ID=genie-proxy-client` and `KEYCLOAK_PROXY_CLIENT_SECRET=` to `env` template (secret, required)
  - [ ] 1.4 Pass env vars to backend container in `docker-compose.yaml` environment section

- [ ] Task 2: Create `keycloak-proxy-service.js` backend service
  - [ ] 2.1 Create `components/gov-chat-backend/services/keycloak-proxy-service.js` (CommonJS, follow existing service patterns)
  - [ ] 2.2 Implement `_resolveKeycloakUserId(arangoUserId)` — lookup user in ArangoDB by `_key` (preferred) or by `iss_sub` (fallback). Extract `sub` field (Keycloak UUID). All rewritten routes pass `req.user._key` for consistency. Keycloak Admin API requires the raw UUID from the `sub` field.
  - [ ] 2.3 Implement `getServiceAccountToken()` — client credentials grant to `KEYCLOAK_URL`/`realms/`/`KEYCLOAK_REALM`/`protocol/openid-connect/token` with `KEYCLOAK_PROXY_CLIENT_ID`/`KEYCLOAK_PROXY_CLIENT_SECRET`. Cache token, lazy refresh on 401.
  - [ ] 2.4 Implement `updateUser(arangoUserId, data)` — resolve Keycloak UUID, proxy to `PUT /admin/realms/{realm}/users/{uuid}` (admin context, service account token)
  - [ ] 2.5 Implement `assignRoles(arangoUserId, roleNames)` — resolve Keycloak UUID, fetch role representations from `GET /admin/realms/{realm}/roles/{name}`, proxy to `POST /admin/realms/{realm}/users/{uuid}/role-mappings/realm`
  - [ ] 2.6 Implement `deleteUser(arangoUserId)` — resolve Keycloak UUID, proxy to `DELETE /admin/realms/{realm}/users/{uuid}`. After successful deletion, set `deleted: true` on the ArangoDB record (defense-in-depth until Story 3-7 full cleanup).
  - [ ] 2.7 Implement `updateOwnProfile(accessToken, data)` — proxy to `PUT /realms/{realm}/account` using the user's own JWT Bearer token (self-service context, Keycloak enforces self-only)
  - [ ] 2.8 Implement `_mapKeycloakError(error)` — translate Keycloak HTTP errors (401, 403, 404, 409) to GENIE.AI error format (`{ success: false, message: ... }`)

- [ ] Task 3: Rewrite `PUT /:userId` — the most complex route (dual-purpose, line 670)
  - [ ] 3.1 **Admin path** (when `req.body.roles` is present — **array**, e.g. `['admin']`): check `req.body.roles` (NOT `req.body.role` — UserEditDialog sends `roles` array at line 476). Require admin (`requireAdmin` middleware or inline check). Validate roles against `['admin', 'user']` (lowercase, matching Keycloak realm roles). Translate to Keycloak role representations and delegate to `keycloak-proxy-service.assignRoles()`.
  - [ ] 3.2 **Admin path** (when `req.body.disabled` is present — **inverse boolean**): UserEditDialog sends `disabled: !enabled` (line 480). Delegate to `keycloak-proxy-service.updateUser({ enabled: !req.body.disabled })`. Remove ArangoDB write for `enabled`/`disabled` field.
  - [ ] 3.3 **Self-service path** (no `roles` and no `disabled` in body): enforce self-context with `req.params.userId === req.user._key` (NOT `req.user.iss_sub` — `:userId` param is ArangoDB `_key`, `req.user._key` is also ArangoDB `_key`). Extract JIT fields (email, name) from body → forward to `keycloak-proxy-service.updateOwnProfile()`. Pass remaining body to `user-profile-service.updateUserProfile()` which strips any residual JIT fields and writes only custom fields to ArangoDB. Single responsibility: route splits, service strips.
  - [ ] 3.4 Reject `roles`/`disabled`/`active`/`deleted` fields in self-service context with 400 (handled by `updateUserProfile()` stripping — these fields are silently ignored, not rejected). Route rejects `roles` only (admin-only field), other JIT fields are silently stripped by the service.
  - [ ] 3.5 Keep multipart/form-data support for file uploads (avatar, documents) — these go to ArangoDB only.

- [ ] Task 4: Rewrite remaining admin write routes in `user-routes.js`
  - [ ] 4.1 Remove `PUT /:userId/role` route (line 826) — dead route, no frontend caller. Role updates go through `PUT /:userId` (line 684 branch).
  - [ ] 4.2 Rewrite `PUT /email` (line 188) — self-service route (verified by `req.user.iss_sub` matching body userId at line 248). Delegate to `keycloak-proxy-service.updateUser({ email, emailVerified: false })` using the **service account** (exception to TD2: Keycloak Account API does not reliably support email changes). Keep password verification if required by current flow. Route resolves Keycloak UUID from `req.user._key` via `_resolveKeycloakUserId()`.
  - [ ] 4.3 Rewrite `POST /delete` (line 563) — self-service route (uses `req.user.iss_sub` at line 568). Delegate to `keycloak-proxy-service.deleteUser()` using the **service account** (exception to TD2: Keycloak Account API has no delete endpoint). After successful Keycloak deletion, set `deleted: true` on the ArangoDB record (defense-in-depth — blocks any stale session from accessing data). Full ArangoDB cleanup deferred to Story 3-7. Route resolves Keycloak UUID from `req.user._key` via `_resolveKeycloakUserId()`.
  - [ ] 4.4 Remove `POST /reset-data` route (line 460) — meaningless when JIT re-provisions from Keycloak
  - [ ] 4.5 Remove `POST /admin/users/:userId/resend-verification` route (line 930) — email managed by Keycloak
  - [ ] 4.6 Keep all read routes unchanged: `GET /:userId` (line 369), `GET /:userId/context` (line 405), `POST /admin/users/:userId/force-logout` (line 1030), `GET /debug-routes` (line 111)

- [ ] Task 5: Clean up `user-profile-service.js`
  - [ ] 5.1 Modify `updateUserProfile(userId, profileData, files)` — strip JIT-provisioned fields (`email`, `name`, `roles`, `enabled`, `disabled`, `active`, `deleted`) from `profileData` before writing to ArangoDB. Only write custom fields. Log warning if JIT fields are present (indicates caller bug).
  - [ ] 5.2 Remove `deleteUserAccountPermanently(userId)` (line 669) — deletion now proxied via keycloak-proxy-service
  - [ ] 5.3 Remove `resetUserData(userId)` (line 603) — route removed
  - [ ] 5.4 Remove `initiateEmailChange(userId, newEmail)` (line 218) — email change proxied to Keycloak
  - [ ] 5.5 Remove `sendVerificationEmail(user)` (line 903) — route removed
  - [ ] 5.6 Keep `getUserProfile()`, `searchUsers()`, `userExists()`, `isEmailAvailable()`, `isUsernameAvailable()`, `forceUserLogout()` (read-only + defense-in-depth)

- [ ] Task 6: Modify `UserEditDialog.vue` — remove dead references
  - [ ] 6.1 Remove `resendVerificationEmailAdmin` call (line 564) and surrounding verification button/method — route no longer exists
  - [ ] 6.2 Verify `updateProfile()` call (line 491) still works — it sends `{roles: ['admin'], disabled: false, settings}` to `PUT /:userId`, which will now proxy `roles` and `disabled` to Keycloak and `settings` to ArangoDB. **No frontend change needed** — the backend now correctly detects `roles` (array) and `disabled` (inverse boolean).
  - [ ] 6.3 Verify `forceUserLogout()` call (line 613) still works — route is kept
  - [ ] 6.4 Verify role names are lowercase (`['admin']`, `['user']`) — UserEditDialog line 476 already sends lowercase. The backend `allowedRoles` validation must match (`['admin', 'user']` not `['User', 'Admin', 'Manager']`).

- [ ] Task 7: Modify `AdminDashboard.vue`
  - [ ] 7.1 Add "Manage in Keycloak" link/button in user list row — `<a href="/auth/admin/genie/users/{keycloakUuid}" target="_blank">Manage in Keycloak</a>`. Note: need to expose Keycloak UUID in the user list data (currently only ArangoDB `_key` is available). Alternative: link to `/auth/admin/genie` (realm user list) and let admin search.
  - [ ] 7.2 Keep existing "Edit" button and UserEditDialog — backend now proxies to Keycloak transparently

- [ ] Task 8: Verify remaining frontend components (minimal changes expected)
  - [ ] 8.1 `UserProfileComponent.vue` — all 8 tabs are custom fields (not JIT-provisioned), `confirmSave()` calls `updateProfile()` which goes to `PUT /:userId`. Since only custom fields are sent, no changes needed. Verify.
  - [ ] 8.2 `UserProfileContainer.vue` — calls `createProfile()` (line 104) and `updateProfile()` (line 109). No role/JIT fields involved. Verify.
  - [ ] 8.3 `userService.js` — remove `deactivateAccount()` (line 294) and `reactivateAccount()` (line 310) — dead code, no backend routes exist. Remove `resendVerificationEmailAdmin()` (line 587) — route removed.
  - [ ] 8.4 `userProfileService.js` — remove `updateUserRole()` (line 191) and `updateRoleOnly()` (line 221) — dead code, no frontend callers (verified: no .vue file calls these methods). Remove `deleteProfile()` (line 106) — dead code, calls `DELETE /users/:userId` which has no backend route.

- [ ] Task 9: Update Swagger/OpenAPI documentation
  - [ ] 9.1 Update Swagger JSDoc annotations for rewritten routes (`PUT /:userId`, `PUT /email`, `POST /delete`) to reflect Keycloak proxy behavior (new error codes, changed request/response formats)
  - [ ] 9.2 Remove Swagger JSDoc annotations for deleted routes (`PUT /:userId/role`, `POST /reset-data`, `POST /admin/users/:userId/resend-verification`)

- [ ] Task 10: Clean up and write tests
  - [ ] 10.1 Create `components/gov-chat-backend/__tests__/keycloak-proxy-service.test.js` — unit tests with mocked HTTP (fetch/axios):
    - `getServiceAccountToken()` — token acquisition, caching, lazy refresh on 401
    - `_resolveKeycloakUserId()` — ArangoDB lookup by `_key` and `iss_sub`, sub field extraction, error on not found
    - `updateUser()` — proxy to Keycloak, error mapping
    - `assignRoles()` — role name to representation (lowercase), proxy to Keycloak
    - `deleteUser()` — proxy to Keycloak, defensive `deleted: true` on ArangoDB
    - `updateOwnProfile()` — proxy with user's own token
    - `_mapKeycloakError()` — 401, 403, 404, 409 → GENIE.AI format
  - [ ] 10.2 Remove/update tests for deleted routes (`POST /reset-data`, `POST /admin/users/:userId/resend-verification`, `PUT /:userId/role`) in existing test files
  - [ ] 10.3 Update route tests for rewritten routes — mock `keycloak-proxy-service` instead of ArangoDB writes
  - [ ] 10.4 Update `user-profile-service.test.js` — verify `updateUserProfile()` strips JIT fields
  - [ ] 10.5 Remove dead code tests from `userService.test.js` (`deactivateAccount`, `reactivateAccount`, `resendVerificationEmailAdmin`) and `userProfileService.test.js` (`updateUserRole`, `updateRoleOnly`)
  - [ ] 10.6 Verify all remaining tests pass

### Acceptance Criteria

1. **AC1 — Admin user operations proxied to Keycloak:**
   **Given** the GENIE.AI backend is running
   **When** an admin modifies a user's role via `PUT /api/users/:userId` (with `roles` array in body)
   **Then** the operation is forwarded to Keycloak Admin API via the `genie-proxy-client` service account
   **And** the change takes effect in Keycloak immediately
   **And** the change is reflected in ArangoDB on the user's next login (via JIT provisioning)
   **Note** The old `PUT /api/users/:userId/role` route is removed (dead code, no frontend caller)

2. **AC2 — Admin enable/disable proxied to Keycloak:**
   **Given** the GENIE.AI backend is running
   **When** an admin enables or disables a user via UserEditDialog (sends `disabled` field — inverse boolean — to `PUT /:userId`)
   **Then** the operation is forwarded to Keycloak Admin API `updateUser({enabled: !disabled})`
   **And** the `disabled` field is NOT written to ArangoDB (it's a Keycloak-only concern)

3. **AC3 — Self-service email change proxied to Keycloak:**
   **Given** the GENIE.AI backend is running
   **When** a user changes their own email via `PUT /api/users/email` (self-service route — verified by `req.user.iss_sub` matching body userId)
   **Then** the operation is forwarded to Keycloak Admin API `updateUser({email: ...})` using the service account
   **And** the email is NOT written to ArangoDB directly (JIT provisioning will update it on next login)
   **Note** This uses the service account (not user's own JWT) because Keycloak Account API (`PUT /realms/{realm}/account`) does not reliably support email changes, and the Admin API allows setting `emailVerified` directly

4. **AC4 — Self-service account deletion proxied to Keycloak:**
   **Given** the GENIE.AI backend is running
   **When** a user deletes their own account via `POST /api/users/delete` (self-service route — uses `req.user.iss_sub`)
   **Then** the operation is forwarded to Keycloak Admin API `deleteUser()` using the service account
   **And** the user cannot obtain new tokens from Keycloak
   **And** `deleted: true` is set on the ArangoDB record (defense-in-depth until Story 3-7)
   **Note** This uses the service account because Keycloak Account API has no delete endpoint

5. **AC5 — Self-service profile editing (split):**
   **Given** a user is logged in and accesses their profile via `PUT /api/users/:userId` (no `roles` in body)
   **When** they edit JIT-provisioned fields (email, name)
   **Then** the changes are forwarded to Keycloak Account API `PUT /realms/{realm}/account` using the user's own JWT token
   **When** they edit custom fields (personalIdentification, theme, notification preferences)
   **Then** the changes are saved directly to ArangoDB (JIT fields stripped before write)
   **And** all changes persist correctly across login sessions

6. **AC6 — Self-context enforcement on profile update:**
   **Given** the GENIE.AI backend is running
   **When** user A attempts to update user B's profile via `PUT /api/users/:userId` (self-service path)
   **Then** the request returns 403 (Forbidden) — check: `req.params.userId !== req.user._key`
   **When** user A updates their own profile via `PUT /api/users/:userId` (self-service path)
   **Then** the update succeeds with 200 — `req.params.userId === req.user._key`

7. **AC7 — Admin UI works transparently with Keycloak proxy:**
   **Given** the GENIE.AI frontend admin dashboard is displayed
   **When** an admin uses UserEditDialog to toggle roles (sends `roles: ['admin']` array) or enable/disable (sends `disabled: true/false` inverse boolean)
   **Then** the operation succeeds via the Keycloak proxy backend (same API, different backend behavior)
   **And** a "Manage in Keycloak" link is available as a fallback to the Keycloak admin console

8. **AC8 — Read-only operations unchanged:**
   **Given** the GENIE.AI backend is running
   **When** an admin requests user listing, user search, or user statistics
   **Then** the data is returned successfully from ArangoDB (unchanged behavior)
   **And** `GET /api/users/:userId/context` (OPEA) and `POST /admin/users/:userId/force-logout` still function

9. **AC9 — Removed routes return 404:**
   **Given** the GENIE.AI backend is running
   **When** `POST /api/users/reset-data` or `POST /api/users/admin/users/:userId/resend-verification` is called
   **Then** the endpoint returns 404

10. **AC10 — Restricted service account permissions:**
    **Given** the GENIE.AI backend is running
    **When** the `genie-proxy-client` service account is used for Keycloak API calls
    **Then** it can manage users and roles (CRUD, assign/remove)
    **And** it CANNOT modify realm settings, client configuration, or perform other admin-level operations
    **And** superadmin credentials (`KEYCLOAK_ADMIN_USERNAME`/`KEYCLOAK_ADMIN_PASSWORD`) are not used at runtime

11. **AC11 — ArangoDB `_key` to Keycloak UUID mapping works:**
    **Given** a user exists in both ArangoDB and Keycloak
    **When** an admin operation targets a user via ArangoDB `_key` (as `:userId` parameter)
    **Then** the service resolves the Keycloak UUID from the ArangoDB `sub` field
    **And** the Keycloak Admin API call uses the correct UUID
    **When** the ArangoDB user is not found
    **Then** the service returns 404 with a clear error message

12. **AC12 — All tests pass:**
    **Given** the implementation is complete
    **When** the full test suite is run
    **Then** all tests pass with no failures

## Additional Context

### Dependencies

- **Keycloak admin console** must be accessible at `/auth/admin` for the "Manage in Keycloak" link
- **Story 3-4** (External IdP attribute mapping) — docs only, no code dependency but same worktree
- **Story 3-6** (JIT profile updates, renamed from old 3-5) — will benefit from the Keycloak Admin API proxy layer
- **Story 3-7** (Right to erasure, renamed from old 3-6) — account deletion via Keycloak + ArangoDB data cleanup, builds on the proxy layer

### Testing Strategy

- **New test file:** `keycloak-proxy-service.test.js` — unit tests with mocked HTTP (fetch), cover all public methods, token caching, error mapping, UUID resolution
- **Updated test files:** Route tests mock `keycloak-proxy-service` instead of ArangoDB writes for admin operations
- **Updated:** `user-profile-service.test.js` — verify `updateUserProfile()` strips JIT fields
- **Removed:** Tests for deleted routes (`POST /reset-data`, `POST /admin/users/:userId/resend-verification`), dead code methods (`deactivateAccount`, `reactivateAccount`)
- **Manual verification:** Confirm admin UI operations (enable/disable, role toggle) work via Keycloak proxy end-to-end

### Keycloak API Endpoints Reference

| Operation | HTTP Method | Endpoint | Auth Mode |
|---|---|---|---|
| Get service account token | POST | `/realms/{realm}/protocol/openid-connect/token` | client_credentials grant |
| Update user (admin) | PUT | `/admin/realms/{realm}/users/{uuid}` | Service account Bearer |
| Assign roles | POST | `/admin/realms/{realm}/users/{uuid}/role-mappings/realm` | Service account Bearer |
| Remove roles | DELETE | `/admin/realms/{realm}/users/{uuid}/role-mappings/realm` | Service account Bearer |
| Get role representation | GET | `/admin/realms/{realm}/roles/{role-name}` | Service account Bearer |
| Delete user | DELETE | `/admin/realms/{realm}/users/{uuid}` | Service account Bearer |
| Update own profile | PUT | `/realms/{realm}/account` | User's own Bearer token |

### High-Risk Items

1. **ArangoDB `_key` → Keycloak UUID mapping** — Every admin proxy call requires this lookup. If the user exists in Keycloak but not ArangoDB (or vice versa), operations will fail. The `_resolveKeycloakUserId()` method must handle these edge cases gracefully.

2. **Role name format mismatch** — Current ArangoDB `allowedRoles` validation: `['User', 'Admin', 'Manager']`. Keycloak realm roles: `['admin', 'user']`. The `assignRoles()` method must use lowercase names matching Keycloak. **Task 3.1 fixes this** by updating `allowedRoles` to `['admin', 'user']` (lowercase). The `Manager` role does not exist in Keycloak — if needed, it must be added to `genie-realm.yaml` first. UserEditDialog already sends lowercase (`['admin']`, `['user']`) at line 476.

3. **Keycloak Account API limitations** — The self-service `PUT /realms/{realm}/account` endpoint may not support all fields (e.g., email change may require verification). Need to verify Keycloak's behavior at runtime.

4. **Service account token lifecycle** — If the service account token expires mid-request or is invalidated, the lazy refresh mechanism must handle this without exposing errors to the user.

### Known Limitations

- **Orphaned ArangoDB records after deletion** — When a user is deleted via Keycloak proxy (Story 3-5), the ArangoDB record has `deleted: true` set (defense-in-depth) but full data cleanup is deferred to Story 3-7. The user cannot log in (Keycloak rejects), and the `deleted: true` flag ensures the auth middleware also blocks access.
- **No Keycloak session revocation** — `POST /admin/users/:userId/force-logout` clears ArangoDB tokens but does NOT revoke the Keycloak session. The user's JWT remains valid until expiry. This is a known limitation documented in the force-logout route.
- **"Manage in Keycloak" link** — Links to `/auth/admin/genie` (realm user list) rather than specific user, because the Keycloak UUID is not exposed in the admin user list API. Admin must search for the user in Keycloak console.

### Future Considerations (Out of Scope)

- **Account deletion with ArangoDB cleanup** — Story 3-7 (Right to Erasure) will implement full data removal from both Keycloak and ArangoDB
- **Keycloak session revocation** — Could be added by calling Keycloak Admin API `DELETE /admin/realms/{realm}/users/{uuid}/sessions` alongside ArangoDB token clearing
- **Keycloak event logging** — Enable Keycloak events for audit trail of admin operations
- **Batch operations** — Currently not needed; could be added later for bulk user management
