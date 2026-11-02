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
awk '/^    _fix_payload_data_chain: \[\]/{p=1} p{print} p && /-exec chown -R -h/{exit}' \
  "$DEPLOY" > "$TMP/vars.frag"
# vars.frag: from the chain initializer to the end of the ownership cmd
# (the whole _fix_payload_* var block, comments included).
grep -q '^    _fix_payload_data_chain: \[\]' "$TMP/vars.frag" ||
  fail "could not extract the _fix_payload_* var block from $DEPLOY"
grep -q '_fix_payload_ownership_cmd:' "$TMP/vars.frag" ||
  fail "could not extract _fix_payload_ownership_cmd from $DEPLOY"

# the chain builder lives in tasks/compute-ancestors.yml (the ONE shared
# derivation the migration's ancestor handover slices) — not in deploy.yml.
# That file is a TASKS file (tasks at 0-indent); the render playbook needs
# them at 4, so the fragment is re-indented after extraction.
awk '/- name: Build the find prune expression/{exit} /- name: Build the data-dir exclusion chain/{p=1} p{print}' \
  deploy/ansible/tasks/compute-ancestors.yml | sed 's/^/    /' > "$TMP/chain.frag"
awk '/^    - name: Define deploy files/{exit} /^    - name: Build the find prune expression/{p=1} p{print}' \
  "$DEPLOY" > "$TMP/prune.frag"
grep -q '_fix_payload_data_chain' "$TMP/chain.frag" ||
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
    # deploy_dir carries a TRAILING SLASH on purpose: if a builder ever
    # regresses to the raw var (instead of deploy_dir_resolved), the
    # rendered -path patterns embed '//' and the detection sweep below
    # goes red. The resolved var is the normalized one the builders use.
    deploy_dir: $TMP/opt/genieai/
    deploy_dir_resolved: $TMP/opt/genieai
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
# chown): data/ and secrets/ must be absent from its sweep. The rewrite
# is ASSERTED to have matched: a silent no-op would run the REAL heal
# form (whose chown fails here — rendercheck is not a host user) and the
# assertions below would pass on a command that validates nothing.
# The heal already carries -print BEFORE -exec (round-56's changed_when
# signal): replacing only the exec tail printed every target twice and
# made the diagnostic ambiguous. Replace the whole span instead.
heal_sweep = heal_s.replace("-print -exec chown -R -h rendercheck:rendercheck {} +", "-print")
if heal_sweep == heal_s:
    print("heal sweep rewrite no-op — the heal chown spelling drifted; update this assertion",
          file=sys.stderr); sys.exit(1)
r = subprocess.run(shlex.split(heal_sweep), capture_output=True, text=True)
if r.returncode != 0:
    print(f"heal sweep rc={r.returncode} stderr={r.stderr.strip()[:200]}", file=sys.stderr); sys.exit(1)
targets = [l for l in r.stdout.splitlines() if l.strip()]
if any("/data" in t or "/secrets" in t for t in targets):
    print(f"heal sweep targets pruned trees: {targets}", file=sys.stderr); sys.exit(1)
if not targets:
    print("heal sweep empty — no non-pruned targets found", file=sys.stderr); sys.exit(1)

print(f"OK: probe/heal render, tokenize ({len(shlex.split(probe_s))} argv tokens) and execute; "
      f"probe hit={hit}; heal targets={targets}")
PYEOF

# ---------------------------------------------------------------------------
# 4b. The degenerate data_dir == deploy_dir override: the chain renders
# EMPTY (the '.' spelling is skipped) and the prune-expr builder must emit
# the secrets-only prune WITHOUT a leading -o ('( -o -path …' is an
# invalid find expression — verified). The builder is the same extracted
# fragment, rendered against an explicitly-empty chain.
# ---------------------------------------------------------------------------
cat > "$TMP/degen.yml" <<YAML
- hosts: localhost
  connection: local
  gather_facts: false
  vars:
    deploy_dir: $TMP/opt/genieai/
    deploy_dir_resolved: $TMP/opt/genieai
    data_dir_resolved: $TMP/opt/genieai
    _fix_payload_data_chain: []
  tasks:
$(cat "$TMP/prune.frag")
    - name: Persist the degenerate prune expr
      ansible.builtin.copy:
        content: "{{ _fix_payload_prune_expr }}\n"
        dest: $TMP/degen-rendered.txt
YAML
ansible-playbook -i localhost, "$TMP/degen.yml" > "$TMP/degen.log" 2>&1 ||
  { tail -20 "$TMP/degen.log" >&2; fail "degenerate-shape render run failed"; }

# The escape-guard FACT renders for each misconfigured spelling (the
# round-61 stray-chown class): '/' and '.' and a deploy_dir ancestor are
# True, the supported external override and the default ./data are False.
# The guard fact is EXTRACTED from no-root-data-migration.yml verbatim
# (a copied expression would drift exactly like the command builders
# did) and rendered against each misconfigured spelling: '/' and '.'
# and a deploy_dir ancestor are True; the supported external override
# and the default ./data are False.
MIG2=deploy/ansible/tasks/no-root-data-migration.yml
awk '/^    _data_dir_escaped: >-/{p=1} p{print} p && /regex_escape/{exit}' \
  "$MIG2" > "$TMP/guard.frag"
grep -q '_data_dir_escaped' "$TMP/guard.frag" ||
  fail "could not extract the _data_dir_escaped guard fact from $MIG2"

cat > "$TMP/guard.yml" <<YAML
- hosts: localhost
  connection: local
  gather_facts: false
  vars:
    deploy_dir_resolved: /opt/genieai
$(cat "$TMP/guard.frag")
  tasks:
    - name: Render the guard fact per shape
      ansible.builtin.set_fact:
        "{{ item.name }}": "{{ _data_dir_escaped }}"
      vars:
        data_dir_resolved: "{{ item.data_dir }}"
      loop:
        - {name: _g_slash, data_dir: /}
        - {name: _g_dot, data_dir: .}
        - {name: _g_ancestor, data_dir: /opt}
        - {name: _g_external, data_dir: /srv/genieai-data}
        - {name: _g_default, data_dir: ./data}
    - name: Persist rendered guards
      ansible.builtin.copy:
        content: "{{ _g_slash }}\n{{ _g_dot }}\n{{ _g_ancestor }}\n{{ _g_external }}\n{{ _g_default }}\n"
        dest: $TMP/guards.txt
YAML
ansible-playbook -i localhost, "$TMP/guard.yml" > "$TMP/guard.log" 2>&1 ||
  { tail -20 "$TMP/guard.log" >&2; fail "guard fact render run failed"; }

python3 - "$TMP" <<'PYEOF'
import sys, os
tmp = sys.argv[1]
got = open(os.path.join(tmp, "guards.txt")).read().splitlines()
expected = ["True", "True", "True", "False", "False"]
labels = ["/", ".", "/opt (ancestor)", "/srv external", "./data default"]
for g, e, l in zip(got, expected, labels):
    if g != e:
        print(f"escape guard[{l}]: rendered {g!r}, expected {e!r}", file=sys.stderr); sys.exit(1)
print("OK: escape guard renders True for '/', '.', ancestor; False for external/default")
PYEOF

python3 - "$TMP" <<'PYEOF'
import shlex, subprocess, sys, os

tmp = sys.argv[1]
expr = open(os.path.join(tmp, "degen-rendered.txt")).read().strip()
argv = shlex.split(expr)
if "-o" in argv[:2] or not argv:
    print(f"degenerate prune expr renders a leading -o: {expr!r}", file=sys.stderr); sys.exit(1)
# the empty chain must STILL exclude database_backups: with data_dir ==
# deploy_dir the uid-1000 dump dir sits at deploy_dir depth 1, inside the
# heal's sweep — a secrets-only prune lets the heal chown -R it while the
# migration's handover flips it back (the passes would fight forever).
if not any("database_backups" in t for t in argv):
    print(f"degenerate prune expr lost the database_backups arm: {expr!r}", file=sys.stderr); sys.exit(1)
probe = f'find "{tmp}/opt/genieai" -mindepth 1 {expr} -o ( ! -uid 12345 -print -quit )'
r = subprocess.run(shlex.split(probe), capture_output=True, text=True)
if r.returncode != 0:
    print(f"degenerate-shape probe rc={r.returncode} stderr={r.stderr.strip()[:200]}", file=sys.stderr); sys.exit(1)
print(f"OK: degenerate data_dir==deploy_dir shape renders a valid database_backups+secrets prune and executes")
PYEOF

# ---------------------------------------------------------------------------
# 5. The backup-dir handover trio (tasks/no-root-data-migration.yml) and the
# data_dir_resolved formula (group_vars/all.yml) are the other #1227 command
# surfaces --syntax-check never templates. Same doctrine: extract, render,
# tokenize, execute.
# ---------------------------------------------------------------------------
MIGRATION=deploy/ansible/tasks/no-root-data-migration.yml
awk '/^    _trio_probe_cmd: >-/{p=1} p{print} p && /-exec chown -h 1000/{exit}' \
  "$MIGRATION" > "$TMP/trio.frag"
grep -q '_trio_probe_cmd' "$TMP/trio.frag" ||
  fail "could not extract _trio_probe_cmd/_trio_heal_cmd from $MIGRATION"

FORMULA_LINE=$(grep -E '^data_dir_resolved:' deploy/ansible/group_vars/all.yml) ||
  fail "could not extract data_dir_resolved formula from group_vars/all.yml"

DDEP_FORMULA_LINE=$(grep -E '^deploy_dir_resolved:' deploy/ansible/group_vars/all.yml) ||
  fail "could not extract deploy_dir_resolved formula from group_vars/all.yml"

mkdir -p "$TMP/backups/data/database_backups"
echo x > "$TMP/backups/data/database_backups/WOULD-BE-HEALED"
echo x > "$TMP/backups/data/database_backups/KEEPME"

cat > "$TMP/render2.yml" <<YAML
- hosts: localhost
  connection: local
  gather_facts: false
  vars:
    deploy_dir: $TMP/backups
    # default spelling: the formula is re-evaluated per task below with
    # task-level overrides (ansible 2.20 resolves play vars lazily and
    # trips on an undefined data_dir during task-arg finalization)
    data_dir: "./data"
    $FORMULA_LINE
    $DDEP_FORMULA_LINE
$(cat "$TMP/trio.frag")
  tasks:
    - name: Persist the trio commands
      ansible.builtin.copy:
        content: "{{ _trio_probe_cmd }}\n{{ _trio_heal_cmd }}\n"
        dest: $TMP/trio-rendered.txt
    - name: Resolve the formula for each data_dir spelling
      ansible.builtin.set_fact:
        "{{ item.name }}": "{{ data_dir_resolved }}"
      vars:
        data_dir: "{{ item.data_dir }}"
      loop:
        - {name: _resolved_relative, data_dir: "./data"}
        - {name: _resolved_absolute, data_dir: /srv/genieai-data}
        - {name: _resolved_trailing, data_dir: "/srv/genieai-data/"}
    - name: Resolve the deploy_dir formula for each spelling
      ansible.builtin.set_fact:
        "{{ item.name }}": "{{ deploy_dir_resolved }}"
      vars:
        deploy_dir: "{{ item.deploy_dir }}"
      loop:
        - {name: _dresolved_clean, deploy_dir: /opt/genieai}
        - {name: _dresolved_trailing, deploy_dir: "/opt/genieai/"}
    - name: Persist the resolved spellings
      ansible.builtin.copy:
        content: "{{ _resolved_relative }}\n{{ _resolved_absolute }}\n{{ _resolved_trailing }}\n{{ _dresolved_clean }}\n{{ _dresolved_trailing }}\n"
        dest: $TMP/resolved.txt
YAML

ansible-playbook -i localhost, "$TMP/render2.yml" > "$TMP/render2.log" 2>&1 ||
  { tail -20 "$TMP/render2.log" >&2; fail "ansible trio render run failed"; }

python3 - "$TMP" <<'PYEOF'
import shlex, subprocess, sys, os

tmp = sys.argv[1]
probe_s, heal_s = open(os.path.join(tmp, "trio-rendered.txt")).read().splitlines()[:2]
resolved = open(os.path.join(tmp, "resolved.txt")).read().splitlines()

expected = [os.path.join(tmp, "backups") + "/data", "/srv/genieai-data", "/srv/genieai-data",
            "/opt/genieai", "/opt/genieai"]
for got, want, spelling in zip(resolved, expected,
                               ("./data", "absolute", "trailing slash",
                                "deploy_dir clean", "deploy_dir trailing slash")):
    if got != want:
        print(f"formula[{spelling}]: rendered {got!r}, expected {want!r}",
              file=sys.stderr); sys.exit(1)

for label, cmd, needs in (("trio probe", probe_s, ("-H", "-uid", "1000", "-print", "-quit")),
                          ("trio heal", heal_s, ("-H", "-exec"))):
    argv = shlex.split(cmd)
    missing = [t for t in needs if t not in argv]
    if missing:
        print(f"{label}: missing expected tokens {missing}", file=sys.stderr); sys.exit(1)
    # detection: swap the uid predicate for a name one (no root needed).
    # -mindepth 1 in the SWAP keeps the starting dir out of the match the
    # real uid predicate would exclude (the fixture dirs run as uid 1000).
    detect = cmd.replace("! -uid 1000 -print -quit", "-mindepth 1 ! -name KEEPME -print -quit") \
                .replace("! -uid 1000 -print -exec", "-mindepth 1 ! -name KEEPME -print -exec")
    detect_argv = shlex.split(detect.replace("-exec chown -h 1000:1000 {} +", "-print"))
    r = subprocess.run(detect_argv, capture_output=True, text=True)
    if r.returncode != 0 or "WOULD-BE-HEALED" not in r.stdout:
        print(f"{label}: detection rc={r.returncode} out={r.stdout.strip()!r} "
              f"err={r.stderr.strip()[:120]!r}", file=sys.stderr); sys.exit(1)
    if label == "trio probe":
        hit = r.stdout.strip()

print(f"OK: trio commands and data_dir_resolved formula render, tokenize and execute "
      f"(probe hit={hit}; 5 formula spellings exact)")
PYEOF
