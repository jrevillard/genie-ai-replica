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
# Exit 0 = contract holds; 1 = violations listed; 2 = VACUOUS RUN (no
# container matched the project name — nothing was inspected, never read
# it as OK); 3 = docker daemon unreachable; 4 = usage error. One-shot init
# containers (arango-vector-db-init, victorialogs-init,
# document-repository-init, backend-init, otel-collector-init,
# postgres-init, kong-config, kong-migrations, db-migrations) have
# exited by the time this runs and are not inspected; their contract is
# enforced by the static test + this sweep. keycloak-config is NOT in
# that list: it ends in `exec sleep infinity` and runs permanently
# (uid 65534) — the gate inspects it like any long-lived container.

set -u

if [ $# -lt 1 ]; then
  echo "usage: check-runtime.sh <compose-project> [data_dir]" >&2
  # usage errors get their own exit — 1 means CONTRACT VIOLATIONS
  exit 4
fi
PROJECT="$1"
DATA_DIR="${2:-${DATA_DIR:-./data}}"
# Trailing-slash callers ("./data/", "./data//") would break the -path
# prune pattern below (./data//huggingface never matches) and silently
# sweep the excluded GPU cache — strip ALL trailing slashes (the root "/"
# itself is not a data dir spelling this gate accepts).
while [ "$DATA_DIR" != "${DATA_DIR%/}" ] && [ "$DATA_DIR" != "/" ]; do
  DATA_DIR="${DATA_DIR%/}"
done

violations=0

# --- 1. no root process in any running container -----------------------------
# Both orchestration front-ends label their containers: compose sets
# com.docker.compose.project, `docker stack deploy` sets
# com.docker.stack.namespace — check both so the swarm/Ansible deployment
# path is covered too.
# Rule 1 compares HOST-side uids; under a userns-remap daemon every
# container uid is shifted and container-root is never host 0 — warn that
# the no-root verdict cannot be seen through the host mapping there.
if docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q 'name=userns'; then
  echo "WARNING: userns-remap detected — rule 1 compares HOST uids and is"
  echo "vacuous for container-root under remap; treat a pass as unverified."
fi

if ! docker ps >/dev/null 2>&1; then
  echo "ERROR: docker daemon unreachable (docker ps failed) — no container"
  echo "can be inspected. Fix the daemon/socket first; this is not a"
  echo "project-name problem."
  exit 3
fi
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
# SELF_DROPPING services (the static contract's allowlist): their upstream
# entrypoints gosu/su-exec the SERVER to its package user, but the
# container's configured user stays root — so the periodic healthcheck
# exec (pg_isready / redis-cli) legitimately runs as uid 0 for its
# sub-second lifetime. Rule 1 governs LONG-TERM processes; these services
# are skipped for rule 1 (rule 2 still sweeps everything).
SELF_DROPPING=' postgres redis-cache '

while IFS= read -r container; do
  service="${container#"$PROJECT"-}"; service="${service#"${PROJECT}_"}"
  # compose names the container <project>-postgres-1, swarm
  # <stack>_postgres.1.<id> — the reduction is SHAPE-EXACT: a swarm task
  # is <svc>.<digits>.<id> and a compose container is <svc>-<digits>.
  # Anything else (dotted service names like postgres.2-1, or a name
  # ending in -init-1) never reduces, so it can never be exempted by
  # accident.
  svc=""
  case "$service" in
    .*) ;;
    *.*)
      rest="${service#*.}"
      idx="${rest%%.*}"
      case "$idx" in
        '' | *[!0-9]*) ;;  # not <digits> → not a swarm task suffix
        *) svc="${service%%.*}" ;;
      esac ;;
  esac
  if [ -z "$svc" ]; then
    tail="${service##*-}"
    case "$tail" in
      '' | *[!0-9]*) ;;  # not -<digits> → not a compose suffix
      *) svc="${service%-$tail}" ;;
    esac
  fi
  self_dropping=0
  case "$SELF_DROPPING" in
    *" $svc "*) self_dropping=1 ;;
  esac
  if [ "$self_dropping" -eq 1 ]; then
    # The server drops to its package user; the transient healthcheck execs
    # (pg_isready / redis-cli, sub-second, run as the container's root
    # user) are filtered — and the filter is ANCHORED to the two exact
    # healthcheck shapes (postgres: args start with pg_isready; redis:
    # `sh -c test "$(redis-cli ping)" = PONG`), so an unrelated root
    # process that merely MENTIONS the token is still a violation — and
    # the container IS still inspected, so a gosu regression keeping the
    # SERVER at uid 0 remains a violation.
    top=$(docker top "$container" -o uid,pid,args 2>/dev/null)
    if [ $? -ne 0 ]; then
      echo "UNINSPECTABLE container $container (docker top failed) — treating as a violation:"
      violations=$((violations + 1))
      continue
    fi
    offenders=$(
      echo "$top" |
        awk 'NR>1 && $1==0' |
        grep -vE '^root[[:space:]]+[0-9]+[[:space:]]+(pg_isready([[:space:]]|$)|sh[[:space:]]+-c[[:space:]]+test[[:space:]]+.*redis-cli[[:space:]]+ping)' |
        awk '{print "  pid " $2 ": " substr($0, index($0, $3))}'
    )
    if [ -n "$offenders" ]; then
      echo "ROOT PROCESS in $container (self-dropping service — outside healthcheck execs):"
      echo "$offenders"
      violations=$((violations + 1))
    fi
    continue
  fi
  # `uid` (effective, NUMERIC): matching the username string would pass
  # a uid-0 process whose container passwd aliases 0 to another name
  # (useradd -o -u 0 admin) — the alias makes docker top print "admin"
  # for a root process. A failed inspection is NOT skippable — skipping
  # would turn an un-inspectable container into a silent pass.
  top=$(docker top "$container" -o uid,pid,args 2>/dev/null)
  if [ $? -ne 0 ]; then
    echo "UNINSPECTABLE container $container (docker top failed) — treating as a violation:"
    violations=$((violations + 1))
    continue
  fi
  offenders=$(echo "$top" | awk 'NR>1 && $1==0 {print "  pid "$2": "substr($0, index($0,$3))}')
  if [ -n "$offenders" ]; then
    echo "ROOT PROCESS in $container:"
    echo "$offenders"
    violations=$((violations + 1))
  fi
done <<EOF
$containers
EOF

# --- 2. no root-owned file under the data directory ---------------------------
# Scope mirrors the static half: the always-on contract. The starting
# directory itself is root-owned by design (the Ansible loop creates the
# parent), and data/huggingface belongs to the profile-gated GPU TEI
# services, which the contract excludes.
if [ ! -d "$DATA_DIR" ]; then
  echo "DATA DIR MISSING: '$DATA_DIR' does not exist — the root-owned sweep"
  echo "would be vacuous. Fix the path (or create the dir) and rerun."
  violations=$((violations + 1))
else
  find_err=$(mktemp)
  rootowned=$(find "$DATA_DIR" -mindepth 1 -path "$DATA_DIR/huggingface" -prune -o -uid 0 -print 2>"$find_err")
  if [ -s "$find_err" ]; then
    echo "FIND ERRORS while sweeping $DATA_DIR (untraversable paths are NOT checked):"
    sed 's/^/  /' "$find_err"
    violations=$((violations + 1))
  fi
  rm -f "$find_err"
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
