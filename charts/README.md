# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation plan complete. Next: Plans 2–8 for data layer, service tier, observability, AI/ML, per-env config, CI, docs.

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) reused by `genieai-umbrella` |
| `genieai-umbrella` | foundation | Single-install chart — 28 services, depends on `genieai-common` + operators |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use External Secrets Operator (Plan 2 + Plan 6).
- Tests live in each chart's `tests/` directory; `ct install` for integration, `helm test` for smoke.

## Install (foundation tier)

```bash
helm install <release> charts/genieai-umbrella -n genieai --create-namespace
```

`--create-namespace` is required on a fresh cluster: the release Secret and the
pre-install hooks (Plan 2+) live in the target namespace, and the chart's own
Namespace resource server-side-applies its labels onto the namespace the flag
creates. Avoid release names starting with `genieai` — fullname helper would
render `genieai-genieai-umbrella-*` (valid but ugly).
