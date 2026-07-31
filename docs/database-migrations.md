# ArangoDB Schema Migrations

## Overview

All ArangoDB schema changes (collections, indexes, data migrations) are managed through numbered migration scripts in `components/gov-chat-backend/scripts/migrations/`. These run automatically at deploy time via an init container, before the backend starts.

## How It Works

1. A `db-migrations` init container starts before the backend
2. It connects to ArangoDB and checks the `schema_migrations` collection
3. For each `NNN-description.js` file (sorted by name):
   - If `_key === "NNN-description"` exists in `schema_migrations` → skip (already applied)
   - Otherwise → `require()` the script, call `module.exports.up(db)`, record success
4. The init container exits `0`; the backend starts only after migrations succeed

## Writing a New Migration

Create a file `components/gov-chat-backend/scripts/migrations/NNN-description.js`:

```js
'use strict';

module.exports.up = async function(db) {
  // Example: create a collection
  const collection = db.collection('myCollection');
  const exists = await collection.exists();
  if (!exists) {
    await db.createCollection('myCollection');
  }

  // Example: create an idempotent index (use `name` for dedup)
  await collection.ensureIndex({
    type: 'persistent',
    fields: ['myField'],
    name: 'idx-myField'   // named index = idempotent
  });
};
```

**Rules:**

- Each migration **must** be idempotent (safe to run multiple times)
- Use `collection.ensureIndex({ name: '...' })` for indexes — the name makes it idempotent
- Use `collection.exists()` before creating collections
- Data mutations should use upsert patterns or `HAS` checks
- Do NOT import from `shared-lib` — migration scripts run in a minimal container with only `arangojs` and `dotenv`

## File Naming Convention

- Three-digit prefix followed by a hyphen: `005-ingestion-log.js`
- The prefix determines execution order
- The full filename (without `.js`) becomes the `_key` in `schema_migrations`

## Existing Migrations

| # | File | Purpose |
|---|------|---------|
| 001 | `001-create-collections.js` | Create all document and edge collections |
| 002 | `002-create-indexes.js` | Create persistent and unique indexes |
| 003 | `003-drop-legacy-unique-indexes.js` | Remove conflicting unique indexes from multi-realm migration |
| 004 | `004-remove-legacy-auth-fields.js` | Remove obsolete auth fields (`loginName`, `role`, `accessToken`, `refreshToken`, `encPassword`) |

## Running Migrations Locally

```bash
# Via Docker Compose
docker compose run --rm db-migrations

# Or directly with Node (requires ARANGO_PASSWORD in .env)
node components/gov-chat-backend/scripts/migrations/run-migrations.js
```

## Checking Applied Migrations

```bash
# Via ArangoShell or AQL
FOR m IN schema_migrations SORT m._key RETURN { key: m._key, appliedAt: m.appliedAt }
```

## Important: What This Replaces

The migration system is the **single source of truth** for all schema definitions:

- Collection creation — no longer done by services at runtime via `ensureCollection()`
- Index creation — no longer done by services at runtime via `ensureIndex()`
- Legacy DDL scripts in `scripts/new-schema-scripts/` — these are archived; new schema changes go into migration files only

Services now assume collections and indexes already exist (created by migrations at deploy time).

## Docker Infrastructure

The `db-migrations` service is defined in `docker-compose.yaml`:

- **Image**: Minimal Alpine container with only `arangojs` and `dotenv` (`Dockerfile.migrations`)
- **Lifecycle**: `restart: "no"` (one-shot), with `deploy.restart_policy: on-failure` (max 3 attempts)
- **Dependency**: Waits for ArangoDB healthy before starting
- **Backend dependency**: Backend waits for `db-migrations` to complete successfully before starting

---

# PostgreSQL 13 → 16 Migration

**Date**: 2026-07-31 | **MR**: !258 (CVE remediation) | **Reason**: PostgreSQL 13 EOL Nov 2024

**Compatibility verified**:
- Keycloak 26 supports PG 14–18 ✅
- Kong 3.x supports PG 16 (explicitly listed for 3.4 LTS+) ✅
- ArangoDB independent (not using PostgreSQL) ✅

## Affected files

- `configs/postgres/Dockerfile`: `FROM postgres:13` → `FROM postgres:16` (custom init image)
- `docker-compose.yaml`: `image: postgres:13` → `image: postgres:16`

Data is stored in the `postgres_data` Docker volume. PG 13 data format is incompatible with PG 16 — the server will refuse to start with old data. Migration is required.

## Migration (Docker Compose / Swarm)

### Option A — pg_dump / pg_restore (recommended, ~5-10 min downtime)

```bash
# 1. Stop apps using postgres
docker service scale genieai_kong=0 genieai_keycloak=0

# 2. Dump all databases from PG 13
PG_CONTAINER=$(docker ps --filter name=postgres --format '{{.Names}}')
docker exec "$PG_CONTAINER" pg_dumpall -U genieai > /tmp/pg13_dump.sql

# 3. Stop postgres, backup volume
docker service scale genieai_postgres=0
docker volume rename genieai_postgres_data genieai_postgres_data_pg13

# 4. Deploy with postgres:16 (creates fresh volume)
docker stack deploy -c docker-compose.yaml genieai

# 5. Wait for healthy
until docker exec $(docker ps --filter name=postgres --format '{{.Names}}') pg_isready -U genieai; do sleep 2; done

# 6. Restore
docker exec -i $(docker ps --filter name=postgres --format '{{.Names}}') \
  psql -U genieai -f - < /tmp/pg13_dump.sql

# 7. Restart apps
docker service scale genieai_kong=1 genieai_keycloak=1

# 8. Verify
docker exec $(docker ps --filter name=postgres --format '{{.Names}}') \
  psql -U genieai -c "SELECT version();"
# Expected: PostgreSQL 16.x
```

### Option B — pg_upgrade container (~2-3 min downtime)

```bash
docker service scale genieai_kong=0 genieai_keycloak=0 genieai_postgres=0

# Use the official upgrade image
docker run --rm \
  -v genieai_postgres_data:/var/lib/postgresql/13/data \
  -v genieai_postgres_data_new:/var/lib/postgresql/16/data \
  tianon/postgres-upgrade:13-to-16

# Swap volumes
docker volume rm genieai_postgres_data
docker volume create genieai_postgres_data
docker run --rm -v genieai_postgres_data_new:/src -v genieai_postgres_data:/dst alpine cp -a /src/. /dst/

# Redeploy
docker stack deploy -c docker-compose.yaml genieai
docker service scale genieai_kong=1 genieai_keycloak=1
```

## Rollback

```bash
# Restore PG 13 volume, revert docker-compose.yaml to postgres:13
docker volume rm genieai_postgres_data
docker volume create genieai_postgres_data
docker run --rm -v genieai_postgres_data_pg13:/src -v genieai_postgres_data:/dst alpine cp -a /src/. /dst/
docker stack deploy -c docker-compose.yaml genieai
```

## Verification checklist

- [ ] `pg_isready` returns accepting connections
- [ ] `SELECT version()` → PostgreSQL 16.x
- [ ] Kong routes work (`curl -k https://localhost/api/me`)
- [ ] Keycloak login works
- [ ] All databases migrated (`\l` in psql shows kong + keycloak)
