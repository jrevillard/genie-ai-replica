# tts-mms-service · Mandinka Text-to-Speech

Standalone FastAPI container that wraps Meta's **MMS-TTS** (`facebook/mms-tts-mnk`) —
the only production-ready text-to-speech model that covers Mandinka.

Designed as a **drop-in sibling** to `tts-service/` (Piper / English). Both expose
the exact same HTTP contract so the chatqna client can swap between them by
language without knowing anything about the backing engine.

## API

| Method | Path          | Body                        | Response      |
|--------|---------------|-----------------------------|---------------|
| GET    | `/health`     | —                           | JSON          |
| POST   | `/v1/tts`     | `{ "text": "…" }`           | `audio/wav`   |
| POST   | `/v1/tts/ogg` | `{ "text": "…" }`           | `audio/ogg`   |

### Example

```bash
curl -s -X POST http://localhost:5501/v1/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Salaamu aleekum, i be nyaadi?"}' \
  --output out.wav

curl -s http://localhost:5501/health | jq
# {
#   "status": "ok",
#   "service": "tts-mms",
#   "model": "facebook/mms-tts-mnk",
#   "language": "mandinka",
#   "sample_rate": 16000,
#   "device": "cpu",
#   "max_chars": 2000
# }
```

## Environment

| Variable          | Default                  | Description                       |
|-------------------|--------------------------|-----------------------------------|
| `MMS_MODEL_ID`    | `facebook/mms-tts-mnk`   | HuggingFace repo id               |
| `MMS_DEVICE`      | `cpu`                    | `cpu` or `cuda`                   |
| `MMS_LANG_LABEL`  | `mandinka`               | Reported in `/health`             |
| `MMS_MAX_CHARS`   | `2000`                   | Input-length guard (returns 413)  |

## Running

### Via the main stack (recommended)

The service is already wired into the top-level `docker-compose.yml` at
`haystack-stack/`. Bring the whole stack up with:

```bash
docker compose up -d
```

The chatqna service reads `MMS_TTS_URL=http://voice-tts-mnk:5500` and routes
any Mandinka-lang TTS call through this container automatically via
`src/services/tts.py`.

### Standalone (for dev / QA)

```bash
cd haystack-stack/tts-mms-service
docker build -t amina-tts-mms .
docker run -p 5501:5500 amina-tts-mms
```

## Integration (chatqna-side)

```python
from src.services.tts import synthesize, synthesize_ogg

# English (routes to Piper / voice-tts)
wav = await synthesize("Please take your blood pressure reading.", lang="en")

# Mandinka (routes to MMS / voice-tts-mnk)
wav = await synthesize("Durŋo ma i bu nyaafaa.",                   lang="ma")

# IVR / voice-note variants
ogg = await synthesize_ogg("Safoalo Aminata.",                     lang="ma")
```

Language aliases accepted: `en`, `eng`, `english`, `en_US`, … / `ma`, `mnk`,
`mandinka`. Anything else falls back to English + logs a warning. Unknown
inputs never raise; callers should treat `None` return as "continue without
audio".

## Licensing note

MMS-TTS weights are published under **CC-BY-NC 4.0** (non-commercial). Usage
for a Ministry of Health public-health deployment generally qualifies, but
**get legal sign-off in writing** before production rollout.

## Performance

| Host         | Cold start  | Per sentence |
|--------------|-------------|--------------|
| CPU (x86-64) | ~5 s        | 500 ms – 1 s |
| GPU (any)    | ~3 s        | 100 – 200 ms |

Model weights are baked into the image at build time (the `PREWARM=1` arg).
If you need a smaller image, rebuild with `--build-arg PREWARM=0` — first
request will then pay a ~10 s download hit the first time.

## License

Code: same as the parent AMINA project.
Model (`facebook/mms-tts-mnk`): **CC-BY-NC 4.0**, Meta AI.
