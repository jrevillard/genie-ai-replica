# ADR okf-031: Versioning strategy — repo-level `bundle_version` (resolves §13.2)

- **Status**: Proposed
- **Date**: 2026-08-13
- **Decision owners**: Genie.ai Dev (architect)

## Context

Gap G26 (P2) + PRD §13 open question 2 / architecture §14: `bundle_version` is threaded through chunks/edges/meta in the schema but **never minted** — there is no `okf_versions` collection, no `mintVersion()`, and the PRD left "repository-level vs per-concept versioning" open (§13.2). Without a minted version, agent citation pinning (FR-11/FR-29) has no backing, and "list/diff versions" (FR-11) is impossible. The version granularity decision blocks Story 4.5.

Basis: [okf-course-correction-2026-08-13 §2.2, §3 D20](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-005](okf-005-versioning-semantics.md).

## Decision

**Versioning is repo-level: a monotonic integer `bundle_version` is minted on each publish transition, threaded onto every chunk/edge/meta doc of that publish, and recorded in an immutable `okf_versions` manifest.** (D20 = (a).)

1. **Repo-level granularity** (D20-a). One `bundle_version` per publish of a repo (not per concept). It is the `okf_version` of §13.2. This matches the bundle-as-unit-of-publish model (ADR-okf-021: a publish ingests a zip of concepts).

2. **Minted on publish** (ADR-okf-030). `mintVersion(repo_id)` runs as a publish side-effect (not a lifecycle state): increments the repo's version counter and snapshots the published concept set.

3. **Threaded everywhere.** `bundle_version` is written onto `OKF_{repo}_SOURCE` chunks, `_LINKS_TO` edges, and `okf_concepts_meta` at index time (Story 2.9.1/2.9.6). This already matches the schema in architecture §4 — the field exists; this ADR gives it a writer.

4. **Immutable manifest (`okf_versions`)** (G26). Keyed `[repo_id, bundle_version]`, each manifest records the concept list + content hashes + source ref + curator + timestamp. Immutable (INSERT-only). Enables "list/diff versions" (FR-11) and version-pinned citation (FR-29).

5. **Citation pinning.** An agent citation can pin `(repo_id, bundle_version, concept_id)` — resolvable via the manifest + the chunk docs carrying that `bundle_version`. Superseded versions are retained until retention/TTL (ADR-okf-032).

## Alternatives considered

| Alternative | Status |
|---|---|
| Per-concept versioning (D20-b) | Rejected — finer-grained but explodes the manifest cardinality and does not match the bundle-as-publish-unit model; repo-level is sufficient for citation and diff. |
| Version as a lifecycle state | Rejected (ADR-okf-030) — `version` is a publish side-effect, not a state. |

## Consequences

- **Positive**: PRD §13.2 / arch §14 resolved (G26); citation pinning + version diff/list work (FR-11/FR-29); the already-threaded `bundle_version` field finally has a writer.
- **Negative**: a new immutable collection to operate; superseded versions consume storage until TTL.
- **Mitigations**: INSERT-only + retention sweep (ADR-okf-032); the manifest is small (concept list + hashes).

## References

PRD §4.3 (FR-11), §13 Q2; [okf-course-correction-2026-08-13 §2.2, §3 D20](../../_bmad-output/planning-artifacts/okf-course-correction-2026-08-13.md); [ADR-okf-005](okf-005-versioning-semantics.md); [ADR-okf-021](okf-021-write-side-orchestration.md); [ADR-okf-030](okf-030-lifecycle-state-machine.md); [ADR-okf-032](okf-032-retention-ttl.md).
