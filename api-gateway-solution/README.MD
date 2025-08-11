\# Kong and NGINX Configuration Guide



This README provides documentation on using the provided scripts to manage and configure Kong (an API gateway) for a Node.js Express backend, and how to set up NGINX as a reverse proxy to route requests correctly between a Vue 3 frontend application and the Express server. The setup assumes a containerized or local environment where Kong is running on `localhost:8001` (Admin API) and `localhost:8000` (Proxy), the Vue app is served on port 8090, and the Express API is on port 3000.



\## Introduction



\- \*\*Kong\*\*: Used as an API gateway to handle routing, authentication (e.g., JWT), rate limiting, CORS, logging, and other plugins for the Express API endpoints under `/api`.

\- \*\*NGINX\*\*: Acts as the entry point, handling HTTPS termination, security headers, WebSocket proxying, and routing:

&nbsp; - Frontend (Vue 3 app) at `/` (proxied to `http://e2e-109-51:8090`).

&nbsp; - Backend API at `/api/` (proxied through Kong at `http://kong:8000/api/`).

\- Scripts automate Kong backups, restores, applies, and rate-limiting management.

\- Configuration files include JSON for Kong and `.conf` files for NGINX.



The system is designed for a production-like setup with security best practices (e.g., CSP, HSTS, CORS).



\## Prerequisites



\- Docker or local setup with:

&nbsp; - Kong running (e.g., via Docker Compose).

&nbsp; - Node.js Express server on `e2e-109-51:3000`.

&nbsp; - Vue 3 app on `e2e-109-51:8090`.

&nbsp; - NGINX with access to certs (`/etc/nginx/certs/server.crt` and `.key`).

\- Tools: `curl`, `jq` (for JSON parsing), `bash`.

\- Environment variables (optional):

&nbsp; - `LOGIN\_PASSWORD`: For automated testing in `restore-kong-config.sh`.

\- Backup files: Stored in `kong\_backups/` directory.



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

&nbsp; ```

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

&nbsp; ```

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

&nbsp; ```

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

&nbsp;  - Backup current: `./manage-kong-config.sh -b`

&nbsp;  - Apply new: `./manage-kong-config.sh -a`

&nbsp;  - Fix auth: `./manage-kong-config.sh -f`

&nbsp;  - Check rate limits: `./kong-rate-limit.sh status`



2\. \*\*Restore and Test\*\*:

&nbsp;  - Restore: `./restore-kong-config.sh -b <backup.json>`

&nbsp;  - Test: `./restore-kong-config.sh -t`



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



For questions, refer to Kong docs (konghq.com) or NGINX docs (nginx.org).

