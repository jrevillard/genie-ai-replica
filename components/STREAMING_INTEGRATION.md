# Streaming TTS Integration Guide for Amina

## Architecture Change

```
BEFORE (blocking):
  User speaks → STT (2s) → LLM waits full response (3-8s) → TTS waits full audio (2-4s) → Play
  Total latency: 7-14 seconds before user hears anything

AFTER (streaming):
  User speaks → STT (2s) → LLM streams tokens → first sentence ready (0.5-2s) → TTS first sentence (0.5s) → PLAY
  │                          ├─ text appears live in bubble ─────────────────────────────────────────────────────→
  │                          ├─ sentence 1 audio plays ──→ sentence 2 audio plays ──→ sentence 3... ──→
  Total time-to-first-audio: 3-5 seconds (vs 7-14 before)
```

## Files to Add

| File | Location | Purpose |
|------|----------|---------|
| `voice_streaming.py` | `components/voice-gateway/app/api/` | Backend SSE endpoint |
| `useStreamChat.js` | `components/voice-frontend/src/` | Frontend streaming hook |

## Backend Integration

### Step 1: Add `voice_streaming.py` to your gateway

Copy `voice_streaming.py` to `components/voice-gateway/app/api/`

### Step 2: Install httpx (if not already installed)

```bash
pip install httpx
```

Or add to your `requirements.txt`:
```
httpx>=0.25.0
```

### Step 3: Register the router in your main app

In your main FastAPI app file (e.g., `app/main.py` or wherever `app = FastAPI()` is):

```python
from app.api.voice_streaming import router as stream_router

app.include_router(stream_router)
```

### Step 4: Configure environment variables

Add to your `.env`:
```env
# LLM (OpenAI-compatible streaming API)
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=your-groq-api-key
LLM_MODEL=llama-3.3-70b-versatile

# TTS (points to your own /v1/tts endpoint)
TTS_INTERNAL_URL=http://127.0.0.1:8010/v1/tts
```

### Step 5: Add CORS for SSE (if not already configured)

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Frontend Integration

### Step 1: Copy `useStreamChat.js` to `src/`

### Step 2: Edit `App.jsx`

#### Add import:
```jsx
import { useStreamChat } from "./useStreamChat";
```

#### Add the hook inside the App component (after state declarations):
```jsx
const { streamChat, stopStream, isStreaming, streamText } = useStreamChat({
  base,
  onSpeakStart: (an) => { setAvSpk(true); setTtsAn(an); },
  onSpeakEnd: () => { setAvSpk(false); setTtsAn(null); },
});
```

#### Replace the `textChat` function:
```jsx
async function textChat(t, h) {
  setProc(true); setErr(""); setEmo("think");
  try {
    const answer = await streamChat(t, h);
    if (answer) {
      setMsgs(p => [...p, {
        role: "assistant",
        content: answer,
        time: timeNow(),
        isNew: true
      }]);
    }
    setEmo("smile"); setSt("idle");
  } catch (e) {
    // Fallback to non-streaming endpoint
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}/v1/text-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, history: h }),
      });
      const d = JSON.parse(await r.text());
      if (d.answer) {
        setMsgs(p => [...p, {
          role: "assistant",
          content: d.answer,
          time: timeNow(),
          isNew: true
        }]);
      }
      setSt("idle");
    } catch {
      setSt("error"); setErr("Network error.");
    }
    setEmo("smile");
  }
  setProc(false);
}
```

#### Simplify `voChat` to reuse streaming textChat:
```jsx
async function voChat(b, m) {
  setProc(true); setErr(""); setLive(""); setEmo("think");
  let e = "bin";
  if ((m || "").includes("webm")) e = "webm";
  else if ((m || "").includes("ogg")) e = "ogg";
  const f = new FormData();
  f.append("file", b, `mic.${e}`);
  
  try {
    // Step 1: STT only
    const r = await fetch(`${base.replace(/\/+$/, "")}/v1/stt`, {
      method: "POST", body: f
    });
    if (!r.ok) throw new Error("STT failed");
    const d = await r.json();
    const transcript = d.transcript || d.text || "";
    
    if (transcript) {
      setLive(transcript);
      setMsgs(p => [...p, { role: "user", content: transcript, time: timeNow() }]);
      // Step 2: Stream LLM + TTS (reuses the streaming textChat!)
      await textChat(transcript, bH());
    } else {
      setSt("idle"); setLive("");
    }
  } catch {
    setSt("error"); setErr("Network error."); setEmo("smile");
  }
  setProc(false);
}
```

#### Add streaming text bubble (in the chat JSX, before `{proc&&<Typing/>}`):
```jsx
{isStreaming && streamText && (
  <div className="msg-a" style={{display:"flex"}}>
    <div className="ab">A</div>
    <div style={{maxWidth:"80%"}}>
      <div className="ba">{streamText}<span className="cr">|</span></div>
    </div>
  </div>
)}
```

#### Update the `has` condition to include streaming:
```jsx
const has = msgs.length > 0 || rec || proc || isStreaming;
```

#### Add stopStream to cleanup:
```jsx
function clr() {
  stopStream();  // ← add this
  setMsgs([]); setLive(""); setErr(""); setSt("idle"); setEmo("smile");
}
```

## Testing

1. Start Docker Desktop
2. Rebuild gateway: `docker compose -f docker-compose.voice.yml up --build -d`
3. Test the endpoint directly:
   ```bash
   curl -N -X POST http://127.0.0.1:8010/v1/stream-chat \
     -H "Content-Type: application/json" \
     -d '{"text":"What is diabetes?","history":[]}'
   ```
   You should see SSE events streaming in real-time.

4. Start frontend: `npm run dev`
5. Click a topic tag or speak — you should see:
   - Text appearing word by word in the chat bubble
   - Audio starting to play after the first sentence finishes (not the whole response)
   - Avatar lip-syncing with each audio chunk

## How It Works (Technical Detail)

```
Frontend                          Backend (/v1/stream-chat)
   │                                   │
   ├──POST {text, history}────────────→│
   │                                   ├── LLM stream starts
   │←──event:token {t:"Dia"}───────────┤   token: "Dia"
   │←──event:token {t:"betes"}─────────┤   token: "betes"
   │←──event:token {t:" is"}───────────┤   token: " is"
   │   ... tokens display live ...     │   ... buffer: "Diabetes is a..."
   │                                   │   
   │                                   │   [sentence complete: "Diabetes is a chronic condition."]
   │                                   ├── TTS("Diabetes is a chronic condition.") 
   │←──event:sentence {text,audio}─────┤   → returns audio bytes
   │   │                               │
   │   ├─ enqueue audio chunk 1        │   ... continues streaming tokens ...
   │   ├─ start playing chunk 1 ♪      │
   │   │  (avatar lip-syncs)           │
   │←──event:token {t:"It"}───────────┤
   │   ... more tokens ...             │   [sentence 2 complete]
   │←──event:sentence {text,audio}─────┤
   │   ├─ enqueue audio chunk 2        │
   │   │  (plays after chunk 1 ends)   │
   │←──event:done {full:"..."}─────────┤   LLM finished
   │   │                               │
   │   ├─ add full message to msgs     │
   │   ├─ audio queue continues ♪♪     │
   │   ├─ last chunk ends → onSpeakEnd │
```
