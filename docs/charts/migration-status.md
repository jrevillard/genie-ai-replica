# Helm Migration — Status

Single-page map of the migration effort: which plans shipped, which were
superseded, what remains. Companion to `plan-defects.md` (review ledger) and
the design of record ([`helm-charts-design.md`](helm-charts-design.md)).
Plan checkboxes are not a status source — evidence is the chart, the deploy
repo, the cluster, and the SDD ledgers under `.superpowers/sdd/`.

## Current state (2026-10-22)

- **Chart `genieai-umbrella` at 0.2.69**, branch `feat/k8s-migration` rebased
  onto `main` at `179a8a8f1` (0 commits behind).
- **No application code in the branch**: the diff touches `charts/`,
  `scripts/`, `docs/`, `deploy/`, `tests/`, `site/`, `.gitlab-ci.yml`,
  `docker-compose.yaml`, `env`, `Makefile`, `CLAUDE.md`, `CHANGELOG.md` —
  and nothing under `components/`, `genie-ai-overlay/` or `mobile/`. The
  application defects the validation work surfaced (doc-repo ClamAV host
  forwarding + issuer check + `CLAMSCAN_LOCAL_FALLBACK`, the backend's
  `OPEA_HOST` default) left as three separate MRs off `main` (!586, !587,
  !588), each with tests. That is why the laptop overlay no longer pins a
  `feat-k8s-migration` document-repository image.
- **Config parity is a gate, not a claim (0.2.61–0.2.64)**: the chart now
  configures every service the way Compose does, and `scripts/config-parity-check.py`
  compares the two renders variable by variable. The gate learned to judge
  only what it was actually given (a tier-off render used to report every
  variable of every unrendered service), to report a pair it cannot judge
  as "not judged" rather than as a match, and to verify its `notRead`
  claims against the source (a `notRead` claim that no longer holds is a
  finding, not a pass).
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
- **Review round 10 closed (0.2.69)** — three parallel adversarial passes
  over the whole post-simplify diff (round 9 already shipped inside it),
  every finding verified against a render or the live cluster before
  acting. The ones that mattered:
  - *`ct install` silently rewrote the operator's kubeconfig.* Chart
    testing creates AND deletes its own kind cluster, and kind rewrites
    the file named by `KUBECONFIG` — run bare from `make test`, the
    minikube context vanished from `~/.kube/config` and the live cluster
    (Flux release, SealedSecrets) looked gone. Restored with
    `minikube start` (state intact, sealed-secrets key verified); the
    target now runs ct against a throwaway kubeconfig file, deleted on
    every exit path.
  - *`validate-crds.sh` validated green against a dead API server.* The
    `|| true` + pattern-matching filtered "connection refused" into
    silence — no matched error pattern, exit 0, "every rendered object
    validated" while the cluster validated nothing. The kubectl exit
    code is now checked alongside the output text; mutation-proven both
    ways (old code green on a simulated API death, new code red, the
    AlreadyExists-on-live-cluster path still green).
  - *The logs dashboards named the datasource by its CR name, not its
    UID.* grafana-operator's substitution is a blind case-sensitive
    `ReplaceAll`; every `DS_VICTORIALOGS` row pointed at `victorialogs`
    while the provisioned datasource's uid is `victoriametrics-logs` —
    11 mappings silently unresolved.
  - *The backend's translation egress dropped the explicit-endpoint
    shape.* Round 9's derived-endpoint gate still fired an external
    ipBlock rule for a `.svc.cluster.local` endpoint named explicitly in
    in-cluster mode; the gate now keys on the dialed endpoint not being
    cluster-local, whatever produced it (four shapes render-verified).
  - *The HTTP→HTTPS redirect lost the source port.* Envoy strips the
    `:80` on redirect for non-well-known origins, so the port-bearing
    origin the chart explicitly supports landed on 443 — connection
    refused. The redirect now carries the public port (4443 verified
    rendered; 443 for bare hosts).
  - Plus: the helm-test data-deps check reads `data.keycloak.db.secretName`
    (an operator who renamed the CNPG/Keycloak SharedSecret was tested
    against a name nothing consumes); redis and clamav honor
    `global.imagePullSecrets` and the tag-driven pull policy; the
    dep-check SA hook-weight moved to -11 with the file-path tie-break
    documented; six undeclared OPEA booleans typed in values + schema;
    the CI kubeconfig export moved before the local-path-provisioner
    wait (a cold runner's `kubectl apply` raced an unset KUBECONFIG);
    ct's install/lint flag split corrected (`release-label`,
    lintconf colon spacing, `CT_INSTALL_FLAGS`); two `resource_group`
    comments rewritten to describe the groups they actually name; the
    teardown uninstalls grafana-operator (the `--with-grafana` opt-in)
    and its operator counts stopped contradicting its loops.
  Skipped with reasons: the `DS_PROMETHEUS` mapping (resolves to the
  same datasource either way — a no-op rename), and the NetworkPolicy
  table-ization / serial install-prereqs parks carried from round 9.
- **The CRD gate had never validated anything (0.2.69 follow-up,
  `3c9f9ca`)**: `chart:crd-validate`'s cluster never had the Gateway
  API CRDs — gateway-helm ships them as a NESTED subchart, so
  `helm template` does not render them and only a real install applies
  them — and kubectl 1.33's `resource mapping not found` message
  carries no `error:` prefix, so the pattern-only filter scored the
  dead dry run as clean. Every prior green run of the job validated
  zero objects. The round-10 exit-code check surfaced it (pipeline
  14211 red); `install-prereqs.sh` now applies the bundle from the
  vendored gateway-helm tgz (the exact version the release installs)
  via server-side apply — client-side apply exceeds the 256 KiB
  last-applied annotation on these CRDs — with a skip-guard on all
  three kinds. Proven on a scratch kind cluster from zero CRDs;
  pipeline 14216 `chart:crd-validate` green with 256 objects
  genuinely validated.
- **Review round 9 closed (0.2.67)** — three parallel adversarial passes
  over the whole final diff (core/data/services, edge/observability/OPEA,
  CI/scripts), every finding verified against a render or a live cluster
  before acting, every fix mutation-tested where the fix is an
  assertion. The ones that mattered:
  - *The backend's translation egress gated on the wrong value.* The
    rule watched the raw `services.backend.translation.endpoint` while
    the backend dials the DERIVED endpoint (opea external mode, no
    explicit value) — the mandatory GPU startup probe had no egress to
    answer it and the backend refused to start. CI renders green
    because the crosscheck skips ipBlock rules; nothing installs. The
    rule now gates on the derived endpoint and takes its CIDR and port
    from the URL, through the orchestrators' own helpers — the laptop's
    rule tightened from `0.0.0.0/0` on 443+444 to `/32` on 444,
    re-validated live (GPU health answers through it).
  - *The in-cluster model tier requested one exclusive GPU per pod* —
    four pods on the documented single-GPU node, three of them Pending
    forever. The utilization args (0.55 + 0.30) ARE the sharing
    mechanism; the default now carries no GPU resource.
  - *The NetworkPolicy crosscheck was blind to the model tier* — it
    resolved only `genieai.io/component` peers, and the four model
    policies select by bare `app:`. Fixing THAT exposed a port-space
    bug in the checker itself: ingress rules were translated through
    the SOURCE's Service mapping. Both label classes now
    mutation-proven.
  - *The parity gate could not notice its own allowlist growing*:
    mayDiffer rows counted toward the floor, and a rendered-but-envless
    service was reported "not rendered". Floor re-based to the honest
    count (171), both mutations proven.
  - *The dashboard tier columns named what a dashboard is ABOUT, not
    what its panels query* — a logs-only Grafana rendered two empty
    folders; 28 panel references reached Grafana as a literal `${ds}`
    datasource. Plus the grafana admin user (`__admin__`, no knob),
    the unbound http listener (no redirect, no ACME http-01), the
    doc-repo's bring-your-own-volume mount drop, the mutable-tag pull
    policy, the local-test dependency-update `cd`, the teardown's
    release-name default, and the bootstrap discarding both post-Flux
    signals.
  Refuted with reasoning: the `keycloak-proxy-client-secret` helm-test
  gating (the kcc Job's non-optional secretKeyRef fails the install
  loudly when the Secret is missing; the check covers exactly the
  convergence-off case), and the placeholder-guard single-flag design
  (inherent to CI's no-rows renders; the message says what it accepts).
- **Review round 8 closed (0.2.61–0.2.66)** — the adversarial pass over the
  whole diff, then the re-review of its fixes. What it changed:
  - *The GPU egress named its destination.* The six OPEA NetworkPolicies
    each carried a hand-written `ipBlock 0.0.0.0/0` on 443/444; they now
    derive the CIDR and the port from `opea.gpu.nodeHost` (a literal IPv4
    becomes a `/32`, a hostname resolves through `opea.gpu.allowedCIDRs`).
    `opea.gpu.skipTlsVerify` is also no longer inferred from the URL
    scheme — an operator says it, and the chart's default is `false`.
  - *The operator RBAC stopped over-granting.* The chart's ClusterRole
    handed the arango operator cluster-wide access to core resources
    (secrets, configmaps, serviceaccounts, services, endpoints,
    statefulsets) on top of the six cluster-wide roles the bootstrap
    already ships. Only the `database.arangodb.com` rules need cluster
    scope; the core-resource rules are gone, and ArangoDB was reinstalled
    live to prove the trimmed role still lets the operator reconcile
    (pod Ready, AQL answers).
  - *The dependency graph learned the OPEA tier.* The pre-install
    dependency check evaluated only services and data; an OPEA dependency
    was silently invisible, and the render guard failed only when the
    OPEA tier was on with no graph node at all.
  - *One `services.backend.env`.* The values file declared the backend's
    environment twice, and Helm's map merge let the second win — the
    operator's rows replaced the chart's defaults instead of joining
    them. A render guard now fails on a duplicate key.
  - *Mail stopped being optional.* `verifyEmail` and
    `resetPasswordAllowed` sat at `false` in the chart while Compose
    ships `true`; the chart now matches Compose and refuses to render
    without a mail server. The laptop cluster runs a mail **sink**
    (mailpit, in the deploy overlay) so a validation run never sends real
    mail; a deployment that owns a mailbox names its own relay and keeps
    the same chart defaults. The realm now converges to
    `verifyEmail: true` / `resetPasswordAllowed: true` /
    `registrationAllowed: true`, verified live with a full SMTP
    transaction readable in the sink.
  - *The ArangoDB database is the operator's call.* The chart was
    overriding the database name; the operator decides it.
  - *A `#` inside a folded YAML scalar is not a comment.* Two CI steps
    carried their explanation inside the command's folded scalar, so the
    text reached `helm` as an argument and the job failed on a message
    that read like a chart error. The comments moved above the step.
- Chart `genieai-umbrella` at **0.2.66** on `feat/k8s-migration`; deployed on
  the laptop minikube via Flux from `genie-ai-deploy` (`overlays/jrevillard-laptop/dev`).
- Rebased onto `main` at `179a8a8f1` (the tip that carries !586, !587,
  !588) — the branch is 0 commits behind `main`.
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
  rows, VT spans per service). Re-run on 0.2.66 (2026-10-22) after the
  review fixes: pre-install dependency check PASS, ArangoDB Ready with the
  trimmed ClusterRole (AQL answers), FR chat streamed with
  `is_grounded: true` citing the ingested file, `clamav.scan.complete` OK
  in 108 ms against the cluster's clamd, realm converged to
  `verifyEmail: true` / `resetPasswordAllowed: true` /
  `registrationAllowed: true` with the mail sink, and a full SMTP
  transaction readable in the sink's API.
- GPU tier is a binary choice: `opea.gpu.mode=external` (remote OpenAI-compatible
  API) or `in-cluster` (model Deployments behind `gpu=true` nodeSelector).
  Laptop runs external; in-cluster is render-validated only (no GPU locally).

## Plan map

The campaign ran as eight written plans plus three design specs. Those were
**working documents** — they described the shape of the work before the work
existed. The durable record is the chart itself, this status map, the design
of record ([`helm-charts-design.md`](helm-charts-design.md)) and the review
ledger ([`plan-defects.md`](plan-defects.md)); the plan set is not committed,
and the rows below name each plan and its outcome.

| Plan | Status |
|---|---|
| 1 — foundation | ✅ shipped |
| 2 — data layer | ✅ shipped (Arango, CNPG, Keycloak CRs live) |
| 3 — service tier (group 5) | ✅ shipped |
| keycloak v2beta1 rework | ↩️ superseded by the convergence plan |
| keycloak config convergence | ✅ shipped (realm converged via kcc job) |
| installable Phase 1 (app contract) | ✅ shipped (chart 0.1.30 Ready; secrets surface, per-image securityContext, nginx `/auth/`, issuer pin, migrations job, dev-secrets) |
| 5 — AI/ML tier | ↩️ superseded by the OPEA-tier plan |
| OPEA tier (Phase 3) | ✅ shipped (six orchestrators, four in-cluster model templates, NetworkPolicies, endpoint helpers; final review pass integrated at 0.1.61) |
| deploy repo | ✅ shipped (`genie-ai-deploy`, Flux, per-laptop overlay) |
| 7 — CI | 🟡 mostly (`chart:lint` + `chart:contract` green on every push — contract runs the PII smoke on the chart-rendered collector config; `chart:install` exists but is **manual-only** — a full install with prereqs takes ~30 min on the runner's kind, same posture as the compose E2E suite; residual: `ct` full suite, kind+Calico NetworkPolicy gate) |
| 8 — docs | 🟡 partial (`charts/README.md`; per-env overlay docs not written) |
| 4 — observability | ✅ shipped (charts 0.2.0–0.2.20: VLSingle baseline + collector gateway + filelog agent + Grafana CRs + VMServiceScrapes; live-validated on the laptop — admin logs 200, PII smoke green on the chart-rendered config; 0.2.20 scopes the filelog agent to the stack namespaces after foreign-ns zap-JSON rows broke the admin TYPE column; metrics/traces/grafana opt-in flags are render-validated only) |
| 6 — per-env ingress | ✅ Phase 2 shipped as charts 0.2.21–0.2.26 (Envoy Gateway dependency, Gateway API templates, nginx removed from the data path, port-bearing host, TLS); per-env overlay knobs are the `ingress.*` values consumed by the laptop overlay |

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

1. **Merge `feat/k8s-migration` → main** (MR !520 open, Draft; the
   description is being reworked to cover the whole branch rather than its
   first week). The application fixes the validation work surfaced are
   already on `main` (!586, !587, !588), so nothing has to be un-pinned
   from the laptop overlay at merge time.
2. **Final whole-MR review** — ✅ round 9 (above): three parallel
   adversarial passes over the whole final diff, findings verified and
   fixed, refutations reasoned. Post-merge, the standing backlog is the
   residual list below, not the diff.
3. **Documentation pass** (in progress 2026-10-22):
   - ✅ `site/content/en/docs/deploy/kubernetes.md` exists; its Access and
     Configuration sections describe the edge (Envoy) path, and the
     exposure-scenario section is in.
   - ✅ Root `CLAUDE.md` + `.claude/rules/K8s-WORKFLOW.md` — the
     port-forward, image count and validation-set bits are current, and
     the chart-version rule explains that the version is the artifact
     identity Flux reconciles on (a content change under an unchanged
     version is reported "in-sync" and never installed).
   - ✅ `charts/README.md` + `charts/genieai-umbrella/README.md` — refreshed
     against 0.2.66 (ingress/envoyGateway/theme values, namespace
     ownership, the four real CI gates, `ct lint`/`ct install` named as
     the gap).
   - ✅ The agent working documents under `docs/superpowers/` are gone; the
     design of record moved to `docs/charts/helm-charts-design.md` and
     every citation was repointed.
   - ✅ The genie-ai-deploy README carries the overlay/SealedSecret model,
     the two laptop overlays and the mail sink.
4. **CI gap (plan 7 residual)** — ✅ `chart:contract` shipped (renders with
   overlay-shaped values, runs `PII_SMOKE_CONFIG=<rendered>
   tests/otel-collector/run-pii-smoke.sh`, asserts operator Service names);
   `chart:install` settled as **manual-only** (full install ≈ 30 min on the
   runner's kind — not tenable per push; same posture as the compose E2E
   suite). The deploy repo's own CI now renders the laptop overlay
   (`dry-run:jrevillard-laptop/dev`) instead of only parsing the Flux
   CRs. Residual: `ct lint`/`ct install` full suite, kind+Calico
   NetworkPolicy install gate, dashboards for chart test results.

Observability residuals (tier ✅ shipped 2026-10-15): whole-tier adversarial
review pending; ✅ VT OTLP ingest verified live (0.2.41, traces tier on on
the laptop); `${p}`/`${s}` OTTL capture-group refs are eaten by confmap in
collector 0.152 (replacement drops boundary chars) — same latent behavior in
the compose config, kept verbatim; backlog.

## Parked / backlog

- **arango-operator ClusterRole over-grant (2026-10-19 review)**: ✅ closed
  in 0.2.65 — the core-resource rules are gone, only the
  `database.arangodb.com` rules kept cluster scope, and ArangoDB was
  reinstalled live to prove the operator still reconciles with the
  trimmed role.
- **chatqna event-loop blocking (2026-10-25 live validation)**: the
  uvicorn event loop is blocked for the whole duration of a query
  (retrieval → rerank → LLM, 60-90 s on the shared GPU) — `/health`
  stops answering, which is why the HTTP liveness probe killed the pod
  mid-stream (0.2.70 moved the liveness to an exec probe as the chart
  stopgap). The app-side fix (MR to `main`): serve `/health` from the
  threadpool so it answers while the loop is busy — it restores both
  the availability during queries AND a hang bound the exec probe
  cannot provide (a python-level deadlock with a live bash never
  restarts today). Related: the ArangoDB database loss observed the
  same day (datadir empty after a minikube restart, migrations
  re-applied manually) — cause unexplained, watch for a repeat.
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
- GPU egress NetworkPolicies use broad `ipBlock 0.0.0.0/0` on 443/444: ✅
  closed in 0.2.65 — the destination is derived from `opea.gpu.nodeHost`
  (literal IPv4 → `/32`, hostname → `opea.gpu.allowedCIDRs`) and the port
  from the URL.
- SealedSecrets consolidation in the deploy repo (nine single-key secrets →
  one); dead `secrets.sops.yaml` template cleanup; arango RBAC leftovers in
  `namespace.yaml` (the ClusterRole trim landed in 0.2.65; the rest of the
  file is untouched).
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
