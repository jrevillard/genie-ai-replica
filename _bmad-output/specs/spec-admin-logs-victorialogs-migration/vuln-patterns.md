# Vulnerability Patterns

The 14 patterns from `components/gov-chat-backend/services/security-scan-service.js:111-226` (plus `suspiciousPatterns` at `:227`). Preserved unchanged in P3; the migration only replaces the file-stream source with VL bulk queries. Each pattern's `needles[]` becomes a `_msg:"needle"` clause OR-joined in the LogSQL query.

| # | `type` | Severity | `needles[]` (regex / literal) | Mapping |
|---|---|---|---|---|
| 1 | `token_issue` | medium | JWT/refresh/cookie anomalies | `_msg:/(token\|jwt\|refresh).*?(invalid\|expired\|missing\|tampered)/i` |
| 2 | `attack_attempt` | critical | XSS / SQLi / path traversal / command injection probes | `_msg:/(<script\|union\s+select\|'\s*or\s*'1'='1\|\.\.\/\|\.\.\\\\\|;\s*(rm\|wget\|curl)\|;\s*nc\s)/i` |
| 3 | `command_injection` | critical | Shell metacharacters in unexpected inputs | `_msg:/[;&|`$]\s*(rm\|wget\|curl\|nc\|bash\|sh)\b/i` |
| 4 | `sensitive_file_access` | high | `/etc/passwd`, `/etc/shadow`, `id_rsa`, `.env` | `_msg:/(\/etc\/passwd\|\/etc\/shadow\|id_rsa\|\.env\b)/i` |
| 5 | `ip_blocked` | medium | Blocklisted source IPs | `_msg:/ip\s+blocked\|blocked\s+ip/i` |
| 6 | `auth_failure_401` | medium | 401 responses on auth endpoints | `_msg:/(401\|unauthor(ized\|ised))/i` |
| 7 | `db_error` | high | ArangoDB / Redis / Postgres connection or query errors | `_msg:/(arangodb\|arango.*error\|connection.*refused\|redis.*error\|postgres.*error)/i` |
| 8 | `non_critical_file_access` | low | Probes for `.git`, `/.well-known/`, debug routes | `_msg:/(\.git\b\|robots\.txt\|sitemap\.xml\|\.env\b)/i` |
| 9 | `unauthorized_access` | high | 403 responses on protected endpoints | `_msg:/(403\|forbidden)/i` |
| 10 | `brute_force` | high | Repeated failed logins from same IP within window | `_msg:/(brute\s*force\|too\s+many\s+(attempts\|failures))/i` |
| 11 | `failed_login` | medium | Single failed login event | `_msg:/(login\s+failed\|authentication\s+failed\|invalid\s+(credentials\|password))/i` |
| 12 | `not_found_404` | low | 404 bursts from same path / IP | `_msg:/(404\|not\s+found)/i` |
| 13 | `registration_failure` | low | Account-creation errors | `_msg:/(registration\s+(failed\|error)\|signup\s+(failed\|error))/i` |
| 14 | `log_limit_exceeded` | low | Service hit log-rate cap | `_msg:/log\s+(limit\|rate).*?(exceeded\|reached)/i` |
| — | `suspiciousPatterns` | varies | Aggregated hits beyond thresholds; see `:227` | Combined needles from above |

## LogSQL build (P3)

```js
const needles = patterns.flatMap((p) => p.needles.map((n) => `_msg:${JSON.stringify(n)}`));
const q = `service:* AND (${needles.join(' OR ')})`;
const rows = await vlClient.query({ q, start, end, limit: 100000 });
```

**Dedupe hits by record key** `${_time}|${_stream.service}|${_msg}` before bucketing into vulnerabilities — a single line can match multiple patterns (e.g. `401 forbidden` → patterns 6 + 9) and double-count inflates critical/medium buckets.

**Truncation guard**: if `rows.length === limit`, set `degraded: true` in the response. Do not loop with cursors in P3; the existing scan window (10 d) is bounded and the limit guards against silent under-count.

For hits-only pre-flight (cheaper; counts per service):

```js
const counts = await vlClient.hits({ q: `service:* AND (${needles.join(' OR ')})`, field: 'service', start, end });
```

## Output shape (preserved)

```json
{
  "vulnerabilities": {
    "critical": [{ "type", "severity", "service", "matchedTerm", "instanceCount", "firstSeen", "lastSeen" }],
    "medium":   [...],
    "low":      [...]
  },
  "failedLogins": [...],
  "suspiciousActivities": [...],
  "recommendations": [...]
}
```

`getLastScanDetails()` (cache read at `last-scan-results.json`) is unchanged; the cache write path stays in the service.