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

## Wave 9 — Plan 1 review rounds 1-2 (fixed on this branch)

Two independent reviewer passes over b1c9dde99..b4b202ba8. Verdicts "With
fixes"; all findings applied or dispositioned:

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | `charts/Makefile` doubly broken: `lint: $(addprefix lint-,$(CHARTS))` expands to `lint-genieai-common` but rules are `lint-common` (no rule to make target), and recipes use repo-root-relative paths while the Makefile lives in `charts/` — `make lint`/`make test` never worked | Rewritten: short CHARTS list, chart-relative paths, `--strict` on lints, ct schema/lintconf flags + `--kube-version 1.33.0` in `test-umbrella`, new `deps` target; verified `make lint` + `make template` green from `charts/` |
| 2 | Plan 2 Task 1 Step 2 re-added `import-values: {child: ., parent: common}` — would reintroduce the Wave-8 #1 clash | Plan 2 amended (dep block mirrors shipped Chart.yaml, ledger pointer) |
| 3 | Plan 2 clusterprofile-detect hook (-10, pre-install) polls the ns label — never present on fresh installs (Namespace is a regular resource, applies AFTER hooks); 30s burn + WARN every time | Plan 2 Task 7 amended: pre-upgrade only, 3×2s poll, mismatch-only Event, `--set` documented as the fresh-install source of truth |
| 4 | `charts/.gitignore` rules inert — tarball + Chart.lock tracked | `git rm --cached` both; `make deps` regenerates; charts/README documents the flow |
| 5 | ArgoCD example: prune deletes ns+PVCs with the future pre-delete helm gate never firing (GitOps applies manifests, no helm lifecycle); `project: genieai` needs a pre-existing AppProject not listed | Example header: LIMITATION block (ArgoCD-native protection needed for GitOps mode) + AppProject precondition |
| 6 | library README Usage taught the dropped import-values pattern; schema description stale; nameOverride maxLength 50 vs helper trunc 63 | Round-1 fixes: README rewritten, description rewritten, maxLength 63 |
| 7 | Spec §3/§743 prose still mandates import-values | Spec §3 amended with decision + ledger pointer (round 1) |
| 8 | Test pod asserts only SA namespace, not the ns labels (plan interface claimed label assertion) | ACCEPTED as-is: alpine pod has no kubectl; label rendering is asserted by `helm template` inspection + the namespace itself is the object under test. Plan 1 interface text is aspirational |
| 9 | No umbrella values.schema.json (`namespace`/`clusterProfile` unvalidated) | DEFERRED to the tier that consumes more values (a one-key schema now buys nothing; `clusterProfile` enum lands with the Plan 2 profile hook) |
| 10 | charts/README said tests live in `tests/` | Fixed: `templates/tests/` |
| 11 | Plan 1 Self-Review stale: kubeVersion config key claim + .helmignore exclusion claim | Both corrected in the plan doc |

## Wave 8 — Plan 1 execution findings (Helm 4.3.0, fixed in this branch)

Found while executing the Foundation plan against helm v4.3.0 on kind 1.33.0.
All three stem from plan text authored against Helm 3 semantics:

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | Helm 4 injects the reserved `global` key into every subchart's coalesced values; the library schema's `additionalProperties: false` rejected it (`at '': additional properties 'global' not allowed`) — every `helm lint`/`template` of the umbrella failed even with an empty library values.yaml | Library schema declares a tolerant `global: {type: object}` property; `import-values: {child: ., parent: common}` dropped from umbrella Chart.yaml (import-values exports values only — templates stay callable via `{{ include }}`) |
| 2 | Namespace-as-pre-install-hook (wave-6 fix #2/#8) self-destructs on Helm 4: implicit `before-hook-creation` semantics delete the pre-existing namespace before applying the hook — including the one `--create-namespace` just made. Install reports `deployed`, then the release Secret dies with the namespace (`helm list -A` empty). Reproduced 3× live | `templates/namespace.yaml` is a regular resource; `--create-namespace` is required at install (flag re-undropped, documented in charts/README.md). Later plan hooks (RBAC -30, dep-graph -20) run after the flag provisions the ns. Validated: install + `helm test` Succeeded, PSA labels present, test pod PASS under `enforce=restricted` |
| 3 | ct v3.15 requires explicit `--chart-yaml-schema`/`--lint-conf` (no implicit defaults), yamale 6 syntax (`str()` validators, required-by-default), yamllint 1.38 dropped `min-spaces-after`/`key-order` options, and maintainer validation does live HTTPS to the git forge (fails x509 on self-hosted GitLab) | `charts/ci/chart_schema.yaml` + `charts/ci/lintconf.yaml` shipped; `validate-maintainers: false` in ct.yaml |

OPEN item from wave-6 ("genieai-common.fullname collision check") resolved:
release named `genieai` renders `genieai-genieai-umbrella-*` — valid (39 chars
< 50 truncation), ugly; charts/README.md advises avoiding `genieai*` release
names. No code change.

## Wave 10 — `/code-review` xhigh pass (post-Plan-1, plans 2-8 + spec)

Chart code itself verified clean (make deps/lint/template + ct lint from both
CWDs, helm v4.3.0). All 15 findings live in the planning docs future PRs
execute verbatim; two verified against primary sources. All applied:

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | Every OTLP endpoint in Plans 3/4/5/6/7 targets `genieai-collector.<ns>:4318`; the opentelemetry-operator actually names the Service `<cr>-collector` (verified: internal/naming/main.go) → all endpoints would NXDOMAIN silently | Fixed across observability/per-env/ai-ml/ci/group5 plans → `genieai-collector-collector` (matches shipped docs/charts/otel-migration.md, which had it right all along); plan comment that "corrected" the doubled form as wrong was itself backwards |
| 2 | Spec §14.1 + Plan 7 claim Kyverno uses `keys.keyData` and that `publicKeys` "is not in the schema" — inverted: CRD has 12× `publicKeys`, 0× `keyData` (verified); silent field pruning would kill verifyImages while appearing Enforced | Spec §14.1 + Plan 7 Task 3 reverted to `publicKeys:` with correction notes |
| 3 | Plan 3 `_cross-service-urls.tpl` arangoHost define closes 4× `{{- end -}}` for 2 opened blocks — unparsable | Fixed (2 ends) |
| 4 | Plan 2 sealed-drift hook greps nonexistent `sealedsecrets.bitnami.com/invalid` annotation AND its pre-install leg runs before regular-resource SealedSecrets exist (always vacuous on fresh installs) | Hook → pre-upgrade only; body reads `status.conditions[type=SealedSecretHasntDecrypted].status`; fresh-install sentinel detection moved to the Task 12 helm test |
| 5 | Plan 4 otel-agent ServiceAccount carries `helm.sh/hook: pre-delete` → SA never exists at runtime → DaemonSet pods fail admission, admin logs UI empty | SA de-hooked (regular resource; Helm GC handles uninstall) |
| 6 | Plan 3 Task 9 reachability test: unclosed nginx `{{- if }}`, clamav check nested inside nginx gate, `bash -c` TCP probe on curlimages/curl (no bash) | Template balanced + de-nested; clamav probe → curl telnet:// with exit-code semantics (6/7=fail, 28/0=open) |
| 7 | Plan 7 PII smoke script: `$PII_IP/$PII_HEX/$PII_UUID` unbound under `set -u`; JWT/APIKEY/LONGHEX/BEARER asserted but never injected (4/5 vacuous passes — same trap as the original docker-era test); marker-length-dependent hex/bearer padding | All five covered patterns injected + asserted; lengths padded to fixed sizes; IP/UUID dropped (not in rules) |
| 8 | Plans 3/4 still ship `PLACEHOLDER_<KEY>_SEALED_KID` (invalid base64; Wave 6 #12 purged only Plans 2/5); Plan 7 conftest can't catch that form | All → `UExBQ0VIT0xERVIr` (PLACEHOLDER+) incl. prose/self-review mentions |
| 9 | Plans 6/7/8 + foundation plan narrative still describe the ns-as--40-hook + `--create-namespace=false` (Wave 8 #2 regression in plan text) | Fixed in ci.md job (flag now `--create-namespace` + rationale), per-env ArgoCD `CreateNamespace=true`, docs.md install sequence, namespace-per-env item 3, foundation banner |
| 10 | Plan 7 Task 1 Step 2 would REPLACE the shipped Makefile (repo-root paths, nonexistent `lint-strict`, helm-docs as helm plugin) — reintroducing Wave 9 #1 | Step 2 → EXTEND with chart-relative additions; charts:lint job installs standalone helm-docs binary, runs `deps` first |
| 11 | Foundation plan body still mandates superseded patterns with no in-plan markers (agentic re-execution risk) | STATUS banner at plan top: task-by-task table of verbatim-vs-shipped deltas pointing at Waves 8-10 |
| 12 | Plan 6 contradictions: header scopes dev+prod but Task 1/4/Stats create staging/sovereign; Task 6 re-adds the dead `uninstallPolicy` values key the plan's own F9 fix killed | Scope banner + Task 1 files list pruned to dev/prod; Task 6 rewritten (annotation-only gate, dev=prod=1 render, doc-comment contract) |
| 13 | Plan 7 cosign signs `${REGISTRY}/genieai/umbrella:${CI_COMMIT_TAG}` but helm push publishes `.../genieai/genieai-umbrella:<chart-version>` | CHART_REF/CHART_VERSION derived from Chart.yaml at runtime; sign+verify target the real push ref |
| 14 | Plan 2 dep-check ClusterRole grants cluster-wide Secret read to an SA also mounted by helm-test pods → borrowed pod = full-cluster secret disclosure | Split: namespaced Role (secrets/configmaps/sealedsecrets/events) + minimal ClusterRole (namespaces + CRDs, no Secrets) + RoleBinding + ClusterRoleBinding |
| 15 | Plan 3 nginx config: Task 1b Step 5 renders `nginx-override` ConfigMap (wave-6 #3 Kong-leak fix) while Task 5 asserts NO ConfigMap exists — opposite instructions | Task 5 rewritten: override REQUIRED (baked upstream → removed Kong), Step 1 asserts ConfigMap presence via helm template |

Sub-cap items also fixed: dangling `<<<` heredoc in Plan 3 Task 1 Step 3;
Plan 6 `printf "%s-tls" host | default` guard that could never fire (→
secretName-first ternary); AppProject `clusterResourceWhitelist` entries
missing `kinds`; otel-migration.md rows 4-5 still described the superseded
ConfigMap-sidecar Grafana posture (→ grafana-operator CRs, Plan 4 owners).
Shipped-code nit fixed: test pod now renders `genieai.io/component: test`
(dict-override pattern, matching namespace.yaml).

## Wave 11 — `/code-review` xhigh round 2 (plans 2-8 + spec)

Chart code again verified clean. 14 findings, all in not-yet-executed plan
docs; one external fact verified against upstream cosign CLI docs. All applied:

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | SealedSecret `range` loops emit multiple docs with no `---` separator — iteration 2's apiVersion concatenates onto iteration 1's trailing comment; unparsable (Plan 2 Task 11 ×2, Plan 3 Task 7, Plan 4 Task 10) | `---` separator after each range opener (4 loops) |
| 2 | Plans 2-5 dereference `.Values.pluggable.storageClassName` + `.Values.ingress.host` before the values blocks exist (Plan 6) → nil-pointer on every lint/render from Plan 2 Task 5 on | Values keys declared in Plan 2 Task 2 (with rationale); Plan 6 merges instead of re-declaring |
| 3 | NP egress rules key on Service port 80; enforcement is post-DNAT → every Service-routed connection blocked under default-deny (group5 frontend/docrepo/nginx + Plan 5 model-server matrix) | All egress ports → pod ports (backend 3000, frontend 8090, docrepo 3001, vllm 8000, tei 8080) |
| 4 | Plan 5 Task 8 Step 2 fail-fast block: 4 ifs, 5 ends — unparsable when pasted into all 7 wrappers | Balanced |
| 5 | Plan 5 Task 2 Step 1b claims a genieai-common helper sets podSecurityContext — no such helper; Group-5 pods would fail PSA-restricted admission | `with`/`else` fallback emitting `seccompProfile: RuntimeDefault` at pod level |
| 6 | `arangoHost` keys on `data.arangodb.mode` only; the ArangoDeployment template auto-promotes single→cluster under prod/staging → consumer URLs NXDOMAIN in exactly the prod profiles | Helper mirrors the CR's promotion logic verbatim |
| 7 | Plan 7 Task 6 Step 1 rewrote `stages:` inserting a `charts` stage and omitting `charts-integration` → GitLab rejects the whole pipeline config | Step 6 now verifies Task 1's layout; no new stage |
| 8 | charts:lint ran conftest on fixtures designed to FAIL + helm-docs --check on hand-written READMEs → MR-blocking job permanently red | Gate tests real inputs only; fixture suite runs as an assert-expected-failure self-test; docs-check advisory |
| 9 | charts:integration installs the dev overlay with GPU services + registry.example.org refs → pods Pending forever, --wait 25m timeout, job never green | Job pins ai.enabled=false + remote-GPU mock URLs + data/secrets off until the overlay carries them |
| 10 | cosign key ref `env:COSIGN_KEY=$COSIGN_KEY` fabricated (shell-expands to `env:COSIGN_KEY=<entire PEM>` — invalid scheme AND key material in argv); documented form is `--key env://COSIGN_KEY` (verified upstream) | Spec §14.1 + Plan 7 (job, Review Focus, summary) all corrected |
| 11 | PII smoke: no positive control (empty VL response = vacuous pass), wrong wait label (`app.kubernetes.io/component` — chart uses `genieai.io/component`), install without `--set namespace=$NS` while exporters template it | Marker-present assertion gates the redaction checks; wait on `deployment/genieai-collector-collector` Available; namespace pinned |
| 12 | Rego rules vacuous: bare `input.data[k]` only true for literal `true` (never fires on strings); `$CI_` rule reads Pod-only `spec.containers` while chart emits Deployments | `!= ""` deref-and-assert; both container paths evaluated |
| 13 | group5 NP egress omitted OTLP 4318 + backend→docrepo despite injected OTEL endpoints → OTel pipeline silently dead at source | Ports added (4318 any-dest scoped, docrepo 3001 podSelector) |
| 14 | Plan 6 Task 6 told the executor to READ a pre-delete gate file no plan ever authors → spec §13.1 P0 protection never ships | Gate Job authored in Plan 6 Task 6 Step 1 (annotation-only switch) |
| 15 | Edge HTTPRoute split /api+/uploads→backend and /→frontend, contradicting spec §9 (`/*`→nginx) and bypassing the nginx tier incl. its override ConfigMap; /uploads pointed at a backend that doesn't serve it | Single `/`→nginx rule; nginx owns the path matrix |

Also this round: process rule enforced repo-wide after repeated violations —
NO wave/plan/task/review-focus references inside fenced code blocks of the
plan docs (they ship verbatim into charts/, CI files, and scripts). All
shipping blocks verified zero-ref; the foundation plan's historical blocks
are exempted by its SUPERSEDED banner. Sub-cap fixes: dangling `<<<` heredoc,
never-firing `printf|default` TLS-name guard, AppProject whitelist missing
`kinds`, otel-migration Grafana posture rows, PII lengths.

## Wave 12 — `/code-review` xhigh round 3 (2 shipped-code + 13 plan/spec)

Two findings in SHIPPED artifacts this round (both fixed + re-validated):

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | SHIPPED `make docs` overwrites hand-written chart READMEs with generated stubs (verified empirically: +14/−26 on the library README, plus creating an umbrella README the repo deliberately lacks) | Destructive target removed; `docs-check` prints `helm-docs --dry-run` only, never writes |
| 2 | SHIPPED library schema documented nameOverride/fullnameOverride/component as dependency-subtree keys — provably ignored there (helpers read the parent's ROOT values; verified with --set probes); root values remain unvalidated | Schema description + library README rewritten: keys apply at the consuming chart's root, subtree placement silently no-ops |
| 3 | sprig `dig ... $` hard-fails on Helm's typed Values (`interface conversion: ... common.Values` — reproduced) in the dep-check enabled.json + 3 AI-tier spots → Plans 2/5 render-dead | `toRawJson \| fromJson` plain-map round-trip + no-trailing-dash block-scalar rule (both verified by rendering) |
| 4 | charts:lint extends `.lint_template` (doesn't exist) + image has no helm/conftest | Self-contained image + binary checks in before_script |
| 5 | `helm template \| conftest test` missing the trailing `-` (conftest exits 1 without reading stdin) — gate never evaluated a rule | `-` added (job + local gate) |
| 6 | publish:charts `needs:` later-stage jobs → GitLab rejects pipeline creation | Moved to own `charts:publish` stage after scan; stages lists updated |
| 7 | GitOps path unbuildable: per-env kustomization.yaml never authored + gitignored file:// dep breaks kustomize/ArgoCD on fresh checkout | Plan 6 Task 1 Step 2b authors both kustomizations with the `make deps` prerequisite + OCI-source alternative documented |
| 8 | PII smoke curled `*.svc.cluster.local` from the host — unresolvable outside kind; script dead on arrival | Inject via `kubectl run` in-cluster pod (stdin payload); VL query via `port-forward svc/vlogs` + trap cleanup |
| 9 | Kyverno example imagePattern named gitlab.com + wrong ref path → matches zero images, dead Enforced policy | Pattern → self-hosted registry + the exact ref publish:charts signs |
| 10 | Spec §14.1 signed/attested BEFORE helm push (cosign needs the digest in the registry) | Order corrected: package → push → sign → attest |
| 11 | Spec §12 install patterns: wrong chart path (`./genieai-umbrella`) + missing required `--create-namespace` | All three patterns corrected; also dropped release names starting with `genieai` (fullname collision) |
| 12 | Plan 2 Task 6 Step 5 assert `== 'pre-install'` vs template's `pre-install,pre-upgrade` — unpassable, executor would "fix" the chart wrongly | Membership assertion |
| 13 | Plan 6 environments README still documented the dead `uninstallPolicy.enabled` key; Plan 2 constraint + Task 4 interfaces still cited the nonexistent invalid annotation | Both rewritten (annotation-gate contract; status.conditions signal) |
| 14 | Spec §5.2/§10 promised profile-driven observability auto-enable while Plan 4 ships static-false → prod installs blind per spec's promise | Spec aligned to Plan 4: explicit per-env values, no hidden template auto-enable |
| 15 | Renovate: `helm-requirements` manager (Helm 2 — matches nothing) + `allowedVersions: "/^~/"` matching no release version → dependency MRs never open | `helmv3` manager + plain-semver release regex matching the `~>` pin semantics |

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
