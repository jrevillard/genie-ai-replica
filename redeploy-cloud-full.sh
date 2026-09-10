#!/bin/bash
HOST="govstack@10.0.0.101"
KEY="/home/fordendk/.ssh/cloud-deploy-np"

ssh -i $KEY -o StrictHostKeyChecking=no $HOST '
  set -e
  echo "=== Pulling latest main ==="
  cd /home/govstack/genie-ai-replica
  git pull origin main --ff-only
  SHA=$(git rev-parse --short HEAD)
  echo "SHA: $SHA"

  echo "=== Rebuilding ALL images ==="
  docker compose build --no-cache 2>&1 | tail -5

  echo "=== Tagging all images with SHA ==="
  for svc in backend chatqna-xeon-backend-server frontend nginx document-repository reranker retriever-arango-service dataprep-arango-service embedding kong-config keycloak keycloak-config db-migrations postgres-init; do
    img_name=$(docker images --format "{{.Repository}}" | grep "genie-ai-$svc" | head -1)
    if [ -n "$img_name" ]; then
      docker tag $img_name:latest $img_name:$SHA 2>/dev/null
    fi
  done

  echo "=== Updating all services ==="
  for svc in backend frontend nginx document-repository reranker retriever-arango-service dataprep-arango-service embedding kong keycloak; do
    svc_name="genieai_$svc"
    img="localhost:5000/genie-ai-$svc:latest"
    # Handle special name mappings
    case "$svc" in
      chatqna-xeon-backend-server) img="localhost:5000/genie-ai-chatqna-server:latest" ;;
      retriever-arango-service) img="localhost:5000/genie-ai-retriever-arango:latest" ;;
      dataprep-arango-service) img="localhost:5000/genie-ai-dataprep-arango:latest" ;;
      document-repository) img="localhost:5000/genie-ai-document-repository:latest" ;;
      kong) img="localhost:5000/genie-ai-kong-config:latest" ; svc_name="genieai_kong-config" ;;
    esac
    echo "  Updating $svc_name -> $img"
    docker service update --image $img $svc_name 2>&1 | tail -1
  done

  echo "=== Done ==="
' 2>&1
