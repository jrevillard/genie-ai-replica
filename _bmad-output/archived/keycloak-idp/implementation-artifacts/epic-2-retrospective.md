# Epic 2 Retrospective: Secure API Access & Resilient Authentication

**Date:** 2026-04-03
**Epic:** Epic 2 — Secure API Access & Resilient Authentication
**Stories:** 2-2, 2-3, 2-6, 2-8, 2-9, 2-10 (completed); 2-4, 2-5, 2-7 (deferred)
**Worktrees:** epic2-backend, epic2-frontend

## Overview

Epic 2 successfully enhanced the GENIE.AI authentication system with resilient API access controls, multi-realm support, and improved developer experience. 6 stories were completed across 2 parallel worktrees, with 3 stories deferred as YAGNI. All 123 backend tests and 129 frontend tests pass.

## Stories Completed

| Story | Title | Worktree | Status |
|-------|-------|----------|--------|
| 2-2 | JWKS force-refresh on validation failure | epic2-backend | done |
| 2-3 | Token passthrough headers injection | epic2-backend | done |
| 2-6 | Auth & authorization error display | epic2-frontend | done |
| 2-8 | Swagger UI with Keycloak OIDC | epic2-frontend | done |
| 2-9 | Multi-realm configuration support | epic2-backend | done |
| 2-10 | OPEA continuity (Keycloak-agnostic) | epic2-backend | done |

## Stories Deferred

| Story | Title | Reason |
|-------|-------|--------|
| 2-4 | Kong optional deployment | YAGNI — Kong optional deployment not requested |
| 2-5 | Kong multi-issuer token validation | Depends on 2-4 |
| 2-7 | Keycloak unavailable detection (health check) | YAGNI — Keycloak has native health checks, backend already handles unavailability |

## What Went Well

### Architecture Decisions

1. **Parallel worktree strategy** — `epic2-backend` and `epic2-frontend` worktrees enabled simultaneous development without merge conflicts. File overlap analysis was accurate.

2. **JWKS force-refresh two-attempt pattern** — Story 2-2's closure-based factory (`createJwksCache`) correctly implements jose v6's callable signature (`jwks(protectedHeader, token)`) while adding TTL and force-refresh methods. The pattern handles key rotation without user disruption.

3. **Service shared secret for OPEA callback** — Story 2-10 correctly chose a shared secret (`SERVICE_AUTH_TOKEN`) over resurrecting the dead http-service JWT pipeline. This is simpler, has less attack surface, and aligns with industry standards for Docker-internal service-to-service auth.

4. **Multi-realm via JSON map env var** — Story 2-9 deviated from comma-separated lists to a single `KEYCLOAK_ADDITIONAL_REALMS={"realm":"client-id"}` JSON map. This eliminated ordering mismatch risk and simplified configuration.

5. **Timing-safe token comparison** — Story 2-10 used `crypto.timingSafeEqual()` for `SERVICE_AUTH_TOKEN` validation (with length check), providing defense-in-depth against timing attacks.

6. **Swagger UI PKCE compliance** — Story 2-8 correctly implemented Authorization Code flow with PKCE (`usePkceWithAuthorizationCodeGrant: true`), complying with NFR1 ("authorization code flow without PKCE is prohibited").

### Implementation Practices

1. **Comprehensive test coverage** — Epic 2 ended with 123 backend tests and 129 frontend tests passing. Regression detection was effective.

2. **Code review caught real issues** — Stories 2-9 and 2-10 underwent adversarial code reviews that identified:
   - Missing `azp` validation edge cases (2-9)
   - Timing-safe token comparison requirement (2-10)
   - Information disclosure in error messages (2-10)
   - Test match pattern YAGNI changes (2-10)

3. **Critical regression detected and fixed** — Story 2-10 discovered that Story 1-11 had deleted `GET /api/users/:userId/context` as "unused dead code," but OPEA (external Python service) was using it. This demonstrates the value of cross-repo dependency analysis during legacy removal.

4. **Backward compatibility maintained** — All changes are backward compatible:
   - Empty `KEYCLOAK_ADDITIONAL_REALMS` → single-realm behavior (2-9)
   - OPEA payload falls back to `queryData.userId` when unauthenticated (2-10)
   - Frontend i18n keys added to ALL 14 locales (2-6)

5. **Environment variable hardening** — Story 2-8 removed fallback defaults for `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, making them mandatory at startup with clear error messages.

### YAGNI Application

1. **Stories 2-4, 2-5, 2-7 deferred correctly** — Kong optional deployment (2-4, 2-5) and health check (2-7) were not requested by stakeholders. Deferred rather than implemented demonstrates disciplined YAGNI application.

2. **Jest config simplification** — Story 2-10 correctly reverted `testMatch` from `**/*.test.js` back to `*.test.js` (no nested test dirs exist) after recognizing over-engineering in code review.

## What Didn't Go Well

### Story 2-10 (OPEA Continuity)

1. **Three stacked critical issues** — OPEA callback had three simultaneous problems:
   - Missing endpoint (regression from Story 1-11)
   - Auth middleware mismatch (dead http-service JWT)
   - URL-breaking composite key (`#`, `/`, `:` in URL)
   
   **Fix applied:** Re-created endpoint with service shared secret auth, changed `user_id` from `iss_sub` to `_key` for URL safety, updated OPEA Python to use `X-Service-Token`.

2. **Decision D4 override needed** — Architecture said OPEA `user_id` should use `{iss}#{sub}`, but URL-breaking characters forced use of `_key`. `X-User-Id` header still uses composite key for audit. Architecture document needs amendment.

### Story 2-9 (Multi-Realm)

1. **Deviation from story spec** — Story specified comma-separated env vars (`KEYCLOAK_ADDITIONAL_REALMS` + `KEYCLOAK_ADDITIONAL_CLIENT_IDS`), but implementation used single JSON map. This is **better** (eliminates ordering risk), but deviation should have been pre-approved.

### Story 2-8 (Swagger UI)

1. **E2E tests deferred** — Browser-based OAuth2 flow tests (F.4-F.6) require deployed environment and were deferred to integration testing. E2E test plan documented but not executed.

2. **Stale file removal** — `swaggerConfig.js` and `swagger.json` deletion was correct (not imported/generated artifacts), but suggests stale file accumulation during development.

### Story 2-2 (JWKS Force-Refresh)

1. **E2E tests not executed** — Story included conditional E2E tests for Keycloak infrastructure, but these were not run. Lesson learned: Epic 2 should execute E2E tests when infrastructure is available.

### Testing

1. **Mock file detection issue** — Story 2-8 discovered Jest was detecting `__tests__/mocks/` files as failing test suites. Fixed by moving to `test-fixtures/` and adding `testPathIgnorePatterns`. Suggests testing structure review is needed.

2. **Test count drift** — Story 2-10 initially reported 121 tests, corrected to 123. Suggests need for automated test counting in CI/CD.

## Lessons Learned

### For Epic 3 (and Future Epics)

1. **Cross-repo dependency analysis during legacy removal** — Before deleting "unused" code, grep for cross-repo references (OPEA Python layer, mobile apps, external services). Story 1-11 deleted a route that OPEA was using.

2. **URL safety validation for composite keys** — `{iss}#{sub}` composite keys contain URL-breaking characters (`#`, `/`, `:`). Always validate URL safety before using in HTTP paths.

3. **Pre-approve spec deviations** — Story 2-9's JSON map env var was better than specified, but deviation should have been approved via sprint change proposal before implementation.

4. **Execute E2E tests when infrastructure available** — Epic 2 had multiple opportunities to run E2E tests (Keycloak, OPEA) but deferred them. Epic 3 should run E2E tests to validate integration before declaring stories complete.

5. **Shared secret > resurrected legacy** — When replacing dead auth pipelines (http-service JWT), prefer simple shared secrets over complex legacy restoration. Less attack surface, industry standard for Docker-internal networks.

6. **Timing-safe comparison for secrets** — Always use `crypto.timingSafeEqual()` (with length guard) for service token validation. String comparison (`===`) is vulnerable to timing attacks.

7. **Audit stale files regularly** — `swaggerConfig.js` and `swagger.json` persisted unused. Suggest adding "stale file audit" to retrospective checklist.

8. **Automated test counting** — Add test count verification to CI/CD to catch drift (121 vs 123 tests).

9. **Document architecture decision overrides** — When overriding a decision (D4 for OPEA `user_id`), document rationale in story completion notes and flag architecture doc for amendment.

### Process Improvements

1. **Sprint change proposals work** — Stories 2-4, 2-5, 2-7 were deferred via sprint change proposals with clear rationale. Continue using this mechanism for YAGNI deferrals.

2. **Parallel worktree execution validated** — `epic2-backend` and `epic2-frontend` ran simultaneously with zero file conflicts. File overlap analysis in sprint-status.yaml was accurate. Use same worktree strategy for Epic 3.

3. **Code review quality is high** — Adversarial code reviews caught timing attack vulnerabilities, information disclosure issues, and test over-engineering. Maintain fresh-context review practice.

4. **Deferred stories tracked correctly** — Sprint status clearly marks 2-4, 2-5, 2-7 as deferred with reasons. No confusion about what was skipped vs. completed.

## Action Items for Epic 3

1. **Before starting Story 3-1:** Update architecture.md Decision D4 to reflect: "OPEA payload `user_id` uses `_key` (URL-safe); `X-User-Id` header uses `{iss}#{sub}` (audit)."

2. **Before starting any Epic 3 story:** Run grep for cross-repo dependencies when removing/modifying endpoints. OPEA Python layer may be calling backend routes.

3. **During Epic 3 execution:** Execute E2E tests when infrastructure is available (Keycloak, OPEA). Document test results in story completion notes.

4. **After Epic 3 completion:** Audit and remove stale files (check for unused configs, generated artifacts, dead code).

5. **Add to CI/CD:** Automated test count verification to catch drift.

## Open Questions / Risks for Epic 3

1. **Session lifecycle complexity** — Epic 3 introduces logout (3-1), session invalidation (3-2), and session purging (3-7). Coordinating these across Keycloak, backend, frontend, and OPEA may have edge cases.

2. **Role management via Keycloak vs. ArangoDB** — Story 3-3 documents Keycloak role management, but current JIT provisioning stores roles in ArangoDB. Clarify whether roles are source-of-truth in Keycloak or cached in ArangoDB.

3. **Right to erasure implementation** — Story 3-6 requires user data deletion. This includes ArangoDB user documents and potentially OPEA conversation history. Scope needs clarification.

4. **External IdP attribute mapping** — Story 3-4 maps external IdP attributes to Keycloak roles. Keycloak Organizations (v26) may provide a native solution. Verify before implementing custom mapping.

## Metrics

| Metric | Value |
|--------|-------|
| Total stories | 9 (6 completed, 3 deferred) |
| Stories completed | 6 (100% of active stories) |
| Stories deferred | 3 (YAGNI) |
| Backend tests passing | 123/123 |
| Frontend tests passing | 129/129 |
| Worktrees used | 2 (epic2-backend, epic2-frontend) |
| Files added | ~15 |
| Files modified | ~25 |
| Files deleted | 2 (swaggerConfig.js, swagger.json) |
| Critical regressions fixed | 1 (OPEA callback endpoint) |
| Stories requiring hotfix | 0 |
| Code review rounds | 2 (Stories 2-9, 2-10) |

## Conclusion

Epic 2 established resilient API access controls with multi-realm support, improved developer experience (Swagger UI OAuth2), and maintained Keycloak-agnostic OPEA integration. The parallel worktree strategy was validated, YAGNI was applied correctly, and comprehensive test coverage caught regressions early.

The key lesson for Epic 3 is **cross-repo dependency awareness** — the OPEA callback regression in Story 2-10 demonstrates that backend changes can impact external services. Always grep cross-repo before removing "unused" code.

**Epic 2 Status:** ✅ COMPLETE
**Next Epic:** Epic 3 — Session Management, User Lifecycle & GDPR

---

**Retrospective Participants:**
- Dev Agent (glm-5-turbo) — Stories 2-2, 2-3, 2-8, 2-10
- Dev Agent (claude-sonnet-4-6) — Story 2-6
- Dev Agent (claude-opus-4-6) — Story 2-9
- Senior Developer Reviewers (AI) — Stories 2-9, 2-10

**Retrospective Facilitator:** bmad-bmm-retrospective workflow
