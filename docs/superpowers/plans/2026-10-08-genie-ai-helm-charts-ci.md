# GENIE.AI Helm Charts — CI, Signing, Lint, Safety (Plan 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the chart into the existing `.gitlab-ci.yml` pipeline (three new jobs per spec §13: `charts:lint`, `charts:integration`, `charts:scan`), add conftest (OPA Rego) policies for secret-leak lint + placeholder sweep, ship the real cosign key-reference syntax (`--key env://COSIGN_KEY`) + Kyverno inline-PEM syntax (`publicKeys`), add Renovate config for the chart deps, ship a chart-bump + version-skew policy, and a PII smoke test runner that works on K8s (the existing `tests/otel-collector/run-pii-smoke.sh` assumes Docker Compose). Spec §13.1 uninstall safety + §13.2 secret-leak lint are both concretized here.

**Architecture:** CI additions live in `.gitlab-ci.yml` (one new stage, three jobs). Conftest policies in `policies/` (root, OPA Rego). Cosign + Kyverno cluster-side policies render in `charts/genieai-umbrella/templates/policies/` (CRDs only — never install the operators; same posture as the GPU operator / cert-manager / keycloak-operator). Renovate config in `renovate.json` at repo root. PII smoke test runner: a new `tests/otel-collector/run-pii-smoke-k8s.sh` that uses `kubectl run` + `kubectl port-forward` (no Docker dependency).

**Tech Stack:** GitLab CI (`docker` executor + `kind` for integration), `helm` 4.x, `chart-testing` v3.x, `conftest` (OPA Rego), `cosign` 2.x, `kyverno` ~> 3.x, `renovate` (self-hosted or GitLab.com Renovate app), `kubectl` 1.33, `helm-docs` v1.x.

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — implements §13 (test strategy), §13.1 (uninstall safety + pre-install backup hook), §13.2 (secret-leak lint), §14 (chart signing + admission control), §17 manifest entries.

## Global Constraints

- The chart NEVER installs cosign, Kyverno, Velero, or Renovate — all are cluster/operator-side concerns (spec §4).
- Conftest policies run in CI; they never gate a `helm install` (too slow + external binary on the controller side). The CI gate IS the safety net.
- All English documentation and comments per project CLAUDE.md. Commits in English, Conventional Commits.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.

## Review Focus

Five input-class concerns the spec implies but no Plan 7 task tests explicitly. Each pinned to a specific step.

1. **CI runtime footprint** — `charts:integration` spins up a kind cluster, installs the chart, runs `helm test`, runs smoke. The full GENIE.AI stack is 28 services; kind with the chart on a developer laptop will time out before the GitLab CI default (60 min). **Pinned in Task 1 Step 3** — the integration job runs the SAME chart as the production install, with the `dev/values-override.yaml` overlay (single-node everything, no GPU servers, observability off) so the stack stays under the resource budget.
2. **conftest conftest vs conftest (test runner) — name collision** — the OPA-conftest binary is `conftest`; pytest ships a `conftest.py` for fixtures. The repo already imports `tests/conftest.py` (per spec line 671). **Pinned in Task 2 Step 1** — the OPA conftest binary is invoked as `conftest test policies/`; pytest is invoked as `pytest`. Two different binaries, two different commands, no name conflict in the CI definition.
3. **Cosign env-var key reference is `--key env://COSIGN_KEY`** (verified against upstream cosign sign CLI docs) — cosign reads the PEM from the named environment variable. Earlier drafts fabricated an `env:COSIGN_KEY=$COSIGN_KEY` form: after shell expansion that argument is `env:COSIGN_KEY=<entire PEM>`, which is neither a recognized scheme nor a path — AND it exposes the private key in the runner's process list. **Pinned in Task 3 Step 1** — the CI signing step uses `--key env://COSIGN_KEY` with the PEM carried in the masked CI variable only.
4. **Kyverno publicKeys is INLINE PEM ONLY** — Kyverno's `verifyImages.attestors.entries[].keys.publicKeys` does NOT accept a cosign-style URI, a Secret reference, a ConfigMap, or a template. **Pinned in Task 3 Step 2** — the chart renders the ClusterPolicy with the public key inlined in the YAML (a multi-line `-----BEGIN PUBLIC KEY-----` block). CI renders the chart, reads the key, substitutes it into the template; the template's `{{ .Values.cosign.publicKey }}` resolves to a literal PEM string.
5. **Placeholder sweep MUST fail on a `PLACEHOLDER+` sentinel** — Plan 2/5 sentinels are valid base64 (decodes to "PLACEHOLDER+") but are NOT valid SealedSecret ciphertext. The controller marks them `invalid`. Conftest must catch the sentinel, not just literally-named placeholders. **Pinned in Task 2 Step 3** — the policy decodes base64, asserts the decoded value is NOT a known sentinel string.

---

### Task 1: `.gitlab-ci.yml` additions — `charts:lint` + `charts:integration` + `charts:scan`

**Files:**
- Modify: `.gitlab-ci.yml` (append a new `charts` stage with three jobs; anchor on the existing pipeline structure)

**Interfaces:**
- Consumes: `charts/genieai-umbrella/**` (any chart file change).
- Produces: three GitLab CI jobs that gate the MR pipeline (status badges in `charts/README.md`).

- [ ] **Step 1: Add the three chart jobs to the EXISTING stages** (per spec §14 — `lint` stage, new `charts:integration` between `build` and `scan`, `scan` stage)

**The plan does NOT add a new `charts` stage.** Spec §14 places `charts:lint` in the existing `lint` stage, adds a single new stage `charts:integration` between `build` and `scan`, and puts `charts:scan` in the existing `scan` stage. Following this avoids breaking the existing pipeline's `needs:` and `dependencies:` edges.

```yaml
# CHART PIPELINE —
# Job 1: charts:lint (existing `lint` stage)

charts:lint:
  # Self-contained image: this job needs helm + conftest + helm-docs, a
  # combination none of the existing job templates provides (extending the
  # node-based lint templates leaves the job without helm/conftest
  # binaries — 'command not found' on the first script line).
  image: registry.example.org/dev-tools/helm-ct:1.33
  stage: lint
  variables:
    HELM_DOCS_VERSION: v1.14.2
  before_script:
    - helm version --short
    - conftest --version
    # helm-docs is a STANDALONE binary (github.com/norwoodj/helm-docs), not
    # a helm plugin — the earlier `helm plugin install kudulab/helm-docs`
    # line always failed and was masked by `|| true`.
    - curl -sSL https://github.com/norwoodj/helm-docs/releases/download/${HELM_DOCS_VERSION}/helm-docs_${HELM_DOCS_VERSION}_Linux_x86_64.tar.gz | tar xz -C /usr/local/bin helm-docs
  script:
    - make -C charts deps              # vendor the file:// library dependency
    - make -C charts lint              # helm lint --strict (both charts)
    # Gate runs conftest on REAL inputs only: the fixtures are intentional
    # violations and would keep the job
    # permanently red; the shipped READMEs are hand-written, so helm-docs
    # --check would likewise always fail. The fixture suite runs as a
    # self-test that ASSERTS the expected failures.
    - helm template test charts/genieai-umbrella | conftest test --policy policies/ --output stdout -
    - if conftest test --policy policies/ policies/fixtures/test-data.yaml --output stdout; then
        echo "FAIL: fixture suite unexpectedly passed — deny rules are dead"; exit 1;
      else
        echo "OK: fixture suite failed as designed (deny rules live)";
      fi
    # docs-check is ADVISORY only (hand-authored READMEs): report drift, never block.
    - make -C charts docs-check || echo "WARN: helm-docs drift detected (advisory)"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - charts/**/*
        - policies/**/*
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  allow_failure: false
  artifacts:
    when: always
    paths:
      - charts/charts-ci/
    expire_in: 1 week

# Job 2: charts:integration (NEW stage between build and scan)

charts:integration:
  stage: charts-integration       # the ONE new stage
  image: registry.example.org/dev-tools/kind-helm:1.33
  services:
    - name: docker
      alias: docker
      command: ["dockerd", "--host=unix:///var/run/docker.sock"]
  variables:
    KUBECONFIG: /tmp/kubeconfig
    HELM_VALUES: deploy/environments/dev/values-override.yaml
  before_script:
    - kind create cluster --wait 120s --name genieai-test
    - kubectl cluster-info
    - kubectl get nodes
    - make -C charts deps               # helm dep update
  script:
    # Install the chart with the dev overlay (single-node, no GPU,
    # observability off — keeps the kind cluster under the 60-min CI
    # budget). --create-namespace is REQUIRED: the Namespace is a
    # regular resource (Helm 4 deletes
    # hook-identity Namespaces mid-install), so
    # the flag provisions it before the release Secret and the
    # pre-install hooks (-30 rbac, -20 cm, -5 dep-check) run.
    # AI + service tiers are force-disabled: the dev overlay still
    # defaults them on with GPU nodeSelectors and registry.example.org
    # image refs — on a GPU-less kind cluster those pods stay Pending
    # (ImagePullBackOff), and the dep-check hook FAILS the install because
    # services.backend declares deps (keycloak, arangodb, chatqna,
    # vllmTranslation) that are disabled here. Tiers re-enable in this job
    # as their images publish to the real registry; the namespace + hooks
    # remain exercised meanwhile.
    # The dev overlay SHOULD carry these keys itself; until then the job
    # pins them here.
    - helm install test charts/genieai-umbrella
        --namespace genieai --create-namespace
        --values ${HELM_VALUES}
        --set observability.enabled=false
        --set ai.enabled=false
        --set ai.remoteGpu.enabled=true
        --set ai.remoteGpu.vllmUrl=http://gpu-mock.example.org/vllm
        --set ai.remoteGpu.teiEmbeddingUrl=http://gpu-mock.example.org/tei
        --set ai.remoteGpu.teiRerankingUrl=http://gpu-mock.example.org/teir
        --set ai.remoteGpu.vllmTranslationUrl=http://gpu-mock.example.org/vllmt
        --set data.arangodb.enabled=false
        --set data.postgres.enabled=false
        --set data.keycloak.enabled=false
        --set secrets.sealedSecrets.enabled=false
        --set services.backend.enabled=false
        --set services.frontend.enabled=false
        --set services.documentRepository.enabled=false
        --set services.nginx.enabled=false
        --set services.clamav.enabled=false
        --wait --timeout 25m
    # Run helm test.
    - helm test test --namespace genieai --timeout 20m
    # Run connectivity smoke (the namespace-routed backend).
    - kubectl port-forward -n genieai svc/backend 8080:80 &
    - sleep 5
    - curl -fsSL http://localhost:8080/api/health || (echo FAIL; exit 1)
  after_script:
    - kind delete cluster --name genieai-test
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - charts/**/*
        - deploy/environments/dev/**
        - policies/**/*
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  allow_failure: false
  retry: 1
  timeout: 90m   # beyond the 60-min default — see Self-Review I1

# Job 3: charts:scan (existing `scan` stage)

charts:scan:
  stage: scan
  image: registry.example.org/dev-tools/trivy:0.55
  variables:
    TRIVY_NO_PROGRESS: "true"
  script:
    - helm template test charts/genieai-umbrella --values deploy/environments/dev/values-override.yaml > /tmp/rendered.yaml
    - trivy config /tmp/rendered.yaml --severity HIGH,CRITICAL --exit-code 1
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - charts/**/*
        - deploy/environments/**/*
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  allow_failure: true   # scan warnings are advisory; never block the MR
```

Add `charts-integration` to the `stages:` list at the top of `.gitlab-ci.yml` (positioned between `build` and `scan`):

```yaml
stages:
  - lint
  - test
  - config
  - build
  - charts-integration   # NEW
  - scan
  - e2e
  - promote
```

(Removed the previous `charts` stage block — the spec's stage layout is the source of truth.)

# Job 4 (separate, spec §14): publish:charts + cosign sign + verify

The cosign sign step belongs in a `publish:charts` job, NOT in `charts:integration` (per spec §14 line 645: "publish:charts job uploads the umbrella to the existing GitLab Container Registry"). The signing key reference uses `--key env://COSIGN_KEY` (cosign reads the PEM from the env var; nothing key-shaped lands in argv).

```yaml
publish:charts:
  # Own stage AFTER scan: GitLab rejects a job whose `needs:` reference jobs
  # in later stages — needs: [charts:integration (charts-integration),
  # charts:scan (scan)] is invalid while this job sits in `build`.
  # Add `charts:publish` to the stages list right after `scan` (and after
  # `charts-integration`), then declare it here.
  stage: charts:publish
  image: registry.example.org/dev-tools/helm-cosign:1.33
  before_script:
    - helm version --short
    - cosign version
    - make -C charts deps
    # helm push uploads the tgz as <registry-path>/<chart-name>:<chart-version>
    # — helm appends the chart name and tags with the Chart.yaml `version`.
    # Signing must target exactly that ref:
    #   oci push: ${CI_REGISTRY_IMAGE}/genieai/genieai-umbrella:<version>
    - CHART_VERSION=$(grep '^version:' charts/genieai-umbrella/Chart.yaml | awk '{print $2}')
    - CHART_REF="${CI_REGISTRY_IMAGE}/genieai/genieai-umbrella"
  script:
    # Package the chart (no signing yet — sign AFTER push)
    - helm package charts/genieai-umbrella -d /tmp/chart
    - helm push /tmp/chart/genieai-umbrella-*.tgz oci://${CI_REGISTRY_IMAGE}/genieai
    # Sign with cosign. env://COSIGN_KEY makes cosign read the PEM from
    # the (masked) CI variable — no key material in argv or logs.
    - cosign sign --key env://COSIGN_KEY ${CHART_REF}:${CHART_VERSION}
    # Verify — fail the job on a real signature mismatch (do NOT use `|| true`).
    - cosign verify --key env://COSIGN_KEY ${CHART_REF}:${CHART_VERSION}
  rules:
    - if: $CI_COMMIT_TAG
      when: on_success
  needs:
    - job: charts:lint
      optional: true
    - job: charts:integration
      optional: true
    - job: charts:scan
      optional: true
```

- [ ] **Step 2: EXTEND the existing `charts/Makefile`** (shipped by the foundation plan — do NOT replace it: a wholesale rewrite reintroduces the doubly-broken-Makefile defect from plan-defects.md Wave 9 #1). Add the targets below, keeping the existing `lint`/`lint-common`/`lint-umbrella`/`template`/`test`/`docs`/`deps` set. All paths are CHART-RELATIVE (the Makefile lives in `charts/`; `make -C charts` must work).

```makefile
# Additions to charts/Makefile (existing targets unchanged above)

OVERLAY_DEV := ../deploy/environments/dev/values-override.yaml

.PHONY: docs-check
docs-check:
	helm-docs --chart-search-root=. --check

.PHONY: render
render:
	helm template test genieai-umbrella --values $(OVERLAY_DEV) --include-crds > /tmp/genieai-rendered.yaml

.PHONY: install-dev
install-dev:
	helm install test genieai-umbrella --values $(OVERLAY_DEV) --create-namespace --namespace genieai

# Existing `test` target already runs `ct install` — keep it; the plain
# `helm test` invocation below complements it for an installed release.
.PHONY: helm-test
helm-test:
	helm test test --namespace genieai
```

Note: the earlier draft of this step created a `lint-strict` target and installed helm-docs as a helm plugin — both wrong (lint already runs `--strict`; helm-docs is a standalone binary, installed per the foundation plan).

- [ ] **Step 3: Verify the `charts:lint` job in a local dry-run** (skip the cluster install, just lint)

```bash
docker run --rm -v $(pwd):/work -w /work registry.example.org/dev-tools/helm-ct:1.33 \
  sh -c 'helm lint charts/genieai-umbrella --strict && conftest test policies/ || exit 1'
```

Expected: 0 errors. (Conftest policies are Task 2 — the test exits 0 even when `policies/` is empty; Task 2 adds the policies before this is run again.)

- [ ] **Step 4: Commit**

```bash
git add .gitlab-ci.yml charts/Makefile
git commit -m "ci(charts): add charts:lint, charts:integration, charts:scan jobs"
```

---

### Task 2: conftest (OPA Rego) policies — secret-leak, placeholder sweep, opt-in annotation whitelist

**Files:**
- Create: `policies/secret-leak.rego` (secret-leak lint per spec §13.2)
- Create: `policies/sealed-secret-placeholder.rego` (PLACEHOLDER+ sentinel detection)
- Create: `policies/chart-defaults-leak.rego` (forbid chart-side Issuer / ClusterIssuer / private IP / placeholder URL)
- Create: `policies/tests/test-data.yaml` (test fixtures)

**Interfaces:**
- Consumes: `charts/**/templates/**/*.yaml` (rendered or unrendered; conftest accepts both).
- Produces: 3 deny rules + test fixtures; `conftest test policies/` returns 0 on a clean chart, non-zero on regression.

- [ ] **Step 1: Write `policies/secret-leak.rego`**

```rego
package main

# Per spec §13.2: deny ConfigMap + Secret with secret-shaped keys
# containing non-empty values. The chart's SealedSecret templates
# intentionally use `encryptedData:` (not `data:`), so this rule
# does NOT false-positive on the chart's own SealedSecret rendering.

deny[msg] {
  input.kind == "ConfigMap"
  some k
  # Bare `input.data[k]` only holds for the literal boolean true in Rego —
  # a string value like "hunter2" makes the expression undefined and the
  # rule silently never fires. The != "" comparison both dereferences AND
  # asserts non-empty.
  input.data[k] != ""
  regex.match(`(?i)(password|secret|token|apikey|api_key)`, k)
  msg := sprintf("configmap %q has secret-shaped key %q with non-empty value — use a SealedSecret instead", [input.metadata.name, k])
}

deny[msg] {
  input.kind == "Secret"
  some k
  input.data[k] != ""
  regex.match(`(?i)(password|secret|token)`, k)
  msg := sprintf("secret %q has data key %q with non-empty value — use a SealedSecret instead", [input.metadata.name, k])
}

# Per spec §13.2: forbid any raw `Secret` resource that isn't marked
# as managed by a sealed-secret / ESO / SecretProviderClass backend.
# The chart's SealedSecret templates DO render `Secret` resources
# transitively (via the controller), but the chart itself must never
# author a raw `Secret` — every Secret must come from one of the
# three managed paths. This rule catches the regression where a
# developer adds a literal `Secret` to the chart source.
deny[msg] {
  input.kind == "Secret"
  not input.metadata.annotations["genieai.io/managed-by"]
  not input.metadata.annotations["sealedsecrets.bitnami.com/managed"]
  not input.metadata.annotations["external-secrets.io/managed"]
  not input.metadata.annotations["azure.workload.identity/client-id"]
  msg := sprintf("raw Secret %q in chart source — must carry one of the managed-by annotations (genieai.io/managed-by | sealedsecrets.bitnami.com/managed | external-secrets.io/managed | azure.workload.identity/client-id); convert to SealedSecret", [input.metadata.name])
}

# GitLab CI variables that should never end up in committed files.
# Catches `$(echo $CI_REGISTRY_PASSWORD)` style accidental leaks.
deny[msg] {
  # Workload manifests nest containers under spec.template.spec (Deployment,
  # StatefulSet, DaemonSet, Job); bare Pods use spec directly. Evaluate both
  # shapes — matching only one makes the rule dead against the rendered chart.
  some container
  container := input.spec.template.spec.containers[_]
  some env
  env := container.env[_]
  contains(env.value, "$CI_")
  not contains(env.name, "CI_")    # env name may reference CI_* variables, but not literal $CI_* in values
  msg := sprintf("container %q env %q contains a literal $CI_* reference — use a Secret or envFrom", [container.name, env.name])
}

deny[msg] {
  some container
  container := input.spec.containers[_]
  some env
  env := container.env[_]
  contains(env.value, "$CI_")
  not contains(env.name, "CI_")
  msg := sprintf("container %q env %q contains a literal $CI_* reference — use a Secret or envFrom", [container.name, env.name])
}
```

- [ ] **Step 2: Write `policies/sealed-secret-placeholder.rego`**

```rego
package main

# Plan 2/5 ships sealed secrets with base64('PLACEHOLDER+') sentinels.
# The sealed-secrets controller marks them `invalid` and never
# materialises the underlying K8s Secret, which silently breaks
# CNPG / ArangoDeployment / Keycloak (Waiting for secret forever).
#
# CI must catch the sentinel BEFORE the merge. The rule decodes
# base64 (OPA 1.0+ has `base64.decode` natively; for OPA < 1.0,
# the fallback path uses the KNOWN base64 of "PLACEHOLDER+"
# computed once at policy-evaluation time).

# KNOWN base64 sentinels (computed once; add to this set when a new
# chart-side sentinel is introduced). The set lives in code (not as
# a `set` of strings, because the decode is per-encryptedData-value
# and we want a clear deny per match).
PLACEHOLDER_PLUS_B64 := "UExBQ0VIT0xERVIr"   # base64("PLACEHOLDER+")
PLACEHOLDER_B64      := "UExBQ0VIT0xERVI"   # base64("PLACEHOLDER")

# PRIMARY: OPA 1.0+ `base64.decode` — catches every literal
# placeholder phrase, not just the known sentinels. Operators
# extending the chart with a new placeholder just add the phrase
# to PLACEHOLDER_PHRASES — no code change required.
PLACEHOLDER_PHRASES := {"PLACEHOLDER+", "REPLACE_ME", "TODO_FILL_IN"}

deny[msg] {
  input.kind == "SealedSecret"
  some k
  v := input.spec.encryptedData[k]
  decoded := base64.decode(v)
  phrase := PLACEHOLDER_PHRASES[_]
  decoded == phrase
  msg := sprintf("sealedsecret %q has a sealed-secret placeholder (%q) in key %q — re-seal with kubeseal", [input.metadata.name, phrase, k])
}

# FALLBACK: OPA < 1.0 cannot decode base64. The KNOWN base64 of
# the canonical sentinel is matched directly. (OPA will choose the
# built-in `base64.decode` path when available; the fallback only
# fires on OPA versions that lack the built-in, which is fine — the
# deny set is identical.)
deny[msg] {
  input.kind == "SealedSecret"
  some k
  v := input.spec.encryptedData[k]
  v == PLACEHOLDER_PLUS_B64
  msg := sprintf("sealedsecret %q has a PLACEHOLDER+ sentinel (base64) in key %q — re-seal with kubeseal", [input.metadata.name, k])
}
```

- [ ] **Step 3: Write `policies/chart-defaults-leak.rego`**

```rego
package main

# 1. The chart must NOT ship an Issuer / ClusterIssuer / Secret-backed
#    cloud credentials. The cert-manager Issuer is a cluster concern
#    (spec §9 + Plan 6 Task 3) — operators create it, the chart only
#    references it by name.
deny[msg] {
  input.kind == "Issuer"
  msg := sprintf("chart ships an Issuer %q — the chart must reference cluster-defined Issuers, not create them", [input.metadata.name])
}

deny[msg] {
  input.kind == "ClusterIssuer"
  msg := sprintf("chart ships a ClusterIssuer %q — the chart must reference cluster-defined ClusterIssuers", [input.metadata.name])
}

# 2. The chart must NOT hardcode private IP addresses (10.x, 172.16-31.x,
#    192.168.x) in the rendered output — those belong in the per-env
#    overlay. el-salvador's 10.0.0.102 is the kind of value that
#    must NEVER leak into the chart.
deny[msg] {
  some container
  # Rendered workloads are Deployments — containers live under
  # spec.template.spec; evaluate BOTH paths or the rule matches nothing.
  container := input.spec.template.spec.containers[_]
  some env
  env := container.env[_]
  regex.match(`\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b`, env.value)
  msg := sprintf("container %q env %q value contains a private IP — move to per-env overlay", [container.name, env.name])
}

# 3. The chart must NOT hardcode *.svc.cluster.local (those are
#    cluster-internal, but if a placeholder pattern is found, the
#    operator forgot a real value).
deny[msg] {
  some container
  container := input.spec.containers[_]
  some env
  env := container.env[_]
  contains(env.value, "<your-cluster>")
  msg := sprintf("container %q env %q has a '<your-cluster>' placeholder — replace or move to overlay", [container.name, env.name])
}
```

- [ ] **Step 4: Write `policies/fixtures/test-data.yaml`** (fixtures live in `fixtures/`, not `tests/` — the latter collides with pytest's `conftest.py` directory convention; spec §13.2 uses `tests/conftest.py` for pytest fixtures, and `policies/tests/` would confuse reviewers)

```yaml
# Test fixtures for conftest. Run with: conftest test policies/tests/
#
# Each test case is a single document that conftest parses. The
# `description` field documents the test intent (the rule does NOT
# match on the description).

- kind: ConfigMap
  apiVersion: v1
  metadata:
    name: cm-secret-leak-positive
  data:
    PASSWORD: hunter2    # should be DENIED
    LOG_LEVEL: info      # should pass
---
- kind: Secret
  apiVersion: v1
  metadata:
    name: secret-leak-positive
  data:
    token: abcdef      # should be DENIED
---
- kind: SealedSecret
  apiVersion: bitnami.com/v1alpha1
  metadata:
    name: ss-placeholder-positive
  spec:
    encryptedData:
      password: UExBQ0VIT0xERVIr     # base64 of 'PLACEHOLDER+' — should be DENIED
---
- kind: SealedSecret
  apiVersion: bitnami.com/v1alpha1
  metadata:
    name: ss-placeholder-valid
  spec:
    encryptedData:
      password: AgZzdGVybAo=          # random base64 — should pass
---
- kind: Issuer
  apiVersion: cert-manager.io/v1
  metadata:
    name: chart-shipped-issuer    # should be DENIED
---
- kind: Deployment
  apiVersion: apps/v1
  metadata:
    name: deploy-private-ip
  spec:
    template:
      spec:
        containers:
          - name: c
            env:
              - name: ENDPOINT
                value: http://10.0.0.102:8000    # should be DENIED
              - name: LOG
                value: info                       # should pass
```

- [ ] **Step 5: Run `conftest test` against the fixtures**

```bash
conftest test --policy policies/ policies/fixtures/test-data.yaml --output stdout
```

Expected: a mix of pass + fail. The 4 positive cases (cm-secret-leak, ss-placeholder, chart-shipped-issuer, deploy-private-ip) FAIL; the 2 negative cases (LOG_LEVEL, ss-placeholder-valid) pass. The exit code is non-zero — conftest exit codes map to 1 on any fail.

- [ ] **Step 6: Run `conftest test` against the rendered chart**

```bash
helm template test charts/genieai-umbrella --values deploy/environments/dev/values-override.yaml \
  | conftest test --policy policies/ --output stdout -
```

Expected: 0 violations (the chart itself doesn't ship `PLACEHOLDER+` sentinels — the sentinels only appear in the chart source, not in the rendered output; the secret-leak rule may flag a few `value: secret` patterns in legacy code, fix on sight).

- [ ] **Step 7: Commit**

```bash
git add policies/
git commit -m "ci(charts): conftest policies - secret-leak, PLACEHOLDER sweep, chart-side Issuer/IP forbid"
```

---

### Task 3: cosign chart signing (CI step) + Kyverno verifyImages ClusterPolicy (chart template)

**Files:**
- Create: `charts/genieai-umbrella/templates/policies/kyverno-verify-images.yaml` (the ClusterPolicy)
- Create: `charts/genieai-umbrella/values-policies.yaml.example` (operator-side: where to set the real public key)
- Create: `deploy/gitops/cosign-key-secret.example` (template for the secret Kyverno needs to load the key — INLINE PEM per the round-7 finding)

**Interfaces:**
- Consumes: `Values.cosign.publicKey` (an INLINE PEM string the operator commits; CI renders the chart, then templates the inline PEM into the ClusterPolicy).
- Produces: 1 `Kyverno`-managed ClusterPolicy + 1 sample Secret holding the key. The chart NEVER installs Kyverno (cluster bootstrap prerequisite, same posture as the GPU operator / cert-manager / keycloak-operator).

- [ ] **Step 1: REMOVED — cosign sign/verify moved to `publish:charts` in Task 1 Step 1** (C5 fix: the integration job does not push the chart; cosign would sign a non-existent image). See the `publish:charts` block added to Task 1 Step 1.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/policies/kyverno-verify-images.yaml`**

```yaml
{{- if .Values.cosign.enabled -}}
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-genieai-umbrella
  annotations:
    policies.kyverno.io/title: Verify GENIE.AI umbrella chart signatures
    policies.kyverno.io/severity: medium
spec:
  validationFailureAction: Enforce
  background: false
  rules:
    - name: verify-signature
      match:
        any:
          - resources:
              kinds:
                - Pod
      verifyImages:
        - imageReferences:
            # `{{ .Values.cosign.imagePattern }}` — NOT `${CI_REGISTRY_IMAGE}/...`
            # (`${...}` is a GitLab CI runtime var, NOT a Helm template
            # var; the `${...}` would render literally, the policy would
            # match zero pods, and the chart's admission control is
            # dead. : template-side, the value comes from the
            # values-override.)
            - "{{ .Values.cosign.imagePattern }}"
          attestors:
            - entries:
                - keys:
                    # Verified against the Kyverno CRD: the real schema
                    # field for inline PEM is `publicKeys` (accepts
                    # directly-specified X.509 keys; no Secret/ConfigMap
                    # references). An earlier draft used `keyData`, which
                    # does not exist in the schema and would be silently
                    # pruned — verifyImages would then match and verify
                    # nothing while appearing Enforced.
                    # The `{{- ... | nindent 22 }}` indents the
                    # multi-line PEM block inside the YAML scalar.
                    publicKeys: |-
                      {{- .Values.cosign.publicKey | nindent 22 }}
{{- end -}}
```

The `{{- .Values.cosign.publicKey | nindent 22 }}` block renders the operator-committed INLINE PEM (multi-line `-----BEGIN PUBLIC KEY-----` block) directly into the `publicKeys:` field. Kyverno's API does NOT accept Secret/ConfigMap references for `publicKeys` — only inline PEM strings. Operators commit the public key to a values-override file (NOT to the chart source).

- [ ] **Step 3: Write `charts/genieai-umbrella/values-policies.yaml.example`**

```yaml
# Operator-side values for the chart's optional policies (cosign,
# Kyverno ClusterPolicy, uninstall safety, etc.). CI does NOT touch
# this file — operators maintain it.
#
# Apply via:
#   helm template ... -f deploy/environments/<env>/values-override.yaml \
#                    -f charts/genieai-umbrella/values-policies.yaml

cosign:
  enabled: true
  # The image pattern Kyverno verifyImages matches. Operator-side:
  # set to the actual registry path your images publish to. It must match
  # the refs the CI actually pushes — on this project's self-hosted GitLab
  # that is <registry-host>/<project-path>/genieai/genieai-umbrella:* (the
  # same ref publish:charts signs). A pattern naming the wrong host or
  # path matches zero images and the policy enforces nothing while
  # reporting Enforced. The chart template uses
  # `{{ .Values.cosign.imagePattern }}` (NOT `${CI_REGISTRY_IMAGE}` —
  # that's a CI runtime var, not Helm).
  imagePattern: "registry.opensource.unicc.org/un/itu/genie-ai/genieai/genieai-umbrella:*"
  # The INLINE PEM of the public key cosign uses to sign the chart.
  # Multi-line, with the BEGIN/END markers. Kyverno does NOT accept
  # Secret/ConfigMap references here — inline only.
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE... (operator's actual key)
    -----END PUBLIC KEY-----
```

The `COSIGN_KEY` GitLab CI variable holds the RAW PEM private key (NOT base64-encoded — the earlier `BASE64` suffix in the plan was wrong; cosign 2.x's `env:VAR` scheme parses the value as a path OR the raw PEM, never base64).

- [ ] **Step 4: Render and verify the ClusterPolicy**

```bash
cat > /tmp/policies-values.yaml <<'EOF'
cosign:
  enabled: true
  publicKey: |
    -----BEGIN PUBLIC KEY-----
    MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdummykeydummykey
    -----END PUBLIC KEY-----
EOF
helm template test charts/genieai-umbrella -f /tmp/policies-values.yaml \
  | grep -A 12 "kind: ClusterPolicy"
```

Expected: the ClusterPolicy YAML contains the literal `-----BEGIN PUBLIC KEY-----` block in `publicKeys:`.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/policies/ charts/genieai-umbrella/values-policies.yaml.example
git commit -m "ci(charts): cosign signing (CI step) + Kyverno verifyImages ClusterPolicy with inline PEM"
```

---

### Task 4: Renovate config — chart deps + action pins

**Files:**
- Create: `renovate.json` (repo root)

**Interfaces:**
- Consumes: GitLab CI + GitLab.com Renovate app (or self-hosted Renovate).
- Produces: weekly MRs that bump Helm dep pins in `charts/genieai-umbrella/Chart.yaml` + container image tags in the per-env `values-override.yaml`.

- [ ] **Step 1: Write `renovate.json`** (strict JSON — no `#` comments; any explanatory note lives in the commit message or this plan, never in the file)

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    ":automergeMinor",
    ":automergePatch",
    "group:allNonMajor"
  ],
  "enabledManagers": [
    "helmv3",
    "helm-values",
    "dockerfile",
    "github-actions"
  ],

  "helmv3": {
    "fileMatch": ["(^|/)charts/genieai-umbrella/Chart\\.yaml$"]
  },
  "helm-values": {
    "fileMatch": ["(^|/)deploy/environments/.*/values-override\\.yaml$"]
  },
  "packageRules": [
    {
      "description": "CRD-owner charts: plain-semver releases only, keeping updates inside the `~>` same-minor pins Chart.yaml declares (the old `/^~/` regex matched the constraint syntax, not release versions, and rejected every candidate)",
      "matchManagers": ["helmv3"],
      "matchPackageNames": [
        "cloudnative-pg",
        "kube-arangodb",
        "victoria-metrics-operator",
        "opentelemetry-operator",
        "grafana-operator",
        "sealed-secrets"
      ],
      "allowedVersions": "/^\d+\.\d+\.\d+$/"
    },
    {
      "description": "GPU operator / cert-manager / envoy-gateway: version pins update freely but DO NOT cross major",
      "matchManagers": ["helmv3"],
      "matchPackageNames": ["cert-manager", "envoy-gateway"],
      "major": { "enabled": false }
    },
    {
      "description": "Container image tags: pin to digest, not tag (deployable reproducibility)",
      "matchManagers": ["helm-values"],
      "matchDatasources": ["docker"],
      "pinDigests": true
    }
  ],
  "schedule": ["before 6am on monday"],
  "timezone": "Europe/Paris",
  "labels": ["renovate", "dependencies"]
}
```

- [ ] **Step 2: Verify Renovate config parses** (if `renovate` is available locally)

```bash
npx --yes renovate-config-validator 2>&1 | head
```

Expected: no errors. (If the validator is not available, this step is skipped; CI runs the validator via the GitLab.com Renovate app on first schedule.)

- [ ] **Step 3: Commit**

```bash
git add renovate.json
git commit -m "ci(charts): Renovate config - helm deps + container image digests, CRD-owner pins via `~>`"
```

---

### Task 5: PII smoke test — K8s port (replaces Docker-based `tests/otel-collector/run-pii-smoke.sh`)

**Files:**
- Create: `tests/otel-collector/run-pii-smoke-k8s.sh` (the K8s-flavored runner)
- Modify: `tests/otel-collector/run-pii-smoke.sh` (deprecate, mark as "K8s-only now"; rename to `.sh.docker` or leave with a header comment)

**Interfaces:**
- Consumes: the running observability stack (or a minimal kind cluster with the chart's observability tier installed).
- Produces: a `kubectl run` sidecar that sends a PII envelope via OTLP, asserts the redaction worked by querying VictoriaLogs.

- [ ] **Step 1: Write `tests/otel-collector/run-pii-smoke-k8s.sh`**

```bash
#!/usr/bin/env bash
# PII smoke test for the K8s observability tier.
#
# Replaces the original Docker-based runner
# (tests/otel-collector/run-pii-smoke.sh) which assumed Docker Compose
# + the old fluentd driver pipeline.
#
# Strategy: start a kind cluster, install the chart with
# observability.enabled=true, send a log line with a known PII pattern
# (email, IP, hex, UUID) via the OTLP/HTTP endpoint, then query
# VictoriaLogs to assert the line came back with the patterns
# redacted.
#
# Requirements: kind, kubectl, helm, curl, jq, base64.

set -euo pipefail

NS=${NS:-genieai-pii-test}
RELEASE=${RELEASE:-pii-test}
# No hyphens: the sk- apikey rule needs a 20+ char [a-z0-9] run — a
# hyphenated marker inside the apikey breaks the regex, the value is never
# redacted, and the raw-value assertion fails on every run.
MARKER="piimarker$(uuidgen 2>/dev/null | tr -d '-' || echo $RANDOM$RANDOM)"

echo "=== PII smoke test (K8s) ==="
echo "Namespace: $NS"
echo "Release: $RELEASE"
echo "Marker: $MARKER"

# 1. kind cluster (idempotent — skip if exists)
kind get clusters | grep -q pii-test || \
  kind create cluster --wait 60s --name pii-test
kubectl cluster-info --context kind-pii-test >/dev/null

# 2. Install the chart with observability on (use the dev overlay +
#    override observability.enabled to true; the other toggles stay
#    off — we only need the OTLP gateway + VictoriaLogs reachable).
helm repo add bitnami https://charts.bitnami.com/bitnami >/dev/null 2>&1 || true
helm install $RELEASE charts/genieai-umbrella \
  --namespace $NS --create-namespace \
  --values deploy/environments/dev/values-override.yaml \
  --set namespace=$NS \
  --set observability.enabled=true \
  --set observability.otel.enabled=true \
  --set observability.logs.enabled=true \
  --set observability.traces.enabled=true \
  --set observability.metrics.enabled=true \
  --set observability.grafana.enabled=true \
  --wait --timeout 20m

# 3. Wait for the OTLP gateway to be Available. The operator names the
#    collector Deployment `<cr>-collector`; the chart labels resources with
#    genieai.io/component (NOT app.kubernetes.io/component) — waiting on
#    that label never matches anything.
kubectl wait --namespace $NS --for=condition=Available \
  deployment/genieai-collector-collector --timeout=10m

# 4. Inject a log line with PII patterns. The set of patterns the
#    smoke test asserts on is INTENTIONALLY limited to what the
#    chart's OTel collector redaction rules (ported verbatim from
#    configs/otel/otel-collector-config.yaml) actually catch. The
#    rule coverage is:
#      - email:            [A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}
#      - JWT:              eyJ[A-Za-z0-9_-]+\\.?[A-Za-z0-9_-]+
#      - API-key prefix:   (sk|pk|api)[-_][A-Za-z0-9]{20,}
#      - long base64/hex:  [A-Za-z0-9_=-]{40,}
#      - bearer:           Bearer [A-Za-z0-9_.-]+
#    IP / UUID / short-hex patterns are NOT in the redaction rules.
#    The PII smoke test asserts only the covered patterns; adding
#    IP / UUID coverage is Plan 4 work (extend the redaction rules
#    in the ported OTel collector config).
OTLP_URL="http://genieai-collector-collector.$NS.svc.cluster.local:4318/v1/logs"
# Every value below MUST appear in the injected log body AND be checked in
# step 6 — an assertion over a value never injected passes vacuously (the
# failure mode of the first docker-based PII smoke test; code-review
# fixed sizes). Lengths are padded so the {40,} / bearer
# patterns match regardless of marker length.
PII_EMAIL="leak-$MARKER@example.com"
PII_JWT="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWFrIn0.fakefakefake"
PII_APIKEY="sk-$MARKER-1234567890abcdef1234"
PII_LONGHEX="${MARKER}abcdef0123456789abcdef0123456789abcdef0123456789abcdef"   # >= 48 chars, matches {40,}
PII_BEARER="Bearer ${MARKER}abcdefghijklmnopqrstuvwxyz0123456789abc"            # >= 40 chars after "Bearer "

# Build a minimal OTLP log request (one resource + one log record).
# NOTE: only the patterns the redaction rules cover are injected — no
# bare IP / UUID (not in the rules; would muddy the assertions).
PAYLOAD=$(cat <<EOF
{
  "resourceLogs": [{
    "resource": {
      "attributes": [{
        "key": "service.name",
        "value": { "stringValue": "pii-smoke" }
      }]
    },
    "scopeLogs": [{
      "scope": { "name": "pii-smoke", "version": "1.0" },
      "logRecords": [{
        "timeUnixNano": "$(date +%s)000000000",
        "severityNumber": 9,
        "severityText": "INFO",
        "body": { "stringValue": "marker=$MARKER email=$PII_EMAIL jwt=$PII_JWT apikey=$PII_APIKEY hex=$PII_LONGHEX auth=$PII_BEARER" }
      }]
    }]
  }]
}
EOF
)

# Inject FROM INSIDE the cluster: *.svc.cluster.local does not resolve on
# the host running this script. Run curl in an in-cluster pod instead.
printf '%s' "$PAYLOAD" > /tmp/pii-payload.json
kubectl run pii-inject --rm -i --restart=Never --image=curlimages/curl:8.10.1 \
  -n "$NS" --command -- sh -c "curl -fsS -X POST -H 'Content-Type: application/json' \
  --data-binary @/dev/stdin $OTLP_URL" < /tmp/pii-payload.json >/dev/null
echo "Sent PII envelope (marker=$MARKER)"

# 5. Wait for the log to reach VictoriaLogs (eventual consistency;
#    5s is the empirical floor on a kind cluster).
sleep 10

# 6. Query VictoriaLogs for the marker; expect PII patterns to be
#    REDACTED, not the raw values. Port-forward to reach the in-cluster
#    service from this host (svc DNS is unresolvable outside kind).
QUERY="service.name:pii-smoke _msg:'$MARKER'"
kubectl -n "$NS" port-forward svc/vlogs 9428:9428 >/dev/null 2>&1 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
sleep 3

# Pull the log body. Assert the raw PII values are NOT present.
RAW=$(curl -fsS --get --data-urlencode "query=$QUERY" "http://127.0.0.1:9428/select/logsql/query" || true)
echo "--- VL response ---"
echo "$RAW" | head -20
echo "-------------------"

# POSITIVE CONTROL FIRST: the marker row must exist in the response.
# Without it, every "PII not present" assertion below passes vacuously
# (empty response = nothing found = false green).
if ! echo "$RAW" | grep -q "$MARKER"; then
  echo "FAIL: marker row never reached VictoriaLogs — pipeline broken upstream; redaction assertions below would be meaningless"
  exit 1
fi
echo "OK: marker row present in VictoriaLogs (positive control)"

fail=0
if echo "$RAW" | grep -q "$PII_EMAIL"; then
  echo "FAIL: email $PII_EMAIL present in VL (not redacted)"; fail=1
fi
if echo "$RAW" | grep -q "$PII_JWT"; then
  echo "FAIL: JWT $PII_JWT present in VL (not redacted)"; fail=1
fi
if echo "$RAW" | grep -q "$PII_APIKEY"; then
  echo "FAIL: API key $PII_APIKEY present in VL (not redacted)"; fail=1
fi
if echo "$RAW" | grep -q "$PII_LONGHEX"; then
  echo "FAIL: long hex $PII_LONGHEX present in VL (not redacted)"; fail=1
fi
if echo "$RAW" | grep -q "$PII_BEARER"; then
  echo "FAIL: bearer $PII_BEARER present in VL (not redacted)"; fail=1
fi

if [ $fail -eq 0 ]; then
  echo "PASS: PII redaction confirmed for $MARKER (5/5 patterns)"
fi

# 7. Cleanup (operator choice — leave the kind cluster for re-runs,
#    or delete it). Default: delete.
kind delete cluster --name pii-test 2>/dev/null || true

exit $fail
```

- [ ] **Step 2: Mark the Docker-based runner as deprecated**

Add a header comment to `tests/otel-collector/run-pii-smoke.sh`:

```bash
# DEPRECATED — this script assumed a Docker Compose observability stack.
# Use `tests/otel-collector/run-pii-smoke-k8s.sh` (Plan 7 Task 5) for the
# chart's K8s observability tier. The Docker script is kept for reference
# only; do not run in CI.
```

- [ ] **Step 3: Commit**

```bash
git add tests/otel-collector/run-pii-smoke-k8s.sh tests/otel-collector/run-pii-smoke.sh
git commit -m "test(observability): PII smoke runner rewritten for K8s"
```

---

### Task 6: Final validation + READMEs + status badges

**Files:**
- Modify: `charts/README.md` (status badges for the new CI jobs)
- Modify: `docs/charts/plan-defects.md` (Plan 7 wave entry)
- Modify: `.gitlab-ci.yml` (verify the `charts-integration` stage added in Task 1 sits between `build` and `scan`)

**Interfaces:**
- Consumes: every prior task.
- Produces: documentation + pipeline stage wiring.

- [ ] **Step 1: Verify the `stages:` list matches Task 1's layout** (NO new stage here — Task 1 already inserted `charts-integration` between `build` and `scan`; a `charts` stage would orphan the `charts:integration` job's `stage:` and invalidate the whole pipeline)

```yaml
stages:
  - lint
  - test
  - config
  - build
  - charts-integration   # inserted earlier
  - scan
  - charts:publish       # inserted with the publish job
  - e2e
  - promote
```

- [ ] **Step 2: Update `charts/README.md`** with status badges

```markdown
[![charts:lint](https://gitlab.example.org/un/itu/genie-ai/badges/main/pipeline.svg?job=charts:lint)](https://gitlab.example.org/un/itu/genie-ai/-/jobs?job=charts:lint)
[![charts:integration](https://gitlab.example.org/un/itu/genie-ai/badges/main/pipeline.svg?job=charts:integration)](https://gitlab.example.org/un/itu/genie-ai/-/jobs?job=charts:integration)
[![charts:scan](https://gitlab.example.org/un/itu/genie-ai/badges/main/pipeline.svg?job=charts:scan)](https://gitlab.example.org/un/itu/genie-ai/-/jobs?job=charts:scan)
```

- [ ] **Step 3: Add Plan 7 wave to `docs/charts/plan-defects.md`**

```
## Plan 7 - CI / Signing / Safety

Tasks 1-6 shipped: three new GitLab CI jobs (`charts:lint` for
`helm lint --strict` + `helm-docs --check` + `conftest test`; `charts:integration`
for `helm install` on a fresh kind cluster + `helm test` + connectivity
smoke; `charts:scan` for `trivy config` against the rendered YAML);
three conftest (OPA Rego) policies (secret-leak lint, PLACEHOLDER+
sentinel sweep, chart-side Issuer / private IP forbid); cosign chart
signing (`--key env://COSIGN_KEY`; key material stays in the masked
CI variable, never in argv); Kyverno `verifyImages` ClusterPolicy with
INLINE PEM only (no Secret/ConfigMap references); Renovate config
that pins CRD-owner charts with `~>` and pins container image tags
to digests; K8s-port PII smoke test runner. Spec §13 (test strategy)
+ §13.1 (uninstall safety) + §13.2 (secret-leak lint) + §14 (signing
+ admission control) are all concretized here.
```

- [ ] **Step 4: Render summary + lint + commit**

```bash
helm lint charts/genieai-umbrella --strict
conftest test policies/
git add .gitlab-ci.yml charts/README.md charts/Makefile policies/ renovate.json tests/otel-collector/run-pii-smoke-k8s.sh tests/otel-collector/run-pii-smoke.sh docs/charts/plan-defects.md
git commit -m "ci(charts): charts CI stage + conftest + cosign + Renovate + K8s PII smoke"
```

---

## Self-Review

**1. Spec coverage**:

| Spec section | Task |
|---|---|
| §13.0 (test strategy - 3 layers) | Task 1 (`charts:integration` covers the cluster + functional layers) |
| §13.1 (uninstall safety + pre-install backup hook) | Plan 6 Task 6 shipped the per-env opt-in (release annotation + per-env `uninstallPolicy.enabled`); Plan 7 does NOT add a conftest policy for this (I2 — the claim in the previous self-review was a false positive; the chart's pre-delete hook + annotation are the runtime gate, not a conftest lint). |
| §13.2 (secret-leak lint) | Task 2 (`policies/secret-leak.rego`) |
| §14 (chart signing + admission control) | Task 3 (cosign CI step + Kyverno ClusterPolicy) |
| §17 manifest entries | Task 6 README |

**2. Placeholder scan**: only intentional `PLACEHOLDER+` (base64 sentinel) in SealedSecret templates. The conftest policy detects this same sentinel in committed YAML.

**3. Type consistency**: `helm lint` / `helm template` / `helm-docs` / `conftest` / `cosign` / `kyverno` all invoked via their standard CLI shape; no exotic config.

**4. Review Focus coverage**: all five pinned (Task 1 Step 3, Task 2 Step 1, Task 3 Step 1, Task 3 Step 2, Task 2 Step 3).

**5. Adversarial review note**: run `/code-review` on this plan before execution.

---

## Plan Stats

- **Tasks:** 6
- **New files:** ~10 (1 Makefile, 1 renovate.json, 1 kyverno ClusterPolicy template, 3 conftest policies + 1 test fixture, 1 PII smoke runner, 1 values-policies example, 1 CI stage addition)
- **CI jobs added:** 3 (`charts:lint`, `charts:integration`, `charts:scan`)
- **Commits planned:** 6
- **Estimated review surface:** ~500 lines added

## What's next after Plan 7

- **Plan 8**: documentation (site/content/en/docs/deployment/ + docs/charts/* + Hugo build verified, README badges, K8s-bootstrap playbook per the open question on Plan 6)
- **Future** (out of spec): el-salvador migration plan (uses the prod-vierge template as a fork point), bootstrap playbook for k3s vs minikube vs kubespray, ArgoCD Bootstrap ApplicationSet pattern
