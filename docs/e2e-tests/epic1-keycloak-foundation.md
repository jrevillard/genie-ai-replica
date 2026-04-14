## Phase A: Frontend Login Redirect

### Test A.1 —Redirect to Keycloak

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/epic1/a1-login-redirect.spec.js
```
**Expected**: `{ redirected: true }`

### Test A.2 —Full Login Flow

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/epic1/a2-full-login-flow.spec.js
```
**Expected**: URL is `https://localhost/dashboard`, body contains "GENIE.AI"

### Test A.3 —Legacy Routes Redirect

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/epic1/a3-legacy-routes-redirect.spec.js
```
**Expected**: All three redirect to Keycloak (`true`)

---

## Phase B: JIT User Provisioning

### Test B.1 —First Login Creates User in ArangoDB

```bash
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
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
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
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

### Test B.4 — REMOVED (Superseded by Epic 3)

> **This test has been removed.** The original test checked that soft-deleted users return 403, but Story 3.6 (JIT re-activation) changed the behavior: soft-deleted users with a valid Keycloak token are automatically re-activated on login.
>
> The test was also architecturally flawed: it manipulated ArangoDB directly without disabling the user in Keycloak, which allowed the user to still obtain a valid token.
>
> **Replacement tests in Epic 3:**
> - **M.9** — JIT reactivation of soft-deleted user (correct flow: Keycloak disable → soft-delete → Keycloak re-enable → login → re-activation)
> - **M.10** — Delete user account (Keycloak + ArangoDB)
> - **N.1** — GDPR erasure (complete PII nullification, permanent)

---

## Phase C: Token Validation Errors

### Test C.1 —Malformed Token

```bash
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer not-a-real-token"
# Expected: {"error":"TOKEN_INVALID","message":"Token verification failed","details":{}}
```

### Test C.2 —Not Enough Parts

```bash
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer a.b"
# Expected: {"error":"TOKEN_INVALID","message":"Token verification failed","details":{}}
```

### Test C.3 —No Token

```bash
curl -sk "https://localhost/api/auth/me"
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
npx playwright test tests/e2e/epic1/d7a-external-idp-button.spec.js
```
**Expected**: `{ hasExternalIdp: true }`

### Step 7b —Full External IdP Login Flow

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/epic1/d7b-external-idp-login-flow.spec.js
```
**Expected**: `hasDashboard: true`, URL is `https://localhost/dashboard`, body contains "GENIE.AI"

> **Note (test environment)**: When `verifyEmail: true` is set on the realm (Section 9), Keycloak adds `VERIFY_EMAIL` as a required action for brokered users. In production, SMTP sends the verification email and the user continues normally. In the test environment (no SMTP), the Playwright spec temporarily disables the `VERIFY_EMAIL` required action via Admin API before the broker login and re-enables it afterwards. Keycloak 26 unregisters built-in required actions when disabled; the action is fully restored by `keycloak-config-cli` on the next deploy. No subsequent test phases depend on `VERIFY_EMAIL` being enabled.

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

Verify that all external images referenced in `docker-compose.yaml` have a corresponding pre-pull entry in `docs/docker-swarm-setup.md` Step 5d.

```bash
# Extract unique external images from docker-compose.yaml (non-registry-prefixed)
grep -oP 'image:\s*\K(?!.*\$\{)[^\s]+' docker-compose.yaml | sort -u

# Compare against Step 5d list
grep 'docker pull' docs/docker-swarm-setup.md | awk '{print $3}'
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

## Test Results Summary

| Phase | Test | Result | Notes |
|-------|------|--------|-------|
| 0.4 | Images built and pushed | | |
| 0.6 | Stack health check | | |
| 0.8 | ROPC enabled on genie-app | | |
| 0.9 | ROPC token retrieval | | |
| A.1 | Frontend redirects to Keycloak | | |
| A.2 | Full login -> dashboard | | |
| A.3 | Legacy routes redirect | | |
| B.1 | JIT provisioning via /api/auth/me | | |
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

## Full Test Run (Autonomous Execution)

To run the entire test suite from scratch, execute phases in order:

```
Phase 0  -> Clean start, deploy stack, verify health
Phase A  -> Frontend login redirect (browser tests)
Phase B  -> JIT user provisioning (API + ArangoDB)
Phase C  -> Token validation errors (API)
Phase D  -> External IdP connection (API + browser)
Step 8   -> Cleanup (always run, even if tests fail)
Phase E  -> Air-gapped deployment validation (grep audit + manual network isolation)
```

**Stop condition**: If any test in a phase fails, do not proceed to the next phase. Diagnose the failure using the Troubleshooting section, fix the issue, and re-run the failing phase.

**Approximate timing**: 15-25 minutes total (mostly waiting for stack startup and Keycloak realm import).
