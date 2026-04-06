# Keycloak Admin Operations Guide

This guide explains how to manage users, roles, and groups for GENIE.AI entirely through the Keycloak admin console. No GENIE.AI-specific interface is needed for user management.

## Overview

GENIE.AI delegates all identity management to Keycloak. When an administrator creates, modifies, disables, or deletes a user in Keycloak, the changes take effect in GENIE.AI on the user's next authentication. Roles assigned in Keycloak are reflected in the JWT claims and propagated to all GENIE.AI services.

## 1. Accessing the Keycloak Admin Console

### URL

The Keycloak admin console is available at:

```
https://<NGINX_PUBLIC_DOMAIN>/auth/admin
```

| Deployment | URL |
|---|---|
| Localhost (dev) | `https://localhost/auth/admin` |
| Domain | `https://gateway.example.com/auth/admin` |

### Login Credentials

| Field | Value |
|---|---|
| Username | `admin` |
| Password | Value of `KEYCLOAK_ADMIN_PASSWORD` from `.env` |

### Selecting the Realm

After logging in, select the **genie** realm from the top-left dropdown (not `master`). All GENIE.AI users and roles live in the `genie` realm.

## 2. User CRUD Operations

### 2.1 Create a User

1. Navigate to **Users** in the left menu
2. Click **Add user**
3. Fill in the required fields:
   - **Username** (required, unique)
   - **Email** (recommended)
   - **First Name**, **Last Name** (recommended)
   - **Enabled** = On
4. Click **Create**
5. Go to the **Credentials** tab for the new user
6. Click **Set password**
   - Enter the password
   - Set **Temporary** = Off (otherwise the user must change it on first login)
7. Click **Save**
8. Go to the **Role Mapping** tab
9. Assign the `user` role (see Section 3)

The user record is created in Keycloak. The user will be provisioned in ArangoDB on their first login to GENIE.AI.

### 2.2 Modify a User

1. Navigate to **Users** and click on the user
2. Edit fields on the **Attributes**, **Email**, or other tabs
3. Click **Save**

Changes to user attributes (email, name) are reflected in ArangoDB on the user's next login via JIT provisioning.

### 2.3 Disable a User

1. Navigate to **Users** and click on the user
2. Toggle **Enabled** to **Off**
3. Click **Save**

A disabled user cannot obtain new tokens from Keycloak. Existing tokens remain valid until they expire. Once expired, the user is effectively locked out of GENIE.AI.

### 2.4 Delete a User

1. Navigate to **Users** and click on the user
2. Click **Delete** (trash icon)
3. Confirm the deletion

The user is permanently removed from Keycloak. Their ArangoDB record remains but will no longer be updated (no more JWTs issued for this user). To fully remove the user's data from GENIE.AI, see Story 3.6 (Right to Erasure).

## 3. Role Assignment

### 3.1 Available Realm Roles

| Role | Description | Effect in GENIE.AI |
|---|---|---|
| `admin` | Administrator | Full access to all admin API endpoints |
| `user` | Standard user | Access to standard user features |

These roles are defined in `config/keycloak/genie-realm.yaml` and applied automatically during Keycloak initialization.

### 3.2 Assign Roles via Admin Console

1. Navigate to **Users** and click on the user
2. Go to the **Role Mapping** tab
3. Click **Assign role**
4. Select the role(s) to assign (`admin`, `user`, or both)
5. Click **Assign**

### 3.3 Remove Roles via Admin Console

1. Navigate to **Users** and click on the user
2. Go to the **Role Mapping** tab
3. Find the role to remove in the **Assigned Roles** list
4. Click the **X** next to the role
5. Confirm the removal

### 3.4 Role Propagation Flow

When a user logs in after a role change:

```
1. Keycloak issues JWT with updated roles
   └── payload.realm_access.roles = ["admin", "user"]

2. Backend middleware extracts roles from JWT
   └── keycloak-auth-middleware.js:70 → claims.realm_access.roles

3. JIT provisioning updates ArangoDB
   └── user-provisioning-service.js:49 → roles field in UPSERT

4. Roles propagated to downstream services
   └── X-User-Roles: "admin,user" header
   └── X-User-Id: "{iss}#{sub}" header
   └── X-Issuer: "{iss}" header
```

**Important**: Role changes only take effect on the user's next login (or token refresh). Active sessions continue using the previously-issued JWT until it expires.

## 4. Group Management

### 4.1 Groups vs Roles

Keycloak supports both **realm roles** and **groups**:

| Feature | Realm Roles | Groups |
|---|---|---|
| Purpose | Authorization (access control) | Organization (user grouping) |
| Consumed by GENIE.AI | Yes (JWT `realm_access.roles`) | No |
| Propagated to ArangoDB | Yes (stored in `roles` field) | No |
| Propagated via headers | Yes (`X-User-Roles`) | No |

Currently, only realm roles are consumed by GENIE.AI. Groups are useful for organizing users within Keycloak but are not propagated to GENIE.AI services.

### 4.2 Create a Group

1. Navigate to **Groups** in the left menu
2. Click **Create group**
3. Enter a name (e.g., `department-finance`)
4. Click **Create**

### 4.3 Assign Users to a Group

1. Navigate to **Groups** and click on the group
2. Go to the **Members** tab
3. Click **Add member**
4. Search for and select the user(s)
5. Click **Add**

### 4.4 Future: Propagating Groups to GENIE.AI

If groups need to be propagated to GENIE.AI in the future, a Keycloak **protocol mapper** can be configured to include group information in the JWT. This is not required for the current release and is deferred to a future story.

## 5. Data Flow: Keycloak to GENIE.AI

This section documents the complete data flow from a Keycloak admin action to its effect in GENIE.AI.

### 5.0 Administrator Workflow (End-to-End)

The following diagram shows the complete journey from an admin action in Keycloak to its effect in GENIE.AI:

```mermaid
sequenceDiagram
    actor A as Functional Admin<br/>(Chen)
    participant KC as Keycloak<br/>Admin Console
    participant KCDB[("Keycloak DB<br/>(PostgreSQL)")]
    participant B as GENIE.AI Backend<br/>(Auth Middleware)
    participant ADB[("ArangoDB<br/>(users collection)")]
    actor U as End User

    Note over A,KC: 1. Admin manages user in Keycloak
    A->>KC: Create / Modify / Disable user
    A->>KC: Assign / Remove roles
    KC->>KCDB: Persist changes

    Note over U,B: 2. User authenticates (next login)
    U->>KC: Login (username + password)
    KC->>KCDB: Validate credentials
    KC-->>U: JWT (with realm_access.roles)

    Note over B,ADB: 3. GENIE.AI processes the token
    U->>B: API request (Bearer token)
    B->>B: Verify JWT signature (JWKS)
    B->>B: Extract roles from realm_access.roles
    B->>ADB: JIT UPSERT (roles, email, name)
    ADB-->>B: User document
    B->>B: Set X-User-Roles, X-User-Id, X-Issuer headers
    B-->>U: 200 OK (authenticated)
```

For the complete system architecture diagrams (C4 Context, C4 Container, OIDC sequence, JWKS validation), see [Keycloak IdP Integration Diagrams](_bmad-output/planning-artifacts/keycloak-idp-integration-diagrams.md).

### 5.1 User Creation Flow

```
Admin creates user in Keycloak
  → User record stored in Keycloak (PostgreSQL)
  → No immediate effect in GENIE.AI
  → User logs in for the first time
    → Keycloak issues JWT
    → Backend validates JWT (JWKS)
    → JIT provisioning creates user in ArangoDB (atomic UPSERT)
    → User can access GENIE.AI
```

### 5.2 Role Change Flow

```
Admin assigns role in Keycloak
  → Role stored in Keycloak
  → User's existing JWT still has old roles (until expiry)
  → User logs in again (or refreshes token)
    → New JWT includes updated roles in realm_access.roles
    → Backend extracts roles from JWT
    → JIT provisioning updates roles in ArangoDB
    → X-User-Roles header reflects new roles
```

### 5.3 User Disable Flow

```
Admin disables user in Keycloak
  → Keycloak rejects new token requests for this user
  → Existing tokens remain valid until expiry
  → Once token expires, user is locked out
  → ArangoDB record persists (not automatically deleted)
```

### 5.4 Key Source Files

| Capability | File | Line |
|---|---|---|
| Role extraction from JWT | `middleware/keycloak-auth-middleware.js` | 70 |
| X-User-Roles header | `middleware/keycloak-auth-middleware.js` | 73 |
| ArangoDB role persistence | `services/user-provisioning-service.js` | 49 |
| Role-based access control | `middleware/keycloak-auth-middleware.js` | 174 |
| User provisioning on login | `services/user-provisioning-service.js` | 63 |
| Realm roles definition | `config/keycloak/genie-realm.yaml` | 8-12 |
| Default admin user | `config/keycloak/genie-realm.yaml` | 15-27 |

## 6. Verification with curl Commands

These commands use the E2E test infrastructure documented in `docs/e2e-tests/README.md`. Ensure Phase 0 (clean start) is complete before running these commands.

### 6.1 Prerequisites

```bash
# Load environment
source .env

# Get admin token
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

### 6.2 Create a User via Admin API

```bash
# Create a new user
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "verify-user",
    "enabled": true,
    "email": "verify-user@genie.local",
    "firstName": "Verify",
    "lastName": "User",
    "credentials": [{"type": "password", "value": "VerifyPass123!", "temporary": false}]
  }' -w "\nHTTP: %{http_code}\n"
# Expected: HTTP: 201
```

### 6.3 Assign Role via Admin API

```bash
# Get the user ID
USER_ID=$(curl -sk "https://localhost/auth/admin/realms/genie/users?username=verify-user" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Get the role representation for 'admin'
ADMIN_ROLE=$(curl -sk "https://localhost/auth/admin/realms/genie/roles/admin" \
  -H "Authorization: Bearer $TOKEN")

# Assign the admin role
curl -sk -X POST "https://localhost/auth/admin/realms/genie/users/${USER_ID}/role-mappings/realm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$ADMIN_ROLE" -w "\nHTTP: %{http_code}\n"
# Expected: HTTP: 204
```

### 6.4 Verify Roles in JWT

```bash
# Authenticate as the user to get a new JWT
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=verify-user" -d "password=VerifyPass123!" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Decode and verify realm_access.roles
echo "$USER_TOKEN" | cut -d. -f2 | python3 -c "
import sys, base64, json
p = sys.stdin.read()
claims = json.loads(base64.urlsafe_b64decode(p + (4 - len(p) % 4) % 4 * '='))
roles = claims.get('realm_access', {}).get('roles', [])
print(f'Roles in JWT: {roles}')
assert 'admin' in roles, 'FAIL: admin role not found in JWT'
assert 'user' in roles, 'FAIL: user role not found in JWT'
print('PASS: Both admin and user roles present in JWT')
"
# Expected: Roles in JWT: ['admin', 'user']
# Expected: PASS: Both admin and user roles present in JWT
```

### 6.5 Verify Role Propagation via Backend

```bash
# Call a protected endpoint with the user token
# The backend logs will show JIT provisioning with the updated roles
curl -sk https://localhost/api/health \
  -H "Authorization: Bearer $USER_TOKEN" -o /dev/null -w "HTTP: %{http_code}\n"
# Expected: HTTP: 200

# Check backend logs for provisioning confirmation
docker service logs genieai_backend --tail 10 2>&1 | grep -i "provision"
# Expected: [UserProvisioning] User profile updated: <iss_sub>
```

### 6.6 Remove Role and Verify

```bash
# Extract and remove the admin role (fully automated — no manual ID copy)
curl -sk "https://localhost/auth/admin/realms/genie/users/${USER_ID}/role-mappings/realm" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json, subprocess, os
roles = json.load(sys.stdin)
admin_role = [r for r in roles if r['name'] == 'admin']
if not admin_role:
    print('admin role not assigned — nothing to remove')
    sys.exit(0)
role_json = json.dumps(admin_role[0])
user_id = os.environ.get('USER_ID', '')
token = os.environ.get('TOKEN', '')
result = subprocess.run([
    'curl', '-sk', '-X', 'DELETE',
    f'https://localhost/auth/admin/realms/genie/users/{user_id}/role-mappings/realm',
    '-H', f'Authorization: Bearer {token}',
    '-H', 'Content-Type: application/json',
    '-d', role_json
], capture_output=True, text=True)
print(f'HTTP: {result.returncode}')
" -w "\nHTTP: %{http_code}\n"
# Expected: HTTP: 204

# Re-authenticate and verify the role is gone
USER_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=verify-user" -d "password=VerifyPass123!" \
  -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "$USER_TOKEN" | cut -d. -f2 | python3 -c "
import sys, base64, json
p = sys.stdin.read()
claims = json.loads(base64.urlsafe_b64decode(p + (4 - len(p) % 4) % 4 * '='))
roles = claims.get('realm_access', {}).get('roles', [])
print(f'Roles in JWT: {roles}')
assert 'admin' not in roles, 'FAIL: admin role still present'
assert 'user' in roles, 'FAIL: user role missing'
print('PASS: admin removed, user role retained')
"
# Expected: Roles in JWT: ['user']
# Expected: PASS: admin removed, user role retained
```

### 6.7 Disable User and Verify

```bash
# Disable the user
curl -sk -X PUT "https://localhost/auth/admin/realms/genie/users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' -w "\nHTTP: %{http_code}\n"
# Expected: HTTP: 204

# Attempt to authenticate — should fail
curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=verify-user" -d "password=VerifyPass123!" \
  -d "grant_type=password" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
assert 'error' in resp, 'FAIL: disabled user was able to authenticate'
print(f'PASS: {resp[\"error\"]} - {resp.get(\"error_description\", \"\")}')
"
# Expected: PASS: invalid_grant - Account is disabled
```

### 6.8 Cleanup

```bash
# Delete the test user
curl -sk -X DELETE "https://localhost/auth/admin/realms/genie/users/${USER_ID}" \
  -H "Authorization: Bearer $TOKEN" -w "HTTP: %{http_code}\n"
# Expected: HTTP: 204
```

## 7. Security Considerations

### 7.1 Admin Password

The admin password is set via `KEYCLOAK_ADMIN_PASSWORD` in `.env`. This value is:
- **Never committed to git** (`.env` is gitignored)
- Used for both the Keycloak bootstrap admin and the keycloak-config-cli service
- Must be a strong password in production (minimum 16 characters recommended)

### 7.2 Session Timeout

Keycloak sessions have configurable timeouts. The defaults are suitable for most deployments:
- **SSO Session Max** (default: 10 hours) — maximum duration of a session
- **SSO Session Idle** (default: 30 minutes) — session expires after inactivity
- **Access Token Lifespan** (default: 5 minutes) — JWT validity duration

These can be adjusted in the Keycloak admin console under **Realm Settings > Tokens**.

### 7.3 Audit Trail

Keycloak does not natively provide detailed audit logging. For production deployments requiring audit trails:
- Enable Keycloak event logging: **Realm Settings > Events > Save Events = On**
- Keycloak logs events to its server log (visible via `docker service logs genieai_keycloak`)
- For persistent audit storage, consider the Keycloak Event Listener SPI with a custom database sink

### 7.4 Network Security

- The Keycloak admin console is exposed through NGINX (TLS termination)
- In production, restrict admin console access via network policies or IP allowlisting at the NGINX level
- Keycloak internal traffic (backend to Keycloak) goes through NGINX proxy
- Consider restricting `/auth/admin` path access to trusted IP ranges in NGINX configuration

### 7.5 API-Based Administration

The Keycloak Admin REST API supports all operations described in this guide. When using the API:
- Always use HTTPS (never expose the admin API over plain HTTP)
- Use short-lived admin tokens (they expire with the SSO session)
- The `admin-cli` client has no client secret — authentication requires username/password
- Consider creating a service account with restricted permissions for automated administration tasks
