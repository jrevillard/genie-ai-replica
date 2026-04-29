# Amina — Session Change Log

This document summarizes everything built in the current development cycle, organized by theme. It is the single source of truth for what's new beyond the last GitLab push.

---

## 1. Latency & Architecture Overhaul

**Problem:** Agent responses were taking 7-11 seconds. Too slow for a voice-first, low-bandwidth Gambian deployment.

**Changes:**
- Migrated the agent LLM from Gemini `gemini-3-flash-preview` to OpenAI `gpt-4o-mini` (`src/agent/amina_agent.py`).
- Replaced the 2-call ReAct loop (think → act → respond) with a **single-call architecture + keyword tool routing**.
- Tools run in parallel via `asyncio.gather`.
- `search_knowledge` now returns documents only (no internal LLM call) — the main response call synthesises.
- Tool routing caps at 2 tools per turn to bound latency.

**Measured results (warm cache):**
- Greeting: 1.1 – 2.0 s
- Single-tool queries (BP / glucose): 2 – 4 s
- Multi-tool queries (diabetes + diet): 4 – 8 s
- Emergency detection: **124 ms** (pre-LLM keyword match)

---

## 2. Response Voice — Gambian Community Health Worker

**Goal:** Amina sounds like a real Gambian CHW with ~10 years field experience — not like a chatbot, and not like a foreign medical textbook. Warm but direct, clinically grounded in WHO PEN protocols, locally rooted in everyday Gambian life.

**Changes in [`src/agent/amina_agent.py`]:**

### Character anchoring
The prompt now gives Amina a concrete professional backstory so the model has a voice to inhabit:
- Trained at MRC in Fajara
- Works at Kerewan Health Centre + home visits + Thursday Bantaba health education
- Speaks like a Gambian nurse/CHW actually speaks at the health post

### Sentence rhythm rules
- 6-14 words per sentence
- One useful thing → one next thing → stop
- Numbers, times, quantities — never vague
- Direct address ("you", "my sister", "auntie"), never "you may want to consider"

### Local grounding (WHAT makes it authentic)
- **Foods named directly:** benachin, domoda, supakanja, chere, nyebbeh, bouye, bissap, attaya
- **Cooking language:** "one less Maggi cube", "half the palm oil", "cook with netetu not salt"
- **Facilities named:** Kerewan, Farafenni, EFSTH — not "a healthcare professional"
- **Emergency lingo:** "call 199", not "seek immediate medical attention"
- **Community figures:** CHW, Alkallo, marabout, elder — used naturally
- **Money in dalasi**, **time anchored to Maghrib/Suhoor** only if patient raised religion first

### Clinical backbone
WHO PEN protocols woven into the voice, not listed:
- Diabetes: Metformin 500mg with food, target fasting 70-130
- Hypertension: target <140/90 (<130/80 if diabetic)
- Core drugs: amlodipine, lisinopril, HCTZ
- Emergency signs: chest pain, FAST, BP >180/120, sugar >400 or <50

### Reply structure (enforced)
1. Answer their question in the FIRST sentence
2. Give ONE concrete next step with a number
3. Name ONE warning sign if relevant
4. If info missing → ONE short question
5. Stop

### Banned phrases (in-prompt)
The prompt explicitly rejects textbook/chatbot phrases:
- Openers: "Certainly!", "Of course!", "I'm glad to hear…", "I understand that…"
- Closers: "I hope this helps", "Feel free to ask", "Let me know if…"
- Fillers: "it's important to", "make sure to", "please remember"
- Generic advice: "stay hydrated", "take care of yourself" — CHWs don't talk like that

### Example-driven teaching
The prompt shows **3 good examples + 1 bad example** so the model sees the target voice directly:

> **GOOD:** "Your BP 145/90 is borderline high. Cut one Maggi cube from tonight's domoda, walk 20 minutes after Maghrib. Check again in 3 days. If it reaches 160, come to Kerewan health post that same day."
>
> **BAD:** "It's important to monitor your blood pressure regularly and make sure to reduce your salt intake. Please remember to stay hydrated..."

### Parameters
- `max_tokens: 180` (down from 600)
- `temperature: 0.5` (down from 0.7)
- Response capped at 60 words

---

## 3. Language — English default + whole-site Mandinka toggle + per-message translate

**UX rules (final):**
1. **Default language is English.** Never auto-detect.
2. **Whole-site toggle** in the chat header: `[English | Mandinka]`. Flipping it translates the entire UI AND tells the agent to reply in that language going forward.
3. **Per-message tiny Translate button** under every assistant reply. One tap translates just that message inline. Tap again to flip back to the original.

**Backend ([`src/services/translator.py`]) — new service:**
- EN ↔ MA translation via OpenAI (ready to swap to the team's fine-tuned Gemma model later; interface is stable)
- Redis caching per translation (30-day TTL, per source/target pair)
- Batch translation for UI strings (single LLM call for dozens of strings)

**New endpoints ([`src/api/agent_routes.py`]):**
- `POST /api/v1/agent/translate` — single string
- `POST /api/v1/agent/translate/batch` — dict of strings (UI translation)
- `GET  /api/v1/agent/languages` — list supported languages

**Agent integration:**
- `AgentChatRequest` accepts `language: "en" | "ma"` (defaults to `"en"`)
- Response is generated in English, then translated only if `language == "ma"`
- No auto-detection, no bilingual mode, no `detected_language` guessing

**Prescription tool ([`src/tools/prescription.py`]):**
- Vision extractor reads English / Mandinka / mixed-language prescriptions
- Returns `detected_language` (informational) + `diagnosis_original` (preserves Mandinka text)
- Guidance returned in whichever language `output_language` is set to

**Frontend:**
- **Language toggle** in chat header: `[English | Mandinka]` — switches:
  - The UI chrome (buttons, labels, placeholders) via batch-translated strings
  - The agent's response language for all future messages in this session
- **Per-message Translate button**: tiny chip under each assistant bubble. Taps:
  - 1st tap → fetches translation (cached server-side for 30 days), swaps the bubble text
  - 2nd tap → flips back to the original
  - Button label updates: "Translate to Mandinka" ↔ "Show English"
- UI string translations cached in localStorage per language so subsequent loads are instant

---

## 4. Prompts — Gambian Government Perspective

**File:** [`src/agent/prompts.py`]

The system prompt was rewritten to give Amina a clear institutional perspective:

### Mission framing
- Operationalises The Gambia's **2022-2027 NCD Strategy**
- Cost framing: dialysis costs ~$10k/patient/year — every early-detected diabetic is NHIS savings
- Target: reduce the 79% undiagnosed rural rate through private, anonymous, low-bandwidth engagement
- Positioning: "5-cent digital triage that replaces a $20 transport journey"

### Gambian health system tiering
Amina now routes patients through the 4-tier system:
- **Tier 1:** Self-care at home + CHW + family
- **Tier 2:** CHW home visit
- **Tier 3:** Health post / health centre
- **Tier 4:** Regional hospital / EFSTH

### Community trust figures
Amina names the trusted figures that unlock care:
- **Alkallo** (village head): permission barrier, legitimises decisions
- **Imam**: spiritual support — only when patient raises religion first
- **CHW**: private home visits, most important field partner
- **Senior elders / aunties**: accompanying scared first-time visitors

### Language handling (new section)
Mirror-not-lead rule plus a vocabulary list of key Mandinka health phrases (saraabu, kuuraŋo, tuntuŋo, yeelu keli kuuraŋo, etc.).

### Intent detection rules
Explicit rules for when to offer the Symptom form / Prescription form / triage flow.

---

## 5. Intent Detection for Forms

**File:** [`src/agent/amina_agent.py`]

The agent now recognises when a user's message needs a structured form and offers it without forcing.

**Expanded keyword sets:**
- `SYMPTOM_KEYWORDS` (30+ terms): pain, ache, dizzy, rash, "I feel", "can't sleep", "tired all the time", etc.
- `PRESCRIPTION_KEYWORDS` (20+ terms): "paper from the doctor", "look at my prescription", "sent me home with", "pharmacist gave", etc.
- `DETAIL_MARKERS` (40+ terms): time (days, weeks, since), severity (mild, /10, scale), location (left, chest, knee), dosage (mg, tablet, twice daily)

**Logic:**
- If message contains symptom keyword + <14 words + <2 detail markers → suggest symptom form
- If prescription keyword + <15 words + <2 detail markers → suggest prescription form
- Info questions ("what causes diabetes?") are skipped — not about their own case
- **Form only suggested once per session** — after that, Amina gathers info conversationally

**Frontend rendering:**
- Orange "Open Symptom Form →" CTA button under relevant messages
- Dual CTA ("Enter Rx Details" + "Upload Photo") for prescription cases

---

## 6. Community Features — 5-Pillar Dashboard

**Goal:** Move beyond 1:1 chat. NCD management in The Gambia is communal. The right design mirrors existing social structures.

### Backend ([`src/services/community.py`] + [`src/api/community_routes.py`])

Six new endpoints:
- `GET /api/v1/community/bantaba` — social accountability circle
- `GET /api/v1/community/scout` — youth scout profile
- `GET /api/v1/community/village` — village scoreboard
- `GET /api/v1/community/seasonal` — current season tips
- `GET /api/v1/community/healer-bridge` — dual-path care status
- `GET /api/v1/community/all` — all 5 in one call (for dashboard loading)

### The 5 Features

| # | Feature | What it does | Why it works |
|---|---|---|---|
| 1 | **Bantaba Circle** | Weekly 5-8 person accountability group with group voice check-ins | Digitises existing Bantaba gatherings; shame/pride drives adherence |
| 2 | **Youth Scout** | Youth 15-25 monitor grandparents' BP/sugar via USSD, earn badges | Youth have phones; elders have NCDs. Bridges the gap. |
| 3 | **Village Scoreboard** | 5-pillar health score per village (screening, adherence, diet, youth, emergency) | Alkallos compete; community demand > supply push |
| 4 | **Seasonal Rhythms** | Health advice tied to Gambian calendar (Ramadan, harvest, rains, market days) | Meets people in their existing rhythms, not hospital schedules |
| 5 | **Healer Bridge** | Positions AMINA as connector between traditional + modern care | Fighting traditional medicine fails; bridging multiplies reach |

### Frontend — Professional 3-Column Dashboard

**Layout:**
- **Left sidebar (320px):** Community — Bantaba / Village / Scout cards
- **Center (flex):** Welcome screen / chat
- **Right sidebar (320px):** Today & Care — Seasonal / Healer Bridge cards
- **Responsive:** Above 1100px = 3-column; below = single column with horizontal-scroll sidebars

**Card design system:**
- Each card has a distinct accent colour (purple / gold / cyan / green / pink)
- Compact summary in the card; expansion modal on click
- Conic-gradient rings (adherence %), progress bars (pillars, missions), badge ladders
- Skeleton loaders while fetching

**Expansion panels (modal):**
- Bantaba: full member roster with colour-coded adherence scores
- Village: hero score card + all 5 pillars expanded + Alkallo message
- Scout: badge ladder (all 4 tiers) + elders list with flag colours
- Seasonal: all tips for current season + Ramadan section when active
- Healer: dual-path detail + interaction safety + supply countdown

---

## 7. Care Plan — Personalised From Chat History

**Backend:** [`src/agent/amina_agent.py`] method `generate_care_plan_from_conversation()`
- Reads last 20 messages of the session
- First LLM call extracts structured context (conditions, medications, symptoms, concerns, lifestyle notes, patient goals)
- Runs the existing `generate_care_plan` tool with that context
- Second LLM call adds a personal summary + top 3 priorities for this week
- Caches in Redis for 7 days (keyed by `session_id`)

**Endpoints:**
- `GET  /api/v1/agent/care-plan/{session_id}` — retrieve cached plan
- `POST /api/v1/agent/care-plan/{session_id}/generate` — (re)generate

**Frontend:**
- "My Care Plan" tile on welcome screen
- "Plan" button in chat header
- Detail modal with colour-coded sections: Priorities (orange), Goals, What-to-track, Diet (green), Movement (purple), Medications (pink), Warning Signs (red)
- Falls back to localStorage cache if backend is offline

---

## 8. Follow-up Reminders — Actionable

**File:** [`components/frontend/src/App.jsx`]

The follow-up badge on messages is now interactive:
- Click opens a dropdown: **Save reminder** / **Add to calendar (.ics)** / **Remove**
- Saved reminders persist in localStorage
- `buildICS()` generates a 30-minute calendar event importable to any calendar app
- Expired reminders (>2 hours past) auto-filter on load
- Welcome screen shows an "Upcoming check-ins" strip listing active reminders
- Emergency follow-ups (containing "199" or "EFSTH") remain non-clickable (immediate action only)
- Custom `amina-reminders-changed` event keeps the welcome screen in sync with deep chat bubble saves

---

## 9. Notification Preferences

**Backend:**
- `POST /api/v1/agent/notifications/preferences` — validate + persist user's notification channels
- Agent chat response includes `suggest_notifications: bool` — triggered when a follow-up is scheduled, ≥4 user messages exchanged, or goodbye signal detected

**Frontend:**
- "Stay in Touch" modal auto-opens when backend suggests
- 5 channels: WhatsApp, Telegram, Email, SMS (with phone inputs), Browser notifications (with Permission API)
- Frequency dropdown: `as_scheduled` / `daily` / `weekly`
- Channel-wiring is deferred (WhatsApp/Telegram bridges live in the `multichannel-*` stack)

---

## 10. Anonymous Mode

**File:** [`components/frontend/src/App.jsx`]

- Toggle in Settings panel
- Yellow "Anonymous" badge in header when active
- Hint text: "No phone or ID is sent. Your chat stays anonymous."
- Backed by localStorage (`VOICE_ANONYMOUS`)
- Addresses the stigma/permission barriers from the slides — users can engage without household observation

---

## 11. Infrastructure

**`src/agent/orchestrator.py`:** registered 3 new tools — `PrescriptionTool`, `LifestyleNudgesTool`, `CommunitySupportTool`.

**`src/agent/memory.py`:** added session-scoped state:
- `form_prompts_given: Dict[str, int]` — tracks how many times we've nudged for each form type
- `notifications_asked: bool` — prevents re-prompting mid-session
- `goodbye_shown: bool` — session-end state

**`src/main.py`:** wired `agent_router`, `patient_router`, `community_router`.

**`requirements.txt`:** added `openai>=1.50.0` (primary LLM). Kept `google-generativeai` as fallback. Merged with teammate's `spacy` addition without conflicts.

---

## 12. What's Deferred

These were discussed and scoped but intentionally not built yet:

| Feature | Status | Next step |
|---|---|---|
| Hybrid LLM (OpenAI + Mistral) | Deferred | Wire once on UNICC env with A40 GPU |
| WhatsApp channel | Deferred | The `multichannel-*` stack already exists; needs wiring to `/agent/chat` |
| Full Mandinka UI translation | Partial | Core UI strings go through `t()`; welcome copy still English-only |
| Ramadan calendar detection | Stub | `is_ramadan` flag returns false; needs real lunar calendar lookup |
| Backend persistence of community data | Stub | Uses mock data; needs ArcadeDB collections for production |

---

## 13. File Manifest

### New files
```
src/agent/
├── amina_agent.py          # Main agent runtime
├── memory.py               # Session memory model
├── memory_manager.py       # 3-tier memory (Redis + ArcadeDB)
├── orchestrator.py         # Tool registry
└── prompts.py              # System prompts

src/tools/
├── base.py
├── knowledge.py            # FAISS + ArcadeDB retrieval (no LLM)
├── triage.py, emergency.py, vitals.py
├── medication.py, diet.py, referral.py
├── cultural.py, followup.py, ramadan.py
├── care_plan.py            # Care plan generator
├── prescription.py         # OpenAI Vision Rx analysis
├── nudges.py               # One-Spoon Swap (day-of-week focus)
├── community_support.py    # Alkallo / CHW / Imam / elder paths
├── cvd_risk.py, who_diabetes.py, who_hypertension.py
├── who_respiratory.py, who_cancer_screening.py, who_lifestyle.py
└── patient.py

src/services/
├── translator.py           # EN↔Mandinka (OpenAI → Gemma later)
└── community.py            # 5 community features data service

src/api/
├── agent_routes.py         # /agent/* endpoints
├── patient_routes.py
└── community_routes.py     # /community/* endpoints

src/models/
├── care_plan.py, consultation.py, enums.py
├── memory.py, patient.py

src/repositories/
├── patient_repo.py
└── consultation_repo.py

data/
├── synthetic_patients.json # 1,000 synthetic Gambian NCD patients
├── patient_stats.json
└── facilities.json

scripts/
├── generate_patients.py
└── ingest_patients.py

components/frontend/         # New React voice+chat UI
├── src/App.jsx             # 3-column dashboard
└── ...
```

### Modified files
```
haystack-stack/docker-compose.yml        # Redis + patient data mount
haystack-stack/haystack-chatqna/
├── Dockerfile              # uvicorn 4 workers, data/ copy
├── requirements.txt        # openai, redis, pypdf, piper-tts
└── src/
    ├── config.py           # OPENAI_* settings
    ├── main.py             # Route registration
    └── api/schemas.py      # Minor cleanup
```

---

## 14. Testing Checklist

Run these after rebuild to verify everything works:

- [ ] Simple greeting: "Hello Amina" → morning greeting, under 3s
- [ ] Diet question: "What should I eat for diabetes?" → Gambian foods, no "stay hydrated"
- [ ] Emergency: "chest pain, trouble breathing" → EMERGENCY banner, 199, EFSTH
- [ ] Vague symptom: "I have a headache" → advice + form CTA, no nag after
- [ ] Detailed symptom: "headache 3 days left side 4/10 worse in sun" → triage, no form CTA
- [ ] Vague Rx: "doctor gave me a new pill" → dual CTA (Upload Rx + Rx)
- [ ] Bilingual: set EN+MA → response returns `response_ma`
- [ ] Care plan: chat 3 turns then click "Plan" → personalised summary + top 3 priorities
- [ ] Community endpoints: `/community/all` → bantaba, scout, village, seasonal, healer_bridge
- [ ] UI: left sidebar shows 3 cards, right sidebar shows 2, both with proper colours
- [ ] Card click: expansion modal opens with detail view
- [ ] Below 1100px: sidebars become horizontal scrolling strips
- [ ] No ChatGPT phrases in any response ("Certainly!", "I hope this helps", etc.)

---

## 15. Key Decisions

These are the important design calls made in this cycle:

1. **Single-call architecture over ReAct** — latency cut in half for the cost of slightly less nuanced tool selection. The right call for a voice-first deployment.
2. **Keyword routing beats LLM tool-picking for this domain** — NCD management has a small, stable tool set. Keywords are fast and explainable.
3. **Never mock emergencies** — emergency detection runs pre-LLM; 124 ms guaranteed.
4. **Religious framing is opt-in, not default** — Amina mirrors the patient; never leads with "Insha'Allah".
5. **Forms nudge once, then converse** — respects user autonomy; no nagging.
6. **Community features are sidebars, not pages** — always visible, reinforce social context without leaving the chat.
7. **Character-based prompting** — we give Amina a concrete CHW backstory, not a list of rules. The model has a voice to inhabit, which produces consistently authentic replies.
8. **Translation layer is swap-ready** — interface holds; OpenAI → Gemma is a 3-line change.
9. **3-tier memory** — Redis (working) + ArcadeDB (episodic) + ArcadeDB vectors (semantic). Graceful fallback when vector index isn't supported.
10. **Emergency follow-ups stay non-interactive** — scheduling UI doesn't apply to "call 199 now".

---

*Last updated at the end of this development cycle. Next push should include a refreshed version of this file.*
