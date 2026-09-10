# ADR okf-023: `graph_names` transport across the ChatQnA→retriever mega-service boundary

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G2 (P0): the retriever's `invoke()` must accept a **list** of `graph_names` (ADR-okf-012), but in the deployed stack the retriever runs **inside** the ChatQnA mega-service via OPEA's dynamic `__main__` assembly, which reconstructs request models and **drops fields it does not know about**. A `graph_names` list added to `GenieEmbedDoc` or threaded through `search_start` may silently vanish at that boundary — meaning multi-graph fan-out works in a unit test but **not in production**. This is the single unverified assumption underpinning the entire query vision. Adding the field to the wrong carrier is also brittle at 50+ repos (G6).

Basis: [okf-course-correction-2026-08-13 §3 D7](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md). The decision interacts with D24 (OPEA 1.5 bump timing) and D25 (fallback shim).

## Decision

**Probe the boundary first; transport `graph_names` via the cleanest carrier that survives it; prove it deployed, not just in-process.** (D7 = "probe first"; carrier preference below.)

1. **Boundary probe (Story 1.0b, gated).** POST `/v1/retrieval` with `graph_names=[G1,G2]` against the **deployed** mega-service and assert `invoke()` receives both. This determines the entire read-side transport shape before any fan-out code is trusted.

2. **Carrier preference.** (a) Add `graph_names` to `GenieEmbedDoc` **only if** the probe proves the boundary preserves it (likely it does not). (c) **Else extend `label_contract.py`** to carry the graph list cleanly — the preferred durable carrier. **Do NOT** encode `graph_names` inside `search_start` alongside labels (D7-b): it is brittle at 50+ graphs and conflates selection with ACL.

3. **D24/D25 reconciliation (confirmed 2026-08-13).** The OPEA 1.5 bump (!277) gates this work; the team **waits for the bump to merge — no slip date, no fallback shim built now.** The fallback shim **design** (serial fan-out behind a plural `graph_names` interface on the current base) is recorded here as a **contingency only** (Story 8.5), activated **if and only if** the team later decides to ungate Epic 1 before the bump merges. This honors the standing directive: do not proceed on bump-dependent work until merged.

4. **Launch gate.** The boundary probe passing in the **deployed** mega-service (not in-process) is a hard launch gate (§5.2 of the Sprint Change Proposal). Without it, FR-24 is unverified.

## Alternatives considered

| Alternative | Status |
|---|---|
| Encode `graph_names` in `search_start` with labels (D7-b) | Rejected — brittle at 50+ graphs; conflates graph selection with ACL labels; hard to read in traces. |
| Assume `GenieEmbedDoc` carries it; skip the probe | Rejected — the dynamic `__main__` assembly is known to drop unknown fields; this is the exact unverified assumption G2 names. |
| Fallback shim now (D25-a, immediate) | Deferred per D24 — we wait for the bump; the shim is a documented contingency, not built now. |

## Consequences

- **Positive**: the read-side transport is **proven** before fan-out code is relied upon; the carrier is clean and scalable; the gate prevents shipping a silently-broken query path.
- **Negative**: Epic 1 is blocked until (a) the bump merges AND (b) the probe passes; if the probe fails, a `label_contract` extension is extra work.
- **Mitigations**: the probe is cheap and early (Phase 1); the `label_contract` extension is additive and local; the contingency shim is documented if priorities shift.

## References

PRD §4.4 (FR-24), §10 dependencies (D24); [okf-course-correction-2026-08-13 §3 D7, §2.4](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [Sprint Change Proposal 2026-08-13 §5.1](../../_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-13.md); [ADR-okf-012](okf-012-multi-graph-grounding.md); [ADR-okf-013](okf-013-graph-name-wiring.md); [ADR-okf-024](okf-024-graph-selection-router.md).
