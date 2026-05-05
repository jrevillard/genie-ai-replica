# Story 5.1: Password Reset via Keycloak Browser

Status: done

## Story

As a user,
I want to reset my password by tapping "Forgot password" on the Keycloak login page,
So that I can regain access to my account without contacting an administrator.

## Acceptance Criteria

1. **Given** the user is on the Keycloak login page in the system browser
   **When** they tap "Forgot password"
   **Then** the Keycloak password reset flow is displayed — email input field, submit button (FR15)

2. **Given** the user submits their email on the password reset form
   **When** Keycloak sends a reset link by email
   **Then** the email contains a link to the Keycloak password reset page

3. **Given** the user taps the password reset link on their phone
   **When** the deep link opens
   **Then** it opens the Keycloak password reset flow in the **system browser** — not intercepted by the app (FR16)

4. **Given** the user completes the password reset in the browser
   **When** they return to the app and tap "Sign in"
   **Then** they can authenticate with their new password

5. **Given** the Keycloak login page is rendered
   **When** "Forgot password" is not available (disabled by admin)
   **Then** no "Forgot password" link is displayed — this is a Keycloak realm setting, not app-controlled

## Tasks / Subtasks

- [x] Task 1: Verify and fix Keycloak password reset configuration (AC: #1, #2, #5)
  - [x] 1.1 Verify `resetPasswordAllowed` in `configs/keycloak/genie-realm.yaml` (line ~9) — confirm it references `$(env:KEYCLOAK_RESET_PASSWORD)`
  - [x] 1.2 Verify `KEYCLOAK_RESET_PASSWORD` in the `env` template (line ~142) — currently commented out as `# KEYCLOAK_RESET_PASSWORD=true`. Uncomment it and set default to `true` so password reset is enabled by default. Add a comment explaining the setting and that operators can set it to `false` to disable "Forgot password"
  - [x] 1.3 Check if `KEYCLOAK_RESET_PASSWORD` is passed to the `keycloak-config` service in `docker-compose.yaml`. **Swarm constraint**: `env_file` does not work with `docker stack deploy`. If this var is used in `genie-realm.yaml` via `$(env:VAR)` substitution, it MUST be in the keycloak-config service `environment:` block for Swarm mode. Check whether the var is already there or needs to be added. Follow the same pattern as `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` (lines ~1202-1203)
  - [x] 1.4 Verify Keycloak's default browser authentication flow includes the "Reset Password" execution. Keycloak's built-in browser flow includes a "Reset Password" form by default when `resetPasswordAllowed` is true. No custom flow configuration should be needed — verify by checking that no custom `authenticationFlows` section exists in `genie-realm.yaml` (which would override defaults)
  - [x] 1.5 Verify SMTP configuration in `env` template (lines ~188-196): `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM`. These are required for Keycloak to send password reset emails. Ensure they are documented in the deployment guide

- [x] Task 2: Update deployment guide with password reset documentation (AC: #1, #2, #5)
  - [x] 2.1 Add a "Password Reset" section to `docs/mobile-deployment-guide.md` covering:
    - `KEYCLOAK_RESET_PASSWORD` env var — purpose, default value (`true`), how to disable
    - SMTP prerequisites — `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM` must be configured in `.env` for password reset emails to work
    - That "Forgot password" is a Keycloak realm setting — the app does not control its visibility. If disabled, no link appears on the Keycloak login page
    - Reference to Keycloak admin console for additional configuration (optional custom email templates, brute force detection, etc.)
  - [x] 2.2 Add password reset testing steps to the "Step 7: Validate" section of `docs/mobile-deployment-guide.md`:
    - Verify "Forgot password" link appears on Keycloak login page in system browser
    - Test password reset: submit email → receive email → tap link → reset password → sign in with new password
    - Verify password reset link opens in system browser (not intercepted by app)

- [x] Task 3: Verify password reset deep link behavior (AC: #3)
  - [x] 3.1 Verify that Keycloak's password reset email links use HTTPS URLs (e.g., `https://<keycloak-host>/realms/<realm>/login-actions/action?...`). These are NOT custom scheme URLs, so the system browser handles them by default
  - [x] 3.2 Verify the app's custom URL scheme (`<redirectScheme>://callback`) does NOT match Keycloak's HTTPS reset URLs — no interception possible
  - [x] 3.3 Verify `app_links` package is in `pubspec.yaml` but unused — no deep link listener code exists in `main.dart` or elsewhere. This means no incoming deep links are intercepted by the app. The OIDC callback is handled internally by `flutter_appauth`'s native `RedirectUriReceiverActivity` (Android) / URL scheme registration (iOS), which only matches the custom URL scheme
  - [x] 3.4 Document the current deep link behavior in the deployment guide: password reset links open in the system browser because (a) Keycloak uses HTTPS URLs, (b) the app only registers a custom URL scheme intent-filter for OIDC callbacks, (c) no Universal Links/App Links are configured for the Keycloak domain yet (Story 5.2 will add explicit domain verification)

## Dev Notes

### Nature of This Story

This is primarily a **Keycloak configuration + documentation** story. The password reset flow is a Keycloak built-in feature — the app does not implement any password reset logic. The "Forgot password" link appears on the Keycloak login page (rendered in the system browser), and the entire reset flow happens in Keycloak.

The acceptance criteria describe **behavioral verification** — ensuring the existing Keycloak password reset mechanism works correctly in the mobile OIDC context. The main implementation work is:
1. Ensuring the Keycloak configuration is correct and explicit
2. Documenting the flow for deployment operators
3. Verifying that the app does NOT intercept password reset links

### Why No Flutter Code Changes Are Expected

The password reset flow is entirely browser-based:
1. User taps "Sign in" → system browser opens Keycloak login page
2. User taps "Forgot password" on Keycloak's page → Keycloak shows reset form (all in browser)
3. User submits email → Keycloak sends reset email (Keycloak SMTP, no app involvement)
4. User taps reset link in email → system browser opens Keycloak reset page (HTTPS URL, not custom scheme)
5. User resets password → returns to app → taps "Sign in" → authenticates with new password

The app's role is limited to opening Keycloak in the system browser (already implemented in Story 1.3a). Everything else is Keycloak's responsibility.

### Critical: Deep Link Routing

The key behavioral requirement is AC3: password reset links must open in the **system browser**, not the app. This works correctly by default because:

1. **Keycloak uses HTTPS URLs** for password reset links (e.g., `https://keycloak.itu.int/realms/genie/login-actions/action?...`)
2. **The app only registers a custom URL scheme** intent-filter (`<redirectScheme>://callback`) via `flutter_appauth`'s `RedirectUriReceiverActivity`. This only matches URLs starting with the custom scheme, NOT HTTPS URLs
3. **`app_links` is installed but unused** — no `uriLinkStream` listener, no `getInitialLink()` call. The package does not intercept any links until code is added to use it (deferred to Story 5.2)
4. **No Universal Links/App Links configured** — no AASA file, no `assetlinks.json`, no `autoVerify` intent-filter. Without these, HTTPS links always go to the system browser

**Story 5.2 will add explicit Universal Links/App Links** to make this behavior more robust (preventing Android disambiguation dialogs). Story 5.1 establishes the baseline — the flow works because no interception mechanism exists yet.

### Keycloak Configuration Details

**`genie-realm.yaml` (line ~9):**
```yaml
resetPasswordAllowed: $(env:KEYCLOAK_RESET_PASSWORD)
```

**`env` template (line ~142):**
```
# KEYCLOAK_RESET_PASSWORD=true
```

**Issue:** The env var is commented out. When `KEYCLOAK_RESET_PASSWORD` is not set, `$(env:KEYCLOAK_RESET_PASSWORD)` in `genie-realm.yaml` resolves to an empty string. Keycloak's `keycloak-config-cli` may interpret this as `null`/`false`, effectively disabling password reset. The env var should be explicitly set to `true`.

**Keycloak default:** Keycloak's built-in default for `resetPasswordAllowed` is `true`. When `keycloak-config-cli` doesn't set this property (because the env var is missing), Keycloak keeps its default. However, relying on this implicit behavior is fragile — the env var should be explicit.

### Swarm Constraint (from Story 4.2)

Env vars used in `genie-realm.yaml` via `$(env:VARIABLE)` must be listed in the `keycloak-config` service `environment:` block in `docker-compose.yaml`. `env_file` does not work with `docker stack deploy`. If `KEYCLOAK_RESET_PASSWORD` is used in `genie-realm.yaml` and the keycloak-config service doesn't pass it explicitly, password reset will fail in Swarm deployments.

Check the keycloak-config service section in `docker-compose.yaml`. The mobile vars (`KC_MOBILE_CLIENT_ID`, `KC_MOBILE_REDIRECT_SCHEME`) are already at lines ~1202-1203 (added in Story 4.2). `KEYCLOAK_RESET_PASSWORD` may already be there (it's referenced in `genie-realm.yaml`), or it may need to be added.

### Legacy Code Inventory (DO NOT MODIFY — Cleaned in Epic 6)

The following legacy code is related to password reset but is **explicitly out of scope** for Story 5.1. All items will be cleaned up in Epic 6 (Stories 6.2 and 6.3).

| File | Lines | What It Does | Cleanup Story |
|------|-------|-------------|---------------|
| `lib/components/auth/password_reset_initiate_screen.dart` | — | Legacy screen: email input → calls `PasswordProxy.forgotPassword()` | 6.2 (delete) |
| `lib/components/auth/password_reset_confirm_screen.dart` | — | Legacy screen: new password + token → calls `PasswordProxy.resetPassword()` | 6.2 (delete) |
| `lib/services/password_proxy.dart` | — | Legacy proxy: `forgotPassword()`, `resetPassword()` → backend API `/auth/forgot-password`, `/auth/reset-password` | 6.2 (delete) |
| `lib/main.dart` | ~25-26 | `import` of both legacy screens | 6.2 (remove imports) |
| `lib/main.dart` | ~175-176 | Route `/password-reset` → `PasswordResetInitiateScreen()` | 6.2 (remove route) |
| `lib/main.dart` | ~180-189 | Route `/password-reset/confirm` → `PasswordResetConfirmScreen()` with token param | 6.2 (remove route) |

**Backend status:** Already clean — no legacy password reset endpoints remain in `components/gov-chat-backend/`. The backend cleanup was completed in a prior initiative.

**Important:** The `main.dart` routes still exist and are reachable. If a user somehow navigates to `/password-reset`, the legacy screen would render and call `PasswordProxy` against a non-existent backend endpoint. This is harmless dead code but could confuse developers. Epic 6 will remove it.

### Relationship to Story 5.2

| Aspect | Story 5.1 | Story 5.2 |
|--------|-----------|-----------|
| Password reset behavior | Works by default (HTTPS URLs → system browser) | Same behavior, made explicit via Universal Links/App Links |
| Deep link interception | None — no `app_links` integration | `app_links` integrated, DeepLinkHandler implemented |
| Universal Links/App Links | Not configured | `apple-app-site-association` and `assetlinks.json` hosted on Keycloak domain |
| Deployment guide | Password reset config + testing section | Universal Links/App Links setup section |
| `app_links` package | Present but unused | Active: `uriLinkStream`, `getInitialLink` |

Story 5.1 can be implemented independently. Story 5.2 adds explicit domain verification that makes the "links open in browser" behavior reliable on all Android versions (preventing potential disambiguation dialogs).

### SMTP Configuration (Required for Password Reset)

Keycloak needs SMTP to send password reset emails. The `env` template already has all required variables:
```
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=genie@example.com
EMAIL_PASSWORD=changeme
EMAIL_FROM=genie@example.com
```

These are passed to the Keycloak service. If SMTP is not configured, Keycloak cannot send reset emails, and the "Forgot password" flow will fail silently (Keycloak logs an error but shows no user-facing message). The deployment guide should document this prerequisite.

### Project Structure Notes

- Modified files: `env` (uncomment/set `KEYCLOAK_RESET_PASSWORD`), possibly `docker-compose.yaml` (Swarm env var passthrough)
- Modified docs: `docs/mobile-deployment-guide.md` (add password reset section + testing steps)
- No Flutter code changes expected
- No new files expected
- Legacy files documented in "Legacy Code Inventory" section above — not touched in this story, cleaned in Epic 6

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1] — Acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 5 Note] — `app_links` deferred to Epic 5, unused until Story 5.2
- [Source: _bmad-output/planning-artifacts/architecture.md#D6] — Deep link strategy: custom URL scheme for OIDC, Universal Links/App Links for password reset
- [Source: _bmad-output/planning-artifacts/architecture.md#Account management migration] — Legacy flows replaced by Keycloak account console
- [Source: configs/keycloak/genie-realm.yaml#line ~9] — `resetPasswordAllowed` configuration
- [Source: configs/keycloak/genie-realm.yaml#lines ~18-26] — SMTP email configuration
- [Source: env#line ~142] — `KEYCLOAK_RESET_PASSWORD` env var (currently commented out)
- [Source: env#lines ~188-196] — SMTP configuration variables
- [Source: Story 4.2] — Swarm constraint: env vars in `genie-realm.yaml` must be in keycloak-config `environment:` block
- [Source: Story 4.4] — Deployment guide structure and conventions

### Previous Story Intelligence

**Story 4.1** established:
- Flutter flavor build system with per-deployment app IDs
- Build commands use `--flavor <name>` syntax

**Story 4.2** established:
- `genie-realm.yaml` uses `$(env:VARIABLE)` substitution syntax for keycloak-config-cli
- Mobile env vars are passed to keycloak-config service in `docker-compose.yaml` (lines ~1202-1203)
- **Swarm constraint**: `env_file` does not work with `docker stack deploy`. Each env var used in `genie-realm.yaml` must be explicitly in the `environment:` block

**Story 4.3** established:
- Custom URL scheme registered per flavor via `appAuthRedirectScheme` in `build.gradle`
- Verification procedures for URL scheme registration

**Story 4.4** established:
- Deployment guide at `docs/mobile-deployment-guide.md` with 7-step onboarding flow
- Documentation style: imperative mood, concrete examples, exact file paths, reference existing docs
- Guide structure: Steps 1-7 (env, Keycloak client, scheme coherence, flavor config, signing, build, validate)

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

- Task 1: Verified Keycloak password reset configuration. `resetPasswordAllowed` references `$(env:KEYCLOAK_RESET_PASSWORD)` in `genie-realm.yaml`. Docker-compose already defaults to `true` (line 1208: `${KEYCLOAK_RESET_PASSWORD:-true}`) — no `env` template change needed. Confirmed env var passed to keycloak-config service for Swarm mode. No custom auth flows exist — Keycloak default browser flow includes Reset Password. SMTP vars documented in `env` template.
- Task 2: Added "Password Reset" section to `docs/mobile-deployment-guide.md` covering env vars, SMTP prerequisites, how the flow works, and optional Keycloak Admin Console customization. Added Step 7.6 with password reset testing procedure.
- Task 3: Verified deep link behavior. Keycloak uses HTTPS URLs for reset links (not custom scheme). `app_links` package is installed but unused — no deep link interception. Behavior documented in deployment guide.

### File List

- `docs/mobile-deployment-guide.md` (modified — added Password Reset section and Step 7.6)
- `_bmad-output/implementation-artifacts/5-1-password-reset-via-keycloak-browser.md` (modified — task tracking)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status updates)

### Review Findings

- [x] [Review][Patch] Improve `KEYCLOAK_RESET_PASSWORD` comment in `env` to mention docker-compose fallback (`${KEYCLOAK_RESET_PASSWORD:-true}` at line 1208) — `env:419-422`
- [x] [Review][Patch] Add SMTP prerequisite check at the start of Step 7.6 — `docs/mobile-deployment-guide.md:310`
- [x] [Review][Patch] Document that `keycloak-config` service must be restarted after changing `KEYCLOAK_RESET_PASSWORD` — `docs/mobile-deployment-guide.md`
- [x] [Review][Patch] Add note about Android disambiguation dialog when tapping HTTPS reset links — `docs/mobile-deployment-guide.md`
- [x] [Review][Patch] Add negative test case for AC5 (verify link disappears when `KEYCLOAK_RESET_PASSWORD=false`) — `docs/mobile-deployment-guide.md:316`
- [x] [Review][Defer] Legacy `/password-reset` routes still navigable in `main.dart` — `mobile/genie_ai_mobile/lib/main.dart:175-189` — deferred, pre-existing (Epic 6)
- [x] [Review][Defer] Keycloak Admin Console `resetCredentials` flow verification not documented — deferred, pre-existing (operational risk)

## Change Log

- Added "Password Reset" section to deployment guide (config, SMTP prerequisites, flow description, customization)
- Added Step 7.6 "Verify Password Reset" testing procedure to deployment guide
- Verified deep link behavior: Keycloak HTTPS URLs not intercepted by app
