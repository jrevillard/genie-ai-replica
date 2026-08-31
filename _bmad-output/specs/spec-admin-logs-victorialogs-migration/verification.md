# Verification

End-to-end checks per phase and at the final success signal. Use the base64 ssh pattern from `.claude/rules/DEBUGGING-TRACING.md` §5 for remote-stack checks to avoid quoting hell.

## Per-phase verification

### P0

```bash
docker compose --profile core up -d
curl -sS http://localhost:9428/health             # → {"status":"ok"}
curl -X POST http://localhost:4318/v1/logs \
  -H 'Content-Type: application/json' \
  -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"smoke"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"'"$(date +%s%N)"'","severityNumber":9,"severityText":"INFO","body":{"stringValue":"p0 smoke"}}]}]}]}'
curl -sS 'http://localhost:9428/select/logsql/query?q=service:smoke' | jq '.[] | ._msg'
# → ["p0 smoke"]
```

### P1a

```bash
# Backend up; trigger a real log line via admin endpoint or curl on the backend host
curl -sS http://localhost:3000/api/health
curl -sS 'http://localhost:9428/select/logsql/query?q=service:genie-backend&limit=5' | jq '.[] | {_msg, _stream, trace_id, span_id}'
# → records with non-zero trace_id, severityNumber mapped from winston level

# Kill VL
docker stop victorialogs
curl -sS http://localhost:3000/api/health   # → 200 (service not blocked)
docker logs backend --since 1m 2>&1 | grep -c "VictoriaLogs"   # → 0 (no stdout mirror noise)
docker start victorialogs
```

### P1b

```bash
node -e "
const { VictoriaLogsClient } = require('./components/shared/lib').melt;
const c = new VictoriaLogsClient();
c.query({ q: 'service:genie-backend', limit: 5 }).then(rows => console.log(rows.length));
"
# → non-zero rows after P1a has been running for a minute
```

### P1c

```bash
docker inspect backend --format '{{.HostConfig.LogConfig.Type}}'             # → json-file
docker inspect document-repository --format '{{.HostConfig.LogConfig.Type}}' # → json-file
docker inspect tei --format '{{.HostConfig.LogConfig.Type}}'                  # → fluentd (unchanged)
curl -sS 'http://localhost:9428/select/logsql/query?q=service:tei' | jq 'length'   # → non-zero
curl -sS 'http://localhost:9428/select/logsql/query?q=service:genie-backend' | jq 'length'  # → non-zero
```

### P2

```bash
# ADMIN_TOKEN via .claude/rules/SERVER-TESTING.md §Master Admin Token
# ADMIN_TOKEN=...

# Endpoint parity check
curl -sk -w "\nHTTP %{http_code}" "http://localhost:3000/api/admin/logs?level=ERROR&limit=5" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.logs | length'

# Graceful degradation
docker stop victorialogs
VL_FAIL_OPEN=true docker compose up -d backend
curl -sk "http://localhost:3000/api/admin/logs?limit=5" -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{logs: .logs, degraded: .degraded}'
# → {"logs":[],"degraded":true}
docker start victorialogs

# D2 master switch (no restart, per-call env read)
ADMIN_LOGS_SOURCE=file docker compose up -d backend
curl -sk "http://localhost:3000/api/admin/logs?limit=5" -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.logs | length'
# → non-zero (file path active)

# Banner renders in LogSearchDialog.vue
curl -sk "http://localhost:3000/api/admin/logs?limit=5" -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.degraded'
# → true when VL_FAIL_OPEN=true; LogSearchDialog.vue computed.banner renders i18n alert
```

### P3

```bash
# Seed test security messages
docker exec backend node -e "
require('./components/shared/lib/logger').info('failed_login user=test ip=1.2.3.4');
require('./components/shared/lib/logger').warn('brute force detected from 1.2.3.4');
"

# Scan
curl -sk -X POST "http://localhost:3000/api/admin/security-scan" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | \
  jq '{critical: .vulnerabilities.critical | length, medium: .vulnerabilities.medium | length, low: .vulnerabilities.low | length}'
# → non-zero for medium/low (failed_login + brute_force)

# Throughput
time curl -sk -X POST "http://localhost:3000/api/admin/security-scan" -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
# → real <2s on a 7-day window

# No worker_threads
grep -n "worker_threads" components/gov-chat-backend/services/security-scan-service.js
# → 0 matches

# Degradation (security-scan extension of CAP-5)
docker stop victorialogs
VL_FAIL_OPEN=true docker compose up -d backend
time curl -sk -X POST "http://localhost:3000/api/admin/security-scan" -H "Authorization: Bearer $ADMIN_TOKEN" | jq '{vulns: .vulnerabilities, degraded: .degraded, error: .error}'
# → within 5s: {vulns:{critical:[],medium:[],low:[]}, degraded:true, error:"vl_unreachable"}
docker start victorialogs
```

### P4

```bash
# Deprecated endpoints
curl -sk -X POST "http://localhost:3000/api/admin/logs/rollover" -H "Authorization: Bearer $ADMIN_TOKEN"
# → {"deprecated":true,"message":"Log rollover is deprecated; logs are written directly to VictoriaLogs."}

# Disk usage from INSIDE the backend container (cwd=/app, host path does not resolve)
docker exec backend sh -c 'du -sh /app/logs/*.log 2>/dev/null || echo 0'
# → 0 after one rotation cycle with LOG_TO_FILE=0
```

## Final success signal

After P4 ships and the deployed release branch passes smoke:

1. `curl http://victorialogs:9428/select/logsql/query?q=service:genie-backend` returns records for the last 24 h.
2. `GET /api/admin/logs?level=ERROR&limit=5` returns contract-identical JSON shape (verified by `logs-vl-contract.test.js`).
3. `POST /api/admin/security-scan` completes in < 2 s on a 7-day window with the same `vulnerabilities.{critical,medium,low}[]` shape.
4. `du -sh components/shared/lib/logs/*.log` returns 0 after one rotation cycle with `LOG_TO_FILE=0`.
5. Killing VL with `VL_FAIL_OPEN=true` returns empty results + `degraded: true` flag.
6. `ADMIN_LOGS_SOURCE=file` env switch restores pre-migration behaviour without restart.

## Local lint / format / test gates

Run before pushing any MR (per CLAUDE.md and `feedback_ci_local_checks`):

```bash
cd components/gov-chat-backend
npm run lint && npm run format:check
npm test
npm run test:contract

cd ../shared/lib
npm run lint && npm run format:check
npm test

cd ../document-repository
npm run lint && npm run format:check
npm test
```

Python side: `npm run lint:py && npm run format:py:check` (no OPEA files touched; sanity check).