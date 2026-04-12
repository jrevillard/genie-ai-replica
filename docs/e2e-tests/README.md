# E2E Test Plans

Per-epic E2E test plans for GENIE.AI Keycloak authentication and secure API access.

## Document Index

| Document | Description | Test Phases |
|----------|-------------|-------------|
| [00-clean-start.md](00-clean-start.md) | Common setup: deploy stack, create test user, get tokens | Phase 0 |
| [epic1-keycloak-foundation.md](epic1-keycloak-foundation.md) | Keycloak foundation: login redirect, JIT provisioning, external IdP | Phases A–E |
| [epic2-secure-api-access.md](epic2-secure-api-access.md) | Secure API access: token headers, JWKS refresh, multi-realm, OPEA, error display | Phases F–K |
| [epic3-session-lifecycle-gdpr.md](epic3-session-lifecycle-gdpr.md) | Session management, user lifecycle, GDPR erasure | Phases L–N |

## Prerequisites

- Docker Compose stack deployed and healthy (follow `00-clean-start.md` first)
- Admin access to Keycloak (`KEYCLOAK_ADMIN_PASSWORD` from `.env`)
- Tools: `curl`, `python3`, `jq`, `npx` (Node.js 18+)
- Playwright: run `npm install` at project root, then `npx playwright install chromium`
- Phase F requires `DEPLOY_OPEA=1` (OPEA services must be running for header injection tests)
- Phases G–K work with `DEPLOY_OPEA=0`
- Phase J requires `SERVICE_AUTH_TOKEN` in `.env`
- Phase I requires `KEYCLOAK_ADDITIONAL_REALMS={"genie2":"genie-app"}` in `.env` — additional realms must be created **before** backend starts (Phase 0, Step 0.6)
- Phases L–N require Phase K cleanup completed (K.5 + K.6 executed, stack healthy)

## Conventions

### Test Step Format

Each step follows this format:

```
**X.Y — Description**

```bash
<copy-pasteable command>
```

**Expected**: <what to look for>
```

### Variable Naming

| Variable | Description | Defined in |
|----------|-------------|------------|
| `$TOKEN` | Keycloak master admin token | Phase 0 |
| `$USER_TOKEN` | ROPC token for `testuser` in `genie` realm | Phase 0 |
| `$USER2_TOKEN` | ROPC token for `testuser2` in `genie2` realm | Phase I |
| `$SERVICE_AUTH_TOKEN` | Service-to-service shared secret | `.env` |

### URL Convention

- All URLs use `https://localhost` with self-signed cert
- Keycloak Admin API: `https://localhost/auth/admin/realms/{realm}/...`
- Kong strips `/auth` prefix — always use `/auth/...` via NGINX proxy

## Phase Execution Order

```
Phase 0 (setup) → F (token passthrough) → G (Swagger OAuth2) → H (JWKS refresh) → I (multi-realm) → J (OPEA continuity) → K (auth errors) → L (session management) → M (user lifecycle) → N (GDPR compliance)
```

**Important**: Phase K mutates realm settings and scales Keycloak to 0. Cleanup steps (K.5, K.6) restore state. Verify stack health before proceeding to Phase L.
