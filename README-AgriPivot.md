# AgriPivot AI Agent

## Lesotho Maize \& Beans Extension Chatbot — Phase 2 Prototype

> An evidence-based GenAI advisory assistant for Extension Workers in Lesotho. Built on the GENIE.AI framework with a strict zero-hallucination grounding contract: every answer is sourced from a curated FAO/MoAFS corpus, every claim is cited, and the system refuses rather than guesses.

**Submission:** GenAI for Good Challenge 2026 — Phase 2 Prototype
**Use Case:** Agriculture — AI-Powered Agricultural Extension Chatbot
**Country of focus:** Lesotho
**GitLab branch:** `Agriculture-AgriPivot-branch`
**License:** Apache 2.0

**Public URL:** https://164-52-196-146.sslip.io/

\---

## Table of Contents

1. [Overview](#1-overview)
2. [What Changed from the Phase 1 Proposal](#2-what-changed-from-the-phase-1-proposal)
3. [System Architecture](#3-system-architecture)
4. [Knowledge Hierarchy](#4-knowledge-hierarchy)
5. [Corpus](#5-corpus)
6. [Setup \& Deployment](#6-setup--deployment)
7. [Test Scenarios](#7-test-scenarios)
8. [Limitations \& v2 Roadmap](#8-limitations--v2-roadmap)
9. [Team \& Acknowledgments](#9-team--acknowledgments)
10. [License](#10-license)

\---

## 1\. Overview

AgriPivot AI Agent is a configuration of the GENIE.AI framework purpose-built for Extension Workers serving smallholder farmers in Lesotho. The prototype focuses on a single, defensible scope — Maize and Beans agronomy — and is engineered to refuse rather than fabricate.

Three design principles drive every architectural choice:

1. **Trust through verifiability.** Every response cites the source document. Extension Workers can drill into the cited passage before relaying advice to a farmer.
2. **Refusal as a feature.** When retrieval confidence is low or the question is out of scope, the system responds with: *"I do not have reliable information on that. Please consult your district extension officer."* It does not guess.
3. **Humans remain the verifier.** The system is designed to amplify Extension Workers, not replace them. All farmer-facing communication passes through a human reviewer.

The prototype runs on a single ITU-provisioned NVIDIA A40 cloud instance, performs all inference locally via vLLM (no third-party LLM calls), and is accessible through a Vue.js web interface for Extension Workers and a separate admin dashboard for ministry staff.

\---

## 2\. What Changed from the Phase 1 Proposal

The Phase 1 proposal (December 2025) described an enterprise diversification planner targeting value-added farm businesses. Following two office hours with Gerard Sylvester (Investment Officer for Digital Agriculture, FAO), the prototype was tightened in four ways:

|Dimension|Phase 1 (Dec 2025)|Phase 2 (May 2026)|
|-|-|-|
|**Scope**|Enterprise diversification planning|Maize and Beans agronomy only|
|**Primary user**|Farmers, Extension Workers, Admins|Extension Workers (human-in-the-loop)|
|**Connectivity assumption**|Offline-first SMS|4G/5G near Maseru|
|**Success metric**|Volume of roadmaps generated|Zero hallucination over response volume|

\---

## 3\. System Architecture

### 3.1 Reused from GENIE.AI as-is

|Layer|Component|Source path|
|-|-|-|
|Frontend|Vue.js 3 + Tailwind|`components/gov-chat-frontend`|
|Backend|Node.js / Express + TypeScript|`components/gov-chat-backend`|
|AI orchestration|OPEA microservices|`genie-ai-overlay/`|
|Retrieval|Hybrid vector + graph (Arango)|`genie-ai-overlay/retriever`|
|Reranking|Cross-encoder|`genie-ai-overlay/reranker`|
|Document ingestion|Docling-based dataprep|`genie-ai-overlay/dataprep`|
|LLM serving|vLLM (local, no API calls)|`configs/opea-config`|
|Translation|NLLB-200 multilingual|`configs/opea-config`|
|Database|ArangoDB (graph + vector)|`configs/opea-config`|
|API gateway|Kong + NGINX|`api-gateway-solution`|
|Auth|JWT, bcrypt-hashed passwords|`gov-chat-backend`|

### 3.2 Configured for AgriPivot

These are the configuration changes that turn vanilla GENIE.AI into AgriPivot. All are reproducible from this branch.

**`CHATQNA\\\_SYSTEM\\\_PROMPT`** — replaced the default prompt with a scope guard, grounding contract, and refusal/redirect language:

> You are AgriPivot, an evidence-based agricultural extension assistant supporting Extension Workers in Lesotho. Your scope is strictly limited to Maize and Beans agronomy. Answer using only the content provided from the knowledge base. Do not invent or assume information. If the answer is not in the provided content, reply: \\\*"I do not have reliable information on that. Please consult your district extension officer."\\\* If the question is outside Maize or Beans agronomy, politely redirect: \\\*"AgriPivot covers Maize and Beans agronomy only. For other topics, please consult your local extension service."\\\* Always cite the source document. Keep responses concise and suitable for an Extension Worker to communicate to a farmer.

**Knowledge Hierarchy** — 3 categories, 10 services, designed before ingestion (see Section 4).

**Retriever and reranker thresholds** — tuned in `.env` for refusal-first behavior:

* `RETRIEVER\\\_ARANGO\\\_K=5`
* `RETRIEVER\\\_ARANGO\\\_FETCH\\\_K=15`
* `RETRIEVER\\\_ARANGO\\\_TRAVERSAL\\\_SCORE\\\_THRESHOLD=0.75`
* `RERANKER\\\_TOP\\\_N=3`

**Sesotho UI translations** — generated via `node create-translations.js ST --translation-engine=internal`. At runtime, a Sesotho query is translated to English for retrieval, the answer is generated in English, and the response is translated back to Sesotho — all via the local NLLB-200 service.

**Branding** — `APP\\\_NAME=AgriPivot`; theme JSON for visual identity.

### 3.3 Extended (planned for v2)

|Feature|Status in prototype|v2 Plan|
|-|-|-|
|Native Sesotho corpus ingestion|English-only ingestion (GENIE.AI single-language constraint)|Multi-language ingestion or parallel knowledge bases|
|District-aware retrieval|National-level corpus only|Per-district metadata and filtering|
|Voice input/output|Not implemented|TTS/STT integration|
|WhatsApp Business API|Manual copy/paste from web UI|Direct integration|
|Image-based pest diagnosis|Not implemented|Computer vision module|
|Offline-first PWA caching|Not implemented|Service worker + cache|

\---

## 4\. Knowledge Hierarchy

The Knowledge Hierarchy defines the conceptual surface of the chatbot and is the foundation of the hybrid graph + vector retrieval. It was designed before any documents were ingested. Service labels are unique across categories per the `GENIE.AI-Data-Labelling-Strategy.md` guideline.

**Category: Maize Production**

* Maize Variety \& Planting
* Maize Soil \& Fertility
* Maize Pest \& Disease
* Maize Harvest \& Storage

**Category: Beans Production**

* Bean Variety \& Inoculation
* Bean Soil \& Fertility
* Bean Pest \& Disease
* Bean Harvest \& Storage

**Category: Lesotho Extension Context**

* Lesotho District \& Climate
* Lesotho Markets \& Channels

Rationale: 10 services balance retrieval specificity against label sparsity. Both crops mirror a "variety/soil/pest/harvest" lifecycle for parallel structure. The Lesotho category isolates context-specific guidance that applies across both crops (district climate, market channels, food security framing).

\---

## 5\. Corpus

15 documents, \~30 MB total, curated from the FAO Confluence shared by Gerard Sylvester. All sources are public-domain MoAFS, FAO, or peer-reviewed academic publications.

### 5.1 Lesotho-specific (5 documents)

|#|Document|Provenance|Service label|
|-|-|-|-|
|1|Conservation Agriculture Adoption Among Maize and Beans Farmers, Maseru|Academic study|Lesotho District \& Climate|
|2|Trend in Bean (Phaseolus Vulgaris L.) Production Grown in Lesotho|Academic study|Lesotho District \& Climate|
|3|Factors Influencing Choice of Maize and Beans Marketing Channels for Smallholder Farmers in Lesotho|Academic study|Lesotho Markets \& Channels|
|4|Farm Management Practices and Farmers' Perceptions of Stalk-Borers of Maize and Sorghum in Lesotho|Academic study|Lesotho District \& Climate|
|5|Screening of Maize Cultivars Grown in Lesotho for Drought Tolerance|Academic study|Lesotho District \& Climate|

### 5.2 Maize agronomy core (5 documents)

|#|Document|Provenance|Service label|
|-|-|-|-|
|6|Farm Africa Maize Production Training Manual|NGO extension manual|Maize Variety \& Planting|
|7|Manual for Maize Farming (final)|Farmer-friendly manual|Maize Variety \& Planting|
|8|GAPS for Maize|Good Agricultural Practices reference|Maize Variety \& Planting|
|9|4R Maize Guide — N Ghana|Fertilizer principles for smallholder Africa|Maize Soil \& Fertility|
|10|Integrated Management of FAW on Maize — Guide to FFS|Farmer Field School manual|Maize Pest \& Disease|

### 5.3 Beans agronomy core (5 documents)

|#|Document|Provenance|Service label|
|-|-|-|-|
|11|Common Bean Production|Core bean agronomy manual|Bean Variety \& Inoculation|
|12|Training Handbook on Production of Beans|Practical bean handbook|Bean Variety \& Inoculation|
|13|Beans Training Manual for Extension Workers in Uganda|Extension-style content|Bean Variety \& Inoculation|
|14|Bean Production Guideline 2019|Recent production guide|Bean Variety \& Inoculation|
|15|Hand Book of Bean Diseases|Disease reference|Bean Pest \& Disease|

### 5.4 Sesotho-language documents — held for v2

* **LESELI LA TEMO POONE.pdf** (Maize, Sesotho — MoAFS)
* **LESELI LA TEMO LINAOA.pdf** (Beans, Sesotho — MoAFS)

These are MoAFS-authored Sesotho extension guides. They are not ingested in the prototype because GENIE.AI currently supports a single ingestion language at a time (default English) and language detection rejects mixed-language uploads. Native Sesotho ingestion is the highest-priority v2 item.

### 5.5 Excluded by design

* **Pesticide and herbicide product labels** (Roundup, Sakura, Ronstar, etc.). Excluded because dose-specific recommendations carry real-world safety risk if relayed without context (sprayer calibration, crop stage, applicator PPE, residual). The bot stays at IPM principles, not product specifics.
* **Out-of-scope crops** (sorghum, soybean, sweetcorn, cowpea, faba bean). Scope discipline.

\---

## 6\. Setup \& Deployment

### 6.1 Prerequisites

* Ubuntu 22.04 with NVIDIA A40 (or equivalent ≥40 GB VRAM)
* `nvidia-driver-535-server`, CUDA 12.2
* Node.js LTS via `nvm`
* Docker + `docker compose` plugin + `nvidia-container-toolkit`
* Hugging Face access token (Read scope)

Reference guides in the repo root: `E2E-nVidia-A40-Install-Guide.md` and `GENIE.AI-Installation-Configuration-Guide.md`.

### 6.2 Reproducing the AgriPivot configuration

```bash
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai
git checkout Agriculture-AgriPivot-branch

# Configure .env (see GENIE.AI install guide §4)
cp env .env
# Edit .env: set HUGGINGFACEHUB\\\_API\\\_TOKEN, APP\\\_NAME=AgriPivot, DOCLING\\\_DEVICE=cuda
# Replace CHATQNA\\\_SYSTEM\\\_PROMPT with the AgriPivot scope guard (see Section 3.2)

# Bring up the stack
docker compose up --build -d

# Wait for the 5 models to load on GPU (vLLM, embeddings, reranker, NLLB-200, helper)
watch nvidia-smi

# Initialize ArangoDB, Kong, and admin accounts (see install guide §4–5)
# Then ingest the 15-document corpus via the Admin Dashboard (see install guide §7)
# Apply the Knowledge Hierarchy and labels per Section 4 of this README

# Generate Sesotho UI translations
cd components/gov-chat-backend/scripts/new-schema-scripts
node create-translations.js ST --translation-engine=internal
```

Total reproduction time on a clean A40: approximately 6–8 hours (most of it Docker image pulls and corpus ingestion).

### 6.3 Access

**Public URL (for evaluators):**
- URL: https://164-52-196-146.sslip.io/
- Note: self-signed certificate — click "Advanced" → "Proceed" in your browser
- Demo credentials: `genie-ai-manager` / *(see Slack channel post)*

**Local development (alternative via SSH tunnel):**
```bash
ssh -L 8090:localhost:8090 -L 8010:localhost:8010 -L 8529:localhost:8529 -L 8001:localhost:8001 root@164.52.196.146
# Then in browser: http://localhost:8090
```

The Sesotho UI toggle is fully functional via the SSH tunnel route. Via the public URL it requires an additional frontend rebuild step (documented in `tests/scenarios/scenarios.md` v2 priorities).
\---

## 7\. Test Scenarios

See [`scenarios.md`](tests/scenarios/scenarios.md) for the full test set with verbatim system responses.

Scenario categories tested:

* **Typical in-scope queries** — answer with citation
* **Multi-turn conversations** — context maintained across turns
* **Edge cases** — partial information, ambiguous phrasing
* **Adversarial** — prompt injection, jailbreak attempts
* **Hallucination traps** — questions outside corpus knowledge
* **Refusal patterns** — out-of-scope and safety-sensitive
* **Sesotho-language** — runtime translation quality

\---

## 8. Limitations & v2 Roadmap

### v1 prototype — what is validated

The v1 prototype is a working GraphRAG system, not a mock:

- All architectural components running and healthy on the ITU A40 instance: Kong API gateway, ArangoDB (graph + vector), vLLM serving IBM Granite-3.3-2B and Google Gemma-3-4B, BAAI/bge-base-en-v1.5 embeddings, cross-encoder reranker, NLLB-200 translation
- Knowledge Hierarchy implemented (3 categories, 10 services) reflecting the Maize+Beans+Lesotho pivot
- 15 documents ingested into the GraphRAG knowledge graph: 2,590 source chunks, 10,133 entities, 41,913 relationship edges
- Sesotho UI translation generated and validated
- Auth, sessions, dashboard navigation, document upload + labeling, ingestion pipeline, public URL access — all functional
- 20-scenario test battery executed; results in `tests/scenarios/scenarios.md`

### v1 test results summary

13/20 pure passes (65%) with the following category-by-category outcomes:

| Category | Pass rate | Status |
|---|---|---|
| 1. Typical in-scope | 100% (5/5) | ✅ exceeds 80% threshold |
| 2. Multi-turn | 0% (0/2, 2 partial) | below 80% threshold |
| 3. Edge cases | 67% (2/3, 1 partial) | below 80% threshold |
| 4. Adversarial | 67% (2/3, 1 fail) | below 100% threshold |
| 5. Hallucination traps | 100% (2/2) | ✅ meets 100% threshold |
| 6. Refusal patterns | 67% (2/3, 1 partial) | below 100% threshold |
| 7. Sesotho language | 0% (0/2, 2 fail) | below 80% threshold |

### Two thresholds met that matter most

**Categories 1 and 5 both pass at 100%** — these are the core trust-and-safety claims of the v1 design. Hallucination Traps at 100% demonstrates the GraphRAG architecture correctly refuses fabrication on fictional districts (TS-14) and properly cites sources when quantitative precision is requested (TS-15). Typical In-Scope at 100% demonstrates that extension-worker-style queries on Maize and Beans agronomy return grounded, cited answers from the ingested FAO/MoAFS corpus.

### Documented v2 priorities (concrete and bounded)

1. **Adversarial role-override hardening** — TS-12 surfaced that Granite-3.3-2B's instruction-following on role-override resistance is insufficient. v2 fix: tighter prompt + output filtering for pesticide-product mentions.
2. **Sesotho query-time translation wiring** — TS-19, TS-20 surfaced that the NLLB-200 round trip isn't fully wired into the chatqna pre-processor for inputs. Translation infrastructure is functional in isolation (Sesotho UI works); integration into query flow is the fix.
3. **Refusal triggering on weak retrieval** — TS-08, TS-17 surfaced occasional fallback to general (Northern Hemisphere or non-Lesotho) knowledge when corpus retrieval is weak. v2 fix: stricter prompt + larger LLM (8B+).
4. **Multi-turn context preservation** — TS-06 may introduce fabricated variety codes in turn 2. v2 fix: corpus-anchor turn-2 responses.
5. **Authentication two-stage check** — v1 currently bypasses the stored-token comparison (see `auth-middleware.js` line 167) for prototype demo convenience. v2 fix: repair the login flow to refresh user `accessToken` on each login.
6. **Citation rendering** — v1 cites entity relationships (`[PLANTING OCCURS_IN MAIZE]`); v2 will surface document filenames.
7. **Native Sesotho corpus ingestion** — held for v2 (2 MoAFS guides identified).
8. **Document language detector edge cases** — 1 Lesotho stalk-borer PDF was rejected by the language detector and was excluded from v1 ingestion.

### v2 pilot priority list ($9,998.12 budget)

1. Native Sesotho corpus ingestion and parallel knowledge base
2. District-aware retrieval and metadata filtering
3. Voice input/output via TTS-STT integration
4. WhatsApp Business API farmer-facing channel
5. Image-based pest and disease diagnosis
6. Offline-first PWA caching for mountain districts
7. Integration with MoAFS administrative systems
8. Expanded crop coverage: sorghum, sugar beans, vegetables

\---

## 9\. Team \& Acknowledgments

**Xue "Alice" Dong** — Principal Investigator (PI), AI/ML Engineer
Extension Regional Specialist, Colorado State University Extension
Alice.Dong@colostate.edu

**Paul Hill, Ph.D.** — Co-Principal Investigator (Co-PI), Rural Economic Development
Associate Vice President \& Extension Professor, Utah State University
Director, Center for Rural Economic Development and Emerging Technologies
paul.hill@usu.edu

### Acknowledgments

* **Gerard Sylvester** (FAO, Investment Officer for Digital Agriculture) for the office hours that shaped the Maize+Beans pivot, the Extension-Worker-centric design, and the zero-hallucination commitment.
* **ITU and UNICC** for hosting the cloud instance, GitLab, and the GENIE.AI framework.
* **Roman Chestnov** (UNICC) for cloud and GitLab provisioning.
* **MoAFS Lesotho** for the curated corpus shared via the FAO Confluence.

\---

## 10\. License

This branch is released under the Apache License 2.0, consistent with the GENIE.AI framework's licensing.

