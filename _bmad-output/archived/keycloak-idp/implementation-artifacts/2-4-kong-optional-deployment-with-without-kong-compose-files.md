# Story 2.4: Kong Optional Deployment -- With/Without Kong Compose Files

Status: ready-for-dev

## Story

As an IT administrator,
I want to deploy GENIE.AI with Kong API gateway or without Kong using separate Docker Compose configurations,
so that I can choose the deployment topology that fits my infrastructure.

## Acceptance Criteria

1. **Full-Stack Deployment with Kong (FR9)**
   - Given the project provides Docker Compose configurations
   - When an IT administrator deploys with `docker-compose.yaml` (full stack)
   - Then Kong is included as the API gateway with Keycloak token validation configured
   - And Kong, Kong migrations, Kong config, postgres, and postgres-init services are all started
   - And NGINX routes `/api/` and `/auth/` traffic through Kong (current behavior)

2. **GENIE.AI-Only Deployment without Kong (FR9, NFR8)**
   - Given an IT administrator sets `DEPLOY_KONG=0` in `.env`
   - When deploying with `docker-compose.yaml`
   - Then Kong, Kong migrations, Kong config services are NOT started
   - And postgres service still starts (shared with Keycloak -- required regardless of Kong)
   - And NGINX routes `/api/` traffic directly to the backend (bypassing Kong)
   - And NGINX routes `/auth/` traffic directly to Keycloak (bypassing Kong)
   - And the backend remains fully functional -- all token validation, auth middleware, and header injection work standalone

3. **Backend Fully Functional Without Kong (NFR8)**
   - Given the backend is running without Kong in the deployment
   - When an authenticated request reaches the backend directly
   - Then the backend's `keycloak-auth-middleware.js` validates the Keycloak JWT via JWKS independently
   - And JIT provisioning, downstream header injection (`X-User-Id`, `X-User-Roles`, `X-Issuer`) all work identically
   - And no Kong-specific behavior is expected or required by the backend

4. **TLS Between All Components When Kong Deployed (NFR2)**
   - Given Kong is deployed
   - When traffic flows between NGINX, Kong, backend, and Keycloak
   - Then all communication uses TLS 1.2+ (NGINX terminates TLS; internal Docker traffic is HTTP per current architecture)
   - Note: Internal Docker network traffic between containers is HTTP (within the overlay network). TLS is enforced at the NGINX edge (ports 80/443). This is the existing architecture and does not change.

5. **Single `docker-compose.yaml` with Environment Toggle (FR9)**
   - Given the project maintains a single `docker-compose.yaml` (Swarm-compatible)
   - When `DEPLOY_KONG` env var is set to `0` in `.env`
   - Then all Kong-related services have `replicas: 0` or are otherwise excluded
   - And when `DEPLOY_KONG` is `1` (or unset), Kong services deploy normally
   - And the `env` template documents the `DEPLOY_KONG` variable

6. **NGINX Adapts to Kong Presence (NFR8)**
   - Given NGINX is always deployed (it is the TLS termination and public entry point)
   - When Kong is NOT deployed (`DEPLOY_KONG=0`)
   - Then the `KONG_PROXY_HOST` environment variable points to `backend:3000` (or NGINX is configured to proxy directly)
   - And NGINX `/api/` location proxies directly to the backend
   - And NGINX `/auth/` location proxies directly to Keycloak (`keycloak:8080`)
   - And all existing security headers, CORS, and CSP configurations are preserved

## Tasks / Subtasks

- [ ] Task 1: Add `DEPLOY_KONG` environment variable to `env` template (AC: #5)
  - [ ] Add `DEPLOY_KONG` variable in Section 3b (Deployment Options) of `env` template
  - [ ] Document that `DEPLOY_KONG=1` (default) includes Kong API gateway
  - [ ] Document that `DEPLOY_KONG=0` skips Kong services entirely
  - [ ] Document that `DEPLOY_OPEA=0` already follows the same pattern as precedent

- [ ] Task 2: Update `docker-compose.yaml` Kong services with `DEPLOY_KONG` toggle (AC: #1, #2, #5)
  - [ ] Add `replicas: ${DEPLOY_KONG:-1}` to `kong` service deploy section
  - [ ] Add `replicas: ${DEPLOY_KONG:-1}` to `kong-migrations` service deploy section
  - [ ] Add `replicas: ${DEPLOY_KONG:-1}` to `kong-config` service deploy section
  - [ ] Verify that `postgres` and `postgres-init` services are NOT toggled by `DEPLOY_KONG` (they are shared with Keycloak)
  - [ ] Verify `nginx` service is NOT toggled by `DEPLOY_KONG` (it is always required as TLS termination)

- [ ] Task 3: Update NGINX to support direct proxying when Kong is absent (AC: #6)
  - [ ] Add a new `BACKEND_PROXY_HOST` env var in docker-compose.yaml nginx environment section, defaulting to `kong` (preserves current behavior)
  - [ ] Update `api-gateway-solution/nginx/entrypoint.sh` to set `BACKEND_PROXY_HOST` default
  - [ ] When `DEPLOY_KONG=0`, set `BACKEND_PROXY_HOST=backend` and add a new `KEYCLOAK_PROXY_HOST` env var set to `keycloak`
  - [ ] Update `default.conf.template` to use `BACKEND_PROXY_HOST` for `/api/` location proxy_pass
  - [ ] Update `default.conf.template` to use `KEYCLOAK_PROXY_HOST` for `/auth/` location proxy_pass
  - [ ] Ensure the rendered nginx config works with both Kong (proxy to `kong:8000`) and direct (proxy to `backend:3000`)
  - [ ] Rebuild the `genie-ai-nginx` Docker image with updated template and entrypoint

- [ ] Task 4: Update NGINX CORS and proxy headers for direct backend mode (AC: #6)
  - [ ] When proxying directly to backend (no Kong), ensure CORS headers remain consistent
  - [ ] Verify that `X-Forwarded-Proto`, `X-Forwarded-For`, `Host` headers are set correctly in both modes
  - [ ] When proxying directly to Keycloak (no Kong), ensure `X-Forwarded-*` headers and Keycloak proxy headers (`xforwarded`) still work
  - [ ] Test that the `/auth/` location correctly strips/proxies the path prefix in both modes

- [ ] Task 5: Validate docker-compose config with both modes (AC: #1, #2, #5)
  - [ ] Run `set -a && source .env && set +a && docker compose config` with `DEPLOY_KONG=1` (default) -- verify no errors
  - [ ] Run `set -a && source .env && set +a && docker compose config` with `DEPLOY_KONG=0` -- verify no errors
  - [ ] Verify that with `DEPLOY_KONG=0`, Kong services still appear in config but with `replicas: 0`
  - [ ] Verify that with `DEPLOY_KONG=0`, all non-Kong services are unaffected

- [ ] Task 6: Verify backend autonomy without Kong (AC: #3)
  - [ ] Confirm that `keycloak-auth-middleware.js` validates tokens independently via JWKS (already implemented in Story 1.3/2.1)
  - [ ] Confirm that `keycloak-auth-service.js` performs OIDC discovery and JWKS caching without Kong dependency (already implemented)
  - [ ] Confirm that downstream headers (`X-User-Id`, `X-User-Roles`, `X-Issier`) are injected by backend middleware (already implemented in Story 2.3)
  - [ ] No code changes needed in backend -- document this as a verification task

- [ ] Task 7: Update deployment documentation (AC: #1, #2, #5)
  - [ ] Update `CLAUDE.md` Docker Deployment section to document `DEPLOY_KONG` variable
  - [ ] Document the two deployment modes and their behavior
  - [ ] Document that `DEPLOY_KONG=0` removes Kong but keeps NGINX as TLS termination
  - [ ] Document that backend auth is fully independent of Kong (defense-in-depth, not a dependency)

- [ ] Task 8: Run existing test suite to verify no regressions (AC: #3)
  - [ ] Run backend tests: `cd components/gov-chat-backend && npx jest --verbose`
  - [ ] Run frontend tests: `cd components/gov-chat-frontend && npx jest`
  - [ ] Verify all existing tests pass -- this story should produce minimal code changes (infrastructure only)

## Dev Notes

### Architecture Context

This story implements **FR9** ("IT administrator can deploy GENIE.AI with Kong API gateway or without Kong") and validates **NFR8** ("Backend remains operational when Kong is unavailable").

The architecture uses **token passthrough** -- the backend validates Keycloak JWTs independently via JWKS. Kong is an **additional** validation layer, not a dependency. This means removing Kong from the deployment has zero impact on the backend's authentication capability.

**Key architectural constraint from architecture.md:**
> "Kong optional: Two Docker Compose configurations needed -- system must behave identically with and without Kong. Header names and formats injected by Kong vs Backend must be consistent to avoid confusing downstream services"

### Current Architecture Analysis

**Traffic flow WITH Kong (current):**
```
Browser -> NGINX (TLS) -> Kong (8000) -> Backend (3000)
Browser -> NGINX (TLS) -> Kong (8000) -> Keycloak (8080)
```

**Traffic flow WITHOUT Kong (target):**
```
Browser -> NGINX (TLS) -> Backend (3000)
Browser -> NGINX (TLS) -> Keycloak (8080)
```

**NGINX is always present** -- it handles TLS termination, CORS, CSP, and acts as the single public entry point (ports 80/443). It must remain in both deployment modes.

### Implementation Approach: Single Compose File + Env Toggle

The project already uses the `replicas: ${DEPLOY_OPEA:-1}` pattern for toggling OPEA services. This story follows the same proven pattern:

```yaml
# docker-compose.yaml
kong:
  # ... existing config ...
  deploy:
    replicas: ${DEPLOY_KONG:-1}  # 1 = deployed (default), 0 = skipped

kong-migrations:
  # ... existing config ...
  deploy:
    replicas: ${DEPLOY_KONG:-1}

kong-config:
  # ... existing config ...
  deploy:
    replicas: ${DEPLOY_KONG:-1}
```

**Why NOT separate compose files?** The epics originally mentioned "two Docker Compose configurations" but the single-file approach with `replicas` toggle is:
- Simpler to maintain (one source of truth)
- Consistent with the existing `DEPLOY_OPEA` pattern
- Swarm-compatible (`docker stack deploy` works with a single file)
- No risk of compose file drift

**Postgres stays regardless of Kong** -- it is shared between Kong and Keycloak. When `DEPLOY_KONG=0`, postgres still runs for Keycloak's database.

### NGINX Adaptation Strategy

NGINX currently proxies everything through Kong:
- `/api/` -> `http://kong:8000/api/`
- `/auth/` -> `http://kong:8000/auth/`

When Kong is absent, NGINX must proxy directly:
- `/api/` -> `http://backend:3000/api/`
- `/auth/` -> `http://keycloak:8080/auth/`

**Implementation:** Use environment variables on the nginx service to control the upstream target:
- `BACKEND_PROXY_HOST` (default: `kong` when Kong is present, `backend` when absent)
- `KEYCLOAK_PROXY_HOST` (default: `kong` when Kong is present, `keycloak` when absent)
- `BACKEND_PROXY_PORT` (default: `8000` when Kong, `3000` when direct)

The NGINX `default.conf.template` already uses `envsubst` for variable substitution. We add these new variables to the template and entrypoint.

**Port difference:** Kong listens on port 8000, backend on port 3000, Keycloak on port 8080. The template must handle this port difference.

### Critical Considerations

1. **Kong CORS conflict:** When Kong is deployed, it has CORS plugins that conflict with NGINX CORS headers. The current architecture documents NGINX as the "single authoritative CORS layer" -- Kong CORS plugins should be disabled. When Kong is absent, NGINX CORS handling is unchanged.

2. **Kong path stripping:** The Kong route for `/auth` has `strip_path: true` (removes `/auth` prefix before forwarding to Keycloak). When proxying directly from NGINX to Keycloak, the `/auth/` prefix must be handled differently -- NGINX should proxy `/auth/` to `http://keycloak:8080/` (stripping the prefix). The current `proxy_pass http://$kong_addr` with a variable does NOT perform path substitution, so Kong receives the full `/auth/` path and strips it. When going direct, NGINX needs to strip `/auth` or Keycloak needs to be configured with the `/auth` context root.

3. **Kong config service:** The `kong-config` one-shot service applies Kong routes/services/plugins after Kong starts. When `DEPLOY_KONG=0`, it has `replicas: 0` so it never runs.

4. **Kong migrations service:** The `kong-migrations` one-shot service runs Kong DB migrations. When `DEPLOY_KONG=0`, it has `replicas: 0`. The postgres database for Kong (`kong` database) will not be initialized, but that is fine since Kong is not running.

5. **Backend is fully autonomous:** The backend's `keycloak-auth-middleware.js` and `keycloak-auth-service.js` validate tokens independently via JWKS. No code changes are needed in the backend for this story. This was verified in Stories 1.3, 1.9, 2.1.

### Worktree Assignment

This story will be implemented in a worktree called `epic2-infra`.

### Project Structure Notes

- `docker-compose.yaml` -- single Swarm-compatible compose file at project root (modified)
- `env` -- environment template at project root (modified)
- `api-gateway-solution/nginx/conf/default.conf.template` -- NGINX config template (modified)
- `api-gateway-solution/nginx/entrypoint.sh` -- NGINX entrypoint (modified)
- `api-gateway-solution/nginx/Dockerfile` -- NGINX Docker image (may need rebuild)
- `api-gateway-solution/new-config/kong_config.json` -- Kong configuration (unchanged, only used when Kong is deployed)
- No backend code changes needed (backend auth is Kong-independent)
- No frontend code changes needed

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] -- Story requirements and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Technical Constraints] -- "Kong optional: Two Docker Compose configurations needed"
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision Impact Analysis] -- Implementation sequence item 7: "Kong JWT plugin configuration (optional deployment)"
- [Source: _bmad-output/planning-artifacts/architecture.md#Service Boundary] -- "OPEA receives X-User-Id header only -- never raw tokens. Kong is optional. Backend is autonomous."
- [Source: docker-compose.yaml] -- Current single compose file with all services
- [Source: api-gateway-solution/nginx/conf/default.conf.template] -- NGINX config with Kong proxy_pass
- [Source: api-gateway-solution/nginx/entrypoint.sh] -- NGINX envsubst rendering
- [Source: api-gateway-solution/new-config/kong_config.json] -- Kong routes, services, plugins config
- [Source: env#Section 3b] -- DEPLOY_OPEA toggle pattern (precedent for DEPLOY_KONG)
- [Source: _bmad-output/project-context.md#Docker] -- Docker deployment conventions

### Existing Patterns to Follow

- `DEPLOY_OPEA` toggle: `replicas: ${DEPLOY_OPEA:-1}` in docker-compose.yaml
- NGINX envsubst: `entrypoint.sh` renders `default.conf.template` with environment variables
- NGINX lazy DNS: `resolver 127.0.0.11 valid=10s` with variable-based `proxy_pass`
- Docker Swarm: all services use `deploy` section with `placement.constraints` and `restart_policy`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
