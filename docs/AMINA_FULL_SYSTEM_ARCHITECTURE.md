# AMINA Care - Full System Architecture

## 1. System Overview

AMINA (AI-Mediated Integrated Nursing Assistant) is a clinical health assistant
built for The Gambia's community health system. It serves patients, community
health workers (CHWs), and caregivers through text, voice, and multi-channel
interfaces in English and Mandinka.

```
                          AMINA CARE — SYSTEM TOPOLOGY
  
  +------------------+     +------------------+     +------------------+
  |   Patient App    |     |  Caregiver App   |     |   Admin Console  |
  |  (React 19/Vite) |     |  (React 19/Vite) |     |  (React 19/Vite) |
  |  Port 5173/5174  |     |  Port 5173/5174  |     |  Port 5173/5174  |
  +--------+---------+     +--------+---------+     +--------+---------+
           |                         |                        |
           +------------+------------+------------------------+
                        |
                   HTTP / REST
                        |
           +------------v--------------+
           |   haystack-chatqna        |
           |   FastAPI  (Port 8000)    |
           |   4 uvicorn workers       |
           |   200 concurrency cap     |
           +--+-----+-----+-----+-----+
              |     |     |     |     |
     +--------+  +--+--+  |  +--+--+  +--------+
     |           |     |  |  |     |           |
+----v---+ +----v-+ +--v--v--v-+ +-v----+ +----v-------+
|voice-  | |voice-| | ArcadeDB | |Redis | |  dataprep  |
|stt     | |tts   | | (Graph+  | |Cache | |  worker    |
|Whisper | |Piper | | Vector)  | |      | |  Haystack  |
|Port    | |Port  | | Port     | |Port  | |  Port 8001 |
|8087    | |5500  | | 2480     | |6379  | |            |
+--------+ +--+---+ +----------+ +------+ +------------+
               |
          +----v----+
          |voice-   |
          |tts-mnk  |
          |MMS/Mnk  |
          |Port 5501|
          +---------+

          +--------------------+
          | Apache Superset    |
          | Analytics/BI       |
          | Port 8080          |
          +--------------------+
```

---

## 2. Infrastructure (Docker Compose)

8 containerized services on the `chatqna_default` bridge network:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| **haystack-chatqna** | Custom (GPU) | 8000 | RAG + Agent + API brain |
| **arcadedb** | ArcadeDB | 2480, 5433 | Knowledge graph + vector store |
| **redis** | Redis | 6379 (internal) | Session cache, working memory, audit streams |
| **voice-stt** | whisper.cpp | 8087 | Speech-to-text (small.en, 12 layers) |
| **voice-tts** | Piper TTS | 5500 | English text-to-speech |
| **voice-tts-mnk** | MMS TTS | 5501 | Mandinka text-to-speech |
| **dataprep-worker** | Haystack | 8001 | Document ingestion + graph enrichment |
| **superset** | Apache Superset | 8080 | Analytics dashboards |

### Persistent Volumes (bind-mounted)
```
./data/arcadedb/          -> ArcadeDB graph database (genie)
./data/redis/             -> Redis AOF persistence
./data/huggingface-cache/ -> MMS model weights
./data/superset/          -> Superset metadata
./training_exports/       -> JSONL training data exports
./education_certs/        -> Uploaded literacy certificates
```

---

## 3. Frontend Architecture

**Stack:** React 19.2 + Vite 5.4 | No Redux | State via localStorage + hooks

### 3.1 Shell Components
| Component | Lines | Purpose |
|-----------|-------|---------|
| **App.jsx** | 3,300 | Main patient chat shell (text + voice + forms) |
| **BeginnerChat.jsx** | - | Simplified literacy-mode chat |
| **CaregiverChat.jsx** | - | Caregiver clinical chat |
| **CaregiverPortal** | - | Caregiver mode overlay |
| **AdminDashboard.jsx** | - | Admin console shell |
| **AuthScreen.jsx** | - | Phone+PIN login, OTP, OAuth |
| **PatientSidebar.jsx** | - | Session/thread list |

### 3.2 Bootstrap Module Pattern

18 self-mounting Bootstrap modules inject independent React roots into `<body>`
at startup. Each checks `window.__amina*Mounted` for idempotency.

| Bootstrap | Function |
|-----------|----------|
| **I18nBootstrap** | Language picker, RTL CSS, auto-translator |
| **ScribeBootstrap** | Voice recording FAB + transcription review |
| **InboxBootstrap** | Patient message bell + panel |
| **CaregiverInboxBootstrap** | Caregiver notification bell |
| **EmergencyBootstrap** | Escalation watcher + 199 banner |
| **SessionBootstrap** | Multi-session switcher |
| **ConsentBootstrap** | Training data consent gate |
| **RouterBootstrap** | Client-side route management |
| **RoleSwitcherBootstrap** | Patient <-> Caregiver role toggle |
| **ResilienceBootstrap** | Offline queue + retry |
| **ChatToastBootstrap** | Toast notifications |
| **DualPathLedgerBootstrap** | Bidirectional audit trail UI |
| **SupplyLedgerBootstrap** | Supply chain tracking UI |
| **VillageManagerBootstrap** | Village health management |
| **ScoutManagerBootstrap** | CHW scout management |
| **Dhis2TrackerBootstrap** | DHIS2 sync status |
| **BantabaManagerBootstrap** | Community circle management |
| **LiteracyBootstrap** | Literacy level detection + mode switching |

### 3.3 Fetch Interceptor Chain

6 layered `window.fetch` wrappers installed at module load:

```
Browser fetch()
  -> AdminPatientLiteracyOverride  (synthetic literacy/me for admin)
  -> SessionBootstrap              (snoop login responses for session)
  -> CaregiverInboxBootstrap       (co-fire emergency to inbox)
  -> EmergencyBootstrap            (co-fire legacy alert to FSM)
  -> chatInterceptor               (rewrite /chat -> /chat-resilient)
  -> v2_optin                      (inject X-Translation-Pipeline: v2)
  -> actual fetch()
```

### 3.4 i18n

i18next + react-i18next with 4 locales: English, French, Arabic, Mandinka.
Auto-translator batches UI strings to `/api/v1/agent/translate/batch`.
RTL support for Arabic.

### 3.5 Auth

JWT-based. Three token types stored in localStorage:
- `AMINA_TOKEN` — patient auth
- `cg_token` — caregiver auth
- `AMINA_ADMIN_TOKEN` — admin auth

---

## 4. Backend Architecture

**Stack:** FastAPI + Haystack 2.x + OpenAI SDK | Python 3.11

### 4.1 Entry-Point Chain

16 `main_with_*.py` modules forming a strict linear import chain.
Each adds routes/features without modifying prior modules:

```
main.py  (base: 10 core routers)
  <- main_with_guard.py             (overflow token guard)
    <- main_with_training.py        (consent + export)
      <- main_with_literacy.py      (literacy assessment)
        <- main_with_resilience.py  (offline sync)
          <- main_with_inbox.py     (patient inbox)
            <- main_with_supply_ledger.py
              <- main_with_dhis2_history.py
                <- main_with_dualpath_ledger.py
                  <- main_with_caregiver_notify.py
                    <- main_with_emergency.py     (escalation FSM)
                      <- main_with_gap_closers.py (scribe, smart)
                        <- main_with_intent_review.py
                          <- main_with_stt_fix.py  <-- ACTIVE ENTRY POINT
```

### 4.2 API Routes (33 route modules)

| Prefix | Module | Purpose |
|--------|--------|---------|
| `/api/v1/agent` | agent_routes.py | Chat, voice-chat, stream, translate, tool exec |
| `/api/v1/auth` | auth_routes.py | Signup, login, OTP, OAuth |
| `/api/v1/patient` | patient_routes.py | Profile, vitals, triage history, allergens |
| `/api/v1/caregiver` | caregiver_routes.py | Profiles, alerts, inbox, voice-chat |
| `/api/v1/care` | care_routes.py | Care plans, guidelines, follow-ups |
| `/api/v1/community` | community_routes.py | CHW dashboard, supervisors |
| `/api/v1/consent` | consent_routes.py | Data sharing opt-in |
| `/api/v1/dhis2` | dhis2_routes.py | Sync triggers, org-unit status |
| `/api/v1/emergency` | emergency_routes.py | Alert escalation FSM, hotline |
| `/api/v1/fhir` | fhir_routes.py | HL7 FHIR export |
| `/api/v1/inbox` | inbox_routes.py | Patient messages |
| `/api/v1/direct_chat` | direct_chat_routes.py | Caregiver <-> patient messaging |
| `/api/v1/meta` | meta_routes.py | Health check, version, queue stats |
| `/api/v1/admin` | admin_mv_routes.py | System config, reports |
| `/api/v1/stt` | routes.py | Speech-to-text (Whisper) |
| `/api/v1/tts` | routes.py | Text-to-speech (Piper/MMS) |
| `/api/v1/training` | training_routes.py | ML training data export |
| `/api/v1/literacy` | literacy_routes.py | Literacy level assessment |
| `/api/v1/intent-review` | intent_review_routes.py | Intent misclassification review |
| `/api/v1/scribe` | scribe_routes.py | Home visit recording + compile |
| `/api/v1/smart` | smart_routes.py | WHO SMART guidelines engine |
| `/api/v1/supply` | supply_routes.py | Medical supply tracking |
| `/api/v1/protocol` | protocol_routes.py | Clinical protocol engine |

### 4.3 Services Layer (87 files)

Key service modules by function:

**Clinical Intelligence:**
- `clinical_pipeline.py` — End-to-end triage -> diagnosis -> plan
- `clinical_scoring.py` — WHO-aligned risk scores (CVD, diabetes, hypertension)
- `ddi_checker.py` — Drug-drug interaction lookup (25 curated pairs, zero LLM)

**Conversation Management:**
- `intent_router.py` — 9-intent deterministic classifier
- `four_layer_router.py` — 4-layer routing (deterministic -> LLM stance -> tool suppression -> knowledge graph)
- `conversational_pacer.py` — Forces short turns (max 3 sentences + engagement question)
- `dialogue_state.py` — Turn-level state snapshots

**Safety:**
- `safety_contract.py` — Deterministic response validation (meds, emergency, clinical numbers, harm); fail-CLOSED
- `safety_consensus.py` — Two-model voting (fingerprint + second opinion + reconcile)

**Memory & Compaction:**
- `context_compactor.py` — Background summarization (Gemini -> Groq -> GPT cascade), 75% soft / 90% hard thresholds
- `structured_compactor.py` — Extract structured clinical facts into PatientClinicalState
- `density_compressor.py` — Post-generation filler stripping
- `overflow_guard.py` — Per-model token caps with retry-on-overflow

**Translation:**
- `translator.py` (v1) — Single LLM call EN <-> Mandinka, Redis cache (30-day TTL)
- `translator_v3.py` — Three-stage pipeline: simplify -> translate with grounding -> verify via back-translation (not yet active)

**Voice Pipeline:**
- `stt_whisper.py` — Whisper.cpp client (normalize to 16kHz WAV -> POST /inference)
- `tts_piper.py` — Piper TTS dispatcher (English via Piper, Mandinka via MMS)

**Integrations:**
- `dhis2_sync.py` — Daily aggregate push (consultations, triage counts, NCD metrics)
- `auth.py` — Phone+PIN, JWT, Twilio/TextBelt OTP
- `greeting.py` — 7-layer culturally-aligned greeting (ethnic language, prayer time, trust tier)

---

## 5. Agent Architecture

### 5.1 AMINA Agent (ReAct + 3-tier memory)

```
                        AGENT REQUEST FLOW

  User message
       |
       v
  +----+----+
  | PRE-LLM |  1. Emergency keyword check
  | PIPELINE |  2. Patient identity resolution
  |          |  3. Ritual greeting (voice/SMS)
  |          |  4. Vitals trend extraction
  |          |  5. Journey callbacks (streaks, anniversaries)
  |          |  6. Intent routing (4-layer)
  |          |  7. Tool selection (keyword -> LLM)
  |          |  8. Preemptive safety constraints
  +----+-----+
       |
       v
  +----+-----+
  |  LLM     |  OpenAI (gpt-4o-mini) primary
  |  CALL    |  Gemini 2.5 Flash Lite backup
  |          |  Groq Llama 3.3 70B fallback
  |          |  AMINA fine-tuned (vLLM, optional)
  |          |  Mistral (optional)
  +----+-----+
       |
       v
  +----+------+
  | POST-LLM  |  1. Safety validation (contract or LLM review)
  | PIPELINE   |  2. Greeting stripping
  |            |  3. Sentence-boundary trimming
  |            |  4. Citation extraction
  |            |  5. Density compression (optional)
  |            |  6. Conversational pacing (optional)
  |            |  7. Translation (EN -> Mandinka if needed)
  +------------+
       |
       v
    Response
```

### 5.2 Tool Registry (22 tools)

| Tool | Category | Purpose |
|------|----------|---------|
| `KnowledgeTool` | Knowledge | WHO document retrieval + vector RAG |
| `search_knowledge` | Knowledge | Parallel evidence search |
| `TriageTool` | Clinical | Symptom severity (RED/YELLOW/GREEN) |
| `EmergencyTool` | Clinical | Crisis detection -> call 199 |
| `VitalsTool` | Clinical | Record BP/glucose/weight trends |
| `CVDRiskTool` | Clinical | WHO cardiovascular risk scoring |
| `WHODiabetesTool` | Protocol | WHO diabetes management |
| `WHOHypertensionTool` | Protocol | WHO hypertension management |
| `WHORespiratoryTool` | Protocol | WHO respiratory management |
| `WHOCancerScreeningTool` | Protocol | WHO cancer screening |
| `WHOLifestyleTool` | Protocol | WHO lifestyle counseling |
| `PatientTool` | Management | Load patient profile from ArcadeDB |
| `SaveConsultationTool` | Management | Persist consultation to Tier 2 |
| `ReferralTool` | Management | Facility referral lookup |
| `FollowupTool` | Management | Schedule next appointment |
| `MedicationTool` | Guidance | Drug info, interactions, side effects |
| `DietTool` | Guidance | Gambian food guidance (benachin, domoda) |
| `CarePlanTool` | Guidance | Generate multi-week care plan |
| `PrescriptionTool` | Guidance | Medication upload/parsing |
| `LifestyleNudgesTool` | Behavioral | Gamified daily behavior nudges |
| `CommunitySupportTool` | Behavioral | Cultural barriers (cost/stigma) |
| `CulturalTool` | Behavioral | Mandinka/Wolof cultural patterns |
| `RamadanTool` | Behavioral | Fasting-aware medication schedules |

### 5.3 Four-Layer Router

```
  User message
       |
  Layer 0: Deterministic filters (<1ms)
       |   Emergency keywords -> EMERGENCY
       |   Goodbye phrases -> FAREWELL
       |   Short acks ("ok", "hmm") -> CONTINUATION
       |
  Layer 1: LLM Stance Classifier (Gemini Flash Lite)
       |   Classifies into 9 stances:
       |   clinical_question, emotional_disclosure, social_ritual,
       |   lifestyle_inquiry, medication_concern, caregiver_query,
       |   ambiguous_needs_clarification, topic_shift, continuation
       |
  Layer 2: Stance -> Tool Suppression Mapping
       |   emotional_disclosure -> suppress clinical tools
       |   ambiguous -> suppress all tools, ask clarifying question
       |   social_ritual -> suppress all, return greeting
       |
  Layer 3: Knowledge-Graph Safety Check
       |   Emergency patterns override all suppression
       |   Cultural idiom shifting
       |
       v
  Route decision (compatible with legacy intent_router shape)
```

---

## 6. Memory Architecture

### 6.1 Three-Tier Memory System

```
  +--------------------------------------------------+
  |  Tier 1: WORKING MEMORY (Redis, 24h TTL)         |
  |                                                    |
  |  session:{sid}           -> messages (cap 20)      |
  |  vitals:{sid}:{type}     -> BP/glucose list        |
  |  ritual:{sid}            -> greeting phase (0-3)   |
  |  ethnic:{sid}            -> detected language       |
  |  stats:{sid}             -> interaction counts      |
  |  patient:{pid}:active    -> current session link    |
  +--------------------------------------------------+
                      |
                      | compact when > 75% token budget
                      v
  +--------------------------------------------------+
  |  Tier 2: EPISODIC MEMORY (ArcadeDB)              |
  |                                                    |
  |  ConsultationRecord vertex:                        |
  |    session_id, patient_id, messages[], symptoms[], |
  |    triage_level, tools_used[], created_at          |
  |  Linked to PatientVertex via CONSULTED edge        |
  +--------------------------------------------------+
                      |
                      | fact extraction + embedding
                      v
  +--------------------------------------------------+
  |  Tier 3: SEMANTIC MEMORY (ArcadeDB + Vectors)    |
  |                                                    |
  |  384-dim sentence-transformer embeddings           |
  |  Cosine similarity search for relevant history     |
  |  ClinicalStateSnapshot: structured patient facts   |
  +--------------------------------------------------+
```

### 6.2 Context Compaction

Triggered when session tokens exceed 75% of the model's budget:

```
  Trigger: token_count > 0.75 * model_budget
       |
  1. Summarizer cascade: Gemini 2.5 Flash Lite -> Groq -> GPT-4o-mini
  2. Fold existing summary into new summary
  3. Trim Redis session messages (keep last 4 turns)
  4. Persist CompactionSummary to ArcadeDB audit trail
  5. Hard limit at 90%: force-truncate if summarizer fails
```

**Per-model token budgets:**
| Model | Budget |
|-------|--------|
| AMINA fine-tuned | 20,000 |
| Gemini | 22,000 |
| Base (GPT-4o-mini) | 18,000 |
| Groq / Mistral | 10,000 |

---

## 7. RAG Pipeline

### 7.1 Document Ingestion (dataprep-worker)

```
  PDF / Markdown / Text
       |
  DocumentLoader (PDF -> text extraction)
       |
  Chunker (recursive, 512 tokens, 50 overlap)
       |
  SentenceTransformer Embedder (384-dim, all-MiniLM-L6-v2)
       |
  ArcadeDB Writer (chunks vertex + vector index)
       |
  Graph Enrichment (entity extraction, label tagging)
```

**Current state:** 721 chunks ingested in ArcadeDB `genie` database.

### 7.2 Retrieval

Two-path hybrid retrieval with reciprocal rank fusion:

```
  User query
       |
       +----> ArcadeDB Vector Retriever (cosine similarity, top-k)
       |          |
       +----> ArcadeDB Keyword Retriever (Lucene full-text)
       |          |
       +----------+
       |
  Reciprocal Rank Fusion (merge + deduplicate)
       |
  Label-based filtering (CONTAINSANY)
       |
  Top-k documents -> injected into LLM context
```

---

## 8. Voice Pipeline

### 8.1 Speech-to-Text (STT)

```
  Browser MediaRecorder (WebM/Opus)
       |
  Frontend sttCall() -> POST /api/v1/stt (FormData)
       |
  Backend: ffmpeg normalize (16kHz mono WAV)
       |
  Whisper.cpp container: /inference endpoint
       |   Model: ggml-small.en.bin (12 layers, 244MB)
       |
  JSON { "text": "transcribed text" }
```

### 8.2 Text-to-Speech (TTS)

```
  Text response
       |
  Language detection
       |
  English -----> Piper TTS (en_US-lessac-medium.onnx) -> WAV
  Mandinka ----> MMS TTS (mms-tts-mnk, Facebook) -> WAV
```

### 8.3 Full Voice Chat Flow

```
  Audio blob -> POST /api/v1/agent/voice-chat
       |
  1. STT (Whisper) -> transcript
  2. Agent pipeline -> response text
  3. TTS (Piper/MMS) -> audio WAV
       |
  JSON { transcript, response, has_audio, triage_level }
```

---

## 9. Translation Pipeline

### 9.1 Current (v1)

Single LLM call with basic prompt. Backend: GPT-4o-mini (default) or Gemma.
Redis cache with 30-day TTL, keyed by backend.
Mandinka detection via calibrated logistic model (diacritics + lexical + English ratio).

### 9.2 Translation v2 (Scaffold)

Multi-provider architecture (OpenAI, NLLB, Gemma) with:
- Glossary service (160+ clinical terms)
- Translation memory
- Quality estimation
- PII detection
- Post-processing (diacritic preservation, artifact stripping)

Gated by `USE_V2_*` flags. Currently inactive.

### 9.3 Translation v3 (Staged, not deployed)

Three-stage pipeline for high-quality Mandinka:

```
  English input
       |
  Stage 1: SIMPLIFY
       |   Rewrite to simple medical language (max 12 words/sentence)
       |   Strip jargon, preserve med names
       |
  Stage 2: TRANSLATE with grounding
       |   Mandinka grammar reference (SOV, verb system, postpositions)
       |   160-term clinical glossary
       |   20 parallel EN->MNK sentence pairs (few-shot)
       |   Rule: only use glossary words, keep English if unknown
       |
  Stage 3: VERIFY via back-translation
       |   Back-translate MNK -> EN
       |   Score: meaning (0-10), safety (0-10)
       |   Verdict: pass / review / fail
       |
  Clinical safety layer (planned):
       Content classifier (CRITICAL/SENSITIVE/GENERAL)
       Numeric preservation guard (regex)
       Medication name guard
       Emergency bilingual enforcer
       Stratified verification thresholds
```

---

## 10. Safety Architecture

### 10.1 Pre-Generation Safety

| Layer | Method | Latency |
|-------|--------|---------|
| Medication gate | Keyword classifier, blocks dosage recs | <2ms |
| Emergency detector | Keyword match (chest pain, seizure, etc.) | <1ms |
| Preemptive constraints | Injected into LLM prompt before generation | 0ms |

### 10.2 Post-Generation Safety

| Layer | Method | Action on fail |
|-------|--------|----------------|
| Safety contract | Deterministic: med refs, emergency protocol, clinical ranges, harm patterns | Fail-CLOSED, regenerate with constraints |
| Safety consensus | Two-model voting (fingerprint + auditor) | Disagree -> refusal template |
| Medication audit | Log every med-related query to Redis | Audit trail (90-day retention) |

### 10.3 Safety Contract Checks

1. **Medication safety** — flags unsolicited prescriptions without safe context
2. **Emergency protocol** — response MUST include 199/EFSTH if emergency keywords detected
3. **Clinical numbers** — BP, glucose, temp, heart rate must be in valid ranges
4. **Harm patterns** — blacklisted phrases ("stop taking medication", "don't visit doctor")

---

## 11. Feature Flags

All default OFF, toggled via environment variables:

| Flag | Purpose |
|------|---------|
| `USE_SAFETY_CONTRACT` | Deterministic validation vs LLM safety review |
| `USE_FOUR_LAYER_ROUTER` | 4-layer routing vs legacy intent router |
| `USE_INTENT_ROUTER` | 9-intent structural decomposition |
| `USE_LLM_TOOL_ROUTER` | LLM-based tool selection vs keyword-only |
| `USE_DIALOGUE_STATE_TRACKER` | Persistent per-turn dialogue state |
| `USE_STRUCTURED_COMPACTION` | Extract-and-update vs text summaries |
| `USE_DENSITY_COMPRESSION` | Strip filler, enforce density budget |
| `USE_CONVERSATIONAL_PACER` | Paced multi-turn (max 3 sentences) |
| `USE_LLM_INTENT_EXTRACTION` | Structured intent extraction vs keyword |
| `USE_RESPONSE_SHAPE_DECISION` | Model chooses response shape |
| `USE_INTENT_LEARNER` | Intent correction + learning loop |
| `USE_INTENT_PATTERN_GRAPH` | Knowledge graph for intent patterns |
| `USE_FINETUNED_MODEL` | Route to AMINA fine-tuned vLLM |
| `USE_V3_TRANSLATOR` | Three-stage Mandinka translation (planned) |

---

## 12. Data Architecture

### 12.1 ArcadeDB (Graph + Vector)

**Database:** `genie`

Key vertex types:
| Type | Purpose |
|------|---------|
| `chunks` | RAG document chunks (721 ingested) |
| `CaregiverVertex` | Caregiver profiles |
| `CaregiverPatientEdge` | Caregiver-patient linkage |
| `ClinicalInsight` | Extracted clinical insights |
| `ClinicalStateSnapshot` | Structured patient state |
| `CompactionSummary` | Memory compaction audit trail |
| `CommunityData` | Community-level aggregates |
| `Consultation` | Consultation records |
| `ConsentAuditVertex` | Data consent audit |
| `DHIS2AuditVertex` | DHIS2 sync audit |
| `DialogueStateSnapshot` | Per-turn dialogue state |

### 12.2 Redis (Session Cache)

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `session:{sid}` | Working memory (messages, context) | 24h |
| `vitals:{sid}:{type}` | BP/glucose/weight readings | 24h |
| `ritual:{sid}` | Greeting phase tracker | 24h |
| `cg_conv:{cg}:{pt}` | Caregiver conversation state | 24h |
| `translate:{backend}:{hash}` | Translation cache | 30 days |
| `medication_audit:{sid}` | Medication query audit log | 90 days |
| `medication_audit:recent` | Global recent audit stream | Rolling 1000 |
| `lora:summary:{sid}` | Compaction summaries (legacy) | 7 days |

---

## 13. External Integrations

| System | Protocol | Purpose |
|--------|----------|---------|
| **DHIS2** | REST API | Daily aggregate push (consultations, NCD metrics, triage) |
| **Twilio** | SMS API | OTP verification, caregiver alerts |
| **TextBelt** | SMS API | Fallback OTP provider |
| **Africa's Talking** | SMS API | Regional SMS delivery |
| **Google OAuth** | OAuth 2.0 | Social login |
| **Facebook** | OAuth 2.0 | Social login |
| **Telegram** | Bot API | Multi-channel messaging |

---

## 14. LLM Model Configuration

| Model | Role | Context | Cost |
|-------|------|---------|------|
| **GPT-4o-mini** | Primary (default) | 128K | Pay-per-token |
| **Gemini 2.5 Flash Lite** | Backup, compaction, stance classifier | 1M | Free tier |
| **Groq Llama 3.3 70B** | Fallback when Gemini rate-limited | 128K | Free tier |
| **AMINA fine-tuned** (vLLM) | Optional, A40 GPU via Tailscale | 32K | Self-hosted |
| **Mistral 7B** | Optional free-credits tier | 32K | Free credits |

Model cascade on failure: GPT-4o-mini -> Gemini -> Groq -> Mistral

---

## 15. Security

- **Authentication:** Phone+PIN signup, JWT tokens (7-day expiry), OTP via SMS
- **Authorization:** Bearer tokens per role (patient, caregiver, admin)
- **CORS:** Explicit origin allowlist (localhost:5173-5175)
- **Credentials:** `allow_credentials=True` with explicit origins
- **Medication gate:** Pre-LLM blocking of unsolicited prescriptions
- **Safety contract:** Post-LLM deterministic validation, fail-CLOSED
- **Audit logging:** All medication queries logged to Redis (90-day retention)
- **Data consent:** Explicit opt-in for training data collection
- **PII detection:** Translation v2 includes PII stripping before LLM calls
