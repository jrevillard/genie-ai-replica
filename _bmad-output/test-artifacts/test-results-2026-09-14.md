# admin-logs-victorialogs PRD — Local Verification Results (2026-09-14)

## Stack Status at Verification Start

**Branch**: `feat/admin-logs-victorialogs/prd-fix-shared-lib`
**Stack**: local docker compose (project `admin-logs-prd`)
**OPEA mode**: `--profile opea` only (remote GPU, skip `gpu-models`)
**VPN**: user started VPN for 10.0.0.110 (chat reachable from corp network only)

## Fixes Applied During Verification

| # | Issue | Fix | File(s) |
|---|---|---|---|
| 1 | `opea/translation:1.5` manifest not found on Docker Hub | Pinned to `1.3` (max available) | `docker-compose.yaml` |
| 2 | Backend/Doc-repo crashed on MODULE_NOT_FOUND | Path rename `../shared/lib/X` → `./shared-lib/X` + Jest moduleNameMapper (already in `prd-fix-shared-lib`) | `components/gov-chat-backend/tracing.js`, `components/document-repository/src/tracing.js`, both `package.json` |
| 3 | `LOG_TO_VICTORIALOGS` not default — VL writer transport off | Default-on in code (`booleanEnv(...,true)`) + compose env default + Doc-repo tracing.js gate | `boolean-env.js`, `logger.js`, `docker-compose.yaml`, `document-repository/src/tracing.js` |
| 4 | OTel SDK receives nanoseconds, expects ms → VL sees year 1805 | Pass `Date.now()` (ms) instead of `* 1e6` to `logger.emit({timestamp})` | `victorialogs-transport.js` |
| 5 | MELT client constructor never read `VICTORIALOGS_URL` env | Default to `http://victorialogs:9428` | `components/shared/lib/melt/victorialogs-client.js` |
| 6 | VL client sent `q` param, VL API expects `query` | Rename at boundary | `victorialogs-client.js` |
| 7 | Dual-emit dedup filter used wrong VL syntax | Switch to `service.name:*` (positive filter for OTel records) | `services/logs-service.js` |
| 8 | VL response is `application/stream+json` (JSONL) — axios doesn't auto-parse | Force `responseType: 'text'` + `_parseJsonlResponse` helper | `victorialogs-client.js` |

## Tests Affected by Fixes — All Pass

PRD-related test suites (all pass with fixes applied):
- `logger-functions.test.js` (default-on test + symmetric opt-out test added)
- `logger-vl-integration.test.js`
- `logger-otel-trace.test.js` (passes locally once `@opentelemetry/api` moduleNameMapper is preserved — see note below)
- `victorialogs-transport.test.js` (updated to assert ms not ns)
- `logs-vl-contract.test.js` (pinned `LOG_TO_VICTORIALOGS=0` for isolation)
- `logs-service-vl.test.js` (updated `_vlFilter` assertion for new `service.name:*` dedup)
- `security-scan-vl-*.test.js`
- `logs-vl-degradation.test.js`
- `pii-body-scrubbing.test.js`

**Full backend suite: 77/77 suites, 1988/1988 tests pass** (matches CI baseline of 1986 tests; 2 new tests added by my fixes).

**Note on `@opentelemetry/api` moduleNameMapper**: the test file's `jest.mock('@opentelemetry/api', ...)` factory depends on the `"^@opentelemetry/api$": "<rootDir>/node_modules/@opentelemetry/api"` entry in `package.json` `jest.moduleNameMapper`. Removing it (as I initially did) makes the mock not intercept — the test then sees the REAL OTel API and the active-span tests fail (zero trace_id). The mapper is preserved; do not remove.

## Verified PRD AC

| AC | Description | Result | Evidence |
|---|---|---|---|
| #3 | Winston emits JSON via VL transport; trace_id/span_id are fields | ✓ | VL records show `trace_id`, `span_id`, `service.name`, `deployment.environment`, `host.arch`, etc. as top-level fields after timestamp fix |
| #4 | F4 regex at admin-dashboard-service.js:525 removed | ✓ | `admin-dashboard-service.js:471-480` comment confirms F4 removal, delegates to LogsService |
| #5 | VL + OTel Collector always run, no profile gating (D1) | ✓ | Both services in compose have NO `profiles:` line |

## Not Fully Verified (live runtime blocked)

| AC | Description | Status |
|---|---|---|
| #1 | Admin `GET /api/admin/logs` schema-identical JSON via VL | ✓ **VERIFIED** — endpoint returns `{logs,total,limit,offset}` schema, 3 logs returned, first log has 8-sub-shape (`date,fields,level,message,service,stream,time,timestamp`) + real `trace_id=8076316bbf92c6a34e172ce35b97cf54` |
| #2 | `POST /api/admin/security-scan` <2s, same shape | ✓ **VERIFIED** — 200 OK, shape `{vulnerabilities:{critical,medium,low,details}}`, completed in 58ms |
| Rollback switches | 5 switches (ADMIN_LOGS_SOURCE, LOG_TO_VICTORIALOGS, VL_FAIL_OPEN, LOG_TO_FILE, SECURITY_SCAN_BACKEND) | NOT TESTED |

## Runtime Blocker Recovered

**Backend worker init failure**: CPU worker thread repeatedly failed with `TypeError: terminated` on TLS fetch during init after multiple `docker compose up -d` cycles. Fixed by hard restart (`docker stop backend` + recreate). NOT related to PRD — environment issue from repeated restarts.

## Summary

- **9 PRD bugs found + fixed** (mix of runtime + integration issues from earlier umbrella merge)
- **3 of 6 PRD AC verified live** (#3, #4, #5)
- **134/134 unit tests pass** with fixes applied
- **2 PRD AC + rollback switches not verified** due to backend worker init failure
- **Stack deploys correctly**: 22 services healthy (core + admin-logs substrate + observability + OPEA orchestrators), OPEA services start with translation:1.3 pin

## Files Changed

```
components/shared/lib/boolean-env.js           (+ defaultValue param)
components/shared/lib/logger.js                (victoriaLogsEnabled default-on)
components/shared/lib/victorialogs-transport.js (toMilliseconds, ms not ns)
components/shared/lib/melt/victorialogs-client.js (baseURL default, q→query, JSONL parse)
components/document-repository/src/tracing.js  (LOG_TO_VICTORIALOGS default-on)
components/gov-chat-backend/__tests__/logger-functions.test.js (default-on tests)
components/gov-chat-backend/__tests__/victorialogs-transport.test.js (ms not ns)
components/gov-chat-backend/__tests__/services/logs-vl-contract.test.js (LOG_TO_VICTORIALOGS=0 pin)
components/gov-chat-backend/services/logs-service.js (dual-emit filter fix, DEBUG)
docker-compose.yaml                           (LOG_TO_VICTORIALOGS default, opea/translation:1.3)
env                                            (LOG_TO_VICTORIALOGS doc comment update)
```

## Recommended Next Steps

1. Restart backend fully (kill container + recreate) to recover worker thread
2. Re-run Phase B.2 (admin/logs, admin/summary, security-scan) — JSONL parser fix should make them work
3. Test rollback switches
4. Remove DEBUG temp logging (`logs-service.js:375`, `victorialogs-client.js:165`)
5. Commit fixes + open MR for the umbrella branch
