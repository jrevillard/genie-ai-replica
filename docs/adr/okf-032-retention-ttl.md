# ADR okf-032: Retention & TTL — schema'd policy, sweep worker, deletion-reason discriminator

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G27 (P2): the `retention` field exists on `okf_repositories` but is **dead** — there is no sweep worker, no schema, and no policy enforcement. Worse, there are three distinct reasons content gets deleted (TTL expiry, explicit retire, origin-deletion-while-retained) that today are indistinguishable in the audit trail — so an FOI officer cannot tell *why* content disappeared. FR-12 (retention/TTL with audited retraction) is non-functional. The PRD §13 open question 6 (retention defaults per domain) is also unresolved.

Basis: [okf-course-correction-2026-08-13 §2.2, §4 (Story 2.17)](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); FR-12.

## Decision

**Retention is a schema'd policy (`retention`, `delete_after`) enforced by a scheduled sweep worker, with a `deletion_reason` discriminator distinguishing TTL-expiry, explicit retire, and origin-deletion.** 

1. **Schema'd policy.** `okf_repositories.retention` (a duration/policy object, per-tenant/per-domain configurable with safe defaults) and `delete_after` (the computed absolute expiry). PRD §13 Q6 (defaults per domain) is resolved per-domain with a deployment default; not hard-coded.

2. **Sweep worker (Story 2.9.9).** A scheduled okf-server job scans for repos/concepts past `delete_after` and retracts them via the existing retraction cascade (FR-8, Story 2.9.6 `retractRepoGraph`). This is the writer that makes `retention` live (G27).

3. **`deletion_reason` discriminator.** Every retraction records **why**: `ttl_expired` | `retired` (steward action) | `origin_deleted` (the external origin disappeared and the retention policy says drop) | `gdpr_erasure` (right-to-erasure, NFR-P3). This makes the audit trail FOI-meaningful and resolves the origin-deletion-vs-retention conflict (FR-2/FR-27): if the origin disappears but retention says keep, the retained document-repository copy is served (FR-27) and the reason is logged; if retention says drop, the sweep retracts with `origin_deleted`.

4. **Audited.** Every sweep retraction writes an audit row (write-before-respond — ADR-okf-029) with the `deletion_reason`.

## Alternatives considered

| Alternative | Status |
|---|---|
| ArangoDB TTL indexes (native) | Rejected as the sole mechanism — TTL indexes delete silently with no audit and no `deletion_reason`; the sweep worker owns the audited, policy-aware path (native TTL may be used as a backstop only). |
| Manual retraction only (no sweep) | Rejected — retention is never enforced; FR-12 is non-functional. |

## Consequences

- **Positive**: FR-12 functional (G27); `retention` is live; the audit trail distinguishes why content was removed (FOI/GDPR clean); origin-deletion-vs-retention is unambiguous.
- **Negative**: a sweep worker to operate/monitor; retention policy must be decided per domain.
- **Mitigations**: safe deployment defaults; the sweep is idempotent + audited; `deletion_reason` makes every removal explainable.

## References

PRD §4.3 (FR-12), §13 Q6, NFR-P3; [okf-course-correction-2026-08-13 §2.2](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-016](okf-016-external-source-management.md); [ADR-okf-029](okf-029-audit-integrity.md); [ADR-okf-031](okf-031-versioning-strategy.md).
