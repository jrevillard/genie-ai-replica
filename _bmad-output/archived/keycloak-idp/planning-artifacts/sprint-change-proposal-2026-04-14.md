# Sprint Change Proposal — Remove Dead http-service & Migrate dataprep to SERVICE_AUTH_TOKEN

**Date**: 2026-04-14
**Trigger**: http-service crashes on startup (missing AUTH_SERVICE_* variables); service is dead since Story 1-11
**Scope**: Minor — Direct implementation by development team
**Classification**: Post-implementation cleanup

## 1. Issue Summary

The `http-service` container crashes on startup with:
```
ValueError: Missing required environment variables: AUTH_SERVICE_URL, AUTH_SERVICE_USERNAME, AUTH_SERVICE_PASSWORD
```

This service was the legacy mechanism for obtaining JWT tokens for service-to-service authentication between OPEA microservices and the backend. It is now **dead code**:

- **Story 1-11** (Remove Legacy Authentication Service) deleted the `/api/auth/login` endpoint that http-service depended on, and removed `jsonwebtoken` dependency
- **Story 2-10** (OPEA Continuity) replaced http-service usage in `chatqna` with `SERVICE_AUTH_TOKEN` shared secret
- The only remaining consumer is `dataprep-arango-service`, which still references `GET_AUTH_TOKEN_URL`

Additionally, the user raised a security concern about `SERVICE_AUTH_TOKEN` being a static shared secret compared to the JWT-based http-service mechanism.

**Security analysis**: SERVICE_AUTH_TOKEN is appropriate for the current context:
- Docker internal network provides first layer of isolation
- Code uses `crypto.timingSafeEqual()` for timing-safe comparison
- Endpoint returns only sanitized, non-sensitive data
- Industry standard for Docker-internal service-to-service auth (K8s ServiceAccount tokens follow the same principle)
- The old http-service was not more secure — it stored credentials in plaintext env vars and ran an additional service (larger attack surface)

**Future improvement**: Keycloak Client Credentials flow (OAuth2 service account) could replace the shared secret for environments requiring token rotation and audit trails. This is not needed for current deployments.

## 2. Impact Analysis

### Epic Impact
- All epics (1-4) are **done**. No epic scope changes required.

### Artifact Conflicts
- **PRD**: FR37 mentions "existing service-to-service JWT" — mechanism no longer exists
- **Architecture**: Decision D4 says `{iss}#{sub}` for OPEA user_id — changed to `_key` in Story 2-10
- **Architecture**: Line 57 says "service-to-service JWT" — replaced by SERVICE_AUTH_TOKEN
- **CLAUDE.md**: References AUTH_SERVICE_USERNAME/PASSWORD as required secrets
- **env**: Contains dead AUTH_SERVICE_USERNAME/PASSWORD variables
- **docker-compose.yaml**: http-service still defined, dataprep still uses GET_AUTH_TOKEN_URL
- **deploy/ansible/deploy.yml**: Build task for http-service, vault validation for auth_service_*
- **deploy/ansible/templates/env.j2**: AUTH_SERVICE_USERNAME/PASSWORD template variables
- **site/content/en/docs/deployment/docker-compose-setup.md**: Lists AUTH_SERVICE_* in required secrets, mentions HTTP Service
- **site/content/en/docs/deployment/docker-swarm-setup.md**: Build/push/tag instructions for http-service
- **README.md**: http-service in directory tree and component list
- **GENIE.AI-Installation-Configuration-Guide.md**: GET_AUTH_TOKEN_URL reference
- **UNICC-ITU-Genie-AI Code Management Process.md**: http-service in tree
- **Tech-specs**: 4 deployment tech-specs reference http-service builds, healthchecks, dependencies
- **genie-ai-overlay/http-service/**: Entire directory is dead code
- **tests/testing_genieai_chatqna.py**: References GET_AUTH_TOKEN_URL

### Technical Impact
- Code: dataprep Python code needs migration to SERVICE_AUTH_TOKEN pattern
- Infrastructure: One fewer container to deploy (simpler stack)
- Deployment: Ansible playbook build list reduced by 1 image (13→12)

## 3. Recommended Approach

**Direct Adjustment** — Modify existing artifacts, no rollback or scope change needed.

- **Effort**: Medium (many files, but each change is simple)
- **Risk**: Low (removing dead code, established pattern already in production for chatqna)

## 4. Detailed Change Proposals

### P1: Remove http-service from docker-compose.yaml
- Delete entire `http-service` service block (lines ~504-529)
- Delete `GET_AUTH_TOKEN_URL` reference in dataprep service (line ~868)

### P2: Migrate dataprep to SERVICE_AUTH_TOKEN
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`: Replace `GET_AUTH_TOKEN_URL` + JWT Bearer auth with `SERVICE_AUTH_TOKEN` + `X-Service-Token` header (same pattern as chatqna)
- `docker-compose.yaml` dataprep service: Replace `GET_AUTH_TOKEN_URL: http://http-service:6666/get-token` with `SERVICE_AUTH_TOKEN: ${SERVICE_AUTH_TOKEN}`

### P3: Remove dead variables and http-service directory
- `env`: Remove AUTH_SERVICE_USERNAME/PASSWORD lines (~4 lines)
- `deploy/ansible/templates/env.j2`: Remove auth_service_username/password template lines
- Delete `genie-ai-overlay/http-service/` directory entirely

### P4: Update OPEA test
- `tests/testing_genieai_chatqna.py`: Replace GET_AUTH_TOKEN_URL with SERVICE_AUTH_TOKEN pattern

### P5: Update PRD
- FR37: "service-to-service JWT" → "shared secret (SERVICE_AUTH_TOKEN / X-Service-Token header)"
- OPEA unchanged description: "service-to-service JWT" → "shared secret (SERVICE_AUTH_TOKEN)"

### P6: Update Architecture
- Line 57: "service-to-service JWT" → "shared secret (SERVICE_AUTH_TOKEN)"
- Decision D4: `{iss}#{sub}` → `_key` (ArangoDB primary key, URL-safe), with note about X-User-Id header

### P7: Update all documentation
- `CLAUDE.md`: Remove AUTH_SERVICE_USERNAME/PASSWORD from secrets list
- `site/content/en/docs/deployment/docker-compose-setup.md`: Remove AUTH_SERVICE_* from secrets, "HTTP Service" → "Keycloak"
- `deploy/ansible/README.md`: Remove auth_service_username/password from vault secrets table, update image count 13→12
- `README.md`: Remove http-service from tree and component list
- `GENIE.AI-Installation-Configuration-Guide.md`: Replace GET_AUTH_TOKEN_URL with SERVICE_AUTH_TOKEN
- `site/content/en/docs/deployment/docker-swarm-setup.md`: Remove http-service build/push/tag instructions
- `UNICC-ITU-Genie-AI Code Management Process.md`: Remove http-service from tree
- `tech-spec-ansible-swarm-deployment.md`: Remove http-service build, update AC18 (6→5 non-OPEA images)
- `tech-spec-docker-swarm-deployment.md`: 9→8 services with build, remove http-service healthcheck/dependencies
- `tech-spec-deployment-regression-plan.md`: Remove AUTH_SERVICE vars, http-service from service list
- `1-10-offline-air-gapped-deployment-validation.md`: Remove geniai-ai-http-service from image list

### P8: Update Ansible playbook
- `deploy/ansible/deploy.yml`: Remove http-service build task block, remove auth_service_username/password vault validation, update error message
- `deploy/ansible/README.md`: Update build tag description (13→12 images)

## 5. Implementation Handoff

**Scope**: Minor — Direct implementation by development team

**Responsibilities**:
| Role | Task |
|------|------|
| Dev | P1-P4: Code changes (docker-compose, dataprep, test, directory deletion) |
| Dev | P5-P6: PRD and Architecture updates |
| Dev | P7-P8: Documentation and Ansible cleanup |

**Success criteria**:
1. `docker compose up -d` starts cleanly with no http-service crash
2. `docker compose ps` shows no http-service container
3. dataprep uses SERVICE_AUTH_TOKEN for backend callbacks (same pattern as chatqna)
4. No references to http-service, AUTH_SERVICE_*, or GET_AUTH_TOKEN_URL remain in active code/docs
5. Ansible playbook builds 12 images (not 13) and validates vault without auth_service_* vars
6. All existing tests pass
