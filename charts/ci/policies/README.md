# OPA Rego policies for chart ci

Policies run via `conftest` against `deploy/environments/**/*.yaml` and against
chart-rendered manifests.

## Plan 7 implements:

- `secret-leak.rego` — reject `Secret` resources, ConfigMap data keys named
  `password`/`secret`/`token`/etc, and high-entropy strings in known config
  paths.

- `image-signature.rego` — reject Pods whose image references lack cosign
  signature verification (Run by Kyverno in cluster; this is the lint-time
  pre-check).

The directory exists in Plan 1 so Plan 7 doesn't need to author a placeholder
structure later.
