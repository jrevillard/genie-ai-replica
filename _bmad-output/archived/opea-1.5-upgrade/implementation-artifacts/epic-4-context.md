# Epic 4 Context: Operational readiness & rollout

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Ensure the OPEA 1.5 upgrade ships safely to production with full operational readiness: latent bugs fixed, image tags pinned for reproducibility, canary deployment validated, rollback proven, and documentation current. This epic bridges the technical upgrade (epics 1-3) to production deployment, de-risking the rollout through validation, pinning, and proven rollback procedures.

## Stories

- Story 4.1: Fix latent dataprep/retriever bugs (graph name env inconsistency)
- Story 4.2: Pin AI-stack image tags (eliminate `:latest`, manifest-driven versions)
- Story 4.3: Canary on release/el-salvador with shadow comparison
- Story 4.4: Rehearse rollback (whole-set revert + backward-read + retention)
- Story 4.5: Update docs, env, and upgrade matrix

## Requirements & Constraints

- **Image pinning is mandatory**: No `:latest` tags in AI stack. All images must have explicit version tags (vLLM v0.10.x, wrappers 1.5-based).
- **versions.env is authoritative**: Single source of truth for all image versions. Coherence lint must fail CI on mixed-version fleets.
- **Canary before main**: Production promotion requires shadow comparison (v1.3 vs v1.5) with explicit exit criteria (error rate, latency, RAG spot-check, no ingest anomalies).
- **Rollback must be proven**: Staging rehearsal of full v1.3 redeployment against same ArangoDB, with backward-read validation (v1.3 serves v1.5-written data).
- **Documentation must be current**: Env vars, upgrade matrix, and CHANGELOG updated in same MR as version bump. No `NEXT` placeholders.
- **Independent commits**: Each story lands as separate commit for clean root-cause tracing.

## Technical Decisions

- **Graph name unification**: Ingest and retract must use same `ARANGO_GRAPH_NAME` env var with consistent default. Story 4.1 already fixed this (unified to "GRAPH").
- **Version pinning strategy**: Use `versions.env` as manifest. Dockerfiles reference variables, not hardcoded tags. CI lint enforces consistency.
- **Shadow comparison criteria**: Side-by-side v1.3 vs v1.5 on el-salvador. Exit criteria: error rate < threshold, latency < threshold, RAG spot-check passes, no ingest anomalies.
- **Rollback retention**: v1.3 images retained with retention rule. Backward-read test validates v1.3 can serve v1.5-written data (schema compatibility).
- **Documentation updates**: Upgrade matrix shows v1.3→v1.5 entry. CLAUDE.md and env reflect post-bump facts.

## Cross-Story Dependencies

- **4.1 → 4.2**: Bug fix (4.1) must land before pinning (4.2) to ensure pinned images have correct behavior.
- **4.2 → 4.3**: Image pinning (4.2) must complete before canary (4.3) to ensure reproducible canary deployment.
- **4.3 → 4.4**: Canary validation (4.3) informs rollback rehearsal (4.4) — if canary fails, rollback is triggered.
- **4.2 → 4.5**: Version pinning (4.2) drives documentation updates (4.5) — upgrade matrix reflects pinned versions.
- **All → main merge**: All stories must complete before merging prd to main. Epic 4 is the final gate.
