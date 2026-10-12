# Keycloak config convergence — design spec

**Date**: 2026-10-12
**Branch**: to be created off `feat/k8s-migration` (post-MR !520)
**Status**: base design approved by user 2026-10-12; spec under review
**Supersedes**: `2026-10-12-keycloak-v2beta1-design.md` decisions D5 (realm import lifecycle) and the "out of scope" note on drift reconciliation

## Context

MR !520 (chart `feat/k8s-migration` → MR !520) migrated the Keycloak layer from the archived `keycloak.org/v1alpha1` API to the official modern operator's `k8s.keycloak.org/v2beta1`. That migration is mechanically correct and CI-green, but it shipped a layer with four structural defects:

1. **Clients are never updatable.** All 5 OAuth clients live inside `spec.realm` of a `KeycloakRealmImport`, which is create-only. Any change to a redirect URI, web origin, or client attribute requires `kubectl delete` + re-apply — a procedure, not a reconciliation.
2. **Client secrets are literal in the CR.** `spec.realm.clients[].secret` carries the real secret value. Anyone with `get` on the namespace reads it, and it lands in Flux's stored artifact.
3. **`genie-admin` has no credentials.** The realm import renders the user with roles but no password block, so the admin password is set out-of-band with `kcadm.sh set-password` after install.
4. **The realm import CR is never deleted.** Per the operator's own documentation it should be, to clean up the associated Job and Pod resources.

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

The GitOps pipeline is green while the realm has not moved. Drift is neither detected nor reported. The correct phrasing of this limitation is *not* "cannot be plugged into Flux/ArgoCD" (users do apply the CR and health-check it) but "cannot serve as a drift-detection mechanism for realm state".

### The consensus is "CR for infra, external tool for identity"

`keycloak-config-cli` (adorsys, 1206★, pushed 2026-09-14) drives the Admin REST API from a realm export versioned in Git — no operator, no CRD. Its verified limits: state-scoped reconciliation (purges only what it created), delete-and-recreate as the default rather than idempotent PUT, no in-cluster controller (image + chart rendering a `Job`, a config Secret and a creds Secret), moderate maintenance (v6.5.1, May 2026).

The vendor's own operator documentation (Red Hat Build of Keycloak 26.6, all 6 chapters) mentions none of GitOps, Argo CD, Flux, Terraform, keycloak-config-cli or kcadm.

### The `KeycloakOIDCClient` / `KeycloakSAMLClient` CRDs are not a safe foundation

They are the only reconciled operator resources, but: served in `k8s.keycloak.org/v2alpha1` (while `Keycloak` and `KeycloakRealmImport` are `v2beta1`), the doc is marked `preview=true`, they require the `client-admin-api:v2` feature flag plus a manually-created labelled admin Secret, they have **no drift detection**, they overwrite out-of-band edits on the next *apply*, and issue **#45794 "Remove Client CRDs from operator bundle" was closed 2026-02-13** — an API-stability signal. Betting the config strategy on them is not justified.

Additionally, verified in source (`ClientResourceTypeProvider.handleServiceAccount`, tag 26.8.0): `serviceAccountRoles` resolves a bare role name against *this client's* roles first, then *realm-level* roles, and throws HTTP 400 otherwise. Client-level roles on a different client (`realm-management:manage-users`) are inexpressible. So even setting stability aside, `genie-proxy-client` could not carry its `realm-management` grants through that CRD.

### Helm post-hooks work under both Flux and ArgoCD — and are values-gated under Flux

- **Flux** `helm-controller`: Helm hooks are native and enabled by default (`disableHooks` is an opt-out). The hook Job is awaited synchronously, its failure propagates, and it is bounded by the HelmRelease timeout (default 5m0s). `disableWaitForJobs` has **no** effect on hooks. While the release is `InSync` the controller takes no action, so a no-op reconcile fires no hook — the gate is "did the chart version or values digest change", **not** "did the realm body change".
- **ArgoCD**: `helm.sh/hook: post-install`/`post-upgrade` are translated to `PostSync` by `gitops-engine/pkg/sync/hook/helm/type.go`. There is **no** change-gating: the docs state "Hooks also run on every sync, not only when something they care about has changed."
- A `checksum/config` annotation on the pod template **cannot** re-trigger a `restartPolicy: Never` Job — the pod template of a non-suspended Job is immutable. Only a `metadata.name` change forces recreation. The hash-suffix pattern exists but its evidence base is a single maintainer repo with an AI-assisted design doc and no adoption data, offered as the non-default branch. It is rejected here (YAGNI + no adoption evidence).
- The one production incident located (lightbridge-authz #394) shows the Helm-post-hook-under-ArgoCD pattern failing, with its sync-wave remedy causing three further production incidents before being reverted to init containers.

## Decisions

### D1 — Convergence mechanism: inline Helm post-upgrade hook Job running keycloak-config-cli

A `Job` rendered by the umbrella chart itself, using the `adorsys/keycloak-config-cli` image, wired as a Helm `post-install,post-upgrade,post-rollback` hook. No subchart dependency.

**Why inline rather than a subchart dependency on `keycloak-config-cli`**: the upstream chart's `templates/realms.yaml` reads its realm body with `$.Files.Get $config.file`, and `.Files` inside a subchart cannot see the parent chart's files — the `file:` path is therefore unavailable to us, and the `inline:` alternative forces the whole realm into the values surface. Since the umbrella already renders the realm body from its own values for the realm import, rendering it for the Job too keeps one source of truth. This also matches the chart's existing shape: one library subchart (`genieai-common`), everything else inline templates.

**Why run-always is correct for us specifically** (not merely the vendor default): the realm configuration is values-driven. A realm change alters `values.yaml`, which alters the values digest, which makes the release `OutOfSync`, which triggers a Helm upgrade, which fires the post-upgrade hook. The release-level gate therefore delivers exactly the "only when the realm config changes" semantics, with no hash-suffix machinery.

### D2 — Bootstrap chain on the `Keycloak` CR

```yaml
spec:
  bootstrapAdmin:
    user:
      secret: <data.keycloak.bootstrapAdmin.userSecret>       # Secret K8s: username + password
    service:
      secret: <data.keycloak.bootstrapAdmin.serviceSecret>    # Secret K8s: client-id + client-secret
```

Values additions (names only, never values):
- `data.keycloak.bootstrapAdmin.userSecret` (default `keycloak-admin-credentials`)
- `data.keycloak.bootstrapAdmin.serviceSecret` (default `keycloak-operator-credentials`)

Both Secrets are operator-provided, consistent with the chart's secret-backend agnosticism.

**Known upstream caveat, documented not coded around**: the operator's own documentation states that if a master realm already exists on the cluster, `spec.bootstrapAdmin` is ignored. On such a cluster the referenced Secret does not correspond to a real account and the convergence Job's authentication fails loudly (hook failure → Helm release failure). That is an acceptable, non-silent failure mode; the chart does not attempt to detect the pre-existing-master-realm case because it cannot observe cluster state at render time.

### D3 — `KeycloakRealmImport` becomes bootstrap-only and is documented for deletion

Retained content (the "socle" that has no other declarative home):
- `roles.realm[]`: `admin` (composite over `realm-management`), `dataprep-service`
- `users[]`: `genie-admin` with `realmRoles` + the full `clientRoles.realm-management` grant set
- `smtpServer`, `internationalizationEnabled`, `supportedLocales`, `defaultLocale`, `passwordPolicy`, `accessTokenLifespan`, `sslRequired`, the registration/verify/reset/login booleans
- the built-in `account` and `account-console` client entries (Keycloak built-ins — they cannot be managed by any declarative CR)

Removed content:
- the 5 non-built-in OAuth clients, which move to the convergence Job's realm file

The CR is annotated and commented as bootstrap-only. **Whether the operator deletes it is an operator decision**, documented in the template header: the operator documentation instructs deleting it to clean up the associated Job and Pod. The chart does not auto-delete it — a Helm-rendered resource that deletes itself is not expressible — and does not need to: the Job and Pod are owned by the CR and are garbage-collected with it.

### D4 — The realm body moves to a Secret rendered from values, consumed by the Job

The Job mounts the realm JSON from a chart-rendered Secret (a Secret rather than a ConfigMap because the body carries `$(env:VAR)` placeholders that the operator resolves from other Secrets at import time, and because kcc writes nothing back — a Secret keeps the "may contain resolved secrets" semantics honest).

The realm body keeps the compose file's `$(env:VAR)` substitution convention (`IMPORT_VARSUBSTITUTION_ENABLED=true`), which is what keeps secrets out of git. The chart renders placeholders, never values.

### D5 — Secret wiring for the Job

| Job env | Source |
|---|---|
| `KEYCLOAK_URL` | `http://<release>-keycloak.<release-ns>.svc:8080`, derived from the release name and namespace, not configurable |
| `KEYCLOAK_USER` | the bootstrap admin username — `secretKeyRef` on `data.keycloak.bootstrapAdmin.userSecret`, key `username` |
| `KEYCLOAK_PASSWORD` | `secretKeyRef` on the same Secret, key `password` |
| `KEYCLOAK_AVAILABILITYCHECK_ENABLED` | literal `true` |
| `KEYCLOAK_AVAILABILITYCHECK_TIMEOUT` | literal `300s` |
| `IMPORT_PATH` | literal `/config/` |
| `IMPORT_FILES` | literal `/config/genie-realm.yaml` |
| `IMPORT_VARSUBSTITUTION_ENABLED` | literal `true` |
| `IMPORT_CACHE_ENABLED` | literal `true` |
| every `$(env:VAR)` target in the realm body | one `secretKeyRef` each, from `data.keycloak.convergence.envSecrets` |

`data.keycloak.convergence.envSecrets` is a list of `{envVar, secretName, secretKey}` entries. The chart only wires the reference; the operator declares which Secret holds which value — same agnosticism as every other Secret this chart consumes.

The 40 substitution targets collapse onto a small number of operator-provided Secrets by concern (realm naming, client secrets, DB, mail, admin). Values are never rendered into the chart.

### D6 — Readiness wait, trigger annotations and timeouts

The hook Job starts as soon as the release is applied, but a cold Keycloak takes ~70s to report Ready. keycloak-config-cli ships a first-class wait for this:

| Variable | kcc default | Set to |
|---|---|---|
| `KEYCLOAK_AVAILABILITYCHECK_ENABLED` | `false` | `true` |
| `KEYCLOAK_AVAILABILITYCHECK_TIMEOUT` | `120s` | `300s` |

This closes the readiness gap without an init container. It is also strictly better than the compose path, which approximates the same thing with a 10-attempt × 10s retry loop in `configs/keycloak/config-and-sleep.sh`.

```yaml
annotations:
  helm.sh/hook: post-install,post-upgrade,post-rollback
  helm.sh/hook-delete-policy: hook-succeeded,before-hook-creation
  helm.sh/hook-weight: "10"
```

These match the upstream keycloak-config-cli chart's defaults. `hook-delete-policy: hook-succeeded` removes the Job after a successful run so a completed run leaves no resource behind; `before-hook-creation` replaces a stale one on the next release.

`data.keycloak.convergence.backoffLimit: 2` (three attempts). Retries here cover genuine failures, not the Keycloak startup — the availability check owns that.

**Timeout budget**: the hook is awaited synchronously by the Helm release, so it is bounded by the HelmRelease timeout. Worst case is `(backoffLimit + 1) × (availability check + import)`. With `300s` availability check and an unmeasured import, the deploy-repo overlays set `spec.upgrade.timeout: 900s`. The real import duration has never been measured in this repo; the first laptop run records it and the values are revised.

### D7 — Correct the ArgoCD example's false claims

`charts/genieai-umbrella/examples/argocd-application.yaml` currently states that pre-upgrade Helm hooks are NOT executed by ArgoCD, and in the next paragraph that ArgoCD "never executes Helm lifecycle hooks" — the file contradicts itself, both statements are false, and it references a SealedSecret drift hook that this branch deleted. Rewritten to state the verified mapping (`PreInstall`/`PreUpgrade` → `PreSync`, `PostInstall`/`PostUpgrade` → `PostSync`), the run-always semantics with no change-gating, and that the chart's two pre-upgrade drift Jobs (dependency check, cluster-profile detect) DO run under ArgoCD.

### D8 — CHANGELOG

One bullet per logical change, operator-facing, branch result vs `main`, marked `(breaking)` where applicable, Keep-a-Changelog 1.1.0 structure. No commit-by-commit narrative.

## Files

| File | Action |
|---|---|
| `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` | add `bootstrapAdmin.user.secret` + `bootstrapAdmin.service.secret` |
| `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml` | reduce to socle; remove the 5 OAuth clients; rewrite the header comment for bootstrap-only lifecycle |
| `charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml` | **new** — the kcc post-upgrade hook Job |
| `charts/genieai-umbrella/templates/data/keycloak-realm-secret.yaml` | **new** — the realm body rendered from values into a Secret |
| `charts/genieai-umbrella/values.yaml` | add `bootstrapAdmin.{userSecret,serviceSecret}`, `convergence.{enabled,backoffLimit,envSecrets}`; document that `clientSecrets.*` now feeds placeholders, not literals |
| `charts/genieai-umbrella/examples/argocd-application.yaml` | correct the false hook claims |
| `charts/genieai-umbrella/README.md` | document the two-layer config model and the convergence Job |
| `CHANGELOG.md` | bullets |

## Out of scope (explicit)

- **The GENIE Keycloak theme.** Compose bakes `configs/keycloak/themes/` into a custom image (`configs/keycloak/Dockerfile`, `FROM quay.io/keycloak/keycloak:26.7` + `COPY themes/`). The chart uses the stock operator image, so `loginTheme: genie` resolves to nothing and falls back to the default theme — no branding, no 14 locale message bundles. Closing this needs a new GENIE-built Keycloak image in the 16-image CI list plus `spec.image` on the Keycloak CR. Separate plan.
- **Terraform provider keycloak.** The research produced no surviving claim about its 2026 state; nothing may be asserted about it.
- **ArgoCD as a delivery target.** The deploy-repo uses Flux. The ArgoCD example is corrected for accuracy but not exercised.
- **kcc image tag maintenance.** The `-26` suffix in `adorsys/keycloak-config-cli:6.5.0-26` encodes the Keycloak major version; a Keycloak major bump requires a matching kcc tag bump. Documented, not automated.
- **Realm reconciliation via `KeycloakOIDCClient` CRDs.** Rejected per the stability and capability findings above.

## Validation

1. `helm lint charts/genieai-umbrella/ --strict` — clean
2. `helm template test charts/genieai-umbrella/ -n genieai --set <the 3 clientSecrets + failOnPlaceholderSecrets=false>` renders: `Keycloak` CR with `bootstrapAdmin`, reduced `KeycloakRealmImport`, the realm Secret, and the hook Job with its annotations and `secretKeyRef` wiring
3. `bash -n scripts/install-prereqs.sh` — unchanged, still clean
4. Rendered-secret scan: the realm Secret body must contain only `$(env:VAR)` placeholders — no literal secret values (this is the regression test for defect #2)
5. Grep the rendered output for the old literal-client-secret pattern to confirm it is gone
6. First laptop run measures the real convergence duration, to be recorded and used to revise the 600s timeout

Items 4 and 5 are the actual verification that defect #2 is fixed; the earlier tasks in this branch never tested for it.