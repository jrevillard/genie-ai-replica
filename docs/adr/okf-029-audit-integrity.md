# ADR okf-029: Audit integrity — write-before-respond, hash chain, tenant field, tamper-evidence

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G16 (P1): the current audit design is best-effort (swallow-on-failure), which contradicts SM-4 ("100% of served responses produce an audit record"). It is not tamper-evident, has no `tenant` field (so FOI export by tenant is impossible), and has no volume policy (serving actions are high-volume; governing actions are low-volume). For a public-sector FOI/GDPR system, audit integrity is a core requirement, not a nice-to-have.

Basis: [okf-course-correction-2026-08-13 §2.2, §3 D18/D19](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-018](okf-018-okf-control-plane-storage.md).

## Decision

**Audit uses a two-tier failure mode (write-before-respond for governance; best-effort for serving), with a hash chain + write-locked DB user for tamper-evidence, and a `tenant`+`actor_roles` field set.** (D18 = (a); D19 = (c) both.)

1. **Two-tier failure mode (D18-a).** **Governance actions** (publish, deprecate, retire, delete, ACL change) are **write-before-respond**: the audit row is written (and confirmed) before the HTTP response — if the audit write fails, the action fails (SM-4 holds for the actions that matter most). **Serving actions** (search, get) are **best-effort** — high volume; a missed serving-audit row degrades observability but must not fail the query. The volume policy is explicit: which actions are "audit-worthy" is enumerated.

2. **Tamper-evidence = hash chain + write-locked DB user (D19-c, both).** (a) Each audit row carries `prev_hash` (hash of the prior row) forming a chain, with periodic root publication. (b) The ArangoDB user that writes `okf_audit` has **INSERT-only** privileges (no UPDATE/DELETE) — defense in depth against tampering.

3. **Schema additions.** `okf_audit` gains `tenant`, `actor_roles[]`, and `prev_hash`; indexes on `tenant` and compound `(repo_id, ts)` for FOI export by tenant + date range.

4. **`tenant` field.** Derived from the Authz Resolver (ADR-okf-025); every audit row records the caller's tenant, enabling per-tenant FOI/GDPR export (FR-19).

## Alternatives considered

| Alternative | Status |
|---|---|
| All best-effort (D18-b) | Rejected — violates SM-4 for governance actions; a public-sector system cannot silently lose a "who deleted this repo" record. |
| Hash chain only (D19-a) | Rejected alone — a compromised DB user could UPDATE/DELETE rows and recompute the chain; the write-locked user closes that. |
| Write-locked user only (D19-b) | Rejected alone — does not detect application-layer tampering or prove ordering; the chain provides forward integrity. |

## Consequences

- **Positive**: SM-4 holds for governance (G16); tamper-evidence satisfies FOI/GDPR; per-tenant export works; the volume policy keeps serving fast.
- **Negative**: governance actions pay a synchronous audit-write latency; the INSERT-only user is an operational constraint; the hash chain must be verified periodically.
- **Mitigations**: governance actions are low-volume (latency acceptable); the INSERT-only user is documented in the deploy guide; root publication is scheduled. The launch-gate test verifies write-before-respond under ArangoDB failure.

## References

PRD §4.6 (FR-19), §7 (SM-4), NFR-T2; [okf-course-correction-2026-08-13 §2.2, §3 D18/D19](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-018](okf-018-okf-control-plane-storage.md); [ADR-okf-025](okf-025-authz-resolver.md).
