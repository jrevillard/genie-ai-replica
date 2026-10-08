## Code-review consolidation — applied

`/code-review` xhigh pass across spec + 5 plans. 15 ranked findings, all applied:

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | Helm template syntax (`{{ .Values.namespace }}`) written into values.yaml — values files are never templated; every cross-service URL would ship as literal text | Plan 3: cross-service URL helper + per-service Deployment templates |
| 2 | Namespace rendered as a regular resource — pre-install hooks target a namespace that does not exist yet on a fresh cluster | Plan 1: Namespace as `helm.sh/hook: pre-install,pre-upgrade, hook-weight: -40` (first in the chain) |
| 3 | genie-ai-nginx image's baked-in upstream is `/api -> Kong`; Kong removed | Plan 3 Task 1b Step 5: per-instance ConfigMap override mounts `/etc/nginx/conf.d/override.conf` (SPA + /api + /uploads routing) |
| 4 | DocumentRepository PVC for uploads persistence missing | Plan 3 Task 1b Step 4: PVC template + factory passthrough for `volumeMounts: [{name: uploads, mountPath: /app/uploads}]` |
| 5 | `_pdb-bundler.yaml` (underscore prefix) — Helm skips it, no PDB ever rendered | Sweep across all plans: `templates/_<dir>/` → `templates/<dir>/`, `_<filename>` → `<filename>` (the same trap affected all live-template subdirs in Plans 2-5) |
| 6 | Backend envFrom gains `vllm-api-key`, but the SealedSecret is gated on `ai.enabled` — same Day-0 crashloop class as the earlier `keycloak-proxy-client-secret` issue | Plan 5 Task 6: vllm-api-key + kc-dataprep + keycloak-proxy all gate only on `secrets.sealedSecrets.enabled` (not on `ai.enabled`) |
| 7 | Plan 5 references `factory passthrough via podSecurityContext` but the factory extension list has no podSecurityContext — GPU pods cannot write the RWX PVC on first download | Plan 5: factory gains `podSecurityContext` passthrough; vllm + vllm-translation merged dicts carry `fsGroup: 1000`; tei + tei-reranker carry `fsGroup: 100` |
| 8 | cloudnative-pg pin `~> 0.22.0` in Plan 2 Chart.yaml contradicts spec §4 + Global Constraints (`~> 0.30.0`) | Plan 2 Task 1: unified to `~> 0.30.0` |
| 9 | Remote-GPU fail-fast nested the optional-URL checks inside the base-URL guard — when `vllmUrl+teiEmbeddingUrl` are set, missing `teiRerankingUrl`/`vllmTranslationUrl` are silently accepted | Plan 5 Task 8: each URL check sits at the outer if-level (independent gates) |
| 10 | All VictoriaMetrics endpoints hardcode the single-node service (`vmetrics:8428`); prod profile renders VMCluster whose operator-created Services are `vmetrics-vminsert`/`vmselect`/`vmstorage` | Plan 4: VMAgent remoteWrite + Grafana datasource ternary on `clusterProfile` (vmselect:8481 + vminsert:8480 in prod) |
| 11 | Plan 4 verification commands render with only `--set clusterProfile=prod`; observability templates gate on `observability.*.enabled` (static false) | Plan 4: every prod-profile verifier prepended with `--set observability.enabled=true --set observability.metrics.enabled=true --set observability.logs.enabled=true --set observability.traces.enabled=true --set observability.otel.enabled=true` |
| 12 | SealedSecret encryptedData carries `PLACEHOLDER_*_SEALED_KID` — underscores outside the base64 alphabet; controller fails to decrypt, never materialises the K8s Secret; helm test always fails on a fresh kind install | Plan 2 + Plan 5: placeholders replaced with `UExBQ0VIT0xERVIr` (base64 of "PLACEHOLDER+"); chart-side conftest (Plan 7) fails release branches that ship them. Re-seal with `kubeseal` before `helm install` |
| 13 | ArangoDeployment PVC renders `storageClassName: {{ .Values.pluggable.storageClassName | default "" }}` — empty-string pin (same trap the CNPG template guards against) | Plan 2 Task 9: `{{- with .Values.pluggable.storageClassName }}` guard in both single + cluster modes |
| 14 | Group-5 reachability test uses `/` for document-repository (returns 404) and HTTP against the binary clamd port (hangs); can never pass | Plan 3 Task 9: document-repository check uses `/health`; clamav check uses `bash -c "echo > /dev/tcp/clamav/3310"` (TCP probe) |
| 15 | `email-password` SealedSecret is rendered but no service's envFrom ever references it — EMAIL_PASSWORD never reaches the backend | Plan 3 Task 1b Step 3: add `email-password` to backend's `secrets:` list |

# Plan Defect Ledger — Helm Migration Docs

Tracks every finding from the adversarial review rounds against the spec +
Plans 1-4 (`docs/superpowers/specs/` + `docs/superpowers/plans/`), its
disposition, and the items deliberately left OPEN for later plans. Nothing
here is speculative: each row cites where the fix landed or where the work
is assigned.

Wave 6 = 2026-10-08 consolidation review (15 ranked findings + verified
cut-notes). Waves 1-5 = per-plan review rounds already applied at their time.

## Wave 6 — fixed in this commit

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | dep-check evaluator: service deps resolved as data deps (default installs always failed); `\| default true` flipped explicit disables; `enabled.json` nil-pointered (Plan 2 values had no `services:` block) | Plan 2 Task 6: `dep_enabled()` resolves each dep against graph namespaces; both tiers validated; `enabled.json` rewritten with `dig` + fail-safe `false` |
| 2 | pre-install hooks depended on non-hook resources (SA/CRB/ConfigMap install AFTER hooks) → first-install deadlock | Plan 2 Task 4a + Task 6: RBAC = hook weight `-30`, dep-graph ConfigMap = hook weight `-20`; hooks ordered before the Jobs |
| 3 | `KeycloakRealm` CRD does not exist; no Keycloak instance CR ever rendered → identity tier dead | Plan 2 Task 8 rewritten: `Keycloak` CR (CNPG `keycloak-db-rw` backed) + `KeycloakRealmImport` CR; RBAC updated to real CRDs |
| 4 | `victoria-logs-operator` / `victoria-traces-operator` charts don't exist → `helm dep update` fails | Plan 4 Task 1: single `victoria-metrics-operator` chart (ALL VM/VL/VT CRDs); spec §4 row consolidated |
| 5 | keycloak-operator helm repo URL serves no index (301→404); CNPG pin contradiction 0.22 vs 0.30 | Spec §4 + Plan 2 Task 1: keycloak-operator = cluster bootstrap prerequisite (OLM/static YAML), NOT a chart dep; CNPG unified `~> 0.30.0` |
| 6 | `{{ include }}` written into values.yaml (never templated) | Plan 4 Task 2: static booleans; profile logic template-side only (Task 8 simplified); render assertions |
| 7 | ct.yaml invented nested schema + nonexistent `kubeVersion` key | Plan 1 Task 10: real flat chart-testing config; kube version pinned via kind image + `ct install --kube-version` CLI |
| 8 | chart Namespace + `--create-namespace` collision | Plan 1 Task 12: flag dropped; chart renders its own Namespace |
| 9 | NetworkPolicies invalid ×4 (`host:` peer, `name: kube-system` label, unmatchable `component: ingress`, guessed operator labels) | Plan 3: `kubernetes.io/metadata.name`, same-ns peers for v1, port-scoped `ipBlock` egress to data tier; label-verified peers → Plan 6 |
| 10 | cross-service port addressing (container ports used as Service ports); `OTEL_EXPORTER_OTLP_ENDPOINT` never set | Plan 3: all in-cluster URLs → Service port 80; OTEL endpoint env added to backend + documentRepository |
| 11 | image repos `genieai-*` (nonexistent), frontend 8080 vs 8090, stock nginx vs `genie-ai-nginx`, KEYCLOAK_URL missing `/auth` | Plan 3 Task 1 + Task 5 rewrite: `genie-ai-*` repos, 8090, project nginx image (no ConfigMap), `/auth` suffix |
| 12 | SealedSecret wiring: dot-in-range render bug, envFrom ns-prefix mismatch, keys ≠ env var names, camelCase k8s name | Plan 2 Task 11 + Plan 3 Task 7 + Plan 4 Task 10: `$` in range, plain names, encryptedData keys = env var names, `grafana-admin-password` |
| 13 | CNPG `postgresConfig` invalid field; initdb secret missing `username`; ServiceMonitor needs absent Prometheus operator; VMSingle port 8429 | Plan 2 Task 5 (`postgresql:`, username+password secret); Plan 4 Task 7 VMServiceScrape; ports → 8428 everywhere |
| 14 | PDB generator nil-pointer on `podDisruptionBudget: null` | Plan 3 Task 8: single flat `and` guard (short-circuits on null) |
| 15 | §8 retraction contradictions (§16.1 + Plan 2 re-asserted fabricated CVEs/rotation); missing VLLM_API_KEY + TRANSLATION_CACHE_PASSWORD rows | Spec §8 rows added, §16.1 corrected; Plan 2 constraints/RF5/README scrubbed of CVE ids + 30-day claim; `hr/` annotate examples → namespace annotations |

Cut-notes also fixed here: collector image 0.111.0 → 0.152.0 (running-stack
parity), collector Service name `genieai-collector-collector` in test,
`--server.endpoint=arangodb://` invalid scheme arg dropped, `kubectl apply`
with `generateName` → `kubectl create event`, helm-test pod kubectl+SA,
umbrella `.helmignore` no longer strips vendored deps/lock (OCI installability),
ArgoCD scp-like repoURL syntax, service counts unified 28, §13.3 drift script
rebased to newly-introduced-keys semantics.

## Wave 7 — Plan 5 first review (fixed in 90fdf4b55)

5 Critical + 12 Important + 11 Minor on the new AI/ML plan, all applied:
factory component-derivation + probe guards (C1/C2), ARANGO creds +
secretKeyRef (C3), chatqna LLM/translation env completed (C4),
keycloak-proxy secret decoupled from ai.enabled (C5), NP matrix + remote-443
egress (I1), TEI non-root port + /data cache mount + fsGroup (I2), backend
AI wiring (I3), bearer-vs-HF-token split (I4), evaluator svc_enabled rewire
(I5), env tables transcribed compose-verbatim with re-point/values-exposed
markers (I6-I8), ui/nginx images + ports (I9), vLLM args + GPU-compose knob
precedence (I10), GPU-operator spec reconciliation + audit decision 8 (I11),
consumer-gated remote fail-fast (I12). Verdict was "No"; post-fix the plan's
render-blocking and functional-dead paths are closed.

## OPEN — assigned to future plans

| Item | Owner | Note |
|------|-------|------|
| db-migrations Job (backend schema bootstrap at upgrade) | Plan 6 | Needs the backend's migration entrypoint contract; render as helm pre-upgrade Job |
| document-repository PVC (uploads persistence) | Plan 6 | `services.documentRepository.pvc` exists in values; template + storageClass + backup story needed |
| NetworkPolicy label-verified peers (CNPG/kube-arangodb/keycloak operator pods; Envoy Gateway namespace) | Plan 6 | Replace port-scoped ipBlock egress + same-ns ingress with real selectors after live `kubectl get pods --show-labels` inspection |
| Kyverno cosign `publicKeys` real syntax (inline PEM / ConfigMap injection — NOT `secret:...#key`) | Plan 7 | Three failed attempts logged; verify against Kyverno verify-images docs before writing the policy |
| conftest placeholder sweep + PII rule lint | Plan 7 | Fails release branches carrying `PLACEHOLDER_*_SEALED_KID` |
| PII smoke test K8s port (`tests/otel-collector/run-pii-smoke.sh` assumes docker) | Plan 7 | kind-based equivalent |
| `genieai-common.fullname` collision check (release named `genieai` ⇒ `genieai-genieai-*`?) | Plan 1 execution | First `helm template` run must eyeball rendered names |
| CNPG chart line verification (`~> 0.30.0` tracks operator 1.30) | Plan 2 execution | `helm search repo cloudnative-pg` at execution time; pin rationale: no assumption that chart minor == operator minor |
| ArangoDB `arangodb-single` service consumer URLs vs operator-created Service naming | Plan 5/6 execution | Chart-side name matches the Plan 2 CR (annotated in Plan 5 Task 11), but the kube-arangodb-created SERVICE name stays unverified until first live render |
