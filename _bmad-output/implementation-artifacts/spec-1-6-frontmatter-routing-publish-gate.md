---
title: 'Story 1.6 — Frontmatter tagging + vectorization (ingest-time requirement), env-driven OKF search style (hybrid | frontmatter_tags | vector_probe), and curator-UI hooks in editor + wizard'
type: 'feature'
created: '2026-10-07'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'fd04f6b0b'
supersedes: '1-6-fanout-observability-spans'  # the original 1.6 slot is repurposed for this bigger architectural piece; observability spans are absorbed into the rag.route.* attributes this story adds.
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-retriever-multigraph-fanout-rrf.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-graph-router-query-aware-selection.md'
  - '{project-root}/_bmad-output/planning-artifacts/okf-fanout-course-correction-2026-09-20.md'
  - '{project-root}/genie-ai-overlay/core/label_contract.py'
  - '{project-root}/genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:57'  # AsyncOpenAI vLLM pattern (LLM client reference)
  - '{project-root}/components/okf-server/services/lifecycle-service.js'  # publish event hook
  - '{project-root}/components/okf-server/scripts/check-okf-repo.js'
  - '{project-root}/components/gov-chat-frontend/src/components/okf/editor/RepoEditor.vue'
  - '{project-root}/components/gov-chat-frontend/src/components/okf/steps/Curate.vue'
  - '{project-root}/components/gov-chat-frontend/src/components/okf/steps/Publish.vue'
  - '{project-root}/.claude/rules/DEBUGGING-TRACING.md'
---

<!-- Target: 1100–1500 tokens. Above 1700 = high risk of context rot. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.3 routes by k=40 chunk-probe at the global chunk level. Two classes of bug remain unaddressed:

1. **Curator-mislabel.** A repo tagged "Bali" but containing a generic en.wikipedia.org crawl still routes "visit Bali for a beach holiday" to it — the index chunk mentions "Bali" 140 times in the disambiguation list, so the chunk-probe picks it. The user gets hallucinated travel advice. Live evidence (2026-10-07, dry-run on local build): `OKF_bali-wikipedia-llm_v17` and `OKF_indonesia-history-llm_v1` are both mis-curated; their sample chunks include "Spokane free speech fight", "BeiDou-3 satellites", "Yugoslav torpedo boat T6", "Jeremy Bentham's utilitarian principle" — none of which is what the repo name implies.

2. **Curator-unaware corpus scope.** A curator publishing a generic-wikipedia crawl as "Bali" has no architectural signal from us that the corpus doesn't match the name. The framework surfaces no constraint to act on.

**Decided design (validated by dry-run 2026-10-07, anchored by four directives on 2026-10-07):** every OKF repo carries a curator-controlled `frontmatter` with topics, entities, scope, forbidden list, and summary. Tags are auto-suggested by the LLM at publish time from a chunk sample; the curator reviews/edits before ingest proceeds. **Frontmatter tagging and vectorization are an ingest-time requirement that exists independent of which search style is active** (directive 1: "the tagging and vectorization of tags will be required regardless... so that users can switch after data has been ingested") — so an operator can flip the runtime search style at any time without re-ingesting.

The runtime routing pipeline runs in **one of three env-selected styles** via a new `OKF_SEARCH_STYLE` knob (default `hybrid`), per directive 2: "I do not want to shelve the existing 40 vector probe so let's create a .env based configuration for the OKF search style and default it to the OKF frontmatter tags/vectors" + directive 3 (style names): `hybrid | frontmatter_tags | vector_probe`. Valid values:

- `hybrid` (default) — both stages always. Primary route on weighted tag-cosine + forbidden penalty, intersected with the k=40 chunk-probe (Story 1.3). The chunk probe is NEVER shelved under this style — it always runs as a second-opinion validator. The final candidate set is the UNION of (frontmatter top-K) ∪ (chunk-probe qualified set) ∪ (sticky). This is the production-routing behavior today and stays the default to honor the "don't shelve the probe" requirement.
- `frontmatter_tags` — frontmatter primary, k=40 chunk-probe SKIPPED. Use when the curator has very high confidence in the tag set and wants to skip the probe for latency.
- `vector_probe` — Story 1.3 behavior preserved unchanged, only the k=40 chunk-probe runs. Use when the frontmatter migration hasn't run yet, or for legacy repos with no frontmatter (transitional — the migration script auto-tags every published repo as part of the same release).

**GPU services used during the publishing cycle** (directive 4: "the publishing phase leverages the correct GPU services"):
- **vLLM** (`VLLM_LLM_MODEL_ID` — `ibm-granite/granite-4.1-8b`) drives tag auto-suggestion and consistency validation via the OpenAI-compatible `/v1/chat/completions` endpoint (same `AsyncOpenAI` pattern dataprep uses for chunk labeling at `genieai_dataprep_arangodb.py:57`). MUST support guided JSON (`response_format={"type":"json_object"}`) — validated on granite-4.1-8b.
- **TEI embedding** (`EMBEDDING_MODEL_ID` — `BAAI/bge-large-en-v1.5`, 1024-dim) drives tag vectorization via `/embed`. The vector dimension MUST match the embedding model used for chunk retrieval — one shared space, no cross-model projection.
- vLLM and TEI are distinct GPU services (vLLM does not serve `/embed`; TEI does not serve chat). okf-server never embeds a per-chip dependency on either — it routes through env vars (`VLLM_LLM_HOST`, `TEI_EMBED_HOST`) so a deployment can swap either service without code edits.

**Auto-tagging surfaces in BOTH editor and wizard** (directive 4: "incorporates the automatic tagging features for frontmatter in both the editor and the wizard"): the auto-suggest + approve flow appears in `RepoEditor.vue` (the curator's persistent editor) and in the `Curate.vue` + `Publish.vue` wizard steps. No surface ships without the other.

**Approach:** additive. The Story 1.3 chunk-probe code is preserved (untouched) and runs always-on under `hybrid`. New code adds the frontmatter scoring stage BEFORE it (when the active style uses tags). Legacy `GRAPH` corpus is excluded from frontmatter routing (it's not a published OKF repo). The carrier gains a new `::tags:` segment parallel to the existing `::sticky:` / `::graphs:` / `::no_legacy:` segments. A new collection `okf_repo_frontmatter` holds the per-repo tags with vectors. The publish gate becomes HARD: a repo cannot reach `lifecycle_state=publish` without a non-empty frontmatter row — regardless of which search style the operator is running today.

**Operator migration workflow** (per the live-validation directive — David will retract, clean, auto-tag, re-publish all 8 currently-ingested repos): the script `scripts/republish-with-tags.js` (this story) does the LLM-suggest → validate → embed → publish pipeline as a one-shot per repo. Existing collections that lack frontmatter are NOT ingested a second time — the script only writes to `okf_repo_frontmatter` and the `okf_repositories_frontmatter_summary` cache row. The ingest (chunking/vectorization at the dataprep layer) is unchanged. Output: per-repo pass/fail + a re-ingest recommendation list (the operator can re-ingest if they want fresh chunk vectors).

**Failure modes covered:**
- Curator publishes a repo with tags that don't match the corpus → the LLM auto-suggest is reviewed, plus a per-chunk consistency check at publish time catches further mismatch. The k=40 chunk-probe running in parallel (under `hybrid`) acts as a second-opinion on the routing decision.
- Curator's tag set is stale → tags are pinned to the repo version; content changes require retract → re-curate → re-publish.
- LLM gives bad suggestions → curator reviews before ingest; the field is REQUIRED, not optional.
- Operator wants to flip styles later → tags+vectors are part of the ingest, not a per-style feature; flipping `OKF_SEARCH_STYLE` is a zero-cost runtime switch.
- Existing ingested repos have no frontmatter → covered by `scripts/republish-with-tags.js` (operator workflow: retract → clean → re-curate → run the migration → re-ingest).

## Boundaries & Constraints

**Always:**
- Every `okf_repositories` row at `lifecycle_state=publish` MUST have a corresponding `okf_repo_frontmatter` row. The publish gate (lifecycle-service's `publish:` event) refuses to advance without it — INDEPENDENT of `OKF_SEARCH_STYLE`. Even repos running under `vector_probe` are tagged at publish time so they can be flipped later.
- The `forbidden` field is REQUIRED. An empty forbidden list is allowed for legitimately comprehensive repos; a MISSING field is not.
- The `okf_repo_frontmatter` row carries 1024-dim TEI vectors for every tag (one shared embedding space with the chunks). Vectors are computed at publish time by `embedAllTags` calling TEI `/embed` once per value. The work is amortized at publish, not at query.
- A denormalized `okf_repositories_frontmatter_summary` row holds the precomputed weighted combination vector per repo so the hot-path query only needs ONE cosine per repo, not N.
- vLLM calls inherit the existing dataprep retry+backoff pattern: exponential backoff with jitter on 502/503/504 (3 retries, base 1s, max 8s), storm cool-down on consecutive failures, honest failure after exhaustion (per `reference_remote-llm-endpoint.md` — vllm-llm is REMOTE SHARED infra that crash-loops). TEI calls use a single-retry 30s timeout.
- Routing cost in the hot path under the default style: `1` TEI embed for the query (at the existing call site) + per-graph cosine products against cached `okf_repositories_frontmatter_summary.vector` rows (sub-millisecond) + k=40 chunk-probe (Story 1.3 — ~0.4s measured at 8 repos). Net wall-time increase vs Story 1.3: ~5-10ms for the frontmatter stage; the chunk probe is unchanged.
- The k=40 chunk-probe is NEVER silently removed from the hot path under `OKF_SEARCH_STYLE=hybrid` (the default). An operator who wants to skip the probe must explicitly set `frontmatter_tags`.
- `OKF_SEARCH_STYLE` is an env-var knob (read once at retriever boot, logged at startup with the active value). Default `hybrid`. Other valid values: `frontmatter_tags`, `vector_probe`. Invalid values → fail-closed to `vector_probe` with a loud log.
- Frontmatter routing is kill-switchable via `RETRIEVER_FRONTMATTER_ROUTING_ENABLED=false` (master kill switch). When off, `OKF_SEARCH_STYLE=vector_probe` is forced regardless of the env value, and a loud log records the override.

**Never:**
- Never call an LLM in the hot path. Tag generation is at publish time only.
- Never modify Story 1.3's `_route_graphs` function or its hooks; it remains the always-on second stage under `hybrid`. Add new code only.
- Never let the legacy `GRAPH` corpus participate in tag routing.
- Never let an empty tag set route to a graph. A graph with no frontmatter is filtered out at stage C; if no graph qualifies, the search is all-graphs (degraded, logged).

</frozen-after-approval>

> **SUPERSEDED 2026-10-08 (Story 1.7):** §1, §1a, and §3.1.2 of this
> spec are RETIRED. The per-repo tag set no longer lives in a
> dedicated `okf_repo_frontmatter` ArangoDB collection. It now
> lives in a new `okf_repositories.frontmatter` field (additive
> on the existing repo doc), with the index.md YAML frontmatter
> as the curator-facing projection. The corrected design is in
> `_bmad-output/implementation-artifacts/1-7-frontmatter-in-index.md`.
> The retriever's hot-path read, the publish gate, the LLM
> suggest path, and the operator migration script are all
> updated there. The `OKF_SEARCH_STYLE` env var + the three
> routing modes (hybrid / frontmatter_tags / vector_probe) and
> the LLM suggest call (concept-meta → vLLM → proposed set)
> are unchanged from this spec. The only change is the
> storage shape.

## Technical Design

### 1. (RETIRED 2026-10-08) `okf_repo_frontmatter` collection

```json
{
  "_key": "<repo_id>:<field>:<value_hash>",
  "repo_id": "<repo_id>",
  "field": "topic" | "entity" | "scope" | "forbidden" | "summary" | "keyword",
  "value": "<short phrase, 1-3 words, lowercase, hyphenated>",
  "weight": <float, 0.0-2.0; default 1.0>,
  "vector": [<float, 1024-dim>],
  "generated_at": "<ISO8601>",
  "generated_by": "llm:<model_version> | curator:<user_id>",
  "approved_at": "<ISO8601> | null",
  "approved_by": "<user_id> | null",
  "version": <int; bumped on retract+recurate>
}
```

Indexes: persistent on `_key`, `repo_id`, `field`; vector index on `vector`. One row per (repo_id, field, value) — N rows per repo. Bounded by the per-field count limits below.

### 1a. Denormalized hot-path cache: `okf_repositories_frontmatter_summary`

```json
{
  "_key": "<repo_id>",
  "topic_combined_vector": [<float, 1024-dim>],      // weighted average of all topic tag vectors
  "entity_combined_vector": [<float, 1024-dim>],
  "keyword_combined_vector": [<float, 1024-dim>],
  "summary_vector": [<float, 1024-dim>],
  "scope_vector": [<float, 1024-dim>],
  "forbidden_combined_vector": [<float, 1024-dim>],  // used for penalty subtraction
  "topic_count": <int>,
  "forbidden_count": <int>,
  "updated_at": "<ISO8601>",
  "version": <int>
}
```

This row is the ONLY thing the hot-path loads — one document per graph, one AQL fetch for all carrier graphs. Hot-path cost: O(carrier_graphs) cached vector reads + O(carrier_graphs) cosine products. **No `okf_repo_frontmatter` row is read at query time** — that's a writer-side concern.

### 2. Per-field defaults

| Field | Count range per repo | Default weight | Hot-path compute |
|---|---|---|---|
| `topic` | 3–8 | 1.0 | 1 cosine (uses `topic_combined_vector`) |
| `entity` | 0–10 | 0.7 | 1 cosine (uses `entity_combined_vector`) |
| `keyword` | 0–10 | 0.5 | 1 cosine (uses `keyword_combined_vector`) |
| `summary` | 1 (single sentence, embedded whole) | 0.5 | 1 cosine (uses `summary_vector`) |
| `scope` | 1 (single word) | 0.3 | 1 cosine (uses `scope_vector`) |
| `forbidden` | 2–6 | penalty (subtractive) | 1 cosine (uses `forbidden_combined_vector`) |

**Hot-path compute: 6 cosines per carrier graph, regardless of how many individual tags exist.** This is what makes search "optimal and fast" (directive 4): the per-repo combination vectors are precomputed at publish time and never change between republishes for the same content version. Cache invalidation is per-publish.

### 3. okf-server additions

**GPU services explicitly named (per directive: "the publishing phase leverages the correct GPU services"):**

| Stage | GPU service | Endpoint used | Code pattern (existing reference) |
|---|---|---|---|
| `suggestTags` (LLM auto-tag) | **vLLM** (`VLLM_LLM_MODEL_ID`) | `${VLLM_LLM_HOST}/v1/chat/completions` | `AsyncOpenAI(...)` — same pattern as dataprep labeling at `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:57`. MUST support guided JSON. |
| `validateFrontmatter` (LLM chunk-consistency) | **vLLM** (same) | same | same |
| `embedAllTags` (vectorization) | **TEI embedding** (`EMBEDDING_MODEL_ID`) | `${TEI_EMBED_HOST}/embed` | Standard `/embed` POST, 1024-dim output. One call per tag value, but TEI batches natively. |

**Resilience mandate** (per `reference_remote-llm-endpoint.md` — vllm-llm is REMOTE SHARED infra that crash-loops): every vLLM call in this service uses exponential backoff with jitter on 502/503/504 (3 retries, base 1s, max 8s); storm cool-down on consecutive failures; honest failure after exhaustion. TEI calls use a 30s single-retry timeout.

`components/okf-server/services/frontmatter-service.js` (new, ~300 lines):
- `suggestTags(repoId, sampleN=50)`: **per David 2026-10-08, the input is concept-meta rows ONLY — chunks are not a permitted source.** Tags MUST be generated at publish-time, which is BEFORE the lifecycle `ingest` transition that creates the graph. Reading chunks was the wrong source: at the moment suggestTags runs (inside the publish hook), the working graph either doesn't exist yet or holds stale data from a previous version. The authoritative "what is this repo about" signal is the curator's per-concept `tags` + `labels` + `summary` + `type` fields in `okf_concepts_meta` — these are set in the editor's right rail during curation (the publish gate) and survive retract + republish cycles unchanged. The function `sampleConceptsFromRepo(db, repoId, n)` reads concept rows (the natural corpus; deterministic order by `_key`) and formats them as `concept_id: title (tags, labels) — summary` rows; the LLM derives topic/entity/forbidden/scope/keyword from that shape. Chunks are deliberately NOT consulted, period — the forbidden list in particular must be derived from the curator's stated scope (what the concepts ARE about) vs. adjacent topics the curator DIDN'T include, not from chunk text that may not exist yet. **Defensive 400**: if `okf_concepts_meta` has zero rows for the repo, return `NO_CONCEPTS` with the message "Add at least one concept before requesting tag suggestions" — this is the same class of pre-condition as the old `NO_CHUNKS` but names the real cause. The LLM call shape, retry, and concurrency controls are unchanged. Concurrency bounded at `OKF_FRONTMATTER_TAG_BATCH_SIZE` (default 1 — one repo at a time).
- `validateFrontmatter(repoId, frontmatter, samplePct=0.1)`: for each proposed tag, samples 10% of the corpus and asks vLLM "does this chunk match this tag? Y/N with one-sentence reason." If > 30% of chunks say N for a given tag, that tag is flagged inconsistent. Concurrency bounded at `OKF_FRONTMATTER_VALIDATE_BATCH_SIZE` (default 4).
- `embedAllTags(frontmatter)`: calls TEI once per tag value (one embed call per topic/entity/keyword/summary/scope/forbidden value). With default field counts (~7-35 embed calls per repo per publish) this is wall-time-bounded at TEI's batch side, not the call count.
- `publishFrontmatter(repoId, frontmatter)`: ATOMIC, single ArangoDB transaction. Steps in order: (1) call `embedAllTags`; (2) compute the 6 combination vectors for `okf_repositories_frontmatter_summary`; (3) write all `okf_repo_frontmatter` rows; (4) write/update the `okf_repositories_frontmatter_summary` doc; (5) invalidate the 60s BFF cache. Refuses to publish if any tag is empty, any vector is zero, or any forbidden value collides with a topic value on the same repo. **Invoked from the publish pipeline regardless of `OKF_SEARCH_STYLE`**.

`components/okf-server/services/lifecycle-service.js` (~10-line extension at the `publish:` event):
- The publish handler calls `await frontmatterService.publishFrontmatter(repoId, ...)` BEFORE writing `lifecycle_state=publish`. If frontmatter publish fails, the lifecycle transition is refused with `409 FRONTMATTER_REQUIRED` — the repo stays at `approve`. This is the HARD gate.

`components/okf-server/scripts/check-okf-repo.js` (extend, ~50 new lines):
- after the existing Step 5 retriever e2e, add Step 6 "frontmatter": if the repo is at `lifecycle_state=publish`, verify `okf_repositories_frontmatter_summary` exists, ≥3 `topic` rows present, ≥1 `forbidden` row present, and the `forbidden` set is non-empty (unless the corpus is explicitly marked comprehensive).

`components/okf-server/scripts/republish-with-tags.js` (new, ~140 lines) — implements the operator migration workflow:
- for every repo at `lifecycle_state=publish` without frontmatter, run `suggestTags` + `validateFrontmatter` + `publishFrontmatter` in sequence. Output: per-repo pass/fail. The script is idempotent — running it twice is a no-op on already-tagged repos.
- Operator-facing flags: `--dry-run` (compute suggestions, print, do not write), `--repo <id>` (single-repo mode), `--auto-approve` (skip the manual approval gate — used by the operator workflow when re-tagging already-ingested repos whose curator has already passed).
- Operator workflow: retract the repo → re-curate (clean the corpus) → run the script → re-ingest (optional; only if content changed).

`components/okf-server/services/retrieval-config-service.js` (extend, ~20 new lines):
- `getRepoFrontmatterSummary(repoId)`: returns the 6 combination vectors + tag counts from `okf_repositories_frontmatter_summary`. TTL 60s; cache invalidated on any change to the summary row.

`components/okf-server/routes/okf-routes.js` (extend, ~50 new lines; the existing routes file already mounts retrieval-config — add to the same router):
- `GET /api/okf/repos/:id/frontmatter`: thin read endpoint for the curator UI (returns the full `okf_repo_frontmatter` rows, NOT the summary).
- `PATCH /api/okf/repos/:id/frontmatter`: curator edit endpoint.
- `POST /api/okf/repos/:id/frontmatter/suggest`: triggers `suggestTags` and returns the proposed set without writing (the editor's "Run auto-tagger" CTA).

### 3a. Curator UI surface — BOTH editor and wizard (per directive)

The auto-suggest + approve flow ships in both surfaces:

**Editor surface** (`gov-chat-frontend/src/components/okf/editor/RepoEditor.vue`):
- New top-right pane (parallel to the existing concept list / body / frontmatter panes) called "Auto Tags" — list view of `{field, value, weight, vector_present}`. Each row has an approve-and-replace shortcut (saves `approved_at` + `approved_by`). The auto-suggest button calls `POST /api/okf/repos/:id/frontmatter/suggest` and shows the suggested set inline (do NOT auto-write — the curator must explicitly save). Empty state links to "Run auto-tagger" CTA.

**Wizard surface** (`gov-chat-frontend/src/components/okf/steps/Curate.vue`, `Publish.vue`):
- `Curate.vue`: add a "Tags" sub-card in the pin board that shows the current tag set + a "Refresh suggestions" button. New concept-added events trigger a re-suggest (debounced 2s, only if repo size changed by ≥1 concept since last suggest).
- `Publish.vue`: replace the current "Topics reviewed" gate (the `topicsOk` computed at lines ~107-128) with a "Frontmatter tags — approved" gate. The publish button stays disabled until ≥3 topic tags AND ≥1 forbidden tag are present and approved. The existing `topicsOk` variable is preserved as a separate "concepts authored" gate.

**Service layer** (new):
- `components/gov-chat-frontend/src/services/frontmatter-service.js` (~80 lines): `suggest(repoId)`, `get(repoId)`, `patch(repoId, fields)`. Uses the existing `httpService` (DS pattern, per `feedback_ui-must-use-ds`).

**i18n ×14 gate** (per CLAUDE.md): every user-visible surface needs `okf.editor.tags.*`, `okf.steps.curate.tags.*`, `okf.steps.publish.tags.*` keys translated to ar/bn/de/en/es/fr/id/man/pt/ru/st/sw/th/zh.

### 4. retriever additions — search-style selector

`genie-ai-overlay/retriever/config.py` (extend, ~25 new lines):

```python
# Story 1.6 — env-driven OKF search style.
# Default = hybrid (frontmatter primary, k=40 chunk-probe always-on).
# Tagging + vectorization runs at publish time regardless of this value, so an
# operator can flip styles without re-ingesting (per directive 2026-10-07).
import os
_OKF_SEARCH_STYLE_RAW = os.getenv("OKF_SEARCH_STYLE", "hybrid").strip().lower()
VALID_OKF_SEARCH_STYLES = ("hybrid", "frontmatter_tags", "vector_probe")
if _OKF_SEARCH_STYLE_RAW not in VALID_OKF_SEARCH_STYLES:
    logger.warning("retriever.invalid_okf_search_style %r — falling back to vector_probe", _OKF_SEARCH_STYLE_RAW)
    OKF_SEARCH_STYLE = "vector_probe"
else:
    OKF_SEARCH_STYLE = _OKF_SEARCH_STYLE_RAW
logger.info("retriever.okf_search_style %s", OKF_SEARCH_STYLE)

FRONTMATTER_ROUTING_ENABLED = os.getenv("RETRIEVER_FRONTMATTER_ROUTING_ENABLED", "true").lower() == "true"
FRONTMATTER_TAG_WEIGHTS = {
    "topic": float(os.getenv("RETRIEVER_FRONTMATTER_TAG_WEIGHT_TOPIC", "1.0")),
    "entity": float(os.getenv("RETRIEVER_FRONTMATTER_TAG_WEIGHT_ENTITY", "0.7")),
    "keyword": float(os.getenv("RETRIEVER_FRONTMATTER_TAG_WEIGHT_KEYWORD", "0.5")),
    "summary": float(os.getenv("RETRIEVER_FRONTMATTER_TAG_WEIGHT_SUMMARY", "0.5")),
    "scope": float(os.getenv("RETRIEVER_FRONTMATTER_TAG_WEIGHT_SCOPE", "0.3")),
}
FRONTMATTER_FORBIDDEN_PENALTY = float(os.getenv("RETRIEVER_FRONTMATTER_FORBIDDEN_PENALTY", "1.5"))
FRONTMATTER_MIN_SCORE = float(os.getenv("RETRIEVER_FRONTMATTER_MIN_SCORE", "0.25"))
FRONTMATTER_TOP_K = int(os.getenv("RETRIEVER_FRONTMATTER_TOP_K", "5"))
```

`genie-ai-overlay/retriever/genieai_retriever_arangodb.py` (extend, ~200 new lines):
- New function `_load_frontmatter_summaries(repo_ids) -> dict[repo_id, summary_doc]`. ONE ArangoDB query: `FOR s IN okf_repositories_frontmatter_summary FILTER s._key IN @repo_ids RETURN s`. Sub-millisecond at 8 repos.
- New function `_score_repo_by_frontmatter(repo_id, query_emb, summaries) -> {score, breakdown}`. Six cosines: weighted topic + entity + keyword + scope; subtract forbidden penalty. Pure math. Net result is one float per repo.
- New function `_select_repos_by_frontmatter(okf_graphs, query_emb, top_k=5)`. Loads summaries, scores, returns top-K. Stage C filter (no summary → no candidate) lives here.
- New selector function `_select_repos(okf_graphs, query_emb, carrier_graph_set)` reading `OKF_SEARCH_STYLE` from config and dispatching:
  - `vector_probe` → calls `_route_graphs` (Story 1.3, untouched); no frontmatter stage
  - `frontmatter_tags` → calls `_select_repos_by_frontmatter`, returns top-K; chunk-probe SKIPPED
  - `hybrid` (default) → calls `_select_repos_by_frontmatter` AND `_route_graphs`, returns the UNION of both selections (frontmatter top-K ∪ chunk-probe qualified set ∪ sticky). The k=40 chunk-probe is NEVER skipped under this style.
- `invoke_fanout` change: replace the direct `_route_graphs` call with `_select_repos(...)`. The legacy `_route_graphs` is preserved unchanged and called by the selector when the style requires it. Span attrs `rag.route.style`, `rag.route.frontmatter_count`, `rag.route.chunk_probe_count`, `rag.route.union_count` are emitted for every query.

### 5. Carrier grammar — `::tags:` (core/label_contract.py, additive)

`_TAGS_SEPARATOR = "::tags:"` appended to `_SEGMENTS` (now 5). `encode(base_mode, labels, graphs, no_legacy, sticky=None, tags=None)`; `decode_tags()` accessor; `decode()` keeps its 3-tuple signature. The `tags` value is a comma-separated list of repo IDs whose `okf_repositories_frontmatter_summary` rows should be loaded for this query — the BFF emits it from the carrier graph set (parallel to how it emits `::graphs:`).

`core/label_contract.py` update (~10 lines, parallel to the existing `sticky` handling):
- extend `encode` signature with `tags=None`
- extend `_decode_all` to parse `_TAGS_SEPARATOR`
- add `decode_tags(search_start) -> list[str]`

`genie-ai-overlay/core/genieai_api_protocol.py` (~5 lines): add `frontmatter_repo_ids: list[str] | None` to the RequestContext model.

### 6. BFF additions

`components/gov-chat-backend/services/retrieval-config-client.js` (extend, ~15 new lines):
- New method `getRepoFrontmatterSummary(repoId, opts)` calls okf-server and caches per repo_id for 60s.

`components/gov-chat-backend/services/query-service.js` (extend, ~20 new lines):
- In `_attachFanoutCarrier` (~line 473), after the sticky emit (~line 538), emit the `::tags:` segment with the same set of authorized graph names (parallel to the existing carrier segments). The chatqna re-encode will pass it through.
- chatqna pass-through: in `align_inputs` re-encode (~line 1022 in chatqna), parallel to the existing `sticky_graph_names` read at line 1018, add `_tags_repo_ids`; in the `encode` call (~line 1040), pass `tags=_tags_repo_ids`.

### 7. Performance — searching with vectorized tags is optimal and fast (directive 4)

- **Hot-path cost under `hybrid`** (the default): `1` TEI embed for the query (at the existing call site) + `1` ArangoDB query to load all carrier-graph summary rows (one network round-trip, sub-millisecond) + `6 cosines per carrier graph` against cached combination vectors (microseconds) + k=40 chunk-probe (Story 1.3 — ~0.4s, unchanged).
- **Concrete numbers at 8 carrier graphs** (calibration target):
  - Load summaries: 1 ArangoDB query, ≤5 ms
  - 6 × 8 = 48 cosine products: ≤2 ms (numpy batched, vectorized)
  - Net frontmatter stage added to hot path: ≤10 ms
  - Chunk-probe stage: ≤400 ms (unchanged)
  - Total retriever routing budget under hybrid: ≤10 ms frontmatter + ≤400 ms probe = ~410 ms vs ~400 ms for `vector_probe` alone (3% increase, not per-query wall)
- **Why this is "optimal and fast"**: the combination vectors are precomputed at publish time (TEI runs once per tag at publish, never at query), and the hot path is O(carrier_graphs) — independent of how many individual tags exist per repo (50 tags or 5, same cost).
- **Index strategy**: the `okf_repositories_frontmatter_summary.vector` is stored as a `float[]` (NOT indexed in ArangoDB's vector index — only individual `okf_repo_frontmatter.vector` rows are indexed, for the curator UI's tag-search feature). Hot-path cosine products are computed in numpy on the loaded float arrays.

### 8. Failure modes

| Failure | Behavior |
|---|---|
| LLM auto-suggest returns bad tags | Curator review gates publish; tag is not live until approved. |
| LLM availability degraded at publish time | okf-server retries the suggestion 3x with backoff (per `reference_remote-llm-endpoint.md`); if all fail, publish is rejected (refuses to proceed with empty tag set) — mandatory regardless of `OKF_SEARCH_STYLE`. |
| TEI embed unavailable at publish time | Single-retry 30s timeout; on second failure, publish rejected with `503 EMBED_UNAVAILABLE`. |
| Curator approves tags that don't match corpus | `validateFrontmatter`'s per-chunk consistency check catches it. Curator can override (logged as override, not silent). |
| Frontmatter row missing for an active repo | `check-okf-repo.js` Step 6 fails; `republish-with-tags.js` migration runs the auto-tag pipeline. |
| Query embedding fails (TEI down) | Today's behavior (chunk-probe only, degraded). The new tag stage gracefully fails open (skip tags, use chunk-probe). |
| `OKF_SEARCH_STYLE` set to an invalid value | Fail-closed to `vector_probe` with a loud log. |
| All carrier graphs filtered out at stage C | All-graphs degraded search (same as today's `RETRIEVER_ROUTE_DEGRADED` path); loud log + `rag_route_frontmatter_degraded` counter. |

## Tasks

- [ ] 1. `core/label_contract.py`: `::tags:` segment, `encode(... tags=...)` kwarg, `decode_tags()` accessor (10 lines, parallel to sticky)
- [ ] 2. `core/genieai_api_protocol.py`: `frontmatter_repo_ids` field on RequestContext (5 lines)
- [ ] 3. `retriever/config.py`: `OKF_SEARCH_STYLE` env selector + `FRONTMATTER_*` knobs (~25 lines)
- [ ] 4. `retriever/genieai_retriever_arangodb.py`: `_load_frontmatter_summaries` + `_score_repo_by_frontmatter` + `_select_repos_by_frontmatter` + `_select_repos` selector (~200 lines); replace the direct `_route_graphs` call in `invoke_fanout` with `_select_repos(...)` (~5-line change); span attrs for `rag.route.style` etc.
- [ ] 5. `components/okf-server/services/frontmatter-service.js`: new file, `suggestTags` + `validateFrontmatter` + `embedAllTags` + `publishFrontmatter` (~300 lines, with vLLM retry+backoff and TEI single-retry per `reference_remote-llm-endpoint.md`)
- [ ] 6. `components/okf-server/services/lifecycle-service.js`: hook `publishFrontmatter` into the `publish:` event (~10 lines; refuses transition with 409 FRONTMATTER_REQUIRED on failure)
- [ ] 7. `components/okf-server/services/retrieval-config-service.js`: `getRepoFrontmatterSummary` (~20 lines)
- [ ] 8. `components/okf-server/routes/retrieval-config.js`: GET / PATCH `/frontmatter` + POST `/frontmatter/suggest` (~50 lines)
- [ ] 9. `components/okf-server/scripts/check-okf-repo.js`: extend Step 5 with Step 6 frontmatter check (~50 new lines)
- [ ] 10. `components/okf-server/scripts/republish-with-tags.js`: one-time operator migration, with `--dry-run` / `--repo <id>` / `--auto-approve` flags (~140 lines; implements the retract → re-curate → re-publish workflow)
- [ ] 11. `components/gov-chat-backend/services/retrieval-config-client.js`: `getRepoFrontmatterSummary` (~15 lines)
- [ ] 12. `components/gov-chat-backend/services/query-service.js`: emit `::tags:` segment in `_attachFanoutCarrier` (~20 lines)
- [ ] 13. `genie-ai-overlay/chatqna/genieai_chatqna.py`: pass `tags=_tags_repo_ids` through `align_inputs` re-encode (~10 lines, parallel to sticky)
- [ ] 14. **Curator UI — editor surface**: `gov-chat-frontend/src/components/okf/editor/RepoEditor.vue` new "Auto Tags" pane + `gov-chat-frontend/src/services/frontmatter-service.js` (~80 lines, DS pattern via httpService)
- [ ] 15. **Curator UI — wizard surface**: `gov-chat-frontend/src/components/okf/steps/Curate.vue` "Tags" sub-card + `Publish.vue` "Frontmatter tags — approved" gate (~30 lines net change across both files)
- [ ] 16. **i18n ×14**: `okf.editor.tags.*`, `okf.steps.curate.tags.*`, `okf.steps.publish.tags.*` keys for ar/bn/de/en/es/fr/id/man/pt/ru/st/sw/th/zh
- [ ] 17. `env` file: add `OKF_SEARCH_STYLE` (default `hybrid`), `OKF_FRONTMATTER_TAG_BATCH_SIZE`, `OKF_FRONTMATTER_VALIDATE_BATCH_SIZE`, `VLLM_LLM_HOST`, `TEI_EMBED_HOST`, and the `RETRIEVER_FRONTMATTER_*` knobs to the documented env surface
- [ ] 18. Tests: `test_frontmatter_routing.py` (5-7 cases), `test_okf_search_style.py` (3 cases — `hybrid` / `frontmatter_tags` / `vector_probe`), chatqna pass-through, BFF carrier emit, okf-server validation gate, end-to-end publish gate, `republish-with-tags.js` idempotency, lifecycle-service 409 FRONTMATTER_REQUIRED pin
- [ ] 19. Lint/format (ruff + eslint + prettier) clean; OPEA + backend + okf-server suites green
- [ ] 20. Local build sync + rebuild retriever/chatqna/backend/okf-server; live validation per Verification
- [ ] 21. Sprint yaml + memory update; GitLab sync

## Verification

1. **Unit**:
   - `OKF_SEARCH_STYLE=vector_probe` reverts to Story 1.3 behavior exactly (selector dispatches to `_route_graphs`, no frontmatter stage).
   - `OKF_SEARCH_STYLE=frontmatter_tags` runs `_select_repos_by_frontmatter` only, chunk-probe SKIPPED.
   - `OKF_SEARCH_STYLE=hybrid` runs both stages and returns the UNION.
   - Invalid `OKF_SEARCH_STYLE` value falls closed to `vector_probe` with a loud log.
   - `RETRIEVER_FRONTMATTER_ROUTING_ENABLED=false` forces `vector_probe` with a loud log.
3. **Publish gate**: attempting to publish a repo without frontmatter fails with `409 FRONTMATTER_REQUIRED`. The `okf_repositories` document is not updated to `publish`. **Verified under all three styles** (the gate is independent of `OKF_SEARCH_STYLE`).
4. **Always-on chunk-probe** under default style: every query logs `rag.route.style=hybrid` AND `rag.route.chunk_probe_count > 0` AND `rag.route.union_count > 0` — proves the probe is not skipped.
5. **Live tag-routing accuracy** on the calibration queries from Story 1.3:
   - `Visit Bali for a beach holiday next July` → bali NOT in top-3 (forbidden: travel, tourism, balinese-hindu-rituals)
   - `List Bali disambiguation entries` → bali in top-1 (topic: disambiguation, wikipedia)
   - `Tell me about Indonesian history` → indonesia in top-1
   - `Tell me about the Alphabet Waymo subsidiary` → alphabet in top-1
6. **Hot-path performance under `hybrid`** (calibrated on local build, 8 carrier graphs):
   - frontmatter stage: ≤10 ms (1 ArangoDB query + 48 numpy cosines)
   - chunk-probe stage: ≤400 ms (Story 1.3 unchanged)
   - net retriever routing increase vs `vector_probe`: ≤10 ms (3%)
7. **GPU service routing**:
   - `suggestTags` and `validateFrontmatter` use `AsyncOpenAI(VLLM_LLM_HOST)` (matches dataprep's pattern at `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:57`)
   - `embedAllTags` uses TEI's `/embed` endpoint (`TEI_EMBED_HOST`)
   - Tag vector dimension = chunk vector dimension (1024, validated by unit test)
   - Retry+backoff on 502/503/504 from vLLM; single-retry on TEI timeout (per `reference_remote-llm-endpoint.md`)
8. **Legacy no-carrier probe**: byte-identical (no carrier ⇒ no `::tags:` segment; the existing legacy path runs).
9. **Forbidden penalty verified**: a query that hits the forbidden tag `forbidden: ["travel"]` for the bali repo produces a net score that decreases the bali repo's ranking below the threshold, excluding it from the frontmatter stage; the chunk-probe stage still surfaces chunks, and the final UNION contains only chunks the curator would expect.
10. **Editor + wizard surfaces**: opening `RepoEditor.vue` for a published repo shows the "Auto Tags" pane populated; clicking "Run auto-tagger" calls the suggest endpoint and renders the suggested set inline. In the wizard, `Curate.vue` shows the "Tags" sub-card with current tags; `Publish.vue`'s publish button stays disabled until the frontmatter gate is green.
11. **Migration**: `scripts/republish-with-tags.js` is idempotent — second run is a no-op on already-tagged repos. All 8 currently-published repos end up with `okf_repo_frontmatter` + `okf_repositories_frontmatter_summary` rows. Operator workflow: retract → re-curate → run script → re-ingest (optional). After the migration, flipping `OKF_SEARCH_STYLE` to any value is a zero-cost runtime switch.
12. **Style-flip is zero-cost**: starting with `OKF_SEARCH_STYLE=vector_probe` and flipping to `hybrid` (or `frontmatter_tags`) mid-process (after the next retriever pod restart, which re-reads the env var) produces the new style without any DB work or ingest.

## Out of scope

- Per-chunk tags (only per-repo tags in this story).
- Cross-graph similarity (e.g., "alphabet" and "waymo" are semantically related; the calibration data shows basic affinity is enough — revisit at ~50 repos).
- LLM-based dynamic re-tagging on retract; tags are pinned to the repo version (curator retract → re-curate → re-publish).
- Fine-grained style toggles per user or per query (the current design is deployment-wide via env var).
- A separate re-ingest pipeline (re-ingest is unchanged from the current dataprep drain; this story does not touch that code path).