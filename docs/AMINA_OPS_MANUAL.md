# AMINA Operational Manual

**Purpose:** Single-document reference for starting, checking, and tailing
every AMINA service. Copy/paste-ready commands. No "go look in another doc"
detours.

**Audience:** Whoever is on call right now.

**Working directory** for everything below: `e:\GenAI\amina\genie-ai-replica\`
unless stated otherwise.

---

## Table of contents

1. [Service inventory at a glance](#1-service-inventory-at-a-glance)
2. [The one-line bootstrap](#2-the-one-line-bootstrap)
3. [Startup — full sequence (cold start)](#3-startup--full-sequence-cold-start)
4. [Startup — individual services](#4-startup--individual-services)
5. [Frontend dev server](#5-frontend-dev-server)
6. [Health-check probes (one-liners)](#6-health-check-probes-one-liners)
7. [Log commands (per service)](#7-log-commands-per-service)
8. [Filtered / streaming log recipes](#8-filtered--streaming-log-recipes)
9. [Channel ops (Telegram / Messenger / Twilio)](#9-channel-ops-telegram--messenger--twilio)
10. [Tunnels (Cloudflare quick + named)](#10-tunnels-cloudflare-quick--named)
11. [Database ops (ArcadeDB + Redis)](#11-database-ops-arcadedb--redis)
12. [Recreate / restart / stop](#12-recreate--restart--stop)
13. [Test suites](#13-test-suites)
14. [Troubleshooting one-pagers](#14-troubleshooting-one-pagers)
15. [Cheat sheet (top 20 commands)](#15-cheat-sheet-top-20-commands)

---

## 1. Service inventory at a glance

| Service                 | Container name              | Port (host)        | Role                                               | Compose file |
|---|---|---|---|---|
| Haystack backend        | `haystack-chatqna`          | **8000**           | AminaAgent + Meta routes + Twilio routes + Evidence + Agent Platform | `haystack-stack/docker-compose.yml` + `override.yml` |
| Multichannel sidecar    | `multichannel-access`       | **8020**           | Telegram bot → forwards to Haystack                | `components/multichannel-access/docker-compose.yml` |
| Whisper STT             | `voice-stt`                 | **8087** → 8080    | Speech-to-text (whisper.cpp small.en)              | `haystack-stack/docker-compose.yml` |
| Piper TTS (English)     | `voice-tts`                 | **5500**           | Text-to-speech                                     | `haystack-stack/docker-compose.yml` |
| MMS TTS (Mandinka)      | `voice-tts-mnk`             | **5501** → 5500    | Mandinka text-to-speech                            | `haystack-stack/docker-compose.yml` |
| ArcadeDB                | `arcadedb`                  | **2480** (Studio), **2424** (binary), **5433** (Postgres wire) | Graph + document DB | `haystack-stack/docker-compose.yml` |
| Redis (Haystack)        | `amina-redis`               | 6379 (internal)    | Sessions, rate limit, Evidence state, eval progress | `haystack-stack/docker-compose.yml` |
| Redis (multichannel)    | `multichannel-redis`        | **6379**           | Telegram session state                             | `components/multichannel-access/docker-compose.yml` |
| Dataprep worker         | `dataprep-worker`           | **8001**           | PDF / docling ingestion for RAG                    | `haystack-stack/docker-compose.yml` |
| Cloudflared (Telegram)  | `amina-cf-quick-tunnel`     | (egress only)      | Public HTTPS for Telegram webhook                  | `components/multichannel-access/docker-compose.quick-tunnel.yml` |
| Cloudflared (named)     | `amina-cloudflared`         | (egress only)      | Persistent named tunnel (alt)                      | `components/multichannel-access/docker-compose.cloudflare-tunnel.yml` |
| Webhook auto-registrar  | `telegram-webhook-watcher`  | (no port)          | Updates Telegram webhook when quick tunnel rotates | `components/multichannel-access/docker-compose.quick-tunnel-watcher.yml` |
| Frontend (Vite)         | (host process, not docker)  | **5173**           | React dev server (admin + chat UI)                 | `components/frontend/package.json` |
| Cloudflared (Haystack/Meta tunnel) | host process     | (egress only)      | Public HTTPS for `:8000` (Messenger + Twilio)      | started by `amina_mvp_channels.ps1` |

**Internal-only services** (no host port — accessed via the docker
network from peers): Redis containers, the Telegram sidecar's redis,
the cloudflared egress sidecars.

---

## 2. The one-line bootstrap

If you only remember one command:

```powershell
.\scripts\amina_mvp_channels.ps1 -Action up -Channels all -Tunnel quick -RegisterTelegramWebhook -PrintManualSmoke
```

This brings up Haystack + multichannel-access + both quick tunnels +
auto-registers the Telegram webhook + prints all callback URLs + prints
the smoke checklist. See [§9](#9-channel-ops-telegram--messenger--twilio)
for what to paste into Meta and Twilio dashboards.

For everything else, read on.

---

## 3. Startup — full sequence (cold start)

For a clean restart of the entire stack on a fresh laptop boot.

### 3.1 The Haystack stack (Meta + Twilio routes + agent + evidence)

```powershell
docker compose `
  -f haystack-stack\docker-compose.yml `
  -f haystack-stack\docker-compose.override.yml `
  -f haystack-stack\docker-compose.meta-channels.yml `
  up -d
```

This brings up: `haystack-chatqna`, `voice-stt`, `voice-tts`,
`voice-tts-mnk`, `arcadedb`, `amina-redis`, `dataprep-worker` (and
`superset` if your install includes the analytics layer).

Wait for boot:
```powershell
docker logs haystack-chatqna 2>&1 | Select-String "Application startup complete" | Select-Object -Last 1
```

### 3.2 The multichannel sidecar (Telegram)

```powershell
docker compose `
  -f components\multichannel-access\docker-compose.yml `
  -f components\multichannel-access\docker-compose.quick-tunnel.yml `
  -f components\multichannel-access\docker-compose.quick-tunnel-watcher.yml `
  up -d
```

Brings up `multichannel-access`, `multichannel-redis`,
`amina-cf-quick-tunnel`, and `telegram-webhook-watcher` (which
auto-registers the rotating quick-tunnel URL with Telegram).

### 3.3 The Haystack public tunnel (for Meta + Twilio webhooks)

```powershell
.\scripts\amina_mvp_channels.ps1 -Action up -Channels meta -Tunnel quick
```

This starts a host-side `cloudflared tunnel --url http://localhost:8000`
and prints the public URL to paste into Meta + Twilio dashboards.

### 3.4 The frontend (Vite dev server)

```powershell
cd components\frontend
npm install        # only first time / after deps change
npm run dev
```

Vite serves the admin + chat UI at **http://localhost:5173** (or whatever
Vite reports — it picks an available port).

### 3.5 Verify everything came up

```powershell
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels all -PrintManualSmoke
```

Expect `MVP_READY` (exit 0). Anything else → see
[§14 troubleshooting](#14-troubleshooting-one-pagers).

---

## 4. Startup — individual services

When something specific dies and you need to bring just that back.

### 4.1 Haystack backend only

```powershell
docker compose `
  -f haystack-stack\docker-compose.yml `
  -f haystack-stack\docker-compose.override.yml `
  -f haystack-stack\docker-compose.meta-channels.yml `
  up -d --no-deps haystack-chatqna
```

Add `--force-recreate` if you changed env vars or bind mounts.

### 4.2 Multichannel sidecar only

```powershell
docker compose -f components\multichannel-access\docker-compose.yml up -d --no-deps multichannel-access
```

### 4.3 ArcadeDB

```powershell
docker compose -f haystack-stack\docker-compose.yml up -d arcadedb
```

### 4.4 Voice services (STT / TTS)

```powershell
docker compose -f haystack-stack\docker-compose.yml up -d voice-stt voice-tts voice-tts-mnk
```

### 4.5 Dataprep worker (RAG ingestion)

```powershell
docker compose -f haystack-stack\docker-compose.yml up -d dataprep-worker
```

### 4.6 Redis (Haystack)

```powershell
docker compose -f haystack-stack\docker-compose.yml up -d redis
```

### 4.7 Telegram quick tunnel only

```powershell
docker compose `
  -f components\multichannel-access\docker-compose.yml `
  -f components\multichannel-access\docker-compose.quick-tunnel.yml `
  up -d cf-quick-tunnel
```

### 4.8 Telegram webhook auto-registrar (watcher)

```powershell
docker compose `
  -f components\multichannel-access\docker-compose.yml `
  -f components\multichannel-access\docker-compose.quick-tunnel-watcher.yml `
  up -d telegram-webhook-watcher
```

### 4.9 Cloudflared named tunnel for multichannel-access

```powershell
$env:CLOUDFLARED_TUNNEL_TOKEN = "<your-token-from-cloudflared-tunnel-token>"
docker compose `
  -f components\multichannel-access\docker-compose.yml `
  -f components\multichannel-access\docker-compose.cloudflare-tunnel.yml `
  up -d cloudflared
```

### 4.10 Haystack public tunnel (host-side, for Meta + Twilio)

```powershell
cloudflared tunnel --url http://localhost:8000 --no-autoupdate
```

(or use `amina_mvp_channels.ps1 -Action up -Channels meta -Tunnel quick`,
which manages the PID + log file for you)

---

## 5. Frontend dev server

### 5.1 Start it

```powershell
cd components\frontend
npm run dev
```

Default port: **5173**. The dev server hot-reloads on save. If port 5173
is taken Vite picks the next free one — read the terminal output.

### 5.2 If `npm install` fails

```powershell
# Wipe + reinstall
cd components\frontend
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

### 5.3 Where to set the backend URL

The frontend reads `window.AMINA_API` (default `http://localhost:8000`).
Override in `components\frontend\.env.local`:

```
VITE_API_URL=http://localhost:8000
```

### 5.4 Build for production

```powershell
cd components\frontend
npm run build
# Output: components\frontend\dist\
```

### 5.5 Browser developer console (where chat errors surface first)

Open the frontend URL → press **F12** → Console tab.
Most "AMINA isn't responding" issues are visible here as a red 4xx/5xx
on `/api/v1/agent/chat`.

---

## 6. Health-check probes (one-liners)

Each command returns 200 + a small JSON when the service is healthy.

### 6.1 Haystack backend

```powershell
curl.exe -s http://localhost:8000/health
```

### 6.2 Meta channels status (Messenger + WhatsApp)

```powershell
curl.exe -s http://localhost:8000/api/v1/meta/status
# Expect: {"whatsapp":{"enabled":...},"messenger":{"enabled":...}}
```

### 6.3 Twilio WhatsApp route

```powershell
curl.exe -s http://localhost:8000/api/v1/twilio/whatsapp/health
# Expect: {"status":"ok","channel":"twilio_whatsapp",...}
```

### 6.4 Multichannel-access (Telegram sidecar)

```powershell
curl.exe -s http://localhost:8020/health
# Expect: {"status":"ok","haystack":"connected","redis":"connected","telegram":true}
```

### 6.5 Telegram webhook info

```powershell
curl.exe -s http://localhost:8020/telegram/webhook-info
# Look at result.url -- should be your public tunnel /telegram/webhook
```

### 6.6 ArcadeDB

```powershell
# Studio UI
curl.exe -s -o $null -w "%{http_code}`n" http://localhost:2480/api/v1/server
# Expect: 200 or 401 (401 = up but auth required, which is fine)
```

### 6.7 Voice STT (whisper.cpp)

```powershell
curl.exe -s http://localhost:8087/health 2>&1
# Whisper.cpp returns "OK" or similar; failure = service down
```

### 6.8 Voice TTS (Piper, English)

```powershell
curl.exe -s http://localhost:5500/api/voices
# Returns a JSON list of voices when healthy
```

### 6.9 Voice TTS Mandinka (MMS)

```powershell
curl.exe -s http://localhost:5501/api/voices
```

### 6.10 Redis (Haystack-side)

```powershell
docker exec amina-redis redis-cli ping
# Expect: PONG
```

### 6.11 Redis (multichannel-side)

```powershell
docker exec multichannel-redis redis-cli ping
```

### 6.12 Dataprep

```powershell
curl.exe -s http://localhost:8001/health
```

### 6.13 Frontend (Vite)

```powershell
curl.exe -s -o $null -w "%{http_code}`n" http://localhost:5173/
# Expect: 200
```

### 6.14 The all-in-one channel snapshot

```powershell
.\scripts\amina_mvp_channels.ps1 -Action status -Channels all
```

This rolls up Haystack + multichannel + Twilio + Telegram into one
report with a final `MVP_READY` / `PARTIAL_READY` / `NOT_READY` verdict.

---

## 7. Log commands (per service)

Default Docker conventions:
- `docker logs <name>` — full log since container start
- `docker logs --tail 80 <name>` — last 80 lines
- `docker logs -f --tail 60 <name>` — follow live (Ctrl+C to stop)
- `docker logs --since 5m <name>` — last 5 minutes

### 7.1 Haystack backend (the agent itself)

```powershell
# Recent activity
docker logs --tail 80 haystack-chatqna

# Follow live
docker logs -f --tail 60 haystack-chatqna

# Since 10 minutes ago
docker logs --since 10m haystack-chatqna
```

### 7.2 Multichannel-access (Telegram)

```powershell
docker logs -f --tail 60 multichannel-access
```

### 7.3 STT

```powershell
docker logs -f --tail 80 voice-stt
```

### 7.4 TTS (English)

```powershell
docker logs -f --tail 60 voice-tts
```

### 7.5 TTS Mandinka

```powershell
docker logs -f --tail 60 voice-tts-mnk
```

### 7.6 ArcadeDB

```powershell
docker logs -f --tail 80 arcadedb
```

### 7.7 Redis (Haystack)

```powershell
docker logs --tail 60 amina-redis
```

### 7.8 Redis (multichannel)

```powershell
docker logs --tail 60 multichannel-redis
```

### 7.9 Dataprep worker

```powershell
docker logs -f --tail 80 dataprep-worker
```

### 7.10 Telegram quick tunnel (cloudflared)

```powershell
docker logs -f --tail 80 amina-cf-quick-tunnel
```

The tunnel URL appears once when the tunnel registers:
```powershell
docker logs amina-cf-quick-tunnel 2>&1 | Select-String "trycloudflare.com"
```

### 7.11 Telegram webhook watcher

```powershell
docker logs -f --tail 60 telegram-webhook-watcher
```

### 7.12 Cloudflared named tunnel

```powershell
docker logs -f --tail 80 amina-cloudflared
```

### 7.13 Frontend (Vite dev server)

The Vite process logs to **the terminal you started it in** — there is
no `docker logs` for it. Errors appear there + in the browser console
(F12).

### 7.14 Two-pane log watch (tile in two terminals)

For debugging a chat round-trip, open two terminals:

```powershell
# Terminal 1 - Haystack agent + tools + Meta + Twilio + Evidence
docker logs -f --tail 80 haystack-chatqna

# Terminal 2 - Telegram + multichannel pipeline
docker logs -f --tail 80 multichannel-access
```

---

## 8. Filtered / streaming log recipes

### 8.1 All chat turns (Meta + Twilio + Telegram)

```powershell
docker logs -f haystack-chatqna 2>&1 | Select-String "meta_pipeline|twilio_whatsapp|process_message"
```

### 8.2 Just Messenger / Meta WhatsApp turns

```powershell
docker logs -f haystack-chatqna 2>&1 | Select-String "meta_pipeline|/meta/webhook"
```

### 8.3 Just Twilio WhatsApp turns

```powershell
docker logs -f haystack-chatqna 2>&1 | Select-String "twilio_whatsapp"
```

### 8.4 LLM provider routing + fallback

```powershell
docker logs -f haystack-chatqna 2>&1 | Select-String "llm_policy|llm_provider"
```

### 8.5 Errors only (4xx + 5xx + Python tracebacks)

```powershell
docker logs -f haystack-chatqna 2>&1 |
  Select-String 'HTTP/1.1" (4|5)|ERROR|Traceback'
```

### 8.6 Evidence Layer activity

```powershell
docker logs -f haystack-chatqna 2>&1 | Select-String "evidence_layer|evidence_patch|evidence_pipeline"
```

### 8.7 Agent platform v1 (shadow / assist mode)

```powershell
docker logs -f haystack-chatqna 2>&1 | Select-String "agent_platform|agentic_runtime|\[agent_trace\]"
```

### 8.8 Telegram updates (per turn)

```powershell
docker logs -f multichannel-access 2>&1 | Select-String "telegram|webhook|/api/v1/agent"
```

### 8.9 Voice (STT failures + TTS failures)

```powershell
# STT
docker logs -f voice-stt 2>&1 | Select-String -Pattern "ERROR|fail|timeout" -CaseSensitive:$false
# TTS
docker logs -f voice-tts 2>&1 | Select-String -Pattern "ERROR|fail" -CaseSensitive:$false
```

### 8.10 ArcadeDB query / connection problems

```powershell
docker logs --since 30m arcadedb 2>&1 | Select-String "ERROR|WARN|exception|denied"
```

### 8.11 Save logs to a file (for sharing or later analysis)

```powershell
docker logs --since 30m haystack-chatqna 2>&1 > logs\haystack-30min.txt
```

---

## 9. Channel ops (Telegram / Messenger / Twilio)

### 9.1 The unified ops script

```powershell
# Status across all channels
.\scripts\amina_mvp_channels.ps1 -Action status -Channels all

# Verify everything (read-only checks + classification)
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels all

# Bring everything up + auto-register telegram + print smoke list
.\scripts\amina_mvp_channels.ps1 -Action up -Channels all -Tunnel quick `
   -RegisterTelegramWebhook -PrintManualSmoke

# Stop only the quick tunnels we started (keep containers running)
.\scripts\amina_mvp_channels.ps1 -Action down -Tunnel quick
```

### 9.2 Telegram webhook ops (standalone)

```powershell
# Inspect current webhook + sidecar health
.\scripts\telegram_webhook_ops.ps1 -Verify

# Register a new public URL with Telegram
.\scripts\telegram_webhook_ops.ps1 `
  -PublicUrl "https://<your-tunnel>.trycloudflare.com" `
  -SetWebhook -Verify

# Just print tunnel-open commands without running anything
.\scripts\telegram_webhook_ops.ps1 -OpenTunnelHint
```

### 9.3 Meta channels (Messenger + WhatsApp via Meta Cloud API)

```powershell
# Stage 2 readiness (status + env presence + handshake)
.\scripts\meta_stage2_readiness.ps1 -CheckStatus -CheckEnv -VerifyHandshake -Channel both

# Print callback URLs to paste into Meta App Dashboard
.\scripts\meta_stage2_readiness.ps1 -PublicUrl "https://<tunnel>.trycloudflare.com"

# Interactive credential setup
python scripts\setup_meta_channels.py
```

### 9.4 Twilio WhatsApp Sandbox

```powershell
# Health
curl.exe -s http://localhost:8000/api/v1/twilio/whatsapp/health

# Smoke test through public tunnel (no real WhatsApp message needed)
curl.exe -X POST "https://<tunnel>.trycloudflare.com/api/v1/twilio/whatsapp/webhook" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  --data-urlencode "From=whatsapp:+1234567890" `
  --data-urlencode "To=whatsapp:+14155238886" `
  --data-urlencode "Body=hi" `
  --data-urlencode "MessageSid=SMTEST" `
  --data-urlencode "ProfileName=Tester" `
  --data-urlencode "NumMedia=0"
# Expect: HTTP 200 + <Response/> (async mode) or <Response><Message>...</Message></Response> (sync)
```

Twilio Console: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
Twilio Logs:    https://console.twilio.com/us1/monitor/logs/sms

### 9.5 Webhook URL cheat sheet

| Channel | URL pattern |
|---|---|
| Messenger | `<META_PUBLIC_URL>/api/v1/meta/webhook/messenger` |
| Meta WhatsApp | `<META_PUBLIC_URL>/api/v1/meta/webhook/whatsapp` |
| Twilio WhatsApp | `<META_PUBLIC_URL>/api/v1/twilio/whatsapp/webhook` |
| Telegram | `<TG_PUBLIC_URL>/telegram/webhook` |

Verify token for Meta channels (handshake): `amina_health_2026`

---

## 10. Tunnels (Cloudflare quick + named)

### 10.1 Quick tunnel for Haystack (Meta + Twilio webhooks, port 8000)

```powershell
# Start (managed via the MVP script — it tracks the PID for you)
.\scripts\amina_mvp_channels.ps1 -Action up -Channels meta -Tunnel quick

# Stop just the quick tunnel (containers keep running)
.\scripts\amina_mvp_channels.ps1 -Action down -Tunnel quick

# Or start cloudflared directly (manual PID management)
cloudflared tunnel --url http://localhost:8000 --no-autoupdate
```

### 10.2 Quick tunnel for Telegram (multichannel-access, port 8020)

```powershell
# Start as a sidecar container
docker compose `
  -f components\multichannel-access\docker-compose.yml `
  -f components\multichannel-access\docker-compose.quick-tunnel.yml `
  up -d cf-quick-tunnel

# Read URL
docker logs amina-cf-quick-tunnel 2>&1 | Select-String "trycloudflare.com"

# Stop it
docker compose `
  -f components\multichannel-access\docker-compose.yml `
  -f components\multichannel-access\docker-compose.quick-tunnel.yml `
  stop cf-quick-tunnel
```

### 10.3 Named tunnel (production, persistent URL)

```powershell
# One-time setup (on the host)
cloudflared login
cloudflared tunnel create amina-prod
cloudflared tunnel route dns amina-prod amina.your-domain.com

# Run as a docker sidecar (multichannel-access only)
$env:CLOUDFLARED_TUNNEL_TOKEN = "<from cloudflared tunnel token amina-prod>"
docker compose `
  -f components\multichannel-access\docker-compose.yml `
  -f components\multichannel-access\docker-compose.cloudflare-tunnel.yml `
  up -d cloudflared

# For both Haystack + multichannel behind one host: see
# docs\MVP_MULTICHANNEL_RUNBOOK.md §12 "Production: one public host + path routing"
```

---

## 11. Database ops (ArcadeDB + Redis)

### 11.1 ArcadeDB Studio (browser UI)

URL: http://localhost:2480

Default creds (override via env):
- Username: `root`
- Password: usually set via `ARCADEDB_ROOT_PASSWORD` env / `.env`

Common tasks:
- **Query**: Studio → "Studio" icon → pick database → run AQL/SQL.
- **List databases**:
  ```powershell
  curl.exe -s -u "root:<password>" http://localhost:2480/api/v1/databases
  ```

### 11.2 Inspect a Redis key (Haystack-side)

```powershell
# Show all keys (small dev only)
docker exec amina-redis redis-cli KEYS "*"

# Inspect a known key
docker exec amina-redis redis-cli GET "amina:evidence:state"

# Watch a list (e.g. evidence trace ring)
docker exec amina-redis redis-cli LRANGE amina:evidence:recent_traces 0 5
```

### 11.3 Redis (multichannel) — Telegram session state

```powershell
# Common keys: cg_conv:* (caregiver conversation state)
docker exec multichannel-redis redis-cli KEYS "cg_conv:*"
docker exec multichannel-redis redis-cli GET "<key>"
```

### 11.4 Redis monitor (live command stream — verbose)

```powershell
docker exec amina-redis redis-cli MONITOR
# Ctrl+C to stop
```

### 11.5 ArcadeDB volumes — DO NOT delete

Per project rule: **never** run `docker compose down -v` on the
Haystack stack. That wipes ArcadeDB volumes (patient profiles,
conversations). Always stop without `-v`:

```powershell
docker compose -f haystack-stack\docker-compose.yml down       # NO -v
```

Same for `redis-data` and `multichannel-redis-data` volumes.

---

## 12. Recreate / restart / stop

### 12.1 Recreate one container after changing env

```powershell
docker compose `
  -f haystack-stack\docker-compose.yml `
  -f haystack-stack\docker-compose.override.yml `
  -f haystack-stack\docker-compose.meta-channels.yml `
  up -d --force-recreate --no-deps haystack-chatqna
```

### 12.2 Soft restart (preserves env, no recreate)

```powershell
docker restart haystack-chatqna
```

### 12.3 Stop a single container

```powershell
docker stop haystack-chatqna
```

### 12.4 Stop the whole stack (keeps volumes)

```powershell
# Haystack stack
docker compose -f haystack-stack\docker-compose.yml down

# Multichannel stack
docker compose -f components\multichannel-access\docker-compose.yml down
```

### 12.5 Stop only the tunnel(s) the MVP script started

```powershell
.\scripts\amina_mvp_channels.ps1 -Action down -Tunnel quick
```

### 12.6 Hard remove + clean up dangling images (NEVER on volumes)

```powershell
docker image prune -f      # remove dangling images
docker container prune -f  # remove stopped containers
# DO NOT use docker volume prune unless you've checked twice
```

---

## 13. Test suites

All test suites are pure-stdlib Python and self-contained. Run inside
the haystack container.

### 13.1 Copy a test file in and run

```powershell
docker cp haystack-stack\haystack-chatqna\_evidence_layer_test.py haystack-chatqna:/app/_evidence_layer_test.py
docker exec haystack-chatqna python /app/_evidence_layer_test.py
```

### 13.2 The standard suite (run after any deploy)

| Suite | Command (after `docker cp` of the file) | Coverage |
|---|---|---|
| Evidence Layer | `docker exec haystack-chatqna python /app/_evidence_layer_test.py` | 152 assertions |
| Agent Platform v1 | `docker exec haystack-chatqna python /app/_agent_platform_v1_test.py` | 149 assertions |
| Meta shared pipeline | `docker exec haystack-chatqna python /app/_meta_shared_pipeline_test.py` | 45 assertions |
| Meta sanity | `docker exec haystack-chatqna python /app/_meta_sanity.py` | 24 assertions |
| Twilio WhatsApp | `docker exec haystack-chatqna python /app/_twilio_whatsapp_test.py` | 71 assertions |
| Basic/Beginner router | `docker exec haystack-chatqna python /app/_basic_beginner_router_test.py` | router classification |
| Policy review | `docker exec haystack-chatqna python /app/_policy_review_test.py` | 55 assertions |

### 13.3 PowerShell parser checks (script files)

```powershell
$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  "scripts\amina_mvp_channels.ps1", [ref]$tokens, [ref]$errors
) | Out-Null
if ($errors -and $errors.Count) { $errors | Select-Object -First 3 } else { "syntax OK" }
```

---

## 14. Troubleshooting one-pagers

### 14.1 "Chat returns 500"

```powershell
# Did the agent throw?
docker logs --since 2m haystack-chatqna 2>&1 | Select-String "ERROR|Traceback" | Select-Object -Last 20

# Is Redis up?
docker exec amina-redis redis-cli ping

# Is ArcadeDB up?
curl.exe -s -o $null -w "%{http_code}`n" http://localhost:2480/api/v1/server
```

### 14.2 "AMINA isn't replying on WhatsApp / Messenger"

```powershell
# Did Twilio / Meta even reach our webhook?
docker logs --since 5m haystack-chatqna 2>&1 |
  Select-String "POST .*meta/webhook|POST .*twilio/whatsapp"

# If yes - did the agent run?
docker logs --since 5m haystack-chatqna 2>&1 |
  Select-String "meta_pipeline|twilio_whatsapp|llm_policy"

# If no POST at all - the public URL pasted into the dashboard is wrong / dead
.\scripts\amina_mvp_channels.ps1 -Action status -Channels all
```

For Twilio specifically: check
https://console.twilio.com/us1/monitor/logs/sms — the Outbound-Reply
row's `Status` + `Error Code` tells you exactly what failed.

### 14.3 "Telegram webhook is set but bot is silent"

```powershell
# Check what URL Telegram thinks the webhook is
curl.exe -s http://localhost:8020/telegram/webhook-info

# Re-register if URL is stale or missing
.\scripts\telegram_webhook_ops.ps1 -PublicUrl "https://<current>.trycloudflare.com" -SetWebhook -Verify
```

### 14.4 "Voice STT timing out"

```powershell
# Check it's running + healthy
docker ps --filter "name=voice-stt" --format "{{.Status}}"

# Recent errors
docker logs --since 5m voice-stt 2>&1 | Select-String "ERROR|fail"

# Restart it
docker restart voice-stt
```

### 14.5 "TTS returns no audio"

```powershell
# Check voices endpoint
curl.exe -s http://localhost:5500/api/voices | Select-String "lessac|amy|joe"

# Check Mandinka TTS
curl.exe -s http://localhost:5501/api/voices

# Restart
docker restart voice-tts voice-tts-mnk
```

### 14.6 "Dataprep won't ingest a PDF"

```powershell
# Logs
docker logs --since 10m dataprep-worker 2>&1 | Select-String "ERROR|fail"

# Restart
docker restart dataprep-worker

# Probe
curl.exe -s http://localhost:8001/health
```

### 14.7 "Cloudflare quick tunnel keeps blipping (502s)"

Quick tunnels are ephemeral. For demos lasting >1 day, switch to a
named tunnel — see [§10.3](#103-named-tunnel-production-persistent-url).

### 14.8 "ArcadeDB locked / read-only"

```powershell
# Check uptime
docker ps --filter "name=arcadedb"

# Recent errors
docker logs --since 30m arcadedb 2>&1 | Select-String "ERROR|locked|denied"

# Restart (preserves data — DO NOT use -v)
docker restart arcadedb
```

### 14.9 "Frontend can't reach backend"

```powershell
# Backend reachable?
curl.exe -s http://localhost:8000/health

# CORS / wrong base URL?
# Check components\frontend\.env.local has VITE_API_URL=http://localhost:8000

# Browser console (F12) usually shows the exact URL it tried
```

### 14.10 "Container exists but not in the network"

```powershell
docker network inspect haystack-stack_chatqna_default | Select-String "Name"

# Reattach by recreating the container
docker compose -f haystack-stack\docker-compose.yml up -d --force-recreate <service>
```

---

## 15. Cheat sheet (top 20 commands)

```powershell
# 1. Bring everything up + register Telegram + print URLs
.\scripts\amina_mvp_channels.ps1 -Action up -Channels all -Tunnel quick `
  -RegisterTelegramWebhook -PrintManualSmoke

# 2. One-call status across all channels
.\scripts\amina_mvp_channels.ps1 -Action status -Channels all

# 3. Verify everything (read-only)
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels all

# 4. Watch the agent
docker logs -f --tail 60 haystack-chatqna

# 5. Watch Telegram
docker logs -f --tail 60 multichannel-access

# 6. Filter to chat turns only
docker logs -f haystack-chatqna 2>&1 |
  Select-String "meta_pipeline|twilio_whatsapp|process_message"

# 7. Errors only
docker logs -f haystack-chatqna 2>&1 |
  Select-String 'HTTP/1.1" (4|5)|ERROR|Traceback'

# 8. Health checks
curl.exe -s http://localhost:8000/health
curl.exe -s http://localhost:8000/api/v1/meta/status
curl.exe -s http://localhost:8000/api/v1/twilio/whatsapp/health
curl.exe -s http://localhost:8020/health

# 9. Telegram webhook
curl.exe -s http://localhost:8020/telegram/webhook-info

# 10. Re-register Telegram webhook with a new URL
.\scripts\telegram_webhook_ops.ps1 -PublicUrl "https://<tunnel>.trycloudflare.com" -SetWebhook -Verify

# 11. Recreate Haystack only (after env change)
docker compose -f haystack-stack\docker-compose.yml `
  -f haystack-stack\docker-compose.override.yml `
  -f haystack-stack\docker-compose.meta-channels.yml `
  up -d --force-recreate --no-deps haystack-chatqna

# 12. Restart a single container without recreate
docker restart haystack-chatqna
docker restart multichannel-access

# 13. Stop tunnels we started (containers stay up)
.\scripts\amina_mvp_channels.ps1 -Action down -Tunnel quick

# 14. Frontend dev server
cd components\frontend; npm run dev

# 15. ArcadeDB Studio
start http://localhost:2480

# 16. Redis ping
docker exec amina-redis redis-cli ping
docker exec multichannel-redis redis-cli ping

# 17. List running containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 18. Save 30-min haystack log to file
docker logs --since 30m haystack-chatqna > logs\haystack-30min.txt

# 19. Twilio sandbox + Meta dashboard URLs
curl.exe -s http://localhost:8000/api/v1/meta/status
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels all `
  -MetaPublicUrl "<your-public-url>"

# 20. Run the standard test suite (after copying test files in)
docker exec haystack-chatqna python /app/_evidence_layer_test.py
docker exec haystack-chatqna python /app/_agent_platform_v1_test.py
docker exec haystack-chatqna python /app/_twilio_whatsapp_test.py
docker exec haystack-chatqna python /app/_meta_shared_pipeline_test.py
```

---

## Appendix — service-to-port quick reference

```
8000   Haystack backend                      (host)  http://localhost:8000
8001   Dataprep worker                       (host)  http://localhost:8001
8020   Multichannel-access (Telegram)        (host)  http://localhost:8020
8087   Whisper STT                           (host)  http://localhost:8087
5500   Piper TTS (English)                   (host)  http://localhost:5500
5501   MMS TTS (Mandinka)                    (host)  http://localhost:5501
2480   ArcadeDB Studio                       (host)  http://localhost:2480
2424   ArcadeDB binary                       (host)  tcp://localhost:2424
5433   ArcadeDB Postgres wire                (host)  tcp://localhost:5433
6379   Redis (multichannel)                  (host)  localhost:6379
5173   Frontend Vite dev server              (host)  http://localhost:5173
```

Internal-only (docker network `haystack-stack_chatqna_default`):

```
amina-redis:6379
multichannel-access:8020
haystack-chatqna:8000
voice-stt:8080
voice-tts:5500
voice-tts-mnk:5500
arcadedb:2480
```

---

## Appendix — related runbooks

- [docs/MVP_MULTICHANNEL_RUNBOOK.md](MVP_MULTICHANNEL_RUNBOOK.md) — channel ops in depth
- [docs/META_STAGE2_READINESS.md](META_STAGE2_READINESS.md) — Meta channels readiness
- [docs/EVIDENCE_LAYER.md](EVIDENCE_LAYER.md) — Evidence Layer toggle + eval
- [docs/AGENT_PLATFORM_V1.md](AGENT_PLATFORM_V1.md) — Agent Platform shadow/assist
- [docs/AMINA_FULL_SYSTEM_ARCHITECTURE.md](AMINA_FULL_SYSTEM_ARCHITECTURE.md) — full system map

---

*Last updated: April 2026. Save this file open in a tab during a demo.*
