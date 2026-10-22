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
# 2. Lint (strict → fails on warnings)
helm lint --strict charts/genieai-umbrella/

# 3. Render locally
#    BARE `helm template …` gets garbled by the rtk hook (the hook
#    rewrites `helm` as `rtk helm` and `rtk helm template` doesn't
#    pass the args through cleanly for SOME subcommands). ALWAYS
#    prefix with `rtk proxy` to bypass the hook for this command.
rtk proxy helm template genieai charts/genieai-umbrella/ \
  -n genieai \
  -f <(yq -o=json '.values' overlays/jrevillard-laptop/dev/values.yaml | yq -P) \
  > /tmp/rendered.yaml

# 4. Bump chart version in two places (always together)
#    - charts/genieai-umbrella/Chart.yaml (version + appVersion if changed)
#    - genie-ai-deploy overlay: overlays/jrevillard-laptop/dev/helmrelease.yaml
#      spec.chart.spec.version
#
#    The version is not bookkeeping — it is the artifact identity Flux
#    reconciles on. The helm-controller compares the HelmRelease's
#    `spec.chart.spec.version` with the running release and reports
#    "release in-sync with desired state" when they match, so chart
#    content that changed WITHOUT a version bump is pushed, linted,
#    merged — and never installed. The symptom is a reconcile that
#    prints "applied revision 0.2.64" and leaves every object at its
#    creationTimestamp. Bump per push, not per batch.

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
| `charts/genieai-umbrella/files/genie-realm.yaml` | `configs/keycloak/genie-realm.yaml` | copy it over |
| `charts/genieai-umbrella/files/observability/dashboards/**` + `alerting/alert-rules.yml` | `configs/grafana/provisioning/` | `make chart-dashboards` |
| `charts/genieai-umbrella/files/keycloak-themes.tgz` | `configs/keycloak/themes` | `make keycloak-theme` |

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
# BEFORE the change: check out the pre-change chart into a temp copy
# (git archive <sha> charts/genieai-umbrella) and render from it.
# The commands are written out rather than sharing a $VALUES variable:
# zsh does not word-split an unquoted expansion, so a shared variable
# silently becomes ONE argument there.
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
kubectl -n genieai port-forward svc/envoy-genieai-genieai-<hash> 4443:443

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
(last full pass: 0.2.32, 2026-10-18):

1. `/api/health` returns 200 through the edge: `kubectl -n genieai
   port-forward svc/envoy-genieai-genieai-<hash> 4443:443` →
   `curl -sk -H "Host: genieai.local" https://localhost:4443/api/health`.
2. Login page carries the genie theme — fetch the realm login form (PKCE
   challenge needed) and grep for `login/genie/css/genie.css`; theme
   delivery = ConfigMap tgz + initContainer (regen: `make keycloak-theme`).
3. Register link present on the login page (realm `registrationAllowed`).
4. Chat stream in French — send a question with UI lang `fr`, confirm the
   streamed response arrives in French in real time (validates streaming
   translation: `STREAMING_TRANSLATION_ENABLED=1`).
5. Document upload → ClamAV scan → dataprep ingestion — upload via
   `POST /api/files/upload` (EN-only content) then trigger
   `POST /api/files/<id>/ingest`; watch dataprep status go `Ingested`.
6. RAG answer with citations — ask a question whose answer is in the
   just-ingested file; confirm the answer is correct AND `source_documents`
   cites the file.

## Local image iteration (laptop-build, primary use case)

```bash
eval $(minikube docker-env)
docker build -t genie-ai-backend:dev components/gov-chat-backend/
# repeat for every service you change

# Override per-service in overlays/jrevillard-laptop/dev/values.yaml:
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
