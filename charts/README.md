# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation: library chart + umbrella skeleton + chart-testing baseline shipped.
The service tiers (data layer, stateless apps, observability, AI/ML), ingress,
per-environment overlays and CI integration are under active development.

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | available | Library chart (templates + helpers) reused by `genieai-umbrella` |
| `genieai-umbrella` | skeleton | Single-install chart — 28 services when complete; depends on `genieai-common` + operators |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Secrets are delivered by a pluggable backend (Sealed Secrets by default; External Secrets Operator documented as an alternative).
- Tests live in each chart's `templates/tests/` directory (Helm convention); `ct install` for integration, `helm test` for smoke.
- Vendored dependency tarballs (`charts/*/charts/*.tgz`) and `Chart.lock` are generated, not tracked — run `make deps` (from `charts/`) after cloning or dependency changes.

## Install (foundation tier)

```bash
helm install <release> charts/genieai-umbrella -n genieai --create-namespace
```

`--create-namespace` is required on a fresh cluster: the release Secret and the
pre-install hooks live in the target namespace, and the chart's own Namespace
resource server-side-applies its labels onto the namespace the flag creates.
Avoid release names starting with `genieai` — the fullname helper would render
`genieai-genieai-umbrella-*` (valid but ugly).
