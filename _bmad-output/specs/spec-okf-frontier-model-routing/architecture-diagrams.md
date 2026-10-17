# Architecture diagrams — frontier-model routing

Companion to SPEC.md. Mermaid; diagrams live in this companion per Spec Law.

## Decision flow — every LLM call in the framework

```mermaid
flowchart TD
    A[LLM call site<br/>admin op or inference] --> R{llm-router resolves operation}
    R -->|no profile / master off / toggle off| L[local vLLM<br/>openai-compatible adapter<br/>deployment env config]
    R -->|profile + toggle on| F[frontier adapter<br/>openai-compatible OR anthropic]
    F --> FOK{call ok?}
    FOK -- "yes" --> N[normalized response<br/>text / finishReason / usage / stream]
    FOK -- "no (retry ladder,<br/>429 Retry-After, timeout)" --> L2[degrade to local<br/>LOUD log + visible note]
    L --> N
    L2 --> N
```

## Propagation topology

```mermaid
flowchart LR
    UI[Model Routing tab<br/>AdminDashboard] -->|PUT /frontier-config<br/>tools-admin| CFG[okf_system_config<br/>_key: frontier_model<br/>token write-only]
    CFG --> RT[llm-router<br/>okf-server]
    RT --> NODES[Node admin callers<br/>curation · tags · suites · RAGAS answer leg]
    RT -->|GET /internal/llm-routing<br/>X-Internal-Secret, TTL cache| PY[OPEA services<br/>dataprep: labeling + contextual<br/>chatqna: inference]
    RT -->|per-request judge overrides<br/>existing job factory| RG[ragas-service sidecar]
    NODES --> VLLM[local vLLM]
    PY --> VLLM
    RG --> VLLM
    RT --> |frontier toggled| EXT[frontier API<br/>OpenAI-compatible / Anthropic]
    TEI[TEI embeddings + reranking<br/>ALWAYS local] -.never routed.-> X((dimension-coupled))
```

## Config write path (secret safety)

```mermaid
sequenceDiagram
    participant Admin
    participant API as PUT /api/okf/frontier-config
    participant Svc as frontier-config-service
    participant DB as okf_system_config
    participant Audit as okf_audit_logs
    Admin->>API: profile + token (password field)
    API->>Svc: joi-validated payload
    Svc->>DB: replace with _rev precondition (1 retry)
    Svc->>Audit: BEFORE/AFTER with api_token MASKED
    Svc-->>Admin: 200 — GET ever after returns token_configured: true
```
