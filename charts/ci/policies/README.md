# OPA Rego policies for chart CI

Policies run via `conftest` against `deploy/environments/**/*.yaml` and against
chart-rendered manifests.

Planned policies:

- `secret-leak.rego` — reject `Secret` resources, ConfigMap data keys named
  `password`/`secret`/`token`/etc, and high-entropy strings in known config
  paths.

- `image-signature.rego` — reject Pods whose image references lack cosign
  signature verification (enforced in-cluster by Kyverno; this is the
  lint-time pre-check).
