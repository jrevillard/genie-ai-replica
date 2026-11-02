#!/usr/bin/env bash
# Runtime half of the #1227 no-root contract (the static half lives in
# tests/config-validator/__tests__/compose-non-root.test.js).
#
# Asserts, against a RUNNING compose project:
#   1. no long-term process runs as root — every process of every running
#      container must have a uid != 0 (checked via `docker top`, the host's
#      view of the container's process table);
#   2. no root-owned file exists under the data directory — the host-visible
#      surface container filesystems and bind mounts land on;
#   3. every file under <data>/database_backups is owned by the backend's
#      uid 1000 (the backend must own its own dump dir);
#   4. every file under the secrets/ssl bind is group-101-readable and the
#      directory grants gid-101 traverse (the shipped state is root:101
#      0640 — the pre-#1227 root:root 0600/0640 spellings crash-loop the
#      edge).
#
# Usage: tests/compose-non-root/check-runtime.sh <compose-project> [data_dir] [secrets_dir]
# Env:   DATA_DIR overrides ./data default when data_dir arg is omitted;
#        ./secrets/ssl is the secrets_dir default (repo-relative to CWD).
#
# PRECONDITION — run as root or as the owner of the data directory: the
# sweeps in rules 2-3 traverse the live tree, and an unprivileged run over
# a legitimate 0700 uid-1000 tree (the backend's own backup artifacts)
# turns find's EACCES into a violation group — a phantom, not a contract
# break. An untraversable ROOT-owned path is still reported either way.
#
# Exit 0 = contract holds; 1 = violations listed; 2 = VACUOUS RUN (no
# container matched the project name — nothing was inspected, never read
# it as OK); 3 = docker daemon unreachable; 4 = usage error. One-shot init
# containers (arango-vector-db-init, victorialogs-init,
# document-repository-init, backend-init, otel-collector-init,
# secrets-ssl-init, postgres-init, kong-config, kong-migrations,
# db-migrations) have
# exited by the time this runs and are not inspected; their contract is
# enforced by the static test + this sweep. keycloak-config is NOT in
# that list: it ends in `exec sleep infinity` and runs permanently
# (uid 65534) — the gate inspects it like any long-lived container.

set -u

if [ $# -lt 1 ]; then
  echo "usage: check-runtime.sh <compose-project> [data_dir] [secrets_dir]" >&2
  # usage errors get their own exit — 1 means CONTRACT VIOLATIONS
  exit 4
fi
PROJECT="$1"
DATA_DIR="${2:-${DATA_DIR:-./data}}"
# Trailing-slash callers ("./data/", "./data//") must be stripped BEFORE
# the symlink test: POSIX dereferences a trailing slash, so [ -L "./data/" ]
# is FALSE for a symlink (verified) and resolution would be skipped — the
# sweep below would then lstat only the link inode and pass vacuously.
# The strip also unbreaks the -path prune pattern (./data//huggingface
# never matches) — strip ALL trailing slashes (the root "/" itself is not
# a data dir spelling this gate accepts).
while [ "$DATA_DIR" != "${DATA_DIR%/}" ] && [ "$DATA_DIR" != "/" ]; do
  DATA_DIR="${DATA_DIR%/}"
done
# A symlinked data dir (ln -s /srv/genie-data data — common when /opt is
# small) makes GNU find inspect only the symlink inode: a silently
# vacuous sweep. Resolve to the real directory and say so.
if [ -L "$DATA_DIR" ]; then
  echo "NOTE: data dir $DATA_DIR is a symlink — resolving to $(readlink -f "$DATA_DIR")"
  DATA_DIR="$(readlink -f "$DATA_DIR")"
fi
if [ -z "$DATA_DIR" ] || [ "$DATA_DIR" = "/" ]; then
  echo "usage: DATA_DIR must be the stack's data directory — '/' would sweep"
  echo "the whole host filesystem (and would never be the data dir)."
  exit 4
fi

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
# -a WITH a status filter: plain `docker ps` omits `created`-state
# containers, so a service that failed at create time (a bind-source
# error — the exact failure mode the create_host_path guards produce)
# was silently never inspected while the rest of the stack passed.
# `restarting` is included too: the EACCES crash loop a botched no-root
# upgrade produces sits between restart attempts, and a vacuous skip is
# exactly what the exit-code doctrine forbids. Exited one-shots stay
# excluded (created + restarting + paused + running only). A paused
# container is frozen but LIVE — its uid-0 process tree is exactly what
# rule 1 exists to inspect.
containers=$(
  {
    docker ps -a --filter "status=created" --filter "status=restarting" --filter "status=paused" --filter "status=running" \
      --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}'
    docker ps -a --filter "status=created" --filter "status=restarting" --filter "status=paused" --filter "status=running" \
      --filter "label=com.docker.stack.namespace=$PROJECT" --format '{{.Names}}'
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
  # is <svc>.<digits>.<id> and a compose container is <svc>-<digits> (an
  # init container DOES reduce: backend-init-1 → backend-init — the
  # property that keeps that safe is that no reduced init name is in
  # SELF_DROPPING). A dotted swarm-style name like postgres.2-1 falls
  # through to the dash fallback and reduces to a PREFIX (postgres.2) —
  # the safety property is not that such names never reduce, it is that
  # no reduced name collides with the two entries SELF_DROPPING lists.
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
  # The empty-svc guard is load-bearing: with svc unset the pattern
  # becomes *" "* which matches any SELF_DROPPING value carrying two
  # consecutive spaces — an unreduced name must take the plain any-uid-0
  # check, never the healthcheck-shape exemption.
  if [ -n "$svc" ]; then
    case "$SELF_DROPPING" in
      *" $svc "*) self_dropping=1 ;;
    esac
  fi
  if [ "$self_dropping" -eq 1 ]; then
    # The server drops to its package user; the transient healthcheck execs
    # (pg_isready / redis-cli, sub-second, run as the container's root
    # user) are filtered — and the filter is ANCHORED to the exact
    # sanctioned shapes (postgres: args start with pg_isready — exec form
    # today, but a CMD-SHELL switch runs them as `/bin/sh -c pg_isready
    # ...`, so the wrapper shape — with or without the /bin prefix — is
    # exempted exactly like redis's; redis: the
    # `sh -c test ... redis-cli ping` wrapper AND its command-substitution
    # child, whose args are bare `redis-cli ping`), so an unrelated root
    # process that merely MENTIONS the token is still a violation — and
    # the container IS still inspected, so a gosu regression keeping the
    # SERVER at uid 0 remains a violation. The line prefix is '0' (docker
    # top -o uid prints NUMERIC uids).
    top=$(docker top "$container" -o uid,pid,args 2>/dev/null)
    if [ $? -ne 0 ]; then
      echo "UNINSPECTABLE container $container (docker top failed) — treating as a violation:"
      violations=$((violations + 1))
      continue
    fi
    offenders=$(
      echo "$top" |
        awk 'NR>1 && $1==0' |
        grep -vE '^0[[:space:]]+[0-9]+[[:space:]]+(pg_isready([[:space:]]|$)|(sh|/bin/sh)[[:space:]]+-c[[:space:]]+pg_isready([[:space:]]|$)|(sh|/bin/sh)[[:space:]]+-c[[:space:]]+test[[:space:]]+.*redis-cli[[:space:]]+ping|redis-cli[[:space:]]+ping([[:space:]]|$))' |
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
# Scope mirrors the static half: the always-on contract. The sweep starts
# at -mindepth 1: on an Ansible-managed host the data DIRECTORY ITSELF is
# deliberately handed to ansible_user (the depth-0 handover) — root
# ownership there is the root-era state the migration abolishes — and
# data/huggingface belongs to the profile-gated GPU TEI
# services, which the contract excludes. data/logs is pruned too: nothing
# has mounted it since #1227 (every service logs to stdout), so it is not
# a bind source — rule 2 exists to catch root-created bind sources, and a
# legacy root-era tree there is inert (remove it at will).
if [ ! -d "$DATA_DIR" ]; then
  echo "DATA DIR MISSING: '$DATA_DIR' does not exist — the root-owned sweep"
  echo "would be vacuous. Fix the path (or create the dir) and rerun."
  violations=$((violations + 1))
else
  find_err=$(mktemp)
  find_out=$(mktemp)
  # -user 0, not -uid 0: busybox find has no -uid (the only find inside
  # the docker:24 CI image — verified) and the parse failure counts as a
  # violation, making the gate unpassable on CI. -user takes a numeric id
  # on both busybox and GNU find.
  find "$DATA_DIR" -mindepth 1 \( -path "$DATA_DIR/huggingface" -o -path "$DATA_DIR/logs" \) -prune -o -user 0 -print >"$find_out" 2>"$find_err"
  find_rc=$?
  if [ $find_rc -ne 0 ]; then
    echo "FIND FAILED in $DATA_DIR (rc=$find_rc — the sweep did not complete; the unchecked remainder is not a pass)"
    violations=$((violations + 1))
  fi
  rootowned=$(cat "$find_out")
  if [ -s "$find_err" ]; then
    echo "FIND ERRORS while sweeping $DATA_DIR (untraversable paths are NOT checked):"
    sed 's/^/  /' "$find_err"
    violations=$((violations + 1))
  fi
  rm -f "$find_err" "$find_out"
  if [ -n "$rootowned" ]; then
    echo "ROOT-OWNED paths under $DATA_DIR:"
    echo "$rootowned" | sed 's/^/  /'
    violations=$((violations + 1))
  fi
fi

# --- 3. the backend (uid 1000) must own its backup directory ------------------
# Rule 2 catches ROOT-owned paths; the migration's predicate is broader
# (! -uid 1000) because the uid-1000 backend needs to OWN the directory —
# a backup dir left owned by the deploying user passes rule 2 while every
# dump write dies EACCES. Same prune + symlink logic as rule 2.
backup_dir="$DATA_DIR/database_backups"
if [ -L "$backup_dir" ]; then
  backup_dir="$(readlink -f "$backup_dir")"
fi
if [ ! -d "$backup_dir" ]; then
  echo "BACKUP DIR MISSING: $backup_dir does not exist — the backend bind is"
  echo "create_host_path:false, so on a RUNNING stack this directory must exist."
  echo "A skipped ownership check is never an OK."
  violations=$((violations + 1))
else
  find_err=$(mktemp)
  find_out=$(mktemp)
  # ! -user 1000, not ! -uid 1000: busybox find (the CI image's only find)
  # has no -uid — same reason as the rule-2 sweep above.
  find "$backup_dir" ! -user 1000 -print > "$find_out" 2>"$find_err"
  find_rc=$?
  if [ -s "$find_err" ] || [ $find_rc -ne 0 ]; then
    echo "FIND ERRORS while sweeping $backup_dir (untraversable paths are NOT checked):"
    sed 's/^/  /' "$find_err"
    violations=$((violations + 1))
  fi
  misowned=$(head -20 "$find_out")
  if [ -n "$misowned" ]; then
    echo "NON-BACKEND-OWNED paths under $backup_dir (the uid-1000 backend must own them):"
    echo "$misowned" | sed 's/^/  /'
    violations=$((violations + 1))
  fi
  rm -f "$find_err" "$find_out"
fi

# Rule 4: the secrets/ssl host bind — the data directory's sibling
# root-creatable source. Its shipped state is root:101 0640 (the edge's
# gid 101 reads the key; the migrating playbook normalizes to it), so the
# defect this sweep catches is a key WITHOUT group-read — the pre-#1227
# root:root 0600 spelling that crash-loops the edge — plus any
# world-unreadable leftover. On a RUNNING stack the directory must exist
# (create_host_path:false): a missing dir is a violation, never a skip.
secrets_dir="${3:-./secrets/ssl}"
if [ -L "$secrets_dir" ]; then
  secrets_dir="$(readlink -f "$secrets_dir")"
fi
if [ ! -d "$secrets_dir" ]; then
  echo "SECRETS DIR MISSING: $secrets_dir does not exist — the edge nginx bind is"
  echo "create_host_path:false, so on a RUNNING stack this directory must exist."
  echo "A skipped readability check is never an OK."
  violations=$((violations + 1))
else
  find_err=$(mktemp)
  find_out=$(mktemp)
  # busybox find (the CI image) has no -uid: -perm and -group are
  # implemented on both. The contract = MODE BIT + GROUP 101: the mode
  # bit alone once passed a root:root 0640 key (verified) that gid-101
  # still cannot read — the same crash-loop as the 0600 spelling.
  find "$secrets_dir" -type f ! \( -perm -0040 -a -group 101 \) -print > "$find_out" 2>"$find_err"
  find_rc=$?
  if [ -s "$find_err" ] || [ $find_rc -ne 0 ]; then
    echo "FIND ERRORS while sweeping $secrets_dir (untraversable paths are NOT checked):"
    sed 's/^/  /' "$find_err"
    violations=$((violations + 1))
  fi
  unreadable=$(head -20 "$find_out")
  if [ -n "$unreadable" ]; then
    echo "FILES WITHOUT GROUP-READ OR NOT GROUP-101 under $secrets_dir (normalize to root:101 0640):"
    echo "$unreadable" | sed 's/^/  /'
    violations=$((violations + 1))
  fi
  rm -f "$find_err" "$find_out"
  # the directory itself must BE group-101 AND grant it traverse+read —
  # but ONLY when there is something to read: an EMPTY directory (the
  # self-signed path — the certs are generated inside the container)
  # cannot crash-loop the edge on an unreadable key, and a developer
  # checkout cannot chgrp a directory it does not own. A populated dir
  # with a wrong group/mode is the crash-loop shape.
  if [ -n "$(find "$secrets_dir" -type f -print -quit)" ]; then
    dir_bad=$(find "$secrets_dir" -maxdepth 0 ! \( -perm -0050 -a -group 101 \) -print)
    if [ -n "$dir_bad" ]; then
      echo "SECRETS DIR NOT GROUP-TRAVERSABLE (needs group r-x for the gid-101 edge): $dir_bad"
      violations=$((violations + 1))
    fi
  fi
fi

if [ "$violations" -gt 0 ]; then
  echo "NON-ROOT CONTRACT: $violations violation group(s)"
  exit 1
fi
echo "NON-ROOT CONTRACT: OK (project $PROJECT, data dir $DATA_DIR)"
