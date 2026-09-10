# ADR okf-026: Trust locality & staleness — denormalize at index, compute staleness at query

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G13 (P1): OKF v0.2 trust/staleness fields (`trust_tier` from `verified`; `stale_after`) live in `okf_concepts_meta`, but the retriever only reads the `_SOURCE` chunk collection. So "advisory trust" is **non-functional at retrieval** — the signal cannot reach the hit without a join the retriever does not perform. Meanwhile FR-29 requires every served concept to carry a trust tier, a staleness flag, and source provenance. The question is where trust lives so the retriever can surface it cheaply, and whether staleness (time-relative) is stored or computed.

Basis: [okf-course-correction-2026-08-13 §2.4[6], §3 D11/D12](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-017](okf-017-okf-v02-trust-lifecycle-provenance.md).

## Decision

**Denormalize `trust_tier` onto the `_SOURCE` chunk at index time; compute `stale_after` at query time; enforce as advisory annotation in v1.** (D11 = (a) hybrid; D12 = (a) advisory.)

1. **`trust_tier` denormalized at index time** (D11-a). When the worker writes `OKF_{repo_id}_SOURCE`, it copies the concept's derived `trust_tier` (from `okf_concepts_meta.verified`) onto each chunk. This makes the signal readable without a join — the retriever attaches it to the hit directly.

2. **Staleness computed at query time** (D11-a). `stale_after` is an absolute date; "stale" is `CURRENT_DATE() >= stale_after`. Storing a boolean would decay; computing it at query time keeps it fresh. The chunk carries `stale_after`; the retriever annotates `stale = (today >= stale_after)`.

3. **Enforcement = advisory annotation in v1** (D12-a). Trust/staleness are surfaced to the agent (and the user) as **advisory signals** — they are **not** access control and do not hard-filter results in v1. A configurable filter mode (D12-b) is a documented future option, scoped honestly against FR-29; it is not built now.

4. **Provenance.** `repo_id`/`concept_id`/`graph_name`/`sources` are materialized on the hit (Story 1.0, G18) so the agent can cite provenance alongside trust.

## Alternatives considered

| Alternative | Status |
|---|---|
| AQL join `okf_concepts_meta` at query (D11-b) | Rejected — a per-hit join on the hot retrieval path; expensive and couples the retriever to the control-plane collection. |
| Advisory annotation only, no denormalization (D11-c) | Rejected — leaves the signal unreadable by the retriever (the G13 defect persists). |
| Hard filter on staleness/trust (D12-b) | Deferred — risks silently hiding content; v1 discloses and lets the agent decide, matching FR-29's "advisory signals, not access control." |

## Consequences

- **Positive**: trust/staleness reach the hit at retrieval cost (G13 closed); fresh staleness (computed, not stored); FR-29 is functional; the future filter mode is a config flip.
- **Negative**: `trust_tier` is duplicated (meta + chunk) — a trust change requires re-indexing the concept's chunks (Story 4.1b re-materialization, G29).
- **Mitigations**: denormalization is write-amplification only at index/edit; Story 4.1b recomputes labels+trust on edit; the provenance fields are already additive (NFR-S7).

## References

PRD §4.4 (FR-29); [okf-course-correction-2026-08-13 §2.4[6], §3 D11/D12](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-017](okf-017-okf-v02-trust-lifecycle-provenance.md); [ADR-okf-021](okf-021-write-side-orchestration.md).
