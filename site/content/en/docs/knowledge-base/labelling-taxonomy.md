---
title: Labelling & Taxonomy
description: How chunks are labelled against the service-category taxonomy, and how labels filter retrieval to keep answers on-topic.
weight: 3
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Labelling is what keeps a multi-domain knowledge base from bleeding across
topics. Every chunk is assigned one or more **labels** drawn from the
**service-category taxonomy**, and at query time the retriever uses those labels
to return only on-topic chunks. Without labels, a question about one service
could pull in unrelated chunks from another.

This page is for **knowledge managers and operators** who curate the taxonomy
and diagnose labelling quality. Developer-facing details on the underlying
prompt and label-filter encoding live in
[Data labelling strategy]({{< relref "/docs/rag-pipeline/data-labeling" >}}).

## The taxonomy

The taxonomy is the **service-category hierarchy** — the set of categories and
services the deployment answers about. It is managed in the backend
(`serviceCategories`, `services`, `serviceCategoryTranslations` ArangoDB
collections) and is the same structure the application uses to organise its
service catalogue in the UI.

- **`nameEN` is the source of truth** for RAG compatibility. `nameEN` is the
  required English field on each `serviceCategories` and `services` document
  (see `components/gov-chat-backend/scripts/new-schema-scripts/arango-schema.json`).
  Labelling and retrieval both operate on the English label, regardless of the
  user's UI language. Translation collections (`serviceCategoryTranslations`)
  are keyed by `languageCode` + `translation`, not `nameEN`.
- Translations live in dedicated translation collections (`serviceCategoryTranslations`)
  with keys of the form `${nameEN}_${languageCode}` — they are display-only.

> **Curate the taxonomy deliberately.** Labels are only as good as the taxonomy
> they reference. A flat or ambiguous taxonomy produces vague labels; a
> well-structured one produces precise retrieval. Domain experts should review
> the category set, not just the documents.

### Managing the taxonomy (admin UI + API)

The backend exposes a full CRUD surface for the taxonomy at `/api/service-categories`
(see `components/gov-chat-backend/routes/service-category-routes.js`):

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /api/service-categories/categories` | List categories | Authenticated |
| `GET /api/service-categories/categories/detailed` | List with full service tree | Auth |
| `GET /api/service-categories/search?query=` | Search categories | Auth |
| `GET /api/service-categories/categories/{categoryId}` | Single category + services | Auth |
| `POST /api/service-categories` | Create category (requires `nameEN`) | Authenticated |
| `POST /api/service-categories/init` | Seed an initial taxonomy | Authenticated |
| `POST /api/service-categories/{categoryId}/services` | Add service under category | Authenticated |
| `PUT /api/service-categories/{categoryId}` | Update category (incl. translations) | Authenticated |
| `GET /api/service-categories/{categoryId}/translations` | Read translations (no update endpoint — translations are updated as part of the category `PUT` payload) | Auth |
| `DELETE /api/service-categories/{categoryId}` | Remove category | Authenticated |

The same operations are available through the **Knowledge Hierarchy** tab of
the Admin Dashboard (Admin Dashboard → Knowledge Hierarchy) — this is the
recommended path for non-developers. The tab edits the same backend endpoints.

> **New labels are empty until re-ingestion.** When you add a label, no chunks
> carry it yet. Existing documents must be retracted and re-uploaded (or a
> re-label job run) for the new label to start appearing in retrieval. See
> [Document lifecycle]({{< relref "document-lifecycle" >}}).

## How chunks are labelled

At ingest time, dataprep calls an LLM (or a cheaper matcher, see strategies
below) once per chunk (or per batch) and asks it to assign the most relevant
taxonomy label(s) to that chunk's text:

- The model is constrained to **guided JSON** output — vLLM forces the model to
  emit a parseable JSON object via OpenAI's `response_format={"type":"json_object"}`
  flag, instead of free text. This is what makes the output reliably parseable
  under load.
- A chunk may get **zero, one, or several** labels. Getting no label is usually
  *correct* — the chunk does not match any taxonomy entry — not a bug.
- The label selector prompt is environment-overridable via
  `LABEL_SELECTOR_SYSTEM_PROMPT` in `env` (see env Section 8).

### Labelling strategies

The strategy is selected by the `LABELING_STRATEGY` env var on the
`dataprep-arango-service` container (read at
`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:62`):

| `LABELING_STRATEGY` | Cost | Use when |
|---|---|---|
| `llm` (default) | one LLM call per chunk (or per `DATAPREP_LLM_LABEL_BATCH_SIZE` batch) | label precision matters. |
| `embedding` | cosine similarity against label embeddings, no LLM call | ingest speed matters more than precision. Tuned by `EMBEDDING_LABEL_THRESHOLD` (default `0.75`). |
| `bm25` | lexical BM25 against taxonomy strings, no LLM call | the taxonomy terms are well-defined and a deterministic lexical match is acceptable. Tuned by `BM25_LABEL_THRESHOLD` (default `2.00`). |

`llm` is the safe default. Switch to `embedding` or `bm25` only when ingest
throughput is the bottleneck and you have validated that label precision still
meets your quality bar on a representative sample.

## Label filtering at retrieve time

When a query comes in, the retriever applies a **label filter**: only chunks
whose labels are relevant to the query's intent are considered, before vector /
lexical ranking. This is the mechanism that prevents cross-topic bleed. See
[Retrieval]({{< relref "/docs/rag-pipeline/retrieval" >}}) for the full pipeline.

## Contextual retrieval interaction

When [Contextual Retrieval]({{< relref "/docs/rag-pipeline/contextual-retrieval" >}}) is
on (it is on by default), a doc-context prefix is prepended to each chunk
before embedding. By default the chunk is labelled on its **raw** text
(`CONTEXTUAL_LABEL_RAW=true`), so labels keep their precision while the
embedding gains the document's subject.

**Why decouple label and embedding text?** Feeding the LLM-generated context
to the labeler distorts labelling: the context typically summarises the
document's main topic, so every chunk would over-label toward that topic and
under-label toward its actual section. The split keeps label precision high
while letting vectors benefit from the context prefix.

## When labels look wrong

- **Many chunks get `[]`** → usually correct (no taxonomy match). Verify the
  taxonomy is loaded (some chunks *do* get specific labels) before assuming a
  bug. Probe the live vLLM directly with a real chunk to isolate model vs
  pipeline (see [Data labelling strategy]({{< relref "/docs/rag-pipeline/data-labeling" >}})).
- **Labels drift to neighbouring categories** → the taxonomy may be too coarse,
  or the label selector prompt needs tightening.
- **All chunks get the document's main label only** → sub-category structure may
  be missing from the taxonomy.

### Diagnose by reading the ingestion log

For a representative file_id, the per-chunk labels are visible in the ingestion
log:

- AQL pattern (from `.claude/rules/DEBUGGING-TRACING.md` §3):

  ```aql
  FOR d IN ingestion_log
    FILTER d.file_id == "<file_id>" AND d.message LIKE "%Final labels%"
    RETURN d.message
  ```

- Or via the admin UI: Admin Dashboard → Document Management → file → Ingestion
  log → filter to "Final labels" entries.

Look at the proportion of chunks with non-empty label arrays. **On a healthy
30-chunk document, expect ≥ 80 % of chunks to receive at least one label.**
0-label chunks should appear only on genuinely generic passages (boilerplate,
page footers, contact info). Anything below ~60 % usually means the taxonomy is
missing the relevant category or the prompt needs a sharper definition.

### Probing the live LLM

To distinguish a model issue from a pipeline issue, bypass dataprep and call
the vLLM directly with the real `LABEL_SELECTOR_SYSTEM_PROMPT` and a real
chunk. See `.claude/rules/DEBUGGING-TRACING.md` §7 for the base64 pattern that
avoids ssh quoting hell.

## Managing labels via the document-repository API

The document-repository service also has a parallel `/api/labels` surface
(`components/document-repository/src/routes/labelRoutes.js`) used by the
document-repository-managed label tree. These are the labels attached to chunks
during ingestion (vs the service-category taxonomy in the backend, which the
chat UI uses). All endpoints require the **`Admin`** role.

| Endpoint | Purpose |
|---|---|
| `GET /api/labels` | List labels (unpaginated, filterable by `name`/`level`/`status`/`parentId`/`publish`) |
| `GET /api/labels/{labelId}` | Get a single label + translations |
| `POST /api/labels` | Create a label (`name`, `level`, `status`, `parentId`) |
| `PATCH /api/labels/{labelId}` | Partial update |
| `DELETE /api/labels/{labelId}` | Hard-delete the label |
| `DELETE /api/labels/{labelId}/with-children` | Cascade-delete the label and its descendants |
| `GET /api/labels/{labelId}/related` | Graph-based related labels |

> **Common pitfall.** Deleting a label whose chunks still carry it leaves the
> chunks in place but **without** their label. The chunks survive in retrieval
> but lose the filter, so cross-topic bleed can re-emerge. Always cascade
> (`with-children`) when retiring a category.

## Next steps

- [Content guidance]({{< relref "content-guidance" >}}) — how to write source
  documents so they label well.
- [Document lifecycle]({{< relref "document-lifecycle" >}}) — how a document
  moves from upload to ingest to retract, and where the ingestion log lives.
- [Data labelling strategy]({{< relref "/docs/rag-pipeline/data-labeling" >}}) — the
  full developer reference for the labelling pipeline, prompt, and tuning
  knobs.
- [Ingestion log reference]({{< relref "ingestion-log" >}}) — per-chunk log
  schema and the canonical message strings to grep for.