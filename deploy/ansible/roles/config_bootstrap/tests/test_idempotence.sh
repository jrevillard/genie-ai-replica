#!/usr/bin/env bash
#
# Smoke test for the config_bootstrap Ansible role.
#
# Verifies the two correctness contracts of the role:
#
#   1. Idempotence          - re-running the role does not change the seeded
#                             runtime config tree on the host.
#   2. Manual edits survive  - a file an operator edited by hand between deploys
#                             is byte-for-byte preserved by a subsequent run,
#                             which is what `--ignore-existing` in the
#                             synchronize task buys us.
#
# Usage:
#   test_idempotence.sh <inventory_file> <host> [vault_id] [become_password]
#
#   <inventory_file>  Required. e.g. inventory/itu_rtx_el_salvador.ini
#   <host>            Required. A single host from that inventory, e.g. el-salvador-01
#   [vault_id]        Optional. Passed through as --vault-id to every ansible call.
#   [become_password] Optional. Written to a temporary 0600 file passed as
#                     --become-password-file to every ansible call (ansible has
#                     no --become-password flag). The file is removed on exit.
#                     Needed when the target's sudo is not passwordless.
#
# Both the inventory and the host must be given explicitly: the script never
# guesses a target, and it never falls back to a hardcoded host. Run it against
# a real deploy node (or any host Ansible can reach) - it writes to that host's
# config_dir, and it restores everything it changes, including on failure.
#
# NOT run by CI. This needs a live Ansible target host.
#
# Grounded in:
#   deploy/ansible/group_vars/all.yml:9          deploy_dir: /opt/genieai
#   deploy/ansible/group_vars/all.yml:22         config_dir: "{{ deploy_dir }}/config"
#   deploy/ansible/roles/config_bootstrap/defaults/main.yml:26-33
#                                               config_bootstrap_pairs (dest_subdir)
#   deploy/ansible/roles/config_bootstrap/tasks/main.yml:92-94
#                                               rsync_opts: --ignore-existing
#   deploy/ansible/deploy.yml:418-423            play tags [config, deploy]
#   deploy/ansible/templates/env.j2:412-413      CONFIG_DIR_FRONTEND / CONFIG_DIR_KEYCLOAK
#   docker-compose.yaml:402                      /config  <- ${CONFIG_DIR_FRONTEND}:ro
#   docker-compose.yaml:1616                     themes   <- ${CONFIG_DIR_KEYCLOAK}:ro
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
  test_idempotence.sh <inventory_file> <host> [vault_id] [become_password]

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

[ -n "$INVENTORY" ] || die "inventory file must not be empty."
[ -n "$HOST" ] || die "host must not be empty."
[ -f "$INVENTORY" ] || die "inventory file not found: $INVENTORY"

readonly INVENTORY HOST VAULT_ID BECOME_PASSWORD

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
    ansible_run -i "$INVENTORY" deploy.yml \
        --tags "$ROLE_TAG" \
        --limit "$HOST" \
        --become
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
EXPECTED_PATH=""
RESTORE_ARMED="false"

restore() {
    local exit_code="$?"
    # Runs on every exit (armed or not): scrub the become-password file first.
    if [ -n "${BECOME_PW_FILE:-}" ] && [ -f "$BECOME_PW_FILE" ]; then
        rm -f "$BECOME_PW_FILE"
    fi
    [ "$RESTORE_ARMED" = "true" ] || return "$exit_code"
    RESTORE_ARMED="false"
    if [ -n "$EXPECTED_PATH" ]; then
        ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "rm -f '$EXPECTED_PATH'" >/dev/null 2>&1 || true
        EXPECTED_PATH=""
    fi
    printf '\n=== Cleanup: restoring %s ===\n' "$THEME_CSS"
    if [ -n "$BACKUP_PATH" ] &&
        ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
            -a "test -f '$BACKUP_PATH'" >/dev/null 2>&1; then
        if ansible_run raw -i "$INVENTORY" "$HOST" -b -m copy \
            -a "src=$BACKUP_PATH dest=$THEME_CSS remote_src=true" >/dev/null 2>&1; then
            ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
                -a "rm -f '$BACKUP_PATH'" >/dev/null 2>&1 || true
            printf '  [ok] %s restored from pre-test backup; backup removed.\n' "$THEME_CSS"
            return "$exit_code"
        fi
    fi
    printf '  [FAIL] automatic restore did not complete.\n' >&2
    printf '         To restore %s by hand, run on the host:\n' "$THEME_CSS" >&2
    printf '           cp %s %s && rm -f %s\n' "$BACKUP_PATH" "$THEME_CSS" "$BACKUP_PATH" >&2
    return "$exit_code"
}
trap restore EXIT INT TERM

# --- resolve paths ------------------------------------------------------------

step "Resolving runtime config paths for host $HOST"
CONFIG_DIR="$(resolve_config_dir)"
# config_dir is "{{ deploy_dir }}/config" (group_vars/all.yml:22) - normalise so
# the sub-path joins below are unambiguous whether or not it carries a slash.
CONFIG_DIR="${CONFIG_DIR%/}"
FRONTEND_DIR="${CONFIG_DIR}/frontend"
KEYCLOAK_THEME_DIR="${CONFIG_DIR}/keycloak/themes/genie"
THEME_CSS="${FRONTEND_DIR}/theme-variables.css"
printf '  config_dir           = %s\n' "$CONFIG_DIR"
printf '  frontend config dir  = %s\n' "$FRONTEND_DIR"
printf '  keycloak theme dir   = %s\n' "$KEYCLOAK_THEME_DIR"

remote_sh "test -d '$FRONTEND_DIR'" >/dev/null ||
    fail "frontend config dir is absent: $FRONTEND_DIR (run the role first?)"
remote_sh "test -d '$KEYCLOAK_THEME_DIR'" >/dev/null ||
    fail "keycloak theme dir is absent: $KEYCLOAK_THEME_DIR (run the role first?)"

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
    remote_sh "test -f '$KEYCLOAK_THEME_DIR/$sub/theme.properties'" ||
        fail "keycloak theme subtree incomplete: $sub/theme.properties missing under $KEYCLOAK_THEME_DIR"
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

# --- contract 2: operator edits survive ---------------------------------------

step "Contract 2: a manual operator edit must survive a role run"

remote_sh "test -f '$THEME_CSS'" || fail "cannot test manual-edit preservation: $THEME_CSS is missing"

BACKUP_PATH="/tmp/config_bootstrap_smoke_backup_$$.css"
remote_sh "cp -p '$THEME_CSS' '$BACKUP_PATH'" ||
    fail "could not back up $THEME_CSS to $BACKUP_PATH"
RESTORE_ARMED="true"
pass "backed up $THEME_CSS to $BACKUP_PATH"

# Append the marker as its own line rather than folding it into an existing rule:
# appending CSS to an arbitrary trailing line can change what the file means.
# The marker is a self-contained comment on its own line, and every check below
# asserts on this exact string rather than on "the last line".
remote_sh "printf '%s\\n' '$MARKER' >> '$THEME_CSS'" ||
    fail "could not append the smoke-test marker to $THEME_CSS"
pass "appended marker line to $THEME_CSS"

step "Run 3: re-run the role after a manual edit"
run_role

# The marker must still be there...
remote_sh "grep -Fq '$MARKER' '$THEME_CSS'" ||
    fail "the manual edit was clobbered: marker not found in $THEME_CSS after the role run (--ignore-existing is not doing its job)"
pass "marker still present in $THEME_CSS after the role run"

# ...and the file must equal the pre-test content plus exactly the marker line.
# This is the strict form of the contract: rsync did not rewrite a single byte.
EXPECTED_PATH="/tmp/config_bootstrap_smoke_expected_$$.css"
ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell \
    -a "cat '$BACKUP_PATH' > '$EXPECTED_PATH' && printf '%s\\n' '$MARKER' >> '$EXPECTED_PATH'" ||
    fail "could not build the expected-content file on the host"
if ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell -a "cmp -s '$EXPECTED_PATH' '$THEME_CSS'"; then
    pass "$THEME_CSS is byte-identical to (pre-test content + marker line)"
else
    fail "$THEME_CSS was rewritten by the role run - operator edits are not preserved"
fi
ansible_run raw -i "$INVENTORY" "$HOST" -b -m shell -a "rm -f '$EXPECTED_PATH'" || true

# A re-run must not have introduced or removed any file either. The edited
# stylesheet stays in the list (its name does not change), so the whole file
# list must match the one captured before the marker was appended.
FILELIST_AFTER_EDIT="$(filelist)"
if [ "$FILELIST_BEFORE" != "$FILELIST_AFTER_EDIT" ]; then
    printf '--- file list before the manual edit ---\n%s\n' "$FILELIST_BEFORE" >&2
    printf '--- file list after  the role run ---\n%s\n' "$FILELIST_AFTER_EDIT" >&2
    fail "the role run added or removed files under $CONFIG_DIR"
fi
pass "no files were added or removed under $CONFIG_DIR"

# --- cleanup (also runs via the EXIT trap) -----------------------------------

restore
trap - EXIT INT TERM

printf '\n=== ALL SMOKE TESTS PASSED ===\n'
printf 'Host:          %s\n' "$HOST"
printf 'Inventory:     %s\n' "$INVENTORY"
printf 'config_dir:    %s\n' "$CONFIG_DIR"