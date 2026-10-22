#!/usr/bin/env bash
# =============================================================================
# GENIE.AI — in-place application redeploy on the existing instance.
#
# Invoked by CI over SSM RunCommand (AWS-RunShellScript) against the running GPU
# box. Deliberately does NOT replace the instance: a rebuild costs 20-40 minutes
# and destroys whatever demo is on it. See docs/ci-cd-plan.md §3.1 option B.
#
#   fetch artifact -> extract -> commit -> render config -> verify registry
#   -> ansible-playbook --skip-tags install
#
# Usage:
#   redeploy.sh                      # deploy the key recorded in deploy.env
#   redeploy.sh <s3-key> [ci-sha]    # deploy a specific artifact
#
# Exit codes: 0 success; non-zero anywhere aborts (set -e). CI must treat a
# non-zero SSM ResponseCode as a failed deploy.
# =============================================================================
set -euo pipefail

# --- SSM RunCommand hygiene --------------------------------------------------
# RunCommand executes as root with a sparse environment: no HOME, a minimal PATH,
# and an arbitrary cwd. Ansible misbehaves without HOME (it writes ~/.ansible),
# and pip-installed ansible lands in /usr/local/bin which is often absent here.
export HOME="${HOME:-/root}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export DEBIAN_FRONTEND=noninteractive
export ANSIBLE_HOST_KEY_CHECKING=False

LOG=/var/log/genieai-redeploy.log
exec > >(tee -a "${LOG}") 2>&1
echo "=== GENIE.AI redeploy start: $(date -u) ==="

ENV_FILE=/etc/genieai/deploy.env
[ -r "${ENV_FILE}" ] || { echo "FATAL: ${ENV_FILE} missing — instance was not bootstrapped by this Terraform" >&2; exit 1; }
# shellcheck disable=SC1090
. "${ENV_FILE}"

: "${GENIEAI_REGION:?}"
: "${GENIEAI_APP_S3_BUCKET:?}"
CLONE_DIR="${GENIEAI_CLONE_DIR:-/opt/genieai}"
S3_KEY="${1:-${GENIEAI_APP_S3_KEY:?no artifact key given and none in deploy.env}}"
CI_SHA="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "--- artifact: s3://${GENIEAI_APP_S3_BUCKET}/${S3_KEY}"

# --- 1. Fetch + extract ------------------------------------------------------
# Extract OVER the existing tree. Safe because render-config.sh regenerates
# inventory/ and group_vars/ from scratch afterwards, so nothing needs preserving
# and there is no rsync-around-the-generated-files dance to get wrong.
TMP_ZIP="$(mktemp /tmp/genie-ai-XXXXXX.zip)"
trap 'rm -f "${TMP_ZIP}"' EXIT
aws s3 cp "s3://${GENIEAI_APP_S3_BUCKET}/${S3_KEY}" "${TMP_ZIP}" --region "${GENIEAI_REGION}"
mkdir -p "${CLONE_DIR}"
unzip -oq "${TMP_ZIP}" -d "${CLONE_DIR}"
chown -R ubuntu:ubuntu "${CLONE_DIR}"
git config --system --add safe.directory '*' || true

# --- 2. Commit the extracted tree so the build play can diff it ---------------
# The build play decides what to rebuild per image, from
# `git log -1 -- <that image's watch paths>`. That needs the artifact's contents
# to actually be IN the history, so the extracted tree has to be committed before
# the playbook runs — otherwise every path resolves to the bootstrap commit and
# nothing rebuilds no matter what changed.
#
# The commit is one squashed snapshot of the whole artifact, so an image's SHA
# moves exactly when that image's own sources changed in this deploy.
cd "${CLONE_DIR}"
if [ ! -d .git ]; then
  git init -q
fi
git add -A
COMMIT_MSG="redeploy ${S3_KEY}${CI_SHA:+ (ci ${CI_SHA})}"
# --allow-empty: a redeploy of byte-identical code must still move HEAD, otherwise
# a legitimate rebuild-and-restart request becomes a no-op.
git -c user.email=deploy@local -c user.name=deploy commit -q --allow-empty -m "${COMMIT_MSG}"
NEW_SHA="$(git rev-parse HEAD)"
echo "--- HEAD is now ${NEW_SHA} (${COMMIT_MSG})"

# --- 3. Render Ansible config -------------------------------------------------
# Same script the bootstrap uses — see decision #2. Prefer the copy from the
# artifact just extracted so rendering versions with the code.
# Tested with -f, not -x: zip archives do not reliably preserve the execute bit,
# and it is invoked via `bash` anyway.
RENDER="${CLONE_DIR}/deploy/scripts/render-config.sh"
[ -f "${RENDER}" ] || RENDER="${SCRIPT_DIR}/render-config.sh"
[ -f "${RENDER}" ] || { echo "FATAL: render-config.sh not found" >&2; exit 1; }
bash "${RENDER}" "${ENV_FILE}"

cd "${CLONE_DIR}/deploy/ansible"
ansible-galaxy collection install -r requirements.yml >/dev/null 2>&1 || true

# --- 4. Verify the local registry is up --------------------------------------
# `--skip-tags install` skips the play that starts the registry container. It
# normally survives via restart_policy: unless-stopped, but the build play pushes
# to it — fail here with a clear message rather than halfway through a build.
REG_PORT="${GENIEAI_REGISTRY_PORT:-5000}"
if ! curl -fsS --max-time 10 "http://localhost:${REG_PORT}/v2/_catalog" >/dev/null; then
  echo "--- registry not responding on :${REG_PORT}; attempting to start it"
  docker start registry 2>/dev/null || true
  sleep 5
  curl -fsS --max-time 10 "http://localhost:${REG_PORT}/v2/_catalog" >/dev/null \
    || { echo "FATAL: local registry unavailable on :${REG_PORT}. Re-run the playbook with the install tag." >&2; exit 1; }
fi

# --- 5. Run the playbook ------------------------------------------------------
# --skip-tags install (NOT --tags prepare,build,deploy): the first play,
# "Detect environment", is untagged, and Ansible drops untagged plays when
# --tags is supplied. Skipping install avoids re-running Docker/NVIDIA/Swarm
# setup on an already-provisioned box.
#
# -e git_username/git_token satisfies the prepare play's vars_prompt. SSM has no
# stdin, so without these the playbook blocks until the command times out.
ansible-playbook -i inventory/aws.ini deploy.yml \
  --skip-tags install \
  -e "git_username=s3 git_token=s3"

# --- 6. External data backend: retire the bundled containers ------------------
if [ "${GENIEAI_DATA_BACKEND:-embedded}" = "external" ]; then
  docker service scale genieai_postgres=0 genieai_redis-cache=0 2>/dev/null || true
fi

# --- 7. Assert the running images are the ones the build play produced --------
# /api/health cannot distinguish "deployed" from "deployed nothing" — the old app
# stays healthy either way.
#
# Each image is checked against ITS OWN expected SHA, read from the build plan the
# build play writes. Do NOT compare against ${NEW_SHA} (the commit from step 2):
# the play labels each image with `git log -1 -- <that image's watch paths>`, so an
# image whose sources did not change in this deploy keeps an older SHA on purpose.
# A global comparison therefore fails on every unchanged image, which — since the
# empty commit in step 2 touches no path at all — means every image on a no-op
# redeploy. This whole step ran after `docker stack deploy`, so that failure mode
# reported a red deploy over an already-updated, healthy stack.
#
# Only locally-built images are checked, selected by the registry prefix. Two
# traps this avoids:
#   * `{{index .Config.Labels "git_sha"}}` prints the literal "<no value>" (not an
#     empty string) when an image has no such label, so every third-party image
#     (arangodb, redis, keycloak, vllm...) would look "stale" and fail the deploy.
#   * Swarm reports images digest-pinned as repo:tag@sha256:... — strip the digest
#     before inspecting.
BUILD_PLAN=/var/lib/genieai/build-plan.json
[ -r "${BUILD_PLAN}" ] || {
  echo "FATAL: ${BUILD_PLAN} missing — the build play did not run to completion." >&2
  exit 1
}
echo "--- verifying deployed images against ${BUILD_PLAN}"
CHECKED=0
STALE=0
for IMG in $(docker service ls --format '{{.Image}}' 2>/dev/null | sort -u); do
  case "${IMG}" in
    "localhost:${REG_PORT}/"*) ;;   # ours
    *) continue ;;                  # third-party: no git_sha label expected
  esac
  BARE="${IMG%%@sha256:*}"
  TAG="${BARE#localhost:${REG_PORT}/}"
  EXPECT="$(jq -r --arg t "${TAG}" '.[$t] // empty' "${BUILD_PLAN}")"
  if [ -z "${EXPECT}" ]; then
    echo "  WARN: ${TAG} is not in the build plan (cannot verify)"
    continue
  fi
  LABEL="$(docker image inspect --format '{{index .Config.Labels "git_sha"}}' "${BARE}" 2>/dev/null || true)"
  [ "${LABEL}" = "<no value>" ] && LABEL=""
  if [ -z "${LABEL}" ]; then
    echo "  WARN: ${BARE} carries no git_sha label (cannot verify)"
    continue
  fi
  CHECKED=$((CHECKED + 1))
  if [ "${LABEL}" != "${EXPECT}" ]; then
    echo "  STALE: ${BARE} labelled ${LABEL}, expected ${EXPECT}"
    STALE=$((STALE + 1))
  fi
done

# A check that verified nothing must not report success — that is exactly the
# silent-no-op failure mode this step exists to catch.
if [ "${CHECKED}" -eq 0 ]; then
  echo "FATAL: could not verify any locally-built image. Expected services using localhost:${REG_PORT}/*." >&2
  exit 1
fi
if [ "${STALE}" -gt 0 ]; then
  echo "FATAL: ${STALE}/${CHECKED} service image(s) do not match the build plan — the build or the push was skipped." >&2
  exit 1
fi
echo "--- verified ${CHECKED} image(s) against the build plan"

echo "=== GENIE.AI redeploy complete: $(date -u) (sha ${NEW_SHA}) ==="
