# Contextual Retrieval — Evaluation Report

**Date:** 2026-06-26
**Environment:** GENIE.AI el-salvador deployment (10.0.0.102 + GPU node 10.0.0.110)
**Model:** `ibm-granite/granite-4.1-8b` (remote vLLM)
**Document under test:** CENTA cucumber cultivation guide (34 chunks, English)
**Feature branch:** `feat/contextual-retrieval` (MR !199), deployed via disposable branch `el-salvador-contextual`
**Metrics source:** distributed traces (VictoriaTraces) + ArangoDB (`GRAPH_TEST_SOURCE`)

---

## 1. Objective

Determine whether per-chunk **Contextual Retrieval** (Anthropic-style) fixes the
document-subject loss in chunk labeling/embedding, and compare the available
configurations on ingestion cost and labeling quality.

**Original problem.** Chunks are labeled and embedded in isolation, so a chunk
that does not name the document's subject loses it. In the cucumber guide, only
**11 of 34 chunks** were labeled "Cucumber" → label-filtered and vector retrieval
miss ~⅔ of the document. The failure recurs for every document.

## 2. Configurations tested

The same document was ingested under three configs:

| Config | `CONTEXTUAL_STRATEGY` | Behavior |
|---|---|---|
| **off** (reference) | `CONTEXTUAL_RETRIEVAL_ENABLED=false` | No contextualization — current pipeline. |
| **doc_level** | `doc_level` | ONE LLM call for the whole document; the same document-level context is prepended to every chunk. |
| **per_chunk** | `per_chunk` | One LLM call per chunk (batched, 8/batch); a tailored context is generated for each chunk. |

In all contextual configs the contextualized text `<context> + <chunk>` is used
for **both embedding and labeling**.

## 3. Results

### 3.1 Ingestion cost (full pipeline, from traces)

| Phase | off | doc_level | per_chunk |
|---|---|---|---|
| **Total ingest wall** | **122.1 s** | **190.1 s** | **151.9 s** |
| Context generation | 0 | 2.7 s (1 call) | 63.6 s sum / 20.3 s window (5 batches) |
| Labeling | 33.8 s (5 batches, 0 fallback) | 125.9 s + 4.6 s (5 batches, 1 failed → 8 per-chunk fallback) | 34.7 s (5 batches, 0 fallback) |
| Graph insert (ArangoDB calls) | 582 | 618 | 618 |
| LLM prompt tokens | 17,237 | 21,488 | 43,585 |
| LLM completion tokens | 880 | 2,496 | 2,820 |

### 3.2 Labeling quality (ArangoDB)

| | off | doc_level | per_chunk |
|---|---|---|---|
| **"Cucumber" coverage** | **11/34** | **34/34** | **26/34** |
| Total labels (all chunks) | 79 | 283 | 65 |
| Avg labels per chunk | 2.3 | 8.3 | 1.9 |
| Chunks with 0 labels | few | 0 | **8** |

**doc_level label distribution:** Cucumber 34, Pest/Disease 34, Harvest 31,
Nutrition 27, Post-Harvest 26, Economics 26, Water 26, Monitoring 25, Planning
21, Climate Resilience 18, Variety/Breed 15 (11 distinct labels).

**off label distribution:** Planning 21, Pest/Disease 13, Harvest 11, Cucumber
11, Monitoring 7, Nutrition 6, Vegetables 3, Variety 3, Climate Resilience 2,
Post-Harvest 1, Economics 1.

## 4. Key findings

1. **doc_level fixes subject coverage but destroys label precision.** Cucumber
   goes 11 → 34, but every chunk receives ~8–11 labels (essentially all aspects).
   The document-level context mentions every aspect ("...detailing agronomic
   management, variety selection, establishment, nutrition, water..."), so the
   labeler applies them all to every chunk. Label-filtering becomes
   non-discriminating (filtering by "Post-Harvest" returns irrigation chunks).
   Ingestion is also **+56 % slower** — not because of context generation (2.7 s)
   but because over-labeling makes labeling 4× slower (more tokens) and triggers a
   batch failure.

2. **per_chunk is partial and under-labels.** Cucumber reaches 26/34, but **8
   chunks get 0 labels**. The tailored per-chunk context makes the labeler too
   narrow → empty label sets. Total labels (65) fall below the off baseline (79).
   Ingestion is **+24 %** (context generation adds ~30 s).

3. **off is the fastest and the most precise labeler, but loses the subject**
   (11/34 — the original bug).

4. **Root cause — the context is fed to the labeler.** The contextualized text
   `<context> + <chunk>` is reused for both embedding and labeling. The context
   preamble distorts labeling: a *broad* context → over-labeling; a *narrow*
   context → under-labeling. This is a content/framing problem, **not** a
   context-size problem (prompts are ~7 k tokens; the model window is 128 k).

## 5. Conclusion

None of the three configurations is strictly better. Each trades one error for
another:

| | Subject found? | Labels precise? |
|---|---|---|
| off | ❌ 11/34 | ✅ moderate |
| doc_level | ✅ 34/34 | ❌ over-labels (filter useless) |
| per_chunk | ⚠ 26/34 | ❌ under-labels (8 chunks empty) |

## 6. Recommendation — decouple embedding from labeling

Use the generated context **only for the embedding**; label the **raw chunk**:

- **Embedding** ← `<context> + <chunk>` → the vector carries the document subject
  → chunks become retrievable by subject.
- **Labeling** ← raw chunk (no context) → precise labels (off-quality, no
  distortion).

This is the only variant that can beat the off baseline on **both** axes: subject
propagation via embeddings + precise labels via raw-chunk labeling.

## 7. Status & next step

- Feature implemented on `feat/contextual-retrieval` (MR !199), default **off**,
  with `CONTEXTUAL_STRATEGY` (`per_chunk` | `doc_level`). All config/doc surfaces
  updated; 537 tests pass; CI green.
- Tested on el-salvador via the disposable branch `el-salvador-contextual`
  (temporary; `release/el-salvador` and `main` untouched).
- **Proposed next:** implement the decoupled variant (context → embedding only,
  raw chunk → labeling) and measure it as a 4th comparison.
