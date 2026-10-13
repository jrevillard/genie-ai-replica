# Keycloak Config Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the create-only `KeycloakRealmImport` with keycloak-config-cli as the sole owner of the Keycloak realm, closing four defects: non-updatable clients, literal secrets in a CR, `genie-admin` with no credentials, and a leaked import Job/Pod.

**Architecture:** The `Keycloak` CR (v2beta1) owns infrastructure and carries `bootstrapAdmin.user.secret` plus `http-relative-path: /auth`. The realm body is a chart file (`files/genie-realm.yaml`) already parameterised by 32 distinct `$(env:VAR)` placeholders (40 occurrences) — the chart does not re-render it, it only wires the environment those placeholders resolve from. A Helm `post-upgrade` hook Job runs keycloak-config-cli against the Admin REST API, so the realm is created on first install and converged on every later release.

**Tech Stack:** Helm 4.x chart API v2, Sprig (`.Files.Get`, `regexFindAll`, `dig`), Keycloak 26 operator (`k8s.keycloak.org/v2beta1`), `adorsys/keycloak-config-cli:6.5.0-26`, Docker, GitLab CI.

**Spec:** `docs/superpowers/specs/2026-10-12-keycloak-config-convergence-design.md` (rev 5, committed 2026-10-13). The spec is the binding authority; where this plan and the spec disagree, the spec wins — record the ruling in the ledger and keep going.

## Global Constraints

- **`$(env:VAR)` in the realm file is load-bearing — never change it to `${env:VAR}`.** Project rule from `_bmad-output/project-context.md`, written after a code-review commit (`f1eae7c`) made exactly that change and broke the import with `Cannot create realm '${env:KC_REALM}': HTTP 400 Bad Request`. The prefix/suffix are configurable via `IMPORT_VARSUBSTITUTION_PREFIX` / `_SUFFIX`, and `IMPORT_VARSUBSTITUTION_ENABLED=true` must stay set on the Job. This is why Task 1 copies the file byte-for-byte and touches no line of it, in either location.
- **Service name is `keycloak-service`, not `<release>-keycloak`.** Upstream `Constants.KEYCLOAK_SERVICE_SUFFIX = "-service"` (verified at tag 26.8.0); the CR's `metadata.name` is hardcoded `keycloak`. Port is `8080` (`Constants.KEYCLOAK_HTTP_PORT`).
- **Every Keycloak URL in the chart carries `/auth`**, because D7 sets `additionalOptions: [{name: http-relative-path, value: /auth}]`. `templates/services/backend.yaml:6` and `documentRepository.yaml:17` already do.
- **`additionalOptions` is a `List<ValueOrSecret>`** with fields `name`, `value`, `secret` (verified in `KeycloakSpec.java` at 26.8.0). The flag key is `http-relative-path`.
- **`bootstrapAdmin.service` is NOT configured.** It would only serve the rejected `KeycloakOIDCClient` CRDs. Nothing consumes it.
- **No client secret is ever rendered as a literal.** Secrets reach the Job only through `valueFrom.secretKeyRef`.
- **`failOnPlaceholderSecrets` keeps its `true` default.** A default `helm install` with `change-me-*` client secrets must fail at render time.
- **The chart stays secret-backend agnostic.** It references Secret names and never materializes Secrets or reads their values.
- **Comments describe the current code** — no story refs, no `T7`/`laptop`/`hardening`/`wave N`, no historical-bug narrative.
- **CHANGELOG is the branch result vs `main`**, operator-facing, present tense, Keep-a-Changelog 1.1.0, `(breaking)` where applicable. Never a commit-by-commit narrative.
- **kcc image tag is `adorsys/keycloak-config-cli:6.5.0-26`.** The `-26` suffix encodes the Keycloak major version; a Keycloak major bump requires a matching tag bump.
- Do NOT modify `deploy/ansible/group_vars/**` (feature-branch vars.yml is forbidden). Pass values through `values-override.yaml` files instead.

### Installation impact of the file copy

The copy changes **nothing** outside the chart. The compose and Swarm paths never read the chart's copy:

| Path | What changes | What does not |
|---|---|---|
| `docker compose build` (dev) | Nothing. `Dockerfile.config-cli` still COPYs `configs/keycloak/genie-realm.yaml` from the unchanged `configs/keycloak/` build context. | The image is bit-for-bit what it was. `IMPORT_FILES=/config/genie-realm.yaml` is unchanged. |
| Ansible / Swarm (prod) | Nothing. Ansible pulls `genie-ai-keycloak-config` from the registry (`deploy/ansible/tasks/deploy-shared-facts.yml:33` lists it as an image); it never reads the repo path. | The playbook is not touched. No vars.yml change. No re-deploy needed for this task. |
| Docs | Nothing. `deploy/ansible/README.md:730` still points at `configs/keycloak/genie-realm.yaml`, which still exists. | — |

Helm never invokes Docker, so the chart's copy and the image's copy have no runtime coupling — which is exactly why duplicating them is safe here and why the equivalence has to be asserted instead of structural.


---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `charts/genieai-umbrella/files/genie-realm.yaml` | byte-identical copy of `configs/keycloak/genie-realm.yaml`, mounted by the convergence Job |
| `charts/genieai-umbrella/templates/data/keycloak-instance.yaml` | `Keycloak` v2beta1 CR: infra + `bootstrapAdmin.user.secret` + `http-relative-path` |
| `charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml` | **new** — kcc post-upgrade hook Job, carrying the `change-me-*` guard and the `$(env:VAR)` completeness assertion |
| `charts/genieai-umbrella/templates/data/keycloak-realm-secret.yaml` | **new** — the realm file rendered into a Secret from `.Files.Get` |
| `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml` | **deleted** — kcc owns the realm |
| `charts/genieai-umbrella/values.yaml` | convergence surface + D8 mapping comments; `bootstrapAdmin.user.{username,password}` removed |
| `.gitlab-ci.yml` | `chart:lint` gains the drift `diff` assertion and a `configs/keycloak/**/*` change trigger |

---

### Task 1: Copy the realm file into the chart and guard the duplication

**Files:**
- Create: `charts/genieai-umbrella/files/genie-realm.yaml`
- Modify: `.gitlab-ci.yml` (`chart:lint`)

**Interfaces:**
- Consumes: `configs/keycloak/genie-realm.yaml` (the existing compose copy, unchanged)
- Produces: `charts/genieai-umbrella/files/genie-realm.yaml` — read by Tasks 4 and 5 via `.Files.Get "files/genie-realm.yaml"`

The realm file is **copied, not moved**. Moving it would force the Docker build context from `configs/keycloak/` to the repo root — Docker rejects a `COPY` outside the context, and *both* `COPY` lines in `Dockerfile.config-cli` are relative to that context, so both break. That cascade would touch the Dockerfile, `docker-compose.yaml`, the CI `CONTEXT`, and the path lists on three `keycloak-config` jobs, and would invalidate doc references. Duplication costs less than that blast radius, and a CI assertion makes the drift loud instead of silent.

Nothing in this task touches the Swarm or compose path.

- [ ] **Step 1: Copy the file byte-for-byte**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration
mkdir -p charts/genieai-umbrella/files
cp configs/keycloak/genie-realm.yaml charts/genieai-umbrella/files/genie-realm.yaml
cmp configs/keycloak/genie-realm.yaml charts/genieai-umbrella/files/genie-realm.yaml \
  && echo "IDENTICAL"
```

Expected: `IDENTICAL`. Never edit the copy — the `$(env:VAR)` syntax is load-bearing (see Global Constraints).

- [ ] **Step 2: Add the drift assertion to `chart:lint`**

In `.gitlab-ci.yml`, in the `chart:lint` job's `script:`, add as the first step:

```yaml
    # The realm file is duplicated: this copy is for the chart's
    # convergence Job, configs/keycloak/genie-realm.yaml is COPYed into
    # the compose image. They must stay byte-identical or the two
    # delivery paths deploy different realms.
    - cmp -s charts/genieai-umbrella/files/genie-realm.yaml configs/keycloak/genie-realm.yaml || { echo "realm file drift between the chart copy and the compose copy - update both"; exit 1; }
```

- [ ] **Step 3: Make `chart:lint` fire when only the compose copy changes**

In the same job, `rules:changes:paths` currently lists `charts/**/*`, `scripts/**/*`, `.gitlab-ci.yml`. Add `configs/keycloak/**/*` to **both** path lists (the MR-event one and the branch one) so an edit to the compose copy alone cannot skip the assertion above.

```yaml
      paths:
        - charts/**/*
        - scripts/**/*
        - configs/keycloak/**/*
        - .gitlab-ci.yml
```

- [ ] **Step 4: Prove the assertion fires on drift**

```bash
printf '\n# drift\n' >> charts/genieai-umbrella/files/genie-realm.yaml
cmp -s charts/genieai-umbrella/files/genie-realm.yaml configs/keycloak/genie-realm.yaml; echo "exit=$?"
git checkout -- charts/genieai-umbrella/files/genie-realm.yaml 2>/dev/null || \
  cp configs/keycloak/genie-realm.yaml charts/genieai-umbrella/files/genie-realm.yaml
```

Expected: `exit=1` (no output — `cmp -s` is silent by design; the CI form adds the `echo` message). Then confirm the file is restored with `cmp -s a b; echo "exit=$?"` → `exit=0`.

- [ ] **Step 5: Confirm the compose path is untouched**

```bash
git status --porcelain | grep -E 'configs/keycloak|docker-compose|Dockerfile' || echo "UNTOUCHED"
docker compose config >/dev/null && echo "COMPOSE_OK"
```

Expected: `UNTOUCHED` and `COMPOSE_OK`.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/files/genie-realm.yaml .gitlab-ci.yml
git commit -m "feat(charts): copy the realm file for the convergence Job, guard the drift

The chart needs the realm body at render time; the compose image already
COPYs configs/keycloak/genie-realm.yaml. Rather than move the file and
force the Docker build context to the repo root — which would break
both COPY lines in Dockerfile.config-cli, and with them docker-compose,
the CI job context, three path lists and the doc references — the file
is duplicated and the duplication is asserted.

chart:lint byte-compares the two copies and its change-trigger list gains
configs/keycloak/**/*, so an edit to the compose copy alone cannot skip
the assertion. Without that second part the drift ships silently."
```

### Task 2: Keycloak CR — bootstrap admin and the `/auth` relative path

**Files:**
- Modify: `charts/genieai-umbrella/templates/data/keycloak-instance.yaml`

**Interfaces:**
- Consumes: `data.keycloak.bootstrapAdmin.userSecret` (default `keycloak-admin-credentials`), added in Task 3
- Produces: a `Keycloak` CR that the dep-check Job and the convergence Job both address at `http://keycloak-service.<ns>.svc.cluster.local:8080/auth`

- [ ] **Step 1: Add `bootstrapAdmin.user.secret` to the CR spec**

In `charts/genieai-umbrella/templates/data/keycloak-instance.yaml`, insert immediately after the `spec:` line, before `instances:`:

```yaml
  # The convergence Job authenticates with these credentials, so they
  # must exist before it runs — otherwise its first token call returns
  # 401 and the release fails. The Secret is operator-provided; the
  # chart references it by name and never reads its contents.
  #
  # Upstream caveat: if a master realm already exists on the cluster,
  # the operator ignores this stanza entirely. The symptom is a 401 on
  # the Job's first authenticated call — not a clearer message.
  bootstrapAdmin:
    user:
      secret: {{ .Values.data.keycloak.bootstrapAdmin.userSecret | default "keycloak-admin-credentials" }}
```

- [ ] **Step 2: Add the `http-relative-path` start option**

In the same file, insert at the end of the `spec:` block, after `resources:`:

```yaml
  # templates/services/backend.yaml and documentRepository.yaml both dial
  # `.../keycloak-service:8080/auth`. Nothing else configures that prefix
  # on Kubernetes — in the Swarm path NGINX routes /auth/* — so without
  # this option Keycloak serves at / and every authenticated request 404s.
  additionalOptions:
    - name: http-relative-path
      value: /auth
```

- [ ] **Step 3: Render and confirm both fields land**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --output-dir /tmp/kc-t2 \
  && python3 -c 'import yaml,sys; d=yaml.safe_load(open("/tmp/kc-t2/genieai-umbrella/templates/data/keycloak-instance.yaml")); print(yaml.safe_dump({"bootstrap": d["spec"]["bootstrapAdmin"], "opts": d["spec"]["additionalOptions"]}, sort_keys=False))'
```

(`yq` is not installed on this machine; PyYAML 6.0.3 is. Do not install a tool
for a one-off assertion — assert with what is already here.)

Expected:
```yaml
bootstrap:
  user:
    secret: keycloak-admin-credentials
opts:
  - name: http-relative-path
    value: /auth
```

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/data/keycloak-instance.yaml
git commit -m "fix(charts): keycloak CR — bootstrap admin and /auth relative path

Two additions to the Keycloak v2beta1 CR.

bootstrapAdmin.user.secret gives the operator an administrator to
create in the master realm, which the convergence Job authenticates
with. The chart references the Secret by name and never reads it.

additionalOptions sets http-relative-path to /auth. The backend and
document-repository templates both dial
http://keycloak-service:8080/auth, but nothing configured Keycloak to
serve under that prefix — the Swarm path gets it from NGINX routing
/auth/*, and Kubernetes has no such layer. Without it every
authenticated request 404s, and the failure only surfaces at the first
user login.

bootstrapAdmin.service is deliberately not set: it would exist only to
authenticate the KeycloakOIDCClient CRDs, which this design rejects."
```

---

### Task 3: The convergence values surface

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml`

**Interfaces:**
- Consumes: nothing
- Produces: `data.keycloak.bootstrapAdmin.userSecret`, `data.keycloak.convergence.{enabled,backoffLimit,envSecrets}`, and the D8 mapping documented as comments — all consumed by Tasks 4 and 5

- [ ] **Step 1: Remove the orphaned bootstrap-admin literals**

In `charts/genieai-umbrella/values.yaml`, replace the whole `bootstrapAdmin:` block (currently lines 170-173):

```yaml
    bootstrapAdmin:
      user:
        username: ""
        password: ""
```

with:

```yaml
    # Name of the operator-provided Secret holding `username` +
    # `password` for the master-realm administrator the Keycloak
    # operator creates. The convergence Job authenticates with it.
    # The chart references the Secret by name; it never reads it.
    # Upstream ignores this stanza when a master realm already exists.
    bootstrapAdmin:
      userSecret: keycloak-admin-credentials
```

- [ ] **Step 2: Add the realm-naming values the convergence Job reads**

The Job in Task 5 wires these as plain `env`; they have no equivalent in `values.yaml` today, so they are declared here rather than defaulted inline — a defaulted-inline key is invisible to operators scanning the values surface.

In `charts/genieai-umbrella/values.yaml`, insert after `adminEmail`:

```yaml
    # Realm and client identifiers the convergence Job exports for the
    # realm file's $(env:VAR) placeholders. These must match the
    # clientIds consumers use; changing one after install does not
    # rename the client in Keycloak.
    realm: genie
    webClientId: genie-app
    grafanaClientId: grafana
    adminUsername: genie-admin
    defaultLocale: en
    # Login/account/admin/email theme name, exported as KEYCLOAK_THEME.
    # The `genie` theme ships in the image on the Docker Swarm path; on
    # Kubernetes the operator's stock image has no such theme and
    # Keycloak falls back to its default. See issue !998 for the
    # mount-only branding work.
    theme: genie
```

- [ ] **Step 3: Add the convergence block**

In the same file, insert after the `update:` block:

```yaml
    # ── Realm convergence (keycloak-config-cli) ──
    # The realm is created and then converged on every release by a
    # Helm post-upgrade hook Job; the operator's KeycloakRealmImport
    # CR is create-only and cannot be used for this.
    convergence:
      enabled: true
      # kcc waits for Keycloak itself via KEYCLOAK_AVAILABILITYCHECK_*,
      # so retries here cover genuine failures, not startup.
      backoffLimit: 2
      # Secret-backed realm parameters. One row per `$(env:VAR)` in
      # files/genie-realm.yaml whose value is a secret. The chart wires
      # `valueFrom.secretKeyRef`; it never renders the value.
      #
      # The five the realm actually needs — worked mapping:
      #   clientSecrets.proxyClient -> KC_PROXY_CLIENT_SECRET
      #   clientSecrets.dataprep    -> KC_DATAPREP_CLIENT_SECRET
      #   clientSecrets.grafana     -> KC_GRAFANA_CLIENT_SECRET
      #   (admin)                   -> GENIE_ADMIN_PASSWORD
      #   (mail)                    -> EMAIL_PASSWORD
      envSecrets: []
```

- [ ] **Step 4: Drop the now-orphaned `realmImport` toggle**

In the same file, remove the `realmImport: true` line.

The comment above it spans two lines and must be edited, not deleted wholesale — the second line still documents `enabled: true`, which keeps gating the `Keycloak` CR after Task 5 deletes the realm import. Replace:

```
    # Gates the Keycloak + KeycloakRealmImport CRs. The operator
    # itself is a cluster bootstrap prerequisite — NOT a chart dependency.
```

with:

```
    # Gates the Keycloak CR. The operator itself is a cluster
    # bootstrap prerequisite — NOT a chart dependency.
```

`realmImport` had no template reader once `keycloak-realm-import.yaml` is deleted in Task 5, and leaving the toggle would invite an operator to believe it controls something.

- [ ] **Step 5: Confirm the values surface parses and the orphans are gone**

Run:
```bash
helm lint charts/genieai-umbrella/ --strict 2>&1 | tail -3
grep -n 'realmImport\|bootstrapAdmin\|convergence:\|envSecrets\|webClientId' charts/genieai-umbrella/values.yaml
```

Expected: `0 chart(s) failed`; no `realmImport`; `bootstrapAdmin.userSecret` present with no `username`/`password` sibling; `convergence.envSecrets: []` present; the five new identifier keys present.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(values): convergence surface and realm-naming keys

Adds data.keycloak.bootstrapAdmin.userSecret (name only — the chart
references the Secret, never reads it), the convergence block with
enabled, backoffLimit and envSecrets, and the realm/client identifier
keys the convergence Job exports as plain env.

Removes bootstrapAdmin.user.username and .password, which were added
with the CR migration and never had a consumer, and realmImport, which
nothing reads once the create-only import CR is gone.

The clientSecrets -> envSecrets mapping is written out in comments
because operators must hand-write those rows and can mismatch them."
```

---

### Task 4: Render the realm file into a Secret

**Files:**
- Create: `charts/genieai-umbrella/templates/data/keycloak-realm-secret.yaml`

**Interfaces:**
- Consumes: `files/genie-realm.yaml` (Task 1), `data.keycloak.convergence.enabled`
- Produces: Secret `<fullname>-keycloak-realm` in `.Values.namespace`, key `genie-realm.yaml`, mounted by the Job in Task 5

- [ ] **Step 1: Write the template**

Create `charts/genieai-umbrella/templates/data/keycloak-realm-secret.yaml`:

```yaml
{{- if and .Values.data.keycloak.enabled .Values.data.keycloak.convergence.enabled -}}
{{- /*
The realm body is a chart file, not rendered from values: it already
carries 32 distinct `$(env:VAR)` placeholders (40 occurrences) covering every per-deployment
value, so templating it here would mean re-inventing a realm-authoring
engine to reproduce a file that is already parameterised.

Rendered into a Secret rather than a ConfigMap because the resolved
body contains the client secrets that the Job's env injects at import
time. kcc does not write back, so this is a mount-only read.

The placeholder-completeness assertion lives in the Job template, not
here: it must compare the realm's placeholders against the env that
template actually emits, and a hand-maintained list here could drift
from that env block without failing anything.
*/ -}}
{{- $realmFile := .Files.Get "files/genie-realm.yaml" -}}
{{- if not $realmFile -}}
{{- fail "files/genie-realm.yaml is missing from the chart; the convergence Job has nothing to apply" -}}
{{- end -}}
{{- $ns := .Values.namespace -}}
apiVersion: v1
kind: Secret
metadata:
  name: {{ printf "%s-keycloak-realm" (include "genieai-common.fullname" .) }}
  namespace: {{ $ns }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" .Values "component" "identity") | nindent 4 }}
    genieai.io/data-tier: identity
type: Opaque
stringData:
  genie-realm.yaml: |
{{ $realmFile | indent 4 }}
{{- end -}}
```

- [ ] **Step 2: Render and confirm the Secret carries the file verbatim**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --output-dir /tmp/kc-t4
python3 - <<'PY'
import sys, yaml
d = yaml.safe_load(open("/tmp/kc-t4/genieai-umbrella/templates/data/keycloak-realm-secret.yaml"))
got = d["stringData"]["genie-realm.yaml"]
want = open("charts/genieai-umbrella/files/genie-realm.yaml").read()
if got == want:
    print("REALM_IDENTICAL", len(got), len(want))
else:
    print("REALM_DIFFERS", len(got), len(want))
    sys.exit(1)
PY
```

Expected: `REALM_IDENTICAL <n> <n>` with both counts equal, exit 0. A non-zero exit means the Secret
would carry a realm body that is not the file — report it, do not adjust the template to make the
check pass.

Expected: `REALM_IDENTICAL <n> <n>` with both counts equal. If it prints `REALM_DIFFERS`, report it — do not adjust the template to make the check pass.

- [ ] **Step 3: Commit**

```bash
git add charts/genieai-umbrella/templates/data/keycloak-realm-secret.yaml
git commit -m "feat(charts): render the realm file into a Secret for the Job to mount

The realm body is a chart file, not rendered from values. It already
carries 32 distinct \$(env:VAR) placeholders (40 occurrences) covering every per-deployment value,
so templating it would re-invent a realm-authoring engine to reproduce
a file that is already parameterised.

The Secret (not a ConfigMap) holds the body because the resolved import
contains the client secrets the Job's env injects. kcc does not write
back, so it is a mount-only read."
```

---

### Task 5: The convergence Job, and the realm import's removal

This is the swap that the whole design exists for: **once this lands, exactly one component owns the realm.** Splitting it would reintroduce the race the spec's D1 was written to close.

**Files:**
- Create: `charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml`
- Delete: `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml`
- Modify: `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml`

**Interfaces:**
- Consumes: `data.keycloak.convergence.{enabled,backoffLimit,envSecrets}`, `data.keycloak.bootstrapAdmin.userSecret`, `data.keycloak.clientSecrets.*`, `data.keycloak.failOnPlaceholderSecrets`, Secret `<fullname>-keycloak-realm` from Task 4
- Produces: Job `<fullname>-keycloak-convergence`, Helm hook `post-install,post-upgrade,post-rollback`

- [ ] **Step 1: Write the Job template**

Create `charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml`:

```yaml
{{- if and .Values.data.keycloak.enabled .Values.data.keycloak.convergence.enabled -}}
{{- /*
keycloak-config-cli owns the realm. The operator's KeycloakRealmImport
CR was removed: it is create-only (the operator hardcodes --override=false
and implements no Updater), so a changed spec.realm is silently ignored
while the CR still reports Done=True/HasErrors=False.

Run-always is correct here because every realm parameter reaches the
import through an env or envSecrets row, both of which are values — so
a parameter change moves the values digest and fires this hook.
*/ -}}
{{- $ns := .Values.namespace -}}
{{- $secretName := .Values.data.keycloak.bootstrapAdmin.userSecret | default "keycloak-admin-credentials" -}}
{{- $realmSecret := printf "%s-keycloak-realm" (include "genieai-common.fullname" .) -}}
{{- /*
Placeholder guard, relocated from the deleted realm import. A change-me-*
client secret produces a client whose secret no consumer in the cluster
holds — a silent auth failure, and with no realm import nothing else
would catch it.
*/ -}}
{{- if .Values.data.keycloak.failOnPlaceholderSecrets -}}
{{- $cs := .Values.data.keycloak.clientSecrets | default dict -}}
{{- range $k := list "proxyClient" "dataprep" "grafana" -}}
{{- $v := dig $k "" $cs -}}
{{- if or (not $v) (eq $v "") (hasPrefix "change-me" $v) -}}
{{- fail (printf "data.keycloak.clientSecrets.%s is empty or a placeholder (change-me-*); the convergence Job wires it into the realm, and a placeholder produces an OIDC client whose secret no consumer holds. Set data.keycloak.failOnPlaceholderSecrets=false only where the placeholder is acceptable" $k) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- /*
Placeholder completeness. Every `$(env:VAR)` in the realm file must
resolve from this Job's env or from an envSecrets row. An unsatisfied
placeholder is invisible to Helm and surfaces only as a kcc parse
error at Job runtime, far from its cause.

$known is assembled from the SAME values that emit the env block below,
so it cannot drift from it. A hand-maintained list in another template
would be exactly the failure this assertion exists to catch.
*/ -}}
{{- $known := list "KEYCLOAK_URL" "KEYCLOAK_USER" "KEYCLOAK_PASSWORD" -}}
{{- $known = append $known "KC_REALM" "KC_CLIENT_ID" "KC_PUBLIC_ORIGIN" -}}
{{- $known = append $known "KC_MOBILE_CLIENT_ID" "KC_MOBILE_REDIRECT_SCHEME" "KC_GRAFANA_CLIENT_ID" -}}
{{- $known = append $known "GENIE_ADMIN_USERNAME" "GENIE_ADMIN_EMAIL" -}}
{{- $known = append $known "KEYCLOAK_REGISTRATION_ENABLED" "KEYCLOAK_VERIFY_EMAIL" "KEYCLOAK_RESET_PASSWORD" -}}
{{- $known = append $known "KEYCLOAK_LOGIN_WITH_EMAIL" "KEYCLOAK_DUPLICATE_EMAILS" "KEYCLOAK_BRUTE_FORCE" -}}
{{- $known = append $known "KEYCLOAK_PASSWORD_POLICY" "KEYCLOAK_THEME" -}}
{{- $known = append $known "KEYCLOAK_I18N_ENABLED" "KEYCLOAK_LOCALE" "KEYCLOAK_SUPPORTED_LOCALES" "KEYCLOAK_ACCESS_TOKEN_LIFESPAN" -}}
{{- /*
SMTP placeholders are listed unconditionally: the realm file's
smtpServer block is unconditional too (genie-realm.yaml:18-26), so a
default install with smtp:null must still resolve them — to empty
strings, exactly as the compose path does today. Gating them on smtp
being set would fail this assertion on every default render.
*/ -}}
{{- $known = append $known "EMAIL_FROM" "EMAIL_HOST" "EMAIL_PORT" "EMAIL_SECURE" "EMAIL_SMTP_STARTTLS" "EMAIL_SMTP_AUTH" "EMAIL_USER" -}}
{{- range $e := (.Values.data.keycloak.convergence.envSecrets | default list) -}}
{{- $known = append $known $e.envVar -}}
{{- end -}}
{{- $realmFile := .Files.Get "files/genie-realm.yaml" -}}
{{- if .Values.data.keycloak.failOnPlaceholderSecrets -}}
{{- range $p := (regexFindAll "\\$\\(env:[A-Z_][A-Z0-9_]*\\)" $realmFile -1) -}}
{{- $n := trimPrefix "$(env:" (trimSuffix ")" $p) -}}
{{- if not (has $n $known) -}}
{{- fail (printf "files/genie-realm.yaml references $(env:%s) but this Job exports no such variable; add it to the Job env or to data.keycloak.convergence.envSecrets, or kcc fails at runtime with an opaque parse error. Set data.keycloak.failOnPlaceholderSecrets=false to accept unresolved placeholders — kcc will then create clients with empty secrets" $n) -}}
{{- end -}}
{{- end -}}
{{- end -}}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "genieai-common.fullname" . }}-keycloak-convergence
  namespace: {{ $ns }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" .Values "component" "identity") | nindent 4 }}
    genieai.io/data-tier: identity
  annotations:
    # Helm 3 scans templates/ recursively; the subdirectory name is
    # irrelevant, the annotations are what matter.
    "helm.sh/hook": post-install,post-upgrade,post-rollback
    "helm.sh/hook-weight": "10"
    # hook-succeeded leaves no completed Job behind;
    # before-hook-creation replaces a stale one on the next release.
    "helm.sh/hook-delete-policy": hook-succeeded,before-hook-creation
spec:
  backoffLimit: {{ .Values.data.keycloak.convergence.backoffLimit | default 2 }}
  template:
    metadata:
      labels:
        {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" .Values "component" "identity") | nindent 8 }}
    spec:
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
      containers:
        - name: keycloak-config-cli
          # The -26 suffix encodes the Keycloak major version. A Keycloak
          # major bump needs a matching kcc tag bump.
          image: "{{ .Values.global.imageRegistry | default "" }}/adorsys/keycloak-config-cli:6.5.0-26"
          {{- with .Values.global.imagePullSecrets }}
          imagePullSecrets: {{ toYaml . | nindent 12 }}
          {{- end }}
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          env:
            # /auth is required: the Keycloak CR sets
            # additionalOptions http-relative-path=/auth, and kcc's URL
            # format is scheme://host:port/web-context. Without it the
            # token call 404s on the wrong context and surfaces as 401.
            - name: KEYCLOAK_URL
              value: {{ printf "http://keycloak-service.%s.svc.cluster.local:8080/auth" $ns | quote }}
            - name: KEYCLOAK_USER
              valueFrom:
                secretKeyRef:
                  name: {{ $secretName | quote }}
                  key: username
            - name: KEYCLOAK_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: {{ $secretName | quote }}
                  key: password
            # Keycloak takes ~70s to report Ready on a cold start. kcc's
            # availability check owns that wait, so backoffLimit above
            # covers real failures rather than startup.
            - name: KEYCLOAK_AVAILABILITYCHECK_ENABLED
              value: "true"
            - name: KEYCLOAK_AVAILABILITYCHECK_TIMEOUT
              value: "300s"
            - name: IMPORT_PATH
              value: /config/
            - name: IMPORT_FILES
              value: /config/genie-realm.yaml
            - name: IMPORT_VARSUBSTITUTION_ENABLED
              value: "true"
            - name: IMPORT_CACHE_ENABLED
              value: "true"
            # Non-secret realm parameters, resolved from the realm file's
            # $(env:VAR) placeholders. Values only — no Secret here.
            - name: KC_REALM
              value: {{ .Values.data.keycloak.realm | quote }}
            - name: KC_CLIENT_ID
              value: {{ .Values.data.keycloak.webClientId | quote }}
            - name: KC_PUBLIC_ORIGIN
              value: {{ printf "https://%s" (.Values.ingress.host | default "genieai.local") | quote }}
            - name: KC_MOBILE_CLIENT_ID
              value: {{ .Values.data.keycloak.mobileClientId | default "genie-mobile" | quote }}
            - name: KC_MOBILE_REDIRECT_SCHEME
              value: {{ .Values.data.keycloak.mobileRedirectScheme | default "genieai" | quote }}
            - name: KC_GRAFANA_CLIENT_ID
              value: {{ .Values.data.keycloak.grafanaClientId | quote }}
            - name: GENIE_ADMIN_USERNAME
              value: {{ .Values.data.keycloak.adminUsername | quote }}
            - name: GENIE_ADMIN_EMAIL
              value: {{ .Values.data.keycloak.adminEmail | default "genie-admin@genieai.local" | quote }}
            # The realm file's smtpServer block is unconditional, so
            # these are emitted even with smtp:null — empty, which is
            # what the compose path already sends. Keycloak rejects an
            # smtpServer whose from is empty (deploy/ansible/README.md),
            # so a default install needs SMTP configured; that failure is
            # inherited from the compose path, not introduced here.
            {{- $smtp := .Values.data.keycloak.smtp | default dict -}}
            - name: EMAIL_FROM
              value: {{ $smtp.from | default "" | quote }}
            - name: EMAIL_HOST
              value: {{ $smtp.host | default "" | quote }}
            - name: EMAIL_PORT
              value: {{ $smtp.port | default 587 | int | quote }}
            - name: EMAIL_SECURE
              value: {{ eq ($smtp.ssl | default false | toString) "true" | quote }}
            - name: EMAIL_SMTP_STARTTLS
              value: {{ eq ($smtp.starttls | default false | toString) "true" | quote }}
            - name: EMAIL_SMTP_AUTH
              value: {{ eq ($smtp.auth | default false | toString) "true" | quote }}
            - name: EMAIL_USER
              value: {{ $smtp.user | default "" | quote }}
            - name: KEYCLOAK_REGISTRATION_ENABLED
              value: {{ eq ((.Values.data.keycloak.registrationAllowed | default false) | toString) "true" | quote }}
            - name: KEYCLOAK_VERIFY_EMAIL
              value: {{ eq ((.Values.data.keycloak.verifyEmail | default false) | toString) "true" | quote }}
            - name: KEYCLOAK_RESET_PASSWORD
              value: {{ eq ((.Values.data.keycloak.resetPasswordAllowed | default false) | toString) "true" | quote }}
            - name: KEYCLOAK_LOGIN_WITH_EMAIL
              value: {{ eq ((.Values.data.keycloak.loginWithEmailAllowed | default true) | toString) "true" | quote }}
            - name: KEYCLOAK_DUPLICATE_EMAILS
              value: {{ eq ((.Values.data.keycloak.duplicateEmailsAllowed | default false) | toString) "true" | quote }}
            - name: KEYCLOAK_BRUTE_FORCE
              value: {{ eq ((.Values.data.keycloak.bruteForceProtected | default true) | toString) "true" | quote }}
            - name: KEYCLOAK_PASSWORD_POLICY
              value: {{ .Values.data.keycloak.passwordPolicy | default "" | quote }}
            - name: KEYCLOAK_THEME
              value: {{ .Values.data.keycloak.theme | default "keycloak" | quote }}
            - name: KEYCLOAK_I18N_ENABLED
              value: {{ eq ((.Values.data.keycloak.internationalizationEnabled | default true) | toString) "true" | quote }}
            - name: KEYCLOAK_LOCALE
              value: {{ .Values.data.keycloak.defaultLocale | quote }}
            - name: KEYCLOAK_SUPPORTED_LOCALES
              value: {{ .Values.data.keycloak.supportedLocales | default (list "ar" "de" "en" "es" "fr" "pt" "ru" "th" "zh-Hans") | join "," | quote }}
            - name: KEYCLOAK_ACCESS_TOKEN_LIFESPAN
              value: {{ .Values.data.keycloak.accessTokenLifespan | default 300 | quote }}
            # Secret-backed parameters, one row per operator-declared entry.
            {{- range $e := (.Values.data.keycloak.convergence.envSecrets | default list) }}
            - name: {{ $e.envVar }}
              valueFrom:
                secretKeyRef:
                  name: {{ $e.secretName | quote }}
                  key: {{ $e.secretKey | quote }}
            {{- end }}
          volumeMounts:
            - name: realm
              mountPath: /config
              readOnly: true
      volumes:
        - name: realm
          secret:
            secretName: {{ $realmSecret | quote }}
{{- end -}}
```

- [ ] **Step 2: Render the strict path and inspect the Job**

The completeness assertion is gated on `failOnPlaceholderSecrets`, so a render that omits the `envSecrets` rows exercises the *lenient* path. Prove the strict path first — `failOnPlaceholderSecrets` defaults to true, and the five secret placeholders need their rows:

```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --set 'data.keycloak.convergence.envSecrets[0].envVar=KC_PROXY_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[0].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[0].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[1].envVar=KC_DATAPREP_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[1].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[1].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[2].envVar=KC_GRAFANA_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[2].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[2].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[3].envVar=GENIE_ADMIN_PASSWORD' \
  --set 'data.keycloak.convergence.envSecrets[3].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[3].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[4].envVar=EMAIL_PASSWORD' \
  --set 'data.keycloak.convergence.envSecrets[4].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[4].secretKey=k' \
  --output-dir /tmp/kc-t5
```

Expected: exit 0. This is also what `chart:lint` must be able to do — see Step 10.

Then inspect the rendered Job:

```bash
yq -P 'select(.kind=="Job" and (.metadata.name | test("convergence"))) |
  {"hooks": .metadata.annotations, "backoff": .spec.backoffLimit,
   "env": [.spec.template.spec.containers[0].env[] | select(.name | test("KEYCLOAK_URL|AVAILABILITY"))],
   "secretBacked": [.spec.template.spec.containers[0].env[] | select(.name | test("PROXY_CLIENT_SECRET|ADMIN_PASSWORD"))]}'
  /tmp/kc-t4/genieai-umbrella/templates/data/keycloak-convergence-job.yaml
```

Expected: hooks `post-install,post-upgrade,post-rollback`; `KEYCLOAK_URL` ending in `:8080/auth`; availability check `true` / `300s`; the secret-backed entries present with `valueFrom.secretKeyRef` and **no `value:` field**.

- [ ] **Step 3: Prove the placeholder assertion fires**

Same as Step 2 — strict path, real client secrets, five rows — but **omit** the `GENIE_ADMIN_PASSWORD` row. Do **not** pass `failOnPlaceholderSecrets=false`: that flag gates the assertion off, so the test would silently prove nothing.

```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --set 'data.keycloak.convergence.envSecrets[0].envVar=KC_PROXY_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[0].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[0].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[1].envVar=KC_DATAPREP_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[1].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[1].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[2].envVar=KC_GRAFANA_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[2].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[2].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[3].envVar=EMAIL_PASSWORD' \
  --set 'data.keycloak.convergence.envSecrets[3].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[3].secretKey=k' 2>&1 | tail -3
```

Expected: an error naming `GENIE_ADMIN_PASSWORD` and stating the Job exports no such variable. **If it renders silently, the assertion is broken — fix it before committing.**

- [ ] **Step 4: Prove no client secret is ever a literal**

Run:

```bash
grep -c 'value:.*change-me' /tmp/kc-t4/genieai-umbrella/templates/data/keycloak-convergence-job.yaml
```

Expected: `0`. This is the regression test for the literal-secrets defect.

- [ ] **Step 5: Prove the placeholder guard still trips**

Run:
```bash
helm template test charts/genieai-umbrella/ -n genieai 2>&1 | tail -3
```

Expected: an error naming `data.keycloak.clientSecrets.proxyClient` and mentioning `change-me-*`. Then re-run with `--set data.keycloak.failOnPlaceholderSecrets=false` and confirm it renders **without** the `envSecrets` rows — that render is the lenient path, and it is what `chart:lint` does today. The `change-me-*` guard and the completeness assertion are both gated on this one flag.

- [ ] **Step 6: Delete the realm import template**

```bash
git rm charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml
```

- [ ] **Step 7: Drop `keycloakrealmimports` from the dep-check RBAC**

In `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml`, remove `keycloakrealmimports` from the `k8s.keycloak.org` resource list, leaving:

```yaml
    - apiGroups: ["k8s.keycloak.org"]
      resources:
        - keycloaks
        - keycloakoidcclients
        - keycloaksamlclients
      verbs: ["get", "list"]
```

Replace the whole four-line comment above that block — leaving its trailing clause behind reads as a sentence fragment:

```
  # Keycloak 26 official operator (k8s.keycloak.org/v2beta1) ships 4 CRDs.
  # The dep-check Job verifies the Keycloak + KeycloakRealmImport CRs are
  # present after install; the OIDC/SAML client CRDs are not rendered by
  # this chart but are listed for completeness (operators may add them).
```

with:

```
  # Keycloak 26 official operator (k8s.keycloak.org/v2beta1) ships 4 CRDs.
  # This chart renders `Keycloak` only; the realm is converged by
  # keycloak-config-cli, not by the operator's create-only import CR.
  # The OIDC/SAML client CRDs are listed for completeness (operators may
  # add them).
```

- [ ] **Step 8: Confirm nothing still references the deleted kind**

Run:
```bash
grep -rn 'KeycloakRealmImport\|keycloak-realm-import\|keycloakrealmimports' charts/ deploy/ site/ docs/ 2>/dev/null
```

Expected: only hits that are explicitly historical (a plan document's prose) or the corrected comment from Step 6. Any live template or doc reference must be updated in this task.

- [ ] **Step 9: Confirm `chart:lint`'s existing render still succeeds**

`chart:lint` (`.gitlab-ci.yml:2553`) renders with `--set data.keycloak.failOnPlaceholderSecrets=false` and no `envSecrets` rows. That combination must keep working, or CI breaks:

```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set 'data.keycloak.clientSecrets.proxyClient=lint-dummy' \
  --set 'data.keycloak.clientSecrets.dataprep=lint-dummy' \
  --set 'data.keycloak.clientSecrets.grafana=lint-dummy' \
  > /tmp/kc-lint.yaml && echo "LINT_PATH_OK"
```

Expected: `LINT_PATH_OK`. If it fails, the assertion is not gated as Step 1 specifies.

- [ ] **Step 10: Commit**

```bash
git add charts/genieai-umbrella/templates/data/keycloak-convergence-job.yaml \
        charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml
git commit -m "feat(charts): kcc convergence Job replaces the create-only realm import

The realm now has exactly one owner. KeycloakRealmImport is removed: the
operator hardcodes --override=false and implements no Updater, so a
changed spec.realm is ignored while the CR reports Done=True and
HasErrors=False — a GitOps pipeline that stays green while the realm
drifts. Keeping it alongside this Job would also reintroduce the race
the deletion avoids: the import Job is created asynchronously by the
operator, not as a Helm resource, so hook-weight sequences nothing, and
whichever ran second would be silently skipped.

The Job authenticates with bootstrapAdmin.user.secret, waits on kcc's
KEYCLOAK_AVAILABILITYCHECK rather than backoff retries, and dials
keycloak-service:8080/auth — the /auth suffix is required by the
http-relative-path option the Keycloak CR now sets.

The change-me-* guard moves here from the deleted realm import. Without
it, a placeholder client secret produces an OIDC client whose secret no
consumer in the cluster holds, and nothing else would catch that."
```

---

### Task 6: Correct the ArgoCD example's false claims

**Files:**
- Modify: `charts/genieai-umbrella/examples/argocd-application.yaml`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by code

- [ ] **Step 1: Replace the two false LIMITATION blocks**

In `charts/genieai-umbrella/examples/argocd-application.yaml`, replace the block that begins `# LIMITATION (Helm hooks under ArgoCD):` and the one that begins `# LIMITATION (destructive prune):` with:

```yaml
# HELM HOOKS UNDER ARGOCD: ArgoCD does run them. `helm.sh/hook:
# pre-install` and `post-upgrade` are translated to its own
# PreSync / PostSync phases, so this chart's pre-upgrade drift Jobs
# (dependency check, cluster-profile detect) DO run under ArgoCD.
# They re-run on every sync, not only when what they watch changed —
# ArgoCD has no change-gating for hooks, and says so in its docs.
#
# LIMITATION (destructive prune): ArgoCD deletes rendered resources
# directly when pruning. An automated prune of this Application removes
# the Namespace and every PVC inside it with no confirmation gate,
# because Helm lifecycle hooks do not run on prune. Protect
# GitOps-delivered instances with an ArgoCD-native mechanism
# (sync-options disabling automated prune, or finalizers), not with a
# Helm hook — a Helm hook only protects `helm uninstall`.
```

- [ ] **Step 2: Confirm the SealedSecret reference is gone**

Run:
```bash
grep -rn 'SealedSecret\|sealedSecret' charts/genieai-umbrella/examples/ 2>/dev/null
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add charts/genieai-umbrella/examples/argocd-application.yaml
git commit -m "docs(charts): correct the ArgoCD example's Helm-hook claims

The file asserted that pre-upgrade Helm hooks are NOT executed by
ArgoCD and, in the next paragraph, that ArgoCD never executes Helm
lifecycle hooks at all. It contradicted itself, both statements were
false, and it referenced a SealedSecret drift hook that no longer
exists.

gitops-engine/pkg/sync/hook/helm/type.go maps PreInstall and
PreUpgrade to PreSync, and PostInstall and PostUpgrade to PostSync, so
the chart's two pre-upgrade drift Jobs do run. What ArgoCD does not
offer is change-gating — hooks fire on every sync — and that is stated
plainly now because it changes how operators should reason about the
drift Jobs."
```

---

### Task 7: README and CHANGELOG

**Files:**
- Modify: `charts/genieai-umbrella/README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by code

- [ ] **Step 1: Add a "Keycloak configuration" section to the chart README**

Insert after the "Cluster prerequisites" section in `charts/genieai-umbrella/README.md`:

```markdown
## Keycloak configuration

The realm has exactly one owner: `keycloak-config-cli`, run as a Helm
`post-install,post-upgrade,post-rollback` hook Job. The operator's
`KeycloakRealmImport` CR is create-only — a changed `spec.realm` is
ignored while the CR still reports `Done=True`, which leaves a GitOps
pipeline green against a realm that has drifted.

The realm body is `files/genie-realm.yaml`, a chart file parameterised
by `$(env:VAR)` placeholders. The chart does not re-render it; it wires
the environment those placeholders resolve from:

| Parameter class | Wiring |
|---|---|
| Deployment values (realm name, `ingress.host`, locale, password policy, mobile client id) | plain `env` on the Job, from chart values |
| Secrets (client secrets, admin password, SMTP password) | `valueFrom.secretKeyRef`, declared in `data.keycloak.convergence.envSecrets` |

Two Secrets must exist in `genieai` before the release succeeds:

| Secret | Keys | Consumed by |
|---|---|---|
| `keycloak-admin-credentials` | `username`, `password` | `Keycloak` CR `bootstrapAdmin.user.secret`; the Job's `KEYCLOAK_USER` / `KEYCLOAK_PASSWORD` |
| `keycloak-db-credentials` | `username`, `password` | the CNPG cluster and the `Keycloak` CR `spec.db` |

Neither is materialized by the chart — bring them with whatever secret
backend you use cluster-wide.

The hook fires on every release. Because every realm parameter reaches
the import through a values-derived `env` or an `envSecrets` row, a
parameter change moves the values digest and triggers the release.
The HelmRelease `spec.upgrade.timeout` bounds the Job; set it to at
least `900s`.
```

- [ ] **Step 2: Add the CHANGELOG bullets**

In `CHANGELOG.md`, under `## [Unreleased]`, add these three bullets (create the section if absent):

```markdown
### Changed

- **Keycloak realm configuration now converges through keycloak-config-cli.** A Helm `post-install,post-upgrade,post-rollback` hook Job applies the realm definition instead of the operator's `KeycloakRealmImport` custom resource. The import CR is create-only: a changed realm definition was ignored while the CR still reported success, so a GitOps pipeline stayed green against a realm that had drifted. Realm changes now take effect on the next release. Operators with an existing install must let the Job create the realm — the previous import CR is removed from the chart. (breaking)

### Fixed

- **Keycloak secrets are no longer stored in plaintext in a cluster resource.** Confidential-client secrets were rendered literally into the realm custom resource, readable by anyone with `get` access in the namespace and persisted in the GitOps controller's stored artifact. They are now referenced from operator-provided Secrets and injected into the convergence Job at run time.
- **Keycloak is now reachable at the `/auth` path prefix the stack already expects.** The backend and document-repository services dial `keycloak-service:8080/auth`, but nothing configured Keycloak to serve under that prefix on Kubernetes — the Docker Swarm path gets it from NGINX. Every authenticated request returned 404, and the failure only appeared at the first user login.
```

- [ ] **Step 3: Confirm no banned CHANGELOG patterns**

Run:
```bash
git diff --cached CHANGELOG.md | grep -iE 'T7|laptop|hardening|coherent surface|wave [0-9]|now defaults to|rewritten for|previous templates used'
```

Expected: no output. Any hit means the entry narrates the branch instead of describing the release.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/README.md CHANGELOG.md
git commit -m "docs(charts): document the single-owner realm model and the required Secrets"
```

---

### Task 8: Align the deploy-repo overlays

This task lands in a **different repository** and gets its own MR. Run it from the deploy-repo worktree.

**Files (in `/home/jerome/git_projects/ITU/genie-ai-deploy`):**
- Modify: `overlays/jrevillard-laptop/dev/helmrelease.yaml`
- Modify: `overlays/jrevillard-laptop/dev/values.yaml`
- Modify: `overlays/minikube/dev/helmrelease.yaml`
- Modify: `overlays/minikube/dev/values.yaml`
- Modify: `overlays/jrevillard-laptop/dev/gitrepository-chart.yaml` (chart SHA bump)

**Interfaces:**
- Consumes: `data.keycloak.convergence.envSecrets` from Task 3
- Produces: overlays whose chart pin points at this branch's HEAD

- [ ] **Step 1: Raise the HelmRelease timeout in both overlays**

In each overlay's `helmrelease.yaml`, under `spec.upgrade`, ensure:

```yaml
  upgrade:
    # Bounds the kcc convergence hook: worst case is
    # (backoffLimit + 1) x (availability check + import). Never measured
    # yet — revise after the first laptop run.
    timeout: 900s
```

- [ ] **Step 2: Add the five `envSecrets` rows to the laptop overlay**

In `overlays/jrevillard-laptop/dev/values.yaml`, under `data.keycloak`, add alongside the existing `clientSecrets` block:

```yaml
    # Secret-backed realm parameters. The Secret names below are
    # operator-provided; the chart wires valueFrom.secretKeyRef and
    # never renders the values. Replace the placeholder names with the
    # Secrets your cluster actually has.
    convergence:
      envSecrets:
        - { envVar: KC_PROXY_CLIENT_SECRET, secretName: genieai-client-secrets, secretKey: proxyClient }
        - { envVar: KC_DATAPREP_CLIENT_SECRET, secretName: genieai-client-secrets, secretKey: dataprep }
        - { envVar: KC_GRAFANA_CLIENT_SECRET, secretName: genieai-client-secrets, secretKey: grafana }
        - { envVar: GENIE_ADMIN_PASSWORD, secretName: genieai-admin, secretKey: password }
        - { envVar: EMAIL_PASSWORD, secretName: genieai-mail, secretKey: password }
```

- [ ] **Step 3: Leave the minikube overlay's convergence block absent**

`overlays/minikube/dev/values.yaml` sets no client secrets today, so the chart's `failOnPlaceholderSecrets` will fail its render. Set:

```yaml
    convergence:
      envSecrets: []
```

and document in the file that the minikube overlay is a render-only smoke path, not a functional install.

- [ ] **Step 4: Bump the chart pin in both overlays**

In each overlay's `gitrepository-chart.yaml`, set `spec.ref.commit` to the HEAD of the chart branch, and update the comment to describe the current content rather than a wave history:

```yaml
  ref:
    # Pinned to the feat/k8s-migration HEAD carrying the Keycloak 26
    # v2beta1 migration and the keycloak-config-cli convergence layer.
    # Bump manually after each push to that branch. To refresh:
    #   git ls-remote https://opensource.unicc.org/un/itu/genie-ai.git refs/heads/feat/k8s-migration
    commit: "<40-char SHA of the chart branch HEAD>"
```

- [ ] **Step 5: Run the deploy-repo lint**

Run:
```bash
cd /home/jerome/git_projects/ITU/genie-ai-deploy && ./scripts/ci-lint.sh 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 6: Commit and open the MR**

```bash
cd /home/jerome/git_projects/ITU/genie-ai-deploy
git add overlays/
git commit -m "feat(deploy): align overlays with the kcc convergence layer

Raises the HelmRelease upgrade timeout to 900s, which bounds the
convergence hook: worst case is (backoffLimit + 1) x (availability
check + import), and the import duration has never been measured.

Adds the five envSecrets rows the realm's placeholders need — the
chart asserts at render time that every \$(env:VAR) in the realm file
is reachable, so an overlay missing one fails to render rather than
failing at Job runtime.

Bumps the chart pin in both overlays."
git push origin feat/deploy-repo
```

Then open the MR with `glab` and launch the CI monitor:

```bash
nohup /tmp/ci-monitor.sh <pipeline_id> 60 >/tmp/ci-monitor-deploy-convergence.log 2>&1 &
```

---

### Task 9: Final validation gate

**Files:** none — validation only

- [ ] **Step 1: Confirm the chart renders and lints**

```bash
cd /home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration
helm lint charts/genieai-umbrella/ --strict 2>&1 | tail -2
```

Expected: `0 chart(s) failed`.

- [ ] **Step 2: Render the lenient path and confirm no `KeycloakRealmImport` survives**

```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --output-dir /tmp/kc-final
grep -rc 'KeycloakRealmImport' /tmp/kc-final | grep -v ':0$' || echo "OK: no KeycloakRealmImport"
```

Expected: `OK: no KeycloakRealmImport`. This is `chart:lint`'s exact render, so it doubles as the CI-path check.

- [ ] **Step 2b: Render the strict path too**

```bash
helm template test charts/genieai-umbrella/ -n genieai \
  --set data.keycloak.clientSecrets.proxyClient=t \
  --set data.keycloak.clientSecrets.dataprep=t \
  --set data.keycloak.clientSecrets.grafana=t \
  --set 'data.keycloak.convergence.envSecrets[0].envVar=KC_PROXY_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[0].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[0].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[1].envVar=KC_DATAPREP_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[1].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[1].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[2].envVar=KC_GRAFANA_CLIENT_SECRET' \
  --set 'data.keycloak.convergence.envSecrets[2].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[2].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[3].envVar=GENIE_ADMIN_PASSWORD' \
  --set 'data.keycloak.convergence.envSecrets[3].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[3].secretKey=k' \
  --set 'data.keycloak.convergence.envSecrets[4].envVar=EMAIL_PASSWORD' \
  --set 'data.keycloak.convergence.envSecrets[4].secretName=s' \
  --set 'data.keycloak.convergence.envSecrets[4].secretKey=k' \
  >/dev/null && echo "STRICT_PATH_OK"
```

Expected: `STRICT_PATH_OK`. A default install that fails here means the assertion is not gated as Task 5 Step 1 specifies.

- [ ] **Step 3: Confirm the realm Secret carries no literal secret**

```bash
grep -oE 'change-me[A-Za-z0-9_-]*' /tmp/kc-final/genieai-umbrella/templates/data/keycloak-realm-secret.yaml | sort -u
```

Expected: no output.

- [ ] **Step 4: Confirm the compose path still resolves**

```bash
docker compose config >/dev/null && echo "COMPOSE_OK"
docker compose build keycloak-config >/dev/null 2>&1 && echo "BUILD_OK"
```

Expected: both lines.

- [ ] **Step 5: Confirm the duplication guard is intact**

```bash
cmp charts/genieai-umbrella/files/genie-realm.yaml configs/keycloak/genie-realm.yaml \
  && echo "REALM_COPIES_IDENTICAL"
grep -c 'configs/keycloak/\*\*/\*' .gitlab-ci.yml
```

Expected: `REALM_COPIES_IDENTICAL`, and a non-zero count for the `chart:lint` trigger path.

- [ ] **Step 6: Record what this gate does not cover**

Items 9 (in-cluster `/auth/realms/genie` reachability) and 10 (real convergence duration) need a live cluster and are verified on the first laptop run, not here. Write them down as pending rather than leaving them implied:

```bash
cat >> docs/superpowers/plans/2026-10-13-keycloak-config-convergence.md <<'EOF'

## Post-merge verification (requires a cluster)

- [ ] `kubectl get svc keycloak-service -n genieai` exists
- [ ] `curl -s http://keycloak-service.genieai.svc.cluster.local:8080/auth/realms/genie` returns a realm body
- [ ] record the measured convergence duration against the 900s HelmRelease timeout
EOF
```

Expected: the section is appended so the gaps are tracked rather than assumed.

- [ ] **Step 7: Review the branch commit list**

```bash
git log --oneline <merge-base-with-main>..HEAD
```

Expected: one commit per task, in order, with no fixup noise.

---

## Spec coverage

| Spec decision | Task |
|---|---|
| D1 — kcc is sole owner of the realm | Task 5 (Job + realm import deletion) |
| D2 — realm file duplicated into the chart, never re-rendered | Task 1 (copy + drift guard) |
| D3 — `bootstrapAdmin.user.secret`; `bootstrapAdmin.service` not set | Task 2 (CR), Task 3 (values) |
| D4 — inline Helm post-upgrade hook Job, availability check, run-always | Task 5 |
| D5 — secret wiring | Task 5 |
| D5 — `$(env:VAR)` completeness assertion | Task 5 Step 1 (lives beside the env it validates) |
| D6 — `clientSecrets.*` repurposed, guard relocated, `failOnPlaceholderSecrets` stays `true` | Task 3 (values), Task 5 (guard) |
| D7 — `http-relative-path: /auth` on the Keycloak CR | Task 2 |
| D8 — `clientSecrets` → `envSecrets` mapping documented | Task 3 (comments), Task 8 (worked rows) |
| D9 — drift guard: `diff` assertion + `configs/keycloak/**/*` trigger | Task 1 Steps 2-3 |
| D10 — ArgoCD example corrected | Task 6 |
| D11 — CHANGELOG | Task 7 |

Validation items 1-8 of the spec are covered by Task 9 Steps 1-5. Spec validation item 9 (the 900s timeout) is covered by Task 8 Step 1 and is measured on the first laptop run, which is outside this plan.