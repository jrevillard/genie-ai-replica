#!/bin/bash
HOST="govstack@10.0.0.101"
KEY="/home/fordendk/.ssh/cloud-deploy-np"

ssh -i $KEY -o StrictHostKeyChecking=no $HOST '
  cd /home/govstack/genie-ai-replica
  echo "=== Rebuilding frontend ==="
  docker compose build --no-cache frontend 2>&1 | tail -3
  echo "=== Restarting frontend ==="
  docker service update --force genieai_frontend 2>&1 | tail -1
  echo "=== Verify tag ==="
  docker images --format "{{.CreatedAt}}" localhost:5000/genie-ai-frontend:latest
' 2>&1
