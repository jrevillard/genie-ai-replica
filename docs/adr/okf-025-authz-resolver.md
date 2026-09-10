# ADR okf-025: Authz Resolver — token → authorized graph set + per-graph labels

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gaps G8 (P1) + G3/G15 (P0): no component owns the translation of a caller's OIDC token into the set of graphs it may read and the per-graph ACL labels to enforce. Today `callerDomain` is a **no-op filter** (G3 — any authed user lists/reads ALL repos across ALL tenants), and mutation is gated only by the global `tools-admin` realm role (G15 — a steward in tenant A can delete tenant B's repo). The Graph Router (ADR-okf-024) needs the authorized set as input, and the retriever needs per-graph `chunk_labels` (not a global union). This is the linchpin of FR-18/FR-24 and it has no owner.

Basis: [okf-course-correction-2026-08-13 §2.4[2], §3 D16/D17](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md).

## Decision

**Add an Authz Resolver component (`authz-resolver.js`) in the okf-server governance module that resolves a token to `{ graph_names, per_graph_labels, domains }`, with `okf:{tenant}:{repo}:{read|admin}` scope encoding and a per-session cache.** (D16 = (a); D17 = (b).)

1. **Scope encoding = `okf:{tenant}:{repo}:{read|admin}` string** (D16 = (a)). Matches FR-18; documented in the Keycloak mapper (audience + a custom scope mapper). The resolver parses these scopes from the verified token.

2. **Output contract.** `resolveOkfScopes(token)` → `{ graph_names: [OKF_repoA, …], per_graph_labels: { OKF_repoA: [t:t1, r:repoA, d:domA], … }, domains: [domA, …] }`. The per-graph label map is **per-graph parameterized** — repo A's chunks carry `r:repoA`, repo B's carry `r:repoB`; never a global union (the G8 root cause).

3. **Cache = per-session** (D17 = (b)). The resolver is on the hot path (runs on every search); cache the resolved set per-session and invalidate on token refresh. Budget its latency into the selection budget (ADR-okf-024).

4. **Default-deny (G3/G15 fix — Story 6.1 update).** Undefined domain → **empty** authorized set + 404 on foreign repos (not the full catalog). Mutation requires `requireRepoScope(repo_id, 'admin')`, **replacing** the global `tools-admin` role for per-repo mutations. A read scope is enforced via `requireScope('okf:read')` middleware on every call.

5. **Home: okf-server governance.** The resolver runs server-side; ChatQnA receives the resolved set from the OKF serving surface or a trusted header (not by re-parsing the token — the OKF Server is the authz authority behind Kong).

## Alternatives considered

| Alternative | Status |
|---|---|
| Custom claim (D16-b) | Rejected — a scope string matches FR-18 and Keycloak's standard scope machinery; a custom claim needs bespoke mapper + client logic. |
| Keycloak role mapper only (D16-c) | Rejected — roles are coarse; the repo-level granularity FR-18 needs is a scope, not a role. |
| Per-request resolution, no cache (D17-a) | Rejected — the resolver is on every search's hot path; per-session cache with refresh-invalidating is the right latency/correctness trade-off. |

## Consequences

- **Positive**: G3 (cross-tenant leak) and G15 (global-admin overreach) are closed; the Graph Router gets a clean authorized-set input; ACL is per-graph and correct.
- **Negative**: a new component + a Keycloak scope mapper; the cache invalidation discipline (refresh/revoke).
- **Mitigations**: default-deny posture (fail closed); the isolation launch-gate test (repo-A caller cannot read repo-B chunks); per-session cache bounded by token lifetime.

## References

PRD §4.6 (FR-18), NFR-S2; [okf-course-correction-2026-08-13 §2.4[2], §3 D16/D17](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-002](okf-002-shared-graph-multi-tenancy.md); [ADR-okf-003](okf-003-standalone-service-behind-kong.md); [ADR-okf-024](okf-024-graph-selection-router.md).
