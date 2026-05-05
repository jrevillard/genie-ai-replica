## Phase 0: Clean Start

This test plan is designed to run from a clean stack. **Phase 0 is MANDATORY and must be executed in full every time**, even if a stack is already deployed. A running stack with stale images will produce false test failures. Every step (0.1 through 0.9) must be completed — no step may be skipped or shortcut.

**Scope**: These tests only validate the Keycloak authentication flow. The OPEA/AI stack (vLLM, TEI, chat, etc.) is **not needed**. Set `DEPLOY_OPEA=0` to skip GPU-dependent services.

### 0.1 Stop and Remove Existing Stack

```bash
cd /path/to/genie-ai
docker compose down -v
```

This removes all containers, networks, and volumes. No wait loop needed — `docker compose down` is synchronous.

### 0.2 Prepare `.env` File

The project uses a single `.env` file at the project root. Copy the template and set required secrets:

```bash
cp env .env
```

Edit `.env` and set at minimum these values:

```bash
# Required secrets (generate with: python3 -c "import secrets; print(secrets.token_urlsafe(32))")
ARANGO_PASSWORD=arangopwd
TRANSLATION_CACHE_PASSWORD=any-random-string

# PostgreSQL (superuser)
POSTGRES_PASSWORD=postgrespwd

# PostgreSQL dedicated users (must differ from POSTGRES_PASSWORD)
KONG_DB_PASSWORD=kongpwd
KEYCLOAK_DB_PASSWORD=keycloakpwd

# Keycloak admin
KEYCLOAK_ADMIN_PASSWORD=admin

# Keycloak OIDC client secrets
KEYCLOAK_CLIENT_SECRET=any-random-string
KEYCLOAK_PROXY_CLIENT_SECRET=any-random-string

# Dataprep service account (client_credentials grant)
KC_DATAPREP_CLIENT_ID=dataprep-service-client
KC_DATAPREP_CLIENT_SECRET=any-random-string

# NGINX_PUBLIC_DOMAIN — defaults to "localhost" in docker-compose.yaml
# Only set this if deploying to a domain other than localhost
# NGINX_PUBLIC_DOMAIN=localhost

# Required for local dev with self-signed certs
NODE_TLS_REJECT_UNAUTHORIZED=0

# Skip OPEA/AI services (not needed for auth tests, avoids GPU requirement)
DEPLOY_OPEA=0
```

### 0.3 Deploy Stack

```bash
docker compose up -d
```

Images are built automatically via `build:` directives in `docker-compose.yaml` — no manual build or registry needed.

### 0.4 Verify Stack Health

Wait for all services to become healthy. This may take 2-5 minutes depending on image build time.

```bash
# Wait at least 120 seconds for all services to stabilize
# ArangoDB can take up to 150s to pass healthchecks (start_period + retries)
# The backend waits for ArangoDB via its entrypoint script (up to 60s)
echo "Waiting 120 seconds for services to stabilize..."
sleep 120
```

```bash
# Check service status — all should show "running" or "healthy"
docker compose ps

# Detailed per-service check
echo "=== Service Health ==="
docker compose ps --format "table {{.Service}}\t{{.Status}}" | grep -E "frontend|backend|keycloak|arango-vector-db|nginx|kong"
```

**Expected**: All services show `running` or `healthy`.

### 0.5 Verify Individual Services

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
docker exec $(docker ps --filter name=backend --format '{{.ID}}' | head -1) \
  bash -c 'curl -sk -u root:${ARANGO_PASSWORD} http://arango-vector-db:8529/_admin/server/availability' 2>/dev/null | head -1
# Expected: {"error":false,"code":200,"mode":"default"}
```

### 0.6 Create Additional Realms (Phase I Prerequisite)

If `KEYCLOAK_ADDITIONAL_REALMS` is set in `.env`, the corresponding realms **must** exist in Keycloak **before** the backend starts. The backend initializes JWKS for additional realms at startup (see `keycloak-auth-service.js:initAllRealms()`) — realms created after startup are not recognized.

```bash
set -a && source .env && set +a

# Get admin token
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Create additional realms from KEYCLOAK_ADDITIONAL_REALMS env var
# Format: ["realm-name","realm2-name"] (JSON array of realm names)
# Each realm gets a default "genie-app" client for OIDC authentication.
python3 -c "
import json, os, subprocess, sys

raw = os.environ.get('KEYCLOAK_ADDITIONAL_REALMS', '')
if not raw or raw == '[]':
    print('KEYCLOAK_ADDITIONAL_REALMS not set — skipping additional realm setup')
    sys.exit(0)

realms = json.loads(raw)
token = '$TOKEN'
default_client = 'genie-app'

for realm_name in realms:
    # Check if realm already exists
    check = subprocess.run([
        'curl', '-sk', '-f', f'https://localhost/auth/admin/realms/{realm_name}',
        '-H', f'Authorization: Bearer {token}'
    ], capture_output=True, text=True)

    if check.returncode == 0:
        print(f'Realm {realm_name} already exists — skipping creation')
        continue

    # Create realm
    result = subprocess.run([
        'curl', '-sk', '-X', 'POST', 'https://localhost/auth/admin/realms',
        '-H', f'Authorization: Bearer {token}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({
            'realm': realm_name,
            'enabled': True,
            'sslRequired': 'none',
            'roles': {
                'realm': [
                    {'name': 'GENIE.AI_USER', 'description': 'Standard user role'},
                    {'name': 'GENIE.AI_ADMIN', 'description': 'Admin role'}
                ]
            }
        })
    ], capture_output=True, text=True)
    print(f'Realm {realm_name}: {result.stdout.strip()} (HTTP {result.returncode})')

    # Create default OIDC client in the realm
    result = subprocess.run([
        'curl', '-sk', '-X', 'POST',
        f'https://localhost/auth/admin/realms/{realm_name}/clients',
        '-H', f'Authorization: Bearer {token}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({
            'clientId': default_client,
            'enabled': True,
            'publicClient': True,
            'directAccessGrantsEnabled': True,
            'standardFlowEnabled': True,
            'redirectUris': ['https://localhost/*'],
            'webOrigins': ['https://localhost']
        })
    ], capture_output=True, text=True)
    print(f'Client {default_client} in {realm_name}: HTTP {result.returncode}')

print('Additional realms setup complete')
"
```

**Important**: After creating additional realms, the backend must be restarted to pick up the new JWKS endpoints:

```bash
docker compose restart backend

# Reload Kong DNS cache (Kong caches the old backend container IP after restart)
docker exec $(docker ps --filter name=kong --format '{{.ID}}' | head -1) kong reload

echo "Waiting 30 seconds for backend to reinitialize with additional realms..."
sleep 30
curl -sk https://localhost/api/health -o /dev/null -w "Backend: HTTP %{http_code}\n"
# Expected: 200
```

### 0.7 Enable ROPC on genie-app Client (Test Only)

The `genie-app` client uses authorization code flow for the frontend. ROPC (Direct Access Grants) is only needed for API testing via curl and should **not** be enabled in production.

**Note:** On a fresh deploy, `directAccessGrantsEnabled` is always `False` (keycloak-config-cli does not enable it). The PUT command below is **required on every fresh stack**.

Verify and enable for testing:

```bash
set -a && source .env && set +a
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

### 0.8 Create Test User and Verify ROPC Token Retrieval

Create a test user via admin API (no pre-existing user required):

```bash
set -a && source .env && set +a

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
p += '=' * (-len(p) % 4)
claims = json.loads(base64.urlsafe_b64decode(p))
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
set -a && source .env && set +a
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

---

## Prerequisites

- GENIE.AI Docker Compose stack deployed and healthy (Phase 0 complete)
- Admin access to Keycloak (`KEYCLOAK_ADMIN_PASSWORD` from `.env`)
- `@playwright/test` installed (`npm install` at project root, then `npx playwright install chromium`)
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
