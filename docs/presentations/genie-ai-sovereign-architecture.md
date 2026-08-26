---
marp: true
theme: genie-ai
paginate: true
size: 16:9
footer: 'GENIE.AI'
---


<!-- Title -->

<!-- _class: title -->
<!-- _paginate: false -->

<div class="hero-band"></div>
<div class="brand-pill">GENIE.AI</div>

<div class="eyebrow">GENIE.AI — Sovereign RAG Framework</div>

# Sovereign AI &amp;<br>Architecture Fundamentals

<div class="subtitle">Open-source RAG for public services — architecture, ingestion, security, and deployments</div>
<div class="date">2026-09-XX</div>

---

<!-- Agenda -->

<!-- _class: title -->
<!-- _paginate: false -->

<div class="eyebrow">GENIE.AI — Session Overview</div>

# Agenda

<div class="columns">
<div>

<div class="agenda-item"><span>1</span> Sovereign AI &amp; Architecture Fundamentals</div>
<div class="agenda-item"><span>2</span> Ingestion, Vector–Graph RAG &amp; Multilingual Engine</div>

</div>
<div>

<div class="agenda-item"><span>3</span> Security, IAM &amp; Zero-Hallucination Governance</div>
<div class="agenda-item"><span>4</span> Live Architecture &amp; Case Studies</div>

</div>
</div>

---

# What is GENIE.AI

<div class="eyebrow">Purpose-built framework</div>

<div class="columns">
<div>

- Open-source RAG framework for public institutions.
- Bridges AI policy ambitions and real services.
- Designed for chatbots, assistants and content tools.

</div>
<div>

- Runs on government-controlled infrastructure.
- Focus on low cost and local capacity-building.
- Technical backbone for AI-powered public services.

</div>
</div>

---

# Why GENIE Matters

<div class="eyebrow">Current reality vs GENIE response</div>

<div class="columns">
<div>

**Current reality**
- High-cost proprietary GenAI.
- Limited data/model sovereignty.
- Weak support for local languages.
- Vendor lock-in and long-term dependency.

</div>
<div>

**GENIE response**
- Open source, DPG/DPI aligned.
- Sovereign by design, deployable by governments.
- Localized and inclusive by configuration.
- Agentic-friendly roadmap for advanced use cases.

</div>
</div>

---

# Business as Usual vs GENIE.AI

<div class="eyebrow">Time, cost, risk</div>

|                | Business as usual | With GENIE.AI |
|----------------|-------------------|---------------|
| Budget         | ≈ US$ 250k        | ≈ US$ 50k     |
| Timeline       | 6–12 months       | 3–4 weeks     |
| Process        | RFP, vendor, custom build | Curate, configure, pilot |
| Ownership      | Vendor solutions  | Institutional assets |
| Risk           | Lock-in, pricing, data | Minimized; sovereign control |

<div class="ops-benefit"><strong>Takeaway:</strong> Same capabilities, but faster, cheaper, and under public control.</div>

---

# Session 1 — Sovereign AI &amp; Architecture

<div class="eyebrow">Where it runs and how it’s built</div>

- Sovereign, standards-based architecture.
- No external model APIs: vLLM / TEI on your stack.
- Clear separation between UI, gateway, backend, RAG and data.
- One topology from laptop PoC to Swarm / Kubernetes.

---

# GENIE.AI Core Stack

<div class="eyebrow">From user to AI services</div>

```mermaid
flowchart LR
  U[User<br/>Web / Mobile]:::client --> G[Kong<br/>Gateway]:::gateway
  G --> B[Backend<br/>Express/Node.js]:::core
  B --> C[ChatQnA<br/>RAG Orchestrator]:::ai
  C --> A[ArangoDB<br/>docs + graph + vectors]:::data
  C --> T[TEI<br/>Embeddings / Reranker]:::ai
  C --> L[LLM<br/>vLLM / OPEA]:::ai
classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef risk fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:1.5px,color:#166534;
```

<div class="ops-benefit"><strong>Key idea:</strong> UI and business logic are decoupled from models and storage.</div>

---

# Deployment Topologies

<div class="eyebrow">From laptop PoC to production cluster</div>

```mermaid
flowchart LR
  L["**Local PoC**<br/>Docker Compose"]:::orch --> S["**Docker Swarm**<br/>multi-node"]:::orch --> K8S["**Kubernetes**<br/>(optional)"]:::orch

classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef risk fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:1.5px,color:#166534;
```

<div class="columns">
<div>

**Same service set, three orchestrators**
- One `docker-compose.yaml` for every environment.
- Profiles to enable/disable AI &amp; observability.

</div>
<div>

**Kubernetes supported out-of-the-box**
- Same compose contract maps to K8s manifests.
- Gradual migration: laptop → Swarm → K8s.

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> One architecture, three orchestrators — laptop, Swarm, Kubernetes.</div>


---

# Session 2 — Ingestion &amp; Vector–Graph RAG

<div class="eyebrow">From documents to grounded answers</div>

- Ingestion pipeline with ClamAV, parsing and chunking.
- ArangoDB as multi-model store.
- Hybrid vector–graph retrieval.
- Multilingual engine with single English index.

---

# Ingestion Pipeline

<div class="eyebrow">From raw files to knowledge base</div>

```mermaid
flowchart LR
  U[Upload<br/>PDF / DOCX / scans] --> V[ClamAV<br/>virus scan]
  V --> P[Parse / OCR<br/>Docling pipeline]
  P --> C[Chunk<br/>structure-aware]
  C --> L[Label<br/>metadata &amp; ACL]
  L --> I[Index<br/>ArangoDB docs+graph+vec]
```

<div class="ops-benefit"><strong>Key idea:</strong> one standard pipeline, no ad-hoc scripts per ministry.</div>

---

# Why Vector-Only RAG Fails

<div class="eyebrow">Legal and policy documents</div>

<div class="columns">
<div>

- Dense, nested structures and annexes.
- Cross-references and definitions across sections.
- Semantically similar ≠ legally equivalent.

</div>
<div>

```mermaid
flowchart TB
  Q[Query] --> V[Vector search only]
  V --> P1[Paragraph A<br/>out of context]
  P1 --> RISK[✓ Plausible<br/>✗ Legally wrong]
```

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> structure and relationships matter as much as similarity.</div>

---

# Hybrid Vector–Graph RAG

<div class="eyebrow">Combining meaning and structure</div>

```mermaid
flowchart TB
  Q[Query] --> EV[Embed query]
  EV --> VS[Vector search<br/>top-k chunks]
  VS --> G[Graph expansion<br/>parents / refs / defs]
  G --> RR[Rerank]
  RR --> LLM[LLM<br/>grounded answer]
```

<div class="ops-benefit"><strong>Key idea:</strong> retrieve the right article, its exceptions, and its definitions together.</div>

---

# Multilingual Engine &amp; Single Source of Truth

<div class="eyebrow">One English index, many UI languages</div>

```mermaid
sequenceDiagram
  participant U as User (FR / ES / AR...)
  participant TQ as Translate Query → EN
  participant R as RAG (EN index)
  participant TA as Translate Answer → UI lang

  U->>TQ: Question in local language
  TQ->>R: Query (EN)
  R-->>R: Retrieve + generate (EN)
  R->>TA: Answer (EN)
  TA->>U: Answer in user language
```

<div class="ops-benefit"><strong>Key idea:</strong> one canonical index, consistent behaviour across languages.</div>

---

# Session 3 — Security, IAM &amp; Governance

<div class="eyebrow">Zero-trust, zero-hallucination</div>

<div class="columns">
<div>

### Identity

- Keycloak (OIDC / SAML).
- SSO across UI, admin, APIs.
- Roles &amp; groups mapping.

</div>
<div>

### Permissions

- Document-level ACL.
- Just-in-time checks.
- “No rights → no chunk”.

</div>
<div>

### Grounding

- Only retrieved chunks.
- Confidence thresholds.
- Abstain instead of hallucinate.

</div>
</div>

---

# Zero-Hallucination Behaviour

<div class="eyebrow">Simple decision path</div>

```mermaid
flowchart TB
  Q[User query] --> R[Retrieve evidence]
  R --> D{Relevant &amp;<br/>sufficient?}
  D -->|Yes| A[Grounded answer<br/>with citations]
  D -->|No| N["I cannot answer<br/>from available documents"]
```

<div class="ops-benefit"><strong>Key idea:</strong> safer for health, law and regulation than “best-effort guessing”.</div>

---

# Trace Context &amp; Auditability

<div class="eyebrow">End-to-end visibility</div>

```mermaid
sequenceDiagram
  participant C as Client
  participant K as Kong
  participant BE as Backend
  participant CQ as ChatQnA
  participant AR as ArangoDB
  participant AI as AI services

  C->>K: HTTP request (traceparent)
  K->>BE: Forward with trace context
  BE->>CQ: Chat / RAG call
  CQ->>AR: Retrieve
  CQ->>AI: Embeddings / LLM / translate
  AI-->>CQ: Results
  CQ-->>BE: Answer + spans
  BE-->>C: Streamed response
```

<div class="ops-benefit"><strong>Key idea:</strong> every hop is traceable for debugging, SLOs and legal review.</div>

---

# Session 4 — Architecture &amp; Case Studies

<div class="eyebrow">From topology to deployments</div>

- Microservices topology at a glance.
- Compose profiles, Swarm / Kubernetes mapping.
- Example deployments and patterns.
- Open Q&amp;A with engineering team.

---

# Microservices Topology

<div class="eyebrow">High-level view</div>

```mermaid
flowchart LR
  U[Users] --> K[Kong<br/>Gateway]
  K --> W[Web SPA<br/>Vue.js]
  K --> BE[Backend<br/>Express]

  BE --> CQ[ChatQnA<br/>RAG service]
  BE --> DR[Doc Repo<br/>ingestion]

  CQ --> AR[ArangoDB<br/>docs+graph+vec]
  CQ --> SVC[AI services<br/>TEI / LLM / Reranker]

  subgraph Data &amp; AI
    AR
    SVC
  end
```

<div class="ops-benefit"><strong>Key idea:</strong> easy to reason about what scales, what is stateful, and what sits near the network edge.</div>

---

# Example Deployments &amp; Use Cases

<div class="eyebrow">Patterns, not one-offs</div>

<div class="columns">
<div>

### Use cases

- Agriculture advisory assistants.
- Public health information assistants.
- Policy / regulatory assistants.

</div>
<div>

### Patterns

- Same core architecture, different collections.
- Different languages per country.
- Same governance and deployment pipeline.

</div>
</div>

---

# Q&amp;A &amp; Technical Feasibility

<div class="eyebrow">Discussion with your team</div>

<div class="columns">
<div>

**Topics**
- Target environment (cloud / on-prem).
- Swarm vs Kubernetes.
- Identity integration (Keycloak, IdPs).
- GPU/CPU sizing and constraints.

</div>
<div>

**Next steps**
- Define a pilot scope and success criteria.
- Align on governance and observability.
- Plan a phased rollout to production.

</div>
</div>

---

<!-- Closing -->

<!-- _class: closing -->
<!-- _paginate: false -->

<div class="hero-band"></div>

# Thank You

<div style="font-size: 1.3rem; margin-top: 0.5rem;">
GENIE.AI — Sovereign AI for the Public Sector
</div>

<div style="margin-top: 2rem; font-size: 0.95rem;">
  <p>Happy to deep dive into any box of the architecture during Q&amp;A.</p>
</div>
