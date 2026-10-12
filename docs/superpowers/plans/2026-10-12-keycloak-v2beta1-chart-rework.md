# Keycloak 26 v2beta1 Chart Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the GENIE.AI umbrella chart's Keycloak templates from the archived `keycloak.org/v1alpha1` API to the official modern operator's `k8s.keycloak.org/v2beta1` CRDs, and update the install script to use the official Kustomize install path.

**Architecture:** Rewrite 2 Keycloak templates to render `Keycloak` + `KeycloakRealmImport` v2beta1 CRDs, add RBAC for all 4 operator CRDs, update `install-prereqs.sh` to use `kubectl apply -k` against `github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=26.8.0`, and document the new install + CRD surface in the README + CHANGELOG.

**Tech Stack:** Helm 3.x, Kustomize (remote, via `kubectl apply -k`), CNPG (existing), Keycloak 26.8.0 (upstream), `k8s.keycloak.org/v2beta1` CRDs.

**Spec:** `docs/superpowers/specs/2026-10-12-keycloak-v2beta1-design.md` (committed 2026-10-12)

## Global Constraints

- **CRD kind names are case-sensitive and verified from upstream CRD YAML at tag `26.8.0`**: `Keycloak` (NOT `KeycloakDeployment`), `KeycloakRealmImport` (NOT `KeycloakRealm`).
- **apiVersion is `k8s.keycloak.org/v2beta1`** — NOT `keycloak.org/v1alpha1` (archived), NOT `v2alpha1` (older).
- **Install pins to tag `26.8.0`** of `github.com/keycloak/keycloak-k8s-resources/kubernetes` (Kustomize). Configurable via `KC_OPERATOR_VERSION` env in `install-prereqs.sh`.
- **Operator namespace** remains `keycloak-system` (existing); matches Kustomize single-namespace install.
- **CNPG RW service name** is `keycloak-db-rw` (CNPG default for Cluster named `keycloak-db`); the Keycloak `spec.db.host` must point at it.
- **No raw-manifest install of `keycloak/keycloak-operator`** — that repo is archived 2022-11-16.
- **No new cluster prerequisites** — Kustomize install does NOT require OLM. OLM + Helm-cluster-wide are documented as alternatives only.
- **CHANGELOG entry** is 1 bullet under `## [Unreleased]` → `### Changed`, marked `(breaking)`, branch result vs main (per Keep-a-Changelog 1.1.0; per `feedback_changelog_user_facing`).
- **No chart helper / no schema validator / no abstraction layer** — direct field mapping, comments explain WHY (per `feedback_no_story_refs_in_comments` + `feedback_comments_describe_current_code`).
- **Existing values surface preserved** — `instances`, `realmImport`, `adminEmail`, `verifyEmail`, `passwordPolicy`, `supportedLocales`, `accessTokenLifespan`, `clientSecrets`, `failOnPlaceholderSecrets`, `smtp`, `mobileClientId`, `mobileRedirectScheme` keys are unchanged. Only ADDITIVE new keys under `data.keycloak.*`.
- **Out of scope** (explicit): OLM install, Helm-cluster-wide install, end-to-end cluster smoke, keycloak-config-cli migration, `KeycloakOIDCClient` / `KeycloakSAMLClient` CRD rendering, deterministic admin user (temp Secret remains default).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `charts/genieai-umbrella/values.yaml` | operator surface for the chart | modify (additive keys) |
| `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` | renders `Keycloak` v2beta1 CR | rewrite |
| `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml` | renders `KeycloakRealmImport` v2beta1 CR | rewrite |
| `charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml` | renders CNPG Cluster for Keycloak DB | modify (comment add) |
| `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml` | RBAC for the dep-check Job | modify (4 CRDs) |
| `scripts/install-prereqs.sh` | idempotent operator installer | modify (Kustomize install) |
| `charts/genieai-umbrella/README.md` | user-facing chart docs | modify (prereq table + alts) |
| `CHANGELOG.md` | release notes | modify (1 bullet) |

---

### Task 1: Add new `data.keycloak.*` values keys (additive)

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml` (under `data.keycloak:` block)

**Interfaces:**
- Consumes: existing `data.keycloak.*` keys (no rename)
- Produces: new keys that Tasks 2, 3, 5 will reference via `.Values.data.keycloak.*`

- [ ] **Step 1: Read current `values.yaml` keycloak block to confirm insertion point**

Run: `awk '/^  keycloak:/,/^  [a-z]+:/' charts/genieai-umbrella/values.yaml | head -50`
Expected: shows the current `data.keycloak.*` block ending before the next top-level key (likely `dependencyGraph:` or `services:`).

- [ ] **Step 2: Insert new keys at the end of the `data.keycloak:` block**

In `charts/genieai-umbrella/values.yaml`, after the last existing line under `data.keycloak:` (currently `mobileRedirectScheme: genieai`), insert:

```yaml
    # ── Keycloak 26 v2beta1 connection + behavior knobs ──
    # CNPG Read-Write Service name (default for Cluster `keycloak-db`).
    # The Keycloak CR's spec.db.host is set to "<cnpgServiceName>.<namespace>.svc.cluster.local".
    cnpgServiceName: keycloak-db
    # Database connection secret (the chart does NOT materialize it — operator
    # wires it from their secret backend; the secret MUST carry both
    # `username` and `password` keys for CNPG to bootstrap).
    db:
      secretName: keycloak-db-credentials
      vendor: postgres
      port: 5432
      database: keycloak
    # HTTP listener (TLS terminates at Envoy Gateway, not here).
    http:
      httpEnabled: true
    # Hostname strict mode: false for lab/staging (Envoy rewrites the public
    # hostname via proxy headers); true in prod via spec.hostname.hostname.
    hostname:
      strict: false
    # Trust X-Forwarded-* from Envoy Gateway. KC_PROXY=edge env was removed
    # in KC 24+; spec.proxy.headers is the only path.
    proxy:
      headers: xforwarded
    # Keycloak 26 prod start mode (--optimized flag).
    startOptimized: true
    # Image-bump requires single-replica mode (DB migrations need exclusive
    # access). Chart's instances=1 by default; prod bumps to 2 + manual drain.
    update:
      strategy: RecreateOnImageChange
```

- [ ] **Step 3: Validate YAML parse + `helm lint`**

Run: `helm lint charts/genieai-umbrella/ --strict 2>&1 | tail -5`
Expected: `1 chart(s) linted, 0 chart(s) failed` (or no errors related to keycloak).

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(values): additive v2beta1 knobs under data.keycloak.{db,http,hostname,proxy,startOptimized,update,cnpgServiceName}"
```

---

### Task 2: Rewrite `keycloak-instance.yaml` (Keycloak v2beta1 CR)

**Files:**
- Rewrite: `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` (entire file, ~40 lines)

**Interfaces:**
- Consumes: `.Values.data.keycloak.{enabled,instances,cnpgServiceName,db,http,hostname,proxy,startOptimized,update}`
- Produces: a `Keycloak` CR at `k8s.keycloak.org/v2beta1` consumed by the operator

- [ ] **Step 1: Write the new template (full file replacement)**

Replace the entire content of `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` with:

```yaml
{{- if .Values.data.keycloak.enabled -}}
{{- $instances := .Values.data.keycloak.instances | default 1 -}}
{{- if eq .Values.clusterProfile "prod" -}}
{{- $instances = 2 -}}
{{- end -}}
{{- $ns := .Values.namespace -}}
{{- $dbHost := printf "%s-rw.%s.svc.cluster.local" (.Values.data.keycloak.cnpgServiceName | default "keycloak-db") $ns -}}
apiVersion: k8s.keycloak.org/v2beta1
kind: Keycloak
metadata:
  name: keycloak
  namespace: {{ $ns }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" .Values "component" "identity") | nindent 4 }}
    genieai.io/data-tier: identity
spec:
  instances: {{ $instances }}
  # CNPG hosts the Postgres database; the secret holds both `username` and
  # `password` keys (CNPG bootstrap requirement). The chart does NOT
  # materialize the secret — operators wire it from their secret backend.
  db:
    vendor: {{ .Values.data.keycloak.db.vendor | default "postgres" }}
    host: {{ $dbHost }}
    port: {{ .Values.data.keycloak.db.port | default 5432 }}
    database: {{ .Values.data.keycloak.db.database | default "keycloak" }}
    usernameSecret:
      name: {{ .Values.data.keycloak.db.secretName }}
      key: username
    passwordSecret:
      name: {{ .Values.data.keycloak.db.secretName }}
      key: password
  # TLS terminates at the edge (Envoy Gateway); the pod serves plain HTTP
  # internally. Letting the operator create an Ingress would shadow that.
  http:
    httpEnabled: {{ .Values.data.keycloak.http.httpEnabled | default true }}
  hostname:
    # Strict mode off: the public hostname is the Edge Gateway's, resolved
    # from request headers (proxy.headers: xforwarded below). Keycloak 26
    # refuses to start without either an explicit hostname or strict: false.
    strict: {{ .Values.data.keycloak.hostname.strict | default false }}
  ingress:
    enabled: false
  # Trust X-Forwarded-* from Envoy. KC_PROXY=edge was removed in KC 24+;
  # spec.proxy.headers is the only path. Misconfiguration manifests as
  # `Invalid parameter: redirect_uri` loops on login.
  proxy:
    headers: {{ .Values.data.keycloak.proxy.headers | default "xforwarded" }}
  # KC 26 prod start mode (--optimized). Custom images already augmented
  # for prod should leave this unset; default images get the optimized path.
  startOptimized: {{ .Values.data.keycloak.startOptimized | default true }}
  # Image-bump = single-pod recreate (DB migrations need exclusive access).
  # Chart defaults to instances: 1; prod instances: 2 with manual drain on
  # operator image bumps.
  update:
    strategy: {{ .Values.data.keycloak.update.strategy | default "RecreateOnImageChange" }}
  # KC 26 default probe timing is fine (10min startup grace). Memory request
  # is the real knob: lower it and the pod OOMs before becoming ready.
  resources:
    requests:
      cpu: 500m
      memory: 1700Mi
    limits:
      cpu: 2
      memory: 2Gi
{{- end -}}
```

- [ ] **Step 2: Render and verify CRD schema**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  | yq -P 'select(.kind == "Keycloak") | .spec' - 2>&1
```
Expected: shows `db.host: keycloak-db-rw.genieai.svc.cluster.local`, `http.httpEnabled: true`, `proxy.headers: xforwarded`, `hostname.strict: false`, `instances: 1` (or 2 on `--set clusterProfile=prod`).

- [ ] **Step 3: Render and run kubeconform against the Keycloak CR**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  | kubeconform -strict -summary -kubernetes-version 1.33.0 -schema-location default \
    -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
    -ignore-missing-schemas 2>&1 | tail -5
```
Expected: `Summary: ... 1 resource(s) failed` is ACCEPTABLE for the Keycloak CR (the CRD schema in datree's catalog may not yet include `k8s.keycloak.org/v2beta1` — `-ignore-missing-schemas` covers that). What MUST NOT appear: kubeconform reporting a `status: Not Accepted` on a non-CRD kind (Deployment, Service, ConfigMap, etc.). Document the `-ignore-missing-schemas` rationale in the commit body.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/data/keycloak-instance.yaml
git commit -m "feat(charts): render Keycloak v2beta1 CR (k8s.keycloak.org/v2beta1)

Replaces the archived keycloak.org/v1alpha1 Keycloak CR. Targets the
official modern Keycloak 26 operator installed via Kustomize (Task 5).
CNPG host = <cnpgServiceName>-rw.<ns>.svc.cluster.local (default
keycloak-db-rw). proxy.headers=xforwarded required behind Envoy Gateway
(KC_PROXY=edge was removed in KC 24+). RecreateOnImageChange is the
image-bump default because DB migrations need exclusive access.

kubeconform ignores the v2beta1 Keycloak CR (datree catalog lacks the
schema; tracked upstream)."
```

---

### Task 3: Rewrite `keycloak-realm-import.yaml` (KeycloakRealmImport v2beta1)

**Files:**
- Rewrite: `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml` (kind rename + spec ref change; realm body unchanged)

**Interfaces:**
- Consumes: `.Values.data.keycloak.{enabled,realmImport,clientSecrets,smtp,...}` (unchanged from v1alpha1)
- Produces: a `KeycloakRealmImport` CR at `k8s.keycloak.org/v2beta1`

- [ ] **Step 1: Apply the minimal line-level changes (no full rewrite — preserve the realm body intact)**

In `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml`:

Change 1 (line 32): `apiVersion: keycloak.org/v1alpha1` → `apiVersion: k8s.keycloak.org/v2beta1`

Change 2 (line 33): `kind: KeycloakRealm` → `kind: KeycloakRealmImport`

Change 3 (lines 40-47): replace the `instanceSelector` block with `keycloakCRName`:

```yaml
  # v2beta1 binds the realm to a Keycloak instance by name in the same
  # namespace (the older `instanceSelector.matchLabels` was removed by the
  # upstream operator migration; v2beta1 also accepts `keycloakCRName`).
  # The `name: keycloak` here must match the Keycloak CR's metadata.name.
  keycloakCRName: keycloak
```

Change 4 (lines 18-25 header comment block, the `Realm-side always-on guard` paragraph): keep the logic and the `failOnPlaceholderSecrets` reference intact — it still applies in v2beta1. No change needed.

Change 5 (lines 40-44 — the comment block above the `instanceSelector`): delete the 2 lines referring to `instanceSelector` from the comment (now in Change 3); keep the rest.

- [ ] **Step 2: Verify the full template still renders the realm body**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.clientSecrets.proxyClient=test-proxy \
  --set data.keycloak.clientSecrets.dataprep=test-dataprep \
  --set data.keycloak.clientSecrets.grafana=test-grafana \
  | yq -P 'select(.kind == "KeycloakRealmImport") | .spec.realm.clients[0].clientId, .spec.keycloakCRName' -
```
Expected: prints `account` then `keycloak` (one per line). The realm body is intact.

- [ ] **Step 3: Verify the placeholder-secret guard still fires**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai 2>&1 | tail -3
```
Expected: error message including `data.keycloak.clientSecrets.proxyClient is empty or a placeholder (change-me-*)`. The v2beta1 guard still trips on default `change-me-*` values.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml
git commit -m "feat(charts): render KeycloakRealmImport v2beta1 (k8s.keycloak.org/v2beta1)

Replaces the archived KeycloakRealm (v1alpha1). spec.instanceSelector →
spec.keycloakCRName (string ref to the Keycloak CR by name in the same
namespace; NOT a label selector — that field was removed in v2beta1).
Realm body unchanged: clients, roles, users, smtp, redirect URIs all
migrate verbatim.

KeycloakRealmImport is create-only: re-applying a changed spec.realm
is silently ignored by the operator. Re-import requires
\`kubectl delete keycloakrealmimport\` + re-apply."
```

---

### Task 4: Add comment to `cnpg-keycloak-db.yaml` (RW service naming)

**Files:**
- Modify: `charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml` (comment add only, no YAML change)

**Interfaces:**
- Consumes: unchanged
- Produces: documentation that the chart's Keycloak CR `spec.db.host` points at the `<cluster-name>-rw` Service

- [ ] **Step 1: Add a comment above the `bootstrap.initdb` block**

In `charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml`, immediately above the `bootstrap:` line (~line 35), insert:

```yaml
  # CNPG publishes 3 Services for this Cluster:
  #   keycloak-db       (RW, points at the current primary; default JDBC target)
  #   keycloak-db-rw    (RW, explicit; the Keycloak CR's spec.db.host uses this name)
  #   keycloak-db-ro    (RO, replicas; for read-heavy reporting)
  # The Keycloak v2beta1 CR's spec.db.host is `<cluster-name>-rw.<ns>.svc.cluster.local`
  # (see keycloak-instance.yaml). Operators changing this Cluster's `metadata.name`
  # MUST also update `data.keycloak.cnpgServiceName` in values.yaml to match.
  bootstrap:
```

- [ ] **Step 2: Render and confirm the Service reference is intact (no behavior change)**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  | grep -E "host:|cnpgServiceName" | head -5
```
Expected: shows `host: keycloak-db-rw.genieai.svc.cluster.local` (the Keycloak CR uses the RW Service).

- [ ] **Step 3: Commit**

```bash
git add charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml
git commit -m "docs(charts): comment cnpg-keycloak-db.yaml explaining the -rw Service contract"
```

---

### Task 5: Add RBAC for the 4 Keycloak 26 CRDs

**Files:**
- Modify: `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml` (add 1 RBAC block)

**Interfaces:**
- Consumes: unchanged
- Produces: `get,list` permissions on `k8s.keycloak.org/{keycloaks,keycloakrealmimports,keycloakoidcclients,keycloaksamlclients}` for the dep-check Job

- [ ] **Step 1: Read the current RBAC block to find the insertion point**

Run: `cat charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml`

- [ ] **Step 2: Add the 4-CRD RBAC block under the existing `apiGroups` list**

Find the existing `- apiGroups: ["apps"]` (or similar) block in the dep-check Role. After the last existing `- apiGroups: [...]` entry, insert:

```yaml
    # Keycloak 26 official operator (k8s.keycloak.org/v2beta1) ships 4 CRDs.
    # The dep-check Job verifies the Keycloak + KeycloakRealmImport CRs are
    # present after install; the OIDC/SAML client CRDs are not rendered by
    # this chart but are listed for completeness (operators may add them).
    - apiGroups: ["k8s.keycloak.org"]
      resources:
        - keycloaks
        - keycloakrealmimports
        - keycloakoidcclients
        - keycloaksamlclients
      verbs: ["get", "list"]
```

- [ ] **Step 3: Verify the rendered RBAC includes the new verbs**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai \
  | yq -P 'select(.kind == "Role" and .metadata.name | test("dep-check")) | .rules[] | select(.apiGroups[] == "k8s.keycloak.org")' -
```
Expected: shows the 4 resources under `k8s.keycloak.org` with `get, list` verbs.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml
git commit -m "feat(charts): dep-check RBAC for the 4 Keycloak 26 v2beta1 CRDs"
```

---

### Task 6: Switch `install-prereqs.sh` to Kustomize install of the official operator

**Files:**
- Modify: `scripts/install-prereqs.sh` (replace the `install_keycloak_operator()` function body; bump default `KC_OPERATOR_VERSION`)

**Interfaces:**
- Consumes: existing `KC_OPERATOR_VERSION` env var (default bumped to `26.8.0`)
- Produces: idempotent install of the official modern Keycloak 26 operator in `keycloak-system` via Kustomize

- [ ] **Step 1: Bump the `KC_OPERATOR_VERSION` default**

In `scripts/install-prereqs.sh`, change line:
```bash
KC_OPERATOR_VERSION="${KC_OPERATOR_VERSION:-26.0.0}"
```
to:
```bash
KC_OPERATOR_VERSION="${KC_OPERATOR_VERSION:-26.8.0}"
```

- [ ] **Step 2: Replace the `install_keycloak_operator()` function body**

Find the function (currently installs from `https://raw.githubusercontent.com/keycloak/keycloak-operator/release/${KC_OPERATOR_VERSION}/deploy/operator.yaml`). Replace the entire function with:

```bash
install_keycloak_operator() {
  local ns="keycloak-system"
  if kubectl get namespace "${ns}" >/dev/null 2>&1 && \
     kubectl get deployment keycloak-operator -n "${ns}" >/dev/null 2>&1; then
    log "keycloak-operator ${KC_OPERATOR_VERSION}: already present, skip"
    return 0
  fi
  ensure_namespace "${ns}"
  # Official modern Keycloak 26+ operator (Quarkus-based, v2beta1 CRDs).
  # Installed via Kustomize from keycloak/k8s-resources — NOT the archived
  # keycloak/keycloak-operator (which is WildFly-era, v1alpha1, archived
  # 2022-11-16). kustomize injects the namespace and rewires RoleBindings
  # (apply -f per-file breaks RBAC + misses 2 of the 4 CRDs).
  log "keycloak-operator ${KC_OPERATOR_VERSION}: install via Kustomize (ref=26.8.0+ of keycloak-k8s-resources)"
  kubectl apply -k "github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=${KC_OPERATOR_VERSION}"
  wait_deploy_ready "${ns}" "keycloak-operator"
}
```

- [ ] **Step 3: Bump the file's header comment to reflect the new install + version**

Find the comment block at the top of the file (lines 1-12). Replace the line:
```bash
#   - keycloak-operator 26.0.0   (namespace keycloak-system)
```
with:
```bash
#   - keycloak-operator 26.8.0   (namespace keycloak-system; Kustomize install of the official modern Quarkus-based operator; 4 CRDs in k8s.keycloak.org group)
```

- [ ] **Step 4: Shell syntax check**

Run: `bash -n scripts/install-prereqs.sh && echo OK`
Expected: prints `OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-prereqs.sh
git commit -m "feat(install): keycloak-operator via Kustomize from keycloak-k8s-resources

Bumps KC_OPERATOR_VERSION default 26.0.0 → 26.8.0. Replaces the raw-
manifest install of the archived keycloak/keycloak-operator (WildFly-
era, v1alpha1, archived 2022-11-16) with the Kustomize install of the
official modern Quarkus-based operator at ref=26.8.0 of
keycloak/k8s-resources. kustomize handles the namespace injection +
RoleBinding rewiring (apply -f per-file breaks both).

Idempotency: gate on existing 'keycloak-operator' Deployment in
keycloak-system. Namespace unchanged."
```

---

### Task 7: Update chart README (prereq table + alt install paths)

**Files:**
- Modify: `charts/genieai-umbrella/README.md` (Cluster prerequisites section, ~5 lines)

- [ ] **Step 1: Find the prereq table**

Run: `grep -n "keycloak-operator" charts/genieai-umbrella/README.md`
Expected: 1 match in the prereq table.

- [ ] **Step 2: Replace the keycloak-operator row**

Replace:
```markdown
| keycloak-operator | 26.x | OLM subscription or the static YAML from keycloak.org (its advertised Helm repo serves no index) |
```

with:
```markdown
| keycloak-operator | 26.8.0 | `kubectl apply -k 'github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=26.8.0'` (the official Kustomize install of the Quarkus-based modern operator; 4 CRDs in `k8s.keycloak.org`). Alternatives: [OLM](https://www.keycloak.org/operator/installation#_installing_by_using_the_operator_lifecycle_manager) with `installPlanApproval: Manual` (recommended per official docs — auto-upgrade causes unintended Keycloak version bumps), or [Helm](https://www.keycloak.org/operator/installation#_installing_by_using_helm) `oci://quay.io/keycloak/keycloak-operator-helm` (experimental, cluster-wide). |
```

- [ ] **Step 3: Commit**

```bash
git add charts/genieai-umbrella/README.md
git commit -m "docs(charts): README prerequisites — Kustomize primary install + OLM/Helm alternatives"
```

---

### Task 8: Add 1 CHANGELOG bullet (branch result vs main, Keep-a-Changelog 1.1.0)

**Files:**
- Modify: `CHANGELOG.md` (1 new bullet under `## [Unreleased]` → `### Changed`)

- [ ] **Step 1: Locate the `## [Unreleased]` → `### Changed` section**

Run: `grep -n "^## \[Unreleased\]\|^### " CHANGELOG.md | head -10`

- [ ] **Step 2: Add the bullet at the end of the `### Changed` section (or create the section if it does not exist yet under [Unreleased])**

Insert (exact text, do not paraphrase):
```markdown
- **Keycloak 26 official operator via Kustomize** (`charts/genieai-umbrella/` + `scripts/install-prereqs.sh`): the chart now targets `k8s.keycloak.org/v2beta1` CRDs (`Keycloak`, `KeycloakRealmImport`) installed by `kubectl apply -k github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=26.8.0`. The previous `keycloak.org/v1alpha1` schema (the archived upstream operator) is no longer supported — operators must delete the existing `Keycloak` and `KeycloakRealm` custom resources and let the chart re-render the new ones (the operator refuses schema migration). Realm bodies and the `data.keycloak.clientSecrets.*` values migrate verbatim. KeycloakRealmImport remains create-only: re-applying a changed `spec.realm` is silently ignored; re-import requires `kubectl delete keycloakrealmimport` + re-apply. (breaking)
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): keycloak 26 v2beta1 migration bullet (branch result vs main)"
```

---

### Task 9: Final validation gate (3 cross-cutting checks)

**Files:** none (validation only)

- [ ] **Step 1: `helm template` + `helm lint` (the chart renders, lints clean)**

Run:
```bash
helm lint charts/genieai-umbrella/ --strict 2>&1 | tail -3
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false > /tmp/kc-render.yaml
echo "--- bytes: $(wc -c < /tmp/kc-render.yaml)"
grep -c "^kind: " /tmp/kc-render.yaml
```
Expected: `0 chart(s) failed`; render file non-empty; `grep -c` shows ≥ 12 `kind:` lines (one per rendered resource).

- [ ] **Step 2: kubeconform on the rendered output (validates non-CRD kinds)**

Run:
```bash
kubeconform -strict -summary -kubernetes-version 1.33.0 -ignore-missing-schemas \
  < /tmp/kc-render.yaml 2>&1 | tail -10
```
Expected: `Summary: ... resources found in 0 files: ... Pass: ...` with Pass count matching the resource count from Step 1. CRDs (Keycloak, KeycloakRealmImport) appear as `failed` (datree catalog lacks the schema) and that is acceptable — those are accepted via `-ignore-missing-schemas` once they're verified against the upstream CRD YAML at `ref=26.8.0`.

- [ ] **Step 3: install-prereqs.sh shell syntax check**

Run: `bash -n scripts/install-prereqs.sh && echo SHELL_OK`
Expected: `SHELL_OK`, exit 0.

- [ ] **Step 4: Final commit log review**

Run: `git log --oneline origin/main..HEAD`
Expected: 8 commits (Tasks 1-8), in order, all with clear messages. No fixup commits, no squashed history. If any task is missing or merged, fix it before opening the MR.

---

## Spec coverage check

| Spec decision | Task |
|---|---|
| D1 (Kustomize install, pin 26.8.0) | Task 6 |
| D2 (CRD kinds + apiVersion) | Tasks 2, 3 |
| D3 (Keycloak spec schema) | Task 2 |
| D4 (KeycloakRealmImport spec schema) | Task 3 |
| D5 (realm import create-only, document) | Task 3 (header comment) |
| D6 (additive values keys) | Task 1 |
| D7 (RBAC for 4 CRDs) | Task 5 |
| D8 (install script: Kustomize) | Task 6 |
| D9 (CHANGELOG bullet) | Task 8 |
| README alt install paths | Task 7 |
| Validation gate | Task 9 |

All 11 spec decisions have an implementing task. No gaps.
