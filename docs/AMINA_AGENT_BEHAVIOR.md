# AMINA Agent: Response Behavior & Architecture

> **Status**: Current-state documentation  
> **Source**: `haystack-stack/haystack-chatqna/src/agent/amina_agent.py` + supporting modules  
> **Last updated**: 2026-04-21

---

## 1. Identity & Personality

| Attribute | Value |
|-----------|-------|
| **Name** | Amina (meaning "trustworthy") |
| **Voice** | Warm, direct, caring — "like a Gambian aunt, not a medical textbook" |
| **Role** | Health guide, NOT a doctor — triages, educates, bridges patients to the formal health system |
| **Languages** | English and Mandinka (detects from user input, mirrors the mix) |
| **Mission** | Operationalise The Gambia's 2022-2027 NCD Strategy |
| **Max response** | 80 words (hard rule, unless emergency protocol or structured plan) |
| **Tone** | Short sentences, no fluff, specific numbers, local food/place names |

### What Amina Never Does
- Diagnoses firmly from one message
- Invents medication names or dosages
- Uses filler phrases ("Make sure to...", "I understand that...", "I hope this helps")
- Gives generic advice not tied to what the patient said
- Uses bullet lists unless genuinely 3+ distinct checklist items
- Adds sign-offs ("let me know if you need more help")

---

## 2. Request-to-Response Pipeline

Every message from the user traverses this exact sequence. Steps are numbered as they appear in `amina_agent.py:process_message()`.

```
Message arrives
      │
      ▼
┌─ Step 0a ─┐   Chat-export intent detection (regex, zero LLM)
│  PDF export │──▶ If "send me a pdf of our chat" → immediate download action, skip LLM
└────────────┘
      │
      ▼
┌─ Step 0 ──┐   EMERGENCY CHECK (absolute priority)
│ Emergency  │──▶ Keyword scan → execute check_emergency tool → if true: return
│ keywords   │   "CALL 199 NOW" response, triage_level=EMERGENCY, bypass everything
└────────────┘
      │
      ▼
┌─ Step 1 ──┐   PATIENT IDENTITY RESOLUTION
│ Identity   │──▶ Parse session_id for patient_id (s_P_FATOU_...) or phone lookup
│ resolution │   Load from ArcadeDB PatientVertex → conditions, medications, allergies
└────────────┘   Fallback: tool-based get_patient, then client-sent name
      │
      ▼
┌─ Step 2 ──┐   PERSIST USER MESSAGE
│ Add to     │──▶ In-memory (ConversationMemory) + Redis (Tier 1)
│ session    │   Check if truly first turn (cross-worker via Redis)
└────────────┘   If first turn: touch_patient_stats → interaction_count, days_since_*
      │
      ▼
┌─ Step 3 ──┐   GREETING CONTEXT (zero LLM, ~5ms)
│ 7-layer    │──▶ build_greeting_context() → time, trust, ethnic lang, special days
│ greeting   │   _build_templated_greeting() → deterministic string assembly
└────────────┘   See Section 4 for full detail
      │
      ▼
┌─ Step 3b ─┐   GREETING RITUAL (voice/SMS/WhatsApp only)
│ Cultural   │──▶ Multi-phase ritual exchange before health content
│ ritual     │   Phase 0→3 progression; bypassed if user jumps to health topic
└────────────┘   Returns templated responses in ~5ms, no LLM
      │
      ▼
┌─ Step 3c ─┐   VITALS EXTRACTION & TREND CALLBACKS
│ BP/glucose │──▶ Regex extraction: BP (120/80), glucose (e.g., "sugar was 140")
│ tracking   │   Record to Redis → compare with previous reading
└────────────┘   Generate trend callback: "Last time 160/100, today 145/90 — better by 15"
      │
      ▼
┌─ Step 3d ─┐   JOURNEY CALLBACKS (multi-month comparisons)
│ Journey +  │──▶ Fires when 3+ readings spanning 7+ days exist
│ Anniversary│   Anniversary milestones: 30/90/180/365-day celebrations
└────────────┘   Zero LLM, pure Redis fetch + arithmetic (~3ms)
      │
      ▼
┌─ Step 4 ──┐   BUILD CONTEXT (semantic memory Tier 2+3)
│ _build_    │──▶ Patient history, conditions, medications, key facts
│ context    │   Cross-session recall from ArcadeDB
└────────────┘
      │
      ▼
┌─ Step 4b ─┐   MEDICATION SAFETY GATE (pre-LLM, pre-tool)
│ Med gate   │──▶ classify() → BLOCK / BLOCK_WITH_FIRST_AID / ALLOW_CAUTION / PASS
│ (zero LLM) │   If BLOCK → return safe templated response, skip LLM entirely
└────────────┘   Audit logged to Redis, DHIS2 counter bumped
      │
      ▼
┌─ Step 5 ──┐   TOOL ROUTING (keyword-based, no LLM)
│ _route_    │──▶ Scan message against TOOL_ROUTES keyword map → select tools
│ tools()    │   Execute up to 3 tools in parallel via asyncio.gather
│            │   Also runs search_knowledge for supplementary WHO evidence
└────────────┘   See Section 5 for all 22 tools
      │
      ▼
┌─ Step 5b ─┐   FORM SUGGESTION DETECTION
│ Forms      │──▶ Detect if symptom form or prescription upload would help
│            │   First time: gentle offer. Second time: stop mentioning, chat instead
└────────────┘
      │
      ▼
┌─ Step 5c ─┐   CONVERSATION INTENT CLASSIFICATION
│ Intent +   │──▶ classify_conversation_intent() → closing / continuing / escalating
│ Behavior   │   Load behavior_profile from Redis for assertiveness tuning
└────────────┘
      │
      ▼
┌─ Step 6a ─┐   EMPATHY ENGINE + ASSERTIVENESS CALIBRATION
│ Emotional  │──▶ classify_emotional_state() → fear, shame, grief, overwhelm, denial, etc.
│ analysis   │   calibrate_assertiveness() → scale 1-5
│            │   should_use_reasoning() → multi-turn reasoning for complex cases
└────────────┘   build_intelligence_block() → unified prompt injection
      │
      ▼
┌─ Step 6b ─┐   PROMPT ASSEMBLY (per-model budgets)
│ Build chat │──▶ System prompt + patient memory + RAG evidence + tool observations
│ messages   │   + greeting instruction + intention hint + tone adjustments
│            │   + trust-tier hint + intelligence block + form instruction
└────────────┘   History window: last N turns, truncated to char budget
      │
      ▼
┌─ Step 7 ──┐   LLM CALL
│ chat.      │──▶ Temperature 0.5 (+ 0.15 bump for regenerate)
│ completions│   If Gemini 429 → auto-fallback to Groq
│ .create()  │   Up to 2 continuation rounds if finish_reason == "length"
└────────────┘
      │
      ▼
┌─ Step 8 ──┐   POST-PROCESSING
│ Trim +     │──▶ Sentence-boundary trim (remove dangling clauses)
│ Strip +    │   Strip ALL greeting fragments from LLM output
│ Prepend    │   Prepend exact templated greeting (first turn only)
└────────────┘   Capitalise first letter if lowercased
      │
      ▼
┌─ Step 9 ──┐   SAFETY SUPERVISOR (second LLM call)
│ _safety_   │──▶ GPT-4o-mini reviews EVERY response (~300ms)
│ review()   │   Checks: medication prescribing, clinical accuracy, emergency miss, harm
│            │   If unsafe → returns rewritten version
└────────────┘   If review fails → response passes through (fail-open)
      │
      ▼
┌─ Step 10 ─┐   TRIAGE ASSESSMENT
│ Triage     │──▶ self_care / chw_visit / facility / emergency
│ + follow-up│   Follow-up suggestion generated (never end without one)
└────────────┘
      │
      ▼
┌─ Step 11 ─┐   PERSIST & RETURN
│ Memory +   │──▶ Save assistant message to in-memory + Redis
│ Learning   │   Schedule background compaction if approaching budget
│            │   Consultation extraction + learning pipeline (async)
└────────────┘   Return: response, triage_level, tools_used, followup, sources, etc.
```

---

## 3. Emergency Detection

**Priority**: Absolute. Fires before greeting, tools, LLM, or any other processing.

### Emergency Keywords
(`amina_agent.py:761-771`)

```
chest pain, can't breathe, difficulty breathing, heart attack, stroke,
can't see, vision loss, fainting, fainted, unconscious, severe pain,
bleeding heavily, seizure, overdose, suicide, want to die, kill myself,
collapsed, passed out, not breathing, face drooping, can't speak,
slurred speech, sudden weakness, sudden headache, worst headache
```

### Emergency Response Format
(`amina_agent.py:2321-2334`)

```
EMERGENCY ALERT

This sounds like a medical emergency. Please act immediately:

1. CALL 199 (Ambulance) NOW
2. Or go directly to: EFSTH - Edward Francis Small Teaching Hospital
3. [Immediate action from emergency tool]

Watch for: [Warning signs]

If someone is with you, have them call while you prepare to leave.
Stay strong — help is on the way.
```

### Numeric Thresholds (from WHO PEN protocols)
- Blood sugar > 400 mg/dL or < 50 mg/dL
- Blood pressure > 180/120 mmHg
- Glucose > 300 + nausea/vomiting + fruity breath → DKA

---

## 4. Greeting Protocol

### 7-Layer Architecture
(`amina_agent.py:579-699`, `src/services/greeting.py`)

All layers execute in ~100 microseconds. Zero LLM calls.

#### Layer 1: Ethnic Language Detection
Detects Mandinka, Wolof, Fula, Jola, Serahule from user input. Sets `ethnic_language` for the session. Confidence-gated (low → ignore).

#### Layer 2: Time-of-Day
| Time | Mandinka | English |
|------|----------|---------|
| Before 12pm | "Isama jang!" | Good morning |
| 12pm-5pm | "Itilii jang!" | Good afternoon |
| After 5pm | "Iwulaara jang!" | Good evening |

#### Layer 3: Special Days
- **Friday (Jummah)**: "Jumaa Mubarak!"
- **Lumo (market day)**: "Today is lumo day. At the market, remember: moringa leaves and bitter tomato for your heart."

#### Layer 4: Trust Tier Progression

| Tier | Criteria | Greeting Style |
|------|----------|----------------|
| STRANGER | First interaction | `"[Name], welcome."` |
| ACQUAINTANCE | 2+ interactions | `"[Name], I be di?"` (How are you?) |
| COMPANION | Regular contact | `"Ah [Name]! I was thinking about you. I be di?"` |
| FAMILY | Month 4+ | Rotates 3 playful openers deterministically by day-of-year: `"Tanante! I be di?"` / `"Ah, it has been some days! How is the compound?"` / `"I saw the sun and thought of you. I be di?"` |

Returning-after-absence: appends "Welcome back." (except for strangers).

#### Layer 5: Role-Based Register
| Role | Greeting |
|------|----------|
| Alkalo (village head) | `"Salaam aleikum, Alkalo [Name]. I greet you with the respect of your position. Your village's health is my concern."` |
| VHW (Village Health Worker) | `"Salaam aleikum, VHW [Name]. Thank you for the work you do. Are you checking in on a patient or asking for yourself?"` |
| Imam | `"Salaam aleikum, Imam [Name]. May Allah bless your work."` |
| Scout (youth) | `"Salaam aleikum, [Name]! Welcome back. Check your elders this week and report any high BP to your VHW."` |

#### Layer 6: VHW Endorsement
On first-ever call (stranger tier), if a VHW referred this patient, a trust-building line is injected from the referral data.

#### Layer 7: Intention Classification
- EMERGENCY → skip greeting entirely, go straight to emergency protocol
- IN_PAIN + unusual hour → `"Salaam aleikum. It is late — tell me what is happening."`
- Normal → full greeting assembly

### Greeting Ritual (Voice/SMS/WhatsApp Only)
Multi-phase cultural exchange:
- Phase 0: Initial greeting (templated)
- Phase 1-2: Call-and-response (Mandinka ritual exchange)
- Phase 3: Ritual complete → proceed to health content

Bypassed automatically if:
- User jumps straight to a health topic (keyword detection)
- User has 5+ previous interactions (skip ritual for returning users)

### Greeting Stripping
(`amina_agent.py:1771-1813`)

After the LLM generates a response, ALL greeting fragments are stripped before the templated greeting is prepended. This prevents double-greeting (LLM echoing what the template already provides). 40+ known fragments are stripped, including role-specific greetings, Lumo/Jummah phrases, and generic openers.

---

## 5. Tool Orchestration

### Architecture
- **Router**: `_route_tools()` — keyword-based, deterministic, zero LLM
- **Executor**: `ToolOrchestrator` from `src/agent/orchestrator.py`
- **Cap**: Maximum 3 tools per message (bounds latency)
- **Parallel**: Tools execute via `asyncio.gather()`

### Deterministic Tool Routing
(`amina_agent.py:203-278`)

The TOOL_ROUTES mapping fires BEFORE any LLM call:

| Keywords | Tool |
|----------|------|
| blood pressure, my bp, bp is/was, systolic, diastolic | `record_vitals` |
| blood sugar, glucose, my sugar, sugar was/is, hba1c | `record_vitals` |
| diabetes, diabetic, type 2, metformin | `manage_diabetes` |
| hypertension, high blood pressure, high bp | `manage_hypertension` |
| asthma, inhaler, wheezing | `assess_respiratory` |
| copd, chronic cough, breathing difficulty | `assess_respiratory` |
| lump, cervical, abnormal bleeding, tumor | `screen_cancer` |
| prescribed, prescription, doctor gave me, nurse gave me | `get_medication_info` |
| medication, my medicine, my pills, dosage, amlodipine, lisinopril | `get_medication_info` |
| diet, eat, food, benachin, domoda, supakanja, nutrition | `get_diet_advice` |
| nearest clinic, health center, hospital, facility, refer me | `find_facility` |
| care plan, my plan, treatment plan | `generate_care_plan` |
| ramadan, fasting, suhoor, iftar | `check_ramadan` |
| heart attack risk, cvd risk, cardiovascular risk | `assess_cvd_risk` |
| quit smoking, stop smoking, tobacco | `counsel_lifestyle` |
| daily tip, daily nudge, one-spoon, small swap | `get_lifestyle_nudge` |
| pain, ache, hurts, sore, fever, dizzy, nausea, vomit, swelling, numb, tingling, rash, symptom, not feeling well, feel sick | `assess_triage` |
| afraid to go, scared to go, can't go, husband says, ashamed, too expensive, no permission | `suggest_community_support` |

### Special Routing Logic
- **Chitchat filter**: Messages containing only greetings/thanks → no tools
- **Affirmative filter**: "yes", "ok", "no", "hmm" → no tools (let LLM continue naturally)
- **Fallback**: No tool matched + message > 4 words + not chitchat → `search_knowledge`
- **RAG augmentation**: When a health tool fires AND message > 5 words → also run `search_knowledge` in parallel for supplementary WHO document evidence

### All 22 Registered Tools

| # | Tool Name | Category |
|---|-----------|----------|
| 1 | `search_knowledge` | RAG / Knowledge |
| 2 | `assess_triage` | Clinical |
| 3 | `find_facility` | Referral |
| 4 | `get_medication_info` | Medication |
| 5 | `get_diet_advice` | Nutrition |
| 6 | `check_emergency` | Emergency |
| 7 | `get_patient` | Patient Data |
| 8 | `save_consultation` | Persistence |
| 9 | `get_cultural_context` | Cultural |
| 10 | `schedule_followup` | Follow-up |
| 11 | `record_vitals` | Vitals |
| 12 | `generate_care_plan` | Care Plans |
| 13 | `check_ramadan` | Ramadan |
| 14 | `assess_cvd_risk` | WHO PEN |
| 15 | `manage_diabetes` | WHO PEN |
| 16 | `manage_hypertension` | WHO PEN |
| 17 | `assess_respiratory` | WHO PEN |
| 18 | `screen_cancer` | WHO PEN |
| 19 | `counsel_lifestyle` | WHO PEN |
| 20 | `create_prescription` | Prescription |
| 21 | `get_lifestyle_nudge` | Nudges |
| 22 | `suggest_community_support` | Community |

### Health Tools (benefit from supplementary RAG)
`manage_diabetes`, `manage_hypertension`, `assess_respiratory`, `screen_cancer`, `counsel_lifestyle`, `assess_cvd_risk`, `get_diet_advice`, `get_medication_info`, `assess_triage`

---

## 6. Empathy Engine & Assertiveness Calibration

### Emotional State Classification
(`src/services/empathy.py`, called at `amina_agent.py:1458`)

Classifies the patient's emotional state from their message and recent conversation history:
- **Detected emotions**: fear, shame, grief, overwhelm, denial, anger, hopelessness, confusion, loneliness, anxiety, embarrassment
- **Distress levels**: calibrated based on language intensity and context

Keyword detection at routing time (`_emotional_message` flag) for:
```
scared, afraid, worry, worried, anxious, depressed, sad, lonely, hopeless,
overwhelm, crying, can't cope, stressed, ashamed, embarrassed, confused,
helpless, just found out, just diagnosed, told me i have
```

### Assertiveness Calibration
(`src/services/empathy.py:calibrate_assertiveness()`, called at `amina_agent.py:1464`)

Scale 1-5 based on:
- Emotional state (distressed → gentler)
- Patient context (conditions, medications — clinical urgency)
- Behavior profile (learned from past interactions)
- Trust tier (stranger → more cautious, family → can be more direct)
- Conversation turn count (early turns → softer approach)
- Tools used (triage/emergency → more assertive)

### Multi-Turn Reasoning
(`amina_agent.py:1474-1481`)

For complex clinical cases (multiple conditions, drug interactions, conflicting symptoms):
- `should_use_reasoning()` evaluates message complexity
- `build_reasoning_chain()` constructs a step-by-step clinical reasoning chain
- Injected into the prompt via `build_intelligence_block()`

---

## 7. Medication Safety Gate

(`src/safety/medication_gate.py`, fires at `amina_agent.py:1219-1301`)

**Pre-LLM, pre-tool** deterministic classifier. Runs on every message.

### Classification
`MedicationSafetyGate.classify()` returns `(intent, action)`:

| Action | Behavior |
|--------|----------|
| PASS | No medication concern, proceed normally |
| ALLOW_EDUCATION | Medication mentioned but user wants info — LLM proceeds with caution, logged |
| ALLOW_CAUTION | Medication request but safe to answer — LLM proceeds, logged |
| BLOCK | Medication prescribing request — **LLM skipped**, return safe template |
| BLOCK_WITH_FIRST_AID | Acute scenario — return first aid + "go to facility" |
| EMERGENCY | Life-threatening medication scenario — call 199 |

### When Blocked
- Returns a templated safe response from `medication_responses.py`
- Prepends greeting if first turn
- Logs to audit (Redis, async)
- Bumps DHIS2 daily counter (`AMINA_SAFETY_BLOCKS`)
- Attaches context-aware WHO citations based on condition keywords

---

## 8. Model Selection & Fallback Chain

### Per-Request Model Selection
(`amina_agent.py:805-823`)

User or system can request: `amina`, `gemini`, `groq`, `mistral`, `base`

### Per-Model Budgets
(`amina_agent.py:1547-1554`)

| Model | Char Budget | Max Output Tokens | History Turns |
|-------|-------------|-------------------|---------------|
| amina (LoRA) | 20,000 | 900 | 6 |
| groq (Llama 3.3 70B) | 10,000 | 500 | 4 |
| mistral | 10,000 | 500 | 4 |
| gemini (2.5 Flash) | 22,000 | 800 | 6 |
| base (GPT-4o-mini) | 18,000 | dynamic | 6 |

### System Prompts Per Model

| Model | System Prompt |
|-------|---------------|
| gemini, base | Full `AMINA_SYSTEM_PROMPT` (226 lines, all WHO protocols, cultural rules, formatting rules) |
| groq, mistral | `_COMPACT_SYS` (~120 tokens) — "You are AMINA, a Gambian CHW with 10 years experience..." |
| amina (LoRA) | `_LORA_SYS` — personalized, references patient by name, no clarifying questions, local context |

### LoRA Pipeline Specifics
(`amina_agent.py:1556-1634`)

- No RAG (LoRA already knows health guidelines from fine-tuning)
- Patient profile injected compactly at top of user turn
- Key facts from ArcadeDB included (up to 3)
- History: 6 turns, 500 chars per message
- Compaction summary prepended to system prompt (capped at 800 chars)

### Generic Pipeline
(`amina_agent.py:1636-1688`)

Dynamic budget allocation:
- Fixed chars = system prompt + message + 60
- Remaining flex split: 35% patient memory, 35% RAG evidence, 30% history
- History per-message chars = remaining / message count

### Fallback Chain
- Gemini 429 / RESOURCE_EXHAUSTED / quota → auto-fallback to Groq (Llama 3.3 70B)
- Max output tokens capped at 250 on Groq fallback

---

## 9. Response Post-Processing

### Auto-Continuation
(`amina_agent.py:1724-1751`)

If `finish_reason == "length"`:
1. Append `"Continue from where you left off. Do not repeat anything you already said."`
2. Up to 2 continuation rounds
3. Concatenate results

### Sentence-Boundary Trim
(`amina_agent.py:1753-1769`)

After continuations, if still truncated:
- Find last sentence boundary (`.`, `!`, `?`)
- Trim to that point
- Prevents dangling clauses like "and I encourage you to keep a"

### Greeting Fragment Stripping
(`amina_agent.py:1771-1813`)

40+ known greeting fragments stripped from LLM output:
- Full greetings: "Salaam aleikum.", "Isama!", "Iwulaara jang!", "I be di?"
- Role-specific: "Salaam aleikum, VHW.", "Salaam aleikum, Alkalo."
- Special days: "Today is lumo day.", "Jumaa Mubarak!"
- Generic openers: "I'm Amina, your community health worker.", "How can I help you today?"

Then:
- First turn → prepend the exact templated greeting
- Later turns → just strip (no greeting should appear)
- Capitalise first letter if it got lowercased

---

## 10. Safety Supervisor

(`amina_agent.py:2255-2319`)

A second LLM call that reviews **every** response before it reaches the patient.

### Model
GPT-4o-mini (not the fine-tuned model — reliability over personality)

### Checks
1. **MEDICATION PRESCRIBING**: Does it recommend specific drugs/dosages? ("take your prescribed medicine" OK; "take metformin 500mg" NOT OK unless doctor prescribed)
2. **CLINICAL ACCURACY**: Are clinical numbers correct per WHO PEN? (BP <140/90, glucose 70-130, etc.)
3. **EMERGENCY MISS**: If patient mentioned chest pain, can't breathe, BP>180, sugar<50 or >400 — does response tell them to call 199?
4. **HARMFUL ADVICE**: Could following this advice cause harm?

### Behavior
- Returns JSON: `{safe: bool, issues: [], rewrite: string|null}`
- If `safe: false` and `rewrite` exists → the rewritten version replaces the original response
- If review fails (exception) → response passes through (fail-open design)
- Adds ~300ms latency

---

## 11. Vitals Tracking & Journey Callbacks

### Real-Time Vitals Extraction
(`amina_agent.py:1113-1179`)

Regex-based, zero LLM:
- **BP**: `(\d{2,3})\s*/\s*(\d{2,3})` — e.g., "my bp is 140/90"
- **Glucose**: `\b(\d{2,3})\b` with sugar/glucose keyword context

### Trend Callbacks
Previous reading retrieved from Redis BEFORE recording new one. Delta computed:
- **Improving**: "Last time 160/100, today 145/90 — better by 15/10 points."
- **Worsening**: "Last time 120/80, today 140/95 — higher by 20/15."
- **Stable**: "Last time 130/85, today 128/84 — similar."

### Journey Callbacks
(`src/services/journey.py`, `amina_agent.py:1181-1214`)

Multi-month comparisons:
- Requires 3+ readings spanning 7+ days
- "Since we started tracking 3 months ago, your BP has come down from 170/105 to 140/90."

### Anniversary Milestones
30, 90, 180, 365-day celebration messages. First-turn only.

### Outcome Tracking
Every vital reading triggers `track_outcome()` (async) linking the reading to previous advice for the learning pipeline.

---

## 12. Memory System (3-Tier)

(`src/agent/memory_manager.py`)

| Tier | Store | Purpose | TTL |
|------|-------|---------|-----|
| 1 — Working | Redis | Current session messages, ritual phase, ethnic language | 24 hours |
| 2 — Episodic | ArcadeDB | Consultation records, care plans, key facts | Permanent |
| 3 — Semantic | ArcadeDB + vectors | Patient knowledge chunks for RAG recall | Permanent |

### Session Hydration
(`amina_agent.py:709-724`)

On `get_or_create_session()`, the last 10 messages are loaded from Redis so cross-worker turns have conversation history (important for multi-worker deployments).

### Patient Context Fields
```
patient_id, name, age, gender, region, conditions[], medications[],
allergies[], emergency_contact, key_facts[]
```

### Learning Pipeline
(`amina_agent.py:2230-2253`)

After each interaction:
1. `extract_key_facts()` — pull commitments, conditions, preferences from conversation
2. `update_behavior_profile()` — update patient behavior patterns in Redis
3. Every 10 interactions: `promote_to_knowledge_chunks()` — high-quality insights become RAG-retrievable

### Learned Behavior Integration
(`amina_agent.py:1503-1508`)

`get_learned_context()` retrieves behavior patterns from Redis for prompt injection, so Amina adapts to returning patients (e.g., "this patient responds better to direct advice", "this patient needs gentle framing").

---

## 13. Clinical Protocols (WHO PEN)

All protocols are embedded in `AMINA_SYSTEM_PROMPT` (prompts.py) and enforced by dedicated tools.

### Protocol 1: Diabetes
- Diagnosis: Fasting glucose >= 126 on 2 days, OR random >= 200 with symptoms, OR HbA1c >= 6.5%
- Treatment ladder: Lifestyle → Metformin 500mg → 1000mg 2x → add Gliclazide → refer for Insulin
- Hypoglycemia (<70): eat 15-20g sugar, recheck 15min
- Severe hypo (<50): EMERGENCY
- DKA (>300 + nausea + fruity breath): EMERGENCY
- Tool: `manage_diabetes`

### Protocol 2: Hypertension
- Diagnosis: SBP >= 140 OR DBP >= 90 on 2 SEPARATE visits
- Crisis: SBP > 180 OR DBP > 120 = EMERGENCY
- First-line for African populations: CCB (Amlodipine 5-10mg)
- Salt target: <5g/day ("half a Maggi cube, rinse dried fish")
- Pregnancy: STOP ACEI/ARBs, use Methyldopa or Labetalol
- Tool: `manage_hypertension`

### Protocol 3: CVD Risk
- WHO/ISH Risk Charts (AFR-D sub-region) for all adults 40+
- Stroke FAST: Face drooping, Arm weakness, Speech difficulty, Time = call 199
- Heart attack: chest pain + sweating + nausea → chew Aspirin 300mg, call 199
- Tool: `assess_cvd_risk`

### Protocol 4: Respiratory (Asthma & COPD)
- Asthma steps: Salbutamol PRN → Beclometasone → increase → Theophylline → refer
- COPD steps: Salbutamol PRN → Theophylline → refer
- RED ZONE: severe breathlessness, can't speak full sentences, blue lips → Salbutamol 4-6 puffs + call 199
- Indoor cooking smoke = major COPD cause in Gambian women
- Tool: `assess_respiratory`

### Protocol 5: Cancer Early Detection
- Red flags: unexplained weight loss, non-healing wound >3 weeks, persistent lump
- Cervical: post-coital bleeding → refer for VIA screening
- HPV vaccine: girls 9-14 (Gambia national immunization program)
- Tool: `screen_cancer`

### Lifestyle Interventions (All NCDs)
- Salt: <5g/day — "season with lemon/garlic/ginger/scotch bonnet instead of Maggi"
- Diet: moringa (free in most compounds), okra, bitter leaf, millet (chere), nyebbeh
- Reduce: palm oil ("half in benachin"), white rice portions, attaya sugar, soft drinks
- Exercise: 150 min/week — walking, farming, household chores all count
- Tobacco: 5As (Ask, Advise, Assess, Assist, Arrange)
- Tool: `counsel_lifestyle`

---

## 14. Cultural Sensitivity

### Language Handling
- Detect from message → respond in kind
- Mandinka → respond primarily in Mandinka (English in parentheses for medical terms)
- Mixed → mirror the mix
- English → English unless user asks for Mandinka
- Key health phrases maintained: "Sugar kuuraŋo" (diabetes), "Yeelu keli kuuraŋo" (high blood pressure), etc.

### Religious Sensitivity
- **Default**: Religiously neutral
- **Mirror only**: Use "Insha'Allah", "Alhamdulillah" ONLY if user uses them first
- Ramadan guidance: ONLY when user mentions fasting/Ramadan
- Never impose religious framing

### Family & Power Dynamics
- Acknowledge husband/elder/Alkallo decision-making
- If woman says "husband won't let me go" → DO NOT lecture about rights
- Offer Alkallo/elder/CHW path that respects cultural reality
- Tool: `suggest_community_support` (handles permission, stigma, fear, cost barriers)

### Local Context
- Food: benachin, domoda, supakanja, chere, nyebbeh, bissap, bouye, attaya
- Facilities: EFSTH, Sheikh Zayed Eye Centre, 199 (ambulance)
- Poverty-aware: 48.6% live on <$1.25/day — always provide cheap alternatives
- Low-literacy: short sentences, concrete numbers, no jargon

### Community Figures
- **Alkallo** (village head): unlocks family permission
- **Imam**: spiritual support (when patient is religious)
- **Senior elders/aunties**: accompany scared first-time visitors
- **CHW**: most important field partner — private, trusted, home visits

---

## 15. Conversation Intent & Tone Signals

### Intention Classification
(`amina_agent.py:1397-1408`)

Derived from `greeting_ctx["intention"]`:

| Intent | Prompt Injection |
|--------|-----------------|
| EMERGENCY | "User is in crisis. Be firm and directive. Skip pleasantries." |
| IN_PAIN | "Acknowledge pain in the first sentence. Ask location and duration." |
| WORRIED_ABOUT_OTHER | "Address them as the carer, not the patient." |
| SEEKING_INFO | "Explain simply with local analogies. Offer to assess their own risk." |
| LONELY | "Engage warmly. Gently mention Bantaba Circle." |
| FIRST_TIME | "Extra patience. Brief self-introduction only if they ask." |
| ROUTINE_CHECKIN | "Quick, warm, reference prior readings if known." |
| HEALTH_GENERAL | (no special instruction) |

### Tone Signal Detection
(`amina_agent.py:1411-1427`)

| Signal | Adjustment |
|--------|------------|
| unusual_hour | "It is late/early — ask if everything is okay." |
| extended_greeting | "Patient wants social connection — be warm, take time." |
| flat_response | "Patient gave a flat 'fine' — gently check if truly well." |
| short_reply | "Patient is shy or terse — use simple language, invite them." |
| scout_mode | "Youth is checking on an elder — treat them as family carer." |
| privacy_needed | "Acknowledge confidentiality." |
| shouting | "Patient is using ALL CAPS — they may be urgent or frustrated." |

### Closing Detection
`classify_conversation_intent()` detects goodbye intent and generates appropriate closing instruction.

---

## 16. Form Suggestions

(`amina_agent.py:1326-1372`)

### Symptom Form
- **Trigger**: User mentions symptom in <= 14 words without detail
- **First offer**: Give safe advice + ask one follow-up + "If you want, tap the Symptom button"
- **Second+ time**: Stop mentioning form, gather info conversationally turn by turn
- **Never offer**: User gave rich detail, asked info question, mid-crisis, already offered once

### Prescription Upload
- **Trigger**: User mentions prescription without medication name/dosage/frequency
- **First offer**: Ask medication name + "If easier, tap Upload Rx to send a photo"
- **Second+ time**: Stop mentioning form, ask one specific question per turn

### Triage Assessment
- **Trigger**: Multiple symptoms, or worried but unclear severity
- Offered once, then converse

---

## 17. Chat Export

(`amina_agent.py:726-855`)

Pre-LLM shortcut. If user says "send me a pdf of our chat" (regex-detected):
- Returns acknowledgment + `export_action: {type: "download_chat_pdf", session_id}`
- Frontend triggers PDF download
- No LLM call

---

## 18. Token Compaction Integration

(`src/services/context_compactor.py`, integrated at `amina_agent.py:1622-1688`)

### Trigger
`maybe_schedule_compaction()` called after prompt assembly for every model pipeline. Non-blocking.

### Thresholds
- 75% of char_budget → background compaction
- 90% → synchronous trim
- Minimum 8 turns before compaction activates
- Keeps last 4 turns verbatim

### Summary Injection
When a compaction summary exists for the session:
- Prepended to system prompt: `"Prior conversation summary (compressed for context): [summary]"`
- Capped at 800 chars

### Summarizer Fallback Chain
Gemini 2.5 Flash Lite → Groq → GPT-4o-mini (max 300 tokens output)

---

## 19. Triage Levels

Maps to the Gambian health system tiers:

| Level | Gambian Tier | Action |
|-------|-------------|--------|
| SELF_CARE | Tier 1 — Self-care + community | Patient at home, Amina + CHW + family |
| CHW_VISIT | Tier 2 — CHW home visit | Within 24-48 hours |
| FACILITY | Tier 3 — Health post / health centre | Within 24 hours |
| EMERGENCY | Tier 4 — Regional hospital / EFSTH | Call 199 immediately |

---

## 20. Response Format Rules (Hard Rules)

From `AMINA_SYSTEM_PROMPT` lines 199-218:

### Style
- MAX 80 words (unless emergency or structured plan)
- Short sentences, no fluff
- Gambian aunt voice: direct, kind, specific
- Never use filler phrases
- Never give generic advice unless tied to what they said

### Content
- Answer ONLY their actual question, nothing extra
- Give SPECIFIC numbers, times, local foods, named places
- Not "drink water" → "2 glasses now, 1 before bed"
- If info is thin: ask ONE short question OR nudge to the right form
- For symptoms: give ONE concrete next step

### Format
- No bullet lists unless genuinely 3+ distinct checklist items
- No sign-offs

### Critical Rule
- Read user's message carefully, respond to THEIR specific question
- Do NOT ignore their question to give a generic health introduction
- If request is outside healthcare: politely redirect

---

## 21. DHIS2 Integration

(`amina_agent.py:1253-1259`)

After medication safety gate blocks:
```python
bump_daily_counter(region, "AMINA_SAFETY_BLOCKS", amount=1)
```

Tracks safety interventions per region for national health reporting.

---

## 22. Regeneration Behavior

When user requests a regenerated response:
- Temperature bumped by `_REGEN_TEMPERATURE_BUMP` (0.15) above base 0.5
- Same pipeline runs again with slightly more creative output
- Ensures different wording while maintaining clinical accuracy

---

## Appendix A: Key File Map

| File | Role |
|------|------|
| `src/agent/amina_agent.py` | Main agent — pipeline, routing, prompt assembly, post-processing |
| `src/agent/prompts.py` | System prompts (AMINA_SYSTEM_PROMPT, triage, diet, medication, bilingual) |
| `src/agent/orchestrator.py` | ToolOrchestrator — 22 tools registered |
| `src/agent/memory_manager.py` | 3-tier memory (Redis, ArcadeDB, ArcadeDB+vectors) |
| `src/services/greeting.py` | 7-layer greeting: ethnic language, time, special days, trust tier |
| `src/services/empathy.py` | Emotional state classification, assertiveness 1-5 |
| `src/services/context_compactor.py` | Background conversation compaction |
| `src/services/overflow_guard.py` | Per-model char caps, pre-trim + retry |
| `src/services/agent_tokens_fix.py` | Dynamic output token ceilings |
| `src/services/journey.py` | Multi-month vitals journey + anniversary callbacks |
| `src/services/learning.py` | Outcome tracking, behavior profiles, knowledge promotion |
| `src/services/citations.py` | Source citations for health responses |
| `src/services/referrals.py` | VHW referral lookup + greeting line |
| `src/safety/medication_gate.py` | Pre-LLM medication request classifier |
| `src/safety/medication_responses.py` | Safe templated medication responses |
| `src/safety/audit_log.py` | Medication query audit logging |
| `src/tools/emergency.py` | Emergency detection + response |
| `src/tools/triage.py` | Triage assessment tool |
| `src/tools/care_plan.py` | Care plan generation |
| `src/tools/ramadan.py` | Ramadan medication guidance |
| `src/tools/nudges.py` | Lifestyle nudges (day-of-week rotation) |
| `src/tools/community_support.py` | Community support paths (permission/stigma/fear/cost) |
| `src/tools/who_diabetes.py` | WHO PEN diabetes protocol |
| `src/tools/who_hypertension.py` | WHO PEN hypertension protocol |
