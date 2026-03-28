---
title: 'Kong Cloud-Native Initialization'
slug: 'kong-cloud-native-init'
created: '2026-03-28'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Kong Gateway (latest, DB-backed)', 'PostgreSQL 13', 'Docker Compose', 'Bash (curl + jq)', 'Alpine Linux']
files_to_modify:
  - docker-compose.yaml
  - api-gateway-solution/new-config/Dockerfile
  - api-gateway-solution/new-config/restore-kong-config.sh
  - GENIE.AI-Installation-Configuration-Guide.md
  - api-gateway-solution/README.md
  - env
code_patterns:
  - Kong Admin API via curl + jq for configuration management
  - Docker Compose depends_on chaining (service_healthy, service_completed_successfully)
  - Init service pattern (run-once service with restart: "no")
  - Environment variables with ${VAR:-default} pattern in docker-compose.yaml
test_patterns: ['Manual infrastructure testing (no automated test framework)', 'curl-based endpoint verification', 'docker compose lifecycle testing']
---

# Tech-Spec: Kong Cloud-Native Initialization

**Created:** 2026-03-28

## Overview

### Problem Statement

`restore-kong-config.sh` must be run manually after every `docker compose up` — Kong starts with an empty configuration. Additionally, Kong caches DNS and returns 502 errors after a backend container is recreated (e.g., `docker compose up -d backend`), requiring manual `kong reload` to flush the DNS cache.

### Solution

Add an init service (`kong-config`) to docker-compose that automatically applies `kong_config.json` via the existing `restore-kong-config.sh` script on startup. Configure `KONG_DNS_STALE_TTL` to minimize DNS cache staleness (502 errors after backend container recreate).

### Scope

**In Scope:**
- `kong-config` init service in docker-compose (using existing Dockerfile + `restore-kong-config.sh`)
- Fully automatic Kong configuration on `docker compose up` — no manual steps
- DNS cache staleness mitigation via `KONG_DNS_STALE_TTL` configuration (+ documented `kong reload` for immediate flush)
- Fix Dockerfile to use `restore-kong-config.sh` instead of `manage-kong-config.sh` (interactive)
- Add Kong healthcheck to docker-compose
- Create GitLab issue for future DB-less analysis (Admin API usage audit, rate-limiting consumer cleanup, DB-less migration path, decK evaluation)

**Out of Scope:**
- Kong migration to DB-less/declarative mode (separate GitLab issue)
- PostgreSQL removal
- Rate-limiting consumer configuration changes
- Config format migration (JSON to YAML / decK)
- Kong image version pinning

## Context for Development

### Codebase Patterns

- Kong Admin API management via `curl` + `jq` — scripts construct JSON payloads and POST/PUT to `KONG_ADMIN_URL`
- Docker Compose dependency chaining: `kong-database` (healthy) → `kong-migrations` (completed) → `kong` (running)
- Environment variables use `${VAR:-default}` pattern in docker-compose.yaml
- Init service pattern: `restart: "no"`, runs once and exits
- Config source: `kong_config.json` (857 lines) contains services, routes, plugins, upstreams, targets
- `restore-kong-config.sh` reads config via mandatory `-b <backup_file>` parameter
- `restore-kong-config.sh` is partially idempotent: routes/plugins check existence before creating (safe), services/upstreams use PUT (overwrite, acceptable), JWT cleanup is safe on empty results

### Files to Reference

| File | Purpose | Action |
| ---- | ------- | ------ |
| `docker-compose.yaml` (lines 46-122) | Kong services (database, migrations, proxy) | MODIFY — add `kong-config` service, add `KONG_DNS_STALE_TTL`, add Kong healthcheck |
| `api-gateway-solution/new-config/Dockerfile` | Init container image (currently wrong) | MODIFY — change ENTRYPOINT to `restore-kong-config.sh`, copy correct files |
| `api-gateway-solution/new-config/restore-kong-config.sh` | Kong config restore script (472 lines) | MODIFY — POSIX compliance, add wait/retry for Kong readiness, add `-b` default |
| `api-gateway-solution/new-config/kong_config.json` | Kong declarative config (857 lines) | NO CHANGE — already parameterized with Docker service names |
| `api-gateway-solution/new-config/manage-kong-config.sh` | Interactive Kong config tool | NO CHANGE — kept as standalone utility |
| `GENIE.AI-Installation-Configuration-Guide.md` (section 4.2.3) | Kong routes setup instructions | MODIFY — replace manual setup with automatic init service documentation |
| `api-gateway-solution/README.md` | Kong/NGINX configuration guide | MODIFY — update Kong services section, document kong-config init service |
| `env` | Environment variable template | MODIFY — add `KONG_DNS_STALE_TTL` documentation |

### Technical Decisions

1. **Init service pattern (not Docker init container)**: Docker Compose does not support Kubernetes-style `initContainers`. Instead, we use a separate `kong-config` service with `restart: "no"` that depends on Kong being healthy. The init service uses `network_mode: "service:kong"` to share Kong's network namespace, giving it loopback access to the Admin API (`127.0.0.1:8001`). This avoids exposing the Admin API on the Docker network. The `kong` service itself does NOT depend on `kong-config` — both depend on `kong-migrations` completing. The init service waits for Kong to be healthy, then applies config via Admin API.

2. **`restore-kong-config.sh` needs wait/retry logic**: The script currently assumes Kong is immediately available. As an init service, it must wait for the Kong Admin API to respond before applying config. Add a retry loop with timeout at the start of the script. Use `curl -s -o /dev/null -w '%{http_code}' $KONG_ADMIN_URL` in a loop with `sleep 2` and max 30 retries (60 seconds total).

3. **`restore-kong-config.sh` needs default `-b` path**: Currently `-b` is mandatory with no default. For automated use, default to `/opt/kong-config/kong_config.json` (the path inside the container where the Dockerfile copies it).

4. **DNS stale TTL approach**: Add `KONG_DNS_STALE_TTL` to Kong environment (default: 5 seconds). This is simpler and more robust than automated `kong reload`. A documented `kong reload` command remains available for immediate flush when needed.

5. **Kong healthcheck**: Add a healthcheck to the `kong` service using `["CMD", "kong", "health"]` (Kong built-in CLI). Note: Kong OSS (`kong:latest`) no longer includes `curl` in the image. The original plan used `curl -sf http://127.0.0.1:8001/status` but this was changed during live testing. `kong health` checks DB connectivity and internal services. This enables the init service to wait for Kong readiness.

6. **Dockerfile fix**: Change from `manage-kong-config.sh` (interactive) to `restore-kong-config.sh` (automated). Copy `restore-kong-config.sh` and `kong_config.json` into the image at `/opt/kong-config/`. The ENTRYPOINT uses `sh` (busybox ash on Alpine), so the script MUST be POSIX-compliant.

7. **POSIX compliance for `restore-kong-config.sh`**: The script must run under `sh` (not `bash`). Current bashisms to fix:
   - Shebang: `#!/bin/bash` → `#!/bin/sh`
   - Process substitution: `< <(echo "$config_json" | jq -c '.routes[]')` → use temp file (5 occurrences: lines 179, 181, 233, 259, 279)
   - Substring expansion: `${jwt_token:0:10}` → use `printf '%.10s'` (2 occurrences: lines 368, 375)
   - `read -s -p` (silent password input) — bash-only flag, line 348. Replace with `printf` + `read` or `stty -echo`/`stty echo` pattern
   - `head -n -1` — GNU coreutils extension (13 occurrences). Works in BusyBox but not strictly POSIX. Replace with `sed '$d'` for strict compliance, or leave as-is since BusyBox supports it (document the decision)

## Implementation Plan

### Tasks

- [x] **Task 1: POSIX compliance + wait/retry + default `-b` path for `restore-kong-config.sh`**
  - File: `api-gateway-solution/new-config/restore-kong-config.sh`
  - Action:
    1. **POSIX compliance fixes** (must run under `sh` / busybox ash):
       - Change shebang: `#!/bin/bash` → `#!/bin/sh`
       - Function syntax is already POSIX-compliant (`name() { }`) — no changes needed
       - Fix process substitution: `< <(echo "$config_json" | jq -c '.routes[]')` → use temp file approach. Replace all 5 occurrences (lines 179, 181, 233, 259, 279) with POSIX-compatible pattern:
         ```sh
         # Before (bash):
         while IFS= read -r item; do ... done < <(echo "$config_json" | jq -c '.routes[]')
         # After (POSIX — temp file approach):
         echo "$config_json" | jq -c '.routes[]' > /tmp/_kong_items.tmp
         while IFS= read -r item; do ... done < /tmp/_kong_items.tmp
         rm -f /tmp/_kong_items.tmp
         ```
         **Important**: The `while read` in a pipe runs in a subshell, so variable assignments (like `errors=$((errors + 1))`) won't propagate to the parent. ALL 4 loop blocks (routes, service plugins, global plugins, upstreams) use this pattern and ALL must be converted to temp file approach. Use a single temp counter file (`/tmp/_kong_errors.tmp`) initialized before each loop block and read after.
       - Fix substring expansion: `${jwt_token:0:10}` → use `printf '%.10s' "$jwt_token"` (2 occurrences: lines 368, 375)
       - Fix `read -s -p "Enter password: " password` (line 348) — `-s` is bash-only. Replace with:
         ```sh
         printf "Enter password: " && stty -echo && read -r password && stty echo && printf '\n'
         ```
       - Fix `head -n -1` (GNU extension, 13 occurrences) → replace with `sed '$d'` for strict POSIX. Note: BusyBox `head` supports `-n -1`, so this is optional but recommended for correctness.
    2. **Add wait/retry logic** at the start of the script (after the log function and tool checks, before any Kong API calls):
       ```sh
       # Wait for Kong Admin API to be ready
       log "Waiting for Kong Admin API at $KONG_ADMIN_URL..."
       max_retries=30
       retry=0
       while [ $retry -lt $max_retries ]; do
           http_code=$(curl -s -o /dev/null -w '%{http_code}' "$KONG_ADMIN_URL" 2>/dev/null)
           if [ "$http_code" = "200" ]; then
               log "Kong Admin API is ready"
               break
           fi
           retry=$((retry + 1))
           log "Kong Admin API not ready (attempt $retry/$max_retries), retrying in 2s..."
           sleep 2
       done
       if [ $retry -eq $max_retries ]; then
           log "ERROR: Kong Admin API not available after $((max_retries * 2)) seconds"
           exit 1
       fi
       ```
    3. **Add default `-b` path**: Change the `-b` parameter handling:
       ```sh
       BACKUP_FILE="${BACKUP_FILE:-/opt/kong-config/kong_config.json}"
       ```
       Remove the mandatory check error (line ~461-463) but keep the file existence check:
       ```sh
       if [ ! -f "$BACKUP_FILE" ]; then
           log "ERROR: Config file not found: $BACKUP_FILE"
           exit 1
       fi
       ```
  - Notes: The pipe subshell issue (step 1) is the trickiest part. Options:
    - Use a temp file: `echo "$config_json" | jq -c '.routes[]' > /tmp/routes.tmp && while IFS= read -r item; do ... done < /tmp/routes.tmp && rm -f /tmp/routes.tmp`
    - Or restructure: count errors outside the loop by writing to a temp counter file
    - Prefer the temp file approach — cleaner and more readable
  - **Critical**: After POSIX conversion, test the script locally: `sh restore-kong-config.sh -h` and `sh restore-kong-config.sh -b kong_config.json` to verify no bashisms remain.
    4. **Redirect logs to stdout**: Change the `log` function to also output to stdout (so `docker compose logs kong-config` captures output). Add `echo "$msg"` alongside any file logging, or replace file logging entirely with stdout since Docker captures it. This ensures operators can inspect init service logs via `docker compose logs kong-config`.

- [x] **Task 2: Fix Dockerfile for init service**
  - File: `api-gateway-solution/new-config/Dockerfile`
  - Action: Rewrite the Dockerfile to use `restore-kong-config.sh`:
    ```dockerfile
    FROM alpine:3.21
    RUN apk add --no-cache curl jq
    COPY restore-kong-config.sh kong_config.json /opt/kong-config/
    WORKDIR /opt/kong-config
    RUN chmod +x restore-kong-config.sh
    ENTRYPOINT ["sh", "restore-kong-config.sh"]
    ```
  - Notes: Removes `manage-kong-config.sh` from the image. The ENTRYPOINT runs `restore-kong-config.sh` which now has a default `-b` path of `/opt/kong-config/kong_config.json`. The container exits after the script completes (init pattern).

- [x] **Task 3: Add `kong-config` init service to docker-compose.yaml**
  - **Deviation:** Implementation uses `network_mode: "service:kong"` instead of `networks: [genieai_network]` + `KONG_ADMIN_URL=http://kong:8001`. This is because Kong OSS Admin API listens only on `127.0.0.1:8001` (internal). Sharing Kong's network namespace gives the init container loopback access without exposing the Admin API on the Docker network. This is more secure than the original plan.
  - File: `docker-compose.yaml`
  - Action: Add a new `kong-config` service after the `kong` service definition:
    ```yaml
    kong-config:
      build:
        context: ./api-gateway-solution/new-config
        dockerfile: Dockerfile
      restart: "no"
      networks:
        - genieai_network
      environment:
        - KONG_ADMIN_URL=${KONG_ADMIN_URL:-http://kong:8001}
        - KONG_PUBLIC_URL=${KONG_PUBLIC_URL:-http://kong:8000}
        - USER_ID=${USER_ID:-1}
        - TARGET_HOST=${TARGET_HOST:-backend}
        - TARGET_PORT=${TARGET_PORT:-3000}
      depends_on:
        kong:
          condition: service_healthy
    ```
  - Notes: The `kong-config` service depends on `kong:service_healthy`. Kong does NOT depend on `kong-config` — this avoids circular dependencies. The init service runs after Kong is healthy and applies config via Admin API. The `restart: "no"` ensures it only runs once. Uses `build` context because the Dockerfile needs to copy local scripts. **Important**: The `KONG_ADMIN_URL` environment variable in docker-compose (`http://kong:8001`) overrides the script's default (`http://localhost:8001`). This is correct: Docker Compose sets env vars before the script runs. When running the script standalone (outside Docker), the localhost default is used.

**Recovery if init service fails**: If `kong-config` exits with code 1 (partial config), Kong is in a partially configured state. Since `restart: "no"`, the service won't auto-restart. To re-run: `docker compose run kong-config`. The script is idempotent (safe to re-run).

- [x] **Task 4: Add Kong healthcheck to docker-compose.yaml**
  - **Deviation:** Implementation uses `["CMD", "kong", "health"]` instead of `curl -sf http://127.0.0.1:8001/status`. Kong OSS (`kong:latest`) no longer includes `curl` in the image. `kong health` is the built-in CLI command that checks DB connectivity and internal services.
  - File: `docker-compose.yaml` (kong service, lines ~89-122)
  - Action: Add a healthcheck to the `kong` service:
    ```yaml
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:8001/status"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    ```
  - Notes: Uses the Kong OSS Admin API `/status` endpoint on localhost (NOT `/health` which is Kong Enterprise only). The `kong:latest` image includes `curl`. The `start_period: 30s` gives Kong time to initialize before healthchecks begin. This healthcheck is required for `kong-config` to depend on Kong being ready.

- [x] **Task 5: Add `KONG_DNS_STALE_TTL` to Kong environment in docker-compose.yaml**
  - File: `docker-compose.yaml` (kong service environment section, after existing DNS vars)
  - Action: Add after the existing `KONG_DNS_ORDER` line:
    ```yaml
    - KONG_DNS_STALE_TTL=${KONG_DNS_STALE_TTL:-5}
    ```
  - Notes: Default of 5 seconds means Kong will consider DNS entries stale after 5 seconds and re-resolve on the next request. This mitigates the 502 issue when backend containers are recreated. The value is configurable via `.env` for tuning. Kong documentation recommends values between 1-3600 seconds.

- [x] **Task 6: Update `env` template with Kong DNS documentation**
  - File: `env`
  - Action: Add `KONG_DNS_STALE_TTL` in the API Gateway section (Section 7, alongside existing Kong variables):
    ```
    # Kong DNS stale TTL in seconds (default: 5)
    # Lower values reduce 502 errors after backend container recreate
    # Range: 1-3600. Set to 1 for immediate re-resolution (higher CPU).
    # Use "docker exec <kong-container> kong reload" for immediate DNS flush.
    KONG_DNS_STALE_TTL=
    ```
  - Notes: Documentation-only change. Documents the new variable and provides the `kong reload` command as an operational note.

- [x] **Task 7: Create GitLab issue for DB-less analysis**
  - Action: Create a GitLab issue titled "Analysis: Kong DB-less migration path" with the following content:
    - **Description**: Evaluate migration from DB-backed Kong to DB-less (declarative) mode.
    - **Questions to investigate**:
      1. Admin API usage audit — who uses it, for what, how often?
      2. Rate-limiting plugin uses `limit_by: "consumer"` but no consumers are defined — is this feature needed? Should it be reconfigured or removed?
      3. DB-less migration path — what changes are needed in `kong_config.json`? Are any features incompatible?
      4. decK evaluation — would decK (declarative config tool) be a better fit for DB-backed mode than `restore-kong-config.sh`?
      5. Kubernetes readiness — if GENIE.AI migrates to K8s, Kong DB-less + KIC is the standard path. Document prerequisites.
    - **Labels**: `technical-debt`, `research`, `api-gateway`
  - Notes: This issue captures the out-of-scope items for future work. Jerome will create it or provide the GitLab project URL for CLI creation.

- [x] **Task 8: Update Installation Guide — Kong section**
  - File: `GENIE.AI-Installation-Configuration-Guide.md` (section 4.2.3, lines ~948-971)
  - Action: Replace the manual Kong setup instructions with automatic init service documentation:
    - Change section title from "Kong — Routes and Plugins (Manual One-Time Setup)" to "Kong — Routes and Plugins (Automated)"
    - Remove the `docker run --rm --network container:...` manual commands (lines 956-969)
    - Replace with: "Kong routes and plugins are applied automatically by the `kong-config` init service on every `docker compose up`. No manual configuration is required. The init service waits for Kong to be healthy, then applies `kong_config.json` via the Admin API."
    - Add note about the DNS stale TTL: "Kong is configured with `KONG_DNS_STALE_TTL=5` by default. If you recreate a backend container and see 502 errors, wait up to 5 seconds for DNS re-resolution, or run `docker exec <kong-container> kong reload` for immediate flush."
    - Update the existing note (line 971) about persistence: Kong routes persist in the database; the init service is idempotent (safe to re-run).
  - Notes: The section 4.2.2 (migrations) remains unchanged — it's already documented as automated.

- [x] **Task 9: Update api-gateway-solution README**
  - File: `api-gateway-solution/README.md`
  - Action:
    - In the Architecture section (lines ~38-63): Add `kong-config` init service description:
      ```
      - **kong-config**: Init container that applies Kong configuration.
        - Image: Built from `new-config/Dockerfile` (Alpine + curl + jq).
        - Depends on: `kong` (healthy).
        - Runs once on startup, applies `kong_config.json` via Kong Admin API.
      ```
    - In the Kong Configuration Scripts section (line ~127): Update `restore-kong-config.sh` description to mention:
      - POSIX-compliant (`#!/bin/sh`)
      - Default `-b` path: `/opt/kong-config/kong_config.json`
      - Wait/retry for Kong readiness (60s timeout)
      - Used by the `kong-config` init service for automatic configuration
    - Add a note that `manage-kong-config.sh` is a standalone interactive tool (not used in automated deployment)
    - Add troubleshooting note: "If Kong returns 502 after a backend container recreate, wait 5 seconds (DNS stale TTL) or run `docker exec <kong-container> kong reload`."
  - Notes: Keep the existing script documentation — just update and add the automated context.

### Acceptance Criteria

- [ ] **AC 1**: Given a fresh `docker compose down -v && docker compose up -d`, when all services start, then Kong has all routes, services, plugins, and upstreams configured without any manual script execution. Verify with `curl -s http://localhost:8001/services | jq '.data | length'` (run from kong-config container or kong network) showing > 0 services.
- [ ] **AC 2**: Given Kong is running with config applied and `KONG_DNS_STALE_TTL` is set, when `docker compose up -d backend` is run to recreate the backend container, then Kong re-resolves DNS within the stale TTL window. Test by making 5 consecutive requests over 10 seconds — all must succeed (200) after the initial stale period.
- [ ] **AC 3**: Given the `kong-config` service in docker-compose, when `docker compose up -d` is run a second time (restart), then the init service runs again without errors (idempotent re-run). Verify with `docker compose logs kong-config` showing "Kong Admin API is ready" and no error exits.
- [x] **AC 4**: Given the `kong` service, when `docker inspect` is run, then a healthcheck is defined with `kong health` (Kong built-in CLI), and the service reports as "healthy" within 60 seconds of startup.
- [ ] **AC 5**: Given the `api-gateway-solution/new-config/Dockerfile`, when it is read, then it copies `restore-kong-config.sh` (not `manage-kong-config.sh`) and `kong_config.json`, and the ENTRYPOINT is `sh restore-kong-config.sh`.
- [ ] **AC 6**: Given `restore-kong-config.sh`, when it is run with `sh` (not bash), then it completes without syntax errors. Verify with `sh -n restore-kong-config.sh` (syntax check) and `sh restore-kong-config.sh -h` (runtime).
- [ ] **AC 7**: Given `restore-kong-config.sh` is run without `-b` parameter, when it executes, then it uses the default path `/opt/kong-config/kong_config.json` without error.
- [ ] **AC 8**: Given `restore-kong-config.sh` is run before Kong is ready, when it executes, then it waits up to 60 seconds for the Kong Admin API to respond, logging retry attempts, and exits with error code 1 if Kong never becomes available.
- [ ] **AC 9**: Given the `env` template file, when it is read, then `KONG_DNS_STALE_TTL` is documented with its purpose, default value, and the `kong reload` operational command.
- [ ] **AC 10**: Given `GENIE.AI-Installation-Configuration-Guide.md` section 4.2.3, when it is read, then it describes Kong configuration as automated (no manual `docker run` commands), and mentions the `kong-config` init service and DNS stale TTL.
- [ ] **AC 11**: Given `api-gateway-solution/README.md`, when it is read, then it documents the `kong-config` init service in the architecture section, and the `restore-kong-config.sh` POSIX compliance and default `-b` path.

## Additional Context

### Dependencies

- Existing `restore-kong-config.sh` script (parameterized in previous cloud-native API gateway spec)
- Existing `api-gateway-solution/new-config/Dockerfile` (to be rewritten)
- Kong must be running with Admin API accessible before init service applies config
- Docker Compose `depends_on` with `condition: service_healthy` requires Kong healthcheck (Task 4 is prerequisite for Task 3)

### Testing Strategy

**Manual testing steps** (no automated test framework for infrastructure configs):

1. **Clean start test**: `docker compose down -v && docker compose up -d` — verify all services start, check `docker compose logs kong-config` for successful config application, verify routes exist via Admin API.
2. **Idempotence test**: `docker compose up -d` again (second run) — verify `kong-config` service runs without errors, config unchanged.
3. **DNS stale TTL test**: `docker compose up -d backend` (recreate backend), then immediately `curl -sf https://localhost/api/auth/login` — should not return 502 within 5 seconds.
4. **Wait/retry test**: Temporarily set `KONG_ADMIN_URL` to an invalid host, start `kong-config` service — verify it retries and eventually fails with clear error message.
5. **Healthcheck test**: `docker inspect --format='{{.State.Health.Status}}' <kong-container>` — should show "healthy" within 60 seconds.
6. **Kong reload test**: After any config change, `docker exec <kong-container> kong reload` should succeed without error.

### Notes

- **DB-backed mode is intentionally kept** (not migrating to DB-less) — this is a deliberate choice to minimize blast radius.
- **Future DB-less analysis** will be tracked in a separate GitLab issue covering: Admin API usage audit, rate-limiting consumer cleanup, DB-less migration path, decK evaluation.
- **Rate-limiting by consumer is non-functional** — `limit_by: "consumer"` but no consumers defined. Left as-is per scope decision.
- **`restore-kong-config.sh` idempotence is partial** — services/upstreams use PUT (overwrite), routes/plugins check existence (skip). This is acceptable: PUT is idempotent by nature, and overwriting config on restart ensures consistency.
- **`KONG_DNS_STALE_TTL=5` is a conservative default** — can be lowered to 1 for near-immediate re-resolution at the cost of slightly more DNS queries (negligible at our scale).
- **Kong image is `kong:latest`** — version pinning is out of scope but should be addressed in a future iteration.
- **`kong-rate-limit.sh` is not integrated** — the `new-config/` directory contains this standalone rate-limiting management script. It is not used by the init service and is kept as a standalone utility. If rate-limiting configuration needs to be automated in the future, it should be integrated into the init service (tracked in DB-less GitLab issue).
- **Init service logs** — `restore-kong-config.sh` writes to `kong_restore.log` inside the container. Since the container exits after running and there is no volume mount, these logs are lost. Docker captures stdout/stderr via `docker compose logs kong-config`. Consider redirecting log output to stdout in the script (add `exec > >(tee -a /proc/1/fd/1)` or change `log` function to `printf` + `echo`) so operators can inspect logs via `docker compose logs`.
- **`set -e` is intentionally absent** — `restore-kong-config.sh` does not use `set -e`. The script accumulates errors and reports them at the end. For the init service context, this is acceptable: partial config is better than no config, and the script exits with a non-zero code if errors occurred. Do NOT add `set -e` — it would cause the script to exit on the first curl failure, leaving Kong in an even more partial state.

## Review Notes

- Adversarial review completed
- Findings: 12 total, 7 fixed, 1 pre-existing (out of scope), 4 skipped (noise/low)
- Resolution approach: auto-fix
- Fixed: F2 (trap cleanup), F3 (PID-based temp files), F4 (nginx depends on kong-config), F5 (jq null safety), F6 (final log accuracy), F8 (TTY check for stty), F10 (merged with F3)
- Pre-existing: F1 (services[0] only) — tracked in GitLab issue #379
- Skipped: F7 (intentional behavior change per spec), F9 (resolved: Kong OSS dropped curl, switched to kong health), F11 (pre-existing pattern), F12 (double wait is harmless safety net)
- Code review: I1 (exit 1 → return 1 in restore_config), I2 (AC4 updated), I3 (Task 3 deviation documented)
