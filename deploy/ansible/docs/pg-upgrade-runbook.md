# Postgres 13/15 → 16 migration runbook (any env box)

Rehearsed end-to-end locally on 2026-08-28 (simulated PG13 kong-db + PG15
keycloak-db with seeded data → dump → restore into PG16 → apps verified).
The rehearsal caught one landmine this runbook bakes in: **pg_dumpall carries
md5 password hashes from PG13, which PG16's default scram-sha-256 auth
rejects** — step 6 re-hashes them. Total downtime ≈ dump+restore time.

## 0. Preconditions
- New stack deployed and healthy (compose with `postgres:16` services).
- Old volumes intact: `kong_data` (PG13, user `kong`) and `keycloak_data`
  (PG15, user `keycloak`) under the OLD compose project.
- Take a snapshot/backup of both volumes before starting (rollback path).

## 1. Stop the apps that write to these DBs
```bash
docker compose stop kong keycloak kong-migrations kong-config
```

## 2. Dump both old databases (superuser of each old instance)
```bash
docker exec <old-kong-database>   pg_dumpall -U kong     > kong13.sql
docker exec <old-keycloak-db>     pg_dumpall -U keycloak > kc15.sql
```

## 3. Create the new PG16 volumes + containers (done by the new compose)
The new stack's `kong-database` / `keycloak-db` init fresh PG16 volumes with a
bootstrap superuser (`migrator` below = whatever POSTGRES_USER the compose set).

## 4. Restore (as the new cluster's superuser)
```bash
docker exec -i <new-kong-database> psql -U migrator -d postgres < kong13.sql
docker exec -i <new-keycloak-db>   psql -U migrator -d postgres < kc15.sql
```
Expect no errors **except** `role "kong" already exists` / `role "keycloak" already exists` — the new
cluster's bootstrap superuser (compose `POSTGRES_USER`) collides with the dumped role; psql continues
past those and the `ALTER ROLE` lines still apply. Any other error: stop and investigate.

## 5. Reconcile passwords with the new env
The dump carries old md5 hashes → re-hash with the NEW env values:
```bash
docker exec <new-kong-database> psql -U migrator -d postgres \
  -c "ALTER ROLE kong PASSWORD '<KONG_DB_PASSWORD>';"
docker exec <new-keycloak-db> psql -U migrator -d postgres \
  -c "ALTER ROLE keycloak PASSWORD '<KEYCLOAK_DB_PASSWORD>';"
```

## 6. Start the apps and verify
```bash
docker compose up -d
# kong kept its config:
curl -s http://localhost:8001/services  (via docker exec / network)
# keycloak kept its realms:
curl -s http://<host>/auth/realms/agrivisory
# app-level: log in with a pre-migration user
```

## Rollback
Stop new stack, restore the old volumes from the step-0 snapshot, restart the
old compose (kept in git history) until the migration is retried.

## Notes from the rehearsal
- kong 3.9.3 works fine on PG16 once auth is re-hashed (SCRAM).
- Keycloak 26.7.2 starts cleanly against restored PG15 data (realm import is
  NOT re-run — data comes from the dump).
- Do NOT run `kong migrations bootstrap` after restore (data exists); plain
  `kong migrations up` in the compose's one-shot is a safe no-op.
