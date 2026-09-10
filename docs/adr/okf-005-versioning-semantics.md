# ADR okf-005: Versioning — immutable bundle versions + concept citation pin

- **Status**: Proposed
- **Date**: 2026-07-15
- **Decision owners**: Genie.ai Dev (architect)

## Context

Agents need **citable, version-pinned** knowledge (cite bundle + version + concept for an answer). OKF allows `okf_version` in root `index.md`. Bundles come from Git (commit SHAs) / S3 (versions) and are re-indexed incrementally.

### Constraints

- Citations must be stable and reproducible.
- Incremental re-index must not invalidate prior citations.
- Minimal extra storage.

## Decision

**Bundle-level versioning is primary.** Each steward **publish** creates an **immutable bundle version** (monotonic; tied to source ref — commit SHA / S3 version). Chunks/concepts carry `bundle_version` + `concept_id`. An agent citation pins `{bundle_id, bundle_version, concept_id}`. OKF's `okf_version` (format version) is stored on the bundle record but is distinct from the bundle *publish* version. Superseded versions are retained until retention/TTL, then retracted.

## Alternatives considered

| Alternative | Status |
|---|---|
| Per-concept versioning (each concept its own history) | Rejected for v1 — high cardinality/complexity; bundle-level + concept_id suffices for citation. |
| No versioning (latest only) | Rejected — citations would be non-reproducible; fails audit/citation NFRs. |

## Consequences

- **Positive**: reproducible citations; clean audit; immutable published versions.
- **Negative**: storage grows with version history until TTL.
- **Mitigations**: TTL/retraction per tenant; content-hash dedup of unchanged chunks across versions.

## References

- PRD FR-3, FR-11; Architecture §5, §6.2.
