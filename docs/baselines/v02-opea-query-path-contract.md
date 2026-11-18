# V02 — The OPEA query-path behavioral contract (as deployed)

| Field | Value |
|---|---|
| Artifact | **V02** — verification gate of PRD `agentic-foundations`, Epic 1 / stage S3 |
| Status | **Recorded** |
| Date | 2026-11-18 |
| Story | [#1947](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1947) — story 1.1, "Record the OPEA query-path behavioral contract (V02)" |
| Binds | FR-8, FR-29, AR-4 · gates V02 (S3 design) |
| Venue | k3s, namespace `genieai`, chart `genieai-umbrella`, OPEA GPU mode `external` |
| Machine-readable form | [`v02-opea-query-path-contract.fixtures.json`](v02-opea-query-path-contract.fixtures.json) |
| Probe (re-runnable) | [`scripts/baselines/probe-v02-query-path.py`](../../scripts/baselines/probe-v02-query-path.py) |
| Upstream authority | PRD `agentic-foundations`, architecture spine AD-10 (behavior frozen to this record) |
| Owner | the story 1.1 worker · reviewers: the orchestrator's review chain (MR !948) |
| Evidence | the probe run on the venue: `V02 contract verified: the live deployment matches the recorded measurement.` (exit 0), plus the live observations of §7 |
| Reconsideration triggers | the deployed query-path knobs change; the venue is re-based; a story of Epic 1 reports a behavior the record does not describe; the ADR statuses of §9 change |

### FR-29 traceability

```
use case (search the knowledge base, get a grounded answer)
  -> requirement (FR-8 behavior frozen, FR-29 decision records, AR-4)
    -> decision (architecture spine AD-10: clean-slate port, behavior frozen to V02)
      -> investigation (this record + its fixtures + its probe)
        -> merge request (MR !948)
          -> validation evidence (the probe's --verify run and the live observations of §7)
            -> released version (the merge into feat/agentic-foundations/prd)
```

## 1. What this record is, and what it is not

V02 records **what the running OPEA query path actually does** — the semantics the
OPEA-free implementation (story 1.6) must preserve deliberately, and that the
equivalence suite (story 1.9) will prove.

It is **not** a design document, not a comparison engine and not a baseline of the
whole stack (that is story 1.2 / V03). It records:

* the **deployed parameter values** of every knob the query path reads, each with
  its source (chart value, code default, overlay) and its container;
* the **behavior** each knob and each stage produces, with the code that implements
  it;
* the **distinct outcome of every preparation failure class**;
* the **locale coverage** (three locales, one non-Latin script) with the detected
  language, the exact English string handed to the embedder and the status field.

Every parameter value in this record was **read from the running pods** (the
retriever, chatqna, reranker, embedding and backend containers), never inferred
from the repository defaults alone. Where the deployment differs from the code
default, the difference is listed in §6 with its source.

Two kinds of value are **not** parameters and are labelled as such: the locale
strings of §5.6 are a **sample** (the detector is unseeded and the translation
model is sampled — they are recorded as evidence, not as a contract), and the live
observations of §7 are **one run** (they show what the stack did, not what it
always does).

### Re-running the probe

```bash
# measure the live deployment and print the measurement
scripts/baselines/probe-v02-query-path.py --namespace genieai

# compare the live deployment against this record (exit 1 on a configuration drift)
scripts/baselines/probe-v02-query-path.py \
  --verify docs/baselines/v02-opea-query-path-contract.fixtures.json
```

`--verify` is a **configuration** gate: a change in any deployed knob, in the
resolved query instruction, in the translation budget or in the per-behavior
expectations fails it. A difference in the sampled locale strings is reported as a
**warning**, because those strings are not a contract (§1).

The probe is **read-only**: it issues `kubectl get`/`kubectl exec` reads and the
read-only inference calls the deployed preparation code already makes (language
detection, history translation). It writes nothing, restarts nothing and mutates
no data.

## 2. The venue

| Field | Value |
|---|---|
| Cluster | shared k3s (`forge-k3s`), namespace `genieai` |
| Ingress | `genieai-forge.local:4443` |
| Profile | `dev` (overlay values: ConfigMap `genieai-forge-public`, namespace `flux-system`) |
| OPEA GPU mode | `external` — the model services live on `https://ai.assembly.govstack.global:444` |
| Chart values | `values.yaml` = the overlay ConfigMap (rendered from `charts/genieai-umbrella/values.yaml`) |
| Corpus | 3 chunks in `GRAPH_SOURCE` |

## 3. Deployed configuration

### 3.1 Retrieval (retriever container)

| Variable | Deployed | Source |
|---|---|---|
| `ARANGO_DB` | `_system` | chart `charts/genieai-umbrella/values.yaml:323` (`data.arangodb.database`) |
| `ARANGO_GRAPH_NAME` | `GRAPH` | chart `charts/genieai-umbrella/values.yaml:1260` (`retriever.arangoGraphName`) |
| `RETRIEVER_ARANGO_SEARCH_MODE` | `vector` | chart `charts/genieai-umbrella/values.yaml:1269` (`retriever.retrieverArangoSearchMode`) |
| `RETRIEVER_ARANGO_SEARCH_START` | `chunk` | chart `charts/genieai-umbrella/values.yaml:1268` (`retriever.retrieverArangoSearchStart`) |
| `RETRIEVER_ARANGO_DISTANCE_STRATEGY` | `COSINE` | chart `charts/genieai-umbrella/values.yaml:1271` (`retriever.retrieverArangoDistanceStrategy`) |
| `RETRIEVER_ARANGO_USE_APPROX_SEARCH` | `false` | chart `charts/genieai-umbrella/values.yaml:1270` (`retriever.retrieverArangoUseApproxSearch`) |
| `RETRIEVER_ARANGO_K` | `20` | chart `charts/genieai-umbrella/values.yaml:1263` (`retriever.retrieverArangoK`) |
| `RETRIEVER_ARANGO_FETCH_K` | `30` | chart `charts/genieai-umbrella/values.yaml:1264` (`retriever.retrieverArangoFetchK`) |
| `RETRIEVER_ARANGO_SCORE_THRESHOLD` | `0.2` | chart `charts/genieai-umbrella/values.yaml:1265` (`retriever.retrieverArangoScoreThreshold`) |
| `RETRIEVER_ARANGO_DISTANCE_THRESHOLD` | `1` | chart `charts/genieai-umbrella/values.yaml:1266` (`retriever.retrieverArangoDistanceThreshold`) — **read by nobody** (§6) |
| `RETRIEVER_ARANGO_NUM_CENTROIDS` | `1` | chart `charts/genieai-umbrella/values.yaml:1273` (`retriever.retrieverArangoNumCentroids`) |
| `RETRIEVER_ARANGO_FILTER_STRATEGY` | `OR` | chart `charts/genieai-umbrella/values.yaml:1274` (`retriever.retrieverArangoFilterStrategy`) |
| `RETRIEVER_ARANGO_TRAVERSAL_ENABLED` | `true` | chart `charts/genieai-umbrella/values.yaml` (`retriever.retrieverArangoTraversalEnabled`) |
| `RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH` | `2` | chart `charts/genieai-umbrella/values.yaml` (`retriever.retrieverArangoTraversalMaxDepth`) |
| `RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED` | `5` | chart `charts/genieai-umbrella/values.yaml` (`retriever.retrieverArangoTraversalMaxReturned`) |
| `RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD` | `0.7` | chart `charts/genieai-umbrella/values.yaml` (`retriever.retrieverArangoTraversalScoreThreshold`) |
| `RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES` | `10` | chart `charts/genieai-umbrella/values.yaml:1278` (`retriever.retrieverArangoTraversalConcurrentBatches`) — the service caps itself at 4 (§7) |
| `RETRIEVER_ARANGO_TRAVERSAL_MAX_LINKS` | `300000` | chart `charts/genieai-umbrella/values.yaml` (`retriever.retrieverArangoTraversalMaxLinks`) |
| `RETRIEVER_ARANGO_TRAVERSAL_MAX_EDGES_PER_NODE` | `2000` | chart `charts/genieai-umbrella/values.yaml` (`retriever.retrieverArangoTraversalMaxEdgesPerNode`) |
| `RETRIEVER_HYBRID_RETRIEVAL_ENABLED` | `true` | chart `charts/genieai-umbrella/values.yaml:1310` (`retriever.retrieverHybridRetrievalEnabled`) |
| `RETRIEVER_HYBRID_BM25_ANALYZER` | `text_en` | chart `charts/genieai-umbrella/values.yaml:1305` (`retriever.retrieverHybridBm25Analyzer`) |
| `RETRIEVER_HYBRID_BM25_CANDIDATES` | `50` | chart `charts/genieai-umbrella/values.yaml:1302` (`retriever.retrieverHybridBm25Candidates`) |
| `RETRIEVER_HYBRID_RRF_K` | `60` | chart `charts/genieai-umbrella/values.yaml:1301` (`retriever.retrieverHybridRrfK`) |
| `RETRIEVER_HYBRID_DENSE_WEIGHT` | `1.0` | chart `charts/genieai-umbrella/values.yaml:1303` (`retriever.retrieverHybridDenseWeight`) |
| `RETRIEVER_HYBRID_LEXICAL_WEIGHT` | `1.0` | chart `charts/genieai-umbrella/values.yaml:1304` (`retriever.retrieverHybridLexicalWeight`) |
| `RETRIEVER_FANOUT_ENABLED` | `true` | chart `charts/genieai-umbrella/values.yaml:1283` (`retriever.retrieverFanoutEnabled`) |
| `RETRIEVER_FANOUT_MAX_GRAPHS` | `5` | chart `charts/genieai-umbrella/values.yaml:1287` (`retriever.retrieverFanoutMaxGraphs`) |
| `RETRIEVER_FANOUT_PER_GRAPH_TIMEOUT_MS` | `8000` | chart `charts/genieai-umbrella/values.yaml:1288` (`retriever.retrieverFanoutPerGraphTimeoutMs`) |
| `RETRIEVER_FANOUT_CANDIDATE_CAP_PER_GRAPH` | `50` | chart `charts/genieai-umbrella/values.yaml:1285` (`retriever.retrieverFanoutCandidateCapPerGraph`) |
| `RETRIEVER_FANOUT_CANDIDATE_CAP_GLOBAL` | `200` | chart `charts/genieai-umbrella/values.yaml:1284` (`retriever.retrieverFanoutCandidateCapGlobal`) |
| `RETRIEVER_ROUTE_ENABLED` | `true` | chart `charts/genieai-umbrella/values.yaml:1291` (`retriever.retrieverRouteEnabled`) |
| `RETRIEVER_ROUTE_TOP_K` | `40` | chart `charts/genieai-umbrella/values.yaml:1294` (`retriever.retrieverRouteTopK`) |
| `RETRIEVER_ROUTE_MIN_CHUNKS` | `3` | chart `charts/genieai-umbrella/values.yaml:1295` (`retriever.retrieverRouteMinChunks`) |
| `RETRIEVER_ROUTE_PROBE_TIMEOUT_MS` | `2000` | chart `charts/genieai-umbrella/values.yaml:1292` (`retriever.retrieverRouteProbeTimeoutMs`) |
| `RETRIEVER_ROUTE_RETRY` | `1` | chart `charts/genieai-umbrella/values.yaml:1293` (`retriever.retrieverRouteRetry`) |
| `RETRIEVER_ROUTE_HEAD_WEIGHT` | `1.0` | chart `charts/genieai-umbrella/values.yaml:1300` (`retriever.retrieverRouteHeadWeight`) |
| `RETRIEVER_ROUTE_HEAD_MARGIN` | `0.01` | chart `charts/genieai-umbrella/values.yaml:1299` (`retriever.retrieverRouteHeadMargin`) |
| `RETRIEVER_ROUTE_HEAD_FLOOR` | `0.55` | chart `charts/genieai-umbrella/values.yaml:1298` (`retriever.retrieverRouteHeadFloor`) |
| `RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX` | `0.55` | chart `charts/genieai-umbrella/values.yaml:1296` (`retriever.retrieverRouteForbiddenTagMax`) |
| `RETRIEVER_ROUTE_HEADS_SUPERSEDE` | `true` | chart `charts/genieai-umbrella/values.yaml:1297` (`retriever.retrieverRouteHeadsSupersede`) |
| `TEI_EMBEDDING_ENDPOINT` | `https://ai.assembly.govstack.global:444/embed` | chart `charts/genieai-umbrella/values.yaml` (`opea.gpu.nodeHost`) |

### 3.2 Reranking and preparation (chatqna container)

| Variable | Deployed | Source |
|---|---|---|
| `RERANKING_STRATEGY` | `slice` | chart `charts/genieai-umbrella/values.yaml:1192` (`chatqna.rerankingStrategy`) |
| `RERANKING_THRESHOLD` | `0.75` | chart `charts/genieai-umbrella/values.yaml:1193` (`chatqna.rerankingThreshold`) |
| `RERANKER_TOP_N` | `3` | chart `charts/genieai-umbrella/values.yaml:1194` (`chatqna.rerankerTopN`) |
| `RERANKER_SCORE_CALIBRATION` | `none` | chart `charts/genieai-umbrella/values.yaml:1195` (`chatqna.rerankerScoreCalibration`) |
| `RERANKER_SCORE_TEMPERATURE` | `1.0` | chart `charts/genieai-umbrella/values.yaml:1196` (`chatqna.rerankerScoreTemperature`) |
| `RETRIEVER_ARANGO_K` / `FETCH_K` / `SCORE_THRESHOLD` | `20` / `30` / `0.2` | chart `charts/genieai-umbrella/values.yaml:1202-1204` (`chatqna.retrieverArango*`) |
| `RETRIEVER_ARANGO_SEARCH_START` | `chunk` | chart `charts/genieai-umbrella/values.yaml:1207` (`chatqna.retrieverArangoSearchStart`) |
| `RETRIEVER_ARANGO_TRAVERSAL_ENABLED` / `MAX_DEPTH` / `MAX_RETURNED` / `SCORE_THRESHOLD` | `true` / `2` / `5` / `0.7` | chart `charts/genieai-umbrella/values.yaml:1208-1210` (`chatqna.retrieverArangoTraversal*`) |
| `VLLM_TRANSLATION_ENDPOINT` | `https://ai.assembly.govstack.global:444/translation` | overlay (`services.translation.endpoint`) |
| `VLLM_TRANSLATION_MODEL_ID` | `google/gemma-3-4b-it` | overlay (`services.translation.modelId`) |
| `TRANSLATION_SERVICE_HOST_IP` / `PORT` | `translation` / `9031` | chart `charts/genieai-umbrella/values.yaml` |
| `MULTI_TURN_MODE` | `blend` | chart `charts/genieai-umbrella/values.yaml` (`chatqna.env`) |
| `MULTI_TURN_HISTORY_TURNS` | `1` | chart `charts/genieai-umbrella/values.yaml:1201` (`chatqna.multiTurnHistoryTurns`) |
| `MULTI_TURN_BLEND_ENABLED` | `false` | chart `charts/genieai-umbrella/values.yaml:1199` (`chatqna.multiTurnBlendEnabled`) |
| `MULTI_TURN_BLEND_ALPHA` | `0.7` | chart `charts/genieai-umbrella/values.yaml` (`chatqna.multiTurnBlendAlpha`) |
| `MULTI_TURN_CONDENSE_HISTORY_TURNS` | `8` | chart `charts/genieai-umbrella/values.yaml` (`chatqna.env`) |
| `TEI_EMBED_MODEL` | **unset** → the code default `BAAI/bge-large-en-v1.5` applies | code default, `genie-ai-overlay/core/embedding_query_prefix.py:28` |
| `EMBEDDING_QUERY_INSTRUCTIONS` | **unset** → the built-in table only | not templated by the chart |
| `MAX_TRANSLATION_CHARS` | **unset** → the derived budget applies (§5.3) | code default, `genie-ai-overlay/chatqna/genieai_chatqna.py:1321` |
| `TRANSLATION_SERVICE_TIMEOUT` | **unset** → the code default 180 s | code default |
| `LANGUAGE_REGISTRY_FILEPATH` | **unset** → the registry next to the module | code default |

### 3.3 Embedding, reranker and backend containers

| Container | Deployed |
|---|---|
| embedding | `EMBEDDING_MODEL_ID=BAAI/bge-large-en-v1.5`, `TEI_EMBEDDING_ENDPOINT=https://ai.assembly.govstack.global:444/embed` |
| reranker | **no `RERANKING_*` variable at all** — the container's own defaults are inert because chatqna sends the strategy, `top_n` and the threshold explicitly (`genie-ai-overlay/chatqna/genieai_chatqna.py:4936-4944`) |
| backend (BFF) | `OPEA_HOST=chatqna.genieai.svc.cluster.local`, `OPEA_PORT=8888`, `CONTEXT_OPTION=conversation-with-context-labels`, `TRANSLATION_BACKEND=gpu`, `GPU_NODE_HOST=ai.assembly.govstack.global`, `STREAMING_TRANSLATION_ENABLED=1` |

## 4. Behavior catalog

Every entry states **inputs**, the **deployed parameter values**, the **expected
output** and the **code** that produces it. The machine-readable form (with the
same content, and with the knobs scoped to their container) is in the fixtures
file.

### 4.1 Dense retrieval — brute-force cosine by default

* **Inputs** — the English retrieval query; the query vector (1024 dimensions,
  computed from the **prefixed** query); `search_start=chunk`; `k=20`.
* **Deployed** — search mode `vector`, distance strategy `COSINE`,
  `use_approx_search=false`, `k=20`, `fetch_k=30`, `score_threshold=0.2`,
  `num_centroids=1`, database `_system`, graph `GRAPH`.
* **Expected output** — a search over `GRAPH_SOURCE`
  (`asimilarity_search_with_relevance_scores(query, embedding, k, score_threshold,
  use_approx=False, filter_clause=<label clause or empty>)`), ordered by descending
  relevance score. `use_approx_search=false` means an **exact scan**: the vector
  index dataprep builds is not consulted on the query path. An empty leg is not a
  failure — the BM25 leg can still rescue the query, because fusion runs before
  the empty check. An empty **retrieval** is not harmless either: chatqna then
  abstains with `abstention_reason=no_documents_retrieved` (§4.12).
* **Code** — `genie-ai-overlay/retriever/config.py:63-71`,
  `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1502-1507`,
  `:1763-1813`; `genie-ai-overlay/chatqna/genieai_chatqna.py:4907-4935`.
* **ADR evidence** — `okf-039` (retrieval mode governance).

### 4.2 BM25 leg — native ArangoSearch analyzer view

* **Inputs** — the **raw** English query (never the prefixed one):
  `TOKENS(@query, @analyzer)`.
* **Deployed** — hybrid retrieval enabled, analyzer `text_en`,
  `RETRIEVER_HYBRID_BM25_CANDIDATES=50`.
* **Expected output** — the view `GRAPH_BM25_VIEW` (an ArangoSearch view over
  `GRAPH_SOURCE`, created at runtime by the retriever: on boot for the default
  graph, lazily per graph on first use; a creation failure is logged and never
  raised), queried with

  ```aql
  FOR doc IN `GRAPH_BM25_VIEW`
      SEARCH ANALYZER(doc.text IN TOKENS(@query, @analyzer), @analyzer)
      <label clause>
      LET _bm25_score = BM25(doc)
      SORT _bm25_score DESC
      LIMIT @n
      RETURN { "key": doc._key, "text": doc.text, "chunk_labels": doc.chunk_labels, "score": _bm25_score }
  ```

  with `n = max(RETRIEVER_ARANGO_K, RETRIEVER_HYBRID_BM25_CANDIDATES) = 50`, ordered
  by descending BM25 score. Any error in the leg is logged (`BM25 search failed on
  view ...`) and the leg returns `[]`.
* **Code** — `genie-ai-overlay/retriever/config.py:111-115`, `:123`,
  `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:833-878`, `:880-936`,
  `:1851-1854`.
* **Provenance** — this leg is specified by a **SPEC**, not by an ADR:
  `_bmad-output/implementation-artifacts/spec-hybrid-retrieval-bm25-rrf.md`.
  (`okf-024`'s BM25 is a different mechanism — repo-metadata ranking over
  `okf_concepts_meta` for graph *selection* — and does not cover this leg.)

### 4.3 RRF fusion

* **Inputs** — the dense leg results and the lexical leg results.
* **Deployed** — `rrf_k=60`, dense weight `1.0`, lexical weight `1.0`.
* **Expected output** — `score(doc) += weight / (rrf_k + rank)`, the rank counted
  per channel over newly seen ids only; identity is the chunk `_key` (the
  `COLLECTION/` prefix stripped), a document without a key is kept standalone.
  The fused list is sorted by descending score (ties keep insertion order, which
  favours the dense channel) and then **truncated to `k` (20)**. A fusion error
  logs (`Hybrid BM25+RRF fusion failed, falling back to dense-only`) and the
  dense-only list is used.
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:592-632`,
  `:1870-1891`.
* **ADR evidence** — `okf-027` (cross-graph RRF).

### 4.4 Label filter strategy

* **Inputs** — the requested labels, encoded in the `search_start` carrier or built
  from the request context.
* **Deployed** — `RETRIEVER_ARANGO_FILTER_STRATEGY=OR`.
* **Expected output** — the filter is applied to `doc.chunk_labels`:
  `OR` → `FILTER (doc.chunk_labels != null) AND (["L1","L2"] ANY IN doc.chunk_labels)`;
  `AND` → the same with `ALL IN`. With no labels requested, **no clause is emitted
  at all**.
  * An invalid strategy **in the environment** is not an HTTP error: the retriever
    raises `ValueError` **at import** (`genie-ai-overlay/retriever/config.py:81-88`), so the pod crash-loops
    and the client sees 503.
  * An invalid strategy **in a per-request override** is an HTTP 400
    (`retriever:421-426`), reachable only when labels are requested.
* **Code** — `genie-ai-overlay/retriever/config.py:81-88`,
  `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:391-426`.
* **ADR evidence** — `okf-033` (label onboarding).

### 4.5 Defense-in-depth post-filter

* **Inputs** — the dense leg results, each BM25 row, and the same requested labels.
* **Expected output** — every result whose `chunk_labels` do not satisfy the
  strategy is dropped **again in Python**, after the database-side filter (the
  database filter is not trusted on its own). A chunk with no labels is dropped
  whenever a label filter is active; with no filter active every result passes.
  There is **no score-threshold post-filter** in the retriever — the score
  threshold lives inside the similarity-search call.
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:302-315`,
  `:921-923`, `:1819-1833`.
* **ADR evidence** — `okf-011` (no raw AQL exposed to agents).

### 4.6 file_id enrichment

* **Inputs** — the `_key` of every surviving chunk.
* **Expected output** — **one batched AQL for all chunks** (not one round trip per
  chunk):

  ```aql
  FOR doc IN `GRAPH_SOURCE` FILTER doc._key IN @chunk_ids RETURN { key: doc._key, file_id: doc.file_id }
  ```

  `metadata.file_ids` is a **list**: `[file_id]` when the chunk carries one, `[]`
  when it does not (never `null`, never a missing key).
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1921-1940`.

### 4.7 CAP-1 identity join — tolerated absence

* **Inputs** — the chunk `_key`s, the leg's `graph_name`, and the chunk's own
  `file_id` (treated as the `concept_id`).
* **Expected output** —

  ```aql
  FOR doc IN `GRAPH_SOURCE`
      FILTER doc._key IN @chunk_ids
      LET meta = FIRST(
          FOR m IN okf_concepts_meta
              FILTER m.graph_name == @graph_name AND m.concept_id == doc.file_id
              RETURN m
      )
      RETURN { key: doc._key, repo_id: meta.repo_id, bundle_version: meta.bundle_version }
  ```

  * identity document present → `metadata.repo_id` and `metadata.bundle_version`
    are set;
  * **identity document absent** → the two keys are simply **not set**: the chunk
    is served unattributed, with no warning and no sentinel;
  * **join failure** (the collection missing, a database error) → the whole
    enrichment is skipped, an ERROR is logged (`OKF identity enrichment failed
    (chunk identity left as-is): ...`) and the leg is **not** broken.
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1941-1975`.
* **ADR evidence** — `okf-012` (multi-graph grounding), `okf-013` (graph-name
  wiring).

### 4.8 Provenance attach

* **Expected output** — `graph_name` is always set to the leg's graph; `concept_id`
  is the chunk's `file_id` when derivable; `repo_id` is set only when the caller
  passes one (never in the legacy single-graph path).
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:2345-2377`.

### 4.9 Graph traversal — the deployed stage that rewrites the chunk text

* **Inputs** — the enriched chunk results and the leg's graph (`GRAPH_LINKS_TO`
  edges).
* **Deployed** — traversal enabled, `max_depth=2`, `max_returned=5`,
  `score_threshold=0.7`, `concurrent_batches=10` (the service caps itself at 4),
  `max_links=300000`, `max_edges_per_node=2000`.
* **Expected output** — the traversal **runs on the deployed chat path**:
  chatqna forwards `enable_traversal` from `RETRIEVER_ARANGO_TRAVERSAL_ENABLED`
  (`true`). Each surviving chunk's `page_content` is then **rewritten**:

  ```text
  <chunk text>
  ------
  RELATED INFORMATION:
  ------
  <the neighbourhood>
  ```

  so the documents the reranker scores and the LLM reads are **text-augmented**,
  not the raw chunk. At most 5 neighbours per chunk, at most 2 hops, each
  neighbour above the 0.7 score threshold. A graph above `max_links` (300000)
  skips the traversal entirely — its fused vector results stand alone. A failed
  traversal leaves the zeros it found: the leg continues **without** graph
  enrichment.
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1981-2131`,
  `:2073-2080`; `genie-ai-overlay/chatqna/genieai_chatqna.py:4915-4926`.
* **ADR evidence** — `okf-012` (multi-graph grounding).

### 4.10 Multi-graph fan-out

* **Deployed** — enabled, at most 5 graphs, an 8 s per-graph deadline, 50
  candidates per graph, 200 candidates globally.
* **Expected output** — the fan-out engages only when the carrier names at least
  one graph (an empty carrier keeps the legacy single-graph path). A timed-out or
  failed leg is a **zero-hit leg**: the fusion continues with the surviving legs.
  The second-level cross-graph fusion is an **unweighted** RRF keyed on
  `(graph_name, chunk_id)`, truncated to `min(k, 200)`.
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:2413-2483`,
  `:2380-2410`.
* **ADR evidence** — `okf-012`, `okf-027`.

### 4.11 Graph routing gate

* **Deployed** — enabled, `top_k=40`, `min_chunks=3`, a 2 s probe timeout, 1 retry,
  head weight `1.0`, head margin `0.01`, head floor `0.55`, forbidden-tag max
  `0.55`, heads supersede `true`.
* **Expected output** — routing is **skipped** (and the full carrier is fanned out)
  when it is disabled, when there is no query embedding, or when fewer than two
  OKF graphs are on the carrier. The gate order is **FLOOR** (`score < head floor`)
  → **VETO** (a forbidden per-tag vector at cosine ≥ `forbidden_tag_max`) →
  **MARGIN** (`score − forbidden-centroid cosine ≤ head_margin`); a head passes
  only if every applicable gate passes. When any head passes, **only the claimed
  graphs are searched** and the chunk probe is skipped entirely. Without claims,
  the per-graph probe qualifies a graph with at least 3 hits, and the best-count
  graph qualifies even when none reaches the minimum. A failed probe **degrades**
  to searching all carrier graphs (`ROUTING DEGRADED ...`).
* **Code** — `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:2486-2713`.
* **ADR evidence** — `okf-024` (graph selection router).

### 4.12 Query-instruction prefix — a **model-specific** contract

* **Inputs** — the embedding model id (`TEI_EMBED_MODEL`, falling back to the code
  default `BAAI/bge-large-en-v1.5`) and the deployer overrides
  (`EMBEDDING_QUERY_INSTRUCTIONS`, comma-separated `substring=instruction` pairs).
* **Deployed** — `TEI_EMBED_MODEL` unset, `EMBEDDING_QUERY_INSTRUCTIONS` unset, and
  the embedding service serves `BAAI/bge-large-en-v1.5`. **Resolved instruction:
  `Represent this sentence for searching relevant passages: `**
* **Expected output** — resolution order: the deployer overrides first (first match
  wins), then the built-in table (first match wins, most specific entry first).
  A model with no entry — `BAAI/bge-m3`, `sentence-transformers/*`,
  `mxbai-embed-large`, `text-embedding-3-*` … — gets **no prefix**: the query is
  embedded raw. The prefix applies to the **query only**; passages are embedded
  without it at ingestion. The chat path sends the **prefixed** text to the
  embedder and the **raw** text to the retriever, so the BM25 leg tokenizes the
  bare query.
* **Code** — `genie-ai-overlay/core/embedding_query_prefix.py:28-121`,
  `genie-ai-overlay/chatqna/genieai_chatqna.py:2501-2518`,
  `genie-ai-overlay/retriever/genieai_retriever_arangodb.py:1711-1733`.

### 4.13 TEI reranking and evidence selection

* **Inputs** — the retrieval query and the retrieved documents, in retrieval order,
  **with the traversal-augmented text** (§4.9).
* **Deployed** — `RERANKING_STRATEGY=slice`, `RERANKER_TOP_N=3`,
  `RERANKING_THRESHOLD=0.75`, `RERANKER_SCORE_CALIBRATION=none`,
  `RERANKER_SCORE_TEMPERATURE=1.0`.
* **Invocation** — chatqna → `POST {RERANK_SERVER_HOST_IP}:{RERANK_SERVER_PORT}/v1/reranking`
  → TEI `POST {base_url}/rerank` with `{"query": ..., "texts": [...], "truncate": false}`.
  **No `top_n` is sent to TEI** and **no Authorization header** is sent (the TEI
  call carries the trace context only). The TEI call carries a 300 s total timeout
  and a 30 s connect timeout; there is no retry.
* **Strategies** —

  | Strategy | Behaviour | Bounded by `RERANKER_TOP_N`? | Uses `RERANKING_THRESHOLD`? |
  |---|---|---|---|
  | `slice` (deployed) | keeps the first `top_n` entries of the score-descending response | yes | no |
  | `threshold` | keeps every document with `score >= threshold` | no | yes |
  | `slice_threshold` | keeps documents with `score >= threshold`, capped at `top_n` | yes | yes |
  | `knee_threshold` | keeps the `knee + 1` leading entries of the score curve | no | **no** |
  | `adaptive` | keeps every candidate whose value is strictly greater than the minimum value threshold | **no** | no |

  `adaptive` hard-fails (`RuntimeError`) when the chunk embeddings are missing or
  misaligned.
* **Order** — the selected passages keep the reranker's **score-descending** order
  all the way into the prompt and into `source_documents`. There is no explicit
  tie-break: equal scores keep TEI's relative order.
* **Calibration** — `none` returns the raw TEI score; `sigmoid` returns
  `1/(1+exp(-score/temperature))`. The calibration is applied at **confidence
  time only**, never to the selection comparisons.
* **Empty outcomes** — the two abstentions are **distinct**:
  * the reranker selected nothing → the LLM receives the abstention instructions
    instead of documents: `abstained=true`,
    `abstention_reason=reranker_selected_nothing`;
  * the retriever returned nothing → `abstained=true`,
    `abstention_reason=no_documents_retrieved`.
* **Code** — `genie-ai-overlay/reranker/genieai_tei_reranker.py:326-337`, `:353-379`,
  `:453-616`; `genie-ai-overlay/chatqna/genieai_chatqna.py:4936-4944`, `:3057-3066`,
  `:3121-3123`, `:1852-1860`.

### 4.14 Reranker-down — one behavior per failure mode

| Failure | Outcome |
|---|---|
| unreachable / timeout | the error propagates: **no evidence, the turn fails** (503 `llm_unavailable` for a transport/model-discovery error, otherwise 500). There is **no fallback to the retrieval order** |
| HTTP 422 (input too long) | HTTP 200 with `abstained=true`, `abstention_reason=reranker_input_too_long` and an English abstention text |
| any other HTTP error | `RuntimeError` → 500 → the turn fails |
| unexpected response body | `RuntimeError` → 500 → the turn fails |
| score count ≠ document count | **not fatal**: a warning is logged, the selection proceeds |
| index out of range | **not fatal**: the document is skipped |
| opaque 5xx seen as an empty result | the LLM receives the abstention instructions: `abstained=true`, `abstention_reason=reranker_selected_nothing` |

* **Code** — `genie-ai-overlay/reranker/genieai_tei_reranker.py:376-448`,
  `genie-ai-overlay/reranker/genieai_reranking_microservice.py:136-163`,
  `genie-ai-overlay/chatqna/genieai_chatqna.py:5035-5121`.

## 5. The preparation pipeline

### 5.1 Order of operations

1. the caller names a language (`context.language`) or names none;
2. when none is named — or the named code was refused — the **last user message**
   is language-detected (`langdetect`);
3. the detected code becomes the **history language** whether or not the
   translation models cover it: the history still has to be normalized to English
   for the English-only embedding space. Only the **answer** language falls back
   to `EN` when the detected code is unsupported (`chatqna:4626-4644`);
4. when the history language is not `EN`, the history is **translated to English**
   (the target is always English — the language of the embedding space — never the
   language the caller asked the answer in);
5. the **last `USER:` segment** of the translated history becomes the retrieval
   query (with the whole blob as the fallback when the marker is absent);
6. the query-instruction prefix is applied and the query is embedded;
7. `query_translation_status` is stamped on the orchestrate span and in the
   response metadata.

* **Code** — `genie-ai-overlay/chatqna/genieai_chatqna.py:4578-4661` (detection),
  `:4666-4672` (the history language), `:4681-4752` (status and translation),
  `:4786-4806` (query extraction), `:1321-1322` (budget constant and marker
  pattern).
* **Registry** — `genie-ai-overlay/chatqna/language-registry.json`, a symlink to
  the backend's shared registry (`components/gov-chat-backend/services/translation/language-maps/language-registry.json`):
  **41 language codes**. The path is overridable with `LANGUAGE_REGISTRY_FILEPATH`
  (unset on the venue).

### 5.2 Status values

| Status | Meaning |
|---|---|
| `translated` | the history was translated to English |
| `passthrough_english` | the history was already English **and** English was established (named by the caller and not refused, or concluded by detection) |
| `passthrough_unknown_language` | English was **not** established: no language was named and none could be detected, the detection crashed, **or the named code was refused** — a refused code lands here even though a language was named |
| `fallback_timeout` | the translator timed out — the **source-language** history is embedded |
| `fallback_error` | the translation failed for any other reason (blank input, blank completion, unreadable registry, model failure) — the **source-language** history is embedded |

The backend forwards the status **by presence**: on the streamed path the key is
absent when chatqna omitted it; on the JSON path the key is always present and may
be `null` (`components/gov-chat-backend/services/query-service.js:488-518`).

### 5.3 Bounds

| Bound | Deployed behavior |
|---|---|
| translation window | **8192 tokens** (discovered from the translation endpoint at runtime) |
| history character budget | **11520 characters** = `(window − 512) // 2 × 3`. `MAX_TRANSLATION_CHARS` is **unset**: the 2000-character code constant is only the **fallback** used when the window discovery fails, and an explicit value only *lowers* the derived budget |
| single-message shape | a history over the budget is **refused**: `TranslationInputTooLongError` → HTTP 422 (§5.4) |
| list shape (the deployed BFF shape) | an oversized history is **never refused**: the oldest turns are dropped and the newest message's tail is truncated to the budget |
| generation-time overflow | the **oldest history segments** are dropped; the retrieved documents are never truncated |
| BFF-side bounds | the HTTP body limit is 50 MB and the requested language is truncated to 32 characters; the BFF imposes **no** query or history length bound |

* **Code** — `genie-ai-overlay/chatqna/genieai_chatqna.py:821-847` (the window and
  the budget), `:894-909` (the single-message refusal), `:912-968` (the list-shape
  trim).

### 5.4 Failure classes — three distinct outcomes

| Class | Trigger | Expected outcome |
|---|---|---|
| **translator unavailable** | the translation endpoint is unreachable, errors, or times out | the turn **still answers**; the **source-language** history is embedded (degraded retrieval) and the status is `fallback_timeout` (timeout) or `fallback_error` (other failure). The status makes the degradation visible |
| **oversized input** | the history does not fit the translation window (`TranslationInputTooLongError`) — in the single-message shape the **char budget** refuses it, in the deployed list shape it is the **translation window** that overflows | the turn is **refused**: chatqna answers **HTTP 422** with `{"detail": {"error": "translation_input_too_long", "message": ..., "abstained": true, "abstention_reason": "translation_input_too_long"}}`. There is **no untranslated fallback** |
| **translation returning blank** | the translation model answers 200 with an empty completion | the turn **still answers**; the source-language history is embedded and the status is `fallback_error`. A blank translation is a failure, never a silent success |

* **Code** — `genie-ai-overlay/chatqna/genieai_chatqna.py:152-191` (the exception
  family), `:971-993` (the 422 body), `:4753-4781` (the query-path propagation).

### 5.5 The BFF boundary — what the client actually sees

The 422 of §5.4 is **chatqna's** answer. The BFF does not forward it verbatim:

| Path | What the client receives |
|---|---|
| streaming (`POST /api/queries/stream`) | the response headers are already sent, so the 422 becomes an SSE error frame: `{"type":"error","message":"Request failed with status code 422","code":"STREAM_ERROR"}` on an HTTP 200 |
| non-streaming (`POST /api/queries`) | the upstream status is discarded by the worker bridge: the client receives **HTTP 500** with `{"message": ...}` — the `abstained: true` body is lost |

* **Code** — `components/gov-chat-backend/routes/query-routes.js:351`, `:680-698`,
  `:898-909`; `components/gov-chat-backend/services/opea-worker.js:55-67`,
  `components/gov-chat-backend/services/query-service.js:304-311`.

The BFF otherwise plays no part in the preparation: it normalizes the requested
language, refuses a language the loaded translation backend does not know (HTTP
400 `UNSUPPORTED_LANGUAGE`), and translates the **answer**. It never detects a
language and never translates the query.

**Deployed BFF values** (measured): `CONTEXT_OPTION=conversation-with-context-labels`
— the BFF sends the conversation as a **message list**, which is the shape of §5.3;
`TRANSLATION_BACKEND=gpu` with `GPU_NODE_HOST=ai.assembly.govstack.global` — the
answer is translated by the GPU translation API, not by the CPU model;
`STREAMING_TRANSLATION_ENABLED=1` — the streaming answer is translated as it
streams.

### 5.6 Locale coverage

Three locales, one of them written in a **non-Latin script**. The detected
language, the exact English string handed to the embedder and the status field are
recorded for each, measured on the running stack by the probe.

| Locale | Sample | Detected | Status | Exact English string sent to the embedder |
|---|---|---|---|---|
| `fr` | *Bonjour, comment la ville de Geneve gere-t-elle les services de transport public pour les habitants et les visiteurs ?* | `FR` | `translated` | `Represent this sentence for searching relevant passages: Hello, how does the city of Geneva manage public transport services for residents and visitors?` |
| `es` | *¿Como gestiona la ciudad de Barcelona los servicios de transporte publico para los residentes y los visitantes?* | `ES` | `translated` | `Represent this sentence for searching relevant passages: How does the city of Barcelona manage public transport services for residents and visitors?` |
| `ar` | *كيف تدير مدينة دبي خدمات النقل العام للسكان والزوار خلال موسم الصيف؟* | `AR` | `translated` | `Represent this sentence for searching relevant passages: How does Dubai manage public transportation services for residents and visitors during the summer season?` |

The embedded string is the query-instruction prefix (§4.12) followed by the
English retrieval query (§5.1 step 5).

**These strings are a sample, not a contract.** `langdetect` runs without a fixed
seed and the translation model is sampled, so a re-run may produce a different
wording or a different detected code. The probe therefore reports a difference in
them as a **warning**; the contract is the *shape* (detected language, English
string, status field), the *vocabulary* of §5.2 and the deployed budget of §5.3.

## 6. Deployed values that differ from the repository defaults

| Knob | Code default | Deployed | Source |
|---|---|---|---|
| `RETRIEVER_ARANGO_K` | `4` | `20` | chart `charts/genieai-umbrella/values.yaml:1202` (`chatqna.retrieverArangoK`) |
| `RETRIEVER_ARANGO_FETCH_K` | `20` | `30` | chart `charts/genieai-umbrella/values.yaml:1203` (`chatqna.retrieverArangoFetchK`) |
| `RETRIEVER_ARANGO_SCORE_THRESHOLD` | `0.1` | `0.2` | chart `charts/genieai-umbrella/values.yaml:1204` (`chatqna.retrieverArangoScoreThreshold`) |
| `RETRIEVER_ARANGO_SEARCH_START` | `node` (retriever) / `chunk` (chatqna) | `chunk` | chart `charts/genieai-umbrella/values.yaml:1207` (`chatqna.retrieverArangoSearchStart`) |
| `ARANGO_DB` | `genie-ai` | `_system` | chart `charts/genieai-umbrella/values.yaml:323` (`data.arangodb.database`) |
| `RERANKING_STRATEGY` | `adaptive` (chatqna) / `slice` (reranker container) | `slice` | chart `charts/genieai-umbrella/values.yaml:1192` (`chatqna.rerankingStrategy`) |
| `RERANKING_THRESHOLD` | `0.9` (chatqna) / `0.75` (reranker container) | `0.75` | chart `charts/genieai-umbrella/values.yaml:1193` (`chatqna.rerankingThreshold`) |
| `TEI_EMBED_MODEL` | `BAAI/bge-large-en-v1.5` | unset → the code default applies | code default (`genie-ai-overlay/core/embedding_query_prefix.py:28`); the chart does not template it |
| `EMBEDDING_QUERY_INSTRUCTIONS` | unset | unset | not templated by the chart; the built-in table applies |
| `MAX_TRANSLATION_CHARS` | `2000` — the **fallback** used only when the window discovery fails | unset → the derived budget of **11520** characters | code default (`genie-ai-overlay/chatqna/genieai_chatqna.py:1321`); the derivation is `genie-ai-overlay/chatqna/genieai_chatqna.py:821-847` |
| `RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES` | `1` | `10` (the service caps itself at 4) | chart `charts/genieai-umbrella/values.yaml:1278` (`retriever.retrieverArangoTraversalConcurrentBatches`) |

Two of these are **not merely different, they are inert**:

* `RETRIEVER_ARANGO_DISTANCE_THRESHOLD` is forwarded by chatqna but **never read by
  the retriever** — it has no effect on the deployed stack.
* `RETRIEVER_ARANGO_FETCH_K` is only consulted by the `mmr` branch, which the
  deployed search mode (`vector`) never selects.

## 7. Live observations on the venue

| Observation | Meaning |
|---|---|
| `Hybrid RRF fusion: 3 documents after fusing dense + BM25.` / `Extraction summary — graph=GRAPH, dense=3, bm25=1, fused=3, labels=[], filter_strategy=OR` / `Found 3 documents.` | the dense leg, the BM25 leg, the RRF fusion and the label strategy all run as recorded |
| the result metadata carries `file_ids` (one id), `chunk_key`, `graph_name=GRAPH`, and `query_embedding` on the first result only | the file_id enrichment and the provenance attach behave as recorded |
| `OKF identity enrichment failed (chunk identity left as-is): [HTTP 404][ERR 1203] collection or view not found: okf_concepts_meta` | the venue has **no `okf_concepts_meta` collection**, so the CAP-1 join fails as a whole: `repo_id` and `bundle_version` are absent from every result and the chunks are served unattributed. This is the *collection-level* tolerated absence, logged as an ERROR |
| the reranker returned three documents with scores `0.674801`, `0.6280653`, `0.0012018913`, in descending score order | the `slice` strategy with `top_n=3` keeps the score-descending order |
| `[Arango Traversal] ARANGO_TRAVERSAL_CONCURRENT_BATCHES=10 is above the safe cap (4). Capping to 4.` | the chart declares 10 concurrent batches; the service caps itself at 4 |
| the deployed translation window is **8192 tokens** and the derived history budget **11520 characters** | the char budget of §5.3 is measured, not derived from the constants |
| the BFF serves `CONTEXT_OPTION=conversation-with-context-labels`, `TRANSLATION_BACKEND=gpu`, `STREAMING_TRANSLATION_ENABLED=1` | the message-list shape and the GPU answer translation of §5.5 are measured |

## 8. Known gaps

1. The venue corpus holds **3 chunks**, so result-**level** fixtures (which
   documents come back for a given query) are not stable and are not recorded.
   This record captures the **behavior** — order, shape, statuses, enrichment —
   not a corpus snapshot.
2. `langdetect` runs without a fixed `DetectorFactory` seed, and the translation
   model is sampled: the recorded locale strings are a **sample** (§5.6).
3. The chart templates the `RETRIEVER_HYBRID_*` knobs for the **retriever**
   container only; the chatqna container does not carry them.
4. The CAP-1 join is exercised on a venue whose `okf_concepts_meta` collection is
   absent. The "identity document present" branch of §4.7 is therefore recorded
   from the code, not from a live hit.
5. The deployed venue carries a single graph (`GRAPH`). The fan-out (§4.10) and
   routing (§4.11) behaviors are recorded from the code and the deployed knobs,
   not from a live multi-graph run.

## 9. Decision records

Per FR-29 the record links the decision records that establish its behaviors, and
their status is checked before reliance (an ADR still marked `Proposed` is not
treated as accepted):

| ADR | Status | Bears on |
|---|---|---|
| `okf-011` — no raw AQL exposed to agents | Accepted | §4.5 (the post-filter is parameterized) |
| `okf-012` — multi-graph grounding via retriever extension | Accepted | §4.7, §4.8, §4.9, §4.10 |
| `okf-013` — thread `graph_name` end-to-end | Accepted | §4.7, §4.8 |
| `okf-024` — the graph selection router | **Proposed** | §4.11 (the routing gate only — **not** the BM25 leg of §4.2) |
| `okf-027` — cross-graph RRF | **Proposed** | §4.3, §4.10 |
| `okf-033` — label onboarding | **Proposed** | §4.4 |
| `okf-039` — retrieval mode governance | Accepted | §4.1 |

Two behaviors have **no** ADR: the BM25 lexical leg (§4.2) and the query-instruction
contract (§4.12) are specified by code and by a SPEC
(`_bmad-output/implementation-artifacts/spec-hybrid-retrieval-bm25-rrf.md`), not by a
decision record. They are recorded here so that the gap is visible rather than
silent.

The architecture spine's AD-10 is the decision that freezes the behavior to this
record; the spine itself is the umbrella's planning artifact, not an ADR.

## 10. Downstream use

* **Story 1.6** (the OPEA-free search port) implements the semantics of §4 and
  exposes the same knobs, with the same values.
* **Story 1.8** (the input-preparation module) implements §5, including the three
  failure classes of §5.4 with their distinct outcomes.
* **Story 1.9** (the E01 equivalence suite) asserts against the fixtures file.
