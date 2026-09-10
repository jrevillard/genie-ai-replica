# Status Report — `feat/okf-server`

**Date:** 2026-08-24
**Branch:** `feat/okf-server` (~40 commits ahead of `main`; 201 files changed, ~35.6k insertions)
**Initiative:** Agentic Enablement → OKF (Open Knowledge Framework) knowledge/grounding pillar
**Primary sources:** `prds/prd-okf-server-2026-07-15/`, `okf-course-correction-2026-08-13.md`, `docs/adr/okf-001…035`, `sprint-status-okf-server.yaml`, Dev Agent Records in `implementation-artifacts/2-*.md` and `4-8-*.md`

---

## 1. Scope of the Branch

The branch implements the **write side (and control plane) of the GENIE.AI OKF Server** — the open-source, sovereign, government-grade hosting/serving layer for Google's Open Knowledge Format v0.2. OKF v0.2 made organizational knowledge portable for AI agents (Markdown + YAML frontmatter with provenance, trust, and lifecycle as first-class fields) but deliberately stops at the *format*; every existing consumer is a local stdio tool or cloud-locked. GENIE's OKF Server closes that gap with multi-tenancy, RBAC, audit, PII governance, versioning, and data residency.

Product model: organizations split large corpora **by domain into multiple OKF repositories**; each repo is hosted, curated, versioned, and access-controlled; RAG answers are grounded in the free-form corpus **plus every authorized OKF repository** via unified multi-graph retrieval.

What this branch delivers:

- **New `okf-server` component** (`components/okf-server/`, Node/Express, port 3002) — repo registry CRUD, OKF v0.2 parser, conformance validation, PII gating, write-side ingest orchestration, ingestion worker, version minting, repository clone, bundle manifest + author graph, tier-1 discovery.
- **New `pii-service` sidecar** (`components/pii-service/`, Python/FastAPI/Presidio, port 8000, internal-only).
- **Dataprep (OPEA overlay) extensions** — per-request `graph_name`, content-only chunking for OKF concepts, ACL-label preservation, OKF concept-status callback, per-repo graph collection provisioning.
- **Document-repository extensions** — bundle zip ingest route, `okf-service` role grants, bundle/repo_id metadata.
- **Control plane in ArangoDB** — 6 meta-collections + one named graph per repository.
- **Auth** — Keycloak scopes `okf:{tenant}:{repo}:{read|admin}`, service accounts, default-deny middleware.
- **Live smoke harness** (`data/okf/smoke-test/`) with 16 hard success criteria.
- **35 ADRs** (`docs/adr/okf-001…035`), CI wiring, docker-compose services, deployment scripts.

Explicitly **not** on this branch (design exists, code does not): the retriever/Graph Router/cross-graph RRF read path (ADR-012/023/024/027 — Epic 1, gated on OPEA 1.5), the OKF Studio UI (Epic 3, stories ready-for-dev), and the AI producer/crawler→repo pipeline (Epic 7, backlog). The web crawler itself already exists in doc-repo (`src/utils/crawler.js` + `src/workers/crawlWorker.js`) but has no OKF hook.

## 2. Layers Addressed

| Layer | Change on this branch |
|---|---|
| **Application (Node)** | NEW `okf-server` (orchestrator, worker, auth, versions, manifest, discovery, clone); `gov-chat-backend` minor (split-URL OIDC issuer alias); `document-repository` extended (bundle ingest, roles, metadata) |
| **AI (Python/OPEA)** | `dataprep` — `graphName`/`bundleVersion`/`conceptId` on ingest+retract payloads, OKF-aware loader, ACL `t:/r:/d:` label preservation, ingestion-log mirroring to bundle zip; `core/genieai_api_protocol.py` version-pinning fields |
| **Data (ArangoDB)** | 6 control-plane collections (`okf_repositories`, `okf_concepts_meta`, `okf_audit`, `okf_sources`, `okf_versions`, `okf_bundle_manifest`) + per-repo named graphs `OKF_{repo_id}` (`_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO` + BM25 view) |
| **Security** | New pii-service sidecar (fail-closed precheck); Keycloak scope model + service accounts; secret-guarded internal callback (`OKF_INTERNAL_SECRET`); sovereignty fail-closed LLM egress gate (ADR-020) |
| **Platform/CI** | docker-compose services for okf-server + pii-service; `.gitlab-ci.yml` build/lint/test/scan/promote jobs; env vars (+45); cloud redeploy scripts |
| **Frontend** | None yet (Studio UI is Epic 3, ready-for-dev) |

## 3. Architecture and Cross-Component Impact

### Write path (implemented)

1. Admin uploads a bundle ZIP via doc-repo (`is_bundle=true`, `repo_id`, status `Pending`) — the **only** doc-repo file artifact (WP-C content-only chunking).
2. `POST /api/okf/repos/:repo_id/ingest` (okf-server `ingest-service`, ADR-021): unzip (25 MiB zip-bomb cap, ≤200 concepts) → per concept: parse frontmatter (4a) → meta upsert with orchestrator-injected ACL labels (4b — the orchestrator is the **sole ACL injector**, fixing the G4 silently-dropped-labels defect) → conformance patch (4c) → PII scan via sidecar, fail-closed (4d) → content-hash dedup (4e) → meta row left at `index_status='parsed'` (4f) → **202 returned; never blocks on dataprep**.
3. `workers/ingestWorker.js` (15s poll, sequential — dataprep is single-flight): claims oldest `parsed` row, optional re-index retract, POSTs the concept markdown directly to dataprep with `graphName=OKF_{repo_id}`, `bundleVersion`, `conceptId`, ACL `fileLabels`. The meta rows themselves are the queue (no Redis).
4. Dataprep chunks/embeds/labels into the per-repo graph; on completion calls back `okf-server /api/okf/internal/concepts/:id/status` (shared secret) → `indexed|failed`, edge-service writes `_LINKS_TO` edges, bundle state machine settles (`Pending→Ingesting→Ingested|Ingestion Error`) → `okf_bundle_manifest` written + author-stated links mirrored with `source='author'` (parser edges get `source='parser'`; both carry `repo_id`; ADR-035).
5. `POST /repos/:id/versions` mints a monotonic `bundle_version` + immutable INSERT-only manifest into `okf_versions` — backing for citation pinning `(repo_id, bundle_version, concept_id)`.
6. Clone (Story 4.8): scoped-admin clones a curated fork → new repo_id + new `OKF_{new}` graph + `cloned_from` provenance; re-ingest isolation smoke-asserted.

### Read path (partially implemented)

Implemented: tier-1 **discovery** over `okf_bundle_manifest` (`POST /api/okf/repos/discovery`; lazy LLM-authored manifest summary via the ADR-020 model client) and version-pinned citation fields on chunks. Not implemented: Graph Router (ADR-024, ≤20ms budget, `MAX_FANOUT_GRAPHS`), authz resolver token→graph-set (6-1b), cross-graph RRF (ADR-027), and all retriever changes — `genie-ai-overlay/retriever/` is untouched. `rrf_fuse` unit tests exist (single-graph channel fusion) but cross-graph fusion is unbuilt.

### Runtime/deployment

`okf-server` and `pii-service` are internal-only Swarm services on `genieai_network`; okf-server shares the ArangoDB database with the graphs (ADR-018) via the shared `db-connection-service`. Auth: Keycloak OIDC with `okf:{tenant}:{repo}:{read|admin}` scopes, `tools-admin` super-role, `okf-service`/`dataprep-service` service accounts, and a non-Keycloak shared-secret hop (dataprep→okf-server). Note: `redeploy-cloud-full.sh` does not yet include the two new services, and cloud deploy fails closed until `okf_internal_secret` is added to the Ansible vault (intentional).

## 4. Key Design Decisions

1. **Independent Node component, not an OPEA service** (ADR-001/003) — okf-server sits behind Kong at `/api/okf`, mirrors `gov-chat-backend`'s `createApp()` pattern, calls dataprep over HTTP. Folding into the BFF was explicitly rejected.
2. **One repo = one bundle = one domain = one named graph** (ADR-014/002) — `OKF_{repo_id}` per-repo isolation in a shared ArangoDB.
3. **Write-side orchestration with no distributed transaction** (ADR-021, course correction G1/G9/G10/G11) — 202-first orchestrator + worker + sweeper compensation against per-concept `index_status`. Born from the 2026-08-13 course correction, which froze leaf stories after 36 gaps (6 P0) were found.
4. **Node parses frontmatter once** (ADR-022) — dataprep receives pre-stripped bodies so YAML never pollutes embeddings; structural edges written by the orchestrator, not dataprep.
5. **"Authorized ≠ relevant" graph selection** (ADR-024/025) — Graph Router + default-deny Authz Resolver; ACL labels and selection labels are two never-conflated roles; three bounded fan-out mechanisms (cap, semaphore, per-graph timeout).
6. **Two-level RRF** (ADR-027) — within-graph dense⊕BM25 fusion, then cross-graph RRF weighted per-graph; tuned via a parameter-sweep harness, not intuition.
7. **Lifecycle as an explicit state machine** (ADR-030) — auto gates register→validate→review, human gates review→approve→publish; single served rule (repo `published` AND concept ∈ {stable, deprecated}); `version` is not a state. Trust/staleness/provenance are advisory signals, not access control (ADR-017).
8. **Immutable version manifests + audit hash-chain** (ADR-031/029) — INSERT-only `okf_versions`, write-before-respond `okf_audit` with `prev_hash`.
9. **Bundle manifest + author graph + tiered fan-out** (ADR-035, latest) — Tier 1 discovery over manifests (O(repos)) → Tier 2 per-repo hybrid chunk retrieval → Tier 3 relational graph walk.
10. **Tiered, sovereignty-gated model inference** (ADR-020) — internal vLLM granite-4.1-8b default; frontier providers behind fail-closed `LLM_EXTERNAL_EGRESS_ENABLED=0`.
11. **Steward-gated AI producer** (ADR-019, design) — crawler dump → LLM-drafted concepts at `status=review`, never auto-published, untrusted-frontmatter hardening.
12. **OPEA `comps/agent` rejected** — custom LangChain Deep Agents on LangGraph instead; the 1.5 bump is overlay-only (see §6).

## 5. Status of the Work

### Done (with recorded evidence)

- **Epic 2 core:** 2-1 skeleton/deploy, 2-2 meta collections/CRUD, 2-3 parser, 2-4 conformance, 2-5 bundle ingest route, 2-6a ACL preserve fix (91 tests, pipeline #6102), 2-8 PII redaction/provenance. 2-7 Git/S3 sync deferred by decision (browser upload + crawler + manual instead).
- **Epic 2.9 orchestration trunk:** 2-9-1/2/3/4/6/7 done; 2-9-5 partial (zip intake, unzip, dedup live; atomicity/compensation review pass remains).
- **Epic 4:** **4-8 repository clone done** (2026-08-18; 3-layer review, 10 patches, live smoke r6 exit 0, 71 PASS). **4-8-amend WP-A/B/WP-C done** (2026-08-20: bad-file hard-gate, rooted named graph, content-only chunking; MR !278 pipeline #6270 **75/75 GREEN**).
- **Epic 6:** 6-1 authn/authz/RBAC incl. default-deny done.
- **B+C+E (ADR-035: bundle manifest + author graph + discovery): code complete, in review** — pipeline #6359 green, smoke v10 70/0, v11 71/2 (both assert defects fixed), **v12 confirmation was running as of 2026-08-23 and is not yet recorded as a full pass**; PRD/ADR course-correction via BMAD still pending.

### Test evidence (as recorded)

- okf-server Jest: **327/327**; overlay pytest: **107/107** (`test_dataprep.py` uncollectable on Windows due to `fcntl` — pre-existing, green in Linux CI); lint clean on touched files.

### Active threads / not yet committed

- **Uncommitted working tree** (review-fix pass): `concept-meta-service.js` (stale-summary flag; vLLM summary call fixed to static `VLLM_API_KEY` + `/v1` normalization — the old client-credentials dance 404'd silently), `edge-service.js`, `ingestWorker.js`, `run-smoke.js`, `genieai_dataprep_arangodb.py`; untracked `run-smoke-happy.js`, `HANDOFF-okf-bundle-graph-contentonly-2026-08-19.md`.
- **Smoke rework deferred:** legacy `file_id` sections (x, xii, xiii, ix — version-threading, edges, clone, retraction) still target the pre-WP-C path.
- **Small follow-ups:** mint should refresh the manifest; happy-path mint phase (4.8b) not wired.

### Backlog / not started

Epic 1 (multi-graph grounding — OPEA-1.5-gated), Epic 3 (Studio UI — six stories ready-for-dev), 2-6, 2-9-8/9, 4-1…4-7, 6-1b…6-5, Epics 5, 7 (producer), 8 (test infra), 9 (label onboarding), 10 (capstone). Notable deferred-work items: publish-mint lacks a PII/index-status gate (→4.3), `bundle_version` caller-forgeable at doc-repo, Trivy advisory-only vs the blocking NFR-S5 gate, Swarm cold-start 401 window, Ansible `env.j2` image-tag bug.

## 6. OPEA 1.5 Integration (Branch Strategy)

**Decision (2026-08-06, `OPEA-1.5-upgrade-analysis.md`):** retain the overlay clone-at-build, bump OPEA v1.3 → v1.5; do NOT adopt `comps/agent` (custom LangChain Deep Agents instead). All comps APIs GENIE depends on are byte-identical or additive; total bump effort ~3–5 engineer-days, RAG logic untouched. Hard parts: `core/constants.py` needs `MCPFuncType` + ServiceType renumbering (blocks build until fixed); `genieai_api_protocol.py` PositiveInt tightening (0-valued payloads now 422); 4 Dockerfiles still pin `v1.3`; dataprep dependency re-validation (docling 2.30→2.45, pyspark 4.0, sentence-transformers 5.1; keep `langchain-huggingface` 0.3.1) is the genuine risk.

**Branch/rebase plan (as documented):**

1. The bump is **MR !277 on `main`** — not yet merged; no bump branch code exists yet.
2. Sequencing is "step 0": merge !277 to main **first**, then **rebase `feat/okf-server` onto the bumped base**.
3. Standing directive (decision D24, sprint-change 2026-08-13): Epic 1 (multi-graph + `graph_name`), 2.9.6, and 1.0b are **gated** — no work until the bump merges; the ADR-023 fallback shim (serial fan-out on the current base) is contingency only.
4. **Conflict forecast:** no textual conflicts expected — OKF does not touch `constants.py`, Dockerfiles, or the retriever. The **semantic risk concentrates in `genieai_dataprep_arangodb.py`** (+398 lines, also dirty in the working tree): both the bump's dependency re-validation and OKF's content-only chunking rewrite land in the same file. Post-rebase: re-run the full OKF smoke harness against the bumped base and audit OKF payload additions in `genieai_api_protocol.py` for 0-valued fields.

## 7. Test Coverage Today

- **`run-smoke.js`** (live, in-container): 16 hard criteria — control plane (parse/conformance/PII/worker-race guard), 6.1 authz matrix over live HTTP, SAD + HAPPY zip ingest with exact counts, WP-C content-only assertions (zero per-concept file docs), worker drain via meta rows, graph split (`is_index` root, zero OKF chunks in default GRAPH), dedup on unchanged re-ingest, mint gates (sad refused / happy v1), per-concept retraction, repo delete (graph physically dropped), version threading (v2 mint, v1 manifest intact), clone isolation, ownership guard (`graph_name ≠ OKF_{repo_id}` → 400).
- **`run-smoke-happy.js`**: persisting happy-path mini-smoke for UI inspection (API-driven, ~50 min drain cap).
- **Jest:** 17 okf-server suites (327/327) + doc-repo suites incl. 766-line crawler unit tests.
- **pytest:** 107/107 — `test_dataprep.py` (28), `test_dataprep_graph_name.py` (15), `rrf_fuse` unit tests in `test_retriever.py`.
- **CI:** lint/test/config/build/scan/promote jobs for both new services; `OKF_INTERNAL_SECRET` wired. **No smoke job in CI** — manual only.

**Blind spot: the read side has zero live coverage** — no retrieval, no RAG query, no cross-graph fan-out, no crawler→repo end-to-end.

## 8. Tests Needed (per the "every story extends the smoke harness" rule)

### A. Crawler → OKF repository generation (Epic 7 / Story 3.7 landing)

Nothing today connects a real crawl to an OKF repository. Needed:

1. **Unit (Jest, okf-server — `producer-service`, ADR-019):**
   - `OKF_CRAWL_DUMP_v1` segmentation on `## Source:` blocks; emitted drafts must parse with the **real `parser-service`** (generator/parser anti-drift contract).
   - Drafts land `status=review`, `generated.by=agent:okf-producer`, trust `unverified`; server-side **trust-cap test** (publish gate cannot mint `verified` on machine-origin concepts without steward action).
   - **Prompt-injection hardening**: malicious crawled frontmatter/links overridden server-side; links constrained to the closed concept-ID namespace.
   - PII governance blocking on producer output incl. frontmatter; `produce-from-crawl` RBAC (tools-admin; 403 others).
2. **Unit (Jest, doc-repo):** 7.4b post-crawl trigger — `config.okf` read in the crawlWorker success block; producer failure never fails the crawl (job still `Succeeded`); absent config → no-op.
3. **Unit (Jest, frontend, Story 3.7):** segment switch, model-tier picker, Succeeded-gated companion action, wizard preload.
4. **Live smoke phase (extend `run-smoke.js`):** crawl a **fixture site** (local static server or recorded dump for hermeticity — never the live internet) → assert dump contract → `produce-from-crawl` → drafts at `review` in `okf_concepts_meta` → steward publish → concepts `indexed` in `OKF_{repo}` with `sources` provenance → mint v1.
5. **Quality eval harness:** curated Q/A fixture set over the kenya bundles + steward-rejection-rate guardrail (ADR-019 §7.5), CI-report mode.

### B. Multi-domain / multi-graph query tests (read side)

1. **Retriever (pytest):** fan-out across ≥2 `OKF_{repo}` graphs + default GRAPH; per-graph result attribution; **cross-graph RRF** (existing `rrf_fuse` tests cover single-graph channel fusion only); per-repo differing label filters; one-graph failure degrades gracefully.
2. **Cross-repo authz (live):** scoped read on repo A must never surface repo B chunks even when B ranks higher — extend the 6.1 authz matrix phase with a retrieval call per token class.
3. **Live smoke phase:** the ingest phase already leaves 2+ repos minted (sad, happy, clone) — issue retriever/ChatQnA queries and assert `concept_id`/`repo_id` provenance on every hit, clone-vs-source isolation at query time, default-graph corpus unaffected.
4. **Graph Router budget gate (ADR-024):** selection latency ≤20ms enforced in CI once Epic 1 lands.

### C. CI integration

- Add a scheduled/manual `smoke:okf` CI stage (deploy candidate images → mint tokens → run smoke in-container → JUnit output), mirroring the scheduled E2E pattern. Keep per-MR at jest/pytest; the ~50-min happy drain belongs to nightly/pre-release. Split a fast "control-plane + authz" profile (no drain) for MR pipelines.
- Shared Jest **contract test** for `ingest-bundle` on both the okf-server and doc-repo sides (prevents cross-service drift; today only okf-server side + live smoke cover it).
- Post-rebase, re-run the entire harness against the OPEA-1.5 base (§6).
- Author `docs/e2e-tests/epic-okf-*.md` phases following the existing phase conventions for (a) crawl→repo generation and (b) multi-graph retrieval/authz.

## 9. Immediate Next Steps

1. Land the in-flight review-fix pass (concept-meta stale-summary + vLLM summary-call fix) and confirm **smoke v12 full pass**; close B+C+E.
2. Run the BMAD PRD/ADR course-correction for the bundle-is-a-graph + tiered fan-out decisions (already marked in-progress).
3. Rework the four legacy `file_id` smoke sections (x, ix, xii, xiii) for the WP-C path.
4. Merge OPEA 1.5 bump MR !277 on main → **rebase this branch onto the bumped base** → re-run full smoke → ungate Epic 1 / 2.9-6 / 1.0b.
5. Add `okf-server`/`pii-service` to `redeploy-cloud-full.sh` and the Ansible vault (`okf_internal_secret`) when cloud-deploying.
6. Start Epic 3 Studio UI stories (six ready-for-dev) in parallel — they are ungated.
---

## ADDENDUM — 2026-08-25 cleanup pass (commit 469b13b, feat/okf-server)

All "Active threads" from §above are now CLOSED:

- **Smoke rework DONE**: legacy `file_id` sections fixed — (xii) parser-edge well-formedness keyed on label (file_id dropped: content-only edges key on concept identity); (xiii) prior-clone cleanup via `repositoryService.remove` cascade (filter-based registry purge — by-key REMOVE throws on the already-deleted entry); (ix) dead per-concept retract section REMOVED (no API exists post-WP-C; bad_concept has 0 chunks; lands with 4.3).
- **`run-smoke-happy.js` FINISHED + committed**: dedicated `smoke-happy` repo via real HTTP API; 4.8b mint v1 (manifest hash snapshot asserts), version-threading (modified re-ingest → bundle_version=1 chunks), mint v2 + list/immutability; CLEANUP none|only|full; fixed bind-var + repo_id bugs found in review.
- **mint → manifest refresh DONE**: `mintVersion` rewrites `okf_bundle_manifest` after the counter bump (idempotent, summary cache preserved, isolated non-fatal); D1 drain guard now ALSO checks meta rows at `index_status='parsed'` (the WP-C queue).
- **2-9-5 CLOSED (done)**: atomicity review — per-concept isolation + partial-202 ACCEPTED (documented in deferred-work.md); targeted fixes: `_reapStuckParsed` reaper (1h grace, env `OKF_INGEST_WORKER_REAP_GRACE_MS`), worker-error touch advances the claim queue (no head-of-line starvation), `last_ingest_summary` on the repo doc + audit-row totals.
- Evidence: okf-server jest 334/334 (+7 tests), ESLint/Prettier clean; live smoke re-run on `C:\Dev\builds\main` (this doc's author session — final counts recorded in the story/sprint notes).

Remaining open items unchanged: 2-9-8, 2-9-9, Epic 3+ backlogs.
