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
