# AMINA Care — Comprehensive Architecture Overview

## System Architecture Graph

```
                                    ┌─────────────────────────┐
                                    │      Patient / CHW      │
                                    │   (Browser / Mobile)    │
                                    └────────────┬────────────┘
                                                 │
                                    Voice / Text / SMS / WhatsApp
                                                 │
                              ┌──────────────────▼──────────────────┐
                              │         React Frontend (Vite)       │
                              │        :5173  /  :5174              │
                              │                                     │
                              │  ┌───────────┐  ┌───────────────┐  │
                              │  │ Patient    │  │ Admin Console │  │
                              │  │ Chat UI    │  │ (AdminShell)  │  │
                              │  │ + Sidebar  │  │               │  │
                              │  └─────┬──────┘  └──────┬────────┘  │
                              │        │                │           │
                              │  ┌─────┴────────────────┴────────┐ │
                              │  │  Session Registry / Role Mgr  │ │
                              │  │  (localStorage + JWT slots)   │ │
                              │  └───────────────┬───────────────┘ │
                              └──────────────────┼─────────────────┘
                                                 │
                                    POST /api/v1/agent/chat
                                    + /auth  /community  /admin
                                    + /caregiver  /care  /consent
                                                 │
                 ┌───────────────────────────────▼────────────────────────────────┐
                 │                                                               │
                 │              HAYSTACK-CHATQNA  (FastAPI :8000)                 │
                 │              4 Uvicorn Workers  ·  GPU-enabled                 │
                 │                                                               │
                 │  ┌─────────────────────────────────────────────────────────┐   │
                 │  │                    API Router Chain                     │   │
                 │  │  main → guard → training → literacy → inbox →          │   │
                 │  │  resilience → gap_closers → dhis2 → supply_ledger →   │   │
                 │  │  dualpath → caregiver_notify → emergency →            │   │
                 │  │  intent_review → translation_v2 → tts_fix             │   │
                 │  │  (15 entry-point modules, additive chain)             │   │
                 │  └────────────────────────┬────────────────────────────────┘   │
                 │                           │                                   │
                 │  ┌────────────────────────▼────────────────────────────────┐   │
                 │  │                   AMINA AGENT                           │   │
                 │  │                  (Singleton)                            │   │
                 │  │                                                        │   │
                 │  │   ┌──────────────────────────────────────────────┐     │   │
                 │  │   │  LAYER 0 — Deterministic Pre-LLM (~5ms)     │     │   │
                 │  │   │  • Emergency keyword scan (20+ phrases)     │     │   │
                 │  │   │  • Patient identity resolution (ArcadeDB)   │     │   │
                 │  │   │  • Greeting ritual (Mandinka cultural)      │     │   │
                 │  │   │  • Vitals regex extraction + trend compare  │     │   │
                 │  │   │  • Medication safety gate (block if needed) │     │   │
                 │  │   │  • Trust tier (stranger→family by history)  │     │   │
                 │  │   │  • Journey callbacks (30/90/180/365-day)    │     │   │
                 │  │   │  • Chat export intent (PDF shortcut)        │     │   │
                 │  │   └──────────────────────┬───────────────────────┘     │   │
                 │  │                          │                             │   │
                 │  │   ┌──────────────────────▼───────────────────────┐     │   │
                 │  │   │  FOUR-LAYER NEURO-SYMBOLIC ROUTER            │     │   │
                 │  │   │                                              │     │   │
                 │  │   │  L0: Deterministic (regex/keyword + learn)   │     │   │
                 │  │   │  L1: LLM Stance Classifier (9 stances)      │     │   │
                 │  │   │  L2: Stance → Tool Suppression Map           │     │   │
                 │  │   │  L3: Redis Knowledge Graph (221 nodes)       │     │   │
                 │  │   │      emergency · drug · cultural · disambig  │     │   │
                 │  │   └──────────────────────┬───────────────────────┘     │   │
                 │  │                          │                             │   │
                 │  │   ┌──────────────────────▼───────────────────────┐     │   │
                 │  │   │  TOOL ORCHESTRATION (max 3 parallel)         │     │   │
                 │  │   │                                              │     │   │
                 │  │   │  record_vitals · manage_diabetes ·           │     │   │
                 │  │   │  assess_triage · search_knowledge (RAG) ·    │     │   │
                 │  │   │  find_facility · get_diet_advice ·           │     │   │
                 │  │   │  screen_cancer · check_emergency ·           │     │   │
                 │  │   │  ... (22 health tools)                       │     │   │
                 │  │   └──────────────────────┬───────────────────────┘     │   │
                 │  │                          │                             │   │
                 │  │   ┌──────────────────────▼───────────────────────┐     │   │
                 │  │   │  SINGLE LLM CALL                             │     │   │
                 │  │   │                                              │     │   │
                 │  │   │  System prompt + Patient context +           │     │   │
                 │  │   │  Tool observations + RAG evidence +          │     │   │
                 │  │   │  Conversation history (budget-trimmed)       │     │   │
                 │  │   │                                              │     │   │
                 │  │   │  Overflow Guard: pre-trim + retry            │     │   │
                 │  │   │  Model Cascade: AMINA→Gemini→GPT→Groq       │     │   │
                 │  │   └──────────────────────┬───────────────────────┘     │   │
                 │  │                          │                             │   │
                 │  │   ┌──────────────────────▼───────────────────────┐     │   │
                 │  │   │  POST-LLM PIPELINE                           │     │   │
                 │  │   │  • Safety contract validation (4 checks)    │     │   │
                 │  │   │  • Density compression (strip filler)        │     │   │
                 │  │   │  • Conversational pacer (turn shaping)       │     │   │
                 │  │   │  • Mandinka translation (if needed)          │     │   │
                 │  │   │  • Persist → Redis + ArcadeDB                │     │   │
                 │  │   │  • Async: self-learning + intent review      │     │   │
                 │  │   └──────────────────────────────────────────────┘     │   │
                 │  └────────────────────────────────────────────────────────┘   │
                 │                                                               │
                 │  ┌────────────────────────────────────────────────────────┐   │
                 │  │                   78 SERVICE MODULES                    │   │
                 │  │                                                        │   │
                 │  │  Clinical: safety_contract · clinical_scoring ·        │   │
                 │  │    clinical_pipeline · care_gap_detector               │   │
                 │  │  Predictive: predictive_engine (CRI) ·                │   │
                 │  │    burnout_monitor · outcome_tracker                   │   │
                 │  │  Caregiver: caregiver_amina_service (6-dim intel) ·   │   │
                 │  │    caregiver_inbox · caregiver_application             │   │
                 │  │  Integration: dhis2_sync · dhis2_tracker ·            │   │
                 │  │    fhir_mapper · phi_deid · icd10_coder               │   │
                 │  │  NLP: translator · translation_v2 · stance_classifier │   │
                 │  │    four_layer_router · intent_pattern_graph            │   │
                 │  │  Memory: memory_manager · context_compactor ·         │   │
                 │  │    conversation_pacer · density_compressor             │   │
                 │  │  Community: bantaba · village · scouts                 │   │
                 │  │  Auth: auth · consent · training_consent · literacy    │   │
                 │  └────────────────────────────────────────────────────────┘   │
                 │                                                               │
                 └───────┬──────────────────┬──────────────────┬─────────────────┘
                         │                  │                  │
            ┌────────────▼───┐    ┌────────▼────────┐   ┌────▼──────────────┐
            │   ArcadeDB     │    │     Redis        │   │  Voice Services   │
            │   :2480        │    │     :6379        │   │                   │
            │                │    │                  │   │  Whisper STT      │
            │ ┌────────────┐ │    │ ┌──────────────┐ │   │  :8087            │
            │ │Tier 2      │ │    │ │Tier 1        │ │   │  (audio→text)     │
            │ │Episodic    │ │    │ │Working Memory│ │   │                   │
            │ │            │ │    │ │              │ │   │  Piper TTS (EN)   │
            │ │PatientVtx  │ │    │ │session:*     │ │   │  :5500            │
            │ │Consultation│ │    │ │stats:*       │ │   │  (text→speech)    │
            │ │CaregiverVtx│ │    │ │vitals:*      │ │   │                   │
            │ │ClinicalSnap│ │    │ │ritual:*      │ │   │  MMS TTS (MNK)   │
            │ │InboxItem   │ │    │ │careplan:*    │ │   │  :5501            │
            │ │DHIS2Referral││    │ │bantaba:*     │ │   │  (Mandinka voice) │
            │ └────────────┘ │    │ │stance:*      │ │   │                   │
            │ ┌────────────┐ │    │ │ipg:*         │ │   └───────────────────┘
            │ │Tier 3      │ │    │ │cg_conv:*     │ │
            │ │Semantic    │ │    │ │cg_alert:*    │ │   ┌───────────────────┐
            │ │            │ │    │ │transfer:*    │ │   │  External LLMs    │
            │ │chunks      │ │    │ │feedback:*    │ │   │                   │
            │ │(384d vecs) │ │    │ │cri:*         │ │   │  AMINA LoRA/vLLM  │
            │ │MemoryVtx   │ │    │ └──────────────┘ │   │  Gemini Flash     │
            │ │LiteracyProf│ │    │                  │   │  GPT-4o / mini    │
            │ └────────────┘ │    │  TTL: 24h sess   │   │  Groq Llama 3.3   │
            │                │    │  7d care plans    │   │  Mistral 7B       │
            │  Permanent     │    │  Ephemeral        │   └───────────────────┘
            └────────────────┘    └──────────────────┘
                                                         ┌───────────────────┐
            ┌────────────────┐                           │  Multichannel     │
            │ Apache Superset│                           │  Access :8020     │
            │ :8080          │                           │  (Telegram, SMS,  │
            │ (BI dashboards)│                           │   WhatsApp)       │
            └────────────────┘                           └───────────────────┘
```

---

## 1. Infrastructure & Docker Services

AMINA Care runs as **9 Docker containers** on a single `chatqna_default` network, orchestrated via `docker-compose.yml`:

| Container | Image | Ports | Role |
|---|---|---|---|
| `haystack-chatqna` | Custom FastAPI build | 8000 | Core backend — agent, API, all business logic |
| `arcadedb` | `arcadedata/arcadedb:latest` | 2480, 2424, 5433 | Graph + document + vector database |
| `redis` | `redis:7-alpine` | 6379 (internal) | Working memory, caches, pub/sub state |
| `voice-stt` | `ghcr.io/ggml-org/whisper.cpp:main` | 8087 | Speech-to-text (English, ggml-base.en) |
| `voice-tts` | Custom Piper build | 5500 | Text-to-speech English (lessac-medium) |
| `voice-tts-mnk` | Custom MMS build | 5501 | Text-to-speech Mandinka (facebook/mms-tts-mnk) |
| `dataprep-worker` | Custom build | 8001 | Document ingestion & chunking for RAG |
| `amina-superset` | Custom Apache Superset | 8080 | BI dashboards over ArcadeDB (via Postgres protocol) |
| `multichannel-access` | Custom Express/Gateway | 8020 | Telegram bot, SMS gateway, WhatsApp bridge |

All services share bind-mounted `./data/` volumes for persistence. ArcadeDB exposes port 5432 via Postgres wire protocol for Superset queries.

---

## 2. Backend — Entry-Point Chain & API Surface

Instead of a traditional router file, the backend uses an **additive entry-point chain** — each `main_with_*.py` module imports the previous one, adds its router, and re-exports the app. The final entry point transitively includes all routers:

```
main.py
 └→ main_with_guard.py               (overflow guard middleware)
     └→ main_with_training.py         (training consent routes)
         └→ main_with_literacy.py      (literacy service routes)
             └→ main_with_inbox.py     (caregiver inbox)
                 └→ main_with_resilience.py  (resilient chat with auto-fallback)
                     └→ main_with_gap_closers.py  (safety consensus + gap surfaces)
                         └→ main_with_intent_review.py  (intent miss review)
                             └→ main_with_emergency.py     (emergency alerts)
                                 └→ main_with_caregiver_notify.py  (caregiver notifications)
                                     └→ main_with_dualpath_ledger.py  (traditional+modern medicine)
                                         └→ main_with_supply_ledger.py  (medicine supply tracking)
                                             └→ main_with_dhis2_history.py  (DHIS2 audit logs)
                                                 └→ main_with_translation_v2.py  (v2 translation)
                                                     └→ main_with_tts_mandinka_fix.py  (TTS robustness)
```

This produces **200+ API endpoints** across 35+ route files covering:

- **Agent**: `/api/v1/agent/chat`, `/chat-resilient`, `/feedback`, `/translate`, `/stt`, `/tts`, `/prescription`
- **Auth**: `/api/v1/auth/login`, `/signup`, `/otp`, `/admin/login`, `/caregiver/login`, `/password-reset`
- **Patient**: `/api/v1/agent/patients/{id}/history`, `/profile`, `/transfer-request`
- **Caregiver**: `/api/v1/caregiver/patients`, `/alert/send`, `/inbox`, `/application`, `/insights`
- **Care**: `/api/v1/care/dualpath_ledger/{sid}`, `/supply_ledger/{sid}`
- **Community**: `/api/v1/community/bantaba`, `/village`, `/scouts`
- **Admin**: `/api/v1/admin/mv/command-center`, `/patients`, `/consultations`, `/caregivers`, `/service-health`
- **Literacy**: `/api/v1/literacy/me`, `/me/declare`, `/me/certificate`, `/admin/queue`
- **Consent**: `/api/v1/consent/me`, `/training/consent/me`
- **DHIS2**: `/api/v1/dhis2/push`, `/tracker/push`, `/aggregate/audit`
- **Emergency**: `/api/v1/emergency/alert`
- **Intent**: `/api/v1/intent-review/suspected-misses`, `/corrections`
- **Translation v2**: `/api/v2/agent/translate`, `/translate/batch`

---

## 3. AMINA Agent — Core Processing Pipeline

The `AminaAgent` singleton (~2,350 lines) processes every patient message through a strict pipeline. Each step either resolves the message immediately (zero LLM cost) or enriches context for the single downstream LLM call.

### Step 0 — Pre-LLM Deterministic Pipeline (~5ms)

Before any model is invoked, the system runs seven deterministic checks:

1. **Chat export detection**: Regex shortcut for "export my chat" / "download PDF" — generates a PDF and returns immediately.
2. **Emergency keyword scan**: Matches against 20+ phrases (chest pain, seizure, suicide, bleeding, can't breathe). On match, calls the `check_emergency` tool and returns a `triage_level=EMERGENCY` response with no LLM call.
3. **Patient identity resolution**: Extracts `patient_id` from `session_id` format `s_P_<NAME>_...`, loads full profile from ArcadeDB's `PatientVertex` graph (conditions, medications, allergies, bp/glucose history).
4. **Greeting ritual**: Builds culturally-appropriate greetings based on time of day, the patient's ethnic language preference, and trust tier — a deterministic progression from stranger → acquaintance → companion → family, computed from interaction count and days since first contact. For voice/SMS channels, a three-phase Mandinka greeting ritual runs entirely from templates.
5. **Vitals extraction**: Regex-parses blood pressure (e.g. `160/100`), glucose, weight, temperature, and heart rate from the message. Records to Redis, compares against historical trends, and triggers `track_outcome()` asynchronously.
6. **Medication safety gate**: `MedicationSafetyGate.classify()` blocks dangerous dosage requests, drug interaction risks, and unsafe medication changes without ever calling an LLM. Actions: `ALLOW`, `BLOCK`, `BLOCK_WITH_FIRST_AID`.
7. **Journey callbacks**: Detects 30, 90, 180, and 365-day patient milestones and injects celebratory context.

### Step 1 — Four-Layer Neuro-Symbolic Router

The classified message passes through four routing layers:

**L0 — Deterministic filter** (<1ms): Catches emergencies, goodbyes, and short acknowledgments via regex/keyword. Also checks learned corrections from the intent learner database. Returns immediately on match.

**L1 — Conversational stance classifier**: Sends the message to Gemini Flash Lite to classify into one of **9 stances**: `social_ritual`, `emotional_disclosure`, `followup_continuation`, `ambiguous_needs_clarification`, `vitals_report`, `clinical_question`, `information_seeking`, `family_carer_concern`, `medication_question`. Each carries confidence score, urgency level, and formality register. Currently runs in **shadow mode** — logging but deferring to L0 until validated.

**L2 — Tool suppression map**: Maps stance to suppressed tools. Social rituals suppress all clinical tools (no blood pressure check for "salaam alaikum"). Emotional disclosures suppress clinical tools but not triage. Ambiguous messages suppress ALL tools until clarified. Clinical stances allow everything.

**L3 — Knowledge graph safety check**: Queries the Redis-backed Intent Pattern Graph (221 nodes across `emergency`, `drug`, `cultural`, `disambiguator` categories). If the graph recognizes "jatoo la karoo" as a Mandinka idiom for bodily suffering, it overrides the stance to clinical. Cultural greetings override to social ritual regardless of LLM classification. Emergency patterns override everything unconditionally.

### Step 2 — Tool Orchestration

The agent selects up to **3 tools** from a library of **22 health-domain tools** via keyword matching against the message:

| Tool | Purpose |
|---|---|
| `search_knowledge` | RAG search against NCD health guidelines (384-dim vectors) |
| `assess_triage` | Symptom → SELF_CARE / CHW_VISIT / FACILITY / EMERGENCY |
| `find_facility` | Locate nearest health facility by region and care level |
| `get_medication_info` | Medication schedules and Ramadan-adjusted timing |
| `get_diet_advice` | Culturally-appropriate Gambian dietary advice for NCDs |
| `check_emergency` | Emergency detection + response protocol |
| `get_patient` | Retrieve full patient profile and history |
| `save_consultation` | Persist consultation record to ArcadeDB |
| `get_cultural_greeting` | Mandinka/Gambian greeting generation |
| `schedule_followup` | Schedule follow-up based on triage + condition |
| `record_vitals` | Record BP/glucose/weight with safe-range checking |
| `generate_care_plan` | Personalised NCD care plan generation |
| `check_ramadan` | Ramadan status + fasting-safe medication guidance |
| `assess_cvd_risk` | Cardiovascular risk assessment (WHO charts) |
| `manage_diabetes` | WHO PEN diabetes protocol |
| `manage_hypertension` | WHO PEN hypertension protocol |
| `assess_respiratory` | Asthma/COPD assessment |
| `screen_cancer` | Cervical cancer screening guidance |
| `counsel_lifestyle` | Lifestyle counselling (smoking, exercise, sleep) |
| `analyze_prescription` | OCR prescription image → medication guidance |
| `get_lifestyle_nudge` | One-Spoon Swap micro-action nudge |
| `suggest_community_support` | Route to Imam/Alkalo/elder/CHW for access barriers |

Tools execute concurrently via `asyncio.gather()`. For messages longer than 4 words, a parallel RAG search also runs against ArcadeDB's vector-indexed `chunks` table.

### Step 3 — Single LLM Call

A unified prompt is constructed from: system persona + patient clinical context + tool observations + RAG evidence + conversation history (budget-trimmed). **Model-specific budgets**:

| Model | Input chars | Output tokens | History turns |
|---|---|---|---|
| AMINA LoRA (vLLM) | 20,000 | 900 | 6 |
| Gemini Flash | 22,000 | 800+ | 6 |
| GPT-4o mini | 18,000 | dynamic | 6 |
| Groq / Mistral | 10,000 | 500 | 4 |

The **overflow guard** pre-trims the oldest conversation turns before sending and retries with progressively shorter context if the model returns a context-length error. The **model cascade** tries the preferred model first (AMINA LoRA if `USE_FINETUNED_MODEL=true`, else Gemini), falling through GPT-4o mini → Groq → Mistral on failure. An inline auto-continuation loop (up to 2 rounds) handles truncated outputs.

### Step 4 — Post-LLM Pipeline

After the LLM responds, six post-processing steps run:

1. **Greeting fragment strip**: Removes leaked greetings (Salaam/Welcome) from LLM output that duplicates the pre-LLM greeting.
2. **Safety contract validation** (4 deterministic checks, zero LLM cost):
   - *Medication safety*: Flags unknown medications and specific dosages not in patient's prescriptions
   - *Emergency protocol*: Verifies emergency messages get emergency-appropriate responses (mentioning 199, hospital, ambulance)
   - *Clinical number ranges*: Validates BP (60–250/30–150), glucose (20–600), temp (35–42), HR (30–220), BMI (10–60)
   - *Harm pattern blacklist*: 8 regex patterns blocking "stop taking your medication", "you don't need a doctor", etc.
3. **Density compression**: Strips filler phrases and enforces length limits.
4. **Conversational pacer**: Turn-appropriate length shaping — short acknowledgments get short replies; clinical questions get detailed ones.
5. **Mandinka translation**: If patient's language preference is Mandinka, translates the response via the translation service.
6. **Persistence**: Writes to Redis (Tier 1, 24h TTL) and ArcadeDB (Tier 2, permanent `ConsultationRecord`). Background tasks asynchronously log for the self-learning system, extract clinical insights, check for intent classification misses, and bump DHIS2 daily counters.

---

## 4. Three-Tier Memory Architecture

### Tier 1 — Redis Working Memory (ephemeral)
Fast-access session state with TTL-based expiry:

| Key Pattern | TTL | Purpose |
|---|---|---|
| `session:{session_id}` | 24h | Full conversation messages (capped 20) |
| `vitals:{session_id}:{type}` | 6 months | Per-session vital readings (capped 20) |
| `careplan:{session_id}` | 7 days | Generated care plans |
| `stats:{session_id}` | 365 days | Patient stats blob |
| `ritual:{session_id}` | 24h | Greeting ritual phase tracker |
| `stance:last:{session_id}` | 24h | Most recent stance classification |
| `cri:{patient_id}` | 6h | Cached Composite Risk Index score |
| `cg_conv:{cg_id}:{pt_id}` | 24h | Caregiver conversation state (24 turns max) |
| `ipg:{category}:{pattern}` | persistent | Intent Pattern Graph nodes (221 total) |

### Tier 2 — ArcadeDB Episodic Memory (permanent)
Graph-structured patient records with full SQL + graph traversal:

- **PatientVertex**: Demographics, conditions, medications, allergies, vitals history, consent, behavior profile
- **ConsultationRecord**: Session transcripts, summaries, triage levels, tools used, recommendations
- **CaregiverVertex**: Profile, specialization, region, languages
- **ClinicalStateSnapshot**: Structured clinical state per session
- **InboxItemVertex**: Notification records per patient
- **DHIS2ReferralVertex**: Referral tracking with TEI/event UIDs
- **IntentClassificationLog / Correction / SuspectedMiss**: Self-learning system records

Linked via graph edges: `HasConsultation`, `HasMemory`, `CaregiverPatientEdge`, `HasCompaction`.

### Tier 3 — ArcadeDB Semantic Memory (vector-indexed)
384-dimensional sentence-transformer embeddings for RAG:

- **chunks**: Health guideline knowledge base — vector-indexed (COSINE, LSM_TREE_VECTOR), full-text indexed. Source documents chunked by `dataprep-worker`.
- **MemoryVertex**: Patient-specific semantic memories (key facts, clinical insights).

---

## 5. Literacy Mode System

AMINA adapts its entire UI based on the patient's education level, mapped to three shells:

| Education Level | Literacy Mode | Shell | Features |
|---|---|---|---|
| Never attended / Lower basic | `beginner` | BeginnerShell | Simplified UI, large tiles, minimal text, full voice support |
| Upper basic | `basic` | BasicShell | Intermediate density, topic browsing, SOS FAB, Dual-Path Care |
| Senior secondary / Tertiary | `advanced` | App.jsx (default) | Full-featured dashboard with all clinical tools |

**Flow**: On first login, `EducationOnboardingGate` (z-index 10000) presents an education level selector. Certificate upload required for upper basic+. All users start in `beginner` until verified. The `LiteracyBootstrap` fetches `/api/v1/literacy/me` on every page load and mounts the appropriate shell.

**Admin verification queue**: `AdminLiteracyQueue` lets admins approve/reject education certificates, promoting patients from beginner to their declared level.

---

## 6. Caregiver Intelligence Pipeline

The caregiver system uses a **consent-first invite model** — patients must consent before a caregiver can access their data. The intelligence pipeline runs a **7-stage process** in `caregiver_amina_service.py`:

### Stages:
0. **Patient resolver**: Fuzzy name matching from caregiver free-text → DB lookup (resolves nicknames)
1. **Context builder**: Loads patient profile + consultations + behavior from Redis/ArcadeDB
2. **Info state extractor** (fast LLM call): Classifies 6 clinical dimensions as `unknown / partial / known`
3. **Deterministic decision engine**: `covered_count ≥ 4` → REPORT; else → QUESTION; if report already exists → FOLLOW-UP
4a. **Question generator**: Picks highest-priority gap dimension, generates one focused question
4b. **Report generator**: Full clinical briefing via `generate_soap_report()` (SOAP format)
4c. **Follow-up handler**: Concise Q&A with full patient context

### 6 Clinical Dimensions (threshold: 4 of 6 required for report):
1. Medication adherence — taking prescriptions regularly?
2. Current symptoms — new or worsening?
3. Caregiver concern — specific worry or focus?
4. Behavioral changes — sleep, appetite, mood, activity?
5. Recent events — missed appointments, illness, stress?
6. Functional status — managing daily activities?

State persisted in Redis: `cg_conv:{caregiver_id}:{patient_id}` (24h TTL, 24 turns max).

---

## 7. Admin Console

The AdminShell (`#/admin/console`) provides a full operational dashboard with 6 sections:

### Command Center
- **KPIs**: Active patients, consults today, active sessions, open emergencies
- **Triage distribution**: Donut chart (Emergency / Facility / CHW Visit / Stable)
- **30-day trend**: Consultation sparkline
- **Service health strip**: 9 services × status, latency, 7-day uptime %
- **Alert queue**: Real-time alert feed
- Auto-refreshes every 5 seconds from `/api/v1/admin/mv/command-center`

### People
- **Patient table**: Search, export, Patient 360 detail sheet (side-panel on row click)
- **Caregiver directory**: Manage CHW profiles and assignments
- **Literacy verification queue**: Approve/reject education certificates
- **Care transfers**: Review and approve transfer requests between caregivers

### Care Records
- Consultation logs with structured data views, tables, and charts

### Agent Lab
- **Models tab**: Calls/p50/p95/p99/error rate per model (amina, groq, mistral, gemini)
- **Tools tab**: Bar chart of tool invocations
- **Safety tab**: Safety-flag reasons, regeneration and downvote patterns
- **Training tab**: LoRA fine-tune candidate review with D3 charts

### Integrations
- DHIS2 sync configuration and status
- Live sync logs and tracker event mapping

### Governance
- Role and permission management
- Policy configuration

Additional admin features: **Command Palette** (Cmd-K) for fast navigation, legacy dashboard preserved for backward compatibility.

---

## 8. Government Observatory (National Health Dashboard)

A separate institutional-grade dashboard (`GovShell`) with paper-white design, scoped to aggregate data only — **no PII ever leaves the system**:

### National Pulse
KPI cards and monthly trend lines — anonymous reach, consultation volume, triage distribution.

### Regional Map
Geographic heatmap across The Gambia's 7 regions — patient density, triage severity, service utilization.

### Surveillance
Condition-level anomaly detection using 8-week rolling baseline with 2σ threshold. Flags unusual spikes in specific conditions or regions.

### WHO Indicators
Compliance tracking against WHO PEN/HEARTS frameworks and SDG3 targets.

### Network Health
CHW density per region, dropout risk scoring, response-time variance, workload distribution.

### Reports
Monthly aggregate digest generation — natural-language agent replay, decision logs, PDF export with digital signing. Print-friendly layout.

---

## 9. Community Features (Bantaba System)

### Health Circles (Bantaba)
Community health groups managed by Alkalos (village leaders):
- **Members tab**: Live adherence stats, grouped by On-track / Needs-support, per-member adherence slider
- **Highlights tab**: Weekly message history, new entry form
- **Settings tab**: Circle rename, ownership info
- Role-based access: Patients see own circle, Alkalos have full control, Admins impersonate Alkalo

Gambian-centered relation vocabulary: grandmother, grandfather, mother, father, sister, brother, aunt, uncle, cousin, spouse, co-wife, brother-in-law, sister-in-law.

### Village Scoreboard
5 health pillars scored per village:
1. **Screening** — community screening completion rate
2. **Adherence** — medication adherence across village
3. **Diet** — nutritional guidance compliance
4. **Youth** — youth health engagement
5. **Emergency** — emergency response readiness

Color-coded zones: green ≥80%, amber 50-79%, red <50%. Alkalo notes (capped at 10) for qualitative context.

### Scout Program
Youth health worker training pipeline:
- Alkalo-managed scout roster with badge, elder assignments, weekly BP logging missions
- Youth application workflow: apply → Alkalo approve/reject with reason
- Scout activities: elder visits, BP checks, health education

---

## 10. Dual-Path Care (Traditional + Modern Medicine)

A ledger system (`DualPathLedgerModal`) tracking both traditional and modern treatments:

| Tab | Emoji | Accent | Content |
|---|---|---|---|
| Traditional | 🌿 | #a3e635 | Herbal remedies, traditional healers, cultural practices |
| Modern | 🏥 | #c084fc | Prescriptions, clinic visits, lab results |
| Interaction | 🧪 | #60a5fa | Drug-herb interactions, contraindications |
| Progress | 📈 | #fbbf24 | Combined treatment outcome tracking |

10-entry cap per type. Role-gated: clinicians/admins can write; patients/caregivers read-only.

---

## 11. Medicine Supply Ledger

Tracks patient medication inventory:
- In-stock / low / critical pill status with days_remaining and refill location
- 10-entry cap with "limit reached" banner
- Write access gated to clinician, VHW, admin roles
- Refill alerts when supply drops below threshold

---

## 12. Predictive Analytics

### Composite Risk Index (CRI)
4-component weighted ensemble producing a 0–100 risk score:

1. **Vital Trajectory Forecaster**: Linear regression on BP/glucose series → 7-day projection → threshold breach detection
2. **Symptom Escalation Predictor**: Logistic score P(urgent triage within 14 days) from triage sequence history
3. **Adherence Decay Model**: Exponential time-decay on engagement signal since last caregiver contact
4. **Clinical Score Card**: `deterioration_risk` (0–10) from clinical scoring service

Thresholds: CRI ≥ 85 = CRITICAL, ≥ 65 = HIGH, ≥ 45 = MODERATE. Cached in Redis (`cri:{patient_id}`, 6h TTL).

### CHW Burnout Monitor
Computes burnout risk for Community Health Workers based on:
- Total patients, high-CRI count (≥65), critical count (≥80)
- Average CRI across caseload, average SDOH scores
- Overdue tasks, days since last activity
- WHO threshold: 30 patients max per CHW
- Bands: critical (≥0.80), high (≥0.60), moderate (≥0.40), elevated (≥0.20), normal

### Longitudinal Outcome Tracker
CRI snapshots over time with trajectory analysis at 30/90/180-day windows:
- Labels: improving (CRI drop ≥5), stable, declining (rise ≥5), critical (CRI ≥80)
- Population-level aggregates for caregiver dashboards via `get_population_outcomes()`

---

## 13. DHIS2 Integration

### Aggregate Sync (Phase 1)
Pushes 11 daily anonymous metrics per region to DHIS2:
`AMINA_CONS_TOTAL`, `AMINA_CONS_EMERGENCY/URGENT/ROUTINE`, `AMINA_NCD_HTN/DM/ASTHMA`, `AMINA_MCH`, `AMINA_MENTAL_HEALTH`, `AMINA_CG_ALERTS`, `AMINA_SAFETY_BLOCKS`

No patient-level data — anonymous counts by region and date. Prometheus counters for monitoring.

### Patient-Level Tracker (Phase 2.3)
Pushes consenting patients as DHIS2 Tracked Entity Instances:
- Gate: `DHIS2_TRACKER_ENABLED=true` + patient `share_with_dhis2=true` consent
- Uses `fhir_mapper.py` for FHIR→DHIS2 data element mapping
- `icd10_coder.code_text()` for ICD-10 coding
- `phi_deid.py` for PHI de-identification before push
- Full audit trail in `TrackerPushAuditVertex`

---

## 14. Voice Pipeline

### Speech-to-Text (Whisper)
- Container: `voice-stt` running `whisper.cpp` with `ggml-base.en` model
- Latency: ~500ms on CPU
- Input: Audio from browser MediaRecorder API
- Output: Transcribed text fed into the chat pipeline

### Text-to-Speech — English (Piper)
- Container: `voice-tts` running Piper with `en_US-lessac-medium.onnx`
- API: `POST /v1/tts` → WAV, `POST /v1/tts/ogg` → Opus (for Telegram/WhatsApp)
- Latency: ~500ms–1s on CPU

### Text-to-Speech — Mandinka (MMS)
- Container: `voice-tts-mnk` running Meta's `facebook/mms-tts-mnk` VITS model
- Post-processing: Pitch-shifted +3.5 semitones via ffmpeg to produce a female voice
- API: Identical contract to Piper — `POST /v1/tts`, `POST /v1/tts/ogg`
- Model cache persisted to `./data/huggingface-cache`

Both TTS services expose identical HTTP contracts, so backend code switches based solely on language preference.

---

## 15. Translation Pipeline

### v1 — Direct Translation
Backend selected by `USE_GEMMA_TRANSLATOR` flag:
- `false` → GPT-4o mini
- `true` → Self-hosted Gemma via vLLM (translategemma-12b-it recommended)
- Redis cache (30-day TTL) keyed by backend to prevent cross-backend stale hits
- Preserves medical names, place names (EFSTH, Banjul), phone numbers (199), Gambian food names

### v2 — Full Pipeline (flag-gated: `USE_V2_TRANSLATION_PIPELINE`)
7-priority routing chain:
1. Translation Memory (TM) cache lookup
2. Per-request provider override via header
3. PII gate: If PII detected → force local NLLB provider
4. Primary provider
5. Fallback provider on failure
6. Shadow mode: Fires fallback in background for `V2_SHADOW_PERCENT` of requests; logs disagreements
7. TM write-back on success

Provider abstraction layer, glossary management, quality evaluation (`qe.py`), and observability hooks.

---

## 16. Emergency Escalation System

### Patient-Facing SOS
3-step full-screen emergency flow (z-index 9300):
1. **Pick emergency**: 6 big tiles — chest pain, breathing difficulty, stroke signs, bleeding, fainted, other
2. **Confirm**: Caregiver count, location sharing toggle, Send/Cancel
3. **Result**: Green check, notification count, **"Call 199 now"** tel-link (Gambia emergency number)

Sends to `/api/v1/caregiver/alert/send` with `emergency_triage` severity.

### Backend Escalation
- `EmergencyEscalationWatcher` monitors for escalation conditions in the background
- `EmergencyAdminPage` provides admin dashboard for managing emergencies
- `EmergencyCaregiverActions` enables caregiver response workflow

---

## 17. Consent & Privacy System

### Training Consent
`ConsentGate` (z-index 9999) blocks the app on first launch until the user consents to data usage for model training. Posts to `/api/v1/training/consent/me`. Separate gates for patients and caregivers.

### Data Sharing Privacy Panel
4 consent scopes with granular control:
1. **Anonymous health statistics** — always on (locked)
2. **Individual consultation records** — toggleable
3. **Health profile for research** — toggleable
4. **DHIS2 referral acknowledgment** — per-referral

Full consent change audit trail in `ConsentAuditVertex`.

---

## 18. Session & Role Management

### Role Switching
7 roles with dedicated UI behaviors: `patient`, `clinician`, `vhw` (Village Health Worker), `alkalo` (village leader), `imam`, `scout`, `admin`. The `RoleSwitcher` floating pill shows current role. Admins see full role list; non-admins toggle between own role and patient view.

### Session Registry
`sessionRegistry.js` manages JWT slots per role (`pt`, `cg`, `ad`) in localStorage. The `activeRolePurge.js` boot-time side-effect clears non-active role keys before React mounts, ensuring clean state on page reload. `SessionBootstrap.jsx` wraps `window.fetch` to auto-capture login responses into session slots.

### Conversation Threading
`conversationStore.js` provides ChatGPT-style thread persistence — last 5 conversations stored in localStorage, keyed by `session_id`, with instant switching (no API round-trip).

---

## 19. Frontend Architecture

### Dual React Roots
- **Root 1** (`#root`): `main.jsx` → `App.jsx` — the main patient/caregiver chat interface
- **Root 2** (`#amina-router-root`): `RouterBootstrap.jsx` → `AppRouter.jsx` — hash-based page router with admin shell, government observatory, login/signup pages

Both roots run simultaneously. The router handles: `#/home`, `#/login`, `#/signup`, `#/chat`, `#/patient`, `#/caregiver`, `#/admin`, `#/dashboard`.

### Bootstrap Chain
Self-mounting side-effects loaded via `main.jsx` imports:
- `ConsentBootstrap.jsx` — consent gate
- `AdminPatientLiteracyOverride.jsx` — admin literacy tools
- `LiteracyBootstrap.jsx` — literacy mode detection and shell mounting
- `i18n/v2_optin.js` — translation system initialization

Additional bootstraps mount independently: `CaregiverInboxBootstrap`, `BantabaManagerBootstrap`, `ScoutManagerBootstrap`, `VillageManagerBootstrap`, `DualPathLedgerBootstrap`, `SupplyLedgerBootstrap`, `InboxBootstrap`, `RoleSwitcherBootstrap`, `ScribeBootstrap`, `ChatToastBootstrap`.

### UI Component Library
Admin primitives: Card, Stat, Pill, Badge, Button, Donut chart, Sparkline, HBar, Tabs, ToastHost, Input, Select, Modal. Shared across admin and government shells.

---

## 20. Internationalization

- **Languages**: English, Mandinka (with N'Ko script transliteration via `nkoTransliterate.js`)
- **Language picker**: Floating button with dropdown, persists to localStorage
- **Auto-translator**: Background translation pipeline for dynamic content
- **14-country phone support**: India, Gambia, Colombia, USA, UK, Nigeria, Senegal, Ghana, Kenya, South Africa, UAE, Brazil, Germany, France

---

## 21. Clinical Documentation (Scribe)

Floating "Record visit" button for caregivers and admins:
- **State machine**: idle → recorder → review → finalized → idle
- **Recorder**: Voice capture via MediaRecorder API with waveform visualization
- **Review**: Edit transcription and metadata before submission
- Hidden for plain patients; shown for caregivers, admins, and self-recording patients

---

## 22. Inbox & Notification System

- **InboxBell**: Bell icon with unread badge count (top-right, z-index 9250)
- **InboxPanel**: Right-side drawer (380px desktop, full-width mobile) with "mark all read"
- **InboxItemCard**: Individual notification cards with title, snippet, action buttons
- **InboxAuthWatcher**: Background watcher for auth state changes
- **ChatInterceptor**: Intercepts chat messages to generate inbox notifications
- Separate caregiver inbox system with `CaregiverInboxBell`

---

## 23. Feature Flags

All behavior toggles controlled via environment variables:

| Flag | Default | Controls |
|---|---|---|
| `USE_FINETUNED_MODEL` | true | AMINA LoRA as primary model |
| `USE_SAFETY_CONTRACT` | true | Post-LLM safety validation |
| `USE_CONVERSATIONAL_PACER` | true | Turn-length shaping |
| `USE_DENSITY_COMPRESSION` | true | Filler stripping |
| `USE_INTENT_ROUTER` | true | Intent classification |
| `USE_INTENT_LEARNER` | true | Self-learning from misses |
| `USE_FOUR_LAYER_ROUTER` | true | Full neuro-symbolic routing |
| `USE_STANCE_CLASSIFIER` | true | LLM stance classification |
| `USE_STANCE_MODE` | shadow | Shadow (log only) vs. active routing |
| `USE_INTENT_PATTERN_GRAPH` | true | Redis knowledge graph |
| `USE_V2_TRANSLATION_PIPELINE` | true | v2 translation with TM cache |
| `USE_RESPONSE_SHAPE_DECISION` | true | Response format selection |
| `CHATQNA_ADMIN_MV_OPEN` | true | Dev-only: skip admin JWT |

---

## Summary

AMINA Care is a **voice-first, culturally-aware AI health assistant** built for community health workers and patients in The Gambia. It runs as **9 Docker containers** behind a single FastAPI backend with **200+ API endpoints** across **15 additive entry-point modules**. The agent processes messages through a **deterministic pre-LLM pipeline** (emergency scan, vitals extraction, medication safety gate) before routing through a **four-layer neuro-symbolic router** that combines regex matching, LLM stance classification, tool suppression maps, and a Redis knowledge graph. **22 health-domain tools** execute in parallel, feeding observations into a **single LLM call** with model cascade (AMINA LoRA → Gemini → GPT → Groq → Mistral). Post-generation, a **4-check safety contract** validates output deterministically, followed by density compression, conversational pacing, and optional Mandinka translation. A **three-tier memory architecture** (Redis working → ArcadeDB episodic → ArcadeDB vectors) provides both fast ephemeral access and permanent longitudinal patient context. The frontend adapts to **3 literacy modes** (beginner/basic/advanced), supports **7 user roles**, and provides dedicated shells for **admin operations**, **government health surveillance**, **caregiver intelligence**, and **community health circles**.
