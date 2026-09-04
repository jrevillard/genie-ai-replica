# tests/melt-correlation/ — MELT correlation + chaos suite

> **Status:** P0 exit-0 stub.
> The real OTel trace↔log↔metric correlation + chaos suite is deferred as **`DW-325`**
> (see [`_bmad-output/implementation-artifacts/deferred-work.md`](../../_bmad-output/implementation-artifacts/deferred-work.md)).
> This directory exists **only** to unblock the scheduled CI jobs that already reference
> it — see [§ Consumers](#consumers-ci-jobs) below.

## What this directory ships today

| File                       | Purpose                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `run-melt-test.sh`         | Bash stub. Exits `0`. Emits valid JUnit XML (`reports/melt-correlation-report.xml` + `reports/melt-grafana-report.xml`) with `<skipped/>` cases. Tolerates `--skip-chaos`, `--skip-playwright`, `--correlation-only`, and any future flag. No fabricated PASSes. |
| `README.md`                | This file.                                                                                       |

No other files exist in this directory. The full suite is **not** implemented yet.

## Why a stub

The P0 MR of the [Admin Logs → VictoriaLogs migration](../../_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md) needs to keep the pipeline green
while the migration rolls out across phases P1a–P4. The scheduled CI jobs that validate
MELT correlation are pinned to the `scheduled` stage. They do **not** currently
carry `allow_failure: true` — adding/verifying that flag is owned by Story 7.5. Without a stub
script those jobs would fail with `bash: run-melt-test.sh: No such file or directory`
on the very first pipeline that hits them.

A real implementation is **out of scope** for the migration spec — the chaos /
correlation suite belongs to a separate observability-reliability epic. Triggers
for revisiting (per the spec's `Deferred` section):

- Any MR that touches VictoriaLogs, OTel Collector, or fluentd deployment.
- An observability reliability question (e.g. lost spans, dropped logs, metric gaps).
- A Grafana dashboard rework that warrants new correlation assertions.

## Consumers (CI jobs)

The stub is invoked by two GitLab CI jobs (definitions at `.gitlab-ci.yml:2942-2999`):

### `scheduled:melt-correlation`

```yaml
scheduled:melt-correlation:
  image: node:20-alpine
  stage: scheduled
  needs: [scheduled:integration]
  script:
    - apk add --no-cache bash curl
    - cd tests/melt-correlation
    - bash run-melt-test.sh --skip-chaos --skip-playwright
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - reports/melt-*.xml
    reports:
      junit:
        - reports/melt-correlation-report.xml
        - reports/melt-grafana-report.xml
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule" && $ENABLE_OBSERVABILITY == "1"
```

### `scheduled:melt-chaos`

```yaml
scheduled:melt-chaos:
  image: docker:24
  stage: scheduled
  needs: [scheduled:integration]
  script:
    - apk add --no-cache bash curl nodejs npm
    - npm ci --no-audit --no-fund 2>/dev/null || npm install
    - cd tests/melt-correlation
    - bash run-melt-test.sh --skip-playwright --correlation-only || true
    - node chaos-resilience.test.js
  artifacts:
    when: always
    expire_in: 7 days
    paths:
      - reports/melt-chaos-report.xml
    reports:
      junit:
        - reports/melt-chaos-report.xml
```

> **Note:** the chaos job also references `node chaos-resilience.test.js` and a
> `reports/melt-chaos-report.xml` artifact. Neither exists in the stub — both
> are the chaos suite's responsibility (DW-325). The `|| true` guard applies to
> the `run-melt-test.sh` line only: the chaos job still fails on the following
> `node chaos-resilience.test.js` line until DW-325 lands. The stub therefore
> unblocks `scheduled:melt-correlation`, not `scheduled:melt-chaos`.

## What a real implementation must cover (DW-325)

The replacement suite validates the full MELT (Metrics/Events/Logs/Traces)
correlation loop across the observability stack. At minimum it must:

1. **Trace↔log correlation** — fire an HTTP request, capture its `trace_id` /
   `span_id` from the backend's OTel spans (VictoriaTraces), and assert the same
   `trace_id` appears in the log records returned by VictoriaLogs for the same
   window. Must cover both `genie-backend` and `genie-document-repository`
   services (see AD-2 in the architecture spine).
2. **Trace↔metric correlation** — assert Prometheus exemplars on request-latency
   histograms resolve to real VictoriaTraces span IDs. Cover the RAG pipeline
   stages (ChatQnA → Embedding → Retriever → Reranker → LLM) end-to-end.
3. **Log↔metric correlation** — fail-restart counts in VictoriaMetrics match the
   `process_restart` log records observed in VictoriaLogs over the same window.
4. **Grafana dashboard health** — query each provisioned dashboard for the
   `200 OK` + non-empty data source response, and snapshot one panel render per
   dashboard. Output ends up in `reports/melt-grafana-report.xml`.
5. **Chaos scenarios** (owned by `scheduled:melt-chaos`):
   - Stop / restart `victorialogs`; assert `VL_FAIL_OPEN=true` returns
     `{logs:[], degraded:true}` within 5 s (CAP-5 contract).
   - Pause / resume the fluentd driver on one app service; assert logs still
     arrive via the OTel OTLP path (no double-count after P1c, see AD-5).
   - Restart `otel-collector`; assert the producer-side lazy buffer (100 records,
     AD-1) flushes after `LoggerProvider` reconnection without loss.
   - DNS-race scenario: start `victorialogs` after a backend container; assert
     the lazy health-probe path (AD-16) recovers within `3 × 5 s`.

When implemented, replace `run-melt-test.sh` with a real driver (Node.js or
Python — both have full OTel + axios + logfmt libs available). Keep the JUnit
artifact paths identical so the `scheduled:*` job `artifacts.reports.junit`
block continues to work without `.gitlab-ci.yml` edits.

## Local usage

```bash
# From the repo root:
bash tests/melt-correlation/run-melt-test.sh
bash tests/melt-correlation/run-melt-test.sh --skip-chaos --skip-playwright
bash tests/melt-correlation/run-melt-test.sh --skip-playwright --correlation-only

# Verify the produced JUnit XML parses:
python3 -c "import xml.etree.ElementTree as E;[E.parse(f) for f in (
  'reports/melt-correlation-report.xml',
  'reports/melt-grafana-report.xml',
)]"
```

Generated `reports/` output is gitignored (`reports/` at `.gitignore:67`) — do not commit it.

## References

- Spec: [`_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`](../../_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md) — CAP-8, NG-4.
- Spine: [`_bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md`](../../_bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md) — AD-2 (stream-field pinning), AD-5 (dual-emit window), AD-16 (lazy health probe).
- Deferred: [`_bmad-output/implementation-artifacts/deferred-work.md`](../../_bmad-output/implementation-artifacts/deferred-work.md) — DW-325.
- Story: [`_bmad-output/implementation-artifacts/stories/1-5-tests-melt-correlation-ci-stub-exit-0-readme.md`](../../_bmad-output/implementation-artifacts/stories/1-5-tests-melt-correlation-ci-stub-exit-0-readme.md).
- CI consumers: `.gitlab-ci.yml:2942-2999`.
