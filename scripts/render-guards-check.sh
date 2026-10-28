#!/usr/bin/env bash
# Exercises the chart's RENDER-TIME guards.
#
# Why this exists: `helm lint --strict` downgrades a template's `fail()`
# to an INFO line and exits 0 — verified on helm 3.16.3, which prints
# `level=INFO msg="funcMap fail"` for every guard it hits and still
# reports "0 chart(s) failed". So the one job that looked like it
# checked the guards could never fail on them, and every CI render
# passes `--set data.keycloak.failOnPlaceholderSecrets=false` (the
# shared render fixture), which switches two of them off entirely. A
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
# COVERAGE: every guard an OPERATOR can reach has a case here. The
# guards left without one are unreachable from values by construction:
#   - the dependency-graph type guard (a node whose value is a scalar) —
#     Helm's coalesce always keeps the chart's table and warns about
#     the scalar, so no operator value can produce it;
#   - the envRows shape guards (a row that is not a map, a row without a
#     name, a row with neither value nor valueFrom) — the templates
#     build those rows, not the operator;
#   - the instance-count guards — the schema rejects a 0 first.
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

# expect_fail <label> <expected message fragment> <flags...>
expect_fail() {
  local label="$1" expected="$2"
  shift 2
  local output rc
  output="$(helm template "${RELEASE}" "${CHART}" -n "${NS}" "$@" 2>&1)"
  rc=$?
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
  output="$(helm template "${RELEASE}" "${CHART}" -n "${NS}" "$@" 2>&1)"
  rc=$?
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
  $(valid_flags) --set opea.enabled=true --set 'opea.gpu.nodeHost=[2001:db8::1]:444'

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

# 20. The documented valid configuration must still render: a guard that
#     rejects a good deployment is a defect too.
expect_ok "the documented values render" $(valid_flags)

if [ "${fails}" -ne 0 ]; then
  echo
  echo "${fails} render guard(s) did not behave as documented."
  exit 1
fi
echo
echo "every render guard fired as documented, and the valid configuration rendered"
