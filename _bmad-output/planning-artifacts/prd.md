---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation-skipped', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
inputDocuments:
  - 'GitLab Issue #218 - Create a 3rd Party Identity Provider Integration Framework for Genie-AI'
  - '_bmad-output/planning-artifacts/research/technical-identity-provider-integration-research-2026-03-26.md'
documentCounts:
  briefs: 0
  research: 1
  brainstorming: 0
  projectDocs: 0
  gitlabIssues: 1
  projectContext: '_bmad-output/project-context.md'
workflowType: 'prd'
classification:
  projectType: 'Web App + API Backend + Mobile App (auth migration)'
  domain: 'Govtech — Digital Public Infrastructure (DPI)'
  complexity: 'high'
  projectContext: 'brownfield — pre-production auth replacement with Keycloak as central IdP'
  keyDecisions:
    - 'Keycloak is the mandatory auth gateway (no bypass)'
    - 'Local auth replaced (no coexistence)'
    - 'Keycloak manages local users for sovereign deployments'
    - 'OIDC only (no SAML required)'
    - 'No production yet = no user migration needed (clean slate)'
    - 'Must work fully isolated (air-gapped) with Keycloak as local IdP'
    - 'Token passthrough — no GENIE.AI JWT issued'
    - 'Defense in depth — backend validates independently, Kong is optional bonus'
    - 'Multi-realm within same Keycloak instance'
    - 'Flutter mobile is post-MVP'
vision:
  statement: 'Make GENIE.AI a sovereign RAG framework that integrates naturally into any institution identity ecosystem — whether they have an external IdP to connect or none at all'
  differentiator: 'Works in any institutional context — from federated SSO to fully isolated air-gapped deployment via Keycloak as local IdP'
  coreInsight: 'Value is not in the protocol (OIDC is standard) but in the ability to function in any institutional context'
  whyNow: 'No production yet — building IdP-native auth from the start is the right time'
---

# Product Requirements Document - genie-ai

**Author:** Jerome
**Date:** 2026-03-26

## Executive Summary

GENIE.AI is an open-source, DPG-compliant RAG framework designed for the public sector. This PRD defines the integration of Keycloak as the central, mandatory Identity Provider — replacing the existing local authentication system before the first production deployment. This pre-production timing is a strategic advantage: the IdP-native auth is built from a clean slate, with no legacy user migration or coexistence constraints.

The integration targets **institutional IT administrators and DevOps teams** deploying GENIE.AI across UN agencies, government ministries, and international organizations. It enables them to connect GENIE.AI to their existing identity infrastructure (Google, Microsoft Entra ID, institutional IdPs) or operate it fully isolated with Keycloak as a local IdP for sovereign, air-gapped deployments. All authentication flows use OIDC; no SAML support is required.

**Keycloak was selected** over alternatives (Zitadel, Ory, Authentik) based on the team's existing expertise, proven government deployment track record, and Apache 2.0 license. The architecture uses IdP-agnostic client SDKs (`oidc-client-ts` for Vue 3, `flutter_appauth` for Flutter), ensuring a future provider switch would require only configuration changes — not code changes.

### What Makes This Special

GENIE.AI adapts to the institution's identity ecosystem — not the other way around. The value is not in the protocol (OIDC is standard) but in the ability to function in any institutional deployment context:

- **Federated SSO**: Connect to external IdPs via Keycloak identity brokering
- **Sovereign isolated mode**: Keycloak manages local users when no external IdP is available — fully air-gapped capable
- **Single auth gateway**: Keycloak is the mandatory entry point for all authentication — no bypass, no fallback to local auth

### Architecture Approach

The architecture uses **token passthrough** — Keycloak tokens are validated directly at the gateway and backend levels without translation. No GENIE.AI JWT is issued.

```
IdP externes → Keycloak (brokering + role mapping + realm management)
    → Kong [optional] (validation JWT multi-issuer via JWKS, rate limiting, headers)
        → Backend (validation JWT Keycloak via JWKS, ArangoDB lookup by {iss}#{sub})
            → Downstream services (headers injected by Kong or Backend)
```

**Defense in depth** (2026 state of the art per OWASP, NIST SP 800-207):
- **Backend** validates Keycloak tokens independently via JWKS — fully autonomous, no Kong dependency
- **Kong** (when present) provides an additional validation layer with the same multi-issuer/multi-realm capability
- **NGINX** handles TLS termination and security headers — no JWT validation
- Downstream OPEA services receive signed headers from the backend — never raw IdP tokens

**Implementation risk note:** Issue #218's reference code uses patterns that conflict with the project's established conventions (Composition API vs. required Options API, ES imports vs. required CommonJS in backend). The PRD requirements will align with the project's documented conventions defined in `project-context.md`.

## Project Classification

| Dimension | Classification |
|---|---|
| **Project Type** | Web App + API Backend + Mobile App (auth migration) |
| **Domain** | Govtech — Digital Public Infrastructure (DPI) |
| **Complexity** | High |
| **Project Context** | Brownfield — pre-production auth replacement with Keycloak as central IdP |
| **Target Users** | Institutional IT administrators and DevOps teams (UN agencies, government ministries, international organizations) |

## Success Criteria

### User Success

An institutional IT administrator successfully deploys GENIE.AI with Keycloak authentication and has a fully working login flow — either federated via external IdPs or in isolated mode with Keycloak managing local users.

**Measurable outcomes:**
- Docker Compose deployment with Keycloak included — all services start and authenticate without manual Keycloak configuration (realm, client, and default user pre-configured)
- First user login via Keycloak works out-of-the-box after `docker compose up` with only secrets in `.env`
- Connecting an external IdP (Google, Microsoft) requires only Keycloak-side configuration — no GENIE.AI code or config changes

### Business Success

Deployment teams report that GENIE.AI's IdP integration is easy to deploy and configure.

**Measurable outcomes:**
- Deployment teams can complete a fresh GENIE.AI + Keycloak setup without dedicated identity expertise
- Existing Keycloak administrators can connect their IdP to GENIE.AI using standard Keycloak documentation
- A security audit validates that the authentication implementation follows 2026 state-of-the-art OIDC security profiles

### Technical Success

The authentication system implements defense-in-depth with Keycloak as the mandatory auth gateway, using token passthrough architecture.

**Measurable outcomes:**
- A security audit validates that the authentication implementation follows 2026 state-of-the-art OIDC security profiles
- All capability and quality requirements are verified through functional requirements (FR1-FR38) and non-functional requirements (NFR1-NFR24)

## Product Scope & Phased Development

### MVP Strategy

**Problem-solving MVP** — prove that Keycloak as central IdP works end-to-end with token passthrough, covering the full auth flow from login to RAG query.

**Key constraint:** Kong is optional for deployment (two docker-compose files) but Kong JWT plugin integration is included in MVP — the system must work identically with and without Kong.

### MVP Feature Set (Phase 1)

**Core Journeys Supported:**
- J1: IT Administrator — isolated deployment
- J2: End User — SSO login
- J3: Functional Admin — account management

**Must-Have Capabilities:**
- Keycloak container in Docker Compose with pre-configured realm, client, and default admin user
- Backend validates Keycloak tokens independently via JWKS with multi-issuer/multi-realm support
- Kong JWT plugin integration (when Kong is deployed) — same auth behavior without Kong
- Vue 3 frontend authenticates via OIDC using `oidc-client-ts` (Options API, per project conventions)
- Automatic redirect to Keycloak on unauthenticated access
- ArangoDB user lookup by `{iss}#{sub}` composite key with JIT provisioning
- Works in isolated mode (air-gapped) with Keycloak as local IdP
- Works in federated mode with external IdPs configured via Keycloak brokering
- Multi-realm support within the same Keycloak instance
- Swagger UI with Keycloak OIDC "Authorize" button
- Security audit readiness: authentication logs, traceability, auditable configuration
- GDPR compliance: log retention policies, right to erasure support
- OPEA microservices integration unchanged — backend uses existing service-to-service JWT and `user_id` payload (OPEA is Keycloak-agnostic)

### Post-MVP (Phase 2)

- Flutter mobile authentication via OIDC using `flutter_appauth` with PKCE and `flutter_secure_storage`
- Additional features to be defined based on deployment feedback and security audit findings.

### Vision (Future)

To be defined based on project evolution and institutional requirements.

### Risk Mitigation

| Risk | Mitigation |
|---|---|
| Multi-realm JWKS management complexity | IdP-agnostic architecture; standardized OIDC discovery endpoints |
| Keycloak CVE requiring emergency patch | Container-based deployment enables fast patching; monitor Keycloak security advisories |
| Keycloak as single point of failure for all authentication | Backend validates independently; health checks on Keycloak service |
| GDPR non-compliance in auth logs | Configurable log retention (NFR13); auto-purge expired session data (NFR14) |
| Accessibility gaps in Keycloak default theme | Document Keycloak theme customization for WCAG compliance in deployment guide (NFR17) |
| Time-constrained delivery | Minimum viable auth: Keycloak Docker + backend JWKS validation + single-realm + one user login. Multi-realm, Kong, Swagger OIDC can follow. |
| OPEA integration impact | Zero-risk — OPEA is Keycloak-agnostic, unchanged (FR37-FR38) |

## User Journeys

### Journey 1: IT Administrator — Isolated Deployment

**Context:** Amadou, IT administrator at a government agency in West Africa, needs to deploy GENIE.AI with authentication. The agency has no external IdP — they need an isolated, air-gapped deployment.

**Scene:** Amadou receives the GENIE.AI deployment package. He's comfortable with Docker but has no identity expertise. His goal: get the chatbot running with authentication before end of day.

1. Reads the installation documentation
2. Copies `.env` template, fills in secrets (passwords, JWT secret) and Keycloak hostname (e.g., `keycloak.genie-ai.local`)
3. Configures local DNS resolution — adds entry to the agency's internal DNS or `/etc/hosts` file
4. Runs `docker compose up` — all services start including Keycloak with a pre-configured realm, client, and default admin user
5. Opens the chatbot URL in his browser — automatically redirected to Keycloak login page
6. Logs in with the default admin credentials
7. Redirected back to the chatbot — authenticated and working

**Key moment:** The "it just works" moment when the first login succeeds without any identity-specific configuration.

**What could go wrong:** DNS misconfiguration (hostname doesn't resolve) — documented troubleshooting in the installation guide.

### Journey 2: End User — SSO Login

**Context:** Maria, policy analyst at a UN agency, needs to access the GENIE.AI chatbot to research regulatory documents. Her agency has already deployed GENIE.AI with Keycloak connected to their Microsoft Entra ID.

**Scene:** Maria has never used GENIE.AI before. She accesses it through her agency's internal portal.

1. Opens the chatbot URL in her browser
2. Automatically redirected to Keycloak login page
3. Clicks "Sign in with Microsoft"
4. Enters her usual Microsoft credentials (which she already knows)
5. Redirected back to the chatbot — her profile is automatically created in GENIE.AI (JIT provisioning via ArangoDB lookup on `{iss}#{sub}`)
6. Starts using the chatbot RAG immediately

**Key moment:** The frictionless login — she uses her existing credentials, no new account to create, no new password to remember.

**What could go wrong:**
- First-time user with no GENIE.AI role assigned → clear authorization error message
- Keycloak session expires → transparent re-authentication via refresh token
- JIT provisioning delay on first login → brief delay before profile is available

### Journey 3: Functional Admin — Account Management

**Context:** Chen, IT operations lead at a government ministry, manages access to GENIE.AI for 200+ staff across three departments. The ministry uses Keycloak with three realms (one per department).

**Scene:** Chen needs to onboard new staff and adjust permissions. He works entirely within the Keycloak admin console.

1. Accesses Keycloak admin console for the relevant realm
2. Creates new users or manages existing ones
3. Assigns roles (admin, user) and group memberships
4. In federated mode, configures role mappings from the external IdP attributes
5. No interaction with GENIE.AI needed — Keycloak is the single management interface

**Key moment:** The realization that identity management is fully decoupled from GENIE.AI — he can use standard Keycloak tools and workflows.

**What could go wrong:**
- User deleted in Keycloak while active session exists in GENIE.AI → session invalidated on next token refresh
- Role change in Keycloak → reflected on next login, not in real-time during active session

### Journey Requirements Summary

| Journey | Reveals Requirements |
|---|---|
| **J1 — IT Admin** | Pre-configured Keycloak realm/client/user in Docker Compose; installation doc covering DNS, secrets, hostname; default admin credentials |
| **J2 — End User** | Automatic redirect to Keycloak on unauthenticated access; JIT user provisioning in ArangoDB; transparent session refresh; clear error messages for unauthorized users |
| **J3 — Functional Admin** | Multi-realm support; Keycloak as sole identity management interface; role mapping from external IdP attributes; session invalidation on user deletion |

## Domain-Specific Requirements

### Technical Constraints

- **Sovereign deployment**: All authentication components (Keycloak, backend validation) must function fully offline after initial setup — no external API calls for token validation or user management
- **Data residency**: All user identity data (tokens, profiles, sessions) must remain within the institution's infrastructure — no data leaves the deployment boundary

### Compliance & Regulatory

Compliance requirements are specified in functional requirements (FR31-FR36) and non-functional requirements (NFR12-NFR18):

- **Security audit**: FR32, NFR12 — authentication logs with timestamps, user identity, and event type
- **GDPR compliance**: FR33-FR35, NFR13-NFR15 — configurable log retention, right to erasure, session data purging
- **Accessibility (WCAG 2.1 AA)**: NFR17 — Keycloak login page compliance is the deploying institution's responsibility; GENIE.AI provides documented guidance

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| Keycloak CVE requiring emergency patch | Container-based deployment enables fast patching; monitor Keycloak security advisories |
| Keycloak as single point of failure for all authentication | Backend validates independently; health checks on Keycloak service |
| GDPR non-compliance in auth logs | Configurable log retention (NFR13); auto-purge expired session data (NFR14) |
| Accessibility gaps in Keycloak default theme | Document Keycloak theme customization for WCAG compliance in deployment guide (NFR17) |

## Route Security & Keycloak Configuration

### Route Security Matrix

| Route | Auth Required | Notes |
|---|---|---|
| `/health` | No | Health check |
| `/api-docs` | No | Swagger documentation (OIDC "Authorize" button for testing protected endpoints) |
| Static assets | No | Frontend bundle |
| `/api/chat/*` | Yes | Chat and conversation |
| `/api/users/*` | Yes | User management |
| `/api/analytics/*` | Yes | Usage analytics |
| `/api/admin/*` | Yes | Admin dashboard |
| `/api/files/*` | Yes | Document upload |
| `/api/categories/*` | Yes | Service categories |
| `/api/auth/*` | Mixed | Login callback is public, others protected |

### Keycloak Configuration

- Pre-configured realm, OIDC client, and default admin user in Docker Compose
- Realm acts as both IdP broker (federated mode) and local user store (isolated mode)
- Multi-realm: multiple realms within same Keycloak instance for multi-population deployments
- Role mapping: external IdP attributes mapped to Keycloak realm roles via protocol mappers
- WCAG 2.1 AA compliance: documented in deployment guide for Keycloak theme customization (NFR17)

## Functional Requirements

### Authentication & Identity Federation

- FR1: An end user can authenticate via Keycloak using their institutional credentials (SSO) without creating a GENIE.AI-specific account
- FR2: An end user can authenticate via Keycloak using local credentials managed directly in Keycloak (isolated/air-gapped deployment)
- FR3: An IT administrator can connect an external identity provider (Google, Microsoft Entra ID, institutional IdP) to GENIE.AI by configuring only Keycloak — without any GENIE.AI code or configuration changes
- FR4: An IT administrator can configure multiple Keycloak realms within the same Keycloak instance, each with isolated user populations and role mappings
- FR5: The system can validate authentication tokens from multiple Keycloak realms via JWKS, supporting simultaneous multi-issuer token validation within a single deployment
- FR6: An end user can transparently re-authenticate when their Keycloak session expires, without manual intervention

### Deployment & Configuration

- FR7: An IT administrator can deploy the complete GENIE.AI stack with Keycloak included using a single Docker Compose command
- FR8: The Keycloak container starts with a pre-configured realm, OIDC client, and default admin user — requiring no manual Keycloak setup after deployment
- FR9: An IT administrator can deploy GENIE.AI with Kong API gateway or without Kong, using separate Docker Compose configurations
- FR10: The system functions fully offline after initial setup (sovereign/air-gapped deployment) — no external API calls for token validation or user management
- FR11: An IT administrator can configure all required secrets (passwords, hostnames) via a single `.env` file

### Session & Token Management

- FR12: The system validates Keycloak tokens at the backend level independently — fully autonomous without requiring Kong
- FR13: When Kong is deployed, the system provides an additional token validation layer with multi-issuer/multi-realm support at the API gateway level
- FR14: The system uses token passthrough architecture — Keycloak tokens are validated directly without issuing GENIE.AI-specific tokens
- FR15: The system invalidates an active session when the corresponding Keycloak user is deleted or disabled
- FR16: The frontend stores access tokens in memory (not persistent storage) and manages token lifecycle transparently via the OIDC client library
- FR17: An end user can log out and terminate their session across the application

### User Provisioning & Management

- FR18: The system automatically creates a user record in ArangoDB on first successful Keycloak authentication (JIT provisioning) using a composite `{iss}#{sub}` identity key
- FR19: A functional administrator can manage user accounts (create, modify, disable, delete) entirely within the Keycloak admin console — without interacting with GENIE.AI
- FR20: A functional administrator can assign roles and group memberships to users via Keycloak, with role changes reflected on the user's next login
- FR21: A functional administrator can map external IdP attributes to Keycloak realm roles via Keycloak protocol mappers

### API Access & Route Security

- FR22: The system enforces authentication on protected API routes (`/api/chat/*`, `/api/users/*`, `/api/analytics/*`, `/api/admin/*`, `/api/files/*`, `/api/categories/*`) by validating Keycloak tokens
- FR23: The system allows unauthenticated access to public routes (`/health`, `/api-docs`, static assets)
- FR24: The system injects authenticated user identity (user ID, roles) as headers to upstream services via Kong or the backend
- FR25: The system provides Swagger UI with a Keycloak OIDC "Authorize" button, allowing authenticated testing of protected endpoints directly from the documentation interface
- FR26: The frontend automatically redirects unauthenticated users to the Keycloak login page — no GENIE.AI-specific login page exists

### Error Handling & Recovery

- FR27: The system displays a clear error message to the user when authentication fails (invalid credentials, external IdP unreachable, or network failure)
- FR28: The system displays a clear authorization error message when an authenticated user has no GENIE.AI role assigned
- FR29: The system handles token validation failures gracefully (expired, malformed, or revoked tokens) and prompts the user to re-authenticate
- FR30: The system detects when the Keycloak service is unavailable and communicates the service degradation appropriately

### Security & Compliance

- FR31: The system encrypts all communication in transit
- FR32: The system produces authentication logs (login, logout, token validation events) that are reviewable by an external auditor
- FR33: The system supports configurable log retention policies for authentication-related data
- FR34: The system supports the right to erasure ("right to be forgotten") — user identity data stored in ArangoDB can be deleted upon Keycloak account deletion
- FR35: The system ensures session data does not persist beyond the session lifetime
- FR36: The system ensures all user identity data (tokens, profiles, sessions) remains within the institution's infrastructure — no data leaves the deployment boundary

### AI Services Integration

- FR37: The backend communicates with OPEA microservices using the existing service-to-service authentication mechanism — unchanged by Keycloak integration
- FR38: The backend passes authenticated user identity to OPEA microservices via the existing payload structure (including `user_id`) — OPEA remains Keycloak-agnostic

## Non-Functional Requirements

### Security

- NFR1: All authentication tokens are validated using OIDC with PKCE — authorization code flow without PKCE is prohibited
- NFR2: All communication between client, backend, and Keycloak is encrypted in transit (TLS 1.2+)
- NFR3: Access tokens are stored in browser memory only — never persisted to localStorage, sessionStorage, or cookies
- NFR4: Keycloak tokens are validated independently by the backend via JWKS — the backend never depends on an external service to determine if a token is valid
- NFR5: JWT validation includes issuer (`iss`), audience (`aud`), and expiration (`exp`) claims verification
- NFR6: When a revoked Keycloak token is presented for validation, the backend rejects it
- NFR7: Downstream OPEA services never receive raw IdP tokens — only signed headers injected by the backend or Kong

### Reliability & Availability

- NFR8: The backend remains operational when Kong is unavailable (Kong is optional by design)
- NFR9: When Keycloak is unavailable, the system returns an HTTP 503 response with a clear service degradation message for authenticated API requests (`/api/*` protected routes) — not an unhandled error. The `/health` endpoint follows a separate pattern: it always returns HTTP 200 with `{ status: "degraded", keycloak: "unreachable" }` to enable monitoring without triggering HTTP-level alerts
- NFR10: JWKS public keys are cached at the backend level with a TTL shorter than Keycloak's key rotation interval — on token validation failure (401), the system force-refreshes the JWKS cache before rejecting the token
- NFR11: A health check endpoint (`/health`) is available without authentication and verifies that the Keycloak OIDC discovery endpoint (`/.well-known/openid-configuration`) is reachable

### Compliance & Data Protection

- NFR12: All authentication logs include timestamps, user identity (via `{iss}#{sub}`), and event type — sufficient for external security audit review
- NFR13: Authentication log retention is configurable — minimum 90 days (for operational security), maximum 12 months (for GDPR data minimization)
- NFR14: Session data is automatically purged when it exceeds the session lifetime — no manual cleanup required
- NFR15: User identity data supports complete deletion upon request (right to erasure / GDPR Article 17) — deletion covers both ArangoDB records and Keycloak user data
- NFR16: All user identity data (tokens, profiles, sessions) remains within the institution's deployment boundary — no external data transmission for authentication or identity purposes
- NFR17: The Keycloak login page WCAG 2.1 AA compliance is the deploying institution's responsibility — GENIE.AI provides documented deployment guidance for Keycloak theme customization
- NFR18: Keycloak configuration and user data backup is the deploying institution's responsibility — GENIE.AI documents what must be backed up (Keycloak database, realm configuration, client secrets) as part of the deployment guide

### Performance

- NFR19: Token validation at the backend (JWKS verification + ArangoDB user lookup) completes within 500ms under normal operating conditions
- NFR20: The initial OIDC authentication redirect flow (browser → Keycloak → callback → authenticated state) completes within 3 seconds under normal network conditions
- NFR21: The system supports at least 500 concurrent authenticated sessions per Keycloak realm without degradation in authentication response times

### Compatibility & Interoperability

- NFR22: The OIDC integration works with any standard-compliant external IdP (Google, Microsoft Entra ID, institutional IdPs) — no IdP-specific code in GENIE.AI
- NFR23: The system works with Keycloak 26.x (current stable) and supports upgrade to Keycloak 27.x without GENIE.AI code changes
- NFR24: The frontend supports the latest 2 versions of Chrome, Firefox, Safari, and Edge — no IE11 or legacy browser support
