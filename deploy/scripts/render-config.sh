#!/usr/bin/env bash
# =============================================================================
# GENIE.AI — render Ansible inventory + group_vars on the target instance.
#
# WHY THIS LIVES IN THE REPO
# Previously this logic was embedded in Terraform's user_data template. That made
# it invisible to the redeploy path (which never re-runs user_data) and meant any
# change to config rendering required editing user_data — which, combined with
# `user_data_replace_on_change`, replaced the GPU instance. Extracting it here
# means:
#   * bootstrap and redeploy render config identically, by construction
#   * changing the rendering is an app-level change, not an infra change
#   * user_data stays static, so the instance is never replaced for a config edit
# See docs/ci-cd-plan.md decision #2 and §6.5.
#
# INPUTS
# All Terraform-derived values arrive as environment variables, normally by
# sourcing /etc/genieai/deploy.env (written once by user_data). Nothing in this
# script is templated by Terraform — it is plain bash and must stay that way.
#
# Secrets are NEVER passed in as variables: they are fetched at runtime from SSM
# Parameter Store and Secrets Manager, exactly as before.
#
# Usage:  render-config.sh [/path/to/deploy.env]
# =============================================================================
set -euo pipefail

ENV_FILE="${1:-/etc/genieai/deploy.env}"
if [ -r "${ENV_FILE}" ]; then
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
else
  echo "render-config: ${ENV_FILE} not readable; relying on the ambient environment" >&2
fi

# --- Required inputs ---------------------------------------------------------
: "${GENIEAI_REGION:?GENIEAI_REGION is required}"
: "${GENIEAI_ENV_GROUP:?GENIEAI_ENV_GROUP is required}"
: "${GENIEAI_SSM_PREFIX:?GENIEAI_SSM_PREFIX is required}"
: "${GENIEAI_DOMAIN_NAME:?GENIEAI_DOMAIN_NAME is required}"
: "${GENIEAI_HF_SECRET_ID:?GENIEAI_HF_SECRET_ID is required}"

CLONE_DIR="${GENIEAI_CLONE_DIR:-/opt/genieai}"
DATA_BACKEND="${GENIEAI_DATA_BACKEND:-embedded}"
ANSIBLE_DIR="${CLONE_DIR}/deploy/ansible"

[ -d "${ANSIBLE_DIR}" ] || { echo "render-config: ${ANSIBLE_DIR} missing — extract the app first" >&2; exit 1; }
cd "${ANSIBLE_DIR}"

# Private IP for the Swarm advertise address. The playbook uses {{ ansible_host }}
# for `docker swarm init --advertise-addr`, which rejects "localhost".
IMDS_TOKEN="$(curl -sX PUT 'http://169.254.169.254/latest/api/token' \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 300' || true)"
PRIVATE_IP="$(curl -s -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" \
  http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null || true)"
[ -z "${PRIVATE_IP}" ] && PRIVATE_IP="$(hostname -I | awk '{print $1}')"

mkdir -p "group_vars/${GENIEAI_ENV_GROUP}" inventory

# --- Inventory ---------------------------------------------------------------
cat > "inventory/aws.ini" <<INV
[${GENIEAI_ENV_GROUP}]
localhost ansible_connection=local ansible_host=${PRIVATE_IP}
[swarm_managers]
localhost
[gpu_nodes]
localhost
[all:vars]
ansible_user=ubuntu
INV

# --- Secrets -> vault.yml ----------------------------------------------------
# Each SSM parameter's last path segment is the Ansible variable name.
# NOTE: values are emitted as double-quoted YAML scalars, preserving the previous
# behaviour. A secret containing a double quote or backslash would still break
# the YAML — pre-existing, unchanged here on purpose.
VAULT="group_vars/${GENIEAI_ENV_GROUP}/vault.yml"
aws ssm get-parameters-by-path \
  --region "${GENIEAI_REGION}" \
  --path "${GENIEAI_SSM_PREFIX}" \
  --with-decryption --recursive \
  --query "Parameters[].[Name,Value]" --output text \
  | while IFS=$'\t' read -r NAME VALUE; do
      KEY="${NAME##*/}"
      [ "${KEY}" = "git_token" ] && continue
      printf '%s: "%s"\n' "${KEY}" "${VALUE}"
    done > "${VAULT}"
# Plaintext secrets on disk (the playbook is invoked as root without --vault-id,
# matching the previous bootstrap behaviour). Tighten perms — the old inline
# version left this world-readable at 0644.
chmod 600 "${VAULT}"

# HF token lives in Secrets Manager under JSON key HF_TOKEN. Tracing is disabled
# around this so the token never reaches the bootstrap log.
_XTRACE_WAS_ON=0
case "$-" in *x*) _XTRACE_WAS_ON=1 ;; esac
set +x
# `|| true` is deliberate: the token is best-effort (note the `// empty` and the
# guard below). Without it, `set -o pipefail` would make an unreadable secret abort
# the entire render — tolerable at bootstrap, but this now runs on every redeploy.
HF_TOKEN="$(aws secretsmanager get-secret-value \
  --region "${GENIEAI_REGION}" \
  --secret-id "${GENIEAI_HF_SECRET_ID}" \
  --query SecretString --output text 2>/dev/null | jq -r '.HF_TOKEN // empty' || true)"
if [ -n "${HF_TOKEN}" ]; then
  printf 'hugging_face_hub_token: "%s"\n' "${HF_TOKEN}" >> "${VAULT}"
fi
unset HF_TOKEN
[ "${_XTRACE_WAS_ON}" = "1" ] && set -x

# --- Non-secret config -> vars.yml -------------------------------------------
VARS="group_vars/${GENIEAI_ENV_GROUP}/vars.yml"
{
  echo 'deploy_opea: "1"'
  echo 'gpu_env_file: ""'
  echo 'self_signed_certs: true'
  # Code arrives as an S3 artifact, not a git clone. skip_git_sync stops the
  # prepare play from cloning over /opt/genieai and destroying the extracted tree.
  echo 'skip_git_sync: true'
  echo "nginx_public_domain: \"${GENIEAI_DOMAIN_NAME}\""
  echo "keycloak_valid_redirect_uris: \"https://${GENIEAI_DOMAIN_NAME}/*\""
  echo "keycloak_web_origins: \"https://${GENIEAI_DOMAIN_NAME}\""
  echo "cors_allowed_origins: \"https://${GENIEAI_DOMAIN_NAME}\""
  # env.j2 references these with a bare {% if %} (undefined would fail), and the
  # browser needs them to match the public domain (API URL + CSP).
  echo "csp_connect_src: \"'self' https://${GENIEAI_DOMAIN_NAME} wss://${GENIEAI_DOMAIN_NAME}\""
  echo "vue_app_api_url: \"https://${GENIEAI_DOMAIN_NAME}/api\""
  echo "vue_app_csp_connect_src: \"'self' https://${GENIEAI_DOMAIN_NAME} wss://${GENIEAI_DOMAIN_NAME}\""
  echo 'nginx_permissions_policy: "camera=(), microphone=(), geolocation=()"'
  # Service account http-service logs in as. The matching plaintext password is
  # NOT here — it comes from SSM (<prefix>/auth_service_password) into vault.yml
  # above.
  #
  # NOT self-provisioning: a matching row must exist in the ArangoDB `users`
  # collection with encPassword = bcrypt(sha256(plaintext)) — the frontend
  # SHA-256s the password client-side and the backend bcrypts that digest, so
  # seeding bcrypt(plaintext) authenticates against nothing. Nothing in this
  # playbook creates that row, so on a rebuilt instance it must be re-created by
  # hand or http-service will crash-loop on boot. It is exempt from the deploy
  # health gate for that reason — see deploy_health_exempt in group_vars/all.yml.
  echo 'auth_service_username: "svc-http-service"'

  if [ "${DATA_BACKEND}" = "external" ]; then
    echo "postgres_host: \"${GENIEAI_RDS_HOST}\""
    echo "kong_pg_host: \"${GENIEAI_RDS_HOST}\""
    echo "kc_db_url: \"jdbc:postgresql://${GENIEAI_RDS_HOST}:${GENIEAI_RDS_PORT}/keycloak\""
    echo "translation_cache_host: \"${GENIEAI_REDIS_HOST}\""
    echo "translation_cache_port: \"${GENIEAI_REDIS_PORT}\""
    if [ "${GENIEAI_REDIS_AUTH_ENABLED:-false}" = "true" ]; then
      echo 'translation_cache_tls: "on"'
    else
      echo 'translation_cache_password: ""'
    fi
  fi

  echo "vllm_llm_model_id: \"${GENIEAI_LLM_MODEL_ID:-}\""
  echo "vllm_gpu_utilization: \"${GENIEAI_VLLM_GPU_UTILIZATION:-}\""
  echo "vllm_max_model_len: \"${GENIEAI_VLLM_MAX_MODEL_LEN:-}\""
  echo "vllm_translation_model_id: \"${GENIEAI_TRANSLATION_MODEL_ID:-}\""
  # Gemma-3 rejects float16 (the compose default "half"); it needs bfloat16.
  echo 'vllm_translation_dtype: "bfloat16"'
  echo "embedding_model_id: \"${GENIEAI_EMBEDDING_MODEL_ID:-}\""
  echo "reranker_model_id: \"${GENIEAI_RERANKER_MODEL_ID:-}\""
  echo 'docling_device: "cpu"'
} > "${VARS}"

echo "render-config: wrote inventory/aws.ini, ${VAULT}, ${VARS} (data_backend=${DATA_BACKEND})"
