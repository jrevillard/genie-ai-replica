# Sprint Change Proposal — 2026-04-02

## 1. Issue Summary

Two infrastructure issues discovered during Story 1.9 (External IdP Connection via Keycloak Only) implementation:

1. **PostgreSQL service/volume naming misleading**: The service `kong-database` and volume `kong_data` were originally created for Kong only. Keycloak was later added as a second database consumer sharing the same PostgreSQL instance. The volume name implies Kong-only data, but it stores both Kong and Keycloak databases. This is confusing for operations and maintenance.

2. **keycloak-config-cli variable substitution syntax broken by code review**: A code review commit (`f1eae7c`) incorrectly changed the variable substitution syntax in `genie-realm.yaml` from `$(env:VAR)` (correct, keycloak-config-cli syntax) to `${env:VAR}` (standard env var syntax that keycloak-config-cli does NOT support). This caused realm import failure: `Cannot create realm '${env:KC_REALM}': HTTP 400 Bad Request`. The syntax has been fixed in `genie-realm.yaml`, but the architecture document (Decision D6) still references the wrong syntax, and project-context.md has no warning about this gotcha.

## 2. Impact Analysis

### Epic Impact
- **Epic 1**: No structural changes. Two minor infrastructure corrections.
- **Epic 2, 3, 4**: No impact.

### Artifact Conflicts
- **architecture.md**: Decision D6 references `${env:...}` syntax — must be corrected to `$(env:...)`.
- **docker-compose.yaml**: Stale comment referencing `${env:VAR}` instead of `$(env:VAR)`.
- **docker-compose.yaml**: Service name `kong-database` and volume `kong_data` are misleading.
- **project-context.md**: Missing gotcha documentation for keycloak-config-cli variable syntax.

### Technical Impact
- Volume rename requires `docker stack rm` + `docker volume rm` + redeploy (data loss for Kong and Keycloak databases).
- No code changes in backend or frontend.

## 3. Recommended Approach

**Direct Adjustment** — Minor infrastructure corrections with no epic or story scope changes.

- Effort: Low
- Risk: Low (volume recreation is the only operational concern)
- Timeline: No impact

## 4. Detailed Change Proposals

### Change 1: Rename PostgreSQL service and volume

**File: docker-compose.yaml**

| Item | Old | New |
|------|-----|-----|
| Service name | `kong-database` | `postgres` |
| Volume name | `kong_data` | `postgres_data` |
| All references | `kong-database:5432` | `postgres:5432` |

Affected references:
- `kong` service: `KONG_PG_HOST=kong-database` → `KONG_PG_HOST=postgres`
- `kong-migrations` service: `KONG_PG_HOST=kong-database` → `KONG_PG_HOST=postgres`
- `kong-config` service: `KONG_PG_HOST=kong-database` → `KONG_PG_HOST=postgres`
- `postgres-init` service: `PGHOST=kong-database` → `PGHOST=postgres`
- `keycloak` service: `KC_DB_URL` host portion `kong-database` → `postgres`

**File: config/postgres/init-databases.sh**

| Item | Old | New |
|------|-----|-----|
| Default PGHOST | `kong-database` | `postgres` |

Rationale: The PostgreSQL instance is a shared service used by both Kong and Keycloak. The name `postgres` accurately reflects its role. Volume `postgres_data` makes it clear this is shared data.

### Change 2: Fix stale comment in docker-compose.yaml

**File: docker-compose.yaml** (keycloak-config service environment section)

```
OLD: # Variables referenced in genie-realm.yaml via ${env:VAR} substitution
NEW: # Variables referenced in genie-realm.yaml via $(env:VAR) substitution
```

Rationale: keycloak-config-cli uses `$(env:VAR)` syntax, not `${env:VAR}`. This stale comment could mislead future code reviews into "fixing" the correct syntax (which is exactly what happened).

### Change 3: Fix Architecture Decision D6

**File: architecture.md** (Decision D6 section)

```
OLD: Secrets injected via environment variables at runtime (${env:KEYCLOAK_CLIENT_SECRET}, ${env:KEYCLOAK_ADMIN_PASSWORD})
NEW: Secrets injected via environment variables at runtime ($(env:KEYCLOAK_CLIENT_SECRET), $(env:KEYCLOAK_ADMIN_PASSWORD))
```

Rationale: Architecture document must reflect the actual syntax used by keycloak-config-cli.

### Change 4: Document keycloak-config-cli gotcha in project-context.md

**File: project-context.md** — Add new section under "Critical Implementation Rules" > "Infrastructure Rules":

```markdown
#### Keycloak Config CLI — Variable Substitution Syntax

- keycloak-config-cli uses `$(env:VARIABLE)` syntax — NOT `${env:VARIABLE}`
- The prefix `$(env:` and suffix `)` are configurable via IMPORT_VARSUBSTITUTION_PREFIX/SUFFIX
- `IMPORT_VARSUBSTITUTION_ENABLED=true` must be set in the keycloak-config service environment
- Never change `$(env:VAR)` to `${env:VAR}` in `genie-realm.yaml` — this breaks variable substitution
- When reviewing `genie-realm.yaml`, preserve the `$(env:...)` syntax exactly as-is
```

Rationale: This gotcha caused a real production issue. Documenting it prevents recurrence in future code reviews.

### Change 5: Update Story 1.9 Dev Agent Record

**File: _bmad-output/implementation-artifacts/1-9-external-idp-connection-via-keycloak-only.md**

Add to Completion Notes and Change Log documenting these infrastructure fixes as associated findings.

## 5. Implementation Handoff

- **Scope**: Minor — direct implementation by dev team
- **Implementation order**:
  1. Rename service/volume in docker-compose.yaml
  2. Fix stale comment in docker-compose.yaml
  3. Fix architecture.md Decision D6
  4. Add gotcha to project-context.md
  5. Update story 1.9 Dev Agent Record
  6. Rebuild images, redeploy stack
  7. Verify stack health
- **Breaking**: Volume recreation loses Kong and Keycloak database state (acceptable for dev environment)

---

## 6. keycloak-auth-service.js — OIDC Discovery Refactor (from Story 1.9 E2E)

### 6.1 Issue Summary

During E2E testing of Story 1.9 (External IdP Connection), valid Keycloak tokens were rejected with 401 `TOKEN_INVALID`. Root cause: the original `keycloak-auth-service.js` (created in Story 1.3) resolved the JWKS endpoint by constructing a URL from the token's unverified `iss` claim (`${iss}/protocol/openid-connect/certs`). This had two problems:

1. **Network unreachability:** The backend runs inside Docker and cannot reach the public-facing issuer URL (`https://localhost/auth/realms/genie`). The internal Docker URL is `http://keycloak:8080`.
2. **Security weakness:** Manual `iss.startsWith()` / `iss.endsWith()` validation is too permissive and constitutes an issuer confusion vulnerability. Pre-validating unverified JWT claims before signature verification is a known anti-pattern.

**Fix:** Complete refactor to OIDC discovery pattern:
- Lazy singleton: first authenticated request triggers `/.well-known/openid-configuration` fetch
- Issuer whitelist map (`Map<issuer, JWKS>`) populated from discovery — token's unverified `iss` used only for map lookup
- jose native validation: `jwtVerify()` handles signature, `iss`, `aud`, `exp` in correct order (signature first)
- 30-second retry cooldown after init failure (prevents thundering herd)
- Multi-IdP ready: `init(url)` can be called multiple times for different IdPs

### 6.2 Impact Analysis

#### Epic Impact
- **Epic 1:** No structural changes. Refactor implemented within Story 1.9 scope.
- **Epic 2:** Significant — Stories 2.1, 2.2, 2.7 are impacted (see below).

#### Story Impact

| Story | Impact | Action |
|-------|--------|--------|
| **1.3** (Backend Auth Middleware) | Doc-only: implementation description now inaccurate | Update Task 1 description and Token Verification Flow |
| **1.8** (Token Validation Failure) | Doc-only: line number references and code issue descriptions are stale | Update Dev Notes sections |
| **2.1** (Backend JWKS with jose) | **Entirely obsolete** — all AC already implemented | **Remove from backlog** |
| **2.2** (Multi-Issuer JWKS Cache) | Partially obsolete — multi-issuer + caching done; force-refresh two-attempt not yet implemented | **Reduce scope** to only force-refresh |
| **2.7** (Health Check) | Partially addressed — `ensureInitialized()` with cooldown handles auth-layer unavailability | **Reduce scope** — health endpoint still needs implementation |

#### Artifact Conflicts

| Document | Section | Conflict |
|----------|---------|----------|
| `architecture.md` | D3 (JWKS caching) | Describes custom cache with 5-min TTL + force-refresh. Actual: jose `createRemoteJWKS()` built-in HTTP caching. Force-refresh not yet implemented. |
| `architecture.md` | NFR10 (JWKS cache with force-refresh) | Partially addressed by jose caching. Explicit 5-min TTL and two-attempt pattern not yet implemented. |
| `architecture.md` | NFR11 (Health check) | Not yet implemented. `ensureInitialized()` cooldown is auth-layer only. |
| `architecture.md` | Auth Middleware Flow (step 2) | References "force-refresh logic" not yet implemented. |
| `1-3-*.md` | Task 1 | "JWKS endpoint resolved from token's `iss` claim" — no longer accurate. |
| `1-3-*.md` | Token Verification Flow | "Verify JWT signature via JWKS from `${iss}/.well-known/jwks.json`" — no longer accurate. |
| `1-8-*.md` | Dev Notes > Issue 2 | References "keycloak-auth-service.js:73" and "keycloak-auth-service.js:95" — line numbers shifted. Code described no longer exists. |
| `sprint-status.yaml` | Story 1.3 | Status `review` — underlying code was significantly refactored. |

### 6.3 Recommended Approach

**Direct Adjustment** — Documentation updates and backlog reorganization. No code rollback needed.

- **Effort:** Low (documentation only — code is already correct and tested)
- **Risk:** Low
- **Timeline:** No impact on current sprint

**Rationale:** The refactor is a net improvement — it fixes a real bug (Docker network reachability), eliminates a security vulnerability (issuer confusion), and delivers Epic 2 functionality (Story 2.1) early. All 54 unit tests pass (21 service + 27 middleware). No epic restructuring, no scope reduction, no MVP impact.

### 6.4 Detailed Change Proposals

#### Change 6: Update Story 1.3 — Task 1 description

**File:** `_bmad-output/implementation-artifacts/1-3-backend-auth-middleware-protected-and-public-routes.md`

```
OLD (Task 1, line 34):
  - [x] JWKS endpoint resolved from token's `iss` claim: `${iss}/.well-known/jwks.json`

NEW:
  - [x] OIDC discovery: fetch `/.well-known/openid-configuration` from Keycloak to resolve `issuer` and `jwks_uri` (lazy singleton, triggered on first token verification)
```

Rationale: The JWKS endpoint is no longer derived from the token. OIDC discovery provides both the canonical issuer and the JWKS URI.

#### Change 7: Update Story 1.3 — Token Verification Flow

**File:** `_bmad-output/implementation-artifacts/1-3-backend-auth-middleware-protected-and-public-routes.md`

```
OLD (Token Verification Flow, lines 232-240):
  1. Extract Bearer token from Authorization header
  2. If missing/malformed → 401 TOKEN_INVALID
  3. Verify JWT signature via JWKS from ${iss}/.well-known/jwks.json
  4. Validate claims: iss, aud (KEYCLOAK_CLIENT_ID), exp
  5. If expired → 401 TOKEN_EXPIRED
  6. If invalid → 401 TOKEN_INVALID
  7. Attach decoded payload to req.user with iss_sub composite key
  8. Call next()

NEW:
  1. Extract Bearer token from Authorization header
  2. If missing/malformed → 401 TOKEN_INVALID
  3. Ensure OIDC discovery initialized (lazy singleton with 30s retry cooldown)
  4. Extract unverified `iss` from token payload → lookup in trusted issuer map
  5. If issuer not in map → 401 TOKEN_INVALID ("Unknown issuer")
  6. Verify JWT signature + claims via jose jwtVerify() (iss, aud, exp, sub, alg=RS256)
  7. If expired → 401 TOKEN_EXPIRED
  8. If signature/claims invalid → 401 TOKEN_INVALID
  9. Attach decoded payload to req.user with iss_sub composite key
  10. Call next()
```

#### Change 8: Update Story 1.3 — Completion Notes

**File:** `_bmad-output/implementation-artifacts/1-3-backend-auth-middleware-protected-and-public-routes.md`

```
OLD (Completion Notes item 1, line 275):
  1. **keycloak-auth-service.js**: Implements `verifyToken(token)` using `jose.jwtVerify()` with `createRemoteJWKS()`. JWKS endpoint is derived from token's `iss` claim (`${iss}/protocol/openid-connect/certs` — Keycloak's standard JWKS path). Validates `iss`, `aud`, `exp`, `sub` claims. Returns decoded payload with `iss_sub` composite key. Structured errors via `TokenVerificationError` class.

NEW:
  1. **keycloak-auth-service.js**: Implements `verifyToken(token)` using OIDC discovery pattern. On first call, fetches `/.well-known/openid-configuration` from Keycloak to resolve canonical `issuer` and `jwks_uri`. Stores trusted issuers in an `issuerMap` (Map<issuer, JWKS>). Token's unverified `iss` is used only for map lookup (whitelist pattern). All validation (signature, iss, aud, exp, sub, alg) delegated to `jose.jwtVerify()`. Lazy singleton with 30-second retry cooldown on init failure. Multi-IdP ready via `init(url)`. Returns decoded payload with `iss_sub` composite key. Structured errors via `TokenVerificationError` class.
```

#### Change 9: Update Story 1.8 — Dev Notes

**File:** `_bmad-output/implementation-artifacts/1-8-token-validation-failure-handling-backend-response-format.md`

```
OLD (Dev Notes > Current Code Issues > Issue 2, lines 113-116):
  **Issue 2: Internal details exposed in service error messages**
  - `keycloak-auth-service.js:73` — issuer validation error exposes `payload.iss` (Keycloak URL)
  - `keycloak-auth-service.js:95` — audience mismatch error exposes `KEYCLOAK_CLIENT_ID` and `verifiedPayload.aud`
  - Fix: Replace with generic messages like "Token issuer validation failed" and "Token audience validation failed"

NEW:
  **Issue 2: Internal details exposed in service error messages** (FIXED during Story 1.9 refactor)
  - Original code manually validated `iss` and `aud` claims with error messages that exposed internal values
  - Story 1.9 refactored `keycloak-auth-service.js` to OIDC discovery pattern — all claim validation is now delegated to `jose.jwtVerify()` with native `JWTClaimValidationFailed` errors
  - The service catches jose's structured errors and returns generic messages: "Token issuer validation failed", "Token audience validation failed"
  - No internal values (URLs, client IDs, token claims) are exposed in error messages
```

#### Change 10: Update Architecture D3

**File:** `_bmad-output/planning-artifacts/architecture.md`

```
OLD:
  **Decision D3 — JWKS caching strategy:**

  | Parameter | Value | Rationale |
  |---|---|---|
  | Cache key | `{iss}` (issuer URL) | Enables multi-issuer without collision |
  | TTL | 5 minutes | Below Keycloak key rotation interval (~10 min) |
  | Force-refresh trigger | HTTP 401 + valid `exp` | Detects key rotation without performance penalty |
  | Force-refresh logic | 1. Token verification fails → 2. Check `exp` still valid → 3. Force-refresh JWKS for this issuer → 4. Re-verify token → 5. If fail again, reject with 401 | Two-attempt pattern prevents user disruption during key rotation |

NEW:
  **Decision D3 — JWKS resolution and caching strategy:**

  | Parameter | Value | Rationale |
  |---|---|---|
  | Discovery | OIDC `/.well-known/openid-configuration` | Standard OIDC discovery — resolves canonical issuer and JWKS URI from Keycloak |
  | Init pattern | Lazy singleton with 30s retry cooldown | First authenticated request triggers discovery; failures cooldown 30s before retry |
  | Issuer trust | Whitelist map (`Map<issuer, JWKS>`) | Token's unverified `iss` used only for map lookup — prevents issuer confusion attacks |
  | Cache | jose `createRemoteJWKS()` built-in HTTP caching | Uses `Cache-Control` / `JWKS-TTL` headers from Keycloak JWKS response |
  | Force-refresh | Two-attempt pattern (Story 2.2) | On 401 with valid `exp`: force-refresh JWKS → re-verify → if fail again, reject |
  | Multi-issuer | `init(url)` callable multiple times | Supports multiple Keycloak realms or external IdPs |

  **Implementation status (as of Story 1.9):**
  - [x] OIDC discovery with lazy singleton
  - [x] Issuer whitelist map
  - [x] jose built-in JWKS HTTP caching
  - [x] 30s retry cooldown on init failure
  - [x] Multi-issuer `init(url)` support
  - [ ] Two-attempt force-refresh on 401 (deferred to Story 2.2)

  **Caching behavior note (for Story 2.2 dev):** jose's `createRemoteJWKS()` uses HTTP caching based on `Cache-Control` / `JWKS-TTL` headers from the JWKS response. Keycloak 26.x may not always return explicit cache headers — in that case, jose may refetch JWKS on every verification call. Story 2.2 should verify Keycloak's actual caching headers and, if absent, implement an explicit TTL wrapper (5 minutes, per original D3 rationale) around `createRemoteJWKS()`.
```

#### Change 11: Update Architecture — Auth Middleware Flow

**File:** `_bmad-output/planning-artifacts/architecture.md`

```
OLD:
  **Auth Middleware Flow:**
  1. Extract Bearer token from Authorization header
  2. Verify JWT signature via JWKS (with force-refresh logic above)
  3. Validate claims: `iss`, `aud`, `exp`

NEW:
  **Auth Middleware Flow:**
  1. Extract Bearer token from Authorization header
  2. Ensure OIDC discovery initialized (lazy singleton, 30s cooldown)
  3. Lookup token's `iss` in trusted issuer map (whitelist)
  4. Verify JWT signature + claims via jose `jwtVerify()` (iss, aud, exp, sub, alg=RS256)
  5. [Story 2.2] On 401 with valid `exp`: force-refresh JWKS → re-verify → if fail, reject
```

#### Change 12: Remove Story 2.1 from backlog

**File:** `_bmad-output/implementation-artifacts/sprint-status.yaml`

```
OLD:
  2-1-backend-jwks-token-validation-with-jose-library: backlog

NEW:
  # Story 2.1 removed — fully implemented during Story 1.9 refactor (OIDC discovery pattern)
  # See sprint-change-proposal-2026-04-02.md Section 6
```

#### Change 13: Update Story 2.2 scope in epics.md

**File:** `_bmad-output/planning-artifacts/epics.md`

```
OLD:
  ### Story 2.2: Multi-Issuer JWKS Cache with Force-Refresh

  As a backend system,
  I want to cache JWKS public keys per issuer with a TTL and force-refresh on validation failure,
  So that token validation is both fast and resilient to key rotation.

NEW:
  ### Story 2.2: JWKS Force-Refresh on Validation Failure

  As a backend system,
  I want to force-refresh the JWKS cache when token validation fails with a valid expiration,
  So that token validation is resilient to Keycloak key rotation without user disruption.

  **Note:** Multi-issuer JWKS resolution and caching are already implemented (Story 1.9 OIDC discovery refactor). This story covers ONLY the two-attempt force-refresh pattern described in D3.
```

#### Change 14: Update sprint-status.yaml Story 2.2 description

**File:** `_bmad-output/implementation-artifacts/sprint-status.yaml`

```
OLD:
  2-2-multi-issuer-jwks-cache-with-force-refresh: backlog

NEW:
  2-2-jwks-force-refresh-on-validation-failure: backlog
```

#### Change 15: Update Story 2.7 scope in epics.md

**File:** `_bmad-output/planning-artifacts/epics.md`

```
OLD:
  ### Story 2.7: Keycloak Unavailable Detection & Health Check

  As an IT administrator,
  I want the health check endpoint to report Keycloak availability status,
  So that I can quickly diagnose whether authentication issues are caused by Keycloak being unreachable.

NEW:
  ### Story 2.7: Health Check — Keycloak Discovery Endpoint Reachability

  As an IT administrator,
  I want the health check endpoint to verify that the Keycloak OIDC discovery endpoint is reachable,
  So that I can quickly diagnose whether authentication issues are caused by Keycloak being unreachable.

  **Note:** The auth layer already handles Keycloak unavailability via the lazy OIDC discovery singleton — if Keycloak is down at startup or during operation, `ensureInitialized()` returns `AUTH_SERVICE_UNAVAILABLE` with a 30s retry cooldown. This story covers ONLY the `/health` endpoint enhancement to proactively report Keycloak reachability (NFR11), not the auth-layer unavailability handling which is already implemented.
```

### 6.5 Implementation Handoff

- **Scope:** Minor — documentation updates and backlog reorganization
- **Implementation order:**
  1. Update architecture.md (Changes 10, 11) — architect
  2. Update Story 1.3 doc (Changes 6, 7, 8) — dev team
  3. Update Story 1.8 doc (Change 9) — dev team
  4. Remove/reduce Epic 2 stories (Changes 12, 13, 14, 15) — PO/SM
  5. Verify sprint-status.yaml consistency
- **No code changes required** — all implementation is already done and tested (54/54 tests pass)
- **No breaking changes** — the refactor is backward-compatible
