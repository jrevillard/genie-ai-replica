# genieai-umbrella

Single-install Helm chart for GENIE.AI. Renders the entire 28-service stack
with one `helm install`.

## Status

| Layer | Status |
|---|---|
| Foundation (namespace, ArgoCD example, chart-testing baseline) | ✅ Shipped |
| Data layer (CNPG, kube-arangodb, sealed-secrets CRs; operators = bootstrap prerequisites) | ✅ Shipped |
| Service tier (stateless app: backend + frontend + document-repository + nginx + clamav + gateway) | ⏳ Next |
| Observability (vmoperator VMSingle/Cluster + OTel operator + serviceMonitors) | ⏳ Planned |
| AI/ML (vLLM + TEI + OPEA microservices + GPU operator) | ⏳ Planned |
| Per-env config + ingress (Envoy Gateway + cert-manager) | ⏳ Planned |
| CI integration + image signing + Renovate | ⏳ Planned |

## Cluster prerequisites

The operator controllers the chart's custom resources depend on are **cluster
bootstrap prerequisites** — installed once per cluster, before any GENIE.AI
release. Per-release operator installs would create competing cluster-scoped
controllers (sealed-secrets keypair fights, duplicate CNPG/kube-arangodb
reconcilers). The chart renders only the custom resources they manage.

| Operator | Version | Install (generic) |
|---|---|---|
| CloudNativePG | ≥1.30 | `helm install cnpg cloudnative-pg --repo https://cloudnative-pg.github.io/charts` |
| kube-arangodb | 1.4.x | `helm install arango kube-arangodb --repo https://arangodb.github.io/kube-arangodb` |
| sealed-secrets | ≥0.40 | `helm install sealed-secrets sealed-secrets --repo https://bitnami.github.io/sealed-secrets` |
| keycloak-operator | 26.x | OLM subscription or the static YAML from keycloak.org (its advertised Helm repo serves no index) |

Later tiers add: GPU operator, cert-manager, envoy-gateway — same model.

## Per-environment overlay

Apply per-env config via `deploy/environments/<env>/values-override.yaml`. See
that directory's `README.md`.

## Values

The umbrella's own `values.schema.json` is what validates operator overrides;
the `genieai-common` library's `values.schema.json` is **NOT** applied here
because the umbrella deliberately avoids `import-values` — Helm 4 injects
the `global` subtree into every dependency, which would otherwise pull the
library's schema down the same path and double-validate keys that the
umbrella schema already accepts (top-level `component:`, `nameOverride:`,
`fullnameOverride:`). The umbrella's own schema is the source of truth;
top-level keys from the library schema description that the umbrella's
schema does not explicitly declare (top-level `component:`, `nameOverride:`,
`fullnameOverride:`) pass unchallenged. Per-call `component` (the dict key
passed to `genieai-common.labels` from each template) is the only enforced
component path.

## Pre-install hooks

The chart's pre-install/pre-upgrade hooks run in ascending `helm.sh/hook-weight`
order (RBAC first — regular resources land only AFTER all hooks, so everything a
hook needs must itself be a lower-weight hook):

1. `-30` — ServiceAccount (hook-owned, before-hook-creation,hook-succeeded)
2. `-30` — Role + RoleBinding (namespaced, hook-owned, before-hook-creation,hook-succeeded)
3. REGULAR (after all hooks) — ClusterRole + ClusterRoleBinding (cluster-scoped, regular resource; the helm-test pod's `kubectl get ns` call relies on these — they must exist AFTER install/upgrade; the dep-check Job runs BEFORE they appear but the Job only needs the namespaced Role)
4. `-20` — dep-graph ConfigMap (dependency-graph.json + enabled.json)
5. `-10` — cluster-profile drift detection (pre-upgrade only; emits a Warning Event on namespace-label/render mismatch)
6. `-5`  — dependency graph validation (services/data require their deps)
7. `0` on pre-upgrade only — SealedSecret drift validation (status.conditions[type=Synced].status=False sweep)

## Tests

```bash
make test         # ct install + helm test against kind
helm test <release> -n genieai
```

The two helm-test pods (`<release>-genieai-umbrella-test-namespace`,
`<release>-genieai-umbrella-test-data-deps`) and the clusterprofile-detect /
sealed-secret-validate hook Jobs all need `kubectl` (and the drift validator
also needs `jq`). The chart no longer pins an image that ships those binaries
preinstalled (the `registry.k8s.io/kubectl` image is distroless and the
`bitnami/kubectl` version tags were purged); instead each Pod runs an init
container that downloads the static binaries into a shared `tools` emptyDir
and the main container (alpine) picks them up via the PATH env.

### Air-gapped deployments

The init containers download `kubectl` and `jq` from public release URLs by
default. For air-gapped / sovereign clusters, set
`global.kubeletToolsMirror` to an internal mirror URL (no scheme required);
the init containers then prepend that mirror URL to the well-known release
paths (`/release/v1.33.0/...` and `/jq/releases/download/jq-1.7.1/...`).
The mirror must serve both paths from its base URL — the chart does not
fall back to upstream when the mirror is unreachable.

## Secrets backend

Default secrets backend `sealedSecrets` (controller = cluster bootstrap
prerequisite; see above). Key rotation is operator-initiated: restart the
controller with a fresh key, re-fetch its public cert, re-encrypt every
committed SealedSecret against it, then deploy — the pre-upgrade drift hook
fails upgrades while any SealedSecret reports Synced=False (ErrorDecrypt).

Operator convention (no chart value): record which cluster key sealed the
committed blobs in `deploy/environments/<env>/secrets/*.yaml` next to those
blobs — e.g. the certificate fingerprint from `kubeseal --fetch-cert` in a
comment or the environment's README. The chart reads no fingerprint value;
runtime enforcement is the drift hook above.
