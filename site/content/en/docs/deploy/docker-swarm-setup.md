---
title: "Docker Swarm Setup"
description: "Production Docker Swarm deployment of GENIE.AI: node labels, registry, secrets, service topology, and remote GPU."
weight: 3
section: "deploy"
aliases:
  - /docs/deployment/docker-swarm-setup/
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-19
---

This guide covers Docker Swarm deployments — single-node and multi-node. For
single-host development with `docker compose up`, see
[Docker Compose Setup](/docs/deploy/docker-compose-setup/).

GENIE.AI uses a single Swarm-compatible `docker-compose.yaml` at the project
root. All services deploy via `docker stack deploy`.

## Prerequisites

- **Docker Engine 23+** with Compose v2 on every node
- **Same Docker version** on all nodes (recommended)
- **NVIDIA Container Toolkit** on GPU nodes — GENIE.AI exposes the GPU to
  containers via the `NVIDIA_VISIBLE_DEVICES` env var (default `all`), which
  requires `nvidia-container-runtime` registered as a Docker default runtime
  (or any runtime that supports `NVIDIA_VISIBLE_DEVICES`). Install on each
  GPU node: see <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html>.
- **SSH access** to every node — from the manager you need passwordless SSH
  to every worker (or `docker -H ssh://worker ...`) for cross-node debugging
- **Network connectivity** between all nodes — Swarm requires
  TCP **2377** (cluster management), TCP+UDP **7946** (node-to-node
  gossip), UDP **4789** (overlay network VXLAN). Open these between every
  pair of nodes in the cluster.
- **Registry credentials** — every node must authenticate to the GitLab
  Container Registry (`docker login registry.opensource.unicc.org/un/itu/genie-ai`)
  before `docker stack deploy` can pull images

For full system context, see
[Architecture Overview](/docs/architecture/architecture/).

## Architecture: node labels and placement

GENIE.AI places services on nodes using three labels (apply manually).
The placement constraints are declared per service in `docker-compose.yaml`:

| Label | Services placed |
|---|---|
| `gateway=true` | nginx, kong, kong-config, kong-migrations, postgres, postgres-init, keycloak, keycloak-config, certbot |
| `genieai=true` | frontend, backend, db-migrations, document-repository, arango-vector-db, redis-cache, clamav, victoriametrics, victorialogs, victoriatraces, tempo-proxy, grafana |
| `gpu=true` | vllm, vllm-translation-guardrail, tei, tei_reranker, textgen, embedding, reranker, translation, guardrail, dataprep-arango-service, retriever-arango-service, chatqna-xeon-backend-server, chatqna-xeon-ui-server, chatqna-xeon-nginx-server |
| _no label_ | **otel-collector** runs in `mode: global` with **no placement constraint** — one Collector task per Swarm node (gateway, genieai, gpu) so the fluentd logging driver can reach `localhost:24224` on every node that runs containers. The `otel-collector-init` init service also runs in `mode: global`. |

A single node can carry multiple labels.

### Common topologies

**Single-node Swarm** — all services on one node (all three labels):

```
Manager (gateway=true, genieai=true, gpu=true) → all services
```

**Two-node Swarm** — gateway + app on the manager, GPU on a worker:

```
Manager (gateway=true, genieai=true)  → gateway + GENIE.AI services
Worker  (gpu=true)                     → GPU services
```

**Three-node Swarm (production)** — one role per node:

```
Manager (gateway=true)                → gateway only
Worker  (genieai=true)                → GENIE.AI services
Worker  (gpu=true)                     → GPU services
```

**Remote GPU** — app stack on one node, dedicated GPU node deployed separately:

```
App node (gateway=true, genieai=true, gpu=true) → all app services
GPU node (standalone, no Swarm)        → 5 AI services behind nginx proxy
                                          (vLLM LLM, vLLM translation, TEI embedding,
                                          TEI reranker, docling-serve — see
                                          [Remote GPU Node](#remote-gpu-node) for
                                          the route diagram)
```

The app node **must** carry all three Swarm labels (`gateway`, `genieai`,
`gpu`). The OPEA orchestrators (`chatqna-xeon-backend-server`,
`retriever-arango-service`, `dataprep-arango-service`, `embedding`,
`reranker`, `textgen`, `translation`, `guardrail`) are pinned to
`node.labels.gpu == true` in `docker-compose.yaml` — without the `gpu`
label they will not schedule. The `gpu` label on the app node only
affects *placement*; the GPU-model containers (`vllm`, `tei`,
`tei_reranker`, `vllm-translation-guardrail`) stay down because their
`replicas` are gated by `GPU_MODEL_REPLICAS=0` (see [Remote GPU
Node](#remote-gpu-node) below).

See [Remote GPU Node](#remote-gpu-node) for the remote GPU wiring.

## Step 1: Initialize Swarm

On the **manager node**:

```bash
docker swarm init --advertise-addr <manager-ip>
```

The output includes a join token. On each **worker**:

```bash
docker swarm join --token <token> <manager-ip>:2377
```

Verify the cluster from the manager:

```bash
docker node ls
```

## Step 2: Label nodes

Apply labels to the appropriate nodes:

```bash
# Gateway node (nginx, kong, kong-migrations, kong-config, postgres, postgres-init,
# keycloak, keycloak-config, certbot — all share `node.labels.gateway == true`)
docker node update --label-add gateway=true <gateway-node>

# GENIE.AI app node (frontend, backend, db-migrations, document-repository,
# arango-vector-db, redis-cache, clamav + observability services)
docker node update --label-add genieai=true <genieai-node>

# GPU node (vLLM, TEI, ChatQnA, retriever, dataprep, …)
docker node update --label-add gpu=true <gpu-node>
```

`otel-collector` has **no placement constraint** (it runs in `mode: global` on
every Swarm node), so it does not require any of these labels — but the
node it runs on still needs the fluentd logging driver to forward logs.

For single-node Swarm (all services on the manager):

```bash
docker node update --label-add gateway=true $(hostname)
docker node update --label-add genieai=true $(hostname)
docker node update --label-add gpu=true $(hostname)
```

## Step 3: Configure registry authentication

GENIE.AI images are **pre-built by CI** and published to the GitLab Container
Registry (`registry.opensource.unicc.org/un/itu/genie-ai`). `docker stack
deploy` pulls them automatically — no local build or push required.

On every Swarm node that will pull images:

```bash
docker login registry.opensource.unicc.org/un/itu/genie-ai
```

Ansible handles this automatically across nodes; for manual deployments, run
the login on each node.

`docker compose up` (single-node dev) still uses `build:` directives and does
not pull from the registry.

## Step 4: Prepare directories

Create the bind-mount directories on every node that will host a service using
them. Swarm resolves bind mounts relative to where `docker stack deploy` runs
(the manager), so for multi-node deployments the same path must exist on every
relevant node:

```bash
mkdir -p data/logs/kong data/logs/backend data/logs/doc-repo \
         data/database_backups data/huggingface secrets/ssl
```

| Directory | Purpose | Which node |
|---|---|---|
| `data/logs/kong` | Kong gateway logs | `gateway=true` |
| `data/logs/backend` | Backend API logs | `genieai=true` |
| `data/logs/doc-repo` | Document Repository logs | `genieai=true` |
| `data/database_backups` | Backend DB dumps | `genieai=true` |
| `data/huggingface` | TEI model cache | `gpu=true` |
| `secrets/ssl` | SSL certificates (read by NGINX) | `gateway=true` |

Copy SSL certificates to the gateway node:

```bash
scp secrets/ssl/server.crt gateway-node:/path/to/genie-ai/secrets/ssl/
scp secrets/ssl/server.key gateway-node:/path/to/genie-ai/secrets/ssl/
```

Unlike Docker secrets, bind mounts silently mount an empty directory if files
are missing — NGINX will fall back to self-signed certificates, which is not
suitable for production. Always verify certs are present before deploy.

## Step 5: Image distribution

GENIE.AI images are published to the GitLab Container Registry with promoted
tags (`main`, `release-el-salvador`, etc.). `docker stack deploy` pulls them
automatically.

### 5a. Verify image availability

```bash
docker pull registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-frontend:main
```

Replace `main` with your target `GENIE_AI_GLOBAL_TAG` value.

### 5b. Per-service image configuration

Image references use a two-variable pattern per service, defined in `env`
**Section 13** (Docker Swarm Multi-Node):

```
GENIE_AI_<NAME>_IMAGE=registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-<name>
GENIE_AI_<NAME>_IMAGE_TAG=${GENIE_AI_GLOBAL_TAG:-latest}
```

Compose resolves
`${GENIE_AI_<NAME>_IMAGE}:${GENIE_AI_<NAME>_IMAGE_TAG:-${GENIE_AI_GLOBAL_TAG:-latest}}`.

The default is the GitLab registry with tag `main` — no overrides needed for
standard deployments.

### 5c. Override a single image tag

To pin one service to a different version:

```bash
# .env
GENIE_AI_FRONTEND_IMAGE_TAG=v1.2.3
```

All other services continue using `GENIE_AI_GLOBAL_TAG`.

### 5d. Custom or air-gapped registries

```bash
GENIE_AI_REGISTRY=my-registry.example.com/genieai
GENIE_AI_GLOBAL_TAG=release-el-salvador
```

Then `docker pull` from GitLab, re-tag, and `docker push` to your registry.
External images (PostgreSQL, Kong, Redis, ClamAV, ArangoDB, vLLM, …) are
hardcoded in `docker-compose.yaml` and are not affected by `GENIE_AI_REGISTRY`.

## Step 6: Configure `.env`

On the **manager node**:

```bash
cp env .env
```

Set **all required secrets** — see `env` Section 1 (DB + cache), Section 2 (SMTP), and Section 9 (Keycloak + GENIE realm):

```bash
# Section 1 — Secrets (REQUIRED)
ARANGO_PASSWORD=<strong-password>
TRANSLATION_CACHE_PASSWORD=<strong-password>
POSTGRES_PASSWORD=<strong-password>
KONG_DB_PASSWORD=<strong-password>

# Section 2 — Email Configuration (REQUIRED for user verification / password reset)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
# EMAIL_SECURE=false
EMAIL_USER=your@email.com
EMAIL_PASSWORD=<smtp-password>
EMAIL_FROM=noreply@example.com

# Section 3 — External API keys
HUGGING_FACE_HUB_TOKEN=<hf-token>

# Section 9 — Keycloak / GENIE realm (REQUIRED)
KEYCLOAK_DB_PASSWORD=<strong-password>
KEYCLOAK_ADMIN_PASSWORD=<strong-password>
KEYCLOAK_CLIENT_SECRET=<strong-random-string>
KEYCLOAK_PROXY_CLIENT_SECRET=<strong-random-string>
KC_DATAPREP_CLIENT_SECRET=<strong-random-string>
GENIE_ADMIN_PASSWORD=<strong-password>
GENIE_ADMIN_EMAIL=admin@example.com
```

> Note: Section 9 also defaults `KEYCLOAK_URL` (auto-derived from `NGINX_PUBLIC_DOMAIN`),
> `KEYCLOAK_REALM=genie`, `KEYCLOAK_CLIENT_ID=genie-app` — override only if you
> need a different realm name or client ID.

Set **network/domain variables** (Sections 5/6/7 in the env template — Frontend, Backend, API Gateway). Replace
`gateway.example.com` with your domain **or remote IP** (e.g. `10.0.0.110`):

```bash
NGINX_PUBLIC_DOMAIN=gateway.example.com
VUE_APP_API_URL=https://gateway.example.com/api
CSP_CONNECT_SRC='self' https://gateway.example.com wss://gateway.example.com
VUE_APP_CSP_CONNECT_SRC='self' https://gateway.example.com wss://gateway.example.com
CORS_ALLOWED_ORIGINS=https://gateway.example.com
```

> **Why this matters:** `VUE_APP_API_URL` is a runtime config variable, not
> build-time. The frontend reads it from `window.APP_CONFIG` at startup
> (generated by `docker-entrypoint.sh`). Changing the domain only requires
> updating `.env` and redeploying — no image rebuild.

To skip OPEA/AI services (no GPU):

```bash
DEPLOY_OPEA=0
```

To enable the observability stack:

```bash
ENABLE_OBSERVABILITY=1
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<strong-password>
KC_GRAFANA_CLIENT_ID=grafana
KC_GRAFANA_CLIENT_SECRET=<strong-secret>
```

**Note:** `ENABLE_OBSERVABILITY` must be `0` or `1`, not `true` / `false`.

### Kong trusted IPs (required for Swarm)

Kong must trust NGINX to preserve `X-Forwarded-*` headers (Proto, Host, Port,
Prefix). Without this, Kong overwrites them and Keycloak's OIDC discovery URLs
break.

Docker Compose uses bridge networks (`172.16.0.0/12` by default), but Docker
Swarm uses overlay networks that typically allocate from `10.x.x.x`. Verify
your overlay subnet:

```bash
docker network inspect genieai_genieai_network --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

Then set `KONG_TRUSTED_IPS` accordingly:

```bash
# Docker Compose (bridge networks — 172.16-172.31)
# KONG_TRUSTED_IPS=172.16.0.0/12

# Docker Swarm (overlay networks — typically 10.x.x.x)
KONG_TRUSTED_IPS=10.0.0.0/8
```

## Step 7: Verify file prerequisites

On the **manager node**:

```bash
ls secrets/ssl/server.crt secrets/ssl/server.key
```

### Let's Encrypt (optional)

For automatic provisioning and renewal:

1. Set in `.env`:
   ```bash
   CERTBOT_EMAIL=your-email@example.com
   CERTBOT_REPLICAS=1
   ```
2. Set `NGINX_PUBLIC_DOMAIN` to your public FQDN.
3. Deploy normally — certbot starts automatically.

Certificates are obtained, written to `secrets/ssl/`, and renewed every 12
hours; nginx reloads automatically. Set `CERTBOT_STAGING=true` to use the
staging server while testing.

**Prerequisites:** port 80 reachable from the internet, DNS A/AAAA record
pointing to the gateway node.

## Step 8: Deploy

### 8a. Validate

```bash
set -a && source .env && set +a && docker compose config > /dev/null
```

Fix any errors before proceeding — this catches missing variables and syntax
issues early.

### 8b. Deploy

> **Important:** `docker stack deploy` does **not** substitute `${VAR}`
> references from environment variables. You must pre-resolve them into a flat
> YAML with `docker compose config` first.

```bash
set -a && source .env && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai
```

This creates a stack named `genieai`. All services start per their placement
constraints.

With GPU-specific overrides:

```bash
set -a && source .env && source env.t4 && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai
```

## Step 9: Verify Kong is ready

The `kong-config` one-shot service runs as part of the stack deployment and
completes in ~10–30 seconds.

```bash
docker service logs genieai_kong-config --tail 20
```

When you see `"Configuration restored successfully"`, Kong routes are live.
Until then, Kong returns 404s.

## Step 10: Verify deployment

```bash
# List all services
docker service ls

# Verify placement
docker service ps genieai_kong --format "{{.Node}} {{.Name}}"
docker service ps genieai_vllm --format "{{.Node}} {{.Name}}"
docker service ps genieai_backend --format "{{.Node}} {{.Name}}"

# Look for errors
docker stack ps genieai --no-trunc

# Smoke tests
curl -sk https://localhost/api/health
curl -sk https://localhost/
```

## Step 10b: User & role management

All user management is performed through the Keycloak admin console. GENIE.AI
does not provide a separate admin UI for users.

| Deployment | URL |
|---|---|
| Localhost (dev) | `https://localhost/auth/admin` |
| Domain | `https://<NGINX_PUBLIC_DOMAIN>/auth/admin` |

**Credentials:** username `admin`, password from `KEYCLOAK_ADMIN_PASSWORD` in
`.env`. Select the **genie** realm (not `master`) after logging in.

**Redirect URIs and web origins** are auto-derived from
`NGINX_PUBLIC_DOMAIN` + `NGINX_HTTPS_PORT` into `KC_PUBLIC_ORIGIN` (e.g.
`https://gateway.example.com:8443`). If you use a non-standard HTTPS port,
set `NGINX_HTTPS_PORT` in `.env` — no manual Keycloak configuration needed.

**GENIE realm admin user** (separate from master admin, used for frontend
login):

- Username: `genie-admin` (default, configurable via `GENIE_ADMIN_USERNAME`)
- Password: `<GENIE_ADMIN_PASSWORD>` from `.env`
- Has the `admin` realm role — grants admin access in the GENIE.AI frontend

### Pre-configured users and roles

These are provisioned automatically during deployment via
`configs/keycloak/genie-realm.yaml`:

| User | Roles | Purpose |
|---|---|---|
| `genie-admin` | `admin` | Initial administrator account |

### First steps

1. **Change the admin password** (if still using the default from `.env`):
   Users → genie-admin → Credentials → Set password.
2. **Create user accounts**: Users → Add user — set credentials and assign the
   `user` role.
3. **Grant admin access**: Users → [user] → Role Mapping → Assign `admin` role.

For full CRUD operations, role assignment, group management, and security
considerations see
[Keycloak Admin Operations Guide](/docs/configure/keycloak-admin-guide/).
For external identity providers (Google, Microsoft, SAML/OIDC) see
[External IdP Integration Guide](/docs/configure/external-idp-integration-guide/).

## Step 11: Debugging internal services

Internal services are not exposed to the host.

```bash
# Shell into a service container
docker exec -it $(docker ps --filter "name=genieai_backend" -q | head -1) bash

# Test connectivity from inside the network
docker exec $(docker ps --filter "name=genieai_backend" -q | head -1) \
  curl -s http://arango-vector-db:8529/_api/version

# Tail a service's logs
docker service logs genieai_backend -f

# Drill into a specific task
docker service ps genieai_backend --no-trunc
docker logs <task-id> -f

# Use the attachable overlay network for ad-hoc debug containers
docker run --rm -it --network genieai_genieai_network \
  curlimages/curl:latest \
  curl -s http://backend:3000/api/health
```

## Step 12: Teardown

```bash
# Remove the entire stack (services and networks)
docker stack rm genieai

# Wait for cleanup
echo "Waiting for services to stop..."
sleep 30

# Named volumes persist. Remove explicitly:
# Application data:
docker volume rm genieai_postgres_data
docker volume rm genieai_redis_data
docker volume rm genieai_arango_data
docker volume rm genieai_doc_repo_uploads
docker volume rm genieai_backend_uploads
docker volume rm genieai_backend_data
docker volume rm genieai_hf_cache
# Optional stack state:
docker volume rm genieai_certbot-webroot
docker volume rm genieai_certbot-etc
# Observability (only present if ENABLE_OBSERVABILITY=1 was set):
docker volume rm genieai_vm-data
docker volume rm genieai_grafana-data
docker volume rm genieai_vlogs-data
docker volume rm genieai_vtraces-data
docker volume rm genieai_otel-queue
```

**Rollback from a failed deployment:** `docker stack rm genieai` removes
services but named volumes persist. Data in ArangoDB, Redis, and document
uploads is preserved. Redeploy after fixing the issue.

> **Back up first** if you want to preserve state — `docker run --rm -v
> genieai_arango_data:/data -v $(pwd):/backup alpine tar czf
> /backup/arango-backup.tar.gz /data` for a tarball snapshot.

## Step 13: Single-node Swarm

For testing or small deployments, run all services on a single node.

### 13a. Localhost

```bash
# Initialize Swarm
docker swarm init

# Label the single node for all services
docker node update --label-add gateway=true $(hostname)
docker node update --label-add gpu=true $(hostname)
docker node update --label-add genieai=true $(hostname)

# Authenticate to GitLab Container Registry
docker login registry.opensource.unicc.org/un/itu/genie-ai

# Configure .env
cp env .env
# Edit .env with your secrets

# Deploy (images are pulled automatically)
set -a && source .env && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai

# Remove the stack
docker stack rm genieai
```

### 13b. Remote node (e.g. `10.0.0.110`)

The frontend image is generic — it reads `VUE_APP_API_URL` at runtime, no
rebuild needed. Images are pulled from the GitLab Container Registry
automatically.

```bash
# 1. Initialize Swarm
docker swarm init
docker node update --label-add gateway=true $(hostname)
docker node update --label-add gpu=true $(hostname)
docker node update --label-add genieai=true $(hostname)

# 2. Authenticate to GitLab Container Registry
docker login registry.opensource.unicc.org/un/itu/genie-ai

# 3. Configure environment
cp env .env
# Edit secrets (ARANGO_PASSWORD, KEYCLOAK_ADMIN_PASSWORD, …) then set:
sed -i 's|^NGINX_PUBLIC_DOMAIN=.*|NGINX_PUBLIC_DOMAIN=10.0.0.110|' .env
sed -i "s|^VUE_APP_API_URL=.*|VUE_APP_API_URL=https://10.0.0.110/api|" .env
sed -i "s|^CSP_CONNECT_SRC=.*|CSP_CONNECT_SRC='self' https://10.0.0.110 wss://10.0.0.110|" .env
sed -i "s|^VUE_APP_CSP_CONNECT_SRC=.*|VUE_APP_CSP_CONNECT_SRC='self' https://10.0.0.110 wss://10.0.0.110|" .env
sed -i 's|^CORS_ALLOWED_ORIGINS=.*|CORS_ALLOWED_ORIGINS=https://10.0.0.110|' .env

# 4. Deploy
set -a && source .env && set +a
docker compose config > docker-compose.resolved.yaml
docker stack deploy -c docker-compose.resolved.yaml genieai

# 5. Verify
docker service ls
# Access https://10.0.0.110/ (self-signed cert warning expected)
```

> **Note on sed:** values containing single quotes must be wrapped in double
> quotes in the `.env` file. Verify with `grep '^NGINX_PUBLIC_DOMAIN=' .env`
> before deploying.

## External Identity Provider support

GENIE.AI supports external identity providers (Google, Microsoft Entra ID,
institutional IdPs, any standard OIDC/SAML provider) through Keycloak. No
GENIE.AI code changes are required.

See [External IdP Integration Guide](/docs/configure/external-idp-integration-guide/).

Key points:

- External IdPs are configured entirely within Keycloak (admin console or
  keycloak-config-cli)
- Keycloak must have network connectivity to the external IdP endpoints
- NGINX does not proxy external IdP traffic; Keycloak makes direct outbound
  connections
- External IdPs are **not** available in air-gapped deployments — only local
  Keycloak credentials work without internet connectivity

## Known limitations

- **No application-level retry:** Backend and OPEA services crash if
  dependencies are unavailable at startup. Swarm restart policy handles this,
  but first deployment takes 5–15 minutes to stabilize.
- **GPU contention:** 5 services set `NVIDIA_VISIBLE_DEVICES` and request GPU access on the GPU node:
  `vllm`, `vllm-translation-guardrail`, `tei`, `tei_reranker`, and
  `dataprep-arango-service` (docling GPU acceleration — controlled by
  `NVIDIA_VISIBLE_DEVICES` env var, not the `runtime: nvidia` Docker option).
  Other GPU-*placed* services (`embedding`, `reranker`, `textgen`, `translation`,
  `guardrail`, `retriever-arango-service`, `chatqna-xeon-backend-server`,
  `chatqna-xeon-ui-server`, `chatqna-xeon-nginx-server`) are CPU-only —
  they live on the GPU node because they connect to vLLM/TEI, not because
  they use the GPU. VRAM is shared between the 5 device-attached services;
  use `env.t4` / `env.rtx6000` to manage batch size and model length limits.
  24 GB+ VRAM recommended.
- **No shared volumes:** If a node goes down, its stack goes down. No data
  migration between nodes.
- **DNS timing:** Swarm overlay DNS entries may not resolve immediately on
  first container start. Services with healthchecks handle this via restart
  cycles.
- **Kong config gap:** Kong routes are unavailable for ~10–30 seconds after
  Kong starts until `kong-config` completes.
- **Redis healthcheck:** Uses the `REDISCLI_AUTH` env var for authentication
  (password not passed on the command line).

## Troubleshooting

### Service keeps restarting

```bash
docker service ps genieai_<service-name> --no-trunc
docker service logs genieai_<service-name> --tail 50
```

Common causes:

- Missing bind mount directories on the target node
- Env var not set in `.env`
- GPU not available on the node (check labels)
- Image not available (check registry login)

### GPU services not scheduling

```bash
docker node inspect <gpu-node> --format '{{.Spec.Labels}}'
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Cross-node communication failing

```bash
docker network inspect genieai_genieai_network
docker exec $(docker ps -q | head -1) ping -c 1 backend
```

### DNS resolution delays

Swarm overlay DNS can have delays on first resolution, causing services to
fail on startup and be restarted by the policy. This is normal — services
stabilize after a few restart cycles.

### Stack deploy fails with `compose.config` error

If `docker compose config` complains, validate your `.env` syntax
(unmatched quotes, missing `=` signs, special characters in passwords).
Wrap any value containing spaces in quotes, e.g.
`KEYCLOAK_PASSWORD_POLICY="length(12) and specialChars(1)"`.

### `kong-migrations` fails

```bash
docker service logs genieai_kong-migrations --tail 50
```

Usually a PostgreSQL connectivity issue. Verify `KONG_DB_PASSWORD` and
`POSTGRES_PASSWORD` are set in `.env` and that the postgres service is
healthy (`docker service ps genieai_postgres`).

## Remote GPU Node

GENIE.AI supports deploying AI services on a dedicated GPU node separate
from the app stack. The GPU node runs 5 AI services behind nginx with TLS
termination and API key authentication (default port 443, configurable via
`gpu_https_port`), using path-based routing.

### Architecture

```
App node (gateway=true, genieai=true, gpu=true)   GPU node (standalone)
┌─────────────────────────┐                ┌─────────────────────────────┐
│ Frontend, Backend,      │                │ nginx-gpu (port 443)       │
│ ArangoDB, Redis, ...    │   HTTPS 443    │   /llm/         → vLLM LLM │
│                         │ ────────────── │   /translation/ → vLLM T   │
│ ChatQnA ──────────────────────────────→ │   /embed/       → TEI Emb  │
│ Retriever ────────────────────────────→ │   /rerank/      → TEI Rer  │
│ Dataprep ────────────────────────────→ │   /docling/     → docling  │
└─────────────────────────┘                └─────────────────────────────┘
```

> **Important:** the app node must carry all three Swarm labels
> (`gateway`, `genieai`, `gpu`). The OPEA orchestrators above are pinned
> to `node.labels.gpu == true` — without the `gpu` label on the app node
> they will not schedule. The `gpu` label only affects placement; the
> GPU-model containers stay down via `GPU_MODEL_REPLICAS=0`.

### Connect the app node

Set in the **app node's** `.env` (Section 14):

```bash
GPU_NODE_HOST=<gpu-node-host>       # GPU node IP or hostname
GPU_MODEL_REPLICAS=0                # Skip local GPU containers
VLLM_API_KEY=<your-api-key>         # API key from GPU node admin (Authorization: Bearer)
OPEA_SSL_SKIP_VERIFY=1              # only if GPU node uses self-signed certs
```

`GPU_MODEL_REPLICAS=0` tells Swarm to deploy 0 replicas of GPU-heavy
containers (vllm, tei, tei_reranker, vllm-translation-guardrail).
Orchestrators (ChatQnA, Retriever, Dataprep) still deploy and connect to the
remote GPU node via override endpoints.

`VLLM_API_KEY` authenticates with the GPU node nginx via
`Authorization: Bearer`. All OpenAI-compatible clients send this natively —
no custom injection needed.

`OPEA_SSL_SKIP_VERIFY=1` disables SSL verification in OPEA services via a
runtime patch (`configs/ssl/genie_ssl_patch.py`). Only use with self-signed
certs. Omit if the GPU node uses Let's Encrypt or a public CA.

`KEYCLOAK_SSL_SKIP_VERIFY=1` independently disables SSL verification for
dataprep's Keycloak service account token fetch. Set this if Keycloak uses
a self-signed certificate.

#### Self-signed certificates — quick reference

| Scenario | `NODE_TLS_REJECT_UNAUTHORIZED` | `OPEA_SSL_SKIP_VERIFY` | `KEYCLOAK_SSL_SKIP_VERIFY` |
|---|---|---|---|
| Swarm deploy, self-signed NGINX, no remote GPU | `0` | — | — |
| Swarm deploy, remote GPU with self-signed cert | `0` | `1` | — |
| Production, real CA certificates on all hosts | — | — | — |
| Production/air-gapped, self-signed NGINX | `0` | `1` | `1` |

`—` = use default (verify certs). For the remote-GPU row, `OPEA_SSL_SKIP_VERIFY=1`
is only needed if the remote GPU node itself uses a self-signed cert.

Set these in `.env` before running Ansible (see `env` Section 14 for GPU
node variables).

> **Warning:** `DEPLOY_OPEA` must remain `1` — it controls the orchestrator
> services. Setting `DEPLOY_OPEA=0` disables **all** OPEA services (including
> orchestrators) and breaks the RAG pipeline. Use `GPU_MODEL_REPLICAS=0` to
> skip only GPU containers.
>
> Ansible sets `GPU_MODEL_REPLICAS=0` automatically when `gpu_node_host`
> is configured.

For GPU node deployment see `deploy/ansible/README.md` (Remote GPU Node
section).
