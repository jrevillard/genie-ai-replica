# Upgrade Guide

This document covers breaking changes and migration steps when upgrading between
major versions of GENIE.AI.

---

## v2.0.0 → NEXT

### Breaking Changes

#### PostgreSQL 13 → 16

PostgreSQL 13 reached end-of-life in November 2024 and no longer receives
security patches. The default image is now `postgres:16`.

**Compatibility**: Keycloak 26 supports PostgreSQL 14–18. Kong 3.x supports
PostgreSQL 16. No application-level SQL changes required.

**Migration required for existing deployments.** PostgreSQL 13 data format is
incompatible with 16 — the server will refuse to start with old data.

##### Option A — pg_dump / pg_restore (recommended, ~5–10 min downtime)

```bash
# 1. Stop services using PostgreSQL
docker service scale genieai_kong=0 genieai_keycloak=0

# 2. Dump all databases from the old PG 13 container
PG=$(docker ps --filter name=postgres --format '{{.Names}}')
docker exec "$PG" pg_dumpall -U genieai > /tmp/pg_dump.sql

# 3. Stop PostgreSQL, backup the volume
docker service scale genieai_postgres=0
docker volume rename genieai_postgres_data genieai_postgres_data_pg13

# 4. Deploy the new stack (postgres:16, creates fresh volume)
docker stack deploy -c docker-compose.yaml genieai

# 5. Wait for PostgreSQL to be healthy
until docker exec $(docker ps --filter name=postgres --format '{{.Names}}') \
  pg_isready -U genieai; do sleep 2; done

# 6. Restore the dump
docker exec -i $(docker ps --filter name=postgres --format '{{.Names}}') \
  psql -U genieai -f - < /tmp/pg_dump.sql

# 7. Restart services
docker service scale genieai_kong=1 genieai_keycloak=1

# 8. Verify
docker exec $(docker ps --filter name=postgres --format '{{.Names}}') \
  psql -U genieai -c "SELECT version();"
# Expected: PostgreSQL 16.x
```

##### Option B — pg_upgrade container (faster, ~2–3 min downtime)

```bash
docker service scale genieai_kong=0 genieai_keycloak=0 genieai_postgres=0

# Run the upgrade container
docker run --rm \
  -v genieai_postgres_data:/var/lib/postgresql/13/data \
  -v genieai_postgres_data_new:/var/lib/postgresql/16/data \
  tianon/postgres-upgrade:13-to-16

# Replace old volume with upgraded one
docker volume rm genieai_postgres_data
docker volume create genieai_postgres_data
docker run --rm \
  -v genieai_postgres_data_new:/src \
  -v genieai_postgres_data:/dst \
  alpine cp -a /src/. /dst/

# Redeploy
docker stack deploy -c docker-compose.yaml genieai
docker service scale genieai_kong=1 genieai_keycloak=1
```

##### Rollback

```bash
# Restore PG 13 volume, revert docker-compose.yaml to postgres:13
docker volume rm genieai_postgres_data
docker volume create genieai_postgres_data
docker run --rm \
  -v genieai_postgres_data_pg13:/src \
  -v genieai_postgres_data:/dst \
  alpine cp -a /src/. /dst/
docker stack deploy -c docker-compose.yaml genieai
```

##### Verification Checklist

- [ ] `pg_isready` returns accepting connections
- [ ] `SELECT version()` shows PostgreSQL 16.x
- [ ] Kong proxy routes respond (`curl -k https://localhost/api/me`)
- [ ] Keycloak login page loads
- [ ] All databases present (`\l` in psql shows `kong` and `keycloak`)

#### Docker Base Image Changes

All base images have been updated. Rebuilds are automatic via CI — no manual
action needed for new deployments. Existing deployments pull updated images
on the next `docker stack deploy`.

| Image | Old | New |
|-------|-----|-----|
| Node.js | `node:22.14.0` | `node:22` |
| Node.js Alpine | `node:22.14.0-alpine` | `node:22-alpine` |
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
