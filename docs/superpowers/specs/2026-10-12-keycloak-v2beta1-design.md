# Keycloak 26 v2beta1 migration — design spec

**Date**: 2026-10-12
**Branch**: `feat/k8s-migration`
**Status**: approved (user, 2026-10-12 "ok go")
**Source of truth**: upstream CRD YAML at tag `26.8.0` + official install docs at `keycloak.org/operator/installation`

## Context

The chart currently renders Keycloak via the archived `keycloak.org/v1alpha1` API
(`kind: Keycloak`, `kind: KeycloakRealm`), installed from the raw manifest of
`keycloak/keycloak-operator` (archived 2022-11-16). Both must be replaced with
the OFFICIAL modern Quarkus-based Keycloak 26 operator + `k8s.keycloak.org/v2beta1`
CRDs. The chart has not yet shipped — there is no live install to migrate, only
template files to rewrite.

## Decisions

### D1. Install path: Kustomize single-namespace

```bash
kubectl create namespace keycloak-system
kubectl apply -k 'github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=26.8.0'
```

**Why**: matches the existing `keycloak-system` namespace already declared in
`install-prereqs.sh`; no new cluster prerequisite (OLM); single-namespace
watch is sufficient for a per-release install. OLM and Helm-cluster-wide are
documented as alternatives in the chart README but not implemented in the
install script.

**Pin**: tag `26.8.0` (current as of 2026-10-12 per the official docs). Configurable
via `KC_OPERATOR_VERSION` env in `install-prereqs.sh`.

### D2. CRD kinds + apiVersion (verified upstream)

| Kind | apiVersion | Was (archived) |
|---|---|---|
| `Keycloak` | `k8s.keycloak.org/v2beta1` | `Keycloak` at `keycloak.org/v1alpha1` (same name, different group) |
| `KeycloakRealmImport` | `k8s.keycloak.org/v2beta1` | `KeycloakRealm` at `keycloak.org/v1alpha1` (renamed) |

4 CRDs are installed cluster-wide by the operator: `keycloaks`,
`keycloakrealmimports`, `keycloakoidcclients`, `keycloaksamlclients` (last 2
NEW in 26). The chart renders only the first 2 — the realm import CR carries
the full client configuration; we do not need the per-client CRDs.

### D3. `Keycloak` spec schema (verified from CRD YAML at `26.8.0`)

```yaml
spec:
  instances: 1                              # integer; 2 on prod via clusterProfile
  db:
    vendor: postgres
    host: keycloak-db-rw.<ns>.svc.cluster.local
    port: 5432
    database: keycloak
    usernameSecret: { name: keycloak-db-credentials, key: username }
    passwordSecret: { name: keycloak-db-credentials, key: password }
  http:
    httpEnabled: true                       # TLS at Envoy Gateway
  hostname:
    strict: false                           # lab/staging; prod sets explicit hostname
  ingress:
    enabled: false                          # Envoy fronts
  proxy:
    headers: xforwarded                     # trust X-Forwarded-* from Envoy
  startOptimized: true
  update:
    strategy: RecreateOnImageChange
  resources:
    requests: { cpu: 500m, memory: 1700Mi }
    limits:   { cpu: 2,    memory: 2Gi }
```

**Field changes vs v1alpha1 (chart's old render)**:
- `spec.instances` — unchanged
- `spec.externalDatabase.enabled` → `spec.db` (full block)
- `spec.externalAccess` → `spec.http`
- new: `spec.proxy.headers` (required behind TLS-terminating reverse proxy;
  `KC_PROXY=edge` env was removed in KC 24+)
- new: `spec.startOptimized`
- new: `spec.update.strategy`
- `spec.hostname.strict: false` required in non-prod; pod refuses to start otherwise
- new: `spec.bootstrapAdmin` (the operator creates `<cr-name>-initial-admin` Secret
  with a temp password; deterministic admin via `spec.bootstrapAdmin.user`)

### D4. `KeycloakRealmImport` spec schema (verified upstream)

```yaml
spec:
  keycloakCRName: keycloak                  # ref by name in same namespace
  realm: <full RealmRepresentation — unchanged from current chart>
```

**Field change vs v1alpha1**:
- `spec.instanceSelector.matchLabels` → `spec.keycloakCRName` (string reference
  in the same namespace; NOT a label selector)
- realm body (clients, roles, users, smtp, etc.) is unchanged

### D5. Realm import is create-only

KeycloakRealmImport silently ignores changes to `spec.realm` on re-apply (status
stays `Done=True, HasErrors=False`, nothing changes in Keycloak). To re-import
after a spec change, the operator must `kubectl delete keycloakrealmimport -n
<ns> <name>` and re-apply. This is a fundamental Keycloak 26+ operator behavior,
not a chart bug. The chart documents this in the realm import template's
header comment so operators do not chase a phantom bug.

### D6. Values surface (additive, no renames)

New keys under `data.keycloak.*` (all with sensible defaults — existing
`values-override.yaml` files do not need to change):
- `db.secretName` (default `keycloak-db-credentials`)
- `http.httpEnabled` (default `true`)
- `hostname.strict` (default `false`)
- `proxy.headers` (default `xforwarded`)
- `startOptimized` (default `true`)
- `update.strategy` (default `RecreateOnImageChange`)
- `bootstrapAdmin.user.{username,password}` (deterministic admin; replaces the
  operator-created temp Secret)

Existing `instances`, `realmImport`, `adminEmail`, `verifyEmail`, `passwordPolicy`,
`supportedLocales`, `accessTokenLifespan`, `clientSecrets`, `failOnPlaceholderSecrets`,
`smtp`, `mobileClientId`, `mobileRedirectScheme` keys are preserved.

### D7. RBAC: 4 CRDs, one group

`dep-check-rbac.yaml` gains verbs on `k8s.keycloak.org` group, resources
`keycloaks`, `keycloakrealmimports`, `keycloakoidcclients`, `keycloaksamlclients`.
Cluster-scoped `get,list` (the dep-check Job reads CRs to verify they exist).

### D8. Install script: Kustomize replaces raw manifest

`scripts/install-prereqs.sh` `install_keycloak_operator()` function:
- Bumps `KC_OPERATOR_VERSION` default → `26.8.0`
- Replaces `curl ... | kubectl apply -f <raw manifest>` with
  `kubectl apply -k 'github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=${KC_OPERATOR_VERSION}'`
- Idempotency check: `kubectl get deployment keycloak-operator -n keycloak-system` → skip if present
- Namespace remains `keycloak-system`

### D9. CHANGELOG: 1 bullet, branch result vs main (Keep-a-Changelog 1.1.0)

```markdown
### Changed
- **Keycloak 26 official operator via Kustomize** (`charts/genieai-umbrella/` + `scripts/install-prereqs.sh`): the chart now targets `k8s.keycloak.org/v2beta1` CRDs (`Keycloak`, `KeycloakRealmImport`) installed by `kubectl apply -k github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=26.8.0`. The previous `keycloak.org/v1alpha1` schema (the archived upstream operator) is no longer supported — operators must delete the existing `Keycloak` and `KeycloakRealm` custom resources and let the chart re-render the new ones (the operator refuses schema migration). Realm bodies and the `data.keycloak.clientSecrets.*` values migrate verbatim. KeycloakRealmImport remains create-only: re-applying a changed `spec.realm` is silently ignored; re-import requires `kubectl delete keycloakrealmimport` + re-apply. (breaking)
```

## Files touched (5 chart + 1 script + 2 docs)

| File | Action |
|---|---|
| `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` | rewrite |
| `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml` | rewrite (kind + spec ref) |
| `charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml` | comment addition (RW service name) |
| `charts/genieai-umbrella/values.yaml` | additive keys under `data.keycloak` |
| `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml` | RBAC for 4 CRDs |
| `scripts/install-prereqs.sh` | `install_keycloak_operator()` rewrite |
| `charts/genieai-umbrella/README.md` | prerequisites table + alternative install methods |
| `CHANGELOG.md` | 1 bullet under `## [Unreleased]` → `### Changed` |

## Out of scope (deferred to a later task)

- OLM-based install (heavier prerequisite, would require OLM bootstrap script)
- Helm-cluster-wide install (`oci://quay.io/keycloak/keycloak-operator-helm`, marked experimental by official)
- Migration of `KeycloakOIDCClient` / `KeycloakSAMLClient` CRD rendering (the realm import covers all client config; not needed)
- Keycloak config drift reconciliation (keycloak-config-cli / Terraform provider) — known limitation, documented, out of scope for this release
- End-to-end smoke on a real cluster with the new operator — separate task (user flagged laptop not clean)
- Replacing the operator-created `*-initial-admin` temp Secret with a deterministic one in a future iteration (D6 keys are present but the temp Secret remains the default until overridden)

## Validation gate

Before MR open:
1. `helm template test charts/genieai-umbrella/ -n genieai --set data.keycloak.failOnPlaceholderSecrets=false | kubeconform -strict -summary -kubernetes-version 1.33.0` — catches CRD schema errors at render time
2. `helm lint charts/genieai-umbrella/ --strict` — chart-level lint
3. `cd charts && ct lint --config ci/ct.yaml` (if `ct` installed locally)
4. `bash -n scripts/install-prereqs.sh` — shell syntax check

Out of scope for this MR: end-to-end `kubectl apply -k` + `helm install` on a live cluster.
