#!/usr/bin/env bash
#
# Smoke test for the config_bootstrap Ansible role.
#
# Verifies the two correctness contracts of the role:
#
#   1. Idempotence          - re-running the role does not change the seeded
#                             runtime config tree on the host.
#   2. The host mirrors the branch - the branch is the single source of truth
#                             for the runtime config, so a file an operator
#                             edited by hand between deploys is reverted by the
#                             next run, and a file the branch does not ship is
#                             removed. Operator changes belong in the
#                             repository, in the flavour's config file.
#
# Usage:
#   test_idempotence.sh <inventory_file> <host> [vault_id] [become_password] [repo_branch]
#
#   <inventory_file>  Required. e.g. inventory/itu_rtx_el_salvador.ini
#   <host>            Required. A single host from that inventory, e.g. el-salvador-01
#   [vault_id]        Optional. Passed through as --vault-id to every ansible call.
#   [become_password] Optional. Written to a temporary 0600 file passed as
#                     --become-password-file to every ansible call (ansible has
#                     no --become-password flag). The file is removed on exit.
#                     Needed when the target's sudo is not passwordless.
#   [repo_branch]     Optional. Branch the role seeds from. Defaults to the
#                     playbook's repo_branch (main). ALWAYS pass the branch the
#                     host is actually deployed from when it is not main: the
#                     host copy MIRRORS the branch (files the branch does not
#                     ship are removed), so seeding main's assets onto e.g. a
#                     release/el-salvador node would delete that node's theme
#                     and its flavour configuration. The role refuses to sync
#                     a branch that does not ship the deployment's Keycloak
#                     theme.
#
# Both the inventory and the host must be given explicitly: the script never
# guesses a target, and it never falls back to a hardcoded host. Run it against
# a real deploy node (or any host Ansible can reach) - it writes to that host's
# config_dir, and at the end it restores the whole config tree from the archive
# taken before the first run: the host is returned to its PRE-TEST state, not
# left serving the branch. What the role's mirror did DURING the test (the
# reverts, the removals) is the mirror's contract being exercised; the restore
# then puts back whatever the host served before the test, so a node that had
# drifted is drifted again afterwards - run the deploy, not this test, to
# converge a node.
#
# A restore that fails fails the test. The restore removes the config tree
# before extracting the archive back into it, so a failed restore leaves the
# host with an empty config directory - which shadows the images and breaks
# every container that reads it. That must never read as a pass.
#
# NOT run by CI. This needs a live Ansible target host.
#
# Grounded in:
#   deploy/ansible/group_vars/all.yml            deploy_dir: /opt/genieai; config_dir: "{{ deploy_dir }}/config"
#   deploy/ansible/roles/config_bootstrap/defaults/main.yml
#                                               config_bootstrap_pairs (dest_subdir)
#   deploy/ansible/roles/config_bootstrap/tasks/main.yml
#                                               rsync --archive --checksum --delete (mirror the branch)
#   deploy/ansible/deploy.yml                    the config deploy play: tags [config, deploy]
#   deploy/ansible/templates/env.j2              CONFIG_DIR_FRONTEND / CONFIG_DIR_KEYCLOAK render
#   docker-compose.yaml                          frontend mounts /config <- ${CONFIG_DIR_FRONTEND}:ro;
#                                                Keycloak mounts the themes root <- ${CONFIG_DIR_KEYCLOAK}:ro
#   components/gov-chat-frontend/nginx.conf
#                                               /config vs /runtime/config.js vs /theme-fallback.css
#   components/gov-chat-frontend/docker-entrypoint.sh
#                                               writes /app/dist/runtime/config.js
#   components/gov-chat-frontend/public/index.html
#                                               links /config/theme-variables.css, /runtime/config.js
#   configs/keycloak/genie-realm.yaml            login/account/admin/email all = KEYCLOAK_THEME

set -euo pipefail

readonly ROLE_TAG="config"
readonly MARKER="/* config_bootstrap smoke-test marker - safe to delete */"

usage() {
    cat <<'USAGE'
Usage:
  test_idempotence.sh <inventory_file> <host> [vault_id] [become_password] [repo_branch]

  <inventory_file>  Required. e.g. inventory/itu_rtx_el_salvador.ini
  <host>            Required. A single host from that inventory, e.g. el-salvador-01
  [vault_id]        Optional. Passed through as --vault-id to every ansible call.
  [become_password] Optional. Passed as --become-password-file via a temporary
                    0600 file (removed on exit). Needed when the target's sudo
                    is not passwordless.

Both the inventory and the host must be given explicitly - the script never
guesses a target and never falls back to a hardcoded host.
USAGE
}

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

step() {
    printf '\n=== %s ===\n' "$*"
}

pass() {
    printf '  [ok] %s\n' "$*"
}

fail() {
    printf '  [FAIL] %s\n' "$*" >&2
    exit 1
}

# --- arguments ----------------------------------------------------------------

if [ "$#" -lt 2 ]; then
    printf 'ERROR: both an inventory file and a host are required.\n\n' >&2
    usage >&2
    exit 2
fi

INVENTORY="$1"
HOST="$2"
VAULT_ID="${3:-}"
BECOME_PASSWORD="${4:-}"
REPO_BRANCH="${5:-}"

[ -n "$INVENTORY" ] || die "inventory file must not be empty."
[ -n "$HOST" ] || die "host must not be empty."
[ -f "$INVENTORY" ] || die "inventory file not found: $INVENTORY"

readonly INVENTORY HOST VAULT_ID BECOME_PASSWORD REPO_BRANCH

# Run from deploy/ansible so group_vars/ (which defines deploy_dir/config_dir)
# is on the vars path, and so deploy.yml resolves.
ANSIBLE_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
readonly ANSIBLE_DIR
cd "$ANSIBLE_DIR"

# --- ansible invocation helpers -----------------------------------------------

# Every Ansible call gets the same extra arguments. Array expansion is guarded
# with ${arr[@]+...} so `set -u` stays happy when the array is empty on bash < 4.4.
ansible_run() {
    local -a extra=()
    [ -n "$VAULT_ID" ] && extra+=(--vault-id "$VAULT_ID")
    [ -n "$BECOME_PW_FILE" ] && extra+=(--become-password-file "$BECOME_PW_FILE")
    # shellcheck disable=SC2086
    if [ "$#" -gt 0 ] && [ "${1:-}" = "raw" ]; then
        shift
        ansible "$@" "${extra[@]+"${extra[@]}"}"
    else
        ansible-playbook "$@" "${extra[@]+"${extra[@]}"}"
    fi
}

# Shells out on the target host with become, because config_dir lives under
# /opt/genieai and is root-owned.
remote_sh() {
    ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell -a "$1"
}

run_role() {
    # The optional first argument names the branch to deploy; the default is
    # the branch the test was given, which deploy.yml would seed anyway. See
    # the [repo_branch] argument note above.
    local branch="${1:-$REPO_BRANCH}"
    local -a branch_args=()
    [ -n "$branch" ] && branch_args+=(-e "repo_branch=$branch")
    ansible_run -i "$INVENTORY" deploy.yml \
        --tags "$ROLE_TAG" \
        --limit "$HOST" \
        --become \
        "${branch_args[@]+"${branch_args[@]}"}"
}

# --- config_dir resolution ----------------------------------------------------

# config_dir is a Jinja expression ("{{ deploy_dir }}/config"), so read it from
# the target host's resolved variable scope rather than hardcoding it. `debug`
# is an action plugin, so this resolves controller-side and needs no host
# connectivity - but it does need the vault, hence --vault-id.
resolve_config_dir() {
    local out
    out="$(ansible_run raw -i "$INVENTORY" "$HOST" -m debug \
        -a 'msg={{ config_dir }}' 2>/dev/null |
        sed -n 's/.*"msg": "\(.*\)".*/\1/p')"
    [ -n "$out" ] || die \
        "could not resolve config_dir for host '$HOST'.
  This usually means the inventory or the vault id is wrong. Re-run with the
  correct <inventory_file> and, if the inventory needs secrets, <vault_id>."
    printf '%s\n' "$out"
}

# --- restore-on-exit ----------------------------------------------------------

# ansible has no --become-password flag. Hand the password over through a
# temporary 0600 file (no trailing newline) that restore() deletes on exit.
# Created after argument validation but before the first ansible call and the
# trap below, so no die() exit can leak the file.
BECOME_PW_FILE=""
if [ -n "$BECOME_PASSWORD" ]; then
    BECOME_PW_FILE="$(mktemp)"
    printf '%s' "$BECOME_PASSWORD" > "$BECOME_PW_FILE"
fi

BACKUP_PATH=""
BACKUP_ARCHIVE=""
EXPECTED_PATH=""
STRAY_PATH=""
RESTORE_ARMED="false"
RESTORE_RUNNING="false"

# The restore stays armed until it SUCCEEDS, so a signal that lands mid-run
# still finds the host's config recoverable: the archive is only removed once
# the tree is back. While a restore is in flight the busy flag makes a second
# caller leave it alone — a nested restore would delete the scratch tree the
# first one is still reading. Disarming it up front left the
# archive on the host whenever a signal landed between the extraction and its
# removal.
# 0 = the host is back to its pre-test state (or there was nothing to
# restore); 1 = the restore failed. The exit CODE of the run is the caller's
# business: the traps below keep the code the run ended with.
# The become-password file is removed at the END of the restore, never
# before: the restore's own ansible calls run with --become-password-file, so
# on a host whose sudo needs a password, scrubbing first would strip the
# restore of the credentials it needs and leave the tree unrestored.
scrub_pw_file() {
    if [ -n "${BECOME_PW_FILE:-}" ] && [ -f "$BECOME_PW_FILE" ]; then
        rm -f "$BECOME_PW_FILE"
    fi
}
restore() {
    if [ "$RESTORE_RUNNING" = "true" ]; then
        # A restore is already in flight (a second signal landed mid-restore).
        # Let it finish alone: re-entering it would delete the scratch tree
        # the first invocation is still reading — and scrubbing the password
        # file here would strip the running restore of its credentials.
        return 0
    fi
    if [ "$RESTORE_ARMED" != "true" ]; then
        scrub_pw_file
        return 0
    fi
    RESTORE_RUNNING="true"
    if [ -n "$EXPECTED_PATH" ]; then
        ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "rm -f '$EXPECTED_PATH'" >/dev/null 2>&1 || true
        EXPECTED_PATH=""
    fi
    # The stray file this test creates must never outlive it, whether the run
    # passed, failed, or aborted before the mirror removed it.
    if [ -n "$STRAY_PATH" ]; then
        ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "rm -f '$STRAY_PATH'" >/dev/null 2>&1 || true
        STRAY_PATH=""
    fi
    printf '\n=== Cleanup: restoring the config tree under %s ===\n' "$CONFIG_DIR"
    # The single-file copy is redundant next to the tree archive, and it must
    # not outlive the test.
    if [ -n "$BACKUP_PATH" ]; then
        ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "rm -f '$BACKUP_PATH'" >/dev/null 2>&1 || true
        BACKUP_PATH=""
    fi
    # The whole tree is restored, not only the file this test edited: a run
    # that removed the host's config (a wrong branch, or a mirror whose source
    # path is wrong) must not leave the node without it while the script
    # reports a successful restore.
    #
    # The tree is synced into place, not extracted over a fresh extraction of
    # $CONFIG_DIR: running containers hold bind mounts on these directories,
    # so the directory inodes must survive the restore or every container
    # would keep serving the deleted inode's content until restarted. rsync
    # updates the tree inside the existing directories; a serving container
    # never notices.
    if [ -n "$BACKUP_ARCHIVE" ] &&
        ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "test -f '$BACKUP_ARCHIVE'" >/dev/null 2>&1; then
        RESTORE_SCRATCH="$CONFIG_PARENT/.config_bootstrap_restore_scratch"
        if ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "rm -rf '$RESTORE_SCRATCH'; mkdir -p '$RESTORE_SCRATCH' && tar -xpf '$BACKUP_ARCHIVE' -C '$RESTORE_SCRATCH' && rsync -a --delete '$RESTORE_SCRATCH/$(basename "$CONFIG_DIR")/' '$CONFIG_DIR/'; st=\$?; rm -rf '$RESTORE_SCRATCH'; exit \$st" >/dev/null 2>&1; then
            ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
                -a "rm -f '$BACKUP_ARCHIVE'" >/dev/null 2>&1 || true
            printf '  [ok] %s restored from pre-test backup; backup removed.\n' "$CONFIG_DIR"
            RESTORE_ARMED="false"
            RESTORE_RUNNING="false"
            scrub_pw_file
            return 0
        fi
    fi
    printf '  [FAIL] automatic restore did not complete.\n' >&2
    printf '         To restore %s by hand, run on the host:\n' "$CONFIG_DIR" >&2
    printf '           mkdir -p /tmp/cb-restore && tar -xpf %s -C /tmp/cb-restore\n' "$BACKUP_ARCHIVE" >&2
    printf '           rsync -a --delete /tmp/cb-restore/config/ %s/ && rm -rf /tmp/cb-restore\n' "$CONFIG_DIR" >&2
    # The restore failed and the host's config tree is gone (the rm -rf ran,
    # the extraction did not). That is the worst outcome this script can
    # produce, so it must not be reported as a pass: the CALLER decides the
    # exit code (the EXIT trap turns a failed restore into a failed run; the
    # signal traps keep the signal's code, because "interrupted" is what a
    # caller keys on). The archive stays on the host: it is what the operator
    # needs when the tree was left unrestored. Disarm either way, so the EXIT
    # trap does not attempt the restore a second time and print it twice.
    RESTORE_ARMED="false"
    RESTORE_RUNNING="false"
    scrub_pw_file
    return 1
}
# The EXIT trap keeps the code the run ended with and turns a FAILED restore
# into a failed run (1). A signal restores the host and stops the script on
# the signal's code: a signal that only restored the host would let the run
# continue on a tree the restore had just put back, and it would end by
# reporting a pass — and a caller keys on 130/143 to recognise "interrupted".
# A signal landing WHILE a restore is running (the busy flag is set) only
# notes itself and returns: exiting there would kill the restore mid-way and
# leave the host half-restored — the interrupted restore finishes putting the
# tree back. A restore that a signal trap started still ends on the signal's
# code; a restore the script itself started (the end-of-run cleanup) lets the
# run finish and report its own result. `restore || true` matters in the
# direct path: with errexit on, a failing command inside the trap handler
# would end the handler on ITS code and the signal's code would never be
# reached.
sigtrap() {
    if [ "$RESTORE_RUNNING" = "true" ]; then
        printf '  [..] signal received while the restore is running; it finishes before the shell goes away.\n' >&2
        return 0
    fi
    restore || true
    exit "$1"
}
trap 'rc=$?; if restore; then exit "$rc"; else exit 1; fi' EXIT
trap 'sigtrap 130' INT
trap 'sigtrap 143' TERM

# --- resolve paths ------------------------------------------------------------

step "Resolving runtime config paths for host $HOST"
CONFIG_DIR="$(resolve_config_dir)"
# config_dir is "{{ deploy_dir }}/config" (group_vars/all.yml:22) - normalise so
# the sub-path joins below are unambiguous whether or not it carries a slash.
CONFIG_DIR="${CONFIG_DIR%/}"
# The restore below rsyncs the backup into the config tree with --delete, so
# the path has to be the one the deployment uses: a mis-resolved config_dir
# would have the deployment's files deleted from it. The playbook always
# derives it as "{{ deploy_dir }}/config", so the basename is checked before
# anything destructive can run.
[ "$(basename "$CONFIG_DIR")" = "config" ] || die \
    "refusing to operate on '$CONFIG_DIR': config_dir must be a directory named 'config'."
CONFIG_PARENT="$(dirname "$CONFIG_DIR")"
FRONTEND_DIR="${CONFIG_DIR}/frontend"
KEYCLOAK_THEME_DIR="${CONFIG_DIR}/keycloak/themes"
THEME_CSS="${FRONTEND_DIR}/theme-variables.css"
printf '  config_dir           = %s\n' "$CONFIG_DIR"
printf '  frontend config dir  = %s\n' "$FRONTEND_DIR"
printf '  keycloak theme dir   = %s\n' "$KEYCLOAK_THEME_DIR"

remote_sh "test -d '$FRONTEND_DIR'" >/dev/null ||
    fail "frontend config dir is absent: $FRONTEND_DIR (run the role first?)"
remote_sh "test -d '$KEYCLOAK_THEME_DIR'" >/dev/null ||
    fail "keycloak theme dir is absent: $KEYCLOAK_THEME_DIR (run the role first?)"

# --- backup the host tree ------------------------------------------------------

# The tree is archived BEFORE the first role run and the restore is armed with
# it, so a run that destroys the host's config (a wrong branch, or a mirror
# whose source path is wrong) leaves the node with its config back, not with an
# empty mount that shadows the images. The whole tree is archived, not just the
# file this test edits: the mirror can remove any file the branch does not
# ship.
BACKUP_ARCHIVE="/tmp/config_bootstrap_smoke_backup_$$.tar"
remote_sh "tar -cpf '$BACKUP_ARCHIVE' -C '$CONFIG_PARENT' '$(basename "$CONFIG_DIR")'" ||
    fail "could not archive the config tree under $CONFIG_DIR to $BACKUP_ARCHIVE"
RESTORE_ARMED="true"
pass "backed up the config tree under $CONFIG_DIR to $BACKUP_ARCHIVE"

# --- run 1: populate ----------------------------------------------------------

step "Run 1: seed the runtime config dirs (playbook deploy.yml --tags $ROLE_TAG)"
run_role

# --- assertions on the seeded set --------------------------------------------

step "Asserting the seeded frontend config set"

# public/index.html:19 links the stylesheet from the read-only /config mount.
remote_sh "test -f '$THEME_CSS'" || fail "theme stylesheet missing: $THEME_CSS"
pass "theme stylesheet present: theme-variables.css (index.html links /config/theme-variables.css)"

# Second brand JSON asset that rides the same mount.
remote_sh "test -f '$FRONTEND_DIR/genie-ai-config.json'" ||
    fail "brand config missing: $FRONTEND_DIR/genie-ai-config.json"
pass "brand config present: genie-ai-config.json"

# docker-entrypoint.sh writes /app/dist/runtime/config.js at container startup;
# it is deliberately NOT a seeded repo asset. Its reappearance in /config means
# the seeded set is wrong (or someone copied a generated file in).
remote_sh "test ! -e '$FRONTEND_DIR/config.js'" ||
    fail "generated config.js must not be seeded into $FRONTEND_DIR (it is written to /app/dist/runtime at container startup)"
pass "no generated config.js in the seeded dir"

# nginx.conf:42 serves /theme-fallback.css from the image-baked dist root, not
# from the /config mount.
remote_sh "test ! -e '$FRONTEND_DIR/theme-variables-fallback.css'" ||
    fail "theme-variables-fallback.css must not be seeded into $FRONTEND_DIR (nginx.conf serves the image-baked /theme-fallback.css)"
pass "no image-baked theme-variables-fallback.css in the seeded dir"

step "Asserting the seeded Keycloak theme set"

# genie-realm.yaml:14-17 points login, account, admin and email at the same
# KEYCLOAK_THEME value, so all four subtrees must exist. A missing one is a
# silent regression: Keycloak falls back to its built-in theme. This list is
# the parent theme's own shape — keep it in step with the keycloak pair's
# expect list in the role defaults: a deployment that retires one of the
# parent's subtrees retires it there AND here, or this test reports the
# converged role as broken.
for sub in login account admin email; do
    remote_sh "test -f '$KEYCLOAK_THEME_DIR/genie/$sub/theme.properties'" ||
        fail "keycloak theme subtree incomplete: $sub/theme.properties missing under $KEYCLOAK_THEME_DIR/genie"
    pass "keycloak theme present: $sub/theme.properties"
done

# --- contract 1: idempotence --------------------------------------------------

step "Contract 1: a second role run must be a no-op"

manifest() {
    snapshot "find . -type f -exec md5sum {} + | sort -k2"
}

# Sorted list of every regular file under config_dir. A subset of manifest(),
# used separately so a run that adds or removes files is distinguishable from
# one that rewrites file contents.
filelist() {
    snapshot "find . -type f | sort"
}

# `ansible`'s display of a successful task's stdout changed across versions
# (newer cores hide it behind callback settings), so the payload never
# travels through the display: the command writes it to a file on the host,
# fetch brings it to the controller, and the caller reads the file. The
# fetched copy is what the caller sees, byte for byte.
snapshot() {
    local snapshot_remote="$CONFIG_PARENT/.config_bootstrap_snapshot.txt"
    local snapshot_local
    snapshot_local="$(mktemp "${TMPDIR:-/tmp}/config_bootstrap_snapshot.XXXXXX")"
    ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
        -a "cd '$CONFIG_DIR' && { $1 ; } > '$snapshot_remote'" >/dev/null 2>&1 || true
    ansible_run raw -i "$INVENTORY" "$HOST" -m fetch \
        -a "src='$snapshot_remote' dest='$snapshot_local' flat=yes" >/dev/null 2>&1 || true
    cat "$snapshot_local" 2>/dev/null
    rm -f "$snapshot_local"
    ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
        -a "rm -f '$snapshot_remote'" >/dev/null 2>&1 || true
}

# The deployment's CONFIGURED theme (the one keycloak_theme names, rendered
# into the environment next to the config dir) must have survived the mirror
# with the same four subtrees: a run that loses the flavour's theme still has
# genie present, and only this check sees the difference. A deployment that
# does not name a theme in its environment serves genie, which the loop above
# already covered.
HOST_THEME="$(snapshot "grep -E '^KEYCLOAK_THEME=' '$CONFIG_PARENT/.env' | tail -n 1 | cut -d= -f2-" 2>/dev/null || true)"
HOST_THEME="$(printf '%s' "$HOST_THEME" | tr -d '[:space:]')"
if [ -n "$HOST_THEME" ] && [ "$HOST_THEME" != "genie" ]; then
    for sub in login account admin email; do
        remote_sh "test -f '$KEYCLOAK_THEME_DIR/$HOST_THEME/$sub/theme.properties'" ||
            fail "configured theme incomplete: $HOST_THEME/$sub/theme.properties missing under $KEYCLOAK_THEME_DIR"
        pass "configured theme present: $HOST_THEME/$sub/theme.properties"
    done
fi

MANIFEST_BEFORE="$(manifest)"
FILELIST_BEFORE="$(filelist)"
step "Run 2: re-run the role (expecting no change to the seeded tree)"
run_role
MANIFEST_AFTER="$(manifest)"

if [ "$MANIFEST_BEFORE" != "$MANIFEST_AFTER" ]; then
    printf '--- before ---\n%s\n--- after ---\n%s\n' \
        "$MANIFEST_BEFORE" "$MANIFEST_AFTER" >&2
    fail "the second role run changed the config tree under $CONFIG_DIR (not idempotent)"
fi
pass "second run left every file under $CONFIG_DIR byte-identical"

# --- contract 2: the host mirrors the branch ----------------------------------

step "Contract 2: the host copy must mirror the branch"

remote_sh "test -f '$THEME_CSS'" || fail "cannot test the mirror contract: $THEME_CSS is missing"

BACKUP_PATH="/tmp/config_bootstrap_smoke_backup_$$.css"
remote_sh "cp -p '$THEME_CSS' '$BACKUP_PATH'" ||
    fail "could not back up $THEME_CSS to $BACKUP_PATH"
pass "backed up $THEME_CSS to $BACKUP_PATH"

# Append the marker as its own line rather than folding it into an existing rule:
# appending CSS to an arbitrary trailing line can change what the file means.
# The marker is a self-contained comment on its own line, and every check below
# asserts on this exact string rather than on "the last line".
remote_sh "printf '%s\\n' '$MARKER' >> '$THEME_CSS'" ||
    fail "could not append the smoke-test marker to $THEME_CSS"
pass "appended marker line to $THEME_CSS"

# A file the branch does not ship: the mirror must take it away.
STRAY_PATH="$CONFIG_DIR/frontend/config_bootstrap_smoke_stray_$$.txt"
remote_sh "printf 'stray\\n' > '$STRAY_PATH'" ||
    fail "could not create the stray file $STRAY_PATH"
pass "created stray file $STRAY_PATH"

step "Run 3: re-run the role after a manual edit"
run_role

# The manual edit must be gone: the branch is the source of truth.
if remote_sh "grep -Fq '$MARKER' '$THEME_CSS'"; then
    fail "the manual edit survived the role run - the host copy does not mirror the branch"
fi
pass "the manual edit was reverted by the role run"

# ...and the file must equal the pre-test content again, byte for byte.
EXPECTED_PATH="/tmp/config_bootstrap_smoke_expected_$$.css"
ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
    -a "cat '$BACKUP_PATH' > '$EXPECTED_PATH'" ||
    fail "could not build the expected-content file on the host"
if ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell -a "cmp -s '$EXPECTED_PATH' '$THEME_CSS'"; then
    pass "$THEME_CSS is byte-identical to the pre-test content again"
else
    fail "$THEME_CSS was not restored to the branch copy by the role run"
fi
ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell -a "rm -f '$EXPECTED_PATH'" || true

# The file the branch does not ship must be gone as well.
if remote_sh "test -e '$STRAY_PATH'"; then
    fail "the stray file $STRAY_PATH survived the role run - the mirror does not delete what the branch does not ship"
fi
pass "the stray file was removed by the role run"

# A re-run must not have introduced or removed any other file either: the
# whole file list must match the one captured before the test.
FILELIST_AFTER_EDIT="$(filelist)"
if [ "$FILELIST_BEFORE" != "$FILELIST_AFTER_EDIT" ]; then
    printf '--- file list before the manual edit ---\n%s\n' "$FILELIST_BEFORE" >&2
    printf '--- file list after  the role run ---\n%s\n' "$FILELIST_AFTER_EDIT" >&2
    fail "the role run added or removed files under $CONFIG_DIR"
fi
pass "no files were added or removed under $CONFIG_DIR"

# --- contract 3: the guards refuse a foreign branch ---------------------------

step "Contract 3: the guards refuse a branch that does not belong to this deployment"

# On a deployment host (seeded from its flavour branch), deploying main is the
# wrong-branch mistake the guards exist for: main carries the default brand,
# and the role refuses to mirror it before anything is written. Which guard
# fires depends on the branch's theme versus the group_vars theme — either
# refusal is proof the deployment rejects a foreign branch before touching it.
# The contract refuses branch main by name, so it needs a host whose own
# branch is not main; seeded from main the test does not know which branch
# would be foreign here, and skips. An empty REPO_BRANCH means deploy.yml's
# default, which is main.
if [ -z "$REPO_BRANCH" ] || [ "$REPO_BRANCH" = "main" ]; then
    pass "skipped: seeded from main - this test does not know which branch this deployment would have to refuse; run it on the deployment host, where contract 3 exercises the refusal against the branch that host actually runs"
else
    # The pre-test archive is still armed: if the guards fail to fire and the
    # mirror runs main's assets onto this host, the restore puts the
    # deployment's config back.
    MANIFEST_BEFORE_GUARD="$(manifest)"
    CONTRACT3_LOG="/tmp/config_bootstrap_contract3_$$.log"
    if run_role main > "$CONTRACT3_LOG" 2>&1; then
        rm -f "$CONTRACT3_LOG"
        fail "the role accepted branch main on a host this branch does not belong to - no guard fired"
    fi
    if grep -qE "does not ship the Keycloak theme|ships the brand|brand file that is not valid" "$CONTRACT3_LOG"; then
        pass "a guard refused branch main"
    else
        printf '  [FAIL] the deploy failed, but not through a config guard:\n' >&2
        grep -E "fatal|ERROR" "$CONTRACT3_LOG" | head -3 >&2 || true
        rm -f "$CONTRACT3_LOG"
        fail "the refusal came from somewhere else"
    fi
    rm -f "$CONTRACT3_LOG"
    if [ "$MANIFEST_BEFORE_GUARD" != "$(manifest)" ]; then
        fail "the refused deployment changed the host - the guards must run before anything is mirrored"
    fi
    pass "the refused deployment left the host untouched"
fi

# --- cleanup (also runs via the EXIT trap) -----------------------------------

restore || exit 1
trap - EXIT INT TERM

printf '\n=== ALL SMOKE TESTS PASSED ===\n'
printf 'Host:          %s\n' "$HOST"
printf 'Inventory:     %s\n' "$INVENTORY"
printf 'config_dir:    %s\n' "$CONFIG_DIR"