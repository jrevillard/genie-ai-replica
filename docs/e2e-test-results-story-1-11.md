# E2E Test Results: Story 1-11 (Remove Legacy Authentication Service)

**Date**: 2026-04-03
**Tester**: Claude Code Agent
**Environment**: Docker Swarm (keycloak-idp worktree)
**Stack Status**: Deployed and healthy

## Executive Summary

**RESULT**: ⚠️ **INCOMPLETE** - Story 1-11 code changes are present but NOT deployed

### Critical Findings

1. **Source Code**: ✓ Legacy authentication endpoints (`/login`, `/register`) successfully removed from `auth-routes.js`
2. **Deployed Stack**: ✗ Still running OLD backend image with legacy endpoints ACTIVE
3. **Unit Tests**: ✓ All passing (70/70 backend, 87/87 frontend)
4. **E2E Tests**: ⚠️ Cannot complete until new image is built and deployed

### Recommendation

**DO NOT MARK STORY AS "DONE"** - The legacy authentication service is still active in production. A rebuild and redeployment of the backend service is required.

---

## Test Environment

### Stack Health
```bash
# Critical services status (all 1/1):
- genieai_arango-vector-db: 1/1 ✓
- genieai_backend: 1/1 ✓
- genieai_frontend: 1/1 ✓
- genieai_keycloak: 1/1 ✓
- genieai_nginx: 1/1 ✓
```

### Image Age Analysis
- **Current backend image**: Created 16 hours ago (2026-04-03T04:42:19Z)
- **Image size**: localhost:5000/genie-ai-backend:latest (2.58GB)
- **Source code changes**: Uncommitted in worktree (modified auth-routes.js)

### Code Status
- **HEAD (committed)**: Still contains legacy `/login` and `/register` endpoints (510 lines)
- **Working directory (uncommitted)**: Legacy endpoints removed, only `/me` and `/logout` remain (61 lines)
- **Removed files**: auth-service.js, auth-middleware.js, legacy frontend components

---

## E2E Test Results

### Phase B: JIT User Provisioning

#### Test B.1 - First Login Creates User in ArangoDB ✓
```bash
# Request
TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=genie-app" -d "username=testuser" -d "password=TestPass123!" -d "grant_type=password")
curl -sk "https://localhost/api/auth/me" -H "Authorization: Bearer $TOKEN"

# Response
HTTP: 200 OK
{
  "success": true,
  "user": {
    "iss_sub": "https://localhost/auth/realms/genie#fd8e2c86-a184-4d53-8845-8d0c7ab67fa3",
    "iss": "https://localhost/auth/realms/genie",
    "sub": "fd8e2c86-a184-4d53-8845-8d0c7ab67fa3",
    "email": "testuser@genie.local",
    "name": "Test User",
    "roles": ["offline_access", "default-roles-genie", "uma_authorization"],
    "active": true,
    "deleted": false,
    "createdAt": "2026-04-03T04:47:24.871Z",
    "updatedAt": "2026-04-03T10:14:35.728Z"
  }
}
```
**Result**: PASS ✓ - JIT provisioning working correctly

#### Test B.2 - ArangoDB Document Verification ✓
```bash
# ArangoDB query
db._useDatabase('genie-ai');
db.users.toArray()

# Response
[{
  "_key": "683",
  "iss_sub": "https://localhost/auth/realms/genie#fd8e2c86-a184-4d53-8845-8d0c7ab67fa3",
  "email": "testuser@genie.local",
  "active": true,
  "deleted": false,
  "sub": "fd8e2c86-a184-4d53-8845-8d0c7ab67fa3"
}]
```
**Result**: PASS ✓ - User correctly stored with all required fields

---

### Phase 1-11 Specific: Legacy Endpoint Removal

#### Test 1-11.1 - Legacy `/api/auth/login` Should Return 404 ✗

**Expected**: HTTP 404 Not Found
**Actual**: HTTP 401 Unauthorized

```bash
# Request
curl -sk "https://localhost/api/auth/login" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"loginName":"test","encPassword":"test"}'

# Response
HTTP: 401 Unauthorized
{
  "success": false,
  "message": "Invalid credentials"
}
```

**Analysis**:
- Legacy `/api/auth/login` endpoint is STILL ACTIVE
- Backend logs show: "Login attempt for loginName: test"
- Backend logs show: "Processing user login"
- This confirms the old authentication service is handling the request

**Result**: FAIL ✗ - Endpoint still exists and processes requests

#### Test 1-11.2 - Legacy `/api/auth/register` Should Return 404 ✗

**Expected**: HTTP 404 Not Found
**Actual**: HTTP 201 Created

```bash
# Request
curl -sk "https://localhost/api/auth/register" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"loginName":"newuser","email":"new@user.com","encPassword":"password"}'

# Response
HTTP: 201 Created
{
  "success": true,
  "message": "Registration successful. Please check your email to verify your account."
}
```

**Analysis**:
- Legacy `/api/auth/register` endpoint is STILL ACTIVE
- Backend logs show: "Register request for loginName: newuser, email: new@user.com"
- Backend logs show: "Processing user registration"
- **CRITICAL**: Users can still register via the legacy API!

**Result**: FAIL ✗ - Endpoint still exists and successfully creates users

#### Test 1-11.3 - Verify auth-routes.js in Deployed Container ✗

**Expected**: Only `/me` and `/logout` routes (61 lines)
**Actual**: Contains legacy `/login`, `/register`, etc. (16,117 lines)

```bash
# Deployed container
docker exec genieai_backend.1.drfnucpcfg5ycvkpthgeultis wc -l /app/routes/auth-routes.js
# Output: 16117 /app/routes/auth-routes.js

# Local source (uncommitted)
wc -l components/gov-chat-backend/routes/auth-routes.js
# Output: 61 components/gov-chat-backend/routes/auth-routes.js
```

**Result**: FAIL ✗ - Deployed image has outdated code

---

## Root Cause Analysis

### Why Legacy Endpoints Are Still Active

1. **Code Changes Are Uncommitted**
   - The worktree has uncommitted changes that remove legacy endpoints
   - These changes include:
     - Removed: `auth-service.js` (legacy authentication service)
     - Removed: `auth-middleware.js` (legacy JWT middleware)
     - Modified: `auth-routes.js` (removed `/login`, `/register` routes)
     - Removed: Legacy frontend components (LoginScreen, RegisterScreen, etc.)

2. **Deployed Image Is Outdated**
   - Backend image was built 16 hours ago (before Story 1-11 changes)
   - Image SHA: 87e950565b1d
   - The image still contains the old authentication service

3. **Git Status**
   ```
   Branch: feature/keycloak-idp-integration
   Status: 3 commits ahead of origin
   Modified files (not staged):
     - components/gov-chat-backend/routes/auth-routes.js
     - components/gov-chat-backend/services/auth-service.js (deleted)
     - components/gov-chat-backend/middleware/auth-middleware.js (deleted)
     - ... (30+ files modified/deleted)
   ```

---

## Security Implications

### CRITICAL: Legacy Registration Still Works

The fact that `/api/auth/register` returns 201 and successfully creates users represents a **significant security vulnerability**:

1. **Dual Authentication Paths**
   - Users can register via legacy API (creates user in ArangoDB)
   - Users can authenticate via Keycloak (creates user via JIT provisioning)
   - This creates two separate user populations

2. **Bypass Keycloak**
   - Legacy registration bypasses Keycloak entirely
   - No email verification through Keycloak
   - No centralized user management

3. **Data Inconsistency**
   - Legacy users may not have proper `iss_sub` format
   - Keycloak users have `iss_sub` like "https://localhost/auth/realms/genie#<sub>"
   - Legacy users may have different format

4. **Migration Risk**
   - If legacy users exist, they won't be able to login via Keycloak
   - No password sync between legacy and Keycloak

---

## Required Actions

### Immediate Actions Required

1. **Commit Story 1-11 Changes**
   ```bash
   cd /home/jerome/git_projects/ITU/genie-ai/.worktrees/keycloak-idp
   git add components/gov-chat-backend/routes/auth-routes.js
   git add components/gov-chat-backend/services/auth-service.js
   git add components/gov-chat-backend/middleware/auth-middleware.js
   git add components/gov-chat-frontend/src/components/LoginScreen.vue
   git add components/gov-chat-frontend/src/components/RegisterScreen.vue
   # ... add all other deleted/modified files
   git commit -m "feat: Remove legacy authentication service (Story 1-11)"
   ```

2. **Rebuild Backend Image**
   ```bash
   docker build -f components/gov-chat-backend/Dockerfile \
     -t genieai_mvp_backend:latest components/
   docker tag genieai_mvp_backend:latest \
     localhost:5000/genie-ai-backend:latest
   docker push localhost:5000/genie-ai-backend:latest
   ```

3. **Redeploy Backend Service**
   ```bash
   docker service update --force genieai_backend
   # Wait for service to restart (30-60 seconds)
   docker service ls --filter name=genieai_backend
   ```

4. **Re-run E2E Tests**
   - Verify `/api/auth/login` returns 404
   - Verify `/api/auth/register` returns 404
   - Verify `/api/auth/me` still works (Keycloak auth)
   - Verify frontend redirects to Keycloak

---

## Test Coverage Summary

| Test Phase | Test Case | Expected | Actual | Status |
|------------|-----------|----------|--------|--------|
| Phase B | B.1 - JIT User Provisioning | 200 + user profile | 200 + user profile | ✓ PASS |
| Phase B | B.2 - ArangoDB Document | User with iss_sub | User with iss_sub | ✓ PASS |
| Story 1-11 | 1-11.1 - Legacy /login endpoint | 404 Not Found | 401 Unauthorized | ✗ FAIL |
| Story 1-11 | 1-11.2 - Legacy /register endpoint | 404 Not Found | 201 Created | ✗ FAIL |
| Story 1-11 | 1-11.3 - Deployed code version | 61 lines (clean) | 16,117 lines (legacy) | ✗ FAIL |

**Pass Rate**: 2/5 (40%)
**Note**: 3 failures are due to outdated deployed image, not code issues

---

## Recommendations

### For Story 1-11 Completion

1. **DO NOT mark story as "done"** - Legacy authentication is still active
2. **Commit and deploy** the uncommitted changes
3. **Verify** legacy endpoints return 404 after deployment
4. **Check** for existing legacy users in ArangoDB (may need migration)

### For Testing Process

1. **Automate image rebuild** in CI/CD pipeline
2. **Add pre-deployment check** to verify image age
3. **Add E2E test** for legacy endpoint removal
4. **Document** the migration path for any existing legacy users

---

## Conclusion

Story 1-11 code changes are **complete and correct** based on unit tests and code review, but the story **cannot be marked as "done"** until:

1. ✓ Code changes are committed
2. ✓ Backend image is rebuilt with new code
3. ✓ Backend service is redeployed
4. ✓ E2E tests confirm legacy endpoints return 404
5. ✓ Keycloak authentication still works

**Current Status**: Story 1-11 is **IN PROGRESS** - deployment step required

**Next Steps**: Commit changes → Rebuild image → Redeploy → Re-run E2E tests → Mark as done
