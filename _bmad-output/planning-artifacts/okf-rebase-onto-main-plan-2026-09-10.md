# Rebase Plan — feat/okf-server onto main (OPEA 1.5 + security wave)

- **Date**: 2026-09-10 · **Branch**: `feat/okf-server` @ `5c7082a9d` · **Target**: `origin/main` @ `ba8aeb1b8`
- **Merge-base**: `58e726332` → **branch is 303 commits ahead, main is 90 commits ahead**
- **Trigger**: MR **!278 already reports `has_conflicts: true`** — the MR is blocked today. This rebase is a prerequisite, not hygiene.

## 1. What main absorbed since the branch base (90 commits, 932 files)

| Wave | Commit anchors | Relevance to us |
|---|---|---|
| **OPEA 1.5 bump** (!277, merged `1f2f9e18a`, initiative archived `c73cae03d`) | 57 overlay files: dataprep (arangodb/microservice/utils/requirements), chatqna, reranker, `core/genieai_api_protocol.py`, `pyproject.toml`, **new `contracts/` test suite (11 files)** | The **hard gate for Epic 1 + Story 2.6 clears** — fan-out and dataprep `graph_name`-from-request become buildable on this branch after the rebase |
| **Q3-2026 security/CVE wave** | `8f0c41511` (dep CVEs incl. frontend `package.json` bumps + overrides), `42f30dfb6` (least-privilege `cap_add` on **all 37 services** in compose), `afd584adb` (**crawler SSRF hardening**), backend/frontend/docker fixes | Intersects our crawler→OKF path, our compose `okf-server` service, our frontend deps |
| **CI wave** | `4091bc6ac` (all component test jobs on every MR), `5d702e583` (FORCE_IMAGE_REBUILD), SAST excludes, container-scanning fix | Our 237-line CI additions (okf-server jobs) must union with theirs |
| **Dataprep/ansible fixes** | `de9dc6686`/`432857e3f` (obsolete VLLM env dropped), `aad211ffa` (GPU OCR via `NVIDIA_VISIBLE_DEVICES`), ansible SSL/runner pins | Ansible templates we extended (`env.j2`, `vars.yml`) auto-merge; semantic review needed |
| Release/docs | v2.1.0 changelog, presentation/site assets | None |

## 2. Conflict analysis (authoritative `git merge-tree --write-tree` dry run)

Only **15 files** changed on both sides (932 main vs 342 branch); **8 actually conflict** — everything else auto-merges (incl. `docker-compose.yaml`, `env`, `CLAUDE.md`, `core/genieai_api_protocol.py`).

| # | File | Ours | Theirs | Nature + remediation |
|---|---|---|---|---|
| 1 | `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` | **+627/−63** (born-right graph naming, repoId identity, graph keys, label preserve) | +61/−20 (bump: import-time `ARANGO_DB_NAME` monkeypatch → `_initialize_client()` subclass override; contextual-retrieval default **false→true** BREAKING) | **The one delicate merge.** Take main's new header/client structure as base; re-apply our born-right deltas (different functions — semantically independent). Verify `_initialize_client` + `workingGraphName` coexist; re-run born-right assertions |
| 2 | `genie-ai-overlay/tests/test_dataprep.py` | +452/−0 (born-right tests) | +165/−0 (bump tests) | Additive union at the conflict hunks; both suites must pass |
| 3 | `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py` | +92/−13 (DATAPREP_INGEST_CONCURRENCY slot pool) | +1/−1 (retract default `genie_graph`→`GRAPH` — the §8.7 latent-bug fix) | Trivial: keep both |
| 4 | `.gitlab-ci.yml` | +237/−24 (okf-server jobs, test wiring) | +587/−115 (run-all-components-on-MR, SAST excludes, FORCE_IMAGE_REBUILD, scanning) | Take **theirs** as base, re-insert our okf-server job blocks; confirm component job gating still matches the new rules-changes |
| 5 | `components/gov-chat-frontend/package.json` | +8/−2 (Studio/editor deps: `cytoscape*`, `gray-matter`, `highlight.js`, `markdown-it*`) | +7/−2 (CVE bumps `dompurify 3.4.13`, `uuid ^11.1.1` + overrides `postcss/serialize-javascript/fast-uri/js-yaml/brace-expansion`) | **Union of both** dep sets + overrides; regen lock via `npm install`; build check |
| 6 | `components/gov-chat-frontend/package-lock.json` | (derived) | (derived) | Discard both, regenerate after #5 |
| 7 | `components/document-repository/src/services/metadataService.js` | +13/−3 (born-right doc names) | +7/−10 (hardening/file-type override) | Both small — manual merge of both intents |
| 8 | `_bmad-output/implementation-artifacts/deferred-work.md` | +46/−0 | +1970/−416 (major rewrite) | Doc: take theirs, re-append our items if still relevant |

**Rebase-vs-replay warning:** the dry run simulates one 3-way merge (end states). A *literal* `git rebase origin/main` replays **303 commits** — the 4 hot files above are touched by dozens of branch commits each, so conflicts would recur across many replays. Recommended execution (below) collapses this to **one conflict pass**.

## 2a. Legacy Code Ownership Rule (David, 2026-09-10: "we need main's version of the legacy code")

**Main owns the legacy paths** — file-based ingestion into `GRAPH` and single-graph legacy retrieval. Resolution law for every file:

| File | Post-rebase state | Enforcement |
|---|---|---|
| `retriever/`, `chatqna/`, `reranker/` | **Byte-identical to `origin/main`** — this branch never touched them (verified: `git diff 58e726332..HEAD` on those trees is empty; main's retriever delta is a pure refactor of the AQL filter-clause into `_build_aql_filter_clause`, clause strings verbatim) | `git diff origin/main..feat/okf-server -- genie-ai-overlay/retriever genie-ai-overlay/chatqna genie-ai-overlay/reranker` **must be empty** before push |
| `dataprep/` | Main's version + branch deltas **provably no-op for legacy inputs** (ADR-okf-039 D8 proofs: no `repo_id` + `GRAPH` not `OKF_*` → identity falls through to null; `_is_concept_id` rejects numeric legacy file_ids → no mirroring; no ACL prefixes → preserve is a no-op; slot pool default 1 = historical single-flight) | `git diff origin/main..feat/okf-server -- genie-ai-overlay/dataprep` reviewed hunk-by-hunk against the D8 no-op table |
| doc-repo `metadataService.js` | Main's version + additive null-default fields (`graph_name`/`repo_id`/`bundle_version` — null for legacy files) | Legacy files doc shape unchanged |

`legacy` mode (ADR-okf-039 D1/D2) is the permanent first-class retrieval posture: default, skips router + fan-out machinery, **must be configurable at runtime forever** — fan-out code landing later cannot change this contract (CI-asserted byte-identical legacy behavior).

## 4a. Legacy Path Preservation Protocol (golden parity)

1. **Pre-rebase golden capture (T0.5, on the current build):** ingest ONE fixed legacy test file via doc-repo (→ `GRAPH`), then capture: (a) the `_SOURCE` chunk docs' key-set + `chunk_labels` shape + graph name, (b) a fixed-seed single-graph retriever response (result ids + scores) for one query, (c) one chatqna end-to-end answer. Persist as `data/okf/smoke-test/legacy-golden-pre-rebase.json` + the test file id.
2. **Post-rebase replay (T3):** re-run the identical steps on the rebased build; structural diff against the golden. **Pass = chunk schema identical; retrieval returns the same result-id set (score jitter tolerated, ranking order preserved); chat answers with citations.**
3. **In-container asserts (T3):** `python -c "import comps.dataprep.src.integrations.arangodb as m; assert hasattr(m,'VLLM_MODEL_ID')"`; `_initialize_client` targets `ARANGO_DB` (genie-ai); legacy ingest into `GRAPH` produces zero okf-server mirror/callback calls (absence asserted in the dataprep contract test).
4. **New regression test (ships with the rebase):** a dataprep legacy-ingest contract test — ingest request WITHOUT `repo_id`/`concept_id`/ACL labels → asserts graph untouched (`GRAPH`), no bundle-log POST, chunk doc shape canonical. This locks the D8 no-op proofs into pytest so future branches cannot silently regress them.

## 3. Execution plan (recommended: squash-rebase — literal rebase, single conflict pass)

> No descendant branches exist (`git branch -r --contains HEAD` = only `origin/feat/okf-server`), so rewriting branch history is safe. Merge-in alternative noted at §3b.

1. **Commit the pending delta first** (23 uncommitted files: scan-free PII actions, whole-file controls, files(repo_id) index + bootstrap, tests, today's option-(d) planning docs). Lint + full local jest before committing. Tag a safety ref: `git tag backup/okf-server-pre-rebase`.
2. **Build the squashed representation**:
   ```bash
   git checkout -b okf-rebase 58e726332          # old base
   git merge --squash feat/okf-server            # stage the ENTIRE branch delta
   git commit -m "feat(okf): OKF pillar — server, Studio, PII compliance (squash for rebase)"
   git rebase origin/main                        # ONE replay → exactly the 8 conflicts
   ```
3. **Resolve the 8 conflicts** per §2 (dataprep arangodb gets the deep review; enable `git config rerere.enabled true` first as seatbelt).
4. **Fast-forward the pillar branch to the rebased state** and force-push:
   ```bash
   git branch -f feat/okf-server okf-rebase && git checkout feat/okf-server
   git push --force-with-lease origin feat/okf-server
   ```
   (The 303-commit granularity survives in `backup/okf-server-pre-rebase` + GitLab MR history. If David prefers preserving granular history, use §3b.)
5. **MR !278** re-checks; conflicts flag clears.

**§3b Alternative (no history rewrite): `git merge origin/main` into feat/okf-server** — one merge commit, same 8 conflicts, no force-push, MR updates normally. Technically a merge, not a rebase; identical conflict surface; zero risk to pushed history. Choose this if the 303-commit history must stay on the branch.

## 4. Semantic (non-conflict) risks to verify after the merge

| Risk | Where | Check |
|---|---|---|
| **Contextual Retrieval now default ON** (bump breaking change) | dataprep | Ingest drains make ~1 extra vLLM call/chunk — slower drains; smoke expectations + timing updated; `CONTEXTUAL_RETRIEVAL_ENABLED=false` is the emergency off-switch (also the smoke fallback while #993 vLLM crash-loops) |
| **Compose least-privilege `cap_add` on all 37 services** | docker-compose.yaml (auto-merged) | Our `okf-server`/frontend/okf services must still start under hardened caps — full `compose up` boot check |
| **Crawler SSRF hardening** | doc-repo crawler | Our crawl→OKF sources still fetch (localhost/allowlist rules) — conversion smoke |
| **doc-repo file-type 21 ESM + Jest `--experimental-vm-modules`** | doc-repo tests | Our doc-repo test additions run under the new runner config |
| **`_initialize_client` DB-selection override** replaces the monkeypatch | dataprep | Our born-right code must not re-add/depend on `_parent_mod.ARANGO_DB_NAME` mutation — grep post-merge |
| **Auto-merged ansible templates** (VLLM env drops, SSL ownership) | `deploy/ansible/` | Read the merged `env.j2`/`vars.yml` diff once — semantics, not syntax |
| **New `contracts/` overlay test suite** (main) | genie-ai-overlay | Post-rebase pytest = our `test_dataprep` changes **+** their contract suite — run the whole thing |
| **CI reds pre-date the rebase** (pipelines 2311/2312/2427 failed Sep 8–9 — the runner coordinator-403 artifact-upload issue) | .gitlab-ci | CI is **not** a trustworthy gate until that's fixed; local suites are the gate; track the 403 fix separately |

## 5. Timeline

| Phase | Effort | When |
|---|---|---|
| T0 — commit pending work + safety tag | ~30 min | Immediately (today) |
| T1 — squash-rebase + 8 conflict resolutions | 1–2 h | Same session |
| T2 — static gates: lint/format + jest (backend, frontend, doc-repo, okf-server) + pytest (overlay incl. contracts) + ruff | 2–3 h (mostly machine time) | Same day |
| T3 — build + boot + smoke (§6 phases 1–4) | 2–4 h | Same/next day — LLM-dependent legs scheduled against vLLM health (#993); fallback config flag documented |
| T4 — force-push, MR re-check, comms | ~30 min | After T3 green |

**Total ≈ 1–1.5 working days**, T3 the long pole only if the remote LLM is down.

## 6. Smoke test plan (post-rebase validation)

**Phase 0 — Static (no infra)**: `node --check` on all touched JS; `npm run lint` + `format:check` (frontend, backend, doc-repo, okf-server via `rtk proxy` for real results); `ruff check` overlay; full jest suites (okf-server 591+, frontend 73+, backend, doc-repo); full overlay pytest (incl. new `contracts/`).

**Phase 1 — Build & boot (local build, `C:\Dev\builds\main`)**: `docker compose build okf-server frontend backend doc-repo dataprep` (dataprep **must** rebuild — Python changed) + `up -d`; all containers healthy (beware the ClamWin-AV mass-exit gotcha before diagnosing).

**Phase 2 — OKF lifecycle smoke (extend the existing `run-smoke-lifecycle.js` harness with rebase assertions)**:
1. Create → import → curate → publish → ingest → drain → **serving graph born-right named `OKF_<slug>_vN`** (rename/promote logic intact after the bump's dataprep restructure).
2. **Author-spine assert**: `source='author'` edges + concept-root vertices present in the serving graph (spine survives the bumped writer paths).
3. **ACL assert (2.6a regression — the critical one)**: `chunk_labels` carry `t:`/`r:`/`d:` prefixes on chunks produced by the **bumped** dataprep `_finalize_chunk_labels`.
4. `SOURCE.concept_id` present + indexed; PII scan → remediate/accept → save; editor PATCH; mint version; clone.
5. Drain completes with contextual-retrieval ON (or flag-off fallback) — timing recorded.

**Phase 3 — Legacy parity (the acceptance gate for "legacy NOT impacted")**: the full §4a protocol — golden replay of legacy file ingest (`GRAPH` chunk schema + labels identical to the pre-rebase capture), fixed-seed single-graph retrieval (same result-id set, preserved ranking), one chatqna end-to-end with citations, plus the empty-diff assertion (retriever/chatqna/reranker ≡ main) and the in-container asserts. *Pass = byte-level schema parity + behavioral parity on the golden + `legacy` mode selectable and byte-identical.*

**Phase 4 — Cross-service**: crawl→OKF conversion on an SSRF-allowlisted source; doc-repo upload → bundle zip export; Admin Studio tab renders (new deps installed); Logs action.

**Phase 5 — Observability sanity**: ingest emits OTel spans post-bump (dataprep span taxonomy intact); Grafana sees the flow (optional but cheap).

**Gate**: Phases 0–2 + 4 green = rebase validated (force-push); Phase 3 + full-drain leg of Phase 2 may be gated on vLLM (#993) health with the flag-off fallback, and re-run at full config before MR merge.

## 7. Optimal timing — verdict: **ASAP is correct**, sequenced as: commit pending → rebase today

Why now: (a) **MR !278 is blocked right now** (has_conflicts) — every day of drift widens the 90-commit gap; (b) the security wave is freshly merged and its intent is still current in reviewers' heads; (c) **no descendant branches** and no open dependents — force-push is free; (d) the GitLab maintenance window (ended 6 Sep) is over; (e) the next phase of the OKF plan (**Epic 1 retrieval + Story 2.6 dataprep legs + Story 1.7**) is **hard-gated on this base** — the rebase is the critical-path unblock.

Only sequencing caveat: commit the 23-file pending delta first, and run the LLM-dependent smoke legs when the vLLM endpoint is healthy (or with the documented flag fallback).

## 8. How this fits the existing work plan

1. **Initiative**: agentic-enablement, three pillars — OPEA 1.5 bump (**done on main**, archived), SST (!279, parallel), **OKF (this branch, MR !278 Draft)**. The rebase is the moment OKF stops being blocked-by and starts being built-on the bump.
2. **Done on this branch**: Epic 2/2.9 server + write-side (orchestrator, worker, versions, clone, born-right lifecycle E2E-proven 2026-09-01), Epic 3/10 Studio + editor + **PII compliance workflow** (scan-free actions, whole-file controls — the pending commit), curation spec + import-scope analysis.
3. **Open stage-1 defects**: D-A…D-L (#979–#990), crawl resilience (#991/#992) — all Node-side, **unaffected by the rebase** (okf-server/frontend only).
4. **Next after the rebase** (in order): Story 2.9.3b spine completion (#996, quick ungated) → stage-1 defect burn-down → import-scope **correct-course** phase (David's declared next phase) → **Epic 1 retrieval** now buildable (1.0/1.0b → 1.7 → 1.1–1.6, with Story 8.1 fixtures as the validation substrate) → Story 10.7 admin retrieval card.
5. The rebase **unblocks**: Epic 1 (all stories), Story 2.6 gated dataprep legs, Story 1.7's ChatQnA consumption leg.

## Annex A — Conflict hunks verbatim + exact resolutions (from `git merge-tree` blob `7147c95f3`)

### A1. `genieai_dataprep_arangodb.py` — exactly ONE conflict hunk (lines 397–533 of the conflicted blob)

Both sides **inserted different methods at the same anchor** (after `_log_environment_variables()`):

- **OURS (97 lines)**: `_concept_file_name()` + `_bundle_log_url()` + `_is_concept_id()` — the ingestion-log mirroring helpers (parallel-ingest ctx + P1a positive-only caching).
- **THEIRS (39 lines)**: `_initialize_client()` — the bump's subclass DB-selection override (`ARANGO_DB` → `genie-ai`), replacing the import-time monkeypatch.

**Resolution: KEEP BOTH** (theirs first, ours after) — pure insertions, zero semantic overlap. **Plus one hunk the dry run does NOT flag** (coupled semantically): delete the **top-of-file monkeypatch** (working-tree lines 37–40, `_parent_mod.ARANGO_DB_NAME = ...`) — theirs deleted it; the new `_initialize_client()` supersedes it; leaving both would make the module mutation dead code racing the override. **KEEP** the other `_parent_mod` usage (line ~529: `_initialize_llm` patches `_parent_mod.VLLM_MODEL_ID` — a different constant, untouched by the bump, still import-time-evaluated in the vendored parent).
**Post-merge assertion** (vendored-comps risk): in the rebuilt dataprep container, `python -c "import comps.dataprep.src.integrations.arangodb as m; assert hasattr(m, 'VLLM_MODEL_ID')"` — the OPEA 1.5 rebase repinned vendored comps; if the constant moved, our `_initialize_llm` patch target needs updating.

### A2. `.gitlab-ci.yml` — 3 hunks

1. **Lines 22–61 (variables block)**: ours = `OKF_INTERNAL_SECRET` + `DATAPREP_URL` CI variables; theirs = `SAST_EXCLUDED_PATHS` list. **KEEP BOTH** (insertion-vs-insertion).
2. **Lines 751–774 (container-scanning job)**: ours = Trivy `TRIVY_*` variables; theirs = **new natif `container_scanning` architecture** (`extends: container_scanning` + dynamic `CS_IMAGE` resolution). **TAKE THEIRS** — it supersedes the custom Trivy job our variables tuned (the `TRIVY_*` knobs die with the old job).
3. **Lines 840–890 (promote report rewrite)**: ours = the 2026-09-04 CONDITIONAL tolerate-missing-report guard (added while artifact downloads were broken — the runner 403 infra issue); theirs = **hard-fail on missing scan report + SBOM rewrite** (NFR-S1 supply-chain integrity). **TAKE THEIRS** — it is the intended end-state; our guard was an infra-workaround. Note: until the 403 infra issue is fixed, promote jobs will hard-fail on missing artifacts — accepted per David (infrastructure, out of scope).

### A3. `metadataService.js` — 1 hunk (lines 32–41)

Ours adds `graph_name`/`repo_id`/`bundle_version` fields (born-right); theirs changed `language: fileInfo.language || 'unknown'` → `??`. **Resolution: their `??` line + our three fields following it.**

### A4. The rest (mechanical)

- `package.json`: union — keep their CVE bumps (`dompurify 3.4.13`, `uuid ^11.1.1`) + overrides block (`postcss/serialize-javascript/fast-uri/js-yaml/brace-expansion`), add our Studio/editor deps (`cytoscape`, `cytoscape-fcose`, `gray-matter`, `highlight.js`, `markdown-it`, `markdown-it-task-lists`); regen lock.
- `test_dataprep.py`: both sides appended suites (+452 ours born-right, +165 theirs bump) — union both blocks; full pytest must pass.
- `dataprep_microservice.py`: ours (ingest slot pool) + theirs (retract default `GRAPH`) — keep both.
- `deferred-work.md`: take theirs (major rewrite), re-append our still-open items.
- `package-lock.json`: regenerate.
