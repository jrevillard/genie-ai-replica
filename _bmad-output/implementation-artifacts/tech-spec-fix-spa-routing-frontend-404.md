---
title: 'Fix SPA Routing — Frontend 404 on Direct Navigation'
slug: 'fix-spa-routing-frontend-404'
created: '2026-03-27'
status: 'completed'
stepsCompleted: [1, 2, 3, 4, 5, 6]
tech_stack:
  - Docker / Docker Compose
  - NGINX (alpine, in frontend container)
  - Vue 3 / Vue Router 4 (createWebHistory mode)
files_to_modify:
  - components/gov-chat-frontend/Dockerfile
  - components/gov-chat-frontend/docker-entrypoint.sh
  - docker-compose.yaml (root)
  - components/docker-compose.yaml
files_to_create:
  - components/gov-chat-frontend/nginx.conf
code_patterns:
  - Multi-stage Docker build (build + production stages)
  - Runtime config.js generation via docker-entrypoint.sh
  - Environment variable driven configuration (nginx envsubst)
  - Project already uses nginx for API gateway (existing expertise)
test_patterns: []
---

# Tech-Spec: Fix SPA Routing — Frontend 404 on Direct Navigation

**Created:** 2026-03-27

## Overview

### Problem Statement

The frontend container uses `http-server` to serve the Vue 3 SPA. Vue Router is configured with `createWebHistory()` (HTML5 history mode), which requires the server to return `index.html` for any route that doesn't match a static asset. `http-server` has no SPA fallback — it returns 404 for unknown paths. This breaks direct navigation to routes like `/login`, `/registration-success?email=...`, and any bookmarked or linked route.

### Solution

Replace `http-server` with **nginx** in the frontend container. A single `nginx.conf` (~20 lines) provides SPA fallback via `try_files`, optional API proxying via `proxy_pass`, and all the security/operational features (MIME types, path traversal prevention, graceful shutdown, logging, gzip, cache headers) that would require 100+ lines of custom Node.js code.

### Scope

**In Scope:**
- Create `nginx.conf` — SPA fallback + optional API proxy
- Update `Dockerfile` — replace `http-server` with nginx
- Update `docker-compose.yaml` (root) — replace `HTTP_SERVER_EXTRA_ARGS` with `PROXY_TARGET`
- Update `components/docker-compose.yaml` — no proxy needed (dev mode)

**Out of Scope:**
- CSP headers (managed by outer NGINX in production)
- Vue Router mode change (staying on `createWebHistory`)
- Mobile app (Flutter)

## Context for Development

### Codebase Patterns

- Frontend uses multi-stage Docker build (build stage + production stage)
- `docker-entrypoint.sh` generates a runtime `config.js` for API URL injection — runs BEFORE CMD, must remain untouched
- Root compose sets `HTTP_SERVER_EXTRA_ARGS=--proxy http://kong:8010?` — replaced by `PROXY_TARGET`
- Components compose does NOT set proxy args — `PROXY_TARGET` simply won't be set
- Vue Router uses `createWebHistory()` — requires server-side SPA fallback
- Project already uses nginx for API gateway (`api-gateway-solution/`) — existing team expertise

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `components/gov-chat-frontend/Dockerfile` | Current multi-stage build, uses http-server |
| `components/gov-chat-frontend/docker-entrypoint.sh` | Runtime config.js generation, exec "$@" |
| `components/gov-chat-frontend/src/router.js` | Vue Router config, createWebHistory mode |
| `docker-compose.yaml` (root) | Frontend service with HTTP_SERVER_EXTRA_ARGS |
| `components/docker-compose.yaml` | Dev compose, no proxy args |
| `api-gateway-solution/nginx/conf/default.conf.template` | Existing nginx config (reference for patterns) |

### Technical Decisions

1. **nginx over custom Node.js server** — A custom `server.js` started at ~30 lines but adversarial review revealed edge cases (gzip handling, HTTPS proxy, timeouts, graceful shutdown, MIME maintenance, cache headers) that would push it to 100+ lines. nginx handles all of this natively in a ~20-line config. The project already uses nginx for the API gateway, so no new technology is introduced.

2. **`PROXY_TARGET` env var with unique prefix** — Replaces `HTTP_SERVER_EXTRA_ARGS=--proxy http://kong:8010?`. The nginx.conf template uses `${NGINX_PROXY_TARGET}` (not `${PROXY_TARGET}`) to avoid collision with nginx built-in variables (`$host`, `$uri`, etc.) during `envsubst`. The entrypoint maps `PROXY_TARGET` → `NGINX_PROXY_TARGET`. When unset (dev mode), a dummy value is used.

3. **`envsubst` for config templating** — nginx's native `envsubst` (in `nginx:alpine`) substitutes only `NGINX_PROXY_TARGET` and `NGINX_PORT`, leaving nginx's own `$variables` untouched.

4. **K8s-ready by default** — nginx is the standard static server for Kubernetes. No migration needed.

## Implementation Plan

### Tasks

- [x] **Task 1: Create `nginx.conf`**
  - File: `components/gov-chat-frontend/nginx.conf` (NEW)
  - Action: Create a minimal nginx config template:
    ```nginx
    worker_processes 1;
    error_log /dev/stderr warn;
    pid /tmp/nginx.pid;

    events { worker_connections 256; }

    http {
      include /etc/nginx/mime.types;
      default_type application/octet-stream;
      access_log /dev/stderr;
      sendfile on;

      server {
        listen ${NGINX_PORT:-8090};

        # Security headers
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;

        # Cache: immutable for hashed assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|webmanifest|map)$ {
          root /app/dist;
          add_header Cache-Control "public, max-age=31536000, immutable";
          add_header X-Content-Type-Options nosniff always;
          add_header X-Frame-Options DENY always;
        }

        # API proxy
        location /api/ {
          proxy_pass ${NGINX_PROXY_TARGET};
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Health endpoint
        location = /health {
          default_type application/json;
          return 200 '{"status":"ok"}';
        }

        # SPA fallback
        location / {
          root /app/dist;
          try_files $uri $uri/ /index.html;
        }
      }
    }
    ```
  - Notes:
    - Template variables use `NGINX_` prefix (`${NGINX_PROXY_TARGET}`, `${NGINX_PORT}`) to avoid collision with nginx built-in variables (`$host`, `$uri`, `$scheme`, etc.) during `envsubst`
    - nginx built-in variables (`$host`, `$remote_addr`, `$proxy_add_x_forwarded_for`, `$scheme`) are NOT wrapped in braces — they are nginx runtime variables, not envsubst targets

- [x] **Task 2: Update Dockerfile**
  - File: `components/gov-chat-frontend/Dockerfile`
  - Action:
    1. Change production base image from `node:22.14.0-alpine` to `nginx:alpine`
    2. Remove `RUN npm install -g http-server`
    3. Add `COPY nginx.conf /etc/nginx/nginx.conf.template`
    4. Change CMD to: `CMD ["sh", "-c", "envsubst '$NGINX_PROXY_TARGET $NGINX_PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]`
  - Notes:
    - The build stage stays `node:22.14.0-alpine` (Vue CLI needs Node.js)
    - The production stage no longer needs Node.js — nginx serves static files only
    - `docker-entrypoint.sh` still runs first (generates `config.js`), then CMD starts nginx

- [x] **Task 3: Update `docker-entrypoint.sh`**
  - File: `components/gov-chat-frontend/docker-entrypoint.sh`
  - Action:
    1. Add before `exec "$@"`:
       ```sh
       export NGINX_PROXY_TARGET=${PROXY_TARGET:-http://127.0.0.1:9999}
       export NGINX_PORT=${PORT:-8090}
       chmod -R a+r /app/dist
       ```
    2. The `chmod` ensures the nginx worker (runs as non-root) can read `config.js` and all static files
  - Notes:
    - Maps user-facing `PROXY_TARGET` / `PORT` to nginx-safe `NGINX_PROXY_TARGET` / `NGINX_PORT`
    - The `/api/` proxy is always present. In dev mode, it points to a dummy that will fail — acceptable since the Vue app calls backend directly via `VUE_APP_API_URL`

- [x] **Task 4: Update root `docker-compose.yaml`**
  - File: `docker-compose.yaml` (root)
  - Action:
    1. Replace `HTTP_SERVER_EXTRA_ARGS=--proxy http://kong:8010?` with `PROXY_TARGET=http://kong:8010`
  - Notes:
    - The `?` suffix was an http-server flag (strip path) — not needed for nginx `proxy_pass` which preserves the full URL

- [x] **Task 5: Update `components/docker-compose.yaml`**
  - File: `components/docker-compose.yaml`
  - Action:
    1. No changes needed — `PROXY_TARGET` is not set, entrypoint defaults to dummy
  - Notes:
    - Verify `HTTP_SERVER_EXTRA_ARGS` is not present (it isn't)

### Acceptance Criteria

- [ ] **AC 1:** Given a user navigates directly to `http://localhost:8090/login`, when the frontend container is running, then the Vue login page loads correctly (200 OK, not 404).
- [ ] **AC 2:** Given a user clicks a registration verification link `http://localhost:8090/registration-success?email=...`, when the page loads, then the registration success view is displayed.
- [ ] **AC 3:** Given the root compose is running with `PROXY_TARGET=http://kong:8010`, when a request is made to `/api/*` on port 8090, then the request is proxied to Kong (connection succeeds).
- [ ] **AC 4:** Given the components compose is running (no PROXY_TARGET), when the frontend is accessed, then static assets load with correct MIME types.
- [ ] **AC 5:** Given a request to `/health`, when received, then a 200 response with `{"status":"ok"}` is returned.
- [ ] **AC 6:** Given `docker-entrypoint.sh` runs, when it completes, then `/app/dist/config.js` exists and nginx starts on port 8090.

## Additional Context

### Dependencies

- `nginx:alpine` Docker image (official, ~10MB)
- No Node.js runtime in production container (static files only)
- No changes to Vue Router configuration
- No changes to outer NGINX configuration (`api-gateway-solution/`)

### Testing Strategy

Manual verification in both compose modes:

**Components compose (dev mode):**
1. `docker compose -f components/docker-compose.yaml --env-file ../.env up -d --build frontend`
2. Open `http://localhost:8090/login` — should load login page
3. Open `http://localhost:8090/registration-success?email=test@test.com` — should load success page
4. `curl http://localhost:8090/health` — should return `{"status":"ok"}`

**Root compose (with Kong proxy):**
1. `docker compose --env-file .env up -d --build frontend`
2. Repeat all steps above
3. `curl http://localhost:8090/api/health` — should proxy to Kong

### Notes

- The bug existed on `main` too but was masked by the Kong → NGINX fallback chain (http-server proxied to Kong, Kong returned 404, NGINX intercepted and served index.html)
- nginx in the frontend container eliminates this fragile chain — SPA fallback is handled directly
- The project already uses nginx for the API gateway — no new technology introduced
- Production image is smaller (nginx:alpine ~10MB vs node:22-alpine ~130MB)
- K8s-ready by default — nginx is the standard for static serving in Kubernetes

## Review Notes

- Adversarial review completed
- Findings: 12 total, 7 fixed (F1, F4, F5, F7, F10, F11, F12), 5 skipped (noise/out-of-scope)
- Resolution approach: auto-fix
- Additional changes beyond spec: `.dockerignore` created, healthcheck added to both compose files, security headers repeated in all location blocks, source maps excluded from long cache, `client_max_body_size 50m` added
- Post-implementation note (2026-03-27): The `PROXY_TARGET` env var and frontend nginx `/api/` proxy block described in this spec were removed as dead code. See `tech-spec-cleanup-frontend-nginx-dead-code.md`.
