# AMINA — UNICC Evaluator Quick Start

## Prerequisites
- Docker Desktop (running)
- Git
- Internet connection (first run downloads ~8 GB of AI models)

## Start (3 commands)

```powershell
git clone <repo-url>
cd genie-ai
.\start.ps1                 # Linux / macOS:  ./start.sh
```

## What happens

| Step | Action                                     | Time (first run) | Time (cached) |
|-----:|--------------------------------------------|------------------|---------------|
| 1    | Docker check                               | ~5 s             | ~5 s          |
| 2    | Voice model download (Whisper + Piper)     | ~45 s            | <1 s          |
| 3    | Backend services start                     | 1–2 min          | <30 s         |
| 4    | Backend health check                       | ~30 s            | ~30 s         |
| 5    | NLLB Docker image pull (~7.6 GB)           | 5–10 min         | 0 s           |
| 6    | NLLB model load + canary translation       | ~2 min           | ~2 min        |
| 7    | Frontend start                             | ~15 s            | ~15 s         |
| **Total** | **First run: 8–14 min · Subsequent runs: ~2 min** |

## When it says "AMINA is ready"

Open: **http://localhost:5174**

## Test it

- Type: *"I have diabetes. What should I eat?"*
- Try Mandinka: type *"N kuŋ dimi"* (I have a headache)
- Try voice: click the microphone icon
- Caregiver signup: <http://localhost:5174/#/caregiver/signup>

## Stop everything

```powershell
.\start.ps1 -Stop           # Linux / macOS:  ./start.sh --stop
```

## Avoid the NLLB wait at demo time

The 7.6 GB NLLB image is the slow part of the first run. Pre-pull
the night before and the start script auto-detects the cached image:

```powershell
docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate
```

After pre-pulling, `start.ps1` reports `NLLB image cached` and waits
at most 3 minutes instead of 15.

## Troubleshooting

| Problem                                     | Fix                                                                                              |
|---------------------------------------------|--------------------------------------------------------------------------------------------------|
| `Docker is not running`                     | Start Docker Desktop, wait for it to fully load, retry `start.ps1`.                              |
| Stuck on `Waiting for backend to report healthy` | First run is slow. Wait up to 3 minutes. Tail logs: `docker logs --tail 60 -f haystack-chatqna`. |
| Stuck on `Probing NLLB sidecar`             | First run pulls 7.6 GB; allow 5–10 minutes. Progress: `docker logs nllb-translate --tail 20`.    |
| `Port already in use`                       | Stop other services on ports 8000, 5174, 7860. Or run `start.ps1 -Stop` first.                   |
| Frontend shows 502 / 503                    | Backend still warming up. Wait 30 s, refresh.                                                    |
| Summary shows `NLLB: not ready`             | Translation falls back to phrasebank + LLM (lower quality but functional). Or pre-pull NLLB.     |
| `Canary: skipped/failed`                    | v4 pipeline canary did not run. Check `docker logs --tail 60 haystack-chatqna` for the cause.    |

## Need help?

- Backend logs:        `docker logs --tail 60 -f haystack-chatqna`
- NLLB sidecar logs:   `docker logs --tail 60 -f nllb-translate`
- ArcadeDB UI:         <http://localhost:2480>
- Health endpoint:     <http://localhost:8000/health>
