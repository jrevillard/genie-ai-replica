# E2E Test Plans

Per-epic E2E test plans for GENIE.AI Keycloak authentication and secure API access.

## Document Index

| Document | Description | Test Phases |
|----------|-------------|-------------|
| [00-clean-start.md](00-clean-start.md) | Common setup: deploy stack, create test user, get tokens | Phase 0 |
| [epic1-keycloak-foundation.md](epic1-keycloak-foundation.md) | Keycloak foundation: login redirect, JIT provisioning, external IdP | Phases A–E |
| [epic2-secure-api-access.md](epic2-secure-api-access.md) | Secure API access: token headers, JWKS refresh, multi-realm, OPEA, error display | Phases F–K |
| [epic3-session-lifecycle-gdpr.md](epic3-session-lifecycle-gdpr.md) | Session management, user lifecycle, GDPR erasure | Phases L–N |

## Prerequisites

- Docker Compose stack deployed and healthy (follow `00-clean-start.md` first)
- Admin access to Keycloak (`KEYCLOAK_ADMIN_PASSWORD` from `.env`)
- Tools: `curl`, `python3`, `jq`, `npx` (Node.js 18+)
- Playwright: run `npm install` at project root, then `npx playwright install chromium`
- Phase F requires `DEPLOY_OPEA=1` (OPEA services must be running for header injection tests)
- Phases G–K work with `DEPLOY_OPEA=0`
- Phase J requires Keycloak service account credentials (`KC_DATAPREP_CLIENT_ID`, `KC_DATAPREP_CLIENT_SECRET`) in `.env`
- Phase I requires `KEYCLOAK_ADDITIONAL_REALMS=["genie2"]` in `.env` — additional realms must be created **before** backend starts (Phase 0, Step 0.6)
- Phases L–N require Phase K cleanup completed (K.5 + K.6 executed, stack healthy)

## Conventions

These phases must stay deterministic — no fallback paths, no fixed sleeps, waits
only as bounded wait-for-condition. Full rules: [`tests/e2e/CLAUDE.md`](../../tests/e2e/CLAUDE.md)
(Rule: Determinism — it covers this shell too). The fixed `sleep` commands still
present in these phase docs are known violations tracked in #1386; do not copy
them into new steps.

### Locating application elements

An E2E test reaches an application element only through a test handle the
application declares — a `data-test-id` attribute in the web app, a `Key`
in the Flutter app. Classes, i18n labels and DOM positions are not
locators. The rule and its rationale: `.claude/rules/E2E-TESTING.md`.

### Test Step Format

Each step follows this format:

```
**X.Y — Description**

```bash
<copy-pasteable command>
```

**Expected**: <what to look for>
```

### Variable Naming

| Variable | Description | Defined in |
|----------|-------------|------------|
| `$TOKEN` | Keycloak master admin token | Phase 0 |
| `$USER_TOKEN` | ROPC token for `testuser` in `genie` realm | Phase 0 |
| `$USER2_TOKEN` | ROPC token for `testuser2` in `genie2` realm | Phase I |
| `$SERVICE_ACCOUNT_TOKEN` | Keycloak service account token (client_credentials grant) | Phase J |

### Resolving test accounts

Never key a fixture account (`testuser`, `testadmin`, `testplain`) by its
**email**: the venue-fixture contract (`convergeUser` in
`tests/e2e/helpers/keycloak-admin.js`) deliberately never rewrites a fixture
account's email, so a venue provisioned before the fixtures module keeps the
original address and an email-keyed lookup finds nothing. Resolve accounts by:

- **username** — Keycloak Admin API: `GET /auth/admin/realms/genie/users?username=testuser&exact=true`
  (without `exact=true` the `username` param is a substring match and can
  resolve the wrong account)
- **own profile** — `GET /api/me` with the user's own token returns the raw
  ArangoDB document, `_key` included
- **`iss_sub`** — for direct ArangoDB queries: JIT provisioning keys the user
  document by `iss_sub` (`<issuer>#<subject>`). Decode the session token's
  payload (`iss` + `sub` claims) and query
  `db.users.firstExample({iss_sub: '<iss>#<sub>'})`. This is the account's
  stable identity: the email is venue-dependent, GDPR erasure nullifies the
  PII fields, and every phase logs in first, which also migrates legacy
  documents missing `iss_sub`.

Email-keyed lookups are acceptable only for accounts the phase itself created
with a known email (e.g. `field=exactEmail` on `/api/admin/users/search`) —
their address is deterministic because the phase wrote it.

### URL Convention

- All URLs use `https://localhost` with self-signed cert
- Keycloak Admin API: `https://localhost/auth/admin/realms/{realm}/...`
- Kong strips `/auth` prefix — always use `/auth/...` via NGINX proxy

## Phase Execution Order

```
Phase 0 (setup) → F (token passthrough) → G (Swagger OAuth2) → H (JWKS refresh) → I (multi-realm) → J (OPEA continuity) → K (auth errors) → L (session management) → M (user lifecycle) → N (GDPR compliance)
```

**Important**: Phase K mutates realm settings and scales Keycloak to 0. Cleanup steps (K.5, K.6) restore state. Verify stack health before proceeding to Phase L.
