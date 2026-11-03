# ADR okf-034: Knowledge Hierarchy canonical store — service-categories canonical + one-way-sync

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

The 2026-08-13 label-onboarding design review surfaced a cross-cutting hazard: the system has **two label stores** and they are not consistent.

- **`service-categories`** (the Knowledge Hierarchy) — read by the dataprep labeler at ingest time via `_fetch_all_labels` (`GET /api/service-categories/categories`, genieai_dataprep_arangodb.py:355-396). This is the set chunks are labeled against.
- **the document-repository `labels` collection** (`labelController`) — a separate store that Story 7.3's AC (epics.md) requires hierarchy/label edits to write to ("via the EXISTING service-category CRUD + labelService").

The labeler reads only `service-categories`; if Label Onboarding (Epic 9) or the producer (Story 7.3) writes only one store, the other drifts — chunks get labeled against a taxonomy that does not match the admin-edited hierarchy, and the `new_labels` WARN fires on labels a steward already "added". The 2026-08-13 design workflow flagged this as ADR-worthy and **blocking** Story 9.2/9.4 + Story 7.3.

Basis: [label-onboarding-design-2026-08-13 §2.5/§4](../../_bmad-output/planning-artifacts/label-onboarding-design-2026-08-13.md); [ADR-okf-033](okf-033-label-onboarding.md).

## Decision

**Declare `service-categories` the canonical Knowledge Hierarchy; on every steward Apply (Label Onboarding) and every producer label approval, one-way-sync the change into the document-repository `labels` collection so both stores agree.** (User-confirmed 2026-08-13: "canonical + one-way-sync".)

1. **`service-categories` is canonical** — because it is what the labeler reads at ingest (`_fetch_all_labels` :363). The gap is measured against it; the Graph Router uses it; chunks are labeled against it. All taxonomy mutation (Label Onboarding Apply, producer approval, admin CRUD) writes `service-categories` first.

2. **One-way-sync to the `labels` collection on Apply.** After a successful `service-categories` write (create/update/reparent), the okf-server propagates the same change to the document-repository `labels` collection — so code that reads `labels` (e.g. existing document-repository flows) sees the canonical set. Sync is best-effort + reconcilable (a periodic reconcile job can rebuild `labels` from `service-categories`); a sync failure does not block the canonical write (it is the source of truth) but is alerted.

3. **Reads stay where they are.** The labeler continues to read `service-categories` (`_fetch_all_labels` :363); `serviceTreeService.getAdminCategories()` (`/categories/detailed`) continues to serve the admin UI placement picker. Label Onboarding measures the gap via the labeler's `/categories` path (correctness invariant) and uses `/categories/detailed` only for placement.

4. **Future option (not now): deprecate the `labels` collection** entirely once all consumers read `service-categories`. Deferred to avoid touching the document-repository read paths in Epic 9; tracked as an open item.

## Alternatives considered

| Alternative | Status |
|---|---|
| Write both stores independently (dual-write) | Rejected — no single source of truth; drift recurs; the labeler reads only one. |
| Deprecate the `labels` collection now (single store) | Deferred — cleaner long-term, but touches document-repository read paths and the legacy `labelController`/`labelService` consumers; out of scope for Epic 9. Re-evaluate once consumers migrate. |
| `labels` canonical, sync to `service-categories` | Rejected — contradicts the labeler, which already reads `service-categories`; would force a labeler change. |

## Consequences

- **Positive**: one source of truth (`service-categories`); Label Onboarding + Story 7.3 can build against a single, consistent contract; the `new_labels` WARN reflects real gaps, not store drift; the correctness invariant (gap measured via the labeler's path) holds.
- **Negative**: a sync step on every Apply (operational); the legacy `labels` collection remains (tech debt) until deprecated.
- **Mitigations**: sync is idempotent + reconcilable (periodic rebuild from canonical); a sync failure is alerted, not blocking; deprecation is tracked as a future option.

## References

[label-onboarding-design-2026-08-13 §2.5/§4](../../_bmad-output/planning-artifacts/label-onboarding-design-2026-08-13.md); [ADR-okf-033](okf-033-label-onboarding.md); epics.md Story 7.3; `genieai_dataprep_arangodb.py:355-396`.
