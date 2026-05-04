# SETUP — AMINA on a fresh machine

This is the comprehensive setup guide. The 30-second version lives in the [root README](../README.md). For a UNICC reviewer running through the demo, see [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker Desktop | 24.x or newer | Linux containers, WSL2 backend on Windows |
| PowerShell | 5.1+ (Windows ships with this) | `start.ps1` works on Windows PowerShell 5.1 and PowerShell 7 |
| Bash | any | `start.sh` for Linux/macOS |
| Node.js | 18.x or 20.x | Only needed for `npm run dev` (frontend dev server) |
| RAM | 16 GB recommended (8 GB minimum) | Containers cap themselves at ~14 GB across the stack |
| Disk | 25 GB free | Whisper + Piper bind-mounted models (~210 MB) + NLLB image (~7.6 GB) + ArcadeDB / Redis volumes |
| GPU | optional | The `haystack-chatqna` service requests an NVIDIA device but falls back to CPU when none is present (see `start.ps1` console output) |

## 2. One-command start

```powershell
# Windows
git clone <repo-url>
cd genie-ai
.\start.ps1
```

```bash
# Linux / macOS
git clone <repo-url>
cd genie-ai
./start.sh
```

Then open `http://localhost:5174`.

`start.ps1` does eight phases:

1. Docker liveness check
2. AI model bootstrap (`scripts/bootstrap_models.ps1`) — Whisper + Piper, ~210 MB total
3. Resolve `haystack-stack/.env` (creates from `.env.defaults` if missing)
4. `docker compose up -d` for all backend services
5. Wait up to 180 s for `:8000/health`
6. Translation v4.2 verify (NLLB sidecar + ArcadeDB schema warm + canary translation)
7. Start the frontend (vite on `:5174`) unless `-SkipFrontend`
8. Print summary

Useful flags:

| Flag | Effect |
|---|---|
| `-Rebuild` | Rebuild the `haystack-chatqna` image without cache before `up -d`. Use after pulling backend changes. |
| `-Stop` | `docker compose down` everything and exit. |
| `-SkipFrontend` | Skip step 7 (useful when you start the frontend yourself with `npm run dev`). |
| `-SkipVerify` | Skip step 6's NLLB probe + canary (faster restarts). |
| `-Baseline` | Run `scripts/translation_baseline.py` after step 6. |

## 3. Demo accounts (no signup needed)

All seeded by `haystack-stack/haystack-chatqna/scripts/seed_literacy_demo_accounts.py`. They are pre-approved (no admin review) and live in `LiteracyProfileVertex` in ArcadeDB.

| Email | Password | Name | Mode |
|---|---|---|---|
| `beginner@demo.aminacare` | `Demo2026` | Ousman Dem | beginner — illiterate, big-tile shell |
| `basic@demo.aminacare` | `Demo2026` | Fatou Ceesay | basic — upper-basic, simplified chrome |
| `advanced@demo.aminacare` | `Demo2026` | Lamin Jallow | advanced — full UI |

If they're missing on a fresh stack:

```bash
docker exec haystack-chatqna python scripts/seed_literacy_demo_accounts.py \
    --api http://localhost:8000 --arcade http://arcadedb:2480
```

## 4. Environment variables

`haystack-stack/.env.defaults` is the source of truth for the demo profile. Every value listed below has a working default in that file; copy `.env.example → .env` and override only what you need.

| Group | Variable | Demo default | Purpose |
|---|---|---|---|
| API | `API_HOST` | `0.0.0.0` | Backend bind host |
| API | `API_PORT` | `8000` | Backend port |
| API | `DATAPREP_PORT` | `8001` | Document ingestion worker |
| LLM | `OPENAI_API_KEY` | `demo-mode-no-key-needed` | Real key needed for full clinical responses |
| LLM | `OPENAI_MODEL` | `gpt-4o-mini` | Default chat model |
| LLM | `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for self-hosted vLLM |
| LLM | `GOOGLE_API_KEY` | `demo-mode-no-key-needed` | Optional fallback (Gemini) |
| LLM | `LLM_MODEL_NAME` | (empty) | Optional override |
| LLM | `USE_FINETUNED_MODEL` | `false` | Switch to AMINA-LoRA when serving |
| ArcadeDB | `ARCADEDB_URL` | `http://arcadedb:2480` | KG + vector store |
| ArcadeDB | `ARCADEDB_DB` | `genie` | Database name |
| ArcadeDB | `ARCADEDB_USER` | `root` | Demo only |
| ArcadeDB | `ARCADEDB_PASSWORD` | `amina_demo_2026` | Demo only — change in prod |
| ArcadeDB | `ARCADEDB_ROOT_PASSWORD` | `amina_demo_2026` | Demo only — change in prod |
| Redis | `REDIS_HOST` / `REDIS_PORT` | `redis` / `6379` | Working memory + cooldown state |
| Embedding | `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Local |
| Voice | `WHISPER_URL` | `http://voice-stt:8080` | STT inside the network |
| Voice | `TTS_URL` | `http://voice-tts:5500` | English Piper TTS |
| Voice | `MMS_TTS_URL` / `TTS_MNK_URL` | `http://voice-tts-mnk:5500` | Mandinka MMS TTS |
| Translation | `AMINA_TRANSLATION_V4_ENABLED` | `true` | v4.2 NLLB + back-translation |
| Translation | `NLLB_API_URL` | `http://nllb-translate:7860` | Sidecar |
| Translation | `NLLB_ENABLED` | `true` | Toggles NLLB engine |
| Translation | `NLLB_TIMEOUT_MS` | `10000` | Per-call timeout |
| Translation | `BAMBARA_ADAPTER_ENABLED` | `true` | Phrasebook fast-path |
| Translation | `V4_BACK_TRANSLATION_PREFER_NLLB` | `true` | Use NLLB for the round-trip QA |
| Translation | `V4_TELEMETRY_ARCADEDB` | `true` | Persist quality metrics |
| Auth | `AMINA_ENV` | `development` | `production` refuses to boot with demo defaults |
| Auth | `JWT_SECRET` | `amina-demo-jwt-secret-not-for-production` | Override in prod |
| Auth | `JWT_EXPIRY_HOURS` | `168` | Frontend session lifetime |
| Auth | `OTP_DEV_MODE` | `true` | Bypass real SMS in demo |
| Admin | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `amina2026` | Admin console |
| Agent | `AMINA_AGENTIC_MODE` | `assist` | `assist` / `enforce` |
| Agent | `AMINA_AGENTIC_FAIL_OPEN` | `true` | Continue on guard-rail timeout |
| Privacy | `AMINA_CAREGIVER_PRIVACY_REQUIRED` | `false` | Demo skips consent stepper |
| Channels | `TELEGRAM_BOT_TOKEN`, `META_*`, `TWILIO_*` | `disabled` | Multichannel off in demo |
| DHIS2 | `DHIS2_*` | `disabled` | Off in demo |
| Demo | `DEMO_MODE` | `true` | Branch demo-safe code paths |
| Abuse defense | `AMINA_ABUSE_DEFENSE_ENABLED` | `true` | Master toggle |
| Abuse defense | `AMINA_ABUSE_DEFENSE_MODE` | `off` (default) / `enforce` (in `.env`) | `off` ⁄ `shadow` ⁄ `warn` ⁄ `enforce` |
| Abuse defense | `AMINA_ABUSE_COOLDOWN_FIRST` | `1800` (30 min) | First cool-down |
| Abuse defense | `AMINA_ABUSE_COOLDOWN_SECOND` | `86400` (24 h) | Second cool-down |
| Abuse defense | `AMINA_ABUSE_COOLDOWN_THIRD` | `604800` (7 days) | Third cool-down |
| Abuse defense | `AMINA_ABUSE_ADMIN_FLAG_THRESHOLD` | `3` | Auto-flag at N lifetime terminations |
| Gateway | `AMINA_GATEWAY_ENABLED` | `true` | API gateway perimeter |
| Gateway | `AMINA_GATEWAY_JAILBREAK_ENABLED` | `true` | 20-pattern jailbreak filter |
| Gateway | `AMINA_GATEWAY_JWT_ENABLED` | `true` | JWT signing + scope check |
| Gateway | `AMINA_GATEWAY_RATE_LIMIT_ENABLED` | `false` | Off for demo to avoid 429s |

## 5. Verifying it all came up

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

You should see 11 services:

```
haystack-chatqna           Up (healthy)
amina-gateway              Up (healthy)
amina-redis                Up (healthy)
arcadedb                   Up (healthy)
voice-stt                  Up (healthy)
voice-tts                  Up (healthy)
voice-tts-mnk              Up (healthy)
nllb-translate             Up (unhealthy)   ← see scenario 4
dataprep-worker            Up (healthy)
amina-superset             Up (healthy)
telegram-webhook-watcher   Up
```

Quick health probes:

```bash
curl http://localhost:8000/health                            # backend
curl http://localhost:8443/health                            # gateway
curl http://localhost:8443/api/v1/public/security/status     # security layers
curl http://localhost:2480/api/v1/ready                      # arcadedb
```

Run the safety eval suites:

```bash
# 105/105 abuse-defense cases (Phase A–G + scenarios)
docker exec haystack-chatqna python -m src.abuse_defense.eval.run_all

# 65/65 jailbreak-detector cases
docker exec amina-gateway python -m tests.test_jailbreak_detector
```

## 6. Troubleshooting — the ten scenarios that bite

### 6.1 "Docker is not running"

`start.ps1` exits at step 1 with this message. Open Docker Desktop, wait ~30 seconds for the whale icon to stop animating, then:

```powershell
.\start.ps1
```

### 6.2 Port already in use (8000 or 5174)

```powershell
# Find the offender
netstat -ano | findstr ":8000"
netstat -ano | findstr ":5174"

# Kill it (replace <PID> with the number from the last column)
taskkill /PID <PID> /F
```

Linux/macOS:

```bash
lsof -i :8000
kill -9 <PID>
```

### 6.3 PowerShell execution policy blocks `start.ps1`

Symptom: `start.ps1 cannot be loaded because running scripts is disabled on this system.`

```powershell
# Per-user, no admin needed:
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# Or unblock just this script:
Unblock-File .\start.ps1
```

### 6.4 NLLB shows `(unhealthy)` — known false positive

`docker-compose.nllb.yml` defines a healthcheck that probes both `/api/v4/health` and `/health`. The upstream image `ghcr.io/winstxnhdw/nllb-api:main` returns 404 on both for several minutes after boot while the model loads, so Docker marks it unhealthy. Translation actually works — the canary in `start.ps1` step 6 verifies the real endpoint contract:

```bash
curl "http://localhost:7860/api/v4/translator?text=hello&source=eng_Latn&target=bam_Latn"
```

If this returns a JSON body with `text`, NLLB is fine regardless of what `docker ps` says.

### 6.5 Frontend shows 502/503

The backend is still warming up. `start.ps1` step 5 waits up to 180 seconds; on first run with a cold image cache, the actual model load can be longer. Check:

```bash
docker logs --tail 60 -f haystack-chatqna
```

When you see `Application startup complete.` the API is ready. Refresh the browser.

### 6.6 `could not select device driver "nvidia"`

The base `docker-compose.yml` reserves an NVIDIA GPU for `haystack-chatqna`. On a CPU-only host this surfaces as the message above. `start.ps1` does **not** auto-strip the GPU reservation today; the workaround is one of:

```powershell
# A. Quickest: add a one-line override
@"
services:
  haystack-chatqna:
    deploy:
      resources:
        reservations:
          devices: []
"@ | Out-File -Encoding utf8 haystack-stack/docker-compose.cpu.yml

# Then add `-f docker-compose.cpu.yml` to the start.ps1 compose file list,
# or run it manually:
cd haystack-stack
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d
```

Voice (Whisper, Piper, MMS) and NLLB are CPU-only by default, so they are unaffected.

### 6.7 First startup >10 minutes

Normal on a cold cache. The slowest item is the NLLB image (`ghcr.io/winstxnhdw/nllb-api:main`, ~7.6 GB). Pre-pull the night before:

```bash
docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate
```

Whisper + Piper download once via `scripts/bootstrap_models.ps1` (~210 MB; see `scripts/bootstrap_models.ps1` for exact sizes — Whisper base.en 148 MB, Piper Lessac 63 MB, Piper config 5 KB).

### 6.8 STT or TTS not working

Most often: missing Whisper/Piper bind-mount files. Re-run the bootstrap with `-Force`:

```powershell
.\scripts\bootstrap_models.ps1 -Force
docker restart voice-stt voice-tts
```

The expected mount paths (see `haystack-stack/docker-compose.yml`):

| Container | Host path | Container path |
|---|---|---|
| `voice-stt` | `components/voice-gateway/infra/whispercpp/models/` | `/models:ro` |
| `voice-tts` | `components/voice-gateway/infra/piper/models/` | `/models/piper:ro` |
| `voice-tts-mnk` | `haystack-stack/data/huggingface-cache/` | `/root/.cache/huggingface:rw` |

Mandinka TTS (`voice-tts-mnk`) uses a HuggingFace cache, not a bind-mounted weight file — first synth pulls `facebook/mms-tts-mnk` into that cache directory.

### 6.9 ArcadeDB connection refused

```bash
docker logs arcadedb --tail 20
```

Most common cause is a stale lock file in `haystack-stack/data/arcadedb/` after a hard kill. `docker compose down && docker compose up -d` is normally enough; if not, delete `haystack-stack/data/arcadedb/genie/database.lck` (only when the container is stopped).

### 6.10 `npm install` fails for the frontend

```powershell
cd components/frontend
Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
npm run dev
```

The frontend uses Vite with `strictPort: true` on **5174**, so changing the port requires editing `components/frontend/vite.config.js` — Vite will not auto-pick a free port.

## 7. Resetting state between runs

| Goal | Command |
|---|---|
| Clear all abuse-defense state for one user (full reset) | `python clear_abuse_warnings.py <patient_id_or_session_id>` |
| Clear cool-down clock only (soft release) | `python clear_abuse_warnings.py <id> --soft` |
| Inspect abuse-defense state without changing it | `python clear_abuse_warnings.py <id> --snapshot` |
| Show abuse-defense module config | `python clear_abuse_warnings.py --status` |
| List admin-flagged users (lifetime threshold reached) | `python clear_abuse_warnings.py --list-flagged` |
| Tail the abuse-defense audit log | `python tail_abuse_logs.py` |
| Stop and remove all containers | `.\start.ps1 -Stop` |
| Wipe ArcadeDB / Redis volumes | stop, then delete `haystack-stack/data/arcadedb/` and `haystack-stack/data/redis/` |
| Force re-download voice models | `.\scripts\bootstrap_models.ps1 -Force` |

## 8. Production deployment is out of scope here

This document covers a working evaluator install on a developer machine. For UNICC production deployment see [docs/AMINA_OPS_MANUAL.md](AMINA_OPS_MANUAL.md), [docs/compliance/SECRET_ROTATION_CADENCE.md](compliance/SECRET_ROTATION_CADENCE.md), and [docs/compliance/INCIDENT_RESPONSE_PLAN.md](compliance/INCIDENT_RESPONSE_PLAN.md).
