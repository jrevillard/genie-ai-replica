# Epic 1 Retrospective: Keycloak Foundation & User Authentication

**Date:** 2026-04-03
**Epic:** Epic 1 — Keycloak Foundation & User Authentication
**Stories:** 1-1 through 1-11 (all completed)
**Worktree:** keycloak-idp

## Overview

Epic 1 successfully replaced the legacy GENIE.AI authentication system (username/password with local JWT) with a Keycloak-based OIDC authentication system. All 11 stories were completed, establishing a solid foundation for secure, standards-based authentication with support for external IdPs and air-gapped deployments.

## Stories Completed

| Story | Title | Status |
|-------|-------|--------|
| 1-1 | Keycloak container with pre-configured realm and OIDC client | done |
| 1-2 | Environment-driven Keycloak configuration via env | done |
| 1-3 | Backend auth middleware (protected and public routes) | done |
| 1-4 | Frontend OIDC service class and Vuex auth module | done |
| 1-5 | Frontend login redirect and auth guard | done |
| 1-6 | JIT user provisioning in ArangoDB | done |
| 1-7 | Transparent re-authentication on session expiry | done |
| 1-8 | Token validation failure handling (backend response format) | done |
| 1-9 | External IdP connection via Keycloak only | done |
| 1-10 | Offline/air-gapped deployment validation | done |
| 1-11 | Remove legacy authentication service | done |

## What Went Well

### Architecture Decisions

1. **Token passthrough architecture** — Backend validates Keycloak JWTs directly via JWKS, eliminating the need for a secondary GENIE.AI JWT layer. This simplified the auth flow and reduced token validation overhead.

2. **Lazy OIDC discovery with retry cooldown** — The 30s retry cooldown in `keycloak-auth-service.js` prevents cascading failures when Keycloak is temporarily unavailable, improving resilience.

3. **Defense-in-depth with Kong** — Kong provides an additional JWT validation layer but is NOT required for the backend to function. This enables future Kong-optional deployments (deferred to Epic 2).

4. **Standardized error response format** — `{ error, message, details }` format established in Story 1-8 provides a clean contract between backend and frontend for all auth-related errors.

5. **JIT provisioning with composite keys** — Using `{iss}#{sub}` as the ArangoDB user key prevents collisions across multiple Keycloak realms/issuers, laying groundwork for multi-realm support (Epic 2).

### Implementation Practices

1. ** jose v6 migration** — Early upgrade to jose v6 (from v5) established the correct API (`createRemoteJWKSet` vs the deprecated `createRemoteJWKS`) before implementation patterns solidified.

2. **Comprehensive test coverage** — 70 backend tests and 87 frontend tests passing at Epic 1 completion. This caught several regressions during Story 1-9 E2E testing.

3. **E2E testing exposed real bugs** — The E2E test plan for Story 1-9 revealed pre-existing issues (realm YAML order, hardcoded URIs, Kong wait loop, auth-routes middleware fix) that were fixed proactively.

4. **Air-gapped validation was documentation-only** — Story 1-10 correctly identified that the architecture was already offline-capable by design. No code changes were needed, only validation and documentation.

5. **Clean legacy removal** — Story 1-11 successfully removed 18 legacy files (5 backend + 13 frontend) and migrated 10+ `req.user` references from the old shape (`{userId, loginName, role}`) to the new Keycloak shape (`{iss_sub, sub, iss, email, name, roles}`).

## What Didn't Go Well

### Story 1-9 (External IdP Connection)

1. **jose v5 → v6 naming confusion** — Initial implementation attempts used `createRemoteJWKS` (v5 API) instead of `createRemoteJWKSet` (v6 API). This caused runtime errors until the correct API was identified.

2. **E2E tests revealed pre-existing bugs** — While ultimately positive, the discovery that multiple components had hardcoded URIs, incorrect YAML ordering, and missing middleware guards was unexpected and delayed Story 1-9 completion.

   **Fix applied:** All bugs were fixed as part of Story 1-9 commit:
   - Realm YAML order fixed
   - Hardcoded `http://localhost:8090` URIs replaced with `${origin}` in frontend
   - Kong wait loop added to prevent race conditions during stack startup
   - Auth-routes middleware fix applied

3. **`AUTH_SERVICE_UNAVAILABLE` error code was forward-looking** — The backend code referenced in Story 1-9 did NOT actually return this error code. The story added it as a forward-looking provision, but this created confusion during Story 2-6 validation (which assumed the code existed).

### Story 1-11 (Legacy Removal)

1. **`req.user` shape mismatch was larger than expected** — Initial analysis found 5-6 references, but grep revealed 10+ route files using the old `req.user.userId` and `req.user.role` pattern. A comprehensive mapping table was created mid-story.

2. **Var vs let TDZ issue with jest.mock** — During test updates, using `let` for mock variables caused `ReferenceError: Cannot access 'X' before initialization` due to jest.mock hoisting and Temporal Dead Zone. This was fixed by using `var` instead, but the error was cryptic.

3. **Factory pattern in auth-routes.js** — The legacy `auth-routes.js` used a factory function that required `auth-service.js` at module load time. This created a circular dependency risk that was only discovered during Story 1-11 analysis. The solution was to remove the factory pattern entirely.

### Testing

1. **Test file location inconsistency** — Frontend tests are in `src/__tests__/` while backend tests are in `__tests__/` (no `src/`). This difference was not documented and caused confusion when creating Story 2-6's test file references.

2. **Mock fixture duplication** — `mockJwtPayload.js` exports several fixtures (`mockExpiredPayload`, `mockWrongAudPayload`, etc.) but not all are used in tests. This suggests some fixtures were created for planned tests that were never implemented.

## Lessons Learned

### For Epic 2 (and Future Epics)

1. **Always verify API version before implementation** — jose v5 vs v6 was a time sink. In Epic 2, double-check all library versions in `package.json` before writing code.

2. **Pre-grep before story sizing** — Story 1-11's `req.user` migration was larger than estimated because initial grep was incomplete. Future stories should run comprehensive greps (`grep -r "req\\.user\\.userId" --include="*.js"`) before task estimation.

3. **Document test file locations and patterns** — The `src/__tests__/` vs `__tests__/` difference should be in `project-context.md` to avoid confusion.

4. **E2E testing is worth the effort** — Story 1-9's E2E tests caught bugs that unit tests missed. Epic 2 should include E2E tests for Kong multi-issuer and health check stories.

5. **Error codes should be implemented before frontend stories** — Story 1-8 defined error codes but not all were actually implemented. This caused Story 2-6 validation issues. Future epics should ensure backend error codes are real before referencing them in frontend stories.

6. **Use `var` for jest.mock variables** — Never use `let` or `const` for variables that will be referenced in `jest.mock()` calls due to hoisting and TDZ. Document this in `project-context.md`.

7. **Forward-looking error codes need clear documentation** — If an error code is planned but not yet implemented, mark it explicitly as "forward-looking" in the story acceptance criteria and task descriptions.

### Process Improvements

1. **Story validation caught critical issues** — The code-reviewer agents caught the JwksCache callable signature issue (Story 2-2) and the `translate()` function assumption (Story 2-6) before implementation. Continue validating stories in fresh contexts.

2. **Worktree strategy is sound** — Using separate worktrees for `epic2-backend` and `epic2-frontend` will allow parallel implementation without merge conflicts. The file overlap analysis was accurate.

3. **Sprint status as single source of truth** — Maintaining `sprint-status.yaml` with worktree assignments and dependency tracking (e.g., "2-9 after 2-2") prevented confusion about story sequencing.

## Action Items for Epic 2

1. **Before starting Epic 2 Round 2:** Review Story 2-2 implementation learnings (especially the JwksCache closure factory pattern) and apply them to Story 2-9 (multi-realm).

2. **Before starting Story 2-6:** Verify that all error codes referenced in the story (`TOKEN_INVALID`, `TOKEN_EXPIRED`, `FORBIDDEN`, `PROVISIONING_FAILED`) actually exist in the backend code at commit time.

3. **Create worktrees from main after Epic 1 merge:** Ensure `epic2-backend` and `epic2-frontend` worktrees are created from a clean main branch after Epic 1 is merged, not from the current `feature/keycloak-idp-integration` branch.

4. **Update `project-context.md`:** Add test file location conventions (`src/__tests__/` vs `__tests__/`) and the `var` vs `let` rule for jest.mock variables.

5. **Run full test suite after each story:** Epic 1 ended with 70+87 tests passing. Epic 2 should maintain this standard — run `npx jest` after each story completion to catch regressions early.

## Open Questions / Risks for Epic 2

1. **JWKS force-refresh timing** — Story 2-2's two-attempt pattern (signature failure → force-refresh → retry) relies on checking `exp` from the unverified payload. If a token has both a rotated key AND is expired, the force-refresh will be skipped. Is this the correct behavior? (Architecture Decision D3 says yes — expired tokens should never trigger refresh.)

2. **Notification before redirect** — Story 2-6 initially planned to show error notifications before redirecting to Keycloak login. This was deemed technically impossible (synchronous navigation). Is this acceptable UX, or should we store the error in sessionStorage and display it after Keycloak callback if login also fails?

3. **Kong optional deployment deferred** — Stories 2-4 and 2-5 were marked deferred as YAGNI. Is this correct, or will deployment teams request this feature during Epic 2? If requested mid-epic, it would disrupt the planned Round 1 → Round 2 sequence.

## Metrics

| Metric | Value |
|--------|-------|
| Total stories | 11 |
| Stories completed on time | 11 (100%) |
| Backend tests passing | 70/70 |
| Frontend tests passing | 87/87 |
| Files added | ~20 |
| Files removed | 18 (legacy cleanup) |
| Files modified | ~30 |
| Critical bugs fixed during E2E | 4 |
| Stories requiring hotfix | 0 |

## Conclusion

Epic 1 established a robust, standards-compliant authentication foundation for GENIE.AI. The Keycloak-based OIDC system with token passthrough, JIT provisioning, and standardized error responses sets the stage for Epic 2's focus on resilient access control and multi-issuer support.

The lessons learned from Epic 1 — especially around API version verification, comprehensive grepping before story sizing, and the value of E2E testing — will directly improve Epic 2's execution efficiency.

**Epic 1 Status:** ✅ COMPLETE
**Next Epic:** Epic 2 — Secure API Access & Resilient Authentication (Round 1: 2-2, 2-6)
