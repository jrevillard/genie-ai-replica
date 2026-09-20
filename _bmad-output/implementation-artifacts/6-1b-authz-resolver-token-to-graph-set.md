# Story 6.1b — Authz Resolver: token → graph set (read side)

**Status:** IN-PROGRESS → implemented this session.
**Sources:** epics.md G8; sprint `6-1b`; [ADR-okf-039](../../../docs/adr/okf-039-retrieval-mode-governance.md)
(read path); [fan-out course-correction](../planning-artifacts/okf-fanout-course-correction-2026-09-20.md)
amendments B (versioned graph names from the repo doc) + D (label-map seam).

## Story

As a **chat caller (via ChatQnA)**,
I want **my verified token resolved into exactly the set of serving OKF graphs I'm
authorized to traverse**,
So that **fan-out grounds only in repos I may read — unauthorized repos contribute
zero hits by construction, never by post-filtering**.

## Acceptance criteria

1. **Single scope authority** — the read-side resolver and the write-side
   `callerAuthz` share ONE scope-parsing implementation (extracted, byte-identical
   semantics: `tools-admin` ⇒ unrestricted; grammar-valid `okf:{t}:{repo}:{read|admin}`
   with `repo==='*'` ⇒ unrestricted; exact repo segments ⇒ the authorized set; typo
   levels grant nothing; tenants currently ignored — consistency with 6.1 wins).
2. **Graph set = serving ∩ authorized** — serving truth is
   `lifecycle_state==='publish' && ingested_at && !deleted_at`; graph names come from
   the `workingGraphName` authority (versioned `OKF_<slug>_v<N>` from the repo doc —
   never static names, never the manifest's stamped version).
3. **`GET /api/okf/authz/graphs`** returns `{graph_names[], per_graph_labels{},
   domains{}, repos[{repo_id, graph_name, domain, name}], superadmin, generated_at,
   ttl_seconds}` — read-scoped by the router gate; no new auth surface.
4. **Per-graph label map (G8)** — the SHAPE ships; values are `null` today
   (no label-ACL source exists yet — documented seam). Consumers treat `null` as
   "no label restriction beyond the caller's own `search_start` filter_labels".
5. **Per-session cache contract** — the serving-set query is memoized in-process
   with a ≤30s TTL (the ADR-bounded re-publish skew); the response advertises
   `ttl_seconds: 30` so the ChatQnA-side per-session cache (lands with Story 1.2)
   can align. `_resetServingCache()` exported for tests.
6. **Zero-hit guarantee** — a caller scoped to repo A can never see repo B's graph
   in the response; a caller with zero serving/authorized overlap gets empty sets.

## Non-goals / later waves

- Python-side per-session cache + forwarding = Story 1.2 (Wave R5).
- Label-restriction source (Keycloak attribute or repo-doc field) = future
  hardening; the map shape is the contract that survives it.
- The Graph Router's selection/intersections = Story 1.3 (it consumes this
  resolver + retrieval-config).

## Verification plan

- Resolver unit tests: scope matrix (super-role, wildcard, typo-level, exact,
  mixed), serving∩authorized intersection, empty-overlap, per-graph-label shape,
  TTL cache + reset.
- Retrieval-config tests extended for the shared serving-set cache (reset in
  beforeEach; explicit resets where tests reseed mid-test).
- Full okf-server suite green (the `callerAuthz` delegation must keep every
  existing authz test green — behavior-identical).
