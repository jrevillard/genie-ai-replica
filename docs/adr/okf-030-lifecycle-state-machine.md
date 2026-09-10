# ADR okf-030: Lifecycle state machine — explicit transitions, auto vs human gates

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G17 (P1): the repository/concept lifecycle today is a flat array (`register→validate→review→approve→publish→version→deprecate→retire`), not a state machine. `version` is misclassified as a state (it is a publish side-effect); `remove` skips `deprecate`; and there are two unconciled lifecycles (repo-level and concept-level). Without a formal `TRANSITIONS` map, invalid transitions are not prevented, and the served-status rule ("only `published` content is served") cannot be enforced reliably. FR-9/FR-10/FR-21 (served status) depend on this.

Basis: [okf-course-correction-2026-08-13 §2.3[7], §3 D21](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md).

## Decision

**Model the lifecycle as an explicit state machine with a `TRANSITIONS` map, auto vs human gates, and a single served-status rule; `version` is a publish side-effect, not a state.** (D21 = as stated.)

1. **Explicit `TRANSITIONS` map.** Each state lists its valid successor states + the gate type:
   - **Auto gates**: `register → validate` (on first conformance run); `validate → review` (on conformance pass); `parsed → indexed` (on worker success, per-concept `index_status`).
   - **Human gates**: `review → approve` (steward sign-off, FR-10); `approve → publish` (steward, writes `verified` trust signal).
   - **Terminal-ish**: `published → deprecated` (steward); `deprecated → retired` (steward + grace). `delete` is a separate, audited, irreversible-after-grace operation (FR-23), not a lifecycle state.

2. **`version` is a publish side-effect** (D20/ADR-okf-031), not a state. Entering `published` mints a `bundle_version`; it is not a state the repo transitions *through*.

3. **Served-status rule (single, authoritative).** Content is served to agents **iff** `repo.lifecycle_state='published'` AND `concept.lifecycle_status ∈ {stable, deprecated}`. This closes G28's PII-gating dependency (a concept withheld by PII never reaches `stable`).

4. **Transition endpoints + audit.** Each transition is a dedicated endpoint that records `repo.transition` audit rows (write-before-respond — ADR-okf-029). Invalid transitions return 409 with the allowed-next-states.

5. **Repo-level and concept-level reconciled.** The two lifecycles share the same `TRANSITIONS` shape; a repo is `published` only when its concepts are `stable/deprecated`, and PII/conformance gates apply per concept.

## Alternatives considered

| Alternative | Status |
|---|---|
| Keep the flat array (status quo) | Rejected — cannot prevent invalid transitions; `version`-as-state is a category error; the served rule is ambiguous. |
| Per-concept versioning as the primary axis | Rejected — D20 chose repo-level `bundle_version`; the state machine governs *served status*, which is orthogonal to version granularity. |

## Consequences

- **Positive**: invalid transitions are prevented (G17); the served rule is unambiguous and testable; PII gating (G28) hooks cleanly off the concept gate; audit captures every transition.
- **Negative**: a `TRANSITIONS` map to maintain; transition endpoints to build (Story 4.3 rewrite).
- **Mitigations**: the map is small and enumerated; the rewrite is scoped to Stories 4.3–4.5; tests assert the served rule + invalid-transition rejection.

## References

PRD §4.3 (FR-9, FR-10), §4.6 (FR-19); [okf-course-correction-2026-08-13 §2.3[7], §3 D21](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-029](okf-029-audit-integrity.md); [ADR-okf-031](okf-031-versioning-strategy.md).
