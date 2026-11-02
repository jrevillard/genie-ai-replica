# Log Management

**Location:** Admin Dashboard → Logs tab  
**Access:** Admin only — realm role `admin` (see [users.md §5](users.md#5-roles-and-access))  
**Last Updated:** June 17, 2026

---

## Overview

The Logs tab provides admins with visibility into backend application logs without requiring SSH access. It offers a daily error/warning summary, full-text search with filtering, log level configuration, retention settings, and manual log rotation.

---

## What it Shows

### Summary View (default)

When the Logs tab loads, it displays today's log entries grouped into two tables:

- **Error Logs** — grouped by type and service, with occurrence counts
- **Warning Logs** — same format

This gives a quick "what went wrong today" snapshot without needing to search.

### Search Dialog

The "Search Logs" button opens a full search interface with:

| Filter | Options |
|--------|---------|
| Search term | Free text (matched against log messages) |
| Log level | ERROR, WARN, INFO, DEBUG, or All |
| Service | Auth, Admin, Database, API Gateway, etc. |
| Date range | Today, Yesterday, Last 7 days, Last 30 days, or Custom range |

Results are displayed in a table with date, time, level, service, and message columns. Matched search terms are highlighted in yellow.

### Search Results Preview

After a search, the Logs tab shows a preview of the last 5 results inline. Click "View All Results" to reopen the full dialog.

---

## Configuration Controls

A config bar below the tab header provides runtime log settings:

### Log Level

Dropdown to change the active backend log level (ERROR → WARN → INFO → DEBUG). This takes effect immediately without restarting the backend container. Useful for temporarily enabling DEBUG to investigate an issue, then switching back to INFO.

### Retention

Dropdown to set how many days of log files to keep before automatic rotation deletes them (7, 14, 30, or 60 days). Applies to both error and combined log files.

### Log Rollover

The "Rollover Logs" button forces immediate log file rotation regardless of current file sizes. The current `combined.log` and `error.log` are archived with today's date and fresh files are started.

---

## How Logs are Stored

Logs are file-based, written by Winston in the backend container:

```
/app/logs/
├── combined.log              # Current active combined log
├── error.log                 # Current active error-only log
├── combined-2026-06-16.log   # Yesterday's combined log
├── error-2026-06-16.log      # Yesterday's error log
├── combined-2026-06-15.log.gz  # Older compressed archive
├── error-2026-06-15.log.gz
└── ...
```

The `./logs` directory on the host is volume-mounted to `/app/logs` in both the backend and document-repository containers via `docker-compose-t4.yaml`.

### Log Format

```
2026-06-17 14:32:05 [INFO]: [ADMIN-ROUTES] Security metrics retrieved successfully for user: admin@example.com
2026-06-17 14:32:06 [ERROR]: [AUTH] Token verification failed: jwt expired
```

Format: `YYYY-MM-DD HH:MM:SS [LEVEL]: [SERVICE-TAG] message`

---

## Service Detection

Log messages are parsed to extract a service name from bracketed tags. The system maps common tags to clean names:

| Tag in Log | Displayed Service |
|------------|-------------------|
| `[ADMIN-ROUTES]`, `[ADMIN DEBUG]` | Admin |
| `[AUTH]`, `[AUTH MIDDLEWARE]` | Auth |
| `[KEYCLOAK AUTH]` | Auth (Keycloak) |
| `[SECURITY-ROUTES]`, `[SECURITY]` | Security |
| `[USER-ROUTES]` | User |
| `[ANALYTICS]` | Analytics |
| `[WEATHER]` | Weather |
| `[TRANSLATION]` | Translation |
| `[DATABASE]`, `[DB]` | Database |
| `[SOCKET]` | WebSocket |
| `[HEALTH]` | Health |
| `[INGESTION]` | Ingestion |
| No recognized tag | System |

Additionally, keyword detection catches untagged messages mentioning ArangoDB, Redis, vLLM, Kong, Keycloak, etc.

---

## API Endpoints

All endpoints require Admin authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/logs` | Basic log retrieval with level/service filters |
| GET | `/api/admin/logs/summary` | Error/warning counts grouped by type and service for a date |
| GET | `/api/admin/logs/search` | Full-text search with level, service, date range, pagination |
| POST | `/api/admin/logs/rollover` | Force immediate log rotation |
| POST | `/api/logger/configure` | Change log level, max file sizes, retention |

### Search Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `term` | string | Text to search for in log messages |
| `level` | string | Filter by level: ERROR, WARN, INFO, DEBUG |
| `service` | string | Filter by service name |
| `dateRange` | string | Preset: today, yesterday, week, month, custom |
| `startDate` | string | Custom start date (YYYY-MM-DD) |
| `endDate` | string | Custom end date (YYYY-MM-DD) |
| `limit` | number | Max results to return (default: 100) |
| `offset` | number | Pagination offset (default: 0) |

### Search Response

```json
{
  "logs": [
    { "date": "2026-06-17", "time": "14:32:05", "level": "ERROR", "service": "Auth", "message": "Token verification failed: jwt expired" }
  ],
  "total": 245,
  "limit": 100,
  "offset": 0,
  "hasMore": true
}
```

### Logger Configuration Body

```json
{
  "level": "debug",
  "errorMaxFiles": "14d",
  "combinedMaxFiles": "14d",
  "errorMaxSize": "10m",
  "combinedMaxSize": "20m",
  "zippedArchive": true
}
```

All fields are optional — only provided fields are changed.

---

## Limitations

| Limitation | Description |
|------------|-------------|
| Backend logs only | Only sees `gov-chat-backend` logs. Other containers (document-repository, chatqna, dataprep, vLLM, Kong, nginx) require `docker logs` via SSH. |
| 20MB file cap | Files larger than 20MB are truncated to prevent memory issues. |
| 200K line limit | Individual files exceeding 200K lines are capped. |
| No real-time streaming | Must refresh or re-search to see new entries. |
| No multi-container aggregation | Each container writes its own logs; no centralized log collector (Loki/ELK). |

---

## Architecture

```
Admin Dashboard (Logs Tab)
    ├── loadLogsSummary()  → GET /admin/logs/summary
    ├── searchLogs()       → GET /admin/logs/search (via LogSearchDialog)
    ├── rolloverLogs()     → POST /admin/logs/rollover
    └── configureLogger()  → POST /api/logger/configure

Backend (LogsService)
    ├── getLogsSummary()     → reads today's logs, groups errors/warnings
    ├── searchLogs()         → reads files in date range, filters, paginates
    ├── getLogFilesInRange() → discovers .log and .gz files by date
    └── parseLogs()          → line parsing, level detection, service extraction

Storage: /app/logs/ (Docker volume: ./logs:/app/logs)
    ├── combined.log (current)
    ├── error.log (current)
    └── combined-YYYY-MM-DD.log(.gz) (archived)
```

---

## Future Improvements

- **Multi-container log aggregation** — Read logs from document-repository, chatqna, dataprep, vLLM via shared volume or Docker API
- **Live tail mode** — Auto-refreshing view that polls for new entries every 5 seconds
- **Error trend chart** — Sparkline or bar chart showing error/warning volume over the last 7 days
- **CSV/JSON export** — Download filtered search results for external analysis or compliance
- **Alert rules** — Notify admin if error count exceeds threshold within a time window
- **Structured JSON parsing** — Expand JSON-formatted log entries into readable key-value displays
