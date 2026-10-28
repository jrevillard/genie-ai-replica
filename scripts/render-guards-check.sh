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
#    key the operator typed.
#    The TLS listener and the http→https redirect are what consume the
#    port, and the shared fixture leaves TLS off — so the case enables
#    it (the malformed port is the only invalid thing in it).
expect_fail "a non-numeric port in ingress.host" \
  "ingress.host carries an invalid port" \
  $(valid_flags) --set 'ingress.host=genieai.local:443x' \
  --set ingress.tls.enabled=true --set ingress.tls.issuerName=selfsigned

# 9. An environment variable with no value is a typo, not an empty
#    string: sprig's `toString nil` produces the four-character text
#    "<nil>", which would reach the pod as a real value.
expect_fail "an environment variable with no value" \
  "has no value: declare an empty string" \
  $(valid_flags) --set 'services.frontend.env.FOO=null'

# 10. The documented valid configuration must still render: a guard that
#     rejects a good deployment is a defect too.
expect_ok "the documented values render" $(valid_flags)

if [ "${fails}" -ne 0 ]; then
  echo
  echo "${fails} render guard(s) did not behave as documented."
  exit 1
fi
echo
echo "every render guard fired as documented, and the valid configuration rendered"
