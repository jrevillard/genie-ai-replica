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
  `branch: main` (HEAD, no SHA pin) — the overlays track `main`, so a push
  to `main` reaches the cluster. HelmRelease `chart.spec.chart` rewrites to
  that branch HEAD — **no CI wait** between commit and Flux picking it up.
  The overlays tracked the campaign branch `feat/k8s-migration` until it was
  merged: a branch that is merged stops receiving the commits made after it,
  so the cluster would have reconciled a frozen snapshot of it.
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

# 4. Bump the chart version (Chart.yaml) AND the overlay's version
#    (genie-ai-deploy) — always together, every overlay.
#    Full workflow, gate, verification and rollback: "Chart version
#    bump — the workflow" below.

# 5. Commit chart + push genie-ai-deploy (overlay version bump). Order:
#    a) push chart repo (chart publish first, otherwise overlay can pull
#       a non-existent tag)
#    b) push overlay with new `version:`
#    c) trigger reconcile
flux reconcile helmrelease genieai -n flux-system

# 6. Watch rollout
kubectl -n genieai rollout status deploy/genieai-genieai-umbrella-<service> --timeout=300s
```

## Chart version bump — the workflow

The chart version is released on its **own axis**, independent of the
product release (the image tags). It has the same discipline as the
release workflow: a named artifact, a gate that enforces it, a
verification step, and a rollback path. The full picture:

### When the bump is mandatory

**Any commit that touches `charts/genieai-umbrella/**`,
`charts/genieai-common/**` or `charts/genieai-assets/**`.** All three
change what the umbrella installs: the library renders INTO the
umbrella's output, and the assets chart is a **cargo dependency** whose
files (the realm, the Keycloak theme tarball, the Grafana dashboards)
are rendered by the umbrella through `.Subcharts.genieai-assets.Files`
and travel with the release. `charts/README.md` and `charts/Makefile`
sit OUTSIDE the watched paths and need no bump.

The gate is `scripts/ci/chart-version-check.py` (the `chart:lint` job):
it compares the last two chart-touching commits of the change and fails
when the content moved without the version moving. It runs in CI, so a
missed bump is caught by the pipeline — but it is cheaper not to trip it.

> A `make chart-dashboards` or `make keycloak-theme` regeneration touches
> `charts/genieai-assets/**` — it is a chart change, and it needs the bump
> like any other.

### What to change

| File | Field | Value |
|---|---|---|
| `charts/genieai-umbrella/Chart.yaml` | `version` | the new chart release (`0.2.N` → `0.2.N+1`) |
| `charts/genieai-umbrella/Chart.yaml` | `appVersion` | mirrors `version` **deliberately** — it tracks the chart layout, not the product release (the two are on independent axes; deployed image tags come from values, never from `appVersion`) |
| `genie-ai-deploy/overlays/<cluster>/<env>/helmrelease.yaml` | `spec.chart.spec.version` | the same number, in EVERY overlay that installs the chart |

**The overlay bump is a separate repository and a separate commit.**
Bump every overlay, not just the one you are testing on: an overlay left
at the old number names a chart the cluster is not running.

### Why the overlay's version is a LABEL, not the reconcile key

helm-controller reconciles on the SOURCE's artifact, not on
`spec.chart.spec.version`: the HelmRelease CRD says the field is
"ignored for charts from v1.GitRepository and v1beta2.Bucket sources"
(helm-controller v1.1.0). For the chart's GitRepository the artifact is
the **branch tip** — the overlays track `branch: main`, deliberately not a
commit pin. So a chart push reaches the cluster
whether or not the version was bumped; what the bump buys is that the
overlay and the chart agree on what is deployed.

Two consequences to keep in mind:

- A bump does **not** gate the install — the branch tip is what installs.
- A branch-tip source means a broken commit lands in the cluster on the
  next reconcile (1 minute on the laptop overlay), with no CI gate in
  between. That is the accepted trade-off for a dev cluster; production
  gates at the merge-to-main step.

### The order (two repos, two pushes)

```bash
# 1. In the CHART repo: bump Chart.yaml, commit, push.
#    The chart publishes on push — the overlay must never name a version
#    that does not exist yet.
git add charts/genieai-umbrella/Chart.yaml
git commit -m "chore(charts): <what changed> (0.2.N+1)"
git push

# 2. In the DEPLOY repo: bump spec.chart.spec.version in every overlay
#    that installs this chart, commit, push.
git add overlays/*/dev/helmrelease.yaml
git commit -m "chore(deploy): the overlay installs chart 0.2.N+1"
git push

# 3. Reconcile and watch (the overlay's source interval is 10m; force it).
flux reconcile helmrelease genieai -n flux-system
flux get hr genieai -n flux-system
kubectl -n genieai rollout status deploy/genieai-genieai-umbrella-<service> --timeout=300s
```

### Verify

```bash
# The release reports the chart it installed
flux get hr genieai -n flux-system        # Ready, chart genieai-umbrella@0.2.N+1
helm -n genieai list                      # the release revision
kubectl -n genieai get pods               # every pod Ready
```

The three must agree: the chart's `Chart.yaml`, the overlay's
`spec.chart.spec.version`, and the release the cluster reports. A
mismatch is the signal that one of the two bumps was missed.

### Rollback

Revert **both** commits (chart first or overlay first, in the same order
as the install — the overlay must never name a version that does not
exist), push, and reconcile. A chart rollback after the overlay has
already moved on is the case that breaks: the overlay's version names a
chart that no longer exists at that number.

### Relation to the release workflow

They are **two independent axes**:

| | Chart version | Product release |
|---|---|---|
| Bumps when | the chart's content changes | the product ships |
| Lives in | `charts/genieai-umbrella/Chart.yaml` + the deploy-repo overlays | `CHANGELOG.md`, a `release/X.Y` branch, a `vX.Y.Z` tag |
| Gate | `chart-version-check.py` (`chart:lint`) | `config:changelog` + the tag pipeline |
| Installs into | the cluster | the images |

A release that also changes the chart runs **both**: the chart bump
(here) and the release workflow (`.claude/rules/RELEASE.md`). Neither
substitutes for the other, and a release that bumps only one of them
leaves the other stale.

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
The laptop overlay **keeps it on** — it declares non-placeholder values
for `data.keycloak.clientSecrets.*` and wires the realm's Secret-backed
variables through `data.keycloak.convergence.envSecrets` rows that
reference the Secrets the SealedSecret controller materializes in the
namespace, so the render passes with the guard ON. A render with no
overlay values **must** carry `--set data.keycloak.failOnPlaceholderSecrets=false`
or the render fails loudly on `change-me-*` placeholders.

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

# Naming: most Deployments = <release>-genieai-umbrella-<service>
# (genieai-genieai-umbrella-backend, ...), but three carry a bare name:
# clamav, redis-cache, envoy-gateway (the last is the Envoy Gateway
# subchart). Services use literal short names
# (svc/backend, svc/clamav, svc/envoy-genieai-genieai-<hash>, ...).
# `kubectl -n genieai get deploy` is the authoritative list.
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
#   relay:  python3 scripts/laptop-edge-relay.py   (discovers the node's
#           address and the Envoy Service's https nodePort — the number
#           changes with every install, so the recipe names no number)
#   run:    BASE_URL=https://genieai.local:4443 E2E_VENUE_IP=127.0.0.1 \
#           npx playwright test tests/e2e/
# E2E_VENUE_IP maps the venue's NAME to the relay's loopback address for
# BOTH resolvers — the suite's origin port (4443) and the cluster's
# nodePort are two different numbers, and the relay is the adapter.
# The origin MUST stay https://genieai.local:4443 — the realm's
# redirectUris and the frontend's baked issuer are pinned to it; any
# other port breaks the OIDC redirect, not the tests. Tests that need
# a different hostname resolution set E2E_VENUE_IP (and E2E_VENUE_HOST
# when it differs from the BASE_URL host) — the suite maps that name for
# BOTH resolvers, Node and Chromium (tests/e2e/helpers/venue-launch-args.js).
# The pre-flight refuses a malformed address before the suite starts.

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
(last full pass: **0.2.149, 2026-11-02** — 6/6, the first over the
busybox tooling tier; previous full passes: 0.2.130, 2026-10-29, and
0.2.32, 2026-10-18). The chart has moved on since that pass — re-run the
set before trusting it on a newer release:

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

Known caveats:

- **The chatqna tokenizer defect is FIXED** (!631): the service counts
  tokens through the LLM server's `/tokenize` endpoint instead of loading
  a local `AutoTokenizer`, so a fresh pod serves chat with no HF cache and
  no huggingface.co egress. (The 0.2.130-pass caveat that said otherwise
  is kept in the ledger for the record.)
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
