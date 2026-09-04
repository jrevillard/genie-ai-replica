# Vulnerability Patterns

The 14 patterns from `components/gov-chat-backend/services/security-scan-service.js:111-226` (plus `suspiciousPatterns` at `:227`). Severities and regex fields mirror the live source-of-truth exactly. The P3 migration replaces the file-stream source with VL bulk queries; patterns are preserved unchanged.

Each pattern's `regex:` is a single RegExp. LogSQL `_msg:` is phrase/word match (NOT regex), so the P3 build converts each `regex:` literal source-string into a `_msg:"<substring>"` clause OR-joined. Multi-pattern regexes (e.g. `attack_attempt` `/SQL injection|XSS|CSRF/i`) widen into multiple `_msg:` clauses — match coverage widens, severity buckets may shift. ADR-19 de-dupe via sha1(record key) absorbs cross-pattern duplicates.

| # | `type` | Severity | `regex:` (live source) | Service |
|---|---|---|---|---|
| 1 | `token_issue` | critical | `/invalid token/i` | auth |
| 2 | `attack_attempt` | critical | `/SQL injection\|XSS\|CSRF/i` | http |
| 3 | `command_injection` | critical | `/(sleep\s+\d+\|__import__\(\s*['"]subprocess['"]\)\|execSync\(\s*['"]sleep\s+\d+['"]\)\|%x\(\s*sleep\s+\d+\s*\))/i` | auth |
| 4 | `sensitive_file_access` | medium | `/Blocked access to sensitive path:\s*((?:\/api\/)?(?:\.env\|\.git\/config\|\.gitignore\|\.npmrc\|node_modules\/\.package-lock\.json\|\.well-known\/security\.txt))/i` | http |
| 5 | `ip_blocked` | medium | `/IP Blocked/i` | system |
| 6 | `auth_failure_401` | medium | `/Authentication Failure - 401/i` | system |
| 7 | `db_error` | medium | `/collection\.save failed.*expecting both \`_from\` and \`_to\` attributes/i` | database |
| 8 | `non_critical_file_access` | low | `/Blocked access to sensitive path:\s*(\/\.well-known\/appspecific\/com\.chrome\.devtools\.json)/i` | http |
| 9 | `unauthorized_access` | medium | `/not authorized/i` | auth |
| 10 | `brute_force` | medium | `/brute force/i` | auth |
| 11 | `failed_login` | low | `/Invalid credentials\|failed login/i` | auth |
| 12 | `not_found_404` | low | `/404 Not Found: (GET\|POST\|PUT\|DELETE)\s+\/api\/api\//i` | http |
| 13 | `registration_failure` | low | `/(Email\|Username) already exists\|Registration failed/i` | system |
| 14 | `log_limit_exceeded` | low | `/Too many log lines.*limiting to/i` | system |
| — | `suspiciousPatterns` | varies | `[/SQL injection\|XSS\|CSRF\|brute force\|command injection\|threat detection\|ip blocked/i]` | n/a |

## LogSQL build (P3)

```js
// Phase 1: per-pattern, extract the literal source string from RegExp
const clauses = patterns.flatMap((p) => {
  const src = p.regex.source;           // e.g. "invalid token" or "(?:sleep\\s+\\d+|...)"
  return [`_msg:${JSON.stringify(src)}`]; // one clause per pattern (NOT per pattern-branch)
});
const q = `service:* AND (${clauses.join(' OR ')})`;
const rows = await vlClient.query({ q, start, end, limit: 100000 });
```

**Dedupe hits** via sha1(record key) per AD-19:
```js
const key = (r) => require('crypto')
  .createHash('sha1')
  .update(`${r._time}|${r._stream.service}|${r._msg}`)
  .digest('hex')
  .slice(0, 16);
const seen = new Map(); // key → first-matched pattern
for (const row of rows) seen.set(key(row), row);
```

A single log line can match multiple patterns (e.g. `401 forbidden` → patterns 6 + 9). The sha1 bucket key ensures each record contributes to at most one vulnerability bucket. Without dedup, double-counting inflates critical/medium buckets and skews security posture.

**Truncation guard**: if `vlClient.query` returns `length === limit`, set `degraded: true` in the response. **Do not loop with cursors in P3** (per AD-19); the existing scan window (10 d) is bounded and the limit guards against silent under-count.

For hits-only pre-flight (cheaper; counts per service):

```js
const counts = await vlClient.hits({ q: `service:* AND (${clauses.join(' OR ')})`, field: 'service', start, end });
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

## Retention env var

The retention comparison parses `VICTORIALOGS_RETENTION` (singular, `30d` format — NOT `VICTORIALOGS_RETENTION_DAYS`):

```js
const match = /^(\d+)d$/.exec(process.env.VICTORIALOGS_RETENTION || '30d');
const retentionDays = match ? Number(match[1]) : 30;
if (Math.floor((now - start) / 86400e3) > retentionDays) {
  response.degraded = true;
  start = new Date(now - retentionDays * 86400e3);
}
```