# Epic A — Auth convergence (full upstream v2.0.1 port, legacy deleted)

Reference: [sprint/reference/genieai-v201.md §Authentication](../reference/genieai-v201.md).
Cluster order matters: realm (A2) → gateway (A3) → frontend/backend (A4∥A5) → provisioning (A6) → cleanups (A7/A8).

## A1 — Upstream auth recon → reference §Auth
Fill [sprint/reference/genieai-v201.md](../reference/genieai-v201.md) §Authentication to completion:
exact upstream path + local target path + port note for each of the 12 gaps.
**AC:** every gap row has upstream path + local path + note; no code.
**Gate:** map review. **DECIDE:** none.
12 gaps: ① legacy signin deletion ② oidc-client-ts frontend ③ Vuex module ④ /callback route
⑤ httpService 401→silent-renew ⑥ backend jose verifier + discovery + JWKS forceRefresh
⑦ JIT provisioning service + iss_sub ⑧ realm-as-code + config-cli ⑨ gateway root-context flip
⑩ runtime config.js ⑪ themes (optional, DEC-5) ⑫ cleanups (GET_AUTH_TOKEN_URL,
KEYCLOAK_PUBLIC_KEY, dead kong routes, IDP_HINT).

## A2 — Realm-as-code
`configs/keycloak/genie-realm.yaml` (keycloak-config-cli format, `$(env:)` substitution)
replacing `configs/keycloak/agrivisory-realm.json`; sidecar (`Dockerfile.config-cli` +
`config-and-sleep.sh`) + `keycloak-config` compose service; Keycloak → root context (drop
`--import-realm`, `KC_HTTP_RELATIVE_PATH=/auth`); realm content: knobs, roles
(`admin` composite + `dataprep-service`), admin user from env, SPA client (public, PKCE S256,
`directAccessGrantsEnabled:false`, redirectUris `$(env:KC_PUBLIC_ORIGIN)/*`),
`genie-proxy-client` + `dataprep-service-client` (secrets from vault), mobile + grafana
clients, SMTP, i18n, token lifespan, `rememberMe: true` env-knobbed (DEC-12: deliberate
upstream divergence).
**AC:** given env vars; when config-cli runs; then realm exists with env-derived redirects;
`grep -r localhost configs/keycloak` = 0; compose config shows sidecar.
**Gate:** compose config both modes + ansible env render + live smoke (keycloak up, config-cli
exit 0, realm GET shows clients). **DECIDE:** DEC-2 (IdP brokering), DEC-4 (lifespans), DEC-5 (themes).

## A3 — Gateway / root-context flip
kong_config.json (MOUNTED file) `keycloak-route` → `strip_path:true` (keep X-Forwarded-Prefix);
repoint internal consumers to `KEYCLOAK_INTERNAL_URL=http://keycloak:8080` (no /auth) as
upstream defaults — backend (:512), dataprep-arango-service (:1090),
chatqna-xeon-backend-server (:1308), **and grafana's direct token/userinfo URLs
(:1795-1796, added to scope by A2 review)**; delete dead kong
`auth-login-route`/`auth-refresh-route`.
**AC:** `https://<domain>/auth/realms/agrivisory/.well-known/openid-configuration` → 200 via front
door; issuer matches public origin; no double /auth. *(A1 sweep correction: public path keeps
`/auth` — kong strips it, X-Forwarded-Prefix re-emits it; a root-level `/realms` path matches
no kong route. See test-artifacts/auth-port-sweep.md.)*
**Gate:** compose config + live front-door. **DECIDE:** none.

## A4 — Frontend swap
Add `oidc-client-ts` + `jwt-decode`; new thin service (UserManager, PKCE, automaticSilentRenew,
silent-renew-error→login, id_token_hint logout) replacing `keycloakAuthService.js` (462L) +
`authService.js`; Vuex `auth.js` → OIDC state (`iss_sub`, roles from claims, `isInitialized`,
structured auth errors); `/callback` route + CallbackView (returnUrl via OIDC state);
**runtime `public/config.js`** via docker-entrypoint envsubst replacing VUE_APP_* build baking
(Dockerfile ARG removal, compose env change, entrypoint script).
**AC:** unauthenticated open → Keycloak redirect → login → callback → authenticated; token in
memory (localStorage clean); silent renew before expiry; 401 → signinSilent retry once.
**Gate:** frontend suite (grows) + new oidc unit tests + manual round-trip on compose.
**DECIDE:** DEC-3 (registration/reset links under runtime config).

## A5 — Backend verifier + middleware convergence
Port upstream `keycloak-auth-service.js` (jose, lazy discovery singleton, createJwksCache
5-min TTL + forceRefresh 2-attempt, error contract `TOKEN_EXPIRED|TOKEN_INVALID|FORBIDDEN|
PROVISIONING_FAILED`, UserInfo probe on expired → mark deleted) + single middleware
(`req.user` + `req.claims`, requireAdmin from claims, PUBLIC_PATHS). Delete dual-alg
`auth-middleware.js`, `keycloak-auth-routes.js` (password-grant proxy), `auth-service.js`,
legacy auth-routes paths. Identity key `keycloakId` → `iss_sub` (+ Arango migration + unique
index; note migration 002 already has a dead `iss_sub` index to adopt).
**AC:** realm token → 200 with `{sub, iss_sub, roles}`; garbage/expired → 401 standard codes,
no fallback; simulated JWKS rotation → forceRefresh recovers; `grep -r keycloakId
components/gov-chat-backend` = 0.
**Gate:** backend suite (grows) + verifier unit tests (mock JWKS). **DECIDE:** none.

## A6 — JIT provisioning service
Port `user-provisioning-service.js` + `constants/jit-fields.js`: atomic UPSERT on `iss_sub`,
60s cache + in-flight locks, legacy-email migration, reactivation; Pending/approval flow kept
(product feature); admin-notify email kept.
**AC:** first valid token → user row (Pending); concurrent first requests → single row;
approval → role applied next token. *(A4 review addition: A6 also owns the frontend
/pending-approval navigation trigger — its only prior home was deleted LoginScreen;
see deferred-work.md. A5 review additions: A6 also owns — the email-change flow
(Account-API proxy or strip of the dead pending-token link), real force-logout
revocation via the proxy service, Pending-account gating on protected routes, and
admin-notify/Pending re-integration per the spec boundary.)*
**Gate:** backend suite + provisioning concurrency unit test. **DECIDE:** DEC-6 sign-off before merge.

## A7 — Auth cleanups
Remove: `GET_AUTH_TOKEN_URL` refs (chatqna/dataprep/compose/env.j2), `KEYCLOAK_PUBLIC_KEY`
(compose/env/vars/doc-repo), `VUE_APP_KEYCLOAK_IDP_HINT`, http-service sidecar
(`legacy-auth` profile + `genie-ai-overlay/http-service/` + compose block).
**AC:** grep each symbol across components/deploy/configs/compose = 0 hits.
A6-review additions to the sweep: dead frontend auth-era service methods (`updateEmail`'s
password/userId params, `verifyUserEmail`, non-admin `resendVerificationEmail`,
`getAccountStatus` — zero .vue consumers, routes gone/nonexistent) + stale `dist/` bundle;
scrub the pre-existing plaintext `EMAIL_PASSWORD` in committed `components/gov-chat-backend/env`
to CHANGE_ME (real fix stays DEC-10 rotation).
**Gate:** overlay pytest 648 (untouched canary) + compose config. **DECIDE:** DEC-7, DEC-8.

## A8 — Mobile impact audit
Audit `mobile/` auth path (expect Keycloak AppAuth direct → unaffected). Document findings in
this file + DEC-7 entry.
**AC:** plan.md DEC-7 has exact broken symbols or "no impact" verdict with grep evidence.
**Gate:** review. **DECIDE:** DEC-7 outcome.

### A8 findings (2026-09-27 — verdict: BROKEN, follow-up fix, not a deploy blocker)
The expected "Keycloak AppAuth direct → unaffected" was WRONG: mobile is a live, maintained
Flutter app (`mobile/genie_ai_mobile`, recent commits: icons/i18n/gradle) that was **never
migrated to Keycloak** — it still speaks the deleted legacy local-credential protocol:
- `api_service.dart:10` — hardcoded `https://genie-ai.itu.int/api` base (stale external host),
  Bearer-if-set header; token in memory only; no OIDC lib, no discovery, no PKCE, no client-id.
- Legacy protocol callers (all endpoints deleted in A5/A7, none in PUBLIC_PATHS → 401
  TOKEN_INVALID before any 404): `auth_proxy.dart` (:10 auth/login {loginName,encPassword},
  :27 auth/refresh-token, :43 auth/logout, :49 auth/me, :55 auth/reset-password, :61
  auth/verify-email/:token); `user_service.dart` (:20 login, :37 logout, :47 auth/me, :114
  auth/register encPassword); `password_proxy.dart` (:9,:15,:22,:32 reset-password* +
  change-password); `user_proxy.dart:9` auth/register. Screens: login/register/
  password-reset-initiate (`lib/components/auth/`).
- Blast radius: the app cannot obtain a realm JWT, so EVERY gated route it calls is dead too —
  queries, chat/conversations, admin/*, analytics, weather, translate, services, files/*
  (doc-repo gated equally). No guest path exists (PUBLIC_PATHS = health/docs/callbacks only).
  No mobile handling of 403 ACCOUNT_PENDING/FORBIDDEN (one generic login-error string).
- Sessions: mobile never calls POST /api/sessions (grep 0) — the A5 iss_sub-binding contract
  change costs mobile nothing; zero migration debt there.
- Realm side is READY for the fix that doesn't exist yet: `genie-realm.yaml:176-194` mobile
  client (public, standard-flow + PKCE S256 only, `$(env:KC_MOBILE_REDIRECT_SCHEME)://callback`).
  Doc gap: that yaml points to mobile's README as "deployment guide", but the README still
  advertises legacy login/registration/password-reset and mentions no Keycloak env vars.
- Follow-up fix (DEC-7 branch "log known break + follow-up fix"): mobile Keycloak migration —
  flutter_appauth (auth-code + PKCE S256, custom scheme), secure token storage, 401→silent-
  refresh interceptor, ACCOUNT_PENDING/FORBIDDEN screens fed by GET /api/me, baseUrl from
  build config. Filed in deferred-work.md + plan.md §Follow-ups. NOT a deploy blocker
  (DEC-7: mobile not confirmed actively used).
