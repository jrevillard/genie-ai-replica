#!/usr/bin/env bash
# Bootstrap a laptop minikube cluster from scratch, with NetworkPolicy
# ENFORCEMENT.
#
# Why this script exists
# ----------------------
# minikube's default CNI (kubenet) has no policy engine: NetworkPolicy
# objects are accepted and stored by the API server, and nothing ever
# applies them. Every pod-to-pod connection succeeds, so a chart whose
# policies are wrong looks perfectly healthy on the laptop while the
# production cluster — running Calico, Cilium or kube-router — silently
# times out. Calico (--cni=calico) is what makes the laptop behave like
# the cluster the chart is written for.
#
# The cost of a policy-enforcing CNI is that EVERYTHING the cluster needs
# has to be re-created, including the state that lives only inside the
# cluster. This script owns that list so it is not rediscovered under
# pressure.
#
# What lives ONLY in the cluster (and is therefore lost by `minikube
# delete`):
#
#   - the sealed-secrets controller key. The SealedSecret manifests in
#     genie-ai-deploy are encrypted against THAT key. Restoring the same
#     key (same secret name, same tls.key/tls.crt) makes the committed
#     manifests decrypt again — no re-seal, no re-commit.
#   - the Flux GitLab PAT (`flux-git-auth`) — not in the repo, a
#     Personal Access Token with read_repository.
#   - the GitLab Agent tokens — a per-project token from the GitLab UI.
#   - the selfsigned cert-manager ClusterIssuer — applied off-chart.
#
# Usage
# -----
#   ./scripts/laptop-cluster-bootstrap.sh \
#     --sealed-secrets-key ~/.genieai-sealed-secrets/sealed-secrets-key.json \
#     --flux-git-auth   ~/.genieai-sealed-secrets/flux-git-auth.json \
#     --issuer          ~/.genieai-sealed-secrets/selfsigned-issuer.yaml
#
# Flags:
#   --cluster <name>        minikube profile (default: minikube)
#   --deploy-repo <path>    genie-ai-deploy checkout (default: ../genie-ai-deploy)
#   --pays <name>           overlay / pays name (default: jrevillard-laptop)
#   --env <name>            overlay env (default: dev)
#   --kubernetes-version    default v1.32.0
#   --skip-start            do NOT touch the cluster (prereqs + secret restore only)
#
# The script NEVER deletes the cluster. It creates it if missing and
# re-applies the bootstrap on an existing one. Recreating the cluster is
# a deliberate, separate act: `minikube delete --profile <name>`.

set -euo pipefail

CLUSTER="minikube"
DEPLOY_REPO="${DEPLOY_REPO:-../genie-ai-deploy}"
PAYS="jrevillard-laptop"
ENV="dev"
K8S_VERSION="v1.32.0"
CPUS=4
# The node's REAL memory. The kubelet inside minikube reports the HOST's
# memory to the scheduler, not this container's limit — so the scheduler
# over-commits and the DOCKER oom killer (not the kubernetes one) fires.
# The sum of the chart's memory REQUESTS (~7.7 Gi) plus the control
# plane (~1.5 Gi) has to fit in here, or a pod that balloons takes the
# node — and the control plane — down with it.
MEMORY=10240
DISK=20000
SEALED_KEYS_FILE=""
FLUX_GIT_AUTH_FILE=""
ISSUER_FILE=""
SKIP_START=""

log() { printf '\n=== %s ===\n' "$*"; }

# `kubectl get -o yaml/json` captures fields the API server owns
# (resourceVersion, uid, status). Applying them back conflicts with
# whatever the controller wrote since. Strip them, keep the spec.
apply_clean() {
  local file="$1"
  python3 - "$file" <<'PYEOF'
import json
import re
import sys

path = sys.argv[1]
text = open(path).read()
if path.endswith(".json"):
    doc = json.loads(text)
    meta = doc.get("metadata", {})
    for key in ("resourceVersion", "uid", "creationTimestamp", "generation", "managedFields"):
        meta.pop(key, None)
    doc.pop("status", None)
    print(json.dumps(doc))
else:
    text = re.sub(r"\nstatus:\n(?:[ \t].*\n|\n)*", "\n", text)
    text = re.sub(r"^([ \t]*)(resourceVersion|uid|creationTimestamp|generation|managedFields):.*\n", "", text, flags=re.M)
    print(text, end="")
PYEOF
}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --cluster) CLUSTER="$2"; shift 2 ;;
    --deploy-repo) DEPLOY_REPO="$2"; shift 2 ;;
    --pays) PAYS="$2"; shift 2 ;;
    --env) ENV="$2"; shift 2 ;;
    --kubernetes-version) K8S_VERSION="$2"; shift 2 ;;
    --sealed-secrets-key) SEALED_KEYS_FILE="$2"; shift 2 ;;
    --flux-git-auth) FLUX_GIT_AUTH_FILE="$2"; shift 2 ;;
    --issuer) ISSUER_FILE="$2"; shift 2 ;;
    --skip-start) SKIP_START=1; shift ;;
    -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

for tool in kubectl helm flux minikube; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found in PATH"
done

# ── 1. The cluster itself ────────────────────────────────────────────────
if [ -z "$SKIP_START" ]; then
  log "minikube start (CNI: calico — NetworkPolicy is ENFORCED)"
  # --cni=calico is the whole point of this script. The flag is stored in
  # the profile, so later `minikube start` calls on this profile keep it.
  minikube start \
    --profile "$CLUSTER" \
    --driver=docker \
    --cni=calico \
    --cpus="$CPUS" \
    --memory="$MEMORY" \
    --disk-size="${DISK}mb" \
    --kubernetes-version="$K8S_VERSION"
fi

# ── 2. Cluster-wide operators ────────────────────────────────────────────
log "cluster operators (keycloak, cnpg, arango, sealed-secrets, cert-manager, vm, otel)"
# Idempotent: each install is gated on the namespace + helm release
# already being there.
./scripts/install-prereqs.sh

# ── 3. The sealed-secrets key ────────────────────────────────────────────
# The controller generates a key on first start. It reads every Secret
# whose name starts with `sealed-secrets-key` and uses each as a
# decryption key, so the cleanest restore is: delete whatever it
# generated, put OUR key back under the same name, and let the
# controller reload (it watches its key Secret).
if [ -n "$SEALED_KEYS_FILE" ]; then
  [ -f "$SEALED_KEYS_FILE" ] || die "sealed-secrets key file not found: $SEALED_KEYS_FILE"
  log "restoring the sealed-secrets key (the committed SealedSecrets decrypt with it)"
  # Delete every key the controller generated: it would otherwise hold a
  # second key and accept seals made with it.
  for s in $(kubectl -n sealed-secrets get secret -o name 2>/dev/null | grep 'sealed-secrets-key' || true); do
    kubectl -n sealed-secrets delete "$s" 2>/dev/null || true
  done
  # The controller selects its keys by the
  # `sealedsecrets.bitnami.com/sealed-secrets-key=active` LABEL, not by
  # the name prefix. A key restored without that label is invisible to
  # it: the controller logs "Searching for existing private keys", finds
  # nothing, generates a fresh one, and every committed SealedSecret
  # fails with "no key could decrypt secret".
  # Labelled with kubectl rather than by editing the manifest: the file
  # may be JSON or YAML, and a json.load() stage turned a YAML key file
  # into a JSONDecodeError — AFTER the generated keys had already been
  # deleted a few lines up, so the cluster was left with no key at all
  # and every committed SealedSecret undecryptable. kubectl reads both
  # formats, so the restore does too.
  apply_clean "$SEALED_KEYS_FILE" | kubectl apply -f -
  # NB: a positional 'sealed-secrets-key*' argument is an exact-name
  # selector in kubectl, not a glob — it silently matches nothing. List
  # and filter instead, the same way the generated-key cleanup below does.
  for key in $(kubectl -n sealed-secrets get secret -o name 2>/dev/null | grep 'sealed-secrets-key' || true); do
    kubectl -n sealed-secrets label "${key}" \
      sealedsecrets.bitnami.com/sealed-secrets-key=active --overwrite >/dev/null
  done
  # The controller caches its key set at startup; a restart makes it
  # pick the restored one up deterministically.
  kubectl -n sealed-secrets rollout restart deploy/sealed-secrets-controller 2>/dev/null || true
  kubectl -n sealed-secrets rollout status deploy/sealed-secrets-controller --timeout=120s 2>/dev/null || true
else
  log "WARNING: no --sealed-secrets-key given — the committed SealedSecrets will NOT decrypt"
fi

# ── 4. The selfsigned issuer (cert-manager) ──────────────────────────────
if [ -n "$ISSUER_FILE" ]; then
  [ -f "$ISSUER_FILE" ] || die "issuer file not found: $ISSUER_FILE"
  log "applying the selfsigned ClusterIssuer"
  # `kubectl get -o yaml` captures the status block and the
  # resourceVersion, and applying that back conflicts with what the
  # cert-manager controller wrote. Delete and recreate from the spec.
  kubectl delete clusterissuer selfsigned --ignore-not-found >/dev/null 2>&1 || true
  apply_clean "$ISSUER_FILE" | kubectl apply -f -
fi

# ── 5. Flux ──────────────────────────────────────────────────────────────
# flux install creates the flux-system namespace and the Flux CRDs, so it
# has to come BEFORE anything that writes into flux-system.
log "installing Flux"
flux install --namespace=flux-system

if [ -n "$FLUX_GIT_AUTH_FILE" ]; then
  [ -f "$FLUX_GIT_AUTH_FILE" ] || die "flux git auth file not found: $FLUX_GIT_AUTH_FILE"
  log "restoring flux-git-auth (the GitLab PAT the source-controller reads the repos with)"
  # The captured file is the whole Secret object (name + namespace +
  # data); apply_clean drops the server-assigned metadata.
  apply_clean "$FLUX_GIT_AUTH_FILE" | kubectl apply -f -
fi

log "applying the Flux sources and Kustomizations"
# Two Kustomizations, both declared in the repo:
#   clusters/<pays>/flux-kustomization.yaml  -> drives ./clusters/<pays>
#   clusters/<pays>/flux-system/flux-kustomization.yaml -> drives ./overlays/<pays>/<env>
# The first one carries the GitRepository that points at the deploy repo
# itself; the second one carries the chart source, the HelmRelease and
# the SealedSecrets.
kubectl apply -f "$DEPLOY_REPO/clusters/$PAYS/flux-kustomization.yaml"
# `-k` (kustomize build), not `-f`: the directory carries a
# kustomization.yaml, and `kubectl apply -f` would try to apply that
# file as a resource (no CRD for kustomize.config.k8s.io).
kubectl apply -k "$DEPLOY_REPO/clusters/$PAYS/flux-system/"

log "waiting for the Flux sources"
# Not advisory: a source that never went Ready means the PAT is wrong or
# the deploy repo unreachable — and a bootstrap that prints "done" over
# that sends the operator to `kubectl get pods` in an empty namespace,
# reading "the chart is broken" for what is "the source never synced".
if ! kubectl -n flux-system wait --for=condition=ready gitrepository --all --timeout=180s; then
  echo "ERROR: the Flux GitRepositories never became Ready — check the flux-git-auth Secret (PAT) and the deploy repo's reachability:" >&2
  echo "  kubectl -n flux-system get gitrepositories -o wide" >&2
  exit 1
fi

log "reconciling the GENIE HelmRelease"
if ! flux reconcile helmrelease genieai -n flux-system; then
  echo "ERROR: the HelmRelease reconcile failed — see 'flux get helmreleases -A' and the HelmRelease's conditions" >&2
  exit 1
fi

log "done — watch the rollout with:"
echo "  kubectl -n genieai get pods,svc,helmrelease"
echo "  kubectl -n genieai rollout status deploy --timeout=300s"
