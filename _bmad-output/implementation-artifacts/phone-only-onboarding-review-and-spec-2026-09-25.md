# Email-Less, Phone-Only Onboarding with SMS/WhatsApp OTP — Recommended Approach, Security Baseline & Pre-Flight Plan

| | |
|---|---|
| **Date** | 2026-09-25 |
| **Branch** | `climate_polisense_2-1` (HEAD `9f67b4807`) |
| **Baseline for origin attribution** | `v2.0.0` (upstream GENIE.AI, tagged 2026-07-28) |
| **Pilot context** | MEWA Bangladesh (single-host GPU deployment, farmers as end users) |
| **Method** | Full review of backend auth stack, Vue web app, Flutter mobile app, Keycloak realm/theme config, Kong/NGINX edge and compose deployment; per-item git attribution against `v2.0.0`. Key claims were independently re-verified (PKCE plugin code, route guards, committed tokens, realm flags). |

---

## 1. Executive summary

1. **The platform is well positioned for phone-only onboarding — the hard parts are already built.** The backend keys users by `iss#sub` (never email), JIT provisioning tolerates a null email, no route requires an email address, and the realm is fully env-driven through the existing `keycloak-config-cli` pipeline and custom Keycloak image build. The notification stack the team delivered (FCM device registry, broadcast fan-out with fail-closed shared-secret auth) and the provider-seam pattern in the warning engine (`notifier.py`, tier-3 SMS / tier-4 voice) establish exactly the integration style an OTP sender needs. This document defines the last mile: the Keycloak flow for **phone-number-only registration with SMS/WhatsApp OTP**, staged so the pilot is never blocked on a gateway contract.
2. **Current state in this branch:** onboarding configuration remains email-centric in Keycloak (registration form requires an email; password recovery is email-based; login theme is English-only; the mobile app requests the OIDC `email` scope). None of these require code changes to fix — they are realm configuration and small, scoped app/theme changes.
3. **Recommended path (§3):** a three-stage rollout inside the existing Keycloak stack, built exclusively from open-source components — **Stage 0** (config-only, available immediately): provisioned phone-username accounts with forced first-login password change; **Stage 1**: OTP-based self-service registration and password reset via an open-source Keycloak authenticator extension with a pluggable SMS/WhatsApp sender; **Stage 2**: channel preference, step-up authentication and anti-fraud hardening. The OTP stack itself is self-hosted open source; message delivery goes through a standard SMS gateway and, for the WhatsApp channel, the WhatsApp Business API — no managed OTP or verification SaaS is required.
4. **Pre-flight security recommendations (§4):** 6 go-live blockers, led by rotating the live-looking tokens committed to the `env` template, enabling PKCE on the Android authorization flow, gating the database backup/optimize routes, installing a real TLS certificate, un-publishing ArangoDB from the host, and aligning the realm flags with the chosen onboarding model. **Nearly all are inherited from upstream `v2.0.0`; the team's own security-touching commits are hardening (§5), and none of the blockers touch the OTP design — they are independent, parallel work.**

---

## 2. Current-state review

### 2.1 What the platform already provides (the foundation this design builds on)

| Capability | Where | Why it matters for OTP onboarding |
|---|---|---|
| Users keyed by `iss#sub`, email nullable | `services/user-provisioning-service.js` (JIT UPSERT) | A farmer account needs no email anywhere in the data layer — phone-only works end-to-end once Keycloak issues tokens |
| Env-driven realm configuration | `configs/keycloak/genie-realm.yaml` + `keycloak-config-cli` service | Onboarding posture (registration, OTP flows, policies) ships as reviewed config, not console drift |
| Custom Keycloak image build | `configs/keycloak/Dockerfile` | Adding an OTP authenticator extension (JAR) is a one-line addition to an existing pipeline |
| Notification/broadcast stack with fail-closed auth | `services/notification/*`, `routes/notification-routes.js` (timing-safe shared secret) | Precedent and infrastructure for outbound message handling, idempotency and rate awareness |
| Provider seam for SMS/voice | `warning_system_engine/app/core/notifier.py` (tier-3 SMS, tier-4 voice) | The OTP sender plugs into the same provider-abstraction pattern — one gateway contract serves warnings **and** auth |
| Hosted Keycloak login theme (i18n-ready) | `configs/keycloak/themes/genie/login/` | Phone-labelled, Bengali registration/login pages are a messages-file addition |
| PII filtering in telemetry | backend `tracing-pii.js` | OTP codes and phone numbers stay out of traces if senders log through instrumented paths |

### 2.2 What remains email-centric today (all addressable by configuration or small scoped changes)

| # | Area | Current state | Where |
|---|---|---|---|
| 1 | Self-registration | Keycloak's default user profile marks `email` required on the registration form | realm user-profile config (§3) |
| 2 | Password recovery | `resetPasswordAllowed` relies on email links; no self-service path for phone-only users | OTP reset flow (§3, Stage 1); interim SOP (§3.6) |
| 3 | Login page language | `genie` theme ships English only (known item in `docs/MEWA-CHANGELOG.md`) | theme messages files (§3.7) |
| 4 | Mobile scopes/UI | Requests OIDC `email` scope; settings render email-centric UI | `auth_notifier.dart:204,395`, settings component (§3.7) |
| 5 | Realm flag defaults | `VERIFY_EMAIL=true` with empty `EMAIL_*` SMTP — an inconsistent combination for any new user | env/compose defaults (§4 B4) |

### 2.3 The target user journey this document specifies

> A farmer (or an extension worker on their behalf) enters a phone number on the MEWA registration page → receives a 6-digit code by **SMS (universal) or WhatsApp (where available)** → enters the code → sets a password → is logged in and JIT-provisioned into the app with no email anywhere in the flow. Password recovery repeats the same OTP challenge without support intervention.

---

## 3. Recommended approach — phone-only registration with SMS/WhatsApp OTP on the existing Keycloak stack

### 3.1 Design principles

1. **Keycloak remains the sole identity provider** — OTP lands in a Keycloak authenticator extension configured via the realm import; no parallel user store, no custom auth endpoints in the backend.
2. **Phone number is the identity**: username = E.164 phone (`+8801701234567`), validated by the declarative user profile; email optional everywhere.
3. **Staged delivery**: nothing in the pilot waits on a gateway contract — Stage 0 is configuration-only and can ship immediately; Stages 1–2 layer OTP on top.
4. **One provider abstraction for messages**: reuse the team's provider-seam pattern so auth OTP and warning SMS share one gateway integration (while being rate-limited and audited separately).
5. **Everything declarative**: flows, policies and the extension are configured through `genie-realm.yaml` + env, consistent with how the deployment already manages Keycloak.

### 3.2 Extension options for SMS/WhatsApp OTP (recommendation: option A)

| Option | What it is | Pros | Cons / notes |
|---|---|---|---|
| **A. Phase Two (p2-inc) Keycloak phone plugins** — `keycloak-phone-provider` + SMS-OTP authenticator + verify-phone required action | Maintained open-source plugin suite built for exactly this model: phone attribute, OTP credential, phone-first login/registration | Purpose-built; actively maintained against recent Keycloak; supports custom senders (implements a small `SmsService` SPI we point at the gateway); realm-import friendly | Third-party dependency to pin and review; check licence (Apache-2.0) and KC 26.x compatibility at integration time |
| **B. Lightweight community authenticator** (e.g. mesutpiskin/keycloak-phone-authenticator) | Single-purpose OTP authenticator | Small code surface, easy audit | Thinner feature set (no phone-provider/registration integration); verify maintenance |
| **C. Custom SPI in-house** | A purpose-built Keycloak authenticator following the team's existing provider-seam pattern | Full control; zero external dependencies | Highest build/maintenance cost; only if A–B are ruled out |

**Recommendation:** **Option A** with a **pluggable sender** — the plugin's sender SPI implemented once, backed by the same provider seam as the warning engine, delivering via a standard SMS gateway and the WhatsApp Business API for the WhatsApp channel. OTP generation, verification, throttling and anti-fraud all run in the self-hosted Keycloak extension (controls in §3.8) — no managed OTP or verification service is involved. The Keycloak-side flow is identical under options A–C, so the choice is revisitable without redesign.

**Channel strategy for Bangladesh:** offer **SMS as the default and WhatsApp as the preferred channel where the number is WhatsApp-reachable** (SMS reaches feature phones and works without data; WhatsApp delivery is cheaper at volume and arrives in an app farmers already use). With a self-managed sender this is a two-step fallback (try WhatsApp, fall back to SMS), implemented once in the sender SPI. The gateway itself should be BD-reachable and contractually cleared for transactional traffic — this is the one genuinely new external dependency (MEWA changelog open item #2), and the OTP use-case strengthens the case for settling it.

### 3.3 Realm identity model (configuration, applied via the existing realm import)

```yaml
# --- realm flags ---
registrationAllowed: true        # Stage 1: OTP-guarded self-registration (Stage 0: false)
verifyEmail: false               # email plays no role for farmers; phone verification is the OTP flow
resetPasswordAllowed: false      # email reset replaced by the OTP reset flow (Stage 1) / SOP (Stage 0)
loginWithEmailAllowed: false     # usernames ARE phone numbers
duplicateEmailsAllowed: true     # many users have empty email
bruteForceProtected: true        # keep; complements OTP throttling

passwordPolicy: length(8) and notUsername   # deliberate usability tradeoff for the audience,
                                            # backed by brute-force lockout + OTP throttling;
                                            # env-overridable per deployment

# --- audit (currently absent; required for OTP-era forensics) ---
eventConfig:
  eventsEnabled: true
  adminEventsEnabled: true

# --- declarative user profile: email optional, phone first-class ---
userProfile:
  attributes:
    - name: username
      displayName: "Phone number"
      validations:
        - id: pattern
          config:
            pattern: "^\\+?[0-9]{10,15}$"
    - name: email
      required: []                          # OPTIONAL — the pivotal change
    - name: phone
      displayName: "Phone number"
      required:
        - user
      validations:
        - id: pattern
          config:
            pattern: "^\\+8801[3-9][0-9]{8}$"   # BD mobile; generalize per deployment
```

> The `userProfile` block is a **sketch** — validate the exact attribute schema against the
> keycloak-config-cli 6.5.x realm-import format and the Keycloak 26 User Profile docs during
> implementation. The plugin (§3.2 option A) manages its own phone attribute/config in
> addition to this.

Corresponding env defaults (`env` + `docker-compose.yaml`, documented in the deploy guide):

| Variable | Stage 0 | Stage 1+ | Rationale |
|---|---|---|---|
| `KEYCLOAK_REGISTRATION_ENABLED` | `false` | `true` | Stage 0 = provisioned accounts only; Stage 1 opens OTP-guarded self-registration |
| `KEYCLOAK_VERIFY_EMAIL` | `false` | `false` | Email is out of the loop |
| `KEYCLOAK_RESET_PASSWORD` | `false` | `false` | Replaced by OTP reset (Stage 1) / SOP (Stage 0) |
| `KEYCLOAK_LOGIN_WITH_EMAIL` | `false` | `false` | Phone usernames |
| `KEYCLOAK_DUPLICATE_EMAILS` | `true` | `true` | Empty emails must not collide |
| `KEYCLOAK_PASSWORD_POLICY` | `length(8) and notUsername` | same | Documented tradeoff |
| *(new)* OTP sender config | — | `OTP_PROVIDER_URL`, `OTP_PROVIDER_API_KEY`, `OTP_CHANNEL_ORDER=whatsapp,sms`, quotas/throttle values | Sender SPI config; keys via `.env`, never in the image |

### 3.4 Stage 1 — Registration flow (OTP)

1. Farmer opens the MEWA app/web → Keycloak registration page (Bengali, phone-labelled; §3.7) shows a single prominent **Phone number** field (email optional/collapsed).
2. On submit, the flow's OTP authenticator normalizes the number (trim, Bengali digits → ASCII, default `+880`), sends a 6-digit code via the configured channel order (WhatsApp first, SMS fallback), and shows the code-entry screen with a resend countdown.
3. Farmer enters the code → verified → sets a password (policy per §3.3) → account created with `username = phone`, verified-phone flag set, no email.
4. First login proceeds straight to the app; JIT provisioning creates the ArangoDB user (`email: null`). **This last step already works today with zero changes.**

**Anti-enumeration rule:** registration with an already-registered number, and password reset for an unknown number, must present identical messaging/timing — the phone number is public enough that enumeration would otherwise enable account probing.

### 3.5 Stage 1 — Password recovery (OTP)

Enter phone on the "Forgot password" page → OTP to the stored number → set new password → old sessions invalidated (Keycloak does this on credential change). No support intervention, no email, fully audited via realm events. This is the flow that removes the last manual step from the support path.

### 3.6 Stage 0 — Interim provisioning & recovery (configuration-only, ships now)

While Stage 1 is being integrated, the pilot proceeds with mediated onboarding that requires **no code**:

- **Provisioning:** extension worker creates the account in the Keycloak console — username `+8801…`, email empty, **temporary password with `Temporary = ON`** so the farmer chooses their own password at first login (the worker never knows it). Bulk cohorts via partial import or the existing `genie-proxy-client` service account (`manage-users`).
- **Recovery:** support verifies identity by calling the stored number back, then issues a new temporary password (`Temporary = ON`); brute-force lockouts cleared from the same screen.
- **Normalization:** workers enter `+8801XXXXXXXXX`; the SOP includes the digit-format rule (ASCII, with country code) since Keycloak compares usernames literally.

This stage unblocks the pilot and doubles as the **human fallback path** for edge cases (shared family phones, failed OTP delivery) once Stage 1 is live.

### 3.7 App and theme changes (small, scoped)

| Item | Change | Where |
|---|---|---|
| Bengali, phone-labelled login/registration | Add `messages_bn.properties`; relabel username "Phone number"; helper text showing the `+8801…` format; enable `KEYCLOAK_I18N_ENABLED=true` with `en,bn` | `configs/keycloak/themes/genie/login/`, realm env. Also resolves the GENIE-branding item from the MEWA changelog |
| OTP extension wiring | Add provider JAR to the Keycloak image; configure flow + sender via realm import and env | `configs/keycloak/Dockerfile`, `genie-realm.yaml`, compose env |
| Mobile scopes | Drop `email` from requested scopes (`openid profile offline_access`); identify users by `sub` (already extracted) | `lib/services/auth/auth_notifier.dart:204,395` |
| Mobile email UI | Hide/neutralize email row and email-updates toggle when `email` is null | `lib/components/settings/settings_component.dart` |
| MEWA flavor | Own `applicationId` (`com.mewa.bd.genieai`), redirect scheme, client `genie-mobile-mewa` (realm YAML already parameterizes via `KC_MOBILE_CLIENT_ID` / `KC_MOBILE_REDIRECT_SCHEME`), pilot-domain Keycloak URL, `['en','bn']` | `lib/config/flavors/`, `android/app/build.gradle` |
| Web email cosmetics | Hide "Email Updates" toggle for email-less users; add phone/username search to the admin user table | `SettingsComponent.vue`, `AdminDashboard.vue` |
| Delete dead screen | Remove `PasswordResetConfirmScreen.vue` (unreachable legacy from the pre-Keycloak era; imports a service that no longer exists) — see §4 M1 | `components/gov-chat-frontend/src/components/` |

### 3.8 OTP security controls (non-negotiable for Stage 1)

- **Code policy:** 6 digits, ~90 s expiry, single-use, ≤5 attempts, 60 s resend cooldown.
- **Throttling & cost guard:** per-phone and per-IP rate limits; daily OTP quota per phone (a cost and abuse guard — each SMS costs money); integrate with realm brute-force lockout.
- **Secrecy:** OTP never logged or traced (route sender logs through the instrumented/PII-filtered path); codes stored only hashed, never in plain text.
- **Delivery & audit:** realm event logging on (`eventConfig` §3.3); delivery status logged per message; Grafana dashboards already exist for request/error monitoring — add an OTP send/fail panel.
- **SIM-swap note:** OTP proves control of the number at that moment; the Stage 0 call-back SOP remains the fallback for high-stakes recovery.
- **WhatsApp specifics:** OTP delivery uses the WhatsApp Business Platform's authentication-template category (one-time Meta business verification for the pilot's sending number); the OTP appears only in that authentication template — never in a normal message; messaging-window rules are respected by staying within the authentication-template category.

### 3.9 Stage 2 — Hardening and enhancements (post-pilot)

- Per-user channel preference (WhatsApp vs SMS) captured at first OTP; quiet-hours handling for warnings vs auth (auth is always immediate).
- Step-up OTP for sensitive actions (account deletion, profile data export).
- Anomaly monitoring: OTP send spikes by district/prefix (SIM-box abuse detection), failure-rate dashboards.
- Consider Android App Links (`autoVerify`) replacing the custom-scheme redirect for mobile (see §4 H7).

### 3.10 Acceptance criteria

**Stage 0**
- [ ] A user with no email is provisioned, logs in on web and mobile with a `+8801…` username, and is forced to set their own password at first login.
- [ ] JIT provisioning stores `email: null`; chat, weather and notifications all function.
- [ ] Recovery SOP executed by a non-developer support agent in under 5 minutes; lockout/unlock verified.

**Stage 1**
- [ ] Self-registration completes with SMS OTP and (where reachable) WhatsApp OTP, in Bengali, producing a no-email account that functions end-to-end.
- [ ] Password recovery completes via OTP with no support intervention; anti-enumeration messaging verified.
- [ ] Throttles/quotas verified (per-phone, per-IP, daily quota); OTP absent from all logs and traces.
- [ ] Realm login/admin events observable; OTP send/fail panel visible in Grafana.
- [ ] Mobile app requests no `email` scope; no blank-email UI for pilot users.
- [ ] With registration now open, the §4 blockers are verified closed (especially B2 PKCE, B4 flags, B6 TLS).

---

## 4. Pre-flight recommendations for secure deployment

### 4.1 What is sound (verified — keep as-is)

- **Web token handling:** tokens in JavaScript memory only; no localStorage/sessionStorage/cookies; silent renew with proper re-login fallback (`keycloakAuthService.js`, backed by tests).
- **Mobile token storage:** `flutter_secure_storage` (Keychain / EncryptedSharedPreferences), mutex-guarded refresh, RP-initiated logout.
- **Backend JWT validation:** signature + issuer (whitelist via OIDC discovery) + expiry via `jose`, JWKS force-refresh on rotation; `requireAdmin` on the `/api/admin/**` router; AQL built with bound templates (no injection found in reviewed services).
- **Notification broadcast auth (team-built):** fail-closed when the shared secret is unset; `timingSafeEqual` on fixed-length digests — correct as delivered.
- **Team security trajectory:** every commit since `v2.0.0` touching security-adjacent files is hardening (image pinning, CVE bumps, cap-drops, SSL ownership, mobile TLS-bypass made opt-in). No upstream control was removed (§5).

### 4.2 Go-live blockers (close before onboarding real users)

| ID | Finding | Evidence | Origin | Fix |
|---|---|---|---|---|
| **B1** | **Live-looking secrets committed in the `env` template**: a Hugging Face token (`hf_YnXMH…`, line 94) and a JWT-shaped `VLLM_API_KEY` (line 97). Upstream `v2.0.0` ships both **empty**; the values entered this lineage via `a967fb195` (2025-10-20) and `bf2d2ceb8` (2025-11-29). On a likely-public GitLab, treat both as compromised. | `env:94,97`; `git show v2.0.0:env`; `git log -S` | **Team** (2025 lineage) | Revoke/rotate both now; restore the upstream empty-template form; decide on history scrub; add CI secret-scanning |
| **B2** | **Android authorization-code flow without PKCE**: the vendored `flutter_appauth` Android plugin's `performAuthorization()` never sets a code verifier (`FlutterAppauthPlugin.java:415-483`), and Dart passes none (`auth_notifier.dart:199-208`) — while the iOS side of the same fork generates verifier+S256+state (`AppAuthIOSAuthorization.m:16-33`). No `code_challenge` leaves Android; the realm client *declares* S256 enforcement (either the deployed realm doesn't enforce it — verify — or Android login fails against an enforcing realm). With a custom-scheme redirect any app can register, an intercepted code is usable. | plugin + realm citations above; `genie-realm.yaml:173` | **Upstream v2.0.0** (fork vendored upstream; team's only fork change is the TLS-bypass-lazy hardening `c7e2e802`) | Port the iOS pattern to the Android plugin (generate verifier, `setCodeVerifier` — the exchange already forwards it at line 492); confirm the realm enforces S256 (a non-PKCE attempt must fail); validate `state`/`nonce` in Dart; Stage 2: App Links |
| **B3** | **Any authenticated user can trigger a full database backup/compaction**: `POST /api/database/backup` and `/optimize` apply only `authenticate`, never `requireAdmin` | `routes/database-operations-routes.js:8,36,88` (identical at v2.0.0) | **Upstream v2.0.0** | Add `requireAdmin` on this router; audit `ROUTE_CONFIGS` for similar `keycloakAuth: true` routes |
| **B4** | **Realm flag defaults inconsistent with the deployment**: `REGISTRATION=true`, `VERIFY_EMAIL=true`, `RESET_PASSWORD=true` over an empty `EMAIL_*` block — registration + verification on a realm that cannot send email | `docker-compose.yaml:1908-1914`, `env:76-83,628-652`, compose note `:1846` | **Upstream v2.0.0** | Adopt the §3.3 env table explicitly in the pilot `.env`; align compose defaults with the no-SMTP reality |
| **B5** | **ArangoDB published on the host** (`mode: host`, 8529, password-only, no TLS/allow-list) — internet-reachable on the single-host pilot unless firewalled; all chat history, uploads and vectors sit behind one password | `docker-compose.yaml:986-994` | **Upstream v2.0.0** | Un-publish for the pilot (SSH tunnel/`docker exec` for admin) or firewall to admin IPs; verify password strength (it drifted once per the MEWA changelog) |
| **B6** | **Self-signed TLS on the pilot domain** (nginx; issuer/CORS derived from it) — browser/app warnings for farmers and a weak foundation for the internal-HTTP topology (`sslRequired: none`) | `docs/MEWA-CHANGELOG.md` #4; nginx templates | **Team deployment ops** | Install a real certificate (certbot path already exists) or an institutional cert before onboarding users |

### 4.3 High severity (close during pilot hardening, week 1)

| ID | Finding | Evidence | Origin |
|---|---|---|---|
| H1 | Backend JWT verification does not validate `aud`/`azp` — any client's token from the trusted realm is accepted | `keycloak-auth-service.js:250-260` | Upstream |
| H2 | `requireAdmin` reads only `realm_access.roles`; pin the role source once H1 lands | `middleware/keycloak-auth-middleware.js:178-194` | Upstream |
| H3 | No rate limiting on `/auth/*` (and it becomes load-bearing once Stage 1 opens registration); Kong limiter covers other routes; `limit_by: consumer` with no consumers registered | `kong_config.json:606-638,430-444`; `default.conf.template:93-114` | Upstream |
| H4 | Open self-registration default with no verification — resolved by design in §3.3, but the compose default should not silently reopen it | `docker-compose.yaml:1908` | Upstream |
| H5 | Fail-fast gaps: boot validates only `ARANGO_*`, `KEYCLOAK_URL/REALM/CLIENT_ID`; missing `KEYCLOAK_PROXY_CLIENT_SECRET` (breaks `/api/me/delete`) and `NOTIFICATION_BROADCAST_SECRET` (503s broadcasts) surface at runtime; `config-and-sleep.sh` checks a nonexistent `KEYCLOAK_PASSWORD` instead of `KEYCLOAK_ADMIN_PASSWORD` | `index.js:972-985`; `keycloak-proxy-service.js:6-9`; `notification-routes.js:21-35`; `config-and-sleep.sh:5-11` | Upstream |
| H6 | Mobile debug TLS bypasses: `allowInsecureConnections: true` hard-coded in dev/e2e flavors + global `_DebugHttpOverrides` under `kDebugMode` — a mis-shipped debug build accepts any certificate, token endpoint included (team already hardened the plugin side in `c7e2e802`) | `dev_config.dart:18`, `e2e_config.dart:18`, `main.dart:47-65` | Upstream, team-partially-hardened |
| H7 | Mobile identity/config: `email` scope; ID-token `sub` parsed without verification (fine while the token comes only from the AppAuth exchange — keep it that way); no `mewa` flavor (pilot borrows `itu` with `applicationId com.example.genie_ai_mobile`); E2E token-injection deep link registered in the **release** manifest; refresh token retained when IdP returns none; no server-side revocation on logout | `auth_notifier.dart:27-39,204,430`; `flavors/itu.dart`; `AndroidManifest.xml:41-46`; `keycloak_service.dart:132-195` | Upstream |
| H8 | Web `/admin` route gated only by `requiresAuth`, not role (backend enforces `requireAdmin` — the SPA should match) | `router.js:38-42` | Upstream |
| H9 | Kong admin API binds `0.0.0.0:8001/8444`; `KONG_TRUSTED_IPS` trusts `172.16.0.0/12` (Ansible `10/8`) | `docker-compose.yaml:225,235`; `group_vars/all.yml:68` | Upstream |
| H10 | PII/credentials in logs: Authorization/Cookie headers at INFO per request (`index.js:534-545`); email + role claims at DEBUG per login (`user-provisioning-service.js:71-73`); admin request logger dumps headers/body **before** auth (`admin-routes.js:35-42`) | as cited | Upstream |
| H11 | `./secrets` mounted world-readable into backend, geo-inference-worker and drought-monitoring alike — one compromised container reads TLS keys, GEE/Firebase credentials, DB passwords | `docker-compose.yaml:517,764,809` | Upstream |

### 4.4 Medium / low (scheduled hardening)

| ID | Finding | Origin |
|---|---|---|
| M1 | `PasswordResetConfirmScreen.vue`: unreachable legacy from the pre-Keycloak era, re-added in the September port; imports a nonexistent service, references an undefined `/login` route, contains dev reset-token strings — delete | **Team** (`69fda5a7e`, `e9e2efaf9`) |
| M2 | Internal `error.message` returned to clients from many handlers, bypassing the global sanitizer | Upstream |
| M3 | Threat-detection middleware skips any request bearing an `Authorization` header | Upstream (shared lib) |
| M4 | `/api-docs` + raw OpenAPI spec exposed unauthenticated; `unsafe-eval` CSP on that path | Upstream |
| M5 | `/auth/admin/*` (Keycloak admin console) reachable through the public `/auth/` location with `SAMEORIGIN` framing and no `frame-ancestors`; IP-restrict at nginx for the pilot | Upstream config |
| M6 | Mobile: unencrypted auth logs in app-documents (30-day retention); `allowBackup` not disabled; fine-grained location requested unconditionally with district transmitted at registration | Upstream |
| M7 | Broadcast secret: single shared secret — add rotation, per-caller identity and rate limits on broadcast endpoints (the auth itself is correct) | Team follow-ups |
| M8 | `sslRequired: none` — acceptable only while Keycloak stays network-internal; keep the topology documented | Upstream |
| L1 | Admin guide drift: advises `Temporary = Off` (Stage 0 SOP reverses this) and references the removed `user` realm role | Upstream docs |
| L2 | Grafana `ALLOW_SIGN_UP=true` + realm-`admin`→Grafana-Admin mapping — document the single-tenant assumption | Upstream |
| L3 | "Email Updates" settings toggle is a no-op for email-less users (§3.7 hides it) | Upstream |
| L4 | nginx healthcheck `curl -k` masks certificate misconfiguration (relevant while B6 open) | Upstream |

---

## 5. Origin attribution: upstream `v2.0.0` vs. team-introduced

**Summary:** the onboarding platform the OTP design builds on is upstream's Keycloak-era architecture; the phone/OTP capability itself is genuinely **net-new work** (nothing to attribute — it does not exist upstream or in this branch yet). Of the security findings, **nearly all are inherited from upstream `v2.0.0`**. The team introduced **two** security-relevant defects (B1 committed secrets; M1 dead legacy screen) plus one operational risk (B6 self-signed cert), and **removed no upstream security control** — its security-touching commits are all hardening.

| Item | Origin | Evidence |
|---|---|---|
| B1 committed HF token + VLLM API key in `env` | **Team** — `a967fb195` (2025-10-20), `bf2d2ceb8` (2025-11-29), pre-`v2.0.0` Polisense lineage; upstream ships both empty | `git show v2.0.0:env`; `git log -S hf_YnXMH` / `-S eyJhbGci` |
| B2 Android PKCE gap in vendored `flutter_appauth` | **Upstream v2.0.0** — fork present at `v2.0.0`; only post-v2.0.0 change is the team's opt-in TLS-bypass fix (`c7e2e802`, 2026-08-24) | `git ls-tree v2.0.0`; `git diff v2.0.0..HEAD -- mobile/.../flutter_appauth` |
| B3 unguarded DB backup/optimize routes | **Upstream v2.0.0** — file byte-identical since `v2.0.0` | `git diff v2.0.0..HEAD` (empty) |
| B4 realm-flag/SMTP inconsistency | **Upstream v2.0.0** — all seven flag defaults verbatim in `v2.0.0`'s compose | `git show v2.0.0:docker-compose.yaml` |
| B5 ArangoDB host publish | **Upstream v2.0.0** | compose arango ports block unchanged |
| B6 self-signed TLS on pilot | **Team deployment ops** (server-specific) | `docs/MEWA-CHANGELOG.md` #4 |
| M1 dead password-reset screen | **Team** — upstream deleted it in `570b6c1f8` (2026-04-03, "Remove Legacy Authentication Service"); re-added with the broken import in `69fda5a7e` (2026-09-06) during the PolisenseAI port, reworked `e9e2efaf9` (2026-09-11) | `git show v2.0.0:<path>` → absent; `69fda5a7e` adds it |
| H1/H2/H3/H5/H8/H9/H10/M2-M5/L1-L4 | **Upstream v2.0.0** — middleware byte-identical; `keycloak-auth-service.js` untouched since `v2.0.0`; nginx CSP changes are additions only | `git diff v2.0.0..HEAD` per path |
| H6 mobile TLS-bypass flags | Upstream design; **team partially hardened** (`c7e2e802`) | commit `c7e2e802` |
| M7 broadcast auth | **Team** (`8ef23544b`/`69fda5a7e`, FCM port) — landed already hardened (fail-closed + `timingSafeEqual`); never existed unauthenticated in this repo. The header comment narrating a "previous form" bug refers to a version that never existed here — carried from the source branch's narrative | `git log -S 'if (expectedSecret && '` → only the fail-closed form ever committed |
| Realm YAML changes since v2.0.0 | **Team**, benign: `displayName` env vars (`e9e2efaf9`); mobile-client `webOrigins: "+"` (`0ef06df10`, 2026-08-21 — note: often attributed to the Sept 11 commit, it is not) | `git log -S '"+"' -- configs/keycloak/genie-realm.yaml` |
| Legacy `passwordResetTokens` schema collection | **Upstream v2.0.0** legacy, unused since the Keycloak migration; cleanup candidate, no live risk | schema line 1298 identical in both |

---

## 6. Pre-flight checklist

**Blockers (before any farmer account exists):**
- [ ] B1 — Revoke + rotate the HF token and VLLM API key; blank the `env` template values; add secret-scanning to CI
- [ ] B2 — Android PKCE fix in the vendored plugin + confirm the realm enforces S256
- [ ] B3 — `requireAdmin` on `/api/database/*` (and audit `ROUTE_CONFIGS`)
- [ ] B4 — Pilot `.env` realm flags per §3.3 Stage 0 column
- [ ] B5 — Un-publish ArangoDB 8529 (or firewall); verify password
- [ ] B6 — Real TLS certificate installed and verified end-to-end

**Stage 0 (config-only onboarding, can ship immediately):**
- [ ] Realm user profile (email optional, phone required + pattern), Bengali phone-labelled login theme, event logging on (§3.3, §3.7)
- [ ] Admin guide updated: phone provisioning SOP + recovery SOP + lockout handling; `Temporary = ON` everywhere (fixes L1)
- [ ] Mobile: drop `email` scope; `mewa` flavor; settings email handling; move E2E deep-link filter out of the release manifest (H7)
- [ ] Rate-limit `/auth` at nginx (H3 — becomes load-bearing when registration opens); restrict `/auth/admin/` by IP (M5)
- [ ] Boot fail-fast for `KEYCLOAK_PROXY_CLIENT_SECRET`, `NOTIFICATION_BROADCAST_SECRET` (H5); fix `config-and-sleep.sh` var name
- [ ] Log hygiene: redact Authorization/Cookie headers, drop email from INFO logs (H10)
- [ ] Delete `PasswordResetConfirmScreen.vue` (M1); hide "Email Updates" toggle (L3)

**Stage 1 (OTP self-service):**
- [ ] Select extension (§3.2 — recommendation: option A, pluggable sender) and settle the gateway contract (the one new external dependency)
- [ ] Sender SPI implemented on the team's provider-seam pattern; WhatsApp authentication template verified; channel order `whatsapp → sms`
- [ ] OTP security controls per §3.8 (throttles, quotas, secrecy, audit) verified in a staging realm
- [ ] Registration + reset flows pass the §3.10 Stage 1 acceptance criteria; re-verify B2/B4/B6 with registration open

**Deferred (Stage 2 / scheduled):**
- [ ] Per-user channel preference; step-up OTP; anomaly dashboards (§3.9)
- [ ] H1/H2 audience/azp pinning; H9 Kong admin narrowing; H11 secrets-mount scoping
- [ ] Android App Links; refresh-token revocation on logout

---

## 7. Sources

- Code review: `components/gov-chat-backend` (auth middleware/service/routes, provisioning, proxy, notifications, index), `components/gov-chat-frontend` (auth service, router, http service, legacy screen, settings/admin), `mobile/genie_ai_mobile` (auth notifier, token storage, config/flavors, vendored plugin), `configs/keycloak` (realm YAML, themes, config-cli), `api-gateway-solution` (nginx templates, Kong config), `docker-compose.yaml`, `env`, `deploy/ansible`.
- Operational context: `docs/MEWA-CHANGELOG.md`, `site/content/en/docs/configuration/keycloak-admin-guide.md`.
- Attribution: `git diff/log/show v2.0.0..HEAD` over every security-adjacent path, `git log -S` for each contested string, blob-level comparison for the vendored plugin and untouched files.
