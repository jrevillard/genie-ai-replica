# Per-environment Kustomize overlays

`deploy/environments/<env>/` contains one subdirectory per deployment target. Each
subdirectory holds:

- `kustomization.yaml` — Kustomize resource that pins `helmCharts:` entries to
  the umbrella chart path + per-env `values-override.yaml`.
- `values-override.yaml` — env-specific Helm values overrides.

`main` branch tracks the chart + plain envs (dev, staging, prod). High-customization
envs track `release/<env>` branches (e.g. `release/el-salvador`).

Per-env subdirectories are added as environments onboard to the Helm deployment;
the umbrella chart itself stays identical across all of them.
