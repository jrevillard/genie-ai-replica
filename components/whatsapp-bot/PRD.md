# WhatsApp Bot — Product Requirements Document

**Project:** Genie AI NCD Health Assistant — WhatsApp Channel\
**Version:** 1.0.0\
**Last Updated:** 2026-04-21\
**Author:** Peter Velosy\
**Status:** Draft

---

## Table of Contents

1. [Overview & Vision](#1-overview--vision)
2. [Scope & Boundaries](#2-scope--boundaries)
3. [User Personas](#3-user-personas)
4. [Architecture](#4-architecture)
5. [Functional Requirements](#5-functional-requirements)
6. [Conversational Flows](#6-conversational-flows)
7. [WhatsApp Message Template Catalog](#7-whatsapp-message-template-catalog)
8. [API Contracts](#8-api-contracts)
9. [Data Model](#9-data-model)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Cost Model & Budget](#11-cost-model--budget)
12. [Risk Mitigation](#12-risk-mitigation)
13. [Testing Strategy](#13-testing-strategy)
14. [Glossary](#14-glossary)

---

## 1. Overview & Vision

### 1.1 Purpose

This document specifies the WhatsApp Bot component of the Genie AI NCD Health Assistant, a multi-channel digital assistant delivering evidence-based information and personalized guidance for non-communicable diseases (hypertension, stroke, diabetes, cancer, chronic respiratory conditions, and mental health) to the population of The Gambia.

WhatsApp is the **primary outreach channel** because it is already widely used in The Gambia, requires no new app installation, works on low-bandwidth connections, and reaches users where they already are.

### 1.2 Product Vision

A WhatsApp-based health assistant that any Gambian can message to receive trustworthy, personalized NCD prevention and management guidance — lowering barriers to healthcare information, supporting behavior change, and reducing demand on overstretched health systems.

### 1.3 Relationship to IEEE-ITU GenAI for Good Challenge

This bot fulfills the WhatsApp channel commitments made in the Young AI Leaders Linz Hub submission for the GenAI for Good Challenge (Health use case, SDG 3 — Good Health and Well-Being). Specifically:

- Mobile-friendly, accessible, multi-channel chat interface (WhatsApp as primary)
- Patient risk assessment and risk profile tracking via chatbot
- Vital data and habit tracking driven by chatbot interactions
- Server-initiated WhatsApp messages (scheduled nudges, campaign notifications)
- User feedback collection for RLHF
- Gender-sensitive, low-bandwidth-optimized interactions
- Support for both text messages and voice notes (via external STT/TTS microservice)

### 1.4 Default Remote Instance

The bot connects to the Genie AI backend deployed at **`https://app.youngailinz.org/`** by default. This is configurable via environment variables for local development and staging.

---

## 2. Scope & Boundaries

### 2.1 In Scope (this PRD / this codebase)

| Area | Description |
|------|-------------|
| **WhatsApp webhook server** | Receives and responds to user messages via the WhatsApp Cloud API |
| **Conversation orchestration** | Routes user messages to the Genie AI backend, formats and returns responses |
| **User lifecycle management** | Auto-creates Genie AI accounts for new phone numbers, associates known numbers with existing users |
| **Voice note handling** | Downloads voice notes, sends to STT microservice, processes text, optionally returns TTS audio |
| **Risk assessment flow** | Guides users through an NCD risk questionnaire via the LLM |
| **Behavior-support nudges** | Sends scheduled WhatsApp messages based on user risk profile (using pre-approved templates) |
| **User feedback collection** | Collects response quality ratings after chatbot answers |
| **Message template management** | Defines and sends pre-approved WhatsApp message templates |
| **Webhook signature verification** | Validates incoming webhooks from Meta |

### 2.2 Out of Scope (handled by other services/repos)

| Area | Owner |
|------|-------|
| **Genie AI backend** (auth, chat history, query/RAG pipeline, user profiles, service categories, analytics) | `components/gov-chat-backend/` |
| **Phone number field on user model** | Backend team (must add `phoneNumber` field to `users` collection) |
| **STT/TTS microservice** | Separate repo/service (called via HTTP) |
| **Vital Data & Habit Tracker service** | Separate Django service (will be integrated when ready) |
| **GovStack tool integrations** (registration, appointment scheduling) | Backend team (LLM-callable tools) |
| **Admin campaign dashboard** (compose/schedule campaign messages) | `components/gov-chat-frontend/` admin panel |
| **Mobile applications** | `mobile/` |
| **RAG ingestion pipeline** | `genie-ai-overlay/dataprep/` |

### 2.3 Integration Points

```
                                    ┌─────────────────────┐
                                    │  Meta WhatsApp      │
                                    │  Cloud API          │
                                    └────────┬────────────┘
                                             │ webhooks / REST
                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WhatsApp Bot Service                       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌───────────┐ │
│  │ Webhook  │  │ Conversation │  │ Template  │  │ Scheduler │ │
│  │ Handler  │  │ Orchestrator │  │ Sender    │  │ (nudges)  │ │
│  └──────────┘  └──────────────┘  └───────────┘  └───────────┘ │
└───────┬──────────────┬──────────────────┬───────────────────────┘
        │              │                  │
        ▼              ▼                  ▼
┌──────────────┐ ┌───────────────┐ ┌──────────────────┐
│ Genie AI     │ │ STT/TTS       │ │ Vital Data &     │
│ Backend API  │ │ Microservice  │ │ Habit Tracker    │
│ (remote)     │ │               │ │ (future)         │
└──────────────┘ └───────────────┘ └──────────────────┘
```

---

## 3. User Personas

### 3.1 Bakary — Citizen with NCD risk factors (Primary)

- **Age:** 42, male, market vendor in Brikama
- **Device:** Basic Android phone, WhatsApp user
- **Literacy:** Functional English, prefers simple language
- **Needs:** Headache/dizziness explanation, smoking cessation support, blood pressure guidance
- **Pain points:** No time for clinic visits, no personalized health advice, generic information online
- **Channel:** WhatsApp only (no app install)

### 3.2 Fatou — NCD patient (Secondary, cross-channel)

- **Age:** 52, female, hypertensive and diabetic
- **Device:** Smartphone with mobile app installed (by nurse at clinic)
- **Needs:** Medication reminders, diet guidance, vital data tracking, blood pressure/sugar explanations
- **Pain points:** Complex medical jargon, forgets medications, no easy way to share vitals with doctor
- **Channel:** Primarily mobile app, but also uses WhatsApp for quick questions and receives nudge messages

### 3.3 Awa — Ministry of Health admin (Tertiary)

- **Age:** 36, female, health promotion officer
- **Needs:** Send campaign messages (screening day reminders, prevention campaigns), view engagement metrics
- **Channel:** Admin dashboard (not WhatsApp) — triggers campaign messages that are delivered via WhatsApp
- **Interaction with bot:** Indirect — creates campaign templates and schedules; the bot delivers them

---

## 4. Architecture

### 4.1 Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Runtime** | Node.js 20+ (LTS) | Best WhatsApp Cloud API library ecosystem; consistent with Genie AI backend |
| **Language** | TypeScript (strict mode) | Type safety, verifiable codebase per project requirement |
| **Framework** | Fastify 5.x | High performance, schema validation built-in, TypeScript-first |
| **Database** | PostgreSQL 16 | Relational data (session state, scheduled messages, delivery logs); required by submission |
| **ORM** | Drizzle ORM | Type-safe, SQL-first, lightweight |
| **Job scheduler** | BullMQ + Redis | Reliable scheduled message delivery (nudges, campaigns) |
| **HTTP client** | undici (built-in) | Calling Genie AI backend API and STT/TTS service |
| **Containerization** | Docker | Consistent deployment |
| **Logging** | pino | Structured JSON logging, Fastify-native |
| **Testing** | vitest | Fast, TypeScript-native |

### 4.2 Why Node.js/TypeScript (not Django/Python)

The submission originally specified Django. After evaluation, Node.js/TypeScript was chosen because:

1. **Type hints requirement** — TypeScript provides compile-time type checking across the entire codebase, stronger than Python's runtime-optional type hints
2. **WhatsApp Cloud API ecosystem** — The official `whatsapp-cloud-api` patterns and Meta's webhook examples are Node.js-first
3. **Consistency** — The Genie AI backend is Node.js/Express, reducing cognitive overhead for the team
4. **Performance** — Fastify handles high-concurrency webhook traffic efficiently

### 4.3 Deployment Architecture

```
┌──────────────────────────────────────────────────────┐
│                    AWS / Cloud Host                   │
│                                                      │
│  ┌────────────┐    ┌──────────────────────────────┐  │
│  │ Cloudflare │───▶│  ALB / Reverse Proxy         │  │
│  │ (DDoS)     │    └──────────┬───────────────────┘  │
│  └────────────┘               │                      │
│                               ▼                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  WhatsApp Bot (Fastify)                        │  │
│  │  - Webhook endpoint: POST /webhook             │  │
│  │  - Health check:     GET  /health              │  │
│  │  - Verify endpoint:  GET  /webhook (challenge) │  │
│  └──────────┬─────────────────┬───────────────────┘  │
│             │                 │                       │
│     ┌───────▼──────┐  ┌──────▼───────┐               │
│     │ PostgreSQL   │  │ Redis        │               │
│     │ (sessions,   │  │ (BullMQ job  │               │
│     │  logs, etc.) │  │  queue)      │               │
│     └──────────────┘  └──────────────┘               │
└──────────────────────────────────────────────────────┘
```

### 4.4 Environment Variables

```bash
# WhatsApp Cloud API
WHATSAPP_API_VERSION=v21.0
WHATSAPP_PHONE_NUMBER_ID=<from Meta Business>
WHATSAPP_ACCESS_TOKEN=<permanent system user token>
WHATSAPP_VERIFY_TOKEN=<random string for webhook verification>
WHATSAPP_APP_SECRET=<for webhook signature validation>

# Genie AI Backend
GENIEAI_API_BASE_URL=https://app.youngailinz.org/api
GENIEAI_API_TIMEOUT_MS=30000

# STT/TTS Microservice
STT_SERVICE_URL=http://stt-tts:8000
STT_TIMEOUT_MS=15000
TTS_ENABLED=true

# Vital Data & Habit Tracker (future)
VITALS_SERVICE_URL=
VITALS_ENABLED=false

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/whatsapp_bot

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# Server
PORT=3002
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
```

---

## 5. Functional Requirements

### 5.1 Webhook Handling

#### FR-WH-01: Webhook Verification

The bot must handle Meta's webhook verification challenge:
- `GET /webhook` with query params `hub.mode`, `hub.verify_token`, `hub.challenge`
- Return `hub.challenge` if `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`
- Return 403 otherwise

#### FR-WH-02: Webhook Signature Validation

All incoming `POST /webhook` requests must be validated:
- Compute HMAC-SHA256 of the raw request body using `WHATSAPP_APP_SECRET`
- Compare with the `X-Hub-Signature-256` header
- Reject with 401 if signature does not match
- Always return 200 to Meta (even if processing fails) to prevent webhook retries

#### FR-WH-03: Message Deduplication

- Track received message IDs in a short-lived cache (Redis, 24h TTL)
- Skip processing if a message ID has already been seen
- Meta may deliver the same webhook multiple times

#### FR-WH-04: Message Type Handling

| Message Type | Action |
|-------------|--------|
| `text` | Extract body, send to conversation orchestrator |
| `audio` | Download media, send to STT service, process transcribed text |
| `image` | Reply with "I can only process text and voice messages for now" |
| `document` | Reply with "I can only process text and voice messages for now" |
| `interactive` (button reply) | Extract button payload, route to orchestrator |
| `interactive` (list reply) | Extract selected row ID, route to orchestrator |
| `reaction` | Ignore (return 200, no response) |
| `sticker` | Ignore (return 200, no response) |
| `location` | Store if relevant to user profile (region), acknowledge |
| `contacts` | Ignore (return 200, no response) |

#### FR-WH-05: Status Updates

Process delivery status callbacks (`statuses` array in webhook payload):
- `sent`, `delivered`, `read`, `failed` — log to `message_delivery_log` table
- On `failed`: log error code, increment failure counter for the phone number

### 5.2 User Lifecycle

#### FR-UL-01: First Contact — New User

When a message arrives from an unknown phone number:

1. Call `POST /api/auth/register` on Genie AI backend with:
   - `loginName`: `wa_<country_code><number>` (e.g., `wa_2201234567`)
   - `email`: `wa_<number>@whatsapp.genieai.placeholder` (synthetic, non-deliverable)
   - `password`: randomly generated 32-char string (user never needs it)
   - `phoneNumber`: the full E.164 phone number (requires backend to support this field)
2. Store the mapping `phone_number → genieai_user_id` in the local `wa_users` table
3. Obtain an auth token via `POST /api/auth/login`
4. Cache the token (refresh before expiry using `POST /api/auth/refresh-token`)
5. Send the welcome message (see FR-CF-01)

#### FR-UL-02: Returning User

When a message arrives from a known phone number:

1. Look up `genieai_user_id` from `wa_users`
2. Use cached auth token (refresh if expired)
3. Route message to conversation orchestrator

#### FR-UL-03: Account Linking

If a user already has a Genie AI account (e.g., from the mobile app) and later messages the bot:

- The backend's phone number lookup (`GET /api/users?phoneNumber=<number>`) returns the existing user
- The bot associates the WhatsApp session with the existing account
- Chat history from the mobile app is accessible as context for the LLM

#### FR-UL-04: User Opt-Out

If a user sends "STOP", "stop", "unsubscribe", or "opt out":

1. Cancel all scheduled messages for this phone number
2. Mark user as opted out in `wa_users`
3. Send confirmation: "You have been unsubscribed from all messages. Send any message to re-subscribe."
4. Do not delete the user account — they can re-subscribe by messaging again

### 5.3 Conversation Orchestration

#### FR-CO-01: Message Processing Pipeline

```
User message (text or transcribed audio)
  │
  ▼
┌─────────────────────────────┐
│ 1. Check for special commands│  (/help, /stop, /feedback, /language, etc.)
│    If match → handle directly│
│    Else → continue           │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ 2. Create or retrieve       │  POST /api/chat-history/conversations
│    active conversation      │  (one active conversation per user,
│                              │   auto-rotate after 24h inactivity)
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ 3. Submit query to          │  POST /api/queries
│    Genie AI backend         │  (includes conversation history as context)
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ 4. Format response for      │  - Strip markdown (or convert to
│    WhatsApp                  │    WhatsApp-compatible formatting)
│                              │  - Split long responses (>4096 chars)
│                              │  - Add source citations as footnotes
│                              │  - Append feedback prompt (every Nth msg)
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ 5. Send via WhatsApp        │  POST /{phone_number_id}/messages
│    Cloud API                │
└─────────────────────────────┘
```

#### FR-CO-02: Response Formatting

WhatsApp supports limited formatting. The bot must:

- Convert markdown `**bold**` to WhatsApp `*bold*`
- Convert markdown `_italic_` to WhatsApp `_italic_`
- Convert markdown headers (`##`) to `*HEADER*` with newlines
- Convert markdown lists to `• ` prefixed lines
- Strip HTML tags
- Remove images/links to internal docs (replace with summary text)
- Preserve line breaks
- Split messages longer than 4,096 characters at paragraph boundaries

#### FR-CO-03: Source Citations

When the Genie AI backend returns `source_documents` in metadata:

- Append a "Sources" section at the end of the response
- Format as: `📄 _Source: <document_title> (confidence: <score>%)_`
- Maximum 3 sources per response

#### FR-CO-04: Conversation Context

- The LLM manages all conversation state (no explicit state machine)
- The bot sends the conversation history (from the Genie AI backend) with each query
- The backend's `CONTEXT_OPTION=conversation-with-context-labels` ensures the LLM has full context
- Active conversations auto-rotate after 24 hours of inactivity (new conversation created)

#### FR-CO-05: Typing Indicator

- Send a "typing" status (`POST /messages` with `type: "reaction"` or WhatsApp's `mark_read` + typing indicator) when processing begins
- This signals to the user that the bot is working on their query

#### FR-CO-06: Error Handling

| Error Condition | User-Facing Response |
|----------------|---------------------|
| Genie AI backend unreachable | "I'm having trouble connecting right now. Please try again in a few minutes." |
| Query timeout (>30s) | "Your question is taking longer than usual. I'll send you the answer as soon as it's ready." (retry in background) |
| STT service failure | "I couldn't process your voice message. Could you please type your question instead?" |
| Rate limit exceeded | "You're sending messages very quickly. Please wait a moment before your next message." |
| Unknown error | "Something went wrong. Please try again. If this keeps happening, type /help for assistance." |

### 5.4 Voice Note Handling

#### FR-VN-01: Receive and Transcribe

1. Receive audio message webhook
2. Download media from WhatsApp CDN: `GET https://graph.facebook.com/{media_id}`
3. Forward audio to STT microservice: `POST {STT_SERVICE_URL}/stt` with audio binary
4. Receive transcribed text
5. Process transcribed text through the normal conversation pipeline
6. Prefix the response with: `🎤 _I heard: "<transcription>"_\n\n` so the user can verify

#### FR-VN-02: Text-to-Speech Response (Optional)

When `TTS_ENABLED=true` and the user sent a voice note:

1. After generating the text response, send it to: `POST {STT_SERVICE_URL}/tts`
2. Receive audio file (OGG Opus format, WhatsApp-compatible)
3. Upload audio to WhatsApp: `POST /{phone_number_id}/media`
4. Send both the text response AND the audio response
5. The text message is always sent (accessibility, low bandwidth fallback)

#### FR-VN-03: STT/TTS Service Contract

The WhatsApp bot expects the following endpoints on the STT/TTS microservice:

```
POST /stt
  Content-Type: audio/ogg  (or audio/mpeg, audio/wav)
  Body: <binary audio data>
  Response: { "text": "transcribed text", "language": "en", "confidence": 0.92 }

POST /tts
  Content-Type: application/json
  Body: { "text": "text to speak", "language": "en", "voice": "default" }
  Response: audio/ogg binary (Opus codec)
```

### 5.5 Risk Assessment

#### FR-RA-01: Triggering Risk Assessment

The risk assessment can be triggered by:

- First-time users: the welcome flow offers a risk assessment
- User request: "I want to check my health risk" / "assess my risk" / etc.
- LLM initiative: after the user describes symptoms that suggest NCD risk factors
- Periodic prompt: every 90 days, offer reassessment via scheduled template message

#### FR-RA-02: Risk Assessment Execution

The risk assessment is conducted entirely by the LLM via conversation:

- The system prompt instructs the LLM to conduct a structured risk assessment when triggered
- The LLM asks questions one at a time (age, gender, smoking status, family history, diet, physical activity, known conditions, etc.)
- The LLM can use WhatsApp interactive messages (button replies, list messages) for structured answers
- After completion, the LLM summarizes findings with a simple risk indicator (Low / Medium / High per condition area)

#### FR-RA-03: Risk Profile Persistence

After a risk assessment:

1. The LLM's structured risk summary is extracted from the conversation
2. Stored in the user's profile on the Genie AI backend (via `PUT /api/users/{id}`)
3. Risk profile includes: risk level per condition area (Hypertension/CVD, Diabetes, Cancer, Respiratory, Mental Health, Tobacco, Diet, Physical Activity)
4. This profile is included as context in all future conversations
5. Risk profile update triggers recalculation of scheduled nudge messages

### 5.6 Behavior-Support Nudges

#### FR-BS-01: Nudge Scheduling

Based on the user's risk profile, the bot schedules personalized nudge messages:

| Risk Area | Nudge Frequency | Content Source |
|-----------|----------------|----------------|
| Tobacco cessation | Daily (at user-preferred time) | WHO BHBM mActive library |
| Hypertension management | 2x/week | WHO HEARTS programme |
| Diabetes management | 2x/week | WHO BHBM mDiabetes library |
| Mental health support | 1x/week | WHO Doing What Matters in Times of Stress |
| Physical activity | 3x/week | WHO BHBM mActive library |
| Healthy diet | 2x/week | Genie AI NCD content |
| General prevention | 1x/week | Genie AI NCD FAQ content |

#### FR-BS-02: Nudge Delivery

- Nudges are delivered via pre-approved WhatsApp message templates (see Section 7)
- Sent using BullMQ scheduled jobs
- Respect user's preferred time window (default: 09:00-18:00 local time, GMT+0 for The Gambia)
- If the user has been inactive for >30 days, reduce frequency to 1x/week
- If the user has been inactive for >90 days, pause nudges and send a re-engagement template

#### FR-BS-03: Craving / Crisis Support

When a user sends a keyword indicating acute need:

| Keyword Pattern | Action |
|----------------|--------|
| "craving", "want to smoke", "tempted" | Immediate coping tips (LLM response with tobacco-specific context) |
| "stressed", "anxious", "can't sleep" | Stress management techniques (from WHO materials) |
| "emergency", "chest pain", "can't breathe" | **Immediately direct to emergency services**: "Please call 116 (ambulance) or go to the nearest health facility immediately." Do NOT provide medical advice. |

### 5.7 User Feedback

#### FR-UF-01: In-Conversation Feedback

After every 5th bot response (configurable), append a feedback prompt:

```
How helpful was this response?
👍 Helpful  |  👎 Not helpful
```

Sent as a WhatsApp interactive button message. User's selection is:
1. Logged locally in `feedback_log` table
2. Submitted to the Genie AI backend: `POST /api/queries/{queryId}/feedback`

#### FR-UF-02: Detailed Feedback (Optional)

If the user taps 👎:
- Follow up with: "Sorry about that. Could you briefly tell me what was wrong? (Type your feedback or send /skip)"
- Free-text response is logged and submitted to the backend

### 5.8 Special Commands

| Command | Action |
|---------|--------|
| `/help` or `help` | Send a help message listing available commands and explaining what the bot can do |
| `/stop` or `STOP` | Opt out of all messages (see FR-UL-04) |
| `/risk` | Start a new risk assessment |
| `/feedback` | Provide general feedback about the service |
| `/language` | Display language options (English only in v1, with note about future expansion) |
| `/about` | Display bot info, privacy notice, and link to full app |
| `/app` | Send download links for the Genie AI mobile app (when available) |
| `/facilities` | List nearby health facilities (based on stored region or ask for location) |
| `/menu` | Show a WhatsApp list message with all available actions |

### 5.9 Campaign Message Delivery

#### FR-CM-01: Campaign Message Reception

The bot exposes an internal API for the Genie AI admin dashboard to trigger campaign messages:

```
POST /api/internal/campaigns
Authorization: Bearer <internal_api_key>
{
  "template_name": "screening_campaign",
  "template_params": { "event_name": "Blood Pressure Screening Day", "date": "May 15", "location": "Brikama Health Centre" },
  "target_audience": {
    "risk_areas": ["hypertension"],    // optional: filter by risk profile
    "regions": ["Western"],            // optional: filter by region
    "all_users": false                 // true to send to everyone
  },
  "scheduled_at": "2026-05-10T09:00:00Z"  // optional: schedule for later
}
```

#### FR-CM-02: Campaign Execution

1. Query `wa_users` for matching audience
2. Filter out opted-out users
3. Enqueue messages in BullMQ with rate limiting (80 messages/second, WhatsApp limit)
4. Send using the pre-approved message template
5. Log delivery status for each recipient
6. Report aggregate delivery stats back via: `GET /api/internal/campaigns/{id}/stats`

---

## 6. Conversational Flows

### 6.1 First Contact / Welcome Flow

```
User sends first message
  │
  ▼
Bot: "Welcome to the Genie AI Health Assistant! 🏥

I can help you with:
• Understanding health risks (high blood pressure, diabetes, cancer, and more)
• Tips for healthier habits (diet, exercise, quitting smoking)
• Medication and appointment reminders
• Answering your health questions in simple language

This service is *free and confidential*.

Would you like to start with a quick health check? It takes about 3 minutes."

[Button: "Yes, let's go"] [Button: "No, I have a question"]
  │                              │
  ▼                              ▼
Start Risk Assessment        "What would you like to know?
(FR-RA-02)                    Just type your question."
```

### 6.2 Risk Assessment Flow

```
Bot: "I'll ask you a few simple questions to understand your health better.
     Let's start — how old are you?"

User: "42"

Bot: "Thanks! Are you male or female?"
[Button: "Male"] [Button: "Female"]

User taps "Male"

Bot: "Do you currently smoke or use tobacco?"
[Button: "Yes"] [Button: "No"] [Button: "I quit"]

User taps "Yes"

Bot: "About how many cigarettes do you smoke per day?"
[List: "Less than 5" | "5-10" | "10-20" | "More than 20"]

... (continues through family history, diet, exercise, known conditions) ...

Bot: "Thank you, Bakary! Here's what I found:

*Your Health Summary*

🟡 Blood Pressure Risk: *Medium*
  → Family history and smoking increase your risk

🔴 Tobacco-Related Disease: *High*
  → Smoking 10-20 cigarettes/day is a significant risk

🟢 Diabetes Risk: *Low*
  → No major risk factors identified

🟢 Respiratory Risk: *Low* (but smoking increases this over time)

I'd recommend focusing on *reducing smoking* first — it will lower several of your risks.

Would you like to:
1. Get tips to reduce or quit smoking
2. Learn how to check your blood pressure
3. Ask me anything else"

[List message with above options]
```

### 6.3 Smoking Cessation Support Flow

```
User selects "Get tips to reduce or quit smoking"

Bot: "Great choice! Let's start with a small, realistic goal.

How many cigarettes do you smoke per day right now?"

User: "About 15"

Bot: "OK. A good first step is to reduce by 2-3 per day this week.
That means aiming for about 12 per day.

When do you usually smoke the most? Pick what fits best:"
[List: "Morning" | "After meals" | "At work/market" | "Evening/night" | "When stressed"]

User: "At work/market"

Bot: "That's a common trigger. Here are 3 things you can try when you feel the urge at the market:

1. *Chew on a kola nut or gum* — keeps your mouth busy
2. *Take 5 slow breaths* — count to 4 as you breathe in, count to 6 as you breathe out
3. *Drink water* — the craving usually passes in 3-5 minutes

What time of day would you like me to send you a daily reminder with tips?"

User: "6pm"

Bot: "Done! I'll send you a short tip every day at 6:00 PM.

You can also text me *craving* any time you feel the urge, and I'll send you a quick coping tip.

You've got this! 💪"

[Scheduled: daily nudge at 18:00 GMT using template `daily_health_tip`]
```

### 6.4 General Health Question Flow

```
User: "Is attaya bad for diabetes?"

Bot: "Great question! Attaya (Gambian-style green tea) is traditionally 
prepared with a *large amount of sugar*, which can raise blood sugar levels.

*For someone managing diabetes:*
• Drinking attaya with *less sugar or no sugar* is much safer
• Having it *after a meal* (not on an empty stomach) reduces blood sugar spikes
• Limit to *1-2 small glasses per day*

A healthier alternative: try it with just a small amount of sugar, or replace 
sugar with a squeeze of lemon for flavor.

📄 _Source: WHO Diabetes Prevention Guide (confidence: 89%)_

Would you like more tips about diet and diabetes?"
[Button: "Yes"] [Button: "No, thanks"]
```

---

## 7. WhatsApp Message Template Catalog

All server-initiated messages (outside the 24h response window) require pre-approved templates. Below are the templates to register with Meta.

### 7.1 Utility Templates

#### `welcome_back`
**Category:** UTILITY\
**Language:** en\
**Body:**
```
Hello! 👋 It's been a while since we last chatted.

I'm here whenever you need health advice or support.
Just send me a message!

Reply STOP to unsubscribe.
```
**Buttons:** [Quick Reply: "Check my health risk"] [Quick Reply: "Ask a question"]

#### `opt_out_confirmation`
**Category:** UTILITY\
**Language:** en\
**Body:**
```
You have been unsubscribed from all messages from the Genie AI Health Assistant.

To re-subscribe, simply send any message to this number.
```

### 7.2 Health Nudge Templates

#### `daily_health_tip`
**Category:** MARKETING\
**Language:** en\
**Body:**
```
💡 *Daily Health Tip*

{{1}}

Reply with any question, or type "craving" if you need support right now.

Reply STOP to unsubscribe.
```
**Parameters:** `{{1}}` = tip text (variable, from WHO BHBM message libraries)

#### `medication_reminder`
**Category:** UTILITY\
**Language:** en\
**Body:**
```
⏰ *Medication Reminder*

It's time to take your {{1}}.

Did you take it?
```
**Parameters:** `{{1}}` = medication name\
**Buttons:** [Quick Reply: "Yes, taken"] [Quick Reply: "Skipped"]

#### `weekly_checkin`
**Category:** MARKETING\
**Language:** en\
**Body:**
```
📊 *Weekly Check-In*

Hi! How has your week been?

Last week's goal: {{1}}

How did it go?
```
**Parameters:** `{{1}}` = goal description\
**Buttons:** [Quick Reply: "Achieved"] [Quick Reply: "Partially"] [Quick Reply: "Not this week"]

#### `vital_reminder`
**Category:** UTILITY\
**Language:** en\
**Body:**
```
📋 It's time for your {{1}} check.

If you have your reading, send it to me now (e.g., "BP 130/85" or "sugar 6.5").

Reply STOP to unsubscribe.
```
**Parameters:** `{{1}}` = vital type (e.g., "blood pressure", "blood sugar")

### 7.3 Campaign Templates

#### `screening_campaign`
**Category:** MARKETING\
**Language:** en\
**Body:**
```
🏥 *Health Screening Event*

{{1}} on {{2}} at {{3}}.

Free screening — no appointment needed!

Reply "info" for more details or "remind" to get a reminder on the day.

Reply STOP to unsubscribe.
```
**Parameters:** `{{1}}` = event name, `{{2}}` = date, `{{3}}` = location

#### `public_health_announcement`
**Category:** MARKETING\
**Language:** en\
**Body:**
```
📢 *Health Announcement*

{{1}}

For more information, send us a message.

Reply STOP to unsubscribe.
```
**Parameters:** `{{1}}` = announcement text

### 7.4 Re-engagement Template

#### `reengagement`
**Category:** MARKETING\
**Language:** en\
**Body:**
```
Hi! We haven't heard from you in a while. 🌿

The Genie AI Health Assistant is still here to help with:
• Health questions
• Habit tracking
• Medication reminders

Would you like to continue?

Reply STOP to unsubscribe.
```
**Buttons:** [Quick Reply: "Yes, I'm back!"] [Quick Reply: "Unsubscribe"]

### 7.5 Risk Assessment Follow-Up

#### `risk_reassessment`
**Category:** MARKETING\
**Language:** en\
**Body:**
```
📋 It's been {{1}} since your last health check.

Would you like to do a quick update? It takes about 3 minutes and helps me give you better advice.

Reply STOP to unsubscribe.
```
**Parameters:** `{{1}}` = time since last assessment (e.g., "3 months")\
**Buttons:** [Quick Reply: "Yes, let's update"] [Quick Reply: "Not now"]

---

## 8. API Contracts

### 8.1 Genie AI Backend API (Consumed)

The WhatsApp bot acts as an API client to the Genie AI backend. The following endpoints are used:

#### Authentication

```
POST /api/auth/register
  Body: { loginName, email, password, phoneNumber }
  Response: { user: { _key, loginName, email } }

POST /api/auth/login
  Body: { loginName, password }
  Response: { accessToken, user: { _key, role } }

POST /api/auth/refresh-token
  Body: { refreshToken }
  Response: { accessToken }
```

#### User Management

```
GET /api/users?phoneNumber=<E.164>
  → Returns user if phone number exists (REQUIRES BACKEND ENHANCEMENT)

GET /api/users/{userId}
  → User profile including risk profile

PUT /api/users/{userId}
  Body: { riskProfile: { ... }, preferredNudgeTime: "18:00", region: "Western" }
  → Update user profile (REQUIRES BACKEND ENHANCEMENT for riskProfile field)
```

#### Chat & Queries

```
POST /api/chat-history/conversations
  Body: { title: "WhatsApp Chat", userId, categoryId? }
  Response: { _key, title, createdAt }

GET /api/chat-history/conversations?userId=<id>&sort=updatedAt&limit=1
  → Get most recent conversation

POST /api/chat-history/messages
  Body: { conversationId, content, sender: "user" }
  Response: { _key }

POST /api/queries
  Body: { query, userId, conversationId, contextOption: "conversation-with-context-labels" }
  Response: { _key, response, metadata: { source_documents, confidence_score } }

POST /api/queries/{queryId}/feedback
  Body: { rating: 1-5, feedback: "text", thumbs: "up"|"down" }
```

#### Service Categories (for context labels)

```
GET /api/service-categories
  → List all categories (used to set health-related category context)
```

### 8.2 Backend Enhancements Required

The following changes to the Genie AI backend are prerequisites for full bot functionality:

| Enhancement | Priority | Description |
|------------|----------|-------------|
| `phoneNumber` field on users | **P0** | Add `phoneNumber` (E.164 string, unique, indexed) to the `users` collection |
| Phone number lookup | **P0** | `GET /api/users?phoneNumber=<number>` — query users by phone number |
| Risk profile storage | **P1** | Add `riskProfile` object to user document (structured risk levels per condition area) |
| Preferred nudge time | **P2** | Add `preferredNudgeTime` (string, HH:MM) to user preferences |
| WhatsApp channel marker | **P2** | Add `registrationChannel` field to user (`web`, `mobile`, `whatsapp`) |

### 8.3 STT/TTS Microservice API (Consumed)

See FR-VN-03 for the full contract.

### 8.4 Internal API (Exposed)

The bot exposes an internal API (not public-facing, authenticated via API key):

```
POST /api/internal/campaigns         → Schedule campaign message blast
GET  /api/internal/campaigns/{id}/stats → Get delivery stats
POST /api/internal/nudges/recalculate/{userId} → Recalculate nudge schedule for user
GET  /api/internal/health             → Health check with dependency status
GET  /api/internal/metrics            → Prometheus-compatible metrics
```

---

## 9. Data Model

### 9.1 PostgreSQL Schema

#### `wa_users`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, default `gen_random_uuid()` |
| `phone_number` | VARCHAR(20) | Unique, E.164 format, indexed |
| `genieai_user_id` | VARCHAR(50) | The `_key` from Genie AI backend |
| `genieai_access_token` | TEXT | Cached auth token |
| `genieai_token_expires_at` | TIMESTAMPTZ | Token expiry |
| `active_conversation_id` | VARCHAR(50) | Current conversation `_key` |
| `conversation_started_at` | TIMESTAMPTZ | When current conversation started |
| `display_name` | VARCHAR(100) | WhatsApp profile name (from webhook) |
| `risk_profile_json` | JSONB | Cached copy of risk profile |
| `preferred_nudge_time` | TIME | User's preferred notification time |
| `region` | VARCHAR(100) | User's region in The Gambia |
| `opted_out` | BOOLEAN | Default false |
| `opted_out_at` | TIMESTAMPTZ | Nullable |
| `last_message_at` | TIMESTAMPTZ | Last user message timestamp |
| `message_count` | INTEGER | Total messages sent by user |
| `created_at` | TIMESTAMPTZ | Account creation |
| `updated_at` | TIMESTAMPTZ | Last update |

#### `message_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `wa_user_id` | UUID | FK → wa_users |
| `whatsapp_message_id` | VARCHAR(100) | Meta's message ID (for dedup) |
| `direction` | VARCHAR(10) | `inbound` or `outbound` |
| `message_type` | VARCHAR(20) | `text`, `audio`, `interactive`, `template` |
| `content_preview` | VARCHAR(500) | First 500 chars of message (for debugging) |
| `genieai_query_id` | VARCHAR(50) | Linked query `_key` (nullable) |
| `template_name` | VARCHAR(100) | If sent via template |
| `processing_time_ms` | INTEGER | Time from receipt to response sent |
| `created_at` | TIMESTAMPTZ | |

#### `message_delivery_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `whatsapp_message_id` | VARCHAR(100) | Indexed |
| `status` | VARCHAR(20) | `sent`, `delivered`, `read`, `failed` |
| `error_code` | INTEGER | Nullable, WhatsApp error code |
| `error_message` | VARCHAR(500) | Nullable |
| `timestamp` | TIMESTAMPTZ | When status was received |

#### `feedback_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `wa_user_id` | UUID | FK → wa_users |
| `genieai_query_id` | VARCHAR(50) | The query being rated |
| `rating` | VARCHAR(10) | `up` or `down` |
| `feedback_text` | TEXT | Nullable free-text feedback |
| `created_at` | TIMESTAMPTZ | |

#### `scheduled_messages`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `wa_user_id` | UUID | FK → wa_users |
| `template_name` | VARCHAR(100) | Template to use |
| `template_params` | JSONB | Template parameter values |
| `schedule_type` | VARCHAR(20) | `one_time`, `recurring` |
| `cron_expression` | VARCHAR(50) | For recurring (e.g., `0 18 * * *`) |
| `next_run_at` | TIMESTAMPTZ | Indexed, used by scheduler |
| `last_run_at` | TIMESTAMPTZ | Nullable |
| `active` | BOOLEAN | Default true |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `campaigns`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `template_name` | VARCHAR(100) | |
| `template_params` | JSONB | |
| `target_criteria` | JSONB | Audience filter criteria |
| `scheduled_at` | TIMESTAMPTZ | |
| `status` | VARCHAR(20) | `pending`, `sending`, `completed`, `failed` |
| `total_recipients` | INTEGER | |
| `sent_count` | INTEGER | |
| `delivered_count` | INTEGER | |
| `read_count` | INTEGER | |
| `failed_count` | INTEGER | |
| `created_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ | |

### 9.2 Redis Keys

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `dedup:<message_id>` | String | 24h | Message deduplication |
| `ratelimit:<phone_number>` | String | 60s | Per-user rate limiting |
| `token:<genieai_user_id>` | Hash | 23h | Cached auth tokens |

---

## 10. Non-Functional Requirements

### 10.1 Performance

| Metric | Target |
|--------|--------|
| Webhook response time (200 OK to Meta) | < 500ms |
| End-to-end response time (user msg → bot reply) | < 10s (p95), < 30s (p99) |
| Scheduled message delivery accuracy | Within 60s of scheduled time |
| Concurrent webhook processing | 100+ simultaneous requests |

### 10.2 Reliability

| Metric | Target |
|--------|--------|
| Uptime | 99.5% (allows ~3.6h downtime/month) |
| Message delivery rate | > 98% (for non-opted-out users) |
| Zero message loss | All inbound messages must be logged even if processing fails |

### 10.3 Security

| Requirement | Implementation |
|------------|----------------|
| Webhook authenticity | HMAC-SHA256 signature verification on every request |
| Data in transit | TLS 1.2+ (enforced by Cloudflare + ALB) |
| Data at rest | PostgreSQL encryption (AWS RDS default) |
| Secrets management | Environment variables, never in code; AWS Secrets Manager in production |
| PII handling | Phone numbers are PII — access logged, minimal retention |
| Internal API auth | API key in `Authorization` header, IP allowlist |
| Rate limiting | Per-phone-number: max 30 messages/minute |
| Input sanitization | All user input sanitized before logging or storage |

### 10.4 Privacy & Consent

| Requirement | Details |
|------------|---------|
| Consent | By messaging the bot, the user consents to data processing (stated in welcome message) |
| Data minimization | Store only what's needed; content_preview truncated to 500 chars |
| Opt-out | STOP command immediately halts all outbound messages |
| Data deletion | User can request data deletion via /about → triggers deletion of local records |
| No conversation content storage | The bot does NOT store full message content locally; that's in the Genie AI backend |
| Emergency disclaimer | Bot must clearly state it is NOT a substitute for emergency medical care |

### 10.5 Observability

| Component | Tool |
|-----------|------|
| Structured logging | pino (JSON, correlated by `request_id` and `phone_number_hash`) |
| Metrics | Prometheus (via `fastify-metrics`) — request rates, latencies, error rates, queue depths |
| Alerting | Grafana alerts on: error rate > 5%, queue depth > 1000, backend unreachable |
| Health check | `GET /health` returns dependency status (DB, Redis, Genie AI backend, STT service) |

---

## 11. Cost Model & Budget

### 11.1 WhatsApp Cloud API Pricing

WhatsApp charges per **conversation** (24h window from first message), not per message. Rates for The Gambia (as of 2025):

| Conversation Type | Rate (USD) | Description |
|-------------------|-----------|-------------|
| **User-initiated (service)** | ~$0.005 | User messages first; bot responds within 24h |
| **Business-initiated (utility)** | ~$0.015 | Medication reminders, appointment confirmations |
| **Business-initiated (marketing)** | ~$0.040 | Health tips, campaign messages, re-engagement |
| **Free tier** | $0.00 | First 1,000 service conversations/month are free |

### 11.2 Projected Monthly Costs — User Scale Scenarios

#### Scenario A: Early Pilot (1,000 MAU)

| Item | Quantity | Unit Cost | Monthly Cost |
|------|----------|-----------|-------------|
| Service conversations | 3,000 | $0.005 | $15 |
| Utility conversations (reminders) | 2,000 | $0.015 | $30 |
| Marketing conversations (nudges) | 4,000 | $0.040 | $160 |
| Free tier discount | -1,000 | — | -$5 |
| **WhatsApp subtotal** | | | **$200** |
| AWS hosting (ECS Fargate, t3.small equiv.) | 1 | $35 | $35 |
| RDS PostgreSQL (db.t3.micro) | 1 | $15 | $15 |
| ElastiCache Redis (cache.t3.micro) | 1 | $13 | $13 |
| **Infrastructure subtotal** | | | **$63** |
| **Total** | | | **~$263/month** |

#### Scenario B: Growth (3,000 MAU)

| Item | Quantity | Unit Cost | Monthly Cost |
|------|----------|-----------|-------------|
| Service conversations | 9,000 | $0.005 | $45 |
| Utility conversations | 6,000 | $0.015 | $90 |
| Marketing conversations | 12,000 | $0.040 | $480 |
| Free tier discount | -1,000 | — | -$5 |
| **WhatsApp subtotal** | | | **$610** |
| AWS hosting (scaled) | | | $70 |
| RDS + Redis (scaled) | | | $50 |
| **Total** | | | **~$730/month** |

#### Scenario C: Target (15,000 total users, 5,000 MAU)

| Item | Quantity | Unit Cost | Monthly Cost |
|------|----------|-----------|-------------|
| Service conversations | 15,000 | $0.005 | $75 |
| Utility conversations | 10,000 | $0.015 | $150 |
| Marketing conversations | 20,000 | $0.040 | $800 |
| Free tier discount | -1,000 | — | -$5 |
| **WhatsApp subtotal** | | | **$1,020** |
| AWS hosting (scaled) | | | $120 |
| RDS + Redis (scaled) | | | $80 |
| **Total** | | | **~$1,220/month** |

### 11.3 Cost Optimization Strategies

1. **Maximize free tier**: first 1,000 service conversations/month are free
2. **Batch nudges within 24h windows**: if the user already has an open service conversation, send nudges as regular messages (free) instead of template messages (paid)
3. **Smart nudge scheduling**: only send marketing-category nudges to users who are actively engaging (opened a message in the last 7 days)
4. **Use utility category** where applicable (reminders, confirmations) — cheaper than marketing
5. **Re-engagement gating**: don't send re-engagement to users who haven't interacted in >180 days

### 11.4 STT/TTS Costs

If using the self-hosted STT/TTS microservice (Whisper + Coqui TTS on GPU):

| Item | Monthly Cost |
|------|-------------|
| GPU instance (g4dn.xlarge or equivalent, spot) | $100-200 |
| Or: CPU-only (whisper.cpp, smaller model) | $35-50 |

Voice note usage is expected to be <20% of messages in v1.

---

## 12. Risk Mitigation

### 12.1 Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Meta webhook downtime / delays | Users get no response | Low | Implement retry queue; monitor Meta's status page; log all inbound for replay |
| Genie AI backend unavailable | Bot can't answer questions | Medium | Circuit breaker pattern; fallback "try again later" message; cache last-known health info |
| STT service unavailable | Voice notes can't be processed | Medium | Graceful degradation: ask user to type instead; queue voice notes for later processing |
| WhatsApp template rejection by Meta | Can't send nudges/campaigns | Medium | Submit templates early; follow Meta guidelines strictly; have fallback text variations |
| Rate limiting by WhatsApp | Messages delayed or dropped | Low | Respect 80 msg/sec limit; use BullMQ rate limiter; exponential backoff |
| Token expiry / auth failures | Bot stops working for specific users | Medium | Proactive token refresh 1h before expiry; automatic re-authentication on 401 |

### 12.2 Product Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Users trust bot for emergency medical advice | Harm to user | High | Prominent disclaimers; emergency keyword detection immediately redirects to 116/facilities; system prompt explicitly forbids diagnosis |
| Misinformation in LLM responses | Loss of trust, potential harm | Medium | RAG grounds responses in WHO/verified sources; source citations visible; confidence threshold below 60% triggers "I'm not sure" caveat |
| Low adoption | Project impact reduced | Medium | Partner with MoH for poster campaigns; word-of-mouth via health workers; QR codes at clinics |
| User fatigue from nudges | Users opt out | Medium | Configurable frequency; respect opt-out immediately; reduce frequency for inactive users |

### 12.3 Compliance Risks

| Risk | Mitigation |
|------|------------|
| WhatsApp Business Policy violation | Follow Meta Commerce Policy and Business Messaging Policy; no prohibited content |
| Health data privacy (Gambia Data Protection Act) | Minimal data collection; consent on first contact; data deletion on request; no sharing with third parties |
| Medical device classification | Bot provides information only, not diagnosis or treatment — clearly disclaimed |

---

## 13. Testing Strategy

### 13.1 Unit Tests

- All TypeScript modules tested with `vitest`
- Mock WhatsApp API calls, Genie AI backend calls, and Redis
- Target: >80% code coverage
- Key areas: webhook signature validation, message formatting, template rendering, rate limiting

### 13.2 Integration Tests

- Use Docker Compose to spin up PostgreSQL + Redis
- Test full webhook → processing → response flow with mocked WhatsApp API
- Test user registration → conversation → feedback lifecycle
- Test scheduled message creation and execution

### 13.3 End-to-End Tests

- Use Meta's test phone numbers for WhatsApp Cloud API sandbox
- Verify complete flows: first contact, risk assessment, nudge delivery
- Test voice note flow with sample audio files → STT service → response

### 13.4 LLM Response Quality

Per the submission's testing strategy:

- **LLM-as-a-judge evaluation**: use an array of LLMs (different from Granite) to evaluate bot responses
- Test cases cover: medical accuracy, source citation correctness, appropriate disclaimers, emergency detection, cultural sensitivity
- Structured requirements spec per module serves as the evaluation rubric
- Run evaluation suite on every RAG pipeline update

### 13.5 User Acceptance Testing

- Conduct with speakers of Gambian English (per submission commitment)
- Test STT accuracy (Word Error Rate) on Gambian English voice notes
- Test comprehension of bot responses with target users
- Validate cultural appropriateness (food references, health practices, language tone)

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| **BSP** | Business Solution Provider — third-party WhatsApp API provider (not used; we use the direct Cloud API) |
| **BHBM** | Be He@lthy, Be Mobile — WHO/ITU initiative providing evidence-based mHealth message libraries |
| **E.164** | International phone number format (e.g., +2201234567) |
| **GENIE.AI** | The open-source GenAI framework by UNICC/ITU that this project extends |
| **MCP** | Model Context Protocol — enables LLM tool calling |
| **NCD** | Non-Communicable Disease (hypertension, diabetes, cancer, chronic respiratory disease, mental health) |
| **OPEA** | Open Platform for Enterprise AI — Intel's microservice orchestration for RAG pipelines |
| **RAG** | Retrieval-Augmented Generation — LLM technique grounding responses in retrieved documents |
| **RLHF** | Reinforcement Learning from Human Feedback — using user ratings to improve model responses |
| **STT** | Speech-to-Text |
| **TTS** | Text-to-Speech |
| **WAM ID** | WhatsApp Message ID — unique identifier assigned by Meta to each message |

---

## Appendix A: Backend Prerequisites Checklist

Before the WhatsApp bot can be fully operational, the following changes must be made to the Genie AI backend (`components/gov-chat-backend/`):

- [ ] Add `phoneNumber` field (E.164 string, unique, nullable, indexed) to `users` collection
- [ ] Add `GET /api/users?phoneNumber=<number>` query support
- [ ] Add `riskProfile` JSONB field to user document
- [ ] Add `preferredNudgeTime` field to user preferences
- [ ] Add `registrationChannel` field to user document
- [ ] Ensure `POST /api/auth/register` accepts optional `phoneNumber` parameter
- [ ] Ensure JWT tokens issued for WhatsApp-created users work with all chat/query endpoints

## Appendix B: Project File Structure

```
whatsapp_bot/
├── PRD.md                          # This document
├── package.json
├── tsconfig.json
├── drizzle.config.ts               # Drizzle ORM config
├── docker-compose.yml              # Local dev (PostgreSQL + Redis)
├── Dockerfile
├── .env.example
├── src/
│   ├── index.ts                    # Fastify server entry point
│   ├── config.ts                   # Environment variable loading + validation
│   ├── routes/
│   │   ├── webhook.ts              # WhatsApp webhook handlers
│   │   └── internal.ts             # Internal API (campaigns, health)
│   ├── services/
│   │   ├── whatsapp.service.ts     # WhatsApp Cloud API client
│   │   ├── genieai.service.ts      # Genie AI backend API client
│   │   ├── stt.service.ts          # STT/TTS microservice client
│   │   ├── user.service.ts         # User lifecycle management
│   │   ├── conversation.service.ts # Conversation orchestration
│   │   ├── formatter.service.ts    # Response formatting for WhatsApp
│   │   ├── nudge.service.ts        # Nudge scheduling & delivery
│   │   ├── campaign.service.ts     # Campaign message management
│   │   └── feedback.service.ts     # User feedback collection
│   ├── workers/
│   │   ├── nudge.worker.ts         # BullMQ worker for scheduled nudges
│   │   └── campaign.worker.ts      # BullMQ worker for campaign blasts
│   ├── db/
│   │   ├── schema.ts               # Drizzle schema definitions
│   │   ├── migrate.ts              # Migration runner
│   │   └── migrations/             # SQL migration files
│   ├── middleware/
│   │   ├── signature.ts            # Webhook signature verification
│   │   └── internal-auth.ts        # Internal API key auth
│   ├── types/
│   │   ├── whatsapp.types.ts       # WhatsApp webhook payload types
│   │   ├── genieai.types.ts        # Genie AI API response types
│   │   └── common.types.ts         # Shared types
│   └── utils/
│       ├── phone.ts                # Phone number normalization
│       ├── dedup.ts                # Message deduplication
│       └── ratelimit.ts            # Per-user rate limiting
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
└── scripts/
    └── seed-templates.ts           # Script to register message templates with Meta
```
