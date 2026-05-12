# GENIE.AI — Gambia NCD Health Companion

> **Phase 2 prototype submission. Built on the GENIE.AI / OPEA technical framework.**

> **🌐 Live at: <https://genie.innov8ai.com/>** — the prototype is deployed and reachable at this URL. Reviewers can sign up, chat, place a voice call, and exercise the public guest endpoints directly. WhatsApp testing requires the configured business number (available on request to keep the access token from being burned by load).

---

## Table of contents

1. [Overview & use case](#1-overview--use-case)
2. [Architecture](#2-architecture)
3. [Setup & deployment](#3-setup--deployment)
4. [Feature catalogue](#4-feature-catalogue)
5. [API reference](#5-api-reference)
6. [Safety, compliance, and content policy](#6-safety-compliance-and-content-policy)
7. [Integration with the GENIE.AI framework](#7-integration-with-the-genieai-framework)
8. [Contributions back to GENIE.AI](#8-contributions-back-to-genieai)
9. [Repository layout](#9-repository-layout)

---

## 1. Overview & use case

### 1.1 Problem

Non-communicable diseases (NCDs) — hypertension, diabetes, tobacco dependence, cardiovascular and stroke risk — are the leading cause of preventable adult mortality in The Gambia. Public-health communication is constrained by clinic capacity, low literacy in remote areas, and language coverage gaps in conventional digital channels.

### 1.2 Solution

A multi-channel AI health companion grounded in WHO, WHO–ITU **Be He@lthy Be Mobile (BHBM)**, and Gambian Ministry of Health guidance. End users reach the assistant through whichever channel suits them:

| Channel | How it's used |
|---|---|
| **Web chat** | Browser-based, multilingual, with optional voice notes the user records and sends. |
| **Live voice call** | Real-time spoken conversation with a twin via a WebSocket-based voice bridge — same TLS port as the rest of the API, with inline RAG so replies stay grounded in the knowledge base. |
| **WhatsApp** | Text + voice notes over Meta Cloud API, hitting the same RAG pipeline as the web channel. |

The same underlying RAG retrieval, language pipeline, and personality controls drive every channel. Sessions, messages, and call records persist in ArangoDB so admins can review interactions and surface analytics.

**Two access paths to the assistant:**

- **Authenticated patient accounts** — admins provision named patient accounts and grant per-account access to specific twins (cohort-style), so patients sign in and only see the twins they're authorised to use. Sessions are persisted under their `userId` for analytics.
- **Public guest access** — anyone with a sharable link can chat with or call the default twin without signing up. Guest sessions are stamped with a `guest:<uuid>` userId so guest data is permanently fenced off from registered-user data.

### 1.3 Intended audience

- **Primary**: Gambian residents at risk of, or living with, NCDs. Smartphone-first, often on WhatsApp, often non-English first-language.
- **Secondary**: Community health workers using the assistant to look up guidance during patient interactions.
- **Operators**: Ministry of Health admins who curate AI Twins, knowledge base, language policies, and personality settings.

### 1.4 Why this submission is different

- **Three converged channels** (web, voice, WhatsApp) all flowing through the same RAG pipeline — not three parallel mini-products.
- **Custom WebSocket voice bridge** with inline RAG against the shared chunk store, so live calls stay grounded without paying the chatqna pipeline's latency.
- **Sesotho, Swahili** in the language coverage — not just the usual EN/FR/ES. **Mandinka and Wolof are partially supported** (UI strings + auto-detection) but end-to-end translation quality is not fully under our control yet; see [§4.3.1](#431-mandinka--wolof-research-notes-partial-support) for the research notes.
- **AI Twin + Personality system** built on top of GENIE.AI's chat pipeline so a single deployment serves multiple personas with distinct voices, greetings, and conversational style.

---

## 2. Architecture

### 2.1 High-level diagram

```
                        ┌─────────────────────────────────────────┐
                        │             Public traffic               │
                        │  (HTTPS 443 only — single TLS port)      │
                        └────────────────────┬────────────────────┘
                                             │
                                       ┌─────▼─────┐
                                       │   nginx   │  TLS termination, routing
                                       └─────┬─────┘
                  ┌──────────────────────────┼──────────────────────────┐
                  │                          │                          │
            ┌─────▼────┐           ┌─────────▼─────────┐         ┌──────▼──────┐
            │ Frontend │           │    Backend (BFF)  │         │ voice-bridge│
            │  Vue 3   │  REST     │  Node.js / Express│ ◄─WS──┐ │  WebSocket  │
            │  + Pinia │ ────────► │   JWT auth        │       │ │ ASR/LLM/TTS │
            └──────────┘           └─────────┬─────────┘       │ │   pipeline  │
                                             │                 │ └──────┬──────┘
                                  ┌──────────┼─────────┐       │        │
                                  │          │         │       │        │
                              ┌───▼──┐  ┌────▼───┐ ┌───▼───┐   │   ┌────▼────┐
                              │ Kong │  │Arango │ │ Redis │   │   │ Whisper │
                              │/Auth │  │ vec+  │ │       │   │   │  (ASR)  │
                              └──────┘  │ graph │ └───────┘   │   └─────────┘
                                        └───┬───┘             │   ┌─────────┐
                                            │                 │   │  Piper  │
                                  ┌─────────▼─────────┐       │   │  (TTS)  │
                                  │     ChatQnA       │ ◄────┐│   └─────────┘
                                  │  (OPEA megaservice│      ││
                                  │   embed/retrieve/ │      ││
                                  │   rerank/llm)     │      ││   ┌─────────────────┐
                                  └─────────┬─────────┘      ││   │   whatsapp-     │
                                            │                ││   │     service     │ ◄── Meta Cloud API webhook
                                  ┌─────────▼─────────┐      │└───┤  voice notes:   │
                                  │  TEI Embedding    │      │    │  ASR + chat     │
                                  │  TEI Reranker     │      │    └─────────────────┘
                                  │  vLLM (Llama 3.1) │      │
                                  │  vLLM (Gemma)     │ ─────┘  (translator)
                                  └───────────────────┘
```

### 2.2 Request lifecycle (web chat)

1. Frontend sends `POST /api/chat-sessions/:id/messages` (`{ text, context: { language? } }`) with the user's JWT.
2. Backend (`gov-chat-backend`) validates, looks up the session's twin, prepends a personality directive as a system message, appends the new user turn to the loaded message history.
3. Backend forwards the full `messages` array + `context` to **ChatQnA** at `/v1/chatqna`.
4. ChatQnA detects/forces the language, translates non-English to English, embeds via TEI, retrieves chunks from ArangoDB (vector + graph hybrid), reranks via TEI cross-encoder, builds a prompt with twin/personality + retrieved context + chat history (with anti-autocomplete framing), sends to vLLM serving Llama 3.1 8B Instruct.
5. The reply is post-processed (markers stripped, autocomplete cuts), translated back if the original language wasn't English, and returned with metadata (sources, confidence score, routing decision).
6. Backend persists user + assistant messages to Arango, records analytics, returns to the client.

### 2.3 Voice call lifecycle

1. Frontend calls `POST /api/voice/token` with the chosen twin and language, receives a short-lived JWT + WS URL.
2. Frontend opens a WebSocket to `voice-bridge`, streams 16 kHz PCM frames at 20 ms.
3. `voice-bridge` runs a 4-layer echo strategy (browser AEC, mic mute while agent speaks, server drain window post-utterance, server-side barge-in via RMS), calls Whisper for ASR, vLLM (direct, bypassing chatqna RAG for latency) for the reply, Piper for TTS, streams audio back as PCM.
4. Call sessions and messages are persisted to ArangoDB with `userId`, `twinId`, `durationSeconds`.

### 2.4 WhatsApp lifecycle

1. Meta delivers a webhook to `whatsapp-service`.
2. For text: payload is forwarded to ChatQnA with the default twin's personality directive.
3. For voice notes: media is downloaded from Meta Graph API, transcribed via Whisper, treated as a text turn.
4. Reply is sent back via Meta Graph API (text). Sessions persist in `chatSessions` with `type='whatsapp'`, alongside web sessions.

### 2.5 Components

| Service | Tech | Role |
|---|---|---|
| `frontend` (V2) | Vue 3, Pinia, TypeScript | Web client (chat, voice call, admin) |
| `gov-chat-backend` | Node.js 20, Express | BFF: auth, sessions, twin/personality, voice token mint, public API |
| `chatqna-xeon-backend-server` | Python, FastAPI, OPEA `comps` | RAG megaservice |
| `dataprep-arango-service` | Python, OPEA | Document ingestion (PDF/HTML/Markdown → embeddings → graph) |
| `retriever-arango-service` | Python, OPEA | Hybrid vector + graph retrieval |
| `embedding`, `tei` | TEI | `BAAI/bge-base-en-v1.5` embeddings |
| `reranker`, `tei_reranker` | TEI | `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| `vllm` | vLLM | Llama 3.1 8B Instruct |
| `vllm-translation-guardrail` | vLLM | Gemma 3 4B for translation |
| `voice-bridge` | Python, FastAPI | WebSocket ASR → vLLM → TTS pipeline |
| `asr-whisper` | Whisper | Speech-to-text |
| `tts-piper` | Piper | Text-to-speech (per-language, per-voice) |
| `whatsapp-service` | Python, FastAPI | Meta Cloud API webhook adapter |
| `document-repository` | Node.js | File upload + crawler + ClamAV scan |
| `arango-vector-db` | ArangoDB 3.12 | Vectors, graph, sessions, users, twins |
| `redis-cache` | Redis 7 | WhatsApp conversation cache, deduplication |
| `keycloak` | Keycloak 23 | Identity provider |
| `kong` | Kong 3 | API gateway / rate limit |
| `nginx` | nginx | TLS, public routing |

### 2.6 Data model

All persistent state lives in a single ArangoDB instance (`arango-vector-db`). The schema is the GENIE.AI baseline plus a handful of additions for twins, sessions, and call records.

| Collection | Type | Purpose |
|---|---|---|
| `users` | document | Admin and patient accounts: loginName, email, hashed password, role, personalIdentification |
| `aiTwins` | document | Twin personas (name, description, voiceId, chat/call greetings, personality, ownerId, linkedKbFileIds) |
| `voices` | document | Piper voice catalogue (modelVoiceId, language, gender, name) |
| `chatSessions` | document | Web + WhatsApp sessions (userId, twinId, type='chat'\|'whatsapp', timestamps) |
| `chatSessionMessages` | document | Per-session messages (role, content, audioUrl, createdAt) |
| `call_sessions` | document | Voice calls (userId, twinId, language, gender, startAt/endAt, durationSeconds) |
| `call_messages` | document | Per-call transcripts (sessionId, content, isAssistant, createdAt) |
| `queries` | document | Every LLM call (text, response, responseTime, categoryId, serviceId, metadata) — feeds analytics |
| `analytics` | document | Aggregated per-period KPIs |
| `serviceCategories` / `services` | document | Auto-routing taxonomy used by chatqna |
| `GRAPH_SOURCE` | document | **Indexed knowledge-base chunks**: text + 768-dim embedding + file_id + chunk_index. Populated by OPEA dataprep. Both chat and voice retrieve from this collection. |
| `GRAPH_ENTITY` | document | Named entities extracted from chunks (used by chatqna's graph traversal) |
| `GRAPH_HAS_SOURCE`, `GRAPH_LINKS_TO` | edge | Knowledge-graph edges connecting entities to chunks and to each other |
| `files` | document | Uploaded source documents and their dataprep ingestion status |
| `verificationTokens`, `passwordResetTokens` | document | Email-verification and password-reset flows |

**Indexes worth noting:**

- `users.loginName` and `users.email` are uniquely indexed.
- `chatSessions` has indexes on `userId` and `(userId, type, createdAt)` for the sessions list.
- `GRAPH_SOURCE` chunks are scanned with AQL `COSINE_SIMILARITY` for voice retrieval (vector index optional — at the current ~750-chunk volume a full scan completes in ~50 ms).

---

## 3. Setup & deployment

### 3.1 Prerequisites

- Linux host with Docker 25+ and Docker Swarm initialised (`docker swarm init` once).
- A node labelled `gateway=true` and `genieai=true` (single-node deploys can label one node both: `docker node update --label-add gateway=true --label-add genieai=true $(docker node ls -q)`).
- For OPEA workloads: NVIDIA GPU, NVIDIA Container Toolkit, label `gpu=true` on that node.
- Outbound HTTPS from the host (HuggingFace, Meta Graph API).
- TLS certificate for the public domain (Let's Encrypt or commercial).

### 3.2 First-time setup

```bash
git clone <YOUR_GITLAB_URL>
cd genie-ai
cp env .env
$EDITOR .env   # fill required secrets
```

**Required secrets** in `.env`:

- `ARANGO_PASSWORD`
- `POSTGRES_PASSWORD`, `KONG_DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD`
- `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_PROXY_CLIENT_SECRET`, `KC_DATAPREP_CLIENT_SECRET`
- `JWT_SECRET` (any strong random string; shared between backend, voice-bridge, document-repository)
- `HUGGING_FACE_HUB_TOKEN` (for vLLM model pulls)
- `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM` (SMTP for verification mails)
- `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` (WhatsApp; access token must be a System User token, not the 24-hour temporary one)
- `NGINX_PUBLIC_DOMAIN` (your public hostname)

### 3.3 TLS certificates

Place `fullchain.pem` and `privkey.pem` in the path your nginx config expects (default: `secrets/<domain>/`). For Let's Encrypt automation see `deploy/ansible/`.

### 3.4 Voice models

Pre-fetch Piper voices into `data/piper-voices/`:

```bash
bash scripts/download-piper-voices.sh
```

The script fetches `.onnx` + `.onnx.json` for the default voice catalogue (en/fr/es/sw).

### 3.5 Build & deploy

```bash
# 1. Build all images that have a build: directive
docker compose build
docker compose push

# 2. Render and deploy to Swarm
docker compose --env-file .env config \
  | sed -E 's/^( *published: )"([0-9]+)"/\1\2/' \
  | docker stack deploy -c - --with-registry-auth genieai

# 3. Watch rollout
docker service ls
docker stack ps genieai --no-trunc | head -40
```

Once everything reads `1/1` (or the expected `0/0` / `0/1` for one-shot init/migration jobs), the stack is ready.

### 3.6 Smoke tests

```bash
# Public health
curl -sk -o /dev/null -w "HTTP %{http_code}\n" "https://${NGINX_PUBLIC_DOMAIN}/api/health"

# Public twin directory
curl -sk "https://${NGINX_PUBLIC_DOMAIN}/api/public/ai-twins" | python3 -m json.tool

# Suggested questions
curl -sk "https://${NGINX_PUBLIC_DOMAIN}/api/public/suggested-questions" | python3 -m json.tool
```

Browser tests:

1. Log in (or sign up).
2. Open an AI Twin → start a chat → send a few messages, including multi-turn.
3. Open the same twin → start a voice call → speak → confirm reply audio.
4. Send a WhatsApp message + voice note to the configured business number → confirm reply in WhatsApp.

### 3.7 Recommended demo flow & test prompts

A reviewer can exercise the full system in ~5 minutes against the live deployment at <https://genie.innov8ai.com/>. Suggested order — each prompt targets a specific subsystem:

**1. Public guest chat (no signup needed)**

Open the landing page → start a chat as a guest. Test prompts:

| Prompt | What it exercises |
|---|---|
| `"How do I know if my blood pressure is too high?"` | RAG retrieval + grounded reply (KB has the BP doc) |
| `"What does a healthy meal plan look like for type 2 diabetes?"` | Auto-routing + topic-specific retrieval |
| `"Is it true that hypertension can be cured with herbs?"` | Safety: corrective response without scolding |
| `"I feel a heavy pressure on my chest and my left arm is numb"` | Red-flag escalation: routes to urgent care |
| `"How do I make jollof rice?"` | Out-of-scope refusal: stays in NCD lane |
| (in any non-English supported language) `"¿Qué es la hipertensión?"` | Language detection + translation pipeline |

**2. Voice call (browser, headphones recommended for echo)**

Open a twin → click the call button → grant mic permission → speak. Test prompts:

| Spoken prompt | What it exercises |
|---|---|
| `"Hi, how are you?"` | Greeting + no-RAG short-message path |
| `"What is blood pressure?"` | Inline RAG (TEI embed → AQL k-NN → vLLM → Piper) — listen for definition lifted from KB |
| `"How can I quit smoking?"` | Multi-turn grounding |
| Interrupt the agent mid-sentence | Barge-in cancellation (4-layer echo strategy) |

Latency to first audio after end-of-speech: **~1 second**. See §4.12 for the full breakdown.

**3. Authenticated chat (admin or patient)**

- Sign in (or have an admin sign you up).
- Open a twin you have access to.
- Send a message — verify the user object on the session list reflects you (kind=user, name, email).
- As an admin: visit the analytics dashboard to see your messages reflected in the KPIs (Active Patients, Messages Sent, etc.).

**4. WhatsApp (requires the configured business number)**

- Send a text message to the configured WhatsApp number → verify a reply.
- Send a voice note → verify the bot transcribes it (Whisper) and replies in text.

### 3.8 Update / re-deploy

```bash
docker compose build <service>
docker compose push <service>
docker service update --force --image localhost:5000/<image>:latest genieai_<service>
```

### 3.9 Teardown

```bash
docker stack rm genieai
# Volumes are preserved by default. To wipe the database too:
# docker volume ls | grep genieai_ | awk '{print $2}' | xargs -r docker volume rm
```

---

## 4. Feature catalogue

### 4.1 Multi-twin admin model

Each admin owns the AI Twins they create (`ownerId` on `aiTwins` collection). Reads, updates, deletes are all scoped per owner. The default twin (carrying the WhatsApp phone number) is a special row, owned by the platform admin. Endpoints:

- `GET /api/ai-twins` — caller's own twins, paginated.
- `POST /api/ai-twins` — admin-only create, stamps `ownerId = req.user._key`.
- `PATCH /api/ai-twins/:twinId` — admin + owner only.
- `POST /api/ai-twins/:twinId/avatar` — multipart image upload, served at `/Uploads/ai-twins/`.
- `PATCH /api/ai-twins/:twinId/voice` — assign a Piper voice from the catalogue.
- KB file linking (`POST/PATCH/DELETE /api/ai-twins/:twinId/kb-files`) — restrict retrieval to per-twin document allow-lists.

### 4.2 AI Personality

Two-axis personality system applied at chat time:

- `languageStyle ∈ {slang, casual, professional}` — controls tone.
- `responseLength ∈ {short, medium, long}` — controls verbosity.

The directive is generated by a single helper (`buildPersonalityPromptFragment`) and injected as a `role: system` message at the head of the chat history sent to the LLM. The Python clones in `voice-bridge` and `whatsapp` produce the exact same wording so the persona is identical across channels. Endpoints:

- `GET /api/ai-twins/:twinId/personality`
- `POST /api/ai-twins/:twinId/personality` (admin-only)

Project default for any unset twin: `slang` + `medium`.

### 4.3 Multilingual chat

- Translator (Gemma 3 4B) supports the **17 languages** declared in `language_codes.json` — including **Sesotho** and **Swahili** for the Gambian audience. **Mandinka** and **Wolof** are listed as partially supported: detection works, UI is translated, but Gemma's translation quality for these two languages is inconsistent and not yet production-grade — see [§4.3.1](#431-mandinka--wolof-research-notes-partial-support).
- LLM (Llama 3.1 8B Instruct) is fine-tuned on **8 languages**; everything else is bridged via translation: user-language → English → LLM → English → user-language.
- Auto-detection: fastText `lid` microservice (NLLB-aligned, 217 languages including Wolof, Mandinka, Fulah, Hausa, Yoruba) with `langdetect` as a fallback. The user can override via `context.language`.
- Voice channel supports **11 languages** end-to-end (ASR + LLM + TTS): `en`, `fr`, `es`, `de`, `ar`, `ru`, `zh`, `pt`, `hi`, `id`, `sw`. The frontend's `GET /api/chat-sessions/languages` returns `isVoiceSupported: boolean` per language so the UI can gate the Call button. The voice-bridge auto-picks a per-language Piper voice (M/F where available) and switches voice when the user picks a language the twin's assigned voice can't speak. **Mandinka and Wolof are deliberately excluded from voice** until translation quality is validated (see §4.3.1).

Endpoints:

- `GET /api/chat-sessions/languages` (authed) and `GET /api/public/chat-sessions/languages` (guest).

### 4.3.1 Mandinka & Wolof research notes (partial support)

Mandinka and Wolof are first-class targets for the Gambian audience but neither is currently a "solved" language in the open-source NLP stack we had access to. We invested significant time evaluating candidate models and have marked both languages as **partially supported** in the final submission — detection works, UI strings are translated, and the assistant will *attempt* a response, but we do not yet have a translation path we are confident enough in to call production-grade. This section documents what we tried and why we paused that line of work.

**What we evaluated:**

| Model / library | Role we tested it for | Outcome on Mandinka / Wolof |
|---|---|---|
| `langdetect` (Python) | Auto-detection of input language | Reliably misclassifies Mandinka and Wolof as French, Portuguese, or "unknown" — the model's training data does not include either language. Kept only as a fallback. |
| fastText `lid218e` (NLLB-aligned LID) | Auto-detection replacement | Covers both languages (217-language model). Detection accuracy is acceptable; this is what we shipped as the `lid` microservice. **Detection is the one piece of the Mandinka/Wolof stack where we have working coverage.** |
| **NLLB-200** (Meta, 200 languages incl. Wolof / Mandinka) | Translation user-language → English and back | Wolof and Mandinka are nominally supported, but our short bench runs on Gambian-style phrases produced literal or semantically drifted English. We could not bring the model into the deployment within the prototype window because the smaller distilled variants still degraded quickly on the kind of mixed-register, code-switched text patients actually send (e.g. `"Salaam aleekum, sama tudd RYAAN la te bég naa la gis."`). |
| **MADLAD-400** (Google, 400 languages) | Translation, same role as NLLB | We stood up a CPU sidecar and ran a 25-phrase Mandinka/Wolof evaluation set. Quality on common patient phrasings (greetings, health complaints, medication questions) was visibly worse than Gemma's zero-shot attempt; the service was decommissioned after evaluation. |
| **Oolel-v0.1** (Wolof-specialised, `soynade-research/Oolel-v0.1`) | Wolof-specialised generation | Promising on paper but research-only / non-DPG-friendly licensing, and no Mandinka coverage — not a route we could realistically integrate for a public-sector deployment. |
| **Gemma 3 4B** (currently wired) | Zero-shot translation as a generalist fallback | This is what's actually in production. Gemma handles Mandinka and Wolof better than NLLB or MADLAD on our test phrases — but it still hallucinates on idiomatic input and is not consistent enough for us to advertise as full support. |

**Why we paused this line of research:**

- **Data scarcity.** Mandinka has very limited parallel corpora; Wolof has more but still drops sharply off everyday Senegambian phrasing. Open models inherit that scarcity.
- **Licensing.** Several promising specialised models (Oolel, some Wolof checkpoints on HuggingFace) carry non-commercial or research-only licences that don't align with the DPG / public-sector goals of GENIE.AI.
- **Evaluation overhead.** Proper translation evaluation for low-resource African languages needs a native-speaker reviewer panel and a held-out test set — that's a workstream of its own, not something we could rubber-stamp inside the prototype phase.

**What "partially supported" means in this submission:**

- Auto-detection: ✅ works (fastText `lid`).
- UI strings: ✅ translated (locale files committed).
- Chat translation round-trip: ⚠️ best-effort via Gemma; quality not yet validated by native speakers.
- Voice channel: ❌ not enabled for Mandinka or Wolof (no Piper voices, no validated Whisper coverage); both languages return `isVoiceSupported: false`.

**Next steps (post-prototype):**

1. Build a Wolof + Mandinka evaluation set with native-speaker scoring.
2. Re-evaluate NLLB-200 distilled-1.3B and MADLAD-400-7B with proper prompt engineering and back-translation checks.
3. Investigate fine-tuning Gemma 3 on a small curated Gambian-health corpus rather than relying on its zero-shot behaviour.
4. Pursue Piper voice contributions for Mandinka and Wolof so the voice channel can be opened up once translation quality is acceptable.

### 4.4 Web chat

- Server-owned chat sessions in ArangoDB (`chatSessions`, `chatSessionMessages`).
- `GET /api/chat-sessions` returns each session with `lastMessage` (preview) and a resolved `user` object (the chatter — registered user, guest, or WhatsApp phone).
- Per-session message search via `?q=`.
- Voice messages: user records a clip, `POST /chat-sessions/:id/voice-messages` runs ASR + LLM, persists both turns with the original audio URL.
- Audio playback: `GET /chat-sessions/:id/messages/:mid/audio` returns the saved recording for user voice notes, or a Piper-synthesized WAV for assistant messages.

### 4.5 Voice call

A WebSocket service (`voice-bridge`). The browser captures 16 kHz PCM via AudioWorklet, streams 20 ms frames, gets back PCM frames it plays through the browser audio output. Built on a single TLS-443 WebSocket so the entire voice path uses the same transport the rest of the API does — no separate signalling channel, no media-server cluster.

Distinguishing engineering:

1. **Twin-aware** — the JWT carries the `twinId`; voice-bridge loads voice + greeting + personality from ArangoDB on connect.
2. **Slim inline RAG** — voice does not call chatqna. Instead, voice-bridge runs a stripped-down retrieval path in parallel with ASR: embed via TEI, run a direct AQL `COSINE_SIMILARITY` k-NN against the same `GRAPH_SOURCE` chunk store the chat path uses, no reranker, no graph traversal, no translation hop. Top-K chunks are injected as a system message before the streaming vLLM call. End-to-end stays around ~1 second end-of-speech to first audio while preserving KB grounding.
3. **Sentence-level streaming TTS** — the LLM output stream is split into sentences as tokens arrive; each sentence is piped through Piper individually so audio starts well before the model finishes generating.
4. **4-layer echo cancellation**: browser AEC + mic-mute-while-agent-speaks + server drain window + RMS-based barge-in.

#### Why a slimmed RAG for voice

The chat channel uses the full GENIE.AI ChatQnA megaservice (translation, hybrid vector + knowledge-graph retrieval, cross-encoder reranking, source-document citations) — optimised for grounded, cited answers users can read at their own pace. That pipeline costs ~5–7 s per turn, which is unusable in a live call. The voice channel uses a deliberately leaner retrieval profile against the **same chunk collection**:

| | Chat (ChatQnA) | Voice (inline) |
|---|---|---|
| Query embedding | TEI `bge-base-en-v1.5` | TEI `bge-base-en-v1.5` (same service) |
| Translation in/out | Yes (Gemma) | No — voice is locked to languages Llama 3.1 handles natively (en, fr, es, sw) |
| Vector retrieval | OPEA Arango retriever HTTP service | Direct AQL `COSINE_SIMILARITY` against `GRAPH_SOURCE` |
| Knowledge-graph traversal | Yes (entity expansion via `GRAPH_LINKS_TO`) | No |
| Cross-encoder reranker | Yes (TEI `ms-marco-MiniLM-L-6-v2`) | No |
| LLM call | Non-streaming, full reply | Streaming, first sentence to TTS as it arrives |
| Source citations | Returned | Not surfaced (voice has no UI for them) |
| Wall-clock | ~5–7 s | ~1 s |

The two paths share the same data layer: same TEI service for embeddings, same chunk collection (`GRAPH_SOURCE`) populated by the same OPEA dataprep service. Voice trades retrieval depth (graph hop, reranker) for latency; chat trades latency for depth. **Same knowledge base, two consumer-appropriate retrieval profiles.**

### 4.6 WhatsApp

- Meta webhook handshake at `GET /webhook/whatsapp` verifies the static token.
- Inbound text: dedup via Redis, route to ChatQnA, persist to Arango (`type='whatsapp'`), reply via Graph API.
- Inbound voice notes: download from Meta Graph API (signed-URL flow), transcribe with Whisper, treat as text turn.
- Sessions are tied to the default twin (the one carrying the configured phone number).

### 4.7 Public guest API

A clean parallel surface at `/api/public/*` for unauthenticated sharable-link experiences. Sessions stamp `userId = "guest:<uuid>"` so guest data can never collide with or leak into authed sessions. Twin selection is supported (defaults to the platform default twin if the caller doesn't specify). The same chat / voice / audio playback functionality is available, scoped to guest sessions only.

### 4.8 Admin tooling

- File ingestion via `document-repository` (PDF, DOCX, HTML, Markdown) with ClamAV scanning, language validation, and metadata enrichment.
- Crawler subsystem fetches and ingests web sources.
- Per-twin KB file allow-lists so a twin only retrieves from specific documents.
- Voice catalogue management.
- Per-twin chat / call greeting customisation.
- Suggested questions surface (`GET /api/public/suggested-questions`) curated by the admin team for the chat-landing UI.

### 4.9 Patient accounts and twin access control

Admins provision patient accounts and grant per-account access to specific twins, so each patient only sees the twin(s) they're authorised to chat with. The same auth/JWT flow used by admins is reused — the `users` collection stores the role (`Admin` vs. patient) and an access-list maps users to the twins they can reach.

- Admin creates a patient: name, email, login, initial password.
- Admin grants access: pick one or more twins from their owned list and link them to the patient.
- Patient logs in with their credentials, sees only the twins on their access list, can chat or call any of them.
- Revocation is symmetric — removing a twin from the access list immediately blocks the patient's next request.

This turns the platform into a **per-patient cohort tool**: an admin running a hypertension cohort and an admin running a diabetes cohort can each provision their patients and grant access only to the twin tuned for that condition. Sessions still persist under the patient's `userId`, so all the analytics below are scoped per-patient and per-cohort.

### 4.10 Analytics dashboard

The admin dashboard surfaces operational and clinical-engagement metrics derived from the persisted session, message, and call data. All metrics are scoped to the admin's owned twins (or to a selected twin), with optional date-range filters.

**Headline KPIs**

| Metric | What it counts |
|---|---|
| **Active Patients** | Distinct patient accounts that have sent at least one message in the period |
| **New Patients** | Patient accounts created in the period |
| **Messages Sent** | Total chat + WhatsApp messages from patients in the period |
| **Total Chats** | Total chat sessions opened in the period |
| **Total Calls** | Total voice call sessions opened in the period |
| **Avg Response Time** | Mean LLM reply latency (`responseTime` on `queries`) |
| **Avg Call Duration** | Mean `durationSeconds` across closed `call_sessions` |

**Time-series and breakdown views**

- **Activity Over Time** — daily / weekly counts of messages and calls, plotted as a stacked area so admins can see growth and channel mix together.
- **When Are Patients Most Active?** — heatmap of message timestamps by hour-of-day and day-of-week, useful for staffing community-health-worker follow-up and for picking notification windows.
- **Channel Split** — chat vs. voice call vs. WhatsApp, as a count and as a percentage of total turns.
- **Top Conversation Topics** — the most-frequent twin categories / service labels surfaced from the auto-router's `routing_meta` on each turn (hypertension, tobacco cessation, healthy lifestyle, etc.). Built from `queries.metadata.routing` aggregations.
- **Twin Performance** — per-twin breakdown of message volume, call count, average response time, and abstention rate (turns where the LLM declined to answer due to no grounding). Helps admins spot a twin whose KB needs more documents.
- **Patient Engagement** — distribution of patients by session count (one-time, occasional, regular, intensive) so admins can identify drop-off cohorts and re-engage them.

All metrics read from existing collections (`queries`, `chatSessions`, `chatSessionMessages`, `call_sessions`, `call_messages`, `users`, `aiTwins`) — no new write paths, just aggregation queries fronted by `analytics-routes.js`.

### 4.11 Frontend (V2)

- Vue 3 + Pinia + TypeScript.
- Routes: `/signin`, `/twins`, `/twins/:id`, `/chat/:twinId?`, `/call/:twinId?`, `/admin/...`.
- Voice runtime (`src/services/voiceCall.ts`, `src/stores/voiceCall.ts`) — TS port of the WebSocket protocol with the same 4-layer echo strategy.
- Audio playback per message (user voice notes + assistant TTS).
- Multilingual UI (i18n with locale files for 14+ languages — including Mandinka and Wolof at the UI level, even though the translation backend for those two is still partial; see §4.3.1).

### 4.12 Measured performance

All numbers below come from real production calls against <https://genie.innov8ai.com/> with the current KB (~750 chunks). Captured from voice-bridge logs.

**Voice call — end-of-speech to first audio**

| Stage | Median | Notes |
|---|---|---|
| VAD silence detection | 300 ms | `SILENCE_FRAMES=15` × 20 ms |
| ASR (Whisper) | 150 ms | 2-second utterance |
| Embed query (TEI) | 10 ms | 768-dim |
| **Inline RAG (AQL k-NN, top-3)** | **~20 ms** | Direct cosine scan over `GRAPH_SOURCE` |
| LLM first token (vLLM, streaming) | 80 ms | Llama 3.1 8B, warm |
| TTS first sentence (Piper) | 400 ms | en_US-ryan-high |
| **Total perceived latency** | **~1.0 s** | end of user speech → first audio |

Sample retrieval result with the new KB doc (BP educational material) and a matching question:

```
[ASR] done elapsed=0.15s text='What is blood pressure?'
[RAG] - sim=0.874 file=1778073444660 chunk=14  preview='## 2. What is blood pressure?'
[RAG] - sim=0.829 file=1778073444660 chunk=15  preview='Blood pressure is the pressure of blood in your blood vessels...'
[RAG] - sim=0.789 file=1778073444660 chunk=25  preview='Hypertension is diagnosed when blood pressure is equal to or greater than 140/90...'
[RAG] retrieved 3 chunks in 0.02s
[LLM] first token after 0.11s
[TTS] start text='Blood pressure is the pressure of blood in your blood vessels when your heart is beating.'
```

The model's reply is a near-direct paraphrase of the second chunk — verifiable RAG grounding, end-to-end, in under a second.

**Web chat (with full ChatQnA pipeline)**

| Stage | Median |
|---|---|
| Translation in (if non-English) | ~1 s |
| Embed + retrieve (graph + reranker) | ~3 s |
| LLM (non-streaming) | ~1.5 s |
| Translation out (if non-English) | ~1 s |
| **Total** | **~5–7 s** depending on language |

The trade-off is intentional: chat tolerates the latency in exchange for richer retrieval (graph hop, reranker, source citations). Voice cannot. Both paths consume the same `GRAPH_SOURCE` chunks — only the depth of retrieval differs (see §4.5 comparison table).

**Throughput note**

The current single-host deploy has been tested with a small number of concurrent users. vLLM and TEI scale horizontally; ArangoDB AQL retrieval is the only single-process step in the voice path and is unbounded by users (~50 ms per query regardless of concurrent count, up to vector-store FS bandwidth).

---

## 5. API reference

The full OpenAPI 3 spec is published at runtime:

- **Swagger UI**: `https://<host>/api-docs/`
- **JSON**: `https://<host>/api-docs.json`

Tagged sections of note:

- **Auth** — register, login, refresh, change password.
- **AI Twins** — CRUD + voice + avatar + KB files + personality + settings.
- **Chat Sessions** — create, list (with last-message + user object), send message, voice messages, message audio, languages.
- **Voice** — token mint, sessions list with filters (twinId, language, dateRange, sort).
- **Public (Guest)** — twin directory, chat sessions, voice token, suggested questions, languages.

---

## 6. Safety, compliance, and content policy

### 6.1 System prompt

The chat system prompt anchors the assistant to:

- WHO non-communicable diseases guidance.
- WHO–ITU Be He@lthy Be Mobile (BHBM) framing.
- Gambian Ministry of Health national guidelines.

The prompt explicitly forbids the model from diagnosing, prescribing, or changing treatment; it routes specific clinical questions to a clinic or community health worker. Out-of-scope topics (infectious disease, paediatrics, surgical advice, etc.) are routed similarly.

### 6.2 Red-flag detection

System prompt examples teach the model to recognise emergency presentations (chest pain + arm numbness, stroke warning signs, severe hypoglycaemia) and route them to urgent in-person care immediately rather than continuing the conversation.

### 6.3 Abstention

When the retrieval step finds no grounded documents for a clinical question, the assistant abstains and refers the user to a clinic. `CHATQNA_ENFORCE_ABSTENTION=true` is the default.

### 6.4 Anti-autocomplete framing

Chat history is wrapped in an explicit `[user turn]` / `[assistant turn]` syntax (not the literal `USER:` / `ASSISTANT:` markers Llama is trained to autocomplete) and is followed by a closing `[end of conversation history]` sentinel plus an explicit "reply only as the assistant — do not invent further user turns" instruction. Defence in depth: a post-LLM regex strips any leaked markers, and any autocompleted user-voice tail is cut at the first leaked `[user turn]`.

### 6.5 Content moderation hooks

- ClamAV scanning on every uploaded document.
- File-type allow-lists in `document-repository`.
- Language validation: only English-language documents are accepted for ingestion (matches the embedder's training language).

### 6.6 Token & secret hygiene

- JWT-based auth with HS256; secrets shared between backend, voice-bridge, and document-repository via env.
- Refresh tokens rotate on use.
- Voice tokens are short-lived (5 minutes).
- All public routes are unauthenticated by design but stamped with `userId = "guest:<uuid>"` so guest data is permanently fenced off from registered-user data.

---

## 7. Integration with the GENIE.AI framework

This submission is built **inside** the GENIE.AI / OPEA reference architecture. We did not wrap, sidecar, or replace it; we extended it.

### 7.1 GENIE.AI components used directly

| Component | How we use it |
|---|---|
| **ChatQnA megaservice** (`chatqna-xeon-backend-server`) | Primary chat pipeline. We override `align_inputs`/`align_outputs` to inject retrieval context and a custom routing-filter strategy, override `handle_request` to add auto-routing, language detection/translation, and personality injection. |
| **Dataprep service** (`dataprep-arango-service`) | Document ingestion. Used unmodified — we feed it Gambia NCD source documents through `document-repository`'s upload flow. |
| **Retriever service** (`retriever-arango-service`) | Hybrid vector + graph retrieval. We use the existing Arango schema and add per-twin KB-file filtering at the metadata level. |
| **TEI Embedding** | `BAAI/bge-base-en-v1.5`. English embeddings; non-English queries translated to English before embedding. |
| **TEI Reranker** | `cross-encoder/ms-marco-MiniLM-L-6-v2`. |
| **vLLM** | `meta-llama/Meta-Llama-3.1-8B-Instruct` for chat, `google/gemma-3-4b-it` for translation. |
| **OPEA `comps` library** | `CustomLogger`, `MicroService`, `ServiceOrchestrator`, `ChatCompletionRequest`, all the megaservice scaffolding for orchestrating embed → retrieve → rerank → llm. |
| **`api_protocol` and `constants`** | Extended (not replaced) with `RequestContext.skipAutoRoute` and a routing metadata schema; original behaviour preserved as a fallback. |

### 7.2 Adherence to reference architecture

- **Service decomposition** matches GENIE.AI's microservice split (BFF / megaservice / specialist services / data layer).
- **Service-to-service auth** uses GENIE.AI's Keycloak service-account client (`KC_DATAPREP_CLIENT_SECRET`, `KEYCLOAK_PROXY_CLIENT_SECRET`).
- **Data layer** is the same ArangoDB schema GENIE.AI ships (collections: `users`, `queries`, `serviceCategories`, `services`, `serviceCategoryTranslations`, plus our additions).
- **Logging** uses GENIE.AI's `CustomLogger` from `comps`, not bespoke logging.
- **Coding standards** — Python (Ruff config from `genie-ai-overlay/pyproject.toml`), Node.js (ESLint 10 + Prettier 3 from the project root), Vue/TS (V2 frontend's eslint config). Lint is enforced in CI hooks.

### 7.3 Where we extend (not replace) the framework

These are our additions, all built **on top of** GENIE.AI primitives:

- **Anti-autocomplete history format** in chatqna's prompt assembly, replacing the previous `USER:` / `ASSISTANT:` markers Llama would autocomplete past.
- **Language auto-routing** in chatqna (`context_auto_router.py`) — when the client doesn't pin a category/service, the system classifies the query against the live taxonomy and selects a retrieval filter. The previous "manual context only" path is preserved for clients that pass `skipAutoRoute`.
- **Personality directive injection** as a leading `role: system` message — chatqna, voice-bridge, and whatsapp-service all use the same directive wording.
- **Per-twin KB allow-lists** (`linkedKbFileIds` on `aiTwins`) feeding into retrieval — twins only see documents they're entitled to.
- **Per-admin twin ownership** (`ownerId` on `aiTwins`) — multi-tenant scoping built around GENIE.AI's existing user/auth layer.

---

## 8. Contributions back to GENIE.AI

Concrete pieces of this submission that could be upstreamed as reusable GENIE.AI modules:

### 8.1 WebSocket voice bridge with inline RAG

`genie-ai-overlay/voice-bridge/`. A complete voice-agent stack built on a single TLS-443 WebSocket — same transport as the rest of the API, no separate signalling channel, no media-server cluster, deploys with the rest of the stack as one more compose service. Pairs a server-side echo strategy (browser AEC, mic-mute-while-speaking, post-utterance drain, RMS barge-in) with a slim inline RAG that runs against the same `GRAPH_SOURCE` chunk store the chat path uses. Replies stay grounded while end-to-end latency stays around one second. Likely reusable as a default voice profile for other GENIE.AI verticals.

### 8.2 AI Twin / Personality system

`components/gov-chat-backend/services/ai-twin-service.js` + the cross-language personality directive. A first-class twin abstraction with per-tenant ownership, voice + greeting + tone + length controls. Generalises beyond NCD use cases (any vertical with multi-persona deployments — agriculture, education, civic services).

### 8.3 WhatsApp adapter

`genie-ai-overlay/whatsapp/`. A complete, working pattern for routing Meta Cloud API webhooks (text + voice notes) through ChatQnA, with personality injection, dedup, persistence, and Piper TTS hooks. Reusable for any GENIE.AI deployment that needs WhatsApp reach.

### 8.4 Public guest API surface

`components/gov-chat-backend/routes/public-routes.js`. A clean pattern for exposing limited functionality to unauthenticated users (sharable links) without compromising the auth model. Guest data is fenced off via `userId = "guest:<uuid>"` so it can never collide with authenticated sessions. Reusable for any vertical that wants frictionless public access alongside a logged-in product.

### 8.5 Anti-autocomplete history format

The `[user turn] / [assistant turn]` + sentinel + post-strip pattern in `genieai_chatqna.py`. A real prompt-engineering improvement that prevents Llama 3.1 (and similar instruct models) from autocompleting their own chat history into the user's voice. Tested fix for a class of multi-turn hallucinations. Probably the single highest-impact small change in our submission.

### 8.6 Per-admin tenancy on AI artefacts

The `ownerId` scoping pattern — applied uniformly across twin reads, writes, KB linking, settings, voice assignment, and personality. Generalisable framework for adding multi-tenancy to any GENIE.AI artefact.

### 8.7 Multilingual NCD domain pack

System prompts in `_DEFAULT_SYSTEM_PROMPTS` for English, French, Spanish, Swahili — all anchored to WHO/BHBM/Gambia MoH framing. Voice greetings in the same languages. The pattern is reusable for other regional deployments by swapping the framing while keeping the safety / abstention / red-flag scaffolding intact.

---

## 9. Repository layout

```
genie-ai/
├── components/
│   ├── gov-chat-backend/        # Node.js BFF (auth, sessions, twins, public API)
│   ├── genie-ai-frontend-v2/    # Vue 3 + Pinia + TS client
│   ├── document-repository/     # File upload, crawler, ClamAV
│   └── gov-chat-frontend/       # Legacy V1 frontend (kept for transition)
├── genie-ai-overlay/
│   ├── chatqna/                 # OPEA megaservice with our extensions
│   │   ├── genieai_chatqna.py
│   │   ├── context_auto_router.py
│   │   ├── language_codes.json
│   │   └── Dockerfile-chatqna_genie-ai
│   ├── voice-bridge/            # WebSocket voice agent (TLS-443, inline RAG)
│   ├── whatsapp/                # Meta Cloud API adapter
│   ├── http-service/            # Internal service-account auth client
│   ├── retriever/               # Hybrid Arango retriever (OPEA)
│   ├── dataprep/                # Document ingestion (OPEA)
│   ├── reranker/                # TEI reranker (OPEA)
│   └── core/                    # Shared protocol + constants
├── api-gateway-solution/        # Kong + nginx config
├── deploy/ansible/              # Optional Ansible automation
├── scripts/                     # Helper scripts (Piper voice download, etc.)
├── data/piper-voices/           # TTS model files (gitignored)
├── docs/                        # Architecture, e2e tests, runbooks
├── docker-compose.yaml          # Single-source dual-mode stack (compose + swarm)
├── env                          # Configuration template (no secrets)
└── SUBMISSION.md                # This document
```

---

**Submitted by:** Innov8AI team
**Live deployment:** <https://genie.innov8ai.com/>
**Last verified deploy:** runs on a single Ubuntu 22.04 host with one NVIDIA GPU.

