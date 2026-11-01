#!/usr/bin/env bash
# check-command-render.sh (#1227) — the render+tokenize gate for the deploy
# payload probe/heal command builders. `ansible-playbook --syntax-check`
# never templates set_fact values, and the command module's shlex splitting
# decides what find actually receives — so a builder that parses and even
# renders correctly can still be dead at runtime (the '(' ~ … glue bug
# shipped through a syntax-check-green pipeline). This script closes that
# class: it EXTRACTS the builders from deploy.yml (never copies them — a
# copy would drift exactly the way the original bug did), renders them
# through a real ansible run, tokenizes the output with the command
# module's own splitter, and executes the rendered find commands against a
# scratch tree to prove the prune excludes data/ and secrets/ while the
# non-pruned entries stay reachable.

set -euo pipefail
cd "$(dirname "$0")/../.." # repo root

DEPLOY=deploy/ansible/deploy.yml
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Extract the builder fragments from deploy.yml. Each awk range is
# anchored on a unique line; if a marker disappears the extraction is empty
# and the generated playbook fails to parse — a loud failure, not a silent
# pass.
# ---------------------------------------------------------------------------
awk '/^    _fix_payload_data_chain: \[\]/{p=1} p{print} p && /^      -o -exec/{exit}' \
  "$DEPLOY" > "$TMP/vars.frag"
# vars.frag: from the chain initializer to the end of the ownership cmd
# (the whole _fix_payload_* var block, comments included).
grep -q '^    _fix_payload_data_chain: \[\]' "$TMP/vars.frag" ||
  fail "could not extract the _fix_payload_* var block from $DEPLOY"
grep -q '_fix_payload_ownership_cmd:' "$TMP/vars.frag" ||
  fail "could not extract _fix_payload_ownership_cmd from $DEPLOY"

awk '/^    - name: Build the find prune expression/{exit} /^    - name: Build the data-dir exclusion chain/{p=1} p{print}' \
  "$DEPLOY" > "$TMP/chain.frag"
awk '/^    - name: Define deploy files/{exit} /^    - name: Build the find prune expression/{p=1} p{print}' \
  "$DEPLOY" > "$TMP/prune.frag"
grep -q '_fix_payload_data_chain +' "$TMP/chain.frag" ||
  fail "could not extract the chain-builder task from $DEPLOY"
grep -q '_fix_payload_prune_expr' "$TMP/prune.frag" ||
  fail "could not extract the prune-expr task from $DEPLOY"

# ---------------------------------------------------------------------------
# 2. Build the scratch tree the rendered commands will run against.
# data/ and secrets/ are the pruned trees (their contents must never be
# visited); svc/ is a normal deploy subtree whose mis-owned marker the
# probe must find.
# ---------------------------------------------------------------------------
mkdir -p "$TMP/opt/genieai/data" "$TMP/opt/genieai/secrets" "$TMP/opt/genieai/svc"
for d in data secrets svc; do echo x > "$TMP/opt/genieai/$d/WOULD-BE-HEALED"; done
echo x > "$TMP/opt/genieai/data/ok"

# ---------------------------------------------------------------------------
# 3. Render: a minimal localhost play carries the extracted fragments
# verbatim. The uid predicate is irrelevant to rendering, but the fixture
# run swaps it for a -name predicate (creating foreign-uid files needs
# root) — the probe's structure is what's under test.
# ---------------------------------------------------------------------------
cat > "$TMP/render.yml" <<YAML
- hosts: localhost
  connection: local
  gather_facts: false
  vars:
    deploy_dir: $TMP/opt/genieai
    data_dir_resolved: $TMP/opt/genieai/data
    ansible_user: rendercheck
    ansible_user_uid: "12345"
$(cat "$TMP/vars.frag")
  tasks:
$(cat "$TMP/chain.frag")
$(cat "$TMP/prune.frag")
    - name: Persist the rendered commands
      ansible.builtin.copy:
        content: "{{ _fix_payload_probe_cmd }}\n{{ _fix_payload_ownership_cmd }}\n"
        dest: $TMP/rendered.txt
YAML

ansible-playbook -i localhost, "$TMP/render.yml" > "$TMP/render.log" 2>&1 ||
  { tail -20 "$TMP/render.log" >&2; fail "ansible render run failed"; }

# ---------------------------------------------------------------------------
# 4. Tokenize + execute. The command module splits with shlex; '(' glued to
# '-path' arrives as one argv token and find dies with "paths must precede
# expression". Assert standalone parens, then run the real find: the
# pruned trees' contents stay unvisited and svc/ is reachable.
# ---------------------------------------------------------------------------
python3 - "$TMP" <<'PYEOF'
import shlex, subprocess, sys, os

tmp = sys.argv[1]
probe_s, heal_s = open(os.path.join(tmp, "rendered.txt")).read().splitlines()[:2]

for label, cmd, needs in (("probe", probe_s, ("-prune", "-print", "-quit")),
                          ("heal", heal_s, ("-prune", "-exec"))):
    argv = shlex.split(cmd)
    if "(" not in argv or ")" not in argv:
        fail = f"{label}: '(' / ')' are not standalone argv tokens — glued to a neighbor (command module will mis-split)"
        print(fail, file=sys.stderr); sys.exit(1)
    missing = [t for t in needs if t not in argv]
    if missing:
        print(f"{label}: missing expected tokens {missing}", file=sys.stderr); sys.exit(1)
    # the glued forms that killed the original command, as a direct check
    glued = [t for t in argv if t.startswith("(") and t != "(" or (t.endswith(")") and t != ")" and "-path" in t)]
    if glued:
        print(f"{label}: glued paren tokens present: {glued}", file=sys.stderr); sys.exit(1)
    # The probe runs verbatim (read-only). The heal is NOT executed as-is —
    # its -exec chown would mutate the fixture — it runs in its -print
    # sweep form below; tokenization above is what the -exec path shares.
    if label == "probe":
        r = subprocess.run(argv, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"{label}: find rc={r.returncode} stderr={r.stderr.strip()[:200]}", file=sys.stderr); sys.exit(1)

# Behavior: swap the uid predicate for a -name one (no root needed) and
# confirm the probe's first hit is NOT under data/ or secrets/ — their
# contents must stay unvisited.
probe_detect = probe_s.replace("! -uid 12345 -print -quit",
                               '! -path "*/WOULD-BE-HEALED*" -print -quit')
r = subprocess.run(shlex.split(probe_detect), capture_output=True, text=True)
hit = r.stdout.strip()
if not hit or "/data/" in hit or "/secrets/" in hit:
    print(f"probe detection: first hit {hit!r} — expected a non-pruned path", file=sys.stderr); sys.exit(1)

# The heal must TARGET the non-pruned depth-1 entries (print instead of
# chown): data/ and secrets/ must be absent from its sweep.
heal_sweep = heal_s.replace("-exec chown -R -h rendercheck:rendercheck {} +", "-print")
r = subprocess.run(shlex.split(heal_sweep), capture_output=True, text=True)
targets = [l for l in r.stdout.splitlines() if l.strip()]
if any("/data" in t or "/secrets" in t for t in targets):
    print(f"heal sweep targets pruned trees: {targets}", file=sys.stderr); sys.exit(1)
if not targets:
    print("heal sweep empty — no non-pruned targets found", file=sys.stderr); sys.exit(1)

print(f"OK: probe/heal render, tokenize ({len(shlex.split(probe_s))} argv tokens) and execute; "
      f"probe hit={hit}; heal targets={targets}")
PYEOF
