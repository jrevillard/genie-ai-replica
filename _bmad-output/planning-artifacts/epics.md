---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
workflowType: 'epics-and-stories'
project_name: 'genie-ai'
user_name: 'Jerome'
date: '2026-03-30'
---

# genie-ai - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for genie-ai, decomposing the requirements from the PRD and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: End user can authenticate via Keycloak using institutional credentials (SSO) without creating a GENIE.AI-specific account
FR2: End user can authenticate via Keycloak using local credentials managed directly in Keycloak (isolated/air-gapped deployment)
FR3: IT administrator can connect an external identity provider (Google, Microsoft Entra ID, institutional IdP) to GENIE.AI by configuring only Keycloak — without any GENIE.AI code or configuration changes
FR4: IT administrator can configure multiple Keycloak realms within the same Keycloak instance, each with isolated user populations and role mappings
FR5: System can validate authentication tokens from multiple Keycloak realms via JWKS, supporting simultaneous multi-issuer token validation within a single deployment
FR6: End user can transparently re-authenticate when Keycloak session expires, without manual intervention
FR7: IT administrator can deploy complete GENIE.AI stack with Keycloak included using single Docker Compose command
FR8: Keycloak container starts with pre-configured realm, OIDC client, and default admin user — no manual Keycloak setup after deployment
FR9: IT administrator can deploy GENIE.AI with Kong API gateway or without Kong, using separate Docker Compose configurations
FR10: System functions fully offline after initial setup (sovereign/air-gapped deployment) — no external API calls for token validation or user management
FR11: IT administrator can configure all required secrets (passwords, hostnames) via single `.env` file
FR12: System validates Keycloak tokens at backend level independently — fully autonomous without requiring Kong
FR13: When Kong is deployed, system provides additional token validation layer with multi-issuer/multi-realm support at API gateway level
FR14: System uses token passthrough architecture — Keycloak tokens are validated directly without issuing GENIE.AI-specific tokens
FR15: System invalidates active session when corresponding Keycloak user is deleted or disabled
FR16: Frontend stores access tokens in memory (not persistent storage) and manages token lifecycle transparently via OIDC client library
FR17: End user can log out and terminate session across the application
FR18: System automatically creates user record in ArangoDB on first successful Keycloak authentication (JIT provisioning) using composite `{iss}#{sub}` identity key
FR19: Functional administrator can manage user accounts (create, modify, disable, delete) entirely within Keycloak admin console — without interacting with GENIE.AI
FR20: Functional administrator can assign roles and group memberships to users via Keycloak, with role changes reflected on user's next login
FR21: Functional administrator can map external IdP attributes to Keycloak realm roles via Keycloak protocol mappers
FR22: System enforces authentication on protected API routes by validating Keycloak tokens
FR23: System allows unauthenticated access to public routes (/health, /api-docs, static assets)
FR24: System injects authenticated user identity (user ID, roles) as headers to upstream services via Kong or backend
FR25: System provides Swagger UI with Keycloak OIDC "Authorize" button for authenticated testing of protected endpoints
FR26: Frontend automatically redirects unauthenticated users to Keycloak login page — no GENIE.AI-specific login page exists
FR27: System displays clear error message when authentication fails (invalid credentials, external IdP unreachable, or network failure)
FR28: System displays clear authorization error message when authenticated user has no GENIE.AI role assigned
FR29: System handles token validation failures gracefully (expired, malformed, or revoked tokens) and prompts user to re-authenticate
FR30: System detects when Keycloak service is unavailable and communicates service degradation appropriately
FR31: System encrypts all communication in transit
FR32: System produces authentication logs (login, logout, token validation events) reviewable by external auditor
FR33: System supports configurable log retention policies for authentication-related data
FR34: System supports right to erasure — user identity data stored in ArangoDB can be deleted upon Keycloak account deletion
FR35: System ensures session data does not persist beyond session lifetime
FR36: System ensures all user identity data (tokens, profiles, sessions) remains within institution's infrastructure — no data leaves deployment boundary
FR37: Backend communicates with OPEA microservices using existing service-to-service authentication mechanism — unchanged by Keycloak integration
FR38: Backend passes authenticated user identity to OPEA microservices via existing payload structure (including `user_id`) — OPEA remains Keycloak-agnostic

### NonFunctional Requirements

NFR1: All authentication tokens validated using OIDC with PKCE — authorization code flow without PKCE prohibited
NFR2: All communication between client, backend, and Keycloak encrypted in transit (TLS 1.2+)
NFR3: Access tokens stored in browser memory only — never persisted to localStorage, sessionStorage, or cookies
NFR4: Keycloak tokens validated independently by backend via JWKS — backend never depends on external service to determine if token is valid
NFR5: JWT validation includes issuer (iss), audience (aud), and expiration (exp) claims verification
NFR6: When revoked Keycloak token presented for validation, backend rejects it
NFR7: Downstream OPEA services never receive raw IdP tokens — only signed headers injected by backend or Kong
NFR8: Backend remains operational when Kong is unavailable (Kong is optional by design)
NFR9: When Keycloak unavailable, system returns HTTP 503 with clear service degradation message — not unhandled error
NFR10: JWKS public keys cached at backend level with TTL shorter than Keycloak key rotation interval — on token validation failure (401), system force-refreshes JWKS cache before rejecting token
NFR11: Health check endpoint (/health) available without authentication and verifies Keycloak OIDC discovery endpoint (/.well-known/openid-configuration) is reachable — returns 200 with `keycloak: unreachable` flag if not
NFR12: All authentication logs include timestamps, user identity (via `{iss}#{sub}`), and event type — sufficient for external security audit review
NFR13: Authentication log retention configurable — minimum 90 days, maximum 12 months (for GDPR data minimization)
NFR14: Session data automatically purged when exceeds session lifetime — no manual cleanup required
NFR15: User identity data supports complete deletion upon request (right to erasure / GDPR Article 17) — deletion covers both ArangoDB records and Keycloak user data
NFR16: All user identity data (tokens, profiles, sessions) remains within institution's deployment boundary — no external data transmission for authentication or identity purposes
NFR17: Keycloak login page WCAG 2.1 AA compliance is deploying institution's responsibility — GENIE.AI provides documented deployment guidance for Keycloak theme customization
NFR18: Keycloak configuration and user data backup is deploying institution's responsibility — GENIE.AI documents what must be backed up (Keycloak database, realm configuration, client secrets) as part of deployment guide
NFR19: Token validation at backend (JWKS verification + ArangoDB user lookup) completes within 500ms under normal operating conditions
NFR20: Initial OIDC authentication redirect flow (browser → Keycloak → callback → authenticated state) completes within 3 seconds under normal network conditions
NFR21: System supports at least 500 concurrent authenticated sessions per Keycloak realm without degradation in authentication response times
NFR22: OIDC integration works with any standard-compliant external IdP (Google, Microsoft Entra ID, institutional IdPs) — no IdP-specific code in GENIE.AI
NFR23: System works with Keycloak 26.x (current stable) and supports upgrade to Keycloak 27.x without GENIE.AI code changes
NFR24: Frontend supports latest 2 versions of Chrome, Firefox, Safari, and Edge — no IE11 or legacy browser support

### Additional Requirements

- Backend: CommonJS only (`require`/`module.exports`), no ES imports — per project-context.md
- Frontend: Vue 3 Options API only, no Composition API or `<script setup>` — per project-context.md
- JWKS cache: Map multi-issuer keyed by `{iss}`, TTL 5 minutes, force-refresh on 401 with two-attempt pattern
- user_id for OPEA: `{iss}#{sub}` composite — guarantees uniqueness across realms
- Multi-tenancy: Keycloak Organizations (v26) default, multi-realm ready at no extra cost
- ArangoDB users schema: composite key `iss_sub` (unique index), `email` (persistent index), atomic UPSERT for JIT provisioning, soft delete with PII anonymization
- Keycloak init: custom Docker image `genie-keycloak-config` based on `keycloak-config-cli`, YAML config baked into image, secrets injected via environment variables — no bind mounts
- Frontend OIDC: standalone service class `src/services/keycloakAuthService.js` wrapping `oidc-client-ts` UserManager, consumed by Vuex store
- Vuex auth module: replaces existing module entirely — no coexistence with old auth
- Auth error response format: `{ error: "ERROR_CODE", message: "description", details: {} }` with standardized codes (TOKEN_INVALID, TOKEN_EXPIRED, INSUFFICIENT_ROLES, PROVISIONING_FAILED, AUTH_SERVICE_UNAVAILABLE)
- Audit log format: `{ event, timestamp, userId, issuer }` with event types: login_success, login_failed, logout, token_refreshed, token_validation_failed, user_provisioned
- Downstream headers: `X-User-Id` ({iss}#{sub}), `X-User-Roles` (comma-separated), `X-Issuer` (issuer URL)
- OIDC callback routes (public): `GET /api/auth/callback`, `GET /api/auth/logout/callback`
- Health check: returns 200 with `keycloak: unreachable` flag in body when Keycloak is down (not 503)
- Shared test mock fixture: `__tests__/mocks/mockJwtPayload.js` mandatory for all auth tests
- Cleanup: audit `auth-service.js` (935 lines) for reusable utilities before deletion, dedicated cleanup step for broken imports
- Environment variables: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_ADMIN_PASSWORD`

### FR Coverage Map

### FR Coverage Map

| FR | Epic | Notes |
|----|------|-------|
| FR1 | Epic 1 | SSO via Keycloak |
| FR2 | Epic 1 | Local credentials in Keycloak |
| FR3 | Epic 1 | External IdP configuration via Keycloak only |
| FR4 | Epic 2 | Multi-realm configuration |
| FR5 | Epic 2 | Multi-issuer JWKS validation |
| FR6 | Epic 1 | Transparent re-authentication |
| FR7 | Epic 1 | Single Docker Compose deployment |
| FR8 | Epic 1 | Pre-configured Keycloak (custom image) |
| FR9 | Epic 2 | With/without Kong deployment options |
| FR10 | Epic 1 | Offline/air-gapped operation |
| FR11 | Epic 1 | Single `.env` secrets configuration |
| FR12 | Epic 2 | Backend-independent token validation |
| FR13 | Epic 2 | Kong multi-issuer token validation |
| FR14 | Epic 2 | Token passthrough architecture |
| FR15 | Epic 3 | Session invalidation on user disable/delete |
| FR16 | Epic 1 | In-memory token storage, OIDC client library |
| FR17 | Epic 3 | Logout across application |
| FR18 | Epic 1 & Epic 3 | JIT provisioning (creation in Epic 1, lifecycle in Epic 3) |
| FR19 | Epic 3 | User management via Keycloak admin console |
| FR20 | Epic 3 | Role assignment via Keycloak |
| FR21 | Epic 3 | External IdP attribute mapping |
| FR22 | Epic 1 | Protected route authentication |
| FR23 | Epic 1 | Public route access |
| FR24 | Epic 2 | User identity headers to upstream |
| FR25 | Epic 2 | Swagger UI with OIDC Authorize |
| FR26 | Epic 1 | Redirect to Keycloak login |
| FR27 | Epic 2 | Auth failure error messages |
| FR28 | Epic 2 | Authorization error messages |
| FR29 | Epic 1 & Epic 2 | Token validation failure handling (both layers) |
| FR30 | Epic 2 | Keycloak unavailable detection |
| FR31 | Cross-cutting | TLS 1.2+ — prerequisite, not in any epic |
| FR32 | Epic 4 | Authentication audit logs |
| FR33 | Epic 4 | Configurable log retention |
| FR34 | Epic 3 | Right to erasure |
| FR35 | Epic 3 | Session data purging |
| FR36 | Cross-cutting | Data residency — prerequisite, not in any epic |
| FR37 | Epic 2 | OPEA service-to-service auth unchanged |
| FR38 | Epic 2 | OPEA user_id via existing payload structure |

## Epic List

### Epic 1: Keycloak Foundation & User Authentication

**Goal:** Establish Keycloak as the sole identity provider, deliver containerized deployment with pre-configuration, implement frontend OIDC integration with in-memory token storage, enforce route-level authentication, and provision users in ArangoDB on first login.

**FRs:** FR1, FR2, FR3, FR6, FR7, FR8, FR10, FR11, FR16, FR18, FR22, FR23, FR26, FR29

---

### Epic 2: Secure API Access & Resilient Authentication

**Goal:** Ensure every API request is authenticated with defense-in-depth validation, provide IT administrators with flexible deployment options (with or without Kong gateway), deliver clear error feedback when authentication or authorization fails, and guarantee that OPEA AI services continue working identically regardless of the new auth layer.

**FRs:** FR4, FR5, FR9, FR12, FR13, FR14, FR24, FR25, FR27, FR28, FR29, FR30, FR37, FR38

---

### Epic 3: Session Management, User Lifecycle & GDPR

**Goal:** Handle logout, session invalidation on user disable/delete, user lifecycle management via Keycloak (roles, groups, external IdP attribute mapping), and GDPR compliance (right to erasure, session data purging).

**FRs:** FR15, FR17, FR18, FR19, FR20, FR21, FR34, FR35

---

### Epic 4: Audit Logging & Compliance Reporting

**Goal:** Produce structured authentication audit logs with configurable retention policies for external security audit review.

**FRs:** FR32, FR33

---

### Cross-Cutting Prerequisites (not in any epic)

- **FR31** (TLS 1.2+): Validated via AC in Stories 1.1, 1.4, 2.4 — infrastructure enforces TLS at all layers
- **FR36** (Data residency): Validated via AC in Story 1.10 — architectural guarantee, no data leaves deployment boundary
- **NFR2** (TLS 1.2+): Covered by Stories 1.1, 1.4, 2.4
- **NFR9** (Keycloak unavailable): Story 2.7 — returns 200 with `keycloak: unreachable` flag (not 503)
- **NFR16** (Data residency): Story 1.10
- **NFR17** (WCAG): Keycloak deployment institution's responsibility — documented in deployment guide
- **NFR18** (Backup): Keycloak configuration and user data backup — documented in deployment guide
- **NFR23** (Keycloak compat): Story 1.1 — Keycloak 26.x with non-deprecated APIs only
- **NFR24** (Browser support): Story 1.5 — latest 2 versions of Chrome, Firefox, Safari, Edge

---

## Epic 1: Keycloak Foundation & User Authentication

Establish Keycloak as the sole identity provider, deliver containerized deployment with pre-configuration, implement frontend OIDC integration with in-memory token storage, enforce route-level authentication, and provision users in ArangoDB on first login.

### Story 1.1: Keycloak Container with Pre-configured Realm & OIDC Client

As a DevOps engineer / IT administrator,
I want a custom Docker image `genie-keycloak-config` that starts Keycloak with a pre-configured realm, OIDC client, and default admin user,
So that no manual Keycloak setup is required after deployment.

**Acceptance Criteria:**

**Given** the `genie-keycloak-config` Docker image is built
**When** the container starts via Docker Compose
**Then** a realm (configurable via `KEYCLOAK_REALM`, default `genie`) exists with an OIDC client configured
**And** a default admin user exists with credentials from `KEYCLOAK_ADMIN_PASSWORD`
**And** the OIDC client has `Authorization Code Flow with PKCE` enabled (NFR1)
**And** the realm OIDC discovery endpoint `/.well-known/openid-configuration` is reachable
**And** no bind mounts are used — all configuration is baked into the image (D6)
**And** all communication between Keycloak and other services uses TLS 1.2+ (NFR2)
**And** the `keycloak-config-cli` YAML configuration uses only Keycloak 26.x supported APIs — no deprecated admin resources (NFR23)

---

### Story 1.2: Environment-Driven Keycloak Configuration via `.env`

As an IT administrator,
I want to configure all Keycloak-related secrets via a single `.env` file at the project root,
So that I can set up the deployment without editing multiple configuration files.

**Acceptance Criteria:**

**Given** the project root `.env` file
**When** Docker Compose starts the Keycloak service
**Then** `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, and `KEYCLOAK_ADMIN_PASSWORD` are injected as environment variables into the `genie-keycloak-config` container
**And** the `keycloak-config-cli` tool resolves these variables in the YAML configuration at startup
**And** the `env` template (committed to git) documents all Keycloak variables with placeholders
**And** the `.env` file is gitignored per project convention

---

### Story 1.3: Backend Auth Middleware — Protected & Public Routes

As a backend developer,
I want an Express middleware that validates Keycloak tokens on protected routes while leaving public routes accessible,
So that API endpoints are secured by default.

**Acceptance Criteria:**

**Given** the Express backend is running with Keycloak available
**When** a request hits a protected route (e.g. `/api/chat/*`, `/api/users/*`) without a valid `Authorization: Bearer` header
**Then** the middleware returns HTTP 401 with `{ error: "TOKEN_INVALID", message: "...", details: {} }`
**And** public routes (`/health`, `/api-docs`, static assets) return their response without requiring a token (FR23)
**And** the middleware extracts `iss`, `sub`, `exp`, `aud` claims from the JWT for downstream use
**And** invalid token format returns 401 with `TOKEN_INVALID` error code

---

### Story 1.4: Frontend OIDC Service Class & Vuex Auth Module

As an end user,
I want to authenticate via Keycloak using my institutional or local credentials,
So that I can access GENIE.AI without creating a separate account.

**Acceptance Criteria:**

**Given** the frontend is running and Keycloak is available
**When** the OIDC service `src/services/keycloakAuthService.js` initializes
**Then** it creates a `UserManager` from `oidc-client-ts` with PKCE enabled (NFR1)
**And** access tokens are stored in JavaScript memory only — never in localStorage, sessionStorage, or cookies (NFR3)
**And** the Vuex auth module replaces the existing auth module entirely (no coexistence)
**And** the auth module exposes `isLoggedIn`, `user`, `accessToken` as computed state
**And** both SSO (institutional credentials) and local Keycloak credentials work (FR1, FR2)
**And** the OIDC service communicates with Keycloak over TLS 1.2+ (NFR2)

---

### Story 1.5: Frontend Login Redirect & Auth Guard

As an end user,
I want to be automatically redirected to the Keycloak login page when I'm not authenticated,
So that I don't need to navigate to a GENIE.AI-specific login page.

**Acceptance Criteria:**

**Given** an unauthenticated user visits any protected frontend route
**When** the Vue router navigation guard triggers
**Then** the user is redirected to the Keycloak login page (FR26)
**And** after successful authentication, the user is redirected back to the originally requested route
**And** no GENIE.AI-specific login page exists in the application
**And** the full OIDC flow (browser → Keycloak → callback → authenticated state) completes within 3 seconds under normal conditions (NFR20)
**And** the login redirect and OIDC flow work on the latest 2 versions of Chrome, Firefox, Safari, and Edge (NFR24)

---

### Story 1.6: JIT User Provisioning in ArangoDB

As a backend system,
I want to automatically create a user record in ArangoDB on first successful Keycloak authentication,
So that every authenticated user has a local profile without manual provisioning.

**Acceptance Criteria:**

**Given** a user has successfully authenticated via Keycloak and the backend middleware validates the token
**When** no user record exists in ArangoDB for the composite key `{iss}#{sub}`
**Then** a new user document is created with `iss_sub` as the unique key and `email` from the token (FR18)
**And** if a user record already exists, the existing record is returned (atomic UPSERT)
**And** the `iss_sub` field has a unique index and `email` has a persistent index (D1)
**And** subsequent logins for the same user do not create duplicate records

---

### Story 1.7: Transparent Re-authentication on Session Expiry

As an end user,
I want my session to be silently refreshed when my Keycloak token expires,
So that I don't need to manually re-authenticate during active use.

**Acceptance Criteria:**

**Given** an authenticated user has an active session with a valid refresh token
**When** the access token expires
**Then** the `oidc-client-ts` UserManager silently refreshes the access token using the refresh token (FR6)
**And** the Vuex auth module updates `accessToken` in state without user interaction
**And** if the refresh token is also expired, the user is redirected to the Keycloak login page
**And** in-flight API requests that fail with 401 are retried once after a successful token refresh

---

### Story 1.8: Token Validation Failure Handling (Backend Response Format)

As a backend developer,
I want the auth middleware to return a standardized error response format for token validation failures,
So that the frontend can consistently parse and display authentication errors.

**Acceptance Criteria:**

**Given** a request is made with an invalid, expired, or malformed token
**When** the backend middleware validates the token
**Then** the response follows the standardized format `{ error: "ERROR_CODE", message: "...", details: {} }` (FR29)
**And** an expired token returns `TOKEN_EXPIRED`, a malformed token returns `TOKEN_INVALID`, a revoked token returns `TOKEN_INVALID`
**And** the error response does not expose internal implementation details (no stack traces, no token payloads)

---

### Story 1.9: External IdP Connection via Keycloak Only

As an IT administrator,
I want to connect an external identity provider (Google, Microsoft Entra ID, institutional IdP) by configuring only Keycloak,
So that no GENIE.AI code or configuration changes are required to support new identity providers.

**Acceptance Criteria:**

**Given** Keycloak admin console is accessible
**When** an IT administrator adds an external IdP (e.g. Google) via the Keycloak realm configuration
**Then** GENIE.AI users can authenticate via that IdP without any application changes (FR3)
**And** no GENIE.AI-specific code, configuration, or redeployment is needed
**And** the external IdP login flow follows the same OIDC redirect pattern as local authentication
**And** any standard-compliant OIDC IdP works (NFR22)
**And** this story covers IdP connection only — role/attribute mapping is handled in Story 3.4

---

### Story 1.10: Offline/Air-Gapped Deployment Validation

As an IT administrator in a sovereign deployment,
I want the entire authentication system to function without any external network calls,
So that GENIE.AI meets air-gapped/offline deployment requirements.

**Acceptance Criteria:**

**Given** the GENIE.AI stack is deployed in an air-gapped environment
**When** a user authenticates via Keycloak (local credentials only)
**Then** all token validation happens locally via JWKS — no external API calls are made (FR10, NFR4)
**And** the `genie-keycloak-config` image and all dependencies are available from local container registry
**And** the Keycloak container starts and operates without reaching external URLs
**And** the frontend OIDC flow completes entirely within the deployment boundary
**And** all user identity data (tokens, profiles, sessions) remains within the deployment boundary — no external data transmission for authentication purposes (FR36, NFR16)

---

### Story 1.11: Remove Legacy Authentication Service

As a developer,
I want the old local authentication system to be completely removed from the codebase,
So that no dead code, unused dependencies, or legacy auth endpoints remain that could cause confusion or security issues.

**Acceptance Criteria:**

**Given** the new Keycloak-based authentication is fully implemented (Stories 1.3, 1.4)
**When** the legacy `auth-service.js` (935 lines) and related files are reviewed for reusable utilities
**Then** any reusable utility functions are extracted and migrated to appropriate modules before deletion
**And** the legacy `auth-service.js` file is deleted from the codebase
**And** all imports referencing the deleted file are removed or updated — no broken imports remain
**And** no legacy auth API endpoints (`/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, etc.) remain accessible in the backend routes
**And** the application builds and starts without errors after removal
**And** the existing test suite passes with all legacy auth tests removed or updated

---

## Epic 2: Secure API Access & Resilient Authentication

Ensure every API request is authenticated with defense-in-depth validation, provide IT administrators with flexible deployment options (with or without Kong gateway), deliver clear error feedback when authentication or authorization fails, and guarantee that OPEA AI services continue working identically regardless of the new auth layer.

### Story 2.1: Backend JWKS Token Validation with `jose` Library

As a backend system,
I want to validate Keycloak JWTs independently using JWKS public keys via the `jose` library,
So that the backend never depends on an external service to determine if a token is valid.

**Acceptance Criteria:**

**Given** the backend is running and Keycloak is available
**When** a request arrives with a valid `Authorization: Bearer` token on a protected route
**Then** the middleware fetches the JWKS public keys from `{iss}/.well-known/jwks.json` and verifies the token signature (NFR4)
**And** the validation checks `iss`, `aud`, and `exp` claims (NFR5)
**And** a revoked token is rejected with 401 (NFR6)
**And** validation completes within 500ms under normal conditions (NFR19)
**And** the `jose` library is used via CommonJS `require()` (project convention)

---

### Story 2.2: JWKS Force-Refresh on Validation Failure

As a backend system,
I want to force-refresh the JWKS cache when token validation fails with a valid expiration,
So that token validation is resilient to Keycloak key rotation without user disruption.

**Note:** Multi-issuer JWKS resolution and caching are already implemented (Story 1.9 OIDC discovery refactor). This story covers ONLY the two-attempt force-refresh pattern described in D3.

**Acceptance Criteria:**

**Given** the backend is validating tokens from one or more Keycloak issuers
**When** a token is validated
**Then** the JWKS public keys for the token's `iss` are cached in a Map keyed by `{iss}` with a 5-minute TTL (NFR10)
**And** cached keys are reused for subsequent tokens from the same issuer until TTL expires
**And** on a 401 validation failure, the cache for that issuer is force-refreshed and validation is retried once (two-attempt pattern)
**And** if the retry also fails, the request is rejected with 401 `TOKEN_INVALID`
**And** the cache supports multiple issuers simultaneously (FR5)

---

### Story 2.3: Token Passthrough — Headers Injection to Upstream

As a backend system,
I want to inject authenticated user identity as HTTP headers to upstream services,
So that downstream services receive user context without ever seeing raw Keycloak tokens.

**Acceptance Criteria:**

**Given** a request has been authenticated by the backend middleware
**When** the request is forwarded to an upstream OPEA service
**Then** the following headers are injected: `X-User-Id` (`{iss}#{sub}`), `X-User-Roles` (comma-separated), `X-Issuer` (issuer URL) (FR24)
**And** the raw Keycloak token is NOT forwarded to downstream services (NFR7)
**And** `X-User-Id` uses the complete `{iss}#{sub}` composite key guaranteeing uniqueness across realms (D4)

---

### Story 2.4: Kong Optional Deployment — With/Without Kong Compose Files

As an IT administrator,
I want to deploy GENIE.AI with Kong API gateway or without Kong using separate Docker Compose configurations,
So that I can choose the deployment topology that fits my infrastructure.

**Acceptance Criteria:**

**Given** the project provides Docker Compose configurations
**When** an IT administrator deploys with `docker-compose.yaml` (full stack)
**Then** Kong is included as the API gateway with Keycloak token validation configured
**And** when deploying with `components/docker-compose.yaml` (GENIE.AI only), Kong is not started and the backend operates independently (FR9, NFR8)
**And** the backend remains fully functional without Kong — all token validation, auth middleware, and header injection work standalone
**And** when Kong is deployed, all communication between Kong, backend, and Keycloak uses TLS 1.2+ (NFR2)

---

### Story 2.5: Kong Multi-Issuer Token Validation & Identity Headers

As an IT administrator,
I want Kong to validate Keycloak tokens and inject user identity headers at the API gateway level,
So that there is an additional security layer with multi-issuer/multi-realm support.

**Acceptance Criteria:**

**Given** Kong is deployed and configured with the Keycloak OIDC plugin
**When** a request arrives with a Keycloak token
**Then** Kong validates the token against the appropriate JWKS endpoint based on the token's `iss` claim (FR5)
**And** Kong injects `X-User-Id`, `X-User-Roles`, `X-Issuer` headers to the upstream request (FR13)
**And** requests with invalid tokens are rejected at the gateway level with appropriate HTTP error codes
**And** the Kong plugin configuration supports multiple issuers without code changes
**And** acceptance criteria for this story are validated in full-stack deployment mode (with Kong) only — not applicable in GENIE.AI-only mode

---

### Story 2.6: Auth & Authorization Error Display (Frontend)

As an end user,
I want to see clear, actionable error messages when authentication or authorization fails,
So that I understand whether my credentials are wrong, my session expired, or I lack permissions.

**Acceptance Criteria:**

**Given** a user interacts with the system and the backend returns a standardized error response (format defined in Story 1.8)
**When** authentication fails (invalid credentials, external IdP unreachable, network failure)
**Then** the frontend displays a clear error message identifying the failure type (FR27)
**And** when an authenticated user has no GENIE.AI role assigned, a distinct authorization error is displayed (FR28)
**And** the frontend handles all standardized error codes: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `INSUFFICIENT_ROLES`, `AUTH_SERVICE_UNAVAILABLE`
**And** error messages do not expose internal details (token payloads, stack traces) — only the `message` field from the backend response is displayed

---

### Story 2.7: Health Check — Keycloak Discovery Endpoint Reachability

As an IT administrator,
I want the health check endpoint to verify that the Keycloak OIDC discovery endpoint is reachable,
So that I can quickly diagnose whether authentication issues are caused by Keycloak being unreachable.

**Note:** The auth layer already handles Keycloak unavailability via the lazy OIDC discovery singleton — if Keycloak is down at startup or during operation, `ensureInitialized()` returns `AUTH_SERVICE_UNAVAILABLE` with a 30s retry cooldown. This story covers ONLY the `/health` endpoint enhancement to proactively report Keycloak reachability (NFR11), not the auth-layer unavailability handling which is already implemented.

**Acceptance Criteria:**

**Given** the backend is running
**When** `GET /health` is called and Keycloak is reachable
**Then** the response returns HTTP 200 with `{ status: "ok", keycloak: "reachable" }` (NFR11)
**And** when Keycloak is unreachable, the response returns HTTP 200 with `{ status: "degraded", keycloak: "unreachable" }` (NFR9, NFR11, FR30)
**And** the health check never returns HTTP 503 — service degradation is communicated via the response body, not the status code
**And** the health check does not require authentication (FR23)
**And** the check verifies the Keycloak OIDC discovery endpoint `/.well-known/openid-configuration` is reachable

---

### Story 2.8: Swagger UI with Keycloak OIDC Authorize Button

As a developer or API tester,
I want Swagger UI to include a Keycloak OIDC "Authorize" button,
So that I can test protected endpoints with an authenticated session.

**Acceptance Criteria:**

**Given** the Swagger UI is served at `/api-docs`
**When** a developer clicks the "Authorize" button
**Then** they are redirected to Keycloak login, and after authentication, a valid token is used for API calls (FR25)
**And** the Swagger UI is accessible without authentication (public route)
**And** the OIDC configuration in Swagger UI points to the correct `KEYCLOAK_URL` and `KEYCLOAK_REALM`

---

### Story 2.9: Multi-Realm Configuration Support

As an IT administrator,
I want to configure multiple Keycloak realms within the same Keycloak instance,
So that each realm maintains isolated user populations and role mappings.

**Acceptance Criteria:**

**Given** a Keycloak instance with multiple realms configured
**When** tokens from different realms are presented to the backend
**Then** each token is validated against its own issuer's JWKS endpoint (FR4, FR5)
**And** user identities from different realms are kept separate via the `{iss}#{sub}` composite key
**And** roles from one realm do not leak into sessions from another realm
**And** the system supports at least 500 concurrent authenticated sessions per realm without degradation (NFR21)

---

### Story 2.10: OPEA Continuity — Keycloak-Agnostic Downstream

As a backend developer,
I want OPEA microservices to remain completely unaware of Keycloak,
So that the existing service-to-service authentication and payload structure are unchanged.

**Acceptance Criteria:**

**Given** a request passes through backend auth middleware
**When** the request is forwarded to OPEA microservices
**Then** the existing service-to-service authentication mechanism is used unchanged (FR37)
**And** the authenticated user's identity is passed via the existing payload structure including `user_id` field (FR38)
**And** OPEA microservices do not receive, process, or validate Keycloak tokens
**And** OPEA services continue to work identically whether Kong is deployed or not

---

## Epic 3: Session Management, User Lifecycle & GDPR

Handle logout, session invalidation on user disable/delete, user lifecycle management via Keycloak (roles, groups, external IdP attribute mapping), and GDPR compliance (right to erasure, session data purging).

### Story 3.1: User Logout & Session Termination Across Application

As an end user,
I want to log out and have my session terminated across the entire application,
So that no residual session data persists after I log out.

**Acceptance Criteria:**

**Given** an authenticated user clicks the logout button
**When** the logout action is triggered
**Then** the frontend calls `UserManager.removeUser()` to clear the local session and tokens (FR17)
**And** the frontend redirects to the Keycloak logout endpoint to terminate the server-side session
**And** the Vuex auth module resets all auth state (`isLoggedIn`, `user`, `accessToken`)
**And** the user is redirected to the application home page as an unauthenticated user
**And** session data does not persist beyond session lifetime (NFR14, FR35)

---

### Story 3.2: Session Invalidation on User Disable/Delete

As a system,
I want to invalidate an active session when the corresponding Keycloak user is deleted or disabled,
So that compromised or terminated accounts cannot continue to access the application.

**Acceptance Criteria:**

**Given** an authenticated user has an active session with a valid access token
**When** an administrator disables or deletes the user in Keycloak
**Then** the user's next access token refresh attempt is rejected by Keycloak (refresh token invalidated server-side) — no polling of Keycloak is performed by the backend (FR15)
**And** the frontend's silent refresh (Story 1.7) fails, triggering a redirect to the Keycloak login page with an appropriate error message
**And** if the access token is still valid when the user is disabled, the session persists until the access token expires — this is a known OIDC stateless token limitation mitigated by short access token lifetimes (configured in Keycloak realm settings)
**And** the ArangoDB user record is updated to reflect the disabled/deleted status on the next login attempt

---

### Story 3.3: Role & Group Management via Keycloak

As a functional administrator,
I want to manage user accounts and assign roles entirely within Keycloak admin console,
So that I never need to interact with GENIE.AI for user management.

**Acceptance Criteria:**

**Given** a functional administrator accesses the Keycloak admin console
**When** they create, modify, disable, or delete a user account
**Then** the changes take effect in GENIE.AI on the user's next authentication (FR19)
**And** when they assign roles or group memberships to a user via Keycloak
**Then** those roles are reflected in the JWT claims on the user's next login (FR20)
**And** no GENIE.AI-specific interface is needed for user or role management

---

### Story 3.4: External IdP Attribute to Role Mapping via Keycloak

As a functional administrator,
I want to map external IdP attributes (e.g. group, department) to Keycloak realm roles via protocol mappers,
So that users from external IdPs automatically receive the correct GENIE.AI roles based on their organizational attributes.

**Acceptance Criteria:**

**Given** an external IdP is configured in Keycloak
**When** a functional administrator configures a Keycloak protocol mapper to map an IdP attribute (e.g. `groups`) to a realm role
**Then** users authenticating via that IdP automatically receive the mapped role in their JWT (FR21)
**And** no GENIE.AI code changes are required to support new attribute mappings
**And** the mapped roles are correctly extracted by the backend middleware and included in `X-User-Roles` header
**And** this story assumes the external IdP is already connected (Story 1.9) — it focuses solely on the attribute-to-role mapping configuration

---

### Story 3.5: JIT Provisioning — User Profile Updates on Re-login

As a backend system,
I want to update the ArangoDB user profile when a returning user authenticates with changed attributes,
So that the local user record stays in sync with the identity provider.

**Acceptance Criteria:**

**Given** a user with an existing ArangoDB record authenticates via Keycloak
**When** the token contains updated attributes (e.g. changed email, new roles)
**Then** the ArangoDB record is updated with the new values via atomic UPSERT (FR18)
**And** the composite key `{iss}#{sub}` remains unchanged — it is immutable
**And** the update is atomic — no partial writes or race conditions

---

### Story 3.6: Right to Erasure — User Identity Data Deletion

As an end user exercising my GDPR rights,
I want my identity data stored in ArangoDB to be completely deleted upon request,
So that the application complies with GDPR Article 17 (right to erasure).

**Acceptance Criteria:**

**Given** a user requests deletion of their personal data
**When** the deletion is triggered (via Keycloak account deletion or admin action)
**Then** the user's ArangoDB record is soft-deleted: `deleted: true` is set and PII fields are anonymized (FR34, NFR15)
**And** the soft-deleted record retains the `iss_sub` key to prevent re-provisioning
**And** the anonymization covers at minimum: email, display name, and any other PII fields
**And** the deletion covers both ArangoDB records and the corresponding Keycloak user data (NFR15)

---

### Story 3.7: Session Data Automatic Purging

As a system,
I want session data to be automatically purged when it exceeds the session lifetime,
So that no manual cleanup is required and stale sessions do not consume resources.

**Acceptance Criteria:**

**Given** the application is running
**When** a session exceeds its configured lifetime
**Then** the session data is automatically purged — no residual data persists (FR35, NFR14)
**And** session lifetime is configurable via Keycloak realm settings (access token lifespan, SSO session max)
**And** the purge happens without manual intervention or cron jobs

---

## Epic 4: Audit Logging & Compliance Reporting

Produce structured authentication audit logs with configurable retention policies for external security audit review.

### Story 4.1: Structured Authentication Audit Logging

As a security auditor,
I want the system to produce structured authentication logs with timestamps, user identity, and event type,
So that authentication events can be reviewed for security audit purposes.

**Acceptance Criteria:**

**Given** the backend is running and authentication events occur
**When** a login succeeds, fails, a token is refreshed, a token validation fails, or a user is provisioned
**Then** a structured audit log entry is emitted with the format `{ event, timestamp, userId, issuer }` (NFR12, FR32)
**And** `userId` uses the `{iss}#{sub}` composite key for cross-realm traceability
**And** supported event types are: `login_success`, `login_failed`, `logout`, `token_refreshed`, `token_validation_failed`, `user_provisioned`
**And** logs are emitted using the existing `winston` logger with daily rotation

---

### Story 4.2: Configurable Log Retention Policies

As an IT administrator,
I want to configure how long authentication logs are retained,
So that the system complies with data minimization policies (GDPR) and organizational requirements.

**Acceptance Criteria:**

**Given** the audit logging system is active
**When** the log retention policy is configured via environment variable or configuration
**Then** logs are retained for the configured period — minimum 90 days, maximum 12 months (NFR13, FR33)
**And** expired logs are automatically purged without manual intervention
**And** the default retention period is 90 days (GDPR data minimization)
**And** the retention setting is documented in the `env` template
