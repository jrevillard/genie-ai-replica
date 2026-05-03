#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose -p genieai --env-file .env --profile opea --profile voice config 2>/dev/null \
  | yq '(.services[] | select(has("depends_on")) | select(.depends_on | tag == "!!map") | .depends_on) |= keys | del(.services[].profiles) | del(.name)' \
  | sed -E 's/^(\s*published: )"([0-9]+)"$/\1\2/' \
  | docker stack deploy -c - genieai
