# Users: how accounts come to exist on this system

Audience: the deployer/operator of a fresh stack. Every step below names the exact
URL, endpoint, role string, or env knob it needs — nothing here is aspirational; it
matches the running code (verified against a live stack, see the spec record in
`_bmad-output/implementation-artifacts/spec-b4-users-doc.md`).

Throughout, `<your-domain>` is your `nginx_public_domain` (e.g. `agriconnect.site`);
the public door is `https://<your-domain>` (for a local dev stack, `http://localhost`).
Deployment vars live in `deploy/ansible/group_vars/<env>/vars.yml` (non-secret) and
`vault.yml` (secret) — see [`deploy/ansible/README.md`](../deploy/ansible/README.md).

## 1. The short version

```
                 self-register                     first login                    admin approves
  ┌──────────┐  on the Keycloak    ┌──────────┐    token minted     ┌──────────┐   via dashboard
  │ anybody  │ ─────login page──▶ │ Keycloak │ ──────────────────▶ │ Pending  │ ─────or API────▶
  └──────────┘     Register       │  user    │  403 ACCOUNT_       └──────────┘   role: User |
                     link         └──────────┘  PENDING (API gated)                Manager |
                                    (email                       /pending-approval  AI Engineer |
                                     verified                       screen          Admin)
                                     if SMTP on)
                                                                                    │
                                     access granted ◀───────────────────────────────┘
                                     (Admin label also assigns the realm `admin`
                                      role — real on the user's NEXT token)
```

1. User registers on the Keycloak login page (realm `agrivisory`).
2. First login mints a token; the backend auto-provisions the account with status `Pending`.
3. Every protected API call returns `403 ACCOUNT_PENDING`; the frontend shows the
   pending-approval screen (`/pending-approval`).
4. Admins get a notification email (if SMTP is configured) and see the user in the
   admin dashboard's **Pending Approvals** queue.
5. An admin approves with a role label (`User` by default). The same token works
   immediately.
6. Approving with label `Admin` also assigns the realm role `admin` — authorization
   opens on the user's **next** token (access tokens live 300 s).

## 2. Self-registration

The login page is served by Keycloak through the front door: open the app at
`https://<your-domain>/` and you land on
`https://<your-domain>/auth/realms/agrivisory/protocol/openid-connect/auth?client_id=itu-agrivisory-client...`.
When registration is enabled the page shows a **Register** link (direct URL:
`https://<your-domain>/auth/realms/agrivisory/protocol/openid-connect/registrations?client_id=itu-agrivisory-client&response_type=code&scope=openid&redirect_uri=https://<your-domain>/`).
Passwords must satisfy the realm policy — default `length(12) and upperCase(1) and
lowerCase(1) and digits(1) and specialChars(1)`.

Realm knobs (Ansible var → env var consumed by the realm template
`configs/keycloak/genie-realm.yaml`; unset var = the compose default applies):

| Ansible var (`group_vars/<env>/vars.yml`) | Env var | Default | Effect |
|---|---|---|---|
| `keycloak_registration_enabled` | `KEYCLOAK_REGISTRATION_ENABLED` | `true` | Register link on the login page |
| `keycloak_verify_email` | `KEYCLOAK_VERIFY_EMAIL` | `true` | New users must click an emailed link before first login |
| `keycloak_reset_password` | `KEYCLOAK_RESET_PASSWORD` | `true` | "Forgot password?" on the login page |
| `keycloak_password_policy` | `KEYCLOAK_PASSWORD_POLICY` | `length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1)` | Password rules |

Verify-email and reset-password both send mail — with the default `verify_email: true`
you need working SMTP (Section 8) or first-time users cannot get past email
verification. Deployments without SMTP set `keycloak_verify_email: "false"`.

## 3. First login → Pending

With `USER_APPROVAL_REQUIRED=true` (env var; Ansible var `user_approval_required`,
default `"true"`), the first valid token a new user presents auto-provisions their
account in ArangoDB with `status: 'Pending'` — the account exists, but every
protected API call answers:

```json
HTTP 403
{ "error": "ACCOUNT_PENDING",
  "message": "Your account is pending approval by an administrator.",
  "details": { "email": "newuser@example.com" } }
```

The frontend recognizes that error code on any API call and redirects to the public
`/pending-approval` screen (no popup, no login loop — the user just waits). The
backend simultaneously attempts an admin-notification email (best-effort, never
blocks the request).

Setting `user_approval_required: "false"` skips the gate: first login provisions the
account `Active` immediately. The flip affects **new first-logins only** — users
already sitting in Pending stay gated until an admin approves them (or their doc
is hand-flipped).

## 4. Admin approval

An admin (any user holding the realm role `admin` — Section 5) works the queue either
way:

- **UI:** log into the app, open the Admin Dashboard — pending users appear under
  **Pending Approvals** with per-user Approve/Reject controls and a role selector.
- **API** (what the dashboard calls):

| Action | Endpoint |
|---|---|
| List pending users | `GET /api/admin/users/pending` |
| Pending count | `GET /api/admin/users/pending/count` |
| Approve | `POST /api/admin/users/:id/approve` body `{"role": "User"}` |
| Reject | `POST /api/admin/users/:id/reject` body `{"reason": "..."}` |
| Force logout | `POST /api/users/admin/users/:id/force-logout` |

`:id` is the `_key` from the pending list. Role labels: `User` (default), `Manager`,
`AI Engineer`, `Admin`. The `role` value is **case-sensitive and unvalidated** —
only the exact string `Admin` triggers the realm-role sync; a lowercase `admin` is
silently stored as a display label and grants nothing. (The force-logout path
really is `/api/users/admin/...` — the route lives in user-routes, mounted at
`/api/users`.)

- **Approve as `User` / `Manager` / `AI Engineer`:** the doc flips to
  `status: 'Active'` and the label is stored. The user's **current token works
  immediately** — reload the app and go. An approval email is attempted.
- **Approve as `Admin`:** additionally assigns the realm role `admin` in Keycloak
  first, then flips the doc. Realm-role authorization opens on the user's **next**
  token (≤ 300 s, or immediately after a force-logout forces re-login).
- **Reject:** sets `status: 'Rejected'`, disables the account, and revokes
  the user's Keycloak sessions. The rejected user's next API calls get `403
  FORBIDDEN` — "Your account registration has been rejected…". **Reject is not
  terminal** (DEC-13, settled 09-27):
  admins will be able to flip a Rejected user back to Pending/Active — a small
  un-reject route + dashboard button is filed as a follow-up; until it lands, an
  operator hand-edits the Arango doc (`status: 'Pending'`, `disabled: false`).

## 5. Roles and access

Two different things are called "roles" — keep them straight:

- **Realm roles (Keycloak) are the source of truth for authorization.** Exactly one
  matters: `admin`. It travels inside the token (`realm_access.roles`), and every
  `/api/admin/*` route requires it. Authorization decisions read **only** the
  token — the token's roles array is mirrored into the user's database doc on
  every login (that mirror feeds display and the admin-notify query), but nothing
  authorizes off the mirror.
- **The labels** `User` / `Manager` / `AI Engineer` / `Admin` on a user's profile are
  **display-only** product metadata. `Manager` and `AI Engineer` grant nothing. Do
  not expect them to gate anything. (Legacy [`User-Roles.md`](User-Roles.md)
  once described a hierarchical RBAC — Manager gating uploads, AI Engineer
  gating the Query Inspector, a four-tier permission matrix — that never
  existed in this deployment; it is now a stub pointing back here.)

To grant admin access to an existing user by hand (the approve-as-`Admin` path above
does this automatically):

1. Open the Keycloak admin console through the front door:
   `https://<your-domain>/auth/admin/` — sign in with the master admin account
   (username from `keycloak_admin_username`, default `admin`; password
   `keycloak_admin_password` from your vault).
2. Top-left realm dropdown → **agrivisory** (the console opens on `master`).
3. **Users** → find the user → **Role overrides** (or Role mappings) → assign the
   realm role **`admin`**.

The grant lands in the user's **next** token — current access tokens live 300 s
(DEC-4). To cut the window: `POST /api/users/admin/users/:id/force-logout` revokes
their Keycloak sessions so the next login mints a fresh token.

## 6. Grafana access

Grafana runs under the observability profile (`enable_observability: "1"` in
`group_vars/<env>/vars.yml`, or `--profile observability` for plain compose). It has
no local login form — sign in at `https://<your-domain>/grafana/` via **Sign in with
Keycloak** (OIDC client `grafana`, confidential, PKCE; secret = `grafana_client_secret`
in your vault).

Any user who can log into the realm can sign in to Grafana (accounts are
auto-created; note Grafana sits on Keycloak login alone — the Pending-approval
gate protects the app API, not Grafana's Viewer access); role mapping is a single
rule — the realm role `admin` maps to Grafana **Admin**, everyone else gets
**Viewer**. So: approve-as-`Admin` users are Grafana Admins on their next login;
ordinary users are Viewers.

## 7. The first admin

The very first admin is created at deploy time from vault vars — no manual step:

| Vault var | Use |
|---|---|
| `genie_admin_username` | Realm username (default `genie-admin`) |
| `genie_admin_password` | Password — **must satisfy the realm password policy** (default: 12+ chars, upper, lower, digit, special). A weak password makes the realm import fail with HTTP 400 and the stack never comes up. |
| `genie_admin_email` | The admin's email — **single source for two settings** (below) |

Mechanics:

1. The `keycloak-config` sidecar imports the realm, creating the user
   `genie-admin` with the realm role `admin` and `emailVerified: true`.
2. The `db-migrations` one-shot seeds the app-database doc for that email as
   `{status: 'Active', role: 'Admin', roles: ['admin']}` (matched by
   `ADMIN_BOOTSTRAP_EMAIL`), so the first login skips the Pending gate, admin
   routes open immediately, and this admin receives pending-registration emails.

**Email SSOT invariant (B3):** Ansible derives both `GENIE_ADMIN_EMAIL` (the realm
user's email) and `ADMIN_BOOTSTRAP_EMAIL` (the seed's match key) from the **one**
vault var `genie_admin_email`, so they cannot diverge. If you bypass Ansible and
hand-write `.env`, you must keep them equal yourself: a mismatch means the seed
promotes a document nobody logs in with, and the first admin lands **Pending** —
with no admin able to approve them. Lockout. Same trap if `ADMIN_BOOTSTRAP_EMAIL`
is simply left empty.

## 8. Email knobs

All mail (backend product mail and Keycloak realm mail) rides on the `EMAIL_*`
block — Ansible vars `email_host`, `email_port`, `email_secure`, `email_user`,
`email_from` (vars.yml) and `email_password` (vault). Links inside the backend's
emails (approval/notify "log in" links) use `FRONTEND_URL`, computed
automatically from the public origin (`https://<your-domain>`) — nothing to set.

**Minimum viable email config:** `email_from` must be set to a valid address even
when you have no SMTP server — the realm template's `smtpServer` block is always
present, and Keycloak rejects the realm import with HTTP 400
`Invalid sender address 'null'` when the sender is empty (the stack never comes
up). Without SMTP, a placeholder like `email_from: "noreply@<your-domain>"` and an
empty `email_host` deploy fine — no mail is deliverable, but nothing blocks:

- Admin-notification and approval emails fail (warn/error lines in backend logs,
  requests unaffected).
- Keycloak's verify-email and password-reset emails never arrive — with the default
  `keycloak_verify_email: "true"` new users are stranded at "verify your email".
  Without SMTP, set `keycloak_verify_email: "false"`.

The emails that exist:

| Email | Sent by | When | Trigger |
|---|---|---|---|
| "New User Registration Pending Approval" | backend | first login provisions a Pending account | to every user holding the realm `admin` role |
| "Your account has been approved" | backend | admin approves | to the approved user |
| Verify-email / password-reset | Keycloak | registration / "Forgot password?" | Keycloak's own templates |

Note: the sender-address requirement above is live-verified — an empty `email_from`
fails the realm import during `keycloak-config` (see also the troubleshooting
section of [`deploy/ansible/README.md`](../deploy/ansible/README.md)).

## 9. Mobile status

The Flutter mobile app is **not migrated** to this auth stack — it speaks the
deleted legacy protocol and gets 401 on everything (audit A8, DEC-7 outcome in
`sprint/plan.md`; fix tracked in `_bmad-output/implementation-artifacts/deferred-work.md`).
The realm already carries the `agrivisory-mobile` client for the future rebuild;
until then, users are web-only.

## 10. Troubleshooting quick table

| Symptom | Cause | Fix |
|---|---|---|
| First admin lands on pending-approval screen | `ADMIN_BOOTSTRAP_EMAIL` ≠ `GENIE_ADMIN_EMAIL` (or empty) — seed promoted the wrong doc | Set vault `genie_admin_email`, re-render `.env`, then re-run the seed: local mode `cd <deploy_dir> && docker compose run --rm db-migrations` (idempotent — applied migrations are SKIPped), swarm mode `docker service update --force genieai_db-migrations` (or hand-flip the user doc: `status: 'Active'`, `roles: ['admin']`) |
| No admin-notification email on new registration | No SMTP (`email_host` empty), or no user holds realm `admin` with an email address | Configure SMTP (Section 8); check backend logs for `EmailService` warnings |
| Realm import fails: `Invalid sender address 'null'` | `email_from` empty — Keycloak rejects the realm's SMTP block | Set `email_from` to any valid address (a placeholder is fine without SMTP) |
| Approved user still blocked / admin label "not working" | Realm role lands on the **next** token; current one lives up to 300 s | User logs in again, or admin calls `POST /api/users/admin/users/:id/force-logout` |
| New user stuck at "Verify your email" after registering | `KEYCLOAK_VERIFY_EMAIL=true` but SMTP unset/misconfigured | Configure SMTP, or set `keycloak_verify_email: "false"` |
| Realm import / stack startup fails with 400 on weak `GENIE_ADMIN_PASSWORD` | Password violates the realm policy (default 12+ chars, upper, lower, digit, special) | Set a policy-compliant `genie_admin_password` in vault |
| Mistakenly rejected a user | Rejected status blocks the account (DEC-13 settled: un-reject route + button coming as a follow-up) | Until it lands: operator edits the Arango `users` doc (`status: 'Pending'`, `disabled: false`), or the user re-registers with a different email |

---

Related: [`deploy/ansible/README.md`](../deploy/ansible/README.md) (deployment),
[`deploy-rtx6000.md`](deploy-rtx6000.md) (the canonical deploy runbook),
decision ledger [`sprint/decisions.md`](../sprint/decisions.md)
(DEC-3 registration/approval, DEC-4 token lifetimes, DEC-13 un-reject question).
