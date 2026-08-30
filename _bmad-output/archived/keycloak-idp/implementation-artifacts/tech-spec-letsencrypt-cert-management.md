---
title: 'Let''s Encrypt Certificate Management'
slug: 'letsencrypt-cert-management'
created: '2026-04-10'
status: 'done'
stepsCompleted: [1, 2, 3, 4]
baseline_commit: '8f4772c'
tech_stack: ['Bash (entrypoints)', 'nginx (conf templates + envsubst)', 'Docker Compose (dual-mode)', 'certbot/certbot (official image)']
files_to_modify: ['docker-compose.yaml', 'api-gateway-solution/nginx/conf/default.conf.template', 'api-gateway-solution/nginx/entrypoint.sh', 'api-gateway-solution/certbot/entrypoint.sh (new)', 'env', 'secrets/README.md', 'site/content/en/docs/deployment/docker-compose-setup.md', 'site/content/en/docs/deployment/docker-swarm-setup.md']
code_patterns: ['Conditional services: profiles: [xxx] + replicas: ${VAR:-0}', 'Nginx entrypoint manages all SSL logic (volume mount -> self-signed fallback)', 'default.conf.template rendered via envsubst at container start', 'Port 80 server block restructured: ACME location + redirect location']
test_patterns: ['No existing tests for nginx/certbot infrastructure']
---

# Tech-Spec: Let's Encrypt Certificate Management

**Created:** 2026-04-10
**Reviewed:** 2026-04-10 (adversarial review: 13 findings resolved)

## Overview

### Problem Statement

Currently, SSL certificate management in the docker-compose stack is manual: self-signed certs are auto-generated in development, and production deployments require manually placing certificates in `./secrets/ssl/`. There is no automated certificate provisioning or renewal.

### Solution

Add a `certbot` service to the docker-compose that automatically obtains and renews Let's Encrypt certificates via HTTP-01 challenge. The service is conditionally activated only when `CERTBOT_EMAIL` is set in `.env`. When not set, the existing behavior (volume-mounts or self-signed) is preserved.

### Scope

**In Scope:**
- Certbot service in docker-compose.yaml (dual-mode compatible)
- Conditional activation: `profiles: [letsencrypt]` + `CERTBOT_REPLICAS`
- HTTP-01 challenge with shared webroot volume between nginx and certbot
- Automatic renewal via foreground shell loop inside certbot container
- Nginx reload after renewal via flag file (unified mechanism for both compose up and Swarm)
- Certs written to `./secrets/ssl/` (same path as current volume mounts)
- `CERTBOT_EMAIL` and `CERTBOT_REPLICAS` env vars in `env` template
- ACME challenge location in nginx config (always present, harmless when inactive)
- Documentation updates (env, secrets/README.md, compose-setup.md, swarm-setup.md)

**Out of Scope:**
- DNS-01 challenge
- Wildcard certificates
- Multiple domain support
- Alternative ACME providers (ZeroSSL, etc.)
- Certificate revocation
- ECDSA/alternative key types

## Context for Development

### Codebase Patterns

- Dual-mode docker-compose.yaml: `docker compose up` and `docker stack deploy` both work
- OPEA services use `profiles: [opea]` (compose up) / `replicas: ${DEPLOY_OPEA:-1}` (Swarm) for conditional activation — certbot will follow same pattern with `profiles: [letsencrypt]` / `replicas: ${CERTBOT_REPLICAS:-0}`
- Nginx entrypoint (`api-gateway-solution/nginx/entrypoint.sh`) handles SSL cert logic: checks volume mount at `/etc/nginx/ssl/` → validates with openssl → copies to `/etc/nginx/certs/` → self-signed fallback
- Nginx config rendered via `envsubst` at container start from `default.conf.template`
- Port 80 currently has a server-level `return 301 https://...` — this must be restructured into a `location /` block to allow the ACME challenge location to match first
- SSL certs volume-mounted from `./secrets/ssl/server.crt` and `server.key` into nginx (read-only)
- All config via env vars, single `.env` file at project root
- Swarm ignores `profiles` and `depends_on`; compose up ignores `deploy` block
- Nginx Dockerfile copies conf templates and entrypoint from `api-gateway-solution/nginx/`
- The `location ~ /\.` deny rule in the port 443 server block does NOT affect ACME challenges — challenges arrive on port 80, which is a separate server block

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `docker-compose.yaml:193-232` | Current nginx service definition (base for modifications) |
| `docker-compose.yaml:491-530` | Example OPEA service pattern (profiles + replicas) |
| `api-gateway-solution/nginx/conf/default.conf.template` | Port 80 server block must be restructured for ACME location |
| `api-gateway-solution/nginx/conf/default.conf.template:39` | `location ~ /\.` deny rule (port 443 only — not a blocker for ACME) |
| `api-gateway-solution/nginx/entrypoint.sh` | Current SSL logic — needs reload loop addition |
| `api-gateway-solution/nginx/Dockerfile` | Build context for nginx (conf/ copied into image) |
| `env` (Section 7) | API Gateway config (CERTBOT_EMAIL will go here) |
| `secrets/README.md` | Current SSL docs — needs Let's Encrypt section |

### Technical Decisions

- **Activation mechanism**: Two levers required — env var + deployment flag:
  - Compose up: `CERTBOT_EMAIL=...` in `.env` + `--profile letsencrypt`
  - Swarm: `CERTBOT_EMAIL=...` in `.env` + `CERTBOT_REPLICAS=1`
  - Same pattern as existing OPEA services (`--profile opea` / `DEPLOY_OPEA`)
- **Service definition**: certbot uses `profiles: [letsencrypt]` (compose up) + `replicas: ${CERTBOT_REPLICAS:-0}` (Swarm)
- **Challenge method**: HTTP-01 via shared named volume `/var/www/certbot` between nginx and certbot
- **Cert storage**: Certbot manages its own state in a named volume `certbot-etc:/etc/letsencrypt`. After obtaining/renewing certs, the entrypoint copies `fullchain.pem` → `server.crt` and `privkey.pem` → `server.key` to `./secrets/ssl/` via a bind mount at `/secrets/ssl/`
- **Bootstrap logic**: Certbot entrypoint checks if valid certs (>30 days remaining) exist in `./secrets/ssl/` before requesting new ones (avoids rate limits)
- **Renewal**: Foreground shell loop inside certbot container (every 12 hours). No cron dependency — uses `certbot/certbot` official image directly without custom Dockerfile
- **Nginx reload after renewal**: Unified flag file mechanism for both compose up and Swarm — certbot writes `/var/www/certbot/reload-nginx` in the shared webroot volume, nginx entrypoint checks every 5 minutes and reloads. No Docker socket needed in certbot.
- **ACME routing**: Nginx `default.conf.template` port 80 server block restructured: `location /.well-known/acme-challenge/` (serves challenge files) + `location /` (redirects to HTTPS). The ACME location is always present and harmless when certbot is not running.
- **Certbot image**: `certbot/certbot` official image used directly (no custom Dockerfile). Shell loop handles renewal timing.
- **Staging**: Support `CERTBOT_STAGING=true` for Let's Encrypt staging (avoids rate limits during testing)
- **Error handling**: Certbot entrypoint uses retry with exponential backoff on initial certificate request. If repeated failures occur (e.g., DNS not configured), the container logs the error and waits for the next renewal cycle instead of crash-looping.

## Implementation Plan

### Tasks

- [x] Task 1: Create certbot entrypoint script
  - File: `api-gateway-solution/certbot/entrypoint.sh` (new)
  - Action: Create POSIX-compliant entrypoint script that:
    1. Validates `CERTBOT_EMAIL` and `NGINX_PUBLIC_DOMAIN` are set (exit 1 if not)
    2. Creates `/var/www/certbot` webroot directory
    3. Creates `/secrets/ssl/` if not exists
    4. Checks if existing certs in `/secrets/ssl/` are valid (>30 days remaining via `openssl x509 -enddate -checkend 2592000`)
    5. If valid certs exist → skip initial request, proceed to renewal loop
    6. If no valid certs → run `certbot certonly --webroot -w /var/www/certbot -d $NGINX_PUBLIC_DOMAIN --email $CERTBOT_EMAIL --agree-tos --non-interactive` with retry (up to 3 attempts, exponential backoff: 30s, 60s, 120s). Log errors but do not exit on failure.
    7. Copy obtained certs from `/etc/letsencrypt/live/$NGINX_PUBLIC_DOMAIN/` (`fullchain.pem` → `/secrets/ssl/server.crt`, `privkey.pem` → `/secrets/ssl/server.key`)
    8. Trigger nginx reload by writing flag file: `touch /var/www/certbot/reload-nginx`
    9. Enter foreground renewal loop: `while true; do certbot renew --quiet; if renewed → copy certs + write flag file; sleep 43200; done` (every 12 hours)
  - Notes:
    - Use `--staging` flag if `CERTBOT_STAGING=true` is set
    - No Dockerfile needed — uses `certbot/certbot` official image directly
    - The renewal loop is the container's PID 1 (foreground process) — keeps container alive
    - `certbot renew` is idempotent: if cert is not near expiry, it does nothing
    - On failure during initial request, log error and wait for next renewal cycle (no crash loop)

- [x] Task 2: Add ACME challenge location to nginx config
  - File: `api-gateway-solution/nginx/conf/default.conf.template`
  - Action: Restructure the port 80 server block. Currently it has a server-level `return 301 https://...` which intercepts all requests before any location block can match. Replace with:
    ```nginx
    server {
        listen ${NGINX_HTTP_PORT:-80};
        server_name ${NGINX_PUBLIC_DOMAIN:-localhost};

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }
    ```
    The `location /.well-known/acme-challenge/` is more specific than `location /`, so nginx matches it first. When certbot is not running, the directory is empty and nginx returns 404 (harmless).
  - Notes:
    - The existing `location ~ /\.` deny rule is in the port 443 server block only — it does NOT affect ACME challenges on port 80. No change needed to that rule.
    - The server block must be wrapped in the same `envsubst` templating as the rest of the file

- [x] Task 3: Add webroot volume and reload loop to nginx service
  - File: `docker-compose.yaml` (nginx service, lines ~193-232)
  - Action:
    1. Add named volume mount: `certbot-webroot:/var/www/certbot:ro` (used for ACME challenges + reload flag file)
  - File: `api-gateway-solution/nginx/entrypoint.sh`
  - Action: Modify the entrypoint to run nginx in the background and a flag-check loop in the foreground (instead of `exec nginx`):
    ```bash
    # Start nginx in background
    nginx -g 'daemon off;' &
    NGINX_PID=$!

    # Flag-check loop in foreground (PID 1)
    while true; do
        sleep 300
        # If nginx died, exit so Docker can restart the container
        if ! kill -0 $NGINX_PID 2>/dev/null; then
            echo "nginx process died, exiting"
            exit 1
        fi
        # Check for reload flag from certbot
        if [ -f /var/www/certbot/reload-nginx ]; then
            nginx -s reload
            rm -f /var/www/certbot/reload-nginx
        fi
    done
    ```
  - Notes:
    - nginx must run in background (not `exec`) so the shell remains PID 1 to run the loop
    - The PID check ensures the container restarts if nginx crashes
    - `nginx -s reload` reloads the config AND picks up new certificate files on disk
    - The flag file approach works for both compose up and Swarm — unified mechanism, no Docker socket needed

- [x] Task 4: Add certbot service to docker-compose.yaml
  - File: `docker-compose.yaml` (after nginx service, before OPEA section)
  - Action: Add `certbot` service definition:
    ```yaml
    certbot:
      profiles: [letsencrypt]
      restart: unless-stopped
      image: certbot/certbot:latest
      entrypoint: ["/certbot-entrypoint.sh"]
      environment:
        - CERTBOT_EMAIL=${CERTBOT_EMAIL}
        - NGINX_PUBLIC_DOMAIN=${NGINX_PUBLIC_DOMAIN:-localhost}
        - CERTBOT_STAGING=${CERTBOT_STAGING:-false}
      volumes:
        - ./api-gateway-solution/certbot/entrypoint.sh:/certbot-entrypoint.sh:ro
        - certbot-webroot:/var/www/certbot
        - certbot-etc:/etc/letsencrypt
        - ./secrets/ssl:/secrets/ssl:rw
      depends_on:
        nginx:
          condition: service_healthy
      deploy:
        replicas: ${CERTBOT_REPLICAS:-0}
        placement:
          constraints:
            - node.labels.gateway == true
          restart_policy:
            condition: any
            delay: 10s
            max_attempts: 5
    ```
    Also add named volume definitions: `certbot-webroot` and `certbot-etc`.
  - Notes:
    - `profiles: [letsencrypt]` — compose up requires `--profile letsencrypt`
    - `replicas: ${CERTBOT_REPLICAS:-0}` — Swarm requires `CERTBOT_REPLICAS=1`
    - No Docker socket — nginx reload handled via flag file (shared webroot volume)
    - `certbot-etc` named volume persists Let's Encrypt config/state (accounts, renewal configs) across restarts
    - `./secrets/ssl:/secrets/ssl:rw` bind mount — certbot entrypoint copies `fullchain.pem` → `server.crt` and `privkey.pem` → `server.key` here after obtaining/renewing certs
    - `certbot-webroot` named volume — shared with nginx for ACME challenge files and reload flag
    - `gateway=true` node label ensures certbot runs on the same node as nginx
    - No healthcheck: certbot is a long-running background service, not a request-handling service

- [x] Task 5: Add CERTBOT_EMAIL to env template
  - File: `env` (Section 7: API Gateway Configuration)
  - Action: Add after existing NGINX config vars:
    ```
    # Let's Encrypt certificate management (optional)
    # Set CERTBOT_EMAIL to enable automatic SSL certificate provisioning via Let's Encrypt.
    # Activation requires: CERTBOT_EMAIL + deployment flag (--profile letsencrypt / CERTBOT_REPLICAS)
    # CERTBOT_EMAIL=your-email@example.com
    # CERTBOT_REPLICAS=0
    # CERTBOT_STAGING=false
    ```
  - Notes: All commented out (defaults). User uncomments and sets values to activate.

- [x] Task 6: Update secrets/README.md
  - File: `secrets/README.md`
  - Action: Add a "Let's Encrypt (Automatic)" section alongside existing "Development" and "Production" sections. Document:
    1. Set `CERTBOT_EMAIL` in `.env`
    2. Use `--profile letsencrypt` (compose up) or `CERTBOT_REPLICAS=1` (Swarm)
    3. Certificates are automatically obtained and renewed
    4. Renewal happens every 12 hours via foreground shell loop inside certbot container
    5. Nginx is automatically reloaded after renewal via flag file

- [x] Task 7: Update documentation
  - File: `site/content/en/docs/deployment/docker-compose-setup.md`
  - Action: Add Let's Encrypt section explaining activation with `--profile letsencrypt` and `CERTBOT_EMAIL`
  - File: `site/content/en/docs/deployment/docker-swarm-setup.md`
  - Action: Add Let's Encrypt section explaining activation with `CERTBOT_REPLICAS=1` and `CERTBOT_EMAIL`

### Acceptance Criteria

- [ ] AC 1: Given no `CERTBOT_EMAIL` in `.env`, when deploying with `docker compose up -d`, then the certbot service does not start and nginx uses self-signed certs
- [ ] AC 2: Given `CERTBOT_EMAIL=user@example.com` in `.env`, when deploying with `docker compose --profile letsencrypt up -d`, then certbot obtains a Let's Encrypt certificate for `NGINX_PUBLIC_DOMAIN` and writes it to `./secrets/ssl/server.crt` and `server.key`
- [ ] AC 3: Given valid Let's Encrypt certs already exist in `./secrets/ssl/` (>30 days remaining), when certbot starts, then it skips certificate request and enters the renewal loop
- [ ] AC 4: Given certificates are nearing expiry (<30 days), when the renewal loop runs, then certbot renews them and triggers nginx reload via flag file without downtime
- [ ] AC 5: Given HTTP-01 challenge is in progress, when Let's Encrypt requests `/.well-known/acme-challenge/`, then nginx serves the challenge file from the shared webroot volume instead of redirecting to HTTPS
- [ ] AC 6: Given `CERTBOT_STAGING=true` in `.env`, when certbot runs, then it uses the Let's Encrypt staging server (avoids rate limits during testing)
- [ ] AC 7: Given Swarm deployment with `CERTBOT_REPLICAS=1`, when certbot renews certificates, then nginx is reloaded via the flag file mechanism
- [ ] AC 8: Given manual certificates are placed in `./secrets/ssl/`, when Let's Encrypt mode is not activated, then nginx uses those manual certificates as before (no regression)
- [ ] AC 9: Given initial certificate request fails (e.g., DNS not configured), when certbot retries, then it uses exponential backoff (30s, 60s, 120s) and logs errors without crash-looping

## Additional Context

### Dependencies

- `certbot/certbot` official Docker image (pull from Docker Hub)
- Port 80 must be accessible from the internet for HTTP-01 challenge
- Valid `NGINX_PUBLIC_DOMAIN` (FQDN) pointing to the server via DNS A/AAAA record
- `node.labels.gateway == true` must be set on the node running nginx (already required by current nginx placement constraint)

### Testing Strategy

**Manual testing steps (no automated tests for infra):**

1. **Self-signed fallback (no regression):** Deploy without `CERTBOT_EMAIL` → verify self-signed cert, browser warning
2. **Bootstrap:** Set `CERTBOT_EMAIL` + deploy with `--profile letsencrypt` → verify cert obtained in `./secrets/ssl/`
3. **Renewal:** Manually trigger `certbot renew` in running container → verify nginx reloads via flag file
4. **ACME challenge:** Verify `/.well-known/acme-challenge/` serves correct files from port 80
5. **Swarm mode:** Deploy with `CERTBOT_REPLICAS=1` → verify cert obtained, verify flag file reload works
6. **Staging:** Set `CERTBOT_STAGING=true` → verify staging server is used
7. **Error handling:** Deploy with invalid domain → verify retry with backoff, no crash loop

### Notes

- The `certbot-webroot` named volume is used for two purposes: ACME challenge files and the reload flag file. It is ephemeral and does not need to be persisted.
- The `certbot-etc` named volume persists Let's Encrypt account state and renewal configurations across container restarts.
- Let's Encrypt certificates are valid for 90 days. The 30-day check in the entrypoint ensures renewal happens well before expiry.
- `nginx -s reload` reloads the configuration AND picks up new certificate files on disk — no restart required.
- No Docker socket is mounted in the certbot container — reload signaling uses the shared webroot volume flag file. This avoids exposing the Docker socket (which would allow inspecting all container environment variables).
- Future consideration: support for DNS-01 challenge (would allow wildcard certs and avoid port 80 requirement)

### Adversarial Review Resolution

13 findings were identified during adversarial review. All resolved:

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| F1 | Critical | nginx `~ /\.` deny rule blocks ACME | Downgrade — rule is in port 443 block only, ACME on port 80 |
| F2 | Critical | Bind mounts break certbot internal symlinks | Named volume `certbot-etc:/etc/letsencrypt` + entrypoint copies to `./secrets/ssl/` |
| F3 | Critical | `docker compose kill` won't work from inside certbot | Removed Docker socket entirely — flag file for both modes |
| F4 | Critical | Port 80 `return 301` is server-level, blocks location match | Restructured: `location /.well-known/acme-challenge/` + `location /` redirect |
| F5 | Critical | `certbot/certbot` image doesn't include cron | Shell loop (no cron, no custom Dockerfile) |
| F6 | Critical | `exec nginx` orphans background polling loop | nginx in background + loop in foreground with PID check |
| F7 | High | No error handling, crash loop on failure | Retry with exponential backoff (30s/60s/120s), wait for next cycle |
| F8 | High | Docker socket exposes all container env vars | Resolved by F3 — no Docker socket |
| F9 | High | 5 min window to serve expired cert | Acceptable — certbot renew is idempotent, 90-day validity |
| F10 | High | nginx reload may not pick up new certs | `nginx -s reload` does reload certs from disk — no restart needed |
| F11 | Medium | Spec references `${DEPLOY_OPEA:-0}` but pattern is `${DEPLOY_OPEA:-1}` | Corrected in codebase patterns section |
| F12 | Medium | Contradiction: bind mount vs named volume for webroot | Unified to named volume `certbot-webroot` |
| F13 | Medium | Imprecise env line reference | Removed specific line numbers, references Section 7 |

### Implementation Review Resolution

5 patch findings were identified during implementation review. All resolved:

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| P1 | Critical | No SIGTERM trap — nginx killed ungracefully | Added `trap 'kill $NGINX_PID; wait; exit' TERM INT QUIT` |
| P2 | Critical | Flag file never cleaned (nginx `ro` volume) | Certbot cleans flag after 60s via background subshell |
| P3 | High | `set -e` + `request_certificate` return 1 → crash loop | `request_certificate \|\| true` at initial call |
| P4 | Medium | `certbot renew --quiet` suppresses diagnostics | Removed `--quiet`, kept `2>&1` for log capture |
| P5 | Low | Stale flag file from previous crash | Flag self-cleans after 60s (P2 resolution) |

## Suggested Review Order

**Certbot entrypoint — certificate lifecycle**

- Validation, staging flag, and command construction
  [`entrypoint.sh:12`](../../api-gateway-solution/certbot/entrypoint.sh#L12)

- Bootstrap: skip valid certs, request with exponential backoff
  [`entrypoint.sh:82`](../../api-gateway-solution/certbot/entrypoint.sh#L82)

- Flag file cleanup: certbot removes after 60s (nginx has `ro` mount)
  [`entrypoint.sh:74`](../../api-gateway-solution/certbot/entrypoint.sh#L74)

- Renewal loop: `set -e`-safe with `copy_certs || echo` fallback
  [`entrypoint.sh:131`](../../api-gateway-solution/certbot/entrypoint.sh#L131)

**Nginx config — ACME routing**

- Port 80 restructured: ACME location before HTTPS redirect
  [`default.conf.template:8`](../../api-gateway-solution/nginx/conf/default.conf.template#L8)

**Nginx entrypoint — reload mechanism**

- Signal trap for graceful shutdown of nginx child process
  [`entrypoint.sh:90`](../../api-gateway-solution/nginx/entrypoint.sh#L90)

- Flag-check loop with read-only flag consumption (no `rm`)
  [`entrypoint.sh:100`](../../api-gateway-solution/nginx/entrypoint.sh#L100)

**Docker Compose — service wiring**

- Certbot service: profiles + replicas dual-mode, volumes, placement
  [`docker-compose.yaml:244`](../../docker-compose.yaml#L244)

- Named volumes: `certbot-webroot` (shared IPC) and `certbot-etc` (state)
  [`docker-compose.yaml:52`](../../docker-compose.yaml#L52)

- Nginx volume: `certbot-webroot:ro` for ACME + flag reads
  [`docker-compose.yaml:224`](../../docker-compose.yaml#L224)

**Configuration and documentation**

- Env template: CERTBOT_EMAIL, CERTBOT_REPLICAS, CERTBOT_STAGING
  [`env:248`](../../env#L248)

- Secrets README: Let's Encrypt activation guide
  [`README.md:37`](../../secrets/README.md#L37)

- Docker Compose setup: Option C for Let's Encrypt
  [`docker-compose-setup.md:100`](../../site/content/en/docs/deployment/docker-compose-setup.md#L100)

- Docker Swarm setup: Let's Encrypt in Step 7
  [`docker-swarm-setup.md:325`](../../site/content/en/docs/deployment/docker-swarm-setup.md#L325)
