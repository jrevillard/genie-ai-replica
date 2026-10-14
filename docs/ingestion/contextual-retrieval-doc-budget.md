# Contextual Retrieval truncates the document context — how to check your deployment

**Applies to both ingestion pipelines** (legacy file-based and OKF content-only) —
they share one code path, so there is nothing to opt into or out of. This note is
for checking whether *your* deployment is affected and by how much.

---

## The issue in one paragraph

Contextual Retrieval builds a "document context" for a document by joining its
chunks, then **hard-truncating** that join to a fixed character budget
(`joined = joined[:budget]`). That context is prepended to each chunk **before
embedding** and before **graph entity/relation extraction**. So when a document is
bigger than the budget, chunks drawn from the end of it are embedded against a
description of the *beginning* of the document — a silent quality loss. Nothing
fails, ingestion reports success, and the only trace was a `logger.warning` on
container stdout. We have since routed it to the Ingestion Log (see *Fix* below),
but on deployments running an older image it is invisible.

## Where the code is

| What | Where |
|---|---|
| Truncation site | `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — `_build_doc_context()` |
| The shared call | same file, `await self._apply_contextualization(original_chunks, input, input.file_id)` |
| Legacy entry point | `POST /v1/dataprep/ingest_file` → `genieai_dataprep_microservice.py` → `ingest_file_with_guardrail` |
| OKF entry point | content-only chunking (the `4.8-amend` path) |

Both pipelines construct the same `GenieArangoDataprep`, so **both are affected
identically**. The only difference is what `file_id` means for logging — the
document file id on the legacy path, the `concept_id` on the OKF path.

## Why the budget is the wrong size

The budget is **not derived from your model's context window** — it is a literal in
docker-compose:

```
docker-compose.yaml   DATAPREP_CONTEXTUAL_DOC_BUDGET: ${DATAPREP_CONTEXTUAL_DOC_BUDGET:-6000}
```

6000 characters ≈ 1500 tokens. That is sized for the **NVIDIA T4** profile
(`VLLM_MAX_MODEL_LEN=2048`), but it is applied to *every* deployment, including the
default which runs a **65536-token** window. The two GPU profiles that lower the
window are:

| Profile | `VLLM_MAX_MODEL_LEN` | Implied safe budget |
|---|---|---|
| `env.t4` | 2048 | ~3,100 chars |
| `env.rtx6000` | 4096 | ~11,300 chars |
| default | 65536 | ~257,000 chars |

So the shipped 6000 is **too large for a T4** and **roughly 40× too small for a
default install**. On a T4 the contextualization calls are in fact overflowing the
window and falling back to raw chunks today.

## How to check your deployment

**1. What budget is actually in effect?**

```bash
docker exec <dataprep-container> printenv | grep -E 'DATAPREP_CONTEXTUAL|VLLM_MAX_MODEL_LEN|CONTEXTUAL_STRATEGY'
```

If `VLLM_MAX_MODEL_LEN` prints nothing, that is itself a finding — the variable is
not currently passed into the dataprep container at all, so nothing can be derived
from it.

**2. How many of your documents exceed the budget?**

Documents are the unit, not chunks. Chunk text lives in the `<GRAPH>_SOURCE`
collections; join it per document and compare the total against the budget.

```aql
-- Run against your database. Adjust 6000 to whatever step 1 reported.
FOR d IN `OKF_<your-graph>_SOURCE`
  COLLECT doc = d.file_id, cid = d.concept_id
  AGGREGATE total = SUM(LENGTH(d.chunk_text)), n = LENGTH(d)
  FILTER total > 6000
  RETURN { doc: doc, concept: cid, chars: total, chunks: n }
  LIMIT 50
```

If that returns rows, those documents are truncated. A single row with a very large
`chars` is a document that is mostly invisible to its own context.

> Use `chunk_text`, **not** `text` — `text` is the LLM-enriched copy written
> *after* contextualization, so measuring against it tells you nothing.

**3. Has truncation actually fired?**

On deployments with the current image it is in the Ingestion Log UI. On older
images, grep the container log:

```bash
docker logs <dataprep-container> --since 24h 2>&1 \
  | grep -i "document context truncated"
```

The message names the budget, the percentage of the document that was kept, and the
chunk count.

**4. A quick worst-case probe** — is contextualization actually doing anything?

If the log shows batches falling back to raw text, or an error at a
`0/{total} chunks contextualized` guard, contextualization is effectively **off**
for that document — most likely a context-window overflow, which is the T4 case
described above.

## What is actually affected, and what is not

| | Affected by truncation |
|---|---|
| Chunk **embeddings** | **Yes** — chunks are embedded with the truncated context |
| **Knowledge graph** extraction | **Yes** — entity/relation extraction reads the same contextualized text |
| Chunk **labelling** | **No** — labelling runs on the raw chunk (`CONTEXTUAL_LABEL_RAW=true`) |
| Stored chunk text | **No** — every chunk is stored in full; nothing is lost from storage |

So retrieval quality and graph quality degrade; label quality and the stored corpus
do not. That is why ingestion reports success — it genuinely succeeded, just with a
weaker context than intended.

## What to do

- **Nothing is broken or lost.** If you are not seeing retrieval quality issues, you
  can treat this as a tuning item, not an incident.
- To raise the budget yourself, set `DATAPREP_CONTEXTUAL_DOC_BUDGET` in your `.env`
  — but **check it fits your model's context window first**. The whole prompt is
  budget + batch chunk text + system prompt + `DATAPREP_CONTEXTUAL_MAX_TOKENS`
  output. Setting it too high does not degrade gracefully: the calls fail and fall
  back to raw chunks, which is the same as having the feature off.
- Very large documents (100k+ characters) cannot be fixed by raising the budget
  alone — no single prompt holds them. They need splitting at curation time, or
  Map-Reduce summarization, which is not implemented yet.
- Upstream this is being fixed by deriving the budget from `VLLM_MAX_MODEL_LEN`
  rather than hard-coding it, plus a curator-facing size ceiling. Track
  `feat/concept-doc-ceiling`; the Ingestion Log visibility fix has already landed in
  `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`.

## Reproducing the measurement

The figures quoted in the user docs come from a simulation over real bodies in our
own deployment: split on markdown headings, greedily merge up to the ceiling, never
drop content. At 6000 chars that yields a **12.8× concept-count increase** and still
leaves **88% of documents with a section that cannot be split** — the data is
extremely heavy-tailed (one Wikipedia page has a single 315,919-character section).
That is why the budget has to be fixed *before* document splitting is viable at all.