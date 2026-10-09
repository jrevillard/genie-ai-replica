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

## Pre-install hooks

The chart's pre-install/pre-upgrade hooks run in ascending `helm.sh/hook-weight`
order (RBAC first — regular resources land only AFTER all hooks, so everything a
hook needs must itself be a lower-weight hook):

1. `-30` — ServiceAccount + ClusterRole + ClusterRoleBinding (hook-owned)
2. `-20` — dep-graph ConfigMap (dependency-graph.json + enabled.json)
3. `-10` — cluster-profile drift detection (pre-upgrade only; emits a Warning Event on namespace-label/render mismatch)
4. `-5`  — dependency graph validation (services/data require their deps)
5. `0` on pre-upgrade only — SealedSecret drift validation (status.conditions[type=Synced].status=False sweep)

## Tests

```bash
make test         # ct install + helm test against kind
helm test <release> -n genieai
```

## Secrets backend

Default secrets backend `sealedSecrets` (controller = cluster bootstrap
prerequisite; see above). Key rotation is operator-initiated: restart the
controller with a fresh key, re-fetch its public cert, re-encrypt every
committed SealedSecret against it, then deploy — the pre-upgrade drift hook
fails upgrades while any SealedSecret reports Synced=False (ErrorDecrypt).
