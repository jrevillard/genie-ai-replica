# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation + data layer complete. Next: service tier (stateless apps), observability, AI/ML, per-env config + ingress, CI integration.

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) |
| `genieai-umbrella` | foundation + data layer | Single-install chart with data layer (CNPG, kube-arangodb, keycloak, sealed-secrets CRs) |

## Cluster prerequisites

Operator controllers (CNPG ≥1.30, kube-arangodb 1.4.x, sealed-secrets ≥0.40,
keycloak-operator 26.x; later: GPU, cert-manager, envoy-gateway) are cluster
bootstrap prerequisites — installed once per cluster, before any release.
Per-release operator installs would create competing cluster-scoped
controllers. See `genieai-umbrella/README.md` for install hints.

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.
- `docs/charts/` — dev-internal reference docs (operator selection, migration playbooks).

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use SealedSecret resources (data layer default backend).
- Tests live in each chart's `templates/tests/` directory (Helm convention)
- Install requires `-n <ns> --create-namespace` (the Namespace is a regular resource; the release Secret and hooks need it first)
- Vendored dep tarballs are generated, not tracked — run `make deps` (from `charts/`) after cloning or dep changes. `Chart.lock` IS tracked (pins dep versions for reproducible builds). `ct install` for integration, `helm test` for smoke.
- Hook Jobs live in `templates/hooks/*.yaml` with explicit `helm.sh/hook` annotations (phase + weight). Helm scans `templates/` recursively — the subdirectory is organizational only.
