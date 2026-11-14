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
#   E2E_NAMESPACE            the namespace the Keycloak admin secret is read
#                            from when the credentials are auto-read
#                            (default: genieai).
#   E2E_FILE_ISSUES          0 reports the failures without filing issues.
#   ROPC_POSTURE_REALM       the realm the post-run posture gate checks
#                            (default: genie). Set IN TANDEM with
#                            ROPC_POSTURE_CLIENT when a script flipped a
#                            non-default pair (e.g. the anchor wrapper's
#                            EVAL_KC_REALM/EVAL_KC_CLIENT_ID).
#   ROPC_POSTURE_CLIENT      the client the post-run posture gate checks
#                            (default: genie-app).
#
# The run ends with the failure path: a red run files one status::backlog
# issue per failing spec file (tests/e2e/run/file-failure-issues.js), and the
# run's outcome — counts, skipped specs with their reasons, failures — is
# printed whether the suite is green or red. After the suite (before the
# failure path, so EVERY exit carries it) the post-run ROPC posture gate
# runs: a venue left accepting password grants fails the run with exit 5,
# whatever the specs said.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

# The venue the run points at. The DEFAULT venue is the shared k8s stack,
# and the stack's Keycloak admin secret lives in this cluster - the
# credential auto-read below is tied to THAT venue, because the password it
# reads belongs to it. Point BASE_URL anywhere else and the run asks for
# credentials instead of guessing.
DEFAULT_VENUE="https://genieai-forge.local:4443"
# The venue address is NORMALIZED once, by the SAME function the specs
# read (helpers/base-url.js): https://x:4443, https://x:4443/ and
# https://x:4443// are the same venue. Before this normalization the lock
# key stripped the slashes itself while the credential auto-read compared
# the RAW address against the default venue — so a trailing slash made
# the auto-read miss the shared stack's secret and ask for credentials
# the run already had. One spelling now feeds both, and the rule is unit
# tested where it lives.
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' is not installed - the venue address cannot be normalized." >&2
  exit 2
fi
# The default goes into the ENVIRONMENT first, and the module's own
# exported address is read back: the module stays the one place that
# normalizes an address, and the shell stops quoting a JS source string
# with a value of its own.
export BASE_URL="${BASE_URL:-$DEFAULT_VENUE}"
BASE_URL="$(node -p "require('${REPO_ROOT}/tests/e2e/helpers/base-url').BASE_URL")"
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
    case "$tool" in
      flock) echo "       Install it (util-linux provides flock) and run again." >&2 ;;
      md5sum) echo "       Install it (coreutils provides md5sum; absent on stock macOS) and run again." >&2 ;;
    esac
    exit 2
  fi
done
CHECKOUT_LOCK="${E2E_RUN_LOCK:-$REPO_ROOT/.e2e-run.lock}"
# The venue key is the NORMALIZED address (normalized above): one venue, one
# lock.
VENUE_KEY="$(printf '%s' "$BASE_URL" | md5sum | cut -c1-12)"
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
  if [ "$BASE_URL" = "$DEFAULT_VENUE" ] && command -v kubectl >/dev/null 2>&1 &&
    kubectl -n "$NAMESPACE" get secret keycloak-admin-credentials >/dev/null 2>&1; then
    KEYCLOAK_ADMIN_PASSWORD="$(kubectl -n "$NAMESPACE" get secret keycloak-admin-credentials \
      -o go-template='{{ index .data "password" | base64decode }}')"
    if [ -z "$KEYCLOAK_ADMIN_PASSWORD" ] || [ "$KEYCLOAK_ADMIN_PASSWORD" = "<no value>" ]; then
      echo "ERROR: the keycloak-admin-credentials secret in namespace $NAMESPACE carries no 'password' key." >&2
      echo "       The auto-read exported no usable credential - set KEYCLOAK_ADMIN_PASSWORD explicitly." >&2
      exit 2
    fi
    export KEYCLOAK_ADMIN_PASSWORD
    echo "admin credentials: the shared stack's keycloak-admin-credentials secret (namespace $NAMESPACE)"
  else
    echo "ERROR: no Keycloak admin credentials for $BASE_URL." >&2
    echo "       Set KEYCLOAK_ADMIN_PASSWORD (or ADMIN_TOKEN). The secret auto-read only serves" >&2
    echo "       the default venue ($DEFAULT_VENUE): its password belongs to that stack." >&2
    exit 2
  fi
fi

# --- the venue name, for a runner that cannot resolve it ---------------------
# The shared stack advertises its edge under a name the cluster DNS does not
# serve. Node and Chromium resolve it separately, so the mapping has to reach
# both — the preload patches Node's resolver, the launch arguments carry it
# into the browser.
if [ -n "${E2E_VENUE_IP:-}" ]; then
  # One owner of the "which host is the venue" rule: the mapping module.
  # It is read through the SAFE reader: a mapping that cannot be read is
  # the pre-flight's finding to NAME, and a raw stack trace here would
  # replace that diagnosis with a wall of frames.
  E2E_VENUE_HOST="${E2E_VENUE_HOST:-$(node -p "require('$REPO_ROOT/tests/e2e/helpers/venue-launch-args').safeVenueMapping().mapping?.host || ''")}"
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
# The fixed report path is cleared FIRST: it holds whatever the last
# Playwright invocation in this checkout wrote, and a suite that dies before
# its reporter writes must not leave that stale file to be filed as THIS
# run's outcome.
rm -f reports/playwright-report.json
echo "running the whole tests/e2e/ tree"
set +e
npx playwright test tests/e2e/ --project=chromium
PLAYWRIGHT_STATUS=$?
set -e

# --- the post-run ROPC posture gate (#1727) ---------------------------------
# The venue's auth posture is part of this run's outcome: a run that leaves
# genie/genie-app accepting password grants fails HERE even when every spec
# was green — and before the failure path, so every exit below carries the
# verdict (the runs most likely to leave state behind are the crashed ones).
# The assertion is the helper's own (single home); the gate is this run's
# obligation because this run books the venue. Exit 5 is this gate's own
# code — 3 is venue-lock contention, and a posture violation must not read
# as a transient contention retry.
echo "post-run ROPC posture gate"
if ! node "$REPO_ROOT/tests/e2e/run/check-ropc-posture.js"; then
  echo "ERROR: the post-run ROPC posture gate FAILED — its own output above names the real cause" >&2
  echo "       (a widened auth surface is one of them; a broken gate or venue is another)." >&2
  exit 5
fi

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
  echo "ERROR: the suite wrote no report (playwright exit $PLAYWRIGHT_STATUS) -" >&2
  echo "       this run's outcome cannot be read, and nothing is filed." >&2
  exit 4
fi

FILE_FLAG="--file-issues"
if [ "${E2E_FILE_ISSUES:-1}" = "0" ]; then
  FILE_FLAG=""
fi
set +e
node tests/e2e/run/file-failure-issues.js --report "$RUN_REPORT" --venue "$BASE_URL" ${FILE_FLAG}
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
