#!/bin/bash
# =============================================================================
# deploy.sh — GENIE.AI Post-Compose Setup Script
#
# Run this ONCE after your first `docker compose up -d`:
#   chmod +x deploy.sh && ./deploy.sh
#
# On subsequent deploys (code updates), you only need: docker compose up -d --build
# This script is idempotent — safe to re-run.
# =============================================================================

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
fail() { echo -e "${RED}[deploy] ERROR:${NC} $1"; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[ -f ".env" ]          || fail ".env not found. Run: cp env .env && nano .env"
command -v docker      >/dev/null 2>&1 || fail "Docker not found."
command -v node        >/dev/null 2>&1 || fail "Node.js not found. Install: curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt install -y nodejs"
command -v jq          >/dev/null 2>&1 || { warn "jq not found — installing..."; apt-get install -y jq; }

log "Starting GENIE.AI deployment..."

# ── Step 1: Wait for ArangoDB ─────────────────────────────────────────────────
log "Waiting for ArangoDB to be healthy..."
ARANGO_PORT=$(grep -E '^ARANGO_PORT=' .env | cut -d= -f2 | tr -d '"' || echo 8529)
ARANGO_PASSWORD=$(grep -E '^ARANGO_PASSWORD=' .env | cut -d= -f2 | tr -d '"' || echo "")
MAX_WAIT=120
ELAPSED=0
# Accept both 200 (auth ok) and 401 (arango up, password mismatch) as "running"
until HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${ARANGO_PORT}/_api/version") && [[ "$HTTP_CODE" =~ ^(200|401)$ ]]; do
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        fail "ArangoDB did not become healthy within ${MAX_WAIT}s. Check: docker compose logs arango-vector-db"
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    echo -n "."
done
echo ""
log "ArangoDB is up (HTTP ${HTTP_CODE})."

# ── Step 1b: Enforce root password from .env (idempotent — runs every deploy) ─
log "Enforcing ArangoDB root password from .env..."
if docker exec arango-vector-db arangosh \
    --server.endpoint tcp://127.0.0.1:8529 \
    --server.username root \
    --server.password "${ARANGO_PASSWORD}" \
    --javascript.execute-string "db._version();" > /dev/null 2>&1; then
    log "ArangoDB root password is correct — no change needed."
else
    warn "Password mismatch — resetting root password to match .env..."
    # Try with blank password (default when container was started without ARANGO_ROOT_PASSWORD)
    if docker exec arango-vector-db arangosh \
        --server.endpoint tcp://127.0.0.1:8529 \
        --server.username root \
        --server.password "" \
        --javascript.execute-string "require('@arangodb/users').update('root', '${ARANGO_PASSWORD}');" > /dev/null 2>&1; then
        log "Root password reset successfully from blank."
    else
        fail "Cannot reset ArangoDB root password. Connect manually and run:\n  docker exec arango-vector-db arangosh --server.username root --server.password <current-pw> --javascript.execute-string \"require('@arangodb/users').update('root', '${ARANGO_PASSWORD}');\""
    fi
fi
log "ArangoDB is ready."

# ── Step 2: Wait for Kong ─────────────────────────────────────────────────────
log "Waiting for Kong Admin API to be ready..."
ELAPSED=0
until curl -s http://localhost:8001/status >/dev/null 2>&1; do
    if [ $ELAPSED -ge $MAX_WAIT ]; then
        fail "Kong did not become ready within ${MAX_WAIT}s. Check: docker compose logs kong"
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    echo -n "."
done
echo ""
log "Kong is ready."

# ── Step 3: Bootstrap ArangoDB schema & user accounts ─────────────────────────
log "Running database bootstrap..."
SCRIPTS_DIR="components/gov-chat-backend/scripts/new-schema-scripts"
BACKEND_DIR="components/gov-chat-backend"
if [ ! -d "${BACKEND_DIR}/node_modules" ]; then
    log "Installing backend dependencies (this may take a minute)..."
    npm install --prefix "$BACKEND_DIR" || fail "npm install failed for gov-chat-backend."
fi
node "${SCRIPTS_DIR}/bootstrap.js" || fail "Bootstrap failed. Check ArangoDB connectivity and .env values."
log "Bootstrap complete."

# ── Step 4: Apply Kong configuration ─────────────────────────────────────────
log "Applying Kong API Gateway configuration..."
KONG_CONFIG_DIR="api-gateway-solution/new-config"

# For single-node: backend and document-repository are Docker service names.
# For three-node: set these env vars to the actual hostnames before running.
export KONG_HOST=${KONG_HOST:-localhost}
export KONG_PORT=${KONG_PORT:-8001}
export EXPRESS_API_HOST=${EXPRESS_API_HOST:-backend}
export EXPRESS_API_PORT=${EXPRESS_API_PORT:-3000}
export DOC_REPO_HOST=${DOC_REPO_HOST:-document-repository}
export DOC_REPO_PORT=${DOC_REPO_PORT:-3001}

chmod +x "${KONG_CONFIG_DIR}/manage-kong-config.sh"
(cd "$KONG_CONFIG_DIR" && ./manage-kong-config.sh -a) \
    || fail "Kong configuration failed."
log "Kong configuration applied."

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   GENIE.AI deployment complete! ✅           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "  Web UI:       https://$(hostname -f 2>/dev/null || echo '<your-domain>')"
echo "  Kong Admin:   http://localhost:8001"
echo "  ArangoDB:     http://localhost:${ARANGO_PORT}"
echo ""
warn "⚠  Change the default admin/manager passwords via the Admin Dashboard on first login!"
