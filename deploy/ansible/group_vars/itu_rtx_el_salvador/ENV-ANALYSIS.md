# Environment Variable Coverage Analysis

## Source files
- **Ansible env.j2 template**: generates `.env` on deploy (Section below)
- **Base `env` file** (in repo): reference template — NOT loaded by Ansible deployment
- **env.rtx6000**: GPU override file — loaded alongside `.env` by Ansible
- **docker-compose.yaml**: contains default values for most service variables
- **User's El Salvador .env**: the target configuration

## Ansible env.j2 Coverage (what the playbook generates)

| Variable | Source | Value (El Salvador) |
|----------|--------|---------------------|
| `ARANGO_PASSWORD` | vault | `test` |
| `JWT_SECRET` | vault | `UJeFROw+yRJeVOPi...` |
| `SESSION_SECRET` | vault | `default-session-secret` |
| `TRANSLATION_CACHE_PASSWORD` | vault | `!@#$$5678` |
| `POSTGRES_PASSWORD` | vault | `k1ngk0ng` |
| `AUTH_SERVICE_USERNAME` | vault | `genie-ai-manager` |
| `AUTH_SERVICE_PASSWORD` | vault | `1357924680+Manager` |
| `EMAIL_PASSWORD` | vault | `gLp+Ek)Vf)` |
| `HUGGING_FACE_HUB_TOKEN` | vault | `hf_IUQYaWIy...` |
| `EMAIL_HOST` | vars.yml | `smtp.itu.ch` |
| `EMAIL_PORT` | vars.yml | `587` |
| `EMAIL_SECURE` | vars.yml | `false` |
| `EMAIL_USER` | vars.yml | `genie-ai` |
| `EMAIL_FROM` | vars.yml | `noreply@genie-ai.itu.int` |
| `NGINX_PUBLIC_DOMAIN` | vars.yml | `ai.assembly.govstack.global` |
| `VUE_APP_API_URL` | vars.yml | `https://ai.assembly.govstack.global/api` |
| `VUE_APP_CSP_CONNECT_SRC` | vars.yml | (fixed triple slash) |
| `CSP_CONNECT_SRC` | vars.yml | `ai.assembly.govstack.global` + domains |
| `CORS_ALLOWED_ORIGINS` | vars.yml | `ai.assembly.govstack.global` + domains |

## env.rtx6000 Coverage (GPU overrides)

| Variable | Value |
|----------|-------|
| `VLLM_GPU_UTILIZATION` | `0.6` |
| `VLLM_MAX_MODEL_LEN` | `4096` |
| `VALLM_MAX_NUM_SEQS` | `1024` |
| `VLLM_TRANSLATION_GPU_UTILIZATION` | `0.4` |
| `VLLM_TRANSLATION_MAX_MODEL_LEN` | `8192` |
| `VLLM_TRANSLATION_MAX_NUM_SEQS` | `32` |

**NOTE**: The user's .env has additional VLLM variables not in env.rtx6000:
- `VLLM_LLM_MODEL_ID=ibm-granite/granite-3.3-2b-instruct`
- `VLLM_MODEL_ID=ibm-granite/granite-3.3-2b-instruct`
- `VLLM_GPU_UTIL=0.35`
- `VLLM_MAX_MODEL_LEN=16384`
- `VLLM_DTYPE=half`
- `VLLM_TRANSLATION_SERVICE_PORT=9031`
- `VLLM_TRANSLATION_MODEL_ID=google/gemma-3-4b-it`
- `VLLM_TRANSLATION_GPU_UTIL=0.35`
- `VLLM_TRANSLATION_MAX_MODEL_LEN=8192`
- `VLLM_TRANSLATION_DTYPE=bfloat16`
- `VLLM_TRANSLATION_KV_CACHE_DTYPE=auto`

## Variables NOT covered by Ansible env.j2 + env.rtx6000

These are variables present in the user's El Salvador `.env` that will NOT be set by the current Ansible deployment. They come from either docker-compose.yaml defaults or the base `env` file (which is NOT loaded by Ansible).

### Potentially important — need to decide if they should be added

| Variable | Value in .env | Notes |
|----------|-------------|-------|
| `ARANGO_DB_NAME` | `el-salvador` | **Not used in code** — can be removed |
| `ARANGO_DB` | `el-salvador` | Set via `arango_db` in vars.yml (default: `genie-ai`) |
| `OPENWEATHERMAP_API_KEY` | `b115ccced35ade4c9a1077b6e5a210dd` | Not in template |
| `CORS_ORIGIN` | `http://localhost/` | Separate from `CORS_ALLOWED_ORIGINS`, used by backend code |
| `FRONTEND_URL` | `https://localhost/` | Not in template |
| `HUGGINGFACEHUB_API_TOKEN` | `hf_IUQYaWIy...` | Alias — docker-compose uses `HUGGING_FACE_HUB_TOKEN` |
| `VLLM_API_KEY` | (long JWT) | Required for vLLM authentication on some deployments |
| `VLLM_LLM_MODEL_ID` | `ibm-granite/granite-3.3-2b-instruct` | Overrides default model |
| `VLLM_DTYPE` | `half` | Not in env.rtx6000 |
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | Overrides default |
| `VLLM_TRANSLATION_SERVICE_PORT` | `9031` | Not in env.rtx6000 |
| `VLLM_TRANSLATION_DTYPE` | `bfloat16` | Not in env.rtx6000 |
| `VLLM_TRANSLATION_KV_CACHE_DTYPE` | `auto` | Not in env.rtx6000 |
| `CHATQNA_ENFORCE_ABSTENTION` | `false` | Overrides default `true` |
| `CHATQNA_SYSTEM_PROMPT` | (long prompt) | Custom prompt for El Salvador |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | (instructions) | Custom |
| `LABEL_SELECTOR_SYSTEM_PROMPT` | (rule-based classifier) | Custom labeling prompt |
| `LOGFLAG` | `true` | Debug flag |

### Already covered by docker-compose.yaml defaults (no action needed)

| Variable | Default in docker-compose.yaml |
|----------|-------------------------------|
| `POSTGRES_USER` | `${POSTGRES_USER:-kong}` |
| `POSTGRES_DB` | `${POSTGRES_DB:-kong}` |
| `KONG_*` | Various Kong config defaults |
| `FRONTEND_PORT` | `8090` |
| `APP_NAME` | `Genie AI` |
| `VUE_PROXY_HOST` | `kong:8010` |
| `UV_THREADPOOL_SIZE` | Not in compose (code default) |
| `LOG_LEVEL` | `debug` |
| `JWT_EXPIRES_IN` | `24h` |
| `NODE_ENV` | `production` |
| `TRANSLATION_BACKEND` | `auto` |
| `TRANSLATION_CPU_MODEL_ID` | `Xenova/nllb-200-distilled-600M` |
| `TRANSLATION_THREADS` | `4` |
| `TRANSLATION_BATCHES` | `5` |
| `TRANSLATION_CACHE` | `on` |
| `TRANSLATION_CACHE_PATH` | `/cache/translations` |
| `TRANSLATION_CACHE_HOST` | `redis-cache` |
| `TRANSLATION_CACHE_PORT` | `6379` |
| `BACKEND_PORT` | `3000` |
| `API_PREFIX` | `/api` |
| `SESSION_EXPIRATION_TIME` | `1800000` |
| `BACKUP_DIR` | `./database_backups` |
| `MAX_BACKUPS` | `5` |
| `BACKUP_FORMAT` | `json` |
| `COMPRESS_BACKUPS` | `true` |
| `OPEA_HOST` | `chatqna-xeon-backend-server` |
| `OPEA_PORT` | `8888` |
| `CONTEXT_OPTION` | `conversation-with-context-labels` |
| `DOC_REPO_PORT` | `3001` |
| `DOCUMENT_INGESTION_LANGUAGE` | `en` |
| `DATAPREP_HOST` | `http://dataprep-arango-service` |
| `DATAPREP_PORT` | `5000` |
| `MAX_FILES_UPLOAD` | `10` |
| `MAX_FILE_SIZE` | `52428800` |
| `UPLOAD_DIR` | `./uploads` |
| `BCRYPT_ROUNDS` | `10` |
| `VIRUS_SCANNING` | `true` |
| `CLAMSCAN_*` | Various clamav defaults |
| `CRAWLER_*` | Crawler defaults |
| `NGINX_PORT` | `80` |
| `CHATQNA_*` | Various OPEA defaults |
| `RETRIEVER_*` | Various retriever defaults |
| `DATAPREP_*` | Various dataprep defaults |
| `TEI_*/EMBEDDING_*/RERANKER_*` | Model and service defaults |
| `RUST_BACKTRACE` | `1` |
| `NVIDIA_VISIBLE_DEVICES` | `all` |
| `TEXTGEN_PORT` | `9000` |
| `AUTH_SERVICE_PORT` | `6666` |
| `AUTH_SERVICE_URL` | `http://backend:3000/` |
| `GET_AUTH_TOKEN_URL` | `http://http-service:6666/get-token` |
| `DOC_REPO_URL` | `http://document-repository:3001` |
| `DOCUMENT_REPOSITORY_URL` | `http://document-repository:3001` |
| `BACKEND_SERVICE_URL` | `http://backend:3000` |
| `MEGA_SERVICE_HOST_IP` | `chatqna-xeon-backend-server` |
| `E2E_CPU_URL` | `http://localhost:3000` |
| `DOCLING_DEVICE` | `cuda` |

### Proxy / misc (not needed unless behind firewall)

| Variable | Value | Notes |
|----------|-------|-------|
| `no_proxy` | `noproxy` | Only needed behind proxy |
| `http_proxy` | (empty) | Not needed |
| `https_proxy` | (empty) | Not needed |
| `OPENWEATHERMAP_API_KEY` | `b115ccced...` | Only if weather feature is used |
| `JAEGER_IP` | (commented out) | Telemetry, not needed |
