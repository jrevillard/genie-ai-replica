## Phase 0: Clean Start

This test plan is designed to run from a clean stack. **Phase 0 is MANDATORY and must be executed in full every time**, even if a stack is already deployed. A running stack with stale images will produce false test failures. Every step (0.1 through 0.9) must be completed — no step may be skipped or shortcut.

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

**CRITICAL**: This step is NOT optional. `docker stack deploy` cannot build images — all images must be pre-built and pushed to a local registry. Skipping this step means running tests against stale code, which produces false failures.

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
# Wait at least 120 seconds for all services to stabilize
# ArangoDB can take up to 150s to pass healthchecks (start_period + retries)
# The backend waits for ArangoDB via its entrypoint script (up to 60s)
echo "Waiting 120 seconds for services to stabilize..."
sleep 120
```

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
