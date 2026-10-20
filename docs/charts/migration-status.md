# Helm Migration — Status

Single-page map of the migration effort: which plans shipped, which were
superseded, what remains. Companion to `plan-defects.md` (review ledger) and
the design spec (`docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md`).
Plan checkboxes are not a status source — evidence is the chart, the deploy
repo, the cluster, and the SDD ledgers under `.superpowers/sdd/`.

## Current state (2026-10-19)

- **CRD blind spot closed (0.2.55–0.2.56)**: `kubeconform
  -ignore-missing-schemas` never validated a Custom Resource, and several
  operators decode their CRs strictly — `chart:crd-validate` runs the full
  render through `kubectl create --dry-run=server` against the installed
  CRDs (`scripts/validate-crds.sh`). It caught two real defects on its
  first run: `GrafanaDashboard.spec.resyncInterval` (the field is
  `resyncPeriod`, so all nine dashboards were rejected) and
  `Cluster.spec.storage.accessModes` (pruned silently; access modes
  belong under `storage.pvcTemplate`).
- **Review rounds 6-7 closed (0.2.56-0.2.60)**. Findings that mattered,
  each verified against the live cluster rather than taken on report:
  the backend's translation endpoint only defaulted in in-cluster GPU
  mode, so an external-GPU site that omitted it fell back to the 6 Gi
  in-process CPU model (the OOM path); `local-teardown.sh` passed
  `helm uninstall --keep-resources` to `kubectl delete namespace`,
  which is not a kubectl flag, so the default teardown never deleted
  anything while reporting success; the same script deleted the
  sealed-secrets namespace under `--with-operators`, destroying the key
  every committed SealedSecret is encrypted against; the bootstrap
  script's key restore parsed JSON while documenting a YAML file, after
  having already deleted the generated keys; `chart:contract`'s OTLP
  assertion was a whole-file grep the agent CR satisfied on its own;
  the NetworkPolicy cross-check compared ports in Service space where
  the datapath uses pod space; `clusterProfile=prod` was rendered by
  nothing in CI, though it is the only configuration that emits a
  PodDisruptionBudget and multiplies the backend to 3.
  Refuted with reproduction: the `ternary … kindIs "bool"` inversion
  (the sites use `not (kindIs "invalid")`, and `httpEnabled` is typed
  in the schema), and the Keycloak theme `strip-components` mismatch
  (it counts path components, so any theme name works).
- Chart `genieai-umbrella` at **0.2.60** on `feat/k8s-migration`; deployed on
  the laptop minikube via Flux from `genie-ai-deploy` (`overlays/jrevillard-laptop/dev`).
- Rebased onto main after issue #998 (runtime-theme model, 81 commits) —
  tip `7a20c5913` at rebase time, theme delivery ported to the operator
  world afterwards.
- **Edge tier shipped (0.2.21–0.2.26)**: Envoy Gateway as a chart dependency
  (`envoyGateway.enabled`, default on, disable-able), Gateway API Gateway/
  GatewayClass/HTTPRoute/Certificate/SecurityPolicy templates, **nginx
  REMOVED from the data path** (roundtable decision — Envoy routes
  everything; the compose nginx remains the compose path's aggregator and is
  out of scope for the chart). Port-bearing `ingress.host` (e.g.
  `genieai.local:4443` for a sudo-less laptop browser origin); TLS via
  cert-manager (selfsigned issuer on the laptop); issuer verified coherent
  with the port. Live-validated in a browser.
- **Keycloak theme at runtime (0.2.28)**: stock operator image +
  `files/keycloak-themes.tgz` (reproducible tar of `configs/keycloak/themes`)
  → ConfigMap → `spec.unsupported.podTemplate` initContainer untar →
  `/opt/keycloak/themes/genie`; checksum annotation rolls pods on tarball
  change; CI `chart:lint` guards source↔tarball drift by content hash.
  Zero image builds — same runtime-injection model #998 chose for compose.
- **Realm parity + required deployment data (0.2.29–0.2.32)**:
  registration/verifyEmail/resetPassword default to the compose values;
  `data.keycloak.adminEmail`, `ingress.host` (no more `genieai.local`
  fallback) and `smtp.{from,host,user}` (once smtp is set) are required at
  render time — deployment data no longer ships as chart defaults.
- **Full-stack browser validation + edge fixes (0.2.33–0.2.38)**: login →
  dashboard → FR streamed chat → ingestion → RAG-with-citations all green
  through the edge. Bugs fixed live on the way: https listener port derived
  from `ingress.host` (single source of truth, no duplicate knob, 0.2.35);
  Keycloak backchannel discovery returned portless URLs (Envoy forwards Host
  without the port and `backchannelDynamic` rebuilds token/jwks/userinfo from
  it) — fixed by pinning `X-Forwarded-Host` via HTTPRoute
  RequestHeaderModifier on `/auth/` (0.2.36); SSE chat killed by Envoy's 52 s
  default route timeout — `timeouts.backendRequest: 1h10m` on `/api/`
  (anchored to the backend `CHATQNA_STREAM_TIMEOUT` budget, 0.2.37–0.2.38).
- **Traces tier live (0.2.39–0.2.41)**: VictoriaTraces single-port reality
  (`-httpListenAddr=:10428`, OTLP ingest under `/insert/opentelemetry`) —
  collector exporter endpoint fixed through three iterations. All six
  services now emit spans with attributes into VT (chatqna/retriever/
  reranker RAG chain with traceparent linkage, dataprep ingest taxonomy
  `ingest/chunking/llm.context_batch/llm.context_chunk/llm.label_batch`,
  backend + document-repository Express/auto-instr spans after
  `ENABLE_OBSERVABILITY` reached the two Node services, 0.2.43).
- **Metrics OTLP sink (0.2.42)**: with `observability.metrics.enabled=false`
  the OTLP receiver had no `/v1/metrics` route and every instrumented pod
  retried metric export forever on 404 — a `nop`-exporter pipeline now
  accepts and discards. (Model-client timeout policy itself is overlay-side,
  MR !568.)
- Full validation set green on 0.2.32 (2026-10-18): health via edge, FR
  streamed chat, upload → ClamAV → dataprep ingestion, RAG answer with
  citations from a freshly ingested doc, genie-themed login page. Re-run on
  0.2.43 (2026-10-19) with the observability assertions added (VL enriched
  rows, VT spans per service).
- GPU tier is a binary choice: `opea.gpu.mode=external` (remote OpenAI-compatible
  API) or `in-cluster` (model Deployments behind `gpu=true` nodeSelector).
  Laptop runs external; in-cluster is render-validated only (no GPU locally).

## Plan map

| Plan | Artifact | Status |
|---|---|---|
| 1 — foundation | `2026-10-08-genie-ai-helm-charts-foundation.md` | ✅ shipped |
| 2 — data layer | `…-data-layer.md` | ✅ shipped (Arango, CNPG, Keycloak CRs live) |
| 3 — service tier (group 5) | `…-service-tier-group5.md` | ✅ shipped |
| keycloak v2beta1 rework | `2026-10-12-keycloak-v2beta1-chart-rework.md` | ↩️ superseded by the convergence plan |
| keycloak config convergence | `2026-10-13-keycloak-config-convergence.md` | ✅ shipped (realm converged via kcc job) |
| installable Phase 1 (app contract) | `2026-10-13-chart-installable-phase1.md` | ✅ shipped (chart 0.1.30 Ready; secrets surface, per-image securityContext, nginx `/auth/`, issuer pin, migrations job, dev-secrets) |
| 5 — AI/ML tier | `…-ai-ml.md` | ↩️ superseded by the OPEA-tier plan |
| OPEA tier (Phase 3) | `2026-10-15-opea-tier.md` | ✅ shipped (six orchestrators, four in-cluster model templates, NetworkPolicies, endpoint helpers; final review pass integrated at 0.1.61) |
| deploy repo | `…-deploy-repo.md` | ✅ shipped (`genie-ai-deploy`, Flux, per-laptop overlay) |
| 7 — CI | `…-ci.md` | 🟡 mostly (`chart:lint` + `chart:contract` green on every push — contract runs the PII smoke on the chart-rendered collector config; `chart:install` exists but is **manual-only** — a full install with prereqs takes ~30 min on the runner's kind, same posture as the compose E2E suite; residual: `ct` full suite, kind+Calico NetworkPolicy gate) |
| 8 — docs | `…-docs.md` | 🟡 partial (`charts/README.md`; per-env overlay docs not written) |
| 4 — observability | `2026-10-15-observability-tier.md` | ✅ shipped (charts 0.2.0–0.2.20: VLSingle baseline + collector gateway + filelog agent + Grafana CRs + VMServiceScrapes; live-validated on the laptop — admin logs 200, PII smoke green on the chart-rendered config; 0.2.20 scopes the filelog agent to the stack namespaces after foreign-ns zap-JSON rows broke the admin TYPE column; metrics/traces/grafana opt-in flags are render-validated only) |
| 6 — per-env ingress | `…-per-env-ingress.md` | ✅ Phase 2 shipped as charts 0.2.21–0.2.26 (Envoy Gateway dependency, Gateway API templates, nginx removed from the data path, port-bearing host, TLS); per-env overlay knobs are the `ingress.*` values consumed by the laptop overlay |

## Supersessions (why two plans were replaced)

- **keycloak-v2beta1 rework → convergence (2026-10-13):** the rework planned a
  client-CR-based GitOps surface (`KeycloakOIDCClient` × N). Research showed
  realm-level settings still needed an imperative pass; the convergence plan
  ships a post-install kcc job that pins the issuer/origin/policies and
  leaves clients to the realm import. Simpler, validated live.
- **ai-ml → OPEA tier (2026-10-15):** the original plan modeled the AI tier as
  chart-internal `ai.*` services. The shipped design keeps the compose
  topology (six OPEA orchestrators) with the GPU backend as a binary external/
  in-cluster choice — one template set, two endpoint worlds.

## Remaining phases

1. **Merge `feat/k8s-migration` → main** (MR open; description to be reworked
   to cover the whole branch). Post-merge: unpin the doc-repo
   `feat-k8s-migration` image tag in the laptop overlay (source fixes ride the
   branch: `KEYCLOAK_EXPECTED_ISSUER`, ClamAV host forwarding, backend
   `OPEA_HOST` default, streaming translation default-on).
2. **Final whole-MR review** — the 2026-10-15 review predates the rebase +
   edge tier + theme + realm-parity commits; re-run a fresh adversarial pass
   over the full diff before merge.
3. **Documentation pass** (in progress 2026-10-18):
   - ✅ `site/content/en/docs/deploy/kubernetes.md` exists; refresh its
     Access/Configuration sections (they still describe the pre-edge
     port-forward-to-nginx loop) and add the exposure-scenario section.
   - ✅ Root `CLAUDE.md` + `.claude/rules/K8s-WORKFLOW.md` exist; refresh
     stale bits (nginx port-forward, image count, validation set).
   - `charts/README.md` + `charts/genieai-umbrella/README.md` — refresh
     against 0.2.32 (ingress/envoyGateway/theme values).
   - genie-ai-deploy README — overlay/SealedSecret model if missing.
4. **CI gap (plan 7 residual)** — ✅ `chart:contract` shipped (renders with
   overlay-shaped values, runs `PII_SMOKE_CONFIG=<rendered>
   tests/otel-collector/run-pii-smoke.sh`, asserts operator Service names);
   `chart:install` settled as **manual-only** (full install ≈ 30 min on the
   runner's kind — not tenable per push; same posture as the compose E2E
   suite). Residual: `ct lint`/`ct install` full suite, kind+Calico
   NetworkPolicy install gate, dashboards for chart test results.

Observability residuals (tier ✅ shipped 2026-10-15): whole-tier adversarial
review pending; ✅ VT OTLP ingest verified live (0.2.41, traces tier on on
the laptop); `${p}`/`${s}` OTTL capture-group refs are eaten by confmap in
collector 0.152 (replacement drops boundary chars) — same latent behavior in
the compose config, kept verbatim; backlog.

## Parked / backlog

- **arango-operator ClusterRole over-grant (2026-10-19 review)**: the
  chart's ClusterRole grants the operator cluster-wide core-resource
  access (secrets, configmaps, SAs, services, statefulsets) while the
  bootstrap already ships 6 cluster-wide operator roles; only the
  `database.arangodb.com` rules need cluster scope. Trimming requires a
  validation cycle with ArangoDB reinstalled — deferred, not done blind.
- **RWO PVC + replicas>1**: `clusterProfileReplicas.prod` runs
  documentRepository ×2 against one ReadWriteOnce PVC with no node
  pinning — multi-attach risk on multi-node prod (single-node minikube
  masks it). Same shape: redis-cache + clamav cache PVCs. Needs either
  ReadWriteMany storage, a Read-only replica pattern, or anti-affinity
  + single-writer documentation.
- OPEA images hardcode tag `main` in templates → lift to values when
  branch-tagged images are needed (laptop uses registry `main` today).
- Translation orchestrator image `docker.io/opea/translation:1.3` hardcoded;
  document or expose as a value.
- `otlpEndpoint` helper assumes the OTel-operator `<cr>-collector` Service
  naming; sites without the operator need a `collectorService` override.
- GPU egress NetworkPolicies use broad `ipBlock 0.0.0.0/0` on 443/444; derive
  the port/host from the nodeHost URL when tightened.
- SealedSecrets consolidation in the deploy repo (nine single-key secrets →
  one); dead `secrets.sops.yaml` template cleanup; arango RBAC leftovers in
  `namespace.yaml`.
- In-cluster `docling` endpoint resolves to a Service the chart does not
  render (no docling model template); in-cluster mode needs either the
  Deployment or a fail-fast guard.
- Issue #1064 (compose-side ClamAV dual-mode + env mismatch) — the k8s side
  is fixed here; the image/compose side stays open upstream of this branch.
- filelog agent has no `file_storage` extension: every restart with
  `start_at: end` drops the logs emitted during the restart window (no
  duplicates possible; scoping `include` in 0.2.20 did not change this).
  Add `file_storage` + wire it into the receiver if that gap ever matters
  operationally.
- **The Grafana and metrics tiers had never been turned on** — both are
  chart-default off, so their CRs were only ever validated against the
  schema gate. Turning them on exposed four defects that no static gate
  could see, all now fixed: `GrafanaDashboard.spec.resyncInterval` (the
  field is `resyncPeriod`); the `/grafana` backendRef naming the CR
  instead of the `<cr-name>-service` the operator creates; the collector
  image carrying no prometheus exporter at all (the `k8s` distribution),
  which crash-looped the collector and took logs and traces down with it;
  and the collector's egress to VMSingle written against the Service
  port 8428 while the pod listens on 8429, so every remote-write batch
  timed out. The laptop overlay now runs all three tiers.
- **No application service exposes a Prometheus `/metrics` endpoint** —
  measured on all eleven (backend, doc-repo, frontend, redis, the six
  OPEA orchestrators, and the storage CRs). They export over OTLP, so
  the chart's VMServiceScrape CRs are inert; they are kept with that
  written down. Two silent vm-operator gates apply if they are ever
  revived: `VMSingle.spec.ingestOnlyMode` defaults to true (nil
  deref) and skips the whole scrape-config builder, and pairing a
  VMServiceScrape with a VMSingle needs
  `VMSingle.spec.serviceScrapeSelector` — a selector on the scrape
  object's OWN labels, not on its target Service.
- Dataprep vendored `llm_transformer` (sync langchain in `to_thread`) has no
  effective request timeout; long ingestions can pin threads on a stalled
  upstream (observed once against the shared GPU node; pod restart recovered).
