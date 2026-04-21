# Environment Files Convention

## Standard
- **`env`** (no extension, project root) = Configuration template, committed to git
- **`.env`** (with dot, project root) = Local variables, **NEVER committed** (gitignored)

## Local initialization
On first start or after cloning the repo:

```bash
cp env .env
# Then edit .env with your local values (passwords, API keys, etc.)
```

## Docker Compose
Services read variables via `env_file` in `docker-compose.yaml` or system environment variables.

**IMPORTANT:** Use the root `docker-compose.yaml` for all operations:

```bash
# Core services only
docker compose up -d

# Full stack with OPEA
docker compose --profile opea up -d

# Rebuild a specific service
docker compose build [service_name]
```

## NEVER commit
- `.env*` files → Contain secrets, are in `.gitignore`
- `env` files (no extension) → Templates, can be committed

## .gitignore
Root `.gitignore` covers project-wide rules. Some components have their own `.gitignore` (e.g., `components/document-repository/`, `mobile/`) for framework-specific patterns (node_modules, coverage, etc.).

## Service Ports

In Swarm mode, only nginx and ArangoDB are exposed on the host. All other services are internal (inter-container only).

### Exposed (host-accessible, configurable via `.env`)
| Service | Port | Variable |
|---------|------|----------|
| Nginx (HTTP) | 80 | `NGINX_HTTP_PORT` |
| Nginx (HTTPS) | 443 | `NGINX_HTTPS_PORT` |
| ArangoDB | 8529 | `ARANGO_PORT` |

### Internal — GENIE.AI Core (container-only)
| Service | Port |
|---------|------|
| Frontend | 5173 |
| Backend | 3000 |
| Document Repository | 3001 |
| Dataprep | 5000 |
| Redis | 6379 |
| ClamAV | 3310 |
| Keycloak | 8080 |
| Kong | 8000 |
| PostgreSQL | 5432 |

### Internal — OPEA/AI (`DEPLOY_OPEA` controlled, container-only)
| Service | Port |
|---------|------|
| vLLM | 8000 |
| TEI Embedding | 80 |
| Embedding | 6000 |
| TEI Reranker | 80 |
| Retriever | 7000 |
| Reranker | 8000 |
| ChatQnA | 8888 |
| Translation | 9031 |

### Disabled (`replicas: 0`, not running)
| Service | Port | Reason |
|---------|------|--------|
| Guardrail | 9090 | Disabled |
| OPEA UI/Nginx | 5173 | Disabled |
| Certbot | — | One-shot, `CERTBOT_REPLICAS:-0` |
