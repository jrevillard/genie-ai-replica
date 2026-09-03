# Rollback Matrix

Per-phase rollback triggers, actions, and time-to-rollback. `ADMIN_LOGS_SOURCE=file` (D2) is the master escape hatch — permanent, never removed. Validate each switch on the deployed release branch before merging the matching MR to `main` (per `feedback_release_validate_before_promote`).

| Phase | Trigger | Action | Time | Notes |
|---|---|---|---|---|
| **P0** | VL healthcheck fails on stack start | Re-add `profiles: [observability]` to `docker-compose.yaml:1650,1671,1749` and revert `victorialogs.deploy.replicas` to `${ENABLE_OBSERVABILITY:-0}`. Re-run `docker compose --profile observability up -d`. | < 2 min | No data migration; pure compose flip. |
| **P1a** | OTel logs exporter errors flood backend logs | `LOG_TO_VICTORIALOGS=0` env. Restart backend. New transport short-circuits. File logging remains. | < 5 min | Logs still flow via Console + DailyRotateFile; admin endpoints keep file path (until P2). |
| **P1c** | Backend logs disappear after driver switch | Revert YAML anchor `x-local-logging` at `docker-compose.yaml:75` AND the per-service overrides at `:484, :596` (anchor + both refs are required). Restart backend. | < 3 min | Fluentd pipeline preserved; OTel exporter still writes to VL in parallel. |
| **P2** | Admin endpoints return empty/wrong shape | `ADMIN_LOGS_SOURCE=file` env. Old `LogsService` path activates on next request — no restart (per-call env read in P2). | < 1 min | D2 master switch. Permanent. |
| **P3** | Security scan times out (>30 s on 7-day window) | `SECURITY_SCAN_BACKEND=file` env. Old `worker_threads` path activates. Clear `/app/data/security/last-scan-results.json` cache. | < 2 min | The file-based scanner still works; P1a's VL transport keeps filling the disk log even though the scanner reads it. |
| **P4** | File fallback needed by ops (e.g., audit retention investigation) | `LOG_TO_FILE=1` env. Re-adds `DailyRotateFile` + tailable `File` transports. Restart. | < 5 min | Disk fills at the historical 10 MB × 30 d cadence. |

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
# 1. Flip the master switch (no restart)
ADMIN_LOGS_SOURCE=file
SECURITY_SCAN_BACKEND=file
LOG_TO_VICTORIALOGS=0
VL_FAIL_OPEN=true
LOG_TO_FILE=1

# 2. Restart backend + document-repository
docker service update genieai_gov-chat-backend
docker service update genieai_document-repository

# 3. Optionally revert docker-compose.yaml profiles
# (P0 only; re-add profiles:[observability] on :1650,1671,1749 and revert VL replicas to ${ENABLE_OBSERVABILITY:-0})
```

System returns to pre-migration behaviour; P0's CI stub stays in place; subsequent MRs can resume from P0 forward.