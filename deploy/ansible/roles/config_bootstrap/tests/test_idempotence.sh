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
#   deploy/ansible/group_vars/all.yml:9          deploy_dir: /opt/genieai
#   deploy/ansible/group_vars/all.yml:21         config_dir: "{{ deploy_dir }}/config"
#   deploy/ansible/roles/config_bootstrap/defaults/main.yml
#                                               config_bootstrap_pairs (dest_subdir)
#   deploy/ansible/roles/config_bootstrap/tasks/main.yml
#                                               rsync --archive --checksum --delete (mirror the branch)
#   deploy/ansible/deploy.yml:418-423            play tags [config, deploy]
#   deploy/ansible/templates/env.j2:415-416      CONFIG_DIR_FRONTEND / CONFIG_DIR_KEYCLOAK
#   docker-compose.yaml:402                      /config  <- ${CONFIG_DIR_FRONTEND}:ro
#   docker-compose.yaml:1629                     themes root <- ${CONFIG_DIR_KEYCLOAK}:ro
#   components/gov-chat-frontend/nginx.conf:20-46
#                                               /config vs /runtime/config.js vs /theme-fallback.css
#   components/gov-chat-frontend/docker-entrypoint.sh
#                                               writes /app/dist/runtime/config.js
#   components/gov-chat-frontend/public/index.html:19-21
#                                               links /config/theme-variables.css, /runtime/config.js
#   configs/keycloak/genie-realm.yaml:14-17      login/account/admin/email all = KEYCLOAK_THEME

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
    # Without an explicit branch, deploy.yml's repo_branch default (main) is
    # what gets seeded. See the [repo_branch] argument note above.
    local -a branch_args=()
    [ -n "$REPO_BRANCH" ] && branch_args+=(-e "repo_branch=$REPO_BRANCH")
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

# The restore stays armed until it SUCCEEDS, so a signal that lands while it
# is running re-enters it: the tree is put back, the archive is removed, and
# the run still ends on the signal's exit code. Disarming it up front left the
# archive on the host whenever a signal landed between the extraction and its
# removal.
# 0 = the host is back to its pre-test state (or there was nothing to
# restore); 1 = the restore failed. The exit CODE of the run is the caller's
# business: the traps below keep the code the run ended with.
restore() {
    # Runs on every exit (armed or not): scrub the become-password file first.
    if [ -n "${BECOME_PW_FILE:-}" ] && [ -f "$BECOME_PW_FILE" ]; then
        rm -f "$BECOME_PW_FILE"
    fi
    [ "$RESTORE_ARMED" = "true" ] || return 0
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
    if [ -n "$BACKUP_ARCHIVE" ] &&
        ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "test -f '$BACKUP_ARCHIVE'" >/dev/null 2>&1; then
        if ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "rm -rf '$CONFIG_DIR' && tar -xpf '$BACKUP_ARCHIVE' -C '$CONFIG_PARENT'" >/dev/null 2>&1; then
            ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
                -a "rm -f '$BACKUP_ARCHIVE'" >/dev/null 2>&1 || true
            printf '  [ok] %s restored from pre-test backup; backup removed.\n' "$CONFIG_DIR"
            RESTORE_ARMED="false"
            return 0
        fi
    fi
    printf '  [FAIL] automatic restore did not complete.\n' >&2
    printf '         To restore %s by hand, run on the host:\n' "$CONFIG_DIR" >&2
    printf '           tar -xpf %s -C %s\n' "$BACKUP_ARCHIVE" "$CONFIG_PARENT" >&2
    # The restore failed and the host's config tree is gone (the rm -rf ran,
    # the extraction did not). That is the worst outcome this script can
    # produce, so it must not be reported as a pass: the CALLER decides the
    # exit code (the EXIT trap turns a failed restore into a failed run; the
    # signal traps keep the signal's code, because "interrupted" is what a
    # caller keys on). The archive stays on the host: it is what the operator
    # needs when the tree was left unrestored. Disarm either way, so the EXIT
    # trap does not attempt the restore a second time and print it twice.
    RESTORE_ARMED="false"
    return 1
}
# The EXIT trap keeps the code the run ended with and turns a FAILED restore
# into a failed run (1). The signal traps restore it and stop the script on
# the signal's code: a signal that only restored the host would let the run
# continue on a tree the restore had just put back, and it would end by
# reporting a pass — and a caller keys on 130/143 to recognise "interrupted",
# so the signal's code is re-asserted even when the restore itself failed
# (whose [FAIL] is printed).
trap 'rc=$?; if restore; then exit "$rc"; else exit 1; fi' EXIT
trap 'restore; exit 130' INT
trap 'restore; exit 143' TERM

# --- resolve paths ------------------------------------------------------------

step "Resolving runtime config paths for host $HOST"
CONFIG_DIR="$(resolve_config_dir)"
# config_dir is "{{ deploy_dir }}/config" (group_vars/all.yml:22) - normalise so
# the sub-path joins below are unambiguous whether or not it carries a slash.
CONFIG_DIR="${CONFIG_DIR%/}"
# The restore below removes the config tree and extracts the backup in its
# place, so the path has to be the one the deployment uses: a mis-resolved
# config_dir would otherwise be deleted wholesale. The playbook always derives
# it as "{{ deploy_dir }}/config", so the basename is checked before anything
# destructive can run.
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
# silent regression: Keycloak falls back to its built-in theme.
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

# `ansible` prints a PLAY RECAP block to stdout alongside the task result, so
# capture the payload between two sentinel lines instead of trusting the whole
# stdout. Without this, a cosmetic change in Ansible's own output would be
# reported as a config-tree change.
snapshot() {
    ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
        -a "cd '$CONFIG_DIR' && echo __SNAPSHOT_BEGIN__ && ($1) && echo __SNAPSHOT_END__" |
        sed -n '/^__SNAPSHOT_BEGIN__$/,/^__SNAPSHOT_END__$/p' |
        sed '1d;$d'
}

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

# --- cleanup (also runs via the EXIT trap) -----------------------------------

restore || exit 1
trap - EXIT INT TERM

printf '\n=== ALL SMOKE TESTS PASSED ===\n'
printf 'Host:          %s\n' "$HOST"
printf 'Inventory:     %s\n' "$INVENTORY"
printf 'config_dir:    %s\n' "$CONFIG_DIR"