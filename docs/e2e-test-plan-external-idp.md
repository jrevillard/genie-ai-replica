# E2E Test Plan: Keycloak Authentication Flow

This document describes the end-to-end test procedure for validating GENIE.AI's Keycloak authentication flow, including frontend login redirect, JIT user provisioning, transparent re-authentication, token validation error handling, and external IdP connection via Keycloak.

## Test Tools

- **API tests**: `curl` with admin token
- **Browser tests**: [playwright-cli](https://github.com/chauncey/playwright-cli) (headless Chromium)
- **Helper**: Get admin token once, reuse `$TOKEN` throughout

### Playwright HTTPS Configuration

All browser tests access `https://localhost` with a self-signed certificate. Playwright requires explicit configuration to bypass certificate validation:

```javascript
// Every browser test must create a context with these options:
const context = await browser.newContext({
  ignoreHTTPSErrors: true,  // Bypass self-signed cert errors
  bypassCSP: true           // Allow cross-origin requests during testing
});
```

With `playwright-cli`, use `run-code` to create the context:
```bash
playwright-cli run-code "
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
  const newPage = await context.newPage();
  // ... test code
}
"
```

**Note**: The default `playwright-cli open` page does **not** have `ignoreHTTPSErrors` set. Always create a new context via `run-code` for HTTPS pages.

---

## Phase 0: Clean Start

This test plan is designed to run from a clean stack. If a stack is already running, tear it down first.

**Scope**: These tests only validate the Keycloak authentication flow. The OPEA/AI stack (vLLM, TEI, chat, etc.) is **not needed**. Set `DEPLOY_OPEA=0` to skip GPU-dependent services.

### 0.1 Stop and Remove Existing Stack

```bash
docker stack rm genieai
# Wait for all services to be removed
echo "Waiting for services to stop..."
while docker service ls --filter label=com.docker.stack.namespace=genieai -q 2>/dev/null | grep -q .; do sleep 2; done
echo "Stack removed."
```

### 0.2 Clean Volumes and Local Registry

Remove persistent data and the local Docker registry to ensure a fully clean state. This also catches any image name mismatches during the build step (wrong names will fail to push if the registry is empty).

**Warning**: This deletes all ArangoDB data, Keycloak data, Redis cache, and locally cached images.

```bash
# Remove volumes
docker volume ls --filter label=com.docker.stack.namespace=genieai -q | xargs -r docker volume rm

# Remove local registry and its data
docker container stop registry 2>/dev/null && docker container rm registry 2>/dev/null
docker volume rm registry_data 2>/dev/null
echo "Registry cleaned."
```

### 0.3 Prepare `.env` File

The project uses a single `.env` file at the project root. Copy the template and set required secrets:

```bash
cd /path/to/genie-ai
cp env .env
```

Edit `.env` and set at minimum these values:

```bash
# Required secrets (generate with: python3 -c "import secrets; print(secrets.token_urlsafe(32))")
ARANGO_PASSWORD=arangopwd
JWT_SECRET=any-random-string
SESSION_SECRET=any-random-string
TRANSLATION_CACHE_PASSWORD=any-random-string

# PostgreSQL (Keycloak + Kong)
POSTGRES_PASSWORD=keycloakpwd

# Keycloak admin
KEYCLOAK_ADMIN_PASSWORD=admin

# NGINX_PUBLIC_DOMAIN — defaults to "localhost" in docker-compose.yaml
# Only set this if deploying to a domain other than localhost
# NGINX_PUBLIC_DOMAIN=localhost

# Required for local dev with self-signed certs
NODE_TLS_REJECT_UNAUTHORIZED=0

# Skip OPEA/AI services (not needed for auth tests, avoids GPU requirement)
DEPLOY_OPEA=0
```

### 0.4 Build and Push Images

`docker stack deploy` cannot build images — all images must be pre-built and pushed to a local registry.

For the full build procedure (13 services), see **`docs/docker-swarm-setup.md` Step 5**. For auth testing with `DEPLOY_OPEA=0`, only these 9 images are needed:

```bash
# Start local registry if not already running
docker run -d -p 5000:5000 --name registry --restart=unless-stopped registry:2 2>/dev/null \
  || echo "Registry already running."

# Build images
# NOTE: Some Dockerfiles COPY from a parent directory, so the build context
# differs from the Dockerfile location. These use -f <dockerfile> <context>.
docker build -t genieai_mvp_frontend:latest components/gov-chat-frontend/
docker build -f components/gov-chat-backend/Dockerfile -t genieai_mvp_backend:latest components/
docker build -f components/document-repository/Dockerfile -t genieai_mvp_document-repository:latest components/
docker build -f genie-ai-overlay/http-service/Dockerfile -t genieai_mvp_http-service:latest .
docker build -t genie-ai-nginx:latest api-gateway-solution/nginx/
docker build -t genie-ai-kong-config:latest api-gateway-solution/new-config/
docker build -t genie-ai-postgres-init:latest config/postgres/
docker build -t genie-ai-keycloak:latest config/keycloak/
docker build -f config/keycloak/Dockerfile.config-cli -t genie-ai-keycloak-config:latest config/keycloak/

# Tag for local registry (docker-compose references ${SWARM_REGISTRY_URL}/genie-ai-<name>:latest)
docker tag genieai_mvp_frontend:latest localhost:5000/genie-ai-frontend:latest
docker tag genieai_mvp_backend:latest localhost:5000/genie-ai-backend:latest
docker tag genieai_mvp_document-repository:latest localhost:5000/genie-ai-document-repository:latest
docker tag genieai_mvp_http-service:latest localhost:5000/genie-ai-http-service:latest
docker tag genie-ai-nginx:latest localhost:5000/genie-ai-nginx:latest
docker tag genie-ai-kong-config:latest localhost:5000/genie-ai-kong-config:latest
docker tag genie-ai-postgres-init:latest localhost:5000/genie-ai-postgres-init:latest
docker tag genie-ai-keycloak:latest localhost:5000/genie-ai-keycloak:latest
docker tag genie-ai-keycloak-config:latest localhost:5000/genie-ai-keycloak-config:latest

# Push to local registry
docker push localhost:5000/genie-ai-frontend:latest
docker push localhost:5000/genie-ai-backend:latest
docker push localhost:5000/genie-ai-document-repository:latest
docker push localhost:5000/genie-ai-http-service:latest
docker push localhost:5000/genie-ai-nginx:latest
docker push localhost:5000/genie-ai-kong-config:latest
docker push localhost:5000/genie-ai-postgres-init:latest
docker push localhost:5000/genie-ai-keycloak:latest
docker push localhost:5000/genie-ai-keycloak-config:latest
```

### 0.5 Deploy Stack

```bash
set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai
```

### 0.6 Verify Stack Health

Wait for all services to become healthy. This may take 2-5 minutes depending on image availability.

```bash
# Check service status — all should show "Running" with replicas 1/1
docker service ls --filter label=com.docker.stack.namespace=genieai

# Detailed per-service check
echo "=== Service Health ==="
for svc in frontend backend keycloak arango nginx kong; do
  replicas=$(docker service ls --filter name=genieai_${svc} --format '{{.Replicas}}' 2>/dev/null || echo "N/A")
  echo "  ${svc}: ${replicas}"
done
```

**Expected**: All services show `1/1` replicas.

### 0.7 Verify Individual Services

```bash
# NGINX (reverse proxy)
curl -sk https://localhost/ -o /dev/null -w "NGINX: HTTP %{http_code}\n"
# Expected: 200 or 301

# Keycloak OIDC discovery
curl -sk https://localhost/auth/realms/genie/.well-known/openid-configuration | \
  python3 -c "import sys,json; print('Keycloak issuer:', json.load(sys.stdin)['issuer'])"
# Expected: https://localhost/auth/realms/genie

# Backend health
curl -sk https://localhost/api/health -o /dev/null -w "Backend: HTTP %{http_code}\n"
# Expected: 200

# ArangoDB (internal — run from the backend container)
docker exec $(docker ps --filter name=genieai_backend --format '{{.ID}}' | head -1) \
  bash -c 'curl -sk http://genieai_arango:8529/_admin/cluster/health' 2>/dev/null | head -1
# Expected: {"clusterId":...,"health":"GOOD",...}
```

### 0.8 Enable ROPC on genie-app Client (Test Only)

The `genie-app` client uses authorization code flow for the frontend. ROPC (Direct Access Grants) is only needed for API testing via curl and should **not** be enabled in production.

Verify and enable for testing:

```bash
source .env
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

GENIE_APP_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/clients?clientId=genie-app" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Verify ROPC is enabled
curl -sk "https://localhost/auth/admin/realms/genie/clients/${GENIE_APP_ID}" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
c = json.load(sys.stdin)
print(f'directAccessGrantsEnabled: {c.get(\"directAccessGrantsEnabled\")}')
print(f'publicClient: {c.get(\"publicClient\")}')
"
# Expected: directAccessGrantsEnabled: True, publicClient: True
```

If ROPC is not enabled:
```bash
curl -sk -X PUT "https://localhost/auth/admin/realms/genie/clients/${GENIE_APP_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"directAccessGrantsEnabled": true, "publicClient": true, "standardFlowEnabled": true}'
# Expected: 204
```

### 0.9 Create Test User and Verify ROPC Token Retrieval

Create a test user via admin API (no pre-existing user required):

```bash
source .env

# Create test user (201 = created, 409 = already exists — OK)
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "enabled": true,
    "email": "testuser@genie.local",
    "firstName": "Test",
    "lastName": "User",
    "credentials": [{"type": "password", "value": "TestPass123!", "temporary": false}]
  }' -w "\nHTTP: %{http_code}\n"

# Verify ROPC token retrieval
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "$TOKEN" | cut -d. -f2 | python3 -c "
import sys,base64,json
p=sys.stdin.read()
claims = json.loads(base64.urlsafe_b64decode(p+(4-len(p)%4)%4*'='))
print(f'azp: {claims[\"azp\"]}')
print(f'iss: {claims[\"iss\"]}')
print(f'preferred_username: {claims.get(\"preferred_username\", \"N/A\")}')
"
# Expected: azp: genie-app, iss: https://localhost/auth/realms/genie, preferred_username: testuser
```

**Test user credentials** (used throughout all test phases):
- Username: `testuser`
- Password: `TestPass123!`

---

## Get Admin Token

All API tests require an admin token. Run this once and reuse `$TOKEN` throughout the session:

```bash
source .env
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

---

## Prerequisites

- GENIE.AI Docker Swarm stack deployed and healthy (Phase 0 complete)
- Admin access to Keycloak (`KEYCLOAK_ADMIN_PASSWORD` from `.env`)
- `playwright-cli` installed (`npm install -g @playwright/cli && playwright install chromium`)
- `curl`, `python3`, `jq` available on the host

## Architecture Notes

The backend reaches Keycloak via the **public URL** through NGINX proxy (not the Docker internal URL). This is the production architecture — Keycloak is external to Docker. The backend's `KEYCLOAK_URL` must match the issuer returned by OIDC discovery, otherwise token validation fails.

- **Default `KEYCLOAK_URL`**: no fallback — the env var is required (`docker-compose.yaml` sets it from `NGINX_PUBLIC_DOMAIN`)
- **`NODE_TLS_REJECT_UNAUTHORIZED`**: defaults to `1` (strict, for production). Set to `0` in `.env` for local dev with self-signed NGINX certs
- **`extra_hosts`**: docker-compose maps `NGINX_PUBLIC_DOMAIN` to `host-gateway` so the backend container can resolve the public URL

## Important: Keycloak API Path Convention

Kong strips the `/auth` prefix before forwarding to Keycloak. Therefore:

- **Via proxy (NGINX/Kong)**: `https://localhost/auth/admin/realms/{realm}/...`
- **Direct to Keycloak container**: `http://<keycloak-ip>:8080/admin/realms/{realm}/...`

The Keycloak Admin REST API base path is always `/admin/realms/{realm}/...`. The `/auth` prefix is added by the NGINX reverse proxy.

**Correct identity provider endpoints**:
- List: `GET /admin/realms/{realm}/identity-provider/instances`
- Create: `POST /admin/realms/{realm}/identity-provider/instances`
- Delete: `DELETE /admin/realms/{realm}/identity-provider/instances/{alias}`
- Provider types: `GET /admin/realms/{realm}/identity-provider/providers/{provider_id}`

**Note**: The path is `/identity-provider/instances` (singular "provider" + "instances"), NOT `/identity-providers/instances` or `/identity-providers`.

## Phase A: Frontend Login Redirect

### Test A.1 — Redirect to Keycloak

```bash
playwright-cli open --browser=chromium
playwright-cli run-code "
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
  const newPage = await context.newPage();
  await newPage.goto('https://localhost/', { waitUntil: 'networkidle', timeout: 15000 });
  await newPage.waitForURL('**/protocol/openid-connect/auth**', { timeout: 10000 });
  return { redirected: newPage.url().includes('/auth/realms/genie/') };
}
"
playwright-cli close
```
**Expected**: `{ redirected: true }`

### Test A.2 — Full Login Flow

```bash
playwright-cli open --browser=chromium
playwright-cli run-code "
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
  const newPage = await context.newPage();
  await newPage.goto('https://localhost/', { waitUntil: 'networkidle', timeout: 15000 });
  await newPage.waitForURL('**/protocol/openid-connect/auth**', { timeout: 10000 });
  await newPage.fill('#username', 'testuser');
  await newPage.fill('#password', 'TestPass123!');
  await newPage.click('#kc-login');
  await newPage.waitForURL('https://localhost/**', { timeout: 15000 });
  await newPage.waitForTimeout(5000);
  const body = await newPage.evaluate(() => document.body.innerText.substring(0, 200));
  return { url: newPage.url(), hasDashboard: newPage.url().includes('dashboard'), body };
}
"
playwright-cli close
```
**Expected**: URL is `https://localhost/dashboard`, body contains "GENIE.AI"

### Test A.3 — Legacy Routes Redirect

```bash
playwright-cli open --browser=chromium
playwright-cli run-code "
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
  const newPage = await context.newPage();
  const results = {};
  for (const path of ['/login', '/register', '/forgot-password']) {
    await newPage.goto('https://localhost' + path, { waitUntil: 'networkidle', timeout: 15000 });
    await newPage.waitForTimeout(2000);
    results[path] = newPage.url().includes('/auth/realms/genie/');
  }
  return results;
}
"
playwright-cli close
```
**Expected**: All three redirect to Keycloak (`true`)

---

## Phase B: JIT User Provisioning

### Test B.1 — First Login Creates User in ArangoDB

```bash
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
**Expected**: HTTP 200 with `success: true` and user profile

### Test B.2 — ArangoDB Document

```bash
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    print(JSON.stringify(db.users.toArray().map(u => ({
      _key:u._key, iss_sub:u.iss_sub, email:u.email, active:u.active, deleted:u.deleted, sub:u.sub
    })), null, 2))
  "
```
**Expected**: Document with `iss_sub`, `sub`, `email`, `active: true`, `deleted: false`

### Test B.3 — UPSERT Atomic (No Duplicates)

Re-run Test B.1 to trigger provisioning again, then verify document count is still 1:

```bash
# Re-run provisioning (same user)
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
# Expected: 200

# Verify exactly 1 user document in ArangoDB
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var count = db.users.count();
    print('User count: ' + count);
    if (count !== 1) { print('FAIL: Expected 1 user, found ' + count); }
    else { print('PASS'); }
  "
# Expected: PASS
```

### Test B.4 — Soft-Deleted User Returns 403

```bash
# Find the user's ArangoDB _key (auto-generated, varies per deployment)
USER_KEY=$(docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print(u._key);
  " 2>/dev/null | tail -1)

echo "User _key: $USER_KEY"

# Mark deleted
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai'); db.users.update('${USER_KEY}', {deleted:true,active:false});
  "

# Test — should return 403
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $TOKEN"
# Expected: {"error":"FORBIDDEN","message":"User account is deactivated"}

# Restore (cleanup)
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai'); db.users.update('${USER_KEY}', {deleted:false,active:true});
  "
echo "User restored."
```

---

## Phase C: Token Validation Errors

### Test C.1 — Malformed Token

```bash
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer not-a-real-token"
# Expected: {"error":"TOKEN_INVALID","message":"Token verification failed","details":{}}
```

### Test C.2 — Not Enough Parts

```bash
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer a.b"
# Expected: {"error":"TOKEN_INVALID","message":"Token verification failed","details":{}}
```

### Test C.3 — No Token

```bash
curl -sk "https://localhost/api/auth/me"
# Expected: {"error":"TOKEN_INVALID","message":"Missing or malformed Authorization header","details":{}}
```

### Test C.4 — No Internal Details Leaked

All three responses above must have `"details": {}` — no Keycloak URL, client ID, stack trace, or JWT payload.

---

## Phase D: External IdP Connection

Instead of requiring a real external IdP (Google, Microsoft), this test uses a second Keycloak realm as a mock external IdP. This validates the exact same brokering flow without requiring external credentials or network connectivity.

```
GENIE.AI Frontend -> Keycloak (genie realm) -> Keycloak (external-idp realm) -> GENIE.AI Backend
```

**Prerequisite chain**: Phases A, B, C must pass before running Phase D. Phase D builds on a working login, provisioning, and token validation flow.

**Admin token**: Ensure `$TOKEN` is set from the "Get Admin Token" section above. If the token has expired, re-run it.

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

Alternatively, open `https://localhost/auth/realms/genie/protocol/openid-connect/auth?client_id=genie-app&redirect_uri=https://localhost/*&response_type=code&code_challenge=test&code_challenge_method=S256` in a browser — the login page should show an "External IdP (Keycloak)" button.

## Step 4: Broker Redirect (Browser Only)

The broker redirect cannot be tested via curl — Keycloak broker login links contain session tokens that require browser cookies. The broker redirect is fully validated in **Step 7b** (browser test).

To verify the broker URL is present on the login page (from Step 3 output):

```bash
# Extract the broker URL from the login page (informational only)
BROKER_URL=$(grep -oP 'href="\K[^"]*broker/external-idp/login[^"]*' /tmp/keycloak-login.html | sed 's/&amp;/\&/g')
echo "Broker URL: https://localhost${BROKER_URL}"
# Expected: a URL containing /broker/external-idp/login
```

The full broker redirect flow (genie realm → external-idp realm → broker exchange → callback → dashboard) is tested in Step 7b.

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

### Step 7a — External IdP Button Visible on Login Page

```bash
playwright-cli open --browser=chromium
playwright-cli run-code "
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
  const newPage = await context.newPage();
  await newPage.goto('https://localhost/', { waitUntil: 'networkidle', timeout: 15000 });
  await newPage.waitForURL('**/protocol/openid-connect/auth**', { timeout: 10000 });
  await newPage.waitForTimeout(2000);
  const links = await newPage.evaluate(() =>
    Array.from(document.querySelectorAll('a')).map(a => ({text: a.textContent.trim(), href: a.href}))
  );
  const hasExternalIdp = links.some(l => l.text.includes('External IdP'));
  return { hasExternalIdp };
}
"
playwright-cli close
```
**Expected**: `{ hasExternalIdp: true }`

### Step 7b — Full External IdP Login Flow

```bash
playwright-cli open --browser=chromium
playwright-cli run-code "
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true });
  const newPage = await context.newPage();
  try {
    await newPage.goto('https://localhost/', { waitUntil: 'networkidle', timeout: 15000 });
    await newPage.waitForURL('**/protocol/openid-connect/auth**', { timeout: 10000 });
    // Click External IdP link (case-sensitive: 'External IdP')
    await newPage.click('a:has-text(\"External IdP\")');
    // Should redirect to external-idp realm login
    await newPage.waitForURL('**/realms/external-idp/**', { timeout: 10000 });
    // Login with external user (password is External123!, NOT TestPass123!)
    await newPage.fill('#username', 'external-test-user');
    await newPage.fill('#password', 'External123!');
    await newPage.click('#kc-login');
    // Wait for final redirect (broker exchange → callback → dashboard)
    await newPage.waitForURL(u => {
      const s = u.toString();
      return s.includes('/callback') || s.includes('/dashboard');
    }, { timeout: 30000 });
    await newPage.waitForTimeout(3000);
    const finalUrl = newPage.url();
    const body = await newPage.evaluate(() => document.body.innerText.substring(0, 200));
    return { url: finalUrl, hasDashboard: finalUrl.includes('dashboard'), body };
  } catch (e) {
    // On failure, capture the current page state for debugging
    const errUrl = newPage.url();
    const errBody = await newPage.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => 'N/A');
    return { error: e.message, url: errUrl, body: errBody };
  }
}
"
playwright-cli close
```
**Expected**: `hasDashboard: true`, URL is `https://localhost/dashboard`, body contains "GENIE.AI"

**On failure**: The `try/catch` block returns the current URL and page content so you can see where the flow broke (e.g., stuck on external-idp login, broker error page, or redirect loop).

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

### Test E.1 — Backend Auth Code: No External Calls (AC #1)

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

### Test E.2 — Keycloak Realm: No External URLs (AC #3)

Verify the Keycloak realm configuration contains no external URLs.

```bash
grep -rn 'http[s]\?://' config/keycloak/genie-realm.yaml
```

**Expected**: Only `localhost` URLs in `redirectUris` and `webOrigins` fields. Zero external URLs.

### Test E.3 — Frontend OIDC: All Endpoints Local (AC #4)

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

### Test E.4 — Image List: All External Images Documented (AC #2)

Verify that all external images referenced in `docker-compose.yaml` have a corresponding pre-pull entry in `docs/docker-swarm-setup.md` Step 5d.

```bash
# Extract unique external images from docker-compose.yaml (non-registry-prefixed)
grep -oP 'image:\s*\K(?!.*\$\{)[^\s]+' docker-compose.yaml | sort -u

# Compare against Step 5d list
grep 'docker pull' docs/docker-swarm-setup.md | awk '{print $3}'
```

**Expected**: All 16 external images (12 runtime + 4 build-time Dockerfiles) appear in both lists. No gaps.

### Test E.5 — Network Isolation: Full Auth Cycle (AC #5)

Validate data residency by running a complete authentication cycle with external network connectivity blocked. **This test requires a deployed stack and must be executed manually.**

#### Method A: iptables (Linux, non-destructive toggle)

```bash
# 1. Block all outbound traffic from Docker except internal subnet
#    Replace <internal-subnet> with your Docker network (e.g., 10.0.0.0/8 or 172.17.0.0/16)
sudo iptables -I DOCKER-USER -o eth0 -d ! <internal-subnet> -j DROP

# 2. Verify stack is still running
docker service ls --filter label=com.docker.stack.namespace=genieai

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
docker service ls --filter label=com.docker.stack.namespace=genieai

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
| A.2 | Full login → dashboard | | |
| A.3 | Legacy routes redirect | | |
| B.1 | JIT provisioning via /api/auth/me | | |
| B.2 | ArangoDB document created | | |
| B.3 | UPSERT atomic (no duplicates) | | |
| B.4 | Soft-deleted user → 403 | | |
| C.1 | Malformed JWT → TOKEN_INVALID | | |
| C.2 | Not enough parts → TOKEN_INVALID | | |
| C.3 | No token → TOKEN_INVALID | | |
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
| E.1 | Backend auth code: no external calls | PASS | grep audit — all HTTP calls target KEYCLOAK_URL or internal services only |
| E.2 | Keycloak realm: no external URLs | PASS | Only localhost URLs in redirectUris/webOrigins |
| E.3 | Frontend OIDC: all endpoints local | PASS | authority, redirect_uri, post_logout all resolve to ${origin}/auth |
| E.4 | Image list: all external images documented | PASS | 16/16 external images match between docker-compose.yaml and Step 5d (13 runtime + 3 build-time) |
| E.5 | Network isolation: full auth cycle | | Manual — requires deployed stack + network disconnect |

## Full Test Run (Autonomous Execution)

To run the entire test suite from scratch, execute phases in order:

```
Phase 0  → Clean start, deploy stack, verify health
Phase A  → Frontend login redirect (browser tests)
Phase B  → JIT user provisioning (API + ArangoDB)
Phase C  → Token validation errors (API)
Phase D  → External IdP connection (API + browser)
Step 8   → Cleanup (always run, even if tests fail)
Phase E  → Air-gapped deployment validation (grep audit + manual network isolation)
```

**Stop condition**: If any test in a phase fails, do not proceed to the next phase. Diagnose the failure using the Troubleshooting section, fix the issue, and re-run the failing phase.

**Approximate timing**: 15-25 minutes total (mostly waiting for stack startup and Keycloak realm import).

## Acceptance Criteria Mapping

| AC | Test Phase | What is Verified |
|----|-----------|-----------------|
| AC#1: External IdP authentication | Phase D | User can authenticate via external IdP through Keycloak broker |
| AC#2: No code/config changes | Phase D | Backend validates token without any code changes |
| AC#3: Same OIDC redirect pattern | Phase D | Broker redirects to external IdP; token issuer is genie realm |
| AC#4: Any OIDC IdP works | Phase D | Generic OIDC provider works (Keycloak-to-Keycloak brokering) |
| AC#5: Role mapping deferred | Phase D | User receives default realm roles (no custom mapping) |
| **Story 1.10** | | |
| AC#1: Local token validation only | Phase E (E.1) | Backend auth code only targets KEYCLOAK_URL (local) |
| AC#2: All images from local registry | Phase E (E.4) | 16/16 external images documented for pre-pull |
| AC#3: Keycloak offline operation | Phase E (E.2) | Realm YAML has zero external URLs |
| AC#4: Frontend OIDC within boundary | Phase E (E.3) | All OIDC endpoints resolve to ${origin}/auth |
| AC#5: Data residency within boundary | Phase E (E.5) | Full auth cycle with network isolation (manual) |

## Troubleshooting

### Keycloak 26: Missing `sub` claim in access tokens

Keycloak 26 introduced lightweight access tokens where `sub` and `auth_time` are no longer built-in claims. They are now provided by protocol mappers in the `basic` client scope, which is auto-added to new clients but must be manually added to existing clients.

**Fix**: Add `basic` to `defaultClientScopes` in `config/keycloak/genie-realm.yaml`:
```yaml
defaultClientScopes:
  - openid
  - basic      # Required for `sub` claim in access tokens (Keycloak 26+)
  - profile
  - email
  - roles
```

**For existing deployments**, add the scope via admin API:
```bash
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

CLIENT_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/clients?clientId=genie-app" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

BASIC_SCOPE_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/client-scopes?search=basic" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
for s in json.load(sys.stdin):
    if s['name'] == 'basic':
        print(s['id']); break
")

curl -sk -X PUT "https://localhost/auth/admin/realms/genie/clients/${CLIENT_ID}/default-client-scopes/${BASIC_SCOPE_ID}" \
  -H "Authorization: Bearer $TOKEN" -w "HTTP: %{http_code}\n"
# Expected: 204
```

Verify the token includes `sub`:
```bash
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=<user>" -d "password=<pass>" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "$TOKEN" | cut -d. -f2 | python3 -c "
import sys,base64,json
payload = base64.urlsafe_b64decode(sys.stdin.read().strip()+'==')
claims = json.loads(payload)
print('sub:', claims.get('sub', 'MISSING'))
"
# Expected: sub: <uuid>
```

### Identity provider API returns 404

**Most common cause**: Missing `/admin/` in the path. Remember:
- Kong strips `/auth`, so Keycloak sees `/realms/genie/...` (wrong — this is the public path)
- You need `/auth/admin/realms/genie/...` so Keycloak sees `/admin/realms/genie/...`

**Correct paths** (via proxy):
- `https://localhost/auth/admin/realms/genie/identity-provider/instances` (not `/identity-providers/instances`)
- `https://localhost/auth/admin/realms/genie/identity-provider/instances/{alias}` (delete)

### Keycloak admin API returns 502

NGINX cannot reach Keycloak. Check:
```bash
docker service ps genieai_keycloak --format '{{.CurrentState}}'
docker service logs genieai_keycloak --tail 10
```

### Token validation fails on backend

The backend uses OIDC discovery (not hardcoded JWKS URL). On startup, it fetches `KEYCLOAK_URL/realms/genie/.well-known/openid-configuration` to resolve the issuer and JWKS endpoint, then validates tokens via jose's `jwtVerify` with `createRemoteJWKSet`.

**Common causes**:

1. **`KEYCLOAK_URL` not set**: The env var is required (no fallback). Check backend logs for `KEYCLOAK_URL environment variable is required`.
   ```bash
   docker service logs genieai_backend --tail 20 | grep KEYCLOAK_URL
   ```

2. **OIDC discovery unreachable**: The backend reaches Keycloak via the **public URL** through NGINX proxy (not Docker internal URL). Verify the backend container can resolve the public domain:
   ```bash
   docker exec <backend-container> bash -c 'curl -sk https://localhost/auth/realms/genie/.well-known/openid-configuration | head -5'
   ```

3. **TLS certificate errors (self-signed certs)**: In production, `NODE_TLS_REJECT_UNAUTHORIZED` defaults to `1` (strict). For local dev with self-signed NGINX certs, set it to `0` in `.env`:
   ```
   NODE_TLS_REJECT_UNAUTHORIZED=0
   ```

4. **Issuer mismatch**: The token's `iss` claim must match the issuer returned by OIDC discovery. The backend whitelists issuers from discovery — tokens from unknown issuers are rejected with `Unknown issuer`.

5. **Client ID mismatch (azp check)**: Keycloak 26+ sets `aud=account` for access tokens. The backend checks the `azp` claim against `KEYCLOAK_CLIENT_ID` (default: `genie-app`). Mismatch returns `Token audience validation failed`.

### Backend temporarily unavailable after failed discovery

If OIDC discovery fails at startup, the backend enters a 30-second cooldown period. During cooldown, all token verification requests return `Authentication service is temporarily unavailable`. After cooldown expires, discovery is retried automatically. Check logs:
```bash
docker service logs genieai_backend --tail 50 | grep -E "OIDC discovery|KeycloakAuth"
```

### Keycloak container has no curl/wget

Keycloak 26.5.6 minimal image does not include curl or wget. To run commands inside the container, use `kcadm.sh` or bash built-ins:
```bash
# TCP health check (bash built-in)
docker exec <container> bash -c '</dev/tcp/localhost/8080'

# Use kcadm.sh for admin operations
docker exec <container> /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password <pass>
docker exec <container> /opt/keycloak/bin/kcadm.sh get realms
```

### Frontend OIDC: `client_id` error

oidc-client-ts v3.x expects `client_id` (snake_case) in its config, not `clientId` (camelCase). The `OidcClientSettings` interface uses `client_id`, `redirect_uri`, `post_logout_redirect_uri` — all snake_case.

**Symptoms**:
- Console: `PAGE_ERROR: client_id`
- Stack trace points to `chunk-vendors.js` → `new Error("client_id")`
- Frontend stays on `https://localhost/` without redirecting to Keycloak

**Fix**: Use `client_id` in `oidcConfig.js`:
```js
return {
  authority: `${keycloakUrl}/realms/${realm}`,
  client_id: clientId,  // NOT clientId
  redirect_uri: `${origin}/callback`,  // NOT redirectUri
  post_logout_redirect_uri: origin,  // NOT postLogoutRedirectUri
  response_type: 'code',
  // ...
};
```

### Frontend OIDC: `origin` variable used before declaration

In `oidcConfig.js`, if `origin` is used in the Keycloak URL computation but declared after it, JavaScript's `var` hoisting makes it `undefined` at the point of use. The minifier converts `const` to `var`, which hoists the declaration but not the assignment.

**Symptoms**: OIDC discovery URL becomes `http://localhost:8080/realms/genie` (the fallback) instead of `https://localhost/auth/realms/genie`.

**Fix**: Declare `origin` before any other variable that uses it:
```js
function getOidcConfig() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';  // FIRST
  const appConfig = ...;
  const keycloakUrl = (keycloakConfig.url || ... || (origin ? `${origin}/auth` : 'http://localhost:8080'));
  // ...
}
```

### Frontend: CSP blocks Keycloak OIDC requests

The NGINX CSP `connect-src` must include the Keycloak URL. When the frontend is behind NGINX at the same origin, `'self'` covers `https://localhost/auth/...`.

**Symptoms**: Console shows `Connecting to 'http://localhost:8080/...' violates the following Content Security Policy directive`

**Fix**: Ensure the OIDC URL uses the same origin (via `origin + /auth`) so `'self'` covers it. Also add the Keycloak URL to `VUE_APP_CSP_CONNECT_SRC` in `docker-compose.yaml` if using a different origin.

### Frontend: Keycloak redirect URIs must match

The `genie-app` client in Keycloak must have the correct redirect URIs registered. When the frontend is behind NGINX at `https://localhost`, the redirect URI is `https://localhost/callback`.

**Symptoms**: Keycloak returns an error page after successful login, or the frontend shows a broker error.

**Fix**: Update Keycloak client redirect URIs via admin API or `genie-realm.yaml`:
```bash
curl -sk -X PUT "https://localhost/auth/admin/realms/genie/clients/${CLIENT_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"redirectUris": ["https://localhost/*", "http://localhost:8090/*"],
       "webOrigins": ["https://localhost", "http://localhost:8090"]}'
```

Verify the backend's user-provisioning-service is running and the `{iss}#{sub}` composite key is correctly generated from the Keycloak token (not the external IdP token). The composite key uses `{iss}#{sub}` where `sub` is the user's unique identifier from the **genie realm** token issued after broker authentication.

**Important**: Keycloak 26 moved the `sub` claim from a built-in access token claim to a protocol mapper in the `basic` client scope. The `basic` scope must be added to `defaultClientScopes` for every client that needs `sub` in access tokens. This is configured in `config/keycloak/genie-realm.yaml`.

### External IdP broker: "Unexpected error when authenticating with identity provider"

This error occurs during the broker token exchange — after the user authenticates at the external IdP and Keycloak tries to exchange the authorization code for a token and fetch user info.

**Root causes** (check Keycloak server logs for the specific error):

#### 1. `Connect to localhost:443 failed: Connection refused`

Keycloak's internal HTTP client tries to reach `https://localhost` for server-to-server calls (token exchange, user info, JWKS). But inside the Docker container, nothing listens on port 443 — NGINX is on the host.

**Fix**: The identity provider configuration must use **internal URLs** (`http://localhost:8080/...`) for server-to-server endpoints and **public URLs** (`https://localhost/auth/...`) for browser-facing endpoints:

```bash
curl -sk -X PUT "https://localhost/auth/admin/realms/genie/identity-provider/instances/external-idp" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "alias": "external-idp",
    "providerId": "oidc",
    "enabled": true,
    "config": {
      "authorizationUrl": "https://localhost/auth/realms/external-idp/protocol/openid-connect/auth",
      "tokenUrl": "http://localhost:8080/realms/external-idp/protocol/openid-connect/token",
      "userInfoUrl": "http://localhost:8080/realms/external-idp/protocol/openid-connect/userinfo",
      "jwksUrl": "http://localhost:8080/realms/external-idp/protocol/openid-connect/certs",
      "clientId": "genie-broker",
      "clientSecret": "<correct-secret>",
      "useJwksUrl": "true",
      "syncMode": "FORCE",
      "trustEmail": "true"
    }
  }'
```

| Endpoint | URL type | Why |
|----------|----------|-----|
| `authorizationUrl` | Public (`https://localhost/auth/...`) | Browser redirects here — needs to go through NGINX |
| `tokenUrl` | Internal (`http://localhost:8080/...`) | Keycloak server-to-server call — inside container |
| `userInfoUrl` | Internal (`http://localhost:8080/...`) | Keycloak server-to-server call — inside container |
| `jwksUrl` | Internal (`http://localhost:8080/...`) | Keycloak server-to-server call — inside container |

#### 2. `invalid_client_credentials`

The `clientSecret` in the identity provider config doesn't match the broker client's secret in the external IdP realm.

**Fix**: Retrieve the correct secret:
```bash
BROKER_CLIENT_ID=$(curl -sk "https://localhost/auth/admin/realms/external-idp/clients?clientId=genie-broker" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

curl -sk "https://localhost/auth/admin/realms/external-idp/clients/${BROKER_CLIENT_ID}/client-secret" \
  -H "Authorization: Bearer $TOKEN"
```

#### 3. `invalid_redirect_uri`

The `genie-broker` client in the external IdP realm rejects the redirect URI sent by Keycloak. The redirect URI is constructed from the genie realm's frontend URL + `/broker/external-idp/endpoint`.

**Fix**: Add both internal and public broker endpoint URIs to the `genie-broker` client:
```bash
curl -sk -X PUT "https://localhost/auth/admin/realms/external-idp/clients/${BROKER_CLIENT_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "redirectUris": [
      "http://localhost:8080/realms/genie/broker/external-idp/endpoint",
      "https://localhost/auth/realms/genie/broker/external-idp/endpoint"
    ],
    "webOrigins": ["http://localhost:8080", "https://localhost"]
  }'
```
