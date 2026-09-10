# ADR okf-028: Cross-repo structural link policy — reject in v1 (within-repo only)

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G22 (P2): OKF concepts cross-link via Markdown `[anchor](/path/to/concept.md)`. Today the parser does not validate that a link target lives in the **same** repository. A link from repo A to a concept in repo B is neither supported nor rejected — the parser will silently choose, and structural traversal (`OKF_{repo}_LINKS_TO`) breaks at the repo boundary. The user confirmed a 1:1 repo↔graph model, and Story 5.5 neighbors traversal is single-repo-scoped. Allowing cross-repo links in v1 would require a shared edge collection + cross-graph traversal fusion that is explicitly out of scope.

Basis: [okf-course-correction-2026-08-13 §2.7, §3 D13](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md).

## Decision

**In v1, structural links are within-repo only: the parser rejects cross-repo link targets at parse time (with a conformance issue), and `_LINKS_TO` edges are validated to stay within the same `repo_id`.** (D13 = (a).)

1. **Reject at parse (Story 2.3 AC update).** `parser-service` validates that each link target resolves to a `concept_id` within the **same** `repo_id`. A cross-repo target emits a conformance issue (`CROSS_REPO_LINK`) — non-blocking (the concept still ingests), but flagged for the steward.

2. **Edge writer validates (Story 2.9.3).** The orchestrator's `_LINKS_TO` writer only emits edges where both endpoints are concepts in the same repo. Cross-repo targets are dropped (consistent with the parse-time warning).

3. **Closed namespace = within one repo.** This makes "closed concept-ID namespace" (FR-30, used to resist producer link fabrication) concrete: the namespace is the repo's concept set.

4. **Cross-repo links are a documented future capability** (D13-b: a shared edge collection + cross-graph traversal fusion) — explicitly out of scope for v1, matching single-repo traversal (Story 5.5).

## Alternatives considered

| Alternative | Status |
|---|---|
| Support cross-repo links via a shared edge collection (D13-b) | Deferred — requires cross-graph traversal fusion (out of scope for Story 5.5) and a new shared collection; the within-repo model is simpler and matches the 1:1 repo↔graph isolation. |

## Consequences

- **Positive**: traversal semantics are unambiguous (single-repo); the producer's closed-namespace anti-fabrication rule is well-defined; no shared edge collection to operate.
- **Negative**: genuinely cross-domain links (a health concept referencing a legal concept) are not traversable in v1 — they surface only as conformance warnings.
- **Mitigations**: the warning makes the gap visible; agents can still retrieve across repos via search (FR-14), just not traverse structurally across the boundary; the v2 path remains open.

## References

PRD §4.2 (FR-7), §4.9 (FR-30 closed namespace); [okf-course-correction-2026-08-13 §2.7, §3 D13](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-019](okf-019-ai-driven-okf-producer.md); [ADR-okf-021](okf-021-write-side-orchestration.md).
