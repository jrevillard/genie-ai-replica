---
title: "ArangoDB collections"
weight: 5
description: "Every collection in the GENIE.AI knowledge graph with field schema."
mode: reference
persona: developer
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Purpose

The canonical list of every ArangoDB collection used by GENIE.AI, with
field names and types. Useful when writing an AQL query, debugging a
missing field, or wiring a new microservice.

> Note: this page covers the most-frequently-used collections. The
> complete list (defined in `001-create-collections.js`) also includes
> `sessions`, `sessionQueries`, `userSessions`, `userConversations`,
> `conversationCategories`, `queryMessages`, `conversationFiles`,
> `queryCategories`, `categoryServices`, `serviceTranslations`,
> `serviceTranslationsEdge`, `folders`, `userFolders`,
> `folderConversations`, `analytics`, `weatherRequests`, `labels`,
> `crawl_job`, `crawl_log`, `crawl_metrics`.

## User-facing collections

### `users`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | ArangoDB-generated; UUID is a convention but any string works |
| `iss_sub` | string | Keycloak `<iss>` + `<sub>` composite (indexed, unique) |
| `iss` | string | Keycloak issuer URL |
| `sub` | string | Keycloak subject |
| `email` | string | indexed (non-unique) |
| `name` | string | Display name (combined from Keycloak `name` or `preferred_username`) |
| `emailVerified` | bool | Mirrors Keycloak `email_verified` claim |
| `roles` | array<string> | Realm roles from Keycloak JWT (`decodedToken.realm_access.roles`); e.g. `["Admin"]` / `["dataprep-service"]` / `[]` |
| `active` | bool | False-when-deleted soft-delete marker |
| `deleted` | bool | Soft-delete flag |
| `createdAt` | ISO-8601 | |
| `updatedAt` | ISO-8601 | |

### `conversations`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `title` | string | |
| `lastMessage` | string | Preview of the latest message content |
| `created` | ISO-8601 | |
| `updated` | ISO-8601 | |
| `messageCount` | int | |
| `isStarred` | bool | |
| `isArchived` | bool | |
| `category` | string | Optional category label |
| `tags` | array<string> | |

The link between a conversation and its owning user lives in the
`userConversations` edge collection (`_from: users/<id>`, `_to: conversations/<id>`),
not as a `userId` field on the conversation document.

### `messages`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `conversationId` | string | FK → conversations |
| `content` | string | message body |
| `timestamp` | ISO-8601 | |
| `sender` | string | `user` / `assistant` / `system` |
| `sequence` | int | per-conversation ordering |
| `readStatus` | bool | |
| `metadata` | object | free-form; `metadata.source_documents` holds cited chunks on assistant messages |

### `queries`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `userId` | string | FK → users |
| `sessionId` | string | FK → sessions |
| `timestamp` | ISO-8601 | |
| `isAnswered` | bool | flipped to `true` when streaming completes |
| `categoryId` | string | nullable FK → serviceCategories |
| `serviceId` | array<string> | nullable FKs → services |
| `responseTime` | int | milliseconds |
| `contextOption` | string | backend mode (e.g. `conversation-with-context-labels`) |
| `messages` | array | conversation history at query time |
| `context` | object | request-time context (e.g. translated conversation) |
| `text` | string | user query text |
| `response` | string | assistant output (set on `finalizeStreamQuery`) |
| `metadata.source_documents` | array | cited chunks (set on finalize) |
| `metadata.confidence_score` | float | 0.0–1.0 (final, calibrated) |
| `metadata.retrieval_confidence_score` | float | 0.0–1.0 (rank-weighted retrieval) |
| `metadata.is_grounded` | bool | |
| `metadata.self_confidence` | float | LLM self-reported confidence (only when `LLM_SELF_CONFIDENCE_ENABLED=true`) |

User feedback (`{vote, comment, at}`) is **not** stored on the queries
document — it goes into the `analytics` collection (see
[Analytics collections](#analytics-collections)).

### `serviceCategories`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `catCode` | string | optional slug, e.g. `cat1` |
| `order` | int | display order |
| `nameEN` | string | **Source of truth** — what the RAG pipeline reads |

Description text is **not** stored on the category doc; it lives in the
`serviceCategoryTranslations` collection (one row per language).

### `services`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `nameEN` | string | Source of truth |
| `categoryId` | string | FK → serviceCategories (snapshot at creation; ordering lives on the edge) |

Ordering of services **within** a category lives on the
`categoryServices` edge collection (`order` field on the edge document),
not on the service document itself.

### `serviceCategoryTranslations`

Translation rows. Keys follow `${sourceKey}_${languageCode}`.

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `serviceCategoryId` | string | FK → serviceCategories (matches the `idx_serviceCategory_language` index fields) |
| `languageCode` | string | e.g. `es`, `fr` |
| `name` | string | translated |
| `description` | string | translated |

Edge collection `serviceCategoryTranslationsEdge` joins the two.

## Knowledge-base collections

### `files`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `file_id` | string | UUID (denormalized copy of `_key`) |
| `file_name` | string | |
| `file_size` | int | bytes |
| `file_type` | string | MIME type |
| `storage_path` | string | server-local (see document-repository component) |
| `file_hash` | string | SHA-256 of the bytes |
| `labels` | array<string> | taxonomy labels assigned during ingestion |
| `author` | string | display name (default `''`) |
| `uploaded_date` | ISO-8601 | |
| `create_date` | ISO-8601 | filesystem birthtime |
| `crawl_date` | ISO-8601 | populated when ingested via the crawler; `''` otherwise |
| `source_url` | string | URL when ingested via the crawler; `''` otherwise |
| `language` | string | e.g. `en`, `fr`, or `unknown` |
| `chunk_count` | int | updated by dataprep |
| `dataprep.status` | string | `Pending` / `Processing` / `Completed` / `Failed` |
| `dataprep.ingest_date` | ISO-8601 | set on successful ingestion |
| `dataprep.retract_date` | ISO-8601 | set when the file is retracted |

Schema documented here matches the document-repository component
(`metadataService.js`); see the component for the canonical source.

### `${GRAPH_NAME}_SOURCE`

One collection per named graph (default `ARANGO_GRAPH_NAME`: `GRAPH`,
yielding chunk collection name `GRAPH_SOURCE`). Holds the chunk-level
nodes.

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID |
| `text` | string | chunk content |
| `file_id` | string | FK → files |
| `chunkIndex` | int | within file |
| `labels` | array of string | taxonomy labels |
| `embedding` | array of float | vector |
| `metadata` | object | source, page, language, … |

### `${GRAPH_NAME}_LINKS_TO`

Edge collection — `chunk A` → `chunk B` if the retriever found a relevance
edge during ingestion (used by the hybrid retriever's graph-traversal
step).

### `${GRAPH_NAME}_HAS_SOURCE`

Edge collection — `chunk A` → `file B` (chunk belongs to file).

### `${GRAPH_NAME}_FILE_LABELS` *(planned — not implemented)*

This collection is referenced by the labeling-strategy design doc
([RAG pipeline → Data labelling strategy](/docs/rag-pipeline/data-labeling/))
but is **not yet implemented** — `grep -r FILE_LABELS` across
`genie-ai-overlay/` returns zero hits. Per-file aggregated labels are
currently held in-memory by the dataprep pipeline; the dedicated
collection is on the roadmap. Do not assume its existence in code.

## Analytics collections

### `events`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID (auto-generated) |
| `userId` | string | nullable (anonymous events allowed) |
| `eventType` | string | `page_view` / `chat_started` / `feedback` / … |
| `timestamp` | ISO-8601 | |
| `data` | object | event payload |

### `ingestion_log`

| Field | Type | Notes |
|---|---|---|
| `_key` | string | UUID (auto-generated) |
| `file_id` | string | FK → files |
| `timestamp` | ISO-8601 | set by `fileService.js` to the entry write time |
| `level` | string | `INFO` / `WARN` / `ERROR` (set by the dataprep POST body) |
| `stage` | string | ingestion phase, e.g. `chunking`, `labeling`, `embedding`, `indexing` (set by the dataprep POST body) |
| `message` | string | free-form progress |

Used by the admin dashboard's **Ingestion log** view. Query pattern:
`FOR d IN ingestion_log FILTER d.file_id == "<id>" SORT d.timestamp ASC RETURN d.message`.

## Indexes

The bootstrap script (`002-create-indexes.js`) creates these named indexes
on the listed collections:

- `users` — `idx_users_iss_sub_unique` (persistent, `iss_sub`, unique) and `idx_users_email` (persistent, `email`, non-unique)
- `sessions` — `idx-active-lastActiveTime` (`active`, `lastActiveTime`)
- `conversationFiles` — `idx_conversationFiles_conversationId` (`conversationId`)
- `serviceCategoryTranslations` — `idx_serviceCategory_language` (`serviceCategoryId`, `languageCode`, unique), `idx_serviceCategoryId`, `idx_languageCode_sct`, `idx_createdAt_sct`
- `serviceTranslations` — `idx_service_language` (`serviceId`, `languageCode`, unique), `idx_serviceId_st`, `idx_languageCode_st`, `idx_createdAt_st`
- `services` — `idx_categoryId_order` (`categoryId`, `order`), `idx_createdAt_services`
- `ingestion_log` — `idx_ingestion_log_file_id` (`file_id`), `idx_ingestion_log_timestamp` (`timestamp`)
- `crawl_job` — `idx_crawl_job_file_id` (`file_id`, unique), `idx_crawl_job_status` (`status`)
- `crawl_log` — `idx_crawl_log_file_id` (`file_id`), `idx_crawl_log_timestamp` (`timestamp`)
- `crawl_metrics` — `idx_crawl_metrics_file_id` (`file_id`, unique)

Vector indexes on `${GRAPH}_SOURCE (embedding)` are created at runtime by
the retriever/dataprep Python code, not by the migration script.

## Related

- [Reference → Service registry enum](/docs/reference/service-registry/)
- [Knowledge base → Document lifecycle](/docs/knowledge-base/document-lifecycle/)
- [Operate → Ingestion log](/docs/operate/ingestion-log/) — AQL recipes