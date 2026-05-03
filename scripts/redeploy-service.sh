#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/redeploy-service.sh <service-name> [--image <image>] [--dockerfile <path>] [--context <path>] [--no-build] [--no-wait]

Examples:
  # Default: build + push + redeploy (auto-guess Dockerfile/context for known services)
  scripts/redeploy-service.sh genieai_dataprep-arango-service

  # Build from explicit Dockerfile/context then redeploy
  scripts/redeploy-service.sh genieai_chatqna-xeon-backend-server --dockerfile genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai --context .

  # Redeploy only (skip build/push)
  scripts/redeploy-service.sh genieai_backend --no-build

  # Override image tag explicitly
  scripts/redeploy-service.sh genieai_dataprep-arango-service --image localhost:5000/genie-ai-dataprep-arango:latest

Notes:
  - If <service-name> is not exact, script tries a unique suffix match.
  - Default behavior is build + push + redeploy.
  - Requires Docker Swarm service access and Docker registry access.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -eq 0 ]]; then
  usage
  exit 0
fi

requested_service="$1"
shift

image_override=""
dockerfile_override=""
build_context="."
do_build="true"
wait_for_converge="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      image_override="${2:-}"
      if [[ -z "$image_override" ]]; then
        echo "Error: --image requires a value." >&2
        exit 1
      fi
      shift 2
      ;;
    --dockerfile)
      dockerfile_override="${2:-}"
      if [[ -z "$dockerfile_override" ]]; then
        echo "Error: --dockerfile requires a value." >&2
        exit 1
      fi
      shift 2
      ;;
    --context)
      build_context="${2:-}"
      if [[ -z "$build_context" ]]; then
        echo "Error: --context requires a value." >&2
        exit 1
      fi
      shift 2
      ;;
    --no-build)
      do_build="false"
      shift
      ;;
    --no-wait)
      wait_for_converge="false"
      shift
      ;;
    *)
      echo "Error: Unknown argument '$1'." >&2
      usage
      exit 1
      ;;
  esac
done

all_services="$(docker service ls --format '{{.Name}}')"

resolve_service_name() {
  local name="$1"
  if echo "$all_services" | awk '{print $0}' | grep -Fxq "$name"; then
    echo "$name"
    return 0
  fi

  # Suffix match fallback for convenience (e.g., "dataprep-arango-service")
  mapfile -t matches < <(echo "$all_services" | awk -v n="$name" '$0 ~ n"$" {print $0}')
  if [[ "${#matches[@]}" -eq 1 ]]; then
    echo "${matches[0]}"
    return 0
  fi

  if [[ "${#matches[@]}" -gt 1 ]]; then
    echo "Error: Service name '$name' is ambiguous. Matches:" >&2
    printf '  - %s\n' "${matches[@]}" >&2
    exit 1
  fi

  echo "Error: Service '$name' not found." >&2
  echo "Available services:" >&2
  echo "$all_services" | sed 's/^/  - /' >&2
  exit 1
}

service_name="$(resolve_service_name "$requested_service")"

current_image="$(docker service inspect "$service_name" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}')"
image_to_use="${image_override:-$current_image}"
# docker build -t / docker push require a tag reference, not a digest reference.
# If service image is pinned with @sha256, use the tag portion for build/push/update.
if [[ "$image_to_use" == *"@sha256:"* ]]; then
  image_to_use="${image_to_use%@sha256:*}"
fi

guess_dockerfile() {
  local svc="$1"
  case "$svc" in
    *dataprep-arango-service) echo "genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai" ;;
    *retriever-arango-service) echo "genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai" ;;
    *document-repository) echo "components/document-repository/Dockerfile" ;;
    *backend) echo "components/gov-chat-backend/Dockerfile" ;;
    *frontend) echo "components/gov-chat-frontend/Dockerfile" ;;
    *chatqna-xeon-backend-server) echo "genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai" ;;
    *) echo "" ;;
  esac
}

dockerfile_to_use="${dockerfile_override:-$(guess_dockerfile "$service_name")}"

echo "Service: $service_name"
echo "Current image: $current_image"
echo "Target image:  $image_to_use"

if [[ "$do_build" == "true" ]]; then
  if [[ -z "$dockerfile_to_use" ]]; then
    echo "Error: Could not auto-detect Dockerfile for service '$service_name'." >&2
    echo "Please provide it explicitly with --dockerfile <path>." >&2
    exit 1
  fi
  if [[ ! -f "$dockerfile_to_use" ]]; then
    echo "Error: Dockerfile not found: $dockerfile_to_use" >&2
    exit 1
  fi

  echo "Build step enabled."
  echo "Dockerfile:    $dockerfile_to_use"
  echo "Build context: $build_context"
  echo "Building image..."
  docker build -t "$image_to_use" -f "$dockerfile_to_use" "$build_context"

  echo "Pushing image..."
  docker push "$image_to_use"
else
  echo "Build step skipped (--no-build)."
fi

echo "Updating service..."
docker service update --image "$image_to_use" --force "$service_name"

if [[ "$wait_for_converge" == "true" ]]; then
  echo "Waiting for converge..."
  # Poll task states briefly; update already prints progress but this gives a clear end state.
  for _ in {1..30}; do
    replicas="$(docker service ls --filter "name=$service_name" --format '{{.Replicas}}')"
    if [[ "$replicas" =~ ^([0-9]+)/\1$ ]]; then
      echo "Converged: $replicas"
      exit 0
    fi
    sleep 2
  done
  echo "Warning: service may still be converging. Check with:" >&2
  echo "  docker service ps $service_name --no-trunc" >&2
else
  echo "Update triggered (no wait)."
fi
