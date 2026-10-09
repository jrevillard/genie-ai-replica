# genieai-umbrella

Single-install Helm chart for GENIE.AI. Renders the entire 28-service stack
with one `helm install`.

## Status

| Layer | Status |
|---|---|
| Foundation (namespace, ArgoCD example, chart-testing baseline) | ✅ Shipped |
| Data layer (CNPG, kube-arangodb, sealed-secrets; keycloak-operator = bootstrap prerequisite) | ✅ Shipped |
| Service tier (stateless app: backend + frontend + document-repository + nginx + clamav + gateway) | ⏳ Next |
| Observability (vmoperator VMSingle/Cluster + OTel operator + serviceMonitors) | ⏳ Planned |
| AI/ML (vLLM + TEI + OPEA microservices + GPU operator) | ⏳ Planned |
| Per-env config + ingress (Envoy Gateway + cert-manager) | ⏳ Planned |
| CI integration + image signing + Renovate | ⏳ Planned |

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

Default secrets backend `sealedSecrets`. Helm dep pinned to `~> 2.20.0`
(pin rationale in docs/charts/k8s-native-audit.md; the CVE IDs from early
research are RETRACTED). Key rotation is operator-initiated: restart the
controller with a fresh key, re-fetch its public cert, re-encrypt every
committed SealedSecret against it, then deploy — the pre-upgrade drift hook
fails upgrades while any SealedSecret reports Synced=False (ErrorDecrypt).
