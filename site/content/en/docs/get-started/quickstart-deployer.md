---
title: "Quickstart: Deployer — single-host Compose deployment"
weight: 3
description: "Production-ready single-host deploy of GENIE.AI with Docker Compose: secrets, profiles, smoke test, observability, and common pitfalls."
mode: tutorial
persona: deployer
owner: docs-stewards
last_reviewed: 2026-09-19
---

## Goal

Stand up a **production-ready GENIE.AI stack on a single Linux host** with
`docker compose`. After this guide the chat UI is reachable at
`https://<your-host>` and:

- `/api/health` returns `200 OK`,
- an admin user can sign in via Keycloak and chat against a working RAG
  pipeline (when the OPEA profile is enabled),
- `/api/admin/system-health` shows all dependencies green,
- `/grafana/` (when the observability profile is enabled) exposes logs,
  metrics, and traces.

For multi-node production deployment (Swarm, remote GPU, Ansible), skip ahead
to [Docker Swarm Setup](/docs/deploy/docker-swarm-setup/).

## Prerequisites

- **Linux host** — Ubuntu 22.04+ recommended (matches the [install guide
  base](/docs/deploy/install-guide/)). macOS / WSL2 work for local dev.
- **Docker Engine 23+** with Compose v2 (`docker compose version` ≥ 2.20).
- **CPU / RAM budget** — official tiers from
  [Install Guide → Hardware requirements](/docs/deploy/install-guide/#step-1-hardware-requirements):

  | Profile combination | CPU | RAM | GPU | Notes |
  |---|---|---|---|---|
  | Core stack only | **8 vCPU** | **16 GB** | — | ArangoDB + Keycloak + Postgres + Redis + Backend + Frontend + VictoriaLogs + OTel Collector |
  | + OPEA on same host (T4) | 8 vCPU | 16 GB | **T4 16 GB** | Single-GPU, dev/MVP workload |
  | + OPEA on same host (RTX 6000) | 16 vCPU | 32 GB | **RTX 6000 24 GB** | Production single-node |
  | + Observability profile | +2 vCPU | **+2 GB RAM, +10 GB disk** | — | Adds VictoriaMetrics, VictoriaTraces, tempo-proxy, Grafana |
- **NVIDIA Container Toolkit** — required if any `--profile gpu-models`
  service runs on this host.
- **Hugging Face Hub token** (`HUGGING_FACE_HUB_TOKEN`) — required for any
  profile that pulls AI models (`opea`, `gpu-models`).
- **Outbound HTTPS** to `huggingface.co` and `registry.opensource.unicc.org`
  (image registry) on first run.

> {{< callout type="info" >}}
> This quickstart deploys the **core stack only**. OPEA, GPU models, and
> observability are profile-gated and added in Step 3 / Step 6. See
> [Compose → Profiles at a glance](/docs/deploy/docker-compose-setup/#profiles-at-a-glance)
> for the full matrix.
> {{< /callout >}}

### Verify it worked

```bash
docker --version            # Docker version 23.0+ (Compose v2 is bundled)
docker compose version      # Docker Compose version v2.20+
docker info | head -20      # confirms server is reachable
ls env                      # the env template exists at the repo root
```

## Step 1 — Clone and create `.env`

```bash
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai
cp env .env                   # never commit .env — it is gitignored
$EDITOR .env
```

The `env` file is a **template**: it documents every variable and ships
placeholder values for secrets. `.env` is your **local** file with real
secrets and is excluded by `.gitignore`.

> {{< callout type="warning" >}}
> Quote values containing `+`, `#`, `=`, or `!` in `.env` — bash and
> `docker compose` both interpret unquoted special chars. For Keycloak admin
> passwords especially, prefer `KEYCLOAK_ADMIN_PASSWORD='MyP@ss+word!'`.
> {{< /callout >}}

## Step 2 — Set required secrets

Every value below is required for a working stack. Generate strong random
values with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set these in `.env` (section anchors match the `env` template):

| Variable | Required when | Default / notes |
|---|---|---|
| `ARANGO_PASSWORD` | always | root password for ArangoDB |
| `TRANSLATION_CACHE_PASSWORD` | always | Redis auth (also becomes the `redis-cache` service password) |
| `POSTGRES_PASSWORD` | always | Postgres superuser |
| `KONG_DB_PASSWORD` | always | dedicated Kong user — **must differ** from `POSTGRES_PASSWORD` |
| `KEYCLOAK_DB_PASSWORD` | always | dedicated Keycloak user — **must differ** from `POSTGRES_PASSWORD` |
| `KEYCLOAK_ADMIN_PASSWORD` | always | master admin console password — used at `/auth/admin` |
| `GENIE_ADMIN_PASSWORD` | always | bootstrap admin in the `genie` realm — must satisfy the Keycloak password policy |
| `GENIE_ADMIN_EMAIL` | always | verified email for the admin user |
| `KEYCLOAK_CLIENT_SECRET` | always | OIDC secret for the `genie-app` frontend client |
| `KEYCLOAK_PROXY_CLIENT_SECRET` | always | service account for backend admin operations |
| `KC_DATAPREP_CLIENT_SECRET` | always | service account for dataprep (client_credentials grant) |
| `KC_GRAFANA_CLIENT_SECRET` | observability profile | OIDC secret for Grafana SSO |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` / `EMAIL_FROM` | always | SMTP for user verification (Keycloak warns but starts without it) |
| `HUGGING_FACE_HUB_TOKEN` | `opea` or `gpu-models` | pull AI models from `huggingface.co` |
| `VLLM_API_KEY` | remote GPU node | `Authorization: Bearer` for the GPU node's nginx |
| `GRAFANA_ADMIN_PASSWORD` | observability profile | initial admin password (rotated after first SSO login) |

**Verify** — no placeholder values remain:

```bash
grep -nE '(change-me|^[^#]*PASSWORD=($|\s*$))' .env
# (no lines printed except comments)
```

## Step 3 — Choose your profiles

The single `docker-compose.yaml` exposes **profile-gated services**. Pick one
per axis. Service names below are the real `docker compose` service names
(use them as-is in `docker compose logs <service>`, `docker compose ps`,
etc.):

| Profile | Services started (`docker compose ps` names) | When to enable |
|---|---|---|
| _(none)_ | `nginx`, `frontend`, `backend`, `arango-vector-db`, `keycloak`, `postgres`, `redis-cache`, `clamav`, `document-repository`, `db-migrations`, `kong`, `kong-migrations`, `kong-config`, `keycloak-config`, `postgres-init`, `otel-collector`, `otel-collector-init`, `victorialogs` | every deploy — admin endpoints need VictoriaLogs |
| `opea` | adds `chatqna-xeon-backend-server`, `retriever-arango-service`, `dataprep-arango-service`, `embedding`, `reranker`, `textgen`, `translation`, `guardrail` (orchestrators — no GPU containers yet) | RAG pipeline |
| `gpu-models` | adds `vllm`, `tei`, `tei_reranker`, `vllm-translation-guardrail` (GPU containers — require NVIDIA runtime) | when the GPU is on this host |
| `observability` | adds `victoriametrics`, `victoriatraces`, `tempo-proxy`, `grafana` (in addition to the always-on `victorialogs`) | metrics / traces / Grafana dashboards |
| `letsencrypt` | adds `certbot` (one-shot, requires `CERTBOT_EMAIL`) | production TLS renewal |

Typical combinations:

```bash
# 1. Dev — core only (no AI, no metrics, no GPU)
docker compose up -d

# 2. Local-GPU full stack (T4 / RTX 6000 on this host)
docker compose --profile opea --profile gpu-models up -d

# 3. Production — core + observability
docker compose --profile observability up -d

# 4. Everything on one host
docker compose --profile opea --profile gpu-models --profile observability up -d
```

For **remote GPU topology** (AI services on a separate node) — see
[Step 7](#step-7--remote-gpu-node-optional) below and the full
[Remote GPU Node guide](/docs/deploy/docker-swarm-setup/#remote-gpu-node).

## Step 4 — Bring the stack up

```bash
docker compose up -d
docker compose ps
```

Expected output once healthy (~2 min on first run — model pulls / DB
migrations can add another 5–10 min when `gpu-models` is enabled):

```
NAME                              SERVICE            STATUS              PORTS
genie-ai-nginx-1                  nginx              running (healthy)   0.0.0.0:443->443/tcp
genie-ai-frontend-1               frontend           running (healthy)
genie-ai-backend-1                backend            running (healthy)
genie-ai-arango-vector-db-1       arango-vector-db   running (healthy)   0.0.0.0:8529->8529/tcp
genie-ai-keycloak-1               keycloak           running (healthy)
genie-ai-victorialogs-1           victorialogs       running (healthy)
genie-ai-otel-collector-1         otel-collector     running (healthy)
genie-ai-redis-cache-1            redis-cache        running (healthy)
genie-ai-postgres-1               postgres           running (healthy)
genie-ai-kong-1                   kong               running (healthy)
genie-ai-clamav-1                 clamav             running (healthy)
genie-ai-document-repository-1    document-repository running (healthy)
```

> The container prefix `genie-ai-` comes from the Compose project name
> (defaults to the directory name). Override with `docker compose --project-name <name> up -d`.

Service health probes are wired in the compose file; a service still in
`starting` is normal during cold start. Give it 60–90 s before troubleshooting.

### Verify it worked

```bash
# 1. All services should report 'running (healthy)' or 'running' for stateless helpers
docker compose ps --format json | jq -r '.[] | "\(.Service): \(.Health // "no healthcheck")"'

# 2. Wait until the dependency chain is ready (Keycloak needs DB + keycloak-config)
docker compose ps keycloak kong keycloak-config | grep -E "running|healthy"

# 3. Tail logs for any service stuck in 'starting' longer than 90 s
docker compose logs -f --tail=100 <service-name>
```

## Step 5 — Smoke test

Three checks, in order. Stop at the first failure.

### 5.1 Public liveness

```bash
curl -sk https://localhost/api/health
# {"status":"ok","serverTime":"...","uptime":"... seconds"}
```

If you see a JSON 500 or a non-JSON HTML page, the frontend/nginx layer is up
but the backend is not — check `docker compose logs backend`.

### 5.2 Sign in and run a query

1. Open `https://localhost` — accept the self-signed cert (dev only).
2. Click **Sign in**. Keycloak redirects you to `https://localhost/auth/...`.
3. Sign in as the bootstrap admin (`GENIE_ADMIN_USERNAME`, default
   `genie-admin`, with the password you set in `.env` → `GENIE_ADMIN_PASSWORD`).
4. Land back on an empty conversation. Type a question and send.

If `opea` is enabled and a real document is uploaded, you get a sourced
answer. Without `opea`, the backend returns a "pipeline unavailable" error
and the chat page shows it gracefully.

### 5.3 Admin dashboard

Navigate to `https://localhost/api/admin/system-health` (requires the
`admin` realm role — the bootstrap admin has it via
`configs/keycloak/genie-realm.yaml`). Expect every dependency (ArangoDB,
Keycloak, OPEA when enabled) green. For probe semantics, see
[Health Checks](/docs/operate/health-checks/).

## Step 6 — Enable observability (optional)

Set in `.env` (or as a runtime override):

```bash
ENABLE_OBSERVABILITY=1
GRAFANA_ADMIN_PASSWORD=<strong-password>
GRAFANA_ADMIN_USER=admin               # default — only override if you changed it
KC_GRAFANA_CLIENT_ID=grafana           # default
KC_GRAFANA_CLIENT_SECRET=<secret>
VICTORIAMETRICS_RETENTION=30d          # default
VICTORIALOGS_RETENTION=30d             # default
VICTORIATRACES_RETENTION=30d           # default
OTEL_TRACES_SAMPLER_RATE=100.0         # default = 100% sampling
```

Then redeploy with the profile:

```bash
docker compose --profile observability up -d
```

Grafana is reachable at `https://localhost/grafana/` (single sign-on via
Keycloak — the bootstrap admin has the **Admin** role, mapped via the
`realm_access.roles[*] == admin` rule in `docker-compose.yaml`). Pre-built
dashboards cover service health, traces, logs, RAG pipeline waterfall, and
infrastructure. For the full feature list see
[Observability](/docs/observe/overview/).

> **Always-on substrate** — VictoriaLogs and OTel Collector are in the
> default profile (`replicas: 1` hardcoded for VictoriaLogs, `mode: global`
> for OTel Collector). They power the in-app Logs tab for operators and run
> regardless of `ENABLE_OBSERVABILITY`. The `--profile observability` flag
> adds the rest (VictoriaMetrics, VictoriaTraces, tempo-proxy, Grafana).

### Verify it worked

```bash
# Confirm Grafana route is reachable (expect HTTP 302 redirect to Keycloak login)
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/grafana/login

# Confirm VictoriaLogs backend is up (internal check from a running container)
docker compose exec victorialogs wget -qO- http://127.0.0.1:9428/health

# Confirm Grafana SSO works — sign in as the bootstrap admin, you should land on the default dashboard
```

## Step 7 — Remote GPU node (optional)

For production scale-out, keep AI services on a dedicated GPU host. The app
node has no GPU containers and reaches the GPU node via HTTPS.

Set on the **app node** in `.env`:

```bash
GPU_NODE_HOST=<gpu-node-ip-or-hostname>     # e.g. gpu.example.com
GPU_MODEL_REPLICAS=0                        # Docker Swarm: scale GPU containers (vllm, tei, tei_reranker) to 0 on the app node. Docker Compose: omit --profile gpu-models — the env var is ignored (gpu-models is profile-gated).
VLLM_API_KEY=<api-key>                      # Authorization: Bearer on GPU node nginx
OPEA_SSL_SKIP_VERIFY=1                      # ONLY if GPU node uses self-signed certs
KEYCLOAK_SSL_SKIP_VERIFY=1                  # ONLY if Keycloak uses self-signed certs
NODE_TLS_REJECT_UNAUTHORIZED=0              # ONLY if NGINX on this host uses self-signed
```

> **Security**: in production set `OPEA_SSL_SKIP_VERIFY=0`,
> `KEYCLOAK_SSL_SKIP_VERIFY=0`, `NODE_TLS_REJECT_UNAUTHORIZED=1` — the
> `=1`/`=0` overrides are dev-only. See the
> [self-signed cert table](/docs/deploy/docker-swarm-setup/#self-signed-certificates--quick-reference)
> for the full matrix.

Then redeploy with `--profile opea` only (no `gpu-models`):

```bash
docker compose --profile opea up -d
```

GPU node deployment is owned by Ansible —
see [Docker Swarm Setup → Remote GPU Node](/docs/deploy/docker-swarm-setup/#remote-gpu-node)
and `deploy/ansible/README.md`.

### Verify it worked

```bash
# Confirm env vars are correctly substituted into the Compose config
docker compose config | grep -E "GPU_NODE_HOST|VLLM_API_KEY|GPU_MODEL_REPLICAS"

# Confirm GPU-model services are scaled to 0 on the app node
docker compose ps vllm tei tei_reranker vllm-translation-guardrail 2>&1 | grep -E "no such|service not found"
# (the app node should NOT have these services running — they live on the GPU node)

# Confirm chatqna can reach the GPU node
docker compose exec chatqna-xeon-backend-server curl -sf http://${GPU_NODE_HOST}/health
```

## Step 8 — Post-deploy operations

| Task | Where to go |
|---|---|
| Search service logs | **Admin → Logs** in the web UI (VictoriaLogs-backed, always-on) |
| Health probes | `/api/health` (public), `/api/admin/system-health` (admin Keycloak `admin` role) |
| Grafana dashboards | `https://localhost/grafana/` (SSO via Keycloak) |
| Daily ArangoDB backup | [Backup & Restore → ArangoDB](/docs/operate/backup-restore/) (default backup dir: `./data/database_backups` — override with `BACKUP_DIR`) |
| Apply schema migrations | `docker compose up -d db-migrations` (runs once on first start; `restart: "no"`) |
| Rotate a secret | Update `.env`, then `docker compose up -d <service>` — Compose recreates only the dependent containers |
| Tail a single service | `docker compose logs -f --tail=200 <service>` |
| Rotate TLS cert (production) | `docker compose --profile letsencrypt up -d certbot` (requires `CERTBOT_EMAIL`) |

For monitoring and alerting wiring (Prometheus scrape, OTel collector
config, retention tuning) see
[Observability](/docs/observe/overview/),
[Observability → Configuration](/docs/observe/configuration/),
[Observability → Alerting](/docs/observe/alerting/), and
[Scaling](/docs/operate/scaling/).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `arango-vector-db` exits with `database is locked` | Stale data from a previous test (volume not cleared) | `docker compose down -v && docker compose up -d` — **deletes the volume**, back up first via [Backup & Restore](/docs/operate/backup-restore/) |
| `keycloak` stays in `starting` indefinitely | `KEYCLOAK_ADMIN_PASSWORD` not set, or contains unescaped special chars (`+`, `#`, `!`) | Quote the password in `.env` (e.g. `KEYCLOAK_ADMIN_PASSWORD='MyP@ss+word!'`); `docker compose restart keycloak` |
| `keycloak-config` fails: "user exists" | Realm already imported (re-running after partial failure) | `docker compose down -v keycloak-config postgres` then `docker compose up -d` — the realm import is idempotent only on a fresh DB |
| `nginx` returns 502 | Backend not yet healthy, or ArangoDB still migrating | `sleep 30 && curl -sk https://localhost/api/health`; check `docker compose logs backend` |
| `vllm` / `tei` / `tei_reranker` fail to start | GPU runtime missing, NVIDIA driver mismatch, or `gpu=true` label missing (Swarm only) | `nvidia-smi` (host-level check); `docker info \| grep -i nvidia` (expect `nvidia` in runtimes list); for Swarm, ensure the node has label `gpu=true` (single-host Compose does not need labels) |
| `vllm` / `tei` pull fails with `401 Unauthorized` | `HUGGING_FACE_HUB_TOKEN` missing or revoked | Set a valid token in `.env`, then `docker compose pull && docker compose up -d` |
| `vllm` OOMs on first request | `VLLM_GPU_UTILIZATION` or model size exceeds GPU VRAM | Lower `VLLM_GPU_UTILIZATION` (default `0.55`) or use the `env.t4` / `env.rtx6000` overlays from [GPU Deployment](/docs/deploy/gpu/) |
| Browser refuses the certificate | Self-signed dev cert (expected in dev) | Click through; for production put a real cert in `secrets/ssl/` and re-deploy (`secrets/ssl/server.crt`, `secrets/ssl/server.key`) |
| `/api/admin/system-health` shows Keycloak red | `KEYCLOAK_URL` mismatch — backend cannot reach `/auth` over the public hostname | Confirm `NGINX_PUBLIC_DOMAIN` resolves to the host; the compose `extra_hosts` entry handles `localhost` automatically; for a remote domain, ensure DNS resolves from inside the Docker network |
| `/api/admin/system-health` returns 403 Forbidden | Signed in as a non-admin user | The bootstrap admin (`GENIE_ADMIN_USERNAME`, default `genie-admin`) has the realm `admin` role assigned in `configs/keycloak/genie-realm.yaml` — verify by signing in to the genie app with `GENIE_ADMIN_USERNAME` + `GENIE_ADMIN_PASSWORD` from `.env`. To inspect the realm-role mapping, sign in to `/auth/admin` with `KEYCLOAK_ADMIN_PASSWORD` (the **master-realm** admin — different user, used only for Keycloak Admin UI inspection). |
| Backend logs `MODULE_NOT_FOUND: ../shared/lib/...` at runtime | Dockerfile drops the `/lib/` segment when copying `shared/lib` into the image (line 15 maps `shared/lib` to `./shared-lib`, but `tracing.js` requires `../shared/lib/...`) — a known footgun where unit tests pass (real fs) but the containerized app crashes. The root cause is the COPY path, not the build cache — a plain `docker compose build` reproduces the bug. | Fix the Dockerfile COPY destination on line 15 (so the runtime path matches what `tracing.js` requires) — or update the `require` path in `tracing.js` to match the image layout — then rebuild. See [Troubleshooting](/docs/operate/troubleshooting/). |
| `grafana` shows "No data" on every panel | Observability profile not enabled, or `ENABLE_OBSERVABILITY=0` | Add `--profile observability` and set `ENABLE_OBSERVABILITY=1`; restart with `docker compose up -d` |
| `chatqna` 503 "pipeline unavailable" | `opea` profile not enabled, or GPU node unreachable | Confirm `--profile opea` (or `--profile gpu-models` on the GPU host) was passed at `up -d`; check `docker compose logs chatqna-xeon-backend-server` |
| `kong-config` keeps restarting | `ENABLE_OBSERVABILITY` mismatch between compose service and keycloak-config | Both should read the same `.env` value — check `docker compose config \| grep ENABLE_OBSERVABILITY` |
| Containers stuck in "starting" / `unhealthy` | Slow first start — Postgres + Keycloak + keycloak-config chain takes 60-120 s on cold start | Wait 90 s; `docker compose ps` to confirm none are in restart-loop |

## What's next

- **Add OPEA + GPU** locally → Step 3 (`--profile opea --profile gpu-models`).
  See [GPU Deployment](/docs/deploy/gpu/) for `env.t4` / `env.rtx6000`
  tuning.
- **Add observability** → Step 6.
- **Move to Swarm** for multi-node production →
  [Docker Swarm Setup](/docs/deploy/docker-swarm-setup/) and
  [Ansible deployment](/docs/deploy/install-guide/).
- **Customize the realm** (LDAP, custom themes, additional clients) →
  [Configure → Keycloak admin guide](/docs/configure/keycloak-admin-guide/).
- **Tune the RAG pipeline** (labeling, retrieval, prompts) →
  [Configuration reference](/docs/reference/env-vars/).
- **Harden for production** (TLS, secrets, image CVE scan) →
  [Security hardening](/docs/operate/security-hardening/).

## Related

- [Install: Docker Compose](/docs/deploy/docker-compose-setup/) — full reference
- [Install: Docker Swarm](/docs/deploy/docker-swarm-setup/) — production multi-node
- [GPU Deployment](/docs/deploy/gpu/) — T4 / RTX 6000 / A40 profiles
- [Configuration reference](/docs/reference/env-vars/) — every env var
- [Operate → Health Checks](/docs/operate/health-checks/) — `/api/health` semantics
- [Operate → Admin Logs](/docs/operate/admin-logs/) — the in-app Logs tab
- [Operate → Troubleshooting](/docs/operate/troubleshooting/) — deeper playbook