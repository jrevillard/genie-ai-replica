---
title: 'Cloud-Native API Gateway Configuration'
slug: 'cloud-native-api-gateway'
created: '2026-03-26'
status: 'completed'

stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - Nginx (reverse proxy, SSL termination, envsubst for template rendering)
  - Kong (API gateway, DB-backed with PostgreSQL)
  - Docker Compose
  - Bash (configuration scripts, Kong Admin API via curl + jq)
files_to_modify:
  - api-gateway-solution/nginx/conf/default.conf.template
  - api-gateway-solution/nginx/conf/security-headers.conf
  - api-gateway-solution/nginx/entrypoint.sh
  - api-gateway-solution/new-config/restore-kong-config.sh
  - docker-compose.yaml
  - env
files_to_delete:
  - api-gateway-solution/old-config/ (entire directory)
  - api-gateway-solution/kong-postgres-backups/ (entire directory)
  - api-gateway-solution/kong-backups/ (entire directory)
  - api-gateway-solution/new-config/kong_backups/ (entire directory)
  - api-gateway-solution/new-config/kong_config.json.old (hardcoded e2e-109-51)
  - api-gateway-solution/nginx/conf/default.conf (generated, no longer tracked)
  - api-gateway-solution/nginx/conf/default.conf.backup (stale)
  - api-gateway-solution/nginx/conf/default.conf-single-node (obsolete single-node variant)
files_unchanged:
  - api-gateway-solution/new-config/kong_config.json (hosts already correct: backend, document-repository)
  - api-gateway-solution/new-config/manage-kong-config.sh (interactive, uses host input -- acceptable)
  - api-gateway-solution/new-config/kong_rate-limit.sh (no hardcoded domains)
  - api-gateway-solution/scripts/configure-kong.sh (DELETED: superseded by entrypoint.sh, produced incorrect configs)
  - api-gateway-solution/pg_hba.conf (already well-structured)
code_patterns:
  - envsubst for nginx template rendering (currently host-side via configure-kong.sh, moving to container-side via entrypoint.sh)
  - Docker secrets for SSL certificates (production) / self-signed certs (development)
  - Environment variables with ${VAR:-default} pattern in docker-compose.yaml
  - Kong Admin API via curl + jq for runtime configuration
  - Single .env file at project root for all configuration
test_patterns: []
---

# Tech-Spec: Cloud-Native API Gateway Configuration

**Created:** 2026-03-26

## Overview

### Problem Statement

The `api-gateway-solution` directory contains hardcoded domain names (`genie-ai.itu.int`, `e2e-82-109.ssdcloudindia.net`, `e2e-g2-109.ssdcloudindia.net`, `e2e-109-51`) scattered across nginx configs, security headers, and Kong management scripts. Additionally, nginx security headers are duplicated in every `location` block (overriding the server-level `include`), and Kong scripts contain hardcoded URLs, user IDs, and plugin IDs. This prevents portable cloud-native deployment -- every new environment requires manual edits across 10+ files.

### Solution

Parameterize all domain/URL values via environment variables, refactor nginx header architecture to use a single definition point with proper inheritance, unify CSP/CORS variables with the existing backend configuration (`CSP_CONNECT_SRC`, `CORS_ALLOWED_ORIGINS`, `NGINX_PUBLIC_DOMAIN`), move template rendering into the container for automatic config generation at startup, parameterize Kong management scripts, and clean up archived configuration files.

### Scope

**In Scope:**
- Parameterize all hardcoded values in nginx (default.conf.template, security-headers.conf)
- Full nginx header refactoring (remove duplicates, correct hierarchy using `include` per location)
- Move `envsubst` template rendering into `entrypoint.sh` (container-side, automatic at startup)
- Unify CSP/CORS environment variables with backend (`CSP_CONNECT_SRC`, `CORS_ALLOWED_ORIGINS`, `NGINX_PUBLIC_DOMAIN`)
- Parameterize Kong scripts (restore-kong-config.sh)
- Clean up archived files (old-config/, kong-postgres-backups/, kong-backups/, kong_backups/, kong_config.json.old, default.conf, default.conf.backup, default.conf-single-node)
- Update docker-compose to pass environment variables to nginx container
- Update `env` template documentation to reflect nginx usage of shared variables

**Out of Scope:**
- Kong migration to declarative mode (staying DB-backed)
- Docker image version pinning (nginx:latest, kong:latest)
- Kong healthcheck addition
- Frontend or backend code changes
- ModSecurity rules activation (noted as dead config but out of scope)
- Kong CORS plugin removal (noted: if Kong has CORS plugins enabled, they conflict with nginx CORS headers and should be disabled -- but Kong plugin management is out of scope for this spec)

## Context for Development

### Codebase Patterns

- `envsubst` is used to render `default.conf.template` into `default.conf` via `entrypoint.sh` (runs inside container at startup)
- **Key finding**: The nginx service in docker-compose has NO `environment:` section -- env vars are not passed to the container
- Docker secrets are used for SSL certificates in production; self-signed certs are generated in dev via `entrypoint.sh`
- Environment variables use `${VAR:-default}` pattern in docker-compose.yaml
- Kong configuration is applied interactively via `manage-kong-config.sh` using curl + jq against the Kong Admin API
- The backend already defines `CSP_CONNECT_SRC` and `CORS_ALLOWED_ORIGINS` as environment variables
- The `kong_config.json` already has correct Docker service names (`backend`, `document-repository`) -- already portable
- `CSP_CONNECT_SRC` and `CORS_ALLOWED_ORIGINS` are already documented in `env` (sections 5 and 6) but only mention backend/frontend usage; `NGINX_PUBLIC_DOMAIN` is NOT in the `env` template yet

### Files to Reference

| File | Purpose | Action |
| ---- | ------- | ------ |
| `api-gateway-solution/nginx/conf/default.conf.template` | Nginx config template (source of truth) | MODIFY -- remove hardcoded domains, add env vars |
| `api-gateway-solution/nginx/conf/security-headers.conf` | Shared security headers | MODIFY -- parameterize with env vars, remove hardcoded domains |
| `api-gateway-solution/nginx/entrypoint.sh` | SSL cert management + nginx start | EXTEND -- add envsubst step before nginx start |
| `api-gateway-solution/new-config/kong_config.json` | Kong config (hosts already correct) | NO CHANGE |
| `api-gateway-solution/new-config/restore-kong-config.sh` | Kong config restore script | MODIFY -- parameterize hardcoded URLs/IDs |
| `api-gateway-solution/new-config/manage-kong-config.sh` | Interactive Kong config script | NO CHANGE (uses interactive input, acceptable) |
| `docker-compose.yaml` (nginx service, lines 257-281) | Nginx service definition | MODIFY -- add `environment:` section |
| `env` (sections 5, 6, and new section) | Environment variable template | MODIFY -- add NGINX_PUBLIC_DOMAIN, update CSP/CORS docs for nginx usage |

### Technical Decisions

1. **Move envsubst into entrypoint.sh** (container-side rendering):
   - Current: `configure-kong.sh` runs on HOST to generate `default.conf` -- requires manual execution
   - New: `entrypoint.sh` runs `envsubst` on the template at container startup -- fully automatic
   - The `configure-kong.sh` script becomes obsolete and can be removed or kept as a standalone utility
   - `default.conf` (generated file) will no longer be tracked in git -- only the template is committed

2. **Nginx header architecture** (no external modules needed):
   - `security-headers.conf` contains ONLY common security headers (X-Content-Type-Options, X-Frame-Options, etc.)
   - Each `location` block includes `security-headers.conf` for common headers
   - Each `location` block adds ONLY its own specific headers (CORS, CSP) via `add_header`
   - This avoids nginx's `add_header` inheritance override without needing `headers-more-nginx-module`

3. **Unified env vars** (3 shared between backend, frontend, and nginx):
   - `NGINX_PUBLIC_DOMAIN` -- used by: nginx (redirect, Host header, CORS origin, wss://), needs to be added to `env` template
   - `CSP_CONNECT_SRC` -- used by: backend (response headers), frontend (meta tag), nginx (CSP connect-src directive)
   - `CORS_ALLOWED_ORIGINS` -- used by: backend (response headers), nginx (Access-Control-Allow-Origin)

4. **6 env vars total for nginx** (3 existing + 3 nginx-specific):
   - Existing (shared): `NGINX_PUBLIC_DOMAIN`, `CSP_CONNECT_SRC`, `CORS_ALLOWED_ORIGINS`
   - Nginx-specific: `KONG_PROXY_HOST` (default: kong), `NGINX_FRONTEND_HOST` (default: frontend), `NGINX_FRONTEND_PORT` (default: 8090)
   - The 3 nginx-specific vars already have defaults in docker-compose -- no `env` template entries needed

5. **Archive cleanup**: Delete `old-config/`, `kong-postgres-backups/`, `kong-backups/`, `new-config/kong_backups/`, `new-config/kong_config.json.old`, `default.conf`, `default.conf.backup`, `default.conf-single-node`. Git handles version history -- no need for backup directories.

6. **`env` documentation update**: Add `NGINX_PUBLIC_DOMAIN` variable documentation, update `CSP_CONNECT_SRC` and `CORS_ALLOWED_ORIGINS` comments to mention nginx usage in addition to backend/frontend.

## Implementation Plan

### Tasks

- [x] **Task 1: Refactor security-headers.conf**
  - File: `api-gateway-solution/nginx/conf/security-headers.conf`
  - Action:
    - Remove all hardcoded domain references (`e2e-82-109.ssdcloudindia.net`, `genie-ai.itu.int`)
    - Remove the CORS section (`Access-Control-Allow-Origin` line) -- CORS will be handled per-location since it differs between `/api/`, `/`, `/Uploads/`, and static files
    - Remove the CSP section -- CSP will be handled per-location since directives differ
    - Keep ONLY the common security headers that are identical everywhere: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`, `proxy_hide_header` directives
    - This file becomes a pure "common security headers" include -- no domain-specific content
  - Notes: This is the foundation for the header refactoring. All location blocks will `include` this file.

- [x] **Task 2: Rewrite default.conf.template with parameterized values and proper header architecture**
  - File: `api-gateway-solution/nginx/conf/default.conf.template`
  - Action:
    - Replace ALL hardcoded `genie-ai.itu.int` with `${NGINX_PUBLIC_DOMAIN}`
    - Replace ALL hardcoded `localhost` in redirect/CORS with `${NGINX_PUBLIC_DOMAIN}`
    - Remove ALL duplicated security header blocks from every `location` block
    - Add `include conf.d/security-headers.conf;` at the start of every `location` block (and HTTP->HTTPS server block)
    - In each location, add ONLY the headers that are specific to that location:
      - `location ~* \.(txt|xml)$`: add `Cache-Control` header only
      - `location /Uploads/`: no additional headers beyond common
      - `location /api/`: add CORS headers (`Access-Control-Allow-Origin: ${NGINX_PUBLIC_DOMAIN}`, methods, credentials, OPTIONS handling) + API-specific CSP
      - `location /`: add frontend CSP with `${CSP_CONNECT_SRC}` for `connect-src` directive, `proxy_set_header Host ${NGINX_PUBLIC_DOMAIN}`
      - `location @frontend_spa`: add `proxy_set_header Host ${NGINX_PUBLIC_DOMAIN}`
    - CSP `connect-src` in the frontend location: use `${CSP_CONNECT_SRC}` instead of hardcoded domains
    - CSP `script-src` and `style-src`: keep `https://cdnjs.cloudflare.com` (static CDN, not env-dependent)
    - `proxy_set_header Host`: replace `genie-ai.itu.int` with `${NGINX_PUBLIC_DOMAIN}` everywhere
    - HTTP->HTTPS redirect: use `${NGINX_PUBLIC_DOMAIN}` instead of `localhost`
  - Notes: The template variables for envsubst are: `$NGINX_PUBLIC_DOMAIN`, `$CSP_CONNECT_SRC`, `$CORS_ALLOWED_ORIGINS`, `$KONG_PROXY_HOST`, `$NGINX_FRONTEND_HOST`, `$NGINX_FRONTEND_PORT`. Note: `$CORS_ALLOWED_ORIGINS` is used in `/api/` location CORS headers; all 6 variables must be in the envsubst command.
  - **CORS Authority**: CORS headers are handled by nginx in the `/api/` location block. If Kong also has CORS plugins enabled, this creates a dual-CORS conflict (duplicate headers). Ensure Kong CORS plugins are disabled or removed -- nginx is the single authoritative CORS layer.

- [x] **Task 3: Extend entrypoint.sh with envsubst template rendering**
  - File: `api-gateway-solution/nginx/entrypoint.sh`
  - Action:
    - Add `envsubst` step AFTER SSL cert setup and BEFORE `exec nginx`
    - Add pre-flight check for `envsubst` availability:
      ```bash
      command -v envsubst >/dev/null 2>&1 || { echo >&2 "ERROR: envsubst is required but not installed"; exit 1; }
      ```
    - Set defaults for variables if not provided (NOTE: do NOT quote default values -- `'self'` inside double quotes produces literal `'self'`):
      ```bash
      export NGINX_PUBLIC_DOMAIN="${NGINX_PUBLIC_DOMAIN:-localhost}"
      # CSP_CONNECT_SRC format: "'self' https://api.example.com wss://api.example.com"
      export CSP_CONNECT_SRC="${CSP_CONNECT_SRC:-self}"
      export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-https://localhost}"
      export KONG_PROXY_HOST="${KONG_PROXY_HOST:-kong}"
      export NGINX_FRONTEND_HOST="${NGINX_FRONTEND_HOST:-frontend}"
      export NGINX_FRONTEND_PORT="${NGINX_FRONTEND_PORT:-8090}"
      ```
    - The envsubst command should render `default.conf.template` into `default.conf`:
      ```bash
      envsubst '${NGINX_PUBLIC_DOMAIN} ${CSP_CONNECT_SRC} ${CORS_ALLOWED_ORIGINS} ${KONG_PROXY_HOST} ${NGINX_FRONTEND_HOST} ${NGINX_FRONTEND_PORT}' \
        < /etc/nginx/conf.d/default.conf.template \
        > /etc/nginx/conf.d/default.conf
      ```
    - Add a validation step: check that `default.conf` was generated and is valid nginx config (`nginx -t`). If `nginx -t` fails, exit with error (script already has `set -e`).
  - Notes: This eliminates the need for the host-side `configure-kong.sh` script. The template is rendered automatically at every container start.

- [x] **Task 4: Add environment section to nginx service in docker-compose.yaml**
  - File: `docker-compose.yaml` (nginx service, around line 260)
  - Action:
    - Add `environment:` section to the `nginx` service with all 6 variables:
      ```yaml
      environment:
        - NGINX_PUBLIC_DOMAIN=${NGINX_PUBLIC_DOMAIN:-localhost}
        - CSP_CONNECT_SRC=${CSP_CONNECT_SRC:-self}
        - CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS:-https://localhost}
        - KONG_PROXY_HOST=${KONG_PROXY_HOST:-kong}
        - NGINX_FRONTEND_HOST=${NGINX_FRONTEND_HOST:-frontend}
        - NGINX_FRONTEND_PORT=${NGINX_FRONTEND_PORT:-8090}
      ```
  - Notes: Uses the same `${VAR:-default}` pattern as all other services in the compose file. NOTE: `CSP_CONNECT_SRC` default is `self` without quotes -- docker-compose handles quoting differently than shell.

- [x] **Task 5: Update env template with NGINX_PUBLIC_DOMAIN and nginx usage docs**
  - File: `env`
  - Action:
    - Add `NGINX_PUBLIC_DOMAIN` in a new "SECTION 7: API GATEWAY CONFIGURATION" (renumber subsequent sections):
      ```
      # NGINX public domain (used for HTTPS redirect, CORS, Host header, CSP)
      # Default: localhost
      # Production: your-domain.com
      # Used by: nginx (reverse proxy), frontend (CSP connect-src)
      NGINX_PUBLIC_DOMAIN=
      ```
    - Update `VUE_APP_CSP_CONNECT_SRC` (section 5) comment to add: `Used by: frontend (meta tag)` only
    - Update `CSP_CONNECT_SRC` (section 6) comment to add: `Used by: backend (response headers), nginx (CSP connect-src directive)` -- this is the variable nginx uses, NOT `VUE_APP_CSP_CONNECT_SRC`
    - Update `CORS_ALLOWED_ORIGINS` (section 6) comment to add: `Used by: backend (response headers), nginx (Access-Control-Allow-Origin header)`
    - Update `VUE_PROXY_HOST` (section 5) comment to note it should match `NGINX_PUBLIC_DOMAIN`
    - Add a clarification note: nginx uses `CSP_CONNECT_SRC` (section 6), while the frontend build uses `VUE_APP_CSP_CONNECT_SRC` (section 5). For consistency, set both to the same value in `.env`.
    - Add an explicit warning in the new section 8:
      ```
      # IMPORTANT: Also set VUE_APP_CSP_CONNECT_SRC (section 5) to the same value.
      # They serve the same purpose but at different stages (build-time vs runtime).
      ```
  - Notes: Documentation-only change. No runtime impact. The two variables cannot be unified because Vue.js `DefinePlugin` only exposes `VUE_APP_`-prefixed variables to the build.

- [x] **Task 6: Parameterize restore-kong-config.sh**
  - File: `api-gateway-solution/new-config/restore-kong-config.sh`
  - Action:
    - Replace hardcoded `KONG_PUBLIC_URL="http://e2e-82-109.ssdcloudindia.net:8000"` (line 15) with:
      ```bash
      KONG_PUBLIC_URL="${KONG_PUBLIC_URL:-http://localhost:8010}"
      ```
    - Replace hardcoded `USER_ID="2133"` (line 16) with:
      ```bash
      USER_ID="${USER_ID:-1}"
      ```
    - Replace hardcoded plugin ID `13e146bb-0dff-4bfa-a9ca-95b8189ffb03` (line 298) with dynamic lookup:
      ```bash
      RATE_LIMIT_PLUGIN_ID=$(curl -s "$KONG_ADMIN_URL/plugins" | jq -r '.data[] | select(.name == "rate-limiting") | .id' | head -1)
      ```
      Note: `| head -1` ensures only one ID is returned even if multiple rate-limiting plugins exist.
    - Replace hardcoded target `e2e-109-51:3000` (lines 276-293) with parameterized:
      ```bash
      TARGET_HOST="${TARGET_HOST:-backend}"
      TARGET_PORT="${TARGET_PORT:-3000}"
      ```
  - Notes: This script is used for disaster recovery. Making it environment-parameterized allows it to work on any deployment.

- [x] **Task 7: Delete archived and generated files**
  - Action: Delete the following files/directories (all git-tracked, use `git rm` / `git rm -r`):
    - `rm -rf api-gateway-solution/old-config/` -- legacy Kong scripts with hardcoded e2e-109-51 values
    - `rm -rf api-gateway-solution/kong-postgres-backups/` -- stale PostgreSQL dumps
    - `rm -rf api-gateway-solution/kong-backups/` -- legacy Kong backups
    - `rm -rf api-gateway-solution/new-config/kong_backups/` -- Kong config backups (git handles version history)
    - `rm api-gateway-solution/new-config/kong_config.json.old` -- contains hardcoded `"host": "e2e-109-51"`
    - `rm api-gateway-solution/nginx/conf/default.conf` -- generated file (now auto-generated at container start)
    - `rm api-gateway-solution/nginx/conf/default.conf.backup` -- stale backup
    - `rm api-gateway-solution/nginx/conf/default.conf-single-node` -- obsolete single-node variant
    - `rm api-gateway-solution/journal-check.sh` -- host-only security audit script using `eval` (security risk) and `journalctl` (not container-compatible)
  - Notes: All files listed are git-tracked (verified via `git ls-files`). Use `git rm` for tracked files and `git rm -r` for directories.

- [x] **Task 8: Update CLAUDE.md if needed**
  - File: `CLAUDE.md`
  - Action: Review and update any references to `configure-kong.sh` or manual nginx config generation. Add note about automatic template rendering via `entrypoint.sh`.
  - Notes: Only if CLAUDE.md references the old manual process. If no references exist, skip this task.

- [x] **Task 9: Add default.conf to .gitignore**
  - File: `.gitignore`
  - Action: Add `api-gateway-solution/nginx/conf/default.conf` to `.gitignore` to prevent accidental commits of the auto-generated config file.
  - Notes: The `entrypoint.sh` writes the generated `default.conf` to the mounted volume, which appears on the host filesystem. Without this gitignore entry, developers may accidentally commit the generated file.

### Acceptance Criteria

- [ ] **AC 1**: Given a fresh clone with no `.env`, when `docker compose up -d` is run, then nginx starts successfully with self-signed certs and renders `default.conf` from the template using default values (localhost), without any manual script execution.
- [ ] **AC 2**: Given an `.env` file with `NGINX_PUBLIC_DOMAIN=example.com`, when the nginx container starts, then the rendered `default.conf` contains `example.com` in all redirect, Host header, and CORS origin locations -- zero occurrences of `genie-ai.itu.int`, `ssdcloudindia.net`, `e2e-109-51`, or `localhost` (except in default values/documentation).
- [ ] **AC 3**: Given the `security-headers.conf` file, when it is read, then it contains NO hardcoded domain names and NO CSP/CORS headers -- only common security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, Referrer-Policy, Permissions-Policy).
- [ ] **AC 4**: Given the `default.conf.template`, when all location blocks are inspected, then each location block starts with `include conf.d/security-headers.conf;` and contains ONLY location-specific `add_header` directives (no duplicated common headers).
- [ ] **AC 5**: Given `CSP_CONNECT_SRC` and `CORS_ALLOWED_ORIGINS` set in `.env`, when both the backend and nginx containers start, then both services use the same values for CSP connect-src and CORS origin (verifiable via `curl -I` response headers).
- [ ] **AC 6**: Given `restore-kong-config.sh`, when it is run with environment variables `KONG_PUBLIC_URL`, `USER_ID`, `TARGET_HOST`, then it uses those values instead of any hardcoded defaults -- zero hardcoded URLs remain in the script.
- [ ] **AC 7**: Given the `api-gateway-solution/` directory after all changes, when `grep -r` is run for `genie-ai.itu.int`, `ssdcloudindia`, and `e2e-109-51`, then zero matches are found in active files (only `README.md` references are acceptable if they contain generic documentation).
- [ ] **AC 8**: Given the `env` template file, when it is read, then `NGINX_PUBLIC_DOMAIN` is documented with its purpose, default value, and which services use it. `CSP_CONNECT_SRC` and `CORS_ALLOWED_ORIGINS` comments mention nginx usage.

## Additional Context

### Dependencies

- None (self-contained configuration changes)
- Note: `envsubst` is available in the official `nginx:latest` Docker image (part of the `gettext-base` package)

### Testing Strategy

**Manual testing steps** (no automated test framework for infrastructure configs):

1. **Syntax validation**: After modifying `default.conf.template`, render it locally with test values and run `nginx -t` to validate syntax
2. **Grep validation**: Run `grep -rn 'genie-ai\.itu\.int\|ssdcloudindia\|e2e-109-51' api-gateway-solution/` to verify zero hardcoded domain matches in active files
3. **Container startup test**: `docker compose up -d nginx` and verify:
   - Container starts without errors
   - `docker compose logs nginx` shows the envsubst rendering step
   - `curl -fsk https://localhost/` returns the frontend
   - `curl -fsk https://localhost/api/auth/login` proxies to Kong
   - Response headers contain the expected CSP and CORS values
4. **Variable override test**: Set `NGINX_PUBLIC_DOMAIN=test.example.com` in `.env`, restart nginx, verify `curl -I` shows `test.example.com` in CORS and redirect headers
5. **Restore script test**: Run `KONG_PUBLIC_URL=http://localhost:8000 USER_ID=1 TARGET_HOST=backend TARGET_PORT=3000 restore-kong-config.sh -h` to verify it parses without errors

### Notes

- The `pg_hba.conf` is already well-structured and needs no changes
- ModSecurity rules in `nginx/modsec-rules/` are mounted but never referenced in nginx config (dead config) -- noted but out of scope
- The `kong_config.json` hosts were already fixed to Docker service names in a previous commit -- only management scripts need parameterization
- The `scripts/configure-kong.sh` script was deleted -- superseded by container-side envsubst in `entrypoint.sh`
- **Risk**: The `envsubst` in `entrypoint.sh` writes to the mounted volume (`./api-gateway-solution/nginx/conf`), which means the generated `default.conf` will appear on the host filesystem. This is expected behavior and consistent with the current approach, but `.gitignore` should include `default.conf` to prevent accidental commits of generated files.

## Review Notes

- Adversarial review completed (post-implementation)
- Findings: 12 total, 8 fixed (auto-fix), 4 skipped (noise/low-priority)
- Resolution approach: auto-fix
- Key fixes: CSP default quoting, dead `CORS_ALLOWED_ORIGINS` var removed from nginx, `@frontend_spa` security headers added, OPTIONS `if` block header inheritance fixed, env section numbering corrected, port 80 exposed
- Final review: 8 findings, all addressed
- **Implementation deviations from spec:**
  - `CORS_ALLOWED_ORIGINS` was removed from nginx envsubst/template. Rationale: nginx is the TLS termination point and uses `NGINX_PUBLIC_DOMAIN` (single origin) for CORS. `CORS_ALLOWED_ORIGINS` (multi-origin) is backend-only. Documented in template comment.
  - `configure-kong.sh` was deleted (spec said "keep as utility" but it produced incorrect configs missing `CSP_CONNECT_SRC`)
  - `NGINX_PUBLIC_DOMAIN` was placed in Section 7 (not 8 as spec said) to maintain logical ordering
  - CSP_CONNECT_SRC default aligned with backend/frontend defaults for consistent local dev experience

### Walk-Through Review (2026-03-27)

- Findings: 22 total (adversarial scan of all modified files)
- Fixed: 1 (F4 — Kong proxy ports internalized)
- Skipped: 21 (noise, low-priority, or dead code)
- Resolution approach: walk-through with selective fixes
- Key fix:
  - **F4 (Kong ports)**: Kong proxy ports (8000/8443) commented out in `docker-compose.yaml`. All external traffic must route through nginx:80/443. Kong is internal-only within the Docker network. Also fixed `PROXY_TARGET` from `kong:8010` to `kong:8000` (Kong default proxy port is 8000, not 8010). Updated `restore-kong-config.sh` default URL to port 8000. Updated all documentation (README.md, Installation Guide, env template).
- Skipped findings rationale:
  - F5 (config.js): False positive — loaded correctly
  - F7/F11 (frontend nginx `/api/` proxy, `PROXY_TARGET`): Dead code — not used in either dev or prod mode. Resolved in `tech-spec-cleanup-frontend-nginx-dead-code.md`.
  - F9 (Kong CORS plugins): Already addressed — Kong is now internal-only, so duplicate CORS headers never reach the browser
  - Remaining 15: Noise/low-priority, no functional impact
