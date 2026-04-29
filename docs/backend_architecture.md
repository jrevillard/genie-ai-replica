# AMINA Care — Backend Architecture (Haystack-ChatQNA & RAG)

## Backend Architecture Graph

```
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                     HAYSTACK-CHATQNA  (FastAPI · :8000 · 4 Uvicorn Workers)      │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                        ENTRY-POINT CHAIN (15 modules)                     │   │
  │  │                                                                           │   │
  │  │  main.py ─→ guard ─→ training ─→ literacy ─→ inbox ─→ resilience ─→      │   │
  │  │  gap_closers ─→ intent_review ─→ emergency ─→ caregiver_notify ─→        │   │
  │  │  dualpath ─→ supply_ledger ─→ dhis2_history ─→ translation_v2 ─→         │   │
  │  │  tts_mandinka_fix                                                         │   │
  │  │                                                                           │   │
  │  │  Each module imports the previous, adds its router, re-exports `app`      │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     BASE APP  (main.py)                                   │   │
  │  │                                                                           │   │
  │  │  FastAPI(title="Genie AI - Haystack Service")                             │   │
  │  │  CORS: localhost:5173-5175, credentials=True                              │   │
  │  │                                                                           │   │
  │  │  16 Routers at /api/v1:                                                   │   │
  │  │    agent · patient · community · care · auth · admin · protocol ·         │   │
  │  │    fhir · caregiver · patient_alert · direct_chat · cg_application ·      │   │
  │  │    dhis2 · consent · meta · routes (legacy)                               │   │
  │  │                                                                           │   │
  │  │  @startup:                                                                │   │
  │  │    1. Create ArcadeDB schemas (22 vertex types, 7 edge types)             │   │
  │  │    2. Setup 3-tier memory schema                                          │   │
  │  │    3. Schedule DHIS2 daily sync (02:00 UTC)                               │   │
  │  │    4. Schedule DHIS2 bidirectional pull (every 15 min)                     │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     POST /api/v1/agent/chat                               │   │
  │  │                                                                           │   │
  │  │  Request: message, session_id, patient_id, phone, language,               │   │
  │  │           channel, model_preference, regenerate_hint                       │   │
  │  │                                                                           │   │
  │  │  ┌──────────────────┐   ┌──────────────┐   ┌────────────────────┐        │   │
  │  │  │ Auth Gate        │──▶│ Guest?       │──▶│ Guest Cascade:     │        │   │
  │  │  │ JWT from header  │   │ No JWT →     │   │ Groq → Gemini      │        │   │
  │  │  │ or cookie        │   │ guest mode   │   │ (no auth required) │        │   │
  │  │  └──────────────────┘   └──────────────┘   └────────────────────┘        │   │
  │  │           │                                                               │   │
  │  │           ▼                                                               │   │
  │  │  ┌──────────────────────────────────────────────────────────────────┐     │   │
  │  │  │                   AminaAgent.process_message()                    │     │   │
  │  │  │                   (~2,350 lines · Singleton)                     │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  ══════════════ PRE-LLM PIPELINE (~5ms) ═══════════════════     │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 0a: Chat export intent ──── regex "export/download PDF"    │     │   │
  │  │  │           → PDF generation, return immediately, zero LLM         │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 0:  Emergency scan ──────── 28 crisis phrases              │     │   │
  │  │  │           → check_emergency tool, return EMERGENCY, zero LLM     │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 1:  Patient identity ────── session_id → patient_id        │     │   │
  │  │  │           → ArcadeDB PatientVertex (profile, meds, vitals)       │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 2:  Persist user msg ────── Redis session + local memory   │     │   │
  │  │  │           First-turn detection (cross-worker via Redis)          │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 3:  Greeting context ────── time-of-day, trust tier,       │     │   │
  │  │  │           ethnic language, special days (zero LLM)               │     │   │
  │  │  │           Voice/SMS → 3-phase Mandinka ritual (templated)        │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 3b: Vitals extraction ───── regex BP/glucose/weight/temp   │     │   │
  │  │  │           → Redis trend storage → deterministic delta compare    │     │   │
  │  │  │           → async outcome tracking                               │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 3d: Journey callbacks ───── 30/90/180/365-day milestones   │     │   │
  │  │  │           Multi-month trend injection                            │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 4:  Context build ────────  Patient profile + semantic     │     │   │
  │  │  │           memories + recent consultations → context string        │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 4b: Medication safety ───── MedicationSafetyGate           │     │   │
  │  │  │           BLOCK → template response, zero LLM                    │     │   │
  │  │  │           BLOCK_WITH_FIRST_AID → first aid + block               │     │   │
  │  │  │           ALLOW_CAUTION → inject warning into context            │     │   │
  │  │  │           PASS → continue                                        │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  ══════════════ TOOL ROUTING ══════════════════════════════     │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 5:  _route_tools() ──────── 17-entry keyword→tool table    │     │   │
  │  │  │           Max 3 tools selected                                   │     │   │
  │  │  │           Health tools auto-append search_knowledge (RAG)        │     │   │
  │  │  │           → asyncio.gather() parallel execution                  │     │   │
  │  │  │                                                                  │     │   │
  │  │  │           OR (if USE_LLM_TOOL_ROUTER=true):                      │     │   │
  │  │  │           route_tools_llm() → LLM-based selection                │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  ══════════════ LLM CALL ══════════════════════════════════     │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  Step 6:  Prompt assembly ─────── system prompt (persona)        │     │   │
  │  │  │           + compaction summary (if exists, ≤800 chars)           │     │   │
  │  │  │           + patient context (35% of flex budget)                  │     │   │
  │  │  │           + RAG evidence (35% of flex budget)                     │     │   │
  │  │  │           + conversation history (30% of flex budget)             │     │   │
  │  │  │           + tool observations                                    │     │   │
  │  │  │                                                                  │     │   │
  │  │  │           Model cascade:                                         │     │   │
  │  │  │           ┌────────────┐  ┌────────┐  ┌───────┐  ┌──────┐       │     │   │
  │  │  │           │AMINA LoRA  │─▶│Gemini  │─▶│ GPT-4o│─▶│ Groq │       │     │   │
  │  │  │           │(vLLM/A40)  │  │Flash   │  │ mini  │  │Llama │       │     │   │
  │  │  │           └────────────┘  └────────┘  └───────┘  └──────┘       │     │   │
  │  │  │                                                                  │     │   │
  │  │  │           Token budgets per model:                               │     │   │
  │  │  │           ┌──────────┬────────┬─────────┬─────────┐             │     │   │
  │  │  │           │ Model    │ Input  │ Output  │ History │             │     │   │
  │  │  │           ├──────────┼────────┼─────────┼─────────┤             │     │   │
  │  │  │           │ AMINA    │ 20,000 │  900    │ 6 turns │             │     │   │
  │  │  │           │ Gemini   │ 22,000 │  800+   │ 6 turns │             │     │   │
  │  │  │           │ GPT-4o   │ 18,000 │ dynamic │ 6 turns │             │     │   │
  │  │  │           │ Groq     │ 10,000 │  500    │ 4 turns │             │     │   │
  │  │  │           │ Mistral  │ 10,000 │  500    │ 4 turns │             │     │   │
  │  │  │           └──────────┴────────┴─────────┴─────────┘             │     │   │
  │  │  │                                                                  │     │   │
  │  │  │           Overflow guard: pre-trim oldest turns → retry          │     │   │
  │  │  │           Auto-continuation: up to 2 rounds on truncation        │     │   │
  │  │  │           Sentence-boundary trim on final output                 │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  ══════════════ POST-LLM PIPELINE ═════════════════════════     │     │   │
  │  │  │                                                                  │     │   │
  │  │  │  1. Greeting fragment strip (remove duplicate Salaam/Welcome)    │     │   │
  │  │  │  2. Safety contract (4 deterministic checks, zero LLM)           │     │   │
  │  │  │  3. Density compression (strip filler phrases)                   │     │   │
  │  │  │  4. Conversational pacer (turn-appropriate length shaping)       │     │   │
  │  │  │  5. Mandinka translation (if language == "ma")                   │     │   │
  │  │  │  6. Persist → Redis (Tier 1) + ArcadeDB (Tier 2)               │     │   │
  │  │  │  7. Async background:                                            │     │   │
  │  │  │     • Self-learning interaction log                              │     │   │
  │  │  │     • Clinical fact extraction → MemoryVertex                    │     │   │
  │  │  │     • Intent classification miss detection                       │     │   │
  │  │  │     • DHIS2 daily counter bump                                   │     │   │
  │  │  │     • Context compaction scheduling                              │     │   │
  │  │  └──────────────────────────────────────────────────────────────────┘     │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     TOOL ORCHESTRATOR                                     │   │
  │  │                     (22 Health-Domain Tools)                              │   │
  │  │                                                                           │   │
  │  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────┐         │   │
  │  │  │ Clinical        │ │ WHO Protocols   │ │ Knowledge & Lookup  │         │   │
  │  │  │                 │ │                 │ │                     │         │   │
  │  │  │ assess_triage   │ │ manage_diabetes │ │ search_knowledge    │         │   │
  │  │  │ record_vitals   │ │ manage_hyper    │ │ get_medication_info │         │   │
  │  │  │ assess_cvd_risk │ │ assess_resp     │ │ get_diet_advice     │         │   │
  │  │  │ check_emergency │ │ screen_cancer   │ │ find_facility       │         │   │
  │  │  │ generate_care   │ │ counsel_life    │ │ get_patient         │         │   │
  │  │  │ schedule_follow │ │ check_ramadan   │ │ analyze_prescription│         │   │
  │  │  │ save_consult    │ │                 │ │ get_cultural_greet  │         │   │
  │  │  │                 │ │                 │ │ get_lifestyle_nudge │         │   │
  │  │  │                 │ │                 │ │ suggest_community   │         │   │
  │  │  └─────────────────┘ └─────────────────┘ └─────────────────────┘         │   │
  │  │                                                                           │   │
  │  │  Routing: TOOL_ROUTES table (17 keyword-list → tool-name entries)         │   │
  │  │  Selection: keyword match against user message, cap at 3                  │   │
  │  │  Health tools auto-append search_knowledge for parallel RAG               │   │
  │  │  Execution: asyncio.gather() — all tools run concurrently                 │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     RAG PIPELINE (Hybrid Retrieval)                       │   │
  │  │                                                                           │   │
  │  │  Query ──┬──▶ Embed (all-MiniLM-L6-v2, 384d)                             │   │
  │  │          │       │                                                        │   │
  │  │          │       ▼                                                        │   │
  │  │          │    Vector Search ── ArcadeDB cosine similarity ── top 5        │   │
  │  │          │       │                                                        │   │
  │  │          │       ├──▶ Combine + Deduplicate (by first 100 chars)          │   │
  │  │          │       │                                                        │   │
  │  │          ▼       │                                                        │   │
  │  │    Keyword Search ── ArcadeDB Lucene full-text ── top 5                   │   │
  │  │                      │                                                    │   │
  │  │                      ▼                                                    │   │
  │  │               Cross-Encoder Re-rank                                       │   │
  │  │               (ms-marco-MiniLM-L-6-v2)                                    │   │
  │  │               top 3 results returned                                      │   │
  │  │                      │                                                    │   │
  │  │                      ▼                                                    │   │
  │  │               Injected into LLM prompt as:                                │   │
  │  │               "Relevant knowledge: [Source 1]: ... [Source 2]: ..."        │   │
  │  │               (capped at 35% of flex char budget)                         │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     THREE-TIER MEMORY                                     │   │
  │  │                                                                           │   │
  │  │  ┌─── Tier 1: Redis Working Memory (ephemeral) ───────────────────────┐   │   │
  │  │  │  session:{sid}           24h TTL   conversation msgs (cap 20)      │   │   │
  │  │  │  vitals:{sid}:{type}     6mo TTL   vital readings (cap 20)         │   │   │
  │  │  │  careplan:{sid}          7d TTL    generated care plans            │   │   │
  │  │  │  stats:{sid}             365d TTL  interaction count, dates        │   │   │
  │  │  │  ritual:{sid}            24h TTL   greeting phase tracker          │   │   │
  │  │  │  stance:last:{sid}       24h TTL   last stance classification     │   │   │
  │  │  │  cri:{pid}               6h TTL    Composite Risk Index cache     │   │   │
  │  │  │  chat:summary:{sid}      24h TTL   compacted conversation summary │   │   │
  │  │  │  ipg:{cat}:{pattern}     persist   Intent Pattern Graph nodes     │   │   │
  │  │  └────────────────────────────────────────────────────────────────────┘   │   │
  │  │                                                                           │   │
  │  │  ┌─── Tier 2: ArcadeDB Episodic (permanent) ─────────────────────────┐   │   │
  │  │  │  PatientVertex        demographics, conditions, meds, allergies    │   │   │
  │  │  │  ConsultationRecord   session transcripts, summaries, triage       │   │   │
  │  │  │  ClinicalStateSnap    structured clinical state per session        │   │   │
  │  │  │  CompactionSummary    audit trail of compacted conversations       │   │   │
  │  │  │  Edges: HasConsultation, HasMemory, HasCompaction                  │   │   │
  │  │  └────────────────────────────────────────────────────────────────────┘   │   │
  │  │                                                                           │   │
  │  │  ┌─── Tier 3: ArcadeDB Semantic (vector-indexed) ────────────────────┐   │   │
  │  │  │  chunks         384d vectors, COSINE index, Lucene full-text       │   │   │
  │  │  │                 150-word splits, 20-word overlap, category labels   │   │   │
  │  │  │  MemoryVertex   patient-specific semantic memories + embeddings    │   │   │
  │  │  │                 key facts extracted by LLM after each session       │   │   │
  │  │  └────────────────────────────────────────────────────────────────────┘   │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     CONTEXT COMPACTOR                                     │   │
  │  │                                                                           │   │
  │  │  Trigger: ≥8 messages AND running chars > 75% of model's char_budget      │   │
  │  │  Hard cap: if chars > 90% → synchronous oldest-message drop               │   │
  │  │  Dedup lock: Redis chat:compact_inflight:{sid} (5 min)                    │   │
  │  │                                                                           │   │
  │  │  Process:                                                                 │   │
  │  │  1. Slice messages[:-4] (preserve last 4 turns verbatim)                  │   │
  │  │  2. Fold in any prior summary                                             │   │
  │  │  3. Summarize via LLM cascade:                                            │   │
  │  │     Gemini 2.5 Flash Lite → Groq Llama 3.3 → GPT-4o mini                 │   │
  │  │     (temp 0.2, max 300 tokens, clinical-aware prompt)                     │   │
  │  │  4. Store in Redis chat:summary:{sid} (24h TTL)                           │   │
  │  │  5. Trim compacted messages from session                                  │   │
  │  │  6. Write CompactionSummary to ArcadeDB (audit)                           │   │
  │  │                                                                           │   │
  │  │  Consumption: prepended to system prompt as                               │   │
  │  │  "Prior conversation summary (compressed): {summary[:800]}"               │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     FOUR-LAYER NEURO-SYMBOLIC ROUTER                      │   │
  │  │                     (USE_FOUR_LAYER_ROUTER=true)                          │   │
  │  │                                                                           │   │
  │  │  L0: Deterministic ───── regex/keyword for emergency, goodbye, ack        │   │
  │  │      │                   + learned corrections from intent DB             │   │
  │  │      │                   Returns immediately on match (<1ms)              │   │
  │  │      ▼                                                                    │   │
  │  │  L1: Stance Classifier ─ Gemini Flash Lite → 9 stances:                   │   │
  │  │      │                   social_ritual, emotional_disclosure,              │   │
  │  │      │                   followup_continuation, ambiguous,                │   │
  │  │      │                   vitals_report, clinical_question,                │   │
  │  │      │                   information_seeking, family_carer_concern,       │   │
  │  │      │                   medication_question                              │   │
  │  │      │                   Confidence score + urgency + formality           │   │
  │  │      │                   Currently: SHADOW MODE (log only)                │   │
  │  │      ▼                                                                    │   │
  │  │  L2: Suppression Map ─── stance → frozenset of suppressed tools           │   │
  │  │      │                   social_ritual → suppress ALL clinical tools      │   │
  │  │      │                   emotional → suppress clinical (not triage)       │   │
  │  │      │                   ambiguous → suppress ALL tools                   │   │
  │  │      │                   clinical → empty set (all allowed)               │   │
  │  │      ▼                                                                    │   │
  │  │  L3: Knowledge Graph ─── Redis IPG (221 nodes)                            │   │
  │  │                          emergency → unconditional override               │   │
  │  │                          cultural idiom → stance override                 │   │
  │  │                          drug context → safety enrichment                 │   │
  │  │                          disambiguator → override if conf < 0.70          │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     SAFETY CONTRACT (Post-LLM)                            │   │
  │  │                     (USE_SAFETY_CONTRACT=true)                            │   │
  │  │                                                                           │   │
  │  │  Check 1: Medication Safety                                               │   │
  │  │    Scans for 40+ known meds. Flags unknown meds not in patient's          │   │
  │  │    prescriptions AND missing safe phrases ("as prescribed").              │   │
  │  │    Flags any specific dosage via _DOSAGE_PATTERN regex.                   │   │
  │  │                                                                           │   │
  │  │  Check 2: Emergency Protocol                                              │   │
  │  │    If user had emergency keywords but response lacks {199, hospital,      │   │
  │  │    EFSTH, emergency, ambulance, clinic} → critical violation.             │   │
  │  │                                                                           │   │
  │  │  Check 3: Clinical Number Ranges                                          │   │
  │  │    BP systolic 60-250, diastolic 30-150, glucose 20-600 mg/dL,           │   │
  │  │    temp 35-42°C, HR 30-220, BMI 10-60.                                  │   │
  │  │                                                                           │   │
  │  │  Check 4: Harm Pattern Blacklist                                          │   │
  │  │    8 regex patterns: "stop taking your medication",                        │   │
  │  │    "you don't need a doctor", "you are going to die",                    │   │
  │  │    "traditional medicine is better than", etc.                            │   │
  │  │                                                                           │   │
  │  │  Pre-generation: get_preemptive_constraints() injects preventive          │   │
  │  │  constraint block into prompt BEFORE generation.                          │   │
  │  │  Post-check: violations block response + surface fix_hint.                │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  │                                                                                  │
  │  ┌────────────────────────────────────────────────────────────────────────────┐   │
  │  │                     78 SERVICE MODULES                                    │   │
  │  │                                                                           │   │
  │  │  Clinical:    safety_contract · clinical_scoring · clinical_pipeline ·     │   │
  │  │               care_gap_detector · medication_safety_gate                   │   │
  │  │  Predictive:  predictive_engine (CRI) · burnout_monitor ·                │   │
  │  │               outcome_tracker                                             │   │
  │  │  Caregiver:   caregiver_amina_service (6-dim intel) · caregiver_inbox ·  │   │
  │  │               caregiver_application                                       │   │
  │  │  Integration: dhis2_sync · dhis2_tracker · fhir_mapper · phi_deid ·      │   │
  │  │               icd10_coder                                                 │   │
  │  │  NLP:         translator · translation_v2 · stance_classifier ·          │   │
  │  │               four_layer_router · intent_pattern_graph ·                  │   │
  │  │               intent_router · intent_learner                              │   │
  │  │  Memory:      memory_manager · context_compactor · conversation_pacer ·  │   │
  │  │               density_compressor                                          │   │
  │  │  Community:   bantaba · village · scouts                                  │   │
  │  │  Auth:        auth · consent · training_consent · literacy                │   │
  │  │  Voice:       greeting · cultural_greeting · tts/stt clients             │   │
  │  └────────────────────────────────────────────────────────────────────────────┘   │
  └──────────────────────────────────────────────────────────────────────────────────┘
            │                      │                     │
  ┌─────────▼──────────┐ ┌────────▼────────┐  ┌─────────▼──────────┐
  │    ArcadeDB :2480   │ │  Redis :6379    │  │  LLM Providers     │
  │                     │ │                 │  │                     │
  │  22 vertex types    │ │  60+ key        │  │  AMINA LoRA (vLLM)  │
  │  7 edge types       │ │  patterns       │  │  Gemini Flash       │
  │  1 vector index     │ │  10+ TTL tiers  │  │  GPT-4o mini        │
  │  1 full-text index  │ │                 │  │  Groq Llama 3.3     │
  │                     │ │                 │  │  Mistral 7B          │
  └─────────────────────┘ └─────────────────┘  └─────────────────────┘
```

---

## How It Works

### Request Flow

When a message arrives at `POST /api/v1/agent/chat`, the endpoint first checks for a valid JWT (from `Authorization` header or `amina_jwt`/`amina_cg_jwt`/`amina_admin_jwt` cookies). Unauthenticated users enter **guest mode** with a restricted model cascade (Groq → Gemini only). Authenticated users get full model selection via the `model_preference` parameter.

The request is then forwarded to `AminaAgent.process_message()` — a singleton instance shared across all 4 Uvicorn workers (each worker has its own singleton; cross-worker state lives in Redis). The agent processes the message through a strict sequential pipeline where each step can short-circuit the entire flow and return immediately without any LLM cost.

### Pre-LLM Deterministic Pipeline

The first 8 steps run in under 5 milliseconds with zero token cost:

**Emergency scan** checks against 28 hardcoded crisis phrases (chest pain, seizure, suicide, bleeding, can't breathe). On match, the `check_emergency` tool fires and returns an `EMERGENCY` triage response immediately — the LLM is never called.

**Patient identity resolution** parses the session_id format (`s_P_<NAME>_...`) to extract the patient_id, then loads the full `PatientVertex` from ArcadeDB — demographics, conditions, medications, allergies, vitals history, consent status, and behavior profile. This is the agent's "who am I talking to" step.

**Vitals extraction** uses regex to pull structured readings from natural language — `"my blood pressure is 160 over 100"` becomes `{systolic: 160, diastolic: 100}`. These are recorded to Redis (`vitals:{session_id}:bp`) and compared against stored trends to produce delta callbacks: "Your BP is 15 points higher than last week."

**Medication safety gate** runs `MedicationSafetyGate.classify()` to check for dangerous medication requests. If the user asks to double a dose or mix contraindicated drugs, the gate returns `BLOCK` — a templated safety response is sent with zero LLM calls. The gate actions are: `BLOCK` (hard stop), `BLOCK_WITH_FIRST_AID` (first aid instructions), `EMERGENCY` (immediate escalation), `ALLOW_CAUTION` (proceed with warning injected into context), `ALLOW_EDUCATION` (proceed with education), `PASS` (no medication concern detected).

**Context building** combines the patient profile, relevant semantic memories from ArcadeDB's `MemoryVertex` (vector similarity search, top 3), and recent consultation summaries (top 3) into a structured context string prefixed with `PATIENT:`, `CONDITIONS:`, `MEDICATIONS:`, `RELEVANT HISTORY:`, `RECENT VISITS:`.

### Tool Selection & Execution

The agent's `_route_tools()` method uses a 17-entry keyword → tool routing table. For example, messages containing "blood pressure", "BP", or "glucose" route to `record_vitals`; messages with "pain", "fever", or "symptoms" route to `assess_triage`; "benachin", "diet", or "food" routes to `get_diet_advice`. Short affirmative messages ("ok", "yes", "thanks") bypass all tools. Messages longer than 4 words that don't match any keyword and aren't chitchat fall back to `search_knowledge` (RAG).

When a health-domain tool is selected, `search_knowledge` is automatically appended for parallel RAG evidence retrieval. Up to 3 tools execute concurrently via `asyncio.gather()`. Their observations — vital trend comparisons, medication information, triage assessments, facility locations, WHO guideline excerpts — are collected into a structured observations block.

An alternative LLM-based routing mode (`USE_LLM_TOOL_ROUTER=true`) delegates tool selection to a lightweight LLM call for ambiguous messages, but the default is deterministic keyword matching.

### RAG Pipeline (Hybrid Retrieval)

The `search_knowledge` tool (`KnowledgeTool`) runs a hybrid retrieval pipeline:

1. **Embedding**: The query is embedded using `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions) — the same model used during document ingestion.

2. **Vector search**: ArcadeDB's `vectorCosineSimilarity()` function retrieves the top 5 chunks by cosine similarity. Optionally filtered by `category_labels` for domain-specific retrieval.

3. **Keyword search**: ArcadeDB's Lucene full-text index (`CONTAINSTEXT`) retrieves an additional top 5 chunks by keyword match.

4. **Deduplication**: Results from both paths are combined and deduplicated by the first 100 characters of content.

5. **Cross-encoder re-ranking**: A `cross-encoder/ms-marco-MiniLM-L-6-v2` model re-ranks the combined results. The top 3 are returned.

RAG evidence is injected into the LLM prompt as `"Relevant knowledge: [Source 1]: {snippet[:350]}\n[Source 2]: ..."`, allocated 35% of the model's flexible character budget.

### Document Ingestion

The `haystack-dataprep` service ingests health guideline documents (PDF + text) through a Haystack pipeline:

1. `FileTypeRouter` → route by MIME type
2. `TextFileToDocument` / `PyPDFToDocument` → convert to Haystack `Document` objects
3. `DocumentJoiner` → merge streams
4. `DocumentCleaner` → strip whitespace, empty lines, repeated substrings
5. `DocumentSplitter` → **150-word chunks with 20-word overlap**, respecting sentence boundaries
6. `BM25ChunkLabeler` → assign category labels for filtered retrieval
7. `SentenceTransformersDocumentEmbedder` → generate 384-dim embeddings
8. `ArcadeDBChunkWriter` → persist to ArcadeDB `chunks` table

### LLM Call & Prompt Assembly

After all pre-LLM steps and tool execution, the agent constructs a single unified prompt. The prompt budget is split across four segments using model-specific character limits:

- **System prompt** (~120 lines): AMINA persona, Gambian NCD strategy context, 4-tier health system routing rules, cultural principles, safety rules
- **Compaction summary** (if exists): Prepended to system prompt as `"Prior conversation summary (compressed): {summary[:800]}"` — preserves longitudinal context from compacted older turns
- **Flexible budget** split:
  - 35% → Patient clinical context (profile, conditions, medications, recent visits)
  - 35% → RAG evidence (retrieved knowledge snippets)
  - 30% → Conversation history (most recent turns, oldest trimmed first)
- **Tool observations**: Appended as structured results in the user turn

The model cascade tries the preferred model first. If AMINA LoRA (self-hosted vLLM on A40 GPU via Tailscale Funnel) is configured, it's the default. Otherwise, Gemini Flash is primary. On 429/quota errors from Gemini, the system automatically falls back to Groq (Llama 3.3 70B) with reduced `max_tokens=250`. All providers are accessed via the `AsyncOpenAI` SDK using the OpenAI-compatible `/v1/chat/completions` interface.

Output token budgets scale dynamically with message complexity: 100 tokens for simple acknowledgments, 300 for short replies, 500 standard, 700 for longer responses, 1000 for detailed care plans. If the model returns `finish_reason="length"`, an auto-continuation loop fires (up to 2 additional rounds). The final output is trimmed at sentence boundaries.

### Post-LLM Pipeline

Six post-processing steps validate and refine the response:

1. **Greeting fragment strip**: Removes leaked "Salaam alaikum" or "Welcome" from the LLM output when the pre-LLM pipeline already inserted a greeting — preventing duplication.

2. **Safety contract**: Four deterministic checks (zero LLM cost): medication safety (40+ known drugs), emergency protocol (ensures emergency-appropriate responses contain 199/hospital/ambulance), clinical number range validation (BP, glucose, temp, HR, BMI within physiological bounds), and harm pattern blacklist (8 regexes). A pre-generation step also injects preventive constraints into the prompt before the LLM call.

3. **Density compression** (`USE_DENSITY_COMPRESSION=true`): Strips filler phrases like "I understand your concern", "Let me help you with that", etc.

4. **Conversational pacer** (`USE_CONVERSATIONAL_PACER=true`): Enforces turn-appropriate length — short acknowledgments get short replies, clinical questions get detailed ones. Uses a topic queue in Redis to prevent repetitive responses.

5. **Mandinka translation**: If `language == "ma"`, the English response is translated via the translation service (v1 or v2 depending on feature flags). Never auto-detects — translation is explicit.

6. **Persistence**: Writes to Redis Tier 1 (working memory, 24h TTL) and ArcadeDB Tier 2 (permanent `ConsultationRecord`). Seven background tasks fire asynchronously:
   - Self-learning interaction log
   - Clinical fact extraction → `MemoryVertex` (LLM-based)
   - Intent classification miss detection
   - DHIS2 daily counter bump
   - Dialogue state tracker update
   - Outcome tracking
   - Context compaction scheduling

### Context Compaction

When conversations grow long, the context compactor prevents context window overflow:

**Trigger**: ≥ 8 messages AND running character count exceeds 75% of the model's budget. Uses Redis `chat:compact_inflight:{sid}` as a 5-minute distributed lock to prevent duplicate compaction across workers.

**Process**: Slices all messages except the last 4 turns (preserved verbatim), folds in any existing prior summary, then calls a summarizer LLM. The summarizer cascade is: Gemini 2.5 Flash Lite → Groq Llama 3.3 → GPT-4o mini (temp 0.2, max 300 tokens). The clinical-aware prompt instructs: PRESERVE patient facts, commitments, open threads, cultural context; DROP greetings, verbose reasoning. Output: single paragraph, ≤300 tokens.

The summary is stored in Redis (`chat:summary:{sid}`, 24h TTL) and on the next turn is prepended to the system prompt. Compacted messages are trimmed from the Redis session. A `CompactionSummary` vertex is written to ArcadeDB for audit.

**Hard cap fallback**: If running characters exceed 90% of budget, synchronous oldest-message drop fires immediately (always preserving the last 4 turns).

### LLM Client Architecture

All 5 LLM providers use the `AsyncOpenAI` Python SDK with provider-specific base URLs:

| Provider | Base URL | Model | Use Case |
|---|---|---|---|
| AMINA LoRA | Tailscale Funnel → vLLM on A40 | `models/amina-v2-final` | Primary (if `USE_FINETUNED_MODEL=true`) |
| Gemini | `generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash-lite` | Primary fallback / stance classifier |
| GPT-4o | `api.openai.com/v1` | `gpt-4o-mini` | Translation v2 / secondary fallback |
| Groq | `api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Free-tier fallback / guest mode |
| Mistral | `api.mistral.ai/v1` | `open-mistral-7b` | Last-resort fallback |

The model cascade is implemented inline in `process_message()`: per-request `model_preference` selects the primary client, then `try/except` blocks catch quota/rate-limit errors and retry with the next provider. The guest mode cascade is separate — hardcoded as `("groq", "gemini")` in `agent_routes.py`.

### Configuration

All settings are controlled via environment variables loaded in `src/config.py`:

| Category | Key Variables |
|---|---|
| API | `API_HOST=0.0.0.0`, `API_PORT=8000` |
| AMINA LoRA | `AMINA_MODEL_URL`, `AMINA_MODEL_NAME`, `USE_FINETUNED_MODEL` |
| Gemini | `GOOGLE_API_KEY`, `GEMINI_MODEL` |
| Groq | `GROQ_API_KEY`, `GROQ_MODEL` |
| ArcadeDB | `ARCADEDB_URL`, `ARCADEDB_DB`, `ARCADEDB_USER`, `ARCADEDB_PASSWORD` |
| Redis | `REDIS_HOST`, `REDIS_PORT` |
| Embeddings | `EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2` |
| Auth | `JWT_SECRET`, `JWT_EXPIRY_HOURS=168` |

**Feature flags** (all boolean strings, default `false` unless noted):
- `USE_FINETUNED_MODEL` — AMINA LoRA as primary
- `USE_SAFETY_CONTRACT` — post-LLM safety checks
- `USE_CONVERSATIONAL_PACER` — turn-length shaping
- `USE_DENSITY_COMPRESSION` — filler stripping
- `USE_FOUR_LAYER_ROUTER` — neuro-symbolic routing
- `USE_STANCE_CLASSIFIER` — LLM stance classification
- `USE_STANCE_MODE=shadow` — shadow vs. active routing
- `USE_INTENT_PATTERN_GRAPH` — Redis knowledge graph
- `USE_INTENT_ROUTER` — intent classification
- `USE_INTENT_LEARNER` — self-learning from misses
- `USE_LLM_TOOL_ROUTER` — LLM-based tool selection
- `USE_V2_TRANSLATION_PIPELINE` — v2 translation pipeline
- `USE_RESPONSE_SHAPE_DECISION` — response format selection
- `USE_DIALOGUE_STATE_TRACKER` — dialogue state tracking
- `USE_STRUCTURED_COMPACTION` — structured compaction format
