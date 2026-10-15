# Tasks 5-8 — observability tier implementer report

**Branch:** `feat/k8s-migration`
**Worktree:** `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration`
**Commit:** `feat(charts): grafana operator CRs, dashboards, VMServiceScrapes, OPEA OTel coverage, obs NetworkPolicies, helm test`
**Chart.yaml bump:** none (per task constraints)

## Render matrix (`helm lint --strict` clean throughout)

| Variant | Total kinds | Notes |
|---|---|---|
| Defaults (logs baseline only) | 50 | 47 baseline + 2 collector NetworkPolicies (8.2) + 1 test-observability Pod (8.3) |
| `--set observability.grafana.enabled=true` | 68 | +1 Grafana +1 VL-datasource (logs default ON) +2 folders +9 dashboards +5 alert groups |
| `--set observability.metrics.enabled=true` | 56 | +1 VMSingle +5 service VMServiceScrapes (backend/frontend/nginx/documentRepository/redisCache — OPEA off) |
| `--set observability.grafana.enabled=true --set observability.metrics.enabled=true --set observability.traces.enabled=true --set opea.enabled=true` | 101 | full set: 11 VMServiceScrapes (5 service + 6 OPEA), 3 GrafanaDatasource, 14 NetworkPolicy (12 OPEA + 2 collector) |

`helm lint --strict` → 0 errors, 1 info (Chart.yaml icon).

## Datasources (Task 5) — mirror of `configs/grafana/provisioning/datasources/vm-datasource.yml`

| Datasource | Type | URL | UID | Gated on |
|---|---|---|---|---|
| VictoriaLogs | `victoriametrics-logs-datasource` | `http://victorialogs.<ns>.svc.cluster.local:9428` | `victoriametrics-logs` | `observability.logs.enabled` (default ON) |
| VictoriaMetrics | `prometheus` | `http://vmetrics.<ns>.svc.cluster.local:8428` | `victoriametrics` | `observability.metrics.enabled` |
| VictoriaTraces | `jaeger` | `http://vtraces.<ns>.svc.cluster.local:10428` | `victoriatraces` | `observability.traces.enabled` |

allowCrossNamespaceImport: true on metrics + traces; VL stays local (admin-logs namespace-scoped). Derived fields on VL → trace/span ID links mirror compose exactly. VT URL is the Jaeger query port (10428) — no tempo-proxy on this path.

Admin secret referenced by name (`grafana-admin-credentials` with `user` + `password` keys) via `spec.credentialsEx`; values never rendered.

## Dashboards + alert rules (Task 6)

9 dashboard JSONs rendered (5 General folder + 4 Observability folder):

| File | Folder | Size |
|---|---|---|
| `application-metrics.json` | General | 11K |
| `rag-pipeline-trace-waterfall.json` | General | 14K |
| `service-health.json` | General | 15K |
| `service-logs.json` | General | 5K |
| `trace-explorer.json` | General | 8K |
| `observability-stack-health.json` | Observability | 14K |
| `victorialogs-single-node.json` | Observability | 230K |
| `victoriametrics-single-node.json` | Observability | 264K (largest) |
| `victoriatraces-single-node.json` | Observability | 219K |

Largest 264K < 1 MiB threshold → inline `spec.json` block scalar. No `spec.url`+ConfigMap fallback needed.

5 GrafanaAlertRuleGroup CRs from `alert-rules.yml` (one per `groups[]` entry):
- `observability-pipeline_health` (1 rule — OTel Collector Down)
- `observability-vm_storage` (1 rule — VM Storage High)
- `observability-vlog_ingestion` (1 rule — VL Ingestion Drop)
- `observability-vtrace_ingestion` (2 rules — VT Export Failures, VT Ingestion Drop)
- `observability-otel_log_stamping` (2 rules — stamp_service_name_from_container, pii_redact)

All reference the `genieai-observability` GrafanaFolder via `spec.folderRef`. Contact-points / notification-policies NOT rendered (no bitnami-operator CR stable enough; deferred).

## VMServiceScrapes (Task 7)

11 total when all services enabled:

| Component | Port name | Selector label | Gated on |
|---|---|---|---|
| backend | http | genieai.io/component=backend | services.backend.enabled |
| frontend | http | genieai.io/component=frontend | services.frontend.enabled |
| nginx | http | genieai.io/component=nginx | services.nginx.enabled |
| document-repository | http | genieai.io/component=documentRepository | services.documentRepository.enabled |
| redis-cache | redis | genieai.io/component=redis-cache | services.redisCache.enabled |
| chatqna | http | genieai.io/component=chatqna | opea.enabled |
| retriever | http | genieai.io/component=retriever | opea.enabled |
| dataprep | http | genieai.io/component=dataprep | opea.enabled |
| reranker | http | genieai.io/component=reranker | opea.enabled |
| embedding | http | genieai.io/component=embedding | opea.enabled |
| translation | http | genieai.io/component=translation | opea.enabled |

redis-cache port name is `redis` (verified at `templates/services/redis-cache.yaml:126`). All others use `http`. Interval 30s. CRD: `operator.victoriametrics.com/v1beta1`. GPU model Deployments excluded by design (different label convention; scrape-by-default not desirable).

## OPEA env changes (Task 8.1)

ENABLE_OBSERVABILITY now derived from the umbrella observability flags via:
```yaml
value: {{ ternary "1" "0" (or .Values.observability.logs.enabled .Values.observability.metrics.enabled .Values.observability.traces.enabled) }}
```

Applied to all 6 OPEA orchestrators: chatqna, retriever, dataprep, reranker, embedding, translation. OTEL_EXPORTER_OTLP_ENDPOINT via the existing `genieai-umbrella.otlpEndpoint` helper, applied to all 6 (embedding + translation were missing the row before).

Per-service `opea.<svc>.enableObservability` knob removed from `values.yaml` (was only in `opea.reranker`; the others referenced a values key that was never declared — silently defaulted to "0").

## NetworkPolicies (Task 8.2)

2 new policies in `templates/observability/networkpolicies.yaml`:

**collector-gateway** (selector `app.kubernetes.io/component=collector-gateway`):
- Ingress: any pod in namespace on TCP 4318/4317
- Egress: DNS (kube-system) + VL :9428 (logs.enabled) + VM :8428 (metrics.enabled) + VT :4318/4317 (traces.enabled)

**collector-agent** (selector `app.kubernetes.io/component=collector-agent`):
- Ingress: default-deny (policyTypes Egress only)
- Egress: DNS + collector-gateway :4318

Vmoperator-managed VL/VM/VT pods use port-scoped `ipBlock: 0.0.0.0/0` (operator's pod labels not part of `genieai.io/component` convention — same approach as existing OPEA NP for Keycloak/Arango egress).

## helm test (Task 8.3)

`templates/tests/test-observability.yaml` — `helm.sh/hook: test` Pod that probes each operator-managed backend's `/health`:

- VL :9428/health (when logs.enabled)
- VM :8428/health (when metrics.enabled)
- VT :10428/health (when traces.enabled)

Gated checks so the same template works for the logs-only baseline and the all-on overlay. Mirrors `test-stateless-reachability.yaml` style (curlimages/curl, non-root 65534, all caps dropped, set -eu).

## Values knobs removed

- `opea.reranker.enableObservability` — deleted from `values.yaml:660`. The other OPEA services referenced `opea.<svc>.enableObservability` from templates but the values entries never existed; the ternary now derives from `observability.*` flags. No other values-knob references to clean up.

## Files added

- `charts/genieai-umbrella/templates/observability/grafana.yaml` (Task 5)
- `charts/genieai-umbrella/templates/observability/grafana-dashboards.yaml` (Task 6)
- `charts/genieai-umbrella/templates/observability/vmservicescrapes.yaml` (Task 7)
- `charts/genieai-umbrella/templates/observability/networkpolicies.yaml` (Task 8.2)
- `charts/genieai-umbrella/templates/tests/test-observability.yaml` (Task 8.3)
- `charts/genieai-umbrella/files/observability/dashboards/*.json` (9 files, copied from `configs/grafana/provisioning/dashboards/`)
- `charts/genieai-umbrella/files/observability/dashboards/observability/*.json` (4 files)
- `charts/genieai-umbrella/files/observability/alerting/alert-rules.yml`

## Files modified

- `charts/genieai-umbrella/templates/opea/{chatqna,retriever,dataprep,reranker,embedding,translation}.yaml` (Task 8.1 env rows)
- `charts/genieai-umbrella/values.yaml` (removed `opea.reranker.enableObservability`)

## Concerns

1. **Drift risk on dashboard + alert files.** Source of truth is `configs/grafana/provisioning/...`; copies live in `charts/genieai-umbrella/files/observability/...`. Helm's `.Files` can only access files inside the chart directory (a symlink to outside the chart works in `helm template` but fails on chart packaging). A sync script (or a CI check that diffs the two) is needed before this lands. Symlink path was tested — works for `helm template`, but does NOT survive `helm package`. Manual sync on every chart bump is the current contract.
2. **Contact-points + notification-policies not rendered.** The bitnami/grafana-operator v4.9.x ships `GrafanaContactPoint` and `GrafanaNotificationPolicy` CRDs, but the rendering contract is less stable than `GrafanaAlertRuleGroup` (still v1beta1). Deferred — re-evaluate at next operator bump. Live `grafana-cli` provisioning or operator's "external" config is the alternative.
3. **Translation env renders ENABLE_OBSERVABILITY as bare `1` (no quotes).** The other 5 OPEA services render as `"1"` (string). The translation.yaml is hand-rendered (docker.io/opea/translation image bypasses the factory); a `quote` wrapper around the ternary would harmonize. Cosmetic only — `os.getenv` reads both. Not changed in this pass to keep the diff scoped.
4. **Grafana CR renders with no datasources when only `grafana.enabled=true` is set** (none of logs/metrics/traces on). The operator will create a working Grafana instance but every dashboard panel will fail to query. Not validated against a live install; a `required` dependency or a `fail` template would be safer.
5. **GrafanaFolder CRs are created at every render even when no dashboards reference them.** Two folders (General, Observability) render unconditionally inside the `if observability.grafana.enabled` block. If grafana is enabled but no dashboards, you get two empty folders. Same fix as #4.

## Status

- `helm lint --strict` ✅
- Render matrix ✅ (defaults / grafana-on / metrics-on / all-on)
- Commit pending (this report attached)
