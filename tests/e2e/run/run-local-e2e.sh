#!/usr/bin/env bash
#
# The local e2e run — the executed set of the Playwright suite.
#
# The suite has no CI door (operator decision, 2026-11-10: this suite gets no
# CI resources — it runs LOCALLY, regularly). This script IS that run: one
# command, against a deployed stack, over the WHOLE tests/e2e/ tree.
#
# Usage:
#   BASE_URL=https://genieai-forge.local:4443 tests/e2e/run/run-local-e2e.sh
#
# Environment:
#   BASE_URL                 the venue edge. Default: the shared k8s stack
#                            (namespace genieai, chart genieai-umbrella).
#   KEYCLOAK_ADMIN_PASSWORD  the master-realm admin password. When unset, the
#                            script reads it from the shared stack's
#                            keycloak-admin-credentials secret.
#   ADMIN_TOKEN              a master-realm admin token, instead of the password.
#   E2E_VENUE_IP             the address of the venue edge, for a runner that
#                            cannot resolve the venue NAME (see
#                            tests/e2e/helpers/venue-launch-args.js).
#   E2E_FILE_ISSUES          0 reports the failures without filing issues.
#
# The run ends with the failure path: a red run files one status::backlog
# issue per failing spec file (tests/e2e/run/file-failure-issues.js), and the
# run's outcome — counts, skipped specs with their reasons, failures — is
# printed whether the suite is green or red.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="${BASE_URL:-https://genieai-forge.local:4443}"
export BASE_URL
NAMESPACE="${E2E_NAMESPACE:-genieai}"

echo "=== local e2e run ==="
echo "venue: $BASE_URL"

# --- the serial slot ----------------------------------------------------------
# Two locks, both PER MACHINE: one per checkout (the report path) and one
# per venue (the shared stack). They stop two runs on this machine from
# resetting the venue fixtures' passwords under each other's logins and from
# racing for the same report file.
#
# They do NOT book the venue across machines: a laptop and this pod each
# take their own lock. The shared stack's slot is booked with the
# orchestrator (the coordination board) — that booking, not this lock, is
# what keeps two machines off the same stack.
for tool in flock md5sum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: '$tool' is not installed - the run's serial-slot locks cannot be taken." >&2
    echo "       Install it (util-linux provides flock) and run again." >&2
    exit 2
  fi
done
CHECKOUT_LOCK="${E2E_RUN_LOCK:-$REPO_ROOT/.e2e-run.lock}"
# The venue key is the NORMALIZED address: https://x:4443 and https://x:4443/
# are the same venue and must not take two locks.
VENUE_KEY="$(printf '%s' "${BASE_URL%/}" | md5sum | cut -c1-12)"
VENUE_LOCK="${E2E_VENUE_LOCK:-/tmp/genieai-e2e-$VENUE_KEY.lock}"

exec 9>"$CHECKOUT_LOCK"
if ! flock -n 9; then
  echo "ERROR: another local e2e run is using this checkout (lock: $CHECKOUT_LOCK)." >&2
  echo "       One checkout, one run at a time - wait for it to end." >&2
  exit 3
fi
exec 8>"$VENUE_LOCK"
if ! flock -n 8; then
  echo "ERROR: another local e2e run on this machine holds this venue (lock: $VENUE_LOCK)." >&2
  echo "       Wait for it to end. The slot across machines is booked with the orchestrator." >&2
  exit 3
fi
echo "slot: acquired (checkout $CHECKOUT_LOCK, venue $VENUE_LOCK)"

# --- the Keycloak admin credentials -----------------------------------------
# The fixture provisioning and the venue-profile probes both need the
# master-realm admin. Prefer what the caller supplied; otherwise read the
# shared stack's secret (the password lives in the cluster, never in the
# repository — see .claude/rules/DEMO-SEEDING.md for the same convention).
if [ -z "${ADMIN_TOKEN:-}" ] && [ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ]; then
  if command -v kubectl >/dev/null 2>&1 &&
    kubectl -n "$NAMESPACE" get secret keycloak-admin-credentials >/dev/null 2>&1; then
    KEYCLOAK_ADMIN_PASSWORD="$(kubectl -n "$NAMESPACE" get secret keycloak-admin-credentials \
      -o go-template='{{ index .data "password" | base64decode }}')"
    export KEYCLOAK_ADMIN_PASSWORD
    echo "admin credentials: the shared stack's keycloak-admin-credentials secret (namespace $NAMESPACE)"
  else
    echo "ERROR: no Keycloak admin credentials." >&2
    echo "       Set KEYCLOAK_ADMIN_PASSWORD (or ADMIN_TOKEN), or make the shared stack" >&2
    echo "       reachable (kubectl -n $NAMESPACE get secret keycloak-admin-credentials)." >&2
    exit 2
  fi
fi

# --- the venue name, for a runner that cannot resolve it ---------------------
# The shared stack advertises its edge under a name the cluster DNS does not
# serve. Node and Chromium resolve it separately, so the mapping has to reach
# both — the preload patches Node's resolver, the launch arguments carry it
# into the browser.
if [ -n "${E2E_VENUE_IP:-}" ]; then
  E2E_VENUE_HOST="${E2E_VENUE_HOST:-$(node -e 'console.log(new URL(process.env.BASE_URL).hostname)')}"
  export E2E_VENUE_HOST
  export NODE_OPTIONS="--require $REPO_ROOT/tests/e2e/run/venue-dns.js${NODE_OPTIONS:+ $NODE_OPTIONS}"
  echo "venue mapping: $E2E_VENUE_HOST -> $E2E_VENUE_IP"
fi

# --- the runner's pre-flight -------------------------------------------------
# Can this machine drive a browser against the venue at all? A broken runner
# and a broken product look the same in a report, and only one of them is a
# finding. The pre-flight stops the run before it touches the venue.
echo "pre-flight"
node tests/e2e/run/preflight.js

# --- the venue fixtures ------------------------------------------------------
echo "provisioning the venue fixtures"
node tests/e2e/provision-e2e-fixtures.js

# --- the suite ---------------------------------------------------------------
echo "running the whole tests/e2e/ tree"
set +e
npx playwright test tests/e2e/ --project=chromium
PLAYWRIGHT_STATUS=$?
set -e

# --- the outcome, and the failure path ---------------------------------------
# The report moves to a per-run name before it is read: any later
# Playwright invocation in this checkout (`--list`, a single spec) writes
# the fixed path again, and the failure path must file from the report of
# THIS run.
RUN_REPORT="reports/playwright-report-run-$(date -u +%Y%m%dT%H%M%SZ).json"
if [ -f reports/playwright-report.json ]; then
  mv reports/playwright-report.json "$RUN_REPORT"
  echo "report: $RUN_REPORT"
else
  # NO fallback to the fixed path: it holds whatever the last Playwright
  # invocation in this checkout wrote (a developer's single spec, a --list
  # run) - filing from it would file ANOTHER run's failures, and a run that
  # never wrote a report is a broken run, not a green one.
  echo "ERROR: the suite wrote no report - this run's outcome cannot be read, and nothing is filed." >&2
  exit 4
fi

FILE_FLAG="--file-issues"
if [ "${E2E_FILE_ISSUES:-1}" = "0" ]; then
  FILE_FLAG=""
fi
set +e
node tests/e2e/run/file-failure-issues.js --report "$RUN_REPORT" ${FILE_FLAG}
REPORT_STATUS=$?
set -e

if [ "$PLAYWRIGHT_STATUS" -ne 0 ] && [ "$REPORT_STATUS" -ne 0 ]; then
  echo
  echo "the run is RED (playwright exit $PLAYWRIGHT_STATUS) AND the failure path failed (exit $REPORT_STATUS)"
  echo "- some failures were NOT filed; the run's outcome is not trustworthy"
  exit "$REPORT_STATUS"
elif [ "$PLAYWRIGHT_STATUS" -ne 0 ]; then
  echo
  echo "the run is RED (playwright exit $PLAYWRIGHT_STATUS)"
elif [ "$REPORT_STATUS" -ne 0 ]; then
  echo
  echo "the suite is green but the failure path failed (exit $REPORT_STATUS) - the run's outcome is not trustworthy"
  exit "$REPORT_STATUS"
fi

exit "$PLAYWRIGHT_STATUS"
