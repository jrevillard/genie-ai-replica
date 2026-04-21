# Story 1.1: Keycloak Container with Pre-configured Realm & OIDC Client

Status: review

## Story

As a DevOps engineer / IT administrator,
I want a custom Docker image that starts Keycloak with a pre-configured realm, OIDC client, and default admin user,
So that no manual Keycloak setup is required after deployment.

## Acceptance Criteria

1. **Given** the Keycloak Docker image is built and deployed via Docker Swarm
   **When** the container starts
   **Then** a realm (configurable via `KEYCLOAK_REALM`, default `genie`) exists with an OIDC client configured

2. **Given** the Keycloak Docker image is built and deployed via Docker Swarm
   **When** the container starts
   **Then** a default admin user exists with credentials from `KEYCLOAK_ADMIN_PASSWORD`

3. **Given** the Keycloak Docker image is built and deployed via Docker Swarm
   **When** the container starts
   **Then** the OIDC client has `Authorization Code Flow with PKCE` enabled (NFR1)

4. **Given** the Keycloak Docker image is built and deployed via Docker Swarm
   **When** the container starts
   **Then** the realm OIDC discovery endpoint `/.well-known/openid-configuration` is reachable via NGINX at `https://<domain>/auth/realms/genie/.well-known/openid-configuration`

5. **Given** the Keycloak Docker image is built and deployed via Docker Swarm
   **When** the container starts
   **Then** no bind mounts are used — all configuration is baked into the image (D6)

6. **Given** the Keycloak Docker image is built and deployed via Docker Swarm
   **When** the container starts
   **Then** all external communication uses TLS 1.2+ via NGINX termination; internal Docker network traffic is plain HTTP (NFR2)

7. **Given** the Keycloak Docker image is built and deployed via Docker Swarm
   **When** the container starts
   **Then** the `keycloak-config-cli` YAML configuration uses only Keycloak 26.x supported APIs — no deprecated admin resources (NFR23)

## Tasks / Subtasks

- [x] Create Keycloak realm configuration (AC: #1, #2, #3, #7)
  - [x] Create directory `config/keycloak/`
  - [x] Create `config/keycloak/genie-realm.yaml` with realm, OIDC client, roles, and default admin user
  - [x] Realm name configurable via `KC_REALM` env var (default `genie`)
  - [x] Client ID configurable via `KC_CLIENT_ID` env var (default `genie-app`)
  - [x] Client secret configurable via `KC_CLIENT_SECRET` env var (required)
  - [x] Standard flow enabled, direct access grants disabled, implicit flow disabled, PKCE enabled (S256)
  - [x] Valid redirect URIs configured (from `KC_VALID_REDIRECT_URIS` env var)
  - [x] Web origins configured for CORS (from `KC_WEB_ORIGINS` env var)
  - [x] Default admin user created with password from `KC_ADMIN_PASSWORD` env var
  - [x] Realm roles defined: `admin`, `user` (minimum viable set)
  - [x] Variable substitution via `$(env:VAR)` syntax (keycloak-config-cli native)

- [x] Create Keycloak Docker images (AC: #1, #5)
  - [x] Create `config/keycloak/Dockerfile` — base `quay.io/keycloak/keycloak:26.5.6`, production mode (`kc.sh start`)
  - [x] Create `config/keycloak/Dockerfile.config-cli` — base `adorsys/keycloak-config-cli:6.5.0-26`, bakes `genie-realm.yaml` into image
  - [x] No bind mounts — config baked into images, secrets via env vars

- [x] Add Keycloak services to Docker Compose (AC: #1, #2, #4, #5, #6)
  - [x] Add `keycloak` service — production mode, `KC_PROXY_HEADERS=xforwarded`, `KC_HTTP_ENABLED=true` for internal HTTP
  - [x] Add `keycloak-config` one-shot init service — applies `genie-realm.yaml` via config-cli after Keycloak is healthy
  - [x] Add `postgres-init` one-shot init service — creates dedicated `kong` and `keycloak` PostgreSQL users/databases
  - [x] Healthcheck: TCP probe on port 8080 (no password in healthcheck command)
  - [x] Network: `genieai_network` (overlay), placement on `gateway=true` nodes
  - [x] Ports: internal only (no host exposure — access via Kong/NGINX)

- [x] Configure Kong route for Keycloak (AC: #4)
  - [x] Add `keycloak` service in `kong_config.json` pointing to `keycloak:8080`
  - [x] Add `keycloak-route` with `paths: ["/auth"]`, `strip_path: true`, `preserve_host: true`

- [x] Configure NGINX reverse proxy for Keycloak (AC: #4, #6)
  - [x] Add `/auth/` location block proxying to Kong
  - [x] `X-Frame-Options: SAMEORIGIN` (Keycloak admin console needs iframes)
  - [x] `proxy_hide_header X-Frame-Options` and `proxy_hide_header Content-Security-Policy` to prevent upstream conflicts
  - [x] Fix dotfile regex to allow `.well-known` (OIDC discovery): `/\.(?!well-known)`

- [x] Add Keycloak variables to `env` template (AC: #1, #2)
  - [x] Add `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_DB_PASSWORD` as REQUIRED
  - [x] Add `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_VALID_REDIRECT_URIS`, `KEYCLOAK_WEB_ORIGINS` with defaults
  - [x] Add `KONG_DB_PASSWORD` for dedicated PostgreSQL user
  - [x] Document multi-user PostgreSQL architecture in Section 1

- [x] Update documentation
  - [x] Installation Guide: add KONG_DB_PASSWORD, KEYCLOAK_* secrets to table and sed commands
  - [x] Swarm setup guide: add new secrets, add build/tag/push steps for 3 new images
  - [x] API Gateway README: fix postgres references, network driver
  - [x] Regression plan: update service inventory and secrets table

- [x] Verify OIDC discovery endpoint (AC: #4)
  - [x] After Swarm deploy, verify `https://localhost/auth/realms/genie/.well-known/openid-configuration` returns valid JSON
  - [x] Verified `issuer`, `authorization_endpoint`, `token_endpoint` are present

## Dev Notes

### Architecture Decision: D6 — Keycloak Init via keycloak-config-cli

Custom Docker image approach with config baked in. No bind mounts. Secrets injected via env vars at runtime.

**Tool:** `adorsys/keycloak-config-cli:6.5.0-26` — the `-26` suffix indicates Keycloak 26.x compatibility. Earlier unversioned images (v6.4.0, v6.5.1-SNAPSHOT) produced HTTP 400 errors with Keycloak 26.0.0. Version 6.5.0-26 resolves this.

### Keycloak Image Version

`quay.io/keycloak/keycloak:26.5.6` — latest stable, includes 20+ CVE fixes over 26.0.0.

### keycloak-config-cli YAML Variable Substitution

Uses `$(env:VAR_NAME)` syntax natively in YAML. Variables are passed as environment variables to the `keycloak-config` service and resolved at runtime by config-cli.

### Keycloak Configuration

- Production mode (`kc.sh start`)
- `KC_HTTP_ENABLED=true` — NGINX handles TLS termination, Keycloak only needs HTTP internally
- `KC_PROXY_HEADERS=xforwarded` — trusts NGINX proxy headers
- `KC_HOSTNAME=https://<domain>/auth` — sets correct issuer URLs for OIDC
- Healthcheck: `bash -c '</dev/tcp/localhost/8080'` TCP probe (no curl/wget in minimal image)

### PostgreSQL Multi-User Architecture

Shared PostgreSQL instance (`postgres`) with dedicated users:
- Superuser `genieai` (POSTGRES_USER) — created by PostgreSQL init
- Dedicated user `kong` (KONG_DB_PASSWORD) — created by `postgres-init`
- Dedicated user `keycloak` (KEYCLOAK_DB_PASSWORD) — created by `postgres-init`

### Docker Swarm Patterns

- No `depends_on`, `build:`, `container_name` — Swarm compatible
- All images pre-built and pushed to `${SWARM_REGISTRY_URL:-localhost:5000}/`
- One-shot init services (`postgres-init`, `keycloak-config`) use `restart_policy: condition: on-failure`
- Placement constraints: `node.labels.gateway == true`

### Project Structure

```
config/keycloak/
├── Dockerfile              # Keycloak 26.5.6 production image
├── Dockerfile.config-cli   # keycloak-config-cli image with baked realm YAML
└── genie-realm.yaml        # Realm, client, roles, admin user config

config/postgres/
├── Dockerfile              # PostgreSQL init image
└── init-databases.sh       # Creates kong/keycloak users and databases
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `config/keycloak/Dockerfile` | CREATE | Keycloak 26.5.6 production image |
| `config/keycloak/Dockerfile.config-cli` | CREATE | keycloak-config-cli image with baked config |
| `config/keycloak/genie-realm.yaml` | CREATE | Realm, client, roles, admin user config |
| `config/postgres/Dockerfile` | CREATE | PostgreSQL init image |
| `config/postgres/init-databases.sh` | CREATE | Creates kong/keycloak users and databases |
| `docker-compose.yaml` | MODIFY | Add keycloak, keycloak-config, postgres-init services |
| `env` | MODIFY | Add KEYCLOAK_*, KONG_DB_PASSWORD variables |
| `api-gateway-solution/nginx/conf/default.conf.template` | MODIFY | Add /auth/ location, fix dotfile regex |
| `api-gateway-solution/new-config/kong_config.json` | MODIFY | Add keycloak service and route |
| `api-gateway-solution/new-config/restore-kong-config.sh` | MODIFY | Fix stale $service_name variable |
| `api-gateway-solution/README.md` | MODIFY | Fix postgres references, network driver |
| `docs/docker-swarm-setup.md` | MODIFY | Add new secrets, build/push steps |
| `GENIE.AI-Installation-Configuration-Guide.md` | MODIFY | Add secrets to table and sed commands |

### Files NOT Modified (by design)

- `components/docker-compose.yaml` — deleted during consolidation to single compose file
- `components/gov-chat-backend/` — backend changes in later stories
- `components/gov-chat-frontend/` — frontend changes in later stories

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D6] — Keycloak init via custom image
- [Source: _bmad-output/planning-artifacts/architecture.md#Integration Points] — Docker Compose setup
- [Source: _bmad-output/planning-artifacts/architecture.md#Technical Constraints] — Docker single-stage builds
- [Source: _bmad-output/planning-artifacts/prd.md#FR7] — Single Docker Compose deployment
- [Source: _bmad-output/planning-artifacts/prd.md#FR8] — Pre-configured realm, client, admin user
- [Source: _bmad-output/project-context.md#Docker] — Docker conventions
- [Source: _bmad-output/project-context.md#Environment & Config] — env/.env conventions
- [Source: .claude/rules/ENVIRONMENT.md] — Environment files convention

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (GLM-5-Turbo)

### Debug Log References

- keycloak-config-cli HTTP 400 with Keycloak 26.0.0 — resolved by using versioned image `6.5.0-26`
- NGINX duplicate X-Frame-Options headers — resolved by `proxy_hide_header X-Frame-Options` in /auth/ location
- Keycloak HTTPS refusal — resolved by adding `KC_HTTP_ENABLED=true`
- NGINX 404 for .well-known — resolved by negative lookahead regex `/\.(?!well-known)`

### Completion Notes List

1. **keycloak-config-cli version compatibility**: `adorsys/keycloak-config-cli:6.5.0-26` (tagged for Keycloak 26.x) resolved the HTTP 400 errors that occurred with unversioned images against Keycloak 26.0.0. Upgraded Keycloak to 26.5.6 for CVE fixes.

2. **Keycloak 26 minimal image has no curl/wget**: Health check uses `bash -c '</dev/tcp/localhost/8080'` TCP probe instead of HTTP health endpoint. Password is not exposed in process listing.

3. **Multi-user PostgreSQL architecture**: Added `postgres-init` one-shot service that creates dedicated `kong` and `keycloak` PostgreSQL users with separate passwords. Removed all `POSTGRES_PASSWORD` fallbacks from Kong and Keycloak services.

4. **AC #6 (TLS 1.2+)**: TLS termination handled by NGINX (TLSv1.2/TLSv1.3). Keycloak receives plain HTTP internally (`KC_HTTP_ENABLED=true`). Internal Docker network traffic does not need TLS.

5. **AC #5 (no bind mounts)**: Both `Dockerfile` and `Dockerfile.config-cli` bake configuration into images. Realm YAML is copied at build time. Secrets injected via environment variables at runtime.

6. **AC #7 (Keycloak 26.x APIs)**: `keycloak-config-cli:6.5.0-26` uses Keycloak 26.x Admin REST API endpoints only. No deprecated resources.

7. **NGINX /auth/ location**: Uses `X-Frame-Options: SAMEORIGIN` (not `DENY`) for Keycloak admin console iframe support. `proxy_hide_header` suppresses upstream `X-Frame-Options` and `Content-Security-Policy` to prevent duplicate/conflicting headers.

### File List

| File | Action | Description |
|------|--------|-------------|
| `config/keycloak/Dockerfile` | CREATED | Keycloak 26.5.6 production image |
| `config/keycloak/Dockerfile.config-cli` | CREATED | keycloak-config-cli image with baked realm YAML |
| `config/keycloak/genie-realm.yaml` | CREATED | Realm, client, roles, admin user config |
| `config/postgres/Dockerfile` | CREATED | PostgreSQL init image |
| `config/postgres/init-databases.sh` | CREATED | Creates kong/keycloak users and databases |
| `docker-compose.yaml` | MODIFIED | Added keycloak, keycloak-config, postgres-init services |
| `env` | MODIFIED | Added KONG_DB_PASSWORD, KEYCLOAK_* variables, multi-user docs |
| `api-gateway-solution/nginx/conf/default.conf.template` | MODIFIED | Added /auth/ location, fixed dotfile regex, SAMEORIGIN headers |
| `api-gateway-solution/new-config/kong_config.json` | MODIFIED | Added keycloak service and route |
| `api-gateway-solution/new-config/restore-kong-config.sh` | MODIFIED | Fixed stale $service_name variable |
| `api-gateway-solution/README.md` | MODIFIED | Fixed postgres references, network driver, DATA_DIR |
| `docs/docker-swarm-setup.md` | MODIFIED | Added new secrets, build/tag/push steps for new images |
| `GENIE.AI-Installation-Configuration-Guide.md` | MODIFIED | Added secrets to table and sed commands, fixed Kong variable table |
| `_bmad-output/implementation-artifacts/tech-spec-kong-cloud-native-init.md` | MODIFIED | Fixed postgres → kong-database reference |
| `_bmad-output/implementation-artifacts/tech-spec-deployment-regression-plan.md` | MODIFIED | Updated service inventory, secrets table, checklist |
