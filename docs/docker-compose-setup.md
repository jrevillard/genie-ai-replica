# Docker Compose Setup Guide (Single-Node)

This guide covers local single-node deployment using `docker compose up`. For multi-node production deployments with Docker Swarm, see [Docker Swarm Deployment Guide](docker-swarm-setup.md).

GENIE.AI uses a single dual-mode `docker-compose.yaml` at the project root that works with both `docker compose up` and `docker stack deploy`.

## Prerequisites

- **Docker Engine 23+** with Compose v2 (`docker compose` subcommand)
- **NVIDIA Container Toolkit** (only if using OPEA/GPU services)
- **Hugging Face API token** (only if using OPEA/GPU services)

## Architecture Overview

All services run on a single host. Two deployment profiles are available:

| Profile | Command | Services |
|---------|---------|----------|
| **Core** | `docker compose up -d` | Frontend, Backend, ArangoDB, Redis, Document Repository, ClamAV, Kong, NGINX |
| **Full (OPEA)** | `docker compose --profile opea up -d` | Core + vLLM, TEI, Retriever, Dataprep, ChatQnA, Translation |

## Step 1: Clone Repository

```bash
git clone https://github.com/your-org/GENIE.AI.git
cd GENIE.AI
```

## Step 2: Prepare Directories

```bash
mkdir -p data/logs/kong data/logs/backend data/logs/doc-repo data/database_backups secrets/ssl
```

| Directory | Purpose |
|-----------|---------|
| `data/logs/kong` | Kong gateway logs |
| `data/logs/backend` | Backend API logs |
| `data/logs/doc-repo` | Document Repository logs |
| `data/database_backups` | Backend DB dumps |
| `secrets/ssl` | SSL certificates (optional — auto-generated if missing) |

## Step 3: Configure Environment

```bash
cp env .env
```

Edit `.env` and set the required secrets:

```bash
ARANGO_PASSWORD=<strong-password>
JWT_SECRET=<strong-random-string>
SESSION_SECRET=<strong-random-string>
TRANSLATION_CACHE_PASSWORD=<strong-password>
POSTGRES_PASSWORD=<strong-password>
KONG_DB_PASSWORD=<strong-password>
KEYCLOAK_ADMIN_PASSWORD=<strong-password>
GENIE_ADMIN_PASSWORD=<strong-password>
KEYCLOAK_DB_PASSWORD=<strong-password>
KEYCLOAK_CLIENT_SECRET=<strong-random-string>
KEYCLOAK_PROXY_CLIENT_SECRET=<strong-random-string>
SERVICE_AUTH_TOKEN=<strong-random-string>
```

Generate strong passwords with: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`

**Important:** `KONG_DB_PASSWORD` and `KEYCLOAK_DB_PASSWORD` must differ from `POSTGRES_PASSWORD` — they protect dedicated PostgreSQL users.

Set network/domain variables. Use `localhost` for local development, or your server IP/domain for remote access:

```bash
# Local development
NGINX_PUBLIC_DOMAIN=localhost
VUE_APP_API_URL=https://localhost/api
CSP_CONNECT_SRC='self' https://localhost wss://localhost
CORS_ALLOWED_ORIGINS=https://localhost
```

```bash
# Remote access (e.g., 10.0.0.110)
NGINX_PUBLIC_DOMAIN=10.0.0.110
VUE_APP_API_URL=https://10.0.0.110/api
CSP_CONNECT_SRC='self' https://10.0.0.110 wss://10.0.0.110
CORS_ALLOWED_ORIGINS=https://10.0.0.110
```

For OPEA/GPU services, also set:

```bash
HUGGING_FACE_HUB_TOKEN=<hf-token>
```

See the `env` template for the full list of variables and their descriptions.

## Step 4: SSL Certificates

SSL certificates are **optional**. The nginx container automatically generates self-signed certificates on startup if none are found at `secrets/ssl/`.

### Option A: Self-signed (default)

No action needed. Self-signed certificates are auto-generated. Browser warnings are expected.

### Option B: Manual certificates

Place your own certificates:

```bash
cp /path/to/server.crt secrets/ssl/
cp /path/to/server.key secrets/ssl/
```

### Option C: Let's Encrypt (automatic)

For automatic SSL certificate provisioning and renewal:

1. Set `CERTBOT_EMAIL` in `.env`:
   ```bash
   CERTBOT_EMAIL=your-email@example.com
   ```
2. Ensure `NGINX_PUBLIC_DOMAIN` is set to your public FQDN (not `localhost`).
3. Deploy with the `letsencrypt` profile:
   ```bash
   docker compose --profile letsencrypt up -d
   ```

Certificates are automatically obtained, written to `secrets/ssl/`, and renewed every 12 hours. Nginx reloads automatically after renewal.

For testing, add `CERTBOT_STAGING=true` to `.env` to use Let's Encrypt's staging server (avoids rate limits).

**Prerequisites:** Port 80 must be accessible from the internet, and your domain must have a DNS A/AAAA record pointing to your server.

## Step 5: Build Images

The compose file includes `build:` directives alongside `image:` for all custom services. Build them with:

```bash
# Build all custom images
docker compose build

# Or build a specific service
docker compose build backend
```

For OPEA services (only if using `--profile opea`):

```bash
docker compose --profile opea build
```

## Step 6: Deploy

### 6a. Validate configuration

```bash
docker compose config > /dev/null
```

Fix any errors before proceeding.

### 6b. Start core services

```bash
docker compose up -d
```

This starts: Frontend, Backend, ArangoDB, Redis, Document Repository, ClamAV, Kong, NGINX, and Keycloak.

### 6c. Start full stack with OPEA

If you have a GPU and want the full RAG pipeline:

```bash
docker compose --profile opea up -d
```

### 6d. With GPU-specific settings

For NVIDIA T4 (16GB VRAM):

```bash
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

For RTX 6000 ADA (24GB VRAM):

```bash
docker compose --env-file .env --env-file env.rtx6000 --profile opea up -d
```

## Step 7: Post-Deploy — Kong Configuration

The `kong-config` one-shot service automatically configures Kong routes, services, and plugins after Kong starts. It runs once and completes in ~10-30 seconds.

Monitor its progress:

```bash
docker compose logs kong-config --tail 20
```

Once you see "Configuration restored successfully", Kong is ready to route traffic.

**Note:** Kong routes are unavailable until kong-config completes. Services calling Kong during this window will get 404s.

## Step 8: Post-Deploy — Keycloak Identity Provider

Keycloak is started automatically with the core stack and proxied by NGINX at `/auth/*`. The `keycloak-config` one-shot service applies realm configuration (clients, roles, mappers) after Keycloak is healthy.

### Verify Keycloak health:

```bash
docker compose ps keycloak
docker compose logs keycloak-config --tail 10
```

### Admin console:

- **URL**: `https://<NGINX_PUBLIC_DOMAIN>/auth/admin/`
- **Username**: `admin`
- **Password**: `<KEYCLOAK_ADMIN_PASSWORD>` from `.env`

**GENIE realm admin user** (separate from master admin, used for frontend login):
- **Username**: `genie-admin` (default, configurable via `GENIE_ADMIN_USERNAME`)
- **Password**: `<GENIE_ADMIN_PASSWORD>` from `.env`
- Has `admin` realm role — grants admin access in the GENIE.AI frontend

### Keycloak environment variables:

See Section 9 of the `env` template for all available variables. Key ones:

| Variable | Default | Description |
|----------|---------|-------------|
| `KEYCLOAK_REALM` | `genie` | Realm name |
| `KEYCLOAK_CLIENT_ID` | `genie-app` | OIDC client ID |
| `KEYCLOAK_URL` | `https://<domain>/auth` | Public URL (auto-set from NGINX_PUBLIC_DOMAIN) |
| `KEYCLOAK_ADDITIONAL_REALMS` | — | Additional realms (JSON format, optional) |

For external IdP integration (Google, Microsoft, etc.), see [External IdP Integration Guide](keycloak-admin-guide.md).

## Step 9: Verify Deployment

### Check service status:

```bash
# List all running services
docker compose ps

# Check logs for a specific service
docker compose logs backend --tail 20
```

### Smoke tests:

```bash
# Backend health through Kong
curl -sk https://localhost/api/health

# Frontend (should return HTML)
curl -sk https://localhost/
```

### Access the application:

- **Web UI**: `https://localhost/` (self-signed cert warning is expected)
- **API Docs**: `https://localhost/api-docs`

## Step 10: Useful Commands

```bash
# View logs (follow mode)
docker compose logs -f <service-name>

# Restart a specific service
docker compose restart <service-name>

# Rebuild after code changes
docker compose build <service-name>
docker compose up -d <service-name>

# Stop all services
docker compose down

# Stop and remove volumes (data loss)
docker compose down -v
```

## Step 11: Debugging

### Execute commands inside a running container:

```bash
docker compose exec backend bash
docker compose exec arango-vector-db arangosh
```

### Test connectivity between services:

```bash
docker compose exec backend curl -s http://arango-vector-db:8529/_api/version
```

### Run a temporary container on the same network:

```bash
docker compose run --rm curlimages/curl curl -s http://backend:3000/api/health
```

## Teardown

```bash
# Stop all services (volumes and data preserved)
docker compose down

# Remove everything including named volumes (data loss)
docker compose down -v
```

## Troubleshooting

### Service fails to start

```bash
# Check logs
docker compose logs <service-name> --tail 50

# Check if a dependency is unhealthy
docker compose ps
```

Common causes:
- Environment variable not set in `.env`
- Port already in use (check with `ss -tlnp | grep <port>`)
- SSL certificate warnings in browser (expected with self-signed certs — see Step 4)

### GPU services not starting

```bash
# Verify NVIDIA runtime
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi

# Check GPU service logs
docker compose logs vllm --tail 50
```

### Kong routes returning 404

Wait for the `kong-config` service to complete (Step 7). Also check that `keycloak-config` completed (Step 8). If either failed:

```bash
docker compose logs kong-config
docker compose restart kong-config
```

### DNS resolution delays

Unlike Swarm, `docker compose up` handles startup ordering via `depends_on`. Services wait for their dependencies to be healthy before starting. If a service still fails, check its healthcheck status:

```bash
docker compose ps  # shows health status for each service
```

## Next Steps

- **Production deployment**: See [Docker Swarm Deployment Guide](docker-swarm-setup.md) for multi-node, production-grade deployments with Ansible.
- **Ansible automation**: See `deploy/ansible/README.md` for automated Swarm deployment.
- **GPU configuration**: See `env.t4` and `env.rtx6000` for GPU-specific tuning.
