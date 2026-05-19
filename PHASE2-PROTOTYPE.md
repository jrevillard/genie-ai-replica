# Phase 2 prototype — GENIE.AI for The Gambia

A working, multi-channel chatbot for **non-communicable disease (NCD)
self-management in The Gambia**, built as a reference deployment of the
ITU-led [GENIE.AI](https://genie-ai.itu.int/) open-source framework.

> **Companion technical reading:**
> [`README.md`](README.md) (framework overview),
> [`docs/architecture.md`](docs/architecture.md) (system architecture),
> [`tests/llm-judge/README.md`](tests/llm-judge/README.md)
> (evaluation harness).

## 1. What this prototype delivers

The prototype is a sovereign, DPG-aligned RAG chatbot that a Gambian
patient or community member can reach through three independent
channels — a web client, a native iOS app, and WhatsApp — over a single
shared backend and knowledge base. Every channel speaks to the same
authenticated RAG pipeline, draws answers from the same indexed corpus
of WHO, BHBM, and Ministry-of-Health Gambia documents, and grounds
every substantive claim in an inline `[Source: …]` citation.

The iOS client additionally runs the same conversation flow **fully
offline**, with on-device retrieval and generation, so the assistant is
reachable in low-connectivity contexts without depending on the
backend.

All components are open source under Apache 2.0 / MIT in alignment with
the [OSI Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition)
and the [Digital Public Goods Standard](https://www.digitalpublicgoods.net/standard)
that GENIE.AI follows upstream.

## 2. Relationship to the GENIE.AI framework

The upstream framework provides the foundation this prototype runs on:

- A hybrid vector + graph RAG pipeline implemented on top of
  [OPEA](https://opea.dev), [Docling](https://github.com/docling-project/docling),
  [vLLM](https://github.com/vllm-project/vllm), and ArangoDB.
- A modular service layout (`components/`, `genie-ai-overlay/`),
  containerised deployment, and Ansible-driven Docker Swarm install.
- A multi-language frontend stack (Vue 3 web, native mobile shells).
- A documented LLM choice + data-labelling strategy
  ([`GENIE-AI-ChoosingLLMs.md`](GENIE-AI-ChoosingLLMs.md),
  [`GENIE.AI-Data-Labelling-Strategy.md`](GENIE.AI-Data-Labelling-Strategy.md))
  and code-management process
  ([`UNICC-ITU-Genie-AI Code Management Process.md`](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)).

This prototype contributes, on top of that base:

- A **Gambia-NCD-specific corpus** of six source documents and eight
  LLM-generated derived patient documents (§3.1, §3.2).
- **Audience-aware system prompts** that translate clinician-targeted
  source material into plain, second-person language suitable for lay
  patients (§3.3).
- **An on-device iOS chat path** using Gemma 2 2B + Apple NLEmbedding
  for offline operation (§3.6).
- **A WhatsApp Cloud API bot** that brings the same RAG pipeline to a
  channel reachable from any low-end phone (§3.5).
- **A multi-LLM quality evaluation harness** that measures both the
  cloud and on-device pipelines against the same test cases (§4).

## 3. What the prototype contains

### 3.1 RAG corpus

[`corpus/sources/`](corpus/sources/) holds the third-party clinical
and policy documents the chatbot draws from. Six are ingested end-to-
end through the production dataprep pipeline (Docling parsing → TEI
embeddings → ArangoDB graph + vector indices):

| File | Origin | `ncd:` label | Chunks |
|---|---|---|---|
| `who-treatment-guidelines-tobacco-use.pdf` | WHO clinical treatment guide | `tobacco-cessation` | 678 |
| `who-treatment-guidelines-hypertension.pdf` | WHO clinical treatment guide | `hypertension` | 477 |
| `BHBM-mHypertension.pdf` | WHO *A handbook on how to implement mHypertension* | `hypertension` | 433 |
| `BHBM-mTabaccoCessation.pdf` | WHO *A handbook on how to implement mTobaccoCessation* | `tobacco-cessation` | 483 |
| `The Gambia cessation clinical guidelines 2016.pdf` | Ministry of Health, The Gambia | `tobacco-cessation` | 141 |
| `National-Integrated-Policy-for-Non-Communicable-Diseases-Prevention-Control-2012-2016.pdf` | Government of The Gambia (MoH) | `multi` | 134 |

**Total: 2,346 source chunks.**

Every ingested file carries a structured `labels` list driving
retrieval and reranking:

| Label key | Values used |
|---|---|
| `audience:` | `clinician`, `policy-maker`, `patient` |
| `derived:` | `true`, `false` |
| `ncd:` | `hypertension`, `tobacco-cessation`, `multi` |
| `source:` | `clinical-guidelines`, `mhealth-handbook`, `policy` |
| `doctype:` *(derived docs only)* | `faq`, `chat`, `if-then-rules`, `risk-questionnaire` |
| `region:` | `gambia` (where applicable) |
| `human_reviewed:` | `true` / `false` |

### 3.2 LLM-generated derived patient documents

[`corpus/derived/`](corpus/derived/) holds eight patient-facing
documents derived from the source material. They exist to address the
audience mismatch between clinician-targeted source chunks and lay
patient questions: instead of relaying GRADE-style evidence summaries,
the chatbot can retrieve patient-tone phrasing of the same content.

Two NCDs × four document types:

| NCD | FAQ | Fictive chat | If-then rules | Risk questionnaire |
|---|---|---|---|---|
| Hypertension | 26 chunks | 17 chunks | 40 chunks | 17 chunks |
| Tobacco cessation | 25 chunks | 23 chunks | 47 chunks | 26 chunks |

**Total: 221 chunks.** All eight are ingested into the production
index with `audience:patient`, `derived:true`, and
`human_reviewed:false` labels. Authoring format is Markdown; the
ingested artefacts are pandoc-rendered PDFs in
[`corpus/derived/*/pdf/`](corpus/derived/). A clinician review pass
on the if-then rules and risk-questionnaire scoring is required before
any of this material is presented to real patients — the
`human_reviewed:false` label signals that gate.

### 3.3 Chatbot — retrieval and grounded generation

End-to-end RAG flow:

```
user query → backend (BFF) → ChatQnA → embedding (TEI) → retriever
            → reranker → vLLM (Granite 3.3 8B) → grounded answer
```

Key behaviours:

- **Citation discipline.** The system prompt requires inline
  `[Source: <filename>]` citations on every substantive claim. The
  rubric in `tests/llm-judge/` penalises any case that cites a file
  not present in the retrieved chunks.
- **Audience-aware guardrails.** The system prompt explicitly frames
  the user as a lay patient or community member — not a clinician or
  policy-maker — and instructs the model to translate WHO / BHBM /
  GRADE jargon into plain second-person language. Source:
  [`genie-ai-overlay/chatqna/genieai_chatqna.py`](genie-ai-overlay/chatqna/genieai_chatqna.py).
- **Abstention behaviour.** A configurable system instruction tells
  the chatbot to refuse out-of-scope queries rather than answer from
  outside the corpus. Toggle: `CHATQNA_ENFORCE_ABSTENTION` env var.
- **Conversation persistence.** Conversations are persisted in
  ArangoDB (`conversations`, `messages` collections) and surfaced
  through the per-user backend.

### 3.4 Backend and API gateway

| Path | Role |
|---|---|
| [`components/gov-chat-backend/`](components/gov-chat-backend/) | Node.js / Express BFF: auth, chat, conversations, analytics, admin, user profile, files |
| [`components/document-repository/`](components/document-repository/) | File upload + ClamAV scanning + metadata; hosts `POST /api/files/upload`, `PATCH /api/files/:id`, `POST /api/files/:id/ingest`, `DELETE /api/files/:id` |
| [`api-gateway-solution/`](api-gateway-solution/) | Kong + NGINX gateway: TLS termination, rate limiting, header rewriting |
| [`genie-ai-overlay/`](genie-ai-overlay/) | OPEA microservices (ChatQnA, retriever, dataprep, reranker) |

Authentication is OIDC via a dedicated Keycloak realm (`genie`) and
OIDC client (`genie-app`). Service-to-service traffic that does not
traverse a user uses client-credentials grants. Persistence is
ArangoDB 3.12 (multi-model: document + graph + vector) with Redis
caching and host-side file storage.

### 3.5 Web client

[`components/gov-chat-frontend/`](components/gov-chat-frontend/) —
Vue 3 + Vuex + vue-i18n web UI:

- OIDC login against the shared Keycloak realm.
- Chat surface with message threads, citation rendering, retrieval
  source previews, and conversation history.
- Admin views for analytics, content management, and user
  administration.
- Internationalised UI with translations served from the same
  i18n collections that the rest of the platform uses.

### 3.6 WhatsApp bot

[`components/whatsapp-bot/`](components/whatsapp-bot/) — Node.js /
TypeScript Meta Cloud API bot:

| Path | Role |
|---|---|
| `src/index.ts` | Express entry point |
| `src/routes/webhook.ts` | Meta Cloud API webhook (inbound messages + delivery callbacks) |
| `src/routes/internal.ts` | Internal API for server-initiated push and campaigns |
| `src/middleware/signature.ts` | Meta payload signature verification |
| `src/middleware/internal-auth.ts` | Internal-auth gate on the push API |
| `src/services/conversation.service.ts` | Inbound message → RAG → outbound flow |
| `src/services/campaign.service.ts` | Templated outbound campaign sender |
| `src/workers/` | Background workers |
| `src/db/` | Drizzle ORM schema + migrations against PostgreSQL |
| `Dockerfile`, `docker-compose.yml` | Containerised deployment |
| `tests/unit/`, `tests/integration/` | Vitest test suites |

The bot integrates with the same Keycloak realm and shares the same
RAG backend as the web and iOS clients, so a WhatsApp conversation
draws on the same corpus and produces the same grounded, cited
answers.

### 3.7 iOS mobile client (SwiftUI)

[`mobile/genie_ai_mobile_swiftui/`](mobile/genie_ai_mobile_swiftui/) —
native SwiftUI app:

- OIDC PKCE login via Keycloak, with app-specific language selection
  surfaced through iOS Settings.
- Full chat surface with message bubbles, conversation history,
  citations rendered as inline links to the source chunk, and
  category-aware retrieval filtering.
- **Offline RAG path:** an on-device pipeline using Apple
  NLEmbedding for retrieval and Gemma 2 2B (Q4_K_M) via llama.cpp
  for generation, packaged as the
  [`LocalRAG`](mobile/local_rag_swift/) Swift package and bridged
  into the SwiftUI app by `LocalRAGBridge.swift`. When the device is
  offline, `ChatView.sendQuery()` routes to the local pipeline
  instead of the backend; answer-formatting, citation-rendering, and
  conversation-persistence reuse the same SwiftUI code paths.
- Offline knowledge-area download for the on-device pipeline.
- Localisation across 11 languages via Apple's String Catalog
  (`Localizable.xcstrings`).
- A custom "Liquid Glass" design system: design tokens in
  `ThemeManager.swift`, glass modifiers in `View+GlassStyle.swift`.

### 3.8 Android mobile client (Jetpack Compose)

[`mobile/genie_ai_mobile_compose/`](mobile/genie_ai_mobile_compose/) —
an early native Android implementation. The auth, theme, and user-
profile foundations are in place (`AuthViewModel`, `ThemeViewModel`,
`UserProfileViewModel`); chat surface and offline RAG bridging are
the next-iteration targets. A Flutter reference implementation from
an earlier iteration is preserved at
[`mobile/genie_ai_mobile/`](mobile/genie_ai_mobile/).

## 4. Evaluation — multi-LLM quality harness

Test harness at [`tests/llm-judge/`](tests/llm-judge/) grades both
the web and on-device pipelines against the same YAML test cases
using an OpenAI judge model with structured outputs (Pydantic). The
judge is deliberately a different model family than the RAG
generators (Granite 3.3 8B on the server, Gemma 2 2B on the device),
so it does not score by training-data overlap. See
[`tests/llm-judge/README.md`](tests/llm-judge/README.md) and
[`tests/llm-judge/FINDINGS.md`](tests/llm-judge/FINDINGS.md).

Scoring axes (each 1–5 per case):

- `factuality` (hard) — no fabricated specifics
- `groundedness` (advisory) — verbatim corpus echo
- `answer_relevance` — on-question, not just on-topic
- `citation_correctness` — `[Source: filename]` format with real titles
- `abstention_correctness` — substantive vs. refuse stance matches
- `safety` — no fabricated URLs / numbers / personas
- `patient_friendliness` (advisory) — plain language, no jargon

A case passes when every binding axis ≥ 4 and no forbidden substring
appears.

### Latest run — 2026-05-19, web pipeline

29 test cases covering abstention, jailbreak resistance, general NCD
questions, realistic patient prompts, and domain-knowledge questions
on tobacco cessation. Judge model `gpt-4o-mini`.

**Informativeness slice (21 cases — patient questions + on-topic NCD
+ domain knowledge):**

| Axis | Mean | = 5 / 21 |
|---|---|---|
| `patient_friendliness` | **4.95 / 5** | 20 |
| `answer_relevance` | **5.00 / 5** | 21 |
| `factuality` (hard) | **4.71 / 5** | 19 |
| `groundedness` (advisory) | 3.48 / 5 | 5 |
| `citation_correctness` | 4.24 / 5 | 17 |

**19 / 21 informational cases (90%)** clear
`factuality ≥ 4 ∧ patient_friendliness ≥ 4 ∧ answer_relevance ≥ 4`
simultaneously.

The `groundedness` value at 3.48/5 is by design — the audience-aware
prompt instructs the model to paraphrase the corpus into plain
language rather than quote verbatim, which lowers the verbatim-
overlap signal. The rubric was deliberately split into a hard
`factuality` axis and an advisory `groundedness` axis so that a
correct lay-language paraphrase is not penalised. Factuality at
4.71/5 is the binding constraint.

## 5. Demo path

A reviewer can experience the prototype end-to-end:

1. **Web** — open the deployed frontend at the team-provided URL,
   sign in with the demo account, ask a question such as
   *"I cough a lot in the morning. Is that because I smoke?"* — the
   chatbot returns a patient-friendly answer with an inline
   `[Source: …]` citation pointing into the WHO / BHBM corpus.
2. **iOS** — install the SwiftUI app, sign in (online), download the
   offline knowledge area, switch the device into airplane mode, and
   ask the same question — the answer is generated on-device by
   Gemma 2 2B against the same indexed corpus.
3. **WhatsApp** — message the team-provided number from the
   verified-recipient list and ask the same question — the answer is
   returned over the Meta Cloud API with the same citations.
4. **LLM-judge run** — from `tests/llm-judge/`, run
   `OPENAI_API_KEY=… python3 run.py --target web …` to regenerate
   the 21-case CSV and per-case transcripts.

The prototype is currently deployed as a single-node Docker Swarm
on a public VPS; the multi-node cloud deployment is portable from
the existing compose files.

## 6. Repository structure

| Directory | Role |
|---|---|
| [`genie-ai-overlay/`](genie-ai-overlay/) | OPEA microservices (ChatQnA, retriever, dataprep, reranker) — RAG core |
| [`components/gov-chat-backend/`](components/gov-chat-backend/) | Node.js / Express backend (auth, chat, files, admin) |
| [`components/gov-chat-frontend/`](components/gov-chat-frontend/) | Vue 3 web UI |
| [`components/document-repository/`](components/document-repository/) | File ingestion + metadata + virus scan |
| [`components/whatsapp-bot/`](components/whatsapp-bot/) | WhatsApp Cloud API bot (Node.js / TypeScript) |
| [`mobile/genie_ai_mobile_swiftui/`](mobile/genie_ai_mobile_swiftui/) | SwiftUI iOS app (online + offline) |
| [`mobile/local_rag_swift/`](mobile/local_rag_swift/) | Reusable Swift package for on-device RAG |
| [`mobile/genie_ai_mobile_compose/`](mobile/genie_ai_mobile_compose/) | Jetpack Compose Android app |
| [`api-gateway-solution/`](api-gateway-solution/) | Kong + NGINX gateway configuration |
| [`deploy/ansible/`](deploy/ansible/) | Ansible-driven Docker Swarm deployment |
| [`configs/`](configs/) | LLM prompts, model configurations |
| [`corpus/sources/`](corpus/sources/) | Source PDFs ingested into the RAG pipeline |
| [`corpus/derived/`](corpus/derived/) | LLM-generated derived patient docs (Markdown + rendered PDFs) |
| [`tests/llm-judge/`](tests/llm-judge/) | Multi-LLM evaluation harness + cumulative findings |
| [`tests/rag-benchmarks/`](tests/rag-benchmarks/) | Lexical (BLEU / ROUGE / keyword) benchmarks |
| [`docs/`](docs/) | Architecture and deployment documentation |

## 7. References

- ITU GENIE.AI — https://genie-ai.itu.int/
- ITU Open Source Ecosystem Enabler (OSEE) — https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/OSEEPSI/home.aspx
- OSI Open Source AI Definition — https://opensource.org/ai/open-source-ai-definition
- Digital Public Goods Standard — https://www.digitalpublicgoods.net/standard
- GovStack principles — https://govstack.global/about/govstack-principles/
- OPEA — https://opea.dev
- Docling — https://github.com/docling-project/docling
- vLLM — https://github.com/vllm-project/vllm
