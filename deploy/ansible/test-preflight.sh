#!/usr/bin/env bash
# B2 — var-coherence preflight negative gate (clones the test-preflight-cert.sh
# idiom — sibling, not merged). Every failure row of the spec's I/O matrix must
# FAIL with the expected message (var + group_vars file + value); the clean
# DEC-1-shaped positives must pass (main + gpu); every printed plan value must
# appear verbatim in the env.j2 render (render-diff); both playbooks must list
# their preflight play under --tags deploy (wiring pins). B3 adds the
# compose-resolution leg: the render (now fed by the REAL group_vars/all.yml —
# single source) is resolved through `docker compose config` (CLI-only, no
# daemon) proving one var change lands in the render AND the resolved compose;
# the admin-email equality pin (GENIE_ADMIN_EMAIL == ADMIN_BOOTSTRAP_EMAIL);
# the compose-only fallback alignment; and the GPU template render sanity.
# B5 adds the real-env-vars gate: the ACTUAL group_vars (all.yml + EACH env's
# vars.yml + stub vault) must pass preflight clean (swarm_registry_url "" per
# DEC-9), render NO registry lines with it "" (compose fallbacks own images),
# render the all.yml-homed vllm_gpu_utilization into BOTH consumers at 0.75
# (launch flag + probe env) and the resolved compose's --gpu_memory_utilization;
# a gpu-scope run against the real rtx vars; and a rename row proving the old
# wrong-named spelling is gone (word-boundary grep over deploy/ = 0).
# Runs entirely on localhost via temp wrapper plays — no target host, no vault.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILED=0

# Neutral config: deploy/ansible/ansible.cfg forces become=True — wrong for a
# localhost wrapper run. Empty file = all-defaults ansible.
: > "$TMP/ansible.cfg"
export ANSIBLE_CONFIG="$TMP/ansible.cfg"

# Same inventory shape as test-preflight-cert.sh: testhost sits in 4 groups so
# the ^agrivisory env-group resolution inside the cert include is exercised.
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

# Main wrapper: preflight include + env.j2 render (the render-diff check greps
# the plan block output against the render). B3: vars_files loads the REAL
# group_vars/all.yml so the render exercises the actual single-source block
# (models, images, TEI knobs, contextual runtime, computed browser vars) —
# extra-vars still override it for plants.
cat > "$TMP/wrapper.yml" <<EOF
---
- name: Var-coherence preflight wrapper (test)
  hosts: testhost
  connection: local
  gather_facts: false
  vars_files:
    - ${SCRIPT_DIR}/group_vars/all.yml
  tasks:
    - name: Run preflight
      ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight.yml
    - name: Render env.j2 (render-diff)
      ansible.builtin.template:
        src: ${SCRIPT_DIR}/templates/env.j2
        dest: ${TMP}/env.render
        mode: '0600'
EOF

# Render-only wrapper (override round-trip leg): same vars_files, no preflight.
cat > "$TMP/wrap-render2.yml" <<EOF
---
- name: env.j2 render-only wrapper (override round-trip test)
  hosts: testhost
  connection: local
  gather_facts: false
  vars_files:
    - ${SCRIPT_DIR}/group_vars/all.yml
  tasks:
    - name: Render env.j2 (override)
      ansible.builtin.template:
        src: ${SCRIPT_DIR}/templates/env.j2
        dest: ${TMP}/env.render2
        mode: '0600'
EOF

# GPU compose template render wrapper (B3 GPU parity sanity): renders
# docker-compose.gpu.yaml.j2 from the same single-source all.yml.
cat > "$TMP/wrap-render-gpu.yml" <<EOF
---
- name: GPU compose template render wrapper (test)
  hosts: testhost
  connection: local
  gather_facts: false
  vars_files:
    - ${SCRIPT_DIR}/group_vars/all.yml
  tasks:
    - name: Render docker-compose.gpu.yaml.j2
      ansible.builtin.template:
        src: ${SCRIPT_DIR}/templates/docker-compose.gpu.yaml.j2
        dest: ${TMP}/gpu-compose.render
        mode: '0644'
EOF

# GPU wrapper: same include, gpu scope (skips main-only rules + cert chain).
# Play name contains 'gpu' — the entry guard authorizes gpu scope only from a
# gpu-named play (ansible_play_name cannot be overridden via -e).
cat > "$TMP/wrap-gpu.yml" <<EOF
---
- name: Var-coherence preflight wrapper (gpu scope test)
  hosts: testhost
  connection: local
  gather_facts: false
  tasks:
    - name: Run preflight (gpu scope)
      ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight.yml
      vars:
        preflight_scope: gpu
EOF

# Multi-env-group wrapper: host in TWO ^agrivisory groups — cert-dir resolution
# (alphabetically first) and group_vars merge (last) would diverge.
cat > "$TMP/inv-multi.ini" <<'EOF'
[agrivisory_alpha]
multi ansible_connection=local

[agrivisory_beta]
multi
EOF
cat > "$TMP/wrap-multi.yml" <<EOF
---
- name: Var-coherence preflight wrapper (multi-group test)
  hosts: multi
  connection: local
  gather_facts: false
  tasks:
    - name: Run preflight (main scope)
      ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight.yml
EOF

# gpu_api_keys is a list of dicts — k=v extra-vars cannot carry that shape.
cat > "$TMP/gpu-keys-real.yml" <<'EOF'
gpu_api_keys:
  - { name: cli, key: real-gpu-key-123 }
EOF
cat > "$TMP/gpu-keys-changeme.yml" <<'EOF'
gpu_api_keys:
  - { name: cli, key: CHANGE_ME }
EOF
cat > "$TMP/gpu-keys-empty.yml" <<'EOF'
gpu_api_keys: []
EOF
cat > "$TMP/gpu-keys-emptykey.yml" <<'EOF'
gpu_api_keys:
  - { name: cli, key: "" }
EOF
cat > "$TMP/gpu-keys-mask.yml" <<'EOF'
gpu_api_keys:
  - { name: a, key: real-key-alpha }
  - { name: b, key: CHANGE_ME }
  - { name: c, key: real-key-gamma }
EOF
# `confirm: yes` in a YAML -e @file parses as boolean True, not "yes"
cat > "$TMP/confirm-bool.yml" <<'EOF'
confirm: yes
EOF

# BASE — full clean DEC-1-shaped set (all live vars real; local mode per DEC-9;
# empty swarm_registry_url / hugging_face_hub_token = the legal-empty shapes).
# B3: the old postgres superuser var is deleted (compose consumes the per-DB
# kong/keycloak passwords); models/images/TEI/contextual/browser vars come from
# group_vars/all.yml via the wrapper's vars_files. B4: email_from is required
# always (realm import 400s on empty sender) — set here with host/user/password
# empty, which is exactly the legal no-SMTP shape the positive rows pin.
BASE="deploy_mode=local enable_observability=0 nginx_public_domain=agriconnect.site cert_mode=letsencrypt certbot_email=***REMOVED*** certbot_replicas=1 deploy_dir=$TMP/no-certs deploy_opea=1 data_dir=./data arango_password=real-arango translation_cache_password=real-tc kong_db_password=real-kong keycloak_admin_password=real-kcadmin genie_admin_password=real-genieadmin genie_admin_email=admin@agriconnect.local keycloak_db_password=real-kcdb keycloak_proxy_client_secret=real-proxy kc_dataprep_client_secret=real-dataprep kc_mobile_client_id=agrivisory-mobile kc_mobile_redirect_scheme=agrivisory grafana_client_secret=real-grafana email_from=noreply@agriconnect.local swarm_registry_url= hugging_face_hub_token= confirm=yes"

BASE_GPU="deploy_dir=$TMP/no-certs hugging_face_hub_token=hf_real-token-123 gpu_public_domain=gpu01.example.com"

run_play() { # <playbook> <extra-vars> [extra ansible-playbook args...]
    local play="$1" ev="$2"; shift 2
    ansible-playbook -i "$TMP/inventory.ini" "$play" --extra-vars "$ev" "$@" >"$TMP/out" 2>&1
}

expect_fail() { # <desc> <playbook> <extra-vars> <substring> [<substring>...]
    local desc="$1" play="$2" ev="$3"; shift 3
    if run_play "$play" "$ev"; then
        echo "FAIL(neg): $desc — playbook PASSED, expected failure"
        FAILED=1; return
    fi
    local want
    for want in "$@"; do
        if ! grep -qF -- "$want" "$TMP/out"; then
            echo "FAIL(neg): $desc — expected message not found: $want"
            tail -15 "$TMP/out"; FAILED=1; return
        fi
    done
    echo "ok(neg): $desc"
}

expect_pass() { # <desc> <playbook> <extra-vars> [extra ansible-playbook args...]
    local desc="$1" play="$2" ev="$3"; shift 3
    if run_play "$play" "$ev" "$@"; then
        echo "ok(pos)$([ $# -gt 0 ] && echo "[$*]"): $desc"
    else
        echo "FAIL(pos): $desc — expected pass"
        tail -15 "$TMP/out"; FAILED=1
    fi
}

expect_fail_file() { # <desc> <playbook> <base-ev> <yaml-content> <substring>...
    # For plants k=v cannot express: YAML booleans/nulls/lists/whitespace.
    local desc="$1" play="$2" ev="$3" content="$4"; shift 4
    printf '%s\n' "$content" > "$TMP/plant.yml"
    if ansible-playbook -i "$TMP/inventory.ini" "$play" \
            --extra-vars "$ev" -e @"$TMP/plant.yml" >"$TMP/out" 2>&1; then
        echo "FAIL(neg): $desc — playbook PASSED, expected failure"
        FAILED=1; return
    fi
    local want
    for want in "$@"; do
        if ! grep -qF -- "$want" "$TMP/out"; then
            echo "FAIL(neg): $desc — expected message not found: $want"
            tail -15 "$TMP/out"; FAILED=1; return
        fi
    done
    echo "ok(neg): $desc"
}

# --- main-scope negatives (I/O matrix rows) -------------------------------------
expect_fail "required var = CHANGE_ME (names var + file + value)" "$TMP/wrapper.yml" \
    "$BASE arango_password=CHANGE_ME" "arango_password" "= CHANGE_ME" "vault.yml"

expect_fail "hugging_face_hub_token = CHANGE_ME (placeholder shape — always fails)" "$TMP/wrapper.yml" \
    "$BASE hugging_face_hub_token=CHANGE_ME" "hugging_face_hub_token" "CHANGE_ME"

expect_fail "EMAIL_* = CHANGE_ME (host/user/password may be empty; CHANGE_ME never)" "$TMP/wrapper.yml" \
    "$BASE email_password=CHANGE_ME" "email_password" "CHANGE_ME"

# B4: live-verified — empty EMAIL_FROM hard-fails the keycloak-config realm
# import (HTTP 400 "Invalid sender address 'null'", every attempt), so the
# sweep classifies email_from required-always, not empty-ok.
expect_fail "email_from empty (required always — realm import 400s on empty sender)" "$TMP/wrapper.yml" \
    "$BASE email_from=" "email_from" "Invalid sender address"

expect_fail "deploy_mode typo (matches neither branch today)" "$TMP/wrapper.yml" \
    "$BASE deploy_mode=Local" "must be 'local' or 'swarm'"

expect_fail "enable_observability enum violation" "$TMP/wrapper.yml" \
    "$BASE enable_observability=2" "must be '0' or '1'"

expect_fail "observability=1 + CHANGE_ME grafana secret" "$TMP/wrapper.yml" \
    "$BASE enable_observability=1 grafana_admin_password=CHANGE_ME" "grafana_admin_password" "CHANGE_ME"

expect_fail "swarm mode, repo_url empty" "$TMP/wrapper.yml" \
    "$BASE deploy_mode=swarm repo_url=" "repo_url"

expect_fail "swarm mode, registry token missing" "$TMP/wrapper.yml" \
    "$BASE deploy_mode=swarm repo_url=https://gitlab.example.com/group/repo.git registry_deploy_token_user=deploy-user registry_deploy_token=" \
    "registry_deploy_token"

expect_fail "swarm mode, swarm_registry_url empty (docker-login target — fails late there)" "$TMP/wrapper.yml" \
    "$BASE deploy_mode=swarm repo_url=https://gitlab.example.com/group/repo.git registry_deploy_token_user=deploy-user registry_deploy_token=real-token swarm_registry_url=" \
    "swarm_registry_url"

expect_fail "local mode, swarm_registry_url=CHANGE_ME (audit #3 shape)" "$TMP/wrapper.yml" \
    "$BASE swarm_registry_url=CHANGE_ME" "swarm_registry_url" 'never CHANGE_ME'

expect_fail "grafana_client_secret empty with observability=0 still fails (always-required — env.j2 emits it unconditionally)" "$TMP/wrapper.yml" \
    "$BASE grafana_client_secret=" "grafana_client_secret" "empty"

expect_fail "required var entirely undefined ((undefined) branch)" "$TMP/wrapper.yml" \
    "${BASE/kong_db_password=real-kong /}" "kong_db_password" "(undefined)"

expect_fail "vllm_api_key = CHANGE_ME (empty-ok class, placeholder never passes)" "$TMP/wrapper.yml" \
    "$BASE vllm_api_key=CHANGE_ME" "vllm_api_key" "CHANGE_ME"

# K.1: corrupt committed seed fails the seed-coherence task. The wrapper sits
# TWO directory levels under a planted configs/ tree so the task's fileglob
# guard resolves inside $TMP (the task genuinely runs — the default $TMP
# wrappers skip it: no configs/ beside them).
mkdir -p "$TMP/planted/configs/pipeline" "$TMP/planted/lvl1/lvl2"
printf '{ "version": 1, "oops": ' > "$TMP/planted/configs/pipeline/llm-settings.seed.json"
cat > "$TMP/planted/lvl1/lvl2/wrapper.yml" <<EOF
---
- name: K.1 corrupt-seed wrapper (test)
  hosts: testhost
  connection: local
  gather_facts: false
  tasks:
    - name: Run preflight
      ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight.yml
EOF
expect_fail "corrupt pipeline-settings seed (K.1 seed coherence fails loud)" \
    "$TMP/planted/lvl1/lvl2/wrapper.yml" "$BASE" \
    "llm-settings.seed.json" "from_json"

# --- red-team hardening rows -----------------------------------------------------
expect_fail "entry guard: -e preflight_offenders=[] cannot kill the sweep" "$TMP/wrapper.yml" \
    "$BASE arango_password=CHANGE_ME preflight_offenders=[]" "reserved preflight internal var"

expect_fail "entry guard: -e preflight_scope=gpu cannot skip the main sweep" "$TMP/wrapper.yml" \
    "$BASE arango_password=CHANGE_ME preflight_scope=gpu" "reserved preflight internal var"

expect_fail_file "wrong type: nginx_public_domain boolean" "$TMP/wrapper.yml" "$BASE" \
    "nginx_public_domain: true" "nginx_public_domain" "wrong type"

expect_fail_file "wrong type: nginx_public_domain list" "$TMP/wrapper.yml" "$BASE" \
    "nginx_public_domain:
  - agriconnect.site" "nginx_public_domain" "wrong type"

expect_fail_file "wrong type: keycloak_admin_password YAML yes (bool)" "$TMP/wrapper.yml" "$BASE" \
    "keycloak_admin_password: yes" "keycloak_admin_password" "wrong type"

expect_fail "placeholder synonym: entire value TODO" "$TMP/wrapper.yml" \
    "$BASE genie_admin_password=TODO" "genie_admin_password" "TODO"

expect_fail "placeholder synonym: entire value your@email" "$TMP/wrapper.yml" \
    "$BASE genie_admin_email=your@email" "genie_admin_email" "your@email"

expect_fail "placeholder synonym: nginx_public_domain example.com (any depth)" "$TMP/wrapper.yml" \
    "$BASE nginx_public_domain=example.com" "nginx_public_domain" "example.com"

expect_fail_file "certbot_email whitespace-only (B1 assert, trimmed length)" "$TMP/wrapper.yml" "$BASE" \
    "certbot_email: '   '" "requires certbot_email"

expect_fail "EMAIL_* coherence: email_password set without email_host" "$TMP/wrapper.yml" \
    "$BASE email_password=real-smtp-pass" "email_host" "email_password"

expect_fail_file "separator widening: 'CHANGE ME' with a space" "$TMP/wrapper.yml" "$BASE" \
    "arango_password: 'CHANGE ME'" "arango_password" "CHANGE ME"

expect_fail "gpu reject list: uppercase GPU.EXAMPLE.COM" "$TMP/wrap-gpu.yml" \
    "$BASE_GPU gpu_public_domain=GPU.EXAMPLE.COM" "gpu_public_domain" "GPU.EXAMPLE.COM"

expect_fail_file "gpu reject list: leading-whitespace ' gpu.example.com'" "$TMP/wrap-gpu.yml" "$BASE_GPU" \
    "gpu_public_domain: ' gpu.example.com'" "gpu_public_domain"

expect_fail_file "gpu member shape: bare string entry is not a mapping" "$TMP/wrap-gpu.yml" "$BASE_GPU" \
    "gpu_api_keys:
  - plain-string-key" "gpu_api_keys" "entry 1 is not a mapping"

expect_fail_file "gpu member shape: int key (12345) is wrong type" "$TMP/wrap-gpu.yml" "$BASE_GPU" \
    "gpu_api_keys:
  - { name: cli, key: 12345 }" "gpu_api_keys" "not a string"

# multi-^agrivisory-group divergence: cert dir would resolve from the first
# env group while group_vars merge from the last — must fail, not guess
if ansible-playbook -i "$TMP/inv-multi.ini" "$TMP/wrap-multi.yml" \
        --extra-vars "$BASE" >"$TMP/out" 2>&1; then
    echo "FAIL(neg): host in two ^agrivisory groups — PASSED, expected failure"
    FAILED=1
elif grep -qF "one env group per host" "$TMP/out" && grep -qF "agrivisory_alpha" "$TMP/out" && grep -qF "agrivisory_beta" "$TMP/out"; then
    echo "ok(neg): host in two ^agrivisory groups fails naming both"
else
    echo "FAIL(neg): host in two ^agrivisory groups — message not found"
    tail -15 "$TMP/out"; FAILED=1
fi

# null-typed required var (YAML `arango_password: null` — None | string is "None",
# length 4, so it used to slip the sweep and die only at the late deploy-tag backstop)
cat > "$TMP/null-var.yml" <<'EOF'
arango_password: null
EOF
if ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrapper.yml" \
        --extra-vars "$BASE" -e @"$TMP/null-var.yml" >"$TMP/out" 2>&1; then
    echo "FAIL(neg): null-typed required var — PASSED, expected failure"
    FAILED=1
elif grep -qF "arango_password" "$TMP/out" && grep -qF "(null)" "$TMP/out"; then
    echo "ok(neg): null-typed required var (arango_password: null)"
else
    echo "FAIL(neg): null-typed required var — message not found"
    tail -15 "$TMP/out"; FAILED=1
fi

expect_fail "confirm gate: domain != localhost without confirm=yes (shows re-run command)" "$TMP/wrapper.yml" \
    "${BASE/ confirm=yes/}" '--extra-vars "confirm=yes"'

# --- gpu-scope negatives ---------------------------------------------------------
expect_fail "gpu: placeholder-shaped default gpu_public_domain" "$TMP/wrap-gpu.yml" \
    "$BASE_GPU gpu_public_domain=gpu.example.com" "gpu_public_domain" "gpu.example.com"

expect_fail "gpu: hugging_face_hub_token = CHANGE_ME" "$TMP/wrap-gpu.yml" \
    "$BASE_GPU hugging_face_hub_token=CHANGE_ME" "hugging_face_hub_token" "CHANGE_ME"

expect_fail "gpu: gpu_api_keys undefined" "$TMP/wrap-gpu.yml" \
    "$BASE_GPU" "gpu_api_keys"

# gpu_api_keys as an empty list (and with CHANGE_ME inside the list — list
# values are string-rendered into the sweep)
if ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrap-gpu.yml" \
        --extra-vars "$BASE_GPU" -e @"$TMP/gpu-keys-empty.yml" >"$TMP/out" 2>&1; then
    echo "FAIL(neg): gpu: gpu_api_keys empty list — PASSED, expected failure"
    FAILED=1
elif grep -qF "gpu_api_keys" "$TMP/out"; then
    echo "ok(neg): gpu: gpu_api_keys empty list"
else
    echo "FAIL(neg): gpu: gpu_api_keys empty list — message not found"
    tail -15 "$TMP/out"; FAILED=1
fi

if ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrap-gpu.yml" \
        --extra-vars "$BASE_GPU" -e @"$TMP/gpu-keys-changeme.yml" >"$TMP/out" 2>&1; then
    echo "FAIL(neg): gpu: CHANGE_ME inside gpu_api_keys list — PASSED, expected failure"
    FAILED=1
elif grep -qF "gpu_api_keys" "$TMP/out" && grep -qF "CHANGE_ME" "$TMP/out"; then
    echo "ok(neg): gpu: CHANGE_ME inside gpu_api_keys list"
else
    echo "FAIL(neg): gpu: CHANGE_ME inside gpu_api_keys list — message not found"
    tail -15 "$TMP/out"; FAILED=1
fi

# empty key MEMBER (list-emptiness alone would pass it)
if ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrap-gpu.yml" \
        --extra-vars "$BASE_GPU" -e @"$TMP/gpu-keys-emptykey.yml" >"$TMP/out" 2>&1; then
    echo "FAIL(neg): gpu: empty key member — PASSED, expected failure"
    FAILED=1
elif grep -qF "gpu_api_keys" "$TMP/out" && grep -qF "entry 1 (name=cli): key=" "$TMP/out"; then
    echo "ok(neg): gpu: empty key member"
else
    echo "FAIL(neg): gpu: empty key member — message not found"
    tail -15 "$TMP/out"; FAILED=1
fi

# offending member named, siblings MASKED (no real key leaks into logs)
if ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrap-gpu.yml" \
        --extra-vars "$BASE_GPU" -e @"$TMP/gpu-keys-mask.yml" >"$TMP/out" 2>&1; then
    echo "FAIL(neg): gpu: masked member print — PASSED, expected failure"
    FAILED=1
elif ! grep -qF "entry 2 (name=b): key=CHANGE_ME" "$TMP/out" || ! grep -qF "2 other entries hidden" "$TMP/out"; then
    echo "FAIL(neg): gpu: masked member print — offender line/mask count not found"
    tail -15 "$TMP/out"; FAILED=1
elif grep -qF "real-key-alpha" "$TMP/out" || grep -qF "real-key-gamma" "$TMP/out"; then
    echo "FAIL(neg): gpu: masked member print — sibling real keys LEAKED"
    FAILED=1
else
    echo "ok(neg): gpu: offending member printed, siblings masked"
fi

# --- positives (DEC-1 clean LAST: leaves $TMP/out + env.render for render-diff) --
expect_pass "gpu clean pass" "$TMP/wrap-gpu.yml" "$BASE_GPU" -e @"$TMP/gpu-keys-real.yml"

expect_pass "clean localhost domain (no confirm needed)" "$TMP/wrapper.yml" \
    "$BASE nginx_public_domain=localhost cert_mode=selfsigned"

expect_pass "hugging_face_hub_token empty passes (non-gated models legal)" "$TMP/wrapper.yml" \
    "$BASE hugging_face_hub_token="

expect_pass "word-boundary fix: 'ExchangeMenu2024!x' is a real password, not a placeholder" "$TMP/wrapper.yml" \
    "$BASE arango_password=ExchangeMenu2024!x"

expect_pass "check-mode safe (DEC-1 vars, --check)" "$TMP/wrapper.yml" "$BASE" --check

expect_pass "confirm=true (YAML boolean) accepted as confirmation" "$TMP/wrapper.yml" \
    "${BASE/ confirm=yes/} confirm=true"

expect_pass "confirm via -e @file YAML boolean (confirm: yes parses as True)" "$TMP/wrapper.yml" \
    "${BASE/ confirm=yes/}" -e @"$TMP/confirm-bool.yml"

expect_pass "clean DEC-1 shape + confirm=yes (env.j2 rendered)" "$TMP/wrapper.yml" "$BASE"

# --- render-diff: every printed plan value appears verbatim in the env.j2 render --
render_ok=1
for val in agriconnect.site letsencrypt ibm-granite/granite-4.1-8b BAAI/bge-m3 BAAI/bge-reranker-v2-m3 auto; do
    grep -qF "$val" "$TMP/out" || { echo "FAIL(render): plan value not printed: $val"; render_ok=0; }
    grep -qF "$val" "$TMP/env.render" || { echo "FAIL(render): value not in env.j2 render: $val"; render_ok=0; }
done
# plan-only values: computed profiles + deploy_dir (not env.j2 vars — pinned on the plan side)
grep -qF "opea letsencrypt gpu-models" "$TMP/out" || { echo "FAIL(render): plan profiles line wrong/not printed"; render_ok=0; }
grep -qF "$TMP/no-certs" "$TMP/out" || { echo "FAIL(render): deploy_dir not printed in plan"; render_ok=0; }
if [ "$render_ok" -eq 1 ]; then
    echo "ok(render): plan values (domain, cert_mode, models, translation, profiles, deploy_dir) match env.j2 render/plan"
else
    FAILED=1
fi

# B3: computed browser vars are OBSERVED (re-adding an env-file hand-copy of
# these would otherwise stay green — the render would just keep using all.yml).
browser_ok=1
grep -qF 'VUE_APP_API_URL=https://agriconnect.site/api' "$TMP/env.render" \
    || { echo "FAIL(render): VUE_APP_API_URL not computed from nginx_public_domain"; browser_ok=0; }
grep -qF 'CORS_ALLOWED_ORIGINS=https://agriconnect.site,http://agriconnect.site' "$TMP/env.render" \
    || { echo "FAIL(render): CORS_ALLOWED_ORIGINS not computed from nginx_public_domain"; browser_ok=0; }
if [ "$browser_ok" -eq 1 ]; then
    echo "ok(render): browser vars computed from nginx_public_domain (api url + cors)"
else
    FAILED=1
fi

# B3 static guard: no env vars.yml may re-define the single-source set — a
# hand-copy that silently shadows all.yml is exactly the drift B3 deleted.
_ssot_files=( "$SCRIPT_DIR"/group_vars/*/vars.yml )
[ ${#_ssot_files[@]} -gt 0 ] || { echo "FAIL(ssot-guard): no group_vars/*/vars.yml found"; FAILED=1; }
if grep -Eq '^(embedding_model_id|translation_backend|vue_app_[a-z_]+|csp_[a-z_]+|cors_allowed_origins|docling_device|keycloak_realm|admin_bootstrap_email):' "${_ssot_files[@]}"; then
    echo "FAIL(ssot-guard): an env vars.yml re-defines a single-source var (see hits above) — delete the hand-copy"
    FAILED=1
else
    echo "ok(ssot-guard): no env vars.yml hand-copies of the all.yml single-source set"
fi

# --- B3: admin-email equality pin (SSOT — GENIE_ADMIN_EMAIL == ADMIN_BOOTSTRAP_EMAIL)
adm_a="$(grep '^GENIE_ADMIN_EMAIL=' "$TMP/env.render" | cut -d= -f2-)"
adm_b="$(grep '^ADMIN_BOOTSTRAP_EMAIL=' "$TMP/env.render" | cut -d= -f2-)"
if [ -n "$adm_a" ] && [ "$adm_a" = "$adm_b" ]; then
    echo "ok(admin-ssot): ADMIN_BOOTSTRAP_EMAIL derives from genie_admin_email (equal, one source)"
else
    echo "FAIL(admin-ssot): GENIE_ADMIN_EMAIL='$adm_a' != ADMIN_BOOTSTRAP_EMAIL='$adm_b' (first-admin chicken-and-egg)"
    FAILED=1
fi

# --- B3: compose-resolution leg (CLI-only, no daemon) -----------------------------
# The render above (fed by the real all.yml) is resolved through docker compose:
# proves the single-source values actually reach the resolved config, that a
# -e override lands everywhere (render AND compose), that no meta-llama remains
# in any fallback, and that a compose-only run (no .env) agrees with all.yml.
COMPOSE_FILE="$SCRIPT_DIR/../../docker-compose.yaml"
# docker CLI guard: the compose legs are CLI-only (no daemon) but still need the
# binary — skip them loudly when the controller has no docker.
HAVE_DOCKER=1
command -v docker >/dev/null 2>&1 || {
    HAVE_DOCKER=0
    echo "SKIP(compose): docker CLI not found on this controller — compose-resolution/noenv legs skipped (preflight/render/gpu-render rows unaffected)"
}
compose_resolve() { # <env-file|-> <out-file>  ("-" = no env at all)
    # stderr is CAPTURED, not discarded: interpolation warnings ("variable is
    # not set ... Defaulting to") are exactly the removed-but-still-referenced
    # signal — env-file callers fail on them via compose_stderr_clean below.
    if [ "$1" = "-" ]; then
        # Explicit EMPTY env file: docker compose otherwise auto-loads a .env
        # from the compose file's directory (an untracked local dump may sit
        # there) — this leg must prove the in-compose FALLBACKS, not that file
        # (warnings are EXPECTED there — every var is unset by design).
        : > "$TMP/empty.env"
        docker compose --env-file "$TMP/empty.env" -f "$COMPOSE_FILE" --profile opea --profile gpu-models config > "$2" 2>"$TMP/compose-stderr.txt"
    else
        docker compose --env-file "$1" -f "$COMPOSE_FILE" --profile opea --profile gpu-models config > "$2" 2>"$TMP/compose-stderr.txt"
    fi
}
compose_stderr_clean() { # any interpolation warning beyond the documented allowance fails
    # Sole allowance: GRAFANA_ADMIN_PASSWORD — env.j2 emits it only under
    # enable_observability=1, but docker compose interpolates the (inactive)
    # observability-profile services too, so an obs=0 render always warns for
    # it. Anything else means compose references a var the render no longer
    # carries (e.g. a removed emission with a lingering ${...} consumer).
    local filtered
    filtered="$(grep -v 'GRAFANA_ADMIN_PASSWORD' "$TMP/compose-stderr.txt" || true)"
    if printf '%s\n' "$filtered" | grep -qiE 'defaulting to|variable is not set'; then
        echo "FAIL(compose): unexpected interpolation warning(s) — compose references var(s) the render lacks:"
        printf '%s\n' "$filtered"
        return 1
    fi
    return 0
}
k1_service_block() { # <service> — slice one service's block out of the resolved compose
    awk -v svc="^  $1:\$" '$0 ~ /^  [a-z][a-z0-9_-]*:/ {f = ($0 ~ svc)} f' "$TMP/resolved.yaml"
}

if [ "$HAVE_DOCKER" -eq 1 ] && compose_resolve "$TMP/env.render" "$TMP/resolved.yaml"; then
    comp_ok=1
    compose_stderr_clean || comp_ok=0
    # granite reaches every consumer (vllm command x2 + textgen + dataprep + chatqna LLM_MODEL)
    [ "$(grep -c 'ibm-granite/granite-4.1-8b' "$TMP/resolved.yaml")" -ge 4 ] || { echo "FAIL(compose): granite not in all 4 consumers"; comp_ok=0; }
    # D4: chatqna must request the SAME id vLLM serves (LLM_MODEL env on the
    # chatqna service — deleting the compose line fails here; LLM_MODEL_ID
    # (textgen) is a different key and must not satisfy this grep).
    grep -Eq 'LLM_MODEL: ?.?ibm-granite/granite-4.1-8b' "$TMP/resolved.yaml" || { echo "FAIL(compose): chatqna LLM_MODEL not pinned to granite id"; comp_ok=0; }
    grep -q 'BAAI/bge-m3' "$TMP/resolved.yaml" || { echo "FAIL(compose): bge-m3 embedding missing"; comp_ok=0; }
    grep -q 'BAAI/bge-reranker-v2-m3' "$TMP/resolved.yaml" || { echo "FAIL(compose): reranker model missing"; comp_ok=0; }
    grep -q 'image: vllm/vllm-openai:v0.30.0' "$TMP/resolved.yaml" || { echo "FAIL(compose): pinned vllm image missing"; comp_ok=0; }
    grep -q -- '--max-batch-tokens 1024' "$TMP/resolved.yaml" || { echo "FAIL(compose): TEI max-batch-tokens 1024 missing"; comp_ok=0; }
    grep -q -- '--max-concurrent-requests 128' "$TMP/resolved.yaml" || { echo "FAIL(compose): TEI max-concurrent-requests 128 missing"; comp_ok=0; }
    grep -Eq 'CONTEXTUAL_RETRIEVAL_ENABLED: ?.?true' "$TMP/resolved.yaml" || { echo "FAIL(compose): contextual enabled missing"; comp_ok=0; }
    # K.7: multi-turn blend ON — reverting compose/group_vars to false fails here
    grep -Eq 'MULTI_TURN_BLEND_ENABLED: ?.?true' "$TMP/resolved.yaml" || { echo "FAIL(compose): multi-turn blend enabled missing (K.7)"; comp_ok=0; }
    # K.7b: query reformulation ON — a silent false revert un-grounds follow-up retrieval
    grep -Eq 'QUERY_REFORMULATION_ENABLED: ?.?true' "$TMP/resolved.yaml" || { echo "FAIL(compose): query reformulation enabled missing (K.7b)"; comp_ok=0; }
    grep -Eq 'CONTEXTUAL_STRATEGY: ?.?doc_level' "$TMP/resolved.yaml" || { echo "FAIL(compose): contextual strategy missing"; comp_ok=0; }
    grep -Eq 'DATAPREP_CONTEXTUAL_DOC_BUDGET: ?.?6000' "$TMP/resolved.yaml" || { echo "FAIL(compose): contextual doc budget 6000 missing"; comp_ok=0; }
    if grep -q 'meta-llama' "$TMP/resolved.yaml"; then
        echo "FAIL(compose): meta-llama still present in resolved config"; comp_ok=0
    fi
    # K.1: pipeline-settings wiring — mount on exactly backend + the 3 pipeline
    # readers + dataprep (K.2 ingest prompts), read_only on exactly the 4
    # readers, env literals on the right services (backend+chatqna both vars;
    # retriever+reranker RAG-only; dataprep LLM-only — K.2).
    k1_ro_count=0
    for s in backend reranker retriever-arango-service chatqna-xeon-backend-server dataprep-arango-service; do
        k1_service_block "$s" | grep -q 'target: /configs/pipeline$' \
            || { echo "FAIL(compose): $s missing the pipeline-settings mount (K.1/K.2)"; comp_ok=0; }
        if k1_service_block "$s" | grep -A1 'target: /configs/pipeline$' | grep -q 'read_only: true'; then
            k1_ro_count=$((k1_ro_count+1))
        fi
    done
    [ "$k1_ro_count" -eq 4 ] \
        || { echo "FAIL(compose): pipeline-settings mount read_only on $k1_ro_count services — expected exactly the 4 readers (K.1+K.2)"; comp_ok=0; }
    [ "$(grep -c 'LLM_SETTINGS_CONFIG: /configs/pipeline/llm-settings.json' "$TMP/resolved.yaml")" -eq 3 ] \
        || { echo "FAIL(compose): LLM_SETTINGS_CONFIG literal not on exactly backend+chatqna+dataprep (K.1/K.2)"; comp_ok=0; }
    [ "$(grep -c 'RAG_TUNING_CONFIG: /configs/pipeline/rag-tuning.json' "$TMP/resolved.yaml")" -eq 4 ] \
        || { echo "FAIL(compose): RAG_TUNING_CONFIG literal not on exactly the 4 wired services (K.1)"; comp_ok=0; }
    for s in backend chatqna-xeon-backend-server; do
        k1_service_block "$s" | grep -q 'LLM_SETTINGS_CONFIG: /configs/pipeline/llm-settings.json' \
            && k1_service_block "$s" | grep -q 'RAG_TUNING_CONFIG: /configs/pipeline/rag-tuning.json' \
            || { echo "FAIL(compose): $s missing one of its two pipeline-settings env literals (K.1)"; comp_ok=0; }
    done
    # K.2: dataprep reads LLM settings only (ingest prompts) — no RAG var.
    k1_service_block dataprep-arango-service | grep -q 'LLM_SETTINGS_CONFIG: /configs/pipeline/llm-settings.json' \
        || { echo "FAIL(compose): dataprep missing LLM_SETTINGS_CONFIG (K.2)"; comp_ok=0; }
    k1_service_block dataprep-arango-service | grep -q 'RAG_TUNING_CONFIG' \
        && { echo "FAIL(compose): dataprep carries RAG_TUNING_CONFIG — not a K.2 consumer"; comp_ok=0; }
    for s in retriever-arango-service reranker; do
        k1_service_block "$s" | grep -q 'LLM_SETTINGS_CONFIG' \
            && { echo "FAIL(compose): $s must not carry LLM_SETTINGS_CONFIG (rag-only reader, K.1)"; comp_ok=0; }
    done
    [ "$comp_ok" -eq 1 ] && echo "ok(compose): resolved config carries the all.yml values (granite incl. chatqna LLM_MODEL/bge-m3/reranker/v0.30.0/TEI 1024+128/contextual), no meta-llama; K.1 pipeline-settings wiring (4 mounts, 3 ro, env literals per service)" || FAILED=1
else
    echo "FAIL(compose): docker compose config could not resolve the render"
    FAILED=1
fi

# Override round-trip: ONE var change (-e vllm_llm_model_id=…) lands in the
# render AND every resolved compose consumer — the one-place-edit proof.
if [ "$HAVE_DOCKER" -eq 1 ] \
        && ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrap-render2.yml" \
        --extra-vars "$BASE vllm_llm_model_id=Qwen/Qwen2.5-7B-Instruct" >"$TMP/out" 2>&1 \
        && compose_resolve "$TMP/env.render2" "$TMP/resolved2.yaml" \
        && compose_stderr_clean \
        && [ "$(grep -c 'Qwen/Qwen2.5-7B-Instruct' "$TMP/resolved2.yaml")" -ge 4 ] \
        && ! grep -q 'meta-llama\|granite' "$TMP/resolved2.yaml"; then
    echo "ok(compose-override): -e vllm_llm_model_id override lands in render + all resolved consumers"
else
    echo "FAIL(compose-override): single model change did not reach everywhere"
    FAILED=1
fi

# Compose-only run (no .env): fallbacks must equal the FULL all.yml single-source
# set (warnings expected here — every var unset by design; only values are pinned).
if [ "$HAVE_DOCKER" -eq 1 ] && compose_resolve - "$TMP/resolved-noenv.yaml"; then
    noenv_ok=1
    grep -q 'ibm-granite/granite-4.1-8b' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): granite fallback missing"; noenv_ok=0; }
    # DEC-25: the NLLB model must be the LIVE-stanza default (backend + chatqna),
    # not merely present via the inert OPEA services.
    [ "$(grep -c 'facebook/nllb-200-3.3B' "$TMP/resolved-noenv.yaml")" -ge 2 ] || { echo "FAIL(compose-noenv): NLLB model fallback missing at the live stanzas (backend+chatqna, DEC-25)"; noenv_ok=0; }
    grep -q 'nllb-translate:' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): nllb-translate service missing (DEC-25)"; noenv_ok=0; }
    # Honest relabel: AfriSLM now survives ONLY in the inert OPEA translation/
    # guardrail fallbacks (untouched per the F6 boundary) — this pin observes
    # exactly that, not the live translation path.
    grep -q 'qvac/TranslatePsy-AfriSLM-4B' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): AfriSLM fallback missing (inert OPEA translation/guardrail defaults — F6 boundary keeps them)"; noenv_ok=0; }
    grep -q 'BAAI/bge-m3' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): bge-m3 embedding fallback missing"; noenv_ok=0; }
    grep -q 'BAAI/bge-reranker-v2-m3' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): reranker model fallback missing"; noenv_ok=0; }
    [ "$(grep -c 'image: vllm/vllm-openai:v0.30.0' "$TMP/resolved-noenv.yaml")" -ge 1 ] || { echo "FAIL(compose-noenv): vllm image pin fallback missing"; noenv_ok=0; }
    [ "$(grep -c 'image: ghcr.io/huggingface/text-embeddings-inference:120-1.9' "$TMP/resolved-noenv.yaml")" -ge 2 ] || { echo "FAIL(compose-noenv): TEI image pin fallbacks missing (x2)"; noenv_ok=0; }
    grep -q -- '--max-batch-tokens 1024' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): TEI max-batch-tokens 1024 fallback missing"; noenv_ok=0; }
    grep -q -- '--max-concurrent-requests 128' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): TEI max-concurrent-requests 128 fallback missing"; noenv_ok=0; }
    grep -Eq 'CONTEXTUAL_RETRIEVAL_ENABLED: ?.?true' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): contextual enabled fallback missing"; noenv_ok=0; }
    grep -Eq 'MULTI_TURN_BLEND_ENABLED: ?.?true' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): multi-turn blend enabled fallback missing (K.7)"; noenv_ok=0; }
    grep -Eq 'QUERY_REFORMULATION_ENABLED: ?.?true' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): query reformulation enabled fallback missing (K.7b)"; noenv_ok=0; }
    grep -Eq 'CONTEXTUAL_STRATEGY: ?.?doc_level' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): contextual strategy fallback missing"; noenv_ok=0; }
    grep -Eq 'DATAPREP_CONTEXTUAL_DOC_BUDGET: ?.?6000' "$TMP/resolved-noenv.yaml" || { echo "FAIL(compose-noenv): contextual doc budget 6000 fallback missing"; noenv_ok=0; }
    grep -q 'meta-llama' "$TMP/resolved-noenv.yaml" && { echo "FAIL(compose-noenv): meta-llama still in fallbacks"; noenv_ok=0; }
    [ "$noenv_ok" -eq 1 ] && echo "ok(compose-noenv): compose-only fallbacks = full all.yml set (models incl. DEC-25 NLLB at live stanzas + nllb-translate service, image pins, TEI 1024/128, contextual trio)" || FAILED=1
else
    [ "$HAVE_DOCKER" -eq 1 ] && { echo "FAIL(compose-noenv): docker compose config failed on the no-env resolve"; FAILED=1; }
fi

# GPU template render sanity: TEI knobs + images now var-fed from all.yml.
if ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrap-render-gpu.yml" \
        --extra-vars "hugging_face_hub_token=hf_real-token-123 gpu_public_domain=gpu01.example.com" >"$TMP/out" 2>&1 \
        && grep -q -- '--max-concurrent-requests 128' "$TMP/gpu-compose.render" \
        && grep -q -- '--max-batch-tokens 1024' "$TMP/gpu-compose.render" \
        && grep -q 'image: vllm/vllm-openai:v0.30.0' "$TMP/gpu-compose.render" \
        && grep -q 'ibm-granite/granite-4.1-8b' "$TMP/gpu-compose.render" \
        && grep -q 'BAAI/bge-m3' "$TMP/gpu-compose.render"; then
    echo "ok(gpu-render): GPU template renders all.yml values (TEI 1024/128, pinned images, granite/bge-m3)"
else
    echo "FAIL(gpu-render): GPU template render missing all.yml-fed values"
    tail -15 "$TMP/out"; FAILED=1
fi

# --- B5: real-env-vars gate (each remaining env dir + gpu scope, actual group_vars) ----
# Loads the REAL all.yml + each env's REAL vars.yml: B2's manual wrapper run
# tripped ONLY swarm_registry_url = CHANGE_ME (audit #3); B5 sets "" (DEC-9
# local mode), so the expected state is now a CLEAN pass per env — a regression
# back to a placeholder in ANY live vars file fails here. The stub vault
# (example.com identities — any valid address passes per B4; no production-look
# identities in committed tests) overrides the placeholder envs' CHANGE_ME
# secrets (vars_files: later file wins). Pins per env: no GENIE_AI_REGISTRY=
# emission and no leading-slash image refs (B5 gating: a defined-but-empty
# registry used to beat default() and emit invalid /genie-ai-* names), and the
# rename's TWO consumers at 0.75 (VLLM_GPU_UTILIZATION launch flag +
# VLLM_GPU_UTIL probe env — both homed in all.yml since B5).
cat > "$TMP/stub-vault.yml" <<'EOF'
# stub vault (test-only real-looking values — never real secrets)
arango_password: real-arango
translation_cache_password: real-tc
kong_db_password: real-kong
keycloak_admin_password: real-kcadmin
genie_admin_password: real-genieadmin
genie_admin_email: admin@example.com
keycloak_db_password: real-kcdb
keycloak_proxy_client_secret: real-proxy
kc_dataprep_client_secret: real-dataprep
grafana_client_secret: real-grafana
grafana_admin_password: real-grafana-admin
hugging_face_hub_token: hf_real-token-123
email_from: noreply@example.com
EOF
# no --check on these runs: the render tasks must produce the render files for
# the pins below (preflight itself is check-safe; dests are throwaway $TMP).
real_ok=1
for env in agrivisory_rtx6000; do
    cat > "$TMP/wrap-real-$env.yml" <<EOF
---
- name: Var-coherence preflight wrapper (real $env vars test)
  hosts: testhost
  connection: local
  gather_facts: false
  vars_files:
    - ${SCRIPT_DIR}/group_vars/all.yml
    - ${SCRIPT_DIR}/group_vars/$env/vars.yml
    - ${TMP}/stub-vault.yml
  tasks:
    - name: Run preflight (real $env vars + stub vault)
      ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight.yml
    - name: Render env.j2 (real $env vars)
      ansible.builtin.template:
        src: ${SCRIPT_DIR}/templates/env.j2
        dest: ${TMP}/env.real-$env
        mode: '0600'
    - name: Render docker-compose.gpu.yaml.j2 (real $env vars)
      ansible.builtin.template:
        src: ${SCRIPT_DIR}/templates/docker-compose.gpu.yaml.j2
        dest: ${TMP}/gpu-compose.real-$env
        mode: '0644'
EOF
    if ansible-playbook -i "$TMP/inventory.ini" "$TMP/wrap-real-$env.yml" \
            --extra-vars "confirm=yes" >"$TMP/out" 2>&1; then
        env_ok=1
        grep -q '^GENIE_AI_REGISTRY=' "$TMP/env.real-$env" \
            && { echo "FAIL(real-vars): $env render emits GENIE_AI_REGISTRY= with swarm_registry_url \"\" (gating broken)"; env_ok=0; }
        grep -qE '^GENIE_AI_[A-Z0-9_]+_IMAGE=/' "$TMP/env.real-$env" \
            && { echo "FAIL(real-vars): $env render has leading-slash image refs (/genie-ai-* — invalid image names)"; env_ok=0; }
        grep -qF 'GENIE_AI_GLOBAL_TAG=' "$TMP/env.real-$env" \
            || { echo "FAIL(real-vars): $env render lost GENIE_AI_GLOBAL_TAG (must stay unconditional)"; env_ok=0; }
        grep -qF 'VLLM_GPU_UTILIZATION=0.50' "$TMP/env.real-$env" \
            || { echo "FAIL(real-vars): $env render missing VLLM_GPU_UTILIZATION=0.50 (all.yml SSOT home, DEC-25b)"; env_ok=0; }
        grep -qF 'VLLM_GPU_UTIL=0.50' "$TMP/env.real-$env" \
            || { echo "FAIL(real-vars): $env render missing probe env VLLM_GPU_UTIL=0.50"; env_ok=0; }
        # DEC-25 wiring: the sidecar URL + NLLB model id must reach the env render.
        grep -qF 'NLLB_TRANSLATE_URL=http://nllb-translate:9201' "$TMP/env.real-$env" \
            || { echo "FAIL(real-vars): $env render missing NLLB_TRANSLATE_URL (DEC-25 sidecar wiring)"; env_ok=0; }
        grep -qF 'VLLM_TRANSLATION_MODEL_ID=facebook/nllb-200-3.3B' "$TMP/env.real-$env" \
            || { echo "FAIL(real-vars): $env render missing the DEC-25 NLLB model id"; env_ok=0; }
        if [ "$env_ok" -eq 1 ]; then
            echo "ok(real-vars): real $env vars pass preflight clean (B2's swarm_registry_url offender gone); no empty/leading-slash registry lines; both consumers 0.50 (DEC-25b); DEC-25 NLLB wiring (model id + sidecar URL) present"
        else
            FAILED=1
        fi
    else
        echo "FAIL(real-vars): real $env vars preflight — expected clean pass"
        tail -20 "$TMP/out"; FAILED=1; real_ok=0
    fi
done
# GPU-template + resolved-compose pins (rtx6000 leg): the GPU template reads the
# ansible vars directly; docker-compose.yaml reads VLLM_GPU_UTILIZATION and
# `docker compose config` normalizes the command to a YAML LIST — the flag and
# its value are adjacent lines, so pin the pair. DEC-25b: llm slice is 0.50
# (all.yml); the gpu template's own translation 0.10 is its baked default (the
# all.yml vllm_translation_gpu_utilization var died with the local vLLM
# translation service).
if [ "$real_ok" -eq 1 ]; then
    if grep -qF -- '--gpu_memory_utilization 0.50' "$TMP/gpu-compose.real-agrivisory_rtx6000" \
            && grep -qF -- '--gpu_memory_utilization 0.10' "$TMP/gpu-compose.real-agrivisory_rtx6000"; then
        echo "ok(real-vars): GPU template renders 0.50 (llm, all.yml, DEC-25b) + 0.10 (translation, template default)"
    else
        echo "FAIL(real-vars): GPU template utilization flags wrong (expect llm 0.50 + translation 0.10)"
        FAILED=1
    fi
    if [ "$HAVE_DOCKER" -eq 1 ]; then
        if compose_resolve "$TMP/env.real-agrivisory_rtx6000" "$TMP/resolved-real.yaml" \
                && compose_stderr_clean \
                && grep -A1 -F -- '--gpu_memory_utilization' "$TMP/resolved-real.yaml" | grep -qF '"0.50"'; then
            echo "ok(real-vars): resolved compose carries --gpu_memory_utilization 0.50 (DEC-25b rebalance)"
        else
            echo "FAIL(real-vars): resolved compose missing --gpu_memory_utilization 0.50 (or resolve failed)"
            FAILED=1
        fi
    fi
fi

# B5 review: gpu-scope checks never ran against the REAL vars — same real-vars
# wrapper, gpu scope (play name carries 'gpu' for the entry guard), a real-looking
# gpu_public_domain (all.yml's gpu.example.com default is sweep-rejected) and
# gpu_api_keys from the existing real-keys file.
cat > "$TMP/wrap-real-rtx-gpu.yml" <<EOF
---
- name: Var-coherence preflight wrapper (real rtx6000 vars, gpu scope test)
  hosts: testhost
  connection: local
  gather_facts: false
  vars_files:
    - ${SCRIPT_DIR}/group_vars/all.yml
    - ${SCRIPT_DIR}/group_vars/agrivisory_rtx6000/vars.yml
    - ${TMP}/stub-vault.yml
  tasks:
    - name: Run preflight (gpu scope, real rtx6000 vars + stub vault)
      ansible.builtin.include_tasks: ${SCRIPT_DIR}/tasks/preflight.yml
      vars:
        preflight_scope: gpu
EOF
expect_pass "real rtx6000 vars, gpu scope (hf token + gpu_api_keys + gpu_public_domain clean)" \
    "$TMP/wrap-real-rtx-gpu.yml" "gpu_public_domain=gpu01.example.com" -e @"$TMP/gpu-keys-real.yml"

# B5 acceptance as a row: the old spelling must be GONE from deploy/ (==
# SCRIPT_DIR — deploy/ holds only ansible/). \b matters: the old name is a
# strict prefix of vllm_gpu_utilization; and the pattern is concatenated
# ("vllm_gpu_""util") so this file's own text cannot match itself.
old_spelling="vllm_gpu_""util"
if grep -rn -- "${old_spelling}\b" "$SCRIPT_DIR" >/dev/null 2>&1; then
    echo "FAIL(rename): old ${old_spelling} spelling still present under deploy/ (word-boundary match)"
    grep -rn -- "${old_spelling}\b" "$SCRIPT_DIR"
    FAILED=1
else
    echo "ok(rename): single spelling vllm_gpu_utilization everywhere (old-name grep with word boundary = 0)"
fi

# --- wiring pins (reverting either play keeps every other gate green) ------------
if ansible-playbook -i "$SCRIPT_DIR/inventory/rtx6000.ini" "$SCRIPT_DIR/deploy.yml" \
        --list-tasks --tags deploy 2>/dev/null | grep -q "Preflight: var coherence"; then
    echo "ok(wiring): preflight play listed under --tags deploy (deploy.yml, tags: always)"
else
    echo "FAIL(wiring): preflight play missing under --tags deploy (deploy.yml)"
    FAILED=1
fi

if ansible-playbook -i "$SCRIPT_DIR/inventory/rtx6000.ini" "$SCRIPT_DIR/deploy-gpu.yml" \
        --list-tasks --tags deploy 2>/dev/null | grep -q "Preflight (var coherence, gpu scope)"; then
    echo "ok(wiring): gpu preflight play listed under --tags deploy (deploy-gpu.yml, tags: always)"
else
    echo "FAIL(wiring): gpu preflight play missing under --tags deploy (deploy-gpu.yml)"
    FAILED=1
fi

# --- chained B1 cert gate (single entrypoint honors the README contract) ---------
echo "--- chaining test-preflight-cert.sh (B1 cert gate) ---"
if bash "$SCRIPT_DIR/test-preflight-cert.sh"; then
    echo "ok(chain): test-preflight-cert.sh exit 0"
else
    echo "FAIL(chain): test-preflight-cert.sh exited non-zero"
    FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
    echo "RESULT: FAILED"
    exit 1
fi
# C3 pin: the placeholder agrivisory env stays deleted (word-boundary; rtx6000 is the template)
if compgen -G "$SCRIPT_DIR/group_vars/agrivisory/vars.yml" > /dev/null || [ -f "$SCRIPT_DIR/inventory/agrivisory.ini" ] \
        || grep -q '^\[agrivisory\]' "$SCRIPT_DIR/inventory/inventory.example"; then
    echo "FAIL(env-deleted): placeholder agrivisory env resurrected — rtx6000 is the template (C3/S-4 line)"
    FAILED=1
else
    echo "ok(env-deleted): placeholder agrivisory env absent (rtx6000 = template)"
fi

# C1 pin: the a10 environment stays deleted (word-boundary; "a10" caught, A100/va10-style noise not)
if grep -rqE '\ba10\b' --exclude="$(basename "$0")" "$SCRIPT_DIR" 2>/dev/null; then
    echo "FAIL(a10-deleted): a10 references found in deploy/ansible — the environment is deleted (S-4); sweep them"
    grep -rnE '\ba10\b' --exclude="$(basename "$0")" "$SCRIPT_DIR" | head -5
    FAILED=1
else
    echo "ok(a10-deleted): no a10 references in deploy/ansible"
fi

echo "RESULT: PASS — negatives fail loudly; positives + render-diff + compose-resolution + admin-ssot + gpu-render + wiring pins green"
