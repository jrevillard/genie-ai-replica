# Rollback Matrix

Per-phase rollback triggers, actions, and time-to-rollback. **`ADMIN_LOGS_SOURCE` env contract is preserved** (`_sourceMode()` per-call read in `logs-service.js`) even though the file-body implementation was dropped in T8 — the escape hatch returns 503 `VlFilesDisabledError` when `ADMIN_LOGS_SOURCE=file` is set with `LOG_TO_FILE=0`, honouring SPEC D2. Validate each switch on the deployed release branch before merging the matching MR to `main` (per `feedback_release_validate_before_promote`).

| Phase | Trigger | Action | Time | Notes |
|---|---|---|---|---|
| **P0** | VL healthcheck fails on stack start | Re-add `profiles: [observability]` to `docker-compose.yaml:1650,1671,1749` and revert `victorialogs.deploy.replicas` to `${ENABLE_OBSERVABILITY:-0}`. Re-run `docker compose --profile observability up -d`. | < 2 min | No data migration; pure compose flip. |
| **P3** | Security scan times out (>30 s on 7-day window) | `SECURITY_SCAN_BACKEND=file` env. Old `worker_threads` path activates. Clear `/app/data/security/last-scan-results.json` cache. | < 2 min | The file-based scanner still works; the security-scan code path did NOT change in the OTel-SDK-revert initiative (only the admin-logs path did). |
| **P4** | File fallback needed by ops (e.g., audit retention investigation) | `LOG_TO_FILE=1` env. Re-adds `DailyRotateFile` + tailable `File` transports. Restart. | < 5 min | Disk fills at the historical 10 MB × 30 d cadence. `booleanEnv('LOG_TO_FILE')` gate at `components/shared/lib/logger.js:107` is preserved per Story 7-1. Note: the `/app/logs` host bind-mount was dropped from `docker-compose.yaml` in T7, so the operator must re-add the volume mount manually (see `env` cross-reference comment). |

## Pre-merge validation (per phase MR)

Before merging the MR for each phase:

1. Deploy to the release branch stack (`govstack@10.0.0.102`, `release/el-salvador`).
2. Run `tests/log-assertions/` smoke for that phase's exit criteria.
3. Run `tests/config-validator/` to confirm new env vars are covered.
4. Trigger the rollback switch for that phase and confirm behaviour reverts.
5. Re-enable the new behaviour; smoke again.
6. Only then merge to `main` per `feedback_never_merge_without_ci`.

## Emergency full rollback

If the multi-MR rollout needs a global revert:

```bash
# 1. Flip the surviving master switches
ADMIN_LOGS_SOURCE=file    # SPEC D2 escape — returns 503 VlFilesDisabledError with LOG_TO_FILE=0
SECURITY_SCAN_BACKEND=file
VL_FAIL_OPEN=true         # graceful degradation when VL is unreachable
LOG_TO_FILE=1             # re-enable file transports (audit retention escape hatch)

# 2. Restart backend + document-repository
docker service update genieai_gov-chat-backend
docker service update genieai_document-repository

# 3. Optionally revert docker-compose.yaml profiles
# (P0 only; re-add profiles:[observability] on :1650,1671,1749 and revert VL replicas to ${ENABLE_OBSERVABILITY:-0})
```

System returns to pre-migration behaviour. `LOG_TO_VICTORIALOGS` and `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` are no longer accepted (the OTel SDK LoggerProvider path is gone) — instead, log egress flows through `Winston → stdout → Docker fluentd driver → OTel Collector → VictoriaLogs` regardless of any env var setting.