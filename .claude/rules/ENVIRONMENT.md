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

## OKF import capacity — read this before tuning throughput

Two **independent pairs**, each of which only works when both halves move together.
An agent sizing a host must set both, or the extra half just queues.

| Pair | Creation side | Worker side | Raise one alone and… |
|---|---|---|---|
| **Import** | `OKF_IMPORT_CONCURRENCY` (default 4) | `PII_WEB_CONCURRENCY` (default 4) | extra lanes **queue at the PII sidecar** — latency up, throughput flat |
| **Drain** | `OKF_INGEST_CONCURRENCY` (default 1) | `DATAPREP_INGEST_CONCURRENCY` (default 1) | extra lanes get **429** from dataprep; the worker backs off and retries |

- **Rule of thumb: both halves ≈ `min(16, cores / 2)`.** Hardware-dependent, and
  nothing infers it. On 24 cores a `4`/`4` import pair measured **443 % CPU** on the
  PII sidecar while okf-server sat at **0.5 %** — about 18 % of the machine.
- **The pairs are limited by DIFFERENT things — that is why import ships at 4/4 and
  drain at 1/1, and it is not an oversight.** Import is bounded by the host's CPU
  (the PII scan runs locally). Drain is bounded by the **model services**: labelling
  calls the LLM and the embedding service, both shared and often on one GPU. Raising
  the drain pair does not use more of the machine — it queues on the model and, on a
  shared GPU, takes capacity away from chat answering. Size the drain pair against
  the model's headroom, NOT against the core count.
- **`PII_WEB_CONCURRENCY` is a memory knob**: worker *processes*, each holding its
  own ~400 MB language model. Do not raise it on a memory-constrained host.
- **Every import logs `OKF import lane capacity`** with both values and whether they
  are paired — check the log rather than inferring from timings.
- `OKF_INGEST_MAX_CONCEPTS` (default 1000) is a **capacity** setting, checked
  **after** the document-ceiling split, so the operator's document count is not the
  number the cap sees (999 documents measured → 1112 concepts). `OKF_INGEST_MAX_ZIP_BYTES`
  (256 MiB) is a **zip-bomb guard** — leave it alone on a working deployment.
