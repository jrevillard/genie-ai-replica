# Architecture diagrams — RAGAS benchmarking (Story 8-6)

All diagrams are the additive delta on the existing Routing Lab (`head-test-service` + `head-suite-service`). No existing arrow changes.

## Service topology

```mermaid
flowchart LR
  subgraph Frontend
    HTD[HeadTestDialog.vue<br/>4th tab: RAGAS pane]
    RP[RagasPanel.vue]
    HTD --> RP
  end
  subgraph Node["okf-server (Node, existing)"]
    RSS[ragas-suite-service.js<br/>NEW: jobs, persistence, authz]
    HTS[head-suite-service.js<br/>existing, untouched]
    FMS[frontmatter-service.js<br/>teiEmbed / vllmChatCompletions]
    RSS -.reads.-> AR[(ArangoDB<br/>okf_head_test_runs + _SOURCE)]
    RSS --> FMS
  end
  subgraph Sidecar["ragas-service (NEW Python, FastAPI)"]
    GEN["POST /generate-testset<br/>ragas TestsetGenerator"]
    EV["POST /evaluate<br/>ragas evaluate()"]
    XLS["POST /xlsx/*<br/>openpyxl import+export"]
  end
  RSS -->|shared secret| GEN
  RSS -->|shared secret| EV
  RSS <-->|shared secret| XLS
  GEN --> VLLM[(vLLM judge<br/>RAGAS_JUDGE_*)]
  GEN --> TEI[(TEI embed<br/>RAGAS_EMBED_*)]
  EV --> VLLM
  EV --> TEI
```

## Suite generation flow (CAP-1)

```mermaid
sequenceDiagram
  participant UI as RagasPanel
  participant API as okf-server (202)
  participant DB as okf_head_test_runs
  participant RS as ragas-service
  UI->>API: POST /ragas-testsuite {repo_ids[], testset_size}
  API->>DB: save ragas_suite placeholder (status generating)
  API-->>UI: 202 {suite_key}
  API->>RS: POST /generate-testset {documents[] (concept bodies), size, distribution}
  RS->>RS: KnowledgeGraph + personas + scenario synthesis
  RS-->>API: samples[{user_input, reference, reference_contexts, persona, synthesizer}]
  API->>DB: replace suite (status done, entries as new-N rows)
  loop poll 2.5s
    UI->>API: GET /ragas-testsuite/:suite_key
  end
```

## Run flow (CAP-3) — Lab-internal replay, never chatqna-over-HTTP

```mermaid
sequenceDiagram
  participant UI as RagasPanel
  participant API as okf-server (202)
  participant DB as ArangoDB
  participant RS as ragas-service
  UI->>API: POST /ragas-testsuite/:suite_key/run
  API->>DB: save ragas_run placeholder (running, progress)
  API-->>UI: 202 {run_key}
  loop each entry (bounded concurrency)
    API->>DB: AQL APPROX_NEAR_COSINE per selected repo _SOURCE (head-weighted merge)
    API->>API: rerankTexts (existing rerank seam) -> contexts
    API->>API: vllmChatCompletions (CHATQNA_SYSTEM_PROMPT-shaped) -> answer
  end
  API->>RS: POST /evaluate {samples: user_input/retrieved_contexts/response/reference}
  RS-->>API: {aggregate, per_query: 4 metrics}
  API->>DB: replace run (done, results + summary + fidelity knobs)
  loop poll with progress {phase: retrieval|judge, done, total}
    UI->>API: GET .../runs/:run_key
  end
```

## xlsx interchange (CAP-2)

```mermaid
flowchart TB
  subgraph Export
    S[ragas_suite doc] -->|JSON| X1[sidecar /xlsx/export-suite]
    X1 -->|Test Dataset layout| F1[ suite .xlsx ]
    R[ragas_run doc] -->|JSON| X2[sidecar /xlsx/export-results]
    X2 -->|Gold + Run_ + Compare tabs| F2[ results .xlsx ]
  end
  subgraph Import
    F3[Jerome-format suite .xlsx] -->|bytes| X3[sidecar /xlsx/import-suite]
    X3 -->|entries as new-N| S2[ragas_suite doc]
    F4[results .xlsx ours or his v2] -->|bytes| X4[sidecar /xlsx/import-results]
    X4 -->|runs tagged imported| R2[ragas_run docs]
  end
  F1 -. feeds unmodified .-> JT[xlsx_to_gold.py on the swarm node]
```

## UI placement (CAP-4/5/6)

```mermaid
flowchart LR
  subgraph HeadTestDialog [HeadTestDialog.vue - 4 entry points unchanged]
    T1[Head] --- T2[Test] --- T3[Suites] --- T4[RAGAS - NEW]
    T3 -->|saved-suites table: both kinds + DsPill RAGAS| SEL{select RAGAS suite}
    SEL -->|switches tab + loads| T4
    T4 --> RP[RagasPanel.vue: generate form / entry table / run results: table + gauges + trend / explain chips]
  end
```
