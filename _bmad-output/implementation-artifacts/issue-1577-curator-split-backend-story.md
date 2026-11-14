# #1577 story 1 — the backend split operation (route, service, drain, audit)

**Status:** IN PROGRESS (2026-11-14) — story written before code; verification lands at the end.
**Spec:** `_bmad-output/specs/spec-okf-curator-split/SPEC.md` (+ `implementation-grounding.md`,
+ `stories.yaml` story 1). Security workflow per David's dispatch contract (2026-11-14): baseline
`/security-review` on the touched surfaces before changes; `/security-review` + `/code-review`
(high) on the diff after; every finding ends FIXED / FALSE-POSITIVE (justified) /
RISK-ACCEPTED (David only); coverage never decreases; CHANGELOG updated.
**Branch:** `feat/curator-split-backend`, off `origin/main` (`0b738d3d7`).
**Issue:** #1577 (the ceiling initiative's deferred half; CAP-1/2/4 + the drain constraint live
here; CAP-3's editor surface is story 2).

## The operation (one route, one service function)

**Route:** `POST /api/okf/repos/:repo_id/concepts/:concept_id/split` — `requireRepoScope
('repo_id', 'admin')`, same chain as the resplit route (`repos-routes.js:410`). New controller
`splitConcept` in repository-controller.js: `getById` + **`assertWritable`** pre-gate (draft
repos only — serving/restricted refuse per CAP-4), body `{}` (no options in the first cut —
the ceiling is the only target; non-goals exclude seam picking), audit record
`action: 'concept.split'` naming actor + repo + concept + part count (the `repo.resplit`
precedent at `:1771-1787`), response `200 { ok, concept_id, parts: [{concept_id, chars}],
created, updated }`.

**Service:** `splitConcept(repo_id, concept_id, opts)` in a NEW module
`services/concept-split-operation.js` (additive — `ingest-service.js` and `resplitRepo` are
untouched):

1. Load the meta row + body (the CAP-2 concept read path's own scope: the same
   fence/publication gates the concept GET applies). Missing → 404 `CONCEPT_NOT_FOUND`.
2. `ceiling = maxConceptDocChars()` (ONE ceiling authority). `splitConceptBody(body,
   ceiling)` — the ONLY engine (constraint: `segmentMarkdown` is never invoked).
   - **Unsplittable** → `ConceptTooLargeError` → **409 CONCEPT_TOO_LARGE** (the shared
     refusal naming size/ceiling/remedy), ZERO rows written (CAP-2).
   - **Single part** (the body already fits) → 400 `CONCEPT_WITHIN_CEILING` naming size +
     ceiling — an honest no-op, not a fake success.
3. **Part-count cap 200** (`MAX_SEGMENTS_PER_FILE` precedent): a split producing more is
   refused 400 `TOO_MANY_PARTS` naming the count — the curator needs a bigger ceiling or a
   smaller source, not a 500.
4. **Writes, in one batched pass:**
   - Part 1 UPDATEs the existing row in place: same `concept_id`, new body/content_hash,
     `index_status: 'parsed'` (hash changed → re-drains; the `:617-629` dedup yields because
     the hash moved), frontmatter/links/labels/sources PRESERVED.
   - Parts 2..N INSERT new rows cloned from part 1's meta: `concept_id`/`_key` from
     `partPath` (`-part-N` suffixes), title `"<original> — part N"`, `index_status:
     'parsed'`, born-right `graph_name` (the `[4b]` upsert pattern, `:545-553`), `sources[]`
     carried UNCHANGED (David's ruling), frontmatter/links/labels copied.
   - PII: each new row goes through the same scan the ingest path applies (per-fragment —
     the plan's stated cost); part 1's existing pii_state re-evaluated by the scan too.
5. **Result vocabulary:** `{ concept_id, parts: [{concept_id, chars}], created, updated,
   ceiling }` — no `resplit`-style repo summary (per-concept semantics are their own
   contract).

## Security posture carried into the design

From the baseline review (findings to be appended at the end of this file as they land):
bind-parameter discipline on every new query (the meta upsert already binds; no query-text
interpolation of concept_id/repo_id), `actorFrom(req)` used for AUDIT only (never an authz
input), no new URL composition (no doc-repo fetch in the split path — the body comes from the
meta row), no path handling (ids are validator-constrained strings; `partPath` is pure string
composition on an already-validated id).

## Test plan (TDD — red before green)

New `__tests__/concept-split-operation.test.js` (service + controller), plus a route pin in
`repos-routes.test.js`:

1. lossless: seeded over-ceiling concept with heading/paragraph structure → parts rejoin
   byte-for-byte (incl. CRLF), each part ≤ ceiling.
2. part-1 identity: same `concept_id`, hash changed, `index_status: 'parsed'`, graph_name
   unchanged; parts 2..N: `-part-N` ids, titles suffixed, `sources[]` identical, born-right
   stamps.
3. unsplittable single-line-over-ceiling → 409 shared refusal shape, ZERO rows written.
4. within-ceiling → 400 `CONCEPT_WITHIN_CEILING`, zero writes.
5. >200 parts → 400 `TOO_MANY_PARTS`, zero writes.
6. serving repo / restricted repo → 404 fence (same envelope as the concept GET); missing
   concept → 404.
7. audit record written with actor; admin scope enforced at the route (no-scope call never
   reaches the service).
8. PII scan runs per part (mock pii service asserts the calls).

## Acceptance

- All suites green: okf-server full suite ≥ 2313 + new pins; coverage never decreases.
- Smoke harness API leg: seed an over-ceiling concept → split → assert parts, rejoin,
  drain stamps; run live against the local build.
- `/security-review` + `/code-review` (high) on the diff: every finding dispositioned.
- eslint + prettier clean; `npm audit` run in okf-server + shared/lib.
- CHANGELOG updated; deploy to the local build BEFORE merge.

## Baseline findings (appended when the scan lands)

Baseline `/security-review` ran BEFORE any change was written (subagent, full
scoped surface: concept-splitter, concept-ceiling, concept-meta-service,
repository-controller, repos-routes, actorFrom paths). Results:

1. **HIGH — `resplitRepo` file_id IDOR** (confidence 9): the resplit route
   fetches caller-supplied `file_id`s from document-repository under the
   service credential with no repo↔file binding — any repo admin can pull
   any file's bytes into their own repo (file_ids are citizen-visible in
   `sources[]`, so no guessing needed). **Disposition: FILED-FOR-FIX →
   issue #1848.** Not fixable inside this story: the durable fix stamps
   `files.okf_repo_id` at conversion time and enforces it in the resplit
   pre-flight — its own change. **The new split operation takes NO file_id**
   (the body comes from the concept meta row), so it does not inherit the
   class.
2. **Clean** (explicitly examined, no findings): concept-splitter,
   concept-ceiling, concept-meta-service (binds repo_id throughout),
   controller gates (assertWritable + admin scope), routes (actorFrom reads
   the verified JWT only; okf-server reads no x-actor headers).
3. **Noted non-vuln nit**: resplit controller spreads `{...actorFrom(req)}`
   while the service reads `opts.actor` → inner audit actor always null.
   Surfaced in the MR description; ride-along fix NOT in scope here.

Post-change gates on the final diff (commit da2c5127d + the fix commit):

- **`/security-review` (re-run on the diff): NO FINDINGS.** Ten surfaces
  examined and clean: route scope chain (requireRepoScope admin bound to the
  repo_id param; read scope cannot reach), fence order (getById authz →
  assertWritable → service; refusals pre-write), AQL binding (firstExample +
  bound params; no interpolation), partPath/partConceptId composition (stored
  values, never filesystem), cross-repo isolation (every touch scoped by the
  authorized repo_id), actor handling (actorFrom feeds audit/log only), data
  exposure (answer + audit carry counts/ids, never bodies), alternate paths
  (only the controller consumes the service), secrets (none), smoke script
  (not shipped runtime; docker-cp'd, precedent run-smoke-ceiling).
- **`/code-review` (high): 8 findings — ALL DISPOSITIONED FIXED** in commit
  3d3d4a02a (off-by-one, already found by the live smoke) + the fix commit:
  1. mid-loop failure could permanently truncate the concept (part 1's
     overwrite ran FIRST) → FIXED: writes reordered parts 2..N then the
     part-1 overwrite LAST (one atomic final write); any failure rolls the
     created rows back (deleteConceptMeta) and rethrows SPLIT_WRITE_FAILED
     500 naming any orphan rows; the original is never truncated.
  2. silent overwrite of an unrelated `foo-part-N` row → FIXED: collision
     pre-check before any write → 409 PART_ID_CONFLICT naming the rows.
  3. part 1 inherited stale claim stamps (next_attempt_after,
     worker_claimed_at, ingest_attempts, reindex_retry, last_error) → FIXED:
     DRAIN_RESET patch on every upsert (the #1020 reset contract).
  4. 200 sequential PII scans in-request → FIXED: bounded pool (SCAN_POOL 4).
  5. actor contract mismatch (service logged opts.actor, controller passed
     actorFrom flat → log actor always null) → FIXED: controller passes
     `{ actor: actorFrom(req) }`; pinned in both test suites (the flat-shape
     route assertion was itself the bug class — updated).
  6. partConceptId (1-based) vs partPath (0-based) adjacent-call trap →
     FIXED: partConceptId is now ZERO-based like partPath; both called with
     the same loop index; unit suite pins id/path agreement.
  7. smoke CRLF blind spot in the rejoin → FIXED: the separator derives from
     the seeded body (same rule as the splitter).
  8. partPath imported from the heavy ingest-service re-export → FIXED:
     imported from concept-splitter (its home); ingest-service keeps its
     re-export for existing consumers.
  Suite after fixes: 2331/2331 (+16 over the story baseline: 3 new service
  pins — write order, collision, rollback — and the updated route pin).

npm audit (pre-existing, ZERO new dependencies added by this change):
okf-server 57 advisories (44 moderate, 12 high, 1 critical — transitive
`@opentelemetry/*` + `@grpc/grpc-js`); shared/lib 3 (1 moderate, 2 high).
`@grpc/grpc-js` has a non-breaking `npm audit fix`; most `@opentelemetry`
bumps are breaking majors. Dependency bumps are their own wave — surfaced
to David, not silently absorbed.
