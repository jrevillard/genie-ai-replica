# The E2E suite map

The map of the Playwright suite in `tests/e2e/`: for every spec file — the
feature area it lives in, the acceptance phase/story it serves (the
`docs/e2e-tests/` phases), the deployment profile it needs, and the shared
helpers it uses. Raised by the operator's question of 2026-11-10 and
delivered as issue #1741.

## The one axis

The suite is organized on **ONE axis: the functional area**. Every spec
lives in the directory of the area it drives. The former phase directories
(`epic1/`, `epic2/`, `epic3/`) were a second axis mixed into the same tree —
a file that belongs to the auth area living under `epic2/` was the visible
symptom (#1741).

Phase traceability survives the reorganization in two places:

- the **phase-letter filename prefixes** (`a1-`, `d7b-`, `g1-`, `l3-`), kept
  on every acceptance spec when it moved into `auth/`;
- the **Phase/story column** of the map below, which ties every spec to its
  phase and its source document.

The rule for new work: **one spec, one place, one axis**. A new spec goes
under its area's directory. A spec whose area is unclear becomes a
follow-up issue with `status::backlog` (the worked precedent: a spec
the CI pinned at the tree root until #1823 moved the pin with the
file) —
never a root-level file and never a revival of a phase directory. Feature
specs serve no acceptance phase; their Phase/story entry is `—`.

Decision record: #1741 chose the functional axis over keep-phase and
split-hybrid. The phase directories were one area (auth) wearing three
phase names, and the hybrid keeps both axes in the tree — the thing being
fixed.

## `auth/` — login, session lifecycle, tokens and realms

The acceptance phases these specs serve (A–N) are the manual procedures in
§ The acceptance phases below.

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `a1-login-redirect.spec.js` | A.1 | unauthenticated app root redirects to the Keycloak login page | core | `base-url` |
| `a2-full-login-flow.spec.js` | A.2 | full browser login: app → Keycloak → authenticated app | core | `base-url`, `e2e-fixtures` |
| `a3-legacy-routes-redirect.spec.js` | A.3 | removed legacy auth routes (`/login`, `/register`, `/forgot-password`) behave on the Keycloak IdP | core | `base-url` |
| `d7a-external-idp-button.spec.js` | D.7a | external-IdP button renders on the login page | external-IdP | `base-url`, `venue-profile` |
| `d7b-external-idp-login-flow.spec.js` | D.7b | full login through the brokered external identity provider | external-IdP | `base-url`, `venue-profile` |
| `g1-swagger-authorize.spec.js` | G.1 | Swagger UI loads with the OAuth2 security scheme and its Authorize button | core | — |
| `h1-jwks-force-refresh.spec.js` | H.1 | realm key rotation forces a JWKS refresh; sessions survive it | core | `auth`, `keycloak-admin` |
| `i1-multi-realm.spec.js` | I.1 | a second realm (`genie2`) validates tokens through its own JWKS | multi-realm | `auth`, `keycloak-admin`, `venue-profile` |
| `j1-opea-continuity.spec.js` | J.1 | the session token propagates to the OPEA services and the sanitized profile comes back | core | `auth` |
| `k1-auth-error-display.spec.js` | K.1 | Keycloak auth failures render the visible error surface (and its realm mutation is reverted) | core | `auth`, `keycloak-admin` |
| `l1-frontend-logout-redirect.spec.js` | L.1 | logout redirects to the Keycloak login page | core | `base-url`, `e2e-fixtures` |
| `l2-localstorage-cleanup.spec.js` | L.2 | logout clears the legacy localStorage items | core | `base-url`, `e2e-fixtures` |
| `l3-vuex-state-cleared.spec.js` | L.3 | logout clears the Vuex auth state | core | `base-url`, `e2e-fixtures` |

Phases **without** a Playwright spec — B, C, E (foundation provisioning
steps), F (backend-side token-forwarding verification), M and N (user
lifecycle, GDPR erasure) — are the manual shell phases of their source
documents. They are procedures, not specs; this map records the fact so no
one reads a missing directory as an accident.

## `chatbot/` — the chat surface

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `chat-composer.spec.js` | — | one composer instance at a time across the welcome screen/chat view; i18n keys it renders match the frontend locale files | core | `welcome`, `layout`, `base-url` |
| `chat-conversation.spec.js` | — | the conversation view's V1 invariants (header, bubbles, feedback, held-release stream) | core | `welcome`, `chatbot`, `route`, `layout` |
| `conversation-history.spec.js` | — | conversation history list, deletion and the cleanup sweep caps | core | `auth`, `chatbot` |
| `error-handling.spec.js` | — | a failed chat turn renders the answer card's error block and recovers | core | `chatbot` |
| `quick-help-scope.spec.js` | — | the Quick Help grid renders its declared scope and dead cards send nothing | core | `route`, `stream-route`, `welcome` |
| `send-message-and-stream.spec.js` | — | sending a message and the SSE stream rendering | core | `chatbot` |

## `documents/` — document management

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `search.spec.js` | — | document search by partial name | core | `auth`, `documents` (+ `fixtures/` seed files) |
| `upload.spec.js` | — | upload of each supported extension into the document table | core | `auth`, `documents` (+ `fixtures/` seed files) |

## `admin/` — the admin dashboard

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `analytics-satisfaction.spec.js` | — | the analytics satisfaction charts render the injected payloads with the active locale's labels | core | `chatbot` |
| `authz.spec.js` | — | admin surface authorization: navbar gating + backend 403 | core | `auth`, `chatbot` |
| `data-wiring.spec.js` | — | overview stat tiles/health/resources render from the system-health payload | core | `auth`, `chatbot` |
| `failure-states.spec.js` | — | admin API failures render the visible error notification and recover | core | `auth`, `chatbot` |
| `hierarchy-translations-failure.spec.js` | — | the hierarchy form's failed-translations dead-end: notice, disabled controls, Retry recovery | core | `auth`, `chatbot` |
| `logs-view.spec.js` | — | the Logs tab renders the VL-backed roll-up rows | core | `auth`, `chatbot` |

## `okf/` — the OKF pillar

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `artifacts-view.spec.js` | — | the OKF artifacts view | OKF | `chatbot`, `venue-profile` |
| `concept-ceiling.spec.js` | — | the concept-document size ceiling behaviour | OKF | `chatbot`, `venue-profile` |
| `ragas-guide-errors.spec.js` | — | the RAGAS guide error surfaces | OKF | `auth`, `base-url`, `keycloak-admin`, `locale`, `venue-profile` |
| `ragas-judge-selector.spec.js` | — | the RAGAS judge model selector | OKF | `auth`, `base-url`, `keycloak-admin`, `venue-profile` |
| `ragas-rescore-tracking.spec.js` | — | RAGAS rescore tracking | OKF | `auth`, `base-url`, `keycloak-admin`, `locale`, `venue-profile` |
| `studio-draft-notice.spec.js` | — | the Studio's session-wide degraded-draft banner (#1531) | OKF | `chatbot`, `venue-profile` |
| `wizard-split-note.spec.js` | — | the wizard's split-report note, rendered from the server's answer (#1591) | OKF | `chatbot`, `venue-profile` |

OKF specs skip **with a reason** on a venue whose runtime config does not
expose the pillar — see [local-run.md](local-run.md).

## `theme/` — frontend shell and visual layer

| Spec | Phase/story | What it drives | Profile | Helpers |
|------|-------------|----------------|---------|---------|
| `living-intelligence.spec.js` | — | the decoration assets are served from `/config/` and revalidated, never cached immutable | core | `cache-headers`, `chatbot` |
| `resizable-sidebars.spec.js` | — | the shared edge handle: drag, collapse, restore, the clamp | core | `chatbot`, `welcome`, `layout` |
| `responsive-layout.spec.js` | — | the quick-help grid column invariant across viewports | core | `chatbot`, `welcome`, `layout` |
| `welcome-banner.spec.js` | — | the welcome banner scrim: alpha floor, wordmark contrast | core | `welcome` |
| `theme-runtime-config.spec.js` | — | cache-header contract for the runtime theme config (`/config/theme-variables.css`, `/runtime/config.js`, `@theme_fallback`) | core | `cache-headers`, `base-url` |

`theme-runtime-config.spec.js` was the one exception to the axis — held at
the tree root because the dormant CI invocation (`.gitlab-ci.yml` →
`e2e:playwright`) and its changes-anchor named it **verbatim** — until its
pin was moved with it (#1823). It is the sibling contract of
`living-intelligence.spec.js` (both are the cache-header contracts for
operator-editable `/config/` assets) and lives here since.

## `helpers/` and `run/` — unit specs of the suite's own modules

These are not app specs: they unit-test the suite's own modules and run
without a venue surface.

| Unit spec | Tests | Profile |
|-----------|-------|---------|
| `helpers/auth.spec.js` | the auth/session minting helper | none |
| `helpers/base-url.spec.js` | the ONE venue-edge module (normalization) | none |
| `helpers/chatbot.spec.js` | the chat login/stream helper | none |
| `helpers/keycloak-admin.spec.js` | the Keycloak admin API helper | none |
| `helpers/route.spec.js` | the route-mock wrapper | none |
| `helpers/venue-launch-args.spec.js` | the browser launch-args/venue-mapping helper | none |
| `helpers/venue-profile.spec.js` | the venue-surface probe (every runtime skip's reason) | none |
| `run/file-failure-issues.spec.js` | the failure path (issue filing from a report) | none |
| `run/install-browsers.spec.js` | the browser-tree reconciler | none |
| `run/preflight.spec.js` | the run pre-flight | none |
| `run/venue-dns.spec.js` | the venue-name mapping preload | none |

## Keeping the map true

The map is documentation of a layout whose mechanical consequences the pins
already enforce:

- the **executed set** contract lives in
  [`local-run.md`](local-run.md) § *The executed set* — the validator
  derives it from the run script and the CI invocation, never from this
  map (a spec file added under one of the CI's executed globs adds one line
  to the validator's exact list);
- **anchor coverage** holds for the directories the train invocation
  covers (`chatbot/`, `documents/`, `admin/`, `helpers/`, `theme/`) — a
  spec executed by the train stays
  train-triggerable without an anchor edit. Every other directory is NOT
  anchor-covered: `okf/` by deliberate exclusion, `auth/` and
  `run/` because the dormant train invocation never named them — a spec
  added there does not trigger the dormant e2e job. The merge-train
  changes guard in `tests/config-validator/` pins the executed set and
  the coverage demand;
- the **handle-locator gate** and the **fixture-password scan** carry the
  per-file lists they need and were updated by the same MR that moved the
  files (#1741) — the gate went default-on with explicit exemptions in
  #1822, whose [locator map](locator-map.md) classifies every spec's
  element selection.

When you move or add a spec: move it into its area directory, update this
map's row, and let the validator suite tell you which pin lists followed.
If the honest answer to "which area is this?" does not exist, do not invent
a directory — file a follow-up issue with `status::backlog` and leave the
file where the axis currently least lies about it.

---

## The acceptance phases

The manual shell procedures of the acceptance phases, A through N — folded
here from the former per-epic plans when the suite moved to the ONE
functional axis (#1837; the H.2 recipe was rewritten to the Keycloak 26
reality in the same fold, #1579). Each phase is a procedure, not a spec:
the Playwright specs that automate parts of them are the rows of the area
tables above (their Phase/story column names the phase and its letter
prefix lives on the spec's file name).

Run the phases in order — the full sequence, the per-phase prerequisites
and the step/variable conventions: [README.md](README.md). Stop
conditions: a failed step is diagnosed before the next phase runs; Phase K
mutates realm settings and scales Keycloak to 0 (its K.5 + K.6 steps
restore it); Phase N is destructive (it erases the user) — always run its
N.6 cleanup at the end.

---

## Phase A: Frontend Login Redirect

### Test A.1 —Redirect to Keycloak

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/a1-login-redirect.spec.js
```
**Expected**: `{ redirected: true }`

### Test A.2 —Full Login Flow

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/a2-full-login-flow.spec.js
```
**Expected**: URL is `https://localhost/dashboard`, body contains "GENIE.AI"

### Test A.3 —Legacy Routes Redirect

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/a3-legacy-routes-redirect.spec.js
```
**Expected**: All three redirect to Keycloak (`true`)

---

## Phase B: JIT User Provisioning

### Test B.1 —First Login Creates User in ArangoDB

```bash
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost/api/me" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
**Expected**: HTTP 200 with `success: true` and user profile

### Test B.2 —ArangoDB Document

```bash
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    print(JSON.stringify(db.users.toArray().map(u => ({
      _key:u._key, iss_sub:u.iss_sub, email:u.email, active:u.active, deleted:u.deleted, sub:u.sub
    })), null, 2))
  "
```
**Expected**: Document with `iss_sub`, `sub`, `email`, `active: true`, `deleted: false`

### Test B.3 —UPSERT Atomic (No Duplicates)

Re-run Test B.1 to trigger provisioning again, then verify document count is still 1:

```bash
# Re-run provisioning (same user)
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost/api/me" -H "Authorization: Bearer $TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
# Expected: 200

# Verify exactly 1 user document in ArangoDB
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var count = db.users.count();
    print('User count: ' + count);
    if (count !== 1) { print('FAIL: Expected 1 user, found ' + count); }
    else { print('PASS'); }
  "
# Expected: PASS
```

### Test B.4 — REMOVED (superseded by Phases M.8–M.10 and N.1)

> **This test has been removed.** The original test checked that soft-deleted users return 403, but Story 3.6 (JIT re-activation) changed the behavior: soft-deleted users with a valid Keycloak token are automatically re-activated on login.
>
> The test was also architecturally flawed: it manipulated ArangoDB directly without disabling the user in Keycloak, which allowed the user to still obtain a valid token.
>
> **Replacement tests (Phases M and N):**
> - **M.9** — JIT reactivation of soft-deleted user (correct flow: Keycloak disable → soft-delete → Keycloak re-enable → login → re-activation)
> - **M.10** — Delete user account (Keycloak + ArangoDB)
> - **N.1** — GDPR erasure (complete PII nullification, permanent)

---

## Phase C: Token Validation Errors

### Test C.1 —Malformed Token

```bash
curl -sk "https://localhost/api/me" -H "Authorization: Bearer not-a-real-token"
# Expected: {"error":"TOKEN_INVALID","message":"Token verification failed","details":{}}
```

### Test C.2 —Not Enough Parts

```bash
curl -sk "https://localhost/api/me" -H "Authorization: Bearer a.b"
# Expected: {"error":"TOKEN_INVALID","message":"Token verification failed","details":{}}
```

### Test C.3 —No Token

```bash
curl -sk "https://localhost/api/me"
# Expected: {"error":"TOKEN_INVALID","message":"Missing or malformed Authorization header","details":{}}
```

### Test C.4 —No Internal Details Leaked

All three responses above must have `"details": {}` —no Keycloak URL, client ID, stack trace, or JWT payload.

---

## Phase D: External IdP Connection

Instead of requiring a real external IdP (Google, Microsoft), this test uses a second Keycloak realm as a mock external IdP. This validates the exact same brokering flow without requiring external credentials or network connectivity.

```
GENIE.AI Frontend -> Keycloak (genie realm) -> Keycloak (external-idp realm) -> GENIE.AI Backend
```

**Prerequisite chain**: Phases A, B, C must pass before running Phase D. Phase D builds on a working login, provisioning, and token validation flow.

> **Clean state required**: Phase D creates a broker user (`external-test@example.com`) in ArangoDB via JIT provisioning (Step 7b). If this user already exists from a prior run with stale data (e.g., soft-deleted), the broker login will fail. If you encounter this, run `docker compose down -v` and restart from Phase 0 to ensure a clean ArangoDB volume.

**Admin token**: Ensure `$TOKEN` is set from the "Get Admin Token" section above. If the token has expired, re-run it.

## Step 0: Clean Stale Broker User (if present)

Remove any existing broker user from both ArangoDB and Keycloak to prevent the "first-broker-login" interstitial page during Step 7b:

```bash
# Remove stale broker user from ArangoDB (safe to run — no-op if not found)
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var stale = db.users.byExample({email: 'external-test@example.com'}).toArray();
    for (var i = 0; i < stale.length; i++) {
      db.users.remove(stale[i]._key);
      print('Removed stale broker user from ArangoDB: ' + stale[i]._key);
    }
    if (stale.length === 0) { print('No stale broker user in ArangoDB — OK'); }
  "

# Remove stale broker user from Keycloak (safe to run — no-op if not found)
BROKER_USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?email=external-test@example.com" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
users = json.load(sys.stdin)
if users:
    print(users[0]['id'])
else:
    print('')
" 2>/dev/null)

if [ -n "$BROKER_USER_ID" ]; then
  curl -sk -X DELETE "https://localhost/auth/admin/realms/genie/users/${BROKER_USER_ID}" \
    -H "Authorization: Bearer $TOKEN" -w "\nRemoved broker user from Keycloak: %{http_code}\n"
else
  echo "No stale broker user in Keycloak — OK"
fi
```

## Step 1: Create the External IdP Realm

Create a second Keycloak realm `external-idp` with a test user and a broker client:

```bash
# Create the external-idp realm (201 = created, 409 = already exists — OK)
curl -sk -X POST "https://localhost/auth/admin/realms" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"realm": "external-idp", "enabled": true, "sslRequired": "none"}' \
  -w "\nHTTP: %{http_code}\n"

# Create a test user (201 = created)
curl -sk -X POST "https://localhost/auth/admin/realms/external-idp/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "external-test-user",
    "enabled": true,
    "email": "external-test@example.com",
    "firstName": "External",
    "lastName": "TestUser",
    "credentials": [{"type": "password", "value": "External123!", "temporary": false}]
  }' -w "\nHTTP: %{http_code}\n"

# Create a confidential client in external-idp for the genie realm broker (201 = created)
# This client represents the genie realm when it connects to the external-idp realm
# Both internal and public redirect URIs are needed (see Troubleshooting section)
curl -sk -X POST "https://localhost/auth/admin/realms/external-idp/clients" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "genie-broker",
    "enabled": true,
    "publicClient": false,
    "secret": "test-broker-secret-12345",
    "standardFlowEnabled": true,
    "directAccessGrantsEnabled": true,
    "redirectUris": [
      "http://localhost:8080/realms/genie/broker/external-idp/endpoint",
      "https://localhost/auth/realms/genie/broker/external-idp/endpoint"
    ],
    "webOrigins": ["http://localhost:8080", "https://localhost"],
    "defaultClientScopes": ["openid", "basic", "profile", "email", "roles"]
  }' -w "\nHTTP: %{http_code}\n"
```

**Verify Step 1**:
```bash
# Check realm exists
curl -sk "https://localhost/auth/admin/realms" -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; [print(r['realm']) for r in json.load(sys.stdin)]"
# Expected: master, genie, external-idp

# Check user exists
curl -sk "https://localhost/auth/admin/realms/external-idp/users" -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; [print(u['username']) for u in json.load(sys.stdin)]"
# Expected: external-test-user

# Check client exists
curl -sk "https://localhost/auth/admin/realms/external-idp/clients" -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; [print(c['clientId']) for c in json.load(sys.stdin)]"
# Expected: ... genie-broker ...
```

## Step 2: Configure the Identity Provider in the Genie Realm

Add an OIDC identity provider in the `genie` realm pointing to the `external-idp` realm:

```bash
# Create OIDC identity provider (201 = created, 409 = already exists)
# IMPORTANT: authorizationUrl uses public URL (browser redirect),
# tokenUrl/userInfoUrl/jwksUrl use internal URL (Keycloak server-to-server inside container)
curl -sk -X POST "https://localhost/auth/admin/realms/genie/identity-provider/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "alias": "external-idp",
    "displayName": "External IdP (Keycloak)",
    "providerId": "oidc",
    "enabled": true,
    "config": {
      "authorizationUrl": "https://localhost/auth/realms/external-idp/protocol/openid-connect/auth",
      "tokenUrl": "http://localhost:8080/realms/external-idp/protocol/openid-connect/token",
      "userInfoUrl": "http://localhost:8080/realms/external-idp/protocol/openid-connect/userinfo",
      "clientId": "genie-broker",
      "clientSecret": "test-broker-secret-12345",
      "jwksUrl": "http://localhost:8080/realms/external-idp/protocol/openid-connect/certs",
      "useJwksUrl": "true",
      "syncMode": "FORCE",
      "trustEmail": "true"
    }
  }' -w "\nHTTP: %{http_code}\n"
```

**Verify Step 2**:
```bash
# List identity providers
curl -sk "https://localhost/auth/admin/realms/genie/identity-provider/instances" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
providers = json.load(sys.stdin)
for p in providers:
    print(f'  alias: {p[\"alias\"]} | providerId: {p[\"providerId\"]} | enabled: {p[\"enabled\"]}')
    print(f'    displayName: {p[\"displayName\"]}')
    print(f'    clientId: {p[\"config\"].get(\"clientId\")}')
"
# Expected:
#   alias: external-idp | providerId: oidc | enabled: True
#     displayName: External IdP (Keycloak)
#     clientId: genie-broker
```

## Step 3: Verify Keycloak Login Page Shows the External IdP

```bash
# Generate PKCE parameters
VERIFIER=$(python3 -c "import secrets,base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))")
CHALLENGE=$(python3 -c "import base64,hashlib; print(base64.urlsafe_b64encode(hashlib.sha256('${VERIFIER}'.encode()).digest()).decode().rstrip('='))")

# Get the login page
curl -skL "https://localhost/auth/realms/genie/protocol/openid-connect/auth?client_id=genie-app&redirect_uri=http://localhost:8090&response_type=code&scope=openid&code_challenge=${CHALLENGE}&code_challenge_method=S256" \
  -o /tmp/keycloak-login.html -w "\nHTTP: %{http_code}\n"

# Check for the external-idp broker link
grep -o 'id="social-external-idp"' /tmp/keycloak-login.html && echo "PASS: External IdP link found on login page"
```

Alternatively, open `https://localhost/auth/realms/genie/protocol/openid-connect/auth?client_id=genie-app&redirect_uri=https://localhost/*&response_type=code&code_challenge=test&code_challenge_method=S256` in a browser —the login page should show an "External IdP (Keycloak)" button.

## Step 4: Broker Redirect (Browser Only)

The broker redirect cannot be tested via curl —Keycloak broker login links contain session tokens that require browser cookies. The broker redirect is fully validated in **Step 7b** (browser test).

To verify the broker URL is present on the login page (from Step 3 output):

```bash
# Extract the broker URL from the login page (informational only)
BROKER_URL=$(grep -oP 'href="\K[^"]*broker/external-idp/login[^"]*' /tmp/keycloak-login.html | sed 's/&amp;/\&/g')
echo "Broker URL: https://localhost${BROKER_URL}"
# Expected: a URL containing /broker/external-idp/login
```

The full broker redirect flow (genie realm -> external-idp realm -> broker exchange -> callback -> dashboard) is tested in Step 7b.

## Step 5: Authenticate at the External IdP

```bash
# Get an external-idp token via ROPC (simulates user authenticating at the external IdP)
EXT_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/external-idp/protocol/openid-connect/token" \
  -d "client_id=genie-broker" \
  -d "client_secret=test-broker-secret-12345" \
  -d "username=external-test-user" \
  -d "password=External123!" \
  -d "grant_type=password" \
  -d "scope=openid email profile" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token','ERROR: '+str(d)))")

echo "External IdP token: ${EXT_TOKEN:0:30}..."

# Verify token claims (issuer must be external-idp realm)
echo "$EXT_TOKEN" | cut -d. -f2 | python3 -c "
import sys,base64,json
payload = base64.urlsafe_b64decode(sys.stdin.read()+'==')
claims = json.loads(payload)
for k in ['iss','aud','email','preferred_username','name']:
    print(f'  {k}: {claims.get(k, \"N/A\")}')
"
# Expected:
#   iss: https://localhost/auth/realms/external-idp
#   email: external-test@example.com
#   preferred_username: external-test-user
```

## Step 6: Verify Token Issued by Genie Realm

In a real browser flow, Keycloak's broker exchanges the external token and issues a **genie realm** token. Via API, we verify the login page correctly references the external-idp broker (Step 3-5 above). The actual brokered token exchange happens through the browser redirect flow.

To verify the genie realm can issue tokens with the correct issuer:

```bash
# Verify genie realm issuer
curl -sk "https://localhost/auth/realms/genie/.well-known/openid-configuration" \
  | python3 -c "import sys,json; print('genie issuer:', json.load(sys.stdin)['issuer'])"
# Expected: https://localhost/auth/realms/genie
```

## Step 7: Verify Frontend Auth State (Browser)

### Step 7a —External IdP Button Visible on Login Page

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/d7a-external-idp-button.spec.js
```
**Expected**: `{ hasExternalIdp: true }`

### Step 7b —Full External IdP Login Flow

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/d7b-external-idp-login-flow.spec.js
```
**Expected**: `hasDashboard: true`, URL is `https://localhost/dashboard`, body contains "GENIE.AI"

> **Note (test environment)**: When `verifyEmail: true` is set on the realm, Keycloak adds `VERIFY_EMAIL` as a required action for brokered users. In production, SMTP sends the verification email and the user continues normally. In the test environment (no SMTP), the Playwright spec temporarily disables the `VERIFY_EMAIL` required action via Admin API before the broker login and re-enables it afterwards. Keycloak 26 unregisters built-in required actions when disabled; the action is fully restored by `keycloak-config-cli` on the next deploy. No subsequent test phases depend on `VERIFY_EMAIL` being enabled.

**On failure**: The Playwright spec captures the current URL and page content so you can see where the flow broke (e.g., stuck on external-idp login, broker error page, or redirect loop).

## Step 8: Cleanup

Remove the test identity provider and realm after testing:

```bash
# Remove the identity provider from genie realm (204 = no content = success)
curl -sk -X DELETE "https://localhost/auth/admin/realms/genie/identity-provider/instances/external-idp" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n"

# Delete the external-idp realm (204 = no content = success)
curl -sk -X DELETE "https://localhost/auth/admin/realms/external-idp" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n"
```

## Phase E: Air-Gapped Deployment Validation

Validates that the entire authentication system functions without external network calls, meeting FR10 (offline/sovereign deployment) and FR36/NFR16 (data residency within deployment boundary).

> **Note**: Phase E tests are split into automated verification (dev agent executes grep/code audit) and manual verification (user executes network isolation). The automated tests below can run on any deployed stack. The manual test (E.5) requires a controlled network environment.

### Test E.1 —Backend Auth Code: No External Calls (AC #1)

Verify that all outbound HTTP calls in backend authentication code target only local services (`KEYCLOAK_URL` / internal).

```bash
# Grep for outbound HTTP patterns in auth-related backend code
grep -rn 'fetch\|axios\.|http\.get\|https\.get' \
  components/gov-chat-backend/services/keycloak-auth-service.js \
  components/gov-chat-backend/services/user-provisioning-service.js \
  components/gov-chat-backend/middleware/keycloak-auth-middleware.js \
  components/gov-chat-backend/routes/auth-routes.js
```

**Expected**:
- `keycloak-auth-service.js`: only `fetch()` calls targeting `KEYCLOAK_URL` (OIDC discovery + JWKS)
- `user-provisioning-service.js`: no outbound HTTP calls (only ArangoDB)
- `keycloak-auth-middleware.js`: no outbound HTTP calls
- `auth-routes.js`: no outbound HTTP calls

### Test E.2 —Keycloak Realm: No External URLs (AC #3)

Verify the Keycloak realm configuration contains no external URLs.

```bash
grep -rn 'http[s]\?://' configs/keycloak/genie-realm.yaml
```

**Expected**: Only `localhost` URLs in `redirectUris` and `webOrigins` fields. Zero external URLs.

### Test E.3 —Frontend OIDC: All Endpoints Local (AC #4)

Verify that all OIDC endpoints in the frontend resolve within the deployment boundary.

```bash
grep -rn 'authority\|redirect_uri\|post_logout' \
  components/gov-chat-frontend/src/config/oidcConfig.js \
  components/gov-chat-frontend/src/services/keycloakAuthService.js
```

**Expected**:
- `authority`: `${keycloakUrl}/realms/${realm}` where `keycloakUrl` defaults to `${origin}/auth`
- `redirect_uri`: `${origin}/callback` (same origin)
- `post_logout_redirect_uri`: `origin` (same origin)

### Test E.4 —Image List: All External Images Documented (AC #2)

Verify that all external images referenced in `docker-compose.yaml` have a corresponding pre-pull entry in `site/content/en/docs/deployment/docker-swarm-setup.md` Step 5d.

```bash
# Extract unique external images from docker-compose.yaml (non-registry-prefixed)
grep -oP 'image:\s*\K(?!.*\$\{)[^\s]+' docker-compose.yaml | sort -u

# Compare against Step 5d list
grep 'docker pull' site/content/en/docs/deployment/docker-swarm-setup.md | awk '{print $3}'
```

**Expected**: All 16 external images (12 runtime + 4 build-time Dockerfiles) appear in both lists. No gaps.

### Test E.5 —Network Isolation: Full Auth Cycle (AC #5)

Validate data residency by running a complete authentication cycle with external network connectivity blocked. **This test requires a deployed stack and must be executed manually.**

#### Method A: iptables (Linux, non-destructive toggle)

```bash
# 1. Block all outbound traffic from Docker except internal subnet
#    Replace <internal-subnet> with your Docker network (e.g., 10.0.0.0/8 or 172.17.0.0/16)
sudo iptables -I DOCKER-USER -o eth0 -d ! <internal-subnet> -j DROP

# 2. Verify stack is still running
docker compose ps

# 3. Run full authentication cycle:
#    - Open browser to https://<your-domain>
#    - Complete login with Keycloak credentials
#    - Verify dashboard loads
#    - Navigate between pages
#    - Log out

# 4. Remove the iptables rule (restore connectivity)
sudo iptables -D DOCKER-USER -o eth0 -d ! <internal-subnet> -j DROP
```

#### Method B: Physical Disconnect (universal)

```bash
# 1. Disconnect from external network (WiFi off / Ethernet unplugged)

# 2. Verify stack is still running
docker compose ps

# 3. Run full authentication cycle (same as Method A step 3)

# 4. Reconnect network
```

**Expected**: Authentication, dashboard loading, page navigation, and logout all function normally with zero external connectivity. Any failure indicates an external dependency in the auth flow.

**Document results in the verification table below (Phase E rows).**

---

---

## Phase F: Token Forwarding to OPEA Services (Service-to-Service Authentication)

**Scope:** This phase tests how the backend authenticates its calls to OPEA services, conditional on OPEA infrastructure availability. There are no `X-User-Id`/`X-User-Roles`/`X-Issuer` headers: the caller's Bearer token is forwarded on every OPEA call, and the chatqna service validates it against Keycloak's JWKS before answering (the internal retriever/reranker hops carry no auth of their own — they are only reachable through chatqna on the internal network). User identity is resolved server-side from the JWT — the auth middleware attaches the provisioned ArangoDB user document to `req.user` and the raw JWT claims to `req.claims`.

**Important:** Token forwarding is verified behaviorally — an OPEA call without a Bearer token is rejected (HTTP 401 by chatqna), and a forwarded token is validated via Keycloak JWKS — plus authenticated endpoint responses (`GET /api/me`).

**Prerequisites:**
- OPEA infrastructure MUST be deployed (`DEPLOY_OPEA=1`) for Phase F full testing
- Phases G–K work with `DEPLOY_OPEA=0`
- Keycloak authentication working (tested in Phase A)
- JWT tokens successfully validated (Stories 1.3, 2.2)
- Backend auth middleware resolves the user server-side (JIT provisioning keyed by the `{iss}#{sub}` identity; profile reads attach the resolved document — its `_key` — to the request, while chat query documents store the composite `{iss}#{sub}` as their `userId`)
- Test F.7 additionally requires the `genie2` realm, created at Phase 0 Step 0.6 when `KEYCLOAK_ADDITIONAL_REALMS=["genie2"]` is set (the backend must also have started AFTER realm creation so its JWKS registrations include genie2)

**Conditional Execution:**
```bash
# Check if Keycloak is available (via NGINX proxy)
if ! curl -sk https://localhost/auth/realms/genie/.well-known/openid-configuration > /dev/null 2>&1; then
  echo "FATAL: Keycloak NOT available - resolve before running Phase F"; exit 1
fi

# Check if OPEA services are responding
# The chat endpoint (POST /api/queries -> the OPEA pipeline) is a reliable
# indicator that the OPEA stack is up (success is HTTP 201; failures and
# timeouts surface as 4xx/5xx/no output). The bound sits above the backend's
# 120 s OPEA worker timeout to leave margin for the rest of the request path —
# a cold vLLM can legitimately take a minute.
PROBE_CODE=$(curl -sk --max-time 180 https://localhost/api/queries -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"ping"}],"sessionId":"e2e-phase-f"}' \
  -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "%{http_code}" 2>/dev/null)
if [ "$PROBE_CODE" = "201" ]; then
  echo "OPEA infrastructure detected - running Phase F tests"
elif [ "$PROBE_CODE" = "401" ]; then
  echo "FATAL: probe rejected with 401 - this is a token problem, not an OPEA outage; re-acquire \$USER_TOKEN"; exit 1
else
  echo "OPEA services not fully available (probe answered HTTP ${PROBE_CODE:-none}) - Phase F tests will be limited to the backend-side verification (token validation and user resolution)"
  echo "Set DEPLOY_OPEA=1 in .env and redeploy for full Phase F coverage"
fi
```

### Test F.1 — JWT Is Verified and the User Is Resolved on Every Request

**Given** a user has authenticated via Keycloak and received a valid JWT
**When** the request is processed by the backend auth middleware (`keycloak-auth-middleware.js`)
**Then** the token is verified against Keycloak's JWKS (cached, 5-minute TTL)
- **And** the JIT provisioning resolves (or creates) the user's ArangoDB document, keyed by the composite `{iss}#{sub}` identity
- **And** the middleware attaches the ArangoDB user document to `req.user` and the raw JWT claims to `req.claims` (including `iss`, `sub`, `realm_access.roles`)

**Verification:**
```bash
# Get test user token (use existing test user)
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')

# One authenticated profile request provides the log entry under test and
# yields the _key — resolve via /api/me, never by email (see README
# "Resolving test accounts")
RESPONSE=$(curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: profile request answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
USER_KEY=$(echo "$RESPONSE" | head -n -1 | jq -r '._key')
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }

# Verify the profile-retrieval log carries the ArangoDB _key (no output is a
# failure; the quoted field makes the match exact, and --since bounds the
# window — any entry for this _key within the window satisfies it)
docker compose logs backend --since 1m 2>&1 | grep "user_profile_retrieved" | grep -F "\"userKey\":\"$USER_KEY\"" \
  || { echo "FATAL: no profile-retrieval log entry for the resolved _key"; exit 1; }
```

> **Note:** This test uses the user profile endpoint (`GET /api/me`) as the authenticated route, then inspects the backend's profile-retrieval log to verify the request resolved the account's ArangoDB `_key`.

**Expected Behavior:**
- The profile-retrieval log entry for the request carries the resolved ArangoDB `_key` (the check above is the assertion)

---

### Test F.2 — The Bearer Token Is Forwarded to OPEA Services

**Given** an authenticated request is made to an OPEA service endpoint
**When** the backend calls an OPEA service via the worker thread (`opea-worker.js`)
**Then** the caller's `Authorization: Bearer` header is forwarded on the OPEA HTTP request
- **And** the chatqna service validates that token against Keycloak's JWKS before answering

**Verification:**
```bash
# Get a valid token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')
[ -n "$USER_TOKEN" ] && [ "$USER_TOKEN" != "null" ] || { echo "FATAL: ROPC login for testuser failed"; exit 1; }

# Requires DEPLOY_OPEA=1: both halves of this test call chatqna
if ! docker ps --format '{{.Names}}' | grep -q "chatqna-xeon-backend-server"; then
  echo "SKIP: chatqna not deployed (DEPLOY_OPEA=0) - run F.1/F.3 for the backend-side verification"
else
  # Make a chat query — it can only succeed if the backend forwarded the
  # Bearer token AND chatqna validated it against Keycloak JWKS.
  # (Requires a real OPEA pipeline: CONTEXT_OPTION=test-mode bypasses the
  # OPEA call and answers 201 with a mock, exercising nothing.)
  # (POST /api/queries is the chat endpoint; the bound sits above the
  # backend's 120 s OPEA worker timeout — a cold vLLM can take a minute)
  HTTP_CODE=$(curl -sk --max-time 180 -X POST "https://localhost/api/queries" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Hello E2E test"}],"sessionId":"e2e-phase-f"}' \
    -o /dev/null -w "%{http_code}")
  echo "Chat with forwarded token: HTTP ${HTTP_CODE}"
  [ "$HTTP_CODE" = "201" ] || { echo "FATAL: expected 201, got ${HTTP_CODE}"; exit 1; }

  # From inside the network, chatqna without a Bearer token is rejected —
  # the same auth gate the forwarded token just passed.
  # Pick the backend container explicitly: the name filter would otherwise
  # also match the chatqna container (its compose name contains
  # "backend-server"). The backend runtime image ships wget (not curl);
  # the body travels via --body-data (--post-data is rejected with --method).
  BACKEND_CID=$(docker ps --filter name=backend --format '{{.Names}}' | grep -v -e chatqna -e init | head -1)
  [ -n "$BACKEND_CID" ] || { echo "FATAL: backend container not found"; exit 1; }
  HTTP_CODE=$(docker exec "$BACKEND_CID" \
    wget -q -O /dev/null --server-response --method=POST \
      --header="Content-Type: application/json" \
      --body-data='{"messages":[{"role":"user","content":"ping"}]}' \
      "http://chatqna-xeon-backend-server:8888/v1/chatqna" 2>&1 \
    | awk '$1 ~ /^HTTP\//{print $2}' | tail -1)
  echo "Chatqna without token: HTTP ${HTTP_CODE}"
  [ "$HTTP_CODE" = "401" ] || { echo "FATAL: expected 401, got ${HTTP_CODE}"; exit 1; }
fi
```

> **Note:** Both halves of this test require `DEPLOY_OPEA=1` in `.env`. Without OPEA services the test skips — F.1/F.3 cover the backend-side verification.

**Expected Behavior:**
- chatqna receives the caller's `Authorization: Bearer` header unchanged
- The forwarded token is validated by chatqna against Keycloak JWKS
- An OPEA call without a Bearer token is rejected with HTTP 401 (`Missing or malformed Authorization header`)

---

### Test F.3 — The Resolved Identity Is the ArangoDB _Key

**Given** a Keycloak realm with a freshly created user (cross-realm isolation is Test F.7's)
**When** the user's token makes authenticated requests
**Then** the backend resolves that user's own provisioned ArangoDB document — the `_key` is the profile-read identity:
  - Genie realm token -> the genie-realm user's `_key` (e.g., `12345`)

**Verification:**
```bash
# Re-acquire the MASTER admin token inline: Phase 0 Step 0.8 leaves $TOKEN
# holding testuser's ROPC token, which cannot manage the realm. The
# genie-realm admin-cli route is not usable either — the env template ships
# GENIE_ADMIN_PASSWORD empty, so that login cannot succeed on a clean stack.
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "FATAL: master admin login failed - is KEYCLOAK_ADMIN_PASSWORD set (source .env, see Phase 0)?"; exit 1; }

# Create user in genie realm (if not exists) — firstName/lastName/emailVerified
# are required for ROPC logins to succeed (see .claude/rules/SERVER-TESTING.md)
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "e2e-test-user",
    "email": "e2e@example.com",
    "firstName": "E2E",
    "lastName": "Test",
    "emailVerified": true,
    "enabled": true,
    "credentials": [{ "type": "password", "value": "e2epass123", "temporary": false }]
  }'

# Get user token from genie realm — phase-local name ($USER_TOKEN is the
# Phase 0 testuser token; never shadow it)
E2E_TEST_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=e2e-test-user&password=e2epass123&grant_type=password' | jq -r '.access_token')
[ -n "$E2E_TEST_TOKEN" ] && [ "$E2E_TEST_TOKEN" != "null" ] || { echo "FATAL: ROPC login for e2e-test-user failed"; exit 1; }

# Resolve the _key from the user's own profile — see README
# "Resolving test accounts" (never key an account by email)
USER_KEY=$(curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $E2E_TEST_TOKEN" | jq -r '._key')
# Fail loudly here — a silent "null" would surface far from the cause
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }

echo "User _key: $USER_KEY"

# The _key-resolving request above went through the auth middleware — verify
# the profile-retrieval log carries that _key (window-bounded: any entry for
# this _key within the window satisfies it)
docker compose logs backend --since 1m 2>&1 | grep "user_profile_retrieved" | grep -F "\"userKey\":\"$USER_KEY\"" \
  || { echo "FATAL: no profile-retrieval log entry for the resolved _key"; exit 1; }
# Expected: a log entry whose userKey equals the resolved _key
```

> **Note:** This test uses the user profile endpoint and backend log inspection.

**Expected Behavior:**
- Profile reads attach the resolved ArangoDB document — its `_key` is the identity those requests carry
- Different users from different realms have unique ArangoDB `_key` values
- No collision between user identities across realms (chat query documents store the composite `{iss}#{sub}` as `userId`, never a realm-mingled identity)

---

### Test F.4 — Invalid Tokens Are Rejected Before Any OPEA Call

**Given** a request carries no token, a malformed token or a token that fails Keycloak verification
**When** the backend auth middleware processes it
**Then** the request is rejected with HTTP 401 before any OPEA service is called

**Verification:**
```bash
# No Authorization header at all
HTTP_CODE=$(curl -sk --max-time 30 -X POST "https://localhost/api/queries" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"No token"}]}' \
  -o /dev/null -w "%{http_code}")
echo "No token: HTTP ${HTTP_CODE}"
[ "$HTTP_CODE" = "401" ] || { echo "FATAL: expected 401, got ${HTTP_CODE}"; exit 1; }

# Token that fails JWKS validation
HTTP_CODE=$(curl -sk --max-time 30 -X POST "https://localhost/api/queries" \
  -H "Authorization: Bearer not-a-real-token" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Bad token"}]}' \
  -o /dev/null -w "%{http_code}")
echo "Invalid token: HTTP ${HTTP_CODE}"
[ "$HTTP_CODE" = "401" ] || { echo "FATAL: expected 401, got ${HTTP_CODE}"; exit 1; }

# Structurally valid token with a tampered signature — this is the case
# that reaches Keycloak JWKS verification (the two above fail earlier, as
# malformed). The replacement char is chosen to differ from the original
# last char, so the mutation can never be a no-op.
LAST=${USER_TOKEN: -1}
REPL=y; [ "$LAST" = "y" ] && REPL=z
TAMPERED="${USER_TOKEN%?}${REPL}"
HTTP_CODE=$(curl -sk --max-time 30 -X POST "https://localhost/api/queries" \
  -H "Authorization: Bearer $TAMPERED" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Tampered token"}]}' \
  -o /dev/null -w "%{http_code}")
echo "Tampered signature: HTTP ${HTTP_CODE}"
[ "$HTTP_CODE" = "401" ] || { echo "FATAL: expected 401, got ${HTTP_CODE}"; exit 1; }
```

> **Note:** The backend middleware is the first auth gate — a token it rejects never reaches an OPEA service. Downstream validation of the tokens it does forward is covered by Test F.2.

**Expected Behavior:**
- Missing or malformed Authorization header -> HTTP 401 `TOKEN_INVALID` before any handler runs
- A token failing signature verification -> HTTP 401, no OPEA call is made
- OPEA services never receive unauthenticated traffic from the backend

---

### Test F.5 — OPEA Service Response Structure

**Given** an authenticated chat request is forwarded to the OPEA chatqna service
**When** the OPEA pipeline answers
**Then** the backend stores the answer on the query document — the response carries `queryId`, `response`, `metadata` and `responseTime`
**And** the `metadata` block keeps the chatqna structure (source documents, retrieval/self confidence, groundedness)

**Verification:**
```bash
# Get test user token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')
[ -n "$USER_TOKEN" ] && [ "$USER_TOKEN" != "null" ] || { echo "FATAL: ROPC login for testuser failed"; exit 1; }

# Make chat query (like F.2, this half needs a real OPEA pipeline — it is
# skipped when chatqna is not deployed)
if ! docker ps --format '{{.Names}}' | grep -q "chatqna-xeon-backend-server"; then
  echo "SKIP: chatqna not deployed (DEPLOY_OPEA=0) - Test F.5 requires the OPEA pipeline; run F.1/F.3 for the backend-side verification"
else
  HTTP_CODE=$(curl -sk --max-time 180 -X POST "https://localhost/api/queries" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Verify response structure"}],"sessionId":"e2e-phase-f"}' \
    -o /tmp/f5-body.json -w "%{http_code}")
  [ "$HTTP_CODE" = "201" ] || { echo "FATAL: expected 201, got ${HTTP_CODE}"; exit 1; }
  RESPONSE=$(cat /tmp/f5-body.json)

  # Verify top-level response structure
  echo "$RESPONSE" | jq 'keys | sort'
  # Expected: ["metadata","queryId","response","responseTime"]

  # Verify the chatqna metadata contract keys are present
  echo "$RESPONSE" | jq -e '.metadata | has("source_documents") and has("filter_labels") and has("retrieval_confidence_score") and has("confidence_score") and has("is_grounded")' > /dev/null \
    || { echo "FATAL: metadata contract keys missing"; exit 1; }
  echo "metadata contract keys present"

  # Verify the OPEA answer came through
  RESP_LEN=$(echo "$RESPONSE" | jq '.response | length')
  [ "$RESP_LEN" -gt 0 ] 2>/dev/null || { echo "FATAL: empty or missing .response in the chat answer"; exit 1; }
  echo "response length: ${RESP_LEN}"
fi
```

**Expected Behavior:**
- Other payload fields remain unchanged across OPEA upgrades (the response and metadata shapes asserted above are the contract)

---

### Test F.6 — Missing realm_access.roles Claim Handling

**Given** a JWT token from a user with no realm role assignments (`realm_access.roles` carries only Keycloak's defaults, never `admin`)
**When** the backend auth middleware processes the request
**Then** authentication still succeeds — roles are never required to authenticate
- **And** role-gated endpoints deny the request from the JWT claims (`requireAdmin` -> HTTP 403)

**Verification:**
```bash
# Token for e2e-test-user (created in Test F.3 — no realm roles assigned)
NO_ROLES_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=e2e-test-user&password=e2epass123&grant_type=password' | jq -r '.access_token')
[ -n "$NO_ROLES_TOKEN" ] && [ "$NO_ROLES_TOKEN" != "null" ] || { echo "FATAL: ROPC login for e2e-test-user failed"; exit 1; }

# Verify the token has no realm roles
python3 -c "
import base64, json, sys
p = sys.argv[1].split('.')[1]
p += '=' * (-len(p) % 4)
c = json.loads(base64.urlsafe_b64decode(p))
print('realm roles:', (c.get('realm_access') or {}).get('roles'))
" "$NO_ROLES_TOKEN"
# Expected: a role list that does NOT contain "admin" (Keycloak still adds
# its default roles — offline_access, uma_authorization, default-roles-<realm>)

# Authentication succeeds without roles — the profile endpoint answers
HTTP_CODE=$(curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $NO_ROLES_TOKEN" -o /dev/null -w "%{http_code}")
echo "Profile with no roles: HTTP ${HTTP_CODE}"
[ "$HTTP_CODE" = "200" ] || { echo "FATAL: expected 200, got ${HTTP_CODE}"; exit 1; }

# Role-gated endpoints deny from the JWT claims
HTTP_CODE=$(curl -sk -X GET "https://localhost/api/admin/system-health" \
  -H "Authorization: Bearer $NO_ROLES_TOKEN" -o /dev/null -w "%{http_code}")
echo "Admin endpoint with no roles: HTTP ${HTTP_CODE}"
[ "$HTTP_CODE" = "403" ] || { echo "FATAL: expected 403 (Admin access required), got ${HTTP_CODE}"; exit 1; }
```

> **Note:** Roles are read fresh from the JWT (`req.claims.realm_access.roles`) on every request — never from the ArangoDB user document, which may be cached.

**Expected Behavior:**
- Missing or empty `realm_access.roles` -> authentication still succeeds
- No crashes or errors anywhere in the middleware
- `requireAdmin` denies with HTTP 403 when the `admin` role is absent from the token
- The OPEA path itself is role-independent — a role-less token completing a chat is covered by Test F.8

---

### Test F.7 — Multi-Realm Identity Isolation

**Given** two Keycloak realms exist: `genie` and `genie2`
**When** tokens from each realm make requests
**Then** each realm resolves a different provisioned ArangoDB document (distinct `_key`) — one realm's token can never address the other realm's account
- **And** every role check reads the claims of the caller's own token (role handling is covered by Test F.6)

**Verification:**
```bash
# Get the MASTER admin token — Keycloak's Admin REST is realm-scoped, so a
# genie-realm admin token cannot manage genie2 (see .claude/rules/SERVER-TESTING.md)
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "FATAL: master admin login failed - is KEYCLOAK_ADMIN_PASSWORD set (source .env, see Phase 0)?"; exit 1; }

# Create a user in genie realm (firstName/lastName/emailVerified are required
# for ROPC logins to succeed — see .claude/rules/SERVER-TESTING.md)
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "genie-realm-user",
    "email": "genie@example.com",
    "firstName": "Genie",
    "lastName": "User",
    "emailVerified": true,
    "enabled": true,
    "credentials": [{ "type": "password", "value": "geniepass123", "temporary": false }]
  }'

# Create a user in genie2 realm
curl -sk -X POST "https://localhost/auth/admin/realms/genie2/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "genie2-realm-user",
    "email": "genie2@example.com",
    "firstName": "Genie2",
    "lastName": "User",
    "emailVerified": true,
    "enabled": true,
    "credentials": [{ "type": "password", "value": "genie2pass123", "temporary": false }]
  }'

# Get tokens from both realms — phase-local names ($USER_TOKEN/$USER2_TOKEN
# belong to Phase 0/Phase I; never shadow them)
GENIE_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=genie-realm-user&password=geniepass123&grant_type=password' | jq -r '.access_token')
[ -n "$GENIE_TOKEN" ] && [ "$GENIE_TOKEN" != "null" ] || { echo "FATAL: ROPC login for genie-realm-user failed"; exit 1; }
GENIE2_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie2/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=genie2-realm-user&password=genie2pass123&grant_type=password' | jq -r '.access_token')
[ -n "$GENIE2_TOKEN" ] && [ "$GENIE2_TOKEN" != "null" ] || { echo "FATAL: ROPC login for genie2-realm-user failed"; exit 1; }

# Look up user keys from each user's own profile (each realm provisions its
# own ArangoDB user, so the _key differs per realm) — resolve via /api/me,
# never by email (see README "Resolving test accounts"; the per-request
# profile-retrieval log check itself is Test F.1's)
RESPONSE=$(curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $GENIE_TOKEN" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: genie realm profile request answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
GENIE_USER_KEY=$(echo "$RESPONSE" | head -n -1 | jq -r '._key')
[ -n "$GENIE_USER_KEY" ] && [ "$GENIE_USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key for the genie realm user"; exit 1; }

RESPONSE=$(curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $GENIE2_TOKEN" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: genie2 realm profile request answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
GENIE2_USER_KEY=$(echo "$RESPONSE" | head -n -1 | jq -r '._key')
[ -n "$GENIE2_USER_KEY" ] && [ "$GENIE2_USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key for the genie2 realm user"; exit 1; }

# The whole point of the test: distinct realms must resolve distinct ArangoDB docs
[ "$GENIE_USER_KEY" != "$GENIE2_USER_KEY" ] || { echo "FATAL: both realms resolved the same ArangoDB _key"; exit 1; }
```

> **Note:** This test uses user profile endpoints. Each user from a different realm gets a unique ArangoDB `_key`.

**Expected Behavior:**
- Each realm resolves a unique ArangoDB `_key` (distinct provisioned user per realm)
- No cross-contamination between realms

---

### Test F.8 — OPEA Compatibility: End-to-End Chat With Forwarded Token

**Given** the chatqna service validates the forwarded Bearer token against Keycloak's JWKS
**When** a full chat round-trip runs (backend -> chatqna -> retrieval -> LLM)
**Then** the OPEA services function normally with the forwarded token
**And** the retrieval metadata comes back intact (the response-shape checks themselves are Test F.5's)

**Verification:**
```bash
# Get test user token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')
[ -n "$USER_TOKEN" ] && [ "$USER_TOKEN" != "null" ] || { echo "FATAL: ROPC login for testuser failed"; exit 1; }

# Make chat query (full round-trip — needs a real OPEA pipeline; skipped
# when chatqna is not deployed)
if ! docker ps --format '{{.Names}}' | grep -q "chatqna-xeon-backend-server"; then
  echo "SKIP: chatqna not deployed (DEPLOY_OPEA=0) - Test F.8 requires the OPEA pipeline; run F.1/F.3 for the backend-side verification"
else
  HTTP_CODE=$(curl -sk --max-time 180 -X POST "https://localhost/api/queries" \
    -H "Authorization: Bearer $USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Payload preservation test"}],"sessionId":"e2e-phase-f"}' \
    -o /tmp/f8-body.json -w "%{http_code}")
  [ "$HTTP_CODE" = "201" ] || { echo "FATAL: expected 201, got ${HTTP_CODE}"; exit 1; }
  RESPONSE=$(cat /tmp/f8-body.json)

  # Verify the retrieval metadata survived the round-trip
  echo "$RESPONSE" | jq -e '.metadata.is_grounded != null' > /dev/null \
    || { echo "FATAL: metadata.is_grounded missing after the round-trip"; exit 1; }
  echo "metadata.is_grounded present"
fi
```

**Expected Behavior:**
- OPEA services function normally with the forwarded Bearer token

---

## Phase G: Swagger UI OAuth2 Authentication

Validates that the Swagger UI includes a Keycloak OIDC "Authorize" button, allowing developers to test protected endpoints with an authenticated session directly from the API documentation interface (FR25).

> **Note**: This phase validates the Swagger UI OAuth2 integration implemented in Story 2.8. Tests cover both the Swagger specification configuration and the complete browser-based authentication flow.

### Prerequisites

- Stack is deployed and healthy (from Phase 0)
- Test user exists (from Phase 0, Step 0.8) — the venue `testuser` carries no realm role
- Swagger UI is accessible at `/api-docs` as a public route
- Keycloak client `genie-app` is configured with correct redirect URIs

### Test G.1 — Swagger Spec Contains OAuth2 Security Scheme

Verify that the generated OpenAPI specification includes the Keycloak OIDC security scheme.

```bash
# Fetch the Swagger specification
curl -sk https://localhost/api-docs.json | jq '.components.securitySchemes'
```

**Expected**: The output includes `KeycloakOAuth2` with OAuth2 authorizationCode flow configuration:

```json
{
  "KeycloakOAuth2": {
    "type": "oauth2",
    "description": "Keycloak OAuth2 authentication",
    "flows": {
      "authorizationCode": {
        "authorizationUrl": "https://localhost/auth/realms/genie/protocol/openid-connect/auth",
        "tokenUrl": "https://localhost/auth/realms/genie/protocol/openid-connect/token",
        "scopes": {
          "openid": "OpenID Connect scope",
          "profile": "User profile information"
        }
      }
    }
  }
}
```

**On failure**:
- Check `components/gov-chat-backend/index.js` for `securitySchemes` configuration
- Verify environment variables `KEYCLOAK_URL` and `KEYCLOAK_REALM` are set
- Restart the backend service after configuration changes

### Test G.2 — Swagger UI is Public (No Auth Required)

Verify that `/api-docs` is accessible without authentication.

```bash
curl -skL https://localhost/api-docs -o /dev/null -w "HTTP %{http_code}\n"
```

**Expected**: `HTTP 200`

**On failure**: Check that `/api-docs` is in `PUBLIC_PATHS` in `keycloak-auth-middleware.js`.

### Test G.3 — Verify Keycloak Client Redirect URIs

The `genie-app` client must include the Swagger UI URL in its redirect URIs for the OAuth2 flow to work.

```bash
source .env
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  -d "grant_type=password" | jq -r '.access_token')

# Check client configuration
curl -sk "https://localhost/auth/admin/realms/genie/clients?clientId=genie-app" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0] | {
    redirectUris,
    webOrigins,
    standardFlowEnabled
  }'
```

**Expected**: The output includes:
```json
{
  "redirectUris": [
    "https://localhost/*",
    "https://localhost/api-docs*",
    "... other redirect URIs"
  ],
  "webOrigins": [
    "https://localhost"
  ]
  ],
  "standardFlowEnabled": true
}
```

**On failure** -- Add the redirect URIs:

```bash
GENIE_APP_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/clients?clientId=genie-app" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

curl -sk -X PUT "https://localhost/auth/admin/realms/genie/clients/${GENIE_APP_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "redirectUris": [
      "https://localhost/*",
      "https://localhost/api-docs*"
    ],
    "webOrigins": ["https://localhost"],
    "standardFlowEnabled": true
  }' -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP 204` (no content = success)

### Test G.4 — Browser Test: Authorize Button Visible and Functional

This test requires Playwright with HTTPS context (see Phase 0, Test Tools).

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/g1-swagger-authorize.spec.js
```

**Expected**:
- Swagger UI container found
- Authorize button visible
- Authorization modal opened
- Keycloak OAuth2 link visible
- Authorization URL contains correct realm (`realms/genie`)
- Authorization URL contains correct `client_id=genie-app`

**On failure**: See Troubleshooting section below.

### Test G.5 — Browser Test: Complete OAuth2 Authentication Flow

Validate the end-to-end flow: click authorize -> login to Keycloak -> token returned to Swagger UI.

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/g1-swagger-authorize.spec.js
```

**Expected**:
- Popup URL contains Keycloak authorization endpoint
- Login form is present
- After login, popup closes
- Authorize button shows locked/authorized state

**On failure**: See Troubleshooting section below.

### Test G.6 — Browser Test: Authenticated API Call

Verify that after authentication, Swagger UI can successfully call protected endpoints.

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/g1-swagger-authorize.spec.js
```

**Expected**:
- Response code is NOT 401
- Protected endpoint returns data

**On failure**: Check the test user's provisioning state (Phase 0, Step 0.8) — the venue `testuser` carries no realm role.

---

### Troubleshooting: Swagger UI OAuth2

#### Issue: "Authorize button not found"

**Symptoms**: Playwright test cannot locate the authorize button.

**Root causes**:
1. Swagger UI did not load (check for 404 or 500 errors)
2. Swagger UI version different from expected (button selector changed)
3. Custom CSS hid the authorize button

**Fix**:
```bash
# Verify Swagger UI HTML is served
curl -sk https://localhost/api-docs | grep -o '<title>.*</title>'

# Check for swagger-ui-express version
grep 'swagger-ui-express' components/gov-chat-backend/package.json
```

#### Issue: "Keycloak authorization link not found in modal"

**Symptoms**: Authorization modal opens but no link to Keycloak.

**Root causes**:
1. `securitySchemes` not configured in Swagger options
2. OAuth2 flow type mismatch (authorization code vs implicit)

**Fix**:
```bash
# Verify the spec contains OAuth2 scheme
curl -sk https://localhost/api-docs.json | jq '.components.securitySchemes'

# Check that authorizationCode flow is configured (not implicit)
curl -sk https://localhost/api-docs.json | jq '.components.securitySchemes.KeycloakOAuth2.flows'
```

#### Issue: "invalid_redirect_uri" after clicking authorize link

**Symptoms**: Keycloak returns "Invalid redirect URI" error in the popup.

**Root causes**:
1. `genie-app` client redirect URIs do not include the Swagger UI URL
2. Wrong protocol (http vs https)

**Fix**: See Test G.3 above for adding redirect URIs to the Keycloak client.

#### Issue: "CSP violation" when clicking authorize

**Symptoms**: Browser console shows CSP violations; Keycloak redirect blocked.

**Root causes**:
1. CSP `connect-src` does not include Keycloak URL
2. Keycloak URL is different from Swagger UI origin

**Fix**:
```bash
# Check current CSP configuration
grep CSP_CONNECT_SRC .env

# Add Keycloak URL to CSP (if different from origin)
export CSP_CONNECT_SRC="'self' https://localhost http://localhost:8080"

# Restart backend after change
docker compose restart backend
```

#### Issue: "Authorization code flow not supported"

**Symptoms**: Error message about PKCE or authorization code flow.

**Root causes**:
1. Swagger UI version incompatible with authorization code flow
2. Missing token URL configuration

**Fix**: Verify that the Swagger configuration explicitly sets `authorizationCode` flow (not `implicit`):

```javascript
// In components/gov-chat-backend/index.js
components: {
  securitySchemes: {
    KeycloakOAuth2: {
      type: 'oauth2',
      flows: {
        authorizationCode: {  // Must be authorizationCode, not implicit
          authorizationUrl: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/auth`,
          tokenUrl: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
          scopes: { openid: '...', profile: '...' }
        }
      }
    }
  }
}
```

#### Issue: "401 Unauthorized" on protected endpoint after OAuth2 auth

**Symptoms**: OAuth2 flow completes but API calls still return 401.

**Root causes**:
1. Swagger UI not including the Authorization header in requests
2. Token expired or invalid
3. Test user mis-provisioned

**Fix**:
1. Open browser DevTools Network tab while executing a request
2. Check if `Authorization: Bearer <token>` header is present
3. Verify the test user exists and can log in (the venue `testuser`
   carries no realm role — re-run the Phase 0 provisioning script if in doubt):
```bash
curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0] | {username, enabled, emailVerified}'
```

---

## Phase H: JWKS Force-Refresh (Story 2-2)

**Playwright spec**: `npx playwright test tests/e2e/auth/h1-jwks-force-refresh.spec.js`

Validates that the backend force-refreshes its JWKS cache when token signature validation fails but the token is not expired. The middleware implements a two-attempt pattern: (1) verify with cached keys → fail, (2) force-refresh JWKS → retry → succeed.

### Prerequisites

- Phase 0 complete (`$TOKEN` and `$USER_TOKEN` available)
- Stack deployed with Keycloak and backend services

### Test H.1 — Verify Valid Token Passes with Cached JWKS

Confirm baseline: a valid user token is accepted by the backend.

```bash
# Get user token (if not already available)
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Get the authenticated user's profile (any authenticated endpoint)
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Status: OK, User: {d.get(\"name\", \"N/A\")}')"
```

**Expected**: `Status: OK, User: Test User` (or similar user profile data)

### Test H.2 — Rotate Realm Signing Keys

Generate a new RSA signing key via the Keycloak Admin API and demote the
old one — the manual counterpart of `rotateRealmKeys` in
`tests/e2e/helpers/keycloak-admin.js` (the helper the H.1 Playwright spec
drives). This simulates a key rotation event.

A Keycloak 26 realm carries FOUR key providers by default — `rsa-generated`
(the RSA signer), `rsa-enc-generated` (the RSA encryption pair),
`hmac-generated-hs512` (the HMAC signer) and `aes-generated` (the AES
encryptor), all at priority 100. The rotation touches the RSA SIGNING
provider only: the HMAC, AES and encryption providers must stay active,
because demoting one breaks HMAC-signed tokens or token encryption — with
its encryption signer gone the realm mints a `fallback-RSA-OAEP` provider,
and tokens encrypted to the original key can no longer be decrypted.

The rotated key's NAME carries a timestamp — `rsa-generated-rotated-<ts>`,
the same shape the helper mints and REUSES on a re-run. A key created
under any other name is never reused: the next rotation mints a second
active rotated signer.

```bash
# Get realm UUID (needed as parentId for key components)
REALM_ID=$(curl -sk "https://localhost/auth/admin/realms/genie" \
  -H "Authorization: Bearer $TOKEN" | jq -r .id)
echo "Realm UUID: $REALM_ID"

# Generate the new RSA key pair (priority 101 = higher than the default's
# 100 = becomes the active signer). The timestamped name is the helper's
# reuse contract: a re-run adopts this key instead of minting a second one.
ROTATED_NAME="rsa-generated-rotated-$(date +%s)"
curl -sk -X POST "https://localhost/auth/admin/realms/genie/components" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
    "name": "'$ROTATED_NAME'",
    "providerId": "rsa-generated",
    "providerType": "org.keycloak.keys.KeyProvider",
    "parentId": "'$REALM_ID'",
    "config": {
      "priority": ["101"],
      "enabled": ["true"],
      "active": ["true"],
      "keySize": ["2048"]
    }
  }' -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 201` (the new key component created; the components API answers with an EMPTY body — the new component id travels in the Location header)

```bash
# List key providers to verify rotation
curl -sk "https://localhost/auth/admin/realms/genie/components?type=org.keycloak.keys.KeyProvider" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
components = json.load(sys.stdin)
for c in components:
    name = c.get('name', 'N/A')
    priority = c.get('config', {}).get('priority', ['?'])[0]
    active = c.get('config', {}).get('active', ['?'])[0]
    print(f'  {name}: priority={priority}, active={active}')
"
```

**Expected**: FIVE key providers listed — the four defaults of a Keycloak 26 realm (`rsa-generated`, `rsa-enc-generated`, `hmac-generated-hs512`, `aes-generated`, all at priority 100 and active) plus the rotated one, `rsa-generated-rotated-<ts>`, at `priority=101, active=true`.

```bash
# Demote the old RSA SIGNING key(s): every provider whose providerId is an
# RSA signer and that is NOT the rotated key. Never pick a demotion target
# by "priority != 101": on a default realm that lands on the RSA
# encryption provider or the HMAC signer, and deactivating it breaks the
# realm.
OLD_KEY_IDS=$(curl -sk "https://localhost/auth/admin/realms/genie/components?type=org.keycloak.keys.KeyProvider" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
components = json.load(sys.stdin)
rotated = '$ROTATED_NAME'
for c in components:
    if c.get('providerId') in ('rsa', 'rsa-generated') and c.get('name') != rotated:
        print(c['id'])
")

# Demote each: get the full component, set active=false, PUT it back
for OLD_KEY_ID in $OLD_KEY_IDS; do
  curl -sk "https://localhost/auth/admin/realms/genie/components/$OLD_KEY_ID" \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
c = json.load(sys.stdin)
c['config']['active'] = ['false']
print(json.dumps(c))
" | curl -sk -X PUT "https://localhost/auth/admin/realms/genie/components/$OLD_KEY_ID" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- -w "\nHTTP: %{http_code}\n"
done
```

**Expected**: `HTTP: 204` for each demoted key. The listing now shows the rotated key active (`priority=101, active=true`), the old `rsa-generated` passive (`active=false`), and `rsa-enc-generated`, `hmac-generated-hs512` and `aes-generated` still active.

### Test H.3 — Verify Old Token Triggers Force-Refresh and Succeeds

Use the SAME `$USER_TOKEN` from H.1 (signed with the old key). The backend should: detect signature failure → force-refresh JWKS → retry verification → succeed.

```bash
# Use the SAME token from H.1 (signed with old key, not yet expired)
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 200` with user profile data. The backend's JWKS force-refresh mechanism successfully fetched the new signing key and validated the token.

```bash
# Verify force-refresh in backend logs
docker compose logs backend 2>&1 | tail -20 | grep -i "force.refresh\|JWKS\|retry"
```

**Expected**: Log line mentioning JWKS force-refresh or retry (exact message may vary by implementation)

### Test H.4 — Verify Corrupted Token is Rejected Without Retry

A corrupted token (invalid signature) should be rejected immediately with `TOKEN_INVALID` — the backend must NOT attempt JWKS refresh for structurally invalid tokens.

> **Note**: Expired token rejection (`TOKEN_EXPIRED`) is tested in Phase K.2. H.4 specifically tests that a token with an invalid signature does not trigger JWKS refresh.

```bash
# Corrupt the token by modifying characters near the end
CORRUPTED_TOKEN=$(echo "$USER_TOKEN" | sed 's/.\{5\}$/XXXXX/')

curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $CORRUPTED_TOKEN" | jq .
```

**Expected**: `HTTP: 401` with `{"error": "TOKEN_INVALID", ...}`

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/h1-jwks-force-refresh.spec.js
```

---

## Phase I: Multi-Realm Configuration (Story 2-9)

**Playwright spec**: `npx playwright test tests/e2e/auth/i1-multi-realm.spec.js`

Validates that the backend can validate tokens from multiple Keycloak realms simultaneously, maintaining separate user identities via the `{iss}#{sub}` composite key in ArangoDB.

### Prerequisites

- Phase 0 complete (`$TOKEN` available)
- **IMPORTANT**: `KEYCLOAK_ADDITIONAL_REALMS=["genie2"]` must be set in `.env` BEFORE deploying the stack. The additional realms must be created in Keycloak before the backend starts — see Phase 0, Step 0.6.

### Test I.1 — Verify `genie2` Realm Exists and Create Test User

The `genie2` realm and client should already exist from Phase 0, Step 0.6. Verify and create the test user.

```bash
# Verify realm exists (should return 200, not 404)
curl -sk "https://localhost/auth/admin/realms/genie2" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
```

**Expected**: `HTTP: 200`

```bash
# Create test user in genie2 realm (201 = created, 409 = already exists — OK)
curl -sk -X POST "https://localhost/auth/admin/realms/genie2/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
    "username": "testuser2",
    "enabled": true,
    "email": "testuser2@genie2.local",
    "firstName": "Test",
    "lastName": "User2",
    "credentials": [{"type": "password", "value": "TestPass123!", "temporary": false}]
  }' -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 201` or `HTTP: 409` (user already exists from previous run)

### Test I.2 — Get Token from `genie2` Realm and Verify Different `iss`

```bash
# Get token from genie2 realm
USER2_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie2/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser2" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Verify issuer
echo "$USER2_TOKEN" | cut -d. -f2 | python3 -c "
import sys, base64, json
p = sys.stdin.read().strip()
claims = json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))
print(f'iss: {claims[\"iss\"]}')
print(f'azp: {claims[\"azp\"]}')
print(f'preferred_username: {claims.get(\"preferred_username\", \"N/A\")}')
"
```

**Expected**: `iss: https://localhost/auth/realms/genie2`, `azp: genie-app`, `preferred_username: testuser2`

### Test I.3 — Verify Backend Validates Tokens from Both Realms Simultaneously

```bash
# Test genie realm token (original) — /api/me returns the raw user document
echo "=== Genie realm token ==="
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -c "
import sys,json
d = json.load(sys.stdin)
name = d.get('name')
print(f'User: {name}')
sys.exit(0 if name and d.get('_key') else 1)
" || { echo "FATAL: genie-realm /api/me did not return a resolved user document"; exit 1; }

# Test genie2 realm token
echo "=== Genie2 realm token ==="
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER2_TOKEN" | python3 -c "
import sys,json
d = json.load(sys.stdin)
name = d.get('name')
print(f'User: {name}')
sys.exit(0 if name and d.get('_key') else 1)
" || { echo "FATAL: genie2-realm /api/me did not return a resolved user document"; exit 1; }
```

**Expected**: Both return `HTTP: 200` with user profile data. Each user has a different identity in ArangoDB.

### Test I.4 — Verify Composite Key Keeps Identities Separate

The backend uses the composite key `{iss}#{sub}` in the ArangoDB `users` collection (`iss_sub` unique index) to keep identities separate across realms.

```bash
# Verify user documents in ArangoDB via backend container
docker exec $(docker ps --filter name=backend --format '{{.ID}}' | head -1) \
  bash -c 'curl -sk http://arango-vector-db:8529/_api/database' 2>/dev/null | head -1
# Expected: {"result":true,...} (database accessible)

# Query users collection to see composite keys
docker exec $(docker ps --filter name=backend --format '{{.ID}}' | head -1) \
  bash -c "curl -sk -X POST http://arango-vector-db:8529/_api/cursor \
  -H 'Content-Type: application/json' \
  -d '{\"query\": \"FOR u IN users FILTER u.iss_sub != null RETURN { _key: u._key, iss_sub: u.iss_sub, name: u.name }\"}'" \
  2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for user in data.get('result', []):
    print(f'  _key: {user[\"_key\"]}, iss_sub: {user.get(\"iss_sub\", \"N/A\")}, name: {user.get(\"name\", \"N/A\")}')"
```

**Expected**: At least two user documents with different `iss_sub` values:
- One with `iss_sub: https://localhost/auth/realms/genie#<sub-uuid>` (testuser from genie realm)
- One with `iss_sub: https://localhost/auth/realms/genie2#<sub-uuid>` (testuser2 from genie2 realm)

### Test I.5 — Cleanup: Delete Test User (Not Realm)

The `genie2` realm was created by Phase 0.6 — do NOT delete it. Only clean up the test user.

```bash
NOROLES_USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie2/users?username=testuser2&exact=true" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

curl -sk -X DELETE "https://localhost/auth/admin/realms/genie2/users/${NOROLES_USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 204`

---

## Phase J: OIDC Token Propagation (Service-to-Service Auth)

Validates that service-to-service calls use Keycloak OIDC tokens (Bearer token via client_credentials grant) instead of shared secrets. The context endpoint is now protected by Keycloak JWT like all other routes.

### Prerequisites

- Phase 0 complete (`$USER_TOKEN` available)
- `KC_DATAPREP_CLIENT_ID` and `KC_DATAPREP_CLIENT_SECRET` set in `.env`
- `DEPLOY_OPEA=0` is fine — tests the backend endpoint directly

### Test J.1 — Obtain Service Account Token

Use Keycloak's token endpoint to obtain a service account token via client_credentials grant.

```bash
# Obtain service account token
SERVICE_ACCOUNT_TOKEN=$(curl -sk "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=${KC_DATAPREP_CLIENT_ID:-dataprep-service-client}" \
  -d "client_secret=${KC_DATAPREP_CLIENT_SECRET}" | jq -r '.access_token')

echo "Service account token obtained: ${SERVICE_ACCOUNT_TOKEN:0:20}..."
```

**Expected**: A JWT access token is returned (non-empty string).

### Test J.2 — Verify Context Endpoint with Service Account Token

Call the context endpoint with the service account Bearer token.

```bash
# Call context endpoint with service account Bearer token
curl -sk "https://localhost/api/me/context" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN" | jq .
```

**Expected**: `HTTP: 200` with response containing only sanitized fields:
```json
{
  "name": "Test User",
  "role": ["GENIE.AI_USER"],
  "emailVerified": true
}
```

### Test J.3 — Verify Context Endpoint Rejects Requests Without Token

The endpoint must reject requests without a valid Keycloak JWT.

```bash
# Test 1: No auth header → 401
curl -sk "https://localhost/api/me/context" \
  -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 401`

```bash
# Test 2: Invalid token → 401
curl -sk "https://localhost/api/me/context" \
  -H "Authorization: Bearer invalid-token-value" \
  -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 401`

### Test J.4 — Verify No Keycloak Artifacts Leak to OPEA

The context response must contain ONLY the three sanitized fields. No JWT claims, no issuer, no subject.

```bash
# Get response and verify it contains ONLY safe fields
RESPONSE=$(curl -sk "https://localhost/api/me/context" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN")

echo "$RESPONSE" | jq 'keys'
```

**Expected**: `["name", "role", "emailVerified"]` — exactly these three keys, nothing else

```bash
# Verify no sensitive fields are present
echo "$RESPONSE" | jq 'has("iss") or has("sub") or has("iss_sub") or has("realm_access") or has("azp") or has("Authorization") or has("token")'
```

**Expected**: `false` — none of these sensitive fields should exist in the response

---

## Phase K: Auth Error Display (Story 2-6)

**This phase mutates Keycloak realm settings and stops the Keycloak service. Cleanup steps (K.5, K.6) restore state. Verify stack health before proceeding to Phase L.**

Validates that authentication and authorization errors are returned with correct error codes and user-friendly messages.

### Prerequisites

- Phase 0 complete (`$TOKEN` and `$USER_TOKEN` available)
- Keycloak admin access for realm configuration changes

### Test K.1 — TOKEN_INVALID (Modified Token)

Send a token with a modified payload character. The backend should detect the signature mismatch and return `TOKEN_INVALID`.

```bash
# Modify one character in the token payload
MODIFIED_TOKEN=$(echo "$USER_TOKEN" | sed 's/./X/4')
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $MODIFIED_TOKEN" | jq .
```

**Expected**: `HTTP: 401` with `{"error": "TOKEN_INVALID", "message": "Token verification failed"}`

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/k1-auth-error-display.spec.js
```

### Test K.2 — TOKEN_EXPIRED (Short-Lived Token)

Reduce the realm's `accessTokenLifespan` to 10 seconds, get a fresh token, wait for expiry, then verify the backend returns `TOKEN_EXPIRED`.

```bash
# Save original lifespan
ORIG_LIFESPAN=$(curl -sk "https://localhost/auth/admin/realms/genie" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.accessTokenLifespan')
echo "Original accessTokenLifespan: $ORIG_LIFESPAN"

# Set to 10 seconds
curl -sk -X PUT "https://localhost/auth/admin/realms/genie" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"accessTokenLifespan": "10"}' -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 204`

```bash
# Get fresh token (expires in 10s)
EXPIRED_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Wait for the token's OWN expiry (Rule: Determinism — no fixed
# sleeps): read the exp claim from the token itself and poll the clock
# until it passes, bounded at 30 s. A sleep long enough for a loaded
# host is wasted on a fast one; a sleep short enough for a fast host is
# flaky on a loaded one.
TOKEN_EXP=$(echo "$EXPIRED_TOKEN" | python3 -c "
import sys, json, base64
payload = sys.stdin.read().strip().split('.')[1]
payload += '=' * (-len(payload) % 4)
print(json.loads(base64.urlsafe_b64decode(payload))['exp'])
")
deadline=$(($(date +%s) + 30))
# The exp claim must have PARSED: an empty TOKEN_EXP (the mint above
# failed, or the body was not a JWT) must fail the phase HERE, not skip
# the wait silently and continue with a still-valid token.
[ -n "$TOKEN_EXP" ] || { echo "FATAL: could not read the exp claim from EXPIRED_TOKEN — the mint above failed or returned a non-JWT body"; exit 1; }
while [ "$(date +%s)" -lt "$TOKEN_EXP" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: the clock did not reach the token's exp ($TOKEN_EXP) within 30s"
    exit 1
  fi
  sleep 2
done

# Send expired token
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $EXPIRED_TOKEN" | jq .
```

**Expected**: `HTTP: 401` with `{"error": "TOKEN_EXPIRED", "message": "Token has expired"}`

**Note**: Do NOT restore `accessTokenLifespan` yet — K.5 handles that. The Playwright spec (`k1-auth-error-display.spec.js`) does NOT use this procedure anymore (#1785): its K.2 observes the expiry through a dedicated client whose own 10s lifespan is client-scoped, so the realm's global default stays what the deployment runs. This manual mutation is what K.5 restores.

### Test K.3 — FORBIDDEN (User Without Roles)

Create a user with no realm roles, obtain a token, and attempt to access an admin-only endpoint.

```bash
# Create no-roles user
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
    "username": "noroles-user-e2e",
    "enabled": true,
    "email": "noroles-e2e@genie.local",
    "firstName": "No",
    "lastName": "Roles",
    "credentials": [{"type": "password", "value": "TestPass123!", "temporary": false}]
  }' -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 201`

```bash
# Get token for no-roles user
NOROLES_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=noroles-user-e2e" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Attempt admin-only operation (e.g., role management endpoint)
curl -sk "https://localhost/api/admin/users" \
  -H "Authorization: Bearer $NOROLES_TOKEN" | jq .
```

**Expected**: `HTTP: 403` with `{"error": "FORBIDDEN", "message": "Admin access required"}`

Note: The error code is `FORBIDDEN`, not `INSUFFICIENT_ROLES`. The frontend recognizes both codes but the backend only produces `FORBIDDEN`.

### Test K.4 — TOKEN_INVALID (Keycloak Unavailable)

Stop Keycloak. The backend caches JWKS signing keys, so a previously-valid token with an unexpired signature will still return `200` even when Keycloak is unavailable. This validates the air-gapped/offline resilience of the auth flow.

> **IMPORTANT**: The token must be obtained **before** stopping Keycloak, and the stop + test must run in the **same shell** so the `$USER_TOKEN` variable is preserved.

```bash
# Step 1: Get a fresh token AND warm the JWKS cache while Keycloak is still
# running (one authenticated call — without it a cold 5-minute JWKS cache
# forces a refetch from the stopped Keycloak and Step 2 fails)
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" \
  -o /dev/null -w "JWKS cache warm-up: HTTP %{http_code}\n"

# Step 2: Stop Keycloak and test in the SAME shell
docker compose stop keycloak

# Bounded wait (Rule: Determinism — no fixed sleeps): poll the
# observable condition — the keycloak container reporting exited — every
# 2 s with a hard 30 s bound (an epoch timestamp, not bash's $SECONDS,
# so the loop bounds in any POSIX shell).
deadline=$(($(date +%s) + 30))
while [ "$(docker compose ps --all keycloak --format '{{.State}}')" != "exited" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: keycloak did not stop within 30s (state: $(docker compose ps --all keycloak --format '{{.State}}'))"
    exit 1
  fi
  sleep 2
done

RESPONSE=$(curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: /api/me answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
# The endpoint returns the raw ArangoDB user document — no success/user wrapper
echo "$RESPONSE" | head -n -1 | jq -e '._key' > /dev/null \
  || { echo "FATAL: /api/me returned no _key"; exit 1; }
echo "HTTP: 200 (cached JWKS validated the token)"
```

**Expected**: `HTTP: 200` with the raw user document — the backend validates the JWT using cached JWKS keys and does not need Keycloak for every request. This is the correct behavior: the auth system is resilient to temporary Keycloak outages for already-authenticated users.

> **Note**: If you see `HTTP: 401` despite the Step 1 warm-up, the JWKS cache window was missed — re-run the whole test from Step 1 (fresh token + warm-up call) before stopping Keycloak again.

```bash
# Step 3: Restore Keycloak
docker compose start keycloak

# Bounded wait (Rule: Determinism — no fixed sleeps): poll the
# observable condition — the keycloak container reporting (healthy) —
# every 5 s with a hard 120 s bound (the recovery the removed fixed
# sleep priced at 60-90 s; an epoch timestamp, not bash's $SECONDS, so
# the loop bounds in any POSIX shell).
deadline=$(($(date +%s) + 120))
while ! docker compose ps keycloak --format '{{.Status}}' | grep -q '(healthy)'; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: keycloak not healthy after 120s ($(docker compose ps keycloak --format '{{.Status}}'))"
    exit 1
  fi
  sleep 5
done

# Reload Kong DNS cache (Kong caches the old Keycloak container IP after stop/start)
docker exec $(docker ps --filter name=kong --format '{{.ID}}' | head -1) kong reload

# Bounded wait (Rule: Determinism — no fixed sleeps): poll the
# observable condition — the edge answering the discovery request with
# the deployment's issuer — every 3 s with a hard 60 s bound covering
# Kong's reload settling (an epoch timestamp, not bash's $SECONDS, so
# the loop bounds in any POSIX shell).
deadline=$(($(date +%s) + 60))
while :; do
  ISSUER="$(curl -sk "https://localhost/auth/realms/genie/.well-known/openid-configuration" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('issuer', 'NOT READY'))" 2>/dev/null || echo "NOT READY")"
  [ "$ISSUER" = "https://localhost/auth/realms/genie" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "FATAL: discovery did not report the genie issuer within 60s (last: $ISSUER)"
    exit 1
  fi
  sleep 3
done

# Verify Keycloak is back
curl -sk "https://localhost/auth/realms/genie/.well-known/openid-configuration" \
  | python3 -c "import sys,json; print('Keycloak issuer:', json.load(sys.stdin).get('issuer', 'NOT READY'))"
```

**Expected**: `Keycloak issuer: https://localhost/auth/realms/genie`

### Test K.5 — Restore Realm Settings

```bash
# Restore original accessTokenLifespan
curl -sk -X PUT "https://localhost/auth/admin/realms/genie" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"accessTokenLifespan\": \"$ORIG_LIFESPAN\"}" -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 204`

### Test K.6 — Cleanup: Delete No-Roles Test User

```bash
# Find and delete the noroles user
NOROLES_USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=noroles-user-e2e&exact=true" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

curl -sk -X DELETE "https://localhost/auth/admin/realms/genie/users/${NOROLES_USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 204`

---

**Phase K complete.** All realm settings restored, test user cleaned up. Stack is ready for Phase L. Verify:

```bash
docker compose ps
```

---

### Prerequisites

- Phase K cleanup completed (K.5 + K.6 executed, stack healthy)
- **Phases MUST run in order: L → M → N**. Phase N is destructive (erases user and creates new _key). Running N before L or M will cause session/user lookups to fail because the ArangoDB `_key` changes after erasure + recreation.
- `$TOKEN` set (Keycloak master admin token from Phase 0)
- `$USER_TOKEN` available (get fresh token before starting Phase L)

---

## Phase L: Session Management (Stories 3-1, 3-2)

Validates logout flow, session termination, and session invalidation when a user is disabled or deleted in Keycloak.

### Test L.1 — Frontend Logout Redirect to Keycloak

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/l1-frontend-logout-redirect.spec.js
```
**Expected**: URL redirects to Keycloak login page (`/auth/realms/genie/...`) after logout

### Test L.2 — localStorage Cleanup After Logout

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/l2-localstorage-cleanup.spec.js
```
**Expected**: `localStorage.getItem('user') === null` && `localStorage.getItem('auth_token') === null`

### Test L.3 — Vuex State Cleared After Logout

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/auth/l3-vuex-state-cleared.spec.js
```
**Expected**: After logout, user is redirected to Keycloak login (proves `isAuthenticated === false`)

### Test L.4 — Backend Logout Ends Active Sessions

```bash
# Get fresh token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# One authenticated call provisions the ArangoDB document (JIT provisioning
# runs in the auth middleware) and yields the _key — resolve via /api/me,
# never by email (see README "Resolving test accounts")
RESPONSE=$(curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: provisioning call answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
USER_KEY=$(echo "$RESPONSE" | head -n -1 | jq -r '._key')
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }

# Create a session (requires userId and auth token)
SESSION_ID=$(curl -sk -X POST "https://localhost/api/sessions" \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"userId\":\"${USER_KEY}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['_key'])")
echo "Session: $SESSION_ID"

# Logout
curl -sk -X POST "https://localhost/api/auth/logout" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -m json.tool
```
**Expected**: `{"success": true, "message": "Logged out successfully"}`

```bash
# Verify session ended
curl -sk "https://localhost/api/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -c "
import sys,json
s = json.load(sys.stdin)
print(f'active: {s[\"active\"]}, endTime: {s.get(\"endTime\",\"N/A\")}')
"
```
**Expected**: `active: false`, `endTime` is an ISO timestamp

### Test L.5 — Disable User in Keycloak, UserInfo Returns 403

```bash
# Disable testuser in Keycloak
USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

curl -sk -X PUT "https://localhost/auth/admin/realms/genie/users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": false}' -w "\nHTTP: %{http_code}\n"
```
**Expected**: HTTP 204

```bash
# UserInfo with still-valid token -> 403 (user disabled)
curl -sk "https://localhost/auth/realms/genie/protocol/openid-connect/userinfo" \
  -H "Authorization: Bearer $USER_TOKEN" -w "\nHTTP: %{http_code}\n"
```
**Expected**: HTTP 403

### Test L.6 — Disabled User: Existing Token Still Works Until Expiry

> **Note**: Disabling a user in Keycloak does NOT invalidate existing tokens. JWT verification checks signature and expiry only. The `TOKEN_EXPIRED` + disabled-user-marking logic only triggers when the token is genuinely expired AND the user is disabled. A still-valid token from a disabled user is served normally (HTTP 200).

```bash
# Existing token still works (user is disabled but token is not expired)
RESPONSE=$(curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: /api/me answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
# The endpoint returns the raw ArangoDB user document — no success/user wrapper
echo "$RESPONSE" | head -n -1 | jq -e '._key' > /dev/null \
  || { echo "FATAL: /api/me returned no _key"; exit 1; }
echo "HTTP: 200 (token still valid)"
```
**Expected**: HTTP 200 with the raw user document (`_key` present) — token is valid, user is not yet marked deleted

```bash
# Verify user is NOT marked deleted in ArangoDB (direct read of the _key
# resolved in L.4 — side-effect-free, no provisioning triggered)
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.document('${USER_KEY}');
    print('deleted: ' + u.deleted);
  "
```
**Expected**: `deleted: false` (not yet triggered — requires expired token + disabled user)

### Test L.7 — Re-enable User in Keycloak

```bash
# Re-enable user in Keycloak
curl -sk -X PUT "https://localhost/auth/admin/realms/genie/users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": true}' -w "\nHTTP: %{http_code}\n"
```
**Expected**: HTTP 204

```bash
# Verify user can still get tokens and access /api/me
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
```
**Expected**: HTTP 200

### Test L.8 — Verify User Active in ArangoDB

```bash
# Verify ArangoDB user is active and not deleted (direct read of the _key
# resolved in L.4 — side-effect-free, no provisioning triggered)
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.document('${USER_KEY}');
    print('deleted: ' + u.deleted + ', active: ' + u.active);
  "
```
**Expected**: `deleted: false`, `active: true`

### Test L.9 — Logout Emits Structured Audit Log

```bash
# Get fresh token, create session, logout, check logs
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

USER_KEY=$(curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | jq -r '._key')
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }

curl -sk -X POST "https://localhost/api/sessions" \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"userId\":\"${USER_KEY}\"}" -o /dev/null

curl -sk -X POST "https://localhost/api/auth/logout" \
  -H "Authorization: Bearer $USER_TOKEN" -o /dev/null

docker compose logs backend --since 30s 2>&1 | grep '"event":"logout"' | tail -1 | python3 -c "
import sys,json
log = json.loads(sys.stdin.readline())
print(f'event: {log[\"event\"]}')
print(f'has userId: {\"userId\" in log}')
print(f'has timestamp: {\"timestamp\" in log}')
print(f'has issuer: {\"issuer\" in log}')
"
```
**Expected**: `event: logout`, all three fields present

### Test L.10 — Logout Without Active Sessions (Idempotent)

```bash
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk -X POST "https://localhost/api/auth/logout" \
  -H "Authorization: Bearer $USER_TOKEN"
```
**Expected**: `{"success": true, "message": "Logged out successfully"}` (no active sessions)

### Test L.11 — Session Keepalive

```bash
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

USER_KEY=$(curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | jq -r '._key')
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }

SESSION_ID=$(curl -sk -X POST "https://localhost/api/sessions" \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"userId\":\"${USER_KEY}\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['_key'])")

curl -sk -X PATCH "https://localhost/api/sessions/${SESSION_ID}/keepalive" \
  -H "Authorization: Bearer $USER_TOKEN" -w "\nHTTP: %{http_code}\n"
```
**Expected**: HTTP 200

### Test L.12 — End Already-Ended Session (Idempotent)

```bash
# End session (first time)
curl -sk -X PATCH "https://localhost/api/sessions/${SESSION_ID}/end" \
  -H "Authorization: Bearer $USER_TOKEN" -w "\nHTTP: %{http_code}\n"
# Expected: 200

# End same session again (idempotent)
curl -sk -X PATCH "https://localhost/api/sessions/${SESSION_ID}/end" \
  -H "Authorization: Bearer $USER_TOKEN" -w "\nHTTP: %{http_code}\n"
# Expected: 200 (session already inactive, no error)
```

---

## Phase M: Keycloak Proxy & JIT Updates (Stories 3-5, 3-6)

Validates the Keycloak Admin API proxy for user management, self-context enforcement, and JIT provisioning profile updates on re-login.

**Prerequisite**: Phase L complete (user reactivated, `testuser` available).

### Test M.1 — Get User Profile via Proxy

```bash
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# The account's current address lives in Keycloak — fetch it by username
# (exact match; the fixture email is venue-dependent but Keycloak owns it)
KC_EMAIL=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['email'])")
# Fail loudly here — an empty address means the lookup failed, not the profile
[ -n "$KC_EMAIL" ] || { echo "FATAL: Keycloak returned no account for username=testuser"; exit 1; }

curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" \
  | jq -r --arg kc "$KC_EMAIL" '"name: \(.name // "N/A")", "email matches Keycloak: \(.email == $kc)"'

```
**Expected**: `email matches Keycloak: true` — the profile email equals the account's Keycloak address, whatever the venue provisioned; `name` non-null

### Test M.2 — Get User Profile by ID

```bash
# The account's current address lives in Keycloak — fetch it by username
KC_EMAIL=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['email'])")
# Fail loudly here — an empty address means the lookup failed, not the profile
[ -n "$KC_EMAIL" ] || { echo "FATAL: Keycloak returned no account for username=testuser"; exit 1; }

USER_KEY=$(curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | jq -r '._key')
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }

# Fetch the profile BY ID — the ArangoDB document directly
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.document('${USER_KEY}');
    print('active: ' + u.active);
    print('email matches Keycloak: ' + (u.email === '${KC_EMAIL}'));
  "
```
**Expected**: `active: true`, `email matches Keycloak: true` — the by-ID document carries the account's Keycloak address

### Test M.3 — Update User Profile

```bash
# Update profile via Keycloak proxy (JSON body)
curl -sk -X PUT "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"TestUpdated","lastName":"UserUpdated"}' \
  | python3 -m json.tool
```
**Expected**: HTTP 200 `{"success": true, ...}`

```bash
# Verify in Keycloak
curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
u = json.load(sys.stdin)[0]
print(f'firstName: {u[\"firstName\"]}')
print(f'lastName: {u[\"lastName\"]}')
"
```
**Expected**: `firstName: TestUpdated`, `lastName: UserUpdated`

> **Note:** The old IDOR protection test (`PUT /api/users/:userId` with mismatched userId → 403) has been removed. The `/api/me` singleton is inherently self-scoped — there is no userId parameter to manipulate, making IDOR structurally impossible. Profile updates are already covered by Test M.3.

### Test M.4 — Email Change via Admin Proxy

```bash
# Capture the account's current address before changing it (M.5 restores it)
ORIGINAL_EMAIL=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['email'])")
[ -n "$ORIGINAL_EMAIL" ] || { echo "FATAL: Keycloak returned no account for username=testuser"; exit 1; }

curl -sk -X PUT "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser-updated@genie.local"}' | python3 -m json.tool
```
**Expected**: HTTP 200 `{"success": true, "message": "Profile saved successfully", ...}`

```bash
# Verify email in Keycloak
curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
u = json.load(sys.stdin)[0]
print(f'email: {u[\"email\"]}')
"
```
**Expected**: `email: testuser-updated@genie.local`

### Test M.5 — Restore Original Email (Cleanup)

```bash
# Restore the address captured in M.4 — the venue's own address, never a
# hardcoded fixture address (a legacy venue keeps its original one)
curl -sk -X PUT "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ORIGINAL_EMAIL}\"}" -w "\nHTTP: %{http_code}\n"
```
**Expected**: HTTP 200

### Test M.6 — Reset Data Endpoint

```bash
curl -sk -X POST "https://localhost/api/me/reset-data" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -m json.tool
```
**Expected**: `{"success": true, "message": "...", "fieldsPreserved": <number>}`

### Test M.7 — JIT Provisioning Updates Profile on Re-login

```bash
# Update profile in Keycloak directly (simulating external change)
USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser&exact=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

curl -sk -X PUT "https://localhost/auth/admin/realms/genie/users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"JIT","lastName":"Test"}' -w "\nHTTP: %{http_code}\n"
# Expected: 204

# Re-login triggers JIT provisioning (profile sync from Keycloak to ArangoDB)
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

RESPONSE=$(curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: /api/me answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
echo "$RESPONSE" | head -n -1 | python3 -c "
import sys,json
d = json.load(sys.stdin)
name = d.get('name')
print(f'name: {name}')
sys.exit(0 if name == 'JIT Test' else 1)
" || { echo "FATAL: JIT profile sync did not propagate the Keycloak change to the ArangoDB document"; exit 1; }
```
**Expected**: `name: JIT Test` (profile updated from Keycloak via JIT)

### Test M.8 — JIT Reactivation of Soft-Deleted User

```bash
# Soft-delete user in ArangoDB directly. Resolve the _key with a
# cache-neutral direct read (iss_sub identity, see README "Resolving test
# accounts"): an /api/me call here would warm the provisioning cache
# (60s TTL) and the re-login below could then skip the JIT reactivation
# this test exists to verify
ISS_SUB=$(python3 -c "
import base64, json, sys
p = sys.argv[1].split('.')[1]
p += '=' * (-len(p) % 4)
c = json.loads(base64.urlsafe_b64decode(p))
print(c['iss'] + '#' + c['sub'])
" "$USER_TOKEN")
USER_KEY=$(docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({iss_sub: '${ISS_SUB}'});
    print(u._key);
  " 2>/dev/null | tail -1)
[ -n "$USER_KEY" ] || { echo "FATAL: could not resolve the ArangoDB _key for the fixture user"; exit 1; }

docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    db.users.update('${USER_KEY}', {deleted:true, active:false, deletedAt:'2026-01-01T00:00:00.000Z'});
  "

# Verify soft-deleted — the whole test is vacuous if this did not take effect
DELETED=$(docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.document('${USER_KEY}');
    print(u.deleted);
  " 2>/dev/null | tail -1)
[ "$DELETED" = "true" ] || { echo "FATAL: soft-delete update did not take effect (deleted=${DELETED:-unset})"; exit 1; }

# Re-login triggers JIT reactivation
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# The authenticated request goes through JIT provisioning, which reactivates
# the soft-deleted user — HTTP 200 confirms the request was served; the
# reactivation itself is verified by the ArangoDB read below (the
# provisioning cache can fail open and serve a stale document, so the HTTP
# response alone is not proof)
RESPONSE=$(curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" \
  -w "\n%{http_code}")
[ "$(echo "$RESPONSE" | tail -1)" = "200" ] || { echo "FATAL: /api/me answered HTTP $(echo "$RESPONSE" | tail -1)"; exit 1; }
echo "$RESPONSE" | head -n -1 | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'deleted: {d.get(\"deleted\")}')
"
# Expected: deleted: False

# Verify reactivated in ArangoDB — the authoritative check for this test
REACT_STATE=$(docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.document('${USER_KEY}');
    print('deleted: ' + u.deleted + ', active: ' + u.active);
  " 2>/dev/null | tail -1)
echo "${REACT_STATE}"
[ "$REACT_STATE" = "deleted: false, active: true" ] || { echo "FATAL: expected 'deleted: false, active: true', got '${REACT_STATE:-unset}'"; exit 1; }
```

### Test M.9 — Delete User Account (Keycloak + ArangoDB)

```bash
# Save user _key before deletion (erasure nullifies iss_sub and the PII
# fields, so the _key is the only handle afterwards)
USER_KEY=$(curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | jq -r '._key')
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }

curl -sk -X POST "https://localhost/api/me/delete" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"E2E test cleanup"}' | python3 -m json.tool
```
**Expected**: `{"success": true, "message": "..."}`

```bash
# Verify user marked deleted in ArangoDB (query by _key, email is nullified)
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.document('${USER_KEY}');
    print('deleted: ' + u.deleted + ', email: ' + (u.email || 'null'));
  "
```
**Expected**: `deleted: true`, `email: null`

### Test M.10 — Cleanup: Recreate Test User for Phase N

```bash
# Recreate testuser in Keycloak for GDPR tests
# Rebuild the account with the venue's own address ($KC_EMAIL, captured in
# M.1/M.2) — never a hardcoded fixture address; jq builds the JSON so the
# interpolation cannot corrupt it
[ -n "$KC_EMAIL" ] || { echo "FATAL: KC_EMAIL is not set (run Phase M first)"; exit 1; }
jq -n --arg email "$KC_EMAIL" '{username:"testuser",enabled:true,email:$email,emailVerified:true,firstName:"Test",lastName:"User",credentials:[{type:"password",value:"TestPass123!",temporary:false}]}' \
  | curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d @- -w "\nHTTP: %{http_code}\n"
# Expected: 201

# Verify login works
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
# Expected: 200
```

---

## Phase N: GDPR Compliance (Story 3-7)

Validates GDPR Article 17 compliance: right to erasure, PII nullification, data retention exceptions (Art 17.3.e), and idempotent operations.

> **Note**: Soft-delete, blocked access, and JIT reactivation are covered by Phase L (L.5, L.6) and Phase M (M.9). Phase N focuses exclusively on the GDPR erasure flow.

**Prerequisite**: Phase M complete (`testuser` recreated and active).

### Test N.1 — GDPR Erasure (Delete User Completely)

```bash
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Save user _key before erasure (erasure nullifies iss_sub and the PII
# fields, so the _key is the only handle afterwards)
USER_KEY=$(curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | jq -r '._key')
[ -n "$USER_KEY" ] && [ "$USER_KEY" != "null" ] || { echo "FATAL: /api/me returned no _key"; exit 1; }
echo "User _key: $USER_KEY"

# Trigger erasure (deletes Keycloak user + nullifies all PII in ArangoDB)
curl -sk -X POST "https://localhost/api/me/delete" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -m json.tool
```
**Expected**: `{"success": true, ...}`

### Test N.2 — Erased User Has All PII Nullified in ArangoDB

```bash
# Query by _key (email has been nullified, cannot use firstExample by email)
docker exec $(docker ps --filter name=arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.document('${USER_KEY}');
    print('deleted: ' + u.deleted);
    print('sub: ' + (u.sub || 'null'));
    print('email: ' + (u.email || 'null'));
    print('name: ' + (u.name || 'null'));
    print('iss_sub: ' + (u.iss_sub || 'null'));
    print('iss: ' + (u.iss || 'null'));
  "
```
**Expected**: `deleted: true`, `sub: null`, `email: null`, `name: null`, `iss_sub: null`, `iss: null` — all PII fields nullified

### Test N.3 — Erased User Cannot Log In (Keycloak Returns 401)

```bash
curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -m json.tool
```
**Expected**: `{"error": "invalid_grant", "error_description": "Invalid user credentials"}`

### Test N.4 — Erasure is Idempotent

```bash
# Recreate testuser to test idempotent erasure
# Rebuild the account with the venue's own address ($KC_EMAIL, captured in
# M.1/M.2) — never a hardcoded fixture address; jq builds the JSON so the
# interpolation cannot corrupt it
[ -n "$KC_EMAIL" ] || { echo "FATAL: KC_EMAIL is not set (run Phase M first)"; exit 1; }
jq -n --arg email "$KC_EMAIL" '{username:"testuser",enabled:true,email:$email,emailVerified:true,firstName:"Test",lastName:"User",credentials:[{type:"password",value:"TestPass123!",temporary:false}]}' \
  | curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d @- -w "\nHTTP: %{http_code}\n"
# Expected: 201

# Login and erase
ERASE_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk -X POST "https://localhost/api/me/delete" \
  -H "Authorization: Bearer $ERASE_TOKEN" -o /dev/null -w "First erase: %{http_code}\n"
# Expected: 200

# Second erase (idempotent — user already deleted from Keycloak)
curl -sk -X POST "https://localhost/api/me/delete" \
  -H "Authorization: Bearer $ERASE_TOKEN" -w "Second erase: %{http_code}\n"
# Expected: 200 (no error — idempotent)
```

### Test N.5 — Audit Log Entry for Erasure Event

```bash
docker compose logs backend --since 60s 2>&1 | grep -i 'user erased\|account deleted' | tail -5
```
**Expected**: Log entries containing erasure event with user identifier (e.g. `[KeycloakProxy] User erased`, `[DELETE] Account deleted`)

### Test N.6 — Cleanup: Recreate Test User

```bash
# Recreate testuser for subsequent test runs
# Rebuild the account with the venue's own address ($KC_EMAIL, captured in
# M.1/M.2) — never a hardcoded fixture address; jq builds the JSON so the
# interpolation cannot corrupt it
[ -n "$KC_EMAIL" ] || { echo "FATAL: KC_EMAIL is not set (run Phase M first)"; exit 1; }
jq -n --arg email "$KC_EMAIL" '{username:"testuser",enabled:true,email:$email,emailVerified:true,firstName:"Test",lastName:"User",credentials:[{type:"password",value:"TestPass123!",temporary:false}]}' \
  | curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d @- -w "\nHTTP: %{http_code}\n"
# Expected: 201

# Verify
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/me" -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
# Expected: 200
```

---

---

## Test results summary

Per-phase record table — fill in a row as its phase is executed. The A–E
rows keep the result of the run that retired the epic plans; the L–N rows
are the session-lifecycle record.


| Phase | Test | Result | Notes |
|-------|------|--------|-------|
| 0.4 | Images built and pushed | | |
| 0.6 | Stack health check | | |
| 0.8 | ROPC enabled on genie-app | | |
| 0.9 | ROPC token retrieval | | |
| A.1 | Frontend redirects to Keycloak | | |
| A.2 | Full login -> dashboard | | |
| A.3 | Legacy routes redirect | | |
| B.1 | JIT provisioning via /api/me | | |
| B.2 | ArangoDB document created | | |
| B.3 | UPSERT atomic (no duplicates) | | |
| B.4 | ~~Soft-deleted user -> 403~~ | REMOVED | Superseded by M.9, M.10, N.1 (Story 3.6 changed behavior) |
| C.1 | Malformed JWT -> TOKEN_INVALID | | |
| C.2 | Not enough parts -> TOKEN_INVALID | | |
| C.3 | No token -> TOKEN_INVALID | | |
| C.4 | No internal details leaked | | |
| D.1 | External IdP realm + user + client | | |
| D.2 | OIDC IdP configured in genie realm | | |
| D.3 | External IdP link on login page | | |
| D.4 | Broker URL present on login page | | (informational, validated by D.7b) |
| D.5 | External IdP token claims correct | | |
| D.6 | Genie realm issuer verified | | |
| D.7a | External IdP button visible | | |
| D.7b | External IdP login flow | | |
| 8 | Cleanup completed | | |
| E.1 | Backend auth code: no external calls | PASS | grep audit —all HTTP calls target KEYCLOAK_URL or internal services only |
| E.2 | Keycloak realm: no external URLs | PASS | Only localhost URLs in redirectUris/webOrigins |
| E.3 | Frontend OIDC: all endpoints local | PASS | authority, redirect_uri, post_logout all resolve to ${origin}/auth |
| E.4 | Image list: all external images documented | PASS | 16/16 external images match between docker-compose.yaml and Step 5d (13 runtime + 3 build-time) |
| E.5 | Network isolation: full auth cycle | | Manual —requires deployed stack + network disconnect |


| L.1 | Frontend logout redirect to Keycloak | | |
| L.2 | localStorage cleanup after logout | | |
| L.3 | Vuex state cleared after logout | | |
| L.4 | Backend logout ends active sessions | | |
| L.5 | Disable user -> UserInfo 403 | | |
| L.6 | Disabled user: existing token still works | | |
| L.7 | Re-enable user in Keycloak | | |
| L.8 | Verify user active in ArangoDB | | |
| L.9 | Logout audit log (structured) | | |
| L.10 | Logout without sessions (idempotent) | | |
| L.11 | Session keepalive | | |
| L.12 | End already-ended session (idempotent) | | |
| M.1 | Get user profile via proxy | | |
| M.2 | Get user profile by ID | | |
| M.3 | Update user profile | | |
| M.4 | Email change via admin proxy | | |
| M.5 | Restore original email (cleanup) | | |
| M.6 | Reset data endpoint | | |
| M.7 | JIT provisioning updates profile on re-login | | |
| M.8 | JIT reactivation of soft-deleted user | | |
| M.9 | Delete user account (Keycloak + ArangoDB) | | |
| M.10 | Cleanup: recreate test user | | |
| N.1 | GDPR erasure (complete deletion) | | |
| N.2 | Erased user PII nullified in ArangoDB | | |
| N.3 | Erased user cannot log in | | |
| N.4 | Erasure is idempotent | | |
| N.5 | Audit log for erasure event | | |
| N.6 | Cleanup: recreate test user | | |
