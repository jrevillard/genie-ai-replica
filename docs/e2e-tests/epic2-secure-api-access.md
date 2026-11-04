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
# Uses $TOKEN — the MASTER admin token from Phase 0 (see Variable Reference).
# The genie-realm admin-cli route is not usable here: the env template ships
# no GENIE_ADMIN_PASSWORD, so that login cannot succeed on a clean stack.
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

**Note**: Do NOT restore `accessTokenLifespan` yet — K.5 handles that. In the Playwright spec (`k1-auth-error-display.spec.js`), the deployment's lifespan is captured before any mutation; the K.3 test restores it before minting its own tokens, and `afterAll` restores it again on failure paths (skipped when the capture itself failed).

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

> **Note**: If you see `HTTP: 401`, the likely cause is the 5-minute JWKS cache TTL: if no authenticated request ran in the last 5 minutes, the backend refetches the keys from the stopped Keycloak and verification fails. The remedy is not a shorter sleep — re-run Step 1 to get a fresh token AND make one authenticated call (e.g. `GET /api/me`) immediately before Step 2, so the JWKS cache is warm when Keycloak stops.

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
NOROLES_USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=noroles-user-e2e&exact=true" \
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
