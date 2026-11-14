# E2E Tests

The Playwright suite in `tests/e2e/` is organized on ONE axis: the
functional area (`auth/`, `chatbot/`, `documents/`, `admin/`, `okf/`,
`theme/`). One spec, one place — the placement rule and the decision
record are the suite map's *The one axis* section. The map of every spec —
its area, the acceptance phase or story it serves, its deployment profile,
its helpers — and the acceptance phases' manual procedures (Phases A–N)
live in ONE document: the [suite map](suite-map.md).

## Document Index

| Document | Description | Test Phases |
|----------|-------------|-------------|
| [local-run.md](local-run.md) | The local e2e run — the one command that executes the suite, the executed set, the failure path | — |
| [suite-map.md](suite-map.md) | The suite map — every spec file: area, phase/story, profile, helpers (#1741) — and the acceptance phases' manual procedures (A–N) | all |
| [00-clean-start.md](00-clean-start.md) | Common setup: deploy stack, create test user, get tokens | Phase 0 |
| [locator-map.md](locator-map.md) | Every spec's element selection — and the grandfathered inventory — of the handle-locator gate (#1822) | — |

## Prerequisites

- Docker Compose stack deployed and healthy (follow `00-clean-start.md` first)
- Admin access to Keycloak (`KEYCLOAK_ADMIN_PASSWORD` from `.env`)
- Tools: `curl`, `python3`, `jq`, `npx` (Node.js 18+)
- Playwright: run `npm ci` at project root, then `node tests/e2e/run/install-browsers.js` — it reconciles the checkout and the browser tree with the `@playwright/test` the lockfile pins, and the Chromium build the suite drives is named by that version
- Phase F runs backend-side verification without OPEA; the token-forwarding tests (F.2, F.5, F.8) require `DEPLOY_OPEA=1`
- Phases G–K work with `DEPLOY_OPEA=0`
- Phase J requires Keycloak service account credentials (`KC_DATAPREP_CLIENT_ID`, `KC_DATAPREP_CLIENT_SECRET`) in `.env`
- Phase I requires `KEYCLOAK_ADDITIONAL_REALMS=["genie2"]` in `.env` — additional realms must be created **before** backend starts (Phase 0, Step 0.6)
- Phases L–N require Phase K cleanup completed (K.5 + K.6 executed, stack healthy)

## Conventions

These phases must stay deterministic — no fallback paths, no fixed sleeps, waits
only as bounded wait-for-condition. Full rules: [`tests/e2e/CLAUDE.md`](../../tests/e2e/CLAUDE.md)
(Rule: Determinism — it covers this shell too). The fixed `sleep` commands these
phase docs used to carry were replaced with bounded readiness loops in #1386;
do not introduce new ones.

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
| `$USER_TOKEN` | ROPC token for `testuser` in `genie` realm | acquired per test (ROPC pattern: 00-clean-start Step 0.8) |
| `$USER2_TOKEN` | ROPC token for `testuser2` in `genie2` realm | Phase I |
| `$SERVICE_ACCOUNT_TOKEN` | Keycloak service account token (client_credentials grant) | Phase J |
| `$KC_EMAIL` | `testuser`'s address as the venue's Keycloak account holds it — captured in M.1/M.2, reused by the Phase N recreates | Phase M |
| `$ORIGINAL_EMAIL` | Address captured before the M.4 email change; restored by M.5 | Phase M |

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
  stable identity while it exists: the email is venue-dependent, and every
  phase logs in first, which also migrates legacy documents missing
  `iss_sub`. **GDPR erasure nullifies `iss_sub` together with the PII
  fields** — after erasure, the `_key` saved before the erasure is the only
  handle on the document.

Email-keyed lookups are acceptable only for accounts the phase itself created
with a known email (e.g. `field=exactEmail` on `/api/admin/users/search`) —
their address is deterministic because the phase wrote it.

### URL Convention

- All URLs use `https://localhost` with self-signed cert
- Keycloak Admin API: `https://localhost/auth/admin/realms/{realm}/...`
- Kong strips `/auth` prefix — always use `/auth/...` via NGINX proxy

## Phase Execution Order

```
Phase 0 (setup) → F (token forwarding to OPEA) → G (Swagger OAuth2) → H (JWKS refresh) → I (multi-realm) → J (OPEA continuity) → K (auth errors) → L (session management) → M (user lifecycle) → N (GDPR compliance)
```

The procedures of Phases A–N: the suite map's [§ The acceptance
phases](suite-map.md#the-acceptance-phases).

**Important**: Phase K stops Keycloak (K.4) and sweeps test artifacts (K.5+K.6) — run those cleanup steps after Phase K before Phase L, and verify stack health before proceeding; the K.2 expiry is client-scoped and mutates no realm setting (#1835). Full procedure: [suite-map.md § Phase K](suite-map.md#phase-k-auth-error-display-story-2-6).
