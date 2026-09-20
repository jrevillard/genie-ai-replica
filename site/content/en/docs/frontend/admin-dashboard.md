---
title: "Admin Dashboard"
description: "The 8-tab admin surface — overview, knowledge hierarchy, documents, database, logs, query inspector, security, users — and the unsaved-changes guard."
weight: 7
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

> **For frontend developers, operators, and admin users.** The full `AdminDashboard.vue` surface: what each tab does, what backend services it talks to, what permissions gate it, and the failure modes operators hit most.

## Prerequisites

- The Keycloak role **`admin`** (or `functional-admin` for a subset) is assigned to the user. The dashboard reads `currentUser.roles` and hides tabs the user can't access.
- The backend BFF exposes the admin REST endpoints. See [Backend API Contracts](/docs/backend/api-contracts-backend/).
- For Database and Logs operations: backend `admin` service must be healthy. Check `/api/admin/system-health` first if operations silently fail.

## Sidebar layout

`AdminDashboard.vue` renders a fixed left sidebar with four sections and eight tabs. The active tab is local component state (`activeTab`), defaulting to `overview`.

| Section | Tab | Key |
|---------|-----|-----|
| **Dashboard** | Overview | `overview` |
| **Content Management** | Knowledge Hierarchy | `hierarchy` |
| | Document Management | `documents` |
| **System** | Database | `database` |
| | Logs | `logs` |
| | Query Inspector | `queryInspector` |
| **Settings** | User Management | `users` |
| | Security | `security` |

The section headers (`Dashboard` / `Content Management` / `System` / `Settings`) are static labels — they do not collapse, and they do not gate content. Tab gating is by role.

### Permissions

The dashboard renders all 8 tabs for any user who reaches `/admin`. There is **no role-based tab visibility logic** in `AdminDashboard.vue` — no `roles.includes('admin')`, no `roles.includes('functional-admin')`, and no `v-if` gates on the tab containers. Access control is at the **router level** only: the route requires authentication (`requiresAuth: true`), but does not check for any specific realm role. Any authenticated user who navigates to `/admin` sees every tab.

### Unsaved-changes guard

Switching tabs while the hierarchy form has unsaved edits triggers a confirmation:

```javascript
// AdminDashboard.vue ~line 2043
if (this.activeTab === 'hierarchy' && this.isFormDirty) {
  // showConfirmDialog with confirmText="Switch Anyway" / cancelText="Cancel" — 2-button dialog (no Save & continue / Discard options)
}
```

The other tabs do not gate navigation the same way — the document table does not have an edit form, and database/logs actions commit immediately.

## Tab: System Health (`overview`)

The landing tab. Quick health tiles and stats pulled from `/api/admin/system-health` and `/api/admin/analytics/overview`.

| Tile | Source | Refresh |
|------|--------|---------|
| Service status pills | `/api/admin/system-health` (ArangoDB, Dataprep, OTel, Embedding, Retriever, Reranker, Translation, LLM) | On tab open + manual refresh |
| CPU / Memory / Disk / Network | OTel collector metrics via VictoriaMetrics | 30 s polling |
| Monthly Active Users | Analytics query | On tab open |
| Active conversations | Analytics query | On tab open |
| Knowledge-base document count | Documents table count | On tab open |

Empty / loading / error states use `DsStateDisplay`. The tiles do not auto-poll — operators refresh manually with the toolbar refresh button.

## Tab: Knowledge Hierarchy (`hierarchy`)

Manage the **service category → service** taxonomy that the chat's service-tree filter consumes.

| Element | Behaviour |
|---------|-----------|
| Tree view | Categories with collapsible child services. Click-to-expand. |
| Add Category / Add Service | Inline modal form (`DsModal`) — name, optional parent (for services), description. |
| Edit | Same modal pre-filled. The `admin.hierarchy.title` i18n key is intentionally **not translated** — hierarchy names are always English (product decision for data consistency). |
| Delete | Confirmation via `ConfirmDialog`. Refuses to delete a category that still has services. |
| Unsaved-changes guard | Yes — switching tabs triggers the modal described above. |

### Data flow

```
chatHistoryStore.loadFolders() ←→ serviceTreeService.getAllCategories(locale)
                                   ↓
                  AdminDashboard.hierarchy ← mutation
                                   ↓
                  POST /api/service-categories/, PUT /api/service-categories/:categoryId,
                  DELETE /api/service-categories/:categoryId, POST /api/service-categories/:categoryId/services, ...
```

The chat's service tree (`SidebarComponent`) reads the same endpoint, so edits here are visible immediately on a chat-side refresh.

## Tab: Document Management (`documents`)

The knowledge-base file surface. Sortable table + upload dialogs + ingestion detail dialog.

### Table columns

| Column | Sortable | Notes |
|--------|----------|-------|
| ☐ select-all + per-row checkbox | No | Multi-select for bulk actions. |
| File name | Yes | Click opens `FileDetailsDialog`. |
| Status | Yes | `dataprep.status` mapped via `DsStatusTag` (success / error / warning / info / pending). |
| Upload date | Yes | ISO → locale-formatted. |
| File size | Yes | Bytes → human-readable. |

### Upload flows

| Dialog | Trigger | Use |
|--------|---------|-----|
| `UploadFilesDialog` | Toolbar **Upload** button | Drag-and-drop one or more files. Allowed extensions enforced server-side. Multi-file progress bars. |
| `AddFromLinkDialog` | Toolbar **Add from link** button | Single page (`mode=single`, depth ignored) vs full-site async crawl (`mode=full`, depth=1..5). Triggers a backend crawl job. |
| `FileDetailsDialog` | Row click | Details tab + ingestion dashboard tab (live-dot indicator while a crawl is running). |

### Ingestion lifecycle

| `dataprep.status` value | Triggered by | UI |
|------------------------|--------------|-----|
| `pending` | Initial upload | `DsStatusTag pending` + spinner in detail dialog |
| `processing` | Backend started processing | Same — spinner in detail dialog |
| `completed` | Dataprep finished | Green status tag |
| `failed` | Error during chunking / embedding / labelling | Red status tag + error message in detail dialog |
| `crawling` (during a link crawl) | Backend crawl running | Live-dot pulsing indicator |

The live-dot uses `DsSpinner size="sm"` with a custom CSS animation. The dot disappears when `dataprep.status` transitions out of `pending` / `processing` / `crawling`.

## Tab: Database (`database`)

Action cards for operational tasks. Each card triggers a backend operation and renders the result in `OperationResultsModal.vue`.

| Card | Backend call | Output |
|------|--------------|--------|
| Backup | `POST /api/database/backup` | Modal shows: backup file path, size, completion timestamp, download link. |
| Optimize | `POST /api/database/optimize` | Modal shows: per-collection index report, before/after row counts. |
| Rollover Logs | `POST /api/admin/logs/rollover` | Modal shows: rotated file count, archived file paths. |
| Search Logs | Opens `LogSearchDialog` | Sub-flow — see Logs tab. |
| Run Diagnostics | `POST /api/admin/diagnostics` | Modal shows: diagnostic report (CPU, memory, connection pools, slow queries). |
| Run Security Scan | `POST /api/admin/security-scan` | Modal shows: scan report (findings by severity, file paths, recommendations). |

### Operation results

`OperationResultsModal.vue` renders:

```
┌─ Operation Results ─────────────────────────────────┐
│ ✓ Backup Database                                   │
│   File: /var/backups/arango-2026-09-18.dump         │
│   Size: 142 MB                                      │
│   [Download]                                        │
├──────────────────────────────────────────────────────┤
│ ✓ Optimize Database                                 │
│   arango source: 1,247 indexes rebuilt              │
│   arango links:   18 indexes rebuilt                │
└──────────────────────────────────────────────────────┘
```

Destructive operations (Rollover, Security Scan) require an additional `ConfirmDialog` before the request fires.

## Tab: Logs (`logs`)

Live tail + filter of application logs. Backend proxies VictoriaLogs (`SELECT * FROM logs WHERE ...` over HTTP). See [Observability → VictoriaLogs](/docs/operate/admin-logs/) for the storage layer.

| Filter | Source |
|--------|--------|
| Time range | Date picker (`DsFormGroup` + 2× `DsInput type=datetime-local`) |
| Service | Multi-select (`DsCombobox`) — Backend, Dataprep, ChatQnA, Retriever, Reranker, Translation, Keycloak |
| Log level | Multi-select — INFO, WARNING, ERROR, DEBUG |
| Search | Full-text substring (`_msg` contains) |
| Limit | 100, 500, 1000 |

Results render in a virtual-scrolling table (`<table class="log-table">`). Click a row to expand the raw JSON. The `LogSearchDialog` from the Database tab is the same component, used standalone.

The Logs tab does not auto-poll — there is no `setInterval` in `AdminDashboard.vue` (`mounted` only calls `loadInitialData()` / `getCurrentUser()`; `beforeUnmount` only removes the `themeChange` listener). The user manually refreshes by re-running the search.

## Tab: Query Inspector (`queryInspector`)

Browse and inspect individual queries that ran through the RAG pipeline. Three components, two columns:

```
┌────────────────────────────┬─────────────────────────┐
│ QueryInspectorList         │ QueryInspectorDetail    │
│ - timestamp                │ - request               │
│ - user                     │ - retrieved chunks      │
│ - query text               │ - response              │
│ - response time            │ - metadata              │
│ - confidence               │ - confidence            │
└────────────────────────────┴─────────────────────────┘
```

Click a row in the list to load detail. Filters: user, date range, confidence range, label, query substring. See [Debugging with Tracing & Logs](/docs/observe/tracing/) for the related backend trace view.

## Tab: Security (`security`)

The Security tab is a **Security Monitoring** view (title: "Security Monitoring" in `AdminDashboard.vue:822`), not a configuration surface. It displays:

- **Last security scan timestamp** — fetched from `securityMetrics.lastScan`
- **Vulnerability counts by severity** — critical / medium / low (`securityMetrics.vulnerabilities`)
- **Findings list** — when scan data is loaded (`securityDetails`)

Available actions:

- **Run Security Scan** — triggers `POST /api/admin/security-scan` via `runSecurityScan()`

Backend endpoints (all read-only / trigger-only — no PUT):

- `GET /api/admin/security-metrics` — last-scan + vulnerability counts
- `GET /api/admin/security/last-scan` — last-scan details
- `POST /api/admin/security-scan` — trigger a new scan

There is no CSP/CORS editor, audit log retention input, failed-login threshold lockout input, or sessions list. The audit log is reached via the separate Logs tab.

## Tab: Users (`users`)

List and manage Keycloak users visible to the current realm.

| Column | Notes |
|--------|-------|
| Username | Link to the Keycloak admin console (opens in a new tab with the realm URL prefilled). |
| Email | Read-only here — editable in the Keycloak admin console. |
| Roles | Comma-separated realm roles. Inline edit (multi-select). |
| Status | Enabled / Disabled toggle. Disabled users are signed out on next refresh. |
| Created | ISO → locale-formatted. |

Pagination is 20 per page (`userSearchLimit = 20`, `AdminDashboard.vue:1711`). The list is read-only — user editing happens in Keycloak Admin Console. There are no bulk enable/disable/delete actions in `AdminDashboard.vue`.

> Never bulk-delete users without a backup of the Keycloak database. The admin dashboard does not soft-delete — Keycloak's delete is final.

## Failure modes & troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Dashboard renders an empty page | The user has no admin role | Confirm `currentUser.roles` includes `admin` or `functional-admin`. |
| Tabs render but data is empty | Backend `/api/admin/*` returns 200 with `[]` | Check the underlying service (ArangoDB collections, OTel collector). Most often a misconfigured connection string after a redeploy. |
| "Backup Database" returns "Permission denied" | The backend BFF's ArangoDB user lacks dump privileges | Use a deployment-level admin user; the default app user is read-only on most collections. |
| Knowledge Hierarchy form will not save | One of the required fields is empty, or the parent category was deleted | The modal shows field-level errors; resolve and re-submit. |
| Document upload succeeds but ingestion never starts | The dataprep service is down or its queue is full | Check `docker service ls | grep dataprep` and the ingestion log in ArangoDB. |
| Log search returns nothing | Time range is in the future, or the service filter is wrong | The query is sent verbatim to VictoriaLogs; reproduce via curl against `/select/logsql/query`. |
| "Run Security Scan" is greyed out | The user is `functional-admin` only | The full scan requires `admin`. Functional admins can still trigger Backup / Optimize / Diagnostics. |
| Query Inspector list is empty | OTel → VictoriaTraces ingestion is disabled | Enable observability: `ENABLE_OBSERVABILITY=1` in `.env` + restart. |
| Unsaved-changes modal blocks tab switch forever | A previous "Save" left the form in a dirty state because the mutation failed silently | Hard-refresh; the dirty flag is reset on tab unmount. |
| Users tab shows realm-level data even though user is `functional-admin` | Functional admin sees only their org's users | Confirm the org-mapping realm attribute is set on the functional admin. |

## Programmatic access

The dashboard is a route-level view (`/admin` — see `src/router/`). The route guard checks for the `admin` role; without it, the router pushes to `/dashboard`.

```javascript
// Programmatic navigation (from any component)
this.$router.push('/admin');
```

Most admin operations dispatch through dedicated services (`adminService`, `documentsService`, `userService`). Re-use them rather than calling `httpService` directly — they enforce the admin-role headers and add caching where appropriate.

## Related

- [UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/) — the dialog and DS primitives used across the tabs.
- [State Management](/docs/frontend/state-management-frontend/) — non-namespaced `auth` module that owns `currentUser.roles`.
- [Backend API Contracts](/docs/backend/api-contracts-backend/) — admin REST surface.
- [Observability](/docs/observe/) — Logs tab and Query Inspector both read from VictoriaLogs / VictoriaTraces.
- [Knowledge Base: Ingestion](/docs/knowledge-base/ingestion/) — Documents tab and the dataprep status mapping.
- [Knowledge Base: Labelling Taxonomy](/docs/knowledge-base/labelling-taxonomy/) — Knowledge Hierarchy tab shapes the chat context filter.
