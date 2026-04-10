# Kong and NGINX Configuration Guide

This README provides documentation on using the provided scripts to manage and configure Kong (an API gateway) for a Node.js Express backend, and how to set up NGINX as a reverse proxy to route requests correctly between a Vue 3 frontend application and the Express server. The setup assumes a containerized environment where Kong is internal-only (not exposed to host), the Vue app is served on port 8090, and the Express API is on port 3000.

The API gateway services (Kong, NGINX, Kong database) are defined in the root `docker-compose.yaml` as part of the full GENIE.AI stack.

## Introduction

- **Kong**: Used as an API gateway to handle routing, authentication (e.g., JWT), rate limiting, CORS, logging, and other plugins for the Express API endpoints under `/api`.
- **NGINX**: Acts as the entry point, handling HTTPS termination, security headers, WebSocket proxying, and routing:
  - Frontend (Vue 3 app) at `/` (proxied to `${NGINX_FRONTEND_HOST}:${NGINX_FRONTEND_PORT}`).
  - Backend API at `/api/` (proxied through Kong at `http://${KONG_PROXY_HOST}:8000/api/`).
- Scripts automate Kong backups, restores, applies, and plugin management.
- Configuration files include JSON for Kong and `.conf.template` files for NGINX.
- **Docker Compose**: Manages the containerized services from the project root.

The system is designed for a production-like setup with security best practices (e.g., CSP, HSTS, CORS).

## Prerequisites

- Docker and Docker Compose installed.
- Tools: `curl`, `jq` (for JSON parsing), `bash`.
- Environment variables configured in root `.env` file (see `env` template).
- Custom files: `./pg_hba.conf` (Kong Postgres host-based authentication), `./nginx/conf/` (NGINX templates).

## Docker Compose Setup

The API gateway services are defined in the root `docker-compose.yaml` (not a standalone file in this directory). Deploy the full stack from the project root:

```bash
# From project root
cp env .env   # First time: create your .env
docker compose up -d
```

### API Gateway Services

- **kong-database**: Postgres database for Kong.
  - Image: `postgres:13`.
  - Environment: User `kong`, DB `kong`, Password from `POSTGRES_PASSWORD`.
  - Volume: `kong_data:/var/lib/postgresql/data`; mounts custom `pg_hba.conf`.
  - Healthcheck: Ensures database readiness.

- **kong**: Kong API gateway.
  - Image: `kong:latest`.
  - Depends on: `kong-database` (healthy), `kong-migrations` (completed).
  - Environment: Connects to Postgres via `POSTGRES_PASSWORD`; logs to stdout/stderr; `KONG_DNS_STALE_TTL=5` for DNS cache mitigation.
  - Healthcheck: `kong health` (built-in CLI, checks DB and internal services).
  - Ports: Internal only (not exposed to host). Proxy listens on `8000` (HTTP) / `8443` (HTTPS) within Docker network. Admin API on `0.0.0.0:8001` (internal only, used by kong-config service).
  - Volume: `./data/logs/kong` for logs.
  - Config applied automatically by the `kong-config` init service on startup.

- **kong-config**: Init container that applies Kong configuration.
  - Image: Built from `new-config/Dockerfile` (Alpine + curl + jq).
  - Depends on: `kong` (healthy).
  - Runs once on startup (`restart: "no"`), applies `kong_config.json` via Kong Admin API.
  - Idempotent — safe to re-run with `docker compose run kong-config`.
  - Logs: `docker compose logs kong-config`.

- **nginx**: NGINX reverse proxy.
  - Image: `nginx:latest`.
  - Ports: `80` (HTTP redirect), `443` (HTTPS).
  - Environment: `NGINX_PUBLIC_DOMAIN`, `CSP_CONNECT_SRC`, `KONG_PROXY_HOST`, `NGINX_FRONTEND_HOST`, `NGINX_FRONTEND_PORT`.
  - Volumes: `./nginx/conf` for templates, `./nginx/entrypoint.sh` for container startup.
  - SSL: Volume-mounted from `./secrets/ssl/server.crt` and `server.key` (auto-generated self-signed in dev if not provided).
  - Depends on: `kong`.

### Networks and Volumes

- **Network**: All services connected to `genieai_network` (bridge driver).
- **Volumes**: `kong_data` (Kong Postgres), `./data/logs/kong` (Kong logs).

### Usage

1. **Start the Stack**:
   ```bash
   docker compose up -d
   ```
   - Wait for healthchecks (e.g., Kong database) to pass.

2. **Stop the Stack**:
   ```bash
   docker compose down
   ```
   - Add `-v` to remove volumes (data loss warning).

3. **Logs**:
   ```bash
   docker compose logs -f <service_name>  # e.g., kong, nginx
   ```

4. **Access Points**:
   - NGINX (HTTPS): `https://localhost` or `https://${NGINX_PUBLIC_DOMAIN}`
   - NGINX (HTTP): `http://localhost` (redirects to HTTPS)
   - Kong Proxy: Internal only (`kong:8000` within Docker network)
   - Kong Admin API: Internal only (accessible via kong-config init container)

5. **Configuration Notes**:
   - Customize environment variables in `.env` (see `env` template, Section 7).
   - NGINX renders `default.conf.template` at container startup via `envsubst`.
   - SSL certs: auto-generated self-signed in development; use volume-mounted certificates for production (place in `./secrets/ssl/`).

6. **Troubleshooting**:
   - Check dependencies: Use `docker compose ps` to verify service status.
   - Database issues: Ensure healthchecks pass; inspect logs.
   - Network: Services communicate via Docker service names (e.g., `kong-database`, `kong`, `frontend`).

## Kong Configuration Scripts

These scripts interact with Kong's Admin API (`http://localhost:8001`) from within the Docker network. They handle backups, applies, restores, and plugin management. Kong configs are in declarative JSON format (e.g., `kong_config.json`).

### 1. manage-kong-config.sh

This script backs up, applies, or fixes Kong configurations.

- **Usage**: `./manage-kong-config.sh [-b] [-a] [-f] [-h]`
  - `-b`: Backup current Kong config to `kong_backups/kong_backup_<timestamp>.json` (directory auto-created).
  - `-a`: Apply config from `kong_config.json` (creates/updates services, routes, plugins, upstreams, targets).
  - `-f`: Fix auth routes (`/api/auth`, `/api/auth/login`, `/api/auth/refresh-token`) to bypass JWT and proxy directly to the backend.
  - `-h`: Show help.

- **How it works**:
  - Backup: Fetches services, routes, plugins, upstreams, and targets via API and saves to JSON.
  - Apply: Processes `kong_config.json` to update/create entities (e.g., service `express-api`, routes like `api-fallback`, plugins like `rate-limiting`).
  - Fix Auth: Removes JWT plugins from auth routes and ensures they exist without auth for login/refresh flows.
  - Logs to `kong_config.log`.

- **Example**:
  ```bash
  ./manage-kong-config.sh -b  # Backup current config
  ./manage-kong-config.sh -a  # Apply kong_config.json
  ./manage-kong-config.sh -f  # Fix auth routes
  ```

### 2. restore-kong-config.sh

Restores Kong config from a backup JSON file and optionally tests endpoints. Used by the `kong-config` init service for automatic configuration on startup.

- **POSIX-compliant** (`#!/bin/sh`) — runs under busybox ash (Alpine).
- **Default `-b` path**: `/opt/kong-config/kong_config.json` (inside the init container).
- **Wait/retry**: Waits up to 60 seconds for Kong Admin API to respond before applying config.
- **Usage**: `./restore-kong-config.sh [-b <backup_file>] [-t [jwt_token]] [-h]`
  - `-b <backup_file>`: Path to backup JSON (optional, default: `/opt/kong-config/kong_config.json`).
  - `-t [jwt_token]`: Test endpoints (prompts for credentials if no token; uses `LOGIN_PASSWORD` env if set).
  - `-h`: Show help.

- **How it works**:
  - Waits for Kong Admin API readiness (60s timeout with 2s retries).
  - Cleans up existing JWT plugins/credentials.
  - Restores services, routes, plugins, upstreams from backup.
  - Patches global rate-limiting plugin.
  - Tests (if `-t`): Logs in (if needed), tests `/api/auth/logout`, `/api/users/admin/users/$USER_ID/force-logout` (default: 1), `/api/service-categories?locale=en`.
  - Logs to stdout (captured by Docker via `docker compose logs kong-config`).

- **Example**:
  ```bash
  ./restore-kong-config.sh -b <path-to-backup.json>  # Restore from backup
  ./restore-kong-config.sh                             # Uses default path
  ./restore-kong-config.sh -t eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Test with JWT token
  ./restore-kong-config.sh -t  # Test and prompt for credentials
  ```

### 3. manage-kong-config.sh (standalone interactive tool)

This script is a standalone interactive utility for managing Kong configurations. It is **not used** in the automated deployment (the `kong-config` init service uses `restore-kong-config.sh` instead).

## NGINX Configuration

NGINX handles external traffic, enforces security, and routes requests. Config files: `default.conf.template` (source of truth, rendered to `default.conf` at container start) and `security-headers.conf` (shared headers).

### SSL Certificates (Volume-Mounted)

**IMPORTANT**: SSL certificates are volume-mounted from `./secrets/ssl/` into the container.

#### Development (Self-Signed)

The nginx container automatically generates self-signed certificates on startup if no certificates are found at `./secrets/ssl/`. No manual setup required.

#### Production (Volume Mounts)

For production, place SSL certificates in `./secrets/ssl/`:

```bash
cp /path/to/production/certs/server.crt ./secrets/ssl/
cp /path/to/production/certs/server.key ./secrets/ssl/
```

The nginx entrypoint loads these files from `/etc/nginx/ssl/` inside the container and copies them to `/etc/nginx/certs/` for nginx to use.

#### Certificate Sources:
- Let's Encrypt (certbot)
- Your organization's PKI
- Cloud provider SSL services (AWS ACM, GCP Cert Manager, Azure Key Vault)

### Setup

1. Place `default.conf.template` in `/etc/nginx/conf.d/` (or include it in `nginx.conf`).
2. Place `security-headers.conf` in `/etc/nginx/conf.d/`.
3. SSL certs are provided via volume mounts from `./secrets/ssl/` (auto-generated in development).
4. Reload NGINX: `nginx -s reload`.

### Key Configuration Details

- **HTTP to HTTPS Redirect**: All HTTP (port 80) redirects to HTTPS (port 443).
- **SSL/TLS**: Uses modern ciphers, session caching, and volume-mounted certificates (auto-generated in development if not provided).
- **Security Headers**: Included via `security-headers.conf`:
  - X-Content-Type-Options, X-Frame-Options, X-XSS-Protection.
  - Strict-Transport-Security (HSTS with preload).
  - Referrer-Policy, Permissions-Policy.
  - Comprehensive CSP (Content Security Policy) allowing specific sources (e.g., self, cdnjs for styles/scripts, WebSockets).
  - CORS: Restricted to `https://${NGINX_PUBLIC_DOMAIN}`.
  - Hides server info (X-Powered-By, Server).

- **Routing**:
  - `/Uploads/`: Serves uploads with strict security headers.
  - `/*.txt|xml` (e.g., robots.txt): Cached with headers.
  - `/`: Proxies to Vue 3 app (`http://${NGINX_FRONTEND_HOST}:${NGINX_FRONTEND_PORT}`), with WebSocket support and custom Host header (`${NGINX_PUBLIC_DOMAIN}`). CSP allows WebSockets and fonts.
  - `/api/`: Proxies to Kong (`http://${KONG_PROXY_HOST}:8000/api/`), handles OPTIONS (CORS preflight), timeouts (300s+). CSP is stricter for API.

- **Blocking**:
  - Denies access to dotfiles (e.g., `.git`) and sensitive paths.

### Example NGINX Config Snippet (from default.conf.template)

```nginx
server {
    listen 443 ssl;
    server_name _;

    ssl_certificate /etc/nginx/certs/server.crt;
    ssl_certificate_key /etc/nginx/certs/server.key;

    include conf.d/security-headers.conf;

    location / {
        proxy_pass http://${NGINX_FRONTEND_HOST}:${NGINX_FRONTEND_PORT};
        # ... (proxy settings, CSP overrides)
    }

    location /api/ {
        proxy_pass http://${KONG_PROXY_HOST}:8000/api/;
        # ... (CORS, timeouts, CSP)
    }
}
```

## Usage Examples

1. **Full Kong Setup**:
   ```bash
   ./manage-kong-config.sh -b  # Backup current config
   ./manage-kong-config.sh -a  # Apply kong_config.json
   ./manage-kong-config.sh -f  # Fix auth routes
   ```

2. **Restore and Test**:
   ```bash
   ./restore-kong-config.sh -b <backup.json>  # Restore from backup
   ./restore-kong-config.sh -t  # Test and prompt for credentials
   ```

3. **NGINX Routing Test**:
   - Access frontend: `https://${NGINX_PUBLIC_DOMAIN}/` (should load Vue app).
   - API call: `curl https://${NGINX_PUBLIC_DOMAIN}/api/auth/login` (proxied via Kong to Express).

## Logs

- Kong scripts output to stdout/stderr (captured by Docker).
- `docker compose logs kong-config` — init service configuration logs.
- `docker compose logs kong` — Kong proxy and admin API logs.
- `docker compose logs nginx` — NGINX access and error logs.
- Review for errors (e.g., HTTP 400/404 during apply/restore).

## Troubleshooting

- **Kong API Errors**: Ensure Kong is running and Admin API is accessible. Check logs for schema violations.
- **NGINX Errors**: Verify cert paths, reload NGINX, check `/var/log/nginx/error.log`. Test CSP with browser dev tools.
- **JWT/Auth Issues**: Use `-f` in `manage-kong-config.sh` to bypass for login routes.
- **Timeouts**: Adjust proxy timeouts if requests hang.
- **CORS/CSP Blocks**: Inspect browser console; adjust origins/sources in configs.
- **502 after backend recreate**: Wait up to 5 seconds (DNS stale TTL) or run `docker exec <kong-container> kong reload` for immediate DNS flush.
- **Docker Issues**: Check `docker-compose logs` for startup errors; ensure ports are free; verify volume mounts.

For questions, refer to Kong docs (konghq.com) or NGINX docs (nginx.org).