# E2E Test Plan: Epic 2 — Secure API Access & Resilient Authentication

## Prerequisites

- Phase 0 complete (stack deployed, test user created, `$TOKEN` and `$USER_TOKEN` available)

**Get test user token** (if not already available from Phase 0):
```bash
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```
- Keycloak admin access (`$TOKEN`)
- Test user token (`$USER_TOKEN`)
- For Phase J: `KC_DATAPREP_CLIENT_ID` and `KC_DATAPREP_CLIENT_SECRET` set in `.env`

## Phase Execution Order

F -> G -> H -> I -> J -> K (Phase K MUST be last)

## Variable Reference

| Variable | Description | Defined in |
|----------|-------------|------------|
| `$TOKEN` | Keycloak master admin token | Phase 0 |
| `$USER_TOKEN` | ROPC token for `testuser` in `genie` realm | Phase 0 |
| `$USER2_TOKEN` | ROPC token for `testuser2` in `genie2` realm | Phase I |
| `$SERVICE_ACCOUNT_TOKEN` | Keycloak service account token (client_credentials grant) | Phase J |

---

## Phase F: Token Passthrough Headers to OPEA Services

**Scope:** This phase tests Story 2.3 (Token Passthrough -- Headers Injection to Upstream) conditional on OPEA infrastructure availability.

**Important:** Header construction and injection are verified via backend logs (`docker compose logs backend 2>&1 | grep -E "X-User-Id|X-User-Roles|X-Issuer"`) and authenticated endpoint responses (`GET /api/me`).

**Prerequisites:**
- OPEA infrastructure MUST be deployed (`DEPLOY_OPEA=1`) for Phase F full testing
- Phases G–K work with `DEPLOY_OPEA=0`
- Keycloak authentication working (tested in Phase A)
- JWT tokens successfully validated (Stories 1.3, 2.2)
- Backend auth middleware modified to inject headers

**Conditional Execution:**
```bash
# Check if Keycloak is available (via NGINX proxy)
if curl -sk https://localhost/auth/realms/genie/.well-known/openid-configuration > /dev/null 2>&1; then
  echo "Keycloak available"
else
  echo "Keycloak NOT available - skipping Phase F"
  return 0
fi

# Check if OPEA services are responding
# The chat endpoint is a reliable indicator that the OPEA stack is up
if curl -sk https://localhost/api/chat -X POST -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"ping"}],"max_tokens":1}' \
  -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "%{http_code}" 2>/dev/null | grep -q "200"; then
  echo "OPEA infrastructure detected - running Phase F tests"
else
  echo "OPEA services not fully available - Phase F tests will be limited to header construction verification"
  echo "Set DEPLOY_OPEA=1 in .env and redeploy for full Phase F coverage"
fi
```

### Test F.1 — Headers are Extracted from JWT After Token Verification

**Given** a user has authenticated via Keycloak and received a valid JWT
**When** the request is processed by the backend auth middleware (`keycloak-auth-middleware.js`)
**Then** the following claims are extracted from the JWT:
  - `iss` (issuer URL)
  - `sub` (subject/user ID)
  - `realm_access.roles` (array of roles)
- **And** the headers are constructed as:
  - `X-User-Id`: ArangoDB `_key` of the provisioned user
  - `X-User-Roles`: `roles.join(',')` (comma-separated)
  - `X-Issuer`: issuer URL
- **And** the headers are stored on `req.user.opeaHeaders`

**Verification:**
```bash
# Get admin token
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=\${GENIE_ADMIN_USERNAME:-genie-admin}" -d "password=\${GENIE_ADMIN_PASSWORD}" -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Get test user token (use existing test user)
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')

# Get the authenticated user's profile (this triggers header extraction in the middleware)
# First, find the user's _key by looking up the test user
USER_KEY=$(curl -sk -X GET "https://localhost/api/admin/users/search?email=testuser@genie.local" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

# Make authenticated request to the user profile endpoint
curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json"
# Expected: 200 OK with user profile data

# Verify header construction via backend logs
docker compose logs backend 2>&1 | grep -E "X-User-Id|X-User-Roles|X-Issuer"
```

> **Note:** This test uses the user profile endpoint (`GET /api/me`) as the authenticated route, then inspects backend logs to verify header extraction.

**Expected Behavior:**
- Headers are correctly constructed using ArangoDB `_key` for `X-User-Id`
- Roles are comma-separated (empty string if no roles)
- Issuer URL is included
- Headers are attached to `req.user.opeaHeaders` for downstream use

---

### Test F.2 — Headers are Injected into OPEA Worker Thread Calls

**Given** an authenticated request is made to an OPEA service endpoint
**When** the backend calls an OPEA service via the worker thread (`opea-worker.js`)
**Then** the following headers are injected into the OPEA HTTP request:
  - `X-User-Id`: ArangoDB `_key` of the user
  - `X-User-Roles`: comma-separated roles
  - `X-Issuer`: issuer URL
- **And** the raw Authorization header is NOT included

**Verification:**
```bash
# Get a valid token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')

# Make a chat query (this will trigger OPEA call)
curl -sk -X POST "https://localhost/api/chat" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello E2E test"}
    ]
  }'

# Check OPEA service logs to verify headers were received
docker compose logs chatqna-xeon-backend-server 2>&1 | grep -E "X-User-Id|X-User-Roles|X-Issuer"
```

> **Note:** Full OPEA header verification requires `DEPLOY_OPEA=1` in `.env`. Without OPEA services, the chat endpoint will fail -- but the backend logs will still show the header construction step.

**Expected Behavior:**
- OPEA service receives the three headers with correct values
- ArangoDB `_key` is correctly passed as `X-User-Id`
- Authorization header is NOT present in OPEA request
- Headers are applied via spread operator in axios: `headers: { 'Content-Type': 'application/json', ...headers }`

---

### Test F.3 — X-User-Id Uses ArangoDB _Key Format

**Given** multiple Keycloak realms are configured (e.g., `genie` and `genie2`)
**When** tokens from different realms are used to make authenticated requests
**Then** the `X-User-Id` header contains the ArangoDB `_key` of the provisioned user:
  - Genie realm token -> `<arangodb_key>` (e.g., `12345`)
  - Genie2 realm token -> `<arangodb_key>` (e.g., `67890`)

**Verification:**
```bash
# Get admin token
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=\${GENIE_ADMIN_USERNAME:-genie-admin}" -d "password=\${GENIE_ADMIN_PASSWORD}" -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Create user in genie realm (if not exists)
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "e2e-test-user",
    "email": "e2e@example.com",
    "enabled": true,
    "credentials": [{ "type": "password", "value": "e2epass123", "temporary": false }]
  }'

# Get user token from genie realm
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=e2e-test-user&password=e2epass123&grant_type=password' | jq -r '.access_token')

# Look up the user in ArangoDB to find their _key
USER_KEY=$(curl -sk -X GET "https://localhost/api/admin/users/search?email=e2e@example.com" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

echo "User _key: $USER_KEY"

# Make request and verify X-User-Id in backend logs
curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN"

# Check backend logs for the X-User-Id header value
docker compose logs backend 2>&1 | grep -E "X-User-Id" | tail -5
# Expected: X-User-Id contains the ArangoDB _key (e.g., "12345")
```

> **Note:** This test uses the user profile endpoint and backend log inspection.

**Expected Behavior:**
- `X-User-Id` uses ArangoDB `_key` format (Story 2-10 change)
- Different users from different realms have unique ArangoDB `_key` values
- No collision between user IDs across realms

---

### Test F.4 — Raw Authorization Header is NOT Forwarded to OPEA

**Given** a request contains an Authorization header with a Keycloak token
**When** the request is forwarded to an OPEA service via the worker thread
**Then** the Authorization header is NOT included in the OPEA HTTP request

**Verification:**
```bash
# Get test user token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')

# Make OPEA call and capture what was sent
curl -sk -X POST "https://localhost/api/chat" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Test"}]}'

# Check OPEA service logs - should NOT show Authorization header
docker compose logs chatqna-xeon-backend-server 2>&1 | grep -i "authorization"
# Expected: No Authorization header in logs
```

> **Note:** Full OPEA header verification requires `DEPLOY_OPEA=1`. Use backend log analysis to confirm the Authorization header is stripped before forwarding to OPEA services.

**Expected Behavior:**
- Authorization header is stripped before OPEA call
- Worker thread cannot access request headers (isolation)
- Only explicitly passed headers are sent to OPEA

---

### Test F.5 — OPEA Service Receives Existing Payload Structure

**Given** the OPEA payload structure includes a `user_id` field
**When** the request is forwarded to OPEA services
**Then** the `user_id` field contains the ArangoDB `_key` (not composite `{iss}#{sub}`)
**And** the rest of the payload structure is preserved

**Verification:**
```bash
# Get test user token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')

# Make chat query
RESPONSE=$(curl -sk -X POST "https://localhost/api/chat" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Verify user_id"}]}')

# Extract user_id from OPEA response
echo "$RESPONSE" | jq '.data.metadata.user_id'
# Expected: ArangoDB _key (e.g., "12345")

# Verify full payload structure preserved
echo "$RESPONSE" | jq '.data | keys'
# Expected: Keys like "response", "metadata", etc. are preserved
```

**Expected Behavior:**
- `user_id` contains ArangoDB `_key` (e.g., `12345`), not composite key format (Story 2-10 change)
- OPEA services treat `user_id` as opaque string (no parsing of format)
- Other payload fields remain unchanged
- Backwards compatible with OPEA expectations

---

### Test F.6 — Missing realm_access.roles Claim Handling

**Given** a JWT token from a realm with minimal claims (no `realm_access`)
**When** the `realm_access.roles` claim is missing or empty
**Then** the `X-User-Roles` header is an empty string

**Verification:**
```bash
# Get admin token
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=\${GENIE_ADMIN_USERNAME:-genie-admin}" -d "password=\${GENIE_ADMIN_PASSWORD}" -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Look up the test user's _key
USER_KEY=$(curl -sk -X GET "https://localhost/api/admin/users/search?email=e2e@example.com" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

# Remove roles (Keycloak 26 specific approach)
curl -sk -X PATCH "https://localhost/api/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roles": []}'

# Get token for user without roles
NO_ROLES_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=e2e@example.com&password=e2epass123&grant_type=password' | jq -r '.access_token')

# Make request and check X-User-Roles in backend logs
curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $NO_ROLES_TOKEN"

# Verify backend logs for empty X-User-Roles
docker compose logs backend 2>&1 | grep -E "X-User-Roles" | tail -5
# Expected: X-User-Roles: "" (empty string)

# Verify backend doesn't crash on missing roles
curl -sk -X POST "https://localhost/api/chat" \
  -H "Authorization: Bearer $NO_ROLES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"No roles test"}]}'
# Should succeed (401 if token invalid, 200 if token valid but no auth required)
```

> **Note:** This test uses backend log analysis to verify the `X-User-Roles` header value.

**Expected Behavior:**
- Missing `realm_access.roles` -> empty string in X-User-Roles
- Empty roles array -> empty string in X-User-Roles
- No crashes or errors in header construction
- Token validation proceeds normally

---

### Test F.7 — Multi-Realm Header Isolation

**Given** two Keycloak realms exist: `genie` and `genie2`
**When** tokens from each realm make requests
**Then** the `X-User-Id` headers are different for each realm
**And** the `X-User-Roles` header reflects each realm's roles independently

**Verification:**
```bash
# Get admin token
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=\${GENIE_ADMIN_USERNAME:-genie-admin}" -d "password=\${GENIE_ADMIN_PASSWORD}" -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Create user in genie realm with 'user' role
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "genie-realm-user",
    "email": "genie@example.com",
    "enabled": true,
    "credentials": [{ "type": "password", "value": "geniepass123", "temporary": false }],
    "realmRoles": [{ "id": "user", "name": "user" }]
  }'

# Create user in genie2 realm with 'admin' role
curl -sk -X POST "https://localhost/auth/admin/realms/genie2/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "genie2-realm-user",
    "email": "genie2@example.com",
    "enabled": true,
    "credentials": [{ "type": "password", "value": "genie2pass123", "temporary": false }],
    "realmRoles": [{ "id": "admin", "name": "admin" }]
  }'

# Get tokens from both realms
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=genie-realm-user&password=geniepass123&grant_type=password' | jq -r '.access_token')

USER2_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie2/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=genie2-realm-user&password=genie2pass123&grant_type=password' | jq -r '.access_token')

# Look up user keys in ArangoDB for both users
GENIE_USER_KEY=$(curl -sk -X GET "https://localhost/api/admin/users/search?email=genie@example.com" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')
GENIE2_USER_KEY=$(curl -sk -X GET "https://localhost/api/admin/users/search?email=genie2@example.com" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

# Make request with genie realm token and check logs
curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN"
docker compose logs backend 2>&1 | grep -E "X-User-Id" | tail -5
# Expected: X-User-Id contains the genie-realm-user's ArangoDB _key

# Make request with genie2 realm token and check logs
curl -sk -X GET "https://localhost/api/me" \
  -H "Authorization: Bearer $USER2_TOKEN"
docker compose logs backend 2>&1 | grep -E "X-User-Id" | tail -5
# Expected: X-User-Id contains the genie2-realm-user's ArangoDB _key (different from genie)
```

> **Note:** This test uses user profile endpoints and backend log analysis. Each user from a different realm gets a unique ArangoDB `_key`.

**Expected Behavior:**
- Each realm produces unique X-User-Id values (distinct ArangoDB `_key` per user)
- X-User-Roles reflects each realm's roles correctly
- No cross-contamination between realms

---

### Test F.8 — OPEA Compatibility: Existing Payload Structure Preserved

**Given** OPEA services expect a specific payload structure
**When** the request is forwarded with the new headers
**Then** the existing payload structure (except `user_id` format) is preserved

**Verification:**
```bash
# Get test user token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d 'client_id=genie-app&username=testuser&password=TestPass123!&grant_type=password' | jq -r '.access_token')

# Make chat query
RESPONSE=$(curl -sk -X POST "https://localhost/api/chat" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Payload preservation test"}]}')

# Verify response structure
echo "$RESPONSE" | jq 'keys | sort'
# Should contain: response, metadata (with user_id, responseTime, etc.)

# Verify user_id format (ArangoDB _key)
echo "$RESPONSE" | jq '.data.metadata.user_id'
# Should be: ArangoDB _key (e.g., "12345")

# Verify OPEA services don't break
echo "$RESPONSE" | jq '.data.response'
# Should contain actual OPEA response, not error
```

**Expected Behavior:**
- OPEA services function normally with new user_id format (ArangoDB `_key`)
- No breaking changes to OPEA payload structure
- OPEA services remain Keycloak-agnostic (opaque user_id string)

---

## Phase G: Swagger UI OAuth2 Authentication

Validates that the Swagger UI includes a Keycloak OIDC "Authorize" button, allowing developers to test protected endpoints with an authenticated session directly from the API documentation interface (FR25).

> **Note**: This phase validates the Swagger UI OAuth2 integration implemented in Story 2.8. Tests cover both the Swagger specification configuration and the complete browser-based authentication flow.

### Prerequisites

- Stack is deployed and healthy (from Phase 0)
- Test user exists with `GENIE.AI_USER` role (from Phase 0, Step 0.9)
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
npx playwright test tests/e2e/epic2/g1-swagger-authorize.spec.js
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
npx playwright test tests/e2e/epic2/g1-swagger-authorize.spec.js
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
npx playwright test tests/e2e/epic2/g1-swagger-authorize.spec.js
```

**Expected**:
- Response code is NOT 401
- Protected endpoint returns data

**On failure**: Check that the test user has the `GENIE.AI_USER` role in Keycloak.

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
3. Test user lacks required role

**Fix**:
1. Open browser DevTools Network tab while executing a request
2. Check if `Authorization: Bearer <token>` header is present
3. Verify the test user has the `GENIE.AI_USER` role in Keycloak:
```bash
curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].realmRoles'
```

---

## Phase H: JWKS Force-Refresh (Story 2-2)

**Playwright spec**: `npx playwright test tests/e2e/epic2/h1-jwks-force-refresh.spec.js`

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

Generate a new RSA signing key via the Keycloak Admin API and demote the old key. This simulates a key rotation event.

```bash
# Get realm UUID (needed as parentId for key components)
REALM_ID=$(curl -sk "https://localhost/auth/admin/realms/genie" \
  -H "Authorization: Bearer $TOKEN" | jq -r .id)
echo "Realm UUID: $REALM_ID"

# Generate new RSA key pair (priority 101 = higher than default 100 = becomes active)
curl -sk -X POST "https://localhost/auth/admin/realms/genie/components" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{
    "name": "rsa-generated-rotated",
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

**Expected**: `HTTP: 201` (new key component created)

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

**Expected**: Two key providers listed, the rotated one with `priority=101, active=true`

```bash
# Demote old key (find the original, set active=false)
OLD_KEY_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/components?type=org.keycloak.keys.KeyProvider" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
components = json.load(sys.stdin)
for c in components:
    if 'rsa-generated' == c.get('name') or c.get('config', {}).get('priority', ['0'])[0] != '101':
        print(c['id'])
        break
")

# Demote: get full component, set active=false, PUT back
curl -sk "https://localhost/auth/admin/realms/genie/components/$OLD_KEY_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
c = json.load(sys.stdin)
c['config']['active'] = ['false']
print(json.dumps(c))
" | curl -sk -X PUT "https://localhost/auth/admin/realms/genie/components/$OLD_KEY_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 204` (old key demoted successfully)

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
npx playwright test tests/e2e/epic2/h1-jwks-force-refresh.spec.js
```

---

## Phase I: Multi-Realm Configuration (Story 2-9)

**Playwright spec**: `npx playwright test tests/e2e/epic2/i1-multi-realm.spec.js`

Validates that the backend can validate tokens from multiple Keycloak realms simultaneously, maintaining separate user identities via the `{iss}#{sub}` composite key in ArangoDB.

### Prerequisites

- Phase 0 complete (`$TOKEN` available)
- **IMPORTANT**: `KEYCLOAK_ADDITIONAL_REALMS={"genie2":"genie-app"}` must be set in `.env` BEFORE deploying the stack. The additional realms must be created in Keycloak before the backend starts — see Phase 0, Step 0.6.

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
# Test genie realm token (original)
echo "=== Genie realm token ==="
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'User: {d.get(\"user\",{}).get(\"name\", d.get(\"error\", \"N/A\"))}')"

# Test genie2 realm token
echo "=== Genie2 realm token ==="
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER2_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'User: {d.get(\"user\",{}).get(\"name\", d.get(\"error\", \"N/A\"))}')"
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
NOROLES_USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie2/users?username=testuser2" \
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

Note: `user_id` in the payload uses ArangoDB `_key` (e.g., `12345`), NOT the composite `iss#sub` string.

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

**This phase mutates Keycloak realm settings and stops the Keycloak service. Cleanup steps (K.5, K.6) restore state. Verify stack health before proceeding to Phase L (Epic 3).**

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
npx playwright test tests/e2e/epic2/k1-auth-error-display.spec.js
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

# Wait for expiry
echo "Waiting 12 seconds for token to expire..."
sleep 12

# Send expired token
curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $EXPIRED_TOKEN" | jq .
```

**Expected**: `HTTP: 401` with `{"error": "TOKEN_EXPIRED", "message": "Token has expired"}`

**Note**: Do NOT restore `accessTokenLifespan` yet — K.5 handles that. In the Playwright spec (`k1-auth-error-display.spec.js`), the restore is in `afterAll` to guarantee cleanup even if tests fail.

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
# Step 1: Get a fresh token while Keycloak is still running
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Step 2: Stop Keycloak and test in the SAME shell
docker compose stop keycloak
echo "Waiting 15 seconds for Keycloak to stop..."
sleep 15

curl -sk "https://localhost/api/me" \
  -H "Authorization: Bearer $USER_TOKEN" | jq .
```

**Expected**: `HTTP: 200` with `{"success": true, ...}` — the backend validates the JWT using cached JWKS keys and does not need Keycloak for every request. This is the correct behavior: the auth system is resilient to temporary Keycloak outages for already-authenticated users.

> **Note**: If you see `HTTP: 401`, the token may have expired during the wait. Re-run Step 1 to get a fresh token before Keycloak is stopped, and reduce the sleep time.

```bash
# Step 3: Restore Keycloak
docker compose start keycloak
echo "Waiting for Keycloak to recover (60-90 seconds)..."
sleep 60

# Reload Kong DNS cache (Kong caches the old Keycloak container IP after stop/start)
docker exec $(docker ps --filter name=kong --format '{{.ID}}' | head -1) kong reload
echo "Waiting 10 seconds for Kong reload..."
sleep 10

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
NOROLES_USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=noroles-user-e2e" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

curl -sk -X DELETE "https://localhost/auth/admin/realms/genie/users/${NOROLES_USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n"
```

**Expected**: `HTTP: 204`

---

**Phase K complete.** All realm settings restored, test user cleaned up. Stack is ready for Phase L (Epic 3). Verify:

```bash
docker compose ps
```
