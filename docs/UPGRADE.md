# Upgrade Guide

This document covers breaking changes and migration steps between GENIE.AI
versions. Applies to all releases — major, minor, and patch — whenever a
change requires manual action from deployers.

---

## Unreleased

### Breaking Changes

#### Translation language overrides: `LANGUAGE_CODES_FILEPATH` / `LANGUAGE_SCRIPTS_FILEPATH` → `LANGUAGE_REGISTRY_FILEPATH`

The supported translation languages are now read from a single canonical
registry (`components/gov-chat-backend/services/translation/language-maps/language-registry.json`),
not from the two chatqna JSON files or the per-model backend maps (now
derived). The two old env overrides are gone.

**Migration:** if your deployment set `LANGUAGE_CODES_FILEPATH` and/or
`LANGUAGE_SCRIPTS_FILEPATH`, set `LANGUAGE_REGISTRY_FILEPATH` to the registry
file instead (in the chatqna image the default already resolves next to the
service module — most deployments need no change). A file left in the old
flat shape is refused: the chatqna service logs an error and answers every
request in English.

---

## v2.1.0 → v3.0.0

v3.0.0 carries breaking changes across deployment, configuration and API.
Read this section in full before upgrading — two of them (the host
configuration mirror and the embedding-model default) can cause data loss or
silent misbehaviour if skipped.

### Breaking Changes

#### Host configuration is now a mirror of the deployed branch

The `config_bootstrap` role rsyncs the branch's theme and configuration files
onto the node on every deployment (`--archive --checksum --delete`): a file
edited directly on the host is reverted by the next deployment, and a file the
branch no longer ships is removed.

**Migration**: move any hand-edited host configuration into the repository
(the flavour's configuration file). Two variables relax the new guards when
they misfire: `config_bootstrap_allow_rebrand` (a deliberate brand rename —
set it for the one deployment that applies the rename, unset it afterwards)
and `config_bootstrap_theme_entrypoints` (a theme that serves only some of
the realm's screens). A deployment that failed mid-mirror resumes by
re-running it.

#### Two new host directories are required

`<config_dir>/frontend/` and `<config_dir>/keycloak/themes/` now hold the
theme stylesheet, the runtime JSON config, the logos, the splash images and
the whole Keycloak `genie` theme, served live from the host. Only Keycloak
needs a restart after a theme edit
(`docker service update --force <stack>_keycloak`).

**Migration**: an Ansible deployment creates and fills both automatically. A
hand-rolled deployment must create both directories and copy the files in, or
the site comes up without any branding.

#### Keycloak is no longer a GENIE.AI image

The stack runs `quay.io/keycloak/keycloak:26.7.0` straight from upstream —
15 GENIE.AI images instead of 16.

**Migration (air-gapped)**: mirror the upstream Keycloak image in addition to
the 15 GENIE.AI images. Theme bootstrap additionally downloads branding
archives from the GitLab repository-archive endpoint on every deploy node —
an air-gapped node must either reach that endpoint or pre-seed both host
config directories by hand and set `config_bootstrap_sync_enabled: false`.

**Migration**: delete `GENIE_AI_KEYCLOAK_IMAGE` and
`GENIE_AI_KEYCLOAK_IMAGE_TAG` from any local `.env` (ignored if left in
place).

#### `OPEA_SSL_SKIP_VERIFY` is now explicit

Certificate verification for the model-endpoint calls was previously disabled
as a side effect of setting `VLLM_API_KEY` for a remote GPU.

**Migration**: if your GPU node serves a self-signed certificate, set
`OPEA_SSL_SKIP_VERIFY=1` (Ansible: `opea_ssl_skip_verify: "1"` in
`group_vars/<env>/vars.yml`). Without it the deployment completes and fails
at its first model call with `CERTIFICATE_VERIFY_FAILED`. Deployments using
Let's Encrypt or a recognized CA, and deployments without a remote GPU node,
need no change.

#### Two dead API endpoints removed

`POST /api/service-categories/init` and `GET /api/analytics` answered 500 on
every call — they wired to service methods removed in earlier refactors —
and no first-party client called either. (On the analytics route a malformed
`filters` parameter was the one exception: it was rejected with 400 before
the service was reached.)

**Migration**: none for first-party clients. Seed the taxonomy from the
Knowledge Hierarchy tab of the Admin Dashboard (or
`components/gov-chat-backend/scripts/new-schema-scripts/create-knowledge-hierarchy.js`
— turn the ArangoDB schema validation off for `serviceCategories`,
`services` and `categoryServices` before running the script, and back on
afterwards); read `GET /api/analytics/dashboard` instead of the removed
route.

#### The OKF model listing follows the chat path's URL rule

The OKF admin panel lists the models of a saved configuration at
`{base}/models` when the base carries no version segment; it now lists at
`{base}/v1/models` — the one rule the chat call uses, so the listing and
the chat can never disagree about where `/v1` goes.

**Migration**: a saved configuration whose base serves the model list at the
root (`http://my-proxy:8080/models`) must carry its version segment
(`http://my-proxy:8080/v1`). The chat call already resolved that base with
the `/v1` prefix, so only the listing path changes.

#### The deployment vLLM bearer no longer reaches foreign endpoints

The OKF server scoped its deployment credential (`VLLM_API_KEY`) to the
deployment endpoint. A judge at `RAGAS_JUDGE_BASE_URL`, or a saved model
configuration without a key of its own, no longer receives it — before,
the bearer was sent to whatever endpoint those settings named.

**Migration**: an endpoint on another host that accepted the deployment
bearer now answers 401. Give it its own credential — `RAGAS_JUDGE_API_KEY`
for the judge (explicit only in compose and Ansible since this change), or
the `api_key` field on the saved model configuration.

#### The OKF judge no longer inherits the deployment's model name

`RAGAS_JUDGE_MODEL` no longer defaults to `VLLM_LLM_MODEL_ID` for the OKF
server (compose and Ansible): unset, it discovers the served model on the
judge base.

**Migration**: a judge endpoint whose `/v1/models` is unreadable (an
ACL'd proxy) must be pinned explicitly — set `RAGAS_JUDGE_MODEL` (or
`ragas_judge_model` in Ansible) to a name that endpoint serves. The ragas
sidecar keeps its own default (its judge base is the deployment vLLM) and
has no discovery: with neither `RAGAS_JUDGE_MODEL` nor `VLLM_LLM_MODEL_ID`
set, its judge is "not configured" and the benchmark leg answers 503.

#### The suite `generator` field is a list

The benchmark suite's `generator` field was a single `llm:<model>` token
(or a placeholder that named nothing). It now lists every model that
produced the suite, comma-separated (`llm:model-a,llm:model-b`), or
`none` when no LLM call generated it.

**Migration**: a consumer that parses it as one token must handle both
shapes (split on `,`; expect the literal `none`).

#### Service-category translation field names

On POST/PUT of categories and services, translations now read
`languageCode`/`translation` (was `lang`/`text`). The old names are no longer
accepted; translations sent under them are silently lost.

**Migration**: update any external client that posts category or service
translations.

#### Frontend runtime config is validated at load

A `genie-ai-config*.json` that does not match its embedded schema stops the
web app from starting, with the failing paths reported. A config that cannot
be fetched at all still falls back to the bundled defaults.

**Migration**: validate hand-edited configs before deploying —
`npm run validate:config` in `components/gov-chat-frontend`.

#### A configured GPU translation API is mandatory

With `GPU_NODE_HOST` set (or a `VLLM_TRANSLATION_ENDPOINT` other than the
in-cluster worker), the backend now refuses to start when the GPU API does
not answer; `TRANSLATION_BACKEND` is not consulted. A failed GPU unit is
served in English rather than silently re-translated by the CPU model.

**Migration**: ensure a configured GPU endpoint is reachable at boot.

#### Unsupported languages are refused

The chat routes answer `400 UNSUPPORTED_LANGUAGE` instead of producing an
answer in another language, and conversation history is normalized to English
regardless of the requested language.

**Migration**: none — inform users that requests outside the supported
languages are refused up front.

#### `MAX_MODEL_LEN_TEXTGEN` now caps instead of overriding

The LLM context window is discovered at runtime from vLLM; a deployer-set
`MAX_MODEL_LEN_TEXTGEN` caps the usable window even when discovery answers.

**Migration**: if you set `MAX_MODEL_LEN_TEXTGEN` in a previous deployment
and want the full discovered window, remove it.

#### Default embedding model: bge-base → bge-large

New deployments embed with `BAAI/bge-large-en-v1.5` (1024-dim): ~3× embedding
latency, +~0.9 GB VRAM, +1 KB stored per chunk. `EMBEDDING_MODEL_ID` still
selects bge-base.

**Migration — data-loss risk**: a deployment that takes the new default
against a corpus ingested with bge-base gets silently empty retrieval results
(dimension mismatch). Either re-ingest the corpus after upgrading, or pin
`EMBEDDING_MODEL_ID=BAAI/bge-base-en-v1.5` in `.env` / `vars.yml`.

#### Retriever label-filter strategy variable renamed

The retriever read the filter strategy under a variable name no deployment
set, so a deployment asking for `AND` (every label present) silently filtered
with `OR`. It now reads `RETRIEVER_ARANGO_FILTER_STRATEGY` and refuses to
start on any other value.

**Migration**: if you set the old variable name, rename it; the value must be
`AND` or `OR`.

#### Log pipeline env vars removed

`LOG_TO_VICTORIALOGS`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`,
`ADMIN_LOGS_SOURCE` and `VL_FAIL_OPEN` are no longer read: every log reaches
VictoriaLogs through the single fluentd → collector channel, and a VictoriaLogs
outage is a typed HTTP 503 on `/api/admin/logs/*`.

**Migration**: delete them from `.env` / group vars (harmless if left).
An operator who relied on `LOG_TO_FILE` file rotation must re-add the
`/app/logs` bind mount manually.

### Non-Breaking Changes Worth Noting

- vLLM bumped 0.10 → 0.29 on both GPU images (CUDA crash-loop fix);
  `--max_num_seqs` default 64 → 16, and the `env.t4` / `env.rtx6000`
  templates now ship 16 too — if your own vars pin `VLLM_MAX_NUM_SEQS`
  higher, 16 is the validated value on the shared RTX 6000 Ada.
- LLM call budgets are unified under the `MODEL_*` env knobs (LLM default
  180 s). Documents whose labelling exceeds the new phase ceiling land as
  `Ingested with Warnings` — raise `MODEL_LLM_TIMEOUT_SECONDS` and
  `DATAPREP_LLM_PHASE_TIMEOUT_SECONDS` together on a slow shared GPU.
- The Keycloak theme now covers the admin console, account console and
  emails; the gateway overrides theme-resource caching.
- chatqna rejects unauthenticated requests (Bearer + Keycloak JWKS).
- The admin Query Inspector shows abstentions and their causes.

---

## v2.0.1 → v2.1.0

### Breaking Changes

#### OPEA v1.3 → v1.5

All four OPEA overlay images (chatqna, dataprep, retriever, reranker) now build from OPEA v1.5. The upgrade absorbs 7.5 months of upstream bug fixes and dependency CVEs while preserving GENIE's RAG behavior (retrieval, reranking, labeling, contextual retrieval).

**Compatibility**: ArangoDB vector store format unchanged. Existing embeddings and graph data are compatible. No data migration required.

**Rollback**: Redeploy the previous v1.3-based image tags. The v1.3 images remain in the registry.

**What changed**:
- All OPEA services now use Python 3.11 (was 3.10)
- Dataprep image base aligned to OPEA v1.5 upstream (`python:3.11-slim`, GPU support maintained via pip-installed CUDA libraries)
- Retriever graph name default unified to `ARANGO_GRAPH_NAME` (was `RETRIEVER_ARANGO_GRAPH_NAME`)

**Migration**: No manual migration required. Pull new images and redeploy.

#### Python 3.10 → 3.11

All OPEA overlay images now use Python 3.11 (matching OPEA v1.5's base). Custom Python code in the overlay (if any) should be tested against Python 3.11.

**Compatibility**: Python 3.11 is backward-compatible with 3.10 for standard library and most third-party packages. No code changes expected.

#### Dataprep Image Base Change

The dataprep image base changed from `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` to `python:3.11-slim` to align with OPEA v1.5 upstream. **GPU support is maintained** — CUDA libraries are now installed via pip (`cuda-toolkit`, `nvidia-cuda-runtime`) rather than baked into the base image.

**Compatibility**: No functional change. Docling continues to use GPU for document parsing when `DOCLING_DEVICE=cuda` (default). The dataprep service still runs on GPU nodes (`node.labels.gpu == true`).

---

## v2.0.0 → v2.0.1

### Breaking Changes

#### PostgreSQL 13 → 16

PostgreSQL 13 reached end-of-life in November 2025 and no longer receives
security patches. The default image is now `postgres:16`.

**Compatibility**: Keycloak 26 supports PostgreSQL 14–18. Kong 3.x supports
PostgreSQL 16. No application-level SQL changes required.

**Migration required for existing deployments.** PostgreSQL 13 data format is
incompatible with 16 — the server will refuse to start with old data.

##### Migration procedure (verified, ~5–10 min downtime)

**Docker Swarm** (stack name: `genieai`, volume: `genieai_postgres_data`):

```bash
# 1. Stop apps that depend on PostgreSQL
docker service scale genieai_kong=0 genieai_keycloak=0
docker service scale genieai_kong-migrations=0 genieai_postgres-init=0

# 2. Dump all databases from the old PG 13 container
PG=$(docker ps --filter name=genieai_postgres --format '{{.Names}}')
docker exec "$PG" pg_dumpall -U genieai > /tmp/pg_dump.sql

# 3. Stop PostgreSQL, backup the volume
docker service scale genieai_postgres=0
docker volume rename genieai_postgres_data genieai_postgres_data_pg13

# 4. Ensure docker-compose.yaml uses postgres:16 (update from the new release)
# 5. Deploy with the new image
docker stack deploy -c docker-compose.yaml genieai

# 6. Wait for healthy
until docker exec $(docker ps --filter name=genieai_postgres --format '{{.Names}}') \
  pg_isready -U genieai; do sleep 2; done

# 7. Restore
docker exec -i $(docker ps --filter name=genieai_postgres --format '{{.Names}}') \
  psql -U genieai -d postgres -f - < /tmp/pg_dump.sql

# 7b. Reset passwords — pg_dumpall ALTER ROLE may fail for already-existing roles.
# Reset ALL roles: genieai (superuser), kong, keycloak.
# Replace with actual passwords from your .env (POSTGRES_PASSWORD, KONG_PG_PASSWORD, KEYCLOAK_DB_PASSWORD).
docker exec $(docker ps --filter name=genieai_postgres --format '{{.Names}}') \
  psql -U genieai -d postgres -c "ALTER ROLE genieai WITH PASSWORD '<POSTGRES_PASSWORD>';"
docker exec $(docker ps --filter name=genieai_postgres --format '{{.Names}}') \
  psql -U genieai -d postgres -c "ALTER ROLE kong WITH PASSWORD '<KONG_PG_PASSWORD>';"
docker exec $(docker ps --filter name=genieai_postgres --format '{{.Names}}') \
  psql -U genieai -d postgres -c "ALTER ROLE keycloak WITH PASSWORD '<KEYCLOAK_DB_PASSWORD>';"

# 8. Restart apps
docker service scale genieai_kong=1 genieai_keycloak=1

# 9. Verify
docker exec $(docker ps --filter name=genieai_postgres --format '{{.Names}}') \
  psql -U genieai -d postgres -c "SELECT version();"

# 10. Cleanup — remove the backup volume (only after confirming everything works)
docker volume rm genieai_postgres_data_pg13
```

**Docker Compose** (project name: `<dirname>`, volume: `<dirname>_postgres_data`):

```bash
# 1. Stop dependent services
docker compose stop kong keycloak kong-migrations postgres-init

# 2. Dump from the old PG 13 container
docker compose exec -T postgres pg_dumpall -U genieai > /tmp/pg_dump.sql

# 3. Stop PostgreSQL
docker compose stop postgres

# 4. Backup volume, then remove it
PROJECT=$(docker compose config --format json | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))")
docker volume rename ${PROJECT}_postgres_data ${PROJECT}_postgres_data_pg13

# 5. Update docker-compose.yaml: postgres:13 → postgres:16
# 6. Start fresh PostgreSQL
docker compose up -d postgres

# 7. Wait for healthy, then restore
docker compose exec -T postgres psql -U genieai -d postgres -f - < /tmp/pg_dump.sql

# 8. Restart apps
docker compose up -d

# 9. Cleanup — remove backup volume (only after confirming everything works)
docker volume rm ${PROJECT}_postgres_data_pg13
```

##### Rollback

**Docker Swarm**:
```bash
docker service scale genieai_kong=0 genieai_keycloak=0 genieai_postgres=0
docker volume rm genieai_postgres_data
docker volume create genieai_postgres_data
docker run --rm \
  -v genieai_postgres_data_pg13:/src \
  -v genieai_postgres_data:/dst \
  alpine cp -a /src/. /dst/
# Revert docker-compose.yaml: postgres:16 → postgres:13
docker stack deploy -c docker-compose.yaml genieai
```

**Docker Compose**:
```bash
PROJECT=$(docker compose config --format json | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))")
docker compose stop
docker volume rm ${PROJECT}_postgres_data
docker volume create ${PROJECT}_postgres_data
docker run --rm \
  -v ${PROJECT}_postgres_data_pg13:/src \
  -v ${PROJECT}_postgres_data:/dst \
  alpine cp -a /src/. /dst/
# Revert docker-compose.yaml: postgres:16 → postgres:13
docker compose up -d
```

##### Verification Checklist

- [ ] `pg_isready` returns accepting connections
- [ ] `SELECT version()` shows PostgreSQL 16.x
- [ ] Kong proxy routes respond (`curl -k https://localhost/api/me`)
- [ ] Keycloak login page loads
- [ ] All databases present: `psql -U genieai -d postgres -c "\l"` shows `kong` and `keycloak`
- [ ] `-d postgres` used for connection — `POSTGRES_DB` default is deployment-specific

#### Docker Base Image Changes

All base images have been updated. Rebuilds are automatic via CI — no manual
action needed for new deployments. Existing deployments pull updated images
on the next `docker stack deploy`.

| Image | Old | New |
|-------|-----|-----|
| Node.js | `node:22.14.0` | `node:22` |
| Node.js Alpine | `node:22.14.0-alpine` | `node:22-alpine` (except `Dockerfile.migrations`, fixed in MR !259) |
| Alpine | `3.21` | `3.22` |
| Keycloak | `26.6.1` | `26.7` |

#### Image Tags Now Pinned

All `:latest` tags have been pinned to specific versions in
`docker-compose.yaml`. This ensures reproducible deployments and consistent
SBOMs. If you were relying on image auto-updates via `:latest`, update
your workflow to explicitly bump pinned tags.

| Image | Before | After |
|-------|--------|-------|
| Kong | `kong:latest` | `kong:3.9.3` |
| ClamAV | `clamav/clamav` (no tag) | `clamav/clamav:stable-debian` |
| BusyBox | `busybox:latest` | `busybox:1.38.0` |
| Certbot | `certbot/certbot:latest` | `certbot/certbot:v5.7.0` |
| vLLM | `vllm/vllm-openai:latest` | `vllm/vllm-openai:v0.10.0` |
| OPEA Translation | `opea/translation:latest` | `opea/translation:1.3` |
| OPEA Guardrails | `opea/guardrails:latest` | `opea/guardrails:1.5` |
| OPEA ChatQnA UI | `opea/chatqna-ui:latest` | `opea/chatqna-ui:1.5` |
| OPEA Nginx | `opea/nginx:latest` | `opea/nginx:1.5` |

#### Container Scanning Report Names

Container scanning findings in the GitLab vulnerability report are now tracked
under persistent image names (`genie-ai-backend:main`) instead of temporary
names (`tmp/genie-ai-backend:mr-NNN-abc`). This fixes auto-resolution of CVEs
across rebuilds. No deployment action required — CI-side change only.

### Non-Breaking Changes

- npm dependencies updated across all components (backend, frontend,
  document-repository)
- `lucide-vue-next` migrated to `@lucide/vue`
- Docker build now uses `--pull` to always fetch latest base image patches
- GPU config validator hardened: checks for unpinned image tags instead of
  hardcoded version lists
