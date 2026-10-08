# K8s-Native Audit — GENIE.AI Helm Migration

**Date:** 2026-10-08 · **Principle (user-mandated):** always prefer Kubernetes-native mechanisms (operators, CRs, standard APIs) over bespoke Deployments or hand-rolled plumbing. Any deviation must be recorded here with rationale.

**Usage:** this file is the review gate for Plans 4–8. A plan adding a bespoke component must either cite its row here or amend this audit first.

---

## Scoring legend

- **operator-native** — managed by a dedicated operator via CRDs (best)
- **api-native** — plain standard K8s API objects, no controller needed (Service, Job, NetworkPolicy, PDB, Gateway API, Helm hook Jobs)
- **chart-tier** — upstream/community helm chart for a stateless or self-contained component (acceptable)
- **bespoke** — custom Deployment/Service we author and maintain (requires justification)

## Audit table — full chart surface

| Layer | Component | Mechanism | Tier | Notes / deviation rationale |
|---|---|---|---|---|
| Data | PostgreSQL (keycloak-db) | CloudNativePG operator (`Cluster` CR) | operator-native | — |
| Data | ArangoDB | kube-arangodb operator (`ArangoDeployment` CR) | operator-native | single-node default; cluster via clusterProfile |
| Data | Keycloak | official keycloak-operator (`KeycloakRealm` CR) | operator-native | — |
| Data | Redis (Group 2 — **pending plan**) | TBD | — | decide at plan time: plain chart-tier StatefulSet acceptable for ephemeral cache; official Redis operator only if HA/persistence required |
| Secrets | sealed-secrets controller | Bitnami chart (deploys controller) + `SealedSecret` CRs | operator-native | controller = operator pattern; CRs consumed natively |
| Obs | VM/VL/VT | vmoperator (`VMSingle`/`VMCluster`, `VLSingle`, `VTSingle`, `VMAgent`, `VMRule`, `VMAlertmanager` CRs) | operator-native | alerting migrates Grafana-rules → `VMRule` CRs |
| Obs | OTel collectors | opentelemetry-operator (`OpenTelemetryCollector` CRs: gateway Deployment + agent DaemonSet) | operator-native | config ported verbatim (see otel-migration.md) |
| Obs | Grafana + 9 dashboards + datasources | **grafana-operator v5** (`Grafana`, `GrafanaDatasource`, `GrafanaDashboard` CRs) | operator-native | **changed 2026-10-08** from grafana-subchart+ConfigMap-sidecar; operator is official (grafana org), chart 5.22.x |
| Obs | Traces query in Grafana | Grafana Jaeger datasource → **VT direct** (VT implements Tempo HTTP API natively) | api-native | **tempo-proxy REMOVED** — Swarm vestige; verified docs.victoriametrics.com/victoriatraces/querying/grafana/ |
| Obs | Log shipping | OTel agent DaemonSet (filelog) → gateway → VL | operator-native | `VLAgent` CRD alternative REJECTED: bypasses gateway's single PII/stamp transform point |
| Obs | App instrumentation | manual SDK init (`tracing.js`, `tracing.py`) | **deviation** | operator auto-instrumentation (`Instrumentation` CR) REJECTED: cannot reproduce the product span taxonomy (`dataprep.llm.label_batch`, `with_span`, …) the dashboards depend on. Deliberate, documented. |
| Ingress | Edge | Envoy Gateway (`Gateway`/`HTTPRoute` — Gateway API) | api-native | v1.9; K8s 1.33+ prerequisite; research docs/charts/envoy-gateway-state-of-art-2026q4.md |
| Ingress | Request tracing at edge | Envoy tracing policy (Gateway API extension) | api-native | replaces Kong OTel plugin |
| Ingress | Kong | opt-in plug-point (default off) | chart-tier | **pending user confirm** — demotion per Envoy research |
| App | SPA static server (nginx) | chart-tier Deployment | chart-tier | acceptable: it is a static file server; no operator exists worth its weight |
| App | backend / documentRepository / clamav / Group 6 AI services | service-factory Deployments | api-native | the product itself — bespoke by nature, standard APIs used throughout (PDB, NetworkPolicy, probes) |
| App | GPU | NVIDIA GPU Operator | operator-native | Plan 5 |
| Policy | PDB, NetworkPolicy, PSA labels, RBAC | standard APIs | api-native | — |
| Lifecycle | init/migrations | Jobs + Helm hook annotations | api-native | — |
| GitOps | sync | ArgoCD `Application` CR / Flux CRs; KAS as CI bridge | api-native | chart stays GitOps-agnostic |

## Decisions log

1. **tempo-proxy removed** (2026-10-08). VT ships Tempo HTTP API; Grafana Jaeger datasource points at `vtraces.<ns>.svc:10428` directly. Service count 30 → 29; Group 1 = 5.
2. **grafana-operator adopted** (2026-10-08). Official org, v5 (chart 5.22.x), CR-managed instances/datasources/dashboards. Dashboards port as `GrafanaDashboard` CRs from the existing 9 JSON files.
3. **Alerting → VMRule/VMAlertmanager CRs** (2026-10-08). Grafana-internal rules are not native; vmalert is the operator-native alerting path.
4. **Auto-instrumentation rejected** (2026-10-08). Span taxonomy is product semantics; auto-injection would silently drop it.
5. **VLAgent rejected** (2026-10-08). PII redaction + metadata stamping must stay in ONE place (gateway collector).
6. **Manual SDK init retained** (2026-10-08). Same rationale as 4.

## Review rule

Plans 4–8: every new Deployment the chart renders must map to a row above. New bespoke additions → amend this audit first (PR-reviewable decision), then the plan.
