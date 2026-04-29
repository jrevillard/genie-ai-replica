# Amina — Session Changelog & Pending Items

## Date: March 2026

---

## PENDING — Come Back To These

### High Priority
1. **Frontend TTS audio not playing in browser** — backend TTS works (200 OK), but browser may not be playing the audio. Need to check DevTools console for errors on `http://localhost:5173`
2. **FAISS retrain with 244 examples** — currently trained with 75 examples (old script). New `train_intents.py` has 244 examples but needs to be copied and retrained inside container
3. **Keyword Retriever returns 0 documents** — Vector retriever works (10 docs) but keyword retriever finds nothing. May need to check ArcadeDB keyword index or the keyword retriever logic
4. **Triage response still has markdown** (`**Red Flags (Emergency):**`) — need to update `template_triage.jinja` to match the no-markdown rule like we did for `template_assistant.jinja`
5. **Frontend App.jsx points to port 8000** — verify all endpoints work end-to-end in browser (text chat, voice recording, TTS playback, avatar lip sync)

### Medium Priority
6. **Multichannel-access component** — built but not deployed/tested. Needs ArcadeDB client integration and gateway_client pointing to port 8000
7. **Telegram bot integration** — code ready in `multichannel-access/app/channels/telegram.py`, needs bot token and webhook setup
8. **WhatsApp/Messenger** — pending Meta platform access (document sent to ITU/WHO)
9. **More NCD documents for ingestion** — currently only 1 PDF (Gambia cessation guidelines 2016). Need WHO NCD guidelines, diabetes management guides, Gambian health data
10. **Conversation history persistence** — currently no session storage across messages. Need ArcadeDB session store (code exists in multichannel-access)

### Low Priority
11. **ElevenLabs African voice** — `tts_elevenlabs.py` written, not deployed. $5/mo for Nigerian accent
12. **Voice-gateway can be retired** — all functionality now in Haystack service. Keep as fallback or remove
13. **Custom Gambian voice training** — Piper voice training on 3080 Ti for Mandinka/local accent
14. **Template improvements** — `template_smalltalk.jinja` and `template_triage.jinja` may need Amina personality updates

---

## ALL CHANGES MADE

### 1. Architecture Shift: Voice-Gateway → Haystack as Single Brain

**Before:**
```
Frontend (5173) → Voice-Gateway (8010) → Direct OpenAI call
                                       → Whisper STT
                                       → Piper TTS
```

**After:**
```
Frontend (5173) → Haystack Service (8000) → Intent Classifier (FAISS)
                                          → ArcadeDB (vector + keyword retrieval)
                                          → Ranker (cross-encoder)
                                          → OpenAI GPT-4o-mini (with RAG context)
                                          → Whisper STT (container, port 8087)
                                          → Piper TTS (container, port 5500)
```

### 2. Docker Infrastructure (haystack-stack/docker-compose.yml)

**Before:** 1 container (haystack-chatqna + arcadedb)
**After:** 4 containers

| Container | Port | Purpose |
|-----------|------|---------|
| arcadedb | 2480 | Knowledge graph + vector store |
| voice-stt | 8087 | Whisper.cpp STT |
| voice-tts | 5500 | Piper TTS (standalone service) |
| haystack-chatqna | 8000 | RAG pipeline + API routing |

### 3. LLM Swap: Gemini → OpenAI

**File:** `haystack-chatqna/src/pipelines/chat.py`

```python
# OLD (commented out):
#from haystack_integrations.components.generators.google_genai import GoogleGenAIChatGenerator
#llm = GoogleGenAIChatGenerator(model=settings.LLM_MODEL_NAME)

# NEW:
from haystack.components.generators.chat import OpenAIChatGenerator
llm = OpenAIChatGenerator(
    model=settings.OPENAI_MODEL,
    generation_kwargs={"temperature": 0.3},
)
```

### 4. New TTS Microservice (haystack-stack/tts-service/)

Created standalone Piper TTS container:

```
tts-service/
├── server.py          # FastAPI: /v1/tts (WAV), /v1/tts/ogg (Opus), /health
├── Dockerfile         # python:3.10 + ffmpeg + piper-tts
└── requirements.txt   # fastapi, uvicorn, piper-tts
```

Endpoints:
- `POST /v1/tts` → text → WAV audio
- `POST /v1/tts/ogg` → text → OGG Opus (for messaging voice notes)
- `GET /health` → health check

### 5. New Voice Endpoints in Haystack (src/api/routes.py)

Added 4 new endpoints alongside existing `/chat`:

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `POST /api/v1/chat` | Original RAG pipeline (unchanged) | ✅ |
| `POST /api/v1/text-chat` | Simplified chat for frontend/multichannel | ✅ NEW |
| `POST /api/v1/stt` | Audio → Whisper → transcript | ✅ NEW |
| `POST /api/v1/tts` | Text → Piper TTS → WAV audio | ✅ NEW |
| `POST /api/v1/voice-chat` | Audio → STT → RAG → LLM → TTS | ✅ NEW |
| `POST /api/v1/voice-chat-audio` | Same but returns WAV directly | ✅ NEW |

### 6. New Service Files in Haystack

| File | Purpose |
|------|---------|
| `src/services/__init__.py` | Package init |
| `src/services/stt_whisper.py` | Calls Whisper.cpp container via HTTP, handles audio normalization |
| `src/services/tts_piper.py` | Calls TTS container via HTTP (was subprocess, now HTTP client) |

### 7. Updated Schemas (src/api/schemas.py)

Added alongside existing `ChatRequest`/`ChatResponse`:
- `TTSRequest` — text field for TTS
- `TextChatRequest` — simplified chat (text + history)
- `TextChatResponse` — transcript + answer
- `VoiceChatResponse` — transcript + answer + has_audio flag

### 8. Updated Config (src/config.py)

Added:
```python
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
WHISPER_URL = os.getenv("WHISPER_URL", "http://voice-stt:8080")
TTS_URL = os.getenv("TTS_URL", "http://voice-tts:5500")
```

### 9. CORS Added (src/main.py)

```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 10. ArcadeDB Schema Creation (src/ingestion/arcadedb_schema.py)

Was empty. Now creates `Chunk` document type with properties:
- `chunk_id` (STRING, unique index)
- `text` (STRING)
- `embedding` (LIST)
- `source` (STRING)
- `title` (STRING)

Run: `docker exec haystack-chatqna python -c "from src.ingestion.arcadedb_schema import create_schema; create_schema()"`

### 11. Data Ingestion

Ingested: `The Gambia cessation clinical guidelines 2016.pdf`
- Split into ~250 word chunks
- Embedded with sentence-transformers/all-MiniLM-L6-v2
- Stored in ArcadeDB `Chunk` type with vectors

Run: `docker exec haystack-chatqna python -m src.ingestion.run_ingestion`

### 12. Intent Classifier Upgrade (src/utils/intent_classifier.py)

**Before:** 2 layers (tiny rules + 10-example FAISS)
**After:** 3 layers with expanded rules

```
Layer 1 (Rules — instant, no ML):
  ├── Greetings (20 patterns) → smalltalk
  ├── Red flags (16 keywords) → triage
  ├── Urgent symptom + modifier → triage
  ├── Health keywords (70+ including Gambian foods) → assistant  ← NEW
  └── Question patterns ("what is", "how to", "can I eat") → assistant  ← NEW

Layer 2 (FAISS): 75 vectors (was 10) — 244-example script ready but needs retrain

Layer 3: Default → assistant
```

### 13. FAISS Training Script (src/utils/train_intents.py)

**Created new file** with 244 training examples:
- 50 triage (chest pain, stroke, breathing, blood sugar crisis, etc.)
- 159 assistant (diabetes, hypertension, cancer, respiratory, smoking, mental health, medication, Gambian foods, pregnancy+NCD)
- 35 smalltalk (greetings, meta questions, Wolof/Arabic greetings)

Currently trained with 75 examples. Run full retrain:
```bash
docker exec haystack-chatqna python -m src.utils.train_intents
docker restart haystack-chatqna
```

### 14. Assistant Prompt Template (src/prompts/template_assistant.jinja)

**Before:** "If context is insufficient, say you don't know."
**After:** "If the context does not fully cover the question, supplement with your general medical knowledge."

Added Amina personality, Gambian food references, no-markdown rule, TTS-friendly formatting.

### 15. Frontend URL Changes (components/voice-frontend/src/App.jsx)

| Before | After |
|--------|-------|
| `http://127.0.0.1:8010` | `http://127.0.0.1:8000` |
| `/v1/tts` | `/api/v1/tts` |
| `/v1/stt` | `/api/v1/stt` |
| `/v1/text-chat` | `/api/v1/text-chat` |
| `/v1/stt-chat` | `/api/v1/voice-chat` |

### 16. Environment Variables (.env)

```
API_HOST=0.0.0.0
API_PORT=8000
GOOGLE_API_KEY=AIza... (kept as fallback)
LLM_MODEL_NAME=gemini-3-flash-preview (kept as fallback)
ARCADEDB_URL=http://arcadedb:2480
ARCADEDB_DB=genie
ARCADEDB_USER=root
ARCADEDB_PASSWORD=genieRoot123
ARCADEDB_ROOT_PASSWORD=genieRoot123
WHISPER_URL=http://voice-stt:8080
TTS_URL=http://voice-tts:5500
OPENAI_API_KEY=sk-proj-... (new key)
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 17. Requirements Updates

**haystack-chatqna/requirements.txt** — added:
```
python-multipart>=0.0.9
httpx>=0.27.0
```

Note: `piper-tts` removed from haystack container (now in tts-service container).

---

## Startup Commands

```powershell
# Start all services
cd D:\GenAI\amina\genie-ai-replica\haystack-stack
docker compose up --build -d

# Create schema (first time only)
docker exec haystack-chatqna python -c "from src.ingestion.arcadedb_schema import create_schema; create_schema()"

# Ingest documents (first time only)
docker exec haystack-chatqna python -m src.ingestion.run_ingestion

# Retrain FAISS intents (after updating train_intents.py)
docker exec haystack-chatqna python -m src.utils.train_intents
docker restart haystack-chatqna

# Start frontend
cd D:\GenAI\amina\genie-ai-replica\components\voice-frontend
npm run dev
```

## Test Commands

```powershell
# Health check
Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing

# Text chat
$body = '{"text":"What is diabetes?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content

# TTS
$body = '{"text":"Hello I am Amina"}'
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:5500/v1/tts" -ContentType "application/json" -Body $body -OutFile test.wav -UseBasicParsing

# Check routing
docker logs haystack-chatqna --tail 5
```

---

## File Map — What Changed Where

```
haystack-stack/
├── docker-compose.yml              REPLACED (added voice-stt, voice-tts, OpenAI env vars)
├── .env                            REPLACED (added OpenAI keys, voice service URLs)
├── tts-service/                    NEW FOLDER
│   ├── server.py                   NEW (Piper TTS FastAPI service)
│   ├── Dockerfile                  NEW
│   └── requirements.txt            NEW
└── haystack-chatqna/
    ├── Dockerfile                  UPDATED (added ffmpeg, curl)
    ├── requirements.txt            UPDATED (added python-multipart, httpx)
    └── src/
        ├── main.py                 UPDATED (added CORS middleware)
        ├── config.py               UPDATED (added OpenAI, Whisper, TTS settings)
        ├── api/
        │   ├── routes.py           UPDATED (added /stt, /tts, /text-chat, /voice-chat)
        │   └── schemas.py          UPDATED (added TTSRequest, TextChatRequest, etc.)
        ├── pipelines/
        │   └── chat.py             UPDATED (Gemini → OpenAI)
        ├── prompts/
        │   └── template_assistant.jinja  UPDATED (removed "say I don't know", added Amina personality)
        ├── services/               NEW FOLDER
        │   ├── __init__.py         NEW
        │   ├── stt_whisper.py      NEW (Whisper HTTP client)
        │   └── tts_piper.py        NEW (TTS HTTP client)
        ├── utils/
        │   ├── intent_classifier.py UPDATED (expanded rules, health keywords, Gambian foods)
        │   └── train_intents.py    NEW (244 training examples)
        └── ingestion/
            └── arcadedb_schema.py  UPDATED (was empty, now creates Chunk type)

components/voice-frontend/
└── src/
    └── App.jsx                     UPDATED (port 8010→8000, /v1/→/api/v1/, stt-chat→voice-chat)
```
