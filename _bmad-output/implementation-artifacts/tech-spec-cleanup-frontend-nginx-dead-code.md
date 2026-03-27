---
title: 'Clean Up Frontend Nginx — Dead Code Removal and Architecture Review'
slug: 'cleanup-frontend-nginx-dead-code'
created: '2026-03-27'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - Docker / Docker Compose
  - NGINX (alpine — frontend container + outer API gateway)
  - Vue 3 / Vue Router 4 (createWebHistory mode)
files_to_modify:
  - components/gov-chat-frontend/nginx.conf
  - components/gov-chat-frontend/docker-entrypoint.sh
  - components/gov-chat-frontend/Dockerfile
  - docker-compose.yaml (root)
  - _bmad-output/implementation-artifacts/tech-spec-fix-spa-routing-frontend-404.md
  - _bmad-output/implementation-artifacts/tech-spec-cloud-native-api-gateway.md
code_patterns:
  - Multi-stage Docker build (node build + nginx:alpine production)
  - envsubst for nginx config templating (NGINX_ prefix to avoid collision with built-in vars)
  - docker-entrypoint.sh generates runtime config.js then exec "$@"
test_patterns:
  - No existing tests reference PROXY_TARGET, NGINX_PROXY_TARGET, or frontend nginx proxy
  - Manual verification via curl healthcheck + nginx -t in both compose modes
---

# Tech-Spec: Clean Up Frontend Nginx — Dead Code Removal and Architecture Review

**Created:** 2026-03-27

## Overview

### Problem Statement

The frontend container's nginx configuration contains dead code inherited from the pre-API-gateway architecture:
- **F7**: The `location /api/` proxy block in `components/gov-chat-frontend/nginx.conf` is never reached in either deployment mode (prod or dev).
- **F11**: The `PROXY_TARGET` environment variable in root `docker-compose.yaml` and its mapping in `docker-entrypoint.sh` have no effect since the proxy block is dead.
- **F15** (adversarial review): The server-level `add_header` directives (lines 17-19) in `nginx.conf` are never applied because every request matches a location block that redefines these headers. nginx `add_header` in a child context replaces (not inherits) the parent context's headers.

Additionally, the system has TWO nginx instances (frontend nginx + outer nginx). Architecture review confirms both are justified and should be retained (see Technical Decisions).

### Solution

1. Remove all dead code from frontend nginx: the `/api/` proxy block, the server-level `add_header` directives, and the associated comment.
2. Remove `PROXY_TARGET` env var and all associated wiring (entrypoint mapping, Dockerfile envsubst filter).
3. Architecture decision: **retain both nginx instances** — they serve distinct purposes (static file serving vs TLS termination/routing) and the separation is K8s-aligned.

### Scope

**In Scope:**
- Remove F7 dead code: `/api/` location block from `components/gov-chat-frontend/nginx.conf`
- Remove F15 dead code: server-level `add_header` directives (lines 17-19) and comment (line 17) from `nginx.conf`
- Remove F11 dead code: `PROXY_TARGET` env var from `docker-compose.yaml`, `NGINX_PROXY_TARGET` mapping from `docker-entrypoint.sh`, `NGINX_PROXY_TARGET` from `envsubst` filter in `Dockerfile`
- Update stale comment in `docker-entrypoint.sh` (lines 25-27) to reflect single-variable mapping
- Add deprecation notes to historical specs (`tech-spec-fix-spa-routing-frontend-404.md`, `tech-spec-cloud-native-api-gateway.md`)
- Document architecture decision: retain both nginx instances with rationale

**Out of Scope:**
- Kong configuration
- Backend changes
- User-facing functional behavior
- Mobile app (Flutter)

## Context for Development

### Codebase Patterns

- Frontend uses multi-stage Docker build (node build stage + nginx:alpine production stage)
- `docker-entrypoint.sh` generates runtime `config.js` for API URL injection, then `exec "$@"` to launch CMD
- Root docker-compose uses outer nginx as TLS termination + CORS authority + routing to Kong/frontend
- Components docker-compose (dev mode) exposes frontend:8090 directly, no outer nginx, no Kong
- Project already has two completed specs relevant to this work:
  - SPA routing fix: replaced `http-server` with nginx in frontend container
  - Cloud-native API gateway: added outer nginx + Kong as routing layer

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `components/gov-chat-frontend/nginx.conf` | Frontend nginx config — contains dead `/api/` proxy block and dead server-level headers |
| `components/gov-chat-frontend/docker-entrypoint.sh` | Maps `PROXY_TARGET` → `NGINX_PROXY_TARGET`, generates config.js |
| `components/gov-chat-frontend/Dockerfile` | `envsubst` filter includes `NGINX_PROXY_TARGET` in CMD |
| `docker-compose.yaml` (root) | Sets `PROXY_TARGET=http://kong:8000`, frontend port 8090 internal only |
| `components/docker-compose.yaml` | Dev mode — no `PROXY_TARGET`, no outer nginx |
| `api-gateway-solution/nginx/conf/default.conf.template` | Outer nginx config — routes `/api/` to Kong, `/*` to frontend |
| `api-gateway-solution/nginx/entrypoint.sh` | Outer nginx entrypoint — SSL cert management, envsubst |
| `_bmad-output/implementation-artifacts/tech-spec-fix-spa-routing-frontend-404.md` | History: why frontend nginx was introduced |
| `_bmad-output/implementation-artifacts/tech-spec-cloud-native-api-gateway.md` | History: why outer nginx was introduced |

### Technical Decisions

1. **Retain both nginx instances** — The frontend nginx (static files + SPA fallback) and outer nginx (TLS termination, CORS, routing) serve distinct purposes. Merging them would couple the outer nginx to the frontend container's filesystem, breaking service separation. The current pattern is K8s-aligned (ingress controller → static-serving pod).

2. **Remove `/api/` proxy from frontend nginx** — This proxy was designed for a simpler architecture without outer nginx. Since outer nginx now routes `/api/` directly to Kong, the frontend proxy is dead code in both deployment modes.

3. **Remove `PROXY_TARGET` entirely** — Since the `/api/` proxy block is removed, the `PROXY_TARGET` env var and its `NGINX_PROXY_TARGET` mapping have no purpose.

4. **Remove server-level `add_header` directives** — In nginx, `add_header` in a location block replaces (not inherits) the server context's headers. After removing the `/api/` block, every request matches a location block that defines its own security headers. The server-level headers (lines 17-19) and their comment (line 17) are never applied.

## Implementation Plan

### Tasks

- [x] **Task 1: Remove `/api/` proxy block and dead server-level headers from frontend nginx**
  - File: `components/gov-chat-frontend/nginx.conf`
  - Action: Delete lines 17-38:
    - Lines 17-19: server-level `add_header` directives and comment (dead — every request matches a location block)
    - Lines 29-38: `location /api/ { ... }` block and comment (dead — never reached in any deployment mode)
  - Notes: Remaining location blocks (static assets, `/health`, SPA fallback `/`) each define their own security headers. The `location /` catch-all ensures every request matches a block.

- [x] **Task 2: Remove `NGINX_PROXY_TARGET` from Dockerfile envsubst filter**
  - File: `components/gov-chat-frontend/Dockerfile`
  - Action: Change CMD from:
    ```
    CMD ["sh", "-c", "envsubst '$NGINX_PROXY_TARGET $NGINX_PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
    ```
    to:
    ```
    CMD ["sh", "-c", "envsubst '$NGINX_PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
    ```
  - Notes: `NGINX_PORT` must remain — it's used by `listen ${NGINX_PORT}` in the config. Task 1 modifies `nginx.conf` which triggers a Docker rebuild, so the CMD change takes effect automatically.

- [x] **Task 3: Remove `NGINX_PROXY_TARGET` mapping and update comment from entrypoint**
  - File: `components/gov-chat-frontend/docker-entrypoint.sh`
  - Action:
    1. Delete line 28:
       ```
       export NGINX_PROXY_TARGET=${PROXY_TARGET:-http://127.0.0.1:9999}
       ```
    2. Update the comment block (lines 25-27) to reflect single-variable mapping. Change:
       ```
       # Map user-facing env vars to nginx-safe names (avoid collision with nginx built-in vars)
       # IMPORTANT: Any new template variable in nginx.conf must also be added to the
       # envsubst filter list in CMD (Dockerfile) to avoid nginx built-in var collision.
       ```
       to:
       ```
       # Map user-facing env var to nginx-safe name (avoid collision with nginx built-in vars)
       # IMPORTANT: Any new template variable in nginx.conf must also be added to the
       # envsubst filter list in CMD (Dockerfile) to avoid nginx built-in var collision.
       ```
  - Notes: Keep `export NGINX_PORT=${PORT:-8090}` — still used by nginx.conf.

- [x] **Task 4: Remove `PROXY_TARGET` from root docker-compose**
  - File: `docker-compose.yaml`
  - Action: Delete line 133:
    ```
    - PROXY_TARGET=http://kong:8000
    ```
  - Notes: No other service references `PROXY_TARGET`. The frontend service environment section retains `PORT`, `VUE_APP_API_URL`, `VUE_PROXY_HOST`, `VUE_APP_CSP_CONNECT_SRC`.

- [x] **Task 5: Add deprecation notes to historical specs**
  - File: `_bmad-output/implementation-artifacts/tech-spec-fix-spa-routing-frontend-404.md`
  - Action: Insert after the `## Review Notes` heading (line 228), as the first bullet point:
    ```
    - Post-implementation note (2026-03-27): The `PROXY_TARGET` env var and frontend nginx `/api/` proxy block described in this spec were removed as dead code. See `tech-spec-cleanup-frontend-nginx-dead-code.md`.
    ```
  - File: `_bmad-output/implementation-artifacts/tech-spec-cloud-native-api-gateway.md`
  - Action: Append to the F7/F11 bullet (line 341), after the existing text:
    ```
    . Resolved in `tech-spec-cleanup-frontend-nginx-dead-code.md`.
    ```
  - Notes: Historical specs are preserved as-is (audit trail). Only a forward-reference note is added to signal that the described artifacts no longer exist.

### Acceptance Criteria

- [ ] **AC 1:** Given the frontend container is built and running, when `nginx.conf` is inspected inside the container, then it contains NO `location /api/` block, NO `${NGINX_PROXY_TARGET}` reference, and NO server-level `add_header` directives.
- [ ] **AC 2:** Given the frontend container is running, when `docker compose exec frontend nginx -t` is executed, then it returns "test is successful" (syntax valid).
- [ ] **AC 3:** Given the root docker-compose is running (prod mode), when the frontend loads through outer nginx, then the Vue SPA loads correctly and static assets are served with proper MIME types.
- [ ] **AC 4:** Given the root docker-compose is running (prod mode), when a user navigates directly to a SPA route (e.g. `/login`), then the Vue login page loads (SPA fallback works).
- [ ] **AC 5:** Given the components docker-compose is running (dev mode), when the frontend loads at `http://localhost:8090/`, then the Vue SPA loads correctly.
- [ ] **AC 6:** Given the components docker-compose is running (dev mode), when `curl http://localhost:8090/health` is called, then it returns `{"status":"ok"}` with status 200.
- [ ] **AC 7:** Given the root docker-compose is running (prod mode), when a browser makes an API call, then the request routes through outer nginx → Kong → backend (no frontend nginx involvement in API path).
- [ ] **AC 8:** Given source code and configuration files are searched for `PROXY_TARGET` or `NGINX_PROXY_TARGET`, then no matches are found (historical specs may contain annotated references).

## Additional Context

### Dependencies

- No new dependencies — this is a pure cleanup task
- `nginx:alpine` image remains unchanged
- No changes to `components/docker-compose.yaml` (dev mode) — it never had `PROXY_TARGET`
- Task 2 depends on Task 1 (nginx.conf change triggers Docker rebuild)

### Testing Strategy

Manual verification in both compose modes:

**Dev mode (components/docker-compose.yaml):**
1. `docker compose -f components/docker-compose.yaml --env-file ../.env up -d --build frontend`
2. `docker compose exec frontend nginx -t` — must pass syntax check
3. `curl http://localhost:8090/health` — must return `{"status":"ok"}`
4. Open `http://localhost:8090/login` — must load login page (SPA fallback)
5. `docker compose exec frontend cat /etc/nginx/nginx.conf` — must NOT contain `/api/`, `NGINX_PROXY_TARGET`, or server-level `add_header`

**Prod mode (root docker-compose.yaml):**
1. `docker compose --env-file .env up -d --build frontend`
2. `docker compose exec frontend nginx -t` — must pass syntax check
3. Verify frontend loads through outer nginx (port 80/443)
4. Verify API calls route through outer nginx → Kong (not frontend nginx)

### Notes

- F7 and F11 were identified during the cloud-native API gateway adversarial review (commit `402dd1f`, branch `deployment-stabilization`) and skipped as "dead code"
- F15 (server-level `add_header` dead code) was identified during this spec's adversarial review — the server-level headers are never applied because every request matches a location block that redefines them
- The `/api/` proxy was originally designed for an architecture where the frontend nginx was the single entrypoint. The outer nginx (added by the cloud-native API gateway spec) made it obsolete by routing `/api/` directly to Kong.
- Architecture decision: both nginx instances are retained. The frontend nginx serves static files + SPA fallback. The outer nginx handles TLS termination, CORS, and routing. This separation is K8s-aligned and maintains clean service boundaries.

## Review Notes

- Adversarial review completed
- Findings: 14 total, 3 fixed (F8: entrypoint comment improved, F13: deprecation note moved to end, F4: tech-spec to be included in commit), 11 skipped (noise/out-of-scope/pre-existing)
- Resolution approach: auto-fix
