# Sprint Change Proposal — 2026-04-03

## Section 1: Issue Summary

**Problem:** During the creation of Story 2.7 (Health Check — Keycloak Discovery Endpoint Reachability), advanced elicitation revealed that the proposed `/health` endpoint on the GENIE.AI backend is partially redundant.

**Discovery context:** The issue was identified during the `create-story` workflow for Story 2.7, specifically during a First Principles Analysis that questioned the fundamental purpose and necessity of the endpoint.

**Evidence:**
1. Keycloak natively exposes `/health/ready`, `/health/live`, `/health/started` endpoints
2. The GENIE.AI backend already handles Keycloak unavailability via `ensureInitialized()` → `AUTH_SERVICE_UNAVAILABLE` with a 30-second retry cooldown
3. Docker can monitor Keycloak directly via its own healthcheck configuration
4. The proposed endpoint would add a network probe (HTTP fetch with timeout) that partially duplicates what infrastructure-level monitoring already provides

## Section 2: Impact Analysis

### Epic Impact

- **Epic 2 (Secure API Access & Resilient Authentication):** No scope change required. Story 2.7 is in Round 3 of the epic2-backend worktree. Deferring it frees Round 3, allowing Round 4 stories (2-9, 2-10) to start earlier if desired.
- **Epic 3 & 4:** No impact. No other story depends on Story 2.7.

### Story Impact

| Story | Current Status | Impact |
|-------|---------------|--------|
| 2-7 (Health Check) | `backlog` | Change to `deferred` |
| 2-2 (JWKS force-refresh) | `ready-for-dev` | None |
| 2-3 (Token passthrough) | `backlog` | None — can proceed without 2-7 |
| 2-9 (Multi-realm) | `backlog` | None — dependency was on 2-2, not 2-7 |
| 2-10 (OPEA continuity) | `backlog` | None — dependency was on 2-3, not 2-7 |

### Artifact Conflicts

| Artifact | Conflict | Action |
|----------|----------|--------|
| PRD (FR30, NFR9, NFR11) | Minor | FR30 is still covered by existing middleware. NFR11 (proactive health check) deferred but infrastructure monitoring remains. No PRD edit needed. |
| Architecture | None | No architecture changes needed. |
| UI/UX | None | No frontend impact. |

### Technical Impact

- No code changes required
- No deployment changes required
- No new dependencies

## Section 3: Recommended Approach

**Approach: Direct Adjustment — Defer Story 2.7**

**Rationale:**
- The story is in `backlog` status — no implementation work has been done
- No other story depends on 2.7
- The underlying requirement (FR30 — detect Keycloak unavailability) is already met by the auth middleware
- Infrastructure-level monitoring (Docker healthcheck on Keycloak) provides the operational visibility needed
- The story can be re-evaluated in a future sprint if a concrete monitoring use case emerges (e.g., external monitoring system needs a single backend endpoint)

**Effort estimate:** Low (administrative change only)
**Risk level:** Low (no code or architecture impact)
**Timeline impact:** Positive — frees Round 3 capacity

## Section 4: Detailed Change Proposals

### Change 1: Update sprint-status.yaml

**File:** `_bmad-output/implementation-artifacts/sprint-status.yaml`
**Section:** `development_status`

```
OLD:
  2-7-keycloak-unavailable-detection-and-health-check: backlog # worktree: epic2-backend

NEW:
  # Story 2-7 deferred: YAGNI — Keycloak has native health checks (/health/ready, /health/live),
  # backend already handles unavailability via AUTH_SERVICE_UNAVAILABLE with 30s cooldown,
  # Docker monitors Keycloak directly. FR30 still covered by auth middleware.
  # Can be re-evaluated if concrete monitoring use case emerges.
  2-7-keycloak-unavailable-detection-and-health-check: deferred # worktree: epic2-backend
```

**Rationale:** Mark story as deferred with clear justification for future reference.

### Change 2: Remove created story file

**File:** `_bmad-output/implementation-artifacts/2-7-keycloak-unavailable-detection-and-health-check.md`
**Action:** Delete — story was created during this session but no implementation has started.

### Change 3: Update worktree strategy comment (optional)

The Round 3 comment in the worktree strategy section references 2-7. It can be updated to reflect that Round 3 is now empty:

```
OLD:
  #   Round 3:
  #     epic2-backend:  2-7  Health check

NEW:
  #   Round 3: (empty — 2-7 deferred)
```

## Section 5: Implementation Handoff

**Change scope classification: Minor**

This is a purely administrative change — no code, architecture, or deployment modifications are needed.

**Handoff:**
- **Executor:** SM agent or developer (administrative only)
- **Actions:**
  1. Update `sprint-status.yaml` (change 2-7 status to `deferred`)
  2. Delete story file `2-7-keycloak-unavailable-detection-and-health-check.md`
  3. (Optional) Update worktree strategy comment

**Success criteria:**
- Story 2-7 is marked `deferred` in sprint-status.yaml
- No orphan story file remains in implementation-artifacts
- No broken references to story 2-7 in other artifacts
