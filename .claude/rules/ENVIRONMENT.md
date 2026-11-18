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
| `OKF_MAX_CONCEPT_DOC_CHARS` | okf-server | *unset* | Bounds the characters in ONE concept document **body**. Unset = **derived** from the serving-model window; set = an operator pin, never overruled. On Kubernetes: the chart value `okf.maxConceptDocChars`. |
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
- GPU-profile env files: `env.t4` (T4, 2048 window), `env.rtx6000`
  (RTX 6000 ADA, 65536) and `env.strixhalo` (AMD Strix Halo / gfx1151 —
  used with the `docker-compose.rocm*.yaml` overlays; ships **49152**
  on a shared host under the operator's 27 GB ceiling with the 2B-class
  models (granite-3.1-2b @ 0.28, gemma-3-1b-it @ 0.12); the 8B-class
  models need a mostly-dedicated host at 0.55/49152, and 65536 does not
  fit that 45.8 GiB GTT
  aperture). Same budget derivation on all three. On the Strix Halo
  profile the RERANKER runs as a third vLLM instance on the GPU
  (`RERANKER_BACKEND=vllm` — the TEI ROCm image fails on gfx1151;
  `env.strixhalo` flips the switch, `tei` stays the default everywhere
  else).
- The ceiling is enforced on **every** write path: the import splits (or
  rejects), the Studio editor refuses the save (409, nothing written), and
  the publish gate refuses **before** minting a version. For an over-ceiling
  concept the Studio editor now offers the **split affordance** (concept-tree
  row and pane, beside the ceiling advisory) as the remedy: a seam preview
  from the same engine, confirmed before anything is written.

## Environment Variables Structure (Best Practices)

Following DRY principle, defaults live in code/docker-compose, not in env files.

**Main `env` file contains:**

**Secrets (required, no defaults in code):**
- `ARANGO_PASSWORD` - ArangoDB root password
- `POSTGRES_PASSWORD` - PostgreSQL superuser password
- `KONG_DB_PASSWORD` - PostgreSQL dedicated Kong user password
- `KEYCLOAK_DB_PASSWORD` - PostgreSQL dedicated Keycloak user password
- `KEYCLOAK_ADMIN_PASSWORD` - Keycloak master admin console password
- `KEYCLOAK_CLIENT_SECRET` - OIDC client secret for genie-app
- `KEYCLOAK_PROXY_CLIENT_SECRET` - Service account secret for admin API proxy
- `KC_DATAPREP_CLIENT_SECRET` - Dataprep service account secret (client_credentials grant)

**Optional (safely defaulted, unset = feature off):**
- `EMAIL_*` - SMTP configuration for user-verification mail, sent by Keycloak (`KC_SMTP_*` / realm `smtpServer`). Unset or empty = SMTP disabled (Keycloak logs warnings but functions without email). Compose defaults apply consistently in every consuming service (`EMAIL_PORT` 587, `EMAIL_SECURE` false, the rest empty).

**Deployment-Specific:**
- `VLLM_TRANSLATION_MODEL_ID` - GPU translation model ID
- `EMBEDDING_MODEL_ID` / `RERANKER_MODEL_ID` - AI model IDs
- `VLLM_LLM_MODEL_ID` - Labeling/chat LLM. **Must support OpenAI-compatible `response_format={"type":"json_object"}`** (vLLM guided JSON); dataprep requests strict JSON label output per chunk. Models without guided JSON produce malformed output → per-chunk fallback (slower, lower label quality). Validated on `ibm-granite/granite-4.1-8b`.
- `RERANKING_STRATEGY` - Strategy for selecting the final reranked set: `slice` (default; top-N), `threshold`, `slice_threshold`, `knee_threshold`, or `adaptive`.
- `RERANKER_TOP_N` - Number of top chunks kept by `slice`/`slice_threshold` strategies (default 3).
- `CONTEXTUAL_RETRIEVAL_ENABLED` - Contextual Retrieval (Anthropic-style), **on by default**: prepend an LLM doc-context prefix to each chunk before embedding + labeling (default `true`; set `false` to disable — a no-op beyond skipping context generation). Adds one vLLM call/chunk at ingest; never blocks ingestion (raw-chunk fallback). See the [Data Labelling Strategy](site/content/en/docs/rag-pipeline/data-labeling.md) doc (§7 — Contextual Retrieval).
- `DATAPREP_CONTEXTUAL_MODEL` - Model for context generation (empty = reuse `VLLM_LLM_MODEL_ID`); must support guided JSON.
- `DATAPREP_CONTEXTUAL_DOC_BUDGET` - Max chars of document text fed to the context LLM as part of its system prompt. **Default `0` = derive from the serving model's window, discovered at runtime from `VLLM_ENDPOINT`** (issue #1182; same discovery chatqna uses, TTL-cached via `core/model_cache.py`) — the context call is `system prompt + document context + batch chunk text` and reserves `DATAPREP_CONTEXTUAL_MAX_TOKENS` **per chunk in the batch**, so everything but the document context is subtracted from the window. Deriving is what makes one setting correct across hardware that differs 32×: ~250k chars at the default 65536-token window (also `env.rtx6000`, which serves 65536), and **none** on `env.t4` (2048), where the output reservation alone exceeds the window. When discovery has no answer, dataprep falls back to a fail-closed 2048-token window **with a warning naming the remedy**; `DATAPREP_MAX_MODEL_LEN` overrides it. **Never hardcode this from another deployment**: a budget sized for a large GPU overflows a small one, and the rejected calls fall back to raw chunks *silently*. Set `>0` to a maximum — the served window still caps it, so a budget copied from a larger-window deployment cannot overflow a small one — and `<0` to disable contextualization. Truncation (document longer than the budget) is now recorded in the admin Ingestion Log — check it after changing this.
- `VLLM_MAX_MODEL_LEN` - The serving model's context window (`env.t4` 2048, `env.rtx6000` 65536, compose default 65536) — passed to vLLM as `--max-model-len`. **Dataprep does NOT read it** (issue #1182): the doc-context budget derives from the window the endpoint actually serves, discovered at runtime from `VLLM_ENDPOINT`. **Deployment sizes with the model**: a customer who provisions a larger-parameter model and raises this to, say, 131072 gets a proportionally larger document-context budget — dataprep picks up the served window within the discovery TTL (60s), no restart, nothing to re-tune. Raising it is only useful if the GPU has the memory for the KV cache — the window costs memory roughly linearly, which is why `env.t4` is pinned to 2048.
- `DATAPREP_MAX_MODEL_LEN` - The context window (tokens) dataprep sizes document contexts against. **Default `0` = discover it at runtime** from `VLLM_ENDPOINT` (issue #1182; TTL-cached via `core/model_cache.py`). Set `>0` to state the window the endpoint serves — the only lever on a strict OpenAI-compatible provider (its `/v1/models` carries no `max_model_len`, so discovery never answers) and on a deployment whose `DATAPREP_CONTEXTUAL_MODEL` is not the model the endpoint lists first. **Not the vLLM memory knob** — that is `VLLM_MAX_MODEL_LEN` (`--max-model-len`), which dataprep does not read.
- `DATAPREP_CONTEXTUAL_MAX_TOKENS` - Max output tokens for the context-generation LLM call (doc-level + per-chunk). The model writes ~196 tokens; the legacy hard cap of 200 left no headroom, so the JSON `{"context":"..."}` was truncated mid-string under concurrent vLLM load → JSONDecodeError → raw-chunk fallback. 512 gives comfortable margin at no extra cost (default 512).
- `CONTEXTUAL_STRATEGY` - `per_chunk` (default; one call/chunk, section-tailored context — the Anthropic recipe) or `doc_level` (one call/doc, same context on every chunk — N× cheaper, still propagates the doc subject).
- `CONTEXTUAL_LABEL_RAW` - Decoupled mode (default `true`): label the RAW chunk, use the generated context ONLY for the embedding (keeps label precision while propagating the subject via vectors).
- `OKF_MAX_CONCEPT_DOC_CHARS` - Maximum characters in ONE concept document **body** (okf-server). **Unset = derived** from the serving-model window the same endpoint dataprep reads (`/v1/models`) — measured on the default 65536-token window the derived per-chunk budget is ≈219 700 chars. Set it to PIN a number; an operator's pin is never overruled. On Kubernetes the knob is the chart value `okf.maxConceptDocChars` (empty = derived). Enforced on **every** write path: the import **splits** a larger document losslessly (or rejects it with `CONCEPT_TOO_LARGE` when it cannot be split without loss), the Studio editor **refuses** the save (409, nothing written), and the publish gate **refuses before minting** a version. The derivation reads the chunking and batching values the deployment uses (`DATAPREP_CHUNK_SIZE*`, `DATAPREP_CONTEXTUAL_MAX_TOKENS`, `DATAPREP_LLM_LABEL_BATCH_SIZE`, `DATAPREP_MAX_MODEL_LEN`) — those reach **both** dataprep and okf-server, so the two derivations cannot drift (a container that misses them silently falls back to the code defaults while dataprep uses the deployment's — the #1588 drift reborn as a delivery gap). On a 4096- or 2048-token window there is **no room** for a document context at all and contextualization is skipped for every document. Raise it deliberately.
- `CORS_ALLOWED_ORIGINS` - CORS allowed origins
- `CSP_CONNECT_SRC` - Content Security Policy connect sources
- `NGINX_PUBLIC_DOMAIN` - Public domain for Nginx
- `VUE_APP_API_URL` - Frontend API URL
- `VUE_APP_AVAILABLE_LOCALES` - Whitelist of active UI locales (comma-separated codes, e.g. `en,es`; unset = all locales)
- `OKF_MAX_CRAWL_SOURCE_MB` - Max crawled-source file size (MB) okf-server converts into an OKF repository (authoritative pre-flight of the server-side streaming conversion job). Default 10240 (10 GB); mode B batches to the cap, mode A limited to ~45 MB (one request body)
- `OKF_CONVERSION_DEBUG` - `1` = fine-grained per-page/per-batch logging in the crawl→OKF conversion job
- `OKF_IMPORT_CONCURRENCY` - okf-server import lanes (parallel per-concept import pipeline on the creation side — NOT the post-publish drain). Default **4** (was 1); clamp 1..16. **PAIRED with `PII_WEB_CONCURRENCY` — they are one capacity setting, not two** (see *Import capacity* below)
- `PII_WEB_CONCURRENCY` - PII sidecar worker PROCESSES (not threads; GIL-bound NER, ~390 MB spaCy each). Default **4** (was 2, chosen when the sidecar had 2 uvicorn workers). Paired with `OKF_IMPORT_CONCURRENCY`
- `OKF_INGEST_MAX_CONCEPTS` - max concepts per import batch. Default **1000** (was 200). A **capacity knob, not a safety limit** — see *Import capacity* below
- `OKF_INGEST_CONCURRENCY` - okf-server drain lanes (parallel concept indexing; repos are independent units of work). Default 1 (sequential). Raise together with `DATAPREP_INGEST_CONCURRENCY` to scale with machine capacity
- `OKF_SCOPE_MODE` - OKF read authorization mode. Default **`open`**: the serving UNRESTRICTED repos are the public base for EVERY caller, and `okf:*` scopes only decide RESTRICTED repos — grants ADD on top of public access, never remove it. `closed` restores the Story-6.1 exact-list default-deny (scopes = the caller's whole reachable set); an explicit garbage value degrades to `closed`, only absence means open. **Per-repo restriction (6-1c)**: `acl.restricted` on a repo doc fences it from non-privileged users in BOTH modes (stewards + granted users only); NEW repos default open; the editor's Access panel toggles restriction and grants/revokes per-user `okf_scopes` via Keycloak (`KC_OKF_ACCESS_CLIENT_ID/SECRET`, empty secret = grant/revoke 503, enforcement unaffected). Full model: `site/content/en/docs/knowledge-base/access-control.md`; enforcement in `components/okf-server/services/scope-authz-service.js` + `access-control-service.js`
- `DATAPREP_INGEST_CONCURRENCY` - concurrent ingest slots per dataprep container (flock slot pool; 429 only when all busy). Default 1 (historical single-flight)
- `KEYCLOAK_SUPPORTED_LOCALES` - Keycloak login-page locales (JSON array, e.g. `["en","es"]`; unset = curated default)
- `STREAMING_TRANSLATION_ENABLED` - Stream the target-language chat translation during generation instead of English-then-flip (issue #829). `1`/`0`; default `1` — the frontend never translates chat answers client-side, so with `0` non-English UIs get English answers
- `TRANSLATION_BACKEND` - Which backend translates the answer. A deployment that **names** a translation API (`GPU_NODE_HOST` set, or `VLLM_TRANSLATION_ENDPOINT` pointing at something other than the in-cluster worker) always uses it: the GPU is mandatory, the backend waits for it at startup and refuses to start when it does not answer, rather than translate with a model the deployment did not ask for. Where no API is named, this variable chooses between the two backends that exist — `auto` (the code's default when unset) probes the in-cluster worker once and keeps the GPU if it answers, the CPU model (Xenova/nllb-200-distilled-600M, ~6 Gi at ONNX load) if it does not; `cpu` takes the CPU model; `gpu` skips the probe and requires the GPU.
- `CONFIG_DIR_FRONTEND` / `CONFIG_DIR_KEYCLOAK` - Host paths bind-mounted read-only into the frontend (`/app/dist/config`) and Keycloak (`/opt/keycloak/themes`, the themes root — every theme under it is served) containers. Hold the theme CSS, runtime JSON config, logo, splash assets and the whole `genie` Keycloak theme. Seeded from the deployed branch by the `config_bootstrap` role and **mirrored on every deploy** — the branch is the source of truth, so edits made directly on the node are overwritten by the next deploy; keep changes in the repository. Set by Ansible (`deploy/ansible/templates/env.j2`, from `config_dir` in `group_vars/all.yml`); the root `env` template carries the local-dev defaults. **A bind mount never falls back to image contents** — Docker creates a missing source path as an empty root-owned directory that shadows the image, so an unseeded host yields an unbranded frontend and Keycloak with no error anywhere.
- `HUGGING_FACE_HUB_TOKEN` - Required for pulling models
- `VLLM_API_KEY` - GPU node API key, sent as `Authorization: Bearer` by all clients. OpenAI-compatible clients (ChatOpenAI, AsyncOpenAI) use `api_key` param natively; OPEA TEI wrapper services (embedding, reranker) use `HF_TOKEN` env var (automatically set from `VLLM_API_KEY` in docker-compose.yaml)

**Observability (optional, Section 12C):**
- `ENABLE_OBSERVABILITY` - Enable observability stack (default: false)
- `GRAFANA_ADMIN_USER` - Grafana admin username (default: admin)
- `GRAFANA_ADMIN_PASSWORD` - Grafana admin password (required when enabled)
- `GRAFANA_PORT` - Grafana host port (default: 3002, avoids Backend port conflict)
- `VICTORIAMETRICS_RETENTION` - Metric retention period (default: 30d)
- `VICTORIALOGS_RETENTION` - Log retention period (default: 30d)
- `VICTORIATRACES_RETENTION` - Trace retention period (default: 30d)
- `OTEL_TRACES_SAMPLER_RATE` - Trace sampling percentage (default: 100.0 = 100%)
- `KONG_TRACING_INSTRUMENTATIONS` - Kong tracing instrumentations (default: `request`). Negligible overhead when OTel plugin disabled.
- `KONG_TRACING_SAMPLING_RATE` - Kong trace sampling rate 0.0–1.0 (default: 1.0 = 100%, aligned with `OTEL_TRACES_SAMPLER_RATE`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP Collector base URL for all instrumented services — backend (Node.js), OPEA (Python), Kong (via restore script). Default: `http://otel-collector:4318`. Override for external collectors.

**Prompts (Two-tier priority):**

LLM prompts use a simple two-tier priority system:

1. **ENV VAR** (highest): Override in `.env` for deployment-specific customization
2. **DEFAULT** (lowest): Built-in prompts in Python code (works out-of-the-box)

**Prompt Variables:**
- `CHATQNA_SYSTEM_PROMPT` - LLM system prompt (optional, has built-in default)
- `CHATQNA_ABSTENTION_INSTRUCTIONS` - Abstention behavior (optional, has built-in default)
- `CHATQNA_ENFORCE_ABSTENTION` - Whether to enforce abstention (default: "true")
- `LABEL_SELECTOR_SYSTEM_PROMPT` - Document labeling (has built-in default with `{labels_list}` placeholder)
- `CONTEXTUAL_RETRIEVAL_PROMPT` - Per-chunk doc-context generation for Contextual Retrieval (has built-in default with `{document_context}` placeholder; only used when `CONTEXTUAL_RETRIEVAL_ENABLED=true`)

**Customizing Prompts:**

Override in `.env`:
```bash
CHATQNA_SYSTEM_PROMPT="Custom prompt here..."
```

To change built-in defaults, edit the Python code:
- `genie-ai-overlay/chatqna/genieai_chatqna.py` - CHATQNA_SYSTEM_PROMPT default
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` - LABEL_SELECTOR_SYSTEM_PROMPT default
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` - CONTEXTUAL_RETRIEVAL_PROMPT default

**GPU-specific files (`env.t4`, `env.rtx6000`) contain only:**
- GPU memory utilization (`VLLM_GPU_UTILIZATION`, `VLLM_TRANSLATION_GPU_UTILIZATION`)
- Model length limits (`VLLM_MAX_MODEL_LEN`, `VLLM_TRANSLATION_MAX_MODEL_LEN`)
- Sequence limits (`VLLM_MAX_NUM_SEQS`, `VLLM_TRANSLATION_MAX_NUM_SEQS`)

**Variables with defaults (NOT in env):**
- All ports: `FRONTEND_PORT`, `BACKEND_PORT`, etc. (defaults in docker-compose.yaml)
- Database URLs: `ARANGO_URL`, `VLLM_ENDPOINT`, etc. (defaults in docker-compose.yaml)
- Service configurations: `LOG_LEVEL`, `NODE_ENV`, `TRANSLATION_BACKEND`, etc. (defaults in code)

**Kubernetes equivalent:** chart
defaults live in `charts/genieai-umbrella/values.yaml`; per-environment
overrides (clusterProfile, namespace, ingress host, Arango/Postgres
topology, GPU mode) ship as a `ConfigMap` rendered by Kustomize in
`genie-ai-deploy/overlays/<env>/dev/`; secrets ship as `SealedSecret`
resources committed in the overlay; the controller materializes them as namespace Secrets the chart's pods mount directly. Only the public values ConfigMap flows through `valuesFrom`.

## Import capacity — sizing for a host (!1080, !1081)

Two **separate pairs**, each of which only works when both halves move together:

| Pair | Creation side | Worker side | Consequence of raising one alone |
|---|---|---|---|
| **Import** | `OKF_IMPORT_CONCURRENCY` | `PII_WEB_CONCURRENCY` | extra lanes **queue at the sidecar** — latency up, throughput flat |
| **Drain** | `OKF_INGEST_CONCURRENCY` | `DATAPREP_INGEST_CONCURRENCY` | extra lanes get **429** from dataprep; the worker backs off and retries |

- **Rule of thumb: both halves ≈ `min(16, cores / 2)`.** There is no correct
  constant — it is hardware-dependent and nothing infers it for you.
- **The two pairs are limited by different things, which is why the import pair
  ships at 4/4 and the drain pair at 1/1.** Import is bounded by the host's own
  CPU (the PII sidecar's scan runs locally and scales with cores). Indexing is
  bounded by the **model services** — labelling calls the LLM and the embedding
  service, both shared and often on one GPU. Raising the drain pair does not use
  more of the machine; it queues on the model and, on a shared GPU, takes capacity
  away from chat answering. Size the drain pair against the model's headroom, not
  the core count.
- **Measured, not estimated.** On a 24-core / 64 GB host with the import pair at
  4/4: the PII sidecar ran **443 % CPU** while okf-server sat at 0.5 % and dataprep
  at 0.2 % — ~18 % of the machine, the rest idle. 4/4 is a *floor* for that host,
  and already oversubscribed on a 4-core VPS.
- **Every import logs the capacity it actually got** (`OKF import lane capacity`),
  with both values and whether they are paired — so a misconfigured host is visible
  in the logs instead of inferred from timings.
- **`OKF_INGEST_MAX_CONCEPTS` is checked AFTER the document-ceiling split**, so an
  operator's "how many documents did I pick" is **not** the number the cap sees.
  Measured on Bali: 999 documents in → **1112** concepts out (89 split families).
  That is why 200 fired on ordinary crawls and 1000 is the default. Raise it
  deliberately for crawl-scale deployments (10,000+ for a national base); the
  bounds that actually protect the machine are `OKF_MAX_CONCEPT_DOC_CHARS` and the
  lane caps, not this number.

### Sizing the four lane variables for a target host

**These are configuration, not hard-coded behaviour.** Never edit service source
to change them. Set them in `.env` (Compose) or `group_vars` (Ansible) — nothing
is rebuilt, but the values are read once at process start, so the affected
containers must be recreated:

```bash
docker compose up -d --force-recreate okf-server pii-service dataprep-arango-service
```

| Cores | RAM | Import pair (`OKF_IMPORT_CONCURRENCY` = `PII_WEB_CONCURRENCY`) | Drain pair (`OKF_INGEST_CONCURRENCY` = `DATAPREP_INGEST_CONCURRENCY`) |
|---:|---:|---:|---:|
| 4 | 8 GB | `2` | `2` |
| 8 | 16 GB | `4` | `4` |
| 16 | 32 GB | `8` | `8` |
| 24 | 64 GB | `12` | `12` |
| 32+ | 64 GB+ | `16` (clamp ceiling) | `16`, then follow the model services |

- **`PII_WEB_CONCURRENCY` is a memory setting first.** Each worker process loads
  its own model copy — measured **~640 MB/worker** on the current image (2.57 GiB
  at 4 workers). Budget `workers × 640 MB` against free RAM *before* choosing the
  value. The spawned workers are `multiprocessing.spawn` children, so they are
  **not** visible as `uvicorn` in `ps` — count `/proc/*/comm == python3.11`, or
  you will wrongly conclude the workers did not start.
- **Verify, do not infer.** After an import, read `OKF import lane capacity` from
  the okf-server log: it reports `import_concurrency`, `pii_web_concurrency`,
  `cores` and `paired`. `paired: false` means import lanes exceed the sidecar's
  workers — the extra lanes are queueing. `pii_web_concurrency: unset` means the
  two were not applied to the same deployment. **`paired` is a configuration
  check, not a contention gauge** — it cannot see other in-flight imports, and
  `POST /:repo_id/import` has no guard against a concurrent one, so N concurrent
  imports demand N × lanes and all report `paired: true` (BUG-17).
- **The shipped defaults are a floor, not a recommendation.** 4/4 on 24 cores is
  ~18 % utilisation (measured). If you are deploying to a host larger than a
  small VPS, set these deliberately from the table.
