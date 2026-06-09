# GENIE.AI - Ansible Deployment

Automated Docker Swarm deployment for GENIE.AI using Ansible with per-environment secrets.

## Prerequisites

- **Ansible 2.15+** / ansible-core 2.15+ (control machine)
- **community.docker 4.x** collection
- **SSH access** to the target node
- **Ansible Vault password** per environment
- **Git deploy key** on the target node (for `git clone`)

## Quick Start

```bash
cd deploy/ansible

# 1. Install Ansible collections
ansible-galaxy collection install -r requirements.yml

# 2. Create inventory for your environment
cp inventory/inventory.example inventory/my-env.ini
# Edit inventory/my-env.ini with your host IP and environment group

# 3. Create environment config directory
mkdir -p group_vars/my-env

# 4. Set non-secret config
cp group_vars/itu_rtx_test/vars.yml group_vars/my-env/vars.yml
# Edit: set domains, ports, email, OPEA settings, etc.

# 5. Create encrypted secrets
ansible-vault create group_vars/my-env/vault.yml
# Fill in all required secrets (see "Required Vault Secrets" below)

# 6. Place SSL certificates (or set self_signed_certs: true)
mkdir -p files/certificates/my-env
cp server.crt server.key files/certificates/my-env/
# Alternatively: enable Let's Encrypt in vars.yml (see Let's Encrypt section below)

# 7. Deploy
ansible-playbook -i inventory/my-env.ini deploy.yml --vault-id my-env@prompt
```

## Multi-Environment Setup

Each environment uses a **directory** under `group_vars/` containing:

| File | Purpose |
|------|---------|
| `group_vars/<env>/vars.yml` | Non-secret config (domains, ports, email, OPEA) |
| `group_vars/<env>/vault.yml` | Encrypted secrets (Ansible Vault) |

Plus shared config from `group_vars/all.yml` (always loaded).

Other per-environment files:
- **Inventory** (`inventory/<env>.ini`)
- **SSL certificates** (`files/certificates/<env>/`)

### Environment group naming

Use **underscores** in group names (e.g. `itu_rtx_test`, not `itu-rtx-test`). Hyphens in group names cause Ansible warnings.

### Creating a new environment

```bash
# 1. Create inventory
cp inventory/inventory.example inventory/staging.ini
# Edit: set [staging] group, update host IP

# 2. Create environment config directory
mkdir -p group_vars/staging
cp group_vars/itu_rtx_test/vars.yml group_vars/staging/vars.yml
# Edit: set staging-specific values (domains, ports, email, etc.)

# 3. Create encrypted secrets
ansible-vault create group_vars/staging/vault.yml
# Fill in all required secrets (see below)

# 4. Place SSL certificates (or enable Let's Encrypt in vars.yml)
mkdir -p files/certificates/staging
cp server.crt server.key files/certificates/staging/

# 5. Deploy to staging
ansible-playbook -i inventory/staging.ini deploy.yml --vault-id staging@prompt
```

### Vault passwords

Each environment uses its own vault password. Two methods:

**Interactive (prompts per environment):**
```bash
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --vault-id itu_rtx_test@prompt
```

**Password files (for CI/CD or automation):**
```bash
# Store passwords (gitignored)
echo "test-vault-password" > .vault-pass-itu_rtx_test

# Use them
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --vault-id itu_rtx_test@.vault-pass-itu_rtx_test
```

**Legacy `--ask-vault-pass` (single password for all environments):**
```bash
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --ask-vault-pass
```

## Inventory Setup

Each inventory file puts the host in an environment group. Ansible automatically loads all files from `group_vars/<group>/`.

```ini
# inventory/itu_rtx_test.ini
[itu_rtx_test]
genieai-test ansible_host=10.0.0.110

[swarm_managers]
genieai-test

[gpu_nodes]
genieai-test

[all:vars]
ansible_user=jerome
```

## Required Vault Secrets

Set in `group_vars/<env>/vault.yml`:

| Variable | Description |
|----------|-------------|
| `arango_password` | ArangoDB root password |
| `session_secret` | Session encryption secret |
| `translation_cache_password` | Redis cache password |
| `postgres_password` | PostgreSQL superuser password |
| `kong_db_password` | PostgreSQL dedicated Kong user password (must differ from `postgres_password`) |
| `keycloak_admin_password` | Keycloak master admin console password |
| `genie_admin_password` | GENIE realm admin user password (frontend admin) |
| `genie_admin_email` | GENIE realm admin user email (required for email verification) |
| `keycloak_db_password` | PostgreSQL dedicated Keycloak user password |
| `keycloak_client_secret` | OIDC client secret for genie-app |
| `keycloak_proxy_client_secret` | Service account secret for admin API proxy |
| `kc_dataprep_client_secret` | Dataprep service account secret (client_credentials grant) |
| `email_password` | SMTP password |
| `hugging_face_hub_token` | Hugging Face Hub token |
| `grafana_admin_password` | Grafana admin password (required when `enable_observability=1`) |
| `grafana_client_id` | `grafana` | Keycloak OIDC client ID for Grafana SSO (required when `enable_observability=1`) |
| `grafana_client_secret` | Grafana OIDC client secret (required when `enable_observability=1`) |

## Environment Variables (Non-Secret)

Set in `group_vars/<env>/vars.yml`:

### Deployment Options

| Variable | Default | Description |
|----------|---------|-------------|
| `deploy_opea` | `1` | Deploy OPEA/AI services (GPU) |
| `enable_observability` | `0` | Deploy OTel Collector + VictoriaMetrics + VictoriaLogs + VictoriaTraces + Grafana |
| `grafana_admin_user` | `admin` | Grafana admin username |
| `victoriametrics_retention` | `30d` | VictoriaMetrics data retention period |
| `victorialogs_retention` | `30d` | VictoriaLogs data retention period |
| `victoriatraces_retention` | `30d` | VictoriaTraces data retention period |
| `otel_traces_sampler_rate` | `100.0` | Trace sampling percentage (0.0–100.0) |
| `kong_tracing_instrumentations` | `request` | Kong tracing instrumentations (`off`, `request`, `all`). Default `request` — negligible overhead when OTel plugin disabled. |
| `kong_tracing_sampling_rate` | `1.0` | Kong internal trace sampling rate (0.0–1.0). Default `1.0` = 100%, aligned with `otel_traces_sampler_rate`. |
| `otel_exporter_otlp_endpoint` | `http://otel-collector:4318` | OTLP Collector base URL — used by backend (Node.js), OPEA services (Python), and Kong OTel plugin (via restore script). Override for external collectors. |
| `gpu_env_file` | `env.t4` | GPU defaults file (empty = none). Loaded first; Ansible `.env` takes precedence. |

### API Gateway (NGINX)

| Variable | Default | Description |
|----------|---------|-------------|
| `nginx_public_domain` | `localhost` | Public domain/IP |
| `nginx_http_port` | `80` | HTTP port (only set if non-default) |
| `nginx_https_port` | `443` | HTTPS port (only set if non-default) |
| `nginx_permissions_policy` | `camera=(), microphone=(), geolocation=()` | Nginx Permissions-Policy header |
| `registry_port` | `5000` | Local Docker registry port |

### Frontend Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `vue_app_api_url` | `""` | Frontend API URL |
| `vue_app_csp_connect_src` | `""` | Frontend CSP connect sources |

### Backend Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `context_option` | `conversation-with-context-labels` | Conversation mode: `conversation-with-context-labels` (full context) or `single-message` (legacy) |
| `cors_allowed_origins` | `""` | CORS allowed origins |
| `csp_connect_src` | `""` | Nginx CSP connect sources |
| `log_level` | `info` | Log level for backend and document-repository: `error`, `warn`, `info`, `debug` |

### Email Configuration (non-secret)

| Variable | Default | Description |
|----------|---------|-------------|
| `email_host` | `""` | SMTP server |
| `email_port` | `587` | SMTP port |
| `email_secure` | `false` | SMTP TLS (true/false) |
| `email_user` | `""` | SMTP username |
| `email_from` | `""` | Sender email address |

### ArangoDB Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `arango_db` | `genie-ai` | ArangoDB database name (default: `genie-ai` in code) |
| `arango_graph_name` | `GRAPH` | ArangoDB graph name (used by retriever and dataprep) |
| `arango_port` | `8529` | ArangoDB port exposed on host |

### LLM Model Configuration (vLLM)

| Variable | Default | Description |
|----------|---------|-------------|
| `vllm_llm_model_id` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Main LLM model for chat |
| `vllm_max_model_len` | `8192` | Maximum context length |
| `vllm_gpu_utilization` | `0.9` | GPU memory fraction (0.1-1.0) |
| `vllm_dtype` | `auto` | Data type (auto, half, bfloat16, float32) |
| `vllm_api_key` | `""` | Optional vLLM API key |

### Translation Model Configuration (vLLM)

| Variable | Default | Description |
|----------|---------|-------------|
| `vllm_translation_model_id` | `google/gemma-3-4b-it` | Translation model |
| `vllm_translation_max_model_len` | `8192` | Maximum context length |
| `vllm_translation_dtype` | `auto` | Data type |
| `vllm_translation_gpu_utilization` | `0.9` | GPU memory fraction |
| `vllm_translation_kv_cache_dtype` | `auto` | KV cache data type |

### Embedding & Reranking Models (TEI)

| Variable | Default | Description |
|----------|---------|-------------|
| `embedding_server_endpoint` | `/v1/embeddings` | Embedding service API endpoint path |
| `embedding_model_id` | `BAAI/bge-base-en-v1.5` | Embedding model for vector search |
| `reranker_model_id` | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Reranking model |
| `reranking_strategy` | `hybrid` | Reranker strategy (hybrid, score, all) |
| `reranking_threshold` | `0.9` | Threshold for reranker strategy |

### ChatQnA Service

| Variable | Default | Description |
|----------|---------|-------------|
| `chatqna_type` | `standard` | ChatQnA service type |
| `chatqna_system_prompt` | (built-in) | LLM system prompt (optional, has built-in default) |
| `chatqna_enforce_abstention` | `true` | Whether to enforce abstention |

### Retriever Configuration

#### Vector Search Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `retriever_arango_k` | `4` | Top-K results before reranking |
| `retriever_arango_fetch_k` | `20` | K results fetched from ArangoDB |
| `retriever_arango_score_threshold` | `0.1` | Minimum score for retrieval |
| `retriever_arango_distance_threshold` | `1` | Maximum distance threshold |
| `retriever_arango_lambda_mult` | `0.5` | Hybrid search lambda (0=vector only, 1=BM25 only) |
| `retriever_arango_search_start` | `chunk` | Search start node (chunk, document) |
| `retriever_arango_search_mode` | `vector` | Search mode (vector, bm25, hybrid) |
| `retriever_arango_use_approx_search` | `false` | Use approximate search |
| `retriever_arango_distance_strategy` | `COSINE` | Distance strategy (COSINE, DOT, L2, EUCLIDEAN) |
| `retriever_arango_num_centroids` | `1` | Number of centroids for approximate search |
| `retriever_arango_filter_strategy` | `OR` | Filter strategy (OR, AND) |
| `retriever_summarizer_enabled` | `false` | Enable result summarization |

#### ArangoDB Graph Traversal

| Variable | Default | Description |
|----------|---------|-------------|
| `retriever_arango_traversal_enabled` | `false` | Enable ArangoDB graph traversal |
| `retriever_arango_traversal_max_depth` | `2` | Max traversal depth |
| `retriever_arango_traversal_max_returned` | `3` | Max returned results per traversal |
| `retriever_arango_traversal_score_threshold` | `0.5` | Minimum score threshold for traversal results |
| `retriever_arango_traversal_concurrent_batches` | `1` | Concurrent traversal batches |

### Dataprep Configuration (Document Ingestion)

| Variable | Default | Description |
|----------|---------|-------------|
| `labeling_strategy` | `auto` | Document labeling strategy (auto, manual, none) |
| `embedding_label_threshold` | `0.7` | Embedding similarity threshold for labeling |
| `bm25_label_threshold` | `5.0` | BM25 score threshold for labeling |
| `content_extraction_method` | `docling` | Content extraction method (docling, unstructured) |
| `docling_device` | `cpu` | Docling processing device (cpu, cuda, mps) |
| `dataprep_chunk_size_pdf` | `1000` | Chunk size for PDF documents (tokens) |
| `dataprep_chunk_size_docx` | `1000` | Chunk size for DOCX documents (tokens) |
| `dataprep_chunk_size_xlsx` | `1000` | Chunk size for XLSX documents (tokens) |
| `dataprep_chunk_size_pptx` | `1000` | Chunk size for PPTX documents (tokens) |
| `dataprep_chunk_size_html` | `1000` | Chunk size for HTML documents (tokens) |
| `dataprep_chunk_size_txt` | `1000` | Chunk size for TXT documents (tokens) |
| `dataprep_chunk_size_md` | `1000` | Chunk size for Markdown documents (tokens) |
| `dataprep_max_concurrent_batches` | `1` | Max concurrent processing batches |

### Label Selector Prompt

| Variable | Default | Description |
|----------|---------|-------------|
| `label_selector_system_prompt` | (built-in) | System prompt for automatic document labeling (optional, has built-in default with `{labels_list}` placeholder) |

### Keycloak Identity Provider (Required)

| Variable | Default | Description |
|----------|---------|-------------|
| `keycloak_realm` | `genie` | Keycloak realm name |
| `keycloak_client_id` | `genie-app` | OIDC client ID |
| `keycloak_valid_redirect_uris` | `http://<domain>:<port>/*` | Valid redirect URIs for OIDC |
| `keycloak_web_origins` | `http://<domain>:<port>` | Allowed web origins |
| `keycloak_additional_realms` | — | Additional realms to configure (optional) |
| `keycloak_google_client_id` | — | Google IdP client ID (optional) |
| `keycloak_google_client_secret` | — | Google IdP client secret (optional, in vault) |
| `keycloak_microsoft_client_id` | — | Microsoft IdP client ID (optional) |
| `keycloak_microsoft_client_secret` | — | Microsoft IdP client secret (optional, in vault) |

Keycloak is proxied by NGINX at `/auth/*`. The `keycloak-config` service automatically applies realm configuration (clients, roles, mappers) on startup.

See `docs/keycloak-admin-guide.md` for admin console access and `docs/external-idp-integration-guide.md` for external IdP setup.

### Let's Encrypt Certificate Management (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `certbot_email` | — | Email for Let's Encrypt notifications (required to enable) |
| `certbot_replicas` | `0` | Set to `1` to deploy the certbot service (Swarm activation) |
| `certbot_staging` | `false` | Use Let's Encrypt staging server (avoids rate limits) |

To enable automatic SSL certificates via Let's Encrypt, set `certbot_email` and `certbot_replicas: "1"` in `group_vars/<env>/vars.yml`:

```yaml
certbot_email: "admin@example.com"
certbot_replicas: "1"
```

When enabled:
1. The certbot service starts alongside the stack (on the gateway node)
2. It obtains a Let's Encrypt certificate for `nginx_public_domain` via HTTP-01 challenge
3. Certificates are written to `secrets/ssl/server.crt` and `server.key` (replacing self-signed or manual certs)
4. Automatic renewal runs every 12 hours with nginx reload

**Requirements:**
- Port 80 must be accessible from the internet (for HTTP-01 challenge)
- `nginx_public_domain` must be a valid FQDN with DNS A/AAAA record pointing to the server
- First-time setup: set `certbot_staging: "true"` to test without hitting Let's Encrypt rate limits

**Note:** When Let's Encrypt is enabled, the `self_signed_certs` setting still applies as an initial fallback — Ansible generates self-signed certs during `prepare`, then certbot replaces them after deployment.

### Docker Swarm Multi-Node

| Variable | Default | Description |
|----------|---------|-------------|
| `swarm_registry_url` | `localhost:5000` | Docker registry URL (for multi-node Swarm) |
| `data_dir` | `./data` | Data directory (relative to deploy_dir) |

Shared variables in `group_vars/all.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `deploy_dir` | `/opt/genieai` | Deploy path |
| `data_dir` | `./data` | Data directory (relative to deploy_dir) |
| `repo_url` | — | Git repository URL |
| `repo_branch` | `main` | Git branch |
| `stack_name` | `genieai` | Docker Swarm stack name |
| `compose_file` | `docker-compose.yaml` | Compose file name |
| `self_signed_certs` | `true` | Auto-generate self-signed certs |
| `deploy_stabilization_timeout` | `900` | Max seconds to wait for services |
| `docker_version_pin` | `5:28.5.*` | Docker package version pin |
| `nvidia_version_pin` | `1.18.*` | NVIDIA toolkit version pin |

## Playbook Tags

| Tag | Description |
|-----|-------------|
| `install` | Docker, NVIDIA toolkit, Swarm init, registry |
| `prepare` | Git clone, directories, SSL certs |
| `build` | Build and push 12 images to local registry |
| `deploy` | Generate .env, validate, deploy stack, verify |

```bash
# Full deployment
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --vault-id itu_rtx_test@prompt

# Rebuild and redeploy (no install/prepare)
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --tags build,deploy --vault-id itu_rtx_test@prompt

# Redeploy only (existing images and .env)
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --tags deploy --vault-id itu_rtx_test@prompt
```

### Git credentials with `--tags deploy`

The `prepare` play prompts for git credentials via `vars_prompt`. When using `--tags deploy` only, these prompts still appear (Ansible evaluates `vars_prompt` before tag filtering). To avoid the prompts, pass credentials as extra vars:

```bash
ansible-playbook -i inventory/itu_rtx_test.ini deploy.yml --tags deploy --vault-id itu_rtx_test@prompt \
  --extra-vars "git_username=YOUR_USER git_token=YOUR_TOKEN"
```

## GPU Configuration

To deploy without GPU/OPEA services, set in `group_vars/<env>/vars.yml`:
```yaml
deploy_opea: "0"
gpu_env_file: ""
```

GPU env file options (provide GPU-specific defaults in `docker-compose.yaml`):
- `env.t4` — NVIDIA T4 (16GB VRAM)
- `env.rtx6000` — RTX 6000 ADA (24GB VRAM)

The GPU env file is loaded first, then the Ansible-generated `.env` is loaded on top.
**Ansible `.env` values take precedence** over GPU env file values for any duplicate variables.
This allows per-environment tuning via Ansible while keeping GPU defaults in the committed files.

### Remote GPU Node (Optional)

GENIE.AI supports a standalone GPU node architecture. Instead of running
AI services alongside the app stack, deploy a dedicated GPU node with its own compose file
and nginx reverse proxy. The app node connects to the GPU node via HTTPS on port 443
with path-based routing and API key authentication.

#### Deploy the GPU Node

The GPU node has its own Ansible playbook (`deploy-gpu.yml`) and inventory group:

```bash
# 1. Create inventory (separate group for the GPU node)
cp inventory/inventory.example inventory/my-gpu.ini
# Edit: set [my-gpu] group, update host IP

# 2. Create environment config directory
mkdir -p group_vars/my-gpu
cp group_vars/itu_rtx_gpu_api/vars.yml group_vars/my-gpu/vars.yml
# Edit: set gpu_public_domain, certbot_email, etc.

# 3. Create encrypted secrets (GPU node vault)
ansible-vault create group_vars/my-gpu/vault.yml
# Required: hugging_face_hub_token, gpu_api_keys (list of {name, key} entries)

# 4. Deploy
ansible-playbook -i inventory/my-gpu.ini deploy-gpu.yml --vault-id my-gpu@prompt
```

Tagged re-runs:
```bash
ansible-playbook -i inventory/my-gpu.ini deploy-gpu.yml --vault-id my-gpu@prompt --tags install    # Docker + NVIDIA toolkit
ansible-playbook -i inventory/my-gpu.ini deploy-gpu.yml --vault-id my-gpu@prompt --tags prepare    # Render configs (nginx, API keys, compose)
ansible-playbook -i inventory/my-gpu.ini deploy-gpu.yml --vault-id my-gpu@prompt --tags deploy     # Deploy + smoke tests
```

#### GPU Node Services

| Path | Backend | Description |
|------|---------|-------------|
| `/llm/` | vLLM (LLM inference) | OpenAI-compatible chat completions |
| `/translation/` | vLLM (Translation) | Translation model inference |
| `/embed/` | TEI (Embedding) | Text embedding for vector search |
| `/rerank/` | TEI (Reranking) | Result reranking |
| `/docling/` | docling-serve | Document extraction |

All services are behind nginx with TLS termination and API key authentication on port 443.

#### GPU Node Vault Secrets

| Variable | Description |
|----------|-------------|
| `hugging_face_hub_token` | Hugging Face Hub token (model downloads) |
| `gpu_api_keys` | List of API keys: `[{name: "key-name", key: "actual-api-key"}]` |

#### GPU Node Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `gpu_public_domain` | `gpu.example.com` | Public domain (CN in TLS cert) |
| `gpu_self_signed_certs` | `true` | Generate self-signed certs (set `false` for Let's Encrypt) |
| `gpu_env_file` | `""` | GPU defaults file (empty = none) |
| `gpu_node_host` | `""` | Remote GPU node hostname/IP (set in app node env to route AI services) |
| `vllm_api_key` | `""` | API key for GPU node nginx auth (set in app node vault) |
| `opea_ssl_skip_verify` | `""` | Disable SSL cert verification for OPEA services (`"1"` for self-signed certs, empty = verify) |
| `opea_api_key` | `""` | API key injected into OPEA outbound HTTP calls (typically same as `vllm_api_key`) |

#### Connect the App Node to the GPU Node

When `gpu_node_host` is set in `group_vars/<env>/vars.yml`, Ansible automatically:

1. Sets `GPU_MODEL_REPLICAS=0` (skips GPU-heavy containers on the app node)
2. Generates endpoint URLs: `VLLM_ENDPOINT`, `VLLM_TRANSLATION_ENDPOINT`, `EMBEDDING_SERVICE_URL`, `RERANKER_SERVICE_URL`, `DOCLING_ENDPOINT`
3. Propagates `VLLM_API_KEY` from vault

For manual setup (Compose mode), set in `.env` (Section 14):

```bash
GPU_NODE_HOST=<gpu-node-host>       # GPU node IP or hostname
GPU_MODEL_REPLICAS=0                # Skip local GPU containers
VLLM_API_KEY=<your-api-key>         # API key from GPU node (sent as Authorization: Bearer)
OPEA_SSL_SKIP_VERIFY=1              # If GPU node uses self-signed certs
```

> **Note:** `OPEA_SSL_SKIP_VERIFY` is independent of `gpu_node_host`.
> It controls SSL bypass baked into OPEA Docker images via `genie_ssl_patch.py`.
> Use `OPEA_SSL_SKIP_VERIFY=1` only with self-signed certs — omit for Let's Encrypt or public CAs.

## Port Configuration

If ports 80/443 are occupied (e.g. by another stack), override them in your environment config:

```yaml
# group_vars/<env>/vars.yml
nginx_http_port: "1080"
nginx_https_port: "1443"
registry_port: "5001"
```

The playbook generates `.env` with these values, and `docker-compose.yaml` uses them as published ports. Only set non-default values — defaults (80, 443, 5000) are omitted from `.env` automatically.

## Docker and NVIDIA Version Pinning

Docker and NVIDIA Container Toolkit packages are **version-pinned** and **held** via `dpkg --set-selections` to prevent accidental upgrades breaking the deployment.

| Package group | Pin | Config |
|---------------|-----|--------|
| Docker | `5:28.5.*` | `docker_version_pin` in `all.yml` |
| NVIDIA toolkit | `1.18.*` | `nvidia_version_pin` in `all.yml` |

To upgrade: change the pin value in `all.yml`, then run with `--tags install`. The playbook will unhold, upgrade, and re-hold the packages.

## Post-Deploy Verification

The `deploy` tag automatically verifies:

1. **Service stabilization** — waits for all services to appear in Swarm
2. **Replica health** — checks all running services have at least 1 replica (excludes one-shot init services and disabled 0/0 services)
3. **Backend health** — polls `/api/health` via HTTPS
4. **Frontend** — polls `/` via HTTPS

If any running service has 0 replicas, the playbook fails. One-shot services (`kong-config`, `kong-migrations`, `postgres-init`, `keycloak-config`) and intentionally disabled services (0/0 replicas) are excluded.

### Keycloak Verification

After deployment, verify Keycloak is running:
```bash
# Check Keycloak service health
ssh node "docker service ls --filter name=genieai_keycloak"

# Access master admin console
# URL: https://<NGINX_PUBLIC_DOMAIN>/auth/admin/
# Username: admin
# Password: <keycloak_admin_password from vault>
# Note: GENIE realm admin (genie-admin) has separate credentials (genie_admin_password)
```

### Variable Substitution and Resolved Compose File

Docker Swarm (`docker stack deploy`) does **not** automatically load `.env` files like Docker Compose does. To ensure environment variables are correctly substituted:

1. The playbook verifies that critical vault variables (ARANGO_PASSWORD, POSTGRES_PASSWORD, KC_DATAPREP_CLIENT_SECRET) are set in the `.env` file before deployment
2. It generates a resolved `docker-compose.yaml` with all variables substituted using `docker compose config`
3. Post-processing fixes known `docker compose config` issues:
   - **Port integers**: `docker compose config` converts published ports to strings (e.g. `"80"` instead of `80`), which Swarm rejects. A `sed` fix restores them to integers.
   - **`name:` properties**: `docker compose config` adds `name:` properties that Swarm does not support. A `sed` fix removes them.
4. The resolved file is deployed to the Swarm (overwriting the template from git)
5. The resolved file is set to mode `0600` since it contains secrets

This means `docker-compose.yaml` on the target server will differ from the one in git — this is expected. The original is restored on each `prepare` run via git clone/pull.

**Note on CSP values**: Variables containing CSP keywords like `'self'` must be quoted in the `.env` file (e.g. `CSP_CONNECT_SRC="'self' https://example.com"`). Without quotes, `docker compose config`'s YAML parser strips the single quotes, breaking the CSP directive. The Ansible template handles this automatically.

## Teardown

```bash
# Remove stack (preserve volumes)
ansible-playbook -i inventory/itu_rtx_test.ini teardown.yml --vault-id itu_rtx_test@prompt

# Remove stack + volumes
ansible-playbook -i inventory/itu_rtx_test.ini teardown.yml --vault-id itu_rtx_test@prompt \
  -e "teardown_remove_volumes=true"

# Remove stack + volumes + local registry
ansible-playbook -i inventory/itu_rtx_test.ini teardown.yml --vault-id itu_rtx_test@prompt \
  -e "teardown_remove_volumes=true" \
  -e "teardown_remove_registry=true"
```

## Troubleshooting

### "Missing required vault variable"
```bash
ansible-vault edit --vault-id itu_rtx_test@prompt group_vars/itu_rtx_test/vault.yml
# Ensure all secrets are set
```

### Docker build fails
```bash
ssh node "cd /opt/genieai && docker build -f components/gov-chat-frontend/Dockerfile -t test:latest components/gov-chat-frontend/"
```

### Services keep restarting
```bash
ssh node "docker service ps genieai_<service> --no-trunc"
ssh node "docker service logs genieai_<service> --tail 50"
```

### GPU not detected
```bash
ssh node "docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi"
```

### No space left on device
```bash
ssh node "docker system prune -a"
# Then redeploy with --tags build,deploy
```

### Verify deployment
```bash
ssh node "docker service ls"
ssh node "curl -sk https://localhost/api/health"
```
