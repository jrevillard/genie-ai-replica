# Docker Swarm Deployment Guide

This guide covers Docker Swarm deployments (single-node and multi-node). For local single-node development with `docker compose up`, see [Docker Compose Setup Guide](docker-compose-setup.md).

GENIE.AI uses a single Swarm-compatible `docker-compose.yaml` at the project root. All services are deployed via `docker stack deploy`.

## Prerequisites

- **Docker Engine 23+** on all nodes (Compose v2 support required)
- **NVIDIA Container Toolkit** on GPU nodes
- **Same Docker version** on all nodes (recommended)
- **SSH access** to all nodes
- **Network connectivity** between all nodes (ports 2377/tcp, 7946/tcp+udp, 4789/udp)

## Architecture Overview

GENIE.AI services are placed on nodes using three labels:

| Placement | Constraint | Services |
|-----------|------------|----------|
| **Gateway** (label) | `node.labels.gateway == true` | Kong, NGINX, PostgreSQL |
| **GENIE.AI** (label) | `node.labels.genieai == true` | Frontend, Backend, ArangoDB, Redis, Document Repository, ClamAV, HTTP Service |
| **GPU** (label) | `node.labels.gpu == true` | vLLM, TEI embedding, TEI reranking, Retriever, Dataprep, ChatQnA, Translation, Guardrail |

All three labels (`gateway=true`, `genieai=true`, `gpu=true`) must be applied manually to the target nodes. A single node can have multiple labels.

### Deployment topologies

**Single node** — all services on one node (all three labels):
```
Manager (gateway=true, genieai=true, gpu=true) → All services
```

**Two nodes** — gateway + app on one node, GPU on the other:
```
Manager (gateway=true, genieai=true)  → Gateway + GENIE.AI services
Worker  (gpu=true)                     → GPU services
```

**Three nodes** — each role on a dedicated node (production):
```
Manager (gateway=true)                → Gateway only (Kong, NGINX, PostgreSQL)
Worker  (genieai=true)                → GENIE.AI services
Worker  (gpu=true)                     → GPU services
```

## Step 1: Initialize Swarm

On the **manager node** (gateway):

```bash
docker swarm init --advertise-addr <manager-ip>
```

This outputs a join token. On each **worker node**:

```bash
docker swarm join --token <token> <manager-ip>:2377
```

Verify the cluster:

```bash
docker node ls
```

## Step 2: Label Nodes

Three labels control service placement. Apply them to the appropriate nodes:

```bash
# Gateway node — required for API gateway services (Kong, NGINX, PostgreSQL)
docker node update --label-add gateway=true <gateway-node-hostname>

# GENIE.AI node — required for application services
docker node update --label-add genieai=true <genieai-node-hostname>

# GPU node — required for OPEA services
docker node update --label-add gpu=true <gpu-node-hostname>
```

### Single-node Swarm

Label the manager with all three labels (all services run locally):

```bash
docker node update --label-add gateway=true $(hostname)
docker node update --label-add gpu=true $(hostname)
docker node update --label-add genieai=true $(hostname)
```

### Two-node Swarm

Label the manager with `gateway=true` and `genieai=true` (gateway + app services run there), the worker with `gpu=true`:

```bash
# On manager
docker node update --label-add gateway=true $(hostname)
docker node update --label-add genieai=true $(hostname)

# On GPU worker
docker node update --label-add gpu=true <gpu-worker-hostname>
```

### Three-node Swarm (production)

Each role on a dedicated node:

```bash
# On manager (gateway)
docker node update --label-add gateway=true $(hostname)

# On GENIE.AI worker
docker node update --label-add genieai=true <genieai-worker-hostname>

# On GPU worker
docker node update --label-add gpu=true <gpu-worker-hostname>
```

## Step 3: Start Local Registry

On the **manager node**, start a local Docker registry for image distribution:

```bash
docker run -d -p 5000:5000 --name registry --restart=unless-stopped registry:2
```

Verify:

```bash
curl -s http://localhost:5000/v2/_catalog
```

**Important:** For multi-node deployments, all nodes must be able to reach this registry. Set `SWARM_REGISTRY_URL` in `.env` to the manager node's IP or hostname (e.g., `192.168.1.10:5000`). The default `localhost:5000` only works for single-node Swarm.

For production, replace with a proper registry (Harbor, ECR, etc.).

## Step 4: Prepare Directories

Create required directories on **each target node** before deployment.

All bind mounts are centralized under `./data/`. Create the full structure:

```bash
mkdir -p data/logs/kong data/logs/backend data/logs/doc-repo data/database_backups data/huggingface secrets/ssl
```

| Directory | Purpose | Node |
|-----------|---------|------|
| `data/logs/kong` | Kong gateway logs | gateway (`gateway=true`) |
| `data/logs/backend` | Backend API logs | genieai |
| `data/logs/doc-repo` | Document Repository logs | genieai |
| `data/database_backups` | Backend DB dumps | genieai |
| `data/huggingface` | TEI model cache | GPU (`gpu=true`) |
| `secrets/ssl` | SSL certificates | gateway |

Copy SSL certificates:

```bash
# Copy from your management machine
scp secrets/ssl/server.crt gateway-node:/path/to/project/secrets/ssl/
scp secrets/ssl/server.key gateway-node:/path/to/project/secrets/ssl/
```

**Important:** Bind mount paths in Swarm are resolved relative to where `docker stack deploy` is run, on the manager node. For multi-node deployments, ensure the same directory structure exists at the same relative path on each node. Copy the entire project directory to each node.

**Important:** SSL certificate files (`server.crt`, `server.key`) must exist at `./secrets/ssl/` on the gateway node before deployment. Unlike Docker secrets, bind mounts silently mount an empty directory if the files are missing — the nginx entrypoint will fall back to self-signed certificates, which is not suitable for production.

## Step 5: Build and Push Images

`docker stack deploy` does NOT use `build:` directives — it only reads `image:`. All images must be pre-built and pushed to the registry. The `build:` directives in `docker-compose.yaml` are for `docker compose up` only.

### 5a. Build all images

On the **manager node**, from the project root:

The frontend image is **generic** — it reads its configuration at runtime via `window.APP_CONFIG` (generated from environment variables at container startup). No rebuild needed for different domains or IPs.

Build contexts vary per service (see `build:` directives in `docker-compose.yaml` for reference):

```bash
# Frontend (Vue 3) — context is the frontend directory
docker build -t genieai_mvp_frontend:latest components/gov-chat-frontend/

# Backend (Node.js) — context is components/ (Dockerfile copies gov-chat-backend/ and shared/)
docker build -f components/gov-chat-backend/Dockerfile -t genieai_mvp_backend:latest components/

# Document Repository — context is components/ (Dockerfile copies document-repository/ and shared/)
docker build -f components/document-repository/Dockerfile -t genieai_mvp_document-repository:latest components/

# HTTP Service — context is project root (Dockerfile copies genie-ai-overlay/http-service/)
docker build -f genie-ai-overlay/http-service/Dockerfile -t genieai_mvp_http-service:latest .

# Nginx (API gateway reverse proxy)
docker build -t genie-ai-nginx:latest api-gateway-solution/nginx/

# Kong Config (one-shot init service)
docker build -t genie-ai-kong-config:latest api-gateway-solution/new-config/

# PostgreSQL Init (one-shot — creates dedicated kong/keycloak users)
docker build -t genie-ai-postgres-init:latest config/postgres/

# Keycloak (Identity Provider)
docker build -t genie-ai-keycloak:latest config/keycloak/

# Keycloak Config CLI (one-shot — applies realm configuration)
docker build -f config/keycloak/Dockerfile.config-cli -t genie-ai-keycloak-config:latest config/keycloak/

# OPEA services (if DEPLOY_OPEA=1) — context is project root for all
docker build -f genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai -t genie-ai-dataprep-arango:latest .
docker build -f genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai -t genie-ai-retriever-arango:latest .
docker build -f genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai -t genie-ai-chatqna-server:latest .
docker build -f genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai -t genie-ai-reranker:latest .
```

This builds 13 services. Skip the OPEA builds if `DEPLOY_OPEA=0`.

### 5b. Tag images for local registry

```bash
# Services with explicit image names in docker-compose.yaml
docker tag genie-ai-dataprep-arango:latest localhost:5000/genie-ai-dataprep-arango:latest
docker tag genie-ai-retriever-arango:latest localhost:5000/genie-ai-retriever-arango:latest
docker tag genie-ai-chatqna-server:latest localhost:5000/genie-ai-chatqna-server:latest
docker tag genie-ai-reranker:latest localhost:5000/genie-ai-reranker:latest
docker tag genie-ai-nginx:latest localhost:5000/genie-ai-nginx:latest
docker tag genie-ai-kong-config:latest localhost:5000/genie-ai-kong-config:latest
docker tag genie-ai-postgres-init:latest localhost:5000/genie-ai-postgres-init:latest
docker tag genie-ai-keycloak:latest localhost:5000/genie-ai-keycloak:latest
docker tag genie-ai-keycloak-config:latest localhost:5000/genie-ai-keycloak-config:latest

# Services tagged by Compose project name (genieai_mvp)
docker tag genieai_mvp_frontend:latest localhost:5000/genie-ai-frontend:latest
docker tag genieai_mvp_backend:latest localhost:5000/genie-ai-backend:latest
docker tag genieai_mvp_document-repository:latest localhost:5000/genie-ai-document-repository:latest
docker tag genieai_mvp_http-service:latest localhost:5000/genie-ai-http-service:latest
```

### 5c. Push to local registry

```bash
docker push localhost:5000/genie-ai-frontend:latest
docker push localhost:5000/genie-ai-backend:latest
docker push localhost:5000/genie-ai-document-repository:latest
docker push localhost:5000/genie-ai-http-service:latest
docker push localhost:5000/genie-ai-dataprep-arango:latest
docker push localhost:5000/genie-ai-retriever-arango:latest
docker push localhost:5000/genie-ai-chatqna-server:latest
docker push localhost:5000/genie-ai-reranker:latest
docker push localhost:5000/genie-ai-nginx:latest
docker push localhost:5000/genie-ai-kong-config:latest
docker push localhost:5000/genie-ai-postgres-init:latest
docker push localhost:5000/genie-ai-keycloak:latest
docker push localhost:5000/genie-ai-keycloak-config:latest
```

### 5d. (Optional) Pre-pull external images for air-gapped deployments

If worker nodes do not have internet access, pull and push all external images to the local registry:

```bash
# Pull external images
docker pull postgres:13
docker pull kong:latest
docker pull redis:7-alpine
docker pull clamav/clamav
docker pull arangodb/arangodb:3.12.4
docker pull vllm/vllm-openai:latest
docker pull opea/llm-textgen:latest
docker pull opea/translation:latest
docker pull opea/guardrails:latest
docker pull opea/embedding:latest
docker pull opea/chatqna-ui:latest
docker pull opea/nginx:latest
docker pull ghcr.io/huggingface/text-embeddings-inference:1.9.3
docker pull nginx:alpine
docker pull quay.io/keycloak/keycloak:26.5.6
docker pull adorsys/keycloak-config-cli:6.5.0-26

# Tag and push (example for each)
docker tag vllm/vllm-openai:latest localhost:5000/vllm/vllm-openai:latest
docker push localhost:5000/vllm/vllm-openai:latest
# Repeat for all external images...
```

Then override image references in `.env` or `docker-compose.yaml` to use the `SWARM_REGISTRY_URL` prefix (e.g., `192.168.1.10:5000/...`).

## Step 6: Configure Environment

Copy and edit the environment template on the **manager node**:

```bash
cp env .env
```

Set **all required secrets** (Section 1-2 in the env template):

```bash
ARANGO_PASSWORD=<strong-password>
JWT_SECRET=<strong-random-string>
SESSION_SECRET=<strong-random-string>
TRANSLATION_CACHE_PASSWORD=<strong-password>
POSTGRES_PASSWORD=<strong-password>
KONG_DB_PASSWORD=<strong-password>
KEYCLOAK_ADMIN_PASSWORD=<strong-password>
KEYCLOAK_DB_PASSWORD=<strong-password>
KEYCLOAK_CLIENT_SECRET=<strong-password>
AUTH_SERVICE_USERNAME=<username>
AUTH_SERVICE_PASSWORD=<strong-password>
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_SECURE=true
EMAIL_USER=your@email.com
EMAIL_PASSWORD=<smtp-password>
EMAIL_FROM=noreply@example.com
HUGGING_FACE_HUB_TOKEN=<hf-token>
```

Set **network/domain variables** (Section 12 in the env template). Replace `gateway.example.com` with your domain **or remote IP** (e.g., `10.0.0.110`):

```bash
NGINX_PUBLIC_DOMAIN=gateway.example.com
VUE_APP_API_URL=https://gateway.example.com/api
CSP_CONNECT_SRC='self' https://gateway.example.com wss://gateway.example.com
VUE_APP_CSP_CONNECT_SRC='self' https://gateway.example.com wss://gateway.example.com
CORS_ALLOWED_ORIGINS=https://gateway.example.com
```

**Note:** `VUE_APP_API_URL` is a runtime configuration variable, not a build-time variable. The frontend reads it from `window.APP_CONFIG` at startup (generated by `docker-entrypoint.sh`). Changing the domain or IP only requires updating `.env` and redeploying — no image rebuild needed.

To skip OPEA/AI services (no GPU required), set in `.env`:

```bash
DEPLOY_OPEA=0
```

## Step 7: Verify File Prerequisites

On the **manager node**, ensure these files exist:

```bash
# SSL certificates (required by nginx)
ls secrets/ssl/server.crt secrets/ssl/server.key
```

### Let's Encrypt (optional — automatic certificates)

Instead of manually placing certificates, you can use Let's Encrypt for automatic provisioning and renewal:

1. Set `CERTBOT_EMAIL` and `CERTBOT_REPLICAS` in `.env`:
   ```bash
   CERTBOT_EMAIL=your-email@example.com
   CERTBOT_REPLICAS=1
   ```
2. Ensure `NGINX_PUBLIC_DOMAIN` is set to your public FQDN.
3. Deploy normally — certbot starts automatically as part of the stack.

Certificates are automatically obtained, written to `secrets/ssl/`, and renewed every 12 hours. Nginx reloads automatically after renewal.

For testing, add `CERTBOT_STAGING=true` to `.env` to use Let's Encrypt's staging server.

**Prerequisites:** Port 80 must be accessible from the internet, and your domain must have a DNS A/AAAA record pointing to the gateway node.

## Step 8: Deploy

### 8a. Validate configuration

Before deploying, validate the compose file and environment:

```bash
set -a && source .env && set +a && docker compose config > /dev/null
```

Fix any errors before proceeding. This catches missing variables and syntax issues early.

### 8b. Deploy

From the project root on the **manager node**:

```bash
set -a && source .env && set +a
docker stack deploy -c docker-compose.yaml genieai
```

This creates a stack named `genieai`. All services start according to their placement constraints.

### With GPU-specific overrides:

```bash
set -a && source .env && source env.t4 && set +a && docker stack deploy -c docker-compose.yaml genieai
```

## Step 9: Post-Deploy — Kong Configuration

The `kong-config` one-shot service automatically configures Kong routes, services, and plugins after Kong starts. It runs as part of the stack deployment and completes in ~10-30 seconds.

No manual action is required. Monitor its progress:

```bash
docker service logs genieai_kong-config --tail 20
```

Once you see "Configuration restored successfully", Kong is ready to route traffic.

**Note:** Kong routes are unavailable until kong-config completes. Services calling Kong during this window will get 404s.

## Step 10: Verify Deployment

### Check service status:

```bash
# List all services
docker service ls

# Check specific service
docker service ps genieai_kong --no-trunc

# Check all tasks (look for errors)
docker stack ps genieai --no-trunc
```

### Verify placement:

```bash
# API Gateway services should be on gateway node
docker service ps genieai_kong --format "{{.Node}} {{.Name}}"
docker service ps genieai_nginx --format "{{.Node}} {{.Name}}"

# OPEA services should be on GPU node
docker service ps genieai_vllm --format "{{.Node}} {{.Name}}"
docker service ps genieai_embedding --format "{{.Node}} {{.Name}}"

# GENIE.AI services should be on remaining worker
docker service ps genieai_backend --format "{{.Node}} {{.Name}}"
docker service ps genieai_arango-vector-db --format "{{.Node}} {{.Name}}"
```

### Smoke tests:

```bash
# Backend health through Kong (run from manager node)
curl -sk https://localhost/api/health

# Frontend (should return HTML)
curl -sk https://localhost/

# Chat query (full RAG pipeline test)
# Use the web UI at https://<gateway-domain>/
```

## Step 11: Debugging Internal Services

Internal services are not exposed to the host. Use these methods:

### Docker exec:

```bash
# Get a shell inside a service container
docker exec -it $(docker ps --filter "name=genieai_backend" -q | head -1) bash

# Test connectivity between services from inside a container
docker exec $(docker ps --filter "name=genieai_backend" -q | head -1) \
  curl -s http://arango-vector-db:8529/_api/version
```

### Service logs:

```bash
# Logs from a specific service
docker service logs genieai_backend -f

# Logs from a specific task
docker service ps genieai_backend --no-trunc
docker logs <task-id> -f
```

### Attachable overlay network:

The overlay network is created with `attachable: true`, allowing debugging containers:

```bash
# Run a temporary container on the same network
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

# Named volumes persist after stack removal. To remove:
docker volume rm genieai_postgres_data
docker volume rm genieai_redis_data
docker volume rm genieai_doc_repo_uploads
docker volume rm genieai_arango_data

# Remove local registry (if no longer needed)
docker stop registry && docker rm registry
```

**Rollback from failed deployment:** `docker stack rm genieai` removes services but named volumes persist. Data in ArangoDB, Redis, and document uploads is preserved. Redeploy after fixing the issue.

## Step 13: Single-Node Swarm

For testing or small deployments, run all services on a single node:

### 13a. Localhost deployment

```bash
# Initialize Swarm
docker swarm init

# Label the single node for all services
docker node update --label-add gateway=true $(hostname)
docker node update --label-add gpu=true $(hostname)
docker node update --label-add genieai=true $(hostname)

# Start local registry
docker run -d -p 5000:5000 --name registry --restart=unless-stopped registry:2

# Build and push images (see Step 5a for explicit commands)
docker build -t genieai_mvp_frontend:latest components/gov-chat-frontend/
docker build -f components/gov-chat-backend/Dockerfile -t genieai_mvp_backend:latest components/
# ... tag and push (see Step 5b-5c)

# Configure .env (use localhost defaults)
cp env .env
# Edit .env with your secrets

# Deploy
set -a && source .env && set +a
docker stack deploy -c docker-compose.yaml genieai

# Remove the stack
docker stack rm genieai
```

### 13b. Remote node deployment (e.g., 10.0.0.110)

When deploying to a remote IP or domain instead of localhost, the only difference is the network variables in `.env`. The frontend image is generic — it reads `VUE_APP_API_URL` at runtime, no rebuild needed.

```bash
# 1. Initialize Swarm
docker swarm init
docker node update --label-add gateway=true $(hostname)
docker node update --label-add gpu=true $(hostname)
docker node update --label-add genieai=true $(hostname)
docker run -d -p 5000:5000 --name registry --restart=unless-stopped registry:2

# 2. Configure environment
cp env .env
# Edit .env with your secrets (ARANGO_PASSWORD, JWT_SECRET, etc.)
# Set network variables for remote access:
sed -i 's/^NGINX_PUBLIC_DOMAIN=.*/NGINX_PUBLIC_DOMAIN=10.0.0.110/' .env
sed -i "s|^VUE_APP_API_URL=.*|VUE_APP_API_URL=https://10.0.0.110/api|" .env
sed -i "s|^CSP_CONNECT_SRC=.*|CSP_CONNECT_SRC='self' https://10.0.0.110 wss://10.0.0.110|" .env
sed -i "s|^VUE_APP_CSP_CONNECT_SRC=.*|VUE_APP_CSP_CONNECT_SRC='self' https://10.0.0.110 wss://10.0.0.110|" .env
sed -i 's|^CORS_ALLOWED_ORIGINS=.*|CORS_ALLOWED_ORIGINS=https://10.0.0.110|' .env

# 3. Build all images (same as localhost — frontend is generic)
docker build -t genieai_mvp_frontend:latest components/gov-chat-frontend/
docker build -f components/gov-chat-backend/Dockerfile -t genieai_mvp_backend:latest components/
docker build -f components/document-repository/Dockerfile -t genieai_mvp_document-repository:latest components/
docker build -f genie-ai-overlay/http-service/Dockerfile -t genieai_mvp_http-service:latest .
docker build -t genie-ai-nginx:latest api-gateway-solution/nginx/
docker build -t genie-ai-kong-config:latest api-gateway-solution/new-config/

# 4. Tag and push to local registry
docker tag genieai_mvp_frontend:latest localhost:5000/genie-ai-frontend:latest
docker tag genieai_mvp_backend:latest localhost:5000/genie-ai-backend:latest
docker tag genieai_mvp_document-repository:latest localhost:5000/genie-ai-document-repository:latest
docker tag genieai_mvp_http-service:latest localhost:5000/genie-ai-http-service:latest
docker tag genie-ai-nginx:latest localhost:5000/genie-ai-nginx:latest
docker tag genie-ai-kong-config:latest localhost:5000/genie-ai-kong-config:latest

docker push localhost:5000/genie-ai-frontend:latest
docker push localhost:5000/genie-ai-backend:latest
docker push localhost:5000/genie-ai-document-repository:latest
docker push localhost:5000/genie-ai-http-service:latest
docker push localhost:5000/genie-ai-nginx:latest
docker push localhost:5000/genie-ai-kong-config:latest

# 5. Deploy
set -a && source .env && set +a
docker stack deploy -c docker-compose.yaml genieai

# 6. Verify
docker service ls
# Access https://10.0.0.110/ in your browser (self-signed cert warning is expected)
```

## External Identity Provider Support

GENIE.AI supports connecting external identity providers (Google, Microsoft Entra ID, institutional IdPs, any standard OIDC/SAML provider) through Keycloak. No GENIE.AI code or configuration changes are required.

See [External IdP Integration Guide](external-idp-integration-guide.md) for step-by-step instructions.

**Key points:**
- External IdPs are configured entirely within Keycloak (admin console or keycloak-config-cli)
- The Keycloak container must have network connectivity to the external IdP endpoints
- NGINX does not proxy external IdP traffic; Keycloak makes direct outbound connections
- External IdPs are **not available** in air-gapped deployments — only local Keycloak credentials work without internet connectivity

## Known Limitations

- **No application-level retry:** Backend and OPEA services crash if dependencies are unavailable at startup. Swarm restart policy handles this, but first deployment takes longer due to restart cycles (5-15 minutes for full stabilization).
- **GPU contention:** 5 services request 1 GPU each on the GPU node. VRAM is shared; use `env.t4` / `env.rtx6000` to manage batch size and model length limits. 24GB+ VRAM recommended.
- **No shared volumes:** If a node goes down, its stack goes down. No data migration between nodes.
- **DNS timing:** Swarm overlay DNS entries may not resolve immediately on first container start. Services with healthchecks handle this via restart cycles.
- **Kong config gap:** Kong routes are unavailable for ~10-30 seconds after Kong starts until the kong-config service completes.
- **Redis healthcheck:** Uses the `REDISCLI_AUTH` environment variable for authentication (password is not passed on the command line).

## Troubleshooting

### Service keeps restarting

```bash
# Check why a service is restarting
docker service ps genieai_<service-name> --no-trunc

# Check logs
docker service logs genieai_<service-name> --tail 50
```

Common causes:
- Missing bind mount directories on the target node
- Environment variable not set (check .env)
- GPU not available on the node (check node labels)
- Image not available on the target node (check registry)

### GPU services not scheduling

```bash
# Verify GPU node label
docker node inspect <gpu-node> --format '{{.Spec.Labels}}'

# Verify NVIDIA runtime
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Cross-node communication failing

```bash
# Verify overlay network
docker network inspect genieai_genieai_network

# Test DNS resolution from a container
docker exec $(docker ps -q | head -1) ping -c 1 backend
```

### DNS resolution delays

Swarm overlay DNS may have delays on first resolution. This causes services to fail on startup and get restarted by the restart policy. This is normal behavior — services stabilize after a few restart cycles.
