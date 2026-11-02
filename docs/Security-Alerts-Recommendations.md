# Security Alerts & Recommendations

**Location:** Admin Dashboard → Security tab  
**Access:** Admin only — realm role `admin` (see [users.md §5](users.md#5-roles-and-access))  
**Last Updated:** June 17, 2026

---

## Overview

The Security panel in the System Administration dashboard provides automated log-based vulnerability scanning, HTTP security header checks, and actionable recommendations. It scans the last 10 days of application logs plus performs live HTTP checks against the backend service.

---

## How the Scan Works

When an admin clicks "Security Scan", the backend performs two types of analysis:

### 1. Log-Based Pattern Matching

Reads all `combined-*.log` and `error-*.log` files (including `.gz` archives) from the last 10 days. Each line is matched against a set of vulnerability patterns classified by severity.

### 2. HTTP Security Checks (Live)

Runs in parallel after log processing:

| Check | What it does |
|-------|--------------|
| **Security Headers** | Checks for missing CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy |
| **Server Leakage** | Checks if `X-Powered-By` or versioned `Server` headers expose technology stack |
| **CORS Configuration** | Checks if `Access-Control-Allow-Origin: *` is set (overly permissive) |
| **Hidden Files** | Probes for accessible `.env`, `.git/config`, `.npmrc`, etc. |

These HTTP checks hit `http://localhost:3000/api/health` from inside the backend container, so they reflect the backend's own headers (not what nginx/Kong expose externally).

---

## Severity Classification

### Critical — Requires Immediate Attention

Only two patterns are classified as critical. These indicate active exploitation attempts:

| Type | Pattern | Description |
|------|---------|-------------|
| `attack_attempt` | SQL injection, XSS, CSRF keywords in logs | Web application attack detected |
| `command_injection` | `sleep N`, `__import__('subprocess')`, `execSync`, `%x()` | Code execution attempt in request payload |

### Medium — Investigate

These indicate confirmed hostile behavior or infrastructure issues that need review:

| Type | Pattern | Description |
|------|---------|-------------|
| `sensitive_file_access` | Blocked access to `.env`, `.git/config`, `.npmrc` | External probing for sensitive files |
| `ip_blocked` | "IP Blocked" in logs | IP already blocked by rate limiter |
| `brute_force` | "brute force" in logs | Explicit brute force detection triggered |
| `db_error` | ArangoDB `collection.save failed` with `_from`/`_to` | Database misconfiguration |

### Low — Informational / Noise

These are operational events that individually aren't security issues. They only warrant investigation at high volumes:

| Type | Pattern | Description |
|------|---------|-------------|
| `token_issue` | "invalid token" | Expired JWT — usually routine session expiry |
| `auth_failure_401` | "Authentication Failure - 401" | Expired session or unauthenticated API call |
| `unauthorized_access` | "not authorized...admin" / "Forbidden...Admin access required" | Non-admin hitting admin endpoints |
| `failed_login` | "Invalid credentials" / "failed login" | Mistyped password |
| `registration_failure` | "Email already exists" / "Registration failed" | User re-registering with existing email |
| `not_found_404` | `404 Not Found: GET /api/api/...` | Doubled `/api/api/` prefix — misconfigured client |
| `non_critical_file_access` | Blocked access to Chrome DevTools JSON | Browser extension artifact |
| `log_limit_exceeded` | "Too many log lines...limiting to" | Log processing hit internal limit |

---

## Threshold-Based Severity Promotion

Low-severity authentication issues are automatically promoted to **medium** if their occurrence count exceeds **50** within the 10-day scan window. This distinguishes normal operational noise (a few expired tokens) from potential attack patterns (mass credential stuffing).

Promotable types: `token_issue`, `auth_failure_401`, `unauthorized_access`, `failed_login`

When promoted, the description is appended with: `(auto-promoted: N occurrences exceeds threshold of 50)`

---

## Scan Results

### Cached Results

Scan results are persisted to `/app/data/security/last-scan-results.json`. When an admin opens the Security tab without running a new scan, the last saved results are displayed with an age indicator (e.g., "23 minutes ago", "3 hours ago").

### Scan Duration

The scan processes logs in parallel using Node.js worker threads (concurrency = CPU count). A 200-second timeout prevents runaway scans. Typical duration depends on log volume:

- Light deployment (few users): 5–15 seconds
- Active deployment (10+ days of logs): 30–120 seconds

The scan duration is displayed in the UI after completion.

---

## Recommendations Section

The Security Recommendations section is **dynamic** — it derives recommendations directly from the actual findings rather than showing hardcoded text.

### How it works:

1. **Critical findings** generate specific recommendation cards:
   - "Critical Security Issues Detected" — general summary
   - "Command Injection Attempts Detected" — if `command_injection` type found
   - "XSS/SQL Injection/CSRF Attempts Detected" — if `attack_attempt` type found

2. **Medium findings** are grouped by type and each gets its own card with:
   - The finding's actual description as the title
   - Occurrence count from the scan
   - The finding's specific `recommendation` field from the backend

This means if you have 3 types of medium findings (IP blocks, file access probes, DB errors), you see 3 separate cards with 3 different actionable recommendations — not a single generic message.

---

## Common False Positives (and why they're now low severity)

| What you see | Why it's not a security issue |
|--------------|-------------------------------|
| `token_issue` — 50 occurrences | Users' JWTs expire after inactivity. Every session timeout logs this. |
| `auth_failure_401` — 27 occurrences | Browser tabs recovering from sleep, frontend pre-flight checks with stale tokens. |
| `unauthorized_access` — 5 occurrences | Non-admin users clicking admin-only UI elements before the frontend disables them. |
| `failed_login` — 3 occurrences | Users mistyping passwords. |
| `registration_failure` — 2 occurrences | Users trying to register with an email they already have an account for. |

**When to worry:** If `auth_failure_401` or `failed_login` exceeds 50 occurrences (auto-promoted to medium), or if occurrences cluster from a single IP in a short time window — that suggests credential stuffing or brute force.

---

## API Endpoints

All endpoints require Admin authentication (`authMiddleware.authenticate` + `authMiddleware.isAdmin`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/security-metrics` | Summary counts (failed logins, suspicious activities, last scan time, vulnerability counts) |
| POST | `/api/admin/security-scan` | Triggers a full scan (may take 30–120s) |
| GET | `/api/admin/security/last-scan` | Returns full last scan results with scan age |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE_URL` | `http://localhost:3000/api` | URL used for HTTP header checks |

### Internal Constants (`security-scan-service.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `TIMEOUT_PERIOD` | 200,000 ms | Maximum scan duration before abort |
| `DAYS_TO_PROCESS` | 10 | Number of days of logs to scan |
| `PROMOTION_THRESHOLD` | 50 | Occurrences before low→medium promotion |

---

## Architecture

```
Admin Dashboard (Security Tab)
    ↓ POST /admin/security-scan
Backend (admin-routes.js → security-scan-service.js)
    ├── processLogsInParallel()     → reads /app/logs/*.log(.gz)
    ├── checkSecurityHeaders()      → GET http://localhost:3000/api/health
    ├── checkServerLeakage()        → checks X-Powered-By, Server headers
    ├── checkCorsConfiguration()    → OPTIONS with foreign Origin
    └── checkHiddenFiles()          → probes /.env, /.git/config, etc.
    ↓
Results saved to /app/data/security/last-scan-results.json
    ↓ GET /admin/security/last-scan
Frontend renders: vuln cards + dynamic recommendations + login table + suspicious table
```

---

## Future Improvements

- **External URL checks:** Run header/CORS/hidden file checks against the nginx/Kong external URL (not just localhost) to reflect what attackers actually see
- **Scheduled scans:** Daily cron-triggered scan so admins don't need to manually click
- **Alert notifications:** Email/webhook when critical findings appear
- **IP-based clustering:** Group low-severity auth events by source IP to detect targeted attacks
- **Scan progress indicator:** Stream progress via SSE for large log volumes
- **Export/download:** PDF or CSV export of scan results for compliance reporting
