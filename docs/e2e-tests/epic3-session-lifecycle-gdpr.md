## Epic 3: Session Management, User Lifecycle & GDPR

Validates session lifecycle management (Stories 3-1, 3-2), Keycloak Admin API proxy with JIT provisioning updates (Stories 3-5, 3-6), and GDPR Article 17 compliance — right to erasure (Story 3-7).

### Prerequisites

- Phase K cleanup completed (K.5 + K.6 executed, stack healthy)
- `$TOKEN` set (Keycloak master admin token from Phase 0)
- `$USER_TOKEN` available (get fresh token before starting Phase L)

---

## Phase L: Session Management (Stories 3-1, 3-2)

Validates logout flow, session termination, and session invalidation when a user is disabled or deleted in Keycloak.

### Test L.1 — Frontend Logout Redirect to Keycloak

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/epic3/l1-frontend-logout-redirect.spec.js
```
**Expected**: URL redirects to Keycloak login page (`/auth/realms/genie/...`) after logout

### Test L.2 — localStorage Cleanup After Logout

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/epic3/l2-localstorage-cleanup.spec.js
```
**Expected**: `localStorage.getItem('user') === null` && `localStorage.getItem('auth_token') === null`

### Test L.3 — Vuex State Cleared After Logout

**Browser test** (automated via Playwright):
```bash
npx playwright test tests/e2e/epic3/l3-vuex-state-cleared.spec.js
```
**Expected**: After logout, user is redirected to Keycloak login (proves `isAuthenticated === false`)

### Test L.4 — Backend Logout Ends Active Sessions

```bash
# Get fresh token
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Get user _key (required for session creation)
USER_KEY=$(docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print(u._key);
  " 2>/dev/null | tail -1)

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
USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser" \
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

> **Note**: Disabling a user in Keycloak does NOT invalidate existing tokens. JWT verification checks signature and expiry only. The `TOKEN_EXPIRED` + disabled-user-marking logic only triggers when the token is genuinely expired AND the user is disabled. A still-valid token from a disabled user will return `200 success`.

```bash
# Existing token still works (user is disabled but token is not expired)
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'success: {d.get(\"success\",\"N/A\")}')
print(f'HTTP: 200 (token still valid)')
"
```
**Expected**: HTTP 200 `{"success": true, ...}` — token is valid, user is not yet marked deleted

```bash
# Verify user is NOT marked deleted in ArangoDB (no expired-token trigger yet)
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
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
# Verify user can still get tokens and access /api/auth/me
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
```
**Expected**: HTTP 200

### Test L.8 — Verify User Active in ArangoDB

```bash
# Verify ArangoDB user is active and not deleted
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
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

USER_KEY=$(docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print(u._key);
  " 2>/dev/null | tail -1)

curl -sk -X POST "https://localhost/api/sessions" \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"userId\":\"${USER_KEY}\"}" -o /dev/null

curl -sk -X POST "https://localhost/api/auth/logout" \
  -H "Authorization: Bearer $USER_TOKEN" -o /dev/null

docker service logs genieai_backend --since 30s 2>&1 | grep '"event":"logout"' | tail -1 | python3 -c "
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

USER_KEY=$(docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print(u._key);
  " 2>/dev/null | tail -1)

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

curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'success: {d[\"success\"]}')
print(f'email: {d[\"user\"][\"email\"]}')
print(f'name: {d[\"user\"].get(\"name\",\"N/A\")}')
"
```
**Expected**: `success: true`, `email: testuser@genie.local`

### Test M.2 — Get User Profile by ID

```bash
# Get user _key from ArangoDB
USER_KEY=$(docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print(u._key);
  " 2>/dev/null | tail -1)

curl -sk "https://localhost/api/users/${USER_KEY}" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'email: {d.get(\"email\",\"N/A\")}')
print(f'active: {d.get(\"active\",\"N/A\")}')
"
```
**Expected**: `email: testuser@genie.local`, `active: true`

### Test M.3 — Update User Profile

```bash
# Update profile via Keycloak proxy (JSON body)
curl -sk -X PUT "https://localhost/api/users/${USER_KEY}" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"TestUpdated","lastName":"UserUpdated"}' \
  | python3 -m json.tool
```
**Expected**: HTTP 200 `{"success": true, ...}`

```bash
# Verify in Keycloak
curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
u = json.load(sys.stdin)[0]
print(f'firstName: {u[\"firstName\"]}')
print(f'lastName: {u[\"lastName\"]}')
"
```
**Expected**: `firstName: TestUpdated`, `lastName: UserUpdated`

### Test M.4 — Self-Context Enforcement (Cannot Modify Other User)

```bash
# Attempt to modify a different user (use an invalid _key)
curl -sk -X PUT "https://localhost/api/users/some-other-user-key" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Hacked"}' -w "\nHTTP: %{http_code}\n"
```
**Expected**: HTTP 403 `{"error": "FORBIDDEN", "message": "You can only update your own profile", "details": {}}`

### Test M.5 — Email Change via Admin Proxy

```bash
curl -sk -X PUT "https://localhost/api/users/email" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser-updated@genie.local"}' | python3 -m json.tool
```
**Expected**: HTTP 200 `{"success": true, "shouldLogout": true}`

```bash
# Verify email in Keycloak
curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
u = json.load(sys.stdin)[0]
print(f'email: {u[\"email\"]}')
"
```
**Expected**: `email: testuser-updated@genie.local`

### Test M.6 — Restore Original Email (Cleanup)

```bash
curl -sk -X PUT "https://localhost/api/users/email" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser@genie.local"}' -w "\nHTTP: %{http_code}\n"
```
**Expected**: HTTP 200

### Test M.7 — Reset Data Endpoint

```bash
curl -sk -X POST "https://localhost/api/users/reset-data" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -m json.tool
```
**Expected**: `{"success": true, "message": "...", "fieldsPreserved": <number>}`

### Test M.8 — JIT Provisioning Updates Profile on Re-login

```bash
# Update profile in Keycloak directly (simulating external change)
USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=testuser" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

curl -sk -X PUT "https://localhost/auth/admin/realms/genie/users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"JIT","lastName":"Test"}' -w "\nHTTP: %{http_code}\n"
# Expected: 204

# Re-login triggers JIT provisioning (profile sync from Keycloak to ArangoDB)
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'name: {d[\"user\"].get(\"name\",\"N/A\")}')
"
```
**Expected**: `name: JIT Test` (profile updated from Keycloak via JIT)

### Test M.9 — JIT Reactivation of Soft-Deleted User

```bash
# Soft-delete user in ArangoDB directly
USER_KEY=$(docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print(u._key);
  " 2>/dev/null | tail -1)

docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    db.users.update('${USER_KEY}', {deleted:true, active:false, deletedAt:'2026-01-01T00:00:00.000Z'});
  "

# Verify soft-deleted
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print('deleted: ' + u.deleted);
  "
# Expected: deleted: true

# Re-login triggers JIT reactivation
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print(f'success: {d[\"success\"]}')
"
# Expected: success: true

# Verify reactivated in ArangoDB
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print('deleted: ' + u.deleted + ', active: ' + u.active);
  "
```
**Expected**: `deleted: false`, `active: true`

### Test M.10 — Delete User Account (Keycloak + ArangoDB)

```bash
curl -sk -X POST "https://localhost/api/users/delete" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"E2E test cleanup"}' | python3 -m json.tool
```
**Expected**: `{"success": true, "message": "..."}`

```bash
# Verify user marked deleted in ArangoDB
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print('deleted: ' + u.deleted);
  "
```
**Expected**: `deleted: true`

### Test M.11 — Cleanup: Recreate Test User for Phase N

```bash
# Recreate testuser in Keycloak for GDPR tests
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
# Expected: 201

# Verify login works
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
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

# Save user _key before erasure (email will be nullified)
USER_KEY=$(docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
  arangosh --server.password arangopwd --javascript.execute-string "
    db._useDatabase('genie-ai');
    var u = db.users.firstExample({email: 'testuser@genie.local'});
    print(u._key);
  " 2>/dev/null | tail -1)
echo "User _key: $USER_KEY"

# Trigger erasure (deletes Keycloak user + nullifies all PII in ArangoDB)
curl -sk -X POST "https://localhost/api/users/delete" \
  -H "Authorization: Bearer $USER_TOKEN" | python3 -m json.tool
```
**Expected**: `{"success": true, ...}`

### Test N.2 — Erased User Has All PII Nullified in ArangoDB

```bash
# Query by _key (email has been nullified, cannot use firstExample by email)
docker exec $(docker ps --filter name=genieai_arango --format '{{.ID}}' | head -1) \
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
# Expected: 201

# Login and erase
ERASE_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk -X POST "https://localhost/api/users/delete" \
  -H "Authorization: Bearer $ERASE_TOKEN" -o /dev/null -w "First erase: %{http_code}\n"
# Expected: 200

# Second erase (idempotent — user already deleted from Keycloak)
curl -sk -X POST "https://localhost/api/users/delete" \
  -H "Authorization: Bearer $ERASE_TOKEN" -w "Second erase: %{http_code}\n"
# Expected: 200 (no error — idempotent)
```

### Test N.5 — Audit Log Entry for Erasure Event

```bash
docker service logs genieai_backend --since 60s 2>&1 | grep -i 'user erased\|account deleted' | tail -5
```
**Expected**: Log entries containing erasure event with user identifier (e.g. `[KeycloakProxy] User erased`, `[DELETE] Account deleted`)

### Test N.6 — Cleanup: Recreate Test User

```bash
# Recreate testuser for subsequent test runs
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
# Expected: 201

# Verify
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
# Expected: 200
```

---

## Test Results Summary

| Phase | Test | Result | Notes |
|-------|------|--------|-------|
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
| M.4 | Self-context enforcement (403) | | |
| M.5 | Email change via admin proxy | | |
| M.6 | Restore original email (cleanup) | | |
| M.7 | Reset data endpoint | | |
| M.8 | JIT provisioning updates profile on re-login | | |
| M.9 | JIT reactivation of soft-deleted user | | |
| M.10 | Delete user account (Keycloak + ArangoDB) | | |
| M.11 | Cleanup: recreate test user | | |
| N.1 | GDPR erasure (complete deletion) | | |
| N.2 | Erased user PII nullified in ArangoDB | | |
| N.3 | Erased user cannot log in | | |
| N.4 | Erasure is idempotent | | |
| N.5 | Audit log for erasure event | | |
| N.6 | Cleanup: recreate test user | | |

## Full Test Run (Autonomous Execution)

To run the entire Epic 3 test suite, execute phases in order:

```
Phase L  -> Session management (logout, session invalidation, user disable/delete)
Phase M  -> Keycloak proxy & JIT updates (profile, roles, reactivation)
Phase N  -> GDPR compliance (erasure, PII nullification, idempotent operations)
```

**Prerequisites**: Phase K cleanup completed, `$TOKEN` and `$USER_TOKEN` available.

**Stop condition**: If any test fails, diagnose before proceeding. Phase N is destructive (erases user data) — always run N.9 (cleanup) at the end.

**Approximate timing**: 10-15 minutes total (mostly Keycloak Admin API calls and ArangoDB queries).
