# Voice Agent

A real-time, conversational voice interface for GENIE.AI. Users speak through
their browser, the agent transcribes their speech, generates a response with the
existing LLM, synthesizes it back as audio, and plays it — all over a single
WebSocket through the existing TLS gateway.

The user can interrupt the agent mid-sentence (barge-in). The agent does not
loop on its own voice.

---

## Table of contents

1. [Why WebSocket and not WebRTC](#why-websocket-and-not-webrtc)
2. [Architecture](#architecture)
3. [Models and software](#models-and-software)
4. [Wire protocol](#wire-protocol)
5. [Call flow, step by step](#call-flow-step-by-step)
6. [Echo handling and barge-in](#echo-handling-and-barge-in)
7. [Latency budget](#latency-budget)
8. [Configuration reference](#configuration-reference)
9. [Files and where things live](#files-and-where-things-live)
10. [Operations](#operations)
11. [Known limits and future work](#known-limits-and-future-work)

---

## Why WebSocket and not WebRTC

The first design used **LiveKit + coturn** (the standard real-time voice stack
used by Google Meet, Discord, etc.). It failed on this deployment because:

- WebRTC needs a wide range of UDP ports reachable from the browser to the
  server (typically 50000–50100/UDP).
- The cloud provider (E2E Networks) firewalls those ports at the network
  layer. We don't have admin access to that firewall.
- TURN-over-TCP relays were tried (self-hosted coturn on TCP/7881, public Open
  Relay) but ran into Docker Swarm ingress mesh issues and dead public TURN
  credentials.

So the voice agent was rebuilt on a **single WebSocket** through the existing
nginx gateway on port 443. The pros and cons:

| | WebRTC (LiveKit) | WebSocket (current) |
|---|---|---|
| Ports needed | 7880 + 50000–50100/UDP + TURN | 443 only |
| Latency end-of-speech → first audio | ~1.0 s | ~1.5–2.0 s |
| NAT/firewall compatibility | Hard | Trivial |
| Echo cancellation | Native (LiveKit/Chrome AEC) | Browser AEC + custom barge-in |
| Concurrent calls | High | Acceptable for demo / dozens |

For this deployment the WebSocket path is the right trade-off. The legacy
LiveKit/coturn services have been removed from `docker-compose.yaml`.

---

## Architecture

```
┌──────────────────┐
│     Browser      │   ← Vue 3 component + AudioWorklet + voiceService.js
│ ─ getUserMedia   │
│ ─ AudioWorklet   │
│ ─ Web Audio out  │
└────────┬─────────┘
         │  wss://<host>/voice/v1/voice/stream
         │  (TLS, port 443)
         ▼
┌──────────────────┐
│   nginx (443)    │   ← /voice/* proxied to voice-bridge:9400
│  Connection:     │
│   upgrade        │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────┐
│   voice-bridge (Python / FastAPI)    │
│ ─ Per-WS state: history, VAD, task   │
│ ─ webrtcvad — segments utterances    │
│ ─ Cancellable processing task        │
└────┬───────────┬────────────────┬────┘
     │           │                │
     ▼           ▼                ▼
 ┌────────┐  ┌────────┐    ┌────────────────┐
 │ asr-   │  │ tts-   │    │ vLLM (default) │
 │ whisper│  │ piper  │    │ or chatqna     │
 └────────┘  └────────┘    └────────────────┘
   port 9100   port 9200      port 8000 / 8888
   (faster-    (Piper voice    (Llama-3.1-8B
   whisper)    streaming)       Instruct)
```

Everything except the browser runs in Docker Swarm on a single host. The
browser's only public-internet contact is `wss://<host>/voice/...` — exactly
the same TLS endpoint used for chat / API.

### Service responsibilities

| Service | Role |
|---|---|
| **voice-bridge** | The brain. Owns the WebSocket, runs VAD, orchestrates ASR → LLM → TTS, handles barge-in. |
| **asr-whisper** | Speech-to-text. faster-whisper `large-v3-turbo` on GPU, FP16. Multilingual (FR/EN/ES). |
| **tts-piper** | Text-to-speech. Piper, CPU-only, streams 16-bit PCM. One voice file per language. |
| **vLLM** | LLM inference. Existing service used for chat too. Default for voice = direct call (bypasses chatqna RAG for low latency). |
| **chatqna** | Optional. Fully RAG-grounded LLM responses. Slower (~5 s vs ~1 s) but document-aware. Toggled by env var. |
| **nginx** | TLS termination + `/voice/` WebSocket upgrade proxy to voice-bridge. |
| **backend** | Mints the WebSocket URL on `POST /api/voice/token` (auth-gated). |
| **frontend** | UI: VoiceCallComponent, voiceService, AudioWorklet. Captures mic, plays TTS, runs barge-in detector. |

---

## Models and software

| Layer | Model / library | Why |
|---|---|---|
| **Browser AEC** | Chrome / OS native (`getUserMedia({echoCancellation: true})`) | Free, well-tuned, runs before our code sees the mic. |
| **Voice activity detection** | [`webrtcvad`](https://github.com/wiseman/py-webrtcvad) (aggressiveness 2) | Lightweight, deterministic, no GPU. 20 ms frame granularity. |
| **ASR** | [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) `large-v3-turbo`, FP16 on CUDA | Multilingual (99 languages), ~150 ms latency for 2–5 s utterances on A40-class GPU. Real-time-ready. |
| **LLM** (default for voice) | vLLM serving `meta-llama/Meta-Llama-3.1-8B-Instruct` | Existing infra. SSE streaming. ~50 ms time-to-first-token. |
| **LLM** (optional RAG) | chatqna mega-service | Embedding + retriever + reranker + LLM. ~5 s per turn but grounded in knowledge base. |
| **TTS** | [Piper](https://github.com/rhasspy/piper), per-language voice files (`fr_FR-siwis-medium`, `en_US-amy-medium`, `es_MX-claude-high`) | CPU-fast (~10× real-time), good quality, MIT-licensed voices. |
| **WebSocket transport** | FastAPI / Starlette WebSockets behind Uvicorn | Already in the stack; bumped `ws_ping_timeout` to 120 s for slow turns. |
| **Audio capture** | `AudioWorkletNode` + `AudioContext({sampleRate: 16000})` | Sample-rate-matched at capture, no JS-side resampling. |
| **Audio playback** | `AudioContext` + scheduled `AudioBufferSourceNode`s | Gapless, schedulable, cancellable. |

The same `genie-ai-overlay/` Python conventions apply (copyright headers,
`os.getenv()` with defaults, single-stage Dockerfiles).

---

## Wire protocol

A single WebSocket carries both directions. Mixed text (JSON) and binary
(audio) frames.

### Client → Server

| Frame | Format | When |
|---|---|---|
| `{"type":"start","language":"fr\|en\|es"}` | text JSON | First message after open. |
| binary | PCM 16-bit little-endian, **16 kHz mono**, in 20 ms chunks (640 bytes) | After receiving `ready`. |
| `{"type":"barge_in"}` | text JSON | When user starts speaking while agent is talking. |
| `{"type":"stop"}` | text JSON | Graceful close from UI. |

### Server → Client

| Frame | Format | When |
|---|---|---|
| `{"type":"tts_start","sample_rate":22050}` | text JSON | Before sending a chunk of synthesized audio. |
| binary | PCM 16-bit little-endian at the announced sample rate | Streaming TTS audio for one sentence. |
| `{"type":"tts_end"}` | text JSON | After the last byte of one sentence's audio. |
| `{"type":"ready"}` | text JSON | After greeting playback; mic should now be capturing. |
| `{"type":"user_speaking"}` | text JSON | VAD detected start of an utterance. |
| `{"type":"transcript","text":"..."}` | text JSON | After ASR; the recognized user text. |
| `{"type":"agent_text","text":"..."}` | text JSON | Each sentence of the agent's reply (paired with TTS audio). |
| `{"type":"agent_interrupted"}` | text JSON | Acknowledges a `barge_in`. |
| `{"type":"error","message":"asr_failed\|llm_failed\|tts_failed"}` | text JSON | Any pipeline error. |

The server interleaves text JSON status frames with binary audio frames on the
same WebSocket. Clients distinguish via `event.data instanceof ArrayBuffer`.

---

## Call flow, step by step

### Connect

1. User clicks **Start voice call** in `VoiceCallComponent.vue`.
2. Frontend calls `POST /api/voice/token` (Bearer auth). Backend returns
   `{ wsUrl, language, ... }`.
3. Frontend opens `WebSocket(wsUrl)`. Sends `{type:"start", language}`.
4. Server creates an in-memory session: chat history, VAD instance, processing
   task slot.

### Greeting

5. Server picks the per-language greeting and `SYSTEM_PROMPT`, calls
   `tts-piper`, streams PCM chunks to the client over the same WS.
6. Client decodes each chunk into an `AudioBuffer` and schedules it via
   `AudioBufferSourceNode.start(playbackTime)`. Sources are tracked in
   `_activeSources` so they can be killed on barge-in.
7. Server sends `{type:"ready"}` after the last greeting chunk.

### Mic capture (after `ready`)

8. Frontend calls `getUserMedia({audio: { echoCancellation: true, ... }})` and
   creates an `AudioContext({sampleRate: 16000})`.
9. Frontend loads `voice-worklet.js?v=2` (cache-busted) into the worklet
   thread.
10. Worklet processes 128-sample blocks from the browser. For each 320-sample
    (20 ms) window, it:
    - Clamps each float to ±1.0
    - Tracks `sumSq` for RMS computation
    - Converts to Int16 PCM, fills a 640-byte frame
    - Posts `{ buffer: ArrayBuffer, rms: Number }` to the main thread
      (transferring the buffer)

11. Main thread (`voiceService.js`) receives each message. Two parallel
    decisions:
    - **Send to server?** Yes if not muted AND not currently `agentSpeaking`.
    - **Detect barge-in?** Yes if `agentSpeaking` AND `rms > THRESHOLD`
      (default 0.04) for ≥ 5 consecutive frames (~100 ms). See
      [Echo handling and barge-in](#echo-handling-and-barge-in).

### Server-side VAD

12. voice-bridge accumulates incoming binary frames in a `pending` byte
    buffer, walking it in 640-byte chunks.
13. Each 20 ms frame goes to `webrtcvad.is_speech()` at aggressiveness 2.
14. State machine:
    - 3 consecutive speech frames → emit `{"type":"user_speaking"}`,
      mark `in_speech`, start filling `utterance` buffer.
    - 25 consecutive silence frames (~500 ms) while `in_speech` → end of
      utterance.
    - If `speech_frames < 10` (~200 ms) → discard (probably noise).
15. The complete utterance PCM is wrapped as 16 kHz mono WAV and dispatched
    to `process_utterance(...)` as a **background asyncio task**, so the WS
    receive loop continues servicing barge-in messages.

### ASR

16. voice-bridge POSTs the WAV to `asr-whisper` at
    `/v1/microservice/asr` with the language hint.
17. Server logs `[ASR] done elapsed=0.15s text='...'`. Returns the transcript
    to the WS as `{type:"transcript", text}`.

### LLM

The endpoint is configurable via `LLM_ENDPOINT` (`VOICE_BRIDGE_LLM_ENDPOINT`
in `.env`). Two modes are supported:

- **Direct vLLM (default):** OpenAI-compatible streaming SSE.
  voice-bridge consumes the SSE deltas, pieces them into sentences, and
  fires TTS as soon as a sentence completes — so the user hears the first
  sentence while the LLM is still generating the rest.
- **chatqna RAG:** non-streaming. Returns a single
  `{"response": "..."}`. voice-bridge speaks the whole reply
  sentence-by-sentence in a single pass.

The voice-specific system prompt (`SYSTEM_PROMPTS` in
`genieai_voice_bridge.py`) is tight (~250 tokens) and tells the LLM:
- Reply only in the call's language
- 1–2 sentences max, conversational
- No lists or markdown
- Keep the Genie persona / Gambia health scope
- Red-flag safety rules
- Refer to clinic / community health worker for diagnosis or medication

### TTS

18. For each completed sentence, voice-bridge POSTs to `tts-piper`
    `/v1/microservice/tts` with `{text, language}`.
19. Piper streams raw PCM chunks; voice-bridge forwards them to the WS as
    binary frames, sandwiched between `{type:"tts_start", sample_rate}`
    and `{type:"tts_end"}`.

### Playback

20. Browser receives binary chunk → decodes Int16 PCM into Float32 →
    `AudioBuffer` at the announced sample rate (22050 Hz for Piper) →
    `AudioBufferSourceNode.start(scheduledTime)`. Sources schedule
    contiguously so audio is gapless.

### Idle and next turn

21. After `tts_end`, the frontend schedules a delayed `agentSpeaking = false`
    that fires only after `playbackTime - currentTime + 400 ms` — i.e.,
    after the queued audio has actually finished playing through the
    speakers, plus a small safety buffer.
22. Server starts a `POST_PROCESS_DRAIN_S` (default 1.5 s) window during
    which any incoming audio is dropped. This kills any straggling
    speaker-leak echo that the browser AEC didn't fully suppress.
23. After the drain, the cycle repeats from step 12.

---

## Echo handling and barge-in

The hard problem in any voice agent: when the agent's voice plays through the
user's speakers, the user's microphone re-records it. If the server processes
that as user input, the agent talks to itself in an infinite loop.

We solve it with **four cooperating layers**, each cheap, each redundant:

### Layer 1 — Browser-native acoustic echo cancellation

`getUserMedia({audio: { echoCancellation: true, noiseSuppression: true,
autoGainControl: true }})` activates the browser's AEC stack. On Chromium,
this uses Google's WebRTC AEC3 — the same DSP that powers Google Meet.
The mic stream we work with is **already echo-cancelled** before any of our
code touches it.

This handles the easy cases (laptop mic + speakers, headsets, most BT
audio) almost completely. Doesn't handle: external speakers far from the
mic, or weird routing.

### Layer 2 — Mic mute during agent speech (defensive)

Even with AEC, a small residual of the agent's voice can leak through.
Rather than risk feeding that to ASR, the frontend simply **does not send
mic frames over the WebSocket** while it knows the agent is speaking:

```js
if (this.muted || this.agentSpeaking) return;     // don't send
this.ws.send(buffer);
```

`agentSpeaking` is set to `true` on `tts_start`, and to `false` only after
the queued playback drains plus a 400 ms safety buffer.

### Layer 3 — Post-process drain window (server safety net)

When `process_utterance` finishes, a `drain_until` timestamp is set 1.5 s
into the future. While `now < drain_until`, the server drops all incoming
audio. This catches:

- WebSocket-buffered frames that arrived during processing
- Speaker-tail audio that leaked through Layers 1 + 2

```python
drain_until = asyncio.get_event_loop().time() + POST_PROCESS_DRAIN_S
# in the receive loop:
if is_processing() or now < drain_until:
    pending.clear()
    continue
```

### Layer 4 — Barge-in (active, lets the user interrupt)

Layers 1–3 keep the agent quiet about its own voice. Layer 4 lets the user
**override** the mute and interrupt mid-sentence.

The trick: while the mic-mute prevents the **server** from hearing audio,
the worklet keeps measuring the **local** mic stream's RMS. The browser's
AEC has already removed most of the agent's voice from that stream, so what
remains is overwhelmingly the user's voice if any.

```js
if (this.agentSpeaking) {
  if (rms > BARGE_IN_RMS_THRESHOLD) {           // 0.04 ≈ -28 dBFS
    this._bargeInFrames++;
    if (this._bargeInFrames >= 5) {              // 100 ms sustained
      this._triggerBargeIn();
    }
  } else if (this._bargeInFrames > 0) {
    this._bargeInFrames--;                       // soft decay
  }
}
```

`_triggerBargeIn()`:

1. **Stops every queued/playing AudioBufferSourceNode** in `_activeSources`
   — agent's audio is silenced instantly.
2. **Sends `{"type":"barge_in"}`** to the server over the WS.
3. **Sets `agentSpeaking = false`** locally so mic frames immediately start
   flowing again.

The server's WS receive loop sees the `barge_in` text frame and:

```python
if msg_type == "barge_in":
    if is_processing():
        processing_task.cancel()                 # raise CancelledError
                                                 # at the next await
    pending.clear(); utterance.clear()           # discard half-baked state
    drain_until = ... + 0.2                      # short drain only
    await ws.send_text(json.dumps({"type": "agent_interrupted"}))
```

Because every step in `process_utterance` is `await`ed, `task.cancel()`
unwinds at the next yield — mid-LLM-stream, mid-TTS-call, mid-`speak()`.
The cancellation handler appends the partial reply to chat history with a
`[interrupted]` marker so the LLM has context for the next turn.

### Tuning

The defaults work for a normal-volume laptop in a quiet-ish room:

| Knob | Default | Where | Effect |
|---|---|---|---|
| `BARGE_IN_RMS_THRESHOLD` | `0.04` | `voiceService.js` | Higher = harder to interrupt (use if speaker leak triggers false barge-ins). |
| `BARGE_IN_FRAMES_REQUIRED` | `5` (100 ms) | `voiceService.js` | Higher = ignore short noises, but adds latency. |
| `POST_PROCESS_DRAIN_S` | `1.5` | `genieai_voice_bridge.py` / `VOICE_BRIDGE_DRAIN_S` env | Larger = safer against echo, but you wait longer before mic resumes. |
| `SILENCE_FRAMES` | `25` (500 ms) | env `VOICE_BRIDGE_SILENCE_FRAMES` | How long a pause ends an utterance. |

---

## Latency budget

End-of-speech → first audio out, on an A40 GPU + the project's vLLM
configuration, with the **direct vLLM path** (default for voice):

| Stage | Time | Notes |
|---|---|---|
| VAD silence wait | ~500 ms | Configurable via `SILENCE_FRAMES`. |
| ASR (`faster-whisper large-v3-turbo`) | ~150 ms | For 2–5 s utterances. |
| LLM time-to-first-token (vLLM SSE) | ~50–80 ms | Tiny voice prompt + small history. |
| LLM until first sentence ender | ~400–700 ms | Depends on how fast it generates `.?!`. |
| TTS first chunk (Piper) | ~150–200 ms | Streaming PCM. |
| Browser audio decode + schedule | ~50 ms | |
| **Total** | **~1.3–1.7 s** | |

With **chatqna RAG** instead of direct vLLM (set
`VOICE_BRIDGE_LLM_ENDPOINT=http://chatqna-xeon-backend-server:8888/v1/chatqna`):
add ~5 s to the LLM stage because chatqna runs the full embedding +
retriever + reranker + heavy system prompt before the LLM call, and
doesn't stream.

---

## Configuration reference

All voice variables live in the project root `.env`. Comments in `.env`
**must be on their own lines** — bash treats anything after `=` as part of
the value, including `# inline comments`.

| Variable | Default | What it does |
|---|---|---|
| `VOICE_BRIDGE_WS_URL` | `wss://localhost/voice/v1/voice/stream` | WebSocket URL the backend hands to the frontend. |
| `VOICE_BRIDGE_MAX_TOKENS` | `128` | LLM `max_tokens`. Voice replies are short. |
| `VOICE_BRIDGE_TEMPERATURE` | `0.7` | LLM sampling temperature. |
| `VOICE_BRIDGE_VAD_AGGRESSIVENESS` | `2` | webrtcvad 0–3. Higher = stricter silence detection. |
| `VOICE_BRIDGE_SILENCE_FRAMES` | `25` | Frames of silence (×20 ms) before a turn ends. |
| `VOICE_BRIDGE_DRAIN_S` | `1.5` | Post-reply drain window (echo cleanup). |
| `VOICE_BRIDGE_LLM_ENDPOINT` | (unset → vLLM) | Override to point at chatqna for RAG. |
| `VOICE_SYSTEM_PROMPT_EN` / `_FR` / `_ES` | (unset → built-in) | Single-line override per language. Use literal `\n` for line breaks. |
| `ASR_WHISPER_MODEL` | `large-v3-turbo` | faster-whisper model name. |
| `ASR_WHISPER_DEVICE` | `cuda` | `cuda` or `cpu`. |
| `ASR_WHISPER_COMPUTE_TYPE` | `float16` | `float16` on GPU; `int8` for CPU fallback. |
| `TTS_PIPER_DEFAULT_VOICE_FR` / `_EN` / `_ES` | `fr_FR-siwis-medium`, `en_US-amy-medium`, `es_MX-claude-high` | Voice files under `data/piper-voices/`. |

---

## Files and where things live

### New files

```
genie-ai-overlay/voice-bridge/
  Dockerfile-voicebridge_genie-ai          # Python 3.11 + webrtcvad + httpx + fastapi
  requirements.txt                          # locked deps for voice-bridge
  genieai_voice_bridge.py                   # the WS service (~430 lines)

genie-ai-overlay/asr-whisper/
  Dockerfile-asr_genie-ai                   # CUDA 12.4 + faster-whisper
  requirements.txt
  genieai_asr_microservice.py               # FastAPI: /v1/microservice/asr,
                                            #          /v1/audio/transcriptions

genie-ai-overlay/tts-piper/
  Dockerfile-tts_genie-ai                   # Python slim + piper-tts
  requirements.txt
  genieai_tts_microservice.py               # FastAPI: /v1/microservice/tts,
                                            #          /v1/audio/speech

components/gov-chat-frontend/public/
  voice-worklet.js                          # AudioWorklet: PCM + RMS

components/gov-chat-frontend/src/
  components/VoiceCallComponent.vue         # UI button, language picker
  services/voiceService.js                  # WS lifecycle, mic, barge-in

components/gov-chat-backend/
  routes/voice-routes.js                    # POST /api/voice/token
  services/voice-token-service.js           # returns wsUrl

scripts/
  download-piper-voices.sh                  # fetches Piper voice files

data/piper-voices/                           # voice files (gitignored)
  fr_FR-siwis-medium.onnx, *.onnx.json
  en_US-amy-medium.onnx, *.onnx.json
  es_MX-claude-high.onnx, *.onnx.json
```

### Modified files

```
docker-compose.yaml          # voice-bridge + asr-whisper + tts-piper services
                             # legacy livekit/coturn/voice-agent under
                             # legacy_voice profile (not deployed)
api-gateway-solution/nginx/conf/default.conf.template
                             # /voice/ WebSocket proxy with rewrite
                             # map $http_upgrade $connection_upgrade
components/shared/lib/security-headers.js
                             # microphone=(self) Permissions-Policy
env                          # SECTION 8b: voice-bridge env documentation
components/gov-chat-frontend/src/components/ChatBotComponent.vue
                             # mounts <voice-call-component>
components/gov-chat-frontend/package.json
                             # (no new deps — uses native Web Audio APIs)
components/gov-chat-backend/package.json
                             # joi, express already present; nothing new
components/gov-chat-backend/index.js
                             # registers voice-routes.js and voice-token-service
```

---

## Operations

### First-time setup

```bash
# 1. Copy env template, set the WS URL, install Piper voices
cp env .env
# edit .env — set VOICE_BRIDGE_WS_URL=wss://<your-host>/voice/v1/voice/stream
./scripts/download-piper-voices.sh

# 2. Frontend + backend deps (only needed if developing locally)
cd components/gov-chat-frontend && npm install && cd ../..
cd components/gov-chat-backend  && npm install && cd ../..
```

### Build and deploy

```bash
set -a && source .env && set +a
docker compose -p genieai --profile opea --profile voice build \
  voice-bridge asr-whisper tts-piper backend frontend nginx
docker compose -p genieai --profile opea --profile voice push \
  voice-bridge asr-whisper tts-piper backend frontend nginx
./deploy.sh
```

### Watch a live call

```bash
docker service logs genieai_voice-bridge -f --since 30s | grep -vE 'GET /health'
```

You'll see one trace per turn: `[VAD] utterance complete → [ASR] done →
[LLM] first token → [TTS] start ... [TTS] done → [PROCESS] complete →
[SESSION] processing complete; drain window 1.5s`.

### Switch to RAG-grounded voice

```bash
# add to .env
VOICE_BRIDGE_LLM_ENDPOINT=http://chatqna-xeon-backend-server:8888/v1/chatqna
# redeploy voice-bridge
./deploy.sh
```

The streaming code auto-falls-back to the non-streaming chatqna shape.

### Debug missing audio

If the server logs show no `[MIC]` lines after `[GREETING] done`:

1. Check that the frontend image is up to date (the worklet's wire format
   and `voiceService.js` must match — bump the `?v=` query when changing
   the worklet).
2. In the browser DevTools Network tab, tick **Disable cache** and
   hard-refresh.
3. Confirm `getUserMedia` succeeded (browser DevTools Console will show
   `[voice] mic granted` and `[voice] mic capture started`).

### Tweak the voice prompt without rebuilding

Set `VOICE_SYSTEM_PROMPT_EN`, `VOICE_SYSTEM_PROMPT_FR`, or
`VOICE_SYSTEM_PROMPT_ES` in `.env`. Use literal `\n` for line breaks.
Redeploy voice-bridge:

```bash
docker service update --force --image localhost:5000/genie-ai-voice-bridge:latest \
  genieai_voice-bridge
```

(Or just `./deploy.sh`.)

---

## Known limits and future work

- **External speakers far from the mic**: residual echo can exceed
  the barge-in RMS threshold. Workarounds: raise `BARGE_IN_RMS_THRESHOLD`,
  recommend headphones in the UI, or add server-side AEC (see below).
- **Bluetooth audio**: AEC quality varies by device. Generally OK but not
  guaranteed.
- **No real-time partial transcripts**: ASR runs on completed utterances,
  so the chat UI doesn't show the user's words as they speak. Adding
  whisper-streaming or a streaming ASR backend is a follow-up.
- **No semantic turn detection**: end-of-turn is purely silence-based.
  A model that knows "user is pausing mid-thought" vs "user is done" would
  feel more natural — see LiveKit Agents' `turn-detector` model or similar.
- **Server-side AEC**: production hardening would add `webrtc-audio-processing-py`
  on the server with TTS as the reference signal, removing residual echo
  before VAD. ~+30–60 ms latency, ~+5 % CPU per call. Adds robustness
  for kiosk / shared-laptop deployments.
- **Concurrency**: validated for 2 simultaneous calls on the current GPU.
  Each call holds one Whisper inference slot and one vLLM stream. Scale
  is limited by GPU memory bandwidth, not by voice-bridge itself.
- **Per-user isolation**: every WebSocket gets its own `history`,
  `processing_task`, and VAD state. There's no shared session store.
  Reconnects start fresh — fine for stateless conversations, would need
  a session ID + persistence to resume.
