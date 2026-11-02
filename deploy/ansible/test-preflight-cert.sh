#!/usr/bin/env bash
# B1 — cert preflight negative-assert gate (sets the precedent for B2).
# Every failure row of the spec's I/O matrix must FAIL with the expected
# message; the clean DEC-1-shaped positives must pass. Runs entirely on
# localhost via a temp wrapper play — no target host, no vault needed.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0

# Neutral config: deploy/ansible/ansible.cfg forces become=True — wrong for a
# localhost wrapper run. Empty file = all-defaults ansible.
: > "$TMP/ansible.cfg"
export ANSIBLE_CONFIG="$TMP/ansible.cfg"

# Inventory: testhost sits in 4 groups. Sorted group_names[0] is 'aaa_other',
# so any group_names[0]-style cert path looks in the WRONG dir — resolution
# must pick agrivisory_test (the ^agrivisory rule from tasks/preflight-cert.yml).
cat > "$TMP/inventory.ini" <<'EOF'
[aaa_other]
testhost ansible_connection=local

[agrivisory_test]
testhost

[swarm_managers]
testhost

[gpu_nodes]
testhost
EOF

cat > "$TMP/wrapper.yml" <<EOF
---
- name: Cert preflight wrapper (test)
  hosts: testhost
  connection: local
  gather_facts: false
  tasks:
    - name: Run cert preflight
      ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight-cert.yml
EOF

# Second wrapper: host in NO ^agrivisory group -> env-group resolution must fail
cat > "$TMP/inv-nogroup.ini" <<'EOF'
[aaa_other]
solo ansible_connection=local
EOF
cat > "$TMP/wrap-nogroup.yml" <<EOF
---
- hosts: solo
  connection: local
  gather_facts: false
  tasks:
    - ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight-cert.yml
EOF

# DEC-1 shape: rtx6000 letsencrypt vars
BASE="cert_mode=letsencrypt nginx_public_domain=agriconnect.site certbot_email=***REMOVED*** certbot_replicas=1 deploy_dir=$TMP/no-certs"

stage_cert() { # <dir> <cn> — writes <dir>/server.{crt,key} with CN/SAN=<cn>
    mkdir -p "$1"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$1/server.key" -out "$1/server.crt" -subj "/CN=$2" \
        -addext "subjectAltName=DNS:$2" >/dev/null 2>&1
}

run_play_inv() { # <inventory> <playbook> <extra-vars>
    ansible-playbook -i "$1" "$2" --extra-vars "$3" >"$TMP/out" 2>&1
}

run_play() { # <extra-vars> [extra ansible-playbook args...]
    local ev="$1"; shift
    ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrapper.yml" --extra-vars "$ev" "$@" >"$TMP/out" 2>&1
}

expect_fail() { # <desc> <expected-substring> <extra-vars> [inventory] [playbook]
    local desc="$1" want="$2" ev="$3" inv="${4:-$TMP/inventory.ini}" play="${5:-$TMP/wrapper.yml}"
    if run_play_inv "$inv" "$play" "$ev"; then
        echo "FAIL(neg): $desc — playbook PASSED, expected failure"
        FAILED=1; return
    fi
    if ! grep -qF "$want" "$TMP/out"; then
        echo "FAIL(neg): $desc — expected message not found: $want"
        tail -15 "$TMP/out"; FAILED=1; return
    fi
    echo "ok(neg): $desc"
}

expect_pass() { # <desc> <extra-vars> [extra ansible-playbook args...]
    local desc="$1" ev="$2"; shift 2
    if run_play "$ev" "$@"; then
        echo "ok(pos)$([ $# -gt 0 ] && echo "[$*]"): $desc"
    else
        echo "FAIL(pos): $desc — expected pass"
        tail -15 "$TMP/out"; FAILED=1
    fi
}

# --- I/O matrix failure rows --------------------------------------------------
expect_fail "enum violation" \
    "Allowed values: letsencrypt, provided, selfsigned" \
    "cert_mode=foo deploy_dir=$TMP/no-certs"

expect_fail "host in zero ^agrivisory groups" \
    "create or rename the inventory group" \
    "cert_mode=selfsigned nginx_public_domain=localhost deploy_dir=$TMP/no-certs" \
    "$TMP/inv-nogroup.ini" "$TMP/wrap-nogroup.yml"

expect_fail "retired self_signed_certs still set" \
    "renamed to cert_mode" \
    "$BASE self_signed_certs=true"

expect_fail "letsencrypt, email missing" \
    "requires certbot_email" \
    "$BASE certbot_email="

expect_fail "letsencrypt, email=CHANGE_ME" \
    "requires certbot_email" \
    "$BASE certbot_email=CHANGE_ME"

expect_fail "letsencrypt, domain localhost" \
    "requires nginx_public_domain" \
    "$BASE nginx_public_domain=localhost"

expect_fail "letsencrypt, certbot_replicas=0" \
    "requires certbot_replicas" \
    "$BASE certbot_replicas=0"

expect_fail "provided, files missing (message names RESOLVED env-group dir)" \
    "files/certificates/agrivisory_test" \
    "cert_mode=provided nginx_public_domain=agriconnect.site deploy_dir=$TMP/no-certs"

expect_fail "selfsigned, real FQDN" \
    "selfsigned is dev-only" \
    "cert_mode=selfsigned nginx_public_domain=agriconnect.site deploy_dir=$TMP/no-certs"

stage_cert "$TMP/stale/secrets/ssl" old.example.com
expect_fail "stale staged cert (any mode)" \
    "or update nginx_public_domain" \
    "$BASE deploy_dir=$TMP/stale"

stage_cert "$TMP/super/secrets/ssl" agriconnect.site.evil.com
expect_fail "staged superstring-domain cert (agriconnect.site.evil.com must NOT match agriconnect.site)" \
    "or update nginx_public_domain" \
    "$BASE deploy_dir=$TMP/super"

mkdir -p "$TMP/corrupt/secrets/ssl"
echo "not a certificate" > "$TMP/corrupt/secrets/ssl/server.crt"
expect_fail "corrupt staged cert" \
    "unreadable" \
    "$BASE deploy_dir=$TMP/corrupt"

expect_fail "GPU self-signed without skip-verify" \
    "requires opea_ssl_skip_verify" \
    "$BASE gpu_self_signed_certs=true gpu_node_host=gpu.example.com opea_ssl_skip_verify="

# --- positives ----------------------------------------------------------------
expect_pass "DEC-1 letsencrypt, clean (no staged certs)" "$BASE"

stage_cert "$TMP/le-staged/secrets/ssl" agriconnect.site
expect_pass "letsencrypt, matching staged cert (stale trap passes)" "$BASE deploy_dir=$TMP/le-staged"

stage_cert "$TMP/files/certificates/agrivisory_test" agriconnect.site
expect_pass "provided, files in env-group dir (group_names[0] fix: aaa_other sorts first)" \
    "cert_mode=provided nginx_public_domain=agriconnect.site deploy_dir=$TMP/no-certs"

expect_pass "selfsigned, dev localhost" \
    "cert_mode=selfsigned nginx_public_domain=localhost deploy_dir=$TMP/no-certs"

expect_pass "check-mode safe (DEC-1 vars, --check)" "$BASE" --check

# --- entrypoint gate (exec, stubbed envsubst/nginx — test-runtime-config.sh idiom) ---
ENT="$SCRIPT_DIR/../../api-gateway-solution/nginx/entrypoint.sh"

entrypoint_run() { # <mode> <domain> — exec entrypoint w/ scratch cert dir + stubs;
    #                  sets entry_rc / entry_scratch (certs in $entry_scratch/certs)
    entry_scratch="$(mktemp -d)"
    mkdir -p "$entry_scratch/certs" "$entry_scratch/ssl" "$entry_scratch/conf.d" "$entry_scratch/bin"
    : > "$entry_scratch/conf.d/default.conf.template"
    printf '#!/bin/sh\ncat\n' > "$entry_scratch/bin/envsubst"
    printf '#!/bin/sh\n[ "$1" = "-t" ] && exit 0\nexec sleep 300\n' > "$entry_scratch/bin/nginx"
    chmod +x "$entry_scratch/bin/envsubst" "$entry_scratch/bin/nginx"
    sed -e "s|CERT_PATH=\"/etc/nginx/certs\"|CERT_PATH=\"$entry_scratch/certs\"|" \
        -e "s|VOLUME_CERT_PATH=\"/etc/nginx/ssl\"|VOLUME_CERT_PATH=\"$entry_scratch/ssl\"|" \
        -e "s|/etc/nginx/conf.d/default.conf.template|$entry_scratch/conf.d/default.conf.template|" \
        -e "s|/etc/nginx/conf.d/default.conf|$entry_scratch/conf.d/default.conf|" \
        -e "s|/var/www/certbot|$entry_scratch/certbot|" \
        "$ENT" > "$entry_scratch/entry.sh"
    PATH="$entry_scratch/bin:$PATH" NGINX_CERT_MODE="$1" NGINX_PUBLIC_DOMAIN="$2" \
        sh "$entry_scratch/entry.sh" > "$entry_scratch/out" 2>&1 &
    entry_pid=$!
    for _ in $(seq 1 50); do
        kill -0 "$entry_pid" 2>/dev/null || break
        if grep -q "Starting nginx" "$entry_scratch/out" 2>/dev/null; then
            sleep 0.3
            kill -TERM "$entry_pid" 2>/dev/null # trap forwards signal -> exit 0
            break
        fi
        sleep 0.2
    done
    wait "$entry_pid"; entry_rc=$?
}

cert_field() { # <crt> <openssl-args...> — stdout of openssl or empty
    openssl x509 -in "$1" -noout "${@:2}" 2>/dev/null
}

entrypoint_run letsencrypt dev.example.com
if [ "$entry_rc" -eq 0 ] || ! grep -q "not self-signing" "$entry_scratch/out"; then
    echo "FAIL(ent): letsencrypt no-certs must exit 1 with 'not self-signing'"; FAILED=1
elif [ -e "$entry_scratch/certs/server.crt" ]; then
    echo "FAIL(ent): cert generated in letsencrypt mode"; FAILED=1
else
    echo "ok(ent): letsencrypt, no mounted certs -> rc=1, not self-signing, no cert"
fi
rm -rf "$entry_scratch"

entrypoint_run selfsigned dev.example.com
if [ "$entry_rc" -ne 0 ]; then
    echo "FAIL(ent): selfsigned must serve (rc=0)"; tail -5 "$entry_scratch/out"; FAILED=1
elif ! cert_field "$entry_scratch/certs/server.crt" -subject | grep -q "dev.example.com" \
    || ! cert_field "$entry_scratch/certs/server.crt" -ext subjectAltName | grep -q "DNS:dev.example.com"; then
    echo "FAIL(ent): selfsigned cert CN/SAN != dev.example.com"; FAILED=1
else
    echo "ok(ent): selfsigned generates CN+SAN=dev.example.com"
fi
rm -rf "$entry_scratch"

entrypoint_run selfsigned 192.0.2.10
if [ "$entry_rc" -ne 0 ] \
    || ! cert_field "$entry_scratch/certs/server.crt" -ext subjectAltName | grep -q "IP Address:192.0.2.10"; then
    echo "FAIL(ent): IPv4 domain must get IP: SAN (openssl renders it 'IP Address:')"; FAILED=1
else
    echo "ok(ent): IPv4 domain gets IP: SAN"
fi
rm -rf "$entry_scratch"

# --- play wiring pin (reverting the deploy.yml play keeps gates green otherwise) ---
# B2 retitled the play "Preflight: certificates" -> "Preflight: var coherence +
# certificates" (tasks/preflight.yml now includes preflight-cert.yml itself).
if ansible-playbook -i "$SCRIPT_DIR/inventory/rtx6000.ini" "$SCRIPT_DIR/deploy.yml" \
        --list-tasks --tags deploy 2>/dev/null | grep -q "Preflight: var coherence"; then
    echo "ok(wiring): preflight play present under --tags deploy (retitled B2 play, tags: always)"
else
    echo "FAIL(wiring): 'Preflight: var coherence' play missing under --tags deploy"
    FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
    echo "RESULT: FAILED"
    exit 1
fi
echo "RESULT: PASS — all negative cases fail loudly, all positives pass"
