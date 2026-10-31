#!/usr/bin/env bash
# Runtime half of the #1227 no-root contract (the static half lives in
# tests/config-validator/__tests__/compose-non-root.test.js).
#
# Asserts, against a RUNNING compose project:
#   1. no long-term process runs as root — every process of every running
#      container must have a uid != 0 (checked via `docker top`, the host's
#      view of the container's process table);
#   2. no root-owned file exists under the data directory — the host-visible
#      surface container filesystems and bind mounts land on.
#
# Usage: tests/compose-non-root/check-runtime.sh <compose-project> [data_dir]
# Env:   DATA_DIR overrides ./data default when data_dir arg is omitted.
#
# Exit 0 = contract holds; exit 1 = violations listed. One-shot init
# containers (arango-vector-db-init, victorialogs-init, postgres-init,
# kong-config, keycloak-config, kong-migrations, db-migrations,
# otel-collector-init) have exited by the time this runs and are not
# inspected; their contract is enforced by the static test + this sweep.

set -u

PROJECT="${1:?usage: check-runtime.sh <compose-project> [data_dir]}"
DATA_DIR="${2:-${DATA_DIR:-./data}}"

violations=0

# --- 1. no root process in any running container -----------------------------
# Both orchestration front-ends label their containers: compose sets
# com.docker.compose.project, `docker stack deploy` sets
# com.docker.stack.namespace — check both so the swarm/Ansible deployment
# path is covered too.
containers=$(
  {
    docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}'
    docker ps --filter "label=com.docker.stack.namespace=$PROJECT" --format '{{.Names}}'
  } | sort -u
)
if [ -z "$containers" ]; then
  echo "ERROR: no running container found for project '$PROJECT' (compose label or stack label)."
  echo "A vacuous pass would be worse than a failure — check the project name and rerun."
  exit 2
fi
while IFS= read -r container; do
  # `user` (not `UID`): procps rejects the uppercase specifier, and the
  # lowercase form prints "root" for uid 0 and the numeric uid otherwise.
  top=$(docker top "$container" -o user,pid,args 2>/dev/null) || continue
  offenders=$(echo "$top" | awk 'NR>1 && $1=="root" {print "  pid "$2": "substr($0, index($0,$3))}')
  if [ -n "$offenders" ]; then
    echo "ROOT PROCESS in $container:"
    echo "$offenders"
    violations=$((violations + 1))
  fi
done <<EOF
$containers
EOF

# --- 2. no root-owned file under the data directory ---------------------------
if [ -d "$DATA_DIR" ]; then
  rootowned=$(find "$DATA_DIR" -uid 0 2>/dev/null)
  if [ -n "$rootowned" ]; then
    echo "ROOT-OWNED paths under $DATA_DIR:"
    echo "$rootowned" | sed 's/^/  /'
    violations=$((violations + 1))
  fi
fi

if [ "$violations" -gt 0 ]; then
  echo "NON-ROOT CONTRACT: $violations violation group(s)"
  exit 1
fi
echo "NON-ROOT CONTRACT: OK (project $PROJECT, data dir $DATA_DIR)"
