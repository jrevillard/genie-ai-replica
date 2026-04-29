# Amina Care — Branch Quickstart

A focused operator's guide for the **`Health-AminaCare-branch`** of GENIE.AI.
The full UN-ITU GENIE.AI overview lives in [`README.md`](./README.md);
this file is just the commands you need to run, debug, and ship the
Amina Care stack.

---

## 1. What's in this branch

Amina Care is a Gambian community-health agent that runs on top of GENIE.AI.
The branch wires together:

| Surface | What it is | Where it lives |
|---|---|---|
| **Haystack agent** | FastAPI / ReAct loop, RAG, agent platform v1/v2, evidence layer, gap closers, dual-path care ledger, caregiver privacy v3, observatory, 24 DHIS2 routes, translation v2/v3 | `haystack-stack/haystack-chatqna/` |
| **Frontend** | React + Vite. Patient app, caregiver portal, admin shell (`AdminShell`), government observatory (`GovShell`), command palette, role switcher | `components/frontend/` |
| **Multichannel sidecar** | Telegram bridge + WhatsApp + Messenger via Cloudflare quick tunnel | `components/multichannel-access/` |
| **Voice gateway** | whisper.cpp STT, Piper TTS (English), facebook/mms-tts-mnk (Mandinka) | `components/voice-gateway/`, `haystack-stack/tts-service/`, `haystack-stack/tts-mms-service/` |
| **DHIS2 integration** | Aggregate push + tracker (Phase 2) → `play.im.dhis2.org/dev` by default | `haystack-stack/haystack-chatqna/src/api/dhis2*.py` |
| **Training** | LoRA / Mistral / OpenAI fine-tune scripts + datasets | `training/` |
| **Apache Superset** | Optional analytics dashboards | `components/apache-superset/` |
| **ArcadeDB** | Graph + document DB (memory, evidence, ledger) | `haystack-stack/docker-compose.yml` |

---

## 2. Prereqs

- Docker Desktop (WSL2 backend on Windows)
- Node 20+ (frontend dev server)
- Python 3.10+ (only if you run host-side scripts)
- Roughly **4 CPU / 8 GB RAM free**, more if you enable GPU
- The whisper + piper model binaries (NOT in git — see **§7 Recovery**)

Clone, then:
```
git checkout Health-AminaCare-branch
```

---

## 3. The one-line bring-up (cold start)

After clone + models in place (§7), bring up the **whole** stack with:

```bash
# 3.1 Backend stack (haystack-chatqna + arcadedb + redis + voice-stt + voice-tts + voice-tts-mnk + dataprep-worker)
docker compose \
  -f haystack-stack/docker-compose.yml \
  -f haystack-stack/docker-compose.override.yml \
  -f haystack-stack/docker-compose.meta-channels.yml \
  --project-directory haystack-stack \
  up -d --no-build \
  haystack-chatqna voice-stt voice-tts voice-tts-mnk arcadedb redis dataprep-worker

# 3.2 Multichannel sidecar (Telegram + quick tunnel + webhook watcher)
docker compose \
  -f components/multichannel-access/docker-compose.yml \
  -f components/multichannel-access/docker-compose.quick-tunnel.yml \
  -f components/multichannel-access/docker-compose.quick-tunnel-watcher.yml \
  --project-directory components/multichannel-access \
  up -d

# 3.3 Frontend dev server (host process, not docker)
cd components/frontend
npm install              # only first time / after dep changes
npm run dev              # serves http://localhost:5174
```

Healthy state = **11 containers running**. Verify:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

You should see: `haystack-chatqna`, `arcadedb`, `amina-redis`, `voice-stt`,
`voice-tts`, `voice-tts-mnk`, `dataprep-worker`, `multichannel-access`,
`multichannel-redis`, `amina-cf-quick-tunnel`, `telegram-webhook-watcher`,
all `(healthy)`.

> **Why `--no-build`** — the haystack-chatqna image is already in your local
> Docker. Skipping rebuild avoids the 5-minute pip install. If you've
> changed Python deps (`requirements.txt`), drop the flag.

---

## 4. URLs you'll actually hit

| Service | URL | Notes |
|---|---|---|
| **Patient / caregiver / admin app** | http://localhost:5174/ | Vite dev server. Port pinned via `vite.config.js` |
| Amina agent (Swagger) | http://localhost:8000/docs | All routes interactive |
| Amina agent (health) | http://localhost:8000/health | Liveness probe |
| Multichannel sidecar | http://localhost:8020/health | Should show `telegram:true`, `redis:connected` |
| Whisper STT | http://localhost:8087/ | Direct whisper.cpp server |
| Piper TTS (English) | http://localhost:5500/docs | Synth engine |
| MMS TTS (Mandinka) | http://localhost:5501/docs | facebook/mms-tts-mnk |
| ArcadeDB Studio | http://localhost:2480/ | Graph DB UI; `root` / `genieRoot123` |
| Dataprep worker | http://localhost:8001/docs | PDF / docling ingestion |

---

## 5. Logging in

The app supports four logged-in roles plus a guest mode:

| Role | How to log in | What you can do |
|---|---|---|
| **Patient** | `#/patient/login`, signup or OTP | Chat, voice, supply ledger (read), care path (read) |
| **Caregiver** | `#/caregiver/login` (registration wizard now has Phase 4 privacy step) | Caregiver chat, inbox, emergency, patient supply ledger (read) |
| **Clinician / VHW** | Use admin login below + `RoleSwitcher` to act-as. With `CARE_TRUST_BODY_ROLE=true` the backend honors the act-as role. | Supply ledger writes (clinician), care-path writes (clinician + vhw + imam-on-traditional-only) |
| **Admin** | `#/admin/login` → `admin` / `amina2026` | Everything: integrations workspace, gov portal, agent lab, command center |
| **Imam** | Acts via RoleSwitcher | Care-path **traditional** tab writes only |

**Government / Observatory portal** — open the admin console, run the
"Open Government portal" command (palette ⌘K → Government portal), accept
the synthetic-data consent gate, then officer phone-auth. Sign-out
(top-right of `GovShell`) now hard-clears all admin/gov tokens **and**
the observatory consent receipt, so the policy gate re-prompts on next
sign-in.

---

## 6. Quick smoke tests

```bash
# Agent text chat (English)
curl -s -X POST http://localhost:8000/api/v1/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"test","session_id":"s1","message":"hello"}'

# Mandinka chat — exercises translation v2 router + v3 phrase-bank gate
curl -s -X POST http://localhost:8000/api/v1/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"test","session_id":"s2","message":"my child has fever","language":"ma"}'

# Piper TTS (English)
curl -s -X POST http://localhost:5500/v1/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello world"}' -o /tmp/en.wav

# MMS TTS (Mandinka)
curl -s -X POST http://localhost:5501/v1/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"i be di"}' -o /tmp/mnk.wav

# STT (send a 16 kHz mono WAV)
curl -s -X POST http://localhost:8000/api/v1/stt \
  -F "file=@/tmp/en.wav;filename=clip.wav"

# DHIS2 dry-run (admin token unless DHIS2_DEV_ADMIN_BYPASS=true)
curl -s -X POST http://localhost:8000/api/v1/dhis2/sync/dry-run \
  -H 'Content-Type: application/json' -d '{}'

# Admin login (returns JWT)
curl -s -X POST http://localhost:8000/api/v1/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"amina2026"}'
```

---

## 7. Recovery — if model files are missing

The whisper + piper model binaries are NOT in git (too big — 2+ GB).
After a fresh clone the bind-mount targets `voice-gateway/infra/whispercpp/models/`
and `voice-gateway/infra/piper/models/` will be empty, and `voice-stt`
will restart-loop with `failed to open '/models/ggml-small.en.bin'`.

Two options:

**A) Copy from a sibling clone** (the fastest path on a dev machine):
```bash
# whisper (~488 MB for small.en)
cp /e/GenAI/amina/genie-ai-replica/components/voice-gateway/infra/whispercpp/models/ggml-small.en.bin \
   components/voice-gateway/infra/whispercpp/models/

# piper (~125 MB for both English voices)
cp /e/GenAI/amina/genie-ai-replica/components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx \
   /e/GenAI/amina/genie-ai-replica/components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx.json \
   /e/GenAI/amina/genie-ai-replica/components/voice-gateway/infra/piper/models/en_US-amy-medium.onnx \
   /e/GenAI/amina/genie-ai-replica/components/voice-gateway/infra/piper/models/en_US-amy-medium.onnx.json \
   components/voice-gateway/infra/piper/models/

docker restart voice-stt voice-tts
```

**B) Download from upstream**:
- whisper.cpp models: https://huggingface.co/ggerganov/whisper.cpp/tree/main
  Pick `ggml-base.en.bin` (148 MB, faster, current default) or `ggml-small.en.bin`
  (488 MB, more accurate). The active model is set in
  `haystack-stack/docker-compose.override.yml:27`.
- piper voices: https://github.com/rhasspy/piper/blob/master/VOICES.md
  Download both the `.onnx` and `.onnx.json` for each voice.

The MMS Mandinka voice (`facebook/mms-tts-mnk`) downloads itself on first
use into `haystack-stack/data/huggingface-cache/` — no manual step.

---

## 8. Stop / restart cheatsheet

```bash
# Stop the haystack stack
docker compose -f haystack-stack/docker-compose.yml \
  -f haystack-stack/docker-compose.override.yml \
  -f haystack-stack/docker-compose.meta-channels.yml \
  --project-directory haystack-stack down

# Stop the multichannel sidecar
docker compose -f components/multichannel-access/docker-compose.yml \
  --project-directory components/multichannel-access down

# Restart just one service after code changes (most files in
# haystack-chatqna/src/api/ and src/services/ are bind-mounted, so
# a restart picks up the edit without a rebuild)
docker restart haystack-chatqna

# Force-recreate after .env or compose changes
docker compose -f haystack-stack/docker-compose.yml \
  -f haystack-stack/docker-compose.override.yml \
  -f haystack-stack/docker-compose.meta-channels.yml \
  --project-directory haystack-stack \
  up -d --no-deps --force-recreate haystack-chatqna

# Rebuild the haystack-chatqna image (pip / spaCy changes only)
docker compose -f haystack-stack/docker-compose.yml \
  -f haystack-stack/docker-compose.override.yml \
  -f haystack-stack/docker-compose.meta-channels.yml \
  --project-directory haystack-stack build haystack-chatqna

# Frontend reload — Vite HMR catches most edits. Hard restart:
# 1. Ctrl-C in the npm run dev terminal
# 2. taskkill //F //IM node.exe   (kills any orphan vite, Windows)
# 3. cd components/frontend && npm run dev
```

---

## 9. Dev escape-hatch flags — must flip OFF before prod

These live in `haystack-stack/.env` and are committed `=true` for dev
convenience. **Set them to `false` (or unset) in any deploy.**

| Flag | Effect | Prod risk if left on |
|---|---|---|
| `CARE_TRUST_BODY_ROLE` | Backend honors `body.role` for `/care/*` writes (lets RoleSwitcher actually work) | Any patient can self-promote by sending `{"role":"admin"}` |
| `DHIS2_DEV_ADMIN_BYPASS` | Backend treats every `/api/v1/dhis2/*` request as admin | DHIS2 push endpoints exposed to the internet |
| `CHATQNA_ADMIN_MV_OPEN` | Admin / gov MV dashboards render without admin JWT | Unredacted ops dashboards public |

The role-rule rules themselves (which roles can write supply / care-path):
- `SUPPLY_WRITE_ROLES   = {clinician, admin}` — supply ledger
- `CAREPATH_WRITE_ROLES = {clinician, vhw, admin}` — modern / interaction / progress tabs
- `CAREPATH_TRADITIONAL_WRITE_ROLES = {clinician, vhw, imam, admin}` — traditional tab only
- DHIS2 — admin only

---

## 10. Common ops

```bash
# Tail logs
docker logs -f haystack-chatqna
docker logs -f voice-stt
docker logs -f multichannel-access

# Verify Telegram webhook
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo" | jq .

# DHIS2 — verify mapping & latest sync (needs admin token, or
# DHIS2_DEV_ADMIN_BYPASS=true)
curl -s http://localhost:8000/api/v1/dhis2/config | jq .
curl -s http://localhost:8000/api/v1/dhis2/sync/status | jq .

# ArcadeDB Studio (open in browser)
open http://localhost:2480     # macOS
xdg-open http://localhost:2480 # linux
start http://localhost:2480    # windows / git bash

# Reset a session (clears conversation memory in Redis)
curl -X DELETE http://localhost:8000/api/v1/agent/session/<session_id>
```

---

## 11. Where things plug in (quick map)

```
                      ┌──────────────────────────────┐
                      │  components/frontend/        │
                      │  (Vite, :5174)               │
                      │   • App.jsx          patient │
                      │   • CaregiverPortal  cg      │
                      │   • AdminShell       admin   │
                      │   • GovShell         gov     │
                      └──────────────┬───────────────┘
                                     │ HTTPS
                                     ▼
       ┌─────────────────────────────────────────────────────┐
       │  haystack-chatqna  (FastAPI, :8000)                 │
       │  uvicorn src.main_with_rag_tuning:app               │
       │                                                     │
       │   /api/v1/agent/chat            ← agent + v3 patch  │
       │   /api/v1/agent/chat-stream     ← SSE streaming    │
       │   /api/v1/care/supply_ledger    ← clinician writes │
       │   /api/v1/care/dualpath_ledger  ← cln/vhw/imam     │
       │   /api/v1/dhis2/*               ← MoH integration  │
       │   /api/v1/caregiver-v2/*        ← Phase 4 wizard   │
       │   /api/v1/observatory/*         ← gov consent gate │
       │   /api/v1/policy/*              ← policy review    │
       │   /api/v1/stt /api/v1/tts       ← voice            │
       └──────────────┬──────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┬────────────────┐
        ▼             ▼             ▼                ▼
   ┌────────┐  ┌──────────┐  ┌────────────┐   ┌────────────┐
   │arcadedb│  │amina-    │  │voice-stt   │   │voice-tts   │
   │(graph) │  │redis     │  │(whisper)   │   │(piper EN)  │
   │:2480   │  │:6379     │  │:8087       │   │:5500       │
   └────────┘  └──────────┘  └────────────┘   └────────────┘
                                                      │
                                                      ▼
                                              ┌────────────┐
                                              │voice-tts-  │
                                              │mnk (MMS)   │
                                              │:5501       │
                                              └────────────┘

   ┌─────────────────────────────────────────┐
   │  multichannel-access (:8020)            │
   │  Telegram bot ↔ Haystack /api/v1/agent  │
   │  + cloudflare quick tunnel              │
   │  + telegram webhook watcher             │
   └─────────────────────────────────────────┘
```

---

## 12. License + attribution

This branch is `Health-AminaCare-branch` of the GENIE.AI repo
(https://opensource.unicc.org/un/itu/genie-ai). Same license as upstream
(see [`README.md`](./README.md), [`THIRD_PARTY.md`](./THIRD_PARTY.md)).
Amina Care is the Gambian community-health implementation built on top.

Operational manual with deeper detail: [`docs/AMINA_OPS_MANUAL.md`](./docs/AMINA_OPS_MANUAL.md).
Architecture overview: [`docs/AMINA_FULL_SYSTEM_ARCHITECTURE.md`](./docs/AMINA_FULL_SYSTEM_ARCHITECTURE.md).
