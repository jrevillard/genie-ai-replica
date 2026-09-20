---
title: "Docker Compose Setup"
description: "Single-host Docker Compose deployment of GENIE.AI: configuration, profiles, operations, and verification."
weight: 2
section: "deploy"
aliases:
  - /docs/deployment/docker-compose-setup/
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

This guide covers local single-node deployment with `docker compose up`. For
production multi-node deployments see
[Docker Swarm Setup](/docs/deploy/docker-swarm-setup/).

GENIE.AI uses a single dual-mode `docker-compose.yaml` at the project root
that works with both `docker compose up` and `docker stack deploy`. Compose is
the fastest path to a working stack for development, testing, and small
single-host production deployments.

## Prerequisites

- **Docker Engine 23+** with Compose v2 (`docker compose` subcommand)
- **NVIDIA Container Toolkit** (only if using `--profile opea` with GPU)
- **Hugging Face API token** (only if using `--profile opea` — set
  `HUGGING_FACE_HUB_TOKEN` in `.env`)

For full system context, see
[Architecture Overview](/docs/architecture/architecture/).

## Container startup order

```mermaid
flowchart TD
    PG[PostgreSQL] --> KM[kong-migrations]
    PG --> KONG[Kong]
    KM --> KONG
    KONG --> KW[kong-config]
    KC[Keycloak] --> KC0[keycloak-config]
    ADB[ArangoDB] --> BE[Backend]
    ADB --> DR[Document Repository]
    ADB --> DBM[db-migrations]
    DBM --> BE
    RDS[Redis] --> BE
    KC0 --> BE
    KC0 --> DR
    FE[Frontend] --> NG[NGINX]
    KONG --> NG

    %% Always-on admin-logs substrate (no profile — runs regardless of ENABLE_OBSERVABILITY)
    OTEL[OTel Collector] -.always-on.-|> NG
    VL[(VictoriaLogs)] -.always-on.-|> OTEL

    %% Profile-gated services
    CQ[ChatQnA] -.profile opea.-|> BE
    OPEA[OPEA services] -.profile opea.-|> ADB
    GPU[GPU models] -.profile gpu-models.-|> OPEA
    VM[VictoriaMetrics +<br/>VictoriaTraces +<br/>tempo-proxy + Grafana] -.profile observability.-|> OTEL
```

Solid arrows = hard `depends_on` startup order. Dotted arrows = profile-gated
or always-on auxiliary services (see legend inside the diagram). NGINX is the
only host-published port (80/443); everything else stays on the internal network.

> **Note**: The OTel Collector and VictoriaLogs run as an **always-on
> substrate** (no profile label). They ingest container logs from every service
> via the `fluentd` logging driver and power the admin log endpoints. The
> `observability` profile only adds the optional metrics/traces storage
> (VictoriaMetrics + VictoriaTraces + tempo-proxy) and Grafana. See
> [Admin Logs](/docs/operate/admin-logs/).

## Profiles at a glance

Four compose profiles control which optional services start. The **core stack**
is always on (no profile needed); profile services add optional capabilities
on top of it.

| Profile | Command | Services added on top of core |
|---|---|---|
| **Core** (always on) | `docker compose up -d` | Frontend, Backend, ArangoDB, Redis, Document Repository, ClamAV, Keycloak, Kong, NGINX, PostgreSQL, the one-shots (`db-migrations`, `kong-migrations`, `kong-config`, `keycloak-config`, `postgres-init`) |
| **Admin-logs substrate** (always on) | _(no flag)_ | OTel Collector + VictoriaLogs + `otel-collector-init` — ingest container logs from every service via the `fluentd` driver. Powers admin log endpoints regardless of `ENABLE_OBSERVABILITY` |
| **OPEA** (`opea`) | `--profile opea` | Adds ChatQnA (`chatqna-xeon-backend-server`), Retriever (`retriever-arango-service`), Dataprep (`dataprep-arango-service`), Embedding, Reranker, Translation, Guardrail, TextGen. Also adds `chatqna-xeon-ui-server` and `chatqna-xeon-nginx-server`; in compose mode both start under this profile but are unused by the GENIE.AI stack, in Swarm they are pinned to `replicas: 0` (disabled). |
| **GPU models** (`gpu-models`) | `--profile gpu-models` | Adds vLLM, vLLM translation guardrail, TEI embedding, TEI reranker — the GPU-heavy containers. Pair with `--profile opea` for a local RAG stack. |
| **Observability** (`observability`) | `--profile observability` | Adds VictoriaMetrics, VictoriaTraces, tempo-proxy, Grafana — optional metrics/traces storage and dashboards on top of the always-on log substrate. |
| **Let's Encrypt** (`letsencrypt`) | `--profile letsencrypt` | Adds certbot for automatic TLS certificate provisioning and renewal on a public FQDN. |

The OPEA orchestrators and the GPU models are split into two profiles so you
can run the orchestrators locally and point them at a remote GPU node (see
[Remote GPU Node](#remote-gpu-node-optional)).

## Step 1: Clone the repository

```bash
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai
```

If your organization runs a fork or mirror, replace the URL accordingly.

## Step 2: Prepare directories

```bash
mkdir -p data/logs/kong data/logs/backend data/logs/doc-repo \
         data/database_backups secrets/ssl
```

| Directory | Purpose |
|---|---|
| `data/logs/kong` | Kong gateway logs (bind mount) |
| `data/logs/backend` | Backend API logs (bind mount) |
| `data/logs/doc-repo` | Document Repository logs (bind mount) |
| `data/database_backups` | Backend DB dump output (bind mount) |
| `secrets/ssl` | SSL certificates — auto-generated self-signed cert if missing |

## Step 3: Configure `.env`

```bash
cp env .env
```

Generate strong passwords with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Edit `.env` and replace every secret. Required:

| Variable | Type | Required | Description |
|---|---|---|---|
| `ARANGO_PASSWORD` | secret | yes | ArangoDB root password |
| `TRANSLATION_CACHE_PASSWORD` | secret | yes | Redis cache password |
| `POSTGRES_PASSWORD` | secret | yes | PostgreSQL superuser password |
| `KONG_DB_PASSWORD` | secret | yes | Kong dedicated PG user (must differ from `POSTGRES_PASSWORD`) |
| `KEYCLOAK_DB_PASSWORD` | secret | yes | Keycloak dedicated PG user (must differ from `POSTGRES_PASSWORD`) |
| `KEYCLOAK_ADMIN_PASSWORD` | secret | yes | Keycloak master admin console password |
| `KEYCLOAK_CLIENT_SECRET` | secret | yes | OIDC client secret for `genie-app` |
| `KEYCLOAK_PROXY_CLIENT_SECRET` | secret | yes | Service-account secret for admin API proxy |
| `KC_DATAPREP_CLIENT_SECRET` | secret | yes | Dataprep service-account secret (`client_credentials` grant to `dataprep-service-client`) |
| `GENIE_ADMIN_PASSWORD` | secret | yes | Initial `genie-admin` user password in `genie` realm |
| `EMAIL_HOST` / `EMAIL_USER` / `EMAIL_PASSWORD` / `EMAIL_FROM` | secret | yes (for user verification emails) | SMTP credentials |

**Important:** `KONG_DB_PASSWORD` and `KEYCLOAK_DB_PASSWORD` must differ from
`POSTGRES_PASSWORD` — they protect dedicated PostgreSQL users.

For Gmail SMTP, use a 16-character **App Password** from
[https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
not your account password. The Gmail SMTP settings are:
`EMAIL_HOST=smtp.gmail.com`, `EMAIL_PORT=587`, `EMAIL_SECURE=false`.

Then set network/domain variables. For local development:

```bash
NGINX_PUBLIC_DOMAIN=localhost
VUE_APP_API_URL=https://localhost/api
CSP_CONNECT_SRC='self' https://localhost wss://localhost
VUE_APP_CSP_CONNECT_SRC='self' https://localhost wss://localhost
CORS_ALLOWED_ORIGINS=https://localhost
```

For a remote IP (e.g. `10.0.0.110`):

```bash
NGINX_PUBLIC_DOMAIN=10.0.0.110
VUE_APP_API_URL=https://10.0.0.110/api
CSP_CONNECT_SRC='self' https://10.0.0.110 wss://10.0.0.110
VUE_APP_CSP_CONNECT_SRC='self' https://10.0.0.110 wss://10.0.0.110
CORS_ALLOWED_ORIGINS=https://10.0.0.110
```

> **Why this matters:** the frontend reads `VUE_APP_API_URL` at runtime from
> `window.APP_CONFIG` (generated by `docker-entrypoint.sh`). Changing the
> domain or IP only requires updating `.env` and redeploying — no image rebuild
> needed.

For OPEA/GPU services, also set:

```bash
HUGGING_FACE_HUB_TOKEN=<hf-token>
```

For observability (optional):

```bash
ENABLE_OBSERVABILITY=1
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<strong-password>
KC_GRAFANA_CLIENT_ID=grafana
KC_GRAFANA_CLIENT_SECRET=<strong-secret>
```

**Note:** `ENABLE_OBSERVABILITY` must be `0` or `1`, not `true` / `false`.

See the `env` template for the full variable list with comments.

## Step 4: SSL certificates

SSL certificates are optional. The NGINX container auto-generates self-signed
certificates on startup if none are found at `secrets/ssl/`.

### Option A — self-signed (default, dev only)

Do nothing. Self-signed certs are generated on first start. Browser warnings
are expected.

### Option B — manual certificates

```bash
cp /path/to/server.crt secrets/ssl/
cp /path/to/server.key secrets/ssl/
```

### Option C — Let's Encrypt (automatic)

For automatic provisioning and renewal on a public FQDN:

1. Set `CERTBOT_EMAIL` in `.env`:
   ```bash
   CERTBOT_EMAIL=your-email@example.com
   ```
2. Set `NGINX_PUBLIC_DOMAIN` to your public FQDN (not `localhost`).
3. Deploy with the `letsencrypt` profile:
   ```bash
   docker compose --profile letsencrypt up -d
   ```

Certbot obtains, writes to `secrets/ssl/`, and renews every 12 hours; nginx
reloads automatically. Set `CERTBOT_STAGING=true` in `.env` to use the
staging server (avoids Let's Encrypt rate limits while testing).

**Prerequisites:** port 80 reachable from the internet, DNS A/AAAA record for
the FQDN pointing to your host.

## Step 5: Build images (optional)

The compose file includes `build:` directives alongside `image:` for all custom
services. The published images on the GitLab Container Registry are built by
CI; for local development you can build them yourself:

```bash
# Build all custom images
docker compose build

# Or a specific service
docker compose build backend
```

For OPEA services (only if using `--profile opea`):

```bash
docker compose --profile opea --profile gpu-models build
```

## Step 6: Deploy

### 6a. Validate the configuration

```bash
docker compose config > /dev/null
```

Fix any errors before proceeding. This catches missing variables and syntax
issues early.

### 6b. Core services only

```bash
docker compose up -d
```

Starts: Frontend, Backend, ArangoDB, Redis, Document Repository, ClamAV, Kong,
NGINX, Keycloak, PostgreSQL.

### 6c. Full RAG stack with OPEA (local GPU)

```bash
docker compose --profile opea --profile gpu-models up -d
```

### 6d. With GPU-specific settings

For an NVIDIA T4 (16 GB):

```bash
docker compose --env-file .env --env-file env.t4 \
  --profile opea --profile gpu-models up -d
```

For an RTX 6000 ADA (24 GB):

```bash
docker compose --env-file .env --env-file env.rtx6000 \
  --profile opea --profile gpu-models up -d
```

See [GPU Deployment](/docs/deploy/gpu/) for variable details.

### 6e. Remote GPU node (optional)

GENIE.AI can connect to a dedicated GPU node for AI services while the app
stack runs on a separate host. The GPU node ships pre-configured (see
[Docker Swarm Setup → Remote GPU Node](/docs/deploy/docker-swarm-setup/#remote-gpu-node)).

Set in `.env` on the **app node**:

```bash
GPU_NODE_HOST=<gpu-node-host>       # GPU node IP or hostname
VLLM_API_KEY=<your-api-key>         # API key from the GPU node administrator
OPEA_SSL_SKIP_VERIFY=1              # only if GPU node uses self-signed certs
```

Then deploy the orchestrators only (GPU model containers are skipped):

```bash
docker compose --profile opea up -d
```

`GPU_MODEL_REPLICAS=0` is set automatically when `GPU_NODE_HOST` is non-empty.
Do **not** set `DEPLOY_OPEA=0` — that disables the orchestrators and breaks
the RAG pipeline.

### 6f. Observability stack

```bash
docker compose --profile observability up -d
```

Combine with OPEA:

```bash
docker compose --profile opea --profile gpu-models --profile observability up -d
```

All services use the `fluentd` logging driver to forward container logs to the
OTel Collector's `fluent_forward` receiver on port 24224 (localhost only).
Docker dual logging (20.10+) keeps `docker logs` functional.

Grafana is reachable via Kong at `https://<domain>/grafana/` (Keycloak OIDC
login required). Nine pre-built dashboards are auto-provisioned (five
application dashboards in the `General` folder plus four infrastructure
dashboards in the `Observability` folder — see
[Observability Overview](/docs/observe/overview/)).

## Step 7: Verify Kong is ready

The `kong-config` one-shot service configures Kong routes, services, and
plugins after Kong starts. It runs once and completes in ~10–30 seconds.

```bash
docker compose logs kong-config --tail 20
```

When you see `"Configuration restored successfully"`, Kong is routing traffic.
Until then, Kong returns 404s. Routes restored by `kong-config` include
`/api` (backend), `/api/files`, `/api/labels` (document-repository), `/auth`
(Keycloak) and `/grafana` (when the observability profile is enabled) — see
`api-gateway-solution/new-config/kong_config.json` for the full list.

## Step 8: Verify Keycloak is ready

The `keycloak-config` one-shot service applies the `genie-realm.yaml` realm
configuration after Keycloak is healthy.

```bash
docker compose logs keycloak-config --tail 10
```

Admin console: `https://<NGINX_PUBLIC_DOMAIN>/auth/admin/`
(Username `admin`, password `KEYCLOAK_ADMIN_PASSWORD`).

The `genie-admin` user (realm `genie`) is provisioned automatically via
`configs/keycloak/genie-realm.yaml` — see
[Docker Swarm Setup → Step 10b](/docs/deploy/docker-swarm-setup/#step-10b-user-role-management-post-deploy)
for user management details.

### Keycloak behind the reverse proxy

Keycloak sits behind NGINX → Kong with the `/auth` path prefix. The proxy
chain is configured automatically:

- **NGINX** sets `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`
  on `/auth/` requests.
- **Kong** adds `X-Forwarded-Prefix: /auth` via the `request-transformer`
  plugin and strips `/auth` before forwarding to Keycloak.
- **Keycloak** resolves its public URL dynamically from these headers
  (`KC_PROXY_HEADERS=xforwarded`).

These headers tell Keycloak what URL the end user sees, so OIDC redirects
work even though Keycloak is only reachable at an internal address. The
`KONG_TRUSTED_IPS` env var (default `172.16.0.0/12`) lets Kong trust nginx
to preserve them — for Swarm, override to your overlay subnet (e.g.
`10.0.0.0/8`).

## Step 9: Verify deployment

```bash
# Service status (look for "running" and "healthy")
docker compose ps

# Smoke tests
curl -sk https://localhost/api/health    # Backend health
curl -sk https://localhost/              # Frontend HTML
```

`/api/health` returns `{ "status": "ok", "serverTime": "...", "uptime": "N seconds" }`.
A successful response confirms Backend → Kong → NGINX routing works end-to-end.

If the OPEA profile is enabled, also verify the AI stack responded (not just
up):

```bash
docker compose logs vllm --tail 50 | grep -i "started\|ready\|listening"
curl -sk https://localhost/api/health | jq .   # status: "ok"
```

If the observability profile is enabled, verify the log substrate is ingesting
container logs into VictoriaLogs:

```bash
docker compose logs victorialogs --tail 10   # expect "server is ready"
# Query VL directly (no auth required on the internal network):
docker compose exec victorialogs wget -qO- 'http://127.0.0.1:9428/select/logsql/query?query=*' | head -c 500
```

### Verify it worked

| Check | Command | Expected |
|---|---|---|
| Core services healthy | `docker compose ps` | Every core service shows `running` (healthy) |
| Backend health | `curl -sk https://localhost/api/health` | `{"status":"ok",...}` HTTP 200 |
| Frontend served | `curl -skI https://localhost/` | HTTP 200, `text/html` |
| Keycloak reachable | `curl -skI https://localhost/auth/realms/genie` | HTTP 200 (redirect to OIDC discovery) |
| Kong configured | `docker compose logs kong-config --tail 5` | `"Configuration restored successfully"` |
| Logs ingested | `docker compose exec victorialogs wget -qO- 'http://127.0.0.1:9428/select/logsql/query?query=*'` | Non-empty JSON response |
| OPEA chatqna up | `docker compose ps chatqna-xeon-backend-server` | `(healthy)` (only with `--profile opea`) |

Access:

- Web UI: `https://localhost/` (self-signed cert warning expected)
- API Docs: `https://localhost/api-docs`
- API health: `https://localhost/api/health`
- Keycloak admin: `https://localhost/auth/admin/` (admin / `KEYCLOAK_ADMIN_PASSWORD`)
- Grafana: `https://localhost/grafana/` (only with `--profile observability`)

## Step 10: Useful operations

```bash
# Follow a service's logs
docker compose logs -f <service-name>

# Restart a single service
docker compose restart <service-name>

# Rebuild and restart after a code change
docker compose build <service-name>
docker compose up -d <service-name>

# Stop the whole stack (volumes preserved)
docker compose down

# Stop and remove named volumes (DATA LOSS)
docker compose down -v
```

## Step 11: Debugging

```bash
# Shell into a running service
docker compose exec backend bash
docker compose exec arango-vector-db arangosh

# Test connectivity between services from inside a container
docker compose exec backend curl -s http://arango-vector-db:8529/_api/version

# Run a one-off container on the same network
docker compose run --rm curlimages/curl curl -s http://backend:3000/api/health
```

## Teardown

```bash
docker compose down         # stop services, keep volumes
docker compose down -v      # stop and delete volumes (DATA LOSS)
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose up -d` exits with "service 'X' depends on service 'Y' which is undefined" | A custom compose override or modified `docker-compose.yaml` removed a service | Re-run `docker compose config` to surface the actual error; restore the missing service definition |
| Service fails to start with "env var XYZ is required" | Missing secret in `.env` | `grep = <empty>` will list unset vars; fill in `ARANGO_PASSWORD`, `TRANSLATION_CACHE_PASSWORD`, `POSTGRES_PASSWORD`, `KONG_DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_PROXY_CLIENT_SECRET`, `GENIE_ADMIN_PASSWORD`, `EMAIL_*` |
| Backend exits with `KEYCLOAK_URL` / OIDC discovery failure | `NGINX_PUBLIC_DOMAIN` resolves to a name the backend container cannot reach | Verify `docker compose exec backend getent hosts ${NGINX_PUBLIC_DOMAIN}`; for dev with self-signed certs, set `NODE_TLS_REJECT_UNAUTHORIZED=0` in `.env` |
| `kong-config` logs `Kong is not ready yet — retrying` in a loop | `kong-migrations` has not finished PG init | `docker compose logs kong-migrations` to verify the bootstrap step; then `docker compose restart kong-config` |
| All routes return 404 immediately after deploy | `kong-config` has not yet run, or it failed | `docker compose logs kong-config --tail 30` — look for `"Configuration restored successfully"`. Until that appears, Kong has no routes configured |
| Self-signed cert warning in browser | Local dev — expected | Click through the warning, or replace `secrets/ssl/server.crt` + `server.key` with your own cert |
| Port 80/443 already in use | Another service (apache/nginx/systemd-resolved) is bound | `ss -tlnp \| grep ':80\\|:443'`; stop the conflicting process or override with `NGINX_HTTP_PORT` / `NGINX_HTTPS_PORT` |
| GPU services exit immediately | NVIDIA runtime not installed or `nvidia-container-toolkit` missing | `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi` — must succeed before using `--profile gpu-models`. See [GPU Deployment](/docs/deploy/gpu/) |
| `vllm` OOMs or crashes on startup | Model is too large for GPU memory | Lower `VLLM_GPU_UTILIZATION` (e.g. 0.85 → 0.6) or use a smaller model. See [GPU Deployment → Memory sizing](/docs/deploy/gpu/) |
| VictoriaLogs not receiving logs | The `fluentd` driver cannot reach the Collector | `docker compose logs otel-collector --tail 30`; verify port `24224` is bound on the host (Collector uses `mode: host`, `host_ip: 127.0.0.1`). See [Admin Logs](/docs/operate/admin-logs/) |
| Keycloak admin redirect lands on a 404 | `KC_PROXY_HEADERS=xforwarded` not honored, or `NGINX_PUBLIC_DOMAIN` wrong | `docker compose logs keycloak --tail 50`; verify `https://<NGINX_PUBLIC_DOMAIN>/auth/realms/genie/.well-known/openid-configuration` returns valid JSON |
| `dataprep-arango-service` exits with "cannot import name ..." | A pinned dependency version drifted | Re-pull the image: `docker compose pull dataprep-arango-service && docker compose up -d dataprep-arango-service` |

### Diagnostic commands

```bash
# Inspect any service's last 50 log lines
docker compose logs <service-name> --tail 50

# Service health (one-shot)
docker compose ps

# Verify the NVIDIA runtime for GPU services
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi

# Connectivity test between services from inside a container
docker compose exec backend curl -s http://arango-vector-db:8529/_api/version

# Spawn an ephemeral container on the same network
docker compose run --rm curlimages/curl curl -s http://backend:3000/api/health
```

See also:

- [Operations → Troubleshooting](/docs/operate/troubleshooting/) — runtime
  issues (data, performance, errors)
- [GPU Deployment → Troubleshooting](/docs/deploy/gpu/#troubleshooting) —
  vLLM, TEI, embedding model sizing
- [Observability → Stack Overview](/docs/observe/overview/) — Collector,
  VictoriaMetrics, VictoriaLogs, VictoriaTraces wiring

## Next steps

You now have GENIE.AI running on `https://localhost/`. Continue with:

- [Post-deploy checklist](/docs/operate/health-checks/) for user
  creation and knowledge hierarchy setup
- [Docker Swarm Setup](/docs/deploy/docker-swarm-setup/) for
  multi-node production deployment
- [Observability Overview](/docs/observe/overview/) for the
  monitoring stack
