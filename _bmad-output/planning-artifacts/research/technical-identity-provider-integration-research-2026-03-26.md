---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: ['GitLab Issue #218 - 3rd Party Identity Provider Integration Framework']
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'State of the Art 2026 - Third-Party Identity Provider Integration for GENIE.AI'
research_goals: 'Evaluate Keycloak vs modern alternatives for IdP integration across Vue 3 (web) and Flutter (mobile) stacks, covering cloud-native and on-premise sovereign deployment scenarios. Produce architecture recommendation with implementation guidance.'
user_name: 'Jerome'
date: '2026-03-26'
web_research_enabled: true
source_verification: true
---

# Research Report: Technical - Third-Party Identity Provider Integration for GENIE.AI

**Date:** 2026-03-26
**Author:** Jerome
**Research Type:** Technical
**Input Document:** GitLab Issue #218 - 3rd Party Identity Provider Integration Framework

## Executive Summary

This report presents a comprehensive technical analysis of third-party Identity Provider (IdP) integration for GENIE.AI, an open-source RAG framework for the public sector. The research evaluates the state of the art in 2026 across five dimensions: IdP platform selection (Keycloak vs Zitadel vs alternatives), client SDK ecosystems for Vue 3 and Flutter, integration patterns (BFF, token exchange, JIT provisioning), security architecture (OAuth 2.1, PKCE, DPoP), and deployment strategies for both cloud-native and on-premise sovereign scenarios.

**Key Findings:**

- **Keycloak** is recommended as the primary IdP — the team has existing expertise, massive community, proven government track record, and Apache 2.0 license guarantees free self-hosted use forever. The high CVE volume (20+ in Q1 2026) also reflects active security auditing
- **BFF (Backend-for-Frontend) pattern** is recommended over Issue #218's direct client-to-Keycloak approach — refresh tokens never leave the server, IdP-agnostic SDKs (`oidc-client-ts`, `flutter_appauth`) eliminate vendor lock-in
- **SAML 2.0 is NOT required** for GENIE.AI — OIDC is the sole protocol needed. All modern IdPs (Google, Microsoft Entra ID, GitHub, Okta) support OIDC. SAML would only be relevant if connecting to legacy government IdPs that lack OIDC support, which is unlikely in the DPG/UN/ITU deployment context
- Both IdP auth and existing local auth can coexist through the same GENIE.AI JWT format
- Implementation is estimated at **4-6 weeks** using a strangler fig migration pattern
- The architecture is designed to be IdP-agnostic — switching from Keycloak to another OIDC provider in the future requires only configuration changes, not code changes

**Top 5 Recommendations:**

1. Deploy **Keycloak** as the primary IdP (team expertise, proven track record, Apache 2.0 free forever)
2. Implement BFF pattern in `gov-chat-backend` with new `idp-auth-service.js`
3. Use IdP-agnostic client SDKs (`oidc-client-ts` for Vue 3, `flutter_appauth` for Flutter)
4. Extend Kong JWT plugin to validate GENIE.AI JWTs (not IdP tokens directly)
5. Add nullable `idpProvider`/`idpSubject` fields to ArangoDB users collection (backward-compatible)

---

## Technical Research Scope Confirmation

**Research Topic:** State of the Art 2026 - Third-Party Identity Provider Integration for GENIE.AI
**Research Goals:** Evaluate Keycloak vs modern alternatives for IdP integration across Vue 3 (web) and Flutter (mobile) stacks, covering cloud-native and on-premise sovereign deployment scenarios. Produce architecture recommendation with implementation guidance.

**Technical Research Scope:**

- Architecture Analysis - design patterns, frameworks, system architecture for IdP integration
- Implementation Approaches - development methodologies, coding patterns for Vue 3 + Flutter
- Technology Stack - IdP platforms, client SDKs, protocols, tools
- Integration Patterns - APIs, protocols (OAuth2, OIDC, SAML 2.0), interoperability with existing GENIE.AI auth
- Performance & Sovereignty Considerations - scalability, latency, data residency, on-premise deployment

**Research Methodology:**

- Current web data with rigorous source verification (Keycloak GitHub releases, official IdP websites)
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights
- Context from Issue #218 (existing Keycloak specification) as baseline for comparison

**Scope Confirmed:** 2026-03-26

---

## Technology Stack Analysis

### Identity Provider Platforms

#### Keycloak (Red Hat / IBM) — Version 26.5.6 (Current as of March 2026)

Keycloak remains the most widely adopted open-source Identity and Access Management (IAM) solution. The 26.x release line (Quarkus-based) represents a major modernization of the platform.

**Current State (v26.5.x):**
- Built on Quarkus framework (Java/Jakarta EE) — significantly improved startup time and memory footprint compared to legacy WildFly-based versions
- Full OIDC 1.0, OAuth 2.0, SAML 2.0 protocol support
- WebAuthn/Passkey support (progressively improved since v6.0, with passwordless login flows and conditional UI)
- Identity brokering with 30+ social IdPs (Google, Facebook, GitHub, Microsoft, Apple, etc.)
- User federation (LDAP, Active Directory, custom SPI providers)
- Organization feature (multi-tenant by domain, GA since v26)
- Fine-grained authorization services (UMA 2.0)

**Key New Features in 26.5.0 (Q1 2026):**
- **Workflows (preview)**: Automate administrative tasks within a realm — Identity Governance and Administration (IGA) capability
- **JWT Authorization Grants (RFC 7523)**: Accept external signed JWT assertions to request OAuth 2.0 access tokens — recommended alternative to external-to-internal token exchange
- **MCP Server Authorization**: Guide for using Keycloak as authorization server for Model Context Protocol (MCP) servers
- **Kubernetes Service Account Tokens**: Authenticate clients with K8s service account tokens (avoid static client secrets)
- **OpenTelemetry Support**: Unified metrics and logging observability
- **Enhanced HTTP Performance (preview)**: ~5% throughput increase via optimized JSON serialization
- **ppc64le Container Support**: PowerPC 64-bit Little Endian architecture containers

**Security Posture (Critical Note):**
The 26.5.x release line has had **20+ CVE fixes** across v26.5.1 through v26.5.6 (January-March 2026), including:
- SSRF via OIDC Dynamic Client Registration (CVE-2026-1180)
- Refresh Token Reuse Bypass via TOCTOU race condition (CVE-2026-1035)
- SAML broker authentication bypass for disabled IdPs (CVE-2026-3009, CVE-2026-2603)
- Privilege escalation via manage-clients permission (CVE-2026-3121)
- Authorization bypass for token enumeration of organization memberships (CVE-2026-2366)

> **Assessment:** The high volume of CVEs in rapid succession (5 point releases in ~3 months) indicates both active security auditing (positive) and complexity-driven vulnerability surface (concern). This is characteristic of a mature but complex platform.

_Resource Footprint:_ Heavy — Java runtime, requires PostgreSQL/MySQL, Infinispan for clustering. Startup memory consumption has been a noted regression in post-26.5 versions (GitHub issue #45662).

_Sources: [Keycloak Official Site](https://www.keycloak.org/), [GitHub Releases](https://github.com/keycloak/keycloak/releases)_

#### Zitadel — Open Source, Cloud-Native IAM

Zitadel is a Swiss-origin IAM platform built with Go, designed cloud-native from the ground up. It positions itself as a modern alternative to Keycloak with a focus on developer experience, multi-tenancy, and European data sovereignty.

**Architecture:**
- Single binary deployment with embedded database (CockroachDB-compatible) — no separate DB required
- Event-sourced architecture for auditability and consistency
- gRPC + REST APIs
- First-class multi-tenancy (every resource scoped to an organization)

**Protocols & Standards:**
- OpenID Connect (OpenID Certified), OAuth 2.0, SAML 2.0
- WebAuthn/Passkeys (passwordless-first approach)
- LDAP integration

**Certifications (verified from official site):**
- ISO 27001
- GDPR Certified
- AICPA SOC2 Type II
- OpenID Certified

**SDK Ecosystem:**
- Native SDKs for: Go, Angular, React, Next.js, Python, **Flutter** (notable for GENIE.AI mobile)
- gRPC/REST API with comprehensive documentation

**Key Differentiators for GENIE.AI:**
- Significantly lighter resource footprint than Keycloak (single binary, embedded DB)
- Built-in multi-tenancy with organization/project model (aligns with multi-tenant public sector deployments)
- Passkey-first design philosophy
- European data sovereignty positioning (Swiss origin, GDPR certified)
- Flutter SDK available natively
- Actions system for custom workflows (comparable to Keycloak SPI but cloud-native)

**Customers:** ABAX, ConceptBoard, Fiddler AI, Klaviyo, Groupe Mutuel, Infoguard, Federation Quebecoise Des Municipalites, and others across healthcare, finance, and government sectors.

_Source: [Zitadel Official Site](https://zitadel.com/)_

#### Ory Stack (Kratos + Hydra + Oathkeeper + Keto)

Ory provides a modular, API-first identity platform composed of composable microservices:

- **Ory Kratos**: Identity and user management (login, registration, profile, MFA)
- **Ory Hydra**: OAuth 2.0 and OpenID Connect provider (cloud-native, zero dependencies)
- **Ory Oathkeeper**: Identity-aware reverse proxy (rate limiting, access control)
- **Ory Keto**: Fine-grained authorization engine (Zanzibar-inspired)

**Strengths:**
- Truly headless — you build your own UI (maximum flexibility)
- Kubernetes-native, designed for cloud-first deployments
- Apache 2.0 license
- Strong API design, CLI-first developer experience

**Weaknesses for GENIE.AI:**
- Fragmented across multiple services — operational complexity
- No built-in admin console (by design, but increases setup effort)
- Requires more assembly and integration work than Keycloak or Zitadel
- Smaller community compared to Keycloak

#### Authentik

Authentik is a flexible, open-source IAM platform built with Python/Django.

**Strengths:**
- Visual workflow builder for custom login flows (unique differentiator)
- Modern admin UI (significantly better UX than Keycloak)
- Supports OIDC, OAuth2, SAML 2.0, LDAP
- Outpost architecture for high availability

**Weaknesses for GENIE.AI:**
- Python/Django stack introduces runtime dependency different from Go/Java alternatives
- Smaller enterprise track record than Keycloak
- Less mature mobile SDK ecosystem
- Community growing but smaller than Keycloak's

#### Logto

Logto is a next-generation auth platform with an open-source core, built with TypeScript/Node.js.

**Strengths:**
- Modern developer experience with clean APIs and TypeScript SDKs
- Excellent documentation
- OIDC, social logins, passkeys support
- Admin console with clean UI

**Weaknesses for GENIE.AI:**
- MPL 2.0 core license (some enterprise features SSQL-licensed)
- Less mature than Keycloak for enterprise/government scenarios
- SAML support not available (blocking for some institutional IdPs)
- Smaller community, less battle-tested in production

#### Comparison Matrix

| Dimension | Keycloak 26.5 | Zitadel | Ory Stack | Authentik | Logto |
|---|---|---|---|---|---|
| **License** | Apache 2.0 | Apache 2.0 | Apache 2.0 | MIT | MPL 2.0 (core) |
| **Language** | Java/Quarkus | Go | Go | Python/Django | TypeScript/Node |
| **OIDC** | Yes | Yes (Certified) | Yes | Yes | Yes |
| **OAuth 2.0** | Yes | Yes | Yes | Yes | Yes |
| **SAML 2.0** | Yes | Yes | Yes (Hydra) | Yes | No |
| **Passkeys/WebAuthn** | Yes (improving) | Yes (first-class) | Yes (Kratos) | Yes | Yes |
| **Multi-tenancy** | Realms/Orgs | First-class | Manual | Yes | Organizations |
| **Admin Console** | Feature-rich, complex | Clean, modern | None (headless) | Modern, visual | Clean, modern |
| **Flutter SDK** | keycloak-js (web only) | Native | None | None | None |
| **Resource Footprint** | Heavy (JVM) | Light (single binary) | Medium (microservices) | Medium | Medium |
| **DB Requirement** | PostgreSQL/MySQL | Embedded (optional external) | PostgreSQL | PostgreSQL | PostgreSQL |
| **Sovereignty Certs** | None listed | ISO 27001, GDPR, SOC2 | None listed | None listed | None listed |
| **K8s Native** | Yes (operator) | Yes | Yes (designed for) | Yes (outposts) | Yes |
| **LDAP/AD** | Yes | Yes | Yes | Yes | Yes |
| **MFA** | Yes | Yes | Yes | Yes | Yes |
| **Community Size** | Very large | Growing (~4K stars) | Growing | Growing | Growing |
| **CVE Activity (2026)** | Very high (20+ in Q1) | Moderate | Low-Moderate | Low | Low |

---

### Client SDKs and Integration Libraries

#### Vue 3 (Web Frontend)

| Library | Status | Protocol | Notes |
|---|---|---|---|
| **oidc-client-ts** | Active, recommended | OIDC/OAuth2 | Successor to oidc-client. PKCE support, silent renewal, framework-agnostic. Best choice for Vue 3 composables. |
| **keycloak-js** | Active | OIDC/OAuth2 | Official Keycloak adapter. Tight coupling to Keycloak. Issue #218 uses this. |
| **@auth0/auth0-vue** | Active | OIDC/OAuth2 | Official Auth0 SDK for Vue 3. Vendor-locked to Auth0. |
| **vue-oidc / @prine/oidc-vue** | Active | OIDC/OAuth2 | Vue-specific wrappers around oidc-client-ts. |

**Recommended Vue 3 Approach (IdP-agnostic):**
- Use **oidc-client-ts** as the OIDC core library — it works with any OIDC-compliant provider
- Wrap in a Vue 3 composable (`useAuth()`) for reactive state management
- Authorization Code + PKCE flow (mandatory — implicit flow deprecated by OAuth 2.1)
- In-memory token storage for access tokens (avoid localStorage for security)
- Axios interceptor for automatic token injection on API requests

**Keycloak-specific approach (from Issue #218):**
- Uses `keycloak-js` adapter — simpler integration but vendor-locked to Keycloak
- Issue #218 code uses localStorage for tokens (security concern — should migrate to in-memory)

#### Flutter (Mobile)

| Library | Status | Protocol | Notes |
|---|---|---|---|
| **flutter_appauth** | Active, standard | OIDC/OAuth2 | Wraps native AppAuth-iOS and AppAuth-Android SDKs. Uses system browsers (ASWebAuthenticationSession / Chrome Custom Tabs). Best security (no embedded WebView). |
| **Zitadel Flutter SDK** | Active | OIDC | Native Zitadel integration for Flutter. |
| **supabase_flutter** | Active | OIDC | Built-in auth with Supabase backend. |
| **firebase_auth** | Active | Proprietary + OIDC | Google Firebase Authentication. |

**Recommended Flutter Approach:**
- Use **flutter_appauth** for IdP-agnostic OIDC authentication
- Always use PKCE for public/native clients
- Store tokens securely with **flutter_secure_storage** (encrypted keystore/keychain)
- Use App Links (Android) and Universal Links (iOS) for seamless redirect
- Validate ID tokens server-side (never trust client-side claims for sensitive operations)

**Zitadel Advantage for Flutter:**
- Zitadel provides a native Flutter SDK, potentially simplifying integration
- However, flutter_appauth works with any OIDC provider including Zitadel

---

### Authentication Protocols and Standards (2026 State of the Art)

#### OAuth 2.1 (Emerging Standard)
- Deprecates implicit grant and password grant
- Mandates PKCE for all public clients
- Requires exact redirect URI matching
- All major IdPs (Keycloak, Zitadel, Auth0) support OAuth 2.1 draft features

#### OpenID Connect 1.0 (Stable, Universal)
- Industry standard for authentication layer on top of OAuth 2.0
- ID tokens for identity, access tokens for API authorization
- Discovery endpoint (`/.well-known/openid-configuration`)
- Dynamic client registration
- Backchannel logout, frontchannel logout

#### SAML 2.0 (Legacy, Still Required)
- Essential for institutional/government IdPs (many still SAML-only)
- Keycloak and Zitadel both support SAML 2.0 brokering
- Logto does NOT support SAML — potential blocker for government use cases

#### Passkeys / WebAuthn (Growing Adoption)
- Passwordless authentication using platform authenticators
- Keycloak: progressive support (v24+), conditional UI for autofill
- Zitadel: first-class passkey support
- Apple, Google, Microsoft all support passkeys at OS level

#### DPoP (Demonstrating Proof-of-Possession)
- Token binding mechanism preventing token replay attacks
- Keycloak 26.5.x lists DPoP as supported spec
- Emerging best practice for high-security deployments

---

### GENIE.AI Integration Context

#### Current Authentication System (from codebase)
- JWT-based authentication with `authService.js` and `userService.js`
- Token stored in localStorage
- User profile management via `userProfileService.js`
- Conversation and chat services authenticated via JWT
- API key management via `apiKeyService.js`
- ArangoDB stores user data

#### Integration Requirements (from Issue #218)
- Maintain existing OAuth2 authentication as independent system
- Add SSO via third-party IdPs (social + institutional)
- User profile synchronization between IdP and GENIE.AI backend
- Secure token exchange and validation
- Support both web (Vue 3) and mobile (Flutter) clients
- API Gateway integration (Kong/NGINX)

#### Critical Design Constraint
The existing `authService.js` uses username/password with JWT. The IdP integration must coexist with this system — users who log in via IdP should get a GENIE.AI JWT for API calls, while local auth remains functional for non-SSO scenarios.

---

### Technology Adoption Trends (2026)

1. **Passkey-first authentication** is rapidly becoming the default — newer platforms (Zitadel, Clerk, Stytch) are ahead of Keycloak in UX
2. **Headless/API-first architecture** is gaining traction — Ory and Zitadel are designed this way; Keycloak's monolithic console is showing its age despite recent UI improvements
3. **Cloud-native deployment** is the baseline expectation — all evaluated platforms support Docker/K8s
4. **Multi-tenancy as a first-class feature** is essential for SaaS and multi-organization deployments (Keycloak Organizations, Zitadel native org model)
5. **European data sovereignty** is increasingly important for public sector — Zitadel's Swiss origin and certifications are a differentiator
6. **Keycloak licensing uncertainty** — Red Hat's commercial terms evolution and the high CVE volume are driving some organizations to evaluate alternatives
7. **OAuth 2.1 finalization** is pushing all platforms to deprecate legacy flows (implicit, password)
8. **MCP (Model Context Protocol) authorization** — Keycloak 26.5 specifically added support for this, relevant for AI/RAG systems like GENIE.AI

---

## Integration Patterns Analysis

### Authentication Flow Patterns

#### Pattern 1: Authorization Code + PKCE (Standard for SPA & Mobile)

This is the mandatory flow for all public clients in OAuth 2.1. Both Vue 3 (web) and Flutter (mobile) should use this pattern.

**Flow:**
```
1. Client generates code_verifier (random) + code_challenge (SHA256 hash)
2. Client redirects user to IdP authorization endpoint with code_challenge
3. User authenticates at IdP (possibly via third-party IdP broker)
4. IdP redirects back with authorization code
5. Client exchanges code + code_verifier for tokens at IdP token endpoint
6. Client receives: access_token, id_token, refresh_token
```

**Vue 3 Implementation:** `oidc-client-ts` handles this transparently with PKCE enabled by default.
**Flutter Implementation:** `flutter_appauth` wraps native AppAuth SDKs with PKCE support.

_Relevance: This is the foundation pattern for GENIE.AI's web and mobile clients._

#### Pattern 2: BFF (Backend-for-Frontend) Token Mediation

GENIE.AI's architecture already has a natural BFF — the `gov-chat-backend` (Node.js/Express). This backend acts as the token mediation layer between frontend clients and downstream AI microservices.

**Architecture for GENIE.AI:**
```
Vue 3 SPA ──(session cookie)──► gov-chat-backend (BFF) ──(service token)──► ChatQnA, Retriever, etc.
                                      │
Flutter App ──(access token)──►       │
                                      │
                                      ▼
                              Identity Provider (Keycloak/Zitadel)
                                      │
                                      ▼
                              Kong API Gateway ──(JWKS validation)──► gov-chat-backend
```

**Key Benefits for GENIE.AI:**
- Refresh tokens stored server-side only (never exposed to clients)
- Backend performs token exchange for downstream microservice calls
- Single IdP integration point — all clients authenticate through the same flow
- Compatible with existing `authService.js` — the BFF issues GENIE.AI JWTs

**Critical Difference from Issue #218:**
Issue #218's design has the Vue 3 client directly calling Keycloak via `keycloak-js` and sending the ID token to the backend. The BFF pattern is more secure because:
- The frontend never handles refresh tokens
- The backend validates tokens server-side before issuing GENIE.AI JWTs
- Token exchange happens server-to-server (confidential client with client secret)

#### Pattern 3: Token Exchange (RFC 8693) for Downstream Services

When the GENIE.AI backend needs to call OPEA microservices (ChatQnA, Retriever, etc.) on behalf of a user:

```
POST /realms/{realm}/protocol/openid-connect/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token={user_access_token}
subject_token_type=urn:ietf:params:oauth:token-type:access_token
audience=downstream-service-client-id
```

Keycloak 26.5 introduced **JWT Authorization Grants (RFC 7523)** as the recommended alternative — external signed JWT assertions can request access tokens without going through the full token exchange flow.

---

### API Gateway Integration Patterns

#### Pattern 4: JWT Validation at Kong API Gateway

GENIE.AI already uses Kong as its API gateway. The recommended pattern is to validate JWTs at the gateway level, passing validated claims to upstream services via headers.

**Kong OIDC/JWT Plugin Configuration:**
```yaml
plugins:
  - name: jwt
    config:
      iss: "https://keycloak.example.com/realms/genie-ai"
      claims_to_verify:
        - exp
        - nbf
      secret_is_base64: false
      key_claim_name: kid
      maximum_expiration: 86400
```

**Validation Flow:**
1. Kong extracts `Authorization: Bearer <JWT>` from incoming request
2. Kong fetches JWKS from IdP's `/.well-known/jwks.json` endpoint (cached)
3. Kong validates signature, `iss`, `aud`, `exp`, `nbf` claims
4. Kong strips the token and injects validated claims as upstream headers:
   - `X-User-Id: sub`
   - `X-User-Email: email`
   - `X-User-Roles: roles`
5. Upstream services trust Kong-injected headers (no need for each service to validate JWTs)

**GENIE.AI-Specific Consideration:**
The current architecture has both public routes (health, docs) and authenticated routes (chat, admin). Kong should apply JWT validation selectively per route/service.

#### Pattern 5: NGINX Reverse Proxy with OIDC

GENIE.AI also uses NGINX as a reverse proxy. For deployments where Kong is not used, NGINX can perform OIDC validation:

- **NGINX Plus**: Native `auth_jwt` directive with `auth_jwt_key_request` for dynamic JWKS fetching
- **OpenResty**: Lua-based JWT validation via `lua-nginx-module`
- **NGINX Ingress Controller (K8s)**: Annotations for OIDC authentication

**Recommendation:** Use Kong for JWT validation (primary) and NGINX as a fallback/static proxy. This avoids duplicating validation logic.

---

### User Provisioning and Synchronization Patterns

#### Pattern 6: Just-In-Time (JIT) Provisioning

When a user authenticates via a third-party IdP for the first time, GENIE.AI creates a local user record automatically.

**Flow:**
```
1. User authenticates via Google/Microsoft/GitHub through IdP
2. IdP returns ID token with user claims (email, name, sub)
3. GENIE.AI backend receives ID token (via BFF)
4. Backend validates ID token against IdP's JWKS endpoint
5. Backend checks if local user exists for this IdP subject
6. If not → create local user in ArangoDB with mapped attributes
7. Issue GENIE.AI JWT for API access
```

**Advantages:**
- No pre-registration required — users can self-onboard via SSO
- User record created on first login, updated on subsequent logins
- IdP remains the source of truth for identity attributes

**Issue #218 Approach:** The issue's `keycloakService.js` implements a simplified version of this pattern via the `/auth/keycloak/sync` endpoint.

#### Pattern 7: Event-Driven User Synchronization

For scenarios where user attributes need to be kept in sync beyond login events:

```
IdP Event (user updated) → Webhook → GENIE.AI Webhook Handler → Update ArangoDB user record
```

- Keycloak: Event Listener SPI or Admin Event listeners
- Zitadel: Actions system (event-driven workflows)
- Both support webhooks for real-time notification

**Recommendation for GENIE.AI:** Start with JIT provisioning (simpler) and add event-driven sync later if bi-directional sync is required.

#### Pattern 8: SCIM 2.0 for Enterprise Provisioning

For institutional deployments where IT administrators manage users centrally:

- SCIM 2.0 (RFC 7643/7644) automates user provisioning/deprovisioning
- IdP pushes user changes to GENIE.AI via SCIM REST API
- Critical for automated deprovisioning (compliance requirement)

**Assessment:** SCIM is a nice-to-have for future enterprise deployments. Not required for MVP. Keycloak and Zitadel both support SCIM on the IdP side; GENIE.AI would need to implement a SCIM endpoint.

---

### Coexistence with Existing Authentication Pattern

#### Pattern 9: Dual Authentication (Local + IdP)

GENIE.AI's existing `authService.js` uses username/password with JWT. The IdP integration must coexist with this system.

**Implementation Approach:**
```
┌─────────────────────────────────────────────────────────┐
│                    Login Page                            │
│  ┌──────────────┐    ┌──────────────────────────────┐   │
│  │ Local Login  │    │ SSO Login (Google, MS, etc.) │   │
│  │ user/pass    │    │ → redirects to IdP           │   │
│  └──────┬───────┘    └──────────────┬───────────────┘   │
│         │                           │                    │
│         ▼                           ▼                    │
│  ┌─────────────────────────────────────────────────┐    │
│  │         gov-chat-backend (auth controller)       │    │
│  │  - Local: validate credentials → issue JWT       │    │
│  │  - SSO: validate IdP token → find/create user   │    │
│  │        → issue JWT                               │    │
│  └─────────────────────────────────────────────────┘    │
│                        │                                │
│                        ▼                                │
│              GENIE.AI JWT (same format for both)         │
└─────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**
- Both auth paths produce the same GENIE.AI JWT format
- Downstream services don't need to know which auth method was used
- User records in ArangoDB have an optional `idp_provider` and `idp_subject` field to track IdP-linked accounts
- Account linking: A user who initially registered locally can later link their account to an IdP

---

### Security Patterns

#### Pattern 10: Token Security Best Practices (2026)

| Concern | Recommendation | Rationale |
|---|---|---|
| Access token storage (web) | In-memory only | Prevents XSS token theft |
| Access token storage (mobile) | `flutter_secure_storage` | Encrypted keystore/keychain |
| Refresh token storage | Server-side only (BFF) | Never expose to client |
| Token transport | HTTPS only | Mandatory for all auth flows |
| Token lifetime | 15 min (access), 24h (refresh) | Minimize exposure window |
| Token rotation | Refresh token rotation | Detect refresh token reuse |
| Algorithm whitelist | RS256 only | Prevent algorithm confusion attacks |
| JWKS caching | 1h TTL with background refresh | Performance + security balance |
| Clock skew tolerance | 30 seconds leeway | Handle NTP drift |
| PKCE | Mandatory for all public clients | OAuth 2.1 requirement |

#### Pattern 11: DPoP (Demonstrating Proof-of-Possession)

For high-security deployments (government, institutional):

- DPoP binds tokens to the client that requested them, preventing token replay
- Keycloak 26.5.x lists DPoP as a supported spec
- Client generates a DPoP proof (signed JWT) for each request
- Server validates both the access token AND the DPoP proof

**Assessment:** DPoP is recommended for future hardening but not required for MVP. It adds complexity to client implementations (both web and mobile).

#### Pattern 12: CORS and Session Management

**GENIE.AI-Specific:**
- The frontend and backend may be on different domains (especially in embedded/third-party scenarios from Issue #218)
- IdP must allow the frontend's origin in its CORS configuration
- Backend must validate the `Origin` header and set appropriate `Access-Control-Allow-Origin`
- Session cookies must use `SameSite=Strict` or `SameSite=Lax`
- `Secure` flag mandatory on all cookies

---

### Integration Complexity Assessment

| Pattern | Complexity | GENIE.AI Fit | Priority |
|---|---|---|---|
| Auth Code + PKCE | Low | Essential (web + mobile) | P0 |
| BFF Token Mediation | Medium | High (gov-chat-backend already exists) | P0 |
| Kong JWT Validation | Low | High (Kong already in stack) | P0 |
| JIT Provisioning | Medium | High (from Issue #218 sync flow) | P0 |
| Dual Authentication | Medium | Essential (coexist with existing auth) | P0 |
| Token Exchange (RFC 8693) | Medium | Medium (for OPEA microservice calls) | P1 |
| NGINX OIDC | Medium | Low (Kong preferred) | P2 |
| SCIM Provisioning | High | Low (enterprise future) | P2 |
| Event-Driven Sync | Medium | Low (JIT sufficient for MVP) | P2 |
| DPoP | High | Low (security hardening phase) | P3 |

---

## Architectural Patterns and Design

### System Architecture — Target State

#### Reference Architecture: IdP-Integrated GENIE.AI

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET / USERS                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Vue 3 SPA   │  │ Flutter App  │  │ Third-Party Embed        │  │
│  │ (Browser)    │  │ (Mobile)     │  │ (<genie-ai-chatbot>)     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
└─────────┼─────────────────┼───────────────────────┼────────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      KONG API GATEWAY                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ JWT Validation (JWKS from IdP)                               │  │
│  │ Rate Limiting | CORS | Security Headers | CSP                │  │
│  │ → Injects X-User-Id, X-User-Roles headers upstream           │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────┬─────────────────┬───────────────────────┬────────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NGINX (Reverse Proxy / TLS)                       │
│  SSL Termination | Static Files | WAF (ModSecurity)                 │
└─────────┬─────────────────┬───────────────────────┬────────────────┘
          │                 │                       │
          ▼                 ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GENIE.AI SERVICES LAYER                           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               gov-chat-backend (BFF)                        │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │   │
│  │  │ authController│  │ chatController│  │ userController   │  │   │
│  │  └──────┬──────┘  └──────────────┘  └───────────────────┘  │   │
│  │         │                                                     │   │
│  │  ┌──────▼──────────────────────────────────────┐             │   │
│  │  │         AUTH SERVICE LAYER                   │             │   │
│  │  │  ┌──────────────┐  ┌──────────────────────┐  │             │   │
│  │  │  │ authService  │  │ idpAuthService (NEW) │  │             │   │
│  │  │  │ (local JWT)  │  │ (IdP token validation│  │             │   │
│  │  │  │              │  │  + user sync)        │  │             │   │
│  │  │  └──────────────┘  └──────────────────────┘  │             │   │
│  │  └─────────────────────────────────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               ArangoDB (Users, Sessions, Conversations)     │   │
│  │  Collections: users, conversations, messages, ...           │   │
│  │  NEW fields: idp_provider, idp_subject, idp_tokens         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    IDENTITY PROVIDER (Keycloak / Zitadel)            │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐   │
│  │ Realm/Org   │  │ OIDC/OAuth2 │  │ Identity Brokering       │   │
│  │ Management  │  │ Endpoints   │  │ ┌────┐ ┌────┐ ┌────┐    │   │
│  └─────────────┘  └─────────────┘  │ │Ggle│ │MS  │ │GitH│    │   │
│                                    │ └────┘ └────┘ └────┘    │   │
│  ┌─────────────┐  ┌─────────────┐  │ ┌────┐ ┌──────────┐    │   │
│  │ User Store  │  │ MFA/Passkey │  │ │Govt│ │Institut. │    │   │
│  │ (embedded)  │  │ Support     │  │ └────┘ └──────────┘    │   │
│  └─────────────┘  └─────────────┘  └──────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Admin Console | Account Console | Workflows (IGA)           │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Design Decisions and Trade-offs

#### Decision 1: IdP Selection — Keycloak vs Zitadel

| Criterion | Keycloak 26.5 | Zitadel | Recommendation |
|---|---|---|---|
| **Protocol support** | OIDC + OAuth2 + SAML 2.0 + WS-Fed | OIDC + OAuth2 + SAML 2.0 | Tie |
| **Sovereignty certs** | None listed | ISO 27001, GDPR, SOC2 Type II | **Zitadel** |
| **Resource footprint** | Heavy (JVM, ~512MB+ RAM) | Light (single binary, ~128MB) | **Zitadel** |
| **Operational complexity** | High (PostgreSQL + Infinispan + JVM tuning) | Low (single binary, embedded DB) | **Zitadel** |
| **CVE activity** | Very high (20+ in Q1 2026) | Moderate | **Zitadel** |
| **Community/maturity** | Very large, enterprise-proven | Growing, smaller ecosystem | **Keycloak** |
| **Flutter SDK** | None (keycloak-js only) | Native SDK | **Zitadel** |
| **MCP Server auth** | Yes (26.5.0+) | Not documented | **Keycloak** |
| **K8s operator** | Yes | Yes | Tie |
| **Admin console** | Feature-rich, complex | Clean, modern | Preference |
| **SAML institutional IdPs** | Excellent (mature) | Good | **Keycloak** |
| **Government track record** | Extensive (EU, NL, NO) | Growing (CH, CA municipalities) | **Keycloak** |

**Preliminary Recommendation: Keycloak** for GENIE.AI, based on:
- Team's existing Keycloak expertise reduces implementation risk significantly
- Massive community, extensive documentation, and proven government deployment track record
- Apache 2.0 license guarantees free self-hosted use forever (same as Zitadel)
- SAML broker capability available as insurance for legacy institutional IdPs (though unlikely needed — see SAML assessment below)
- High CVE volume indicates active security auditing, not necessarily poor quality
- **Risk mitigation:** IdP-agnostic SDKs (`oidc-client-ts`, `flutter_appauth`) mean switching to Zitadel (or any OIDC provider) later requires only configuration changes, not code changes

#### SAML 2.0 Assessment: Not Required for GENIE.AI

**OIDC is the sole protocol needed.** SAML 2.0 is a legacy protocol relevant only when connecting to government IdPs that do not support OIDC. In the GENIE.AI deployment context:

- **Microsoft Entra ID** (formerly Azure AD): OIDC ✓
- **Google Workspace**: OIDC ✓
- **GitHub**: OIDC ✓
- **Okta**: OIDC ✓
- **Most national eID systems** (eIDAS-compliant): OIDC ✓ (or have OIDC bridges)

SAML support in the IdP would only matter if a specific partner government operates a **SAML-only IdP with no OIDC capability**. This is increasingly rare in 2026 and should be assessed on a per-deployment basis, not treated as a baseline requirement.

If such a scenario arises, Keycloak's mature SAML broker can translate SAML to OIDC — but this is a bridge to cross when needed, not a design constraint to optimize for today.

#### Decision 2: BFF Pattern vs Direct Client-to-IdP

| Aspect | BFF Pattern (Recommended) | Direct Client-to-IdP (Issue #218) |
|---|---|---|
| Refresh token storage | Server-side only | Client-side (localStorage) |
| Token validation | Server-side before GENIE.AI JWT issuance | Client sends ID token to backend |
| IdP SDK dependency | None (generic OIDC on backend) | `keycloak-js` (vendor-locked) |
| Mobile support | Same pattern for Flutter | Different SDK per platform |
| Security | Higher (tokens never leave server) | Lower (tokens in browser storage) |
| Complexity | Medium (backend handles more) | Lower (simpler client code) |

**Recommendation: BFF Pattern** — The `gov-chat-backend` already acts as a BFF. Adding IdP token validation and user sync there is architecturally consistent and more secure than Issue #218's approach.

#### Decision 3: Dual Auth Coexistence

The existing local auth (`authService.js` with username/password) must coexist with IdP auth.

**Design:**
- Both auth paths produce the same GENIE.AI JWT format
- User records in ArangoDB gain optional fields: `idpProvider`, `idpSubject`
- Login endpoint accepts both credentials and IdP tokens (discriminated by request type)
- Account linking: A local user can bind their account to an IdP identity
- Logout: Both local session and IdP session are cleared

#### Decision 4: API Gateway Validation Strategy

**Recommended: Kong JWT plugin** with JWKS from the IdP.

- Public routes (`/health`, `/api-docs`, static assets): No auth required
- Authenticated routes (`/api/chat/*`, `/api/users/*`, `/api/analytics/*`): JWT validated at Kong
- Admin routes (`/api/admin/*`): JWT + role check at Kong

**Important:** Kong validates the GENIE.AI JWT (issued by the backend), NOT the IdP token directly. This decouples downstream services from the IdP.

```
IdP Token → gov-chat-backend (validates + issues GENIE.AI JWT) → Kong (validates GENIE.AI JWT) → Upstream
```

### Deployment Architecture

#### Cloud-Native Deployment (Docker Compose)

```
docker-compose.yaml
├── Layer 1: OPEA AI/ML Infrastructure (existing)
├── Layer 2: GENIE.AI Services (existing)
│   ├── frontend (Vue 3)
│   ├── backend (Node.js BFF - extended with IdP auth)
│   ├── arangodb
│   ├── redis
│   └── document-repository
├── Layer 3: API Gateway (existing)
│   ├── kong (extended with JWT plugin)
│   └── nginx
└── Layer 4: Identity Provider (NEW)
    └── zitadel (or keycloak) — single container
```

**Resource Impact:**
- Zitadel: ~128-256MB RAM, single container
- Keycloak: ~512MB-1GB RAM, single container (with embedded DB) or 2 containers (with PostgreSQL)

#### On-Premise Sovereign Deployment

For government/public sector deployments requiring full data sovereignty:

**Sovereignty Requirements:**
1. **No external API calls** — IdP must function fully offline after initial setup
2. **Data residency** — All user data stored within national borders
3. **Cryptographic sovereignty** — Keys managed locally (no cloud KMS)
4. **Audit immutability** — Tamper-evident audit logs
5. **Source code availability** — Full OSS with no proprietary dependencies

**Deployment Considerations:**
- Both Keycloak and Zitadel support fully offline, air-gapped deployment
- Zitadel's embedded database simplifies sovereign deployment (no separate DB to manage)
- SSL certificates managed via `secrets/ssl/` directory (already in GENIE.AI's architecture)
- HSM integration for key management (future hardening)

#### Multi-Tenancy Architecture

GENIE.AI may be deployed for multiple organizations (UN agencies, government ministries, etc.).

**Approach using Zitadel Organizations:**
- Each GENIE.AI deployment maps to a Zitadel instance
- Each organization (ministry, agency) is a Zitadel Organization
- Users belong to their organization and can be granted cross-org access
- Projects in Zitadel map to GENIE.AI API scopes

**Approach using Keycloak Realms:**
- Each organization gets its own Keycloak realm
- Realm-per-tenant provides strong isolation
- Cross-realm token exchange possible but complex

**Recommendation:** Start with single-tenant (one realm/organization) and add multi-tenancy when the first multi-org deployment is required.

### Security Architecture

#### Threat Model for IdP Integration

| Threat | Mitigation | Pattern |
|---|---|---|
| Token theft via XSS | In-memory tokens, HttpOnly cookies | Token Security (P10) |
| Token replay | Short-lived access tokens (15 min) | Token Security (P10) |
| CSRF on auth endpoints | SameSite cookies, state parameter | OAuth2 PKCE |
| IdP impersonation | JWKS signature validation | Kong JWT Plugin |
| Refresh token theft | Server-side only (BFF pattern) | BFF Pattern (P2) |
| User enumeration | Generic error messages | Backend validation |
| Session fixation | Regenerate session ID on login | Auth service |
| Unauthorized IdP access | Client credentials + audience validation | Token Exchange (P3) |
| Man-in-the-middle | HTTPS everywhere, HSTS | TLS/NGINX |
| SAML assertion injection | Strict validation (CVE-2026-2092 class) | IdP handles |

#### Defense in Depth Layers

```
Layer 1: NGINX — TLS termination, WAF (ModSecurity), security headers, CSP
Layer 2: Kong — JWT validation, rate limiting, CORS, request size limits
Layer 3: Backend — Token validation, user sync, GENIE.AI JWT issuance
Layer 4: ArangoDB — Encrypted at rest, access-controlled
Layer 5: IdP — Authentication, MFA, passkeys, session management, audit logs
```

### Data Architecture

#### User Identity Data Flow

```
                    IdP User Store
                    (source of truth for identity)
                          │
              ┌───────────┼───────────┐
              │ JIT Sync  │ Update    │
              ▼           │           │
         ArangoDB users   │           │
         (GENIE.AI local  │           │
          user data)      │           │
              │           │           │
              ▼           │           │
         GENIE.AI JWT     │           │
         (session token)  │           │
              │           │           │
              └───────────┘           │
                                      │
              On logout/deprovision ──┘
```

**Data Ownership:**
- **IdP owns:** Authentication credentials, MFA config, session state
- **GENIE.AI owns:** User profile, conversation history, preferences, API keys
- **Shared (synced from IdP):** Email, display name, profile attributes

**ArangoDB Schema Changes:**
```javascript
// users collection — new fields
{
  _key: "user_123",
  loginName: "jrevillard",
  email: "jerome@example.com",
  fullName: "Jerome Revillard",
  passwordHash: "$2b$10$...",  // existing — null for IdP-only users
  role: "user",
  // NEW fields for IdP integration:
  idpProvider: "google",        // null for local-only users
  idpSubject: "1234567890",     // IdP user ID
  idpLinkedAt: "2026-03-26T10:00:00Z",
  idpLastSync: "2026-03-26T10:00:00Z",
  idpRawProfile: { /* cached IdP profile */ }
}
```

### Scalability and Performance Considerations

| Concern | Impact | Mitigation |
|---|---|---|
| IdP as SPOF | IdP downtime blocks all logins | Health checks, graceful degradation to local auth |
| JWKS fetch latency | First request slower | Pre-warm JWKS cache on startup |
| Token validation overhead | Added latency per request | Kong caches JWKS, validates locally |
| User sync on first login | Slight delay on first SSO login | Async profile enrichment after JWT issuance |
| Session management | IdP sessions + GENIE.AI sessions | Short-lived GENIE.AI JWTs, rely on IdP for session management |
| IdP database growth | User storage in IdP | IdP handles its own storage lifecycle |

### Architectural Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| IdP CVE requiring emergency patch | High (Keycloak) / Medium (Zitadel) | High | Container-based deployment enables fast patching; monitor security advisories |
| IdP vendor lock-in | Medium | Medium | IdP-agnostic SDKs (oidc-client-ts, flutter_appauth) enable migration |
| SAML institutional IdP compatibility issues | Medium | High | Test with target IdPs early; Keycloak as SAML fallback |
| Performance degradation under load | Low | Medium | Kong JWKS caching; IdP horizontal scaling |
| Data sync conflicts | Low | Medium | IdP is source of truth; GENIE.AI syncs on login |

---

---

## Implementation Approaches and Technology Adoption

### Current Architecture Findings (from codebase analysis)

**Backend Authentication (`components/gov-chat-backend/`):**

| File | Role |
|---|---|
| `services/auth-service.js` | Core auth: JWT generation/validation, login/register, password reset, email verification. Uses `jsonwebtoken` with `JWT_SECRET`, 24h expiry. Token stored in ArangoDB user profile (`accessToken` field) for server-side revocation. |
| `middleware/auth-middleware.js` | Express middleware: Extracts `Bearer` token → `verifyToken()` → fetches user from ArangoDB via `UserProfileService` → compares stored `accessToken` → attaches `req.user` with role. Also includes `isAdmin()` check. |
| `routes/auth-routes.js` | Express routes for `/login`, `/register`, `/refresh-token`, `/forgot-password`, etc. |
| `services/user-profile-service.js` | User profile CRUD operations. |

**Frontend Vue 3 (`components/gov-chat-frontend/`):**

| File | Role |
|---|---|
| `store/modules/auth.js` | Vuex auth module: `login()`, `logout()`, `initAuth()` (restore from localStorage). State: `user`, `isInitialized`. |
| `services/authService.js` | Frontend auth service wrapping API calls |
| `services/userService.js` | User CRUD operations, `getCurrentUser()` reads from localStorage |
| `services/httpService.js` | Axios instance for API communication |
| `views/LoginView.vue` | Login page with username/password form |
| `router/index.js` | Vue Router with auth guards |

**Key observations for IdP integration:**
- Auth middleware validates JWT AND checks `accessToken` in DB — IdP users need the same mechanism
- Vuex store manages auth state — IdP auth adds an additional auth path
- Token stored in localStorage (frontend) — should migrate to in-memory for security
- Admin check: `parseInt(user._key) <= 10 || user.role === 'Admin'` — needs to work for IdP-created users

### Implementation Strategy: Phased Migration

The implementation follows a **strangler fig pattern** — IdP authentication is added alongside existing local auth without modifying the current system until both paths are validated.

#### Phase 0: Foundation (1-2 weeks)

**IdP Deployment:**
```yaml
# Add to root docker-compose.yaml
zitadel:
  image: ghcr.io/zitadel/zitadel:latest
  command: start-from-init --masterkeyFromEnv
  environment:
    ZITADEL_MASTERKEY: ${ZITADEL_MASTERKEY}
    ZITADEL_EXTERNALSECURE: ${ZITADEL_EXTERNALSECURE:-false}
    ZITADEL_DATABASE_POSTGRES_HOST: ${ARANGO_URL:-arangodb}
    ZITADEL_DATABASE_POSTGRES_PORT: 5432
    ZITADEL_DATABASE_POSTGRES_DATABASE: zitadel
    ZITADEL_DATABASE_POSTGRES_USER_USERNAME: zitadel
    ZITADEL_DATABASE_POSTGRES_USER_PASSWORD: ${ZITADEL_DB_PASSWORD}
    ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME: ${ARANGO_USER:-root}
    ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD: ${ARANGO_PASSWORD}
  ports:
    - "${ZITADEL_PORT:-8080}:8080"
  depends_on:
    arangodb:
      condition: service_healthy
  networks:
    - genieai_network
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"]
    interval: 10s
    timeout: 5s
    retries: 5
```

**New files to create:**

| File | Purpose |
|---|---|
| `components/gov-chat-backend/services/idp-auth-service.js` | IdP token validation, JWKS fetch, user sync |
| `components/gov-chat-backend/controllers/idp-auth-controller.js` | Endpoints: `/api/auth/idp/callback`, `/api/auth/idp/login`, `/api/auth/idp/logout` |
| `components/gov-chat-backend/routes/idp-auth-routes.js` | Route definitions for IdP auth |
| `components/gov-chat-backend/config/oidc-config.js` | OIDC configuration (authority, client_id, etc.) |
| `components/gov-chat-frontend/src/composables/useOidcAuth.js` | Vue 3 composable wrapping `oidc-client-ts` |
| `components/gov-chat-frontend/src/config/oidc-config.js` | Frontend OIDC configuration |
| `mobile/genie_ai_mobile/lib/services/oidc_auth_service.dart` | Flutter OIDC service using `flutter_appauth` |

#### Phase 1: Backend IdP Integration (2-3 weeks)

**1. OIDC Configuration (`config/oidc-config.js`):**
```javascript
module.exports = {
  authority: process.env.IDP_AUTHORITY || 'http://localhost:8080',
  clientId: process.env.IDP_CLIENT_ID || 'genie-ai-backend',
  clientSecret: process.env.IDP_CLIENT_SECRET,
  redirectUri: process.env.IDP_REDIRECT_URI || '/api/auth/idp/callback',
  postLogoutRedirectUri: process.env.IDP_POST_LOGOUT_URI || '/',
  scope: 'openid profile email',
  tokenEndpoint: '/oauth/v2/token',     // Zitadel
  authorizationEndpoint: '/oauth/v2/auth', // Zitadel
  jwksUri: '/oauth/v2/keys',            // Zitadel
  // For Keycloak, these would be:
  // tokenEndpoint: '/realms/genie-ai/protocol/openid-connect/token'
  // authorizationEndpoint: '/realms/genie-ai/protocol/openid-connect/auth'
  // jwksUri: '/realms/genie-ai/protocol/openid-connect/certs'
};
```

**2. IdP Auth Service (`services/idp-auth-service.js`) — key functions:**
- `validateIdToken(idToken)` — Verify JWT signature against IdP JWKS endpoint
- `syncUser(idpProfile)` — Find or create GENIE.AI user from IdP profile
- `linkAccount(userId, idpProvider, idpSubject)` — Link local user to IdP identity
- `exchangeCodeForToken(code)` — Exchange authorization code for tokens (BFF pattern)
- `issueGenieAIJwt(userId)` — Issue GENIE.AI JWT (reuses existing `authService.generateToken()`)

**3. Auth Controller Extension (`controllers/idp-auth-controller.js`):**
- `POST /api/auth/idp/callback` — Receive authorization code, exchange for tokens, validate, sync user, issue GENIE.AI JWT
- `POST /api/auth/idp/link` — Link current local user to IdP
- `POST /api/auth/idp/unlink` — Unlink IdP from local user
- `GET /api/auth/idp/providers` — List configured IdP providers

**4. Auth Middleware Update (`middleware/auth-middleware.js`):**
- Existing `authenticate()` remains unchanged — it validates GENIE.AI JWTs
- No changes needed — the BFF pattern means IdP tokens are converted to GENIE.AI JWTs before reaching protected routes

**5. ArangoDB Schema Migration:**
- Add `idpProvider`, `idpSubject`, `idpLinkedAt`, `idpLastSync` fields to `users` collection
- Add index on `idpProvider` + `idpSubject` for lookup
- Backward compatible — existing users have these fields as null

#### Phase 2: Frontend Vue 3 Integration (1-2 weeks)

**1. Install dependency:**
```bash
npm install oidc-client-ts
```

**2. Composable (`composables/useOidcAuth.js`):**
- Wraps `oidc-client-ts` `UserManager` with reactive Vue 3 state
- Methods: `login()`, `logout()`, `handleCallback()`, `refreshTokens()`, `initialize()`
- Exposes: `isAuthenticated`, `accessToken`, `userProfile`, `error`
- Singleton pattern — shared state across components
- Uses `redirect_uri` pointing to backend callback endpoint (BFF pattern)

**3. Login Page Update (`views/LoginView.vue`):**
- Add "Login with [Google/Microsoft/GitHub]" buttons alongside existing username/password form
- Each button calls `useOidcAuth().login()` with provider-specific parameters
- Or redirect to IdP's hosted login page with provider selection

**4. Vuex Store Update (`store/modules/auth.js`):**
- Add `idpLogin()` action alongside existing `login()`
- Both actions produce the same `user` state shape
- `initAuth()` checks both localStorage (local) and IdP session (via `oidc-client-ts`)

**5. Router Guards:**
- Existing guards work unchanged — they check Vuex `isAuthenticated`
- Add `/callback` route for OIDC redirect handling

#### Phase 3: Flutter Mobile Integration (1-2 weeks)

**1. Add dependency (`pubspec.yaml`):**
```yaml
dependencies:
  flutter_appauth: ^7.0.0
  flutter_secure_storage: ^9.0.0
```

**2. OIDC Service (`lib/services/oidc_auth_service.dart`):**
- Uses `FlutterAppAuth` for Authorization Code + PKCE flow
- Stores tokens in `FlutterSecureStorage` (encrypted)
- Methods: `authenticate()`, `logout()`, `getAccessToken()`, `refreshToken()`

**3. Login Screen Update:**
- Add IdP login buttons alongside existing credentials form
- Deep linking configuration for callback URL handling

#### Phase 4: Kong Gateway JWT Enhancement (1 week)

**1. Kong JWT Plugin Configuration:**
- Validate GENIE.AI JWTs (not IdP tokens) at Kong level
- Configure JWKS endpoint (if using asymmetric JWT signing in backend)
- Or configure shared JWT secret for symmetric signing
- Apply selectively to authenticated routes

**2. Environment Variables:**
```bash
# New env variables for IdP integration
IDP_AUTHORITY=http://zitadel:8080
IDP_CLIENT_ID=genie-ai-backend
IDP_CLIENT_SECRET=<generated>
IDP_REDIRECT_URI=https://genie-ai.example.com/api/auth/idp/callback
```

### Testing Strategy

| Layer | Testing Approach | Tools |
|---|---|---|
| IdP Token Validation | Unit tests with mock JWKS | Jest + nock |
| User Sync Logic | Unit tests with mock ArangoDB | Jest + test fixtures |
| Auth Endpoints | Integration tests | Supertest + test DB |
| Vue 3 Composable | Component tests | Vitest + @vue/test-utils |
| Flutter OIDC | Widget/integration tests | Flutter test framework |
| Kong JWT Plugin | Contract tests | Kong test helpers |
| E2E SSO Flow | Browser tests | Playwright/Cypress |

### Deployment Checklist

- [ ] Zitadel container added to `docker-compose.yaml`
- [ ] New env variables documented in `env` template
- [ ] ArangoDB migration script for new user fields
- [ ] Kong JWT plugin configured for GENIE.AI JWTs
- [ ] NGINX CORS updated for IdP callback
- [ ] SSL certificates cover IdP domain
- [ ] Health checks for IdP service
- [ ] Backup strategy for IdP database
- [ ] Monitoring/alerting for IdP availability

### Cost and Resource Assessment

| Item | Estimated Effort | Skills Required |
|---|---|---|
| IdP Deployment (Zitadel) | 2-3 days | Docker, basic OIDC |
| Backend IdP Service | 5-7 days | Node.js, JWT, ArangoDB |
| Vue 3 Frontend Integration | 3-5 days | Vue 3 Composition API, oidc-client-ts |
| Flutter Mobile Integration | 3-5 days | Flutter, flutter_appauth, flutter_secure_storage |
| Kong JWT Plugin | 1-2 days | Kong configuration |
| Testing | 3-5 days | Jest, Vitest, integration tests |
| Documentation | 2-3 days | Technical writing |
| **Total** | **~4-6 weeks** | |

### Risk Mitigation Plan

| Risk | Mitigation | Contingency |
|---|---|---|
| Zitadel SAML issues with institutional IdPs | Test early with target IdPs | Switch to Keycloak for SAML-only scenarios |
| Token migration breaks existing users | New fields are nullable, no migration for existing users | Rollback: remove IdP routes, redeploy without Zitadel |
| IdP downtime blocks all logins | Fallback to local auth when IdP is unreachable | Add circuit breaker in backend |
| Performance regression | Benchmark with/without IdP validation | Optimize JWKS caching, skip sync on repeat logins |

### Keycloak Fallback Consideration

If Zitadel proves insufficient (e.g., specific SAML institutional IdP compatibility), Keycloak 26.5 can be substituted with configuration-only changes thanks to the IdP-agnostic SDK approach:

```javascript
// config/oidc-config.js — switch from Zitadel to Keycloak
module.exports = {
  authority: process.env.IDP_AUTHORITY || 'http://keycloak:8080/realms/genie-ai',
  clientId: process.env.IDP_CLIENT_ID || 'genie-ai-backend',
  // ... rest stays the same
};
```

Both `oidc-client-ts` (Vue 3) and `flutter_appauth` (Flutter) work identically with any OIDC-compliant provider.

---

---

## Conclusion and Next Steps

### Summary of Key Technical Findings

This research establishes that GENIE.AI's third-party IdP integration is technically well-grounded in 2026. The existing architecture (`gov-chat-backend` as BFF, Kong as API gateway, JWT-based auth) naturally accommodates IdP integration without fundamental restructuring. The key insight is that the **BFF pattern** converts any IdP token into a standard GENIE.AI JWT, making downstream services completely IdP-agnostic.

**Keycloak is recommended** as the primary IdP based on the team's existing expertise, proven government track record, Apache 2.0 license (free forever), and the reality that SAML 2.0 is not a requirement — OIDC covers all expected integration scenarios. The architecture is designed to be IdP-agnostic through the use of `oidc-client-ts` (Vue 3) and `flutter_appauth` (Flutter), ensuring that switching to another OIDC provider in the future would require only configuration changes.

### Critical Decision Points

1. **Zitadel vs Keycloak** — Keycloak selected based on team expertise and proven track record; IdP-agnostic SDKs preserve future optionality
2. **BFF vs Direct Client** — BFF pattern is strongly recommended; Issue #218's direct approach has security implications (localStorage tokens, client-side refresh tokens)
3. **Migration strategy** — Strangler fig pattern ensures zero-downtime migration; existing local auth remains fully functional throughout
4. **SAML** — Not a requirement for GENIE.AI; OIDC is sufficient for all expected IdP integrations; Keycloak SAML broker available as insurance for edge cases

### Recommended Next Steps

| Step | Action | Owner | Timeline |
|---|---|---|---|
| 1 | Deploy Keycloak via Docker Compose (standard setup) | Backend Dev | Week 1 |
| 2 | Configure OIDC clients + social IdP connectors (Google, Microsoft) | Backend Dev | Week 1-2 |
| 3 | Implement `idp-auth-service.js` backend integration | Backend Dev | Week 2-4 |
| 4 | Add `oidc-client-ts` composable to Vue 3 frontend | Frontend Dev | Week 4-5 |
| 5 | Add `flutter_appauth` to Flutter mobile | Mobile Dev | Week 5-6 |
| 6 | Configure Kong JWT plugin for GENIE.AI JWTs | DevOps | Week 6 |
| 7 | Integration testing across all platforms | QA | Week 6-7 |

### Relationship to Issue #218

This research validates the **direction** of Issue #218 (IdP integration with Keycloak) but recommends **different technical choices**:

| Aspect | Issue #218 | This Research |
|---|---|---|
| IdP | Keycloak only | Keycloak (recommended — team expertise) |
| Client SDK | `keycloak-js` (vendor-locked) | `oidc-client-ts` / `flutter_appauth` (IdP-agnostic) |
| Token storage | Client-side (localStorage) | Server-side (BFF pattern) |
| Auth flow | Client redirects to Keycloak directly | Backend handles token exchange (BFF) |
| Token validation | Client sends ID token to backend | Backend validates IdP token, issues GENIE.AI JWT |
| Mobile | Not addressed | `flutter_appauth` with PKCE + `flutter_secure_storage` |
| Multi-tenancy | Keycloak realms | Zitadel organizations (native) |
| Sovereignty | Not addressed | ISO 27001, GDPR, SOC2 Type II certifications |

### Confidence Levels

| Claim | Confidence | Source |
|---|---|---|
| Keycloak 26.5.6 is current version | **High** | GitHub releases (live fetch, March 2026) |
| Keycloak 20+ CVEs in Q1 2026 | **High** | GitHub releases (live fetch, March 2026) |
| Zitadel certifications (ISO 27001, GDPR, SOC2) | **High** | Zitadel official site (live fetch, March 2026) |
| Zitadel Flutter SDK exists | **High** | Zitadel official site (live fetch, March 2026) |
| `oidc-client-ts` is recommended for Vue 3 | **Medium-High** | Web search (rate-limited, supplemented by training data) |
| `flutter_appauth` is standard for Flutter OIDC | **Medium-High** | Web search (rate-limited, supplemented by training data) |
| Zitadel SAML support quality for institutional IdPs | **Medium** | No live testing performed — needs POC validation |
| 4-6 weeks implementation estimate | **Medium** | Based on codebase analysis; actual may vary |

### Research Limitations

- Web search tool experienced persistent rate limiting (HTTP 429) throughout the research session; some claims are supplemented by training data rather than live source verification
- SAML 2.0 was initially assessed as a requirement but is not needed — OIDC covers all expected integration scenarios for GENIE.AI (Google, Microsoft Entra ID, GitHub, Okta all support OIDC)
- The Flutter mobile app (`mobile/genie_ai_mobile/`) auth implementation was not fully analyzed (explore agent hit context limit)
- Performance benchmarks (latency of BFF token exchange, JWKS validation overhead) were not measured

---

## Source Documentation

### Primary Sources (Live Verified)
- [Keycloak Official Site](https://www.keycloak.org/) — Fetched March 2026
- [Keycloak GitHub Releases](https://github.com/keycloak/keycloak/releases) — Fetched March 2026 (v26.5.6 current)
- [Zitadel Official Site](https://zitadel.com/) — Fetched March 2026
- [GitLab Issue #218](https://opensource.unicc.org/un/itu/genie-ai/-/issues/218) — Fetched via `glab issue view 218`

### Secondary Sources (Training Data, Not Live Verified)
- `oidc-client-ts` npm package documentation
- `flutter_appauth` pub.dev documentation
- Keycloak token exchange documentation
- OAuth 2.0 Token Exchange (RFC 8693)
- OAuth 2.1 draft specification
- SCIM 2.0 (RFC 7643/7644) protocol specification
- Kong OIDC/JWT plugin documentation
- MOSIP architecture documentation
- eIDAS architecture reference

### Codebase Sources (Direct Analysis)
- `components/gov-chat-backend/services/auth-service.js` — JWT auth, token generation, user registration
- `components/gov-chat-backend/middleware/auth-middleware.js` — Express JWT validation middleware
- `components/gov-chat-frontend/src/store/modules/auth.js` — Vuex auth state management
- `components/gov-chat-frontend/src/views/LoginView.vue` — Login page component
- `components/gov-chat-frontend/src/services/httpService.js` — Axios HTTP client
- `docker-compose.yaml` — Full stack service definitions
- `components/docker-compose.yaml` — GENIE.AI services subset
- `api-gateway-solution/nginx/conf/default.conf` — NGINX reverse proxy config

---

**Research Completion Date:** 2026-03-26
**Research Type:** Technical — State of the Art Analysis
**Document Path:** `_bmad-output/planning-artifacts/research/technical-identity-provider-integration-research-2026-03-26.md`
**Source Verification:** Mixed — Primary sources live-verified; secondary sources from training data (web search rate-limited)
**Technical Confidence Level:** High on factual claims (Keycloak version, CVEs, certifications); Medium on implementation estimates and untested SAML compatibility
