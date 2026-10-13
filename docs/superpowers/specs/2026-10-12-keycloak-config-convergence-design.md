# Keycloak config convergence — design spec

**Date**: 2026-10-12
**Branch**: to be created off `feat/k8s-migration` (after MR !520)
**Status**: approved by user 2026-10-12 after adversarial review; revision 2
**Supersedes**: `2026-10-12-keycloak-v2beta1-design.md` decisions D5 (realm import lifecycle) and the "out of scope" note on drift reconciliation

## Context

MR !520 (`feat/k8s-migration`) migrated the Keycloak layer from the archived `keycloak.org/v1alpha1` API to the official modern operator's `k8s.keycloak.org/v2beta1`. That migration is mechanically correct and CI-green, but it shipped a layer with four structural defects:

1. **Clients are never updatable.** All 5 OAuth clients live inside `spec.realm` of a `KeycloakRealmImport`, which is create-only. Any change to a redirect URI, web origin, or client attribute requires `kubectl delete` + re-apply — a procedure, not a reconciliation.
2. **Client secrets are literal in the CR.** `spec.realm.clients[].secret` carries the real secret value. Anyone with `get` on the namespace reads it, and it lands in Flux's stored artifact.
3. **`genie-admin` has no credentials.** The realm import renders the user with roles but no password block, so the admin password is set out-of-band with `kcadm.sh set-password` after install.
4. **The realm import CR is never deleted.** The operator's own documentation instructs deleting it to clean up the associated Job and Pod resources.

Two deep-research passes (95 + 102 agents, ~14.7M tokens, sources cross-verified 3-0) established that the 2026 answer is a specific hybrid, not the `KeycloakOIDCClient` CRD path initially assumed.

## The 2026 reality (verified)

### There is no native GitOps for a Keycloak realm

`KeycloakRealmImport` is create-only **by construction**, not merely by documentation:

- the operator hardcodes `--override=false` in the import Job command
- `KeycloakRealmImportJobDependentResource` implements only `Creator` and `GarbageCollected` — the java-operator-sdk `Updater` interface is absent
- the controller logs *"Job already executed - not recreating"*

**The Keycloak maintainer said so explicitly.** shawkins (core team), 2026-06-22, issue #25326 (still open):

> "there is not a way to currently do that via the operator. This is something that we indend to eventually address with admin api v2. When using the operator for now you'll need to directly use the partial update and other admi api endpoints directly."

Issue #45439 ("Operator CRs for managing realm resources") is `blockedBy` #43165 ("Client API v2"), milestone *Future*, due 2030-12-31.

### The failure mode is silent at the worst possible layer

| Layer | What you see |
|---|---|
| Job | exit 0, INFO log `Realm '%s' already exists. Import skipped` |
| CR status | `Done: true` / `HasErrors: false` |
| **Flux / ArgoCD** | **Synced / Healthy** |

The GitOps pipeline is green while the realm has not moved. The correct phrasing of this limitation is *not* "cannot be plugged into Flux/ArgoCD" (users do apply the CR and health-check it) but "cannot serve as a drift-detection mechanism for realm state".

### The consensus is "CR for infra, external tool for identity"

`keycloak-config-cli` (adorsys) drives the Admin REST API from a realm file versioned in Git — no operator, no CRD. Its verified limits: state-scoped reconciliation (purges only what it created), delete-and-recreate as the default rather than idempotent PUT, no in-cluster controller (image + chart rendering a `Job`, a config Secret and a creds Secret), moderate maintenance. Pinned image: `adorsys/keycloak-config-cli:6.5.0-26` — the `-26` suffix encodes the Keycloak major version, so a Keycloak major bump requires a matching tag bump.

The vendor's own operator documentation (Red Hat Build of Keycloak 26.6, all 6 chapters) mentions none of GitOps, Argo CD, Flux, Terraform, keycloak-config-cli or kcadm.

### The `KeycloakOIDCClient` / `KeycloakSAMLClient` CRDs are not a safe foundation

They are the only reconciled operator resources, but: served in `k8s.keycloak.org/v2alpha1` (while `Keycloak` is `v2beta1`), the doc is marked `preview=true`, they require the `client-admin-api:v2` feature flag plus a manually-created labelled admin Secret, they have **no drift detection**, they overwrite out-of-band edits on the next *apply*, and issue **#45794 "Remove Client CRDs from operator bundle" was closed 2026-02-13**. Additionally, `ClientResourceTypeProvider.handleServiceAccount` (verified at tag 26.8.0) resolves `serviceAccountRoles` against *this client's* roles then *realm-level* roles and throws HTTP 400 otherwise — client-level roles on a different client (`realm-management:manage-users`) are inexpressible, so `genie-proxy-client` could not carry its grants through that CRD regardless.

### Helm post-hooks work under both Flux and ArgoCD — and are values-gated under Flux

- **Flux** `helm-controller`: Helm hooks are native and enabled by default (`disableHooks` is an opt-out). The hook Job is awaited synchronously, its failure propagates, and it is bounded by the HelmRelease timeout. `disableWaitForJobs` has **no** effect on hooks. While the release is `InSync` the controller takes no action, so a no-op reconcile fires no hook — the gate is "did the chart version or values digest change", **not** "did the realm file change".
- **ArgoCD**: `helm.sh/hook: post-install`/`post-upgrade` are translated to `PostSync` by `gitops-engine/pkg/sync/hook/helm/type.go`. There is **no** change-gating: the docs state "Hooks also run on every sync, not only when something they care about has changed."
- A `checksum/config` annotation on the pod template **cannot** re-trigger a `restartPolicy: Never` Job — the pod template of a non-suspended Job is immutable. Only a `metadata.name` change forces recreation. The hash-suffix pattern exists but its evidence base is a single maintainer repo with an AI-assisted design doc, offered as the non-default branch. Rejected here (YAGNI + no adoption evidence).
- The one production incident located (lightbridge-authz #394) shows the Helm-post-hook-under-ArgoCD pattern failing, with its sync-wave remedy causing three further production incidents before being reverted to init containers.

## Decisions

### D1 — Single owner of the realm: keycloak-config-cli

The realm has **exactly one owner**. `KeycloakRealmImport` is removed from the chart entirely.

**Why not split** (socle in the realm import, clients in the convergence Job): that design has two owners of the same realm, and the ordering between them is non-deterministic. The import Job is created *asynchronously by the operator* (`KeycloakRealmImportJobDependentResource implements Creator<Job, KeycloakRealmImport>`) — it is not a Helm resource, so `hook-weight` sequences nothing. Worse than a race: if the convergence Job creates the realm first, the import Job then sees the realm already present and skips silently (`--override=false`), so the socle (`genie-admin`, realm roles, SMTP, locale, password policy) would never be created.

The convergence Job's `KEYCLOAK_AVAILABILITYCHECK_*` waits for Keycloak HTTP readiness, **not** for the realm — it does not close this gap. Removing the second owner does.

**Why this is safe**: the compose path already relies on keycloak-config-cli creating the realm from `genie-realm.yaml` on a fresh stack. That behaviour is verified by production, not by documentation.

### D2 — The realm file is shipped verbatim; the chart does not re-render it

`genie-realm.yaml` is already fully parameterised — its `$(env:VAR)` placeholders cover everything that varies per deployment (`KC_PUBLIC_ORIGIN` for the ingress host, `KEYCLOAK_PASSWORD_POLICY`, `KC_MOBILE_CLIENT_ID`, `KEYCLOAK_SUPPORTED_LOCALES`, all client secrets, all SMTP fields). There is nothing left to template. Rendering the realm from Helm values would mean re-inventing a realm-authoring engine in YAML-inside-YAML (~300 lines) to reproduce a file that is already parameterised.

The file is **copied** to `charts/genieai-umbrella/files/genie-realm.yaml`, not moved. `configs/keycloak/genie-realm.yaml` stays exactly where it is.

**Why duplicate rather than move.** Moving it would change the Docker build context from `configs/keycloak/` to the repo root, because Docker rejects a `COPY` source outside the context — and because *both* `COPY` lines in `configs/keycloak/Dockerfile.config-cli` are relative to that context, so both break, not just the one naming the moved file. That cascade touches the Dockerfile, `docker-compose.yaml`, the CI job's `CONTEXT`, and the change-trigger path lists on all three `keycloak-config` jobs, and it invalidates the doc references to `configs/keycloak/genie-realm.yaml`. The single-copy benefit does not pay for that blast radius.

Consequences of duplicating instead:
- `Dockerfile.config-cli`, `docker-compose.yaml`, the three `keycloak-config` CI jobs and `deploy/ansible/README.md:730` are all **untouched**.
- The compose image keeps COPYing `configs/keycloak/genie-realm.yaml`, so the Docker Swarm path is bit-for-bit unchanged.
- The chart reads its own copy at render time; Helm never invokes Docker, so there is no coupling between the two.

**Drift is the cost, and it is guarded, not accepted.** A `diff` assertion in the `chart:lint` CI job fails the MR when the two copies diverge, and that job's `rules:changes` is extended so it also fires when only `configs/keycloak/**/*` changes — which by itself it would not. Without that second part, an edit to the compose copy alone would skip the check entirely.

Per-env variation reaches the file through two distinct channels, matching what compose already does:

| Channel | Carries | Mechanism |
|---|---|---|
| non-secret deployment values | `ingress.host`, locale, password policy, theme, mobile client id, realm name | plain `env` on the Job, from `.Values` |
| secrets | client secrets, SMTP password, DB password | `secretKeyRef` on the Job, from `data.keycloak.convergence.envSecrets` |

### D3 — Bootstrap admin on the `Keycloak` CR

```yaml
spec:
  bootstrapAdmin:
    user:
      secret: <data.keycloak.bootstrapAdmin.userSecret>     # Secret K8s: username + password
```

New value: `data.keycloak.bootstrapAdmin.userSecret` (default `keycloak-admin-credentials`). Name only, never the value — the Secret is operator-provided, consistent with the chart's secret-backend agnosticism.

**`bootstrapAdmin.service` is deliberately NOT configured.** It would exist solely to authenticate the `KeycloakOIDCClient` CRDs, which this design rejects. Nothing consumes it.

**Known upstream caveat, documented not coded around**: the operator's documentation states that if a master realm already exists on the cluster, `spec.bootstrapAdmin` is ignored. The failure signature on such a cluster is a `401` on keycloak-config-cli's first authenticated call, surfacing as a Helm hook failure and a failed release. Nothing in the operator says "bootstrapAdmin was ignored", so the chart documents the 401 explicitly as the diagnostic to recognise. The chart cannot detect the pre-existing-master-realm case at render time.

### D4 — The convergence Job

An inline Helm hook rendered by the umbrella chart itself, using the `adorsys/keycloak-config-cli` image. No subchart dependency: the upstream chart's `templates/realms.yaml` reads its body via `$.Files.Get $config.file`, and `.Files` inside a subchart cannot see parent-chart files — the `file:` path is unavailable to us and the `inline:` alternative forces the whole realm into the values surface. Inlining also matches the chart's existing shape (one library subchart, `genieai-common`; everything else inline templates).

```yaml
annotations:
  helm.sh/hook: post-install,post-upgrade,post-rollback
  helm.sh/hook-delete-policy: hook-succeeded,before-hook-creation
  helm.sh/hook-weight: "10"
```

These match the upstream keycloak-config-cli chart's defaults. `hook-succeeded` leaves no completed Job behind; `before-hook-creation` replaces a stale one.

**Readiness wait.** The hook starts as soon as the release is applied, but a cold Keycloak takes ~70s to report Ready. keycloak-config-cli ships a first-class wait:

| Variable | kcc default | Set to |
|---|---|---|
| `KEYCLOAK_AVAILABILITYCHECK_ENABLED` | `false` | `true` |
| `KEYCLOAK_AVAILABILITYCHECK_TIMEOUT` | `120s` | `300s` |

This is strictly better than the compose path, which approximates the same thing with a 10-attempt × 10s retry loop in `configs/keycloak/config-and-sleep.sh`.

**Timeout budget**: the hook is awaited synchronously, so it is bounded by the HelmRelease timeout. Worst case is `(backoffLimit + 1) × (availability check + import)`. With `data.keycloak.convergence.backoffLimit: 2` (three attempts), a `300s` availability check and an unmeasured import, the deploy-repo overlays set `spec.upgrade.timeout: 900s`. The real import duration has never been measured in this repo; the first laptop run records it.

**Run-always scope, stated precisely**: because the realm file is a chart file whose content is fixed at the release, the values-digest gate gives "only when it changed" semantics **from the second sync onward** — a realm-file edit that changes no chart value will not by itself move the digest. In practice every realm parameter reaches the file through `env` or `envSecrets`, both of which are values, so a parameter change does move the digest. On first install there is no prior digest and the hook fires unconditionally, which is correct. The claim is not that the gate is universal, only that it covers the parameter-driven changes that exist.

### D5 — Secret wiring

| Job env | Source |
|---|---|
| `KEYCLOAK_URL` | `http://keycloak-service.{{ .Values.namespace }}.svc.cluster.local:8080/auth` — the `/auth` suffix is required by D7. the Service name is `<Keycloak CR metadata.name> + "-service"` (upstream `Constants.KEYCLOAK_SERVICE_SUFFIX`), and the CR name is hardcoded `keycloak`, so the Service is `keycloak-service`. The Helm release name is **not** part of it. Same value already used by `templates/services/backend.yaml:6` and `documentRepository.yaml:17`. |
| `KEYCLOAK_USER` | `secretKeyRef` on `data.keycloak.bootstrapAdmin.userSecret`, key `username` |
| `KEYCLOAK_PASSWORD` | `secretKeyRef` on the same Secret, key `password` |
| `KEYCLOAK_AVAILABILITYCHECK_ENABLED` / `_TIMEOUT` | literals `true` / `300s` |
| `IMPORT_PATH` | literal `/config/` |
| `IMPORT_FILES` | literal `/config/genie-realm.yaml` |
| `IMPORT_VARSUBSTITUTION_ENABLED` | literal `true` |
| `IMPORT_CACHE_ENABLED` | literal `true` |
| non-secret realm parameters | plain `env` from `.Values` |
| every `$(env:VAR)` that names a secret | one `secretKeyRef` each, from `data.keycloak.convergence.envSecrets` |

`data.keycloak.convergence.envSecrets` is a list of `{envVar, secretName, secretKey}` with an explicit `[]` default in `values.yaml`. The chart wires the reference; the operator declares which Secret holds which value.

**Completeness is asserted at render time.** The realm body lives in a chart file, not in template text, so the check runs over the file's content rather than over rendered template output. The convergence-Job template does `regexFindAll "\\$\\(env:([A-Z_][A-Z0-9_]*)\\)" (.Files.Get "files/genie-realm.yaml")` and asserts that every captured name is satisfied by either a plain `env` entry derived from `.Values` or an `envSecrets` row. An unsatisfied placeholder is otherwise invisible to Helm and surfaces only as a keycloak-config-cli parse error at Job runtime.

### D6 — `clientSecrets.*` and `failOnPlaceholderSecrets` are repurposed, with a named home

With the realm import gone, its `change-me-*` `fail()` loop (currently `keycloak-realm-import.yaml:33-38`) is dead code and is deleted. The guard itself must not disappear: a `change-me-*` reaching the Job produces a client whose secret no consumer in the cluster holds — the same silent-auth-failure class the guard was written for, and with no realm import there is nothing else that would catch it.

**The guard lives in the convergence-Job template.** Before rendering, `templates/data/keycloak-convergence-job.yaml` runs the same three-mode check the realm import ran (missing key / empty value / `change-me-*` prefix) over `data.keycloak.clientSecrets.{proxyClient,dataprep,grafana}`, and over every non-empty entry of `data.keycloak.convergence.envSecrets` that targets a `clientSecrets`-backed variable. A hit is a `fail()` at render time, gated by `data.keycloak.failOnPlaceholderSecrets`.

`data.keycloak.clientSecrets.*` keeps its `change-me-*` defaults; only its role changes — from literal values rendered into a CR to the values operators pass in the override, which the template wires as `valueFrom.secretKeyRef` targets for the realm's `$(env:VAR)` placeholders. No client secret is ever rendered as a literal.

Two values cleanups in the same edit: `data.keycloak.bootstrapAdmin.user.username` and `data.keycloak.bootstrapAdmin.user.password` (currently `""` defaults at `values.yaml:170-173`) are removed — only `bootstrapAdmin.userSecret` survives D3 — and `data.keycloak.convergence.envSecrets` is added with an explicit `[]` default, so a base install renders rather than failing on an absent key.

`data.keycloak.failOnPlaceholderSecrets` **keeps its `true` default, deliberately.** With it, a default `helm install` that ships `change-me-*` client secrets fails at render time in the Job template rather than producing a cluster whose OIDC clients carry secrets no consumer holds. Operators opt to `false` only where the placeholder is genuinely acceptable.

### D7 — Close the `/auth` relative-path gap (defect found reviewing rev 3)

This is not a convergence concern but a defect already present in MR !520's templates, surfaced while verifying the Job's `KEYCLOAK_URL`.

`templates/services/backend.yaml:6` and `documentRepository.yaml:17` both set `KEYCLOAK_URL` to `http://keycloak-service.<ns>.svc.cluster.local:8080/auth`, but **nothing in the chart configures Keycloak to serve under `/auth`** — no `KC_HTTP_RELATIVE_PATH`, no `--http-relative-path`, no `additionalOptions` entry. In the Swarm path the prefix comes from NGINX routing `/auth/*`; on Kubernetes there is no such layer, so Keycloak serves at `/` while both services dial `/auth`, and every authenticated request 404s.

**Decision**: the chart owns the prefix. Add to the `Keycloak` CR:

```yaml
spec:
  additionalOptions:
    - name: http-relative-path
      value: /auth
```

This keeps the two existing service templates correct rather than editing them, and it is the option that matches what the in-cluster consumers already expect. It also means the convergence Job's `KEYCLOAK_URL` (D5) and the realm's own redirect URIs must carry `/auth` — keycloak-config-cli's URL format is `scheme://host:port/web-context`, so a Job pointed at the bare `:8080` would hit `/realms/master/protocol/openid-connect/token` on the wrong context, get a 404, and surface as the same 401 the D3 caveat describes.

### D8 — Document the `clientSecrets` → `envSecrets` mapping

D6 keeps `clientSecrets.*` operator-supplied, which means operators hand-write at least five `envSecrets` rows and can mismatch them. The spec does not generate them — that is deliberate, since the chart stays secret-backend agnostic — but it ships the mapping as worked examples in `values.yaml` comments so the mirroring is mechanical rather than inferred:

| `data.keycloak.clientSecrets.*` | realm placeholder | typical `envSecrets` row |
|---|---|---|
| `proxyClient` | `$(env:KC_PROXY_CLIENT_SECRET)` | `{envVar: KC_PROXY_CLIENT_SECRET, secretName: <op>, secretKey: proxy-client}` |
| `dataprep` | `$(env:KC_DATAPREP_CLIENT_SECRET)` | `{envVar: KC_DATAPREP_CLIENT_SECRET, secretName: <op>, secretKey: dataprep}` |
| `grafana` | `$(env:KC_GRAFANA_CLIENT_SECRET)` | `{envVar: KC_GRAFANA_CLIENT_SECRET, secretName: <op>, secretKey: grafana}` |

Those three are the client secrets. The realm file carries **two further secret placeholders** that also need `envSecrets` rows and are not derived from `clientSecrets.*`:

| realm placeholder | typical `envSecrets` row |
|---|---|
| `$(env:GENIE_ADMIN_PASSWORD)` | `{envVar: GENIE_ADMIN_PASSWORD, secretName: <op>, secretKey: password}` |
| `$(env:EMAIL_PASSWORD)` | `{envVar: EMAIL_PASSWORD, secretName: <op>, secretKey: password}` |

The remaining placeholders in the file (`KC_REALM`, `KC_CLIENT_ID`, `KC_PUBLIC_ORIGIN`, `KEYCLOAK_*` behaviour flags, `KC_MOBILE_*`, `EMAIL_HOST`/`PORT`/`FROM`/`USER`, `EMAIL_SMTP_*`) are non-secret deployment values wired as plain `env` from `.Values`. `$(env:KEYCLOAK_PASSWORD_POLICY)` and `$(env:KEYCLOAK_RESET_PASSWORD)` are configuration, not secrets, despite the substring.

### D9 — Guard the duplication with a CI drift assertion

The two copies of the realm file are only equivalent by convention, so the convention is enforced. `chart:lint` (`.gitlab-ci.yml:2553`) gains a `diff charts/genieai-umbrella/files/genie-realm.yaml configs/keycloak/genie-realm.yaml` step, and its `rules:changes:paths` gains `configs/keycloak/**/*` so the job fires when only the compose copy changes — without that, an edit to `configs/keycloak/genie-realm.yaml` alone would skip the job and the drift would ship.

This is the substitution for the CI path-list edits a single-copy design required: those jobs still watch only `configs/keycloak/**/*`, which remains correct, because the image they build never reads the chart's copy.

### D10 — Correct the ArgoCD example's false claims

`charts/genieai-umbrella/examples/argocd-application.yaml` currently states that pre-upgrade Helm hooks are NOT executed by ArgoCD and, in the next paragraph, that ArgoCD "never executes Helm lifecycle hooks" — the file contradicts itself, both statements are false, and it references a SealedSecret drift hook that this branch deleted. It is also wrong about the two pre-upgrade drift Jobs that do exist in the chart (`templates/hooks/pre-install-dependency-check.yaml` and `templates/hooks/pre-upgrade-clusterprofile-detect.yaml`). Rewritten to state the verified mapping (`PreInstall`/`PreUpgrade` → `PreSync`, `PostInstall`/`PostUpgrade` → `PostSync`), the run-always semantics with no change-gating, and that those two drift Jobs do run under ArgoCD.

### D11 — CHANGELOG

One bullet per logical change, operator-facing, branch result vs `main`, marked `(breaking)` where applicable, Keep-a-Changelog 1.1.0 structure. No commit-by-commit narrative.

## Files


| File | Action |
|---|---|
| `charts/genieai-umbrella/files/genie-realm.yaml` | **new** — byte-identical copy of `configs/keycloak/genie-realm.yaml`, guarded by the `chart:lint` drift assertion |
| `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` | add `bootstrapAdmin.user.secret` **and** `additionalOptions: [{name: http-relative-path, value: /auth}]` (D7) |
| `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml` | **deleted** — kcc owns the realm; its `change-me-*` guard moves to the Job template |
| `charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml` | **new** — the kcc post-upgrade hook Job, carrying the `change-me-*` guard and the `$(env:VAR)` completeness assertion |
| `charts/genieai-umbrella/values.yaml` | add `bootstrapAdmin.userSecret`, `convergence.{enabled,backoffLimit,envSecrets: []}`; **remove** `bootstrapAdmin.user.{username,password}`; document `clientSecrets.*`'s new role |
| `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml` | drop `keycloakrealmimports` from the RBAC list (no longer rendered) |
| `charts/genieai-umbrella/examples/argocd-application.yaml` | correct the false hook claims |
| `charts/genieai-umbrella/README.md` | document the single-owner model and the convergence Job |
| `.gitlab-ci.yml` | `chart:lint` gains a `diff` drift assertion, and its `rules:changes:paths` gains `configs/keycloak/**/*` so the check fires when the compose copy changes || `charts/genieai-umbrella/values.yaml:96,116` | prose comments naming `KeycloakRealmImport`, orphaned by the D1 deletion |
| `CHANGELOG.md` | bullets |

The MR does not touch the Swarm compose path or the keycloak-config image build at all — duplicating the realm file instead of moving it is what keeps the blast radius to the chart plus one CI assertion.

## Out of scope (explicit)

- **The GENIE Keycloak theme.** Owned by issue **!998 "Refactor theme to runtime-loaded config (no rebuild for color changes)"** (opened 2026-09-16, labels `architecture` / `deployment` / `tech-debt`). That issue is transverse — it covers the frontend palette *and* the Keycloak theme CSS, and its proposed solution is mount-only / no rebuild. **Do not open a duplicate ticket**; the K8s side is a follow-on to !998, not a separate workstream.

  The consequence for this spec is the only remaining functional gap against the compose path: `configs/keycloak/themes/` is baked into a custom image (`FROM quay.io/keycloak/keycloak:26.7` + `COPY themes/`), so on K8s the stock operator image has no `genie` theme and `loginTheme: genie` falls back to the default — no branding, no 14 locale message bundles.

  Two candidate routes exist for K8s, and the choice belongs to !998, not here:

  | | Mechanism | Cost |
  |---|---|---|
  | **A** | a ConfigMap carrying the whole theme (`template.ftl`, CSS, the 14 `messages_*.properties`, base64 `logo.png`) mounted at `/opt/keycloak/themes/genie/` through `spec.unsupported.podTemplate` | mount-only, no 17th image, no `kc.sh build --optimized`; but `spec.unsupported.podTemplate` is documented "use at your own risk, we reserve the possibility to remove/change the way any field gets merged in future releases without notice" |
  | **B** | a GENIE-built Keycloak image referenced by `spec.image` | adds a 17th image to the CI build list and requires the `--optimized` augmentation step; stable API, more moving parts |

  !998's mount-only direction favours A, and A carries the same "field explicitly unsupported" risk that led this spec to reject the `KeycloakOIDCClient` CRDs. **Implement the K8s theme only after !998 settles A-vs-B**, or the Swarm and Kubernetes paths will diverge.
- **Terraform provider keycloak.** The research produced no surviving claim about its 2026 state; nothing may be asserted about it.
- **ArgoCD as a delivery target.** The deploy-repo uses Flux. The example is corrected for accuracy, not exercised.
- **kcc image tag maintenance.** The `-26` suffix encodes the Keycloak major version. Documented, not automated.
- **Realm reconciliation via `KeycloakOIDCClient` CRDs.** Rejected per the stability and capability findings above.

## Validation

1. `helm lint charts/genieai-umbrella/ --strict` — clean
2. `helm template test charts/genieai-umbrella/ -n genieai --set <3 clientSecrets + failOnPlaceholderSecrets=false>` renders: the `Keycloak` CR with `bootstrapAdmin.user.secret`, the convergence Job with its hook annotations, `secretKeyRef` wiring and availability-check env, and **no `KeycloakRealmImport`**
3. **Placeholder completeness** — the render-time assertion in the Job template fires when a `$(env:VAR)` in `files/genie-realm.yaml` has neither a `.Values`-derived `env` entry nor an `envSecrets` row. Verified by removing one `envSecrets` row and confirming `helm template` fails.
4. **Secret-leak scan** — assert that for every variable backed by `data.keycloak.clientSecrets.*`, the rendered Job uses `valueFrom.secretKeyRef` and never a literal `value:`. This is the regression test for defect #2, which the earlier tasks in this branch never had.
5. `helm template ... | grep -c "kind: KeycloakRealmImport"` → `0`
6. **Guard still trips** — a render with `change-me-*` client secrets and `failOnPlaceholderSecrets=true` fails; with `false` it renders and the Job carries `secretKeyRef`, not literals.
7. **Compose build** — `docker compose build keycloak-config` succeeds from the repo-root context and the built image contains `/config/genie-realm.yaml` byte-identical to `charts/genieai-umbrella/files/genie-realm.yaml`.
8. **CI trigger** — a commit touching only `charts/genieai-umbrella/files/genie-realm.yaml` produces `build:keycloak-config`, `scan:keycloak-config` and `promote:keycloak-config` jobs. Without the `rules:changes:paths` additions these are silently skipped, so all three are checked explicitly rather than assumed.
9. **Service reachability** — `kubectl get svc keycloak-service -n <ns>` exists, and `curl` against `http://keycloak-service.<ns>.svc.cluster.local:8080/auth/realms/genie` returns a realm response (this is the D7 relative-path fix, and the same value the two service templates dial).
10. First laptop run measures the real convergence duration. If it exceeds 900s, the HelmRelease `spec.upgrade.timeout` is raised to the measured value plus headroom and the value recorded in this spec; if it exceeds the operator's own reconcile budget, that is an escalation, not a timeout to keep raising.