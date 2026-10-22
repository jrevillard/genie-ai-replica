#!/usr/bin/env sh
# Sync the chart's vendored Grafana assets from configs/grafana/provisioning/
# — the single source, shared with the compose/Ansible path.
#
# The chart inlines the dashboards into GrafanaDashboard CRs and the alert
# rules into a GrafanaAlertRule CR, so a copy is unavoidable. A copy with
# no guard drifts silently: the compose deployment serves the source tree
# and the Kubernetes deployment serves the copy, and the two dashboards
# answer the same question differently. The same hole let the realm file
# drift before chart:lint started comparing it.
#
# Two things are checked:
#   1. the vendored copy matches the source, byte for byte;
#   2. the template's dashboard list matches the files on disk — a copied
#      file the template does not list is never rendered, and a listed
#      file that is missing inlines as an empty dashboard.
#
# Usage: scripts/sync-chart-dashboards.sh [--check]
#   (no flag)  write the copy into the chart
#   --check    verify only; exit 1 on any drift (used by CI)
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
src="${repo_root}/configs/grafana/provisioning"
chart="${repo_root}/charts/genieai-umbrella"
out="${chart}/files/observability"
tmpl="${chart}/templates/observability/grafana-dashboards.yaml"

mode=write
[ "${1:-}" = "--check" ] && mode=check

[ -d "${src}/dashboards" ] || {
  echo "missing ${src}/dashboards — run from a full checkout" >&2
  exit 1
}

# The chart vendors the application dashboards, the observability folder
# and the alert rules. The provisioning INDEX (dashboards.yml) and the
# contact points stay in the source tree: the chart's Grafana CRs do not
# carry them.
if [ "${mode}" = "write" ]; then
  mkdir -p "${out}/dashboards/observability" "${out}/alerting"
  for f in "${src}"/dashboards/*.json; do
    [ -f "$f" ] || continue
    cp "$f" "${out}/dashboards/$(basename "$f")"
  done
  for f in "${src}"/dashboards/observability/*.json; do
    [ -f "$f" ] || continue
    cp "$f" "${out}/dashboards/observability/$(basename "$f")"
  done
  cp "${src}/alerting/alert-rules.yml" "${out}/alerting/alert-rules.yml"
  echo "synced ${src} -> ${out}"
  echo "commit it alongside any configs/grafana/provisioning change."
  exit 0
fi

# --- check mode -------------------------------------------------------
rc=0

compare() {
  # $1 = source dir, $2 = destination dir, $3 = file pattern
  for f in "${src}/$1"/$3; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if [ ! -f "${out}/$2/${base}" ]; then
      echo "DRIFT: ${out}/$2/${base} is missing (source ${f})" >&2
      rc=1
    elif ! diff -q "$f" "${out}/$2/${base}" >/dev/null 2>&1; then
      echo "DRIFT: ${out}/$2/${base} differs from ${f}" >&2
      rc=1
    fi
  done
  for f in "${out}/$2"/$3; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    if [ ! -f "${src}/$1/${base}" ]; then
      echo "DRIFT: ${out}/$2/${base} has no source in ${src}/$1" >&2
      rc=1
    fi
  done
}

compare dashboards dashboards '*.json'
compare dashboards/observability dashboards/observability '*.json'

# The chart vendors the alert rules only — the contact points and the
# notification policies are not part of the CR set.
if ! diff -q "${src}/alerting/alert-rules.yml" "${out}/alerting/alert-rules.yml" >/dev/null 2>&1; then
  echo "DRIFT: ${out}/alerting/alert-rules.yml differs from ${src}/alerting/alert-rules.yml" >&2
  rc=1
fi

# The template's list must match the files on disk.
python3 - "$tmpl" "$out" <<'PY' || rc=1
import os
import re
import sys

tmpl, out = sys.argv[1], sys.argv[2]
text = open(tmpl).read()

def group(var):
    m = re.search(r"\$%s := list(.*?)\)\s*-}}" % var, text, re.S)
    if not m:
        raise SystemExit("could not find $%s in %s" % (var, tmpl))
    return set(re.findall(r'"file"\s+"([^"]+)"', m.group(1)))

general = group("dashboardsGeneral")
observability = group("dashboardsObservability")

on_disk_general = {
    f for f in os.listdir(os.path.join(out, "dashboards"))
    if f.endswith(".json")
}
on_disk_observability = {
    f for f in os.listdir(os.path.join(out, "dashboards", "observability"))
    if f.endswith(".json")
}

problems = []
if general != on_disk_general:
    problems.append(
        "General list vs files/observability/dashboards: template-only %s, files-only %s"
        % (sorted(general - on_disk_general), sorted(on_disk_general - general)))
if observability != on_disk_observability:
    problems.append(
        "Observability list vs files/observability/dashboards/observability: "
        "template-only %s, files-only %s"
        % (sorted(observability - on_disk_observability),
           sorted(on_disk_observability - observability)))
if general & observability:
    problems.append("a dashboard is listed in both groups: %s"
                    % sorted(general & observability))

for p in problems:
    print("DRIFT: %s" % p)
sys.exit(1 if problems else 0)
PY

if [ "${rc}" = "0" ]; then
  echo "chart dashboards and alert rules match configs/grafana/provisioning"
fi
exit "${rc}"
