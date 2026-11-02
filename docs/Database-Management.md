# Database Management — System Administration

## Overview

The **Database Management** feature is a tab within the System Administration dashboard that provides administrators with tools to maintain the underlying ArangoDB database. It enables routine maintenance operations (reindexing, backups, optimization) and displays real-time database statistics.

This feature is accessible only to users with the **admin** role, protected by authentication and authorization middleware.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Vue.js)                                                  │
│                                                                     │
│  AdminDashboard.vue ──► databaseOperationsService.js ──► httpService│
│         │                                                           │
│         └──► OperationResultsModal.vue (displays results)           │
└─────────────────────────────────────────────────────────────────────┘
                              │ HTTP (via Kong API Gateway)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend (Node.js / Express)                                        │
│                                                                     │
│  admin-routes.js ──► database-operations-service.js ──► ArangoDB    │
│                                                                     │
│  Middleware: authMiddleware.authenticate + authMiddleware.isAdmin    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ArangoDB 3.12.4 (database: "node-services")                        │
│  Container: arango-vector-db | Port: 8529                           │
│  Feature: --experimental-vector-index=true                          │
└─────────────────────────────────────────────────────────────────────┘
```

## What is Stored in ArangoDB

The `node-services` database is the central data store for the entire platform. It contains approximately 30 collections:

### Document Collections

| Collection | Purpose |
|---|---|
| `users` | User profiles (credentials, personal ID, address, employment, education, etc.) |
| `conversations` | Chat conversation threads (title, timestamps, starred/archived status) |
| `messages` | Individual chat messages (content, sender type, sequence, read status) |
| `queries` | User questions sent to the AI/RAG system (text, response, feedback) |
| `sessions` | User sessions (device info, IP, active status) |
| `events` | Analytics events (event type, timestamp, details) |
| `analytics` | Aggregated metrics (query counts, satisfaction rates, response times) |
| `analyticsMetrics` | Additional analytics metric data |
| `serviceCategories` | Government service categories (multilingual: EN/FR/SW) |
| `services` | Individual services under categories |
| `serviceCategoryTranslations` | Category name translations |
| `serviceTranslations` | Service name translations |
| `folders` | User-created folders for organizing conversations |
| `conversationFiles` | Links between conversations and referenced documents |
| `passwordResetTokens` | Password reset tokens with expiry |
| `verificationTokens` | Email verification tokens |
| `ingestion_log` | Document ingestion tracking for the RAG pipeline |
| `files` | Document/file references (used by document-repository service) |

### Edge Collections (Graph Relationships)

| Edge Collection | Relationship |
|---|---|
| `userConversations` | users → conversations |
| `userFolders` | users → folders |
| `userSessions` | users → sessions |
| `conversationCategories` | conversations → serviceCategories |
| `folderConversations` | folders → conversations |
| `categoryServices` | serviceCategories → services |
| `queryCategories` | queries → serviceCategories |
| `queryMessages` | queries → messages |
| `sessionQueries` | sessions → queries |
| `serviceCategoryTranslationsEdge` | serviceCategories → translations |
| `serviceTranslationsEdge` | services → translations |

## Operations

### 1. Reindex Database

**What it does:** Drops all non-primary indexes from every collection and recreates them based on predefined index definitions.

**When to use:**
- After bulk data imports or migrations
- When query performance degrades
- After schema changes that affect indexed fields

**How it works:**
1. Iterates all collections in the database
2. Drops every non-primary index
3. Recreates indexes based on the `indexDefinitions` map in `database-operations-service.js`
4. Collections without explicit definitions get a default `createdAt` skiplist index
5. Saves a timestamp to `logs/last_reindex.txt` for tracking

**Predefined indexes:**
- `users`: unique hash on `email`, skiplist on `createdAt`
- `sessions`: hash on `[userId, createdAt]`
- `userSessions`: hash on `[userId, createdAt]`
- `serviceCategories`: skiplist on `[catCode, order]`
- `services`: hash on `[categoryId, order]`

**API endpoint:** `POST /admin/database-operations/reindex`

**Risk level:** Medium — temporarily removes indexes which may affect query performance during the operation.

---

### 2. Backup Database

**What it does:** Creates a full JSON export of all non-system collections and saves it to the backup directory.

**When to use:**
- Before major deployments or migrations
- As part of a regular backup schedule
- Before running destructive operations

**How it works:**
1. Queries every non-system collection using AQL
2. Streams all documents to a JSON file (or NDJSON depending on format config)
3. Optionally compresses the output with gzip
4. Cleans up old backups exceeding `MAX_BACKUPS` retention limit
5. Returns the backup file path and size

**Configuration (environment variables):**
| Variable | Default | Description |
|---|---|---|
| `BACKUP_DIR` | `./database_backups` | Directory for backup files |
| `MAX_BACKUPS` | `5` | Maximum number of backups to retain |
| `BACKUP_FORMAT` | `json` | Output format (`json` or line-delimited) |
| `COMPRESS_BACKUPS` | `false` | Whether to gzip the backup file |
| `APP_NAME` | `huduma` | Prefix for backup filenames |

**Output filename pattern:** `{app_name}_backup_{ISO_timestamp}.json[.gz]`

**API endpoint:** `POST /admin/database-operations/backup`

**Risk level:** Low — read-only operation, but may cause temporary load on the database.

---

### 3. Optimize Database

**What it does:** Compacts all collections and analyzes indexes for performance issues.

**When to use:**
- After large deletions to reclaim disk space
- When database size seems disproportionate to data volume
- Periodically as part of maintenance

**How it works:**
1. Calls `collection.compact()` on each collection (reclaims disk space, merges data files)
2. Analyzes existing indexes for potential issues:
   - Flags hash indexes with selectivity estimate below 0.5 (low cardinality)
   - Flags skiplist indexes with more than 3 fields (overly complex)
3. Returns per-collection results with index improvement suggestions

**API endpoint:** `POST /admin/database-operations/optimize`

**Risk level:** Low-Medium — compaction is safe but may temporarily increase I/O load.

---

### 4. Database Statistics (displayed on the tab)

**What it shows:**
- **Last Reindex** — how long ago the last reindex was performed
- **Database Size** — total size of all document data
- **Total Tables** — number of collections in the database

**API endpoint:** `GET /admin/database-operations/stats`

## File Reference

| File | Layer | Purpose |
|---|---|---|
| `gov-chat-frontend/src/components/AdminDashboard.vue` | Frontend | Database tab UI (lines ~895-990) |
| `gov-chat-frontend/src/services/databaseOperationsService.js` | Frontend | HTTP client for database API calls |
| `gov-chat-frontend/src/components/OperationResultsModal.vue` | Frontend | Modal displaying operation results |
| `gov-chat-backend/services/database-operations-service.js` | Backend | Core service with reindex/backup/optimize logic |
| `gov-chat-backend/routes/admin-routes.js` | Backend | Express route definitions (lines ~470-555) |
| `gov-chat-backend/scripts/new-schema-scripts/arango-schema.json` | Schema | Full ArangoDB schema definition |

## Environment Variables

| Variable | Example | Used By |
|---|---|---|
| `ARANGO_URL` | `http://arango-vector-db:8529` | Backend connection |
| `ARANGO_DB_NAME` | `node-services` | Database name |
| `ARANGO_USER` | `root` | Authentication |
| `ARANGO_PASSWORD` | (secret) | Authentication |
| `BACKUP_DIR` | `./database_backups` | Backup storage path |
| `MAX_BACKUPS` | `5` | Backup retention count |
| `BACKUP_FORMAT` | `json` | Backup file format |
| `COMPRESS_BACKUPS` | `true` | Enable gzip compression |

## Security

- All endpoints require a valid JWT token (`authMiddleware.authenticate`)
- All endpoints require the `admin` role (`authMiddleware.isAdmin`)
- Backup files are stored server-side only; they are not downloadable via the API
- Database credentials are never exposed to the frontend

## Troubleshooting

| Issue | Cause | Resolution |
|---|---|---|
| "Database not initialized" error | Service failed to connect on startup | Check `ARANGO_URL` and `ARANGO_PASSWORD` env vars |
| Reindex takes too long | Large number of collections/documents | Run during low-traffic periods |
| Backup fails with disk error | Insufficient disk space in backup directory | Free space or change `BACKUP_DIR` |
| Stats show "5 days ago" for last reindex | Tracking file missing or unreadable | Run a reindex to create the tracking file |
| Optimize reports low selectivity | Hash index on a low-cardinality field | Consider removing or replacing the index |
