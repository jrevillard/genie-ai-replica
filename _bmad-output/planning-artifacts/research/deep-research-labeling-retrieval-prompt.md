# Deep research: document-context-aware labeling & retrieval for GENIE.AI RAG

## Context (self-contained briefing)
GENIE.AI is a sovereign, DPG-compliant open-source RAG framework for the public sector. Stack:
- **Dataprep** (`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`, Python/FastAPI): ingests docs → chunks → labels → embeds → stores in **ArangoDB** (graph + vector).
- **Labeling**: per-chunk LLM call (vLLM, remote `ibm-granite/granite-4.1-8b`). Batched (8 chunks/call), `temperature=0`, `response_format={"type":"json_object"}` (guided JSON), concurrency 20. Returns 1–4 taxonomy labels per chunk. Taxonomy = service categories (e.g., "Cucumber", "Pest/ Disease Health", "Harvest/ Production", "Planning").
- **Retrieval**: hybrid vector-graph (ArangoDB), reranker, label filtering (retriever filters chunks by requested labels).
- Multilingual (Spanish primary for el-salvador deployment). Cost-sensitive (remote GPU node). The pipeline is `User Query → Backend → ChatQnA → Embedding → Retriever (ArangoDB) → Reranker → LLM`.
- Recent work: labeling optimized (35min→0.9min for ~1700 chunks, 0 JSON errors, response_format + batching + concurrency). File is a markdown cucumber cultivation guide.

## The problem
**Per-chunk labeling misses document-level context.** A cucumber-specific guide (34 chunks) → only **11/34 chunks** got the "Cucumber" label. Chunks about generic techniques (planning, pest control) are labeled with the technique but NOT the document's subject (cucumber), because the chunk text doesn't mention cucumber. Result: label-based retrieval for "cucumber" misses ~2/3 of relevant chunks in a cucumber document.

## Research questions
1. **Labeling — document-level propagation.** How to ensure every chunk in a document carries the document's subject/context labels (not just chunks that mention the subject)?
   - Technique A (simple): merge `file_labels` (document metadata labels, already fetched) into every chunk. Evaluate.
   - Technique B: two-pass labeling (pass 1: label the document → doc-level labels; pass 2: label each chunk WITH doc-level labels as context).
   - Technique C: Anthropic-style "contextual labeling" — prepend a document summary/context to each chunk before labeling.
   - Others? Pros/cons, cost, quality, fit for a small remote LLM (granite-4.1-8b, 8B).

2. **Retrieval — SOTA for document-context-aware retrieval.** Survey and compare:
   - **Contextual Retrieval** (Anthropic, https://www.anthropic.com/engineering/contextual-retrieval) — prepend doc context to each chunk before embedding. Evaluate vs alternatives.
   - Late chunking (embed whole doc, then chunk embeddings).
   - Hierarchical/parent-child retrieval, RAPTOR.
   - Document summary indexing, multi-vector.
   - ColBERT / late-interaction.
   - Graph-based (GENIE.AI already uses ArangoDB graph — leverage it for doc context).
   Rank by effort/impact for GENIE.AI's constraints (ArangoDB, remote vLLM, cost, multilingual).

3. **Concrete recommendations** for GENIE.AI: which techniques to adopt, in what order, given the existing pipeline (per-chunk labeling + hybrid vector-graph retrieval + ArangoDB). Separate quick-wins (e.g., file_labels merge) from larger efforts (e.g., contextual embeddings).

## Deliverable
A research report: technique catalog (labeling + retrieval), trade-offs (cost, quality, complexity, fit for small multilingual model + ArangoDB), and ranked recommendations with implementation notes for the GENIE.AI dataprep/retriever. Cite sources. Flag what's state-of-the-art vs proven-in-production.

## Constraints / preferences
- Sovereign/DPG: no external API dependencies (must run on the self-hosted vLLM). 
- Cost matters: labeling just got fast; don't propose 10× cost regressions without justification.
- Multilingual (Spanish) — techniques must work cross-lingually.
- ArangoDB (graph + vector) is the store — favor techniques that leverage it.
- The colleague specifically flagged Contextual Retrieval — evaluate it honestly (it's proven but adds cost: a context-generation LLM call per chunk).
