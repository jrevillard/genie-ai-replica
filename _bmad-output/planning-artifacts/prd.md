---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
status: complete
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - 'GitLab Issue #613 - Migrate Flutter mobile app to Keycloak OIDC authentication'
  - '_bmad-output/planning-artifacts/research/technical-identity-provider-integration-research-2026-03-26.md'
  - '_bmad-output/project-context.md'
  - 'docs/architecture.md'
  - 'docs/keycloak-admin-guide.md'
  - 'docs/external-idp-integration-guide.md'
  - 'docs/roadmap-sprint-20-to-25.md'
documentCounts:
  briefs: 0
  research: 1
  brainstorming: 0
  projectDocs: 4
  gitlabIssues: 1
  projectContext: '_bmad-output/project-context.md'
workflowType: 'prd'
lastEdited: '2026-04-23'
editHistory:
  - date: '2026-04-23'
    changes: 'Validation edit: removed impl leakage from 16 FRs, rewrote 9 NFRs with metrics/methods, added NFR10 accessibility, added Out of Scope section, added Mobile Accessibility domain note, updated Test Matrix with NFR references, updated Measurable Outcomes test coverage target'
classification:
  projectType: 'Mobile App (Flutter)'
  domain: 'Govtech — Digital Public Infrastructure (DPI)'
  complexity: 'high'
  projectContext: 'brownfield — migration auth mobile existant vers Keycloak OIDC'
---

# Product Requirements Document - genie-ai (Mobile OIDC Migration)

**Author:** Jerome
**Date:** 2026-04-23

## Executive Summary

GENIE.AI is an open-source generative AI framework for the public sector, deployed across multiple government institutions via a white-label model. The web frontend and backend have completed their migration to Keycloak OIDC (MR !36), but the Flutter mobile application was explicitly deferred. All legacy auth endpoints it depended on have been removed, rendering the mobile app non-functional. This PRD covers the migration of the Flutter mobile app to Keycloak OIDC, restoring authentication and aligning it with the architecture established for the rest of the system.

Each institutional deployment operates as an independent instance with its own Keycloak realm, backend, and dedicated app store presence. The mobile migration must support this white-label model: every deployment gets a dedicated Flutter build with its own app ID, OIDC client, deep link scheme, and backend URL — all compiled at build-time via Flutter flavors.

The migration will implement the Authorization Code flow with PKCE (RFC 8252), using the system browser (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android) rather than embedded webviews. This provides native SSO with the device browser, password manager/passkey compatibility, and ensures the app never handles user credentials directly. Each deployment will have its own Keycloak client configured as a public client with PKCE mandatory — no shared secrets between deployments.

### What Makes This Special

This is not a simple auth library swap. It is building a **white-label OIDC authentication foundation** designed for sovereign, multi-tenant government deployments. Key differentiators:

- **Per-deployment isolation** — each institution gets its own Keycloak OIDC client, build, and app store presence. No shared credentials or configuration between deployments.
- **State-of-the-art mobile OIDC** — Authorization Code + PKCE via system browser, following RFC 8252 and OAuth 2.1 best practices. No implicit grant, no embedded webviews, no client secrets in mobile code.
- **Sovereign deployment compatibility** — works in air-gapped and restricted-network environments where Keycloak runs as a local identity provider.
- **Token passthrough alignment** — the mobile app will use the same token validation architecture as the web frontend: Keycloak tokens validated directly at the backend via JWKS, with JIT user provisioning in ArangoDB.

## Project Classification

| Dimension | Value |
|-----------|-------|
| Project Type | Mobile App (Flutter) |
| Domain | Govtech — Digital Public Infrastructure (DPI) |
| Complexity | High |
| Project Context | Brownfield — migration of existing mobile auth to Keycloak OIDC |
| Deployment Model | White-label, one dedicated build per institution |

## Success Criteria

### User Success

- A user opens the app, taps "Sign in", is redirected to the system browser showing the institution's Keycloak login page, and is back in the app with a valid session — with no confusion about why the browser opened.
- Token refresh is transparent: when the access token expires, the refresh token is used silently. The user is never prompted to re-authenticate unless the Keycloak session itself has expired.
- The login page reflects the institution's branding (Keycloak theme), providing a consistent trust signal.
- On subsequent app launches, if the refresh token is still valid, the user is logged in immediately without any browser redirect.

### Business Success

- The mobile app is functional again after being broken by the removal of legacy auth endpoints in MR !36.
- A new institutional deployment can be onboarded in days: add a Flutter flavor config file + create a Keycloak client + publish the build — following a documented, repeatable process.
- Issue #597 (SSE streaming for mobile) is unblocked — the OIDC migration provides a clean auth API that streaming can consume without rework.
- The mobile app can be submitted to app stores (Google Play, Apple App Store) for each institution with its own identity.

### Technical Success

- **Zero legacy**: all legacy auth code removed (`auth_proxy.dart`, `password_proxy.dart`, `register_screen.dart`, SHA-256 login hashing, plaintext password handling). `git grep` on legacy endpoints returns nothing.
- **Secure token storage**: tokens stored in platform keystore/keychain (iOS Keychain, Android EncryptedSharedPreferences), never in plaintext `SharedPreferences`.
- **Public client + PKCE**: each deployment's Keycloak client is configured as a public client with PKCE mandatory — no client secret in mobile code.
- **SSL enforcement**: the `badCertificateCallback` bypass in `main.dart` is removed. Valid TLS certificates are enforced.
- **Cross-platform parity**: the OIDC flow works identically on iOS and Android using the same `flutter_appauth` abstraction.
- **Automated tests**: unit and integration tests cover login, silent refresh, logout, network errors, token expiry, and Keycloak session expiry.

### Measurable Outcomes

| Metric | Target |
|--------|--------|
| Silent token refresh latency | < 2 seconds (user should not notice) |
| Legacy auth code remaining | 0 files, 0 endpoints |
| Supported deployment flavors | 1 at MVP, 2+ at Growth |
| SSL bypass (`badCertificateCallback`) | Removed in MVP |
| Test coverage for auth flows | Login, refresh, logout, error, expiry scenarios; unit tests achieve minimum 80% line coverage on auth service layer |

## User Journeys

### Journey 1: Maria — First Login on Mobile (Happy Path)

Maria is a policy analyst who uses GENIE.AI daily on her desktop. Her institution has just rolled out the mobile app. She installs it from the App Store, opens it, and sees a branded splash screen followed by the login screen.

She taps "Sign in". The system browser opens, showing her institution's Keycloak login page — the same one she knows from the web. She enters her credentials (or uses her saved password/passkey from the browser). The browser closes and she's back in the app, authenticated. Her conversation history syncs from the backend and she starts chatting immediately.

**Key moment:** The "it just works" realization — same Keycloak, same credentials, seamless transition from desktop to mobile.

**What could go wrong:** Weak network causes the browser redirect to hang — the app shows a clear "connection error" state with a retry button, not a blank screen or an infinite spinner.

### Journey 2: Maria — Silent Token Refresh

Maria hasn't used the app in two days. She opens it again. The access token has expired, but the refresh token is still valid. The app silently exchanges the refresh token for a new access token — no browser redirect, no user interaction. She sees her chat interface immediately.

**Key moment:** She didn't even notice the re-authentication happened.

**Edge case — App returning from background:** Maria left the app open in the background for 3 hours. The refresh token has expired. When she returns, `AppLifecycleState.resumed` triggers a proactive token check. The refresh fails. The app clears local tokens and transitions smoothly to the login screen with a message: "Your session has expired. Please sign in again." No crash, no blank screen.

**Edge case — Token valid locally but rejected by backend:** Maria has a valid access token in keystore, but the admin has deleted her Keycloak account since her last refresh. She makes an API call, the backend returns 401. The app attempts a silent refresh. The refresh also fails (user deleted). The app clears tokens and shows the login screen.

### Journey 3: Maria — Admin Revokes Her Session

Maria has changed departments. Chen (the functional admin) updates her Keycloak roles. Maria has the app in the foreground. On the next API call, the backend validates her token (still technically valid). However, when her token expires and the app attempts a refresh, Keycloak rejects it (session revoked). The app clears local tokens and shows the login screen.

**Proactive detection:** When the app returns to foreground (`AppLifecycleState.resumed`), it can optionally call the Keycloak userinfo endpoint to verify the session is still active, catching revoked sessions before the user encounters an API error.

### Journey 4: Maria — Logout

Maria taps "Sign out" in the app. The app clears local tokens from keystore/keychain. The app also initiates Keycloak logout via the `end_session_endpoint` (front-channel logout), so the Keycloak session is terminated. If Maria taps "Sign in" immediately after, the browser opens the Keycloak login page — she is not automatically re-authenticated.

### Journey 5: Maria — Unstable Network During Login

Maria is on a weak 3G connection. She taps "Sign in", the browser opens, she authenticates successfully, but the redirect callback to the app fails mid-way (timeout, lost packet). The app never receives the deep link with the authorization code. The app remains on the login screen — not stuck on a spinner, but ready for another attempt. Maria taps "Sign in" again. The browser opens, Keycloak recognizes her active session (SSO), and the callback succeeds this time.

### Journey 6: Maria — Password Reset

Maria has forgotten her password. On the Keycloak login page in the browser, she taps "Forgot password". Keycloak sends her a reset link by email. She taps the link on her phone. The deep link opens the Keycloak password reset flow in the browser (not intercepted by the app). She sets a new password, then navigates back to the app and signs in with her new credentials.

### Journey 7: Amadou — Onboarding a New Deployment

Amadou's agency wants its own branded mobile app in the Play Store. He follows the deployment guide: copies the Flutter flavor template, fills in the agency's app ID, Keycloak URL, backend URL, and deep link scheme. He creates a new Keycloak client (`genie-mobile-agencyX`) as a public client with PKCE enabled. He builds the flavor, tests the login flow on both iOS and Android, and submits to the store.

**Key moment:** The entire onboarding takes under a day — copy template, fill values, build, test, ship.

**What could go wrong:** The deep link scheme conflicts with another app on the test device. The guide documents how to choose unique, reverse-DNS-formatted schemes.

### Journey 8: Amadou — Air-Gapped Deployment

Amadou deploys GENIE.AI in a fully offline government facility. No external IdP — Keycloak runs as the local identity provider. He builds the mobile app flavor pointing to the internal Keycloak URL. The device must be on the internal network (corporate WiFi or VPN) so the system browser can reach Keycloak. He configures local DNS resolution for the Keycloak hostname. The system browser opens the Keycloak login page served from the internal network. Login works identically to a connected deployment.

**Key moment:** OIDC works identically whether Keycloak is internet-facing or air-gapped.

**Prerequisite:** The mobile device must have network access to the Keycloak server. The deployment guide must document this network requirement explicitly.

### Journey Requirements Summary

| Journey | Reveals Requirements |
|---------|---------------------|
| Maria — First Login | System browser redirect, Keycloak SSO, branded splash screen, conversation sync |
| Maria — Silent Refresh | Silent refresh via refresh token, background expiry detection (`AppLifecycleState`), 401 fallback chain |
| Maria — Session Revoked | Proactive session validation on resume, graceful degradation |
| Maria — Logout | Local token clearing + Keycloak front-channel logout (`end_session_endpoint`) |
| Maria — Unstable Network | Deep link callback failure handling, retry without infinite spinner |
| Maria — Password Reset | Deep link routing to browser (not app intercept), post-reset login flow |
| Amadou — New Deployment | Flavor template system, Keycloak client creation, deep link uniqueness guide |
| Amadou — Air-Gapped | Network prerequisite documentation, local DNS, no external dependency |

## Domain-Specific Requirements

The GENIE.AI domain (Govtech — Digital Public Infrastructure) imposes constraints that the mobile OIDC migration inherits from the existing architecture. Most regulatory and sovereignty requirements are already addressed by the backend Keycloak integration (MR !36). The mobile migration must align with these existing constraints without introducing new compliance surfaces.

### App Store Compliance

Each institutional deployment requires its own app store presence (Google Play, Apple App Store). This introduces operational constraints:

- **Apple Developer Enterprise Program** or per-client Apple Developer accounts may be required for institutional distribution
- **Provisioning profiles and signing certificates** must be managed per deployment (build-time via flavors)
- **App Store review** must be factored into deployment timelines — govtech apps may require additional justification or documentation during review
- **Minimum OS version targets** must be set to support the oldest devices in use at government institutions

### Mobile Security (OWASP Mobile Top 10)

The mobile app handles authentication tokens and communicates with sensitive government systems. Key security requirements:

- **Token storage**: Platform keystore/keychain only (iOS Keychain, Android EncryptedSharedPreferences). Never plaintext `SharedPreferences`, never in files accessible to other apps.
- **Certificate validation**: The existing `badCertificateCallback` bypass must be removed. Valid TLS certificate validation is mandatory. Certificate pinning is not required for MVP (it would complicate air-gapped deployments with self-signed certs) but should be evaluated for Growth.
- **Obfuscation**: The app ID, client ID, and Keycloak URL are compiled into the binary and are discoverable via reverse engineering. This is acceptable for public clients (RFC 8252 — public clients have no secrets to protect) but the deployment guide should document this threat model.
- **No sensitive data in logs**: Token values, credentials, and PII must never appear in Flutter debug logs or crash reports.

### Mobile Accessibility

The Keycloak login page rendered in the system browser inherits WCAG 2.1 AA compliance from the institution's Keycloak theme configuration (server-side responsibility). Native Flutter UI screens (login screen, error states, session expired messages) should follow platform accessibility guidelines (VoiceOver on iOS, TalkBack on Android) as documented in NFR10. Full accessibility compliance is a Growth-phase objective — MVP includes accessibility labels on interactive elements and minimum touch targets.

### Sovereignty & Data Residency

The OIDC mobile implementation must work identically in:

- **Connected deployments** — Keycloak reachable via public internet
- **Air-gapped deployments** — Keycloak reachable only via internal network
- **Hybrid deployments** — Keycloak behind VPN with selective external access

The mobile app makes no assumptions about Keycloak reachability. All OIDC endpoints (authorization, token, userinfo, end_session) are discovered from the `.well-known/openid-configuration` document at runtime, using the Keycloak URL configured at build-time.

## Platform & Deployment Requirements

### Platform Requirements

| Requirement | Details |
|-------------|---------|
| Framework | Flutter 3.10+, Dart |
| Minimum iOS | iOS 13+ (ASWebAuthenticationSession, PKCE support) |
| Minimum Android | API 23+ (Android 6.0, EncryptedSharedPreferences) |
| Target platforms | iOS and Android (parity required) |
| Build system | Flutter flavors for per-deployment builds |
| Auth library | `flutter_appauth` (wraps AppAuth-iOS / AppAuth-Android) |
| Token storage | `flutter_secure_storage` (iOS Keychain, Android EncryptedSharedPreferences) |

> **Note on OS version policy:** iOS 13 and Android 6.0 are the technical minimums for the app's security mechanisms (PKCE, secure storage, system browser). However, older OS versions no longer receive security patches. Each institution's security policy may mandate a higher minimum OS version. The deployment guide should document this trade-off and recommend institutions enforce their own OS version policy via Mobile Device Management (MDM) if required.

### iOS Development Constraints

The team does not currently have a dedicated macOS build machine or an Apple Developer account. This impacts the development workflow:

| Aspect | Status |
|--------|--------|
| Flutter code (cross-platform) | Developed and tested normally — shared codebase |
| Android testing | Primary platform — continuous integration, device testing |
| iOS build | Best-effort — built on a teammate's Mac when available |
| iOS testing | Manual testing on a physical device (USB via Xcode) |
| Apple Developer account | Not available — no TestFlight or App Store distribution |
| iOS App Store submission | Growth phase (requires Apple Developer account) |

**Impact on MVP:** The OIDC implementation is written in cross-platform Flutter code and uses `flutter_appauth` which abstracts platform differences. The code will be functionally correct for iOS, but continuous testing happens on Android. iOS validation is periodic, relying on teammate availability.

**Impact on Growth:** Acquiring an Apple Developer account (99$/year) and setting up macOS CI (GitLab macOS runner or shared Mac) enables TestFlight distribution and App Store submission. This is required before any institutional deployment on iOS.

### Deep Link Architecture

Two distinct mechanisms are required, each serving a different purpose:

| Mechanism | Purpose | Configuration |
|-----------|---------|---------------|
| **Custom URL Scheme** | OIDC callback (`/callback`) | Build-time per flavor (e.g., `com.itu.genieai:/callback`) |
| **Universal Links (iOS) / App Links (Android)** | Password reset, email verification links | Requires server-side files: `apple-app-site-association` (iOS) and `assetlinks.json` (Android) hosted on the Keycloak domain |

Custom URL schemes are simpler to configure but less secure (any app can register the same scheme). Universal Links / App Links provide cryptographic domain verification but require hosting configuration files on each deployment's Keycloak domain. The deployment guide must document both setup procedures.

### Device Permissions

| Permission | Purpose | Required | User Prompt |
|------------|---------|----------|-------------|
| Network access | OIDC flows, API calls | Yes | No (default) |
| Keychain / Keystore | Secure token storage | Yes | No |
| System browser access | ASWebAuthenticationSession / Chrome Custom Tabs | Yes | No |
| Biometric (future) | Local app unlock | No (Vision) | Yes |
| Push notifications (future) | Background token refresh | No (Vision) | Yes |

### Offline Mode

Offline mode is not in scope for MVP. The app requires network connectivity to reach Keycloak and the backend API. MVP includes basic network error detection — if the device is offline, the app shows a static "No internet connection" message (no crash, no blank screen, no intelligent retry queue).

| Scenario | MVP Behavior |
|----------|-------------|
| Login without network | System browser fails to load Keycloak → app shows "No internet connection" |
| Token refresh without network | Refresh request fails → app falls back to login screen |
| API call without network | HTTP client reports error → app shows appropriate error state |

Offline mode with cached data and deferred sync is a Vision feature.

### Push Notifications

Push notifications are not in scope for MVP. Token refresh relies on the user opening the app (foreground) or returning to it (background → foreground via `AppLifecycleState.resumed`). Background token refresh via push-triggered wake-up is a Vision feature.

### Test Matrix

| Test Scenario | Android | iOS | Test Type | Verifies NFR |
|---------------|---------|-----|-----------|-------------|
| Login (happy path) | API 23 (min) + latest | When Mac available | Integration | FR1, FR2, FR3 |
| Silent token refresh (< 2s p95) | API 23 (min) + latest | When Mac available | Integration | NFR1 |
| Logout (local + Keycloak session termination) | API 23 (min) + latest | When Mac available | Integration | FR4 |
| Token expiry (access + refresh) | API 23 + latest | Unit (Dart) | Unit | FR5, FR6, FR7 |
| 401 → silent refresh → login fallback chain | API 23 + latest | Unit (Dart) | Unit | FR8 |
| Network error during login | Latest | N/A | Integration | FR12, NFR4 |
| Deep link callback failure + retry | Latest | N/A | Integration | FR13, NFR4 |
| Password reset deep link routing | Latest | When Mac available | E2E | FR15, FR16 |
| Session revoked detection on resume | Latest | When Mac available | Integration | FR6, FR7, NFR6 |
| SSL certificate enforcement | Latest | Unit (Dart) | Unit | FR23 |
| Auth state consistency (no stale auth) | Latest | Unit (Dart) | Unit | NFR6 |
| Error state → defined terminal state within 2s | Latest | Unit (Dart) | Unit | NFR4, NFR5 |
| Accessibility labels + touch targets | Latest | When Mac available | Unit | NFR10 |
| No tokens/PII in logs | Latest | Unit (Dart) | Unit | FR25 |
| Binary size increase < 8MB | Latest | N/A | Build comparison | NFR7 |
| Unit test coverage ≥ 80% auth service | Latest | N/A | CI coverage report | FR29 |

Unit tests are platform-agnostic (Dart) and run in CI for both platforms. Integration and E2E tests run continuously on Android; iOS testing is periodic and manual, depending on teammate Mac availability.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-solving MVP — restore mobile authentication functionality that was broken by the removal of legacy auth endpoints in MR !36. The minimum viable product is an app that can authenticate against Keycloak, maintain a valid session, and make authenticated API calls to the backend. No feature expansion beyond auth migration.

**Core principle:** Every item in the MVP is either required for the auth flow to work or required for a production-grade migration (security fixes, legacy removal, deployment guide).

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**

| Journey | Status |
|---------|--------|
| Maria — First Login | MVP |
| Maria — Silent Token Refresh | MVP |
| Maria — Session Revoked | MVP (basic — on refresh failure) |
| Maria — Logout | MVP |
| Maria — Unstable Network | MVP (basic error state) |
| Maria — Password Reset | MVP (deep link routing) |
| Amadou — New Deployment | MVP (guide + template) |
| Amadou — Air-Gapped | MVP (inherited from architecture) |

**Must-Have Capabilities:**

- Authorization Code + PKCE via system browser (`flutter_appauth`)
- Silent token refresh using refresh token
- Logout (local tokens + Keycloak `end_session_endpoint`)
- Secure token storage (`flutter_secure_storage` — Keychain / EncryptedSharedPreferences)
- One working Flutter flavor (Android, primary platform)
- Deployment onboarding guide (README: flavor template, Keycloak client setup, deep link config)
- Complete legacy auth removal (`auth_proxy.dart`, `password_proxy.dart`, `register_screen.dart`, SHA-256 login)
- SSL certificate enforcement (`badCertificateCallback` removed)
- Custom URL scheme for OIDC callback (per flavor)
- Universal Links / App Links for password reset and email verification
- Basic network error detection (static "No internet connection" message)
- AppLifecycleState handling (proactive token check on resume)
- Auth API exposing tokens for downstream consumption (e.g., #597 SSE streaming)
- Keycloak client per deployment (public client, PKCE mandatory)
- Unit tests for auth flows (platform-agnostic Dart)
- Integration tests on Android (login, refresh, logout, error scenarios)

### Post-MVP Features

**Phase 2 (Growth):**

- Second deployment validated (e.g., el-salvador branch)
- Apple Developer account acquisition + TestFlight distribution
- iOS App Store submission for institutional deployments
- macOS CI setup (GitLab self-hosted runner) for automated iOS builds
- Proactive session validation via Keycloak userinfo endpoint on app resume
- E2E automated tests for both platforms

**Phase 3 (Vision):**

- Biometric re-authentication (Face ID / fingerprint) for local app unlock
- Push notifications with background token refresh
- Conditional access policies (per-client MFA requirements, step-up authentication)
- Offline mode with cached data and deferred sync
- Certificate pinning (evaluated against air-gapped deployment constraints)

## Functional Requirements

### Authentication

- FR1: A user can sign in to the app using their institution's Keycloak credentials via the device system browser
- FR2: A user can complete the Authorization Code + PKCE flow without the app handling their credentials directly
- FR3: A user who already has an active Keycloak session in their device browser is automatically authenticated (SSO) without re-entering credentials
- FR4: A user can sign out, which clears local tokens and terminates the Keycloak session via the OIDC logout endpoint

### Session Management

- FR5: The app silently refreshes the access token using the refresh token when the access token expires, without user interaction, and stores the new refresh token returned by Keycloak
- FR6: The app checks token validity when the app returns to foreground (`AppLifecycleState.resumed`) and transitions to the login screen if the refresh token has expired
- FR7: The app detects when a token refresh fails (expired refresh token or revoked session) and transitions to the login screen with an explanatory message
- FR8: The app detects when an API call returns 401 and attempts a silent token refresh before falling back to the login screen

### Token Storage & Access

- FR9: The app stores authentication tokens (access token, refresh token, ID token) in the platform secure storage
- FR10: The app provides an auth state service that exposes the current authentication state (authenticated/unauthenticated), valid access token, and user identity claims to downstream consumers
- FR11: The app automatically includes a valid access token as a Bearer token in the Authorization header of all API requests to the backend

### Error Handling

- FR12: The app displays a "No internet connection" message within 500ms of network loss detection during login, token refresh, or API calls
- FR13: The app recovers gracefully from a deep link callback failure (network timeout, lost packet) and allows the user to retry the login flow
- FR14: The app displays a specific error state with a user-facing message and a recovery action within 2 seconds of any authentication operation failure, and never remains in an indefinite loading state for more than 10 seconds without user feedback

### Account Recovery

- FR15: A user can reset their password by tapping "Forgot password" on the Keycloak login page in the system browser
- FR16: A password reset link received by email opens the Keycloak password reset flow in the system browser (not intercepted by the app)

### Multi-Deployment Support

- FR17: Each institutional deployment has its own dedicated build with a unique app ID, Keycloak client, backend URL, and deep link scheme — all configured at build-time
- FR18: Each deployment has its own Keycloak client configured for secure mobile authentication with no client secret in the app binary
- FR19: A deployment operator can create a new deployment by following the documented guide (copy flavor template, create Keycloak client, build, test, ship)

### Deep Link Configuration

- FR20: The app registers a custom URL scheme per deployment for the OIDC authorization callback
- FR21: The app handles incoming cryptographic domain-verified deep links for password reset and email verification

### OIDC Configuration

- FR22: The app discovers OIDC endpoints (authorization, token, userinfo, end_session) from the identity provider's standard discovery document using the Keycloak URL configured at build-time

### Security

- FR23: The app enforces valid TLS certificate validation for all network connections (no certificate bypass)
- FR24: The app removes all legacy authentication code (custom login endpoints, password hashing, plaintext password handling)
- FR25: The app does not store authentication tokens, credentials, or PII in plaintext storage or logs

### Deployment

- FR26: The deployment guide documents the complete process for onboarding a new institutional deployment (deployment configuration, Keycloak client creation, deep link setup, build, test)
- FR27: The deployment guide documents the network prerequisites for air-gapped deployments (device must reach Keycloak on internal network, DNS configuration)
- FR28: The deployment guide documents the OS version policy trade-off (technical minimums vs. institutional security policies)

### Testing

- FR29: Unit tests cover the core auth logic (token refresh, session validation, error handling) in platform-agnostic code
- FR30: Integration tests cover the login, token refresh, logout, and error scenarios on Android
- FR31: The test suite runs in CI on Android for continuous validation

## Key Architectural Decisions

The following decisions were made during this PRD and differ from the initial technical specification in GitLab Issue #613. These decisions are final and should guide implementation.

### ADR1: Dedicated Keycloak Client Per Deployment

**Decision:** Each institutional deployment gets its own Keycloak OIDC client (e.g., `genie-mobile-itu`, `genie-mobile-agencyX`), configured as a public client with PKCE mandatory.

**#613 proposed:** Reuse the existing `genie-app` Keycloak client.

**Rationale:** Mobile apps are public clients — they cannot securely hold a client secret. Reusing `genie-app` (which has a secret for the web frontend) would require embedding that secret in the mobile binary, a security violation per RFC 8252. Additionally, each deployment has a different app ID and redirect URI, requiring distinct client configurations.

### ADR2: System Browser for Authentication

**Decision:** Use the system browser (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android) for the OIDC authorization flow, not an embedded webview.

**#613 proposed:** Did not explicitly specify the browser mechanism.

**Rationale:** RFC 8252 (OAuth 2.0 for Native Apps) recommends the system browser for security (prevents credential phishing, shares cookies for SSO) and UX (password managers, passkeys, familiar interface). `flutter_appauth` wraps this natively on both platforms.

### ADR3: Build-Time Configuration via Flutter Flavors

**Decision:** All deployment-specific configuration (app ID, Keycloak URL, client ID, backend URL, deep link scheme) is compiled at build-time via Flutter flavors. No runtime configuration.

**Rationale:** Each deployment already requires a dedicated build for app store submission with its own branding and signing. Adding runtime configuration would add complexity without benefit. Build-time is more secure (values cannot be modified post-build) and simpler (no bootstrap endpoint, no config validation).

### ADR4: Android as Primary CI Platform

**Decision:** Continuous integration and automated testing run on Android. iOS builds and tests are periodic, manual, and depend on teammate Mac availability.

**Rationale:** The team does not have a dedicated macOS build machine or Apple Developer account. Flutter's cross-platform architecture ensures code correctness for iOS, but continuous validation is only possible on Android. iOS App Store distribution is deferred to the Growth phase.

## Non-Functional Requirements

### Performance

- NFR1: Silent token refresh completes within 2 seconds for 95th percentile under normal network conditions, measured by automated integration test recording wall-clock time from refresh initiation to completion over 100 runs on a reference network (50ms RTT, 10Mbps)
- NFR2: The login screen is displayed within 1 second of app launch when no valid session exists, measured by platform startup time instrumentation (cold start)
- NFR3: The app processes the OIDC callback and establishes an authenticated session within 1 second of receiving the deep link redirect from the system browser, measured by timestamp delta between deep link intent received and auth state updated

### Reliability

- NFR4: All authentication error states display a user-visible error message and a recovery action (retry button or return to login) within 2 seconds of error detection. The app transitions to one of three defined states after any auth error: login screen, error screen with retry, or authenticated screen. Verified by automated UI tests triggering each error condition and asserting message visibility within 2 seconds
- NFR5: After any authentication error, the app is in one of three defined terminal states (login screen, error screen with recovery action, or authenticated screen). The app never remains in an intermediate loading state for more than 10 seconds without user feedback. Verified by state machine unit tests covering all error transitions
- NFR6: The auth state service recalculates state on every token operation. An expired or invalid token immediately triggers a state transition to unauthenticated. Verified by unit tests asserting no combination of expired token + authenticated state is possible

### Compatibility

- NFR7: The app binary size increase from the OIDC migration is less than 8MB per platform (Android APK, iOS IPA) compared to the pre-migration build, measured by comparing release build output sizes before and after migration
- NFR8: 100% of non-authentication user data (conversation history, preferences, cached content) is preserved across the app update, verified by pre/post update data comparison test on a reference device

### Observability

- NFR9: Authentication failures (login, refresh, logout) are logged at WARN level with the following fields: error_code, keycloak_endpoint, http_status, network_reachable, timestamp. Logs are accessible via device diagnostics (adb logcat / Xcode console) for 30 days. Verified by automated test injecting auth failures and asserting log output contains all required fields

### Accessibility

- NFR10: All authentication screens support platform-native accessibility features (VoiceOver on iOS, TalkBack on Android). All interactive elements have accessibility labels. Minimum touch target size is 44x44 points (iOS) / 48x48dp (Android). Authentication state is not indicated by color alone. Verified by platform accessibility inspector tools (Accessibility Inspector on iOS, Accessibility Scanner on Android)

## Out of Scope

The following items are explicitly excluded from this PRD and are deferred to Growth or Vision phases:

- **Biometric re-authentication** (Face ID, fingerprint) — Vision phase
- **Push notifications** — Vision phase (token refresh relies on foreground/background resume)
- **Offline mode** with cached data and deferred sync — Vision phase
- **Certificate pinning** — Growth phase (must be evaluated against air-gapped deployment constraints)
- **End-to-end automated tests on iOS** — Growth phase (requires macOS CI and Apple Developer account)
- **Multi-language app UI** — Flutter UI remains in English; i18n is handled server-side by Keycloak
- **Custom authentication flows** beyond standard OIDC — all auth flows use Keycloak's standard OIDC endpoints
