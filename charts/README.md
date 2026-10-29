# GENIE.AI Helm charts

Kubernetes-deployment Helm charts for GENIE.AI.

## Charts

| Chart | Purpose |
|---|---|
| `genieai-common` | Library chart. Templates + helpers shared by the umbrella. Not installed directly. |
| `genieai-umbrella` | Single-install chart. Renders the full GENIE.AI service topology (stateless tier, data layer, OPEA AI/ML tier, Gateway API edge, keycloak-config-cli convergence) in one `helm install`. |

## Status

`genieai-umbrella`: foundation, service tier, data layer, OPEA tier, observability, and the Gateway API edge (Envoy Gateway as an optional chart dependency, nginx removed from the data path) — all live-validated on a minikube laptop cluster via Flux. The chart version lives in `genieai-umbrella/Chart.yaml` and moves with the chart's content — the deploy repo's overlay names it, so a release that changes the chart without bumping the version names a release the cluster is not running (Flux itself ignores the field for a Git-path source: the install decision is the source's artifact digest). Keycloak custom theme ships at runtime (ConfigMap tarball + initContainer — `make keycloak-theme` to regenerate; CI guards drift).

The live map of what shipped, what was superseded and what remains is [`docs/charts/migration-status.md`](../docs/charts/migration-status.md); the design of record is [`docs/charts/helm-charts-design.md`](../docs/charts/helm-charts-design.md).

## Cluster prerequisites

Operator controllers (CNPG with a CRD serving `postgresql.cnpg.io/v1`, kube-arangodb 1.4.x, sealed-secrets ≥0.40, keycloak-operator 26.x, OpenTelemetry Operator) are cluster bootstrap prerequisites — installed once per cluster, before any release. Per-release operator installs would create competing cluster-scoped controllers. `scripts/install-prereqs.sh` automates the set. Conditional prerequisites: cert-manager (only when `ingress.tls.enabled` with an issuer), GPU operator (only when `opea.gpu.mode=in-cluster`), grafana-operator 5.25.0 (only when `observability.grafana.enabled=true`; `./scripts/install-prereqs.sh --with-grafana` adds it). The Envoy Gateway is NOT a prerequisite — it ships as a chart dependency (`envoyGateway.enabled`, default on).

A policy-enforcing CNI must also let **node-to-pod traffic through on the health port**. The OTel operator probes its collectors on the health extension (13133), and kubelet sends that probe from the node — a peer no `namespaceSelector` can name, so the chart cannot admit it in the collectors' NetworkPolicy. Calico and kube-router allow it unconditionally; a CNI that defaults to denying host-to-pod (Cilium with `--allow-localhost=policy`) leaves the collector pods permanently un-Ready, which stalls the whole observability tier. Verify on any new cluster with `kubectl -n genieai get pods -l app.kubernetes.io/managed-by=opentelemetry-operator`.

A laptop cluster additionally needs a **policy-enforcing CNI**: minikube's default (kubenet) stores the chart's NetworkPolicies and never applies them, so a broken egress graph stays invisible. `scripts/laptop-cluster-bootstrap.sh` builds the whole cluster (`--cni=calico`) and restores the state that lives only inside a cluster — the sealed-secrets key, the Flux PAT, the selfsigned issuer. The procedure, the installation order and the SealedSecret/SOPS split are documented in [`docs/charts/laptop-cluster-bootstrap.md`](../docs/charts/laptop-cluster-bootstrap.md).

## CI gates

Four merge-blocking jobs run on every MR that touches the chart. The
`chart:install` job is **manual** (a full install pulls ~20 GB and takes
~30 min on the shared runner pool — not tenable per push; it stays
available on demand, on any branch).

| Job | What it proves |
|---|---|
| `chart:lint` | `helm lint --strict`, a strict YAML parse of `values.yaml` and of four renders (default, full, prod, in-cluster GPU) that rejects duplicate mapping keys, `kubeconform` on each, the NetworkPolicy ingress/egress cross-check, and the boolean-leaf schema check. It also guards the two vendored copies the chart carries: the realm file (`configs/keycloak/genie-realm.yaml`) and the Grafana dashboards + alert rules (`configs/grafana/provisioning/`, `make chart-dashboards` to re-sync) — a copy without a guard drifts silently, and the compose deployment and the Kubernetes deployment then answer the same question differently. |
| `chart:contract` | Renders with overlay-shaped values and asserts the operator-facing contract: the OTel collector's service names, the PII redactor smoke test, the keycloak-config-cli image. |
| `chart:crd-validate` | A kind cluster with the operator CRDs installed; every rendered object goes through `kubectl create --dry-run=server`, so a custom resource is checked against the CRD that will own it. Renders the laptop shape AND the prod shape with TLS — the prod profile is the only one that emits a PodDisruptionBudget, and `ingress.tls.enabled` the only one that emits a Certificate. |
| `chart:parity` | Compares the rendered chart against `docker-compose.yaml` variable by variable, with a floor on how many variables were actually compared and a source-level check of every `notRead` claim. |

Local equivalents:

```bash
helm lint charts/genieai-umbrella --strict
make -C charts lint
make -C charts template          # writes /tmp/genieai-rendered.yaml
```

A byte-diff of the render against a captured baseline is a good habit for
refactors (the render is the operator-facing surface, and it is what
`helm upgrade` will apply):

```bash
make -C charts template && cp /tmp/genieai-rendered.yaml /tmp/baseline.yaml
# after an intentional change:
make -C charts template && diff -u /tmp/baseline.yaml /tmp/genieai-rendered.yaml
```

`ct lint` / `ct install` are **not** wired: a full `ct install` suite and a
kind+Calico install gate (the CNI that enforces the NetworkPolicies) are
still to come. `helm test` smoke jobs run inside the manual `chart:install`
job.

## Conventions

- Helm API v2, Helm 3.16.x (CI pins dtzar/helm-kubectl:3.16.0).
- No secrets in `values.yaml` or `values-override.yaml`. Secrets are operator-materialized (SealedSecret, External Secrets Operator, SOPS, manual, etc.).
- Tests live in each chart's `templates/tests/` (Helm convention).
- The application namespace is **not** a chart resource. The chart renders only the observability
  namespace (`genieai-obs`); the application namespace belongs to the deploy repo's Kustomization, so a
  failed install does not delete it and take the SealedSecrets with it. A `helm install` outside Flux must
  create it first (`-n <ns> --create-namespace`).
- Vendored dep tarballs are generated, not tracked — run `make -C charts deps` after cloning or dep changes. `Chart.lock` IS tracked.
- Hook Jobs live in `templates/hooks/*.yaml` with explicit `helm.sh/hook` annotations (phase + weight). The subdirectory is organizational; Helm scans `templates/` recursively.
- Hook + test-pod init containers download `kubectl` from public release URLs (nothing else — no jq). Set `global.kubeletToolsMirror` for air-gapped clusters.
- NetworkPolicy: every rendered service gets a default-deny + explicit allowlist policy. The OPEA model Deployments get ingress-only policies; orchestrators see per-peer egress rules scoped to the call graph.
- PodDisruptionBudget: only emitted when `replicas >= 2`.

## Other directories

- `deploy/environments/` — empty; per-environment overlays live in the
  `genie-ai-deploy` repo under `overlays/<pays>/<env>/` and are applied by
  Flux, not from this tree (see `deploy/environments/README.md`).
- `docs/charts/` — dev-internal reference docs (operator selection, migration playbooks).