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

# The values a complete, valid release carries: the public origin, the
# operator contact, a mail server, the three client-secret placeholders
# (formal tickets — the realm's real secrets come from the convergence
# rows) and the five convergence envSecrets rows the realm's $(env:VAR)
# placeholders resolve from.
valid_flags() {
  printf '%s\n' \
    "--set ingress.host=guard.example.org" \
    "--set data.keycloak.adminEmail=ops@example.org" \
    "--set data.keycloak.smtp.from=no-reply@guard.example.org" \
    "--set data.keycloak.smtp.host=smtp.guard.example.org" \
    "--set data.keycloak.smtp.port=587" \
    "--set data.keycloak.smtp.starttls=true" \
    "--set data.keycloak.clientSecrets.proxyClient=guard-value" \
    "--set data.keycloak.clientSecrets.dataprep=guard-value" \
    "--set data.keycloak.clientSecrets.grafana=guard-value" \
    "--set data.keycloak.convergence.envSecrets[0].envVar=KC_PROXY_CLIENT_SECRET" \
    "--set data.keycloak.convergence.envSecrets[0].secretName=keycloak-proxy-client-secret" \
    "--set data.keycloak.convergence.envSecrets[0].secretKey=KEYCLOAK_PROXY_CLIENT_SECRET" \
    "--set data.keycloak.convergence.envSecrets[1].envVar=KC_DATAPREP_CLIENT_SECRET" \
    "--set data.keycloak.convergence.envSecrets[1].secretName=kc-dataprep-client-secret" \
    "--set data.keycloak.convergence.envSecrets[1].secretKey=KC_DATAPREP_CLIENT_SECRET" \
    "--set data.keycloak.convergence.envSecrets[2].envVar=KC_GRAFANA_CLIENT_SECRET" \
    "--set data.keycloak.convergence.envSecrets[2].secretName=kc-grafana-client-secret" \
    "--set data.keycloak.convergence.envSecrets[2].secretKey=KEYCLOAK_GRAFANA_CLIENT_SECRET" \
    "--set data.keycloak.convergence.envSecrets[3].envVar=GENIE_ADMIN_PASSWORD" \
    "--set data.keycloak.convergence.envSecrets[3].secretName=keycloak-convergence-credentials" \
    "--set data.keycloak.convergence.envSecrets[3].secretKey=GENIE_ADMIN_PASSWORD" \
    "--set data.keycloak.convergence.envSecrets[4].envVar=EMAIL_PASSWORD" \
    "--set data.keycloak.convergence.envSecrets[4].secretName=keycloak-convergence-credentials" \
    "--set data.keycloak.convergence.envSecrets[4].secretKey=EMAIL_PASSWORD"
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

# 7. The documented valid configuration must still render: a guard that
#    rejects a good deployment is a defect too.
expect_ok "the documented values render" $(valid_flags)

if [ "${fails}" -ne 0 ]; then
  echo
  echo "${fails} render guard(s) did not behave as documented."
  exit 1
fi
echo
echo "every render guard fired as documented, and the valid configuration rendered"
