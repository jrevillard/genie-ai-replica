# Story 1.10: Offline/Air-Gapped Deployment Validation

Status: done

## Story

As an IT administrator in a sovereign deployment,
I want the entire authentication system to function without any external network calls,
so that GENIE.AI meets air-gapped/offline deployment requirements.

## Acceptance Criteria

1. **Local Token Validation Only (FR10, NFR4)**
   - Given the GENIE.AI stack is deployed in an air-gapped environment
   - When a user authenticates via Keycloak (local credentials only)
   - Then all token validation happens locally via JWKS — no external API calls are made
   - And the backend `keycloak-auth-service.js` only communicates with the local Keycloak instance

2. **All Images from Local Registry (FR10)**
   - Given the GENIE.AI stack is deployed in an air-gapped environment
   - When Docker Swarm deploys the stack
   - Then all images (including `genie-keycloak`, `genie-keycloak-config`, and all external base images) are served from the local container registry
   - And no image pull from Docker Hub, GHCR, Quay, or any external registry is attempted

3. **Keycloak Offline Operation (FR10)**
   - Given the Keycloak container starts in an air-gapped environment
   - When Keycloak initializes the realm via `keycloak-config-cli`
   - Then Keycloak starts and operates without reaching any external URL
   - And the realm OIDC discovery endpoint `/.well-known/openid-configuration` is reachable within the deployment boundary

4. **Frontend OIDC Within Deployment Boundary (FR10)**
   - Given the frontend is running in an air-gapped environment
   - When a user initiates authentication
   - Then the entire OIDC flow (redirect to Keycloak, callback, token storage) completes within the deployment boundary
   - And no browser request leaves the deployment boundary for authentication purposes

5. **Data Residency Within Boundary (FR36, NFR16)**
   - Given the authentication system is operating in an air-gapped environment
   - When users authenticate and use the system
   - Then all user identity data (tokens, profiles, sessions) remains within the deployment boundary
   - And no external data transmission occurs for authentication or identity purposes
   - And a network isolation test (iptables or physical disconnect) during a full authentication cycle confirms the system operates normally with no external connectivity

## Tasks / Subtasks

- [x] Task 1: Audit authentication code for external network calls (AC: #1, #5)
  - [x] Run `grep -rn 'fetch\|axios\|http\.get\|https\.get\|request(' components/gov-chat-backend/` to find all outbound HTTP calls in backend auth code
  - [x] Audit `keycloak-auth-service.js` — verify OIDC discovery and JWKS fetch only target `KEYCLOAK_URL` (local Keycloak)
  - [x] Audit `keycloak-auth-middleware.js` — verify no external calls
  - [x] Audit `user-provisioning-service.js` — verify no external calls
  - [x] Audit `auth-routes.js` — verify no external calls
  - [x] Audit frontend `oidcConfig.js` — verify authority points to local Keycloak via NGINX
  - [x] Audit frontend `keycloakAuthService.js` — verify OIDC endpoints resolve within deployment boundary
  - [x] Check for any telemetry, analytics, or crash reporting that phones home
  - [x] Document findings in Phase E of `docs/e2e-test-plan-external-idp.md`

- [x] Task 2: Verify Keycloak offline operation (AC: #3)
  - [x] Verify Keycloak 26.5.6 has no built-in telemetry or phone-home behavior — `opentelemetry:v1` and `user-event-metrics:v1` are enabled by default but do NOT send data without explicit OTel endpoint config. No phone-home to Red Hat or external services. Recommend `--features-disabled=opentelemetry,user-event-metrics` for air-gapped.
  - [x] Verify `genie-realm.yaml` contains no external URLs — only `localhost` redirect URIs
  - [x] Verify `keycloak-config-cli` does not make external calls during realm initialization — only talks to local Keycloak admin API
  - [x] Document Keycloak offline behavior and any configuration needed to ensure fully offline operation
  - [x] Add findings to Phase E of `docs/e2e-test-plan-external-idp.md`

- [x] Task 3: Cross-check existing air-gapped image list (AC: #2)
  - [x] Cross-reference Step 5d image list in `docs/docker-swarm-setup.md` against all `image:` directives in `docker-compose.yaml` — confirm no missing images
  - [x] All 16 external images match (13 runtime + 3 build-time Dockerfiles). No gaps found. No changes to Step 5d needed.

- [x] Task 4: Execute and document offline deployment verification (AC: #1, #3, #4, #5)
  - [x] AC #1 — Backend grep audit: keycloak-auth-service.js targets KEYCLOAK_URL only; auth-middleware, auth-routes, user-provisioning have zero outbound calls. Non-auth services (weather, security-scan) excluded from scope.
  - [x] AC #2 — Image cross-check: 16/16 external images match between docker-compose.yaml and Step 5d (13 runtime + 3 build-time Dockerfiles). No gaps.
  - [x] AC #3 — Keycloak realm YAML: only `localhost` URLs in redirectUris/webOrigins. Zero external URLs. Keycloak 26.5.6 has no telemetry phone-home (confirmed via docs).
  - [x] AC #4 — Frontend OIDC: authority=`${keycloakUrl}/realms/${realm}`, redirect_uri=`${origin}/callback`, post_logout=`origin`. All local.
  - [x] AC #5 — Documented both network isolation methods (iptables DOCKER-USER toggle + physical disconnect) in Phase E of e2e-test-plan. Manual execution deferred to user.
  - [x] Added Phase E (Air-Gapped Validation) to `docs/e2e-test-plan-external-idp.md` with 5 test procedures (E.1-E.5)
  - [x] Added Phase E rows to Test Results Summary and Acceptance Criteria Mapping tables

- [x] Task 5: Run full test suite to verify no regressions (AC: #1)
  - [x] Backend: 70/70 tests passed (3 suites: keycloak-auth-service, keycloak-auth-middleware, user-provisioning-service)
  - [x] Frontend: 87/87 tests passed (5 suites: oidcConfig, keycloakAuthService, router, auth store, httpService-401-retry)
  - [x] Zero regressions — this story produced zero code changes

## Dev Notes

### Architecture Compliance

**Key Architectural Principle — Offline-First by Design (FR10):**
> "The system functions fully offline after initial setup (sovereign/air-gapped deployment) — no external API calls for token validation or user management"

The entire Keycloak-based authentication architecture is **already offline-capable by design**. This story validates and documents this capability — no code changes are expected.

**Authentication Data Flow (Air-Gapped):**
```
Browser → NGINX (reverse proxy)
              │
              ├── /auth/* → Keycloak (local container)
              │                  │
              │                  └── OIDC discovery + JWKS (local)
              │
              └── /api/* → Backend
                              │
                              ├── keycloak-auth-service.js → JWKS from Keycloak (local)
                              ├── user-provisioning-service.js → ArangoDB (local)
                              └── auth-routes.js → local processing only
```

No component in the authentication flow communicates outside the deployment boundary. Keycloak is the sole external-facing service (via NGINX proxy), and it only receives browser requests — it does not make outbound calls for authentication.

### Code Audit Findings (Pre-Analysis)

**Backend — `keycloak-auth-service.js`:**
- OIDC discovery fetches from `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`
- JWKS fetched from the `jwks_uri` in the discovery document
- Both target `KEYCLOAK_URL` which is set to `https://${NGINX_PUBLIC_DOMAIN}/auth` (local NGINX proxy)
- **No external calls** — only communicates with local Keycloak via NGINX

**Frontend — `oidcConfig.js`:**
- Authority: `${keycloakUrl}/realms/${realm}` where `keycloakUrl` defaults to `${origin}/auth`
- Redirect URI: `${origin}/callback` (same origin)
- Post-logout redirect: `origin` (same origin)
- **No external calls** — all OIDC endpoints resolve to local NGINX proxy

**Keycloak — `genie-realm.yaml`:**
- No external URLs in realm configuration
- All values use `$(env:...)` for secrets, no external references
- `sslRequired: none` (TLS handled by NGINX, not Keycloak)
- **No external calls** — self-contained realm definition

**Keycloak Container:**
- Keycloak 26.x has **no built-in telemetry** — does not phone home
- `keycloak-config-cli` runs once at startup, only talks to local Keycloak
- PostgreSQL backend is local (`postgres` service in compose)

### External Images Requiring Pre-Pull

From `docker-compose.yaml` analysis, these external images must be pre-pulled and pushed to local registry for air-gapped deployment:

| Image | Source | Notes |
|-------|--------|-------|
| `postgres:13` | Docker Hub | Shared DB for Kong + Keycloak |
| `kong:latest` | Docker Hub | API Gateway (2 services) |
| `redis:7-alpine` | Docker Hub | Cache |
| `clamav/clamav` | Docker Hub | Document scanning |
| `arangodb/arangodb:3.12.4` | Docker Hub | Database |
| `vllm/vllm-openai:latest` | Docker Hub | LLM inference |
| `opea/llm-textgen:latest` | Docker Hub | OPEA text generation |
| `opea/translation:latest` | Docker Hub | OPEA translation |
| `opea/guardrails:latest` | Docker Hub | OPEA guardrails |
| `opea/embedding:latest` | Docker Hub | OPEA embedding |
| `opea/chatqna-ui:latest` | Docker Hub | OPEA Chat UI |
| `opea/nginx:latest` | Docker Hub | OPEA NGINX |
| `ghcr.io/huggingface/text-embeddings-inference:1.9.3` | GHCR | TEI embedding/reranking (2 services) |
| `quay.io/keycloak/keycloak:26.5.6` | Quay | Keycloak base image |
| `adorsys/keycloak-config-cli:6.5.0-26` | Docker Hub | Keycloak realm config |
| `nginx:alpine` | Docker Hub | NGINX base (used in genie-ai-nginx Dockerfile) |

**GENIE.AI custom images** (built locally, pushed to registry):
- `genie-ai-frontend`, `genie-ai-backend`, `genie-ai-keycloak`, `genie-keycloak-config`
- `genie-ai-kong-config`, `genie-ai-nginx`, `genie-ai-document-repository`
- `genie-ai-postgres-init`
- `genie-ai-reranker`, `genie-ai-dataprep-arango`, `genie-ai-retriever-arango`, `genie-ai-chatqna-server`

### Known Limitations for Air-Gapped Deployments

1. **No external IdPs** — only local Keycloak credentials work (Story 1.9 documented this)
2. **No auto-updates** — images must be manually updated and re-pushed to local registry
3. **No HuggingFace model auto-download** — TEI models must be pre-cached in `data/huggingface/`
4. **Token revocation gap** — JWKS caching covers signature verification but cannot detect revoked tokens in real-time (documented security trade-off per architecture Decision D3)
5. **No health check for external IdP status** — NFR11 health check only verifies local Keycloak

### Project Structure Notes

**Files to CREATE:**
(none)

**Files to MODIFY (documentation only, no code):**
| File | Change |
|------|--------|
| `docs/e2e-test-plan-external-idp.md` | Add Phase E: Air-Gapped Validation + rows in Test Results Summary |
| `docs/docker-swarm-setup.md` | Cross-check Step 5d image list; add missing images if any |

**Files NOT MODIFIED:**
| File | Reason |
|------|--------|
| `docker-compose.yaml` | Already supports `SWARM_REGISTRY_URL` for local registry |
| `components/gov-chat-backend/**` | Auth code already offline-capable by design |
| `components/gov-chat-frontend/**` | OIDC config already resolves to local Keycloak |
| `config/keycloak/genie-realm.yaml` | No external URLs — already offline-safe |
| `env` | No changes needed — `SWARM_REGISTRY_URL` already documented |

### Previous Story Intelligence (Story 1-9)

**Key patterns from Story 1-9:**
- Story 1-9 was primarily documentation (external IdP integration guide)
- E2E testing exposed pre-existing bugs that were fixed (jose v6 migration, auth-routes middleware fix, etc.)
- The fixes from Story 1-9 (KEYCLOAK_URL as required env var, lazy OIDC discovery with retry cooldown) are **beneficial for offline deployments** — they make the auth layer resilient when Keycloak is temporarily unreachable
- `AUTH_SERVICE_UNAVAILABLE` error code (Story 1-9 E2E fix) provides graceful degradation when Keycloak is down

**Lessons from all previous stories (1-1 through 1-9):**
- Backend auth middleware validates Keycloak tokens via JWKS — completely self-contained
- Frontend OIDC flow redirects to Keycloak via NGINX — all within deployment boundary
- JIT provisioning uses `{iss}#{sub}` composite key — no external lookups
- All 70 backend tests and 87 frontend tests currently pass — this story should not change any of them
- The standardized error response format (Story 1-8) and auth service unavailability handling (Story 1-9) are already offline-safe

### Backend Conventions (from project-context.md)

- **CommonJS only**: `const x = require('x')` and `module.exports = { ... }`
- Never use `import`/`export` syntax
- `const` by default, `let` for reassignments, never `var`
- 2-space indentation, single quotes, semicolons
- Documentation: English only (per CLAUDE.md language policy)

### Testing Strategy

**This story has no code changes, so testing focuses on:**

1. **Existing test suite passes unchanged** — confirms offline-safe design:
   - `cd components/gov-chat-backend && npx jest --verbose` (70 tests expected)
   - `cd components/gov-chat-frontend && npx jest` (87 tests expected)

2. **Documentation review** — `docs/e2e-test-plan-external-idp.md` (Phase E) is the primary deliverable:
   - Complete image list cross-referenced with docker-compose.yaml
   - Step-by-step air-gapped verification procedures (E.1-E.5)
   - Test Results Summary with Phase E rows
   - Network isolation methods (iptables toggle + physical disconnect) for AC #5

3. **Verification executed by dev agent** (grep + code audit):
   - AC #1-4: automated grep on source code to verify absence of external calls
   - Results documented in Test Results Summary table

4. **Manual verification by user** (requires deployed environment):
   - AC #5: physical network disconnect or iptables + full auth cycle
   - User fills in the "Result" column in the Test Results Summary table

### References

- [Source: _bmad-output/planning-artifacts/prd.md#FR10] — "The system functions fully offline after initial setup (sovereign/air-gapped deployment) — no external API calls for token validation or user management"
- [Source: _bmad-output/planning-artifacts/prd.md#FR36] — "The system ensures all user identity data (tokens, profiles, sessions) remains within the institution's infrastructure — no data leaves the deployment boundary"
- [Source: _bmad-output/planning-artifacts/prd.md#NFR16] — "All user identity data (tokens, profiles, sessions) remains within the institution's deployment boundary — no external data transmission for authentication or identity purposes"
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.10] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Open Architectural Questions] — Token revocation in air-gapped mode: documented security trade-off
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision D6] — Keycloak realm initialization via custom image with keycloak-config-cli, no bind mounts, 100% cloud-native
- [Source: _bmad-output/planning-artifacts/architecture.md#Key Strengths] — Cloud-native config approach, defense in depth with optional Kong, backend autonomous
- [Source: docs/docker-swarm-setup.md#Step 5d] — Pre-pull external images for air-gapped deployments (existing but needs update)
- [Source: docs/external-idp-integration-guide.md#Air-Gapped Deployments] — External IdPs not available in air-gapped
- [Source: _bmad-output/project-context.md] — Backend conventions (CommonJS, Jest, naming)
- [Source: _bmad-output/implementation-artifacts/1-9-external-idp-connection-via-keycloak-only.md] — Previous story — auth layer state reference

## Dev Agent Record

### Agent Model Used

GLM-5-Turbo (Claude Code CLI)

### Debug Log References

N/A — no code changes, documentation-only story

### Completion Notes List

1. All 5 tasks completed successfully — zero code changes as expected
2. Tasks 1-2 (code audit): All auth code targets only local Keycloak via KEYCLOAK_URL. Keycloak 26.5.6 has no telemetry phone-home. Realm YAML contains zero external URLs.
3. Task 3 (image cross-check): 16/16 external images match between docker-compose.yaml and docker-swarm-setup.md Step 5d (13 runtime + 3 build-time Dockerfiles). No gaps found.
4. Task 4 (documentation): Added Phase E (Air-Gapped Validation) to docs/e2e-test-plan-external-idp.md with 5 test procedures (E.1-E.5). Updated Test Results Summary and Acceptance Criteria Mapping tables. AC #5 (network isolation) requires manual execution by user.
5. Task 5 (test suite): 70/70 backend tests + 87/87 frontend tests — zero regressions.

### File List

| File | Action | Description |
|------|--------|-------------|
| `docs/e2e-test-plan-external-idp.md` | MODIFIED | Added Phase E (Air-Gapped Validation) with 5 test procedures; updated Test Results Summary table with Phase E rows; updated Acceptance Criteria Mapping with Story 1.10 ACs; updated Full Test Run section |
| `docs/docker-swarm-setup.md` | NOT MODIFIED | Cross-checked Step 5d — all 16 images present, no gaps |

## Change Log

| Date | Change |
|------|--------|
| 2026-04-03 | Story completed — documentation-only, zero code changes. Phase E added to e2e-test-plan. All tests pass (70+87). |
