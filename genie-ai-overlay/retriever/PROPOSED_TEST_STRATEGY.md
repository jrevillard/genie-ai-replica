# Hybrid Retriever Microservice – Test Plan

## 1. Purpose and Scope

This draft document proposes a **lightweight test plan** for retriever microservice as part of GENIE.AI development and stress-testing roadmap.

The goals of the test plan are to:

* Verify functional robustness across parameter configurations
* Measure retrieval accuracy in a reproducible way
* Measure retrieval latency and parameter sensitivity

---

## 2. Test Dataset Methodology

### 2.1 Source Document Selection

**Input document characteristics:**

* Size: **10–20 pages** (≈ **5,000–10,000 words**)
* Structure:

  * Clear section hierarchy (titles, subsections)
  * Repeated references to the same entities across sections
  * Explicit relationships (e.g. components, processes, dependencies)

**Rationale:**
This size is large enough to:

* Produce multiple semantically similar chunks
* Require graph traversal to connect distant concepts
* Avoid trivial retrieval based on keyword matching

The document should be ingested into the retriever using the **same chunking, embedding, and graph construction logic** as production.

---

### 2.2 Chunk and Graph Preparation

During ingestion:

* Split document into chunks (e.g. 300–600 tokens)
* Assign stable chunk IDs
* Extract entities and relationships to populate the knowledge graph

Each chunk must be traceable via:

* `chunk_id`
* Associated entity / node IDs (if applicable)

This traceability is required for later evaluation.

---

## 3. Construction of Test Queries Using an LLM

### 3.1 Overview

The test query set will consist of **9 questions**:

* **3 similarity-only queries**
* **3 traversal-focused queries**
* **3 hybrid queries**

For each query, the LLM must output:

* The question
* The **top 4 most relevant chunks** (by chunk ID or verbatim text)

These outputs will form the **expected retrieval set (gold labels)**.

---

### 3.2 LLM Prompting Strategy

The LLM is used **only to generate candidate test queries and expected chunks**. Final validation is performed manually.

#### System Prompt (shared)

```
You are helping to create a test dataset for evaluating a document retrieval system.
You will be given a document split into chunks.
Your task is to generate evaluation questions and identify the most relevant chunks.
Be precise and conservative: only select chunks that directly answer the question.
```

---

### 3.3 Similarity Search Questions (3)

**Intent:**

* Answerable from one or two semantically similar chunks
* No graph traversal required

**Prompt:**

```
From the document below, generate 3 questions that:
- Can be answered using information contained within a single section or closely related chunks
- Do not require combining information across different entities or sections

For each question:
1. Write the question
2. Identify the top 4 most relevant chunks by quoting their text or IDs

Document:
<<<DOCUMENT CHUNKS>>>
```

**Expected behavior:**

* High performance with vector similarity alone

---

### 3.4 Graph Traversal Questions (3)

**Intent:**

* Require following relationships across entities
* Cannot be answered by a single chunk in isolation

**Prompt:**

```
From the document below, generate 3 questions that:
- Require combining information from multiple sections
- Require following relationships between entities, components, or concepts
- Cannot be answered by reading a single chunk alone

For each question:
1. Write the question
2. Identify the top 4 most relevant chunks that must be combined to answer it

Document:
<<<DOCUMENT CHUNKS>>>
```

**Expected behavior:**

* Retrieval requires graph traversal

---

### 3.5 Hybrid Questions (3)

**Intent:**

* Require semantic matching to find an entry point
* Then traversal to collect related context

**Prompt:**

```
From the document below, generate 3 questions that:
- Use abstract or paraphrased language (not directly matching section titles)
- Require identifying a relevant concept first
- Then require gathering related information from connected sections or entities

For each question:
1. Write the question
2. Identify the top 4 most relevant chunks needed to answer it

Document:
<<<DOCUMENT CHUNKS>>>
```

---

### 3.6 Manual Validation

A human reviewer must:

* Verify that each question is answerable from the selected chunks
* Remove ambiguous or underspecified questions
* Ensure that selected chunks are truly necessary

Only **validated questions** are admitted to the final test set.

---

## 4. Retrieval Accuracy Metrics

### 4.1 Core Principle

Accuracy is evaluated by **matching expected content to retrieved content**, not by LLM-based judgment.

---

### 4.2 Metrics

#### 4.2.1 Chunk Presence Recall@K

For each query:

```
Recall@K = |ExpectedChunks ∩ RetrievedChunks[0:K]| / |ExpectedChunks|
```

Recommended values:

* K = 5 and 10

---

#### 4.2.2 Longest Common Subsequence (LCS) Coverage

For each expected chunk:

* Compute the **longest common character sequence** between the expected chunk text and each retrieved chunk
* Take the maximum overlap

Metric:

```
LCS Coverage = (Total matched characters) / (Total characters in expected chunks)
```

This captures partial matches when chunk boundaries differ.

---

#### 4.2.3 Noise Ratio

Measures irrelevant retrieval:

```
Noise Ratio = 1 - (RelevantRetrievedChunks / TotalRetrievedChunks)
```

Lower is better.

---

## 5. Latency Metrics

### 5.1 Per-Request Metrics

For each request:

* Total latency (client-side)
* Retriever processing time (if exposed)
* Number of returned chunks

---

### 5.2 Aggregate Metrics

Reported per configuration:

* Median latency (p50)
* Tail latency (p95)
* Latency vs traversal depth
* Latency vs result count

---

## 6. Testing Strategy

### 6.1 Overall Strategy

The testing strategy is designed to balance **coverage, interpretability, and efficiency**. Given limited time and resources, the approach avoids combinatorial explosion and instead focuses on:

* One-Parameter-At-a-Time (OPAT) testing
* Small but information-dense datasets
* Clear separation of correctness, accuracy, and performance signals

All tests are executed against the retriever microservice via its **HTTP REST API**, using a fixed input/output schema.

---

### 6.2 Baseline Configuration

A single **baseline configuration** is defined and validated first. This configuration represents a reasonable production-like setup and serves as the reference point for all comparisons.

Example baseline (illustrative):

```yaml
RETRIEVER_ARANGO_K: 5
RETRIEVER_ARANGO_SCORE_THRESHOLD: 0.5
RETRIEVER_ARANGO_SEARCH_START: "chunk"
RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH: 2
RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES: 3
```

All functional, accuracy, and latency tests must pass on the baseline before parameter sweeps begin.

---

### 6.3 Priority Parameters and Test Rationale

The following parameters are considered **priority parameters** due to their strong influence on retrieval quality, performance, and system stability.

---

#### 6.3.1 RETRIEVER_ARANGO_K

**Description:**
Number of documents/chunks returned by the retriever before reranking.

**Why it matters:**

* Directly affects recall
* Increases noise and latency when set too high
* Defines the upper bound of context available to downstream rerankers or generators

**Test values:**

* Low: 3–5
* Baseline: 10
* High: 20–30

**Metrics to observe:**

* Recall@K
* Noise ratio
* Latency (p50 / p95)

---

#### 6.3.2 RETRIEVER_ARANGO_SCORE_THRESHOLD

**Description:**
Similarity score threshold for vector search candidate selection.

**Why it matters:**

* Controls precision vs recall trade-off
* Strongly affects hybrid retrieval entry points
* Too high → empty or brittle retrieval
* Too low → excessive noise

**Test values:**

* Low: 0.5–0.6
* Baseline: 0.7–0.8
* High: 0.85–0.9

**Metrics to observe:**

* Recall@K
* LCS coverage
* Noise ratio

---

#### 6.3.3 RETRIEVER_ARANGO_SEARCH_START

**Description:**
Determines the starting point for graph traversal:

* `chunk`
* `node`
* `edge`

**Why it matters:**

* Affects traversal fan-out
* Influences whether semantic similarity or graph structure dominates retrieval
* Critical for hybrid behavior

**Test values:**

* chunk
* node
* edge

**Metrics to observe:**

* Recall by query type (similarity / traversal / hybrid)
* Noise ratio
* Latency variability

---

#### 6.3.4 RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH

**Description:**
Maximum depth of graph traversal.

**Why it matters:**

* Enables multi-hop reasoning
* Major driver of latency growth
* Risk of semantic drift at higher depths

**Test values:**

* Low: 0–1
* Baseline: 2
* High: 3–4

**Metrics to observe:**

* Recall@K (especially for traversal and hybrid queries)
* Noise ratio
* Latency vs depth curve

---

#### 6.3.5 RETRIEVER_ARANGO_TRAVERSAL_CONCURRENT_BATCHES

**Description:**
Number of concurrent batches (threads/workers) used during traversal.

**Why it matters:**

* Controls throughput and tail latency
* Can introduce contention or instability
* Impacts scalability under load

**Test values:**

* Low: 1
* Baseline: 2
* High: 4–8 (depending on hardware)

**Metrics to observe:**

* p95 latency
* Latency variance
* Error rates (timeouts, partial responses)

---

### 6.4 Parameter Sweep Methodology

For each priority parameter:

1. Fix all other parameters at baseline
2. Sweep the selected parameter across predefined values
3. Run the full query set (all 9 queries)
4. Record accuracy and latency metrics

This produces results that are:

* Interpretable
* Comparable across runs
* Easy to explain to stakeholders

---

### 6.5 Test Execution Program

The test program is responsible for:

* Loading test queries and parameter sets
* Sending HTTP POST requests to the retriever service
* Measuring end-to-end latency
* Parsing retrieved chunks and metadata
* Computing accuracy and noise metrics
* Writing structured JSON outputs

---

### 6.6 Result Storage and Comparison

All results are written to JSON files with:

* Query metadata
* Parameter configuration
* Accuracy metrics
* Latency metrics

These files can be:

* Compared across retriever versions
* Used for regression detection
* Aggregated into summary reports

---

## 7. Automation and Reproducibility

* Entire test suite runnable via a single command
* Deterministic inputs and configurations
* JSON outputs suitable for:

  * Regression testing
  * Trend tracking
  * CI integration

---

## 8. Expected Outcomes

This test plan provides:

* Fast validation of retriever correctness
* Quantitative accuracy benchmarks
* Clear latency–parameter trade-offs
* A reusable foundation for future retriever iterations
