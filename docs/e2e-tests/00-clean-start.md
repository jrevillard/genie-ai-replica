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

#### 0.8b Create Test Admin (documents suites prerequisite)

The documents suites (`tests/e2e/documents/`) drive the upload/delete
surfaces, which the document-repository restricts to the `admin` realm role
(`rolePolicy.ADMIN_ONLY`) — a plain user's upload is 403 by design. Create a
second test user carrying that role, via the same helper the specs use
(`tests/e2e/helpers/keycloak-admin.js` — handles the 201/409 tolerance, the
role lookup and the assignment):

```bash
# From the repository root. Needs KEYCLOAK_ADMIN_PASSWORD in the
# environment (set -a && source .env && set +a) and BASE_URL pointing at
# the stack's edge (defaults to https://localhost; the k8s dev cluster is
# https://genieai.local:4443). The helper scripts resolve @playwright/test
# from the root node_modules — run `npm install` at the repository root
# first (see Prerequisites).
node -e "
const { getAdminToken } = require('./tests/e2e/helpers/auth');
const { createUser } = require('./tests/e2e/helpers/keycloak-admin');
(async () => {
  const token = await getAdminToken();
  await createUser(token, 'genie', {
    username: 'testadmin',
    email: 'testadmin@genie.local',
    firstName: 'Test',
    lastName: 'Admin',
    password: 'TestAdmin123!',
    realmRoles: ['admin'],
  });
  console.log('testadmin ready');
})().catch((e) => { console.error(e.message); process.exit(1); });
"
# Expected: testadmin ready (the second run is a no-op — 409 tolerated)
```

**Test admin credentials** (documents suites only):
- Username: `testadmin`
- Password: `TestAdmin123!`

### 0.9 Seed the Knowledge Hierarchy (Quick Help Prerequisite)

A fresh stack has **empty** `serviceCategories`/`services` collections. The
Quick Help specs (e.g. `tests/e2e/chat-conversation.spec.js` — *"the header
title reflects the QuickHelp option that opened the chat"*) fail on an empty
hierarchy: a Quick Help option that names a category is silently refused
when the live hierarchy cannot resolve it, and the conversation header keeps
its fallback `Just Chat`.

Seed both collections from the committed export. (The canonical importer is
`components/gov-chat-backend/scripts/new-schema-scripts/import-service-categories.js`,
which adds validation and an interactive confirm — use it when you can
reach ArangoDB directly from the host. The pipeline below runs **inside**
the backend container, so it also works where ArangoDB has no routed host
port, e.g. the k8s dev cluster.)

```bash
EXPORT=components/gov-chat-backend/scripts/new-schema-scripts/exports/serviceCategoriesAndServices_export_2025-06-18T11-38-02.json
BCK=$(docker ps --filter name=backend --format '{{.ID}}' | head -1)

# The backend image ships node, not curl — push the export in and seed
# from inside the container, with the container's own ARANGO_* env.
docker cp "$EXPORT" "$BCK:/tmp/hierarchy-seed.json"
docker exec $BCK node -e "
const fs = require('fs');
const auth = 'Basic ' + Buffer.from('root:' + process.env.ARANGO_PASSWORD).toString('base64');
const base = (process.env.ARANGO_URL || 'http://arango-vector-db:8529') + '/_db/' + process.env.ARANGO_DB + '/_api';
async function api(path, method, body) {
  const res = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(path + ' -> HTTP ' + res.status + ': ' + JSON.stringify(data).slice(0, 200));
  }
  return data;
}
(async () => {
  const data = JSON.parse(fs.readFileSync('/tmp/hierarchy-seed.json', 'utf8')).data;
  for (const coll of ['serviceCategories', 'services']) {
    const c = await api('/collection/' + coll + '/count');
    if ((c.count || 0) >= data[coll].length) { console.log(coll, 'already complete (' + c.count + ' docs), skipping'); continue; }
    if ((c.count || 0) > 0) console.log(coll, 'partial (' + c.count + '/' + data[coll].length + '), re-seeding');
    // A partial collection re-inserts every doc: the already-present _keys
    // come back as per-document conflicts, the missing ones insert — the
    // re-run converges.
    const created = await api('/document/' + coll + '?type=array', 'POST', data[coll]);
    const conflicts = Array.isArray(created) ? created.filter((d) => d.error).length : 0;
    console.log(coll, 'seeded:', Array.isArray(created) ? created.length - conflicts : JSON.stringify(created), conflicts ? '(' + conflicts + ' already present)' : '');
  }
})().catch((e) => { console.error('SEED FAIL:', e.message); process.exit(1); });
"
```

The script prints what it seeded (`serviceCategories seeded: 13`,
`services seeded: 53`) or `already complete` — that output is the
verification, and a partially-seeded collection (a crash mid-insert)
converges on the next run instead of being skipped as done.

**On the k8s dev cluster** the same script runs inside the backend pod —
the differences are the file transfer (`kubectl -n genieai cp` or
`kubectl -n genieai exec -i ... -- sh -c 'cat > /tmp/hierarchy-seed.json'`
instead of `docker cp`), `kubectl -n genieai exec deploy/<backend-deployment> -- node -e`
instead of `docker exec`, and the env the pod already carries
(`ARANGO_URL=http://arangodb-single...:8529`, `ARANGO_DB` as configured by
the chart).

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
