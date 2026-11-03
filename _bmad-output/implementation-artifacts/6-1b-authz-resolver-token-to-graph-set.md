# Story 6.1b — Authz Resolver: token → graph set (read side)

**Status:** DONE 2026-09-20 (implemented + adversarially reviewed; all 18 review
patches applied — commits feac617 + review-hardening commit). Consumers are
separate stories by contract: 1.2 forwards (Python session cache), 1.3 router.
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

## Review Findings

Code review 2026-09-20 — layers: blind-hunter ✅, acceptance-auditor ✅ (verdict:
conforming), edge-case-hunter ❌ FAILED (instruction file absent from skill
install), verification-gap ❌ FAILED (same). Coverage gap disclosed; findings
below are from the two completed layers. 0 decision-needed · 18 patch · 3
defer · 3 dismissed.

- [x] [Review][Patch] Serving projection strips lifecycle_state/ingested_at — servingRepos resolves EVERY repo to draft name v{N+1} in production (mock bypasses AQL KEEP, so tests stayed green); drop dead ingested_version [services/retrieval-config-service.js]
- [x] [Review][Patch] Engagement gate + env defaults unvalidated — mode!=='legacy' engages INVALID modes; env NaN/unclamped caps flow into effective config [services/retrieval-config-service.js + config.js]
- [x] [Review][Patch] Hand-rolled 404 check bypasses house isArangoNotFound — real-driver errorNum-only shapes 500 the designed default path on fresh deployments [services/retrieval-config-service.js]
- [x] [Review][Patch] GET /retrieval-config serves the GLOBAL serving set to any read-scoped caller — make the serving view authz-aware (per-caller count/list; also corrects the per-caller engagement gate for Wave R4) [services/retrieval-config-service.js]
- [x] [Review][Patch] PUT is an unguarded read-modify-write — concurrent stewards lose updates, duplicate revisions; add rev-precondition retry [services/retrieval-config-service.js]
- [x] [Review][Patch] No HTTP-layer route tests for GET/PUT retrieval-config + GET authz/graphs (403/400/200 paths) [__tests__/]
- [x] [Review][Patch] Tests pin a false projection invariant; misleading comment ("the query filters on… so every row carries them") [__tests__/authz-resolver-service.test.js]
- [x] [Review][Patch] Hand-rolled validatePatch — house convention is joi in validators/ [services/retrieval-config-service.js]
- [x] [Review][Patch] Plain-object throws (no stack) — throw Error with .code/.status [services/retrieval-config-service.js]
- [x] [Review][Patch] new Date().toISOString() — house rule is luxon [services/retrieval-config-service.js]
- [x] [Review][Patch] OKF_RETRIEVAL_* env vars missing from the root env template [env]
- [x] [Review][Patch] Audit details.before records EFFECTIVE config, not the stored row — include source + stored-before [services/retrieval-config-service.js]
- [x] [Review][Patch] ttl_seconds invites consumers to cache the authz decision past revocation — document the tradeoff [services/authz-resolver-service.js]
- [x] [Review][Patch] actorFrom duplicated; domains-map rationale undocumented [controllers/retrieval-config-controller.js + services/authz-resolver-service.js]
- [x] [Review][Patch] TTL expiry (≤30s) untested — fake-timer test [__tests__/retrieval-config-service.test.js]
- [x] [Review][Patch] version===ingested_version serving invariant unpinned — comment citing lifecycle-service.js:405-462 [__tests__/authz-resolver-service.test.js]
- [x] [Review][Patch] getDb comment claims "retry on failure" — no retry exists; fix comment [services/retrieval-config-service.js]
- [x] [Review][Patch] hybrid+zero-serving warning asymmetry is deliberate — document why [services/retrieval-config-service.js]
- [x] [Review][Defer] No reset path for the governed row (env shadowing after first PUT is per ADR D3 design; a reset control belongs to the 10.7 Studio card) — deferred, needs 10.7 UX decision
- [x] [Review][Defer] ADR D3's utility_gate/label_federation fields unstorable — Wave R4/R6 stories must extend LIMITS/allowed when those legs land — deferred, gated consumption legs
- [x] [Review][Defer] CHANGELOG + site configuration docs for the new endpoints — deferred, CHANGELOG lands with the MR/release flow; site docs are a 10.7 completion gate
