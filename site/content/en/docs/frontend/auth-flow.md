---
title: "Auth Flow"
description: "End-to-end Keycloak OIDC sequence in the web frontend — login redirect, callback, in-memory tokens, silent renew, and the genie_post_logout flag."
weight: 4
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

> **For frontend developers and operators.** The full OIDC sequence from "user clicks Sign in" through token rotation to logout, including the in-memory token policy and the post-logout re-auth block.

## Prerequisites

- Keycloak realm `genie` is reachable at the URL the frontend is configured to use (see [Configuration](#configuration)).
- The OIDC client `genie-app` is enabled in that realm with the standard authorization-code flow + `openid profile email roles` scope.
- For local development: `cp env .env` at the repo root and fill in `KEYCLOAK_*` values, then bring up the stack with `docker compose up -d keycloak kong backend frontend`.

## Overview

The web frontend authenticates against Keycloak using [oidc-client-ts](https://github.com/authts/oidc-client-ts)'s `UserManager`. The configuration wrapper lives at `src/services/keycloakAuthService.js`; the Vuex glue is at `src/store/modules/auth.js`. Three properties define the contract:

1. **Tokens are in-memory only.** They never touch `localStorage`, `sessionStorage`, or cookies. Silent renew uses an iframe against Keycloak's session cookie (browser-controlled, HttpOnly).
2. **There is a `genie_post_logout` session flag.** Once set, the app refuses to silently re-authenticate until the user explicitly logs back in. This prevents the silent-renew iframe from resurrecting a session the user just terminated.
3. **The OIDC config is hierarchical.** `window.APP_CONFIG.keycloak` (runtime) wins over `VUE_APP_KEYCLOAK_*` (build-time) which wins over hardcoded localhost defaults.

## Configuration

`src/config/oidcConfig.js` resolves the OIDC client settings in this order:

| Source | Used for | Example |
|--------|----------|---------|
| `window.APP_CONFIG.keycloak.*` (runtime-injected from `/config/genie-ai-config.json`) | Everything | `{ "keycloak": { "url": "https://kc.example.org/auth", "realm": "genie", "client_id": "genie-app" } }` |
| `process.env.VUE_APP_KEYCLOAK_URL` / `VUE_APP_KEYCLOAK_CLIENT_ID` (build-time) | URL and client_id only | Set in `env` / `.env` and baked into the image at build. |
| Built-in defaults | URL only | Falls back to `${origin}/auth` then `http://localhost:8080` for dev. |

Final config returned to `oidc-client-ts`:

```javascript
{
  authority: `${keycloakUrl}/realms/${realm}`,   // e.g. https://kc.example.org/auth/realms/genie
  client_id: 'genie-app',
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid profile email roles',
  automaticSilentRenew: true,
  storeAuthStateInCookie: false,
  // realm is fixed at 'genie' — see oidcConfig.js for the override order
}
```

> `automaticSilentRenew: true` means `oidc-client-ts` opens a hidden iframe against Keycloak's session cookie to rotate the access token before it expires. The iframe relies on Keycloak's first-party cookie being present — it does **not** store anything itself.

## Login sequence

```
[ User clicks "Sign in" ]
         │
         ▼
Router guard (src/router/index.js) — routes with meta.requiresAuth=true
         │  if no currentUser → router.push('/login')
         ▼
[ LoginView dispatches auth/login({ returnUrl }) ]
         │
         ▼
auth.js → keycloakAuthService.login(options)
         │  sessionStorage.removeItem('genie_post_logout')   ← clears any prior logout block
         ▼
oidc-client-ts → keycloakAuthService.getUserManager().signinRedirect({ state: { returnUrl } })
         │
         ▼
[ Browser navigates to Keycloak login page ]
         │
         ▼
User authenticates (username + password, MFA, IdP redirect, ...)
         │
         ▼
[ Keycloak redirects browser to {origin}/callback?code=...&state=... ]
         │
         ▼
[ CallbackView mounts → CallbackView dispatches auth/handleCallback (`this.$store.dispatch('handleCallback')`) ]
         │
         ▼
auth.js → keycloakAuthService.handleCallback()
         │  sessionStorage.removeItem('genie_post_logout')   ← again, for new sessions
         │  userManager.signinRedirectCallback() — exchanges code for tokens (in-memory only)
         │  if user returned → commit('setAuth', { isAuthenticated: true, user, accessToken })
         │  registerAccessTokenUpdatedCallback — silent renew path
         ▼
[ App.vue v-else-if guards become true → authenticated shell renders ]
         │
         ▼
[ Router pushes to returnUrl from the state, or /dashboard ]
```

The `returnUrl` flow: the router guard stores `route.fullPath` in the state passed to `signinRedirect`. After the callback, the auth store reads it back via `keycloakAuthService` and pushes the user to their original destination. If the state is missing or invalid, `/dashboard` is used.

## Callback handling

`/callback` is registered in the router with `meta.requiresAuth: false` so the page is reachable while unauthenticated. The handler is intentionally small — `dispatch('handleCallback')` does the work.

```
Route: /callback
  ↓
CallbackView mounts
  ↓
store.dispatch('handleCallback')
  ↓
on success → router.replace(returnUrl ?? '/dashboard')
on failure → router.replace('/')
```

The callback is also where the `setInitialized` mutation fires (via the `try / finally` in `auth.initialize`). The store is treated as bootstrapped after the first callback attempt — even on failure — so components don't loop on a half-initialised auth state.

## Token storage policy

| Token | Where | Why |
|-------|-------|-----|
| Access token | `keycloakAuthService.currentUser.access_token` (in-memory only) | XSS exposure: a stolen access token is short-lived (5 min by default) and limited to the API scopes. |
| ID token | Same `currentUser` object (in-memory) | Never persisted. |
| Refresh token | Same `currentUser` object (in-memory); rotated by Keycloak on every silent renew | RFC 6749 §10.4 — refresh tokens for SPAs SHOULD be sender-constrained or rotated; we rotate. |
| Session cookie (Keycloak) | Browser-managed, HttpOnly | Set by Keycloak on the auth flow; the silent-renew iframe uses it. |
| OIDC state / nonce | `oidc-client-ts` in-memory store (`storeAuthStateInCookie: false`) | Not persisted. |

What the Vuex store exposes:

```javascript
computed: {
  ...mapGetters(['isAuthenticated', 'currentUser', 'accessToken', 'isAuthInitialized'])
}
```

`currentUser` is the profile projection from `mapOidcUserToState` (`store/modules/auth.js:11-33`): it strips the noisy `default-roles-*`, `offline_access`, and `uma_authorization` roles and exposes `{ sub, iss, email, name, preferred_username, roles, iss_sub }`.

## Silent renew

`automaticSilentRenew: true` causes `oidc-client-ts` to schedule a renewal ~60 s before access-token expiry. It opens a hidden iframe to Keycloak's `/realms/{realm}/protocol/openid-connect/auth` endpoint with `prompt=none`. If Keycloak's session is still alive, the iframe completes the flow, `oidc-client-ts` swaps the new tokens into memory, and emits `userLoaded`.

The auth store listens via:

```javascript
silentRenewCallback = (refreshedUser) => {
  const updatedUser = mapOidcUserToState(refreshedUser);
  if (updatedUser) {
    commit('updateAccessToken', { accessToken: refreshedUser.access_token, user: updatedUser });
  }
};
keycloakAuthService.onAccessTokenUpdated(silentRenewCallback);
```

If Keycloak reports `session lost` or the iframe times out, `oidc-client-ts` fires `addSilentRenewError` and the service triggers `login()` — i.e. full redirect to the Keycloak login page. The auth store does not override this; the user just sees the login screen.

## Logout sequence

```
[ User clicks "Log out" ]
         │
         ▼
App.vue emits @logout → dispatch('logout')
         │
         ▼
auth.js:
  1. commit('clearError')
  2. localStorage.removeItem('user')         ← legacy cleanup (pre-OIDC)
  3. localStorage.removeItem('auth_token')   ← legacy cleanup (pre-OIDC)
  4. sessionStorage.setItem('genie_post_logout', 'true')   ← the block flag
  5. removeAccessTokenUpdatedCallback       ← detach silent renew
  6. keycloakAuthService.logout()
         │
         ▼
oidc-client-ts → signoutRedirect({ id_token_hint }) → Keycloak session terminated
         │
         ▼
[ Browser redirects to origin / Keycloak end-session endpoint completes ]
         │
         ▼
commit('clearAuth')                           ← runs even if redirect throws (try/catch)
```

The `try/catch` around the redirect matters: `signoutRedirect` navigates away from the page, so the `commit('clearAuth')` after it may not execute. The `catch` branch guarantees the local state is cleared even if the redirect itself fails.

### The `genie_post_logout` block

Setting `sessionStorage.genie_post_logout = 'true'` is what prevents the silent-renew iframe from re-authenticating the user right after they logged out. The flow:

1. User clicks Log out → flag is set → Keycloak redirect → local session cleared.
2. Some time later, `auth.initialize` runs (e.g. on a fresh tab that opens `/callback`).
3. The first thing `initialize` does:
   ```javascript
   if (sessionStorage.getItem('genie_post_logout')) {
     commit('clearAuth');
     commit('setInitialized');
     return;
   }
   ```
4. The user stays logged out — no silent iframe, no token refresh, no `oidc-client-ts` work.
5. When the user explicitly clicks Sign in, `auth.login` removes the flag:
   ```javascript
   sessionStorage.removeItem('genie_post_logout');
   ```
6. The callback also removes the flag (so a fresh successful auth always allows subsequent auto-restore).

> The flag is in `sessionStorage` (not `localStorage`) on purpose: clearing browser tabs wipes it. That is acceptable because the user's intent is also gone.

## Failure modes & troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Stuck on `/callback` after Keycloak redirects | `redirect_uri` mismatch — Keycloak expects `https://app.example.org/callback` but the frontend is hosted at `https://app.example.org/anything/else/callback` | Check the `Valid Redirect URIs` list in the Keycloak client config. For sub-paths, the deployment must use HashRouter or a catch-all rewrite. |
| Login loops — keeps redirecting back to Keycloak | `state` parameter missing or invalid. Often: `automaticSilentRenew` error fired too early. | Inspect browser DevTools → Application → Cookies — Keycloak session cookie should still be present. If it's gone, the silent renew legitimately failed; that's expected. |
| Silent renew fires but user gets bounced to login anyway | Keycloak session cookie expired or was cleared. | Re-login is the correct behaviour. Nothing to fix. |
| `Error: User is missing` from `chatHistory.moveChat` | `currentUser` getter returned `undefined` — usually means `auth.initialize` hasn't run yet, or the user is on the login page. | Make sure the call site is inside a `v-if="currentUser"` guard or behind a route guard. |
| `INVALID_NONCE` or `invalid_state` errors | `oidc-client-ts` state store was cleared (private browsing, aggressive cookie policy). | Verify `storeAuthStateInCookie: false` matches your deployment's cookie policy. For some embed scenarios (e.g. inside an iframe with third-party cookies blocked), flip to `true`. |
| Logout returns to app but `isAuthenticated` is still `true` | `commit('clearAuth')` didn't run because `signoutRedirect` succeeded but then the user came back via the iframe before `clearAuth` could fire. | The next `setAuth` / `setInitialized` cycle will reconcile. If reproducible, manually reload the page after logout. |
| Expanding back-channel logout (RFC 8962) | Out of scope of the current implementation. | Use front-channel logout redirect (which is what we do). For back-channel, add a `backchannel_logout_uri` to the Keycloak client and a `/logout/backchannel` endpoint to the BFF. |

## Programmatic API

```javascript
// In a Vue component
import { mapActions, mapGetters } from 'vuex';

export default {
  computed: {
    ...mapGetters(['isAuthenticated', 'currentUser', 'isAuthInitialized'])
  },
  methods: {
    ...mapActions(['login', 'logout']),

    signIn() {
      this.login({ returnUrl: this.$route.fullPath });
    },
    signOut() {
      this.logout();
    }
  }
};
```

For deep programmatic access (e.g. refreshing a token manually), use the service directly:

```javascript
import keycloakAuthService from '@/services/keycloakAuthService';

const token = await keycloakAuthService.getAccessToken();      // null if expired/invalid
const claims = keycloakAuthService.getAccessTokenClaims();     // decoded JWT payload
```

## Related

- [State Management](/docs/frontend/state-management-frontend/) — the `auth` Vuex module that consumes this service.
- [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) — server-side configuration of the realm and the `genie-app` client.
- [External IdP Integration](/docs/configure/external-idp-integration-guide/) — federating external identity providers.
- [Deployment: Docker Compose](/docs/deploy/docker-compose-setup/) — running the stack with `KEYCLOAK_*` env vars.
