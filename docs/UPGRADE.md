# Upgrade Guide

This document covers breaking changes and migration steps between GENIE.AI
versions. Applies to all releases — major, minor, and patch — whenever a
change requires manual action from deployers.

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
