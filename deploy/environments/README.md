# Per-environment Kustomize overlays

`deploy/environments/<env>/` contains one subdirectory per deployment target. Each
subdirectory holds:

- `kustomization.yaml` — Kustomize resource that pins `helmCharts:` entries to
  the umbrella chart path + per-env `values-override.yaml`.
- `values-override.yaml` — env-specific Helm values overrides.

`main` branch tracks the chart + plain envs (dev, staging, prod). High-customization
envs track `release/<env>` branches (e.g. `release/el-salvador`). See
`docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` §19.

This directory is empty during the Foundation plan. Subsequent plans populate per-env.
