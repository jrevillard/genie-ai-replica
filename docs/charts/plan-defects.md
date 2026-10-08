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
| ArangoDB `arangodb-single` service consumer URLs vs operator-created Service naming | Plan 5/6 | Verify the kube-arangodb-created Service name matches `arangodb-single.<ns>:8529` used in backend env |
