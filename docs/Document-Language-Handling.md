# Document Language Handling in the RAG Pipeline

**Last Updated:** July 17, 2026  
**Status:** Documented — relying on BGE-M3 cross-lingual retrieval (Option C)

---

## Overview

The GENIE.AI RAG pipeline for the Lesotho deployment is designed around an **English-centric knowledge base** with Sesotho user interaction handled via real-time translation at query time. This document explains how language is handled during document ingestion and retrieval, the current behavior for non-English documents, and known limitations.

---

## Architecture: Language Flow

```
INGESTION (one-time, at upload):
    Document (any language) → Text Extraction → Chunking → BGE-M3 Embedding → ArangoDB

QUERY TIME (per user question):
    User (Sesotho) → NLLB translate → English query → BGE-M3 Embedding
        → Vector Search (ArangoDB) → Reranker → Top Documents
        → LLM (English prompt + context) → English response
        → NLLB translate → Sesotho response → User
```

The key design assumption: **documents in the knowledge base are primarily in English**, and the query pipeline translates user questions to English before retrieval.

---

## What Happens During Document Ingestion

### Language Detection (document-repository service)

At upload time, the `fileService.js` performs language detection on text-based documents (PDF, DOCX, MD, HTML, TXT):

1. Extracts text from the file buffer
2. Detects language using `langdetect`
3. Compares against `requiredIngestionLanguage` (default: `en`)
4. **Logs a warning but allows the upload regardless**

```
Language mismatch for [filename]: detected [st], required [EN]. Allowing upload anyway.
```

There is **no hard block** on non-English documents. The system allows multilingual content by design.

### Text Extraction

- **Standard documents** (PDF, DOCX, TXT, MD, HTML): Language-agnostic — works in any language
- **OCR for images/scanned PDFs**: Currently English-only (`easyocr.Reader(['en'])`). Sesotho text in images will not be extracted correctly.

### Chunking

Uses `RecursiveCharacterTextSplitter` — language-agnostic. Works correctly for any language.

### Embedding

Uses **BAAI/bge-m3** (BGE-M3), a multilingual embedding model supporting 100+ languages. Creates vector representations of the document chunks in their original language.

### Label Assignment

The knowledge hierarchy taxonomy is in English. Labels are assigned via LLM/BM25 matching against English category names. For non-English documents, label assignment may produce incorrect or generic results.

### Graph Storage

Document chunks and their embeddings are stored in ArangoDB. No language metadata is stored on the embedded chunks themselves (only on the file record from the language detection at upload).

---

## Current Approach: BGE-M3 Cross-Lingual Retrieval (Option C)

The current deployment relies on BGE-M3's multilingual capabilities for handling non-English documents:

- BGE-M3 maps texts from different languages into a shared embedding space
- An English query embedding should theoretically retrieve semantically similar content regardless of the stored document's language
- This means a Sesotho document can be ingested as-is, and English queries (translated from Sesotho at query time) may still retrieve relevant chunks

### Effectiveness for Sesotho

BGE-M3 officially supports 100+ languages, but its performance on low-resource African languages like Sesotho is **unverified**. The `RAG-Quality-Improvements.md` document notes that alternative models are under evaluation:

- `dsfsi/zabantu-xlm-roberta` — African language model from University of Pretoria
- `Davlan/afro-xlmr-large` — Multilingual African NLP model

These may provide better Sesotho embedding quality than BGE-M3.

---

## Known Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| No pre-ingestion translation | Sesotho documents stored in Sesotho; retrieval quality depends on BGE-M3 cross-lingual ability | Upload English versions when possible |
| OCR is English-only | Sesotho text in images/scanned PDFs not extracted | Use digital (non-scanned) documents for Sesotho content |
| Label assignment in English | Non-English documents may get incorrect labels in the knowledge hierarchy | Manually assign labels after upload |
| Cross-lingual retrieval unverified | BGE-M3's Sesotho↔English cross-lingual quality is unknown | Test with real documents and measure recall |
| No language metadata on chunks | Cannot filter retrieval by document language | All documents compete equally in vector search |

---

## Recommendations for Content Managers

1. **Prefer English documents** for the knowledge base when possible. The entire RAG pipeline (retrieval, reranking, LLM generation) operates most reliably with English content.

2. **Sesotho documents are accepted** but retrieval quality is uncertain. If a document exists in both English and Sesotho, upload the English version.

3. **Avoid scanned/image-based Sesotho documents** — the OCR will not extract the text. Use digital formats (typed PDF, DOCX, TXT).

4. **Check label assignment** after uploading non-English documents. The auto-labeling system may misclassify Sesotho content.

5. **Test retrieval** by asking questions (in Sesotho or English) that should be answered by an uploaded Sesotho document. If the system doesn't retrieve it, the cross-lingual retrieval is failing and the document should be translated to English.

---

## Configuration

| Variable | Location | Default | Description |
|----------|----------|---------|-------------|
| `requiredIngestionLanguage` | document-repository `appConfig` | `en` | Expected language for ingestion (warning only, not enforced) |
| `easyocr.Reader(['en'])` | `genieai_dataprep_utils.py` | English only | OCR language support |
| Embedding model | TEI service | `BAAI/bge-m3` | Multilingual embedding model |

---

## Future Improvement Options

If cross-lingual retrieval proves insufficient for Sesotho:

### Option A: Pre-Ingestion Translation
Add an NLLB translation step before embedding. Detect non-English content → translate to English → embed English text. Guarantees retrieval quality but adds ingestion latency.

### Option B: Dual Embedding
Store both original and English-translated versions. Embed both. Query matches against English embeddings (reliable) while original text is preserved for display. Most complex but best quality.

### Option D: Block Non-English with User Message
Change the warning to a hard block with a user-facing message: "Please translate this document to English before uploading." Simplest but limits functionality.

### Sesotho-Optimized Embedding Model
Replace or augment BGE-M3 with `zabantu-xlm-roberta` or `afro-xlmr-large` for better Sesotho representation. Requires evaluation and potentially running a second TEI instance.

---

## Related Documentation

- [RAG Quality Improvements](RAG-Quality-Improvements.md) — LLM selection, translation routing, model evaluation
- [GPU Optimization: CPU-Based Translation](GPU-Optimization-CPU-Translation.md) — NLLB translation architecture
- [Lesotho Deployment Summary](Lesotho-Deployment-Optimizations-Summary.md) — Full architecture overview
- [Content Feeding via Web UI](../components/document-repository/README.md#content-feeding-via-the-web-ui-admin-dashboard) — Upload guide
