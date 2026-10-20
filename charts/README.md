# GENIE.AI Helm charts

Kubernetes-deployment Helm charts for GENIE.AI.

## Charts

| Chart | Purpose |
|---|---|
| `genieai-common` | Library chart. Templates + helpers shared by the umbrella. Not installed directly. |
| `genieai-umbrella` | Single-install chart. Renders the full GENIE.AI service topology (stateless tier, data layer, OPEA AI/ML tier, Gateway API edge, keycloak-config-cli convergence) in one `helm install`. |

## Status

`genieai-umbrella` 0.2.33: foundation, service tier, data layer, OPEA tier, observability, and the Gateway API edge (Envoy Gateway as an optional chart dependency, nginx removed from the data path) — all live-validated on a minikube laptop cluster via Flux. Keycloak custom theme ships at runtime (ConfigMap tarball + initContainer — `make keycloak-theme` to regenerate; CI guards drift).

## Cluster prerequisites

Operator controllers (CNPG ≥1.30, kube-arangodb 1.4.x, sealed-secrets ≥0.40, keycloak-operator 26.x, OpenTelemetry Operator) are cluster bootstrap prerequisites — installed once per cluster, before any release. Per-release operator installs would create competing cluster-scoped controllers. `scripts/install-prereqs.sh` automates the set. Conditional prerequisites: cert-manager (only when `ingress.tls.enabled` with an issuer), GPU operator (only when `opea.gpu.mode=in-cluster`). The Envoy Gateway is NOT a prerequisite — it ships as a chart dependency (`envoyGateway.enabled`, default on).

A laptop cluster additionally needs a **policy-enforcing CNI**: minikube's default (kubenet) stores the chart's NetworkPolicies and never applies them, so a broken egress graph stays invisible. `scripts/laptop-cluster-bootstrap.sh` builds the whole cluster (`--cni=calico`) and restores the state that lives only inside a cluster — the sealed-secrets key, the Flux PAT, the selfsigned issuer. The procedure, the installation order and the SealedSecret/SOPS split are documented in [`docs/charts/laptop-cluster-bootstrap.md`](../docs/charts/laptop-cluster-bootstrap.md).

## Render gates

The umbrella is validated by two stages. Both must pass before a release lands on `main`.

```bash
# 1. helm lint + ct lint — schema, template conventions, cross-reference checks
helm lint charts/genieai-umbrella --strict
make -C charts lint

# 2. helm template byte-diff — operator-facing surface stays stable
make -C charts template              # writes /tmp/genieai-rendered.yaml
diff -u <(git show HEAD:path/to/baseline.yaml) /tmp/genieai-rendered.yaml
```

`ct install` against a kind cluster + `helm test` runs the smoke jobs (namespace existence, data-tier dependency reachability). Trigger via `make -C charts test`.

## Conventions

- Helm API v2, Helm 3.16.x (CI pins dtzar/helm-kubectl:3.16.0).
- No secrets in `values.yaml` or `values-override.yaml`. Secrets are operator-materialized (SealedSecret, External Secrets Operator, SOPS, manual, etc.).
- Tests live in each chart's `templates/tests/` (Helm convention).
- Install with `-n <ns> --create-namespace` — the Namespace is a regular resource; hooks and the release Secret need it first.
- Vendored dep tarballs are generated, not tracked — run `make -C charts deps` after cloning or dep changes. `Chart.lock` IS tracked.
- Hook Jobs live in `templates/hooks/*.yaml` with explicit `helm.sh/hook` annotations (phase + weight). The subdirectory is organizational; Helm scans `templates/` recursively.
- Hook + test-pod init containers download `kubectl` and `jq` from public release URLs. Set `global.kubeletToolsMirror` for air-gapped clusters.
- NetworkPolicy: every rendered service gets a default-deny + explicit allowlist policy. The OPEA model Deployments get ingress-only policies; orchestrators see per-peer egress rules scoped to the call graph.
- PodDisruptionBudget: only emitted when `replicas >= 2`.

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.
- `docs/charts/` — dev-internal reference docs (operator selection, migration playbooks).