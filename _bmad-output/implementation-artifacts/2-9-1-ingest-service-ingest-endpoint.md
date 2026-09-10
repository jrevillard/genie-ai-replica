---
baseline_commit: d4d3c569c
---
# Story 2.9.1: `ingestService` + `POST /api/okf/repos/:repo_id/ingest`

Status: done

Story key: `2-9-1-ingest-service-ingest-endpoint` | GitLab: #917 (`prd::okf-server`, `okf-server::epic-2.9`)
Epic: 2.9 (Write-side Orchestration — the trunk) | Branch: `feat/okf-server`
FRs: **FR-34** (async ingestion pipeline), FR-4, FR-5 (PII leg), FR-6, NFR-S4 (idempotent re-ingest), NFR-R2 | Gap: **G1 (P0)** | ADRs: okf-021 (write-path), okf-022 (Node→Python handoff), okf-025 (authz)

> **The G1 gap:** the OKF Server has a parser, a conformance service, a concepts-meta writer, and a PII scanner — but **no component sequences them**. The only ingest path is doc-repo's 2.5 route, which fire-and-forgets the WHOLE bundle at dataprep (racing the single-ingest 429 lock — proven live), with no parse/meta/conformance/PII at all. This story ships the **write-side orchestrator** (`services/ingest-service.js`) that owns the ADR-021 sequence end-to-end and the async 202 contract, making every downstream consumer (2.9.3–2.9.9, Epics 9/10) possible.

## Story

As a **steward**,
I want **to trigger an end-to-end ingest that runs parse → meta → conformance → PII → dedup → enqueue per concept and returns 202 immediately**,
so that **the HTTP call never blocks on dataprep, every concept is validated/scanned/deduped before indexing, and large repos don't time out**.

## Acceptance Criteria

1. **`services/ingest-service.js` (NEW)** — `ingestRepoConcepts(repo_id, inputs, actor)` executes the ADR-021 §2.3 per-concept sequence [4a–4f], for each concept **in order**:
   - **4a** `parserService.parseConcept(markdown, { repo_id, path })` (direct import — pure, no DB; `parser-service.js:200`)
   - **4b** `conceptMetaService.upsertConceptMeta(repo_id, parsed, { bundle_version })` — the FULL upsert (first-class fields, `index_status:'parsed'`, `pii_state:'unknown'` default; the writer's minimal-input patch-only semantics and pii_state/last_good_index_at protections apply automatically)
   - **4c** `conformanceService.validateConcept(parsed)` then `persistConformanceIssues(repo_id, concept_id, issues)` — ALWAYS after 4b (the 2.9.2 review-proven 4b→4c order; persist is patch-only, never clobbers)
   - **4d** `piiService.scanConcept(repo_id, concept_id, parsed.frontmatter, parsed.body)` — in-loop, fail-closed (sidecar down ⇒ `pii_state:'error'` ⇒ publish blocked; the ingest CONTINUES — an error state is a valid outcome, not a request failure)
   - **4e** **content-hash dedup**: after 4b, re-read the stored doc's `content_hash` + `index_status`; if the hash is UNCHANGED and `index_status === 'indexed'` ⇒ skip enqueue for that concept, count it as `skipped_dedup` (cannot fire until 2.9.4 writes `indexed` — implement the rule now; hash scope = sha256(body) as written by the 2.9.2 writer, pinned)
   - **4f** **enqueue**: store the concept body via doc-repo `POST /api/files/ingest-bundle` with `{ bundle: base64(concept .md), graph_name: OKF_{repo_id}, repo_id, originalFileName: '<concept_id>.md', labels: ACL_LABELS, defer_kick: true }` (see AC 4 for the flag; AC 6 for ACL labels) → the per-concept `files` doc lands at `dataprep.status='Pending'` for the 2.9.4 worker to drain. If the store call fails ⇒ per-concept `enqueue_errors[]`, other concepts proceed (isolation, FR-34).
   The function returns a summary: `{ repo_id, total, parsed, created, updated, skipped_dedup, pii: { clean, hit, error }, enqueued, enqueue_errors: [{concept_id, error}] }`.
2. **`POST /api/okf/repos/:repo_id/ingest`** (repos-routes.js, after the pii-scan route) — gate: `requireRepoScope('repo_id', 'admin')` (Story 6.1's middleware — supersedes the epic's "(tools-admin)"; tools-admin holders pass via the super-role). Controller pre-gate: `repoService.getById(repo_id, { authz: authzForService(req) })` — foreign/missing ⇒ **404** (anti-enumeration, mirrors piiScan at `repository-controller.js:149`). Body (Joi — mirror the pii-scan shapes exactly): **either** `{ concepts: [{ frontmatter?, body }] }` (explicit — 2.9.5 unzip and 7.2 producer call the SERVICE directly), **or** `{ file_ids: [...] }` / `{ discover: true }` — the repo's stored plain-`.md` docs fetched via `piiService.discoverRepoFiles` + `fetchFileBytes`. Resolves **202** with the AC-1 summary once every concept has completed 4a–4f (or its per-concept error). Malformed body ⇒ 400 `VALIDATION_ERROR`; repo 404 propagates.
3. **`defer_kick` flag on the doc-repo bundle route (additive)** — `POST /api/files/ingest-bundle` accepts `defer_kick: boolean` (default `false` = today's fire-and-forget). When `true`, the route stores + ClamAV-scans + creates the `files` doc at `Pending` and does **NOT** `setImmediate(_ingestFileById)` — the 2.9.4 worker owns draining. Without this, N concurrent per-concept kicks race dataprep's single-ingest 429 lock (proven live 2026-08-15: 4 of 5 kicks failed). Existing callers unchanged (default false). Doc-repo tests: default kicks, `defer_kick:true` does not.
4. **Service-account auth for okf-server → doc-repo (prereq fix)** — NEW `services/service-token.js`: mint a client-credentials bearer via `KEYCLOAK_URL` + `KC_OKF_SERVER_CLIENT_ID` (default `okf-server`) + `KC_OKF_SERVER_CLIENT_SECRET` (client + secret already provisioned by 6.1 in `genie-realm.yaml`), cached with expiry, used by an axios wrapper for ALL okf-server → doc-repo HTTP (`ingest-bundle`, `fetchFileBytes` at `pii-service.js:341` — which today sends NO auth and would 401 in production). Mirror the proven dataprep pattern (`genie-ai-overlay/dataprep/keycloak_service_account.py`). Compose: add the two env vars to the okf-server service (empty default ⇒ if unset, calls send no token and doc-repo 401s — log a loud one-time warning; the feature requires the env, same as dataprep's).
5. **`repo_id` stamp-mismatch fix (2.8 dead-discovery repair)** — doc-repo stamps `files.repo_id` (`metadataService.js:34`); okf-server's `discoverRepoFiles`/`getRepoDocumentReferences` query `okf_repo_id` (`pii-service.js:293,319`) — **zero hits against real data** (fixtures masked it). Change the okf-server queries to `repo_id` (the doc-repo field is the deployed truth; two files ever used `okf_repo_id`); update fixtures. Add a regression test that seeds a files doc with `repo_id` (as doc-repo writes it) and asserts discovery finds it.
6. **ACL-label injection (sole injector)** — the orchestrator derives `ACL_LABELS = ['t:<tenant>', 'r:<repo_id>', 'd:<domain>']` from the repo doc. **Tenant v1 = repo.domain** (the repo doc has no separate tenant field; both axes pinned to domain until 6.1b's resolver owns them — decision D-A). Labels are lowercase-prefixed, case-sensitive (dataprep pins this, `arangodb.py:89-96`), and dataprep skips the LLM labeler when ACL prefixes are present (2.6a) — so per-concept concepts carry ONLY ACL labels unless the caller supplied hierarchy labels, which are appended after the ACL set.
7. **`bundle_version` threading** — `bundle_version = repo.version ?? null` (the repo doc field). `mintVersion()` is 2.9.7; publish-only minting is out of scope (decision D-B). The value flows: 4b opts → meta doc → (future) chunks/edges.
8. **Idempotency (NFR-S4)** — re-running ingest with identical concepts: 4b updates (no duplicates — 2.9.2 writer), 4e skips already-`indexed` unchanged concepts, 4f creates a NEW Pending files doc per concept per run. Accepted v1 semantics: re-ingest before 2.9.4 duplicates Pending docs but not meta rows; 2.9.4's drain + the dedup rule absorb it. Document in the endpoint response (`enqueued` count) — no hidden dedup magic.
9. **MELT + audit** — `withSpan('okf.ingest.repo')` with per-stage attributes (`okf.ingest.parsed/conformance_issues/pii_state/enqueued`); counter `okf_ingest_operations_total` (operation: ingest, status: accepted|partial|error); `auditService.writeAudit({ action: 'repo.ingest', actor: sub string, repo_id, source_ip })` best-effort on 202 (before respond). No raw concept bodies in logs (NFR-P2 pattern).
10. **Standards + smoke (per the every-story rule)** — Jest: orchestrator unit tests (mocked services, full sequence order assertions: 4b before 4c — spy call order; dedup rule; ACL derivation; per-concept isolation), route tests in the repos-routes matrix style (authz gate, 404 foreign, 202 shape, body validation), doc-repo `defer_kick` tests, service-token tests (mocked token endpoint), discovery `repo_id` regression. ESLint/Prettier clean. **Extend `run-smoke.js`** with an ingest phase (minted tokens; small concept set incl. one unchanged-re-ingest): POST /ingest ⇒ 202 with the summary; assert per-concept meta rows (index_status parsed), pii states, files docs at `Pending` with `graph_name=OKF_{repo_id}` + ACL labels, and a second run's dedup-safe behavior; fix bugs until exit 0.

## Tasks / Subtasks

- [x] **T1 — `services/service-token.js`** (AC: 4): client-credentials mint + cache + axios wrapper; compose env (`KC_OKF_SERVER_CLIENT_ID/SECRET` on okf-server); wire `fetchFileBytes` through it. Tests.
- [x] **T2 — `repo_id` discovery fix** (AC: 5): `pii-service.js` queries `repo_id`; fixtures updated; regression test (seed as doc-repo writes).
- [x] **T3 — doc-repo `defer_kick`** (AC: 3): Joi + conditional kick in `bundleIngest`; tests (kick default / no-kick flag).
- [x] **T4 — `services/ingest-service.js`** (AC: 1,6,7,8,9): the sequence, ACL derivation, dedup rule, per-concept isolation, summary, MELT. Unit tests incl. 4b→4c call order + fail-closed PII continuation.
- [x] **T5 — Route + controller** (AC: 2): Joi bodies (concepts/file_ids/discover), requireRepoScope + getById pre-gate, 202 + summary, audit. Route-matrix tests.
- [x] **T6 — Smoke extension** (AC: 10): ingest phase + re-ingest; local-build run; fix until exit 0.
- [x] **T7 — Verify**: full okf-server + doc-repo suites; eslint/prettier; evidence in Dev Agent Record.

## Dev Notes

### The ADR-021 sequence as implemented (verified against code — file:line)

`[2]` resolve repo (`repository-service.getById:282` — authz-aware 404) → derive `graph_name=OKF_{repo_id}` + ACL labels + bundle_version → `[4 per concept]` 4a `parseConcept:200` → 4b `upsertConceptMeta:167` (FULL input) → 4c `validateConcept:49` + `persistConformanceIssues:131` (minimal patch) → 4d `scanConcept:121` (fail-closed, persists its own state) → 4e dedup (`content_hash:68-72` + `index_status`) → 4f enqueue (doc-repo bundle route, `defer_kick`) → `[202]`. Steps [5] worker drain / [6] sweeper / [7] lifecycle = 2.9.4/2.9.3/4.3 — **NOT this story** (see boundaries).

### Decisions (ambiguities from the artifact analysis, resolved)

- **D-A ACL tenant axis:** `t:` = `repo.domain` in v1 (no tenant field exists on repos; 6.1b's resolver owns per-axis derivation later). Both `t:`/`d:` carry domain until then — isolation is repo-scoped (`r:`) + domain-scoped (`d:`), which is what 6.1 enforces today.
- **D-B bundle_version:** thread `repo.version ?? null`; `mintVersion()` (2.9.7) replaces this when it lands. The orchestrator NEVER mints.
- **D-C unzip boundary:** the ENDPOINT accepts explicit `concepts[]` or already-stored `.md` docs — **no zip handling here**. 2.9.5 owns the zip contract and will call `ingestRepoConcepts` directly with unzipped concepts (the epic's "unzips the bundle" wording is satisfied by 2.9.5 → this service; orchestration ≠ format).
- **D-D enqueue primitive (pre-2.9.4):** the "queue" is ArangoDB state — per-concept `files` docs at `dataprep.status='Pending'` (what the 2.9.4 worker polls, `epics.md:380`). **No Redis in this story**: ADR-021:11's "crawl worker drains Redis Streams" misstates the code (it's ArangoDB polling, `crawlWorker.js:95-101`) — there is NO in-repo Streams precedent, no ioredis dep in okf-server, and a stream with no consumer is dead weight. 2.9.4 introduces Streams + DLQ + the ioredis dep if it still wants them (its AC says it polls `files` anyway).
- **D-E files-doc shape:** ONE `files` doc PER CONCEPT (the per-concept .md stored via the bundle route at enqueue), NOT one per bundle. Rationale: the 2.9.4 worker's contract is `_ingestFileById` per file (5.i) and retract/re-ingest are per-concept (FR-8); a bundle-level doc cannot carry per-concept statuses. The 2.5 route's whole-bundle upload remains for legacy/manual use.
- **D-F PII in-loop (4d synchronous, bounded):** healthy sidecar ≈ tens of ms/concept (live-measured: 6 concepts < 1s); fail-closed worst case ~30s/concept (10s × 3 retries) writes `pii_state:'error'` and CONTINUES — the request duration risk is accepted for v1's explicit-concept inputs (small N); document `OKF_INGEST_MAX_CONCEPTS` (default 200, 400 above) as the bound. Async-PII is the 2.9.4-era option if real bundles prove slow.
- **D-G index_status ownership:** 2.9.1 writes only `'parsed'` (via 4b). `indexed|failed` = 2.9.4's worker exclusively (epics 2.9.4 AC; the 2.9.2 story-file drift naming 2.9.1 as co-owner is corrected here).
- **D-H sole-caller pin:** the ORCHESTRATOR is the only OKF-path caller of doc-repo's bundle route (its storage leg, per the amended 2.5). The route stays available to human admins (Admin role) for manual uploads — both paths converge on the same files-doc shape.
- **D-I known-gated limitation (documented, not fixed here):** dataprep DROPS `graphName` (G5, `DocRepoIngestPayload:110-116` — pydantic discards it; verified live 2026-08-15). Chunks land in the default `GRAPH` until 2.9.6 (OPEA-bump-gated). The orchestrator stamps `graph_name` correctly on every files doc NOW so 2.9.6 needs zero orchestrator changes.

### Verified code anchors (read before coding)

- `services/parser-service.js:200` parseConcept (+ shape :237-251, links :112-143) — pure, direct import is its designed contract.
- `services/concept-meta-service.js:167` upsertContract — minimal vs full semantics :76-79/:130, pii_state protection :136-138, create-path race :201-217, exports contentHash/buildMetaDoc :225.
- `services/conformance-service.js:49/:131` — validate + persist (patch-only via the writer).
- `services/pii-service.js:121` scanConcept (persists its own state, fail-closed), `:196` assertPiiClean, `:315` discoverRepoFiles (FIX the field name — AC 5), `:341` fetchFileBytes (ADD auth — AC 4).
- `services/repository-service.js:282` getById authz gate (404 anti-enumeration — preserve EXACTLY), `:330` update (UPDATABLE_FIELDS — do NOT touch lifecycle here), no transition API exists (correctly out of scope).
- `middleware/require-scope.js:88` requireRepoScope — level keys only; `routes/repos-routes.js:18-27` route table (slot after pii-scan); `routes/okf-routes.js:13-14` inherited gates.
- doc-repo: `fileRoutes.js:772` bundle route + `fileController.js:1059-1124` (kick at :1103-1107 — the defer_kick conditional), `fileService.js:910-951` uploadBundle, `metadataService.js:33-40` stamps (`repo_id` + `dataprep.status='Pending'`).
- `db/collections.js:13` — NO new collection needed (files docs live in doc-repo's `files` collection, same ArangoDB, already read by pii-service).
- `config.js:15-17` DOCUMENT_REPOSITORY_URL default exists; compose env block `docker-compose.yaml:537-560` needs the two new token envs.
- Dataprep gotchas (context, not modified): single-flight 429 lock `microservice.py:146-158`; ACL preserve + labeler skip `arangodb.py:89-96,1185-1194`; status callback contract (`chunk_count` at payload ROOT, `arangodb.py:325-328`); retract default-graph divergence `microservice.py:292`.

### Test conventions

Orchestrator units: prologue-mock shared-lib (see `concept-meta-service.test.js:7-19`), `mocks/arango-mock.js`, service mocks with jest.fn + call-order spies (`expect(spyA).toHaveBeenCalledBefore(spyB)` or manual order capture — 4b→4c is the assertion). Route tests: `repos-routes.test.js` matrix style (`authScoped`, `authzAwareServiceMock`); the ingest tests mock `ingest-service` + `repository-service`, assert gate order (getById before ingest) and 202 shape. Doc-repo: `bundleIngest.test.js` patterns. Service-token: mock the token endpoint via axios mock.

### Inherited lessons (2.8/2.9.2/6.1 reviews)

Writer's 4b→4c order is security-critical (clobber) · pii_state never downgrades without a rescan · fail-closed PII means 'error' blocks publish but not ingest · ACL prefixes case-sensitive lowercase · MELT on every method + audit actor = sub string · per-concept isolation (one bad concept must not fail the request) · smoke asserts EVERYTHING it claims, exits non-zero otherwise · extend the smoke with this story's features (standing rule) · no Co-Authored-By.

### Scope boundary (do NOT build)

Worker/Streams/DLQ/sweeper (2.9.4) · zip contract/unzip (2.9.5) · `graph_name` dataprep wiring + retract fix (2.9.6, gated) · `_LINKS_TO` edges (2.9.3) · `mintVersion`/`okf_versions` (2.9.7) · lifecycle transitions (4.3/2.9.4) · Kong OIDC (ADR-003 leg) · any Redis dependency.

### References

- ADR-okf-021 (§2.3 sequence, D1/D2/D5/D6, 202 contract, idempotency), ADR-okf-22 (pre-parsed body handoff — the additive dataprep payload change lands with 2.9.4/2.9.6, NOT here: this story's enqueue keeps the existing whole-file contract).
- PRD FR-34 (`prd.md:185-191`), FR-4/5/6, NFR-S4/R2 · epics.md:358-362 (2.9.1), :376-380 (2.9.4 boundary), :382-386 (2.9.5 boundary) · course-correction §2.3 (:112-174), G1/G10/G11.
- Code anchors above; live evidence 2026-08-15 (429 race, zip rejection, single-file lifecycle).

## Dev Agent Record

### Agent Model Used

glm-5.3[1m] (dev-story, 2026-08-16)

### Debug Log References

- **Red-green per task:** service-token (module-absent → 5/5); discovery repo_id contract tests (1 fail pre-fix → 29/29); defer_kick (3 fails pre-fix → green); orchestrator (module-absent → 11/11 incl. 4b→4c invocation-order + ACL + dedup + isolation); route matrix (5 fails → green incl. the 403-route-layer vs 404-controller-layer split).
- **Suites:** okf-server 204/204 (12 suites), doc-repo 425/425 (20 suites), ESLint 0 errors, Prettier clean.
- **Live smoke (local build, exit 0):** full control-plane + Story 6.1 authz matrix + the NEW Story 2.9.1 ingest phase — scoped read caller 403; admin ingest 202 (total=2, enqueued=2, pii.clean=2); per-concept meta rows parsed+graph-stamped+conformance-persisted; 2 per-concept files docs at Pending with t:/r:/d: ACL labels + caller label + graph_name; re-ingest meta rows NOT duplicated (updated=2). **Two live-caught integration bugs fixed:** (1) the okf-server SA token was 403'd by doc-repo — mapRole collapsed okf-service to roles[0] (Offline_access); fixed with a verbatim mapping + the okf-service realm role provisioned on the client's service-account user (genie-realm.yaml, linked via serviceAccountClientId); (2) doc-repo's ingest-bundle validates repo_id:uuid() — the smoke's ingest repo id had to be a UUID (documented in the phase).

### Completion Notes List

- All 7 tasks complete; 10 ACs satisfied. Commits: 9e4ad615c (T1-T5 + smoke phase), a1a2aff16 (okf-service role), mapRole fix + smoke polish.
- The endpoint accepts concepts[]/file_ids[]/discover per D-C; zip arrives with 2.9.5 calling ingestRepoConcepts directly.
- Known gated limitation (D-I, live-confirmed): dataprep drops graphName (G5) — chunks land in default GRAPH until 2.9.6; every files doc is stamped graph_name=OKF_{repo} now so 2.9.6 needs zero orchestrator changes.

### Fix-Pass Execution (2026-08-16 — code-review patches + steward-directed scope expansion)

- **10/10 review patches applied** (commits `1f3e90fa1`, `d2cdc0c91`, `61aab3617`). Red first: the new review-fix tests against the pre-patch code = **27 failed / 62 passed** (exactly the findings); green after: **okf-server 239/239, doc-repo 426/426, overlay pytest 670/670** (10 new graph-wiring tests); ESLint/Prettier clean.
- **Scope pulled forward by steward directive (same day, D24 lifted — "!277 still an open draft; apply the bump later; it is what it is"):**
  - **2.9.5 zip intake** — `POST /ingest` accepts `{ zip: base64 }` (server-side adm-zip unzip, .md-only, junk filter, duplicate-entry rejection, entry cap, 25 MiB decompressed cap); `kenya-bundle.zip` fixture committed.
  - **2.9.6 graph wiring (G5)** — dataprep `DocRepoIngestPayload`/`DocRepoRetractPayload` gain `graphName` (absent → env default = legacy behavior), the ingest pass-through honors it, the retract fallback is UNIFIED (`GRAPH`, was the divergent `genie_graph` — wrong-graph retract = silent no-op), and the loader lazily creates the 4 `OKF_{repo_id}_*` collections on first ingest. doc-repo retract sends the file's `graph_name`; `/:fileId/ingest` + `/:fileId/retract` allow `okf-service` (the 2.9.4 worker's identity).
  - **Design addendum** `design-addendum-versioning-integrity-clone-2026-08-16.md` (D-V1 title/version-tag contract, D-V2 unique naming + registry, D-V3 input integrity, D-V4 re-crawl ⇒ new version, D-V5 clone & curate) + epics: Story 4.8 (clone) added, 2.9.7/4.5 annotated.
  - **!277 conflict review** (requested): the bump MR does NOT touch `genieai_dataprep_microservice.py`; its 6 hunks in `genieai_dataprep_arangodb.py` (DB-init/contextual defaults/comments) do not overlap the graph plumbing — safe to have proceeded; a small mechanical merge is expected when it lands.
- **Smoke iterations (honest history):** run 1 exit-masked by my `| tail` wrapper — ALL 2.9.1 product assertions green, but the 5-min user-token TTL < the ~10-min sequential drain → 10 authz 401s (drain file 6, re-ingest, matrix); run 2 `REAL_EXIT_CODE=1` — a stale hoisted service token (fixed: per-call `serviceToken()`) + unquoted hyphenated AQL collection name (fixed: backticks); **run 3 exit 0 — 28 PASS / 0 FAIL**; run 4 = final acceptance at `61aab3617` (adds the ownership-guard + title/bundle_version assertions).
- **Live evidence (runs 3–5, local build, full kenya bundle):** phase-start cleanup retracts+deletes prior artifacts; **zip ingest 202 (total=6, parsed=6, enqueued=6, pii.clean=6)**; meta rows carry **title + bundle_version=1** + index_status=parsed + graph_name=OKF_{repo} + bad_concept exactly 2 conformance issues; 6 per-concept files docs at Pending with `t:smoke`/`r:`/`d:` ACL + caller label + graph_name; **facility A** (existing single-doc facility): multipart upload 201 → files doc Pending with NO graph_name/repo_id → Ingested → 2 chunks in the DEFAULT `GRAPH_SOURCE`; **facility B**: all 6 zip concepts drained Ingested sequentially (service token, no 429) → **18 chunks in `OKF_99999999-…_SOURCE` — the per-repo graph is created** → **isolation: ZERO OKF chunks in the default GRAPH_SOURCE**; ownership guard rejects `graph_name ≠ OKF_{repo_id}` with 400. **Final acceptance runs (4–5): REAL_EXIT_CODE=0, 29 PASS, 0 FAIL**, with the named association printed live: `BUNDLE kenya-bundle.zip ("Government Services Knowledge Base", OKF v0.2, 6 concepts)` → `REPOSITORY "Kenya Government Services Knowledge Base (smoke)" version=1` → `GRAPH OKF_{repo_id}` + per-concept ASSOCIATION line (bundle → repo → graph → ACL labels).
- **Retraction (both levels, steward-directed 2026-08-16):** per-CONCEPT retraction (dataprep `retract_file` — surgical, untouched) live-VERIFIED: retracting bad_concept.md physically removed its 2 chunks from `OKF_{repo}_SOURCE` while the other 5 concepts kept theirs. Bundle-level: `retractRepoGraph` (the 2.2 stub's contract, wired into repo delete) — CASCADE drop via `DELETE _api/gharial/{graph}?dropCollections=true` (definition + all 4 member tables in one call; ArangoDB errorNum 1942 "must not drop collection while part of graph" live-verified — member tables cannot be dropped while a definition references them, hence the cascade), explicit orphan sweep after, registry-sourced graph name with a footgun guard (never the default GRAPH), meta rows + dangling files docs removed. **Run 8 (final): exit 0, 37 PASS, 0 FAIL, 0 OKF_* collections remaining in ArangoDB.** Honest iteration history: run 6 exit 1 (survivors assertion bug — data was correct), run 7 exit 1 (collection drops refused by 1942 while the definition existed — fixed to the cascade per steward direction), run 8 green.

### File List

Dev-complete (original):

- components/okf-server/services/ingest-service.js — NEW (the orchestrator)
- components/okf-server/services/service-token.js — NEW (client-credentials + authedAxios)
- components/okf-server/services/pii-service.js — fetchFileBytes via authedAxios; discovery queries repo_id (2.8 dead-discovery fix)
- components/okf-server/controllers/repository-controller.js — ingestRepo controller
- components/okf-server/routes/repos-routes.js — POST /:repo_id/ingest (requireRepoScope admin)
- components/okf-server/__tests__/service-token.test.js, ingest-service.test.js — NEW; repos-routes/pii-service tests extended
- components/document-repository/src/controllers/fileController.js — defer_kick
- components/document-repository/src/routes/fileRoutes.js — ingest-bundle allows okf-service
- components/document-repository/src/middlewares/keycloak-auth-middleware.js — mapRole okf-service verbatim
- components/document-repository/src/__tests__/routes/bundleIngest.test.js — defer_kick tests
- configs/keycloak/genie-realm.yaml — okf-service role + service-account-okf-server user
- docker-compose.yaml — KC_OKF_SERVER_CLIENT_ID/SECRET on okf-server
- data/okf/smoke-test/run-smoke.js — ingest phase; mint-tokens.mjs — committed (2.9.1 usage)

Fix-pass + scope-pull additions (2026-08-16):

- components/okf-server/services/ingest-service.js — gray-matter serialization, parse isolation, pre-read dedup, ACL strip, slug uniquify, 30s enqueue timeout, not_found, parsed/success, zip intake (zipToRawInputs: duplicate-entry + zip-bomb guards)
- components/okf-server/services/concept-meta-service.js — getConceptMeta (4e pre-read) + index_status indexed→parsed downgrade protection
- components/okf-server/services/service-token.js — 401 → cache reset + single retry
- components/okf-server/package.json — adm-zip dep
- genie-ai-overlay/dataprep/genieai_dataprep_microservice.py — graphName on ingest+retract payloads, unified GRAPH retract fallback
- genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py — _ensure_graph_collections (lazy per-repo collection creation)
- genie-ai-overlay/tests/test_dataprep_graph_name.py — NEW (10 tests)
- components/document-repository/src/routes/fileRoutes.js — okf-service on /:fileId/ingest + /:fileId/retract
- components/document-repository/src/controllers/fileController.js — retract carries the file's graph_name
- components/document-repository/src/__tests__/integration/fileRoutes.test.js — retract graphName contract tests
- data/okf/smoke-test/kenya-bundle.zip — NEW fixture; run-smoke.js — dual-facility rewrite (authz first, service-token drains, zip ingest, per-repo graph + isolation + ownership-guard + title/bundle_version assertions)
- _bmad-output/planning-artifacts/prds/prd-okf-server-2026-07-15/design-addendum-versioning-integrity-clone-2026-08-16.md — NEW; epics.md — Story 4.8 (clone) + 2.9.7/4.5 annotations

### Review Findings (2026-08-16, 3-layer adversarial review + live full-bundle smoke)

> LIVE-CONFIRMED by the full-bundle smoke run: findings 1, 2, 7 fired on the real kenya bundle (bad_concept.md's colon-containing description produced PARSE_ERROR 400 mid-batch with partial writes). Fix ALL of the following, then re-run the FULL-BUNDLE smoke until exit 0 (see data/okf/smoke-test/run-smoke.js ingestPhase — already rewritten for the full bundle; it FAILS today for exactly these findings).

- [x] [Review][Patch] CRITICAL markdownFor YAML corruption (live-confirmed): replace the hand-rolled serializer with gray-matter's matter.stringify(body, frontmatter) — js-yaml handles quotes/colons/newlines/types. Affects both 4a parse input and the 4f enqueued .md [ingest-service.js markdownFor]
- [x] [Review][Patch] CRITICAL 4a parse not isolated: wrap parseConcept in try/catch -> enqueue_errors {stage:'parse'}, continue; the request stays 202 with per-concept errors (AC-2 contract) [ingest-service.js ~line 164]
- [x] [Review][Patch] HIGH 4e dedup dead + tautological + index_status downgrade: (a) orchestrator reads the PRE-upsert meta doc (add a getConceptMeta read or firstExample before 4b) and dedups on THAT content_hash + index_status; (b) writer protects index_status on full update exactly like pii_state (never downgrade indexed->parsed) [ingest-service.js 4e, concept-meta-service.js applyUpdate]
- [x] [Review][Patch] HIGH ACL-label injection: filter caller labels matching /^t:|^r:|^d:/i (strip + warn log) before appending — sole-injector invariant [ingest-service.js callerLabels]
- [x] [Review][Patch] MAJOR slugify collisions: in-batch duplicate detection; when slug empty (non-Latin) or colliding, suffix '-' + contentHash(body).slice(0,8) [ingest-service.js normalizeInputs/slugify]
- [x] [Review][Patch] MAJOR no enqueue timeout: authedAxios.post(..., {timeout: 30000}) in 4f; cap total request risk [ingest-service.js 4f]
- [x] [Review][Patch] MAJOR file_ids/discover silent drops: reconcile requested vs found -> summary.not_found[]; empty-body concepts rejected 400 at the route [ingest-service.js, repository-controller.js]
- [x] [Review][Patch] MAJOR stored-file branch incomplete shape: DELETE the raw.concept_id skip-branch (dead code per auditor) — ALWAYS parseConcept(markdownFor(raw)); discovery's frontmatter:{} then derives correctly [ingest-service.js ~161]
- [x] [Review][Patch] MINOR summary.parsed counter; NaN cap -> safe parse helper shared by controller+service; success=false when all enqueues failed (metric status 'error'); token 401 -> reset cache + retry once; discover === true strict check [ingest-service.js, repository-controller.js, service-token.js]
- [x] [Review][Patch] SMOKE re-run safety (live-proven accumulation): phase START must retract+delete prior INGEST_REPO files docs (doc-repo POST /api/files/:id/retract then DELETE, admin token) and remove prior okf_concepts_meta rows for the repo; also assert t:smoke + graph_name on files docs; note: drain via POST /api/files/:id/ingest works (proven: 4/4 Ingested sequentially) [run-smoke.js ingestPhase]
- [x] [Review][Defer] mapRole dual-role precedence, double repo fetch, swagger doc wording, audit outcome fields — logged to deferred-work.md
