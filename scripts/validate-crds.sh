#!/usr/bin/env bash
# Validate a rendered manifest against the CustomResourceDefinitions the
# cluster actually has installed.
#
# Why this exists: `kubeconform -ignore-missing-schemas` has no schema
# for a Custom Resource, so every CR this chart renders went through CI
# unvalidated. Several operators (grafana-operator, cloudnative-pg) decode
# their CRs STRICTLY — one field the CRD does not define rejects the whole
# object, with `helm lint` and kubeconform both green. Two real defects
# lived in exactly that blind spot: `GrafanaDashboard.spec.resyncInterval`
# (the field is `resyncPeriod`) and `Cluster.spec.storage.accessModes`
# (access modes belong under `pvcTemplate`). Only an API server asked to
# validate the object against the installed CRD catches them.
#
# Usage: ./scripts/validate-crds.sh /tmp/rendered.yaml [...]
#
# Requires on PATH: kubectl, python3 (+ pyyaml). The cluster must already
# carry the operator CRDs — scripts/install-prereqs.sh installs them.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  printf 'usage: %s <rendered.yaml> [...]\n' "$0" >&2
  exit 2
fi

require() {
  command -v "$1" >/dev/null 2>&1 || { printf 'missing tool on PATH: %s\n' "$1" >&2; exit 1; }
}
require kubectl
require python3

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# Split the render in three. Namespaces must exist before anything
# namespaced is validated, and the ServiceAccounts must exist before the
# Pods that name them (a pod creation admission resolves its
# serviceAccountName). Both are real creates: the objects under test are
# the ones in the THIRD file, which only ever see a server-side dry run.
python3 - "$@" <<PY
import sys, yaml

ns, sa, rest = [], [], []
for path in sys.argv[1:]:
    with open(path) as fh:
        for doc in yaml.safe_load_all(fh):
            if not doc:
                continue
            kind = doc.get('kind')
            (ns if kind == 'Namespace' else sa if kind == 'ServiceAccount' else rest).append(doc)

for name, docs in (('namespaces', ns), ('serviceaccounts', sa), ('rest', rest)):
    with open(f'${WORK}/{name}.yaml', 'w') as fh:
        yaml.safe_dump_all(docs, fh)

print(f"  split: {len(ns)} Namespace, {len(sa)} ServiceAccount, {len(rest)} to validate")
PY

# `create --dry-run=server` rather than `apply --dry-run=server`: apply
# does a read-modify-write, and against an object that already exists the
# computed patch carries nulls for defaulted fields, which the API server
# then rejects ("must be specified for an update"). Create semantics do
# not touch storage, so the check is purely schema + admission.
for phase in namespaces serviceaccounts; do
  if [ -s "${WORK}/${phase}.yaml" ]; then
    printf '==> applying %s\n' "${phase}"
    kubectl apply -f "${WORK}/${phase}.yaml" >/dev/null
  fi
done

printf '==> server-side dry run\n'
# AlreadyExists is noise, not a schema failure: on a cluster that already
# runs this chart every object is present, and a dry-run create still
# reports it. The check is the OTHER errors — the strict-decoding and
# validation ones. On the fresh cluster CI uses, nothing exists and the
# filter is a no-op.
output="$(kubectl create --dry-run=server -f "${WORK}/rest.yaml" 2>&1 || true)"
errors="$(printf '%s\n' "${output}" \
  | grep -E 'Error from server|^Error|error:' \
  | grep -v 'already exists' || true)"
if [ -n "${errors}" ]; then
  printf '%s\n' "${errors}" >&2
  exit 1
fi
printf 'every rendered object validated against the installed CRDs\n'
