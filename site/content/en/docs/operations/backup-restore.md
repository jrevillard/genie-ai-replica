---
title: Backup & Restore
description: Backing up and restoring the ArangoDB databases and the Kong gateway configuration for a GENIE.AI deployment.
weight: 1
---

The two things you must be able to restore after a failure are **the knowledge
base** (ArangoDB — chunks, embeddings, graph, labels) and **the gateway
configuration** (Kong routes and plugins). GENIE.AI ships scripts for both.

## ArangoDB backup

The backup script (`components/arangodb/dump.sh`) dumps every database using
`arangodump` inside the `arangodb/arangodb:3.12` container, into a timestamped
directory:

```
/root/arango_backups/<YYYYMMDDHHMMSS>/
```

It requires the `arango-vector-db` container running on the `chatqna_default`
network. Run it from a Swarm node that can reach the database container.

```bash
cd components/arangodb
./dump.sh
```

> **Password gotcha.** The script hardcodes `--server.password test`. If your
> deployment uses a different `ARANGO_PASSWORD` (it should), **edit the script**
> to read `$ARANGO_PASSWORD` (or pass it) before running — otherwise the dump
> fails authentication. Treat this as a known limitation of the shipped script.

Schedule `dump.sh` via cron on a Swarm node and **copy the backup directory off
the node** (`/root/arango_backups/...`) to durable storage — a backup that lives
only on the same host as the database is not a backup.

## ArangoDB restore

The companion script restores from a specific timestamp:

```bash
cd components/arangodb
./restore.sh <backup_time>      # e.g. ./restore.sh 20250619194410
```

It runs `arangorestore` from `/root/arango_backups/<backup_time>/` against the
running database. The same password caveat applies.

> **Restore is destructive.** Restoring overwrites current data with the backup's
> contents. Practise the restore procedure against a non-production database
> before you need it for real — an untested restore is not a recovery plan.

## Kong gateway configuration

The API gateway routes and plugins are restored with
`api-gateway-solution/new-config/restore-kong-config.sh`:

```bash
cd api-gateway-solution/new-config
./restore-kong-config.sh [-b /opt/kong-config/kong_config.json]
```

It pushes a saved Kong configuration JSON to the Kong admin API
(`KONG_ADMIN_URL`, default `http://localhost:8001`). Keep the exported
`kong_config.json` alongside your ArangoDB backups.

## What to back up

| Artifact | What it holds | How |
|---|---|---|
| ArangoDB dump | Knowledge base: chunks, embeddings, graph, labels, conversations | `dump.sh` |
| Kong config | Gateway routes, plugins, ACLs | export + `restore-kong-config.sh` |
| `.env` | Deployment secrets and config | copy off-host (it is gitignored) |
| Uploaded source documents | Original files in document-repository | back up the uploads volume |

> **Re-ingestion is the fallback.** If every indexed artifact is lost, the
> knowledge base can always be rebuilt from the uploaded source documents by
> re-ingesting them. Keeping the source documents is therefore your insurance of
> last resort. See [Knowledge base &rarr; Document lifecycle]({{< relref "/docs/knowledge-base/document-lifecycle" >}}).
