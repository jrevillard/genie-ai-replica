---
title: Data Labelling Strategy
description: How GENIE.AI labels ingested chunks against the service-category taxonomy and uses those labels to filter retrieval.
weight: 7
aliases:
  - /docs/rag/data-labeling/
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Labelling is what keeps a multi-domain knowledge base from bleeding across
topics. Every chunk is assigned one or more labels drawn from the
service-category taxonomy, and at query time the retriever uses those
labels to return only on-topic chunks. Without labels, a question about one
service could pull in unrelated chunks from another.

This page is for developers configuring dataprep and operators debugging
why retrieval is (or is not) constrained to the right topic.

## Prerequisites

- Familiarity with [Knowledge base → Labelling & Taxonomy]({{< relref "/docs/knowledge-base/labelling-taxonomy" >}})
  — the curated vocabulary chunks are labelled against.
- The Dataprep service is healthy (`docker service ls | grep dataprep-arango-service`).
- The labelling LLM (set by `VLLM_LLM_MODEL_ID`) must support
  OpenAI-compatible guided JSON output (`response_format={"type":
  "json_object"}`). Validated on `ibm-granite/granite-4.1-8b`. See
  [Choosing models → Role 2: Chunk Labeling]({{< relref "choosing-models" >}}).
- For Contextual Retrieval interactions, see
  [Contextual Retrieval]({{< relref "contextual-retrieval" >}}).

## Why label chunks?

Most RAG pipelines rely solely on **vector embeddings** for semantic
similarity. While powerful, vector-only retrieval suffers from:

- False positives (semantically similar but irrelevant chunks).
- Lack of interpretability (hard to explain *why* a chunk was retrieved).
- Poor performance in domain-specific contexts where the taxonomy and
  relationships between topics matter.

Labelling adds an explicit semantic signal on top of the vector space. At
query time the retriever applies a label filter so a query about "visa
renewal" only sees chunks whose labels match a visa-related category, not
chunks tagged for agriculture or healthcare. This is what keeps a
multi-domain knowledge base coherent.

## Labelling pipeline at a glance

```
Upload → Docling (parse) → Chunker → [Contextual prefix] → LLM label call (JSON)
   → [Embed (contextualised text)] → ArangoDB (chunks + labels + graph edges)
```

Stages 4-6 run inside the dataprep service
(`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`).

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `LABEL_SELECTOR_SYSTEM_PROMPT` | built-in | System prompt for the labelling LLM. Override in `.env`. |
| `DATAPREP_LLM_LABEL_BATCH_SIZE` | 4 | Chunks per LLM labelling call (one call returns `{"0": [...], "1": [...]}`). |
| `DATAPREP_LLM_TEMPERATURE` | 0.0 | Sampling temperature for the labelling call. `0` for deterministic output. |
| `DATAPREP_MAX_CONCURRENT_BATCHES` | 20 | Concurrent in-flight labelling calls. |
| `CONTEXTUAL_LABEL_RAW` | `true` | Decouple labelling from context: label the raw chunk, embed the contextualised text. |
| `CONTEXTUAL_RETRIEVAL_ENABLED` | `true` | Generate the per-chunk (or per-doc) context prefix. |
| `CONTEXTUAL_STRATEGY` | `doc_level` (docker-compose) / `per_chunk` (env template & code default) | `per_chunk` (Anthropic recipe) or `doc_level` (N× cheaper). docker-compose runtime default is `doc_level`; the env template and the in-code default are `per_chunk`. |
| `VLLM_LLM_MODEL_ID` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | The labelling LLM — recommended `ibm-granite/granite-4.1-8b` for guided JSON. |

## Document-scope labels (`file_labels`)

Each document carries a candidate-label set, `file_labels`, supplied at
upload time (defaults to the full taxonomy; admins can narrow it per
document in the admin UI). Chunks are **constrained to this set** at
labelling time — any taxonomy-valid label that falls outside the
document's scope is dropped before storage. This stops a single-crop
guide from being labelled with sibling-crop suggestions (cucumber guide
picking up "tomato" or "cabbage").

Documents without `file_labels` keep all taxonomy-validated labels.
Dropped labels are recorded in the ingestion log for observability.

## Output contract

The LLM is asked to return a JSON object mapping each chunk to its
labels. The exact prompt template is in `LABEL_SELECTOR_SYSTEM_PROMPT`
(the built-in default lives in `genieai_dataprep_arangodb.py`); the user
prompt is `Input: {chunk_text}\nLabels: {taxonomy_list}`. Sampling is
`0.0` with `response_format={"type": "json_object"}`; the per-chunk call
uses `max_tokens=160` and the batched call uses `max_tokens=len(batch) * 256 + 512`.
(`DATAPREP_CONTEXTUAL_MAX_TOKENS` is unrelated — it caps the
Contextual-Retrieval context-generation call, not labelling.)

The label set returned by the LLM is then intersected with `file_labels`.
Anything outside the document scope is dropped with an ingestion-log
warning.

## Failure modes (labelling)

| Symptom | Likely cause | Fix |
|---|---|---|
| Model returns `{"labels": [{"name": "Procurement"}]}` (dict, not string) | LLM ignores the prompt's "array of strings" instruction | Switch to a model with strong JSON adherence (`ibm-granite/granite-4.1-8b`); or switch to `LABELING_STRATEGY=embedding`. |
| Model returns conversational text `"Here are the labels: Procurement, Finance"` | LLM does not support guided JSON | Same fix; guided JSON constrains the output format. |
| Invented labels (not in taxonomy) | Model hallucinating | The code handles this with warnings and ingestion-log entries; tune the system prompt or switch models. |
| Inconsistent format (works on some chunks, fails on others) | Non-determinism at `temperature>0` | `DATAPREP_LLM_TEMPERATURE=0.0` is set; if overridden, restore. |
| All chunks get the document's main label only | Sub-category structure may be too granular for the model | Simplify the taxonomy, or use a more capable LLM. |
| Labels drift to neighbouring categories | Taxonomy may be too coarse for the corpus | Refine the taxonomy or split categories. |
| Many chunks get `[]` | Usually correct (no taxonomy match) | Verify the taxonomy loaded correctly (some chunks DO get specific labels) before assuming a bug. |

See [Debugging with Tracing & Logs]({{< relref "/docs/operate" >}})
for the recipe to inspect the labels a single chunk received.

## Alternative labelling strategies

If your LLM cannot reliably produce JSON, or you want a faster path on
limited hardware, the dataprep supports two non-LLM strategies:

| Strategy | How it labels | Trade-offs |
|---|---|---|
| `llm` (default) | LLM with guided JSON | Highest precision, requires JSON-capable LLM. |
| `embedding` | Cosine similarity between chunk embedding and label-prototype embeddings | No guided JSON required; lower precision than `llm`. |
| `bm25` | Lexical match of chunk text against label keywords | Fastest; very low precision; CPU-only. |

See [Knowledge base → Labelling & Taxonomy]({{< relref "/docs/knowledge-base/labelling-taxonomy" >}})
for the operator-facing workflow.

## Contextual retrieval interaction

Contextual Retrieval (see [Contextual Retrieval]({{< relref "contextual-retrieval" >}}))
sits **before** labelling and embedding. The default mode
(`CONTEXTUAL_LABEL_RAW=true`) **decouples** the two:

- **Labelling**: operates on the **raw** chunk. A/B testing showed that
  feeding the generated context to the labeler distorts it: broad
  doc-level context over-labels (~×3.6); focused per-chunk context
  under-labels (many empty label sets, ~24% in the corpus we tested).
- **Embedding**: operates on the **contextualised** chunk (raw + LLM-
  generated prefix). The chunk's vector carries the document's subject,
  so generic chunks become retrievable by the document's subject.

The two features are independent: Contextual Retrieval off + hybrid
retrieval on = plain lexical hybrid.

## Verification

After ingest, confirm labels landed by querying ArangoDB:

```bash
docker exec $(docker ps --format '{{.Names}}' | grep arango-vector-db | head -1) \
  arangosh --server.endpoint tcp://localhost:8529 \
  --server.authentication true \
  --server.username root --server.password "$ARANGO_PASSWORD" \
  --javascript.execute-string 'db._query("FOR d IN chunks FILTER d.file_id==\"<file_id>\" RETURN {text: d.text, labels: d.labels, chunk_text: d.chunk_text}").toArray()'
```

If Contextual Retrieval is on, confirm the chunk metadata carries
`chunk_text` (the original raw chunk) alongside `text` (the
contextualised text used for embedding). Missing `chunk_text` means
`CONTEXTUAL_LABEL_RAW=false` or a disabled context pipeline.

To check label-distribution health across a corpus:

```text
FOR d IN chunks
  COLLECT labels = d.labels WITH COUNT INTO count
  SORT count DESC
  RETURN {labels: labels, count: count}
```

A healthy distribution has a few high-frequency labels (the main
categories) and a long tail of single-chunk labels. A flat distribution
(no label > 5% of chunks) often means the taxonomy is too coarse for
the corpus or the LLM is under-labelling.

## Related

- [Knowledge base → Labelling & Taxonomy]({{< relref "/docs/knowledge-base/labelling-taxonomy" >}})
  — operator-facing workflow.
- [Knowledge base → Content Guidance]({{< relref "/docs/knowledge-base/content-guidance" >}})
  — what makes content retrieve well.
- [Contextual Retrieval]({{< relref "contextual-retrieval" >}}) — the
  doc-context prefix that runs before labelling and embedding.
- [Retrieval]({{< relref "retrieval" >}}) — how the label filter is
  applied at query time.
- [Choosing models]({{< relref "choosing-models" >}}) — model
  requirements for the labelling LLM.