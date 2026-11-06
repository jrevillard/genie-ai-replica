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

### Internal — Observability (`ENABLE_OBSERVABILITY` controlled, container-only)
| Service | Port | Notes |
|---------|------|-------|
| OTel Collector (OTLP HTTP) | 4318 | Receives traces/metrics from app services |
| OTel Collector (fluent_forward) | 24224 | Receives container logs via Docker fluentd driver (localhost only) |
| OTel Collector (healthcheck) | 13133 | Internal only |
| VictoriaMetrics | 8428 | Internal only, Grafana queries this |
| VictoriaLogs | 9428 | Internal only, Grafana queries this |
| VictoriaTraces | 10428 | Internal only, Grafana queries this via Jaeger datasource |
| Grafana | 3000 (container) | Accessible via Kong route `/grafana/` (no direct host port) |

All services use the fluentd logging driver to forward stdout/stderr to the Collector. Docker dual logging (20.10+) keeps `docker logs` functional.

### Disabled (`replicas: 0`, not running)
| Service | Port | Reason |
|---------|------|--------|
| Guardrail | 9090 | Disabled |
| OPEA UI/Nginx | 5173 | Disabled |
| Certbot | — | One-shot, `CERTBOT_REPLICAS:-0` |

## The concept-document ceiling and the document-context budget

Two settings bound how large one concept document may be. They are **not** the
same number and they are **not** derived from one source:

| Setting | Owner | Default | Nature |
|---|---|---|---|
| `OKF_MAX_CONCEPT_DOC_CHARS` | okf-server | `250000` | A **static literal**. Bounds the characters in ONE concept document **body**. |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | dataprep | `0` | **Derived at runtime** from the context window the endpoint actually serves (`VLLM_ENDPOINT`). `0` = derive. |

Measured on the shipped defaults (500-char chunks, `per_chunk` strategy):

| Served context window | Derived document-context budget |
|---|---|
| 65536 tokens (compose default, `env.rtx6000`) | ≈ **219 700 characters** |
| 4096 tokens | **no room** — the output reservation alone (512 × 16 tokens) exceeds the window |
| 2048 tokens (`env.t4`) | **no room** — the same |

With no room, dataprep **fails closed**: the document is not contextualised at
all and its chunks are embedded raw, with an ERROR in the ingestion log naming
the knobs to lower.

**What an agent needs to know:**

- The derived budget (**≈219 700** on the default window) is **below** the
  ceiling's default (**250 000**). A concept at the ceiling therefore has its
  document context truncated on the default deployment — the truncation is
  recorded in the ingestion log, so check it after changing either value.
- **Never copy a budget from another deployment.** A budget sized for a
  65536-token window overflows a 2048-token one, and the rejected calls fall
  back to raw chunks *silently*.
- `VLLM_MAX_MODEL_LEN` is the **vLLM memory knob** (`--max-model-len`).
  Dataprep does **not** read it — it discovers the served window at runtime
  from `VLLM_ENDPOINT` (issue #1182). `DATAPREP_MAX_MODEL_LEN` is the lever on
  a provider whose `/v1/models` carries no `max_model_len`.
- The ceiling is enforced on **every** write path: the import splits (or
  rejects), the Studio editor refuses the save (409, nothing written), and
  the publish gate refuses **before** minting a version.
