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

<div class="eyebrow">Sovereign RAG Framework</div>

# GENIE.AI<br>Discovery Workshop

<div class="subtitle" style="font-size: 1rem; margin-top: 0.3rem;">
Government of Kenya & ITU Technical Working Group
</div>

---

<!-- _class: title -->
<!-- _paginate: false -->

<div class="brand-pill">GENIE.AI</div>

<div class="eyebrow">Master Workshop Agenda</div>

# Agenda

<div style="text-align:left; margin: 0.6rem 0; z-index: 1; line-height: 1;">


### Introduction (30 min)
- **Welcome address** (10 min)
- **Around the table** (20 min)

### Part 1 — Technical & Sovereign Overview (30 min)
- **Session 1** — Sovereign AI & Architecture Fundamentals
- **Session 2** — Ingestion, Graph-RAG & Multilingual
- **Session 3** — Security, IAM (Keycloak) & Governance
- **Session 4** — Live Architecture Walkthrough & Case Studies

### Part 2 — Agile Scoping & Use Case Alignment (1 h 30 min)
- **Practice 1** — Marketplace of Skills (Capability Mapping)
- **Practice 2** — Lean Impact Mapping (Corpus Discovery)
- **Practice 3** — Ease vs. Value Matrix & Dot Voting
- Action Items & Phase 1 Deliverables

</div>

---


<div class="eyebrow">The GENIE.AI mandate</div>

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

<div class="eyebrow">Mandate alignment</div>

# Aligned with ITU-D Resolutions

<style scoped>
section .columns img {
  max-height: 62cqh;
}
</style>

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

<div class="eyebrow">60-second shared definition</div>

# What is GENIE.AI

<div class="columns">

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

<!-- _class: title -->
<!-- _paginate: false -->

<div class="hero-band"></div>
<div class="brand-pill">GENIE.AI</div>

<div class="eyebrow">GENIE.AI — Sovereign RAG Framework</div>

# Part 1 of 2 · GENIE.AI Deep Dive


---

<!-- _class: title -->
<!-- _paginate: false -->

<div class="brand-pill">GENIE.AI</div>

<div class="eyebrow">Workshop — Part 1 · 30 min</div>

# Agenda

<div class="columns">
<div>

<div class="agenda-item"><span>1</span> Sovereign AI &amp; Architecture Fundamentals</div>
<div class="agenda-item"><span>2</span> Hybrid Ingestion, Vector-Graph RAG &amp; Multilingual</div>

</div>
<div>

<div class="agenda-item"><span>3</span> Security, IAM &amp; Governance</div>
<div class="agenda-item"><span>4</span> Live Architecture Walkthrough &amp; Case Studies</div>

</div>
</div>

<br><br><br><br>

Part 2 — Agile Scoping (1 h 30 min) follows.

---

<!-- _class: session-divider -->
<!-- _paginate: false -->

<div class="session-num">01</div>
<div class="eyebrow">Session 1</div>

# Sovereign AI & Architecture

<div class="tagline">Public-sector AI under government control — from silicon to UI.</div>

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
  subgraph RAILS ["🔐 Security & 📡 Observability"]
    KC["🔐 OpenId Connect<br/>Keycloak JWKS validation"]:::rail
    OTEL["📡 OpenTelemetry Collector<br/>W3C traceparent"]:::rail
  end

classDef rail fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;

```
</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> every layer — gateway, app, retrieval, inference — is open-source and runs on government infrastructure. No external API calls, no data leaves your stack.</div>

---

<div class="eyebrow">Session 1 · What "sovereign" actually means here</div>

# Sovereignty Guarantees

<div class="compare">
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
  <div class="genie">14+ from a single English index</div>

  <div class="label">Vendor lock-in</div>
  <div class="ba">Proprietary weights + APIs</div>
  <div class="genie">Open weights, open source (DPG)</div>
</div>

<style scoped>
section .compare {
  font-size: 1.15rem;
  gap: 0.7rem 1rem;
  margin-bottom: 1.2rem;
}
section .compare .head {
  font-size: 0.95rem;
  padding-bottom: 0.5rem;
}
section .columns {
  font-size: 1rem;
}
section .columns h3 {
  font-size: 1.15rem;
  margin: 0.4rem 0 0.15rem 0;
}
section .columns ul {
  margin: 0.15rem 0 0.45rem 0;
}
section .ops-benefit {
  font-size: 0.95rem;
  margin-top: 0.9rem;
}
</style>

<div class="columns">
<div>

### All artefacts in your jurisdiction
- Docker images · models · vector store · auth/autz · telemetry

### Open weights, open source
- Apache-2.0 / MIT — compliant with the **OSI Open Source AI Definition**.
- No proprietary model APIs. **Digital Public Good** (DPG) compliant.

</div>
<div>

### Hardware-agnostic
- Intel &amp; NVIDIA stacks validated. vLLM + TEI inference.

### No vendor lock-in
- Same compose file: laptop PoC → Docker Swarm production.
- _Kubernetes manifests planned (same images, different orchestrator)._

</div>
</div>

<div class="ops-benefit"><strong>Takeaway:</strong> sovereignty is measurable — cost, timeline, data residency, languages, lock-in — and every row improves at once.</div>

---


<div class="eyebrow">Session 1 · The five principles guiding every GENIE.AI build</div>

# The Five Brand Pillars

<br>

![The five GENIE.AI brand pillars](assets/genie-brand-pillars.png)

<br>

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
  <p>14+ UI languages · web + mobile clients.</p>
  <p><em>Laptop PoC → Docker Swarm. Kubernetes (roadmap).</em></p>
</div>
<div class="card">
  <div class="card-num">05</div>
  <div class="card-name">Real-World Deployment</div>
  <p>Operational since 2024 across UN missions.</p>
  <p><em>6 active country pilots · 100+ stakeholders.</em></p>
</div>
</div>


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
<br>

**1. Deploy** Spin up a GENIE.AI instance — cloud or on-premise, Docker Swarm production.

**2. Select data** Drag-and-drop documents, plus custom integrations to existing systems.

**3. Tune** Configure RAG macro-parameters, UI locale, and connectors.

**4. Launch & iterate** Deploy the pilot, gather feedback, re-tune. _With full control at every step_.

</div>
<div>

```mermaid
flowchart TD
  D["🚀<br/>Deploy"]:::core
  S["📄<br/>Select data"]:::core
  T["⚙<br/>Tune"]:::core
  P["🎯<br/>Pilot"]:::ok

  D --> S --> T --> P

classDef core fill:#ffffff,stroke:#34373d,stroke-width:1.5px,color:#34373d;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:2px,color:#166534;
```

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> the pilot is in your hands — no vendor in the loop, no external API calls, full control at every iteration.</div>


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

<div class="ops-benefit is-info">
  <strong>Tunable at every step</strong> — contextual retrieval on/off, late-label mode, batch concurrency, label prompts, taxonomy — all overridable per deployment.
</div>


<div class="columns" style="margin-top: 0.6rem; gap: 1.5rem;">
<div>

### What each stage does
- **ClamAV scan** — virus-check before any parsing.
- **Docling + OCR** — scans become structured text.
- **Context-aware chunking** — preserves document hierarchy.
- **Context prefix** — LLM one-liner per chunk.
- **Late labeling** — taxonomy + ACL after chunking.

</div>
<div>

### What comes out
- **Chunks** with document-level context prefix.
- **Vector embeddings** (TEI) for similarity search.
- **Graph links** (parent / child / references) in ArangoDB.
- **Per-chunk ACL** tags — ready for Keycloak-enforced retrieval.
- **Trace** of the ingestion pipeline, visible in OTel.

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> one standard pipeline — no ministry-specific glue scripts. Context prefix + late labeling happen after ClamAV clears the file.</div>

---

<div class="eyebrow">Session 2 · How retrieval works</div>

# Hybrid Vector–Graph Retrieval

<style scoped>
section svg[data-marp-mermaid] {
  margin: 0.3rem auto;
}
section .ops-benefit {
  margin-top: 0.25rem;
  padding: 0.4rem 0.9rem;
}
section .columns h3 {
  margin: 0.25rem 0 0.1rem 0;
}
section .columns ul {
  margin: 0.1rem 0 0.15rem 0;
}
</style>

```mermaid
flowchart LR
  Q["🔍 Query"] --> E["TEI embed"]:::core
  E --> V["Retriever<br/>vector search<br/>(ArangoDB)"]:::ai
  V --> G["Retriever<br/>Graph expand<br/>parents · refs · defs"]:::data
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

<div class="ops-benefit is-info">
  <strong>Tunable at every step</strong> — pure vector or hybrid BM25+RRF, graph traversal depth, reranking strategy (slice / threshold / knee / adaptive), reranker model — all overridable per deployment.
</div>

<div class="columns" style="margin-top: 0.6rem; gap: 1.5rem;">
<div>

### Why hybrid (not pure vector or pure graph)?
- **Pure vector** fails on **government legalese** — similar embeddings are **not the same as** same meaning.
- **Pure graph** captures entity links but misses semantic similarity.
- **Vector + graph** retrieves the article **and** its carve-outs together.

</div>
<div>

### What GENIE.AI does:
1. **Embed** the query (TEI).
2. **Vector search** over ArangoDB (similar chunks).
3. **Graph expansion** (by the retriever over ArangoDB graph) — pull parents, refs, definitions.
4. **TEI cross-encoder rerank** — re-score, then keep Top-N (slice/threshold) or adaptive utility-cost.
5. **Grounded LLM answer** — ChatQnA streams citation-backed response.

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> the article, its carve-outs, and its definitions — pulled together in one retrieval. Every answer cites its source chunks.</div>

---

<div class="eyebrow">Session 2 · One index, many languages</div>

# Multilingual Engine / Streaming API


```mermaid
sequenceDiagram
  participant U as 👤 User (any of 14+ langs)
  participant TQ as Translate → EN
  participant R as RAG (EN index)
  participant TA as Translate → UI lang

  U->>TQ: query 🇹🇿
  TQ->>R: Query (🇬🇧)
  R->>TA: Answer (🇬🇧)
  TA->>U: Answer (🇹🇿)
```

<div class="columns" style="margin-top: 0.6rem;">
<div>

### One canonical index
- Knowledge base stored in **English** (canonical SSoT).
- Chunking, embedding, labeling — all English-native.

</div>
<div>

### 14 UI languages
- Query translation + answer translation **streamed** on the fly.
- Swahili · French · Arabic · Spanish · Portuguese + 9 more.

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> one English index, consistent behaviour across languages. New language = add translator config, no re-index.</div>

---

<!-- _class: demo -->

<div style="text-align:center; font-size: 6rem; margin: 0.6rem 0; z-index: 1; line-height: 1;">💻</div>

<div class="eyebrow">Session 2 · Demo break</div>

# Live Demo — Multilingual Retrieval

<div class="columns" style="margin-top: 0.6rem;">
<div>

### What we'll show
- A question asked in **Spanish** against an English-only corpus.
- Retrieval happens on the **English** index (translated query).
- Answer is generated in **English** and re-translated back to **Spanish** (streamed).

</div>
<div>

### What to watch for
- **Latency** of the translation round-trip (~1–2s on top of RAG).
- **Citation faithfulness** — the same chunk is cited, regardless of language.
- **No re-indexing** when adding a new locale (config change only).

</div>
</div>

<div class="ops-benefit"><strong>Demo:</strong> 5 min · live · assistant answers in 14 UI languages from a single English knowledge base.</div>

---

<!-- _class: session-divider -->
<!-- _paginate: false -->

<div class="session-num">03</div>
<div class="eyebrow">Session 3</div>

# Trust, Identity &amp;<br>Observability

<div class="tagline">Hard grounding, real identities, traceable answers.</div>


---

<div class="eyebrow">Session 3 · Pillar 1 → "Local Ownership" — identity is the perimeter</div>

# Authentication & Authorisation

```mermaid
flowchart LR

  B["⚙️ Backend (Express)<br/>JWT verify via JWKS<br/>(jose library)"] -->|JWT| Q["🧠 ChatQnA<br/>(authenticated)"]
  K["🌐 Kong API Gateway<br/>(rate-limit, logs,<br/>metrics only)"] -->|JWT| B
  U["👤 User"] -->|JWT| K
  U -.->|OIDC flow| K
  K -.->|OIDC flow| IDP["🛡️ Identity Provider<br/>Keycloak"]
  Q --> A["🗄️ ArangoDB<br/>(trusted network)"]

classDef client fill:#ffffff,stroke:#94a3b8,stroke-width:1px,color:#475569;
classDef gateway fill:#ffffff,stroke:#1b3fad,stroke-width:2px,color:#1b3fad;
classDef core fill:#ffffff,stroke:#34373d,stroke-width:1px,color:#34373d;
classDef data fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
classDef ai fill:#f0fdf6,stroke:#2b855b,stroke-width:1.5px,color:#1f5e3f;
classDef orch fill:#ffffff,stroke:#7c3aed,stroke-width:1.5px,stroke-dasharray:4 3,color:#5b21b6;
classDef risk fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#991b1b;
classDef ok fill:#f0fdf6,stroke:#16a34a,stroke-width:2px,color:#166534;
```

<div class="columns">
<div>

### What Keycloak handles
- **Federation**: SAML, Entra ID, OIDC, generic OIDC providers.
- **Single Sign-On**: one login for all GENIE.AI surfaces (web, mobile, admin).
- **Role/group mapping**: Keycloak groups can be propagated as claims into GENIE.AI metadata.

</div>
<div>

### What this means for you
- **OIDC at the edge** — login flow handled by Keycloak, tokens issued via standard OIDC.
- **JWT verified in depth** — verified not only in the backend but also in the OPEA services.
- **IDP swap is config** — change provider, keep the same JWT contract on the backend.

</div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> standard protocols end-to-end — OIDC at Keycloak, JWT (RS256) verified in each backend via JWKS. No proprietary auth scheme.</div>

---

<div class="eyebrow">Session 3 · Observability across every hop</div>

# Observability: Trace Context Across Every Hop

<div class="columns">
<div>

```mermaid
sequenceDiagram
  participant U as 👤 User
  participant K as Kong
  participant BE as Backend
  participant CQ as ChatQnA
  participant DB as ArangoDB

  K->>K: HTTP + traceparent
  K->>BE: propagate
  BE->>CQ: chat (trace ctx)
  CQ->>DB: retrieve (ACL-scoped)
  DB-->>CQ: chunks
  CQ->>BE: answer + chunks
  BE->>U: streamed answer

  Note over U,DB: Every hop emits a span via W3C traceparent.
```

</div>
<div>

<div class="metric-row" style="margin-top: 0.4rem;">
  <div class="metric"><div class="number">OpenTelemetry</div><div class="label">W3C traceparent · every hop</div></div>
  <div class="metric"><div class="number">RFC</div><div class="label">W3C Trace Context standard</div></div>
</div>

### Leverage:
- **VictoriaMetrics**, **VictoriaLogs** and **VictoriaTraces** solution for storage
- **Grafana** for dashboards

</div>
</div>

<br>
<div class="ops-benefit"><strong>Key idea:</strong> every hop emits a span — same trace ID follows the question from browser to LLM. One request, one timeline.</div>
<div class="ops-benefit"><strong>Inspectable by design:</strong> the same trace ID lets legal officers see the exact document chunk that produced an answer — and SREs see the latency of every hop in the same view.</div>

---

<!-- _class: demo -->

<div style="text-align:center; font-size: 6rem; margin: 0.6rem 0; z-index: 1; line-height: 1;">💻</div>

<div class="eyebrow">Session 3 · Demo break</div>

# Live Demo — Trace + Abstention

<div class="columns" style="margin-top: 0.6rem;">
<div>

### What we'll show
- A real **chat question** in the deployed instance.
- Open **Grafana** → see the full trace.
- Click a span → see the **exact chunk** cited by the LLM (coupled with logs etc...).
- **Query Inspector** to keep trace of different queries

</div>
<div>

### What to watch for
- **Latency per hop** — vector search vs LLM generation.
- **Citation** — the answer shows which document chunk was used.
- **Grounding** — the model answers from cited chunks only.

</div>
</div>

<div class="ops-benefit"><strong>Demo:</strong> 5 min · live · bring your own question · we trace it from browser to LLM in real time.</div>

---

<!-- _class: session-divider -->
<!-- _paginate: false -->

<div class="session-num">04</div>
<div class="eyebrow">Session 4</div>

# Deployments &amp;<br>Country Use Cases

<div class="tagline">GENIE.AI in the field — six countries, real pilots.</div>


---

<div class="eyebrow">Session 4 · Deployment paths</div>

# One Stack, Four Deployment Paths

<style scoped>
section .columns h3 {
  margin: 0.25rem 0 0.1rem 0;
}
section .columns ul {
  margin: 0.1rem 0 0.25rem 0;
}
section .metric-row {
  margin-top: 0.5rem;
}
section .ops-benefit {
  margin-top: 0.5rem;
}
</style>

<div class="columns">
<div>

### Local PoC — `docker compose`
- Single `docker-compose.yaml`, opt-in profiles.
- `opea` · `gpu-models` · `observability`.
- One-command setup on a laptop.

</div>
<div>

### Production — Ansible + Swarm
- **`deploy/ansible/`** playbooks with per-environment secrets.
- Images pulled from GitLab Container Registry (pre-built CI).
- Jinja2 templating + `ansible-vault` for secrets.

</div>
</div>

<div class="columns" style="margin-top: 0.4rem; gap: 1rem;">
<div>

### Kubernetes (roadmap)
- Same images, different orchestrator.
- Helm charts planned.

</div>
<div>

### Remote GPU
- *See dedicated next slide.*

</div>
</div>

<div class="metric-row">
  <div class="metric"><div class="number">1</div><div class="label">Same image, all paths</div></div>
  <div class="metric"><div class="number">3</div><div class="label">Compose profiles</div></div>
  <div class="metric"><div class="number">∞</div><div class="label">Scales horizontally</div></div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> one image, four deployment paths. Start local with `docker compose up`, scale to Swarm via Ansible, migrate to K8s when you need it. No code changes.</div>

---

<div class="eyebrow">Session 4 · Remote GPU</div>

# Air-Gapped GPU Deployment

```mermaid
flowchart LR
  subgraph CPU ["🖥️ CPU Node — app services"]
    direction TB
    Q["🌐 Query<br/>(user message)"]:::q
    R["🔍 Retrieve<br/>(vector + graph)"]:::r
    L["🧠 LLM Call<br/>(via GPU)"]:::l
    D["📄 Document<br/>(ingest path)"]:::q
  end

  subgraph GPU ["⚡ GPU Node — AI services"]
    direction TB
    V["💬 vLLM<br/>(LLM + translation)"]:::gpu
    E["📐 TEI<br/>(embed)"]:::gpu
    RR["🔀 TEI<br/>(rerank)"]:::gpu
    DOC["📄 docling-serve<br/>(OCR / parse)"]:::gpu
  end

  subgraph LINK ["🛰️ Encrypted CPU↔GPU channel"]
    direction TB
    TLS["🔒 HTTPS + WSS<br/>Bearer VLLM_API_KEY"]
  end

  CPU ==> LINK ==> GPU

  classDef q fill:#eef3ff,stroke:#1b3fad,stroke-width:1.5px,color:#122f87;
  classDef gpu fill:#f0fdf6,stroke:#16a34a,stroke-width:1.5px,color:#166534;
  class Q,R,L,D q
  class V,E,RR,DOC gpu
```

<div class="metric-row">
  <div class="metric"><div class="number">TLS</div><div class="label">Encrypted CPU↔GPU</div></div>
  <div class="metric"><div class="number">Auth</div><div class="label">VLLM_API_KEY</div></div>
  <div class="metric"><div class="number">Air-gap</div><div class="label">Sovereign option</div></div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> CPU node runs app services (Query, Retrieve, LLM call). GPU node runs AI services (vLLM, TEI, docling). All AI calls go over HTTPS + API key, no internet required at runtime.</div>

---

<div class="eyebrow">Session 4 · Configuration</div>

# Tunable at Every Layer

<div class="columns">
<div>

### Secrets (required, no defaults)
- `ARANGO_PASSWORD` · `KEYCLOAK_*` · `EMAIL_*` (SMTP)
- `HUGGING_FACE_HUB_TOKEN` · `VLLM_API_KEY`
- Server **fails fast** if missing — no silent insecure fallback.

### Deployment-specific
- `VLLM_LLM_MODEL_ID` · `EMBEDDING_MODEL_ID` · `RERANKER_MODEL_ID`
- `RERANKING_STRATEGY` (slice / threshold / knee / adaptive)
- `VLLM_MAX_MODEL_LEN` per GPU file (`env.t4`, `env.rtx6000`)

</div>
<div>

### Runtime toggles
- `ENABLE_OBSERVABILITY=1` (off by default — zero overhead)
- `STREAMING_TRANSLATION_ENABLED` · `MULTI_TURN_BLEND_ENABLED`
- `CHATQNA_ENFORCE_ABSTENTION=true`
- `VICTORIAMETRICS_RETENTION` · `VICTORIATRACES_RETENTION` (data lifecycle)

### Prompt overrides
- `CHATQNA_SYSTEM_PROMPT` (env var beats built-in default)
- `LABEL_SELECTOR_SYSTEM_PROMPT` · `CONTEXTUAL_RETRIEVAL_PROMPT`

</div>
</div>

<div class="ops-benefit"><strong>Two-tier priority:</strong> every config has a built-in default in code; env vars override per deployment. <strong>~60 env vars</strong> documented in `env` — groups: secrets (~10), deployment-specific (~15), runtime toggles (~15), prompt overrides (~3), plus URLs, ports, GPU tuning. Switch models, re-tune, add the observability stack — without touching code.</div>


---

<div class="eyebrow">Session 4 · Frontend design system</div>

# Your Brand, Same Codebase

<div class="columns">
<div>

### CSS custom properties
- Every colour is a `--ds-*` token (light + dark modes).
- Override variables in your `.env` — same Docker image, different look.
- **Typography-driven**: Inter body, JetBrains Mono for code/labels.
- **Self-hosted fonts** — DPG compliant, no external CDN.

</div>
<div>

### Theming examples (from existing deployments)
- Brand colours, logo, and typography — per deployment.
- Dark mode via Bootstrap 5.3 `data-bs-theme` (no JS).
- Component restyle without forking the codebase.
- Mobile + web parity via `KeycloakConfig.supportedLocaleCodes`.

</div>
</div>

<div class="metric-row">
  <div class="metric"><div class="number">14</div><div class="label">UI languages</div></div>
  <div class="metric"><div class="number">DS</div><div class="label">CSS custom properties</div></div>
  <div class="metric"><div class="number">0</div><div class="label">External CDN</div></div>
  <div class="metric"><div class="number">1</div><div class="label">Same source code, all brands</div></div>
</div>

<div class="ops-benefit"><strong>Key idea:</strong> per-deployment branding without forking the codebase. 14 languages at strict key parity — locale whitelist controls web, mobile, and Keycloak from a single config file.</div>

---

<div class="eyebrow">Session 4 · Live in the field</div>

# GENIE.AI in the Field

<div style="text-align: center;">

![h:512 GENIE.AI country deployments](assets/genie-country-deployments.png)

</div>

---

<div class="eyebrow">Session 4 · Q&amp;A &amp; next steps</div>

# Open Floor

<div style="display: flex; flex-direction: column; align-items: center; text-align: center; margin-top: 1.5rem;">
  <div>
  <div class="metric-row" style="justify-content: center;">
    <div class="metric" style="background: oklch(95% 0.02 265 / 0.4); border: 1px solid var(--genie-blue); max-width: 500px; margin: 0 auto;">
      <div class="number" style="color: var(--genie-blue);">QUESTIONS ?</div>
      <div class="label">Bring your hardest data-sovereignty question</div>
    </div>
  </div>
</div>

<div style="margin-top: 3rem; padding: 1rem 1.5rem; background: oklch(98% 0.005 265 / 0.5); border-left: 4px solid var(--genie-blue); border-radius: 0 12px 12px 0; max-width: 600px; margin-left: auto; margin-right: auto;">
  <div style="font-size: 1.05rem;">
    <strong>Next:</strong> <span style="color: var(--genie-blue); font-weight: 600;">Part 2 — Agile Scoping</span><br>
    Marketplace of Skills · Impact Mapping · Dot-vote
  </div>
</div>
</div>

<div style="text-align: center; margin-top: 4rem;">
  <div style="font-size: 4rem; font-weight: 700; color: var(--genie-blue); letter-spacing: -0.03em; line-height: 1.1;">
    Thank You!
  </div>
</div>
