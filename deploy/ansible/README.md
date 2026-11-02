# GENIE.AI - Ansible Deployment

Automated Docker Swarm deployment for GENIE.AI using Ansible with per-environment secrets.

## Prerequisites

- **Ansible 2.15+** / ansible-core 2.15+ (control machine)
- **community.docker 4.x** collection
- **Docker CLI** on the control machine — `test-preflight.sh`'s compose-resolution legs run `docker compose config` (client-side only, no daemon needed; the legs SKIP with a message when docker is absent)
- **SSH access** to the target node (password or key-based)
- **Ansible Vault password** per environment
- **Git deploy key** on the target node (for `git clone`)

#### SSH Key Setup

```bash
# Generate a deploy key (if you don't have one)
ssh-keygen -t ed25519 -f ~/.ssh/deploy-key -N ""

# Copy public key to the target host
ssh-copy-id -i ~/.ssh/deploy-key.pub <user>@<host>

# Verify connectivity
ssh <user>@<host> "docker --version"
```

Set `ansible_ssh_private_key_file` in your inventory `[all:vars]` if using a non-default key path (see `inventory/inventory.example`).

> **WSL users:** If keys are on a Windows mount (permissions 777), SSH refuses them. Copy to WSL home: `cp -r /mnt/c/Users/<you>/.ssh ~/.ssh && chmod 700 ~/.ssh && chmod 600 ~/.ssh/*`

## Quick Start

```bash
cd deploy/ansible

# 1. Install Ansible collections
ansible-galaxy collection install -r requirements.yml

# 2. Create inventory for your environment
cp inventory/inventory.example inventory/agrivisory_myenv.ini
# Edit: your host IP; group names MUST start with agrivisory (underscores, no hyphens)

# 3. Create environment config directory from the rtx6000 template
#    (vars.yml ONLY — vault.yml is created fresh in step 5; never copy real secrets)
cp -r group_vars/agrivisory_rtx6000 group_vars/agrivisory_myenv
rm group_vars/agrivisory_myenv/vault.yml
# Edit first: nginx_public_domain, email_from, cert_mode + certbot_email
# (or provided-cert path), models if desired — and update inventory group names to match

# 5. Create encrypted secrets
ansible-vault create group_vars/my-env/vault.yml
# Fill in all required secrets (see "Required Vault Secrets" below)

# 6. Place SSL certificates for cert_mode: provided
#    (dir name = your ^agrivisory inventory group — or set cert_mode: selfsigned / letsencrypt instead, no files needed)
mkdir -p files/certificates/agrivisory_myenv
cp server.crt server.key files/certificates/agrivisory_myenv/
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

Use **underscores** in group names (e.g. `agrivisory`, not `itu-rtx-test`). Hyphens in group names cause Ansible warnings. Group names must also **start with `agrivisory`** — the cert preflight resolves the env group (group_vars/, files/certificates/) by matching `^agrivisory` and fails otherwise.

### Creating a new environment

```bash
# 1. Create inventory
cp inventory/inventory.example inventory/staging.ini
# Edit: set [staging] group, update host IP

# 2. Create environment config directory
mkdir -p group_vars/staging
cp -r group_vars/agrivisory_rtx6000 group_vars/agrivisory_staging && rm group_vars/agrivisory_staging/vault.yml
# then edit nginx_public_domain / email_from / cert knobs per README
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
ansible-playbook -i inventory/rtx6000.ini deploy.yml --vault-id agrivisory_rtx6000@prompt
```

**Password files (for CI/CD or automation):**
```bash
# Store passwords (gitignored)
echo "test-vault-password" > <REDACTED>

# Use them
ansible-playbook -i inventory/rtx6000.ini deploy.yml --vault-id agrivisory_rtx6000@.vault-pass-rtx6000
```

**Legacy `--ask-vault-pass` (single password for all environments):**
```bash
ansible-playbook -i inventory/rtx6000.ini deploy.yml --ask-vault-pass
```

## Inventory Setup

Each inventory file puts the host in an environment group. Ansible automatically loads all files from `group_vars/<group>/`.

```ini
# inventory/agrivisory_myenv.ini   (group names MUST start with agrivisory — preflight enforces)
[agrivisory_myenv]
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

| Variable | Required | Description |
|----------|----------|-------------|
| `arango_password` | always | ArangoDB root password |
| `translation_cache_password` | always | Redis cache password |
| `kong_db_password` | always | PostgreSQL dedicated Kong user password |
| `keycloak_admin_password` | always | Keycloak master admin console password |
| `genie_admin_password` | always | GENIE realm admin user password (frontend admin) |
| `genie_admin_email` | always | GENIE realm admin user email — single source for the realm admin user AND `ADMIN_BOOTSTRAP_EMAIL` (the first-admin seed match key; they can never diverge) |
| `keycloak_db_password` | always | PostgreSQL dedicated Keycloak user password |
| `keycloak_proxy_client_secret` | always | Service account secret for admin API proxy |
| `kc_dataprep_client_secret` | always | Dataprep service account secret (client_credentials grant) |
| `kc_mobile_client_id` | always | Mobile app Keycloak client ID (Flutter, public client with PKCE) |
| `kc_mobile_redirect_scheme` | always | Mobile app redirect scheme (e.g. `genieai://`) |
| `email_password` | user registration | SMTP password (omit if `keycloak_verify_email: false`) |
| `hugging_face_hub_token` | GPU node | Hugging Face Hub token (model downloads) |
| `vllm_api_key` | remote GPU | API key for GPU node nginx auth (set in `group_vars/<env>/vault.yml`) |
| `grafana_admin_password` | observability | Grafana admin password (required when `enable_observability=1`) |
| `grafana_client_id` | observability | Keycloak OIDC client ID for Grafana SSO (default: `grafana`, required when `enable_observability=1`) |
| `grafana_client_secret` | always | Grafana OIDC client secret — required even without `enable_observability=1`: `env.j2` emits it unconditionally and `config-and-sleep.sh` asserts it (the realm always creates the grafana client) |

Vars whose consumers died in Epic A (plus the old postgres superuser password — compose uses the per-DB kong/keycloak passwords) were deleted end-to-end in B3: group_vars, `env.j2` emissions and the preflight sweep no longer carry them. The authoritative list of what is required when is enforced by `tasks/preflight.yml` (see [Preflight](#preflight-what-runs-before-any-mutation)) — this table describes it, it does not define it.

## Environment Variables (Non-Secret)

Set in `group_vars/<env>/vars.yml`:

### Deployment Options

| Variable | Default | Description |
|----------|---------|-------------|
| `deploy_mode` | `local` | `local`: rsync repo to host + `docker compose up -d --build` (no registry). `swarm`: download compose via repo raw API, pull pre-built images from `swarm_registry_url`, `docker stack deploy`. |
| `deploy_opea` | `1` | Deploy OPEA/AI services (GPU) |

> **Warning:** `deploy_opea` controls **only** whether AI/ML services (ChatQnA, Retriever, Reranker, vLLM, TEI) are included in the stack. It does **not** configure GPU placement or remote GPU endpoints — those are handled by `gpu_node_host` and inventory groups. Setting `deploy_opea: "0"` does not imply "no GPU"; it means "no AI pipeline services".
| `enable_observability` | `0` | Deploy OTel Collector + VictoriaMetrics + VictoriaLogs + VictoriaTraces + Grafana |
| `grafana_admin_user` | `admin` | Grafana admin username |
| `victoriametrics_retention` | `30d` | VictoriaMetrics data retention period |
| `victorialogs_retention` | `30d` | VictoriaLogs data retention period |
| `victoriatraces_retention` | `30d` | VictoriaTraces data retention period |
| `otel_traces_sampler_rate` | `100.0` | Trace sampling percentage (0.0–100.0) |
| `kong_tracing_instrumentations` | `request` | Kong tracing instrumentations (`off`, `request`, `all`). Default `request` — negligible overhead when OTel plugin disabled. |
| `kong_tracing_sampling_rate` | `1.0` | Kong internal trace sampling rate (0.0–1.0). Default `1.0` = 100%, aligned with `otel_traces_sampler_rate`. |
| `otel_exporter_otlp_endpoint` | `http://otel-collector:4318` | OTLP Collector base URL — used by backend (Node.js), OPEA services (Python), and Kong OTel plugin (via restore script). Override for external collectors. |
| `gpu_env_file` | `gpu_env_file` (optional — none tracked today) | GPU defaults file (empty = none). Loaded first; Ansible `.env` takes precedence. |

### API Gateway (NGINX)

| Variable | Default | Description |
|----------|---------|-------------|
| `nginx_public_domain` | `localhost` | Public domain/IP |
| `nginx_http_port` | `80` | HTTP port (only set if non-default) |
| `nginx_https_port` | `443` | HTTPS port (only set if non-default) |
| `nginx_permissions_policy` | `camera=(), microphone=(), geolocation=()` | Nginx Permissions-Policy header |
| `kong_trusted_ips` | `10.0.0.0/8` | CIDR range for X-Forwarded-* header passthrough. Kong trusts these IPs for `X-Forwarded-Proto/Host/Port/Prefix`. Docker Compose: `172.16.0.0/12`, Swarm overlay: `10.0.0.0/8` |

### Frontend Configuration

Computed from `nginx_public_domain` in `group_vars/all.yml` (B3 single source) — never hand-copied per env:

| Variable | Default | Description |
|----------|---------|-------------|
| `vue_app_api_url` | `https://{{ nginx_public_domain }}/api` | Frontend API URL |
| `vue_app_csp_connect_src` | `'self' https://… wss://… http://…` | Frontend CSP connect sources |
| `vue_app_available_locales` | `en,st` | Available UI locales |

### Backend Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `context_option` | `conversation-with-context-labels` | Conversation mode: `conversation-with-context-labels` (full context) or `single-message` (legacy) |
| `cors_allowed_origins` | `https://…,http://…` (computed) | CORS allowed origins |
| `csp_connect_src` | `'self' https://… wss://… http://…` (computed) | Nginx CSP connect sources |
| `log_level` | `info` | Log level for backend and document-repository: `error`, `warn`, `info`, `debug` |

### Email Configuration (non-secret)

| Variable | Default | Description |
|----------|---------|-------------|
| `email_host` | `""` | SMTP server (empty = no mail deliverable; lifecycle unaffected) |
| `email_port` | `587` | SMTP port |
| `email_secure` | `false` | SMTP TLS (true/false) |
| `email_user` | `""` | SMTP username |
| `email_from` | **required** | Sender email address — any valid address; preflight-enforced |

> **`email_from` is required on every deploy:** the `smtpServer` block in the realm
> template (`configs/keycloak/genie-realm.yaml`) is always present (upstream v2.0.1
> behavior), and an empty sender makes Keycloak reject the realm during the
> `keycloak-config` import with `Invalid sender address 'null'` — unconditionally,
> whatever the registration/reset knobs are set to. The rest of the EMAIL_* block
> may stay empty (SMTP off; mail undeliverable, approval lifecycle unaffected).

### ArangoDB Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `arango_db` | `genie-ai` | ArangoDB database name (default: `genie-ai` in code) |
| `arango_graph_name` | `GRAPH` | ArangoDB graph name (used by retriever and dataprep) |
| `arango_port` | `8529` | ArangoDB port exposed on host |
| `translation_cache` | `on` | Translation cache toggle (`on`/`off`). Uses Redis with `translation_cache_password` |

### LLM Model Configuration (vLLM)

Models and image pins are named ONCE in `group_vars/all.yml` (B3 single source) — `env.j2` emits them and `docker-compose.yaml` reads the env vars with identical fallbacks, so compose-only runs agree with ansible deploys. Scope: the pins `env.j2` emits are the ones the main compose consumes via `${VAR:-…}` (models, vllm/TEI images, TEI knobs, `docling_device`); `nginx_image` and `docling_serve_image` are GPU-template-only (`docker-compose.gpu.yaml.j2` renders them directly) and are never emitted by `env.j2`.

| Variable | Default | Description |
|----------|---------|-------------|
| `vllm_llm_model_id` | `ibm-granite/granite-4.1-8b` | Main LLM model for chat |
| `vllm_llm_image` | `vllm/vllm-openai:v0.10.0` | vLLM LLM container image pin |
| `vllm_max_model_len` | `65536` | Maximum context length |
| `vllm_gpu_utilization` | `0.55` | GPU memory fraction (0.1-1.0) |
| `vllm_dtype` | `auto` | Data type (auto, half, bfloat16, float32) |
| `vllm_api_key` | `""` | Optional vLLM API key |

### Translation Model Configuration (vLLM)

| Variable | Default | Description |
|----------|---------|-------------|
| `vllm_translation_model_id` | `google/gemma-3-4b-it` | Translation model |
| `vllm_translation_image` | `vllm/vllm-openai:v0.10.0` | vLLM translation container image pin |
| `vllm_translation_max_model_len` | `8192` | Maximum context length |
| `vllm_translation_dtype` | `auto` | Data type |
| `vllm_translation_gpu_utilization` | `0.12` | GPU memory fraction (must fit beside granite's 0.85 on one GPU — D4) |

### Embedding & Reranking Models (TEI)

| Variable | Default | Description |
|----------|---------|-------------|
| `embedding_server_endpoint` | `/v1/embeddings` | Embedding service API endpoint path |
| `embedding_model_id` | `BAAI/bge-m3` | Embedding model for vector search (product standard — the corpus MUST be ingested with it) |
| `tei_embedding_image` | `ghcr.io/huggingface/text-embeddings-inference:1.9.3` | TEI embedding image pin |
| `tei_reranker_image` | `ghcr.io/huggingface/text-embeddings-inference:1.9.3` | TEI reranker image pin |
| `tei_reranking_max_batch_tokens` | `1024` | TEI reranker max batch tokens |
| `tei_reranking_max_concurrent_requests` | `128` | TEI reranker max concurrent requests |
| `reranker_model_id` | `BAAI/bge-reranker-v2-m3` | Reranking model |
| `reranking_strategy` | `slice` | Reranker strategy: `slice` (default; top-N), `threshold`, `slice_threshold`, `knee_threshold`, `adaptive` |
| `reranker_top_n` | `3` | Chunks kept for slice/slice_threshold strategies |
| `reranking_threshold` | `0.75` | Threshold for threshold-based strategies |
| `novelty_sigmoid_a` | `20.0` | Adaptive: novelty-to-weight logistic steepness |
| `novelty_sigmoid_b` | `0.25` | Adaptive: novelty-to-weight logistic midpoint |
| `context_decay_factor` | `0.0025` | Adaptive: per-token context-window cost coefficient |
| `min_value_threshold` | `-1.0` | Adaptive: select a chunk only if marginal value > threshold |
| `confidence_rank_decay` | `0.5` | Confidence: exponential rank-decay weight (rank 0 = best doc) |
| `reranker_score_calibration` | `none` | Confidence: `none` \| `sigmoid` — enable sigmoid only if TEI returns raw logits |
| `reranker_score_temperature` | `1.0` | Confidence: temperature for sigmoid calibration |
| `llm_self_confidence_enabled` | `0` | Confidence: opt-in LLM self-grade (`[[CONF:0-100]]` → `self_confidence`); off by default |

### ChatQnA Service

| Variable | Default | Description |
|----------|---------|-------------|
| `chatqna_type` | `standard` | ChatQnA service type |
| `chatqna_system_prompt` | (built-in) | LLM system prompt (optional, has built-in default) |
| `chatqna_enforce_abstention` | `true` | Whether to enforce abstention |
| `multi_turn_blend_enabled` | `true` | Multi-turn vector-space blending (issue #833): blend the query embedding with the previous N turns (`V = α·EQ + (1-α)·EH`) so pronoun-heavy follow-ups retrieve the prior turn's subject. ON since K.7 (10-06): under strict grounding, retrieval is the model's only knowledge source, so prompt-history alone cannot ground a follow-up. Only the dense retrieval leg is blended. |
| `multi_turn_blend_alpha` | `0.7` | Query weight α for blending. `1.0` = query-only (equivalent to disabled), `0.0` = history-only. |
| `multi_turn_history_turns` | `1` | Number of prior turns blended. `0` disables even if `multi_turn_blend_enabled` is true. |
| `query_reformulation_enabled` | `true` | Conversational query reformulation (K.7b): with history, one small granite call rewrites the follow-up into a self-contained retrieval query before retrieval (both legs + the KB `QUESTION:` line). Failure or `false` = raw-query fallback (K.7 behavior) — chat never breaks. |

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
| `dataprep_chunk_size_pdf` | `1000` | Chunk size for PDF documents (characters) |
| `dataprep_chunk_size_docx` | `1000` | Chunk size for DOCX documents (characters) |
| `dataprep_chunk_size_xlsx` | `1000` | Chunk size for XLSX documents (characters) |
| `dataprep_chunk_size_pptx` | `1000` | Chunk size for PPTX documents (characters) |
| `dataprep_chunk_size_html` | `1000` | Chunk size for HTML documents (characters) |
| `dataprep_chunk_size_txt` | `1000` | Chunk size for TXT documents (characters) |
| `dataprep_chunk_size_md` | `1000` | Chunk size for Markdown documents (characters) |
| `dataprep_max_concurrent_batches` | `1` | Max concurrent processing batches |

### Label Selector Prompt

| Variable | Default | Description |
|----------|---------|-------------|
| `label_selector_system_prompt` | (built-in) | System prompt for automatic document labeling (optional, has built-in default with `{labels_list}` placeholder) |

### Contextual Retrieval (runtime defaults live in `all.yml` — B3 single source)

Per-chunk LLM document-context prefix → embedding (+ optionally labeling) so chunks carry the document's subject. See `site/content/en/docs/rag/data-labeling.md` §7 + `_bmad-output/implementation-artifacts/spec-contextual-retrieval.md`. The defaults below are TODAY'S runtime values (defined once in `group_vars/all.yml`); switching to the documented Anthropic-recipe values is a one-place edit there.

| Variable | Default (runtime) | Description |
|----------|---------|-------------|
| `contextual_retrieval_enabled` | `true` | Prepend an LLM document-context prefix to each chunk so it carries the document's subject |
| `contextual_strategy` | `doc_level` | `doc_level` (one call/doc, same context on every chunk — N× cheaper) or `per_chunk` (one call/chunk, section-tailored — Anthropic recipe) |
| `contextual_label_raw` | `true` | Decoupled mode: label the RAW chunk, use the context ONLY for the embedding (keeps label precision) |
| `dataprep_contextual_model` | (empty) | Model for context generation; empty = reuse `vllm_llm_model_id`; must support guided JSON |
| `dataprep_contextual_doc_budget` | `6000` | Max chars of doc text fed to the context LLM |
| `dataprep_contextual_doc_budget_doc_level` | `100000` | Max chars of doc text fed to the doc_level context LLM (one call — can afford a larger window) |
| `dataprep_contextual_max_tokens` | `512` | Max OUTPUT tokens for the context-generation LLM (doc-level + per-chunk). The legacy cap of 200 truncated the JSON under load; 512 = safe margin (model stops early at ~196). |
| `contextual_retrieval_prompt` | (built-in) | Prompt for per-chunk context generation (has `{document_context}` placeholder) |

### Keycloak Identity Provider (Required)

| Variable | Default | Description |
|----------|---------|-------------|
| `keycloak_realm` | `agrivisory` (all.yml) | Keycloak realm name — product realm, do not revert to upstream `genie` |
| `keycloak_client_id` | `itu-agrivisory-client` (all.yml) | OIDC client ID — product client, do not revert to upstream `genie-app` |
| `keycloak_additional_realms` | — | Additional realms to configure (optional) |

**Keycloak Realm Behavior** (configured automatically by `keycloak-config` service, override in `vars.yml`):

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `genie_admin_username` | `genie-admin` | no | Admin username created in GENIE realm (env.j2 default) |
| `kc_dataprep_client_id` | `genie-dataprep` | no | Keycloak client ID for dataprep service account |
| `keycloak_ssl_skip_verify` | `""` | no | Skip SSL verification for Keycloak API calls (set `"true"` for self-signed certs) |
| `keycloak_password_policy` | — | no | Password policy string (e.g. `length(8) and notUsername`) |
| `keycloak_theme` | `keycloak` | no | Login theme for Keycloak |
| `keycloak_access_token_lifespan` | — | no | Access token lifespan (e.g. `300` seconds, `5m`) |
| `keycloak_registration_enabled` | — | no | Enable user self-registration (`true`/`false`) |
| `keycloak_verify_email` | — | no | Require email verification for new users |
| `keycloak_reset_password` | — | no | Allow users to reset their password |
| `keycloak_login_with_email` | — | no | Allow email-based login |
| `keycloak_duplicate_emails` | — | no | Allow duplicate emails across users |
| `keycloak_brute_force` | — | no | Enable brute-force attack protection |
| `keycloak_i18n_enabled` | — | no | Enable internationalization in login UI |
| `keycloak_locale` | — | no | Default locale for login UI |

Keycloak is proxied by NGINX at `/auth/*`. The `keycloak-config` service automatically applies realm configuration (clients, roles, mappers) on startup.

See `site/content/en/docs/configuration/keycloak-admin-guide.md` for admin console access and `site/content/en/docs/configuration/external-idp-integration-guide.md` for external IdP setup.

### Let's Encrypt Certificate Management (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `certbot_email` | — | Email for Let's Encrypt notifications (required to enable) |
| `certbot_replicas` | `0` | Set to `1` to deploy the certbot service (Swarm activation) |
| `certbot_staging` | `false` | Use Let's Encrypt staging server (avoids rate limits) |

To enable automatic SSL certificates via Let's Encrypt, set `cert_mode: letsencrypt` (the decision var), `certbot_email` and `certbot_replicas: "1"` in `group_vars/<env>/vars.yml`:

```yaml
cert_mode: letsencrypt
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

**Note:** With `cert_mode: letsencrypt`, if no certificate is staged yet Ansible generates a bootstrap self-signed cert (CN=`nginx_public_domain` + SAN, with a loud warning) during `prepare`; certbot replaces it after its first issuance.

### Docker Swarm Multi-Node

| Variable | Default | Description |
|----------|---------|-------------|
| `swarm_registry_url` | `registry.opensource.unicc.org/un/itu/genie-ai` | Container registry URL (GitLab Container Registry) |
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
| `cert_mode` | `selfsigned` | How the public cert is obtained: `letsencrypt` \| `provided` \| `selfsigned` (dev-only) |
| `deploy_stabilization_timeout` | `900` | Max seconds to wait for services |
| `docker_version_pin` | `5:28.5.*` | Docker package version pin |
| `nvidia_version_pin` | `1.18.*` | NVIDIA toolkit version pin |

## Preflight (what runs before any mutation)

Both playbooks open with a `tags: [always]` preflight play — it runs on **every** invocation (including `--tags install`/`prepare`/`build`/`deploy` re-runs) before anything mutates the host, and is read-only (`--check`-safe):

| Playbook | Play | What it checks |
|----------|------|----------------|
| `deploy.yml` | `Preflight: var coherence + certificates` | cert rules (`tasks/preflight-cert.yml`, included from `tasks/preflight.yml`), placeholder sweep, `deploy_mode`/`enable_observability` enums, deployment plan, confirm gate |
| `deploy-gpu.yml` | `Preflight (var coherence, gpu scope)` | GPU sweep: `hugging_face_hub_token`, `gpu_api_keys`, `gpu_public_domain` (the `gpu.example.com` default fails) |

- **Placeholder sweep** — no required var may be `CHANGE_ME`/`FILL-IN`/empty; the failure names each var, its `group_vars` file and the offending value. Optional-empty vars (`hugging_face_hub_token`, `swarm_registry_url`, `vllm_api_key`, `EMAIL_*`) pass when empty but never as placeholders. Vars whose consumers died in Epic A are deleted end-to-end (B3) — nothing dead is swept or emitted.
- **Coherence rules** — `deploy_mode` must be `local` or `swarm` (a typo silently skipped both branches before); `enable_observability=1` requires real grafana secrets; `deploy_mode=swarm` requires `repo_url` + registry deploy token.
- **Deployment plan** — mode, domain, cert_mode (certbot email redacted), models, compose profiles, GPU host, deploy_dir — printed before anything runs.
- **Confirm gate** — when `nginx_public_domain` is not `localhost`, the run aborts before any mutation unless you confirm:

```bash
ansible-playbook -i inventory/rtx6000.ini deploy.yml --vault-id rtx6000@prompt --extra-vars "confirm=yes"
```

Negative-test gate (must exit 0): `bash test-preflight.sh` — the B2 var-coherence gate (B3-extended: the wrapper renders `env.j2` from the real `group_vars/all.yml` and resolves it through `docker compose config`, pinning the single-source values, the `-e` override round-trip, the admin-email equality and the GPU template render), which chains `test-preflight-cert.sh` (B1, certificates) at the end, so one entrypoint covers both.

## Playbook Tags

| Tag | Description |
|-----|-------------|
| `install` | Docker, NVIDIA toolkit, Swarm init, registry |
| `prepare` | Git clone, directories, SSL certs |
| `build` | Docker login to GitLab Container Registry (no longer builds — pulls pre-built CI images) |
| `deploy` | Generate .env, validate, deploy stack, verify |

```bash
# Full deployment
ansible-playbook -i inventory/rtx6000.ini deploy.yml --vault-id agrivisory_rtx6000@prompt

# Rebuild and redeploy (no install/prepare)
ansible-playbook -i inventory/rtx6000.ini deploy.yml --tags build,deploy --vault-id agrivisory_rtx6000@prompt

# Redeploy only (existing images and .env)
ansible-playbook -i inventory/rtx6000.ini deploy.yml --tags deploy --vault-id agrivisory_rtx6000@prompt
```

### Git credentials with `--tags deploy`

The `prepare` play prompts for git credentials via `vars_prompt`. When using `--tags deploy` only, these prompts still appear (Ansible evaluates `vars_prompt` before tag filtering). To avoid the prompts, pass credentials as extra vars:

```bash
ansible-playbook -i inventory/rtx6000.ini deploy.yml --tags deploy --vault-id agrivisory_rtx6000@prompt \
  --extra-vars "git_username=YOUR_USER git_token=YOUR_TOKEN"
```

## GPU Configuration

To deploy without GPU/OPEA services, set in `group_vars/<env>/vars.yml`:
```yaml
deploy_opea: "0"
gpu_env_file: ""
```

GPU env file options (provide GPU-specific defaults in `docker-compose.yaml`):
- `gpu_env_file` (optional — none tracked today) — NVIDIA T4 (16GB VRAM)
- `env.rtx6000` — RTX 6000 ADA (24GB VRAM)

The GPU env file is loaded first, then the Ansible-generated `.env` is loaded on top.
**Ansible `.env` values take precedence** over GPU env file values for any duplicate variables.
This allows per-environment tuning via Ansible while keeping GPU defaults in the committed files.

### Remote GPU Node (Optional)

GENIE.AI supports a standalone GPU node architecture. Instead of running
AI services alongside the app stack, deploy a dedicated GPU node with its own compose file
and nginx reverse proxy. The app node connects to the GPU node via HTTPS (configurable via `gpu_https_port`, default 443)
with path-based routing and API key authentication.

#### Deploy the GPU Node

The GPU node has its own Ansible playbook (`deploy-gpu.yml`) and inventory group:

```bash
# 1. Create inventory (separate group for the GPU node)
cp inventory/inventory.example inventory/my-gpu.ini
# Edit: set [my-gpu] group, update host IP

# 2. Create environment config directory
mkdir -p group_vars/my-gpu
cp -r group_vars/agrivisory_rtx6000 group_vars/agrivisory_mygpu && rm group_vars/agrivisory_mygpu/vault.yml
# then edit nginx_public_domain / email_from / cert knobs per README
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

All services are behind nginx with TLS termination and API key authentication (default port 443, configurable via `gpu_https_port`).

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

#### Self-Signed Certificates — Decision Matrix

Three Ansible variables control TLS verification for self-signed certificates in services not covered by NGINX termination. Each covers a different layer:

| Ansible Variable | Environment Variable | Services | When to set |
|---|---|---|---|
| `node_tls_reject_unauthorized` | `NODE_TLS_REJECT_UNAUTHORIZED` | backend, document-repository | `cert_mode: selfsigned` (set to `"0"`) |
| `opea_ssl_skip_verify` | `OPEA_SSL_SKIP_VERIFY` | OPEA Python services (7) | Remote GPU node uses self-signed cert |
| `keycloak_ssl_skip_verify` | `KEYCLOAK_SSL_SKIP_VERIFY` | dataprep-arango-service | Keycloak behind NGINX with self-signed cert |

**Quick reference — which variables to set by scenario:**

| Scenario | `node_tls_...` | `opea_ssl_...` | `keycloak_ssl_...` |
|---|---|---|---|
| Local, self-signed NGINX, no remote GPU | `"0"` | — | — |
| Local, remote GPU, self-signed cert | `"0"` | `"1"` | — |
| Production, real CA certificates | — | — | — |
| Production/air-gapped, self-signed NGINX + remote GPU | `"0"` | `"1"` | `"1"` |

`—` = use default (verify certs). All three are opt-in via `group_vars/<env>/vars.yml`.

For detailed explanations of each variable and the underlying mechanisms, see [Self-Signed Certificates](../docker-compose-setup.md#self-signed-certificates--decision-matrix).

## Port Configuration

If ports 80/443 are occupied (e.g. by another stack), override them in your environment config:

```yaml
# group_vars/<env>/vars.yml
nginx_http_port: "1080"
nginx_https_port: "1443"
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
# Note: GENIE realm admin (username = genie_admin_username, default genie-admin) has separate credentials (genie_admin_password)
```

### User lifecycle

How users come to exist on the system — self-registration, the Pending-approval
gate, admin approval (dashboard or API), realm roles, Grafana access, and the
bootstrap admin — is documented step-by-step in
[`docs/users.md`](../../docs/users.md).

### Variable Substitution and Resolved Compose File

Docker Swarm (`docker stack deploy`) does **not** automatically load `.env` files like Docker Compose does. To ensure environment variables are correctly substituted:

1. The playbook verifies that critical vault variables (ARANGO_PASSWORD, KONG_DB_PASSWORD, KC_DATAPREP_CLIENT_SECRET) are set in the `.env` file before deployment
2. It generates a resolved `docker-compose.resolved.yaml` with all variables substituted using `docker compose config` (the source template is never modified)
3. Post-processing fixes known `docker compose config` issues:
   - **Port integers**: `docker compose config` converts published ports to strings (e.g. `"80"` instead of `80`), which Swarm rejects. A `sed` fix restores them to integers.
   - **`name:` properties**: `docker compose config` adds `name:` properties that Swarm does not support. A `sed` fix removes them.
4. The resolved file is deployed to the Swarm
5. The resolved file is set to mode `0600` since it contains secrets

The source template (`docker-compose.yaml`) is never modified — resolved output is written to `docker-compose.resolved.yaml`. Tagged re-runs (`--tags build,deploy`) correctly re-resolve variables since the source always contains template references.

**Note on CSP values**: Variables containing CSP keywords like `'self'` must be quoted in the `.env` file (e.g. `CSP_CONNECT_SRC="'self' https://example.com"`). Without quotes, `docker compose config`'s YAML parser strips the single quotes, breaking the CSP directive. The Ansible template handles this automatically.

## Teardown

```bash
# Remove stack (preserve volumes)
ansible-playbook -i inventory/rtx6000.ini teardown.yml --vault-id agrivisory_rtx6000@prompt

# Remove stack + volumes
ansible-playbook -i inventory/rtx6000.ini teardown.yml --vault-id agrivisory_rtx6000@prompt \
  -e "teardown_remove_volumes=true"

# Remove stack + volumes (+ legacy local registry if present)
ansible-playbook -i inventory/rtx6000.ini teardown.yml --vault-id agrivisory_rtx6000@prompt \
  -e "teardown_remove_volumes=true" \
  -e "teardown_remove_registry=true"  # only needed for old deployments with localhost:5000
```

## Troubleshooting

### "Missing required vault variable"
```bash
ansible-vault edit --vault-id <env>@prompt group_vars/<env>/vault.yml
# Ensure all secrets listed in the Vault Secrets table are set
```

### `'swarm_registry_url' is undefined` or `'image_tag' is undefined`

These variables are computed by `tasks/deploy-shared-facts.yml` during the `build` tag. If you skip the build tag and go directly to `deploy`, the facts are missing.

**Fix:** Always include `build` before `deploy`, or run both together:
```bash
ansible-playbook -i inventory/<env>.ini deploy.yml --tags build,deploy --vault-id <env>@prompt
```

### `'nginx_permissions_policy' is undefined`

The `nginx_permissions_policy` variable has a default in `group_vars/all.yml`. This error occurs if a custom `group_vars/<env>/vars.yml` explicitly sets `nginx_*` variables but omits this one, or if `all.yml` was removed.

**Fix:** Add to `group_vars/<env>/vars.yml`:
```yaml
nginx_permissions_policy: "camera=(), microphone=(), geolocation=()"
```

### `Permission denied (publickey)`

SSH key not configured on the target host, or connecting with wrong user.

**Fix:**
```bash
# Copy your public key to the target host
ssh-copy-id <user>@<host>

# WSL users: if keys are on a Windows mount (permissions 777), SSH refuses them
# Copy to WSL home instead:
cp -r /mnt/c/Users/<you>/.ssh ~/.ssh
chmod 700 ~/.ssh && chmod 600 ~/.ssh/*
```

### Keycloak realm import fails with "Invalid sender address 'null'"

The `smtpServer` block in the Keycloak realm template (`configs/keycloak/genie-realm.yaml`) is always present. If `EMAIL_FROM` is empty (the default), Keycloak rejects the realm configuration during import — this is unconditional, whatever `keycloak_verify_email`/`keycloak_reset_password` are set to (the preflight sweep enforces it: `email_from` is required always).

**Fix:** Set `email_from` in your group_vars — any valid address works, even with no SMTP server (the stack deploys; mail is simply undeliverable). To actually send mail, also set `email_host` (plus `email_user`/`email_password` for authenticated SMTP):

```yaml
# group_vars/<env>/vars.yml
email_from: "noreply@example.com"
email_host: "smtp.example.com"   # only needed to deliver mail
```

### "Missing required vault variable: kc_mobile_client_id"

The `kc_mobile_client_id` and `kc_mobile_redirect_scheme` vault variables are validated by the playbook but may be missing from older vault files.

**Fix:** Add them to your vault:
```bash
ansible-vault edit --vault-id <env>@prompt group_vars/<env>/vault.yml
```
```yaml
kc_mobile_client_id: "genie-mobile"       # Keycloak public client ID for Flutter app
kc_mobile_redirect_scheme: "genieai://"    # Mobile app redirect URI scheme
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
