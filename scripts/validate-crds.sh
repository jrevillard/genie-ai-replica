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

# The chart renders the genieai-obs Namespace but NOT its own: the release
# namespace is the installer's job, which is why the HelmRelease sets
# install.createNamespace and why every pre-install hook assumes nothing.
# This script is that installer, so it creates the namespaces the render
# REFERENCES but does not declare. Deriving them from the objects is
# safer than passing one in: a hook Job, a test pod and the obs namespace
# all have to exist before anything can be validated against them.
#
# NOTE: this heredoc is UNQUOTED on purpose — ${WORK} has to expand. That
# also means bash expands backticks and $ inside it, so this python block
# must contain neither.
referenced = {d['metadata']['namespace'] for d in rest + sa if d['metadata'].get('namespace')}
declared = {d['metadata']['name'] for d in ns}
with open(f'${WORK}/nsnames.txt', 'w') as fh:
    fh.write('\n'.join(sorted(declared | referenced)) + '\n')

print(f"  split: {len(ns)} Namespace, {len(sa)} ServiceAccount, {len(rest)} to validate")
PY

# `create --dry-run=server` rather than `apply --dry-run=server`: apply
# does a read-modify-write, and against an object that already exists the
# computed patch carries nulls for defaulted fields, which the API server
# then rejects ("must be specified for an update"). Create semantics do
# not touch storage, so the check is purely schema + admission.
printf '==> ensuring namespaces exist: %s\n' "$(tr '\n' ' ' < "${WORK}/nsnames.txt")"
if [ -s "${WORK}/namespaces.yaml" ]; then
  kubectl apply -f "${WORK}/namespaces.yaml" >/dev/null
fi
# Declared ones come from the render; referenced-only ones (the release
# namespace) are created here, the way `helm install --create-namespace`
# would.
while read -r ns; do
  [ -n "${ns}" ] || continue
  if ! kubectl get namespace "${ns}" >/dev/null 2>&1; then
    kubectl create namespace "${ns}" >/dev/null
  fi
done < "${WORK}/nsnames.txt"

if [ -s "${WORK}/namespaces.yaml" ]; then
  # A Namespace object is accepted by the API server while the namespace
  # controller is still finalizing it, and creating anything inside that
  # window fails with `namespaces "genieai" not found` — CI's first run of
  # this script hit exactly that. Wait for Active.
  while read -r ns; do
    [ -n "${ns}" ] || continue
    kubectl wait --for=jsonpath='{.status.phase}'=Active "namespace/${ns}" --timeout=60s >/dev/null
    printf '    namespace/%s Active\n' "${ns}"
  done < "${WORK}/nsnames.txt"
fi

if [ -s "${WORK}/serviceaccounts.yaml" ]; then
  printf '==> applying serviceaccounts\n'
  kubectl apply -f "${WORK}/serviceaccounts.yaml" >/dev/null
fi

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
