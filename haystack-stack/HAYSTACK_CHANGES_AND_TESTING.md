# Amina Haystack Integration — Complete Changes & Testing Guide

## Architecture Overview

```
BEFORE:
  Frontend (5173) → Voice-Gateway (8010) → Direct OpenAI → response
                                         → Whisper STT (subprocess)
                                         → Piper TTS (subprocess)

AFTER:
  Frontend (5173) → Haystack Service (8000) → Intent Classifier (FAISS + rules)
                                             → ArcadeDB (vector + keyword retrieval)
                                             → Cross-encoder Ranker
                                             → OpenAI GPT-4o-mini (with RAG context)
                                             → Whisper STT (container, port 8087)
                                             → Piper TTS (container, port 5500)
```

Four Docker containers, one docker-compose:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  arcadedb     │  │  voice-stt   │  │  voice-tts   │  │  haystack    │
│  Port 2480    │  │  Port 8087   │  │  Port 5500   │  │  Port 8000   │
│  Graph + Vec  │  │  Whisper.cpp │  │  Piper TTS   │  │  RAG + LLM   │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

---

## All Files Changed

### haystack-stack/docker-compose.yml — REPLACED

Added 3 new containers (voice-stt, voice-tts, arcadedb healthcheck removed), added OpenAI env vars, added env_file directive.

Key additions:
```yaml
env_file:
  - .env
environment:
  OPENAI_API_KEY: ${OPENAI_API_KEY}
  OPENAI_MODEL: ${OPENAI_MODEL:-gpt-4o-mini}
  OPENAI_BASE_URL: ${OPENAI_BASE_URL:-https://api.openai.com/v1}
  WHISPER_URL: http://voice-stt:8080
  TTS_URL: http://voice-tts:5500
```

Test:
```powershell
cd D:\GenAI\amina\genie-ai-replica\haystack-stack
docker compose up -d
docker ps
# Should show 4 containers: arcadedb, voice-stt, voice-tts, haystack-chatqna
```

---

### haystack-stack/.env — RECREATED

Full contents (no comments, no quotes, each on its own line):
```
API_HOST=0.0.0.0
API_PORT=8000
GOOGLE_API_KEY=AIza...  (your Gemini key, kept as fallback)
LLM_MODEL_NAME=gemini-3-flash-preview
ARCADEDB_URL=http://arcadedb:2480
ARCADEDB_DB=genie
ARCADEDB_USER=root
ARCADEDB_PASSWORD=genieRoot123
ARCADEDB_ROOT_PASSWORD=genieRoot123
WHISPER_URL=http://voice-stt:8080
TTS_URL=http://voice-tts:5500
OPENAI_API_KEY=sk-proj-...  (your OpenAI key)
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

CRITICAL: If PowerShell caches old OPENAI_API_KEY in system env, it overrides .env.
Fix permanently: Run `rundll32 sysdm.cpl,EditEnvironmentVariables` and delete OPENAI_API_KEY from both User and System variables.

Test:
```powershell
# Verify no cached key in shell
echo $env:OPENAI_API_KEY
# Should be blank

# Verify container has correct key
docker exec haystack-chatqna env | Select-String "OPENAI_API_KEY"
# Should show your new key
```

---

### haystack-stack/tts-service/ — NEW FOLDER

Standalone Piper TTS microservice.

Files:
- server.py — FastAPI with /v1/tts (WAV), /v1/tts/ogg (Opus), /health
- Dockerfile — python:3.10 + ffmpeg + piper-tts
- requirements.txt — fastapi, uvicorn, piper-tts

Test:
```powershell
# Direct TTS container test
Invoke-WebRequest -Uri "http://127.0.0.1:5500/health" -UseBasicParsing

$body = '{"text":"Hello I am Amina"}'
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:5500/v1/tts" -ContentType "application/json" -Body $body -OutFile test_direct.wav -UseBasicParsing
ls test_direct.wav
# Should create a WAV file (check file size > 1KB)
```

---

### haystack-chatqna/Dockerfile — UPDATED

Added ffmpeg and curl:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ffmpeg \
        curl \
    && rm -rf /var/lib/apt/lists/*
```

---

### haystack-chatqna/requirements.txt — UPDATED

Added at the bottom:
```
python-multipart>=0.0.9
httpx>=0.27.0
```

python-multipart is required for file upload endpoints (STT, voice-chat).
httpx is required for calling Whisper and TTS containers via HTTP.

---

### haystack-chatqna/src/main.py — UPDATED

Two additions to existing code:

1. CORS middleware (allows frontend at localhost:5173 to call backend):
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

2. Auto-create ArcadeDB schema on startup:
```python
@app.on_event("startup")
async def startup_event():
    from src.utils.arcade_client import command_sql
    try:
        command_sql("CREATE DOCUMENT TYPE Chunk IF NOT EXISTS")
        command_sql("CREATE PROPERTY Chunk.chunk_id IF NOT EXISTS STRING")
        command_sql("CREATE PROPERTY Chunk.text IF NOT EXISTS STRING")
        command_sql("CREATE PROPERTY Chunk.embedding IF NOT EXISTS LIST")
        command_sql("CREATE PROPERTY Chunk.source IF NOT EXISTS STRING")
        command_sql("CREATE PROPERTY Chunk.title IF NOT EXISTS STRING")
        print("✅ ArcadeDB schema initialized")
    except Exception as e:
        print(f"⚠️ Schema init warning (may already exist): {e}")
```

Test:
```powershell
docker logs haystack-chatqna --tail 15
# Should show: ✅ ArcadeDB schema initialized
```

---

### haystack-chatqna/src/config.py — UPDATED

Added OpenAI, Whisper, and TTS settings:
```python
# NEW additions
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
WHISPER_URL = os.getenv("WHISPER_URL", "http://voice-stt:8080")
TTS_URL = os.getenv("TTS_URL", "http://voice-tts:5500")
```

---

### haystack-chatqna/src/pipelines/chat.py — UPDATED

Swapped Gemini for OpenAI. Old code commented, new code marked:

```python
# OLD (commented out):
#from haystack_integrations.components.generators.google_genai import GoogleGenAIChatGenerator
#os.environ["GOOGLE_API_KEY"] = settings.GOOGLE_API_KEY
#llm = GoogleGenAIChatGenerator(model=settings.LLM_MODEL_NAME)

# NEW:
from haystack.components.generators.chat import OpenAIChatGenerator
os.environ["OPENAI_API_KEY"] = settings.OPENAI_API_KEY
llm = OpenAIChatGenerator(
    model=settings.OPENAI_MODEL,
    generation_kwargs={"temperature": 0.3},
)
```

Note: Do NOT pass api_key= directly. Haystack reads OPENAI_API_KEY from os.environ automatically. Passing it as a string causes `'str' has no attribute 'resolve_value'` error.

Test:
```powershell
$body = '{"text":"What is diabetes?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Should return a real health answer, not "I don't know"
```

---

### haystack-chatqna/src/api/schemas.py — UPDATED

Added voice schemas alongside existing ChatRequest/ChatResponse:
```python
# NEW additions
class TTSRequest(BaseModel):
    text: str

class TextChatRequest(BaseModel):
    text: str
    history: Optional[list[Message]] = []
    user_age: Optional[int] = 30
    user_gender: Optional[str] = "person"

class TextChatResponse(BaseModel):
    transcript: str
    answer: str

class VoiceChatResponse(BaseModel):
    transcript: str
    answer: str
    has_audio: bool = False
```

---

### haystack-chatqna/src/api/routes.py — UPDATED

Added to existing code (all marked with # <- NEW):

1. `import re` — for markdown stripping
2. `_strip_markdown()` function — removes **, ##, -, *, bullets, numbered lists
3. `answer = _strip_markdown(answer)` — applied in every endpoint that returns LLM text
4. Four new endpoints:

| Endpoint | Purpose |
|----------|---------|
| POST /api/v1/chat | Original RAG (unchanged, added markdown strip) |
| POST /api/v1/text-chat | Simplified chat for frontend (NEW) |
| POST /api/v1/stt | Audio to text via Whisper (NEW) |
| POST /api/v1/tts | Text to audio via Piper (NEW) |
| POST /api/v1/voice-chat | Full pipeline: STT → RAG → LLM → TTS (NEW) |
| POST /api/v1/voice-chat-audio | Same but returns WAV directly (NEW) |

Test all endpoints:
```powershell
# Health check
Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing

# Text chat
$body = '{"text":"What is hypertension?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content

# TTS through Haystack (proxies to TTS container)
$body = '{"text":"Hello I am Amina"}'
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/tts" -ContentType "application/json" -Body $body -OutFile test_proxy.wav -UseBasicParsing
ls test_proxy.wav

# Verify no markdown in response (no **, ##, -, *)
$body = '{"text":"Give me a plan to manage diabetes","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Response should be clean text, no formatting symbols
```

---

### haystack-chatqna/src/services/ — NEW FOLDER

Two new files:

**stt_whisper.py** — Calls Whisper.cpp container via HTTP
- Normalizes audio to 16kHz mono WAV using ffmpeg
- Posts to Whisper /inference endpoint
- Returns transcript text

**tts_piper.py** — Calls TTS container via HTTP
- Posts text to voice-tts:5500/v1/tts
- Returns WAV audio bytes

Test STT (requires audio file):
```powershell
# Generate a WAV first via TTS, then transcribe it back
$body = '{"text":"Hello I am testing speech to text"}'
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:5500/v1/tts" -ContentType "application/json" -Body $body -OutFile stt_test.wav -UseBasicParsing

# Now transcribe it
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/stt" -InFile stt_test.wav -ContentType "multipart/form-data" -UseBasicParsing
```

---

### haystack-chatqna/src/ingestion/arcadedb_schema.py — CREATED (was empty)

Creates the Chunk document type with properties:
- chunk_id (STRING, unique index)
- text (STRING)
- embedding (LIST)
- source (STRING)
- title (STRING)

Now auto-created on startup via main.py. Manual run if needed:
```powershell
docker exec haystack-chatqna python -c "from src.ingestion.arcadedb_schema import create_schema; create_schema()"
```

---

### haystack-chatqna/src/utils/intent_classifier.py — UPDATED

Expanded from 2 layers to 3 layers with much broader rules:

```
Layer 1 (Rules — instant, no ML needed):
  ├── Greetings (20 patterns) → smalltalk
  ├── Red flags (16 keywords) → triage
  ├── Urgent symptom + modifier → triage
  ├── Health keywords (70+ including Gambian foods) → assistant  [NEW]
  └── Question patterns ("what is", "how to", "can I eat") → assistant  [NEW]

Layer 2 (FAISS semantic matching):
  └── 244 training examples (was 10)

Layer 3: Default → assistant
```

Test intent routing:
```powershell
# Health keyword rule (should NOT fall to low-confidence FAISS)
$body = '{"text":"Can I eat domoda if I have diabetes?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
docker logs haystack-chatqna --tail 3
# Expected: "Router (Rule): Health keyword detected → Assistant."

# Triage (urgent symptoms)
$body = '{"text":"I have severe chest pain and difficulty breathing","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
docker logs haystack-chatqna --tail 3
# Expected: "Router: Urgent Symptom Triage intent detected."

# Smalltalk (greeting)
$body = '{"text":"Hello Amina","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
docker logs haystack-chatqna --tail 3
# Expected: "Router: Greeting/smalltalk detected. Bypassing RAG."

# Off-topic (should fallback to assistant, LLM redirects)
$body = '{"text":"What is the capital of France?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
docker logs haystack-chatqna --tail 3
# Expected: FAISS fallback or "Router (Fallback)", response redirects to health

# FAISS high confidence (if retrained with 244 examples)
$body = '{"text":"What are the side effects of metformin?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
docker logs haystack-chatqna --tail 3
# Expected: "Router (FAISS): Matched 'assistant' (Confidence: 0.8+)"
```

---

### haystack-chatqna/src/utils/train_intents.py — NEW FILE

FAISS training script with 244 examples:
- 50 triage (chest pain, stroke, breathing, blood sugar crisis, bleeding, pregnancy, mental health)
- 159 assistant (diabetes, hypertension, cancer, respiratory, smoking, mental health, medication, Gambian foods, pregnancy+NCD, general)
- 35 smalltalk (greetings, meta questions, Wolof/Arabic greetings)

Retrain FAISS:
```powershell
docker exec haystack-chatqna python -m src.utils.train_intents
docker restart haystack-chatqna
```

Expected output:
```
Training FAISS intent classifier with 244 examples...
✅ FAISS index saved: 244 vectors, 3 intents
   assistant: 159 examples
   smalltalk: 35 examples
   triage: 50 examples
```

---

### haystack-chatqna/src/prompts/template_assistant.jinja — UPDATED

Changed from robotic medical report style to balanced professional health advisor:
- Professional but warm tone (community health worker who cares)
- Plain text formatting with labels (Day 1:, Week 1:, Morning:) instead of markdown
- Gambian food references built into the prompt
- Never use **, ##, bullets, numbered lists
- Structured plans use paragraphs not lists
- Ends with follow-up questions when appropriate

---

### haystack-chatqna/src/prompts/template_triage.jinja — UPDATED

Added no-markdown rules:
- Calm, clear, reassuring tone
- Acknowledge → instruct → reassure in 3-5 sentences
- Never use formatting symbols
- Always direct to emergency services

---

### haystack-chatqna/src/prompts/template_smalltalk.jinja — UPDATED

Added user_age and user_gender variables (pipeline passes these, template must accept them or it errors).
Warm professional greeting style, guides toward health topics.

---

### components/voice-frontend/src/App.jsx — UPDATED

URL remapping:

| Before | After |
|--------|-------|
| http://127.0.0.1:8010 | http://127.0.0.1:8000 |
| /v1/tts | /api/v1/tts |
| /v1/stt | /api/v1/stt |
| /v1/text-chat | /api/v1/text-chat |
| /v1/stt-chat | /api/v1/voice-chat |

Test:
```powershell
cd D:\GenAI\amina\genie-ai-replica\components\voice-frontend
npm run dev
# Open http://localhost:5173
# Click a health topic
# Check DevTools console (F12) for errors
```

---

## Data Ingestion

Schema is now auto-created on startup. But documents still need manual ingestion the first time:

```powershell
docker exec haystack-chatqna python -m src.ingestion.run_ingestion
```

Currently ingested: The Gambia cessation clinical guidelines 2016.pdf
To add more documents, place them in: haystack-chatqna/data/docs/

---

## Full Startup Sequence

```powershell
# 1. Clear any cached OpenAI key from shell -------------
$env:OPENAI_API_KEY = $null

# 1.1 Check sst model existance -------------------------

# For windows
Get-Item "D:\GenAI\amina\genie-ai-replica\components\voice-gateway\infra\whispercpp\models\ggml-base.en.bin"
# If not exists or file size = 0
Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" -OutFile "C:\Users\davidayala\docker\amina\amina\components\voice-gateway\infra\whispercpp\models\ggml-base.en.bin"

# For Linux
ls -lh ~/YOUR_PATH/components/voice-gateway/infra/whispercpp/models/ggml-base.en.bin
# If not exists or file size = 0
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -O ~/PROJECT_PATH/components/voice-gateway/infra/whispercpp/models/ggml-base.en.bin


# 2. Start all services --------------------------------
cd D:\GenAI\amina\genie-ai-replica\haystack-stack
docker compose down
docker compose up --build -d

# 3. Wait for startup ----------------------------------
Start-Sleep -Seconds 25

# 4. Verify --------------------------------------------
docker ps
docker logs haystack-chatqna --tail 15

# Should show:
#   ✅ ArcadeDB schema initialized
#   ✅ FAISS Intent Index loaded instantly!
#   Uvicorn running on http://0.0.0.0:8000

docker logs dataprep-worker --tail 15

# Should show:
#   ✅ ArcadeDB schema initialized
#   Uvicorn running on http://0.0.0.0:8000 

# 5. First-time only: ingest documents -----------------

# For Windows ----
#Use this to create the schema
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8001/api/v1/schema"

#Use this to create the chunks
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8001/api/v1/ingest"

#Use this to create the graph entities (This uses an LLM so it will take time)
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8001/api/v1/enrich-graph?batch_size=100"
docker logs dataprep-worker --tail 15



# For Linux -----
#Use this to create the schema
curl -X POST http://127.0.0.1:8001/api/v1/schema

#Use this to create the chunks
curl -X POST http://127.0.0.1:8001/api/v1/ingest

#Use this to create the graph entities (This uses an LLM so it will take time)
curl -X POST "http://127.0.0.1:8001/api/v1/enrich-graph?batch_size=100"
docker logs dataprep-worker --tail 15

#docker exec haystack-chatqna python -m src.ingestion.run_ingestion

# 6. Optional: retrain FAISS with 244 examples ---------
docker exec haystack-chatqna python -m src.utils.train_intents
docker restart haystack-chatqna

# 7. Start frontend ------------------------------------
cd D:\GenAI\amina\genie-ai-replica\components\voice-frontend
npm run dev
```

---

## Full Test Suite

### Windows
```powershell
# ═══════════════════════════════
# INFRASTRUCTURE TESTS
# ═══════════════════════════════

# All containers running
docker ps
# Expected: 4 containers (arcadedb, voice-stt, voice-tts, haystack-chatqna)

# Health checks
Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing
Invoke-WebRequest -Uri "http://127.0.0.1:5500/health" -UseBasicParsing

# ArcadeDB schema auto-created
docker logs haystack-chatqna | Select-String "ArcadeDB schema"
# Expected: ✅ ArcadeDB schema initialized

# OpenAI key loaded (not old cached key)
docker exec haystack-chatqna env | Select-String "OPENAI_API_KEY"
# Verify key is correct (check last 5 chars)


# ═══════════════════════════════
# RAG PIPELINE TESTS
# ═══════════════════════════════

# Basic health question (vector retriever should find docs)
$body = '{"text":"What is hypertension?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
docker logs haystack-chatqna --tail 5
# Expected: Real health answer, logs show "Vector Retriever found 10 documents"

# Gambian food + disease context
$body = '{"text":"Can I eat domoda if I have diabetes?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Expected: Mentions domoda, portion control, groundnut paste

# Structured plan request
$body = '{"text":"Give me a one week plan to lower my blood pressure","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Expected: Organized paragraphs with labels, no ** or ## or bullets

# Multi-turn conversation
$body = '{"text":"What medications help?","history":[{"role":"user","content":"I have been diagnosed with hypertension"},{"role":"assistant","content":"I understand. Let me help you with managing your blood pressure."}]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Expected: References hypertension context from history


# ═══════════════════════════════
# INTENT ROUTING TESTS
# ═══════════════════════════════

# Test 1: Health keyword → assistant (Rule Layer)
$body = '{"text":"Is moringa good for blood sugar?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
docker logs haystack-chatqna --tail 3
# Expected log: "Router (Rule): Health keyword detected → Assistant."

# Test 2: Triage — red flag keyword
$body = '{"text":"I need an ambulance someone collapsed","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
docker logs haystack-chatqna --tail 3
# Expected log: "Router: Red Flag Emergency intent detected."

# Test 3: Triage — urgent symptom + modifier
$body = '{"text":"I have severe chest pain and trouble breathing","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
docker logs haystack-chatqna --tail 3
# Expected log: "Router: Urgent Symptom Triage intent detected."

# Test 4: Smalltalk
$body = '{"text":"Hello how are you?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
docker logs haystack-chatqna --tail 3
# Expected log: "Router: Greeting/smalltalk detected. Bypassing RAG."

# Test 5: Off-topic redirect
$body = '{"text":"Who won the FIFA World Cup?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Expected: Polite redirect to health topics

# Test 6: FAISS confidence (after retraining with 244 examples)
$body = '{"text":"What are the side effects of metformin?","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
docker logs haystack-chatqna --tail 3
# Expected: "Router (FAISS): Matched 'assistant' (Confidence: 0.8+)" or "Router (Rule)"


# ═══════════════════════════════
# VOICE PIPELINE TESTS
# ═══════════════════════════════

# TTS via Haystack proxy
$body = '{"text":"Hello I am Amina your health assistant"}'
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/tts" -ContentType "application/json" -Body $body -OutFile test_tts.wav -UseBasicParsing
ls test_tts.wav
# Expected: WAV file > 1KB

# TTS directly on container
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:5500/v1/tts" -ContentType "application/json" -Body $body -OutFile test_direct.wav -UseBasicParsing
ls test_direct.wav
# Expected: WAV file > 1KB

# STT round-trip (generate audio then transcribe it back)
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/stt" -InFile test_tts.wav -ContentType "multipart/form-data" -UseBasicParsing
# Expected: {"transcript": "Hello I am Amina..."}


# ═══════════════════════════════
# MARKDOWN STRIPPING TESTS
# ═══════════════════════════════

# These should all return clean text with no **, ##, -, or * symbols
$body = '{"text":"List ways to prevent heart disease","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Verify: No ** or ## or - or * or # in the response

$body = '{"text":"I have severe chest pain","history":[]}'
$r = Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8000/api/v1/text-chat" -ContentType "application/json" -Body $body -UseBasicParsing
$r.Content
# Verify: Triage response has no formatting symbols


# ═══════════════════════════════
# FRONTEND TEST
# ═══════════════════════════════

# Start frontend
cd D:\GenAI\amina\genie-ai-replica\components\voice-frontend
npm run dev

# Open http://localhost:5173
# Test checklist:
#   [ ] Click a health topic tag → text response appears
#   [ ] Response has no ** ## - * symbols
#   [ ] TTS audio plays (Amina speaks)
#   [ ] Avatar lip sync works during TTS
#   [ ] Press spacebar to record voice → transcription appears → response generated
#   [ ] Type a question in text box → response appears
#   [ ] Open DevTools (F12) Console → no red CORS errors
#   [ ] Health indicator (top left) shows green/connected
```


### Linux
```shell
# ═══════════════════════════════
# INFRASTRUCTURE TESTS
# ═══════════════════════════════

# All containers running
docker ps
# Expected: 4 containers (arcadedb, voice-stt, voice-tts, haystack-chatqna)

# Health checks
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8001/health
curl http://127.0.0.1:5500/health

# ArcadeDB schema auto-created
docker logs haystack-chatqna | grep "ArcadeDB schema"
# Expected: ✅ ArcadeDB schema initialized

# OpenAI key loaded (not old cached key)
docker exec haystack-chatqna env | grep "OPENAI_API_KEY"
# Verify key is correct (check last 5 chars)


# ═══════════════════════════════
# RAG PIPELINE TESTS
# ═══════════════════════════════

# Basic health question (vector retriever should find docs)
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "What is hypertension?","history":[]}'

docker logs haystack-chatqna --tail 5
# Expected: Real health answer, logs show "Vector Retriever found 10 documents"

# Gambian food + disease context
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "Can I eat domoda if I have diabetes?","history":[]}'

# Expected: Mentions domoda, portion control, groundnut paste

# Structured plan request
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "Give me a one week plan to lower my blood pressure","history":[]}'

# Expected: Organized paragraphs with labels, no ** or ## or bullets

# Multi-turn conversation
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "What medications help?","history":[{"role":"user","content":"I have been diagnosed with hypertension"}, {"role":"assistant","content":"I understand. Let me help you with managing your blood pressure."}]}'

# Expected: References hypertension context from history


# ═══════════════════════════════
# INTENT ROUTING TESTS
# ═══════════════════════════════

# Test 1: Health keyword → assistant (Rule Layer)
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "Is moringa good for blood sugar?","history":[]}'

docker logs haystack-chatqna --tail 3
# Expected log: "Router (Rule): Health keyword detected → Assistant."

# Test 2: Triage — red flag keyword
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "I need an ambulance someone collapsed","history":[]}'

docker logs haystack-chatqna --tail 3
# Expected log: "Router: Red Flag Emergency intent detected."

# Test 3: Triage — urgent symptom + modifier
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "I have severe chest pain and trouble breathing","history":[]}'

docker logs haystack-chatqna --tail 3
# Expected log: "Router: Urgent Symptom Triage intent detected."

# Test 4: Smalltalk
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "Hello how are you?","history":[]}'

docker logs haystack-chatqna --tail 3
# Expected log: "Router: Greeting/smalltalk detected. Bypassing RAG."

# Test 5: Off-topic redirect
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "Who won the FIFA World Cup?","history":[]}'

# Expected: Polite redirect to health topics

# Test 6: FAISS confidence (after retraining with 244 examples)
curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "What are the side effects of metformin?","history":[]}'

docker logs haystack-chatqna --tail 3
# Expected: "Router (FAISS): Matched 'assistant' (Confidence: 0.8+)" or "Router (Rule)"


# ═══════════════════════════════
# VOICE PIPELINE TESTS
# ═══════════════════════════════

# TTS via Haystack proxy
BODY='{"text":"Hello I am Amina your health assistant"}'

curl -X POST "http://127.0.0.1:8000/api/v1/tts" \
     -H "Content-Type: application/json" \
     -d "$BODY" \
     -o test_tts.wav

ls -lh test_tts.wav
# Expected: WAV file > 1KB

# TTS directly on container

curl -X POST "http://127.0.0.1:5500/v1/tts" \
     -H "Content-Type: application/json" \
     -d "$BODY" \
     -o test_direct.wav

ls -lh test_direct.wav
# Expected: WAV file > 1KB

# STT round-trip (generate audio then transcribe it back)
curl -X POST "http://127.0.0.1:8000/api/v1/stt" \
     -F "file=@test_tts.wav"

# Expected: {"transcript": "Hello I am Amina..."}


# ═══════════════════════════════
# MARKDOWN STRIPPING TESTS
# ═══════════════════════════════

# These should all return clean text with no **, ##, -, or * symbols

curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "List ways to prevent heart disease","history":[]}'

# Verify: No ** or ## or - or * or # in the response

curl -X POST http://127.0.0.1:8000/api/v1/text-chat \
    -H 'accept: application/json' \
    -H 'Content-Type: application/json' \
    -d '{"text": "I have severe chest pain","history":[]}'

# Verify: Triage response has no formatting symbols


# ═══════════════════════════════
# FRONTEND TEST
# ═══════════════════════════════

# Start frontend
cd PROYECT_PATH/components/voice-frontend
npm run dev

# Open http://localhost:5173
# Test checklist:
#   [ ] Click a health topic tag → text response appears
#   [ ] Response has no ** ## - * symbols
#   [ ] TTS audio plays (Amina speaks)
#   [ ] Avatar lip sync works during TTS
#   [ ] Press spacebar to record voice → transcription appears → response generated
#   [ ] Type a question in text box → response appears
#   [ ] Open DevTools (F12) Console → no red CORS errors
#   [ ] Health indicator (top left) shows green/connected
```



---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 401 Incorrect API key ending in -C0A | Old key cached in Windows env | Run `rundll32 sysdm.cpl,EditEnvironmentVariables`, delete OPENAI_API_KEY, close all PowerShell, reopen |
| "Chunk type not found" | Schema not created | Now auto-creates on startup. If still fails: `docker exec haystack-chatqna python -c "from src.ingestion.arcadedb_schema import create_schema; create_schema()"` |
| "I don't know" answer | No documents ingested | Run `docker exec haystack-chatqna python -m src.ingestion.run_ingestion` |
| "python-multipart not installed" | Missing dependency | Add `python-multipart>=0.0.9` to requirements.txt, rebuild |
| CORS errors in browser | Missing middleware | Verify main.py has CORSMiddleware |
| Container has old files | Docker layer cache | `docker compose build --no-cache haystack-chatqna` |
| .env has PowerShell code in it | Copy-paste error | Delete .env, recreate with notepad: `notepad .env` |
| Low confidence routing (0.30) | Old FAISS index with 10 examples | Retrain: `docker exec haystack-chatqna python -m src.utils.train_intents` then `docker restart haystack-chatqna` |
| Template error "user_age not found" | Template missing variables | All 3 templates must include `{{ user_age }}` and `{{ user_gender }}` |
| 'str' has no attribute 'resolve_value' | Passing api_key as string to OpenAIChatGenerator | Remove api_key= parameter, let Haystack read from os.environ |

---

## Pending Items

1. FAISS retrain with 244 examples (currently 75 in container)
2. Keyword Retriever returns 0 documents (vector works, keyword does not)
3. Frontend TTS audio playback verification
4. More NCD documents for ingestion (only 1 PDF currently)
5. Conversation history persistence across sessions (ArcadeDB sessions)
6. Multichannel access deployment (Telegram, WhatsApp, Messenger)
