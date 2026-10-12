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

The file moves to `charts/genieai-umbrella/files/genie-realm.yaml` and becomes the **single canonical copy**. `configs/keycloak/Dockerfile.config-cli` changes its `COPY` source to that path so the compose path consumes the same file. Two copies would guarantee drift.

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
| `KEYCLOAK_URL` | `http://<release>-keycloak.<release-ns>.svc:8080`, derived from release name and namespace, not configurable |
| `KEYCLOAK_USER` | `secretKeyRef` on `data.keycloak.bootstrapAdmin.userSecret`, key `username` |
| `KEYCLOAK_PASSWORD` | `secretKeyRef` on the same Secret, key `password` |
| `KEYCLOAK_AVAILABILITYCHECK_ENABLED` / `_TIMEOUT` | literals `true` / `300s` |
| `IMPORT_PATH` | literal `/config/` |
| `IMPORT_FILES` | literal `/config/genie-realm.yaml` |
| `IMPORT_VARSUBSTITUTION_ENABLED` | literal `true` |
| `IMPORT_CACHE_ENABLED` | literal `true` |
| non-secret realm parameters | plain `env` from `.Values` |
| every `$(env:VAR)` that names a secret | one `secretKeyRef` each, from `data.keycloak.convergence.envSecrets` |

`data.keycloak.convergence.envSecrets` is a list of `{envVar, secretName, secretKey}`. The chart wires the reference; the operator declares which Secret holds which value.

### D6 — `clientSecrets.*` and `failOnPlaceholderSecrets` are repurposed

With the realm import gone, its `change-me-*` `fail()` loop is dead code and is deleted. `data.keycloak.clientSecrets.{proxyClient,dataprep,grafana}` keep their `change-me-*` defaults but their role changes: they are no longer rendered as literal values into a CR — they feed the `$(env:VC_PROXY_CLIENT_SECRET)`-style Job env vars, which resolve from Secrets at runtime. `failOnPlaceholderSecrets` keeps guarding that the values passed through the override are real, because a `change-me-*` reaching the Job produces a client whose secret no consumer in the cluster holds — the same silent-auth-failure class the guard was written for.

### D7 — Correct the ArgoCD example's false claims

`charts/genieai-umbrella/examples/argocd-application.yaml` currently states that pre-upgrade Helm hooks are NOT executed by ArgoCD and, in the next paragraph, that ArgoCD "never executes Helm lifecycle hooks" — the file contradicts itself, both statements are false, and it references a SealedSecret drift hook that this branch deleted. It is also wrong about the two pre-upgrade drift Jobs that do exist in the chart (`templates/hooks/pre-install-dependency-check.yaml` and `templates/hooks/pre-upgrade-clusterprofile-detect.yaml`). Rewritten to state the verified mapping (`PreInstall`/`PreUpgrade` → `PreSync`, `PostInstall`/`PostUpgrade` → `PostSync`), the run-always semantics with no change-gating, and that those two drift Jobs do run under ArgoCD.

## Files

| File | Action |
|---|---|
| `charts/genieai-umbrella/files/genie-realm.yaml` | **new** — canonical realm file, moved from `configs/keycloak/genie-realm.yaml` verbatim |
| `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` | add `bootstrapAdmin.user.secret` |
| `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml` | **deleted** — kcc owns the realm |
| `charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml` | **new** — the kcc post-upgrade hook Job |
| `charts/genieai-umbrella/values.yaml` | add `bootstrapAdmin.userSecret`, `convergence.{enabled,backoffLimit,envSecrets}`; document `clientSecrets.*`'s new role |
| `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml` | drop `keycloakrealmimports` from the RBAC list (no longer rendered) |
| `charts/genieai-umbrella/examples/argocd-application.yaml` | correct the false hook claims |
| `charts/genieai-umbrella/README.md` | document the single-owner model and the convergence Job |
| `configs/keycloak/genie-realm.yaml` | **deleted** — moved into the chart |
| `configs/keycloak/Dockerfile.config-cli` | `COPY` source points at the chart's copy |
| `docker-compose.yaml` | verify the build context still resolves the moved file |
| `CHANGELOG.md` | bullets |

This MR touches the Swarm compose path as well as the chart — that is the cost of a single canonical realm file, and it is preferable to two copies that drift.

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
3. **Placeholder cross-check** — extract every `$(env:VAR)` from the rendered realm body and assert each one is satisfied by either a plain `env` entry derived from `.Values` or an `envSecrets` entry. This is a render-time assertion in the template, not a manual grep: an unwired placeholder is a runtime keycloak-config-cli parse failure, not a Helm failure, so nothing else would catch it.
4. **Secret-leak scan** — assert no rendered manifest contains a literal value for any variable declared in `data.keycloak.clientSecrets.*`; the rendered realm body must contain only `$(env:VAR)` placeholders. This is the regression test for defect #2, which the earlier tasks in this branch never had.
5. `helm template ... | grep -c "kind: KeycloakRealmImport"` → `0`
6. Compose path unaffected — `docker compose config` still resolves the keycloak-config service, and the moved realm file is COPY-able from the new path.
7. First laptop run measures the real convergence duration and records it against the `900s` HelmRelease timeout.