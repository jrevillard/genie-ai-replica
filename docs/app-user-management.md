# GENIE.AI / Asante — Application User Management

Applies to: the deployed environment on branch `asante/1.0`
(https://asante.innov8ai.com, instance tagged `healthbot-dev-app`, account `310997740503`)
Tooling: [`scripts/manage-app-user.sh`](../scripts/manage-app-user.sh)
Related docs: [`keycloak-admin-guide.md`](keycloak-admin-guide.md) (the *other* user store),
[`aws-dev-deployment-status.md`](aws-dev-deployment-status.md)

---

## Read this first: there are two user stores, and only one of them logs you in

This deployment runs a healthy Keycloak container and the repository is full of
Keycloak documentation — but **the deployed app does not use Keycloak to log
users in.** Creating a Keycloak user grants no application access whatsoever.

| Branch / stack | Frontend | Where logins live | How to add a user |
|---|---|---|---|
| **`asante/1.0`** (what is deployed) | `components/genie-ai-frontend-v2/` | **ArangoDB** db `genie-ai`, collection `users` | `scripts/manage-app-user.sh` — this document |
| `release/2.0` | `components/gov-chat-frontend/` | Keycloak realm `genie` | [`keycloak-admin-guide.md`](keycloak-admin-guide.md) |

If you are unsure which applies, check which frontend the stack builds:

```bash
grep -A2 '^  frontend:' docker-compose.yaml    # build: components/genie-ai-frontend-v2/ => this document
```

## Fast path

```bash
# Add an admin; the password is generated and printed once
./scripts/manage-app-user.sh add --email jane@example.edu --role Admin --generate

# Add an admin with a password you choose (hidden prompt, asked twice)
./scripts/manage-app-user.sh add --email jane@example.edu --role Admin --name "Jane Doe"
```

The script finishes by performing a **real login** against the running app, and
for admins by calling an **admin-gated endpoint**. If either fails, the script
exits non-zero. A green run means the account genuinely works — you do not need
to check by hand.

Prerequisites: `aws`, `jq`, `python3`, `openssl` locally, and AWS credentials for
account `310997740503` (profile `healthbot-dev`). No SSH and no VPN: everything
runs through SSM RunCommand.

## All actions

```bash
./scripts/manage-app-user.sh list
./scripts/manage-app-user.sh add            --email <addr> [--role Admin|User] [--name "..."] [--generate|--password-file F] [--force]
./scripts/manage-app-user.sh reset-password --email <addr> [--generate|--password-file F]
./scripts/manage-app-user.sh disable        --email <addr>
./scripts/manage-app-user.sh enable         --email <addr>
./scripts/manage-app-user.sh delete         --email <addr>
```

`--help` lists every option, including `--instance`, `--tag`, `--profile`,
`--region`, `--account` and `--ssm-prefix` for pointing at another environment.

Notes worth knowing:

- **`--role` is case-sensitive.** Only `Admin` grants admin access; the backend
  compares against the literal string `'Admin'`.
- **`add` refuses to overwrite** an existing user. Use `reset-password`, or
  `add --force` if you really mean to reset role and password together.
- **`delete` removes only the user record.** Their conversations and sessions stay
  in the database. Prefer `disable` for offboarding — it blocks login immediately
  and is reversible.
- Users can log in with **either** their email or their `loginName`; the script
  sets both to the email, so either works.

## How the login actually works

Understanding this is what makes the difference between a working account and a
silently broken one.

| Step | Where |
|---|---|
| Browser hashes the password: `encPassword = sha256Hex(password)` | `components/genie-ai-frontend-v2/src/services/crypto.ts`, `auth.ts:56` |
| Posts `{loginName, encPassword}` to `/api/auth/login` | `auth.ts:57` |
| Backend looks the user up by `loginName` **OR** `email` | `gov-chat-backend/services/auth-service.js:189` |
| Backend `bcrypt.compare(encPassword, stored)` | `auth-service.js:874` |
| Login refused unless `emailVerified` is truthy and `disabled !== true` | `auth-service.js:193-194` |
| JWT is issued carrying `role` (defaults to `'User'`) | `auth-service.js:854` |
| Admin routes re-read the record and require `role === 'Admin'` | `middleware/auth-middleware.js:133` |
| Frontend shows admin UI when `role === 'Admin'` | `genie-ai-frontend-v2/src/stores/auth.ts:30` |

**The trap:** because the browser sends a SHA-256 digest, the stored value must be
`bcrypt(sha256Hex(password))` — a bcrypt of the *plaintext* will never
authenticate. `verifyPassword` also accepts a bare 64-character SHA-256 hex as a
legacy format, which is why some old records still work.

Because the admin gate re-reads the database on every request, a role change
takes effect on the **next request**, not the next login. Password changes and
`disable` only take effect once the current JWT expires.

### The user document

```json
{
  "loginName": "jane@example.edu",
  "email": "jane@example.edu",
  "encPassword": "$2b$10$...",
  "role": "Admin",
  "emailVerified": true,
  "disabled": false,
  "createdAt": "2026-08-17T...",
  "updatedAt": "2026-08-17T...",
  "personalIdentification": { "fullName": "Jane Doe", "dob": "", "gender": "", "nationality": "", "maritalStatus": "" }
}
```

`users` has a unique index on `loginName`. Keys are auto-assigned by ArangoDB.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Email not verified` | `emailVerified` is false — typical of self-registered users, since `register()` never verifies and SMTP may not be configured | `add --force`, or set `emailVerified: true` |
| `Invalid password` | Stored hash is not `bcrypt(sha256Hex(password))` — usually a bcrypt of the plaintext | `reset-password` |
| `User not found` | Neither `loginName` nor `email` matches what was typed | `list` and check the exact spelling |
| `This account has been disabled` | `disabled: true` | `enable --email ...` |
| Login works but no admin UI, or `403 Admin access required` | `role` is not exactly `Admin` (`null`, `"admin"`, `"User"`) | `add --force --role Admin` |
| Admin still denied right after a role change | Nothing — the gate reads the DB per request; a stale *frontend* may need a reload | Reload the page |
| `wrong AWS account: got …` | Wrong profile or credentials | `--profile healthbot-dev`, or `--account` to target another environment on purpose |
| `expected exactly 1 running instance tagged …` | Box stopped, replaced, or renamed | Check the tag, or pass `--instance i-…` |
| Site will not resolve at all | Known DNS delegation split, unrelated to accounts | [`aws-dev-deployment-status.md`](aws-dev-deployment-status.md); resolve the ALB directly meanwhile |

**Self-registered users cannot log in and can never be admins.** `register()`
sets `emailVerified: false` and never assigns a `role`. If someone signed up
through the UI, promote them with `add --force --role Admin` (or `--role User`).

## How secrets are handled

Worth knowing before you reach for a shortcut:

- The password is **never** an argument. There is deliberately no `--password`
  flag — it would land in shell history and in the process list. Use
  `--generate`, `--password-file`, or the hidden prompt.
- The password is **not** embedded in the SSM document. `SendCommand` parameters
  are recorded in CloudTrail and in 30 days of SSM command history. Instead the
  script stages the password as a temporary **SSM SecureString** under
  `/healthbot-dev/`, which the instance role reads, and deletes it on exit — even
  if the run fails or is interrupted.
- The plaintext never reaches a container: it is SHA-256'd on the instance, and
  only the digest is passed to the backend container over stdin.
- Temporary files live in `/dev/shm` on the instance and are shredded on exit.

If a run is killed hard enough to skip cleanup, check for leftovers:

```bash
aws ssm describe-parameters --profile healthbot-dev --region us-east-1 \
  --query 'Parameters[?contains(Name, `tmp-user-init`)].Name'
```

## Manual fallback

If the script cannot run, this is the same work by hand. The `genieai_backend`
container already has `arangojs`, `bcryptjs` and the `ARANGO_*` credentials, so
nothing needs installing and no database password needs moving around.

```bash
# 1. Open a shell on the box
aws ssm start-session --target i-07ae6c8b490f41d07 --profile healthbot-dev --region us-east-1

# 2. Digest the password exactly as the browser would
printf '%s' 'the-password' | sha256sum        # -> <enc>

# 3. Insert the user. Scripts MUST run from /app or require('arangojs') fails.
CID=$(docker ps -q -f 'name=genieai_backend\.1')
docker exec -i -w /app "$CID" node -e '
const {Database}=require("arangojs"), bcrypt=require("bcryptjs");
(async()=>{
  const db=new Database({url:process.env.ARANGO_URL,databaseName:process.env.ARANGO_DB,
    auth:{username:process.env.ARANGO_USER||"root",password:process.env.ARANGO_PASSWORD}});
  const now=new Date().toISOString();
  await db.collection("users").save({loginName:"jane@example.edu",email:"jane@example.edu",
    encPassword:await bcrypt.hash("<enc>",10), role:"Admin", emailVerified:true, disabled:false,
    createdAt:now, updatedAt:now,
    personalIdentification:{fullName:"Jane Doe",dob:"",gender:"",nationality:"",maritalStatus:""}});
  console.log("ok");
})();'

# 4. Prove it works
curl -sk -X POST https://localhost/api/auth/login -H 'Content-Type: application/json' \
  -d '{"loginName":"jane@example.edu","encPassword":"<enc>"}'
```

Do **not** use `components/gov-chat-backend/scripts/new-schema-scripts/create-genie-ai-admin-account.js`
against this environment: it hardcodes a fixed user with a fixed password hash, and
it defaults to database `node-services` via `ARANGO_DATABASE`, whereas this
deployment uses `genie-ai` via `ARANGO_DB`.
