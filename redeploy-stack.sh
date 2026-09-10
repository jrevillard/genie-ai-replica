#!/bin/bash
set -e

HOST="govstack@10.0.0.101"
KEY="/home/fordendk/.ssh/cloud-deploy-np"

# Copy the script to the server and execute
ssh -i $KEY -o StrictHostKeyChecking=no $HOST 'bash -s' << 'REMOTESCRIPT'
  set -e
  cd /home/govstack/genie-ai
  echo "=== Sourcing .env ==="
  set -a
  source .env
  set +a
  echo "GPU_NODE_HOST=$GPU_NODE_HOST"
  echo "=== Regenerating compose config ==="
  docker compose -f docker-compose.yaml config > /tmp/resolved-compose.yml
  echo "=== Deploying stack ==="
  docker stack deploy -c /tmp/resolved-compose.yml genieai --with-registry-auth
REMOTESCRIPT
