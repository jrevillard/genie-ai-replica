---
title: 'Story 1.6 dev-story — Frontmatter routing + tagging + editor/wizard + migration'
type: 'dev-story'
created: '2026-10-07'
status: 'in-progress'
route: 'dispatch'
spec: '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-frontmatter-routing-publish-gate.md'
baseline_commit: 'fd04f6b0b'
target_branch: 'feat/okf-server'
worktree: '.claude/worktrees/el-salvador-dev'  # current feature branch; if developing on a fresh worktree, create first per feedback_worktree_branch_isolation
---

## Goal

Ship the spec — three layers: (1) **writer** = `okf-server` + lifecycle hook + UI surfaces in editor and wizard + migration script + GPU integration; (2) **carrier** = `label_contract.py` `::tags:` segment + chatqna pass-through + BFF emit; (3) **reader** = retriever config + selector + summary cache. All three must land in one branch (single feature MR).

## Pre-flight (mandatory)

Read in order:
1. The spec at `_bmad-output/implementation-artifacts/spec-1-6-frontmatter-routing-publish-gate.md` — every decision is there.
2. Story 1.3 (`spec-1-3-graph-router-query-aware-selection.md`) — the k=40 chunk-probe you must NOT modify; you are ADDING the frontmatter stage BEFORE it, and the selector dispatches by `OKF_SEARCH_STYLE`.
3. The dataprep labeling pattern at `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:57` — `AsyncOpenAI(VLLM_LLM_HOST)` is the model for vLLM calls in `frontmatter-service.js`.
4. The lifecycle-service publish event at `components/okf-server/services/lifecycle-service.js` — the hook you extend.
5. `reference_remote-llm-endpoint.md` in memory — vllm-llm is REMOTE SHARED infra that crash-loops. Tag generation MUST inherit dataprep's retry+backoff pattern.

Verify these SURFACES exist before touching code (return results before starting):
- `genie-ai-overlay/core/label_contract.py`
- `genie-ai-overlay/retriever/config.py`
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`
- `genie-ai-overlay/core/genieai_api_protocol.py`
- `genie-ai-overlay/chatqna/genieai_chatqna.py`
- `components/okf-server/services/lifecycle-service.js`
- `components/okf-server/services/retrieval-config-service.js`
- `components/okf-server/routes/retrieval-config.js` → actually `components/okf-server/routes/okf-routes.js` (this is where retrieval-config routes are mounted; per-pre-flight glob showed only `health-routes.js`, `internal-routes.js`, `okf-routes.js`, `repos-routes.js`). Controller at `controllers/retrieval-config-controller.js` already exists; the new endpoints extend the existing retrieval-config router section in `okf-routes.js`.
- `components/okf-server/scripts/check-okf-repo.js`
- `components/gov-chat-backend/services/query-service.js`
- `components/gov-chat-backend/services/retrieval-config-client.js`
- `components/gov-chat-frontend/src/components/okf/editor/RepoEditor.vue`
- `components/gov-chat-frontend/src/components/okf/steps/Curate.vue`
- `components/gov-chat-frontend/src/components/okf/steps/Publish.vue`

If any is missing → STOP and surface to user.

## Build order

Layer 1 (writer) and Layer 3 (reader) can land in parallel branches but should land in the SAME MR (the carrier is the bridge). The carrier (Layer 2) requires Layer 1 to be functional for end-to-end smoke, but the carrier code is independent of the reader. Suggested order:

### Step 1 — Layer 1.A: frontmatter-service + lifecycle hook
- Create `components/okf-server/services/frontmatter-service.js` (new, ~300 lines) with:
  - `suggestTags(repoId, sampleN=50)` using `AsyncOpenAI(VLLM_LLM_HOST)`, retry+backoff per `reference_remote-llm-endpoint.md`
  - `validateFrontmatter(repoId, frontmatter, samplePct=0.1)` same vLLM pattern, concurrency 4
  - `embedAllTags(frontmatter)` using TEI `/embed`, single-retry 30s timeout
  - `publishFrontmatter(repoId, frontmatter)` atomic: embedAllTags → compute 6 combination vectors → write `okf_repo_frontmatter` rows → write `okf_repositories_frontmatter_summary` → invalidate BFF cache
- Hook into `components/okf-server/services/lifecycle-service.js` `publish:` event — call `publishFrontmatter` BEFORE the `lifecycle_state=publish` write; refuse transition with `409 FRONTMATTER_REQUIRED` on failure.
- Create the `okf_repo_frontmatter` and `okf_repositories_frontmatter_summary` collections + indexes (vector index on `okf_repo_frontmatter.vector` only; the summary row's combination vectors are read as float arrays, not searched).
- Add to `env`: `VLLM_LLM_HOST`, `TEI_EMBED_HOST`, `OKF_FRONTMATTER_TAG_BATCH_SIZE=1`, `OKF_FRONTMATTER_VALIDATE_BATCH_SIZE=4`.

### Step 2 — Layer 1.B: REST routes + retrieval-config-service
- Extend `components/okf-server/services/retrieval-config-service.js` with `getRepoFrontmatterSummary(repoId)` (TTL 60s).
- Extend `components/okf-server/routes/retrieval-config.js`:
  - `GET /api/okf/repos/:id/frontmatter` (full row read)
  - `PATCH /api/okf/repos/:id/frontmatter` (curator edit)
  - `POST /api/okf/repos/:id/frontmatter/suggest` (triggers suggestTags, returns without writing)

### Step 3 — Layer 1.C: editor + wizard UI surfaces
- Add `components/gov-chat-frontend/src/services/frontmatter-service.js` (~80 lines, DS pattern via `httpService`).
- Editor: extend `gov-chat-frontend/src/components/okf/editor/RepoEditor.vue` with the new "Auto Tags" pane (parallel to concept list / body / frontmatter panes) — list view of `{field, value, weight, vector_present}` + approve-and-replace shortcut + auto-suggest button calling `POST /api/okf/repos/:id/frontmatter/suggest`.
- Wizard: extend `gov-chat-frontend/src/components/okf/steps/Curate.vue` with "Tags" sub-card; extend `gov-chat-frontend/src/components/okf/steps/Publish.vue` to add a "Frontmatter tags — approved" gate (existing `topicsOk` stays as a separate "concepts authored" gate).
- i18n ×14: add `okf.editor.tags.*`, `okf.steps.curate.tags.*`, `okf.steps.publish.tags.*` keys for ar/bn/de/en/es/fr/id/man/pt/ru/st/sw/th/zh.

### Step 4 — Layer 1.D: migration script
- Create `components/okf-server/scripts/republish-with-tags.js` (~140 lines):
  - `--dry-run` (compute suggestions, print, do not write)
  - `--repo <id>` (single-repo mode)
  - `--auto-approve` (skip manual approval — used when re-tagging already-ingested repos whose curator has already passed)
- Idempotent: second run is a no-op on already-tagged repos.

### Step 5 — Layer 2: carrier
- Extend `genie-ai-overlay/core/label_contract.py`: `_TAGS_SEPARATOR = "::tags:"` appended to `_SEGMENTS` (now 5); `encode(... tags=None)` kwarg; `_decode_all` parses it; `decode_tags(search_start)` accessor.
- Extend `genie-ai-overlay/core/genieai_api_protocol.py`: `frontmatter_repo_ids: list[str] | None` field on RequestContext.
- Extend `genie-ai-overlay/chatqna/genieai_chatqna.py` at `align_inputs` re-encode (~line 1022): read `_tags_repo_ids` parallel to existing `_sticky_graph_names`; pass `tags=_tags_repo_ids` to `encode(...)`.

### Step 6 — Layer 3.A: BFF
- Extend `components/gov-chat-backend/services/retrieval-config-client.js` with `getRepoFrontmatterSummary(repoId)` (TTL 60s).
- Extend `components/gov-chat-backend/services/query-service.js` `_attachFanoutCarrier` (~line 473): after the sticky emit (~line 538), emit the `::tags:` segment with the same set of authorized graph names.

### Step 7 — Layer 3.B: retriever selector
- `genie-ai-overlay/retriever/config.py`: `OKF_SEARCH_STYLE` env selector + `FRONTMATTER_*` knobs.
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`:
  - `_load_frontmatter_summaries(repo_ids)` (one AQL query)
  - `_score_repo_by_frontmatter(repo_id, query_emb, summaries)` (6 cosines per repo)
  - `_select_repos_by_frontmatter(okf_graphs, query_emb, top_k=5)`
  - `_select_repos(...)` dispatcher (vector_probe / frontmatter_tags / hybrid)
  - `invoke_fanout`: replace the direct `_route_graphs` call with `_select_repos(...)` (~5-line change). Story 1.3's `_route_graphs` is NEVER modified.

### Step 8 — Tests
- `genie-ai-overlay/tests/test_frontmatter_routing.py` — 5-7 cases (selector dispatch per style, hot-path summary load, forbidden penalty math, edge cases)
- `genie-ai-overlay/tests/test_okf_search_style.py` — 3 cases (one per style)
- `genie-ai-overlay/tests/test_label_contract.py` — add round-trip + `decode_tags()` accessor
- `genie-ai-overlay/tests/test_chatqna_fanout_carrier.py` — add `::tags:` segment pass-through pin
- `components/okf-server/__tests__/services/test_frontmatter_service.js` — vLLM retry/backoff, TEI retry, atomic write
- `components/okf-server/__tests__/routes/test_retrieval_config_routes.js` — GET / PATCH / POST suggest
- `components/okf-server/__tests__/lifecycle/test_publish_gate.js` — 409 FRONTMATTER_REQUIRED pin
- `components/okf-server/__tests__/scripts/test_republish_with_tags.js` — idempotency + flags
- `components/gov-chat-backend/__tests__/services/test_query_service.js` — `::tags:` carrier emit

### Step 9 — Lint/format + local rebuild
- `npm run lint:fix && npm run format && npm run lint:py:fix && npm run format:py`
- Rebuild affected images locally per the local-build rule (`feedback_local-build-sync.md`)
- Sync full delta to local build before verification (BEFORE, not after)

### Step 10 — Live validation
1. **Unit**: per Verification §1 in the spec — selector dispatch, fail-closed, kill-switch
2. **Publish gate**: per Verification §3 — 409 `FRONTMATTER_REQUIRED` under all three styles
3. **Hot-path performance**: per Verification §6 — calibrated at 8 carrier graphs, ≤10 ms frontmatter stage
4. **Live routing accuracy**: per Verification §5 — 4 calibration queries from Story 1.3
5. **Migration**: run `scripts/republish-with-tags.js --dry-run` against the 8 currently-published repos; then run with `--auto-approve` and verify all 8 get `okf_repositories_frontmatter_summary` rows
6. **Operator workflow**: hand the operator the command sequence for retract → re-curate → run script → re-ingest (David will execute against the live .102 stack)
7. **Style-flip**: change `OKF_SEARCH_STYLE` via env var, restart retriever pod, observe log line `rag.retriever.okf_search_style` matches the new value; zero re-ingest needed

## Out-of-scope reminders

- Do NOT modify Story 1.3's `_route_graphs` or its hooks.
- Do NOT call vLLM in the hot path.
- Do NOT cache `okf_repo_frontmatter` rows at query time — only the denormalized summary.
- Do NOT remove the existing `topicsOk` variable in `Publish.vue` — it's a separate gate.
- Do NOT commit directly to `main` (per `feedback_no-commit-main.md`).
- Do NOT skip the i18n ×14 gate for any user-visible surface.

## Definition of Done

All Tasks in the spec are checked off, all Verification steps pass, lint/format clean, OPEA + backend + okf-server suites green, local build mirrors the full delta, GitLab issues synced. Then: `bmad code-review` (separate context per the forward workflow).