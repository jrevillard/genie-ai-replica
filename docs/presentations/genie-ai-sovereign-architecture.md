---
marp: true
theme: genie-ai
paginate: true
size: 16:9
footer: 'GENIE.AI'
---

<!-- _class: title -->
<!-- _paginate: false -->

<div class="hero-band"></div>
<div class="brand-pill">GENIE.AI</div>

<div class="eyebrow">GENIE.AI — Sovereign RAG Framework</div>

# Sovereign AI for<br>the Public Sector

<div class="subtitle">Discovery Workshop — Part 1 of 2 · GENIE.AI Deep Dive</div>
<div class="subtitle" style="font-size: 1rem; margin-top: 0.3rem;">
Government of Kenya · ITU Technical Working Group
</div>


---

<!-- _class: title -->
<!-- _paginate: false -->

<div class="brand-pill">GENIE.AI</div>

<div class="eyebrow">Workshop — Part 1 · 60 min</div>

# Agenda

<div class="columns">
<div>

<div class="agenda-item"><span>1</span> Sovereign AI &amp; Architecture Fundamentals</div>
<div class="agenda-item"><span>2</span> Hybrid Ingestion, Vector-Graph RAG &amp; Multilingual</div>

</div>
<div>

<div class="agenda-item"><span>3</span> Security, IAM &amp; Zero-Hallucination Governance</div>
<div class="agenda-item"><span>4</span> Live Architecture Walkthrough &amp; Case Studies</div>

</div>
</div>

<br><br><br><br>

Part 2 — Agile Scoping (1 h) follows after the break.


---

<div class="eyebrow">Before we start · 60-second shared definition</div>

# What is GENIE.AI

<div class="columns"">

<div>
<br>

**ITU GENIE.AI** — *Global Empowerment through Intelligence and Equity.*

An **open-source framework** for public institutions to prototype, deploy and run custom generative AI solutions — chatbots, assistants, content tools — **at low cost, with full control, and without external API calls.**

Runs on **government-controlled infrastructure**: Intel/NVIDIA stacks, Docker Swarm or Kubernetes. **An ITU initiative**.

</div>
<div>

![GENIE.AI logo mark](assets/genie-logo-mark.png)
<div class="caption">ITU · Open Source</div>

</div>
</div>

<div class="ops-benefit"><strong>Why now:</strong> governments want AI but most can't afford proprietary solutions, lack sovereign data control, and depend on vendors locked to non-local languages.</div>


---

<!-- _class: session-divider -->
<!-- _paginate: false -->

<div class="session-num">01</div>
<div class="eyebrow">Session 1</div>

# Why Sovereign AI &amp;<br>Architecture

<div class="tagline">Public-sector AI under government control — from silicon to UI.</div>


---

<div class="eyebrow">Session 1 · The GENIE.AI mandate</div>

# A Strategic Approach to Public Value

<div class="tagline">No isolated projects — ecosystem, enablement, and impact delivered as one ITU programme.</div>

![GENIE.AI mandate banner — Open Source Ecosystem Enabler (OSEE), GENIE.AI, AI for Good Challenge](assets/genie-mandate-banner.png)

<div class="caption">OSEE · GENIE.AI · AI for Good Challenge</div>

<div class="columns" style="margin-top: 0.4rem; gap: 1rem;">
<div>

**Ecosystem** — *Building the foundations.*
- Open-source training framework
- Skills development in country
- Open-source programme offices
- Ecosystem strengthening & mobilisation

</div>
<div>

**Enablement** — *Turning foundations into capabilities.*
- Open-source AI building blocks
- Expert training
- Real-world implementation experience

</div>
<div>

**Impact** — *Delivering impact at scale.*
- Bringing innovation into the field
- Connecting with local ecosystems
- Accelerating AI-powered public services

</div>
</div>


---

<div class="eyebrow">Session 1 · Mandate alignment</div>

# Aligned with ITU-D Resolutions

<div class="columns">
<div>

### Direct mandate link
- **Resolution 89** — Digital transformation for sustainable development.
- **Resolution 73** — Structured digital capacity development.
- **Resolution 90** — Fostering ICT-centric innovation ecosystems.
- **Resolution 45** — Trusted, sovereign, DPI-aligned AI.

All operationalized through the **Baku Declaration &amp; Baku Action Plan (2026–2029)**.

</div>
<div>

![ITU-D priorities and AFR Flagship — Kenya](assets/genie-itud-priorities.png)
<div class="caption">ITU-D priorities · AFR Flagship = Kenya</div>

</div>
</div>

<div class="ops-benefit"><strong>AFR Flagship — Kenya:</strong> GENIE.AI is the designated AI framework for the ITU Africa Regional Initiative.</div>


---

<div class="eyebrow">Session 1 · The architecture</div>

# One Architecture — Sovereign by Design

<div class="columns" style="margin-top: 0.6rem;">
<div>

### Core stack (all open-source)
- **Frontend** — Vue.js web · Flutter mobile.
- **Gateway** — Kong with OIDC plugin.
- **App layer** — Express / Node.js BFF (JWT verify).
- **Storage** — ArangoDB (docs + vectors + graph).

</div>
<div>

### Inference (on your GPU/CPU)
- **LLM** — vLLM (OpenAI-compatible API).
- **Embeddings + rerank** — TEI.
- **Hardware** — Intel (CPU) and NVIDIA (GPU) validated.

</div>
</div>

</div>

<div class="columns">
<div style="flex: 5;">

```mermaid
flowchart LR

  U["👤 User"]:::client --> K["🛡️ Kong<br/>API Gateway"]:::gateway
  K --> B["⚙️ Backend<br/>Express / Node.js"]:::gateway
  B --> Q["🧠 ChatQnA<br/>RAG orchestrator"]:::orch
  Q --> A["🗄️ ArangoDB"]:::data
  Q --> T["🔢 TEI<br/>embed · rerank"]:::ai
  Q --> L["💬 vLLM<br/>LLM inference"]:::ai

classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;

```
</div>
<div class="narrow">

```mermaid
flowchart LR
  subgraph RAILS ["🔐 Identity & 📡 Observability"]
    KC["🔐 Keycloak 26<br/>JWKS validation"]:::rail
    OTEL["📡 OTel Collector<br/>W3C traceparent"]:::rail
  end

classDef rail fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;

```
</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> the data flow lives entirely on your stack. Identity (Keycloak 26) and observability (OTel + W3C traceparent) are <em>rails</em> across every hop — not bolt-ons.</div>

---

<div class="eyebrow">Session 1 · What "sovereign" actually means here</div>

# Sovereignty Guarantees

<div class="compare" style="margin-top: 1.2rem;">
  <div class="head"></div>
  <div class="head">Business as usual</div>
  <div class="head">GENIE.AI</div>

  <div class="label">Pilot cost</div>
  <div class="ba">$200k–500k (closed-source RFP)</div>
  <div class="genie">≈$50k (open-source stack)</div>

  <div class="label">Time to pilot</div>
  <div class="ba">6–12 months</div>
  <div class="genie">3–4 weeks</div>

  <div class="label">External API calls</div>
  <div class="ba">Always-on vendor endpoints</div>
  <div class="genie">Zero — fully on-prem</div>

  <div class="label">UI languages</div>
  <div class="ba">1 (English) or expensive add-on</div>
  <div class="genie">11+ from a single English index</div>

  <div class="label">Vendor lock-in</div>
  <div class="ba">Proprietary weights + APIs</div>
  <div class="genie">Open weights, open source (DPG)</div>
</div>

<div class="columns" style="margin-top: 1rem;">
<div>

### All artefacts in your jurisdiction
- Docker images · models · ArangoDB · vector store · logs

### Open weights, open source
- Apache-2.0 / MIT. Compliant with the **OSI Open Source AI Definition**.
- No proprietary model APIs. **Digital Public Good** (DPG) registered.

</div>
<div>

### Hardware-agnostic
- Intel &amp; NVIDIA stacks validated. vLLM + TEI inference.

### No vendor lock-in
- Same compose file: laptop PoC → Docker Swarm production.
- Kubernetes manifests planned (same images, different orchestrator).

</div>
</div>

<div class="ops-benefit"><strong>Takeaway:</strong> "sovereign" is structural here, not contractual. Every layer runs inside your perimeter.</div>


---

<div class="eyebrow">Session 1 · The five principles guiding every GENIE.AI build</div>

# The Five Brand Pillars

![The five GENIE.AI brand pillars](assets/genie-brand-pillars.png)

<div class="card-row">
<div class="card">
  <div class="card-num">01</div>
  <div class="card-name">Local Ownership</div>
  <p>Code, data, models — all on your stack.</p>
  <p><em>Keycloak + ArangoDB stay on-prem.</em></p>
</div>
<div class="card">
  <div class="card-num">02</div>
  <div class="card-name">Open Source</div>
  <p>OSI + DPG compliant. Apache-2.0 / MIT.</p>
  <p><em>No proprietary model APIs.</em></p>
</div>
<div class="card">
  <div class="card-num">03</div>
  <div class="card-name">Zero-Hallucination</div>
  <p>Architectural abstention when evidence is absent.</p>
  <p><em>Every answer cites its source chunk.</em></p>
</div>
<div class="card">
  <div class="card-num">04</div>
  <div class="card-name">Scalability &amp; Accessibility</div>
  <p>11+ UI languages · web + mobile clients.</p>
  <p><em>Laptop PoC → Docker Swarm. Kubernetes (roadmap).</em></p>
</div>
<div class="card">
  <div class="card-num">05</div>
  <div class="card-name">Real-World Deployment</div>
  <p>Operational since 2024 across UN missions.</p>
  <p><em>6 active country pilots · 100+ stakeholders.</em></p>
</div>
</div>

<div class="ops-benefit"><strong>Workshop tie-in:</strong> Session 3 zooms into pillar #1 (Local Ownership → Keycloak + W3C trace) and pillar #3 (Zero-Hallucination → grounding &amp; abstention).</div>


---

<!-- _class: session-divider -->
<!-- _paginate: false -->

<div class="session-num">02</div>
<div class="eyebrow">Session 2</div>

# How GENIE.AI Works

<div class="tagline">From document to grounded, multilingual answer — every stage under your control.</div>


---

<div class="eyebrow">Session 2 · The operating model</div>

# Deploy, Configure, Tune, Pilot

<div class="columns">
<div>

**1. Deploy** a GENIE.AI instance in cloud or on-premise.

**2. Select data** — drag-and-drop, plus custom integrations.

**3. Tune** RAG macro-parameters and configure the UI (or connect to a custom UI / messenger app).

**4. Launch** the pilot, gather feedback, iterate — **with full control at every step**.

</div>
<div>

![GENIE.AI four-step workflow](assets/genie-how-it-works.png)
<div class="caption">Deploy → Configure → Tune → Pilot</div>

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> the pilot is in your hands. No vendor in the loop. No external API calls.</div>


---

<div class="eyebrow">Session 2 · One index, many languages</div>

# Multilingual Engine

```mermaid
sequenceDiagram
  participant U as 👤 User (EN / FR / SW / ES / …)
  participant TQ as Translate query → EN
  participant R as RAG (English index)
  participant TA as Translate answer → UI lang

  U->>TQ: "Bei ya msimu wa mvua ni ngapi?"
  TQ->>R: Query (EN)
  R-->>R: Retrieve + generate (EN)
  R->>TA: Answer (EN)
  TA->>U: "The average rainfall this season is 320 mm."
```

<div class="columns" style="margin-top: 0.6rem;">
<div>

### One canonical index
- Knowledge base stored in **English** (canonical SSoT).
- Chunking, embedding, labeling — all English-native.

</div>
<div>

### 11+ UI languages
- Query translation + answer translation on the fly.
- **Swahili · French · Arabic · Spanish · Portuguese** + 6 more.

</div>
</div>

<div class="metric-row">
  <div class="metric"><div class="number">11+</div><div class="label">UI languages out-of-the-box</div></div>
  <div class="metric"><div class="number">1</div><div class="label">Canonical English index</div></div>
  <div class="metric"><div class="number">+1</div><div class="label">Add a language = config change</div></div>
  <div class="metric"><div class="number">0</div><div class="label">Re-indexing when extending</div></div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> one English index, consistent behaviour across languages. New language = add translator config, no re-index.</div>

---

<div class="eyebrow">Session 2 · How documents enter the system</div>

# Ingestion Pipeline

```mermaid
flowchart LR
  U[Upload<br/>PDF · DOCX · scans] --> V[ClamAV<br/>scan]:::core
  V -->|clean| P[Docling<br/>parse + OCR]:::core
  V -.->|infected| Q["🛑 Quarantine"]:::risk
  P --> C[Chunk<br/>structure-aware]:::core
  C --> X["Context prefix<br/>(LLM, on by default)"]:::core
  X --> L["Late label<br/>taxonomy + ACL"]:::core
  L --> E[TEI embed]:::ai
  E --> A[ArangoDB<br/>docs · vec · graph]:::data

classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef risk fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:1.5px,color:#166534;
```

<div class="ops-benefit"><strong>Key idea:</strong> one standard pipeline — no ministry-specific glue scripts. Context prefix + late labeling happen after ClamAV clears the file.</div>


---

<div class="eyebrow">Session 2 · How retrieval works</div>

# Hybrid Vector–Graph Retrieval

```mermaid
flowchart LR
  Q["🔍 Query"] --> E["TEI embed"]:::core
  E --> V["Top-k<br/>vector ANN<br/>(ArangoDB)"]:::ai
  V --> G["Graph expand<br/>parents · refs · defs"]:::data
  G --> R["Rerank<br/>TEI cross-encoder"]:::ai
  R --> L["LLM<br/>grounded answer"]:::ok

classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef risk fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:1.5px,color:#166534;
```

<div class="columns" style="margin-top: 0.6rem;">
<div>

### Why hybrid?
**Pure vector** misses entity links, fails on legalese.
**Pure graph** misses semantic similarity.

</div>
<div>

### What GENIE does
Vector top-k → graph expansion (parents · refs · defs) → TEI cross-encoder rerank → grounded LLM answer.

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> retrieve the article, its exceptions, and its definitions — together.</div>


---

<!-- _class: session-divider -->
<!-- _paginate: false -->

<div class="session-num">03</div>
<div class="eyebrow">Session 3</div>

# Trust, Identity &amp;<br>Observability

<div class="tagline">Hard grounding, real identities, traceable answers.</div>


---

<div class="eyebrow">Session 3 · Pillar 1 → "Local Ownership" made technical</div>

# Identity: Keycloak 26 + OIDC / SAML / Entra

```mermaid
flowchart LR
  U["👤 User"] --> IDP["🛡️ Identity Provider<br/>Keycloak 26 / Entra / SAML"]
  IDP -->|OIDC token| K["Kong<br/>OIDC plugin"]
  K -->|JWT| B["⚙️ Backend<br/>JWT verify (JWKS)"]
  B -->|user claims + ACL| ACL["📑 Document ACL<br/>just-in-time claims"]
  ACL --> Q["🧠 ChatQnA<br/>scoped to user entitlements"]
  Q --> A["🗄️ ArangoDB<br/>scoped query"]

classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef risk fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:1.5px,color:#166534;
```

<div class="columns" style="margin-top: 0.6rem;">
<div>

### What Keycloak handles
- **Federation**: SAML, Entra ID, OIDC, generic OIDC providers.
- **JWT access tokens** validated via **JWKS** (rotated keys).
- **Just-In-Time (JIT) provisioning**: user claims → per-document ACL tags on first hit.
- **Document-level ACL** evaluated at retrieval time.

</div>
<div>

### What this means for you
- "No rights → no chunk" — enforced, not promised.
- Every document carries per-chunk entitlement tags.
- IDP swap is a config change, not a code change.

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> identity is the perimeter. Document-level ACL makes governance enforceable, not aspirational.</div>


---

<div class="eyebrow">Session 3 · Pillar 3 → "Zero-Hallucination"</div>

# Grounding: Zero-Hallucination Decision

```mermaid
flowchart TB
  Q["🔍 User query"] --> R["Retrieve<br/>relevant chunks<br/>(ArangoDB)"]:::core
  R --> D{"Sufficient<br/>evidence?"}:::risk
  D -->|Yes + confident| A["✓ Grounded answer<br/>+ citations"]:::ok
  D -->|No| N["✗ Abstain<br/>'I cannot answer from<br/>available documents'"]:::risk

classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef risk fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:1.5px,color:#166534;
```

<div style="margin-top: 0.4rem; padding: 1rem 1.2rem; background: oklch(98% 0.005 160 / 0.6); border-left: 3px solid oklch(62% 0.17 162 / 0.6); border-radius: 0 10px 10px 0; font-size: 1rem;">
"<strong>If the answer is not in your documents, the system abstains.</strong> It does not improvise."
</div>

<div class="ops-benefit"><strong>Key idea:</strong> safer than "best-effort guessing." The model refuses to answer rather than fabricate — and every answered question ships with citations.</div>


---

<div class="eyebrow">Session 3 · Observability across every hop</div>

# Observability: End-to-End Trace Context

```mermaid
sequenceDiagram
  participant U as 👤 User
  participant FE as Vue
  participant K as Kong
  participant BE as Backend
  participant CQ as ChatQnA
  participant DB as ArangoDB
  participant OT as OTel

  U->>FE: question
  FE->>K: HTTP + traceparent
  K->>BE: propagate
  BE->>CQ: chat (trace ctx)
  CQ->>DB: retrieve (ACL-scoped)
  DB-->>CQ: chunks
  CQ->>OT: span (retrieve)
  CQ->>BE: answer + chunks
  CQ->>OT: span (generate)
  BE->>FE: streamed answer
  FE->>U: response

  Note over U,OT: Every hop emits a span via W3C traceparent.<br/>10 Grafana dashboards surface latency, errors, retrieval quality.
```

<div class="metric-row" style="margin-top: 0.4rem;">
  <div class="metric"><div class="number">OTel</div><div class="label">W3C traceparent · every hop</div></div>
  <div class="metric"><div class="number">10</div><div class="label">Pre-built Grafana dashboards</div></div>
  <div class="metric"><div class="number">1 env var</div><div class="label">Enable the full obs stack</div></div>
</div>

<div style="margin-top: 0.4rem; padding: 1rem 1.2rem; background: oklch(98% 0.005 160 / 0.6); border-left: 3px solid oklch(62% 0.17 162 / 0.6); border-radius: 0 10px 10px 0; font-size: 1rem;">
"<strong>Inspectable by design.</strong> Every answer carries the exact document chunk that produced it — auditable end-to-end via W3C <code>traceparent</code>."
</div>

<div class="ops-benefit"><strong>Key idea:</strong> legal officers, compliance and SREs see the same data — the exact chunk that synthesized an answer, plus the latency of every hop. Built on the <strong>W3C trace context</strong> standard.</div>


---

<!-- _class: session-divider -->
<!-- _paginate: false -->

<div class="session-num">04</div>
<div class="eyebrow">Session 4</div>

# Deployments &amp;<br>Country Use Cases

<div class="tagline">GENIE.AI in the field — six countries, real pilots.</div>


---

<div class="eyebrow">Session 4 · Operational deployment</div>

# docker-compose Profiles

<div class="columns">
<div>

### Core stack — always on
- Frontend · Backend · Kong · Keycloak
- ArangoDB · Redis · Document repository
- ClamAV · Dataprep

</div>
<div>

### Three opt-in profiles
- **`opea`** → activates AI/ML services (ChatQnA, Dataprep).
- **`gpu-models`** → adds vLLM + TEI inference on GPU.
- **`observability`** → enables OTel + Grafana + Victoria stack.

</div>
</div>

<div class="metric-row">
  <div class="metric"><div class="number">1</div><div class="label">Same compose file</div></div>
  <div class="metric"><div class="number">3</div><div class="label">Opt-in profiles</div></div>
  <div class="metric"><div class="number">∞</div><div class="label">Scales horizontally (Swarm)</div></div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> you choose your own complexity. PoC on a laptop, production on Docker Swarm. Kubernetes is on the roadmap (same images, different orchestrator).</div>


---

<div class="eyebrow">Session 4 · Active deployments</div>

# GENIE.AI in the Field

![GENIE.AI country deployments — Kenya, Lesotho, The Gambia, Bangladesh, El Salvador, Mauritius](assets/genie-country-deployments.png)
<div class="caption">6 active country pilots · 100+ stakeholders · 1 global mission</div>

<div class="ops-benefit"><strong>Kenya's pilot focus:</strong> public-administration chatbot — service discovery, task automation, citizen-centric experience.</div>


---

<div class="eyebrow">Session 4 · Use cases &amp; Q&amp;A</div>

# Use Cases × Building Blocks × Live-In

<div style="margin-top: 0.6rem;">

| Use case | Building block | Data class | Live in |
|----------|---------------|------------|---------|
| **Agriculture extension** | Hybrid retrieval · late label | Public docs + ministry corpus | El Salvador, The Gambia, Bangladesh |
| **Preventive health** | Keycloak ACL · grounding | Public-health guidelines | The Gambia, Mauritius |
| **Climate-risk advisories** | Vector+graph · trace context | Weather + policy docs | El Salvador, Bangladesh, Kenya (pilot) |

</div>

<div style="margin-top: 1rem; padding: 1rem 1.2rem; background: oklch(98% 0.005 160 / 0.6); border-left: 3px solid oklch(62% 0.17 162 / 0.6); border-radius: 0 10px 10px 0;">
<strong>Q&amp;A — open floor.</strong> Bring your hardest data-sovereignty question.
<br>After the break: <strong>Part 2 — Agile Scoping</strong> (Marketplace of Skills · Impact Mapping · Dot-vote).
</div>

<div class="ops-benefit"><strong>Workshop tie-in:</strong> in Part 2, we'll down-select ONE of these use cases (or a new one from your team) for the Kenya pilot — keeping it low-risk and zero-PII.</div>
