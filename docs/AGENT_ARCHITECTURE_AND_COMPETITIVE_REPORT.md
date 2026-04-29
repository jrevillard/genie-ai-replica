# AMINA Agent — Architecture & Competitive Landscape Report

**Date:** 2026-04-27
**Audience:** AMINA leadership / engineering for gap analysis
**Knowledge cutoff:** January 2026 (industry comparisons reflect public information available at that time; mark with [VERIFY] anything that may have shifted since)

---

## 0. TL;DR

AMINA is an **opinionated, deeply-localised vertical health agent for The Gambia** built on a self-hosted multi-LLM cascade. It is closer to a *care-protocol-driven dialogue system with strong cultural + linguistic grounding* than to a *general-purpose autonomous agent*. Compared to the industry frontier:

| Where AMINA leads | Where AMINA lags |
|---|---|
| Mandinka NLP depth (6-layer pipeline) — virtually no peer | No streaming responses (single-shot full reply) |
| Cultural ritual grounding (greeting state machine, religious sensitivity) | No native function-calling — tools dispatched deterministically |
| Local-first sovereignty (LoRA fine-tune, Tailscale, no foreign-cloud dependency required) | No multi-step autonomous planning (single-turn structured dispatch) |
| Country-scale integration (DHIS2 sync, government Observatory, gov auth) | No prompt caching — full system prompt re-sent every call |
| Channel breadth (Web + Telegram + Meta + Voice) | No structured eval / A-B harness in CI |
| Safety stack (negation, topic anchor, repetition guard, safety-consensus, medication gate, emergency triage) | No automated retraining loop (feedback collected, fine-tuning is manual) |
| Operational cascade (LoRA → Groq → Gemini → OpenAI with X-LLM-* observability) | No token / cost telemetry per call |

AMINA is **production-ready for its mission** (community-health dialogue at population scale in low-resource Gambian settings) and **not directly competitive with general-agent platforms** (Claude Agent SDK / OpenAI Assistants / Microsoft Copilot Studio) — those are tool-platform products. The closest comparable is **Hippocratic AI's voice agent** stack, where AMINA leads on language/locale and lags on conversation autonomy + clinical eval rigor.

---

## 1. AMINA Agent — Full Architecture Inventory

### 1.1 Runtime core

| Component | Where | Notes |
|---|---|---|
| FastAPI app | [`src/main.py`](../haystack-stack/haystack-chatqna/src/main.py) | 18+ routers, startup-time ArcadeDB schema bootstrap, Redis init, DHIS2 scheduler |
| Agent class | [`src/agent/amina_agent.py`](../haystack-stack/haystack-chatqna/src/agent/amina_agent.py) (~2700 lines) | `AminaAgent.process_message` is the central call site |
| LLM cascade | Same file, lines 169-200 | 5 clients constructed at boot: AMINA-LoRA, OpenAI, Gemini, Groq, Mistral |
| LoRA serving | A40 GPU + Tailscale Funnel `amina-a40.tail0da632.ts.net/v1` | vLLM-served fine-tune; falls back to cloud cascade when unreachable |
| Provider policy patch | [`src/services/llm_provider_policy.py`](../haystack-stack/haystack-chatqna/src/services/llm_provider_policy.py) | Env-driven graceful/warn/strict modes; X-LLM-* response headers; cascade fallback for authenticated callers |

### 1.2 Process flow per message

`AminaAgent.process_message()` is a **single-pass structured dispatcher**, not a ReAct loop. Stages:

1. **Chat-export shortcut** — short-circuit if user asks for PDF
2. **Emergency keyword scan** — `check_emergency()` short-circuits ritual/greeting
3. **Patient identity resolution** — session_id pattern → phone → PatientVertex
4. **Memory append** — Tier 1 (in-process) + Tier 2 (Redis)
5. **First-turn detection** — cross-worker via Redis to prevent greeting duplication
6. **Cultural ritual phase** — 4-state machine (0–3) for first-time vs returning patients
7. **Multi-layer intent routing** — up to 4 layers (see §1.3)
8. **Tool dispatch** — keyword-triggered + context-injected
9. **LLM generation** — system prompt + retrieved context + tool outputs + history
10. **Safety review** — multi-model consensus / safety contract / topic anchor
11. **Care-plan extraction** — structured fields from LLM output
12. **Persistence** — ConsultationRecord + ClinicalInsight to ArcadeDB

### 1.3 Reasoning + tool use

**No ReAct loop.** Tool dispatch is **deterministic + intent-driven**:

| Layer | What it does | Cost |
|---|---|---|
| L0 — `intent_router.py` | Keyword regex match (goodbye, yes/no, emergencies) | <1ms |
| L1 — `four_layer_router.py` | Optional LLM (Gemini Flash Lite) classifies into 9 stances | ~200ms |
| L2 — Stance-conditional tool suppression | Maps stance → allowed tools (e.g. emotional_disclosure suppresses clinical tools) | inline |
| L3 — `intent_pattern_graph.py` | Knowledge-graph emergency override + cultural-idiom decoder | inline |

Gated behind `USE_FOUR_LAYER_ROUTER=true`; default is L0-only.

**Tool catalogue** ([`src/agent/orchestrator.py`](../haystack-stack/haystack-chatqna/src/agent/orchestrator.py)) — **22 tools**:

```
KnowledgeTool, TriageTool, ReferralTool, MedicationTool, DietTool,
EmergencyTool, PatientTool, SaveConsultationTool, CulturalTool,
FollowupTool, VitalsTool, CarePlanTool, RamadanTool, CVDRiskTool,
WHODiabetesTool, WHOHypertensionTool, WHORespiratoryTool,
WHOCancerScreeningTool, WHOLifestyleTool, PrescriptionTool,
LifestyleNudgesTool, CommunitySupportTool
```

A separate **deterministic UX gate** for Beginner/Basic literacy modes:
[`basic_beginner_intent_router.py`](../haystack-stack/haystack-chatqna/src/services/basic_beginner_intent_router.py) — pure regex, intercepts greeting/goodbye/thanks/ack/vague, falls through to the advanced pipeline for medical/emergency/unknown.

**Crucially: tool calls are NOT exposed to the LLM as function-calling**. The orchestrator picks tools and concatenates their output into the prompt. The LLM produces prose; it doesn't *request* a tool.

### 1.4 Prompt engineering

[`src/agent/prompts.py`](../haystack-stack/haystack-chatqna/src/agent/prompts.py) — `AMINA_SYSTEM_PROMPT` is a long structured doc covering:

- **Identity** — Gambian community health worker voice
- **Mission** — Gambia 2022-27 NCD Strategy operationalisation
- **Cultural principles** — greeting ritual, religious neutrality, elder-respectful address (Mba/Mfa)
- **Language** — bilingual EN/Mandinka with code-switch detection, key health phrase glossary
- **Clinical principles** — emergency-first triage (FAST, BP >180/120, glucose >400 / <50), 4 triage levels (SELF_CARE / CHW_VISIT / FACILITY / EMERGENCY), WHO PEN protocols

Variants in `amina_agent.py`:
- Lines 1696-1728 — CHW home-visit framing
- Lines 1762+ — LoRA-tuned variant
- Conversational pacer prompt (one-topic-per-turn, 3-sentence cap, mandatory engagement question)
- Regeneration hint (downvote-reason → instruction)

Dynamic budget:
- `_get_length_instruction()` toggles "3-6 sentences" vs "up to 200 words" for diet plans
- `_get_max_tokens()` tiers output 100-1000 based on message length + plan keywords

### 1.5 Memory + state (3-tier)

| Tier | Backing store | Scope | Key examples |
|---|---|---|---|
| **T1** in-process | Python `ConversationMemory` | per-request | `messages[]`, `patient_context`, ritual phase, language hint |
| **T2** ephemeral | Redis | per-session, 24h TTL | `messages:{sid}`, `patient_stats:{sid}`, `ritual_phase:{sid}`, `ethnic_language:{sid}` |
| **T3** durable | ArcadeDB | cross-session | `PatientVertex`, `ConsultationRecord`, `MemoryVertex` (vector), `ClinicalInsight`, `InteractionEvent` |

Sliding-window history is 20 messages. Older content is *not* compacted into a running summary — it's lost from the prompt unless promoted to ConsultationRecord at end-of-session.

### 1.6 RAG / retrieval

| Component | Where | Notes |
|---|---|---|
| Vector retriever | `arcade_vector_retriever.py` | sentence-transformers `all-MiniLM-L6-v2` (default) on ArcadeDB |
| Keyword retriever | `arcade_keyword_retriever.py` | BM25-style over the same corpus |
| RAG tuner patch | `rag_tuner.py` | Hybrid RRF merge (vector 0.55 / keyword 0.45), score threshold 0.45, top-k 15 retrieval / top-3 rerank, query-adaptive profiles (emergency / clinical / diet / ramadan / med-info / default), grounded prompt forcing citation |
| Reranker registry | `reranker_registry.py` | Pluggable; default = NoOp |
| Reranker feedback | `reranker_feedback.py` | Collects downvote-reason events into `RankerFeedbackVertex` |
| Fine-tune harness | `training/finetune_reranker.py` | Offline cross-encoder fine-tune (no automated retraining loop) |

### 1.7 Safety stack (10+ patches)

| Patch | Concern |
|---|---|
| `check_emergency()` (in agent) | Keyword pre-screen → EmergencyTool short-circuit |
| `MedicationTool` | Drug name / dose / interaction / allergy gate before advice |
| `negation_patch.py` + `negation_detector.py` | "Don't eat salt" handled correctly in LLM output |
| `safety_consensus.py` + `safety_consensus_patch.py` | Multi-model vote (OpenAI + Gemini + Groq) before release |
| `safety_contract.py` | Deterministic post-validation — fail-closed regenerate |
| `topic_anchor_patch.py` | Hallucination fence (keep on health) |
| `repetition_guard.py` | Block verbatim phrase repeat across turns |
| `overflow_guard.py` | Bound message length |
| `stt_upload_guard.py` + `stt_duration_guard.py` | Compression-bomb defense (8 MB / 6 min) |
| `guest_chat_patch.py` | No personalised advice, no PHI lecturing for unauth users |
| `translation_gate.py` | Quality-gate LLM translations before send |

### 1.8 Multi-modal

| Modality | Component | Detail |
|---|---|---|
| STT | Whisper.cpp via `voice-stt` container | small.en model, 4 threads, upload + duration guard |
| TTS (English) | Piper via `voice-tts` container | en_US-lessac-medium |
| TTS (Mandinka) | Meta MMS via `voice-tts-mnk` | Massively Multilingual Speech, Mandinka dialect |
| Vision | OpenAI Vision (`gpt-4-vision`) | `PrescriptionTool` extracts drugs, doses, instructions from photos |
| Image MIME | `prescription_upload_patch.py` | Whitelist expanded to 18 MIME types incl. empty/octet-stream |

### 1.9 Multi-language (Mandinka NLP — distinctive)

[`src/nlp/`](../haystack-stack/haystack-chatqna/src/nlp/):

1. **Code-switch detector** — EN/Mandinka mixing, triggers dual-response
2. **Mandinka spellcheck** — orthography normalisation
3. **Mandinka temporal** — "juwula" (yesterday) / "kannu" (tomorrow)
4. **Mandinka sentiment** — emotion classification
5. **Intent normaliser** — cross-language intent canonicalisation
6. **Medical NER** — bilingual drug + symptom recognition
7. **Manding transfer** — phonological Bambara→Mandinka rules for OOV

Plus translation v3:
- `mandinka_phrases.py` — phrase bank
- `translation_gate.py` — quality gate
- `bilingual_response.py` — paired EN/MA response builder
- `translation_v3_integration.py` — pipeline integration
- `translation_corrector.py` — LLM post-edit

### 1.10 Multi-channel

| Channel | Component | Notes |
|---|---|---|
| Web | `components/frontend/` (React + Vite) | Beginner / Basic / Advanced literacy modes |
| Telegram | `components/multichannel-access/` (FastAPI sidecar) | Ngrok/Cloudflared tunnel, auto-webhook watcher |
| WhatsApp + Messenger | `services/meta_bridge.py` (in-haystack) | **Shared pipeline** + thin adapter classes (Phase Meta-Shared-Pipeline) |
| Voice gateway | `components/voice-gateway/` | Standalone STT+TTS service |
| Government portal | `components/gov-chat-frontend/` | Separate React app for Observatory |

### 1.11 Personalisation / clinical workflow

- **Caregiver inbox + policy review** ([`api/caregiver_inbox_routes.py`](../haystack-stack/haystack-chatqna/src/api/caregiver_inbox_routes.py)) — chat between patient and caregiver, emergency fan-out, policy acceptance flow
- **Caregiver registration v2 + admin approval** ([`caregiver_registration_v2_routes.py`](../haystack-stack/haystack-chatqna/src/api/caregiver_registration_v2_routes.py)) — multi-role, document upload, approval chain (overridden by admin notification bell + review modal)
- **Care plan generation** (`CarePlanTool`) — diagnosis / meds / lifestyle goals / follow-up
- **Vitals tracking** (`VitalsTool` + `arcade_graph_enricher.py`) — BP/glucose/weight edges to consultations
- **Triage levels** — SELF_CARE / CHW_VISIT / FACILITY / EMERGENCY surfaced in API response
- **Patient intelligence pipeline** (`services/learning.py`) — `InteractionEvent` + `ClinicalInsight` vertices for behaviour profiling
- **Literacy modes** — Beginner shell (big tiles), Basic shell (denser), Advanced (full UI)

### 1.12 Observability + ops

- **LLM provider headers** — `X-LLM-Provider`, `X-LLM-Preferred`, `X-LLM-Fallback-Used`, `X-LLM-Latency-Ms`, `X-LLM-Mode`, `X-LLM-Provider-Error` — projected by ASGI middleware
- **Admin notification bell** + **review modal** + **privacy popup** (every login/logout) on the frontend
- **Health endpoints** on every container
- **Structured logs** with safe-metadata-only logging in newer patches (basic_beginner, meta_pipeline)
- **No** explicit cost / token tracking
- **No** central tracing (no OpenTelemetry)

### 1.13 Government / sovereignty

- **Observatory phone-auth** (3 super-admins seeded) — phone OTP for rural staff
- **Observatory RBAC** — admin / analyst / viewer
- **DHIS2 integration** — daily aggregate push (02:00 UTC), opt-in patient-level tracker, bi-directional referral pull every 15min
- **Synthetic-data governance + disclaimers** — opt-in tracking, training-consent vertex
- **JWT + signed cookies + rate limiter + voice concurrency limiter**

### 1.14 What AMINA *doesn't* have

Honest list of standard agent features that are **absent** in the current codebase:

1. **No LangGraph-style workflow engine** — no graph of agents / states
2. **No autonomous multi-step planner** — no "let me think step-by-step" loop
3. **No LLM-driven function-calling** — tools dispatched deterministically, not requested by the model
4. **No streaming responses** — one full payload per call
5. **No conversation compaction** — older messages just drop off the 20-msg sliding window
6. **No agentic / iterative retrieval** — RAG is single-pass
7. **No automated retraining loop** — reranker fine-tuning is a manual offline script
8. **No online eval / A-B test harness in CI** — only offline metrics
9. **No model confidence / uncertainty estimates** in API responses
10. **No prompt caching** (Anthropic-style or OpenAI-style ephemeral cache)
11. **No native cost / token telemetry** per call
12. **No time-aware long-horizon reasoning** — follow-ups happen via FollowupTool, not LLM planning
13. **No sandboxed code execution** (Claude Code / OpenAI Code Interpreter equivalent)
14. **No web-browsing tool** (Claude / OpenAI Operator equivalent)

Most absences are deliberate — AMINA is a constrained-domain dialogue agent for clinical safety, where unconstrained autonomy is dangerous. But some (streaming, prompt caching, function-calling, eval harness, cost telemetry) are clear product gaps.

---

## 2. Industry Landscape Comparison

> Caveat: this section reflects public information available as of January 2026. Verify the most recent product announcements before drawing strategic conclusions.

### 2.1 Comparison axes

The 14 axes below are the ones that typically drive agent capability differences. They map to AMINA's inventory above.

| # | Axis |
|---|---|
| A | Reasoning architecture (single-shot / ReAct / planning / multi-agent) |
| B | Tool use (function-calling / deterministic / hybrid) |
| C | Memory (working / persistent / cross-session) |
| D | RAG (single-pass / iterative / agentic) |
| E | Safety stack (built-in / opt-in / domain-tuned) |
| F | Multi-modal (text / voice / vision / video) |
| G | Multi-language depth |
| H | Multi-channel breadth (web / messaging / voice / phone) |
| I | Personalisation (in-context / persistent profile / clinical workflow) |
| J | Observability (token cost / tracing / eval) |
| K | Domain specialisation (healthcare / clinical-protocol fidelity) |
| L | Sovereignty (self-hosted / data residency / open weights) |
| M | Compliance (HIPAA / GDPR / sector-specific) |
| N | Cost / latency profile |

### 2.2 Industry players in scope

We compare against **two categories** (because they're different products solving different problems):

**Category 1 — General-purpose agent platforms** (developer toolkits to build vertical agents):
- **Anthropic** — Claude Agent SDK, Claude Code, Claude API
- **OpenAI** — Assistants API v2, Operator (browser agent), Agents SDK
- **Microsoft** — Copilot Studio, Semantic Kernel, AutoGen, Azure AI Foundry
- **Google** — Vertex AI Agent Builder, Gemini Code Assist
- **Open source** — LangGraph, LlamaIndex Agents, CrewAI

**Category 2 — Healthcare-specific agents** (closer to AMINA's actual mission):
- **Hippocratic AI** — voice-first nursing-call agent for low-risk care
- **Glass Health** — clinical decision support for clinicians
- **Nabla** — ambient scribe for clinicians
- **Ada Health** — symptom-checker app
- **K Health** — primary-care chat
- **Babylon Health** — (defunct 2023) symptom checker that AMINA's mission resembles
- **Suki AI** — voice-first clinical scribe
- **Microsoft Azure Health Bot** — health-bot platform (more chatbot than agent)
- **Med-PaLM 2 / MedLM (Google)** — model not product
- **John Snow Labs** — medical NLP / LLMs (vendor of components)

### 2.3 Comparison matrix — Category 1 (platforms)

| Axis | AMINA | Anthropic Claude (SDK + Agent) | OpenAI Assistants + Operator | MS Copilot Studio + Semantic Kernel + AutoGen | Google Vertex Agent Builder | LangGraph (OSS) |
|---|---|---|---|---|---|---|
| A. Reasoning | Single-pass dispatcher; deterministic tool selection | Native ReAct + extended-thinking; can orchestrate sub-agents via SDK | Assistants threads + native function-calling; Operator does browser-step planning | Copilot Studio = topic-based dialogue; Semantic Kernel + AutoGen = multi-agent orchestration; reAct-class | Reasoning with grounding; Gemini-native function-calling | Explicit graph-of-agents authoring; user-defined nodes/edges |
| B. Tool use | Deterministic dispatch; tools never requested by LLM | LLM-requested tool calls (function-calling); `computer-use` tool for screen control | LLM-requested function-calling + Code Interpreter + File Search + Vision | Tools as plugins; LLM-requested via plan; Power Platform connectors | Function-calling with Vertex Tools | Tools attached to nodes; LLM-requested |
| C. Memory | 3-tier (in-proc / Redis / ArcadeDB); 20-msg sliding window; no compaction | Threads with persistent context; **prompt caching** (90%+ cost cut on cached system prompts) | Threads with auto-truncation; vector store attached for RAG; **prompt caching** | Long-term memory in Cosmos DB; multi-turn state in Bot Framework | Memory bank in Vertex; vector + structured | User-defined; usually checkpointed graph state |
| D. RAG | Hybrid vector+keyword RRF, single-pass, query-adaptive profiles | Built-in via `web_search` and document tools; iterative agentic search supported | Built-in File Search retrieval; **vector store** managed; assistant iterates | Built-in Azure AI Search integration | Vertex Search integrated | DIY but native — combine with LlamaIndex / Haystack |
| E. Safety | 10+ guardrails: emergency, medication, negation, topic anchor, safety-consensus, etc. — **domain-tuned** | Constitutional AI alignment; `prompt_caching` of safety preamble; classifier-based content filters | Moderation API + custom guardrails + structured outputs | Azure Content Safety integrated; Guardrails patterns | Vertex Safety filters | DIY — add LangChain Guardrails / NeMo Guardrails |
| F. Multi-modal | STT (Whisper), TTS (Piper EN + MMS Mandinka), Vision (OpenAI prescription) | Native vision (Claude); text-only output | Native vision + image generation + text-to-speech (TTS) + Whisper STT in API | Vision + TTS + STT (Azure Speech) | Vision + TTS + Speech | DIY |
| G. Languages | **Mandinka 6-layer NLP** + EN — distinctive | 100+ languages but English-centric quality | Multilingual (similar) | Multilingual | Multilingual incl. Indic / SE-Asian strong | Depends on chosen LLM |
| H. Channels | Web + Telegram + Meta + Voice + Gov portal | API → developer integrates | API → Operator browser channel; ChatGPT app | Teams + Outlook + web + Power Platform + voice | Web + Conversational AI APIs | DIY |
| I. Personalisation | Persistent patient profile + care plan + vitals + ConsultationRecord; literacy modes | Threads + custom system prompts; no clinical workflow | Threads + assistant per persona | Bot Framework user state; Connector to D365 | Custom | DIY |
| J. Observability | X-LLM-* headers; admin badge; manual eval | Console with token cost, latency; no native traces | Dashboard with usage + cost; Logs API; Trace API | Application Insights integration; Copilot Analytics | Vertex Logging + Monitoring | DIY (LangSmith popular) |
| K. Domain specialisation | **Deep healthcare + WHO PEN protocols + Gambia-specific (Alkalo, Ramadan, DHIS2)** | None native | None native | Industry-vertical "Copilots" (limited healthcare-specific) | None native | None native |
| L. Sovereignty | **LoRA fine-tune self-hosted (A40); cloud cascade optional**; ArcadeDB self-hosted | Closed model, US/EU regions | Closed model, US/EU regions | Azure regions; on-prem via ARC; Phi models can self-host | GCP regions | Fully self-hostable (you bring the model) |
| M. Compliance | Gambian Data Protection Act; opt-in synthetic-data governance; DHIS2 sync | HIPAA-eligible (BAA available); SOC 2 | HIPAA via dedicated tier; SOC 2 | HIPAA + many sector certs (FedRAMP, FERPA) | HIPAA + FedRAMP | DIY — depends on deployment |
| N. Cost / latency | Free-tier mostly (Groq + Gemini); LoRA = own GPU cost; ~1-3s typical | Pay-per-token; prompt caching cuts cost 90%+; latency ~1-3s | Pay-per-token + storage; Operator extra; latency ~2-5s | Per-Copilot-message + Azure consumption; latency varies | Per-token Vertex; latency 1-3s | Pay your inference provider |

### 2.4 Comparison matrix — Category 2 (healthcare-specific)

| Axis | AMINA | Hippocratic AI | Glass Health | Nabla | Ada Health | K Health | Microsoft Azure Health Bot |
|---|---|---|---|---|---|---|---|
| Primary mission | Community NCD dialogue (patient-facing) | Voice-first patient nursing agent | Clinical reasoning copilot for clinicians | Ambient consultation scribe | Symptom checker (consumer app) | Primary care chat | Health-bot building platform |
| User | Patient + caregiver | Patient | Clinician | Clinician | Patient | Patient | Developer |
| Reasoning | Single-pass dispatch + intent layers | Voice-first conversation, scripted nursing protocols + LLM | Diagnostic reasoning multi-step | Multi-turn ambient capture | Symptom-decision tree + LLM | Symptom triage + LLM + clinician handoff | Authoring tool + LLM |
| Tool use | 22 deterministic tools | Internal protocols + EHR integrations | EHR + UpToDate + clinical refs | EHR write-back, ICD-10 | Curated medical KB | EHR + scheduling | Provider-built |
| Memory | 3-tier persistent | Per-patient per-call | Per-clinician case state | Per-encounter | Per-session symptom history | Per-patient profile | Provider-built |
| Safety | Multi-layer + WHO PEN | Constitutional + medical professional review board | Clinician validates | Clinician validates | Disclaimer + escalation | Triage to clinician | Provider responsibility |
| Multi-modal | Voice + text + vision | **Voice-first** (real-time TTS pipeline) | Text + structured | **Voice ambient** | Text | Text | Mostly text |
| Languages | EN + Mandinka deep | EN + Spanish (more added) | EN | EN + FR | 12+ | EN | Multi-lang |
| Channels | Web + Telegram + Meta + Voice + Gov | Phone (PSTN) | Web | Mobile + web (encounter) | Mobile app | Mobile + web | Provider-built |
| Personalisation | Patient profile + care plan + vitals + literacy modes | Per-patient per-call | Per-clinician + EHR pull | Per-encounter | Per-session | Persistent profile | Provider-built |
| Sovereignty | **Self-hosted LoRA + cloud cascade fallback** | SaaS only | SaaS | SaaS or on-prem (Enterprise) | SaaS | SaaS | Azure (sovereign clouds available) |
| Compliance | Gambia DPA + DHIS2 | HIPAA + SOC 2 + nursing professional review | HIPAA | HIPAA + GDPR + HDS (FR) | HIPAA + GDPR + ISO 27001 | HIPAA | HITRUST + HIPAA |
| Domain depth | NCD protocols + Gambia + religious context + Ramadan + Alkalo | Nursing protocols + escalation | Diagnostic reasoning | SOAP note formatting | Symptom→condition mapping | Triage + telehealth | Authoring framework |
| Geography | Gambia + roll-outable | US-first | US-first | US + EU | EU + global | US-first | Global |

---

## 3. Detailed Gap Analysis

### 3.1 Gaps where AMINA is genuinely behind

| # | Gap | Severity | What it'd unlock |
|---|---|---|---|
| **G1** | **No streaming responses** (single full payload) | High | Per-token TTFT (time-to-first-token) drops 5-10× perceived latency. Every consumer-facing agent now streams. Especially impactful on slow connections (Gambia 3G/4G median). |
| **G2** | **No native LLM function-calling** | Medium-High | Current architecture works because we don't NEED tool autonomy, but we lose the LLM's ability to disambiguate "I think I should call MedicationTool first then DietTool" without us pre-deciding. Constrains future tool surface growth. |
| **G3** | **No prompt caching** (Anthropic-style) | Medium | Our system prompt + WHO PEN protocol injection runs ~3-5K tokens per call. Anthropic's 90% cache discount on identical prefixes would cut LoRA-adjacent cost dramatically and reduce cold-start latency. |
| **G4** | **No automated retraining loop** | Medium | Reranker feedback collected for months but offline manual fine-tune. Need hourly/daily auto-retrain → A/B → promote. |
| **G5** | **No conversation compaction / summary** | Medium | 20-msg sliding window means a multi-month patient relationship loses everything. ConsultationRecord rescues durable facts but mid-session continuity for long sessions is lost. |
| **G6** | **No structured eval / A-B harness in CI** | High | Manual offline eval is unscalable. Hippocratic AI publishes RCTs; AMINA has no continuous quality measurement. Also blocks regulatory submission later. |
| **G7** | **No native cost / token telemetry** | Medium | Can't answer "what's our cost per consultation?" cleanly. Blocks unit-economics planning. |
| **G8** | **No model confidence / uncertainty signal** | Medium-High | Clinical agents should expose when they're guessing. Frontend has no way to render "I'm 60% confident — please confirm with a CHW". |
| **G9** | **No iterative agentic retrieval** | Medium | Single-pass RAG misses cases where the right document needs a second query reformulated from the first hit. Big driver of hallucination on long-tail clinical questions. |
| **G10** | **No tracing / OTel** | Medium | Hard to root-cause a slow conversation. We log line-by-line but no per-request span tree. |

### 3.2 Gaps where AMINA is **deliberately constrained** (not necessarily a problem)

| # | Constraint | Why we don't have it | When to revisit |
|---|---|---|---|
| C1 | No multi-step autonomous planner | Clinical safety: an LLM that "decides what to do next" can amplify hallucination. WHO PEN protocols give us a deterministic backbone. | If we expand into clinical decision support FOR CLINICIANS (not patients), we need this. |
| C2 | No code execution sandbox | Out of scope. We're not Claude Code. | Probably never. |
| C3 | No web-browsing tool | Out of scope. Hallucination risk too high in clinical context. | Only if we add a public-health news tool, and only with strict source allow-list. |
| C4 | No long-horizon time reasoning | FollowupTool handles scheduling deterministically. | When we add longitudinal care management for chronic patients. |

### 3.3 Gaps where AMINA is genuinely **ahead**

| # | Strength | Comparison |
|---|---|---|
| **S1** | Mandinka 6-layer NLP pipeline | No commercial competitor. Even Google MedLM is English-first. This is a moat. |
| **S2** | WHO PEN protocol embedding + 22 clinical tools | Hippocratic AI matches on protocol; nobody else does. Glass / Nabla / Suki are clinician-facing. |
| **S3** | Cultural ritual state machine + religious neutrality + Alkalo / VHW / Imam roles | Zero competitors operationalise this. |
| **S4** | DHIS2 integration + government Observatory + sovereign deployment story | Only African-public-health-context agent doing this end-to-end. |
| **S5** | Multi-channel breadth (Web + Telegram + Meta + Voice + Gov + Caregiver inbox) | Most competitors are 1-2 channels. |
| **S6** | LLM provider cascade with `X-LLM-*` observability + strict-mode 503 + admin badge | More resilient than OpenAI Assistants when their API has a brownout. |
| **S7** | Self-hosted LoRA fine-tune | Few healthcare agents own their model weights. |
| **S8** | Caregiver inbox + policy review + admin approval workflow | Closest to Microsoft 365 Copilot's user-management story; nobody healthcare has this. |
| **S9** | Literacy modes (Beginner / Basic / Advanced) tied to UI shells AND deterministic intent gate | No competitor we found. |

### 3.4 Strategic recommendations

Listed by **highest leverage / cost ratio**, top to bottom:

| Rank | Action | Effort | Impact |
|---|---|---|---|
| 1 | **Add streaming responses** (SSE on `/agent/chat-stream`, frontend partial-rendering) | M (2-3 weeks) | Perceived UX equals the rest of the industry |
| 2 | **Add structured eval harness in CI** (golden-dataset replays + per-domain scoring) | M-L (4-6 weeks) | Unblocks regulatory + quality monitoring; lets us confidently change prompts |
| 3 | **Add prompt caching** (segment system prompt into static + dynamic; use Anthropic prompt-caching headers when on Claude path) | S (1 week) | 30-60% cost reduction on cloud cascade calls |
| 4 | **Add cost / token telemetry** (per-call per-provider, surface in admin badge) | S (1 week) | Unit economics visible |
| 5 | **Add conversation compaction** (LLM-summarise tail when >20 msgs, store in patient_context) | S-M (2 weeks) | Long-session continuity |
| 6 | **Add model confidence signal** (multi-model agreement % surfaced in API response) | S (1 week) | Clinical safety visibility |
| 7 | **Move reranker fine-tune to scheduled job** (existing harness, add cron + A-B promotion) | S (1 week) | Automated quality improvement |
| 8 | **Add OpenTelemetry tracing** | M (3 weeks) | Operability |
| 9 | **Add iterative agentic retrieval** (single re-query on low-confidence first pass) | M (3 weeks) | Hallucination reduction on long-tail |
| 10 | **Add LLM function-calling option** (alongside deterministic dispatch — A-B which is better per intent class) | L (6-8 weeks) | Future-proof for tool-surface growth |

**Don't** chase:
- LangGraph multi-agent orchestration (overkill for our use case, kills latency budget)
- Code execution / browser tool (not our mission)
- ChatGPT-Operator-class autonomy (clinical safety blocker)

---

## 4. Honest assessment

AMINA is **a competitive vertical health agent for low-resource Anglophone-Mandinka West African settings**. It is not a competitor to Claude Agent SDK or OpenAI Assistants — those are platforms; we are a product.

The closest peer is **Hippocratic AI**, which leads us on:
- Voice-first conversation latency / quality
- Clinical eval rigor + nursing professional review
- US healthcare market presence

…and where AMINA leads Hippocratic AI on:
- Mandinka + cultural localisation
- Government health-system integration (DHIS2)
- Sovereignty (self-hosted weights)
- Multi-channel breadth
- Open architecture

The **highest ROI investments** for the next 12 months are the **operational maturity gaps** (streaming, eval harness, prompt caching, cost telemetry, conversation compaction) — none of which require fundamental architecture changes, all of which directly improve user experience and unblock regulatory submission. The platform-grade items (function-calling, multi-step planning, agentic search) can wait until those are in place AND there's a proven product-led reason to add them.

---

## 5. Document version

- **v1.0 — 2026-04-27** — initial baseline
- Knowledge cutoff: January 2026 — verify recent product releases before acting on industry-comparison claims marked [VERIFY]
- Next review trigger: when we add G1 (streaming), G2 (function-calling), or G6 (eval harness)
