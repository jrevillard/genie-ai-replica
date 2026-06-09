# Story 8-1: Create RAG Quality Test Bed and Document Corpus Fixtures

**Story ID:** 8.1
**Story Key:** 8-1-create-rag-quality-test-bed-and-document-corpus-fixtures
**Epic:** Epic 8 — RAG Quality Assurance
**Status:** ready-for-dev
**Created:** 2026-06-09

---

## User Story

As a QA engineer,
I want a curated document corpus with known QA pairs for RAG quality testing,
So that RAG output quality is measured against a reproducible benchmark.

## Acceptance Criteria

**AC1:** `tests/fixtures/corpora/el-salvador/` contains test documents in multiple formats (.txt, .md, .pdf, .xlsx, .docx)

**AC2:** `tests/fixtures/corpora/el-salvador/qa-pairs.json` contains curated query-answer pairs

**AC3:** Each QA pair has: query, expected answer (or quality bounds), relevant document references

**AC4:** The corpus is version-controlled and committed to the repository

**AC5:** `tests/fixtures/arangodb/` contains ArangoDB collection and graph fixtures for the corpus

---

## Developer Context

### Existing Test Infrastructure

The project already has `tests/rag-benchmarks/` with 5 benchmark scripts:
- `benchmark_config.py` — Shared config with `QUESTIONS` list (id, text, domain, reference, key_terms)
- `benchmark_rag_accuracy.py` — BLEU, ROUGE-L, keyword coverage scoring
- `benchmark_ingestion.py` — Document ingestion benchmarks
- `benchmark_query.py` — Query latency benchmarks
- `benchmark_rag_performance.py` — End-to-end performance benchmarks

**KEY PATTERN:** `benchmark_config.py` line 69 defines `QUESTIONS = [...]` with schema:
```python
{
    "id": 1,
    "text": "What is the altitude range...",
    "domain": "Geography",
    "reference": "",          # Currently EMPTY — this story fills these
    "key_terms": ["altitude", "rainfall", "Masai Mara"],
}
```

**This story bridges the gap:** Create actual document fixtures so `reference` fields can be filled with ground-truth answers.

### Document Processing Pipeline (Dataprep)

**Supported formats:** .txt, .md, .pdf, .xlsx, .docx, .html

**Processing stages:**
1. Text extraction (format-specific parsers)
2. Content cleaning (whitespace, special chars)
3. Chunking (configurable: `CHUNK_SIZE=1000`, `CHUNK_OVERLAP=200`, `MIN=100`, `MAX=2000`)
4. Labeling (LLM-based + BM25)
5. Graph construction (entity/relationship extraction)

**File size limit:** 50MB per document

### ArangoDB Schema

**Collections:**
- `documents` — Source document metadata
- `chunks` — Text chunks with embeddings
- `entities` — Extracted entities/nodes

**Graph:**
- Graph name: `knowledge_graph` (env: `ARANGO_GRAPH_NAME`)
- Edges: document→chunk, chunk→entity, entity→entity relationships

**Config vars:**
```
ARANGO_URL=http://arango-vector-db:8529
ARANGO_DB=genie-ai
ARANGO_USER=root
ARANGO_PASSWORD=***
```

### RAG Pipeline Flow (for QA pair design)

```
User Query → Backend (BFF) → ChatQnA Service → Embedding → Retriever (ArangoDB) → Reranker → LLM → Response
```

**ChatQnA endpoint:** `POST /v1/chatqna` with `messages` array
**Retriever endpoint:** `POST /v1/retrieval` with `text` query
**Dataprep endpoint:** `POST /v1/dataprep` for ingestion

---

## Technical Requirements

### File Structure to Create

```
tests/fixtures/
├── corpora/
│   └── el-salvador/
│       ├── README.md                          # Corpus documentation
│       ├── qa-pairs.json                      # Curated QA pairs
│       └── documents/
│           ├── el-salvador-business-license-requirements.md
│           ├── el-salvador-tax-obligations-guide.txt
│           ├── el-salvador-municipal-services-overview.txt
│           ├── el-salvador-environmental-regulations.docx
│           └── el-salvador-investment-incentives-2024.pdf
└── arangodb/
    ├── README.md                              # Fixture documentation
    ├── collections.json                       # Collection definitions (documents, chunks, entities)
    └── seed-data.json                         # Seed data for fixture loading
```

### QA Pair Schema

Based on existing `QUESTIONS` pattern in `benchmark_config.py`, extend with quality bounds:

```json
{
  "corpus_version": "1.0.0",
  "corpus_name": "el-salvador",
  "description": "Curated QA pairs for RAG quality regression testing",
  "qa_pairs": [
    {
      "id": 1,
      "query": "What are the requirements for obtaining a business license in El Salvador?",
      "expected_answer": "To obtain a business license in El Salvador, you must register with the National Registry Center (CNR), obtain a municipal patent, and register with the Ministry of Finance for tax purposes...",
      "quality_bounds": {
        "faithfulness_min": 0.95,
        "answer_relevance_min": 0.85,
        "context_precision_min": 0.80,
        "context_recall_min": 0.90
      },
      "document_references": ["el-salvador-business-license-requirements.md"],
      "key_terms": ["business license", "CNR", "municipal patent", "Ministry of Finance"],
      "domain": "business_services",
      "difficulty": "medium"
    }
  ]
}
```

**QA pair coverage requirements:**
- Minimum 5 QA pairs covering different query types
- At least 1 per document in the corpus
- Mix of difficulty levels: easy (factual), medium (procedural), hard (synthesis)
- All in English (source of truth per project i18n rules)

### Document Content Requirements

Create **synthetic but realistic** government service documents for El Salvador. Each document must:
- Be 500-2000 words (processable by chunking pipeline)
- Contain factual, structured information (lists, requirements, procedures)
- Be internally consistent (cross-references within corpus)
- Cover distinct domains (business, tax, municipal, environment, investment)

**CRITICAL:** Use publicly available/verifiable information. Do NOT fabricate legal content.

### ArangoDB Fixtures

`collections.json` — Define collection schemas matching the running system:
```json
{
  "database": "genie-ai",
  "collections": [
    {"name": "documents", "type": "document"},
    {"name": "chunks", "type": "document"},
    {"name": "entities", "type": "document"}
  ],
  "graphs": [
    {
      "name": "knowledge_graph",
      "edge_definitions": [
        {"collection": "document_chunks", "from": ["documents"], "to": ["chunks"]},
        {"collection": "chunk_entities", "from": ["chunks"], "to": ["entities"]}
      ]
    }
  ]
}
```

`seed-data.json` — Provide sample fixture data for unit testing without a running ArangoDB instance:
```json
{
  "documents": [...],
  "chunks": [...],
  "entities": [...]
}
```

---

## Architecture Compliance

### Testing Conventions
- **Python tests:** Use `pytest` with `tests/` directory
- **Copyright headers:** Required (ITU, Apache-2.0)
- **Linting:** Must pass `ruff check` and `ruff format --check`
- **CI:** Fixtures are consumed by `manual:rag-quality` job (`.gitlab-ci.yml` line 1084)

### Code Style
- **JSON:** 2-space indentation, no trailing commas
- **Markdown:** Project conventions (English only)
- **File naming:** kebab-case for documents, snake_case for JSON keys

### Integration Points
- Story 8.2 will consume `qa-pairs.json` for RAGAS evaluation
- Story 8.3 will consume fixture data for report generation
- `benchmark_config.py` QUESTIONS can be back-filled from `qa-pairs.json`

---

## Gotchas and Constraints

1. **PDF creation:** Python can generate PDFs via `reportlab` or `fpdf2` — but keep it simple. A small hand-crafted PDF is fine for fixtures.

2. **Binary files in git:** `.pdf`, `.xlsx`, `.docx` are binary. Keep them small (<100KB each) to avoid bloating the repo. Consider `.gitattributes` for binary handling.

3. **No live service dependency:** Fixtures must be usable in unit tests WITHOUT running ArangoDB/Dataprep. The `seed-data.json` provides static test data.

4. **qa-pairs.json vs QUESTIONS:** These are separate. `qa-pairs.json` is the ground truth for RAGAS metrics. `QUESTIONS` in `benchmark_config.py` is for the existing benchmark suite. Consider a migration script later, but for now keep them independent.

5. **Document format diversity:** Must include at least one of EACH format (.txt, .md, .pdf, .xlsx, .docx) to test the dataprep's multi-format ingestion pipeline.

6. **Corpus content:** Use El Salvador government services as the domain. This aligns with the existing Sprint 23 MELT ingestion work and the PRD's reference to `tests/fixtures/corpora/el-salvador/`.

7. **File encoding:** All text files must be UTF-8. Spanish characters (á, é, í, ó, ú, ñ) are expected in El Salvador content.

---

## Testing Requirements

### Unit Tests (required)
- `tests/fixtures/test_fixture_integrity.py` — Validates:
  - `qa-pairs.json` parses correctly
  - All required fields present in each QA pair
  - Document references point to existing files
  - `collections.json` and `seed-data.json` parse correctly
  - Seed data has expected collection names

### Validation Checklist
- [ ] All 5 document formats present in `tests/fixtures/corpora/el-salvador/documents/`
- [ ] `qa-pairs.json` has ≥5 QA pairs with all required fields
- [ ] Each QA pair references at least one document
- [ ] `collections.json` defines `documents`, `chunks`, `entities` collections
- [ ] `seed-data.json` provides sample data for unit testing
- [ ] All files pass `ruff check` (for any Python validation scripts)
- [ ] All JSON files are valid and well-formatted

---

## Out of Scope

- Ingesting documents into a running ArangoDB instance (runtime step, not fixture creation)
- Computing embeddings for seed data (requires GPU/embedding service)
- Creating the RAGAS evaluation pipeline (Story 8.2)
- Generating quality reports (Story 8.3)
- Migrating `benchmark_config.py` QUESTIONS to use new fixtures (follow-up task)

---

## Dev Notes

- Story 8-10 (Epic 7) was descoped as Won't Fix (testing-the-testing anti-pattern). This story creates static fixtures only — no circular dependency.
- The `tests/rag-benchmarks/` directory already has benchmark infrastructure. This story provides the missing piece: actual test data.
- The `manual:rag-quality` CI job already exists as a placeholder. Story 8.2 will make it functional.
- Use `python3 -c "import json; json.load(open('tests/fixtures/corpora/el-salvador/qa-pairs.json'))"` to validate JSON integrity.
