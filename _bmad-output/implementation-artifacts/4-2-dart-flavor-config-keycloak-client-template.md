# Story 4.2: Dart Flavor Config & Keycloak Client Template

Status: done

## Story

As a deployment operator,
I want a Keycloak OIDC client created automatically for each institutional deployment via keycloak-config-cli,
So that I don't have to manually configure clients in the Keycloak admin console.

## Context: Existing Implementation (Epic 4 Story 4.1)

**CRITICAL:** Story 4.1 created the iOS/Android build flavor infrastructure and the Dart flavor template file. This story adds the **Keycloak-side client configuration** and wires the env vars into the deployment `.env`.

### What Already Exists

**Dart flavor config** (`lib/config/`):
- `keycloak_config.dart` — `KeycloakConfig` data class + `getConfig()` using `String.fromEnvironment('FLAVOR')`
- `dev_config.dart`, `staging_config.dart`, `e2e_config.dart` — environment configs
- `flavors/itu.dart` — ITU production deployment config
- `flavors/template.dart` — deployment operator copy target (created in 4.1, includes comment about getConfig() update)

**Keycloak realm config** (`configs/keycloak/genie-realm.yaml`):
- Existing clients: `account`, `account-console`, `genie-app` (web frontend), `genie-proxy-client` (backend admin proxy), `dataprep-service-client`
- Uses `$(env:VARIABLE)` syntax for keycloak-config-cli variable substitution
- `IMPORT_VARSUBSTITUTION_ENABLED=true` set in docker-compose for the keycloak-config service

**Env template** (`env`):
- `KEYCLOAK_CLIENT_ID=genie-app` — web frontend client ID
- `KEYCLOAK_CLIENT_SECRET=` — web frontend client secret
- `KC_PROXY_CLIENT_SECRET=` — proxy client secret
- `KC_DATAPREP_CLIENT_SECRET=` — dataprep client secret
- No `KC_MOBILE_*` variables exist yet

**Build system** (from 4.1):
- Android: 4 product flavors (dev, staging, e2e, itu) with `manifestPlaceholders = [appAuthRedirectScheme: ...]`
- iOS: 12 XCConfig files, 4 Xcode schemes, Podfile with all build configs
- Build commands: `flutter build apk --flavor <name>`, `flutter build ipa --flavor <name>`

### What This Story Must Deliver

1. **Keycloak mobile client** in `genie-realm.yaml` — public client with PKCE, refresh token rotation, custom redirect URI from env
2. **Environment variables** in `env` template — `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME`
3. **Verification** that `getConfig()` returns correct config for all existing flavors — no code changes expected

## Acceptance Criteria

1. **AC1:** Given `genie-realm.yaml` is updated, when a mobile client section is added, then it defines: `clientId: $(env:KC_MOBILE_CLIENT_ID)`, `publicClient: true`, `pkce.code.challenge.method: S256`, `client.credentials.use.refresh.token: true` (refresh token rotation), `standardFlowEnabled: true`, `directAccessGrantsEnabled: false`
2. **AC2:** Given the mobile client section in `genie-realm.yaml`, when `redirectUris` is configured, then it uses `$(env:KC_MOBILE_REDIRECT_SCHEME)://callback` — the custom URL scheme from the environment
3. **AC3:** Given the operator adds `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` to the deployment `.env`, when `keycloak-config-cli` runs at container startup, then the mobile OIDC client is created automatically in Keycloak with the correct configuration (FR18)
4. **AC4:** Given `lib/config/flavors/template.dart` exists, when a new institution needs a deployment, then the template contains placeholder fields for: `keycloakUrl`, `clientId`, `redirectScheme`, `backendUrl` — **already exists from 4.1, verify no changes needed**
5. **AC5:** Given `getConfig()` is called with any registered flavor, when the corresponding `KeycloakConfig` is returned, then all fields are populated from the flavor's config file — **already works, verify no regression**
6. **AC6:** Given the `env` template, when `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` are documented, then deployment operators know to add these variables for each new institutional deployment

## Tasks / Subtasks

- [x] 1. Add mobile OIDC client to genie-realm.yaml (AC: 1, 2)
  - [x] 1.1 Add new client section after the existing `dataprep-service-client` block with `clientId: $(env:KC_MOBILE_CLIENT_ID)`
  - [x] 1.2 Configure as public client: `publicClient: true`, `standardFlowEnabled: true`, `directAccessGrantsEnabled: false`, `implicitFlowEnabled: false`, `serviceAccountsEnabled: false`
  - [x] 1.3 Set PKCE mandatory: `attributes.pkce.code.challenge.method: S256`
  - [x] 1.4 Enable refresh token rotation: `attributes.client.credentials.use.refresh.token: true`
  - [x] 1.5 Set redirect URI: `redirectUris: ["$(env:KC_MOBILE_REDIRECT_SCHEME)://callback"]`
  - [x] 1.6 Add comment block explaining the mobile client purpose and linking to deployment guide
- [x] 2. Add environment variables to env template (AC: 6)
  - [x] 2.1 Add `KC_MOBILE_CLIENT_ID=genie-mobile-itu` with comment explaining purpose and linking to flavor config
  - [x] 2.2 Add `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai` with comment explaining scheme coherence rule
  - [x] 2.3 Add both variables to the "Secrets" section comment block (no defaults — required for each deployment)
  - [x] 2.4 Add inline comments referencing the scheme coherence rule: `KC_MOBILE_REDIRECT_SCHEME` in `.env` must match `redirectScheme` in the Dart flavor config AND `appAuthRedirectScheme` in `build.gradle` AND `APP_AUTH_REDIRECT_SCHEME` in iOS XCConfig
- [x] 3. Verify existing Dart flavor config (AC: 4, 5)
  - [x] 3.1 Verify `flavors/template.dart` has all required placeholder fields (already created in 4.1)
  - [x] 3.2 Verify `getConfig()` returns correct config for all 4 flavors (dev, staging, e2e, itu)
  - [x] 3.3 Verify `flutter analyze` passes
- [x] 4. Verify keycloak-config-cli integration (AC: 3)
  - [x] 4.1 Verify `IMPORT_VARSUBSTITUTION_ENABLED=true` is set in docker-compose for the keycloak-config service (already exists)
  - [x] 4.2 Verify the `$(env:KC_MOBILE_CLIENT_ID)` and `$(env:KC_MOBILE_REDIRECT_SCHEME)` syntax is correct for keycloak-config-cli
  - [x] 4.3 Verify the mobile client section is valid YAML and follows the same structure as existing clients

## Dev Notes

### Architecture Compliance

- **ADR1: Dedicated Keycloak Client Per Deployment** — each deployment gets its own public client with PKCE mandatory
- **ADR3: Build-Time Configuration via Flutter Flavors** — all deployment-specific values compiled at build-time via `--flavor` flag
- **keycloak-config-cli** — uses `$(env:VARIABLE)` syntax (NOT `${env:VARIABLE}`). `IMPORT_VARSUBSTITUTION_ENABLED=true` must be set (already configured in docker-compose)

### Keycloak Client Configuration Details

The mobile OIDC client must be configured as:

```yaml
- clientId: $(env:KC_MOBILE_CLIENT_ID)
  enabled: true
  publicClient: true
  standardFlowEnabled: true
  directAccessGrantsEnabled: false
  implicitFlowEnabled: false
  serviceAccountsEnabled: false
  attributes:
    pkce.code.challenge.method: S256
    client.credentials.use.refresh.token: true
    oauth2.device.authorization.grant.enabled: false
    require.pushed.authorization.requests: false
  redirectUris:
    - $(env:KC_MOBILE_REDIRECT_SCHEME)://callback
```

**Why each setting:**
- `publicClient: true` — mobile apps cannot securely hold client secrets (RFC 8252)
- `directAccessGrantsEnabled: false` — ROPC is disabled; mobile uses Authorization Code + PKCE via system browser
- `pkce.code.challenge.method: S256` — PKCE mandatory for all mobile auth flows
- `client.credentials.use.refresh.token: true` — refresh token rotation: each refresh invalidates the old RT and issues a new one
- `redirectUris` — single URI using the custom URL scheme from the deployment env

### keycloak-config-cli Variable Substitution

**CRITICAL:** keycloak-config-cli uses `$(env:VARIABLE)` syntax — NOT `${env:VARIABLE}`. The prefix `$(env:` and suffix `)` are configurable via `IMPORT_VARSUBSTITUTION_PREFIX`/`IMPORT_VARSUBSTITUTION_SUFFIX`, but the defaults are used in this project. Never change `$(env:VAR)` to `${env:VAR}` — this breaks variable substitution at runtime.

### Scheme Coherence Rule

The `redirectScheme` in the Dart flavor config MUST match:
1. `appAuthRedirectScheme` in `android/app/build.gradle` `manifestPlaceholders`
2. `APP_AUTH_REDIRECT_SCHEME` in the iOS XCConfig
3. `KC_MOBILE_REDIRECT_SCHEME` in the deployment `.env`
4. `redirectUris[0]` in the Keycloak mobile client configuration

A mismatch causes silent OIDC callback failure — the browser redirects to the wrong scheme and the app never receives the authorization code.

### Env Template Structure

The new variables should be added near the existing Keycloak client configuration variables. Current relevant section in `env`:

```
# Section with existing client vars:
KEYCLOAK_CLIENT_ID=genie-app          # Web frontend client
KEYCLOAK_CLIENT_SECRET=              # Web frontend client secret
KEYCLOAK_PROXY_CLIENT_SECRET=        # Backend admin proxy client secret
KC_DATAPREP_CLIENT_SECRET=           # Dataprep service account secret
```

Add alongside these:
```
KC_MOBILE_CLIENT_ID=genie-mobile-itu  # Mobile OIDC client — change per deployment
KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai  # MUST match redirectScheme in Dart flavor config
```

### Existing File States (DO NOT MODIFY)

These files were created/modified in Story 4.1 and should NOT be changed by this story:

- `lib/config/keycloak_config.dart` — getConfig() works correctly for all flavors
- `lib/config/flavors/itu.dart` — ITU production config
- `lib/config/flavors/template.dart` — deployment operator template (created in 4.1)
- `lib/config/dev_config.dart` — dev environment config
- `lib/config/staging_config.dart` — staging config
- `lib/config/e2e_config.dart` — e2e test config
- `android/app/build.gradle` — product flavors and signing config
- `ios/Flutter/*.xcconfig` — per-flavor build configs
- `mobile/genie_ai_mobile/CLAUDE.md` — build documentation

### Files to Modify

1. `configs/keycloak/genie-realm.yaml` — add mobile client section
2. `env` — add KC_MOBILE_CLIENT_ID and KC_MOBILE_REDIRECT_SCHEME

### Testing Notes

- `flutter analyze` must pass (verify no regression from env/config changes)
- No Dart code changes expected — this story is primarily Keycloak config + env template
- keycloak-config-cli validation: the YAML structure must be valid and follow existing patterns
- The mobile client will be validated end-to-end when a deployment is tested with keycloak-config-cli running against a Keycloak instance

### References

- [Source: configs/keycloak/genie-realm.yaml] Existing client configurations and variable substitution patterns
- [Source: env] Existing environment variable structure
- [Source: docker-compose.yaml#keycloak-config] IMPORT_VARSUBSTITUTION_ENABLED=true configuration
- [Source: _bmad-output/planning-artifacts/architecture.md#Open Question 5] keycloak-config-cli with env vars for mobile client
- [Source: PRD#ADR1] Dedicated Keycloak Client Per Deployment — public client, PKCE mandatory
- [Source: PRD#FR18] Each deployment has its own Keycloak client with no client secret
- [Source: Story 4.1 Dev Notes#Scheme Coherence Rule] redirectScheme must match across all config layers
- [Source: project-context.md#Keycloak Config CLI] Variable substitution syntax rules

## Dev Agent Record

### Agent Model Used

glm-5-turbo (Claude Code CLI)

### Debug Log References

No issues encountered.

### Completion Notes List

- AC1: Mobile client added to genie-realm.yaml with all required fields (publicClient, PKCE S256, refresh token rotation, standardFlowEnabled, directAccessGrantsEnabled=false)
- AC2: redirectUris configured with `$(env:KC_MOBILE_REDIRECT_SCHEME)://callback`
- AC3: Verified IMPORT_VARSUBSTITUTION_ENABLED=true in docker-compose, $(env:...) syntax correct, YAML valid
- AC4: Verified flavors/template.dart has all required placeholder fields (keycloakUrl, realm, clientId, redirectScheme, backendUrl) — no changes needed
- AC5: Verified getConfig() returns correct config for all 4 flavors (dev, staging, e2e, itu) — no regression
- AC6: KC_MOBILE_CLIENT_ID and KC_MOBILE_REDIRECT_SCHEME added to env template with comprehensive inline documentation including scheme coherence rule

### Change Log

- 2026-04-28: Added mobile OIDC client section to configs/keycloak/genie-realm.yaml
- 2026-04-28: Added KC_MOBILE_CLIENT_ID and KC_MOBILE_REDIRECT_SCHEME to env template with scheme coherence documentation

### File List

- configs/keycloak/genie-realm.yaml (modified)
- env (modified)

### Review Findings

- [x] [Review][Patch] Missing env vars in docker-compose keycloak-config service [docker-compose.yaml:1187-1223] — Fixed: added `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` to keycloak-config service environment block.
- [x] [Review][Defer] No runtime validation of scheme coherence — deferred, pre-existing. The 4-layer scheme coherence rule (Dart config, Android build.gradle, iOS XCConfig, .env) is well-documented but not enforced programmatically. A mismatch causes silent OIDC callback failure. Design limitation documented in the spec.
- [x] [Review][Defer] No backchannel logout configuration — deferred, pre-existing. The mobile client lacks `backchannel.logout.session.required` and `backchannel.logout.url`. Not mentioned in spec, out of scope for this story.
- [x] [Review][Defer] Missing `revoke.refresh.token.on.use` attribute — deferred, pre-existing. The `CLAUDE.md` manual client creation docs mention this attribute but it is not in the spec. `client.credentials.use.refresh.token: true` covers the spec requirement.
