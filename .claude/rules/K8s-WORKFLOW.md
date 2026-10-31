# Kubernetes Workflow

Day-to-day operating loop for the GENIE.AI Helm chart on the dev cluster, and
the contracts that matter when editing `charts/genieai-umbrella/**` or the
`genie-ai-deploy` overlay.

## Cluster topology

- **Cluster**: local **minikube** on the developer's laptop, started with
  `--cni=calico`. **The CNI is not optional**: minikube's default (kubenet)
  has no policy engine, so the chart's NetworkPolicies are stored and never
  applied — a laptop cluster stays green while carrying a broken egress
  graph, and the defect only surfaces in production as a timeout with no
  error anywhere. Rebuild with `scripts/laptop-cluster-bootstrap.sh`
  (procedure: `docs/charts/laptop-cluster-bootstrap.md`).
- **The sealed-secrets key is cluster state**: the committed SealedSecrets
  in `genie-ai-deploy` are encrypted against it. A `minikube delete`
  destroys it — capture and restore it (same Secret name, same
  `tls.crt`/`tls.key`, PLUS the
  `sealedsecrets.bitnami.com/sealed-secrets-key=active` label, PLUS a
  controller restart), or every committed SealedSecret fails with
  "no key could decrypt secret".
- **App namespace**: `genieai` (created by `install.createNamespace: true`
  on the HelmRelease — pre-install/pre-upgrade hooks must NOT assume it
  exists).
- **Flux namespace**: `flux-system` (GitLab Agent + HelmRelease live here).
- **Chart publishing**: pushes to the `charts/genieai-umbrella/**` branch
  publish **instantly** via the GitRepository source-ref
  `branch: feat/k8s-migration` (HEAD, no SHA pin) — pushes to `main` do NOT
  reach the laptop cluster. HelmRelease `chart.spec.chart` rewrites to that
  branch HEAD — **no CI wait** between commit and Flux picking it up.
- **What does NOT trigger an upgrade**: a `valuesFrom` ConfigMap or Secret
  content change alone. Flux watches chart-source references; values are
  watched indirectly. Force: `flux reconcile helmrelease genieai -n flux-system`.

## Chart dev cycle (the exact loop)

```bash
# 1. Edit templates/values
# 1b. Build the vendored dependencies. charts/.gitignore excludes
#     */charts/ and */*.tgz, so a fresh clone has NO charts/*.tgz and
#     every helm command below fails with "no template
#     genieai-common.fullname" / "chart directory is missing these
#     dependencies". Run this first, every session.
helm dependency update charts/genieai-umbrella
# 2. Lint (strict → fails on warnings)
helm lint --strict charts/genieai-umbrella/

# 3. Render locally
#    BARE `helm template …` gets garbled by the rtk hook (the hook
#    rewrites `helm` as `rtk helm` and `rtk helm template` doesn't
#    pass the args through cleanly for SOME subcommands). ALWAYS
#    prefix with `rtk proxy` to bypass the hook for this command.
rtk proxy helm template genieai charts/genieai-umbrella/ \
  -n genieai \
  -f <(yq -o=json '.values' overlays/<dev>-laptop/dev/values.yaml | yq -P) \
  > /tmp/rendered.yaml
#    <dev>-laptop = your per-developer overlay in genie-ai-deploy
#    (one directory per dev cluster: public values ConfigMap + the
#    SealedSecrets sealed against THAT cluster's key). Substitute the
#    name of the overlay your deploy-repo checkout carries.

# 4. Bump chart version in two places (always together)
#    - charts/genieai-umbrella/Chart.yaml (version + appVersion if changed)
#    - genie-ai-deploy overlay: overlays/<dev>-laptop/dev/helmrelease.yaml
#      spec.chart.spec.version
#
#    WHY, exactly: the version is the deploy repo's LABEL of the chart
#    it installs — a reader of the overlay sees which chart release
#    the cluster runs. It is NOT what Flux reconciles on for this
#    source: the HelmRelease CRD says the field is "ignored for charts
#    from v1.GitRepository and v1beta2.Bucket sources" (helm-controller
#    v1.1.0), and the controller's install decision is the SOURCE's
#    artifact digest — for the chart's GitRepository that is the branch
#    tip (the overlays track `branch: feat/k8s-migration`, deliberately
#    not a commit pin). So a chart push reaches the cluster with or
#    without a version bump; what the bump buys is that the overlay and
#    the chart agree on what is deployed.
#
#    Bump per push, not per batch, so the label never names a chart
#    that is not the one in the cluster.
#
#    CI enforces it: scripts/ci/chart-version-check.py (chart:lint job) fails
#    the pipeline when the last two chart-touching commits changed the
#    chart's content without moving the version.

# 5. Commit chart + push genie-ai-deploy (overlay version bump). Order:
#    a) push chart repo (chart publish first, otherwise overlay can pull
#       a non-existent tag)
#    b) push overlay with new `version:`
#    c) trigger reconcile
flux reconcile helmrelease genieai -n flux-system

# 6. Watch rollout
kubectl -n genieai rollout status deploy/genieai-genieai-umbrella-<service> --timeout=300s
```

## The chart carries copies — re-sync them

Two artifacts in the chart are copies of a file the repo owns elsewhere,
and CI fails the pipeline when the copy drifts from the source:

| Copy | Source | Re-sync |
|---|---|---|
| `charts/genieai-assets/files/genie-realm.yaml` | `configs/keycloak/genie-realm.yaml` | copy it over |
| `charts/genieai-assets/files/observability/dashboards/**` + `alerting/alert-rules.yml` | `configs/grafana/provisioning/` | `make chart-dashboards` |
| `charts/genieai-assets/files/keycloak-themes.tgz` | `configs/keycloak/themes` | `make keycloak-theme` |

The assets live in the `genieai-assets` cargo chart, not in the
umbrella: helm-controller persists a release snapshot (the parent
chart's files + templates + the rendered manifest) into one Secret
capped at 1 MiB by the API server, and the theme tarball riding twice
(source in `files/` + rendered ConfigMap) breached that cap at
0.2.126. Dependency content is NOT persisted (proven on release v11),
so carrying the bytes in a dependency keeps them out of the snapshot
while the umbrella renders them through
`.Subcharts.genieai-assets.Files`. Do not move these files back into
`charts/genieai-umbrella/files/` — the next upgrade would fail with
`sh.helm.release.v1.*: data: Too long`.

A copy without a guard drifts silently: the compose deployment serves the
source and the Kubernetes deployment serves the copy, and the two answer
the same question differently. The dashboards check also compares the
chart's dashboard list in `templates/observability/grafana-dashboards.yaml`
against the files on disk — a copied file the list does not mention is
never rendered, and a listed file that is missing inlines as an empty
dashboard.

## Render gates

Two gates before any chart push. Skip either, expect silent breakage.

### Gate A — namespace guard (`-n genieai`)

The chart's Namespace resource, hook Jobs, and test pods read
`.Release.Namespace`. Render without `-n genieai` and the chart renders a
Namespace into the wrong namespace, then the install fails with cross-namespace
ownership errors. **Always** render with `-n genieai`.

### Gate B — placeholder-secret guard

`data.keycloak.failOnPlaceholderSecrets` defaults to `true` (prod safety).
The laptop overlay sets it `false` (overlay values via `values:` inline block
in `helmrelease.yaml`), feeding real client secrets through `envSecrets` rows
that reference the Secrets the SealedSecret controller materializes in the namespace. A render with no overlay values
**must** carry `--set data.keycloak.failOnPlaceholderSecrets=false` or the
render fails loudly on `change-me-*` placeholders.

### Gate C — byte-compare for pure refactors

For chart edits that touch only structure (no value, no `opea.gpu.mode` flip,
no per-service image tag).

**What is compared is the DRIFT, not the two modes.** The two GPU modes
render differently by design (in-cluster adds model Deployments and PVCs,
external points at a remote endpoint), so "external vs in-cluster" is never
empty. The invariant is that a refactor introduces the SAME change in both
modes: diff(before→after) must be identical for external and in-cluster.

Two things silently empty that comparison, and both were shipped here once:

- **The OPEA tier must be ON.** `opea.enabled` defaults to `false`, and
  with the tier off `opea.gpu.mode` changes nothing — the two renders are
  byte-identical whatever the mode says, so the gate passes on every
  change.
- **Both renders need the same required values.** The chart has no default
  for `ingress.host`, `data.keycloak.adminEmail` or the mail server, and a
  render that fails prints its error INSTEAD of the manifests. Two failing
  renders diff to nothing — the gate compares two error messages.

```bash
# BEFORE the change: render the PRE-change chart. The two "before"
# files the gate consumes are produced HERE — the block below only
# writes the "after" ones, and an agent that renders the current tree
# twice gets an empty diff and a green gate for a refactor that
# changed one GPU mode only.
#
#   PRE_CHANGE_SHA = the commit the change starts from
#   git archive "$PRE_CHANGE_SHA" charts/genieai-umbrella | tar -x -C /tmp/chart-before
#
# The vendored dependency tarballs are gitignored, so the copy needs
# them: `helm dependency update /tmp/chart-before/charts/genieai-umbrella`.
# The commands are written out rather than sharing a $VALUES variable:
# zsh does not word-split an unquoted expansion, so a shared variable
# silently becomes ONE argument there.
rm -rf /tmp/chart-before && mkdir -p /tmp/chart-before
git archive "$PRE_CHANGE_SHA" charts/genieai-umbrella | tar -x -C /tmp/chart-before
helm dependency update /tmp/chart-before/charts/genieai-umbrella >/dev/null

# The two "before" renders use the SAME flags as the "after" ones, with
# the chart path swapped:
#   rtk proxy helm template genieai /tmp/chart-before/charts/genieai-umbrella/ -n genieai \
#     <the same --set list> --set opea.gpu.mode=external > /tmp/before-external.yaml
#   rtk proxy helm template genieai /tmp/chart-before/charts/genieai-umbrella/ -n genieai \
#     <the same --set list> --set opea.gpu.mode=in-cluster > /tmp/before-incluster.yaml

# The "after" renders:
rtk proxy helm template genieai charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.adminEmail=ci-render@example.org \
  --set data.keycloak.smtp.from=no-reply@ci.invalid \
  --set data.keycloak.smtp.host=smtp.invalid \
  --set data.keycloak.smtp.port=587 \
  --set data.keycloak.smtp.starttls=true \
  --set ingress.host=ci-render.local \
  --set opea.enabled=true \
  --set opea.gpu.nodeHost=https://gpu.ci-render.local:444 \
  --set opea.gpu.mode=external > /tmp/after-external.yaml

rtk proxy helm template genieai charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.adminEmail=ci-render@example.org \
  --set data.keycloak.smtp.from=no-reply@ci.invalid \
  --set data.keycloak.smtp.host=smtp.invalid \
  --set data.keycloak.smtp.port=587 \
  --set data.keycloak.smtp.starttls=true \
  --set ingress.host=ci-render.local \
  --set opea.enabled=true \
  --set opea.gpu.nodeHost=https://gpu.ci-render.local:444 \
  --set opea.gpu.mode=in-cluster > /tmp/after-incluster.yaml

# The gate: the drift must be the same in both modes.
diff <(diff /tmp/before-external.yaml   /tmp/after-external.yaml) \
     <(diff /tmp/before-incluster.yaml /tmp/after-incluster.yaml)
```

An empty result means the refactor is mode-agnostic. A non-empty result
means the change touched one mode only — read the diff and decide whether
that is intended.

For intentional changes, classify every line of the diff BEFORE pushing —
walk it like a PR review. Refactor diffs must round-trip identically across
both `opea.gpu.mode` values.

## Helm traps (eat these once)

- **`#` comments inside `list(...)` or `dict(...)` actions**: parse error.
  Comments only work at the YAML-document level or inside plain template
  flow.
- **`{{- X -}}` trimming**: the trailing `-}}` strips the newline AFTER
  the action AND the leading whitespace on the next line. A `{{- X -}}`
  immediately before `---` glues the YAML separator. Use `{{- X }}` or
  `{{ X -}}` deliberately when you want one-side trim only.
- **Sprig `default` / `coalesce`** treat `false` as empty (`default "x" false`
  returns `"x"`). For boolean knobs, use `kindIs "bool"` guards, not
  `default`.
- **`helm template` tolerates what `helm upgrade` rejects**. The render gate
  is necessary but not sufficient — eyeball doc boundaries (`---`),
  service-name prefixes (`genieai-umbrella-`), and field-name drift
  (Kubernetes CamelCase ≠ Helm kebab-case).

## Debugging

```bash
# Always work in the app namespace
kubectl -n genieai get pods,svc,deploy

# Naming: Deployments = <release>-genieai-umbrella-<service>
# (genieai-genieai-umbrella-backend, ...); Services use literal short names
# (svc/nginx, svc/backend, svc/clamav, ...).
kubectl -n genieai get pods -l app.kubernetes.io/name=<chart>

# Pod env (BEFORE theorizing why a feature is misbehaving)
kubectl -n genieai exec deploy/genieai-genieai-umbrella-backend -- env | grep -E 'KEYCLOAK|OPEA|CORS'

# Port-forward the Envoy data-plane Service for browser validation
# (nginx is gone from the data path; the laptop browses https://genieai.local:4443)
kubectl -n genieai port-forward svc/envoy-genieai-genieai-<hash> 4443:4443

# FOR AN E2E SUITE RUN, do not use the port-forward: every forwarded
# connection negotiates a SPDY stream THROUGH THE API SERVER, and under
# the suite's own connection churn that negotiation times out mid-run —
# the listener stays alive but the tunnel is dead, and every later
# goto against networkidle fails in a cascade that looks like a test
# defect. Relay the nodePort instead (data plane, no apiserver):
#   relay:  python3 -c '<asyncio pump> 127.0.0.1:4443 ->
#           $(minikube ip):<nodePort 31736>'   (see /tmp/relay-4443.py)
#   run:    BASE_URL=https://genieai.local:4443 npx playwright test tests/e2e/
# The origin MUST stay https://genieai.local:4443 — the realm's
# redirectUris and the frontend's baked issuer are pinned to it; any
# other port breaks the OIDC redirect, not the tests. Tests that need
# a different hostname resolution take HOST_RESOLVER_RULES (a chromium
# --host-resolver-rules knob on playwright.config.js).

# Arango port-forward + cluster-secret password (NOT the repo .env value)
kubectl -n genieai port-forward svc/arangodb-single-single 8529:8529
ARANGO_PWD=$(kubectl -n genieai get secret arango-root-secret \
  -o jsonpath='{.data.password}' | base64 -d)
```

## Secrets model (laptop)

Sealed secrets pinned to Sealed Secrets `~> 2.20.x` (controller `>= 0.40.0`).
Operator-side bootstrap uses `kubeseal` against the cluster controller cert.
The laptop overlay's `secrets/` directory carries one SealedSecret per
cluster Secret — apply-order matters (Keycloak realm import fails if
`keycloak-admin-credentials` is missing when the post-install kcc Job runs).

Special case — `vllm-api-key` carries **two** keys:

- `VLLM_API_KEY` — the GPU node API key, sent as `Authorization: Bearer`.
- `HF_TOKEN` — must have access to the **gated** model
  (`google/gemma-3-4b-it` — translation model). Without it, the translation
  endpoint returns 403 and the backend silently falls back to the in-process
  CPU model.

## Live validation set

The end-to-end test that proves the stack works. Per cycle, run all six
(last full pass: **0.2.130, 2026-10-29**, on the rebuilt 12 GiB node —
all six green; previous full pass was 0.2.32, 2026-10-18):

1. `/api/health` returns 200 through the edge: `kubectl -n genieai
   port-forward svc/envoy-genieai-genieai-<hash> 4443:4443` (the Service
   port is 4443, not 443) →
   `curl -sk -H "Host: genieai.local" https://localhost:4443/api/health`.
2. Login page carries the genie theme — fetch the realm login form (PKCE
   challenge needed) and grep for `login/genie/css/genie.css`; theme
   delivery = ConfigMap tgz + initContainer (regen: `make keycloak-theme`).
   Keycloak 26.x serves the form with HTTP 200 at the auth URL itself.
3. Register link present on the login page (realm `registrationAllowed`).
4. Chat stream in French — send a question with UI lang `fr`, confirm the
   streamed response arrives in French in real time (validates streaming
   translation: `STREAMING_TRANSLATION_ENABLED=1`).
5. Document upload → ClamAV scan → dataprep ingestion — upload via
   `POST /api/files/upload` (EN-only content) then trigger
   `POST /api/files/<id>/ingest`; watch dataprep status go `Ingested`.
   **The file must be `.md`/`.pdf`/`.docx`** — docling rejects `.txt`
   with `File format not allowed` and the ingest fails at chunking.
   Upload requires the `Admin` role (use `genie-admin`).
6. RAG answer with citations — ask a question whose answer is in the
   just-ingested file; confirm the answer is correct AND `source_documents`
   cites the file.

Known caveats from the 0.2.130 pass:

- **The chatqna tokenizer is NOT available offline** (main-side defect):
  `align_inputs` calls `AutoTokenizer.from_pretrained(LLM_MODEL)` at
  request time, the image bakes no HF cache, and the chatqna
  NetworkPolicy has no egress to huggingface.co — so a fresh pod
  cannot serve ANY chat. The 0.2.130 pass worked because the tokenizer
  files were injected by hand into the running pod
  (`~/.cache/huggingface/hub/models--ibm-granite--granite-4.1-8b/`,
  snapshot + `refs/main`); a pod restart loses them. The proper fix is
  a main-side MR baking the tokenizer into the chatqna image
  (HF_HUB_OFFLINE=1 + cache = deterministic, no egress needed).
- **First-boot ordering**: on a cold cluster the dataprep (and any OPEA
  service) crashes once with a collector `ConnectionError` when its OTLP
  exporter fires before the collector pod pulled its image. The
  kubelet restart absorbs it — no action needed, but expect one Error
  pod in the first minutes.

## Local image iteration (laptop-build, primary use case)

```bash
eval $(minikube docker-env)
docker build -t genie-ai-backend:dev components/gov-chat-backend/
# repeat for every service you change

# Override per-service in overlays/<dev>-laptop/dev/values.yaml:
# services:
#   backend:
#     image: { repository: genie-ai-backend, tag: dev, pullPolicy: Never }
# (Always use `pullPolicy: Never` for local builds — otherwise the kubelet
# resolves the bare name to Docker Hub, which doesn't carry the genie-ai-*
# images, and the pod ImagePullBackOffs.)

flux reconcile helmrelease genieai -n flux-system
```

Registry images are validation-only — one-time proof that the GitOps wiring
(Flux + Agent + SealedSecrets) works end-to-end before swapping to local builds.

## Reference

- Migration ledger + plan map: `docs/charts/migration-status.md`.
- Sealed secrets research: `docs/charts/sealed-secrets-state-of-art-2026q4.md`.
- OTel collector migration: `docs/charts/otel-migration.md`.
- Deploy repo README: `genie-ai-deploy/README.md` (overlay/Flux/SOPS model,
  per-laptop overlay).
