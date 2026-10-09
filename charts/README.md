# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation plan in progress. See `docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-foundation.md`
for the first batch of work.

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) reused by `genieai-umbrella` |
| `genieai-umbrella` | foundation | Single-install chart — 28 services, depends on `genieai-common` + operators |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use External Secrets Operator.
- Tests live in each chart's `tests/` directory; `ct install` for integration, `helm test` for smoke.
