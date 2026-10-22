#!/usr/bin/env bash
# =============================================================================
# GENIE.AI / Asante — application user management over SSM.
#
# The deployed app (branch asante/1.0) does NOT authenticate against Keycloak.
# Logins live in the backend's own store: ArangoDB db `genie-ai`, collection
# `users`. Full explanation: docs/app-user-management.md
#
# The one rule that trips everybody up: the browser sends
# `encPassword = sha256Hex(password)` and the backend bcrypt-compares that, so
# the stored value must be bcrypt(sha256Hex(password)) — a bcrypt of the
# plaintext never authenticates. This script does that composition for you.
#
# Runs from your laptop. No SSH: everything executes on the box via SSM
# RunCommand. Nothing is installed there — the work happens inside the running
# `genieai_backend` container, which already has arangojs, bcryptjs and the
# ARANGO_* credentials in its environment.
#
# Secret handling: the password is never passed on a command line and never
# embedded in the SSM document (SendCommand parameters are recorded in
# CloudTrail and in 30 days of SSM command history). It travels as a temporary
# SSM SecureString that the instance role reads and this script always deletes.
#
# Written for bash 3.2 (the macOS default): no mapfile, no `$(cat <<EOF)` around
# text containing unbalanced parens, no GNU-only shred.
# =============================================================================
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/manage-app-user.sh <action> [options]

Actions:
  list                            Show every user (key, login, role, verified, disabled)
  add --email <addr>              Create a user and verify the login really works
  reset-password --email <addr>   Set a new password for an existing user
  disable --email <addr>          Block login (keeps the record and their data)
  enable --email <addr>           Undo disable
  delete --email <addr>           Remove the user record (destructive)

Options:
  --role <Admin|User>     Role for add (default: User). Admin is case-sensitive.
  --name "<full name>"    Display name for add (default: derived from the email)
  --generate              Generate a strong password and print it once at the end
  --password-file <path>  Read the password from a file (one trailing newline is ignored)
                          Omit both and you are prompted (input hidden).
  --force                 Let `add` overwrite an existing user
  --yes                   Skip the confirmation prompt (for delete / non-interactive)
  --instance <i-...>      Target instance (default: discovered by tag Name=<tag>)
  --tag <name>            Instance Name tag to discover (default: healthbot-dev-app)
  --profile <name>        AWS profile (default: healthbot-dev)
  --region <name>         AWS region (default: us-east-1)
  --account <id>          Required AWS account; aborts on mismatch (default: 310997740503)
  --ssm-prefix <path>     SSM prefix for the temp password (default: /healthbot-dev)

Examples:
  # Who exists today?
  scripts/manage-app-user.sh list

  # New admin, password generated for you and printed once
  scripts/manage-app-user.sh add --email jane@example.edu --role Admin --generate

  # New admin, password typed at a hidden prompt
  scripts/manage-app-user.sh add --email jane@example.edu --role Admin --name "Jane Doe"

  # Rotate someone's password
  scripts/manage-app-user.sh reset-password --email jane@example.edu --generate

  # Offboard
  scripts/manage-app-user.sh disable --email jane@example.edu

Notes:
  - add / reset-password end with a real POST /api/auth/login, and for Admins a
    call to the admin-gated GET /api/admin/system-health. If those do not pass,
    the script fails — so a green run means the account genuinely works.
  - There is deliberately no --password flag: it would leak into shell history
    and the process list. Use --generate, --password-file, or the prompt.
  - The account guard is not optional. It exists because this account also holds
    an unrelated instance; discovery is by Name tag so the wrong box cannot be hit.
EOF
}

# --- defaults (all overridable by flag) --------------------------------------
ACTION=""
EMAIL=""
ROLE="User"
FULLNAME=""
GENERATE=0
PASSWORD_FILE=""
FORCE=0
ASSUME_YES=0
INSTANCE=""
INSTANCE_TAG="healthbot-dev-app"
PROFILE="healthbot-dev"
REGION="us-east-1"
EXPECTED_ACCOUNT="310997740503"
SSM_PREFIX="/healthbot-dev"

die() { echo "ERROR: $*" >&2; exit 1; }

# Best-effort secure delete: shred on Linux, rm -P on macOS, plain rm otherwise.
secure_rm() {
  for f in "$@"; do
    [ -f "$f" ] || continue
    if command -v shred >/dev/null 2>&1; then shred -uz "$f" 2>/dev/null && continue; fi
    rm -Pf "$f" 2>/dev/null || rm -f "$f" 2>/dev/null || true
  done
}

case "${1:-}" in
  -h|--help|"") usage; exit 0 ;;
  list|add|reset-password|disable|enable|delete) ACTION="$1"; shift ;;
  *) usage; die "unknown action '${1}'" ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --email)         EMAIL="${2:-}"; shift 2 ;;
    --role)          ROLE="${2:-}"; shift 2 ;;
    --name)          FULLNAME="${2:-}"; shift 2 ;;
    --generate)      GENERATE=1; shift ;;
    --password-file) PASSWORD_FILE="${2:-}"; shift 2 ;;
    --force)         FORCE=1; shift ;;
    --yes|-y)        ASSUME_YES=1; shift ;;
    --instance)      INSTANCE="${2:-}"; shift 2 ;;
    --tag)           INSTANCE_TAG="${2:-}"; shift 2 ;;
    --profile)       PROFILE="${2:-}"; shift 2 ;;
    --region)        REGION="${2:-}"; shift 2 ;;
    --account)       EXPECTED_ACCOUNT="${2:-}"; shift 2 ;;
    --ssm-prefix)    SSM_PREFIX="${2:-}"; shift 2 ;;
    -h|--help)       usage; exit 0 ;;
    *)               usage; die "unknown option '$1'" ;;
  esac
done

export AWS_PROFILE="$PROFILE"
export AWS_REGION="$REGION"

for t in aws jq python3 openssl; do
  command -v "$t" >/dev/null || die "$t is required but not installed"
done

case "$ACTION" in
  list) ;;
  *) [ -n "$EMAIL" ] || die "$ACTION requires --email" ;;
esac

NEEDS_PASSWORD=0
case "$ACTION" in add|reset-password) NEEDS_PASSWORD=1 ;; esac

if [ "$ACTION" = "add" ] && [ "$ROLE" != "Admin" ] && [ "$ROLE" != "User" ]; then
  die "--role must be exactly 'Admin' or 'User' (the backend compares case-sensitively)"
fi

# --- guard: right account, right box ----------------------------------------
ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) \
  || die "no working AWS credentials for profile '$PROFILE' (try: aws sts get-caller-identity --profile $PROFILE)"
[ "$ACCOUNT" = "$EXPECTED_ACCOUNT" ] \
  || die "wrong AWS account: got $ACCOUNT, expected $EXPECTED_ACCOUNT (use --account to override deliberately)"

if [ -z "$INSTANCE" ]; then
  # Discover by Name tag rather than hardcoding: the GPU box is replaced on AMI
  # upgrades, and this account holds unrelated instances we must never touch.
  FOUND=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$INSTANCE_TAG" "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null | tr '\t' '\n' | sed '/^$/d')
  COUNT=$(printf '%s\n' "$FOUND" | sed '/^$/d' | wc -l | tr -d ' ')
  [ "$COUNT" = "1" ] \
    || die "expected exactly 1 running instance tagged '$INSTANCE_TAG', found $COUNT: ${FOUND:-none}. Pass --instance explicitly."
  INSTANCE="$FOUND"
fi

echo "account : $ACCOUNT  (profile $PROFILE, region $REGION)"
echo "instance: $INSTANCE  (tag $INSTANCE_TAG)"
if [ "$ACTION" = "add" ]; then
  echo "action  : $ACTION $EMAIL (role $ROLE)"
elif [ -n "$EMAIL" ]; then
  echo "action  : $ACTION $EMAIL"
else
  echo "action  : $ACTION"
fi

if [ "$ACTION" != "list" ] && [ "$ASSUME_YES" -ne 1 ]; then
  printf 'Proceed? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "aborted."; exit 0 ;; esac
fi

# --- workspace + guaranteed cleanup -----------------------------------------
WORK=$(mktemp -d "${TMPDIR:-/tmp}/genie-user.XXXXXX")
chmod 700 "$WORK"
PARAM=""
CLEANED=0
cleanup() {
  # Idempotent: INT/TERM fire this and then EXIT fires it again.
  [ "$CLEANED" -eq 1 ] && return 0
  CLEANED=1
  if [ -n "$PARAM" ]; then
    if aws ssm delete-parameter --name "$PARAM" >/dev/null 2>&1; then
      echo "cleanup: deleted temp SSM parameter $PARAM"
    else
      echo "cleanup: WARNING could not delete $PARAM — remove it by hand" >&2
    fi
  fi
  secure_rm "$WORK"/*
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# --- password acquisition (never via argv) ----------------------------------
GENERATED=""
if [ "$NEEDS_PASSWORD" -eq 1 ]; then
  if [ "$GENERATE" -eq 1 ]; then
    GENERATED=$(openssl rand -base64 18 | tr -d '\n')
    printf '%s' "$GENERATED" > "$WORK/pw"
  elif [ -n "$PASSWORD_FILE" ]; then
    [ -f "$PASSWORD_FILE" ] || die "password file not found: $PASSWORD_FILE"
    python3 -c 'import sys;d=open(sys.argv[1],"rb").read();sys.stdout.buffer.write(d[:-1] if d.endswith(b"\n") else d)' \
      "$PASSWORD_FILE" > "$WORK/pw"
  else
    printf 'Password for %s (hidden): ' "$EMAIL" >&2
    read -rs pw1; echo >&2
    printf 'Confirm: ' >&2
    read -rs pw2; echo >&2
    [ "$pw1" = "$pw2" ] || die "passwords do not match"
    [ -n "$pw1" ] || die "empty password"
    printf '%s' "$pw1" > "$WORK/pw"
    unset pw1 pw2
  fi
  [ -s "$WORK/pw" ] || die "empty password"

  PARAM="${SSM_PREFIX}/tmp-user-init-$$"
  jq -n --rawfile v "$WORK/pw" --arg n "$PARAM" \
    '{Name:$n,Value:$v,Type:"SecureString",Overwrite:true,Description:"TEMPORARY user bootstrap password - safe to delete"}' \
    > "$WORK/put.json"
  aws ssm put-parameter --cli-input-json "file://$WORK/put.json" >/dev/null
  echo "staged password as $PARAM (SecureString, deleted when this script exits)"
fi

# --- remote payload ----------------------------------------------------------
# Written to a file rather than captured with $(cat <<EOF): bash 3.2 mis-parses
# command substitution around heredocs containing unbalanced parens.
cat > "$WORK/remote.sh" <<'REMOTE_EOF'
set -u
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

D=$(mktemp -d /dev/shm/genie-user.XXXXXX); chmod 700 "$D"
cleanup_remote() { find "$D" -type f -exec shred -uz {} \; 2>/dev/null; rm -rf "$D"; }
trap cleanup_remote EXIT

CID=$(docker ps -q -f 'name=genieai_backend\.1')
[ -n "$CID" ] || { echo "FATAL: genieai_backend container is not running"; exit 1; }
WD=$(docker inspect "$CID" --format '{{.Config.WorkingDir}}'); WD=${WD:-/app}

# Password -> sha256 hex, which is exactly what the browser posts as encPassword.
# Doing it here means the plaintext never enters the container.
ENC=""
if [ -n "$OP_PARAM" ]; then
  aws ssm get-parameter --name "$OP_PARAM" --with-decryption --region "$OP_REGION" --output json \
    | python3 -c 'import sys,json;sys.stdout.write(json.load(sys.stdin)["Parameter"]["Value"])' > "$D/pw"
  [ -s "$D/pw" ] || { echo "FATAL: temp password parameter was empty"; exit 1; }
  printf '%s' "$(sha256sum < "$D/pw" | cut -d' ' -f1)" > "$D/enc"
  ENC=1
fi

cat > "$D/op.js" <<'JS'
const { Database } = require('arangojs');
const bcrypt = require('bcryptjs');

const action = process.env.OP_ACTION;
const email = (process.env.OP_EMAIL || '').toLowerCase();
const role = process.env.OP_ROLE || 'User';
const force = process.env.OP_FORCE === '1';
const fullName = process.env.OP_FULLNAME || email.split('@')[0];

const db = new Database({
  url: process.env.ARANGO_URL,
  databaseName: process.env.ARANGO_DB || process.env.ARANGO_DATABASE,
  auth: { username: process.env.ARANGO_USER || 'root', password: process.env.ARANGO_PASSWORD },
});
const users = db.collection('users');

const find = async () => (await (await db.query(
  `FOR u IN users FILTER LOWER(u.email) == @e OR LOWER(u.loginName) == @e RETURN u`,
  { e: email })).all());

const show = async () => {
  const rows = await (await db.query(
    `FOR u IN users SORT u.role DESC, u.loginName
       RETURN { key: u._key, login: u.loginName, email: u.email, role: u.role,
                verified: u.emailVerified, disabled: u.disabled }`)).all();
  const pad = (s, n) => String(s === null || s === undefined ? '-' : s).padEnd(n).slice(0, n);
  console.log(pad('KEY', 10) + pad('LOGIN', 34) + pad('ROLE', 8) + pad('VERIFIED', 10) + 'STATE');
  for (const r of rows) {
    console.log(pad(r.key, 10) + pad(r.login, 34) + pad(r.role, 8) +
      pad(r.verified ? 'yes' : 'NO', 10) + (r.disabled ? 'DISABLED' : 'active'));
  }
  console.log('\n' + rows.length + ' user(s). Admin routes require role exactly "Admin".');
};

(async () => {
  let enc = '';
  if (!process.stdin.isTTY) enc = require('fs').readFileSync(0, 'utf8').trim();

  if (action === 'list') return show();

  const existing = await find();
  const now = new Date().toISOString();

  if (action === 'add') {
    if (!/^[a-f0-9]{64}$/.test(enc)) throw new Error('add needs a sha256 hex digest on stdin');
    if (existing.length && !force) {
      throw new Error('user already exists (_key=' + existing[0]._key +
        '); use reset-password, or add --force to overwrite');
    }
    const encPassword = await bcrypt.hash(enc, 10);
    if (existing.length) {
      await users.update(existing[0]._key, {
        encPassword, role, emailVerified: true, disabled: false, updatedAt: now });
      console.log('updated existing user _key=' + existing[0]._key);
    } else {
      const r = await users.save({
        loginName: email,        // login resolves against loginName OR email
        email,
        encPassword,             // bcrypt(sha256Hex(password))
        role,                    // 'Admin' exactly, for admin routes
        emailVerified: true,     // login is refused when this is falsy
        disabled: false,
        createdAt: now,
        updatedAt: now,
        personalIdentification: { fullName, dob: '', gender: '', nationality: '', maritalStatus: '' },
      }, { returnNew: true });
      console.log('created user _key=' + r._key);
    }
  } else if (action === 'reset-password') {
    if (!existing.length) throw new Error('no such user: ' + email);
    if (!/^[a-f0-9]{64}$/.test(enc)) throw new Error('reset-password needs a sha256 hex digest on stdin');
    await users.update(existing[0]._key, { encPassword: await bcrypt.hash(enc, 10), updatedAt: now });
    console.log('password reset for _key=' + existing[0]._key);
  } else if (action === 'disable' || action === 'enable') {
    if (!existing.length) throw new Error('no such user: ' + email);
    await users.update(existing[0]._key, { disabled: action === 'disable', updatedAt: now });
    console.log(action + 'd _key=' + existing[0]._key);
  } else if (action === 'delete') {
    if (!existing.length) throw new Error('no such user: ' + email);
    await users.remove(existing[0]._key);
    console.log('deleted _key=' + existing[0]._key + ' (conversations/sessions are left in place)');
  } else {
    throw new Error('unknown action: ' + action);
  }

  const after = await find();
  console.log('record now: ' + JSON.stringify(after.map(u => ({
    key: u._key, login: u.loginName, email: u.email, role: u.role,
    verified: u.emailVerified, disabled: u.disabled,
    pw: u.encPassword ? (u.encPassword.slice(0, 2) === '$2' ? 'bcrypt' : 'other') : 'none',
  })), null, 2));
})().catch(function (e) { console.error('FAILED: ' + e.message); process.exit(1); });
JS

docker cp "$D/op.js" "$CID:$WD/_genie-user-op.js" >/dev/null
set +e
if [ -n "$ENC" ]; then
  docker exec -i -w "$WD" \
    -e OP_ACTION="$OP_ACTION" -e OP_EMAIL="$OP_EMAIL" -e OP_ROLE="$OP_ROLE" \
    -e OP_FULLNAME="$OP_FULLNAME" -e OP_FORCE="$OP_FORCE" \
    "$CID" node ./_genie-user-op.js < "$D/enc"
else
  docker exec -w "$WD" \
    -e OP_ACTION="$OP_ACTION" -e OP_EMAIL="$OP_EMAIL" -e OP_ROLE="$OP_ROLE" \
    -e OP_FULLNAME="$OP_FULLNAME" -e OP_FORCE="$OP_FORCE" \
    "$CID" node ./_genie-user-op.js < /dev/null
fi
RC=$?
set -e
docker exec "$CID" rm -f "$WD/_genie-user-op.js"
[ $RC -eq 0 ] || { echo "FATAL: database operation failed"; exit $RC; }

# --- prove it works: real login, and the admin gate for admins ---------------
if [ "$OP_ACTION" = "add" ] || [ "$OP_ACTION" = "reset-password" ]; then
  echo
  echo "--- verifying POST /api/auth/login ---"
  python3 - "$D" "$OP_EMAIL" <<'PY'
import json, sys
d, email = sys.argv[1], sys.argv[2]
json.dump({"loginName": email, "encPassword": open(f"{d}/enc").read().strip()},
          open(f"{d}/login.json", "w"))
PY
  CODE=$(curl -sk -m 30 -X POST "https://localhost/api/auth/login" \
    -H 'Content-Type: application/json' --data "@$D/login.json" \
    -o "$D/login.out" -w '%{http_code}')
  python3 - "$D" "$CODE" "$OP_ROLE" <<'PY'
import base64, json, sys
d, code, want_role = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(f"{d}/login.out").read()
try:
    r = json.loads(raw)
except Exception:
    print("LOGIN FAILED (HTTP " + code + "): " + raw[:300]); sys.exit(1)
if not r.get("accessToken"):
    print("LOGIN FAILED (HTTP " + code + "): " + raw[:300])
    print("  'Email not verified' -> emailVerified is falsy | 'Invalid password' -> hash mismatch")
    sys.exit(1)
p = r["accessToken"].split(".")[1]
c = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
print("LOGIN OK (HTTP " + code + ") - role in JWT: " + str(c.get("role")))
if c.get("role") != want_role:
    print("  NOTE: JWT role " + repr(c.get("role")) + " differs from requested " + repr(want_role))
open(f"{d}/hdr.conf", "w").write('header = "Authorization: Bearer %s"\n' % r["accessToken"])
PY
  if [ "$OP_ROLE" = "Admin" ] && [ -f "$D/hdr.conf" ]; then
    echo "--- verifying admin gate GET /api/admin/system-health ---"
    AC=$(curl -sk -m 30 -K "$D/hdr.conf" -o /dev/null -w '%{http_code}' \
      "https://localhost/api/admin/system-health")
    if [ "$AC" = "200" ]; then
      echo "ADMIN ACCESS CONFIRMED (HTTP 200; this gate re-reads the role from the database)"
    else
      echo "ADMIN CHECK FAILED (HTTP $AC - 403 means the stored role is not exactly 'Admin')"
      exit 1
    fi
  fi
fi

echo
echo "remote work complete."
REMOTE_EOF

# Inject the operator's values as shell-quoted assignments ahead of the payload.
# The password is NOT here — only the name of the temp SSM parameter.
{
  printf 'OP_ACTION=%q\n' "$ACTION"
  printf 'OP_EMAIL=%q\n' "$EMAIL"
  printf 'OP_ROLE=%q\n' "$ROLE"
  printf 'OP_FULLNAME=%q\n' "$FULLNAME"
  printf 'OP_FORCE=%q\n' "$FORCE"
  printf 'OP_PARAM=%q\n' "$PARAM"
  printf 'OP_REGION=%q\n' "$REGION"
  cat "$WORK/remote.sh"
} > "$WORK/payload.sh"

# --- run it over SSM ---------------------------------------------------------
COMMENT="genie app user: $ACTION"
[ -n "$EMAIL" ] && COMMENT="$COMMENT $EMAIL"
jq -n --rawfile s "$WORK/payload.sh" --arg i "$INSTANCE" --arg c "$COMMENT" \
  '{InstanceIds:[$i],DocumentName:"AWS-RunShellScript",Comment:$c,Parameters:{commands:[$s]}}' \
  > "$WORK/cmd.json"

CMD_ID=$(aws ssm send-command --cli-input-json "file://$WORK/cmd.json" --query 'Command.CommandId' --output text)
echo "ssm command: $CMD_ID"

STATUS=Pending
for _ in $(seq 1 90); do
  STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in InProgress|Pending|Delayed) sleep 2 ;; *) break ;; esac
done

echo "------------------------------------------------------------------"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
  --query StandardOutputContent --output text
ERR=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" \
  --query StandardErrorContent --output text)
if [ -n "$ERR" ] && [ "$ERR" != "None" ]; then
  echo "--- stderr ---"
  printf '%s\n' "$ERR"
fi
echo "------------------------------------------------------------------"

[ "$STATUS" = "Success" ] \
  || die "SSM command finished as $STATUS — nothing verified, treat the change as incomplete"

if [ -n "$GENERATED" ]; then
  echo
  echo "Generated password for $EMAIL (shown once — copy it now):"
  echo "    $GENERATED"
  echo "Send it over a channel you trust, and have them change it after first login."
fi

if [ -n "$EMAIL" ]; then
  echo "done: $ACTION $EMAIL — verified against the running app."
else
  echo "done: $ACTION"
fi
