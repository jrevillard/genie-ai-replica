\# Kong and NGINX Configuration Guide



This README provides documentation on using the provided scripts to manage and configure Kong (an API gateway) for a Node.js Express backend, and how to set up NGINX as a reverse proxy to route requests correctly between a Vue 3 frontend application and the Express server. The setup assumes a containerized or local environment where Kong is running on `localhost:8001` (Admin API) and `localhost:8000` (Proxy), the Vue app is served on port 8090, and the Express API is on port 3000.



Additionally, this guide includes documentation for the `docker-compose.yaml` file, which orchestrates the deployment of the entire stack, including Kong, databases, Keycloak for authentication, NGINX, and OWASP ZAP for security testing.



\## Introduction



\- \*\*Kong\*\*: Used as an API gateway to handle routing, authentication (e.g., JWT), rate limiting, CORS, logging, and other plugins for the Express API endpoints under `/api`.

\- \*\*NGINX\*\*: Acts as the entry point, handling HTTPS termination, security headers, WebSocket proxying, and routing:

&nbsp; - Frontend (Vue 3 app) at `/` (proxied to `http://e2e-109-51:8090`).

&nbsp; - Backend API at `/api/` (proxied through Kong at `http://kong:8000/api/`).

\- Scripts automate Kong backups, restores, applies, and rate-limiting management.

\- Configuration files include JSON for Kong and `.conf` files for NGINX.

\- \*\*Docker Compose\*\*: Manages the containerized services for the full environment.



The system is designed for a production-like setup with security best practices (e.g., CSP, HSTS, CORS).



\## Prerequisites



\- Docker and Docker Compose installed.

\- Tools: `curl`, `jq` (for JSON parsing), `bash`.

\- Environment variables (optional):

&nbsp; - `LOGIN\_PASSWORD`: For automated testing in `restore-kong-config.sh`.

\- Backup files: Stored in `kong\_backups/` directory.

\- Custom files: Ensure `./pg\_hba.conf`, `./kong\_logs`, `./nginx/conf`, `./nginx/certs` are present or created as needed.



\## Docker Compose Setup



The `docker-compose.yaml` file defines a multi-container application stack using Docker Compose version 3.8. It sets up a network (`kong-net`) and volumes for data persistence. This configuration integrates Kong as the API gateway, databases (Postgres and Mongo), Keycloak for identity management, NGINX as the reverse proxy, and OWASP ZAP for API security testing.



\### Key Services



\- \*\*kong-database\*\*: Postgres database for Kong.

&nbsp; - Image: `postgres:13`.

&nbsp; - Environment: User `kong`, DB `kong`, Password `k1ngk0ng`.

&nbsp; - Ports: `5432`.

&nbsp; - Volume: `kong\_data:/var/lib/postgresql/data`; mounts custom `pg\_hba.conf` for host-based authentication.

&nbsp; - Healthcheck: Ensures database readiness.



\- \*\*kong\*\*: Kong API gateway.

&nbsp; - Image: `kong:latest`.

&nbsp; - Depends on: `kong-database`.

&nbsp; - Environment: Connects to Postgres; logs to stdout/stderr.

&nbsp; - Ports: `8000` (proxy), `8443` (HTTPS proxy), `8001` (admin API).

&nbsp; - Volume: `./kong\_logs` for logs.



\- \*\*konga\*\*: Web UI for managing Kong.

&nbsp; - Image: `pantsel/konga:0.14.9`.

&nbsp; - Depends on: `kong`, `mongo`.

&nbsp; - Environment: Production mode, Mongo DB connection, token secret, Kong admin URL.

&nbsp; - Ports: `1337`.



\- \*\*mongo\*\*: MongoDB for Konga.

&nbsp; - Image: `mongo:4.4`.

&nbsp; - Volume: `mongo\_data`.

&nbsp; - Ports: `27017`.



\- \*\*keycloak\*\*: Keycloak identity and access management.

&nbsp; - Image: `quay.io/keycloak/keycloak:latest`.

&nbsp; - Depends on: `keycloak-db`.

&nbsp; - Command: Builds and starts in optimized mode.

&nbsp; - Environment: Postgres connection, admin credentials (`admin`/`adminpassword`), HTTP enabled.

&nbsp; - Ports: `8080`.



\- \*\*keycloak-db\*\*: Postgres database for Keycloak.

&nbsp; - Image: `postgres:15`.

&nbsp; - Environment: DB `keycloak`, User `keycloak`, Password `keycloakpassword`.

&nbsp; - Volume: `keycloak\_data`.



\- \*\*nginx\*\*: NGINX reverse proxy.

&nbsp; - Image: `nginx:latest`.

&nbsp; - Ports: `80` (HTTP), `443` (HTTPS).

&nbsp; - Volumes: `./nginx/conf` for configs, `./nginx/certs` for SSL certs, `nginx\_conf` and `nginx\_certs` for additional persistence.

&nbsp; - Depends on: `kong`.



\- \*\*zap\*\*: OWASP ZAP for automated security testing.

&nbsp; - Image: `ghcr.io/zaproxy/zaproxy:stable`.

&nbsp; - Ports: `8095` (mapped to internal 8080).

&nbsp; - Volume: `zap\_data` for working directory.

&nbsp; - Command: Runs in daemon mode with API key disabled.



\### Networks and Volumes



\- \*\*Network\*\*: All services connected to `kong-net` (bridge driver) for internal communication.

\- \*\*Volumes\*\*: Persistent storage for databases (`kong\_data`, `mongo\_data`, `keycloak\_data`), NGINX configs/certs (`nginx\_conf`, `nginx\_certs`), ZAP data (`zap\_data`), and Kong logs.



\### Usage



1\. \*\*Start the Stack\*\*:

&nbsp;  ```bash

&nbsp;  docker-compose up -d

&nbsp;  ```

&nbsp;  - This starts all services in detached mode.

&nbsp;  - Wait for healthchecks (e.g., Kong database) to pass.



2\. \*\*Stop the Stack\*\*:

&nbsp;  ```bash

&nbsp;  docker-compose down

&nbsp;  ```

&nbsp;  - Add `-v` to remove volumes (data loss warning).



3\. \*\*Logs\*\*:

&nbsp;  ```bash

&nbsp;  docker-compose logs -f <service\_name>  # e.g., kong

&nbsp;  ```



4\. \*\*Access Points\*\*:

&nbsp;  - Kong Proxy: `http://localhost:8000`

&nbsp;  - Kong Admin API: `http://localhost:8001`

&nbsp;  - Konga UI: `http://localhost:1337`

&nbsp;  - Keycloak: `http://localhost:8080`

&nbsp;  - NGINX: `http://localhost:80` or `https://localhost:443`

&nbsp;  - ZAP: `http://localhost:8095` (API at `/UI/`)



5\. \*\*Configuration Notes\*\*:

&nbsp;  - Customize environment variables (e.g., passwords) in production.

&nbsp;  - Ensure `./pg\_hba.conf` allows necessary host-based access.

&nbsp;  - For Keycloak, initial setup via admin UI; bootstrap admin is `admin`/`adminpassword`.

&nbsp;  - NGINX mounts local configs and certs; generate self-signed certs if needed (e.g., via OpenSSL).

&nbsp;  - ZAP runs without API key for easy access; secure in production.



6\. \*\*Troubleshooting\*\*:

&nbsp;  - Check dependencies: Use `docker-compose ps` to verify service status.

&nbsp;  - Database issues: Ensure healthchecks pass; inspect logs.

&nbsp;  - Network: Services communicate via service names (e.g., `kong-database`).

&nbsp;  - Volumes: Persistent data survives restarts; backup volumes regularly.



This setup provides a complete, secure environment for developing and testing the API gateway with frontend/backend integration.



\## Kong Configuration Scripts



These scripts interact with Kong's Admin API (`http://localhost:8001`). They handle backups, applies, restores, and plugin management. Kong configs are in declarative JSON format (e.g., `kong\_config.json`).



\### 1. manage-kong-config.sh



This script backs up, applies, or fixes Kong configurations.



\- \*\*Usage\*\*: `./manage-kong-config.sh \[-b] \[-a] \[-f] \[-h]`

&nbsp; - `-b`: Backup current Kong config to `kong\_backups/kong\_backup\_<timestamp>.json`.

&nbsp; - `-a`: Apply config from `kong\_config.json` (creates/updates services, routes, plugins, upstreams, targets).

&nbsp; - `-f`: Fix auth routes (`/api/auth`, `/api/auth/login`, `/api/auth/refresh-token`) to bypass JWT and proxy directly to the backend.

&nbsp; - `-h`: Show help.



\- \*\*How it works\*\*:

&nbsp; - Backup: Fetches services, routes, plugins, upstreams, and targets via API and saves to JSON.

&nbsp; - Apply: Processes `kong\_config.json` to update/create entities (e.g., service `express-api`, routes like `api-fallback`, plugins like `rate-limiting`).

&nbsp; - Fix Auth: Removes JWT plugins from auth routes and ensures they exist without auth for login/refresh flows.

&nbsp; - Logs to `kong\_config.log`.



\- \*\*Example\*\*:

&nbsp; ```bash

&nbsp; ./manage-kong-config.sh -b  # Backup current config

&nbsp; ./manage-kong-config.sh -a  # Apply kong\_config.json

&nbsp; ./manage-kong-config.sh -f  # Fix auth routes

&nbsp; ```



\### 2. restore-kong-config.sh



Restores Kong config from a backup JSON file and optionally tests endpoints.



\- \*\*Usage\*\*: `./restore-kong-config.sh \[-b <backup\_file>] \[-t \[jwt\_token]] \[-h]`

&nbsp; - `-b <backup\_file>`: Path to backup JSON (required for restore).

&nbsp; - `-t \[jwt\_token]`: Test endpoints (prompts for credentials if no token; uses `LOGIN\_PASSWORD` env if set).

&nbsp; - `-h`: Show help.



\- \*\*How it works\*\*:

&nbsp; - Cleans up existing JWT plugins/credentials.

&nbsp; - Restores services, routes, plugins, upstreams from backup.

&nbsp; - Patches global rate-limiting plugin.

&nbsp; - Tests (if `-t`): Logs in (if needed), tests `/api/auth/logout`, `/api/users/admin/users/2133/force-logout`, `/api/service-categories?locale=en`.

&nbsp; - Logs to `kong\_restore.log`.



\- \*\*Example\*\*:

&nbsp; ```bash

&nbsp; ./restore-kong-config.sh -b kong\_backups/kong\_backup\_20250527\_162608.json  # Restore from backup

&nbsp; ./restore-kong-config.sh -t eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # Test with JWT token

&nbsp; ./restore-kong-config.sh -t  # Test and prompt for credentials

&nbsp; ```



\### 3. kong-rate-limit.sh



Manages the rate-limiting plugin (ID: `13e146bb-0dff-4bfa-a9ca-95b8189ffb03`) on service `express-api`.



\- \*\*Usage\*\*: `./kong-rate-limit.sh {disable|enable|status}`

&nbsp; - `disable`: Disable the plugin.

&nbsp; - `enable`: Enable the plugin.

&nbsp; - `status`: Check current config (limits, policy, enabled state).



\- \*\*How it works\*\*:

&nbsp; - Patches plugin enabled state via API.

&nbsp; - Formats responses with `python3 -m json.tool`.



\- \*\*Example\*\*:

&nbsp; ```bash

&nbsp; ./kong-rate-limit.sh status   # View current rate limits (e.g., 1000/min, 10000/hour)

&nbsp; ./kong-rate-limit.sh disable  # Disable rate limiting

&nbsp; ```



\## NGINX Configuration



NGINX handles external traffic, enforces security, and routes requests. Config files: `default.conf` (main server block) and `security-headers.conf` (shared headers).



\### Setup



1\. Place `default.conf` in `/etc/nginx/conf.d/` (or include it in `nginx.conf`).

2\. Place `security-headers.conf` in `/etc/nginx/conf.d/`.

3\. Ensure SSL certs are in `/etc/nginx/certs/`.

4\. Reload NGINX: `nginx -s reload`.



\### Key Configuration Details



\- \*\*HTTP to HTTPS Redirect\*\*: All HTTP (port 80) redirects to HTTPS (port 443).

\- \*\*SSL/TLS\*\*: Uses modern ciphers, session caching, and provided certs.

\- \*\*Security Headers\*\*: Included via `security-headers.conf`:

&nbsp; - X-Content-Type-Options, X-Frame-Options, X-XSS-Protection.

&nbsp; - Strict-Transport-Security (HSTS with preload).

&nbsp; - Referrer-Policy, Permissions-Policy.

&nbsp; - Comprehensive CSP (Content Security Policy) allowing specific sources (e.g., self, cdnjs for styles/scripts, WebSockets).

&nbsp; - CORS: Restricted to `https://e2e-82-109.ssdcloudindia.net`.

&nbsp; - Hides server info (X-Powered-By, Server).



\- \*\*Routing\*\*:

&nbsp; - `/ws`: Proxies WebSockets to `http://e2e-109-51:8090/ws` (Vue app, clears compression extensions).

&nbsp; - `/Uploads/`: Serves uploads with strict security headers.

&nbsp; - `/\*.txt|xml` (e.g., robots.txt): Cached with headers.

&nbsp; - `/`: Proxies to Vue 3 app (`http://e2e-109-51:8090`), with WebSocket support and custom Host header (`genie-ai.itu.int`). CSP allows WebSockets and fonts.

&nbsp; - `/api/`: Proxies to Kong (`http://kong:8000/api/`), handles OPTIONS (CORS preflight), timeouts (300s+). CSP is stricter for API.



\- \*\*Blocking\*\*:

&nbsp; - Denies access to dotfiles (e.g., `.git`) and sensitive paths.



\### Example NGINX Config Snippet (from default.conf)



```nginx

server {

&nbsp;   listen 443 ssl;

&nbsp;   server\_name \_;



&nbsp;   ssl\_certificate /etc/nginx/certs/server.crt;

&nbsp;   ssl\_certificate\_key /etc/nginx/certs/server.key;



&nbsp;   include conf.d/security-headers.conf;



&nbsp;   location / {

&nbsp;       proxy\_pass http://e2e-109-51:8090;

&nbsp;       # ... (proxy settings, CSP overrides)

&nbsp;   }



&nbsp;   location /api/ {

&nbsp;       proxy\_pass http://kong:8000/api/;

&nbsp;       # ... (CORS, timeouts, CSP)

&nbsp;   }

}

```



\## Usage Examples



1\. \*\*Full Kong Setup\*\*:

&nbsp;  ```bash

&nbsp;  ./manage-kong-config.sh -b  # Backup current config

&nbsp;  ./manage-kong-config.sh -a  # Apply kong\_config.json

&nbsp;  ./manage-kong-config.sh -f  # Fix auth routes

&nbsp;  ```



2\. \*\*Restore and Test\*\*:

&nbsp;  ```bash

&nbsp;  ./restore-kong-config.sh -b <backup.json>  # Restore from backup

&nbsp;  ./restore-kong-config.sh -t  # Test and prompt for credentials

&nbsp;  ```



3\. \*\*NGINX Routing Test\*\*:

&nbsp;  - Access frontend: `https://e2e-82-109.ssdcloudindia.net/` (should load Vue app).

&nbsp;  - API call: `curl https://e2e-82-109.ssdcloudindia.net/api/auth/login` (proxied via Kong to Express).



\## Logs



\- Kong scripts log to `kong\_config.log` and `kong\_restore.log`.

\- Review for errors (e.g., HTTP 400/404 during apply/restore).



\## Troubleshooting



\- \*\*Kong API Errors\*\*: Ensure Kong is running and Admin API is accessible. Check logs for schema violations.

\- \*\*NGINX Errors\*\*: Verify cert paths, reload NGINX, check `/var/log/nginx/error.log`. Test CSP with browser dev tools.

\- \*\*JWT/Auth Issues\*\*: Use `-f` in `manage-kong-config.sh` to bypass for login routes.

\- \*\*Timeouts\*\*: Adjust proxy timeouts if requests hang.

\- \*\*CORS/CSP Blocks\*\*: Inspect browser console; adjust origins/sources in configs.

\- \*\*Docker Issues\*\*: Check `docker-compose logs` for startup errors; ensure ports are free; verify volume mounts.



For questions, refer to Kong docs (konghq.com) or NGINX docs (nginx.org).

