# Server API Testing

## Getting Keycloak Tokens

### Master Admin Token (for Keycloak Admin API only)

```bash
KC_ADMIN_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" <path-to-env> | cut -d= -f2)
ADMIN_TOKEN=$(curl -sk -X POST "<KEYCLOAK_URL>/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_ADMIN_PWD}" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

**Important:** Never use `source .env` — passwords with special characters (`+`, `)`, etc.) break shell expansion. Always extract specific vars with `grep | cut`.

### Realm Token

ROPC (Direct Access Grants) is **disabled by default** for security. To obtain a realm token for testing, you may **temporarily** enable ROPC, but you **MUST revert it immediately after**:

```bash
# 1. Enable ROPC (TEMPORARY — MUST REVERT AFTER TESTING)
CLIENT_ID=$(curl -sk "<KEYCLOAK_URL>/admin/realms/<REALM>/clients?clientId=<CLIENT_ID>" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
curl -sk -X PUT "<KEYCLOAK_URL>/admin/realms/<REALM>/clients/${CLIENT_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"directAccessGrantsEnabled": true}'

# 2. Get realm token
GENIE_TOKEN=$(curl -sk -X POST "<KEYCLOAK_URL>/realms/<REALM>/protocol/openid-connect/token" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "client_id=<CLIENT_ID>" \
  --data-urlencode "username=<user>" \
  --data-urlencode "password=<password>" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 3. REVERT ROPC — NON-NEGOTIABLE
curl -sk -X PUT "<KEYCLOAK_URL>/admin/realms/<REALM>/clients/${CLIENT_ID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"directAccessGrantsEnabled": false}'
```

**WARNING:** Forgetting to revert ROPC is a security vulnerability. Always run the revert command immediately after obtaining the token.

### Test an API Endpoint

```bash
curl -sk -w "\nHTTP %{http_code}" "<PUBLIC_URL>/api/..." \
  -H "Authorization: Bearer $GENIE_TOKEN"
```

## Docker Swarm

```bash
docker service ls                              # List services
docker service logs <service-name> --since 5m # Logs
docker exec <container> curl ...               # Curl from inside the network
```

## Key Pitfalls

- **Master token ≠ realm token** — master token has issuer `.../realms/master`, realm services validate against `.../realms/<REALM>`. Use master token only for Keycloak Admin API calls.
- **Curl from inside Docker**: use `docker exec $(docker ps --format "{{.Names}}" | grep <name> | head -1) curl ...` to test internal network routing.
- **404 with small body (~47 bytes)** from browser = nginx HTML fallback. **404 with JSON body** = application-level 404 (route exists but resource not found).
